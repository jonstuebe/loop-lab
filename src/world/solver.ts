import { MeshStandardMaterial, Scene, Vector3 } from 'three';
import { EYE_HEIGHT, GRAVITY, MAX_FALL_SPEED, type PortalIndex, WALK_SPEED } from '../config';
import { type Body, physicsStep } from '../physics';
import { PortalSystem } from '../portals';
import { Frame } from './frame';
import type { LevelSetup } from './levels';
import { World } from './world';

/**
 * Headless playthrough harness: builds a chamber without rendering and
 * steps the player with the same movement model as the game. Used to prove
 * generated daily chambers are solvable, and by the test suite.
 */
export interface Harness {
  world: World;
  portals: PortalSystem;
  setup: LevelSetup;
  player: Body;
}

let sharedMaterial: MeshStandardMaterial | null = null;
let sharedPortals: PortalSystem | null = null;

export function makeWorld(): World {
  sharedMaterial ??= new MeshStandardMaterial();
  const m = sharedMaterial;
  return new World({ white: m, metal: m, door: m });
}

export function createHarness(build: (world: World) => LevelSetup): Harness {
  const world = makeWorld();
  const setup = build(world);
  sharedPortals ??= new PortalSystem(new Scene());
  const portals = sharedPortals;
  portals.reset();
  const player: Body = {
    pos: new Vector3(setup.spawn[0], setup.spawn[1] + 0.902, setup.spawn[2]),
    vel: new Vector3(),
    half: new Vector3(0.3, 0.9, 0.3),
    onGround: false,
    isPlayer: true,
  };
  return { world, portals, setup, player };
}

/** Frees the geometry a harness created. */
export function disposeHarness(h: Harness): void {
  h.world.clear(new Set());
  h.portals.reset();
}

/** Fires a portal from `origin` toward `target`, like the game's shoot(). */
export function shootAt(h: Harness, idx: PortalIndex, origin: Vector3, target: Vector3) {
  const dir = target.clone().sub(origin).normalize();
  const hit = h.world.raycast(origin, dir);
  if (!hit) return null;
  if (hit.block.type !== 'white') return null; // portals only stick to cream panels
  const point = origin.clone().addScaledVector(dir, hit.t);
  return h.portals.place(idx, point, hit.normal, dir, hit.block, h.world.blocks);
}

/** Desired horizontal movement direction for this step (unit length), or null for no input. */
export type Steer = (p: Body) => Vector3 | null;

/**
 * Steps the player with the same movement model as the game: smoothed walking
 * on the ground, and air control that can steer but never adds speed beyond
 * walking pace (so flings keep their momentum). Returns true once `done` holds.
 */
export function simulate(h: Harness, seconds: number, steer: Steer, done: (p: Body) => boolean): boolean {
  const dt = 1 / 120;
  const p = h.player;
  for (let t = 0; t < seconds; t += dt) {
    const wish = steer(p);
    const wx = wish?.x ?? 0;
    const wz = wish?.z ?? 0;
    if (p.onGround) {
      const k = 1 - Math.exp(-14 * dt);
      p.vel.x += (wx * WALK_SPEED - p.vel.x) * k;
      p.vel.z += (wz * WALK_SPEED - p.vel.z) * k;
    } else if (wish) {
      const add = WALK_SPEED - (p.vel.x * wx + p.vel.z * wz);
      if (add > 0) {
        const acc = Math.min(add, 24 * dt);
        p.vel.x += wx * acc;
        p.vel.z += wz * acc;
      }
    }
    p.vel.y = Math.max(p.vel.y - GRAVITY * dt, -MAX_FALL_SPEED);
    physicsStep(p, dt, h.world.blocks, h.portals);
    if (p.pos.y < -40) return false;
    if (done(p)) return true;
  }
  return false;
}

/** Horizontal unit vector from the player toward a point, or null if already there. */
export function toward(p: Body, x: number, z: number): Vector3 | null {
  const d = new Vector3(x - p.pos.x, 0, z - p.pos.z);
  return d.lengthSq() > 1e-6 ? d.normalize() : null;
}

/** Steers straight toward the level's goal. */
export function towardGoal(h: Harness): Steer {
  return (p) => toward(p, h.setup.goal[0], h.setup.goal[2]);
}

/** Same test as the game's goal check. */
export function atGoal(h: Harness, p: Body): boolean {
  const [gx, gy, gz] = h.setup.goal;
  const feetY = p.pos.y - p.half.y;
  return Math.hypot(p.pos.x - gx, p.pos.z - gz) < 0.85 && feetY > gy - 0.3 && feetY < gy + 1.2;
}

/**
 * A harness seen through a Frame: lets a chamber's reference solution be
 * written in the chamber's canonical coordinates.
 */
export class FramedHarness {
  constructor(readonly h: Harness, readonly frame: Frame) {}

  private world(x: number, y: number, z: number): Vector3 {
    return new Vector3(...this.frame.point(x, y, z));
  }

  /** Player position in canonical coordinates. */
  canonical(p: Body): Vector3 {
    return this.frame.inverseVec(p.pos.clone());
  }

  shoot(idx: PortalIndex, eye: readonly [number, number, number], target: readonly [number, number, number]): boolean {
    return shootAt(this.h, idx, this.world(...eye), this.world(...target)) !== null;
  }

  /** Puts the player's feet at a canonical point (to stand somewhere reachable on foot). */
  standAt(x: number, y: number, z: number): void {
    this.h.player.pos.copy(this.world(x, y + this.h.player.half.y + 0.002, z));
    this.h.player.vel.set(0, 0, 0);
  }

  /**
   * Walks toward a canonical point until the player passes through a portal
   * (a sudden jump in position), then steers toward the goal. Returns true once
   * `done` holds (by default: standing on the exit pad).
   */
  throughPortal(
    entryX: number,
    entryZ: number,
    opts: { seconds?: number; done?: (canonical: Vector3) => boolean; route?: readonly (readonly [number, number])[] } = {},
  ): boolean {
    const h = this.h;
    const entry = this.world(entryX, 0, entryZ);
    const route = (opts.route ?? []).map(([x, z]) => this.world(x, 0, z));
    let i = 0;
    let teleported = false;
    const last = h.player.pos.clone();
    const done = opts.done;
    return simulate(h, opts.seconds ?? 10, (p) => {
      if (p.pos.distanceTo(last) > 1) teleported = true;
      last.copy(p.pos);
      if (!teleported) return toward(p, entry.x, entry.z);
      // After the portal: follow the optional route, then head for the goal.
      while (i < route.length && Math.hypot(route[i].x - p.pos.x, route[i].z - p.pos.z) < 0.4) i++;
      return i < route.length ? toward(p, route[i].x, route[i].z) : toward(p, h.setup.goal[0], h.setup.goal[2]);
    }, done ? (p) => done(this.canonical(p)) : (p) => atGoal(h, p));
  }

  /** The player's eye position in canonical coordinates (to aim the next shot from where they stand). */
  eye(): [number, number, number] {
    const c = this.canonical(this.h.player);
    return [c.x, c.y + EYE_HEIGHT, c.z];
  }

  /**
   * Walks a canonical route on foot and comes to rest at its last point.
   * Returns false if the player falls, or doesn't arrive in time.
   */
  walk(route: readonly (readonly [number, number])[], seconds = 8): boolean {
    const h = this.h;
    const points = route.map(([x, z]) => this.world(x, 0, z));
    let i = 0;
    const arrived = simulate(h, seconds, (p) => {
      while (i < points.length - 1 && Math.hypot(points[i].x - p.pos.x, points[i].z - p.pos.z) < 0.4) i++;
      return toward(p, points[i].x, points[i].z);
    }, (p) => i === points.length - 1 && p.onGround && Math.hypot(points[i].x - p.pos.x, points[i].z - p.pos.z) < 0.3);
    if (!arrived) return false;
    simulate(h, 0.5, () => null, () => false); // come to rest
    return h.player.onGround;
  }

  /** Walks a canonical route (each waypoint reached within 0.4), then to the goal. */
  walkToGoal(route: readonly (readonly [number, number])[], seconds = 12): boolean {
    const h = this.h;
    const points = route.map(([x, z]) => this.world(x, 0, z));
    let i = 0;
    return simulate(h, seconds, (p) => {
      while (i < points.length && Math.hypot(points[i].x - p.pos.x, points[i].z - p.pos.z) < 0.4) i++;
      return i < points.length ? toward(p, points[i].x, points[i].z) : toward(p, h.setup.goal[0], h.setup.goal[2]);
    }, (p) => atGoal(h, p));
  }
}
