import { Vector3 } from 'three';
import type { Body } from '../src/physics';
import { LEVELS } from '../src/world/levels';
import { createHarness, type Harness, simulate, type Steer } from '../src/world/solver';

export { atGoal, makeWorld, shootAt, simulate, towardGoal, type Steer } from '../src/world/solver';
export type LevelHarness = Harness;

export function loadLevel(index: number): Harness {
  return createHarness((world) => LEVELS[index].build(world));
}

/** Horizontal distance from the player to (x, z). */
export function distanceTo(p: Body, x: number, z: number): number {
  return Math.hypot(p.pos.x - x, p.pos.z - z);
}

/** Steers straight toward (x, z). */
export function toward(x: number, z: number): Steer {
  return (p) => {
    const d = new Vector3(x - p.pos.x, 0, z - p.pos.z);
    return d.lengthSq() > 1e-6 ? d.normalize() : null;
  };
}

/** Walks to (x, z) and stops there. Returns false if it can't get within 0.3 in time. */
export function walkTo(h: LevelHarness, x: number, z: number, seconds = 6): boolean {
  const reached = simulate(h, seconds, toward(x, z), (p) => p.onGround && distanceTo(p, x, z) < 0.3);
  if (reached) simulate(h, 0.5, () => null, () => false); // come to rest
  return reached;
}

/** Eye position of the player as it stands now. */
export function eyeOf(h: LevelHarness): Vector3 {
  return new Vector3(h.player.pos.x, h.player.pos.y + 0.7, h.player.pos.z);
}
