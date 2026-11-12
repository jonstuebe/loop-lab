/** Player look settings (sensitivity multiplier, invert Y), persisted in localStorage. */

export interface LookSettings {
  /** Multiplier on the base look speed; 1 = the original feel. */
  sensitivity: number;
  invertY: boolean;
}

export const STORAGE_KEY_LOOK = 'loop-lab-look';
export const SENSITIVITY_MIN = 0.1;
export const SENSITIVITY_MAX = 3;
export const SENSITIVITY_STEP = 0.05;
export const DEFAULT_LOOK: Readonly<LookSettings> = { sensitivity: 1, invertY: false };

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** Clamps to [min, max] and snaps to the slider step; non-numbers fall back to 1. */
export function clampSensitivity(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LOOK.sensitivity;
  const snapped = Math.round(n / SENSITIVITY_STEP) * SENSITIVITY_STEP;
  return Number(Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, snapped)).toFixed(2));
}

/** Formats a multiplier for display, e.g. 1 → "1.00×". */
export function formatSensitivity(value: number): string {
  return `${clampSensitivity(value).toFixed(2)}×`;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads saved settings, falling back to defaults on missing or corrupt data. */
export function loadLookSettings(storage: Reader | null = browserStorage()): LookSettings {
  try {
    const raw = storage?.getItem(STORAGE_KEY_LOOK);
    if (!raw) return { ...DEFAULT_LOOK };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_LOOK };
    const p = parsed as Record<string, unknown>;
    return {
      sensitivity: clampSensitivity(p.sensitivity),
      invertY: p.invertY === true,
    };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function saveLookSettings(settings: LookSettings, storage: Writer | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY_LOOK, JSON.stringify({
      sensitivity: clampSensitivity(settings.sensitivity),
      invertY: settings.invertY,
    }));
  } catch {
    // storage unavailable (private mode, quota) — keep the in-memory value
  }
}

let current: LookSettings | null = null;

/** The live settings; input reads this on every look event so changes apply immediately. */
export function lookSettings(): Readonly<LookSettings> {
  current ??= loadLookSettings();
  return current;
}

/** Updates the live settings and persists them. */
export function setLookSettings(patch: Partial<LookSettings>): LookSettings {
  const next = { ...lookSettings(), ...patch };
  next.sensitivity = clampSensitivity(next.sensitivity);
  current = next;
  saveLookSettings(next);
  return next;
}
