import {
  AdditiveBlending, type Camera, Color, HalfFloatType, LinearFilter, Matrix4, Mesh, PlaneGeometry, type Scene, ShaderMaterial, Vector2,
  Vector3, Vector4, WebGLRenderTarget,
} from 'three';
import { PORTAL_COLORS, PORTAL_HALF_H, PORTAL_HALF_W, type PortalIndex } from './config';
import { pointInside } from './physics';
import type { Block } from './world/world';

const ROTATE_180 = new Matrix4().makeRotationY(Math.PI);

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NOISE = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    amp *= 0.5;
  }
  return v;
}
/** Thin bright veins where the noise crosses its midpoint. */
float veins(vec2 p, float sharp) { return pow(1.0 - clamp(abs(fbm(p) - 0.5) * 7.0, 0.0, 1.0), sharp); }
`;

/** Radius of the aperture, in units of the portal's half-size. Everything outside it is energy. */
const APERTURE = 0.82;

/**
 * Portal surface: a turbulent plasma ring around an aperture. The "view"
 * variant samples a screen-space render target showing what's on the other
 * side once both portals are open, bent slightly by the heat of the rim.
 *
 * Screen space is relative to `view`, the viewport being drawn into (the whole
 * canvas on a flat screen, one eye's half of the framebuffer in VR), and `atlas`
 * says which part of the render target holds that viewport's picture.
 */
function fragmentShader(withView: boolean): string {
  return /* glsl */ `
  ${withView ? `uniform sampler2D map; uniform vec4 view; uniform vec4 atlas; uniform vec2 pad; uniform float open;
  // Clamped so a bent lookup at the edge of one eye's picture can't reach into the other's.
  vec4 seeThrough(vec2 uv) { return texture2D(map, clamp(uv, pad, 1.0 - pad) * atlas.zw + atlas.xy); }` : ''}
  uniform vec3 col; uniform float time; uniform float grow; uniform float surge;
  varying vec2 vUv;
  ${NOISE}

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > grow) discard;
    float rn = r / max(grow, 0.001);
    vec2 dir = p / max(r, 1e-4);

    // Two scales of drifting turbulence shape the rim; sampled on the
    // direction vector so there is no seam around the ring.
    float n1 = fbm(dir * 2.4 + vec2(time * 0.31, -time * 0.23) + rn * 1.3);
    float n2 = fbm(dir * 6.5 + vec2(-time * 0.55, time * 0.47) + n1 * 1.7);
    float edge = ${APERTURE.toFixed(2)} + (n1 - 0.5) * 0.045 + (n2 - 0.5) * 0.022;
    float d = rn - edge;
    float inside = 1.0 - smoothstep(-fwidth(d), fwidth(d), d);

    // Dormant portal: a dark vortex with faint veins of energy spiralling in.
    float twist = time * 0.45 + 2.2 / (rn + 0.3);
    vec2 sp = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * p;
    float cloud = fbm(sp * 2.6 + n1);
    float vein = veins(sp * 3.4 - time * 0.12, 7.0);
    float depth = smoothstep(0.0, 1.0, rn);
    vec3 c = col * (0.015 + 0.22 * cloud * cloud * depth) + col * vein * depth * depth * 0.9;
    ${withView ? `if (open > 0.5) {
      // Heat shimmer: the view bends more the closer it is to the rim, with a
      // hint of colour separation.
      float lens = smoothstep(-0.2, 0.0, d);
      vec2 bend = (vec2(n1, n2) - 0.5) * 0.022 * lens * lens;
      vec2 suv = (gl_FragCoord.xy - view.xy) / view.zw + bend;
      c = vec3(
        seeThrough(suv + bend * 0.35).r,
        seeThrough(suv).g,
        seeThrough(suv - bend * 0.35).b
      );
      c *= 1.0 - 0.3 * lens * lens;
    }` : ''}
    // light from the rim spilling into the aperture
    c += col * (exp(d * 26.0) * 0.75 + exp(d * 7.0) * 0.04) * (1.0 + surge * 2.0);

    // Plasma: fine veins streaming outward from the rim, fading with distance.
    float out_ = max(d, 0.0);
    float streamA = veins(dir * 7.0 + vec2(rn * 5.0 - time * 1.1, time * 0.4), 3.0);
    float streamB = veins(dir * 15.0 + vec2(time * 0.7, rn * 9.0 - time * 1.9), 5.0);
    float plasma = exp(-out_ * 17.0) * (0.3 + 1.5 * streamA * n2 + 0.9 * streamB * n1);
    plasma *= smoothstep(-0.025, 0.0, d);
    // The core: a hair-thin, near-white line where the aperture meets the plasma.
    float core = exp(-abs(d) * (120.0 - 60.0 * surge));
    float soft = exp(-abs(d) * 30.0);
    vec3 energy = col * plasma * 2.4 + col * soft * 1.6 + (col * 3.0 + vec3(1.2)) * core * 1.5;
    energy *= 1.0 + surge * 2.5;

    float lum = max(energy.r, max(energy.g, energy.b));
    float fade = 1.0 - smoothstep(0.9, 1.0, rn);
    float alpha = max(inside, clamp(lum * 0.9, 0.0, 1.0) * fade);
    c = mix(energy, c + energy, inside);
    gl_FragColor = vec4(c, alpha);
    // No-ops under the desktop post-processing chain (which tone-maps at the end);
    // in VR the frame is drawn straight to the headset, so this is where it happens.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
}

/** How much larger than the portal the wall-glow quad is. */
const HALO_SCALE = 1.9;

/** Additive glow and drifting wisps on the wall around the portal. */
const HALO_FRAGMENT = /* glsl */ `
uniform vec3 col; uniform float time; uniform float grow; uniform float surge;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * ${HALO_SCALE.toFixed(2)};
  float r = length(p);
  float rn = r / max(grow, 0.001);
  vec2 dir = p / max(r, 1e-4);
  float d = max(rn - ${APERTURE.toFixed(2)}, 0.0);
  float n = fbm(dir * 3.0 + vec2(rn * 2.2 - time * 0.5, time * 0.2));
  float wisp = veins(dir * 5.0 + vec2(rn * 3.0 - time * 0.8, -time * 0.3), 4.0);
  float glow = exp(-d * 3.4) * 0.13 + exp(-d * 9.0) * 0.5 * (0.5 + n) + exp(-d * 6.0) * wisp * n * 0.55;
  glow *= smoothstep(${(APERTURE - 0.06).toFixed(2)}, ${(APERTURE + 0.03).toFixed(2)}, rn);
  glow *= 1.0 - smoothstep(${(HALO_SCALE * 0.55).toFixed(2)}, ${(HALO_SCALE * 0.98).toFixed(2)}, r);
  gl_FragColor = vec4(col * glow * (1.0 + surge * 2.0) * grow, 1.0);
}`;

/** Where one viewport's picture of the view through a portal is, and which camera draws that viewport. */
export interface PortalEye {
  /** The camera the main render uses for this viewport. */
  camera: Camera;
  /** The viewport in framebuffer pixels: x, y, width, height. */
  view: Vector4;
  /** The matching part of the portal's render target, in UV: offset x, y, scale x, y. */
  atlas: Vector4;
}

const WHOLE_TARGET = new Vector4(0, 0, 1, 1);

export class Portal {
  readonly color: number;
  readonly renderTarget = new WebGLRenderTarget(16, 16, {
    minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType,
  });
  /** Material that shows the view through the portal. */
  readonly viewMaterial: ShaderMaterial;
  /** Plain swirl material, used while rendering portal views (avoids recursion). */
  readonly flatMaterial: ShaderMaterial;
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly grow = { value: 0 };
  /** Energy burst right after placement: 1 → 0. */
  private readonly surge = { value: 0 };
  /** Progress (0–1) of the opening animation. */
  private popAnim = 1;
  /** Mesh matrix without the pop scaling. */
  private readonly baseMatrix = new Matrix4();
  /** VR only: one entry per eye. Empty on a flat screen, where the target is the whole view. */
  private eyes: readonly PortalEye[] = [];

  placed = false;
  readonly center = new Vector3();
  readonly normal = new Vector3();
  readonly up = new Vector3();
  readonly right = new Vector3();
  host: Block | null = null;
  /** Portal-local → world. Local axes: x = right, y = up, z = normal. */
  readonly matrix = new Matrix4();
  /** World → portal-local. */
  readonly inverse = new Matrix4();

  constructor(color: number, time: { value: number }) {
    this.color = color;
    const col = new Color(color);
    this.viewMaterial = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: fragmentShader(true),
      uniforms: {
        map: { value: this.renderTarget.texture },
        view: { value: new Vector4(0, 0, 1, 1) },
        atlas: { value: WHOLE_TARGET },
        pad: { value: new Vector2(0, 0) },
        open: { value: 0 },
        col: { value: col },
        time,
        grow: this.grow,
        surge: this.surge,
      },
      transparent: true,
    });
    this.flatMaterial = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: fragmentShader(false),
      uniforms: { col: { value: col }, time, grow: this.grow, surge: this.surge },
      transparent: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(PORTAL_HALF_W * 2, PORTAL_HALF_H * 2), this.viewMaterial);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    // In VR the mesh is drawn once per eye; point the shader at that eye's picture.
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      const eye = this.eyes.find((e) => e.camera === camera);
      if (!eye) return;
      this.viewMaterial.uniforms.view.value = eye.view;
      this.viewMaterial.uniforms.atlas.value = eye.atlas;
      this.viewMaterial.uniformsNeedUpdate = true;
    };

    const halo = new Mesh(
      new PlaneGeometry(PORTAL_HALF_W * 2 * HALO_SCALE, PORTAL_HALF_H * 2 * HALO_SCALE),
      new ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: HALO_FRAGMENT,
        uniforms: { col: { value: col }, time, grow: this.grow, surge: this.surge },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.position.z = -0.006;
    this.mesh.add(halo);
  }

  set(center: Vector3, right: Vector3, up: Vector3, normal: Vector3, host: Block): void {
    this.center.copy(center);
    this.normal.copy(normal);
    this.up.copy(up);
    this.right.copy(right);
    this.host = host;
    this.placed = true;
    this.matrix.makeBasis(right, up, normal).setPosition(center);
    this.inverse.copy(this.matrix).invert();
    // Nudge the visible plane off the wall to avoid z-fighting.
    this.baseMatrix.copy(this.matrix).setPosition(center.clone().addScaledVector(normal, 0.012));
    this.mesh.matrix.copy(this.baseMatrix);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.mesh.visible = true;
    this.grow.value = 0;
    this.popAnim = 0;
  }

  remove(): void {
    this.placed = false;
    this.mesh.visible = false;
    this.host = null;
  }

  setOpen(open: boolean): void {
    this.viewMaterial.uniforms.open.value = open ? 1 : 0;
  }

  /** Flat screen: one picture covering the whole drawing buffer. */
  resize(drawSize: Vector2, rtScale: number, samples: number): void {
    this.setTarget(Math.round(drawSize.x * rtScale), Math.round(drawSize.y * rtScale), samples);
    this.eyes = [];
    const { view, atlas, pad } = this.viewMaterial.uniforms;
    view.value = new Vector4(0, 0, drawSize.x, drawSize.y);
    atlas.value = WHOLE_TARGET;
    (pad.value as Vector2).set(0, 0);
  }

  /**
   * VR: one picture per eye, side by side in the render target, each `eyeWidth` × `eyeHeight`
   * target pixels. Cheap to call every frame; the target is only rebuilt when its size changes.
   */
  resizeForEyes(eyes: readonly PortalEye[], eyeWidth: number, eyeHeight: number, samples: number): void {
    this.setTarget(eyeWidth * eyes.length, eyeHeight, samples);
    this.eyes = eyes;
    // Half a texel in from each edge, so filtering never blends in the neighbouring eye.
    (this.viewMaterial.uniforms.pad.value as Vector2).set(0.5 / eyeWidth, 0.5 / eyeHeight);
  }

  private setTarget(width: number, height: number, samples: number): void {
    const rt = this.renderTarget;
    if (rt.samples !== samples) {
      rt.samples = samples;
      rt.dispose();
    }
    width = Math.max(1, width);
    height = Math.max(1, height);
    if (rt.width !== width || rt.height !== height) rt.setSize(width, height);
    // setSize resets these only when the size changes; VR leaves them on one eye's region.
    rt.viewport.set(0, 0, width, height);
    rt.scissor.set(0, 0, width, height);
    rt.scissorTest = false;
  }

  private static readonly _scale = new Matrix4();

  animate(dt: number): void {
    if (!this.placed) return;
    if (this.popAnim < 1) {
      this.popAnim = Math.min(1, this.popAnim + dt * 1.8);
      // The aperture tears open fast, then eases out; the rim burns hot and settles.
      const t = Math.min(1, this.popAnim * 2.4);
      this.grow.value = 1 - (1 - t) ** 3;
      this.surge.value = (1 - this.popAnim) ** 2;
      const s = 1 + Math.sin(this.popAnim * Math.PI) * (1 - this.popAnim) * 0.06;
      Portal._scale.makeScale(s, s, 1);
      this.mesh.matrix.copy(this.baseMatrix).multiply(Portal._scale);
      this.mesh.matrixWorldNeedsUpdate = true;
    }
  }
}

/** Candidate nudges (in a 2.8 × 2.8 grid) tried nearest-first when a portal doesn't fit where aimed. */
const NUDGES: Array<readonly [number, number]> = [];
for (let a = -14; a <= 14; a++) for (let b = -14; b <= 14; b++) NUDGES.push([a * 0.1, b * 0.1]);
NUDGES.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]));

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];
const _q = new Vector3();

export class PortalSystem {
  readonly time = { value: 0 };
  readonly list: readonly [Portal, Portal];

  constructor(scene: Scene) {
    this.list = [new Portal(PORTAL_COLORS[0], this.time), new Portal(PORTAL_COLORS[1], this.time)];
    for (const p of this.list) scene.add(p.mesh);
  }

  get bothOpen(): boolean {
    return this.list[0].placed && this.list[1].placed;
  }

  /** Maps world-space through `from` and out of `to`. */
  transferMatrix(from: Portal, to: Portal): Matrix4 {
    return new Matrix4().multiplyMatrices(to.matrix, ROTATE_180).multiply(from.inverse);
  }

  reset(): void {
    for (const p of this.list) p.remove();
  }

  animate(dt: number): void {
    for (const p of this.list) p.animate(dt);
  }

  resize(drawSize: Vector2, rtScale: number, samples: number): void {
    for (const p of this.list) p.resize(drawSize, rtScale, samples);
  }

  resizeForEyes(eyes: readonly PortalEye[], eyeWidth: number, eyeHeight: number, samples: number): void {
    for (const p of this.list) p.resizeForEyes(eyes, eyeWidth, eyeHeight, samples);
  }

  /**
   * Tries to place portal `idx` on `host` near `hitPoint`, sliding it to the nearest
   * spot where it fits. Returns the placed portal, or null if there's no room.
   */
  place(idx: PortalIndex, hitPoint: Vector3, normalIn: Vector3, dir: Vector3, host: Block, blocks: readonly Block[]): Portal | null {
    const n = normalIn.clone();
    let u: Vector3;
    if (Math.abs(n.y) < 0.5) u = new Vector3(0, 1, 0);
    else if (Math.abs(dir.x) > Math.abs(dir.z)) u = new Vector3(Math.sign(dir.x), 0, 0);
    else u = new Vector3(0, 0, Math.sign(dir.z) || 1);
    const r = new Vector3().crossVectors(u, n);

    // Snap onto the surface and clamp inside the host face.
    const c = hitPoint.clone();
    for (const k of AXES) {
      if (Math.abs(n[k]) > 0.5) {
        c[k] = n[k] > 0 ? host.max[k] : host.min[k];
        continue;
      }
      const ext = Math.abs(r[k]) * PORTAL_HALF_W + Math.abs(u[k]) * PORTAL_HALF_H;
      const lo = host.min[k] + ext;
      const hi = host.max[k] - ext;
      if (lo > hi + 1e-6) return null;
      c[k] = Math.min(hi, Math.max(lo, c[k]));
    }

    const fits = (pos: Vector3) => this.fits(pos, r, u, n, host, idx, blocks);
    let found: Vector3 | null = null;
    for (const [a, b] of NUDGES) {
      const cand = c.clone().addScaledVector(r, a).addScaledVector(u, b);
      if (fits(cand)) { found = cand; break; }
    }
    if (!found) return null;

    // On walls, slide the portal down toward the floor so it's easy to walk into.
    if (Math.abs(n.y) < 0.5 && !fits(found.clone().addScaledVector(u, -1.25))) {
      let best = 0;
      for (let s = 0.05; s <= 1.25; s += 0.05) {
        if (fits(found.clone().addScaledVector(u, -s))) best = s;
        else break;
      }
      found.addScaledVector(u, -best);
    }

    const portal = this.list[idx];
    portal.set(found, r, u, n, host);
    return portal;
  }

  private fits(c: Vector3, r: Vector3, u: Vector3, n: Vector3, host: Block, idx: PortalIndex, blocks: readonly Block[]): boolean {
    // Corners must lie on the host face.
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        _q.copy(c).addScaledVector(r, a * PORTAL_HALF_W).addScaledVector(u, b * PORTAL_HALF_H);
        for (const k of AXES) {
          if (Math.abs(n[k]) > 0.5) continue;
          if (_q[k] < host.min[k] - 1e-3 || _q[k] > host.max[k] + 1e-3) return false;
        }
      }
    }
    // Nothing else may poke through the front of the portal.
    for (const a of [-0.95, 0, 0.95]) {
      for (const b of [-0.95, -0.5, 0, 0.5, 0.95]) {
        _q.copy(c).addScaledVector(r, a * PORTAL_HALF_W).addScaledVector(u, b * PORTAL_HALF_H).addScaledVector(n, 0.06);
        for (const bx of blocks) {
          if (!bx.active || bx === host) continue;
          if (pointInside(_q, bx)) return false;
        }
      }
    }
    // Must not overlap the other portal on the same plane.
    const other = this.list[idx === 0 ? 1 : 0];
    if (other.placed && other.normal.dot(n) > 0.99) {
      const dd = c.clone().sub(other.center);
      if (Math.abs(dd.dot(n)) < 0.05) {
        if (other.up.dot(u) > 0.99) {
          if (Math.abs(dd.dot(r)) < 2 * PORTAL_HALF_W && Math.abs(dd.dot(u)) < 2 * PORTAL_HALF_H) return false;
        } else if (dd.length() < 2 * PORTAL_HALF_H) {
          return false;
        }
      }
    }
    return true;
  }
}
