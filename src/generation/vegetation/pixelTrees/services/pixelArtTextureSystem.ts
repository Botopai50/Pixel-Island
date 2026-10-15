// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { pixelMossNoiseGLSL } from './mossStyle';

// ============================================================================
// PROCEDURAL PIXEL ART TEXTURE SYSTEM
// ============================================================================
// Every tree paints its own textures from its own seed and its own geometry.
//
// The system never writes noise straight into a texture. It generates a low
// resolution STRUCTURE map (which palette step each texel sits on, which leaf
// clump / bark plate it belongs to, how exposed it is) and a tiny PALETTE LUT
// holding a limited hand-built colour ramp. The shader then reads the structure
// map, adds an offset derived from the tree's own geometry (surface orientation,
// height, depth inside the crown, crevice depth, root proximity, configurable
// light direction) and HARD-QUANTISES that offset to whole palette steps before
// looking the colour up. Consequences:
//
//   * there is no path by which a smooth gradient can reach the screen - every
//     visible tone is one of N palette entries;
//   * lighting still drives the image, so geometry and appearance talk to each
//     other instead of being a texture laid over a model;
//   * the quantisation threshold is jittered by the per-texel clump / plate
//     hash, so the light terminator breaks along leaf clusters and bark plates
//     like a hand-drawn edge rather than sweeping a smooth curve.
//
// Perlin/Simplex-style noise is used only to place, warp and group things.
// Coherent clusters come from jittered-grid (Worley) partitions; each cluster
// gets ONE tone, which is what makes the result read as painted leaf masses
// instead of per-pixel static.
//
// Everything is hashed from (x, y, seed): identical seeds always produce
// identical textures, and the result never depends on call order.
// ============================================================================

// ---------------------------------------------------------------------------
// 1. PARAMETERS
// ---------------------------------------------------------------------------

export interface PixelTextureParams {
  enabled: boolean;
  seed: number;
  /**
   * 1 (finest) to 5 (chunkiest). Carried through so the UI can show the value
   * actually in use instead of its own guess at the default.
   */
  pixelSize: number;
  /**
   * Leaf cluster size in texels at the reference tile resolution, before being
   * rescaled for the current pixelSize. This is the number the slider edits.
   */
  clusterSizeBase: number;
  /** Canopy: texels along one edge of a single leaf-card tile. Lower = chunkier pixels. */
  tileRes: number;
  /** Bark: texels around the circumference / along the branch. */
  barkWidth: number;
  barkHeight: number;
  /** Colours per ramp (the whole limited palette). */
  steps: number;
  detail: number;
  contrast: number;
  shadow: number;
  highlights: number;
  clusterSize: number;
  irregularity: number;
  gaps: number;
  barkVariation: number;
  /** Which visual language the bark is drawn in. */
  barkPattern: BarkPattern;
  /**
   * Apparent wood pixel size, expressed in texels per METRE rather than per UV
   * unit. Wood UVs wrap the circumference once whatever the girth, so anything
   * defined in UV space is three times coarser on a flared base than at the top
   * of the trunk; defining it in world units is what keeps the pixels uniform.
   */
  barkTexelsPerMetre: number;
  /** Texels across one lobe; fewer = narrower, more numerous lobes. */
  barkTexelsPerLobe: number;
  accent: number;
  /** Procedural light direction used by the textures, in degrees. */
  lightAzimuth: number;
  lightElevation: number;
  /** Multiplier applied to the wood UV's v axis so bark texels stay square. */
  barkVScale: number;
}

interface SpeciesTextureDefaults {
  clusterSize: number;
  irregularity: number;
  gaps: number;
  barkVariation: number;
  contrast: number;
  shadow: number;
  highlights: number;
  accent: number;
  /** Hue drift, in degrees, applied to the shadow / highlight ends of the ramp. */
  hueCold: number;
  hueWarm: number;
}

// Bark variation is deliberately NOT set per species: 0 (clean, even ridges)
// reads best in the pixel art for every tree, so all of them take the base
// value below. It stays adjustable per tree from the panel.
const SPECIES_DEFAULTS: Record<string, Partial<SpeciesTextureDefaults>> = {
  hyrule_oak: { clusterSize: 5.0, gaps: 0.34, hueCold: 34, hueWarm: -22 },
  korok_ancient: { clusterSize: 5.6, gaps: 0.30, contrast: 0.56, hueCold: 40, hueWarm: -18 },
  satori_sakura: { clusterSize: 4.2, gaps: 0.38, accent: 0.55, hueCold: 8, hueWarm: -12, satBoost: 0.6 },
  akkala_birch: { clusterSize: 4.0, gaps: 0.44, contrast: 0.54, hueCold: 30, hueWarm: -26 },
  hebra_pine: { clusterSize: 3.4, irregularity: 0.72, gaps: 0.26, shadow: 0.62, hueCold: 10, hueWarm: -14 },
  faron_palm: { clusterSize: 4.6, gaps: 0.22, hueCold: 26, hueWarm: -24 },
  swamp_mangrove: { clusterSize: 5.2, irregularity: 0.62, gaps: 0.30, shadow: 0.64, hueCold: 46, hueWarm: -16 },
  gerudo_cactus: { clusterSize: 6.0, gaps: 0.14, hueCold: 24, hueWarm: -20 },
  dry_withered: { clusterSize: 5.0, gaps: 0.5, contrast: 0.6, shadow: 0.68, highlights: 0.4, hueCold: 18, hueWarm: -10 },
  savanna_acacia: { clusterSize: 3.2, irregularity: 0.6, gaps: 0.42, hueCold: 20, hueWarm: -30 },
  // autumn maples: a softer hue shift, so the reds and golds stay warm
  maple_red: { clusterSize: 4.6, gaps: 0.3, accent: 0.3, hueCold: 14, hueWarm: -8 },
  maple_orange: { clusterSize: 4.6, gaps: 0.3, accent: 0.3, hueCold: 14, hueWarm: -8 },
  maple_yellow: { clusterSize: 4.6, gaps: 0.3, accent: 0.3, hueCold: 16, hueWarm: -10 },
  arctic_willow: { clusterSize: 2.4, irregularity: 0.6, gaps: 0.24, hueCold: 30, hueWarm: -16 },
  // bushes: smaller leaves, so the crown reads as a bush and not a shrunk tree
  hyrule_shrub: { clusterSize: 3.4, gaps: 0.28, hueCold: 34, hueWarm: -22 },
  berry_shrub: { clusterSize: 3.2, gaps: 0.26, hueCold: 38, hueWarm: -18 },
  flowering_shrub: { clusterSize: 3.4, gaps: 0.3, hueCold: 30, hueWarm: -20 },
  desert_shrub: { clusterSize: 2.6, irregularity: 0.65, gaps: 0.46, contrast: 0.45, hueCold: 18, hueWarm: -26 },
  // one bush per biome: that biome's tree's leaf character, at bush scale
  satori_shrub: { clusterSize: 3.2, gaps: 0.32, accent: 0.55, hueCold: 22, hueWarm: -12 },
  akkala_shrub: { clusterSize: 3.2, gaps: 0.34, contrast: 0.54, hueCold: 30, hueWarm: -26 },
  hebra_shrub: { clusterSize: 2.8, irregularity: 0.7, gaps: 0.26, shadow: 0.6, hueCold: 44, hueWarm: -14 },
  faron_shrub: { clusterSize: 4.0, gaps: 0.22, hueCold: 26, hueWarm: -24 },
  korok_shrub: { clusterSize: 3.6, gaps: 0.26, contrast: 0.56, hueCold: 40, hueWarm: -18 },
  swamp_shrub: { clusterSize: 3.4, irregularity: 0.62, gaps: 0.3, shadow: 0.64, hueCold: 46, hueWarm: -16 },
  savanna_shrub: { clusterSize: 2.6, irregularity: 0.6, gaps: 0.42, hueCold: 20, hueWarm: -30 },
  withered_shrub: { clusterSize: 5.0, gaps: 0.5, contrast: 0.6, shadow: 0.68, highlights: 0.4, hueCold: 18, hueWarm: -10 },
};

const BASE_DEFAULTS: SpeciesTextureDefaults = {
  clusterSize: 5.0,
  irregularity: 0.55,
  gaps: 0.34,
  barkVariation: 0,
  contrast: 0.5,
  shadow: 0.55,
  highlights: 0.5,
  accent: 0.25,
  hueCold: 34,
  hueWarm: -22,
};

function speciesKey(species: string): string {
  return species.replace(/_sapling$|_fallen$/, '').replace(/_snowy$/, '');
}

function speciesDefaults(species: string): SpeciesTextureDefaults {
  return { ...BASE_DEFAULTS, ...(SPECIES_DEFAULTS[speciesKey(species)] ?? {}) };
}

/**
 * The bark's visual language, defaulted from the barkStyle the presets already
 * carry. Bark is not one look with a contrast dial: an oak is carved with deep
 * grooves, a birch is flat paper with dark dashes, a pine is broken into
 * plates. Using one recipe for all of them is what makes procedural bark read
 * as generic brown noise.
 */
const BARK_PATTERN_BY_STYLE: Record<string, BarkPattern> = {
  oak: 'lobed',
  birch: 'papery',
  pine: 'plated',
  ancient: 'lobed',
  swamp: 'lobed',
  deadwood: 'grain',
  cactus: 'flat',
};

/**
 * pixelSize 1 (finest) .. 5 (chunkiest) -> concrete texel budgets.
 * Kept deliberately low: the texels are magnified by the geometry, which is
 * what preserves the pixel art look. Nearest filtering, no mipmaps.
 */
const PIXEL_SIZE_TABLE = [
  { tile: 64, barkW: 64, barkH: 86, woodTexelsPerMetre: 13 },
  { tile: 54, barkW: 48, barkH: 64, woodTexelsPerMetre: 10 },
  { tile: 44, barkW: 40, barkH: 54, woodTexelsPerMetre: 8 },
  { tile: 34, barkW: 32, barkH: 44, woodTexelsPerMetre: 6 },
  { tile: 26, barkW: 24, barkH: 32, woodTexelsPerMetre: 4.5 },
];

export function resolvePixelTextureParams(config: TreeConfig): PixelTextureParams {
  const d = speciesDefaults(config.species);
  // default 1 = "Fino": the finest texel budget reads best on every species
  const sizeIdx = Math.max(0, Math.min(4, Math.round((config.pixelSize ?? 1) - 1)));
  const size = PIXEL_SIZE_TABLE[sizeIdx];
  // jogo: o tamanho do texel das folhas segue o do mundo (tileResOverride = texels de um cartão de folha)
  const tileRes = (config as { tileResOverride?: number }).tileResOverride ?? size.tile;

  // Cluster size is expressed in texels at the reference resolution (44) and
  // rescaled, so changing pixelSize does not change how big the leaf masses
  // read - only how crisp the pixels are.
  const clusterSizeBase = config.leafClusterSize ?? d.clusterSize;
  const clusterSize = clusterSizeBase * (tileRes / 44);

  return {
    enabled: config.pixelTextureEnabled !== false,
    seed: Math.floor(config.textureSeed ?? config.seed ?? 1234),
    pixelSize: sizeIdx + 1,
    clusterSizeBase,
    tileRes,
    barkWidth: size.barkW,
    barkHeight: size.barkH,
    steps: Math.max(4, Math.min(9, Math.round(config.paletteSteps ?? 6))),
    detail: clamp01(config.detailDensity ?? 0.5),
    contrast: clamp01(config.textureContrast ?? d.contrast),
    shadow: clamp01(config.shadowStrength ?? d.shadow),
    highlights: clamp01(config.highlightAmount ?? d.highlights),
    clusterSize: Math.max(2.0, clusterSize),
    irregularity: clamp01(config.leafClusterIrregularity ?? d.irregularity),
    gaps: clamp01(config.canopyGapAmount ?? d.gaps),
    barkVariation: clamp01(config.barkVariation ?? d.barkVariation),
    barkPattern:
      (config.barkPattern as BarkPattern | undefined) ??
      BARK_PATTERN_BY_STYLE[config.barkStyle] ??
      'furrowed',
    barkTexelsPerMetre: size.woodTexelsPerMetre,
    // a wider lobe needs more texels across it; barkVariation narrows them
    // Must be an INTEGER: a fractional count makes the bands across a lobe
    // unequal in width, which shows up as a checkerboard on the flared base.
    barkTexelsPerLobe: Math.max(4, Math.min(7, Math.round(7 - clamp01(config.barkVariation ?? d.barkVariation) * 3))),
    accent: clamp01(config.textureAccentAmount ?? d.accent),
    lightAzimuth: config.textureLightAzimuth ?? 135,
    lightElevation: config.textureLightElevation ?? 55,
    // Wood UVs are (angle, arcLength * 0.4). This keeps the bark texels roughly
    // square on a trunk of ~1.1 m radius; see barkVScaleFor().
    barkVScale: config.barkTexelScale ?? barkVScaleFor(size.barkW, size.barkH),
  };
}

function barkVScaleFor(w: number, h: number): number {
  // texels/m around the trunk = w / C, rows/m along it = 0.4 * k * h.
  // Equal when k = C_ref / (0.4 * h) * (w / C_ref) ... simplifies to:
  const referenceCircumference = 7.0; // ~1.1 m radius trunk
  return (2.5 * w) / (referenceCircumference * h);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function pixelTextureLightDir(params: PixelTextureParams): THREE.Vector3 {
  const az = (params.lightAzimuth * Math.PI) / 180;
  const el = (params.lightElevation * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(az) * Math.cos(el),
    Math.sin(el),
    Math.sin(az) * Math.cos(el)
  ).normalize();
}

// ---------------------------------------------------------------------------
// 2. DETERMINISTIC HASHING (order independent - pure function of x, y, seed)
// ---------------------------------------------------------------------------

function hashU(x: number): number {
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) | 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return x >>> 0;
}

function hash2(x: number, y: number, s: number): number {
  return (
    hashU(Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1013904223)) /
    4294967296
  );
}

function hash1(i: number, s: number): number {
  return hashU(Math.imul(i | 0, 2654435761) + Math.imul(s | 0, 40503)) / 4294967296;
}

function smoothStepT(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrapInt(i: number, n: number): number {
  return ((i % n) + n) % n;
}

// ---------------------------------------------------------------------------
// 3. NOISE - used only to distribute, warp and group. Never drawn directly.
// ---------------------------------------------------------------------------

function valueNoise2(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smoothStepT(x - xi);
  const v = smoothStepT(y - yi);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm2(x: number, y: number, s: number, octaves: number): number {
  let total = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2(x * f, y * f, s + i * 7919) * amp;
    norm += amp;
    f *= 2;
    amp *= 0.5;
  }
  return total / norm;
}

/** Value noise whose integer lattice wraps, so the result tiles exactly. */
function pnoise(x: number, y: number, s: number, px: number, py: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smoothStepT(x - xi);
  const v = smoothStepT(y - yi);
  const x0 = wrapInt(xi, px);
  const x1 = wrapInt(xi + 1, px);
  const y0 = wrapInt(yi, py);
  const y1 = wrapInt(yi + 1, py);
  const a = hash2(x0, y0, s);
  const b = hash2(x1, y0, s);
  const c = hash2(x0, y1, s);
  const d = hash2(x1, y1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Tileable fbm. px/py must be integers; each octave doubles them. */
function pfbm(x: number, y: number, s: number, octaves: number, px: number, py: number): number {
  let total = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    total +=
      pnoise(
        x * f,
        y * f,
        s + i * 7919,
        Math.max(1, Math.round(px * f)),
        Math.max(1, Math.round(py * f))
      ) * amp;
    norm += amp;
    f *= 2;
    amp *= 0.5;
  }
  return total / norm;
}

interface CellHit {
  id: number;
  /** distance to the nearest feature point */
  d1: number;
  /** distance to the second nearest - |d2-d1| marks cluster borders */
  d2: number;
  fx: number;
  fy: number;
  cw: number;
}

/**
 * Jittered-grid (Worley) partition. THIS is the cluster engine: it splits the
 * tile into small irregular cells, each of which becomes one leaf clump / bark
 * fibre and receives a single flat tone. `aspect` stretches the cells (>1 makes
 * them taller), which is how bark grain gets to follow the branch axis.
 */
function cellular(
  px: number,
  py: number,
  cell: number,
  jitter: number,
  s: number,
  aspect: number
): CellHit {
  const ay = aspect || 1;
  const gx = Math.floor(px / cell);
  const gy = Math.floor(py / (cell * ay));
  let d1 = 1e9;
  let d2 = 1e9;
  let id1 = 0;
  let fx1 = 0;
  let fy1 = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox;
      const cy = gy + oy;
      const jx = (hash2(cx, cy, s) - 0.5) * jitter;
      const jy = (hash2(cx, cy, s + 9173) - 0.5) * jitter;
      const fx = (cx + 0.5 + jx) * cell;
      const fy = (cy + 0.5 + jy) * cell * ay;
      const dx = fx - px;
      const dy = fy - py;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        // hashU is required here: a bare XOR of multiplications has badly
        // distributed high bits, and the cell id is used as a uniform random
        // number. Without the finaliser every cell lands in the same bucket.
        id1 = hashU(Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ s);
        fx1 = fx;
        fy1 = fy;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { id: id1, d1: Math.sqrt(d1), d2: Math.sqrt(d2), fx: fx1, fy: fy1, cw: cell };
}

/** Cellular partition on a wrapping grid, so bark tiles with no seam. */
function pcell(
  px: number,
  py: number,
  cellsX: number,
  cellsY: number,
  w: number,
  h: number,
  jitter: number,
  s: number
): CellHit {
  const cw = w / cellsX;
  const ch = h / cellsY;
  const gx = Math.floor(px / cw);
  const gy = Math.floor(py / ch);
  let d1 = 1e9;
  let d2 = 1e9;
  let id1 = 0;
  let fx1 = 0;
  let fy1 = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox;
      const cy = gy + oy;
      const wx = wrapInt(cx, cellsX);
      const wy = wrapInt(cy, cellsY);
      const jx = (hash2(wx, wy, s) - 0.5) * jitter;
      const jy = (hash2(wx, wy, s + 9173) - 0.5) * jitter;
      const fx = (cx + 0.5 + jx) * cw;
      const fy = (cy + 0.5 + jy) * ch;
      const dx = fx - px;
      const dy = fy - py;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id1 = hashU(Math.imul(wx, 73856093) ^ Math.imul(wy, 19349663) ^ s);
        fx1 = fx;
        fy1 = fy;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { id: id1, d1: Math.sqrt(d1), d2: Math.sqrt(d2), fx: fx1, fy: fy1, cw };
}

// ---------------------------------------------------------------------------
// 4. LIMITED PALETTE RAMPS
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  let s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((((h % 360) + 360) % 360) / 360);
  s = clamp01(s);
  l = clamp01(l);
  if (s < 1e-6) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * Extends the two authored foliage colours into a full artist ramp:
 * deep shadow -> dark -> base -> light -> highlight.
 * Shadows drift cold, highlights drift warm, chroma stays strong at both ends
 * (a desaturated top step is what makes procedural palettes look muddy).
 */
export function buildFoliageRamp(
  darkHex: string,
  lightHex: string,
  steps: number,
  opts: { hueCold?: number; hueWarm?: number; contrast?: number; shadow?: number; satBoost?: number }
): RGB[] {
  const hueCold = opts.hueCold ?? 34;
  const hueWarm = opts.hueWarm ?? -22;
  const contrast = opts.contrast ?? 0.5;
  const shadow = opts.shadow ?? 0.5;
  const satBoost = opts.satBoost ?? 1;

  const dark = rgbToHsl(...hexToRgb(darkHex));
  const light = rgbToHsl(...hexToRgb(lightHex));

  const lLow = Math.max(0.075, Math.min(0.24, dark[2] * (0.58 - shadow * 0.16)));
  const lHigh = Math.max(0.6, Math.min(0.74, light[2] + 0.09 + contrast * 0.06));
  const hMid = light[0] + (dark[0] - light[0]) * 0.5;
  const sMid = Math.max(0.5, (dark[1] + light[1]) * 0.5);

  const out: RGB[] = [];
  const n = Math.max(3, steps | 0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tc = t + (smoothStepT(t) - t) * (0.2 + contrast * 0.3);
    const l = lLow + (lHigh - lLow) * tc;
    const h = hMid + (1 - tc) * hueCold + tc * hueWarm;
    const s = Math.min(1, sMid * satBoost * (1.02 + 0.26 * Math.abs(tc - 0.5) * 2));
    out.push(hslToRgb(h, s, l));
  }
  return out;
}

/**
 * Wood ramp. Browns are fragile: pushing hue or saturation the way a foliage
 * ramp does turns them salmon or purple-grey, so the drift is small and the
 * extremes are desaturated.
 */
export function buildWoodRamp(
  baseHex: string,
  steps: number,
  opts: { contrast?: number; shadow?: number }
): RGB[] {
  const contrast = opts.contrast ?? 0.5;
  const shadow = opts.shadow ?? 0.5;
  const base = rgbToHsl(...hexToRgb(baseHex));
  const hue = base[0];
  // Wood in hand-painted pixel art is warm and chromatic - terracotta and
  // amber, not grey-brown. Clamping saturation DOWN (as a naive ramp does) is
  // what makes procedural bark look like mud, so the base chroma is lifted.
  const sat = Math.min(0.78, Math.max(0.34, base[1] * 1.45));
  // The ramp has to stay readable for both a near-black pine bark and a
  // near-white birch bark, so the ends are anchored rather than scaled: a dark
  // base still gets a lit side you can see, a pale base still stays pale.
  const lLow = Math.max(0.095, Math.min(0.22, base[2] * (0.36 - shadow * 0.08)));
  const lHigh = Math.max(0.48, Math.min(0.84, 0.36 + base[2] * 0.60 + contrast * 0.04));

  const out: RGB[] = [];
  const n = Math.max(3, steps | 0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tc = t + (smoothStepT(t) - t) * (0.18 + contrast * 0.26);
    const l = lLow + (lHigh - lLow) * tc;
    // Shadows drift slightly olive, highlights slightly toward amber. Pushing
    // the light end toward red is what turns a brown ramp pink.
    const h = hue - (1 - tc) * 6 + tc * 4;
    const s = sat * (0.80 + 0.28 * (1 - Math.abs(tc - 0.6) * 1.4));
    out.push(hslToRgb(h, Math.max(0.18, Math.min(0.66, s)), l));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. TEXTURE PLUMBING
// ---------------------------------------------------------------------------

/**
 * Structure maps carry palette indices and hashes, NOT colour: they must stay
 * outside colour management or three.js linearises the indices and the shader
 * reads garbage. The palette LUT is likewise raw - custom ShaderMaterials write
 * gl_FragColor without three.js' output conversion, so raw sRGB bytes in the
 * LUT mean the authored hex is exactly what reaches the screen.
 */
function makeNearestTexture(pixels: Uint8ClampedArray, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, w, h), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.premultiplyAlpha = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Palette LUT: N x 2. Canvas row 0 = main ramp (sample v = 0.75 with flipY),
 *  canvas row 1 = accent ramp (v = 0.25). */
function buildPaletteTexture(main: RGB[], accent: RGB[]): THREE.CanvasTexture {
  const n = main.length;
  const pixels = new Uint8ClampedArray(n * 2 * 4);
  for (let i = 0; i < n; i++) {
    pixels[i * 4 + 0] = main[i][0];
    pixels[i * 4 + 1] = main[i][1];
    pixels[i * 4 + 2] = main[i][2];
    pixels[i * 4 + 3] = 255;
    const a = accent[i] ?? main[i];
    const d = (n + i) * 4;
    pixels[d + 0] = a[0];
    pixels[d + 1] = a[1];
    pixels[d + 2] = a[2];
    pixels[d + 3] = 255;
  }
  return makeNearestTexture(pixels, n, 2);
}

export const PALETTE_ROW_MAIN = 0.75;
export const PALETTE_ROW_ACCENT = 0.25;

// ---------------------------------------------------------------------------
// 6. CANOPY: one leaf-cluster tile
// ---------------------------------------------------------------------------

interface Lobe {
  x: number;
  y: number;
  r: number;
  scallops: number;
  phase: number;
  amp: number;
  cx: number;
  cy: number;
}

/**
 * Paints one leaf-cluster tile as a structure map.
 *   R = palette step        G = clump hash (255 = deliberate highlight spark)
 *   B = exposure            A = coverage (0 or 255, hard cutout)
 *
 * Tile space: y = 0 is the card TIP (uv.y = 1 under the canvas flip) and
 * y = res-1 is the stem anchor, which sits inside the canopy - hence darker.
 */
function makeLeafClusterTile(res: number, tileIdx: number, seed: number, p: PixelTextureParams): Uint8ClampedArray {
  const N = p.steps;
  const out = new Uint8ClampedArray(res * res * 4);
  const tSeed = (seed + tileIdx * 6151) | 0;

  // light direction projected into tile space (y grows downward in image space)
  const la = (p.lightAzimuth * Math.PI) / 180;
  let lx = Math.cos(la) * Math.cos((p.lightElevation * Math.PI) / 180);
  let ly = -(0.45 + Math.sin((p.lightElevation * Math.PI) / 180));
  const ll = Math.hypot(lx, ly) || 1;
  lx /= ll;
  ly /= ll;

  // --- A. SILHOUETTE: 3-5 angularly scalloped lobes fused as metaballs.
  //        The scalloping is what gives the bumpy hand-drawn foliage outline.
  const lobeCount = 3 + Math.floor(hash1(tSeed, 11) * 3);
  const lobes: Lobe[] = [];
  for (let i = 0; i < lobeCount; i++) {
    const a = hash1(tSeed + i * 131, 21) * Math.PI * 2;
    const spread = (i === 0 ? 0 : 0.15 + hash1(tSeed + i * 131, 23) * 0.17) * res;
    const rad = (i === 0 ? 0.3 : 0.18 + hash1(tSeed + i * 131, 22) * 0.11) * res;
    const x = res * 0.5 + Math.cos(a) * spread;
    const y = res * 0.42 + Math.sin(a) * spread * 0.72;
    lobes.push({
      x,
      y,
      r: rad,
      scallops: 3 + Math.floor(hash1(tSeed + i * 131, 24) * 4),
      phase: hash1(tSeed + i * 131, 25) * Math.PI * 2,
      amp: 0.12 + hash1(tSeed + i * 131, 26) * 0.13,
      cx: x + lx * rad * 0.5,
      cy: y + ly * rad * 0.5,
    });
  }

  const field = (x: number, y: number): number => {
    let f = 0;
    for (let i = 0; i < lobes.length; i++) {
      const lo = lobes[i];
      const dx = x - lo.x;
      const dy = y - lo.y;
      const th = Math.atan2(dy, dx);
      const rr = lo.r * (1 + lo.amp * Math.sin(th * lo.scallops + lo.phase) * (0.5 + p.irregularity));
      const d2 = (dx * dx + dy * dy) / (rr * rr);
      if (d2 < 1) {
        const k = 1 - d2;
        f += k * k;
      }
    }
    return f;
  };

  const THRESH = 0.4;
  const cover = new Uint8Array(res * res);
  const fieldBuf = new Float32Array(res * res);
  const formBuf = new Float32Array(res * res);

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const f = field(x + 0.5, y + 0.5);
      fieldBuf[y * res + x] = f;
      // chew the outline on a coarse cell grid so the edge steps instead of curving
      const ch = cellular(x, y, 2.4, 1.0, tSeed + 4441, 1).id / 4294967296;
      cover[y * res + x] = f > THRESH + (ch - 0.5) * 0.15 * (0.4 + p.irregularity) ? 1 : 0;
    }
  }

  // --- B. GAPS punched into the coverage mask BEFORE shading, so the borders
  //        of every hole get proper rim tones instead of looking cut out.
  if (p.gaps > 0.01) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        if (!cover[y * res + x]) continue;
        const f = fieldBuf[y * res + x];
        const g = cellular(x, y, 2.6 + p.gaps * 2.0, 1.0, tSeed + 8888, 1);
        const gr = g.id / 4294967296;
        const gapNoise = fbm2((x / res) * 3.1, (y / res) * 3.1, tSeed + 9191, 2);
        // erode the rim into irregular bites
        if (f < THRESH + 0.26 && gr < p.gaps * 0.5) {
          cover[y * res + x] = 0;
          continue;
        }
        // interior windows: small holes so the crown is never a solid mass
        if (gapNoise < 0.3 && gr < p.gaps * 0.38 && g.d1 < 1.5) {
          cover[y * res + x] = 0;
        }
      }
    }
  }

  const cov = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= res || y >= res ? 0 : cover[y * res + x];

  // --- C. FORM: the large light/dark masses. Computed raw, then stretched over
  //        the tile's own range so the full ramp is always used no matter how
  //        the lobes happened to fall.
  let lo = 1e9;
  let hi = -1e9;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      if (!cover[y * res + x]) continue;
      const f = fieldBuf[y * res + x];
      let form = 0;
      let wsum = 0;
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const dC = Math.hypot(x + 0.5 - l.cx, y + 0.5 - l.cy) / (l.r * 1.6);
        const w = Math.max(0, 1 - Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) / (l.r * 1.75));
        form += Math.max(0, 1 - dC) * w;
        wsum += w;
      }
      form = wsum > 0.001 ? form / wsum : 0.4;
      // deep inside the metaball stack = overlapping leaves = darker
      form -= Math.min(1, Math.max(0, (f - THRESH) * 0.5)) * (0.12 + p.shadow * 0.16);
      // the stem end of the card hangs inside the canopy
      form -= (y / res) * (0.1 + p.shadow * 0.2);
      // macro breakup so the masses are not concentric rings
      form += (fbm2((x / res) * 2.3, (y / res) * 2.3, tSeed + 777, 2) - 0.5) * 0.2;
      formBuf[y * res + x] = form;
      if (form < lo) lo = form;
      if (form > hi) hi = form;
    }
  }
  const span = Math.max(0.05, hi - lo);

  // The form only spans the middle of the ramp. The light steps have to be
  // earned by rim / sparks and the dark steps by seams / pockets, which is what
  // keeps the base green dominant and the highlights scarce.
  const IDX_LO = (N - 1) * 0.24;
  const IDX_HI = (N - 1) * 0.82;

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const o = (y * res + x) * 4;
      if (!cover[y * res + x]) {
        out[o + 3] = 0;
        continue;
      }
      const f = fieldBuf[y * res + x];
      let form = (formBuf[y * res + x] - lo) / span;
      form = Math.min(1, Math.max(0, 0.5 + (form - 0.5) * (1.05 + p.contrast * 0.75)));

      // --- D. FLORETS -------------------------------------------------------
      // Each cell is one leaf floret. Crucially, a floret is shaded as its own
      // little dome - lit on the side facing the light, dark on the far side,
      // darker again toward its rim - instead of being filled with one flat
      // tone. Flat-per-cluster gives coherent masses but no volume inside them,
      // which is what made the canopy read as a tinted mass rather than as
      // hand-drawn broccoli-like clumps.
      const c = cellular(x, y, p.clusterSize, 0.35 + p.irregularity * 0.5, tSeed + 313, 0.9);
      const cr = c.id / 4294967296;

      const offX = x + 0.5 - c.fx;
      const offY = y + 0.5 - c.fy;
      const offLen = Math.hypot(offX, offY) || 1e-4;
      const floretRadius = Math.max(1.2, p.clusterSize * 0.62);
      // which way this texel faces on its own floret, and how near its rim
      const facing = (offX / offLen) * lx + (offY / offLen) * ly;
      const rim = Math.min(1, offLen / floretRadius);
      // Zero-centred on purpose: `rim` averages ~0.67 over a disc, so
      // subtracting it raw would bias every floret downward and drag the whole
      // tile into its darkest step.
      const floretShade =
        facing * (0.62 + p.contrast * 0.3) +
        (0.6 - rim) * (0.45 + p.shadow * 0.35);

      // a little flat variation between florets, on top of their own shading
      let clumpStep = 0;
      if (cr < 0.2) clumpStep = -1;
      else if (cr > 0.9) clumpStep = 1;
      const stepGain = 0.45 + p.detail * 0.35;

      let idx =
        IDX_LO +
        (IDX_HI - IDX_LO) * form +
        clumpStep * stepGain +
        floretShade * (1.5 + p.detail * 0.8);

      // Seam between neighbouring clumps: reads as a drawn leaf separation.
      // Gated by a per-clump hash so only some clumps are outlined - a pixel
      // artist does not draw a border around every single leaf, and outlining
      // all of them buries the tile in its darkest tone.
      // The reference separates its florets with a near-black line, most
      // visible where florets overlap, so the seam is both darker and more
      // frequent than a subtle grain line would be.
      const seam = c.d2 - c.d1;
      if (seam < 0.55 + p.detail * 0.45 && hash1(c.id, 43) < 0.78) {
        idx -= 0.95 + p.detail * 0.7;
      }

      // deep shadow pockets
      const pocket = fbm2((x / res) * 3.6, (y / res) * 3.6, tSeed + 5150, 2);
      if (pocket < 0.3 && f > THRESH + 0.14) idx -= 1.15 + p.shadow * 1.0;

      // Silhouette rim: bright on the lit edge, deep on the far edge. Measured
      // against the final mask so the borders of the punched holes are shaded
      // too - but only the true OUTER rim gets the full darkening. Interior
      // hole borders are numerous, and treating them all as outline is what
      // crushes the whole canopy into the darkest step.
      const outerness = Math.min(1, Math.max(0, (THRESH + 0.3 - f) / 0.3));
      const litOut = cov(x + Math.round(lx * 1.5), y + Math.round(ly * 1.5)) === 0;
      const darkOut = cov(x - Math.round(lx * 1.5), y - Math.round(ly * 1.5)) === 0;
      if (litOut && form > 0.34) idx += 1.25 + outerness * 0.6;
      else if (darkOut) idx -= (0.55 + outerness * 0.85) * (0.55 + p.shadow * 0.8);

      // a handful of deliberate 1-2 texel sparks, only on the most exposed clumps
      let spark = 0;
      if (form > 0.62 && hash1(c.id, 61) < p.highlights * 0.6) {
        const dS = Math.hypot(x + 0.5 - (c.fx + lx * 1.1), y + 0.5 - (c.fy + ly * 1.1));
        if (dS < 1.35) {
          idx = N - 1 + 0.4;
          spark = 1;
        }
      }

      const iq = Math.min(N - 1, Math.max(0, Math.round(idx)));
      out[o + 0] = Math.round(iq * (255 / Math.max(1, N - 1)));
      out[o + 1] = spark ? 255 : Math.round(cr * 250);
      out[o + 2] = Math.round(clamp01(form) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 4 x 2 tile atlas. Atlas row 0 is the canvas TOP row, matching the existing
 *  UV maths in the foliage vertex shader. */
function buildLeafStructureAtlas(tileRes: number, seed: number, p: PixelTextureParams): Uint8ClampedArray {
  const w = tileRes * 4;
  const h = tileRes * 2;
  const big = new Uint8ClampedArray(w * h * 4);
  for (let idx = 0; idx < 8; idx++) {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const tile = makeLeafClusterTile(tileRes, idx, seed, p);
    for (let y = 0; y < tileRes; y++) {
      for (let x = 0; x < tileRes; x++) {
        const s = (y * tileRes + x) * 4;
        const d = ((row * tileRes + y) * w + (col * tileRes + x)) * 4;
        big[d + 0] = tile[s + 0];
        big[d + 1] = tile[s + 1];
        big[d + 2] = tile[s + 2];
        big[d + 3] = tile[s + 3];
      }
    }
  }
  return big;
}

// ---------------------------------------------------------------------------
// 7. WOOD: bark / branch / root structure
// ---------------------------------------------------------------------------

/**
 * Bark structure map, tiling exactly in u (around the trunk) and v (along it).
 *   R = palette step   G = texel/patch hash   B = crevice depth + highlight bit
 *   A = 255 always
 *
 * IMPORTANT: alpha is NOT a data channel here. A 2D canvas stores premultiplied
 * alpha, so any texel written with a < 255 comes back with its RGB scaled (and
 * with a = 0 it comes back as pure black). The bark needs every texel opaque, so
 * the highlight flag rides in the high bit of B instead:
 *   B = crevice * 127  (+ 128 when the texel is a lit ridge)
 * With NEAREST filtering and no mipmaps the byte survives exactly, so the
 * shader can split the two signals back apart losslessly.
 *
 * The bark is DRAWN, not thresholded. Thresholding noise is what makes
 * procedural bark read as "brown noise": it produces a uniform spray of small
 * marks with no hierarchy. Instead:
 *
 *   1. a few large, flat regions set the base tone (big light/dark masses);
 *   2. a handful of explicit FURROW STROKES are drawn down the trunk - each one
 *      a long line that wanders in u as it climbs, 1-3 texels wide, with a
 *      1-texel lit edge on its sun-facing side, which is the classic pixel-art
 *      way to carve a groove;
 *   3. only then does a small amount of fine detail go on top, and how much is
 *      what `barkVariation` really controls.
 *
 * `pattern` picks the visual language, defaulting from the species' barkStyle.
 */
export type BarkPattern = 'lobed' | 'streaked' | 'furrowed' | 'flat' | 'plated' | 'papery' | 'grain';

interface FurrowStroke {
  /** u position at v = 0, in texels */
  u0: number;
  /** how far it wanders across the trunk, in texels */
  wander: number;
  /** wander frequency along v (integer, so the stroke tiles) */
  freq: number;
  phase: number;
  halfWidth: number;
  depth: number;
  /** strokes stop and restart instead of running the full height */
  vStart: number;
  vEnd: number;
}

function buildFurrowStrokes(
  w: number,
  h: number,
  seed: number,
  count: number,
  p: PixelTextureParams
): FurrowStroke[] {
  const strokes: FurrowStroke[] = [];
  for (let i = 0; i < count; i++) {
    const s = seed + i * 7717;
    // spread the strokes around the trunk, then jitter, so they never line up
    const slot = (i + 0.5) / count;
    const u0 = (slot + (hash1(s, 3) - 0.5) * (0.7 / count)) * w;
    const long = hash1(s, 9) < 0.4; // a few run the whole trunk, most are shorter
    const vStart = long ? -0.1 : hash1(s, 11) * 0.7;
    strokes.push({
      u0,
      wander: (1.2 + hash1(s, 5) * 3.4) * (0.5 + p.barkVariation),
      freq: 1 + Math.floor(hash1(s, 6) * 3),
      phase: hash1(s, 7) * Math.PI * 2,
      halfWidth: 0.5 + hash1(s, 8) * (0.45 + p.barkVariation * 0.6),
      // varied depth, so furrows spread over the dark half of the ramp instead
      // of every one of them bottoming out on the same darkest step
      depth: 1.1 + hash1(s, 10) * 1.2,
      vStart,
      vEnd: long ? 1.1 : vStart + 0.22 + hash1(s, 12) * 0.4,
    });
  }
  return strokes;
}

/** Signed distance in u from `x` to a stroke's centre at row `fy`, wrapping. */
function strokeOffset(st: FurrowStroke, x: number, fy: number, w: number): number {
  const centre =
    st.u0 + Math.sin(fy * Math.PI * 2 * st.freq + st.phase) * st.wander;
  let d = x - centre;
  // wrap into [-w/2, w/2] so a stroke near u = 0 still reaches u = w - 1
  d -= Math.round(d / w) * w;
  return d;
}

function barkPatternFor(p: PixelTextureParams): BarkPattern {
  return p.barkPattern;
}

function makeBarkStructure(w: number, h: number, seed: number, p: PixelTextureParams): Uint8ClampedArray {
  const N = p.steps;
  const q = (N - 1) / 5; // every offset scales with the ramp length
  const out = new Uint8ClampedArray(w * h * 4);
  const V = p.barkVariation;
  const pattern = barkPatternFor(p);

  // --- 1. LARGE FLAT REGIONS -------------------------------------------------
  // Few, big cells. These are the "grandes regiões" that carry the macro
  // light/dark masses; everything else is detail laid over them.
  const regionCellsU = pattern === 'flat' ? 2 : 3;
  const regionCellsV = pattern === 'flat' ? 2 : 3;

  // --- 2. FURROW STROKES ---------------------------------------------------
  const strokeCount =
    pattern === 'flat' ? 2 + Math.round(V * 2)
    : pattern === 'furrowed' ? 2 + Math.round(V * 3)
    : pattern === 'lobed' ? 0
    : pattern === 'streaked' ? 2 + Math.round(V * 3)
    : pattern === 'plated' ? 2 + Math.round(V * 2)
    : pattern === 'papery' ? 1 + Math.round(V * 1)
    : 4 + Math.round(V * 4);
  const strokes = buildFurrowStrokes(w, h, seed + 91, Math.max(1, strokeCount), p);

  // how much fine detail is allowed on top of the drawn shapes
  const fineAmount =
    pattern === 'lobed' ? 0.0
    : pattern === 'flat' ? 0.12
    : pattern === 'papery' ? 0.18
    : pattern === 'streaked' ? 0.35
    : pattern === 'plated' ? 0.4
    : pattern === 'furrowed' ? 0.5
    : 1.0;

  // 'streaked' inverts the polarity: the wood body is dark and the drawn
  // strokes are the LIT tan streaks running up it, each with a dark edge on its
  // shaded side. This is how the reference paints its trunk and roots, and it
  // is the opposite of carving dark grooves into pale wood.
  const streaked = pattern === 'streaked';

  // 'lobed' is the reference's own language: the wood is a bundle of rounded
  // finger-like lobes running along the form. Each lobe carries a bright warm
  // crest and falls away to a near-black seam against its neighbours. All the
  // detail is that relief - there is no surface noise at all - and the contrast
  // is extreme: a seam sits on the darkest step, a crest on the lightest.
  const lobed = pattern === 'lobed';
  // ~5-9 texels per lobe, so a trunk shows a readable handful of them
  const lobeCount = Math.max(5, Math.round(w / (4.4 - V * 1.3)));

  // plate cells for 'plated': bigger than the fibre cells, outlined
  const plateCellsU = Math.max(2, Math.round(w / (9 + V * 6)));
  const plateCellsV = Math.max(2, Math.round(h / (14 + V * 10)));

  // lit side of the trunk in texel space, for the 1-texel stroke highlight
  const litSign = Math.cos((p.lightAzimuth * Math.PI) / 180) >= 0 ? 1 : -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const fx = x / w;
      const fy = y / h;

      // base: big regions + a very low frequency zone (new vs deep old wood)
      const region = pcell(x, y, regionCellsU, regionCellsV, w, h, 0.8, seed + 41);
      const regionTone = hash1(region.id, 23);
      const zone = pfbm(fx * 2, fy * 2, seed + 303, 2, 2, 2);

      // A streaked trunk sits low on the ramp so the drawn streaks read as the
      // light; a carved trunk sits mid so the grooves read as the dark.
      let idx = (N - 1) * (streaked ? 0.28 : lobed ? 0.30 : 0.52);
      // Lobed wood gets almost no broad tonal drift: its whole character is the
      // lobe relief, and large soft regions on top of it only mud that up.
      const broad = lobed ? 0.3 : 1.0;
      idx += (regionTone - 0.5) * (1.15 + V * 0.7) * q * broad;
      idx += (zone - 0.5) * (0.8 + V * 0.5) * q * broad;

      let crevice = 0;
      let hi = 0;

      if (lobed) {
        // slow wander along v, so the lobes are not perfectly straight columns
        const wander = (pfbm(fy * 3, 0.37, seed + 71, 2, 3, 1) - 0.5) * (1.5 + V * 4.0);
        const lobeF = ((x + 0.5 + wander) / w) * lobeCount;
        const li = wrapInt(Math.floor(lobeF), lobeCount);
        const t = lobeF - Math.floor(lobeF); // 0..1 across this lobe
        const lh = hash1(li + 1, seed + 137);
        // the crest sits off-centre, nudged toward the light
        const crest = 0.5 + (lh - 0.5) * 0.3 + litSign * 0.1;
        const span = Math.max(0.18, Math.max(crest, 1 - crest));
        const across = Math.min(1, Math.abs(t - crest) / span);
        // +1 on the crest, -1 at the seams
        // Peaked, not linear: a linear falloff makes half of every lobe bright,
        // while the reference keeps a NARROW lit crest over a mostly dark lobe.
        const relief = 1 - 2 * Math.pow(across, 0.55);
        idx += relief * (1.5 + p.contrast * 1.2 + lh * 0.5) * q;
        if (relief > 0.62) hi = 1;
        // thick near-black seam between lobes
        const seamT = Math.min(t, 1 - t);
        if (seamT < 0.09 + V * 0.05) {
          idx -= (1.6 + p.shadow * 1.6) * q;
          crevice = 1;
          hi = 0;
        }
        // a few lobes end partway, leaving a shorter finger
        if (lh > 0.82) {
          const cut = 0.35 + hash1(li + 97, seed + 211) * 0.5;
          if (fy > cut) {
            const fade = Math.min(1, (fy - cut) / 0.12);
            idx -= fade * (1.2 + p.shadow) * q;
            crevice = Math.max(crevice, fade * 0.6);
          }
        }
      }

      // --- drawn strokes ---
      let inStroke = 0;
      let edge = 0;
      let edgeSign = 0;
      for (let i = 0; i < strokes.length; i++) {
        const st = strokes[i];
        if (fy < st.vStart || fy > st.vEnd) continue;
        const d = strokeOffset(st, x + 0.5, fy, w);
        const ad = Math.abs(d);
        // taper the ends so a stroke fades out instead of stopping square
        const endFade = Math.min(1, Math.min(fy - st.vStart, st.vEnd - fy) / 0.08);
        if (endFade <= 0) continue;
        if (ad <= st.halfWidth) {
          inStroke = Math.max(inStroke, st.depth * endFade);
        } else if (ad <= st.halfWidth + 1.05 && endFade > edge) {
          edge = endFade;
          edgeSign = d >= 0 ? 1 : -1;
        }
      }
      if (inStroke > 0) {
        if (streaked) {
          // the stroke IS the highlight: a raised ridge of sun-caught wood
          idx += (inStroke * 0.9 + p.highlights * 0.7) * q;
          hi = 1;
        } else {
          idx -= (inStroke + p.shadow * 0.7) * q;
          crevice = Math.min(1, inStroke / 2.2);
        }
      } else if (edge > 0) {
        if (streaked) {
          // one dark texel hugging the streak on its shaded side
          if (edgeSign === -litSign) {
            idx -= (0.95 + p.shadow * 0.9) * edge * q;
            crevice = 0.7;
          }
        } else if (edgeSign === litSign) {
          // the carved-groove highlight: one texel of the ramp's light end
          idx += (0.9 + p.highlights * 0.9) * edge * q;
          hi = 1;
        }
      }

      // --- pattern-specific detail -------------------------------------------
      if (pattern === 'plated') {
        const pl = pcell(x, y, plateCellsU, plateCellsV, w, h, 0.9, seed + 202);
        idx += (hash1(pl.id, 19) - 0.5) * 1.5 * q * fineAmount;
        const seam = (pl.d2 - pl.d1) / Math.max(1, pl.cw);
        if (seam < 0.1) {
          idx -= (1.4 + p.shadow) * q;
          crevice = Math.max(crevice, 0.8);
        }
      } else if (pattern === 'papery') {
        // Birch: lenticel dashes. They must stay ONE texel tall and a few
        // texels wide - binning both axes coarsely turns them into big squares.
        const dashSeed = hash2(Math.floor(x / (2 + Math.round(V * 2))), y, seed + 77);
        if (dashSeed > 0.93) {
          idx -= (2.2 + p.shadow * 1.2) * q;
          crevice = Math.max(crevice, 0.9);
        }
        const mott = pfbm(fx * 3, fy * 4, seed + 222, 2, 3, 4);
        idx += (mott - 0.5) * 0.7 * q * fineAmount;
      } else {
        // streaked / furrowed / flat / grain: a little elongated mottling,
        // scaled by how
        // much fine detail this language allows
        const mott = pfbm(fx * 6, fy * 3, seed + 222, 2, 6, 3);
        idx += (mott - 0.5) * (1.3 + V * 1.0) * q * fineAmount;
        if (pattern === 'grain') {
          // the only language that still gets real fibre banding
          const strandCellsU = Math.max(8, Math.round(w / (2.2 + V * 1.5)));
          const strandCellsV = Math.max(2, Math.round(h / (18 + V * 8)));
          const s = pcell(x, y, strandCellsU, strandCellsV, w, h, 0.65, seed + 101);
          idx += (hash1(s.id, 17) - 0.5) * (1.5 + V * 1.0) * q;
          const sseam = (s.d2 - s.d1) / Math.max(1, s.cw);
          if (sseam < 0.13 && hash1(s.id, 31) < 0.55) idx -= 0.9 * q;
        }
      }

      // a couple of small knots, drawn as 2-3 texel dark blobs with a lit rim
      const knotCell = pcell(x, y, 2, 3, w, h, 0.95, seed + 613);
      if (!lobed && hash1(knotCell.id, 57) < 0.16 + V * 0.12) {
        const kd = Math.hypot(
          strokeOffset({ u0: knotCell.fx, wander: 0, freq: 1, phase: 0, halfWidth: 0, depth: 0, vStart: 0, vEnd: 1 }, x + 0.5, fy, w),
          y + 0.5 - knotCell.fy
        );
        const kr = 1.1 + hash1(knotCell.id, 58) * 1.0;
        if (kd < kr) {
          idx -= (2.0 + p.shadow) * q;
          crevice = 1;
          hi = 0;
        } else if (kd < kr + 1.05) {
          idx += 0.8 * q;
        }
      }

      const iq = Math.min(N - 1, Math.max(0, Math.round(idx)));
      // G is a small-cell hash: it jitters the shader's light terminator and
      // thresholds the moss at texel scale, so both stay pixelated.
      const gHash = hash2(Math.floor(x / 2), Math.floor(y / 2), seed + 811);
      out[o + 0] = Math.round(iq * (255 / Math.max(1, N - 1)));
      out[o + 1] = Math.round(gHash * 255);
      out[o + 2] = Math.round(Math.min(1, crevice) * 127) + (hi ? 128 : 0);
      out[o + 3] = 255; // never < 255: see the premultiplied-alpha note above
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. CACHED TEXTURE SETS
// ---------------------------------------------------------------------------

export interface PixelFoliageTextures {
  structure: THREE.CanvasTexture;
  palette: THREE.CanvasTexture;
  steps: number;
  tileRes: number;
  params: PixelTextureParams;
}

export interface PixelBarkTextures {
  structure: THREE.CanvasTexture;
  palette: THREE.CanvasTexture;
  steps: number;
  params: PixelTextureParams;
}

interface CacheEntry<T> {
  key: string;
  value: T;
}

const MAX_CACHE = 6;
const foliageCache: CacheEntry<PixelFoliageTextures>[] = [];
const barkCache: CacheEntry<PixelBarkTextures>[] = [];
const colorAtlasCache: CacheEntry<THREE.CanvasTexture>[] = [];

function cacheGet<T>(cache: CacheEntry<T>[], key: string): T | null {
  for (let i = 0; i < cache.length; i++) {
    if (cache[i].key === key) {
      const hit = cache.splice(i, 1)[0];
      cache.unshift(hit);
      return hit.value;
    }
  }
  return null;
}

function cachePut<T>(cache: CacheEntry<T>[], key: string, value: T, dispose: (v: T) => void): T {
  cache.unshift({ key, value });
  while (cache.length > MAX_CACHE) {
    const evicted = cache.pop();
    if (evicted) dispose(evicted.value);
  }
  return value;
}

function paramKey(p: PixelTextureParams, species: string, extra: string): string {
  return [
    species,
    extra,
    p.seed,
    p.tileRes,
    p.barkWidth,
    p.barkHeight,
    p.steps,
    p.detail.toFixed(3),
    p.contrast.toFixed(3),
    p.shadow.toFixed(3),
    p.highlights.toFixed(3),
    p.clusterSize.toFixed(3),
    p.irregularity.toFixed(3),
    p.gaps.toFixed(3),
    p.barkVariation.toFixed(3),
    p.barkPattern,
    p.barkTexelsPerMetre.toFixed(2),
    p.barkTexelsPerLobe.toFixed(2),
    p.accent.toFixed(3),
    p.lightAzimuth.toFixed(1),
    p.lightElevation.toFixed(1),
  ].join('|');
}

export function getPixelFoliageTextures(config: TreeConfig): PixelFoliageTextures {
  const params = resolvePixelTextureParams(config);
  const d = speciesDefaults(config.species);
  const key = paramKey(params, config.species, `leaf:${config.foliageColorTop}:${config.foliageColorBottom}`);
  const hit = cacheGet(foliageCache, key);
  if (hit) return hit;

  const pixels = buildLeafStructureAtlas(params.tileRes, params.seed, params);
  const structure = makeNearestTexture(pixels, params.tileRes * 4, params.tileRes * 2);

  const main = buildFoliageRamp(config.foliageColorBottom, config.foliageColorTop, params.steps, {
    hueCold: d.hueCold,
    satBoost: (d as { satBoost?: number }).satBoost ?? 1,
    hueWarm: d.hueWarm,
    contrast: params.contrast,
    shadow: params.shadow,
  });
  // Accent ramp: same colours, hue pushed further, used by a small fraction of
  // clumps so the canopy carries colour variation without leaving the palette.
  const accent = buildFoliageRamp(config.foliageColorBottom, config.foliageColorTop, params.steps, {
    hueCold: d.hueCold + 26,
    hueWarm: d.hueWarm + 28,
    contrast: params.contrast,
    shadow: params.shadow,
    satBoost: 0.88,
  });
  const palette = buildPaletteTexture(main, accent);

  return cachePut(
    foliageCache,
    key,
    { structure, palette, steps: params.steps, tileRes: params.tileRes, params },
    (v) => {
      v.structure.dispose();
      v.palette.dispose();
    }
  );
}

/** The same authored moss palette on bark and stone; custom tints retain
 * its cool shadows, warm tips and limited ramp. */
export function buildPixelMossRamp(steps: number, lightHex = '#7ba33a'): RGB[] {
  return buildFoliageRamp('#2c3f16', lightHex, steps, {
    hueCold: 26, hueWarm: -8, contrast: 0.4, shadow: 0.5, satBoost: 0.82,
  });
}

export function getPixelBarkTextures(config: TreeConfig): PixelBarkTextures {
  const params = resolvePixelTextureParams(config);
  const key = paramKey(params, config.species, `bark:${config.barkColor}:${config.barkStyle}`);
  const hit = cacheGet(barkCache, key);
  if (hit) return hit;

  const pixels = makeBarkStructure(params.barkWidth, params.barkHeight, params.seed + 555, params);
  const structure = makeNearestTexture(pixels, params.barkWidth, params.barkHeight);
  structure.wrapS = THREE.RepeatWrapping;
  structure.wrapT = THREE.RepeatWrapping;
  structure.needsUpdate = true;

  const wood = buildWoodRamp(config.barkColor, params.steps, {
    contrast: params.contrast,
    shadow: params.shadow,
  });
  const moss = buildPixelMossRamp(params.steps);
  const palette = buildPaletteTexture(wood, moss);

  return cachePut(barkCache, key, { structure, palette, steps: params.steps, params }, (v) => {
    v.structure.dispose();
    v.palette.dispose();
  });
}

/**
 * Legacy-compatible atlas: the same pixel-art tiles, but already resolved to
 * colours, for the shaders that sample an albedo atlas directly (the conifer
 * needle foliage and the sapling leaf blades). Keeps those paths in the same
 * art direction without rewriting their materials.
 *   .rgb = palette colour, .g doubles as the lit mask those shaders expect,
 *   .a   = hard cutout.
 */
export function getPixelLeafColorAtlas(config: TreeConfig): THREE.CanvasTexture {
  const params = resolvePixelTextureParams(config);
  const d = speciesDefaults(config.species);
  const key = paramKey(params, config.species, `atlas:${config.foliageColorTop}:${config.foliageColorBottom}`);
  const hit = cacheGet(colorAtlasCache, key);
  if (hit) return hit;

  const w = params.tileRes * 4;
  const h = params.tileRes * 2;
  const structure = buildLeafStructureAtlas(params.tileRes, params.seed, params);
  const ramp = buildFoliageRamp(config.foliageColorBottom, config.foliageColorTop, params.steps, {
    hueCold: d.hueCold,
    satBoost: (d as { satBoost?: number }).satBoost ?? 1,
    hueWarm: d.hueWarm,
    contrast: params.contrast,
    shadow: params.shadow,
  });
  const n1 = ramp.length - 1;
  const resolved = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (structure[i * 4 + 3] === 0) {
      resolved[i * 4 + 3] = 0;
      continue;
    }
    const idx = Math.min(n1, Math.max(0, Math.round((structure[i * 4] / 255) * n1)));
    const c = ramp[idx];
    resolved[i * 4 + 0] = c[0];
    resolved[i * 4 + 1] = c[1];
    resolved[i * 4 + 2] = c[2];
    resolved[i * 4 + 3] = 255;
  }
  const tex = makeNearestTexture(resolved, w, h);
  return cachePut(colorAtlasCache, key, tex, (v) => v.dispose());
}

/**
 * A single resolved-colour cluster tile filling the whole 0..1 UV square, for
 * the meshes that sample one leaf image rather than a 4x2 atlas (saplings).
 * Same generator, same palette, so young trees match the adults.
 */
export function getPixelSingleLeafTexture(config: TreeConfig, variant = 0): THREE.CanvasTexture {
  const params = resolvePixelTextureParams(config);
  const d = speciesDefaults(config.species);
  const key = paramKey(params, config.species, `single${variant}:${config.foliageColorTop}:${config.foliageColorBottom}`);
  const hit = cacheGet(colorAtlasCache, key);
  if (hit) return hit;

  const res = params.tileRes;
  const structure = makeLeafClusterTile(res, variant, params.seed, params);
  const ramp = buildFoliageRamp(config.foliageColorBottom, config.foliageColorTop, params.steps, {
    hueCold: d.hueCold,
    satBoost: (d as { satBoost?: number }).satBoost ?? 1,
    hueWarm: d.hueWarm,
    contrast: params.contrast,
    shadow: params.shadow,
  });
  const n1 = ramp.length - 1;
  const resolved = new Uint8ClampedArray(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    if (structure[i * 4 + 3] === 0) {
      resolved[i * 4 + 3] = 0;
      continue;
    }
    const idx = Math.min(n1, Math.max(0, Math.round((structure[i * 4] / 255) * n1)));
    const c = ramp[idx];
    resolved[i * 4 + 0] = c[0];
    resolved[i * 4 + 1] = c[1];
    resolved[i * 4 + 2] = c[2];
    resolved[i * 4 + 3] = 255;
  }
  const tex = makeNearestTexture(resolved, res, res);
  return cachePut(colorAtlasCache, key, tex, (v) => v.dispose());
}

export function disposePixelTextureCaches(): void {
  foliageCache.splice(0).forEach((e) => {
    e.value.structure.dispose();
    e.value.palette.dispose();
  });
  barkCache.splice(0).forEach((e) => {
    e.value.structure.dispose();
    e.value.palette.dispose();
  });
  colorAtlasCache.splice(0).forEach((e) => e.value.dispose());
}

// ---------------------------------------------------------------------------
// 9. SHADERS
// ---------------------------------------------------------------------------

/**
 * Foliage vertex shader. Keeps the existing hierarchical wind flutter and the
 * clump-centric soft normal, and adds:
 *   vCardNdl    - the facing term of the WHOLE card (constant across the quad),
 *                 so a card steps between palette entries as one piece instead
 *                 of growing a smooth gradient across its surface;
 *   vCrownDepth - how deep inside the crown the card sits.
 * (The snow ramp is defined just below, ahead of the fragment shaders that
 * use it.)
 */
/**
 * Snow, drawn in the same terms as everything else: a fixed four-step ramp
 * (deep blue shade .. sunlit white) picked in whole steps, so snow never turns
 * into a gradient. Shared by the needles, the leaves, the bark and the sapling
 * leaves.
 */
const SNOW_GLSL = /* glsl */ `
  vec3 snowRamp(float i) {
    if (i < 0.5) return vec3(0.435, 0.529, 0.690);   // #6f87b0 deep shade
    if (i < 1.5) return vec3(0.643, 0.737, 0.859);   // #a4bcdb shade
    if (i < 2.5) return vec3(0.851, 0.906, 0.965);   // #d9e7f6 lit
    return vec3(0.973, 0.988, 1.0);                  // #f8fcff sunlit
  }
  float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`;

export const PIXEL_LEAF_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aClumpCenter;
  attribute float aAtlasIndex;
  attribute float aShade;
  attribute float aHueShift;
  attribute float aWindPhase;
  attribute float aWindStrength;
  attribute float aCrownDepth;
  attribute float aNeighborDensity;

  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uFlutterStrength;
  uniform vec3 uCanopyCenter;
  uniform vec3 uTexLightDir;
  uniform float uTileRes;

  varying vec2 vAtlasUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vShade;
  varying float vHueShift;
  varying float vCrownDepth;
  varying float vCardNdl;
  varying float vNeighbor;

  void main() {
    float col = mod(aAtlasIndex, 4.0);
    float row = floor(aAtlasIndex / 4.0);
    // half-texel inset stops a nearest fetch from straying into the next tile
    float inset = 0.5 / max(4.0, uTileRes);
    float safeU = mix(inset, 1.0 - inset, uv.x);
    float safeV = mix(inset, 1.0 - inset, uv.y);
    vAtlasUv = vec2((safeU + col) * 0.25, (safeV + (1.0 - row)) * 0.5);

    vShade = aShade;
    vHueShift = aHueShift;
    vCrownDepth = aCrownDepth;
    vNeighbor = aNeighborDensity;

    vec3 pos = position;
    float tipWeight = uv.y * uv.y;

    float swayX = sin(uTime * uWindSpeed * 1.25 + aWindPhase + pos.y * 0.22) * 0.08 * uWindStrength;
    float swayZ = cos(uTime * uWindSpeed * 1.05 + aWindPhase) * 0.07 * uWindStrength;
    pos.x += swayX * tipWeight;
    pos.z += swayZ * tipWeight;

    float flutter = sin(uTime * uWindSpeed * 5.2 + aWindPhase * 2.8 + pos.x * 3.5)
                  * cos(uTime * uWindSpeed * 3.8 + pos.z * 3.2)
                  * uFlutterStrength * aWindStrength * tipWeight;
    pos.x += flutter;
    pos.y += abs(flutter) * 0.25;
    pos.z += flutter * 0.60;

    vec4 localPos = instanceMatrix * vec4(pos, 1.0);
    vec4 worldPos = modelMatrix * localPos;
    vWorldPos = worldPos.xyz;

    vec3 worldClump = (modelMatrix * vec4(aClumpCenter, 1.0)).xyz;
    vec3 worldCrown = (modelMatrix * vec4(uCanopyCenter, 1.0)).xyz;
    vec3 outClump = normalize(worldPos.xyz - worldClump + vec3(0.0, 0.001, 0.0));
    vec3 outCrown = normalize(worldPos.xyz - worldCrown + vec3(0.0, 0.001, 0.0));
    vec3 softNorm = normalize(mix(outClump, outCrown, 0.35) + vec3(0.0, 0.20, 0.0));
    vNormal = softNorm;

    // per-CARD facing term: identical at every vertex of the quad
    vec4 cardMid = modelMatrix * instanceMatrix * vec4(0.0, 0.5, 0.0, 1.0);
    vec3 cardNrm = normalize(cardMid.xyz - worldClump + vec3(0.0, 0.001, 0.0));
    vec3 crownNrm = normalize(cardMid.xyz - worldCrown + vec3(0.0, 0.001, 0.0));
    vCardNdl = dot(normalize(mix(cardNrm, crownNrm, 0.85) + vec3(0.0, 0.25, 0.0)), normalize(uTexLightDir));

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const PIXEL_LEAF_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uStruct;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform float uAlphaTest;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uAccentAmount;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;
  uniform float uSnow;
  ${SNOW_GLSL}

  varying vec2 vAtlasUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vShade;
  varying float vHueShift;
  varying float vCrownDepth;
  varying float vCardNdl;
  varying float vNeighbor;

  void main() {
    vec4 s = texture2D(uStruct, vAtlasUv);
    if (s.a < uAlphaTest) discard;

    float N1 = uPaletteSteps - 1.0;
    float idx = floor(s.r * N1 + 0.5);   // the tone painted into the tile
    float exposure = s.b;                // texel-quantised, so bands stay crisp
    float clumpH = s.g;

    float heightN = clamp(
      (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY), 0.0, 1.0);

    // Geometry-driven tone, deliberately zero-centred: the tile's own hierarchy
    // survives and the shader only pushes it up or down a whole step at a time.
    float tone =
        vCardNdl * (0.65 + 0.15 * exposure)
      + (heightN - 0.50) * 0.65
      - vCrownDepth * (0.30 + uShadowStrength * 0.45)
      - vNeighbor * (0.12 + uShadowStrength * 0.20)
      + (vShade - 0.50) * 0.30
      + (exposure - 0.55) * 0.75
      + vHueShift * 0.45
      - uShadowStrength * 0.15;

    // Jitter the quantisation threshold with the clump hash: the light
    // terminator breaks along leaf-cluster borders instead of sweeping a
    // mathematically smooth curve across the canopy.
    tone += (clumpH - 0.5) * 0.55;

    float off = floor(tone * (0.85 + uTextureContrast * 0.75) + 0.5);
    off = clamp(off, -3.0, 3.0);
    idx = clamp(idx + off, 0.0, N1);

    // painted sparks keep their place at the top of the ramp
    if (clumpH > 0.975 && uHighlightAmount > 0.02) idx = max(idx, N1 - 1.0);

    float row = (clumpH < uAccentAmount * 0.20) ? ${PALETTE_ROW_ACCENT} : ${PALETTE_ROW_MAIN};
    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;

    // Snow settles on the top of the crown's outer leaves (the Hebra bush):
    // ragged along the leaf clusters, never inside the crown.
    if (uSnow > 0.001) {
      float sf = vNormal.y + (clumpH - 0.5) * 0.6 - vCrownDepth * 0.8 - (1.0 - uSnow) * 0.9;
      if (sf > 0.3) {
        float si = 2.0 + (vCardNdl > 0.2 ? 1.0 : 0.0) - (sf < 0.45 ? 1.0 : 0.0);
        col = snowRamp(si);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Conifer needle sprays. The pine's foliage is one merged mesh of flat spray
 * quads rather than instanced cards, and it used to go through its own smooth
 * material that read the pixel atlas's colours back as data and multiplied
 * them by a height gradient, a soft light term and sine stripes - which
 * flattened every painted light and dark into one murky green.
 *
 * This is the same structure-atlas + palette-LUT pipeline as the broadleaf
 * crowns, with the geometry terms a cone needs:
 *  - each spray is lit as ONE flat piece (its normal is constant), so the top
 *    of a shelf catches the light and its underside falls into shadow;
 *  - depth is measured across the CONE's tier at that height (aCrownDepth,
 *    from the generator): needles near the trunk dark, the rim of every tier
 *    light - the layered read a pine is drawn with. A spherical depth, as the
 *    broadleaf crowns use, calls almost every tuft of a tall narrow cone
 *    "deep" and paints the whole tree in its two darkest steps;
 *  - a per-tuft offset (aShade) so neighbouring tufts do not step in unison.
 * Everything is summed in whole palette steps, so no gradient reaches the
 * screen.
 */
export const PIXEL_CONIFER_VERTEX_SHADER = /* glsl */ `
  attribute float aCrownDepth;
  attribute float aShade;
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uTreeHeight;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vCrownDepth;
  varying float vShade;

  void main() {
    vUv = uv;
    vCrownDepth = aCrownDepth;
    vShade = aShade;
    vec3 pos = position;
    float heightFrac = clamp(position.y / uTreeHeight, 0.0, 1.0);
    float branchWave = sin(uTime * uWindSpeed * 1.45 + position.x * 0.65 + position.z * 0.55);
    float needleFlutter = sin(uTime * uWindSpeed * 3.1 + uv.y * 18.0 + position.x * 1.7);
    pos.x += branchWave * 0.13 * uWindStrength * heightFrac;
    pos.z += cos(uTime * uWindSpeed * 1.2 + position.y * 0.42) * 0.08 * uWindStrength * heightFrac;
    pos.y += needleFlutter * 0.018 * uWindStrength;

    vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPosition.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const PIXEL_CONIFER_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uStruct;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform float uAlphaTest;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uAccentAmount;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;
  uniform float uSnow;
  uniform float uTileTexels;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vCrownDepth;
  varying float vShade;
  ${SNOW_GLSL}

  // Snow lying along one spray, for a texel of its atlas cell (x across,
  // y from the root at 0 to the tip at uTileTexels): a drift heaped along the
  // spray's spine, thinning toward the tip so the needle ends stay green,
  // with a ragged per-texel edge.
  float snowField(vec2 t) {
    vec2 c = (t + 0.5) / uTileTexels;
    float spine = 1.0 - abs(c.x - 0.5) * 2.1;
    float along = 1.0 - smoothstep(0.62, 0.95, c.y);
    return spine * along + (snowHash(t + vShade * 61.0) - 0.5) * 0.3;
  }

  void main() {
    vec4 s = texture2D(uStruct, vUv);
    if (s.a < uAlphaTest) discard;

    float N1 = uPaletteSteps - 1.0;
    float idx = floor(s.r * N1 + 0.5);   // tone painted into the tile
    float exposure = s.b;
    float clumpH = s.g;

    // one flat normal per spray: the whole spray steps together
    vec3 n = normalize(vNormal);
    // Needle sprays transmit light on both sides, independently of the camera.
    float ndl = abs(dot(n, normalize(uTexLightDir))) * 0.65;

    float heightN = clamp(
      (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY), 0.0, 1.0);

    float tone =
        ndl * 1.35
      + (heightN - 0.45) * 0.80
      - vCrownDepth * (0.55 + uShadowStrength * 0.85)
      + (vShade - 0.5) * 0.70
      + (exposure - 0.55) * 0.75
      + (clumpH - 0.5) * 0.45;

    float off = floor(tone * (0.85 + uTextureContrast * 0.75) + 0.5);
    off = clamp(off, -3.0, 3.0);
    idx = clamp(idx + off, 0.0, N1);
    if (clumpH > 0.975 && uHighlightAmount > 0.02 && ndl > 0.2) idx = max(idx, N1 - 1.0);

    float row = (clumpH < uAccentAmount * 0.20) ? ${PALETTE_ROW_ACCENT} : ${PALETTE_ROW_MAIN};
    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;

    // Snow rests on the TOP of each spray only - seen from below, the needles
    // stay green - and less of it reaches the tufts deep inside a tier.
    if (uSnow > 0.001 && n.y > 0.05) {
      vec2 t = floor(fract(vUv * vec2(4.0, 2.0)) * uTileTexels);
      float thr = 1.0 - uSnow * (1.0 - vCrownDepth * 0.5);
      float f = snowField(t) + (clumpH - 0.5) * 0.25;
      if (f > thr) {
        // a lit top and a shaded lower rim where the drift ends, so it reads
        // as a heap with thickness rather than white paint
        float rim = (snowField(t + vec2(0.0, 1.0)) < thr
                  || snowField(t + vec2(1.0, 0.0)) < thr
                  || snowField(t - vec2(1.0, 0.0)) < thr) ? 1.0 : 0.0;
        float si = 2.0 + (ndl > 0.25 ? 1.0 : 0.0) - vCrownDepth * 1.6 - rim + (heightN > 0.6 ? 0.5 : 0.0);
        col = snowRamp(floor(clamp(si, 0.0, 3.0) + 0.5));
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createPixelConiferMaterial(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>,
  crownBottomY: number,
  crownTopY: number
): THREE.ShaderMaterial {
  const pix = getPixelFoliageTextures(config);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uStruct: { value: pix.structure },
      uPalette: { value: pix.palette },
      uPaletteSteps: { value: pix.steps },
      uAlphaTest: { value: config.alphaTest ?? 0.4 },
      uTexLightDir: { value: pixelTextureLightDir(pix.params) },
      uShadowStrength: { value: pix.params.shadow },
      uHighlightAmount: { value: pix.params.highlights },
      uTextureContrast: { value: pix.params.contrast },
      uAccentAmount: { value: pix.params.accent },
      uCrownBottomY: { value: crownBottomY },
      uCrownTopY: { value: crownTopY },
      uTreeHeight: { value: config.trunkHeight },
      uSnow: { value: THREE.MathUtils.clamp(config.snowCover ?? 0, 0, 1) },
      uTileTexels: { value: pix.tileRes },
    },
    vertexShader: PIXEL_CONIFER_VERTEX_SHADER,
    fragmentShader: PIXEL_CONIFER_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
}

/**
 * Bark vertex shader: the original trunk sway, plus the wood metrics the
 * fragment shader needs to lay its texel grid out in world units.
 */
export const PIXEL_BARK_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aWood;       // (ring radius m, arc length m, branch mean radius m)
  attribute vec2 aBarkAngle;  // (cos, sin) of the azimuth in the branch's own frame
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uBarkVScale;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vBarkUv;
  varying vec3 vWood;
  varying vec2 vBarkAngle;
  varying float vAngleU;

  void main() {
    vBarkUv = vec2(uv.x, uv.y * uBarkVScale);
    vAngleU = uv.x;
    vBarkAngle = aBarkAngle;
    vWood = aWood;
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

    vec3 pos = position;
    float heightFactor = clamp(pos.y / 12.0, 0.0, 1.0);
    pos.x += sin(uTime * uWindSpeed * 1.2 + pos.y * 0.15) * 0.08 * uWindStrength * heightFactor;
    pos.z += cos(uTime * uWindSpeed * 0.9 + pos.y * 0.15) * 0.05 * uWindStrength * heightFactor;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const PIXEL_BARK_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uStruct;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uMossAmount;
  uniform float uRootY;
  uniform float uTreeHeight;
  uniform float uRootSpread;
  uniform float uBarkVariation;
  uniform float uTextureSeed;
  // Analytic lobed bark: texels sized in metres instead of in UV space.
  uniform float uLobedMode;        // 1 = draw the lobes analytically
  uniform float uPlatedMode;       // 1 = break the lobes into staggered pine plates
  uniform float uTexelsPerMetre;   // apparent pixel size, in texels per metre
  uniform float uTexelsPerLobe;    // how many texels across one lobe
  uniform float uForcedLobes;      // >0 pins the ridge count (modelled ribs)
  uniform float uBarkDarkCoverage;
  uniform float uLitSign;
  // Shade cast by a dense crown on the wood inside it (0 = off). Set for the
  // pine, whose trunk and limbs run up through the middle of its needles
  // (a cone), and for the full broadleaf crowns (uCrownEllipsoid = 1: a
  // rounded mass centred at uCrownCenterY, uCrownRadius wide, uCrownRadiusY
  // tall).
  uniform float uCrownShade;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;
  uniform float uCrownRadius;
  uniform float uCrownEllipsoid;
  uniform float uCrownCenterY;
  uniform float uCrownRadiusY;
  // Snow lying on the upward-facing wood (0 = off): root flare, branch tops.
  uniform float uSnow;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vBarkUv;
  varying vec3 vWood;
  varying vec2 vBarkAngle;
  varying float vAngleU;

  float bhash(float n) { return fract(sin(n * 12.9898) * 43758.5453123); }
  float bhash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  ${SNOW_GLSL}

  // Smooth value noise, for the moss: sampled only at texel centres, so its
  // blobs come out as clusters of whole texels with ragged pixel edges.
  ${pixelMossNoiseGLSL('uTextureSeed')}

  void main() {
    float N1 = uPaletteSteps - 1.0;
    float qs = N1 / 5.0;

    float idx;
    float plateH;
    float crevice;
    float hiMask;
    // texel cell for the snow edge; the lobed path swaps in its metre grid
    vec2 snowTexel = floor(vBarkUv * vec2(48.0, 64.0));
    // Where this texel sits for the moss noise, and which way is "up the
    // wood" in that space (one texel). The lobed path wraps the texel grid
    // onto a circle so the noise runs on unbroken across the seam at angle 0.
    vec3 mossP = vec3(snowTexel, 0.0);
    vec3 mossUp = vec3(0.0, 1.0, 0.0);
    // 1 down in a furrow .. 0 on a ridge's crest: moss fills the furrows first
    float mossGroove = 0.5;

    if (uLobedMode > 0.5 && vWood.z > 0.001) {
      // ----------------------------------------------------------------------
      // Two things have to hold at once here, and they pull against each other:
      //
      //  * the RIDGES must run unbroken from root to tip. Their count therefore
      //    comes from vWood.z, one representative radius for the whole branch.
      //    Deriving it from each ring's own radius makes the count step as the
      //    wood tapers, and every step re-phases the pattern, so the ridges
      //    break and jump sideways - each stretch of trunk looking unrelated to
      //    the next. With a fixed count they just narrow as the wood narrows.
      //
      //  * the TEXELS must stay the same size. That grid is therefore built
      //    separately, in metres, from this ring's actual radius, and rounded
      //    to a whole number of texels around so it still closes with no seam.
      //
      // Decoupling them is what lets the ridges be continuous AND the pixels
      // uniform; tying the texel grid to the lobe count forces a choice.
      // ----------------------------------------------------------------------
      float r = max(0.02, vWood.x);
      float along = vWood.y;
      float rChain = vWood.z;
      float lobesPerMetre = uTexelsPerMetre / max(1.0, uTexelsPerLobe);
      // Linear in the radius, so a ridge is the same width in METRES on every
      // piece of wood: trunk, bough, stilt root. Anything sub-linear makes the
      // ridges of a thin part visibly finer than a thick one, and the tree
      // stops looking like it is made of one material. The count only stays
      // usable at this law because the radius handed in is weighted by surface
      // area rather than plainly averaged.
      float lobes = floor(6.2831853 * rChain * lobesPerMetre + 0.5);
      // A mesh whose ridges are already modelled in the geometry (a cactus and
      // its botanical ribs) pins the count, so the painted ridges sit on the
      // real ones instead of beating against them.
      if (uForcedLobes > 0.5) lobes = uForcedLobes;

      // Never fewer than a couple, never more than the texel budget can show:
      // a ridge narrower than about three texels has no room for a crest and
      // two seams, so on very thin wood the count gives way to the budget.
      //
      // The budget MUST come from the chain's radius, not from this ring's. Ring
      // radius changes along the wood, so a budget computed from it re-clamps
      // the count partway up the trunk, and every change of count re-phases the
      // ridges - which is the very misalignment this whole path exists to avoid.
      float texelsAroundChain = max(4.0, floor(6.2831853 * rChain * uTexelsPerMetre + 0.5));
      lobes = clamp(lobes, 2.0, min(16.0, max(2.0, floor(texelsAroundChain / 3.0))));

      // texel grid in metres from the ACTUAL ring radius, closed to a whole
      // number of texels around: this is what keeps the pixels a constant size
      float texelsAround = max(4.0, floor(6.2831853 * r * uTexelsPerMetre + 0.5));

      // slow, smooth drift so the lobes are not perfectly straight columns
      // (duas senoides em vez de sorteios por trecho de 1,8 m interpolados: o sorteio (bhash multiplica por 43758) mudava um pouco na divisa de um trecho
      // para o outro, por arredondamento da GPU, e deixava uma emenda horizontal no tronco; a senoide é contínua em qualquer altura)
      float aw = along * 0.55;
      float wph = uTextureSeed * 1.7;
      float wander = (sin(aw * 3.9 + wph) * 0.6 + sin(aw * 7.3 + wph * 2.3 + 1.7) * 0.4) * 0.5;

      // Reconstruct the azimuth from the interpolated (cos, sin) when the mesh
      // supplies it. Interpolating the angle itself breaks on any triangle that
      // straddles the 0/1 wrap.
      float angleU = vAngleU;
      if (dot(vBarkAngle, vBarkAngle) > 0.01) {
        angleU = atan(vBarkAngle.y, vBarkAngle.x) * 0.15915494 + 0.5;
      }

      float lobeF = angleU * lobes + wander * 0.7;
      float li = floor(lobeF);
      float t = fract(lobeF);

      float texelsPerLobeHere = max(2.0, texelsAround / lobes);
      float texU = floor(angleU * texelsAround);
      float texV = floor(along * uTexelsPerMetre);
      snowTexel = vec2(texU, texV);
      float mossA = 6.2831853 * (texU + 0.5) / texelsAround;
      float mossR = texelsAround / 6.2831853;
      mossP = vec3(cos(mossA) * mossR, sin(mossA) * mossR, texV);
      mossUp = vec3(0.0, 0.0, 1.0);
      // snap across-lobe onto that grid, so the shading steps in hard pixels
      float tq = (floor(t * texelsPerLobeHere) + 0.5) / texelsPerLobeHere;

      float lobeId = mod(li, lobes);
      float lh = bhash(lobeId * 7.13 + uTextureSeed);

      // narrow lit crest, offset toward the light, falling away steeply
      float lh2 = bhash(lobeId * 3.91 + uTextureSeed + 11.0);
      // crest and seam width both vary per lobe: identical lobes all round the
      // trunk read as machine corrugation, not as wood
      float crest = 0.5 + (lh - 0.5) * 0.44 + uLitSign * 0.08;
      float span = max(0.18, max(crest, 1.0 - crest));
      float across = min(1.0, abs(tq - crest) / span);
      // (jogo: expoente 0,85 em vez de 0,55: a parte clara/marrom de cada sulco fica mais larga, e a sombra preta mais estreita)
      float relief = 1.0 - 2.0 * pow(across, 0.85);
      mossGroove = clamp(0.5 - relief * 0.5, 0.0, 1.0);

      idx = N1 * 0.34;
      // plates are flatter than oak ridges: the column's round relief is
      // softened so the plate marks, not the ridge, carry the drawing
      float reliefGain = uPlatedMode > 0.5 ? 0.55 : 1.0;
      idx += relief * reliefGain * (1.5 + uTextureContrast * 1.2 + lh * 0.5) * qs;
      hiMask = relief > 0.5 ? 1.0 : 0.0;

      // Thick near-black seam between neighbouring lobes, measured in TEXELS so
      // it stays the same pixel width whether the ridge is wide at the root or
      // narrow near the tip.
      crevice = 0.0;
      float seamTexels = min(tq, 1.0 - tq) * texelsPerLobeHere;
      // pine plate columns are narrow, so their furrows are too: at the oak's
      // width the dark seams took half of every column
      float seamWidth = uPlatedMode > 0.5
        ? 0.55 + lh2 * 0.35
        : 0.9 + uBarkVariation * 0.5 + lh2 * 0.5;
      seamWidth *= uBarkDarkCoverage * 1.6;
      if (seamTexels < seamWidth) {
        idx -= (1.6 + uShadowStrength * 1.6) * qs;
        crevice = 1.0;
        hiMask = 0.0;
      }

      // Every per-ridge variation below is keyed on the LOBE ALONE, never on
      // the position along it. Anything that changes along the ridge - tonal
      // blocks, a terminator jitter re-rolled every few texels, ridges that
      // stop partway - steps the ridge's tone at regular intervals once it is
      // quantised, and the ridge reads as a row of dashes instead of one
      // continuous groove running the length of the branch. Neighbouring
      // ridges still differ from each other, which is what keeps the bark
      // from looking machine-made.

      // per-ridge tonal offset
      float zoneH = bhash(lobeId * 9.7 + uTextureSeed * 3.1);
      idx += (zoneH - 0.5) * (0.45 + uBarkVariation * 0.35) * qs;

      // Hash used below to break the light terminator and to threshold the
      // moss: one value per ridge, so the terminator steps between ridges
      // rather than wandering over the texels of one.
      plateH = bhash(lobeId * 5.1 + uTextureSeed * 2.0);

      // ---- pine plates -----------------------------------------------------
      // Pine bark is not a run of continuous ridges: each narrow column between
      // the vertical furrows is broken into stacked plates, and the plates of
      // neighbouring columns do not line up. Each plate gets its own tone, a
      // dark crack along its foot (stepping a texel up or down across the
      // column, so it reads as a drawn crack rather than a ruled line), a
      // shaded row above that, and a light top edge where the flake lifts and
      // catches the sun.
      if (uPlatedMode > 0.5) {
        float plen = 6.0 + floor(bhash(lobeId * 2.7 + uTextureSeed + 3.0) * 6.0); // 6..11 texels
        float stagger = floor(bhash(lobeId * 6.1 + uTextureSeed + 9.0) * plen);
        // ONE step per crack, at a point chosen per column - re-rolling the
        // step for every texel column zig-zagged the crack into a checkerboard
        float crackSplit = 0.3 + bhash(lobeId * 8.3 + uTextureSeed + 1.0) * 0.4;
        float jag = tq > crackSplit ? 1.0 : 0.0;
        float pv = texV + stagger + jag;
        float plateIdx = floor(pv / plen);
        float inPlate = pv - plateIdx * plen;                 // 0 = foot .. plen-1 = top
        float plateTone = bhash(lobeId * 4.3 + plateIdx * 1.91 + uTextureSeed);
        if (crevice < 0.5) {
          idx += (plateTone - 0.5) * 1.1 * qs;
          if (inPlate < 0.5 && plateTone > 0.1) {
            idx -= (1.4 + uShadowStrength * 1.2) * qs;       // crack at the plate's foot
            crevice = 0.8;
            hiMask = 0.0;
          } else if (inPlate < 1.5) {
            idx -= 0.6 * qs;                                  // tucked under the plate below's lip
          } else if (inPlate > plen - 1.5) {
            idx += (0.8 + uHighlightAmount * 0.6) * qs;       // lifted top edge in the light
            hiMask = 1.0;
          }
        }
        plateH = plateTone;
      }
      idx = floor(idx + 0.5);
    } else {
      // Texture path, for the bark languages that are painted on the CPU.
      vec4 s = texture2D(uStruct, vBarkUv);
      idx = floor(s.r * N1 + 0.5);
      plateH = s.g;
      // B packs two signals: the high bit is the lit-ridge flag, the low 7 bits
      // are the crevice depth. Exact under NEAREST with no mipmaps.
      float packed = floor(s.b * 255.0 + 0.5);
      hiMask = step(127.5, packed);
      crevice = (packed - hiMask * 128.0) / 127.0;
      mossGroove = 0.35 + crevice * 0.65;
    }

    vec3 N = normalize(vNormal);
    float ndl = dot(N, normalize(uTexLightDir));
    float heightN = clamp((vWorldPos.y - uRootY) / max(1.0, uTreeHeight), 0.0, 1.0);
    // The dark well between the roots: only the downward-facing surfaces of the
    // buttress flare, and only very close to the ground.
    float rootWell = (1.0 - smoothstep(0.0, 0.08, heightN))
                   * clamp(-N.y, 0.0, 1.0)
                   * (0.5 + uRootSpread * 0.3);

    // How much of the crown's needles stand between this bit of wood and the
    // sky: full inside the crown band, fading out at its bottom and top, and
    // weaker toward the rim of the cone at that height - a limb's tip that
    // reaches the edge of the foliage catches some light, the trunk up the
    // middle gets none.
    float crownCover = 0.0;
    if (uCrownShade > 0.001 && uCrownEllipsoid > 0.5) {
      // A broadleaf crown is a rounded mass, not a cone: the cover is deepest
      // at its heart and eases off toward its surface, so the limbs darken as
      // they climb into the leaves and their tips at the rim stay lit. The
      // trunk below the crown sits outside the mass and is untouched.
      vec3 q = vec3(
        vWorldPos.x / max(0.5, uCrownRadius),
        (vWorldPos.y - uCrownCenterY) / max(0.5, uCrownRadiusY),
        vWorldPos.z / max(0.5, uCrownRadius));
      crownCover = (1.0 - smoothstep(0.35, 1.0, length(q))) * uCrownShade;
    } else if (uCrownShade > 0.001) {
      float ch = (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY);
      // eased in over the lower part of the crown: the needles thicken
      // gradually, and a short ramp drew a hard dark band across the trunk
      float band = smoothstep(-0.2, 0.3, ch) * (1.0 - smoothstep(0.86, 1.0, ch));
      float tierR = max(0.4, uCrownRadius * pow(max(0.05, 1.0 - 0.76 * clamp(ch, 0.0, 1.0)), 0.82));
      float radialF = length(vWorldPos.xz) / tierR;
      crownCover = band * (1.0 - smoothstep(0.45, 1.05, radialF)) * uCrownShade;
    }

    float tone =
        ndl * 1.10 * (1.0 - crownCover * 0.75)   // the sun barely reaches it
      - crevice * (1.05 + uShadowStrength * 1.5)
      - rootWell * (0.9 + uShadowStrength * 0.8)
      + (heightN - 0.30) * 0.50
      + hiMask * uHighlightAmount * 0.80 * (1.0 - crownCover)
      - crownCover * (1.6 + uShadowStrength * 0.8);

    // Jitter so the terminator wanders along the bark's own shapes rather than
    // drawing a clean curve around the trunk. Kept well under a full step: any
    // larger and it stops breaking the terminator and starts repainting flat
    // areas on its own.
    tone += (plateH - 0.5) * 0.28;

    float off = floor(tone * (0.85 + uTextureContrast * 0.7) + 0.5);
    // Asymmetric clamp: the deepest wood step is reserved for real crevices and
    // the root well. Letting the light term alone reach it turns whole patches
    // of the shadow side into flat near-black blotches.
    // ...except under a dense crown, where the wood genuinely is that dark
    off = clamp(off, -2.0 - floor(crownCover * 1.5 + 0.5), 3.0);
    idx = clamp(idx + off, 0.0, N1);

    // Keep the darkest tones in narrower grooves; the rest becomes mid brown.
    if (uBarkDarkCoverage < 1.0 && crevice < 0.5) {
      idx = max(idx, floor((1.0 - uBarkDarkCoverage) * N1 * 0.7 + 0.5));
    }

    // Moss. It used to be switched on a whole ridge (or plate) at a time, so it
    // came out as long random green stripes. It grows in cushions instead: a
    // noise field on the texel grid, thresholded per texel by how much moss
    // this spot wants - most near the ground, on the damp shaded side and on
    // surfaces facing up (the tops of the root flare), and first down in the
    // furrows, where it creeps out from. Its own tones: the cushion is lit on
    // top and shaded along its lower edge, so it reads as growth on the bark
    // rather than green paint.
    //
    // It also follows the bark's relief (mossGroove, 1 in a furrow .. 0 on a
    // crest): it settles more readily in the furrows than on the crests, and
    // inside a cushion the crests stay lighter and the furrows darker, so the
    // ridges still read through the green instead of it lying on the roots as
    // one flat sheet.
    float damp = clamp(dot(N, vec3(0.0, 0.25, -0.95)), 0.0, 1.0);
    float up = clamp(N.y, 0.0, 1.0);
    // capped, so even the mossiest roots (Korok, mangrove) stay a patchwork
    // of cushions with bark between them instead of one green lawn
    float mossWant = min(0.5,
        pow(1.0 - heightN, 2.2) * (0.1 + damp * 0.45 + up * 0.3) * uMossAmount * 2.0
      + crevice * 0.15 * uMossAmount)
      * (0.55 + mossGroove * 0.9);
    float row = ${PALETTE_ROW_MAIN};
    if (mossWant > 0.04 && mossField(mossP) < mossWant) {
      row = ${PALETTE_ROW_ACCENT};
      bool topEdge = mossField(mossP + mossUp) >= mossWant;
      bool bottomEdge = mossField(mossP - mossUp) >= mossWant;
      // tone varies across a cushion in soft patches, not texel by texel
      float mi = N1 * 0.35 + (ndl > 0.15 ? qs * 0.8 : -qs * 0.6) - crownCover * qs * 1.5
               + (mnoise3(mossP / 3.0 + 41.0) - 0.5) * qs * 1.6
               + (0.5 - mossGroove) * qs * 2.4;              // crests lighter, furrows darker
      if (topEdge) mi += qs * 1.0;
      if (bottomEdge) mi -= qs * 1.2;
      idx = clamp(floor(mi + 0.5), 0.0, N1);
    }

    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;

    // Snow: only where the wood faces the sky and the crown does not cover it,
    // with a ragged per-texel edge, in the shared snow ramp.
    if (uSnow > 0.001) {
      float sf = N.y + (bhash2(snowTexel + uTextureSeed) - 0.5) * 0.35
               - (1.0 - uSnow) * 0.6 - crownCover * 0.9;
      if (sf > 0.42) {
        float si = 2.0 + (ndl > 0.2 ? 1.0 : 0.0) - (sf < 0.6 ? 1.0 : 0.0);
        col = snowRamp(si);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Blade fragment shader, for the foliage that is modelled as individual leaf
 * blades / fronds instead of atlas cards (the mangrove rosettes, the palm
 * fronds). It has no texture to sample, so it pixelates the blade itself:
 * every term is evaluated on a texel grid derived from the blade's own UV, then
 * quantised into the same palette LUT the rest of the tree uses. Needs only
 * vNormal / vWorldPos / vUv, which both of those vertex shaders already emit.
 */
export const PIXEL_BLADE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uAccentAmount;
  uniform float uDetailDensity;
  uniform vec2 uBladeTexels;
  uniform float uTextureSeed;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  float bladeHash(vec2 cell, float s) {
    float h = dot(floor(cell), vec2(127.1, 311.7)) + s * 0.137;
    return fract(sin(h) * 43758.5453);
  }

  void main() {
    // Snap to the blade's texel grid first: every tone below is decided per
    // texel, which is what keeps the pixels square and hard-edged.
    vec2 cell = floor(vUv * uBladeTexels);
    vec2 quv = (cell + 0.5) / uBladeTexels;

    float sparkH = bladeHash(cell, uTextureSeed);
    // neighbouring texels share a tone in small groups -> leaf clusters, not static
    float groupH = bladeHash(floor(vUv * uBladeTexels / (2.0 + uDetailDensity * 1.6)), uTextureSeed + 17.0);

    float N1 = uPaletteSteps - 1.0;
    vec3 N = normalize(vNormal);
    float ndl = dot(N, normalize(uTexLightDir));
    float heightN = clamp(
      (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY), 0.0, 1.0);

    // dark at the stem, light toward the tip
    float tone = 0.22 + quv.y * 0.56;
    tone += ndl * 0.26;
    tone += (heightN - 0.5) * 0.16;
    tone += (groupH - 0.5) * 0.26;
    tone -= uShadowStrength * 0.12;

    // lit midrib down the centre of the blade
    float rib = 1.0 - min(1.0, abs(quv.x - 0.5) * uBladeTexels.x * 0.55);
    tone += rib * (0.09 + uHighlightAmount * 0.13);
    // darker margins
    tone -= step(0.84, abs(quv.x - 0.5) * 2.0) * (0.15 + uShadowStrength * 0.18);

    float t = clamp(0.5 + (tone - 0.5) * (1.0 + uTextureContrast * 0.8), 0.0, 1.0);
    float idx = floor(t * N1 + 0.5);
    if (sparkH > 0.985 && uHighlightAmount > 0.02) idx = N1;
    idx = clamp(idx, 0.0, N1);

    float row = (groupH < uAccentAmount * 0.18) ? ${PALETTE_ROW_ACCENT} : ${PALETTE_ROW_MAIN};
    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Uniform block for PIXEL_BLADE_FRAGMENT_SHADER. `bladeTexels` says how many
 * texels one blade is divided into across x and along y.
 */
export function createPixelBladeUniforms(
  config: TreeConfig,
  crownBottomY: number,
  crownTopY: number,
  bladeTexels: THREE.Vector2
): Record<string, THREE.IUniform> {
  const foliage = getPixelFoliageTextures(config);
  const p = foliage.params;
  return {
    uPalette: { value: foliage.palette },
    uPaletteSteps: { value: foliage.steps },
    uTexLightDir: { value: pixelTextureLightDir(p) },
    uShadowStrength: { value: p.shadow },
    uHighlightAmount: { value: p.highlights },
    uTextureContrast: { value: p.contrast },
    uAccentAmount: { value: p.accent },
    uDetailDensity: { value: p.detail },
    uBladeTexels: { value: bladeTexels },
    uTextureSeed: { value: (p.seed % 4096) * 0.0177 },
    uCrownBottomY: { value: crownBottomY },
    uCrownTopY: { value: crownTopY },
  };
}

/**
 * Succulent (cactus) vertex shader. Same heavy, rigid sway as the original
 * cactus material, plus the stem's own frame so the fragment shader can
 * rebuild each rib's surface normal analytically, once per texel.
 */
export const PIXEL_SUCCULENT_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aWood;       // (ring radius m, arc length m, stem representative radius m)
  attribute vec2 aBarkAngle;  // (cos, sin) of the ring angle in the stem frame
  attribute vec3 aAxisN;      // stem frame normal   (radial = cos*N + sin*B)
  attribute vec3 aAxisB;      // stem frame binormal
  attribute vec2 aSucc;       // (dome angle phi: 0 on the column, pi/2 at the apex; stem base height)
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uTreeHeight;
  varying vec3 vWorldPos;
  varying vec3 vWood;
  varying vec2 vBarkAngle;
  varying vec3 vAxisN;
  varying vec3 vAxisB;
  varying vec2 vSucc;

  void main() {
    vWood = aWood;
    vBarkAngle = aBarkAngle;
    vAxisN = (modelMatrix * vec4(aAxisN, 0.0)).xyz;
    vAxisB = (modelMatrix * vec4(aAxisB, 0.0)).xyz;
    vSucc = aSucc;

    vec3 pos = position;
    float hf = clamp(pos.y / max(1.0, uTreeHeight), 0.0, 1.0);
    float sway = pow(hf, 1.8) * uWindStrength * 0.12;
    pos.x += sin(uTime * uWindSpeed * 1.2 + pos.y * 0.3) * sway;
    pos.z += cos(uTime * uWindSpeed * 0.9 + pos.y * 0.25) * sway * 0.6;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/**
 * Succulent fragment shader: a cactus drawn the way a pixel artist draws one.
 *
 * The rib IS the unit of the drawing. Every rib is split into a whole number
 * of texel columns with the groove centred on one column and the crest on
 * another, so each rib reads as: dark groove | flank | crest | flank. Each
 * column is lit with the normal the modelled rib actually has at that column's
 * centre - rebuilt analytically from the stem frame, not interpolated - so one
 * flank of every rib catches the light and the other falls into shadow, and the
 * whole column steps as a single flat pixel. That per-rib light/shadow pair is
 * what gives the relief; a cylinder lit smoothly with a stripe painted on top
 * (what the bark path produced here) has none.
 *
 * On top of that: areoles as cream dots with a dark spine shadow beneath them,
 * spaced along the crests with a per-rib stagger; woody corking at the foot of
 * the column; a dark contour where the ribs turn away from the viewer; and the
 * ribs fading out over the dome so the apex reads as a lit cap.
 */
export const PIXEL_SUCCULENT_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uDetailDensity;
  uniform float uBarkVariation;
  uniform float uTextureSeed;
  uniform float uTreeHeight;
  uniform float uRibs;          // modelled rib count
  uniform float uRibDepth;      // modelled rib depth (fraction of the radius)
  uniform float uTexelSize;     // texel size in metres, shared by every stem
  uniform float uCorkHeight;    // height of the woody foot, metres

  varying vec3 vWorldPos;
  varying vec3 vWood;
  varying vec2 vBarkAngle;
  varying vec3 vAxisN;
  varying vec3 vAxisB;
  varying vec2 vSucc;

  float shash(float n) { return fract(sin(n * 12.9898 + uTextureSeed * 3.17) * 43758.5453123); }
  float shash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uTextureSeed * 1.91) * 43758.5453123); }

  void main() {
    float N1 = uPaletteSteps - 1.0;
    float TAU = 6.2831853;

    float rChain = max(0.05, vWood.z);
    float along = vWood.y;
    float phi = vSucc.x;
    float domeFade = cos(phi);                 // 1 on the column, 0 at the apex

    // ---- texel grid ---------------------------------------------------------
    // Columns per rib from this stem's radius, so a texel is the same size in
    // metres on the trunk and on the thinner arms. Constant along the stem, so
    // the columns never re-phase. Rows use the same size: square pixels.
    float K = clamp(floor(TAU * rChain / (uRibs * uTexelSize) + 0.5), 3.0, 8.0);
    float theta = atan(vBarkAngle.y, vBarkAngle.x);
    float ribF = theta / TAU * uRibs;           // crest at integers (cos(ribs*theta) = 1)
    float s = fract(ribF + 0.5);                // 0 / 1 = groove, 0.5 = crest
    float colU = floor(s * K + 0.5);            // 0..K, both ends centred on a groove
    float col = mod(colU, K);                   // column 0 is the groove
    float ribId = floor(ribF + 0.5);
    ribId = mod(ribId + uRibs, uRibs);
    // column centre in the same 0..1, NOT wrapped: the groove column at the far
    // side of this rib must be lit with that groove's normal, not the near one's
    float sc = colU / K;
    float thetaC = (ribId - 0.5 + sc) / uRibs * TAU;
    float row = floor(along / uTexelSize);

    // ---- per-texel normal of the modelled rib -------------------------------
    vec3 N0 = normalize(vAxisN);
    vec3 B0 = normalize(vAxisB);
    vec3 T0 = normalize(cross(N0, B0));
    vec3 radial = cos(thetaC) * N0 + sin(thetaC) * B0;
    vec3 circ   = -sin(thetaC) * N0 + cos(thetaC) * B0;
    float d = uRibDepth * domeFade;
    float slope = -d * uRibs * sin(uRibs * thetaC) / (1.0 + d * cos(uRibs * thetaC));
    // exaggerated a little: a stylised rib reads by its lit/shadow flank pair
    vec3 nCol = normalize(radial - slope * 1.35 * circ);
    vec3 n = normalize(nCol * domeFade + T0 * sin(phi));

    vec3 L = normalize(uTexLightDir);
    float ndl = dot(n, L);
    float facing = ndl; // Painted shading follows the sun, not the camera.

    bool isGroove = col < 0.5 && domeFade > 0.35;
    // exactly one crest column per rib, even when K is odd
    bool isCrest = abs(col - floor(K * 0.5)) < 0.5 && domeFade > 0.35;

    // ---- tone, in palette steps ---------------------------------------------
    float qs = N1 / 5.0;
    float tone = ndl * (1.25 + uTextureContrast * 0.9);

    // height, sampled on the ROW so it can only change on a texel boundary
    float heightN = clamp((vSucc.y + (row + 0.5) * uTexelSize) / max(1.0, uTreeHeight), 0.0, 1.0);
    tone += (heightN - 0.45) * 0.9;

    // the groove is always the darkest thing on the rib
    if (isGroove) tone -= 1.3 + uShadowStrength * 1.1;

    // a lit crest gets one extra step: the pixel artist's highlight line
    // ---- skin ---------------------------------------------------------------
    // A rib drawn as flat columns of one tone from foot to tip reads as a
    // plastic tube, and at a fine pixel size that is all there is to see. The
    // skin gets the marks a pixel artist adds to a cactus, all keyed on runs
    // of rows (never single texels, so none of it can turn into static):
    float side = sc < 0.5 ? 0.0 : 1.0;                 // which flank of the rib
    float runLen = 5.0 + floor(shash(ribId * 3.1 + side) * 7.0);
    float runId = floor((row + shash(ribId + side * 17.0) * 11.0) / runLen);
    float patchH = shash(ribId * 7.31 + side * 29.0 + runId * 1.73);

    // (1) mottled patches on the flanks, one palette step either way
    if (!isGroove && !isCrest) tone += (patchH - 0.5) * 0.95;

    // (2) a crest highlight broken into dashes rather than a ruled line
    float crestRun = shash(ribId * 5.9 + floor(row / 4.0) * 2.3);
    if (isCrest && ndl > 0.15 && crestRun > 0.3) tone += 0.55 + uHighlightAmount * 0.9;

    // (3) checker dither where a lit flank meets the crest: two tones
    // interleave across the edge instead of meeting in a straight seam
    bool nextToCrest = abs(col - floor(K * 0.5)) < 1.5 && !isCrest && !isGroove;
    if (nextToCrest && patchH > 0.45 && mod(row + col, 2.0) < 0.5) {
      tone += ndl > 0.0 ? 0.5 : -0.5;
    }

    // silhouette contour where the ribs turn away from the viewer
    if (facing < 0.22) tone -= 0.9 + uShadowStrength * 0.6;

    // Per-rib variation held for long runs of rows: some ribs a touch paler or
    // deeper, so the column does not read as machine corrugation. A fixed
    // amplitude: it must not vanish when the bark variation slider is at 0.
    float runH = shash(ribId * 7.31 + floor(row / (9.0 + shash(ribId) * 9.0)) * 1.73);
    tone += (runH - 0.5) * 0.45;

    float idx = floor(N1 * 0.46 + tone * qs * 1.1 + 0.5);
    idx = clamp(idx, 0.0, N1);
    float paletteRow = 0.75; // main green ramp

    // ---- woody corking at the foot ------------------------------------------
    float worldY = vSucc.y + (row + 0.5) * uTexelSize;
    float corkEdge = uCorkHeight * (0.55 + shash(ribId * 3.3 + 1.0) * 0.9);
    if (worldY < corkEdge && domeFade > 0.9) {
      paletteRow = 0.25;
      float ci = floor(N1 * 0.34 + ndl * 1.1 * qs + (isGroove ? -1.0 : 0.0) + 0.5);
      // broken top edge: a few texels of green bite down into the cork
      if (worldY > corkEdge - uTexelSize * 2.0 && shash2(vec2(ribId * 4.0 + col, row)) > 0.5) {
        paletteRow = 0.75;
      } else {
        idx = clamp(ci, 0.0, N1 - 1.0);
      }
    }

    // ---- areoles along the crests -------------------------------------------
    // One cream pixel every few rows on each crest, staggered per rib, with the
    // dark shadow of its spine cluster on the row below.
    float spacing = floor(mix(11.0, 6.0, uDetailDensity) + 0.5);
    float stagger = floor(shash(ribId * 11.7 + 5.0) * spacing);
    float slot = mod(row + stagger, spacing);
    if (isCrest && domeFade > 0.8 && paletteRow > 0.5 && facing > 0.22) {
      if (slot < 0.5) {
        paletteRow = 0.25;
        idx = ndl > -0.1 ? N1 : N1 - 1.0;
      } else if (slot < 1.5) {
        idx = max(0.0, idx - 2.0);
      }
    }

    vec3 colr = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, paletteRow)).rgb;
    gl_FragColor = vec4(colr, 1.0);
  }
`;

const succulentPaletteCache = new Map<string, THREE.CanvasTexture>();

// ---------------------------------------------------------------------------
// SAPLINGS
// ---------------------------------------------------------------------------

type SaplingLeafShape = 'oak' | 'ovate' | 'serrated' | 'round' | 'lance' | 'ellipse' | 'needles' | 'pinnate';

function saplingLeafShapeFor(species: string): SaplingLeafShape {
  if (species.startsWith('akkala_birch')) return 'serrated';
  if (species.startsWith('satori_sakura')) return 'ovate';
  if (species.startsWith('korok_ancient')) return 'round';
  if (species.startsWith('faron_palm')) return 'lance';
  if (species.startsWith('swamp_mangrove')) return 'ellipse';
  if (species.startsWith('hebra_pine')) return 'needles';
  if (species.startsWith('savanna_acacia')) return 'pinnate';
  return 'oak';
}

const saplingLeafCache = new Map<string, THREE.CanvasTexture>();

/**
 * One sapling leaf, drawn as a pixel sprite: 16 x 24 texels, base at the
 * bottom centre (where the petiole meets it), tip at the top. It holds the
 * leaf's own TONE (R, 0..1, mapped to a palette step by the shader) and its
 * silhouette (A), not colour - the same structure + palette split as the
 * crowns, so a sapling reads in the same art direction as its adult tree.
 *
 * Saplings used to stretch a whole CROWN tile (a clump of many leaves) over
 * each leaf quad, which read as green blobs floating round the stem.
 */
export function buildPixelSaplingLeafPixels(config: TreeConfig) {
  const shape = saplingLeafShapeFor(config.species);

  const W = 16;
  const H = 24;
  const out = new Uint8ClampedArray(W * H * 4);
  const seed = Math.floor(config.seed ?? 0);

  const halfWidth = (v: number): number => {
    if (v < 0.1) return shape === 'needles' ? 0.0 : 0.07;        // petiole stub
    const vv = (v - 0.1) / 0.9;                                   // 0 at blade base, 1 at tip
    const body = Math.sin(Math.PI * Math.min(1, vv));
    switch (shape) {
      case 'oak':
        return 0.42 * Math.pow(body, 0.7) * (0.7 + 0.3 * Math.abs(Math.sin(vv * Math.PI * 3.5)));
      case 'serrated':
        return 0.4 * Math.pow(body, 0.8) * (1 - 0.3 * vv * vv) * (Math.floor(vv * 14) % 2 === 0 ? 1 : 0.86);
      case 'ovate':
        return 0.42 * Math.pow(body, 0.75) * (1 - 0.4 * vv * vv * vv);
      case 'round':
        return 0.47 * Math.sqrt(body);
      case 'lance':
        return 0.44 * Math.pow(body, 0.55) * (1 - vv * 0.55);
      case 'ellipse':
        return 0.44 * Math.pow(body, 0.6);
      default:
        return 0;
    }
  };
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const u = (x + 0.5) / W - 0.5;
    const v = (y + 0.5) / H;
    if (shape === 'needles') {
      // a fan of needles radiating from the base
      const bx = 0, by = 0.06;
      const dx = u - bx, dy = v - by;
      if (dy <= 0) return Math.abs(u) < 0.07 && v < 0.1;
      const ang = Math.atan2(dx, dy);
      const len = Math.hypot(dx * 1.5, dy);
      const needles = 7;
      const spread = 0.62;
      const k = Math.round(((ang / spread) * 0.5 + 0.5) * (needles - 1));
      if (k < 0 || k >= needles) return false;
      const target = ((k / (needles - 1)) * 2 - 1) * spread;
      const reach = 0.72 + hash1(k * 5 + 1, seed) * 0.24;
      return Math.abs(ang - target) * len < 0.035 + 0.02 * (1 - len) && len < reach;
    }
    if (shape === 'pinnate') {
      // acacia: a one-texel rachis up the middle, lined on every other row
      // with a pair of tiny leaflets that shorten toward the tip
      if (Math.abs(u) < 0.5 / W + 0.001) return v < 0.96;
      if (v < 0.12 || v > 0.94 || y % 2 === 1) return false;
      return Math.abs(u) <= 0.44 * (1 - 0.55 * (v - 0.12) / 0.82);
    }
    return Math.abs(u) <= halfWidth(v);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = ((H - 1 - y) * W + x) * 4; // canvas rows run top-down; v runs up
      if (!inside(x, y)) {
        out[o + 3] = 0;
        continue;
      }
      const u = (x + 0.5) / W - 0.5;
      const v = (y + 0.5) / H;
      const vv = Math.max(0, (v - 0.1) / 0.9);
      let t = 0.5;
      if (v < 0.1 && shape !== 'needles') {
        t = 0.3;                                                   // petiole stub
      } else if (shape === 'needles') {
        t = 0.38 + vv * 0.34 + (u < 0 ? 0.08 : 0);                 // darker at the base, light tips
      } else {
        if (u < 0) t += 0.12;                                      // the half that faces the light
        if (vv > 0.8) t += 0.08;                                   // fresh, lighter tip
        if (vv < 0.2) t -= 0.1;                                    // shaded near the stalk
        if (Math.abs(u) < 0.5 / W + 0.001) t -= 0.14;              // midrib
        else if (((vv * 6 - Math.abs(u) * 1.4) % 1 + 1) % 1 < 0.13) t -= 0.08; // lateral veins
        // (a pinnate leaf's leaflets are single rows: only their ends are outline)
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || (shape !== 'pinnate' && !inside(x, y + 1));
        if (edge) t -= 0.18;                                       // drawn outline
      }
      out[o] = Math.round(Math.min(1, Math.max(0, t)) * 255);
      out[o + 1] = out[o];
      out[o + 2] = out[o];
      out[o + 3] = 255;
    }
  }
  return { pixels: out, width: W, height: H, shape };
}

export function getPixelSaplingLeafTexture(config: TreeConfig): THREE.CanvasTexture {
  const shape = saplingLeafShapeFor(config.species);
  const key = `${shape}|${Math.floor(config.seed ?? 0) % 997}`;
  const hit = saplingLeafCache.get(key);
  if (hit) return hit;
  const { pixels, width, height } = buildPixelSaplingLeafPixels(config);
  const tex = makeNearestTexture(pixels, width, height);
  saplingLeafCache.set(key, tex);
  return tex;
}

const PIXEL_SAPLING_LEAF_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float flutter = sin(uTime * uWindSpeed * 4.0 + pos.x * 6.0 + pos.y * 4.0) * uWindStrength * 0.06;
    pos.z += flutter * pos.y;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
  }
`;

const PIXEL_SAPLING_LEAF_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uLeaf;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uTextureContrast;
  uniform float uSnow;
  varying vec3 vNormal;
  varying vec2 vUv;
  ${SNOW_GLSL}

  // Snow heaped on the middle of the sprite (16 x 24 texels, base at v = 0):
  // it fills the gaps between needles, so it reads as a drift sitting on the
  // spray, and leaves the base and the tips clear.
  float leafSnow(vec2 t) {
    vec2 c = (t + 0.5) / vec2(16.0, 24.0);
    float spine = 1.0 - abs(c.x - 0.5) * 3.2;
    float along = smoothstep(0.08, 0.22, c.y) * (1.0 - smoothstep(0.55, 0.82, c.y));
    return spine * along + (snowHash(t) - 0.5) * 0.35;
  }

  void main() {
    vec3 n = normalize(vNormal);
    float back = gl_FrontFacing ? 0.0 : 1.0;
    // Needle sprays transmit light on both sides, independently of the camera.
    float ndl = abs(dot(n, normalize(uTexLightDir))) * 0.65;

    // snow on the face turned to the sky only
    if (uSnow > 0.001 && n.y > 0.2) {
      vec2 t = floor(vUv * vec2(16.0, 24.0));
      float thr = 1.0 - uSnow * 0.8;
      if (leafSnow(t) > thr) {
        float rim = (leafSnow(t + vec2(1.0, 0.0)) < thr
                  || leafSnow(t - vec2(1.0, 0.0)) < thr
                  || leafSnow(t + vec2(0.0, 1.0)) < thr) ? 1.0 : 0.0;
        gl_FragColor = vec4(snowRamp(2.0 + (ndl > 0.3 ? 1.0 : 0.0) - rim), 1.0);
        return;
      }
    }

    vec4 s = texture2D(uLeaf, vUv);
    if (s.a < 0.5) discard;
    float N1 = uPaletteSteps - 1.0;
    float idx = floor(s.r * N1 + 0.5);
    // the leaf's V-fold gives its two halves different normals, so light and
    // shade split along the midrib, in whole palette steps
    float tone = dot(n, normalize(uTexLightDir)) * 1.25 - back * 0.7 - uShadowStrength * 0.25;
    float off = clamp(floor(tone * (0.85 + uTextureContrast * 0.75) + 0.5), -2.0, 2.0);
    idx = clamp(idx + off, 0.0, N1);
    gl_FragColor = vec4(texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, 0.75)).rgb, 1.0);
  }
`;

/** Pixel-art sapling leaf: per-species leaf sprite + the tree's foliage palette. */
export function createPixelSaplingLeafMaterial(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>
): THREE.ShaderMaterial {
  const foliage = getPixelFoliageTextures(config);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uLeaf: { value: getPixelSaplingLeafTexture(config) },
      uPalette: { value: foliage.palette },
      uPaletteSteps: { value: foliage.steps },
      uTexLightDir: { value: pixelTextureLightDir(foliage.params) },
      uShadowStrength: { value: foliage.params.shadow },
      uTextureContrast: { value: foliage.params.contrast },
      uSnow: { value: THREE.MathUtils.clamp(config.snowCover ?? 0, 0, 1) },
    },
    vertexShader: PIXEL_SAPLING_LEAF_VERTEX_SHADER,
    fragmentShader: PIXEL_SAPLING_LEAF_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
}

const PIXEL_SAPLING_STEM_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * Sapling stems, petioles and buds. They are too thin (a few cm) and too
 * varied in shape (tubes, cylinders, buds) for the trunks' ridge layout, so
 * the grain is a texel grid in world space: light in whole palette steps, a
 * dark contour where the stem turns away, and sparse bark flecks - on a
 * birch, its dark lenticels on pale bark.
 */
const PIXEL_SAPLING_STEM_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uTextureContrast;
  uniform float uTexelsPerMetre;
  uniform float uBirch;
  uniform float uSeed;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  float h3(vec3 c) { return fract(sin(dot(c, vec3(127.1, 311.7, 74.7)) + uSeed) * 43758.5453); }
  void main() {
    float N1 = uPaletteSteps - 1.0;
    vec3 cell = floor(vWorldPos * uTexelsPerMetre);
    float fleck = h3(cell);
    vec3 n = normalize(vNormal);
    float ndl = dot(n, normalize(uTexLightDir));
    float facing = ndl; // Keep the painted shadow fixed as the camera orbits.
    float idx = floor(N1 * 0.5 + ndl * (1.3 + uTextureContrast * 0.8) - uShadowStrength * 0.5 + 0.5);
    if (facing < -0.3) idx -= 1.0;                              // contour
    if (uBirch > 0.5) {
      if (fleck > 0.86) idx = min(idx, 1.0);                   // lenticels
    } else {
      if (fleck > 0.84) idx -= 1.0;                            // bark flecks
      else if (fleck < 0.1) idx += 1.0;
    }
    idx = clamp(idx, 0.0, N1);
    gl_FragColor = vec4(texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, 0.75)).rgb, 1.0);
  }
`;

const PIXEL_PROP_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * Small props beside a sapling (the acorn it grew from). Light in whole
 * palette steps and a dark contour, plus a surface pattern laid out in the
 * object's own space so it wraps the shape: 'smooth' is a polished nut with a
 * highlight and faint lengthwise streaks, 'scales' the overlapping rows of an
 * acorn cup.
 */
const PIXEL_PROP_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uTextureContrast;
  uniform float uTexelsPerMetre;
  uniform float uPattern;   // 0 = smooth, 1 = scales
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocal;
  float h3(vec3 c) { return fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    float N1 = uPaletteSteps - 1.0;
    vec3 n = normalize(vNormal);
    float ndl = dot(n, normalize(uTexLightDir));
    float facing = ndl; // Keep the painted shadow fixed as the camera orbits.
    float idx = floor(N1 * 0.5 + ndl * (1.3 + uTextureContrast * 0.8) - uShadowStrength * 0.4 + 0.5);
    if (facing < -0.3) idx -= 1.0;                                   // contour
    float around = atan(vLocal.z, vLocal.x) / 6.2831853 + 0.5;
    if (uPattern > 0.5) {
      // rows of scales: the lower half of each row sits in its own shadow,
      // and alternate rows are offset by half a scale
      float rowF = vLocal.y * uTexelsPerMetre / 2.0;
      float row = floor(rowF);
      float col = floor(around * 16.0 + mod(row, 2.0) * 0.5);
      if (fract(rowF) < 0.5) idx -= 1.0;
      if (h3(vec3(row, col, 3.0)) > 0.78) idx += 1.0;
    } else {
      if (ndl > 0.72) idx += 1.0;                                    // polish highlight
      float streak = h3(vec3(floor(around * 22.0), 0.0, 7.0));
      if (streak > 0.8) idx -= 1.0;                                  // faint lengthwise streaks
    }
    idx = clamp(idx, 0.0, N1);
    gl_FragColor = vec4(texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, 0.75)).rgb, 1.0);
  }
`;

const propPaletteCache = new Map<string, THREE.CanvasTexture>();

export function createPixelPropMaterial(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>,
  baseHex: string,
  pattern: 'smooth' | 'scales'
): THREE.ShaderMaterial {
  const params = resolvePixelTextureParams(config);
  const key = `${baseHex}|${params.steps}|${params.contrast.toFixed(3)}|${params.shadow.toFixed(3)}`;
  let palette = propPaletteCache.get(key);
  if (!palette) {
    const ramp = buildWoodRamp(baseHex, params.steps, { contrast: params.contrast, shadow: params.shadow });
    palette = buildPaletteTexture(ramp, ramp);
    propPaletteCache.set(key, palette);
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uPalette: { value: palette },
      uPaletteSteps: { value: params.steps },
      uTexLightDir: { value: pixelTextureLightDir(params) },
      uShadowStrength: { value: params.shadow },
      uTextureContrast: { value: params.contrast },
      uTexelsPerMetre: { value: 60 },
      uPattern: { value: pattern === 'scales' ? 1 : 0 },
    },
    vertexShader: PIXEL_PROP_VERTEX_SHADER,
    fragmentShader: PIXEL_PROP_FRAGMENT_SHADER,
  });
}

/**
 * Pixel-art sapling stem. `green` uses the foliage palette instead of the
 * bark's, for the soft green shoot of a young palm.
 */
export function createPixelSaplingStemMaterial(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>,
  green = false
): THREE.ShaderMaterial {
  const bark = getPixelBarkTextures(config);
  const foliage = green ? getPixelFoliageTextures(config) : null;
  const params = bark.params;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uPalette: { value: foliage ? foliage.palette : bark.palette },
      uPaletteSteps: { value: foliage ? foliage.steps : bark.steps },
      uTexLightDir: { value: pixelTextureLightDir(params) },
      uShadowStrength: { value: params.shadow },
      uTextureContrast: { value: params.contrast },
      // saplings are seen close up: a finer grain than the trees' bark
      uTexelsPerMetre: { value: 32 },
      uBirch: { value: config.species.startsWith('akkala_birch') ? 1 : 0 },
      uSeed: { value: (params.seed % 997) * 0.37 },
    },
    vertexShader: PIXEL_SAPLING_STEM_VERTEX_SHADER,
    fragmentShader: PIXEL_SAPLING_STEM_FRAGMENT_SHADER,
  });
}

// ---------------------------------------------------------------------------
// CACTUS FLOWER
// ---------------------------------------------------------------------------

/**
 * Flower vertex shader: the cactus' own sway (same formula, same height), so a
 * blossom sitting on the apex moves with it instead of drifting off it.
 */
const PIXEL_FLOWER_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uTreeHeight;
  varying vec2 vUv;
  varying vec3 vNormal;
  // the flower's own axes in world space: the fragment shader builds its cup
  // normal in flower space, and a blossom on a leaning arm is tilted
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;

  void main() {
    vUv = uv;
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vAxisX = normalize(modelMatrix[0].xyz);
    vAxisY = normalize(modelMatrix[1].xyz);
    vAxisZ = normalize(modelMatrix[2].xyz);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float hf = clamp(wp.y / max(1.0, uTreeHeight), 0.0, 1.0);
    float sway = pow(hf, 1.8) * uWindStrength * 0.12;
    float y = wp.y;
    wp.x += sin(uTime * uWindSpeed * 1.2 + y * 0.3) * sway;
    wp.z += cos(uTime * uWindSpeed * 0.9 + y * 0.25) * sway * 0.6;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * Flower fragment shader. The whole blossom is ONE texel grid, laid flat over
 * the flower from above, and everything - petal outlines, overlaps, creases,
 * the pollen disc - is decided per texel on that grid. Separate petal meshes
 * each carry their own grid at their own angle, and from above they collapse
 * into pink confetti; one grid is what lets the flower read as a drawn sprite.
 *
 * Layers, back to front: an outer ring of rounded petals (their silhouette is a
 * pixel staircase, cut with discard), an inner ring offset by half a petal and
 * outlined where it overlaps the outer one, and the pollen disc. Light comes
 * from the cup's analytic normal at each texel centre, so a whole texel always
 * takes one tone.
 */
const PIXEL_FLOWER_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uTexels;       // texels across the flower's diameter
  uniform float uCupSlope;     // cup height / cup radius
  uniform float uOuterCount;
  uniform float uInnerCount;
  uniform float uPhase;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;

  float fh(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }

  // rounded petal outline: normalised radius against the offset from the
  // petal's centre line (-0.5 .. 0.5)
  float petalEdge(float f, float base, float reach) {
    return base + reach * sqrt(max(0.0, 1.0 - 4.0 * f * f));
  }

  void main() {
    float N1 = uPaletteSteps - 1.0;
    float TAU = 6.2831853;
    vec2 cell = floor(vUv * uTexels);
    vec2 p = ((cell + 0.5) / uTexels - 0.5) * 2.0;   // -1..1, texel centre
    float r = length(p);
    float px = 2.0 / uTexels;                         // one texel, in radius units
    float theta = atan(p.y, p.x);

    float ao = theta / TAU * uOuterCount + uPhase;
    float po = floor(ao + 0.5);
    float fo = ao - po;
    float ai = theta / TAU * uInnerCount + uPhase + 0.5;
    float pin = floor(ai + 0.5);
    float fi = ai - pin;

    // each petal a little longer or shorter than its neighbours
    float varO = (fh(vec2(mod(po, uOuterCount), 1.0)) - 0.5) * 0.14;
    float varI = (fh(vec2(mod(pin, uInnerCount), 2.0)) - 0.5) * 0.10;
    float rO = min(1.0, petalEdge(fo, 0.46, 0.50 + varO));
    float rI = petalEdge(fi, 0.38, 0.30 + varI);
    float rC = 0.29;

    if (r > rO) discard;

    // analytic cup normal (y = h * r^1.8) at the texel centre
    float slope = uCupSlope * 1.8 * pow(max(r, 0.001), 0.8);
    vec3 radial = r > 0.001 ? vec3(p.x, 0.0, p.y) / r : vec3(0.0);
    vec3 nl = normalize(vec3(0.0, 1.0, 0.0) - radial * slope);
    vec3 n = normalize(vAxisX * nl.x + vAxisY * nl.y + vAxisZ * nl.z);
    // Needle sprays transmit light on both sides, independently of the camera.
    float ndl = abs(dot(n, normalize(uTexLightDir))) * 0.65;

    float tone;
    float row = 0.75;   // pink
    if (r < rC) {
      row = 0.25;       // yellow
      tone = 0.64 + ndl * 0.14;
      if (r > rC - px) tone -= 0.30;                 // orange rim
      else if (r < px * 0.9) tone = 0.28;            // pistil
      else if (fh(cell) > 0.5) tone += 0.26;         // pollen
    } else if (r < rI) {
      // inner petal, on top
      tone = 0.58 + (r - rC) / max(0.01, rI - rC) * 0.26 + ndl * 0.18;
      float arc = abs(fi) * TAU * r / uInnerCount;
      if (r > rI - px) tone -= 0.30 + uShadowStrength * 0.20;      // outline over the outer petal
      else if (arc < px * 0.5) tone -= 0.14;                        // crease
      if (r < rC + px) tone -= 0.16;                                // throat
    } else {
      // outer petal, behind
      tone = 0.34 + (r - rC) * 0.60 + ndl * 0.18;
      float arc = abs(fo) * TAU * r / uOuterCount;
      float gap = (0.5 - abs(fo)) * TAU * r / uOuterCount;
      if (gap < px * 0.9) tone -= 0.30 + uShadowStrength * 0.20;   // line between petals
      else if (arc < px * 0.5 && r < rO - px * 1.5) tone -= 0.12;   // crease
      if (r > rO - px && ndl > 0.3) tone += 0.10 + uHighlightAmount * 0.12; // lit rim
    }

    float t = clamp(0.5 + (tone - 0.5) * (1.0 + uTextureContrast * 0.8), 0.0, 1.0);
    float idx = clamp(floor(t * N1 + 0.5), 0.0, N1);
    gl_FragColor = vec4(texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb, 1.0);
  }
`;

/**
 * The blossom's surface: a shallow cup (y = height * r^1.8) with planar UVs
 * seen from above. Its outline is NOT modelled - the shader cuts the petals out
 * per texel - so this is only the surface the flower is drawn on.
 */
function makeFlowerCupGeometry(radius: number, height: number): THREE.BufferGeometry {
  const rings = 10;
  const segs = 48;
  const pos: number[] = [0, 0, 0];
  const uv: number[] = [0.5, 0.5];
  const idx: number[] = [];
  for (let j = 1; j <= rings; j++) {
    const rr = j / rings;
    const y = height * Math.pow(rr, 1.8);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rr * radius, y, Math.sin(a) * rr * radius);
      uv.push(0.5 + Math.cos(a) * rr * 0.5, 0.5 + Math.sin(a) * rr * 0.5);
    }
  }
  const at = (j: number, i: number) => (j === 0 ? 0 : 1 + (j - 1) * segs + (i % segs));
  for (let i = 0; i < segs; i++) idx.push(0, at(1, i + 1), at(1, i));
  for (let j = 2; j <= rings; j++) {
    for (let i = 0; i < segs; i++) {
      // wound so the upper face is the front face
      idx.push(at(j - 1, i), at(j - 1, i + 1), at(j, i));
      idx.push(at(j - 1, i + 1), at(j, i + 1), at(j, i));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A pixel-art cactus blossom: two rings of rounded petals and a pollen disc,
 * drawn as one sprite-like texel grid on a shallow cup. `texelSize` is the
 * cactus' own texel size in metres; the flower never goes below 15 texels
 * across, the fewest that can still draw two rings of petals and a disc.
 * `swayHeight` must be the height the cactus material sways with.
 */
export function buildPixelCactusFlower(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>,
  // `variant` tells apart several blossoms on one plant (petal count, rotation,
  // petal lengths), deterministically
  opts: { texelSize: number; swayHeight: number; size?: number; variant?: number }
): { group: THREE.Group; geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
  const params = resolvePixelTextureParams(config);
  const s = opts.size ?? 1;
  const seed = params.seed + (opts.variant ?? 0) * 7919;
  const radius = 0.12 * s;
  const height = 0.065 * s;

  const paletteKey = ['flower', params.steps, params.contrast.toFixed(3), params.shadow.toFixed(3)].join('|');
  let palette = succulentPaletteCache.get(paletteKey);
  if (!palette) {
    const pink = buildFoliageRamp('#b3124f', '#ff7fa8', params.steps, {
      hueCold: -16, hueWarm: 8, contrast: params.contrast, shadow: params.shadow,
    });
    const yellow = buildFoliageRamp('#b85a00', '#ffe45a', params.steps, {
      hueCold: -10, hueWarm: 4, contrast: params.contrast, shadow: params.shadow,
    });
    palette = buildPaletteTexture(pink, yellow);
    succulentPaletteCache.set(paletteKey, palette);
  }

  const texels = Math.max(15, Math.round((radius * 2) / Math.max(0.004, opts.texelSize))) | 1;
  const outer = hash1(3, seed) > 0.5 ? 6 : 5;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uPalette: { value: palette },
      uPaletteSteps: { value: params.steps },
      uTexLightDir: { value: pixelTextureLightDir(params) },
      uShadowStrength: { value: params.shadow },
      uHighlightAmount: { value: params.highlights },
      uTextureContrast: { value: params.contrast },
      uTreeHeight: { value: opts.swayHeight },
      uTexels: { value: texels },
      uCupSlope: { value: height / radius },
      uOuterCount: { value: outer },
      uInnerCount: { value: outer },
      uPhase: { value: hash1(7, seed) },
      uSeed: { value: (seed % 997) * 0.37 },
    },
    vertexShader: PIXEL_FLOWER_VERTEX_SHADER,
    fragmentShader: PIXEL_FLOWER_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });

  const geometry = makeFlowerCupGeometry(radius, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'PixelCactusFlowerCup';
  const group = new THREE.Group();
  group.name = 'PixelCactusFlower';
  group.add(mesh);

  return { group, geometries: [geometry], materials: [material] };
}

/**
 * A succulent column - a cactus. Its ribs are modelled in the mesh, so the
 * drawing is locked to them (see PIXEL_SUCCULENT_FRAGMENT_SHADER) rather than
 * derived from the radius the way bark ridges are.
 *
 * `mainRadius` is the main stem's representative radius: it fixes the texel
 * size in metres, which every stem then shares, so the pixels on the arms are
 * the same size as on the trunk.
 */
export function createPixelSucculentMaterial(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>,
  ribCount: number,
  height: number,
  mainRadius: number,
  ribDepth: number
): THREE.ShaderMaterial {
  const params = resolvePixelTextureParams(config);
  const d = speciesDefaults(config.species);

  const key = [
    config.foliageColorBottom, config.foliageColorTop, params.steps,
    params.contrast.toFixed(3), params.shadow.toFixed(3), d.hueCold, d.hueWarm,
  ].join('|');
  let palette = succulentPaletteCache.get(key);
  if (!palette) {
    const main = buildFoliageRamp(config.foliageColorBottom, config.foliageColorTop, params.steps, {
      hueCold: d.hueCold,
      satBoost: (d as { satBoost?: number }).satBoost ?? 1,
      hueWarm: d.hueWarm,
      contrast: params.contrast,
      shadow: params.shadow,
    });
    // Accent row: a sun-bleached cream/tan ramp. Its top step is the areole,
    // its lower steps the woody corking at the foot of the column.
    const accent = buildWoodRamp('#b89a62', params.steps, {
      contrast: params.contrast,
      shadow: params.shadow,
    });
    accent[accent.length - 1] = [250, 238, 196];
    palette = buildPaletteTexture(main, accent);
    succulentPaletteCache.set(key, palette);
  }

  // Columns per rib on the main stem, by pixel size: 1 (finest) .. 5 (chunkiest).
  // Four is the minimum that still shows groove | lit flank | crest | shadow
  // flank; five is the most: finer than that, a cactus texel drops to ~3 cm
  // and the skin reads as smooth plastic at any normal viewing distance.
  const colsPerRib = [5, 5, 5, 4, 4][params.pixelSize - 1] ?? 4;
  const texelSize = (Math.PI * 2 * Math.max(0.1, mainRadius)) / (Math.max(3, ribCount) * colsPerRib);

  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uPalette: { value: palette },
      uPaletteSteps: { value: params.steps },
      uTexLightDir: { value: pixelTextureLightDir(params) },
      uShadowStrength: { value: params.shadow },
      uHighlightAmount: { value: params.highlights },
      uTextureContrast: { value: params.contrast },
      uDetailDensity: { value: params.detail },
      uBarkVariation: { value: params.barkVariation },
      uTextureSeed: { value: (params.seed % 4096) * 0.0173 },
      uTreeHeight: { value: Math.max(1, height) },
      uRibs: { value: Math.max(3, Math.round(ribCount)) },
      uRibDepth: { value: ribDepth },
      uTexelSize: { value: texelSize },
      uCorkHeight: { value: Math.min(1.4, height * 0.09) },
    },
    vertexShader: PIXEL_SUCCULENT_VERTEX_SHADER,
    fragmentShader: PIXEL_SUCCULENT_FRAGMENT_SHADER,
    side: THREE.FrontSide,
  });
}

/** Reuse native bark albedo drawing, while Three handles scene lights and fog. */
export function createSceneLitPixelBarkMaterial(config: TreeConfig) {
  const native = createPixelBarkMaterial(config, {});
  const textures = [native.uniforms.uStruct.value.clone(), native.uniforms.uPalette.value.clone()] as THREE.Texture[];
  textures.forEach(texture => { texture.needsUpdate = true; });
  native.uniforms.uStruct.value = textures[0];
  native.uniforms.uPalette.value = textures[1];
  // Share the exact drawing code, including its metre-sized texels and continuous ridges.
  const source = PIXEL_BARK_FRAGMENT_SHADER;
  const declarations = source.slice(0, source.indexOf('varying vec3 vNormal;'));
  const drawing = source.slice(source.indexOf('float N1 ='), source.indexOf('vec3 N = normalize(vNormal);'));
  const material = new THREE.MeshStandardMaterial({roughness: config.barkRoughness, fog: true});
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, native.uniforms);
    shader.vertexShader = `attribute vec3 aWood; attribute vec2 aBarkAngle;
      uniform float uBarkVScale;
      varying vec3 vWood; varying vec2 vBarkAngle; varying vec2 vBarkUv; varying float vAngleU;
      ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vWood=aWood; vBarkAngle=aBarkAngle; vBarkUv=vec2(uv.x,uv.y*uBarkVScale); vAngleU=uv.x;`);
    shader.fragmentShader = declarations + `
      varying vec3 vWood; varying vec2 vBarkAngle; varying vec2 vBarkUv; varying float vAngleU;
      float bhash(float n){return fract(sin(n*12.9898)*43758.5453123);}
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { ${drawing}
        idx=clamp(idx,0.,N1);
        diffuseColor.rgb=texture2D(uPalette,vec2((idx+.5)/uPaletteSteps,${PALETTE_ROW_MAIN})).rgb;
      }`);
  };
  material.customProgramCacheKey = () => 'scene-lit-native-bark-v1';
  native.dispose();
  return {material, textures};
}

/** Native bark ShaderMaterial shares time and wind uniforms with the tree. */
export function createPixelBarkMaterial(
  config: TreeConfig,
  sharedUniforms: Record<string, THREE.IUniform>,
  textures?: {structure:THREE.Texture;palette:THREE.Texture;steps:number;params:PixelTextureParams}
): THREE.ShaderMaterial {
  const bark = textures??getPixelBarkTextures(config);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uStruct: { value: bark.structure },
      uPalette: { value: bark.palette },
      uPaletteSteps: { value: bark.steps },
      uTexLightDir: { value: pixelTextureLightDir(bark.params) },
      uShadowStrength: { value: bark.params.shadow },
      uHighlightAmount: { value: bark.params.highlights },
      uTextureContrast: { value: bark.params.contrast },
      uMossAmount: { value: config.mossAmount ?? 0 },
      uRootY: { value: 0 },
      uTreeHeight: { value: Math.max(1, config.trunkHeight ?? 9) },
      uRootSpread: { value: config.rootSpread ?? 1 },
      uBarkVScale: { value: bark.params.barkVScale },
      uBarkVariation: { value: bark.params.barkVariation },
      uTextureSeed: { value: (bark.params.seed % 4096) * 0.0173 },
      // 'plated' (pine) is drawn on the same analytic metre grid as 'lobed',
      // so its texels match every other tree, with its columns cut into plates
      uLobedMode: { value: bark.params.barkPattern === 'lobed' || bark.params.barkPattern === 'plated' ? 1 : 0 },
      uPlatedMode: { value: bark.params.barkPattern === 'plated' ? 1 : 0 },
      uTexelsPerMetre: { value: bark.params.barkTexelsPerMetre },
      // pine plate columns are narrower than oak ridges (~0.38 m at the default size)
      uTexelsPerLobe: {
        value: bark.params.barkPattern === 'plated'
          ? Math.max(4, bark.params.barkTexelsPerLobe - 2)
          : bark.params.barkTexelsPerLobe,
      },
      uForcedLobes: { value: 0 },
      uBarkDarkCoverage: { value: 1 },
      // crown shade: off unless the tree's generator switches it on
      uCrownShade: { value: 0 },
      uCrownBottomY: { value: 0 },
      uCrownTopY: { value: 1 },
      uCrownRadius: { value: 1 },
      uCrownEllipsoid: { value: 0 },
      uCrownCenterY: { value: 0 },
      uCrownRadiusY: { value: 1 },
      uSnow: { value: THREE.MathUtils.clamp(config.snowCover ?? 0, 0, 1) },
      uLitSign: { value: Math.cos((bark.params.lightAzimuth * Math.PI) / 180) >= 0 ? 1 : -1 },
    },
    vertexShader: PIXEL_BARK_VERTEX_SHADER,
    fragmentShader: PIXEL_BARK_FRAGMENT_SHADER,
  });
}
