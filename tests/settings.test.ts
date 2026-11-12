import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOK, STORAGE_KEY_LOOK, clampSensitivity, formatSensitivity, loadLookSettings, saveLookSettings,
} from '../src/settings';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe('clampSensitivity', () => {
  it('clamps to the slider range', () => {
    expect(clampSensitivity(0)).toBe(0.1);
    expect(clampSensitivity(-5)).toBe(0.1);
    expect(clampSensitivity(10)).toBe(3);
    expect(clampSensitivity(1.5)).toBe(1.5);
  });

  it('snaps to the step and parses strings', () => {
    expect(clampSensitivity(1.234)).toBe(1.25);
    expect(clampSensitivity('0.5')).toBe(0.5);
  });

  it('falls back to 1 for junk', () => {
    expect(clampSensitivity(NaN)).toBe(1);
    expect(clampSensitivity('abc')).toBe(1);
    expect(clampSensitivity(undefined)).toBe(1);
    expect(clampSensitivity(Infinity)).toBe(1);
  });

  it('formats for display', () => {
    expect(formatSensitivity(1)).toBe('1.00×');
    expect(formatSensitivity(0.1)).toBe('0.10×');
  });
});

describe('load/save look settings', () => {
  it('defaults when nothing is stored or storage is unavailable', () => {
    expect(loadLookSettings(memoryStorage())).toEqual(DEFAULT_LOOK);
    expect(loadLookSettings(null)).toEqual(DEFAULT_LOOK);
  });

  it('round-trips through storage', () => {
    const s = memoryStorage();
    saveLookSettings({ sensitivity: 2.2, invertY: true }, s);
    expect(loadLookSettings(s)).toEqual({ sensitivity: 2.2, invertY: true });
  });

  it('clamps out-of-range stored values and ignores corrupt data', () => {
    expect(loadLookSettings(memoryStorage({ [STORAGE_KEY_LOOK]: '{"sensitivity":99,"invertY":"yes"}' })))
      .toEqual({ sensitivity: 3, invertY: false });
    expect(loadLookSettings(memoryStorage({ [STORAGE_KEY_LOOK]: 'not json' }))).toEqual(DEFAULT_LOOK);
    expect(loadLookSettings(memoryStorage({ [STORAGE_KEY_LOOK]: 'null' }))).toEqual(DEFAULT_LOOK);
  });

  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(loadLookSettings(throwing)).toEqual(DEFAULT_LOOK);
    expect(() => saveLookSettings({ sensitivity: 1, invertY: false }, throwing)).not.toThrow();
  });
});
