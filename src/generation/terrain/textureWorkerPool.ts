import { ForgeParams, ChunkTextureResult } from './terrainTextureForge.ts';

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
  priority: number;
  resolve: (r: ChunkTextureResult) => void;
  reject: (e: unknown) => void;
}

function defaultPoolSize(): number {
  // Deixa 2 núcleos livres (thread principal + GPU/driver). Teto de 8: cada worker guarda buffers
  // de rascunho que crescem com o quadrado da densidade de texels.
  const cores = (navigator as any).hardwareConcurrency || 4;
  return Math.max(2, Math.min(8, cores - 2));
}

export class TextureWorkerPool {
  private workers: Worker[] = [];
  private freeWorkers: number[] = [];
  private queue: PendingReq[] = [];
  private inflight: Map<number, PendingReq> = new Map();
  private cancelled: Set<number> = new Set();
  private reqCounter: number = 0;

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
    priority: number = 0
  ): { promise: Promise<ChunkTextureResult>; reqId: number } {
    const reqId = ++this.reqCounter;
    const promise = new Promise<ChunkTextureResult>((resolve, reject) => {
      this.queue.push({
        reqId, seed, params: { ...params }, minWorldX, minWorldZ, chunkSize, density, priority, resolve, reject
      });
      this.pump();
    });
    return { promise, reqId };
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

  private pump(): void {
    while (this.freeWorkers.length > 0 && this.queue.length > 0) {
      // Menor prioridade primeiro (0 = primeira textura de um chunk, 1 = upgrade de LOD): o mundo
      // aparece inteiro antes de ficar nítido. Empates mantêm a ordem de chegada, que já é do
      // chunk mais perto para o mais longe.
      let pick = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority < this.queue[pick].priority) pick = i;
      }
      const item = this.queue.splice(pick, 1)[0];
      if (this.cancelled.has(item.reqId)) {
        this.cancelled.delete(item.reqId);
        continue;
      }
      const workerIndex = this.freeWorkers.pop()!;
      this.inflight.set(item.reqId, item);
      this.workers[workerIndex].postMessage({
        reqId: item.reqId,
        seed: item.seed,
        params: item.params,
        minWorldX: item.minWorldX,
        minWorldZ: item.minWorldZ,
        chunkSize: item.chunkSize,
        density: item.density
      });
    }
  }

  private handleMessage(workerIndex: number, data: any): void {
    this.freeWorkers.push(workerIndex);
    const item = this.inflight.get(data.reqId);
    this.inflight.delete(data.reqId);
    const wasCancelled = this.cancelled.delete(data.reqId);

    if (item) {
      if (wasCancelled) {
        item.reject(new Error('cancelled'));
      } else if (data.error) {
        item.reject(new Error(data.error));
      } else {
        item.resolve({
          img: new Uint8ClampedArray(data.img),
          imgD: new Uint8ClampedArray(data.imgD),
          bimg: new Uint8ClampedArray(data.bimg),
          width: data.width,
          height: data.height
        });
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
