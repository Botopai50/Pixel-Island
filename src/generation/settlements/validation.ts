import type { Footprint, PlannedBuilding, SettlementPlan, TerrainSampler, ValidationReport } from './types';
import { PointGrid, corners, edgeDistance, rectsOverlap } from './geometry';
import { slopeAt } from './terrain';

/**
 * Step 8 of the pipeline: checks that the plan is physically sound.
 *  - no two structures overlap (using the real, measured footprints when given)
 *  - nothing stands in water
 *  - every building has a street or lane at its door
 *  - nothing stands on very steep ground
 */
export function validatePlan(
  plan: SettlementPlan,
  terrain: TerrainSampler,
  rectOf: (b: PlannedBuilding) => Footprint = (b) => b
): ValidationReport {
  const overlaps: [string, string][] = [];
  const inWater: string[] = [];
  const noAccess: string[] = [];
  const steep: string[] = [];

  const rects = plan.buildings.map((b) => ({ id: b.id, f: rectOf(b) }));
  const fixed: { id: string; f: Footprint }[] = [
    ...plan.walls.map((w) => ({ id: w.id, f: w as Footprint })),
    ...plan.bridges.map((w) => ({ id: w.id, f: w as Footprint })),
  ];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i].f, rects[j].f, 0.1)) overlaps.push([rects[i].id, rects[j].id]);
    for (const w of fixed) if (w.id.startsWith('wall') || w.id.startsWith('gate') || w.id.startsWith('tower') ? rectsOverlap(rects[i].f, shrink(w.f), 0.1) : false) overlaps.push([rects[i].id, w.id]);
  }
  for (const r of rects) {
    if (corners(r.f).some(([x, z]) => terrain.isWater(x, z)) || terrain.isWater(r.f.x, r.f.z)) inWater.push(r.id);
    if (slopeAt(terrain, r.f.x, r.f.z) > 0.5) steep.push(r.id);
  }
  const grid = new PointGrid<{ x: number; z: number; hw: number }>(8);
  for (const s of plan.streets) for (const [x, z] of s.points) grid.add({ x, z, hw: s.width / 2 });
  for (const b of plan.buildings) {
    if (edgeDistance(grid, b.door[0], b.door[1], 14) > 2.6) noAccess.push(b.id);
  }
  return { overlaps, inWater, noAccess, steep, ok: !overlaps.length && !inWater.length && !noAccess.length && !steep.length };
}

/** Walls are long and thin; ignore the bit of margin the planner keeps around them. */
function shrink(f: Footprint): Footprint {
  return { ...f, hw: Math.max(0.5, f.hw - 0.4), hd: Math.max(0.5, f.hd - 0.6) };
}
