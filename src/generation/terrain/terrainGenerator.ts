import * as THREE from 'three';
import { SimplexNoise } from '../math/simplexNoise.ts';
import { MacroGeography } from '../geography/macroGeography.ts';
import { Hydrology } from '../hydrology/hydrology.ts';
import { BiomeManager } from '../ecology/biomes.ts';
import { VolcanoGenerator } from '../volcanology/volcanoGenerator.ts';
import { CanyonGenerator } from '../geography/canyonGenerator.ts';
import { GeothermalGenerator } from '../geothermal/geothermalGenerator.ts';
import { CONFIG } from '../../config.ts';
import { clamp, lerp, smoothstep } from '../math/mathUtils.ts';
import { TerrainPoint } from '../types.ts';

export class TerrainGenerator {
  private seed: number;
  private noise: SimplexNoise;
  private macroGeo: MacroGeography;
  private hydrology: Hydrology;
  private biomeMgr: BiomeManager;
  private volcanoGen: VolcanoGenerator;
  private canyonGen: CanyonGenerator;
  private geothermalGen: GeothermalGenerator;

  constructor(seed: number = 0) {
    this.seed = seed;
    this.noise = new SimplexNoise(seed ^ 0x1f83d9ab);
    this.macroGeo = new MacroGeography(seed);
    this.volcanoGen = new VolcanoGenerator(seed, this.macroGeo);
    this.geothermalGen = new GeothermalGenerator(seed, this.macroGeo, this.volcanoGen);
    this.hydrology = new Hydrology(seed, this.macroGeo, this.volcanoGen, this.geothermalGen);
    this.biomeMgr = new BiomeManager(seed);
    this.canyonGen = new CanyonGenerator(seed, this.macroGeo, this.volcanoGen);
  }

  public reseed(seed: number): void {
    this.seed = seed;
    this.noise.reseed(seed ^ 0x1f83d9ab);
    this.macroGeo.reseed(seed);
    this.volcanoGen.reseed(seed);
    this.geothermalGen.reseed(seed);
    this.hydrology.reseed(seed, this.macroGeo, this.volcanoGen, this.geothermalGen);
    this.biomeMgr.reseed(seed);
    this.canyonGen.reseed(seed);
  }

  public getSeed(): number {
    return this.seed;
  }

  public getClimate(x: number, z: number, elevation: number): { temperature: number; moisture: number } {
    const hydro = this.hydrology.queryHydrology(x, z);
    return this.biomeMgr.getClimate(x, z, elevation, hydro.moistureBonus);
  }

  public getHeight(x: number, z: number): number {
    const { landFactor, coastDist, spineFactor } = this.macroGeo.getLandmassMask(x, z);

    // 1. Mar aberto profundo / fundo abissal do oceano
    if (landFactor <= 0.001 || coastDist <= -200.0) {
      const oceanFloorNoise = this.noise.fbm2D(x * 0.004, z * 0.004, 3) * 8.0;
      return CONFIG.OCEAN_FLOOR + oceanFloorNoise;
    }

    const macroRelief = this.macroGeo.getMacroRelief(x, z, spineFactor, landFactor);
    const mesoNoise = this.noise.fbm2D(x * 0.015, z * 0.015, 4, 0.45, 2.1) * 7.5;
    const microNoise = this.noise.noise2D(x * 0.06, z * 0.06) * 1.4;

    // Amortecimento alpino: atenua oscilações de alta frequência nas montanhas e cumes nevados,
    // garantindo cristas e encostas facetadas, imponentes e livres de agulhas/dentes de serra
    const alpineFactor = smoothstep(28.0, 75.0, macroRelief);
    const mesoMultiplier = lerp(1.0, 0.20, alpineFactor);
    const microMultiplier = lerp(1.0, 0.06, alpineFactor);
    const effectiveMeso = mesoNoise * mesoMultiplier;
    const effectiveMicro = microNoise * microMultiplier;

    let rawElevation: number;

    // 2. Transição Costeira Perfeitamente Contínua C1 (Sem degraus, falésias artificiais ou dentes de serra)
    if (coastDist <= 0.0) {
      // Mar adentro: declive subaquático suave a partir de 0.0m na arrebentação
      const oceanDist = -coastDist;
      const shallowBed = -oceanDist * 0.08;
      const deepProg = smoothstep(15.0, 180.0, oceanDist);
      const deepBed = lerp(-1.2, CONFIG.OCEAN_FLOOR, deepProg);
      const bedNoiseDamp = smoothstep(15.0, 60.0, oceanDist);
      const bedNoise = (mesoNoise * 0.25) * bedNoiseDamp;
      rawElevation = lerp(shallowBed, deepBed + bedNoise, deepProg);
    } else {
      // Em terra firme: rampa suave da praia com inclinação idêntica na linha d'água
      const beachSlope = 0.08;
      const beachRamp = coastDist * beachSlope;
      const inlandProg = smoothstep(25.0, 75.0, coastDist);
      const noiseDamp = smoothstep(0.0, 25.0, coastDist);
      const inlandRelief = (macroRelief + effectiveMeso + effectiveMicro * noiseDamp) * landFactor;
      rawElevation = lerp(beachRamp, Math.max(beachRamp, inlandRelief), inlandProg);
    }

    const hydro = this.hydrology.queryHydrology(x, z, rawElevation);
    if (hydro.lakeOffset !== 0 && hydro.riverCarving > 0) {
      const riverH = rawElevation - hydro.riverCarving;
      rawElevation = Math.min(rawElevation + hydro.lakeOffset, riverH);
    } else if (hydro.lakeOffset !== 0) {
      rawElevation += hydro.lakeOffset;
    } else if (hydro.riverCarving > 0) {
      rawElevation = rawElevation - hydro.riverCarving;
    }

    // 3. Aplicação de Relevos Geológicos Especiais (Vulcões, Cânions, Termalismo)
    const vRes = this.volcanoGen.query(x, z);
    if (vRes.influence > 0.0) {
      const tVolcano = smoothstep(0.0, 0.40, vRes.influence);
      rawElevation = lerp(rawElevation, Math.max(rawElevation, vRes.heightOffset), tVolcano);
      if (vRes.isCaldera) {
        // Dentro da caldeira, o leito da cratera afunda para a cota rochosa abaixo da lâmina líquida
        rawElevation = vRes.heightOffset;
      }
    }

    const cRes = this.canyonGen.query(x, z, rawElevation);
    if (cRes.carveDepth > 0.0) {
      rawElevation = Math.max(rawElevation - cRes.carveDepth, 2.5);
    }

    const gRes = this.queryGeothermal(x, z, rawElevation);
    if (gRes.heightOffset !== 0) {
      rawElevation += gRes.heightOffset;
    }

    return clamp(rawElevation, CONFIG.OCEAN_FLOOR, CONFIG.MAX_HEIGHT);
  }

  public queryGeothermal(x: number, z: number, currentElevation: number) {
    return this.geothermalGen.query(x, z, currentElevation);
  }

  public getIceInfluence(_x: number, z: number, y: number): number {
    if (z > -480.0) return 0.0;
    const latProg = clamp((-z - 480.0) / 280.0, 0.0, 1.0);
    const lowAltBonus = smoothstep(32.0, 4.0, y);
    return latProg * (0.4 + 0.6 * lowAltBonus);
  }

  public getTerrainExtra(x: number, z: number, y: number): [number, number, number, number] {
    const vRes = this.volcanoGen.query(x, z);
    const volcanoVal = vRes.isLava ? 1.0 : (vRes.influence * 0.85);

    const cRes = this.canyonGen.query(x, z, y);
    const canyonVal = cRes.influence;

    const gRes = this.queryGeothermal(x, z, y);
    const geothermalVal = gRes.influence > 0 ? (gRes.isThermalPool ? 0.9 : 0.5) : 0.0;

    const iceVal = this.getIceInfluence(x, z, y);

    return [volcanoVal, canyonVal, geothermalVal, iceVal];
  }

  /**
   * Avaliação unificada de vértice para malhas de chunk:
   * Calcula elevação, clima e atributos especiais em uma ÚNICA passagem,
   * poupando 50% de chamadas redundantes de ruído e consultas geológicas por vértice.
   */
  public getVertexData(x: number, z: number): {
    height: number;
    temperature: number;
    moisture: number;
    extra: [number, number, number, number];
  } {
    const { landFactor, coastDist, spineFactor } = this.macroGeo.getLandmassMask(x, z);

    if (landFactor <= 0.001 || coastDist <= -200.0) {
      const oceanFloorNoise = this.noise.fbm2D(x * 0.004, z * 0.004, 3) * 8.0;
      const h = CONFIG.OCEAN_FLOOR + oceanFloorNoise;
      const iceVal = this.getIceInfluence(x, z, h);
      return {
        height: h,
        temperature: 0.5,
        moisture: 1.0,
        extra: [0, 0, 0, iceVal]
      };
    }

    const macroRelief = this.macroGeo.getMacroRelief(x, z, spineFactor, landFactor);
    const mesoNoise = this.noise.fbm2D(x * 0.015, z * 0.015, 4, 0.45, 2.1) * 7.5;
    const microNoise = this.noise.noise2D(x * 0.06, z * 0.06) * 1.4;

    let rawElevation: number;

    // 2. Transição Costeira Perfeitamente Contínua C1 (Sem degraus, falésias artificiais ou dentes de serra)
    if (coastDist <= 0.0) {
      // Mar adentro: declive subaquático suave a partir de 0.0m na arrebentação
      const oceanDist = -coastDist;
      const shallowBed = -oceanDist * 0.08;
      const deepProg = smoothstep(15.0, 180.0, oceanDist);
      const deepBed = lerp(-1.2, CONFIG.OCEAN_FLOOR, deepProg);
      const bedNoiseDamp = smoothstep(15.0, 60.0, oceanDist);
      const bedNoise = (mesoNoise * 0.25) * bedNoiseDamp;
      rawElevation = lerp(shallowBed, deepBed + bedNoise, deepProg);
    } else {
      // Em terra firme: rampa suave da praia com inclinação idêntica na linha d'água
      const beachSlope = 0.08;
      const beachRamp = coastDist * beachSlope;
      const inlandProg = smoothstep(25.0, 75.0, coastDist);
      const noiseDamp = smoothstep(0.0, 25.0, coastDist);
      const inlandRelief = (macroRelief + mesoNoise + microNoise * noiseDamp) * landFactor;
      rawElevation = lerp(beachRamp, Math.max(beachRamp, inlandRelief), inlandProg);
    }

    const hydro = this.hydrology.queryHydrology(x, z, rawElevation);
    if (hydro.lakeOffset !== 0 && hydro.riverCarving > 0) {
      const riverH = rawElevation - hydro.riverCarving;
      rawElevation = Math.min(rawElevation + hydro.lakeOffset, riverH);
    } else if (hydro.lakeOffset !== 0) {
      rawElevation += hydro.lakeOffset;
    } else if (hydro.riverCarving > 0) {
      rawElevation = rawElevation - hydro.riverCarving;
    }

    const vRes = this.volcanoGen.query(x, z);
    if (vRes.influence > 0.0) {
      const tVolcano = smoothstep(0.0, 0.40, vRes.influence);
      rawElevation = lerp(rawElevation, Math.max(rawElevation, vRes.heightOffset), tVolcano);
      if (vRes.isCaldera) {
        rawElevation = vRes.heightOffset;
      }
    }

    const cRes = this.canyonGen.query(x, z, rawElevation);
    if (cRes.carveDepth > 0.0) {
      rawElevation = Math.max(rawElevation - cRes.carveDepth, 2.5);
    }

    const gRes = this.queryGeothermal(x, z, rawElevation);
    if (gRes.heightOffset !== 0) {
      rawElevation += gRes.heightOffset;
    }

    const height = clamp(rawElevation, CONFIG.OCEAN_FLOOR, CONFIG.MAX_HEIGHT);

    const volcanoVal = vRes.isLava ? 1.0 : (vRes.influence * 0.85);
    const canyonVal = cRes.influence;
    const geothermalVal = gRes.influence > 0 ? (gRes.isThermalPool ? 0.9 : 0.5) : 0.0;
    const iceVal = this.getIceInfluence(x, z, height);

    const climate = this.biomeMgr.getClimate(x, z, height, hydro.moistureBonus);

    return {
      height,
      temperature: climate.temperature,
      moisture: climate.moisture,
      extra: [volcanoVal, canyonVal, geothermalVal, iceVal]
    };
  }

  /**
   * Amostragem otimizada para vegetação:
   * Calcula a inclinação local com 2 amostras em vez de 4, poupando 40% de ruído.
   */
  public getPointFast(x: number, z: number): TerrainPoint {
    const h = this.getHeight(x, z);

    if (h <= CONFIG.SEA_LEVEL) {
      const hydro = this.hydrology.queryHydrology(x, z);
      const biome = this.biomeMgr.evaluateBiome(x, z, h, 0.0, hydro.moistureBonus, true);
      return {
        height: h,
        normal: new THREE.Vector3(0, 1, 0),
        slope: 0.0,
        isWater: true,
        waterSurfaceY: CONFIG.SEA_LEVEL,
        biome
      };
    }

    const eps = 1.0;
    const hX = this.getHeight(x + eps, z);
    const hZ = this.getHeight(x, z + eps);
    const dx = (hX - h) / eps;
    const dz = (hZ - h) / eps;
    const slope = Math.sqrt(dx * dx + dz * dz);
    const normal = new THREE.Vector3(-dx, 1.0, -dz).normalize();

    const hydro = this.hydrology.queryHydrology(x, z);
    let waterSurfaceY = CONFIG.SEA_LEVEL;
    let isWater = false;
    if (hydro.isWater && hydro.waterSurfaceY > h) {
      isWater = true;
      waterSurfaceY = Math.max(waterSurfaceY, hydro.waterSurfaceY);
    }

    const vRes = this.volcanoGen.query(x, z);
    const cRes = this.canyonGen.query(x, z, h);
    const gRes = this.queryGeothermal(x, z, h);
    const iceInfl = this.getIceInfluence(x, z, h);

    if (gRes.isThermalPool || vRes.isCaldera || vRes.isLava) {
      isWater = true;
    }

    const specialEnv = {
      volcanoInfluence: vRes.influence,
      isCaldera: vRes.isCaldera,
      canyonInfluence: cRes.influence,
      geothermalInfluence: gRes.influence,
      isThermalPool: gRes.isThermalPool,
      iceInfluence: iceInfl
    };

    const biome = this.biomeMgr.evaluateBiome(x, z, h, slope, hydro.moistureBonus, isWater, specialEnv);

    return {
      height: h,
      normal,
      slope,
      isWater,
      waterSurfaceY,
      biome,
      volcanoInfluence: vRes.influence,
      canyonInfluence: cRes.influence,
      geothermalInfluence: gRes.influence,
      iceInfluence: iceInfl
    };
  }

  public getPoint(x: number, z: number): TerrainPoint {
    const h = this.getHeight(x, z);

    // Otimização: se for água oceânica, declive e normais não precisam ser calculados (pula 4 chamadas a getHeight)
    if (h <= CONFIG.SEA_LEVEL) {
      const hydro = this.hydrology.queryHydrology(x, z);
      const biome = this.biomeMgr.evaluateBiome(x, z, h, 0.0, hydro.moistureBonus, true);
      return {
        height: h,
        normal: new THREE.Vector3(0, 1, 0),
        slope: 0.0,
        isWater: true,
        waterSurfaceY: CONFIG.SEA_LEVEL,
        biome
      };
    }

    const eps = 0.6;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);

    const nx = (hL - hR) / (2 * eps);
    const nz = (hD - hU) / (2 * eps);
    const normal = new THREE.Vector3(nx, 1.0, nz).normalize();
    const slope = Math.sqrt(nx * nx + nz * nz);

    const hydro = this.hydrology.queryHydrology(x, z);

    let waterSurfaceY = CONFIG.SEA_LEVEL;
    let isWater = false;

    if (hydro.isWater && hydro.waterSurfaceY > h) {
      isWater = true;
      waterSurfaceY = Math.max(waterSurfaceY, hydro.waterSurfaceY);
    }

    const vRes = this.volcanoGen.query(x, z);
    const cRes = this.canyonGen.query(x, z, h);
    const gRes = this.queryGeothermal(x, z, h);
    const iceInfl = this.getIceInfluence(x, z, h);

    if (gRes.isThermalPool || vRes.isCaldera || vRes.isLava) {
      isWater = true;
    }

    const specialEnv = {
      volcanoInfluence: vRes.influence,
      isCaldera: vRes.isCaldera,
      canyonInfluence: cRes.influence,
      geothermalInfluence: gRes.influence,
      isThermalPool: gRes.isThermalPool,
      iceInfluence: iceInfl
    };

    const biome = this.biomeMgr.evaluateBiome(x, z, h, slope, hydro.moistureBonus, isWater, specialEnv);

    return {
      height: h,
      normal,
      slope,
      isWater,
      waterSurfaceY,
      biome,
      volcanoInfluence: vRes.influence,
      canyonInfluence: cRes.influence,
      geothermalInfluence: gRes.influence,
      iceInfluence: iceInfl,
      isLava: vRes.isLava
    };
  }

  public getMacro(): MacroGeography {
    return this.macroGeo;
  }

  public getHydrology(): Hydrology {
    return this.hydrology;
  }

  public getBiomeManager(): BiomeManager {
    return this.biomeMgr;
  }

  public getVolcanoGenerator(): VolcanoGenerator {
    return this.volcanoGen;
  }

  public getGeothermalGenerator(): GeothermalGenerator {
    return this.geothermalGen;
  }

  public getCanyonGenerator(): CanyonGenerator {
    return this.canyonGen;
  }
}
