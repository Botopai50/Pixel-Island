/** Quais minérios aparecem em cada bioma (os 15 do Pixel_Tree entram em pelo menos um). */
export type OreName = 'iron' | 'copper' | 'quartz' | 'gold' | 'diamond' | 'mithril' | 'orichalcum' | 'lead' | 'coal' | 'tin' | 'silver' | 'amethyst' | 'ruby' | 'emerald' | 'sapphire';
export type RockBiomeName = 'hyrule' | 'satori' | 'akkala' | 'hebra' | 'hebra_snowy' | 'faron' | 'korok' | 'swamp' | 'gerudo' | 'savanna' | 'withered' | 'tundra';

export const ORE_BY_BIOME: Record<RockBiomeName, OreName[]> = {
  hyrule: ['iron', 'coal', 'tin', 'lead'],
  satori: ['quartz', 'amethyst', 'silver'],
  akkala: ['copper', 'gold', 'orichalcum'],
  hebra: ['quartz', 'silver', 'iron'],
  hebra_snowy: ['sapphire', 'diamond', 'quartz', 'silver'],
  faron: ['emerald', 'iron', 'tin'],
  korok: ['mithril', 'emerald', 'amethyst', 'iron'],
  swamp: ['iron', 'lead', 'coal'],
  gerudo: ['copper', 'gold', 'ruby'],
  savanna: ['copper', 'gold', 'tin'],
  withered: ['coal', 'iron', 'ruby', 'lead'],
  tundra: ['quartz', 'silver', 'sapphire', 'tin'],
};

export const ORE_LABEL: Record<OreName, string> = {
  iron: 'ferro', copper: 'cobre', quartz: 'quartzo', gold: 'ouro', diamond: 'diamante', mithril: 'mithril', orichalcum: 'oricalco',
  lead: 'chumbo', coal: 'carvão', tin: 'estanho', silver: 'prata', amethyst: 'ametista', ruby: 'rubi', emerald: 'esmeralda', sapphire: 'safira',
};

/** Peso de cada minério na escolha (quanto maior, mais comum): os metais comuns aparecem muito mais que as gemas e os raros. */
export const ORE_WEIGHT: Record<OreName, number> = {
  iron: 10, coal: 10, tin: 9, lead: 9, copper: 10, quartz: 8,
  silver: 4, gold: 3, amethyst: 3,
  emerald: 1.6, ruby: 1.6, sapphire: 1.6,
  diamond: 0.5, mithril: 0.5, orichalcum: 0.5,
};
export const ORE_RARITY: Record<OreName, string> = {
  iron: 'comum', coal: 'comum', tin: 'comum', lead: 'comum', copper: 'comum', quartz: 'comum',
  silver: 'incomum', gold: 'incomum', amethyst: 'incomum',
  emerald: 'rara', ruby: 'rara', sapphire: 'rara',
  diamond: 'muito rara', mithril: 'muito rara', orichalcum: 'muito rara',
};

/** O minério de uma pedra, escolhido pela posição e pelo peso (sempre o mesmo no mesmo lugar). */
export function oreAt(biome: RockBiomeName, x: number, z: number): OreName {
  const list = ORE_BY_BIOME[biome];
  const h = Math.sin(x * 4.1414 + z * 9.7373) * 43758.5453;
  let r = (h - Math.floor(h)) * list.reduce((s, o) => s + ORE_WEIGHT[o], 0);
  for (const o of list) { r -= ORE_WEIGHT[o]; if (r <= 0) return o; }
  return list[list.length - 1];
}
