import {
  BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, type PerspectiveCamera, Quaternion,
  type Scene, SphereGeometry, Vector3, type WebGLRenderer, type XRTargetRaySpace, type XRGripSpace,
} from 'three';
import type { PortalIndex } from '../config';
import { PadEdges, type PadState, readPad, SNAP_ANGLE } from './controls';
import { VRPanel } from './panel';

type Hand = 'left' | 'right';

/** What the headset's controllers can ask the game to do. */
export interface VRActions {
  shoot(index: PortalIndex): void;
  jump(): void;
  grab(): void;
  restart(): void;
  menu(): void;
  /** A pressed while a card (menu, chamber cleared) is showing. */
  confirm(): void;
  sessionStarted(): void;
  sessionEnded(): void;
}

interface HandState {
  ray: XRTargetRaySpace;
  grip: XRGripSpace;
  source: XRInputSource | null;
  edges: PadEdges;
  pad: PadState;
}

/** Furthest the body is dragged toward the head in one frame, so a tracking glitch can't fling the player. */
const MAX_HEAD_STEP = 0.5;
const LASER_MAX = 30;

/**
 * Immersive VR mode for WebXR headsets (built for Quest Touch controllers).
 *
 * The camera sits in a `rig` that stands at the player's feet. The headset
 * moves the camera inside the rig; the game moves and turns the rig. Room-scale
 * steps are fed back into the player's body so it stays under the head.
 */
export class VRMode {
  readonly rig = new Group();
  readonly panel = new VRPanel(0.34);
  /** Rig's turn around the vertical axis (snap turns and portal exits). */
  rigYaw = 0;
  /** Left thumbstick: x = strafe right, y = forward. */
  readonly move = { x: 0, y: 0 };

  private readonly hands: Record<Hand, HandState>;
  private readonly laser: Line;
  private readonly dot: Mesh;
  private readonly head = new Vector3();
  private session: XRSession | null = null;
  private handsShown: boolean[] = [];

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly camera: PerspectiveCamera,
    scene: Scene,
    private readonly actions: VRActions,
  ) {
    renderer.xr.enabled = true;
    // Stand on the real floor so the player's own height carries into the game.
    renderer.xr.setReferenceSpaceType('local-floor');
    scene.add(this.rig);
    this.rig.add(camera);

    const make = (i: number): HandState => {
      const state: HandState = {
        ray: renderer.xr.getController(i),
        grip: renderer.xr.getControllerGrip(i),
        source: null,
        edges: new PadEdges(),
        pad: readPad(null),
      };
      this.rig.add(state.ray, state.grip);
      return state;
    };
    const slots = [make(0), make(1)];
    // Controller slots aren't tied to a hand; sort them out as they connect.
    this.hands = { left: slots[0], right: slots[1] };
    for (const slot of slots) {
      slot.ray.addEventListener('connected', (e) => {
        const source = (e as unknown as { data: XRInputSource }).data;
        slot.source = source;
        if (source.handedness === 'left' || source.handedness === 'right') {
          const other: Hand = source.handedness === 'left' ? 'right' : 'left';
          if (this.hands[source.handedness] !== slot) this.hands[other] = this.hands[source.handedness];
          this.hands[source.handedness] = slot;
          this.attachHandProps();
        }
      });
      slot.ray.addEventListener('disconnected', () => { slot.source = null; });
    }

    const laserGeo = new BufferGeometry();
    laserGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    this.laser = new Line(laserGeo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, toneMapped: false }));
    this.laser.frustumCulled = false;
    this.dot = new Mesh(new SphereGeometry(0.02, 12, 8), new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.dot.visible = false;
    scene.add(this.dot);
    this.attachHandProps();

    renderer.xr.addEventListener('sessionstart', () => actions.sessionStarted());
    renderer.xr.addEventListener('sessionend', () => {
      this.session = null;
      actions.sessionEnded();
    });
  }

  /** True when this browser can run an immersive VR session. */
  static async isSupported(): Promise<boolean> {
    try {
      return (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
    } catch {
      return false;
    }
  }

  get active(): boolean {
    return this.renderer.xr.isPresenting;
  }

  /** The right hand's grip, where the portal device is worn. */
  get rightGrip(): Group {
    return this.hands.right.grip;
  }

  /** The left hand's grip, which carries the info panel. */
  get leftGrip(): Group {
    return this.hands.left.grip;
  }

  /** Must be called from a user gesture (a click). */
  async enter(): Promise<void> {
    if (this.session || !navigator.xr) return;
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    this.session = session;
    await this.renderer.xr.setSession(session);
  }

  exit(): void {
    void this.session?.end();
  }

  /**
   * Reads the controllers and fires actions. `playing` is false while a card is showing,
   * when A confirms and the other buttons do nothing.
   */
  poll(playing: boolean): number {
    const { left, right } = this.hands;
    left.pad = readPad(left.source?.gamepad);
    right.pad = readPad(right.source?.gamepad);
    const l = left.edges.pressed(left.pad);
    const r = right.edges.pressed(right.pad);
    const snap = right.edges.snap(right.pad.stickX);

    this.move.x = playing ? left.pad.stickX : 0;
    this.move.y = playing ? left.pad.stickY : 0;
    if (!playing) {
      if (r.has('lower') || l.has('lower')) this.actions.confirm();
      return 0;
    }
    if (r.has('trigger')) this.actions.shoot(0);
    if (l.has('trigger')) this.actions.shoot(1);
    if (r.has('grip') || l.has('grip')) this.actions.grab();
    if (r.has('lower')) this.actions.jump();
    if (r.has('upper')) this.actions.restart();
    if (l.has('upper')) this.actions.menu();
    if (snap) this.rigYaw -= snap * SNAP_ANGLE;
    return snap;
  }

  /** Refreshes the camera from this frame's head pose (before the game reads it). */
  updateHead(): void {
    this.renderer.xr.updateCamera(this.camera);
  }

  /** Head position inside the rig, rotated into world axes (y = height above the feet). */
  headOffset(target: Vector3): Vector3 {
    return target.copy(this.camera.position).applyAxisAngle(UP, this.rigYaw);
  }

  /** Where room-scale walking wants the body to go this frame, as a horizontal world-space step. */
  headStep(feet: Vector3, target: Vector3): Vector3 {
    this.headOffset(this.head);
    target.set(this.rig.position.x + this.head.x - feet.x, 0, this.rig.position.z + this.head.z - feet.z);
    if (target.length() > MAX_HEAD_STEP) target.setLength(MAX_HEAD_STEP);
    return target;
  }

  /** Stands the rig so the head is directly above `feet`. */
  placeRig(feet: Vector3): void {
    this.headOffset(this.head);
    this.rig.position.set(feet.x - this.head.x, feet.y, feet.z - this.head.z);
    this.rig.rotation.set(0, this.rigYaw, 0);
    this.rig.updateMatrixWorld(true);
  }

  /** Head direction in world space: yaw (rig + head) and pitch. */
  headAngles(): { yaw: number; pitch: number } {
    const f = new Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_q));
    return { yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(Math.max(-1, Math.min(1, f.y))) };
  }

  /** The right controller's pointing ray in world space. */
  aim(origin: Vector3, dir: Vector3): void {
    const ray = this.hands.right.ray;
    ray.updateMatrixWorld(true);
    origin.setFromMatrixPosition(ray.matrixWorld);
    dir.set(0, 0, -1).transformDirection(ray.matrixWorld);
  }

  /** Draws the aiming laser to `hitDistance` (null when it hits nothing). */
  showLaser(hitDistance: number | null, origin: Vector3, dir: Vector3): void {
    const len = hitDistance ?? LASER_MAX;
    this.laser.scale.set(1, 1, len);
    this.dot.visible = hitDistance !== null;
    if (hitDistance !== null) this.dot.position.copy(origin).addScaledVector(dir, hitDistance);
  }

  /**
   * Hides or shows everything the player carries (device, laser, wrist panel), so the
   * views through portals can be drawn without them, as on a flat screen.
   */
  showHands(visible: boolean): void {
    const things = [this.hands.left.ray, this.hands.left.grip, this.hands.right.ray, this.hands.right.grip, this.dot];
    // Restore rather than force on: an untracked controller is hidden by three.js itself.
    if (!visible) this.handsShown = things.map((o) => o.visible);
    things.forEach((o, i) => { o.visible = visible && (this.handsShown[i] ?? true); });
  }

  hideLaser(): void {
    this.laser.scale.set(1, 1, 0.001);
    this.dot.visible = false;
  }

  /** Floats the panel in front of the face (for cards) or back on the left wrist (for play). */
  panelMode(mode: 'wrist' | 'card'): void {
    const mesh = this.panel.mesh;
    if (mode === 'card') {
      if (mesh.parent === this.rig) return;
      this.rig.add(mesh);
      // In front of where the player is looking now, at eye height; stays put while they read.
      const f = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0);
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      mesh.position.copy(this.camera.position).addScaledVector(f, 1.1);
      mesh.position.y = this.camera.position.y - 0.05;
      mesh.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
      mesh.scale.setScalar(2.2);
    } else {
      const wrist = this.hands.left.grip;
      if (mesh.parent === wrist) return;
      wrist.add(mesh);
      // Hovering over the back of the left wrist, tilted toward the face.
      mesh.position.set(0, 0.07, 0.1);
      mesh.rotation.set(-0.9, 0, 0);
      mesh.scale.setScalar(1);
    }
  }

  private attachHandProps(): void {
    this.hands.right.ray.add(this.laser);
    if (this.panel.mesh.parent && this.panel.mesh.parent !== this.rig) this.hands.left.grip.add(this.panel.mesh);
  }
}

const UP = new Vector3(0, 1, 0);
const _q = new Quaternion();
