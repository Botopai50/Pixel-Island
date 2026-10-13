// @ts-nocheck
import { GroundPropKind, TreeConfig, TreeSpecies } from '../types';
import { ROCK_BIOMES, createRockPresets } from './rockBiomes';
import { FLOWER_PROFILES } from './wildflowers';

export const PROP_LABELS: Record<GroundPropKind, string> = { flowers: 'Flores silvestres', crystals: 'Cristais', leaves: 'Folhas secas' };
export function createGroundPropPresets(template: Omit<TreeConfig, 'id' | 'name' | 'species' | 'seed'>): Record<string, TreeConfig> {
  const rocks = createRockPresets(template);
  return Object.fromEntries((['flowers', 'crystals', 'leaves'] as const).flatMap(kind => Object.entries(ROCK_BIOMES).map(([biome, base], index) => {
    const species = `${biome}_${kind}` as TreeSpecies;
    const colors = kind === 'flowers'
      ? Object.values(FLOWER_PROFILES).map(p=>p.color)
      : ['#b99042', '#c59273', '#cd7436', '#a68651', '#8c775e', '#ad8651', '#9c763c', '#8c6e47', '#bd8850', '#c5a45a', '#9b774c', '#a49a72'];
    return [species, { ...rocks[`${biome}_rock`], id: species, species, name: `${PROP_LABELS[kind]} de ${base.name}`,
      growthStage: 'prop', seed: 7100 + index, foliageColorTop: kind === 'crystals' ? '#ae83da' : colors[index],
      prop: { kind, biome: biome as keyof typeof ROCK_BIOMES, count: kind === 'flowers' ? 7 : kind === 'crystals' ? 3 : 4,
        size: kind === 'flowers' ? 0.55 : kind === 'crystals' ? 0.8 : 0.65, spread: 1.1, density: 0.55, color: colors[index],
        flowerShape: (['daisy', 'star', 'poppy', 'bell'] as const)[index % 4],
        crystal: (['amethyst', 'quartz', 'ruby', 'sapphire', 'diamond', 'emerald'] as const)[index % 6],
      },
    } satisfies TreeConfig];
  })));
}
