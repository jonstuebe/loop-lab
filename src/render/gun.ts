import {
  type BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, Group, type Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, type Object3D, PlaneGeometry, SphereGeometry, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import { BLUE } from '../config';
import { springStep, type Spring } from '../world/props';
import { roundedBoxGeometry } from './geometry';
import type { SurfaceMaps } from './textures';

const REST = new Vector3(0.21, -0.2, -0.42);
/** HDR boost for the glowing parts, so they catch the bloom pass. */
const GLOW = 3.2;

/** Readout for the rear display: white on black, tinted with the active portal colour. */
function displayTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 2;
  g.strokeRect(5, 5, 246, 118);
  g.font = '700 26px "Arial Narrow", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('PD-03', 16, 28);
  g.font = '700 13px "Arial Narrow", Arial, sans-serif';
  g.fillText('FIELD READY', 16, 52);
  g.textAlign = 'right';
  g.fillText('CELL 98%', 240, 22);
  g.textAlign = 'left';
  // charge bars
  for (let i = 0; i < 12; i++) {
    g.globalAlpha = i < 10 ? 1 : 0.25;
    g.fillRect(16 + i * 19, 68, 13, 20);
  }
  g.globalAlpha = 0.8;
  // field waveform
  g.lineWidth = 1.6;
  g.beginPath();
  for (let x = 0; x <= 224; x += 2) {
    const y = 106 + Math.sin(x * 0.11) * 7 * Math.sin(x * 0.014);
    if (x === 0) g.moveTo(16 + x, y);
    else g.lineTo(16 + x, y);
  }
  g.stroke();
  g.globalAlpha = 1;
  // aperture icon
  g.lineWidth = 2;
  g.beginPath(); g.ellipse(222, 46, 9, 13, 0, 0, Math.PI * 2); g.stroke();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The view-model portal device: a ceramic-plated receiver over a graphite
 * chassis, an exposed field chamber wound with copper coils, and a muzzle
 * ringed by four focusing vanes.
 */
export class Gun {
  readonly group = new Group();
  /** Ceramic armour shell; panel joints, markings and wear come from its texture set. */
  readonly bodyMaterial: MeshPhysicalMaterial;
  /** Graphite-coated chassis metal. */
  private readonly darkMaterial = new MeshStandardMaterial({ color: 0x23272e, roughness: 0.42, metalness: 0.85, envMapIntensity: 1 });
  private readonly steelMaterial = new MeshStandardMaterial({ color: 0xaab3bf, roughness: 0.26, metalness: 1, envMapIntensity: 0.8 });
  private readonly copperMaterial = new MeshStandardMaterial({ color: 0xc8793f, roughness: 0.32, metalness: 1, envMapIntensity: 0.9 });
  private readonly rubberMaterial = new MeshStandardMaterial({ color: 0x121419, roughness: 0.8, envMapIntensity: 0.5 });
  private readonly glassMaterial = new MeshPhysicalMaterial({
    color: 0xd7ebff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2, clearcoat: 1, clearcoatRoughness: 0.02,
    envMapIntensity: 1.6, depthWrite: false,
  });
  private readonly ringMaterial = new MeshStandardMaterial({ color: BLUE, emissive: BLUE, emissiveIntensity: 1.8, roughness: 0.3 });
  private readonly glowMaterial = new MeshBasicMaterial({ color: new Color(BLUE).multiplyScalar(GLOW) });
  private readonly coreMaterial = new MeshBasicMaterial({ color: new Color(BLUE).multiplyScalar(GLOW * 1.6) });
  private readonly screenMaterial = new MeshBasicMaterial({ map: displayTexture(), color: new Color(BLUE).multiplyScalar(1.8) });
  private readonly tip: Mesh;
  /** The four focusing vanes; they turn slowly and flare on each shot. */
  private readonly prongs = new Group();
  private readonly recoil: Spring = { x: 0, v: 0 };
  private color = BLUE;
  private flash = 0;
  private bob = 0;
  private spin = 0;

  constructor(maps: SurfaceMaps) {
    const g = this.group;
    this.bodyMaterial = new MeshPhysicalMaterial({
      ...maps, roughness: 1, metalness: 1, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 1,
    });
    const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D = g) => {
      const mesh = new Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    /** A cylinder lying along the barrel; `front` and `back` are its radii at each end. */
    const tube = (front: number, back: number, length: number, mat: Material, z: number, y = 0, open = false) => {
      const mesh = add(new CylinderGeometry(back, front, length, 40, 1, open), mat, 0, y, z);
      mesh.rotation.x = Math.PI / 2;
      return mesh;
    };

    // ----- receiver: textured armour shell over a darker spine
    const shellGeo = roundedBoxGeometry(0.112, 0.094, 0.27, 0.016, 5);
    // Turn the texture on the top and bottom faces so its long axis follows the barrel there too.
    const uv = shellGeo.attributes.uv;
    const perFace = uv.count / 6;
    for (let i = perFace * 2; i < perFace * 4; i++) uv.setXY(i, 1 - uv.getY(i), uv.getX(i));
    add(shellGeo, this.bodyMaterial, 0, 0, 0.03);
    add(roundedBoxGeometry(0.08, 0.036, 0.31, 0.01, 3), this.darkMaterial, 0, -0.056, 0.005);
    add(roundedBoxGeometry(0.1, 0.082, 0.03, 0.01, 3), this.darkMaterial, 0, 0, -0.108);

    // rear plate: bolted cap with a charge ring facing the player
    add(roundedBoxGeometry(0.1, 0.082, 0.014, 0.008, 3), this.darkMaterial, 0, 0, 0.168);
    add(new TorusGeometry(0.026, 0.0035, 10, 48), this.glowMaterial, 0, 0, 0.176);
    tube(0.019, 0.019, 0.01, this.steelMaterial, 0.176);
    tube(0.008, 0.008, 0.012, this.rubberMaterial, 0.177);
    const boltGeo = new CylinderGeometry(0.0045, 0.0045, 0.006, 6);
    for (const x of [-0.039, 0.039]) for (const y of [-0.03, 0.03]) {
      add(boltGeo, this.steelMaterial, x, y, 0.176).rotation.x = Math.PI / 2;
    }

    // top rail with cross slots
    add(roundedBoxGeometry(0.03, 0.012, 0.2, 0.003, 2), this.darkMaterial, 0, 0.052, 0.01);
    const toothGeo = roundedBoxGeometry(0.036, 0.007, 0.011, 0.002, 2);
    for (let i = 0; i < 9; i++) add(toothGeo, this.darkMaterial, 0, 0.061, -0.078 + i * 0.02);

    // rear display, tipped back toward the eye
    const display = new Group();
    display.position.set(0, 0.083, 0.128);
    display.rotation.x = -0.62;
    add(roundedBoxGeometry(0.078, 0.044, 0.012, 0.004, 3), this.darkMaterial, 0, 0, 0, display);
    add(new PlaneGeometry(0.068, 0.034), this.screenMaterial, 0, 0, 0.0065, display);
    add(roundedBoxGeometry(0.024, 0.03, 0.02, 0.004, 2), this.darkMaterial, 0, -0.022, -0.012, display);
    g.add(display);

    // cooling fins on both flanks, and a lit slot ahead of them
    const finGeo = roundedBoxGeometry(0.012, 0.052, 0.0045, 0.0015, 1);
    const slotGeo = roundedBoxGeometry(0.005, 0.007, 0.11, 0.002, 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) add(finGeo, this.steelMaterial, side * 0.058, 0.004, 0.085 + i * 0.0105);
      add(slotGeo, this.glowMaterial, side * 0.0565, -0.022, -0.02);
    }

    // grip and trigger
    const grip = add(roundedBoxGeometry(0.042, 0.115, 0.052, 0.014, 4), this.rubberMaterial, 0, -0.118, 0.11);
    grip.rotation.x = -0.3;
    add(roundedBoxGeometry(0.01, 0.03, 0.012, 0.003, 2), this.steelMaterial, 0, -0.088, 0.062).rotation.x = 0.35;

    // ----- field chamber: glass tube, glowing core, copper coils, three guard struts
    const C0 = -0.123;
    const C1 = -0.253;
    const mid = (C0 + C1) / 2;
    tube(0.05, 0.05, 0.012, this.steelMaterial, C0);
    tube(0.05, 0.05, 0.012, this.steelMaterial, C1);
    tube(0.009, 0.009, C0 - C1, this.coreMaterial, mid);
    for (let i = 0; i < 5; i++) add(new TorusGeometry(0.021, 0.0055, 10, 36), this.copperMaterial, 0, 0, C0 - 0.022 - i * 0.0215);
    const glass = tube(0.036, 0.036, C0 - C1, this.glassMaterial, mid, 0, true);
    glass.renderOrder = 2;
    const strutGeo = roundedBoxGeometry(0.014, 0.01, C0 - C1 + 0.012, 0.003, 2);
    for (let i = 0; i < 3; i++) {
      const arm = new Group();
      arm.rotation.z = (i / 3) * Math.PI * 2;
      add(strutGeo, this.darkMaterial, 0, 0.047, mid, arm);
      add(roundedBoxGeometry(0.02, 0.006, 0.012, 0.002, 1), this.steelMaterial, 0, 0.053, mid, arm);
      g.add(arm);
    }

    // ----- muzzle: flange, flared shroud, lit lip, recessed core
    tube(0.058, 0.058, 0.014, this.darkMaterial, C1 - 0.012);
    tube(0.062, 0.05, 0.05, this.darkMaterial, C1 - 0.043);
    tube(0.064, 0.064, 0.008, this.steelMaterial, C1 - 0.07);
    add(new TorusGeometry(0.052, 0.006, 12, 48), this.ringMaterial, 0, 0, C1 - 0.076);
    this.tip = add(new SphereGeometry(0.026, 24, 16), this.coreMaterial, 0, 0, C1 - 0.07);
    this.tip.add(new Mesh(new SphereGeometry(0.04, 24, 16), new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false,
    })));

    // focusing vanes: steel blades with a lit inner edge, splayed outward
    const vaneGeo = roundedBoxGeometry(0.007, 0.026, 0.085, 0.003, 2);
    const edgeGeo = roundedBoxGeometry(0.003, 0.004, 0.06, 0.0015, 1);
    for (let i = 0; i < 4; i++) {
      const arm = new Group();
      arm.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const vane = add(vaneGeo, this.steelMaterial, 0, 0.074, -0.022, arm);
      vane.rotation.x = 0.2;
      add(edgeGeo, this.glowMaterial, 0, -0.0135, -0.006, vane);
      this.prongs.add(arm);
    }
    this.prongs.position.z = C1 - 0.06;
    g.add(this.prongs);

    // ----- under-barrel field cell: a lit rod in glass between steel caps
    const cellY = -0.062;
    tube(0.006, 0.006, 0.09, this.coreMaterial, mid, cellY);
    tube(0.017, 0.017, 0.09, this.glassMaterial, mid, cellY, true).renderOrder = 2;
    tube(0.02, 0.02, 0.014, this.steelMaterial, mid - 0.05, cellY);
    tube(0.02, 0.02, 0.014, this.steelMaterial, mid + 0.05, cellY);

    // cables from the rail down into the chamber's rear bulkhead
    for (const side of [-1, 1]) {
      const path = new CatmullRomCurve3([
        new Vector3(side * 0.012, 0.056, -0.085),
        new Vector3(side * 0.024, 0.066, -0.108),
        new Vector3(side * 0.034, 0.056, -0.128),
        new Vector3(side * 0.036, 0.036, -0.142),
      ]);
      g.add(new Mesh(new TubeGeometry(path, 24, 0.0048, 10), this.rubberMaterial));
    }

    g.position.copy(REST);
  }

  get materials(): Material[] {
    return [
      this.bodyMaterial, this.darkMaterial, this.steelMaterial, this.copperMaterial, this.ringMaterial, this.rubberMaterial, this.glassMaterial,
    ];
  }

  /** Recolours the lit parts, flashes the core and kicks the gun back. */
  fire(color: number): void {
    this.color = color;
    this.glowMaterial.color.setHex(color).multiplyScalar(GLOW);
    this.screenMaterial.color.setHex(color).multiplyScalar(1.8);
    this.ringMaterial.color.setHex(color);
    this.ringMaterial.emissive.setHex(color);
    this.flash = 1;
    this.recoil.v += 3.2;
    this.spin += 2.1;
  }

  tipWorldPosition(target: Vector3): Vector3 {
    return this.tip.getWorldPosition(target);
  }

  /**
   * @param groundSpeed horizontal speed while grounded (0 when airborne), drives the walk bob
   * @param dip landing dip offset of the camera
   */
  animate(dt: number, groundSpeed: number, dip: number): void {
    springStep(this.recoil, 0, 180, 10, dt);
    if (groundSpeed > 0.5) this.bob += dt * groundSpeed * 1.8;
    const r = this.recoil.x;
    this.group.position.set(
      REST.x + Math.sin(this.bob) * 0.01,
      REST.y + Math.abs(Math.cos(this.bob)) * 0.01 - r * 0.012 - dip * 0.25,
      REST.z + r * 0.05,
    );
    this.group.rotation.x = r * 0.18;
    // the core burns hot on each shot and settles back
    this.flash *= Math.exp(-7 * dt);
    this.coreMaterial.color.setHex(this.color).multiplyScalar(GLOW * (1.6 + this.flash * 2.4));
    this.ringMaterial.emissiveIntensity = 1.8 + this.flash * 3;
    // vanes idle-rotate slowly, whip round and flare open on each shot
    this.spin *= Math.exp(-4 * dt);
    this.prongs.rotation.z += dt * (0.5 + this.spin * 6);
    this.prongs.scale.set(1 + r * 0.18, 1 + r * 0.18, 1);
  }
}
