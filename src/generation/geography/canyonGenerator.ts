import { SimplexNoise } from '../math/simplexNoise.ts';
import { PRNG } from '../math/prng.ts';
import { MacroGeography } from '../geography/macroGeography.ts';
import { VolcanoGenerator } from '../volcanology/volcanoGenerator.ts';
import { smoothstep } from '../math/mathUtils.ts';

export interface CanyonQueryResult {
  carveDepth: number;
  influence: number;
  strataLayer: number;
  isCanyonFloor: boolean;
  isRavine: boolean;
}

export class CanyonGenerator {
  private noise: SimplexNoise;
  private seed: number;
  private macroGeo?: MacroGeography;
  private volcanoGen?: VolcanoGenerator;
  private centerX: number = 240.0;
  private centerZ: number = 200.0;
  private radiusX: number = 200.0;
  private radiusZ: number = 180.0;
  private baseWidth: number = 95.0;
  private stepCount: number = 5.0;

  constructor(seed: number = 0, macroGeo?: MacroGeography, volcanoGen?: VolcanoGenerator) {
    this.seed = seed;
    this.macroGeo = macroGeo;
    this.volcanoGen = volcanoGen;
    this.noise = new SimplexNoise(seed ^ 0x7c4e2a9f);
    this.initCanyon();
  }

  public reseed(seed: number): void {
    this.seed = seed;
    this.noise.reseed(seed ^ 0x7c4e2a9f);
    this.initCanyon();
  }

  private initCanyon(): void {
    const prng = new PRNG(this.seed ^ 0x7c4e2a9f);

    // Busca de uma área elevada de planalto continental para esculpir o cânion (coastDist > 100m)
    // Afastado com segurança da zona de erupção vulcânica (evita contaminação entre províncias geológicas)
    if (this.macroGeo) {
      for (let attempt = 0; attempt < 48; attempt++) {
        const angle = prng.range(0, Math.PI * 2);
        const dist = prng.range(180.0, 520.0);
        const candX = Math.cos(angle) * dist;
        const candZ = Math.sin(angle) * dist;
        const { coastDist } = this.macroGeo.getLandmassMask(candX, candZ);

        if (coastDist > 110.0) {
          if (this.volcanoGen) {
            const vList = this.volcanoGen.getVolcanoes();
            let tooClose = false;
            for (const v of vList) {
              const ddx = candX - v.x;
              const ddz = candZ - v.z;
              if (Math.sqrt(ddx * ddx + ddz * ddz) < (v.baseRadius + 220.0)) {
                tooClose = true;
                break;
              }
            }
            if (tooClose) continue;
          }
          this.centerX = candX;
          this.centerZ = candZ;
          break;
        }
      }
    } else {
      this.centerX = 240.0;
      this.centerZ = 200.0;
    }

    this.radiusX = prng.range(180.0, 225.0);
    this.radiusZ = prng.range(160.0, 205.0);
    this.baseWidth = prng.range(85.0, 110.0);
    this.stepCount = Math.floor(prng.range(4.0, 6.99));
  }

  public query(x: number, z: number, currentElevation: number): CanyonQueryResult {
    // Zona de Cânion Continental proceduramente localizada
    const dx = x - this.centerX;
    const dz = z - this.centerZ;
    const distFromCenter = Math.sqrt((dx * dx) / (this.radiusX * this.radiusX) + (dz * dz) / (this.radiusZ * this.radiusZ));

    if (distFromCenter > 1.2) {
      return { carveDepth: 0, influence: 0, strataLayer: 0, isCanyonFloor: false, isRavine: false };
    }

    const zoneInfluence = smoothstep(1.2, 0.6, distFromCenter);

    if (zoneInfluence <= 0.005 || currentElevation < 4.0) {
      return { carveDepth: 0, influence: zoneInfluence, strataLayer: 0, isCanyonFloor: false, isRavine: false };
    }

    // Sistema de meandros fractais que cortam o cânion principal
    const warpX = this.noise.noise2D(x * 0.004, z * 0.004) * 85.0;
    const warpZ = this.noise.noise2D(z * 0.004 + 50.0, x * 0.004 + 50.0) * 85.0;

    // Fendas principais do grande cânion relativas ao centro procedural
    const relX = dx + warpX;
    const relZ = dz + warpZ;
    const canyonAxis = Math.sin(relX * 0.012) * 120.0 + relZ;
    const canyonDistance = Math.abs(canyonAxis);

    // Ravinas afluentes estreitas (slot canyons)
    const tributaryNoise = Math.abs(this.noise.fbm2D((x + warpX) * 0.022, (z + warpZ) * 0.022, 3));
    const isRavineCut = tributaryNoise < 0.12 && zoneInfluence > 0.4;

    let carveDepth = 0.0;
    let isCanyonFloor = false;
    let isRavine = false;

    // Largura procedural do cânion principal
    const canyonWidth = this.baseWidth + this.noise.noise2D(x * 0.02, z * 0.02) * 35.0;

    if (canyonDistance < canyonWidth) {
      const prog = canyonDistance / canyonWidth; // 0 no centro, 1 na borda
      
      // Degraus estratificados (terrace steps) característicos de arenito e xisto
      const stepCount = this.stepCount;
      const steppedProg = Math.floor(prog * stepCount) / stepCount + Math.pow(prog * stepCount - Math.floor(prog * stepCount), 3.0) / stepCount;

      const maxCarve = Math.min(currentElevation - 4.5, 34.0);
      carveDepth = (1.0 - steppedProg) * maxCarve * zoneInfluence;

      if (prog < 0.18) {
        isCanyonFloor = true;
      }
    } else if (isRavineCut) {
      // Ravinas estreitas cortam até 18 metros
      const rProg = tributaryNoise / 0.12;
      const maxRavineCarve = Math.min(currentElevation - 5.0, 22.0);
      carveDepth = (1.0 - rProg) * maxRavineCarve * zoneInfluence;
      isRavine = true;
    }

    // Camada de estrato sedimentar para o shader (0 a 1)
    const strataLayer = ((currentElevation - carveDepth) % 6.0) / 6.0;

    return {
      carveDepth,
      influence: zoneInfluence,
      strataLayer,
      isCanyonFloor,
      isRavine
    };
  }

  public getCenter(): { x: number; z: number } {
    return { x: this.centerX, z: this.centerZ };
  }
}
