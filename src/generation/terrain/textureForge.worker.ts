import { genChunkTexture, makePerlin, buildWallAtlas, ForgeParams } from './terrainTextureForge.ts';
import { TerrainGenerator } from './terrainGenerator.ts';
import { buildChunkGeometry } from './chunkGeometry.ts';
import { buildHorizonTile } from './horizonGeometry.ts';
import { buildImpostorBlock } from './horizonTrees.ts';
import { buildWaterBiomeData } from '../hydrology/waterBiomeCompute.ts';
import { planChunkVegetation } from '../vegetation/vegetationPlanner.ts';
import { toWire } from '../vegetation/vegetationPlanWire.ts';

/**
 * Worker dedicado à geração pesada de chunks: texturas (Pixel Terrain Forge) e malha de relevo.
 * Roda em thread separada da UI/render, eliminando os stutters de main-thread
 * ao carregar chunks com densidade de texel alta (até 24 tx/m) ou raios de visão grandes.
 */

interface BuildRequest {
  reqId: number;
  seed: number;
  params: ForgeParams;
  minWorldX: number;
  minWorldZ: number;
  chunkSize: number;
  /** tx/m da textura; 0 = só geometria */
  density: number;
  /** subdivisões da malha; 0 = só textura */
  segments: number;
  /** medir os paredões na malha (só nos chunks perto da câmera) */
  walls?: boolean;
}

const terrainGenCache = new Map<number, TerrainGenerator>();
const perlinCache = new Map<number, ReturnType<typeof makePerlin>>();

function getTerrainGen(seed: number): TerrainGenerator {
  let g = terrainGenCache.get(seed);
  if (!g) {
    g = new TerrainGenerator(seed);
    terrainGenCache.set(seed, g);
  }
  return g;
}

function getPerlin(seed: number): ReturnType<typeof makePerlin> {
  let p = perlinCache.get(seed);
  if (!p) {
    p = makePerlin(seed);
    perlinCache.set(seed, p);
  }
  return p;
}

const ctx: Worker = self as any;
/** Ilhas de hidrologia já mandadas para a thread principal (por seed) */
const sentIslands = new Map<number, Set<number>>();
function installIslands(seed: number, items: { key: number; data: any }[]): void {
  const g = getTerrainGen(seed);
  let sent = sentIslands.get(seed);
  if (!sent) { sent = new Set(); sentIslands.set(seed, sent); }
  for (const it of items) { g.getHydrology().installIsland(it.key, it.data); sent.add(it.key); }
}

/** porta para o worker do cache em disco (chunkCache.worker.ts): recebe a cópia dos resultados que valem guardar */
let cachePort: MessagePort | null = null;
function copyForCache(v: unknown, bufs: ArrayBuffer[]): unknown {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) { const c = (v as unknown as { slice(): { buffer: ArrayBuffer } }).slice(); bufs.push(c.buffer); return c; }
  if (Array.isArray(v)) return v.map((x) => copyForCache(x, bufs));
  if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; for (const k of Object.keys(v as object)) o[k] = copyForCache((v as Record<string, unknown>)[k], bufs); return o; }
  return v;
}
/** Grava o resultado no cache em disco (cópia feita AQUI, antes de o resultado ser transferido à thread principal e deixar de existir neste worker). */
function cachePut(key: string | undefined, result: Record<string, unknown>): void {
  if (!cachePort || !key) return;
  try { const bufs: ArrayBuffer[] = []; const value = copyForCache(result, bufs); cachePort.postMessage({ key, value }, bufs); } catch { /* sem cache */ }
}

ctx.onmessage = (ev: MessageEvent<any>) => {
  if (ev.data.type === 'cachePort') { cachePort = ev.data.port as MessagePort; return; }
  // atlas de paredes do terreno (ver TerrainTextureForge): pura função dos parâmetros
  if (ev.data.type === 'wallAtlas') {
    const { reqId, params, slot, shade } = ev.data;
    try { const out = buildWallAtlas(params, slot, shade); ctx.postMessage({ reqId, wallAtlas: out }, [out.buffer] as ArrayBuffer[]); } catch (err: any) { ctx.postMessage({ reqId, error: err?.message || String(err) }); }
    return;
  }
  // hidrologia de ilhas calculada em outro worker (ou na thread principal): instala e não responde
  if (ev.data.type === 'install') {
    installIslands(ev.data.seed, ev.data.items);
    return;
  }
  // bloco do horizonte (terreno distante, malha grossa com cor por vértice)
  if (ev.data.type === 'horizon') {
    const { reqId, seed, minX, minZ, size, seg } = ev.data;
    try {
      const t = buildHorizonTile(getTerrainGen(seed), minX, minZ, size, seg);
      const bufs: ArrayBuffer[] = [t.positions.buffer, t.normals.buffer, t.colors.buffer, t.index.buffer, t.morph.buffer] as ArrayBuffer[];
      cachePut(ev.data.cacheKey, { texture: undefined, geometry: undefined, horizon: t, impostors: undefined, waterBiome: undefined, vegPlan: undefined });
      ctx.postMessage({ reqId, horizon: t }, bufs);
    } catch (err: any) {
      ctx.postMessage({ reqId, error: err?.message || String(err) });
    }
    return;
  }
  // plano da vegetação de um chunk (vegetationPlanner.ts); vira dados simples para atravessar o postMessage
  if (ev.data.type === 'vegPlan') {
    const { reqId, seed, cx, cz, size, detail } = ev.data;
    try {
      const gen = getTerrainGen(seed);
      const plan = planChunkVegetation(cx, cz, size, gen, detail);
      const msg: any = { reqId, vegPlan: toWire(plan) };
      let sent = sentIslands.get(seed);
      if (!sent) { sent = new Set(); sentIslands.set(seed, sent); }
      const hydro = gen.getHydrology().exportIslands(sent);
      if (hydro.length) { msg.hydro = hydro; msg.seed = seed; }
      ctx.postMessage(msg);
    } catch (err: any) {
      ctx.postMessage({ reqId, error: err?.message || String(err) });
    }
    return;
  }
  // mapa de tons da água em volta do jogador (hydrology/waterBiomeMap.ts)
  if (ev.data.type === 'waterBiome') {
    const { reqId, seed, originX, originZ } = ev.data;
    try {
      const gen = getTerrainGen(seed);
      const nIslands = gen.getHydrology().cachedIslandCount();
      const data = buildWaterBiomeData(gen, originX, originZ);
      const msg: any = { reqId, waterBiome: data };
      // ilhas calculadas aqui (se faltou alguma): a thread principal instala em vez de recalcular
      let sent = sentIslands.get(seed);
      if (!sent) { sent = new Set(); sentIslands.set(seed, sent); }
      const hydro = gen.getHydrology().exportIslands(sent);
      if (hydro.length) { msg.hydro = hydro; msg.seed = seed; }
      void nIslands;
      ctx.postMessage(msg, [data.buffer] as ArrayBuffer[]);
    } catch (err: any) {
      ctx.postMessage({ reqId, error: err?.message || String(err) });
    }
    return;
  }
  // árvores distantes (impostores) de um pedaço do mundo, nas posições da vegetação de verdade
  if (ev.data.type === 'impostors') {
    const { reqId, seed, minX, minZ, size, originX, originZ } = ev.data;
    try {
      const t = buildImpostorBlock(getTerrainGen(seed), minX, minZ, size, originX, originZ);
      cachePut(ev.data.cacheKey, { texture: undefined, geometry: undefined, horizon: undefined, impostors: t, waterBiome: undefined, vegPlan: undefined });
      ctx.postMessage({ reqId, impostors: t }, [t.positions.buffer, t.tree.buffer, t.colors.buffer, t.index.buffer] as ArrayBuffer[]);
    } catch (err: any) {
      ctx.postMessage({ reqId, error: err?.message || String(err) });
    }
    return;
  }
  const { reqId, seed, params, minWorldX, minWorldZ, chunkSize, density, segments, walls } = ev.data as BuildRequest;
  try {
    const terrainGen = getTerrainGen(seed);
    const msg: any = { reqId };
    const tStart = performance.now();
    const nIslands = terrainGen.getHydrology().cachedIslandCount();
    const transfer: ArrayBuffer[] = [];

    // pré-cálculo da hidrologia de uma ilha (pedido com antecedência pela thread principal)
    if (ev.data.type === 'island') terrainGen.getHydrology().getIslandHydrology(ev.data.cx, ev.data.cz);

    const tG0 = performance.now();
    let meshHeights: { heights: Float32Array; grid: number; step: number } | undefined;
    if (segments > 0) {
      const geo = buildChunkGeometry(
        terrainGen, minWorldX + chunkSize / 2, minWorldZ + chunkSize / 2, chunkSize, segments, walls !== false
      );
      msg.geometry = geo;
      // alturas dos vértices (antes de transferir o buffer) para os tufos de grama da textura
      const grid = geo.segments + 1, hs = new Float32Array(grid * grid);
      for (let i = 0; i < grid * grid; i++) hs[i] = geo.positions[i * 3 + 1];
      // A warped grid is not uniformly spaced; grass must query the real terrain.
      if(!geo.deformed)meshHeights = { heights: hs, grid, step: chunkSize / geo.segments };
      transfer.push(geo.positions.buffer as ArrayBuffer, geo.normals.buffer as ArrayBuffer, geo.wall.buffer as ArrayBuffer, geo.morph.buffer as ArrayBuffer, geo.index.buffer as ArrayBuffer);
    }

    msg.tGeo = performance.now() - tG0;
    const tT0 = performance.now();
    if (density > 0) {
      const res = genChunkTexture(params, getPerlin(seed), terrainGen, minWorldX, minWorldZ, chunkSize, density, meshHeights);
      msg.texture = res;
      transfer.push(res.img.buffer as ArrayBuffer, res.imgD.buffer as ArrayBuffer);
      if (res.grass) transfer.push(res.grass.buffer as ArrayBuffer);
    }

    msg.tTex = performance.now() - tT0;
    // hidrologia das ilhas calculadas neste worker: a thread principal instala em vez de recalcular
    let sent = sentIslands.get(seed);
    if (!sent) { sent = new Set(); sentIslands.set(seed, sent); }
    const hydro = terrainGen.getHydrology().exportIslands(sent);
    // tempos do job (para medir a geração): total e se calculou hidrologia de ilha nova
    msg.ms = performance.now() - tStart;
    msg.newIslands = terrainGen.getHydrology().cachedIslandCount() - nIslands;
    if (hydro.length) {
      msg.hydro = hydro; msg.seed = seed;
    }

    cachePut(ev.data.cacheKey, { texture: msg.texture, geometry: msg.geometry, horizon: undefined, impostors: undefined, waterBiome: undefined, vegPlan: undefined });
    ctx.postMessage(msg, transfer);
  } catch (err: any) {
    ctx.postMessage({ reqId, error: err?.message || String(err) });
  }
};

// o módulo terminou de carregar: o pool mede quanto tempo os workers levam para ficar prontos
ctx.postMessage({ type: 'ready' });
