import { SimplexNoise } from '../math/simplexNoise.ts';
import { PRNG } from '../math/prng.ts';
import { clamp, dist2D, lerp, smoothstep } from '../math/mathUtils.ts';
import { CONFIG } from '../../config.ts';
import { MacroGeography } from '../geography/macroGeography.ts';
import { VolcanoGenerator } from '../volcanology/volcanoGenerator.ts';
import { GeothermalGenerator } from '../geothermal/geothermalGenerator.ts';

export interface RiverPoint {
  x: number;
  z: number;
  elevation: number;
  width: number;
  depth: number;
}

export interface RiverPath {
  points: RiverPoint[];
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Lake {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  waterLevel: number;
  depth: number;
}

export interface IslandHydrologyData {
  centerX: number;
  centerZ: number;
  islandRadius: number;
  rivers: RiverPath[];
  lakes: Lake[];
}

export interface HydrologyQueryResult {
  riverCarving: number;
  lakeOffset: number;
  isWater: boolean;
  waterSurfaceY: number;
  distanceToRiver: number;
  distanceToLake: number;
  isLake: boolean;
  moistureBonus: number;
}

export class Hydrology {
  private seed: number;
  private noise: SimplexNoise;
  private macroGeo?: MacroGeography;
  private volcanoGen?: VolcanoGenerator;
  private geothermalGen?: GeothermalGenerator;
  private islandHydroCache: Map<string, IslandHydrologyData> = new Map();

  constructor(
    seed: number = 0,
    macroGeo?: MacroGeography,
    volcanoGen?: VolcanoGenerator,
    geothermalGen?: GeothermalGenerator
  ) {
    this.seed = seed;
    this.macroGeo = macroGeo;
    this.volcanoGen = volcanoGen;
    this.geothermalGen = geothermalGen;
    this.noise = new SimplexNoise(seed ^ 0x5a827999);
  }

  public reseed(
    seed: number,
    macroGeo?: MacroGeography,
    volcanoGen?: VolcanoGenerator,
    geothermalGen?: GeothermalGenerator
  ): void {
    this.seed = seed;
    if (macroGeo) this.macroGeo = macroGeo;
    if (volcanoGen) this.volcanoGen = volcanoGen;
    if (geothermalGen) this.geothermalGen = geothermalGen;
    this.noise.reseed(seed ^ 0x5a827999);
    this.islandHydroCache.clear();
  }

  public getIslandHydrology(cellX: number, cellZ: number): IslandHydrologyData {
    const key = `${cellX}_${cellZ}`;
    if (this.islandHydroCache.has(key)) {
      return this.islandHydroCache.get(key)!;
    }

    const baseSpacing = CONFIG.ISLAND_GRID_SIZE;
    const cellHash = PRNG.hash2D(cellX, cellZ, this.seed ^ 0x27d4eb2d);
    const prng = new PRNG(cellHash * 100000);

    const centerX = cellX * baseSpacing + prng.range(-baseSpacing * 0.08, baseSpacing * 0.08);
    const centerZ = cellZ * baseSpacing + prng.range(-baseSpacing * 0.08, baseSpacing * 0.08);
    const islandRadius = CONFIG.ISLAND_BASE_RADIUS * 0.95;

    const rivers: RiverPath[] = [];
    const lakes: Lake[] = [];

    // =========================================================================
    // 1. LAGOS PROCEDURAIS BASEADOS NA SEMENTE E RELEVO CONTINENTAL
    // =========================================================================
    const lakeNamePrefixes = ['Esmeralda', 'Sereno', 'Cristalino', 'Brumoso', 'Silencioso', 'Azul', 'Profundo'];
    const numLakes = 1 + (Math.abs(Math.floor(cellHash * 1000)) % 2); // 1 ou 2 lagos procedurais por ilha

    for (let li = 0; li < numLakes; li++) {
      let bestX = centerX;
      let bestZ = centerZ;
      let bestScore = -999999;
      let foundSpot = false;

      const sectorStartAngle = (li / numLakes) * Math.PI * 2 + prng.range(-0.3, 0.3);

      if (this.macroGeo) {
        for (let attempt = 0; attempt < 48; attempt++) {
          const angle = sectorStartAngle + prng.range(-0.6, 0.6);
          const dist = prng.range(130.0, islandRadius * 0.52);
          const candX = centerX + Math.cos(angle) * dist;
          const candZ = centerZ + Math.sin(angle) * dist;

          // Distância mínima de outros lagos já gerados
          let tooCloseOtherLake = false;
          for (const existingLake of lakes) {
            if (dist2D(candX, candZ, existingLake.x, existingLake.z) < 280.0) {
              tooCloseOtherLake = true;
              break;
            }
          }
          if (tooCloseOtherLake) continue;

          const { coastDist, spineFactor, landFactor } = this.macroGeo.getLandmassMask(candX, candZ);
          if (coastDist < 75.0) continue; // Garante que o lago fique em terra firme interiorana

          // Evita zonas vulcânicas e fontes termais
          if (this.volcanoGen) {
            let tooCloseVolc = false;
            for (const v of this.volcanoGen.getVolcanoes()) {
              if (dist2D(candX, candZ, v.x, v.z) < v.baseRadius + 160.0) {
                tooCloseVolc = true;
                break;
              }
            }
            if (tooCloseVolc) continue;
          }

          if (this.geothermalGen) {
            let tooCloseGeo = false;
            for (const s of this.geothermalGen.getSprings()) {
              if (dist2D(candX, candZ, s.x, s.z) < 200.0) {
                tooCloseGeo = true;
                break;
              }
            }
            if (tooCloseGeo) continue;
          }

          const macroRelief = this.macroGeo.getMacroRelief(candX, candZ, spineFactor, landFactor);
          // Prefere vales e bacias naturais cênicas (relevo entre 12m e 26m)
          const score = coastDist * 0.35 - Math.abs(macroRelief - 18.0) + prng.range(-3.0, 3.0);
          if (score > bestScore) {
            bestScore = score;
            bestX = candX;
            bestZ = candZ;
            foundSpot = true;
          }
        }
      }

      if (!foundSpot) {
        continue; // Preserva apenas bacias genuínas em terra firme continental
      }

      const lakeRadius = prng.range(62.0, 82.0);
      const lakeDepth = prng.range(3.5, 4.8);
      const nameIndex = Math.abs(Math.floor(prng.next() * lakeNamePrefixes.length)) % lakeNamePrefixes.length;

      lakes.push({
        id: `lake_${cellX}_${cellZ}_${li}`,
        name: `Lago ${lakeNamePrefixes[nameIndex]}`,
        x: bestX,
        z: bestZ,
        radius: lakeRadius,
        waterLevel: CONFIG.SEA_LEVEL, // Água unificada do oceano global (y = 0.0m)
        depth: lakeDepth
      });
    }

    // =========================================================================
    // 2. RIOS PROCEDURAIS DINÂMICOS (Foz conectada ao mar sem barreiras)
    // =========================================================================
    let riverCount = 0;

    // A) Gera um rio efluente para cada lago que deságua contínua e diretamente no oceano
    for (let li = 0; li < lakes.length; li++) {
      const lake = lakes[li];

      // Varredura radial em 36 ângulos para encontrar o litoral mais próximo e o gradiente natural de descida
      let bestCoastAngle = 0;
      let minDistanceToCoast = 999999;
      let bestCoastTargetX = lake.x;
      let bestCoastTargetZ = lake.z;

      if (this.macroGeo) {
        for (let aStep = 0; aStep < 36; aStep++) {
          const testAngle = (aStep / 36) * Math.PI * 2;
          for (let stepD = 30.0; stepD <= 2800.0; stepD += 15.0) {
            const tx = lake.x + Math.cos(testAngle) * stepD;
            const tz = lake.z + Math.sin(testAngle) * stepD;
            const mask = this.macroGeo.getLandmassMask(tx, tz);

            if (mask.coastDist <= 0.0) {
              if (stepD < minDistanceToCoast) {
                minDistanceToCoast = stepD;
                bestCoastAngle = testAngle;
                bestCoastTargetX = tx;
                bestCoastTargetZ = tz;
              }
              break;
            }
          }
        }
      }

      // Vetor unitário apontando confiavelmente em direção ao mar aberto
      const unitX = Math.cos(bestCoastAngle);
      const unitZ = Math.sin(bestCoastAngle);
      const normX = -unitZ;
      const normZ = unitX;

      const rStartX = lake.x + unitX * (lake.radius * 0.85);
      const rStartZ = lake.z + unitZ * (lake.radius * 0.85);

      // Avança a foz mar adentro (pelo menos 80m a 150m sob o oceano ou coastDist <= -45m)
      // para cortar integralmente a rampa da praia e garantir fusão oceânica 100% contínua
      let oceanEndX = bestCoastTargetX;
      let oceanEndZ = bestCoastTargetZ;
      if (this.macroGeo) {
        for (let oStep = 15.0; oStep <= 150.0; oStep += 15.0) {
          const ox = bestCoastTargetX + unitX * oStep;
          const oz = bestCoastTargetZ + unitZ * oStep;
          const oMask = this.macroGeo.getLandmassMask(ox, oz);
          oceanEndX = ox;
          oceanEndZ = oz;
          if (oMask.coastDist <= -45.0) {
            break;
          }
        }
      } else {
        oceanEndX += unitX * 90.0;
        oceanEndZ += unitZ * 90.0;
      }

      const totalDist = dist2D(rStartX, rStartZ, oceanEndX, oceanEndZ);
      const numSteps = Math.max(28, Math.min(65, Math.floor(totalDist / 14.0)));
      const riverPts: RiverPoint[] = [];

      for (let s = 0; s <= numSteps; s++) {
        const t = s / numSteps;
        const baseX = lerp(rStartX, oceanEndX, t);
        const baseZ = lerp(rStartZ, oceanEndZ, t);

        // Meandros fractais orgânicos que serpenteiam pelo relevo interiorano,
        // amortecendo suavemente perto da foz para o rio entrar fluido e reto no oceano
        const meanderEnvelope = Math.sin(t * Math.PI) * smoothstep(0.0, 0.20, t) * smoothstep(1.0, 0.82, t);
        const mScale = meanderEnvelope * prng.range(20.0, 36.0);
        const mNoise = this.noise.noise2D(baseX * 0.005 + li * 50.0, baseZ * 0.005 + li * 50.0);
        const px = baseX + normX * mNoise * mScale;
        const pz = baseZ + normZ * mNoise * mScale;

        const pelev = CONFIG.SEA_LEVEL;
        // Alargamento estuarino na foz (estuário natural de 12m a 38m de largura)
        const pwidth = lerp(12.0, 38.0, smoothstep(0.0, 1.0, t));
        const pdepth = lerp(2.6, 4.8, t);

        riverPts.push({ x: px, z: pz, elevation: pelev, width: pwidth, depth: pdepth });
      }

      let rMinX = Infinity, rMaxX = -Infinity, rMinZ = Infinity, rMaxZ = -Infinity;
      for (const p of riverPts) {
        if (p.x < rMinX) rMinX = p.x;
        if (p.x > rMaxX) rMaxX = p.x;
        if (p.z < rMinZ) rMinZ = p.z;
        if (p.z > rMaxZ) rMaxZ = p.z;
      }

      rivers.push({
        points: riverPts,
        id: `river_${cellX}_${cellZ}_${riverCount++}`,
        minX: rMinX,
        maxX: rMaxX,
        minZ: rMinZ,
        maxZ: rMaxZ
      });

      // B) Tributário procedural ocasional brotando de vale interiorano
      if (prng.chance(0.65) && riverPts.length > 22) {
        const joinIdx = Math.floor(numSteps * prng.range(0.25, 0.50));
        const joinPt = riverPts[joinIdx];

        if (this.macroGeo) {
          const joinMask = this.macroGeo.getLandmassMask(joinPt.x, joinPt.z);
          // Tributários só nascem no interior continental profundo
          if (joinMask.coastDist >= 110.0) {
            const tribSteps = 20;
            let sideSign = 1.0;
            const testX = joinPt.x + normX * 120.0;
            const testZ = joinPt.z + normZ * 120.0;
            if (this.macroGeo.getLandmassMask(testX, testZ).coastDist < joinMask.coastDist) {
              sideSign = -1.0;
            }

            const tribStartX = joinPt.x + normX * sideSign * prng.range(100.0, 150.0);
            const tribStartZ = joinPt.z + normZ * sideSign * prng.range(100.0, 150.0);

            if (this.macroGeo.getLandmassMask(tribStartX, tribStartZ).coastDist >= 70.0) {
              const tribPts: RiverPoint[] = [];

              for (let ts = 0; ts <= tribSteps; ts++) {
                const tt = ts / tribSteps;
                const px = lerp(tribStartX, joinPt.x, tt);
                const pz = lerp(tribStartZ, joinPt.z, tt) + Math.sin(tt * Math.PI) * 12.0;
                const pelev = CONFIG.SEA_LEVEL;
                // Nascente afila suavemente em direção zero (olho d'água natural)
                const pwidth = lerp(0.0, joinPt.width * 0.72, smoothstep(0.0, 0.35, tt));
                const pdepth = lerp(0.2, joinPt.depth * 0.80, smoothstep(0.0, 0.35, tt));
                tribPts.push({ x: px, z: pz, elevation: pelev, width: pwidth, depth: pdepth });
              }

              let tMinX = Infinity, tMaxX = -Infinity, tMinZ = Infinity, tMaxZ = -Infinity;
              for (const p of tribPts) {
                if (p.x < tMinX) tMinX = p.x;
                if (p.x > tMaxX) tMaxX = p.x;
                if (p.z < tMinZ) tMinZ = p.z;
                if (p.z > tMaxZ) tMaxZ = p.z;
              }

              rivers.push({
                points: tribPts,
                id: `trib_${cellX}_${cellZ}_${riverCount++}`,
                minX: tMinX,
                maxX: tMaxX,
                minZ: tMinZ,
                maxZ: tMaxZ
              });
            }
          }
        }
      }
    }

    const data: IslandHydrologyData = {
      centerX,
      centerZ,
      islandRadius,
      rivers,
      lakes
    };

    this.islandHydroCache.set(key, data);
    return data;
  }

  public getLakes(): Lake[] {
    return this.getIslandHydrology(0, 0).lakes;
  }

  public getRivers(): RiverPath[] {
    return this.getIslandHydrology(0, 0).rivers;
  }

  public queryHydrology(x: number, z: number, currentElevation: number = 16.0): HydrologyQueryResult {
    const baseSpacing = CONFIG.ISLAND_GRID_SIZE;
    const cellX = Math.round(x / baseSpacing);
    const cellZ = Math.round(z / baseSpacing);

    let minRiverDist = 999999;
    let minLakeDist = 999999;
    let riverCarve = 0;
    let lakeOff = 0;
    let waterY = -999;
    let inWater = false;
    let inLake = false;
    let moisture = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const hydro = this.getIslandHydrology(cellX + dx, cellZ + dz);

        const dCenter = dist2D(x, z, hydro.centerX, hydro.centerZ);
        if (dCenter > hydro.islandRadius + 140) {
          continue;
        }

        // 1. Consulta e escultura de bacia para lagos continentais ("igual ao mar")
        for (const lake of hydro.lakes) {
          const dLake = dist2D(x, z, lake.x, lake.z);
          if (dLake < minLakeDist) minLakeDist = dLake;

          // Perturbação fractal para formar contornos orgânicos da bacia (baías, cabos e praias)
          const basinNoise = this.noise.noise2D(x * 0.016 + 42.0, z * 0.016 + 42.0) * 18.0 +
                             this.noise.noise2D(x * 0.042, z * 0.042) * 6.0;
          const effDist = dLake + basinNoise;
          const basinRadius = lake.radius * 1.35;

          if (effDist < basinRadius) {
            const waterLineDist = lake.radius * 0.95;
            let currentLakeOff = 0;

            if (effDist < waterLineDist) {
              // Leito lacustre submerso abaixo do nível do mar (0.0m)
              const norm = effDist / waterLineDist;
              const bedH = -lake.depth * (1.0 - (norm * norm));
              currentLakeOff = bedH - currentElevation;
              inWater = true;
              inLake = true;
              waterY = CONFIG.SEA_LEVEL;
              moisture = Math.max(moisture, 1.0);
            } else {
              // Encostas da bacia que sobem suavemente acima do nível do mar até a altitude circundante
              const norm = (effDist - waterLineDist) / (basinRadius - waterLineDist);
              const targetBankH = Math.max(0.15, currentElevation);
              const bankH = lerp(0.15, targetBankH, smoothstep(0.0, 1.0, norm));
              currentLakeOff = bankH - currentElevation;
              // Se o terreno já estiver abaixo do mar (oceano ou calha de rio), nunca ergue acima de 0m
              if (currentElevation <= 0.0 && currentLakeOff > 0) {
                currentLakeOff = 0;
              }
              moisture = Math.max(moisture, (1.0 - norm) * 0.85);
            }

            if (lakeOff === 0 || Math.abs(currentLakeOff) > Math.abs(lakeOff)) {
              lakeOff = currentLakeOff;
            }
          }
        }

        // 2. Consulta e escultura de calha para rios continentais (nível do mar 0.0m)
        for (const river of hydro.rivers) {
          if (x < river.minX - 50 || x > river.maxX + 50 || z < river.minZ - 50 || z > river.maxZ + 50) {
            continue;
          }

          const pts = river.points;
          for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i];
            const p2 = pts[i + 1];

            const minSegX = Math.min(p1.x, p2.x) - 45;
            const maxSegX = Math.max(p1.x, p2.x) + 45;
            const minSegZ = Math.min(p1.z, p2.z) - 45;
            const maxSegZ = Math.max(p1.z, p2.z) + 45;

            if (x < minSegX || x > maxSegX || z < minSegZ || z > maxSegZ) {
              continue;
            }

            const segDx = p2.x - p1.x;
            const segDz = p2.z - p1.z;
            const segLenSq = segDx * segDx + segDz * segDz;
            if (segLenSq === 0) continue;

            let u = ((x - p1.x) * segDx + (z - p1.z) * segDz) / segLenSq;
            u = clamp(u, 0.0, 1.0);

            const projX = p1.x + u * segDx;
            const projZ = p1.z + u * segDz;
            const d = dist2D(x, z, projX, projZ);

            if (d < minRiverDist) {
              minRiverDist = d;
            }

            const width = lerp(p1.width, p2.width, u);
            const depth = lerp(p1.depth, p2.depth, u);

            // Escultura contínua de calha fluvial no nível do mar:
            // - wWater: canal de água líquida submerso (< 0.0m, preenchido pelo oceano global)
            // - wValley: encostas ascendentes do vale onde as margens sobem acima de 0.0m
            const wWater = width * 0.60;
            const wValley = width * 1.80;

            if (d < wValley) {
              if (d < wWater) {
                // Leito submerso da calha fluvial abaixo de 0.0m
                const norm = d / wWater;
                const bedH = -depth * (1.0 - (norm * norm));
                const carve = Math.max(0, currentElevation - bedH);
                if (carve > riverCarve) riverCarve = carve;
                inWater = true;
                waterY = CONFIG.SEA_LEVEL;
                moisture = Math.max(moisture, 0.95);
              } else {
                // Encosta ascendente do vale fluvial: eleva-se suavemente de 0.15m até a altitude circundante
                const tBank = (d - wWater) / (wValley - wWater);
                const targetBankH = Math.max(0.15, currentElevation);
                const bankH = lerp(0.15, targetBankH, smoothstep(0.0, 1.0, tBank));
                const carve = Math.max(0, currentElevation - bankH);
                if (carve > riverCarve) riverCarve = carve;
                moisture = Math.max(moisture, (1.0 - tBank) * 0.85);
              }
            } else if (d < width * 3.0) {
              // Várzea ribeirinha e planície de inundação (apenas fertilidade/umidade)
              const tDelta = 1.0 - (d - wValley) / (width * 1.2);
              moisture = Math.max(moisture, tDelta * 0.50);
            }
          }
        }
      }
    }

    return {
      riverCarving: riverCarve,
      lakeOffset: lakeOff,
      isWater: inWater,
      waterSurfaceY: waterY,
      distanceToRiver: minRiverDist,
      distanceToLake: minLakeDist,
      isLake: inLake,
      moistureBonus: clamp(moisture, 0.0, 1.0)
    };
  }
}
