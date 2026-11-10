// PROTOTYPE — throwaway. Four alternative portal guns, switchable in the dev
// build with `?gun=A|B|C|D` (or `0` for the current one) and the `[` / `]` keys.
// Question: what should the portal gun look like? Not for main.
import {
  type BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, Group, LatheGeometry, type Material, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, type MeshStandardMaterialParameters, type Object3D, PlaneGeometry, RepeatWrapping, SphereGeometry,
  SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import { BLUE } from '../config';
import { springStep, type Spring } from '../world/props';
import { roundedBoxGeometry } from './geometry';
import { Gun } from './gun';
import type { SurfaceMaps } from './textures';

/** What the game needs from a view-model gun. */
export interface PortalGun {
  readonly group: Group;
  readonly materials: Material[];
  fire(color: number): void;
  tipWorldPosition(target: Vector3): Vector3;
  animate(dt: number, groundSpeed: number, dip: number): void;
}

const GLOW = 3.2;

/** Shared juice only (recoil, bob, recolouring). Each variant builds its own shape. */
abstract class ProtoGun implements PortalGun {
  readonly group = new Group();
  protected readonly rest = new Vector3(0.21, -0.2, -0.42);
  protected tip: Object3D = this.group;
  protected readonly recoil: Spring = { x: 0, v: 0 };
  protected flash = 0;
  protected time = 0;
  protected kick = 3.2;
  private readonly lit: Array<{ mat: MeshBasicMaterial; base: number; boost: number }> = [];
  private readonly pbr: Material[] = [];
  private color = BLUE;
  private bob = 0;

  protected std(p: MeshStandardMaterialParameters): MeshStandardMaterial {
    const m = new MeshStandardMaterial(p);
    this.pbr.push(m);
    return m;
  }

  protected ceramic(color = 0xe8ebee): MeshPhysicalMaterial {
    const m = new MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 1 });
    this.pbr.push(m);
    return m;
  }

  protected glass(): MeshPhysicalMaterial {
    const m = new MeshPhysicalMaterial({
      color: 0xd7ebff, roughness: 0.03, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6,
      depthWrite: false,
    });
    this.pbr.push(m);
    return m;
  }

  protected dark = () => this.std({ color: 0x23272e, roughness: 0.42, metalness: 0.85 });
  protected steel = () => this.std({ color: 0xaab3bf, roughness: 0.26, metalness: 1, envMapIntensity: 0.8 });
  protected copper = () => this.std({ color: 0xc8793f, roughness: 0.32, metalness: 1, envMapIntensity: 0.9 });
  protected rubber = () => this.std({ color: 0x121419, roughness: 0.8, envMapIntensity: 0.5 });

  /** A lit part in the active portal colour; `boost` is how much hotter it burns on a shot. */
  protected glow(base = GLOW, boost = 0): MeshBasicMaterial {
    const mat = new MeshBasicMaterial({ color: new Color(BLUE).multiplyScalar(base) });
    this.lit.push({ mat, base, boost });
    return mat;
  }

  protected add(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0, parent: Object3D = this.group): Mesh {
    const mesh = new Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** A cylinder lying along the barrel; `front` and `back` are its radii at each end. */
  protected tube(front: number, back: number, length: number, mat: Material, z: number, y = 0, parent: Object3D = this.group, open = false): Mesh {
    const mesh = this.add(new CylinderGeometry(back, front, length, 40, 1, open), mat, 0, y, z, parent);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  protected halo(parent: Object3D, radius: number): void {
    parent.add(new Mesh(new SphereGeometry(radius, 24, 16), new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false,
    })));
  }

  protected grip(z: number, y = -0.105): void {
    this.add(roundedBoxGeometry(0.042, 0.115, 0.052, 0.014, 4), this.rubber(), 0, y, z).rotation.x = -0.3;
  }

  get materials(): Material[] {
    return this.pbr;
  }

  fire(color: number): void {
    this.color = color;
    this.flash = 1;
    this.recoil.v += this.kick;
    this.onFire();
  }

  tipWorldPosition(target: Vector3): Vector3 {
    return this.tip.getWorldPosition(target);
  }

  animate(dt: number, groundSpeed: number, dip: number): void {
    this.time += dt;
    springStep(this.recoil, 0, 180, 10, dt);
    if (groundSpeed > 0.5) this.bob += dt * groundSpeed * 1.8;
    const r = this.recoil.x;
    this.group.position.set(
      this.rest.x + Math.sin(this.bob) * 0.01,
      this.rest.y + Math.abs(Math.cos(this.bob)) * 0.01 - r * 0.012 - dip * 0.25,
      this.rest.z + r * 0.05,
    );
    this.group.rotation.x = r * 0.18;
    this.flash *= Math.exp(-7 * dt);
    for (const l of this.lit) l.mat.color.setHex(this.color).multiplyScalar(l.base * (1 + this.flash * l.boost));
    this.tick(dt, r);
  }

  protected onFire(): void {}
  protected abstract tick(dt: number, recoil: number): void;
}

/**
 * A — Tuning fork. No barrel: two long ceramic rails with the charge hanging in
 * the open gap between them. Rails ring like a struck fork on each shot and
 * the guide rings shuttle down the gap.
 */
class ForkGun extends ProtoGun {
  private readonly rails: Group[] = [];
  private readonly beads: Mesh[] = [];
  private readonly orb: Mesh;
  private pulse = 1;

  constructor() {
    super();
    const white = this.ceramic();
    const dark = this.dark();
    const steel = this.steel();
    const copper = this.copper();
    const strip = this.glow(GLOW, 1.5);
    const core = this.glow(GLOW * 1.6, 1.5);

    // slim receiver and the yoke the rails spring from
    this.add(roundedBoxGeometry(0.066, 0.07, 0.17, 0.016, 5), white, 0, 0, 0.075);
    this.add(roundedBoxGeometry(0.05, 0.03, 0.2, 0.01, 3), dark, 0, -0.045, 0.06);
    this.add(roundedBoxGeometry(0.112, 0.056, 0.05, 0.012, 4), dark, 0, 0, -0.03);
    this.add(roundedBoxGeometry(0.02, 0.008, 0.13, 0.003, 2), strip, 0, 0.036, 0.075);
    this.add(new TorusGeometry(0.02, 0.003, 10, 40), strip, 0, 0, 0.162);
    for (const side of [-1, 1]) {
      const cap = this.add(new CylinderGeometry(0.011, 0.011, 0.09, 20), copper, side * 0.042, -0.012, 0.06);
      cap.rotation.x = Math.PI / 2;
    }
    this.grip(0.11);
    this.add(roundedBoxGeometry(0.01, 0.03, 0.012, 0.003, 2), steel, 0, -0.07, 0.055).rotation.x = 0.35;

    // the two rails: ceramic outside, steel liner and a lit edge inside
    for (const side of [-1, 1]) {
      const rail = new Group();
      rail.position.set(side * 0.042, 0, -0.03);
      this.add(roundedBoxGeometry(0.014, 0.036, 0.31, 0.005, 3), white, 0, 0, -0.155, rail);
      this.add(roundedBoxGeometry(0.004, 0.026, 0.29, 0.0015, 1), steel, -side * 0.008, 0, -0.155, rail);
      this.add(roundedBoxGeometry(0.003, 0.005, 0.27, 0.0012, 1), strip, -side * 0.0105, 0, -0.16, rail);
      this.add(roundedBoxGeometry(0.018, 0.042, 0.018, 0.004, 2), dark, 0, 0, -0.305, rail);
      this.group.add(rail);
      this.rails.push(rail);
    }

    // guide rings and the charge floating in the gap
    for (let i = 0; i < 3; i++) this.beads.push(this.add(new TorusGeometry(0.019, 0.0028, 10, 36), copper, 0, 0, -0.09 - i * 0.055));
    this.orb = this.add(new SphereGeometry(0.017, 24, 16), core, 0, 0, -0.3);
    this.halo(this.orb, 0.028);
    this.tip = this.orb;
  }

  protected override onFire(): void {
    this.pulse = 0;
  }

  protected tick(dt: number): void {
    const ring = Math.sin(this.time * 95) * this.flash * 0.004;
    this.rails[0].position.x = -0.042 - ring;
    this.rails[1].position.x = 0.042 + ring;
    this.pulse = Math.min(1, this.pulse + dt * 3.5);
    this.beads.forEach((bead, i) => {
      // each ring shoots forward in turn, then drifts home
      const t = Math.max(0, Math.min(1, this.pulse * 1.6 - i * 0.2));
      bead.position.z = -0.09 - i * 0.055 - Math.sin(t * Math.PI) * 0.045;
      bead.rotation.z += dt * (1 + i);
    });
    this.orb.position.y = Math.sin(this.time * 2.3) * 0.004;
    this.orb.scale.setScalar(1 + this.flash * 0.9 + Math.sin(this.time * 6) * 0.04);
  }
}

/**
 * B — Gyro. A stubby pistol holding a caged star: the core sits in three nested
 * gimbal rings that tumble lazily and whip round on each shot.
 */
class GyroGun extends ProtoGun {
  private readonly rings: Group[] = [];
  private readonly core: Mesh;
  private spin = 0;

  constructor() {
    super();
    this.rest.set(0.22, -0.19, -0.44);
    const white = this.ceramic();
    const dark = this.dark();
    const steel = this.steel();
    const copper = this.copper();
    const strip = this.glow();
    const coreMat = this.glow(GLOW * 1.6, 2.4);

    // short body and grip
    this.add(roundedBoxGeometry(0.07, 0.066, 0.12, 0.018, 5), white, 0, 0, 0.1);
    this.tube(0.03, 0.036, 0.05, dark, 0.02);
    this.tube(0.02, 0.02, 0.012, steel, 0.166);
    for (let i = 0; i < 3; i++) this.add(new SphereGeometry(0.0045, 12, 8), strip, -0.016 + i * 0.016, 0.035, 0.125);
    this.grip(0.13);
    this.add(roundedBoxGeometry(0.01, 0.03, 0.012, 0.003, 2), steel, 0, -0.065, 0.075).rotation.x = 0.35;

    // U-shaped yoke carrying the outer ring's pivots
    const CZ = -0.12;
    this.add(roundedBoxGeometry(0.206, 0.03, 0.03, 0.009, 3), dark, 0, 0, -0.012);
    for (const side of [-1, 1]) {
      this.add(roundedBoxGeometry(0.014, 0.03, 0.13, 0.005, 3), dark, side * 0.096, 0, -0.07);
      this.add(roundedBoxGeometry(0.006, 0.008, 0.1, 0.002, 1), strip, side * 0.104, 0, -0.07);
      const stud = this.add(new CylinderGeometry(0.009, 0.009, 0.016, 16), steel, side * 0.089, 0, CZ);
      stud.rotation.z = Math.PI / 2;
    }

    // three nested rings, each pivoting inside the last
    const specs: Array<[number, number, Material]> = [[0.078, 0.0065, steel], [0.061, 0.0055, white], [0.045, 0.005, copper]];
    let parent: Object3D = this.group;
    specs.forEach(([radius, thickness, mat], i) => {
      const ring = new Group();
      if (i === 0) ring.position.z = CZ;
      this.add(new TorusGeometry(radius, thickness, 12, 64), mat, 0, 0, 0, ring);
      // pivot pins to the next ring in
      const next = specs[i + 1];
      if (next) {
        for (const side of [-1, 1]) {
          const pin = this.add(new CylinderGeometry(0.003, 0.003, radius - next[0], 8), steel, 0, 0, 0, ring);
          if (i % 2 === 0) pin.position.y = side * (radius + next[0]) / 2;
          else { pin.position.x = side * (radius + next[0]) / 2; pin.rotation.z = Math.PI / 2; }
        }
      }
      parent.add(ring);
      this.rings.push(ring);
      parent = ring;
    });
    this.core = this.add(new SphereGeometry(0.024, 28, 18), coreMat, 0, 0, 0, parent);
    this.halo(this.core, 0.036);
    this.tip = this.core;
  }

  protected override onFire(): void {
    this.spin += 2.4;
  }

  protected tick(dt: number, recoil: number): void {
    this.spin *= Math.exp(-2.6 * dt);
    const rate = dt * (0.5 + this.spin * 7);
    this.rings[0].rotation.x += rate * 0.6;
    this.rings[1].rotation.y += rate;
    this.rings[2].rotation.x += rate * 1.5;
    this.core.scale.setScalar(1 + this.flash * 0.7 + recoil * 0.2 + Math.sin(this.time * 5) * 0.03);
  }
}

// ----- drawn maps for the bracer's armour: three bands stacked down the canvas, wrapping around the arm
const BW = 2048;
const BH = 1024;
const ROW = BH / 3;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas2d(w: number, h: number): CanvasRenderingContext2D {
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

function bracerMaps(): { map: CanvasTexture; normalMap: CanvasTexture; roughnessMap: CanvasTexture } {
  const screws = screwSpots();

  // --- height: grooves, sunken hatches, vents, screw heads, rolled edges
  const h = canvas2d(BW, BH);
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
  const soft = canvas2d(BW, BH);
  soft.filter = 'blur(1.4px)';
  soft.drawImage(h.canvas, 0, 0);
  const src = soft.getImageData(0, 0, BW, BH).data;
  const n = canvas2d(BW, BH);
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
  const a = canvas2d(BW, BH);
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
  const ro = canvas2d(BW, BH);
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

  const tex = (g: CanvasRenderingContext2D, srgb: boolean) => {
    const t = new CanvasTexture(g.canvas);
    t.wrapS = RepeatWrapping;
    t.anisotropy = 16;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  return { map: tex(a, true), normalMap: tex(n, false), roughnessMap: tex(ro, false) };
}

/** Wrist readout, portrait: white on black, tinted with the active portal colour. */
function bracerScreen(): CanvasTexture {
  const W = 512;
  const H = 768;
  const g = canvas2d(W, H);
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

/**
 * C — Bracer. Worn, not held: banded ceramic armour over the forearm, a wrist
 * console, and a finned emitter whose six-leaf iris snaps open on each shot.
 */
class BracerGun extends ProtoGun {
  private readonly petals: Mesh[] = [];
  private readonly dial: Group;
  private open = 0;

  constructor() {
    super();
    this.rest.set(0.2, -0.2, -0.4);
    this.kick = 2.4;
    const maps = bracerMaps();
    const shell = new MeshPhysicalMaterial({
      ...maps, normalScale: new Vector2(1, 1), roughness: 1, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.22, envMapIntensity: 1.1,
    });
    this.materials.push(shell);
    const dark = this.dark();
    const steel = this.steel();
    const copper = this.copper();
    const rubber = this.rubber();
    const glass = this.glass();
    const strip = this.glow(1.25, 2.6);
    const pip = this.glow(GLOW);
    const lens = this.glow(GLOW * 1.2, 2);
    const screen = this.glow(1.7, 0.6);
    screen.map = bracerScreen();

    /** A surface of revolution around the barrel from (z, radius) pairs. */
    const lathe = (profile: Array<[number, number]>, mat: Material) => {
      const geo = new LatheGeometry(profile.map(([z, r]) => new Vector2(r, z)), 128);
      const mesh = this.add(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      return mesh;
    };

    // ----- three armour bands, each with rolled lips and its own strip of the drawn maps
    const bands: Array<[number, number, number, number]> = [[-0.03, 0.05, 0.0815, 0.0795], [0.07, 0.15, 0.0775, 0.0755], [0.17, 0.25, 0.0735, 0.0715]];
    bands.forEach(([z0, z1, r0, r1], row) => {
      const lip = 0.0035;
      const mesh = lathe([
        [z0, r0 - 0.008], [z0, r0 - lip], [z0 + lip, r0], [z0 + lip * 2.4, r0 - 0.0012],
        [z1 - lip * 2.4, r1 - 0.0012], [z1 - lip, r1], [z1, r1 - lip], [z1, r1 - 0.008],
      ], shell);
      // v runs along the arm inside this band's third of the maps; u is flipped so stencils read left to right
      const geo = mesh.geometry;
      const uv = geo.attributes.uv;
      const pos = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const t = (z1 - pos.getY(i)) / (z1 - z0);
        uv.setXY(i, 1 - uv.getX(i), 1 - (row + 1 - t) / 3);
      }
      mesh.material = shell;
    });

    // ----- ribbed under-sleeve showing in the joints and at the cuff, with a lit seam in each joint
    const ribs = (z0: number, z1: number, r: number, count: number) => {
      const pts: Array<[number, number]> = [];
      const steps = count * 8;
      for (let i = 0; i <= steps; i++) pts.push([z0 + ((z1 - z0) * i) / steps, r + Math.cos((i / steps) * count * Math.PI * 2) * 0.0016]);
      lathe(pts, rubber);
    };
    ribs(0.046, 0.074, 0.0715, 4);
    ribs(0.146, 0.174, 0.0675, 4);
    ribs(0.246, 0.32, 0.0635, 9);
    for (const [z, r] of [[0.06, 0.0728], [0.16, 0.0688]]) this.add(new TorusGeometry(r, 0.0016, 10, 128), strip, 0, 0, z);
    this.add(new TorusGeometry(0.0665, 0.0035, 12, 96), steel, 0, 0, 0.256);

    // ----- wrist console: saddle, tilted readout under glass, keys, a knurled dial
    const CZ = 0.165;
    this.add(roundedBoxGeometry(0.074, 0.02, 0.185, 0.007, 6), dark, 0, 0.076, CZ);
    this.add(roundedBoxGeometry(0.064, 0.012, 0.172, 0.005, 5), steel, 0, 0.084, CZ);
    const hex = new CylinderGeometry(0.0038, 0.0038, 0.004, 6);
    for (const x of [-0.03, 0.03]) for (const z of [CZ - 0.082, CZ + 0.082]) this.add(hex, steel, x, 0.0875, z);
    const pod = new Group();
    pod.position.set(0, 0.094, CZ + 0.03);
    pod.rotation.x = 0.2;
    this.add(roundedBoxGeometry(0.06, 0.014, 0.092, 0.005, 5), dark, 0, 0, 0, pod);
    const face = this.add(new PlaneGeometry(0.05, 0.075), screen, 0, 0.0073, 0, pod);
    face.rotation.x = -Math.PI / 2;
    const cover = this.add(new PlaneGeometry(0.052, 0.078), glass, 0, 0.0082, 0, pod);
    cover.rotation.x = -Math.PI / 2;
    cover.renderOrder = 2;
    this.group.add(pod);
    // keys with a status light each
    const keyGeo = roundedBoxGeometry(0.014, 0.007, 0.016, 0.003, 4);
    for (let i = 0; i < 3; i++) {
      this.add(keyGeo, rubber, -0.018 + i * 0.018, 0.092, CZ - 0.05);
      this.add(new SphereGeometry(0.0017, 12, 8), pip, -0.018 + i * 0.018, 0.0915, CZ - 0.066);
    }
    this.add(roundedBoxGeometry(0.05, 0.004, 0.006, 0.0015, 2), pip, 0, 0.0905, CZ - 0.078);
    // dial on the inboard side, turned by the other hand
    this.dial = new Group();
    this.dial.position.set(-0.041, 0.088, CZ - 0.045);
    const knob = this.add(new CylinderGeometry(0.012, 0.012, 0.012, 48), steel, 0, 0, 0, this.dial);
    knob.rotation.z = Math.PI / 2;
    const ridge = roundedBoxGeometry(0.011, 0.0022, 0.0022, 0.0008, 1);
    for (let i = 0; i < 28; i++) {
      const t = (i / 28) * Math.PI * 2;
      const m = this.add(ridge, dark, 0, Math.cos(t) * 0.0122, Math.sin(t) * 0.0122, this.dial);
      m.rotation.x = t;
    }
    this.add(roundedBoxGeometry(0.002, 0.004, 0.014, 0.0008, 1), pip, -0.0065, 0, 0, this.dial);
    this.group.add(this.dial);

    // ----- conduits: a copper line and a rubber line down each shoulder, clamped to the front band
    for (const side of [-1, 1]) {
      const line = (off: number, radius: number, mat: Material) => {
        const path = new CatmullRomCurve3([
          new Vector3(side * (0.022 + off), 0.083, CZ - 0.09),
          new Vector3(side * (0.034 + off), 0.088, 0.045),
          new Vector3(side * (0.046 + off), 0.082, 0.0),
          new Vector3(side * (0.05 + off), 0.076, -0.05),
        ]);
        this.group.add(new Mesh(new TubeGeometry(path, 64, radius, 16), mat));
      };
      line(0, 0.0046, copper);
      line(0.011, 0.0034, rubber);
      const clamp = this.add(roundedBoxGeometry(0.03, 0.008, 0.012, 0.003, 3), steel, side * 0.05, 0.078, 0.008);
      clamp.rotation.z = -side * 0.55;
      this.add(hex, steel, side * 0.062, 0.0745, 0.008).rotation.z = -side * 0.55;
    }

    // ----- lit pips up the inboard shoulder of the front band
    for (let i = 0; i < 4; i++) {
      const t = Math.PI * 0.84;
      this.add(roundedBoxGeometry(0.004, 0.0026, 0.009, 0.001, 1), pip, Math.cos(t) * 0.0808, Math.sin(t) * 0.0808, -0.012 + i * 0.014).rotation.z = t - Math.PI / 2;
    }

    // ----- emitter: finned collar, bolted flange, hood, lens under glass, iris
    const F = -0.075;
    lathe([[-0.064, 0.07], [-0.064, 0.077], [-0.03, 0.077], [-0.03, 0.07]], dark);
    const fin = roundedBoxGeometry(0.0026, 0.015, 0.03, 0.001, 1);
    for (let i = 0; i < 40; i++) {
      const arm = new Group();
      arm.rotation.z = (i / 40) * Math.PI * 2;
      this.add(fin, steel, 0, 0.0835, -0.047, arm);
      this.group.add(arm);
    }
    lathe([
      [-0.063, 0.076], [-0.063, 0.094], [-0.066, 0.097], [-0.084, 0.097], [-0.087, 0.094], [-0.087, 0.076],
    ], dark);
    const bolt = new CylinderGeometry(0.0042, 0.0042, 0.005, 6);
    for (let i = 0; i < 12; i++) {
      const t = ((i + 0.5) / 12) * Math.PI * 2;
      this.add(bolt, steel, Math.cos(t) * 0.0895, Math.sin(t) * 0.0895, -0.0615).rotation.x = Math.PI / 2;
    }
    lathe([[-0.087, 0.09], [-0.087, 0.0985], [-0.112, 0.1015], [-0.116, 0.0995], [-0.114, 0.095], [-0.09, 0.09]], steel);
    this.add(new TorusGeometry(0.0975, 0.0022, 12, 128), strip, 0, 0, -0.1165);
    const disc = this.tube(0.07, 0.07, 0.004, lens, F - 0.014);
    this.tip = disc;
    for (const r of [0.03, 0.05]) this.add(new TorusGeometry(r, 0.0018, 8, 96), dark, 0, 0, F - 0.0165);
    const petalGeo = roundedBoxGeometry(0.074, 0.05, 0.004, 0.0015, 2);
    for (let i = 0; i < 6; i++) {
      const arm = new Group();
      arm.rotation.z = (i / 6) * Math.PI * 2;
      arm.position.z = F - 0.02 - (i % 2) * 0.0045;
      const petal = this.add(petalGeo, steel, 0, 0.04, 0, arm);
      petal.rotation.z = 0.5;
      this.petals.push(petal);
      this.group.add(arm);
    }
  }

  protected override onFire(): void {
    this.open = 1;
  }

  protected tick(dt: number): void {
    this.open *= Math.exp(-3.2 * dt);
    // leaves slide outward and twist as the iris opens; a slow breath when idle
    const o = Math.min(1, this.open * 1.4) + (Math.sin(this.time * 1.6) * 0.5 + 0.5) * 0.06;
    for (const petal of this.petals) {
      petal.position.y = 0.04 + o * 0.034;
      petal.rotation.z = 0.5 + o * 0.5;
    }
    this.dial.rotation.x = this.open * 2.5;
  }
}

/**
 * D — Canister. A chunky lab tool in safety yellow: a jar of charge on top that
 * drains with each shot, a square horn up front, a pump slide that racks back
 * and a pressure gauge whose needle jumps.
 */
class CanisterGun extends ProtoGun {
  private readonly fluid: Mesh;
  private readonly slide: Group;
  private readonly needle: Group;
  private level = 1;

  constructor() {
    super();
    this.kick = 4;
    const yellow = this.std({ color: 0xf0ae16, roughness: 0.5, metalness: 0.1 });
    const dark = this.dark();
    const steel = this.steel();
    const rubber = this.rubber();
    const glass = this.glass();
    const face = this.std({ color: 0xf2f2ec, roughness: 0.6 });
    const strip = this.glow();
    const fluid = this.glow(GLOW * 1.3, 1.2);
    const plate = this.glow(GLOW * 1.4, 2.4);

    // casing with black hazard bands and chunky bolts
    this.add(roundedBoxGeometry(0.104, 0.1, 0.22, 0.02, 5), yellow, 0, 0, 0.04);
    for (const z of [-0.045, 0.125]) this.add(roundedBoxGeometry(0.108, 0.104, 0.022, 0.012, 3), dark, 0, 0, z);
    const boltGeo = new CylinderGeometry(0.007, 0.007, 0.008, 6);
    for (const side of [-1, 1]) for (const z of [-0.01, 0.09]) for (const y of [-0.028, 0.028]) {
      this.add(boltGeo, steel, side * 0.053, y, z).rotation.z = Math.PI / 2;
    }
    this.add(roundedBoxGeometry(0.094, 0.088, 0.014, 0.01, 3), dark, 0, 0, 0.154);

    // D-handle grip
    this.grip(0.11, -0.115);
    this.add(roundedBoxGeometry(0.03, 0.016, 0.1, 0.006, 2), dark, 0, -0.172, 0.085);
    this.add(roundedBoxGeometry(0.03, 0.12, 0.016, 0.006, 2), dark, 0, -0.118, 0.04);

    // jar of charge, standing on the rear deck
    const jar = new Group();
    jar.position.set(0, 0.052, 0.085);
    this.add(new CylinderGeometry(0.036, 0.036, 0.012, 32), steel, 0, 0.006, 0, jar);
    this.add(new CylinderGeometry(0.036, 0.036, 0.012, 32), steel, 0, 0.098, 0, jar);
    this.add(new CylinderGeometry(0.01, 0.014, 0.014, 16), dark, 0, 0.11, 0, jar);
    this.add(new CylinderGeometry(0.031, 0.031, 0.082, 32, 1, true), glass, 0, 0.052, 0, jar).renderOrder = 2;
    const geo = new CylinderGeometry(0.025, 0.025, 0.078, 28);
    geo.translate(0, 0.039, 0);
    this.fluid = this.add(geo, fluid, 0, 0.013, 0, jar);
    this.group.add(jar);

    // pressure gauge, tipped toward the eye
    const gauge = new Group();
    gauge.position.set(0, 0.062, 0.015);
    gauge.rotation.x = -0.75;
    this.add(new CylinderGeometry(0.026, 0.026, 0.014, 32), steel, 0, 0, 0, gauge).rotation.x = Math.PI / 2;
    this.add(new CylinderGeometry(0.022, 0.022, 0.015, 32), face, 0, 0, 0.001, gauge).rotation.x = Math.PI / 2;
    this.needle = new Group();
    this.needle.position.z = 0.0095;
    this.add(roundedBoxGeometry(0.003, 0.02, 0.002, 0.0008, 1), strip, 0, 0.008, 0, this.needle);
    gauge.add(this.needle);
    this.group.add(gauge);

    // carry handle over the front
    const handle = this.add(new TorusGeometry(0.045, 0.008, 10, 28, Math.PI), rubber, 0, 0.046, -0.075);
    handle.rotation.y = Math.PI / 2;

    // square nozzle and flared horn
    this.add(roundedBoxGeometry(0.074, 0.074, 0.11, 0.008, 3), dark, 0, 0, -0.12);
    const horn = this.add(new CylinderGeometry(0.052, 0.088, 0.075, 4, 1, true), steel, 0, 0, -0.212);
    horn.rotation.set(-Math.PI / 2, Math.PI / 4, 0, 'YXZ');
    this.tip = this.add(roundedBoxGeometry(0.062, 0.062, 0.006, 0.004, 2), plate, 0, 0, -0.178);
    for (const y of [-0.02, 0, 0.02]) this.add(roundedBoxGeometry(0.066, 0.005, 0.01, 0.002, 1), dark, 0, y, -0.184);

    // pump slide under the nozzle
    for (const side of [-1, 1]) {
      const rod = this.add(new CylinderGeometry(0.005, 0.005, 0.16, 12), steel, side * 0.022, -0.052, -0.11);
      rod.rotation.x = Math.PI / 2;
    }
    this.slide = new Group();
    this.add(roundedBoxGeometry(0.07, 0.03, 0.06, 0.01, 3), rubber, 0, -0.052, 0, this.slide);
    this.group.add(this.slide);

    // hose from the jar's cap down into the nozzle
    const hose = new CatmullRomCurve3([
      new Vector3(0, 0.168, 0.085),
      new Vector3(0.03, 0.185, 0.05),
      new Vector3(0.056, 0.13, -0.04),
      new Vector3(0.04, 0.045, -0.11),
    ]);
    this.group.add(new Mesh(new TubeGeometry(hose, 32, 0.006, 10), rubber));
  }

  protected override onFire(): void {
    this.level = Math.max(0.15, this.level - 0.45);
  }

  protected tick(dt: number, recoil: number): void {
    this.level = Math.min(1, this.level + dt * 0.5);
    this.fluid.scale.y = this.level + Math.sin(this.time * 3) * 0.012;
    this.slide.position.z = -0.15 + Math.min(0.07, Math.max(0, recoil) * 0.5 + this.flash * 0.05);
    this.needle.rotation.z = 1.1 - this.level * 2.2 + Math.sin(this.time * 40) * this.flash * 0.25;
  }
}

export interface GunVariant {
  key: string;
  name: string;
  make(maps: SurfaceMaps): PortalGun;
}

export const GUN_VARIANTS: GunVariant[] = [
  { key: 'A', name: 'Tuning fork', make: () => new ForkGun() },
  { key: 'B', name: 'Gyro', make: () => new GyroGun() },
  { key: 'C', name: 'Bracer', make: () => new BracerGun() },
  { key: 'D', name: 'Canister', make: () => new CanisterGun() },
  { key: '0', name: 'Current gun', make: (maps) => new Gun(maps) },
];
