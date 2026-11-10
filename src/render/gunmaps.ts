import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { rng, type SurfaceMaps } from './textures';

const BW = 2048;
const BH = 1024;
/** Height of one armour band's strip of the sheet. */
const ROW = BH / 3;


function context(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d')!;
}

/** Panel layout per band: seam positions, an inset hatch, a vent bank. */
const BANDS = [
  { seams: [140, 620, 1130, 1500, 1900], hatch: [660, 70, 300, 200], vents: 1180 },
  { seams: [60, 520, 1010, 1420, 1800], hatch: [150, 80, 280, 180], vents: 1480 },
  { seams: [240, 760, 1090, 1560, 1960], hatch: [800, 90, 250, 170], vents: 300 },
] as const;

function seamPaths(g: CanvasRenderingContext2D): void {
  g.beginPath();
  BANDS.forEach((band, r) => {
    const y = r * ROW;
    for (const x of band.seams) {
      // each seam jogs sideways partway down
      g.moveTo(x, y); g.lineTo(x, y + ROW * 0.42); g.lineTo(x + 34, y + ROW * 0.58); g.lineTo(x + 34, y + ROW);
    }
    const [hx, hy, hw, hh] = band.hatch;
    g.roundRect(hx, y + hy, hw, hh, 22);
  });
  g.stroke();
}

function screwSpots(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  BANDS.forEach((band, r) => {
    const y = r * ROW;
    for (const x of band.seams) out.push([x - 26, y + 40], [x + 60, y + ROW - 40]);
    const [hx, hy, hw, hh] = band.hatch;
    out.push([hx + 24, y + hy + 24], [hx + hw - 24, y + hy + 24], [hx + 24, y + hy + hh - 24], [hx + hw - 24, y + hy + hh - 24]);
  });
  return out;
}

function ventSlots(g: CanvasRenderingContext2D): void {
  g.beginPath();
  BANDS.forEach((band, r) => {
    for (let i = 0; i < 8; i++) g.roundRect(band.vents + i * 26, r * ROW + 120, 12, 110, 6);
  });
  g.fill();
}

function scratches(g: CanvasRenderingContext2D, count: number, seed: number, style: (r: () => number) => string): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * BW;
    const y = r() * BH;
    const len = 20 + r() * 160;
    const a = (r() - 0.5) * 0.7;
    g.strokeStyle = style(r);
    g.lineWidth = 0.6 + r() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
}

function mottle(g: CanvasRenderingContext2D, count: number, seed: number, dark: string, light: string): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * BW;
    const y = r() * BH;
    const rad = 30 + r() * 140;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, r() < 0.5 ? dark : light);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/**
 * Maps for the portal device's armour. The three bands share one sheet, stacked
 * down it front to back; each wraps once around the arm.
 */
export function gunMaps(): SurfaceMaps {
  const screws = screwSpots();

  // --- height: grooves, sunken hatches, vents, screw heads, rolled edges
  const h = context(BW, BH);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, BW, BH);
  for (let r = 0; r < 3; r++) {
    h.fillStyle = '#909090';
    h.fillRect(0, r * ROW + 10, BW, 14);
    h.fillRect(0, (r + 1) * ROW - 24, BW, 14);
  }
  h.fillStyle = '#747474';
  BANDS.forEach((band, r) => { const [x, y, w, hh] = band.hatch; h.beginPath(); h.roundRect(x, r * ROW + y, w, hh, 22); h.fill(); });
  h.strokeStyle = '#2c2c2c';
  h.lineWidth = 6;
  seamPaths(h);
  h.fillStyle = '#262626';
  ventSlots(h);
  for (const [x, y] of screws) {
    h.fillStyle = '#5c5c5c'; h.beginPath(); h.arc(x, y, 12, 0, Math.PI * 2); h.fill();
    h.fillStyle = '#a4a4a4'; h.beginPath(); h.arc(x, y, 8.5, 0, Math.PI * 2); h.fill();
    h.fillStyle = '#505050'; h.fillRect(x - 7, y - 1.5, 14, 3);
  }
  scratches(h, 260, 11, () => '#787878');
  // soften so the bevels read as rounded, then turn slopes into normals
  const soft = context(BW, BH);
  soft.filter = 'blur(1.4px)';
  soft.drawImage(h.canvas, 0, 0);
  const src = soft.getImageData(0, 0, BW, BH).data;
  const n = context(BW, BH);
  const out = n.createImageData(BW, BH);
  const at = (x: number, y: number) => src[(((y + BH) % BH) * BW + ((x + BW) % BW)) * 4];
  const STRENGTH = 3.2 / 255;
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH;
    const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const i = (y * BW + x) * 4;
    out.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
    out.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
    out.data[i + 2] = (inv * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  n.putImageData(out, 0, 0);

  // --- albedo: glazed ceramic, paint, stencils, grime in the joints, wear
  const a = context(BW, BH);
  a.fillStyle = '#e6e4df';
  a.fillRect(0, 0, BW, BH);
  mottle(a, 90, 3, 'rgba(120,110,95,0.07)', 'rgba(255,255,255,0.08)');
  // graphite trim stripe with an accent pinstripe on the front band, hazard block on the middle one
  a.fillStyle = '#2b3038';
  a.fillRect(0, ROW - 92, BW, 58);
  a.fillStyle = '#e8762b';
  a.fillRect(0, ROW - 104, BW, 7);
  a.save();
  a.beginPath(); a.rect(1050, ROW + 60, 330, 44); a.clip();
  a.fillStyle = '#f0b21c'; a.fillRect(1050, ROW + 60, 330, 44);
  a.fillStyle = '#1c1e22';
  for (let i = -2; i < 12; i++) { a.beginPath(); a.moveTo(1050 + i * 40, ROW + 104); a.lineTo(1070 + i * 40, ROW + 104); a.lineTo(1114 + i * 40, ROW + 60); a.lineTo(1094 + i * 40, ROW + 60); a.fill(); }
  a.restore();
  // hatches are a shade greyer than the shell
  a.fillStyle = 'rgba(150,156,165,0.35)';
  BANDS.forEach((band, r) => { const [x, y, w, hh] = band.hatch; a.beginPath(); a.roundRect(x, r * ROW + y, w, hh, 22); a.fill(); });
  // stencils
  a.fillStyle = '#23272e';
  a.textBaseline = 'alphabetic';
  a.font = '700 120px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  a.fillText('07', 310, 200);
  a.font = '700 30px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  a.fillText('PORTAL DEVICE', 460, 130);
  a.fillText('MK III · ARM MOUNT', 460, 168);
  a.font = '600 19px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  a.fillText('FIELD EMITTER — KEEP APERTURE CLEAR', 310, 232);
  a.fillText('ACCESS · CELL A', 690, ROW * 0 + 100);
  a.fillText('COOLANT RETURN', 1180, 262);
  a.fillText('SERVICE 07 / 26', 180, ROW + 110);
  a.fillText('TORQUE 4 N·m', 180, ROW + 136);
  a.fillText('DO NOT OPEN WHILE CHARGED', 1050, ROW + 132);
  a.fillText('LATCH', 830, ROW * 2 + 120);
  a.font = '700 44px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  a.fillText('LOOP LAB', 480, ROW + 250);
  a.fillStyle = '#e8762b';
  a.fillRect(480, ROW + 264, 168, 6);
  // serial plate with a barcode
  a.fillStyle = '#f4f4f1'; a.fillRect(520, ROW * 2 + 180, 190, 80);
  a.strokeStyle = '#23272e'; a.lineWidth = 2; a.strokeRect(520, ROW * 2 + 180, 190, 80);
  a.fillStyle = '#16181c';
  const bars = rng(5);
  for (let x = 0; x < 170;) { const w = 2 + Math.floor(bars() * 5); a.fillRect(530 + x, ROW * 2 + 190, w, 42); x += w + 2 + Math.floor(bars() * 4); }
  a.font = '600 15px Arial, sans-serif';
  a.fillText('SN 0007-3C-LL', 530, ROW * 2 + 252);
  // arrows pointing at the muzzle
  for (let i = 0; i < 3; i++) { const x = 1620 + i * 44; a.beginPath(); a.moveTo(x, 150); a.lineTo(x + 16, 110); a.lineTo(x + 32, 150); a.lineTo(x + 16, 138); a.fill(); }
  // vents, joints with grime bleeding out of them, screws
  a.fillStyle = '#0c0d10';
  ventSlots(a);
  a.filter = 'blur(7px)';
  a.strokeStyle = 'rgba(70,58,44,0.35)'; a.lineWidth = 16; seamPaths(a);
  a.filter = 'none';
  a.strokeStyle = 'rgba(24,22,22,0.85)'; a.lineWidth = 4.5; seamPaths(a);
  for (const [x, y] of screws) {
    a.fillStyle = 'rgba(40,36,32,0.5)'; a.beginPath(); a.arc(x, y, 12.5, 0, Math.PI * 2); a.fill();
    const grad = a.createLinearGradient(x, y - 9, x, y + 9);
    grad.addColorStop(0, '#d6dbe2'); grad.addColorStop(1, '#7c838d');
    a.fillStyle = grad; a.beginPath(); a.arc(x, y, 8.5, 0, Math.PI * 2); a.fill();
    a.fillStyle = '#2a2d33'; a.fillRect(x - 7, y - 1.5, 14, 3);
  }
  // edge wear and fine scratches
  for (let r = 0; r < 3; r++) for (const y of [r * ROW, (r + 1) * ROW - 12]) {
    const grad = a.createLinearGradient(0, y, 0, y + 12);
    grad.addColorStop(0, 'rgba(60,54,48,0.35)'); grad.addColorStop(1, 'rgba(60,54,48,0)');
    a.fillStyle = grad; a.fillRect(0, y, BW, 12);
  }
  scratches(a, 260, 11, (r) => (r() < 0.6 ? 'rgba(255,255,255,0.35)' : 'rgba(60,55,50,0.3)'));

  // --- roughness: glossy glaze, matte paint, dull joints and scuffs
  const ro = context(BW, BH);
  ro.fillStyle = '#4a4a4a';
  ro.fillRect(0, 0, BW, BH);
  mottle(ro, 120, 9, 'rgba(0,0,0,0.12)', 'rgba(255,255,255,0.14)');
  ro.fillStyle = '#909090';
  ro.fillRect(0, ROW - 92, BW, 58);
  ro.fillRect(1050, ROW + 60, 330, 44);
  ro.strokeStyle = '#c8c8c8'; ro.lineWidth = 10; seamPaths(ro);
  ro.fillStyle = '#d0d0d0'; ventSlots(ro);
  for (const [x, y] of screws) { ro.fillStyle = '#383838'; ro.beginPath(); ro.arc(x, y, 8.5, 0, Math.PI * 2); ro.fill(); }
  scratches(ro, 260, 11, () => 'rgba(215,215,215,0.7)');
  scratches(ro, 500, 23, () => 'rgba(190,190,190,0.25)');

  // pack as occlusion (R, none baked), roughness (G), metalness (B, none: it is all glazed ceramic and paint)
  const packed = ro.getImageData(0, 0, BW, BH);
  for (let i = 0; i < packed.data.length; i += 4) {
    packed.data[i] = 255;
    packed.data[i + 2] = 0;
  }
  ro.putImageData(packed, 0, 0);

  const tex = (g: CanvasRenderingContext2D, srgb: boolean) => {
    const t = new CanvasTexture(g.canvas);
    t.wrapS = RepeatWrapping;
    t.anisotropy = 16;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  const orm = tex(ro, false);
  return { map: tex(a, true), normalMap: tex(n, false), roughnessMap: orm, metalnessMap: orm, aoMap: orm };
}

/** Wrist readout, portrait: white on black, tinted with the active portal colour. */
export function gunDisplayTexture(): CanvasTexture {
  const W = 512;
  const H = 768;
  const g = context(W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 4;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.font = '700 64px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.fillText('PD-07', 40, 96);
  g.font = '700 26px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.fillText('FIELD READY', 40, 136);
  g.textAlign = 'right';
  g.fillText('CELL 98%', W - 40, 70);
  g.textAlign = 'left';
  g.fillRect(40, 158, W - 80, 3);
  // aperture dial
  g.lineWidth = 5;
  g.beginPath(); g.arc(W / 2, 320, 108, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 16;
  g.beginPath(); g.arc(W / 2, 320, 84, -Math.PI / 2, Math.PI * 1.1); g.stroke();
  g.lineWidth = 3;
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    const r0 = i % 3 === 0 ? 118 : 124;
    g.beginPath(); g.moveTo(W / 2 + Math.cos(t) * r0, 320 + Math.sin(t) * r0); g.lineTo(W / 2 + Math.cos(t) * 134, 320 + Math.sin(t) * 134); g.stroke();
  }
  g.beginPath(); g.ellipse(W / 2, 320, 26, 40, 0, 0, Math.PI * 2); g.stroke();
  // charge bars
  for (let i = 0; i < 14; i++) { g.globalAlpha = i < 11 ? 1 : 0.25; g.fillRect(40 + i * 31, 486, 22, 44); }
  g.globalAlpha = 1;
  g.font = '700 22px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.fillText('CHARGE', 40, 566);
  g.textAlign = 'right'; g.fillText('11 / 14', W - 40, 566); g.textAlign = 'left';
  // field waveform
  g.lineWidth = 4;
  g.beginPath();
  for (let x = 0; x <= W - 80; x += 3) {
    const y = 650 + Math.sin(x * 0.07) * 34 * Math.sin(x * 0.0075);
    if (x === 0) g.moveTo(40 + x, y); else g.lineTo(40 + x, y);
  }
  g.stroke();
  g.globalAlpha = 0.5;
  g.fillRect(40, 716, W - 80, 2);
  g.globalAlpha = 1;
  const tex = new CanvasTexture(g.canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}
