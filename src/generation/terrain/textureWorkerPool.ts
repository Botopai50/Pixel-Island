import { ForgeParams, ChunkTextureResult } from './terrainTextureForge.ts';
import { ChunkGeometryData } from './chunkGeometry.ts';
import { CONFIG } from '../../config.ts';

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
  resolve: (r: ChunkJobResult) => void;
  reject: (e: unknown) => void;
}

function defaultPoolSize(): number {
  // Deixa 1 núcleo livre para a thread principal (4 núcleos -> 3 workers). Teto de 8: com 12
  // workers numa CPU de 16 threads (8 núcleos físicos) cada job ficava 2-3x mais lento e o
  // carregamento todo demorava o dobro; cada worker também guarda buffers de rascunho.
  const forced = Number(new URLSearchParams(self.location?.search ?? "").get("workers"));
  if (forced > 0) return Math.min(16, forced); // ?workers=N (medição)
  const cores = (navigator as any).hardwareConcurrency || 4;
  return Math.max(2, Math.min(8, cores - 1));
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
  public stats: { density: number; segments: number; island: boolean; ms: number; newIslands: number; t: number }[] = [];
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
    const promise = new Promise<ChunkJobResult>((resolve, reject) => {
      this.queue.push({
        reqId, seed, params: { ...params }, minWorldX, minWorldZ, chunkSize, density, segments, walls, priority, resolve, reject
      });
      this.pump();
    });
    return { promise, reqId };
  }

  /**
   * Pede a UM worker a hidrologia de uma ilha (0.3-1s), antes dos chunks dela: o resultado é
   * repassado aos outros workers e à thread principal, e ninguém mais precisa recalcular.
   */
  public prefetchIsland(seed: number, cx: number, cz: number, priority: number = -1): void {
    if (this.enqueueIsland(seed, cx, cz, priority)) this.pump();
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
    this.workers.forEach((w, i) => { if (i !== except) w.postMessage({ type: 'install', seed, items }); });
  }

  /** Há chunks/ilhas na fila ou sendo gerados? */
  public isBusy(): boolean {
    return this.queue.length > 0 || this.inflight.size > 0;
  }

  public cancel(reqId: number): void {
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
    if (item.island) return false;
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
      this.inflight.set(item.reqId, item);
      if (item.island) {
        this.workers[workerIndex].postMessage({ type: 'island', reqId: item.reqId, seed: item.seed, cx: item.island.cx, cz: item.island.cz });
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
        item.resolve({ texture: data.texture, geometry: data.geometry });
      }
    }
    this.pump();
  }

  public terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
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
