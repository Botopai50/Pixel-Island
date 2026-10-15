import { ForgeParams, ChunkTextureResult } from './terrainTextureForge.ts';
import { ChunkGeometryData } from './chunkGeometry.ts';
import { HorizonTileData, HorizonTreeData } from './horizonGeometry.ts';
import { CONFIG } from '../../config.ts';
import { chunkCacheGet, chunkCachePut, chunkCacheKey, paramsFingerprint } from './chunkCache.ts';

/**
 * Alcance da hidrologia de uma ilha a partir do centro dela (janela de drenagem + vale + folga),
 * por eixo; cobre também a ilha "dona" de cada ponto (a até meia célula = 1600m por eixo)
 */
const ISLAND_REACH = 2300;
const islandKeyNum = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const islandKey = (seed: number, cx: number, cz: number) => seed + ':' + cx + ':' + cz;

/** Resultado de um job: textura (se density > 0) e/ou malha de relevo (se segments > 0). */
export interface ChunkJobResult {
  texture?: ChunkTextureResult;
  geometry?: ChunkGeometryData;
  horizon?: HorizonTileData;
  impostors?: HorizonTreeData;
  /** mapa de tons da água (waterBiomeCompute.ts): RGBA, 128 x 128 */
  waterBiome?: Uint8Array;
  /** plano da vegetação de um chunk, em dados simples (vegetationPlanWire.ts) */
  vegPlan?: unknown;
}

/**
 * Pool de Web Workers dedicado à geração assíncrona de texturas de chunk.
 * Move 100% do custo pesado de genChunkTexture (que escala com o quadrado da
 * densidade de texel) para fora da main thread, eliminando os travamentos ao
 * carregar chunks com densidades altas (12-24 tx/m).
 */

interface PendingReq {
  reqId: number;
  seed: number;
  params: ForgeParams;
  minWorldX: number;
  minWorldZ: number;
  chunkSize: number;
  density: number;
  segments: number;
  walls?: boolean;
  priority: number;
  /** pré-cálculo da hidrologia de uma ilha (em vez de um chunk) */
  island?: { cx: number; cz: number };
  /** bloco do horizonte (em vez de um chunk): subdivisões da malha */
  horizonSeg?: number;
  /** árvores distantes de um pedaço (em vez de um chunk): posições locais a esta origem */
  impostor?: { originX: number; originZ: number };
  /** mapa de tons da água (em vez de um chunk): origem (canto) do mapa */
  waterBiome?: { originX: number; originZ: number };
  /** plano da vegetação de um chunk (em vez de textura/malha) */
  vegPlan?: { cx: number; cz: number; detail: boolean };
  resolve: (r: ChunkJobResult) => void;
  reject: (e: unknown) => void;
}

function defaultPoolSize(): number {
  // Deixa 1 núcleo livre para a thread principal (4 núcleos -> 3 workers). Teto de 8: com 12
  // workers numa CPU de 16 threads (8 núcleos físicos) cada job ficava 2-3x mais lento e o
  // carregamento todo demorava o dobro; cada worker também guarda buffers de rascunho.
  // Teto de 6 (e não 8): o carregamento leva o mesmo tempo (11,2 s contra 11,7 s, a thread principal é o gargalo), e andando pelo mundo os
  // quadros acima de 50 ms caem de 14 para 7 em 30 s (p99 de 33 para 26 ms): os dois últimos workers só disputavam CPU com o desenho.
  const forced = Number(new URLSearchParams(self.location?.search ?? "").get("workers"));
  if (forced > 0) return Math.min(16, forced); // ?workers=N (medição)
  const cores = (navigator as any).hardwareConcurrency || 4;
  return Math.max(2, Math.min(6, cores - 1));
}

export class TextureWorkerPool {
  private workers: Worker[] = [];
  private freeWorkers: number[] = [];
  private queue: PendingReq[] = [];
  private inflight: Map<number, PendingReq> = new Map();
  private cancelled: Set<number> = new Set();
  private reqCounter: number = 0;
  /** Recebe a hidrologia de ilhas calculada nos workers (instalada na thread principal) */
  public onHydrology?: (seed: number, key: number, data: any) => void;
  /** Medição: tempo de cada job nos workers (densidade, subdivisões, ms, ilhas novas calculadas) */
  private sentAt = new Map<number, number>();
  /** Medição: tempo de parede de cada job (do envio ao retorno), de qualquer tipo */
  public wall: { kind: string; density: number; ms: number; worker?: number; t: number }[] = [];
  public stats:{ density: number; segments: number; island: boolean; ms: number; newIslands: number; t: number }[] = [];
  /** Ilhas pedidas a um worker e ainda não prontas: chunks que dependem delas esperam na fila */
  private islandsPending = new Set<string>();
  /** Ilhas já calculadas (em algum worker ou na thread principal) e repassadas a todos */
  private islandsDone = new Set<string>();

  constructor(size: number = defaultPoolSize()) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./textureForge.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent) => this.handleMessage(i, ev.data);
      this.workers.push(worker);
      this.freeWorkers.push(i);
    }
  }

  public request(
    seed: number,
    params: ForgeParams,
    minWorldX: number,
    minWorldZ: number,
    chunkSize: number,
    density: number,
    priority: number = 0,
    segments: number = 0,
    walls: boolean = true
  ): { promise: Promise<ChunkJobResult>; reqId: number } {
    const reqId = ++this.reqCounter;
    const key = chunkCacheKey('c', [seed, paramsFingerprint(params), minWorldX, minWorldZ, chunkSize, density, segments, walls]);
    const promise = new Promise<ChunkJobResult>((resolve, reject) => {
      this.cached(reqId, key, resolve, reject, () => {
        this.queue.push({
          reqId, seed, params: { ...params }, minWorldX, minWorldZ, chunkSize, density, segments, walls, priority,
          resolve: (r) => { resolve(r); chunkCachePut(key, r); }, reject
        });
        this.pump();
      });
    });
    return { promise, reqId };
  }

  /**
   * Antes de pedir a um worker, procura o resultado no cache em disco (chunkCache.ts): se está lá, resolve na hora; senão pede ao worker, e o
   * resultado vai para o cache. O pedido pode ser cancelado enquanto a busca ainda não voltou.
   */
  private lookups = new Set<number>();
  private lookupCancelled = new Set<number>();
  private cached(reqId: number, key: string, resolve: (r: ChunkJobResult) => void, reject: (e: unknown) => void, enqueue: () => void): void {
    this.lookups.add(reqId);
    chunkCacheGet(key).then((hit) => {
      this.lookups.delete(reqId);
      if (this.lookupCancelled.delete(reqId)) { reject(new Error('cancelled')); return; }
      if (hit) resolve(hit as ChunkJobResult);
      else enqueue();
    });
  }

  /** O pedido ainda espera (na busca do cache ou na fila, sem worker)? Então dá para trocá-lo por outro melhor sem desperdiçar trabalho. */
  public isWaiting(reqId: number): boolean {
    return this.lookups.has(reqId) || this.queue.some((q) => q.reqId === reqId);
  }

  /**
   * Pede a UM worker a hidrologia de uma ilha (0.3-1s), antes dos chunks dela: o resultado é
   * repassado aos outros workers e à thread principal, e ninguém mais precisa recalcular.
   */
  public prefetchIsland(seed: number, cx: number, cz: number, priority: number = -1): void {
    if (this.enqueueIsland(seed, cx, cz, priority)) this.pump();
  }

  /**
   * Bloco do horizonte (terreno distante): não usa hidrologia nem textura, e vai depois de todo o
   * resto (a prioridade que vem de quem pede já é alta).
   */
  public requestHorizon(seed: number, minX: number, minZ: number, size: number, seg: number, priority: number): { promise: Promise<ChunkJobResult>; reqId: number } {
    const reqId = ++this.reqCounter;
    const key = chunkCacheKey('h', [seed, minX, minZ, size, seg]);
    const promise = new Promise<ChunkJobResult>((resolve, reject) => {
      this.cached(reqId, key, resolve, reject, () => {
        this.queue.push({
          reqId, seed, params: {} as ForgeParams, minWorldX: minX, minWorldZ: minZ, chunkSize: size, density: 0, segments: 0,
          priority, horizonSeg: seg, resolve: (r) => { resolve(r); chunkCachePut(key, r); }, reject,
        });
        this.pump();
      });
    });
    return { promise, reqId };
  }

  /**
   * Mapa de tons da água (128 x 128 texels de 12 m) com o canto em (originX, originZ): feito num worker, em vez de uns 2 ms por quadro da thread
   * principal durante os ~130 quadros de cada reconstrução. Como um chunk, espera a hidrologia das ilhas que cobre.
   */
  public requestWaterBiome(seed: number, originX: number, originZ: number, span: number, priority: number): { promise: Promise<ChunkJobResult>; reqId: number } {
    const reqId = ++this.reqCounter;
    const promise = new Promise<ChunkJobResult>((resolve, reject) => {
      this.queue.push({
        reqId, seed, params: {} as ForgeParams, minWorldX: originX, minWorldZ: originZ, chunkSize: span, density: 0, segments: 0,
        priority, waterBiome: { originX, originZ }, resolve, reject,
      });
      this.pump();
    });
    return { promise, reqId };
  }

  /**
   * Plano da vegetação de um chunk (onde vai cada árvore, pedra, arbusto, tronco e flor), feito num worker: na thread principal custava 2 a 6 ms por chunk
   * (e até 20 a 70 ms nos chunks cheios). Espera a hidrologia das ilhas, como um chunk.
   */
  public requestVegPlan(seed: number, cx: number, cz: number, chunkSize: number, detail: boolean, priority: number): { promise: Promise<ChunkJobResult>; reqId: number } {
    const reqId = ++this.reqCounter;
    const promise = new Promise<ChunkJobResult>((resolve, reject) => {
      this.queue.push({
        reqId, seed, params: {} as ForgeParams, minWorldX: cx * chunkSize, minWorldZ: cz * chunkSize, chunkSize, density: 0, segments: 0,
        priority, vegPlan: { cx, cz, detail }, resolve, reject,
      });
      this.pump();
    });
    return { promise, reqId };
  }

  /** Árvores distantes (impostores) de um pedaço do mundo, com posições locais a (originX, originZ). */
  public requestImpostors(seed: number, minX: number, minZ: number, size: number, originX: number, originZ: number, priority: number): { promise: Promise<ChunkJobResult>; reqId: number } {
    const reqId = ++this.reqCounter;
    const key = chunkCacheKey('i', [seed, minX, minZ, size, originX, originZ]);
    const promise = new Promise<ChunkJobResult>((resolve, reject) => {
      this.cached(reqId, key, resolve, reject, () => {
        this.queue.push({
          reqId, seed, params: {} as ForgeParams, minWorldX: minX, minWorldZ: minZ, chunkSize: size, density: 0, segments: 0,
          priority, impostor: { originX, originZ }, resolve: (r) => { resolve(r); chunkCachePut(key, r); }, reject,
        });
        this.pump();
      });
    });
    return { promise, reqId };
  }

  /** Põe a ilha na fila (se ainda não foi calculada nem pedida). */
  private enqueueIsland(seed: number, cx: number, cz: number, priority: number): boolean {
    const k = islandKey(seed, cx, cz);
    if (this.islandsDone.has(k) || this.islandsPending.has(k)) return false;
    this.islandsPending.add(k);
    this.queue.push({
      reqId: ++this.reqCounter, seed, params: {} as ForgeParams, minWorldX: 0, minWorldZ: 0, chunkSize: 0, density: 0, segments: 0,
      priority, island: { cx, cz }, resolve: () => {}, reject: () => {},
    });
    return true;
  }

  /** Marca ilhas (chaves numéricas da hidrologia) como já calculadas e repassadas. */
  private markIslandsDone(seed: number, items: { key: number }[]): void {
    for (const it of items) {
      const cx = Math.floor(it.key / 65536) - 32768, cz = (it.key % 65536) - 32768;
      if (islandKeyNum(cx, cz) === it.key) this.islandsDone.add(islandKey(seed, cx, cz));
    }
  }

  /**
   * Manda ilhas já calculadas a todos os workers (menos o que calculou). Pela mesma porta das
   * tarefas: chega ANTES de qualquer chunk despachado depois (um BroadcastChannel não garante a
   * ordem, e o worker que recebia o chunk primeiro recalculava a ilha).
   */
  public broadcastIslands(seed: number, items: { key: number; data: any }[], except: number = -1): void {
    if (!items.length) return;
    this.markIslandsDone(seed, items);
    // Copiar os dados da ilha para cada worker custa ~12 ms de thread principal (60 ms para 5 workers num quadro só, um engasgo ao entrar numa
    // ilha nova): cada cópia sai numa tarefa própria, e um worker que for receber um trabalho antes da sua vez leva as ilhas pendentes primeiro
    // (flushInstalls), então a ordem em relação aos chunks é a de antes.
    this.workers.forEach((_w, i) => {
      if (i === except) return;
      let l = this.pendingInstalls.get(i);
      if (!l) { l = []; this.pendingInstalls.set(i, l); }
      l.push({ seed, items });
    });
    this.scheduleInstallDrain();
  }

  private pendingInstalls = new Map<number, { seed: number; items: { key: number; data: any }[] }[]>();
  private installTimer = 0;

  private flushInstalls(i: number): void {
    const l = this.pendingInstalls.get(i);
    if (!l || l.length === 0) return;
    this.pendingInstalls.delete(i);
    const w = this.workers[i];
    if (w) for (const m of l) w.postMessage({ type: 'install', seed: m.seed, items: m.items });
  }

  private scheduleInstallDrain(): void {
    if (this.installTimer || this.pendingInstalls.size === 0) return;
    this.installTimer = window.setTimeout(() => {
      this.installTimer = 0;
      const first = this.pendingInstalls.keys().next();
      if (!first.done) this.flushInstalls(first.value);
      this.scheduleInstallDrain();
    }, 4);
  }

  /** Há chunks/ilhas na fila ou sendo gerados? */
  public getQueueLength(): number {
    return this.queue.length + this.inflight.size;
  }

  public isBusy(): boolean {
    return this.queue.length > 0 || this.inflight.size > 0;
  }

  public cancel(reqId: number): void {
    if (this.lookups.has(reqId)) { this.lookupCancelled.add(reqId); return; }
    const idx = this.queue.findIndex((q) => q.reqId === reqId);
    if (idx >= 0) {
      // Ainda não foi despachado a um worker: rejeita imediatamente, sem gastar nenhum ciclo de CPU.
      const [item] = this.queue.splice(idx, 1);
      item.reject(new Error('cancelled'));
      return;
    }
    // Já em andamento em um worker: não há como interromper o cálculo, mas marcamos para
    // que o resultado seja descartado (rejeitado) assim que chegar, em vez de aplicado.
    this.cancelled.add(reqId);
  }

  /**
   * O chunk depende de uma ilha cuja hidrologia ainda não está pronta? Então ela é pedida a UM
   * worker (com prioridade logo acima da do chunk) e o chunk espera: sem isso cada worker que
   * pegava um chunk dali calculava a mesma ilha de novo (0.3-1.5s jogados fora, por worker).
   */
  private waitsForIsland(item: PendingReq): boolean {
    if (item.island || item.horizonSeg || item.impostor) return false;   // (o mapa da água não entra aqui: ele depende das ilhas como um chunk, pela área que cobre)
    const G = CONFIG.ISLAND_GRID_SIZE;
    const c0 = Math.ceil((item.minWorldX - ISLAND_REACH) / G), c1 = Math.floor((item.minWorldX + item.chunkSize + ISLAND_REACH) / G);
    const r0 = Math.ceil((item.minWorldZ - ISLAND_REACH) / G), r1 = Math.floor((item.minWorldZ + item.chunkSize + ISLAND_REACH) / G);
    let wait = false;
    for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) {
      const k = islandKey(item.seed, cx, cz);
      if (this.islandsDone.has(k)) continue;
      if (!this.islandsPending.has(k)) this.enqueueIsland(item.seed, cx, cz, item.priority - 0.5);
      wait = true;
    }
    return wait;
  }

  private pump(): void {
    while (this.freeWorkers.length > 0 && this.queue.length > 0) {
      // Menor prioridade primeiro (0 = primeira textura de um chunk, 1 = upgrade de LOD): o mundo
      // aparece inteiro antes de ficar nítido. Empates mantêm a ordem de chegada, que já é do
      // chunk mais perto para o mais longe. Chunks esperando uma ilha ficam para depois.
      let pick = -1;
      for (let i = 0; i < this.queue.length; i++) {
        if ((pick < 0 || this.queue[i].priority < this.queue[pick].priority) && !this.waitsForIsland(this.queue[i])) pick = i;
      }
      if (pick < 0) break;
      const item = this.queue.splice(pick, 1)[0];
      if (this.cancelled.has(item.reqId)) {
        this.cancelled.delete(item.reqId);
        continue;
      }
      const workerIndex = this.freeWorkers.pop()!;
      this.flushInstalls(workerIndex);
      this.inflight.set(item.reqId, item);
      this.sentAt.set(item.reqId, performance.now());
      if (item.island) {
        this.workers[workerIndex].postMessage({ type: 'island', reqId: item.reqId, seed: item.seed, cx: item.island.cx, cz: item.island.cz });
        continue;
      }
      if (item.horizonSeg) {
        this.workers[workerIndex].postMessage({ type: 'horizon', reqId: item.reqId, seed: item.seed, minX: item.minWorldX, minZ: item.minWorldZ, size: item.chunkSize, seg: item.horizonSeg });
        continue;
      }
      if (item.vegPlan) {
        this.workers[workerIndex].postMessage({ type: 'vegPlan', reqId: item.reqId, seed: item.seed, cx: item.vegPlan.cx, cz: item.vegPlan.cz, size: item.chunkSize, detail: item.vegPlan.detail });
        continue;
      }
      if (item.waterBiome) {
        this.workers[workerIndex].postMessage({ type: 'waterBiome', reqId: item.reqId, seed: item.seed, originX: item.waterBiome.originX, originZ: item.waterBiome.originZ });
        continue;
      }
      if (item.impostor) {
        this.workers[workerIndex].postMessage({ type: 'impostors', reqId: item.reqId, seed: item.seed, minX: item.minWorldX, minZ: item.minWorldZ, size: item.chunkSize, originX: item.impostor.originX, originZ: item.impostor.originZ });
        continue;
      }
      this.workers[workerIndex].postMessage({
        reqId: item.reqId,
        seed: item.seed,
        params: item.params,
        minWorldX: item.minWorldX,
        minWorldZ: item.minWorldZ,
        chunkSize: item.chunkSize,
        density: item.density,
        segments: item.segments,
        walls: item.walls,
      });
    }
  }

  private handleMessage(workerIndex: number, data: any): void {
    this.freeWorkers.push(workerIndex);
    // antes de resolver o chunk: quem consultar a altura dele já acha a ilha pronta
    if (data.hydro) {
      if (this.onHydrology) for (const h of data.hydro) this.onHydrology(data.seed, h.key, h.data);
      this.broadcastIslands(data.seed, data.hydro, workerIndex);
    }
    const item = this.inflight.get(data.reqId);
    this.inflight.delete(data.reqId);
    const sent = this.sentAt.get(data.reqId);
    this.sentAt.delete(data.reqId);
    if (item && sent !== undefined && this.wall.length < 5000) {
      const kind = item.island ? 'island' : item.horizonSeg ? 'horizon' : item.vegPlan ? 'vegPlan' : item.waterBiome ? 'waterBiome' : item.impostor ? 'impostor' : 'chunk';
      this.wall.push({ kind, density: item.density, ms: performance.now() - sent, worker: data.ms, t: performance.now() });
    }
    if (item?.island) {
      const k = islandKey(item.seed, item.island.cx, item.island.cz);
      this.islandsPending.delete(k);
      this.islandsDone.add(k);
    }
    if (item && data.ms !== undefined && this.stats.length < 5000) {
      this.stats.push({ density: item.density, segments: item.segments, island: !!item.island, ms: data.ms, newIslands: data.newIslands || 0, t: performance.now(), tGeo: data.tGeo, tTex: data.tTex } as any);
    }
    const wasCancelled = this.cancelled.delete(data.reqId);

    if (item) {
      if (wasCancelled) {
        item.reject(new Error('cancelled'));
      } else if (data.error) {
        item.reject(new Error(data.error));
      } else {
        item.resolve({ texture: data.texture, geometry: data.geometry, horizon: data.horizon, impostors: data.impostors, waterBiome: data.waterBiome, vegPlan: data.vegPlan });
      }
    }
    this.pump();
  }

  public terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pendingInstalls.clear();
    this.freeWorkers = [];
    this.queue = [];
    this.inflight.clear();
    this.cancelled.clear();
  }
}

let sharedPool: TextureWorkerPool | undefined;

export function getTextureWorkerPool(): TextureWorkerPool {
  if (!sharedPool) {
    sharedPool = new TextureWorkerPool();
  }
  return sharedPool;
}
