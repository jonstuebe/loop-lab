import { MeshStandardMaterial, type MeshStandardMaterialParameters, ShaderChunk, type Texture, Vector3 } from 'three';

/**
 * Uniforms shared by every surface material. The reflection probe is captured
 * once per level; `probeMin/Max` describe the room it was captured in so
 * reflections can be re-projected onto its walls instead of sitting at infinity.
 */
export const surfaceUniforms = {
  grimeMap: { value: null as Texture | null },
  probeMin: { value: new Vector3(-1, -1, -1) },
  probeMax: { value: new Vector3(1, 1, 1) },
  probePos: { value: new Vector3() },
  /** 1 while a level probe is active, 0 for the plain studio environment. */
  probeOn: { value: 0 },
};

export interface SurfaceOptions {
  /** Strength of the world-space dirt and blotches, 0..1. */
  grime?: number;
  /** Brightness and gloss difference from one panel to the next, 0..1. */
  tileVariation?: number;
}

const HEADER = /* glsl */ `
uniform sampler2D grimeMap;
uniform vec3 probeMin;
uniform vec3 probeMax;
uniform vec3 probePos;
uniform float probeOn;
uniform float grimeAmount;
uniform float tileVariation;
varying vec3 vWPos;
varying vec3 vWNrm;

float surfHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.y);
}

// Bends a reflection ray so it hits the walls of the probe's room.
vec3 boxProject(vec3 dir, vec3 pos) {
  vec3 d = mix(dir, vec3(1e-4), vec3(lessThan(abs(dir), vec3(1e-4))));
  vec3 far = mix((probeMin - pos) / d, (probeMax - pos) / d, step(0.0, d));
  float t = max(min(min(far.x, far.y), far.z), 0.05);
  return normalize(mix(dir, pos + d * t - probePos, probeOn));
}
`;

const PROJECT_LINE = 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );';

/**
 * A standard PBR material with three additions that break up the "tiled
 * texture" look: per-panel tone variation, world-space grime that never
 * repeats in step with the panels, and box-projected room reflections.
 */
export function surfaceMaterial(params: MeshStandardMaterialParameters, options: SurfaceOptions = {}): MeshStandardMaterial {
  const material = new MeshStandardMaterial(params);
  const own = {
    grimeAmount: { value: options.grime ?? 0 },
    tileVariation: { value: options.tileVariation ?? 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surfaceUniforms, own);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace(
        '#include <envmap_physical_pars_fragment>',
        ShaderChunk.envmap_physical_pars_fragment.replaceAll(PROJECT_LINE, `${PROJECT_LINE}\n reflectVec = boxProject(reflectVec, vWPos);`),
      )
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 surfN = abs(vWNrm);
        vec2 surfUv = surfN.y > 0.5 ? vWPos.xz : (surfN.x > 0.5 ? vWPos.zy : vWPos.xy);
        vec3 grimeA = texture2D(grimeMap, surfUv * 0.131).rgb;
        vec3 grimeB = texture2D(grimeMap, surfUv * 0.037 + 0.37).rgb;
        #ifdef USE_MAP
          float tileRnd = surfHash(floor(vMapUv) + 17.0);
        #else
          float tileRnd = 0.5;
        #endif
        diffuseColor.rgb *= 1.0 + (tileRnd - 0.5) * 0.16 * tileVariation;
        // large soft blotches, then darker dirt where the two scales overlap
        diffuseColor.rgb *= mix(1.0, 0.74 + 0.48 * mix(grimeA.r, grimeB.r, 0.6), grimeAmount);
        float surfDirt = smoothstep(0.5, 0.95, grimeB.g * 0.75 + grimeA.b * 0.55) * grimeAmount;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.46, 0.42), surfDirt * 0.75);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor += (tileRnd - 0.5) * 0.14 * tileVariation;
        roughnessFactor += ((grimeA.g - 0.5) * 0.3 + (grimeB.b - 0.5) * 0.2 + surfDirt * 0.3) * grimeAmount;
        roughnessFactor = clamp(roughnessFactor, 0.05, 1.0);`);
  };
  material.customProgramCacheKey = () => 'loop-lab-surface';
  return material;
}
