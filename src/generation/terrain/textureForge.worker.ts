import { genChunkTexture, makePerlin, ForgeParams } from './terrainTextureForge.ts';
import { TerrainGenerator } from './terrainGenerator.ts';
import { buildChunkGeometry } from './chunkGeometry.ts';
import { buildHorizonTile } from './horizonGeometry.ts';
import { buildImpostorBlock } from './horizonTrees.ts';

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

ctx.onmessage = (ev: MessageEvent<any>) => {
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
      ctx.postMessage({ reqId, horizon: t }, bufs);
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
      const grid = segments + 1, hs = new Float32Array(grid * grid);
      for (let i = 0; i < grid * grid; i++) hs[i] = geo.positions[i * 3 + 1];
      meshHeights = { heights: hs, grid, step: chunkSize / segments };
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

    ctx.postMessage(msg, transfer);
  } catch (err: any) {
    ctx.postMessage({ reqId, error: err?.message || String(err) });
  }
};
