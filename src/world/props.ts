import {
  AdditiveBlending, BackSide, type BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, type Material, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, OctahedronGeometry, PlaneGeometry, RingGeometry, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Quaternion,
  SRGBColorSpace, type Texture, TorusGeometry, Vector3,
} from 'three';
import { roundedBoxGeometry } from '../render/geometry';
import type { ButtonMaps, GoalMaps, SurfaceMaps } from '../render/textures';

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

/** Fine projected markings around the exit pad: a hairline, a ruler of ticks, broken arcs and chevrons. */
function exitRing(): CanvasTexture {
  return decalTexture('exit', 1024, (g, s) => {
    const c = s / 2;
    g.strokeStyle = g.fillStyle = '#ffffff';
    g.lineCap = 'butt';
    const arc = (r: number, a0: number, a1: number, w: number) => {
      g.lineWidth = s * w;
      g.beginPath();
      g.arc(c, c, s * r, a0, a1);
      g.stroke();
    };
    arc(0.368, 0, Math.PI * 2, 0.0022);
    g.globalAlpha = 0.7;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const len = i % 10 === 0 ? 0.022 : i % 5 === 0 ? 0.014 : 0.008;
      g.lineWidth = s * 0.0016;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * s * 0.376, c + Math.sin(a) * s * 0.376);
      g.lineTo(c + Math.cos(a) * s * (0.376 + len), c + Math.sin(a) * s * (0.376 + len));
      g.stroke();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      arc(0.425, a - 0.52, a + 0.52, 0.007);
      arc(0.447, a - 0.3, a + 0.3, 0.0022);
    }
    // chevrons point in toward the pad from the four gaps
    g.lineJoin = 'miter';
    g.lineWidth = s * 0.006;
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(c, c);
      g.rotate((i / 4) * Math.PI * 2);
      for (let k = 0; k < 3; k++) {
        const x = s * (0.412 + k * 0.022);
        g.globalAlpha = 1 - k * 0.3;
        g.beginPath();
        g.moveTo(x + s * 0.014, -s * 0.022); g.lineTo(x, 0); g.lineTo(x + s * 0.014, s * 0.022);
        g.stroke();
      }
      g.restore();
    }
  });
}

const BUTTON_UP = 0.15;
const BUTTON_DOWN = 0.085;
const RED = 0xe2382c;
const RED_GLOW = 0xff4a36;
const GREEN = 0x2fc98a;
const GREEN_GLOW = 0x54ffb0;
const BASE_RADIUS = 0.98;
const CAP_RADIUS = 0.68;

/**
 * Pressure plate: a machined steel base ring with a warning band and status
 * lights, a rubber gasket, and a painted cap that sinks under load.
 */
export class ButtonProp {
  readonly group = new Group();
  private readonly cap = new Group();
  private readonly capMat: MeshStandardMaterial;
  private readonly baseMat: MeshStandardMaterial;
  private readonly spring: Spring = { x: BUTTON_UP, v: 0 };
  private readonly tint = new Color(RED);
  private readonly glow = new Color(RED_GLOW);
  pressed = false;

  constructor(sideMaterial: Material, maps: ButtonMaps) {
    const add = (mesh: Mesh, y: number, parent: Group = this.group) => {
      mesh.position.y = y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const flat = (mesh: Mesh) => { mesh.rotation.x = -Math.PI / 2; return mesh; };

    // Base: flared foot, straight collar, textured top ring.
    add(new Mesh(new CylinderGeometry(BASE_RADIUS, 1.06, 0.05, 72, 1, true), sideMaterial), 0.025);
    add(new Mesh(new CylinderGeometry(BASE_RADIUS, BASE_RADIUS, 0.06, 72, 1, true), sideMaterial), 0.08);
    this.baseMat = new MeshStandardMaterial({
      ...maps.base, emissiveMap: maps.baseEmissive, emissive: this.glow.clone(), emissiveIntensity: 2, roughness: 1, metalness: 1,
    });
    add(flat(new Mesh(new RingGeometry(CAP_RADIUS + 0.02, BASE_RADIUS, 72, 1), this.baseMat)), 0.11);
    // inner wall of the well the cap sits in
    const well = new MeshStandardMaterial({ color: 0x14171c, roughness: 0.7, metalness: 0.4, side: BackSide });
    add(new Mesh(new CylinderGeometry(CAP_RADIUS + 0.02, CAP_RADIUS + 0.02, 0.11, 72, 1, true), well), 0.055);
    const rubber = new MeshStandardMaterial({ color: 0x15171b, roughness: 0.85, metalness: 0 });
    const gasket = add(new Mesh(new TorusGeometry(CAP_RADIUS + 0.022, 0.02, 10, 72), rubber), 0.108);
    gasket.rotation.x = Math.PI / 2;

    // Cap: painted disc with a chamfered shoulder.
    this.capMat = new MeshStandardMaterial({
      ...maps.cap, color: this.tint.clone(), emissiveMap: maps.capEmissive, emissive: this.glow.clone(), emissiveIntensity: 1.6,
      roughness: 1, metalness: 1,
    });
    const shoulder = new MeshStandardMaterial({ color: 0x8d949e, roughness: 0.3, metalness: 1 });
    add(new Mesh(new CylinderGeometry(CAP_RADIUS, CAP_RADIUS, 0.12, 72, 1, true), shoulder), -0.085, this.cap);
    add(new Mesh(new CylinderGeometry(CAP_RADIUS - 0.03, CAP_RADIUS, 0.025, 72, 1, true), shoulder), -0.0125, this.cap);
    add(flat(new Mesh(new CircleGeometry(CAP_RADIUS - 0.03, 72), this.capMat)), 0, this.cap);
    this.group.add(this.cap);

    this.group.add(floorDecal(hazardRing(), 2.9));
  }

  animate(dt: number): void {
    springStep(this.spring, this.pressed ? BUTTON_DOWN : BUTTON_UP, 320, 14, dt);
    this.cap.position.y = this.spring.x;
    const k = 1 - Math.exp(-14 * dt);
    this.tint.lerp(_target.setHex(this.pressed ? GREEN : RED), k);
    this.glow.lerp(_target.setHex(this.pressed ? GREEN_GLOW : RED_GLOW), k);
    this.capMat.color.copy(this.tint);
    this.capMat.emissive.copy(this.glow);
    this.baseMat.emissive.copy(this.glow);
    const level = this.pressed ? 3.2 : 1.4;
    this.capMat.emissiveIntensity += (level - this.capMat.emissiveIntensity) * k;
    this.baseMat.emissiveIntensity = this.capMat.emissiveIntensity * 1.3;
  }
}

const _target = new Color();

const GOAL_COLOR = 0x6dffc0;
const PAD_RADIUS = 1;
const PAD_TOP = 0.09;

const FIELD_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vView;
void main() {
  vUv = uv;
  vPos = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNrm = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FIELD_NOISE = /* glsl */ `
uniform float time;
uniform vec3 col;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vView;
float fieldHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.y);
}
// value noise that wraps every "period" cells across, so it closes around the column
float ringNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, period);
  float x1 = mod(i.x + 1.0, period);
  return mix(mix(fieldHash(vec2(x0, i.y)), fieldHash(vec2(x1, i.y)), f.x),
             mix(fieldHash(vec2(x0, i.y + 1.0)), fieldHash(vec2(x1, i.y + 1.0)), f.x), f.y);
}`;

/** Outer shell of the exit field: rising streaks, scan bands and a bright silhouette. */
const FIELD_FRAGMENT = /* glsl */ `${FIELD_NOISE}
void main() {
  float h = clamp(vUv.y, 0.0, 1.0);
  float u = atan(vPos.z, vPos.x) / 6.2831853 + 0.5;
  float streaks = ringNoise(vec2(u * 40.0, h * 1.6 - time * 0.7), 40.0);
  streaks = pow(streaks, 3.0);
  float fine = ringNoise(vec2(u * 110.0, h * 4.0 - time * 1.5), 110.0);
  fine = pow(fine, 4.0);
  float body = pow(1.0 - h, 2.0);
  float scan = fract(h * 2.4 - time * 0.2);
  float band = exp(-pow((scan - 0.5) * 34.0, 2.0)) * (1.0 - h);
  float foot = exp(-h * 16.0);
  float rim = pow(clamp(1.0 - abs(dot(normalize(vNrm), normalize(vView))), 0.0, 1.0), 2.0);
  float a = body * (0.05 + 0.5 * streaks + 0.35 * fine) + band * 0.2 + foot * 0.2;
  a *= 0.35 + 1.1 * rim;
  a *= smoothstep(1.0, 0.75, h);
  gl_FragColor = vec4(col * max(a, 0.0), 1.0);
}`;

/** Narrow beam up the middle: brightest where you look through its centre. */
const BEAM_FRAGMENT = /* glsl */ `${FIELD_NOISE}
void main() {
  float h = clamp(vUv.y, 0.0, 1.0);
  float facing = pow(clamp(abs(dot(normalize(vNrm), normalize(vView))), 0.0, 1.0), 2.2);
  float flicker = 0.75 + 0.25 * ringNoise(vec2(1.0, h * 9.0 - time * 5.0), 8.0);
  float a = facing * pow(1.0 - h, 1.3) * flicker * smoothstep(0.0, 0.03, h);
  gl_FragColor = vec4(col * max(a, 0.0), 1.0);
}`;

function fieldMaterial(fragmentShader: string, color: Color, time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: FIELD_VERTEX, fragmentShader, uniforms: { time, col: { value: color } },
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, fog: false,
  });
}

/** Soft round glow for the beacon's core. */
function glowTexture(): CanvasTexture {
  return decalTexture('glow', 128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,.5)');
    grd.addColorStop(0.5, 'rgba(255,255,255,.1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

/**
 * Exit pad: a machined steel deck with lit channels and a glass emitter, a
 * column of rising light, and a slow gyroscope of light marking the way out.
 */
export class GoalProp {
  readonly group = new Group();
  private readonly time = { value: 0 };
  private readonly padMat: MeshStandardMaterial;
  private readonly beacon = new Group();
  private readonly gimbals: Mesh[] = [];
  private readonly core: Mesh;
  private readonly glow: Sprite;
  private readonly ring: Mesh;

  constructor(sideMaterial: Material, maps: GoalMaps) {
    const add = (mesh: Mesh, y: number) => {
      mesh.position.y = y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    // Deck: flared foot, straight collar, textured top with a raised lip.
    add(new Mesh(new CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.08, 0.05, 72, 1, true), sideMaterial), 0.025);
    add(new Mesh(new CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.04, 72, 1, true), sideMaterial), 0.07);
    this.padMat = new MeshStandardMaterial({
      ...maps.pad, emissiveMap: maps.padEmissive, emissive: new Color(GOAL_COLOR), emissiveIntensity: 1.3, roughness: 1, metalness: 1,
    });
    const top = add(new Mesh(new CircleGeometry(PAD_RADIUS, 72), this.padMat), PAD_TOP);
    top.rotation.x = -Math.PI / 2;
    const lip = add(new Mesh(new TorusGeometry(PAD_RADIUS - 0.006, 0.012, 8, 72), sideMaterial), PAD_TOP);
    lip.rotation.x = Math.PI / 2;

    // Four low emitter housings on the rim, each with a lit slot.
    const housingMat = new MeshStandardMaterial({ color: 0x2b313a, roughness: 0.45, metalness: 0.9 });
    const slotMat = new MeshBasicMaterial({ color: new Color(GOAL_COLOR).multiplyScalar(2.6) });
    const housingGeo = roundedBoxGeometry(0.26, 0.07, 0.1, 0.018, 3);
    const slotGeo = roundedBoxGeometry(0.17, 0.012, 0.028, 0.005, 2);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 2;
      const housing = add(new Mesh(housingGeo, housingMat), PAD_TOP + 0.03);
      housing.position.x = Math.cos(a) * (PAD_RADIUS - 0.055);
      housing.position.z = Math.sin(a) * (PAD_RADIUS - 0.055);
      housing.rotation.y = Math.PI / 2 - a;
      const slot = new Mesh(slotGeo, slotMat);
      slot.position.y = 0.034;
      housing.add(slot);
    }

    // Glass dome over the emitter lens.
    const dome = new Mesh(
      new SphereGeometry(0.255, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false }),
    );
    dome.scale.y = 0.16;
    dome.position.y = PAD_TOP;
    this.group.add(dome);

    // Field: an outer shell of rising streaks around a narrow beam.
    const shell = new Mesh(
      new CylinderGeometry(0.8, 0.86, 2.7, 72, 1, true),
      fieldMaterial(FIELD_FRAGMENT, new Color(GOAL_COLOR).multiplyScalar(0.9), this.time),
    );
    shell.position.y = PAD_TOP + 1.35;
    this.group.add(shell);
    const beam = new Mesh(
      new CylinderGeometry(0.02, 0.085, 2.5, 32, 1, true),
      fieldMaterial(BEAM_FRAGMENT, new Color(0xc9ffe6).multiplyScalar(1.1), this.time),
    );
    beam.position.y = PAD_TOP + 1.25;
    this.group.add(beam);

    this.ring = floorDecal(exitRing(), 3.2, true, new Color(GOAL_COLOR).multiplyScalar(1.5));
    this.group.add(this.ring);

    // Beacon: three nested gimbal rings of light around a hard bright core.
    const lineMat = new MeshBasicMaterial({ color: new Color(GOAL_COLOR).multiplyScalar(2.2) });
    for (const r of [0.3, 0.235, 0.17]) {
      const gimbal = new Mesh(new TorusGeometry(r, 0.007, 8, 64), lineMat);
      this.gimbals.push(gimbal);
      this.beacon.add(gimbal);
    }
    this.core = new Mesh(new OctahedronGeometry(0.075), new MeshBasicMaterial({ color: new Color(0xf2fff8).multiplyScalar(2.6) }));
    this.core.scale.y = 1.35;
    this.beacon.add(this.core);
    this.glow = new Sprite(new SpriteMaterial({
      map: glowTexture(), color: new Color(GOAL_COLOR).multiplyScalar(0.9), blending: AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.glow.scale.setScalar(1.1);
    this.beacon.add(this.glow);
    this.beacon.position.y = 1.75;
    this.group.add(this.beacon);
  }

  animate(time: number): void {
    this.time.value = time;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);
    this.padMat.emissiveIntensity = 1.1 + pulse * 0.5;
    const [a, b, c] = this.gimbals;
    a.rotation.set(time * 0.55, time * 0.35, 0);
    b.rotation.set(-time * 0.8, 0, time * 0.5);
    c.rotation.set(0, time * 1.2, -time * 0.9);
    this.core.rotation.y = time * 1.1;
    this.glow.scale.setScalar(1 + pulse * 0.2);
    this.beacon.position.y = 1.75 + Math.sin(time * 1.3) * 0.05;
    this.ring.rotation.z = -time * 0.12;
  }
}

export const CUBE_SIZE = 0.7;

const UP = new Vector3(0, 1, 0);
/** Turns a torus (which lies in XY) to lie flat in XZ. */
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

const CUBE_CORE = 0xffc23d;

/**
 * The weighted crate: a textured rounded shell with corner bumpers, steel
 * edge rails and a glowing core behind a lens on every face.
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

  // Corner bumpers: a rubberised block with a steel cap plate on each outer face.
  const bumperMat = new MeshStandardMaterial({ color: 0x2a3244, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.9 });
  const steelMat = new MeshStandardMaterial({ color: 0x9aa3b0, roughness: 0.28, metalness: 1 });
  const bumperGeo = roundedBoxGeometry(0.235, 0.235, 0.235, 0.05, 4);
  const capGeo = new CylinderGeometry(0.05, 0.058, 0.014, 20);
  const b = half - 0.1;
  for (const x of [-b, b]) for (const y of [-b, b]) for (const z of [-b, b]) {
    const bumper = new Mesh(bumperGeo, bumperMat);
    bumper.position.set(x, y, z);
    bumper.castShadow = true;
    bumper.receiveShadow = true;
    mesh.add(bumper);
    for (const axis of [new Vector3(Math.sign(x), 0, 0), new Vector3(0, Math.sign(y), 0), new Vector3(0, 0, Math.sign(z))]) {
      const cap = new Mesh(capGeo, steelMat);
      cap.position.copy(axis).multiplyScalar(0.235 / 2 + 0.004);
      cap.quaternion.setFromUnitVectors(UP, axis);
      bumper.add(cap);
    }
  }

  // Edge rails tie the bumpers together and break up the silhouette.
  const railGeo = roundedBoxGeometry(0.2, 0.05, 0.05, 0.015, 3);
  const e = half - 0.012;
  for (let axis = 0; axis < 3; axis++) {
    for (const u of [-e, e]) for (const v of [-e, e]) {
      const rail = new Mesh(railGeo, steelMat);
      if (axis === 0) rail.position.set(0, u, v);
      else if (axis === 1) { rail.position.set(u, 0, v); rail.rotation.z = Math.PI / 2; }
      else { rail.position.set(u, v, 0); rail.rotation.y = Math.PI / 2; }
      rail.castShadow = true;
      mesh.add(rail);
    }
  }

  const coreMat = new MeshBasicMaterial({ color: new Color(CUBE_CORE).multiplyScalar(2.5) });
  const coreGeo = new SphereGeometry(0.08, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const bezelGeo = new TorusGeometry(0.096, 0.012, 10, 40);
  const lensMat = new MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false,
  });
  const faces: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [x, y, z] of faces) {
    const core = new Mesh(coreGeo, coreMat);
    core.position.set(x, y, z).multiplyScalar(half * 0.97 - 0.012);
    core.scale.set(1, 0.45, 1);
    // dome's local +y points out of the face
    core.quaternion.setFromUnitVectors(UP, core.position.clone().normalize());
    mesh.add(core);
    // knurled steel bezel and a glass lens over the core
    const bezel = new Mesh(bezelGeo, steelMat);
    bezel.position.copy(core.position);
    bezel.quaternion.copy(core.quaternion).multiply(FLAT);
    mesh.add(bezel);
    const lens = new Mesh(coreGeo, lensMat);
    lens.position.copy(core.position);
    lens.quaternion.copy(core.quaternion);
    lens.scale.set(1.12, 0.62, 1.12);
    mesh.add(lens);
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
