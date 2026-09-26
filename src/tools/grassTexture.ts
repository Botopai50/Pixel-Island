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
  spill: number;          // largura (px) da transição entrelaçada entre os tons
  density: number;        // 0..1 quantas folhas entrelaçam claro e médio na transição
  detail: number;         // 0..1 densidade de folhas dentro dos tufos médios/escuros
  spacing: number;        // distância entre posições candidatas de lâmina (px)
  pairs: number;          // 0..1 chance de formar um "V" com a lâmina espelhada
  limeTufts: number;      // leques lima (encadeados de 2 em 2) nas clareiras
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
  size: 88,
  seed: 1337,
  mode: 'seamless',
  lightCover: 0.6,
  darkCover: 0.08,
  clumpScale: 2,
  bands: 0.75,
  centerBias: 0.35,
  spill: 8,
  density: 0.6,
  detail: 0.55,
  spacing: 3,
  pairs: 0.3,
  limeTufts: 6,
  flowerClusters: 2,
  blade: DEFAULT_BLADE,
  palette: DEFAULT_PALETTE,
};

const LIME = 0, LIGHT = 1, MID = 2, DARK = 3, PETAL = 4, CENTER = 5;
const EMPTY = -1, OUTSIDE = -2;

// Flor 7x7 tirada da referência: P = pétala, C = miolo.
const FLOWER = [
  '.P..PP.',
  'PPPPPPP',
  'PPPCCPP',
  '.PCCCC.',
  '.PCCCCP',
  'PPPPPPP',
  'PPP.PP.',
];

// 8 direções para procurar tons vizinhos.
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

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

  // Distância (px, Chebyshev) até o pixel mais próximo cujo tom satisfaz `pred`.
  // No modo contínuo a busca dá a volta nas bordas.
  const distanceTo = (pred: (t: number) => boolean): Int16Array => {
    const d = new Int16Array(size * size).fill(32767);
    const queue = new Int32Array(size * size);
    let head = 0, tail = 0;
    for (let i = 0; i < tone.length; i++) if (pred(tone[i])) { d[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % size, y = (i / size) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        let nx = x + ox, ny = y + oy;
        if (seamless) { nx = mod(nx, size); ny = mod(ny, size); } else if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (d[j] > d[i] + 1) { d[j] = d[i] + 1; queue[tail++] = j; }
      }
    }
    return d;
  };

  // O escuro nunca encosta no claro: sempre sobra uma faixa de médio entre os dois.
  const nearDark = distanceTo(t => t === DARK);
  for (let i = 0; i < tone.length; i++) if (tone[i] === LIGHT && nearDark[i] <= 3) tone[i] = MID;
  const toLight = distanceTo(t => t === LIGHT);
  const toMidOrDark = distanceTo(t => t !== LIGHT);
  const toDark = distanceTo(t => t === DARK);
  const toNotDark = distanceTo(t => t !== DARK);
  const distAt = (a: Int16Array, x: number, y: number) => a[mod(y, size) * size + mod(x, size)];

  // --- 2. Chão liso com os três tons.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, tone[y * size + x]);

  // --- 3. Folhas. A transição claro/médio é entrelaçada nos dois sentidos, como na referência:
  // folhas médias soltas salpicam a clareira e ficam mais densas perto do tufo, enquanto
  // folhas claras invadem o tufo. A chance cai com a distância até a fronteira.
  const bh = p.blade.length, bw = Math.max(...p.blade.map(r => r.length));
  const blades: Blade[] = [];
  const addBlade = (x: number, y: number, color: number) => {
    const flip = rng() < 0.5;
    blades.push({ x, y, color, flip });
    // Par em "V": a folha espelhada fica do lado para onde a ponta aponta, com 1px de vão
    // entre as duas para que continuem sendo folhas separadas.
    if (rng() < p.pairs) blades.push({ x: x + (flip ? -(bw + 1) : bw + 1), y, color, flip: !flip });
  };

  const band = Math.max(1, p.spill);
  const falloff = (d: number, width: number) => Math.max(0, 1 - d / width);
  const sp = Math.max(1, Math.round(p.spacing));
  const lo = seamless ? 0 : -margin, hi = seamless ? size : size + margin;
  for (let gy = lo; gy < hi; gy += sp) {
    for (let gx = lo; gx < hi; gx += sp) {
      const x = gx + Math.floor(rng() * sp), y = gy + Math.floor(rng() * sp);
      const cx = x + (bw >> 1), cy = y + (bh >> 1);
      const own = toneAt(cx, cy);

      if (own === OUTSIDE) {
        // Folhas escapando para fora do bloco herdam o tom da borda mais próxima
        // (claras onde a clareira chega na borda).
        const nx = Math.min(size - 1, Math.max(0, cx)), ny = Math.min(size - 1, Math.max(0, cy));
        const out = Math.max(Math.abs(cx - nx), Math.abs(cy - ny));
        if (rng() < Math.min(1, p.density * 1.4) * falloff(out, margin)) addBlade(x, y, toneAt(nx, ny));
        continue;
      }
      if (own === LIGHT) {
        const w = falloff(distAt(toMidOrDark, cx, cy), band);
        if (rng() < p.density * w) addBlade(x, y, MID);            // médio salpicando a clareira
      } else if (own === MID) {
        const wl = falloff(distAt(toLight, cx, cy), band * 0.8);
        const wd = falloff(distAt(toDark, cx, cy), band * 0.6);
        if (rng() < p.density * wl) addBlade(x, y, LIGHT);           // claro invadindo o tufo
        else if (rng() < p.detail * Math.max(wd, 0.2)) addBlade(x, y, DARK); // escuro perto da sombra
      } else {
        const wm = falloff(distAt(toNotDark, cx, cy), band * 0.6);
        if (rng() < p.detail * Math.max(wm, 0.3)) addBlade(x, y, MID); // relevo dentro da sombra
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

  // Flores (7x7) em grupos de 1 a 3 perto da beira da clareira, como na referência;
  // o centro fica para o lima. Cada flor cai num ângulo/distância aleatórios no grupo.
  const FS = FLOWER.length;
  const flowers: { x: number; y: number; mirror: boolean }[] = [];
  const flowerFree = (x: number, y: number) => {
    const cx = x + (FS >> 1), cy = y + (FS >> 1);
    return inside(x, y) && inside(x + FS - 1, y + FS - 1) && toneAt(cx, cy) === LIGHT
      && distAt(toMidOrDark, cx, cy) >= 3
      && !flowers.some(o => { const { dx, dy } = dist(x, y, o.x, o.y); return dx < FS + 1 && dy < FS + 1; });
  };
  for (let c = 0; c < p.flowerClusters; c++) {
    let at: { x: number; y: number } | null = null;
    for (let t = 0; t < 120 && !at; t++) {
      const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
      const edge = toneAt(x, y) === LIGHT ? distAt(toMidOrDark, x, y) : 0;
      if (edge >= 3 && edge <= 9 && flowerFree(x - (FS >> 1), y - (FS >> 1))) at = { x, y };
    }
    if (!at) continue;
    const r = rng();
    const count = r < 0.2 ? 1 : r < 0.65 ? 2 : 3;
    const spread = FS + 1 + rng() * 4;
    for (let placed = 0, tries = 0; placed < count && tries < 40; tries++) {
      const a = rng() * Math.PI * 2, d = placed === 0 ? 0 : spread * (0.8 + rng() * 0.5);
      const x = Math.round(at.x - (FS >> 1) + Math.cos(a) * d), y = Math.round(at.y - (FS >> 1) + Math.sin(a) * d);
      if (!flowerFree(x, y)) continue;
      flowers.push({ x, y, mirror: rng() < 0.5 });
      placed++;
    }
  }

  // Tufinhos lima: correntes de leques (4 a 6 folhas) no ponto mais claro das clareiras.
  // O primeiro leque vai no mínimo do campo e os seguintes descem na diagonal, sem sobrepor
  // (a caixa de um leque tem ~9x8 px acima da base).
  const tufts: { x: number; y: number }[] = [];
  const TW = 2 * bw + 1, TH = 2 * bh;
  const wrap = (d: number) => (seamless ? mod(d + size / 2, size) - size / 2 : d);
  const tuftFits = (x: number, y: number) => {
    if (!deepLight(x, y - (bh >> 1), 4)) return false;
    if (tufts.some(o => { const { dx, dy } = dist(x, y, o.x, o.y); return dx < TW + 1 && dy < TH + 1; })) return false;
    // A caixa do leque não pode tocar nenhuma flor (+1px de folga).
    return !flowers.some(o => {
      const ox = wrap(o.x - (x - bw)), oy = wrap(o.y - (y - TH + 1));
      return ox - 1 < TW && ox + FS + 1 > 0 && oy - 1 < TH && oy + FS + 1 > 0;
    });
  };
  const NEIGHBORS = [[5, TH + 1], [-5, TH + 1], [TW + 1, 3], [-(TW + 1), 3], [5, -(TH + 1)], [-5, -(TH + 1)]];
  const chains = Math.max(1, Math.ceil(p.limeTufts / 2));
  const centers: { x: number; y: number }[] = [];
  for (let k = 0; k < chains; k++) {
    let best: { x: number; y: number; v: number } | null = null;
    for (let t = 0; t < 300; t++) {
      const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
      if (!tuftFits(x, y) || centers.some(c => dist(x, y, c.x, c.y).d < size * 0.25)) continue;
      const v = fieldAt(x, y - (bh >> 1));
      if (!best || v < best.v) best = { x, y, v };
    }
    if (best) centers.push(best);
  }
  let remaining = p.limeTufts;
  centers.forEach((c, k) => {
    const want = Math.ceil(remaining / (centers.length - k));
    const chain = [c];
    tufts.push(c);
    for (let t = 0; chain.length < want && t < 40; t++) {
      const from = chain[chain.length - 1];
      const [ox, oy] = NEIGHBORS[Math.floor(rng() * NEIGHBORS.length)];
      const x = from.x + ox, y = from.y + oy;
      if (!tuftFits(x, y)) continue;
      chain.push({ x, y });
      tufts.push({ x, y });
    }
    remaining -= chain.length;
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

  // --- 4. Flores (posições já sorteadas acima), sem sombra, como na referência.
  for (const fl of flowers) {
    for (let r = 0; r < FS; r++) for (let k = 0; k < FS; k++) {
      const ch = FLOWER[r][fl.mirror ? FS - 1 - k : k];
      if (ch !== '.') set(fl.x + k, fl.y + r, ch === 'P' ? PETAL : CENTER);
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
