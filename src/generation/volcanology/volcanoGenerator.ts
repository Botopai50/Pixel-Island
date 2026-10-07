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

/**
 * Vulcões espalhados pelo mundo: o "de casa" perto da origem (sempre existe) e, no resto do mapa,
 * um sorteio por célula de VOLCANO_CELL metros (chance VOLCANO_CHANCE), sempre em terra firme e
 * longe da costa. Cada vulcão fica a VOLCANO_MARGIN da borda da célula (maior que o raio da base),
 * então um ponto só pode estar sob o vulcão da própria célula: a consulta é uma busca no cache.
 */
const VOLCANO_CELL = 4800;
const VOLCANO_MARGIN = 500;
const VOLCANO_CHANCE = 0.42;
/** distância mínima do vulcão de casa (não nasce outro colado nele) */
const HOME_CLEARANCE = 2200;

export class VolcanoGenerator {
  private noise: SimplexNoise;
  private seed: number;
  private macroGeo?: MacroGeography;
  private volcanoes: VolcanoCenter[] = [];
  private cells = new Map<number, VolcanoCenter | null>();

  constructor(seed: number = 0, macroGeo?: MacroGeography) {
    this.seed = seed;
    this.macroGeo = macroGeo;
    this.noise = new SimplexNoise(seed ^ 0x5a1b3c7d);
    this.initVolcanoes();
  }

  public reseed(seed: number): void {
    this.seed = seed;
    this.noise.reseed(seed ^ 0x5a1b3c7d);
    this.cells.clear();
    this.initVolcanoes();
  }

  /** Vulcão sorteado de uma célula (ou null), com cache. */
  private cellVolcano(cx: number, cz: number): VolcanoCenter | null {
    const key = cx * 73856093 ^ cz * 19349663;
    const cached = this.cells.get(key);
    if (cached !== undefined) return cached;
    let result: VolcanoCenter | null = null;
    const prng = new PRNG(Math.floor(PRNG.hash2D(cx, cz, this.seed ^ 0x7a1c5e) * 4294967295) || 1);
    if (prng.chance(VOLCANO_CHANCE)) {
      const home = this.volcanoes[0];
      const span = VOLCANO_CELL - VOLCANO_MARGIN * 2;
      for (let attempt = 0; attempt < 8 && !result; attempt++) {
        const x = cx * VOLCANO_CELL + VOLCANO_MARGIN + prng.next() * span;
        const z = cz * VOLCANO_CELL + VOLCANO_MARGIN + prng.next() * span;
        if (home && Math.hypot(x - home.x, z - home.z) < HOME_CLEARANCE) continue;
        if (this.macroGeo && this.macroGeo.getLandmassMask(x, z).coastDist < 170.0) continue;
        // tamanhos variados: de cones menores a estratovulcões do porte do de casa
        const size = prng.range(0.7, 1.05);
        const peakHeight = prng.range(128.0, 156.0) * size;
        const calderaDepth = prng.range(46.0, 60.0) * size;
        result = {
          x, z,
          baseRadius: prng.range(160.0, 192.0) * size,
          peakHeight,
          calderaRadius: prng.range(32.0, 42.0) * Math.sqrt(size),
          calderaDepth,
          lavaLevel: Math.round(peakHeight - calderaDepth * prng.range(0.48, 0.54)),
        };
      }
    }
    this.cells.set(key, result);
    return result;
  }

  /** Vulcões que podem tocar um círculo (x, z, raio). */
  public volcanoesNear(x: number, z: number, radius: number): VolcanoCenter[] {
    const out: VolcanoCenter[] = [];
    const home = this.volcanoes[0];
    if (home && Math.hypot(x - home.x, z - home.z) < radius + home.baseRadius) out.push(home);
    const c0x = Math.floor((x - radius) / VOLCANO_CELL), c1x = Math.floor((x + radius) / VOLCANO_CELL);
    const c0z = Math.floor((z - radius) / VOLCANO_CELL), c1z = Math.floor((z + radius) / VOLCANO_CELL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const v = this.cellVolcano(cx, cz);
      if (v && Math.hypot(x - v.x, z - v.z) < radius + v.baseRadius) out.push(v);
    }
    return out;
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

    const local = this.cellVolcano(Math.floor(x / VOLCANO_CELL), Math.floor(z / VOLCANO_CELL));
    const list = local ? [this.volcanoes[0], local] : this.volcanoes;
    for (const v of list) {
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

  /** O vulcão de casa (sempre o primeiro) e os das células já sorteadas. */
  public getVolcanoes(): VolcanoCenter[] {
    const out = this.volcanoes.slice();
    for (const v of this.cells.values()) if (v) out.push(v);
    return out;
  }
}
