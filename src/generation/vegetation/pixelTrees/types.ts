// @ts-nocheck
export type TreeSpecies = 
  | 'hyrule_oak' 
  | 'satori_sakura' 
  | 'akkala_birch' 
  | 'hebra_pine'
  | 'hebra_pine_snowy'
  | 'faron_palm'
  | 'korok_ancient'
  | 'gerudo_cactus'
  | 'swamp_mangrove'
  | 'dry_withered'
  | 'savanna_acacia'
  | 'hyrule_oak_sapling'
  | 'satori_sakura_sapling'
  | 'akkala_birch_sapling'
  | 'hebra_pine_sapling'
  | 'hebra_pine_snowy_sapling'
  | 'faron_palm_sapling'
  | 'korok_ancient_sapling'
  | 'gerudo_cactus_sapling'
  | 'swamp_mangrove_sapling'
  | 'dry_withered_sapling'
  | 'savanna_acacia_sapling'
  | 'hyrule_shrub'
  | 'berry_shrub'
  | 'flowering_shrub'
  | 'desert_shrub'
  | 'satori_shrub'
  | 'akkala_shrub'
  | 'hebra_shrub'
  | 'hebra_shrub_snowy'
  | 'faron_shrub'
  | 'korok_shrub'
  | 'swamp_shrub'
  | 'savanna_shrub'
  | 'withered_shrub'
  | 'fallen_log'
  | 'hollow_log'
  | 'rooted_log'
  | 'tree_stump'
  | 'maple_red'
  | 'maple_orange'
  | 'maple_yellow'
  | 'arctic_willow'
  | 'fern_plant'
  | 'wildflower_patch'
  | 'reed_clump'
  | 'hyrule_rock' | 'satori_rock' | 'akkala_rock' | 'hebra_rock'
  | 'hebra_snowy_rock' | 'faron_rock' | 'korok_rock' | 'swamp_rock'
  | 'gerudo_rock' | 'savanna_rock' | 'withered_rock' | 'tundra_rock'
  | `${RockBiome}_ore` | `${RockBiome}_gravel` | `${RockBiome}_${GroundPropKind}`;

export type GroundPropKind = 'flowers' | 'crystals' | 'leaves';
export interface GroundPropConfig {
  kind: GroundPropKind;
  biome: RockBiome;
  count: number;
  size: number;
  spread: number;
  color: string;
  flowerShape: 'daisy' | 'poppy' | 'bell' | 'star';
  crystal: OreKind;
  density: number;
}

export type RockBiome = 'hyrule' | 'satori' | 'akkala' | 'hebra' | 'hebra_snowy'
  | 'faron' | 'korok' | 'swamp' | 'gerudo' | 'savanna' | 'withered' | 'tundra';
export type RockShape = 'boulder' | 'slab' | 'spire' | 'cluster';
export type OreKind = 'iron' | 'copper' | 'quartz' | 'gold' | 'diamond' | 'mithril'
  | 'orichalcum' | 'lead' | 'coal' | 'tin' | 'silver' | 'amethyst' | 'ruby' | 'emerald' | 'sapphire';
export interface RockConfig {
  biome: RockBiome;
  shape: RockShape;
  width: number;
  height: number;
  depth: number;
  irregularity: number;
  detail: number;
  count: number;
  spread: number;
  color: string;
  mossColor: string;
  moss: number;
  snow: number;
  cracks: number;
  gravel?: boolean;
  gravelCount?: number;
  gravelSize?: number;
  gravelSpread?: number;
  mushrooms?: boolean;
  mushroomCount?: number;
  mushroomSize?: number;
  ore?: OreKind;
  oreCount?: number;
  oreSize?: number;
}

export type TimeOfDay = 'day' | 'sunset' | 'night' | 'misty';

export type CrownShape = 'dome' | 'sphere' | 'umbrella' | 'flat_top' | 'conical' | 'multi_cloud' | 'candelabra' | 'swamp_vault' | 'gnarled';

export interface TreeConfig {
  id: string;
  name: string;
  species: TreeSpecies;
  growthStage?: 'adult' | 'sapling' | 'shrub' | 'log' | 'plant' | 'rock' | 'prop';
  rock?: RockConfig;
  prop?: GroundPropConfig;
  seed: number;
  
  // Space Colonization Algorithm (SCA)
  useSpaceColonization: boolean; // default: true
  scaAttractorCount: number;    // 150 to 1200 points
  scaAttractionRadius: number;  // 1.5 to 6.0m
  scaKillDistance: number;      // 0.3 to 1.5m
  scaStepSize: number;          // 0.25 to 0.7m
  scaCrownShape: CrownShape;    // crown envelope volume
  showAttractors: boolean;      // visualize attraction points

  // Trunk & Branches
  trunkHeight: number;       // 5 to 16
  trunkRadiusBase: number;   // 0.4 to 1.8
  trunkRadiusTop: number;    // 0.15 to 0.8
  trunkCurvature: number;    // 0 to 1
  /** Conifers only: how far the whole tree bends to one side toward the top
   *  (0 = upright, 1 = a strong wind-bent lean). Set per seed by the generator. */
  coniferLean?: number;
  /** Conifers only: compass direction of that lean, radians. */
  coniferLeanAngle?: number;
  trunkTwist: number;        // 0 to 1
  rootSpread: number;        // 0.5 to 2.2
  branchCount: number;       // 3 to 14
  branchLength: number;      // 1.5 to 6.0
  branchAngle: number;       // 0.3 to 1.2
  branchStartHeight?: number;// 0.25 to 0.75 (normalized height where branches begin)
  canopySpread?: number;     // 0.5 to 2.2 (horizontal foliage spread multiplier)
  subBranchDensity?: number; // 0 to 1.0 (frequency of secondary branchlets)
  
  // Foliage & Leaf Card System
  foliageType: 'cloud' | 'layered' | 'pine_cone' | 'palm_frond' | 'cactus_bloom' | 'swamp_weeping' | 'none';
  clusterCount: number;      // 6 to 35 (legacy fallback)
  clusterRadius: number;     // 0.8 to 2.8 (legacy fallback)
  clusterDetail: number;     // 1 to 3 (subdivisions)
  foliageColorTop: string;   // Hex color (sunlit leaves)
  foliageColorBottom: string;// Hex color (shadow leaves)
  foliageRoughness: number;  // 0.1 to 0.9
  celSteps: number;          // 2 to 4
  rimLightIntensity: number; // 0.2 to 1.5

  // Advanced Procedural Foliage (Patches, Clusters & Cards)
  foliageDensity?: number;            // 0.2 to 1.0 (default: 0.75)
  patchRadius?: number;               // 0.8 to 2.5 (default: 1.35)
  patchRadiusVariance?: number;       // 0.1 to 0.6 (default: 0.35)
  patchSpacing?: number;              // 0.4 to 1.8 (default: 0.85)
  patchDensity?: number;              // 0.3 to 1.0 (default: 0.8)
  terminalBranchBias?: number;        // 0.4 to 1.0 (default: 0.85)
  crownWidth?: number;                // 0.6 to 2.2 (default: 1.0)
  crownHeight?: number;               // 0.6 to 2.0 (default: 1.0)
  noiseScale?: number;                // 0.15 to 0.8 (default: 0.35)
  noiseStrength?: number;             // 0.0 to 1.0 (default: 0.65)
  noiseThreshold?: number;            // 0.1 to 0.7 (default: 0.38)
  clustersPerPatch?: number;          // 2 to 8 (default: 5)
  cardsPerClusterMin?: number;        // 2 to 3 (default: 2)
  cardsPerClusterMax?: number;        // 3 to 5 (default: 4)
  leafCardSize?: number;              // 0.5 to 2.0 (default: 1.05)
  leafCardSizeVariance?: number;      // 0.1 to 0.5 (default: 0.3)
  alphaTest?: number;                 // 0.1 to 0.8 (default: 0.4)
  interiorDarkening?: number;         // 0.0 to 0.6 (default: 0.28)
  flutterStrength?: number;           // 0.01 to 0.15 (default: 0.04)
  
  // Procedural Pixel Art Textures (all optional: presets keep working untouched,
  // per-species defaults are resolved in services/pixelArtTextureSystem.ts)
  pixelTextureEnabled?: boolean;       // default: true
  textureSeed?: number;                // default: falls back to `seed`
  pixelSize?: number;                  // 1 (finest) to 5 (chunkiest texels)
  paletteSteps?: number;               // 4 to 9 colors per ramp
  detailDensity?: number;              // 0 to 1 (seam / micro-detail strength)
  textureContrast?: number;            // 0 to 1
  shadowStrength?: number;             // 0 to 1
  highlightAmount?: number;            // 0 to 1
  leafClusterSize?: number;            // 2 to 12 texels per leaf clump
  leafClusterIrregularity?: number;    // 0 to 1
  canopyGapAmount?: number;            // 0 to 1 (empty areas in the crown)
  barkVariation?: number;              // 0 to 1
  // Visual language of the bark. Defaults from barkStyle.
  barkPattern?: 'lobed' | 'streaked' | 'furrowed' | 'flat' | 'plated' | 'papery' | 'grain';
  textureAccentAmount?: number;        // 0 to 1 (share of clumps on the accent ramp)
  textureLightAzimuth?: number;        // 0 to 360 degrees
  textureLightElevation?: number;      // 0 to 90 degrees
  barkTexelScale?: number;             // override for the bark UV v scale

  // Bark
  barkColor: string;         // Hex color
  barkRoughness: number;     // 0.4 to 1.0
  barkStyle: 'oak' | 'birch' | 'pine' | 'ancient' | 'cactus' | 'swamp' | 'deadwood';
  mossAmount: number;        // 0 to 1
  /** Snow lying on the tree and its ground, 0 (none) .. 1 (heavy). Drawn by
   *  the conifers, adult and sapling: needle tops, upward-facing wood, the
   *  ground mound; the falling particles turn into snowflakes. */
  snowCover?: number;
  
  // Swamp Tree / Mangrove Features (Stilt Roots, Vines, Water)
  aerialRootCount?: number;      // 6 to 18 (number of massive arching stilt roots)
  aerialRootSpread?: number;     // 1.5 to 4.5 (horizontal ground spread)
  aerialRootHeight?: number;     // 1.8 to 4.5 (height on trunk where roots branch)
  showHangingMoss?: boolean;     // Weeping Spanish moss tresses
  hangingMossCount?: number;     // 15 to 60 strands
  showSwampWater?: boolean;      // Murky swamp pool & water lily pads
  showShelfMushrooms?: boolean;  // Purple bioluminescent shelf mushrooms on roots/trunk
  shelfMushroomCount?: number;   // 6 to 28 bracket fungi
  
  // BotW Accents
  showApples: boolean;
  appleCount: number;
  /** Bushes: what showApples/appleCount put on the bush - clusters of small
   *  berries, or flowers - and their colour. Trees always get apples. */
  bushAccent?: 'berries' | 'flowers';
  accentColor?: string;
  showMushrooms: boolean;
  mushroomCount: number;
  showFallingLeaves: boolean;
  fallingLeafCount: number;
  
  // Wind & Animation
  windStrength: number;      // 0 to 1
  windSpeed: number;         // 0.2 to 2.5
}

export interface EnvironmentConfig {
  timeOfDay: TimeOfDay;
  showGrass: boolean;
  showStones: boolean;
  autoRotate: boolean;
  soundEnabled: boolean;
}
