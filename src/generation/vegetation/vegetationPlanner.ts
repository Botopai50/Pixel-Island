import * as THREE from 'three';
import { PRNG } from '../math/prng.ts';
import { TerrainPoint, BiomeType } from '../types.ts';
import { CONFIG } from '../../config.ts';
import { landmarksNear } from '../landmarks/landmarkPlanner.ts';

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

export function planChunkVegetation(
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

  // Landmarks: o espaço de cada cena fica livre de árvores, pedras e troncos
  const tgAny = terrainGen as any;
  const landmarks = CONFIG.LANDMARKS_ENABLED && tgAny.getDryHeight ? landmarksNear(tgAny, startX, startZ, startX + chunkSize, startZ + chunkSize) : [];
  const inLandmark = (x: number, z: number) => {
    for (const l of landmarks) if ((x - l.x) ** 2 + (z - l.z) ** 2 < l.radius * l.radius) return true;
    return false;
  };

  for (let ix = 0; ix < steps; ix++) {
    for (let iz = 0; iz < steps; iz++) {
      const jx = (prng.next() - 0.5) * sampleStep * 0.85;
      const jz = (prng.next() - 0.5) * sampleStep * 0.85;
      const wx = startX + (ix + 0.5) * sampleStep + jx;
      const wz = startZ + (iz + 0.5) * sampleStep + jz;
      if (landmarks.length && inLandmark(wx, wz)) continue;

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
      if (enableDetailFlora && pt.height >= 0.12 && pt.height <= 1.40 && pt.slope < 0.32 && !isBeach) {
        if (flora.chance(0.065)) {
          const rScale = flora.range(0.85, 1.35);
          dummy.position.set(wx, pt.height - 0.02, wz);
          dummy.scale.set(rScale, rScale * flora.range(0.95, 1.25), rScale);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
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
        const isForest = biome.type === BiomeType.TEMPERATE_FOREST || biome.type === BiomeType.AUTUMN_FOREST ||
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
        const isMeadow = biome.type === BiomeType.COASTAL_MEADOW || biome.type === BiomeType.SAVANNAH;

        if (enableDetailFlora && isForest && pt.slope < 0.45 && flora.chance(0.14)) {
          const fScale = flora.range(0.85, 1.35);
          dummy.position.set(wx, pt.height + 0.02, wz);
          dummy.scale.set(fScale, fScale * flora.range(0.9, 1.15), fScale);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          fernTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0x42b828) });
        } else if (enableDetailFlora && isMeadow && pt.slope < 0.38 && flora.chance(0.12)) {
          const wScale = flora.range(0.9, 1.3);
          dummy.position.set(wx, pt.height + 0.02, wz);
          dummy.scale.set(wScale, wScale, wScale);
          dummy.rotation.set(0, flora.range(0, Math.PI * 2), 0);
          dummy.updateMatrix();
          wildflowerTransforms.push({ matrix: dummy.matrix.clone(), tint: new THREE.Color(0xffffff) });
        }
      }
    }
  }

  return { oakItems, broadOakItems, oakSaplingItems, pineItems, pineSaplingItems, birchItems, twinBirchItems, birchSaplingItems, palmItems, palmSaplingItems, acaciaItems, acaciaSaplingItems, mapleItems, mangroveItems, mangroveSaplingItems, snowPineItems, arcticWillowItems, deadTreeTransforms, cactusTransforms, cactusSaplingTransforms, shrubLushTransforms, shrubBerryTransforms, rockBoulderTransforms, rockSlateTransforms, rockPebblesTransforms, rockSpireTransforms, rockMossyTransforms, logHollowTransforms, logRootedTransforms, logStumpTransforms, logStraightTransforms, fernTransforms, wildflowerTransforms, reedTransforms };
}

export type ChunkVegetationPlan = ReturnType<typeof planChunkVegetation>;
