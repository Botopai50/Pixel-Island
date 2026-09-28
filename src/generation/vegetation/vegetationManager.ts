import * as THREE from 'three';
import { VegetationTextures } from './vegetationTextures.ts';
import { GRASS_SPRITE_W, GRASS_SPRITE_H } from './grassSprites.ts';
import { BotanicalGeometryFactory } from './botanicalGeometryFactory.ts';
import { VegetationInstancePool } from './instancePool.ts';
import { FADE, FADE_GLSL } from '../shaders/fadeDither.ts';
import { planChunkVegetation, ITerrainQueryable, TreeTransformItem } from './vegetationPlanner.ts';

export type { ITerrainQueryable, TreeTransformItem } from './vegetationPlanner.ts';

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


/**
 * fade: faixa em que as instâncias somem com pontilhado (pela distância do pé de cada uma):
 * 'veg' no fim do raio da vegetação (pedras, arbustos, troncos: somem), 'tree' árvores (trocam seco
 * pelo impostor na mesma posição, no fim do raio), 'grass' no fim da grama 3D, 'none' sem.
 */
export function setupCartoonMaterial(mat: THREE.MeshLambertMaterial, fade: 'veg' | 'tree' | 'grass' | 'none' = 'veg'): THREE.MeshLambertMaterial {
  mat.onBeforeCompile = (shader) => {
    if (fade !== 'none') {
      shader.uniforms.uFadeCam = FADE.uFadeCam;
      shader.uniforms.uInstFade = fade === 'grass' ? FADE.uGrassFade : fade === 'tree' ? FADE.uTreeSwap : FADE.uVegFade;
      shader.vertexShader = 'uniform vec2 uFadeCam;\nvarying float vInstDist;\nvarying float vInstHash;\n' + FADE_GLSL + shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  vec2 instW = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;',
          '  vInstDist = distance(instW, uFadeCam);',
          // limiar por objeto (o mesmo do impostor da árvore, pela posição do pé)
          '  vInstHash = fadeHash(floor(instW * 4.0));',
          '#else',
          '  vInstDist = 0.0;',
          '  vInstHash = 0.0;',
          '#endif',
        ].join('\n')
      );
      // cada objeto some inteiro na sua própria distância dentro da faixa (sem pontilhado)
      shader.fragmentShader = 'uniform vec2 uInstFade;\nvarying float vInstDist;\nvarying float vInstHash;\n' + shader.fragmentShader.replace(
        'void main() {',
        'void main() {\n  if (vInstHash > 1.0 - smoothstep(uInstFade.x, uInstFade.y, vInstDist)) discard;'
      );
    }
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
      #if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
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
      #endif
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
            float bias0 = directionalLightShadows[0].shadowBias - 0.00004 * slopeFactor * (2048.0 / directionalLightShadows[0].shadowMapSize.x);
            clipmapShadow = sampleShadowSMSR( directionalShadowMap[0], c0.xy, c0.z + bias0, directionalLightShadows[0].shadowMapSize, dz_duv0 );
            sampled = true;
          }
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 2
          if (!sampled && c1.x >= 0.01 && c1.x <= 0.99 && c1.y >= 0.01 && c1.y <= 0.99 && c1.z <= 1.0) {
            float bias1 = directionalLightShadows[1].shadowBias - 0.00008 * slopeFactor * (2048.0 / directionalLightShadows[1].shadowMapSize.x);
            clipmapShadow = sampleShadowSMSR( directionalShadowMap[1], c1.xy, c1.z + bias1, directionalLightShadows[1].shadowMapSize, dz_duv1 );
            sampled = true;
          }
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 3
          if (!sampled && c2.x >= 0.01 && c2.x <= 0.99 && c2.y >= 0.01 && c2.y <= 0.99 && c2.z <= 1.0) {
            float bias2 = directionalLightShadows[2].shadowBias - 0.00016 * slopeFactor * (2048.0 / directionalLightShadows[2].shadowMapSize.x);
            clipmapShadow = sampleShadowSMSR( directionalShadowMap[2], c2.xy, c2.z + bias2, directionalLightShadows[2].shadowMapSize, dz_duv2 );
            sampled = true;
          }
          #endif
        }
        #endif

        // Sombra cartoon com silhueta analítica nítida de 2 tons (Zelda / Cel-Shading clássico)
        // Lado de costas pro sol: 30% (volume da copa). Sombra projetada: 0%, igual ao
        // terreno - senão a planta dentro da sombra de um morro fica mais clara que o chão.
        float NdotL = dot( geometryNormal, directLight.direction );
        float celIntensity = mix( 0.30, 1.0, step( 0.04, NdotL ) ) * clipmapShadow;

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

/**
 * Tufo de grama: dois planos cruzados (1.5m x 1.1m no tamanho 1), base em y=0, normais para
 * cima (a grama é iluminada como o chão, sem escurecer de lado).
 */
function buildGrassClumpGeometry(): THREE.BufferGeometry {
  const w = 0.75, h = 1.1;
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], plane: number[] = [], index: number[] = [];
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
    const b = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, h, dz, -dx, h, -dz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let n = 0; n < 4; n++) { nrm.push(0, 1, 0); plane.push(k); }
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  // 0 = primeiro plano, 1 = segundo (no modo "sempre de frente" o segundo é descartado)
  g.setAttribute('grassPlane', new THREE.Float32BufferAttribute(plane, 1));
  g.setIndex(index);
  return g;
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

  // Grama 3D (tufos de lâminas em pixel art) com balanço de vento no vertex shader
  private grassGeometry: THREE.BufferGeometry;
  /** Um material por formato de tufo (moita, alta, rasteira, espiga, tombada) em cada paleta */
  private grassMaterials: THREE.MeshLambertMaterial[];
  private dryGrassMaterials: THREE.MeshLambertMaterial[];
  private snowGrassMaterials: THREE.MeshLambertMaterial[];
  private readonly windTime = { value: 0 };
  // Quem empurra a grama ao passar (xyz = pés do personagem, w = raio; w = 0 desliga)
  private readonly grassPusher = { value: new THREE.Vector4(0, -9999, 0, 0) };
  private readonly grassBillboard = { value: 1 };

  /** Instâncias de todos os chunks, agrupadas por (geometria, material). Adicione `instances.root` à cena. */
  public readonly instances = new VegetationInstancePool();

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
    }), 'tree');

    this.birchTrunkMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: birchTex,
      color: 0xffffff,
      flatShading: false
    }), 'tree');

    this.palmTrunkMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: palmBarkTex,
      color: 0xffffff,
      flatShading: false
    }), 'tree');

    this.foliageMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: foliageTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }), 'tree');

    this.palmFrondMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: palmFrondTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }), 'tree');

    this.cactusMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: cactusTex,
      color: 0xffffff,
      flatShading: false
    }), 'tree');

    this.snowPineFoliageMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: snowFoliageTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }), 'tree');

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
    }), 'tree');

    this.grassGeometry = buildGrassClumpGeometry();
    this.grassMaterials = VegetationTextures.getGrassVariantTextures('green').map((t) => this.makeGrassMaterial(t));
    this.dryGrassMaterials = VegetationTextures.getGrassVariantTextures('dry').map((t) => this.makeGrassMaterial(t));
    this.snowGrassMaterials = VegetationTextures.getGrassVariantTextures('snow').map((t) => this.makeGrassMaterial(t));

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
    owner: number,
    enableDetailFlora: boolean = true
  ): void {
    const { oakItems, broadOakItems, oakSaplingItems, pineItems, pineSaplingItems, birchItems, twinBirchItems, birchSaplingItems, palmItems, palmSaplingItems, acaciaItems, acaciaSaplingItems, mapleItems, mangroveItems, mangroveSaplingItems, snowPineItems, arcticWillowItems, deadTreeTransforms, cactusTransforms, cactusSaplingTransforms, shrubLushTransforms, shrubBerryTransforms, rockBoulderTransforms, rockSlateTransforms, rockPebblesTransforms, rockSpireTransforms, rockMossyTransforms, logHollowTransforms, logRootedTransforms, logStumpTransforms, logStraightTransforms, fernTransforms, wildflowerTransforms, reedTransforms } = planChunkVegetation(chunkX, chunkZ, chunkSize, terrainGen, enableDetailFlora);

    // Instanciação em Pares de Árvores (Adultas, Mudas e Variantes)
    this.createInstancedPair(VegetationGeometries.oakTrunk, VegetationGeometries.oakLeaves, this.trunkMaterial, this.foliageMaterial, oakItems, owner);
    this.createInstancedPair(VegetationGeometries.broadOakTrunk, VegetationGeometries.broadOakLeaves, this.trunkMaterial, this.foliageMaterial, broadOakItems, owner);
    this.createInstancedPair(VegetationGeometries.oakSaplingTrunk, VegetationGeometries.oakSaplingLeaves, this.trunkMaterial, this.foliageMaterial, oakSaplingItems, owner);

    this.createInstancedPair(VegetationGeometries.pineTrunk, VegetationGeometries.pineLeaves, this.trunkMaterial, this.foliageMaterial, pineItems, owner);
    this.createInstancedPair(VegetationGeometries.pineSaplingTrunk, VegetationGeometries.pineSaplingLeaves, this.trunkMaterial, this.foliageMaterial, pineSaplingItems, owner);

    this.createInstancedPair(VegetationGeometries.birchTrunk, VegetationGeometries.birchLeaves, this.birchTrunkMaterial, this.foliageMaterial, birchItems, owner);
    this.createInstancedPair(VegetationGeometries.twinBirchTrunk, VegetationGeometries.twinBirchLeaves, this.birchTrunkMaterial, this.foliageMaterial, twinBirchItems, owner);
    this.createInstancedPair(VegetationGeometries.birchSaplingTrunk, VegetationGeometries.birchSaplingLeaves, this.birchTrunkMaterial, this.foliageMaterial, birchSaplingItems, owner);

    this.createInstancedPair(VegetationGeometries.palmTrunk, VegetationGeometries.palmLeaves, this.palmTrunkMaterial, this.palmFrondMaterial, palmItems, owner);
    this.createInstancedPair(VegetationGeometries.palmSaplingTrunk, VegetationGeometries.palmSaplingLeaves, this.palmTrunkMaterial, this.palmFrondMaterial, palmSaplingItems, owner);

    this.createInstancedPair(VegetationGeometries.acaciaTrunk, VegetationGeometries.acaciaLeaves, this.trunkMaterial, this.foliageMaterial, acaciaItems, owner);
    this.createInstancedPair(VegetationGeometries.acaciaSaplingTrunk, VegetationGeometries.acaciaSaplingLeaves, this.trunkMaterial, this.foliageMaterial, acaciaSaplingItems, owner);

    this.createInstancedPair(VegetationGeometries.mapleTrunk, VegetationGeometries.mapleLeaves, this.trunkMaterial, this.foliageMaterial, mapleItems, owner);

    this.createInstancedPair(VegetationGeometries.mangroveTrunk, VegetationGeometries.mangroveLeaves, this.trunkMaterial, this.foliageMaterial, mangroveItems, owner);
    this.createInstancedPair(VegetationGeometries.mangroveSaplingTrunk, VegetationGeometries.mangroveSaplingLeaves, this.trunkMaterial, this.foliageMaterial, mangroveSaplingItems, owner);

    this.createInstancedPair(VegetationGeometries.snowPineTrunk, VegetationGeometries.snowPineLeaves, this.trunkMaterial, this.snowPineFoliageMaterial, snowPineItems, owner);
    this.createInstancedPair(VegetationGeometries.arcticWillowTrunk, VegetationGeometries.arcticWillowLeaves, this.trunkMaterial, this.foliageMaterial, arcticWillowItems, owner);

    // Instanciação de Meshes Individuais
    const createSingle = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { matrix: THREE.Matrix4; tint: THREE.Color }[], name?: string) => {
      if (list.length === 0) return;
      this.instances.add(owner, geo, mat, list.map((it) => it.matrix), list.map((it) => it.tint), name);
    };

    createSingle(VegetationGeometries.deadTrunk, this.deadTreeMaterial, deadTreeTransforms, 'deadTrunk');
    createSingle(VegetationGeometries.cactusBody, this.cactusMaterial, cactusTransforms, 'cactusBody');
    createSingle(VegetationGeometries.cactusSaplingBody, this.cactusMaterial, cactusSaplingTransforms, 'cactusSapling');
    createSingle(VegetationGeometries.shrubLush, this.shrubMaterial, shrubLushTransforms, 'shrubLush');
    createSingle(VegetationGeometries.shrubBerry, this.shrubMaterial, shrubBerryTransforms, 'shrubBerry');

    // Rochas variadas (5 Formatos)
    createSingle(VegetationGeometries.rockBoulder, this.rockMaterial, rockBoulderTransforms, 'rockBoulder');
    createSingle(VegetationGeometries.rockSlate, this.rockMaterial, rockSlateTransforms, 'rockSlate');
    createSingle(VegetationGeometries.rockPebbles, this.rockMaterial, rockPebblesTransforms, 'rockPebbles');
    createSingle(VegetationGeometries.rockSpire, this.rockMaterial, rockSpireTransforms, 'rockSpire');
    createSingle(VegetationGeometries.rockMossy, this.rockMaterial, rockMossyTransforms, 'rockMossy');

    // Madeira caída variada (4 Formatos)
    createSingle(VegetationGeometries.logHollow, this.logMaterial, logHollowTransforms);
    createSingle(VegetationGeometries.logRooted, this.logMaterial, logRootedTransforms);
    createSingle(VegetationGeometries.logStump, this.logMaterial, logStumpTransforms);
    createSingle(VegetationGeometries.fallenLog, this.logMaterial, logStraightTransforms);

    // Sub-bosque e flora rasteira
    createSingle(VegetationGeometries.groundFern, this.groundFloraMaterial, fernTransforms);
    createSingle(VegetationGeometries.wildflowers, this.groundFloraMaterial, wildflowerTransforms);
    createSingle(VegetationGeometries.reeds, this.groundFloraMaterial, reedTransforms);
  }

  private createInstancedPair(
    trunkGeo: THREE.BufferGeometry,
    leafGeo: THREE.BufferGeometry,
    trunkMat: THREE.Material,
    leafMat: THREE.Material,
    items: TreeTransformItem[],
    owner: number
  ): void {
    if (items.length === 0) return;
    const matrices = items.map((it) => it.matrix);
    this.instances.add(owner, trunkGeo, trunkMat, matrices, items.map((it) => it.trunkTint));
    this.instances.add(owner, leafGeo, leafMat, matrices, items.map((it) => it.leafTint));
  }

  /** Material dos tufos de grama: luz toon da vegetação + vento + abertura ao passar do personagem. */
  private makeGrassMaterial(map: THREE.Texture): THREE.MeshLambertMaterial {
    const mat = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map,
      color: 0xffffff,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
    }), 'grass');
    const cartoon = mat.onBeforeCompile;
    const windTime = this.windTime;
    const pusher = this.grassPusher;
    const billboard = this.grassBillboard;
    mat.onBeforeCompile = (shader, renderer) => {
      cartoon.call(mat, shader, renderer);
      shader.uniforms.uWindTime = windTime;
      shader.uniforms.uGrassPusher = pusher;
      shader.uniforms.uGrassBillboard = billboard;
      shader.vertexShader = 'uniform float uWindTime;\nuniform vec4 uGrassPusher;\nuniform float uGrassBillboard;\nattribute float grassPlane;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '// Vento: só as pontas balançam (a base fica presa no chão), fase pela posição do tufo',
          '#ifdef USE_INSTANCING',
          '  vec2 wpos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
          '#else',
          '  vec2 wpos = vec2(0.0);',
          '#endif',
          'float sway = sin(uWindTime * 1.8 + wpos.x * 0.35 + wpos.y * 0.21) * 0.5',
          '           + sin(uWindTime * 3.1 + wpos.x * 0.9) * 0.2;',
          'transformed.x += sway * 0.07 * position.y;',
          'transformed.z += sway * 0.04 * position.y;',
        ].join('\n')
      ).replace(
        '#include <project_vertex>',
        [
          'vec4 mvPosition = vec4( transformed, 1.0 );',
          '#ifdef USE_INSTANCING',
          '  mvPosition = instanceMatrix * mvPosition;',
          '  if (uGrassBillboard > 0.5) {',
          '    // Um plano só, sempre de frente para a câmera: gira em volta do eixo vertical (o tufo',
          '    // continua em pé); com a câmera olhando de cima, o topo pende para longe dela, de modo',
          '    // que a face do tufo fique virada para a câmera em vez de aparecer achatada',
          '    vec3 bBase = instanceMatrix[3].xyz;',
          '    float sW = length(instanceMatrix[0].xyz), sH = length(instanceMatrix[1].xyz);',
          '    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);',
          '    vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);',
          '    vec2 rH = length(camRight.xz) > 1e-4 ? normalize(camRight.xz) : vec2(1.0, 0.0);',
          '    vec2 bAway = length(camFwd.xz) > 1e-4 ? normalize(camFwd.xz) : vec2(0.0, 1.0);   // para longe da câmera',
          '    float tiltA = asin(clamp(-camFwd.y, 0.0, 1.0)) * 0.75;   // 75% da inclinação da câmera',
          '    vec3 upV = vec3(bAway.x * sin(tiltA), cos(tiltA), bAway.y * sin(tiltA));',
          '    float xL = (uv.x * 2.0 - 1.0) * 0.75, yL = position.y;',
          '    vec3 wp = bBase + vec3(rH.x, 0.0, rH.y) * xL * sW + upV * yL * sH;',
          '    wp.x += sway * 0.07 * yL * sH;',
          '    wp.z += sway * 0.04 * yL * sH;',
          '    mvPosition = vec4(grassPlane > 0.5 ? bBase : wp, 1.0);',
          '  }',
          '  // Personagem passando: as lâminas perto dele se afastam e abaixam (pontas mais que a base)',
          '  vec3 tuftBase = instanceMatrix[3].xyz;',
          '  vec2 away = tuftBase.xz - uGrassPusher.xz;',
          '  float dist = length(away);',
          '  float near = uGrassPusher.w > 0.0 ? 1.0 - smoothstep(uGrassPusher.w * 0.35, uGrassPusher.w, dist) : 0.0;',
          '  near *= 1.0 - smoothstep(1.0, 2.5, abs(tuftBase.y - uGrassPusher.y));',
          '  float tipW = clamp(position.y / 1.1, 0.0, 1.0);',
          '  vec2 dir = dist > 0.001 ? away / dist : vec2(1.0, 0.0);',
          '  float bend = near * tipW * tipW;',
          '  mvPosition.xz += dir * bend * uGrassPusher.w * 0.9;',
          '  mvPosition.y -= bend * uGrassPusher.w * 0.45;',
          '#endif',
          'mvPosition = modelViewMatrix * mvPosition;',
          'gl_Position = projectionMatrix * mvPosition;',
        ].join('\n')
      );
    };
    // Recorte do alfa estável de longe: compensa o alfa que os mipmaps espalham (senão os fios
    // afinavam e sumiam à distância) e deixa a borda do recorte com ~1 pixel de tela (sem o
    // chiado de pixels acendendo e apagando ao mover a câmera). De perto fica igual ao recorte seco.
    const prevCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      prevCompile.call(mat, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        [
          '#ifdef USE_MAP',
          '  vec2 texPx = vMapUv * vec2(' + GRASS_SPRITE_W.toFixed(1) + ', ' + GRASS_SPRITE_H.toFixed(1) + ');',
          '  vec2 ddx = dFdx(texPx), ddy = dFdy(texPx);',
          '  float mipLvl = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));',
          '  diffuseColor.a *= 1.0 + mipLvl * 0.25;',
          '  diffuseColor.a = (diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 0.0001) + 0.5;',
          '#endif',
          'if (diffuseColor.a < 0.5) discard;',
        ].join('\n')
      );
    };
    mat.customProgramCacheKey = () => 'pixel_grass_wind_bb_aa';
    return mat;
  }

  /** Grama 3D em um plano só, sempre de frente para a câmera (true) ou dois planos cruzados. */
  public setGrassBillboard(on: boolean): void {
    this.grassBillboard.value = on ? 1 : 0;
  }

  /** Personagem que empurra a grama (pés em x, y, z; raio em metros). radius = 0 desliga. */
  public setGrassPusher(x: number, y: number, z: number, radius: number): void {
    this.grassPusher.value.set(x, y, z, radius);
  }

  /** Avança o vento da grama. */
  public update(dt: number): void {
    this.windTime.value += dt;
  }

  /**
   * Planta os tufos de grama 3D de um chunk (dados do worker: x, y, z, escala, bioma, dh/dx,
   * dh/dz). Cada tufo gira para acompanhar a inclinação do chão (base encostada dos dois lados)
   * e afunda um pouco para não aparecer fresta. Cor por bioma via tint.
   */
  public populateGrass(owner: number, data: Float32Array): void {
    if (!data.length) return;
    const TINTS = [
      new THREE.Color(1.0, 1.0, 1.0),    // temperado: paleta da própria textura
      new THREE.Color(0.55, 0.42, 0.34), // vulcão: capim seco queimado
      new THREE.Color(0.72, 0.88, 0.86), // polar: verde-azulado frio, com geada
      new THREE.Color(1.0, 0.92, 0.55),  // deserto: palha
    ];
    // Listas por (paleta, formato)
    const NV = this.grassMaterials.length;
    const mk = () => Array.from({ length: NV }, () => ({ m: [] as THREE.Matrix4[], c: [] as THREE.Color[] }));
    const green = mk(), snow = mk(), dry = mk();
    // Proporção dos formatos: moita 32%, alta 20%, rasteira 20%, espiga 12%, tombada 16%
    const CUM = [0.32, 0.52, 0.72, 0.84, 1.0];
    const white = new THREE.Color(1, 1, 1);
    const dryTint = new THREE.Color(0.78, 0.52, 0.34);
    const burntTint = new THREE.Color(0.62, 0.50, 0.42);
    const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
    const yaw = new THREE.Quaternion(), tilt = new THREE.Quaternion(), q = new THREE.Quaternion();
    for (let k = 0; k + 8 < data.length; k += 9) {
      const s = data[k + 3];
      const sy = s * data[k + 7], sxz = s * data[k + 8];
      normal.set(-data[k + 5], 1, -data[k + 6]).normalize();
      tilt.setFromUnitVectors(up, normal);
      yaw.setFromAxisAngle(up, (data[k] * 12.9898 + data[k + 2] * 78.233) % (Math.PI * 2));
      q.copy(tilt).multiply(yaw);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(data[k], data[k + 1] - 0.04 * s, data[k + 2]), q, new THREE.Vector3(sxz, sy, sxz)
      );
      // Bioma de gelo (2): tufo nevado próprio, com a cor da textura
      // (alguns tufos de capim seco marrom no meio do congelado, como na referência)
      // Vulcão (1): capim seco próprio (palha / marrom queimado)
      // Formato do tufo sorteado pela posição (estável entre recarregamentos)
      const hv = ((data[k] * 3.917 + data[k + 2] * 7.411) % 1 + 1) % 1;
      let v = 0; while (v < NV - 1 && hv >= CUM[v]) v++;
      if ((data[k + 4] | 0) === 1) {
        dry[v].m.push(m);
        dry[v].c.push(((data[k] * 5.17 + data[k + 2] * 2.39) % 1 + 1) % 1 < 0.35 ? burntTint : white);
      } else if ((data[k + 4] | 0) === 2) {
        snow[v].m.push(m);
        snow[v].c.push(((data[k] * 7.13 + data[k + 2] * 3.71) % 1 + 1) % 1 < 0.15 ? dryTint : white);
      }
      else { green[v].m.push(m); green[v].c.push(TINTS[data[k + 4] | 0] ?? TINTS[0]); }
    }
    // Grama não projeta sombra (só recebe a das árvores e do relevo)
    for (let v = 0; v < NV; v++) {
      this.instances.add(owner, this.grassGeometry, this.grassMaterials[v], green[v].m, green[v].c, 'grass', false);
      this.instances.add(owner, this.grassGeometry, this.snowGrassMaterials[v], snow[v].m, snow[v].c, 'grass', false);
      this.instances.add(owner, this.grassGeometry, this.dryGrassMaterials[v], dry[v].m, dry[v].c, 'grass', false);
    }
  }

  /** Remove todas as instâncias que um chunk adicionou. */
  public releaseChunk(owner: number): void {
    this.instances.remove(owner);
  }

  /**
   * Atlas de impostores das árvores distantes: cada espécie (na ordem de IMPOSTOR_TYPES) é
   * desenhada de lado, uma vez, com a geometria, a textura e a tinta originais, numa célula
   * quadrada. Luz ambiente pura (= cor do material): a luz da cena é aplicada depois, no material
   * do horizonte, com a mesma iluminação cartoon das árvores de perto.
   * info: por tipo (lado do quadrado S, centro x, centro y) em metros, escala 1.
   */
  public buildTreeImpostors(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; info: THREE.Vector3[]; cols: number; rows: number } {
    VegetationGeometries.init();
    const G = VegetationGeometries;
    // [geometria do tronco/corpo, da copa (ou null), materiais, tinta do tronco, da copa]
    const specs: [THREE.BufferGeometry, THREE.BufferGeometry | null, THREE.Material, THREE.Material | null, number, number][] = [
      [G.oakTrunk, G.oakLeaves, this.trunkMaterial, this.foliageMaterial, 0x5c422d, 0x48aa32],
      [G.broadOakTrunk, G.broadOakLeaves, this.trunkMaterial, this.foliageMaterial, 0x563e2a, 0x429c2c],
      [G.pineTrunk, G.pineLeaves, this.trunkMaterial, this.foliageMaterial, 0x4a3424, 0x2a7238],
      [G.birchTrunk, G.birchLeaves, this.birchTrunkMaterial, this.foliageMaterial, 0xf0f0ea, 0x6ec430],
      [G.palmTrunk, G.palmLeaves, this.palmTrunkMaterial, this.palmFrondMaterial, 0xa68252, 0x4cb828],
      [G.acaciaTrunk, G.acaciaLeaves, this.trunkMaterial, this.foliageMaterial, 0x4c3826, 0x6e9c2e],
      [G.mapleTrunk, G.mapleLeaves, this.trunkMaterial, this.foliageMaterial, 0x4c3828, 0xd44022],
      [G.mapleTrunk, G.mapleLeaves, this.trunkMaterial, this.foliageMaterial, 0x4c3828, 0xe87a1a],
      [G.mapleTrunk, G.mapleLeaves, this.trunkMaterial, this.foliageMaterial, 0x4c3828, 0xe8b824],
      [G.mangroveTrunk, G.mangroveLeaves, this.trunkMaterial, this.foliageMaterial, 0x3e2d1f, 0x348c2c],
      [G.snowPineTrunk, G.snowPineLeaves, this.trunkMaterial, this.snowPineFoliageMaterial, 0x3c2c22, 0xffffff],
      [G.arcticWillowTrunk, G.arcticWillowLeaves, this.trunkMaterial, this.foliageMaterial, 0x44362a, 0x72927c],
      [G.deadTrunk, null, this.deadTreeMaterial, null, 0x22201e, 0x22201e],
      [G.cactusBody, null, this.cactusMaterial, null, 0x4e8e42, 0x4e8e42],
      [G.cactusSaplingBody, null, this.cactusMaterial, null, 0x5ca850, 0x5ca850],
    ];
    const CELL = 128, cols = 4, rows = Math.ceil(specs.length / cols);
    const rt = new THREE.WebGLRenderTarget(CELL * cols, CELL * rows, {
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.NearestFilter, generateMipmaps: true,
      colorSpace: THREE.SRGBColorSpace, depthBuffer: true,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    rt.scissorTest = true;
    const info: THREE.Vector3[] = [];
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    specs.forEach(([tg, lg, tm, lm, tc, lc], i) => {
      tg.computeBoundingBox();
      box.copy(tg.boundingBox!);
      if (lg) { lg.computeBoundingBox(); box.union(tmp.copy(lg.boundingBox!)); }
      const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
      const S = Math.max(w, h) * 1.04;
      const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
      info.push(new THREE.Vector3(S, cx, cy));
      cam.left = -S / 2; cam.right = S / 2; cam.top = S / 2; cam.bottom = -S / 2;
      cam.position.set(cx, cy, 100); cam.lookAt(cx, cy, 0);
      cam.updateProjectionMatrix();
      const meshes = [new THREE.InstancedMesh(tg, tm, 1)];
      meshes[0].setMatrixAt(0, new THREE.Matrix4()); meshes[0].setColorAt(0, new THREE.Color(tc));
      if (lg && lm) {
        meshes.push(new THREE.InstancedMesh(lg, lm, 1));
        meshes[1].setMatrixAt(0, new THREE.Matrix4()); meshes[1].setColorAt(0, new THREE.Color(lc));
      }
      for (const m of meshes) { m.frustumCulled = false; scene.add(m); }
      const x = (i % cols) * CELL, y = Math.floor(i / cols) * CELL;
      rt.viewport.set(x, y, CELL, CELL);
      rt.scissor.set(x, y, CELL, CELL);
      renderer.setRenderTarget(rt);
      // fundo transparente com a cor da copa (as bordas filtradas não escurecem)
      renderer.setClearColor(new THREE.Color(lc).multiplyScalar(0.55), 0);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      for (const m of meshes) { scene.remove(m); m.dispose(); }
    });
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAutoClear;
    return { texture: rt.texture, info, cols, rows };
  }
}
