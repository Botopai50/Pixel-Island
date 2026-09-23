import { genChunkTexture, makePerlin, ForgeParams } from './terrainTextureForge.ts';
import { TerrainGenerator } from './terrainGenerator.ts';
import { buildChunkGeometry } from './chunkGeometry.ts';

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

ctx.onmessage = (ev: MessageEvent<BuildRequest>) => {
  const { reqId, seed, params, minWorldX, minWorldZ, chunkSize, density, segments } = ev.data;
  try {
    const terrainGen = getTerrainGen(seed);
    const msg: any = { reqId };
    const transfer: ArrayBuffer[] = [];

    if (segments > 0) {
      const geo = buildChunkGeometry(
        terrainGen, minWorldX + chunkSize / 2, minWorldZ + chunkSize / 2, chunkSize, segments
      );
      msg.geometry = geo;
      transfer.push(geo.positions.buffer as ArrayBuffer, geo.normals.buffer as ArrayBuffer, geo.index.buffer as ArrayBuffer);
    }

    if (density > 0) {
      const res = genChunkTexture(params, getPerlin(seed), terrainGen, minWorldX, minWorldZ, chunkSize, density);
      msg.texture = res;
      transfer.push(res.img.buffer as ArrayBuffer, res.imgD.buffer as ArrayBuffer);
    }

    ctx.postMessage(msg, transfer);
  } catch (err: any) {
    ctx.postMessage({ reqId, error: err?.message || String(err) });
  }
};
