import { SimplexNoise } from '../math/simplexNoise.ts';
import { PRNG } from '../math/prng.ts';
import { CONFIG } from '../../config.ts';
import { clamp, smoothstep, lerp } from '../math/mathUtils.ts';

export interface IslandCenter {
  x: number;
  z: number;
  radius: number;
  elongation: number;
  rotation: number;
  hasSatelliteIsles: boolean;
  satellites: { x: number; z: number; radius: number }[];
}

export class MacroGeography {
  private noise: SimplexNoise;
  private seed: number;

  constructor(seed: number = 0) {
    this.seed = seed;
    this.noise = new SimplexNoise(seed);
  }

  public reseed(seed: number): void {
    this.seed = seed;
    this.noise.reseed(seed);
  }

  // Província continental para compatibilidade com sistemas legados (hidrologia e spawn)
  public getIslandForCell(cellX: number, cellZ: number): IslandCenter {
    const cellHash = PRNG.hash2D(cellX, cellZ, this.seed ^ 0x9e3779b9);
    const prng = new PRNG(cellHash * 100000);

    const baseSpacing = CONFIG.ISLAND_GRID_SIZE * 1.5; // Espaçamento continental ampliado (~2400m)
    const jitterX = prng.range(-baseSpacing * 0.22, baseSpacing * 0.22);
    const jitterZ = prng.range(-baseSpacing * 0.22, baseSpacing * 0.22);
    const centerX = cellX * baseSpacing + jitterX;
    const centerZ = cellZ * baseSpacing + jitterZ;

    const radius = prng.range(CONFIG.ISLAND_BASE_RADIUS * 1.8, CONFIG.ISLAND_BASE_RADIUS * 2.8); // Raio continental (1000m - 1600m)
    const elongation = prng.range(1.2, 1.9);
    const rotation = prng.range(0, Math.PI * 2);

    const satellites: { x: number; z: number; radius: number }[] = [];
    const numSatellites = prng.range(3, 7);
    for (let i = 0; i < numSatellites; i++) {
      const dist = prng.range(radius * 0.85, radius * 1.45);
      const angle = prng.range(0, Math.PI * 2);
      const satRadius = prng.range(120, 320); // Subcontinentes e grandes ilhas costeiras
      satellites.push({
        x: centerX + Math.cos(angle) * dist,
        z: centerZ + Math.sin(angle) * dist,
        radius: satRadius
      });
    }

    return {
      x: centerX,
      z: centerZ,
      radius,
      elongation,
      rotation,
      hasSatelliteIsles: true,
      satellites
    };
  }

  /**
   * Campo Contínuo de Continentalidade Multi-Escala:
   * Em vez de discos isolados em grade, o relevo é governado por tectônica de placas contínua,
   * deformação de domínio em grande escala, cordilheiras montanhosas longitudinais e oceanos amplos.
   */
  public getLandmassMask(x: number, z: number): {
    landFactor: number;
    coastDist: number;
    spineFactor: number;
    nearestIsland: IslandCenter;
  } {
    // 1. Deformação de Domínio Tectônico de Grande Escala (Domain Warping Continental)
    // Deforma as fronteiras em até ±850 metros, criando penínsulas, grandes golfos e istmos naturais
    const warpFreq1 = 0.00015;
    const warpFreq2 = 0.00042;
    const wx = this.noise.noise2D(x * warpFreq1, z * warpFreq1) * 750.0 +
               this.noise.noise2D(x * warpFreq2 + 31.0, z * warpFreq2 + 67.0) * 260.0;
    const wz = this.noise.noise2D(x * warpFreq1 + 59.0, z * warpFreq1 + 83.0) * 750.0 +
               this.noise.noise2D(x * warpFreq2 + 71.0, z * warpFreq2 + 97.0) * 260.0;

    const qx = x + wx;
    const qz = z + wz;

    // 2. Campo Base de Placas e Massas Continentais (comprimento de onda amplo de 6.000m a 14.000m)
    const continentFBM = this.noise.fbm2D(qx * 0.00014, qz * 0.00014, 4, 0.52, 2.05);

    // 3. Estreitos Tectônicos e Mares Interiores Amplos
    const straitNoise = Math.abs(this.noise.noise2D(qx * 0.00035 + 110.0, qz * 0.00035 + 230.0));
    const straitCut = smoothstep(0.03, 0.22, straitNoise);

    // Massa continental bruta (~65% terra firme continental, ~35% oceanos profundos)
    // Livre de âncoras circulares artificiais: o relevo flui livremente como placas geológicas reais
    const rawContinent = (continentFBM * 1.35 + 0.18) * lerp(0.60, 1.0, straitCut);

    // 4. Detalhamento Costeiro Orgânico e Limpo (Zero ruído estático ou fatiamento tipo queijo suíço)
    // Ondulações suaves de baías e promontórios sem rasgar buracos de água no interior
    const coastDetail = this.noise.fbm2D(qx * 0.00095, qz * 0.00095, 3, 0.45, 2.1) * 0.10;
    const coastalEnvelope = smoothstep(0.18, 0.01, Math.abs(rawContinent));
    const coastalPerturbation = coastDetail * coastalEnvelope;

    // Continentalidade contínua final
    const continentalness = rawContinent + coastalPerturbation;

    // 5. Grandes Cordilheiras Tectônicas Continentais (Cadeias de Montanhas Longitudinais Contínuas)
    // Faixas tectônicas de colisão estendem-se por quilômetros através do continente
    const tectonicBelt1 = this.noise.ridgedFBM(qx * 0.00042 + 44.0, qz * 0.00042 + 88.0, 4, 2.05, 0.55);
    const tectonicBelt2 = this.noise.ridgedFBM(qx * 0.00026 - 62.0, qz * 0.00026 - 120.0, 3, 2.1, 0.50);
    const tectonicSpine = Math.max(tectonicBelt1 * 0.92, tectonicBelt2 * 0.78);

    // Cordilheiras se erguem no interior continental profundo
    const inlandWeight = smoothstep(0.04, 0.28, continentalness);
    const spineFactor = clamp(tectonicSpine * inlandWeight * 1.45, 0.0, 1.0);

    // 6. Distância da Costa e Fator de Terra Firme
    // Escala métrica continental: interior atinge mais de 400m a 800m da costa
    const coastDist = continentalness * 420.0;
    const landFactor = smoothstep(-0.06, 0.22, continentalness);

    // Identificador de província para compatibilidade
    const baseSpacing = CONFIG.ISLAND_GRID_SIZE;
    const cellX = Math.round(x / baseSpacing);
    const cellZ = Math.round(z / baseSpacing);
    const nearestIsland = this.getIslandForCell(cellX, cellZ);

    return {
      landFactor,
      coastDist,
      spineFactor,
      nearestIsland
    };
  }

  /**
   * Relevo Macro Continental:
   * Continentes possuem vastos planaltos interiores, vales fluviais, colinas onduladas
   * e imponentes cordilheiras de altitude glacial ao longo das espinhas tectônicas.
   */
  public getMacroRelief(x: number, z: number, spineFactor: number, landFactor: number): number {
    if (landFactor <= 0.001) return 0;

    // 1. Grandes Cordilheiras Tectônicas (Montanhas Altas e Cumes Nevados até ~110m)
    // Comprimento de onda amplo (> 150m) com cristas facetadas e sólidas
    const ridgeDetail = this.noise.ridgedFBM(x * 0.0014, z * 0.0014, 3, 2.0, 0.46);
    const mountainHeight = (spineFactor * 96.0) * (0.38 + 0.62 * ridgeDetail);

    // 2. Vales Fluviais e Cânions que cortam as montanhas
    const valleyNoise = this.noise.fbm2D(x * 0.0012 + 44.0, z * 0.0012 + 92.0, 3);
    const valleyCut = smoothstep(-0.30, 0.35, valleyNoise);

    // 3. Planaltos, Vales e Colinas Interiores (Rolling Hills & High Plateaus)
    // Dá vida aos vastos interiores continentais (planícies de savana, desertos, bosques e taigas)
    const plateauNoise = this.noise.fbm2D(x * 0.00065 + 71.0, z * 0.00065 + 13.0, 3);
    const rollingHills = this.noise.fbm2D(x * 0.0035, z * 0.0035, 4, 0.48, 2.0);
    const plateauContribution = smoothstep(0.08, 0.55, plateauNoise) * 24.0;
    const hillsContribution = rollingHills * 12.0;

    // Relevo combinado escalado proporcionalmente pela proximidade da terra firme
    const relief = (mountainHeight * valleyCut + plateauContribution + hillsContribution) * landFactor;
    return relief;
  }
}
