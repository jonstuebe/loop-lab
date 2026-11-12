import {
  Color, Frustum, type Material, Matrix4, Mesh, MeshStandardMaterial, PCFShadowMap, Plane, Sphere, Vector2, Vector3,
} from 'three';
import {
  EYE_HEIGHT, GRAVITY, HOLD_DISTANCE, isTouch, JUMP_SPEED, KILL_Y, MAX_FALL_SPEED, QUALITY, type PortalIndex,
  type QualityName, WALK_SPEED, loadQuality, saveQuality,
} from './config';
import { dateForDay, dayNumber, formatCountdown, formatDay, formatTime, msUntilNextDay } from './daily/calendar';
import { chamberName, dailyChamber } from './daily/generator';
import { currentStreak, loadProgress, type Progress, recordClear } from './daily/progress';
import { Input } from './input';
import { type Body, overlaps, physicsStep, rayBox } from './physics';
import { PortalSystem } from './portals';
import { createGrimeTexture } from './render/decals';
import { Effects } from './render/effects';
import { Gun } from './render/gun';
import { surfaceMaterial, surfaceUniforms } from './render/materials';
import { PostFX } from './render/post';
import { createStage, type Stage } from './render/stage';
import type { GameTextures } from './render/textures';
import { Hud } from './ui/hud';
import { type CardSpec, Overlay } from './ui/overlay';
import { Dressing } from './world/dressing';
import { type LevelDef, LEVELS } from './world/levels';
import { animateCube, ButtonProp, CUBE_SIZE, createCubeMesh, GoalProp, type Spring, springStep } from './world/props';
import { type Block, type Collider, type Surface, type SurfaceMaterial, World } from './world/world';
import { facingYaw } from './xr/controls';
import { VRMode } from './xr/vr';

type GameState = 'menu' | 'play' | 'done' | 'settings';

/** What is being played: a daily chamber, or one of the hand-made training chambers. */
type Session = { kind: 'daily'; day: number } | { kind: 'training'; index: number };

interface Cube extends Body {
  held: boolean;
  spawn: Vector3;
  /** Collider the player stands on / bumps into while the cube is not held. */
  collider: Collider;
}

interface Door {
  block: Block;
  /** 0 = closed, 1 = fully open. */
  t: number;
  baseY: number;
}

const PLAYER_HALF = new Vector3(0.3, 0.9, 0.3);
const GRAB_RANGE = 2.6;
/** A held cube is dropped if it gets snagged this far from where it should be. */
const HOLD_BREAK_DISTANCE = 3.2;
const JUMP_BUFFER = 0.15;
const DOOR_HEIGHT = 2.6;
/** Max simulation step; longer frames are subdivided so fast falls don't tunnel. */
const MAX_SUBSTEP = 0.0085;
/** Peak brightness of the coloured light an open portal throws on the room. */
const PORTAL_GLOW = 7;
const GOAL_GLOW = 4;
const BUTTON_RED = new Color(0xff4a3a);
const BUTTON_GREEN = new Color(0x4fe3a1);
/** Where the portal device sits on the right controller's grip: over the forearm, just behind the hand. */
const VR_GUN_REST = new Vector3(0, -0.01, 0.1);

export class Game {
  private readonly stage: Stage;
  private readonly post: PostFX;
  private readonly textures: GameTextures;
  private readonly materials: Record<Surface, SurfaceMaterial>;
  private readonly dressing: Dressing;
  private readonly world: World;
  private readonly portals: PortalSystem;
  private readonly gun: Gun;
  private readonly effects: Effects;
  private readonly hud = new Hud();
  private readonly overlay = new Overlay();
  private readonly input: Input;
  private readonly vr: VRMode;
  private vrSupported = false;
  /** The title card, so it can be redrawn once VR support is known. */
  private mainMenu: CardSpec | null = null;
  private readonly headStep = new Vector3();
  private readonly cubeMesh: ReturnType<typeof createCubeMesh>;
  private readonly propSteelMaterial = new MeshStandardMaterial({ color: 0x4d5663, roughness: 0.36, metalness: 1 });

  private readonly player: Body = {
    pos: new Vector3(), vel: new Vector3(), half: PLAYER_HALF.clone(), onGround: false, isPlayer: true,
  };
  private yaw = 0;
  private pitch = 0;
  /** Camera dip when landing hard. */
  private readonly dip: Spring = { x: 0, v: 0 };
  private jumpBuffer = 0;

  private cube: Cube | null = null;
  private button: { pos: Vector3; prop: ButtonProp } | null = null;
  private door: Door | null = null;
  private goal: { pos: Vector3; prop: GoalProp } | null = null;

  private session: Session = { kind: 'daily', day: 1 };
  private level: LevelDef = LEVELS[0];
  /** Seconds spent playing the current chamber, across restarts. */
  private runTime = 0;
  private portalsFired = 0;
  /** True once the player has entered the current chamber (so the menu can offer to resume it). */
  private started = false;
  private readonly progress: Progress = loadProgress();
  private state: GameState = 'menu';
  private settingsReturn: { state: GameState; card: CardSpec | null } | null = null;

  private quality: QualityName;
  private rtScale: number;
  private readonly drawSize = new Vector2();

  private time = 0;
  private lastFrame = performance.now();
  private fpsTime = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement, textures: GameTextures) {
    this.stage = createStage(canvas);
    const { scene, camera } = this.stage;
    this.post = new PostFX(this.stage.renderer, scene, camera);

    this.textures = textures;
    this.gun = new Gun(this.textures.gun);
    surfaceUniforms.grimeMap.value = createGrimeTexture();
    const { white, metal, door } = this.textures;
    // Box faces in three.js order: +x, −x, +y (walked on), −y (overhead), +z, −z.
    const faces = (wall: Material, floor: Material, ceiling: Material) => [wall, wall, floor, ceiling, wall, wall];
    const creamWall = surfaceMaterial({ ...white, metalness: 1, roughness: 1 }, { grime: 0.5, tileVariation: 1 });
    const steelWall = surfaceMaterial({ ...metal, metalness: 1, roughness: 1 }, { grime: 0.75, tileVariation: 1 });
    this.materials = {
      white: faces(
        creamWall,
        // Floors are polished by foot traffic, so they mirror the ceiling lights.
        surfaceMaterial({ ...white, metalness: 1, roughness: 0.72 }, { grime: 0.85, tileVariation: 1 }),
        creamWall,
      ),
      metal: faces(
        steelWall,
        surfaceMaterial({ ...metal, metalness: 1, roughness: 0.8 }, { grime: 1, tileVariation: 1 }),
        // Ceilings sit back in shadow so the light strips carry the eye.
        surfaceMaterial({ ...metal, metalness: 1, roughness: 1, color: 0x8f98a6 }, { grime: 0.6, tileVariation: 1 }),
      ),
      door: surfaceMaterial({ ...door, metalness: 1, roughness: 1 }, { grime: 0.35 }),
    };
    this.dressing = new Dressing();
    this.world = new World(this.materials);
    scene.add(this.world.group);

    this.portals = new PortalSystem(scene);
    this.effects = new Effects(scene);
    camera.add(this.gun.group);
    this.cubeMesh = createCubeMesh(this.textures.cube, this.textures.cubeEmissive);

    this.input = new Input(canvas, {
      isPlaying: () => this.state === 'play',
      look: (dx, dy, s) => this.look(dx, dy, s),
      shoot: (i) => this.shoot(i),
      jump: () => { this.jumpBuffer = JUMP_BUFFER; },
      grab: () => this.toggleGrab(),
      restart: () => this.loadLevel(this.level),
      openSettings: () => this.openSettings(),
      openMenu: () => this.openMenu(),
    });

    this.vr = new VRMode(this.stage.renderer, camera, scene, {
      shoot: (i) => this.shoot(i),
      jump: () => { this.jumpBuffer = JUMP_BUFFER; },
      grab: () => this.toggleGrab(),
      restart: () => this.loadLevel(this.level),
      menu: () => this.openMenu(),
      confirm: () => this.confirmCard(),
      sessionStarted: () => this.onVRStart(),
      sessionEnded: () => this.onVREnd(),
    });
    void VRMode.isSupported().then((ok) => {
      this.vrSupported = ok;
      if (ok && this.mainMenu && this.overlay.current === this.mainMenu) this.showMenu();
    });

    this.quality = loadQuality();
    this.rtScale = QUALITY[this.quality].rt;
    window.addEventListener('resize', () => this.onResize());
  }

  start(): void {
    this.applyQuality(this.quality);
    this.enter({ kind: 'daily', day: dayNumber() });
    this.started = false;
    this.showMenu();
    // The renderer's loop keeps running inside a VR session, where window rAF stops.
    this.stage.renderer.setAnimationLoop(this.frame);
  }

  /** Compiles shaders for the current scene so the first frames don't stutter. */
  async warmup(): Promise<void> {
    const { renderer, scene, camera } = this.stage;
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      // not fatal: shaders will compile on first use instead
    }
  }

  // ---------- levels ----------

  /** Starts a fresh run of a daily or training chamber. */
  private enter(session: Session): void {
    this.session = session;
    this.level = session.kind === 'daily' ? dailyChamber(session.day).level : LEVELS[session.index];
    this.runTime = 0;
    this.portalsFired = 0;
    this.started = true;
    this.loadLevel(this.level);
  }

  private sessionLabel(): string {
    const s = this.session;
    return s.kind === 'daily' ? `Daily chamber #${s.day}` : `Training ${s.index + 1} of ${LEVELS.length}`;
  }

  private loadLevel(level: LevelDef): void {
    this.world.clear(new Set([this.cubeMesh]));
    this.effects.clear();
    const setup = level.build(this.world);

    this.portals.reset();
    this.player.pos.set(setup.spawn[0], setup.spawn[1] + this.player.half.y + 0.002, setup.spawn[2]);
    this.player.vel.set(0, 0, 0);
    this.yaw = setup.yaw;
    this.pitch = 0;
    // In VR, turn the rig so the player's head faces the chamber's spawn direction.
    if (this.vr.active) this.vr.rigYaw += setup.yaw - this.vr.headAngles().yaw;
    this.dip.x = this.dip.v = 0;

    this.cube = null;
    this.button = null;
    this.door = null;
    if (setup.cube) {
      const half = CUBE_SIZE / 2;
      this.cube = {
        pos: new Vector3(...setup.cube), vel: new Vector3(), half: new Vector3(half, half, half),
        onGround: false, isPlayer: false, held: false, spawn: new Vector3(...setup.cube),
        collider: { min: new Vector3(), max: new Vector3(), active: true },
      };
      this.world.add(this.cubeMesh);
      this.cubeMesh.position.copy(this.cube.pos);
      this.cubeMesh.rotation.set(0, 0, 0);
    }
    if (setup.button) {
      const prop = new ButtonProp(this.propSteelMaterial, this.textures.button);
      prop.group.position.set(...setup.button);
      this.world.add(prop.group);
      this.button = { pos: new Vector3(...setup.button), prop };
    }
    if (setup.door) {
      this.door = { block: setup.door, t: 0, baseY: setup.door.mesh.position.y };
    }
    const goal = new GoalProp(this.propSteelMaterial, this.textures.goal);
    goal.group.position.set(...setup.goal);
    this.world.add(goal.group);
    this.goal = { pos: new Vector3(...setup.goal), prop: goal };

    const spawn = new Vector3(...setup.spawn);
    // Daily chambers are numbered by day and have no fixed total; training chambers count up to the last one.
    const s = this.session;
    if (s.kind === 'daily') this.dressing.apply(this.world, s.day - 1, 0, level.name, spawn, setup.yaw);
    else this.dressing.apply(this.world, s.index, LEVELS.length, level.name, spawn, setup.yaw);

    this.fitShadowToLevel();
    this.placeGlowLights();
    this.captureProbe(spawn);
    this.hud.showLevel(this.sessionLabel(), level.name, level.hint);
    this.hud.setTime(this.session.kind === 'daily' ? this.runTime : null);
    this.updateCrosshair();
  }

  /** Points the sun's orthographic shadow camera so it just covers the level. */
  private fitShadowToLevel(): void {
    const { sun } = this.stage;
    const bounds = this.world.bounds();
    const center = bounds.getCenter(new Vector3());
    const radius = bounds.getSize(new Vector3()).length() / 2;
    sun.position.copy(center).add(new Vector3(0.24, 1, 0.17).normalize().multiplyScalar(radius + 10));
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 1;
    cam.far = 2 * radius + 25;
    cam.updateProjectionMatrix();
  }

  /** Parks the exit and button lights for this level. */
  private placeGlowLights(): void {
    const { goalLight, buttonLight } = this.stage;
    if (this.goal) goalLight.position.copy(this.goal.pos).setY(this.goal.pos.y + 1.1);
    goalLight.color.setHex(0x6dffc0);
    goalLight.intensity = GOAL_GLOW;
    if (this.button) buttonLight.position.copy(this.button.pos).setY(this.button.pos.y + 0.55);
    buttonLight.intensity = 0;
  }

  /** Re-captures reflections and bounce light for the freshly built level. */
  private captureProbe(spawn: Vector3): void {
    const room = this.world.bounds();
    // Shrink to the inside faces of the outer walls, which are one unit thick.
    for (const k of ['x', 'y', 'z'] as const) {
      if (room.max[k] - room.min[k] > 3) { room.min[k] += 1; room.max[k] -= 1; }
    }
    const position = spawn.clone().setY(spawn.y + 1.7).clamp(room.min, room.max);
    this.stage.scene.updateMatrixWorld(true);
    this.stage.captureProbe(position, room, [this.gun.group, this.cubeMesh, ...this.portals.list.map((p) => p.mesh)]);
  }

  // ---------- player actions ----------

  private eyePosition(): Vector3 {
    return new Vector3(this.player.pos.x, this.player.pos.y + EYE_HEIGHT, this.player.pos.z);
  }

  private forward(): Vector3 {
    const cp = Math.cos(this.pitch);
    return new Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Where shots and grabs point: the view on a screen, the right controller in VR. */
  private aim(): { origin: Vector3; dir: Vector3 } {
    const origin = new Vector3();
    const dir = new Vector3();
    if (this.vr.active) this.vr.aim(origin, dir);
    else {
      origin.copy(this.eyePosition());
      dir.copy(this.forward());
    }
    return { origin, dir };
  }

  private look(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * sensitivity));
  }

  private shoot(index: PortalIndex): void {
    if (this.state !== 'play') return;
    const { origin, dir } = this.aim();
    const hit = this.world.raycast(origin, dir);
    const color = this.portals.list[index].color;
    this.gun.fire(color);
    this.stage.muzzleLight.color.setHex(color);
    this.stage.muzzleLight.intensity = 9;

    const end = origin.clone().addScaledVector(dir, hit ? hit.t : 60);
    this.stage.camera.updateMatrixWorld();
    this.effects.tracer(this.gun.tipWorldPosition(new Vector3()), end, color);
    if (!hit) return;

    if (hit.block.type !== 'white') {
      this.effects.impact(end, hit.normal, 0xb8c4d6, 0.5, 0.5);
      this.effects.sparks(end, hit.normal);
      this.hud.toast('Portals only stick to cream panels');
      return;
    }
    const portal = this.portals.place(index, end, hit.normal, dir, hit.block, this.world.blocks);
    if (portal) {
      this.portalsFired++;
      this.effects.impact(portal.center, portal.normal, color, 1.4);
      this.effects.portalBurst(portal.center, portal.normal, portal.up, portal.right, color);
      this.updateCrosshair();
    } else {
      this.effects.impact(end, hit.normal, 0xb8c4d6, 0.5, 0.5);
      this.effects.sparks(end, hit.normal);
      this.hud.toast('Not enough room for a portal there');
    }
  }

  private toggleGrab(): void {
    const cube = this.cube;
    if (this.state !== 'play' || !cube) return;
    if (cube.held) {
      cube.held = false;
      cube.vel.copy(this.player.vel);
      return;
    }
    const { origin, dir } = this.aim();
    const hit = rayBox(origin, dir, cube.pos.clone().sub(cube.half), cube.pos.clone().add(cube.half));
    if (hit && hit.t < GRAB_RANGE) {
      const wall = this.world.raycast(origin, dir);
      if (!wall || wall.t > hit.t) {
        cube.held = true;
        return;
      }
    }
    this.hud.toast(this.vr.active ? 'Point at the cube to pick it up' : 'Look at the cube to pick it up');
  }

  private updateCrosshair(): void {
    this.hud.setCrosshair(this.portals.list[0].placed, this.portals.list[1].placed);
  }

  // ---------- simulation ----------

  private update(dt: number): void {
    const { player, input } = this;

    // Movement input in camera space: x = strafe right, z = forward.
    let ix = 0;
    let iz = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) iz += 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) iz -= 1;
    if (input.isDown('KeyD')) ix += 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('ArrowLeft')) this.yaw += 2.2 * dt;
    if (input.isDown('ArrowRight')) this.yaw -= 2.2 * dt;
    ix += input.joystick.x;
    iz += input.joystick.y;
    if (this.vr.active) {
      ix += this.vr.move.x;
      iz += this.vr.move.y;
    }
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const wx = -sy * iz + cy * ix;
    const wz = -cy * iz - sy * ix;
    const wl = Math.hypot(wx, wz);

    const v = player.vel;
    if (player.onGround) {
      const k = 1 - Math.exp(-14 * dt);
      v.x += (wx * WALK_SPEED - v.x) * k;
      v.z += (wz * WALK_SPEED - v.z) * k;
    } else if (wl > 0.01) {
      // Air control only adds speed up to walking pace, so flings keep their momentum.
      const dx = wx / wl;
      const dz = wz / wl;
      const current = v.x * dx + v.z * dz;
      const add = WALK_SPEED * Math.min(1, wl) - current;
      if (add > 0) {
        const acc = Math.min(add, 24 * dt);
        v.x += dx * acc;
        v.z += dz * acc;
      }
    }
    this.jumpBuffer -= dt;
    if (this.jumpBuffer > 0 && player.onGround) {
      v.y = JUMP_SPEED;
      player.onGround = false;
      this.jumpBuffer = 0;
    }
    v.y = Math.max(v.y - GRAVITY * dt, -MAX_FALL_SPEED);

    const cube = this.cube;
    const playerColliders = this.playerColliders();
    const wasGrounded = player.onGround;
    const vyBefore = v.y;
    const transfer = physicsStep(player, dt, playerColliders, this.portals);
    if (transfer) this.onPlayerTeleported(transfer);
    if (!wasGrounded && player.onGround && vyBefore < -4) this.dip.v += Math.max(vyBefore, -30) * 0.07;

    if (cube) this.updateCube(cube, dt);
    this.updateButtonAndDoor(dt);

    if (this.goal) {
      const gp = this.goal.pos;
      const feetY = player.pos.y - player.half.y;
      if (Math.hypot(player.pos.x - gp.x, player.pos.z - gp.z) < 0.85 && feetY > gp.y - 0.3 && feetY < gp.y + 1.2) {
        this.completeLevel();
      }
    }
    if (player.pos.y < KILL_Y) this.loadLevel(this.level);
  }

  /** Everything the player can bump into, including the cube when it's not held. */
  private playerColliders(): Collider[] {
    const cols: Collider[] = [...this.world.blocks];
    const cube = this.cube;
    if (cube && !cube.held) {
      cube.collider.min.copy(cube.pos).sub(cube.half);
      cube.collider.max.copy(cube.pos).add(cube.half);
      cols.push(cube.collider);
    }
    return cols;
  }

  /** Keep looking the "same" way relative to the exit portal. */
  private onPlayerTeleported(transfer: Matrix4): void {
    const f = this.forward().transformDirection(transfer);
    if (this.vr.active) {
      // The headset owns pitch; only the rig's turn can change. Face along the
      // exit, or along the flight path when the exit faces straight up or down.
      const yaw = facingYaw(f, this.player.vel);
      if (yaw !== null) {
        this.vr.rigYaw += yaw - this.yaw;
        this.yaw = yaw;
      }
      const cube = this.cube;
      if (cube?.held) {
        cube.pos.copy(this.eyePosition()).addScaledVector(this.forward(), HOLD_DISTANCE);
        cube.vel.set(0, 0, 0);
      }
      return;
    }
    this.pitch = Math.max(-1.5, Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, f.y)))));
    if (Math.abs(f.y) < 0.999) this.yaw = Math.atan2(-f.x, -f.z);
    const cube = this.cube;
    if (cube?.held) {
      cube.pos.copy(this.eyePosition()).addScaledVector(this.forward(), HOLD_DISTANCE);
      cube.vel.set(0, 0, 0);
    }
  }

  private updateCube(cube: Cube, dt: number): void {
    if (cube.held) {
      const { origin, dir } = this.aim();
      const target = origin.addScaledVector(dir, HOLD_DISTANCE);
      const delta = target.sub(cube.pos);
      if (delta.length() > HOLD_BREAK_DISTANCE) {
        cube.held = false;
      } else {
        // Drive the cube toward the hold point through the collision solver so it can't enter walls.
        cube.vel.copy(delta).multiplyScalar(1 / dt);
        if (cube.vel.length() > 30) cube.vel.setLength(30);
        physicsStep(cube, dt, this.world.blocks, null);
        cube.vel.set(0, 0, 0);
      }
    }
    if (!cube.held) {
      cube.vel.y = Math.max(cube.vel.y - GRAVITY * dt, -MAX_FALL_SPEED);
      if (cube.onGround) {
        const k = Math.exp(-8 * dt);
        cube.vel.x *= k;
        cube.vel.z *= k;
      }
      physicsStep(cube, dt, this.world.blocks, this.portals);
      if (cube.pos.y < KILL_Y) {
        cube.pos.copy(cube.spawn);
        cube.vel.set(0, 0, 0);
      }
    }
  }

  private updateButtonAndDoor(dt: number): void {
    const { button, door, player, cube } = this;
    if (button) {
      const bp = button.pos;
      const onButton = (x: number, feetY: number, z: number) =>
        Math.hypot(x - bp.x, z - bp.z) < 0.85 && feetY >= bp.y - 0.2 && feetY < bp.y + 0.4;
      const byCube = !!cube && !cube.held && onButton(cube.pos.x, cube.pos.y - cube.half.y, cube.pos.z);
      const byPlayer = player.onGround && onButton(player.pos.x, player.pos.y - player.half.y, player.pos.z);
      button.prop.pressed = byCube || byPlayer;
    }
    if (door) {
      const target = button?.prop.pressed ? 1 : 0;
      door.t += Math.sign(target - door.t) * Math.min(Math.abs(target - door.t), dt * 2.5);
      door.block.active = door.t < 0.85;
      // Never crush the player: if the door closes on them, hold it open.
      if (door.block.active && overlaps(player, door.block)) {
        door.block.active = false;
        door.t = Math.max(door.t, 0.85);
      }
    }
  }

  // ---------- screens ----------

  /** Starts (or resumes) play with the overlay hidden. */
  private play(session?: Session): void {
    if (session) this.enter(session);
    this.overlay.hide();
    this.resumePlay();
  }

  private openMenu(): void {
    if (this.state === 'menu' || this.state === 'settings') return;
    this.input.release();
    this.showMenu();
  }

  /** The title screen: today's chamber, streak, and links to past chambers and training. */
  private showMenu(): void {
    const today = dayNumber();
    const rec = this.progress[today];
    const cleared = Object.keys(this.progress).length;
    const streak = currentStreak(this.progress, today);
    const s = this.session;
    const onToday = s.kind === 'daily' && s.day === today;
    const midRun = this.started;
    this.state = 'menu';
    const status = rec
      ? `<span class="ok">✓ Cleared in ${formatTime(rec.time)}</span> · ${plural(rec.portals, 'portal')}`
      : 'Not cleared yet';
    const next = rec ? `<div class="tnext">Next chamber in ${formatCountdown(msUntilNextDay())}</div>` : '';
    const stats = cleared > 0
      ? `<p class="streak">${streak > 0 ? `<strong>${streak}-day streak</strong> · ` : ''}${cleared} of ${today} chambers cleared</p>`
      : '';

    const actions = [
      { label: 'Past chambers', onClick: () => this.showArchive() },
      { label: 'Training', onClick: () => this.showTraining() },
    ];
    if (this.vrSupported && !this.vr.active) {
      actions.unshift({ label: 'Play in VR', onClick: () => this.enterVR() });
    }
    if (midRun && !onToday) actions.unshift({ label: 'Today’s chamber', onClick: () => this.play({ kind: 'daily', day: today }) });

    this.mainMenu = {
      html: `<h1><span class="ring"></span><span class="ring o"></span> Loop Lab</h1>
        <p>A new test chamber every day. Fire two linked portals and reach the glowing green exit.</p>
        <div class="today">
          <div class="eyebrow">Today · ${formatDay(today)}</div>
          <div class="tname"><span class="tnum">#${today}</span> ${chamberName(today)}</div>
          <div class="tmeta">${status}</div>${next}
        </div>
        ${stats}
        <details class="howto"${cleared === 0 ? ' open' : ''}><summary>How to play</summary>
          <p><strong>Portals only stick to cream panels.</strong> Blue metal won’t take them. Whatever goes in one comes out the other, keeping its speed.</p>
          ${controlsHtml()}
        </details>`,
      label: midRun ? (onToday ? 'Resume today’s chamber' : `Resume ${this.level.name}`) : rec ? 'Play today’s chamber again' : 'Play today’s chamber',
      onGo: () => (midRun ? this.resumePlay() : this.play({ kind: 'daily', day: today })),
      actions,
    };
    this.overlay.showCard(this.mainMenu);
  }

  // ---------- VR ----------

  private enterVR(): void {
    this.vr.enter().catch((error: unknown) => {
      console.error('Could not start VR', error);
      this.hud.toast('Couldn’t start VR');
    });
  }

  /** A on a VR controller: the card's main button. */
  private confirmCard(): void {
    const card = this.overlay.current;
    if (!card) return;
    this.overlay.hide();
    card.onGo();
  }

  private onVRStart(): void {
    this.gun.mount(this.vr.rightGrip, VR_GUN_REST);
    this.vr.rigYaw = this.yaw;
    this.vr.panelMode('wrist');
    // Jump straight in: whatever the card on screen offered (play or resume).
    if (this.state !== 'play') this.confirmCard();
  }

  private onVREnd(): void {
    const { camera } = this.stage;
    this.gun.mount(camera, Gun.SCREEN_REST);
    this.vr.rigYaw = 0;
    this.vr.rig.position.set(0, 0, 0);
    this.vr.rig.rotation.set(0, 0, 0);
    this.vr.rig.updateMatrixWorld(true);
    this.vr.panel.mesh.removeFromParent();
    this.vr.hideLaser();
    this.onResize();
    if (this.state === 'play') this.openMenu();
    else if (this.overlay.current === this.mainMenu) this.showMenu();
  }

  /** Per-frame VR input: head pose, controller buttons, and room-scale steps. */
  private vrInput(): void {
    const { vr, player } = this;
    vr.updateHead();
    const head = vr.headAngles();
    this.yaw = head.yaw;
    this.pitch = head.pitch;
    const playing = this.state === 'play';
    vr.poll(playing);
    if (!playing) return;

    // Walking around the room moves the body too (through the collision solver, so
    // walls push back), and stepping through an open portal teleports like walking in.
    const feet = new Vector3(player.pos.x, player.pos.y - player.half.y, player.pos.z);
    const step = vr.headStep(feet, this.headStep);
    if (step.lengthSq() < 1e-6) return;
    const vel = player.vel.clone();
    const grounded = player.onGround;
    player.vel.set(step.x, 0, step.z);
    const transfer = physicsStep(player, 1, this.playerColliders(), this.portals);
    player.vel.copy(vel);
    player.onGround = grounded;
    if (transfer) {
      const speed = vel.length();
      if (speed > 1e-6) player.vel.transformDirection(transfer).multiplyScalar(speed);
      this.onPlayerTeleported(transfer);
    }
  }

  /** Places the rig under the head, and updates the aiming laser and the panel. */
  private vrPresent(): void {
    const { vr, player } = this;
    vr.placeRig(new Vector3(player.pos.x, player.pos.y - player.half.y, player.pos.z));
    const card = this.overlay.summary();
    if (this.state === 'play' || !card) {
      const { origin, dir } = this.aim();
      const hit = this.state === 'play' ? this.world.raycast(origin, dir) : null;
      if (this.state === 'play') vr.showLaser(hit ? hit.t : null, origin, dir);
      else vr.hideLaser();
      vr.panelMode('wrist');
      const chip = this.hud.chipText;
      vr.panel.set({
        eyebrow: chip.label, title: chip.name, body: chip.hint,
        toast: this.hud.activeToast ?? undefined, prompt: 'B restart · Y menu',
      });
    } else {
      vr.hideLaser();
      vr.panelMode('card');
      vr.panel.set({ eyebrow: card.eyebrow, title: card.title, body: card.body, prompt: `A  ${card.label}` });
    }
  }

  /** Every daily chamber so far, newest first. */
  private showArchive(): void {
    this.state = 'menu';
    const today = dayNumber();
    const rows: string[] = [];
    for (let d = today; d >= 1; d--) {
      const rec = this.progress[d];
      const when = d === today ? 'Today' : formatDay(d, 'short');
      const stat = rec ? `<span class="ok">✓ ${formatTime(rec.time)}</span>` : '<span class="dim">Play</span>';
      rows.push(`<button class="day${rec ? ' done' : ''}" data-day="${d}">
        <span class="dnum">#${d}</span><span class="dname">${chamberName(d)}<small>${when}</small></span>${stat}</button>`);
    }
    const cleared = Object.keys(this.progress).length;
    this.overlay.showCard({
      html: `<h2>Past chambers</h2>
        <p>Every day has its own chamber. Play any you missed, or beat your best time.</p>
        <p class="streak">${cleared} of ${today} cleared since ${dateForDay(1).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>
        <div class="days">${rows.join('')}</div>`,
      label: 'Back',
      onGo: () => this.showMenu(),
      onMount: (card) => {
        card.querySelector('.days')?.addEventListener('click', (e) => {
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-day]');
          if (b) this.play({ kind: 'daily', day: Number(b.dataset.day) });
        });
      },
    });
  }

  /** The original hand-made chambers, which introduce each mechanic. */
  private showTraining(): void {
    this.state = 'menu';
    const rows = LEVELS.map((l, i) => `<button class="day" data-train="${i}">
      <span class="dnum">${i + 1}</span><span class="dname">${l.name}<small>${TRAINING_BLURBS[i] ?? ''}</small></span></button>`);
    this.overlay.showCard({
      html: `<h2>Training</h2>
        <p>${LEVELS.length} hand-built chambers that introduce the tricks the daily chambers use. A good place to start.</p>
        <div class="days">${rows.join('')}</div>`,
      label: 'Back',
      onGo: () => this.showMenu(),
      onMount: (card) => {
        card.querySelector('.days')?.addEventListener('click', (e) => {
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-train]');
          if (b) this.play({ kind: 'training', index: Number(b.dataset.train) });
        });
      },
    });
  }

  private resumePlay(): void {
    this.state = 'play';
    this.input.tryLock();
    this.input.updateResumeHint();
  }

  private completeLevel(): void {
    this.state = 'done';
    this.started = false;
    this.input.release();
    const s = this.session;
    if (s.kind === 'daily') {
      this.completeDaily(s.day);
      return;
    }
    const index = s.index;
    if (index === LEVELS.length - 1) {
      this.overlay.showCard({
        html: `<h1>Training complete!</h1><p>You’ve cleared all ${LEVELS.length} training chambers. You’re ready for the daily chambers.</p>`,
        label: 'Play today’s chamber',
        onGo: () => this.play({ kind: 'daily', day: dayNumber() }),
        actions: [{ label: 'Main menu', onClick: () => this.showMenu() }],
      });
    } else {
      this.overlay.showCard({
        html: `<h1>${LEVELS[index].name} cleared!</h1><p>Next up is training chamber ${index + 2}: ${LEVELS[index + 1].name}.</p>`,
        label: `Enter training chamber ${index + 2}`,
        onGo: () => this.play({ kind: 'training', index: index + 1 }),
        actions: [{ label: 'Main menu', onClick: () => this.showMenu() }],
      });
    }
  }

  private completeDaily(day: number): void {
    const today = dayNumber();
    const before = this.progress[day];
    const time = this.runTime;
    const portals = this.portalsFired;
    recordClear(this.progress, day, time, portals, day === today);
    const best = before && time < before.time ? '<p class="best">New best time!</p>' : '';
    const streak = currentStreak(this.progress, today);
    const isToday = day === today;
    const share = `Loop Lab #${day} — ${this.level.name}\n⏱ ${formatTime(time)} · ${plural(portals, 'portal')}${isToday && streak > 1 ? ` · ${streak}-day streak` : ''}`;
    const nextUnplayed = this.nextUnplayed(day);

    const actions = [
      {
        label: 'Share result',
        onClick: (b: HTMLButtonElement) => {
          void shareText(share).then((how) => {
            if (how) b.textContent = how === 'copied' ? 'Copied to clipboard!' : 'Shared!';
          });
        },
      },
      { label: 'Main menu', onClick: () => this.showMenu() },
    ];
    this.overlay.showCard({
      html: `<div class="eyebrow">Daily chamber #${day} · ${isToday ? 'Today' : formatDay(day, 'short')}</div>
        <h1>${this.level.name} cleared!</h1>
        ${best}
        <div class="stats">
          <div><b>${formatTime(time)}</b><span>time</span></div>
          <div><b>${portals}</b><span>${portals === 1 ? 'portal' : 'portals'}</span></div>
          <div><b>${streak}</b><span>day streak</span></div>
        </div>
        ${isToday ? `<p>A new chamber unlocks in ${formatCountdown(msUntilNextDay())}.</p>` : ''}`,
      label: nextUnplayed ? `Play #${nextUnplayed}: ${chamberName(nextUnplayed)}` : 'Past chambers',
      onGo: () => (nextUnplayed ? this.play({ kind: 'daily', day: nextUnplayed }) : this.showArchive()),
      actions,
    });
  }

  /** The newest daily chamber not cleared yet (today's first), if any. */
  private nextUnplayed(exclude: number): number | null {
    for (let d = dayNumber(); d >= 1; d--) if (d !== exclude && !this.progress[d]) return d;
    return null;
  }

  private openSettings(): void {
    if (this.state === 'settings') return;
    this.settingsReturn = { state: this.state, card: this.overlay.current };
    const from = this.state;
    this.state = 'settings';
    this.input.release();
    this.overlay.showSettings({
      current: this.quality,
      closeLabel: from === 'play' ? 'Back to the chamber' : 'Done',
      onSelect: (q) => this.applyQuality(q),
      onClose: () => this.closeSettings(),
    });
  }

  private closeSettings(): void {
    const from = this.settingsReturn;
    this.settingsReturn = null;
    if (!from) return;
    if (from.card) {
      this.state = from.state;
      this.overlay.showCard(from.card);
    } else {
      this.overlay.hide();
      if (from.state === 'play') this.resumePlay();
      else this.state = from.state;
    }
  }

  // ---------- graphics ----------

  private applyQuality(name: QualityName): void {
    const q = QUALITY[name];
    this.quality = name;
    const { renderer, scene, sun } = this.stage;
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(name === 'low' ? Math.min(dpr, 1) * q.ratio : Math.min(dpr, q.ratio));
    this.rtScale = q.rt;

    const shadows = q.shadow > 0;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = PCFShadowMap;
    sun.castShadow = shadows;
    if (shadows) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      sun.shadow.radius = q.soft ? 3 : 1;
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    for (const t of this.textures.all) {
      t.anisotropy = Math.min(q.aniso, maxAniso);
      t.needsUpdate = true;
    }
    // Shadow settings are compiled into shaders, so every material must recompile.
    for (const light of [...this.stage.portalLights, this.stage.goalLight, this.stage.buttonLight, this.stage.muzzleLight]) {
      light.visible = q.glowLights;
    }
    const materials = new Set<Material>([
      ...Object.values(this.materials).flat(), ...this.gun.materials, this.cubeMesh.material,
    ]);
    scene.traverse((o) => {
      if (o instanceof Mesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    for (const m of materials) m.needsUpdate = true;

    this.onResize();
    this.post.configure(q);
    saveQuality(name);
  }

  private onResize(): void {
    const { renderer, camera } = this.stage;
    // The headset sets its own size; three.js refuses resizes mid-session.
    if (renderer.xr.isPresenting) return;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(this.drawSize);
    this.portals.resize(this.drawSize, this.rtScale, Math.min(QUALITY[this.quality].msaa, renderer.capabilities.maxSamples));
    this.post.resize();
    this.effects.particles.setViewScale(this.drawSize.y, camera.fov);
  }

  // ---------- frame loop ----------

  private readonly frame = (now: number): void => {
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(rawDt, 0.05);
    this.time += dt;
    this.portals.time.value = this.time;

    this.fpsTime += rawDt;
    this.fpsFrames++;
    if (this.fpsTime >= 0.5) {
      this.overlay.setFps(this.fpsFrames / this.fpsTime);
      this.fpsTime = 0;
      this.fpsFrames = 0;
    }

    if (this.vr.active) this.vrInput();
    if (this.state === 'play') {
      const steps = dt > 0.012 ? Math.ceil(dt / MAX_SUBSTEP) : 1;
      for (let i = 0; i < steps && this.state === 'play'; i++) this.update(dt / steps);
      if (this.state === 'play') {
        this.runTime += rawDt > 0.25 ? 0 : rawDt; // ignore long stalls (tab switches)
        if (this.session.kind === 'daily') this.hud.setTime(this.runTime);
      }
    }

    this.animate(dt);
    this.render();
  };

  /** Purely visual per-frame animation. */
  private animate(dt: number): void {
    this.portals.animate(dt);
    this.effects.ambient(dt, this.portals.list, this.goal?.pos ?? null);
    this.effects.update(dt);
    if (this.cube) {
      this.cubeMesh.position.copy(this.cube.pos);
      if (this.cube.held) this.cubeMesh.rotation.set(0, this.yaw, 0);
      animateCube(this.cubeMesh, this.time, this.cube.held);
    }
    this.button?.prop.animate(dt);
    if (this.door) this.door.block.mesh.position.y = this.door.baseY + this.door.t * DOOR_HEIGHT;
    this.goal?.prop.animate(this.time);
    this.animateGlowLights(dt);

    springStep(this.dip, 0, 140, 11, dt);
    this.dip.x = Math.max(-0.3, this.dip.x);
    const p = this.player;
    // In VR the device is on the hand, which carries its own motion: no walk bob or landing dip.
    if (this.vr.active) this.gun.animate(dt, 0, 0);
    else this.gun.animate(dt, p.onGround ? Math.hypot(p.vel.x, p.vel.z) : 0, this.dip.x);
    this.hud.update(dt);
  }

  private animateGlowLights(dt: number): void {
    const { portalLights, goalLight, buttonLight, muzzleLight } = this.stage;
    this.portals.list.forEach((portal, i) => {
      const light = portalLights[i];
      const target = portal.placed ? PORTAL_GLOW * (0.92 + 0.08 * Math.sin(this.time * 7 + i * 2)) : 0;
      light.intensity += (target - light.intensity) * (1 - Math.exp(-10 * dt));
      if (portal.placed) {
        light.color.setHex(portal.color);
        light.position.copy(portal.center).addScaledVector(portal.normal, 0.7);
      }
    });
    goalLight.intensity = GOAL_GLOW * (0.85 + 0.15 * Math.sin(this.time * 3));
    if (this.button) {
      const pressed = this.button.prop.pressed;
      buttonLight.color.copy(pressed ? BUTTON_GREEN : BUTTON_RED);
      buttonLight.intensity += ((pressed ? 5 : 1.6) - buttonLight.intensity) * (1 - Math.exp(-12 * dt));
    }
    muzzleLight.intensity *= Math.exp(-16 * dt);
  }

  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly portalSphere = new Sphere();
  private readonly clipPlane = new Plane();

  private render(): void {
    const { renderer, scene, camera, portalCamera } = this.stage;
    if (this.vr.active) {
      // First VR pass: no views through portals (they show their dormant vortex)
      // and no post-processing, which doesn't run inside an XR session.
      if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
      this.portals.list[0].setOpen(false);
      this.portals.list[1].setOpen(false);
      this.vrPresent();
      renderer.render(scene, camera);
      return;
    }
    camera.position.set(this.player.pos.x, this.player.pos.y + EYE_HEIGHT + this.dip.x, this.player.pos.z);
    camera.rotation.set(this.pitch, this.yaw, 0);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;

    const open = this.portals.bothOpen;
    const [a, b] = this.portals.list;
    a.setOpen(open);
    b.setOpen(open);

    if (open) {
      // Render what each portal sees from a virtual camera behind its partner.
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
      this.gun.group.visible = false;
      a.mesh.material = a.flatMaterial;
      b.mesh.material = b.flatMaterial;
      portalCamera.projectionMatrix.copy(camera.projectionMatrix);
      portalCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

      for (const [x, y] of [[a, b], [b, a]] as const) {
        this.portalSphere.set(x.center, 1.5);
        if (!this.frustum.intersectsSphere(this.portalSphere)) continue;
        // Skip portals we're looking at from behind.
        if (camera.position.clone().sub(x.center).dot(x.normal) < -0.05) continue;
        const m = this.portals.transferMatrix(x, y).multiply(camera.matrixWorld);
        m.decompose(portalCamera.position, portalCamera.quaternion, portalCamera.scale);
        x.mesh.visible = false;
        // Clip away everything between the virtual camera and the exit wall.
        this.clipPlane.setFromNormalAndCoplanarPoint(y.normal, y.center.clone().addScaledVector(y.normal, 0.004));
        renderer.clippingPlanes = [this.clipPlane];
        renderer.setRenderTarget(x.renderTarget);
        renderer.render(scene, portalCamera);
        x.mesh.visible = true;
      }
      renderer.setRenderTarget(null);
      renderer.clippingPlanes = [];
      a.mesh.material = a.viewMaterial;
      b.mesh.material = b.viewMaterial;
      this.gun.group.visible = true;
    }
    this.post.render(this.time);
  }
}

const TRAINING_BLURBS = [
  'Climb with portals', 'Cubes, buttons and doors', 'Flinging with momentum', 'Crossing a bottomless chasm',
  'Carry a cube through portals', 'Floor portals only', 'Two climbs in a row', 'Everything at once',
];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Shares via the native share sheet where there is one, else copies to the clipboard. */
async function shareText(text: string): Promise<'shared' | 'copied' | null> {
  const url = location.href.split('#')[0];
  try {
    if (isTouch && typeof navigator.share === 'function') {
      await navigator.share({ text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'copied';
  } catch {
    return null; // cancelled, or no clipboard access
  }
}

function controlsHtml(): string {
  if (isTouch) {
    return `<dl class="keys">
      <dt>Left thumb</dt><dd>Drag anywhere on the left to move</dd>
      <dt>Right thumb</dt><dd>Drag on the right to look</dd>
      <dt>Blue / Orange</dt><dd>Fire a portal where the crosshair points</dd>
      <dt>Grab</dt><dd>Pick up or drop a cube</dd>
      <dt>↺ ⌂ ⚙</dt><dd>Restart, main menu, graphics quality</dd></dl>`;
  }
  return `<dl class="keys">
    <dt>W A S D</dt><dd>Move</dd>
    <dt>Mouse</dt><dd>Look (drag if the pointer won’t lock)</dd>
    <dt>Left / right click</dt><dd>Fire blue / orange portal (or Q / F)</dd>
    <dt>Space</dt><dd>Jump</dd>
    <dt>E</dt><dd>Pick up or drop a cube</dd>
    <dt>R</dt><dd>Restart the chamber</dd>
    <dt>⌂ and ⚙</dt><dd>Main menu, change graphics quality</dd></dl>`;
}
