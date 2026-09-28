import { TerrainGenerator } from './terrainGenerator.ts';
import { BiomeType } from '../types.ts';
import { CONFIG } from '../../config.ts';

export interface HorizonTileData {
  /** posições locais ao centro do bloco (x, y, z), grade (seg+1) x (seg+1) + saia */
  positions: Float32Array;
  normals: Float32Array;
  /** cor linear (r, g, b) por vértice */
  colors: Float32Array;
  index: Uint16Array;
  /**
   * Por vértice: quanto subir/descer para cair exatamente na superfície do nível seguinte (o dobro
   * do espaçamento). O shader aplica isso aos poucos no fim do anel (geomorphing): quando o nível
   * some, a forma já é a do seguinte e não aparece "montanha fantasma".
   */
  morph: Float32Array;
}

/** Árvores distantes (impostores) de um pedaço do mundo: horizonTrees.ts */
export interface HorizonTreeData {
  /** pé da árvore (local ao centro do bloco do horizonte), repetido nos 4 cantos do quadro */
  positions: Float32Array;
  /** por vértice: canto x (-0.5/0.5), canto y (0/1), tipo (IMPOSTOR_TYPES), escala (negativa = espelhada) */
  tree: Float32Array;
  /** tom da árvore (cinza, Uint8 normalizado) */
  colors: Uint8Array;
  index: Uint32Array;
}

/** Espécies do atlas de impostores (a mesma ordem do atlas desenhado na thread principal) */
export const IMPOSTOR_TYPES = [
  'oak', 'broadOak', 'pine', 'birch', 'palm', 'acacia', 'mapleRed', 'mapleOrange', 'mapleYellow', 'mangrove', 'snowPine', 'willow',
  'dead', 'cactus', 'cactusSapling',
] as const;

// Cores médias do chão visto de longe (as mesmas paletas das texturas pixel art, já "borradas"
// pela distância), em sRGB 0-255; convertidas para linear no uso
const C_GRASS = [84, 158, 58];
const C_DIRT = [186, 146, 80];
const C_FOREST = [36, 84, 44];
const C_SAND = [228, 202, 148];
const C_SNOW = [236, 242, 250];
const C_SNOW_ROCK = [146, 154, 168];
const C_DESERT = [212, 168, 108];
const C_ASH = [72, 60, 56];
const C_CLIFF = [150, 118, 78];
const C_ROCK = [112, 110, 104];
// fundo do mar: além do alcance da malha de água (~8km) ele fica à vista, então tem a cor da água funda
const C_SEABED = [66, 90, 124];

const lin = (v: number) => Math.pow(v / 255, 2.2);

/** Espaçamento dos vértices e rebaixo do nível 0 do horizonte (horizonTerrain.ts usa os mesmos) */
export const HORIZON_L0_STEP = 16;
export const HORIZON_L0_LOWER = 0.8;

/**
 * Altura da superfície do nível 0 do horizonte num ponto (a malha dele: grade de 16m com a mesma
 * triangulação, já rebaixada). Os chunks usam para se moldar a ela antes de sumir.
 */
export function makeHorizonL0Sampler(terrainGen: TerrainGenerator): (x: number, z: number) => number {
  const S = HORIZON_L0_STEP;
  const cache = new Map<number, number>();
  const H = (gi: number, gj: number) => {
    const key = (gi + 32768) * 65536 + (gj + 32768);
    let h = cache.get(key);
    if (h === undefined) { h = terrainGen.getDryHeight(gi * S, gj * S); cache.set(key, h); }
    return h;
  };
  return (x: number, z: number) => {
    const gi = Math.floor(x / S), gj = Math.floor(z / S);
    const fx = x / S - gi, fz = z / S - gj;
    const a = H(gi, gj), b = H(gi, gj + 1), c = H(gi + 1, gj + 1), d = H(gi + 1, gj);
    // triângulos (a, b, d) e (b, c, d), diagonal b-d (a mesma de buildHorizonTile)
    const h = fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
    return h - HORIZON_L0_LOWER;
  };
}

/**
 * Bloco de terreno distante (horizonte, estilo "Distant Horizons"): malha grossa com a cor do
 * chão por vértice (bioma, floresta, praia, neve, paredão), sem textura, vegetação nem hidrologia
 * (o relevo seco basta de longe e não obriga a calcular as ilhas distantes). Roda no worker.
 */
export function buildHorizonTile(
  terrainGen: TerrainGenerator,
  minX: number,
  minZ: number,
  size: number,
  seg: number
): HorizonTileData {
  const grid = seg + 1;
  const step = size / seg;
  const half = size / 2;
  const cx = minX + half, cz = minZ + half;
  const biomeMgr = terrainGen.getBiomeManager();
  const noise = (x: number, z: number) => {
    // ruído barato de valor (manchas de terra na grama, ~120m)
    const s = Math.sin(x * 0.011 + Math.sin(z * 0.017) * 1.7) * Math.cos(z * 0.013 - Math.sin(x * 0.009) * 1.3);
    return s * 0.5 + 0.5;
  };

  // alturas com um anel extra (normais das bordas)
  const ext = grid + 2;
  const H = new Float32Array(ext * ext);
  for (let j = 0; j < ext; j++) for (let i = 0; i < ext; i++) {
    H[j * ext + i] = terrainGen.getDryHeight(minX + (i - 1) * step, minZ + (j - 1) * step);
  }

  const skirt = seg * 4;
  const vCount = grid * grid + skirt;
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);

  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const v = j * grid + i, e = (j + 1) * ext + (i + 1);
      const x = minX + i * step, z = minZ + j * step;
      const h = H[e];
      positions[v * 3] = x - cx;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = z - cz;
      const gx = (H[e + 1] - H[e - 1]) / (2 * step), gz = (H[e + ext] - H[e - ext]) / (2 * step);
      const len = Math.sqrt(gx * gx + 1 + gz * gz);
      normals[v * 3] = -gx / len; normals[v * 3 + 1] = 1 / len; normals[v * 3 + 2] = -gz / len;
      const slope = Math.sqrt(gx * gx + gz * gz);

      let c: number[];
      if (h < CONFIG.SEA_LEVEL - 0.5) {
        c = C_SEABED;
      } else {
        const b = biomeMgr.evaluateBiome(x, z, h, slope, 0.0, false);
        const polar = b.type === BiomeType.FROZEN_TUNDRA || b.type === BiomeType.SNOW_SUMMIT;
        const desert = b.type === BiomeType.DESERT_DUNES || b.type === BiomeType.CANYON_DESERT;
        const volcanic = b.type === BiomeType.VOLCANIC_FIELD || b.type === BiomeType.VOLCANIC_CALDERA;
        if (polar) c = slope > 0.9 ? C_SNOW_ROCK : C_SNOW;
        else if (desert) c = C_DESERT;
        else if (volcanic) c = C_ASH;
        else if (h < CONFIG.SEA_LEVEL + 1.8 && slope < 0.3) c = C_SAND;
        else {
          // grama com manchas de terra, escurecida pela floresta (copas vistas de longe)
          const p = noise(x, z);
          const dirt = p > 0.72 ? 0.45 : p > 0.62 ? 0.2 : 0.0;
          const forest = Math.min(1, b.vegetationDensity * 0.85);
          c = [0, 1, 2].map((k) => {
            const g = C_GRASS[k] + (C_DIRT[k] - C_GRASS[k]) * dirt;
            return g + (C_FOREST[k] - g) * forest;
          });
        }
        // paredões e encostas muito íngremes: terra/rocha
        if (slope > 1.0 && !polar) {
          const t = Math.min(1, (slope - 1.0) / 0.8);
          const wall = h > 12 ? C_CLIFF : C_ROCK;
          c = [0, 1, 2].map((k) => c[k] + (wall[k] - c[k]) * t);
        }
      }
      colors[v * 3] = lin(c[0]); colors[v * 3 + 1] = lin(c[1]); colors[v * 3 + 2] = lin(c[2]);
    }
  }

  // saia em volta (desce alguns metros): tapa as frestas entre blocos de níveis diferentes
  const perimeter: number[] = [];
  for (let i = 0; i < seg; i++) perimeter.push(i);
  for (let j = 0; j < seg; j++) perimeter.push(j * grid + seg);
  for (let i = seg; i > 0; i--) perimeter.push(seg * grid + i);
  for (let j = seg; j > 0; j--) perimeter.push(j * grid);
  const skirtDepth = 4 + step * 0.5;
  for (let k = 0; k < perimeter.length; k++) {
    const s = perimeter[k], d = grid * grid + k;
    positions[d * 3] = positions[s * 3];
    positions[d * 3 + 1] = positions[s * 3 + 1] - skirtDepth;
    positions[d * 3 + 2] = positions[s * 3 + 2];
    for (let q = 0; q < 3; q++) { normals[d * 3 + q] = normals[s * 3 + q]; colors[d * 3 + q] = colors[s * 3 + q]; }
  }

  const index = new Uint16Array(seg * seg * 6 + perimeter.length * 6);
  let o = 0;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = i + grid * j, b = i + grid * (j + 1), c = i + 1 + grid * (j + 1), d = i + 1 + grid * j;
      index[o++] = a; index[o++] = b; index[o++] = d;
      index[o++] = b; index[o++] = c; index[o++] = d;
    }
  }
  for (let k = 0; k < perimeter.length; k++) {
    const k2 = (k + 1) % perimeter.length;
    const t0 = perimeter[k], t1 = perimeter[k2], b0 = grid * grid + k, b1 = grid * grid + k2;
    index[o++] = t0; index[o++] = b0; index[o++] = t1;
    index[o++] = t1; index[o++] = b0; index[o++] = b1;
  }
  // morph para o nível seguinte: os vértices de índice par são os dele; os ímpares caem no meio
  // das arestas ou na diagonal b-d da célula grossa
  const morph = new Float32Array(vCount);
  const Hg = (i: number, j: number) => H[(j + 1) * ext + (i + 1)];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const oi = i & 1, oj = j & 1;
      let t: number;
      if (!oi && !oj) t = Hg(i, j);
      else if (oi && !oj) t = (Hg(i - 1, j) + Hg(i + 1, j)) / 2;
      else if (!oi && oj) t = (Hg(i, j - 1) + Hg(i, j + 1)) / 2;
      else t = (Hg(i - 1, j + 1) + Hg(i + 1, j - 1)) / 2;
      morph[j * grid + i] = t - Hg(i, j);
    }
  }
  for (let k = 0; k < perimeter.length; k++) morph[grid * grid + k] = morph[perimeter[k]];

  return { positions, normals, colors, index, morph };
}
