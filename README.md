# Loop Lab

A small first-person portal puzzle game built with [three.js](https://threejs.org/), TypeScript and Vite.

Fire two linked portals onto the cream panels and use them to reach the glowing green exit. Whatever goes into one portal comes out of the other, keeping its speed.

There's a **new chamber every day**, the same for everyone. Past days stay playable from the *Past chambers* list, and eight hand-built *Training* chambers introduce the mechanics. Clear times, portal counts and your streak are saved in `localStorage`.

## Getting started

Requires Node.js 20.19 or newer.

```sh
npm install
npm run dev        # start the dev server with hot reload
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` (strict mode) |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run check` | Type-check, test and build: what CI runs |

The build uses a relative base path, so you can host the contents of `dist/` from any static host or sub-folder.

## Controls

**Desktop:** WASD to move, mouse to look (click to capture the pointer, or drag if pointer lock is unavailable). Left/right click (or Q/F) fires the blue/orange portal, Space jumps, E picks up or drops a cube, and R restarts the chamber. The ⌂ button returns to the main menu (press Esc first to release the mouse).

**Touch:** drag on the left half of the screen to move and on the right half to look. Use the on-screen buttons to fire portals, jump and grab.

The ⚙ button opens graphics quality settings (Low / Medium / High / Ultra). Your choice is saved in `localStorage`.

## Project layout

```
index.html              HUD / overlay markup and the game canvas
src/
  main.ts               entry point: drives the loading screen, then starts the game
  game.ts               Game class: state machine, menus, update loop, rendering
  daily/
    calendar.ts         chamber numbering (#1 = 1 Nov 2026) and date/time formatting
    generator.ts        seeded procedural chamber archetypes, each with a reference solution
    progress.ts         per-device clear records and streaks
    random.ts           seeded PRNG helpers
  config.ts             tuning constants and graphics quality presets
  physics.ts            AABB collision, ray casts and portal teleporting
  portals.ts            portal placement rules, shaders and render targets
  input.ts              keyboard, mouse/pointer-lock and touch controls
  render/
    stage.ts            renderer, tone mapping, scene, cameras and lighting
    post.ts             post-processing: MSAA, ambient occlusion, bloom
    textures.ts         procedural colour, normal and roughness maps
    geometry.ts         tiled and rounded box geometry helpers
    gun.ts              the view-model portal device
    effects.ts          tracers, impact rings, sparks and scorch marks
    particles.ts        pooled additive particle system
  world/
    world.ts            level blocks, rooms and ray casts against them
    levels.ts           hand-built training chambers
    frame.ts            rotates/mirrors a chamber layout into one of eight orientations
    solver.ts           headless playthrough harness (validates daily chambers; used by tests)
    props.ts            floor button, exit pad, cube and floor decals
  ui/
    hud.ts              chamber info chip, run timer, crosshair and toasts
    overlay.ts          menu / archive / level-complete cards and settings sheet
    preloader.ts        loading screen progress (its markup and styles are inline in index.html)
tests/                  Vitest unit tests, including headless level solutions
```

### Daily chambers

Each day's chamber is generated from its number, so everyone gets the same one. `src/daily/generator.ts` picks one of five archetypes (climb, crossing, fling, geyser, payload; never the same one two days running), rolls its dimensions and an orientation, then replays the archetype's reference solution headlessly. A layout that the solution can't clear is re-rolled, so every daily chamber is solvable. The tests check the first two years of chambers.

To add an archetype, add an entry to `ARCHETYPES` with `roll`, `build` (in canonical coordinates, through the `FramedBuilder`), a known-good `fallback` and a `solve` that clears it. Changing an existing archetype changes past days' chambers too.

### Adding a training chamber

Add an entry to `LEVELS` in `src/world/levels.ts`. `build()` receives a `World`: use `world.room()` and `world.block()` to lay out geometry (`'white'` surfaces accept portals, `'metal'` ones don't), then return the spawn point, the facing direction and the goal position, plus an optional cube, button and door.
