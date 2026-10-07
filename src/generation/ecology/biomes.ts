import { SimplexNoise } from '../math/simplexNoise.ts';
import { clamp, smoothstep } from '../math/mathUtils.ts';
import { CONFIG } from '../../config.ts';
import { BiomeType, type BiomeData } from '../types.ts';

type TreeMix = BiomeData['treeTypeDistribution'];
const NO_TREES: TreeMix = { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 };

/**
 * Biomas como no mundo real: grandes regiões decididas pelo CLIMA, não por ruído local.
 *
 * - Temperatura: faixas de latitude (frio ao norte = z negativo, quente ao sul), num ciclo de
 *   ~56km, onduladas por ruído de escala de vários km e com as coordenadas deformadas (~1.4km):
 *   as fronteiras ficam orgânicas e nunca em linha reta.
 * - Umidade: manchas de ~6km com variação média de ~2km. Os rios só aumentam um pouco a umidade
 *   (deixam a beira mais verde), sem trocar o bioma.
 * - Bioma pela tabela de Whittaker (temperatura x umidade): deserto, savana e selva no quente;
 *   campos, floresta mista e bosque outonal no temperado; taiga e tundra no frio; gelo no polar.
 * - Altitude: só nas montanhas de verdade. Linha das árvores e linha de neve sobem no clima quente
 *   e descem no frio (como nos Andes x Alpes), com leve variação.
 *
 * Nada de ruído fino nem inclinação decidindo o TIPO do bioma (antes: manchas de ~200m, faixas por
 * altura em qualquer morro, "encosta rochosa" em cada barranco e manguezal em cada beira de rio).
 * Encostas íngremes já ganham rocha pela textura dos paredões; a densidade da vegetação continua
 * variando dentro de cada bioma (clareiras, bosques).
 */
export class BiomeManager {
  private seed: number;
  private noise: SimplexNoise;

  constructor(seed: number = 0) {
    this.seed = seed;
    this.noise = new SimplexNoise(seed ^ 0x3c6ef372);
  }

  public reseed(seed: number): void {
    this.seed = seed;
    this.noise.reseed(seed ^ 0x3c6ef372);
  }

  public getSeed(): number {
    return this.seed;
  }

  /**
   * Clima de base (sem altitude): temperatura e umidade de 0 a 1, contínuas e de escala grande.
   */
  public getBaseClimate(x: number, z: number): { temperature: number; moisture: number } {
    const n = this.noise;
    // coordenadas deformadas: fronteiras orgânicas em vez de faixas retas
    const wx = x + n.fbm2D(x * 0.00025 + 11.3, z * 0.00025 - 7.1, 3) * 1400;
    const wz = z + n.fbm2D(x * 0.00025 - 31.7, z * 0.00025 + 19.9, 3) * 1400;
    // latitude: -1 no norte (frio) .. +1 no sul (quente), ciclo de 56km em rampa linear (onda
    // triangular): com uma senoide as faixas do meio (temperado) ficavam estreitas e os extremos largos
    const ph = wz / 56000 + 0.25;
    const lat = 1 - 4 * Math.abs(ph - Math.floor(ph) - 0.5);
    const temperature = clamp(0.5 + lat * 0.40 + n.fbm2D(wx * 0.00018 + 5.1, wz * 0.00018 + 9.3, 2) * 0.16, 0, 1);
    const moisture = clamp(
      0.5 + n.fbm2D(wx * 0.00017 + 120.0, wz * 0.00017 + 120.0, 2) * 0.62
          + n.fbm2D(wx * 0.0005 + 40.0, wz * 0.0005 - 60.0, 2) * 0.07,
      0, 1);
    return { temperature, moisture };
  }

  /** Clima num ponto: o de base, esfriando um pouco com a altitude e mais úmido perto dos rios. */
  public getClimate(x: number, z: number, elevation: number, moistureBonus: number = 0.0): { temperature: number; moisture: number } {
    const c = this.getBaseClimate(x, z);
    return {
      temperature: clamp(c.temperature - Math.max(0, elevation - 20) / CONFIG.MAX_HEIGHT * 0.3, 0, 1),
      moisture: clamp(c.moisture + moistureBonus * 0.12, 0, 1),
    };
  }

  /** Linha de neve (m) no clima de base dado: sobe no quente, desce no frio, com leve variação. */
  private snowLine(x: number, z: number, temperature: number): number {
    return 92 + (temperature - 0.5) * 50 + this.noise.fbm2D(x * 0.0016 + 77.0, z * 0.0016 - 13.0, 2) * 7;
  }

  public evaluateBiome(
    x: number,
    z: number,
    elevation: number,
    slope: number,
    moistureBonus: number = 0.0,
    isWater: boolean = false,
    specialEnv?: Parameters<BiomeManager['classify']>[6]
  ): BiomeData {
    const b = this.classify(x, z, elevation, slope, moistureBonus, isWater, specialEnv);
    // encostas íngremes (paredões, barrancos): sem árvores em qualquer bioma
    if (slope > CONFIG.VEGETATION.MAX_SLOPE_FOR_TREES) b.vegetationDensity = 0;
    return b;
  }

  private classify(
    x: number,
    z: number,
    elevation: number,
    slope: number,
    moistureBonus: number = 0.0,
    isWater: boolean = false,
    specialEnv?: {
      volcanoInfluence?: number;
      isCaldera?: boolean;
      canyonInfluence?: number;
      geothermalInfluence?: number;
      isThermalPool?: boolean;
      iceInfluence?: number;
    }
  ): BiomeData {
    const isSteepSlope = slope > CONFIG.VEGETATION.MAX_SLOPE_FOR_TREES;

    // 1. Feições geológicas (prioridade sobre o clima)
    if (specialEnv?.volcanoInfluence && specialEnv.volcanoInfluence > 0.18) {
      if (specialEnv.isCaldera) {
        return this.make(BiomeType.VOLCANIC_CALDERA, 0.1, 0.98, 0.0, NO_TREES, 0.0, 0.85, 0.0, '#ff4500');
      }
      if (elevation > CONFIG.SEA_LEVEL && !isWater) {
        return this.make(BiomeType.VOLCANIC_FIELD, 0.15, 0.82, isSteepSlope ? 0.0 : 0.06,
          { ...NO_TREES, deadBurntTree: 1.0 }, 0.03, 0.78, 0.25, '#25262a');
      }
    }
    if (specialEnv?.geothermalInfluence && specialEnv.geothermalInfluence > 0.35) {
      return this.make(BiomeType.GEOTHERMAL_VALLEY, 0.85, 0.78, 0.0, NO_TREES, 0.05, 0.65, 0.0, '#d8cbb5');
    }

    // 2. Água (mar, lagos e rios)
    if (elevation <= CONFIG.SEA_LEVEL || isWater) {
      return elevation < -8.0
        ? this.make(BiomeType.OCEAN, 1.0, 0.5, 0.0, NO_TREES, 0.0, 0.02, 0.0, '#143857')
        : this.make(BiomeType.SHALLOWS, 1.0, 0.6, 0.0, NO_TREES, 0.0, 0.06, 0.0, '#25788d');
    }

    const base = this.getBaseClimate(x, z);
    const temperature = base.temperature;
    const moisture = clamp(base.moisture + moistureBonus * 0.12, 0, 1);
    // densidade dentro do bioma: bosques e clareiras (~80m e ~30m) - só a quantidade, nunca o tipo
    const clusterNoise = this.noise.fbm2D(x * 0.012, z * 0.012, 3) * 0.5 + 0.5;
    const gladeNoise = this.noise.noise2D(x * 0.035, z * 0.035);

    // 3. Polar: gelo e tundra ártica (clima de base muito frio ou mar congelado)
    if ((specialEnv?.iceInfluence ?? 0) > 0.15 || temperature < 0.17) {
      return this.make(BiomeType.FROZEN_TUNDRA, 0.75, temperature, isSteepSlope ? 0.0 : 0.04,
        { ...NO_TREES, snowPine: 0.65, arcticWillow: 0.35 }, 0.20, 0.55, 0.05, '#d2e7f5');
    }

    // 4. Andares de altitude: só acima da linha das árvores de cada clima
    const snowLine = this.snowLine(x, z, temperature);
    if (elevation > snowLine) {
      return this.make(BiomeType.SNOW_SUMMIT, 0.8, 0.05, 0.0, NO_TREES, 0.02, 0.55, 0.0, '#f0f4f8');
    }
    if (elevation > snowLine - 20) {
      return this.make(BiomeType.ALPINE_TUNDRA, moisture, temperature, isSteepSlope ? 0.0 : 0.03,
        { ...NO_TREES, pine: 0.8, birch: 0.2 }, 0.22, 0.58, 0.05, '#586252');
    }

    // 5. Cânions: rocha de deserto só em clima quente e seco (em outros climas o cânion é só relevo)
    if ((specialEnv?.canyonInfluence ?? 0) > 0.45 && elevation > CONFIG.BEACH_HEIGHT && temperature > 0.5 && moisture < 0.55) {
      return this.make(BiomeType.CANYON_DESERT, 0.22, 0.75, isSteepSlope ? 0.0 : 0.12,
        { ...NO_TREES, acacia: 0.35, cactus: 0.65 }, 0.15, 0.55, 0.08, '#b85c38');
    }

    // 6. Costa: manguezal nas costas tropicais úmidas, praia no resto
    if (elevation <= CONFIG.BEACH_HEIGHT && slope < 0.55) {
      if (temperature > 0.66 && moisture > 0.58) {
        return this.make(BiomeType.MANGROVE_SWAMP, moisture, temperature, 0.45,
          { ...NO_TREES, coastalPalm: 0.15, mangrove: 0.85 }, 0.35, 0.08, 0.40, '#2b3820');
      }
      const isPalmCluster = clusterNoise > 0.60 && gladeNoise > 0.05;
      const warm = smoothstep(0.35, 0.55, temperature);
      return this.make(BiomeType.BEACH, 0.35, temperature, (isPalmCluster ? 0.055 : 0.008) * warm,
        { ...NO_TREES, coastalPalm: 1.0, mangrove: 0.0, deadBurntTree: 0.0 }, 0.0, 0.05, 0.03, '#e1d09e');
    }

    // 7. Tabela de Whittaker
    if (temperature < 0.30) {
      if (moisture < 0.35) {
        // tundra fria e seca: líquens, capim baixo, quase sem árvores
        return this.make(BiomeType.ALPINE_TUNDRA, moisture, temperature, isSteepSlope ? 0.0 : 0.04,
          { ...NO_TREES, pine: 0.7, birch: 0.3 }, 0.22, 0.50, 0.05, '#586252');
      }
      const density = smoothstep(0.2, 0.6, clusterNoise) * 0.72;
      return this.make(BiomeType.BOREAL_TAIGA, moisture, temperature, gladeNoise > 0.7 ? 0.15 : density,
        { ...NO_TREES, oak: 0.05, pine: 0.85, birch: 0.1 }, 0.35, 0.25, 0.32, '#2a4428');
    }
    if (temperature < 0.62) {
      if (moisture < 0.32) {
        // campos e pradarias abertas
        return this.make(BiomeType.COASTAL_MEADOW, moisture, temperature, 0.08 + smoothstep(0.55, 0.8, clusterNoise) * 0.12,
          { ...NO_TREES, oak: 0.65, pine: 0.1, birch: 0.25 }, 0.32, 0.12, 0.08, '#6d9441');
      }
      if (temperature < 0.44) {
        // faixa temperada fria e úmida: bosque caducifólio com folhagem de outono
        const density = smoothstep(0.2, 0.6, clusterNoise) * 0.76;
        return this.make(BiomeType.AUTUMN_FOREST, moisture, temperature, gladeNoise > 0.75 ? 0.18 : density,
          { ...NO_TREES, oak: 0.15, pine: 0.10, birch: 0.20, autumnMaple: 0.55 }, 0.50, 0.15, 0.38, '#6d5330');
      }
      const density = smoothstep(0.25, 0.65, clusterNoise) * 0.72;
      return this.make(BiomeType.TEMPERATE_FOREST, moisture, temperature, gladeNoise > 0.7 ? 0.18 : density,
        { ...NO_TREES, oak: 0.55, pine: 0.2, birch: 0.25 }, 0.45, 0.18, 0.25, '#486f34');
    }
    if (moisture < 0.30) {
      return this.make(BiomeType.DESERT_DUNES, moisture, temperature, 0.06,
        { ...NO_TREES, acacia: 0.25, cactus: 0.75 }, 0.08, 0.30, 0.12, '#dfaf64');
    }
    if (moisture < 0.56) {
      const density = smoothstep(0.3, 0.7, clusterNoise) * 0.35;
      return this.make(BiomeType.SAVANNAH, moisture, temperature, gladeNoise > 0.6 ? 0.08 : density,
        { ...NO_TREES, oak: 0.05, acacia: 0.95 }, 0.28, 0.26, 0.15, '#a89848');
    }
    const density = smoothstep(0.15, 0.55, clusterNoise) * 0.88;
    return this.make(BiomeType.TROPICAL_RAINFOREST, moisture, temperature, gladeNoise > 0.8 ? 0.25 : density,
      { ...NO_TREES, oak: 0.35, coastalPalm: 0.65 }, 0.75, 0.14, 0.50, '#1e5422');
  }

  private make(
    type: BiomeType, moisture: number, temperature: number, vegetationDensity: number, treeTypeDistribution: TreeMix,
    shrubDensity: number, rockDensity: number, fallenLogDensity: number, groundColorHex: string
  ): BiomeData {
    return { type, moisture, temperature, vegetationDensity, treeTypeDistribution, shrubDensity, rockDensity, fallenLogDensity, groundColorHex };
  }
}
