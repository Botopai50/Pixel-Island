import { SimplexNoise } from '../math/simplexNoise.ts';
import { PRNG } from '../math/prng.ts';
import { MacroGeography } from '../geography/macroGeography.ts';
import { clamp } from '../math/mathUtils.ts';

export interface VolcanoCenter {
  x: number;
  z: number;
  baseRadius: number;
  peakHeight: number;
  calderaRadius: number;
  calderaDepth: number;
  lavaLevel: number;
}

export interface VolcanoQueryResult {
  heightOffset: number;
  influence: number;
  isCaldera: boolean;
  isLava: boolean;
  lavaLevel: number;
  ashFactor: number;
}

export class VolcanoGenerator {
  private noise: SimplexNoise;
  private seed: number;
  private macroGeo?: MacroGeography;
  private volcanoes: VolcanoCenter[] = [];

  constructor(seed: number = 0, macroGeo?: MacroGeography) {
    this.seed = seed;
    this.macroGeo = macroGeo;
    this.noise = new SimplexNoise(seed ^ 0x5a1b3c7d);
    this.initVolcanoes();
  }

  public reseed(seed: number): void {
    this.seed = seed;
    this.noise.reseed(seed ^ 0x5a1b3c7d);
    this.initVolcanoes();
  }

  private initVolcanoes(): void {
    const prng = new PRNG(this.seed ^ 0x5a1b3c7d);
    this.volcanoes = [];

    // Busca determinística de um ponto de erupção continental profundo (coastDist > 140m)
    // Garantindo que o estratovulcão NUNCA nasça no oceano e tenha amplo relevo ao seu redor
    let vx = -380.0;
    let vz = 420.0;
    let bestCoastDist = -9999;

    if (this.macroGeo) {
      for (let attempt = 0; attempt < 48; attempt++) {
        const angle = prng.range(0, Math.PI * 2);
        const dist = prng.range(280.0, 620.0);
        const candX = Math.cos(angle) * dist;
        const candZ = Math.sin(angle) * dist;
        const { coastDist } = this.macroGeo.getLandmassMask(candX, candZ);

        if (coastDist > 140.0) {
          vx = candX;
          vz = candZ;
          bestCoastDist = coastDist;
          break;
        } else if (coastDist > bestCoastDist) {
          bestCoastDist = coastDist;
          vx = candX;
          vz = candZ;
        }
      }
    }

    // Parâmetros morfométricos procedurais do estratovulcão
    const baseRadius = prng.range(160.0, 192.0);
    const peakHeight = prng.range(138.0, 156.0);
    const calderaRadius = prng.range(34.0, 42.0);
    const calderaDepth = prng.range(50.0, 62.0);
    // Cota da lava contida com segurança entre 48% e 55% da profundidade da caldeira
    const lavaLevel = Math.round(peakHeight - calderaDepth * prng.range(0.48, 0.54));

    this.volcanoes.push({
      x: vx,
      z: vz,
      baseRadius,
      peakHeight,
      calderaRadius,
      calderaDepth,
      lavaLevel
    });
  }

  public query(x: number, z: number): VolcanoQueryResult {
    let maxInfluence = 0.0;
    let bestHeightOffset = 0.0;
    let isCaldera = false;
    let isLava = false;
    let lavaLevel = 0.0;
    let ashFactor = 0.0;

    for (const v of this.volcanoes) {
      const dx = x - v.x;
      const dz = z - v.z;
      const d = Math.sqrt(dx * dx + dz * dz);

      if (d < v.baseRadius) {
        const normD = d / v.baseRadius;
        const infl = Math.pow(1.0 - normD, 1.2);
        if (infl > maxInfluence) {
          maxInfluence = infl;
          lavaLevel = v.lavaLevel;

          // Perfil cônico íngreme de estratovulcão monumental (inclinação acentuada de 45° a 55°)
          let coneHeight = 0.0;
          if (d >= v.calderaRadius) {
            // Encosta externa cônica do vulcão: sobe do raio base (175m) até o anel da caldeira (38m)
            const u = (v.baseRadius - d) / (v.baseRadius - v.calderaRadius); // 0 na base, 1 no anel da caldeira
            // Curva exponencial com flanco íngreme clássico de estratovulcão
            const coneFactor = (Math.exp(u * 1.8) - 1.0) / (Math.exp(1.8) - 1.0);
            const ridgeNoise = Math.pow(Math.abs(this.noise.noise2D(dx * 0.035, dz * 0.035)), 1.3) * 16.0 * u;
            coneHeight = v.peakHeight * coneFactor + ridgeNoise;
          } else {
            // Interior da caldeira vulcânica: paredes abruptas que mergulham no lago de lava
            isCaldera = true;
            const innerRatio = d / v.calderaRadius; // 0 no centro, 1 na borda da caldeira
            // Parede quase vertical nos últimos 18% do raio da caldeira:
            if (innerRatio > 0.82) {
              const wallT = (innerRatio - 0.82) / 0.18; // 0 na água/lava, 1 no anel da caldeira
              coneHeight = (v.lavaLevel - 2.0) + (v.peakHeight - (v.lavaLevel - 2.0)) * Math.pow(wallT, 1.8);
            } else {
              // Fundo da cratera abaixo da cota da lava líquida (fundo rochoso a 85m para lava a 90m)
              coneHeight = (v.lavaLevel - 5.0) + Math.pow(innerRatio / 0.82, 2.0) * 3.0;
            }

            if (coneHeight <= v.lavaLevel) {
              isLava = true;
            }
          }

          bestHeightOffset = coneHeight;
          ashFactor = clamp(Math.pow(1.0 - normD, 1.1) * 1.8, 0.0, 1.0);
        }
      }
    }

    return {
      heightOffset: bestHeightOffset,
      influence: maxInfluence,
      isCaldera,
      isLava,
      lavaLevel,
      ashFactor
    };
  }

  public getVolcanoes(): VolcanoCenter[] {
    return this.volcanoes;
  }
}
