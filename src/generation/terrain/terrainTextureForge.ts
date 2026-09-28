import * as THREE from 'three';
import { TerrainGenerator } from './terrainGenerator.ts';
import { CONFIG } from '../../config.ts';
import { getTextureWorkerPool } from './textureWorkerPool.ts';
import type { ChunkGeometryData } from './chunkGeometry.ts';
import { BiomeType } from '../types.ts';

/* =========================================================================
   PALETAS (indexadas — 6 tons por rampa de material)
   Portado fielmente de pixel-terrain-forge.html
   ========================================================================= */
export const M_SHORE = 0, M_GROUND = 1, M_ROCK = 2, M_VEG = 3, M_ACC = 4;
export const M_SAND = M_SHORE, M_DIRT = M_GROUND, M_GRASS = M_VEG;
export const RL = 6;

// Temperado - paleta de diorama pixel-art: terra ocre com sombras marrom-avermelhadas e roxas,
// grama verde viva com realce amarelado e sombra azul-petróleo, rocha cinza-esverdeada, areia creme.
export const SAND: [number, number, number][]  = [[160,92,64],[204,140,84],[226,180,124],[240,210,148],[246,224,162],[252,238,192]];
export const DIRT: [number, number, number][]  = [[64,46,56],[112,50,50],[160,90,58],[202,138,82],[210,184,74],[230,206,112]];
export const ROCK: [number, number, number][]  = [[30,24,34],[74,50,60],[98,110,98],[134,148,130],[182,188,162],[216,216,192]];
export const GRASS: [number, number, number][] = [[32,56,64],[48,112,64],[72,140,90],[90,186,50],[160,194,72],[198,222,112]];
export const ACC: [number, number, number][]   = [[214,196,92],[236,214,120],[224,142,86]];

// Montanhoso
export const TALUS: [number, number, number][]   = [[48,46,44],[74,72,68],[104,102,96],[136,134,126],[168,166,156],[198,196,186]];
export const SCREE: [number, number, number][]   = [[32,28,38],[56,50,60],[86,80,88],[118,112,114],[152,146,140],[188,182,170]];
export const GRANITE: [number, number, number][] = [[44,46,56],[70,74,88],[102,108,124],[138,144,160],[174,180,194],[210,214,226]];
export const ALPINE: [number, number, number][]  = [[16,36,24],[26,58,32],[40,84,40],[58,110,50],[88,144,64],[126,180,90]];
export const ACC_M: [number, number, number][]   = [[198,186,150],[220,210,180],[176,150,110]];

// Vulcânico (usa o índice do antigo "montanhoso": só o vulcão cai nele) - cinza vulcânica
// marrom, basalto cinza-chumbo com sombras quase pretas, mato seco e acentos de cinza clara
export const ASHSAND: [number, number, number][] = [[64,50,46],[96,76,64],[128,104,84],[156,130,104],[180,154,124],[204,180,146]];
export const ASH: [number, number, number][]     = [[52,38,38],[82,60,54],[112,84,68],[140,108,84],[164,130,102],[190,156,122]];
export const BASALT: [number, number, number][]  = [[22,20,24],[40,38,42],[60,58,62],[86,84,88],[116,114,116],[150,148,146]];
export const DRYGRASS: [number, number, number][] = [[24,20,22],[40,32,30],[60,46,38],[86,64,48],[116,86,58],[150,112,72]];
export const ASH_ACC: [number, number, number][] = [[104,86,72],[136,114,94],[92,62,52]];

// Polar
export const ICE: [number, number, number][]     = [[92,128,170],[128,166,204],[168,202,230],[204,228,246],[228,242,252],[248,252,255]];
export const SNOW: [number, number, number][]    = [[60,68,108],[104,120,166],[160,180,218],[206,220,240],[236,243,251],[255,255,255]];
export const FROZEN: [number, number, number][]  = [[34,30,36],[64,58,58],[96,90,88],[132,128,124],[170,168,164],[208,208,206]];
export const CONIFER: [number, number, number][] = [[10,28,26],[18,46,38],[26,68,52],[38,92,66],[58,120,84],[92,152,110]];
export const ACC_P: [number, number, number][]   = [[196,222,240],[224,240,250],[150,190,220]];

// Deserto
export const DUNE: [number, number, number][]      = [[150,84,70],[196,120,92],[224,156,112],[240,186,138],[248,210,164],[252,230,196]];
export const SANDSTONE: [number, number, number][] = [[112,52,28],[146,72,36],[180,98,50],[208,128,68],[228,158,92],[242,190,128]];
export const REDROCK: [number, number, number][]   = [[70,36,28],[104,54,38],[138,76,50],[170,102,66],[198,132,90],[222,166,122]];
export const SCRUB: [number, number, number][]     = [[58,58,28],[82,82,36],[110,106,46],[140,132,58],[170,160,78],[200,190,110]];
export const ACC_D: [number, number, number][]     = [[226,190,96],[240,214,140],[196,118,70]];

export const B_TEMP = 0, B_MOUNT = 1, B_POLAR = 2, B_DESERT = 3;

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
    ground:'canais', wallHi:'terra',   wallLo:'bloco',
    veg:'tufo',     vegBias: 0.00, rockBias: 0.00, vegDens:1.00, bushes:true },
  { key:'montanha',  label:'Vulcânico', swatch:'#4a3a36',
    ramps:[ASHSAND, ASH, BASALT, DRYGRASS, ASH_ACC],
    ground:'cinza',  wallHi:'basalto',  wallLo:'basalto',
    veg:'alpino',   vegBias:-0.20, rockBias: 0.34, vegDens:0.45, bushes:false },
  { key:'polar',     label:'Polar', swatch:'#d6e4f0',
    ramps:[ICE,   SNOW,  FROZEN,  CONIFER, ACC_P],
    ground:'neve',   wallHi:'gelo',    wallLo:'seixo',
    veg:'conifera', vegBias:-0.30, rockBias: 0.12, vegDens:0.30, bushes:false },
  { key:'deserto',   label:'Deserto', swatch:'#d08a4a',
    ramps:[DUNE,  SANDSTONE, REDROCK, SCRUB, ACC_D],
    ground:'dunas',  wallHi:'fratura', wallLo:'bloco',
    veg:'tufo',     vegBias:-0.35, rockBias: 0.10, vegDens:0.20, bushes:false },
];

export const NB = BIOMES.length;
export const RAMPS = BIOMES.map(b => b.ramps);

/**
 * Mapeia o bioma ECOLÓGICO real (o mesmo BiomeType usado pela vegetação, via
 * BiomeManager.evaluateBiome) para uma das paletas de chão do Pixel Terrain Forge.
 * Antes, a textura decidia sozinha (com seu próprio limiar de altura/temperatura) se um pixel
 * era "polar" - podendo discordar da vegetação, que já plantava pinheiros nevados sobre chão
 * pintado de areia/terra temperada. Usar a MESMA fonte de verdade elimina essa divergência.
 */
export const BIOME_TYPE_TO_FORGE: Partial<Record<BiomeType, number>> = {
  [BiomeType.FROZEN_TUNDRA]: 2,
  [BiomeType.SNOW_SUMMIT]: 2,
  [BiomeType.CANYON_DESERT]: B_DESERT,
  [BiomeType.DESERT_DUNES]: B_DESERT,
  [BiomeType.VOLCANIC_FIELD]: 1,
  [BiomeType.VOLCANIC_CALDERA]: 1,
  // Deliberadamente de fora: ROCKY_PEAKS dispara em QUALQUER encosta íngreme (slope > 0.56),
  // não só em maciços de verdade — a parede já ganha rocha própria no shader via biplanar,
  // independente do bioma. ALPINE_TUNDRA e GEOTHERMAL_VALLEY cobrem áreas enormes e contínuas
  // (qualquer terreno alto e frio, ou perto de qualquer fonte termal) — virar talus/granito
  // cinza sólido numa região tão grande ficava monótono e nada natural; melhor deixar essas
  // no chão temperado normal e confiar só na vegetação (líquens, pinheiros esparsos) pra
  // comunicar "tundra alpina", como o resto do jogo já faz.
};

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
  return ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10; // = / 2^32, exato e mais barato
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
export const BAYER4_F32 = new Float32Array([
  0/16 - 0.46875,  8/16 - 0.46875,  2/16 - 0.46875, 10/16 - 0.46875,
 12/16 - 0.46875,  4/16 - 0.46875, 14/16 - 0.46875,  6/16 - 0.46875,
  3/16 - 0.46875, 11/16 - 0.46875,  1/16 - 0.46875,  9/16 - 0.46875,
 15/16 - 0.46875,  7/16 - 0.46875, 13/16 - 0.46875,  5/16 - 0.46875
]);
export const bayer = (x: number, y: number) => BAYER4_F32[((y & 3) << 2) | (x & 3)];

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

/** Célula de Voronoi tileável com id da célula (para pintar cada bloco com sua própria faceta). */
export function facetCell(x: number, y: number, cell: number, seed: number, wrap: number) {
  const fx = x / cell, fy = y / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const cw = Math.floor(wrap / cell);
  let minD = 999, sD = 999, px = 0, py = 0, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    const rx = ((cx % cw) + cw) % cw, ry = ((cy % cw) + cw) % cw;
    // células mais largas que altas (blocos de rocha deitados)
    const ddx = cx + 0.15 + 0.70 * ihash(rx, ry, seed) - fx;
    const ddy = (cy + 0.15 + 0.70 * ihash(rx, ry, seed + 97) - fy) * 1.25;
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d < minD) { sD = minD; minD = d; px = ddx; py = ddy; id = ihash(rx, ry, seed + 211); }
    else if (d < sD) sD = d;
  }
  return { edge: sD - minD, px, py, id };
}

/**
 * Estilhaços triangulares tileáveis: grade com pontos deslocados, cada célula cortada numa
 * diagonal sorteada. Devolve o id do triângulo e a distância (em px) até a aresta mais próxima,
 * com o id dessa aresta (para marcar só algumas como fenda).
 */
/**
 * Grade tileável de "saliências" (linhas de alturas variadas, cada linha cortada em segmentos
 * desencontrados, como tijolos). Devolve a posição normalizada dentro do segmento:
 * u = 0 no topo e 1 na base, s = 0..1 da esquerda para a direita, e ids da linha/segmento.
 */
export function ledgeCell(x: number, y: number, rows: number[], segs: number[], seed: number, wrap: number) {
  const yy = ((y % wrap) + wrap) % wrap;
  let r = 0, y0 = 0;
  while (r < rows.length - 1 && yy >= y0 + rows[r]) { y0 += rows[r]; r++; }
  const h = rows[r], n = segs[r % segs.length];
  const off = ihash(r, 0, seed) * wrap;
  const xx = ((((x - off) % wrap) + wrap) % wrap);
  const sw = wrap / n;
  let k = Math.floor(xx / sw);
  // limites dos segmentos com jitter (o jitter do último limite coincide com o do primeiro)
  const edge = (i: number) => i * sw + (ihash(r, ((i % n) + n) % n + 1, seed + 5) - 0.5) * sw * 0.5;
  if (xx < edge(k)) k--; else if (xx >= edge(k + 1)) k++;
  const a = edge(k), b = edge(k + 1);
  return { u: (yy - y0) / h, s: (xx - a) / (b - a), row: r, id: ihash(r, ((k % n) + n) % n, seed + 9), h, w: b - a };
}

/** Voronoi tileável em células cw x ch: F1, F2 (em unidades de célula) e id da célula mais próxima. */
export function worleyT(x: number, y: number, cw: number, ch: number, W: number, H: number, seed: number) {
  const nx = Math.max(1, Math.round(W / cw)), ny = Math.max(1, Math.round(H / ch));
  const fx = x * nx / W, fy = y * ny / H, ix = Math.floor(fx), iy = Math.floor(fy);
  let f1 = 9, f2 = 9, id = 0, vx = 0, vy = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    const rx = ((cx % nx) + nx) % nx, ry = ((cy % ny) + ny) % ny;
    const px = cx + 0.1 + 0.8 * ihash(rx, ry, seed), py = cy + 0.1 + 0.8 * ihash(rx, ry, seed + 1);
    const d = Math.hypot(px - fx, py - fy);
    if (d < f1) { f2 = f1; f1 = d; id = ihash(rx, ry, seed + 2); vx = fx - px; vy = fy - py; } else if (d < f2) f2 = d;
  }
  return { f1, f2, id, vx, vy };
}

/**
 * Relevo facetado de pedra lascada: cada célula de Voronoi vira uma pirâmide baixa de 3 faces
 * planas (girada ao acaso), com a face iluminada pela direção da luz. Arestas vivas e tons
 * chapados por face - o oposto das cúpulas lisas, que liam como lama.
 */
type FacetOpts = { cw: number; ch: number; tilt: number; lx: number; ly: number; lz: number; warp: number; sub: number; up: number };
const reliefCache = new Map<string, ReturnType<typeof facetReliefRaw>>();
export function facetRelief(W: number, H: number, seed: number, o: FacetOpts) {
  // o mesmo relevo serve às variações de sombra do atlas (shade 0/1/2): calcula uma vez só
  const key = W + ':' + H + ':' + seed + ':' + JSON.stringify(o);
  let r = reliefCache.get(key);
  if (!r) { r = facetReliefRaw(W, H, seed, o); if (reliefCache.size > 32) reliefCache.clear(); reliefCache.set(key, r); }
  return r;
}
function facetReliefRaw(W: number, H: number, seed: number, o: FacetOpts) {
  const n = W * H, lum = new Float32Array(n), gap = new Float32Array(n), cid = new Float32Array(n);
  const ll = Math.hypot(o.lx, o.ly, o.lz), lx = o.lx / ll, ly = o.ly / ll, lz = o.lz / ll;
  const TAU = Math.PI * 2;
  // normal (x, y) da face da "pirâmide" de 3 faces em que o ponto cai
  const face = (px: number, py: number, rot: number, tilt: number): [number, number] => {
    const a = Math.atan2(py, px) - rot;
    const k = Math.floor((((a % TAU) + TAU) % TAU) / (TAU / 3));
    const ang = rot + (k + 0.5) * (TAU / 3);
    return [Math.cos(ang) * tilt, Math.sin(ang) * tilt];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // deformação em degraus (quantizada): arestas retas em trechos, não onduladas
    const wx = Math.round((tfbm2(x, y, 16, 16, W, H, seed + 11) - 0.5) * o.warp / 2) * 2;
    const wy = Math.round((tfbm2(x, y, 16, 16, W, H, seed + 12) - 0.5) * o.warp / 2) * 2;
    // massas grandes (volume do bloco) + lascas menores (planos da pedra)
    const A = worleyT(x + wx, y + wy, o.cw * 2.4, o.ch * 2.4, W, H, seed + 20);
    const B = worleyT(x + wx, y + wy, o.cw, o.ch, W, H, seed + 30);
    const ta = o.tilt * (0.7 + 0.6 * ihash((A.id * 1e6) | 0, 3, seed + 21));
    const [ax, ay] = face(A.vx, A.vy, A.id * TAU, ta);
    const [bx, by] = face(B.vx, B.vy, B.id * TAU, o.tilt * 0.55);
    const nx = ax + bx, ny = ay + by - o.up, nz = 1;
    const i = y * W + x;
    lum[i] = clamp((nx * lx + ny * ly + nz * lz) / Math.hypot(nx, ny, nz), 0, 1);
    gap[i] = Math.min(A.f2 - A.f1, (B.f2 - B.f1) * 1.8);
    cid[i] = B.id;
  }
  return { lum, gap, cid };
}

export function shardAt(x: number, y: number, cell: number, seed: number, wrap: number) {
  const n = Math.floor(wrap / cell);
  const P = (i: number, j: number): [number, number] => {
    const ri = ((i % n) + n) % n, rj = ((j % n) + n) % n;
    return [i * cell + (ihash(ri, rj, seed) - 0.5) * cell * 0.7, j * cell + (ihash(ri, rj, seed + 7) - 0.5) * cell * 0.7];
  };
  const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
  const side = (ax: number, ay: number, bx: number, by: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const segDist = (ax: number, ay: number, bx: number, by: number) => {
    const vx = bx - ax, vy = by - ay, t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy), 0, 1);
    return Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
  };
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj;
    const a = P(i, j), b = P(i + 1, j), cc = P(i, j + 1), d = P(i + 1, j + 1);
    const ri = ((i % n) + n) % n, rj = ((j % n) + n) % n;
    const flip = ihash(ri, rj, seed + 13) > 0.5;
    const tris: [number, number][][] = flip ? [[a, b, d], [a, d, cc]] : [[a, b, cc], [b, d, cc]];
    for (let t = 0; t < 2; t++) {
      const [p, q, r] = tris[t];
      const s1 = side(p[0], p[1], q[0], q[1]), s2 = side(q[0], q[1], r[0], r[1]), s3 = side(r[0], r[1], p[0], p[1]);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
        const e = [segDist(p[0], p[1], q[0], q[1]), segDist(q[0], q[1], r[0], r[1]), segDist(r[0], r[1], p[0], p[1])];
        let k = 0; if (e[1] < e[k]) k = 1; if (e[2] < e[k]) k = 2;
        return { id: ihash(ri * 2 + t, rj, seed + 29), edge: e[k], edgeId: ihash(ri * 6 + t * 3 + k, rj, seed + 31) };
      }
    }
  }
  return { id: ihash(ci, cj, seed + 29), edge: 99, edgeId: 1 };
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
  grassMountain: number;
  grassPolar: number;
  rock: number;
  dirt: number;
  tuft: number;
  clusterSize: number;
  spill: number;
  greens: number;
  hang: number;
  pixelScale: number;
  /** Grama 3D: multiplicador da quantidade de tufos (0 = nenhum) */
  tuftAmount: number;
  /** Grama 3D: 0 = tufos espalhados por igual, 1 = agrupados em moitas cheias com vazios entre elas */
  tuftClump: number;
  /** Grama 3D: candidatos a tufo por metro quadrado (touceiras mais densas) */
  tuftPerM2: number;
  /** Grama 3D: multiplicador do tamanho dos tufos */
  tuftSize: number;
}

export const DEFAULT_FORGE_PARAMS: ForgeParams = {
  seed: 42,
  edge: 0.50,
  pscale: 2.2,
  grass: 0.15,
  grassMountain: 0.00,
  grassPolar: -0.10,
  rock: 0.40,
  dirt: 0.45,
  tuft: 0.85,
  clusterSize: 4,
  spill: 0.65,
  greens: 4,
  hang: 0.20,
  pixelScale: 1.0,
  tuftAmount: 1.25,
  tuftClump: 1.0,
  tuftPerM2: 6,
  tuftSize: 1.25,
};

export const MARGIN = 12;
export const WALL = 256;
export const DEFAULT_D = 8.0; // 8 texels por metro (chunk de 64m = 512x512 texels)

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
  // luz vindo de cima (o "topo" da textura, y negativo) e um pouco da esquerda. Lascas de terra e
  // de rocha menores (11x9 e 9x8 px): com 18x14 e 14x12 as pedras ficavam grandes nos paredões altos
  const relief = kind === 'terra'
    ? facetRelief(W, H, sd + 500, { cw: 11, ch: 9, tilt: 0.85, lx: -0.40, ly: -0.80, lz: 0.55, warp: 3, sub: 0.0, up: 0.30 })
    : kind === 'bloco'
    ? facetRelief(W, H, sd + 500, { cw: 9, ch: 8, tilt: 0.75, lx: -0.45, ly: -0.70, lz: 0.60, warp: 2, sub: 0.0, up: 0.15 })
    : kind === 'seixo'
    ? facetRelief(W, H, sd + 500, { cw: 11, ch: 10, tilt: 0.80, lx: -0.45, ly: -0.70, lz: 0.60, warp: 2, sub: 0.0, up: 0.10 })
    : kind === 'basalto'
    ? facetRelief(W, H, sd + 500, { cw: 12, ch: 11, tilt: 0.90, lx: -0.45, ly: -0.70, lz: 0.60, warp: 2, sub: 0.0, up: 0.05 })
    : kind === 'gelo'
    ? facetRelief(W, H, sd + 500, { cw: 16, ch: 13, tilt: 0.85, lx: -0.45, ly: -0.70, lz: 0.60, warp: 3, sub: 0.0, up: 0.10 })
    : null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (kind === 'terra') {
        // Barranco do diorama: saliências de terra arredondadas e largas. A face que olha para
        // cima é o mesmo ocre do chão; ao virar para baixo passa por laranja e marrom, e o vinco
        // entre saliências é vermelho-escuro / roxo quase preto.
        const i = y * W + x, L = relief!.lum[i], g = relief!.gap[i];
        let v = L > 0.86 ? 5 : L > 0.56 ? 4 : L > 0.40 ? 3 : L > 0.24 ? 2 : L > 0.06 ? 1 : 0;
        if (g < 0.04 && L < 0.20) v = 0;                                     // vinco quase preto só dentro da sombra
        if (v === 4 && tfbm2(x, y, 8, 4, W, H, sd + 84) < 0.24) v = 3;       // manchas laranja
        put(x, y, M_DIRT, v);

      } else if (kind === 'basalto') {
        // Paredão de basalto: blocos naturais graúdos (relevo facetado) em cinza-chumbo escuro,
        // só as faces de cima claras, grão fino de pixels soltos e juntas finas quase pretas
        const i = y * W + x, L = relief!.lum[i], g = relief!.gap[i];
        const l = L + (relief!.cid[i] - 0.5) * 0.16 + (tfbm2(x, y, 4, 4, W, H, sd + 313) - 0.5) * 0.10;
        let v = l > 0.86 ? 4 : l > 0.70 ? 3 : l > 0.46 ? 2 : 1;
        const gr = ihash(x, y, sd + 324);
        if (gr > 0.90) v += 1; else if (gr < 0.08) v -= 1;       // grão da pedra
        if (g < 0.022) v = 0;                                    // junta
        else if (g < 0.05 && L < 0.55) v = Math.min(v, 1);        put(x, y, M_ROCK, clamp(v, 0, 5));

      } else if (kind === 'gelo' || (kind === 'seixo' && (bioIdx | 0) === B_POLAR)) {
        // Encosta de inverno: rocha cinza-amarronzada facetada; as faces que olham para cima
        // seguram uma camada de neve (branca, com a beirada de baixo azulada). Os pingentes de
        // gelo são pendurados depois, sob a neve.
        const i = y * W + x, L = relief!.lum[i], g = relief!.gap[i];
        const snowT = kind === 'gelo' ? 0.70 : 0.76;
        if (L > snowT + (clusterT(x, y, W, H, sd + 71) - 0.5) * 0.08) {
          put(x, y, M_GROUND, L > snowT + 0.10 ? 5 : 4);
        } else {
          const l = L + (tfbm2(x, y, 2, 16, W, H, sd + 313) - 0.5) * 0.14 + (relief!.cid[i] - 0.5) * 0.14;
          let v = l > 0.58 ? 4 : l > 0.42 ? 3 : l > 0.26 ? 2 : 1;
          if (g < 0.04 && L < 0.5) v = 0;
          put(x, y, M_ROCK, v);
        }

      } else if (kind === 'seixo' || kind === 'bloco') {
        // Rocha do diorama: blocos robustos em facetas chapadas. O topo iluminado é creme, as
        // faces de frente cinza-sálvia, as de baixo caem para o cinza escuro e os vãos entre
        // blocos são roxo-amarronzados / quase pretos. Riscos verticais quebram as facetas.
        const i = y * W + x, L = relief!.lum[i], g = relief!.gap[i];
        const base = (bioIdx | 0) === B_TEMP ? 3 : 2;
        const st = tfbm2(x, y, 2, 16, W, H, sd + 313);
        const l = L + (st - 0.5) * 0.14 + (relief!.cid[i] - 0.5) * 0.16;
        let v = l > 0.84 ? base + 2 : l > 0.64 ? base + 1 : l > 0.42 ? base : l > 0.12 ? base - 1 : Math.max(1, base - 2);
        if (g < 0.03 && L < 0.55) v = 0;                                     // vão entre blocos, só no lado em sombra
        else if (g < 0.05 && L < 0.55) v = Math.min(v, 1);
        v = clamp(v, 0, base + 2);
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

  if (kind === 'gelo' || (kind === 'seixo' && (bioIdx | 0) === B_POLAR)) {
    // Beirada da neve: os 2 pixels de baixo de cada camada de neve ficam azulados
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const i = y * W + x, below = ((y + 1) % H) * W + x, below2 = ((y + 2) % H) * W + x;
      if (mat[i] !== M_GROUND) continue;
      if (mat[below] === M_ROCK) idx[i] = 3;
      else if (mat[below2] === M_ROCK) idx[i] = Math.min(idx[i], 4);
    }
    // Pingentes de gelo: nascem na beirada de baixo da neve, 1-2px de largura, afinando
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const i = y * W + x, below = ((y + 1) % H) * W + x;
      if (mat[i] !== M_GROUND || mat[below] !== M_ROCK) continue;
      // em grupos: alguns trechos de beirada têm vários, outros nenhum
      if (tfbm2(x, y, 16, 16, W, H, sd + 880) < 0.52) continue;
      if (ihash(x, y, sd + 881) > (kind === 'gelo' ? 0.45 : 0.30)) continue;
      const len = 3 + ((ihash(x, y, sd + 882) * (kind === 'gelo' ? 12 : 7)) | 0);
      const wide = ihash(x, y, sd + 883) > 0.55;
      for (let k = 1; k <= len; k++) {
        const yy = (y + k) % H;
        const tone = k > len - 2 ? 2 : k === 1 ? 5 : ((x + k) & 1) ? 4 : 3;
        const j = yy * W + x;
        if (mat[j] === M_GROUND) break;
        mat[j] = M_SHORE; idx[j] = tone; 
        if (wide && k < len * 0.6) {
          const j2 = yy * W + ((x + 1) % W);
          if (mat[j2] === M_ROCK) { mat[j2] = M_SHORE; idx[j2] = Math.max(2, tone - 1); }
        }
      }
    }
  }

  const isRockWall = (kind === 'seixo' || kind === 'bloco' || kind === 'basalto');
  // rachaduras horizontais / fendas verticais
  for (let k = 0; k < (isRockWall ? 0 : kind === 'terra' ? 0 : 52); k++) {
    const y0 = (ihash(k, 0, sd + 31) * H) | 0, x0 = (ihash(k, 1, sd + 32) * W) | 0;
    const len = 3 + ((ihash(k, 2, sd + 33) * 8) | 0);
    let cy = y0;
    for (let j = 0; j < len; j++) {
      put(x0 + j, cy, isRockWall ? M_ROCK : M_GROUND, isRockWall ? 0 : 1);
      if (ihash(k, j, sd + 34) > 0.72) cy += ihash(k, j, sd + 35) > 0.5 ? 1 : -1;
    }
  }
  // pedras embutidas na terra
  if (!isRockWall && kind !== 'gelo' && kind !== 'terra') {
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
    // As texturas de parede são desenhadas com a linha 0 no ALTO (luz de cima, pingentes que
    // descem), mas no shader a coordenada v cresce para cima (linha 0 = pé da parede): inverte.
    const img = genWallTexture(P, kind, shade, b), rowB = WALL * 4, base = b * WALL * WALL * 4;
    for (let y = 0; y < WALL; y++) out.set(img.subarray(y * rowB, (y + 1) * rowB), base + (WALL - 1 - y) * rowB);
  }
  return out;
}

/* =========================================================================
   GERAÇÃO DE TEXTURAS POR CHUNK (TOP, TOP_DARK + BIOMA)
   ========================================================================= */
export interface ChunkTextureResult {
  /** RGB = cor do topo, A = marca de vegetação (grama/acessório) */
  img: Uint8ClampedArray;
  /** RGB = um degrau mais escuro da paleta, A = índice do bioma (lido com texelFetch, sem filtro) */
  imgD: Uint8ClampedArray;
  /**
   * Tufos de grama 3D (só chunks comuns): 9 floats por tufo - x, y, z do mundo, escala, índice
   * do bioma, a inclinação do chão (dh/dx, dh/dz) e os multiplicadores de altura e largura.
   * y e a inclinação são os do triângulo da malha de relevo (grade de 2m), então o tufo assenta
   * exatamente na superfície desenhada.
   */
  grass?: Float32Array;
  width: number;
  height: number;
}

// Buffers de scratch pré-alocados para eliminar 100% da pressão sobre o Garbage Collector
let scratchCapacity = 0;
let sMat: Uint8Array;
let sIdx: Uint8Array;
let sGl: Uint8Array;
let sBio: Uint8Array;
let sGv: Float32Array;
let sHt: Float32Array;
let sSlT: Float32Array;
let sMacroM: Float32Array;
let sMacroRk: Float32Array;
let sMacroSn: Float32Array;
let sMacroBig: Float32Array;
let sMacroCh1: Float32Array;
let sMacroChL: Float32Array;
let sMacroWide: Float32Array;
let sMacroPatch: Float32Array;
let sWet: Float32Array;
let sSpecialRock: Float32Array;
let sCanyon: Float32Array;

let scratchGridCap = 0;
let sGridH: Float32Array;
let sGridSpecialRock: Float32Array;
let sGridCanyon: Float32Array;
let sGridM: Float32Array;
let sGridRk: Float32Array;
let sGridSn: Float32Array;
let sGridBig: Float32Array;
let sGridCh1: Float32Array;
let sGridChL: Float32Array;
let sGridWide: Float32Array;
let sGridPatch: Float32Array;
let sGridWet: Float32Array;

let scratchBioGridCap = 0;
let sBioGridCat: Uint8Array;

let scratchWCap = 0;
let sGx: Int32Array;
let sTx: Float32Array;
let sOtx: Float32Array;
let sGy: Int32Array;
let sTy: Float32Array;
let sOty: Float32Array;
let sBGx: Int32Array;
let sBTx: Float32Array;
let sBOtx: Float32Array;
let sBGy: Int32Array;
let sBTy: Float32Array;
let sBOty: Float32Array;

function ensureScratch(nT: number, nG: number, nBG: number, W: number) {
  if (scratchCapacity < nT) {
    scratchCapacity = Math.max(nT, 65536);
    sMat = new Uint8Array(scratchCapacity);
    sIdx = new Uint8Array(scratchCapacity);
    sGl = new Uint8Array(scratchCapacity);
    sBio = new Uint8Array(scratchCapacity);
    sGv = new Float32Array(scratchCapacity);
    sHt = new Float32Array(scratchCapacity);
    sSlT = new Float32Array(scratchCapacity);
    sMacroM = new Float32Array(scratchCapacity);
    sMacroRk = new Float32Array(scratchCapacity);
    sMacroSn = new Float32Array(scratchCapacity);
    sMacroBig = new Float32Array(scratchCapacity);
    sMacroCh1 = new Float32Array(scratchCapacity);
    sMacroChL = new Float32Array(scratchCapacity);
    sMacroWide = new Float32Array(scratchCapacity);
    sMacroPatch = new Float32Array(scratchCapacity);
    sWet = new Float32Array(scratchCapacity);
    sSpecialRock = new Float32Array(scratchCapacity);
    sCanyon = new Float32Array(scratchCapacity);
  }
  if (scratchGridCap < nG) {
    scratchGridCap = Math.max(nG, 4096);
    sGridH = new Float32Array(scratchGridCap);
    sGridSpecialRock = new Float32Array(scratchGridCap);
    sGridCanyon = new Float32Array(scratchGridCap);
    sGridM = new Float32Array(scratchGridCap);
    sGridRk = new Float32Array(scratchGridCap);
    sGridSn = new Float32Array(scratchGridCap);
    sGridBig = new Float32Array(scratchGridCap);
    sGridCh1 = new Float32Array(scratchGridCap);
    sGridChL = new Float32Array(scratchGridCap);
    sGridWide = new Float32Array(scratchGridCap);
    sGridPatch = new Float32Array(scratchGridCap);
    sGridWet = new Float32Array(scratchGridCap);
  }
  if (scratchBioGridCap < nBG) {
    scratchBioGridCap = Math.max(nBG, 256);
    sBioGridCat = new Uint8Array(scratchBioGridCap);
  }
  if (scratchWCap < W) {
    scratchWCap = Math.max(W, 512);
    sGx = new Int32Array(scratchWCap);
    sTx = new Float32Array(scratchWCap);
    sOtx = new Float32Array(scratchWCap);
    sGy = new Int32Array(scratchWCap);
    sTy = new Float32Array(scratchWCap);
    sOty = new Float32Array(scratchWCap);
    sBGx = new Int32Array(scratchWCap);
    sBTx = new Float32Array(scratchWCap);
    sBOtx = new Float32Array(scratchWCap);
    sBGy = new Int32Array(scratchWCap);
    sBTy = new Float32Array(scratchWCap);
    sBOty = new Float32Array(scratchWCap);
  }
}

// Cada passo pesado de genChunkTexture fica numa função própria `(() => { ... })()`: numa função
// de ~850 linhas com vários laços em sequência o V8 compilava cada laço sob demanda e desotimizava
// a cada chamada (~100 desotimizações por dúzia de chunks); separados, cada passo é otimizado uma
// vez e reaproveitado em todos os chunks.
export function genChunkTexture(
  P: ForgeParams,
  per: { fbm: (x: number, y: number, oct?: number) => number },
  terrainGen: TerrainGenerator,
  minWorldX: number,
  minWorldZ: number,
  chunkSize: number,
  density: number = DEFAULT_D,
  /**
   * Alturas dos vértices da malha do chunk (grade grid x grid a cada step metros, a partir de
   * minWorldX/minWorldZ), quando a malha foi gerada no mesmo job: os tufos de grama assentam nela
   * sem consultar o relevo de novo (~1100 consultas por chunk) e acompanham a malha de verdade
   * (inclusive a de 4m dos chunks mais afastados)
   */
  mesh?: { heights: Float32Array; grid: number; step: number }
): ChunkTextureResult {
  const D = density;
  const CW = Math.round(chunkSize * D);
  const M = MARGIN;
  const W = CW + M * 2;
  const GX0 = Math.round(minWorldX * D);
  const GY0 = Math.round(minWorldZ * D);
  const PX = GX0 - M, PY = GY0 - M;
  const nT = W * W;

  // Grade dos campos a cada 1.5m só nas texturas de perto (6+ tx/m); nas de média distância a cada
  // 2.5m - ela custa o mesmo por chunk em qualquer densidade e lá dominava o tempo de geração
  // e nas mais distantes (<= 2 tx/m, vistas só de longe) a cada 4m
  const step = Math.max(2, Math.round(D * (D >= 6 ? 1.5 : D > 2 ? 2.5 : 4.0)));
  const GW = Math.ceil(W / step) + 1;
  const nG = GW * GW;

  // Grade própria e bem mais grossa (~24m por célula) só para o bioma ecológico: getPointFast é
  // a chamada mais cara desta função, então amostrá-la na resolução fina de todo o resto seria
  // desperdício. A borda entre biomas não vem do contorno desta grade grossa (isso ficaria em
  // blocos) - vem da mistura bilinear + dither em "tufos" aplicada por pixel mais abaixo.
  // A origem é ANCORADA numa malha global (múltiplo de bioStep), não relativa a este chunk:
  // caso contrário, dois chunks vizinhos amostrariam a grade com fases diferentes e a escolha
  // discreta de bioma "vencedor" podia divergir bem perto da borda, criando costuras visíveis
  // (faixas diagonais) exatamente na fronteira entre chunks.
  const bioStep = Math.max(4, Math.round(D * 24));
  const bioOriginX = (Math.floor(PX / bioStep) - 1) * bioStep;
  const bioOriginY = (Math.floor(PY / bioStep) - 1) * bioStep;
  const bioOffX = PX - bioOriginX, bioOffY = PY - bioOriginY;
  const bioGW = Math.ceil((W + Math.max(bioOffX, bioOffY)) / bioStep) + 2;
  const nBG = bioGW * bioGW;

  ensureScratch(nT, nG, nBG, W);

  const mat = sMat, idx = sIdx, gl = sGl, bio = sBio, gv = sGv;
  const hT = sHt, slT = sSlT;
  const macroM = sMacroM, macroRk = sMacroRk, macroSn = sMacroSn, macroBig = sMacroBig;
  const macroCh1 = sMacroCh1, macroChL = sMacroChL, macroWide = sMacroWide, macroPatch = sMacroPatch, wetT = sWet;

  const gridH = sGridH, gridSpecialRock = sGridSpecialRock, gridM = sGridM, gridRk = sGridRk;
  const gridSn = sGridSn, gridBig = sGridBig, gridCh1 = sGridCh1, gridChL = sGridChL, gridWide = sGridWide, gridPatch = sGridPatch, gridWet = sGridWet;
  const specialRock = sSpecialRock, canyonT = sCanyon, gridCanyon = sGridCanyon;
  const bioGridCat = sBioGridCat;

  const sd  = P.seed;
  const warp = 0.55 + P.edge * 1.9;
  const mf   = 1 / Math.max(1.4, P.pscale);
  const ditA = 0.085 + 0.30 * P.edge;
  const ROCK_CELL = clamp(Math.round(D * 0.62), 4, 10);
  const volcanoGen = terrainGen.getVolcanoGenerator();
  const canyonGen = terrainGen.getCanyonGenerator();

  /* ---- passo 0: bioma ecológico numa grade própria, bem mais grossa ---- */
  (() => {
    for (let gy = 0; gy < bioGW; gy++) {
      const wy = (bioOriginY + gy * bioStep) / D;
      const gRow = gy * bioGW;
      for (let gx = 0; gx < bioGW; gx++) {
        const wx = (bioOriginX + gx * bioStep) / D;
        // getPointFast já calcula altura + bioma ecológico REAL numa única passagem - o mesmo
        // BiomeManager.evaluateBiome() que decide quais árvores a vegetação planta. Usar essa
        // MESMA fonte de verdade (em vez de um limiar de altura/temperatura próprio e independente)
        // garante que o chão nunca discorde da vegetação (ex.: pinheiros nevados sobre areia).
        const gPt = terrainGen.getPointFast(wx, wy);
        bioGridCat[gRow + gx] = BIOME_TYPE_TO_FORGE[gPt.biome.type] ?? B_TEMP;
      }
    }
  })();

  /* ---- passo 1: campos (otimizado via grade bilinear para relevo e ruídos macro) ---- */
  (() => {
    for (let gy = 0; gy < GW; gy++) {
      const wy = (PY + gy * step) / D;
      const gRow = gy * GW;
      for (let gx = 0; gx < GW; gx++) {
        const wx = (PX + gx * step) / D;
        const hw = terrainGen.getHeightAndWetness(wx, wy);
        const gh = hw.height;
        const gIdx = gRow + gx;
        gridH[gIdx] = gh;

        // Vulcão/cânion são feições estreitas e dramáticas - a grade grossa do bioma (~24m) pode
        // simplesmente "pular" por cima delas sem nunca amostrar exatamente em cima (ex.: um
        // cânion de deserto de uns poucos metros de largura cortando uma região gelada acaba sem
        // NENHUM ponto de grade dentro dele, e o chão herda o bioma gelado ao redor por engano,
        // enquanto a vegetação - que usa a posição exata de cada planta - já acerta e planta
        // cactos). Aqui reamostramos essas duas influências na grade FINA (mesma resolução do
        // relevo) e usamos como um "empurrão" extra para rocha, independente do bioma ecológico.
        const vRes = volcanoGen.query(wx, wy);
        const cRes = canyonGen.query(wx, wy, gh);
        gridSpecialRock[gIdx] = vRes.influence > 0.18 ? (vRes.influence - 0.18) / 0.82 : 0;
        gridCanyon[gIdx] = (gh > CONFIG.BEACH_HEIGHT && cRes.influence > 0.45) ? (cRes.influence - 0.45) / 0.55 : 0;

        // Domain warp e máscaras macro
        const ox = per.fbm(wx * 0.21 + 11.3, wy * 0.21 + 4.1, 2) * warp;
        const oy = per.fbm(wx * 0.21 + 27.7, wy * 0.21 + 18.9, 2) * warp;
        const ax = wx + ox, ay = wy + oy;

        let m = per.fbm(ax * mf, ay * mf, 3) * 0.5 + 0.5;
        m += per.fbm(ax * mf * 3.4 + 5.1, ay * mf * 3.4 + 9.7, 2) * 0.14 * (0.35 + P.edge);
        gridM[gIdx] = m;

        gridRk[gIdx] = per.fbm(wx * 0.17 + 71.2, wy * 0.17 + 33.8, 3) * 0.5 + 0.5;
        gridSn[gIdx] = per.fbm(wx * 0.26 + 9.4, wy * 0.26 + 3.2, 2) * 0.5 + 0.5;
        gridBig[gIdx] = per.fbm(wx * 0.33 + 5.5, wy * 0.33 + 2.2, 2);

        // Erosão e modulações na terra
        const wu = wx + per.fbm(wx * 0.60 + 3.1,  wy * 0.60 + 8.7,  2) * 1.2;
        const wv = wy + per.fbm(wx * 0.60 + 19.3, wy * 0.60 + 2.9,  2) * 1.2;
        gridCh1[gIdx] = 1 - Math.abs(per.fbm(wu * 0.80 + 5.0,  wv * 0.80 + 11.0, 3));
        gridChL[gIdx] = 1 - Math.abs(per.fbm((wu + 0.20) * 0.80 + 5.0, (wv - 0.20) * 0.80 + 11.0, 3));
        gridWide[gIdx] = per.fbm(wx * 0.72 + 41.3, wy * 0.72 + 7.9, 2);
        // Manchas grandes de grama x terra do temperado (~15m, com recorte médio de ~4m)
        gridPatch[gIdx] = per.fbm(wx * 0.065 + 13.7, wy * 0.065 + 71.1, 3) + per.fbm(wx * 0.24 + 3.3, wy * 0.24 + 29.4, 2) * 0.30;
        // Rios e lagos: fundo e beira em areia (1 = debaixo d'água, cai a 0 ao longo da margem)
        gridWet[gIdx] = hw.wetness;
      }
    }
  })();

  // Pré-computa tabela 1D para eliminar divisões e modulos
  const invStep = 1.0 / step;
  for (let l = 0; l < W; l++) {
    const g = (l * invStep) | 0;
    const t = (l % step) * invStep;
    sGx[l] = g; sTx[l] = t; sOtx[l] = 1.0 - t;
    sGy[l] = g; sTy[l] = t; sOty[l] = 1.0 - t;
  }
  // Mesma tabela, só que para a grade (grossa e ancorada globalmente) do bioma
  const invBioStep = 1.0 / bioStep;
  for (let l = 0; l < W; l++) {
    const lgx = l + bioOffX, lgy = l + bioOffY;
    const bgx = (lgx * invBioStep) | 0, bgy = (lgy * invBioStep) | 0;
    const btx = (lgx % bioStep) * invBioStep, bty = (lgy % bioStep) * invBioStep;
    sBGx[l] = bgx; sBTx[l] = btx; sBOtx[l] = 1.0 - btx;
    sBGy[l] = bgy; sBTy[l] = bty; sBOty[l] = 1.0 - bty;
  }

  // Interpolação bilinear vetorizada dos campos contínuos
  (() => {
    for (let ly = 0; ly < W; ly++) {
      const gy = sGy[ly];
      const ty = sTy[ly];
      const oty = sOty[ly];
      const gRow0 = gy * GW;
      const gRow1 = (gy + 1) * GW;
      const row = ly * W;
      for (let lx = 0; lx < W; lx++) {
        const gx = sGx[lx];
        const tx = sTx[lx];
        const otx = sOtx[lx];
        const i00 = gRow0 + gx;
        const i01 = gRow1 + gx;

        const w00 = otx * oty, w10 = tx * oty, w01 = otx * ty, w11 = tx * ty;
        const idx = row + lx;

        hT[idx] = gridH[i00]*w00 + gridH[i00+1]*w10 + gridH[i01]*w01 + gridH[i01+1]*w11;
        specialRock[idx] = gridSpecialRock[i00]*w00 + gridSpecialRock[i00+1]*w10 + gridSpecialRock[i01]*w01 + gridSpecialRock[i01+1]*w11;
        canyonT[idx] = gridCanyon[i00]*w00 + gridCanyon[i00+1]*w10 + gridCanyon[i01]*w01 + gridCanyon[i01+1]*w11;

        // Bioma: mistura os 4 cantos da grade grossa por ÁREA bilinear (não dá pra misturar as
        // CORES de dois biomas, mas dá pra usar a área como probabilidade de tufos). Em vez de
        // "o canto de maior peso individual vence" (isso cria um ziguezague de diamantes - artefato
        // clássico de escolher por argmax bilinear), somamos o peso de TODOS os cantos que
        // pertencem a cada categoria e sorteamos por pixel com probabilidade proporcional a essa
        // área - perto da fronteira (~50/50) sai um tufo bem denso e pontilhado, longe dela a
        // probabilidade do bioma vizinho cai a zero suavemente. Mesmo estilo de dither em cluster()
        // (blobs arredondados, não ruído fino) já usado no preenchimento de grama/terra abaixo.
        // Consulta deformada: o pixel "pergunta" o bioma num ponto deslocado por ruído de grande
        // escala (até ~0.7 célula). Sem isso a fronteira seguia as linhas retas/diagonais da
        // interpolação dentro de cada célula de 24m e aparecia como cortes retos e triângulos.
        const wpX = gridPatch[i00]*w00 + gridPatch[i00+1]*w10 + gridPatch[i01]*w01 + gridPatch[i01+1]*w11;
        const wpY = gridM[i00]*w00 + gridM[i00+1]*w10 + gridM[i01]*w01 + gridM[i01+1]*w11 - 0.5;
        const wsX = gridBig[i00]*w00 + gridBig[i00+1]*w10 + gridBig[i01]*w01 + gridBig[i01+1]*w11;
        const wsY = gridWide[i00]*w00 + gridWide[i00+1]*w10 + gridWide[i01]*w01 + gridWide[i01+1]*w11;
        const qx = (lx + bioOffX + (wpX * 0.9 + wsX * 0.25) * bioStep * 0.75) / bioStep;
        const qy = (ly + bioOffY + (wpY * 1.8 + wsY * 0.25) * bioStep * 0.75) / bioStep;
        const bgx = clamp(Math.floor(qx), 0, bioGW - 2), bgy = clamp(Math.floor(qy), 0, bioGW - 2);
        const btx = clamp(qx - bgx, 0, 1), bty = clamp(qy - bgy, 0, 1);
        const botx = 1 - btx, boty = 1 - bty;
        const bRow0 = bgy * bioGW, bRow1 = (bgy + 1) * bioGW;
        const j00 = bRow0 + bgx, j01 = bRow1 + bgx;
        const bw00 = botx * boty, bw10 = btx * boty, bw01 = botx * bty; // o 4º canto é o resto
        const c00 = bioGridCat[j00], c10 = bioGridCat[j00 + 1], c01 = bioGridCat[j01], c11 = bioGridCat[j01 + 1];

        let b: number;
        if (c00 === c10 && c00 === c01 && c00 === c11) {
          b = c00; // os 4 cantos concordam: interior estável, sem nenhum sorteio necessário
        } else {
          // Sorteio proporcional ao peso de cada canto (vale para 2, 3 ou 4 biomas diferentes),
          // em MANCHAS de alguns metros (ruído suave já interpolado da grade) com a borda só
          // levemente recortada - no estilo das manchas de grama, não um chuvisco de pixels
          const tuft = clamp(0.5 + (wsX * 0.9 + wsY * 0.35) * 1.15
                           + (cluster(PX + lx + 91.0, PY + ly + 47.0, sd + 84) - 0.5) * 0.18, 0, 0.999);
          b = c11;
          let acc = bw00;
          if (tuft < acc) b = c00;
          else if (tuft < (acc += bw10)) b = c10;
          else if (tuft < (acc += bw01)) b = c01;
        }

        // Vulcão/cânion sempre vencem, mesmo se a grade grossa achava que aqui era outra coisa
        // (ex.: gelo) - essas feições são geológicas, não climáticas, e não podem sumir por
        // amostragem grossa demais. Dither suave na borda em vez de um corte duro.
        if (specialRock[idx] > 0.02 || canyonT[idx] > 0.02) {
          const rockDither = (cluster(PX + lx + 201.0, PY + ly + 77.0, sd + 85) - 0.5) * 0.30;
          if (canyonT[idx] + rockDither > 0.15) b = B_DESERT;
          if (specialRock[idx] + rockDither > 0.15) b = B_MOUNT;
        }

        bio[idx] = b;

        macroM[idx] = gridM[i00]*w00 + gridM[i00+1]*w10 + gridM[i01]*w01 + gridM[i01+1]*w11;
        macroRk[idx] = gridRk[i00]*w00 + gridRk[i00+1]*w10 + gridRk[i01]*w01 + gridRk[i01+1]*w11;
        macroSn[idx] = gridSn[i00]*w00 + gridSn[i00+1]*w10 + gridSn[i01]*w01 + gridSn[i01+1]*w11;
        macroBig[idx] = gridBig[i00]*w00 + gridBig[i00+1]*w10 + gridBig[i01]*w01 + gridBig[i01+1]*w11;
        macroCh1[idx] = gridCh1[i00]*w00 + gridCh1[i00+1]*w10 + gridCh1[i01]*w01 + gridCh1[i01+1]*w11;
        macroChL[idx] = gridChL[i00]*w00 + gridChL[i00+1]*w10 + gridChL[i01]*w01 + gridChL[i01+1]*w11;
        macroWide[idx] = gridWide[i00]*w00 + gridWide[i00+1]*w10 + gridWide[i01]*w01 + gridWide[i01+1]*w11;
        macroPatch[idx] = gridPatch[i00]*w00 + gridPatch[i00+1]*w10 + gridPatch[i01]*w01 + gridPatch[i01+1]*w11;
        wetT[idx] = gridWet[i00]*w00 + gridWet[i00+1]*w10 + gridWet[i01]*w01 + gridWet[i01+1]*w11;
      }
    }
  })();

  // Derivadas de inclinação analítica em memória (0 chamadas adicionais de ruído)
  const deltaMeters = 1.0 / D;
  (() => {
    for (let ly = 0; ly < W; ly++) {
      const lyD = Math.max(0, ly - 1), lyU = Math.min(W - 1, ly + 1);
      const rowD = lyD * W, rowU = lyU * W, rowCur = ly * W;
      const dy = (lyU - lyD) * deltaMeters;
      for (let lx = 0; lx < W; lx++) {
        const lxL = Math.max(0, lx - 1), lxR = Math.min(W - 1, lx + 1);
        const hL = hT[rowCur + lxL], hR = hT[rowCur + lxR];
        const hD = hT[rowD + lx], hU = hT[rowU + lx];
        const dx = (lxR - lxL) * deltaMeters;
        slT[rowCur + lx] = Math.sqrt(((hR - hL) / dx) ** 2 + ((hU - hD) / dy) ** 2);
      }
    }
  })();

  // Avaliação dos biomas e máscaras de materiais
  (() => {
    for (let ly = 0; ly < W; ly++) {
      const row = ly * W;
      for (let lx = 0; lx < W; lx++) {
        const i = row + lx;
        const tx = PX + lx, ty = PY + ly;

        const h = hT[i];
        const sl = slT[i];
        const hn = clamp(h / 65.0, 0, 1);

        // Bioma já resolvido na etapa de grade (mesma fonte de verdade da vegetação) - só lê.
        const b = bio[i];
        const BI = BIOMES[b];

        // Máscara macro de vegetação: quantidade de grama controlada por slider PRÓPRIO de
        // cada bioma (temperado/montanha/polar), em vez de um único slider global escalado.
        // Isso evita que subir a grama do temperado tire a neve da montanha (e vice-versa) —
        // cada bioma tem seu próprio intervalo de ajuste, independente dos outros.
        const biomeGrassAmt = b === B_MOUNT ? P.grassMountain
          : b === B_POLAR ? P.grassPolar
          : b === B_DESERT ? 0
          : P.grass;
        const mBase = b === B_TEMP ? macroPatch[i] * 0.55 + 0.5 : macroM[i];
        let m = mBase + (hn - 0.40) * 0.30 - clamp(sl - 0.95, 0, 2) * 0.20 + biomeGrassAmt + BI.vegBias;
        gv[i] = m;

        // Quantização com dither em cluster
        // Temperado: manchas de grama com contorno limpo (bolhas), sem a borda salpicada
        const d = m + (cluster(tx, ty, sd) - 0.5) * (b === B_TEMP ? ditA * 0.3 : ditA);
        gl[i] = d > 0.70 ? 4 : d > 0.61 ? 3 : d > 0.535 ? 2 : d > 0.475 ? 1 : 0;

        // Rocha: encosta + ruído
        let rk = macroRk[i] + clamp(sl - 0.95, 0, 2) * 0.30 + (0.28 - hn) * 0.30 + (cluster(tx + 91, ty + 17, sd + 5) - 0.5) * 0.26;
        // O slider "Quantidade de Rocha" não vale no deserto (como o da grama): lá as manchas de
        // rocha no meio das dunas ficavam feias; sobra só a rocha das encostas íngremes.
        const rockAmt = b === B_DESERT ? 0 : P.rock;
        const isRock = rk > (1.10 - rockAmt * 0.80 - BI.rockBias);

        // Areia na faixa da praia
        let sn = macroSn[i] + (cluster(tx + 41, ty + 63, sd + 9) - 0.5) * 0.30;
        // limite de altura da areia passado pela mesma subida da orla da hidrologia (a terra baixa sobe
        // até 1.5m, sumindo até 3m): sem isso a praia elevada virava terra e sobrava só uma faixa de areia
        const sandLim = 1.85 + sn * 1.1;
        const sandT = clamp(sandLim / 3.0, 0, 1);
        const isSand = (h < CONFIG.SEA_LEVEL + sandLim + 1.5 * (1 - sandT * sandT * (3 - 2 * sandT)) && sl < 1.45)
                    || wetT[i] + (cluster(tx + 17, ty + 29, sd + 11) - 0.5) * 0.30 > 0.42;

        if (isSand) { mat[i] = M_SAND; gl[i] = Math.min(gl[i], 1); }
        else if (isRock) { mat[i] = M_ROCK; gl[i] = Math.min(gl[i], 2); }
        else mat[i] = M_DIRT;
      }
    }
  })();

  /* ---- passo 2: base indexada por material ---- */
  (() => {
    for (let ly = 0; ly < W; ly++) {
      for (let lx = 0; lx < W; lx++) {
        const i = ly * W + lx;
        const tx = PX + lx, ty = PY + ly;

        // Preenchimento base de grama. Vem primeiro: o pixel que vira grama não precisa do padrão
        // de terra/rocha/areia (antes ele era calculado e depois sobrescrito).
        const g = gl[i];
        if (g >= 2) {
          const hole = cluster(tx + 23, ty + 37, sd + 13);
          const holeThr = bio[i] === B_TEMP ? -1 : g === 2 ? 0.10 : (g === 3 ? 0.05 : 0.02);
          if (hole > holeThr) {
            mat[i] = M_GRASS;
            const wide = macroWide[i];
            const tone = cluster(tx * 0.35 + 3, ty * 0.35 + 9, sd + 17);
            const q = Math.min(P.greens - 1, Math.floor(tone * P.greens));
            const off = Math.round((q / Math.max(1, P.greens - 1) - 0.5) * (P.greens >= 5 ? 2 : 1));
            let v = 3 + off;
            if (wide > 0.20) v += 1; else if (wide < -0.22) v -= 1;
            idx[i] = clamp(v, 0, RL - 1);
            continue;
          }
        }

        const wx = tx / D, wy = ty / D;
        const big = macroBig[i];
        const bay = bayer(tx, ty);
        const cl  = cluster(tx + 7, ty + 11, sd + 21);
        const BI  = BIOMES[bio[i]];

        if (mat[i] === M_ROCK) {
          const cell = ROCK_CELL;
          const c = cobble(tx, ty, cell, sd + 301);
          let v = cobbleTone(c, bio[i] === B_TEMP ? 3 : 2, 0.71, -0.71);
          if (big > 0.22) v += 1; else if (big < -0.22) v -= 1;
          idx[i] = clamp(v, 0, RL - 1);
          // Rocha polar polvilhada: montinhos de neve assentados por cima da pedra
          if (bio[i] === B_POLAR && cluster(tx * 0.5 + 3, ty * 0.5 + 7, sd + 72) * 0.8 + cl * 0.2 > 0.60) {
            mat[i] = M_DIRT; idx[i] = cl > 0.5 ? 5 : 4;
          }

        } else if (mat[i] === M_SAND) {
          // Praia do diorama: o alto da praia é creme claro e chapado; descendo para a água a areia
          // escurece em degraus (bege, caramelo, laranja-queimado) numa faixa larga. As trocas de
          // tom são pontilhadas (pixels soltos do tom vizinho), não linhas limpas.
          const s1 = macroSn[i];
          const dep = Math.max((CONFIG.SEA_LEVEL + 1.5 - hT[i]) / 1.9,       // 0 = alto da praia, 1 = linha d'água
                               wetT[i] * 0.95 - 0.05);                        // beira de rio/lago no alto
          const stip = (ihash(tx, ty, sd + 901) - 0.5) * 0.09;                  // pontilhado pixel a pixel
          const e = dep + stip + (cl - 0.5) * 0.06 + (s1 - 0.5) * 0.18;
          let v = e < 0.50 ? 3 : e < 0.82 ? 2 : e < 0.97 ? 1 : 0;   // faixa laranja junto da água mais estreita
          if (v === 3 && e < 0.12 && s1 > 0.62) v = 4;                           // manchas mais claras no alto
          if (v >= 3 && ihash(tx, ty, sd + 902) > 0.992) v = 2;                // grãos soltos no creme
          idx[i] = clamp(v, 0, RL - 1);

        } else if (BI.ground === 'cinza') {
          // Chão vulcânico: cinza marrom com grão fino (pixels claros e escuros soltos), manchas
          // grandes mais escuras e pedrinhas de basalto
          let v = 3;
          const gr = ihash(tx, ty, sd + 941);
          if (gr > 0.86) v = 4; else if (gr < 0.14) v = 2;
          if (big < -0.18) v -= 1; else if (big > 0.30) v += 1;
          idx[i] = clamp(v, 0, RL - 1);
          if (cluster(tx * 0.6 + 5, ty * 0.6 + 9, sd + 942) > 0.88) { mat[i] = M_ROCK; idx[i] = cl > 0.5 ? 3 : 2; }

        } else if (BI.ground === 'neve') {
          const wa = (P.seed % 628) / 100;
          const rx =  wx * Math.cos(wa) + wy * Math.sin(wa);
          const ry = -wx * Math.sin(wa) + wy * Math.cos(wa);
          // Neve do diorama de inverno: quase toda branco puro; as depressões e o pé dos montes
          // de vento ganham sombra azul-clara com a borda pontilhada (pixels soltos), e só o fundo
          // das sombras chega no azul médio.
          const drift = per.fbm(rx * 0.12 + 3.7, ry * 0.45 + 9.1, 2);          // montes de vento largos
          const e = big * 0.60 + drift * 0.32
                  + (ihash(tx, ty, sd + 911) - 0.5) * 0.16 + (cl - 0.5) * 0.06;
          let v = e > -0.10 ? 5 : e > -0.30 ? 4 : e > -0.42 ? 3 : 2;
          idx[i] = clamp(v, 0, RL - 1);

        } else if (BI.ground === 'dunas') {
          // Areia (rampa de duna), não terra: grandes dunas sombreadas + ondulações finas de vento
          // perpendiculares a uma direção de vento fixa por seed.
          mat[i] = M_SAND;
          const wa = (P.seed % 628) / 100 + 1.3;
          const rx =  wx * Math.cos(wa) + wy * Math.sin(wa);
          const ry = -wx * Math.sin(wa) + wy * Math.cos(wa);
          const dune = per.fbm(rx * 0.06 + 17.3, ry * 0.06 + 3.9, 2);
          const ripple = Math.sin(rx * 2.4 + per.fbm(rx * 0.30 + 5.1, ry * 0.30 + 9.7, 2) * 3.0);
          let v = 3;
          // Dunas chapadas: manchas grandes e faixas de ondulação limpas (sem pontilhado)
          if (dune > 0.16) v += 1;
          else if (dune < -0.16) v -= 1;
          if (ripple > 0.82) v += 1;
          else if (ripple < -0.86) v -= 1;
          idx[i] = clamp(v, 0, RL - 1);

        } else {
          if (bio[i] === B_TEMP) {
            // Terra do diorama: ocre liso, variação só em manchas grandes e poucos sulcos marcados
            let v = 4;
            if (big + bay * 0.10 > 0.30) v = 5;
            else if (big + bay * 0.10 < -0.28) v = 3;
            if (macroCh1[i] + (cluster(tx, ty, sd + 27) - 0.5) * 0.05 > 0.93) v -= 1;
            idx[i] = v;
            continue;
          }
          // canais de erosão na terra (alimentados por interpolação bilinear ultra-rápida)
          const ch1 = macroCh1[i];
          const chL = macroChL[i];
          const dith = (cluster(tx, ty, sd + 27) - 0.5) * 0.085;

          let v = 4;
          if (big + bay * 0.16 >  0.24) v += 1;
          else if (big + bay * 0.16 < -0.22) v -= 1;
          const c1 = ch1 + dith;
          if (c1 > 0.905)      v -= 2;
          else if (c1 > 0.815) v -= 1;
          else if (chL > 0.86) v += 1;
          else {
            const ch2 = cluster(tx * 2.1 + 31, ty * 2.1 + 17, sd + 51);
            if (ch2 > 0.94) v -= 1;
          }
          idx[i] = clamp(v, 0, RL - 1);
        }

      }
    }
  })();

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
  (() => {
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
        // Chão do diorama limpo: poucos detalhes escuros em qualquer bioma (temperado ainda menos)
        if (ihash(x, y, sd + 60) > (bio[i] === B_TEMP ? 0.10 : 0.18)) continue;

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
          const streakMat = mat[at(x, y)] === M_SAND ? M_SAND : M_DIRT;
          for (let k = 0; k < w2; k++) put(x + k, y + (k === 1 ? 1 : 0), streakMat, 1);
        }
      }
    }
  })();

  /* ---- passo 4: vegetação ---- */
  const sp = Math.max(2, P.clusterSize);

  // Moitas graúdas
  const bstep = Math.max(9, Math.round(D * 1.5));
  (() => {
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
  })();

  const ptuft = [0.00, 0.30, 0.55, 0.80, 0.97];
  (() => {
    for (let GY = gridStart(PY - sp, sp); GY < PY + W + sp; GY += sp) {
      for (let GX = gridStart(PX - sp, sp); GX < PX + W + sp; GX += sp) {
        const x = GX + ((ihash(GX, GY, sd + 81) * sp) | 0), y = GY + ((ihash(GX, GY, sd + 82) * sp) | 0);
        if (x - PX < -8 || y - PY < -8 || x - PX >= W + 8 || y - PY >= W + 8) continue;
        const i = at(x, y);

        const clump = macroBig[i] * 0.5 + 0.5;
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

        // Temperado: miolo da grama liso - só os tufos que escorrem pela borda (dão o recorte irregular)
        if (bio[i] === B_TEMP && !spill) continue;
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
  })();

  let grassDistMap: Uint8Array | null = null; // distância até a borda da grama (passo 4a), usada nos tufos 3D
  /* ---- passo 4a: grama temperada - miolo liso e faixa escura na borda ----
     Distância (Chebyshev, até 4px) de cada pixel de grama até o que não é grama; perto da borda
     a grama escurece em degraus, no miolo fica o verde médio quase sem textura. */
  (() => {
    {
      // Mesmo acabamento para a vegetação rasteira de todos os biomas (cada um com sua paleta)
      const isTempGrass = (j: number) => mat[j] === M_GRASS;
      const dist = new Uint8Array(W * W);
      for (let i = 0; i < W * W; i++) dist[i] = isTempGrass(i) ? 6 : 0;
      // chamfer em dois sentidos (8 vizinhos)
      for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
        const i = ly * W + lx; if (!dist[i]) continue;
        let d = dist[i];
        if (lx > 0) d = Math.min(d, dist[i - 1] + 1);
        if (ly > 0) { d = Math.min(d, dist[i - W] + 1); if (lx > 0) d = Math.min(d, dist[i - W - 1] + 1); if (lx < W - 1) d = Math.min(d, dist[i - W + 1] + 1); }
        dist[i] = d;
      }
      for (let ly = W - 1; ly >= 0; ly--) for (let lx = W - 1; lx >= 0; lx--) {
        const i = ly * W + lx; if (!dist[i]) continue;
        let d = dist[i];
        if (lx < W - 1) d = Math.min(d, dist[i + 1] + 1);
        if (ly < W - 1) { d = Math.min(d, dist[i + W] + 1); if (lx < W - 1) d = Math.min(d, dist[i + W + 1] + 1); if (lx > 0) d = Math.min(d, dist[i + W - 1] + 1); }
        dist[i] = d;
      }
      grassDistMap = dist;
      for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
        const i = ly * W + lx;
        if (!isTempGrass(i)) continue;
        const tx = PX + lx, ty = PY + ly;
        const d = dist[i];
        // Largura da faixa escura varia ao longo da borda (1 a 4px), em blocos de ~2px
        // Largura da faixa escura: quase sempre 1-2px, às vezes 3 (como na referência)
        const bw = cluster(tx * 0.45 + 7, ty * 0.45 + 3, sd + 530);
        // 0 em alguns trechos: ali o verde de dentro chega até a beirada
        const band = bw < 0.22 ? 0 : 1 + (bw > 0.55 ? 1 : 0) + (bw > 0.88 ? 1 : 0);
        const r = cluster(tx + 13, ty + 57, sd + 520);
        if (gl[i] < 2) {
          // Tufinho solto sobre a terra: verde (o contorno escuro fica na terra em volta, passo 4b)
          idx[i] = ihash(tx, ty, sd + 535) > 0.6 ? 4 : r > 0.4 ? 3 : 2;
          continue;
        }
        // O verde claro de dentro invade a faixa escura em línguas de 2-3px que chegam até a beirada
        const inv = cluster(tx * 0.5 + 91, ty * 0.5 + 33, sd + 541) * 0.8 + r * 0.2;
        const invade = inv > (d === 1 ? 0.54 : 0.44);
        if (d <= band && invade) {
          idx[i] = cluster(tx + 5, ty + 71, sd + 542) > 0.62 ? 4 : 3;
          continue;
        }
        if (d <= band) {
          // Faixa irregular: azul-petróleo escuro, verde escuro e verde-azulado (quase preto só às vezes)
          if (d === 1) idx[i] = r < 0.28 ? 0 : r < 0.66 ? 1 : 2;
          else idx[i] = r < 0.14 ? 0 : r < 0.55 ? 1 : 2;
        } else {
          // Miolo: verde vivo com manchinhas verde-azuladas, realces amarelados e pontos escuros
          // Ruído em bloco + um pouco por pixel: grupinhos orgânicos, sem quadrados alinhados
          const a = cluster(tx + 31, ty + 17, sd + 531) * 0.75 + ihash(tx, ty, sd + 533) * 0.25;
          const h = cluster(tx + 71, ty + 23, sd + 532) * 0.70 + ihash(tx, ty, sd + 534) * 0.30;
          let v = 3;
          if (a < 0.30) v = 2;
          if (h > 0.76) v = 4;
          else if (h < 0.10) v = 1;
          else if (d === band + 1 && h < 0.20) v = 2; // a faixa escura se desfaz para dentro
          idx[i] = v;
        }
      }
    }
  })();

  /* ---- passo 4b: sombra da manta de grama sobre a terra ---- */
  (() => {
    for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
      const i = ly * W + lx;
      if (mat[i] === M_GRASS || mat[i] === M_ACC) continue;
      const up = ly > 0   && mat[(ly - 1) * W + lx] === M_GRASS;
      const rt = lx < W - 1 && mat[ly * W + lx + 1] === M_GRASS;
      const ramp = RAMPS[bio[i]][mat[i]];
      {
        // Contorno do diorama: a mancha de grama "senta" sobre a terra com uma borda escura -
        // quase preta logo abaixo dela e marrom-avermelhada nas laterais. Só em volta das manchas
        // (gl >= 2); tufinhos soltos não ganham anel (viravam losangos escuros espalhados).
        const patch = (j: number) => mat[j] === M_GRASS && gl[j] >= 2;
        const pUp = ly > 0 && patch((ly - 1) * W + lx);
        const pRt = lx < W - 1 && patch(ly * W + lx + 1);
        const pLf = lx > 0 && patch(ly * W + lx - 1);
        const pDn = ly < W - 1 && patch((ly + 1) * W + lx);
        const oc = cluster(PX + lx + 41, PY + ly + 19, sd + 540);
        // Onde a grama da beirada é verde claro (invasão), o contorno do lado da terra some
        const bright = (j: number) => mat[j] === M_GRASS && idx[j] >= 3;
        const upJ = (ly - 1) * W + lx;
        if (pUp) { if (!bright(upJ) && oc > 0.18) idx[i] = oc < 0.62 ? 0 : 1; continue; }
        if (pRt || pLf || pDn) {
          const litSide = (pRt && bright(i + 1)) || (pLf && bright(i - 1)) || (pDn && bright(i + W));
          if (!litSide && oc > 0.35) idx[i] = Math.min(idx[i], oc < 0.7 ? 1 : 2);
          continue;
        }
        if (up || rt) continue; // encostado num tufinho solto: sem sombra extra
      }
      if (up || rt) idx[i] = clamp(idx[i] - 2, 0, ramp.length - 1);
      else if (ly > 1 && mat[(ly - 2) * W + lx] === M_GRASS && cluster(PX + lx, PY + ly, sd + 56) > 0.42)
        idx[i] = clamp(idx[i] - 1, 0, ramp.length - 1);
    }
  })();

  // (passo 4b2 antigo - borda da grama clareada/escurecida - substituído pelo acabamento do passo 4a)

  /* ---- passo 4c: sombra de contato terra -> rocha ---- */
  (() => {
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
  })();
  (() => {
    for (let ly = 0; ly < W; ly++) for (let lx = 0; lx < W; lx++) {
      const i = ly * W + lx;
      if (mat[i] !== M_DIRT && mat[i] !== M_SAND) continue;
      const a = mat[Math.max(0, ly - 1) * W + lx];
      const b = mat[ly * W + Math.min(W - 1, lx + 1)];
      if (a !== M_ROCK && b !== M_ROCK) continue;
      if (cluster(PX + lx + 17, PY + ly + 43, sd + 59) < 0.28) continue;
      idx[i] = clamp(idx[i] - 1, 0, RL - 1);
    }
  })();

  /* ---- passo 4d: neve encostada na rocha - beirada azul em 2 degraus (a camada de neve
     tem espessura: a borda que desce para a pedra fica na sombra) ---- */
  (() => {
    for (let ly = 1; ly < W - 1; ly++) for (let lx = 1; lx < W - 1; lx++) {
      const i = ly * W + lx;
      if (bio[i] !== B_POLAR || mat[i] !== M_DIRT) continue;
      let d = 0;
      for (let k = 1; k <= 2 && !d; k++) {
        if (mat[i + k * W < W * W ? i + k * W : i] === M_ROCK || mat[i + (lx + k < W ? k : 0)] === M_ROCK ||
            mat[i - (lx - k >= 0 ? k : 0)] === M_ROCK) d = k;
      }
      if (!d) continue;
      const r2 = cluster(PX + lx + 61, PY + ly + 19, sd + 861);
      idx[i] = d === 1 ? (r2 < 0.35 ? 2 : 3) : (r2 < 0.5 ? 3 : 4);
    }
  })();

  /* ---- passo 5 & 6: cavidade + encosta escurecem & índices -> RGB, recortando a margem ---- */
  const nC  = CW * CW;
  const img  = new Uint8ClampedArray(nC * 4);
  const imgD = new Uint8ClampedArray(nC * 4);
  const RB = Math.max(2, Math.round(D * 0.20));

  (() => {
    for (let cy = 0; cy < CW; cy++) {
      const ly = cy + M;
      const row = ly * W;
      const cRow = cy * CW;
      for (let cx = 0; cx < CW; cx++) {
        const lx = cx + M, i = row + lx, o = (cRow + cx) * 4;

        let s = 0, n = 0;
        for (let k = -RB; k <= RB; k += 2) {
          const a = clamp(lx + k, 0, W - 1), b = clamp(ly + k, 0, W - 1);
          s += hT[row + a] + hT[b * W + lx]; n += 2;
        }
        const blurVal = s / n;

        const dth = (cluster(PX + lx + 55, PY + ly + 77, sd + 33) - 0.5) * 0.085;
        const cav = hT[i] - blurVal + dth;
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
        imgD[o]    = cd[0]; imgD[o + 1] = cd[1]; imgD[o + 2] = cd[2]; imgD[o + 3] = bio[i];
      }
    }
  })();
  // Tufos de grama 3D, como na referência: concentrados na beirada das manchas (logo depois da
  // faixa escura) e bem espaçados no miolo. A altura vem do relevo interpolado da textura (hT).
  let grass: Float32Array | undefined;
  // só nas texturas de 2+ tx/m: a grama 3D aparece nos chunks até o anel 4 (GRASS_RADIUS_CHUNKS),
  // que têm 2+ tx/m; nos mais distantes (1 tx/m e os blocos) calcular os tufos seria à toa
  (() => {
    if (chunkSize <= 64 && D >= 2) {
      const list: number[] = [];
      const S = Math.round(chunkSize);
      const tuftAmount = P.tuftAmount ?? 1, tuftClump = P.tuftClump ?? 0.6, tuftSize = P.tuftSize ?? 1;
      // Altura e inclinação no triângulo da malha do chunk (PlaneGeometry de 32 subdivisões: vértices
      // a cada 2m em coordenadas pares do mundo; faces (a,b,d) e (b,c,d) como em chunkGeometry)
      const MESH = mesh ? mesh.step : 2;
      const cornerCache = new Map<number, number>();
      const hAt = (vx: number, vz: number) => {
        if (mesh) {
          const ix = Math.round((vx - minWorldX) / MESH), iz = Math.round((vz - minWorldZ) / MESH);
          if (ix >= 0 && iz >= 0 && ix < mesh.grid && iz < mesh.grid) return mesh.heights[iz * mesh.grid + ix];
        }
        const key = vx * 100003 + vz;
        let h = cornerCache.get(key);
        if (h === undefined) { h = terrainGen.getHeight(vx, vz); cornerCache.set(key, h); }
        return h;
      };
      const meshSurface = (x: number, z: number) => {
        const x0 = Math.floor(x / MESH) * MESH, z0 = Math.floor(z / MESH) * MESH;
        const fx = (x - x0) / MESH, fz = (z - z0) / MESH;
        const ha = hAt(x0, z0), hb = hAt(x0, z0 + MESH), hc = hAt(x0 + MESH, z0 + MESH), hd = hAt(x0 + MESH, z0);
        if (fx + fz <= 1) {
          return { h: ha + (hd - ha) * fx + (hb - ha) * fz, gx: (hd - ha) / MESH, gz: (hb - ha) / MESH };
        }
        return { h: hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz), gx: (hc - hb) / MESH, gz: (hc - hd) / MESH };
      };
      const perCell = clamp(Math.round(P.tuftPerM2 ?? 3), 1, 6);
      for (let cz = 0; cz < S; cz++) {
        for (let cx = 0; cx < S; cx++) {
          const gx = Math.floor(minWorldX) + cx, gz = Math.floor(minWorldZ) + cz;
          for (let k = 0; k < perCell; k++) {
          const kx = gx * 5 + k, kz = gz * 5 + k * 3;
          const jx = ihash(kx, kz, sd + 602), jz = ihash(kx, kz, sd + 603);
          const lx = M + Math.min(CW - 1, Math.floor((cx + jx) * D));
          const ly = M + Math.min(CW - 1, Math.floor((cz + jz) * D));
          const j = ly * W + lx;
          // Bioma de gelo: tufos nevados espalhados sobre a neve (em menor quantidade)
          const onSnow = bio[j] === B_POLAR && mat[j] === M_DIRT;
          if (!onSnow && (mat[j] !== M_GRASS || gl[j] < 2)) continue;
          // Distância até a borda em metros: beirada = mais tufos, miolo = menos
          const dm = (grassDistMap ? grassDistMap[j] : 6) / D;
          let p = (onSnow ? 0.11 : dm <= 0.85 ? 0.55 : dm <= 1.2 ? 0.32 : 0.12) * tuftAmount;
          if (bio[j] === B_MOUNT) p *= 0.35;                    // vulcão: capim seco e ralo
          // Concentração: moitas cheias onde o ruído é alto, vazios onde é baixo
          if (tuftClump > 0) {
            const wxc = minWorldX + cx + jx, wzc = minWorldZ + cz + jz;
            const cn = per.fbm(wxc * 0.32 + 11.7, wzc * 0.32 + 5.3, 2) * 0.5 + 0.5;
            const f = clamp((cn - 0.42) * 4.0, 0, 2.4);
            p *= 1 - tuftClump + tuftClump * f;
          }
          if (ihash(kx, kz, sd + 601) > p) continue;
          const wx = minWorldX + cx + jx, wz = minWorldZ + cz + jz;
          const surf = meshSurface(wx, wz);
          if (surf.gx * surf.gx + surf.gz * surf.gz > 1.0) continue; // encosta íngreme demais (> 45°)
          // Altura própria de cada tufo (suave: o formato do tufo - leque, alto, baixo, espiga,
          // tombado - é escolhido depois, na vegetação): trechos mais altos/baixos + variação individual
          const tall = per.fbm(wx * 0.16 + 31.7, wz * 0.16 + 8.9, 2) * 0.5 + 0.5;
          const hy = clamp(0.72 + tall * 0.50 + (ihash(kx, kz, sd + 605) - 0.5) * 0.30, 0.70, 1.35);
          const wxz = 0.85 + ihash(kx, kz, sd + 606) * 0.30;
          list.push(wx, surf.h, wz, (0.8 + ihash(kx, kz, sd + 604) * 0.6) * tuftSize, bio[j], surf.gx, surf.gz, hy, wxz);
          }
        }
      }
      grass = new Float32Array(list);
    }
  })();

  return { img, imgD, width: CW, height: CW, grass };
}

/* =========================================================================
   FABRICANTE DE TEXTURAS DATA_TEXTURE (THREE.JS)
   ========================================================================= */
// Definida pelo main.ts a partir da GPU (renderer.capabilities.getMaxAnisotropy) antes de o
// mundo ser criado. Filtragem anisotrópica mantém o chão nítido em ângulos rasantes (1ª pessoa),
// onde só o mipmap deixaria tudo borrado.
let textureAnisotropy = 1;
export function setForgeTextureAnisotropy(value: number): void {
  textureAnisotropy = Math.max(1, value);
}

/**
 * 'color'    - cor sRGB com mipmap trilinear (chão visto de longe sem cintilar).
 * 'pixel'    - cor sRGB, pixel nítido de perto e mipmap de longe (paredes pixel-art).
 * 'category' - dado bruto de 1 canal (índice de bioma): SEM mipmap e SEM sRGB, pois mipmap
 *              faria média entre índices e a conversão sRGB corromperia os valores.
 */
export type ForgeTextureKind = 'color' | 'pixel' | 'category';

export function makeTexture(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  repeat: boolean,
  kind: ForgeTextureKind
): THREE.DataTexture {
  const isCategory = kind === 'category';
  const t = new THREE.DataTexture(data as any, w, h, isCategory ? THREE.RedFormat : THREE.RGBAFormat);
  t.unpackAlignment = 1;
  if (isCategory) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
  } else {
    t.magFilter = kind === 'color' ? THREE.LinearFilter : THREE.NearestFilter;
    t.minFilter = kind === 'color' ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = textureAnisotropy;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Depois do envio para a GPU a cópia dos pixels na RAM não serve para mais nada (os mipmaps
 * são gerados na GPU): liberá-la tira da heap JS dezenas a centenas de MB com o raio de visão
 * grande. Se o contexto WebGL for perdido, o chunk é regerado ao sair/entrar do raio.
 */
function releaseAfterUpload(t: THREE.DataTexture): THREE.DataTexture {
  t.onUpdate = () => {
    (t.image as { data: unknown }).data = null;
  };
  return t;
}

function makeChunkTextures(res: ChunkTextureResult) {
  return {
    topTex: releaseAfterUpload(makeTexture(res.img, res.width, res.height, false, 'color')),
    topDarkTex: releaseAfterUpload(makeTexture(res.imgD, res.width, res.height, false, 'color')),
  };
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
    this.wallA = makeTexture(buildWallAtlas(this.params, 'wallHi', 0), WALL, AH, true, 'pixel');
    this.wallB = makeTexture(buildWallAtlas(this.params, 'wallLo', 0), WALL, AH, true, 'pixel');
    this.wallC = makeTexture(buildWallAtlas(this.params, 'wallLo', 2), WALL, AH, true, 'pixel');
    this.wallD = makeTexture(buildWallAtlas(this.params, 'wallHi', 1), WALL, AH, true, 'pixel');

    for (const t of [this.wallA, this.wallB, this.wallC, this.wallD]) {
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
    }

    // Rampa toon: o Three amostra em (N·L * 0.5 + 0.5), então a metade clara (texels 4-7)
    // é quem responde à inclinação das faces voltadas ao sol. Com só 3 texels quase todo o
    // terreno iluminado caía no tom máximo e o relevo ficava chapado; 4 degraus na metade
    // clara deixam o volume das encostas legível sem perder o visual em faixas.
    const ramp = [58, 70, 84, 98, 110, 150, 205, 255];
    const rampData = new Uint8Array(ramp.length * 4);
    ramp.forEach((v, k) => rampData.set([v, v, v, 255], k * 4));
    this.gradMap = new THREE.DataTexture(rampData, ramp.length, 1, THREE.RGBAFormat);
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

  /**
   * Geração assíncrona via Web Worker: move o custo pesado de genChunkTexture (que escala com o
   * quadrado da densidade de texel) e da malha de relevo para fora da main thread.
   * density 0 = sem textura; segments 0 = sem malha.
   */
  public generateChunkAsync(
    minWorldX: number,
    minWorldZ: number,
    chunkSize: number,
    density: number,
    priority: number = 0,
    segments: number = 0,
    walls: boolean = true
  ): { promise: Promise<{ textures?: ReturnType<typeof makeChunkTextures>; geometry?: ChunkGeometryData; grass?: Float32Array }>; cancel: () => void } {
    const pool = getTextureWorkerPool();
    const { promise, reqId } = pool.request(
      this.params.seed,
      this.params,
      minWorldX,
      minWorldZ,
      chunkSize,
      density,
      priority,
      segments,
      walls
    );

    const wrapped = promise.then((r) => ({
      textures: r.texture ? makeChunkTextures(r.texture) : undefined,
      geometry: r.geometry,
      grass: r.texture?.grass
    }));

    return { promise: wrapped, cancel: () => pool.cancel(reqId) };
  }

  /** Variante síncrona (bloqueia a main thread) — mantida para o modo de teste/verificação procedural. */
  public generateChunkTextures(
    minWorldX: number,
    minWorldZ: number,
    chunkSize: number,
    terrainGen: TerrainGenerator
  ): { topTex: THREE.DataTexture; topDarkTex: THREE.DataTexture } {
    const res = genChunkTexture(
      this.params,
      this.perlin,
      terrainGen,
      minWorldX,
      minWorldZ,
      chunkSize,
      this.density
    );

    return makeChunkTextures(res);
  }

  public dispose(): void {
    this.wallA.dispose();
    this.wallB.dispose();
    this.wallC.dispose();
    this.wallD.dispose();
    this.gradMap.dispose();
  }
}
