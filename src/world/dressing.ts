import {
  Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type Texture, Vector3,
} from 'three';
import { chamberSignTexture, createGreebleTextures, createLightStripTexture } from '../render/decals';
import { hash } from '../render/textures';
import { pointInside } from '../physics';
import type { Block, World } from './world';

const STRIP_LENGTH = 2.6;
const STRIP_WIDTH = 0.42;
const SIGN_W = 3.4;
const SIGN_H = 1.7;
const GREEBLE_SIZE = 1.5;
const MAX_GREEBLES = 16;

const HORIZONTAL = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];

/**
 * Set dressing that has no effect on play: ceiling lights, the stencilled
 * chamber number and bits of hardware on the steel walls. Everything is a
 * flat decal sitting just off its surface, so portals still draw over it.
 */
export class Dressing {
  private readonly stripMaterial: MeshBasicMaterial;
  private readonly greebleMaterials: MeshStandardMaterial[];
  private readonly signMaterials = new Map<Texture, MeshStandardMaterial>();

  constructor() {
    this.stripMaterial = new MeshBasicMaterial({
      map: createLightStripTexture(), color: new Color(1, 0.95, 0.86).multiplyScalar(5.5), fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.greebleMaterials = createGreebleTextures().map((map) => decalMaterial(map, 0.55, 0.35));
  }

  /** Adds this level's dressing to the world. Call after the level's blocks are built. */
  apply(world: World, index: number, total: number, name: string, spawn: Vector3, yaw: number): void {
    const group = new Group();
    this.addCeilingLights(world, group);
    this.addGreebles(world, group, index);
    this.addChamberSign(world, group, index, total, name, spawn, yaw);
    world.add(group);
  }

  private addCeilingLights(world: World, group: Group): void {
    const probe = new Vector3();
    const free = (x: number, y: number, z: number) => {
      probe.set(x, y, z);
      return !world.blocks.some((b) => b.active && pointInside(probe, b));
    };
    for (const block of world.blocks) {
      // Ceilings are the blocks that let the key light through.
      if (block.mesh.castShadow || block.type === 'door') continue;
      const sx = block.max.x - block.min.x;
      const sz = block.max.z - block.min.z;
      const alongX = sx > sz;
      const y = block.min.y;
      for (const x of spread(block.min.x, block.max.x, alongX ? 5 : 4)) {
        for (const z of spread(block.min.z, block.max.z, alongX ? 4 : 5)) {
          const hx = alongX ? STRIP_LENGTH / 2 : STRIP_WIDTH / 2;
          const hz = alongX ? STRIP_WIDTH / 2 : STRIP_LENGTH / 2;
          // The whole strip must hang over open air, with headroom below it.
          if (!free(x, y - 0.1, z) || !free(x - hx, y - 0.1, z - hz) || !free(x + hx, y - 0.1, z + hz) || !free(x, y - 1.2, z)) continue;
          const strip = new Mesh(new PlaneGeometry(STRIP_LENGTH, STRIP_WIDTH), this.stripMaterial);
          strip.position.set(x, y - 0.006, z);
          strip.rotation.set(Math.PI / 2, 0, alongX ? 0 : Math.PI / 2);
          group.add(strip);
        }
      }
    }
  }

  private addGreebles(world: World, group: Group, level: number): void {
    const candidates: Array<{ p: Vector3; n: Vector3; kind: number; score: number }> = [];
    for (const block of world.blocks) {
      if (block.type !== 'metal' || !block.mesh.castShadow) continue;
      for (const n of HORIZONTAL) {
        const axis = n.x !== 0 ? 'x' : 'z';
        const tangent = axis === 'x' ? 'z' : 'x';
        const plane = n[axis] > 0 ? block.max[axis] : block.min[axis];
        // Walk the 2-unit panel grid, which is anchored to world coordinates.
        for (let a = Math.ceil(block.min[tangent] / 2) * 2; a + 2 <= block.max[tangent] + 1e-6; a += 2) {
          for (let b = Math.ceil(block.min.y / 2) * 2; b + 2 <= block.max.y + 1e-6; b += 2) {
            const roll = hash(a * 7 + Math.round(plane * 13), b * 3 + (n.x + n.z > 0 ? 5 : 0), 900 + level);
            if (roll > 0.085) continue;
            const p = new Vector3();
            p[axis] = plane;
            p[tangent] = a + 1;
            p.y = b + 1;
            if (!faceIsClear(world, block, p, n, GREEBLE_SIZE / 2, GREEBLE_SIZE / 2)) continue;
            candidates.push({ p, n, kind: Math.floor((roll / 0.085) * 3.999), score: roll });
          }
        }
      }
    }
    candidates.sort((x, y) => x.score - y.score);
    for (const c of candidates.slice(0, MAX_GREEBLES)) {
      group.add(decal(this.greebleMaterials[c.kind], c.p, c.n, GREEBLE_SIZE, GREEBLE_SIZE));
    }
  }

  /** Paints the chamber number on the first suitable wall around the spawn point. */
  private addChamberSign(world: World, group: Group, index: number, total: number, name: string, spawn: Vector3, yaw: number): void {
    const eye = spawn.clone();
    eye.y += 1.6;
    const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new Vector3(-forward.z, 0, forward.x);
    const dirs = [right, right.clone().negate(), forward, forward.clone().negate()];
    let best: { p: Vector3; n: Vector3; block: Block; rank: number } | null = null;
    for (let i = 0; i < dirs.length; i++) {
      const hit = world.raycast(eye, dirs[i]);
      if (!hit || Math.abs(hit.normal.y) > 0.5 || hit.t < 1.2 || hit.block.type === 'door') continue;
      const { block, normal } = hit;
      const tangent = normal.x !== 0 ? 'z' : 'x';
      const lo = block.min[tangent] + SIGN_W / 2 + 0.3;
      const hi = block.max[tangent] - SIGN_W / 2 - 0.3;
      const y = spawn.y + 2.5;
      if (lo > hi || y - SIGN_H / 2 < block.min.y + 0.2 || y + SIGN_H / 2 > block.max.y - 0.2) continue;
      const p = eye.clone().addScaledVector(dirs[i], hit.t);
      p[tangent] = Math.min(hi, Math.max(lo, p[tangent]));
      p.y = y;
      if (!faceIsClear(world, block, p, normal, SIGN_W / 2, SIGN_H / 2)) continue;
      // Steel walls first: a sign on cream would sit where portals want to go.
      const rank = (block.type === 'metal' ? 0 : 10) + i;
      if (!best || rank < best.rank) best = { p, n: normal.clone(), block, rank };
    }
    if (!best) return;
    const onSteel = best.block.type === 'metal';
    const map = chamberSignTexture(index, total, name, onSteel);
    let material = this.signMaterials.get(map);
    if (!material) {
      material = decalMaterial(map, 0.6, 0);
      material.opacity = onSteel ? 0.82 : 0.7;
      this.signMaterials.set(map, material);
    }
    group.add(decal(material, best.p, best.n, SIGN_W, SIGN_H));
  }
}

function decalMaterial(map: Texture, roughness: number, metalness: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map, roughness, metalness, transparent: true, depthWrite: false, envMapIntensity: 0.6,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

function decal(material: MeshStandardMaterial, p: Vector3, n: Vector3, w: number, h: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(w, h), material);
  mesh.position.copy(p).addScaledVector(n, 0.005);
  mesh.lookAt(p.clone().add(n));
  mesh.receiveShadow = true;
  // Draw before portals and particles, which sit in front of the wall.
  mesh.renderOrder = -1;
  return mesh;
}

/** Evenly spaced positions across min..max, about `gap` apart, kept clear of the ends. */
function spread(min: number, max: number, gap: number): number[] {
  const n = Math.max(1, Math.round((max - min - 2) / gap));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(min + ((i + 0.5) * (max - min)) / n);
  return out;
}

/** True if a w × h patch centred at `p` lies on `host`'s face and nothing covers or crowds it. */
function faceIsClear(world: World, host: Block, p: Vector3, n: Vector3, halfW: number, halfH: number): boolean {
  const tangent = n.x !== 0 ? 'z' : 'x';
  const q = new Vector3();
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      q.copy(p);
      q[tangent] += a * halfW;
      q.y += b * halfH;
      if (q[tangent] < host.min[tangent] - 1e-3 || q[tangent] > host.max[tangent] + 1e-3) return false;
      if (q.y < host.min.y - 1e-3 || q.y > host.max.y + 1e-3) return false;
      for (const d of [0.08, 0.7]) {
        q.addScaledVector(n, d);
        for (const block of world.blocks) {
          if (block !== host && block.active && pointInside(q, block)) return false;
        }
        q.addScaledVector(n, -d);
      }
    }
  }
  return true;
}
