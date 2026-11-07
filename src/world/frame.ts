import type { Vector3 } from 'three';
import type { LevelSetup, Vec3Tuple } from './levels';
import type { Block, Surface, World } from './world';

/**
 * A quarter-turn rotation about the vertical axis, optionally mirrored, so
 * one chamber layout can be built facing any of eight ways. Generators lay
 * chambers out in a canonical frame and build them through this.
 */
export class Frame {
  constructor(readonly turns: number, readonly mirror: boolean) {}

  static readonly identity = new Frame(0, false);

  /** Canonical → world. Directions transform the same way (the map is linear). */
  point(x: number, y: number, z: number): [number, number, number] {
    let a = this.mirror ? -x : x;
    let b = z;
    for (let i = 0; i < this.turns; i++) [a, b] = [b, -a];
    return [a, y, b];
  }

  /** World → canonical. */
  inverse(x: number, y: number, z: number): [number, number, number] {
    let a = x;
    let b = z;
    for (let i = 0; i < this.turns; i++) [a, b] = [-b, a];
    return [this.mirror ? -a : a, y, b];
  }

  tuple(p: Vec3Tuple): Vec3Tuple {
    return this.point(p[0], p[1], p[2]);
  }

  vec(v: Vector3): Vector3 {
    const [x, y, z] = this.point(v.x, v.y, v.z);
    return v.set(x, y, z);
  }

  inverseVec(v: Vector3): Vector3 {
    const [x, y, z] = this.inverse(v.x, v.y, v.z);
    return v.set(x, y, z);
  }

  /** Maps a canonical yaw (forward = (-sin, 0, -cos)) into this frame. */
  yaw(yaw: number): number {
    const [fx, , fz] = this.point(-Math.sin(yaw), 0, -Math.cos(yaw));
    return Math.atan2(-fx, -fz);
  }
}

/** Builds level geometry in canonical coordinates, placing it through a Frame. */
export class FramedBuilder {
  constructor(readonly world: World, readonly frame: Frame) {}

  block(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, type: Surface, noShadow = false): Block {
    const [ax, ay, az] = this.frame.point(x1, y1, z1);
    const [bx, by, bz] = this.frame.point(x2, y2, z2);
    return this.world.block(
      Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz),
      Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz),
      type, noShadow,
    );
  }

  setup(s: LevelSetup): LevelSetup {
    const f = this.frame;
    return {
      spawn: f.tuple(s.spawn),
      yaw: f.yaw(s.yaw),
      goal: f.tuple(s.goal),
      cube: s.cube && f.tuple(s.cube),
      button: s.button && f.tuple(s.button),
      door: s.door,
    };
  }
}
