import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Vitória-régia e lentilha-d'água em pixel art: porte dos geradores do pacote "geradores-vitoria-regia-lentilha-dagua" (lilyPads.js, duckweed.js,
 * shared/pixelArt.js). Cada folha, cada pétala e cada retalho é uma grade de células quadradas pintadas com um degradê de 6 tons; aqui o tom já vai
 * para a cor do vértice (o material do manguezal é de cor de vértice), e o desenho (folha de 24 células com corte e nervuras, flor de 10 pétalas
 * em duas camadas, retalhos de 8 células de lentilha) é o do pacote.
 */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothStepT = (t: number) => t * t * (3 - 2 * t);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16) || 0, parseInt(h.substring(2, 4), 16) || 0, parseInt(h.substring(4, 6), 16) || 0];
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  s = clamp01(s); l = clamp01(l);
  if (s < 1e-6) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/** O degradê de 6 tons do pacote (buildFoliageRamp com hueCold 14, hueWarm -6, contrast 0.35, shadow 0.4, satBoost 0.82), em 0..1. */
function ramp6(color: string): [number, number, number][] {
  const dark = '#' + new THREE.Color(color).multiplyScalar(0.38).getHexString();
  const d = rgbToHsl(...hexToRgb(dark)), li = rgbToHsl(...hexToRgb(color));
  const contrast = 0.35, shadow = 0.4;
  const lLow = Math.max(0.075, Math.min(0.24, d[2] * (0.58 - shadow * 0.16)));
  const lHigh = Math.max(0.6, Math.min(0.74, li[2] + 0.09 + contrast * 0.06));
  const hMid = li[0] + (d[0] - li[0]) * 0.5;
  const sMid = Math.max(0.5, (d[1] + li[1]) * 0.5);
  const out: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5, tc = t + (smoothStepT(t) - t) * (0.2 + contrast * 0.3);
    const h = hMid + (1 - tc) * 14 + tc * -6;
    const s = Math.min(1, sMid * 0.82 * (1.02 + 0.26 * Math.abs(tc - 0.5) * 2));
    out.push(hslToRgb(h, s, lLow + (lHigh - lLow) * tc));
  }
  return out;
}

// a luz do pacote (azimute 135°, elevação 55°): decide se a célula sobe ou desce um tom pela inclinação
const LIGHT = (() => {
  const az = (135 * Math.PI) / 180, el = (55 * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
})();

type Cell = (x: number, y: number) => [number, number] | null;
type Vertex = (x: number, y: number) => [number, number, number];

/** paintedGrid do pacote: uma grade de células (dois triângulos cada) com o tom de cada uma; o tom vira cor de vértice. */
function paintedGrid(width: number, height: number, cell: Cell, vertex: Vertex, ramps: [number, number, number][][]): THREE.BufferGeometry {
  const pos: number[] = [], tone: number[] = [], row: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const paint = cell(x, y);
    if (!paint) continue;
    for (const [xx, yy] of [[x, y], [x + 1, y + 1], [x + 1, y], [x, y], [x, y + 1], [x + 1, y + 1]]) {
      pos.push(...vertex(xx, yy));
      tone.push(paint[0]); row.push(paint[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.length);
  for (let i = 0; i < tone.length; i++) {
    let ny = nrm.getY(i);
    const n = new THREE.Vector3(nrm.getX(i), ny, nrm.getZ(i));
    if (n.y < 0) n.negate();                                          // dupla face: a de cima manda
    const lit = n.dot(LIGHT);
    const shift = Math.max(-1, Math.min(1, Math.floor(lit * 1.4 + 0.25)));
    const t = Math.max(0, Math.min(5, Math.floor(tone[i] + 0.5) + shift));
    const c = ramps[row[i] > 0.5 ? 1 : 0][t];
    // a cor de vértice é linear: o degradê do pacote está em sRGB
    col[i * 3] = Math.pow(c[0], 2.2); col[i * 3 + 1] = Math.pow(c[1], 2.2); col[i * 3 + 2] = Math.pow(c[2], 2.2);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A flor (blossom do pacote): lóbulos de pétalas com miolo de pólen e um leve côncavo. */
function blossom(petals: number, core: number, cup: number, ramps: [number, number, number][][], N = 16): THREE.BufferGeometry {
  const step = 2 / N;
  const point = (x: number, y: number) => [(x / N - 0.5) * 2, (y / N - 0.5) * 2];
  const edge = (x: number, z: number) => {
    const lobe = (Math.cos(Math.atan2(z, x) * petals) + 1) * 0.5;
    return core + (1 - core) * Math.pow(lobe, petals >= 8 ? 1.25 : 0.55);
  };
  return paintedGrid(N, N, (x, y) => {
    const [xx, zz] = point(x + 0.5, y + 0.5), r = Math.hypot(xx, zz);
    if (r > edge(xx, zz)) return null;
    const pollen = r < 0.19;
    const sector = Math.cos(Math.atan2(zz, xx) * petals);
    const boundary = r + step * 0.7 > edge(xx, zz);
    const tone = pollen ? 3 : boundary ? 2 : sector < 0.2 ? 1 : r < 0.4 ? 2 : zz < -0.15 ? 4 : 3;
    return [tone, pollen ? 1 : 0];
  }, (x, y) => {
    const [xx, zz] = point(x, y), r = Math.hypot(xx, zz);
    return [xx, cup * r * r, zz];
  }, ramps);
}

/** O gerador de números da seed do pacote. */
function lcg(seed: number) {
  let state = ((seed % 233280) + 233280) % 233280;
  return () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
}
const hashAt = (seed: number) => (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 0.71) * 43758.5453;
  return n - Math.floor(n);
};

const mergeNonIndexed = (parts: THREE.BufferGeometry[]) => BufferGeometryUtils.mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;

/**
 * Densidade de pixels do jogo (a mesma da grama, GRASS_TEXEL_DENSITY em gameTrees.ts: 32 células por 1,5 m): cada célula mede 1/21,33 m no mundo.
 * As peças daqui são montadas em escala 1 e o planejador não escala mais a instância, então as células ficam todas do mesmo tamanho que as da grama,
 * das plantas e do terreno (o pacote original usava células de 0,8 a 2,5 cm, bem mais finas).
 */
const CELL = 1 / (32 / 1.5);

/** Folhas de vitória-régia (corte em V e nervuras) com flores rosa em duas camadas. Conjunto de ~1,2 m de raio. */
export function buildLilyPadsPixel(): THREE.BufferGeometry {
  const seed = 4721, rnd = lcg(seed), hash = hashAt(seed);
  const leafRamp = ramp6('#83a04c');
  const pollenRamp = ramp6('#d6b353'), petalRamp = ramp6('#e3a5c3');
  // a folha de N células de lado (N pela densidade do jogo: raio 0,28 a 0,47 m → 12 a 20 células), a flor de 6 a 8
  const padGeos = new Map<number, THREE.BufferGeometry>();
  const padFor = (N: number) => {
    let g = padGeos.get(N);
    if (g) return g;
    g = paintedGrid(N, N, (x, y) => {
      const dx = ((x + 0.5) / N) * 2 - 1, dz = ((y + 0.5) / N) * 2 - 1, r = Math.hypot(dx, dz);
      if (r > 0.95 || (dx > 0.06 && Math.abs(dz) < dx * 0.16)) return null;
      const angle = Math.atan2(dz, dx), vein = Math.abs(Math.sin(angle * 7)) * Math.max(1, r * 10);
      const tone = r > 0.83 ? 1 : vein < 0.35 && r > 0.16 ? 4 : hash(Math.floor(x / 3), Math.floor(y / 3)) > 0.75 ? 3 : 2;
      return [tone, 0];
    }, (x, y) => {
      const xx = (x / N) * 2 - 1, zz = (y / N) * 2 - 1;
      return [xx, Math.pow(Math.hypot(xx, zz), 5) * 0.045, zz];
    }, [leafRamp, leafRamp]);
    padGeos.set(N, g);
    return g;
  };
  const flowers = new Map<number, THREE.BufferGeometry>();
  const flowerFor = (N: number) => {
    let g = flowers.get(N);
    if (!g) { g = blossom(10, 0.28, 0.48, [petalRamp, pollenRamp], N); flowers.set(N, g); }
    return g;
  };

  const parts: THREE.BufferGeometry[] = [];
  const anchors: THREE.Vector2[] = [];
  const area = 1.25;
  for (let i = 0; i < 5; i++) {
    const N = Math.max(10, Math.round((2 * (0.28 + rnd() * 0.19)) / CELL));
    const radius = (N * CELL) / 2;
    const anchor = new THREE.Vector2();
    for (let attempt = 0; attempt < 70; attempt++) {
      const angle = rnd() * Math.PI * 2, distance = Math.sqrt(rnd()) * (area - radius - 0.08);
      anchor.set(Math.cos(angle) * distance, Math.sin(angle) * distance);
      if (anchors.every((p) => p.distanceTo(anchor) > radius + 0.3)) break;
    }
    anchors.push(anchor.clone());
    const pad = padFor(N).clone();
    pad.applyMatrix4(new THREE.Matrix4().makeRotationY(rnd() * Math.PI * 2));
    pad.applyMatrix4(new THREE.Matrix4().makeScale(radius, 1, radius));
    pad.translate(anchor.x, 0.03, anchor.y);
    parts.push(pad);
    if (i % 3 === 0) {
      const bump = rnd();
      for (let tier = 0; tier < 2; tier++) {
        const FN = tier === 0 ? (bump > 0.5 ? 8 : 7) : 6;
        const f = flowerFor(FN).clone();
        f.applyMatrix4(new THREE.Matrix4().makeRotationY(tier * 0.32));
        const bs = (FN * CELL) / 2;
        f.applyMatrix4(new THREE.Matrix4().makeScale(bs, bs, bs));
        f.translate(anchor.x + radius * 0.12, 0.034 + tier * 0.025, anchor.y + radius * 0.1);
        parts.push(f);
      }
    }
  }
  const out = mergeNonIndexed(parts);
  padGeos.forEach((g) => g.dispose()); flowers.forEach((g) => g.dispose());
  return out;
}

/** Tapete de lentilha-d'água: retalhos de 3 e 4 células em quatro verdes, em manchas, com filhotes ao lado (na grade de células). Conjunto de ~1,2 m de raio. */
export function buildDuckweedPixel(): THREE.BufferGeometry {
  const seed = 4823, rnd = lcg(seed);
  const ramps = ['#6b9443', '#7ea74e', '#568337', '#8faf59'].map(ramp6);
  const leaf = (G: number) => ramps.map((rp) => paintedGrid(G, G, (x, y) => {
    const dx = ((x + 0.5) / (G / 2)) - 1, dz = ((y + 0.5) / (G / 2)) - 1, r = Math.hypot(dx, dz);
    if (r > (G === 3 ? 0.9 : 0.95)) return null;
    return [r > 0.64 ? 1 : Math.abs(dx) < 0.18 ? 4 : dx < 0 ? 3 : 2, 0];
  }, (x, y) => [(x - G / 2) * CELL, 0, (y - G / 2) * CELL], [rp, rp]));
  const leaves3 = leaf(3), leaves4 = leaf(4);
  const area = 1.2;
  const centres = Array.from({ length: 4 }, () => {
    const angle = rnd() * Math.PI * 2, radius = Math.sqrt(rnd()) * area * 0.76;
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  const parts: THREE.BufferGeometry[] = [];
  const snap = (v: number) => Math.round(v / CELL) * CELL;
  const place = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const g = geo.clone();
    g.translate(snap(x), y, snap(z));
    parts.push(g);
  };
  for (let i = 0; i < 70; i++) {
    const centre = centres[i % centres.length], angle = rnd() * Math.PI * 2, radius = Math.sqrt(rnd()) * area * 0.36;
    const x = centre.x + Math.cos(angle) * radius, z = centre.y + Math.sin(angle) * radius;
    if (Math.hypot(x, z) > area * 0.95) continue;
    const pick = Math.floor(rnd() * ramps.length);
    const big = rnd() < 0.5;
    const y = 0.012 + rnd() * 4e-3;
    place((big ? leaves4 : leaves3)[pick], x, y, z);
    if (i % 3 === 0) place(leaves3[(pick + 1) % ramps.length], x + CELL * 3, y, z + CELL);
  }
  const out = mergeNonIndexed(parts);
  leaves3.forEach((g) => g.dispose()); leaves4.forEach((g) => g.dispose());
  return out;
}
