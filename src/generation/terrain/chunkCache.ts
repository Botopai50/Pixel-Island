import GEN_HASH from 'virtual:gen-hash';

/**
 * Cache dos chunks gerados, no disco (IndexedDB): a textura, a malha, o bloco do horizonte e as árvores distantes de cada chunk custam ~125 s de
 * CPU para uma área inteira (8 workers: ~16 s), e são sempre os mesmos para a mesma semente. Voltando a uma área já visitada (ou reabrindo o
 * jogo), eles vêm do disco em vez de serem refeitos.
 *
 * A chave leva a impressão digital do código que gera o relevo (vite.config.ts: virtual:gen-hash) e a dos parâmetros da textura: mudou o código
 * ou o painel de texturas, o que estava guardado deixa de valer sozinho (e é apagado). Cada vetor numérico é guardado comprimido (deflate).
 * Se algo falhar (IndexedDB indisponível, cota cheia), o jogo segue sem cache. ?cache=0 desliga.
 *
 * Tudo o que custa (IndexedDB, compressão, descompressão) roda no worker `chunkCache.worker.ts`: a compressão do navegador roda na thread que a
 * chama, e na principal cada chunk custava 40 a 49 ms de um quadro só. Aqui fica só o cliente fino: `chunkCacheGet` pede ao worker e recebe os
 * vetores prontos por transferência; as gravações vêm direto dos workers de geração (textureWorkerPool.ts liga as portas).
 */

export const chunkCacheStats = { hits: 0, misses: 0, puts: 0, errors: 0 };

/** o cache está ligado? (?cache=0, ou sem IndexedDB/CompressionStream, desliga) */
export const chunkCacheEnabled = typeof indexedDB !== 'undefined' && typeof CompressionStream !== 'undefined' && !/[?&]cache=0\b/.test(typeof location !== 'undefined' ? location.search : '');

let cacheWorker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (data: unknown | null) => void>();

/** Liga o cliente ao worker do cache (criado pelo pool de workers, que também liga as portas de gravação). */
export function attachChunkCacheWorker(w: Worker): void {
  cacheWorker = w;
  w.onmessage = (ev: MessageEvent) => {
    const d = ev.data as { id?: number; data?: unknown; stat?: string };
    if (d.stat) { if (d.stat === 'put') chunkCacheStats.puts++; else chunkCacheStats.errors++; return; }
    const cb = d.id !== undefined ? pending.get(d.id) : undefined;
    if (!cb) return;
    pending.delete(d.id as number);
    cb(d.data ?? null);
  };
  // se o worker morrer, ninguém fica esperando: tudo vira "não achei" e o jogo gera os chunks normalmente
  w.onerror = () => { cacheWorker = null; for (const cb of pending.values()) cb(null); pending.clear(); };
}

/** Chave de um trabalho: tipo + código + parâmetros. */
export function chunkCacheKey(kind: string, parts: (string | number | boolean | undefined)[]): string {
  return GEN_HASH + '|' + kind + '|' + parts.map((p) => (p === undefined ? '' : typeof p === 'boolean' ? (p ? 1 : 0) : p)).join(',');
}

/** Impressão digital curta de um objeto de parâmetros (FNV-1a sobre o JSON). */
export function paramsFingerprint(params: unknown): string {
  const s = JSON.stringify(params);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function chunkCacheGet(key: string): Promise<unknown | null> {
  const w = cacheWorker;
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, (data) => { if (data) chunkCacheStats.hits++; else chunkCacheStats.misses++; resolve(data); });
    w.postMessage({ op: 'get', id, key });
  });
}

if (typeof globalThis !== 'undefined') (globalThis as unknown as { __chunkCache?: unknown }).__chunkCache = { stats: chunkCacheStats };
