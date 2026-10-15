import { TerrainGenerator } from '../terrain/terrainGenerator.ts';
import { clamp, smoothstep } from '../math/mathUtils.ts';

/** Resolução e célula do mapa de tons da água (waterBiomeMap.ts): 128 x 128 texels de 12 m (~1,5 km em volta do jogador). */
export const WB_RES = 128;
export const WB_CELL = 12;
export const WB_SPAN = WB_RES * WB_CELL;
/** Profundidade máxima codificada no canal A (metros): abaixo disso as ondas já estão no tamanho cheio */
export const WB_MAX_DEPTH = 6;

/**
 * Um texel do mapa de tons da água (R = ártico, G = manguezal, B = tropical, A = profundidade do fundo). Sem nada de three.js: roda tanto na
 * thread principal (o plano B) quanto num worker (o caminho normal: a conta custa uns 82 mil consultas de altura por reconstrução).
 */
export function writeWaterTint(gen: TerrainGenerator, data: Uint8Array, o: number, x: number, z: number): void {
  // A água assume o clima da margem que a cerca: altura média da terra num anel de 36m. Um lago
  // no nível do mar cercado de terreno mais alto (e mais frio) fica com o tom da floresta ao
  // redor, não com o de uma planície quente ao nível do mar. No mar aberto isso dá ~0.
  const r = 36;
  const shoreElevation = (
    Math.max(0, gen.getHeight(x + r, z)) + Math.max(0, gen.getHeight(x - r, z)) +
    Math.max(0, gen.getHeight(x, z + r)) + Math.max(0, gen.getHeight(x, z - r))
  ) / 4;
  const { temperature, moisture } = gen.getClimate(x, z, shoreElevation);
  const ice = gen.getIceInfluence(x, z, 0);

  // Mesmos limiares das regras do BiomeManager (FROZEN_TUNDRA abaixo de 0.17 ou com gelo;
  // tropicais acima de 0.62, manguezal no tropical úmido). As rampas suaves começam
  // exatamente no limiar, nunca antes: senão um lago em floresta temperada pegava tom de pântano.
  const arctic = Math.max(1 - smoothstep(0.15, 0.22, temperature), smoothstep(0.05, 0.15, ice));
  const warm = smoothstep(0.62, 0.70, temperature) * (1 - arctic);
  const swamp = warm * smoothstep(0.56, 0.64, moisture);
  const tropical = warm * (1 - swamp);

  const depth = clamp(-gen.getHeight(x, z), 0, WB_MAX_DEPTH);

  data[o] = Math.round(clamp(arctic, 0, 1) * 255);
  data[o + 1] = Math.round(clamp(swamp, 0, 1) * 255);
  data[o + 2] = Math.round(clamp(tropical, 0, 1) * 255);
  data[o + 3] = Math.round((depth / WB_MAX_DEPTH) * 255);
}

/** O mapa inteiro, de uma vez (no worker). */
export function buildWaterBiomeData(gen: TerrainGenerator, originX: number, originZ: number): Uint8Array {
  const data = new Uint8Array(WB_RES * WB_RES * 4);
  for (let row = 0; row < WB_RES; row++) {
    const z = originZ + (row + 0.5) * WB_CELL;
    for (let col = 0; col < WB_RES; col++) writeWaterTint(gen, data, (row * WB_RES + col) * 4, originX + (col + 0.5) * WB_CELL, z);
  }
  return data;
}
