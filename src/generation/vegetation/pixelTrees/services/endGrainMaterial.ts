// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { pixelTextureLightDir, resolvePixelTextureParams } from './pixelArtTextureSystem';

/**
 * Pixel-art end grain: the wood seen where a trunk is cut or snapped (the
 * felled tree's stump and trunk, the logs' ends, the stump's top).
 *
 * It used to be a small ring picture stretched over each face whatever its
 * size, so a big stump got a few huge blotches and a twig a crowd of tiny
 * ones. This draws the rings in the shader instead, on a texel grid sized in
 * metres like the bark's, so every cut shows texels of one size:
 *
 *  - growth rings as one-texel lines, a little wavy and off centre, with
 *    early and late wood alternating in two tones
 *  - a pale heart and a dark pith
 *  - two or three drying cracks running out from the middle
 *  - the bark round the rim with a dark outline
 *  - light in whole steps, so the shaded walls of the splinters fall darker
 *
 * The geometry supplies the face's polar coordinates in its uv (0.5, 0.5 at
 * the pith, the rim on the unit circle) and its radius in metres (aGrainR).
 */

type RGB = [number, number, number];

function grainPalette(barkColor: string): THREE.DataTexture {
  const bark = new THREE.Color(barkColor);
  const wood = bark.clone().lerp(new THREE.Color('#e3c38e'), 0.72);
  const steps: THREE.Color[] = [
    bark.clone().multiplyScalar(0.42),                       // 0 outline / pith / cracks
    bark.clone().multiplyScalar(0.8),                        // 1 bark
    wood.clone().lerp(bark, 0.55),                           // 2 ring line
    wood.clone().multiplyScalar(0.86),                       // 3 late wood / shade
    wood.clone(),                                            // 4 wood
    wood.clone().lerp(new THREE.Color('#f7ead0'), 0.45),     // 5 pale heart
  ];
  const n = steps.length;
  const data = new Uint8Array(n * 4);
  steps.forEach((c, i) => {
    const rgb: RGB = [c.r, c.g, c.b].map((v) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255)) as RGB;
    data.set([...rgb, 255], i * 4);
  });
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const VERTEX = /* glsl */ `
  attribute float aGrainR;
  varying vec2 vUv;
  varying float vGrainR;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vGrainR = aGrainR;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uTexelsPerMetre;
  uniform float uRingsPerMetre;
  uniform float uSeed;
  uniform float uCompactCuts;
  uniform vec3 uTexLightDir;
  varying vec2 vUv;
  varying float vGrainR;
  varying vec3 vNormal;

  float h1(float n) { return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }

  void main() {
    const float GRAIN_PI = 3.14159265;
    float R = max(vGrainR, 0.03);
    float texel = 1.0 / uTexelsPerMetre;                   // metres per texel
    // a whole number of texels across the face, so the grid sits on the pith
    float across = max(6.0, floor(2.0 * R * uTexelsPerMetre + 0.5));
    vec2 cell = floor(vUv * across);
    vec2 c = (cell + 0.5) / across * 2.0 - 1.0;            // texel centre, -1..1
    float rho = length(c);
    float ang = atan(c.y, c.x);
    float rw = rho * R;                                     // metres from the pith

    // growth rings: wavy and a little off centre, as real ones are
    float wob = 0.5 * sin(ang * 3.0 + uSeed) + 0.3 * sin(ang * 5.0 - uSeed * 1.7);
    float t = rw * uRingsPerMetre + wob * 0.22 + c.x * R * uRingsPerMetre * 0.06;
    float lineW = uRingsPerMetre * texel;                   // one texel, in rings

    float idx = rho < 0.45 ? 5.0 : 4.0;                     // pale heart, then wood
    if (mod(floor(t), 2.0) > 0.5) idx -= 1.0;               // early / late wood bands
    if (fract(t) < lineW) idx = 2.0;                        // the ring itself
    if (rw < texel * 1.1) idx = 0.0;                        // pith

    // drying cracks out from the middle
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      if (fk > 1.0 && h1(uSeed + 5.0) < 0.5) break;
      float ca = h1(uSeed + fk * 3.7) * 2.0 * GRAIN_PI;
      float len = 0.35 + 0.45 * h1(uSeed + fk * 9.1);
      float d = abs(mod(ang - ca + GRAIN_PI, 2.0 * GRAIN_PI) - GRAIN_PI) * rw;   // metres off the crack line
      if (d < texel * 0.55 && rho < len && rw > texel * 1.5) idx = 0.0;
    }

    // Small firewood needs a readable centre within its limited texel budget.
    bool compact = uCompactCuts > 0.5 && R < 0.15;
    if (compact) {
      idx = rho < 0.40 ? 5.0 : 4.0;
      if (abs(rho - 0.56 + wob * 0.04) < 0.65 / across) idx = 3.0;
      if (c.x > 0.0 && abs(c.y) < 0.35 / across && rho > 0.15 && rho < 0.65) idx = 2.0;
    }

    // the bark round the rim, with a dark outline
    float fromRim = (1.0 - rho) * R / texel;                // in texels
    float rimWidth = compact ? 0.65 : 2.0;
    if (fromRim < rimWidth * 0.5) idx = 0.0;
    else if (fromRim < rimWidth) idx = 1.0;

    // light in whole steps: the splinters' shaded walls fall darker
    float ndl = dot(normalize(vNormal), normalize(uTexLightDir));
    if (idx > 0.5) {
      if (compact) {
        if (idx > 3.5 && ndl < 0.35) idx -= 1.0;
      } else {
        if (ndl < -0.05) idx -= 2.0;
        else if (ndl < 0.35) idx -= 1.0;
      }
    }
    idx = clamp(idx, 0.0, 5.0);
    gl_FragColor = vec4(texture2D(uPalette, vec2((idx + 0.5) / 6.0, 0.5)).rgb, 1.0);
  }
`;

export interface EndGrainMaterial {
  material: THREE.ShaderMaterial;
  palette: THREE.Texture;
}

export function createPixelEndGrainMaterial(config: TreeConfig): EndGrainMaterial {
  const params = resolvePixelTextureParams(config);
  const palette = grainPalette(config.barkColor);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPalette: { value: palette },
      // finer than the bark, so rings a few texels apart still read
      uTexelsPerMetre: { value: params.barkTexelsPerMetre * 2.2 },
      uRingsPerMetre: { value: 7 },
      uSeed: { value: (config.seed % 991) * 0.61 },
      uCompactCuts: { value: 0 },
      uTexLightDir: { value: pixelTextureLightDir(params) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  return { material, palette };
}
