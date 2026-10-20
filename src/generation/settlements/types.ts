import type { RockBiome } from '../vegetation/pixelTrees/types';
import type { StructureKind } from '../structures/types';

/** The four settlement scales the generator knows. */
export type SettlementKind = 'hamlet' | 'village' | 'town' | 'fortifiedTown';

/** What the user (or the game) configures; stored in StructureConfig.settlement. */
export interface SettlementSettings {
  /** overall size multiplier: 1 is the nominal radius of the chosen kind */
  size: number;
  /** 0..1: how tightly the lots are packed and how many are built */
  density: number;
  /** 0..1: how many trades, stalls and props appear compared with plain houses */
  frequency: number;
  /** plant trees in the open ground */
  trees: boolean;
  /** shape of the stand-in terrain used when the game provides none */
  terrainStyle: 'flat' | 'hills' | 'river' | 'lake';
}

export const DEFAULT_SETTLEMENT_SETTINGS: SettlementSettings = {
  size: 1, density: 0.65, frequency: 0.5, trees: true, terrainStyle: 'river',
};

export interface SettlementOptions extends SettlementSettings {
  kind: SettlementKind;
  seed: number;
  biome: RockBiome;
  /** how far (in radii) from the origin the site search may roam; the game keeps it small so a settlement stays inside its cell */
  siteSpan?: number;
}

/**
 * The only thing the planner needs to know about the world. Plug the game's own
 * terrain generator in by implementing this (see terrain.ts: registerTerrainProvider).
 */
export interface TerrainSampler {
  /** ground height in metres */
  height(x: number, z: number): number;
  /** true where the ground is under water (rivers, lakes, sea) */
  isWater(x: number, z: number): boolean;
  /** water surface height, for drawing and for bridges */
  waterLevel: number;
}

export type StreetClass = 'main' | 'secondary' | 'lane';

export interface Street {
  id: string;
  cls: StreetClass;
  width: number;
  /** for lanes: the building this lane serves */
  to?: string;
  /** centre line, a sample every ~2 m */
  points: [number, number][];
}

/** A rectangle on the ground: centre, half sizes, yaw (the building faces local -z). */
export interface Footprint { x: number; z: number; hw: number; hd: number; yaw: number }

export interface PlannedBuilding extends Footprint {
  id: string;
  kind: StructureKind;
  /** which cached variant of this kind to clone */
  variant: number;
  /** footprint of the wood and stone, in metres */
  width: number;
  depth: number;
  role: 'landmark' | 'commerce' | 'home' | 'rural' | 'defence' | 'infrastructure';
  /** where the model is placed (its origin); the footprint x/z is the centre of what it really covers */
  px: number;
  pz: number;
  /** in front of the door, where a street or lane must reach */
  door: [number, number];
  /** ground height the building stands at */
  baseY: number;
}

export interface PlannedProp extends Footprint {
  id: string;
  kind: StructureKind;
  variant: number;
  baseY: number;
}

export interface PlannedTree { x: number; z: number; baseY: number; species: 'hyrule_oak' | 'akkala_birch' | 'hebra_pine'; scale: number; variant: number }

export interface WallPiece extends Footprint {
  id: string;
  kind: 'wall' | 'gate' | 'stoneTower';
  /** length of a wall segment, metres (the structure's width) */
  length: number;
  baseY: number;
  /** a flight of steps up to the walkway along this face of the wall (+1 or -1 along local z); the wall is not cut */
  stairSide?: 1 | -1;
}

export interface BridgePiece extends Footprint { id: string; length: number; baseY: number }

/** Ground that is levelled flat under a building, blended into the terrain around it. */
export interface Pad extends Footprint { y: number }

export interface SettlementPlan {
  options: SettlementOptions;
  /** chosen site */
  centre: [number, number];
  radius: number;
  /** closed outline of the built-up area */
  boundary: [number, number][];
  plaza: { x: number; z: number; radius: number };
  streets: Street[];
  buildings: PlannedBuilding[];
  props: PlannedProp[];
  trees: PlannedTree[];
  walls: WallPiece[];
  bridges: BridgePiece[];
  pads: Pad[];
  stats: Record<string, number>;
}

export interface ValidationReport {
  overlaps: [string, string][];
  inWater: string[];
  noAccess: string[];
  steep: string[];
  ok: boolean;
}
