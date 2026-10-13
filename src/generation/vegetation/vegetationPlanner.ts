import * as THREE from 'three';
import { PRNG } from '../math/prng.ts';
import { TerrainPoint, BiomeType } from '../types.ts';
import { CONFIG } from '../../config.ts';
import { landmarksNear } from '../landmarks/landmarkPlanner.ts';
import { oreAt } from './pixelTrees/oreAssign.ts';

/**
 * Onde vai cada árvore, pedra, arbusto, tronco e flor de um chunk. Separado do VegetationManager
 * (que cria as instâncias na tela) para rodar também nos workers: as árvores distantes do
 * horizonte (impostores) usam exatamente estas posições, espécies e tamanhos, e a troca entre a
 * árvore de verdade e a distante acontece no mesmo lugar, sem árvores sumindo ou aparecendo.
 * Só usa matemática do three.js (nada de GPU/DOM).
 */
export interface ITerrainQueryable {
  getPoint(x: number, z: number): TerrainPoint;
  getPointFast?(x: number, z: number): TerrainPoint;
}

export interface TreeTransformItem {
  matrix: THREE.Matrix4;
  trunkTint: THREE.Color;
  leafTint: THREE.Color;
}

export type TintedTransform = { matrix: THREE.Matrix4; tint: THREE.Color };

// Cerejeiras (Satori) e árvores ancestrais (Korok): árvores "à parte", sem bioma próprio. Nascem em
// bosques (manchas grandes de ruído, só em certos biomas) e soltas em poucos pontos de outros biomas.
// Tudo é função só da posição (os impostores, planejados nos workers, saem nos mesmos lugares).
const gh = (x: number, z: number, s: number): number => { const v = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
const gnoise = (x: number, z: number, s: number): number => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = gh(ix, iz, s), b = gh(ix + 1, iz, s), c = gh(ix, iz + 1, s), d = gh(ix + 1, iz + 1, s);
  return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
};
/** Só os bosques (sem as árvores soltas): para o painel de biomas achar onde ficam. */
export function groveAt(wx: number, wz: number, biomeType: BiomeType, moisture: number): 'korok' | null {
  const korokOk = biomeType === BiomeType.TROPICAL_RAINFOREST || biomeType === BiomeType.TEMPERATE_FOREST || biomeType === BiomeType.BOREAL_TAIGA;
  if (korokOk && moisture > 0.45 && gnoise(wx / 300, wz / 300, 2) > 0.78) return 'korok';
  return null;
}

function specialTree(wx: number, wz: number, biomeType: BiomeType, moisture: number): 'sakura' | 'korok' | null {
  // cerejeiras soltas nos biomas temperados em volta, e o bosque inteiro no bioma de cerejeiras
  const sakuraOk = biomeType === BiomeType.TEMPERATE_FOREST || biomeType === BiomeType.COASTAL_MEADOW || biomeType === BiomeType.AUTUMN_FOREST || biomeType === BiomeType.SAKURA_GROVE;
  const korokOk = biomeType === BiomeType.TROPICAL_RAINFOREST || biomeType === BiomeType.TEMPERATE_FOREST || biomeType === BiomeType.BOREAL_TAIGA;
  if (!sakuraOk && !korokOk) return null;
  const r = gh(wx * 3.7, wz * 5.3, 9);
  // bosques de árvores ancestrais (os de cerejeira são um bioma próprio)
  if (sakuraOk && biomeType === BiomeType.SAKURA_GROVE && r < 0.84) return 'sakura';
  if (korokOk && moisture > 0.45 && gnoise(wx / 300, wz / 300, 2) > 0.72 && r < 0.72) return 'korok';
  // soltas
  const r2 = gh(wx * 9.1, wz * 2.9, 5);
  if (sakuraOk && r2 < 0.022) return 'sakura';
  if (korokOk && r2 > 0.978) return 'korok';
  return null;
}

/**
 * O plano é um gerador: cede a vez a cada ponto da grade (yield), para quem chama poder fatiar o trabalho em vários quadros (um chunk inteiro
 * custava 20 a 70 ms numa chamada só e era a causa das travadas ao andar). planChunkVegetation roda tudo de uma vez (workers, 1º carregamento).
 */
export function* planChunkVegetationGen(
  chunkX: number,
  chunkZ: number,
  chunkSize: number,
  terrainGen: ITerrainQueryable,
  enableDetailFlora: boolean = true
) {
  const chunkSeed = PRNG.hash2D(chunkX, chunkZ, 0x85ebca6b);
  const prng = new PRNG(chunkSeed * 100000);
  // flora rasteira (só perto da câmera) com a sua própria sequência: assim as árvores, pedras e
  // troncos saem iguais com ou sem ela (e iguais às árvores distantes, planejadas nos workers)
  const flora = new PRNG(chunkSeed * 100000 + 7919);

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
  const sakuraItems: TreeTransformItem[] = [];
  const korokItems: TreeTransformItem[] = [];
  const lilyTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const petalTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const lanternTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const barrelTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const pearTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const tumbleTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const duckTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const moundTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const deadTreeTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const cactusTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  const cactusSaplingTransforms: { matrix: THREE.Matrix4; tint: THREE.Color }[] = [];
  // arbustos do Pixel_Tree: cada um com a espécie do clima do lugar
  const shrubItems: { matrix: THREE.Matrix4; kind: string }[] = [];
  // samambaias coladas numa pedra do manguezal: entram depois da limpeza, que as tiraria por estarem perto da pedra
  const rockRingFerns: { matrix: THREE.Matrix4; kind: string; cx: number; cz: number }[] = [];
  const flowerChanceFor = (b: BiomeType, meadow: boolean): number => {
    // chance de canteiro por sorteio (3 sorteios por ponto da grade de 6 m)
    // lugares sem flor: vale termal, praia, campos e calderas vulcânicas, picos de rocha e gelo
    if (b === BiomeType.GEOTHERMAL_VALLEY || b === BiomeType.BEACH || b === BiomeType.VOLCANIC_FIELD || b === BiomeType.VOLCANIC_CALDERA ||
        b === BiomeType.ROCKY_PEAKS || b === BiomeType.SNOW_SUMMIT || b === BiomeType.FROZEN_TUNDRA) return 0;
    if (meadow) return 0.30;
    switch (b) {
      case BiomeType.TEMPERATE_FOREST: return 0.16;
      case BiomeType.AUTUMN_FOREST: return 0.18;
      case BiomeType.SAKURA_GROVE: return 0.20;
      case BiomeType.BOREAL_TAIGA: return 0.14;
      case BiomeType.ALPINE_TUNDRA: return 0.16;
      case BiomeType.TROPICAL_RAINFOREST: return 0.20;
      case BiomeType.MANGROVE_SWAMP: return 0.16;
      case BiomeType.DESERT_DUNES: case BiomeType.CANYON_DESERT: return 0.08;
      default: return 0.10;
    }
  };
  const flowerKindFor = (b: BiomeType): string => {
    switch (b) {
      case BiomeType.SAKURA_GROVE: return 'flowers_satori';
      case BiomeType.AUTUMN_FOREST: return 'flowers_akkala';
      case BiomeType.BOREAL_TAIGA: case BiomeType.ROCKY_PEAKS: return 'flowers_hebra';
      case BiomeType.ALPINE_TUNDRA: return 'flowers_tundra';
      case BiomeType.SNOW_SUMMIT: case BiomeType.FROZEN_TUNDRA: return 'flowers_hebra_snowy';
      case BiomeType.TROPICAL_RAINFOREST: return 'flowers_faron';
      case BiomeType.MANGROVE_SWAMP: return 'flowers_swamp';
      case BiomeType.DESERT_DUNES: case BiomeType.CANYON_DESERT: return 'flowers_gerudo';
      case BiomeType.SAVANNAH: return 'flowers_savanna';
      case BiomeType.VOLCANIC_FIELD: case BiomeType.VOLCANIC_CALDERA: return 'flowers_withered';
      default: return 'flowers_hyrule';
    }
  };
  // arbustos do deserto: a maioria é o seco só de galhos (sem folhas), o resto o verde espinhoso
  const desertShrubKind = (r: number): string => (r < 0.65 ? 'shrubWithered' : 'shrubDesert');
  const shrubKindFor = (b: BiomeType, isArctic: boolean, r: number): string => {
    if (isArctic) return 'shrubSnow';
    switch (b) {
      case BiomeType.TEMPERATE_FOREST: return r < 0.50 ? 'shrubHyrule' : r < 0.78 ? 'shrubBerry' : r < 0.94 ? 'shrubFlower' : 'shrubKorok';
      case BiomeType.COASTAL_MEADOW: return r < 0.40 ? 'shrubHyrule' : r < 0.80 ? 'shrubFlower' : 'shrubBerry';
      case BiomeType.AUTUMN_FOREST: return r < 0.70 ? 'shrubBirch' : 'shrubBerry';
      case BiomeType.SAKURA_GROVE: return r < 0.70 ? 'shrubSakura' : 'shrubFlower';
      case BiomeType.TROPICAL_RAINFOREST: return r < 0.80 ? 'shrubPalm' : 'shrubFlower';
      case BiomeType.SAVANNAH: return 'shrubSavanna';
      case BiomeType.BOREAL_TAIGA: case BiomeType.ALPINE_TUNDRA: case BiomeType.ROCKY_PEAKS: return 'shrubPine';
      case BiomeType.SNOW_SUMMIT: case BiomeType.FROZEN_TUNDRA: return 'shrubSnow';
      case BiomeType.MANGROVE_SWAMP: return 'shrubSwamp';
      case BiomeType.DESERT_DUNES: case BiomeType.CANYON_DESERT: return desertShrubKind(r);
      case BiomeType.VOLCANIC_FIELD: case BiomeType.VOLCANIC_CALDERA: return 'shrubWithered';
      default: return r < 0.6 ? 'shrubHyrule' : 'shrubBerry';
    }
  };

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

  // Landmarks: o espaço de cada cena fica livre de árvores, pedras e troncos
  const tgAny = terrainGen as any;
  // As raízes do mangue se abrem uns 2 m para os lados: o tronco afunda até a ponta das raízes alcançar o
  // ponto mais baixo em volta (margem, lama ou leito), em vez de ficarem no ar.
  const mangroveBaseY = (x: number, z: number, h: number): number => {
    let low = h;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      low = Math.min(low, terrainGen.getPointFast ? terrainGen.getPointFast(x + Math.cos(a) * 1.9, z + Math.sin(a) * 1.9).height : terrainGen.getPoint(x + Math.cos(a) * 1.9, z + Math.sin(a) * 1.9).height);
    }
    return h - Math.min(0.7, Math.max(0.3, h - low + 0.1));
  };
  const landmarks = CONFIG.LANDMARKS_ENABLED && tgAny.getDryHeight ? landmarksNear(tgAny, startX, startZ, startX + chunkSize, startZ + chunkSize) : [];
  const inLandmark = (x: number, z: number) => {
    for (const l of landmarks) if ((x - l.x) ** 2 + (z - l.z) ** 2 < l.radius * l.radius) return true;
    return false;
  };

  for (let ix = 0; ix < steps; ix++) {
    for (let iz = 0; iz < steps; iz++) {
      yield;
      const jx = (prng.next() - 0.5) * sampleStep * 0.85;
      const jz = (prng.next() - 0.5) * sampleStep * 0.85;
      const wx = startX + (ix + 0.5) * sampleStep + jx;
      const wz = startZ + (iz + 0.5) * sampleStep + jz;
      if (landmarks.length && inLandmark(wx, wz)) continue;

      const pt: TerrainPoint = terrainGen.getPointFast ? terrainGen.getPointFast(wx, wz) : terrainGen.getPoint(wx, wz);

      // 1. Nenhuma árvore dentro d'água (apenas seixos ou blocos submersos eventuais)
      if (pt.isWater || pt.height <= CONFIG.SEA_LEVEL) {
        let mangroveWater = false;
        // manguezal: o mangue cresce dentro da água rasa (tronco para fora, raízes dentro d'água)
        if (pt.height > -1.0 && pt.height <= CONFIG.SEA_LEVEL && tgAny.macroGeo && tgAny.getClimate) {
          const mc = tgAny.getClimate(wx, wz, 0);
          const inMangrove = (mangroveWater = mc.temperature > 0.66 && mc.moisture > 0.58 && tgAny.macroGeo.getLandmassMask(wx, wz).coastDist > 8.0);
          if (inMangrove && enableDetailFlora) {
            // juncos (saem da água) e vitórias-régias na superfície
            if (flora.chance(0.05)) {
              const rs = flora.range(0.97, 1.05);
              dummy.position.set(wx, pt.height - 0.02, wz);
              dummy.scale.set(rs, rs * flora.range(0.97, 1.05), rs);
              dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
              dummy.updateMatrix();
              reedTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x4a8a36) });
            } else if (flora.chance(0.30)) {
              // tapete de lentilha-d'água na superfície
              flora.range(1.4, 3.2);
              const ds = 1;   // escala 1: as células do pixel art têm o tamanho da densidade do jogo (aquaticPixel.ts)
              dummy.position.set(wx, CONFIG.SEA_LEVEL + 0.098, wz);   // acima da crista das ondas (±0,1 m): senão a água passa por cima e a espuma de contato cobre a folha
              dummy.scale.set(ds, 1, ds);
              dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
              dummy.updateMatrix();
              duckTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(1, 1, 1) });
            } else if (flora.chance(0.10)) {
              // tronco meio afundado
              const lsc = flora.range(0.9, 1.5);
              dummy.position.set(wx, CONFIG.SEA_LEVEL - 0.2, wz);
              dummy.rotation.set(flora.range(-0.06, 0.06), flora.range(0, Math.PI * 2), flora.range(-0.06, 0.06));
              dummy.scale.set(lsc, lsc, lsc);
              dummy.updateMatrix();
              logStraightTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x3a2e22) });
            } else if (flora.chance(0.28)) {   // (era 0.09: depois de juncos, lentilha e troncos sobrava ~5% e elas eram raras)
              flora.range(0.8, 1.5);
              const ls = 1;
              dummy.position.set(wx, CONFIG.SEA_LEVEL + 0.09, wz);   // idem (a folha tem mais 0,03 m de altura própria)
              dummy.scale.set(ls, 1, ls);
              dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
              dummy.updateMatrix();
              lilyTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(1, 1, 1) });
            }
          }
          if (inMangrove && prng.chance(0.42)) {
            const mgSize = prng.range(0.62, 1.6) ** 1.15;   // de mangues baixos a bem altos
            const hs = mgSize * prng.range(0.9, 1.12), ws = mgSize * prng.range(0.85, 1.12);
            // na água o tronco fica com a base logo abaixo da superfície: as raízes aparecem para fora d'água
            dummy.position.set(wx, Math.max(pt.height - 0.35, CONFIG.SEA_LEVEL - 0.3), wz);
            dummy.rotation.set(0, prng.range(0, Math.PI * 2), 0);
            dummy.scale.set(ws * 1.05, hs, ws * 1.05);
            dummy.updateMatrix();
            mangroveItems.push({ matrix: dummy.matrix.clone(), trunkTint: new THREE.Color(0x3e2d1f), leafTint: new THREE.Color(0x348c2c) });
            continue;
          }
        }
        // lagos de água parada fora do manguezal (clima não gelado): vitórias-régias e lentilha-d'água em manchas, nos trechos rasos e longe de rios
        if (!mangroveWater && enableDetailFlora && pt.height > -1.6 && pt.height <= CONFIG.SEA_LEVEL && tgAny.getHydrology && tgAny.getDryHeight && tgAny.getClimate
            && Math.sin(wx * 0.045 + 1.3) * Math.sin(wz * 0.045 - 0.7) > -0.1 && flora.chance(0.45)) {
          const hq = tgAny.getHydrology().queryHydrology(wx, wz, tgAny.getDryHeight(wx, wz));
          if (hq.isLake && hq.distanceToRiver > 14 && tgAny.getClimate(wx, wz, 0).temperature > 0.32) {
            const asLily = flora.chance(0.6);
            dummy.position.set(wx, CONFIG.SEA_LEVEL + (asLily ? 0.09 : 0.098), wz);   // acima da crista das ondas (±0,1 m)
            dummy.scale.set(1, 1, 1);
            dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            (asLily ? lilyTransforms : duckTransforms).push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(1, 1, 1) });
          }
        }
        if (!mangroveWater && pt.height > -2.0 && prng.chance(0.025)) {
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

      // FLORES: canteiros espalhados por todo o chão de cada bioma, independentes dos sorteios de árvore, arbusto e pedra
      // (a flor de cada clima: ver flowerKindFor). Vários por ponto da grade, para o campo ficar florido.
      if (enableDetailFlora && pt.slope < 0.4 && biome.type !== BiomeType.OCEAN && biome.type !== BiomeType.SHALLOWS) {
        const fc = flowerChanceFor(biome.type, biome.type === BiomeType.COASTAL_MEADOW || biome.type === BiomeType.SAVANNAH) * 0.55;
        for (let k = 0; k < 3; k++) {
          if (!flora.chance(fc)) continue;
          const J2 = sampleStep * 0.5;
          const fx = wx + flora.range(-J2, J2), fz = wz + flora.range(-J2, J2);
          const fh = terrainGen.getPointFast ? terrainGen.getPointFast(fx, fz).height : pt.height;
          if (fh <= CONFIG.SEA_LEVEL + 0.1) continue;
          const wScale = flora.range(1.0, 1.25);   // quase 1: esticar a instância esticaria também os pixels (o tamanho da flor vem do desenho)
          const hScale = wScale * flora.range(0.62, 0.74);   // altura: o caule fica mais curto que o natural
          dummy.position.set(fx, fh + 0.02, fz);
          dummy.scale.set(wScale, hScale, wScale);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          const gk = groveAt(fx, fz, biome.type, biome.moisture);
          shrubItems.push({ matrix: dummy.matrix.clone(), kind: gk === 'korok' ? 'flowers_korok' : flowerKindFor(biome.type) });
        }
      }
      const isBeach = biome.type === 'Praia Arenosa' && (pt.iceInfluence || 0) < 0.15;

      // Juncos aquáticos / Taboas nas margens úmidas (0.12m a 1.40m de altitude)
      if (enableDetailFlora && pt.height >= 0.12 && pt.height <= 1.40 && pt.slope < 0.32 && !isBeach) {
        if (flora.chance(0.065)) {
          const rScale = flora.range(0.97, 1.05);
          dummy.position.set(wx, pt.height - 0.02, wz);
          dummy.scale.set(rScale, rScale * flora.range(0.97, 1.05), rScale);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          reedTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x448a32) });
        }
      }

      // Pedrinhas soltas pelo chão (fora da água e da areia da praia), em todos os biomas
      if (enableDetailFlora && !isBeach && pt.slope < 0.5 && flora.chance(0.085)) {
        const gx = wx + flora.range(-2.4, 2.4), gz = wz + flora.range(-2.4, 2.4);
        dummy.position.set(gx, (terrainGen.getPointFast ? terrainGen.getPointFast(gx, gz).height : pt.height) - 0.03, gz);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
        dummy.updateMatrix();
        rockPebblesTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x756e5e) });
      }

      // Deserto: arbustos secos, bolas-de-feno, cactos variados, formações de rocha
      if (enableDetailFlora && (biome.type === 'Deserto & Dunas Áridas' || biome.type === 'Cânions Estratificados & Ravinas')) {
        const place = (list: { matrix: THREE.Matrix4; tint: THREE.Color }[], px: number, pz: number, s: number, tint: THREE.Color, sink = 0.02, sy = 1) => {
          dummy.position.set(px, terrainGen.getPointFast ? terrainGen.getPointFast(px, pz).height - sink : pt.height - sink, pz);
          dummy.scale.set(s, s * sy, s);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          list.push({ matrix: dummy.matrix.clone(), tint });
        };
        const J = sampleStep * 0.45;
        // arbustos do deserto: poucos (um sorteio de 11% por ponto, antes eram três de 30%), metade verdes e metade secos
        if (flora.chance(0.17)) {
          const px = wx + flora.range(-J, J), pz = wz + flora.range(-J, J);
          dummy.position.set(px, (terrainGen.getPointFast ? terrainGen.getPointFast(px, pz).height : pt.height) - 0.05, pz);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          shrubItems.push({ matrix: dummy.matrix.clone(), kind: desertShrubKind(flora.next()) });
        }
        if (flora.chance(0.10)) {
          // muda de árvore seca: uma árvore pequena e retorcida, sem folhas
          const px = wx + flora.range(-J, J), pz = wz + flora.range(-J, J);
          const ds = flora.range(0.9, 1.4);
          dummy.position.set(px, (terrainGen.getPointFast ? terrainGen.getPointFast(px, pz).height : pt.height) - 0.05, pz);
          dummy.scale.set(ds, ds, ds);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          shrubItems.push({ matrix: dummy.matrix.clone(), kind: 'deadSapling' });
        }
        // formação de rocha: agulhas e lajes juntas (um conjunto a cada ~150 m)
        if (flora.chance(0.012) && pt.slope < 0.5) {
          const n = 3 + Math.floor(flora.range(0, 4));
          for (let k = 0; k < n; k++) {
            const a = flora.range(0, Math.PI * 2), r = flora.range(0, 7);
            const rt = new THREE.Color(0x9a7a5c).multiplyScalar(flora.range(0.85, 1.1));
            const kind = k === 0 ? rockSpireTransforms : (k % 2 ? rockSlateTransforms : rockBoulderTransforms);
            place(kind, wx + Math.cos(a) * r, wz + Math.sin(a) * r, k === 0 ? flora.range(0.9, 1.5) : flora.range(0.5, 1.0), rt, 0.25);
          }
        }
      }
      // Bosque de cerejeiras: tapetes de pétalas no chão, flores cor-de-rosa e lanternas de pedra
      if (enableDetailFlora && biome.type === BiomeType.SAKURA_GROVE && pt.slope < 0.5) {
        const J = sampleStep * 0.45;
        const put = (list: { matrix: THREE.Matrix4; tint: THREE.Color }[], s: number, tint: THREE.Color, yawRange = Math.PI * 2, dy = 0.0) => {
          const px = wx + flora.range(-J, J), pz = wz + flora.range(-J, J);
          const hh = terrainGen.getPointFast ? terrainGen.getPointFast(px, pz).height : pt.height;
          dummy.position.set(px, hh + dy, pz);
          dummy.scale.set(s, s, s);
          dummy.rotation.set(0, flora.range(0, yawRange), 0);
          dummy.updateMatrix();
          list.push({ matrix: dummy.matrix.clone(), tint });
        };
        // folhas secas caídas (do Pixel_Tree) no lugar dos tapetes de pétalas
        for (let k = 0; k < 3; k++) if (flora.chance(0.40)) { const lx = wx + flora.range(-J, J), lz = wz + flora.range(-J, J); dummy.position.set(lx, (terrainGen.getPointFast ? terrainGen.getPointFast(lx, lz).height : pt.height) + 0.01, lz); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0); dummy.updateMatrix(); shrubItems.push({ matrix: dummy.matrix.clone(), kind: 'leaves_satori' }); }
        for (let k = 0; k < 2; k++) if (flora.chance(0.30)) put(wildflowerTransforms, flora.range(0.9, 1.4), new THREE.Color(0xf6a6c8), Math.PI * 2, -0.02);
        if (flora.chance(0.025)) put(lanternTransforms, 1, new THREE.Color(1, 1, 1), Math.PI * 2, -0.04)   // escala 1: as células de pixel têm o tamanho da densidade do jogo (stoneLanternParts.ts);
      }

      // Folhas secas caídas no chão das florestas (cada clima com as suas)
      if (enableDetailFlora && pt.slope < 0.5 && biome.type !== BiomeType.SAKURA_GROVE) {
        const grove = groveAt(wx, wz, biome.type, biome.moisture) === 'korok';
        let lk: string | null = null, lc = 0;
        if (grove) { lk = 'korok'; lc = 0.06; }
        else switch (biome.type) {
          case BiomeType.AUTUMN_FOREST: lk = 'akkala'; lc = 0.30; break;
          case BiomeType.TEMPERATE_FOREST: lk = 'hyrule'; lc = 0.10; break;
          case BiomeType.BOREAL_TAIGA: lk = 'hebra'; lc = 0.06; break;
          case BiomeType.TROPICAL_RAINFOREST: lk = 'faron'; lc = 0.07; break;
          case BiomeType.SAVANNAH: lk = 'savanna'; lc = 0.03; break;
          default: break;
        }
        if (lk && flora.chance(lc)) {
          const lx = wx + flora.range(-2.4, 2.4), lz = wz + flora.range(-2.4, 2.4);
          dummy.position.set(lx, (terrainGen.getPointFast ? terrainGen.getPointFast(lx, lz).height : pt.height) + 0.01, lz);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          shrubItems.push({ matrix: dummy.matrix.clone(), kind: 'leaves_' + lk });
        }
      }

      // Manguezal em terra: juncos nas margens
      if (enableDetailFlora && biome.type === 'Manguezal Estuarino' && pt.height < 4.0) {
        // pedra com musgo (a do pântano) e samambaias em volta
        if (pt.slope < 0.3 && flora.chance(0.20)) {
          const mx = wx + flora.range(-2, 2), mz = wz + flora.range(-2, 2);
          const mh = terrainGen.getPointFast ? terrainGen.getPointFast(mx, mz).height : pt.height;
          dummy.position.set(mx, mh - 0.08, mz);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          shrubItems.push({ matrix: dummy.matrix.clone(), kind: 'rock_swamp' });
          // o raio da pedra segue a variação de tamanho sorteada pela posição (a mesma conta do gerenciador)
          const hv = Math.sin(mx * 12.9898 + mz * 78.233) * 43758.5453;
          const rmul = [0.42, 0.68, 1.0][Math.min(2, Math.floor((hv - Math.floor(hv)) * 3))];
          const nf = 4 + Math.floor(flora.range(0, 3));
          const a0 = flora.range(0, Math.PI * 2);
          for (let k = 0; k < nf; k++) {
            const ang = a0 + (k / nf) * Math.PI * 2 + flora.range(-0.35, 0.35), d = 1.2 * rmul + 0.3 + flora.range(0, 0.35);
            const fx = mx + Math.cos(ang) * d, fz = mz + Math.sin(ang) * d;
            dummy.position.set(fx, (terrainGen.getPointFast ? terrainGen.getPointFast(fx, fz).height : mh) + 0.02, fz);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
            dummy.updateMatrix();
            rockRingFerns.push({ matrix: dummy.matrix.clone(), kind: 'fernPlant', cx: mx, cz: mz });
          }
        }
        if (flora.chance(0.05)) {
          const rs = flora.range(0.97, 1.05);
          dummy.position.set(wx, pt.height - 0.02, wz);
          dummy.scale.set(rs, rs * flora.range(0.97, 1.05), rs);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          reedTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x4a8a36) });
        }
      }

      // 2. Areia Molhada da Orla (faixa até 0.85m): 100% limpa de árvores
      if (pt.height <= 0.85) {
        if (biome.type !== 'Manguezal Estuarino' && prng.chance(0.025)) {
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
      // (o deserto tem bem menos arbustos: ficam espaçados)
      const desertShrubMul = (biome.type === BiomeType.DESERT_DUNES || biome.type === BiomeType.CANYON_DESERT) ? 0.4 : 1;
      const shrubChance = (!isBeach && pt.slope < 0.52) ? biome.shrubDensity * 0.22 * desertShrubMul : 0;
      const maxRockSlope = pt.height > 45.0 ? 0.38 : 0.50;
      const canRock = pt.slope <= maxRockSlope;
      // (o deserto já tem pedras na medida; nos outros biomas elas eram raras)
      const rockChance = canRock ? biome.rockDensity * 0.16 * (desertShrubMul < 1 ? 1 : 2.6) : 0;
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

        const treeEmbed = Math.max(0.06, pt.slope * 0.15);   // as raízes se esticam até o chão no shader (ver gameTrees.ts)
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
        // cerejeira ou árvore ancestral no lugar (sempre adultas)
        const special = specialTree(wx, wz, biome.type, biome.moisture);
        if (special) {
          if (isSapling) {
            // muda de cerejeira ou de árvore ancestral
            dummy.scale.set(widthScale * 0.9, heightScale * 0.9, widthScale * 0.9);
            dummy.updateMatrix();
            shrubItems.push({ matrix: dummy.matrix.clone(), kind: special === 'sakura' ? 'sakuraSapling' : 'korokSapling' });
            continue;
          }
          dummy.scale.set(widthScale * 1.05, heightScale, widthScale * 1.05);
          dummy.updateMatrix();
          (special === 'sakura' ? sakuraItems : korokItems).push({
            matrix: dummy.matrix.clone(),
            trunkTint: new THREE.Color(0x6a4a3a),
            leafTint: new THREE.Color(special === 'sakura' ? 0xf0a0c0 : 0x5ab04a),
          });
          continue;
        }
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
            // as raízes se abrem para os lados: afunda o tronco para as pontas alcançarem o chão (e a lama)
            dummy.position.y = mangroveBaseY(wx, wz, pt.height);
            const mgSize = prng.range(0.62, 1.6) ** 1.15;   // de mangues baixos a bem altos
            const mgH = mgSize * prng.range(0.9, 1.12), mgW = mgSize * prng.range(0.85, 1.12);
            dummy.scale.set(mgW * 1.05, mgH, mgW * 1.05);
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
          // Pinheiro Glacial Nevado (e a muda dele)
          if (isSapling) {
            dummy.scale.set(widthScale * 0.9, heightScale * 0.9, widthScale * 0.9);
            dummy.updateMatrix();
            shrubItems.push({ matrix: dummy.matrix.clone(), kind: 'snowPineSapling' });
            continue;
          }
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

        shrubItems.push({ matrix: dummy.matrix.clone(), kind: shrubKindFor(biome.type, isArctic, prng.next()) });
      } else if (roll < treeChance + shrubChance + rockChance) {
        // 3. ROCHAS ASSENTADAS COM VARIEDADE (5 Formatos)
        const isArctic = biome.type === BiomeType.FROZEN_TUNDRA || (pt.iceInfluence || 0) > 0.15;
        const isPeakOrVolcano = biome.type === BiomeType.ROCKY_PEAKS || biome.type === BiomeType.SNOW_SUMMIT ||
          biome.type === BiomeType.VOLCANIC_FIELD || biome.type === BiomeType.VOLCANIC_CALDERA ||
          biome.type === BiomeType.CANYON_DESERT;
        const isForest = biome.type === BiomeType.TEMPERATE_FOREST || biome.type === BiomeType.AUTUMN_FOREST || biome.type === BiomeType.SAKURA_GROVE ||
          biome.type === BiomeType.TROPICAL_RAINFOREST || biome.type === BiomeType.BOREAL_TAIGA;

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
        const isForest = biome.type === BiomeType.TEMPERATE_FOREST || biome.type === BiomeType.AUTUMN_FOREST ||
          biome.type === BiomeType.TROPICAL_RAINFOREST || biome.type === BiomeType.BOREAL_TAIGA;

        if (enableDetailFlora && isForest && pt.slope < 0.45 && flora.chance(0.14)) {
          const fScale = flora.range(0.97, 1.05);
          dummy.position.set(wx, pt.height + 0.02, wz);
          dummy.scale.set(fScale, fScale, fScale);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          fernTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x42b828) });
        }
      }
    }
  }

  // plantas rasteiras do Pixel_Tree: samambaia, junco e flores (o canteiro de flores segue o clima do lugar)
  // Árvores não podem entrar muito umas nas outras (as copas se encostam, mas um tronco não nasce dentro da copa do vizinho):
  // da maior para a menor, cada árvore tira as menores cujo centro cai a menos de ~55% da soma das copas
  {
    const CROWN: [{ matrix: THREE.Matrix4 }[], number][] = [
      [oakItems, 4.5], [broadOakItems, 5.5], [pineItems, 2.5], [birchItems, 2.8], [twinBirchItems, 3.2], [palmItems, 3.2],
      [acaciaItems, 5.0], [mapleItems, 3.5], [mangroveItems, 3.0], [snowPineItems, 2.0], [arcticWillowItems, 2.5],
      [sakuraItems, 4.0], [korokItems, 5.0], [deadTreeTransforms, 2.0],
    ];
    type TE = { list: { matrix: THREE.Matrix4 }[]; item: { matrix: THREE.Matrix4 }; x: number; z: number; r: number; k: number };
    const all: TE[] = [];
    for (const [list, base] of CROWN) {
      const k = list === mangroveItems ? 0.3 : 0.55;
      for (const item of list) {
        const e = item.matrix.elements;
        const s = Math.hypot(e[0], e[1], e[2]) || 1;
        all.push({ list, item, x: e[12], z: e[14], r: base * Math.min(1.6, Math.max(0.6, s)), k });
      }
    }
    all.sort((p, q) => q.r - p.r);
    const kept: TE[] = [];
    const drop = new Set<{ matrix: THREE.Matrix4 }>();
    for (const t of all) {
      let clash = false;
      for (const o of kept) {
        const lim = (t.r + o.r) * Math.min(t.k, o.k);
        const dx = t.x - o.x, dz = t.z - o.z;
        if (dx * dx + dz * dz < lim * lim) { clash = true; break; }
      }
      if (clash) drop.add(t.item); else kept.push(t);
    }
    if (drop.size) for (const [list] of CROWN) {
      for (let i = list.length - 1; i >= 0; i--) if (drop.has(list[i])) list.splice(i, 1);
    }
  }
  // pedras e pedrinhas do Pixel_Tree: a de cada bioma (o tamanho vem de três variações, e não de esticar a instância)
  const rockBiomeKeyAt = (x: number, z: number): string => {
    const b = (terrainGen.getPointFast ? terrainGen.getPointFast(x, z) : terrainGen.getPoint(x, z)).biome;
    if (groveAt(x, z, b.type, b.moisture) === 'korok') return 'korok';
    // praia e chão seco: pedra sem musgo (a das terras secas), qualquer que seja o bioma em volta
    if (b.type === BiomeType.GEOTHERMAL_VALLEY || b.type === BiomeType.BEACH) return 'withered';
    if (b.moisture < 0.26) {
      if (b.type !== BiomeType.DESERT_DUNES && b.type !== BiomeType.CANYON_DESERT && b.type !== BiomeType.SAVANNAH) return 'withered';
    }
    switch (b.type) {
      case BiomeType.SAKURA_GROVE: return 'satori';
      case BiomeType.AUTUMN_FOREST: return 'akkala';
      case BiomeType.BOREAL_TAIGA: case BiomeType.ROCKY_PEAKS: return 'hebra';
      case BiomeType.SNOW_SUMMIT: case BiomeType.FROZEN_TUNDRA: return 'hebra_snowy';
      case BiomeType.ALPINE_TUNDRA: return 'tundra';
      case BiomeType.TROPICAL_RAINFOREST: return 'faron';
      case BiomeType.MANGROVE_SWAMP: return 'swamp';
      case BiomeType.DESERT_DUNES: case BiomeType.CANYON_DESERT: return 'gerudo';
      case BiomeType.SAVANNAH: return 'savanna';
      case BiomeType.VOLCANIC_FIELD: case BiomeType.VOLCANIC_CALDERA: return 'withered';
      default: return 'hyrule';
    }
  };
  {
    const rp = new THREE.Vector3(), rq = new THREE.Quaternion(), rs0 = new THREE.Vector3(), rone = new THREE.Vector3(1, 1, 1);
    const sets: [typeof rockBoulderTransforms, string][] = [[rockBoulderTransforms, 'rock_'], [rockSlateTransforms, 'rock_'], [rockSpireTransforms, 'rock_'], [rockMossyTransforms, 'rock_'], [rockPebblesTransforms, 'gravel_']];
    for (const [list, prefix] of sets) {
      for (const it of list) {
        it.matrix.decompose(rp, rq, rs0);
        // (a pedra velha era maior ou menor: o tamanho do desenho novo já varia por variação)
        // uma em cada oito pedras traz minério (ferro, cobre ou quartzo, conforme o bioma)
        const hh = Math.sin(rp.x * 12.9898 + rp.z * 78.233) * 43758.5453;
        const pfx = prefix === 'rock_' && (hh - Math.floor(hh)) < 0.125 ? 'ore_' : prefix;
        const bk = rockBiomeKeyAt(rp.x, rp.z);
        shrubItems.push({ matrix: new THREE.Matrix4().compose(rp, rq, rone), kind: pfx === 'ore_' ? 'ore_' + bk + '_' + oreAt(bk as never, rp.x, rp.z) : pfx + bk });
      }
      list.length = 0;
    }
  }
  // troncos e tocos do Pixel_Tree (no tamanho do desenho: esticar a instância esticaria os pixels)
  const logSets: [typeof logHollowTransforms, string][] = [[logHollowTransforms, 'logHollow'], [logRootedTransforms, 'logRooted'], [logStumpTransforms, 'logStump'], [logStraightTransforms, 'logFallen']];
  const lp = new THREE.Vector3(), lq = new THREE.Quaternion(), ls1 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (const [list, lk] of logSets) {
    for (const it of list) { it.matrix.decompose(lp, lq, ls1); shrubItems.push({ matrix: new THREE.Matrix4().compose(lp, lq, one), kind: lk }); }
    list.length = 0;
  }
  for (const it of fernTransforms) shrubItems.push({ matrix: it.matrix, kind: 'fernPlant' });
  for (const it of reedTransforms) shrubItems.push({ matrix: it.matrix, kind: 'reedClump' });
  for (const it of wildflowerTransforms) {
    const e = it.matrix.elements;
    const bt = (terrainGen.getPointFast ? terrainGen.getPointFast(e[12], e[14]) : terrainGen.getPoint(e[12], e[14])).biome.type;
    shrubItems.push({ matrix: it.matrix, kind: flowerKindFor(bt) });
  }
  fernTransforms.length = 0; reedTransforms.length = 0; wildflowerTransforms.length = 0;

  // Nada de planta, pedra ou tronco "dentro" de outra coisa: arbustos, samambaias, flores, mudas e juncos saem de perto de
  // troncos, cactos, pedras e troncos caídos; pedras e troncos caídos saem de perto dos troncos das árvores
  {
    type Ob = { x: number; z: number; r: number };
    const trunks: Ob[] = [];
    for (const [list] of [[oakItems], [broadOakItems], [pineItems], [birchItems], [twinBirchItems], [palmItems], [acaciaItems], [mapleItems], [mangroveItems], [snowPineItems], [arcticWillowItems], [sakuraItems], [korokItems], [deadTreeTransforms]] as { matrix: THREE.Matrix4 }[][][]) {
      for (const it of list) { const e = it.matrix.elements; trunks.push({ x: e[12], z: e[14], r: 1.15 * Math.min(1.6, Math.max(0.7, Math.hypot(e[0], e[1], e[2]) || 1)) }); }
    }
    for (const it of cactusTransforms) { const e = it.matrix.elements; trunks.push({ x: e[12], z: e[14], r: 0.8 }); }
    const hit = (x: number, z: number, pad: number, list: Ob[]): boolean => {
      for (const o of list) { const dx = x - o.x, dz = z - o.z, lim = o.r + pad; if (dx * dx + dz * dz < lim * lim) return true; }
      return false;
    };
    const isRock = (k: string) => k.startsWith('rock_') || k.startsWith('ore_'), isLog = (k: string) => k.startsWith('log');
    const isPlant = (k: string) => k.startsWith('shrub') || k.startsWith('flowers_') || k === 'fernPlant' || k === 'reedClump' || k.endsWith('Sapling') || k.startsWith('gravel_') || k.startsWith('leaves_');
    // pedras e troncos caídos primeiro (saem de perto dos troncos), depois eles viram obstáculos das plantas
    const solids: Ob[] = [];
    for (let i = shrubItems.length - 1; i >= 0; i--) {
      const s = shrubItems[i];
      const e = s.matrix.elements;
      if (isRock(s.kind)) {
        // o raio da pedra segue a variação de tamanho que o gerenciador sorteia pela posição (a mesma conta)
        const hv = Math.sin(e[12] * 12.9898 + e[14] * 78.233) * 43758.5453;
        const vi = Math.min(2, Math.floor((hv - Math.floor(hv)) * 3));
        const rr = 1.5 * (s.kind.startsWith('ore_') ? [1.3, 1.8, 2.4][vi] : [0.42, 0.68, 1.0][vi]) + 0.2;
        if (hit(e[12], e[14], rr * 0.7, trunks) || hit(e[12], e[14], rr * 0.8, solids)) shrubItems.splice(i, 1); else solids.push({ x: e[12], z: e[14], r: rr });
      }
      else if (isLog(s.kind)) { if (hit(e[12], e[14], 1.8, trunks) || hit(e[12], e[14], 0.3, solids)) shrubItems.splice(i, 1); else solids.push({ x: e[12], z: e[14], r: 2.4 }); }
    }
    for (let i = shrubItems.length - 1; i >= 0; i--) {
      const s = shrubItems[i];
      if (!isPlant(s.kind)) continue;
      const e = s.matrix.elements;
      const pad = s.kind.startsWith('flowers_') || s.kind === 'fernPlant' ? 0.5 : 0.35;
      if (hit(e[12], e[14], pad, trunks) || hit(e[12], e[14], pad, solids)) shrubItems.splice(i, 1);
    }
  }

  // (só se a pedra do anel sobreviveu à limpeza)
  for (const f of rockRingFerns) {
    if (shrubItems.some((s) => s.kind === 'rock_swamp' && Math.abs(s.matrix.elements[12] - f.cx) < 0.01 && Math.abs(s.matrix.elements[14] - f.cz) < 0.01)) shrubItems.push({ matrix: f.matrix, kind: f.kind });
  }
  rockRingFerns.length = 0;

  return { oakItems, broadOakItems, oakSaplingItems, pineItems, pineSaplingItems, birchItems, twinBirchItems, birchSaplingItems, palmItems, palmSaplingItems, acaciaItems, acaciaSaplingItems, mapleItems, mangroveItems, mangroveSaplingItems, snowPineItems, arcticWillowItems, sakuraItems, korokItems, deadTreeTransforms, cactusTransforms, cactusSaplingTransforms, shrubItems, rockBoulderTransforms, rockSlateTransforms, rockPebblesTransforms, rockSpireTransforms, rockMossyTransforms, logHollowTransforms, logRootedTransforms, logStumpTransforms, logStraightTransforms, fernTransforms, wildflowerTransforms, reedTransforms, lilyTransforms, duckTransforms, moundTransforms, barrelTransforms, pearTransforms, tumbleTransforms, petalTransforms, lanternTransforms };
}

export type ChunkVegetationPlan = ReturnType<typeof planChunkVegetationGen> extends Generator<unknown, infer R, unknown> ? R : never;

export function planChunkVegetation(chunkX: number, chunkZ: number, chunkSize: number, terrainGen: ITerrainQueryable, enableDetailFlora: boolean = true): ChunkVegetationPlan {
  const g = planChunkVegetationGen(chunkX, chunkZ, chunkSize, terrainGen, enableDetailFlora);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
