import { TerrainGenerator } from '../terrain/terrainGenerator.ts';

/**
 * Worker das cidades: planeja (caro, 0,3 a 2 s) a cidade de uma célula fora da thread principal.
 * Tem o próprio TerrainGenerator, só que em modo 'sync' - o mesmo relevo bruto que os workers de
 * chunk usam, então o plano é idêntico ao que eles recalculam para achatar o terreno.
 */
let tg: TerrainGenerator | null = null;
let seed = NaN;

self.onmessage = (ev: MessageEvent<{ seed: number; cx: number; cz: number }>) => {
  const { cx, cz } = ev.data;
  if (!tg || seed !== ev.data.seed) { tg = new TerrainGenerator(ev.data.seed); seed = ev.data.seed; }
  let entry = null;
  try { entry = tg.settlements.entry(cx, cz); } catch (err) { console.error('[settlement worker]', err); }
  (self as unknown as Worker).postMessage({ seed: ev.data.seed, cx, cz, entry });
};
