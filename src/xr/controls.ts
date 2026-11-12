/**
 * Quest Touch controller mapping, kept free of three.js and WebXR objects so it
 * can be unit tested. Gamepads follow the WebXR "xr-standard" layout:
 * buttons 0 trigger, 1 grip, 3 thumbstick click, 4 A/X, 5 B/Y; axes 2–3 thumbstick.
 */

/** The subset of the Gamepad API we read. */
export interface PadLike {
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>;
  readonly axes: ReadonlyArray<number>;
}

export interface PadState {
  trigger: boolean;
  grip: boolean;
  /** A on the right controller, X on the left. */
  lower: boolean;
  /** B on the right controller, Y on the left. */
  upper: boolean;
  stickX: number;
  /** Thumbstick pushed forward is positive. */
  stickY: number;
}

export const EMPTY_PAD: Readonly<PadState> = { trigger: false, grip: false, lower: false, upper: false, stickX: 0, stickY: 0 };

/** Below this, thumbstick drift is ignored. */
export const STICK_DEADZONE = 0.15;
/** Snap turn fires when the stick passes this, and re-arms once it falls back under SNAP_REARM. */
export const SNAP_THRESHOLD = 0.7;
export const SNAP_REARM = 0.3;
/** One snap turn, in radians. */
export const SNAP_ANGLE = Math.PI / 6;

const TRIGGER_ON = 0.6;

export function readPad(pad: PadLike | null | undefined): PadState {
  if (!pad) return { ...EMPTY_PAD };
  const button = (i: number) => pad.buttons[i]?.pressed ?? false;
  const dead = (v: number | undefined) => (v === undefined || Math.abs(v) < STICK_DEADZONE ? 0 : v);
  return {
    trigger: (pad.buttons[0]?.value ?? 0) >= TRIGGER_ON || button(0),
    grip: (pad.buttons[1]?.value ?? 0) >= TRIGGER_ON || button(1),
    lower: button(4),
    upper: button(5),
    stickX: dead(pad.axes[2]),
    // Gamepad Y axes point down; flip so forward is positive.
    stickY: -dead(pad.axes[3]),
  };
}

export type PadButton = 'trigger' | 'grip' | 'lower' | 'upper';
const BUTTONS: readonly PadButton[] = ['trigger', 'grip', 'lower', 'upper'];

/** Turns held-button state into one-shot presses, plus snap turns from the stick. */
export class PadEdges {
  private prev: PadState = { ...EMPTY_PAD };
  private snapArmed = true;

  /** Buttons that went down since the last call. */
  pressed(now: PadState): Set<PadButton> {
    const out = new Set<PadButton>();
    for (const b of BUTTONS) if (now[b] && !this.prev[b]) out.add(b);
    this.prev = { ...now };
    return out;
  }

  /** −1 / +1 for a snap turn left / right this frame, else 0. */
  snap(stickX: number): -1 | 0 | 1 {
    if (Math.abs(stickX) < SNAP_REARM) this.snapArmed = true;
    if (!this.snapArmed || Math.abs(stickX) < SNAP_THRESHOLD) return 0;
    this.snapArmed = false;
    return stickX > 0 ? 1 : -1;
  }

  reset(): void {
    this.prev = { ...EMPTY_PAD };
    this.snapArmed = true;
  }
}

/**
 * Yaw (radians, three.js convention: 0 looks down −Z, positive turns left) that
 * points a body along `dir`, for re-facing the rig after a portal. Falls back to
 * `fallback` (e.g. the flight direction) when `dir` is close to vertical.
 */
export function facingYaw(dir: { x: number; y: number; z: number }, fallback?: { x: number; z: number }): number | null {
  const h = Math.hypot(dir.x, dir.z);
  if (h > 0.3) return Math.atan2(-dir.x, -dir.z);
  if (fallback && Math.hypot(fallback.x, fallback.z) > 0.5) return Math.atan2(-fallback.x, -fallback.z);
  return null;
}
