import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeFor, dailyChamber, validate } from '../src/daily/generator';
import { mulberry32 } from '../src/daily/random';
import { Frame, FramedBuilder } from '../src/world/frame';
import { atGoal, createHarness, disposeHarness, type Harness, simulate, toward, towardGoal } from '../src/world/solver';

const NEW_ARCHETYPES = ['switchback', 'courier', 'skylight', 'dogleg', 'airlock'] as const;
const FRAMES = [0, 1, 2, 3].flatMap((t) => [new Frame(t, false), new Frame(t, true)]);

const archetype = (id: string) => {
  const a = ARCHETYPES.find((x) => x.id === id);
  if (!a) throw new Error(`no archetype ${id}`);
  return a;
};

/** Builds an archetype's layout in canonical coordinates. */
function build(id: string, params: Record<string, number>): Harness {
  return createHarness((w) => archetype(id).build(new FramedBuilder(w, Frame.identity), params));
}

/** Does a ray from `eye` toward `target` hit a cream block matching `isTarget` first? */
function sees(h: Harness, eye: Vector3, target: Vector3, isTarget: (min: Vector3, max: Vector3) => boolean): boolean {
  const hit = h.world.raycast(eye, target.clone().sub(eye).normalize());
  return !!hit && hit.block.type === 'white' && isTarget(hit.block.min, hit.block.max);
}

/** A few layouts per archetype: the fallback plus seeded rolls. */
function layouts(id: string, n = 12): Record<string, number>[] {
  const a = archetype(id);
  const rng = mulberry32(0xbeef);
  return [a.fallback, ...Array.from({ length: n }, () => a.roll(rng))];
}

describe('new daily archetypes', () => {
  it('registers all five', () => {
    expect(ARCHETYPES.map((a) => a.id)).toEqual(expect.arrayContaining([...NEW_ARCHETYPES]));
    expect(new Set(ARCHETYPES.map((a) => a.id)).size).toBe(ARCHETYPES.length);
  });

  for (const id of NEW_ARCHETYPES) {
    it(`${id}: builds and solves its fallback layout in every orientation`, () => {
      const a = archetype(id);
      for (const f of FRAMES) expect(validate(a, a.fallback, f), `${id} t${f.turns} m${f.mirror}`).toBe(true);
    });

    it(`${id}: can't be cleared by walking straight to the exit`, () => {
      for (const p of layouts(id)) {
        const h = build(id, p);
        const reached = simulate(h, 10, towardGoal(h), (b) => atGoal(h, b));
        disposeHarness(h);
        expect(reached, JSON.stringify(p)).toBe(false);
      }
    });
  }

  it('days 1–60: every chamber validates, and each new archetype appears', () => {
    const seen = new Map<string, number>();
    let fallbacks = 0;
    for (let d = 1; d <= 60; d++) {
      const c = dailyChamber(d);
      expect(c.archetype).toBe(archetypeFor(d).id);
      expect(c.verified, `day ${d} (${c.archetype}) fell back to its fallback layout`).toBe(true);
      if (!c.verified) fallbacks++;
      seen.set(c.archetype, (seen.get(c.archetype) ?? 0) + 1);
    }
    for (const id of NEW_ARCHETYPES) expect(seen.get(id) ?? 0, id).toBeGreaterThan(0);
    expect(fallbacks).toBe(0);
  }, 60_000);

  it('switchback: the catwalk panel is hidden from the ground', () => {
    for (const p of layouts('switchback')) {
      const h = build('switchback', p);
      const K = p.low + 1.8;
      for (const z of [-7, -4, -1, p.ledgeZ - 0.4]) {
        for (const x of [-p.halfW + 0.5, 0, p.halfW - 0.5]) {
          for (const y of [K + 0.5, K + 3, 13.5]) {
            const panel = sees(h, new Vector3(x, 1.6, z), new Vector3(0, y, -8), (min) => min.y === K);
            expect(panel, JSON.stringify({ p, x, z, y })).toBe(false);
          }
        }
      }
      disposeHarness(h);
    }
  });

  it('dogleg: the exit platform’s wall is hidden from the starting ledge', () => {
    for (const p of layouts('dogleg')) {
      const h = build('dogleg', p);
      const m1 = 1 + p.gap1;
      const m2 = m1 + p.island;
      const E = 3 + p.gap2 + 7;
      for (const x of [-2.7, 0, 2.7]) {
        for (const z of [-5.5, -3, 0.7]) {
          for (const tz of [m1 + 0.1, (m1 + m2) / 2, m2 - 0.1]) {
            for (const ty of [-2.5, 1, 7.5]) {
              const wall = sees(h, new Vector3(x, 1.6, z), new Vector3(E, ty, tz), (min) => min.x === E);
              expect(wall, JSON.stringify({ p, x, z, tz, ty })).toBe(false);
            }
          }
        }
      }
      // Control: from the island it is in plain view.
      const island = new Vector3(0, 1.6, (m1 + m2) / 2);
      expect(sees(h, island, new Vector3(E, 1.6, (m1 + m2) / 2), (min) => min.x === E)).toBe(true);
      disposeHarness(h);
    }
  });

  it('airlock: the cage window can’t be climbed through', () => {
    for (const p of layouts('airlock')) {
      const h = build('airlock', p);
      const midX = (p.cageX + 7) / 2;
      const [bx, , bz] = h.setup.button!;
      h.player.pos.set(midX, 0.902, p.cageZ - 1.5);
      // Run at the window, jumping whenever on the ground.
      simulate(h, 4, (b) => {
        if (b.onGround) b.vel.y = 7.6;
        return toward(b, bx, bz);
      }, () => false);
      expect(h.player.pos.z, JSON.stringify(p)).toBeLessThan(p.cageZ - 0.5);
      disposeHarness(h);
    }
  });

  it('skylight: the pen wall is too tall to jump', () => {
    for (const p of layouts('skylight')) {
      const h = build('skylight', p);
      h.player.pos.set(0, 0.902, p.wallZ - 1.5);
      simulate(h, 4, (b) => {
        if (b.onGround) b.vel.y = 7.6;
        return toward(b, 0, p.wallZ + 3);
      }, () => false);
      expect(h.player.pos.z, JSON.stringify(p)).toBeLessThan(p.wallZ);
      disposeHarness(h);
    }
  });
});
