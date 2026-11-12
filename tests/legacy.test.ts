import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeFor, dailyChamber, LEGACY_LAST_DAY } from '../src/daily/generator';
import { fingerprint } from './fingerprint';

/**
 * Days 1–20 as main's five-archetype generator built them (commit 2327b9c),
 * before the pool grew to ten. Players have recorded clears and times for
 * these days, so their chambers must stay exactly the same: archetype, name,
 * and the fingerprint of every block, spawn, goal, cube and button.
 */
const RELEASED: readonly (readonly [day: number, archetype: string, name: string, geometry: string])[] = [
  [1, 'crossing', 'Misty Gap', 'b8627faa'],
  [2, 'climb', 'Humble Mezzanine', '77702367'],
  [3, 'fling', 'Little Arc', '2b897a31'],
  [4, 'geyser', 'Bright Spring', '49a0f8d2'],
  [5, 'payload', 'Quiet Latch', '05a8c88a'],
  [6, 'climb', 'Mellow Lookout', '6f6cfa69'],
  [7, 'payload', 'Lazy Ballast', 'ffd79e7e'],
  [8, 'geyser', 'Zippy Well', 'cfb070fc'],
  [9, 'fling', 'Brisk Comet', '37a6f459'],
  [10, 'crossing', 'Peach Rift', '2b59dbc1'],
  [11, 'climb', 'Lucky Mezzanine', '3b4133c9'],
  [12, 'fling', 'Restless Arc', '276c684a'],
  [13, 'payload', 'Copper Relay', '79f6f229'],
  [14, 'geyser', 'Paper Well', '7d7d7576'],
  [15, 'crossing', 'Cobalt Divide', 'af559ffb'],
  [16, 'payload', 'Sunny Counterweight', 'e02bc173'],
  [17, 'crossing', 'Silent Moat', '8584846c'],
  [18, 'geyser', 'Velvet Plume', '71245737'],
  [19, 'fling', 'Marble Swoop', '4d09bc01'],
  [20, 'climb', 'Golden Perch', '7c54bf9b'],
];

describe('released daily chambers', () => {
  it('keeps the legacy cutoff covering every pinned day', () => {
    expect(LEGACY_LAST_DAY).toBeGreaterThanOrEqual(RELEASED.length);
  });

  for (const [day, archetype, name, geometry] of RELEASED) {
    it(`day ${day} is still ${name} (${archetype})`, () => {
      const c = dailyChamber(day);
      expect(c.archetype).toBe(archetype);
      expect(c.level.name).toBe(name);
      expect(c.verified).toBe(true);
      expect(fingerprint(c.level)).toBe(geometry);
    });
  }

  it('deals the full pool after the cutoff, without repeating across it', () => {
    expect(archetypeFor(LEGACY_LAST_DAY + 1).id).not.toBe(archetypeFor(LEGACY_LAST_DAY).id);
    const seen = new Set<string>();
    for (let d = LEGACY_LAST_DAY + 1; d <= LEGACY_LAST_DAY + ARCHETYPES.length; d++) seen.add(archetypeFor(d).id);
    expect(seen.size).toBe(ARCHETYPES.length);
  });
});
