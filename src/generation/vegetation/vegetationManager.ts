import * as THREE from 'three';
import { VegetationTextures } from './vegetationTextures.ts';
import { BotanicalGeometryFactory } from './botanicalGeometryFactory.ts';
import { VegetationInstancePool } from './instancePool.ts';
import { FADE, FADE_GLSL } from '../shaders/fadeDither.ts';
import { SHADOW_GRID } from '../../atmosphere/atmosphericFog.ts';
import { WIND_U, GRASS_PUSHER } from '../../atmosphere/wind.ts';
import { planChunkVegetation, planChunkVegetationGen, ITerrainQueryable } from './vegetationPlanner.ts';
import { MD, mergeVariantGeometries, makeMdMaterials } from './multiDraw.ts';
import type { MultiSpec } from './instancePool.ts';
import { getGameTrees, tickGameTrees, singleLodKind, GameTreeKind } from './pixelTrees/gameTrees.ts';
import type { GameTreeLod, GameTreeVariant } from './pixelTrees/gameTrees.ts';

/** O desenho leve (3º degrau) que faz o papel de uma parte que projeta sombra nas faixas de sombra distantes: a n-ésima parte que projeta sombra do degrau. */
function shadowLiteOf(lod: GameTreeLod, lightest: GameTreeLod, partIndex: number): THREE.BufferGeometry | null {
  const part = lod.parts[partIndex];
  if (!part || !part.castShadow) return null;
  const nth = lod.parts.slice(0, partIndex).filter((p) => p.castShadow).length;
  const lite = lightest.parts.filter((p) => p.castShadow)[nth];
  return lite && lite.geometry !== part.geometry ? lite.geometry : null;
}
import { GRASS_SPRITE_W, GRASS_SPRITE_H } from './grassSprites.ts';
import { enableAssetEnvironment } from './pixelTrees/services/assetEnvironment';
import { getStoneLanternParts } from './structures/stoneLanternParts.ts';
import type { LanternPart } from './structures/stoneLanternParts.ts';

/** Um lugar de árvore: a matriz e (nas árvores do plano) a cor da copa. */
interface GameTreeItem { matrix: THREE.Matrix4; leafTint?: THREE.Color }
/** O bordo que mais se parece com a cor da copa do item (vermelho, laranja ou amarelo). */
const mapleKind = (it: GameTreeItem): GameTreeKind => {
  const t = it.leafTint;
  if (!t) return 'mapleRed';
  const d = (c: number) => { const o = new THREE.Color(c); return (o.r - t.r) ** 2 + (o.g - t.g) ** 2 + (o.b - t.b) ** 2; };
  const r = d(0xd44022), o = d(0xe87a1a), y = d(0xe8b824);
  return r <= o && r <= y ? 'mapleRed' : o <= y ? 'mapleOrange' : 'mapleYellow';
};

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
  public static lilyPads: THREE.BufferGeometry;
  public static petalCarpet: THREE.BufferGeometry;
  /** Lanterna de pedra do pacote gerador-lanterna-de-pedra: pedra, madeira, placas e núcleo, cada um com o seu material (structures/stoneLanternParts.ts) */
  public static stoneLanternParts: LanternPart[];
  public static barrelCactus: THREE.BufferGeometry;
  public static pricklyPear: THREE.BufferGeometry;
  public static tumbleweed: THREE.BufferGeometry;
  public static duckweed: THREE.BufferGeometry;
  public static mudMound: THREE.BufferGeometry;

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
    this.lilyPads = BotanicalGeometryFactory.buildLilyPads().body;
    this.petalCarpet = BotanicalGeometryFactory.buildPetalCarpet().body;
    this.stoneLanternParts = getStoneLanternParts();
    this.barrelCactus = BotanicalGeometryFactory.buildBarrelCactus().body;
    this.pricklyPear = BotanicalGeometryFactory.buildPricklyPear().body;
    this.tumbleweed = BotanicalGeometryFactory.buildTumbleweed().body;
    this.duckweed = BotanicalGeometryFactory.buildDuckweed().body;
    this.mudMound = BotanicalGeometryFactory.buildMudMound().body;

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
/**
 * Copas, folhas e arbustos balançando com o vento do mundo (wind.ts): o deslocamento cresce com a
 * altura acima do pé da planta (o tronco/pé não mexe), com uma onda que atravessa a mata na
 * direção do vento e uma oscilação própria por planta. amp: força (por material, uniform).
 */
export function addCanopySway(mat: THREE.MeshLambertMaterial, amp: number): THREE.MeshLambertMaterial {
  const prev = mat.onBeforeCompile;
  const uAmp = { value: amp };
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, WIND_U);
    shader.uniforms.uSwayAmp = uAmp;
    shader.vertexShader = 'uniform vec2 uWindDir;\nuniform float uWindStr;\nuniform float uWindT;\nuniform float uSwayAmp;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '{',
        '  vec3 swBase = instanceMatrix[3].xyz;',
        '  float swS2 = max(dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz), 1e-4);',
        '  float swH = max((instanceMatrix * vec4(transformed, 1.0)).y - swBase.y, 0.0);',
        '  float swPh = dot(swBase.xz, vec2(0.13, 0.17));',
        '  float swWave = smoothstep(-0.3, 1.0, sin(dot(swBase.xz, uWindDir) * 0.07 - uWindT * 1.5));',
        '  float swAmt = (0.35 + 0.65 * swWave) * uWindStr * (0.65 + 0.35 * sin(uWindT * 2.1 + swPh));',
        '  vec3 swOffW = vec3(uWindDir.x, 0.0, uWindDir.y) * swAmt * uSwayAmp * swH * swH / (1.0 + swH);',
        // mundo -> local da instância (rotação + escala uniforme: inversa = transposta / escala²)
        '  transformed += transpose(mat3(instanceMatrix)) * swOffW / swS2;',
        '}',
        '#endif',
      ].join('\n')
    );
  };
  return mat;
}

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

    // Sombra na grade de pixels da TEXTURA de cada objeto (como o chão, terrainShader.ts): a
    // coordenada de sombra é tomada no ponto do mundo que fica no centro do pixel da textura
    // (achado pelas derivadas de tela da posição e do UV), então cada pixel do tronco, das folhas
    // ou da pedra fica inteiro na sombra ou na luz e a borda vira degraus do tamanho dos pixels.
    const vegGridFns = /* glsl */ `
      #if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
      uniform mat4 uSM[ 3 ];
      uniform vec3 uSNB;
      uniform float uShadowGrid;
      varying vec3 vVegWP;
      vec3 vegSnapPos() {
        #ifdef USE_MAP
        vec2 ts = vec2(textureSize(map, 0));
        vec2 duv = (floor(vMapUv * ts) + 0.5) / ts - vMapUv;
        vec3 dpx = dFdx(vVegWP), dpy = dFdy(vVegWP);
        vec2 dux = dFdx(vMapUv), duy = dFdy(vMapUv);
        float det = dux.x * duy.y - dux.y * duy.x;
        if (abs(det) > 1e-14) {
          float a = clamp((duv.x * duy.y - duv.y * duy.x) / det, -4.0, 4.0);
          float b = clamp((dux.x * duv.y - dux.y * duv.x) / det, -4.0, 4.0);
          return vVegWP + a * dpx + b * dpy;
        }
        #endif
        return vVegWP;
      }
      #endif
    `;

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
      THREE.ShaderChunk.shadowmap_pars_fragment + smsrFunction + vegGridFns
    );
    // posição no mundo (com a instância) para a sombra na grade de pixels da textura
    Object.assign(shader.uniforms, SHADOW_GRID);
    shader.vertexShader = 'varying vec3 vVegWP;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n#ifdef USE_SHADOWMAP\n  vVegWP = worldPosition.xyz;\n#endif'
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

          // ponto da sombra no centro do pixel da textura (com o normalBias de cada faixa)
          vec3 vegNW = normalize(inverseTransformDirection(geometryNormal, viewMatrix));
          vec3 vegSP = vegSnapPos();
          bool vegGrid = uShadowGrid > 0.5;
          #if NUM_DIR_LIGHT_SHADOWS >= 1
          // + ~30cm para fora da superfície: o objeto não se sombreia (ele entra no mapa pelos dois lados)
          vec4 sc0 = vegGrid ? uSM[0] * vec4(vegSP + vegNW * (uSNB.x + 0.3), 1.0) : vDirectionalShadowCoord[0];
          vec3 c0 = sc0.xyz / sc0.w;
          vec2 dz_duv0 = computeReceiverPlaneDepthSlope(c0);
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 2
          vec4 sc1 = vegGrid ? uSM[1] * vec4(vegSP + vegNW * (uSNB.y + 0.3), 1.0) : vDirectionalShadowCoord[1];
          vec3 c1 = sc1.xyz / sc1.w;
          vec2 dz_duv1 = computeReceiverPlaneDepthSlope(c1);
          #endif
          #if NUM_DIR_LIGHT_SHADOWS >= 3
          vec4 sc2 = vegGrid ? uSM[2] * vec4(vegSP + vegNW * (uSNB.z + 0.3), 1.0) : vDirectionalShadowCoord[2];
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

/** Tamanho das árvores do jogo em relação ao desenho antigo (o cacto de antes era alto demais: ~7 m). */
const KIND_SIZE: Partial<Record<GameTreeKind, number>> = { cactus: 0.6, willow: 2.0 };

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
  public groundFloraMaterial: THREE.MeshLambertMaterial;

  // Grama 3D (tufos de lâminas em pixel art) com balanço de vento no vertex shader
  private grassGeometry: THREE.BufferGeometry;
  /** Um material por formato de tufo (moita, alta, rasteira, espiga, tombada) em cada paleta */
  private grassMaterials: THREE.MeshLambertMaterial[];
  private dryGrassMaterials: THREE.MeshLambertMaterial[];
  private snowGrassMaterials: THREE.MeshLambertMaterial[];
  private marshGrassMaterials: THREE.MeshLambertMaterial[];
  /** capim próprio dos biomas (selva, taiga, savana, outono, cerejeiras, tundra, deserto) */
  private styleGrassMaterials = new Map<string, THREE.MeshLambertMaterial[]>();
  private readonly windTime = { value: 0 };
  // Quem empurra a grama ao passar (xyz = pés do personagem, w = raio; w = 0 desliga)
  private readonly grassPusher = GRASS_PUSHER;
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

    // Objetos sólidos entram no mapa de sombra pelos dois lados: só com as faces de trás (o padrão
    // do three.js) a sombra do tronco/pedra começava longe da base, deixando uma fresta iluminada
    // no pé. A auto-sombra que isso traria é evitada no shader (o ponto da sombra sai ~30cm da
    // superfície, vegGridFns em setupCartoonMaterial).
    // copas, folhas e arbustos balançam com o vento do mundo
    addCanopySway(this.foliageMaterial, 0.022);
    addCanopySway(this.palmFrondMaterial, 0.03);
    addCanopySway(this.snowPineFoliageMaterial, 0.016);
    addCanopySway(this.shrubMaterial, 0.07);

    for (const m of [this.trunkMaterial, this.birchTrunkMaterial, this.palmTrunkMaterial, this.cactusMaterial,
      this.rockMaterial, this.logMaterial, this.deadTreeMaterial]) m.shadowSide = THREE.DoubleSide;

    this.grassGeometry = buildGrassClumpGeometry();
    this.grassMaterials = VegetationTextures.getGrassVariantTextures('green').map((t) => this.makeGrassMaterial(t));
    this.dryGrassMaterials = VegetationTextures.getGrassVariantTextures('dry').map((t) => this.makeGrassMaterial(t));
    this.snowGrassMaterials = VegetationTextures.getGrassVariantTextures('snow').map((t) => this.makeGrassMaterial(t));
    this.marshGrassMaterials = VegetationTextures.getGrassVariantTextures('marsh').map((t) => this.makeGrassMaterial(t));
    for (const st of ['jungle', 'taiga', 'savanna', 'autumn', 'sakura', 'tundra', 'desert'] as const) {
      this.styleGrassMaterials.set(st, VegetationTextures.getGrassVariantTextures(st).map((t) => this.makeGrassMaterial(t)));
    }

    this.groundFloraMaterial = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: foliageTex,
      color: 0xffffff,
      flatShading: false,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide
    }));
  }

  /** 1ª metade de plantar um chunk: só o plano (onde cada coisa nasce). Separada da 2ª para cada uma caber num quadro sem estourar o orçamento. */
  public planChunk(chunkX: number, chunkZ: number, chunkSize: number, terrainGen: ITerrainQueryable, enableDetailFlora: boolean = true): ReturnType<typeof planChunkVegetation> {
    return planChunkVegetation(chunkX, chunkZ, chunkSize, terrainGen, enableDetailFlora);
  }

  /** o mesmo plano, como gerador (cada next() planta um ponto da grade): quem chama fatia o trabalho em vários quadros */
  public planChunkGen(chunkX: number, chunkZ: number, chunkSize: number, terrainGen: ITerrainQueryable, enableDetailFlora: boolean = true): ReturnType<typeof planChunkVegetationGen> {
    return planChunkVegetationGen(chunkX, chunkZ, chunkSize, terrainGen, enableDetailFlora);
  }

  /** instancia o plano de um chunk como gerador (cede a vez a cada espécie): quem chama fatia o trabalho em vários quadros */
  public *populateChunkGen(
    chunkX: number,
    chunkZ: number,
    chunkSize: number,
    terrainGen: ITerrainQueryable,
    owner: number,
    enableDetailFlora: boolean = true,
    plan?: ReturnType<typeof planChunkVegetation>
  ): Generator<undefined, void, unknown> {
    const { oakItems, broadOakItems, oakSaplingItems, pineItems, pineSaplingItems, birchItems, twinBirchItems, birchSaplingItems, palmItems, palmSaplingItems, acaciaItems, acaciaSaplingItems, mapleItems, mangroveItems, mangroveSaplingItems, snowPineItems, arcticWillowItems, sakuraItems, korokItems, deadTreeTransforms, cactusTransforms, cactusSaplingTransforms, shrubItems, rockBoulderTransforms, rockSlateTransforms, rockPebblesTransforms, rockSpireTransforms, rockMossyTransforms, logHollowTransforms, logRootedTransforms, logStumpTransforms, logStraightTransforms, lilyTransforms, duckTransforms, moundTransforms, barrelTransforms, pearTransforms, tumbleTransforms, petalTransforms, lanternTransforms } = plan ?? planChunkVegetation(chunkX, chunkZ, chunkSize, terrainGen, enableDetailFlora);

    // Instanciação em Pares de Árvores (Adultas, Mudas e Variantes)
    this.createGameTrees('oak', VegetationGeometries.oakTrunk, VegetationGeometries.oakLeaves, oakItems, owner);
    yield;
    this.createGameTrees('oak', VegetationGeometries.broadOakTrunk, VegetationGeometries.broadOakLeaves, broadOakItems, owner);
    yield;
    // mudas do Pixel_Tree: no tamanho do próprio desenho (o planejador já dá a escala de muda)
    this.createGameTrees('oakSapling', null, null, oakSaplingItems, owner);
    yield;

    this.createGameTrees('pine', VegetationGeometries.pineTrunk, VegetationGeometries.pineLeaves, pineItems, owner);
    yield;
    this.createGameTrees('pineSapling', null, null, pineSaplingItems, owner);
    yield;

    this.createGameTrees('birch', VegetationGeometries.birchTrunk, VegetationGeometries.birchLeaves, birchItems, owner);
    yield;
    this.createGameTrees('birch', VegetationGeometries.twinBirchTrunk, VegetationGeometries.twinBirchLeaves, twinBirchItems, owner);
    yield;
    this.createGameTrees('birchSapling', null, null, birchSaplingItems, owner);
    yield;

    this.createGameTrees('palm', VegetationGeometries.palmTrunk, VegetationGeometries.palmLeaves, palmItems, owner);
    yield;
    this.createGameTrees('palmSapling', null, null, palmSaplingItems, owner);
    yield;

    this.createGameTrees('acacia', VegetationGeometries.acaciaTrunk, VegetationGeometries.acaciaLeaves, acaciaItems, owner);
    yield;
    this.createGameTrees('acaciaSapling', null, null, acaciaSaplingItems, owner);
    yield;

    this.createGameTrees(mapleKind, VegetationGeometries.mapleTrunk, VegetationGeometries.mapleLeaves, mapleItems, owner);
    yield;

    this.createGameTrees('mangrove', VegetationGeometries.mangroveTrunk, VegetationGeometries.mangroveLeaves, mangroveItems, owner);
    yield;
    this.createGameTrees('mangroveSapling', null, null, mangroveSaplingItems, owner);
    yield;

    this.createGameTrees('snowPine', VegetationGeometries.snowPineTrunk, VegetationGeometries.snowPineLeaves, snowPineItems, owner);
    yield;
    // salgueiro-anão: no tamanho do próprio desenho (uma moita rasteira, larga e achatada), e não na altura do antigo
    this.createGameTrees('willow', null, null, arcticWillowItems, owner);
    yield;
    // cerejeiras e árvores ancestrais: não existiam antes, então não há desenho antigo para igualar
    this.createGameTrees('sakura', null, null, sakuraItems, owner);
    yield;
    this.createGameTrees('korok', null, null, korokItems, owner);
    yield;

    // Instanciação de Meshes Individuais
    const createSingle = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { matrix: THREE.Matrix4; tint: THREE.Color }[], name?: string) => {
      if (list.length === 0) return;
      this.instances.add(owner, geo, mat, list.map((it) => it.matrix), list.map((it) => it.tint), name);
    };

    // árvore seca: no tamanho da própria árvore (o toco antigo era um cotoco de ~1 m)
    this.createGameTrees('dead', null, null, deadTreeTransforms.map((t) => ({ matrix: t.matrix })), owner);
    yield;
    this.createGameTrees('cactus', VegetationGeometries.cactusBody, null, cactusTransforms.map((t) => ({ matrix: t.matrix })), owner);
    yield;
    this.createGameTrees('cactusSapling', null, null, cactusSaplingTransforms.map((t) => ({ matrix: t.matrix })), owner);
    yield;
    // arbustos do Pixel_Tree (a espécie de cada um vem do clima do lugar)
    this.createGameTrees((it) => (it as GameTreeItem & { kind: GameTreeKind }).kind, null, null, shrubItems as unknown as GameTreeItem[], owner);
    yield;

    // Rochas variadas (5 Formatos)
    createSingle(VegetationGeometries.rockBoulder, this.rockMaterial, rockBoulderTransforms, 'rockBoulder');
    yield;
    createSingle(VegetationGeometries.rockSlate, this.rockMaterial, rockSlateTransforms, 'rockSlate');
    yield;
    createSingle(VegetationGeometries.rockPebbles, this.rockMaterial, rockPebblesTransforms, 'rockPebbles');
    yield;
    createSingle(VegetationGeometries.rockSpire, this.rockMaterial, rockSpireTransforms, 'rockSpire');
    yield;
    createSingle(VegetationGeometries.rockMossy, this.rockMaterial, rockMossyTransforms, 'rockMossy');
    yield;

    // Madeira caída variada (4 Formatos)
    createSingle(VegetationGeometries.logHollow, this.logMaterial, logHollowTransforms);
    yield;
    createSingle(VegetationGeometries.logRooted, this.logMaterial, logRootedTransforms);
    yield;
    createSingle(VegetationGeometries.logStump, this.logMaterial, logStumpTransforms);
    yield;
    createSingle(VegetationGeometries.fallenLog, this.logMaterial, logStraightTransforms);
    yield;

    // Sub-bosque e flora rasteira
    // samambaia, junco e flores: do Pixel_Tree (vêm em shrubItems, com a espécie do clima de cada lugar)
    createSingle(VegetationGeometries.lilyPads, this.swampMaterial, lilyTransforms, 'lilyPads');
    yield;
    createSingle(VegetationGeometries.duckweed, this.swampMaterial, duckTransforms, 'duckweed');
    yield;
    createSingle(VegetationGeometries.mudMound, this.swampMaterial, moundTransforms, 'mudMound');
    yield;
    createSingle(VegetationGeometries.petalCarpet, this.swampMaterial, petalTransforms, 'petalCarpet');
    yield;
    for (const part of VegetationGeometries.stoneLanternParts) {
      if (lanternTransforms.length === 0) break;
      this.instances.add(owner, part.geometry, part.material, lanternTransforms.map((it) => it.matrix), lanternTransforms.map((it) => it.tint), part.name, part.castShadow);
    }
    yield;
    createSingle(VegetationGeometries.barrelCactus, this.swampMaterial, barrelTransforms, 'barrelCactus');
    yield;
    createSingle(VegetationGeometries.pricklyPear, this.swampMaterial, pearTransforms, 'pricklyPear');
    yield;
    createSingle(VegetationGeometries.tumbleweed, this.swampMaterial, tumbleTransforms, 'tumbleweed');
    yield;
  }

  public populateChunk(chunkX: number, chunkZ: number, chunkSize: number, terrainGen: ITerrainQueryable, owner: number, enableDetailFlora: boolean = true, plan?: ReturnType<typeof planChunkVegetation>): void {
    const g = this.populateChunkGen(chunkX, chunkZ, chunkSize, terrainGen, owner, enableDetailFlora, plan);
    while (!g.next().done) { /* tudo de uma vez */ }
  }

  /** Monta o grupo de multi-draw de uma parte (espécie/degrau/parte): null se as variações não puderem ser coladas (materiais ou atributos diferentes). */
  private buildMultiSpec(variants: GameTreeVariant[], l: number, pj: number): MultiSpec | null {
    const parts = variants.map((v) => v.lods[l].parts[pj]);
    if (parts.some((p) => !p)) return null;
    const mat = parts[0].material as THREE.ShaderMaterial;
    if (!mat.isShaderMaterial || parts.some((p) => p.material !== mat) || parts.some((p) => p.castShadow !== parts[0].castShadow)) return null;
    const geos = parts.map((p) => p.geometry);
    const main = mergeVariantGeometries(geos);
    if (!main) return null;
    const mats = makeMdMaterials(mat);
    if (!mats) return null;
    main.userData.lodIdx = l;
    // no reflexo da água o desenho próximo é trocado pelo simplificado (ver main.ts): o mesmo, colado
    const reflGeos = variants.map((v) => v.lods[2].parts[pj]?.geometry);
    if (reflGeos.every(Boolean)) {
      const refl = mergeVariantGeometries(reflGeos as THREE.BufferGeometry[]);
      if (refl) { refl.userData.lodIdx = 2; main.userData.reflGeo = refl; }
    }
    const liteGeos = variants.map((v) => shadowLiteOf(v.lods[l], v.lods[3], pj));
    if (liteGeos.every(Boolean)) {
      const lite = mergeVariantGeometries(liteGeos as THREE.BufferGeometry[]);
      if (lite) main.userData.shadowLite = lite;
    }
    return { geos, main, materials: mats, castShadow: parts[0].castShadow };
  }

  /** cores de vértice, dos dois lados (vitórias-régias) */
  private swampMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private treeTime = 0;
  private oldTreeHeight = new Map<THREE.BufferGeometry, number>();
  /**
   * Árvores do Pixel_Tree: cada árvore do plano vira uma de várias variações, no mesmo tamanho da
   * antiga. De perto (até LOD0_END) a versão detalhada, dali em diante a simplificada. A copa antiga
   * (quando há) fica só como sombra (a nova não projeta sombra recortada).
   * kind pode ser uma função (a espécie depende do item: as cores dos bordos).
   */
  private createGameTrees(
    kind: GameTreeKind | ((it: GameTreeItem) => GameTreeKind),
    oldTrunk: THREE.BufferGeometry | null,
    oldLeaves: THREE.BufferGeometry | null,
    items: GameTreeItem[],
    owner: number
  ): void {
    if (items.length === 0) return;
    // sem desenho antigo: a árvore fica no tamanho original (escala 1)
    let oh = oldTrunk ? this.oldTreeHeight.get(oldTrunk) : -1;
    if (oh === undefined && oldTrunk) {
      oldTrunk.computeBoundingBox();
      oh = oldTrunk.boundingBox!.max.y;
      if (oldLeaves) { oldLeaves.computeBoundingBox(); oh = Math.max(oh, oldLeaves.boundingBox!.max.y); }
      this.oldTreeHeight.set(oldTrunk, oh);
    }
    // quatro desenhos por árvore: de perto (até 70 m) e três degraus mais simples (até 150 m, até 260 m e dali em diante)
    const bands: [number, number][] = [[0, 70], [70, 150], [150, 260], [260, 1e9]];
    // espécie e variação de cada item
    const byKind = new Map<GameTreeKind, GameTreeItem[][]>();
    for (const it of items) {
      const k = typeof kind === 'function' ? kind(it) : kind;
      const variants = getGameTrees(k);
      let lists = byKind.get(k);
      if (!lists) { lists = variants.map(() => []); byKind.set(k, lists); }
      const h = Math.sin(it.matrix.elements[12] * 12.9898 + it.matrix.elements[14] * 78.233) * 43758.5453;
      lists[Math.min(variants.length - 1, Math.floor((h - Math.floor(h)) * variants.length))].push(it);
    }
    const scaleM = new THREE.Matrix4();
    for (const [k, lists] of byKind) {
      const variants = getGameTrees(k);
      // Multi-draw (ver multiDraw.ts): nos dois degraus próximos todas as variações da espécie vão no MESMO grupo (uma chamada de desenho em
      // vez de uma por variação). Só para as árvores comuns ('pixelTree'); o que não der para juntar cai no caminho por variação, logo abaixo.
      const mdDone = new Set<string>();
      if (MD.enabled && !singleLodKind(k) && k !== 'willow' && variants.length <= 16) {
        const perV = lists.map((list, vi) => {
          if (list.length === 0) return null;
          const v = variants[vi];
          const s = (oh! > 0 ? oh! / v.height : 1) * (KIND_SIZE[k] ?? 1);
          scaleM.makeScale(s, s, s);
          const matrices = list.map((it) => it.matrix.clone().multiply(scaleM));
          return { matrices, colors: matrices.map(() => new THREE.Color(1, 1, 1)) };
        });
        for (let l = 0; l < 2; l++) {
          for (let pj = 0; pj < variants[0].lods[l].parts.length; pj++) {
            const key = `${k}|${l}|${pj}`;
            if (this.instances.ensureMulti(key, () => this.buildMultiSpec(variants, l, pj), bands[l], 'pixelTree')) {
              this.instances.addMulti(owner, key, perV);
              mdDone.add(l + '|' + pj);
            }
          }
        }
      }
      lists.forEach((list, vi) => {
        if (list.length === 0) return;
        const v = variants[vi];
        const s = (oh! > 0 ? oh! / v.height : 1) * (KIND_SIZE[k] ?? 1);
        scaleM.makeScale(s, s, s);
        const matrices = list.map((it) => it.matrix.clone().multiply(scaleM));
        const white = matrices.map(() => new THREE.Color(1, 1, 1));
        // plantas pequenas (flores, samambaia, junco): só aparecem até uns 90 m (de longe seriam pontinhos)
        const small = k.startsWith('flowers_') || k.startsWith('leaves_') || k === 'fernPlant' || k === 'reedClump';
        const rockish = k.startsWith('rock_') || k.startsWith('gravel_') || k.startsWith('ore_');
        const kb: [number, number][] = small ? [[0, 70], [70, 70], [70, 70], [70, 70]] : rockish ? (k.startsWith('gravel_') ? [[0, 80], [80, 80], [80, 80], [80, 80]] : [[0, 170], [170, 170], [170, 170], [170, 170]]) : bands;
        // de perto (degraus 0 e 1) cada variação tem o seu desenho; dali em diante todas usam o mesmo (mais abaixo)
        for (let l = 0; l < (singleLodKind(k) ? 1 : 2); l++) {
          v.lods[l].parts.forEach((part, pj) => {
            if (mdDone.has(l + '|' + pj)) return;
            // no reflexo da água (pequeno e borrado) os desenhos próximos são trocados pelo simplificado (ver main.ts)
            if (l < 2 && !singleLodKind(k)) part.geometry.userData.reflGeo = v.lods[2].parts[pj]?.geometry ?? null;
            part.geometry.userData.lodIdx = l;
            if (!singleLodKind(k)) part.geometry.userData.shadowLite = shadowLiteOf(v.lods[l], v.lods[3], pj);
            this.instances.add(owner, part.geometry, part.material, matrices, white, small || k === 'willow' ? 'pt:' + k : 'pixelTree', part.castShadow, kb[l]);
          });
        }
      });
      // De longe (acima de 110 m) todas as variações da espécie usam o MESMO desenho: de lá a diferença não se vê, e cada
      // desenho a menos é uma chamada de desenho a menos (a CPU gastava ~25 µs por chamada, e eram mais de 300 por quadro).
      if (!singleLodKind(k)) {
        const all = lists.flat();
        if (all.length > 0) {
          const v0 = variants[0];
          const s0 = (oh! > 0 ? oh! / v0.height : 1) * (KIND_SIZE[k] ?? 1);
          scaleM.makeScale(s0, s0, s0);
          const matrices = all.map((it) => it.matrix.clone().multiply(scaleM));
          const white = matrices.map(() => new THREE.Color(1, 1, 1));
          for (let l = 2; l < 4; l++) {
            v0.lods[l].parts.forEach((part, pj) => {
              part.geometry.userData.lodIdx = l;
              part.geometry.userData.shadowLite = l < 3 ? shadowLiteOf(v0.lods[l], v0.lods[3], pj) : null;
              this.instances.add(owner, part.geometry, part.material, matrices, white, k === 'willow' ? 'pt:' + k : 'pixelTree', part.castShadow, bands[l]);
            });
          }
        }
      }
    }
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
      Object.assign(shader.uniforms, WIND_U);
      shader.uniforms.uGrassPusher = pusher;
      shader.uniforms.uGrassBillboard = billboard;
      shader.vertexShader = 'uniform float uWindTime;\nuniform vec4 uGrassPusher;\nuniform float uGrassBillboard;\nattribute float grassPlane;\nuniform vec2 uWindDir;\nuniform float uWindStr;\nuniform float uWindT;\nvarying float vGust;\nvarying float vGrassTip;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '// Vento: só as pontas balançam (a base fica presa no chão), fase pela posição do tufo',
          '#ifdef USE_INSTANCING',
          '  vec2 wpos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
          '#else',
          '  vec2 wpos = vec2(0.0);',
          '#endif',
          // Vento do mundo (wind.ts): ondas que atravessam o campo na direção do vento (faixas
          // onde a grama inclina mais, como em Zelda), mais fortes nas rajadas, e um tremor leve
          'vec2 wPerp = vec2(-uWindDir.y, uWindDir.x);',
          'float waveArg = dot(wpos, uWindDir) * 0.11 - uWindT * 2.3 + sin(dot(wpos, wPerp) * 0.045) * 1.6;',
          'float gustWave = smoothstep(0.35, 1.0, sin(waveArg));',
          'float flutter = sin(uWindTime * 3.1 + wpos.x * 0.9 + wpos.y * 0.7) * 0.25;',
          'float windBend = (0.35 + gustWave * 1.1) * uWindStr;',
          'vGust = gustWave * min(uWindStr, 1.5);',
          'vGrassTip = position.y;',
          'vec2 swayV = uWindDir * windBend + wPerp * flutter;',
          'transformed.x += swayV.x * 0.07 * position.y;',
          'transformed.z += swayV.y * 0.07 * position.y;',
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
          '    wp.x += swayV.x * 0.07 * yL * sH;',
          '    wp.z += swayV.y * 0.07 * yL * sH;',
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
      // onda de vento passando: as pontas inclinadas pegam mais luz (clareiam um pouco)
      shader.fragmentShader = 'varying float vGust;\nvarying float vGrassTip;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          '  diffuseColor.rgb *= 1.0 + vGust * 0.16 * smoothstep(0.25, 1.0, vGrassTip);',
        ].join('\n')
      );
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
    mat.customProgramCacheKey = () => 'pixel_grass_wind_bb_aa_gust';
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
    this.treeTime += dt;
    tickGameTrees(this.treeTime);
    this.windTime.value += dt;
  }

  /**
   * Planta os tufos de grama 3D de um chunk (dados do worker: x, y, z, escala, bioma, dh/dx,
   * dh/dz). Cada tufo gira para acompanhar a inclinação do chão (base encostada dos dois lados)
   * e afunda um pouco para não aparecer fresta. Cor por bioma via tint.
   */
  public populateGrass(owner: number, data: Float32Array, from = 0, maxFloats = Infinity): number {
    if (!data.length) return 0;
    const end = Math.min(data.length, from + maxFloats);
    const TINTS = [
      new THREE.Color(1.0, 1.0, 1.0),    // temperado: paleta da própria textura
      new THREE.Color(0.55, 0.42, 0.34), // vulcão: capim seco queimado
      new THREE.Color(0.72, 0.88, 0.86), // polar: verde-azulado frio, com geada
      new THREE.Color(1.0, 0.92, 0.55),  // deserto: palha
      new THREE.Color(1.08, 0.86, 0.42), // savana (usa o capim seco, ver abaixo)
      new THREE.Color(0.70, 1.0, 0.70),  // tropical: verde intenso
      new THREE.Color(0.62, 0.82, 0.74), // taiga: verde-azulado escuro
      new THREE.Color(1.0, 0.84, 0.52),  // outonal: capim oliva-dourado
      new THREE.Color(0.66, 0.74, 0.60), // tundra: capim verde-acinzentado
      new THREE.Color(1.0, 1.0, 1.0),    // termal (sem grama)
      new THREE.Color(0.80, 0.86, 0.50), // manguezal: capim de brejo oliva-amarelado (spartina)
      new THREE.Color(1.12, 1.16, 1.02), // bosque de cerejeiras: verde-primavera claro e macio
    ];
    // Listas por (paleta, formato)
    const NV = this.grassMaterials.length;
    const mk = () => Array.from({ length: NV }, () => ({ m: [] as THREE.Matrix4[], c: [] as THREE.Color[] }));
    const green = mk(), snow = mk(), dry = mk(), marsh = mk();
    // bioma -> capim próprio (3 deserto, 4 savana, 5 selva, 6 taiga, 7 outono, 8 tundra, 11 cerejeiras)
    const STYLE_OF_BIO: Record<number, string> = { 3: 'desert', 4: 'savanna', 5: 'jungle', 6: 'taiga', 7: 'autumn', 8: 'tundra', 11: 'sakura' };
    const styles = new Map<string, ReturnType<typeof mk>>();
    for (const key of Object.values(STYLE_OF_BIO)) styles.set(key, mk());
    const styleTint = [new THREE.Color(1, 1, 1), new THREE.Color(0.92, 0.94, 0.9), new THREE.Color(1.08, 1.06, 1.0)];
    const marshTints = [new THREE.Color(1.0, 1.0, 1.0), new THREE.Color(0.9, 0.95, 0.8), new THREE.Color(1.1, 1.05, 0.85)];
    // Proporção dos formatos: moita 32%, alta 20%, rasteira 20%, espiga 12%, tombada 16%
    const CUM = [0.32, 0.52, 0.72, 0.84, 1.0];
    const white = new THREE.Color(1, 1, 1);
    const dryTint = new THREE.Color(0.78, 0.52, 0.34);
    const burntTint = new THREE.Color(0.62, 0.50, 0.42);
    const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
    const yaw = new THREE.Quaternion(), tilt = new THREE.Quaternion(), q = new THREE.Quaternion();
    for (let k = from; k + 8 < end; k += 9) {
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
      } else if (STYLE_OF_BIO[data[k + 4] | 0]) {
        // capim próprio do bioma: formas e paleta dele, com leve variação de tom por tufo
        const lists = styles.get(STYLE_OF_BIO[data[k + 4] | 0])!;
        lists[v].m.push(m);
        lists[v].c.push(styleTint[Math.floor((((data[k] * 4.31 + data[k + 2] * 6.07) % 1) + 1) % 1 * 3)]);
      } else if ((data[k + 4] | 0) === 10) {
        // manguezal: capim de brejo próprio (formas e paleta de spartina), com leve variação de tom
        marsh[v].m.push(m);
        marsh[v].c.push(marshTints[Math.floor((((data[k] * 6.21 + data[k + 2] * 1.73) % 1) + 1) % 1 * 3)]);
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
      this.instances.add(owner, this.grassGeometry, this.marshGrassMaterials[v], marsh[v].m, marsh[v].c, 'grass', false);
      for (const [key, lists] of styles) {
        this.instances.add(owner, this.grassGeometry, this.styleGrassMaterials.get(key)![v], lists[v].m, lists[v].c, 'grass', false);
      }
    }    return end;
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
    // cada espécie: as partes desenhadas (geometria, material, tinta), a tinta da copa (fundo) e a escala
    // do desenho em relação ao tamanho de uma árvore do plano (as árvores novas são ajustadas por escala)
    interface ImpSpec { parts: { geo: THREE.BufferGeometry; mat: THREE.Material; tint: number }[]; bg: number; scale: number }
    const old = (tg: THREE.BufferGeometry, lg: THREE.BufferGeometry | null, tm: THREE.Material, lm: THREE.Material | null, tc: number, lc: number): ImpSpec => ({
      parts: [{ geo: tg, mat: tm, tint: tc }, ...(lg && lm ? [{ geo: lg, mat: lm, tint: lc }] : [])], bg: lc, scale: 1,
    });
    // as árvores do Pixel_Tree: a variação simplificada (a de longe), com a mesma altura da antiga
    const gt = (kind: GameTreeKind, tg: THREE.BufferGeometry, lg: THREE.BufferGeometry | null, bg: number): ImpSpec => {
      const v = getGameTrees(kind)[0];
      tg.computeBoundingBox();
      let oh = tg.boundingBox!.max.y;
      if (lg) { lg.computeBoundingBox(); oh = Math.max(oh, lg.boundingBox!.max.y); }
      return { parts: v.lods[2].parts.map((p) => ({ geo: p.geometry, mat: p.material, tint: 0xffffff })), bg, scale: (oh / v.height) * (KIND_SIZE[kind] ?? 1) };
    };
    const gtNew = (kind: GameTreeKind, bg: number): ImpSpec => {
      const v = getGameTrees(kind)[0];
      return { parts: v.lods[2].parts.map((p) => ({ geo: p.geometry, mat: p.material, tint: 0xffffff })), bg, scale: 1 };
    };
    const specs: ImpSpec[] = [
      gt('oak', G.oakTrunk, G.oakLeaves, 0x48aa32),
      gt('oak', G.broadOakTrunk, G.broadOakLeaves, 0x429c2c),
      gt('pine', G.pineTrunk, G.pineLeaves, 0x2a7238),
      gt('birch', G.birchTrunk, G.birchLeaves, 0x6ec430),
      gt('palm', G.palmTrunk, G.palmLeaves, 0x4cb828),
      gt('acacia', G.acaciaTrunk, G.acaciaLeaves, 0x6e9c2e),
      gt('mapleRed', G.mapleTrunk, G.mapleLeaves, 0xd44022),
      gt('mapleOrange', G.mapleTrunk, G.mapleLeaves, 0xe87a1a),
      gt('mapleYellow', G.mapleTrunk, G.mapleLeaves, 0xe8b824),
      gt('mangrove', G.mangroveTrunk, G.mangroveLeaves, 0x348c2c),
      gt('snowPine', G.snowPineTrunk, G.snowPineLeaves, 0xffffff),
      gt('willow', G.arcticWillowTrunk, G.arcticWillowLeaves, 0x72927c),
      gtNew('dead', 0x22201e),
      gt('cactus', G.cactusBody, null, 0x4e8e42),
      old(G.cactusSaplingBody, null, this.cactusMaterial, null, 0x5ca850, 0x5ca850),
      gtNew('sakura', 0xf0a0c0),
      gtNew('korok', 0x5ab04a),
    ];
    // (a troca seca com o impostor não vale aqui: as árvores estão na origem, longe da "câmera")
    const savedSwap = FADE.uTreeSwap.value.clone();
    FADE.uTreeSwap.value.set(1e9, 1e9 + 1);
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
    specs.forEach((spec, i) => {
      box.makeEmpty();
      for (const p of spec.parts) { p.geo.computeBoundingBox(); box.union(tmp.copy(p.geo.boundingBox!)); }
      const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
      const S = Math.max(w, h) * 1.04;
      const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
      info.push(new THREE.Vector3(S * spec.scale, cx * spec.scale, cy * spec.scale));
      cam.left = -S / 2; cam.right = S / 2; cam.top = S / 2; cam.bottom = -S / 2;
      cam.position.set(cx, cy, 100); cam.lookAt(cx, cy, 0);
      cam.updateProjectionMatrix();
      const meshes = spec.parts.map((p) => {
        const m = new THREE.InstancedMesh(p.geo, p.mat, 1);
        m.setMatrixAt(0, new THREE.Matrix4()); m.setColorAt(0, new THREE.Color(p.tint));
        if (p.mat.userData.pixelTree) enableAssetEnvironment(m);
        return m;
      });
      for (const m of meshes) { m.frustumCulled = false; scene.add(m); }
      const x = (i % cols) * CELL, y = Math.floor(i / cols) * CELL;
      rt.viewport.set(x, y, CELL, CELL);
      rt.scissor.set(x, y, CELL, CELL);
      renderer.setRenderTarget(rt);
      // fundo transparente com a cor da copa (as bordas filtradas não escurecem)
      renderer.setClearColor(new THREE.Color(spec.bg).multiplyScalar(0.55), 0);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      for (const m of meshes) { scene.remove(m); m.dispose(); }
    });
    FADE.uTreeSwap.value.copy(savedSwap);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAutoClear;
    return { texture: rt.texture, info, cols, rows };
  }
}
