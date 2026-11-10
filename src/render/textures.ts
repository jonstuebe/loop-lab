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
  all: Texture[];
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

  // ----- Companion-style cube face.
  const shell = (g: CanvasRenderingContext2D) => roundRect(g, 26, 26, DESIGN - 52, DESIGN - 52, 34);
  const cubeAlbedo = draw((g) => {
    g.fillStyle = '#27b3a6';
    g.fillRect(0, 0, DESIGN, DESIGN);
    g.fillStyle = '#1e958b';
    for (const [x, y] of [[0, 0], [DESIGN - 40, 0], [0, DESIGN - 40], [DESIGN - 40, DESIGN - 40]] as const) {
      roundRect(g, x + 4, y + 4, 32, 32, 10);
      g.fill();
    }
    shell(g);
    g.fillStyle = '#efe6d6';
    g.fill();
    g.save();
    shell(g);
    g.clip();
    smudges(g, 8, 'rgba(110,90,60,.8)', 0.1, 401);
    scratches(g, 60, '#5a4c3a', 0.2, 402);
    g.restore();
    // four cut lines radiating from the core housing
    g.strokeStyle = 'rgba(70,58,44,.55)';
    g.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.beginPath();
      g.moveTo(DESIGN / 2 + Math.cos(a) * 58, DESIGN / 2 + Math.sin(a) * 58);
      g.lineTo(DESIGN / 2 + Math.cos(a) * 112, DESIGN / 2 + Math.sin(a) * 112);
      g.stroke();
    }
    circle(g, DESIGN / 2, DESIGN / 2, 56, '#262038');
    circle(g, DESIGN / 2, DESIGN / 2, 47, '#3a3352');
    circle(g, DESIGN / 2, DESIGN / 2, 38, '#ffd36b');
    g.fillStyle = '#27b3a6';
    chips(g, 26, 26, DESIGN - 52, DESIGN - 52, 22, 2, 403);
  });
  addGrain(cubeAlbedo, 0.08, 0.035, 41);
  const cubeHeight = heightField([
    { mask: (g) => { shell(g); g.fill(); }, bevel: 4, amount: 2 },
    { mask: (g) => circle(g, DESIGN / 2, DESIGN / 2, 56, '#fff'), bevel: 3, amount: -2.4 },
    { mask: (g) => circle(g, DESIGN / 2, DESIGN / 2, 47, '#fff'), bevel: 2, amount: 1.2 },
    { mask: (g) => circle(g, DESIGN / 2, DESIGN / 2, 38, '#fff'), bevel: 2, amount: -1 },
  ], 0.25, 42);
  const cubeAO = cavityAO(cubeHeight, 8, 0.4);
  bakeOcclusion(cubeAlbedo, cubeAO, 0.5);
  const cube = surface(
    cubeAlbedo,
    normalMapFrom(cubeHeight, 1),
    packORM(
      cubeAO,
      grayCanvas((g) => {
        g.fillStyle = gray(0.5);
        g.fillRect(0, 0, DESIGN, DESIGN);
        shell(g);
        g.fillStyle = gray(0.36);
        g.fill();
        circle(g, DESIGN / 2, DESIGN / 2, 56, gray(0.3));
        circle(g, DESIGN / 2, DESIGN / 2, 38, gray(0.12));
      }, 0.4, 43),
      grayCanvas((g) => {
        g.fillStyle = gray(0.05);
        g.fillRect(0, 0, DESIGN, DESIGN);
        circle(g, DESIGN / 2, DESIGN / 2, 56, gray(0.9));
        circle(g, DESIGN / 2, DESIGN / 2, 38, gray(0));
      }),
    ),
  );

  const cubeEmissive = toTexture(draw((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, DESIGN, DESIGN);
    g.save();
    g.filter = 'blur(4px)';
    circle(g, DESIGN / 2, DESIGN / 2, 40, '#a86a00');
    g.restore();
    circle(g, DESIGN / 2, DESIGN / 2, 37, '#ffc23d');
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

  const all = [white, metal, door, cube].flatMap((s) => [s.map, s.normalMap, s.roughnessMap]);
  all.push(cubeEmissive);
  return { gun, white, metal, door, cube, cubeEmissive, all };
}
