import { SimplexNoise } from '../math/simplexNoise.ts';
import { PRNG } from '../math/prng.ts';
import { MacroGeography } from '../geography/macroGeography.ts';
import { VolcanoGenerator } from '../volcanology/volcanoGenerator.ts';
import { smoothstep } from '../math/mathUtils.ts';

export interface ThermalSpring {
  x: number;
  z: number;
  radius: number;
  poolDepth: number;
  isGeyser: boolean;
  geyserInterval: number; // Segundos entre erupções
  geyserDuration: number;
  waterLevel: number;
}

export interface GeothermalValley {
  x: number;
  z: number;
  radius: number;
  baseElevation: number;
}

export interface GeothermalQueryResult {
  heightOffset: number;
  influence: number;
  isThermalPool: boolean;
  ringFactor: number;
}

export class GeothermalGenerator {
  private noise: SimplexNoise;
  private seed: number;
  private macroGeo?: MacroGeography;
  private volcanoGen?: VolcanoGenerator;
  private valley!: GeothermalValley;
  private springs: ThermalSpring[] = [];

  constructor(seed: number = 0, macroGeo?: MacroGeography, volcanoGen?: VolcanoGenerator) {
    this.seed = seed;
    this.macroGeo = macroGeo;
    this.volcanoGen = volcanoGen;
    this.noise = new SimplexNoise(seed ^ 0x48f2d91b);
    this.initGeothermal();
  }

  public reseed(seed: number): void {
    this.seed = seed;
    this.noise.reseed(seed ^ 0x48f2d91b);
    this.initGeothermal();
  }

  private initGeothermal(): void {
    const prng = new PRNG(this.seed ^ 0x48f2d91b);
    this.springs = [];

    // Busca procedural de um vale continental abrigado em terra firme (coastDist > 90m)
    // Afastado com segurança da zona de erupção vulcânica
    let valleyX = -240.0;
    let valleyZ = -190.0;
    let found = false;

    if (this.macroGeo) {
      for (let attempt = 0; attempt < 48; attempt++) {
        const angle = prng.range(0, Math.PI * 2);
        const dist = prng.range(200.0, 520.0);
        const candX = Math.cos(angle) * dist;
        const candZ = Math.sin(angle) * dist;
        const { coastDist } = this.macroGeo.getLandmassMask(candX, candZ);

        if (coastDist > 90.0) {
          if (this.volcanoGen) {
            const vList = this.volcanoGen.getVolcanoes();
            let tooClose = false;
            for (const v of vList) {
              const ddx = candX - v.x;
              const ddz = candZ - v.z;
              if (Math.sqrt(ddx * ddx + ddz * ddz) < (v.baseRadius + 180.0)) {
                tooClose = true;
                break;
              }
            }
            if (tooClose) continue;
          }
          valleyX = candX;
          valleyZ = candZ;
          found = true;
          break;
        }
      }
    }

    if (!found && !this.macroGeo) {
      valleyX = -240.0;
      valleyZ = -190.0;
    }

    const valleyRadius = prng.range(100.0, 130.0);
    const baseElevation = prng.range(14.5, 18.0);
    this.valley = {
      x: valleyX,
      z: valleyZ,
      radius: valleyRadius,
      baseElevation
    };

    // Gera 2 a 4 fontes hidrotermais procedurais perfeitamente espaçadas (zero sobreposição)
    const targetSprings = Math.floor(prng.range(2.0, 4.99));
    const candidateRadii = [
      prng.range(17.0, 22.0),
      prng.range(13.0, 17.5),
      prng.range(12.0, 16.0),
      prng.range(11.0, 14.5)
    ];

    for (let i = 0; i < targetSprings; i++) {
      const sRadius = candidateRadii[i] || prng.range(12.0, 17.0);

      // Busca um setor do vale onde a fonte fique perfeitamente espaçada das demais
      for (let attempt = 0; attempt < 48; attempt++) {
        const sAngle = (i / targetSprings) * Math.PI * 2 + prng.range(-0.45, 0.45);
        const sDist = prng.range(sRadius * 1.5, valleyRadius * 0.70);
        const sx = valleyX + Math.cos(sAngle) * sDist;
        const sz = valleyZ + Math.sin(sAngle) * sDist;

        // Garante separação estrita: as bordas de travertino (radius * 1.45) nunca se tocam nem se cortam
        let collides = false;
        for (const existing of this.springs) {
          const dx = sx - existing.x;
          const dz = sz - existing.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const minSafeDist = (sRadius * 1.45 + existing.radius * 1.45) + 12.0;
          if (dist < minSafeDist) {
            collides = true;
            break;
          }
        }

        if (!collides) {
          const sDepth = prng.range(2.8, 3.8);
          const isGeyser = prng.next() > 0.40;
          const geyserInterval = prng.range(6.5, 11.5);
          const geyserDuration = prng.range(2.5, 4.0);
          const waterLevel = baseElevation - prng.range(0.8, 1.2);

          this.springs.push({
            x: sx,
            z: sz,
            radius: sRadius,
            poolDepth: sDepth,
            isGeyser,
            geyserInterval,
            geyserDuration,
            waterLevel
          });
          break;
        }
      }
    }
  }

  public query(x: number, z: number, currentElevation: number): GeothermalQueryResult {
    // 1. Escultura de cada piscina termal individual com borda de travertino sinterizado
    // Avalia pela fonte de maior proximidade normalizada para transição simétrica perfeita
    let closestSpring: ThermalSpring | null = null;
    let minNorm = 999999;

    for (const s of this.springs) {
      const dx = x - s.x;
      const dz = z - s.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const norm = dist / s.radius;

      if (norm < 1.45 && norm < minNorm) {
        minNorm = norm;
        closestSpring = s;
      }
    }

    if (closestSpring && minNorm < 1.45) {
      const s = closestSpring;
      const norm = minNorm;
      if (norm < 1.0) {
        // Bacia côncava com água geotermal profunda
        const basinBed = (s.waterLevel + 1.2 - s.poolDepth) + s.poolDepth * 0.4 * Math.pow(norm, 2.0);
        const offset = basinBed - currentElevation;
        return { heightOffset: offset, influence: 1.0, isThermalPool: true, ringFactor: norm };
      } else {
        // Terraço mineral e borda de travertino sinterizado
        const rimProg = (norm - 1.0) / 0.45;
        const rimHeight = (s.waterLevel + 1.2) + 1.3 * Math.sin(rimProg * Math.PI);
        const offset = rimHeight - currentElevation;
        return { heightOffset: offset, influence: 1.0 - rimProg * 0.5, isThermalPool: false, ringFactor: 1.0 };
      }
    }

    // 2. Aplainamento suave do vale geotérmico geral para a cota base
    const dxV = x - this.valley.x;
    const dzV = z - this.valley.z;
    const dValley = Math.sqrt(dxV * dxV + dzV * dzV);

    if (dValley < this.valley.radius) {
      const valleyFactor = smoothstep(this.valley.radius, this.valley.radius * 0.4, dValley);
      const offset = (this.valley.baseElevation - currentElevation) * valleyFactor * 0.85;
      return { heightOffset: offset, influence: valleyFactor * 0.6, isThermalPool: false, ringFactor: 0 };
    }

    return { heightOffset: 0, influence: 0, isThermalPool: false, ringFactor: 0 };
  }

  public getSprings(): ThermalSpring[] {
    return this.springs;
  }

  public getValley(): GeothermalValley {
    return this.valley;
  }
}
