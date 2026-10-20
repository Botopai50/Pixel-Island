import { PRNG } from '../math/prng.ts';
import { CONFIG } from '../../config.ts';
import type { RockBiome } from '../vegetation/pixelTrees/types';
import type { Pad, SettlementKind, SettlementOptions, SettlementPlan, TerrainSampler } from './types';
import { DEFAULT_SETTLEMENT_SETTINGS } from './types';
import { planSettlement } from './planner';

/**
 * Cidades do mundo: o mundo é dividido em células de SETTLEMENT_CELL metros; cada célula pode ter
 * uma cidade (decidida por semente e relevo seco - barato), planejada por planSettlement.
 *
 * Função pura e determinística, então dá o mesmo resultado em qualquer thread: os workers de chunk
 * planejam sozinhos (modo 'sync') e achatam o relevo sob as casas dentro de getHeight; a thread
 * principal recebe os planos prontos do worker de cidades (modo 'external') para não travar.
 */
export const SETTLEMENT_CELL = 1400;
/** tudo na cidade é construído nesta escala: as casas do gerador (6 m) ficavam pequenas ao lado das árvores do jogo */
export const SETTLEMENT_SCALE = 1.7;
/** metros de folga entre a origem do sítio e a borda da célula: a cidade inteira cabe na célula */
const MARGIN = 440;
const BLEND = 6;

const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

/** O que o relevo do jogo precisa oferecer (TerrainGenerator satisfaz isto). */
export interface SettlementTerrain {
  getSeed(): number;
  getDryHeight(x: number, z: number): number;
  getHeightRaw(x: number, z: number): number;
  getWaterSurfaceY(x: number, z: number): number;
  getVolcanoInfluence(x: number, z: number): number;
  getClimate(x: number, z: number, elevation: number): { temperature: number; moisture: number };
  desertMask(x: number, z: number): number;
}

export interface SettlementSite {
  cx: number;
  cz: number;
  /** origem do sistema local do plano (m, mundo) */
  x: number;
  z: number;
  kind: SettlementKind;
  seed: number;
  biome: RockBiome;
  waterLevel: number;
}

export interface PreparedPad extends Pad { minX: number; maxX: number; minZ: number; maxZ: number; c: number; s: number }

export interface SettlementEntry {
  site: SettlementSite;
  plan: SettlementPlan;
  /** achatamentos, em coordenadas LOCAIS do plano */
  pads: Pad[];
  /** retângulo (mundo) que a cidade ocupa */
  minX: number; maxX: number; minZ: number; maxZ: number;
}

/** raio (m, no espaço da cidade) do banco de rochas em volta da árvore da praça */
export const FOUNTAIN_RADIUS = 2.7;

const KIND_RADIUS: Record<SettlementKind, number> = { hamlet: 38, village: 62, town: 95, fortifiedTown: 105 };

/** Achatamento do terreno sob cada construção e sob a muralha (o mesmo que o construtor usava). */
export function planPads(plan: SettlementPlan): Pad[] {
  return [
    ...plan.buildings.map((b): Pad => ({ x: b.x, z: b.z, hw: b.hw + 0.4, hd: b.hd + 0.4, yaw: b.yaw, y: b.baseY })),
    ...plan.walls.map((w): Pad => ({ x: w.x, z: w.z, hw: w.hw + 0.3, hd: w.hd + (w.stairSide ? 2.4 : 0.6), yaw: w.yaw, y: w.baseY })),
    // chão do centro da praça: plano, para a árvore, o banco de rochas e a lanterna assentarem
    ...plan.props.filter((q) => q.id === 'centre').map((q): Pad => ({ x: q.x, z: q.z, hw: plan.plaza.radius * 0.85, hd: plan.plaza.radius * 0.85, yaw: 0, y: q.baseY })),
    // as duas pontas de cada ponte: o terreno em volta é nivelado na altura do encontro de pedra, que assenta no chão
    // (o rio, o leito e a margem molhada nunca são tocados: ver adjust)
    ...plan.bridges.flatMap((b): Pad[] => [-1, 1].map((side) => {
      // a escada e os pilares das pontas vão além do vão: o patamar cobre o encontro e a rampa de chegada
      const off = side * (b.length / 2 + 1.2);
      // o ponto mais baixo do modelo (a base das sapatas) fica em -0,09 da origem: o chão assenta exatamente ali, como no gerador
      return { x: b.x + off * Math.cos(b.yaw), z: b.z - off * Math.sin(b.yaw), hw: 6.2, hd: b.hd + 2.2, yaw: b.yaw, y: b.baseY - 0.1 };
    })),
  ];
}

export function preparePads(pads: Pad[]): PreparedPad[] {
  return pads.map((p) => {
    const r = Math.hypot(p.hw, p.hd) + BLEND;
    return { ...p, minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, c: Math.cos(p.yaw), s: Math.sin(p.yaw) };
  });
}

/** Terreno suavemente achatado sob cada pad (BLEND m de transição). Coordenadas locais. */
export function flattenAt(prepared: PreparedPad[], x: number, z: number, h: number): number {
  for (const a of prepared) {
    if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
    const dx = x - a.x, dz = z - a.z;
    const lx = Math.abs(dx * a.c - dz * a.s), lz = Math.abs(dx * a.s + dz * a.c);
    const ox = Math.max(0, lx - a.hw), oz = Math.max(0, lz - a.hd);
    const d = Math.hypot(ox, oz);
    if (d >= BLEND) continue;
    const t = d / BLEND;
    h += (a.y - h) * (1 - t * t * (3 - 2 * t));
  }
  return h;
}

/** Relevo bruto em grade de 2 m calculada sob demanda: o planejador consulta milhares de vezes. */
class CachedTerrain implements TerrainSampler {
  waterLevel = CONFIG.SEA_LEVEL;
  private hs = new Map<number, number>();
  private ws = new Map<number, number>();
  private static STEP = 2;
  constructor(private tg: SettlementTerrain, private ox: number, private oz: number) {}
  private node(i: number, j: number): number {
    const k = (i + 8192) * 16384 + (j + 8192);
    let h = this.hs.get(k);
    if (h === undefined) {
      const wx = this.ox + i * CachedTerrain.STEP * SETTLEMENT_SCALE, wz = this.oz + j * CachedTerrain.STEP * SETTLEMENT_SCALE;
      const raw = this.tg.getHeightRaw(wx, wz);
      h = raw / SETTLEMENT_SCALE;
      this.hs.set(k, h);
      this.ws.set(k, raw < this.tg.getWaterSurfaceY(wx, wz) - 0.04 ? 1 : 0);
    }
    return h;
  }
  height(x: number, z: number): number {
    const S = CachedTerrain.STEP;
    const u = x / S, v = z / S;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    const a = this.node(i, j), b = this.node(i + 1, j), c = this.node(i, j + 1), d = this.node(i + 1, j + 1);
    return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
  }
  isWater(x: number, z: number): boolean {
    const S = CachedTerrain.STEP;
    const i = Math.round(x / S), j = Math.round(z / S);
    this.node(i, j);
    return this.ws.get((i + 8192) * 16384 + (j + 8192)) === 1;
  }
}

const DIRS16: [number, number][] = Array.from({ length: 16 }, (_, k) => [Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);

/** Escolhe (barato, só relevo seco) onde a célula tem sítio para uma cidade, ou null. */
export function siteForCell(tg: SettlementTerrain, cx: number, cz: number): SettlementSite | null {
  const seed = tg.getSeed() | 0;
  const rng = new PRNG(Math.floor(PRNG.hash2D(cx, cz, seed ^ 0x5e771e) * 4294967295) || 1);
  if (!rng.chance(CONFIG.SETTLEMENT_CHANCE)) return null;
  const kr = rng.next();
  const kind: SettlementKind = kr < 0.34 ? 'hamlet' : kr < 0.68 ? 'village' : kr < 0.9 ? 'town' : 'fortifiedTown';
  const R = KIND_RADIUS[kind] * SETTLEMENT_SCALE;
  const H = (x: number, z: number) => tg.getDryHeight(x, z);
  let best: { x: number; z: number; score: number } | null = null;
  for (let c = 0; c < 18; c++) {
    const x = cx * SETTLEMENT_CELL + MARGIN + rng.next() * (SETTLEMENT_CELL - MARGIN * 2);
    const z = cz * SETTLEMENT_CELL + MARGIN + rng.next() * (SETTLEMENT_CELL - MARGIN * 2);
    const h = H(x, z);
    if (h < 6 || h > 70) continue;
    if (tg.getVolcanoInfluence(x, z) > 0.04) continue;
    let rough = 0, low = false, hi = 0;
    for (const f of [0.5, 1.1]) {
      for (const [dx, dz] of DIRS16) {
        const hh = H(x + dx * R * f, z + dz * R * f);
        if (hh < 2.5) low = true;
        rough += Math.abs(hh - h);
        hi = Math.max(hi, hh - h);
      }
    }
    if (low || hi > R * 0.55) continue;
    const score = rough / 32;
    if (!best || score < best.score) best = { x, z, score };
  }
  if (!best || best.score > R * 0.16) return null;
  const clim = tg.getClimate(best.x, best.z, H(best.x, best.z));
  const biome: RockBiome = tg.desertMask(best.x, best.z) > 0.5 ? 'gerudo' : clim.temperature < 0.2 ? 'hebra_snowy' : 'hyrule';
  return { cx, cz, x: best.x, z: best.z, kind, seed: Math.floor(PRNG.hash2D(cx, cz, seed ^ 0x3a1f) * 90000) + 1000, biome, waterLevel: CONFIG.SEA_LEVEL };
}

/** Planeja a cidade do sítio (caro: 0,3 a 2 s). Devolve null se sobraram poucas construções. */
export function planSite(tg: SettlementTerrain, site: SettlementSite, tune?: Partial<SettlementOptions>): SettlementEntry | null {
  const sampler = new CachedTerrain(tg, site.x, site.z);
  // nível da água: a superfície mais comum nos pontos molhados em volta (rios e lagos ficam acima do mar)
  const R = KIND_RADIUS[site.kind];
  const S = SETTLEMENT_SCALE;
  const surfaces: number[] = [];
  for (let dx = -R * 2; dx <= R * 2; dx += 12) for (let dz = -R * 2; dz <= R * 2; dz += 12) {
    if (sampler.isWater(dx, dz)) surfaces.push(tg.getWaterSurfaceY(site.x + dx * S, site.z + dz * S));
  }
  if (surfaces.length) { surfaces.sort((a, b) => a - b); sampler.waterLevel = surfaces[surfaces.length >> 1] / S; }
  const options: SettlementOptions = {
    ...DEFAULT_SETTLEMENT_SETTINGS, kind: site.kind, seed: site.seed, biome: site.biome, siteSpan: 0.6,
    size: 0.85, density: 1, frequency: 0.55, terrainStyle: 'hills', // vila compacta: casas próximas, como na referência
    ...tune,
  };
  const plan = planSettlement(options, sampler);
  if (plan.buildings.length < 3) return null;
  const pads = planPads(plan);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of plan.boundary) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  for (const p of pads) {
    const r = Math.hypot(p.hw, p.hd) + BLEND;
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r); minZ = Math.min(minZ, p.z - r); maxZ = Math.max(maxZ, p.z + r);
  }
  const m = 14;
  return { site: { ...site, waterLevel: sampler.waterLevel }, plan, pads, minX: site.x + minX * S - m, maxX: site.x + maxX * S + m, minZ: site.z + minZ * S - m, maxZ: site.z + maxZ * S + m };
}

interface Slot { entry: SettlementEntry | null; prepared: PreparedPad[] }

/**
 * Cidades já planejadas, consultadas pelo relevo (achatar) e pela vegetação (não plantar).
 * 'sync' planeja ao precisar; 'external' só usa o que `provide` entregou.
 */
export class SettlementField {
  private slots = new Map<number, Slot>();
  private sites = new Map<number, SettlementSite | null>();
  public mode: 'sync' | 'external' = 'sync';
  constructor(private tg: SettlementTerrain) {}

  public reset(): void { this.slots.clear(); this.sites.clear(); }

  public siteAt(cx: number, cz: number): SettlementSite | null {
    const k = cellKey(cx, cz);
    let s = this.sites.get(k);
    if (s === undefined) { s = CONFIG.SETTLEMENTS_ENABLED ? siteForCell(this.tg, cx, cz) : null; this.sites.set(k, s); }
    return s;
  }

  /** Entrega o resultado de um planejamento feito em outra thread. */
  public provide(cx: number, cz: number, entry: SettlementEntry | null): void {
    this.slots.set(cellKey(cx, cz), { entry, prepared: entry ? preparePads(entry.pads) : [] });
  }

  public has(cx: number, cz: number): boolean { return this.slots.has(cellKey(cx, cz)); }

  private slot(cx: number, cz: number): Slot | undefined {
    const k = cellKey(cx, cz);
    let s = this.slots.get(k);
    if (!s && this.mode === 'sync') {
      const site = this.siteAt(cx, cz);
      const entry = site ? planSite(this.tg, site) : null;
      s = { entry, prepared: entry ? preparePads(entry.pads) : [] };
      this.slots.set(k, s);
    }
    return s;
  }

  public entry(cx: number, cz: number): SettlementEntry | null { return this.slot(cx, cz)?.entry ?? null; }

  /** Relevo achatado sob a cidade (se o ponto cair numa). */
  public adjust(x: number, z: number, h: number): number {
    if (!CONFIG.SETTLEMENTS_ENABLED) return h;
    const cx = Math.floor(x / SETTLEMENT_CELL), cz = Math.floor(z / SETTLEMENT_CELL);
    const k = cellKey(cx, cz);
    const known = this.slots.get(k);
    if (known === undefined) {
      if (this.mode === 'external') return h;
      // perto o bastante de um sítio possível? só então vale planejar
      const site = this.siteAt(cx, cz);
      if (!site || Math.abs(x - site.x) > 560 || Math.abs(z - site.z) > 560) return h;
    }
    const s = known ?? this.slot(cx, cz);
    const e = s?.entry;
    if (!e || x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) return h;
    const flat = flattenAt(s!.prepared, (x - e.site.x) / SETTLEMENT_SCALE, (z - e.site.z) / SETTLEMENT_SCALE, h / SETTLEMENT_SCALE) * SETTLEMENT_SCALE;
    // o nivelamento nunca mexe no rio/lago/mar: leito e margem molhada (até 0,3 m acima da água) ficam como o mundo fez
    if (Math.abs(flat - h) > 1e-4 && h < this.tg.getWaterSurfaceY(x, z) + 0.3) return h;
    return flat;
  }

  /** Cidades cujo retângulo toca [minX,maxX]x[minZ,maxZ]. */
  public near(minX: number, minZ: number, maxX: number, maxZ: number): SettlementEntry[] {
    const out: SettlementEntry[] = [];
    if (!CONFIG.SETTLEMENTS_ENABLED) return out;
    const c0x = Math.floor(minX / SETTLEMENT_CELL), c1x = Math.floor(maxX / SETTLEMENT_CELL);
    const c0z = Math.floor(minZ / SETTLEMENT_CELL), c1z = Math.floor(maxZ / SETTLEMENT_CELL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      if (this.mode === 'sync') {
        const site = this.siteAt(cx, cz);
        if (!site || site.x < minX - 560 || site.x > maxX + 560 || site.z < minZ - 560 || site.z > maxZ + 560) continue;
      }
      const e = this.slot(cx, cz)?.entry;
      if (e && e.maxX >= minX && e.minX <= maxX && e.maxZ >= minZ && e.minZ <= maxZ) out.push(e);
    }
    return out;
  }
}

/**
 * O ponto é chão da cidade (casas e quintais, ruas, praça)? Coordenadas de mundo. A vegetação natural
 * do mundo cresce nos espaços abertos entre as casas; só esse chão construído fica livre.
 */
export function insideSettlement(e: SettlementEntry, x: number, z: number, margin = 0): boolean {
  if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) return false;
  const S = SETTLEMENT_SCALE;
  const lx = (x - e.site.x) / S, lz = (z - e.site.z) / S;
  const m = margin / S;
  const pl = e.plan.plaza;
  if (Math.hypot(lx - pl.x, lz - pl.z) <= pl.radius + m) return true;
  for (const p of e.pads) {
    const dx = lx - p.x, dz = lz - p.z;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    if (Math.abs(dx * c - dz * s) <= p.hw + m + 0.6 && Math.abs(dx * s + dz * c) <= p.hd + m + 0.6) return true;
  }
  for (const st of e.plan.streets) {
    const r = st.width / 2 + m * 0.5;
    const pts = st.points;
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i][0] - lx) <= r + 1 && Math.abs(pts[i][1] - lz) <= r + 1 && Math.hypot(pts[i][0] - lx, pts[i][1] - lz) <= r + 0.6) return true;
    }
  }
  return false;
}

/** 0 = natural; 1 = terra batida (quintais e chão das casas); 2 = rua de terra; 3 = calçada de pedra (praça, ruas principais). */
export const GROUND_YARD = 1, GROUND_DIRT = 2, GROUND_COBBLE = 3;

/**
 * Máscara de chão da cidade sobre a textura do terreno de um chunk (W x W texels, origem no texel
 * (PX,PY), D texels por metro): ruas, praça e o terreno em volta das casas deixam de ser capim.
 * Devolve null se nenhuma cidade toca o trecho.
 */
const h2 = (ix: number, iz: number) => { let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Ruído -1..1 para irregularizar as bordas do chão: ondulação larga (~1,5 m) mais um pontilhado de pixel solto. */
function edgeNoise(x: number, z: number, D: number): number {
  const u = x / 1.5, v = z / 1.5, iu = Math.floor(u), iv = Math.floor(v);
  const fu = u - iu, fv = v - iv, su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const a = h2(iu, iv), b = h2(iu + 1, iv), c = h2(iu, iv + 1), d = h2(iu + 1, iv + 1);
  const smooth = (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv;
  const dots = h2(Math.floor(x * D), Math.floor(z * D) + 7919);
  return (smooth - 0.5) * 1.6 + (dots - 0.5) * 0.7;
}

export function settlementGroundMask(entries: SettlementEntry[], PX: number, PY: number, W: number, D: number): Uint8Array | null {
  if (!entries.length) return null;
  const x0 = PX / D, z0 = PY / D, x1 = (PX + W) / D, z1 = (PY + W) / D;
  let mask: Uint8Array | null = null;
  const paintBox = (minX: number, maxX: number, minZ: number, maxZ: number, test: (x: number, z: number) => boolean, value: number) => {
    const ix0 = Math.max(0, Math.floor(minX * D) - PX), ix1 = Math.min(W - 1, Math.ceil(maxX * D) - PX);
    const iz0 = Math.max(0, Math.floor(minZ * D) - PY), iz1 = Math.min(W - 1, Math.ceil(maxZ * D) - PY);
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = (PY + iz + 0.5) / D;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = (PX + ix + 0.5) / D;
        if (!test(x, z)) continue;
        if (!mask) mask = new Uint8Array(W * W);
        const k = iz * W + ix;
        if (mask[k] < value) mask[k] = value;
      }
    }
  };
  for (const e of entries) {
    if (e.maxX < x0 || e.minX > x1 || e.maxZ < z0 || e.minZ > z1) continue;
    const ox = e.site.x, oz = e.site.z, S = SETTLEMENT_SCALE;
    const stone = e.site.kind !== 'hamlet';
    // (sem quintal em volta das casas: só o caminho da porta, abaixo)
    for (const st of e.plan.streets) {
      // ruas principais e secundárias de vilas e cidades são calçada; vielas (e tudo nas aldeias) são chão pisado
      const half = st.width / 2 * S, value = stone && st.cls !== 'lane' ? GROUND_COBBLE : GROUND_DIRT;
      for (let i = 0; i < st.points.length - 1; i++) {
        const [ax, az] = st.points[i], [bx, bz] = st.points[i + 1];
        const abx = bx - ax, abz = bz - az, len2 = abx * abx + abz * abz || 1;
        paintBox(ox + Math.min(ax, bx) * S - half - 1.2, ox + Math.max(ax, bx) * S + half + 1.2, oz + Math.min(az, bz) * S - half - 1.2, oz + Math.max(az, bz) * S + half + 1.2, (x, z) => {
          const px = (x - ox) / S - ax, pz = (z - oz) / S - az;
          const t = Math.max(0, Math.min(1, (px * abx + pz * abz) / len2));
          return Math.hypot(px - abx * t, pz - abz * t) * S <= half + edgeNoise(x, z, D) * Math.min(1.1, half * 0.35);
        }, value);
      }
    }
    // caminho de cada casa: da porta até o ponto mais próximo de uma rua (mesmo quando a rua passa a poucos metros da porta e o
    // planejador não precisou de uma viela), em terra batida, um pouco mais estreito que uma viela
    const doorPath = 1.0 * S;
    for (const b of e.plan.buildings) {
      const [dx0, dz0] = b.door;
      let bx = 0, bz = 0, bd = Infinity;
      for (const st of e.plan.streets) for (const q of st.points) {
        const d = Math.hypot(q[0] - dx0, q[1] - dz0);
        if (d < bd) { bd = d; bx = q[0]; bz = q[1]; }
      }
      if (!Number.isFinite(bd) || bd < 0.4 || bd > 14) continue;
      const abx = bx - dx0, abz = bz - dz0, len2 = abx * abx + abz * abz;
      paintBox(ox + Math.min(dx0, bx) * S - doorPath - 1.2, ox + Math.max(dx0, bx) * S + doorPath + 1.2, oz + Math.min(dz0, bz) * S - doorPath - 1.2, oz + Math.max(dz0, bz) * S + doorPath + 1.2, (x, z) => {
        const px = (x - ox) / S - dx0, pz = (z - oz) / S - dz0;
        const tt = Math.max(0, Math.min(1, (px * abx + pz * abz) / len2));
        return Math.hypot(px - abx * tt, pz - abz * tt) * S <= doorPath + edgeNoise(x, z, D) * 0.45;
      }, GROUND_DIRT);
    }
    const pl = e.plan.plaza;
    paintBox(ox + (pl.x - pl.radius) * S - 2, ox + (pl.x + pl.radius) * S + 2, oz + (pl.z - pl.radius) * S - 2, oz + (pl.z + pl.radius) * S + 2, (x, z) => Math.hypot((x - ox) / S - pl.x, (z - oz) / S - pl.z) * S <= pl.radius * S + edgeNoise(x, z, D) * 1.2, stone ? GROUND_COBBLE : GROUND_DIRT);
  }
  return mask;
}
