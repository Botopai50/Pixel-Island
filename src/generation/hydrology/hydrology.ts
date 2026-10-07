import { SimplexNoise } from '../math/simplexNoise.ts';
import { PRNG } from '../math/prng.ts';
import { clamp, dist2D, lerp, smoothstep } from '../math/mathUtils.ts';
import { CONFIG } from '../../config.ts';
import { MacroGeography } from '../geography/macroGeography.ts';
import { VolcanoGenerator } from '../volcanology/volcanoGenerator.ts';
import { GeothermalGenerator } from '../geothermal/geothermalGenerator.ts';
import { deriveWaterfalls, sculptWaterfall, waterfallSurface, waterfallMeshPoint, waterfallCenter, waterfallWidth, localWaterfall, WaterfallFeature } from './waterfallFeatures.ts';

export interface RiverPoint {
  x: number;
  z: number;
  /**
   * Fundo do vale: 0 (nível do mar) onde o rio tem água; acima de 0 no trecho seco da cabeceira,
   * onde o vale vai subindo até se encontrar com o terreno
   */
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
  /** Centro aproximado e raio equivalente (a forma real é a do vale inundado) */
  x: number;
  z: number;
  radius: number;
  /** Nível da água (o do mar) */
  waterLevel: number;
  depth: number;
}

export interface IslandHydrologyData {
  centerX: number;
  centerZ: number;
  islandRadius: number;
  rivers: RiverPath[];
  lakes: Lake[];
  /** Grade espacial dos trechos de rio: chave da célula -> [índice do rio, índice do ponto, ...] */
  segGrid: Map<number, number[]>;
  /** Caixa que envolve todos os rios/lagos (com margem): fora dela a consulta sai na hora */
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Distância (m) até a margem das represas numa grade (negativa dentro d'água); null sem lagos */
  lakeDist: Float32Array | null;
  gridX0: number; gridZ0: number; gridN: number;
  /**
   * Correções da varredura, grade de 3m: 1 = ilhota pequena que vira água, 2 = poça pequena solta
   * (água cercada de terra, sem ligação com rio/represa/mar) que vira terra
   */
  fills: { grid: Uint8Array; dry: Uint8Array; wet: Uint8Array; x0: number; z0: number; w: number; h: number } | null;
  /**
   * Bacias fechadas do relevo (grade de 20m, 1 = bacia): trechos abaixo do nível do mar dentro da
   * ilha, sem ligação com o oceano. O mar enchia essas bacias com poucos centímetros de água -
   * lagoas rasas por inteiro. Elas ganham fundo de verdade (margem em degrau, como as represas).
   */
  enclosed: Uint8Array | null;
}

export interface HydrologyQueryResult {
  /** Quanto a altura do terreno desce por causa de rios e lagos (sempre <= 0) */
  heightOffset: number;
  isWater: boolean;
  waterSurfaceY: number;
  distanceToRiver: number;
  distanceToLake: number;
  isLake: boolean;
  moistureBonus: number;
  /** 1 dentro da água, caindo a 0 alguns metros margem acima (faixa de areia úmida) */
  wetness: number;
}

/** Tamanho da célula da grade espacial dos rios (m) */
const SEG_CELL = 48;
/** Até onde (m, a partir da beira d'água) a encosta do vale pode ir para alcançar o terreno */
const VALLEY_REACH = 90.0;
/** Grade de drenagem: células de 20m numa janela de 4km em volta da ilha */
const DRAIN_CELL = 20.0;
const DRAIN_HALF = 2000.0;
/** Área de drenagem (em células) a partir da qual nasce um rio */
const RIVER_ACC = 170;
/**
 * O rio só aparece com água onde o fundo do vale já é baixo (a água é a do mar: rio acima disso
 * exigiria cavar um vale fundo demais até o nível do mar)
 */
const RIVER_MAX_H = 18.0;
/** Subida do fundo do vale seco acima da nascente (m por m) */
/** Alcance da sondagem da borda d'água (e da rampa da orla/margem do mar) */
const SHORE_R = 8.0;
const HEAD_GRADE = 0.10;

const cellKey = (cx: number, cz: number) => cx * 73856093 ^ cz * 19349663;

/**
 * Encosta do vale a partir da beira d'água: sobe devagar perto da água (faixa de areia) e cada
 * vez mais íngreme longe dela - em terreno baixo vira uma margem suave, em terreno alto um vale
 * encaixado (sem planícies de areia enormes).
 */
function valleyHeight(dFromWater: number, slope: number): number {
  // começa em 0 exatamente na beira: o perfil é contínuo com o leito (que também chega a 0 ali).
  // Um degrau na beira fazia a linha d'água seguir os triângulos da malha (borda serrilhada).
  return dFromWater * (slope + 0.08) + dFromWater * dFromWater * 0.006;
}

/** Mínimo suave: junta a encosta do vale ao terreno sem quina. */
function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Fila de prioridade mínima simples (heap binário) para o preenchimento de depressões. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, v: number) {
    const K = this.keys, V = this.vals;
    let i = K.length; K.push(k); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = k; V[i] = v;
  }
  pop(): number {
    const K = this.keys, V = this.vals;
    const top = V[0];
    const lk = K.pop()!, lv = V.pop()!;
    const n = K.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < n && K[l] < mk) { m = l; mk = K[l]; }
        if (r < n && K[r] < mk) { m = r; mk = K[r]; }
        if (m === i) break;
        K[i] = K[m]; V[i] = V[m]; i = m;
      }
      K[i] = lk; V[i] = lv;
    }
    return top;
  }
}

/**
 * Rios e lagos usando a MESMA água do mar (uma camada só de água no mundo), com o traçado de
 * rios de verdade: rede de drenagem calculada sobre o relevo.
 *
 * 1. O relevo da ilha é amostrado numa grade; cada célula escoa para a vizinha mais baixa (as
 *    depressões são preenchidas, então toda água chega ao mar).
 * 2. A área que drena por cada célula é acumulada rio abaixo. Onde ela passa de um limite nasce um
 *    rio: surgem naturalmente os afluentes se juntando em rios cada vez mais largos (rede
 *    dendrítica), correndo pelo fundo dos vales até o mar.
 * 3. Represas: em alguns pontos do rio principal, o vale rio acima é inundado até um nível - o lago
 *    fica comprido, seguindo o rio, com braços entrando pelos vales dos afluentes.
 * 4. O leito e o fundo dos lagos ficam abaixo do nível do mar (a água é a do oceano) e o vale sobe
 *    em encosta dos dois lados até o terreno em volta.
 */
export class Hydrology {
  private waterfalls = new WeakMap<IslandHydrologyData,WaterfallFeature[]>();

  public getWaterfalls(cellX=0,cellZ=0):WaterfallFeature[]{
    const data=this.getIslandHydrology(cellX,cellZ);
    if(!data.rivers.length||!this.heightSampler)return [];
    let features=this.waterfalls.get(data);
    if(!features){features=deriveWaterfalls(data,this.heightSampler);this.waterfalls.set(data,features);}
    return features;
  }

  public sculptWaterfalls(x:number,z:number,height:number):number{
    for(const f of this.nearbyWaterfalls(x,z))height=sculptWaterfall(f,x,z,height);
    return height;
  }

  public getTerrainMeshPoint(x:number,z:number){
    let p={x,z};for(const f of this.nearbyWaterfalls(x,z))p=waterfallMeshPoint(f,p.x,p.z);return p;
  }

  private nearbyWaterfalls(x:number,z:number):WaterfallFeature[]{
    const G=CONFIG.ISLAND_GRID_SIZE,cx=Math.round(x/G),cz=Math.round(z/G);
    const result=this.getWaterfalls(cx,cz);
    // Features are less than ~340m long (river and lake upstream); query adjoining owners only near a cell border.
    if(Math.abs(x-cx*G)>G*.5-340||Math.abs(z-cz*G)>G*.5-340){
      const all=[...result];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(dx||dz)all.push(...this.getWaterfalls(cx+dx,cz+dz));return all;
    }
    return result;
  }

  public queryHydrology(x:number,z:number,currentElevation=16):HydrologyQueryResult{
    const result=this.queryBaseHydrology(x,z,currentElevation);
    for(const f of this.nearbyWaterfalls(x,z)){
      const y=waterfallSurface(f,x,z);
      if(y!==null){result.isWater=true;result.waterSurfaceY=y;result.moistureBonus=Math.max(result.moistureBonus,.25);result.wetness=1;}
      else{
        // margem do lago da nascente: areia/terra úmida clara (e mais umidade para a vegetação)
        const q=localWaterfall(f,x,z),rel=q.z+f.length;
        if(rel>-6&&rel<80){
          const zc=Math.max(-f.length,Math.min(q.z,0)),half=waterfallWidth(f,zc)*.5,lateral=Math.abs(q.x-waterfallCenter(f,zc));
          const ring=(1-smoothstep(half,half+4.5,lateral))*Math.exp(-(((rel-24)/26)**2));
          if(ring>0){result.wetness=Math.max(result.wetness,ring);result.moistureBonus=Math.max(result.moistureBonus,.2*ring);}
        }
      }
    }
    return result;
  }
  private seed: number;
  private noise: SimplexNoise;
  private macroGeo?: MacroGeography;
  private volcanoGen?: VolcanoGenerator;
  private geothermalGen?: GeothermalGenerator;
  private islandHydroCache: Map<number, IslandHydrologyData> = new Map();
  private heightSampler: ((x: number, z: number) => number) | null = null;

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

  /** Altura do terreno sem rios/lagos (fornecida pelo TerrainGenerator). */
  public setHeightSampler(fn: (x: number, z: number) => number): void {
    this.heightSampler = fn;
    this.islandHydroCache.clear();
  }

  private dryHeight(x: number, z: number): number {
    return this.heightSampler ? this.heightSampler(x, z) : 10.0;
  }

  /**
   * sondando 8 direções a SHORE_R metros; onde a borda aparece, busca binária (6 passos) e reta no
   * último intervalo - interpolar a altura em linha reta errava feio nas planícies achatadas. Só vale perto do
   * interpolar a altura em linha reta errava feio nas planícies achatadas. Só vale perto do
   * nível do mar (|e| < 0.8m): em planícies quase planas a altura sozinha não diz a que distância
   * está a borda, e a orla subia/descia de uma vez (degrau íngreme). Sem borda por perto: SHORE_R.
   */
  private shoreDistance(x: number, z: number, e: number): number {
    const de = e - CONFIG.SEA_LEVEL;
    let d = SHORE_R;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const es = this.dryHeight(x + Math.cos(a) * SHORE_R, z + Math.sin(a) * SHORE_R) - CONFIG.SEA_LEVEL;
      if ((de >= 0) === (es >= 0)) continue;
      const ca = Math.cos(a), sa = Math.sin(a);
      let lo = 0.0, hi = SHORE_R, eLo = de, eHi = es;
      for (let it = 0; it < 6; it++) {
        const mid = (lo + hi) * 0.5;
        const em = this.dryHeight(x + ca * mid, z + sa * mid) - CONFIG.SEA_LEVEL;
        if ((em >= 0) === (de >= 0)) { lo = mid; eLo = em; } else { hi = mid; eHi = em; }
      }
      // posição exata dentro do último intervalo (12cm) pela reta entre as duas alturas: sem isso
      // a distância andava em degraus e a linha d'água desenhada ondulava
      d = Math.min(d, lo + (hi - lo) * eLo / (eLo - eHi));
    }
    return d;
  }

  private nearVolcanoOrSpring(x: number, z: number, margin: number): boolean {
    if (this.volcanoGen) {
      if (this.volcanoGen.volcanoesNear(x, z, margin).length > 0) return true;
    }
    if (this.geothermalGen) {
      for (const s of this.geothermalGen.getSprings()) {
        if (dist2D(x, z, s.x, s.z) < 120.0 + margin * 0.5) return true;
      }
    }
    return false;
  }

  /** Inclinação da encosta do vale (varia pelo mundo: margens mais suaves ou mais íngremes). */
  private valleySlope(x: number, z: number): number {
    return 0.16 + (this.noise.noise2D(x * 0.01 + 7.7, z * 0.01 - 3.1) * 0.5 + 0.5) * 0.16;
  }

  /**
   * Na thread principal a hidrologia de uma ilha (0.3-1s de cálculo) não é calculada na hora: ela
   * chega pronta dos workers que montam os chunks (installIsland). Até lá a ilha responde vazia
   * (sem rios e lagos) e NÃO entra no cache - calcular aqui travava o jogo ao chegar numa ilha nova.
   */
  private deferMissing = false;
  public setDeferMissing(v: boolean): void { this.deferMissing = v; }

  /**
   * Ilhas calculadas aqui que ainda não estão em 'sent', prontas para mandar a outra thread. A
   * grade espacial dos rios (até ~200 mil números em listas) vai empacotada em arrays tipados:
   * copiar as listas entre threads custava 10-30ms por ilha na thread principal.
   */
  public exportIslands(sent: Set<number>): { key: number; data: any }[] {
    const out: { key: number; data: any }[] = [];
    for (const [key, data] of this.islandHydroCache) {
      if (sent.has(key)) continue;
      sent.add(key);
      let total = 0;
      for (const v of data.segGrid.values()) total += v.length;
      const keys = new Float64Array(data.segGrid.size), off = new Int32Array(data.segGrid.size + 1), vals = new Int32Array(total);
      let k = 0, o = 0;
      for (const [ck, v] of data.segGrid) {
        keys[k] = ck; off[k] = o;
        for (let j = 0; j < v.length; j++) vals[o++] = v[j];
        k++;
      }
      off[k] = o;
      const { segGrid, ...rest } = data;
      out.push({ key, data: { ...rest, segPacked: { keys, off, vals } } });
    }
    return out;
  }

  public cachedIslandCount(): number { return this.islandHydroCache.size; }
  public hasIsland(cellX: number, cellZ: number): boolean {
    return this.islandHydroCache.has((cellX + 32768) * 65536 + (cellZ + 32768));
  }

  /** Recebe uma ilha calculada em outra thread (a primeira que chegar vale). */
  public installIsland(key: number, packed: any): void {
    if (this.islandHydroCache.has(key)) return;
    const { segPacked, ...rest } = packed;
    const segGrid = new Map<number, number[]>();
    if (segPacked) {
      const { keys, off, vals } = segPacked;
      for (let k = 0; k < keys.length; k++) segGrid.set(keys[k], Array.from(vals.subarray(off[k], off[k + 1])));
    }
    // mesmos campos NA MESMA ORDEM do objeto calculado em getIslandHydrology: com outra ordem (ex.:
    // { ...rest, segGrid }) o V8 via dois formatos de objeto na consulta de altura, que roda milhões
    // de vezes, e tudo nos workers ficava 2-3x mais lento
    const r = rest as IslandHydrologyData;
    const data: IslandHydrologyData = {
      centerX: r.centerX, centerZ: r.centerZ, islandRadius: r.islandRadius, rivers: r.rivers, lakes: r.lakes, segGrid,
      minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ,
      lakeDist: r.lakeDist, gridX0: r.gridX0, gridZ0: r.gridZ0, gridN: r.gridN, fills: null, enclosed: r.enclosed,
    };
    data.fills = r.fills;
    this.islandHydroCache.set(key, data);
  }

  public getIslandHydrology(cellX: number, cellZ: number): IslandHydrologyData {
    const key = (cellX + 32768) * 65536 + (cellZ + 32768);
    const cached = this.islandHydroCache.get(key);
    if (cached) return cached;
    if (this.deferMissing) {
      return {
        centerX: cellX * CONFIG.ISLAND_GRID_SIZE, centerZ: cellZ * CONFIG.ISLAND_GRID_SIZE, islandRadius: 0,
        rivers: [], lakes: [], segGrid: new Map(),
        minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
        lakeDist: null, gridX0: 0, gridZ0: 0, gridN: 0, fills: null, enclosed: null,
      };
    }

    const baseSpacing = CONFIG.ISLAND_GRID_SIZE;
    const cellHash = PRNG.hash2D(cellX, cellZ, this.seed ^ 0x27d4eb2d);
    const prng = new PRNG(cellHash * 100000);
    const centerX = cellX * baseSpacing + prng.range(-baseSpacing * 0.08, baseSpacing * 0.08);
    const centerZ = cellZ * baseSpacing + prng.range(-baseSpacing * 0.08, baseSpacing * 0.08);
    const islandRadius = CONFIG.ISLAND_BASE_RADIUS * 0.95;

    const rivers: RiverPath[] = [];
    const lakes: Lake[] = [];
    const N = Math.round((DRAIN_HALF * 2) / DRAIN_CELL);
    const gx0 = cellX * baseSpacing - DRAIN_HALF, gz0 = cellZ * baseSpacing - DRAIN_HALF;
    let lakeDist: Float32Array | null = null;
    let drainH: Float32Array | null = null;
    let enclosed: Uint8Array | null = null;

    if (this.heightSampler) {
      const nC = N * N;
      // Território desta ilha (metade da distância até as vizinhas): a janela de drenagem é maior
      // que ele, e na sobreposição o mesmo rio seria calculado de novo pela vizinha, com o traçado
      // um pouco deslocado (dois canais paralelos com uma faixinha de terra entre eles). Cada rio
      // e cada represa ficam só com a ilha em cujo território está a foz / a represa.
      const own = (x: number, z: number) =>
        Math.abs(x - cellX * baseSpacing) < baseSpacing * 0.5 && Math.abs(z - cellZ * baseSpacing) < baseSpacing * 0.5;
      const cx = (i: number) => gx0 + ((i % N) + 0.5) * DRAIN_CELL;
      const cz = (i: number) => gz0 + (Math.floor(i / N) + 0.5) * DRAIN_CELL;

      // ---- 1. relevo na grade ----
      const H = new Float32Array(nC);
      drainH = H;
      let land = 0;
      for (let i = 0; i < nC; i++) { H[i] = this.dryHeight(cx(i), cz(i)); if (H[i] > 0) land++; }
      enclosed = this.findEnclosedBasins(H, N);

      if (land > 50) {
        // ---- 2. preenchimento de depressões + direção de escoamento (priority-flood) ----
        const filled = new Float32Array(nC);
        const recv = new Int32Array(nC).fill(-1);
        const done = new Uint8Array(nC);
        const order = new Int32Array(nC);
        let oc = 0;
        const heap = new MinHeap();
        for (let i = 0; i < nC; i++) {
          const ix = i % N, iz = (i / N) | 0;
          // o mar e a borda da janela são as saídas da água
          if (H[i] <= 0 || ix === 0 || iz === 0 || ix === N - 1 || iz === N - 1) {
            filled[i] = H[i]; done[i] = 1; heap.push(H[i], i);
          }
        }
        const NB = [-1, 1, -N, N, -N - 1, -N + 1, N - 1, N + 1];
        while (heap.size > 0) {
          const c = heap.pop();
          order[oc++] = c;
          const ix = c % N;
          for (let k = 0; k < 8; k++) {
            const nb = c + NB[k];
            if (nb < 0 || nb >= nC) continue;
            const nx = nb % N;
            if (Math.abs(nx - ix) > 1) continue;
            if (done[nb]) continue;
            done[nb] = 1;
            filled[nb] = Math.max(H[nb], filled[c] + 0.01);
            recv[nb] = c;
            heap.push(filled[nb], nb);
          }
        }

        // ---- 3. área de drenagem acumulada rio abaixo ----
        const acc = new Float32Array(nC);
        for (let i = 0; i < nC; i++) acc[i] = H[i] > 0 ? 1 : 0;
        for (let o = oc - 1; o >= 0; o--) {
          const c = order[o];
          if (recv[c] >= 0 && H[c] > 0) acc[recv[c]] += acc[c];
        }
        // longe de vulcões e fontes termais nada de rio
        const blocked = (i: number) => this.nearVolcanoOrSpring(cx(i), cz(i), 30.0);
        const isRiver = new Uint8Array(nC);
        for (let i = 0; i < nC; i++) {
          if (H[i] > 0 && acc[i] >= RIVER_ACC && filled[i] < RIVER_MAX_H && !blocked(i)) isRiver[i] = 1;
        }
        // a borda da janela não é mar: o que escoa para ela não vira rio
        for (let i = 0; i < nC; i++) {
          const ix = i % N, iz = (i / N) | 0;
          if (ix === 0 || iz === 0 || ix === N - 1 || iz === N - 1) isRiver[i] = 0;
        }
        // uma célula de rio só vale se continuar rio abaixo até o mar
        for (let o = 0; o < oc; o++) {
          const c = order[o];
          if (isRiver[c] && recv[c] >= 0 && H[recv[c]] > 0 && !isRiver[recv[c]]) isRiver[c] = 0;
        }

        // ---- 4. represas: vale inundado rio acima de alguns pontos do rio principal ----
        const lakeMask = new Uint8Array(nC);
        const upstream: number[][] = [];
        for (let i = 0; i < nC; i++) upstream.push([]);
        for (let i = 0; i < nC; i++) if (recv[i] >= 0 && H[i] > 0) upstream[recv[i]].push(i);
        const numLakes = 1 + (prng.chance(0.6) ? 1 : 0);
        let candidates: number[] = [];
        // pontos do rio com bastante área drenada, longe da costa; sem nenhum, critérios mais leves
        for (const [minAcc, minCoast] of [[RIVER_ACC * 3, 140.0], [RIVER_ACC * 1.5, 80.0]]) {
          candidates = [];
          for (let i = 0; i < nC; i++) {
            if (!isRiver[i] || acc[i] < minAcc || H[i] < 1.0 || !own(cx(i), cz(i))) continue;
            if (this.macroGeo && this.macroGeo.getLandmassMask(cx(i), cz(i)).coastDist < minCoast) continue;
            candidates.push(i);
          }
          if (candidates.length > 0) break;
        }
        for (let li = 0; li < numLakes && candidates.length > 0; li++) {
          // candidato sorteado (os de mais área drenada têm mais chance)
          candidates.sort((a, b) => acc[b] - acc[a]);
          const pick = candidates[Math.floor(Math.pow(prng.next(), 2.2) * Math.min(candidates.length, 60))];
          const level = filled[pick] + prng.range(3.0, 5.0);
          const q = [pick];
          const cells: number[] = [];
          lakeMask[pick] = 1;
          while (q.length > 0 && cells.length < 1600) {
            const c = q.pop()!;
            cells.push(c);
            for (const u of upstream[c]) {
              if (lakeMask[u] || H[u] >= level || blocked(u)) continue;
              if (dist2D(cx(u), cz(u), cx(pick), cz(pick)) > 520.0) continue;
              lakeMask[u] = 1; q.push(u);
            }
          }
          if (cells.length < 25) { for (const c of cells) lakeMask[c] = 0; continue; }
          let sx = 0, sz = 0;
          for (const c of cells) { sx += cx(c); sz += cz(c); }
          lakes.push({
            id: `lake_${cellX}_${cellZ}_${li}`,
            name: `Represa ${['Esmeralda', 'Serena', 'Cristalina', 'Brumosa', 'Azul', 'Profunda'][li % 6]}`,
            x: sx / cells.length, z: sz / cells.length,
            radius: Math.sqrt(cells.length / Math.PI) * DRAIN_CELL,
            waterLevel: CONFIG.SEA_LEVEL,
            depth: prng.range(2.5, 4.0),
          });
          // tira os candidatos perto deste lago
          for (let k = candidates.length - 1; k >= 0; k--) {
            if (dist2D(cx(candidates[k]), cz(candidates[k]), cx(pick), cz(pick)) < 700.0) candidates.splice(k, 1);
          }
        }
        if (lakes.length > 0) {
          this.cleanLakeMask(lakeMask, H, N);
          lakeDist = this.lakeDistanceField(lakeMask, N);
        }

        // ---- 5. traçado dos rios: de cada cabeceira, rio abaixo até o mar ou outro rio ----
        const hasUpRiver = new Uint8Array(nC);
        for (let i = 0; i < nC; i++) if (isRiver[i] && recv[i] >= 0 && isRiver[recv[i]]) hasUpRiver[recv[i]] = 1;
        const heads: number[] = [];
        for (let i = 0; i < nC; i++) if (isRiver[i] && !hasUpRiver[i]) heads.push(i);
        // os de maior percurso primeiro: o rio principal é traçado inteiro e os afluentes param nele
        heads.sort((a, b) => H[b] - H[a]);
        const visited = new Uint8Array(nC);
        for (const head of heads) {
          const cellsPath: number[] = [];
          let c = head, joined = -1;
          while (c >= 0) {
            if (visited[c]) { joined = c; break; }
            visited[c] = 1;
            cellsPath.push(c);
            if (H[c] <= 0) break;
            c = recv[c];
          }
          // trecho descartado: desmarca as células dele (senão um afluente que chegasse nelas
          // pararia ali, como se tivesse encontrado um rio que não existe)
          const drop = () => { for (const cc of cellsPath) visited[cc] = 0; };
          if (cellsPath.length < 4) { drop(); continue; }
          if (joined >= 0) cellsPath.push(joined);
          // dona = ilha onde fica a foz final da rede (segue o escoamento até o mar): o rio principal
          // e todos os afluentes dele ficam juntos na mesma ilha
          let mouth = cellsPath[cellsPath.length - 1];
          for (let guard = 0; guard < nC && recv[mouth] >= 0 && H[mouth] > 0; guard++) mouth = recv[mouth];
          if (!own(cx(mouth), cz(mouth))) { cellsPath.length -= joined >= 0 ? 1 : 0; drop(); continue; }
          // Acima da nascente o vale continua seco, subindo aos poucos até encontrar o terreno
          // (seguindo o afluente de maior área): o rio nasce no fundo de um vale, sem "buraco"
          const dry: number[] = [];
          let u = head, run = 0;
          for (let s = 0; s < 60; s++) {
            let best = -1;
            for (const w of upstream[u]) if (best < 0 || acc[w] > acc[best]) best = w;
            if (best < 0 || acc[best] < RIVER_ACC * 0.15) break;
            run += DRAIN_CELL;
            if (H[best] - run * HEAD_GRADE < 1.0) break;
            dry.push(best);
            u = best;
          }
          dry.reverse();
          const pts = this.buildRiverPoints([...dry, ...cellsPath], dry.length, cx, cz, acc, rivers.length, joined < 0);
          let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
          for (const p of pts) {
            mnX = Math.min(mnX, p.x); mxX = Math.max(mxX, p.x);
            mnZ = Math.min(mnZ, p.z); mxZ = Math.max(mxZ, p.z);
          }
          rivers.push({ points: pts, id: `river_${cellX}_${cellZ}_${rivers.length}`, minX: mnX, maxX: mxX, minZ: mnZ, maxZ: mxZ });
        }
      }
    }

    // Grade espacial dos trechos de rio (a consulta roda a cada cálculo de altura do terreno)
    const segGrid = new Map<number, number[]>();
    const bandCells = new Map<number, [number, number]>();
    rivers.forEach((river, ri) => {
      const pts = river.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const reach = Math.max(a.width, b.width) * 0.5 + VALLEY_REACH + 10.0;
        const x0 = Math.floor((Math.min(a.x, b.x) - reach) / SEG_CELL), x1 = Math.floor((Math.max(a.x, b.x) + reach) / SEG_CELL);
        const z0 = Math.floor((Math.min(a.z, b.z) - reach) / SEG_CELL), z1 = Math.floor((Math.max(a.z, b.z) + reach) / SEG_CELL);
        for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
          const k = cellKey(gx, gz);
          let list = segGrid.get(k);
          if (!list) { list = []; segGrid.set(k, list); }
          list.push(ri, i);
          // faixa perto da água (onde uma ilhota pode aparecer): só as células junto do canal
          if (Math.abs(gx * SEG_CELL + SEG_CELL / 2 - (a.x + b.x) / 2) < SEG_CELL + a.width &&
              Math.abs(gz * SEG_CELL + SEG_CELL / 2 - (a.z + b.z) / 2) < SEG_CELL + a.width &&
              a.elevation <= CONFIG.SEA_LEVEL + 0.05) bandCells.set(k, [gx, gz]);
        }
      }
    });

    let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
    for (const l of lakes) {
      const m = l.radius * 3 + VALLEY_REACH + 200.0;
      bMinX = Math.min(bMinX, l.x - m); bMaxX = Math.max(bMaxX, l.x + m);
      bMinZ = Math.min(bMinZ, l.z - m); bMaxZ = Math.max(bMaxZ, l.z + m);
    }
    for (const rv of rivers) {
      const m = VALLEY_REACH + 30.0;
      bMinX = Math.min(bMinX, rv.minX - m); bMaxX = Math.max(bMaxX, rv.maxX + m);
      bMinZ = Math.min(bMinZ, rv.minZ - m); bMaxZ = Math.max(bMaxZ, rv.maxZ + m);
    }
    const data: IslandHydrologyData = {
      centerX, centerZ, islandRadius, rivers, lakes, segGrid,
      minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ,
      lakeDist, gridX0: gx0, gridZ0: gz0, gridN: N, fills: null, enclosed,
    };
    // represas: células da faixa perto da margem
    if (lakeDist) {
      for (let i = 0; i < N * N; i++) {
        if (Math.abs(lakeDist[i]) > 40.0) continue;
        const x = gx0 + ((i % N) + 0.5) * DRAIN_CELL, z = gz0 + (Math.floor(i / N) + 0.5) * DRAIN_CELL;
        const gx = Math.floor(x / SEG_CELL), gz = Math.floor(z / SEG_CELL);
        bandCells.set(cellKey(gx, gz), [gx, gz]);
      }
    }
    data.fills = this.findIslets(data, bandCells, drainH);
    this.islandHydroCache.set(key, data);
    return data;
  }

  /**
   * Para cada rio da célula da grade espacial, o trecho mais próximo do ponto (distância ao eixo,
   * meia largura, fundo do vale e profundidade ali). Registros de 5 números: rio, d, meia largura,
   * fundo do vale (acima do mar), profundidade. Um rio só conta pelo SEU trecho mais próximo -
   * juntar trechos vizinhos do mesmo rio (mínimo suave) deixava a margem em dentes nas emendas.
   */
  private nearestPerRiver(data: IslandHydrologyData, x: number, z: number, out: number[]): void {
    out.length = 0;
    const list = data.segGrid.get(cellKey(Math.floor(x / SEG_CELL), Math.floor(z / SEG_CELL)));
    if (!list) return;
    for (let k = 0; k < list.length; k += 2) {
      const ri = list[k];
      const pts = data.rivers[ri].points;
      const i = list[k + 1];
      const p1 = pts[i], p2 = pts[i + 1];
      const sx = p2.x - p1.x, sz = p2.z - p1.z;
      const len2 = sx * sx + sz * sz;
      if (len2 === 0) continue;
      const u = clamp(((x - p1.x) * sx + (z - p1.z) * sz) / len2, 0.0, 1.0);
      const d = dist2D(x, z, p1.x + u * sx, p1.z + u * sz);
      const half = lerp(p1.width, p2.width, u) * 0.5;
      let slot = -1;
      for (let s = 0; s < out.length; s += 5) if (out[s] === ri) { slot = s; break; }
      if (slot >= 0 && d - half >= out[slot + 1] - out[slot + 2]) continue;
      if (slot < 0) { slot = out.length; out.length += 5; }
      out[slot] = ri; out[slot + 1] = d; out[slot + 2] = half;
      out[slot + 3] = lerp(p1.elevation, p2.elevation, u) - CONFIG.SEA_LEVEL;
      out[slot + 4] = lerp(p1.depth, p2.depth, u);
    }
  }
  private riverRecs: number[] = [];

  /**
   * Correnteza dos rios num ponto (para o mapa de fluxo da água): out = [vx, vz, presença 0-1].
   * Os pontos de cada rio vão da cabeceira para a foz, então o trecho p1 -> p2 é rio abaixo.
   * Rio fino corre mais rápido que rio largo; perto das margens a água anda mais devagar; na foz
   * (últimos ~50m, entrando no mar ou na represa) a correnteza some aos poucos.
   * Também, do rio dominante: out[3] = tempo de viagem da água desde a nascente (s) e out[4] =
   * distância lateral ao eixo (m, com sinal) - as linhas de correnteza do shader andam nelas.
   */
  public riverFlowAt(x: number, z: number, out: number[]): void {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 0;
    // O rio de cima da cachoeira (água elevada, fora dos rios nativos): a mesma correnteza do jogo.
    // Corre rio abaixo até o lábio; a fase (tempo de viagem) cresce no sentido da água, e a distância
    // lateral ao eixo vira as faixas paralelas às margens.
    for (const wf of this.nearbyWaterfalls(x, z)) {
      const q = localWaterfall(wf, x, z);
      if (q.z < -wf.length || q.z > 0) continue;
      const c = waterfallCenter(wf, q.z), width = waterfallWidth(wf, q.z), half = width * 0.5;
      const lateral = q.x - c, d = Math.abs(lateral);
      if (d > half + 6.0) continue;
      const speed = clamp(9.0 / Math.max(width, 6.0), 0.5, 1.6);
      const bank = 0.45 + 0.55 * (1.0 - clamp(d / half, 0.0, 1.0) ** 2);
      out[0] = wf.fx * speed * bank; out[1] = wf.fz * speed * bank;
      out[2] = (1.0 - smoothstep(0.0, 6.0, d - half)) * smoothstep(40.0, 85.0, q.z + wf.length);   // sem correnteza no lago da nascente
      out[3] = (q.z + wf.length) / 0.9;
      out[4] = lateral;
      return;
    }
    let domW = 0, domT = -1;
    const baseSpacing = CONFIG.ISLAND_GRID_SIZE;
    const cellX = Math.round(x / baseSpacing), cellZ = Math.round(z / baseSpacing);
    let sx = 0, sz = 0, sw = 0, pres = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const reach = DRAIN_HALF + VALLEY_REACH + 60.0;
        if (Math.abs(x - (cellX + dx) * baseSpacing) > reach || Math.abs(z - (cellZ + dz) * baseSpacing) > reach) continue;
        const data = this.getIslandHydrology(cellX + dx, cellZ + dz);
        if (x < data.minX || x > data.maxX || z < data.minZ || z > data.maxZ) continue;
        const list = data.segGrid.get(cellKey(Math.floor(x / SEG_CELL), Math.floor(z / SEG_CELL)));
        if (!list) continue;
        // trecho mais próximo de cada rio (pela borda)
        const best = this.flowBest; best.length = 0;
        let travel: Float32Array | null = null;
        for (let k = 0; k < list.length; k += 2) {
          const ri = list[k], i = list[k + 1];
          const pts = data.rivers[ri].points;
          const p1 = pts[i], p2 = pts[i + 1];
          if (Math.max(p1.elevation, p2.elevation) - CONFIG.SEA_LEVEL > 0.05) continue; // cabeceira seca
          const ax = p2.x - p1.x, az = p2.z - p1.z;
          const len2 = ax * ax + az * az;
          if (len2 === 0) continue;
          const u = clamp(((x - p1.x) * ax + (z - p1.z) * az) / len2, 0.0, 1.0);
          const d = dist2D(x, z, p1.x + u * ax, p1.z + u * az);
          const width = lerp(p1.width, p2.width, u), half = width * 0.5;
          if (d > half + 6.0) continue;
          let slot = -1;
          for (let s = 0; s < best.length; s += 8) if (best[s] === ri) { slot = s; break; }
          if (slot >= 0 && d - half >= best[slot + 1]) continue;
          if (slot < 0) { slot = best.length; best.length += 8; }
          const len = Math.sqrt(len2);
          // foz: some nos últimos 20 pontos (~50m)
          const mouth = clamp((pts.length - 2 - i - u) / 20.0, 0.0, 1.0);
          const speed = clamp(9.0 / width, 0.45, 1.6) * mouth;
          const bank = 0.45 + 0.55 * (1.0 - clamp(d / half, 0.0, 1.0) ** 2);
          best[slot] = ri; best[slot + 1] = d - half;
          best[slot + 2] = ax / len * speed * bank; best[slot + 3] = az / len * speed * bank;
          best[slot + 4] = (1.0 - smoothstep(0.0, 6.0, d - half)) * smoothstep(0.0, 0.3, mouth);
          travel = this.riverTravel(data.rivers[ri]);
          best[slot + 5] = travel[i] + u * (travel[i + 1] - travel[i]);
          best[slot + 6] = (ax * (z - p1.z) - az * (x - p1.x)) / len >= 0 ? d : -d;
        }
        for (let s = 0; s < best.length; s += 8) {
          const w = best[s + 4];
          sx += best[s + 2] * w; sz += best[s + 3] * w; sw += w;
          if (w > pres) pres = w;
          // rio dominante: o de mais presença; empatados (rios que dividem o mesmo leito depois de
          // se juntar), o que vem de mais longe (maior tempo de viagem): escolha estável ao longo do leito
          if (w > domW + 0.05 || (w > domW - 0.05 && best[s + 5] > domT)) {
            domW = Math.max(domW, w); domT = best[s + 5]; out[3] = best[s + 5]; out[4] = best[s + 6];
          }
        }
      }
    }
    if (sw <= 0) return;
    out[0] = sx / sw; out[1] = sz / sw; out[2] = pres;
  }
  private flowBest: number[] = [];
  private travelCache = new WeakMap<RiverPath, Float32Array>();
  /** Tempo de viagem da água (s) da nascente até cada ponto do rio (mesma velocidade de riverFlowAt, sem a foz). */
  private riverTravel(r: RiverPath): Float32Array {
    let t = this.travelCache.get(r);
    if (t) return t;
    const pts = r.points;
    t = new Float32Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const v = clamp(9.0 / ((a.width + b.width) * 0.5), 0.45, 1.6);
      t[i] = t[i - 1] + Math.hypot(b.x - a.x, b.z - a.z) / v;
    }
    this.travelCache.set(r, t);
    return t;
  }

  /**
   * Bacias fechadas: células abaixo do nível do mar que o oceano (a borda da janela) não alcança
   * andando só por células abaixo do nível do mar. A marcação avança 2 células para a terra em
   * volta (que também não é oceano), para a leitura interpolada cobrir a bacia até a margem.
   */
  private findEnclosedBasins(H: Float32Array, N: number): Uint8Array | null {
    const ocean = new Uint8Array(N * N);
    const stack: number[] = [];
    for (let i = 0; i < N; i++) {
      for (const s of [i, (N - 1) * N + i, i * N, i * N + N - 1]) {
        if (H[s] < 0 && !ocean[s]) { ocean[s] = 1; stack.push(s); }
      }
    }
    while (stack.length) {
      const s = stack.pop()!, x = s % N, z = (s / N) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
        const nb = zz * N + xx;
        if (!ocean[nb] && H[nb] < 0) { ocean[nb] = 1; stack.push(nb); }
      }
    }
    const enc = new Uint8Array(N * N);
    let any = false;
    for (let s = 0; s < N * N; s++) if (H[s] < 0 && !ocean[s]) { enc[s] = 1; any = true; }
    if (!any) return null;
    // passagem estreita para o mar (menos que uma célula) some na grade de 20m: a água de uma
    // enseada perto do mar aberto não conta como bacia (evita um degrau no meio da enseada)
    for (let pass = 0; pass < 2; pass++) {
      const add: number[] = [];
      for (let s = 0; s < N * N; s++) {
        if (!enc[s]) continue;
        const x = s % N, z = (s / N) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
          const nb = zz * N + xx;
          if (!enc[nb] && !ocean[nb]) add.push(nb);
        }
      }
      for (const s of add) enc[s] = 1;
    }
    return enc;
  }

  /**
   * Distância combinada até a água desta ilha (rios com água + represas), somada de forma suave:
   * negativa = água. É o mesmo critério da consulta, só que sem o terreno (rápido).
   */
  private waterDistance(data: IslandHydrologyData, x: number, z: number): number {
    let dWat = 1e9;
    if (data.lakeDist) {
      const d0 = this.lakeDistFast(data, x, z);
      dWat = smin(dWat, d0 > 30.0 ? d0 : this.sampleLakeDist(data, x, z), 8.0);
    }
    const recs = this.riverRecs;
    this.nearestPerRiver(data, x, z, recs);
    for (let s = 0; s < recs.length; s += 5) {
      if (recs[s + 3] > 0.05) continue; // trecho seco (cabeceira)
      dWat = smin(dWat, recs[s + 1] - recs[s + 2], 8.0);
    }
    return dWat;
  }

  /**
   * Procura ilhotas: numa grade de 3m sobre a faixa perto da água, pedaços de terra totalmente
   * cercados de água com menos de ~400m² viram água (marcados na grade fills). Ilhas maiores
   * ficam. Onde duas águas se aproximam (junção de afluente, curvas que voltam perto, braço de
   * represa) sobravam pedacinhos de terra soltos.
   */
  private findIslets(data: IslandHydrologyData, bandCells: Map<number, [number, number]>, drainH: Float32Array | null): IslandHydrologyData['fills'] {
    // mar = relevo seco abaixo do nível da água (lido da grade de drenagem de 20m)
    const N = data.gridN;
    // relevo seco interpolado da grade de drenagem (NaN fora dela)
    const drainBil = (x: number, z: number) => {
      if (!drainH) return NaN;
      const u = (x - data.gridX0) / DRAIN_CELL - 0.5, v = (z - data.gridZ0) / DRAIN_CELL - 0.5;
      const i0 = Math.floor(u), j0 = Math.floor(v);
      if (i0 < 0 || j0 < 0 || i0 >= N - 1 || j0 >= N - 1) return NaN;
      const fu = u - i0, fv = v - j0, o = j0 * N + i0;
      return (drainH[o] * (1 - fu) + drainH[o + 1] * fu) * (1 - fv) + (drainH[o + N] * (1 - fu) + drainH[o + N + 1] * fu) * fv;
    };
    const isSea = (x: number, z: number) => {
      const bil = drainBil(x, z);
      if (bil !== bil) return false;
      // longe da costa a grade basta; perto dela (grade grossa demais) consulta o relevo exato
      if (bil > 3.0) return false;
      if (bil < -3.0) return true;
      return this.dryHeight(x, z) < 0;
    };
    if (bandCells.size === 0) return null;
    const S = 3.0, PER = SEG_CELL / S; // 16 amostras por célula de 48m
    let mnX = Infinity, mnZ = Infinity, mxX = -Infinity, mxZ = -Infinity;
    for (const [gx, gz] of bandCells.values()) {
      mnX = Math.min(mnX, gx); mxX = Math.max(mxX, gx);
      mnZ = Math.min(mnZ, gz); mxZ = Math.max(mxZ, gz);
    }
    const W = (mxX - mnX + 1) * PER, Hh = (mxZ - mnZ + 1) * PER;
    // 0 = fora da faixa (terra ligada ao resto), 1 = terra na faixa, 2 = água
    const g = new Uint8Array(W * Hh);
    for (const [gx, gz] of bandCells.values()) {
      const ox = (gx - mnX) * PER, oz = (gz - mnZ) * PER;
      // em blocos de 2x2 amostras: a distância até a água muda ~1m por metro, então longe da margem
      // (mais de 2.6m do centro do bloco) as 4 amostras têm o mesmo sinal - uma consulta em vez de 4
      for (let j = 0; j < PER; j += 2) for (let i = 0; i < PER; i += 2) {
        const bx = (gx * PER + i + 1) * S, bz = (gz * PER + j + 1) * S;
        const dc = this.waterDistance(data, bx, bz);
        // mar: perto da costa (onde isSea consulta o relevo exato em cada amostra) uma consulta no
        // centro do bloco decide as 4 quando o relevo ali está a mais de 0.8m do nível (a costa sobe
        // devagar, ~0.08m por metro); só rente ao nível cada amostra consulta o próprio relevo
        let sea = -1; // -1 = não visto, 0/1 = decidido para o bloco, 2 = amostra por amostra
        for (let jj = 0; jj < 2; jj++) for (let ii = 0; ii < 2; ii++) {
          const x = (gx * PER + i + ii + 0.5) * S, z = (gz * PER + j + jj + 0.5) * S;
          let wet = dc < -2.6 ? true : dc > 2.6 ? false : this.waterDistance(data, x, z) < 0;
          if (!wet) {
            const bil = drainBil(x, z);
            if (bil !== bil || bil > 3.0) wet = false;
            else if (bil < -3.0) wet = true;
            else {
              if (sea < 0) { const hc = this.dryHeight(bx, bz); sea = hc > 0.8 ? 0 : hc < -0.8 ? 1 : 2; }
              wet = sea === 2 ? this.dryHeight(x, z) < 0 : sea === 1;
            }
          }
          g[(oz + j + jj) * W + ox + i + ii] = wet ? 2 : 1;
        }
      }
    }
    const seen = new Uint8Array(W * Hh);
    const fill = new Uint8Array(W * Hh);
    let any = false;
    let gOrig: Uint8Array = g;
    // Fechamento da água (expande e encolhe 2 amostras = 6m): faixas de terra com menos de ~12m
    // entre duas águas (dois canais lado a lado) viram água - margens normais não mudam
    {
      const R = 2;
      const wat = new Uint8Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) wat[i] = g[i] === 2 ? 1 : 0;
      const pass = (src: Uint8Array, useMax: boolean) => {
        const tmp = new Uint8Array(W * Hh), out = new Uint8Array(W * Hh);
        for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) {
          let v = useMax ? 0 : 1;
          for (let k = -R; k <= R; k++) {
            const xx = Math.min(W - 1, Math.max(0, x + k)), s2 = src[z * W + xx];
            v = useMax ? Math.max(v, s2) : Math.min(v, s2);
          }
          tmp[z * W + x] = v;
        }
        for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) {
          let v = useMax ? 0 : 1;
          for (let k = -R; k <= R; k++) {
            const zz = Math.min(Hh - 1, Math.max(0, z + k)), s2 = tmp[zz * W + x];
            v = useMax ? Math.max(v, s2) : Math.min(v, s2);
          }
          out[z * W + x] = v;
        }
        return out;
      };
      const closed = pass(pass(wat, true), false);
      gOrig = g.slice();
      for (let i = 0; i < W * Hh; i++) {
        if (g[i] === 1 && closed[i]) { g[i] = 2; fill[i] = 1; any = true; }
      }
    }
    const MAX = Math.ceil(400 / (S * S));
    for (let s = 0; s < W * Hh; s++) {
      if (g[s] !== 1 || seen[s]) continue;
      const comp = [s]; seen[s] = 1;
      let open = false;
      for (let q = 0; q < comp.length; q++) {
        const c0 = comp[q], x = c0 % W, z = (c0 / W) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= W || zz >= Hh) { open = true; continue; }
          const nb = zz * W + xx;
          if (g[nb] === 0) open = true;
          else if (g[nb] === 1 && !seen[nb]) { seen[nb] = 1; comp.push(nb); }
        }
        // (sem parar no meio: um componente grande interrompido deixava pedaços dele não visitados,
        // que depois pareciam ilhotas "cercadas" pelos já visitados e viravam água em terra seca)
      }
      if (open || comp.length > MAX) continue;
      for (const c1 of comp) fill[c1] = 1;
      any = true;
    }
    // Poças soltas: água cercada de terra com menos de ~400m², sem ligação com rio, represa ou mar
    // (um braço estreito da represa estrangulado pelo recorte da margem). Viram terra. A água vale
    // como ligada também pela diagonal, para rios finos não serem confundidos com poças.
    const seenW = new Uint8Array(W * Hh);
    const dry: number[] = [];
    for (let s = 0; s < W * Hh; s++) {
      if (gOrig[s] !== 2 || seenW[s]) continue;
      const comp = [s]; seenW[s] = 1;
      let open = false;
      for (let q = 0; q < comp.length; q++) {
        const c0 = comp[q], x = c0 % W, z = (c0 / W) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= W || zz >= Hh) { open = true; continue; }
          const nb = zz * W + xx;
          if (gOrig[nb] === 0) open = true;
          else if (gOrig[nb] === 2 && !seenW[nb]) { seenW[nb] = 1; comp.push(nb); }
        }
      }
      if (open || comp.length > MAX) continue;
      for (const c1 of comp) if (!fill[c1]) dry.push(c1);
    }
    // Dedos da represa: braços rasos com uma amostra de largura (menos de ~6m) que, vistos de
    // perto, se partem em poças rasas soltas. Uma "abertura" (encolhe e expande 1 amostra) só na
    // borda rasa das represas (fora de rio e mar) acha esses braços, que viram terra.
    const finger = new Uint8Array(W * Hh);
    if (data.lakeDist) {
      const lakeEdge = new Uint8Array(W * Hh);
      const recs = this.riverRecs;
      for (let s = 0; s < W * Hh; s++) {
        if (gOrig[s] !== 2) continue;
        const x = (mnX * PER + (s % W) + 0.5) * S, z = (mnZ * PER + ((s / W) | 0) + 0.5) * S;
        if (Math.abs(this.lakeDistFast(data, x, z)) > 25.0) continue; // longe da borda da represa
        const dl = this.sampleLakeDist(data, x, z);
        if (dl >= 0 || dl < -2.0 || isSea(x, z)) continue;
        this.nearestPerRiver(data, x, z, recs);
        let river = false;
        for (let r = 0; r < recs.length; r += 5) if (recs[r + 3] <= 0.05 && recs[r + 1] - recs[r + 2] < 3.0) river = true;
        if (!river) lakeEdge[s] = 1;
      }
      const isW = (x: number, z: number) => x < 0 || z < 0 || x >= W || z >= Hh || gOrig[z * W + x] === 2;
      // encolhe: fica só a água com os 8 vizinhos também água
      const core = new Uint8Array(W * Hh);
      for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) {
        if (gOrig[z * W + x] !== 2) continue;
        let all = true;
        for (let dz = -1; dz <= 1 && all; dz++) for (let dx = -1; dx <= 1; dx++) if (!isW(x + dx, z + dz)) { all = false; break; }
        if (all) core[z * W + x] = 1;
      }
      // expande de volta: a água rasa da borda que não volta é um dedo
      for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) {
        const s = z * W + x;
        if (!lakeEdge[s] || fill[s]) continue;
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, zz = z + dz;
          if (xx >= 0 && zz >= 0 && xx < W && zz < Hh && core[zz * W + xx]) { near = true; break; }
        }
        if (!near) finger[s] = 1;
      }
    }
    let anyFinger = false;
    for (let s = 0; s < W * Hh; s++) if (finger[s]) { anyFinger = true; break; }
    if (!any && dry.length === 0 && !anyFinger) return null;
    // em volta de tudo o que foi preenchido, marca também as amostras que já eram água (até 2 de
    // distância): a leitura interpolada cobre o preenchimento inteiro sem encostar em outra terra
    const marked: number[] = [];
    for (let i = 0; i < W * Hh; i++) if (fill[i]) marked.push(i);
    for (const c1 of marked) {
      const x = c1 % W, z = (c1 / W) | 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= Hh) continue;
        const nb = zz * W + xx;
        if (gOrig[nb] === 2) fill[nb] = 1;
      }
    }
    // poças que viram terra: a poça e a terra em volta dela (até 2 de distância)
    for (const c1 of dry) {
      const x = c1 % W, z = (c1 / W) | 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= Hh) continue;
        const nb = zz * W + xx;
        if (gOrig[nb] !== 0 && !fill[nb]) fill[nb] = 2;
      }
    }
    // dedos: o próprio dedo e a terra em volta (a represa ao lado continua como está)
    for (let s = 0; s < W * Hh; s++) {
      if (!finger[s]) continue;
      if (!fill[s]) fill[s] = 2;
      const x = s % W, z = (s / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= Hh) continue;
        const nb = zz * W + xx;
        if (gOrig[nb] === 1 && !fill[nb]) fill[nb] = 2;
      }
    }
    // Peso de "vira terra" suavizado (duas passadas de média 3x3, 0-255): a marcação crua na grade
    // de 3m deixava a margem em degraus retos (cantos de 90°) onde uma poça ou braço virava terra
    const blurMark = (want: number): Uint8Array => {
      const outMap = new Uint8Array(W * Hh);
      let a = new Float32Array(W * Hh);
      const b = new Float32Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) a[i] = fill[i] === want ? 1 : 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) {
          const i = z * W + x;
          b[i] = (a[i] + (x > 0 ? a[i - 1] : a[i]) + (x < W - 1 ? a[i + 1] : a[i])) / 3;
        }
        for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) {
          const i = z * W + x;
          a[i] = (b[i] + (z > 0 ? b[i - W] : b[i]) + (z < Hh - 1 ? b[i + W] : b[i])) / 3;
        }
      }
      for (let i = 0; i < W * Hh; i++) outMap[i] = Math.round(a[i] * 255);
      return outMap;
    };
    // (o mesmo para as ilhotas que viram água: sem suavizar, o fundo pulava entre -0.1m e -2m de
    // um vértice para o outro junto da margem - dentes na linha d'água e fendas escuras)
    return { grid: fill, dry: blurMark(2), wet: blurMark(1), x0: (mnX * PER + 0.5) * S, z0: (mnZ * PER + 0.5) * S, w: W, h: Hh };
  }

  /**
   * Limpa o desenho das represas na grade: "fecha" a área (expande e encolhe 1 célula), o que
   * deixa contínuos os braços que seguiam em diagonal (antes a interpolação entre duas células
   * diagonais caía acima da água e criava ilhotas minúsculas no meio do braço), e transforma em
   * água as ilhas internas pequenas demais (as grandes continuam como ilhas).
   */
  private cleanLakeMask(mask: Uint8Array, H: Float32Array, N: number): void {
    const nC = N * N;
    const near = (src: Uint8Array, i: number, want: number) => {
      const x = i % N, z = (i / N) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
        if (src[zz * N + xx] === want) return true;
      }
      return false;
    };
    // fechamento: expande (só sobre terra baixa, para não subir encosta) e encolhe
    const dil = new Uint8Array(nC);
    for (let i = 0; i < nC; i++) dil[i] = mask[i] || (H[i] > 0 && H[i] < 12.0 && near(mask, i, 1)) ? 1 : 0;
    for (let i = 0; i < nC; i++) mask[i] = dil[i] && !near(dil, i, 0) ? 1 : mask[i];
    // água que só se toca pela diagonal: a célula mais baixa ao lado vira água (braço contínuo)
    for (let z = 0; z < N - 1; z++) for (let x = 0; x < N - 1; x++) {
      const i00 = z * N + x, i10 = i00 + 1, i01 = i00 + N, i11 = i01 + 1;
      if (mask[i00] && mask[i11] && !mask[i10] && !mask[i01]) mask[H[i10] < H[i01] ? i10 : i01] = 1;
      else if (mask[i10] && mask[i01] && !mask[i00] && !mask[i11]) mask[H[i00] < H[i11] ? i00 : i11] = 1;
    }
    // ilhas internas pequenas (terra cercada de água, sem ligação com a terra de fora) viram água
    const seen = new Uint8Array(nC);
    for (let s = 0; s < nC; s++) {
      if (mask[s] || seen[s]) continue;
      const comp: number[] = [s];
      seen[s] = 1;
      let touchesOutside = false;
      // (explora o componente inteiro: parar no meio deixava pedaços da terra de fora não
      // visitados, que depois pareciam ilhas pequenas e viravam lago em pleno morro)
      for (let q = 0; q < comp.length; q++) {
        const c0 = comp[q], x = c0 % N, z = (c0 / N) | 0;
        if (x === 0 || z === 0 || x === N - 1 || z === N - 1) touchesOutside = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
          const nb = zz * N + xx;
          if (!mask[nb] && !seen[nb]) { seen[nb] = 1; comp.push(nb); }
        }
      }
      if (!touchesOutside && comp.length <= 12) for (const c1 of comp) mask[c1] = 1;
    }
  }

  /**
   * Distância (m) até a margem das represas em cada célula: negativa dentro d'água, positiva
   * fora (chamfer em dois sentidos). A margem fica entre as células, na distância zero.
   */
  private lakeDistanceField(mask: Uint8Array, N: number): Float32Array {
    const INF = 1e6, D1 = DRAIN_CELL, D2 = DRAIN_CELL * Math.SQRT2;
    const run = (inside: boolean) => {
      const d = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) d[i] = (mask[i] === 1) === inside ? INF : 0;
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = z * N + x; if (d[i] === 0) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + D1);
        if (z > 0) {
          v = Math.min(v, d[i - N] + D1);
          if (x > 0) v = Math.min(v, d[i - N - 1] + D2);
          if (x < N - 1) v = Math.min(v, d[i - N + 1] + D2);
        }
        d[i] = v;
      }
      for (let z = N - 1; z >= 0; z--) for (let x = N - 1; x >= 0; x--) {
        const i = z * N + x; if (d[i] === 0) continue;
        let v = d[i];
        if (x < N - 1) v = Math.min(v, d[i + 1] + D1);
        if (z < N - 1) {
          v = Math.min(v, d[i + N] + D1);
          if (x < N - 1) v = Math.min(v, d[i + N + 1] + D2);
          if (x > 0) v = Math.min(v, d[i + N - 1] + D2);
        }
        d[i] = v;
      }
      return d;
    };
    const outside = run(false), inside = run(true);
    const out = new Float32Array(N * N);
    // meia célula de deslocamento: a margem passa entre a última célula d'água e a primeira seca
    for (let i = 0; i < N * N; i++) out[i] = mask[i] ? -(inside[i] - D1 * 0.5) : outside[i] - D1 * 0.5;
    // Suaviza o campo (duas passadas de média [1 2 1]): a distância "em chanfro" numa grade de 20m
    // tem curvas de nível retas, e a margem saía em degraus de 20m com cantos de 90°. Cada célula
    // mantém o próprio lado (água continua água, terra continua terra), senão braços estreitos
    // de uma célula sumiriam.
    let a = out, b = new Float32Array(N * N);
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = z * N + x;
        b[i] = (a[x > 0 ? i - 1 : i] + 2 * a[i] + a[x < N - 1 ? i + 1 : i]) * 0.25;
      }
      const c = new Float32Array(N * N);
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = z * N + x;
        c[i] = (b[z > 0 ? i - N : i] + 2 * b[i] + b[z < N - 1 ? i + N : i]) * 0.25;
      }
      a = c;
    }
    for (let i = 0; i < N * N; i++) a[i] = mask[i] ? Math.min(a[i], -2.0) : Math.max(a[i], 2.0);
    return a;
  }

  /**
   * Transforma a sequência de células (em degraus de 20m) num rio de verdade: suaviza os degraus,
   * adiciona meandros em duas escalas (curvas grandes e pequenas, irregulares) e define largura e
   * profundidade pela área drenada (afluente fino, rio principal largo). Na foz, avança mar adentro.
   */
  private buildRiverPoints(
    cells: number[], dryCount: number, cx: (i: number) => number, cz: (i: number) => number,
    acc: Float32Array, salt: number, toSea: boolean
  ): RiverPoint[] {
    // h aqui = fundo do vale: sobe rio acima nas células secas da cabeceira (0 onde há água)
    let path = cells.map((c, i) => ({ x: cx(c), z: cz(c), a: acc[c], h: i < dryCount ? (dryCount - i) * DRAIN_CELL * HEAD_GRADE : 0 }));
    if (toSea && path.length >= 2) {
      const a = path[path.length - 2], b = path[path.length - 1];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      for (let k = 1; k <= 3; k++) path.push({ x: b.x + dx / l * DRAIN_CELL * k, z: b.z + dz / l * DRAIN_CELL * k, a: b.a, h: -1 });
    }
    // suaviza os degraus da grade (Chaikin, 3 passadas; as pontas ficam no lugar)
    for (let it = 0; it < 3; it++) {
      const next = [path[0]];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, a: a.a, h: a.h });
        next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, a: b.a, h: b.h });
      }
      next.push(path[path.length - 1]);
      path = next;
    }
    const pts: RiverPoint[] = [];
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const p = path[i];
      const prev = path[Math.max(0, i - 1)], next = path[Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x, tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      // largura pela área drenada, com mínimo de 5m (mais fino que isso a água parecia um risco)
      const width = clamp(3.5 + Math.sqrt(p.a) * 0.32, 5.0, 30.0);
      // meandros: deslocamento lateral em duas escalas, some nas pontas (junções e foz ficam no lugar)
      const ends = Math.min(1, i / 6, (n - 1 - i) / 6);
      // só curvas largas: a ondulação miúda virava zigue-zague nos rios finos
      const m = this.noise.noise2D(p.x * 0.006 + salt * 3.1, p.z * 0.006) * (14.0 + width * 0.8) * ends;
      // no trecho seco o "rio" é só o fundo do vale (sem água), estreitando rio acima
      const dryF = clamp(p.h / 3.0, 0, 1);
      pts.push({
        x: p.x - tz * m, z: p.z + tx * m, elevation: CONFIG.SEA_LEVEL + p.h,
        width: lerp(width, 3.0, dryF), depth: lerp(1.8 + width * 0.07, 0.0, dryF),
      });
    }
    return pts;
  }

  public getLakes(): Lake[] {
    return this.getIslandHydrology(0, 0).lakes;
  }

  public getRivers(): RiverPath[] {
    return this.getIslandHydrology(0, 0).rivers;
  }

  /** Distância até a margem das represas (m; negativa dentro d'água), interpolada da grade. */
  /**
   * A mesma distância sem a deformação da margem (só a grade): barata. A deformação desloca a
   * leitura no máximo ~21m e a distância muda no máximo 1m por metro, então longe da margem
   * (> 30m) o sinal é o mesmo - as varreduras (que só olham se é água) usam esta.
   */
  private lakeDistFast(data: IslandHydrologyData, x: number, z: number): number {
    const f = data.lakeDist!;
    const N = data.gridN;
    const u = (x - data.gridX0) / DRAIN_CELL - 0.5, v = (z - data.gridZ0) / DRAIN_CELL - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v);
    if (i0 < 0 || j0 < 0 || i0 >= N - 1 || j0 >= N - 1) return 1e6;
    const fu = u - i0, fv = v - j0;
    const a = f[j0 * N + i0], b = f[j0 * N + i0 + 1], cc = f[(j0 + 1) * N + i0], d = f[(j0 + 1) * N + i0 + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (cc * (1 - fu) + d * fu) * fv - 0.8;
  }

  private sampleLakeDist(data: IslandHydrologyData, x: number, z: number): number {
    // Margem recortada por DEFORMAÇÃO da posição lida (domain warp), não somando ruído ao valor:
    // deformar só entorta o desenho, sem criar pontos altos novos - somar ruído criava bolsões
    // de terra soltos (ilhotas minúsculas). A deformação é suave (inclinação < 1), então não dobra.
    // (ondulações de ~50m e ~15m: contorno bem recortado, com enseadas e pontas)
    const wx = x + this.noise.noise2D(x * 0.02 + 11.0, z * 0.02 - 4.0) * 12.0 + this.noise.noise2D(x * 0.065 - 3.0, z * 0.065) * 3.0;
    const wz = z + this.noise.noise2D(x * 0.02 - 7.0, z * 0.02 + 9.0) * 12.0 + this.noise.noise2D(x * 0.065, z * 0.065 + 6.0) * 3.0;
    const f = data.lakeDist!;
    const N = data.gridN;
    const u = (wx - data.gridX0) / DRAIN_CELL - 0.5, v = (wz - data.gridZ0) / DRAIN_CELL - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v);
    if (i0 < 0 || j0 < 0 || i0 >= N - 1 || j0 >= N - 1) return 1e6;
    const fu = u - i0, fv = v - j0;
    const a = f[j0 * N + i0], b = f[j0 * N + i0 + 1], c = f[(j0 + 1) * N + i0], d = f[(j0 + 1) * N + i0 + 1];
    // a água avança 0.8m terra adentro: bolsões de terra rentes à margem (menores que a varredura
    // de ilhotas enxerga) ficam submersos
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv - 0.8;
  }

  /**
   * Efeito de rios e lagos num ponto: quanto o terreno desce (leito abaixo do mar e encosta do
   * vale), se é água, umidade e a faixa de areia úmida. currentElevation = altura do terreno seco.
   */
  private queryBaseHydrology(x: number, z: number, currentElevation: number = 16.0): HydrologyQueryResult {
    const baseSpacing = CONFIG.ISLAND_GRID_SIZE;
    const cellX = Math.round(x / baseSpacing);
    const cellZ = Math.round(z / baseSpacing);
    const e = currentElevation;

    let minRiverDist = 999999;
    let minLakeDist = 999999;
    let moisture = 0;
    let h = e;
    let inWater = false, inLake = false;
    let wet = 0;
    let slope = -1;
    // distância até a água mais próxima (rio ou represa), somada de forma suave: onde duas águas
    // quase se encostam, a faixinha de terra entre elas também vira água (sem ilhotas)
    let dWat = 1e9;
    let dryW = 0; // peso de "poça/braço que vira terra" (0-1, suavizado)
    // rio com água mais perto do ponto (para o leito): distância à borda e profundidade
    let rEdge = 1e9, rDepth = 0;
    // distância até a linha d'água do relevo, só perto do nível do mar (rampa da orla)
    // (entre 0.4m e 0.8m de altura a sondagem vai perdendo o peso, sem degrau onde ela para)
    const ade = Math.abs(e - CONFIG.SEA_LEVEL);
    const sd = ade < 0.8 ? lerp(this.shoreDistance(x, z, e), SHORE_R, smoothstep(0.4, 0.8, ade)) : SHORE_R;
    // fundo junto da orla do mar e das bacias: zero na borda (sem salto de altura na linha d'água,
    // que a malha transformava em serrilhado), 0.55m a 1m dela, 1.4m a 4m, ~1.8m a 8m, mais o declive.
    // A água desce na borda com a MESMA inclinação com que a terra sobe (0.6m por metro): entre dois
    // vértices da malha a altura é uma reta, e com inclinações diferentes dos dois lados a linha
    // d'água desenhada saía do lugar e ondulava.
    const shoreDepth = 2.0 * (1.0 - Math.exp(-sd / 3.33));

    // bacia fechada do relevo (abaixo do mar, sem ligação com o oceano): margem em degrau e fundo
    // proporcional ao relevo (-0.1m -> -1.9m, -0.8m ou mais -> -4m), em vez de uma lâmina rasa
    if (e < CONFIG.SEA_LEVEL) {
      const own = this.getIslandHydrology(cellX, cellZ);
      const E = own.enclosed;
      if (E) {
        const Ng = own.gridN;
        const u = (x - own.gridX0) / DRAIN_CELL - 0.5, v = (z - own.gridZ0) / DRAIN_CELL - 0.5;
        const i0 = Math.floor(u), j0 = Math.floor(v);
        if (i0 >= 0 && j0 >= 0 && i0 < Ng - 1 && j0 < Ng - 1) {
          const fu = u - i0, fv = v - j0, o = j0 * Ng + i0;
          const val = (E[o] * (1 - fu) + E[o + 1] * fu) * (1 - fv) + (E[o + Ng] * (1 - fu) + E[o + Ng + 1] * fu) * fv;
          if (val > 0.5) { h = Math.min(h, Math.max(-4.0, (e - CONFIG.SEA_LEVEL) * 3.0 - shoreDepth)); inWater = true; }
        }
      }
    }

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        // a janela de drenagem da ilha vizinha nem alcança este ponto: nem gera
        const reach = DRAIN_HALF + VALLEY_REACH + 60.0;
        if (Math.abs(x - (cellX + dx) * baseSpacing) > reach || Math.abs(z - (cellZ + dz) * baseSpacing) > reach) continue;
        const hydro = this.getIslandHydrology(cellX + dx, cellZ + dz);
        if (x < hydro.minX || x > hydro.maxX || z < hydro.minZ || z > hydro.maxZ) continue;
        if (slope < 0) slope = this.valleySlope(x, z);
        if (hydro.fills) {
          // ilhota preenchida (leitura interpolada da grade de 3m). Além de virar água ali, dá a
          // distância aproximada até a borda do preenchimento (sondando a 3m e 6m em 8 direções):
          // sem ela a terra em volta subia o barranco inteiro colada nessa água
          const Fg = hydro.fills;
          {
            const u = (x - Fg.x0) / 3.0, v = (z - Fg.z0) / 3.0;
            const i0 = Math.floor(u), j0 = Math.floor(v);
            if (i0 >= 0 && j0 >= 0 && i0 < Fg.w - 1 && j0 < Fg.h - 1) {
              const fu = u - i0, fv = v - j0, D = Fg.dry, o = j0 * Fg.w + i0;
              dryW = Math.max(dryW, ((D[o] * (1 - fu) + D[o + 1] * fu) * (1 - fv) + (D[o + Fg.w] * (1 - fu) + D[o + Fg.w + 1] * fu) * fv) / 255);
            }
          }
          // ilhota que vira água: peso suavizado (0-1) convertido numa distância contínua até a
          // borda do preenchimento (~6m de largura de transição), em vez de saltos de 3m
          {
            const u = (x - Fg.x0) / 3.0, v = (z - Fg.z0) / 3.0;
            const i0 = Math.floor(u), j0 = Math.floor(v);
            if (i0 >= 0 && j0 >= 0 && i0 < Fg.w - 1 && j0 < Fg.h - 1) {
              const fu = u - i0, fv = v - j0, Wm = Fg.wet, o = j0 * Fg.w + i0;
              const wetW = ((Wm[o] * (1 - fu) + Wm[o + 1] * fu) * (1 - fv) + (Wm[o + Fg.w] * (1 - fu) + Wm[o + Fg.w + 1] * fu) * fv) / 255;
              if (wetW > 0) dWat = Math.min(dWat, Math.max((0.5 - wetW) * 6.0, -1.5));
            }
          }
        }

        // --- Represas (distância até a margem, da grade) ---
        // longe de qualquer represa (a deformação da margem desloca no máximo ~21m): sem efeito no
        // relevo - só guarda a distância aproximada, sem calcular o ruído da deformação
        const dFar = hydro.lakeDist ? this.lakeDistFast(hydro, x, z) : 1e9;
        if (hydro.lakeDist && dFar > VALLEY_REACH / 0.6 + 30.0) {
          if (dFar - 21.0 < minLakeDist) minLakeDist = dFar - 21.0;
        } else if (hydro.lakeDist) {
          const dl = this.sampleLakeDist(hydro, x, z);
          if (dl < minLakeDist) minLakeDist = Math.max(0, dl);
          dWat = smin(dWat, dl, 8.0);
          if (dl < 0) {
            // margem sem salto (zero na borda, senão a malha serrilha a linha d'água), descendo na borda
            // com a mesma inclinação da terra (0.3m por metro) e depois um pouco mais depressa: ~0.3m a 1m
            // dela, ~1.3m a 3m, até 1.6m (mais fundo, a margem virava um barranco íngreme e escuro)
            h = Math.min(h, -Math.min(1.6, -dl * 0.3 + 0.6 * smoothstep(0.0, 4.0, -dl)));
            inWater = true; inLake = true;
            moisture = 1.0; wet = 1.0;
          } else if (dl < VALLEY_REACH / 0.6) { // vale mais aberto: mesmo alcance em altura
            // encosta do vale da represa mais aberta (leitura da distância a 60%): lagos em terreno alto
            // ficavam no fundo de um barranco íngreme
            h = smin(h, valleyHeight(dl * 0.6, slope), 1.5);
            wet = Math.max(wet, 1.0 - smoothstep(1.0, 6.0, dl));
            moisture = Math.max(moisture, 1.0 - smoothstep(0.0, 45.0, dl) * 0.9);
          }
        }

        // --- Rios: o trecho mais próximo de cada rio ---
        const recs = this.riverRecs;
        this.nearestPerRiver(hydro, x, z, recs);
        for (let s = 0; s < recs.length; s += 5) {
          const d = recs[s + 1], half = recs[s + 2], floor = recs[s + 3], depth = recs[s + 4];
          if (d < minRiverDist) minRiverDist = d;
          if (d > half + VALLEY_REACH) continue;
          if (floor <= 0.05) {
            dWat = smin(dWat, d - half, 8.0);
            // rio com água mais perto (o leito é escavado depois do laço, pela distância combinada)
            // (no máximo 1.6m, a mesma profundidade das represas: mais fundo, o canal do rio aparecia
            // como uma faixa escura atravessando o lago)
            if (d - half < rEdge) { rEdge = d - half; rDepth = Math.min(depth, 1.6); }
          }
          if (floor > 0.05) {
            // cabeceira: vale seco que sobe até o terreno (sem água)
            h = smin(h, floor + valleyHeight(Math.max(0, d - half), slope), 1.5);
            moisture = Math.max(moisture, (1.0 - smoothstep(0.0, 30.0, d)) * 0.6);
          } else if (d < half) {
            // dentro do canal: o leito é escavado depois do laço, pela distância combinada (dWat)
            moisture = Math.max(moisture, 0.95); wet = 1.0;
          } else {
            const dw = d - half;
            h = smin(h, valleyHeight(dw, slope), 1.5);
            wet = Math.max(wet, 1.0 - smoothstep(1.0, 5.0, dw));
            moisture = Math.max(moisture, (1.0 - smoothstep(0.0, 40.0, dw)) * 0.85);
          }
        }
      }
    }

    // Leito dos rios (e das junções entre águas) pela distância COMBINADA até a água - a mesma que
    // define a margem. Escavar cada rio pelo próprio perfil, com dois rios quase paralelos, fazia a
    // altura subir e descer de novo na borda (dentes na linha d'água). Na borda desce 0.45m por metro
    // (a mesma inclinação com que a margem sobe) e a parcela suave leva o meio à profundidade toda.
    if (dWat < 0) {
      const dd = -dWat;
      // UM fundo para toda a água (represas, rios e as junções entre eles), pela distância contínua
      // até a borda: 0.3m por metro na borda (a mesma inclinação com que a margem sobe) até 1.6m.
      // Fórmulas diferentes para o lago e para a água em volta dele deixavam degraus de ~1.5m
      // debaixo d'água (fendas e dentes na margem).
      const fb = -Math.min(1.6, dd * 0.3 + 0.6 * smoothstep(0.0, 4.0, dd));
      // perto do canal de um rio o leito dele entra aos poucos (de 3m fora até 1m dentro da borda):
      // chega mais depressa à profundidade toda
      const wR = rDepth > 0 ? 1.0 - smoothstep(-1.0, 3.0, rEdge) : 0.0;
      const bed = wR > 0.0 ? -Math.min(rDepth, dd * 0.3 + rDepth * smoothstep(0.0, 3.0, dd)) : fb;
      h = Math.min(h, lerp(fb, bed, wR));
      inWater = true; wet = 1.0; moisture = Math.max(moisture, 0.95);
    }

    // poça/braço solto pequeno demais: vira terra numa rampa (sem degrau vertical na borda)
    if (dryW > 0.0 && e >= CONFIG.SEA_LEVEL) {
      const t = smoothstep(0.2, 0.8, dryW);
      h = lerp(h, Math.max(h, Math.min(e, 0.05)), t);
      if (dryW >= 0.5) { inWater = false; inLake = false; }
    }

    // a terra perto de QUALQUER água (inclusive as ilhotas que viram água e as junções) desce pela
    // encosta de vale até a borda: o vale só vinha dos lagos e rios, e ali o chão ficava ~1m acima
    // da água até a beira (degrau)
    if (!inWater && dWat < VALLEY_REACH) {
      if (slope < 0) slope = this.valleySlope(x, z);
      h = Math.min(h, valleyHeight(Math.max(0.0, dWat), slope));
    }

    // terra fora da água nunca desce abaixo do nível do mar (vales que se juntam não viram poças)
    if (!inWater) h = Math.max(h, Math.min(e, 0.05));

    // Barranco / orla: a terra baixa sobe ~1.5m logo na beira da água, numa curva suave, em vez de
    // ficar rente à lâmina (parecia água rasa por cima do chão). Em volta de lagos e rios pela
    // distância até a água; na orla do mar e das bacias pela distância sondada até a borda. Sobe
    // 0.6m por metro na borda (~0.5m a 1m, ~1m a 3m, ~1.4m a 8m: sem degrau íngreme).
    // Como a água também desce logo na borda, a linha d'água não segue a malha em zigue-zague.
    let bankLift = 0;
    if (!inWater && e >= CONFIG.SEA_LEVEL) {
      // a subida respeita a água mais perto: rio/represa (dWat) e borda do relevo (sd). Com max()
      // a terra plana junto de um rio subia 1.5m colada na margem (nenhum mar num raio de 8m)
      const riverNear = 1.0 - Math.exp(-Math.max(0.0, dWat) / 5.0);  // 0.3m por metro na borda, como a água das represas
      const shoreNear = 1.0 - Math.exp(-sd / 2.5);
      const near = Math.min(riverNear, shoreNear);
      if (near > 0.0) bankLift = 1.5 * near * (1.0 - smoothstep(0.0, 3.0, h));
      // areia molhada na orla do mar/bacias igual à beira dos rios (a textura escurece a areia
      // pela umidade; só pela altura, com a orla mais alta, a faixa escura sumia no mar)
      wet = Math.max(wet, 1.0 - smoothstep(2.0, 7.5, sd));
    }

    // Beira do mar: a plataforma rasa (0.08m por metro, e planícies um pouco abaixo do nível) virava
    // lâminas enormes de água de poucos centímetros. O fundo desce numa rampa a partir da borda (zero
    // nela, 1.6m a 4m, mais 3x o declive do relevo) até 6m; dali para fundo o relevo segue como era.
    if (e < CONFIG.SEA_LEVEL) {
      const de = e - CONFIG.SEA_LEVEL;
      h = Math.min(h, e, CONFIG.SEA_LEVEL + Math.max(-6.0, de * 3.0 - shoreDepth));
      // debaixo d'água conta como molhado (como nos rios): com zero, a textura (que mistura a
      // umidade dos pontos vizinhos) clareava a areia colada na água - faixa clara antes do laranja
      wet = 1.0;
    }

    return {
      heightOffset: Math.min(0, h - e) + bankLift,
      isWater: inWater,
      waterSurfaceY: inWater ? CONFIG.SEA_LEVEL : -999,
      distanceToRiver: minRiverDist,
      distanceToLake: minLakeDist,
      isLake: inLake,
      moistureBonus: clamp(moisture, 0.0, 1.0),
      wetness: clamp(wet, 0.0, 1.0),
    };
  }
}
