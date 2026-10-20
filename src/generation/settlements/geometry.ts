import type { Footprint } from './types';

export type P2 = [number, number];

/** World position of a local point (lx, lz) of a footprint (three.js Y rotation). */
export function toWorld(f: Footprint, lx: number, lz: number): P2 {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
}

/** Direction a footprint faces (local -z). */
export function frontOf(f: Footprint): P2 {
  return [-Math.sin(f.yaw), -Math.cos(f.yaw)];
}

/** Yaw that makes a footprint face the world direction (dx, dz). */
export function yawFacing(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export function corners(f: Footprint, grow = 0): P2[] {
  const hw = f.hw + grow, hd = f.hd + grow;
  return [toWorld(f, -hw, -hd), toWorld(f, hw, -hd), toWorld(f, hw, hd), toWorld(f, -hw, hd)];
}

/** Separating axis test for two rotated rectangles, each grown by `gap`. */
export function rectsOverlap(a: Footprint, b: Footprint, gap = 0): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.hypot(dx, dz) > Math.hypot(a.hw, a.hd) + Math.hypot(b.hw, b.hd) + gap) return false;
  const axes: P2[] = [
    [Math.cos(a.yaw), -Math.sin(a.yaw)], [Math.sin(a.yaw), Math.cos(a.yaw)],
    [Math.cos(b.yaw), -Math.sin(b.yaw)], [Math.sin(b.yaw), Math.cos(b.yaw)],
  ];
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; amin = Math.min(amin, p); amax = Math.max(amax, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
    if (amax + gap <= bmin || bmax + gap <= amin) return false;
  }
  return true;
}

export function pointInRect(f: Footprint, x: number, z: number, grow = 0): boolean {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const dx = x - f.x, dz = z - f.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= f.hw + grow && Math.abs(lz) <= f.hd + grow;
}

/** Points along the outline of a rectangle (every `step` metres), grown by `grow`. */
export function outlineSamples(f: Footprint, step = 1.6, grow = 0): P2[] {
  const out: P2[] = [];
  const hw = f.hw + grow, hd = f.hd + grow;
  const nx = Math.max(1, Math.ceil((hw * 2) / step)), nz = Math.max(1, Math.ceil((hd * 2) / step));
  for (let i = 0; i <= nx; i++) {
    const lx = -hw + (i / nx) * hw * 2;
    out.push(toWorld(f, lx, -hd), toWorld(f, lx, hd));
  }
  for (let j = 1; j < nz; j++) {
    const lz = -hd + (j / nz) * hd * 2;
    out.push(toWorld(f, -hw, lz), toWorld(f, hw, lz));
  }
  return out;
}

export function pointInPolygon(poly: P2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Uniform grid over points, for "what is within r of here". */
export class PointGrid<T extends { x: number; z: number }> {
  private cells = new Map<string, T[]>();
  constructor(private cell = 8) {}
  private key(ix: number, iz: number) { return ix + ',' + iz; }
  clear() { this.cells.clear(); }
  add(p: T) {
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
    const list = this.cells.get(k);
    if (list) list.push(p); else this.cells.set(k, [p]);
  }
  near(x: number, z: number, r: number): T[] {
    const out: T[] = [];
    const i0 = Math.floor((x - r) / this.cell), i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((z - r) / this.cell), j1 = Math.floor((z + r) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this.cells.get(this.key(i, j));
      if (list) for (const p of list) out.push(p);
    }
    return out;
  }
  nearest(x: number, z: number, maxR = 64): { p: T; d: number } | null {
    let best: { p: T; d: number } | null = null;
    for (let r = this.cell; r <= maxR; r += this.cell) {
      for (const p of this.near(x, z, r)) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (!best || d < best.d) best = { p, d };
      }
      if (best && best.d <= r) break;
    }
    return best;
  }
}

/** Chaikin corner cutting, then resampling every `step` metres. */
export function smoothPath(points: P2[], iterations = 2, step = 2): P2[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const next: P2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  const out: P2[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let at = step - carry;
    while (at <= len) { const t = at / len; out.push([ax + (bx - ax) * t, az + (bz - az) * t]); at += step; }
    carry = len - (at - step);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 0.5) out.push(last);
  return out;
}

export function pathLength(points: P2[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return l;
}

/** Distance from a point to the nearest street edge (centre distance minus half width); Infinity when none within maxR. */
export function edgeDistance(grid: PointGrid<{ x: number; z: number; hw: number }>, x: number, z: number, maxR = 40): number {
  let best = Infinity;
  for (const p of grid.near(x, z, maxR)) best = Math.min(best, Math.hypot(p.x - x, p.z - z) - p.hw);
  return best;
}
