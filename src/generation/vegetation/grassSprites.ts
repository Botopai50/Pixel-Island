/**
 * Sprites dos tufos de grama 3D (pixel art), gerados proceduralmente como função pura (sem
 * canvas), para poderem ser testados/pré-visualizados fora do navegador.
 *
 * Cada tufo é uma moita cheia: muitas lâminas que afinam da base (3px) até a ponta (1px),
 * desenhadas de trás para a frente - as de trás mais escuras, as da frente mais claras -, com um
 * lado iluminado e o outro na sombra, pontas claras e uma base escura e fechada que assenta a
 * moita no chão.
 */

export interface GrassTuftShape {
  blades: number;   // número de lâminas
  width: number;    // meia-largura da base da moita (px)
  height: number;   // altura das lâminas do meio (0..1 da altura do sprite)
  arch: number;     // quanto as lâminas das pontas são mais baixas que as do meio (0..1)
  splay: number;    // abertura das lâminas para os lados
  curl: number;     // curvatura das lâminas (pontas caindo para fora)
  lean: number;     // inclinação de todas para um lado (vento)
  heads: boolean;   // cacho de sementes na ponta das lâminas mais altas
}

/** Formatos: moita, alta, rasteira, espiga e tombada. */
export const GRASS_TUFT_SHAPES: GrassTuftShape[] = [
  { blades: 16, width: 8,  height: 0.78, arch: 0.55, splay: 0.9, curl: 0.35, lean: 0.0,  heads: false }, // moita
  { blades: 12, width: 5,  height: 1.00, arch: 0.35, splay: 0.5, curl: 0.20, lean: 0.0,  heads: false }, // alta
  { blades: 18, width: 11, height: 0.50, arch: 0.60, splay: 1.2, curl: 0.50, lean: 0.0,  heads: false }, // rasteira
  { blades: 11, width: 6,  height: 0.92, arch: 0.45, splay: 0.6, curl: 0.15, lean: 0.0,  heads: true  }, // espiga
  { blades: 14, width: 7,  height: 0.72, arch: 0.50, splay: 0.7, curl: 0.60, lean: 0.55, heads: false }, // tombada
];

export const GRASS_SPRITE_W = 32, GRASS_SPRITE_H = 24;

/**
 * TONES: 6 tons do mais escuro ao mais claro [sombra funda, sombra, meio-escuro, meio, luz, ponta].
 * snow: pontas cobertas de neve. Devolve RGBA (W x H), fundo transparente.
 */
export function buildGrassTuftPixels(TONES: number[][], snow: boolean, seed: number, shape: GrassTuftShape): Uint8ClampedArray {
  const W = GRASS_SPRITE_W, H = GRASS_SPRITE_H;
  const buf: (number[] | null)[] = new Array(W * H).fill(null);
  const put = (x: number, y: number, col: number[]) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    buf[y * W + x] = col;
  };
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const SNOW = [240, 246, 252], SNOW_SHADE = [186, 202, 226];
  // quase preto: o tom mais escuro da paleta pela metade (sombra funda entre as lâminas)
  const BLACK = TONES[0].map((v) => Math.round(v * 0.45));
  const cx = W / 2 - 0.5;

  // Lâminas: posição na base, altura e camada (0 = fundo, 1 = frente)
  const blades: { bx: number; t: number; len: number; layer: number; ang: number; curl: number }[] = [];
  for (let i = 0; i < shape.blades; i++) {
    const t = shape.blades > 1 ? i / (shape.blades - 1) : 0.5;          // 0..1 da esquerda p/ direita
    const off = (t - 0.5) * 2 + (rnd() - 0.5) * 0.25;                    // -1..1
    const bx = cx + off * shape.width * (0.75 + rnd() * 0.25);
    const archF = 1 - shape.arch * off * off;
    const len = (H - 2) * shape.height * archF * (0.72 + rnd() * 0.28);
    const ang = off * shape.splay * 0.55 + shape.lean + (rnd() - 0.5) * 0.18;
    blades.push({ bx, t, len, layer: rnd() < 0.45 ? 0 : 1, ang, curl: (off >= 0 ? 1 : -1) * shape.curl * (0.6 + rnd() * 0.6) + shape.lean * 0.5 });
  }
  // fundo primeiro; dentro da camada, as mais baixas por cima (ficam na frente)
  blades.sort((a, b) => a.layer - b.layer || b.len - a.len);

  // Base escura e fechada (a moita "nasce" de um tufo denso)
  for (let x = Math.floor(cx - shape.width * 0.8); x <= Math.ceil(cx + shape.width * 0.8); x++) {
    const d = Math.abs(x - cx) / (shape.width * 0.8 + 0.01);
    const hgt = Math.round(2 * (1 - d * d));
    for (let y = H - 1; y >= H - 1 - hgt; y--) put(x, y, y >= H - 2 ? BLACK : TONES[0]);
  }

  for (const b of blades) {
    const steps = Math.max(3, Math.ceil(b.len));
    let x = b.bx, y = H - 1;
    const dark = b.layer === 0;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;                                   // 0 base .. 1 ponta
      const w = u < 0.30 ? 3 : u < 0.72 ? 2 : 1;             // afina da base para a ponta
      // tons: fundo mais escuro; perto da base escurece; ponta clareia
      let lit = dark ? (u < 0.2 ? BLACK : TONES[u < 0.45 ? 0 : u < 0.8 ? 1 : 2]) : TONES[u < 0.2 ? 1 : u < 0.4 ? 2 : u < 0.72 ? 3 : u < 0.9 ? 4 : 5];
      let shade = dark ? (u < 0.55 ? BLACK : TONES[0]) : (u < 0.2 ? BLACK : TONES[u < 0.45 ? 0 : 1]);
      if (snow && u > (dark ? 0.8 : 0.72)) { lit = SNOW; shade = SNOW_SHADE; }
      else if (snow && u > 0.4 && rnd() < 0.08) lit = SNOW;
      // lado da luz à esquerda, sombra à direita
      const x0 = Math.round(x - (w - 1) / 2);
      for (let k = 0; k < w; k++) put(x0 + k, y, k === w - 1 && w > 1 ? shade : lit);
      const a = b.ang + b.curl * u * u;
      x += Math.sin(a);
      y -= Math.cos(a);
    }
    // Espiga: cacho de sementes na ponta das lâminas altas da frente
    if (shape.heads && !dark && b.len > (H - 2) * shape.height * 0.8) {
      const head = snow ? SNOW : TONES[5], headS = snow ? SNOW_SHADE : TONES[4];
      put(x, y, head); put(x, y - 1, head); put(x + 1, y - 1, headS); put(x, y - 2, headS); put(x + 1, y, headS);
    }
  }

  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const col = buf[i];
    if (!col) continue;
    out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = 255;
  }
  return out;
}
