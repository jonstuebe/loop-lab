import {
  Color, HalfFloatType, LinearFilter, Matrix4, Mesh, PlaneGeometry, type Scene, ShaderMaterial, Vector2, Vector3,
  WebGLRenderTarget,
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

/**
 * Swirly ring shader. The "view" variant samples a screen-space render target
 * showing what's on the other side once both portals are open.
 */
function fragmentShader(withView: boolean): string {
  return /* glsl */ `
  ${withView ? 'uniform sampler2D map; uniform vec2 res; uniform float open;' : ''}
  uniform vec3 col; uniform float time; uniform float grow;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > grow) discard;
    float rn = r / max(grow, 0.001);
    float a = atan(p.y, p.x);
    float aa = fwidth(rn) * 1.5;

    // Closed portal: a slow, deep swirl.
    float sw = sin(a * 3.0 + time * 3.0 - rn * 9.0) * 0.5 + 0.5;
    float sw2 = sin(a * 5.0 - time * 2.2 + rn * 14.0) * 0.5 + 0.5;
    vec3 c = mix(col * 0.25 + 0.03, col * 1.3 + 0.08, sw * rn);
    c += col * sw2 * rn * 0.35;
    ${withView ? `if (open > 0.5) {
      c = texture2D(map, gl_FragCoord.xy / res).rgb;
      // tint and brighten toward the rim so the view sits inside a field of light
      float edge = smoothstep(0.6, 0.82, rn);
      c = mix(c, c * 0.75 + col * 0.7, edge * edge * 0.45);
    }` : ''}

    // Wobbling energy rim: hottest at its inner edge, licking outward like a flame.
    // HDR, so the bloom pass gives it a halo.
    float wob = 0.014 * sin(a * 5.0 + time * 4.0) + 0.008 * sin(a * 11.0 - time * 6.5);
    float band = smoothstep(0.80 + wob - aa, 0.86 + wob, rn);
    float t = clamp((rn - 0.84 - wob) / 0.16, 0.0, 1.0);
    float flame = 0.5 + 0.5 * sin(a * 9.0 + time * 5.0 + 2.0 * sin(a * 4.0 - time * 3.0));
    float lick = 0.5 + 0.5 * sin(a * 23.0 - time * 7.0 + 3.0 * sin(a * 6.0 + time * 2.0));
    vec3 rimCol = col * (0.45 + 2.3 * pow(1.0 - t, 1.7)) * (0.75 + 0.5 * flame);
    c = mix(c, rimCol, band);

    // bright inner seam just inside the rim
    float seam = smoothstep(0.76 + wob - aa, 0.80 + wob, rn) * (1.0 - smoothstep(0.80 + wob, 0.835 + wob + aa, rn));
    c = mix(c, vec3(0.9) + col * 3.0, seam * 0.9);

    // drifting sparks in the rim
    vec2 cell = vec2(floor((a + 3.1416) * 9.0 + time * 1.7), floor(rn * 14.0 - time * 3.0));
    float spark = step(0.93, hash(cell)) * band;
    c += col * spark * 2.0;

    // anti-aliased outer edge
    float alpha = 1.0 - smoothstep(1.0 - aa * 1.5, 1.0, rn);
    // ragged, flickering outer edge instead of a hard oval
    alpha *= 1.0 - smoothstep(0.25 + 0.45 * flame + 0.25 * lick, 1.0, t) * 0.92;
    gl_FragColor = vec4(c, alpha);
  }`;
}

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
  /** Progress (0–1) of the squash-and-stretch pop when placed. */
  private popAnim = 1;
  /** Mesh matrix without the pop scaling. */
  private readonly baseMatrix = new Matrix4();

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
        res: { value: new Vector2(1, 1) },
        open: { value: 0 },
        col: { value: col },
        time,
        grow: this.grow,
      },
      transparent: true,
    });
    this.flatMaterial = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: fragmentShader(false),
      uniforms: { col: { value: col }, time, grow: this.grow },
      transparent: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(PORTAL_HALF_W * 2, PORTAL_HALF_H * 2), this.viewMaterial);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
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

  resize(drawSize: Vector2, rtScale: number, samples: number): void {
    if (this.renderTarget.samples !== samples) {
      this.renderTarget.samples = samples;
      this.renderTarget.dispose();
    }
    this.renderTarget.setSize(
      Math.max(1, Math.round(drawSize.x * rtScale)),
      Math.max(1, Math.round(drawSize.y * rtScale)),
    );
    (this.viewMaterial.uniforms.res.value as Vector2).copy(drawSize);
  }

  private static readonly _scale = new Matrix4();

  animate(dt: number): void {
    if (!this.placed) return;
    this.grow.value = Math.min(1, this.grow.value + dt * 7);
    if (this.popAnim < 1) {
      this.popAnim = Math.min(1, this.popAnim + dt * 2.2);
      const s = Math.sin(this.popAnim * Math.PI * 3) * (1 - this.popAnim) * 0.32;
      Portal._scale.makeScale(1 + s, 1 - s * 0.8, 1);
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
