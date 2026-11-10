// PROTOTYPE — throwaway. Floating bar that flips between the portal gun
// variants in `render/gun.prototype.ts`. Dev builds only.
import type { Game } from '../game';
import { GUN_VARIANTS } from '../render/gun.prototype';
import type { SurfaceMaps } from '../render/textures';

export function mountGunSwitcher(game: Game, maps: SurfaceMaps): void {
  const params = new URLSearchParams(location.search);
  let index = Math.max(0, GUN_VARIANTS.findIndex((v) => v.key === (params.get('gun') ?? 'A').toUpperCase()));

  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:10px;'
    + 'padding:6px 8px;border-radius:999px;background:#111;color:#fff;font:600 13px/1 system-ui,sans-serif;'
    + 'box-shadow:0 4px 18px rgba(0,0,0,.5);border:1px solid #ff3ea5;user-select:none';
  const button = (text: string, step: number) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;background:#2a2a2a';
    b.addEventListener('click', (e) => { e.stopPropagation(); show(index + step); });
    return b;
  };
  const label = document.createElement('span');
  label.style.cssText = 'min-width:190px;text-align:center';
  bar.append(button('[ ‹', -1), label, button('› ]', 1));
  document.body.append(bar);

  function show(next: number): void {
    index = (next + GUN_VARIANTS.length) % GUN_VARIANTS.length;
    const variant = GUN_VARIANTS[index];
    game.setGun(variant.make(maps));
    label.textContent = `GUN ${variant.key} · ${variant.name}  (${index + 1}/${GUN_VARIANTS.length})`;
    params.set('gun', variant.key);
    history.replaceState(null, '', `?${params}`);
  }

  // Arrow keys turn the player, so the brackets cycle instead.
  addEventListener('keydown', (e) => {
    if (e.code === 'BracketLeft') show(index - 1);
    if (e.code === 'BracketRight') show(index + 1);
  });
  show(index);
}
