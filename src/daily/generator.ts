import { Frame, FramedBuilder } from '../world/frame';
import type { LevelDef, LevelSetup } from '../world/levels';
import type { World } from '../world/world';
import { createHarness, disposeHarness, FramedHarness } from '../world/solver';
import { hashSeed, mulberry32, pick, type Rng, shuffle } from './random';

/**
 * Procedural daily chambers.
 *
 * Each day is seeded from its chamber number, so everyone gets the same
 * chamber on the same day. A chamber is one of a handful of archetypes
 * (climb, crossing, fling, geyser, payload, switchback, courier, skylight,
 * dogleg, airlock) with randomised dimensions,
 * built in one of eight orientations. Every archetype carries a reference
 * solution, which is replayed headlessly before a layout is accepted: if
 * it fails, the layout is re-rolled, so every daily chamber is solvable.
 */

/** Layout parameters: plain numbers, so a chamber can be rebuilt from them. */
type Params = Record<string, number>;

interface Archetype {
  id: string;
  nouns: readonly string[];
  hint: (p: Params) => string;
  roll: (rng: Rng) => Params;
  /** Known-good layout, used if every roll fails validation. */
  fallback: Params;
  build: (b: FramedBuilder, p: Params) => LevelSetup;
  /** Plays the chamber headlessly in canonical coordinates; true if the exit was reached. */
  solve: (s: FramedHarness, p: Params) => boolean;
}

const range = (rng: Rng, lo: number, hi: number, step = 0.5) =>
  lo + Math.floor(rng() * (Math.round((hi - lo) / step) + 1)) * step;
const sign = (rng: Rng) => (rng() < 0.5 ? -1 : 1);

// ---------------------------------------------------------------- climb

/** Reach a high ledge by linking a portal above it to one near the floor. */
const CLIMB: Archetype = {
  id: 'climb',
  nouns: ['Ascent', 'Perch', 'Summit', 'Rise', 'Loft', 'Balcony', 'Mezzanine', 'Lookout'],
  hint: (p) => p.near === 0
    ? 'The exit is up on the ledge. Put one portal high on the cream wall above it and the other on the cream wall behind you.'
    : 'The exit is up on the ledge. Put one portal high on the cream wall above it, then find the cream panel down on your level.',
  roll: (rng) => ({
    halfW: range(rng, 5, 7, 1),
    height: range(rng, 3, 5.5),
    depth: range(rng, 3.5, 5),
    near: Math.floor(rng() * 2), // 0 = back wall, 1 = side panel
    side: sign(rng),
    panelX: range(rng, -2, 2),
    goalX: rng() * 2 - 1,
  }),
  fallback: { halfW: 6, height: 4.5, depth: 5, near: 0, side: 1, panelX: 0, goalX: 0 },
  build(b, p) {
    const { halfW: W, height: H, depth } = p;
    const z1 = -8;
    const z2 = 8;
    const top = H + 5;
    const ledge = z2 - depth;
    b.block(-W - 1, -1, z1 - 1, W + 1, 0, z2 + 1, 'metal'); // floor
    b.block(-W - 1, top, z1 - 1, W + 1, top + 1, z2 + 1, 'metal', true); // ceiling
    b.block(-W, 0, ledge, W, H, z2, 'metal'); // ledge
    b.block(-W - 1, 0, z2, W + 1, H, z2 + 1, 'metal');
    b.block(-W - 1, H, z2, W + 1, top, z2 + 1, 'white'); // high cream wall
    b.block(-W - 1, 0, z1 - 1, W + 1, top, z1, 'metal'); // back wall
    b.block(-W - 1, 0, z1, -W, top, z2, 'metal'); // side walls
    b.block(W, 0, z1, W + 1, top, z2, 'metal');
    if (p.near === 0) {
      // Cream panel standing proud of the back wall, behind spawn.
      b.block(p.panelX - 1.6, 0, z1, p.panelX + 1.6, 4, z1 + 0.3, 'white');
    } else {
      // Cream panel standing proud of one side wall, down on the floor level.
      const x = p.side * W;
      b.block(Math.min(x, x - p.side * 0.3), 0, z1 + 1, Math.max(x, x - p.side * 0.3), 3.5, ledge - 1, 'white');
    }
    return b.setup({ spawn: [0, 0, z1 + 3], yaw: Math.PI, goal: [p.goalX * (W - 1.5), H, z2 - depth / 2] });
  },
  solve(s, p) {
    const eye = [0, 1.6, -5] as const;
    if (!s.shoot(0, eye, [0, p.height + 3, 8])) return false;
    if (p.near === 0) {
      if (!s.shoot(1, eye, [p.panelX, 1.6, -8])) return false;
      return s.throughPortal(p.panelX, -9);
    }
    const panelX = p.side * (p.halfW - 0.3);
    const panelZ = (-7 + (8 - p.depth - 1)) / 2;
    if (!s.shoot(1, eye, [panelX, 1.6, panelZ])) return false;
    return s.throughPortal(panelX + p.side, panelZ);
  },
};

// ---------------------------------------------------------------- crossing

/** A bottomless chasm too wide to jump: link the wall behind you to the far side. */
const CROSSING: Archetype = {
  id: 'crossing',
  nouns: ['Gap', 'Span', 'Divide', 'Rift', 'Chasm', 'Gulf', 'Ravine', 'Moat'],
  hint: (p) => p.far === 0
    ? 'The chasm is too wide to jump and has no bottom. Find the cream panel on the far side, put the other portal on the wall behind you, and step through.'
    : 'Too far to jump. The far wall takes portals: link it to the cream wall behind you.',
  roll: (rng) => ({
    halfW: range(rng, 4, 6, 1),
    gap: range(rng, 6, 11),
    far: Math.floor(rng() * 2), // 0 = side panel, 1 = end wall
    side: sign(rng),
    goalX: rng() * 2 - 1,
  }),
  fallback: { halfW: 5, gap: 8, far: 0, side: 1, goalX: -0.5 },
  build(b, p) {
    const { halfW: W, gap } = p;
    const farStart = 1 + gap;
    const farEnd = farStart + 7;
    b.block(-W, -3, -6, W, 0, 1, 'metal'); // starting ledge
    b.block(-W, -3, farStart, W, 0, farEnd, 'metal'); // far ledge
    b.block(-W - 1, -3, -7, W + 1, 8, -6, 'white'); // cream wall behind spawn
    b.block(-W - 1, -3, -6, -W, 8, farEnd, 'metal');
    b.block(W, -3, -6, W + 1, 8, farEnd, 'metal');
    if (p.far === 0) {
      const x = p.side * W;
      b.block(Math.min(x, x - p.side * 0.3), 0, farStart + 1, Math.max(x, x - p.side * 0.3), 6, farEnd - 1, 'white');
      b.block(-W - 1, -3, farEnd, W + 1, 8, farEnd + 1, 'metal');
    } else {
      b.block(-W - 1, -3, farEnd, W + 1, 0, farEnd + 1, 'metal');
      b.block(-W - 1, 0, farEnd, W + 1, 8, farEnd + 1, 'white');
    }
    b.block(-W - 1, 8, -7, W + 1, 9, farEnd + 1, 'metal', true);
    return b.setup({ spawn: [0, 0, -3], yaw: Math.PI, goal: [p.goalX * (W - 1.5), 0, farStart + 3] });
  },
  solve(s, p) {
    const eye = [0, 1.6, -3] as const;
    const farStart = 1 + p.gap;
    const target = p.far === 0
      ? [p.side * (p.halfW - 0.3), 2, farStart + 3.5] as const
      : [0, 2, farStart + 7] as const;
    if (!s.shoot(0, eye, target)) return false;
    if (!s.shoot(1, eye, [0, 1.6, -6])) return false;
    return s.throughPortal(0, -7);
  },
};

// ---------------------------------------------------------------- fling

/** Fall into a floor portal far below and fly out of a wall portal across the pit. */
const FLING: Archetype = {
  id: 'fling',
  nouns: ['Arc', 'Launch', 'Slingshot', 'Plunge', 'Comet', 'Catapult', 'Trajectory', 'Swoop'],
  hint: () => 'Speed in, speed out. Put a portal on the cream wall behind you, the other on the pit floor where you’d land, then step off the edge.',
  roll: (rng) => ({
    depth: range(rng, 12, 16, 1),
    plateau: range(rng, 10, 14, 1),
    drop: range(rng, 4, 8, 1),
    goalX: rng() * 2 - 1,
  }),
  fallback: { depth: 14, plateau: 12, drop: 6, goalX: 0 },
  build(b, p) {
    const P = p.depth;
    const end = p.plateau + 9;
    b.block(-5, -P, -5, 5, 0, 0, 'metal'); // starting ledge
    b.block(-5, 0, -5, 5, 1.5, -4, 'metal');
    b.block(-5, 1.5, -5, 5, 9, -4, 'white'); // launch wall
    b.block(-6, -P - 1, -5, 6, -P, end + 1, 'white'); // pit floor
    b.block(-6, -P, -5, -5, 9, end + 1, 'metal');
    b.block(5, -P, -5, 6, 9, end + 1, 'metal');
    b.block(-5, -P, p.plateau, 5, -p.drop, end, 'metal'); // exit plateau
    b.block(-6, -P, end, 6, 9, end + 1, 'metal');
    b.block(-6, 9, -5, 6, 10, end + 1, 'metal', true);
    return b.setup({ spawn: [0, 0, -2], yaw: Math.PI, goal: [p.goalX * 3, -p.drop, end - 3] });
  },
  solve(s, p) {
    const landZ = 0.3 + 5.5 * Math.sqrt((2 * (p.depth + 0.9)) / 22);
    if (!s.shoot(0, [0, 1.6, -2], [0, 2.5, -4])) return false;
    if (!s.shoot(1, [0, 1.6, -0.35], [0, -p.depth, landZ])) return false;
    return s.throughPortal(0, 30);
  },
};

// ---------------------------------------------------------------- geyser

/** Only the floor takes portals: fall from the tower and rise up beside the ledge. */
const GEYSER: Archetype = {
  id: 'geyser',
  nouns: ['Spring', 'Fountain', 'Updraft', 'Rebound', 'Plume', 'Surge', 'Bounce', 'Well'],
  hint: () => 'What falls in must come up. Only the floor takes portals: put one where you’ll land below the tower and one beside the far ledge, then step off.',
  roll: (rng) => ({
    tower: range(rng, 7, 10, 1),
    under: range(rng, 1.5, 2.5),
    ledgeX: range(rng, 4, 6, 1),
    halfD: range(rng, 4, 6, 1),
  }),
  fallback: { tower: 9, under: 1.5, ledgeX: 5, halfD: 5 },
  build(b, p) {
    const T = p.tower;
    const L = T - p.under;
    const D = p.halfD;
    const xEnd = p.ledgeX + 4;
    const top = T + 7;
    b.block(-11, -1, -D - 1, xEnd + 1, 0, D + 1, 'white'); // cream floor
    b.block(-10, 0, -D, -5, T, D, 'metal'); // tower
    b.block(p.ledgeX, 0, -D, xEnd, L, D, 'metal'); // exit ledge
    b.block(-11, 0, -D - 1, xEnd + 1, top, -D, 'metal');
    b.block(-11, 0, D, xEnd + 1, top, D + 1, 'metal');
    b.block(-11, 0, -D, -10, top, D, 'metal');
    b.block(xEnd, 0, -D, xEnd + 1, top, D, 'metal');
    b.block(-11, top, -D - 1, xEnd + 1, top + 1, D + 1, 'metal', true);
    return b.setup({ spawn: [-5.4, T, 0], yaw: -Math.PI / 2, goal: [p.ledgeX + 2, L, 0] });
  },
  solve(s, p) {
    const T = p.tower;
    const landX = -5 + 0.3 + 5.5 * Math.sqrt((2 * T) / 22);
    const eye = [-5.4, T + 1.6, 0] as const;
    if (!s.shoot(0, eye, [landX, 0, 0])) return false;
    if (!s.shoot(1, eye, [p.ledgeX - 1.4, 0, 0])) return false;
    return s.throughPortal(10, 0);
  },
};

// ---------------------------------------------------------------- payload

/** Fetch the cube from a high platform and weigh down the button that holds the door. */
const PAYLOAD: Archetype = {
  id: 'payload',
  nouns: ['Relay', 'Parcel', 'Counterweight', 'Keystone', 'Latch', 'Delivery', 'Cargo', 'Ballast'],
  hint: () => 'The door only stays open while something heavy sits on the red button. The cube is up on the platform: get up there, grab it (E or Grab) and bring it down.',
  roll: (rng) => ({
    side: sign(rng),
    height: range(rng, 2.5, 3.5),
    buttonX: range(rng, 3, 4.5) * sign(rng),
    buttonZ: range(rng, -3, -1),
  }),
  fallback: { side: 1, height: 3, buttonX: -3, buttonZ: -2 },
  build(b, p) {
    const s = p.side;
    // Room: cream floor and side walls, metal back wall and ceiling.
    b.block(-8, -1, -8, 8, 0, 8, 'white');
    b.block(-8, 6, -8, 8, 7, 8, 'metal', true);
    b.block(-8, 0, -7, -7, 6, 7, 'white');
    b.block(7, 0, -7, 8, 6, 7, 'white');
    b.block(-8, 0, 7, 8, 6, 8, 'metal');
    // Wall with a doorway.
    b.block(-8, 0, -8, -1, 6, -7, 'metal');
    b.block(1, 0, -8, 8, 6, -7, 'metal');
    b.block(-1, 2.6, -8, 1, 6, -7, 'metal');
    const door = b.block(-1, 0, -7.85, 1, 2.6, -7.15, 'door');
    // Exit corridor.
    b.block(-2, -1, -13, 2, 0, -8, 'metal');
    b.block(-2, 2.6, -13, 2, 3.6, -8, 'metal', true);
    b.block(-2, 0, -13, -1, 2.6, -8, 'metal');
    b.block(1, 0, -13, 2, 2.6, -8, 'metal');
    b.block(-2, 0, -13, 2, 2.6, -12, 'metal');
    // Cube platform in a back corner.
    b.block(Math.min(3 * s, 7 * s), 0, 3, Math.max(3 * s, 7 * s), p.height, 7, 'metal');
    return b.setup({
      spawn: [-4 * s, 0, 4], yaw: -s * Math.PI / 4, goal: [0, 0, -10.4],
      cube: [5 * s, p.height + 0.36, 5], button: [p.buttonX, 0, p.buttonZ], door,
    });
  },
  solve(s, p) {
    // 1. Climb onto the platform: portal above it on its side wall, the other on the far wall.
    const side = p.side;
    const eye = [-4 * side, 1.6, 4] as const;
    if (!s.shoot(0, eye, [7 * side, p.height + 2, 5])) return false;
    if (!s.shoot(1, eye, [-7 * side, 1.6, 0])) return false;
    const climbed = s.throughPortal(-8 * side, 0, {
      seconds: 6,
      done: (c) => c.y - 0.9 > p.height - 0.1 && Math.abs(c.x) > 3 && c.z > 3,
    });
    if (!climbed) return false;
    // 2. With the button held down, the exit is a walk from the button through the doorway.
    s.standAt(p.buttonX, 0, p.buttonZ);
    const door = s.h.setup.door;
    if (door) door.active = false;
    return s.walkToGoal([[0, -5]]);
  },
};

// ---------------------------------------------------------------- switchback

/**
 * Two climbs. Get up onto the ledge, then re-aim from up there: a cream panel
 * above the low ceiling behind spawn is only visible from the ledge.
 */
const SWITCHBACK: Archetype = {
  id: 'switchback',
  nouns: ['Zigzag', 'Hairpin', 'Stairwell', 'Terrace', 'Landing', 'Catwalk', 'Gantry', 'Scaffold'],
  hint: () => 'Two climbs. First get up onto the ledge. From up there, put a portal low on the wall behind the ledge, then turn around: there’s a cream panel above the low ceiling you can only see from the ledge.',
  roll: (rng) => ({
    halfW: range(rng, 5, 7, 1),
    ledge: range(rng, 3.5, 5),
    ledgeZ: range(rng, 2, 3),
    low: range(rng, 4.8, 5.6, 0.2), // underside of the low ceiling
    front: range(rng, -2, -1), // front edge of the catwalk
    goalX: rng() * 2 - 1,
  }),
  fallback: { halfW: 6, ledge: 4.5, ledgeZ: 2, low: 5.2, front: -1, goalX: 0 },
  build(b, p) {
    const { halfW: W, ledge: H, ledgeZ, low, front } = p;
    const K = low + 1.8; // catwalk top
    const top = 14;
    b.block(-W - 1, -1, -9, W + 1, 0, 12, 'metal'); // floor
    b.block(-W - 1, 0, -9, -W, top, 12, 'metal');
    b.block(W, 0, -9, W + 1, top, 12, 'metal');
    b.block(-W - 1, 0, -9, W + 1, low, -8, 'white'); // cream wall behind spawn, under the low ceiling
    b.block(-W, low, -8, W, K, front, 'metal'); // low ceiling; its top is the catwalk
    b.block(-W - 1, low, -9, W + 1, K, -8, 'metal');
    b.block(-W - 1, K, -9, W + 1, top, -8, 'white'); // cream panel above the catwalk
    b.block(-W, 0, ledgeZ, W, H, 11, 'metal'); // ledge
    b.block(-W - 1, 0, 11, W + 1, H, 12, 'metal');
    b.block(-W - 1, H, 11, W + 1, H + 5.5, 12, 'white'); // cream wall behind the ledge
    b.block(-W - 1, H + 5.5, 11, W + 1, top, 12, 'metal');
    b.block(-W - 1, top, -9, W + 1, top + 1, 12, 'metal', true);
    return b.setup({ spawn: [0, 0, -5], yaw: Math.PI, goal: [p.goalX * (W - 1.5), K, (front - 8) / 2] });
  },
  solve(s, p) {
    const H = p.ledge;
    const eye = [0, 1.6, -5] as const;
    // 1. Up onto the ledge: high on the ledge wall, low on the wall behind spawn.
    if (!s.shoot(0, eye, [0, H + 5.2, 11])) return false;
    if (!s.shoot(1, eye, [0, 1.6, -8])) return false;
    const climbed = s.throughPortal(0, -9, {
      seconds: 6,
      route: [[0, 8]],
      done: (c) => c.y - 0.9 > H - 0.1 && c.z > p.ledgeZ + 1,
    });
    if (!climbed || !s.walk([[0, 8]])) return false;
    // 2. From the ledge: low on the ledge wall, then the panel above the catwalk.
    const ledgeEye = s.eye();
    if (!s.shoot(0, ledgeEye, [0, H + 1.1, 11])) return false;
    if (!s.shoot(1, ledgeEye, [0, p.low + 4.8, -8])) return false;
    return s.throughPortal(0, 12);
  },
};

// ---------------------------------------------------------------- courier

/** The cube is stranded on an island across a chasm: fetch it, bring it back, and hold the door open. */
const COURIER: Archetype = {
  id: 'courier',
  nouns: ['Errand', 'Shuttle', 'Ferry', 'Dispatch', 'Round Trip', 'Fetch', 'Pickup', 'Commute'],
  hint: () => 'The cube is stranded on the island across the chasm. Link the far wall to the cream panel beside you, fetch the cube, carry it back through and drop it on the button.',
  roll: (rng) => ({
    halfW: range(rng, 5, 7, 1),
    gap: range(rng, 6, 10),
    island: range(rng, 5, 7),
    side: sign(rng),
    buttonX: range(rng, 1.5, 3.5) * sign(rng),
    cubeX: range(rng, -2.5, 2.5),
  }),
  fallback: { halfW: 6, gap: 8, island: 6, side: -1, buttonX: 3, cubeX: 0 },
  build(b, p) {
    const { halfW: W, side: s } = p;
    const farStart = 1 + p.gap;
    const farEnd = farStart + p.island;
    b.block(-W, -3, -8, W, 0, 1, 'metal'); // home floor
    b.block(-W, -3, farStart, W, 0, farEnd, 'metal'); // island
    b.block(-W - 1, -3, farEnd, W + 1, 7, farEnd + 1, 'white'); // far wall
    b.block(-W - 1, -3, -9, -W, 7, farEnd, 'metal');
    b.block(W, -3, -9, W + 1, 7, farEnd, 'metal');
    const x = s * W;
    b.block(Math.min(x, x - s * 0.5), 0, -6, Math.max(x, x - s * 0.5), 5, -1, 'white'); // cream panel on the home side wall
    // Wall with a doorway.
    b.block(-W - 1, 0, -9, -1, 7, -8, 'metal');
    b.block(1, 0, -9, W + 1, 7, -8, 'metal');
    b.block(-1, 2.6, -9, 1, 7, -8, 'metal');
    const door = b.block(-1, 0, -8.85, 1, 2.6, -8.15, 'door');
    // Exit corridor.
    b.block(-2, -1, -14, 2, 0, -8, 'metal');
    b.block(-2, 2.6, -14, 2, 3.6, -9, 'metal', true);
    b.block(-2, 0, -14, -1, 2.6, -9, 'metal');
    b.block(1, 0, -14, 2, 2.6, -9, 'metal');
    b.block(-2, 0, -14, 2, 2.6, -13, 'metal');
    b.block(-W - 1, 7, -9, W + 1, 8, farEnd + 1, 'metal', true);
    return b.setup({
      spawn: [0, 0, -3], yaw: Math.PI, goal: [0, 0, -11.4],
      cube: [p.cubeX, 0.36, farStart + p.island / 2], button: [p.buttonX, 0, -4], door,
    });
  },
  solve(s, p) {
    const side = p.side;
    const farStart = 1 + p.gap;
    const farEnd = farStart + p.island;
    const cubeZ = farStart + p.island / 2;
    const eye = [0, 1.6, -3] as const;
    if (!s.shoot(0, eye, [0, 1.6, farEnd])) return false;
    if (!s.shoot(1, eye, [side * (p.halfW - 0.5), 1.5, -3.5])) return false;
    // 1. Through the side panel, out of the far wall and over to the cube.
    const fetched = s.throughPortal(side * p.halfW, -3.5, {
      seconds: 6,
      route: [[p.cubeX, cubeZ]],
      done: (c) => c.y > 0.5 && Math.hypot(c.x - p.cubeX, c.z - cubeZ) < 1.2,
    });
    if (!fetched || !s.walk([[0, farEnd - 2.5]])) return false;
    // 2. Back through the far wall, out of the side panel, onto the button.
    const back = s.throughPortal(0, farEnd + 1, { seconds: 6, route: [[p.buttonX, -4]], done: (c) => c.z < 0 && c.y > 0.5 });
    if (!back || !s.walk([[p.buttonX, -4]])) return false;
    // 3. With the cube on the button the door opens.
    const door = s.h.setup.door;
    if (door) door.active = false;
    return s.walkToGoal([[0, -6]]);
  },
};

// ---------------------------------------------------------------- skylight

/** The exit is walled in. Drop through a floor portal and fall out of the ceiling above it. */
const SKYLIGHT: Archetype = {
  id: 'skylight',
  nouns: ['Hatch', 'Trapdoor', 'Chute', 'Drop', 'Oubliette', 'Cistern', 'Shaft', 'Pitfall'],
  hint: () => 'The exit is walled in. The floor here takes portals, and so does the ceiling above the exit: put one at your feet, one overhead, and step in.',
  roll: (rng) => ({
    halfW: range(rng, 4, 6, 1),
    wallZ: range(rng, 3, 7),
    pen: range(rng, 5, 7),
    wallH: range(rng, 3.5, 5.5),
    headroom: range(rng, 3, 5),
    goalX: rng() * 2 - 1,
  }),
  fallback: { halfW: 5, wallZ: 5, pen: 6, wallH: 4.5, headroom: 4, goalX: 0 },
  build(b, p) {
    const { halfW: W, wallZ, pen } = p;
    const top = p.wallH + p.headroom;
    const end = wallZ + 1 + pen;
    b.block(-W - 1, -1, -9, W + 1, 0, wallZ, 'white'); // cream floor
    b.block(-W - 1, -1, wallZ, W + 1, 0, end + 1, 'metal'); // pen floor
    b.block(-W, 0, wallZ, W, p.wallH, wallZ + 1, 'metal'); // wall around the pen
    b.block(-W - 1, 0, -9, -W, top, end + 1, 'metal');
    b.block(W, 0, -9, W + 1, top, end + 1, 'metal');
    b.block(-W - 1, 0, -9, W + 1, top, -8, 'metal');
    b.block(-W - 1, 0, end, W + 1, top, end + 1, 'metal');
    b.block(-W - 1, top, -9, W + 1, top + 1, wallZ + 1, 'metal', true); // ceiling
    b.block(-W - 1, top, wallZ + 1, W + 1, top + 1, end + 1, 'white', true); // cream skylight over the pen
    return b.setup({ spawn: [0, 0, -6], yaw: Math.PI, goal: [p.goalX * (W - 1.5), 0, wallZ + 1 + pen / 2] });
  },
  solve(s, p) {
    const eye = [0, 1.6, -6] as const;
    const top = p.wallH + p.headroom;
    if (!s.shoot(0, eye, [0, 0, -3])) return false;
    if (!s.shoot(1, eye, [0, top, p.wallZ + 1 + p.pen / 2])) return false;
    return s.throughPortal(0, -3);
  },
};

// ---------------------------------------------------------------- dogleg

/**
 * Two chasms around a corner. Cross to the island, then re-aim from there:
 * the exit platform's wall is hidden from the start.
 */
const DOGLEG: Archetype = {
  id: 'dogleg',
  nouns: ['Corner', 'Detour', 'Elbow', 'Bend', 'Kink', 'Switch', 'Stepping Stone', 'Waypoint'],
  hint: () => 'Two jumps you can’t make. Link the island’s back wall to the cream wall behind you, then look around the corner from the island for the next wall.',
  roll: (rng) => ({
    gap1: range(rng, 5, 9),
    gap2: range(rng, 5, 9),
    island: range(rng, 6, 8),
    goalZ: rng() * 2 - 1,
  }),
  fallback: { gap1: 7, gap2: 7, island: 7, goalZ: 0 },
  build(b, p) {
    const m1 = 1 + p.gap1; // island near edge
    const m2 = m1 + p.island; // island back wall
    const x2 = 3 + p.gap2; // exit platform near edge
    const E = x2 + 7; // exit platform far wall
    b.block(-3, -3, -6, 3, 0, 1, 'metal'); // starting ledge
    b.block(-3, -3, m1, 3, 0, m2, 'metal'); // island
    b.block(x2, -3, m1, E, 0, m2, 'metal'); // exit platform
    b.block(-4, -3, -7, 4, 8, -6, 'white'); // cream wall behind spawn
    b.block(-4, -3, -6, -3, 8, m2, 'metal'); // left wall, start to island
    b.block(3, -3, -6, 4, 8, m1, 'metal'); // right wall: hides the exit platform from the start
    b.block(4, -3, m1 - 1, E + 1, 8, m1, 'metal');
    b.block(-4, -3, m2, 3, 8, m2 + 1, 'white'); // island back wall
    b.block(3, -3, m2, E + 1, 8, m2 + 1, 'metal');
    b.block(E, -3, m1, E + 1, 8, m2, 'white'); // exit platform far wall
    b.block(-4, 8, -7, E + 1, 9, m2 + 1, 'metal', true);
    return b.setup({ spawn: [0, 0, -3], yaw: Math.PI, goal: [E - 3, 0, (m1 + m2) / 2 + p.goalZ * (p.island / 2 - 1.5)] });
  },
  solve(s, p) {
    const m1 = 1 + p.gap1;
    const m2 = m1 + p.island;
    const mid = (m1 + m2) / 2;
    const E = 3 + p.gap2 + 7;
    const eye = [0, 1.6, -3] as const;
    // 1. Across to the island.
    if (!s.shoot(0, eye, [0, 1.6, m2])) return false;
    if (!s.shoot(1, eye, [0, 1.6, -6])) return false;
    const crossed = s.throughPortal(0, -7, { seconds: 6, route: [[0, mid]], done: (c) => c.z > m1 && c.y > -0.5 });
    if (!crossed || !s.walk([[0, mid]])) return false;
    // 2. From the island: move the orange portal to the exit platform's wall and walk back into the blue one.
    if (!s.shoot(1, s.eye(), [E, 1.6, mid])) return false;
    return s.throughPortal(0, m2 + 1);
  },
};

// ---------------------------------------------------------------- airlock

/** The button is locked in a cage you can only see into through a window: carry the cube in by portal. */
const AIRLOCK: Archetype = {
  id: 'airlock',
  nouns: ['Cage', 'Vault', 'Lockbox', 'Enclosure', 'Kennel', 'Aviary', 'Strongroom', 'Pen'],
  hint: () => 'The button is locked in the cage. Look through its window: the back wall takes portals. Link it to the cream panel, carry the cube in and drop it on the button.',
  roll: (rng) => ({
    cageX: range(rng, 0.5, 2.5), // inner wall of the cage
    cageZ: range(rng, 1.5, 3), // front wall of the cage
    sill: range(rng, 1.4, 1.6, 0.1), // above jumping height; the window is too short to crawl through
    panelZ: range(rng, -3, 0),
    cubeX: range(rng, -4, -1),
  }),
  fallback: { cageX: 2, cageZ: 2, sill: 1.5, panelZ: -1.5, cubeX: -2 },
  build(b, p) {
    const { cageX: cx, cageZ: cz, sill } = p;
    const win = sill + 0.9;
    // Room: metal all round, with a cream panel on the -x wall.
    b.block(-8, -1, -8, 8, 0, 8, 'metal');
    b.block(-8, 6, -8, 8, 7, 8, 'metal', true);
    b.block(-8, 0, -7, -7, 6, 7, 'metal');
    b.block(7, 0, -7, 8, 6, 7, 'metal');
    b.block(-8, 0, 7, cx - 0.5, 6, 8, 'metal');
    b.block(cx - 0.5, 0, 7, 8, 6, 8, 'white'); // back wall inside the cage
    b.block(-7, 0, p.panelZ - 2.5, -6.7, 4, p.panelZ + 2.5, 'white');
    // Cage: an inner wall and a front wall with a window too high to climb through.
    b.block(cx - 0.5, 0, cz, cx, 6, 7, 'metal');
    b.block(cx - 0.5, 0, cz - 0.5, 7, sill, cz, 'metal');
    b.block(cx - 0.5, win, cz - 0.5, 7, 6, cz, 'metal');
    // Wall with a doorway.
    b.block(-8, 0, -8, -1, 6, -7, 'metal');
    b.block(1, 0, -8, 8, 6, -7, 'metal');
    b.block(-1, 2.6, -8, 1, 6, -7, 'metal');
    const door = b.block(-1, 0, -7.85, 1, 2.6, -7.15, 'door');
    // Exit corridor.
    b.block(-2, -1, -13, 2, 0, -8, 'metal');
    b.block(-2, 2.6, -13, 2, 3.6, -8, 'metal', true);
    b.block(-2, 0, -13, -1, 2.6, -8, 'metal');
    b.block(1, 0, -13, 2, 2.6, -8, 'metal');
    b.block(-2, 0, -13, 2, 2.6, -12, 'metal');
    const midX = (cx + 7) / 2;
    return b.setup({
      spawn: [-3, 0, -3], yaw: Math.PI, goal: [0, 0, -10.4],
      cube: [p.cubeX, 0.36, -1], button: [midX, 0, (cz + 7) / 2], door,
    });
  },
  solve(s, p) {
    const { cageX: cx, cageZ: cz, sill } = p;
    const midX = (cx + 7) / 2;
    const buttonZ = (cz + 7) / 2;
    // 1. Stand in front of the window and aim through it at the cage's back wall.
    if (!s.walk([[midX, cz - 3]])) return false;
    // Aim low through the window so the portal lands within reach of the floor and snaps down to it.
    const eye = s.eye();
    const t = (7 - eye[2]) / (cz - 0.25 - eye[2]);
    if (!s.shoot(0, eye, [midX, eye[1] + (sill + 0.25 - eye[1]) * t, 7])) return false;
    if (!s.shoot(1, eye, [-6.7, 1.6, p.panelZ])) return false;
    // 2. Into the cage through the panel, and onto the button.
    const inside = s.throughPortal(-7.7, p.panelZ, {
      seconds: 8,
      route: [[midX, buttonZ]],
      done: (c) => c.z > cz + 0.3 && c.x > cx,
    });
    if (!inside || !s.walk([[midX, buttonZ]])) return false;
    // 3. The cube holds the door open: back out through the cage wall and round to the exit.
    const door = s.h.setup.door;
    if (door) door.active = false;
    return s.throughPortal(midX, 8, { route: [[-4, p.panelZ], [0, -5]] });
  },
};

export const ARCHETYPES: readonly Archetype[] = [
  CLIMB, CROSSING, FLING, GEYSER, PAYLOAD,
  SWITCHBACK, COURIER, SKYLIGHT, DOGLEG, AIRLOCK,
];

const ADJECTIVES = [
  'Amber', 'Cobalt', 'Quiet', 'Lazy', 'Tilted', 'Hollow', 'Bright', 'Gentle', 'Brisk', 'Paper',
  'Velvet', 'Copper', 'Lucky', 'Sunny', 'Misty', 'Crooked', 'Little', 'Grand', 'Silent', 'Peach',
  'Marble', 'Humble', 'Clever', 'Restless', 'Patient', 'Golden', 'Hidden', 'Woolly', 'Mellow', 'Zippy',
] as const;

/** Archetype for a day: shuffled in blocks of one of each, so no archetype repeats on consecutive days. */
export function archetypeFor(day: number): Archetype {
  const n = ARCHETYPES.length;
  const blockOf = (d: number) => Math.floor((d - 1) / n);
  const order = (block: number): number[] => {
    const perm = shuffle(mulberry32(hashSeed(0x10a9, block)), ARCHETYPES.map((_, i) => i));
    if (block > 0) {
      const prev = shuffle(mulberry32(hashSeed(0x10a9, block - 1)), ARCHETYPES.map((_, i) => i));
      if (perm[0] === prev[n - 1]) [perm[0], perm[1]] = [perm[1], perm[0]];
    }
    return perm;
  };
  const block = blockOf(day);
  return ARCHETYPES[order(block)[(((day - 1) % n) + n) % n]];
}

/** The chamber's name, e.g. "Cobalt Ascent". Cheap: doesn't build anything. */
export function chamberName(day: number): string {
  // Adjectives are dealt from a shuffled deck, so none repeats within a month.
  const n = ADJECTIVES.length;
  const deck = Math.floor((day - 1) / n);
  const adjective = shuffle(mulberry32(hashSeed(0x2a3e, deck)), ADJECTIVES)[(((day - 1) % n) + n) % n];
  return `${adjective} ${pick(mulberry32(hashSeed(0x4e0f, day)), archetypeFor(day).nouns)}`;
}

export interface DailyChamber {
  day: number;
  archetype: string;
  level: LevelDef;
  /** False only if every roll failed validation and the archetype's fallback layout was used. */
  verified: boolean;
}

const MAX_ROLLS = 24;
const cache = new Map<number, DailyChamber>();

function framed(arch: Archetype, params: Params, frame: Frame): (world: World) => LevelSetup {
  return (world) => arch.build(new FramedBuilder(world, frame), params);
}

/** True if the archetype's reference solution clears this layout. */
export function validate(arch: Archetype, params: Params, frame: Frame): boolean {
  const h = createHarness(framed(arch, params, frame));
  try {
    return arch.solve(new FramedHarness(h, frame), params);
  } finally {
    disposeHarness(h);
  }
}

/** Builds (and caches) the daily chamber for a chamber number. */
export function dailyChamber(day: number): DailyChamber {
  const hit = cache.get(day);
  if (hit) return hit;
  const arch = archetypeFor(day);
  const rng = mulberry32(hashSeed(0x5eed, day));
  let params = arch.fallback;
  let frame = Frame.identity;
  let verified = false;
  for (let i = 0; i < MAX_ROLLS; i++) {
    const p = arch.roll(rng);
    const f = new Frame(Math.floor(rng() * 4), rng() < 0.5);
    if (validate(arch, p, f)) {
      params = p;
      frame = f;
      verified = true;
      break;
    }
  }
  const chamber: DailyChamber = {
    day,
    archetype: arch.id,
    verified,
    level: { name: chamberName(day), hint: arch.hint(params), build: framed(arch, params, frame) },
  };
  cache.set(day, chamber);
  return chamber;
}
