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

/** Respiradouro menor do vale: fumarola (vapor e enxofre) ou poça de lama borbulhante. */
export interface ThermalVent {
  x: number;
  z: number;
  radius: number;
  kind: 'fumarole' | 'mudpot';
  /** fase própria (s) para o vapor não pulsar todo junto */
  phase: number;
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
  private vents: ThermalVent[] = [];

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

    this.initVents(prng);
  }

  /**
   * Fumarolas (buracos de vapor com enxofre) e poças de lama no vale, longe das fontes e entre si.
   * Sorteados DEPOIS das fontes, com o mesmo PRNG: as fontes continuam exatamente nos mesmos lugares.
   */
  private initVents(prng: PRNG): void {
    this.vents = [];
    const { x: vx, z: vz, radius: vr } = this.valley;
    const wantMud = 2 + Math.floor(prng.range(0, 1.99));
    const wantFum = 5 + Math.floor(prng.range(0, 2.99));
    const want = wantMud + wantFum;
    for (let attempt = 0; attempt < 240 && this.vents.length < want; attempt++) {
      const kind: ThermalVent['kind'] = this.vents.length < wantMud ? 'mudpot' : 'fumarole';
      const radius = kind === 'mudpot' ? prng.range(3.0, 4.6) : prng.range(1.2, 2.0);
      const a = prng.range(0, Math.PI * 2);
      const d = prng.range(8.0, vr * 0.52); // só no piso do vale (fora dele o bioma já é outro)
      const x = vx + Math.cos(a) * d, z = vz + Math.sin(a) * d;
      let ok = true;
      for (const s of this.springs) {
        if (Math.hypot(x - s.x, z - s.z) < s.radius * 1.7 + radius + 3.0) { ok = false; break; }
      }
      if (ok) for (const o of this.vents) {
        if (Math.hypot(x - o.x, z - o.z) < o.radius + radius + 6.0) { ok = false; break; }
      }
      if (!ok) continue;
      this.vents.push({ x, z, radius, kind, phase: prng.range(0, 20) });
    }
  }

  public getVents(): ThermalVent[] {
    return this.vents;
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
        // Bacia côncava: o fundo sobe do ponto mais fundo (centro) até o NÍVEL DA ÁGUA exatamente na
        // margem (norm = 1), sem degrau. Antes o relevo dava um salto de ~2m na margem: entre dois
        // vértices da malha (que tem células de vários metros) a altura da água cruzava o relevo num
        // ponto qualquer do triângulo, e a margem da poça saía como um polígono serrilhado.
        const basinBed = s.waterLevel - s.poolDepth * (1.0 - norm * norm);
        const offset = basinBed - currentElevation;
        return { heightOffset: offset, influence: 1.0, isThermalPool: true, ringFactor: norm };
      } else {
        // Terraço mineral e borda de travertino sinterizado
        // (sobe a partir do nível da água, em ~0.12 do raio, até o perfil da borda: contínuo na margem)
        const rimProg = (norm - 1.0) / 0.45;
        const rise = Math.min(1.0, (norm - 1.0) / 0.12);
        const rimHeight = s.waterLevel + rise * (1.2 + 1.3 * Math.sin(rimProg * Math.PI));
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
