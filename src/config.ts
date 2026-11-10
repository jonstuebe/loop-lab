/** Half-width of a portal opening, in world units. */
export const PORTAL_HALF_W = 0.7;
/** Half-height of a portal opening, in world units. */
export const PORTAL_HALF_H = 1.15;

export const GRAVITY = 22;
export const WALK_SPEED = 5.5;
export const JUMP_SPEED = 7.6;
export const MAX_FALL_SPEED = 48;
/** Eye height above the player's centre. */
export const EYE_HEIGHT = 0.7;
/** How far in front of the eye a held cube floats. */
export const HOLD_DISTANCE = 1.5;
/** Anything that falls below this height is reset. */
export const KILL_Y = -40;

export const BLUE = 0x3aa0ff;
export const ORANGE = 0xff8c2a;
export const PORTAL_COLORS = [BLUE, ORANGE] as const;

/** Index of a portal: 0 = blue, 1 = orange. */
export type PortalIndex = 0 | 1;

export const STORAGE_KEY_QUALITY = 'loop-lab-quality';

export const isTouch: boolean = typeof window !== 'undefined' && (
  (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
  ('ontouchstart' in window && navigator.maxTouchPoints > 0));

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  label: string;
  /** Max device pixel ratio used for the main canvas. */
  ratio: number;
  /** Portal render target resolution, relative to the drawing buffer. */
  rt: number;
  /** Shadow map size; 0 disables shadows. */
  shadow: number;
  soft: boolean;
  aniso: number;
  /** MSAA samples for the main render and portal views; 0 disables it. */
  msaa: number;
  /** Screen-space ambient occlusion. */
  ao: boolean;
  /** Glow around portals and other emissive things. */
  bloom: boolean;
  /** Lens and film finish: sharpening, colour grade, vignette and grain. */
  film: boolean;
  /** Coloured light cast by portals, the exit, the button and each shot. */
  glowLights: boolean;
  desc: string;
}

export const QUALITY: Readonly<Record<QualityName, QualitySettings>> = {
  low: {
    label: 'Low', ratio: 0.75, rt: 0.5, shadow: 0, soft: false, aniso: 1, msaa: 0, ao: false, bloom: false, film: false, glowLights: false,
    desc: 'Reduced resolution, no shadows or effects. Best for older phones.',
  },
  medium: {
    label: 'Medium', ratio: 1, rt: 0.65, shadow: 1024, soft: false, aniso: 4, msaa: 4, ao: false, bloom: true, film: true, glowLights: true,
    desc: 'Standard resolution, simple shadows, portal glow and a film finish.',
  },
  high: {
    label: 'High', ratio: 1.5, rt: 0.85, shadow: 2048, soft: true, aniso: 8, msaa: 4, ao: true, bloom: true, film: true, glowLights: true,
    desc: 'Sharper image, soft shadows, ambient occlusion and crisper portal views.',
  },
  ultra: {
    label: 'Ultra', ratio: 2, rt: 1, shadow: 4096, soft: true, aniso: 16, msaa: 8, ao: true, bloom: true, film: true, glowLights: true,
    desc: 'Full resolution everywhere and the finest shadows. Needs a strong GPU.',
  },
};

export const QUALITY_ORDER: readonly QualityName[] = ['low', 'medium', 'high', 'ultra'];

export function isQualityName(value: unknown): value is QualityName {
  return typeof value === 'string' && (QUALITY_ORDER as readonly string[]).includes(value);
}

export function loadQuality(): QualityName {
  let quality: QualityName = isTouch ? 'medium' : 'high';
  try {
    const saved = localStorage.getItem(STORAGE_KEY_QUALITY);
    if (isQualityName(saved)) quality = saved;
  } catch {
    // storage unavailable (private mode etc.) — fall back to the default
  }
  return quality;
}

export function saveQuality(name: QualityName): void {
  try {
    localStorage.setItem(STORAGE_KEY_QUALITY, name);
  } catch {
    // ignore
  }
}
