import { PRNG } from '../math/prng.ts';
import { BiomeType } from '../types.ts';
import type { TerrainGenerator } from '../terrain/terrainGenerator.ts';

/**
 * Landmarks procedurais: pequenas cenas montadas onde o lugar combina com elas, não objetos
 * espalhados ao acaso. O mundo é dividido em células de LANDMARK_CELL metros; em cada uma, alguns
 * pontos candidatos são avaliados (altitude, inclinação, terreno plano em volta, distância do mar,
 * topo de morro, beira/pé de penhasco, bioma) e o cenário que melhor combina com o melhor lugar
 * vence - ou nenhum, se nada combinar bem.
 *
 * Função pura e determinística (só relevo seco, bioma e feições geológicas - nada que dependa da
 * hidrologia já calculada), então dá o mesmo resultado na thread principal e nos workers: a
 * vegetação (vegetationPlanner) usa isto para deixar o espaço de cada landmark livre.
 */
export type LandmarkType =
  | 'stoneArch' | 'shipwreck' | 'giantTree' | 'stoneCircle' | 'ruin' | 'fossil' | 'cabin'
  | 'altar' | 'cairn' | 'grove' | 'menhirs' | 'naturalBridge';

export interface LandmarkSite {
  type: LandmarkType;
  x: number;
  z: number;
  /** altura do relevo seco no centro */
  y: number;
  /** direção (rad) para onde a cena "olha": o mar, a água, o penhasco... */
  rot: number;
  seed: number;
  /** raio (m) livre de vegetação em volta */
  radius: number;
  biome: BiomeType;
}

export const LANDMARK_CELL = 480;

const RADIUS: Record<LandmarkType, number> = {
  stoneArch: 10, shipwreck: 13, giantTree: 22, stoneCircle: 12, ruin: 13, fossil: 14, cabin: 11,
  altar: 9, cairn: 5, grove: 20, menhirs: 9, naturalBridge: 14,
};

/** peso de cada tipo no sorteio entre os que cabem numa célula (os mais especiais pesam mais) */
const WEIGHT: Record<LandmarkType, number> = {
  stoneArch: 1.3, shipwreck: 1.3, giantTree: 1.0, stoneCircle: 1.0, ruin: 0.7, fossil: 1.2, cabin: 1.0,
  altar: 1.1, cairn: 0.7, grove: 0.8, menhirs: 0.9, naturalBridge: 1.1,
};

const DIRS: [number, number][] = Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]);

const cache = new Map<string, LandmarkSite | null>();

function evaluateCell(tg: TerrainGenerator, cx: number, cz: number): LandmarkSite | null {
  const seed = tg.getSeed() | 0;
  const rng = new PRNG(Math.floor(PRNG.hash2D(cx, cz, seed ^ 0x51ed27) * 4294967295) || 1);
  if (!rng.chance(0.72)) return null;
  const H = (x: number, z: number) => tg.getDryHeight(x, z);
  const biomeMgr = tg.getBiomeManager();
  const volcano = tg.getVolcanoGenerator();
  const margin = 70;

  // melhor lugar de cada tipo de cena nesta célula
  const bestByType = new Map<LandmarkType, { site: LandmarkSite; score: number }>();
  for (let c = 0; c < 10; c++) {
    const x = cx * LANDMARK_CELL + margin + rng.next() * (LANDMARK_CELL - margin * 2);
    const z = cz * LANDMARK_CELL + margin + rng.next() * (LANDMARK_CELL - margin * 2);
    const jitter = rng.range(0.7, 1.3);
    const tie = rng.next();
    const h = H(x, z);
    if (h < 0.4) continue;
    if (volcano.query(x, z).influence > 0.08) continue;

    const slope = Math.hypot(H(x + 3, z) - H(x - 3, z), H(x, z + 3) - H(x, z - 3)) / 6;
    if (slope > 0.7) continue;
    let flat10 = 0, flat20 = 0, cliffUp = 0, cliffDown = 0, ring = 0;
    let seaDist = 999, seaDir = 0, upDir = 0, downDir = 0;
    for (let k = 0; k < 8; k++) {
      const [dx, dz] = DIRS[k];
      const h10 = H(x + dx * 10, z + dz * 10), h20 = H(x + dx * 20, z + dz * 20);
      flat10 = Math.max(flat10, Math.abs(h10 - h));
      flat20 = Math.max(flat20, Math.abs(h20 - h));
      if (h20 - h > cliffUp) { cliffUp = h20 - h; upDir = Math.atan2(dz, dx); }
      if (h - h20 > cliffDown) { cliffDown = h - h20; downDir = Math.atan2(dz, dx); }
      ring += H(x + dx * 70, z + dz * 70);
      for (const r of [15, 30, 55, 90, 140]) {
        if (r >= seaDist) break;
        if (H(x + dx * r, z + dz * r) <= 0) { seaDist = r; seaDir = Math.atan2(dz, dx); break; }
      }
    }
    const hillTop = h - ring / 8;
    const biome = biomeMgr.evaluateBiome(x, z, h, slope, 0, false).type;
    const is = (...t: BiomeType[]) => t.includes(biome);
    const polar = is(BiomeType.FROZEN_TUNDRA, BiomeType.SNOW_SUMMIT);

    const cand: [LandmarkType, number, number][] = []; // tipo, nota, direção
    if (h < 6 && seaDist <= 30 && slope < 0.35 && !polar) cand.push(['stoneArch', 0.95, seaDir]);
    if (h < 3.5 && seaDist <= 30 && flat10 < 1.2) cand.push(['shipwreck', 0.9, seaDir]);
    if (is(BiomeType.COASTAL_MEADOW, BiomeType.TEMPERATE_FOREST, BiomeType.SAVANNAH, BiomeType.AUTUMN_FOREST, BiomeType.BOREAL_TAIGA)
      && flat20 < 2.5 && seaDist > 55) cand.push(['giantTree', 0.66, rng.range(0, 6.28)]);
    if (is(BiomeType.COASTAL_MEADOW, BiomeType.TEMPERATE_FOREST, BiomeType.BOREAL_TAIGA, BiomeType.ALPINE_TUNDRA, BiomeType.AUTUMN_FOREST)
      && flat20 < 1.8) cand.push(['stoneCircle', 0.76 + (hillTop > 4 ? 0.14 : 0), rng.range(0, 6.28)]);
    if (is(BiomeType.TEMPERATE_FOREST, BiomeType.AUTUMN_FOREST, BiomeType.TROPICAL_RAINFOREST, BiomeType.BOREAL_TAIGA)
      && flat10 < 1.6) cand.push(['ruin', 0.78, rng.range(0, 6.28)]);
    if (is(BiomeType.DESERT_DUNES, BiomeType.SAVANNAH, BiomeType.CANYON_DESERT) && flat10 < 2.2) cand.push(['fossil', 0.95, rng.range(0, 6.28)]);
    if (is(BiomeType.BOREAL_TAIGA, BiomeType.TEMPERATE_FOREST, BiomeType.AUTUMN_FOREST, BiomeType.ALPINE_TUNDRA, BiomeType.COASTAL_MEADOW)
      && flat10 < 1.2 && seaDist >= 30) cand.push(['cabin', 0.74 + (seaDist <= 140 ? 0.14 : 0), seaDist <= 140 ? seaDir : rng.range(0, 6.28)]);
    if (hillTop > 8 && flat10 < 2.2 && h > 12) cand.push(['altar', 0.82, rng.range(0, 6.28)]);
    if (cliffDown > 9 && flat10 < 9) cand.push(['cairn', 0.68, downDir]);
    if (is(BiomeType.COASTAL_MEADOW, BiomeType.SAVANNAH, BiomeType.TEMPERATE_FOREST, BiomeType.AUTUMN_FOREST) && flat20 < 2.0 && seaDist > 55)
      cand.push(['grove', 0.74, rng.range(0, 6.28)]);
    if ((is(BiomeType.ALPINE_TUNDRA, BiomeType.BOREAL_TAIGA, BiomeType.COASTAL_MEADOW) || polar) && hillTop > 3 && flat10 < 3)
      cand.push(['menhirs', 0.8, rng.range(0, 6.28)]);
    if (is(BiomeType.DESERT_DUNES, BiomeType.CANYON_DESERT, BiomeType.SAVANNAH) && slope < 0.5 && (cliffUp > 3 || flat20 > 3))
      cand.push(['naturalBridge', 0.75, upDir]);

    for (const [type, score, rot] of cand) {
      const s = score * jitter + tie * 0.01;
      const cur = bestByType.get(type);
      if (!cur || s > cur.score) bestByType.set(type, { site: { type, x, z, y: h, rot, seed: 0, radius: RADIUS[type], biome }, score: s });
    }
  }
  // sorteia o TIPO entre os que cabem na célula (com pesos), e usa o melhor lugar dele: a cena
  // combina com o terreno, mas nenhum tipo comum (ruína em floresta plana) engole os raros
  let total = 0;
  for (const t of bestByType.keys()) total += WEIGHT[t];
  if (total <= 0) return null;
  let pick = rng.next() * total;
  for (const [t, v] of bestByType) {
    pick -= WEIGHT[t];
    if (pick <= 0) { v.site.seed = Math.floor(rng.next() * 1e9); return v.site; }
  }
  return null;
}

/** Landmark da célula (cx, cz), ou null. Calculado uma vez por seed e guardado. */
export function landmarkForCell(tg: TerrainGenerator, cx: number, cz: number): LandmarkSite | null {
  const key = tg.getSeed() + ':' + cx + ':' + cz;
  let site = cache.get(key);
  if (site === undefined) {
    site = evaluateCell(tg, cx, cz);
    cache.set(key, site);
    if (cache.size > 4000) cache.delete(cache.keys().next().value as string);
  }
  return site;
}

/** Landmarks cujo espaço livre toca o retângulo dado. */
export function landmarksNear(tg: TerrainGenerator, minX: number, minZ: number, maxX: number, maxZ: number): LandmarkSite[] {
  const out: LandmarkSite[] = [];
  const pad = 20;
  const c0x = Math.floor((minX - pad) / LANDMARK_CELL), c1x = Math.floor((maxX + pad) / LANDMARK_CELL);
  const c0z = Math.floor((minZ - pad) / LANDMARK_CELL), c1z = Math.floor((maxZ + pad) / LANDMARK_CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const s = landmarkForCell(tg, cx, cz);
      if (s && s.x + s.radius >= minX && s.x - s.radius <= maxX && s.z + s.radius >= minZ && s.z - s.radius <= maxZ) out.push(s);
    }
  }
  return out;
}
