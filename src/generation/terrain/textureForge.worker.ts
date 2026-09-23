import { genChunkTexture, makePerlin, ForgeParams } from './terrainTextureForge.ts';
import { TerrainGenerator } from './terrainGenerator.ts';

/**
 * Worker dedicado à geração pesada de texturas de chunk (Pixel Terrain Forge).
 * Roda em thread separada da UI/render, eliminando 100% dos stutters de main-thread
 * ao carregar chunks com densidade de texel alta (até 24 tx/m).
 */

interface BuildRequest {
  reqId: number;
  seed: number;
  params: ForgeParams;
  minWorldX: number;
  minWorldZ: number;
  chunkSize: number;
  density: number;
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
  const { reqId, seed, params, minWorldX, minWorldZ, chunkSize, density } = ev.data;
  try {
    const terrainGen = getTerrainGen(seed);
    const perlin = getPerlin(seed);
    const res = genChunkTexture(params, perlin, terrainGen, minWorldX, minWorldZ, chunkSize, density);

    ctx.postMessage(
      {
        reqId,
        img: res.img.buffer,
        imgD: res.imgD.buffer,
        bimg: res.bimg.buffer,
        width: res.width,
        height: res.height
      },
      [res.img.buffer, res.imgD.buffer, res.bimg.buffer]
    );
  } catch (err: any) {
    ctx.postMessage({ reqId, error: err?.message || String(err) });
  }
};
