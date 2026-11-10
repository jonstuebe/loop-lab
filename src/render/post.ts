import { HalfFloatType, type PerspectiveCamera, type Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export interface PostSettings {
  /** MSAA sample count for the scene render; 0 disables it. */
  msaa: number;
  /** Ground-truth ambient occlusion. */
  ao: boolean;
  /** Glow around bright emissive things (portals, beacon, buttons). */
  bloom: boolean;
  /** Lens and film finish: sharpening, colour grade, vignette, fringing, grain. */
  film: boolean;
}

/**
 * The last pass, working on the tone-mapped image: a light unsharp mask, a
 * filmic grade (deeper contrast, cool shadows, warm highlights), then lens
 * artefacts. Kept subtle; it should read as "photographed", not "filtered".
 */
const FILM_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    texel: { value: new Vector2(1, 1) },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float time;
    varying vec2 vUv;

    float grainHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // chromatic fringing, growing toward the corners
      vec2 fringe = c * r2 * 0.0035;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv - fringe).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv + fringe).b);

      // unsharp mask
      vec3 around = (texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb) * 0.25;
      col += clamp(col - around, -0.08, 0.08) * 0.55;

      // grade
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, 1.07);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col += vec3(-0.010, 0.002, 0.018) * (1.0 - smoothstep(0.0, 0.5, luma));
      col *= mix(vec3(1.0), vec3(1.035, 1.0, 0.955), smoothstep(0.45, 1.0, luma));

      // vignette
      col *= 1.0 - 0.34 * smoothstep(0.12, 0.62, r2);

      // grain, strongest in the shadows; doubles as dither against banding
      float n = grainHash(gl_FragCoord.xy + fract(time) * 517.0) - 0.5;
      col += n * 0.035 * (1.0 - luma * 0.65);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

/**
 * The frame pipeline: scene → (AO) → (bloom) → tone mapping + sRGB → (film finish).
 * Everything before the output pass stays linear HDR, which is also what
 * the portal render targets hold, so portal views match the main view.
 */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly film: ShaderPass;
  private readonly size = new Vector2();

  constructor(private readonly renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    renderer.getDrawingBufferSize(this.size);
    const target = new WebGLRenderTarget(this.size.x, this.size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);

    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new GTAOPass(scene, camera, this.size.x, this.size.y);
    this.ao.updateGtaoMaterial({ radius: 0.75, distanceExponent: 1.5, thickness: 1.2, scale: 1.15, samples: 16 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 1;
    this.composer.addPass(this.ao);

    // Threshold sits above lit-panel brightness so only emissives bloom.
    this.bloom = new UnrealBloomPass(new Vector2(this.size.x, this.size.y), 0.55, 0.6, 2.2);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.film = new ShaderPass(new ShaderMaterial(FILM_SHADER));
    this.composer.addPass(this.film);
  }

  configure(settings: PostSettings): void {
    const max = this.renderer.capabilities.maxSamples;
    const samples = Math.min(settings.msaa, max);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples === samples) continue;
      rt.samples = samples;
      rt.dispose(); // sample count is baked into the GPU buffers; force a rebuild
    }
    this.ao.enabled = settings.ao;
    this.bloom.enabled = settings.bloom;
    this.film.enabled = settings.film;
    this.resize();
  }

  /** Call after the renderer's size or pixel ratio changes. */
  resize(): void {
    const ratio = this.renderer.getPixelRatio();
    this.renderer.getSize(this.size);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.size.x, this.size.y);
    (this.film.uniforms.texel.value as Vector2).set(1 / (this.size.x * ratio), 1 / (this.size.y * ratio));
  }

  render(time: number): void {
    this.film.uniforms.time.value = time;
    this.composer.render();
  }
}
