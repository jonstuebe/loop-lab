# Loop Lab

A small first-person portal puzzle game built with [three.js](https://threejs.org/), TypeScript and Vite.

Fire two linked portals onto the cream panels and use them to reach the glowing green exit in each of the eight test chambers. Whatever goes into one portal comes out of the other, keeping its speed.

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

**Desktop:** WASD to move, mouse to look (click to capture the pointer, or drag if pointer lock is unavailable). Left/right click (or Q/F) fires the blue/orange portal, Space jumps, E picks up or drops a cube, and R restarts the chamber.

**Touch:** drag on the left half of the screen to move and on the right half to look. Use the on-screen buttons to fire portals, jump and grab.

The ⚙ button opens graphics quality settings (Low / Medium / High / Ultra). Your choice is saved in `localStorage`.

## Project layout

```
index.html              HUD / overlay markup and the game canvas
src/
  main.ts               entry point
  game.ts               Game class: state machine, update loop, rendering
  config.ts             tuning constants and graphics quality presets
  physics.ts            AABB collision, ray casts and portal teleporting
  portals.ts            portal placement rules, shaders and render targets
  input.ts              keyboard, mouse/pointer-lock and touch controls
  render/
    stage.ts            renderer, tone mapping, scene, cameras and lighting
    post.ts             post-processing: MSAA, ambient occlusion, bloom, film grade
    textures.ts         procedural colour, normal and packed AO/roughness/metal maps
    materials.ts        surface material: panel variation, grime, room reflections
    decals.ts           grime, light strip, chamber sign and wall detail textures
    geometry.ts         world-aligned and rounded box geometry helpers
    gun.ts              the view-model portal device
    effects.ts          tracers, impact rings, sparks and scorch marks
    particles.ts        pooled additive particle system
  world/
    world.ts            level blocks, rooms and ray casts against them
    dressing.ts         ceiling light strips, wall details and chamber signs
    levels.ts           chamber definitions
    props.ts            floor button, exit pad, cube and floor decals
  ui/
    hud.ts              chamber info chip, crosshair and toasts
    overlay.ts          title / level-complete cards and settings sheet
tests/                  Vitest unit tests, including headless level solutions
```

### Adding a chamber

Add an entry to `LEVELS` in `src/world/levels.ts`. `build()` receives a `World`: use `world.room()` and `world.block()` to lay out geometry (`'white'` surfaces accept portals, `'metal'` ones don't), then return the spawn point, the facing direction and the goal position, plus an optional cube, button and door.
