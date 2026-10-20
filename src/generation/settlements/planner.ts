import { STRUCTURE_DESCRIPTORS, STRUCTURE_PRESETS } from '../structures/catalog';
import { structureStreams } from '../structures/random';
import type { StructureKind } from '../structures/types';
import {
  BridgePiece, Footprint, Pad, PlannedBuilding, PlannedProp, PlannedTree, SettlementKind, SettlementOptions,
  SettlementPlan, Street, StreetClass, TerrainSampler, WallPiece,
} from './types';
import {
  P2, PointGrid, edgeDistance, outlineSamples, pathLength, pointInPolygon, rectsOverlap, smoothPath, toWorld, yawFacing, corners,
} from './geometry';
import { findPath } from './pathfinding';
import { slopeAt } from './terrain';

// ---------------------------------------------------------------------------
// what each settlement kind is made of
// ---------------------------------------------------------------------------

interface KindProfile {
  radius: number;
  mains: [number, number];
  ring: boolean;
  walled: boolean;
  plaza: number;
  stalls: [number, number];
  /** buildings per m² of boundary, at density 1 */
  fill: number;
  centrePiece: StructureKind;
}

const KINDS: Record<SettlementKind, KindProfile> = {
  hamlet: { radius: 38, mains: [1, 2], ring: false, walled: false, plaza: 6, stalls: [0, 0], fill: 1 / 270, centrePiece: 'stoneWell' },
  village: { radius: 62, mains: [2, 3], ring: false, walled: false, plaza: 9, stalls: [1, 2], fill: 1 / 300, centrePiece: 'stoneWell' },
  town: { radius: 95, mains: [3, 4], ring: true, walled: false, plaza: 12, stalls: [2, 3], fill: 1 / 330, centrePiece: 'stoneFountain' },
  fortifiedTown: { radius: 105, mains: [3, 3], ring: true, walled: true, plaza: 11, stalls: [2, 3], fill: 1 / 340, centrePiece: 'stoneFountain' },
};

type Zone = 'core' | 'mid' | 'outer';
type Program = { kind: StructureKind; weight: number };

const PROGRAMS: Record<SettlementKind, Record<Zone, Program[]>> = {
  hamlet: {
    core: [{ kind: 'cabin', weight: 4 }, { kind: 'house', weight: 3 }, { kind: 'barn', weight: 1.5 }, { kind: 'farm', weight: 1 }],
    mid: [{ kind: 'cabin', weight: 4 }, { kind: 'house', weight: 3 }, { kind: 'barn', weight: 2 }, { kind: 'farm', weight: 1.5 }, { kind: 'stable', weight: 1 }],
    outer: [{ kind: 'cabin', weight: 3 }, { kind: 'barn', weight: 2 }, { kind: 'farm', weight: 2 }, { kind: 'stable', weight: 1 }],
  },
  village: {
    core: [{ kind: 'house', weight: 4 }, { kind: 'largeHouse', weight: 2 }, { kind: 'blacksmith', weight: 1 }, { kind: 'cabin', weight: 1 }],
    mid: [{ kind: 'house', weight: 5 }, { kind: 'cabin', weight: 2 }, { kind: 'largeHouse', weight: 1.5 }, { kind: 'stable', weight: 1 }, { kind: 'barn', weight: 0.8 }],
    outer: [{ kind: 'cabin', weight: 3 }, { kind: 'house', weight: 2 }, { kind: 'barn', weight: 2 }, { kind: 'farm', weight: 1.8 }, { kind: 'stable', weight: 1.2 }],
  },
  town: {
    core: [{ kind: 'largeHouse', weight: 4 }, { kind: 'house', weight: 3 }, { kind: 'mansion', weight: 1 }, { kind: 'blacksmith', weight: 1.2 }],
    mid: [{ kind: 'house', weight: 6 }, { kind: 'largeHouse', weight: 2.5 }, { kind: 'cabin', weight: 1 }, { kind: 'blacksmith', weight: 0.6 }, { kind: 'stable', weight: 0.8 }],
    outer: [{ kind: 'house', weight: 3 }, { kind: 'cabin', weight: 2 }, { kind: 'barn', weight: 2 }, { kind: 'farm', weight: 1.4 }, { kind: 'stable', weight: 1.2 }],
  },
  fortifiedTown: {
    core: [{ kind: 'largeHouse', weight: 4 }, { kind: 'house', weight: 3 }, { kind: 'mansion', weight: 0.8 }, { kind: 'blacksmith', weight: 1.2 }],
    mid: [{ kind: 'house', weight: 6 }, { kind: 'largeHouse', weight: 2 }, { kind: 'cabin', weight: 1 }, { kind: 'stable', weight: 1 }, { kind: 'blacksmith', weight: 0.5 }],
    outer: [{ kind: 'cabin', weight: 3 }, { kind: 'house', weight: 3 }, { kind: 'barn', weight: 2 }, { kind: 'farm', weight: 1.6 }, { kind: 'stable', weight: 1.3 }],
  },
};

const COMMERCE: StructureKind[] = ['blacksmith', 'market', 'mansion'];
const RURAL: StructureKind[] = ['barn', 'farm', 'stable', 'cabin'];
const ROLE: Partial<Record<StructureKind, PlannedBuilding['role']>> = {
  blacksmith: 'commerce', market: 'commerce', mansion: 'landmark', castle: 'landmark',
  barn: 'rural', farm: 'rural', stable: 'rural', cabin: 'home', house: 'home', largeHouse: 'home',
  windmill: 'rural', watermill: 'rural', watchtower: 'defence',
};

/** Different sizes of one kind: each variant is built once and cloned. */
export const VARIANT_SCALES = [0.9, 1, 1.12, 0.96];
export const VARIANTS_PER_KIND = 2;

export function variantDims(kind: StructureKind, variant: number): { width: number; depth: number } {
  const p = STRUCTURE_PRESETS[('structure_' + kind) as keyof typeof STRUCTURE_PRESETS].structure;
  const d = STRUCTURE_DESCRIPTORS[kind];
  const s = VARIANT_SCALES[variant % VARIANT_SCALES.length];
  const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v));
  return { width: clamp(p.width * s, d.width), depth: clamp(p.depth * s, d.depth) };
}

/**
 * What a building really covers, measured on the generated models: the porch and steps in front,
 * the sails of a windmill. Added to the nominal width and depth; cz is how far the middle of what it
 * covers lies from the model's origin (towards the front, which is local -z).
 */
const REAL_EXTRA: Partial<Record<StructureKind, { dw: number; dd: number; cz: number }>> = {
  house: { dw: 1.7, dd: 3.0, cz: -0.9 }, largeHouse: { dw: 2.0, dd: 4.8, cz: -0.95 }, cabin: { dw: 1.8, dd: 3.7, cz: -0.93 },
  barn: { dw: 2.3, dd: 3.4, cz: -0.6 }, stable: { dw: 0.5, dd: 2.8, cz: -0.94 }, farm: { dw: 0.6, dd: 1.3, cz: -0.4 },
  blacksmith: { dw: 0.2, dd: 0.4, cz: 0 }, market: { dw: 0.3, dd: 0, cz: 0 }, windmill: { dw: 6.5, dd: 0.7, cz: -0.3 },
  watermill: { dw: 0, dd: 0, cz: 0 }, watchtower: { dw: 0.7, dd: 0.6, cz: 0 }, mansion: { dw: 2, dd: 4, cz: -0.9 },
  castle: { dw: 6.4, dd: 10, cz: -2.1 }, fortress: { dw: 2, dd: 5, cz: -1 },
};
export function realDims(kind: StructureKind, variant: number): { width: number; depth: number; cz: number } {
  const n = variantDims(kind, variant);
  const e = REAL_EXTRA[kind] ?? { dw: 0.5, dd: 0.5, cz: 0 };
  return { width: n.width + e.dw, depth: n.depth + e.dd, cz: e.cz };
}

/** Slope (rise/run) a kind of building tolerates, and its height spread across the footprint. */
const SLOPE_LIMIT: Partial<Record<StructureKind, number>> = { castle: 0.3, fortress: 0.3, mansion: 0.26, windmill: 0.34, farm: 0.2, market: 0.18, gate: 0.3, wall: 0.55 };
const MARGIN = 1.0;

/** Run of the stair flight beside a wall piece (the wall is 5 m high: run = 1.02 x height). */
export const WALL_STAIR_RUN = 5.1;
export const WALL_STAIR_WIDTH = 1.7;
/** Length of the short wall that stands in front of the foot of the stair, attached to the curtain wall. */
export const STAIR_WALL_LENGTH = 6;
/** Ground covered by a wall piece's stair flight, as a footprint. */
export function wallStairRect(w: Footprint & { length: number; stairSide?: 1 | -1 }): Footprint | null {
  if (!w.stairSide) return null;
  const lx = w.length / 2 - WALL_STAIR_RUN / 2 - 0.2, lz = w.stairSide * (w.hd + WALL_STAIR_WIDTH / 2 - 0.35);
  const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
  return { x: w.x + lx * c + lz * s, z: w.z - lx * s + lz * c, hw: WALL_STAIR_RUN / 2 + 0.2, hd: WALL_STAIR_WIDTH / 2 + 0.3, yaw: w.yaw };
}

// ---------------------------------------------------------------------------
// the planner
// ---------------------------------------------------------------------------

export function planSettlement(options: SettlementOptions, terrain: TerrainSampler): SettlementPlan {
  const K = KINDS[options.kind];
  const R = K.radius * options.size;
  const streams = structureStreams(options.seed);
  const rs = (stage: string) => streams.streamFor('settlement', stage);
  const pick = <T,>(rnd: () => number, list: T[]) => list[Math.floor(rnd() * list.length) % list.length];
  const slope = (x: number, z: number) => slopeAt(terrain, x, z);
  const stats: Record<string, number> = {};

  // 1. site -----------------------------------------------------------------
  const siteRnd = rs('site');
  // roughly half of the settlements straddle a river, when the land has one, and use bridges to cross it
  const preferRiver = siteRnd() < 0.6;
  const centre = chooseSite(terrain, R, siteRnd, preferRiver, options.siteSpan ?? 1.8);

  // 2. shape ----------------------------------------------------------------
  const shapeRnd = rs('shape');
  const aspect = 1 + shapeRnd() * (options.kind === 'hamlet' ? 0.15 : 0.4);
  const rot = shapeRnd() * Math.PI;
  const phase = shapeRnd() * 10;
  const boundary: P2[] = [];
  const BN = 40;
  for (let i = 0; i < BN; i++) {
    const a = (i / BN) * Math.PI * 2;
    const ex = Math.cos(a) * aspect, ez = Math.sin(a) / aspect * 1.0;
    const wob = 1 + 0.13 * Math.sin(a * 3 + phase) + 0.07 * Math.sin(a * 5 - phase * 1.7);
    let r = R * wob / Math.sqrt(aspect);
    // pull the outline in where the ground is bad
    for (let k = 0; k < 8; k++) {
      const x = centre[0] + (Math.cos(rot) * ex - Math.sin(rot) * ez) * r;
      const z = centre[1] + (Math.sin(rot) * ex + Math.cos(rot) * ez) * r;
      if ((preferRiver || !terrain.isWater(x, z)) && slope(x, z) < 0.55) break;
      r *= 0.92;
    }
    r = Math.max(r, R * 0.42);
    boundary.push([
      centre[0] + (Math.cos(rot) * ex - Math.sin(rot) * ez) * r,
      centre[1] + (Math.sin(rot) * ex + Math.cos(rot) * ez) * r,
    ]);
  }
  const outerBoundary = scalePolygon(boundary, centre, K.walled ? 1.42 : 1.12);
  const inside = (x: number, z: number) => pointInPolygon(boundary, x, z);
  const insideOuter = (x: number, z: number) => pointInPolygon(outerBoundary, x, z);

  // 3. centres --------------------------------------------------------------
  const plazaPos = flattestPoint(terrain, centre, R * 0.22, 14);
  const plaza = { x: plazaPos[0], z: plazaPos[1], radius: K.plaza * Math.min(1.4, options.size) };

  // 4. streets --------------------------------------------------------------
  const gridCell = 4;
  const half = R * 1.75;
  const grid = {
    minX: centre[0] - half, minZ: centre[1] - half,
    cols: Math.ceil((half * 2) / gridCell) + 1, rows: Math.ceil((half * 2) / gridCell) + 1, cell: gridCell,
  };
  const baseCost = (allowWater: boolean) => (x: number, z: number): number => {
    if (terrain.isWater(x, z)) return allowWater ? (preferRiver ? 5 : 36) : Infinity;
    const sl = slope(x, z);
    // as ruas dão a volta em barrancos e paredões: acima de 0,5 de inclinação não passam, e quanto mais inclinado mais caro
    if (sl > 0.5) return Infinity;
    let c = 1 + sl * 28;
    if (!insideOuter(x, z)) c += 6;
    return c;
  };
  const streets: Street[] = [];
  const addStreet = (cls: StreetClass, raw: P2[], width?: number): Street | null => {
    if (raw.length < 2) return null;
    const pts = smoothPath(raw, 2, 2);
    if (pts.length < 2) return null;
    const w = width ?? (cls === 'main' ? (options.kind === 'hamlet' ? 3.2 : options.kind === 'village' ? 3.6 : 4.2) : cls === 'secondary' ? 2.8 : 2.0);
    const s: Street = { id: cls + '_' + streets.length, cls, width: w, points: pts };
    streets.push(s);
    return s;
  };
  const route = (a: P2, b: P2): P2[] | null => preferRiver
    ? findPath({ ...grid, cost: baseCost(true) }, a, b)
    : findPath({ ...grid, cost: baseCost(false) }, a, b) ?? findPath({ ...grid, cost: baseCost(true) }, a, b);

  const mainRnd = rs('mains');
  const nMain = K.mains[0] + Math.floor(mainRnd() * (K.mains[1] - K.mains[0] + 1));
  const baseAngle = mainRnd() * Math.PI * 2;
  const mains: Street[] = [];
  for (let i = 0; i < nMain; i++) {
    for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
      const a = baseAngle + (i / nMain) * Math.PI * 2 + (mainRnd() - 0.5) * 0.45 + off;
      const end = boundaryAlong(plazaPos, a, inside, R * 1.3);
      if (!end || terrain.isWater(end[0], end[1])) continue;
      const path = route(plazaPos, end);
      if (!path || path.length < 4) continue;
      const out: P2 = [end[0] + Math.cos(a) * 16, end[1] + Math.sin(a) * 16];
      const full = terrain.isWater(out[0], out[1]) ? path : [...path, out];
      const s = addStreet('main', full);
      if (s) { mains.push(s); break; }
    }
  }
  const secRnd = rs('secondary');
  const spacing = (options.kind === 'hamlet' ? 20 : 27) * (1.25 - options.density * 0.45);
  for (const m of mains) {
    const len = pathLength(m.points);
    let side = secRnd() < 0.5 ? 1 : -1;
    for (let s = plaza.radius + 8 + secRnd() * 6; s < len - 14; s += spacing * (0.75 + secRnd() * 0.5)) {
      const [p, tan] = pointAt(m.points, s);
      const nrm: P2 = [-tan[1] * side, tan[0] * side];
      let L = R * (0.34 + secRnd() * 0.3);
      const skew = (secRnd() - 0.5) * 0.7;
      let tgt: P2 = [0, 0];
      for (; L > 12; L *= 0.85) {
        tgt = [p[0] + nrm[0] * L + tan[0] * L * skew, p[1] + nrm[1] * L + tan[1] * L * skew];
        if (inside(tgt[0], tgt[1]) && !terrain.isWater(tgt[0], tgt[1])) break;
      }
      if (L > 12) {
        const path = findPath({ ...grid, cost: baseCost(preferRiver) }, p, tgt);
        if (path && path.length > 3) addStreet('secondary', path);
      }
      side = -side;
    }
  }
  if (K.ring && mains.length >= 2) {
    const rr = R * 0.5;
    const pts: P2[] = [];
    const RN = 14;
    for (let i = 0; i < RN; i++) {
      const a = (i / RN) * Math.PI * 2;
      let p: P2 = [plazaPos[0] + Math.cos(a) * rr, plazaPos[1] + Math.sin(a) * rr];
      if (!inside(p[0], p[1]) || terrain.isWater(p[0], p[1])) {
        const q = flattestPoint(terrain, p, 6, 6);
        p = q;
      }
      pts.push(p);
    }
    for (let i = 0; i < RN; i++) {
      const path = findPath({ ...grid, cost: baseCost(false) }, pts[i], pts[(i + 1) % RN]);
      if (path && path.length > 1 && pathLength(path) < rr * 1.2) addStreet('secondary', path);
    }
  }
  // water too wide to bridge: cut the street at the bank
  const bridges: BridgePiece[] = [];
  for (const s of [...streets]) {
    const runs = waterRuns(s.points, terrain);
    if (runs.some((r) => runLength(s.points, r) > 26)) {
      const idx = streets.indexOf(s);
      // keep the part before the first wide water
      const wide = runs.find((r) => runLength(s.points, r) > 26)!;
      const kept = s.points.slice(0, Math.max(0, wide[0] - 1));
      if (kept.length >= 4) s.points = kept; else streets.splice(idx, 1);
    }
  }
  streets.forEach((s, i) => (s.id = s.cls + '_' + i));
  const crossings: { s: Street; lo: number; hi: number; br: BridgePiece }[] = [];
  for (const s of streets) {
    for (const [i0, i1] of waterRuns(s.points, terrain)) {
      const lo = Math.max(0, i0 - 2), hi = Math.min(s.points.length - 1, i1 + 2);
      let a = s.points[Math.max(0, i0 - 2)], b = s.points[Math.min(s.points.length - 1, i1 + 2)];
      let len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 3) continue;
      let mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      // A ponte gira (até ~20°) para cruzar a água pelo caminho mais curto e as DUAS pontas - encontro e pé da
      // escada (cerca de 3,3 m além do vão) - caírem em terra firme, bem acima da água, não na beira do declive.
      {
        const d0 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const cx0 = mx, cz0 = mz;
        const dry = (x: number, z: number, above: number) => !terrain.isWater(x, z) && terrain.height(x, z) > terrain.waterLevel + above;
        let best: { score: number; a: P2; b: P2 } | null = null;
        for (let k = -7; k <= 7; k++) {
          const th = k * 0.05;
          const c = Math.cos(th), sn = Math.sin(th);
          const dx = d0[0] * c - d0[1] * sn, dz = d0[0] * sn + d0[1] * c;
          // distância do centro até terra firme em cada sentido (encontro a 0,8 e pé da escada a 1,4 acima da água)
          const reach = (sgn: number): number => {
            for (let r = 1; r <= 40; r += 0.5) {
              const ex = cx0 + sgn * dx * r, ez = cz0 + sgn * dz * r, fx = cx0 + sgn * dx * (r + 3.8), fz = cz0 + sgn * dz * (r + 3.8);
              // chão firme E de inclinação suave nas pontas (nada de barranco onde a escada pousa e a rua começa)
              if (dry(ex, ez, 0.8) && dry(fx, fz, 1.4) && slope(ex, ez) < 0.4 && slope(fx, fz) < 0.4) return r;
            }
            return Infinity;
          };
          const rp = reach(1), rm = reach(-1);
          if (!Number.isFinite(rp) || !Number.isFinite(rm)) continue;
          const span = rp + rm;
          const score = span + Math.abs(th) * 14;
          if (!best || score < best.score) best = { score, a: [cx0 - dx * rm, cz0 - dz * rm], b: [cx0 + dx * rp, cz0 + dz * rp] };
        }
        if (best) {
          a = best.a; b = best.b;
          len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          mx = (a[0] + b[0]) / 2; mz = (a[1] + b[1]) / 2;
        }
      }
      const yaw = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) + Math.PI / 2; // bridge runs along local x
      // duas ruas que cruzam a mesma água davam duas pontes uma sobre a outra: fica uma só, a mais larga/comprida
      const twin = bridges.find((o) => Math.hypot(o.x - mx, o.z - mz) < Math.max(o.length, len) * 0.7 && Math.abs(Math.sin(o.yaw - yaw)) < 0.4);
      if (twin) {
        if (len > twin.length) { twin.length = len; twin.hw = len / 2; twin.x = mx; twin.z = mz; twin.yaw = yaw; }
        twin.hd = Math.max(twin.hd, s.width / 2 + 0.6);
        twin.baseY = Math.max(twin.baseY, Math.max(terrain.height(a[0], a[1]), terrain.height(b[0], b[1])));
        crossings.push({ s, lo, hi, br: twin });
        continue;
      }
      const piece: BridgePiece = {
        id: 'bridge_' + bridges.length, x: mx, z: mz, hw: len / 2, hd: s.width / 2 + 0.6, yaw, length: len,
        baseY: Math.max(terrain.height(a[0], a[1]), terrain.height(b[0], b[1])),
      };
      bridges.push(piece);
      crossings.push({ s, lo, hi, br: piece });
    }
  }
  // A rua se adequa à ponte (que gira para cruzar pelo caminho mais curto): o trecho da rua que cruzava a água é
  // trocado por um caminho que chega ao pé da escada, atravessa a ponte e sai do outro pé - sem sobrar rua reta ao lado.
  const byStreet = new Map<Street, typeof crossings>();
  for (const c of crossings) byStreet.set(c.s, [...(byStreet.get(c.s) ?? []), c]);
  for (const [s, list] of byStreet) {
    list.sort((p, q) => q.lo - p.lo);
    for (const { lo, hi, br } of list) {
      const dx = Math.cos(br.yaw), dz = -Math.sin(br.yaw);
      const reach = br.length / 2 + 3.3;
      const e1: P2 = [br.x - dx * reach, br.z - dz * reach], e2: P2 = [br.x + dx * reach, br.z + dz * reach];
      const before = s.points.slice(0, lo), after = s.points.slice(hi + 1);
      const ref = s.points[lo];
      const first = Math.hypot(ref[0] - e1[0], ref[1] - e1[1]) <= Math.hypot(ref[0] - e2[0], ref[1] - e2[1]) ? e1 : e2;
      const last = first === e1 ? e2 : e1;
      const straight = (from: P2, to: P2): P2[] => {
        const n = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 2));
        return Array.from({ length: n }, (_, k) => [from[0] + (to[0] - from[0]) * ((k + 1) / n), from[1] + (to[1] - from[1]) * ((k + 1) / n)] as P2);
      };
      // a ligação com o pé da escada procura o caminho pelo terreno (dá a volta em barrancos e encostas íngremes)
      const line = (from: P2, to: P2): P2[] => {
        if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 3) return straight(from, to);
        // primeiro um caminho só por chão suave (inclinação até ~0,42: barrancos e encostas ficam de fora); se não houver, o normal
        const gentle = (x: number, z: number): number => {
          if (terrain.isWater(x, z)) return Infinity;
          const sl = slope(x, z);
          return sl > 0.42 ? Infinity : 1 + sl * 30 + (insideOuter(x, z) ? 0 : 6);
        };
        const r = findPath({ ...grid, cost: gentle }, from, to) ?? route(from, to);
        if (!r || r.length < 2) return straight(from, to);
        const sm = smoothPath([from, ...r.slice(1, -1), to], 2, 2);
        return sm.length >= 2 ? sm.slice(1) : straight(from, to);
      };
      const pts: P2[] = [...before];
      let cur: P2 | null = before.length ? before[before.length - 1] : null;
      for (const target of [first, last]) {
        // o vão da ponte é sempre reto; só as chegadas procuram caminho
        if (cur) pts.push(...(target === last ? straight(cur, target) : line(cur, target))); else pts.push(target);
        cur = target;
      }
      if (after.length) pts.push(...line(cur!, after[0]), ...after.slice(1));
      if (pts.length >= 2) s.points = pts;
    }
  }

  // street lookup ----------------------------------------------------------------
  type Sample = { x: number; z: number; hw: number; sid: string };
  const streetGrid = new PointGrid<Sample>(8);
  const indexStreet = (s: Street) => { for (const [x, z] of s.points) streetGrid.add({ x, z, hw: s.width / 2, sid: s.id }); };
  streets.forEach(indexStreet);
  const nearStreet = (x: number, z: number, r: number) => streetGrid.near(x, z, r);

  // 5/6. land use: obstacles first, buildings after -------------------------------
  const placed: PlannedBuilding[] = [];
  const props: PlannedProp[] = [];
  const walls: WallPiece[] = [];
  const obstacles: { id: string; f: Footprint }[] = [];
  const addObstacle = (id: string, f: Footprint) => obstacles.push({ id, f });
  const counts: Record<string, number> = {};
  const bump = (k: StructureKind) => (counts[k] = (counts[k] ?? 0) + 1);

  for (const b of bridges) addObstacle(b.id, b);

  const heightRange = (f: Footprint): number => {
    const hs = [...corners(f), [f.x, f.z] as P2].map(([x, z]) => terrain.height(x, z));
    return Math.max(...hs) - Math.min(...hs);
  };
  const wetNear = (f: Footprint, grow: number) => outlineSamples(f, 2, grow).some(([x, z]) => terrain.isWater(x, z)) || terrain.isWater(f.x, f.z);
  /** With mainOnly the footprint may sit on minor streets and lanes (they get carved away), never on a main road. */
  const clearOfStreets = (f: Footprint, clearance = 0.7, mainOnly = false): boolean => {
    const counts = (sid: string) => !mainOnly || sid.startsWith('main');
    for (const [x, z] of outlineSamples(f, 1.5, clearance)) {
      for (const s of nearStreet(x, z, 4)) if (counts(s.sid) && Math.hypot(s.x - x, s.z - z) < s.hw + 0.05) return false;
    }
    for (const s of nearStreet(f.x, f.z, Math.hypot(f.hw, f.hd) + 4)) {
      if (counts(s.sid) && Math.hypot(s.x - f.x, s.z - f.z) < s.hw + 0.3 && pointInRectLoose(f, s.x, s.z)) return false;
    }
    return true;
  };
  const clearOfObstacles = (f: Footprint, gap = 0.9): boolean => {
    for (const o of obstacles) if (rectsOverlap(f, o.f, gap * 0.75)) return false;
    return true;
  };
  const fits = (f: Footprint, kind: StructureKind, area: (x: number, z: number) => boolean = inside, streetClear = 0.7, mainOnly = false): boolean => {
    const cs = corners(f);
    if (!cs.every(([x, z]) => area(x, z)) || !area(f.x, f.z)) return false;
    if (wetNear(f, 1.5)) return false;
    // o terreno é nivelado sob cada casa (planPads), então encostas suaves não impedem de construir
    if (slope(f.x, f.z) > (SLOPE_LIMIT[kind] ?? 0.48)) return false;
    if (heightRange(f) > (kind === 'castle' || kind === 'fortress' || kind === 'mansion' ? 4.2 : 3.4)) return false;
    return clearOfStreets(f, streetClear, mainOnly) && clearOfObstacles(f);
  };

  const registerBuilding = (id: string, kind: StructureKind, variant: number, f: Footprint, w: number, d: number): PlannedBuilding => {
    const door = toWorld(f, 0, -(f.hd + 1.0));
    // the footprint is centred on what the building covers; the model itself goes at its origin
    const [px, pz] = toWorld(f, 0, -(REAL_EXTRA[kind]?.cz ?? 0));
    const b: PlannedBuilding = {
      id, kind, variant, ...f, px, pz, width: w, depth: d, role: ROLE[kind] ?? 'infrastructure', door,
      baseY: meanHeight(terrain, f),
    };
    placed.push(b);
    addObstacle(id, f);
    bump(kind);
    return b;
  };
  const footprintFor = (kind: StructureKind, variant: number, x: number, z: number, yaw: number) => {
    // x, z: where the middle of the real footprint should be
    const { width, depth } = realDims(kind, variant);
    const f: Footprint = { x, z, hw: width / 2 + 0.4, hd: depth / 2 + 0.4, yaw };
    return { f, width, depth };
  };

  const lanes: Street[] = [];
  /** A lane from a door to the nearest street, around the buildings in the way; null when there is no way. */
  const makeLane = (id: string, door: P2, self: Footprint): Street | null => {
    const cost = (x: number, z: number): number => {
      if (terrain.isWater(x, z)) return Infinity;
      if (pointInRectLoose(self, x, z, 0.1)) return Infinity; // never through its own building
      let margin = 0;
      for (const o of obstacles) {
        if (o.id === id) continue;
        if (Math.abs(o.f.x - x) > o.f.hw + o.f.hd + 3 || Math.abs(o.f.z - z) > o.f.hw + o.f.hd + 3) continue;
        if (pointInRectLoose(o.f, x, z, 0)) return Infinity;
        if (pointInRectLoose(o.f, x, z, 1.4)) margin = 6;
      }
      const sl = slope(x, z);
      return sl > 0.55 ? Infinity : 1 + sl * 10 + margin;
    };
    // a finer grid than the streets use: lanes squeeze between houses
    const fine = { minX: grid.minX, minZ: grid.minZ, cell: 2, cols: Math.ceil((grid.cols - 1) * grid.cell / 2) + 1, rows: Math.ceil((grid.rows - 1) * grid.cell / 2) + 1 };
    // the nearest few places on the street network, not only the very nearest: a wall or another
    // building may stand in the way of that one
    const targets: Sample[] = [];
    for (const smp of streetGrid.near(door[0], door[1], 34).sort((u, v) => Math.hypot(u.x - door[0], u.z - door[1]) - Math.hypot(v.x - door[0], v.z - door[1]))) {
      if (targets.every((t) => Math.hypot(t.x - smp.x, t.z - smp.z) > 7)) targets.push(smp);
      if (targets.length >= 5) break;
    }
    if (!targets.length) { stats.laneFarFail = (stats.laneFarFail ?? 0) + 1; return null; }
    for (const t of targets) {
      const path = findPath({ ...fine, cost }, door, [t.x, t.z]);
      if (!path || path.length < 2) continue;
      const outward = path.slice(1).filter(([x, z]) => !pointInRectLoose(self, x, z, 0.1));
      // smoothed when that stays clear of the buildings, as found otherwise
      for (const iterations of [1, 0]) {
        const lane: Street = { id: 'lane_pending', cls: 'lane', width: 2.2, to: id, points: smoothPath([door, ...outward], iterations, 2) };
        if (lane.points.length < 2) continue;
        if (lane.points.some(([x, z]) => pointInRectLoose(self, x, z, 0))) continue;
        if (!lane.points.every(([x, z]) => !obstacles.some((o) => o.id !== id && pointInRectLoose(o.f, x, z, 0.1)))) continue;
        return lane;
      }
    }
    stats.lanePathFail = (stats.lanePathFail ?? 0) + 1;
    return null;
  };

  // walls: a ring of wall pieces, gates where main roads cross, towers at corners
  let wallRing: P2[] = [];
  if (K.walled) {
    const wallRnd = rs('walls');
    // A rough square, turned to the lie of the land: four corners (each pulled in
    // off water and steep ground) joined by straight curtain walls.
    const side = R * 0.66;
    const cornerScale = [0, 1, 2, 3].map(() => 0.94 + wallRnd() * 0.12);
    const turn0 = rot + (wallRnd() - 0.5) * 0.3;
    const makeRing = (turn: number) => {
      const ring: P2[] = [];
      const cornerAt = new Set<number>();
      const cs: P2[] = [];
      let pulled = 0;
      for (let k = 0; k < 4; k++) {
        const ang = turn + Math.PI / 4 + (k * Math.PI) / 2;
        let r = side * Math.SQRT2 * cornerScale[k];
        for (let t = 0; t < 12; t++) {
          const x = plazaPos[0] + Math.cos(ang) * r, z = plazaPos[1] + Math.sin(ang) * r;
          if (!terrain.isWater(x, z) && slope(x, z) < 0.42) break;
          r *= 0.93;
          pulled++;
        }
        cs.push([plazaPos[0] + Math.cos(ang) * r, plazaPos[1] + Math.sin(ang) * r]);
      }
      for (let k = 0; k < 4; k++) {
        const [ax, az] = cs[k], [bx, bz] = cs[(k + 1) % 4];
        const n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 15));
        cornerAt.add(ring.length);
        for (let i = 0; i < n; i++) ring.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
      }
      return { ring, cornerAt, cs, pulled };
    };
    // Where the main roads would cross a candidate wall.
    const crossingsOf = (pts: P2[]): P2[] => {
      const closed: P2[] = [...pts, pts[0]];
      const out: P2[] = [];
      for (const m of mains) {
        for (let i = 0; i < closed.length - 1; i++) {
          for (let j = 0; j < m.points.length - 1; j++) {
            const hit = segHit(closed[i][0], closed[i][1], closed[i + 1][0], closed[i + 1][1], m.points[j][0], m.points[j][1], m.points[j + 1][0], m.points[j + 1][1]);
            if (hit && !out.some((h) => Math.hypot(h[0] - hit[0], h[1] - hit[1]) < 18)) out.push(hit);
          }
        }
      }
      return out;
    };
    // Turn the square so no gate falls near a corner: a gate beside a corner would sit where the wall bends.
    let chosen = makeRing(turn0), chosenScore = -Infinity;
    for (let k = 0; k < 12; k++) {
      const cand = makeRing(turn0 + (k * Math.PI) / 2 / 12);
      const hits = crossingsOf(cand.ring);
      const clear = hits.length ? Math.min(...hits.map((h) => Math.min(...cand.cs.map((c) => Math.hypot(c[0] - h[0], c[1] - h[1]))))) : 30;
      const score = Math.min(clear, 24) - cand.pulled * 3;
      if (score > chosenScore) { chosenScore = score; chosen = cand; }
    }
    const { ring, cornerAt } = chosen;
    const ringSmooth: P2[] = [...ring, ring[0]];
    // One level for the whole curtain: every wall, gate and tower stands on it, so the crest runs level.
    // (The builder levels the ground under the wall to this height.)
    const wallLevel = Math.max(terrain.waterLevel + 0.6, ring.reduce((sum, [x, z]) => sum + terrain.height(x, z), 0) / ring.length);
    const gateAt: { p: P2; dir: P2; sid: string; seg: number; t: number }[] = [];
    for (const m of mains) {
      for (let i = 0; i < ringSmooth.length - 1; i++) {
        const [ax, az] = ringSmooth[i], [bx, bz] = ringSmooth[i + 1];
        for (let j = 0; j < m.points.length - 1; j++) {
          const hit = segHit(ax, az, bx, bz, m.points[j][0], m.points[j][1], m.points[j + 1][0], m.points[j + 1][1]);
          if (hit && !gateAt.some((g) => Math.hypot(g.p[0] - hit[0], g.p[1] - hit[1]) < 18)) {
            const dx = m.points[j + 1][0] - m.points[j][0], dz = m.points[j + 1][1] - m.points[j][1];
            const l = Math.hypot(dx, dz) || 1;
            gateAt.push({ p: hit, dir: [dx / l, dz / l], sid: m.id, seg: i, t: Math.hypot(hit[0] - ax, hit[1] - az) });
          }
        }
      }
    }
    const segDir = (i: number): { d: P2; len: number; yaw: number } => {
      const [ax, az] = ringSmooth[i], [bx, bz] = ringSmooth[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return { d: [(bx - ax) / len, (bz - az) / len], len, yaw: Math.atan2(-(bx - ax), -(bz - az)) + Math.PI / 2 };
    };
    const nearGate = (x: number, z: number, r: number) => gateAt.some((g) => Math.hypot(g.p[0] - x, g.p[1] - z) < r);
    const gateDims = variantDims('gate', 0);
    // the wall ends exactly where the gate begins, with a little overlap so no daylight shows
    const gapHalf = gateDims.width / 2 - 0.3;
    // gates stand in the wall line: their width runs along the wall, the passage crosses it
    for (const g of gateAt) {
      const sd = segDir(g.seg);
      const f: Footprint = { x: g.p[0], z: g.p[1], hw: gateDims.width / 2, hd: gateDims.depth / 2, yaw: sd.yaw };
      walls.push({ id: 'gate_' + walls.length, kind: 'gate', ...f, length: gateDims.width, baseY: wallLevel });
      addObstacle('gate_' + walls.length, { ...f, hw: f.hw + 0.4, hd: f.hd + 1.2 });
      for (const sgn of [-1, 1]) {
        // the tower abuts the gate, centred exactly on the wall line
        const reach = gateDims.width / 2 + 2.8;
        const tx = g.p[0] + sd.d[0] * sgn * reach, tz = g.p[1] + sd.d[1] * sgn * reach;
        const tf: Footprint = { x: tx, z: tz, hw: 3.4, hd: 2.9, yaw: sd.yaw };
        if (!terrain.isWater(tx, tz)) {
          walls.push({ id: 'tower_' + walls.length, kind: 'stoneTower', ...tf, length: 5, baseY: wallLevel });
          addObstacle('tower_' + walls.length, tf);
        }
      }
    }
    for (let i = 0; i < ringSmooth.length - 1; i++) {
      const [ax, az] = ringSmooth[i];
      const sd = segDir(i);
      // the stretches of this side that are not gate
      const cuts = gateAt.filter((g) => g.seg === i).sort((u, v) => u.t - v.t);
      const pieces: [number, number][] = [];
      let cursor = 0;
      for (const g of cuts) {
        if (g.t - gapHalf - cursor > 2) pieces.push([cursor, g.t - gapHalf]);
        cursor = g.t + gapHalf;
      }
      if (sd.len - cursor > 2) pieces.push([cursor, sd.len]);
      for (const [s0, s1] of pieces) {
        const mx = ax + sd.d[0] * (s0 + s1) / 2, mz = az + sd.d[1] * (s0 + s1) / 2;
        if (terrain.isWater(mx, mz)) continue;
        const len = s1 - s0;
        const f: Footprint = { x: mx, z: mz, hw: len / 2 + 0.2, hd: 1.7, yaw: sd.yaw };
        walls.push({ id: 'wall_' + walls.length, kind: 'wall', ...f, length: len + 0.4, baseY: wallLevel });
        addObstacle('wall_' + walls.length, { ...f, hd: 2.1 });
      }
      if ((cornerAt.has(i) || i % 3 === 0) && !nearGate(ax, az, 14)) {
        const tf: Footprint = { x: ax, z: az, hw: 3.4, hd: 2.9, yaw: sd.yaw };
        walls.push({ id: 'tower_' + walls.length, kind: 'stoneTower', ...tf, length: 5, baseY: wallLevel });
        addObstacle('tower_' + walls.length, tf);
      }
    }
    // A street that meets the wall where there is no gate does not run through it: it is cut at the
    // wall, and each side keeps its stretch.
    {
      const solid = walls.filter((w) => w.kind === 'wall' || w.kind === 'stoneTower');
      const inWall = (x: number, z: number) => solid.some((w) => {
        const c = Math.cos(w.yaw), sn = Math.sin(w.yaw), dx = x - w.x, dz = z - w.z;
        return Math.abs(dx * c - dz * sn) < w.hw + 0.8 && Math.abs(dx * sn + dz * c) < w.hd + 0.8;
      });
      let cuts = 0;
      for (let i = streets.length - 1; i >= 0; i--) {
        const st = streets[i];
        if (st.cls === 'lane') continue;
        const flags = st.points.map(([x, z]) => inWall(x, z));
        if (!flags.some(Boolean)) continue;
        cuts++;
        const parts: P2[][] = [];
        let run: P2[] = [];
        st.points.forEach((pt, k) => {
          if (flags[k] || flags[k + 1] || flags[k - 1]) { if (run.length) parts.push(run); run = []; } else run.push(pt);
        });
        if (run.length) parts.push(run);
        streets.splice(i, 1);
        for (const part of parts) if (part.length >= 4 && pointInPolygon(ring, part[0][0], part[0][1]) && pointInPolygon(ring, part[part.length - 1][0], part[part.length - 1][1])) streets.push({ id: st.cls + '_cut_' + streets.length, cls: st.cls, width: st.width, points: part });
      }
      // what was cut off outside the wall, and has no gate, leads nowhere any more
      for (let i = streets.length - 1; i >= 0; i--) {
        const st = streets[i];
        if (st.cls === 'lane') continue;
        if (!st.points.some(([x, z]) => pointInPolygon(ring, x, z) || nearGate(x, z, 10))) { streets.splice(i, 1); cuts++; }
      }
      if (cuts) { streetGrid.clear(); streets.forEach(indexStreet); }
      stats.streetsCutAtWall = cuts;
    }
    // A few stairs up to the wall walk, along the town side of the wall, which stays whole. In front of
    // the foot of each stair stands a short wall, at right angles, attached to the curtain wall.
    {
      const stairRnd = rs('wallstairs');
      const pieces = walls.filter((w) => w.kind === 'wall' && w.length >= 12);
      for (let i = pieces.length - 1; i > 0; i--) { const j = Math.floor(stairRnd() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]]; }
      const want = Math.max(2, Math.round(R / 24));
      const taken: Footprint[] = [];
      const fixedPieces = walls.filter((w) => w.kind !== 'wall');
      for (const w of pieces) {
        if (taken.length >= want) break;
        if (taken.some((t) => Math.hypot(t.x - w.x, t.z - w.z) < 40)) continue;
        for (const turn of stairRnd() < 0.5 ? [0, Math.PI] : [Math.PI, 0]) {
          const yaw = w.yaw + turn;
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          const zax: P2 = [sn, c];
          const inward = (plazaPos[0] - w.x) * zax[0] + (plazaPos[1] - w.z) * zax[1] > 0 ? 1 : -1;
          const rect = wallStairRect({ ...w, yaw, stairSide: inward as 1 | -1 });
          if (!rect) continue;
          // the foot of the stair is at the +x end; the short wall stands just past it, on the town side
          const foot: P2 = [w.x + c * (w.length / 2), w.z - sn * (w.length / 2)];
          if (fixedPieces.some((f) => Math.hypot(f.x - foot[0], f.z - foot[1]) < 10)) continue;
          const n: P2 = [zax[0] * inward, zax[1] * inward];
          const base: P2 = [foot[0] + c * 1.9, foot[1] - sn * 1.9];
          const start = 1.0;
          const spurYaw = Math.atan2(-n[1], n[0]);
          const spur: Footprint = {
            x: base[0] + n[0] * (start + STAIR_WALL_LENGTH / 2), z: base[1] + n[1] * (start + STAIR_WALL_LENGTH / 2),
            hw: (STAIR_WALL_LENGTH + 0.4) / 2, hd: 1.7, yaw: spurYaw,
          };
          const whole: Footprint[] = [rect, spur];
          if (whole.some((r) => !insideOuter(r.x, r.z) || corners(r).some(([x, zz]) => terrain.isWater(x, zz)) || !clearOfStreets(r, 0.6))) continue;
          // the short wall may meet the curtain wall (it is attached to it) but nothing else of the fortification
          if (walls.some((q) => (q.kind !== 'wall' || q.id.startsWith('stairwall_')) && rectsOverlap(spur, { ...q, hw: q.hw + 0.2, hd: q.hd + 0.2 }, 0))) continue;
          w.yaw = yaw;
          w.stairSide = inward as 1 | -1;
          walls.push({ id: 'stairwall_' + taken.length, kind: 'wall', ...spur, length: STAIR_WALL_LENGTH + 0.4, baseY: wallLevel });
          taken.push(w);
          addObstacle('stair_' + w.id, { ...rect, hw: rect.hw + 0.4, hd: rect.hd + 0.5 });
          addObstacle('stairwall_' + taken.length, { ...spur, hw: spur.hw + 0.4, hd: spur.hd + 0.6 });
          break;
        }
      }
      stats.wallStairs = taken.length;
    }
    stats.gates = gateAt.length;
    wallRing = ring;
  }
  const wallArea = scalePolygon(wallRing, plazaPos, 0.9);
  const insideWalls = (x: number, z: number) => !K.walled || pointInPolygon(wallArea, x, z);

  // landmarks: castle on the best high ground inside the walls
  if (K.walled) {
    const castleRnd = rs('castle');
    let kind: StructureKind = 'castle';
    let best: { f: Footprint; score: number; v: number; w: number; d: number } | null = null;
    const candidates: { f: Footprint; score: number; v: number; w: number; d: number }[] = [];
    for (let t = 0; t < 700; t++) {
      const a = castleRnd() * Math.PI * 2, r = R * (0.14 + castleRnd() * 0.46);
      const x = plazaPos[0] + Math.cos(a) * r, z = plazaPos[1] + Math.sin(a) * r;
      const v = 0;
      const { f, width, depth } = footprintFor(kind, v, x, z, yawFacing(plazaPos[0] - x, plazaPos[1] - z));
      if (!fits(f, kind, (px, pz) => insideWalls(px, pz) && inside(px, pz), 1.5, true)) continue;
      const score = terrain.height(x, z) - slope(x, z) * 14 - r * 0.02;
      candidates.push({ f, score, v, w: width, d: depth });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const cand of candidates.slice(0, 14)) {
      const door = toWorld(cand.f, 0, -(cand.f.hd + 1.0));
      if (edgeDistance(streetGrid, door[0], door[1], 40) <= 2.4 || makeLane('castle_0', door, cand.f)) { best = cand; break; }
    }
    if (!best) {
      // rough ground: a smaller stronghold still anchors the town
      kind = 'fortress';
      for (let t = 0; t < 500; t++) {
        const a = castleRnd() * Math.PI * 2, r = R * (0.12 + castleRnd() * 0.5);
        const x = plazaPos[0] + Math.cos(a) * r, z = plazaPos[1] + Math.sin(a) * r;
        const { f, width, depth } = footprintFor(kind, 1, x, z, yawFacing(plazaPos[0] - x, plazaPos[1] - z));
        if (!fits(f, kind, (px, pz) => insideWalls(px, pz) && inside(px, pz), 1.5, true)) continue;
        const score = terrain.height(x, z) - slope(x, z) * 14 - r * 0.02;
        if (!best || score > best.score) best = { f, score, v: 1, w: width, d: depth };
      }
    }
    if (best) {
      // minor streets that ran under the castle are cut back to its wall; each keeps its longer outer part
      const cutRect: Footprint = { ...best.f, hw: best.f.hw + 1.2, hd: best.f.hd + 1.2 };
      for (let i = streets.length - 1; i >= 0; i--) {
        const st = streets[i];
        if (st.cls === 'main') continue;
        if (!st.points.some(([x, z]) => pointInRectLoose(cutRect, x, z))) continue;
        let longest: P2[] = [], run: P2[] = [];
        for (const pt of st.points) {
          if (pointInRectLoose(cutRect, pt[0], pt[1])) { if (run.length > longest.length) longest = run; run = []; } else run.push(pt);
        }
        if (run.length > longest.length) longest = run;
        if (longest.length >= 3) st.points = longest; else streets.splice(i, 1);
      }
      streetGrid.clear();
      streets.forEach(indexStreet);
      const b = registerBuilding('castle_0', kind, best.v, best.f, best.w, best.d);
      // reserve the castle's approach now, before the houses can close it in
      if (edgeDistance(streetGrid, b.door[0], b.door[1], 40) > 2.4) {
        const lane = makeLane(b.id, b.door, best.f);
        if (lane) { lanes.push(lane); indexStreet(lane); }
      }
    }
  }

  // market stalls and the centre piece on the plaza
  {
    const stallRnd = rs('stalls');
    const n = K.stalls[0] + Math.floor(stallRnd() * (K.stalls[1] - K.stalls[0] + 1));
    const want = Math.min(K.stalls[1], Math.max(K.stalls[0], Math.round(n * (0.6 + options.frequency * 0.8))));
    for (let i = 0; i < want; i++) {
      for (let t = 0; t < 40; t++) {
        const a = stallRnd() * Math.PI * 2;
        const { width, depth } = realDims('market', 0);
        const r = plaza.radius + depth / 2 + 1.5;
        const x = plazaPos[0] + Math.cos(a) * r, z = plazaPos[1] + Math.sin(a) * r;
        const { f } = footprintFor('market', 0, x, z, yawFacing(plazaPos[0] - x, plazaPos[1] - z));
        if (fits(f, 'market', insideOuter)) { registerBuilding('market_' + i, 'market', 0, f, width, depth); break; }
      }
    }
    const cp = K.centrePiece;
    const pf: Footprint = { x: plazaPos[0], z: plazaPos[1], hw: 1.6, hd: 1.6, yaw: 0 };
    props.push({ id: 'centre', kind: cp, variant: 0, ...pf, baseY: terrain.height(plazaPos[0], plazaPos[1]) });
    addObstacle('centre', { ...pf, hw: 2.4, hd: 2.4 });
  }

  // frontage: houses along the streets, by zone
  const progRnd = rs('programs');
  const zoneOf = (x: number, z: number): Zone => {
    const d = Math.hypot(x - plazaPos[0], z - plazaPos[1]) / R;
    return d < 0.34 ? 'core' : d < 0.72 ? 'mid' : 'outer';
  };
  const weightOf = (p: Program): number => {
    let w = p.weight;
    if (COMMERCE.includes(p.kind)) w *= 0.35 + options.frequency * 1.3;
    if (RURAL.includes(p.kind) && p.kind !== 'cabin') w *= 1.35 - options.frequency * 0.6;
    return w;
  };
  const CAPS: Partial<Record<StructureKind, number>> = {
    blacksmith: 1 + Math.floor(R / 55), mansion: options.kind === 'town' || options.kind === 'fortifiedTown' ? 2 : 0,
    farm: 2 + Math.floor(R / 40), stable: 1 + Math.floor(R / 50),
  };
  const choose = (zone: Zone): StructureKind => {
    const table = PROGRAMS[options.kind][zone].filter((p) => (CAPS[p.kind] ?? 999) > (counts[p.kind] ?? 0));
    const total = table.reduce((s, p) => s + weightOf(p), 0);
    let t = progRnd() * total;
    for (const p of table) { t -= weightOf(p); if (t <= 0) return p.kind; }
    return table[table.length - 1].kind;
  };
  const targetCount = Math.max(4, Math.round(Math.PI * R * R * K.fill * (0.25 + options.density * 0.95)));
  const skipBase = 0.55 * (1 - options.density);
  const order = [...streets].sort((a, b) => (a.cls === 'main' ? 0 : a.cls === 'secondary' ? 1 : 2) - (b.cls === 'main' ? 0 : b.cls === 'secondary' ? 1 : 2));
  let serial = 0;
  for (const st of order) {
    if (st.cls === 'lane') continue;
    const len = pathLength(st.points);
    for (const side of [1, -1]) {
      let s = 5 + progRnd() * 7;
      while (s < len - 4 && placed.length < targetCount * 1.25) {
        const [p, tan] = pointAt(st.points, s);
        const n: P2 = [-tan[1] * side, tan[0] * side];
        const zone = zoneOf(p[0], p[1]);
        const outsideWalls = !insideWalls(p[0], p[1]);
        const kind = choose(outsideWalls ? 'outer' : zone);
        const variant = Math.floor(progRnd() * VARIANTS_PER_KIND);
        const { width, depth } = realDims(kind, variant);
        const setback = 0.9 + progRnd() * 1.3;
        const off = st.width / 2 + setback + depth / 2 + 0.4;
        const x = p[0] + n[0] * off, z = p[1] + n[1] * off;
        if (progRnd() < skipBase + (zone === 'outer' ? 0.15 : 0)) { s += width * 0.7 + progRnd() * 4; continue; }
        const yaw = yawFacing(-n[0], -n[1]) + (progRnd() - 0.5) * 0.14;
        const { f } = footprintFor(kind, variant, x, z, yaw);
        const area = K.walled ? (outsideWalls ? insideOuter : (px: number, pz: number) => insideWalls(px, pz) && inside(px, pz)) : inside;
        if (fits(f, kind, area)) {
          registerBuilding(`b${serial++}`, kind, variant, f, width, depth);
          s += width + MARGIN * 1.2 + progRnd() * (3.5 - options.density * 2.5);
        } else s += 3;
      }
    }
  }

  // back lots: fill the blocks between streets, facing the nearest one
  {
    const backRnd = rs('backlots');
    let guard = 0;
    while (placed.length < targetCount && guard++ < 1800) {
      const a = backRnd() * Math.PI * 2, r = Math.sqrt(backRnd()) * R * 1.05;
      const x = centre[0] + Math.cos(a) * r * 1.0, z = centre[1] + Math.sin(a) * r * 1.0;
      if (!inside(x, z) && !(K.walled && insideOuter(x, z) && backRnd() < 0.5)) continue;
      const near = streetGrid.nearest(x, z, 26);
      if (!near || near.d < 6.5) continue;
      const outsideWalls = !insideWalls(x, z);
      const kind = choose(outsideWalls ? 'outer' : zoneOf(x, z));
      const variant = Math.floor(backRnd() * VARIANTS_PER_KIND);
      const { width, depth } = realDims(kind, variant);
      const yaw = yawFacing(near.p.x - x, near.p.z - z) + (backRnd() - 0.5) * 0.3;
      const { f } = footprintFor(kind, variant, x, z, yaw);
      const area = K.walled ? (outsideWalls ? insideOuter : (px: number, pz: number) => insideWalls(px, pz) && inside(px, pz)) : inside;
      if (fits(f, kind, area)) registerBuilding(`b${serial++}`, kind, variant, f, width, depth);
    }
  }

  // windmill on high open ground at the rim
  {
    const wRnd = rs('windmill');
    const want = options.kind === 'hamlet' ? 0.25 : options.kind === 'village' ? 0.6 : 0.45;
    if (wRnd() < want + options.frequency * 0.3) {
      let best: { f: Footprint; h: number } | null = null;
      for (let t = 0; t < 120; t++) {
        const a = wRnd() * Math.PI * 2, r = R * (0.72 + wRnd() * 0.4);
        const x = centre[0] + Math.cos(a) * r, z = centre[1] + Math.sin(a) * r;
        const { f } = footprintFor('windmill', 0, x, z, yawFacing(plazaPos[0] - x, plazaPos[1] - z));
        if (!insideOuter(x, z) || !fits(f, 'windmill', insideOuter, 1.2)) continue;
        const h = terrain.height(x, z);
        if (!best || h > best.h) best = { f, h };
      }
      if (best) { const dm = variantDims('windmill', 0); registerBuilding('windmill_0', 'windmill', 0, best.f, dm.width, dm.depth); }
    }
  }
  // wooden watchtowers stand inside the settlement, on its higher ground
  {
    const tRnd = rs('watchtowers');
    const want = options.kind === 'fortifiedTown' ? 2 : options.kind === 'town' ? 1 + (tRnd() < 0.5 ? 1 : 0) : options.kind === 'village' ? (tRnd() < 0.5 ? 1 : 0) : 0;
    for (let n = 0; n < want; n++) {
      let best: { f: Footprint; h: number } | null = null;
      for (let t = 0; t < 140; t++) {
        const a = tRnd() * Math.PI * 2, r = R * (0.3 + tRnd() * 0.3);
        const x = plazaPos[0] + Math.cos(a) * r, z = plazaPos[1] + Math.sin(a) * r;
        const { f } = footprintFor('watchtower', 0, x, z, yawFacing(plazaPos[0] - x, plazaPos[1] - z));
        const area = K.walled ? (px: number, pz: number) => insideWalls(px, pz) && inside(px, pz) : inside;
        if (!fits(f, 'watchtower', area)) continue;
        const h = terrain.height(x, z) - slope(x, z) * 8;
        if (!best || h > best.h) best = { f, h };
      }
      if (best) { const dm = variantDims('watchtower', 0); registerBuilding('watchtower_' + n, 'watchtower', 0, best.f, dm.width, dm.depth); }
    }
  }
  // watermill on a river bank
  {
    const mRnd = rs('watermill');
    let best: { f: Footprint; score: number } | null = null;
    for (let t = 0; t < 400; t++) {
      const a = mRnd() * Math.PI * 2, r = R * (0.2 + mRnd() * 1.0);
      const x = centre[0] + Math.cos(a) * r, z = centre[1] + Math.sin(a) * r;
      if (terrain.isWater(x, z)) continue;
      let wd: P2 | null = null, bestD = 99;
      for (let k = 0; k < 16; k++) {
        const ka = (k / 16) * Math.PI * 2;
        for (const dd of [4, 6, 8]) {
          const wx = x + Math.cos(ka) * dd, wz = z + Math.sin(ka) * dd;
          if (terrain.isWater(wx, wz) && dd < bestD) { bestD = dd; wd = [wx, wz]; }
        }
      }
      if (!wd) continue;
      const { f } = footprintFor('watermill', 0, x, z, yawFacing(x - wd[0], z - wd[1]));
      if (!insideOuter(x, z)) continue;
      const wetOk = !terrain.isWater(f.x, f.z) && corners(f).every(([cx, cz]) => !terrain.isWater(cx, cz));
      if (!wetOk || slope(x, z) > 0.4 || !clearOfStreets(f, 0.7) || !clearOfObstacles(f)) continue;
      const score = -Math.hypot(x - plazaPos[0], z - plazaPos[1]) - bestD * 2;
      if (!best || score > best.score) best = { f, score };
    }
    if (best) { const dm = variantDims('watermill', 0); registerBuilding('watermill_0', 'watermill', 0, best.f, dm.width, dm.depth); }
  }

  // 7. access: every door reaches a street, by a short lane when it does not -----
  let removed = 0;
  for (const b of [...placed]) {
    if (edgeDistance(streetGrid, b.door[0], b.door[1], 40) <= 2.4) continue;
    const self = obstacles.find((o) => o.id === b.id)!.f;
    const lane = makeLane(b.id, b.door, self);
    if (lane) { lanes.push(lane); indexStreet(lane); continue; }
    removed++;
    placed.splice(placed.indexOf(b), 1);
    const oi = obstacles.findIndex((o) => o.id === b.id);
    if (oi >= 0) obstacles.splice(oi, 1);
  }
  lanes.forEach((l, i) => { l.id = 'lane_' + i; streets.push(l); });

  // Secondary streets that wander off into empty ground are trimmed back to the last building
  // (or lane) they serve, so no street leads nowhere.
  {
    const anchors: P2[] = [...placed.map((b) => b.door), ...lanes.map((l) => l.points[l.points.length - 1])];
    let trimmed = 0;
    for (let i = streets.length - 1; i >= 0; i--) {
      const st = streets[i];
      if (st.cls !== 'secondary') continue;
      const joined = (pt: P2) => streets.some((o) => o !== st && o.points.some(([x, z]) => Math.hypot(x - pt[0], z - pt[1]) < 4));
      let changed = false;
      for (const fromEnd of [true, false]) {
        const pts = st.points;
        const at = (k: number) => pts[fromEnd ? pts.length - 1 - k : k];
        if (joined(at(0))) continue; // this end meets another street
        let drop = 0;
        while (pts.length - drop > 3) {
          const tip = at(drop);
          if (anchors.some((a) => Math.hypot(a[0] - tip[0], a[1] - tip[1]) < 6)) break;
          drop++;
        }
        if (drop > 0) { if (fromEnd) pts.splice(pts.length - drop, drop); else pts.splice(0, drop); changed = true; }
      }
      if (changed) trimmed++;
      if (st.points.length < 4 || pathLength(st.points) < 8) streets.splice(i, 1);
    }
    if (trimmed) { streetGrid.clear(); streets.forEach(indexStreet); }
    stats.deadEndsTrimmed = trimmed;
  }

  // Last check, after every street has taken its final shape: each door still reaches a street.
  for (const b of [...placed]) {
    if (edgeDistance(streetGrid, b.door[0], b.door[1], 40) <= 2.4) continue;
    const self = obstacles.find((o) => o.id === b.id)!.f;
    const lane = makeLane(b.id, b.door, self);
    if (lane) { lane.id = 'lane_' + streets.length; streets.push(lane); indexStreet(lane); continue; }
    removed++;
    placed.splice(placed.indexOf(b), 1);
    const oi = obstacles.findIndex((o) => o.id === b.id);
    if (oi >= 0) obstacles.splice(oi, 1);
  }
  stats.removedWithoutAccess = removed;

  // 8. decoration ----------------------------------------------------------------
  const decoRnd = rs('props');
  const addProp = (kind: StructureKind, x: number, z: number, yaw: number, hw: number, hd: number): boolean => {
    const f: Footprint = { x, z, hw, hd, yaw };
    if (!inside(x, z) && !insideOuter(x, z)) return false;
    if (terrain.isWater(x, z) || slope(x, z) > 0.45) return false;
    if (!clearOfObstacles(f, 0.3) || !clearOfStreets(f, 0.5)) return false;
    props.push({ id: 'prop_' + props.length, kind, variant: 0, ...f, baseY: terrain.height(x, z) });
    addObstacle('prop_' + props.length, f);
    return true;
  };
  // lanterns along the main streets and at the gates
  for (const m of mains) {
    const len = pathLength(m.points);
    for (let s = plaza.radius + 6; s < Math.min(len, R * 1.05); s += 24 + decoRnd() * 10) {
      const [p, tan] = pointAt(m.points, s);
      const side = decoRnd() < 0.5 ? 1 : -1;
      addProp('stoneLantern', p[0] - tan[1] * side * (m.width / 2 + 1.1), p[1] + tan[0] * side * (m.width / 2 + 1.1), 0, 0.9, 0.9);
    }
  }
  const stallBuildings = placed.filter((b) => b.kind === 'market' || b.kind === 'blacksmith' || b.kind === 'farm' || b.kind === 'barn');
  for (const b of stallBuildings) {
    const n = 1 + Math.floor(decoRnd() * (1 + options.frequency * 2));
    for (let i = 0; i < n; i++) {
      const kind = pick(decoRnd, ['woodenBarrel', 'woodenCrate', 'supplySacks', 'woodenCart'] as StructureKind[]);
      const side = decoRnd() < 0.5 ? -1 : 1;
      const lx = side * (b.hw + 0.9 + decoRnd() * 0.6), lz = -b.hd * (0.2 + decoRnd() * 0.7);
      const [wx, wz] = toWorld(b, lx, lz);
      addProp(kind, wx, wz, b.yaw + (decoRnd() - 0.5) * 0.8, kind === 'woodenCart' ? 1.2 : 0.7, kind === 'woodenCart' ? 1.6 : 0.7);
    }
  }
  for (const b of placed.filter((q) => q.role === 'home')) {
    if (decoRnd() < 0.12 + options.frequency * 0.25) {
      const side = decoRnd() < 0.5 ? -1 : 1;
      const [wx, wz] = toWorld(b, side * (b.hw + 0.8), -b.hd * 0.5);
      addProp(pick(decoRnd, ['toolRack', 'woodenBarrel', 'woodenCrate'] as StructureKind[]), wx, wz, b.yaw, 0.7, 0.5);
    }
  }
  // trees in the open ground
  const trees: PlannedTree[] = [];
  if (options.trees) {
    const tRnd = rs('trees');
    const snowy = options.biome === 'hebra' || options.biome === 'hebra_snowy' || options.biome === 'tundra';
    const nTrees = Math.round(Math.PI * R * R * 0.0032 * (1.1 - options.density * 0.5));
    for (let t = 0; t < nTrees * 5 && trees.length < nTrees; t++) {
      const a = tRnd() * Math.PI * 2, r = (0.15 + Math.sqrt(tRnd()) * 1.25) * R;
      const x = centre[0] + Math.cos(a) * r, z = centre[1] + Math.sin(a) * r;
      if (terrain.isWater(x, z) || slope(x, z) > 0.55) continue;
      if (obstacles.some((o) => pointInRectLoose(o.f, x, z, 3.2))) continue;
      if (nearStreet(x, z, 8).some((s) => Math.hypot(s.x - x, s.z - z) < s.hw + 2.6)) continue;
      if (Math.hypot(x - plazaPos[0], z - plazaPos[1]) < plaza.radius + 3) continue;
      if (terrain.isWater(x + 2.5, z) || terrain.isWater(x - 2.5, z) || terrain.isWater(x, z + 2.5) || terrain.isWater(x, z - 2.5)) continue;
      trees.push({
        x, z, baseY: terrain.height(x, z), scale: 0.8 + tRnd() * 0.5, variant: Math.floor(tRnd() * 3),
        species: snowy ? 'hebra_pine' : tRnd() < 0.7 ? 'hyrule_oak' : 'akkala_birch',
      });
    }
  }

  // levelled ground under every building
  const pads: Pad[] = placed.map((b) => ({ x: b.x, z: b.z, hw: b.hw + 0.4, hd: b.hd + 0.4, yaw: b.yaw, y: b.baseY }));

  stats.buildings = placed.length;
  stats.streets = streets.length;
  stats.streetMetres = Math.round(streets.reduce((s, q) => s + pathLength(q.points), 0));
  stats.removedWithoutAccess = removed;
  // ponte sem rua nas duas pontas não leva a lugar nenhum (a rua foi podada): sai do plano
  for (let i = bridges.length - 1; i >= 0; i--) {
    const b = bridges[i];
    const dx = Math.cos(b.yaw), dz = -Math.sin(b.yaw), r = b.length / 2 + 3.3;
    const linked = (fx: number, fz: number) => streets.some((s) => s.points.some((q) => Math.hypot(q[0] - fx, q[1] - fz) < 3.2));
    if (!(linked(b.x + dx * r, b.z + dz * r) && linked(b.x - dx * r, b.z - dz * r))) bridges.splice(i, 1);
  }
  stats.bridges = bridges.length;
  stats.props = props.length;
  stats.trees = trees.length;
  stats.walls = walls.length;
  stats.target = targetCount;
  for (const [k, v] of Object.entries(counts)) stats['n_' + k] = v;

  return {
    options, centre, radius: R, boundary, plaza, streets, buildings: placed, props, trees, walls, bridges, pads, stats,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function pointInRectLoose(f: Footprint, x: number, z: number, grow = 0): boolean {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const dx = x - f.x, dz = z - f.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= f.hw + grow && Math.abs(lz) <= f.hd + grow;
}

function scalePolygon(poly: P2[], c: P2, k: number): P2[] {
  return poly.map(([x, z]) => [c[0] + (x - c[0]) * k, c[1] + (z - c[1]) * k] as P2);
}

function meanHeight(t: TerrainSampler, f: Footprint): number {
  const pts = [...corners(f), [f.x, f.z] as P2];
  return pts.reduce((s, [x, z]) => s + t.height(x, z), 0) / pts.length;
}
export function minHeight(t: TerrainSampler, f: Footprint): number {
  return Math.min(...[...corners(f), [f.x, f.z] as P2].map(([x, z]) => t.height(x, z)));
}

function chooseSite(t: TerrainSampler, R: number, rnd: () => number, preferRiver = false, span = 1.8): P2 {
  const S = R * span;
  const stepSize = Math.max(8, R / 6);
  let best: { p: P2; score: number } | null = null;
  const jitter = rnd() * 0.01;
  for (let gx = -S; gx <= S; gx += stepSize) {
    for (let gz = -S; gz <= S; gz += stepSize) {
      const c: P2 = [gx, gz];
      let slopeSum = 0, wet = 0, n = 0, waterNear = false;
      for (const f of [0, 0.35, 0.65, 0.9]) {
        const m = f === 0 ? 1 : 12;
        for (let i = 0; i < m; i++) {
          const a = (i / m) * Math.PI * 2;
          const x = gx + Math.cos(a) * R * f, z = gz + Math.sin(a) * R * f;
          slopeSum += slopeAt(t, x, z); n++;
          if (t.isWater(x, z)) wet++;
        }
      }
      for (let i = 0; i < 16 && !waterNear; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const f of [0.9, 1.1, 1.35]) if (t.isWater(gx + Math.cos(a) * R * f, gz + Math.sin(a) * R * f)) waterNear = true;
      }
      const wetFrac = wet / n;
      // a river through the settlement (a little water inside it) asks for bridges; otherwise keep dry
      const acrossRiver = preferRiver && wetFrac > 0.04 && wetFrac < 0.24;
      const score = (slopeSum / n) * 6 + (acrossRiver ? 0 : wetFrac * 14) + Math.hypot(gx, gz) * 0.003 + jitter * Math.hypot(gx, gz)
        - (acrossRiver ? 2.2 : waterNear && wetFrac < 0.12 ? 0.35 : 0);
      if (!best || score < best.score) best = { p: c, score };
    }
  }
  return best ? best.p : [0, 0];
}

function flattestPoint(t: TerrainSampler, c: P2, radius: number, step: number): P2 {
  let best: P2 = c, bestS = Infinity;
  for (let dx = -radius; dx <= radius; dx += step / 2) {
    for (let dz = -radius; dz <= radius; dz += step / 2) {
      const x = c[0] + dx, z = c[1] + dz;
      if (t.isWater(x, z) || Math.hypot(dx, dz) > radius) continue;
      const s = slopeAt(t, x, z, 2.5) + Math.hypot(dx, dz) * 0.002;
      if (s < bestS) { bestS = s; best = [x, z]; }
    }
  }
  return best;
}

/** Last point still inside the polygon walking from `from` along angle `a`. */
function boundaryAlong(from: P2, a: number, inside: (x: number, z: number) => boolean, maxR: number): P2 | null {
  let last: P2 | null = null;
  for (let r = 4; r <= maxR; r += 2) {
    const x = from[0] + Math.cos(a) * r, z = from[1] + Math.sin(a) * r;
    if (inside(x, z)) last = [x, z]; else if (last) break;
  }
  return last;
}

function pointAt(points: P2[], s: number): [P2, P2] {
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (acc + l >= s || i === points.length - 2) {
      const t = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return [[ax + (bx - ax) * t, az + (bz - az) * t], l > 0 ? [(bx - ax) / l, (bz - az) / l] : [1, 0]];
    }
    acc += l;
  }
  return [points[0], [1, 0]];
}

function waterRuns(points: P2[], t: TerrainSampler): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < points.length; i++) {
    const w = t.isWater(points[i][0], points[i][1]);
    if (w && start < 0) start = i;
    if (!w && start >= 0) { runs.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, points.length - 1]);
  return runs;
}
function runLength(points: P2[], [a, b]: [number, number]): number {
  return pathLength(points.slice(a, b + 1)) + 4;
}

function segHit(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): P2 | null {
  const r = [bx - ax, bz - az], s = [dx - cx, dz - cz];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s[1] - (cz - az) * s[0]) / den;
  const u = ((cx - ax) * r[1] - (cz - az) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [ax + r[0] * t, az + r[1] * t];
}
