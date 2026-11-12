import { describe, expect, it } from 'vitest';
import { facingYaw, PadEdges, type PadLike, readPad, SNAP_THRESHOLD } from '../src/xr/controls';

/** An xr-standard gamepad: buttons 0 trigger, 1 grip, 3 stick click, 4 A/X, 5 B/Y; axes 2–3 stick. */
function pad(opts: { trigger?: number; grip?: number; a?: boolean; b?: boolean; stick?: [number, number] } = {}): PadLike {
  const btn = (value: number) => ({ pressed: value > 0.5, value });
  return {
    buttons: [btn(opts.trigger ?? 0), btn(opts.grip ?? 0), btn(0), btn(0), btn(opts.a ? 1 : 0), btn(opts.b ? 1 : 0)],
    axes: [0, 0, opts.stick?.[0] ?? 0, opts.stick?.[1] ?? 0],
  };
}

describe('readPad', () => {
  it('reads nothing from a missing gamepad', () => {
    expect(readPad(null)).toEqual({ trigger: false, grip: false, lower: false, upper: false, stickX: 0, stickY: 0 });
  });

  it('maps the xr-standard layout', () => {
    const s = readPad(pad({ trigger: 1, grip: 0.8, a: true, stick: [0.5, -1] }));
    expect(s).toMatchObject({ trigger: true, grip: true, lower: true, upper: false, stickX: 0.5 });
    // Stick pushed forward reads as positive.
    expect(s.stickY).toBe(1);
  });

  it('ignores a half-pulled trigger and stick drift', () => {
    const s = readPad(pad({ trigger: 0.3, stick: [0.1, 0.05] }));
    expect(s.trigger).toBe(false);
    expect(s.stickX).toBe(0);
    expect(s.stickY).toBe(0);
  });
});

describe('PadEdges', () => {
  it('reports a press once, until the button is released', () => {
    const e = new PadEdges();
    expect([...e.pressed(readPad(pad({ trigger: 1 })))]).toEqual(['trigger']);
    expect(e.pressed(readPad(pad({ trigger: 1 }))).size).toBe(0);
    expect(e.pressed(readPad(pad())).size).toBe(0);
    expect([...e.pressed(readPad(pad({ trigger: 1 })))]).toEqual(['trigger']);
  });

  it('snaps once per flick and re-arms when the stick returns', () => {
    const e = new PadEdges();
    expect(e.snap(SNAP_THRESHOLD + 0.1)).toBe(1);
    expect(e.snap(1)).toBe(0);
    expect(e.snap(0.5)).toBe(0);
    expect(e.snap(-1)).toBe(0); // still not re-armed: never passed through the middle
    expect(e.snap(0)).toBe(0);
    expect(e.snap(-1)).toBe(-1);
  });
});

describe('facingYaw', () => {
  it('faces down -Z at yaw 0, and turns left for positive yaw', () => {
    expect(facingYaw({ x: 0, y: 0, z: -1 })).toBeCloseTo(0);
    expect(facingYaw({ x: -1, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2);
  });

  it('falls back to the flight direction when looking straight up or down', () => {
    expect(facingYaw({ x: 0, y: 1, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(facingYaw({ x: 0, y: -1, z: 0 }, { x: 0, z: 0 })).toBeNull();
  });
});
