import {
  AdditiveBlending, type BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, type Material, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NormalBlending, PlaneGeometry, SphereGeometry, SRGBColorSpace, type Texture, TorusGeometry,
} from 'three';
import { roundedBoxGeometry } from '../render/geometry';
import type { SurfaceMaps } from '../render/textures';

export interface Spring {
  x: number;
  v: number;
}

/** Damped spring integrator used for small bits of juice (button press, landing dip, recoil). */
export function springStep(s: Spring, target: number, stiffness: number, damping: number, dt: number): void {
  s.v += (target - s.x) * stiffness * dt;
  s.v *= Math.exp(-damping * dt);
  s.x += s.v * dt;
}

/** Draws a square canvas texture once and caches it. */
const decalCache = new Map<string, CanvasTexture>();
function decalTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  let tex = decalCache.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  decalCache.set(key, tex);
  return tex;
}

/** A flat textured quad lying on the floor, drawn over it without z-fighting. */
function floorDecal(map: Texture, size: number, additive = false, color: Color | number = 0xffffff): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const mesh = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({
    map, color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    blending: additive ? AdditiveBlending : NormalBlending,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.004;
  mesh.receiveShadow = !additive;
  return mesh;
}

/** Yellow-and-navy hazard ring painted around the pressure button. */
function hazardRing(): CanvasTexture {
  return decalTexture('hazard', 512, (g, s) => {
    const c = s / 2;
    const outer = s * 0.48;
    const inner = s * 0.37;
    g.save();
    g.beginPath();
    g.arc(c, c, outer, 0, Math.PI * 2);
    g.arc(c, c, inner, 0, Math.PI * 2, true);
    g.clip();
    g.fillStyle = '#ffc93a';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#2b3a55';
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = a0 + Math.PI / n;
      const skew = 0.12;
      g.beginPath();
      g.moveTo(c + Math.cos(a0) * inner, c + Math.sin(a0) * inner);
      g.lineTo(c + Math.cos(a0 + skew) * outer, c + Math.sin(a0 + skew) * outer);
      g.lineTo(c + Math.cos(a1 + skew) * outer, c + Math.sin(a1 + skew) * outer);
      g.lineTo(c + Math.cos(a1) * inner, c + Math.sin(a1) * inner);
      g.fill();
    }
    g.restore();
    // worn edges
    g.strokeStyle = 'rgba(43,58,85,.9)';
    g.lineWidth = s * 0.012;
    g.beginPath(); g.arc(c, c, outer, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(c, c, inner, 0, Math.PI * 2); g.stroke();
  });
}

/** Glowing dashed ring with inward chevrons marking the exit pad. */
function exitRing(): CanvasTexture {
  return decalTexture('exit', 512, (g, s) => {
    const c = s / 2;
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.lineWidth = s * 0.022;
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.beginPath();
      g.arc(c, c, s * 0.44, a, a + (Math.PI / n) * 1.1);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(c, c);
      g.rotate((i / 4) * Math.PI * 2);
      g.globalAlpha = 0.8;
      for (let k = 0; k < 2; k++) {
        const y = s * (0.385 - k * 0.035);
        g.beginPath();
        g.moveTo(-s * 0.035, -y);
        g.lineTo(0, -y + s * 0.025);
        g.lineTo(s * 0.035, -y);
        g.lineTo(s * 0.035, -y - s * 0.012);
        g.lineTo(0, -y + s * 0.013);
        g.lineTo(-s * 0.035, -y - s * 0.012);
        g.fill();
      }
      g.restore();
    }
  });
}

const BUTTON_UP = 0.14;
const BUTTON_DOWN = 0.04;
const RED = 0xff5a4e;
const RED_GLOW = 0xa1241c;
const GREEN = 0x4fe3a1;
const GREEN_GLOW = 0x1f9e66;

export class ButtonProp {
  readonly group = new Group();
  private readonly cap: Mesh;
  private readonly capMat: MeshStandardMaterial;
  private readonly spring: Spring = { x: BUTTON_UP, v: 0 };
  pressed = false;

  constructor(baseMaterial: Material) {
    const base = new Mesh(new CylinderGeometry(0.95, 1.05, 0.14, 64), baseMaterial);
    base.position.y = 0.07;
    base.receiveShadow = true;
    this.group.add(base);
    this.group.add(floorDecal(hazardRing(), 2.9));
    this.capMat = new MeshStandardMaterial({ color: RED, emissive: RED_GLOW, emissiveIntensity: 0.9, roughness: 0.22 });
    this.cap = new Mesh(new SphereGeometry(0.7, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.capMat);
    this.cap.scale.set(1, 0.28, 1);
    this.cap.castShadow = true;
    this.group.add(this.cap);
  }

  animate(dt: number): void {
    springStep(this.spring, this.pressed ? BUTTON_DOWN : BUTTON_UP, 260, 9, dt);
    this.cap.position.y = this.spring.x;
    const press = BUTTON_UP - this.spring.x;
    const wide = 1 + press * 0.6;
    this.cap.scale.set(wide, Math.max(0.1, 0.28 - press * 0.8), wide);
    this.capMat.color.setHex(this.pressed ? GREEN : RED);
    this.capMat.emissive.setHex(this.pressed ? GREEN_GLOW : RED_GLOW);
    this.capMat.emissiveIntensity = this.pressed ? 3 : 0.9;
  }
}

/** Vertical fade for the goal's light column: bright at the base, gone at the top. */
let columnFade: CanvasTexture | null = null;
function getColumnFade(): CanvasTexture {
  if (columnFade) return columnFade;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.35, 'rgba(70,70,70,1)');
  grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  columnFade = new CanvasTexture(c);
  return columnFade;
}

export class GoalProp {
  readonly group = new Group();
  private readonly columnMat: MeshBasicMaterial;
  private readonly innerMat: MeshBasicMaterial;
  private readonly beacon = new Group();
  private readonly ring: Mesh;

  constructor() {
    const pad = new Mesh(
      new CylinderGeometry(0.95, 1.05, 0.08, 64),
      new MeshStandardMaterial({ color: GREEN, emissive: GREEN_GLOW, emissiveIntensity: 1.6, roughness: 0.3 }),
    );
    pad.position.y = 0.04;
    this.group.add(pad);
    const ring = new Mesh(
      new TorusGeometry(0.98, 0.035, 12, 64),
      new MeshBasicMaterial({ color: new Color(0x7dffc2).multiplyScalar(3) }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.085;
    this.group.add(ring);

    // Two nested additive shells give the column some depth.
    const fade = getColumnFade();
    this.columnMat = new MeshBasicMaterial({
      color: new Color(0x7dffc2).multiplyScalar(0.9), alphaMap: fade, transparent: true, opacity: 0.5,
      side: DoubleSide, depthWrite: false, blending: AdditiveBlending, fog: false,
    });
    const column = new Mesh(new CylinderGeometry(0.85, 0.9, 2.6, 64, 1, true), this.columnMat);
    column.position.y = 1.3;
    this.group.add(column);
    this.innerMat = this.columnMat.clone();
    this.innerMat.color = new Color(0xc8ffe4).multiplyScalar(0.6);
    const inner = new Mesh(new CylinderGeometry(0.45, 0.6, 2.2, 48, 1, true), this.innerMat);
    inner.position.y = 1.1;
    this.group.add(inner);

    this.ring = floorDecal(exitRing(), 3, true, new Color(0x7dffc2).multiplyScalar(2.2));
    this.group.add(this.ring);

    const beaconMat = new MeshStandardMaterial({ color: GREEN, emissive: 0x2bd18a, emissiveIntensity: 1.4, roughness: 0.25 });
    this.beacon.add(new Mesh(new TorusGeometry(0.32, 0.09, 24, 48), beaconMat));
    this.beacon.add(new Mesh(new SphereGeometry(0.13, 32, 20), new MeshBasicMaterial({ color: new Color(0xfff7c2).multiplyScalar(2.4) })));
    this.beacon.position.y = 1.9;
    this.group.add(this.beacon);
  }

  animate(time: number): void {
    this.columnMat.opacity = 0.28 + 0.08 * Math.sin(time * 3);
    this.innerMat.opacity = 0.22 + 0.1 * Math.sin(time * 3 + 1.4);
    const phase = (time * 1.6) % 1;
    const h = Math.sin(phase * Math.PI);
    this.beacon.position.y = 1.55 + h * 0.55;
    const squash = phase < 0.12 || phase > 0.88 ? 0.22 * (1 - h) : 0;
    this.beacon.scale.set(1 + squash, 1 - squash, 1 + squash);
    this.beacon.rotation.y = time * 1.4;
    this.ring.rotation.z = -time * 0.35;
  }
}

export const CUBE_SIZE = 0.7;

const CUBE_CORE = 0xffc23d;

/**
 * The companion cube: a textured rounded shell with chunky navy corner
 * bumpers and a glowing core lens on every face.
 */
export function createCubeMesh(maps: SurfaceMaps, emissiveMap: Texture): Mesh<BoxGeometry, MeshStandardMaterial> {
  const half = CUBE_SIZE / 2;
  const mesh = new Mesh(
    roundedBoxGeometry(CUBE_SIZE * 0.97, CUBE_SIZE * 0.97, CUBE_SIZE * 0.97, 0.1, 6),
    new MeshStandardMaterial({
      ...maps, emissiveMap, emissive: new Color(CUBE_CORE), emissiveIntensity: 1.2, roughness: 1, metalness: 1, envMapIntensity: 1,
    }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const bumperMat = new MeshStandardMaterial({ color: 0x3a4766, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.9 });
  const bumperGeo = roundedBoxGeometry(0.235, 0.235, 0.235, 0.06, 4);
  const b = half - 0.1;
  for (const x of [-b, b]) for (const y of [-b, b]) for (const z of [-b, b]) {
    const bumper = new Mesh(bumperGeo, bumperMat);
    bumper.position.set(x, y, z);
    bumper.castShadow = true;
    bumper.receiveShadow = true;
    mesh.add(bumper);
  }

  const coreMat = new MeshBasicMaterial({ color: new Color(CUBE_CORE).multiplyScalar(2.5) });
  const coreGeo = new SphereGeometry(0.08, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const faces: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [x, y, z] of faces) {
    const core = new Mesh(coreGeo, coreMat);
    core.position.set(x, y, z).multiplyScalar(half * 0.97 - 0.012);
    core.scale.set(1, 0.45, 1);
    // dome's local +y points out of the face
    core.quaternion.setFromUnitVectors(core.up.clone(), core.position.clone().normalize());
    mesh.add(core);
  }
  mesh.userData.coreMaterial = coreMat;
  return mesh;
}

/** Pulses the cube's glowing cores; brighter while it's being carried. */
export function animateCube(mesh: Mesh, time: number, held: boolean): void {
  const mat = mesh.userData.coreMaterial as MeshBasicMaterial | undefined;
  if (!mat) return;
  const pulse = (held ? 3.6 : 2.3) + Math.sin(time * (held ? 7 : 2.4)) * (held ? 0.8 : 0.5);
  mat.color.setHex(CUBE_CORE).multiplyScalar(pulse);
  const m = mesh.material as MeshStandardMaterial;
  m.emissiveIntensity = pulse * 0.45;
}
