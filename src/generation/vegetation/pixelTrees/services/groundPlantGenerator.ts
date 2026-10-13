// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { createReedHeadResources, faceCameraHorizontally } from './reedHeadSprite';
import { pixelTextureLightDir, resolvePixelTextureParams } from './pixelArtTextureSystem';
import { flowerSprite } from './fruitSystem';
import { makeSprite, spriteMaterial } from './pixelSprites';

/**
 * Ground plants (the "Rasteiras" category):
 *
 *  - fern_plant       (Samambaia)         arching fronds from one crown, each
 *                                         with its paired leaflets drawn texel
 *                                         by texel
 *  - wildflower_patch (Flores silvestres) a patch of slender stems with
 *                                         five-petal blossoms in mixed colours
 *                                         and low leaves at their feet
 *  - reed_clump       (Juncos)            tall thin blades and cattails with
 *                                         brown heads, at a little pool's edge
 *
 * Every leaf is a ribbon or a pair of crossed quads carrying a small
 * pixel-art texture (nearest filtering, a dark outline, lit top edges, a
 * shaded underside), drawn with a shared plant shader: light in whole steps
 * from the trees' baked light direction, and a sway in the wind that grows
 * from nothing at the base to its full swing at the tip.
 *
 * The greens come from the preset's foliage colours, so they follow the
 * panel; trunkHeight scales the plant.
 */

type PlantKind = 'fern' | 'wildflowers' | 'reeds';

export function plantKindOf(config: TreeConfig): PlantKind {
  const s = config.species as string;
  if (s.startsWith('reed')) return 'reeds';
  if (s.startsWith('wildflower')) return 'wildflowers';
  return 'fern';
}

export interface GroundPlantResult {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  /** true where the plant covers the ground (no grass tufts there) */
  occupies: (x: number, z: number) => boolean;
}

// -----------------------------------------------------------------------------
// Pixel textures
// -----------------------------------------------------------------------------

interface Ramp {
  light: THREE.Color;
  mid: THREE.Color;
  dark: THREE.Color;
  outline: THREE.Color;
}

function greenRamp(top: string, bottom: string): Ramp {
  const t = new THREE.Color(top);
  const b = new THREE.Color(bottom);
  return {
    light: t.clone().lerp(new THREE.Color('#f4ffc0'), 0.22),
    mid: t.clone().lerp(b, 0.18),
    dark: t.clone().lerp(b, 0.5),
    // a soft outline: a black one round every leaflet drowned a fern in it
    outline: t.clone().lerp(b, 0.85),
  };
}

class Canvas {
  data: Uint8ClampedArray;
  constructor(public w: number, public h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: THREE.Color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.data[o] = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255);
    this.data[o + 1] = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255);
    this.data[o + 2] = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255);
    this.data[o + 3] = 255;
  }
  filled(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.data[(y * this.w + x) * 4 + 3] > 0;
  }
  outline(c: THREE.Color) {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.filled(x, y)) continue;
        if (this.filled(x - 1, y) || this.filled(x + 1, y) || this.filled(x, y - 1) || this.filled(x, y + 1)) add.push([x, y]);
      }
    }
    add.forEach(([x, y]) => this.set(x, y, c));
  }
  texture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    // raw values: the plant shader writes them out as they are, like the
    // other pixel shaders
    return tex;
  }
}

/**
 * A fern frond, tip at the top of the canvas (uv.y = 1): a rachis up the
 * middle and pairs of leaflets that shorten toward the tip and the base,
 * each lit along its upper edge and shaded along its lower one.
 */
function frondTexture(r: Ramp): THREE.CanvasTexture {
  const W = 32, H = 64;
  const c = new Canvas(W, H);
  const mid = 15;
  // This shader writes colours directly, so the bytes below are the display greens. A fixed forest ramp (deep olive in the shade, a yellowish
  // moss green in the light) instead of the preset's bright apple green, which did not sit with the grass and the trees; wide steps between
  // the tones so every leaflet reads: lit upper edge, body, shaded lower edge.
  const rgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
  const deep = rgb(22, 44, 30);
  const shade = rgb(34, 66, 38);
  const leaf = rgb(54, 94, 44);
  const light = rgb(96, 132, 58);
  const stem = rgb(74, 98, 50);
  const vein = rgb(66, 108, 48);
  for (let pair = 0; pair < 11; pair++) {
    const rootY = 5 + pair * 5;
    const t = rootY / H;
    const reach = 4 + 10.5 * Math.pow(Math.sin(Math.PI * t), .65);
    for (const side of [-1, 1]) {
      const stagger = side > 0 ? 1 : 0;
      const length = reach - ((pair + (side > 0 ? 1 : 0)) % 3) * .55;
      for (let k = 1; k <= Math.ceil(length); k++) {
        const u = k / length;
        if (u > 1) continue;
        const centerY = rootY + stagger - u * 4;
        const half = .45 + Math.sin(Math.PI * u) * 1.25;
        const top = Math.ceil(centerY - half), bottom = Math.floor(centerY + half);
        for (let y = top; y <= bottom; y++) {
          const edge = y === bottom && k > 2;
          const glint = y === top && u > .22 && u < .72 && pair % 3 !== 1;
          c.set(mid + side * k, y, edge ? shade : glint ? light : leaf);
        }
        // Short central veins follow each leaflet, without a bright full stripe.
        if (k > 1 && k < length * .55 && pair % 2 === 0)
          c.set(mid + side * k, centerY, vein);
      }
    }
  }
  for (let y = 3; y < H - 2; y++) {
    c.set(mid, y, stem);
    if (y % 6 === 0) c.set(mid, y, light);
  }
  // A pointed terminal leaflet finishes the frond instead of a blunt comb.
  for (let y = 0; y < 6; y++) {
    const half = Math.min(2, Math.floor(y / 2));
    for (let x = mid - half; x <= mid + half; x++) c.set(x, y, x < mid ? light : leaf);
  }
  return c.texture();
}

/** A long grass-like blade: tapered to a point, a pale midrib. */
function bladeTexture(r: Ramp): THREE.CanvasTexture {
  const W = 8;
  const H = 64;
  const c = new Canvas(W, H);
  for (let y = 0; y < H; y++) {
    const t = 1 - y / H;                        // 0 base .. 1 tip
    const half = Math.max(0.5, 3 * Math.pow(1 - t, 0.6));
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2;
      if (Math.abs(dx) > half) continue;
      const col = Math.abs(dx) < 0.6 ? r.light : dx < 0 ? r.mid : r.dark;
      c.set(x, y, col);
    }
  }
  c.outline(r.outline);
  return c.texture();
}

/** A thin stem, lit down its left side. */
function stemTexture(r: Ramp): THREE.CanvasTexture {
  const c = new Canvas(4, 32);
  for (let y = 0; y < 32; y++) {
    c.set(1, y, r.light);
    c.set(2, y, r.dark);
  }
  return c.texture();
}

// -----------------------------------------------------------------------------
// The plant shader
// -----------------------------------------------------------------------------

const PLANT_VERTEX = /* glsl */ `
  attribute float aSway;
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // the tip swings, the base stays put; each plant part out of phase
    float s = aSway * aSway;
    float ph = wp.x * 1.7 + wp.z * 1.3;
    wp.x += sin(uTime * uWindSpeed * 1.9 + ph) * 0.07 * uWindStrength * s;
    wp.z += cos(uTime * uWindSpeed * 1.4 + ph * 0.8) * 0.05 * uWindStrength * s;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PLANT_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uTexLightDir;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    if (t.a < 0.5) discard;
    vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    float ndl = dot(n, normalize(uTexLightDir));
    float shade = ndl > 0.35 ? 1.0 : (ndl > -0.1 ? 0.84 : 0.7);
    gl_FragColor = vec4(t.rgb * shade, 1.0);
  }
`;

function plantMaterial(
  map: THREE.Texture,
  sharedUniforms: Record<string, THREE.IUniform>,
  lightDir: THREE.Vector3
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uWindStrength: sharedUniforms.uWindStrength,
      uWindSpeed: sharedUniforms.uWindSpeed,
      uMap: { value: map },
      uTexLightDir: { value: lightDir },
    },
    vertexShader: PLANT_VERTEX,
    fragmentShader: PLANT_FRAGMENT,
    side: THREE.DoubleSide,
  });
}

// -----------------------------------------------------------------------------
// Ribbons
// -----------------------------------------------------------------------------

class RibbonBuffers {
  pos: number[] = [];
  uv: number[] = [];
  sway: number[] = [];
  idx: number[] = [];
  count = 0;

  /**
   * A strip along `pts`, `widths[i]` wide, spread along `side` (one vector,
   * or one per point); u runs across, v from 0 at the base to 1 at the tip.
   */
  add(pts: THREE.Vector3[], widths: number[], side: THREE.Vector3 | THREE.Vector3[], swayScale = 1) {
    const n = pts.length;
    const start = this.count;
    for (let i = 0; i < n; i++) {
      const s = Array.isArray(side) ? side[i] : side;
      const v = i / (n - 1);
      for (const u of [0, 1]) {
        const p = pts[i].clone().addScaledVector(s, (u - 0.5) * widths[i]);
        this.pos.push(p.x, p.y, p.z);
        this.uv.push(u, v);
        this.sway.push(v * swayScale);
        this.count++;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = start + i * 2;
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** A stem as two crossed strips, so it reads from every side. */
function addCrossed(buf: RibbonBuffers, pts: THREE.Vector3[], width: number, turn: number, swayScale = 1) {
  const a = new THREE.Vector3(Math.cos(turn), 0, Math.sin(turn));
  const b = new THREE.Vector3(-a.z, 0, a.x);
  const widths = pts.map(() => width);
  buf.add(pts, widths, a, swayScale);
  buf.add(pts, widths, b, swayScale);
}

// -----------------------------------------------------------------------------
// The generator
// -----------------------------------------------------------------------------

export function buildGroundPlant(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>,
  rnd: () => number
): GroundPlantResult {
  const kind = plantKindOf(config);
  const group = new THREE.Group();
  group.name = 'GroundPlant';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const params = resolvePixelTextureParams(config);
  const lightDir = pixelTextureLightDir(params);
  const green = greenRamp(config.foliageColorTop, config.foliageColorBottom);
  const size = Math.max(0.2, config.trunkHeight);
  let spread = 0.6;

  const mesh = (buf: RibbonBuffers, tex: THREE.Texture) => {
    const geo = buf.build();
    const mat = plantMaterial(tex, sharedUniforms, lightDir);
    geometries.push(geo);
    materials.push(mat);
    textures.push(tex);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    group.add(m);
    return m;
  };

  if (kind === 'fern') {
    // ---- fronds arching out of one crown ---------------------------------
    const fronds = new RibbonBuffers();
    const count = 12 + Math.floor(rnd() * 5);
    const turn0 = rnd() * Math.PI * 2;
    for (let f = 0; f < count; f++) {
      const angle = turn0 + (f / count) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
      const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      // the young inner fronds stand up, the old outer ones lie out
      const inner = f % 3 === 0;
      const L = size * (inner ? 0.75 + rnd() * 0.2 : 1.0 + rnd() * 0.3);
      const rise = inner ? 1.5 : 1.35 + rnd() * 0.3;
      const reach = inner ? 0.4 : 0.75;
      const pts: THREE.Vector3[] = [];
      const widths: number[] = [];
      const sides: THREE.Vector3[] = [];
      const segs = 10;
      const side = new THREE.Vector3().crossVectors(UP, dir).normalize();
      const roll = (rnd() - 0.5) * 0.5;               // a frond tilts a little on its axis
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const p = dir.clone().multiplyScalar(L * reach * t);
        p.y = L * (rise * t - 0.95 * t * t) * 0.8 + 0.02;
        pts.push(p);
        widths.push(L * 0.3 * Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * t)), 0.55));
        sides.push(side.clone().applyAxisAngle(dir, roll * t));
      }
      fronds.add(pts, widths, sides);
    }
    mesh(fronds, frondTexture(green));
    spread = size * 0.85;
  } else if (kind === 'wildflowers') {
    // ---- stems with blossoms, leaves at their feet -------------------------
    const stems = new RibbonBuffers();
    const leaves = new RibbonBuffers();
    const count = 14 + Math.floor(rnd() * 9);
    const radius = 0.55 * Math.max(0.6, size / 0.5);
    const colours = ['#f4f1e6', '#f2c230', '#9a6ae0', '#5a8ae8', '#ef7ab0', '#e8583a'];
    const mats = new Map<string, THREE.SpriteMaterial>();
    const matFor = (c: string) => {
      let m = mats.get(c);
      if (!m) {
        m = spriteMaterial(flowerSprite(c));
        mats.set(c, m);
        materials.push(m);
      }
      return m;
    };
    // the patch leans to two or three colours, as a real meadow does
    const main = [colours[Math.floor(rnd() * colours.length)], colours[Math.floor(rnd() * colours.length)]];
    for (let s = 0; s < count; s++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * radius;
      const base = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      const h = size * (0.55 + rnd() * 0.55);
      const lean = new THREE.Vector3((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(base.clone().add(new THREE.Vector3(lean.x * h * t * t, h * t, lean.z * h * t * t)));
      }
      addCrossed(stems, pts, 0.028, rnd() * Math.PI, 0.5);
      const colour = rnd() < 0.7 ? main[s % 2] : colours[Math.floor(rnd() * colours.length)];
      const head = makeSprite(matFor(colour), 0.13 + rnd() * 0.07);
      head.position.copy(pts[pts.length - 1]).add(new THREE.Vector3(0, 0.02, 0));
      group.add(head);
      // two or three short leaves at the foot of the stem
      const nl = 2 + Math.floor(rnd() * 2);
      for (let l = 0; l < nl; l++) {
        const la = rnd() * Math.PI * 2;
        const ldir = new THREE.Vector3(Math.cos(la), 0, Math.sin(la));
        const ll = 0.12 + rnd() * 0.1;
        const lp: THREE.Vector3[] = [];
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          lp.push(base.clone().addScaledVector(ldir, ll * t * 0.8).add(new THREE.Vector3(0, ll * (1.1 * t - 0.6 * t * t), 0)));
        }
        leaves.add(lp, lp.map(() => 0.035), new THREE.Vector3().crossVectors(UP, ldir).normalize(), 0.4);
      }
    }
    mesh(stems, stemTexture(green));
    mesh(leaves, bladeTexture(green));
    spread = radius + 0.1;
  } else {
    // ---- reeds and cattails at the edge of a pool -------------------------
    const blades = new RibbonBuffers();
    const cattailStems = new RibbonBuffers();
    const count = 26 + Math.floor(rnd() * 10);
    const radius = 0.4 * Math.max(0.7, size / 1.7);
    for (let b = 0; b < count; b++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * radius;
      const base = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      const h = size * (0.5 + rnd() * 0.55);
      // blades lean out from the clump and arch over near the top
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.1 + rnd() * 0.18);
      const bend = 0.12 + rnd() * 0.4;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(base.clone().addScaledVector(out, h * t).add(new THREE.Vector3(out.x * bend * h * t * t * 4, h * t - bend * h * t * t * 0.3, out.z * bend * h * t * t * 4)));
      }
      const face = rnd() * Math.PI;
      const side = new THREE.Vector3(Math.cos(face), 0, Math.sin(face));
      blades.add(pts, pts.map(() => 0.14 * Math.max(0.7, size / 1.7)), side);
    }
    const headScale = Math.max(0.7, size / 1.7);
    const { geometry: headGeo, texture: headTex } = createReedHeadResources(headScale);
    const headMat = plantMaterial(headTex, sharedUniforms, lightDir);
    geometries.push(headGeo); textures.push(headTex); materials.push(headMat);
    const tails = 4 + Math.floor(rnd() * 3);
    for (let c = 0; c < tails; c++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * radius * 0.8;
      const base = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      const h = size * (1.15 + rnd() * 0.3);
      const lean = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.05 + rnd() * 0.05);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(base.clone().addScaledVector(lean, h * t).add(new THREE.Vector3(0, h * t, 0)));
      }
      const stemTip = base.clone().addScaledVector(lean, h * .75).add(new THREE.Vector3(0, h * .75, 0));
      const stemPts = pts.map((_, i) => base.clone().lerp(stemTip, i / 6));
      addCrossed(cattailStems, stemPts, .06 * headScale, rnd() * Math.PI, .525);
      const head = new THREE.Mesh(headGeo, headMat);
      head.name = 'ReedHeadSprite';
      const stemAxis = stemTip.clone().sub(base).normalize();
      head.position.copy(stemTip).addScaledVector(stemAxis, .18 * headScale);
      head.quaternion.setFromUnitVectors(UP, stemAxis);
      head.userData.stemAxis = stemAxis.clone();
      head.onBeforeRender = (_renderer, _scene, camera) => faceCameraHorizontally(head, camera, stemAxis);
      head.castShadow = true;
      const shadowMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: headTex, alphaTest: .5, side: THREE.DoubleSide });
      // Match the stem's wind displacement so the head remains attached.
      shadowMaterial.onBeforeCompile = shader => {
        shader.uniforms.uTime = sharedUniforms.uTime;
        shader.uniforms.uWindStrength = sharedUniforms.uWindStrength;
        shader.uniforms.uWindSpeed = sharedUniforms.uWindSpeed;
        shader.vertexShader = 'uniform float uTime; uniform float uWindStrength; uniform float uWindSpeed;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 worldAnchor = (modelMatrix * vec4(position, 1.0)).xyz;
          float ph = worldAnchor.x * 1.7 + worldAnchor.z * 1.3;
          vec3 wind = vec3(sin(uTime * uWindSpeed * 1.9 + ph) * .07, 0., cos(uTime * uWindSpeed * 1.4 + ph * .8) * .05) * uWindStrength * .275625;
          transformed += inverse(mat3(modelMatrix)) * wind;`);
      };
      head.customDepthMaterial = shadowMaterial;
      materials.push(shadowMaterial);
      group.add(head);
    }
    mesh(blades, bladeTexture(green));
    mesh(cattailStems, stemTexture(green));

    // a little pool beside the clump
    const poolGeo = new THREE.CircleGeometry(0.85, 20);
    poolGeo.rotateX(-Math.PI / 2);
    geometries.push(poolGeo);
    const poolMat = new THREE.MeshToonMaterial({ color: 0x4f7f84 });
    materials.push(poolMat);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    const pa = rnd() * Math.PI * 2;
    pool.position.set(Math.cos(pa) * (radius + 0.55), 0.012, Math.sin(pa) * (radius + 0.55));
    pool.scale.set(1, 1, 0.7);
    pool.rotation.y = rnd() * Math.PI;
    pool.receiveShadow = true;
    pool.userData.ground = true;
    group.add(pool);
    spread = radius + 1.4;
  }

  const occupies = (x: number, z: number) => Math.hypot(x, z) < spread;
  return { group, geometries, materials, textures, occupies };
}
