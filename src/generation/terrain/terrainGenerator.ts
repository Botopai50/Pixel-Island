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

    // 1. Mar aberto profundo / fundo abissal do oceano. Só depois de 200m da costa: o landFactor
    // zera já a ~24m, e retornar aqui antes criava um penhasco submarino (de -2m para -40m em
    // poucos metros) - a água passava de rasa a abismo de uma vez.
    if (coastDist <= -200.0) {
      return this.oceanFloor(x, z);
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
      rawElevation = this.continentalShelf(x, z, coastDist, mesoNoise);
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
    rawElevation = this.applyHydrology(rawElevation, hydro, coastDist);

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

  /**
   * Lagos e rios entalhando o relevo. O leito do rio some aos poucos nos primeiros 35m mar
   * adentro: sem isso ele continuava como uma vala reta e escura pela plataforma rasa.
   */
  private applyHydrology(
    elevation: number,
    hydro: { lakeOffset: number; riverCarving: number },
    coastDist: number
  ): number {
    const seaFade = coastDist < 0.0 ? smoothstep(-35.0, 0.0, coastDist) : 1.0;
    const riverCarving = hydro.riverCarving * seaFade;
    if (hydro.lakeOffset !== 0 && riverCarving > 0) {
      return Math.min(elevation + hydro.lakeOffset, elevation - riverCarving);
    }
    if (hydro.lakeOffset !== 0) return elevation + hydro.lakeOffset;
    if (riverCarving > 0) return elevation - riverCarving;
    return elevation;
  }

  private oceanFloor(x: number, z: number): number {
    return CONFIG.OCEAN_FLOOR + this.noise.fbm2D(x * 0.004, z * 0.004, 3) * 8.0;
  }

  /**
   * Plataforma continental: da arrebentação (0m) até 200m mar adentro, o fundo desce aos poucos
   * até o assoalho oceânico, terminando exatamente em oceanFloor() para não haver degrau.
   */
  private continentalShelf(x: number, z: number, coastDist: number, mesoNoise: number): number {
    const oceanDist = -coastDist;
    const shallowBed = -oceanDist * 0.08;
    const deepProg = smoothstep(15.0, 180.0, oceanDist);
    const deepBed = lerp(-1.2, CONFIG.OCEAN_FLOOR, deepProg);
    const nearNoise = (mesoNoise * 0.25) * smoothstep(15.0, 60.0, oceanDist);
    const farNoise = deepProg > 0.0 ? this.oceanFloor(x, z) - CONFIG.OCEAN_FLOOR : 0.0;
    const bedNoise = lerp(nearNoise, farNoise, deepProg);
    return lerp(shallowBed, deepBed + bedNoise, deepProg);
  }

  public queryGeothermal(x: number, z: number, currentElevation: number) {
    return this.geothermalGen.query(x, z, currentElevation);
  }

  public getIceInfluence(x: number, z: number, y: number): number {
    const polarZ = this.biomeMgr.polarLatitudeZ(x, z);
    if (polarZ > -480.0) return 0.0;
    const latProg = clamp((-polarZ - 480.0) / 280.0, 0.0, 1.0);
    const lowAltBonus = smoothstep(32.0, 4.0, y);
    return latProg * (0.4 + 0.6 * lowAltBonus);
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
