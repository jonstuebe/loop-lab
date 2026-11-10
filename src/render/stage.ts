import {
  BackSide, type Box3, BoxGeometry, Color, DirectionalLight, Float32BufferAttribute, FogExp2,
  HemisphereLight, Mesh, NeutralToneMapping, MeshBasicMaterial, type Object3D, PerspectiveCamera, PMREMGenerator, PointLight, Scene,
  SphereGeometry, SRGBColorSpace, type Texture, type Vector3, type WebGLCubeRenderTarget, WebGLRenderer,
} from 'three';
import { surfaceUniforms } from './materials';

/** Cool, dim haze: distance fades into it and bottomless pits fall away into it. */
const HAZE = 0x1b2430;
const FOV = 72;
const NEAR = 0.02;
const FAR = 160;

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  /** The player's camera. */
  camera: PerspectiveCamera;
  /** Virtual camera used to render the view through each portal. */
  portalCamera: PerspectiveCamera;
  /** The shadow-casting key light. */
  sun: DirectionalLight;
  /** Coloured glow cast by each open portal onto the room around it. */
  portalLights: [PointLight, PointLight];
  /** Glow of the exit pad. */
  goalLight: PointLight;
  /** Glow of the pressure button. */
  buttonLight: PointLight;
  /** Brief flash at the gun's muzzle; parented to the camera. */
  muzzleLight: PointLight;
  /**
   * Captures the level's own reflections and bounce light from `position`,
   * replacing the generic studio environment. `hidden` objects are left out.
   */
  captureProbe(position: Vector3, room: Box3, hidden: readonly Object3D[]): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  // MSAA happens in the post-processing render targets, so the default
  // framebuffer doesn't need its own.
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  // Khronos PBR Neutral keeps the toy-like palette saturated while rolling
  // highlights off, so sunlit cream panels no longer clip to flat white.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.autoUpdate = false;

  const scene = new Scene();
  scene.background = new Color(HAZE);
  scene.fog = new FogExp2(HAZE, 0.011);

  const aspect = window.innerWidth / window.innerHeight;
  const camera = new PerspectiveCamera(FOV, aspect, NEAR, FAR);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const portalCamera = new PerspectiveCamera(FOV, aspect, NEAR, FAR);

  const studio = createStudioEnvironment(renderer);
  scene.environment = studio;
  scene.environmentIntensity = STUDIO_INTENSITY;

  // A little sky/ground fill; most ambient light comes from the level probe.
  scene.add(new HemisphereLight(0xe6edff, 0xd8c3a8, 0.5));

  // Key light: steep and warm-white, as if from the ceiling strips.
  const sun = new DirectionalLight(0xfff0dc, 2.5);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const point = (range: number) => {
    const light = new PointLight(0xffffff, 0, range, 1.6);
    scene.add(light);
    return light;
  };
  const portalLights: [PointLight, PointLight] = [point(9), point(9)];
  const goalLight = point(5.5);
  const buttonLight = point(5);
  const muzzleLight = new PointLight(0xffffff, 0, 7, 1.8);
  muzzleLight.position.set(0.2, -0.15, -0.9);
  camera.add(muzzleLight);

  const pmrem = new PMREMGenerator(renderer);
  let probe: WebGLCubeRenderTarget | null = null;
  const captureProbe = (position: Vector3, room: Box3, hidden: readonly Object3D[]) => {
    const wasVisible = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    surfaceUniforms.probeOn.value = 0;
    scene.environment = studio;
    scene.environmentIntensity = STUDIO_INTENSITY;
    let previous = probe;
    // Two passes: the second sees surfaces already lit by the first, i.e. one extra bounce.
    for (let pass = 0; pass < 2; pass++) {
      if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
      const target = pmrem.fromScene(scene, 0, 0.1, FAR, { size: 256, position });
      previous?.dispose();
      previous = target;
      scene.environment = target.texture;
      scene.environmentIntensity = PROBE_INTENSITY;
    }
    probe = previous;
    surfaceUniforms.probeMin.value.copy(room.min);
    surfaceUniforms.probeMax.value.copy(room.max);
    surfaceUniforms.probePos.value.copy(position);
    surfaceUniforms.probeOn.value = 1;
    hidden.forEach((o, i) => { o.visible = wasVisible[i]; });
  };

  return { renderer, scene, camera, portalCamera, sun, portalLights, goalLight, buttonLight, muzzleLight, captureProbe };
}

/** Strength of the generic studio environment, used until a level probe exists. */
const STUDIO_INTENSITY = 0.55;
/** Strength of the captured level probe as ambient light and reflections. */
const PROBE_INTENSITY = 1.25;

/**
 * A warm "studio" environment: a sky-to-floor gradient plus a few bright
 * softboxes, so glossy surfaces pick up crisp highlights instead of a flat sheen.
 */
function createStudioEnvironment(renderer: WebGLRenderer): Texture {
  const envScene = new Scene();
  const geo = new SphereGeometry(10, 48, 24);
  const pos = geo.attributes.position;
  const top = new Color(0xcfe4ff);
  const mid = new Color(0xfff0dc);
  const bottom = new Color(0xd9a77c);
  const tmp = new Color();
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) tmp.copy(mid).lerp(top, Math.pow(y, 0.7));
    else tmp.copy(mid).lerp(bottom, Math.pow(-y, 0.8));
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  envScene.add(new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));

  const boxGeo = new BoxGeometry(1, 1, 1);
  /** A thin glowing panel at (x,y,z), w × h, facing the origin. */
  const softbox = (color: number, strength: number, x: number, y: number, z: number, w: number, h: number) => {
    const mat = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(strength) });
    const m = new Mesh(boxGeo, mat);
    m.position.set(x, y, z);
    m.scale.set(w, h, 0.1);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  softbox(0xfff2e0, 5, 0.5, 8.5, 0.5, 6, 6); // overhead key
  softbox(0xffe1bf, 3, 8, 3, 4, 5, 3); // warm side
  softbox(0xbcd8ff, 2.2, -8, 2, -5, 4, 2.5); // cool side

  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(envScene, 0.035).texture;
  pmrem.dispose();
  envScene.traverse((o) => {
    if (o instanceof Mesh) (o.material as MeshBasicMaterial).dispose();
  });
  geo.dispose();
  boxGeo.dispose();
  return texture;
}
