import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { canvas2d, circle, rng, roundRect, valueNoise } from './textures';

const STENCIL = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function finish(canvas: HTMLCanvasElement, srgb = true): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return tex;
}

/**
 * World-space grime, sampled by every surface at two scales.
 * R = large soft blotches, G = wipe marks and smears, B = fine speckle and scuffs.
 * Tiles seamlessly so it can repeat across a whole chamber.
 */
export function createGrimeTexture(): Texture {
  const S = 512;
  const [canvas, g] = canvas2d(S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);

  // Smears and scuffs are drawn as strokes, repeated across the edges so they wrap.
  const r = rng(907);
  const wrapped = (fn: () => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.save();
      g.translate(ox, oy);
      fn();
      g.restore();
    }
  };
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI * 2;
    const len = 40 + r() * 160;
    const bend = (r() - 0.5) * 120;
    const width = 6 + r() * 26;
    const alpha = 0.05 + r() * 0.1;
    wrapped(() => {
      g.strokeStyle = `rgba(0,255,0,${alpha})`;
      g.lineWidth = width;
      g.filter = 'blur(5px)';
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
        x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    });
  }
  g.filter = 'none';
  for (let i = 0; i < 500; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI * 2;
    const len = 3 + r() * r() * 50;
    const alpha = 0.15 + r() * 0.5;
    wrapped(() => {
      g.strokeStyle = `rgba(0,0,255,${alpha})`;
      g.lineWidth = 0.5 + r() * 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    });
  }
  // fine speckle: thousands of soft dots, so no noise-grid pattern shows through
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,255,${0.15 + r() * 0.55})`;
    g.beginPath();
    g.arc(r() * S, r() * S, 0.4 + r() * r() * 2.6, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const blotch = valueNoise(x, y, S, 3, 51) * 0.45 + valueNoise(x, y, S, 7, 52) * 0.3 + valueNoise(x, y, S, 17, 53) * 0.17 +
        valueNoise(x, y, S, 41, 54) * 0.08;
      const cloud = valueNoise(x, y, S, 5, 61) * 0.6 + valueNoise(x, y, S, 13, 62) * 0.4;
      d[i] = Math.min(255, Math.max(0, (blotch - 0.5) * 1.9 + 0.5) * 255);
      d[i + 1] = Math.min(255, d[i + 1] * 0.75 + cloud * 150);
      d[i + 2] = Math.min(255, d[i + 2] * 0.8);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = finish(canvas, false);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/** A recessed ceiling strip light: dark housing, frosted diffuser, two hot tubes. 4:1. */
export function createLightStripTexture(): Texture {
  const W = 1024;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, W, H);
  // housing lip
  roundRect(g, 10, 10, W - 20, H - 20, 26);
  g.fillStyle = '#12161d';
  g.fill();
  // diffuser
  roundRect(g, 30, 30, W - 60, H - 60, 18);
  const grd = g.createLinearGradient(0, 30, 0, H - 30);
  grd.addColorStop(0, '#7f7a70');
  grd.addColorStop(0.5, '#c9c2b4');
  grd.addColorStop(1, '#7f7a70');
  g.fillStyle = grd;
  g.fill();
  g.save();
  roundRect(g, 30, 30, W - 60, H - 60, 18);
  g.clip();
  // tubes glowing through the frosted cover
  g.filter = 'blur(14px)';
  g.fillStyle = '#ffffff';
  g.fillRect(70, H * 0.36 - 9, W - 140, 18);
  g.fillRect(70, H * 0.64 - 9, W - 140, 18);
  g.filter = 'none';
  // prismatic ribs
  g.fillStyle = 'rgba(0,0,0,.1)';
  for (let x = 30; x < W - 30; x += 12) g.fillRect(x, 30, 2, H - 60);
  // end caps fall off
  const cap = g.createLinearGradient(30, 0, W - 30, 0);
  cap.addColorStop(0, 'rgba(0,0,0,.55)');
  cap.addColorStop(0.06, 'rgba(0,0,0,0)');
  cap.addColorStop(0.94, 'rgba(0,0,0,0)');
  cap.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = cap;
  g.fillRect(30, 30, W - 60, H - 60);
  g.restore();
  for (const x of [20, W - 20]) for (const y of [20, H - 20]) circle(g, x, y, 4, '#2b313b');
  return finish(canvas);
}

/** Erases random specks and scuffs so paint looks sprayed on and worn. */
function weather(g: CanvasRenderingContext2D, w: number, h: number, seed: number, amount: number): void {
  const r = rng(seed);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600 * amount; i++) {
    g.globalAlpha = 0.25 + r() * 0.6;
    const s = 0.6 + r() * r() * 5;
    g.fillRect(r() * w, r() * h, s, s * (0.4 + r()));
  }
  g.lineCap = 'round';
  for (let i = 0; i < 60 * amount; i++) {
    g.globalAlpha = 0.3 + r() * 0.5;
    g.lineWidth = 0.6 + r() * 2.4;
    const x = r() * w;
    const y = r() * h;
    const a = (r() - 0.5) * 0.7;
    const len = 20 + r() * 160;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // soft overall fade in patches
  for (let i = 0; i < 12 * amount; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 40 + r() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(0,0,0,.4)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 1;
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.restore();
}

const signCache = new Map<string, CanvasTexture>();

/**
 * The big stencilled chamber number painted on a wall near the entrance. 2:1.
 * `light` picks pale paint (for dark steel) or dark paint (for cream panels).
 */
export function chamberSignTexture(index: number, total: number, name: string, light: boolean): Texture {
  const key = `${index}:${light}`;
  const cached = signCache.get(key);
  if (cached) return cached;
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const ink = light ? '#e9eef5' : '#27313f';
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textBaseline = 'alphabetic';

  const num = String(index + 1).padStart(2, '0');
  g.font = `700 400px ${STENCIL}`;
  g.fillText(num, 28, 400);
  const numW = g.measureText(num).width;
  // stencil bridges across the digits
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(0, 236, numW + 60, 9);
  g.fillRect(28 + numW * 0.27, 60, 8, 380);
  g.fillRect(28 + numW * 0.77, 60, 8, 380);
  g.restore();

  const x = Math.min(numW + 78, 500);
  g.fillRect(x, 108, 8, 292);
  g.font = `700 54px ${STENCIL}`;
  g.fillText('TEST CHAMBER', x + 34, 160);
  g.font = `700 92px ${STENCIL}`;
  g.fillText(name.toUpperCase(), x + 34, 258, W - x - 60);
  // progress pips
  for (let i = 0; i < total; i++) {
    const px = x + 34 + i * 46;
    if (i <= index) g.fillRect(px, 296, 32, 32);
    else { g.lineWidth = 5; g.strokeRect(px + 2.5, 298.5, 27, 27); }
  }
  g.font = `700 30px ${STENCIL}`;
  g.fillText(`LOOP LAB  ·  SECTOR ${String.fromCharCode(65 + (index % 6))}  ·  ${num}/${String(total).padStart(2, '0')}`, x + 34, 388);
  // corner ticks
  g.lineWidth = 6;
  for (const [cx, cy, sx, sy] of [[14, 40, 1, 1], [W - 14, 40, -1, 1], [14, H - 40, 1, -1], [W - 14, H - 40, -1, -1]] as const) {
    g.beginPath();
    g.moveTo(cx + sx * 44, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + sy * 44);
    g.stroke();
  }
  weather(g, W, H, 500 + index, 1);
  const tex = finish(canvas);
  signCache.set(key, tex);
  return tex;
}

function square(size: number, fn: (g: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  fn(canvas.getContext('2d')!, size);
  return finish(canvas);
}

function screws(g: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>, r: number): void {
  for (const [x, y] of pts) {
    circle(g, x + 1, y + 2, r + 1, 'rgba(0,0,0,.5)');
    circle(g, x, y, r, '#8794a6');
    g.strokeStyle = '#2a323e';
    g.lineWidth = r * 0.3;
    g.beginPath();
    g.moveTo(x - r * 0.6, y - r * 0.3);
    g.lineTo(x + r * 0.6, y + r * 0.3);
    g.stroke();
    circle(g, x - r * 0.3, y - r * 0.35, r * 0.22, 'rgba(255,255,255,.5)');
  }
}

/** Small set pieces bolted or painted onto steel walls. */
export function createGreebleTextures(): Texture[] {
  const vent = square(512, (g, s) => {
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 8;
    roundRect(g, 40, 90, s - 80, s - 180, 22);
    g.fillStyle = '#4b5a70';
    g.fill();
    g.shadowColor = 'transparent';
    roundRect(g, 66, 116, s - 132, s - 232, 10);
    g.fillStyle = '#07090d';
    g.fill();
    g.save();
    roundRect(g, 66, 116, s - 132, s - 232, 10);
    g.clip();
    for (let y = 124; y < s - 116; y += 30) {
      const grd = g.createLinearGradient(0, y, 0, y + 22);
      grd.addColorStop(0, '#7c8ba1');
      grd.addColorStop(0.5, '#3d4a5d');
      grd.addColorStop(1, '#141a23');
      g.fillStyle = grd;
      g.fillRect(66, y, s - 132, 20);
    }
    g.restore();
    g.strokeStyle = 'rgba(180,205,240,.35)';
    g.lineWidth = 2;
    roundRect(g, 41, 91, s - 82, s - 182, 22);
    g.stroke();
    screws(g, [[58, 108], [s - 58, 108], [58, s - 108], [s - 58, s - 108]], 7);
  });

  const caution = square(512, (g, s) => {
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 4;
    roundRect(g, 60, 130, s - 120, s - 260, 12);
    g.fillStyle = '#e4ac22';
    g.fill();
    g.shadowColor = 'transparent';
    g.save();
    roundRect(g, 60, 130, s - 120, s - 260, 12);
    g.clip();
    g.fillStyle = '#141a24';
    for (let x = 20; x < s; x += 44) {
      g.beginPath();
      g.moveTo(x, 130);
      g.lineTo(x + 22, 130);
      g.lineTo(x + 2, 164);
      g.lineTo(x - 20, 164);
      g.fill();
    }
    g.restore();
    // warning triangle
    g.fillStyle = '#141a24';
    g.beginPath();
    g.moveTo(134, 196);
    g.lineTo(190, 300);
    g.lineTo(78, 300);
    g.closePath();
    g.fill();
    g.fillStyle = '#e4ac22';
    g.fillRect(129, 228, 10, 40);
    g.fillRect(129, 276, 10, 10);
    g.fillStyle = '#141a24';
    g.font = `700 56px ${STENCIL}`;
    g.fillText('CAUTION', 212, 246);
    g.font = `700 25px ${STENCIL}`;
    g.fillText('PORTAL-PROOF PLATING', 212, 284);
    g.fillText('DO NOT DISCHARGE', 212, 316);
    g.font = `700 18px ${STENCIL}`;
    g.fillText('LL-7731 / REV C / INSPECTED', 82, 356);
    weather(g, s, s, 611, 0.5);
    screws(g, [[76, 180], [s - 76, 180], [76, s - 146], [s - 76, s - 146]], 5);
  });

  const code = square(512, (g, s) => {
    g.fillStyle = '#dfe6ef';
    g.strokeStyle = '#dfe6ef';
    g.font = `700 190px ${STENCIL}`;
    g.textAlign = 'center';
    g.fillText('B-12', s / 2, 300);
    g.fillRect(70, 336, s - 140, 10);
    g.font = `700 40px ${STENCIL}`;
    g.fillText('SERVICE ACCESS  ▸▸▸', s / 2, 400);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(0, 222, s, 8);
    g.restore();
    weather(g, s, s, 612, 1.1);
  });

  const junction = square(512, (g, s) => {
    // conduit running off the top
    const pipe = g.createLinearGradient(226, 0, 286, 0);
    pipe.addColorStop(0, '#1b222c');
    pipe.addColorStop(0.35, '#8d9bb0');
    pipe.addColorStop(1, '#1b222c');
    g.fillStyle = pipe;
    g.fillRect(226, 0, 60, 170);
    g.fillStyle = '#39455a';
    g.fillRect(214, 132, 84, 26);
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 20;
    g.shadowOffsetY = 10;
    roundRect(g, 120, 160, s - 240, 280, 16);
    const body = g.createLinearGradient(0, 160, 0, 440);
    body.addColorStop(0, '#5d6c82');
    body.addColorStop(1, '#3a4658');
    g.fillStyle = body;
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 3;
    roundRect(g, 146, 186, s - 292, 228, 8);
    g.stroke();
    g.strokeStyle = 'rgba(190,210,240,.3)';
    g.lineWidth = 2;
    roundRect(g, 121, 161, s - 242, 278, 16);
    g.stroke();
    g.fillStyle = '#e4ac22';
    g.fillRect(170, 214, 90, 34);
    g.fillStyle = '#141a24';
    g.font = `700 22px ${STENCIL}`;
    g.fillText('480V', 188, 240);
    circle(g, 330, 232, 12, '#0c1016');
    circle(g, 330, 232, 8, '#49e39a');
    circle(g, 327, 229, 3, 'rgba(255,255,255,.7)');
    g.fillStyle = 'rgba(0,0,0,.45)';
    for (let y = 290; y < 390; y += 16) g.fillRect(176, y, s - 352, 6);
    screws(g, [[140, 180], [s - 140, 180], [140, 420], [s - 140, 420]], 6);
  });

  return [vent, caution, code, junction];
}
