import type { P2 } from './geometry';

export interface GridSpec {
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  cell: number;
  /** cost multiplier of standing in a cell (>= 1), or Infinity when impassable */
  cost: (x: number, z: number) => number;
}

class MinHeap {
  private items: { f: number; i: number }[] = [];
  get size() { return this.items.length; }
  push(f: number, i: number) {
    const a = this.items;
    a.push({ f, i });
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p].f <= a[k].f) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): { f: number; i: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** A* over a coarse grid. Returns world points from start to goal, or null. */
export function findPath(g: GridSpec, start: P2, goal: P2): P2[] | null {
  const toCell = (x: number, z: number): [number, number] => [
    Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.cell))),
    Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.cell))),
  ];
  const world = (cx: number, cz: number): P2 => [g.minX + cx * g.cell, g.minZ + cz * g.cell];
  const [sx, sz] = toCell(start[0], start[1]);
  const [gx, gz] = toCell(goal[0], goal[1]);
  const n = g.cols * g.rows;
  const cost = new Float32Array(n).fill(-1);
  const gScore = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // the start and the goal are always passable: they may sit inside the margin of a building beside them
  cost[sz * g.cols + sx] = 1;
  cost[gz * g.cols + gx] = 1;
  const cellCost = (cx: number, cz: number) => {
    const i = cz * g.cols + cx;
    if (cost[i] < 0) { const [x, z] = world(cx, cz); cost[i] = g.cost(x, z); }
    return cost[i];
  };
  const heap = new MinHeap();
  const s = sz * g.cols + sx, e = gz * g.cols + gx;
  gScore[s] = 0;
  heap.push(Math.hypot(gx - sx, gz - sz) * g.cell, s);
  while (heap.size) {
    const { i } = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === e) break;
    const cx = i % g.cols, cz = (i / g.cols) | 0;
    for (const [dx, dz, step] of NEIGHBOURS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= g.cols || nz >= g.rows) continue;
      const j = nz * g.cols + nx;
      if (closed[j]) continue;
      const c = cellCost(nx, nz);
      if (!Number.isFinite(c)) continue;
      // no squeezing diagonally between two blocked cells
      if (dx !== 0 && dz !== 0 && (!Number.isFinite(cellCost(cx + dx, cz)) || !Number.isFinite(cellCost(cx, cz + dz)))) continue;
      const tentative = gScore[i] + step * g.cell * c;
      if (tentative < gScore[j]) {
        gScore[j] = tentative;
        from[j] = i;
        heap.push(tentative + Math.hypot(gx - nx, gz - nz) * g.cell, j);
      }
    }
  }
  if (!closed[e]) return null;
  const cells: number[] = [];
  for (let k = e; k !== -1; k = from[k]) cells.push(k);
  cells.reverse();
  const out: P2[] = cells.map((k) => world(k % g.cols, (k / g.cols) | 0));
  out[0] = [start[0], start[1]];
  out[out.length - 1] = [goal[0], goal[1]];
  return out;
}
