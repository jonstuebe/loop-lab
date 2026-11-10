import { Box3, BoxGeometry, Group, type Material, Mesh, type Object3D, Vector3 } from 'three';
import { worldBoxGeometry } from '../render/geometry';
import { rayBox } from '../physics';

/** cream = portal-friendly, metal = portal-proof, door = moving door slab. */
export type Surface = 'white' | 'metal' | 'door';

/** An axis-aligned solid that bodies collide with. */
export interface Collider {
  min: Vector3;
  max: Vector3;
  active: boolean;
}

/** A static level block: a collider with a surface type and a mesh. */
export interface Block extends Collider {
  type: Surface;
  mesh: Mesh;
}

export interface RayHit {
  t: number;
  normal: Vector3;
  block: Block;
}

/** Which faces of a room to build, and from which surface. Omitted faces are left open. */
export interface RoomFaces {
  floor?: Surface;
  ceil?: Surface;
  xn?: Surface;
  xp?: Surface;
  zn?: Surface;
  zp?: Surface;
}

/** World units covered by one repeat of each surface texture. The door maps its texture once per face. */
const TILE_LENGTH: Record<Exclude<Surface, 'door'>, number> = { white: 1, metal: 2 };

/**
 * One material for the whole block, or one per box face in three.js order
 * (+x, −x, +y, −y, +z, −z) so floors and ceilings can differ from walls.
 */
export type SurfaceMaterial = Material | Material[];

/** Holds the level's geometry: the blocks the player walks on and portals stick to. */
export class World {
  readonly group = new Group();
  blocks: Block[] = [];

  constructor(private readonly materials: Record<Surface, SurfaceMaterial>) {}

  /** Adds an axis-aligned block spanning (x1,y1,z1)–(x2,y2,z2). */
  block(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, type: Surface, noShadow = false): Block {
    const w = x2 - x1;
    const h = y2 - y1;
    const d = z2 - z1;
    const geometry = type === 'door' ? new BoxGeometry(w, h, d) : worldBoxGeometry(x1, y1, z1, x2, y2, z2, TILE_LENGTH[type]);
    const mesh = new Mesh(geometry, this.materials[type]);
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = !noShadow;
    this.group.add(mesh);
    const block: Block = { min: new Vector3(x1, y1, z1), max: new Vector3(x2, y2, z2), type, mesh, active: true };
    this.blocks.push(block);
    return block;
  }

  /** Builds 1-unit-thick walls around the interior x1..x2, y1..y2, z1..z2. */
  room(x1: number, x2: number, y1: number, y2: number, z1: number, z2: number, faces: RoomFaces): void {
    if (faces.floor) this.block(x1 - 1, y1 - 1, z1 - 1, x2 + 1, y1, z2 + 1, faces.floor);
    if (faces.ceil) this.block(x1 - 1, y2, z1 - 1, x2 + 1, y2 + 1, z2 + 1, faces.ceil, true);
    if (faces.xn) this.block(x1 - 1, y1, z1, x1, y2, z2, faces.xn);
    if (faces.xp) this.block(x2, y1, z1, x2 + 1, y2, z2, faces.xp);
    if (faces.zn) this.block(x1 - 1, y1, z1 - 1, x2 + 1, y2, z1, faces.zn);
    if (faces.zp) this.block(x1 - 1, y1, z2, x2 + 1, y2, z2 + 1, faces.zp);
  }

  /** Adds a non-block object (props, cube) to the level so it is cleared with it. */
  add(obj: Object3D): void {
    this.group.add(obj);
  }

  /** Removes everything, disposing geometry of all objects except those in `keep`. */
  clear(keep: ReadonlySet<Object3D>): void {
    for (const obj of [...this.group.children]) {
      this.group.remove(obj);
      if (keep.has(obj)) continue;
      obj.traverse((child) => {
        if (child instanceof Mesh) child.geometry.dispose();
      });
    }
    this.blocks = [];
  }

  /** Nearest active block hit by the ray o + t·d (t ≥ 0). */
  raycast(o: Vector3, d: Vector3): RayHit | null {
    let best: RayHit | null = null;
    for (const block of this.blocks) {
      if (!block.active) continue;
      const hit = rayBox(o, d, block.min, block.max);
      if (hit && (!best || hit.t < best.t)) best = { t: hit.t, normal: hit.normal, block };
    }
    return best;
  }

  bounds(): Box3 {
    const box = new Box3();
    for (const b of this.blocks) {
      box.expandByPoint(b.min);
      box.expandByPoint(b.max);
    }
    return box;
  }
}
