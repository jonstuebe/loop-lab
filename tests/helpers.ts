import { LEVELS } from '../src/world/levels';
import { createHarness, type Harness } from '../src/world/solver';

export { atGoal, makeWorld, shootAt, simulate, towardGoal, type Steer } from '../src/world/solver';
export type LevelHarness = Harness;

export function loadLevel(index: number): Harness {
  return createHarness((world) => LEVELS[index].build(world));
}
