import type { TerrainSampler, SettlementSettings } from './types';

/**
 * Integration point with the game's terrain.
 *
 * The planner and builder only ever see a TerrainSampler. When the game has a
 * terrain generator, register it once:
 *
 *   registerTerrainProvider((seed, settings) => myTerrain.asSampler(seed));
 *
 * Until then the stand-in below is used, so a settlement can be generated and
 * checked in the asset viewer. It is a test heightfield, not a terrain system.
 */
export type TerrainProvider = (seed: number, settings: SettlementSettings) => TerrainSampler;

let provider: TerrainProvider | null = null;
export function registerTerrainProvider(next: TerrainProvider | null) { provider = next; }
export function terrainFor(seed: number, settings: SettlementSettings): TerrainSampler {
  return provider ? provider(seed, settings) : createStandInTerrain(seed, settings.terrainStyle);
}

/** Slope as rise over run, from central differences. */
export function slopeAt(t: TerrainSampler, x: number, z: number, d = 1.5): number {
  const gx = (t.height(x + d, z) - t.height(x - d, z)) / (2 * d);
  const gz = (t.height(x, z + d) - t.height(x, z - d)) / (2 * d);
  return Math.hypot(gx, gz);
}

// ---------------------------------------------------------------------------
// stand-in terrain
// ---------------------------------------------------------------------------

function hash2(ix: number, iz: number, s: number): number {
  const v = Math.sin(ix * 127.1 + iz * 311.7 + s * 74.7) * 43758.5453123;
  return v - Math.floor(v);
}
function noise2(x: number, z: number, s: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
function fbm(x: number, z: number, s: number): number {
  return noise2(x / 90, z / 90, s) * 0.62 + noise2(x / 38, z / 38, s + 11) * 0.28 + noise2(x / 14, z / 14, s + 23) * 0.10;
}

export function createStandInTerrain(seed: number, style: SettlementSettings['terrainStyle']): TerrainSampler {
  const s = (Math.floor(seed) % 1000) * 0.37;
  const waterLevel = 0;
  const amp = style === 'flat' ? 0.4 : 9;
  const rx = 40 + hash2(1, 2, s) * 40;           // where the river runs
  const bend = 0.020 + hash2(3, 4, s) * 0.012;
  const lakeX = -50 + hash2(5, 6, s) * 100, lakeZ = -50 + hash2(7, 8, s) * 100, lakeR = 38 + hash2(9, 1, s) * 22;
  const height = (x: number, z: number): number => {
    let h = 3.2 + (fbm(x, z, s) - 0.45) * amp;
    if (style === 'river') {
      const cx = rx + Math.sin(z * bend) * 26 + Math.sin(z * bend * 2.6 + 1.3) * 7;
      const dist = Math.abs(x - cx);
      const bank = Math.max(0, 1 - dist / 22);
      h = h * (1 - bank * bank) + (waterLevel - 1.4) * (bank * bank);
      if (dist < 9) h = Math.min(h, waterLevel - 0.8 - (1 - dist / 9) * 0.8);
    } else if (style === 'lake') {
      const dist = Math.hypot(x - lakeX, z - lakeZ);
      const bank = Math.max(0, 1 - dist / (lakeR + 16));
      h = h * (1 - bank * bank) + (waterLevel - 1.8) * (bank * bank);
    }
    return h;
  };
  return { height, isWater: (x, z) => height(x, z) < waterLevel - 0.05, waterLevel };
}
