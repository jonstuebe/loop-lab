import { describe, expect, it } from 'vitest';
import { dateForDay, dayNumber, formatTime } from '../src/daily/calendar';
import { ARCHETYPES, archetypeFor, chamberName, dailyChamber, LEGACY_LAST_DAY, validate } from '../src/daily/generator';
import { currentStreak, type Progress } from '../src/daily/progress';
import { Frame } from '../src/world/frame';
import { atGoal, createHarness, disposeHarness, simulate, towardGoal } from '../src/world/solver';

describe('calendar', () => {
  it('numbers local calendar days from the launch day', () => {
    expect(dayNumber(new Date(2026, 10, 1, 0, 5))).toBe(1);
    expect(dayNumber(new Date(2026, 10, 1, 23, 55))).toBe(1);
    expect(dayNumber(new Date(2026, 10, 7, 9))).toBe(7);
    expect(dayNumber(new Date(2027, 10, 1, 12))).toBe(366);
  });

  it('maps chamber numbers back to their dates', () => {
    for (const day of [1, 7, 31, 150, 366, 1000]) expect(dayNumber(dateForDay(day))).toBe(day);
  });

  it('formats clear times', () => {
    expect(formatTime(7.4)).toBe('0:07');
    expect(formatTime(83)).toBe('1:23');
    expect(formatTime(3725)).toBe('1:02:05');
  });
});

describe('progress', () => {
  it('counts consecutive days cleared on the day', () => {
    const rec = (onDay: boolean) => ({ time: 60, portals: 2, onDay });
    const p: Progress = { 3: rec(true), 4: rec(true), 5: rec(false), 6: rec(true), 7: rec(true) };
    expect(currentStreak(p, 7)).toBe(2);
    expect(currentStreak(p, 8)).toBe(2); // today not played yet: streak still alive
    expect(currentStreak(p, 9)).toBe(0);
    expect(currentStreak({}, 7)).toBe(0);
  });
});

describe('frame', () => {
  it('round-trips points through every orientation', () => {
    for (let t = 0; t < 4; t++) {
      for (const m of [false, true]) {
        const f = new Frame(t, m);
        expect(f.inverse(...f.point(1.5, 2, -3))).toEqual([1.5, 2, -3]);
      }
    }
  });
});

describe('daily chambers', () => {
  it('never repeats an archetype on consecutive days', () => {
    for (let d = 1; d < 500; d++) expect(archetypeFor(d + 1).id).not.toBe(archetypeFor(d).id);
  });

  it('uses every archetype', () => {
    // Released days keep the original five; the full pool starts after the cutoff.
    const legacy = new Set<string>();
    for (let d = 1; d <= LEGACY_LAST_DAY; d++) legacy.add(archetypeFor(d).id);
    expect(legacy.size).toBe(5);
    const seen = new Set<string>();
    for (let d = LEGACY_LAST_DAY + 1; d <= LEGACY_LAST_DAY + 20; d++) seen.add(archetypeFor(d).id);
    expect(seen.size).toBe(ARCHETYPES.length);
  });

  it('doesn’t reuse a name within a month', () => {
    const names = new Set<string>();
    for (let d = 1; d <= 30; d++) names.add(chamberName(d));
    expect(names.size).toBe(30);
  });

  it('is deterministic for a given day', () => {
    expect(chamberName(42)).toBe(chamberName(42));
    expect(dailyChamber(42).level.hint).toBe(dailyChamber(42).level.hint);
    expect(dailyChamber(42).level.name).toBe(chamberName(42));
  });

  it('has a solvable fallback layout for every archetype in every orientation', () => {
    for (const a of ARCHETYPES) {
      for (let t = 0; t < 4; t++) {
        for (const m of [false, true]) expect(validate(a, a.fallback, new Frame(t, m)), `${a.id} t${t} m${m}`).toBe(true);
      }
    }
  });

  it('generates a verified, solvable chamber for every day of the first two years', () => {
    for (let d = 1; d <= 730; d++) expect(dailyChamber(d).verified, `day ${d}`).toBe(true);
  }, 60_000);

  it('cannot be cleared just by walking to the exit', () => {
    for (let d = 1; d <= 60; d++) {
      const h = createHarness((w) => dailyChamber(d).level.build(w));
      const reached = simulate(h, 8, towardGoal(h), (p) => atGoal(h, p));
      disposeHarness(h);
      expect(reached, `day ${d}`).toBe(false);
    }
  });
});
