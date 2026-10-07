import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VegetationTextures } from '../vegetation/vegetationTextures.ts';
import { VegetationGeometries, setupCartoonMaterial } from '../vegetation/vegetationManager.ts';
import { PRNG } from '../math/prng.ts';
import { BiomeType } from '../types.ts';
import type { LandmarkSite } from './landmarkPlanner.ts';

/**
 * Monta a cena de um landmark com peças simples (pedras facetadas, blocos, toras, tábuas, ossos)
 * e as árvores do próprio jogo, com as texturas pixel art da vegetação e a mesma iluminação
 * cartoon. As peças de cada material são fundidas numa malha só (poucas chamadas de desenho por cena).
 */
type MatKey = 'stone' | 'wood' | 'bark' | 'leaf' | 'bone' | 'flora';

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function material(key: MatKey, color: number): THREE.MeshLambertMaterial {
  const id = key + ':' + color;
  let m = matCache.get(id);
  if (m) return m;
  const map = key === 'stone' || key === 'bone' ? VegetationTextures.getRockTexture()
    : key === 'wood' ? VegetationTextures.getWeatheredWoodTexture()
    : key === 'bark' ? VegetationTextures.getBarkTexture()
    : VegetationTextures.getFoliageTexture();
  m = setupCartoonMaterial(new THREE.MeshLambertMaterial({
    map, color, side: key === 'leaf' || key === 'flora' ? THREE.DoubleSide : THREE.FrontSide,
  }), 'none');
  matCache.set(id, m);
  return m;
}

/** Deixa a geometria só com position/normal/uv (não indexada), para poder fundir com qualquer outra. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.morphAttributes = {};
  return out;
}

/** Pedra facetada: dodecaedro com os vértices deslocados (determinístico) e a base achatada. */
function rockGeo(rng: PRNG, flatten = 0.75): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = pos.getX(i).toFixed(3) + ',' + pos.getY(i).toFixed(3) + ',' + pos.getZ(i).toFixed(3);
    let f = seen.get(key);
    if (f === undefined) { f = rng.range(0.78, 1.18); seen.set(key, f); }
    pos.setXYZ(i, pos.getX(i) * f, Math.max(-0.55, pos.getY(i) * f * flatten), pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

/** Bloco/pedra em pé com o topo irregular e levemente afunilado. */
function slabGeo(rng: PRNG, w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 1, 3, 1);
  const pos = g.attributes.position;
  const topJit = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + h / 2) / h;
    let x = pos.getX(i) * (1 - t * 0.22), z = pos.getZ(i) * (1 - t * 0.18);
    let yy = y;
    if (t > 0.99) {
      const key = pos.getX(i).toFixed(2) + ',' + pos.getZ(i).toFixed(2);
      let j = topJit.get(key);
      if (j === undefined) { j = rng.range(-0.35, 0.15) * h * 0.2; topJit.set(key, j); }
      yy += j;
    }
    pos.setXYZ(i, x, yy + h / 2, z);
  }
  g.computeVertexNormals();
  return g;
}

export class LandmarkBuilder {
  constructor(private readonly ground: (x: number, z: number) => number) {}

  public build(site: LandmarkSite): THREE.Group {
    const rng = new PRNG(site.seed || 1);
    const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    const cos = Math.cos(site.rot), sin = Math.sin(site.rot);
    // local (lx: lateral, lz: "frente" = direção site.rot) -> mundo: a mesma rotação em Y que as
    // peças recebem (phi), para a posição e a orientação de cada peça baterem
    const phi = Math.PI / 2 - site.rot;
    const toWorld = (lx: number, lz: number) => ({ x: site.x + lx * sin + lz * cos, z: site.z - lx * cos + lz * sin });
    const groundAt = (lx: number, lz: number) => { const w = toWorld(lx, lz); return this.ground(w.x, w.z); };
    const baseY = this.ground(site.x, site.z);

    /**
     * Coloca uma peça: posição local (lx, y, lz), y medido a partir do chão naquele ponto
     * (onGround) ou a partir do chão do centro; rotação local (rx, ry, rz) e escala.
     */
    const put = (key: MatKey, color: number, geo: THREE.BufferGeometry, lx: number, y: number, lz: number,
      opt: { rx?: number; ry?: number; rz?: number; s?: number | [number, number, number]; onGround?: boolean } = {}) => {
      const s = opt.s ?? 1;
      const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
      const w = toWorld(lx, lz);
      const yy = (opt.onGround === false ? baseY : this.ground(w.x, w.z)) + y;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(w.x - site.x, yy, w.z - site.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(opt.rx ?? 0, (opt.ry ?? 0) + phi, opt.rz ?? 0, 'YXZ')),
        sc,
      );
      const g = prep(geo);
      g.applyMatrix4(m);
      const id = key + ':' + color;
      let b = buckets.get(id);
      if (!b) { b = { mat: material(key, color), geos: [] }; buckets.set(id, b); }
      b.geos.push(g);
    };
    const rock = (color: number, lx: number, y: number, lz: number, r: number, opt: { onGround?: boolean; flatten?: number; sy?: number } = {}) =>
      put('stone', color, rockGeo(rng, opt.flatten ?? 0.75), lx, y, lz, { ry: rng.range(0, 6.28), s: [r, r * (opt.sy ?? 1), r * rng.range(0.85, 1.15)], onGround: opt.onGround });

    const b = site.biome;
    const sandy = b === BiomeType.DESERT_DUNES || b === BiomeType.CANYON_DESERT || b === BiomeType.SAVANNAH || b === BiomeType.BEACH;
    const polar = b === BiomeType.FROZEN_TUNDRA || b === BiomeType.SNOW_SUMMIT;
    const stoneCol = sandy ? 0xc89a6a : polar ? 0xb4c4cc : 0x9a978c;
    const mossCol = 0x7d9a5a;
    const leafCol = b === BiomeType.AUTUMN_FOREST ? 0xd8642a : b === BiomeType.SAVANNAH ? 0x7aa040 : b === BiomeType.BOREAL_TAIGA ? 0x2f6a40 : 0x48aa32;

    switch (site.type) {
      case 'stoneArch':
      case 'naturalBridge': {
        // arco de pedra (praia) / ponte natural (deserto): pilares de blocos e um arco de pedras
        const big = site.type === 'naturalBridge';
        const span = (big ? 16 : 9) * rng.range(0.85, 1.15), rise = (big ? 9 : 6.5) * rng.range(0.85, 1.15);
        const r = big ? 2.3 : 1.35;
        const col = big ? 0xc8845a : sandy ? 0xd2aa7c : stoneCol;
        const legY = Math.min(groundAt(-span / 2, 0), groundAt(span / 2, 0)) - baseY - 0.6;
        // pilares largos (duas colunas de blocos por lado) e o arco em duas camadas de pedras
        // sobrepostas (sem vãos): parece uma rocha só, esculpida, e não um colar de pedras
        for (const side of [-1, 1]) {
          for (let k = 0; k < 4; k++) for (const dz of [-0.5, 0.5]) {
            rock(col, side * span / 2 + rng.range(-0.4, 0.4), legY + k * r * 0.95, dz * r + rng.range(-0.2, 0.2), r * rng.range(1.1, 1.35), { onGround: false });
          }
        }
        const n = big ? 22 : 16;
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * Math.PI;
          for (const dz of [-0.45, 0.45]) {
            rock(col, Math.cos(a) * span / 2, legY + r * 3.2 + Math.sin(a) * rise, dz * r + rng.range(-0.15, 0.15), r * rng.range(1.0, 1.2), { onGround: false, flatten: 0.95 });
          }
        }
        for (let k = 0; k < 6; k++) rock(col, rng.range(-span, span) * 0.7, -0.2, rng.range(-4, 4), r * rng.range(0.25, 0.5));
        break;
      }
      case 'shipwreck': {
        // casco montado inteiro (quilha, costelas, costado com rombo, proa e popa altas, amurada,
        // mastro quebrado) e só então tombado e meio enterrado na areia; carga espalhada em volta
        const ribCol = 0x7a5a3a, plankCol = 0x9a7650;
        const len = 15 * rng.range(0.9, 1.1), halfW = 2.3, hgt = 3.2;
        const ribParts: THREE.BufferGeometry[] = [], plankParts: THREE.BufferGeometry[] = [];
        const hull = (z: number) => 1 - Math.pow(Math.abs(z) / (len / 2), 2) * 0.6; // afina na proa/popa
        const at = (t: number, w: number) => new THREE.Vector3(
          (1 - t) * (1 - t) * -w + t * t * w, (1 - t) * (1 - t) * hgt + 2 * t * (1 - t) * -hgt * 0.45 + t * t * hgt, 0);
        const keel = new THREE.BoxGeometry(0.4, 0.45, len); keel.translate(0, 0.1, 0); ribParts.push(keel);
        for (let i = 0; i < 10; i++) {
          const z = -len / 2 + (i + 0.5) * len / 10, w = halfW * hull(z);
          if (i === 6 && rng.chance(0.6)) continue;
          const curve = new THREE.QuadraticBezierCurve3(at(0, w), new THREE.Vector3(0, -hgt * 0.45, 0), at(1, w));
          const rib = new THREE.TubeGeometry(curve, 10, 0.2, 5, false); rib.translate(0, 0, z); ribParts.push(rib);
        }
        // costado: tábuas seguindo a curva do casco, com um rombo de um lado
        for (let p = 1; p < 10; p++) {
          const t = p / 10;
          for (let s = 0; s < 4; s++) {
            const z0 = -len / 2 + s * len / 4 + 0.2, z1 = z0 + len / 4 - 0.4, zm = (z0 + z1) / 2;
            if (t > 0.55 && s >= 1 && s <= 2 && p < 8) continue;            // rombo
            if (rng.chance(0.18)) continue;                                  // tábuas soltas
            const pt = at(t, halfW * hull(zm));
            const plank = new THREE.BoxGeometry(0.1, 0.42, z1 - z0);
            const tang = at(Math.min(1, t + 0.02), halfW).sub(at(Math.max(0, t - 0.02), halfW));
            plank.rotateZ(Math.atan2(tang.y, tang.x) - Math.PI / 2);
            plank.translate(pt.x, pt.y, zm);
            plankParts.push(plank);
          }
        }
        for (const side of [-1, 1]) {
          const post = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(0, 0.2, side * len / 2), new THREE.Vector3(0, hgt * 0.7, side * (len / 2 + 0.6)), new THREE.Vector3(0, hgt + 1.4, side * (len / 2 + 1.5))), 8, 0.24, 5, false);
          ribParts.push(post);
          if (rng.chance(0.7)) { const rail = new THREE.BoxGeometry(0.2, 0.2, len * 0.7); rail.translate(side * halfW * 0.95, hgt + 0.05, 0); ribParts.push(rail); }
        }
        const mast = new THREE.CylinderGeometry(0.2, 0.27, 5.5, 7); mast.translate(0, 2.75, 0); mast.rotateZ(0.3); mast.translate(0, 0.3, 1.5); ribParts.push(mast);
        const roll = rng.range(0.32, 0.5) * (rng.chance(0.5) ? 1 : -1);
        const ribs = BufferGeometryUtils.mergeGeometries(ribParts.map(prep))!, planks = BufferGeometryUtils.mergeGeometries(plankParts.map(prep))!;
        put('wood', ribCol, ribs, 0, -0.75, 0, { rz: roll, onGround: false });
        put('wood', plankCol, planks, 0, -0.75, 0, { rz: roll, onGround: false });
        for (let k = 0; k < 5; k++) {
          const lx = rng.range(-8, 8), lz = rng.range(-10, 10);
          if (Math.abs(lx) < 4 && Math.abs(lz) < len / 2 + 2) continue;
          if (rng.chance(0.5)) put('wood', plankCol, new THREE.BoxGeometry(1, 0.8, 1), lx, 0.2, lz, { ry: rng.range(0, 3), rx: rng.range(-0.3, 0.3) });
          else put('wood', ribCol, new THREE.CylinderGeometry(0.42, 0.42, 1.0, 8), lx, 0.3, lz, { rz: Math.PI / 2, ry: rng.range(0, 3) });
        }
        break;
      }
      case 'giantTree':
      case 'grove': {
        // árvore gigante solitária / bosque em círculo: as árvores do próprio jogo, maiores
        const G = VegetationGeometries;
        const pick = () => b === BiomeType.SAVANNAH ? [G.acaciaTrunk, G.acaciaLeaves] : b === BiomeType.BOREAL_TAIGA ? [G.pineTrunk, G.pineLeaves]
          : b === BiomeType.AUTUMN_FOREST ? [G.mapleTrunk, G.mapleLeaves] : [G.broadOakTrunk, G.broadOakLeaves];
        if (site.type === 'giantTree') {
          const s = rng.range(2.8, 3.4);
          const [t, l] = pick();
          put('bark', 0x5c422d, t, 0, -0.3 * s, 0, { s, ry: rng.range(0, 6.28) });
          put('leaf', leafCol, l, 0, -0.3 * s, 0, { s, ry: rng.range(0, 6.28) });
          for (let k = 0; k < 6; k++) { const a = rng.range(0, 6.28), r = rng.range(4.5, 7); rock(polar ? stoneCol : mossCol, Math.cos(a) * r, -0.2, Math.sin(a) * r, rng.range(0.5, 1.1)); }
          if (!sandy) for (let k = 0; k < 5; k++) { const a = rng.range(0, 6.28), r = rng.range(3, 7); put('flora', 0x42b828, G.groundFern, Math.cos(a) * r, 0, Math.sin(a) * r, { s: rng.range(0.9, 1.3), ry: rng.range(0, 6.28) }); }
        } else {
          const n = 10, R = 9;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + rng.range(-0.1, 0.1), s = rng.range(1.05, 1.35);
            const [t, l] = pick();
            put('bark', 0x5c422d, t, Math.cos(a) * R, -0.1, Math.sin(a) * R, { s, ry: rng.range(0, 6.28) });
            put('leaf', leafCol, l, Math.cos(a) * R, -0.1, Math.sin(a) * R, { s, ry: rng.range(0, 6.28) });
          }
          rock(mossCol, 0, -0.3, 0, 1.4, { flatten: 0.6 });
          for (let k = 0; k < 7; k++) { const a = rng.range(0, 6.28), r = rng.range(1.5, 5.5); put('flora', 0xffffff, G.wildflowers, Math.cos(a) * r, 0, Math.sin(a) * r, { s: rng.range(0.9, 1.3), ry: rng.range(0, 6.28) }); }
        }
        break;
      }
      case 'stoneCircle': {
        // círculo de pedras em pé, dois com lintel por cima, uma tombada e a laje no centro
        const n = 9, R = 7 * rng.range(0.9, 1.15);
        const lintel = [0, 4];
        const h: number[] = [];
        for (let k = 0; k < n; k++) h.push(rng.range(2.8, 3.8));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          if (k === 6) { put('stone', stoneCol, slabGeo(rng, 1.2, h[k], 0.8), Math.cos(a) * (R + 1), 0.35, Math.sin(a) * (R + 1), { rx: Math.PI / 2, ry: -a }); continue; }
          put('stone', stoneCol, slabGeo(rng, 1.25, h[k], 0.8), Math.cos(a) * R, -0.3, Math.sin(a) * R, { ry: -a + Math.PI / 2, rz: rng.range(-0.06, 0.06) });
        }
        for (const k of lintel) {
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
          const top = Math.min(h[k], h[k + 1]) - 0.35;
          const span = 2 * R * Math.sin((a1 - a0) / 2) + 1.2;
          put('stone', stoneCol, new THREE.BoxGeometry(span, 0.55, 0.85), Math.cos(am) * R * Math.cos((a1 - a0) / 2), top, Math.sin(am) * R * Math.cos((a1 - a0) / 2), { ry: -am + Math.PI / 2 });
        }
        put('stone', stoneCol, new THREE.BoxGeometry(2.4, 0.45, 1.5), 0, 0.1, 0, { ry: rng.range(0, 3) });
        break;
      }
      case 'menhirs': {
        // fileira de pedras altas, levemente curva e com inclinações diferentes
        const n = rng.rangeInt(5, 7);
        for (let k = 0; k < n; k++) {
          const t = k - (n - 1) / 2;
          put('stone', stoneCol, slabGeo(rng, 1.0, rng.range(3.5, 6), 0.75), t * 3, -0.4, Math.pow(t, 2) * 0.35, { ry: rng.range(-0.3, 0.3), rz: rng.range(-0.12, 0.12), rx: rng.range(-0.1, 0.1) });
        }
        break;
      }
      case 'ruin': {
        // muros quebrados de blocos (alturas irregulares), porta, colunas (uma tombada), entulho e plantas
        const W = 10, D = 7, bw = 1.0, bh = 0.6;
        const ruinCol = sandy ? 0xc8a878 : 0x9a968a;
        const wall = (x0: number, z0: number, x1: number, z1: number, door: boolean) => {
          const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / bw), ry = Math.atan2(z1 - z0, x1 - x0);
          for (let i = 0; i < n; i++) {
            if (door && Math.abs(i - n / 2) < 1) continue;
            const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
            const rows = Math.max(0, Math.round(1 + Math.sin(i * 1.7 + x0) * 2 + rng.range(0, 3)));
            for (let r = 0; r < rows; r++) put('stone', ruinCol, new THREE.BoxGeometry(bw * 0.96, bh * 0.94, 0.7), x, -0.15 + r * bh, z, { ry: -ry + rng.range(-0.04, 0.04) });
            if (rows >= 3 && rng.chance(0.35)) put('leaf', 0x3f8a32, new THREE.BoxGeometry(bw * 1.1, 0.35, 0.9), x, -0.15 + rows * bh, z, { ry: -ry });
          }
        };
        wall(-W / 2, -D / 2, W / 2, -D / 2, false); wall(W / 2, -D / 2, W / 2, D / 2, false);
        wall(W / 2, D / 2, -W / 2, D / 2, true); wall(-W / 2, D / 2, -W / 2, -D / 2, false);
        put('stone', ruinCol, new THREE.CylinderGeometry(0.42, 0.48, 4.2, 8), -2, 2.0, 0, {});
        put('stone', ruinCol, new THREE.BoxGeometry(1.2, 0.4, 1.2), -2, 4.2, 0, {});
        put('stone', ruinCol, new THREE.CylinderGeometry(0.42, 0.48, 3.6, 8), 2.5, 0.35, 1, { rz: Math.PI / 2, ry: 0.4 });
        for (let k = 0; k < 9; k++) put('stone', ruinCol, new THREE.BoxGeometry(bw * 0.9, bh * 0.9, 0.6), rng.range(-7, 7), 0.1, rng.range(-6, 6), { ry: rng.range(0, 3), rx: rng.range(-0.4, 0.4) });
        const G = VegetationGeometries;
        for (let k = 0; k < 5; k++) put('leaf', 0x4e9c2c, G.shrubLush, rng.range(-4, 4), -0.1, rng.range(-3, 3), { s: rng.range(0.8, 1.3), ry: rng.range(0, 6.28) });
        for (let k = 0; k < 6; k++) put('flora', 0x42b828, G.groundFern, rng.range(-6, 6), 0, rng.range(-5, 5), { s: rng.range(0.9, 1.3), ry: rng.range(0, 6.28) });
        break;
      }
      case 'fossil': {
        // esqueleto gigante semienterrado: coluna em arco, costelas saindo da areia e o crânio
        const bone = 0xe6dcc0;
        const n = 14, L = 16 * rng.range(0.85, 1.1);
        for (let i = 0; i < n; i++) {
          const z = -L / 2 + (i / (n - 1)) * L, y = -0.4 + Math.sin((i / (n - 1)) * Math.PI) * 0.9;
          put('bone', bone, new THREE.BoxGeometry(0.7, 0.55, 0.7), 0, y, z, { rx: 0.2, ry: rng.range(-0.1, 0.1) });
          if (i >= 3 && i <= 10) {
            for (const side of [-1, 1]) {
              if (rng.chance(0.15)) continue;
              const span = 2.6 + Math.sin(((i - 3) / 7) * Math.PI) * 1.2;
              const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, y + 0.2, 0), new THREE.Vector3(side * span * 0.9, y + 3.2, 0), new THREE.Vector3(side * span, -0.8, 0));
              put('bone', bone, new THREE.TubeGeometry(curve, 8, 0.18, 5, false), 0, 0, z, { onGround: true });
            }
          }
        }
        const skull = new THREE.SphereGeometry(1, 8, 6); skull.scale(1.0, 0.75, 1.7);
        put('bone', bone, skull, 0.3, 0.2, L / 2 + 1.6, { rz: 0.3, rx: -0.2 });
        put('bone', bone, new THREE.BoxGeometry(0.6, 0.35, 2.6), 1.1, -0.2, L / 2 + 2.2, { ry: 0.3, rz: 0.4 });
        for (let k = 0; k < 6; k++) rock(stoneCol, rng.range(-6, 6), -0.2, rng.range(-L / 2, L / 2), rng.range(0.3, 0.7));
        break;
      }
      case 'cabin': {
        // cabana de toras abandonada: paredes, telhado com um buraco, chaminé, lenha e cerca caída
        const W = 5, D = 4, logR = 0.2, rows = 8, wood = 0x7a5a3c, roof = 0x4a3a2c;
        const fy = Math.min(groundAt(-W / 2, -D / 2), groundAt(W / 2, D / 2), groundAt(W / 2, -D / 2), groundAt(-W / 2, D / 2)) - baseY - 0.2;
        const log = (len: number) => new THREE.CylinderGeometry(logR, logR, len, 6);
        for (let r = 0; r < rows; r++) {
          const y = fy + logR + r * logR * 1.9;
          put('wood', wood, log(W + 0.5), 0, y, -D / 2, { rz: Math.PI / 2, onGround: false });
          if (r < 2 || r > 5) put('wood', wood, log(W + 0.5), 0, y, D / 2, { rz: Math.PI / 2, onGround: false });
          else for (const sx of [-1, 1]) put('wood', wood, log(1.6), sx * 1.7, y, D / 2, { rz: Math.PI / 2, onGround: false });
          for (const sx of [-1, 1]) put('wood', wood, log(D + 0.5), sx * W / 2, y + logR * 0.95, 0, { rx: Math.PI / 2, onGround: false });
        }
        const top = fy + rows * logR * 1.9 + 0.2;
        for (const s of [-1, 1]) {
          const plank = new THREE.BoxGeometry(W + 1.0, 0.14, D * 0.62);
          put('wood', roof, plank, 0, top + 0.75, s * D * 0.27, { rx: s * 0.62, onGround: false });
        }
        put('stone', stoneCol, new THREE.BoxGeometry(0.8, 4.4, 0.8), W / 2 - 0.6, fy + 2.2, -D / 2 + 0.6, { onGround: false });
        for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) put('wood', 0x8a6a48, new THREE.CylinderGeometry(0.17, 0.17, 1.4, 6), -W / 2 - 1.2, 0.17 + r * 0.32, -1 + k * 0.36 + r * 0.18, { rz: Math.PI / 2, ry: Math.PI / 2 });
        for (let k = 0; k < 6; k++) {
          const z = D / 2 + 3, x = -4 + k * 1.7;
          if (rng.chance(0.25)) continue;
          put('wood', wood, new THREE.BoxGeometry(0.16, 1.2, 0.16), x, 0.5, z, { rz: rng.range(-0.3, 0.3) });
          if (k < 5 && rng.chance(0.6)) put('wood', wood, new THREE.BoxGeometry(1.7, 0.1, 0.08), x + 0.85, 0.85, z, { rz: rng.range(-0.25, 0.25) });
        }
        break;
      }
      case 'altar': {
        // altar antigo no alto do morro: degraus, laje e quatro pilares (um quebrado)
        const col = sandy ? 0xd0b088 : 0xb4ae9e;
        const fy = -0.35;
        put('stone', col, new THREE.BoxGeometry(6, 0.55, 6), 0, fy, 0, {});
        put('stone', col, new THREE.BoxGeometry(4.4, 0.55, 4.4), 0, fy + 0.55, 0, {});
        put('stone', col, new THREE.BoxGeometry(3, 0.55, 3), 0, fy + 1.1, 0, {});
        put('stone', col, new THREE.BoxGeometry(2, 0.9, 1.1), 0, fy + 1.85, 0, {});
        let k = 0;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const hh = k++ === 2 ? 0.9 : 2.6;
          put('stone', col, slabGeo(rng, 0.55, hh, 0.55), sx * 1.9, fy + 0.6, sz * 1.9, {});
        }
        break;
      }
      case 'cairn': {
        // pedras empilhadas na beira do penhasco (e duas pilhas menores ao lado)
        const pile = (lx: number, lz: number, n: number, r0: number) => {
          let y = -0.1;
          for (let i = 0; i < n; i++) {
            const r = r0 * (1 - i / (n + 1)) * rng.range(0.9, 1.1);
            rock(stoneCol, lx + rng.range(-0.1, 0.1), y + r * 0.35, lz + rng.range(-0.1, 0.1), r, { flatten: 0.45 });
            y += r * 0.62;
          }
        };
        pile(0, 0, 7, 0.95);
        pile(2.8, -1.5, 4, 0.6);
        pile(-2.2, -2.4, 3, 0.5);
        break;
      }
    }

    const group = new THREE.Group();
    group.name = 'landmark:' + site.type;
    group.position.set(site.x, 0, site.z);
    for (const { mat, geos } of buckets.values()) {
      const merged = BufferGeometryUtils.mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.updateMatrixWorld(true);
    return group;
  }
}
