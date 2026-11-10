import {
  CatmullRomCurve3, Color, CylinderGeometry, Group, type Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import { BLUE } from '../config';
import { springStep, type Spring } from '../world/props';
import { roundedBoxGeometry } from './geometry';
import type { SurfaceMaps } from './textures';

const REST = new Vector3(0.21, -0.2, -0.42);
/** HDR boost for the glowing parts, so they catch the bloom pass. */
const GLOW = 3.2;

/** The view-model portal device held in front of the camera. */
export class Gun {
  readonly group = new Group();
  /** Glossy cream shell with a clear lacquer coat; panel seams and trim come from its texture set. */
  readonly bodyMaterial: MeshPhysicalMaterial;
  /** The same lacquer without the panel texture, for the rounded end cap. */
  private readonly capMaterial = new MeshPhysicalMaterial({
    color: 0xe9e0d0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1,
  });
  private readonly rubberMaterial = new MeshStandardMaterial({ color: 0x14181f, roughness: 0.75, envMapIntensity: 0.6 });
  /** Smoked glass of the charge canister. */
  private readonly glassMaterial = new MeshPhysicalMaterial({
    color: 0xcfe6ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.02,
    envMapIntensity: 1.6, depthWrite: false,
  });
  /** Dark navy trim, also reused for the floor button base. */
  readonly darkMaterial = new MeshStandardMaterial({ color: 0x2b4060, roughness: 0.35, metalness: 0.2, envMapIntensity: 1 });
  private readonly chromeMaterial = new MeshStandardMaterial({ color: 0xb9c6d6, roughness: 0.28, metalness: 1, envMapIntensity: 0.75 });
  private readonly ringMaterial = new MeshStandardMaterial({ color: BLUE, emissive: BLUE, emissiveIntensity: 1.6, roughness: 0.3 });
  private readonly glowMaterial = new MeshBasicMaterial({ color: new Color(BLUE).multiplyScalar(GLOW), toneMapped: true });
  private readonly coreMaterial = new MeshBasicMaterial({ color: new Color(BLUE).multiplyScalar(GLOW * 1.6) });
  private readonly tip: Mesh;
  private readonly prongs = new Group();
  private readonly recoil: Spring = { x: 0, v: 0 };
  private bob = 0;
  private spin = 0;

  constructor(maps: SurfaceMaps) {
    const g = this.group;
    this.bodyMaterial = new MeshPhysicalMaterial({
      ...maps, roughness: 1, metalness: 1, clearcoat: 0.7, clearcoatRoughness: 0.15, envMapIntensity: 1,
    });

    // main shell
    const bodyGeo = roundedBoxGeometry(0.13, 0.12, 0.3, 0.05, 8);
    // Turn the texture on the top and bottom faces so its long axis follows the barrel there too.
    const uv = bodyGeo.attributes.uv;
    const perFace = uv.count / 6;
    for (let i = perFace * 2; i < perFace * 4; i++) uv.setXY(i, 1 - uv.getY(i), uv.getX(i));
    const body = new Mesh(bodyGeo, this.bodyMaterial);
    body.position.z = 0.02;
    const back = new Mesh(new SphereGeometry(0.068, 32, 20), this.capMaterial);
    back.scale.set(1, 0.92, 0.85);
    back.position.z = 0.165;
    const backRing = new Mesh(new TorusGeometry(0.058, 0.009, 12, 40), this.darkMaterial);
    backRing.position.z = 0.15;

    // top fin and under-grip
    const fin = new Mesh(roundedBoxGeometry(0.028, 0.06, 0.18, 0.012, 4), this.darkMaterial);
    fin.position.set(0, 0.078, 0.04);
    const grip = new Mesh(roundedBoxGeometry(0.05, 0.11, 0.06, 0.02, 4), this.darkMaterial);
    grip.position.set(0, -0.085, 0.07);
    grip.rotation.x = -0.35;

    // glowing side strips show the active portal colour
    for (const side of [-1, 1]) {
      const strip = new Mesh(roundedBoxGeometry(0.006, 0.018, 0.16, 0.003, 2), this.glowMaterial);
      strip.position.set(side * 0.066, 0.012, 0.02);
      g.add(strip);
    }

    // emitter: collar, barrel, ring, three claws around a glowing core
    const collar = new Mesh(new CylinderGeometry(0.072, 0.072, 0.03, 40), this.chromeMaterial);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = -0.135;
    const barrel = new Mesh(new CylinderGeometry(0.068, 0.054, 0.1, 40), this.darkMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.195;
    const ring = new Mesh(new TorusGeometry(0.056, 0.012, 16, 40), this.ringMaterial);
    ring.position.z = -0.245;

    for (let i = 0; i < 3; i++) {
      const arm = new Group();
      arm.rotation.z = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const claw = new Mesh(roundedBoxGeometry(0.018, 0.022, 0.085, 0.008, 3), this.chromeMaterial);
      claw.position.set(0, 0.058, -0.03);
      claw.rotation.x = 0.32;
      arm.add(claw);
      this.prongs.add(arm);
    }
    this.prongs.position.z = -0.25;

    this.tip = new Mesh(new SphereGeometry(0.03, 24, 16), this.coreMaterial);
    this.tip.position.z = -0.262;
    const halo = new Mesh(new SphereGeometry(0.042, 24, 16), new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false,
    }));
    this.tip.add(halo);

    // charge canister riding on the fin: a glowing rod inside smoked glass, capped in chrome
    const rod = new Mesh(new CylinderGeometry(0.0075, 0.0075, 0.13, 16), this.coreMaterial);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(0, 0.118, 0.04);
    const glass = new Mesh(new CylinderGeometry(0.019, 0.019, 0.13, 32), this.glassMaterial);
    glass.rotation.x = Math.PI / 2;
    glass.position.copy(rod.position);
    glass.renderOrder = 2;
    for (const z of [-0.03, 0.11]) {
      const cap = new Mesh(new CylinderGeometry(0.022, 0.022, 0.014, 32), this.chromeMaterial);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(0, 0.118, z);
      g.add(cap);
    }

    // two cables feeding the emitter from the canister
    for (const side of [-1, 1]) {
      const path = new CatmullRomCurve3([
        new Vector3(side * 0.012, 0.118, -0.036),
        new Vector3(side * 0.03, 0.112, -0.075),
        new Vector3(side * 0.048, 0.08, -0.115),
        new Vector3(side * 0.05, 0.048, -0.15),
      ]);
      g.add(new Mesh(new TubeGeometry(path, 24, 0.0055, 10), this.rubberMaterial));
    }

    // knurled dial on the left flank
    const dial = new Mesh(new CylinderGeometry(0.022, 0.022, 0.012, 24), this.chromeMaterial);
    dial.rotation.z = Math.PI / 2;
    dial.position.set(-0.068, 0.02, 0.11);
    const dialDot = new Mesh(new CylinderGeometry(0.008, 0.008, 0.014, 16), this.glowMaterial);
    dialDot.rotation.z = Math.PI / 2;
    dialDot.position.copy(dial.position);

    g.add(body, back, backRing, fin, grip, collar, barrel, ring, this.prongs, this.tip, rod, glass, dial, dialDot);
    g.position.copy(REST);
  }

  get materials(): Material[] {
    return [this.bodyMaterial, this.capMaterial, this.darkMaterial, this.chromeMaterial, this.ringMaterial, this.rubberMaterial, this.glassMaterial];
  }

  /** Recolours the emitter and side strips and kicks the gun back. */
  fire(color: number): void {
    this.coreMaterial.color.setHex(color).multiplyScalar(GLOW * 1.6);
    this.glowMaterial.color.setHex(color).multiplyScalar(GLOW);
    this.ringMaterial.color.setHex(color);
    this.ringMaterial.emissive.setHex(color);
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
    // claws idle-rotate slowly and whip round on each shot
    this.spin *= Math.exp(-4 * dt);
    this.prongs.rotation.z += dt * (0.6 + this.spin * 6);
    this.prongs.scale.setScalar(1 + r * 0.12);
  }
}
