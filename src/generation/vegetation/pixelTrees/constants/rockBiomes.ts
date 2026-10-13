// @ts-nocheck
import { RockBiome, RockConfig, TreeConfig, TreeSpecies } from '../types';

export interface RockBiomePreset {
  name: string;
  description: string;
  ground: string;
  grass: string;
  config: RockConfig;
}

const base: RockConfig = {
  biome: 'hyrule', shape: 'boulder', width: 2.8, height: 2.1, depth: 2.4,
  irregularity: 0.35, detail: 1, count: 1, spread: 2.8,
  color: '#8a8990', mossColor: '#7ba33a', moss: 0.15, snow: 0, cracks: 0.3,
  mushrooms: false, mushroomCount: 6, mushroomSize: 0.38,
  gravel: false, gravelCount: 6, gravelSize: 0.18, gravelSpread: 0.8,
};
function biome(key: RockBiome, name: string, description: string, ground: string, grass: string, overrides: Partial<RockConfig>): RockBiomePreset {
  return { name, description, ground, grass, config: { ...base,
    mushrooms: ['swamp', 'faron', 'korok', 'satori'].includes(key),
    mushroomCount: key === 'korok' ? 8 : key === 'satori' ? 3 : 6,
    ...overrides, biome: key } };
}

export const ROCK_BIOMES: Record<RockBiome, RockBiomePreset> = {
  hyrule: biome('hyrule', 'Hyrule', 'Pedra cinzenta das pradarias; blocos arredondados e musgo discreto.', '#588e36', '#7cb342', {}),
  satori: biome('satori', 'Satori', 'Rocha clara da montanha, com líquens suaves e musgo do bosque.', '#4e8555', '#81c784', { color: '#a8a6a0', mossColor: '#7ba33a', moss: 0.52, irregularity: 0.25 }),
  akkala: biome('akkala', 'Akkala', 'Rocha ferruginosa da floresta de outono, com faces ocres e desgastadas.', '#7d5a31', '#c98a3a', { color: '#ad7855', mossColor: '#a09a50', moss: 0.18, shape: 'slab', cracks: 0.5 }),
  hebra: biome('hebra', 'Hebra', 'Granito frio e angular das coníferas, com líquens nas faces superiores.', '#5a4838', '#6e9970', { color: '#697987', mossColor: '#7ba33a', shape: 'spire', height: 3.2, irregularity: 0.48, moss: 0.22 }),
  hebra_snowy: biome('hebra_snowy', 'Hebra Nevada', 'Granito escuro com neve acumulada nas faces voltadas ao céu.', '#e4edf6', '#9aa17a', { color: '#596674', moss: 0.05, snow: 0.8, shape: 'spire', height: 3.1, irregularity: 0.45 }),
  faron: biome('faron', 'Faron', 'Pedra tropical escura, arredondada pela água e coberta de musgo.', '#c2a66e', '#79aa47', { color: '#626f6c', mossColor: '#7ba33a', moss: 0.65, irregularity: 0.18, detail: 2, height: 1.7 }),
  korok: biome('korok', 'Floresta Korok', 'Blocos ancestrais irregulares com musgo espesso e fissuras profundas.', '#476334', '#769844', { color: '#777b68', mossColor: '#7ba33a', moss: 0.82, cracks: 0.65, irregularity: 0.55, shape: 'cluster', count: 3 }),
  swamp: biome('swamp', 'Pântano', 'Rochas baixas e úmidas, em tons escuros, com cobertura verde densa.', '#2e271f', '#6f9a44', { color: '#4e6059', mossColor: '#7ba33a', moss: 0.78, shape: 'slab', height: 1.2, detail: 1 }),
  gerudo: biome('gerudo', 'Gerudo', 'Arenito quente esculpido pelo vento, com fissuras e faces amplas.', '#d4a359', '#bfa466', { color: '#c89662', moss: 0, shape: 'spire', height: 3.4, cracks: 0.7, irregularity: 0.6 }),
  savanna: biome('savanna', 'Savana', 'Blocos de pedra ocre entre gramíneas douradas e líquens secos.', '#c09a58', '#d8bd62', { color: '#ac885c', mossColor: '#aaa15a', moss: 0.12, shape: 'cluster', count: 3, height: 1.8, irregularity: 0.4 }),
  withered: biome('withered', 'Terras Secas', 'Pedra erodida de solo árido, com rachaduras e pouco líquen.', '#6e5c49', '#a89368', { color: '#8c8171', mossColor: '#a39a55', moss: 0.1, cracks: 0.85, irregularity: 0.65 }),
  tundra: biome('tundra', 'Tundra', 'Rochas achatadas pelo gelo, com líquens claros e neve esparsa.', '#7b7d62', '#9aa17a', { color: '#858c8b', mossColor: '#a1aa83', moss: 0.32, snow: 0.2, shape: 'slab', height: 1.1, cracks: 0.45 }),
};

/** Includes adult trees, saplings, shrubs, logs and ground plants. */
export function rockBiomeForSpecies(species: TreeSpecies): RockBiome {
  for (const suffix of ['_flowers', '_crystals', '_leaves']) if (species.endsWith(suffix)) return species.slice(0, -suffix.length) as RockBiome;
  if (species.endsWith('_rock')) return species.slice(0, -5) as RockBiome;
  if (species.endsWith('_ore')) return species.slice(0, -4) as RockBiome;
  if (species.endsWith('_gravel')) return species.slice(0, -7) as RockBiome;
  if (species.startsWith('hebra') && species.includes('snowy')) return 'hebra_snowy';
  if (species.startsWith('hebra')) return 'hebra';
  if (species.startsWith('satori')) return 'satori';
  if (species.startsWith('akkala') || species.startsWith('maple')) return 'akkala';
  if (species.startsWith('faron')) return 'faron';
  if (species.startsWith('korok') || species === 'fern_plant') return 'korok';
  if (species.startsWith('swamp') || species === 'reed_clump') return 'swamp';
  if (species.startsWith('gerudo') || species === 'desert_shrub') return 'gerudo';
  if (species.startsWith('savanna')) return 'savanna';
  if (species.startsWith('dry_') || species === 'withered_shrub') return 'withered';
  if (species === 'arctic_willow') return 'tundra';
  return 'hyrule';
}

export function createRockPresets(template: Omit<TreeConfig, 'id' | 'name' | 'species' | 'seed'>, withOre = false, gravel = false): Record<string, TreeConfig> {
  return Object.fromEntries(Object.entries(ROCK_BIOMES).map(([key, preset], index) => {
    const species = `${key}_${gravel ? 'gravel' : withOre ? 'ore' : 'rock'}` as TreeSpecies;
    return [species, {
      ...template, id: species, species, name: `${gravel ? 'Pedrinhas e cascalho' : withOre ? 'Pedra com minérios' : 'Pedra'} de ${preset.name}`, seed: 6200 + index,
      growthStage: 'rock', rock: { ...preset.config, ...(gravel ? { gravel: true, mushrooms: false } : {}), ...(withOre ? {
        ore: ['satori', 'hebra', 'hebra_snowy', 'tundra'].includes(key) ? 'quartz' as const
          : ['akkala', 'gerudo', 'savanna'].includes(key) ? 'copper' as const : 'iron' as const,
        oreCount: 6, oreSize: 0.3,
      } : {}) }, trunkHeight: preset.config.height,
      useSpaceColonization: false, foliageType: 'none', clusterCount: 0, branchCount: 0,
      foliageColorTop: preset.config.color, mossAmount: preset.config.moss, snowCover: preset.config.snow,
      pixelSize: 2, paletteSteps: 6, showApples: false, showMushrooms: false,
      showFallingLeaves: false, fallingLeafCount: 0, windStrength: 0,
    } satisfies TreeConfig];
  }));
}
