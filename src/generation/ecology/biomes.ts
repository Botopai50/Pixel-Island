import { SimplexNoise } from '../math/simplexNoise.ts';
import { clamp, smoothstep } from '../math/mathUtils.ts';
import { CONFIG } from '../../config.ts';
import { BiomeType, type BiomeData } from '../types.ts';

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

  public getClimate(x: number, z: number, elevation: number, moistureBonus: number = 0.0): { temperature: number; moisture: number } {
    const latitudeGrad = Math.sin(z * 0.0006) * 0.28;
    const climateNoise = this.noise.fbm2D(x * 0.0012, z * 0.0012, 3) * 0.28;
    const lapseRate = (elevation / CONFIG.MAX_HEIGHT) * 0.68;
    const temperature = clamp(0.55 + latitudeGrad + climateNoise - lapseRate, 0.0, 1.0);

    const moistureNoise = this.noise.fbm2D(x * 0.0015 + 120.0, z * 0.0015 + 120.0, 3) * 0.5 + 0.5;
    const moisture = clamp(moistureNoise * 0.75 + moistureBonus * 0.45, 0.0, 1.0);

    return { temperature, moisture };
  }

  public evaluateBiome(
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
    // 0. Ambientes Geológicos Terrestres Especiais (possuem prioridade absoluta)
    if (specialEnv?.volcanoInfluence && specialEnv.volcanoInfluence > 0.18) {
      if (specialEnv.isCaldera) {
        return {
          type: BiomeType.VOLCANIC_CALDERA,
          moisture: 0.1,
          temperature: 0.98,
          vegetationDensity: 0.0,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.0,
          rockDensity: 0.85,
          fallenLogDensity: 0.0,
          groundColorHex: '#ff4500'
        };
      }
    }

    if (specialEnv?.geothermalInfluence && specialEnv.geothermalInfluence > 0.35) {
      return {
        type: BiomeType.GEOTHERMAL_VALLEY,
        moisture: 0.85,
        temperature: 0.78,
        vegetationDensity: 0.0,
        treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
        shrubDensity: 0.05,
        rockDensity: 0.65,
        fallenLogDensity: 0.0,
        groundColorHex: '#d8cbb5'
      };
    }

    // 1. Condições de Água Oceânica Global ou Águas Interiores (Lagos e Rios)
    if (elevation <= CONFIG.SEA_LEVEL || isWater) {
      if (elevation < -8.0) {
        return {
          type: BiomeType.OCEAN,
          moisture: 1.0,
          temperature: 0.5,
          vegetationDensity: 0.0,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.0,
          rockDensity: 0.02,
          fallenLogDensity: 0.0,
          groundColorHex: '#143857'
        };
      } else {
        return {
          type: BiomeType.SHALLOWS,
          moisture: 1.0,
          temperature: 0.6,
          vegetationDensity: 0.0,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.0,
          rockDensity: 0.06,
          fallenLogDensity: 0.0,
          groundColorHex: '#25788d'
        };
      }
    }

    // Macro-clima contínuo de grande escala (Gradientes de temperatura e umidade continentais)
    const latitudeGrad = Math.sin(z * 0.0006) * 0.28;
    const climateNoise = this.noise.fbm2D(x * 0.0012, z * 0.0012, 3) * 0.28;
    const lapseRate = (elevation / CONFIG.MAX_HEIGHT) * 0.68; // Montanhas resfriam com a altitude
    const temperature = clamp(0.55 + latitudeGrad + climateNoise - lapseRate, 0.0, 1.0);

    const moistureNoise = this.noise.fbm2D(x * 0.0015 + 120.0, z * 0.0015 + 120.0, 3) * 0.5 + 0.5;
    const moisture = clamp(moistureNoise * 0.75 + moistureBonus * 0.45, 0.0, 1.0);

    const isSteepSlope = slope > CONFIG.VEGETATION.MAX_SLOPE_FOR_TREES;

    // 1. Zonas Vulcânicas Especiais (Caldeira & Campos de Basalto)
    if (specialEnv?.volcanoInfluence && specialEnv.volcanoInfluence > 0.18) {
      if (specialEnv.isCaldera) {
        return {
          type: BiomeType.VOLCANIC_CALDERA,
          moisture: 0.1,
          temperature: 0.98,
          vegetationDensity: 0.0,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.0,
          rockDensity: 0.85,
          fallenLogDensity: 0.0,
          groundColorHex: '#ff4500'
        };
      } else {
        return {
          type: BiomeType.VOLCANIC_FIELD,
          moisture: 0.15,
          temperature: 0.82,
          vegetationDensity: isSteepSlope ? 0.0 : 0.06,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0, deadBurntTree: 1.0 },
          shrubDensity: 0.03,
          rockDensity: 0.78,
          fallenLogDensity: 0.25,
          groundColorHex: '#25262a'
        };
      }
    }

    // 2. Vales Geotérmicos & Fontes Termais
    if (specialEnv?.geothermalInfluence && specialEnv.geothermalInfluence > 0.35) {
      return {
        type: BiomeType.GEOTHERMAL_VALLEY,
        moisture: 0.85,
        temperature: 0.78,
        vegetationDensity: 0.0,
        treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
        shrubDensity: 0.05,
        rockDensity: 0.65,
        fallenLogDensity: 0.0,
        groundColorHex: '#d8cbb5'
      };
    }

    // 3. Cânions Estratificados & Ravinas (Estritamente no interior da ilha, acima da cota de praia)
    if (specialEnv?.canyonInfluence && specialEnv.canyonInfluence > 0.45 && elevation > CONFIG.BEACH_HEIGHT) {
      return {
        type: BiomeType.CANYON_DESERT,
        moisture: 0.22,
        temperature: 0.75,
        vegetationDensity: isSteepSlope ? 0.0 : 0.12,
        treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0.35, autumnMaple: 0, cactus: 0.65 },
        shrubDensity: 0.15,
        rockDensity: 0.55,
        fallenLogDensity: 0.08,
        groundColorHex: '#b85c38'
      };
    }

    // 4. Planície Ártica de Gelo ao Nível do Mar (Sem ser picos nevados)
    if ((specialEnv?.iceInfluence && specialEnv.iceInfluence > 0.15) || (z < -520.0 && elevation < 35.0) || (temperature < 0.28 && elevation < 25.0)) {
      return {
        type: BiomeType.FROZEN_TUNDRA,
        moisture: 0.75,
        temperature: 0.12,
        vegetationDensity: isSteepSlope ? 0.0 : 0.04,
        treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0, snowPine: 0.65, arcticWillow: 0.35 },
        shrubDensity: 0.20,
        rockDensity: 0.55,
        fallenLogDensity: 0.05,
        groundColorHex: '#d2e7f5'
      };
    }

    const clusterNoise = this.noise.fbm2D(x * 0.012, z * 0.012, 3) * 0.5 + 0.5;
    const gladeNoise = this.noise.noise2D(x * 0.035, z * 0.035);

    // 5. Cumes Nevados Glaciais (Altitude Extrema de Montanha)
    if (elevation > 68.0) {
      return {
        type: BiomeType.SNOW_SUMMIT,
        moisture: 0.8,
        temperature: 0.05,
        vegetationDensity: 0.0,
        treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
        shrubDensity: 0.02,
        rockDensity: 0.55,
        fallenLogDensity: 0.0,
        groundColorHex: '#f0f4f8'
      };
    }

    // 6. Paredões Rochosos e Penhascos Íngremes
    if (slope > 0.56) {
      return {
        type: BiomeType.ROCKY_PEAKS,
        moisture: moisture * 0.4,
        temperature,
        vegetationDensity: 0.0,
        treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
        shrubDensity: 0.06,
        rockDensity: 0.75,
        fallenLogDensity: 0.02,
        groundColorHex: '#6c6f72'
      };
    }

    // 7. Andares de Altitude (45m - 68m)
    if (elevation > 45.0) {
      if (temperature < 0.32) {
        // Tundra Alpina fria (líquens, pedregulhos, sem árvores altas)
        return {
          type: BiomeType.ALPINE_TUNDRA,
          moisture,
          temperature,
          vegetationDensity: 0.04,
          treeTypeDistribution: { oak: 0, pine: 0.8, birch: 0.2, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.22,
          rockDensity: 0.58,
          fallenLogDensity: 0.05,
          groundColorHex: '#586252'
        };
      } else {
        // Taiga Boreal Conífera de Montanha
        const density = smoothstep(0.25, 0.65, clusterNoise) * 0.68;
        return {
          type: BiomeType.BOREAL_TAIGA,
          moisture,
          temperature,
          vegetationDensity: gladeNoise > 0.65 ? 0.12 : density,
          treeTypeDistribution: { oak: 0.05, pine: 0.85, birch: 0.1, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.32,
          rockDensity: 0.32,
          fallenLogDensity: 0.28,
          groundColorHex: '#3b4e34'
        };
      }
    }

    // 8. Faixa Costeira Imediata (Praia Arenosa Tropical Clássica ou Costa Polar Glacial)
    if (elevation <= CONFIG.BEACH_HEIGHT && slope < 0.55) {
      // Se a costa estiver em zona de frio polar ou sob influência de gelo ártico, é tundra gelada, NUNCA praia tropical com coqueiros!
      if ((specialEnv?.iceInfluence && specialEnv.iceInfluence > 0.08) || z <= -480.0 || temperature < 0.32) {
        return {
          type: BiomeType.FROZEN_TUNDRA,
          moisture: 0.65,
          temperature: 0.12,
          vegetationDensity: 0.02,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0, snowPine: 0.65, arcticWillow: 0.35 },
          shrubDensity: 0.15,
          rockDensity: 0.60,
          fallenLogDensity: 0.05,
          groundColorHex: '#b8cddb'
        };
      }

      const isPalmCluster = clusterNoise > 0.60 && gladeNoise > 0.05;
      const beachPalmDensity = isPalmCluster ? 0.055 : 0.008;
      return {
        type: BiomeType.BEACH,
        moisture: 0.35,
        temperature,
        vegetationDensity: beachPalmDensity,
        treeTypeDistribution: {
          oak: 0.0,
          pine: 0.0,
          birch: 0.0,
          coastalPalm: 1.0,
          acacia: 0.0,
          autumnMaple: 0.0,
          cactus: 0.0,
          mangrove: 0.0,
          deadBurntTree: 0.0
        },
        shrubDensity: 0.0,
        rockDensity: 0.05,
        fallenLogDensity: 0.03,
        groundColorHex: '#e1d09e'
      };
    }

    // 5. Matriz Bioclimática de Whittaker para Planícies e Colinas (3.8m - 45m)
    if (temperature > 0.60) {
      // Bacias fluviais e várzeas tropicais úmidas de baixa altitude: Manguezal Estuarino
      if (elevation < 18.0 && (moistureBonus > 0.08 || moisture > 0.52)) {
        return {
          type: BiomeType.MANGROVE_SWAMP,
          moisture,
          temperature,
          vegetationDensity: 0.45,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0.15, acacia: 0, autumnMaple: 0, cactus: 0, mangrove: 0.85 },
          shrubDensity: 0.35,
          rockDensity: 0.08,
          fallenLogDensity: 0.40,
          groundColorHex: '#2b3820'
        };
      }

      // Clima Quente / Tropical
      if (moisture < 0.36) {
        // Deserto e Dunas Áridas de Interior
        return {
          type: BiomeType.DESERT_DUNES,
          moisture,
          temperature,
          vegetationDensity: 0.06,
          treeTypeDistribution: { oak: 0, pine: 0, birch: 0, coastalPalm: 0.0, acacia: 0.25, autumnMaple: 0, cactus: 0.75 },
          shrubDensity: 0.08,
          rockDensity: 0.30,
          fallenLogDensity: 0.12,
          groundColorHex: '#dfaf64'
        };
      } else if (moisture < 0.66) {
        // Savana Tropical (Acácias de copa ampla, grama dourada, rochas - ZERO cactos em campos verdes)
        const density = smoothstep(0.3, 0.7, clusterNoise) * 0.35;
        return {
          type: BiomeType.SAVANNAH,
          moisture,
          temperature,
          vegetationDensity: gladeNoise > 0.6 ? 0.08 : density,
          treeTypeDistribution: { oak: 0.05, pine: 0, birch: 0, coastalPalm: 0.0, acacia: 0.95, autumnMaple: 0, cactus: 0.0 },
          shrubDensity: 0.28,
          rockDensity: 0.26,
          fallenLogDensity: 0.15,
          groundColorHex: '#a89848'
        };
      } else {
        // Selva / Floresta Tropical Úmida (Palmeiras densas, vegetação exuberante)
        const density = smoothstep(0.15, 0.55, clusterNoise) * 0.88;
        return {
          type: BiomeType.TROPICAL_RAINFOREST,
          moisture,
          temperature,
          vegetationDensity: gladeNoise > 0.8 ? 0.25 : density,
          treeTypeDistribution: { oak: 0.30, pine: 0, birch: 0, coastalPalm: 0.65, acacia: 0, autumnMaple: 0.05, cactus: 0 },
          shrubDensity: 0.75,
          rockDensity: 0.14,
          fallenLogDensity: 0.50,
          groundColorHex: '#1e5422'
        };
      }
    } else if (temperature < 0.38) {
      // Clima Frio: Taiga Boreal
      const density = smoothstep(0.2, 0.6, clusterNoise) * 0.72;
      return {
        type: BiomeType.BOREAL_TAIGA,
        moisture,
        temperature,
        vegetationDensity: gladeNoise > 0.7 ? 0.15 : density,
        treeTypeDistribution: { oak: 0.05, pine: 0.85, birch: 0.1, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
        shrubDensity: 0.35,
        rockDensity: 0.25,
        fallenLogDensity: 0.32,
        groundColorHex: '#2a4428'
      };
    } else {
      // Clima Temperado
      if (moisture > 0.68) {
        // Bosque Outonal Dourado (Bordos e bétulas com tons quentes)
        const density = smoothstep(0.2, 0.6, clusterNoise) * 0.76;
        return {
          type: BiomeType.AUTUMN_FOREST,
          moisture,
          temperature,
          vegetationDensity: gladeNoise > 0.75 ? 0.18 : density,
          treeTypeDistribution: { oak: 0.15, pine: 0.10, birch: 0.20, coastalPalm: 0, acacia: 0, autumnMaple: 0.55, cactus: 0 },
          shrubDensity: 0.50,
          rockDensity: 0.15,
          fallenLogDensity: 0.38,
          groundColorHex: '#6d5330'
        };
      } else if (moisture > 0.42) {
        // Floresta Mista Temperada
        const normalDensity = smoothstep(0.25, 0.65, clusterNoise) * 0.72;
        return {
          type: BiomeType.TEMPERATE_FOREST,
          moisture,
          temperature,
          vegetationDensity: gladeNoise > 0.7 ? 0.18 : normalDensity,
          treeTypeDistribution: { oak: 0.55, pine: 0.2, birch: 0.25, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.45,
          rockDensity: 0.18,
          fallenLogDensity: 0.25,
          groundColorHex: '#486f34'
        };
      } else {
        // Campos e Prados Costeiros Abertos
        return {
          type: BiomeType.COASTAL_MEADOW,
          moisture,
          temperature,
          vegetationDensity: 0.20,
          treeTypeDistribution: { oak: 0.65, pine: 0.1, birch: 0.25, coastalPalm: 0, acacia: 0, autumnMaple: 0, cactus: 0 },
          shrubDensity: 0.32,
          rockDensity: 0.12,
          fallenLogDensity: 0.08,
          groundColorHex: '#6d9441'
        };
      }
    }
  }
}
