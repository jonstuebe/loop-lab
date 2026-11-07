import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { atGoal, eyeOf, loadLevel, shootAt, simulate, toward, towardGoal, walkTo } from './helpers';

const GRAB_RANGE = 2.6;
const NORTH = new Vector3(0, 0, -1); // -z
const SOUTH = new Vector3(0, 0, 1); // +z
const WEST = new Vector3(-1, 0, 0); // -x
const EAST = new Vector3(1, 0, 0); // +x

/** Can the player stand near the cube (close enough to grab it)? */
function canReachCube(h: ReturnType<typeof loadLevel>): boolean {
  const [cx, cy, cz] = h.setup.cube!;
  return simulate(h, 6, toward(cx, cz), (p) => {
    const eye = eyeOf(h);
    return p.onGround && eye.distanceTo(new Vector3(cx, cy, cz)) < GRAB_RANGE - 0.4;
  });
}

describe('chamber 4: Crossing', () => {
  it('walk through the wall behind spawn and out across the chasm', () => {
    const h = loadLevel(3);
    const eye = eyeOf(h);
    expect(shootAt(h, 0, eye, new Vector3(4.5, 1.5, 12.5))).not.toBeNull(); // far side panel
    expect(shootAt(h, 1, eye, new Vector3(0, 1.6, -6))).not.toBeNull(); // wall behind spawn
    let through = false;
    const goal = towardGoal(h);
    const reached = simulate(h, 6, (p) => {
      if (p.pos.z > 5) through = true;
      return through ? goal(p) : NORTH;
    }, (p) => atGoal(h, p));
    expect(reached).toBe(true);
  });

  it('cannot be jumped', () => {
    const h = loadLevel(3);
    h.player.vel.set(0, 7.6, 5.5); // running jump off the very edge
    h.player.pos.z = 0.7;
    simulate(h, 3, () => SOUTH, () => false);
    expect(h.player.pos.y).toBeLessThan(-10);
  });
});

describe('chamber 5: Courier', () => {
  it('fetch the cube from the island and bring it back to the button', () => {
    const h = loadLevel(4);
    const eye = eyeOf(h);
    expect(shootAt(h, 0, eye, new Vector3(0, 1.6, 15))).not.toBeNull(); // far wall
    expect(shootAt(h, 1, eye, new Vector3(-5.5, 1.5, -3.5))).not.toBeNull(); // home side panel

    // Through the side panel to the island.
    expect(simulate(h, 4, () => WEST, (p) => p.pos.z > 9)).toBe(true);
    expect(canReachCube(h)).toBe(true);

    // Back through the far wall, out of the side panel, over to the button.
    const farWall = h.portals.list[0].center;
    expect(simulate(h, 4, toward(farWall.x, farWall.z + 2), (p) => p.pos.z < 1)).toBe(true);
    expect(h.player.pos.x).toBeLessThan(-4); // came out of the side panel
    const [bx, , bz] = h.setup.button!;
    expect(walkTo(h, bx, bz)).toBe(true);

    // With the cube on the button the door opens and the exit is reachable.
    h.setup.door!.active = false;
    expect(walkTo(h, 0, -7)).toBe(true);
    expect(simulate(h, 4, towardGoal(h), (p) => atGoal(h, p))).toBe(true);
  });

  it('keeps the exit shut while the door is closed', () => {
    const h = loadLevel(4);
    walkTo(h, 0, -7);
    expect(simulate(h, 4, towardGoal(h), (p) => atGoal(h, p))).toBe(false);
  });
});

describe('chamber 6: Geyser', () => {
  it('drop off the tower into one floor portal and rise out of the other onto the ledge', () => {
    const h = loadLevel(5);
    const eye = eyeOf(h);
    expect(shootAt(h, 0, eye, new Vector3(0.3, 0, 0))).not.toBeNull(); // where you land
    expect(shootAt(h, 1, eye, new Vector3(3.6, 0, 0))).not.toBeNull(); // beside the ledge
    const goal = towardGoal(h);
    const reached = simulate(h, 6, (p) => (p.pos.x > 2 && p.pos.y < 7.5 ? null : p.pos.x < 2 ? EAST : goal(p)), (p) => atGoal(h, p));
    expect(reached).toBe(true);
  });

  it('cannot be reached from the tower without portals', () => {
    const h = loadLevel(5);
    h.player.vel.set(5.5, 7.6, 0);
    simulate(h, 3, () => EAST, () => false);
    expect(h.player.pos.y).toBeLessThan(1);
  });
});

describe('chamber 7: Switchback', () => {
  it('climb to the ledge, then re-aim a portal from up there to reach the catwalk', () => {
    const h = loadLevel(6);
    let eye = eyeOf(h);
    expect(shootAt(h, 0, eye, new Vector3(0, 9, 11))).not.toBeNull(); // wall behind the ledge
    expect(shootAt(h, 1, eye, new Vector3(0, 1.6, -8))).not.toBeNull(); // wall behind spawn
    expect(simulate(h, 4, () => NORTH, (p) => p.pos.y > 4)).toBe(true);
    expect(walkTo(h, 0, 8)).toBe(true);
    expect(h.player.pos.y).toBeGreaterThan(4.5);

    eye = eyeOf(h);
    expect(shootAt(h, 0, eye, new Vector3(0, 5.6, 11))).not.toBeNull(); // low on the ledge wall now
    expect(shootAt(h, 1, eye, new Vector3(0, 10, -8))).not.toBeNull(); // panel above the catwalk
    expect(simulate(h, 4, () => SOUTH, (p) => atGoal(h, p))).toBe(true);
  });

  it('hides the catwalk panel from the ground', () => {
    const h = loadLevel(6);
    for (const z of [-7, -4, -1, 0.5, 1.6]) {
      for (const y of [7.5, 10, 13]) {
        const eye = new Vector3(0, 1.6, z);
        const hit = h.world.raycast(eye, new Vector3(0, y, -8).sub(eye).normalize());
        expect(hit && hit.block.min.y === 7 && hit.block.type === 'white').toBeFalsy();
      }
    }
  });
});

describe('chamber 8: Gauntlet', () => {
  it('fling, climb to the shelf, then take the cube to the button', () => {
    const h = loadLevel(7);
    const spawnEye = eyeOf(h);
    const edgeEye = new Vector3(0, 1.6, -0.35);
    expect(shootAt(h, 0, spawnEye, new Vector3(0, 2.5, -4))).not.toBeNull();
    expect(shootAt(h, 1, edgeEye, new Vector3(0, -14, 6.5))).not.toBeNull();
    let flung = false;
    const landed = simulate(h, 8, (p) => {
      if (p.pos.y > 1.5) flung = true;
      return flung ? toward(0, 18)(p) : SOUTH;
    }, (p) => p.onGround && p.pos.y < -4 && p.pos.z > 12);
    expect(landed).toBe(true);

    // On the plateau: link the pillar's far side to the panel above the shelf.
    expect(walkTo(h, -3, 18)).toBe(true);
    const eye = eyeOf(h);
    expect(shootAt(h, 0, eye, new Vector3(-3, -4.5, 15.5))).not.toBeNull(); // pillar's cream side
    expect(shootAt(h, 1, eye, new Vector3(4.5, 3, 25))).not.toBeNull(); // panel above the shelf
    expect(simulate(h, 4, () => NORTH, (p) => p.pos.y > -2.5 && p.pos.x > 1)).toBe(true);
    expect(canReachCube(h)).toBe(true);

    // Step off the shelf with the cube and carry it to the button.
    expect(walkTo(h, -0.5, 24)).toBe(true);
    const [bx, , bz] = h.setup.button!;
    expect(walkTo(h, bx, bz)).toBe(true);

    h.setup.door!.active = false;
    expect(walkTo(h, -2, 26)).toBe(true);
    expect(simulate(h, 4, towardGoal(h), (p) => atGoal(h, p))).toBe(true);
  });

  it('cannot skip the fling or the climb from the starting ledge', () => {
    const h = loadLevel(7);
    for (const x of [-4.5, 0, 4.5]) {
      for (const z of [-3.5, -2, -0.4]) {
        const eye = new Vector3(x, 1.6, z);
        for (const target of [new Vector3(4.5, 0, 22), new Vector3(4.5, 3, 27), new Vector3(-3, -3, 15.5)]) {
          const hit = h.world.raycast(eye, target.clone().sub(eye).normalize());
          expect(hit && hit.block.type === 'white' && hit.block.min.z > 10).toBeFalsy();
        }
      }
    }
  });
});
