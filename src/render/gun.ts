import {
  type BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, Group, LatheGeometry, type Material, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, type MeshStandardMaterialParameters, type Object3D, PlaneGeometry, SphereGeometry, TorusGeometry,
  TubeGeometry, Vector2, Vector3,
} from 'three';
import { BLUE } from '../config';
import { springStep, type Spring } from '../world/props';
import { roundedBoxGeometry } from './geometry';
import { gunDisplayTexture } from './gunmaps';
import type { SurfaceMaps } from './textures';

const REST = new Vector3(0.2, -0.2, -0.4);
/** HDR boost for the glowing parts, so they catch the bloom pass. */
const GLOW = 3.2;

/** A lit part: its brightness at rest and how much hotter it burns on a shot. */
interface Lit {
  material: MeshBasicMaterial;
  base: number;
  boost: number;
}

/**
 * The view-model portal device, worn rather than held: three bands of ceramic
 * armour over the forearm, a wrist console, and a finned emitter whose six-leaf
 * iris snaps open on each shot.
 */
export class Gun {
  readonly group = new Group();
  /** Every lit material, so one shot can recolour them all. */
  private readonly lit: Lit[] = [];
  private readonly pbr: Material[] = [];
  private readonly tip: Mesh;
  /** The iris leaves over the lens. */
  private readonly petals: Mesh[] = [];
  private readonly dial = new Group();
  private readonly recoil: Spring = { x: 0, v: 0 };
  private color = BLUE;
  private flash = 0;
  private bob = 0;
  private time = 0;
  /** 1 when the iris has just been thrown open, easing back to 0. */
  private open = 0;

  /** @param maps armour maps from `gunMaps`: panel joints, stencils and wear */
  constructor(maps: SurfaceMaps) {
    const shell = new MeshPhysicalMaterial({
      ...maps, roughness: 1, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.22, envMapIntensity: 1.1,
    });
    this.pbr.push(shell);
    const dark = this.standard({ color: 0x23272e, roughness: 0.42, metalness: 0.85 });
    const steel = this.standard({ color: 0xaab3bf, roughness: 0.26, metalness: 1, envMapIntensity: 0.8 });
    const copper = this.standard({ color: 0xc8793f, roughness: 0.32, metalness: 1, envMapIntensity: 0.9 });
    const rubber = this.standard({ color: 0x121419, roughness: 0.8, envMapIntensity: 0.5 });
    const glass = new MeshPhysicalMaterial({
      color: 0xd7ebff, roughness: 0.03, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6,
      depthWrite: false,
    });
    this.pbr.push(glass);
    const strip = this.glow(1.25, 2.6);
    const pip = this.glow(GLOW);
    const lens = this.glow(GLOW * 1.2, 2);
    const screen = this.glow(1.7, 0.6);
    screen.map = gunDisplayTexture();

    /** A surface of revolution around the barrel from (z, radius) pairs. */
    const lathe = (profile: Array<[number, number]>, mat: Material) => {
      const mesh = this.add(new LatheGeometry(profile.map(([z, r]) => new Vector2(r, z)), 128), mat);
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
    this.tip = this.add(new CylinderGeometry(0.07, 0.07, 0.004, 64), lens, 0, 0, F - 0.014);
    this.tip.rotation.x = Math.PI / 2;
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

    this.group.position.copy(REST);
  }

  private standard(parameters: MeshStandardMaterialParameters): MeshStandardMaterial {
    const material = new MeshStandardMaterial(parameters);
    this.pbr.push(material);
    return material;
  }

  /** A lit part in the active portal colour. */
  private glow(base: number, boost = 0): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ color: new Color(BLUE).multiplyScalar(base) });
    this.lit.push({ material, base, boost });
    return material;
  }

  private add(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0, parent: Object3D = this.group): Mesh {
    const mesh = new Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  get materials(): Material[] {
    return this.pbr;
  }

  /** Recolours the lit parts, throws the iris open and kicks the arm back. */
  fire(color: number): void {
    this.color = color;
    this.flash = 1;
    this.open = 1;
    this.recoil.v += 2.4;
  }

  tipWorldPosition(target: Vector3): Vector3 {
    return this.tip.getWorldPosition(target);
  }

  /**
   * @param groundSpeed horizontal speed while grounded (0 when airborne), drives the walk bob
   * @param dip landing dip offset of the camera
   */
  animate(dt: number, groundSpeed: number, dip: number): void {
    this.time += dt;
    springStep(this.recoil, 0, 180, 10, dt);
    if (groundSpeed > 0.5) this.bob += dt * groundSpeed * 1.8;
    const r = this.recoil.x;
    this.group.position.set(
      REST.x + Math.sin(this.bob) * 0.01,
      REST.y + Math.abs(Math.cos(this.bob)) * 0.01 - r * 0.012 - dip * 0.25,
      REST.z + r * 0.05,
    );
    this.group.rotation.x = r * 0.18;
    // lit parts burn hot on each shot and settle back
    this.flash *= Math.exp(-7 * dt);
    for (const l of this.lit) l.material.color.setHex(this.color).multiplyScalar(l.base * (1 + this.flash * l.boost));
    // leaves slide outward and twist as the iris opens; a slow breath when idle
    this.open *= Math.exp(-3.2 * dt);
    const o = Math.min(1, this.open * 1.4) + (Math.sin(this.time * 1.6) * 0.5 + 0.5) * 0.06;
    for (const petal of this.petals) {
      petal.position.y = 0.04 + o * 0.034;
      petal.rotation.z = 0.5 + o * 0.5;
    }
    this.dial.rotation.x = this.open * 2.5;
  }
}
