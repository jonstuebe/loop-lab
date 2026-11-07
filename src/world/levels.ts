import type { Block, World } from './world';

export type Vec3Tuple = readonly [number, number, number];

/** What a level's builder hands back to the game after creating geometry. */
export interface LevelSetup {
  /** Feet position of the player at spawn. */
  spawn: Vec3Tuple;
  yaw: number;
  /** Centre of the exit pad, at floor level. */
  goal: Vec3Tuple;
  /** Centre of the cube, if the level has one. */
  cube?: Vec3Tuple;
  /** Floor position of the pressure button, if any. */
  button?: Vec3Tuple;
  /** Block that slides open while the button is pressed. */
  door?: Block;
}

export interface LevelDef {
  name: string;
  hint: string;
  build(world: World): LevelSetup;
}

export const LEVELS: readonly LevelDef[] = [
  {
    name: 'Elevation',
    hint: 'The exit sits on the high ledge. Aim one portal high on the cream wall above the ledge, the other on the cream wall behind you, then walk through.',
    build(w) {
      w.room(-6, 6, 0, 9, -8, 8, { floor: 'metal', ceil: 'metal', xn: 'metal', xp: 'metal', zn: 'white' });
      w.block(-6, 0, 3, 6, 4.5, 8, 'metal');
      w.block(-7, 0, 8, 7, 4.5, 9, 'metal');
      w.block(-7, 4.5, 8, 7, 9, 9, 'white');
      return { spawn: [0, 0, -5], yaw: Math.PI, goal: [0, 4.5, 6.4] };
    },
  },
  {
    name: 'Payload',
    hint: 'The door stays open only while something heavy sits on the red button. There’s a cube on the high platform. Press E (or Grab) to pick it up.',
    build(w) {
      w.room(-7, 7, 0, 6, -7, 7, { floor: 'white', ceil: 'metal', xn: 'white', xp: 'white', zp: 'metal' });
      // wall with a doorway
      w.block(-8, 0, -8, -1, 6, -7, 'metal');
      w.block(1, 0, -8, 8, 6, -7, 'metal');
      w.block(-1, 2.6, -8, 1, 6, -7, 'metal');
      const door = w.block(-1, 0, -7.85, 1, 2.6, -7.15, 'door');
      // exit corridor
      w.block(-2, -1, -13, 2, 0, -8, 'metal');
      w.block(-2, 2.6, -13, 2, 3.6, -8, 'metal', true);
      w.block(-2, 0, -13, -1, 2.6, -8, 'metal');
      w.block(1, 0, -13, 2, 2.6, -8, 'metal');
      w.block(-2, 0, -13, 2, 2.6, -12, 'metal');
      // cube platform
      w.block(3, 0, 3, 7, 3, 7, 'metal');
      return { spawn: [-4, 0, 4], yaw: -Math.PI / 4, goal: [0, 0, -10.4], cube: [5, 3.36, 5], button: [-3, 0, -2], door };
    },
  },
  {
    name: 'Momentum',
    hint: 'Speed in, speed out. Turn around: the cream wall behind you can launch you. Put the other portal on the pit floor and step off the edge.',
    build(w) {
      w.block(-5, -14, -5, 5, 0, 0, 'metal'); // starting ledge
      w.block(-5, 0, -5, 5, 1.5, -4, 'metal');
      w.block(-5, 1.5, -5, 5, 9, -4, 'white');
      w.block(-6, -15, -5, 6, -14, 22, 'white'); // pit floor
      w.block(-6, -14, -5, -5, 9, 22, 'metal');
      w.block(5, -14, -5, 6, 9, 22, 'metal');
      w.block(-5, -14, 12, 5, -6, 21, 'metal'); // exit plateau
      w.block(-6, -14, 21, 6, 9, 22, 'metal');
      w.block(-6, 9, -5, 6, 10, 22, 'metal', true);
      return { spawn: [0, 0, -2], yaw: Math.PI, goal: [0, -6, 18] };
    },
  },
  {
    name: 'Crossing',
    hint: 'The chasm is too wide to jump, and it has no bottom. Find the cream panel on the far side, put the other portal on the wall behind you, and step through.',
    build(w) {
      w.block(-5, -3, -6, 5, 0, 1, 'metal'); // starting ledge
      w.block(-5, -3, 9, 5, 0, 16, 'metal'); // far ledge
      w.block(-6, -3, -7, 6, 8, -6, 'white'); // cream wall behind spawn
      w.block(-6, -3, -6, -5, 8, 16, 'metal');
      w.block(5, -3, -6, 6, 8, 16, 'metal');
      w.block(4.5, 0, 10, 5, 6, 15, 'white'); // cream panel on the far side wall
      w.block(-6, -3, 16, 6, 8, 17, 'metal');
      w.block(-6, 8, -7, 6, 9, 17, 'metal', true);
      return { spawn: [0, 0, -3], yaw: Math.PI, goal: [-2.5, 0, 13] };
    },
  },
  {
    name: 'Courier',
    hint: 'The cube is stranded on the island across the chasm. Link the far wall to the cream panel beside you, fetch the cube, carry it back through and drop it on the button.',
    build(w) {
      w.block(-6, -3, -8, 6, 0, 1, 'metal'); // home floor
      w.block(-6, -3, 9, 6, 0, 15, 'metal'); // island
      w.block(-7, -3, 15, 7, 7, 16, 'white'); // far wall
      w.block(-7, -3, -9, -6, 7, 16, 'metal');
      w.block(6, -3, -9, 7, 7, 16, 'metal');
      w.block(-6, 0, -6, -5.5, 5, -1, 'white'); // cream panel on the home side wall
      // wall with a doorway
      w.block(-7, 0, -9, -1, 7, -8, 'metal');
      w.block(1, 0, -9, 7, 7, -8, 'metal');
      w.block(-1, 2.6, -9, 1, 7, -8, 'metal');
      const door = w.block(-1, 0, -8.85, 1, 2.6, -8.15, 'door');
      // exit corridor
      w.block(-2, -1, -14, 2, 0, -8, 'metal');
      w.block(-2, 2.6, -14, 2, 3.6, -9, 'metal', true);
      w.block(-2, 0, -14, -1, 2.6, -9, 'metal');
      w.block(1, 0, -14, 2, 2.6, -9, 'metal');
      w.block(-2, 0, -14, 2, 2.6, -13, 'metal');
      w.block(-7, 7, -9, 7, 8, 16, 'metal', true);
      return { spawn: [-2, 0, -3], yaw: Math.PI, goal: [0, 0, -11.4], cube: [0, 0.36, 12], button: [3, 0, -4], door };
    },
  },
  {
    name: 'Geyser',
    hint: 'What falls in must come up. Only the floor takes portals here: put one where you’ll land below the tower and one beside the far ledge, then step off.',
    build(w) {
      w.block(-11, -1, -6, 10, 0, 6, 'white'); // cream floor
      w.block(-10, 0, -5, -5, 9, 5, 'metal'); // tower
      w.block(5, 0, -5, 9, 7.5, 5, 'metal'); // exit ledge
      w.block(-11, 0, -6, 10, 16, -5, 'metal');
      w.block(-11, 0, 5, 10, 16, 6, 'metal');
      w.block(-11, 0, -5, -10, 16, 5, 'metal');
      w.block(9, 0, -5, 10, 16, 5, 'metal');
      w.block(-11, 16, -6, 10, 17, 6, 'metal', true);
      return { spawn: [-5.4, 9, 0], yaw: -Math.PI / 2, goal: [7, 7.5, 0] };
    },
  },
  {
    name: 'Switchback',
    hint: 'Two climbs. First get up onto the ledge. From up there, put a portal low on the wall behind the ledge, then turn around: there’s a cream panel above the low ceiling you can only see from the ledge.',
    build(w) {
      w.block(-7, -1, -9, 7, 0, 12, 'metal'); // floor
      w.block(-7, 0, -9, -6, 14, 12, 'metal');
      w.block(6, 0, -9, 7, 14, 12, 'metal');
      w.block(-7, 0, -9, 7, 5.2, -8, 'white'); // cream wall behind spawn, under the low ceiling
      w.block(-6, 5.2, -8, 6, 7, -1, 'metal'); // low ceiling; its top is the catwalk
      w.block(-7, 7, -9, 7, 14, -8, 'white'); // cream panel above the catwalk
      w.block(-6, 0, 2, 6, 4.5, 11, 'metal'); // ledge
      w.block(-7, 4.5, 11, 7, 10, 12, 'white'); // cream wall behind the ledge
      w.block(-7, 10, 11, 7, 14, 12, 'metal');
      w.block(-7, 14, -9, 7, 15, 12, 'metal', true);
      return { spawn: [0, 0, -5], yaw: Math.PI, goal: [0, 7, -5] };
    },
  },
  {
    name: 'Gauntlet',
    hint: 'Everything at once. Fling across the pit, climb to the shelf from the cream panel behind the pillar, then bring the cube down to the button to open the exit.',
    build(w) {
      w.block(-5, -14, -5, 5, 0, 0, 'metal'); // starting ledge
      w.block(-5, 0, -5, 5, 1.5, -4, 'metal');
      w.block(-5, 1.5, -5, 5, 9, -4, 'white');
      w.block(-6, -15, -5, 6, -14, 12, 'white'); // pit floor
      w.block(-6, -15, -5, -5, 9, 29, 'metal');
      w.block(5, -15, -5, 6, 9, 29, 'metal');
      w.block(-5, -15, 12, 5, -6, 28, 'metal'); // plateau
      w.block(-4, -6, 14, -2, 0, 15, 'metal'); // pillar, cream only on its far side
      w.block(-4, -6, 15, -2, 0, 15.5, 'white');
      w.block(1, -6, 20, 5, -2, 28, 'metal'); // shelf
      w.block(1, -2, 20, 5, 4, 20.5, 'metal'); // parapet hides the shelf panel from the start
      w.block(4.5, -2, 21, 5, 4, 28, 'white'); // cream panel above the shelf
      // wall with a doorway
      w.block(-6, -6, 28, -3, 9, 29, 'metal');
      w.block(-1, -6, 28, 6, 9, 29, 'metal');
      w.block(-3, -3.4, 28, -1, 9, 29, 'metal');
      const door = w.block(-3, -6, 28.15, -1, -3.4, 28.85, 'door');
      // exit corridor
      w.block(-4, -7, 28, 0, -6, 34, 'metal');
      w.block(-4, -3.4, 29, 0, -2.4, 34, 'metal', true);
      w.block(-4, -6, 29, -3, -3.4, 34, 'metal');
      w.block(-1, -6, 29, 0, -3.4, 34, 'metal');
      w.block(-4, -6, 33, 0, -3.4, 34, 'metal');
      w.block(-6, 9, -5, 6, 10, 34, 'metal', true);
      return { spawn: [0, 0, -2], yaw: Math.PI, goal: [-2, -6, 31.4], cube: [3, -1.64, 25], button: [-3, -6, 19], door };
    },
  },
];
