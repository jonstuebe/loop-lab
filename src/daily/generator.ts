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
 * (climb, crossing, fling, geyser, payload) with randomised dimensions,
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

export const ARCHETYPES: readonly Archetype[] = [CLIMB, CROSSING, FLING, GEYSER, PAYLOAD];

const ADJECTIVES = [
  'Amber', 'Cobalt', 'Quiet', 'Lazy', 'Tilted', 'Hollow', 'Bright', 'Gentle', 'Brisk', 'Paper',
  'Velvet', 'Copper', 'Lucky', 'Sunny', 'Misty', 'Crooked', 'Little', 'Grand', 'Silent', 'Peach',
  'Marble', 'Humble', 'Clever', 'Restless', 'Patient', 'Golden', 'Hidden', 'Woolly', 'Mellow', 'Zippy',
] as const;

/** Archetype for a day: shuffled in blocks of five so no archetype repeats on consecutive days. */
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
