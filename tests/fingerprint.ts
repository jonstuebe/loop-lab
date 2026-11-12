import type { LevelDef } from '../src/world/levels';
import { createHarness, disposeHarness } from '../src/world/solver';

/** FNV-1a over a string, as 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const r = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Exact description of a built chamber: every block, plus spawn, yaw, goal, cube and button. */
export function chamberGeometry(level: LevelDef): string {
  const h = createHarness((w) => level.build(w));
  const { setup } = h;
  const blocks = h.world.blocks.map((b) => [b.type, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => (typeof v === 'number' ? r(v) : v)).join(','));
  const tup = (t?: readonly number[]) => (t ? t.map(r).join(',') : '-');
  const out = [...blocks, `spawn ${tup(setup.spawn)}`, `yaw ${r(setup.yaw)}`, `goal ${tup(setup.goal)}`, `cube ${tup(setup.cube)}`, `button ${tup(setup.button)}`].join(';');
  disposeHarness(h);
  return out;
}

export const fingerprint = (level: LevelDef) => fnv(chamberGeometry(level));
