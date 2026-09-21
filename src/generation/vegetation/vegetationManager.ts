import * as THREE from 'three';
import { PRNG } from '../math/prng.ts';
import { TerrainPoint, BiomeType } from '../types.ts';
import { CONFIG } from '../../config.ts';
import { VegetationTextures } from './vegetationTextures.ts';
import { BotanicalGeometryFactory } from './botanicalGeometryFactory.ts';

export interface ITerrainQueryable {
  getPoint(x: number, z: number): TerrainPoint;
  getPointFast?(x: number, z: number): TerrainPoint;
}

export class VegetationGeometries {
  // 1. Carvalho (Mature & Sapling)
  public static oakTrunk: THREE.BufferGeometry;
  public static oakLeaves: THREE.BufferGeometry;
  public static oakSaplingTrunk: THREE.BufferGeometry;
  public static oakSaplingLeaves: THREE.BufferGeometry;

  // 2. Pinheiro Conífero (Mature & Sapling)
  public static pineTrunk: THREE.BufferGeometry;
  public static pineLeaves: THREE.BufferGeometry;
  public static pineSaplingTrunk: THREE.BufferGeometry;
  public static pineSaplingLeaves: THREE.BufferGeometry;

  // 3. Bétula (Mature & Sapling)
  public static birchTrunk: THREE.BufferGeometry;
  public static birchLeaves: THREE.BufferGeometry;
  public static birchSaplingTrunk: THREE.BufferGeometry;
  public static birchSaplingLeaves: THREE.BufferGeometry;

  // 4. Coqueiro de Praia (Mature & Sapling)
  public static palmTrunk: THREE.BufferGeometry;
  public static palmLeaves: THREE.BufferGeometry;
  public static palmSaplingTrunk: THREE.BufferGeometry;
  public static palmSaplingLeaves: THREE.BufferGeometry;

  // 5. Acácia da Savana (Mature & Sapling)
  public static acaciaTrunk: THREE.BufferGeometry;
  public static acaciaLeaves: THREE.BufferGeometry;
  public static acaciaSaplingTrunk: THREE.BufferGeometry;
  public static acaciaSaplingLeaves: THREE.BufferGeometry;

  // 6. Bordo Outonal (Mature & Sapling)
  public static mapleTrunk: THREE.BufferGeometry;
  public static mapleLeaves: THREE.BufferGeometry;

  // 7. Cacto Saguaro (Mature & Sapling)
  public static cactusBody: THREE.BufferGeometry;
  public static cactusSaplingBody: THREE.BufferGeometry;

  // 8. Arbustos (Lush & Berry)
  public static shrubLush: THREE.BufferGeometry;
  public static shrubBerry: THREE.BufferGeometry;

  // 9. Rochas Variadas (5 Formatos)
  public static rock: THREE.BufferGeometry;
  public static rockBoulder: THREE.BufferGeometry;
  public static rockSlate: THREE.BufferGeometry;
  public static rockPebbles: THREE.BufferGeometry;
  public static rockSpire: THREE.BufferGeometry;
  public static rockMossy: THREE.BufferGeometry;

  // 10. Madeira e Troncos Caídos Variados (4 Formatos)
  public static fallenLog: THREE.BufferGeometry;
  public static logHollow: THREE.BufferGeometry;
  public static logRooted: THREE.BufferGeometry;
  public static logStump: THREE.BufferGeometry;

  // 11. Variantes Arbóreas
  public static twinBirchTrunk: THREE.BufferGeometry;
  public static twinBirchLeaves: THREE.BufferGeometry;
  public static broadOakTrunk: THREE.BufferGeometry;
  public static broadOakLeaves: THREE.BufferGeometry;

  // 12. Sub-bosque e Flora Rasteira
  public static groundFern: THREE.BufferGeometry;
  public static wildflowers: THREE.BufferGeometry;
  public static reeds: THREE.BufferGeometry;

  // 13. Manguezal (Mature & Sapling)
  public static mangroveTrunk: THREE.BufferGeometry;
  public static mangroveLeaves: THREE.BufferGeometry;
  public static mangroveSaplingTrunk: THREE.BufferGeometry;
  public static mangroveSaplingLeaves: THREE.BufferGeometry;

  // 14. Tronco Queimado Vulcânico
  public static deadTrunk: THREE.BufferGeometry;

  // 15. Pinheiro Glacial Nevado
  public static snowPineTrunk: THREE.BufferGeometry;
  public static snowPineLeaves: THREE.BufferGeometry;

  // 16. Salgueiro-Anão da Tundra
  public static arcticWillowTrunk: THREE.BufferGeometry;
  public static arcticWillowLeaves: THREE.BufferGeometry;

  private static initialized = false;

  public static init(): void {
    if (this.initialized) return;

    // 1. CARVALHO TEMPERADO (Mature Oak & Sapling)
    const oak = BotanicalGeometryFactory.buildMatureOak();
    this.oakTrunk = oak.trunk;
    this.oakLeaves = oak.leaves;

    const oakSap = BotanicalGeometryFactory.buildOakSapling();
    this.oakSaplingTrunk = oakSap.trunk;
    this.oakSaplingLeaves = oakSap.leaves;

    // 2. PINHEIRO CONÍFERO (Mature Pine & Sapling)
    const pine = BotanicalGeometryFactory.buildMaturePine();
    this.pineTrunk = pine.trunk;
    this.pineLeaves = pine.leaves;

    const pineSap = BotanicalGeometryFactory.buildPineSapling();
    this.pineSaplingTrunk = pineSap.trunk;
    this.pineSaplingLeaves = pineSap.leaves;

    // 3. BÉTULA BRANCA (Mature Birch & Sapling)
    const birch = BotanicalGeometryFactory.buildMatureBirch();
    this.birchTrunk = birch.trunk;
    this.birchLeaves = birch.leaves;

    const birchSap = BotanicalGeometryFactory.buildBirchSapling();
    this.birchSaplingTrunk = birchSap.trunk;
    this.birchSaplingLeaves = birchSap.leaves;

    // 4. COQUEIRO COSTEIRO (Mature Palm & Sprout)
    const palm = BotanicalGeometryFactory.buildMaturePalm();
    this.palmTrunk = palm.trunk;
    this.palmLeaves = palm.leaves;

    const palmSap = BotanicalGeometryFactory.buildPalmSprout();
    this.palmSaplingTrunk = palmSap.trunk;
    this.palmSaplingLeaves = palmSap.leaves;

    // 5. ACÁCIA DA SAVANA (Mature Acacia & Sapling)
    const acacia = BotanicalGeometryFactory.buildMatureAcacia();
    this.acaciaTrunk = acacia.trunk;
    this.acaciaLeaves = acacia.leaves;

    const acaciaSap = BotanicalGeometryFactory.buildAcaciaSapling();
    this.acaciaSaplingTrunk = acaciaSap.trunk;
    this.acaciaSaplingLeaves = acaciaSap.leaves;

    // 6. BORDO OUTONAL (Maple)
    this.mapleTrunk = oak.trunk;
    this.mapleLeaves = oak.leaves;

    // 7. CACTO SAGUARO (Mature Saguaro & Sprout)
    const saguaro = BotanicalGeometryFactory.buildMatureSaguaro();
    this.cactusBody = saguaro.body;

    const saguaroSap = BotanicalGeometryFactory.buildSaguaroSprout();
    this.cactusSaplingBody = saguaroSap.body;

    // 8. ARBUSTOS (Lush Shrub & Berry Bush)
    const lush = BotanicalGeometryFactory.buildLushShrub();
    this.shrubLush = lush.body;

    const berry = BotanicalGeometryFactory.buildBerryBush();
    this.shrubBerry = berry.body;

    // 9. ROCHAS AMBIENTAIS (5 Formatos Distintos)
    this.rockBoulder = BotanicalGeometryFactory.buildWeatheredBoulder().body;
    this.rockSlate = BotanicalGeometryFactory.buildSharpSlate().body;
    this.rockPebbles = BotanicalGeometryFactory.buildPebbleCluster().body;
    this.rockSpire = BotanicalGeometryFactory.buildRockSpire().body;
    this.rockMossy = BotanicalGeometryFactory.buildMossyRock().body;
    this.rock = this.rockBoulder;

    // 10. MADEIRA E TRONCOS CAÍDOS (4 Formatos Distintos)
    this.logHollow = BotanicalGeometryFactory.buildHollowLog().body;
    this.logRooted = BotanicalGeometryFactory.buildRootedLog().body;
    this.logStump = BotanicalGeometryFactory.buildTreeStump().body;
    const lGeo = new THREE.CylinderGeometry(0.36, 0.48, 5.0, 6);
    lGeo.rotateZ(Math.PI / 2);
    lGeo.translate(0, 0.38, 0);
    this.fallenLog = lGeo;

    // 11. VARIANTES ARBÓREAS
    const twinBirch = BotanicalGeometryFactory.buildTwinBirch();
    this.twinBirchTrunk = twinBirch.trunk;
    this.twinBirchLeaves = twinBirch.leaves;

    const broadOak = BotanicalGeometryFactory.buildBroadOak();
    this.broadOakTrunk = broadOak.trunk;
    this.broadOakLeaves = broadOak.leaves;

    // 12. SUB-BOSQUE E FLORA RASTEIRA
    this.groundFern = BotanicalGeometryFactory.buildForestFern().body;
    this.wildflowers = BotanicalGeometryFactory.buildWildflowers().body;
    this.reeds = BotanicalGeometryFactory.buildReeds().body;

    // 13. MANGUEZAL TROPICAL (Mature Mangrove & Sapling)
    const mangrove = BotanicalGeometryFactory.buildMatureMangrove();
    this.mangroveTrunk = mangrove.trunk;
    this.mangroveLeaves = mangrove.leaves;

    const mangroveSap = BotanicalGeometryFactory.buildMangroveSapling();
    this.mangroveSaplingTrunk = mangroveSap.trunk;
    this.mangroveSaplingLeaves = mangroveSap.leaves;

    // 14. TRONCO CALCINADO VULCÂNICO (Burnt Tree)
    const burnt = BotanicalGeometryFactory.buildBurntTree();
    this.deadTrunk = burnt.body;

    // 15. PINHEIRO NEVADO GLACIAL (Snow Pine)
    const snowPine = BotanicalGeometryFactory.buildSnowPine();
    this.snowPineTrunk = snowPine.trunk;
    this.snowPineLeaves = snowPine.leaves;

    // 16. SALGUEIRO-ANÃO DA TUNDRA (Arctic Willow)
    const willow = BotanicalGeometryFactory.buildArcticWillow();
    this.arcticWillowTrunk = willow.trunk;
    this.arcticWillowLeaves = willow.leaves;

    this.initialized = true;
  }
}

export interface TreeTransformItem {
  matrix: THREE.Matrix4;
  trunkTint: THREE.Color;
  leafTint: THREE.Color;
}

function setupCartoonMaterial(mat: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  mat.onBeforeCompile = (shader) => {
    // 1. Substitui o cálculo da luz difusa em lights_lambert_pars_fragment para iluminação plana toon (sem decaimento de cosseno)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_lambert_pars_fragment>',
      THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        'float dotNL = 1.0;'
      )
    );

    // 2. Injeta a função de revectorização de silhueta de sombra (SMSR) com compensação de plano receptor
    const smsrFunction = /* glsl */ `
      vec2 computeReceiverPlaneDepthSlope(vec3 shadowCoord) {
        vec3 dcdx = dFdx(shadowCoord);
        vec3 dcdy = dFdy(shadowCoord);
        float det = dcdx.x * dcdy.y - dcdx.y * dcdy.x;
        if (abs(det) > 1e-8) {
          vec2 slope = vec2(
            dcdy.y * dcdx.z - dcdx.y * dcdy.z,
            dcdx.x * dcdy.z - dcdy.x * dcdx.z
          ) / det;
          return clamp(slope, -50.0, 50.0);
        }
        return vec2(0.0);
      }

      float sampleShadowSMSR(sampler2D shadowMap, vec2 uv, float compareDepth, vec2 mapSize, vec2 dz_duv) {
        vec2 texelSize = vec2(1.0) / mapSize;
        vec2 coord = uv * mapSize - 0.5;
        vec2 base = floor(coord);
        vec2 f = fract(coord);

        vec2 uv00 = (base + vec2(0.5, 0.5)) * texelSize;
        vec2 uv10 = uv00 + vec2(texelSize.x, 0.0);
        vec2 uv01 = uv00 + vec2(0.0, texelSize.y);
        vec2 uv11 = uv00 + texelSize;

        // Ajuste planar de profundidade do plano receptor para cada texel vizinho
        float d00 = compareDepth + dot(uv00 - uv, dz_duv);
        float d10 = compareDepth + dot(uv10 - uv, dz_duv);
        float d01 = compareDepth + dot(uv01 - uv, dz_duv);
        float d11 = compareDepth + dot(uv11 - uv, dz_duv);

        float s00 = texture2DCompare(shadowMap, uv00, d00);
        float s10 = texture2DCompare(shadowMap, uv10, d10);
        float s01 = texture2DCompare(shadowMap, uv01, d01);
        float s11 = texture2DCompare(shadowMap, uv11, d11);

        // Se todos os 4 texels concordam, não há silhueta na célula
        if (s00 == s10 && s10 == s01 && s01 == s11) {
          return s00;
        }

        // SMSR: Gradiente e normal da silhueta sub-pixel
        vec2 grad = vec2((s10 + s11) - (s00 + s01), (s01 + s11) - (s00 + s10));
        float gradLen = length(grad);
        if (gradLen < 0.001) {
          return (s00 + s10 + s01 + s11) * 0.25;
        }
        vec2 edgeNormal = grad / gradLen;
        float coverage = (s00 + s10 + s01 + s11) * 0.25;

        // Distância sub-pixel até a silhueta revectorizada
        float dist = dot(f - 0.5, edgeNormal) + (coverage - 0.5) * 1.25;

        // Transição sub-pixel nítida estilo cartoon
        const float w = 0.08;
        return smoothstep(-w, w, dist);
      }
    `;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <shadowmap_pars_fragment>',
      THREE.ShaderChunk.shadowmap_pars_fragment + smsrFunction
    );

    // 3. Constrói o bloco customizado de luzes direcionais com amostragem hierárquica concêntrica de Shadow Clipmap + SMSR
    const clipmapDirectionalLights = /* glsl */ `
      #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
        DirectionalLight directionalLight;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        DirectionalLightShadow directionalLightShadow;
        #endif

        // Avalia a iluminação solar primária (directionalLights[0])
        directionalLight = directionalLights[ 0 ];
        getDirectionalLightInfo( directionalLight, directLight );

        float clipmapShadow = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        if ( receiveShadow ) {
          float NdotL_raw = dot(geometryNormal, directLight.direction);
          float tanTheta = sqrt(clamp(1.0 - NdotL_raw * NdotL_raw, 0.0, 1.0)) / max(abs(NdotL_raw), 0.02);
          float slopeFactor = clamp(tanTheta, 0.0, 2.5);

          #if NUM_DIR_LIGHT_SHADOWS >= 1
          vec4 sc0 = vDirectionalShadowCoord[0];
          vec3 c0 = sc0.xyz / sc0.w;
          vec2 dz_duv0 = computeReceiverPlaneDepthSlope(c0);
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 2
          vec4 sc1 = vDirectionalShadowCoord[1];
          vec3 c1 = sc1.xyz / sc1.w;
          vec2 dz_duv1 = computeReceiverPlaneDepthSlope(c1);
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 3
          vec4 sc2 = vDirectionalShadowCoord[2];
          vec3 c2 = sc2.xyz / sc2.w;
          vec2 dz_duv2 = computeReceiverPlaneDepthSlope(c2);
          #endif

          bool sampled = false;
          #if NUM_DIR_LIGHT_SHADOWS >= 1
          if (!sampled && c0.x >= 0.01 && c0.x <= 0.99 && c0.y >= 0.01 && c0.y <= 0.99 && c0.z <= 1.0) {
            float bias0 = directionalLightShadows[0].shadowBias - 0.00004 * slopeFactor;
            clipmapShadow = sampleShadowSMSR( directionalShadowMap[0], c0.xy, c0.z + bias0, directionalLightShadows[0].shadowMapSize, dz_duv0 );
            sampled = true;
          }
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 2
          if (!sampled && c1.x >= 0.01 && c1.x <= 0.99 && c1.y >= 0.01 && c1.y <= 0.99 && c1.z <= 1.0) {
            float bias1 = directionalLightShadows[1].shadowBias - 0.00008 * slopeFactor;
            clipmapShadow = sampleShadowSMSR( directionalShadowMap[1], c1.xy, c1.z + bias1, directionalLightShadows[1].shadowMapSize, dz_duv1 );
            sampled = true;
          }
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 3
          if (!sampled && c2.x >= 0.01 && c2.x <= 0.99 && c2.y >= 0.01 && c2.y <= 0.99 && c2.z <= 1.0) {
            float bias2 = directionalLightShadows[2].shadowBias - 0.00016 * slopeFactor;
            clipmapShadow = sampleShadowSMSR( directionalShadowMap[2], c2.xy, c2.z + bias2, directionalLightShadows[2].shadowMapSize, dz_duv2 );
            sampled = true;
          }
          #endif
        }
        #endif

        // Sombra cartoon com silhueta analítica nítida de 2 tons (Zelda / Cel-Shading clássico)
        float hardShadow = clipmapShadow;
        float NdotL = dot( geometryNormal, directLight.direction );
        float shadowMask = step( 0.04, NdotL ) * hardShadow;
        float celIntensity = mix( 0.30, 1.0, shadowMask );

        directLight.color *= celIntensity;
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      #endif
    `;

    // 4. Substitui o loop de luzes direcionais em lights_fragment_begin pelo amostrador do Clipmap + SMSR
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const targetBlock = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
    const idxStart = chunk.indexOf(targetBlock);
    const nextBlock = '#if ( NUM_RECT_AREA_LIGHTS > 0 )';
    const idxEnd = chunk.indexOf(nextBlock);

    if (idxStart !== -1 && idxEnd !== -1) {
      const newChunk = chunk.substring(0, idxStart) + clipmapDirectionalLights + chunk.substring(idxEnd);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', newChunk);
    }
  };
  return mat;
}

export class VegetationManager {
  // Materiais estilizados com texturas procedurais e reflexo difuso
  private trunkMaterial: THREE.MeshLambertMaterial;
  private birchTrunkMaterial: THREE.MeshLambertMaterial;
  private palmTrunkMaterial: THREE.MeshLambertMaterial;
  private foliageMaterial: THREE.MeshLambertMaterial;
  private palmFrondMaterial: THREE.MeshLambertMaterial;
  private cactusMaterial: THREE.MeshLambertMaterial;
  private snowPineFoliageMaterial: THREE.MeshLambertMaterial;
  private shrubMaterial: THREE.MeshLambertMaterial;
  private rockMaterial: THREE.MeshLambertMaterial;
  private logMaterial: THREE.MeshLambertMaterial;
  private deadTreeMaterial: THREE.MeshLambertMaterial;
  private groundFloraMaterial: THREE.MeshLambertMaterial;

  constructor() {
    VegetationGeometries.init();

    const barkTex = VegetationTextures.getBarkTexture();
    const birchTex = VegetationTextures.getBirchBarkTexture();
    const palmBarkTex = VegetationTextures.getPalmBarkTexture();
    const foliageTex = VegetationTextures.getFoliageTexture();
    const palmFrondTex = VegetationTextures.getPalmFrondTexture();
    const cactusTex = VegetationTextures.getCactusTexture();
    const snowFoliageTex = VegetationTextures.getSnowFoliageTexture();
    const burntTex = VegetationTextures.getBurntWoodTexture();
    const rockTex = VegetationTextures.getRockTexture();
    const woodTex = VegetationTextures.getWeatheredWoodTexture();

    this.trunkMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: barkTex,
      color: 0xffffff,
      flatShading: false
    }));

    this.birchTrunkMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: birchTex,
      color: 0xffffff,
      flatShading: false
    }));

    this.palmTrunkMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: palmBarkTex,
      color: 0xffffff,
      flatShading: false
    }));

    this.foliageMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: foliageTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }));

    this.palmFrondMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: palmFrondTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }));

    this.cactusMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: cactusTex,
      color: 0xffffff,
      flatShading: false
    }));

    this.snowPineFoliageMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: snowFoliageTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }));

    this.shrubMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: foliageTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }));

    this.rockMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: rockTex,
      color: 0xffffff,
      flatShading: false
    }));

    this.logMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: woodTex,
      color: 0xffffff,
      flatShading: false
    }));

    this.deadTreeMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: burntTex,
      color: 0xffffff,
      flatShading: false
    }));

    this.groundFloraMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: foliageTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }));
  }

  public populateChunk(
    chunkX: number,
    chunkZ: number,
    chunkSize: number,
    terrainGen: ITerrainQueryable,
    parentGroup: THREE.Group
  ): void {
    const chunkSeed = PRNG.hash2D(chunkX, chunkZ, 0x85ebca6b);
    const prng = new PRNG(chunkSeed * 100000);

    // Listas de instâncias: Adultas, Mudas (Saplings) e Variantes
    const oakItems: TreeTransformItem[] = [];
    const broadOakItems: TreeTransformItem[] = [];
    const oakSaplingItems: TreeTransformItem[] = [];
    const pineItems: TreeTransformItem[] = [];
    const pineSaplingItems: TreeTransformItem[] = [];
    const birchItems: TreeTransformItem[] = [];
    const twinBirchItems: TreeTransformItem[] = [];
    const birchSaplingItems: TreeTransformItem[] = [];
    const palmItems: TreeTransformItem[] = [];
    const palmSaplingItems: TreeTransformItem[] = [];
    const acaciaItems: TreeTransformItem[] = [];
    const acaciaSaplingItems: TreeTransformItem[] = [];
    const mapleItems: TreeTransformItem[] = [];
    const mangroveItems: TreeTransformItem[] = [];
    const mangroveSaplingItems: TreeTransformItem[] = [];
    const snowPineItems: TreeTransformItem[] = [];
    const arcticWillowItems: TreeTransformItem[] = [];
    const deadTreeTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const cactusTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const cactusSaplingTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const shrubLushTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const shrubBerryTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];

    // Rochas Variadas (5 Formatos Distintos)
    const rockBoulderTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const rockSlateTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const rockPebblesTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const rockSpireTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const rockMossyTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];

    // Madeira e Troncos Caídos Variados (4 Formatos)
    const logHollowTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const logRootedTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const logStumpTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const logStraightTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];

    // Sub-bosque e Flora Rasteira
    const fernTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const wildflowerTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
    const reedTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];

    const dummy = new THREE.Object3D();
    const halfSize = chunkSize / 2;
    const startX = chunkX * chunkSize - halfSize;
    const startZ = chunkZ * chunkSize - halfSize;

    // Amostragem espaçada de 6.2m para clareiras naturais
    const sampleStep = 6.2;
    const steps = Math.floor(chunkSize / sampleStep);

    for (let ix = 0; ix < steps; ix++) {
      for (let iz = 0; iz < steps; iz++) {
        const jx = (prng.next() - 0.5) * sampleStep * 0.85;
        const jz = (prng.next() - 0.5) * sampleStep * 0.85;
        const wx = startX + (ix + 0.5) * sampleStep + jx;
        const wz = startZ + (iz + 0.5) * sampleStep + jz;

        const pt: TerrainPoint = terrainGen.getPointFast ? terrainGen.getPointFast(wx, wz) : terrainGen.getPoint(wx, wz);

        // 1. Nenhuma árvore dentro d'água (apenas seixos ou blocos submersos eventuais)
        if (pt.isWater || pt.height <= CONFIG.SEA_LEVEL) {
          if (pt.height > -2.0 && prng.chance(0.025)) {
            const rScale = prng.range(0.75, 1.4);
            dummy.position.set(wx, pt.height - 0.08 * rScale, wz);
            dummy.scale.set(rScale, rScale * 0.55, rScale);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            if (prng.chance(0.65)) {
              rockPebblesTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x687078) });
            } else {
              rockBoulderTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x6e747c) });
            }
          }
          continue;
        }

        const biome = pt.biome;
        const isBeach = biome.type === 'Praia Arenosa' && (pt.iceInfluence || 0) < 0.15;

        // Juncos aquáticos / Taboas nas margens úmidas (0.12m a 1.40m de altitude)
        if (pt.height >= 0.12 && pt.height <= 1.40 && pt.slope < 0.32 && !isBeach) {
          if (prng.chance(0.065)) {
            const rScale = prng.range(0.85, 1.35);
            dummy.position.set(wx, pt.height - 0.02, wz);
            dummy.scale.set(rScale, rScale * prng.range(0.95, 1.25), rScale);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            reedTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x448a32) });
          }
        }

        // 2. Areia Molhada da Orla (faixa até 0.85m): 100% limpa de árvores
        if (pt.height <= 0.85) {
          if (prng.chance(0.025)) {
            const rScale = prng.range(0.4, 0.85);
            dummy.position.set(wx, pt.height - 0.06 * rScale, wz);
            dummy.scale.set(rScale, rScale * 0.5, rScale);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            if (prng.chance(0.70)) {
              rockPebblesTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x756e5e) });
            } else {
              rockBoulderTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x6a6558) });
            }
          } else if (prng.chance(0.014)) {
            const logScale = prng.range(0.65, 0.95);
            dummy.position.set(wx, pt.height - 0.04 * logScale, wz);
            dummy.scale.set(logScale, logScale, logScale);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            if (prng.chance(0.60)) {
              logHollowTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x4a3c30) });
            } else {
              logRootedTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x4a3c30) });
            }
          }
          continue;
        }

        // Na praia, a faixa de areia baixa (até 1.8m) é preservada limpa
        if (isBeach && pt.height < 1.8) {
          if (prng.chance(0.018)) {
            const rScale = prng.range(0.4, 0.75);
            dummy.position.set(wx, pt.height - 0.06 * rScale, wz);
            dummy.scale.set(rScale, rScale * 0.5, rScale);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            rockPebblesTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x756e5e) });
          }
          continue;
        }

        const canTree = pt.slope <= CONFIG.VEGETATION.MAX_SLOPE_FOR_TREES;
        const treeChance = canTree ? biome.vegetationDensity * 0.75 : 0;
        const shrubChance = (!isBeach && pt.slope < 0.52) ? biome.shrubDensity * 0.22 : 0;
        const maxRockSlope = pt.height > 45.0 ? 0.38 : 0.50;
        const canRock = pt.slope <= maxRockSlope;
        const rockChance = canRock ? biome.rockDensity * 0.16 : 0;
        const logChance = pt.slope < 0.35 ? biome.fallenLogDensity * 0.08 : 0;

        const roll = prng.next();

        if (roll < treeChance) {
          // REGRA DA PRAIA: Apenas coqueiros (adulto ou muda)
          if (isBeach) {
            const isSapling = prng.chance(0.28); // 28% de mudas jovens na praia
            if (isSapling) {
              const sScale = prng.range(0.85, 1.2);
              const yaw = prng.range(0, Math.PI * 2);
              dummy.position.set(wx, pt.height - 0.05, wz);
              dummy.rotation.set(0, yaw, 0);
              dummy.scale.set(sScale, sScale, sScale);
              dummy.updateMatrix();
              palmSaplingItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x8a633a),
                leafTint: new THREE.Color(0x76c22c)
              });
            } else {
              const palmHeightScale = prng.range(0.92, 1.25);
              const palmWidthScale = prng.range(0.92, 1.15);
              const palmTilt = prng.range(0.08, 0.20);
              const palmYaw = prng.range(0, Math.PI * 2);

              dummy.position.set(wx, pt.height - 0.08, wz);
              dummy.rotation.set(Math.sin(palmYaw) * palmTilt, palmYaw, Math.cos(palmYaw) * palmTilt);
              dummy.scale.set(palmWidthScale, palmHeightScale, palmWidthScale);
              dummy.updateMatrix();

              palmItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0xa68252),
                leafTint: new THREE.Color(0x4cb828)
              });
            }
            continue;
          }

          // VEGETAÇÃO DO INTERIOR
          const isSapling = prng.chance(0.24);
          const heightScale = prng.range(0.90, 1.22);
          const widthScale = prng.range(0.90, 1.18);
          const yaw = prng.range(0, Math.PI * 2);

          const treeEmbed = Math.max(0.06, pt.slope * 0.15);
          dummy.position.set(wx, pt.height - treeEmbed, wz);
          dummy.rotation.set(0, yaw, 0);

          const dist = biome.treeTypeDistribution;
          const totalWeight =
            (dist.oak || 0) +
            (dist.pine || 0) +
            (dist.birch || 0) +
            (dist.coastalPalm || 0) +
            (dist.acacia || 0) +
            (dist.autumnMaple || 0) +
            (dist.mangrove || 0) +
            (dist.deadBurntTree || 0) +
            (dist.snowPine || 0) +
            (dist.arcticWillow || 0) +
            (dist.cactus || 0);

          if (totalWeight <= 0) continue;
          const normType = prng.next() * totalWeight;
          let acc = 0;

          if ((acc += (dist.oak || 0)) && normType < acc) {
            // Carvalho (Adulto padrão vs Carvalho de Copa Ampla vs Muda)
            if (isSapling) {
              dummy.scale.set(widthScale * 0.9, heightScale * 0.9, widthScale * 0.9);
              dummy.updateMatrix();
              oakSaplingItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x72573e),
                leafTint: new THREE.Color(0x68c434)
              });
            } else {
              const isBroad = prng.chance(0.32);
              if (isBroad) {
                dummy.scale.set(widthScale * 1.12, heightScale * 0.95, widthScale * 1.12);
                dummy.updateMatrix();
                broadOakItems.push({
                  matrix: dummy.matrix.clone(),
                  trunkTint: new THREE.Color(0x563e2a),
                  leafTint: new THREE.Color(0x429c2c)
                });
              } else {
                dummy.scale.set(widthScale * 1.05, heightScale, widthScale * 1.05);
                dummy.updateMatrix();
                oakItems.push({
                  matrix: dummy.matrix.clone(),
                  trunkTint: new THREE.Color(0x5c422d),
                  leafTint: new THREE.Color(0x48aa32)
                });
              }
            }
          } else if ((acc += (dist.pine || 0)) && normType < acc) {
            // Pinheiro Conífero
            if (isSapling) {
              dummy.scale.set(widthScale * 0.85, heightScale * 0.85, widthScale * 0.85);
              dummy.updateMatrix();
              pineSaplingItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x563e2c),
                leafTint: new THREE.Color(0x388248)
              });
            } else {
              dummy.scale.set(widthScale * 0.95, heightScale * 1.05, widthScale * 0.95);
              dummy.updateMatrix();
              pineItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x4a3424),
                leafTint: new THREE.Color(0x2a7238)
              });
            }
          } else if ((acc += (dist.birch || 0)) && normType < acc) {
            // Bétula (Adulto padrão vs Bétula de Tronco Duplo vs Muda)
            if (isSapling) {
              dummy.scale.set(widthScale * 0.82, heightScale * 0.82, widthScale * 0.82);
              dummy.updateMatrix();
              birchSaplingItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0xf4f4f0),
                leafTint: new THREE.Color(0x7ed638)
              });
            } else {
              const isTwin = prng.chance(0.28);
              if (isTwin) {
                dummy.scale.set(widthScale * 0.95, heightScale * 0.95, widthScale * 0.95);
                dummy.updateMatrix();
                twinBirchItems.push({
                  matrix: dummy.matrix.clone(),
                  trunkTint: new THREE.Color(0xf0f0ea),
                  leafTint: new THREE.Color(0x6ec430)
                });
              } else {
                dummy.scale.set(widthScale * 0.88, heightScale * 1.05, widthScale * 0.88);
                dummy.updateMatrix();
                birchItems.push({
                  matrix: dummy.matrix.clone(),
                  trunkTint: new THREE.Color(0xeeeee8),
                  leafTint: new THREE.Color(0x6ec430)
                });
              }
            }
          } else if ((acc += (dist.coastalPalm || 0)) && normType < acc) {
            // Palmeira de Interior
            dummy.scale.set(widthScale, heightScale, widthScale);
            dummy.updateMatrix();
            palmItems.push({
              matrix: dummy.matrix.clone(),
              trunkTint: new THREE.Color(0xa68252),
              leafTint: new THREE.Color(0x4cb828)
            });
          } else if ((acc += (dist.acacia || 0)) && normType < acc) {
            // Acácia da Savana
            if (isSapling) {
              dummy.scale.set(widthScale * 0.9, heightScale * 0.9, widthScale * 0.9);
              dummy.updateMatrix();
              acaciaSaplingItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x604a36),
                leafTint: new THREE.Color(0x78ab32)
              });
            } else {
              dummy.scale.set(widthScale * 1.1, heightScale, widthScale * 1.1);
              dummy.updateMatrix();
              acaciaItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x4c3826),
                leafTint: new THREE.Color(0x6e9c2e)
              });
            }
          } else if ((acc += (dist.autumnMaple || 0)) && normType < acc) {
            // Bordo Outonal
            dummy.scale.set(widthScale * 1.02, heightScale, widthScale * 1.02);
            dummy.updateMatrix();
            const mapleRoll = prng.next();
            let leafTint: THREE.Color;
            if (mapleRoll < 0.38) {
              leafTint = new THREE.Color(0xd44022);
            } else if (mapleRoll < 0.72) {
              leafTint = new THREE.Color(0xe87a1a);
            } else {
              leafTint = new THREE.Color(0xe8b824);
            }
            mapleItems.push({
              matrix: dummy.matrix.clone(),
              trunkTint: new THREE.Color(0x4c3828),
              leafTint
            });
          } else if ((acc += (dist.mangrove || 0)) && normType < acc) {
            // Manguezal
            if (isSapling) {
              dummy.scale.set(widthScale * 0.85, heightScale * 0.85, widthScale * 0.85);
              dummy.updateMatrix();
              mangroveSaplingItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x483626),
                leafTint: new THREE.Color(0x3e9834)
              });
            } else {
              dummy.scale.set(widthScale * 1.05, heightScale, widthScale * 1.05);
              dummy.updateMatrix();
              mangroveItems.push({
                matrix: dummy.matrix.clone(),
                trunkTint: new THREE.Color(0x3e2d1f),
                leafTint: new THREE.Color(0x348c2c)
              });
            }
          } else if ((acc += (dist.deadBurntTree || 0)) && normType < acc) {
            // Tronco calcinado vulcânico
            dummy.scale.set(widthScale * 0.9, heightScale, widthScale * 0.9);
            dummy.updateMatrix();
            deadTreeTransforms.push({
              matrix: dummy.matrix.clone(),
              tint: new THREE.Color(0x22201e)
            });
          } else if ((acc += (dist.snowPine || 0)) && normType < acc) {
            // Pinheiro Glacial Nevado
            dummy.scale.set(widthScale * 0.95, heightScale * 1.05, widthScale * 0.95);
            dummy.updateMatrix();
            snowPineItems.push({
              matrix: dummy.matrix.clone(),
              trunkTint: new THREE.Color(0x3c2c22),
              leafTint: new THREE.Color(0xffffff)
            });
          } else if ((acc += (dist.arcticWillow || 0)) && normType < acc) {
            // Salgueiro-anão de tundra
            dummy.scale.set(widthScale * 1.2, heightScale * 0.85, widthScale * 1.2);
            dummy.updateMatrix();
            arcticWillowItems.push({
              matrix: dummy.matrix.clone(),
              trunkTint: new THREE.Color(0x44362a),
              leafTint: new THREE.Color(0x72927c)
            });
          } else if ((dist.cactus || 0) > 0) {
            // Cacto Saguaro do Deserto
            if (isSapling) {
              dummy.scale.set(widthScale * 0.85, heightScale * 0.85, widthScale * 0.85);
              dummy.updateMatrix();
              cactusSaplingTransforms.push({
                matrix: dummy.matrix.clone(),
                tint: new THREE.Color(0x5ca850)
              });
            } else {
              dummy.scale.set(widthScale * 0.95, heightScale, widthScale * 0.95);
              dummy.updateMatrix();
              cactusTransforms.push({
                matrix: dummy.matrix.clone(),
                tint: new THREE.Color(0x4e8e42)
              });
            }
          }
        } else if (roll < treeChance + shrubChance) {
          // 2. ARBUSTOS (Folhoso vs Frutífero)
          const isArctic = biome.type === BiomeType.FROZEN_TUNDRA || (pt.iceInfluence || 0) > 0.15;
          const sScale = prng.range(0.85, 1.35) * (isArctic ? 0.85 : 1.0);
          dummy.position.set(wx, pt.height - 0.08 * sScale, wz);
          dummy.scale.set(sScale, sScale * prng.range(0.9, 1.15), sScale);
          dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();

          const hasBerberries = !isArctic && prng.chance(0.32);
          if (hasBerberries) {
            shrubBerryTransforms.push({
              matrix: dummy.matrix.clone(),
              tint: new THREE.Color(0xffffff)
            });
          } else {
            const shrubTint = isArctic ? new THREE.Color(0x94b4a2) : new THREE.Color(0x4e9c2c);
            shrubLushTransforms.push({
              matrix: dummy.matrix.clone(),
              tint: shrubTint
            });
          }
        } else if (roll < treeChance + shrubChance + rockChance) {
          // 3. ROCHAS ASSENTADAS COM VARIEDADE (5 Formatos)
          const isArctic = biome.type === BiomeType.FROZEN_TUNDRA || (pt.iceInfluence || 0) > 0.15;
          const isPeakOrVolcano = biome.type === BiomeType.ROCKY_PEAKS || biome.type === BiomeType.SNOW_SUMMIT ||
            biome.type === BiomeType.VOLCANIC_FIELD || biome.type === BiomeType.VOLCANIC_CALDERA ||
            biome.type === BiomeType.CANYON_DESERT;
          const isForest = biome.type === BiomeType.TEMPERATE_FOREST || biome.type === BiomeType.AUTUMN_FOREST;

          const rScale = prng.range(0.70, 1.40);
          const embedOffset = Math.max(0.16 * rScale, pt.slope * 0.45 * rScale);
          dummy.position.set(wx, pt.height - embedOffset, wz);
          dummy.scale.set(
            rScale * prng.range(0.85, 1.25),
            rScale * prng.range(0.75, 1.15),
            rScale * prng.range(0.85, 1.25)
          );

          // Alinhamento tangencial com a normal da encosta
          const normalVec = pt.normal ? pt.normal : new THREE.Vector3(0, 1, 0);
          const slopeQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalVec);
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prng.range(0, Math.PI * 2));
          dummy.quaternion.copy(slopeQuat.multiply(yawQuat));
          dummy.updateMatrix();

          const rockShade = prng.range(0.90, 1.10);
          const baseColor = isArctic ? 0xa8c2cf : 0x8a8e92;
          const rockTint = new THREE.Color(baseColor).multiplyScalar(rockShade);

          const rockPick = prng.next();
          if (isPeakOrVolcano) {
            if (rockPick < 0.45) {
              rockSlateTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            } else if (rockPick < 0.80) {
              rockSpireTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            } else {
              rockBoulderTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            }
          } else if (isForest) {
            if (rockPick < 0.40) {
              rockMossyTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            } else if (rockPick < 0.70) {
              rockBoulderTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            } else if (rockPick < 0.88) {
              rockPebblesTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            } else {
              rockSlateTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            }
          } else {
            if (rockPick < 0.45) {
              rockBoulderTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            } else if (rockPick < 0.75) {
              rockPebblesTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            } else {
              rockSlateTransforms.push({ matrix: dummy.matrix.clone(), tint: rockTint });
            }
          }
        } else if (roll < treeChance + shrubChance + rockChance + logChance) {
          // 4. TRONCOS CAÍDOS E TOCOS COM VARIEDADE (4 Formatos)
          const logScale = prng.range(0.75, 1.25);
          dummy.position.set(wx, pt.height - 0.04 * logScale, wz);
          dummy.scale.set(logScale, logScale, logScale);

          const normalVec = pt.normal ? pt.normal : new THREE.Vector3(0, 1, 0);
          const slopeQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalVec);
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prng.range(0, Math.PI * 2));
          dummy.quaternion.copy(slopeQuat.multiply(yawQuat));
          dummy.updateMatrix();

          const logTint = new THREE.Color(0x6a5442).multiplyScalar(prng.range(0.85, 1.15));
          const logPick = prng.next();
          if (logPick < 0.38) {
            logHollowTransforms.push({ matrix: dummy.matrix.clone(), tint: logTint });
          } else if (logPick < 0.65) {
            logRootedTransforms.push({ matrix: dummy.matrix.clone(), tint: logTint });
          } else if (logPick < 0.88) {
            logStumpTransforms.push({ matrix: dummy.matrix.clone(), tint: logTint });
          } else {
            logStraightTransforms.push({ matrix: dummy.matrix.clone(), tint: logTint });
          }
        } else {
          // 5. SUB-BOSQUE E FLORA RASTEIRA NAS CLAREIRAS
          const isForest = biome.type === BiomeType.TEMPERATE_FOREST || biome.type === BiomeType.AUTUMN_FOREST;
          const isMeadow = biome.type === BiomeType.COASTAL_MEADOW || biome.type === BiomeType.SAVANNAH;

          if (isForest && pt.slope < 0.45 && prng.chance(0.14)) {
            const fScale = prng.range(0.85, 1.35);
            dummy.position.set(wx, pt.height + 0.02, wz);
            dummy.scale.set(fScale, fScale * prng.range(0.9, 1.15), fScale);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            fernTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x42b828) });
          } else if (isMeadow && pt.slope < 0.38 && prng.chance(0.12)) {
            const wScale = prng.range(0.9, 1.3);
            dummy.position.set(wx, pt.height + 0.02, wz);
            dummy.scale.set(wScale, wScale, wScale);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            wildflowerTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0xffffff) });
          }
        }
      }
    }

    // Instanciação em Pares de Árvores (Adultas, Mudas e Variantes)
    this.createInstancedPair(VegetationGeometries.oakTrunk, VegetationGeometries.oakLeaves, this.trunkMaterial, this.foliageMaterial, oakItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.broadOakTrunk, VegetationGeometries.broadOakLeaves, this.trunkMaterial, this.foliageMaterial, broadOakItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.oakSaplingTrunk, VegetationGeometries.oakSaplingLeaves, this.trunkMaterial, this.foliageMaterial, oakSaplingItems, parentGroup);

    this.createInstancedPair(VegetationGeometries.pineTrunk, VegetationGeometries.pineLeaves, this.trunkMaterial, this.foliageMaterial, pineItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.pineSaplingTrunk, VegetationGeometries.pineSaplingLeaves, this.trunkMaterial, this.foliageMaterial, pineSaplingItems, parentGroup);

    this.createInstancedPair(VegetationGeometries.birchTrunk, VegetationGeometries.birchLeaves, this.birchTrunkMaterial, this.foliageMaterial, birchItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.twinBirchTrunk, VegetationGeometries.twinBirchLeaves, this.birchTrunkMaterial, this.foliageMaterial, twinBirchItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.birchSaplingTrunk, VegetationGeometries.birchSaplingLeaves, this.birchTrunkMaterial, this.foliageMaterial, birchSaplingItems, parentGroup);

    this.createInstancedPair(VegetationGeometries.palmTrunk, VegetationGeometries.palmLeaves, this.palmTrunkMaterial, this.palmFrondMaterial, palmItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.palmSaplingTrunk, VegetationGeometries.palmSaplingLeaves, this.palmTrunkMaterial, this.palmFrondMaterial, palmSaplingItems, parentGroup);

    this.createInstancedPair(VegetationGeometries.acaciaTrunk, VegetationGeometries.acaciaLeaves, this.trunkMaterial, this.foliageMaterial, acaciaItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.acaciaSaplingTrunk, VegetationGeometries.acaciaSaplingLeaves, this.trunkMaterial, this.foliageMaterial, acaciaSaplingItems, parentGroup);

    this.createInstancedPair(VegetationGeometries.mapleTrunk, VegetationGeometries.mapleLeaves, this.trunkMaterial, this.foliageMaterial, mapleItems, parentGroup);

    this.createInstancedPair(VegetationGeometries.mangroveTrunk, VegetationGeometries.mangroveLeaves, this.trunkMaterial, this.foliageMaterial, mangroveItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.mangroveSaplingTrunk, VegetationGeometries.mangroveSaplingLeaves, this.trunkMaterial, this.foliageMaterial, mangroveSaplingItems, parentGroup);

    this.createInstancedPair(VegetationGeometries.snowPineTrunk, VegetationGeometries.snowPineLeaves, this.trunkMaterial, this.snowPineFoliageMaterial, snowPineItems, parentGroup);
    this.createInstancedPair(VegetationGeometries.arcticWillowTrunk, VegetationGeometries.arcticWillowLeaves, this.trunkMaterial, this.foliageMaterial, arcticWillowItems, parentGroup);

    // Instanciação de Meshes Individuais
    const createSingle = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { matrix: THREE.Matrix4; tint: THREE.Color }[], receiveShadow: boolean = true, name?: string) => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      if (name) mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = receiveShadow;
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].matrix);
        mesh.setColorAt(i, list[i].tint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere(); // Garante bounding sphere precisa para frustum culling
      parentGroup.add(mesh);
    };

    createSingle(VegetationGeometries.deadTrunk, this.deadTreeMaterial, deadTreeTransforms, true, 'deadTrunk');
    createSingle(VegetationGeometries.cactusBody, this.cactusMaterial, cactusTransforms, true, 'cactusBody');
    createSingle(VegetationGeometries.cactusSaplingBody, this.cactusMaterial, cactusSaplingTransforms, true, 'cactusSapling');
    createSingle(VegetationGeometries.shrubLush, this.shrubMaterial, shrubLushTransforms, false, 'shrubLush');
    createSingle(VegetationGeometries.shrubBerry, this.shrubMaterial, shrubBerryTransforms, false, 'shrubBerry');

    // Rochas variadas (5 Formatos)
    createSingle(VegetationGeometries.rockBoulder, this.rockMaterial, rockBoulderTransforms, true, 'rockBoulder');
    createSingle(VegetationGeometries.rockSlate, this.rockMaterial, rockSlateTransforms, true, 'rockSlate');
    createSingle(VegetationGeometries.rockPebbles, this.rockMaterial, rockPebblesTransforms, true, 'rockPebbles');
    createSingle(VegetationGeometries.rockSpire, this.rockMaterial, rockSpireTransforms, true, 'rockSpire');
    createSingle(VegetationGeometries.rockMossy, this.rockMaterial, rockMossyTransforms, true, 'rockMossy');

    // Madeira caída variada (4 Formatos)
    createSingle(VegetationGeometries.logHollow, this.logMaterial, logHollowTransforms, true);
    createSingle(VegetationGeometries.logRooted, this.logMaterial, logRootedTransforms, true);
    createSingle(VegetationGeometries.logStump, this.logMaterial, logStumpTransforms, true);
    createSingle(VegetationGeometries.fallenLog, this.logMaterial, logStraightTransforms, true);

    // Sub-bosque e flora rasteira
    createSingle(VegetationGeometries.groundFern, this.groundFloraMaterial, fernTransforms, false);
    createSingle(VegetationGeometries.wildflowers, this.groundFloraMaterial, wildflowerTransforms, false);
    createSingle(VegetationGeometries.reeds, this.groundFloraMaterial, reedTransforms, false);
  }

  private createInstancedPair(
    trunkGeo: THREE.BufferGeometry,
    leafGeo: THREE.BufferGeometry,
    trunkMat: THREE.Material,
    leafMat: THREE.Material,
    items: TreeTransformItem[],
    parent: THREE.Group
  ): void {
    if (items.length === 0) return;

    const count = items.length;
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, count);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    leafMesh.castShadow = true;
    leafMesh.receiveShadow = false;

    for (let i = 0; i < count; i++) {
      trunkMesh.setMatrixAt(i, items[i].matrix);
      trunkMesh.setColorAt(i, items[i].trunkTint);

      leafMesh.setMatrixAt(i, items[i].matrix);
      leafMesh.setColorAt(i, items[i].leafTint);
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    leafMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
    trunkMesh.computeBoundingSphere();
    leafMesh.computeBoundingSphere();

    parent.add(trunkMesh);
    parent.add(leafMesh);
  }
}
