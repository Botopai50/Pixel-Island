/**
 * Worker do cache de chunks em disco (IndexedDB), ver chunkCache.ts.
 *
 * A compressão e a descompressão (CompressionStream/DecompressionStream) rodam NA THREAD que as chama: na thread principal cada chunk (alguns MB) custava
 * 40 a 49 ms de um quadro só, a cada travessia de chunk. Aqui elas, o IndexedDB e a contabilidade do disco ficam fora do quadro: a thread principal só pede
 * `get` (a chave, e recebe os vetores já prontos por transferência, sem cópia), e as gravações vêm direto dos workers de geração, por portas (a thread
 * principal nem vê os dados).
 */
import GEN_HASH from 'virtual:gen-hash';

const ctx = self as unknown as Worker;

const DB_NAME = 'pie-chunk-cache';
const STORE = 'chunks';
const META = 'meta';
const MAX_BYTES = 450 * 1024 * 1024;

interface Entry { key: string; t: number; size: number; data: unknown }
type Packed = { __ta: string; len: number; buf: ArrayBuffer };

const TYPED: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
} as never;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let enabled = typeof indexedDB !== 'undefined' && typeof CompressionStream !== 'undefined';
let total = 0;
const sizes = new Map<string, { size: number; t: number }>();

function open(): Promise<IDBDatabase | null> {
  if (!enabled) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // tamanhos e idades de tudo o que está guardado (para apagar o mais velho quando passa do limite) e limpeza do que é de outro código
        try {
          const tx = db.transaction(META, 'readonly');
          const cur = tx.objectStore(META).openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (c) { const v = c.value as { key: string; size: number; t: number }; sizes.set(v.key, { size: v.size, t: v.t }); total += v.size; c.continue(); }
            else { purgeStale(db); resolve(db); }
          };
          cur.onerror = () => resolve(db);
        } catch { resolve(db); }
      };
      req.onerror = () => { enabled = false; resolve(null); };
      req.onblocked = () => resolve(null);
    } catch { enabled = false; resolve(null); }
  });
  return dbPromise;
}

/** apaga o que foi gerado por outro código (a chave começa com a impressão digital) */
function purgeStale(db: IDBDatabase): void {
  const stale = [...sizes.keys()].filter((k) => !k.startsWith(GEN_HASH + '|'));
  if (stale.length === 0) return;
  try {
    const tx = db.transaction([STORE, META], 'readwrite');
    for (const k of stale) { tx.objectStore(STORE).delete(k); tx.objectStore(META).delete(k); total -= sizes.get(k)!.size; sizes.delete(k); }
  } catch { /* ok */ }
}

function evictIfNeeded(db: IDBDatabase): void {
  if (total <= MAX_BYTES) return;
  const byAge = [...sizes.entries()].sort((a, b) => a[1].t - b[1].t);
  try {
    const tx = db.transaction([STORE, META], 'readwrite');
    for (const [k, v] of byAge) {
      if (total <= MAX_BYTES * 0.85) break;
      tx.objectStore(STORE).delete(k); tx.objectStore(META).delete(k);
      total -= v.size; sizes.delete(k);
    }
  } catch { /* ok */ }
}

async function pump(stream: CompressionStream | DecompressionStream, input: Uint8Array): Promise<ArrayBuffer> {
  const w = stream.writable.getWriter();
  const written = w.write(input as unknown as BufferSource).then(() => w.close());
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
  }
  await written;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

async function pack(v: unknown): Promise<unknown> {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const ta = v as unknown as { constructor: { name: string }; byteOffset: number; byteLength: number; buffer: ArrayBufferLike; length: number };
    const bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    return { __ta: ta.constructor.name, len: ta.length, buf: await pump(new CompressionStream('deflate-raw'), bytes) } as Packed;
  }
  if (Array.isArray(v)) return Promise.all(v.map(pack));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    await Promise.all(Object.keys(v as object).map(async (k) => { out[k] = await pack((v as Record<string, unknown>)[k]); }));
    return out;
  }
  return v;
}

async function unpack(v: unknown): Promise<unknown> {
  if (v && typeof v === 'object') {
    const p = v as Packed;
    if (typeof p.__ta === 'string' && p.buf instanceof ArrayBuffer) {
      const raw = await pump(new DecompressionStream('deflate-raw'), new Uint8Array(p.buf));
      const C = TYPED[p.__ta];
      return new C(raw);
    }
    if (Array.isArray(v)) return Promise.all(v.map(unpack));
    const out: Record<string, unknown> = {};
    await Promise.all(Object.keys(v as object).map(async (k) => { out[k] = await unpack((v as Record<string, unknown>)[k]); }));
    return out;
  }
  return v;
}

function byteSize(v: unknown): number {
  if (v && typeof v === 'object') {
    const p = v as Packed;
    if (typeof p.__ta === 'string' && p.buf instanceof ArrayBuffer) return p.buf.byteLength;
    if (Array.isArray(v)) return v.reduce((s: number, x) => s + byteSize(x), 0);
    return Object.values(v as object).reduce((s: number, x) => s + byteSize(x), 0);
  }
  return 8;
}

/** os buffers de um resultado já desempacotado, para devolvê-lo por transferência (sem cópia) */
function buffersOf(v: unknown, out: Set<ArrayBuffer>): void {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) { out.add((v as { buffer: ArrayBuffer }).buffer); return; }
  if (Array.isArray(v)) { for (const x of v) buffersOf(x, out); return; }
  if (v && typeof v === 'object') for (const x of Object.values(v as object)) buffersOf(x, out);
}

async function get(id: number, key: string): Promise<void> {
  try {
    const db = await open();
    if (!db) { ctx.postMessage({ id, data: null }); return; }
    const rec = await new Promise<Entry | undefined>((resolve) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as Entry | undefined);
      r.onerror = () => resolve(undefined);
    });
    if (!rec) { ctx.postMessage({ id, data: null }); return; }
    const data = await unpack(rec.data);
    // usado agora: a idade (para apagar primeiro o que ficou parado) sobe de vez em quando
    const m = sizes.get(key);
    if (m && Date.now() - m.t > 3600_000) {
      m.t = Date.now();
      try { db.transaction(META, 'readwrite').objectStore(META).put({ key, size: m.size, t: m.t }); } catch { /* ok */ }
    }
    const bufs = new Set<ArrayBuffer>();
    buffersOf(data, bufs);
    ctx.postMessage({ id, data }, [...bufs]);
  } catch {
    ctx.postMessage({ id, data: null, error: true });
  }
}

// os vetores de um resultado seguem na memória até serem comprimidos: no máximo 2 gravações ao mesmo tempo (um carregamento inteiro tem ~700)
const putQueue: { key: string; value: unknown }[] = [];
let putsRunning = 0;
function pumpPuts(): void {
  while (putsRunning < 2 && putQueue.length > 0) {
    const job = putQueue.shift()!;
    putsRunning++;
    putNow(job.key, job.value).finally(() => { putsRunning--; pumpPuts(); });
  }
}

function put(key: string, value: unknown): void {
  if (!enabled) return;
  if (putQueue.length > 400) return;   // o disco não acompanhou: o que não coube é refeito na próxima vez
  putQueue.push({ key, value });
  pumpPuts();
}

async function putNow(key: string, value: unknown): Promise<void> {
  if (!enabled) return;
  try {
    const db = await open();
    if (!db) return;
    const data = await pack(value);
    const size = byteSize(data);
    const t = Date.now();
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE, META], 'readwrite');
      tx.objectStore(STORE).put({ key, t, size, data } as Entry);
      tx.objectStore(META).put({ key, size, t });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    const old = sizes.get(key);
    if (old) total -= old.size;
    sizes.set(key, { size, t });
    total += size;
    ctx.postMessage({ stat: 'put' });
    evictIfNeeded(db);
  } catch {
    ctx.postMessage({ stat: 'error' });
  }
}

ctx.onmessage = (ev: MessageEvent) => {
  const d = ev.data as { op?: string; id?: number; key?: string; port?: MessagePort };
  if (d.op === 'get') { void get(d.id as number, d.key as string); return; }
  if (d.op === 'port' && d.port) {
    // um worker de geração grava por aqui: {key, value} com os vetores já copiados e transferidos para este worker
    d.port.onmessage = (e: MessageEvent) => { const m = e.data as { key: string; value: unknown }; put(m.key, m.value); };
  }
};
