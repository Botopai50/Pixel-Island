import * as THREE from 'three';

// Gerador procedural de textura de grama em pixel art.
// Segue a técnica de camadas usada à mão: o chão é dividido em três tons
// (claro / médio / escuro) por um campo de ruído, e as fronteiras entre tons são
// desenhadas com a "lâmina": a camada mais clara transborda em folhas sobre a
// mais escura. O interior das clareiras fica liso; os tufos médios ganham
// pontilhado escuro; tufinhos lima e flores enfeitam as clareiras.

export type GrassMode = 'seamless' | 'tile';

export interface GrassParams {
  size: number;           // lado da textura em pixels de arte
  seed: number;
  mode: GrassMode;        // 'seamless' repete sem emenda; 'tile' = bloco isolado com borda irregular
  lightCover: number;     // 0..1 fração da área em verde claro (clareiras)
  darkCover: number;      // 0..1 fração da área em verde escuro
  clumpScale: number;     // quantas manchas cabem no lado da textura
  bands: number;          // 0..1 força da faixa diagonal
  centerBias: number;     // 0..1 (modo bloco) puxa a área clara para o centro
  spill: number;          // alcance (px) das folhas que transbordam nas fronteiras
  density: number;        // 0..1 quantas folhas preenchem as fronteiras
  detail: number;         // 0..1 densidade de folhas dentro dos tufos médios/escuros
  spacing: number;        // distância entre posições candidatas de lâmina (px)
  pairs: number;          // 0..1 chance de formar um "V" com a lâmina espelhada
  limeTufts: number;      // tufinhos lima nas clareiras
  flowerClusters: number;
  blade: number[][];      // máscara da lâmina (1 = pixel pintado), apontando para baixo-direita
  palette: string[];      // [lima, verde claro, verde médio, verde escuro, pétala, miolo]
}

export interface GrassTexture {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

// Lâmina extraída da referência: folha diagonal 4x4.
export const DEFAULT_BLADE: number[][] = [
  [1, 1, 1, 0],
  [0, 1, 1, 1],
  [0, 0, 1, 1],
  [0, 0, 0, 1],
];

export const DEFAULT_PALETTE = ['#cdfd6d', '#8cdc5b', '#3da06e', '#3b6d70', '#fefce8', '#fae277'];

export const DEFAULT_PARAMS: GrassParams = {
  size: 64,
  seed: 1337,
  mode: 'seamless',
  lightCover: 0.35,
  darkCover: 0.22,
  clumpScale: 2,
  bands: 0.5,
  centerBias: 0.7,
  spill: 3,
  density: 0.8,
  detail: 0.55,
  spacing: 3,
  pairs: 0.3,
  limeTufts: 5,
  flowerClusters: 2,
  blade: DEFAULT_BLADE,
  palette: DEFAULT_PALETTE,
};

const LIME = 0, LIGHT = 1, MID = 2, DARK = 3, PETAL = 4, CENTER = 5;
const EMPTY = -1, OUTSIDE = -2;

// Flor 5x5: P = pétala, C = miolo.
const FLOWER = [
  '.P.P.',
  'PPCPP',
  '.CCC.',
  'PPCPP',
  '.P.P.',
];

// 8 direções para procurar tons vizinhos.
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
// Só para cima: folhas penduram do tom que está acima delas, como escamas sobrepostas.
const UP = [[0, -1], [0.6, -0.8], [-0.6, -0.8], [0.9, -0.4], [-0.9, -0.4]];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

// Ruído de valor periódico: o reticulado dá a volta em `period`, então repete sem emenda.
function periodicNoise(rng: () => number, period: number): (x: number, y: number) => number {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (i: number, j: number) => g[mod(j, period) * period + mod(i, period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smooth(x - xi), fy = smooth(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return a + (b - a) * fy;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

interface Blade { x: number; y: number; color: number; flip: boolean }

export function generateGrass(p: GrassParams): GrassTexture {
  const { width, indices } = generateGrassIndices(p);
  const pal = p.palette.map(hexToRgb);
  const data = new Uint8ClampedArray(width * width * 4);
  for (let i = 0; i < indices.length; i++) {
    const c = indices[i];
    if (c < 0) continue;
    const [r, g, b] = pal[c];
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { width, height: width, data };
}

/** Índices da paleta: 0 lima, 1 claro, 2 médio, 3 escuro, 4 pétala, 5 miolo; -1 transparente. */
export const GRASS_LIME = LIME, GRASS_LIGHT = LIGHT, GRASS_MID = MID, GRASS_DARK = DARK, GRASS_PETAL = PETAL, GRASS_CENTER = CENTER;

/** Mesma geração, devolvendo os índices da paleta em vez de RGBA (usado pelo chão do jogo). */
export function generateGrassIndices(p: GrassParams): { width: number; indices: Int8Array } {
  const size = Math.max(8, Math.round(p.size));
  const seamless = p.mode === 'seamless';
  const margin = seamless ? 0 : Math.max(4, Math.round(size * 0.08));
  const W = size + margin * 2;
  const rng = mulberry32(p.seed);
  const inside = (x: number, y: number) => seamless || (x >= 0 && y >= 0 && x < size && y < size);

  // Índices da paleta no buffer final; -1 = transparente.
  const buf = new Int8Array(W * W).fill(EMPTY);
  const idx = (x: number, y: number): number => {
    if (seamless) return mod(y, size) * W + mod(x, size);
    const px = x + margin, py = y + margin;
    return px < 0 || py < 0 || px >= W || py >= W ? -1 : py * W + px;
  };
  const get = (x: number, y: number) => { const i = idx(x, y); return i < 0 ? OUTSIDE : buf[i]; };
  const set = (x: number, y: number, c: number) => { const i = idx(x, y); if (i >= 0) buf[i] = c; };

  // --- 1. Campo: manchas (fbm periódico) + faixa diagonal ondulada. 0 = claro, 1 = escuro.
  const period = Math.max(1, Math.round(p.clumpScale));
  const n1 = periodicNoise(rng, period);
  const n2 = periodicNoise(rng, period * 2);
  const n3 = periodicNoise(rng, period * 4);
  const warp = periodicNoise(rng, 2);
  const bandPhase = rng() * Math.PI * 2;
  const field = (x: number, y: number): number => {
    const u = x / size, v = y / size;
    let s = (n1(u * period, v * period) + 0.5 * n2(u * period * 2, v * period * 2)
      + 0.2 * n3(u * period * 4, v * period * 4)) / 1.7;
    // Onda ao longo de x+y com frequência inteira: continua repetível.
    s += p.bands * 0.35 * Math.sin(2 * Math.PI * (u + v) + bandPhase + 3 * warp(u * 2, v * 2));
    if (!seamless) {
      // Bloco isolado: escurece em direção às bordas, mais forte embaixo (como na referência).
      const d = Math.min(x, y, size - 1 - x, (size - 1 - y) * 0.7) / size;
      s += (1 - smooth(clamp01(d / 0.18))) * 0.45;
      // Gradiente radial: a clareira se concentra no centro (um pouco acima, como na referência).
      const r = Math.hypot(u - 0.5, v - 0.45) / 0.5;
      s += p.centerBias * 0.6 * r * r;
    }
    return s;
  };

  // Limiares por quantil: as frações de área claro/escuro ficam exatamente as pedidas.
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) values[y * size + x] = field(x, y);
  const sorted = Float32Array.from(values).sort();
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * sorted.length)))];
  const tLight = q(clamp01(p.lightCover));
  const tDark = q(clamp01(1 - p.darkCover));

  const tone = new Int8Array(size * size);
  for (let i = 0; i < values.length; i++) tone[i] = values[i] < tLight ? LIGHT : values[i] < tDark ? MID : DARK;
  const toneAt = (x: number, y: number): number => {
    if (!inside(x, y)) return OUTSIDE;
    return tone[mod(y, size) * size + mod(x, size)];
  };

  // --- 2. Chão liso com os três tons.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, tone[y * size + x]);

  // --- 3. Lâminas nas fronteiras e pontilhado interno.
  const bh = p.blade.length, bw = Math.max(...p.blade.map(r => r.length));
  const blades: Blade[] = [];
  const addBlade = (x: number, y: number, color: number) => {
    const flip = rng() < 0.5;
    blades.push({ x, y, color, flip });
    // Par em "V": a folha espelhada fica do lado para onde a ponta aponta, com 1px de vão
    // entre as duas para que continuem sendo folhas separadas.
    if (rng() < p.pairs) blades.push({ x: x + (flip ? -(bw + 1) : bw + 1), y, color, flip: !flip });
  };

  const sp = Math.max(1, Math.round(p.spacing));
  const lo = seamless ? 0 : -margin, hi = seamless ? size : size + margin;
  for (let gy = lo; gy < hi; gy += sp) {
    for (let gx = lo; gx < hi; gx += sp) {
      const x = gx + Math.floor(rng() * sp), y = gy + Math.floor(rng() * sp);
      const cx = x + (bw >> 1), cy = y + (bh >> 1);
      const own = toneAt(cx, cy);

      // Tom mais claro (e mais escuro) a uma distância aleatória até `spill`.
      const r = 1 + rng() * Math.max(0, p.spill);
      let lighter = own === OUTSIDE ? 99 : own, darker = OUTSIDE;
      for (const [dx, dy] of own === OUTSIDE ? DIRS : UP) {
        const t = toneAt(Math.round(cx + dx * r), Math.round(cy + dy * r));
        if (t === OUTSIDE) continue;
        if (t < lighter) lighter = t;
        if (t > darker) darker = t;
      }

      if (own === OUTSIDE) {
        // Folhas soltas escapando para fora do bloco, com a cor da borda.
        if (darker !== OUTSIDE && rng() < p.density * 0.55) addBlade(x, y, Math.max(darker, MID));
        continue;
      }
      if (lighter < own && rng() < p.density) {
        addBlade(x, y, lighter);                 // tom claro de cima pende sobre o escuro
      } else if (own === MID && rng() < p.detail) {
        addBlade(x, y, rng() < 0.55 ? MID : DARK); // folhagem do tufo: tons alternados desenham as folhas
      } else if (own === DARK && rng() < p.detail * 0.7) {
        addBlade(x, y, rng() < 0.45 ? MID : DARK); // relevo dentro da sombra
      }
    }
  }

  // --- Luz nas clareiras: flores e tufinhos lima.
  const dist = (ax: number, ay: number, bx: number, by: number) => {
    let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    if (seamless) { dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy); }
    return { dx, dy, d: Math.hypot(dx, dy) };
  };
  const fieldAt = (x: number, y: number) => values[mod(y, size) * size + mod(x, size)];
  const deepLight = (x: number, y: number, r: number) =>
    inside(x, y) && DIRS.every(([dx, dy]) => toneAt(Math.round(x + dx * r), Math.round(y + dy * r)) === LIGHT);

  // Flores escolhem lugar primeiro. Cada grupo sorteia um ponto qualquer da área clara,
  // quantas flores terá (1 a 4, muitas vezes só uma) e o quão aberto é; cada flor cai num
  // ângulo/distância aleatórios dentro dele. A posição guardada é o canto da flor 5x5.
  const flowers: { x: number; y: number }[] = [];
  const flowerFree = (x: number, y: number) =>
    inside(x, y) && inside(x + 4, y + 5) && toneAt(x + 2, y + 2) === LIGHT
    && !flowers.some(o => { const { dx, dy } = dist(x, y, o.x, o.y); return dx < 6 && dy < 6; });
  for (let c = 0; c < p.flowerClusters; c++) {
    let at: { x: number; y: number } | null = null;
    for (let t = 0; t < 80 && !at; t++) {
      const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
      if (deepLight(x, y, 2) && flowerFree(x - 2, y - 2)) at = { x, y };
    }
    if (!at) continue;
    const r = rng();
    const count = r < 0.35 ? 1 : r < 0.7 ? 2 : r < 0.9 ? 3 : 4;
    const spread = 4 + rng() * 7;
    for (let placed = 0, tries = 0; placed < count && tries < 40; tries++) {
      const a = rng() * Math.PI * 2, d = placed === 0 ? 0 : spread * (0.6 + rng() * 0.6);
      const x = Math.round(at.x - 2 + Math.cos(a) * d), y = Math.round(at.y - 2 + Math.sin(a) * d);
      if (!flowerFree(x, y)) continue;
      flowers.push({ x, y });
      placed++;
    }
  }

  // Tufinhos lima formam 1 ou 2 manchas de luz no ponto mais claro das clareiras:
  // o primeiro tufinho vai no mínimo do campo e os outros crescem ao redor, lado a lado,
  // sem sobrepor (a caixa de um tufinho tem ~9x8 px acima da base).
  const tufts: { x: number; y: number }[] = [];
  const TW = 2 * bw + 1, TH = 2 * bh;
  const tuftFits = (x: number, y: number) => {
    if (!deepLight(x, y - (bh >> 1), 4)) return false;
    if (tufts.some(o => { const { dx, dy } = dist(x, y, o.x, o.y); return dx < TW + 1 && dy < TH + 1; })) return false;
    // A caixa do tufinho (TW x TH acima da base) não pode tocar nenhuma flor
    // (5x6 contando a sombra, +1px de folga).
    const wrap = (d: number) => (seamless ? mod(d + size / 2, size) - size / 2 : d);
    return !flowers.some(o => {
      const ox = wrap(o.x - (x - bw)), oy = wrap(o.y - (y - TH + 1));
      return ox - 1 < TW && ox + 6 > 0 && oy - 1 < TH && oy + 7 > 0;
    });
  };
  const NEIGHBORS = [[TW + 1, 1], [-(TW + 1), 2], [4, TH + 1], [-5, TH + 1], [6, -(TH + 1)], [-4, -(TH + 1)], [TW + 2, -5], [-(TW + 2), -4]];
  const patches = p.limeTufts <= 3 ? 1 : 2;
  const centers: { x: number; y: number }[] = [];
  for (let k = 0; k < patches; k++) {
    let best: { x: number; y: number; v: number } | null = null;
    for (let t = 0; t < 300; t++) {
      const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
      if (!tuftFits(x, y) || centers.some(c => dist(x, y, c.x, c.y).d < size * 0.35)) continue;
      const v = fieldAt(x, y - (bh >> 1));
      if (!best || v < best.v) best = { x, y, v };
    }
    if (best) centers.push(best);
  }
  centers.forEach((c, k) => {
    const want = Math.round(p.limeTufts / centers.length) + (k === 0 ? p.limeTufts % centers.length : 0);
    const patch = [c];
    tufts.push(c);
    for (let t = 0; patch.length < want && t < 40; t++) {
      const from = patch[Math.floor(rng() * patch.length)];
      const [ox, oy] = NEIGHBORS[Math.floor(rng() * NEIGHBORS.length)];
      const x = from.x + ox, y = from.y + oy;
      if (!tuftFits(x, y)) continue;
      patch.push({ x, y });
      tufts.push({ x, y });
    }
  });

  for (const at of tufts) {
    // Leque de 3 folhas separadas cujas pontas convergem para a base (at):
    // duas apontando para baixo-direita, empilhadas na diagonal, e uma espelhada ao lado.
    // Às vezes o leque inteiro é espelhado.
    const m = rng() < 0.5;
    const leaf = (dx: number, dy: number, flip: boolean) => blades.push({
      x: m ? at.x - dx - (bw - 1) : at.x + dx, y: at.y + dy, color: LIME, flip: flip !== m,
    });
    leaf(-bw, -(bh - 1), false);          // folha de baixo: ponta logo à esquerda da base
    leaf(1, -bh, true);                   // folha espelhada: ponta logo à direita, 1px acima
    if (rng() < 0.75) leaf(1 - bw, -2 * bh + 1, false); // folha de cima, deslocada para a direita
  }

  // Camadas do escuro para o claro (o tom claro fica sempre por cima);
  // dentro da mesma camada, as lâminas mais abaixo cobrem as de cima.
  blades.sort((a, b) => b.color - a.color || a.y - b.y);
  for (const b of blades) {
    for (let r = 0; r < bh; r++) {
      const row = p.blade[r];
      for (let k = 0; k < row.length; k++) {
        if (row[k]) set(b.x + (b.flip ? bw - 1 - k : k), b.y + r, b.color);
      }
    }
  }

  // --- 4. Flores (posições já sorteadas acima).
  {
    for (const fl of flowers) {
      for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) {
        const ch = FLOWER[r][k];
        if (ch === '.') continue;
        // sombra 1px abaixo, só onde ainda é grama clara
        const below = get(fl.x + k, fl.y + r + 1);
        if (below === LIGHT || below === LIME) set(fl.x + k, fl.y + r + 1, MID);
      }
      for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) {
        const ch = FLOWER[r][k];
        if (ch !== '.') set(fl.x + k, fl.y + r, ch === 'P' ? PETAL : CENTER);
      }
    }
  }

  return { width: W, indices: buf };
}

// Textura Three.js pronta para uso em materiais (pixel art nítido, repetível).
export function createGrassTexture(p: GrassParams = DEFAULT_PARAMS, tex: GrassTexture = generateGrass(p)): THREE.DataTexture {
  // DataTexture começa pela linha de baixo; inverte para manter a orientação da arte.
  const row = tex.width * 4;
  const flipped = new Uint8Array(tex.data.length);
  for (let y = 0; y < tex.height; y++) {
    flipped.set(tex.data.subarray(y * row, (y + 1) * row), (tex.height - 1 - y) * row);
  }
  const t = new THREE.DataTexture(flipped, tex.width, tex.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = p.mode === 'seamless' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
