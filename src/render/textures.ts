import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { isTouch } from '../config';

/**
 * All drawing is authored on a 256 × 256 design grid and scaled up to the
 * real texture size, so the art reads the same at any resolution.
 */
const DESIGN = 256;
/** Real texture resolution. Phones get half to save memory. */
const SIZE = isTouch ? 512 : 1024;

type Draw = (g: CanvasRenderingContext2D) => void;

export function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2D canvas context unavailable');
  return [canvas, g];
}

function draw(fn: Draw): HTMLCanvasElement {
  const [canvas, g] = canvas2d(SIZE);
  g.scale(SIZE / DESIGN, SIZE / DESIGN);
  fn(g);
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ---------- pixel helpers ----------

/** Cheap deterministic hash noise in 0..1. */
export function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise that tiles every `period` pixels. */
export function valueNoise(x: number, y: number, period: number, cells: number, seed: number): number {
  const fx = (x / period) * cells;
  const fy = (y / period) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const w = (v: number) => ((v % cells) + cells) % cells;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable multi-octave noise in roughly 0..1. */
function fbm(x: number, y: number, size: number, seed: number): number {
  return (valueNoise(x, y, size, 4, seed) * 0.5 + valueNoise(x, y, size, 8, seed + 1) * 0.3 +
    valueNoise(x, y, size, 32, seed + 2) * 0.2);
}

/**
 * Noise is the slow part of texture generation, so one smooth field and one
 * grain field are built once and shared; each texture reads them at its own
 * wrap-around offset so they don't visibly repeat between surfaces.
 */
let noiseFields: { smooth: Float32Array; grain: Float32Array } | null = null;
function getNoise() {
  if (noiseFields) return noiseFields;
  const smooth = new Float32Array(SIZE * SIZE);
  const grain = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      smooth[y * SIZE + x] = fbm(x, y, SIZE, 1);
      grain[y * SIZE + x] = hash(x, y, 7);
    }
  }
  noiseFields = { smooth, grain };
  return noiseFields;
}

/** Index into the shared noise fields, shifted by `seed`. */
function noiseIndex(x: number, y: number, seed: number): number {
  return ((y + seed * 389) % SIZE) * SIZE + ((x + seed * 211) % SIZE);
}

/** Separable wrap-around box blur, applied `passes` times (≈ gaussian). */
function blur(src: Float32Array, size: number, radius: number, passes = 3): void {
  if (radius < 1) return;
  const tmp = new Float32Array(src.length);
  const cols = new Float32Array(size);
  const norm = 1 / (radius * 2 + 1);
  // Wrapped indices of the samples entering and leaving the running window.
  const enter = new Int32Array(size);
  const leave = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    enter[i] = (i + radius + 1) % size;
    leave[i] = (i - radius + size) % size;
  }
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < size; y++) {
      const row = y * size;
      let acc = 0;
      for (let k = -radius; k <= radius; k++) acc += src[row + ((k + size) % size)];
      for (let x = 0; x < size; x++) {
        tmp[row + x] = acc * norm;
        acc += src[row + enter[x]] - src[row + leave[x]];
      }
    }
    // Vertical pass, row by row with one running sum per column (cache-friendly).
    cols.fill(0);
    for (let k = -radius; k <= radius; k++) {
      const row = ((k + size) % size) * size;
      for (let x = 0; x < size; x++) cols[x] += tmp[row + x];
    }
    for (let y = 0; y < size; y++) {
      const row = y * size;
      const inRow = enter[y] * size;
      const outRow = leave[y] * size;
      for (let x = 0; x < size; x++) {
        src[row + x] = cols[x] * norm;
        cols[x] += tmp[inRow + x] - tmp[outRow + x];
      }
    }
  }
}

/** Reads a grayscale canvas (red channel) into 0..1 floats. */
function readGray(canvas: HTMLCanvasElement): Float32Array {
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4] / 255;
  return out;
}

/**
 * A height field built in layers: each layer is drawn as a white-on-black
 * mask, softened by `bevel` design pixels, and added with `amount`.
 */
interface HeightLayer {
  mask: Draw;
  bevel: number;
  amount: number;
}

function heightField(layers: HeightLayer[], grain = 0, seed = 1): Float32Array {
  const h = new Float32Array(SIZE * SIZE);
  const k = SIZE / DESIGN;
  for (const layer of layers) {
    const field = readGray(draw((g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, DESIGN, DESIGN);
      g.fillStyle = '#fff';
      layer.mask(g);
    }));
    blur(field, SIZE, Math.round((layer.bevel * k) / 1.7));
    for (let i = 0; i < h.length; i++) h[i] += field[i] * layer.amount;
  }
  if (grain > 0) {
    const { smooth } = getNoise();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) h[y * SIZE + x] += (smooth[noiseIndex(x, y, seed)] - 0.5) * grain;
    }
  }
  return h;
}

/** Converts a height field (in design-pixel units of height) to a tangent-space normal map. */
function normalMapFrom(h: Float32Array, strength: number): HTMLCanvasElement {
  const [canvas, g] = canvas2d(SIZE);
  const img = g.createImageData(SIZE, SIZE);
  const d = img.data;
  // Height is in "design pixels", gradients are per texel, so rescale.
  const s = strength * (SIZE / DESIGN);
  for (let y = 0; y < SIZE; y++) {
    const up = ((y - 1 + SIZE) % SIZE) * SIZE;
    const dn = ((y + 1) % SIZE) * SIZE;
    const row = y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      const l = (x - 1 + SIZE) % SIZE;
      const r = (x + 1) % SIZE;
      // Canvas rows run top-down while texture v runs bottom-up.
      const nx = (h[row + l] - h[row + r]) * s;
      const ny = (h[dn + x] - h[up + x]) * s;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (row + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** Multiplies a canvas by subtle low-frequency mottling and fine grain. */
function addGrain(canvas: HTMLCanvasElement, mottle: number, grain: number, seed: number): void {
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const noise = getNoise();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const n = noiseIndex(x, y, seed);
      const f = 1 + (noise.smooth[n] - 0.5) * mottle + (noise.grain[noiseIndex(x, y, seed + 5)] - 0.5) * grain;
      d[i] = Math.min(255, d[i] * f);
      d[i + 1] = Math.min(255, d[i + 1] * f);
      d[i + 2] = Math.min(255, d[i + 2] * f);
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------- drawing primitives ----------

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

export function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

interface TileStyle {
  grout: string;
  top: string;
  bottom: string;
  /** Inner rim light, kept subtle: the normal map supplies most of the bevel now. */
  highlight: string;
  shadow: string;
  inset: number;
  radius: number;
}

function tileRect(g: CanvasRenderingContext2D, t: TileStyle, grow = 0): void {
  roundRect(g, t.inset - grow, t.inset - grow, DESIGN - (t.inset - grow) * 2, DESIGN - (t.inset - grow) * 2, t.radius + grow);
}

/** A single chunky rounded tile with a contact shadow and soft inner highlight. */
function drawTile(g: CanvasRenderingContext2D, t: TileStyle): void {
  g.fillStyle = t.grout;
  g.fillRect(0, 0, DESIGN, DESIGN);
  // soft contact shadow into the grout
  g.save();
  g.filter = 'blur(3px)';
  g.translate(1.5, 3);
  tileRect(g, t, 1);
  g.fillStyle = t.shadow;
  g.fill();
  g.restore();

  tileRect(g, t);
  const grd = g.createLinearGradient(0, t.inset, 0, DESIGN - t.inset);
  grd.addColorStop(0, t.top);
  grd.addColorStop(1, t.bottom);
  g.fillStyle = grd;
  g.fill();

  g.save();
  tileRect(g, t);
  g.clip();
  g.strokeStyle = t.highlight;
  g.lineWidth = 4;
  g.filter = 'blur(1.5px)';
  roundRect(g, t.inset + 2.5, t.inset + 2.5, DESIGN - t.inset * 2 - 2, DESIGN - t.inset * 2 - 2, t.radius);
  g.stroke();
  g.restore();
}


/** Small deterministic PRNG so wear and scratches are identical on every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gray = (n: number) => `rgb(${n * 255},${n * 255},${n * 255})`;

/** A grayscale canvas with mottling, used for roughness and metalness channels. */
function grayCanvas(fn: Draw, mottle = 0, seed = 1): HTMLCanvasElement {
  const canvas = draw(fn);
  if (mottle > 0) addGrain(canvas, mottle, 0.06, seed);
  return canvas;
}

/**
 * Cavity occlusion from a height field: places lower than their blurred
 * surroundings (seams, recesses, the foot of a bolt) come out darker.
 */
function cavityAO(h: Float32Array, radius: number, strength: number): Float32Array {
  const soft = h.slice();
  blur(soft, SIZE, Math.max(1, Math.round((radius * SIZE) / DESIGN / 1.7)));
  const ao = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) ao[i] = 1 - Math.min(0.75, Math.max(0, (soft[i] - h[i]) * strength));
  return ao;
}

/** Packs occlusion (R), roughness (G) and metalness (B) into one texture, as three.js expects. */
function packORM(ao: Float32Array | null, rough: HTMLCanvasElement, metal: HTMLCanvasElement | number): HTMLCanvasElement {
  const [canvas, g] = canvas2d(SIZE);
  const img = g.createImageData(SIZE, SIZE);
  const d = img.data;
  const r = readGray(rough);
  const m = typeof metal === 'number' ? null : readGray(metal);
  const mConst = typeof metal === 'number' ? metal * 255 : 0;
  for (let i = 0; i < r.length; i++) {
    const o = i * 4;
    d[o] = ao ? ao[i] * 255 : 255;
    d[o + 1] = r[i] * 255;
    d[o + 2] = m ? m[i] * 255 : mConst;
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** Darkens an albedo canvas by an occlusion field, so seams read even in flat light. */
function bakeOcclusion(canvas: HTMLCanvasElement, ao: Float32Array, amount: number): void {
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < ao.length; i++) {
    const f = 1 - (1 - ao[i]) * amount;
    const o = i * 4;
    d[o] *= f;
    d[o + 1] *= f;
    d[o + 2] *= f;
  }
  g.putImageData(img, 0, 0);
}

/** Fine random scratches: short, mostly straight, a few long ones. */
function scratches(g: CanvasRenderingContext2D, count: number, color: string, alpha: number, seed: number, maxLen = 60): void {
  const r = rng(seed);
  g.save();
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = r() * DESIGN;
    const y = r() * DESIGN;
    const a = r() * Math.PI * 2;
    const len = (r() < 0.15 ? maxLen : maxLen * 0.3) * (0.3 + r());
    g.globalAlpha = alpha * (0.3 + r() * 0.7);
    g.lineWidth = 0.25 + r() * 0.5;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 4, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 4,
      x + Math.cos(a) * len, y + Math.sin(a) * len,
    );
    g.stroke();
  }
  g.restore();
}

/** Soft blotches: fingerprints, mop marks, faded stains. */
function smudges(g: CanvasRenderingContext2D, count: number, color: string, alpha: number, seed: number): void {
  const r = rng(seed);
  g.save();
  for (let i = 0; i < count; i++) {
    const x = r() * DESIGN;
    const y = r() * DESIGN;
    const rad = 10 + r() * 45;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    g.fillStyle = grd;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI);
    g.scale(1, 0.35 + r() * 0.5);
    g.translate(-x, -y);
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    g.restore();
  }
  g.restore();
}

/** Ragged chips where paint has flaked off, clustered along a rounded-rect outline. */
function chips(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, count: number, size: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const side = Math.floor(r() * 4);
    const t = r();
    const px = side === 0 ? x + t * w : side === 1 ? x + w : side === 2 ? x + t * w : x;
    const py = side === 0 ? y : side === 1 ? y + t * h : side === 2 ? y + h : y + t * h;
    const s = size * (0.3 + r() * r() * 1.4);
    g.beginPath();
    const n = 5 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rad = s * (0.5 + r() * 0.7);
      const cx = px + Math.cos(a) * rad * (side % 2 === 0 ? 1.8 : 0.8);
      const cy = py + Math.sin(a) * rad * (side % 2 === 0 ? 0.8 : 1.8);
      if (k === 0) g.moveTo(cx, cy);
      else g.lineTo(cx, cy);
    }
    g.closePath();
    g.fill();
  }
}

// ---------- texture sets ----------

export interface SurfaceMaps {
  map: Texture;
  normalMap: Texture;
  /** Occlusion (R), roughness (G), metalness (B). */
  roughnessMap: Texture;
  metalnessMap: Texture;
  aoMap: Texture;
}

export interface GameTextures {
  /** Shell of the portal device: panel seams, a trim stripe and fasteners. */
  gun: SurfaceMaps;
  white: SurfaceMaps;
  metal: SurfaceMaps;
  door: SurfaceMaps;
  cube: SurfaceMaps;
  cubeEmissive: Texture;
  button: ButtonMaps;
  goal: GoalMaps;
  all: Texture[];
}

/** Maps for the pressure plate: the fixed base ring and the moving cap. */
export interface ButtonMaps {
  base: SurfaceMaps;
  baseEmissive: Texture;
  cap: SurfaceMaps;
  capEmissive: Texture;
}

/** Maps for the exit pad's deck. */
export interface GoalMaps {
  pad: SurfaceMaps;
  padEmissive: Texture;
}

function surface(albedo: HTMLCanvasElement, normal: HTMLCanvasElement, orm: HTMLCanvasElement): SurfaceMaps {
  const packed = toTexture(orm, false);
  return { map: toTexture(albedo, true), normalMap: toTexture(normal, false), roughnessMap: packed, metalnessMap: packed, aoMap: packed };
}

export function createTextures(): GameTextures {
  // ----- Cream panels: portal-friendly glazed ceramic, one panel per world unit.
  const whiteStyle: TileStyle = {
    grout: '#6f685c', top: '#e4dbcc', bottom: '#dbd0bf',
    highlight: 'rgba(255,255,255,.28)', shadow: 'rgba(60,45,25,.5)', inset: 2.2, radius: 5,
  };
  const pins = [[17, 17], [DESIGN - 17, 17], [17, DESIGN - 17], [DESIGN - 17, DESIGN - 17]] as const;
  const whiteAlbedo = draw((g) => {
    drawTile(g, whiteStyle);
    g.save();
    tileRect(g, whiteStyle);
    g.clip();
    smudges(g, 9, 'rgba(120,96,70,.5)', 0.07, 101);
    smudges(g, 6, 'rgba(255,255,255,.8)', 0.08, 102);
    scratches(g, 70, '#4a4033', 0.09, 103);
    scratches(g, 30, '#ffffff', 0.18, 104, 40);
    // shallow stamped border, like a pressed panel
    g.strokeStyle = 'rgba(90,72,50,.16)';
    g.lineWidth = 1;
    roundRect(g, 9.5, 9.5, DESIGN - 19, DESIGN - 19, 5);
    g.stroke();
    g.restore();
    for (const [x, y] of pins) {
      circle(g, x, y, 3.2, '#8d8475');
      circle(g, x, y, 2.1, '#4c463d');
      circle(g, x - 0.6, y - 0.7, 0.7, 'rgba(255,255,255,.35)');
    }
  });
  addGrain(whiteAlbedo, 0.07, 0.03, 11);
  const whiteHeight = heightField([
    { mask: (g) => { tileRect(g, whiteStyle); g.fill(); }, bevel: 2.2, amount: 1.7 },
    { mask: (g) => { roundRect(g, 9.5, 9.5, DESIGN - 19, DESIGN - 19, 5); g.fill(); }, bevel: 1.2, amount: 0.25 },
    { mask: (g) => { for (const [x, y] of pins) circle(g, x, y, 2.6, '#fff'); }, bevel: 1, amount: -0.9 },
  ], 0.22, 12);
  const whiteAO = cavityAO(whiteHeight, 5, 0.55);
  bakeOcclusion(whiteAlbedo, whiteAO, 0.55);
  const white = surface(
    whiteAlbedo,
    normalMapFrom(whiteHeight, 1),
    packORM(whiteAO, grayCanvas((g) => {
      g.fillStyle = gray(0.92);
      g.fillRect(0, 0, DESIGN, DESIGN);
      tileRect(g, whiteStyle);
      g.fillStyle = gray(0.3);
      g.fill();
      g.save();
      tileRect(g, whiteStyle);
      g.clip();
      smudges(g, 14, 'rgba(255,255,255,.9)', 0.16, 105);
      scratches(g, 90, '#ffffff', 0.3, 103);
      g.restore();
      for (const [x, y] of pins) circle(g, x, y, 3.2, gray(0.55));
    }, 0.3, 13), 0),
  );

  // ----- Blue steel: portal-proof painted plate, one plate per two world units.
  const metalStyle: TileStyle = {
    grout: '#0b1119', top: '#4f6c96', bottom: '#415c84',
    highlight: 'rgba(170,205,255,.2)', shadow: 'rgba(0,0,0,.6)', inset: 2.6, radius: 7,
  };
  const bolts: Array<[number, number]> = [];
  for (const a of [13, DESIGN / 2, DESIGN - 13]) for (const b of [13, DESIGN / 2, DESIGN - 13]) {
    if (a !== DESIGN / 2 || b !== DESIGN / 2) bolts.push([a, b]);
  }
  const stamp = (g: CanvasRenderingContext2D) => roundRect(g, 26, 26, DESIGN - 52, DESIGN - 52, 9);
  const wear = (g: CanvasRenderingContext2D) => {
    chips(g, 4, 4, DESIGN - 8, DESIGN - 8, 30, 2.4, 201);
    chips(g, 26, 26, DESIGN - 52, DESIGN - 52, 14, 1.6, 202);
  };
  const metalAlbedo = draw((g) => {
    drawTile(g, metalStyle);
    g.save();
    tileRect(g, metalStyle);
    g.clip();
    // brushed streaks
    const r = rng(77);
    for (let i = 0; i < 420; i++) {
      g.globalAlpha = 0.02 + r() * 0.035;
      g.fillStyle = r() > 0.5 ? '#bcd3f2' : '#060d18';
      g.fillRect(r() * DESIGN - 40, r() * DESIGN, 30 + r() * 160, 0.25 + r() * 0.6);
    }
    g.globalAlpha = 1;
    smudges(g, 10, 'rgba(8,14,24,.9)', 0.16, 203);
    smudges(g, 5, 'rgba(150,180,220,.8)', 0.08, 204);
    // pressed inner panel
    g.strokeStyle = 'rgba(5,10,20,.55)';
    g.lineWidth = 1.6;
    stamp(g);
    g.stroke();
    g.strokeStyle = 'rgba(160,195,240,.22)';
    g.lineWidth = 0.8;
    roundRect(g, 27.4, 27.4, DESIGN - 54.8, DESIGN - 54.8, 8);
    g.stroke();
    // bare steel where the paint has chipped and scratched
    g.fillStyle = '#93a3b8';
    wear(g);
    scratches(g, 60, '#b9c8dc', 0.4, 205, 80);
    scratches(g, 50, '#050a12', 0.3, 206);
    g.restore();
    for (const [x, y] of bolts) {
      circle(g, x + 0.5, y + 1.1, 5.2, 'rgba(0,0,0,.5)');
      circle(g, x, y, 4.6, '#8a9bb2');
      circle(g, x, y, 3.3, '#6c7d95');
      g.strokeStyle = 'rgba(10,16,26,.8)';
      g.lineWidth = 0.9;
      g.beginPath();
      const a = hash(x, y, 9) * Math.PI;
      g.moveTo(x - Math.cos(a) * 2.6, y - Math.sin(a) * 2.6);
      g.lineTo(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6);
      g.stroke();
      circle(g, x - 1.3, y - 1.5, 1, 'rgba(255,255,255,.4)');
    }
  });
  addGrain(metalAlbedo, 0.12, 0.035, 21);
  const metalHeight = heightField([
    { mask: (g) => { tileRect(g, metalStyle); g.fill(); }, bevel: 2.6, amount: 2 },
    { mask: (g) => { stamp(g); g.fill(); }, bevel: 1.6, amount: -0.55 },
    { mask: (g) => { for (const [x, y] of bolts) circle(g, x, y, 4.4, '#fff'); }, bevel: 1.6, amount: 1.5 },
    { mask: wear, bevel: 0.6, amount: -0.18 },
  ], 0.3, 22);
  const metalAO = cavityAO(metalHeight, 6, 0.5);
  bakeOcclusion(metalAlbedo, metalAO, 0.6);
  const metal = surface(
    metalAlbedo,
    normalMapFrom(metalHeight, 1),
    packORM(
      metalAO,
      grayCanvas((g) => {
        g.fillStyle = gray(0.95);
        g.fillRect(0, 0, DESIGN, DESIGN);
        tileRect(g, metalStyle);
        g.fillStyle = gray(0.46);
        g.fill();
        g.save();
        tileRect(g, metalStyle);
        g.clip();
        const r = rng(78);
        for (let i = 0; i < 300; i++) {
          g.globalAlpha = 0.05 + r() * 0.08;
          g.fillStyle = r() > 0.5 ? '#fff' : '#000';
          g.fillRect(r() * DESIGN - 40, r() * DESIGN, 30 + r() * 160, 0.3 + r() * 0.8);
        }
        g.globalAlpha = 1;
        g.fillStyle = gray(0.56);
        wear(g);
        g.restore();
        for (const [x, y] of bolts) circle(g, x, y, 4.6, gray(0.36));
      }, 0.4, 23),
      grayCanvas((g) => {
        g.fillStyle = gray(0.2);
        g.fillRect(0, 0, DESIGN, DESIGN);
        tileRect(g, metalStyle);
        g.fillStyle = gray(0.32);
        g.fill();
        g.fillStyle = gray(1);
        wear(g);
        for (const [x, y] of bolts) circle(g, x, y, 4.6, gray(1));
      }),
    ),
  );

  // ----- Door: a heavy painted blast door. The texture maps once onto the 2 × 2.6 slab,
  // so everything is drawn in a space squeezed horizontally to keep circles round.
  const DOOR_W = DESIGN * (2 / 2.6);
  const squeeze = (g: CanvasRenderingContext2D, fn: Draw) => {
    g.save();
    g.scale(DESIGN / DOOR_W, 1);
    fn(g);
    g.restore();
  };
  const ribs = [70, 118, 166];
  const doorPlate = (g: CanvasRenderingContext2D) => roundRect(g, 9, 9, DOOR_W - 18, DESIGN - 18, 6);
  const doorRibs = (g: CanvasRenderingContext2D) => {
    for (const y of ribs) { roundRect(g, 18, y - 6, DOOR_W - 36, 12, 4); g.fill(); }
  };
  const doorBolts: Array<[number, number]> = [];
  for (let i = 0; i < 7; i++) {
    doorBolts.push([4.6, 16 + i * 37.3], [DOOR_W - 4.6, 16 + i * 37.3]);
  }
  for (let i = 1; i < 5; i++) doorBolts.push([i * (DOOR_W / 5), 4.6], [i * (DOOR_W / 5), DESIGN - 4.6]);
  const doorWear = (g: CanvasRenderingContext2D) => {
    chips(g, 9, 9, DOOR_W - 18, DESIGN - 18, 60, 2.4, 301);
    for (const y of ribs) chips(g, 18, y - 6, DOOR_W - 36, 12, 16, 1.5, 302 + y);
    chips(g, 14, DESIGN - 40, DOOR_W - 28, 26, 26, 2.2, 309);
  };
  const doorAlbedo = draw((g) => squeeze(g, (g) => {
    g.fillStyle = '#1b222d';
    g.fillRect(0, 0, DOOR_W, DESIGN);
    doorPlate(g);
    const grd = g.createLinearGradient(0, 0, 0, DESIGN);
    grd.addColorStop(0, '#e9b22c');
    grd.addColorStop(1, '#d09314');
    g.fillStyle = grd;
    g.fill();
    g.save();
    doorPlate(g);
    g.clip();
    // hazard band along the bottom
    g.fillStyle = '#141a24';
    for (let x = -60; x < DOOR_W + 60; x += 34) {
      g.beginPath();
      g.moveTo(x, DESIGN - 12);
      g.lineTo(x + 17, DESIGN - 12);
      g.lineTo(x + 43, DESIGN - 42);
      g.lineTo(x + 26, DESIGN - 42);
      g.fill();
    }
    g.fillRect(0, DESIGN - 44, DOOR_W, 2);
    // dark header with a stencilled label
    g.fillStyle = '#1d2531';
    g.fillRect(0, 9, DOOR_W, 30);
    g.fillStyle = '#e9b22c';
    g.font = '700 13px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CHAMBER LOCK', DOOR_W / 2, 20);
    g.font = '700 6.5px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    g.fillText('OPENS UNDER LOAD  ▲  KEEP CLEAR', DOOR_W / 2, 31.5);
    // raised ribs: lit above, shaded below
    for (const y of ribs) {
      g.fillStyle = 'rgba(255,240,190,.28)';
      g.fillRect(18, y - 6, DOOR_W - 36, 2);
      g.fillStyle = 'rgba(70,40,0,.4)';
      g.fillRect(18, y + 4.5, DOOR_W - 36, 2.5);
    }
    // centre seam
    g.fillStyle = 'rgba(40,24,0,.75)';
    g.fillRect(DOOR_W / 2 - 0.9, 39, 1.8, DESIGN - 83);
    smudges(g, 12, 'rgba(70,40,0,.9)', 0.16, 303);
    scratches(g, 80, '#3a2600', 0.3, 304, 70);
    g.fillStyle = '#5d6673';
    doorWear(g);
    g.restore();
    for (const [x, y] of doorBolts) {
      circle(g, x, y, 2.6, '#7d8898');
      circle(g, x - 0.6, y - 0.7, 0.8, 'rgba(255,255,255,.45)');
    }
  }));
  addGrain(doorAlbedo, 0.1, 0.035, 31);
  const doorHeight = heightField([
    { mask: (g) => squeeze(g, (g) => { doorPlate(g); g.fill(); }), bevel: 2.4, amount: 2.2 },
    { mask: (g) => squeeze(g, doorRibs), bevel: 2, amount: 1.6 },
    { mask: (g) => squeeze(g, (g) => g.fillRect(DOOR_W / 2 - 1.2, 39, 2.4, DESIGN - 83)), bevel: 1, amount: -1.2 },
    { mask: (g) => squeeze(g, (g) => { for (const [x, y] of doorBolts) circle(g, x, y, 2.6, '#fff'); }), bevel: 1, amount: 1 },
    { mask: (g) => squeeze(g, doorWear), bevel: 0.6, amount: -0.2 },
  ], 0.25, 32);
  const doorAO = cavityAO(doorHeight, 6, 0.5);
  bakeOcclusion(doorAlbedo, doorAO, 0.6);
  const door = surface(
    doorAlbedo,
    normalMapFrom(doorHeight, 1),
    packORM(
      doorAO,
      grayCanvas((g) => squeeze(g, (g) => {
        g.fillStyle = gray(0.5);
        g.fillRect(0, 0, DOOR_W, DESIGN);
        doorPlate(g);
        g.fillStyle = gray(0.42);
        g.fill();
        g.fillStyle = gray(0.3);
        doorWear(g);
      }), 0.45, 33),
      grayCanvas((g) => squeeze(g, (g) => {
        g.fillStyle = gray(0.9);
        g.fillRect(0, 0, DOOR_W, DESIGN);
        doorPlate(g);
        g.fillStyle = gray(0.12);
        g.fill();
        g.fillStyle = gray(1);
        doorWear(g);
        for (const [x, y] of doorBolts) circle(g, x, y, 2.6, gray(1));
      })),
    ),
  );

  // ----- Weighted crate face. The corners sit under the bumpers, so the
  // detail lives in a plus-shaped armour plate and the strips between them.
  const C = DESIGN / 2;
  const plate = (g: CanvasRenderingContext2D, inset = 0) => {
    const e = 13 + inset;
    const k = 76 + inset * 0.4;
    g.beginPath();
    g.moveTo(k, e); g.lineTo(DESIGN - k, e); g.lineTo(DESIGN - k, k - 10); g.lineTo(DESIGN - k + 10, k);
    g.lineTo(DESIGN - e, k); g.lineTo(DESIGN - e, DESIGN - k); g.lineTo(DESIGN - k + 10, DESIGN - k);
    g.lineTo(DESIGN - k, DESIGN - k + 10); g.lineTo(DESIGN - k, DESIGN - e); g.lineTo(k, DESIGN - e);
    g.lineTo(k, DESIGN - k + 10); g.lineTo(k - 10, DESIGN - k); g.lineTo(e, DESIGN - k); g.lineTo(e, k);
    g.lineTo(k - 10, k); g.lineTo(k, k - 10);
    g.closePath();
  };
  const housingBolts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return [C + Math.cos(a) * 50, C + Math.sin(a) * 50] as const;
  });
  const plateBolts = [[84, 22], [172, 22], [84, 234], [172, 234], [22, 84], [22, 172], [234, 84], [234, 172]] as const;
  const vents = (g: CanvasRenderingContext2D) => {
    for (let i = 0; i < 4; i++) { roundRect(g, 22, 104 + i * 13, 26, 6, 3); g.fill(); }
  };
  const seams = (g: CanvasRenderingContext2D) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.beginPath();
      g.moveTo(C + Math.cos(a) * 60, C + Math.sin(a) * 60);
      g.lineTo(C + Math.cos(a) * 92, C + Math.sin(a) * 92);
      g.stroke();
    }
    g.strokeRect(92, 40, 72, 0.01);
    g.strokeRect(92, 216, 72, 0.01);
  };
  const cubeAlbedo = draw((g) => {
    // gunmetal frame
    g.fillStyle = '#39414e';
    g.fillRect(0, 0, DESIGN, DESIGN);
    scratches(g, 50, '#aab4c2', 0.25, 400, 30);
    // armour plate
    plate(g);
    g.fillStyle = '#e9e0cf';
    g.fill();
    g.save();
    plate(g);
    g.clip();
    const sheen = g.createLinearGradient(0, 0, DESIGN, DESIGN);
    sheen.addColorStop(0, 'rgba(255,255,255,.14)');
    sheen.addColorStop(1, 'rgba(70,50,30,.14)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, DESIGN, DESIGN);
    smudges(g, 10, 'rgba(110,90,60,.8)', 0.1, 401);
    scratches(g, 90, '#5a4c3a', 0.2, 402);
    scratches(g, 30, '#ffffff', 0.3, 404, 36);
    // hazard strip along the top arm
    g.save();
    g.beginPath();
    g.rect(92, 20, 72, 13);
    g.clip();
    g.fillStyle = '#f2b824';
    g.fillRect(92, 20, 72, 13);
    g.fillStyle = '#23262e';
    for (let x = 80; x < 180; x += 12) {
      g.beginPath();
      g.moveTo(x, 33); g.lineTo(x + 6, 33); g.lineTo(x + 16, 20); g.lineTo(x + 10, 20);
      g.fill();
    }
    g.restore();
    // stencilled markings along the bottom arm
    g.fillStyle = 'rgba(42,46,56,.86)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 11px "Arial Narrow", Arial, sans-serif';
    g.fillText('LL-C7  ·  40 KG', C, 226);
    g.font = '600 5px Arial, sans-serif';
    g.fillText('WEIGHTED TEST CRATE  ·  DO NOT STACK', C, 237);
    // label plate on the right arm
    g.fillStyle = '#20242c';
    roundRect(g, 210, 104, 26, 48, 2);
    g.fill();
    g.fillStyle = '#d7dde6';
    const bars = rng(405);
    for (let y = 109; y < 134; y += 1.6 + bars() * 2.4) g.fillRect(214, y, 12, 0.6 + bars() * 1.2);
    g.fillStyle = '#2dc4b2';
    g.fillRect(229, 108, 3, 26);
    // panel seams
    g.strokeStyle = 'rgba(58,48,36,.7)';
    g.lineWidth = 1.5;
    seams(g);
    g.restore();
    // vents on the left arm
    g.fillStyle = '#14171c';
    vents(g);
    // core housing
    circle(g, C, C, 60, '#2a2f39');
    circle(g, C, C, 57, '#6f7885');
    circle(g, C, C, 42, '#22262e');
    circle(g, C, C, 38, '#39404b');
    circle(g, C, C, 33, '#ffd36b');
    g.strokeStyle = 'rgba(20,22,28,.6)';
    g.lineWidth = 0.8;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      g.beginPath();
      g.moveTo(C + Math.cos(a) * 43.5, C + Math.sin(a) * 43.5);
      g.lineTo(C + Math.cos(a) * 46.5, C + Math.sin(a) * 46.5);
      g.stroke();
    }
    for (const [x, y] of housingBolts) {
      circle(g, x, y, 3.4, '#262a32');
      circle(g, x, y, 2.5, '#9aa3b0');
      g.fillStyle = '#2b2f37';
      g.fillRect(x - 2, y - 0.4, 4, 0.8);
    }
    for (const [x, y] of plateBolts) {
      circle(g, x, y, 3, '#8b8373');
      circle(g, x, y, 2, '#4b463d');
      circle(g, x - 0.5, y - 0.6, 0.6, 'rgba(255,255,255,.4)');
    }
    // paint flaked off around the plate edge and the housing
    g.fillStyle = '#6a7380';
    chips(g, 13, 76, DESIGN - 26, DESIGN - 152, 26, 2.2, 403);
    chips(g, 76, 13, DESIGN - 152, DESIGN - 26, 26, 2.2, 406);
  });
  addGrain(cubeAlbedo, 0.08, 0.035, 41);
  const cubeHeight = heightField([
    { mask: (g) => { plate(g); g.fill(); }, bevel: 2.5, amount: 2 },
    { mask: (g) => { plate(g, 6); g.fill(); }, bevel: 1.5, amount: -0.5 },
    { mask: (g) => { plate(g, 8); g.fill(); }, bevel: 1.5, amount: 0.5 },
    { mask: (g) => { g.strokeStyle = '#fff'; g.lineWidth = 2; seams(g); }, bevel: 1, amount: -1.6 },
    { mask: vents, bevel: 1, amount: -2.4 },
    { mask: (g) => { roundRect(g, 210, 104, 26, 48, 2); g.fill(); }, bevel: 1, amount: 0.7 },
    { mask: (g) => circle(g, C, C, 60, '#fff'), bevel: 2, amount: 2.2 },
    { mask: (g) => circle(g, C, C, 42, '#fff'), bevel: 2, amount: -2.6 },
    { mask: (g) => circle(g, C, C, 38, '#fff'), bevel: 1.5, amount: 1 },
    { mask: (g) => circle(g, C, C, 33, '#fff'), bevel: 2, amount: -1 },
    { mask: (g) => { for (const [x, y] of housingBolts) circle(g, x, y, 3, '#fff'); }, bevel: 1, amount: 1.4 },
    { mask: (g) => { for (const [x, y] of plateBolts) circle(g, x, y, 2.8, '#fff'); }, bevel: 1, amount: 1.2 },
  ], 0.25, 42);
  const cubeAO = cavityAO(cubeHeight, 8, 0.4);
  bakeOcclusion(cubeAlbedo, cubeAO, 0.55);
  const cube = surface(
    cubeAlbedo,
    normalMapFrom(cubeHeight, 1.1),
    packORM(
      cubeAO,
      grayCanvas((g) => {
        g.fillStyle = gray(0.46);
        g.fillRect(0, 0, DESIGN, DESIGN);
        plate(g);
        g.fillStyle = gray(0.34);
        g.fill();
        g.fillStyle = gray(0.62);
        g.fillRect(92, 20, 72, 13);
        circle(g, C, C, 60, gray(0.28));
        circle(g, C, C, 42, gray(0.5));
        circle(g, C, C, 33, gray(0.1));
        g.fillStyle = gray(0.7);
        chips(g, 13, 76, DESIGN - 26, DESIGN - 152, 26, 2.2, 403);
        chips(g, 76, 13, DESIGN - 152, DESIGN - 26, 26, 2.2, 406);
      }, 0.4, 43),
      grayCanvas((g) => {
        g.fillStyle = gray(0.85);
        g.fillRect(0, 0, DESIGN, DESIGN);
        plate(g);
        g.fillStyle = gray(0.06);
        g.fill();
        circle(g, C, C, 60, gray(1));
        circle(g, C, C, 33, gray(0));
        g.fillStyle = gray(0.85);
        chips(g, 13, 76, DESIGN - 26, DESIGN - 152, 26, 2.2, 403);
        chips(g, 76, 13, DESIGN - 152, DESIGN - 26, 26, 2.2, 406);
      }),
    ),
  );

  const cubeEmissive = toTexture(draw((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, DESIGN, DESIGN);
    g.save();
    g.filter = 'blur(4px)';
    circle(g, C, C, 36, '#a86a00');
    g.restore();
    circle(g, C, C, 32, '#ffc23d');
    // status strip on the label plate
    g.fillStyle = '#ffc23d';
    for (let i = 0; i < 4; i++) g.fillRect(214, 138 + i * 3, 18, 1.4);
  }), true);

  // ----- Pressure plate. Both maps are discs that fill the square: the base
  // is seen as a ring around the cap, the cap is tinted red or green in game.
  const ringPath = (g: CanvasRenderingContext2D, r0: number, r1: number) => {
    g.beginPath();
    g.arc(C, C, r1, 0, Math.PI * 2);
    g.arc(C, C, r0, 0, Math.PI * 2, true);
  };
  const around = (n: number, r: number, offset = 0) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + offset;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r, a] as const;
  });
  /** Letters along an arc. They read from the middle of the disc, or from outside it with `outward`. */
  const arcText = (g: CanvasRenderingContext2D, text: string, r: number, mid: number, step: number, outward = false) => {
    const flip = Math.sin(mid) > 0 !== outward;
    [...text].forEach((ch, i) => {
      const a = mid + (i - (text.length - 1) / 2) * step * (flip ? -1 : 1);
      g.save();
      g.translate(C + Math.cos(a) * r, C + Math.sin(a) * r);
      g.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
      g.fillText(ch, 0, 0);
      g.restore();
    });
  };
  const baseBolts = around(16, 121, Math.PI / 16);
  const baseLeds = around(4, 107, Math.PI / 4);
  const ledSlot = (g: CanvasRenderingContext2D, grow = 0) => {
    for (const [x, y, a] of baseLeds) {
      g.save();
      g.translate(x, y);
      g.rotate(a + Math.PI / 2);
      roundRect(g, -9 - grow, -2.5 - grow, 18 + grow * 2, 5 + grow * 2, 2.5 + grow);
      g.fill();
      g.restore();
    }
  };
  const hazardArcs = (g: CanvasRenderingContext2D) => {
    for (const mid of [0, Math.PI]) {
      for (let i = -5; i < 5; i++) {
        const a0 = mid + i * 0.062;
        g.beginPath();
        g.arc(C, C, 113, a0 + 0.02, a0 + 0.051);
        g.arc(C, C, 101, a0 + 0.031, a0, true);
        g.closePath();
        g.fill();
      }
    }
  };
  const buttonBaseAlbedo = draw((g) => {
    g.fillStyle = '#566170';
    g.fillRect(0, 0, DESIGN, DESIGN);
    // lathe marks
    for (let r = 92; r < 128; r += 0.9) {
      g.strokeStyle = `rgba(${hash(r * 10, 3, 7) > 0.5 ? '255,255,255' : '10,14,20'},${0.03 + hash(r * 10, 5, 9) * 0.06})`;
      g.lineWidth = 0.5;
      g.beginPath();
      g.arc(C, C, r, 0, Math.PI * 2);
      g.stroke();
    }
    // painted warning band, striped at the sides, lettered front and back
    ringPath(g, 100, 114);
    g.fillStyle = '#e9b21f';
    g.fill('evenodd');
    g.fillStyle = '#23262e';
    hazardArcs(g);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 9px "Arial Narrow", Arial, sans-serif';
    arcText(g, 'PRESSURE PLATE', 107, -Math.PI / 2, 0.062);
    arcText(g, '40 KG MIN LOAD', 107, Math.PI / 2, 0.062);
    g.fillStyle = '#14171c';
    ledSlot(g, 1.6);
    g.fillStyle = '#d9dee6';
    ledSlot(g);
    g.save();
    ringPath(g, 92, 128);
    g.clip('evenodd');
    scratches(g, 160, '#dfe6ee', 0.22, 601, 26);
    scratches(g, 80, '#11151b', 0.3, 602, 40);
    smudges(g, 14, 'rgba(20,16,10,.9)', 0.12, 603);
    g.restore();
    for (const [x, y, a] of baseBolts) {
      circle(g, x, y, 3.6, '#22272f');
      circle(g, x, y, 2.7, '#a3acb9');
      g.save();
      g.translate(x, y);
      g.rotate(a * 3);
      g.fillStyle = '#2a2f38';
      g.fillRect(-2.1, -0.45, 4.2, 0.9);
      g.restore();
    }
    // paint worn off the band where boots scuff it
    const wear = rng(604);
    g.fillStyle = '#66717f';
    for (let i = 0; i < 70; i++) {
      const a = wear() * Math.PI * 2;
      const r = wear() > 0.5 ? 100 + wear() * 2.5 : 114 - wear() * 2.5;
      g.beginPath();
      g.ellipse(C + Math.cos(a) * r, C + Math.sin(a) * r, 0.6 + wear() * 2.4, 0.5 + wear() * 1.2, a + Math.PI / 2, 0, Math.PI * 2);
      g.fill();
    }
  });
  addGrain(buttonBaseAlbedo, 0.07, 0.03, 61);
  const buttonBaseHeight = heightField([
    { mask: (g) => circle(g, C, C, 126, '#fff'), bevel: 2, amount: 2 },
    { mask: (g) => { ringPath(g, 96, 98.5); g.fill('evenodd'); }, bevel: 1, amount: -2 },
    { mask: (g) => { ringPath(g, 115.5, 117); g.fill('evenodd'); }, bevel: 0.8, amount: -1.2 },
    { mask: (g) => ledSlot(g, 1.6), bevel: 1, amount: -1.6 },
    { mask: (g) => { for (const [x, y] of baseBolts) circle(g, x, y, 3.2, '#fff'); }, bevel: 1, amount: 1.6 },
  ], 0.2, 62);
  const buttonBaseAO = cavityAO(buttonBaseHeight, 6, 0.45);
  bakeOcclusion(buttonBaseAlbedo, buttonBaseAO, 0.6);
  const buttonBase = surface(
    buttonBaseAlbedo,
    normalMapFrom(buttonBaseHeight, 1.1),
    packORM(
      buttonBaseAO,
      grayCanvas((g) => {
        g.fillStyle = gray(0.34);
        g.fillRect(0, 0, DESIGN, DESIGN);
        ringPath(g, 100, 114);
        g.fillStyle = gray(0.6);
        g.fill('evenodd');
        g.fillStyle = gray(0.15);
        ledSlot(g);
      }, 0.45, 63),
      grayCanvas((g) => {
        g.fillStyle = gray(1);
        g.fillRect(0, 0, DESIGN, DESIGN);
        ringPath(g, 100, 114);
        g.fillStyle = gray(0.1);
        g.fill('evenodd');
        g.fillStyle = gray(0);
        ledSlot(g);
      }),
    ),
  );
  const buttonBaseEmissive = toTexture(draw((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, DESIGN, DESIGN);
    g.save();
    g.filter = 'blur(3px)';
    g.fillStyle = '#777';
    ledSlot(g, 2);
    g.restore();
    g.fillStyle = '#fff';
    ledSlot(g);
  }), true);

  const grips = around(40, 86);
  const gripMarks = (g: CanvasRenderingContext2D, w: number) => {
    for (const [x, y, a] of grips) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      roundRect(g, -11, -w / 2, 22, w, w / 2);
      g.fill();
      g.restore();
    }
  };
  const loadIcon = (g: CanvasRenderingContext2D) => {
    // a crate bearing down on a plate
    g.lineWidth = 3;
    g.lineJoin = 'miter';
    g.strokeRect(C - 11, C - 17, 22, 22);
    g.fillRect(C - 19, C + 11, 38, 3.4);
    g.beginPath();
    g.moveTo(C - 5, C - 9); g.lineTo(C, C - 3); g.lineTo(C + 5, C - 9);
    g.stroke();
  };
  const buttonCapAlbedo = draw((g) => {
    g.fillStyle = '#f4efee';
    g.fillRect(0, 0, DESIGN, DESIGN);
    const dome = g.createRadialGradient(C - 30, C - 40, 10, C, C, 128);
    dome.addColorStop(0, 'rgba(255,255,255,.5)');
    dome.addColorStop(1, 'rgba(120,110,110,.28)');
    g.fillStyle = dome;
    g.fillRect(0, 0, DESIGN, DESIGN);
    g.fillStyle = 'rgba(70,60,60,.5)';
    gripMarks(g, 4.4);
    g.strokeStyle = 'rgba(60,50,50,.55)';
    g.lineWidth = 1.6;
    for (const r of [118, 104, 66]) { g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); }
    // light ring and icon read as pale glass until they glow
    ringPath(g, 50, 58);
    g.fillStyle = '#fffdfa';
    g.fill('evenodd');
    g.fillStyle = g.strokeStyle = '#fffdfa';
    loadIcon(g);
    scratches(g, 220, '#4b4040', 0.2, 611, 34);
    scratches(g, 90, '#ffffff', 0.4, 612, 22);
    smudges(g, 12, 'rgba(60,45,45,.9)', 0.1, 613);
    // bare metal where the paint has chipped at the rim
    const wear = rng(614);
    g.fillStyle = '#8f8a8c';
    for (let i = 0; i < 90; i++) {
      const a = wear() * Math.PI * 2;
      const r = 127 - wear() * wear() * 12;
      g.beginPath();
      g.ellipse(C + Math.cos(a) * r, C + Math.sin(a) * r, 0.8 + wear() * 3.4, 0.5 + wear() * 1.4, a + Math.PI / 2, 0, Math.PI * 2);
      g.fill();
    }
  });
  addGrain(buttonCapAlbedo, 0.06, 0.03, 64);
  const buttonCapHeight = heightField([
    { mask: (g) => circle(g, C, C, 125, '#fff'), bevel: 3, amount: 2 },
    { mask: (g) => { ringPath(g, 117, 119); g.fill('evenodd'); }, bevel: 0.8, amount: -1.4 },
    { mask: (g) => { ringPath(g, 103, 105); g.fill('evenodd'); }, bevel: 0.8, amount: -1.4 },
    { mask: (g) => gripMarks(g, 4.4), bevel: 1, amount: 1.5 },
    { mask: (g) => circle(g, C, C, 66, '#fff'), bevel: 1.5, amount: -1.2 },
    { mask: (g) => { ringPath(g, 50, 58); g.fill('evenodd'); }, bevel: 1, amount: 0.9 },
  ], 0.2, 65);
  const buttonCapAO = cavityAO(buttonCapHeight, 6, 0.45);
  bakeOcclusion(buttonCapAlbedo, buttonCapAO, 0.6);
  const buttonCap = surface(
    buttonCapAlbedo,
    normalMapFrom(buttonCapHeight, 1.1),
    packORM(
      buttonCapAO,
      grayCanvas((g) => {
        g.fillStyle = gray(0.32);
        g.fillRect(0, 0, DESIGN, DESIGN);
        g.fillStyle = gray(0.6);
        gripMarks(g, 4.4);
        ringPath(g, 50, 58);
        g.fillStyle = gray(0.12);
        g.fill('evenodd');
      }, 0.45, 66),
      0.15,
    ),
  );
  const buttonCapEmissive = toTexture(draw((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, DESIGN, DESIGN);
    g.save();
    g.filter = 'blur(5px)';
    ringPath(g, 48, 60);
    g.fillStyle = '#666';
    g.fill('evenodd');
    g.restore();
    ringPath(g, 50, 58);
    g.fillStyle = '#fff';
    g.fill('evenodd');
    g.fillStyle = g.strokeStyle = '#fff';
    loadIcon(g);
  }), true);

  // ----- Exit pad: a disc that fills the square. Steel rim, lettered band,
  // segmented tread deck, and a glass emitter lens in the middle.
  const padBolts = around(12, 122, Math.PI / 12);
  const collarBolts = around(8, 40, Math.PI / 8);
  /** Radial joints between the twelve deck segments; `lit` keeps every other one. */
  const deckSeams = (g: CanvasRenderingContext2D, w: number, lit = false) => {
    g.lineWidth = w;
    g.lineCap = 'butt';
    for (let i = lit ? 1 : 0; i < 12; i += lit ? 2 : 1) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(C + Math.cos(a) * 50, C + Math.sin(a) * 50);
      g.lineTo(C + Math.cos(a) * 94, C + Math.sin(a) * 94);
      g.stroke();
    }
  };
  /** Anti-slip ribs: short arcs across each deck segment. */
  const treads = (g: CanvasRenderingContext2D, w: number) => {
    g.lineWidth = w;
    g.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      for (let r = 56; r <= 90; r += 5.6) {
        const inset = 3.4 / r;
        g.beginPath();
        g.arc(C, C, r, a0 + inset, a0 + Math.PI / 6 - inset);
        g.stroke();
      }
    }
  };
  /** Three inward-pointing chevrons at each of six stations on the band. */
  const padChevrons = (g: CanvasRenderingContext2D, w: number) => {
    g.lineWidth = w;
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    for (const mid of [0, Math.PI, Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      for (let k = -1; k <= 1; k++) {
        g.save();
        g.translate(C, C);
        g.rotate(mid + k * 0.085);
        g.beginPath();
        g.moveTo(110.5, -3.6); g.lineTo(104, 0); g.lineTo(110.5, 3.6);
        g.stroke();
        g.restore();
      }
    }
  };
  const lensRings = (g: CanvasRenderingContext2D, w: number) => {
    g.lineWidth = w;
    for (let r = 5; r < 32; r += 4.5) { g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); }
  };
  const fillRing = (g: CanvasRenderingContext2D, r0: number, r1: number, fill: string) => {
    ringPath(g, r0, r1);
    g.fillStyle = fill;
    g.fill('evenodd');
  };
  const goalAlbedo = draw((g) => {
    g.fillStyle = '#515b68';
    g.fillRect(0, 0, DESIGN, DESIGN);
    for (let r = 30; r < 128; r += 0.9) {
      g.strokeStyle = `rgba(${hash(r * 10, 3, 71) > 0.5 ? '255,255,255' : '10,14,20'},${0.03 + hash(r * 10, 5, 73) * 0.06})`;
      g.lineWidth = 0.5;
      g.beginPath();
      g.arc(C, C, r, 0, Math.PI * 2);
      g.stroke();
    }
    // lettered band
    fillRing(g, 100, 114, '#1a1f26');
    g.fillStyle = '#c9d2dc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 9px "Arial Narrow", Arial, sans-serif';
    arcText(g, 'CHAMBER EXIT', 107, -Math.PI / 2, 0.062, true);
    arcText(g, 'CHAMBER EXIT', 107, Math.PI / 2, 0.062, true);
    g.strokeStyle = '#e4f6ee';
    padChevrons(g, 1.8);
    // light channels read as pale glass until they glow
    fillRing(g, 96.5, 99.5, '#dff3ea');
    fillRing(g, 45.5, 47.5, '#dff3ea');
    // tread deck
    fillRing(g, 47.5, 96.5, '#262b33');
    g.strokeStyle = '#3d4551';
    treads(g, 2.6);
    g.strokeStyle = '#0c0f13';
    deckSeams(g, 2.4);
    g.strokeStyle = '#dff3ea';
    deckSeams(g, 1, true);
    // emitter lens
    const lens = g.createRadialGradient(C, C, 0, C, C, 33);
    lens.addColorStop(0, '#22413a');
    lens.addColorStop(1, '#0a1513');
    g.fillStyle = lens;
    g.beginPath(); g.arc(C, C, 33, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(190,255,225,.22)';
    lensRings(g, 0.8);
    g.save();
    ringPath(g, 33, 128);
    g.clip('evenodd');
    scratches(g, 260, '#dfe6ee', 0.2, 701, 30);
    scratches(g, 120, '#0b0e12', 0.3, 702, 44);
    smudges(g, 18, 'rgba(20,16,10,.9)', 0.14, 703);
    g.restore();
    // boots polish the ribs back to bare metal
    const wear = rng(704);
    g.fillStyle = 'rgba(132,143,157,.75)';
    for (let i = 0; i < 150; i++) {
      const a = wear() * Math.PI * 2;
      const r = 56 + Math.floor(wear() * 7) * 5.6;
      g.beginPath();
      g.ellipse(C + Math.cos(a) * r, C + Math.sin(a) * r, 0.8 + wear() * 3.2, 0.5 + wear() * 0.7, a + Math.PI / 2, 0, Math.PI * 2);
      g.fill();
    }
    for (const [list, size] of [[padBolts, 1], [collarBolts, 0.8]] as const) {
      for (const [x, y, a] of list) {
        circle(g, x, y, 3.6 * size, '#1f242b');
        circle(g, x, y, 2.7 * size, '#a3acb9');
        g.save();
        g.translate(x, y);
        g.rotate(a * 3);
        g.fillStyle = '#2a2f38';
        g.fillRect(-2.1 * size, -0.45, 4.2 * size, 0.9);
        g.restore();
      }
    }
  });
  addGrain(goalAlbedo, 0.07, 0.03, 71);
  const goalHeight = heightField([
    { mask: (g) => circle(g, C, C, 126, '#fff'), bevel: 2, amount: 2 },
    { mask: (g) => { ringPath(g, 100, 114); g.fill('evenodd'); }, bevel: 1, amount: -0.6 },
    { mask: (g) => { ringPath(g, 96.5, 99.5); g.fill('evenodd'); }, bevel: 0.8, amount: -1.5 },
    { mask: (g) => { ringPath(g, 47.5, 96.5); g.fill('evenodd'); }, bevel: 1.5, amount: -1.2 },
    { mask: (g) => { g.strokeStyle = '#fff'; treads(g, 2.6); }, bevel: 0.8, amount: 1.5 },
    { mask: (g) => { g.strokeStyle = '#fff'; deckSeams(g, 2.4); }, bevel: 0.8, amount: -1.6 },
    { mask: (g) => { ringPath(g, 34, 45.5); g.fill('evenodd'); }, bevel: 1.5, amount: 1.4 },
    { mask: (g) => circle(g, C, C, 33, '#fff'), bevel: 2, amount: -2 },
    { mask: (g) => { g.strokeStyle = '#fff'; lensRings(g, 1.2); }, bevel: 0.6, amount: 0.5 },
    { mask: (g) => { for (const [x, y] of padBolts) circle(g, x, y, 3.2, '#fff'); for (const [x, y] of collarBolts) circle(g, x, y, 2.6, '#fff'); }, bevel: 1, amount: 1.6 },
  ], 0.2, 72);
  const goalAO = cavityAO(goalHeight, 6, 0.45);
  bakeOcclusion(goalAlbedo, goalAO, 0.6);
  const goalPad = surface(
    goalAlbedo,
    normalMapFrom(goalHeight, 1.2),
    packORM(
      goalAO,
      grayCanvas((g) => {
        g.fillStyle = gray(0.34);
        g.fillRect(0, 0, DESIGN, DESIGN);
        fillRing(g, 100, 114, gray(0.55));
        fillRing(g, 47.5, 96.5, gray(0.72));
        g.strokeStyle = gray(0.46);
        treads(g, 2.6);
        fillRing(g, 96.5, 99.5, gray(0.14));
        fillRing(g, 45.5, 47.5, gray(0.14));
        circle(g, C, C, 33, gray(0.08));
      }, 0.45, 73),
      grayCanvas((g) => {
        g.fillStyle = gray(1);
        g.fillRect(0, 0, DESIGN, DESIGN);
        fillRing(g, 100, 114, gray(0.1));
        fillRing(g, 47.5, 96.5, gray(0.7));
        fillRing(g, 96.5, 99.5, gray(0));
        fillRing(g, 45.5, 47.5, gray(0));
        circle(g, C, C, 33, gray(0));
      }),
    ),
  );
  const goalEmissive = toTexture(draw((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, DESIGN, DESIGN);
    const lights = (soft: boolean) => {
      fillRing(g, 96.5 - (soft ? 1.5 : 0), 99.5 + (soft ? 1.5 : 0), soft ? '#666' : '#fff');
      fillRing(g, 45.5 - (soft ? 1.5 : 0), 47.5 + (soft ? 1.5 : 0), soft ? '#666' : '#fff');
      g.strokeStyle = soft ? '#555' : '#e8e8e8';
      padChevrons(g, soft ? 3 : 1.8);
      g.strokeStyle = soft ? '#555' : '#cfcfcf';
      deckSeams(g, soft ? 2.6 : 1, true);
    };
    g.save();
    g.filter = 'blur(3px)';
    lights(true);
    g.restore();
    lights(false);
    const lens = g.createRadialGradient(C, C, 0, C, C, 33);
    lens.addColorStop(0, '#ffffff');
    lens.addColorStop(0.35, '#9a9a9a');
    lens.addColorStop(1, '#2c2c2c');
    g.fillStyle = lens;
    g.beginPath(); g.arc(C, C, 33, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.5)';
    lensRings(g, 0.8);
  }), true);

  // ----- Portal device shell. Each face of the long body gets this once, stretched 2.5:1
  // along the barrel, so it is drawn in a space squeezed the other way.
  const GUN_W = DESIGN * 2.5;
  const gunSpace = (g: CanvasRenderingContext2D, fn: Draw) => {
    g.save();
    g.scale(DESIGN / GUN_W, 1);
    fn(g);
    g.restore();
  };
  const gunSeams = (g: CanvasRenderingContext2D) => {
    g.fillRect(GUN_W * 0.31, 0, 3, DESIGN);
    g.fillRect(GUN_W * 0.72, 0, 3, DESIGN);
    g.fillRect(0, 150, GUN_W, 2.5);
    roundRect(g, GUN_W * 0.37, 34, GUN_W * 0.29, 84, 10);
    g.lineWidth = 2.5;
    g.stroke();
  };
  const gunVents = (g: CanvasRenderingContext2D) => {
    for (let i = 0; i < 6; i++) { roundRect(g, GUN_W * 0.78 + i * 18, 52, 9, 62, 4); g.fill(); }
  };
  const gunScrews: Array<[number, number]> = [
    [22, 20], [GUN_W - 22, 20], [22, 132], [GUN_W - 22, 132], [GUN_W * 0.31 + 20, 20], [GUN_W * 0.72 - 18, 20],
  ];
  const gunAlbedo = draw((g) => gunSpace(g, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, DESIGN);
    grd.addColorStop(0, '#f0e8da');
    grd.addColorStop(1, '#e2d8c6');
    g.fillStyle = grd;
    g.fillRect(0, 0, GUN_W, DESIGN);
    // navy trim band with an accent line
    g.fillStyle = '#243653';
    g.fillRect(0, 172, GUN_W, 46);
    g.fillStyle = '#ff8c2a';
    g.fillRect(0, 222, GUN_W, 5);
    g.fillStyle = '#e9eef5';
    g.font = '700 26px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('LOOP LAB  ·  PD-02  ·  HANDHELD PORTAL DEVICE', 40, 196);
    g.fillStyle = 'rgba(40,50,70,.75)';
    g.font = '700 15px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    g.fillText('EMITTER', GUN_W * 0.78, 132);
    g.fillText('CAL 07 / 26', GUN_W * 0.39, 132);
    g.fillStyle = 'rgba(40,34,26,.7)';
    g.strokeStyle = 'rgba(40,34,26,.7)';
    gunSeams(g);
    g.fillStyle = '#15191f';
    gunVents(g);
    smudges(g, 16, 'rgba(90,70,45,.9)', 0.1, 601);
    scratches(g, 120, '#4a4033', 0.22, 602, 90);
    for (const [x, y] of gunScrews) {
      circle(g, x, y, 6, '#9aa5b5');
      circle(g, x, y, 3.4, '#4a5362');
      circle(g, x - 1.6, y - 1.8, 1.3, 'rgba(255,255,255,.5)');
    }
  }));
  addGrain(gunAlbedo, 0.06, 0.03, 61);
  const gunHeight = heightField([
    { mask: (g) => gunSpace(g, (g) => { g.strokeStyle = '#fff'; gunSeams(g); }), bevel: 1, amount: -1.4 },
    { mask: (g) => gunSpace(g, gunVents), bevel: 1, amount: -1.6 },
    { mask: (g) => gunSpace(g, (g) => g.fillRect(0, 172, GUN_W, 46)), bevel: 1.2, amount: 0.5 },
    { mask: (g) => gunSpace(g, (g) => { for (const [x, y] of gunScrews) circle(g, x, y, 5.5, '#fff'); }), bevel: 1.2, amount: 0.8 },
  ], 0.12, 62);
  const gunAO = cavityAO(gunHeight, 5, 0.6);
  bakeOcclusion(gunAlbedo, gunAO, 0.6);
  const gun = surface(
    gunAlbedo,
    normalMapFrom(gunHeight, 1),
    packORM(
      gunAO,
      grayCanvas((g) => gunSpace(g, (g) => {
        g.fillStyle = gray(0.3);
        g.fillRect(0, 0, GUN_W, DESIGN);
        g.fillStyle = gray(0.45);
        g.fillRect(0, 172, GUN_W, 46);
        smudges(g, 20, 'rgba(255,255,255,.9)', 0.2, 603);
        scratches(g, 120, '#ffffff', 0.4, 602, 90);
      }), 0.35, 63),
      grayCanvas((g) => gunSpace(g, (g) => {
        g.fillStyle = gray(0);
        g.fillRect(0, 0, GUN_W, DESIGN);
        for (const [x, y] of gunScrews) circle(g, x, y, 6, gray(1));
      })),
    ),
  );
  for (const t of [gun.map, gun.normalMap, gun.roughnessMap]) t.anisotropy = 8;

  const all = [white, metal, door, cube, buttonBase, buttonCap, goalPad].flatMap((s) => [s.map, s.normalMap, s.roughnessMap]);
  all.push(cubeEmissive, buttonBaseEmissive, buttonCapEmissive, goalEmissive);
  const button: ButtonMaps = { base: buttonBase, baseEmissive: buttonBaseEmissive, cap: buttonCap, capEmissive: buttonCapEmissive };
  const goal: GoalMaps = { pad: goalPad, padEmissive: goalEmissive };
  return { gun, white, metal, door, cube, cubeEmissive, button, goal, all };
}
