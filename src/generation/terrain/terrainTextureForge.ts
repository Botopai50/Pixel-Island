import * as THREE from 'three';
import { TerrainGenerator } from './terrainGenerator.ts';
import { CONFIG } from '../../config.ts';

/* =========================================================================
   PALETAS (indexadas — 6 tons por rampa de material)
   Portado fielmente de pixel-terrain-forge.html
   ========================================================================= */
export const M_SHORE = 0, M_GROUND = 1, M_ROCK = 2, M_VEG = 3, M_ACC = 4;
export const M_SAND = M_SHORE, M_DIRT = M_GROUND, M_GRASS = M_VEG;
export const RL = 6;

// Temperado
export const SAND: [number, number, number][]  = [[150,112,64],[176,138,86],[206,172,116],[232,206,152],[244,226,186],[251,241,218]];
export const DIRT: [number, number, number][]  = [[80,46,18],[116,70,26],[154,100,34],[192,134,46],[222,168,62],[241,202,104]];
export const ROCK: [number, number, number][]  = [[56,62,56],[84,91,82],[120,128,116],[156,164,150],[194,200,184],[226,230,214]];
export const GRASS: [number, number, number][] = [[24,56,30],[38,86,40],[60,120,46],[92,158,54],[132,196,68],[178,224,102]];
export const ACC: [number, number, number][]   = [[214,196,92],[236,214,120],[224,142,86]];

// Montanhoso
export const TALUS: [number, number, number][]   = [[48,46,44],[74,72,68],[104,102,96],[136,134,126],[168,166,156],[198,196,186]];
export const SCREE: [number, number, number][]   = [[66,58,48],[98,88,72],[132,120,100],[164,152,128],[194,182,158],[220,210,188]];
export const GRANITE: [number, number, number][] = [[44,46,56],[70,74,88],[102,108,124],[138,144,160],[174,180,194],[210,214,226]];
export const ALPINE: [number, number, number][]  = [[16,36,24],[26,58,32],[40,84,40],[58,110,50],[88,144,64],[126,180,90]];
export const ACC_M: [number, number, number][]   = [[198,186,150],[220,210,180],[176,150,110]];

// Polar
export const ICE: [number, number, number][]     = [[96,124,156],[128,156,182],[166,190,208],[198,220,234],[224,240,248],[244,250,254]];
export const SNOW: [number, number, number][]    = [[120,138,168],[152,170,196],[186,202,222],[214,226,240],[236,244,252],[250,252,255]];
export const FROZEN: [number, number, number][]  = [[40,50,64],[64,78,96],[94,110,130],[128,144,164],[164,180,200],[202,216,230]];
export const CONIFER: [number, number, number][] = [[10,28,26],[18,46,38],[26,68,52],[38,92,66],[58,120,84],[92,152,110]];
export const ACC_P: [number, number, number][]   = [[196,222,240],[224,240,250],[150,190,220]];

export const B_TEMP = 0, B_MOUNT = 1, B_POLAR = 2;

export interface BiomeForgeDef {
  key: string;
  label: string;
  swatch: string;
  ramps: [number, number, number][][];
  ground: string;
  wallHi: string;
  wallLo: string;
  veg: string;
  vegBias: number;
  rockBias: number;
  vegDens: number;
  bushes: boolean;
}

export const BIOMES: BiomeForgeDef[] = [
  { key:'temperado', label:'Temperado', swatch:'#dea83e',
    ramps:[SAND,  DIRT,  ROCK,    GRASS,   ACC  ],
    ground:'canais', wallHi:'canal',   wallLo:'seixo',
    veg:'tufo',     vegBias: 0.00, rockBias: 0.00, vegDens:1.00, bushes:true },
  { key:'montanha',  label:'Montanhoso', swatch:'#a49880',
    ramps:[TALUS, SCREE, GRANITE, ALPINE,  ACC_M],
    ground:'talus',  wallHi:'fratura', wallLo:'bloco',
    veg:'alpino',   vegBias:-0.20, rockBias: 0.34, vegDens:0.45, bushes:false },
  { key:'polar',     label:'Polar', swatch:'#d6e4f0',
    ramps:[ICE,   SNOW,  FROZEN,  CONIFER, ACC_P],
    ground:'neve',   wallHi:'gelo',    wallLo:'seixo',
    veg:'conifera', vegBias:-0.30, rockBias: 0.12, vegDens:0.30, bushes:false },
];

export const NB = BIOMES.length;
export const RAMPS = BIOMES.map(b => b.ramps);

/* =========================================================================
   PRNG & RUÍDOS DETERMINÍSTICOS
   ========================================================================= */
export function mulberry32(a: number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function ihash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 951214051) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

export function makePerlin(seed: number) {
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  const rng = mulberry32(seed);
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 7;
    const u = h < 4 ? x : y, v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
  };
  function noise(x: number, y: number) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const A = p[X] + Y, B = p[X + 1] + Y;
    return lerp(v, lerp(u, grad(p[A], xf, yf), grad(p[B], xf - 1, yf)),
                   lerp(u, grad(p[A + 1], xf, yf - 1), grad(p[B + 1], xf - 1, yf - 1))) * 0.5;
  }
  function fbm(x: number, y: number, oct: number = 4) {
    let t = 0, a = 1, f = 1, m = 0;
    for (let i = 0; i < oct; i++) {
      t += noise(x * f, y * f) * a;
      m += a; a *= 0.5; f *= 2.02;
    }
    return t / m;
  }
  return { noise, fbm };
}

export function cluster(x: number, y: number, s: number): number {
  const xf = Math.floor(x), yf = Math.floor(y);
  return ihash(xf, yf, s) * 0.40
       + ihash(Math.floor((xf + 2) / 3), Math.floor((yf + 1) / 3), s + 17) * 0.35
       + ihash(Math.floor((xf + 5) / 7), Math.floor((yf + 3) / 7), s + 53) * 0.25;
}

export function ctile(x: number, y: number, cell: number, W: number, H: number, s: number): number {
  const cx = Math.floor(x / cell) % Math.floor(W / cell);
  const cy = Math.floor(y / cell) % Math.floor(H / cell);
  return ihash(cx, cy, s);
}

export function ctile2(x: number, y: number, cw: number, ch: number, W: number, H: number, s: number): number {
  const nx = Math.floor(W / cw), ny = Math.floor(H / ch);
  const cx = ((Math.floor(x / cw) % nx) + nx) % nx;
  const cy = ((Math.floor(y / ch) % ny) + ny) % ny;
  return ihash(cx, cy, s);
}

export function tvalue2(x: number, y: number, cw: number, ch: number, W: number, H: number, s: number): number {
  const nx = Math.floor(W / cw), ny = Math.floor(H / ch);
  const fx = ((x % W) + W) % W, fy = ((y % H) + H) % H;
  const cx = Math.floor(fx / cw), cy = Math.floor(fy / ch);
  const u = (fx - cx * cw) / cw, v = (fy - cy * ch) / ch;
  const u2 = u * u * (3 - 2 * u), v2 = v * v * (3 - 2 * v);
  const v00 = ihash(cx, cy, s);
  const v10 = ihash((cx + 1) % nx, cy, s);
  const v01 = ihash(cx, (cy + 1) % ny, s);
  const v11 = ihash((cx + 1) % nx, (cy + 1) % ny, s);
  return (v00 * (1 - u2) + v10 * u2) * (1 - v2) + (v01 * (1 - u2) + v11 * u2) * v2;
}

export function tfbm2(x: number, y: number, cw: number, ch: number, W: number, H: number, s: number): number {
  return tvalue2(x, y, cw, ch, W, H, s) * 0.62 + tvalue2(x * 2, y * 2, Math.max(2, cw >> 1), Math.max(2, ch >> 1), W, H, s + 91) * 0.38;
}

export function clusterT(x: number, y: number, W: number, H: number, s: number): number {
  return ctile(x, y, 1, W, H, s) * 0.32
       + ctile(x, y, 3, W, H, s + 17) * 0.40
       + ctile(x, y, 7, W, H, s + 53) * 0.28;
}

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => BAYER4[((y & 3) << 2) | (x & 3)] / 16 - 0.46875;

export function cobble(x: number, y: number, cell: number, seed: number, wrap: number = 0) {
  const fx = x / cell, fy = y / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let minD = 999, sD = 999, px = 0, py = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    let rx = cx, ry = cy;
    if (wrap > 0) {
      const cw = Math.floor(wrap / cell);
      rx = ((cx % cw) + cw) % cw;
      ry = ((cy % cw) + cw) % cw;
    }
    const ox = ihash(rx, ry, seed);
    const oy = ihash(rx, ry, seed + 97);
    const ddx = cx + 0.15 + 0.70 * ox - fx;
    const ddy = cy + 0.15 + 0.70 * oy - fy;
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d < minD) {
      sD = minD; minD = d; px = ddx; py = ddy;
    } else if (d < sD) {
      sD = d;
    }
  }
  return { d: minD, edge: sD - minD, px, py };
}

export function cobbleTone(c: { d: number; edge: number; px: number; py: number }, base: number, lx: number, ly: number): number {
  if (c.edge < 0.16) return clamp(base - 2, 0, RL - 1);
  if (c.edge < 0.32) return clamp(base - 1, 0, RL - 1);
  const len = Math.hypot(c.px, c.py) + 1e-5;
  const ndotl = -(c.px / len) * lx - (c.py / len) * ly;
  let v = base;
  if (ndotl > 0.42 && c.d > 0.12) v += 1;
  else if (ndotl < -0.38) v -= 1;
  return clamp(v, 0, RL - 1);
}

/* =========================================================================
   CARIMBOS DE PIXEL ART
   ========================================================================= */
export interface Stamp {
  c: number;
  w: number;
  h: number;
  rows: string[];
}

function mkStamps(list: { c: number; r: string[] }[]): Stamp[] {
  return list.map(o => {
    const w = Math.max(...o.r.map(s => s.length));
    return { c: o.c, w, h: o.r.length, rows: o.r.map(s => s.padEnd(w, '.')) };
  });
}

export const TUFTS: Stamp[] = mkStamps([
  { c: 1, r: ["H", "M"] },
  { c: 1, r: ["h"] },
  { c: 1, r: [".H", "Ms"] },
  { c: 1, r: ["H.", "hM"] },
  { c: 2, r: [".H.", "hMs"] },
  { c: 2, r: ["H.h", "MMs"] },
  { c: 2, r: [".H", "HM", "Ms"] },
  { c: 2, r: ["H.", ".M", "hM"] },
  { c: 3, r: [".H.h", ".MMs", "sMs."] },
  { c: 3, r: ["H.H.", "hMMs", ".MSs"] },
  { c: 3, r: [".H..", "hMH.", "sMMs"] },
  { c: 3, r: [".H.", "HMh", ".Ms", ".S."] },
  { c: 4, r: ["..H..", ".HMh.", "hMMMs", "sMSSs"] },
  { c: 4, r: [".H.H.", "HMhMs", "sMMMs", "..S.."] },
  { c: 4, r: ["..h.H", ".HMMh", "hMMMs", ".sSs."] },
  { c: 4, r: ["H...H", "hM.Mh", ".MMMs", "..S.."] },
]);

export const BLADES: Stamp[] = mkStamps([
  { c: 1, r: ["H", "M"] },
  { c: 1, r: ["H", "M", "s"] },
  { c: 1, r: [".H", "M."] },
  { c: 1, r: ["H.", ".M"] },
  { c: 1, r: ["Hh"] },
  { c: 1, r: ["H", ".", "M"] },
]);

export const CONIF: Stamp[] = mkStamps([
  { c: 1, r: [".H.", "hMs", ".S."] },
  { c: 2, r: [".H.", "HMs", "hMS", ".M."] },
  { c: 2, r: ["..H..", ".hMs.", "hMMSs", "..M.."] },
  { c: 3, r: ["..H..", ".HMs.", "hMMSs", ".sMS.", "..M.."] },
  { c: 3, r: ["..H.", ".HMs", "hMMS", ".sM.", "..M."] },
]);

export const PEBBLES: Stamp[] = mkStamps([
  { c: 1, r: ["H", "m"] },
  { c: 1, r: ["Hh", "sS"] },
  { c: 2, r: [".Hh", "msS"] },
  { c: 2, r: ["HHh", "msS"] },
  { c: 2, r: [".HH.", "msSS"] },
]);

/* =========================================================================
   CONFIGURAÇÕES DO FORGE
   ========================================================================= */
export interface ForgeParams {
  seed: number;
  edge: number;
  pscale: number;
  grass: number;
  rock: number;
  dirt: number;
  tuft: number;
  clusterSize: number;
  spill: number;
  greens: number;
  hang: number;
  polar: number;
  massif: number;
}

export const DEFAULT_FORGE_PARAMS: ForgeParams = {
  seed: 42,
  edge: 0.50,
  pscale: 2.2,
  grass: 0.05,
  rock: 0.00,
  dirt: 0.45,
  tuft: 0.85,
  clusterSize: 4,
  spill: 0.65,
  greens: 4,
  hang: 0.20,
  polar: 0.50,
  massif: 0.50,
};

export const MARGIN = 12;
export const WALL = 128;
export const DEFAULT_D = 2.0; // 2 texels por metro (chunk de 64m = 128x128 texels)

/* =========================================================================
   TEXTURAS DE ENCOSTA (PAREDES VERTICAIS)
   ========================================================================= */
export function genWallTexture(P: ForgeParams, kind: string, shade: number, bioIdx: number): Uint8ClampedArray {
  const W = WALL, H = WALL, n = W * H;
  const mat = new Uint8Array(n), idx = new Uint8Array(n);
  const sd = P.seed + (kind === 'seixo' || kind === 'bloco' ? 707 : 404) + (bioIdx | 0) * 97;
  const put = (x: number, y: number, m: number, v: number) => {
    const ix = ((x % W) + W) % W, iy = ((y % H) + H) % H, i = iy * W + ix;
    mat[i] = m; idx[i] = clamp(v, 0, (m === M_ACC ? 2 : RL - 1));
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (kind === 'seixo' || kind === 'bloco') {
        const c = cobble(x, y, kind === 'bloco' ? 16 : 8, sd + 301, W);
        let v = cobbleTone(c, 2, 0.35, -0.94);
        const cl = clusterT(x, y, W, H, sd + 4);
        if (cl > 0.82) v += 1; else if (cl < 0.16) v -= 1;
        put(x, y, M_ROCK, v);

      } else if (kind === 'fratura') {
        const s1 = ctile2(x, y, 8, 32, W, H, sd + 51);
        const s2 = ctile2(x + 3, y, 16, 16, W, H, sd + 52);
        const f  = tfbm2(x, y, 16, 64, W, H, sd + 53);
        let v = 3 + (s1 > 0.66 ? 1 : (s1 < 0.34 ? -1 : 0)) + (s2 > 0.72 ? 1 : (s2 < 0.28 ? -1 : 0));
        if (Math.abs(f - 0.5) < 0.045) v -= 2;
        if (clusterT(x, y, W, H, sd + 54) > 0.86) v += 1;
        put(x, y, M_GROUND, v);

      } else if (kind === 'gelo') {
        const band = ctile2(x, y, 64, 6, W, H, sd + 61);
        const fine = ctile2(x, y, 24, 3, W, H, sd + 62);
        let v = 4 + (band > 0.60 ? 1 : (band < 0.34 ? -1 : 0)) + (fine > 0.74 ? 0 : (fine < 0.22 ? -1 : 0));
        if (tfbm2(x, y, 32, 12, W, H, sd + 63) < 0.30) v -= 2;
        put(x, y, M_GROUND, v);
        if (ctile2(x, y, 3, 64, W, H, sd + 64) > 0.90) {
          const len = 2 + ((ihash(x, 0, sd + 65) * 4) | 0);
          for (let k = 0; k < len; k++) put(x, y + k, M_GROUND, 5);
        }

      } else {
        // canais de erosão na parede
        const ox = (tfbm2(x, y, 32, 64, W, H, sd + 33) - 0.5) * 11;
        const n1 = tfbm2(x + ox, y, 8, 48, W, H, sd + 31);
        const n2 = tfbm2(x - ox, y, 4, 24, W, H, sd + 32);
        const ch1 = 1 - Math.abs(n1 * 2 - 1);
        const ch2 = 1 - Math.abs(n2 * 2 - 1);
        const dth = (clusterT(x, y, W, H, sd + 40) - 0.5) * 0.09;

        let v = 4;
        const t2 = tfbm2(x, y, 32, 32, W, H, sd + 35);
        if (t2 > 0.62) v += 1; else if (t2 < 0.36) v -= 1;

        if (ch1 + dth > 0.885) v -= 2;
        else if (ch1 + dth > 0.745) v -= 1;
        else if (ch1 + dth < 0.30) v += 1;
        if (ch2 + dth * 0.8 > 0.90) v -= 1;
        if (ctile2(x, y, 32, 2, W, H, sd + 24) > 0.90) v -= 1;
        put(x, y, M_DIRT, v);
      }
    }
  }

  const isRockWall = (kind === 'seixo' || kind === 'bloco');
  // rachaduras horizontais / fendas verticais
  for (let k = 0; k < (isRockWall ? 26 : 52); k++) {
    const y0 = (ihash(k, 0, sd + 31) * H) | 0, x0 = (ihash(k, 1, sd + 32) * W) | 0;
    const len = 3 + ((ihash(k, 2, sd + 33) * 8) | 0);
    let cy = y0;
    for (let j = 0; j < len; j++) {
      put(x0 + j, cy, isRockWall ? M_ROCK : M_GROUND, isRockWall ? 0 : 1);
      if (ihash(k, j, sd + 34) > 0.72) cy += ihash(k, j, sd + 35) > 0.5 ? 1 : -1;
    }
  }
  // pedras embutidas na terra
  if (!isRockWall && kind !== 'gelo') {
    for (let k = 0; k < 22; k++) {
      const x0 = (ihash(k, 7, sd + 41) * W) | 0, y0 = (ihash(k, 8, sd + 42) * H) | 0;
      const st = PEBBLES[(ihash(k, 9, sd + 43) * PEBBLES.length) | 0];
      for (let r = 0; r < st.h; r++) for (let c = 0; c < st.w; c++) {
        const ch = st.rows[r][c]; if (ch === '.') continue;
        const o = ch === 'H' ? 2 : ch === 'h' ? 1 : ch === 's' ? -1 : (ch === 'S' ? -2 : 0);
        put(x0 + c, y0 + r, M_ROCK, 2 + o);
      }
    }
  }

  const img = new Uint8ClampedArray(n * 4);
  const sh = shade | 0;
  const RMP = RAMPS[bioIdx | 0];
  for (let i = 0; i < n; i++) {
    const ramp = RMP[mat[i]];
    const c = ramp[clamp(idx[i] - sh, 0, ramp.length - 1)];
    img[i * 4] = c[0]; img[i * 4 + 1] = c[1]; img[i * 4 + 2] = c[2]; img[i * 4 + 3] = 255;
  }
  return img;
}

export function buildWallAtlas(P: ForgeParams, slot: 'wallHi' | 'wallLo', shade: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(WALL * WALL * NB * 4);
  for (let b = 0; b < NB; b++) {
    const kind = BIOMES[b][slot];
    out.set(genWallTexture(P, kind, shade, b), b * WALL * WALL * 4);
  }
  return out;
}

/* =========================================================================
   GERAÇÃO DE TEXTURAS POR CHUNK (TOP, TOP_DARK, BIO)
   ========================================================================= */
export interface ChunkTextureResult {
  img: Uint8ClampedArray;
  imgD: Uint8ClampedArray;
  bimg: Uint8ClampedArray;
  width: number;
  height: number;
}

export function genChunkTexture(
  P: ForgeParams,
  per: { fbm: (x: number, y: number, oct?: number) => number },
  terrainGen: TerrainGenerator,
  minWorldX: number,
  minWorldZ: number,
  chunkSize: number,
  density: number = DEFAULT_D
): ChunkTextureResult {
  const D = density;
  const CW = Math.round(chunkSize * D);
  const M = MARGIN;
  const W = CW + M * 2;
  const GX0 = Math.round(minWorldX * D);
  const GY0 = Math.round(minWorldZ * D);
  const PX = GX0 - M, PY = GY0 - M;
  const nT = W * W;

  const mat = new Uint8Array(nT), idx = new Uint8Array(nT);
  const gl  = new Uint8Array(nT);
  const bio = new Uint8Array(nT);
  const gv  = new Float32Array(nT);
  const hT  = new Float32Array(nT), slT = new Float32Array(nT);
  const sd  = P.seed;
  const warp = 0.55 + P.edge * 1.9;
  const mf   = 1 / Math.max(1.4, P.pscale);
  const ditA = 0.085 + 0.30 * P.edge;
  const ROCK_CELL = clamp(Math.round(D * 0.62), 4, 10);

  /* ---- passo 1: campos ---- */
  for (let ly = 0; ly < W; ly++) {
    for (let lx = 0; lx < W; lx++) {
      const i = ly * W + lx;
      const tx = PX + lx, ty = PY + ly;
      const wx = tx / D, wy = ty / D;
      const px = wx, pz = wy;

      const h = terrainGen.getHeight(px, pz);
      // Inclinação analítica por diferenças finitas
      const e = 1.0;
      const hL = terrainGen.getHeight(px - e, pz), hR = terrainGen.getHeight(px + e, pz);
      const hD = terrainGen.getHeight(px, pz - e), hU = terrainGen.getHeight(px, pz + e);
      const sl = Math.sqrt(((hR - hL) / (2 * e)) ** 2 + ((hU - hD) / (2 * e)) ** 2);

      hT[i] = h; slT[i] = sl;
      const hn = clamp(h / 65.0, 0, 1);

      /* ---- BIOMA ---- */
      const bd = (cluster(tx + 7, ty + 3, sd + 70) - 0.5) * 0.17;
      const climate = terrainGen.getClimate(px, pz, h);
      const coldVal = clamp(1.0 - climate.temperature, 0, 1);
      const massifVal = clamp((h - 22.0) / 45.0 + sl * 0.25, 0, 1);

      let b = B_TEMP;
      if (massifVal > 1.02 - P.massif * 0.72 + bd * 0.8) b = B_MOUNT;
      if (coldVal   > 0.92 - P.polar * 0.42  + bd)       b = B_POLAR;
      if (h > 48.0 + bd * 8.0)                           b = B_POLAR; // calota no cume
      bio[i] = b;
      const BI = BIOMES[b];

      // Domain warp
      const ox = per.fbm(wx * 0.21 + 11.3, wy * 0.21 + 4.1, 2) * warp;
      const oy = per.fbm(wx * 0.21 + 27.7, wy * 0.21 + 18.9, 2) * warp;
      const ax = wx + ox, ay = wy + oy;

      // Máscara macro de vegetação
      let m = per.fbm(ax * mf, ay * mf, 3) * 0.5 + 0.5;
      m += per.fbm(ax * mf * 3.4 + 5.1, ay * mf * 3.4 + 9.7, 2) * 0.14 * (0.35 + P.edge);
      m += (hn - 0.40) * 0.30;
      m -= clamp(sl - 0.95, 0, 2) * 0.20;
      m += P.grass + BI.vegBias;
      gv[i] = m;

      // Quantização com dither em cluster
      const d = m + (cluster(tx, ty, sd) - 0.5) * ditA;
      gl[i] = d > 0.70 ? 4 : d > 0.61 ? 3 : d > 0.535 ? 2 : d > 0.475 ? 1 : 0;

      // Rocha: encosta + ruído
      let rk = per.fbm(wx * 0.17 + 71.2, wy * 0.17 + 33.8, 3) * 0.5 + 0.5;
      rk += clamp(sl - 0.95, 0, 2) * 0.30 + (0.28 - hn) * 0.30;
      rk += (cluster(tx + 91, ty + 17, sd + 5) - 0.5) * 0.26;
      const isRock = rk > (1.10 - P.rock * 0.80 - BI.rockBias);

      // Areia na faixa da praia
      let sn = per.fbm(wx * 0.26 + 9.4, wy * 0.26 + 3.2, 2) * 0.5 + 0.5;
      sn += (cluster(tx + 41, ty + 63, sd + 9) - 0.5) * 0.30;
      const isSand = h < CONFIG.SEA_LEVEL + (1.85 + sn * 1.1) && sl < 1.45;

      if (isSand) { mat[i] = M_SAND; gl[i] = Math.min(gl[i], 1); }
      else if (isRock) { mat[i] = M_ROCK; gl[i] = Math.min(gl[i], 2); }
      else mat[i] = M_DIRT;
    }
  }

  /* ---- passo 2: base indexada por material ---- */
  for (let ly = 0; ly < W; ly++) {
    for (let lx = 0; lx < W; lx++) {
      const i = ly * W + lx;
      const tx = PX + lx, ty = PY + ly;
      const wx = tx / D, wy = ty / D;
      const big = per.fbm(wx * 0.33 + 5.5, wy * 0.33 + 2.2, 2);
      const bay = bayer(tx, ty);
      const cl  = cluster(tx + 7, ty + 11, sd + 21);
      const BI  = BIOMES[bio[i]];

      if (mat[i] === M_ROCK) {
        const cell = bio[i] === B_MOUNT ? Math.round(ROCK_CELL * 1.5) : ROCK_CELL;
        const c = cobble(tx, ty, cell, sd + 301);
        let v = cobbleTone(c, 2, 0.71, -0.71);
        if (big > 0.22) v += 1; else if (big < -0.22) v -= 1;
        if (bio[i] === B_POLAR && cluster(tx * 1.3, ty * 1.3, sd + 72) > 0.72) v += 1;
        idx[i] = clamp(v, 0, RL - 1);

      } else if (mat[i] === M_SAND) {
        const s1 = per.fbm(wx * 0.55 + 61.1, wy * 0.55 + 12.7, 2) * 0.5 + 0.5;
        let v = 3;
        if (s1 + bay * 0.30 > 0.58) v = 4;
        else if (s1 + bay * 0.30 < 0.34) v = 2;
        const wet = (CONFIG.SEA_LEVEL + 0.75 - hT[i]) / 0.85;
        if (wet + bay * 0.55 > 0.42) v -= 1;
        if (wet + bay * 0.55 > 0.95) v -= 1;
        if (cl > 0.93) v -= 1;
        idx[i] = clamp(v, 0, RL - 1);

      } else if (BI.ground === 'talus') {
        const c = cobble(tx, ty, Math.max(3, Math.round(D * 0.30)), sd + 311);
        let v = cobbleTone(c, 3, 0.71, -0.71);
        if (big + bay * 0.18 >  0.20) v += 1;
        else if (big + bay * 0.18 < -0.20) v -= 1;
        if (cluster(tx * 0.5 + 9, ty * 0.5 + 2, sd + 312) > 0.82) v += 1;
        idx[i] = clamp(v, 0, RL - 1);

      } else if (BI.ground === 'neve') {
        const wa = (P.seed % 628) / 100;
        const rx =  wx * Math.cos(wa) + wy * Math.sin(wa);
        const ry = -wx * Math.sin(wa) + wy * Math.cos(wa);
        const drift = 1 - Math.abs(per.fbm(rx * 0.50 + 3.7, ry * 2.70 + 9.1, 3));
        const dth = (cluster(tx, ty, sd + 73) - 0.5) * 0.10;
        let v = 4;
        if (drift + dth > 0.88) v = 5;
        else if (drift + dth < 0.44) v = 3;
        if (per.fbm(wx * 0.30 + 51, wy * 0.30 + 22, 2) > 0.30) v = Math.min(5, v + 1);
        if (cluster(tx * 0.6 + 13, ty * 0.6 + 31, sd + 74) < 0.12) v -= 2;
        if (ihash(tx, ty, sd + 75) > 0.9955) v = 5;
        idx[i] = clamp(v, 0, RL - 1);

      } else {
        // canais de erosão na terra
        const wu = wx + per.fbm(wx * 0.60 + 3.1,  wy * 0.60 + 8.7,  2) * 1.2;
        const wv = wy + per.fbm(wx * 0.60 + 19.3, wy * 0.60 + 2.9,  2) * 1.2;
        const ch1 = 1 - Math.abs(per.fbm(wu * 0.80 + 5.0,  wv * 0.80 + 11.0, 3));
        const ch2 = 1 - Math.abs(per.fbm(wu * 2.15 + 31.0, wv * 2.15 + 17.0, 2));
        const chL = 1 - Math.abs(per.fbm((wu + 0.20) * 0.80 + 5.0, (wv - 0.20) * 0.80 + 11.0, 3));
        const dith = (cluster(tx, ty, sd + 27) - 0.5) * 0.085;

        let v = 4;
        if (big + bay * 0.16 >  0.24) v += 1;
        else if (big + bay * 0.16 < -0.22) v -= 1;
        const c1 = ch1 + dith;
        if (c1 > 0.905)      v -= 2;
        else if (c1 > 0.815) v -= 1;
        else if (chL > 0.86) v += 1;
        if (ch2 + dith * 0.8 > 0.935) v -= 1;
        idx[i] = clamp(v, 0, RL - 1);
      }

      // Preenchimento base de grama
      const g = gl[i];
      if (g >= 2) {
        const hole = cluster(tx + 23, ty + 37, sd + 13);
        const holeThr = g === 2 ? 0.20 : (g === 3 ? 0.11 : 0.05);
        if (hole > holeThr) {
          mat[i] = M_GRASS;
          const wide = per.fbm(wx * 0.72 + 41.3, wy * 0.72 + 7.9, 2);
          const tone = cluster(tx * 0.35 + 3, ty * 0.35 + 9, sd + 17);
          const q = Math.min(P.greens - 1, Math.floor(tone * P.greens));
          const off = Math.round((q / Math.max(1, P.greens - 1) - 0.5) * (P.greens >= 5 ? 2 : 1));
          let v = 3 + off;
          if (wide > 0.20) v += 1; else if (wide < -0.22) v -= 1;
          idx[i] = clamp(v, 0, RL - 1);
        }
      }
    }
  }

  /* Escrita em coordenada global */
  const put = (TX: number, TY: number, m: number, v: number) => {
    const lx = TX - PX, ly = TY - PY;
    if (lx < 0 || ly < 0 || lx >= W || ly >= W) return;
    const i = ly * W + lx; mat[i] = m; idx[i] = clamp(v, 0, (m === M_ACC ? 2 : RL - 1));
  };
  const at = (TX: number, TY: number) => {
    const lx = clamp(TX - PX, 0, W - 1), ly = clamp(TY - PY, 0, W - 1);
    return ly * W + lx;
  };
  const stamp = (st: Stamp, TX: number, TY: number, m: number, base: number, flip: boolean) => {
    for (let r = 0; r < st.h; r++) {
      const row = st.rows[r];
      for (let c = 0; c < st.w; c++) {
        const ch = row[flip ? (st.w - 1 - c) : c];
        if (ch === '.') continue;
        const o = ch === 'H' ? 2 : ch === 'h' ? 1 : (ch === 'M' || ch === 'm') ? 0 : ch === 's' ? -1 : -2;
        put(TX + c, TY + r, m, base + o);
      }
    }
  };
  const gridStart = (p: number, step: number) => Math.floor(p / step) * step;

  /* ---- passo 3: detalhes da terra ---- */
  const dstep = Math.max(3, 8 - Math.round(P.dirt * 3));
  for (let GY = gridStart(PY - dstep, dstep); GY < PY + W + dstep; GY += dstep) {
    for (let GX = gridStart(PX - dstep, dstep); GX < PX + W + dstep; GX += dstep) {
      const x = GX + ((ihash(GX, GY, sd + 61) * dstep) | 0);
      const y = GY + ((ihash(GX, GY, sd + 62) * dstep) | 0);
      const lx = x - PX, ly = y - PY;
      if (lx < -8 || ly < -8 || lx >= W + 8 || ly >= W + 8) continue;
      const i = at(x, y);
      if (lx >= 0 && ly >= 0 && lx < W && ly < W && (mat[i] === M_GRASS || gl[i] >= 2)) continue;
      const wx = x / D, wy = y / D;
      const clump = per.fbm(wx * 0.5 + 31, wy * 0.5 + 17, 2) * 0.5 + 0.5;
      if (ihash(x, y, sd + 63) > P.dirt * (0.25 + 1.5 * clump) * 0.58) continue;

      const kind = ihash(x, y, sd + 64);
      if (kind < 0.40) {
        const st = PEBBLES[(ihash(x, y, sd + 65) * PEBBLES.length) | 0];
        stamp(st, x, y, M_ROCK, 2 + (ihash(x, y, sd + 66) > 0.6 ? 1 : 0), ihash(x, y, sd + 67) > 0.5);
      } else if (kind < 0.70) {
        let cxp = x, cyp = y;
        const len = 3 + ((ihash(x, y, sd + 68) * 4) | 0);
        const dirx = ihash(x, y, sd + 69) > 0.5 ? 1 : -1;
        for (let k = 0; k < len; k++) {
          put(cxp, cyp, mat[at(cxp, cyp)] === M_SAND ? M_SAND : M_DIRT, 1);
          cxp += dirx; if (ihash(cxp, cyp, sd + 70) > 0.55) cyp += ihash(cxp, cyp, sd + 71) > 0.5 ? 1 : -1;
        }
      } else if (kind < 0.86) {
        const n = 2 + ((ihash(x, y, sd + 72) * 4) | 0);
        for (let k = 0; k < n; k++) {
          const ox = ((ihash(x + k, y, sd + 73) * 5) | 0) - 2, oy = ((ihash(x, y + k, sd + 74) * 4) | 0) - 1;
          const j = at(x + ox, y + oy);
          put(x + ox, y + oy, mat[j], idx[j] + (ihash(x + k, y + k, sd + 75) > 0.5 ? 1 : -1));
        }
      } else {
        const w2 = 2 + ((ihash(x, y, sd + 76) * 3) | 0);
        for (let k = 0; k < w2; k++) put(x + k, y + (k === 1 ? 1 : 0), M_DIRT, 1);
      }
    }
  }

  /* ---- passo 4: vegetação ---- */
  const sp = Math.max(2, P.clusterSize);

  // Moitas graúdas
  const bstep = Math.max(9, Math.round(D * 1.5));
  for (let GY = gridStart(PY - bstep, bstep); GY < PY + W + bstep; GY += bstep) {
    for (let GX = gridStart(PX - bstep, bstep); GX < PX + W + bstep; GX += bstep) {
      const x = GX + ((ihash(GX, GY, sd + 201) * bstep) | 0);
      const y = GY + ((ihash(GX, GY, sd + 202) * bstep) | 0);
      const c0 = at(x, y);
      if (x - PX < -10 || y - PY < -10 || x - PX >= W + 10 || y - PY >= W + 10) continue;
      if (gl[c0] < 3) continue;
      if (!BIOMES[bio[c0]].bushes) continue;
      if (ihash(x, y, sd + 203) > 0.42 * P.tuft) continue;
      const r  = 2.2 + ihash(x, y, sd + 204) * 2.6;
      const ph2 = ihash(x, y, sd + 205) * 6.283;
      const R  = Math.ceil(r) + 2;
      for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
        const lx = x + ox - PX, ly = y + oy - PY;
        if (lx < 0 || ly < 0 || lx >= W || ly >= W) continue;
        const j = ly * W + lx;
        if (gl[j] < 2) continue;
        const a  = Math.atan2(oy, ox);
        const rr = r * (1 + 0.24 * Math.sin(a * 3 + ph2) + 0.12 * Math.sin(a * 5 - ph2 * 1.6));
        const d  = Math.sqrt(ox * ox + oy * oy);
        if (d > rr) continue;
        const edge = rr - d;
        let v = 2;
        if (edge < 1.15 && oy <= 0) v = 4;
        else if (edge < 1.35) v = 1;
        else if (oy < -r * 0.3) v = 3;
        mat[j] = M_GRASS; idx[j] = clamp(v, 0, RL - 1);
      }
    }
  }

  const ptuft = [0.00, 0.30, 0.55, 0.80, 0.97];
  for (let GY = gridStart(PY - sp, sp); GY < PY + W + sp; GY += sp) {
    for (let GX = gridStart(PX - sp, sp); GX < PX + W + sp; GX += sp) {
      const x = GX + ((ihash(GX, GY, sd + 81) * sp) | 0), y = GY + ((ihash(GX, GY, sd + 82) * sp) | 0);
      if (x - PX < -8 || y - PY < -8 || x - PX >= W + 8 || y - PY >= W + 8) continue;
      const i = at(x, y);

      const wx = x / D, wy = y / D;
      const clump = per.fbm(wx * 0.42 + 61.3, wy * 0.42 + 22.7, 2) * 0.5 + 0.5;
      const lvl = gl[i];
      let spill = false, ox = 0, oy = 0;

      if (lvl === 0) {
        const near = 0.475 - gv[i];
        if (near < 0 || near > 0.13 * P.spill) continue;
        spill = true;
        const gxv = gv[at(x + 2, y)] - gv[at(x - 2, y)];
        const gyv = gv[at(x, y + 2)] - gv[at(x, y - 2)];
        const len = Math.hypot(gxv, gyv) + 1e-5;
        const reach = 1 + ihash(x, y, sd + 94) * 3;
        ox = Math.round(-gxv / len * reach);
        oy = Math.round(-gyv / len * reach);
      }

      const BI = BIOMES[bio[i]];
      let p = (spill ? 0.46 * P.spill : ptuft[lvl]) * (0.30 + 1.45 * clump) * P.tuft * BI.vegDens;
      if (mat[i] === M_ROCK) p *= 0.45;
      if (mat[i] === M_SAND) p *= 0.30;
      if (ihash(x, y, sd + 85) > p) continue;

      let want = spill ? (ihash(x, y, sd + 95) > 0.62 ? 2 : 1)
                       : clamp(Math.round(lvl * 0.9 + (P.clusterSize - 4) * 0.5 + (ihash(x, y, sd + 86) > 0.7 ? 1 : 0)), 1, 4);
      if (BI.veg === 'alpino')   want = Math.min(want, 2);
      if (BI.veg === 'conifera') want = clamp(want + 1, 2, 3);
      const pool = BI.veg === 'conifera' ? CONIF
                 : (spill && ihash(x, y, sd + 87) > 0.45 ? BLADES : TUFTS);
      const cands = pool.filter(s => s.c === want);
      const set = cands.length ? cands : pool;
      const st = set[(ihash(x, y, sd + 88) * set.length) | 0];

      const tone = cluster(x * 0.6 + 13, y * 0.6 + 5, sd + 18);
      const q = Math.min(P.greens - 1, Math.floor(tone * P.greens));
      const spread = P.greens >= 5 ? 3 : 2;
      const off = Math.round((q / Math.max(1, P.greens - 1) - 0.5) * spread);
      let base = 3 + off;
      if (spill) base = clamp(base, 2, RL - 2);

      const sx = x + ox - ((st.w / 2) | 0), sy2 = y + oy - ((st.h / 2) | 0);
      stamp(st, sx, sy2, M_GRASS, clamp(base, 0, RL - 1), ihash(x, y, sd + 89) > 0.5);

      if (want >= 2) {
        for (let c = 0; c < st.w; c++) {
          if (ihash(x + c, y, sd + 90) > 0.55) continue;
          const lxx = sx + c - PX, lyy = sy2 + st.h - PY;
          if (lxx < 0 || lyy < 0 || lxx >= W || lyy >= W) continue;
          const j = lyy * W + lxx;
          idx[j] = clamp(idx[j] - 1, 0, RL - 1);
        }
      }
      if (lvl === 4 && ihash(x, y, sd + 91) > 0.975) put(x, y, M_ACC, (ihash(x, y, sd + 92) * 3) | 0);
    }
  }

  /* ---- passo 4b: sombra da manta de grama sobre a terra ---- */
  for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
    const i = ly * W + lx;
    if (mat[i] === M_GRASS || mat[i] === M_ACC) continue;
    const up = ly > 0   && mat[(ly - 1) * W + lx] === M_GRASS;
    const rt = lx < W - 1 && mat[ly * W + lx + 1] === M_GRASS;
    const ramp = RAMPS[bio[i]][mat[i]];
    if (up || rt) idx[i] = clamp(idx[i] - 2, 0, ramp.length - 1);
    else if (ly > 1 && mat[(ly - 2) * W + lx] === M_GRASS && cluster(PX + lx, PY + ly, sd + 56) > 0.42)
      idx[i] = clamp(idx[i] - 1, 0, ramp.length - 1);
  }

  /* ---- passo 4b2: a face de grama do mesmo vinco ---- */
  for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
    const i = ly * W + lx;
    if (mat[i] !== M_GRASS) continue;
    const dn = ly < W - 1 && mat[(ly + 1) * W + lx] !== M_GRASS;
    const lf = lx > 0   && mat[ly * W + lx - 1] !== M_GRASS;
    const up = ly > 0   && mat[(ly - 1) * W + lx] !== M_GRASS;
    const rt = lx < W - 1 && mat[ly * W + lx + 1] !== M_GRASS;
    if (dn || lf) {
      if (cluster(PX + lx + 61, PY + ly + 7, sd + 60) > 0.24) idx[i] = clamp(idx[i] - 2, 0, RL - 1);
    } else if ((up || rt) && cluster(PX + lx + 5, PY + ly + 29, sd + 61) > 0.48) {
      idx[i] = clamp(idx[i] + 1, 0, RL - 1);
    }
  }

  /* ---- passo 4c: sombra de contato terra -> rocha ---- */
  for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
    const i = ly * W + lx;
    if (mat[i] !== M_ROCK) continue;
    let near = 0;
    for (let k = 1; k <= 2; k++) {
      const a = mat[Math.max(0, ly - k) * W + lx];
      const b = mat[ly * W + Math.min(W - 1, lx + k)];
      if (a === M_DIRT || a === M_SAND || b === M_DIRT || b === M_SAND) { near = k === 1 ? 2 : 1; break; }
    }
    if (!near) continue;
    if (cluster(PX + lx + 31, PY + ly + 13, sd + 58) < 0.32) near--;
    if (near > 0) idx[i] = clamp(idx[i] - near, 0, RL - 1);
  }
  for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
    const i = ly * W + lx;
    if (mat[i] !== M_DIRT && mat[i] !== M_SAND) continue;
    const a = mat[Math.max(0, ly - 1) * W + lx];
    const b = mat[ly * W + Math.min(W - 1, lx + 1)];
    if (a !== M_ROCK && b !== M_ROCK) continue;
    if (cluster(PX + lx + 17, PY + ly + 43, sd + 59) < 0.28) continue;
    idx[i] = clamp(idx[i] - 1, 0, RL - 1);
  }

  /* ---- passo 5: cavidade + encosta escurecem ---- */
  const blur = new Float32Array(nT);
  const RB = Math.max(2, Math.round(D * 0.20));
  for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
    let s = 0, n = 0;
    for (let k = -RB; k <= RB; k += 2) {
      const a = clamp(lx + k, 0, W - 1), b = clamp(ly + k, 0, W - 1);
      s += hT[ly * W + a] + hT[b * W + lx]; n += 2;
    }
    blur[ly * W + lx] = s / n;
  }

  /* ---- passo 6: índices -> RGB, recortando a margem ---- */
  const nC  = CW * CW;
  const img  = new Uint8ClampedArray(nC * 4);
  const imgD = new Uint8ClampedArray(nC * 4);
  const bimg = new Uint8ClampedArray(nC * 4);
  for (let cy = 0; cy < CW; cy++) for (let cx = 0; cx < CW; cx++) {
    const lx = cx + M, ly = cy + M, i = ly * W + lx, o = (cy * CW + cx) * 4;
    const dth = (cluster(PX + lx + 55, PY + ly + 77, sd + 33) - 0.5) * 0.085;
    const cav = hT[i] - blur[i] + dth;
    let sh = 0;
    if (cav < -0.055) sh = 1;
    if (cav < -0.180) sh = 2;
    if (slT[i] + (cluster(PX + lx + 3, PY + ly + 91, sd + 34) - 0.5) * 0.55 > 1.45) sh += 1;

    const ramp = RAMPS[bio[i]][mat[i]];
    const v0 = clamp(idx[i] - sh, 0, ramp.length - 1);
    const c  = ramp[v0];
    const cd = ramp[clamp(v0 - 1, 0, ramp.length - 1)];
    const a  = (mat[i] === M_GRASS || mat[i] === M_ACC) ? 255 : 0;
    img[o]     = c[0];  img[o + 1] = c[1];  img[o + 2] = c[2];  img[o + 3] = a;
    imgD[o]    = cd[0]; imgD[o + 1] = cd[1]; imgD[o + 2] = cd[2]; imgD[o + 3] = a;
    bimg[o]    = bio[i]; bimg[o + 3] = 255;
  }
  return { img, imgD, bimg, width: CW, height: CW };
}

/* =========================================================================
   FABRICANTE DE TEXTURAS DATA_TEXTURE (THREE.JS)
   ========================================================================= */
export function makeTexture(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  repeat: boolean,
  mips: boolean
): THREE.DataTexture {
  const t = new THREE.DataTexture(data as any, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mips ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  t.generateMipmaps = !!mips;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/* =========================================================================
   CLASSE PRINCIPAL: TerrainTextureForge
   ========================================================================= */
export class TerrainTextureForge {
  private static instance?: TerrainTextureForge;
  public params: ForgeParams;
  public readonly perlin: { noise: (x: number, y: number) => number; fbm: (x: number, y: number, oct?: number) => number };
  public readonly wallA: THREE.DataTexture;
  public readonly wallB: THREE.DataTexture;
  public readonly wallC: THREE.DataTexture;
  public readonly wallD: THREE.DataTexture;
  public readonly gradMap: THREE.DataTexture;
  public density: number;

  constructor(seed: number = 42, density: number = DEFAULT_D) {
    this.density = density;
    this.params = { ...DEFAULT_FORGE_PARAMS, seed };
    this.perlin = makePerlin(seed);

    // Atlas de paredes verticais (128 de largura, 128 * 3 = 384 de altura)
    const AH = WALL * NB;
    this.wallA = makeTexture(buildWallAtlas(this.params, 'wallHi', 0), WALL, AH, true, false);
    this.wallB = makeTexture(buildWallAtlas(this.params, 'wallLo', 0), WALL, AH, true, false);
    this.wallC = makeTexture(buildWallAtlas(this.params, 'wallLo', 2), WALL, AH, true, false);
    this.wallD = makeTexture(buildWallAtlas(this.params, 'wallHi', 1), WALL, AH, true, false);

    for (const t of [this.wallA, this.wallB, this.wallC, this.wallD]) {
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
    }

    // Rampa toon com 3 passos para iluminação em faixas planas
    this.gradMap = new THREE.DataTexture(
      new Uint8Array([126, 126, 126, 255, 196, 196, 196, 255, 255, 255, 255, 255]),
      3, 1, THREE.RGBAFormat
    );
    this.gradMap.magFilter = THREE.NearestFilter;
    this.gradMap.minFilter = THREE.NearestFilter;
    this.gradMap.generateMipmaps = false;
    this.gradMap.needsUpdate = true;
  }

  public updateParams(newParams: Partial<ForgeParams>, newDensity?: number): void {
    Object.assign(this.params, newParams);
    if (newDensity !== undefined && newDensity > 0) {
      this.density = newDensity;
    }
    this.rebuildWallAtlases();
  }

  public rebuildWallAtlases(): void {
    const a = buildWallAtlas(this.params, 'wallHi', 0);
    const b = buildWallAtlas(this.params, 'wallLo', 0);
    const c = buildWallAtlas(this.params, 'wallLo', 2);
    const d = buildWallAtlas(this.params, 'wallHi', 1);

    (this.wallA.image as any).data.set(a);
    (this.wallB.image as any).data.set(b);
    (this.wallC.image as any).data.set(c);
    (this.wallD.image as any).data.set(d);

    this.wallA.needsUpdate = true;
    this.wallB.needsUpdate = true;
    this.wallC.needsUpdate = true;
    this.wallD.needsUpdate = true;
  }

  public static getInstance(seed?: number): TerrainTextureForge {
    if (!TerrainTextureForge.instance) {
      TerrainTextureForge.instance = new TerrainTextureForge(seed ?? 42);
    }
    return TerrainTextureForge.instance;
  }

  public generateChunkTextures(
    minWorldX: number,
    minWorldZ: number,
    chunkSize: number,
    terrainGen: TerrainGenerator
  ): { topTex: THREE.DataTexture; topDarkTex: THREE.DataTexture; bioTex: THREE.DataTexture } {
    const res = genChunkTexture(
      this.params,
      this.perlin,
      terrainGen,
      minWorldX,
      minWorldZ,
      chunkSize,
      this.density
    );

    const topTex = makeTexture(res.img, res.width, res.height, false, false);
    const topDarkTex = makeTexture(res.imgD, res.width, res.height, false, false);
    const bioTex = makeTexture(res.bimg, res.width, res.height, false, false);

    return { topTex, topDarkTex, bioTex };
  }

  public dispose(): void {
    this.wallA.dispose();
    this.wallB.dispose();
    this.wallC.dispose();
    this.wallD.dispose();
    this.gradMap.dispose();
  }
}
