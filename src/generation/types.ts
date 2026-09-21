import * as THREE from 'three';

export enum BiomeType {
  OCEAN = 'Oceano Profundo',
  SHALLOWS = 'Águas Rasas Costeiras',
  CORAL_LAGOON = 'Lagoa e Recifes de Coral',
  BEACH = 'Praia Arenosa',
  MANGROVE_SWAMP = 'Manguezal Estuarino',
  COASTAL_MEADOW = 'Campos Costeiros e Prados',
  TEMPERATE_FOREST = 'Floresta Mista Temperada',
  AUTUMN_FOREST = 'Bosque Outonal Dourado',
  SAVANNAH = 'Savana Tropical',
  DESERT_DUNES = 'Deserto & Dunas Áridas',
  CANYON_DESERT = 'Cânions Estratificados & Ravinas',
  TROPICAL_RAINFOREST = 'Selva Tropical Úmida',
  BOREAL_TAIGA = 'Taiga Boreal de Coníferas',
  ALPINE_TUNDRA = 'Tundra Alpina de Altitude',
  FROZEN_TUNDRA = 'Planície Ártica de Gelo',
  ROCKY_PEAKS = 'Encostas Rochosas e Penhascos',
  SNOW_SUMMIT = 'Cumes Nevados e Glaciais',
  VOLCANIC_FIELD = 'Encostas Vulcânicas & Basalto',
  VOLCANIC_CALDERA = 'Caldeira Vulcânica & Lago de Lava',
  GEOTHERMAL_VALLEY = 'Fontes Termais & Gêiseres'
}

export interface BiomeData {
  type: BiomeType;
  moisture: number;
  temperature: number;
  vegetationDensity: number;
  treeTypeDistribution: {
    oak: number;
    pine: number;
    birch: number;
    coastalPalm: number;
    acacia: number;
    autumnMaple: number;
    cactus: number;
    mangrove?: number;
    deadBurntTree?: number;
    snowPine?: number;
    arcticWillow?: number;
  };
  shrubDensity: number;
  rockDensity: number;
  fallenLogDensity: number;
  groundColorHex: string;
}

export interface TerrainPoint {
  height: number;
  normal: THREE.Vector3;
  slope: number;
  isWater: boolean;
  waterSurfaceY: number;
  biome: BiomeData;
  volcanoInfluence?: number;
  canyonInfluence?: number;
  geothermalInfluence?: number;
  iceInfluence?: number;
  isLava?: boolean;
}

export interface WorldSpawnPoint {
  x: number;
  z: number;
  elevation: number;
}
