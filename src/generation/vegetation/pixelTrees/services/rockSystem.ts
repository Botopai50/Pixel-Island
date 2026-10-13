// @ts-nocheck
import {rockSnowColors,ROCK_SNOW_PAINT_GLSL,ROCK_SNOW_COVERAGE_GLSL,ROCK_SNOW_RIM_GLSL} from './rockSnowStyle';
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { buildPixelMossRamp, pixelTextureLightDir, resolvePixelTextureParams } from './pixelArtTextureSystem';
import { pixelMossNoiseGLSL } from './mossStyle';

/**
 * Pixel-art rocks for the ground around a tree.
 *
 * A rock is a faceted boulder (a jittered icosahedron with flat faces) drawn
 * with a shader in the same language as the pixel bark: texels laid out in
 * world metres at the bark's density, light in whole palette steps from the
 * trees' baked light direction, a few lighter and darker texels, thin dark
 * cracks, a dark contour where the stone turns away, and cushions of lichen
 * (or moss) on the faces turned to the sky. Its ramp is cool in the shadows
 * and warm in the light, as painted stone is, rather than a flat grey.
 *
 * Whether a tree has rocks at all, how many and how big is decided by its
 * seed. They are ground: felling the tree never cuts them.
 */

type RGB = [number, number, number];

function stoneRamp(baseHex: string, steps: number, displayColors = false): RGB[] {
  // Mixed in colour, not swept round the hue wheel: shadows fall to a cool
  // blue-grey, lights rise to a warm pale stone, the middle is the stone's
  // own colour. (Sweeping the hue from blue to warm passed through green or
  // violet, and the rocks came out tinted.)
  const base = new THREE.Color(baseHex);
  const shadow = new THREE.Color('#262a36');
  const light = new THREE.Color('#efe4c9');
  // Independent assets use authored display colours, like the tree palettes.
  // The shader writes raw palette values, so linear RGB here would crush the shadows.
  if (displayColors) { base.convertLinearToSRGB(); shadow.convertLinearToSRGB(); light.convertLinearToSRGB(); }
  const out: RGB[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = t < 0.5
      ? shadow.clone().lerp(base, t / 0.5)
      : base.clone().lerp(light, (t - 0.5) / 0.5 * 0.85);
    out.push([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]);
  }
  return out;
}

function mossRamp(hex: string, steps: number, displayColors = false): RGB[] {
  if (displayColors) return buildPixelMossRamp(steps, hex);
  const base = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const out: RGB[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = new THREE.Color().setHSL(hsl.h + (t - 0.5) * 0.05, hsl.s * (0.8 + t * 0.2), THREE.MathUtils.lerp(0.14, 0.62, t));
    out.push([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]);
  }
  return out;
}

function paletteTexture(main: RGB[], accent: RGB[]): THREE.DataTexture {
  const n = main.length;
  const data = new Uint8Array(n * 2 * 4);
  // row 0 (v = 0.25) accent, row 1 (v = 0.75) main
  for (let i = 0; i < n; i++) {
    data.set([...accent[i], 255], i * 4);
    data.set([...main[i], 255], (n + i) * 4);
  }
  const tex = new THREE.DataTexture(data, n, 2, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  // (raw values, like the other pixel palettes: the shader writes them out as
  // they are, so tagging them sRGB would darken every step)
  tex.needsUpdate = true;
  return tex;
}

const STONE_VERTEX = /* glsl */ `
  // distance (m) to each of the triangle's three edges, and which of them are
  // on the side toward the light (1) or away from it (0)
  attribute vec3 aEdge;
  attribute vec3 aEdgeFlag;
  attribute vec3 aMossNormal;
  varying vec3 vMossNormal;
  varying vec3 vEdge;
  varying vec3 vEdgeFlag;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vMossNormal = mat3(modelMatrix) * aMossNormal;
    vEdge = aEdge;
    vEdgeFlag = aEdgeFlag;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const STONE_FRAGMENT = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uSteps;
  uniform vec3 uTexLightDir;
  uniform float uTexelsPerMetre;
  uniform float uMoss;
  uniform float uSeed;
  uniform float uSnow;
  uniform float uSnowRim;
  uniform vec3 uSnowColors[4];
  uniform float uCracks;
  uniform float uNaturalStone;
  uniform float uMossSeed;
  varying vec3 vMossNormal;
  varying vec3 vEdge;
  varying vec3 vEdgeFlag;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  float h3(vec3 c) { return fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  ${pixelMossNoiseGLSL('uMossSeed')}

  ${ROCK_SNOW_PAINT_GLSL}
  ${ROCK_SNOW_COVERAGE_GLSL}
  ${ROCK_SNOW_RIM_GLSL}

  void main() {
    float N1 = uSteps - 1.0;
    vec3 n = normalize(vNormal);
    // texels on the plane the face mostly lies in, in world metres
    vec3 an = abs(n);
    float axis = an.x > an.y && an.x > an.z ? 1.0 : (an.y > an.z ? 2.0 : 3.0);
    vec2 uv = axis < 1.5 ? vWorldPos.zy : (axis < 2.5 ? vWorldPos.xz : vWorldPos.xy);
    vec2 cell = floor(uv * uTexelsPerMetre);
    vec3 cellId = vec3(cell, axis * 17.0 + uSeed);
    // the texel's centre, for noise that steps in whole texels
    vec2 cc = (cell + 0.5) / uTexelsPerMetre;

    float ndl = dot(n, normalize(uTexLightDir));
    float idx = floor(N1 * 0.42 + ndl * N1 * 0.48 + 0.5);

    // each facet one flat tone, with only a rare lighter or darker texel
    float g = h3(cellId);
    if (g > 0.96) idx += 1.0;
    else if (g < 0.03) idx -= 1.0;

    // Facet tones follow the world-space sun, independent of the camera.

    idx = clamp(idx, 0.0, N1);
    float row = 0.75;

    // lichen / moss in cushions on the faces turned to the sky
    float m = vnoise(vec3(cc * 3.2, 11.0 + uSeed)) * 0.8 + h3(cellId + 3.0) * 0.2;
    if (uNaturalStone < 0.5 && n.y > 0.3 && m < uMoss * (0.25 + n.y * 0.7)) {
      row = 0.25;
      float mi = N1 * 0.45 + ndl * N1 * 0.4 + (h3(cellId + 9.0) - 0.5) * 1.4;
      if (m > uMoss * (0.25 + n.y * 0.7) - 0.04) mi -= 1.0;   // a darker rim to each cushion
      idx = clamp(floor(mi + 0.5), 0.0, N1);
    }
    vec3 surfaceP = vec3(cc, 0.0) * uTexelsPerMetre;
    vec3 surfaceN = n;
    vec3 surfaceDown = vec3(0.0, -1.0, 0.0);
    vec3 surfaceDownN = vec3(0.0);
    vec3 surfaceAcross = vec3(1.0, 0.0, 0.0);
    vec3 surfaceAcrossN = vec3(0.0);
    if (uNaturalStone > 0.5) {
      // A continuous spatial field, sampled at each surface texel's centre.
      // Coverage uses welded smooth normals, not the stone's flat face normal:
      // a patch can cross a triangle edge instead of being cut off diagonally.
      vec3 mossWorld = vWorldPos;
      vec3 mossNormal = vMossNormal;
      vec2 du = dFdx(uv);
      vec2 dv = dFdy(uv);
      float mossDet = du.x * dv.y - du.y * dv.x;
      if (abs(mossDet) > 1e-8) {
        vec2 delta = cc - uv;
        vec2 screenOffset = vec2(dv.y * delta.x - dv.x * delta.y,
          -du.y * delta.x + du.x * delta.y) / mossDet;
        mossWorld += dFdx(vWorldPos) * screenOffset.x + dFdy(vWorldPos) * screenOffset.y;
        mossNormal += dFdx(vMossNormal) * screenOffset.x + dFdy(vMossNormal) * screenOffset.y;
        // Move by one actual surface texel, including the change in slope.
        // Keeping the current normal for the neighbour missed snow edges
        // formed by accumulation thinning out down the side of the rock.
        vec2 downUV = axis > 1.5 && axis < 2.5
          ? -normalize(uTexLightDir.xz) : vec2(0.0, -1.0);
        vec2 downScreen = vec2(dv.y * downUV.x - dv.x * downUV.y,
          -du.y * downUV.x + du.x * downUV.y) / mossDet;
        surfaceDown = dFdx(vWorldPos) * downScreen.x + dFdy(vWorldPos) * downScreen.y;
        surfaceDownN = (dFdx(vMossNormal) * downScreen.x + dFdy(vMossNormal) * downScreen.y) / uTexelsPerMetre;
        vec2 acrossUV = vec2(-downUV.y, downUV.x);
        vec2 acrossScreen = vec2(dv.y * acrossUV.x - dv.x * acrossUV.y,
          -du.y * acrossUV.x + du.x * acrossUV.y) / mossDet;
        surfaceAcross = dFdx(vWorldPos) * acrossScreen.x + dFdy(vWorldPos) * acrossScreen.y;
        surfaceAcrossN = (dFdx(vMossNormal) * acrossScreen.x + dFdy(vMossNormal) * acrossScreen.y) / uTexelsPerMetre;
      }
      vec3 mossP = mossWorld * uTexelsPerMetre;
      vec3 mossUp = vec3(0.0, 1.0, 0.0);
      vec3 mossN = normalize(mossNormal);
      surfaceP = mossP;
      surfaceN = mossN;
      float mossNdl = dot(mossN, normalize(uTexLightDir));
      float damp = clamp(dot(mossN, vec3(0.0, 0.25, -0.95)), 0.0, 1.0);
      float up = clamp(mossN.y, 0.0, 1.0);
      float crackField = abs(mnoise3(mossP / 8.0 + 57.0) - 0.5);
      float groove = (1.0 - smoothstep(0.015, 0.12, crackField)) * uCracks;
      float mossGroove = 0.35 + groove * 0.65;
      float mossWant = min(0.5, (0.1 + damp * 0.45 + up * 0.3) * uMoss * 1.6 + groove * 0.15 * uMoss)
        * (0.55 + mossGroove * 0.9);
      if (mossWant > 0.04 && mossField(mossP) < mossWant) {
        row = 0.25;
        float qs = N1 / 5.0;
        bool topEdge = mossField(mossP + mossUp) >= mossWant;
        bool bottomEdge = mossField(mossP - mossUp) >= mossWant;
        float mi = N1 * 0.35 + (mossNdl > 0.15 ? qs * 0.8 : -qs * 0.6)
          + (mnoise3(mossP / 3.0 + 41.0) - 0.5) * qs * 1.6
          + (0.5 - mossGroove) * qs * 2.4;
        if (topEdge) mi += qs;
        if (bottomEdge) mi -= qs * 1.2;
        idx = clamp(floor(mi + 0.5), 0.0, N1);
      }
    }

    // Lit edges and dark creases, the way rocks are drawn in pixel art: the
    // row of texels along each facet's edge on the light side catches the
    // light, the row along its edge away from the light sits in a crease.
    // The distance to the edges is taken at the TEXEL'S CENTRE (carried over
    // from the fragment by the screen derivatives), so the lines follow the
    // texel grid and stay one crisp texel wide.
    vec2 uvT = uv * uTexelsPerMetre;
    vec2 dUVx = dFdx(uvT);
    vec2 dUVy = dFdy(uvT);
    vec3 dEx = dFdx(vEdge);
    vec3 dEy = dFdy(vEdge);
    float det = dUVx.x * dUVy.y - dUVx.y * dUVy.x;
    vec3 e = vEdge;
    if (abs(det) > 1e-6) {
      vec2 off = (cell + 0.5) - uvT;
      vec3 dEdu = (dEx * dUVy.y - dEy * dUVx.y) / det;
      vec3 dEdv = (dEy * dUVx.x - dEx * dUVy.x) / det;
      e += dEdu * off.x + dEdv * off.y;
    }
    e *= uTexelsPerMetre;                        // in texels
    float nearest = min(e.x, min(e.y, e.z));
    if (uNaturalStone < 0.5 && nearest < 1.0) {
      float flag = e.x <= e.y && e.x <= e.z ? vEdgeFlag.x : (e.y <= e.z ? vEdgeFlag.y : vEdgeFlag.z);
      if (flag > 0.75 && ndl > -0.15) idx = min(N1, idx + (ndl > 0.35 ? 2.0 : 1.0));
      else if (flag < 0.25) idx = max(0.0, idx - 1.0);
    }
    // Painted ridge strokes: one quiet palette step on selected sunlit
    // crests, rather than a bright outline around every triangle. A coherent
    // wear mask interrupts the stroke in patches, keeping it hand-painted.
    if (uNaturalStone > 0.5 && row > 0.5 && ndl > 0.35 && nearest >= -0.15 && nearest < 1.0) {
      float ridge = e.x <= e.y && e.x <= e.z ? vEdgeFlag.x : (e.y <= e.z ? vEdgeFlag.y : vEdgeFlag.z);
      float strokeWear = vnoise(vec3(cc * 2.1, uSeed + 123.0));
      if (ridge > 0.75 && strokeWear > 0.38) idx = min(N1, idx + 1.0);
    }
    // Thin stepped fissures, sampled on the same grid as the painted facets.
    float fissure = abs(vnoise(vec3(cc * 2.5, uSeed + 57.0)) - 0.5);
    if (uCracks > 0.0 && row > 0.5 && fissure < 0.025 * uCracks) idx = max(0.0, idx - 2.0);
    vec3 color = texture2D(uPalette, vec2((idx + 0.5) / uSteps, row)).rgb;
    color = rockSnowSurface(color,surfaceP,surfaceN,surfaceDown,surfaceDownN,surfaceAcross,surfaceAcrossN,uTexLightDir,uSnow,uSnowRim);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface RockOptions {
  /** base stone colour */
  color?: string;
  /** lichen / moss colour on top */
  mossColor?: string;
  /** 0 = bare .. 1 = mossy tops */
  moss?: number;
  /** chance (0..1) that this tree has any rocks at all */
  chance?: number;
  /** most clusters of rocks */
  maxClusters?: number;
  /** scale of the rocks (a bush's are smaller) */
  scale?: number;
  /** clusters are placed at this distance range from the trunk's axis */
  minDist: number;
  maxDist: number;
}

export interface RockResult {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

/**
 * A faceted boulder: a jittered icosahedron, closed, with big flat faces,
 * already scaled and turned (so the edge distances below are in metres),
 * carrying for every triangle its distance to each edge and which edges face
 * the light (see the lit edges in the shader).
 */
export function boulderGeometry(
  rnd: () => number,
  size: THREE.Vector3,
  yaw: number,
  light: THREE.Vector3,
  options: { irregularity?: number; detail?: number; shape?: string; grounded?: boolean } = {}
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, options.grounded ? (options.detail ?? 0) + 1 : options.detail ?? 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // The polyhedron repeats each corner once per face: jitter by the corner's
  // position, so the copies move together and no crack opens.
  const seed = rnd() * 100;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed) * 43758.5453;
    const irregularity = options.irregularity ?? 0.35;
    const broadNoise = Math.sin(v.x * 2.6 + seed) * Math.cos(v.y * 2.2 - seed * 0.7)
      + Math.sin(v.z * 3.1 + seed * 0.4) * 0.55;
    const k = options.grounded
      ? 1 + broadNoise * irregularity * 0.24 + ((h - Math.floor(h)) - 0.5) * irregularity * 0.12
      : 1 + ((h - Math.floor(h)) - 0.5) * 0.34;
    v.multiplyScalar(k);
    if (v.y < 0) v.y *= 0.6;          // a flatter underside, to sit on the ground
    if (options.shape === 'slab') v.y = Math.min(0.6 + Math.sin(v.x * 3 + seed) * 0.08, v.y);
    if (options.shape === 'spire') {
      const taper = 1 - Math.max(0, v.y) * 0.25;
      v.x *= taper; v.z *= taper;
      v.x += Math.max(0, v.y) * Math.sin(seed) * 0.16;
      v.z += Math.max(0, v.y) * Math.cos(seed * 0.7) * 0.12;
    }
    // A broad, flat contact patch makes a boulder sit in the earth rather
    // than balance on the polyhedron's bottom point.
    if (options.grounded) v.y = Math.max(-0.28, v.y);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.scale(size.x, size.y, size.z);
  geo.rotateY(yaw);
  if (options.grounded) {
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const span = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    geo.translate(-center.x, -box.min.y, -center.z);
    geo.scale(size.x / span.x, size.y / span.y, size.z / span.z);
  }
  geo.computeVertexNormals();

  const edge = new Float32Array(pos.count * 3);
  const flag = new Float32Array(pos.count * 3);
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  // Each triangle's face normal, and which triangle is across each edge, to
  // tell a real ridge from a near-flat seam between two facets.
  const triCount = pos.count / 3;
  const faceN: THREE.Vector3[] = [];
  const key = (a: THREE.Vector3) => `${Math.round(a.x * 1e4)},${Math.round(a.y * 1e4)},${Math.round(a.z * 1e4)}`;
  const mossNormals = new Map<string, THREE.Vector3>();
  const edgeOwners = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, t * 3 + k);
    faceN.push(new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize());
    for (const corner of p) {
      const id = key(corner);
      const sum = mossNormals.get(id) ?? new THREE.Vector3();
      sum.add(faceN[t]);
      mossNormals.set(id, sum);
    }
    for (let k = 0; k < 3; k++) {
      const ka = key(p[(k + 1) % 3]);
      const kb = key(p[(k + 2) % 3]);
      const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const list = edgeOwners.get(ek) ?? [];
      list.push(t);
      edgeOwners.set(ek, list);
    }
  }
  const mossNormal = new Float32Array(pos.count * 3);
  for (const sum of mossNormals.values()) sum.normalize();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mossNormals.get(key(v))!.toArray(mossNormal, i * 3);
  }
  geo.setAttribute('aMossNormal', new THREE.BufferAttribute(mossNormal, 3));
  geo.computeBoundingBox();
  const minY = geo.boundingBox!.min.y;
  const spanY = Math.max(1e-4, geo.boundingBox!.max.y - minY);
  const lit = (n: THREE.Vector3) => n.dot(light.clone().normalize());
  const centroid = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const lightDir = light.clone().normalize();
  for (let t = 0; t < pos.count; t += 3) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, t + k);
    const tri = t / 3;
    centroid.copy(p[0]).add(p[1]).add(p[2]).multiplyScalar(1 / 3);
    const area2 = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).length();
    for (let k = 0; k < 3; k++) {
      // the edge opposite corner k
      const a = p[(k + 1) % 3];
      const b = p[(k + 2) % 3];
      const height = area2 / Math.max(1e-6, a.distanceTo(b));
      edge[(t + k) * 3 + k] = height;       // interpolates to the distance to that edge
      mid.copy(a).add(b).multiplyScalar(0.5).sub(centroid);
      // 1 = a lit edge, 0 = a dark crease, 0.5 = nothing drawn. As a pixel
      // artist draws a rock: the light catches the ridge where it turns from
      // a lit facet to a darker one, on the lit facet and on the upper part of
      // the stone; the crease sits where a facet is much darker than its
      // neighbour. Every other seam is left plain.
      const ka = key(a);
      const kb = key(b);
      const other = (edgeOwners.get(ka < kb ? ka + '|' + kb : kb + '|' + ka) ?? []).find((o) => o !== tri);
      const here = lit(faceN[tri]);
      const there = other === undefined ? here : lit(faceN[other]);
      const high = ((a.y + b.y) * 0.5 - minY) / spanY > 0.4;
      const bend = other === undefined ? 1 : faceN[tri].dot(faceN[other]);
      const value = options.grounded
        ? (high && here > 0.35 && here > there + 0.18 && bend < 0.975 ? 1 : 0.5)
        : high && here > 0.1 && here > there + 0.12
        ? 1
        : here < there - 0.3
        ? 0
        : 0.5;
      for (let q = 0; q < 3; q++) flag[(t + q) * 3 + k] = value;
    }
  }
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 3));
  geo.setAttribute('aEdgeFlag', new THREE.BufferAttribute(flag, 3));
  return geo;
}

/**
 * Seeded rocks around a tree: maybe none, maybe a few clusters of one
 * boulder with a pebble or two beside it.
 */
export function buildPixelRocks(config: TreeConfig, opts: RockOptions): RockResult {
  const group = new THREE.Group();
  group.name = 'PixelRocks';
  group.userData.ground = true;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  // its own seeded stream, so rocks never shift the rest of the tree
  let s = (Math.floor(config.seed) * 31 + 7) % 233280;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  if (rnd() > (opts.chance ?? 0.6)) return { group, geometries, materials, textures };

  const { material: mat, palette, lightDir } = createPixelRockMaterial(config, opts);
  textures.push(palette);
  materials.push(mat);

  const scale = opts.scale ?? 1;
  const clusters = 1 + Math.floor(rnd() * (opts.maxClusters ?? 3));
  const baseAngle = rnd() * Math.PI * 2;
  for (let c = 0; c < clusters; c++) {
    const angle = baseAngle + (c / clusters) * Math.PI * 2 + (rnd() - 0.5) * 1.2;
    const dist = THREE.MathUtils.lerp(opts.minDist, opts.maxDist, rnd());
    const centre = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    const pieces = 1 + Math.floor(rnd() * 3);
    for (let p = 0; p < pieces; p++) {
      const r = (p === 0 ? 0.28 + rnd() * 0.3 : 0.1 + rnd() * 0.1) * scale;
      const sy = 0.55 + rnd() * 0.3;
      const size = new THREE.Vector3(r * (0.9 + rnd() * 0.4), r * sy, r * (0.9 + rnd() * 0.4));
      const geo = boulderGeometry(rnd, size, rnd() * Math.PI * 2, lightDir);
      geometries.push(geo);
      const rock = new THREE.Mesh(geo, mat);
      const off = p === 0 ? new THREE.Vector3() : new THREE.Vector3(Math.cos(rnd() * 6.28), 0, Math.sin(rnd() * 6.28)).multiplyScalar((0.3 + rnd() * 0.25) * scale + r);
      rock.position.copy(centre).add(off);
      rock.position.y = r * sy * 0.25;
      rock.castShadow = true;
      rock.receiveShadow = true;
      rock.userData.ground = true;
      group.add(rock);
    }
  }
  return { group, geometries, materials, textures };
}

/** Shared painted stone material for scenery and independent rock assets. */
export function createPixelRockMaterial(config: TreeConfig, opts: {
  color?: string; mossColor?: string; moss?: number; snow?: number; cracks?: number; snowRim?: boolean;
}) {
  const params = resolvePixelTextureParams(config);
  const lightDir = pixelTextureLightDir(params);
  const steps = config.growthStage === 'rock' ? params.steps : 6;
  const displayColors = config.growthStage === 'rock';
  const palette = paletteTexture(stoneRamp(opts.color ?? '#8a8175', steps, displayColors), mossRamp(opts.mossColor ?? (displayColors ? '#7ba33a' : '#7d8a3a'), steps, displayColors));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPalette: { value: palette },
      uSteps: { value: steps },
      uTexLightDir: { value: lightDir },
      // Finer than the bark (as the other small props are): a boulder has to
      // be some twenty texels across for its facets to take one-texel lit
      // edges; at the bark's density a facet was barely four texels tall and
      // an edge line filled it.
      uTexelsPerMetre: { value: params.barkTexelsPerMetre * 2.8 },
      uMoss: { value: opts.moss ?? 0.35 },
      uSeed: { value: (config.seed % 997) * 0.37 },
      uSnow: { value: opts.snow ?? 0 },
      uSnowRim: { value: opts.snowRim === false ? 0 : 1 },
      uSnowColors: { value: rockSnowColors() },
      uCracks: { value: opts.cracks ?? 0 },
      uNaturalStone: { value: config.growthStage === 'rock' ? 1 : 0 },
      uMossSeed: { value: params.seed },
    },
    vertexShader: STONE_VERTEX,
    fragmentShader: STONE_FRAGMENT,
  });
  return { material, palette, lightDir };
}
