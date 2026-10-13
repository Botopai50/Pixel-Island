// @ts-nocheck
// Porte do pacote gerador-lanterna-de-pedra (Pixel_Tree: estruturas, geometria e texturas pintadas). Só a lanterna de pedra usa isto.
// work/Pixel_Tree-main/src/structures/connections.ts
function resolveConnections(plan) {
  const walls = [], openings = [];
  const parents = new Map(plan.supports.map((s) => [s.component, s.on]));
  const oldWalls = new Set(plan.walls.map((w) => w.id));
  for (const w of plan.walls) {
    const dx = w.end[0] - w.start[0], dz = w.end[2] - w.start[2], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const neighbors = plan.volumes.filter((v) => v.id !== w.volume && (Math.abs(dx) > Math.abs(dz) && Math.abs(Math.abs(w.start[2] - v.z) - v.depth / 2) < 1e-5 || Math.abs(dz) > Math.abs(dx) && Math.abs(Math.abs(w.start[0] - v.x) - v.width / 2) < 1e-5));
    if (!neighbors.length) {
      walls.push(w);
      openings.push(...plan.openings.filter((o) => o.wall === w.id));
      continue;
    }
    const project = (x, z) => (x - w.start[0]) * ux + (z - w.start[2]) * uz;
    const intervals = neighbors.map((v) => {
      const ends = [project(v.x - v.width / 2, v.z - v.depth / 2), project(v.x + v.width / 2, v.z + v.depth / 2)].sort((a, b) => a - b);
      return { lo: Math.max(0, ends[0]), hi: Math.min(L, ends[1]), bottom: Math.max(0, v.bottom - w.bottom), top: Math.min(w.height, v.bottom + v.height - w.bottom) };
    }).filter((i) => i.hi > i.lo && i.top > i.bottom);
    if (!intervals.length) {
      walls.push(w);
      openings.push(...plan.openings.filter((o) => o.wall === w.id));
      continue;
    }
    const xs = [.../* @__PURE__ */ new Set([0, L, ...intervals.flatMap((i) => [i.lo, i.hi]), ...w.gable ? [L * w.gable.ratio] : []])].sort((a, b) => a - b), ys = [.../* @__PURE__ */ new Set([0, w.height, ...intervals.flatMap((i) => [i.bottom, i.top])])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      const lo = xs[i], hi = xs[i + 1], b = ys[j], t = ys[j + 1], mx = (lo + hi) / 2, my = (b + t) / 2;
      if (intervals.some((r) => mx > r.lo - 1e-6 && mx < r.hi + 1e-6 && my > r.bottom - 1e-6 && my < r.top + 1e-6)) continue;
      const id = w.id + "_section_" + i + "_" + j;
      const cell = { ...w, id, start: [w.start[0] + ux * lo, w.bottom + b, w.start[2] + uz * lo], end: [w.start[0] + ux * hi, w.bottom + b, w.start[2] + uz * hi], bottom: w.bottom + b, height: t - b, gable: void 0, topLeft: void 0, topRight: void 0 };
      if (t === w.height) {
        const profile2 = (x) => {
          const u = x / L;
          let height = (w.topLeft ?? w.height) * (1 - u) + (w.topRight ?? w.height) * u;
          if (w.gable) {
            const at = w.gable.ratio;
            height += w.gable.peak * (u < at ? u / at : (1 - u) / (1 - at));
          }
          return height - b;
        };
        cell.topLeft = profile2(lo);
        cell.topRight = profile2(hi);
      }
      walls.push(cell);
      parents.set(id, parents.get(w.id));
      for (const o of plan.openings.filter((o2) => o2.wall === w.id)) {
        const center = o.offset + L / 2;
        if (center - o.width / 2 >= lo + 0.101 && center + o.width / 2 <= hi - 0.101 && o.bottom >= b && o.bottom + o.height <= t) openings.push({ ...o, id: o.id + "_section", wall: id, offset: center - (lo + hi) / 2, bottom: o.bottom - b });
      }
    }
  }
  plan.supports = plan.supports.filter((s) => !oldWalls.has(s.component));
  walls.forEach((w) => plan.supports.push({ component: w.id, on: parents.get(w.id) }));
  plan.walls = walls;
  plan.openings = openings;
  const removed = /* @__PURE__ */ new Set();
  for (let i = 0; i < plan.pieces.length; i++) {
    const a = plan.pieces[i];
    if (a.kind !== "beam" || removed.has(a.id)) continue;
    const ae = a.end, axis = a.position.findIndex((x, k) => Math.abs(x - ae[k]) > 1e-5);
    if (axis < 0 || a.position.some((x, k) => k !== axis && Math.abs(x - ae[k]) > 1e-5)) continue;
    for (let j = i + 1; j < plan.pieces.length; j++) {
      const b = plan.pieces[j];
      if (b.kind !== "beam" || removed.has(b.id) || b.material !== a.material || b.size[0] !== a.size[0] || !b.end) continue;
      if (a.position.some((x, k) => k !== axis && (Math.abs(x - b.position[k]) > 1e-5 || Math.abs(x - b.end[k]) > 1e-5))) continue;
      const [al, ah] = [a.position[axis], a.end[axis]].sort((x, y) => x - y), [bl, bh] = [b.position[axis], b.end[axis]].sort((x, y) => x - y);
      if (bl > ah + 1e-5 || al > bh + 1e-5) continue;
      a.position[axis] = Math.min(al, bl);
      a.end[axis] = Math.max(ah, bh);
      removed.add(b.id);
    }
  }
  plan.pieces = plan.pieces.filter((p) => !removed.has(p.id));
  plan.supports = plan.supports.filter((s) => !removed.has(s.component));
  plan.joints = plan.joints.map((j) => ({ ...j, members: j.members.filter((id) => !removed.has(id)) })).filter((j) => j.members.length);
  return plan;
}

// work/Pixel_Tree-main/src/structures/roofDetails.ts
function dressRoof(a, r) {
  if (r.plainEdge) return;
  const w = r.width / 2, d = r.depth / 2, e = r.eaves;
  const left = r.x - w - e, right = r.x + w + e, front = r.z - d - e, back = r.z + d + e;
  const ratio = r.ridgeRatio ?? 0.5, ridge = r.x - w + r.width * ratio;
  const beam = (from, to, role, section = 0.24, cuts) => a.beam(from, to, section, r.material === "stone" ? "stone" : "wood", role, r.id, cuts);
  if (r.royalTrim && r.kind === "hip") {
    const y = r.y - r.rise * e / Math.min(w, d) + 0.06;
    for (const z of [front, back]) beam([left, y, z], [right, y, z], "castle-eave-beam", 0.16);
    for (const x of [left, right]) beam([x, y, front], [x, y, back], "castle-eave-beam", 0.16);
    const depthAxis = d >= w, first = depthAxis ? [r.x, r.y + r.rise, r.z - d + w] : [r.x - w + d, r.y + r.rise, r.z], last = depthAxis ? [r.x, r.y + r.rise, r.z + d - w] : [r.x + w - d, r.y + r.rise, r.z];
    for (const point of [[left, y - 0.06, front], [right, y - 0.06, front], [right, y - 0.06, back], [left, y - 0.06, back]]) a.beam(point, depthAxis ? point[2] < r.z ? first : last : point[0] < r.x ? first : last, 0.16, "wood", "hip-cap", r.id);
    if (Math.abs(w - d) > 1e-3) a.beam(first, last, 0.16, "wood", "hip-ridge-cap", r.id);
    return;
  }
  if (r.kind === "shed" && r.shedAxis === 2) {
    const height = (z) => r.y + r.rise * (0.5 + (r.shedDirection ?? 1) * (z - r.z) / (2 * d));
    for (const z of [front, back]) beam([left, height(z) - 0.055, z], [right, height(z) - 0.055, z], "roof-fascia");
    for (const x of [left - 0.035, right + 0.035]) beam([x, height(front) - 0.055, front], [x, height(back) - 0.055, back], "eave-fascia");
    return;
  }
  if (r.kind === "gable" || r.kind === "thatch") {
    const ly = r.y - r.rise * e / (r.width * ratio), ry = r.y - r.rise * e / (r.width * (1 - ratio));
    const leftOffset = 0.17 - 0.12 * Math.sqrt(1 + (r.rise / (r.width * ratio)) ** 2), rightOffset = 0.17 - 0.12 * Math.sqrt(1 + (r.rise / (r.width * (1 - ratio))) ** 2);
    for (const z of [front - 0.055, back + 0.055]) {
      beam([left - 0.12, ly + leftOffset - 0.12 * r.rise / (r.width * ratio), z], [ridge, r.y + r.rise + leftOffset, z], "roof-fascia", 0.24, { start: [1, 0, 0], end: [1, 0, 0] });
      beam([ridge, r.y + r.rise + rightOffset, z], [right + 0.12, ry + rightOffset - 0.12 * r.rise / (r.width * (1 - ratio)), z], "roof-fascia", 0.24, { start: [1, 0, 0], end: [1, 0, 0] });
    }
    beam([left, ly + leftOffset, front + 0.065], [left, ly + leftOffset, back - 0.065], "eave-fascia");
    beam([right, ry + rightOffset, front + 0.065], [right, ry + rightOffset, back - 0.065], "eave-fascia");
    if (r.kind !== "thatch") a.beam([ridge, r.y + r.rise + 0.125, front + 0.065], [ridge, r.y + r.rise + 0.125, back - 0.065], 0.36, r.material === "stone" ? "stone" : "wood", "ridge-cap", r.id);
  } else {
    const y = r.kind === "hip" ? r.y - r.rise * e / Math.min(w, d) : r.y;
    const ly = r.kind === "shed" ? r.y + r.rise * (0.5 + (r.shedDirection ?? 1) * (-w - e) / (2 * w)) : y;
    const ry = r.kind === "shed" ? r.y + r.rise * (0.5 + (r.shedDirection ?? 1) * (w + e) / (2 * w)) : y;
    for (const z of [front - 0.055, back + 0.055]) beam([left, ly - 0.055, z], [right, ry - 0.055, z], "roof-fascia");
    beam([left - 0.035, ly - 0.055, front], [left - 0.035, ly - 0.055, back], "eave-fascia");
    beam([right + 0.035, ry - 0.055, front], [right + 0.035, ry - 0.055, back], "eave-fascia");
    if (r.kind === "hip") {
      const low = r.y - r.rise * e / Math.min(w, d), high = r.y + r.rise;
      const axisDepth = d >= w;
      const first = axisDepth ? [r.x, high, r.z - d + w] : [r.x - w + d, high, r.z];
      const last = axisDepth ? [r.x, high, r.z + d - w] : [r.x + w - d, high, r.z];
      const corners = [[left, low, front], [right, low, front], [right, low, back], [left, low, back]];
      for (const corner of corners) {
        const end = axisDepth ? corner[2] < r.z ? first : last : corner[0] < r.x ? first : last;
        a.beam(corner, end, 0.24, "wood", "hip-cap", r.id);
      }
      if (Math.abs(w - d) > 1e-3) a.beam(first, last, 0.24, "wood", "hip-ridge-cap", r.id);
    }
  }
}

// work/Pixel_Tree-main/src/structures/roofSelection.ts
function selectAutomaticRoof(config, role, roll) {
  let choices = [["gable", 0.45], ["hip", 0.3], ["shed", 0.18], ["flat", 0.07]];
  if (config.biome === "gerudo") choices = [["flat", 0.45], ["shed", 0.25], ["gable", 0.2], ["hip", 0.1]];
  else if (["hebra", "hebra_snowy", "tundra"].includes(config.biome)) choices = [["gable", 0.6], ["hip", 0.25], ["shed", 0.15]];
  else if (config.type === "mansion") choices = [["gable", 0.4], ["hip", 0.4], ["shed", 0.12], ["flat", 0.08]];
  else if (["annex", "wing", "entrance", "shed"].includes(role)) choices = [["gable", 0.35], ["hip", 0.25], ["shed", 0.33], ["flat", 0.07]];
  let cumulative = 0;
  for (const [kind, weight] of choices) {
    cumulative += weight;
    if (roll < cumulative) return kind;
  }
  return choices[choices.length - 1][0];
}

// work/Pixel_Tree-main/src/structures/blueprint.ts
var Architect = class {
  constructor(context) {
    this.context = context;
    this.rnd = context.streams.streamFor("architecture", "main");
    this.plan = { schemaVersion: 1, type: context.config.type, seed: context.seed, volumes: [], walls: [], openings: [], roofs: [], pieces: [], joints: [], supports: [], accesses: [], damage: [], debris: [], propZones: [] };
  }
  depend(component, on, minimum = on.length) {
    this.plan.supports = this.plan.supports.filter((s) => s.component !== component);
    for (const parent of on) this.plan.supports.push({ component, on: parent, minimum });
    const piece = this.plan.pieces.find((p) => p.id === component);
    if (piece) piece.support = on[0];
  }
  value(n, spread = 0.18) {
    return n * (1 + (this.rnd() - 0.5) * 2 * spread);
  }
  piece(kind, position, size, material, role, support = "ground", rotation, end) {
    const p = { id: "piece_" + this.plan.pieces.length, kind, position, size, material, role, support, rotation, end };
    this.plan.pieces.push(p);
    this.plan.supports.push({ component: p.id, on: support });
    return p.id;
  }
  beam(start, end, width, material = "wood", role = "brace", support = "ground", cuts) {
    const id = this.piece("beam", start, [width, width, width], material, role, support, void 0, end);
    if (cuts) this.plan.pieces[this.plan.pieces.length - 1].cuts = cuts;
    for (const point of [start, end]) {
      const key = point.map((n) => n.toFixed(4)).join(":");
      let joint = this.plan.joints.find((j) => j.id === key);
      if (!joint) {
        joint = { id: key, point: [...point], members: [] };
        this.plan.joints.push(joint);
      }
      joint.members.push(id);
    }
    return id;
  }
  stairs(from, to, width = 1.5) {
    this.plan.accesses.push({ id: "access_" + this.plan.accesses.length, from, to, width, role: "stairs" });
    return this.piece("stairs", from, [width, Math.abs(to[1] - from[1]), Math.hypot(to[0] - from[0], to[2] - from[2])], "stone", "stairs", "ground", void 0, to);
  }
  building(x, z, w, d, h, floors = 1, options = {}) {
    const cfg = this.context.config, base2 = options.base ?? 0.25, id = "volume_" + this.plan.volumes.length;
    const v = { id, x, z, width: w, depth: d, bottom: base2, height: h, floors, role: options.role ?? "building" };
    this.plan.volumes.push(v);
    const foundation = this.piece("box", [x, base2 / 2, z], [w + 0.25, base2, d + 0.25], "stone", "foundation");
    for (let level = 0; level < floors; level++) {
      const y = base2 + level * h / floors + 0.06;
      if (level === 0 || w < 2.6 || d < 2.6) this.piece("box", [x, y, z], [w - 0.04, 0.12, d - 0.04], "wood", "floor", foundation);
      else {
        const strip = 1.45;
        this.piece("box", [x + strip / 2, y, z], [w - strip - 0.04, 0.12, d - 0.04], "wood", "floor", foundation);
        this.piece("box", [x - w / 2 + strip / 2, y, z + d / 2 - 0.65], [strip - 0.04, 0.12, 1.25], "wood", "floor-landing", foundation);
        this.stairs([x - w / 2 + 0.74, base2 + (level - 1) * h / floors + 0.12, z - d / 2 + 0.55], [x - w / 2 + 0.74, base2 + level * h / floors + 0.12, z + d / 2 - 0.65], 1.15);
      }
    }
    const corners = [[x - w / 2, base2, z - d / 2], [x + w / 2, base2, z - d / 2], [x + w / 2, base2, z + d / 2], [x - w / 2, base2, z + d / 2]];
    const roofKind = options.roof ?? cfg.roof, resolved = roofKind === "auto" ? selectAutomaticRoof(cfg, v.role, this.rnd()) : roofKind;
    const main = this.plan.volumes[0], sideAnnex = ["annex", "wing", "entrance", "shed"].includes(v.role) && Math.abs(x - main.x) > 0.25;
    const shedDirection = sideAnnex ? x > main.x ? -1 : 1 : this.context.streams.streamFor("roof-direction", id)() < 0.5 ? 1 : -1;
    const rise = resolved === "flat" ? 0.16 : (resolved === "hip" ? Math.min(w, d) : w) * (0.2 + cfg.roofPitch * 0.33), ridgeRatio = 0.5 + (this.rnd() - 0.5) * 0.16 * cfg.asymmetry;
    for (let s = 0; s < 4; s++) {
      if (!options.open) {
        const wall = { id: id + "_wall_" + s, volume: id, start: corners[s], end: corners[(s + 1) % 4], bottom: base2, height: h, thickness: 0.18, material: options.material ?? "plaster" };
        if ((resolved === "gable" || resolved === "thatch") && (s === 0 || s === 2)) wall.gable = { peak: rise, ratio: s === 0 ? ridgeRatio : 1 - ridgeRatio };
        if (resolved === "shed") {
          const left = h + (shedDirection < 0 ? rise : 0), right = h + (shedDirection > 0 ? rise : 0);
          if (s === 0) {
            wall.topLeft = left;
            wall.topRight = right;
          }
          if (s === 2) {
            wall.topLeft = right;
            wall.topRight = left;
          }
          if (s === (shedDirection > 0 ? 1 : 3)) wall.height = h + rise;
        }
        this.plan.walls.push(wall);
        this.plan.supports.push({ component: wall.id, on: foundation });
        const len = s % 2 ? d : w;
        const door = s === 0 && options.door !== false, doorOffset = (this.rnd() - 0.5) * Math.max(0, len - 3) * cfg.asymmetry;
        if (door) this.plan.openings.push({ id: wall.id + "_door", wall: wall.id, kind: "door", offset: doorOffset, width: Math.min(1.35, len * 0.3), bottom: 0, height: Math.min(2.15, h * 0.78) });
        const spacing = 2.5, count = Math.min(6, Math.floor(len / spacing * cfg.openingDensity * (0.55 + cfg.complexity * 0.9)));
        for (let l = 0; l < floors; l++) for (let k = 0; k < count; k++) {
          const off = -len / 2 + (k + 1) * len / (count + 1);
          if (l === 0 && door && Math.abs(off - doorOffset) < 1.6) continue;
          const bottom = l * h / floors + Math.max(0.55, h / floors * 0.4), wh = Math.min(1.1, h / floors * 0.35);
          if (bottom + wh < h - 0.25) this.plan.openings.push({ id: wall.id + "_window_" + l + "_" + k, wall: wall.id, kind: "window", offset: off, width: Math.min(0.9, len / (count + 1) * 0.5), bottom, height: wh });
        }
      }
      const a = corners[s], b = corners[(s + 1) % 4];
      const masonry = options.material === "stone", frameMaterial = masonry ? "stone" : "wood", postWidth = masonry ? 0.38 : 0.3;
      for (let l = 0; l <= floors; l++) {
        const frameWidth = masonry ? 0.28 : 0.24, y = base2 + l * h / floors - (l === floors ? frameWidth / 2 + 0.025 : 0);
        const delta = [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[2] - a[2]), (b[2] - a[2]) / Math.hypot(b[0] - a[0], b[2] - a[2])];
        this.beam([a[0] + delta[0] * (postWidth / 2 - 0.01), y, a[2] + delta[1] * (postWidth / 2 - 0.01)], [b[0] - delta[0] * (postWidth / 2 - 0.01), y, b[2] - delta[1] * (postWidth / 2 - 0.01)], frameWidth, frameMaterial, "wall-frame", foundation);
      }
      this.beam(a, [a[0], base2 + h + (resolved === "shed" && a[0] > x === shedDirection > 0 ? rise : 0), a[2]], postWidth, frameMaterial, "corner-post", foundation);
      if (!options.open && (options.material ?? "plaster") !== "stone" && cfg.complexity > 0.25) {
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]), ux = (b[0] - a[0]) / len, uz = (b[2] - a[2]) / len, nx = uz, nz = -ux;
        const reach = Math.min(0.75, len * 0.18), y = base2 + h - 0.265;
        for (const side of [0, 1]) {
          const corner = side === 0 ? a : b, sign = side === 0 ? 1 : -1;
          this.beam([corner[0] + ux * sign * (postWidth / 2) + nx * 0.07, y - reach, corner[2] + uz * sign * (postWidth / 2) + nz * 0.07], [corner[0] + ux * sign * reach + nx * 0.07, y, corner[2] + uz * sign * reach + nz * 0.07], 0.13, "wood", "facade-brace", foundation, { start: [ux, 0, uz], end: [0, 1, 0] });
        }
      }
    }
    const roof = { id: id + "_roof", volume: id, x, z, width: w, depth: d, y: base2 + h, rise, ridgeRatio, shedDirection, eaves: cfg.eaves, kind: resolved, material: resolved === "thatch" ? "thatch" : "roof" };
    this.plan.roofs.push(roof);
    this.plan.supports.push({ component: roof.id, on: foundation });
    if (options.door !== false && !options.open) {
      const o = this.plan.openings.find((o2) => o2.wall === id + "_wall_0" && o2.kind === "door");
      if (base2 > 0.32) this.stairs([x + o.offset, 0, z - d / 2 - 1.9], [x + o.offset, base2, z - d / 2], 1.55);
    }
    return v;
  }
  chimney(v) {
    const x = v.x + v.width * 0.27, z = v.z + v.depth * 0.19, h = (this.plan.roofs.find((r) => r.volume === v.id)?.rise ?? v.width * (0.2 + this.context.config.roofPitch * 0.33)) + 0.9;
    const shaft = this.piece("box", [x, v.bottom + v.height + h / 2, z], [0.65, h, 0.65], "stone", "chimney", "volume_" + this.plan.volumes.indexOf(v) + "_roof");
    this.piece("box", [x, v.bottom + v.height + h - 0.9, z], [0.35, 0.03, 0.35], "dark", "chimney-recess", shaft);
    for (let tier = 0; tier < 3; tier++) {
      const heights = [0.13, 0.18, 0.655], tops = [0.08, -0.05, -0.23], height = heights[tier], yy = v.bottom + v.height + h + tops[tier] - height / 2;
      for (const side of [-1, 1]) {
        this.piece("box", [x + side * 0.169, yy, z], [0.012, height, 0.35], "stone", "chimney-lining-" + tier, shaft);
        this.piece("box", [x, yy, z + side * 0.169], [0.326, height, 0.012], "stone", "chimney-lining-" + tier, shaft);
      }
    }
    this.piece("box", [x, v.bottom + v.height + h, z], [0.82, 0.18, 0.82], "stone", "chimney-cap", "volume_" + this.plan.volumes.indexOf(v) + "_roof");
  }
  veranda(v) {
    const reach = 1.65, y = v.bottom + 0.12, z = v.z - v.depth / 2 - reach / 2, w = v.width * 0.72;
    const baseHeight = y - 0.1;
    const base2 = this.piece("box", [v.x, baseHeight / 2, z], [w - 0.12, baseHeight, reach - 0.06], "stone", "veranda-base");
    const floor = this.piece("box", [v.x, y, z], [w, 0.2, reach], "wood", "veranda", base2);
    const pitch = 0.17, slope = Math.tan(pitch), cos = Math.cos(pitch), coverY = y + 2.43;
    const rafterY = (zz) => coverY + slope * (zz - z) - (0.065 + 0.08) / cos - 0.01;
    const postZ = z - reach / 2 + 0.12, headerTop = rafterY(postZ) - 0.08 / cos, headerBottom = headerTop - 0.24;
    this.piece("box", [v.x, headerTop - 0.12, postZ], [w - 0.06, 0.24, 0.18], "wood", "veranda-header", floor);
    for (const side of [-1, 1]) {
      const x = v.x + side * (w / 2 - 0.12);
      this.beam(
        [x, y, postZ],
        [x, headerBottom, postZ],
        0.18,
        "wood",
        "veranda-post",
        floor,
        { start: [0, 1, 0], end: [0, 1, 0] }
      );
      const braceReach = Math.min(0.5, w * 0.15);
      this.beam(
        [x - side * 0.09, headerBottom - braceReach, postZ],
        [x - side * (0.09 + braceReach), headerBottom, postZ],
        0.1,
        "wood",
        "veranda-brace",
        floor,
        { start: [1, 0, 0], end: [0, 1, 0] }
      );
      const startZ = postZ - 0.09, endZ = z + reach / 2;
      this.beam(
        [x, rafterY(startZ), startZ],
        [x, rafterY(endZ), endZ],
        0.16,
        "wood",
        "veranda-rafter",
        floor,
        { start: [0, 0, 1], end: [0, 0, 1] }
      );
    }
    const coverMaterial = this.plan.roofs.find((r) => r.volume === v.id)?.material === "thatch" ? "thatch" : "roof";
    this.piece("box", [v.x, coverY, z], [w + 0.35, 0.13, reach + 0.2], coverMaterial, "porch-cover", floor, [-pitch, 0, 0]);
    const coverWidth = w + 0.35, coverDepth = reach + 0.2;
    const coverPoint = (xx, yy, zz) => [v.x + xx, coverY + cos * yy + Math.sin(pitch) * zz, z - Math.sin(pitch) * yy + cos * zz];
    for (const side of [-1, 1]) this.piece("box", coverPoint(side * (coverWidth / 2 + 0.07), -0.025, 0), [0.14, 0.18, coverDepth], "wood", "veranda-fascia", floor, [-pitch, 0, 0]);
    this.piece("box", coverPoint(0, -0.025, -coverDepth / 2 - 0.07), [coverWidth + 0.28, 0.18, 0.14], "wood", "veranda-fascia", floor, [-pitch, 0, 0]);
    this.stairs([v.x, 0, z - reach / 2 - 1], [v.x, y, z - reach / 2], 1.6);
  }
  fence(x, z, w, d) {
    const cs = [[x - w / 2, 0, z - d / 2], [x + w / 2, 0, z - d / 2], [x + w / 2, 0, z + d / 2], [x - w / 2, 0, z + d / 2]];
    for (let s = 0; s < 4; s++) {
      const a = cs[s], b = cs[(s + 1) % 4], n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 2);
      for (let i = 0; i <= n; i++) {
        const px = a[0] + (b[0] - a[0]) * i / n, pz = a[2] + (b[2] - a[2]) * i / n;
        this.beam([px, 0, pz], [px, 1.1, pz], 0.13, "wood", "fence-post");
      }
      for (const y of [0.45, 0.85]) this.beam([a[0], y, a[2]], [b[0], y, b[2]], 0.1, "wood", "fence-rail");
    }
  }
  finish() {
    for (const roof of this.plan.roofs) if (roof.material !== "cloth") dressRoof(this, roof);
    return resolveConnections(this.plan);
  }
};

// work/Pixel_Tree-main/src/structures/grammars/stoneLantern.ts
function stoneLantern(context) {
  const a = new Architect(context), c = context.config, u = c.height / 3.5, w = Math.min(c.width, c.depth);
  const stone = (at, size, role, on = "ground") => a.piece("box", at, size, "stone", role, on);
  const base2 = stone([0, 0.09 * u, 0], [1.38 * u, 0.18 * u, 1.38 * u], "stone-lantern-base");
  const step = stone([0, 0.26 * u, 0], [1.12 * u, 0.16 * u, 1.12 * u], "stone-lantern-base", base2);
  let support = stone([0, 0.41 * u, 0], [0.88 * u, 0.14 * u, 0.88 * u], "stone-lantern-foot", step);
  for (let course = 0; course < 4; course++) support = stone([0, (0.48 + (course + 0.5) * 0.28) * u, 0], [0.5 * u, 0.28 * u, 0.5 * u], "stone-lantern-pillar", support);
  const corbel = stone([0, 1.7 * u, 0], [0.93 * u, 0.2 * u, 0.93 * u], "stone-lantern-corbel", support);
  const shelf = stone([0, 1.91 * u, 0], [1.1 * u, 0.22 * u, 1.1 * u], "stone-lantern-shelf", corbel);
  const posts = [];
  for (const x of [-0.36, 0.36]) for (const z of [-0.36, 0.36]) posts.push(stone([x * u, 2.28 * u, z * u], [0.16 * u, 0.52 * u, 0.16 * u], "stone-lantern-corner", shelf));
  const cap = stone([0, 2.62 * u, 0], [0.94 * u, 0.16 * u, 0.94 * u], "stone-lantern-cap", posts[0]);
  a.depend(cap, posts, 2);
  const volume = "stone-lantern-chamber";
  a.plan.volumes.push({ id: volume, x: 0, z: 0, width: 0.94 * u, depth: 0.94 * u, bottom: 2.02 * u, height: 0.68 * u, floors: 1, role: "lantern" });
  const roof = { id: "stone-lantern-roof", volume, x: 0, z: 0, width: w, depth: w, y: 2.7 * u, rise: 0.55 * u, eaves: 0, kind: "hip", material: "stone", plainEdge: true };
  a.plan.roofs.push(roof);
  a.plan.supports.push({ component: roof.id, on: cap });
  for (const side of [-1, 1]) {
    a.beam([-w / 2, 2.76 * u, side * w / 2], [w / 2, 2.76 * u, side * w / 2], 0.16 * u, "wood", "stone-lantern-fascia", roof.id);
    a.beam([side * w / 2, 2.76 * u, -w / 2], [side * w / 2, 2.76 * u, w / 2], 0.16 * u, "wood", "stone-lantern-fascia", roof.id);
  }
  for (const x of [-w / 2, w / 2]) for (const z of [-w / 2, w / 2]) a.beam([x, 2.82 * u, z], [0, 3.37 * u, 0], 0.065 * u, "wood", "stone-lantern-roof-frame", roof.id);
  stone([0, 3.36 * u, 0], [0.24 * u, 0.22 * u, 0.24 * u], "stone-lantern-finial", roof.id);
  a.piece("box", [0, 2.25 * u, 0], [0.2 * u, 0.29 * u, 0.2 * u], "dark", "stone-lantern-light", shelf);
  for (const side of [-1, 1]) {
    a.piece("box", [0, 2.28 * u, side * 0.365 * u], [0.56 * u, 0.46 * u, 0.016 * u], "dark", "stone-lantern-glass", shelf);
    a.piece("box", [side * 0.365 * u, 2.28 * u, 0], [0.016 * u, 0.46 * u, 0.56 * u], "dark", "stone-lantern-glass", shelf);
  }
  return a.finish();
}

// work/Pixel_Tree-main/src/structures/geometry/stoneLantern.ts
import * as THREE from "three";
function buildStoneLanternPiece(piece) {
  if (!["stone-lantern-base", "stone-lantern-corbel"].includes(piece.role)) return;
  const taper = piece.role === "stone-lantern-corbel" ? 0.64 : 1;
  const geometry = new THREE.CylinderGeometry(piece.size[0] / 2, piece.size[0] / 2 * taper, piece.size[1], 8);
  geometry.rotateY(Math.PI / 8);
  geometry.scale(1, 1, piece.size[2] / piece.size[0]);
  geometry.translate(...piece.position);
  return geometry;
}
function stoneLanternGlassTexture() {
  const w = 12, h = 16, data = new Uint8Array(w * h * 4), colors = [[170, 110, 46], [217, 158, 67], [240, 189, 89], [255, 224, 136], [255, 242, 181]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = Math.min(x, w - 1 - x, y, h - 1 - y), centre = Math.abs(x - w / 2);
    const tone = edge < 1 ? 0 : centre < 2 && y > 3 && y < 13 ? 4 : x < 5 ? 3 : 2;
    data.set([...colors[tone], 255], (y * w + x) * 4);
  }
  const texture = new THREE.DataTexture(data, w, h);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// work/Pixel_Tree-main/src/structures/geometry/thatch.ts
import * as THREE3 from "three";

// work/Pixel_Tree-main/src/structures/geometry/common.ts
import * as THREE2 from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
function merge(parts) {
  const empty = parts.filter((g) => !g.attributes.position || g.attributes.position.count === 0);
  empty.forEach((g) => g.dispose());
  parts = parts.filter((g) => g.attributes.position?.count > 0);
  if (!parts.length) {
    const g = new THREE2.BufferGeometry();
    g.setAttribute("position", new THREE2.Float32BufferAttribute([], 3));
    g.setAttribute("normal", new THREE2.Float32BufferAttribute([], 3));
    g.setAttribute("uv", new THREE2.Float32BufferAttribute([], 2));
    return g;
  }
  const normalized = parts.map((g) => g.index ? g.toNonIndexed() : g);
  const result = mergeGeometries(normalized, false);
  for (let i = 0; i < parts.length; i++) {
    if (normalized[i] !== parts[i]) normalized[i].dispose();
    parts[i].dispose();
  }
  return result;
}

// work/Pixel_Tree-main/src/structures/geometry/thatch.ts
function buildThatchRoof(r, singleSlope = false, thicknessScale = 1) {
  const ratio = r.ridgeRatio ?? 0.5, ridge = r.x - r.width / 2 + r.width * ratio;
  const front = r.z - r.depth / 2 - r.eaves, back = r.z + r.depth / 2 + r.eaves;
  const count = Math.ceil((back - front) / 0.11), step = (back - front) / count;
  const parts = [];
  const hash2 = (i, j) => {
    const n = Math.sin(i * 127.1 + j * 311.7 + r.x * 17 + r.z * 23) * 43758.5453;
    return n - Math.floor(n);
  };
  for (const side of singleSlope ? [-1] : [-1, 1]) {
    const span = r.width * (side < 0 ? ratio : 1 - ratio), slope = r.rise / span;
    const edge = ridge + side * (span + r.eaves), low = r.y - slope * r.eaves;
    const normal = new THREE3.Vector3(side * slope, 1, 0).normalize();
    const point = (t, z) => [ridge + (edge - ridge) * t, r.y + r.rise + (low - r.y - r.rise) * t, z];
    for (let row = 0; row < 4; row++) for (let i = 0; i < count; i++) {
      const tuft = hash2(i, row + side * 11), upper = Math.max(0, row / 4 - 0.035);
      const lower = (row + 1) / 4 + (row === 3 ? 0.012 + tuft * 0.025 : (tuft - 0.25) * 0.025);
      const a = front + i * step, b = a + step;
      let points = [point(upper, a), point(lower, a), point(lower, b), point(upper, b)].map((p) => new THREE3.Vector3(...p));
      if (points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).y < 0) points.reverse();
      const thickness = (0.28 + (3 - row) * 0.045) * thicknessScale;
      const vertices = [...points, ...points.map((p) => p.clone().addScaledVector(normal, thickness))], positions = [], layers = [];
      if (row === 0 && !singleSlope) {
        const ridgeLift = thickness * Math.sqrt(1 + (r.rise / (r.width * Math.min(ratio, 1 - ratio))) ** 2);
        points.forEach((p, j) => {
          if (Math.abs(p.x - ridge) < 1e-8) vertices[j + 4].set(ridge, r.y + r.rise + ridgeLift, p.z);
        });
      }
      const progress = points.map((p) => ((p.x - ridge) / (edge - ridge) - upper) / (lower - upper));
      const tri = (a2, b2, c) => {
        for (const i2 of [a2, b2, c]) {
          positions.push(...vertices[i2].toArray());
          layers.push(progress[i2 % 4]);
        }
      };
      tri(0, 2, 1);
      tri(0, 3, 2);
      tri(4, 5, 6);
      tri(4, 6, 7);
      for (let j = 0; j < 4; j++) {
        const k = (j + 1) % 4;
        tri(j, k, k + 4);
        tri(j, k + 4, j + 4);
      }
      const g = new THREE3.BufferGeometry();
      g.setAttribute("position", new THREE3.Float32BufferAttribute(positions, 3));
      g.setAttribute("thatchLayer", new THREE3.Float32BufferAttribute(layers, 1));
      g.setAttribute("uv", new THREE3.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
      g.computeVertexNormals();
      parts.push(g);
    }
  }
  return merge(parts);
}

// work/Pixel_Tree-main/src/structures/geometry/roofs.ts
import * as THREE5 from "three";

// work/Pixel_Tree-main/src/structures/geometry/paintUV.ts
import * as THREE4 from "three";
function paintUV(geometry, grain, roofSurface = false) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  if (geometry.userData.preservePaintUV) return result;
  const positions = result.getAttribute("position");
  const uv = new Float32Array(positions.count * 2);
  const normal = new THREE4.Vector3(), point = new THREE4.Vector3(), along = new THREE4.Vector3(), across = new THREE4.Vector3(), a = new THREE4.Vector3(), b = new THREE4.Vector3(), c = new THREE4.Vector3();
  for (let start = 0; start < positions.count; start += 3) {
    a.fromBufferAttribute(positions, start);
    b.fromBufferAttribute(positions, start + 1);
    c.fromBufferAttribute(positions, start + 2);
    normal.crossVectors(b.sub(a), c.sub(a)).normalize();
    along.copy(grain ?? new THREE4.Vector3(0, 1, 0));
    along.addScaledVector(normal, -along.dot(normal));
    if (roofSurface && normal.y > 0.5 && along.lengthSq() < 1e-3) along.set(1, 0, 0).addScaledVector(normal, -normal.x);
    if (along.lengthSq() < 1e-3) along.set(0, 0, 1).addScaledVector(normal, -normal.z);
    if (along.lengthSq() < 1e-3) along.set(1, 0, 0).addScaledVector(normal, -normal.x);
    along.normalize();
    across.crossVectors(along, normal).normalize();
    for (let i = start; i < start + 3; i++) {
      point.fromBufferAttribute(positions, i);
      uv[i * 2] = point.dot(across);
      uv[i * 2 + 1] = point.dot(along);
    }
  }
  result.setAttribute("uv", new THREE4.BufferAttribute(uv, 2));
  return result;
}

// work/Pixel_Tree-main/src/structures/geometry/roofs.ts
var edgeKey = (a, b) => [a.map((v) => v.toFixed(5)).join(","), b.map((v) => v.toFixed(5)).join(",")].sort().join("|");
function slab(points, exposed, lift) {
  const unique = points.filter((p, i) => i === 0 || new THREE5.Vector3(...p).distanceToSquared(new THREE5.Vector3(...points[i - 1])) > 1e-10);
  if (unique.length > 2 && new THREE5.Vector3(...unique[0]).distanceToSquared(new THREE5.Vector3(...unique.at(-1))) < 1e-10) unique.pop();
  const vectors = unique.map((p) => new THREE5.Vector3(...p));
  let normal = vectors[1].clone().sub(vectors[0]).cross(vectors[2].clone().sub(vectors[0])).normalize();
  if (normal.y < 0) {
    unique.reverse();
    vectors.reverse();
    normal.negate();
  }
  const n = unique.length, vertices = [...vectors, ...vectors.map((p) => lift === void 0 ? p.clone().addScaledVector(normal, 0.12) : p.clone().add(new THREE5.Vector3(0, lift, 0)))], positions = [];
  const tri = (i, j, k) => {
    const a = vertices[i], b = vertices[j], c = vertices[k];
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() > 1e-16) positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  };
  for (let i = 1; i < n - 1; i++) {
    tri(0, i + 1, i);
    tri(n, n + i, n + i + 1);
  }
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    if (exposed && !exposed.has(edgeKey(unique[i], unique[next]))) continue;
    tri(i, next, n + next);
    tri(i, n + next, n + i);
  }
  const g = new THREE5.BufferGeometry();
  g.setAttribute("position", new THREE5.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE5.Float32BufferAttribute(Array(positions.length / 3 * 2).fill(0), 2));
  g.computeVertexNormals();
  return g;
}
function brokenFacet(points, damage, id, lift) {
  if (damage <= 0.08) return slab(points, void 0, lift);
  const triangles = points.length === 3 ? [points] : [[points[0], points[1], points[2]], [points[0], points[2], points[3]]];
  const kept = [];
  let phase = 0;
  for (const letter of id) phase += letter.charCodeAt(0) * 0.07;
  const cuts = 5;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map((p) => new THREE5.Vector3(...p));
    const point = (i, j) => a.clone().addScaledVector(b.clone().sub(a), i / cuts).addScaledVector(c.clone().sub(a), j / cuts).toArray();
    const emit = (t) => {
      const center = new THREE5.Vector3();
      t.forEach((p) => center.add(new THREE5.Vector3(...p)));
      center.divideScalar(3);
      const field = (Math.sin(center.x * 1.2 + phase) + Math.cos(center.z * 0.9 - phase) + 2) / 4;
      if (field > damage * 0.95) kept.push(t);
    };
    for (let i = 0; i < cuts; i++) for (let j = 0; j < cuts - i; j++) {
      emit([point(i, j), point(i + 1, j), point(i, j + 1)]);
      if (j < cuts - i - 1) emit([point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]);
    }
  }
  const counts = /* @__PURE__ */ new Map();
  for (const t of kept) for (let i = 0; i < 3; i++) {
    const key = edgeKey(t[i], t[(i + 1) % 3]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const exposed = new Set([...counts].filter(([, count]) => count === 1).map(([key]) => key));
  return kept.length ? merge(kept.map((t) => slab(t, exposed, lift))) : new THREE5.BufferGeometry().setAttribute("position", new THREE5.Float32BufferAttribute([], 3));
}
function buildRoof(r) {
  if (r.rotationY) {
    const g = buildRoof({ ...r, rotationY: void 0 });
    g.translate(-r.x, 0, -r.z);
    g.rotateY(r.rotationY);
    g.translate(r.x, 0, r.z);
    return g;
  }
  if (r.kind === "flat" && r.accessHole && (r.damage ?? 0) <= 0.08) {
    const h = r.accessHole, shape = new THREE5.Shape(), hole = new THREE5.Path();
    const rectangle = (path, x2, z2, w2, d2) => {
      path.moveTo(x2 - w2 / 2, z2 - d2 / 2);
      path.lineTo(x2 + w2 / 2, z2 - d2 / 2);
      path.lineTo(x2 + w2 / 2, z2 + d2 / 2);
      path.lineTo(x2 - w2 / 2, z2 + d2 / 2);
      path.closePath();
    };
    rectangle(shape, r.x, r.z, r.width + 2 * r.eaves, r.depth + 2 * r.eaves);
    rectangle(hole, h.x, h.z, h.width, h.depth);
    shape.holes.push(hole);
    const g = new THREE5.ExtrudeGeometry(shape, { depth: r.flatThickness ?? 0.12, bevelEnabled: false, steps: 1 });
    g.rotateX(Math.PI / 2);
    g.translate(0, r.y + (r.flatThickness ?? 0.12), 0);
    return paintUV(g);
  }
  if (r.kind === "thatch" && (r.damage ?? 0) <= 0.08) return paintUV(buildThatchRoof(r));
  const { x, z, y, rise, eaves: e } = r, w = r.width / 2, d = r.depth / 2, left = x - w - e, right = x + w + e, front = z - d - e, back = z + d + e, low = y - rise * e / Math.max(w, 0.1);
  let facets;
  if (r.kind === "flat") facets = [[[left, y, front], [right, y, front], [right, y, back], [left, y, back]]];
  else if (r.kind === "shed") {
    const direction = r.shedDirection ?? 1, axis = r.shedAxis ?? 0;
    const height = (px, pz) => y + rise * (0.5 + direction * (axis === 0 ? (px - x) / (2 * w) : (pz - z) / (2 * d)));
    facets = [[[left, height(left, front), front], [right, height(right, front), front], [right, height(right, back), back], [left, height(left, back), back]]];
  } else if (r.kind === "hip") {
    const hipLow = y - rise * e / Math.min(w, d);
    if (d >= w) {
      const rf = z - (d - w), rb = z + (d - w);
      facets = [[[left, hipLow, front], [x, y + rise, rf], [x, y + rise, rb], [left, hipLow, back]], [[x, y + rise, rf], [right, hipLow, front], [right, hipLow, back], [x, y + rise, rb]], [[left, hipLow, front], [right, hipLow, front], [x, y + rise, rf]], [[right, hipLow, back], [left, hipLow, back], [x, y + rise, rb]]];
    } else {
      const rl = x - (w - d), rr = x + (w - d);
      facets = [[[left, hipLow, front], [right, hipLow, front], [rr, y + rise, z], [rl, y + rise, z]], [[right, hipLow, back], [left, hipLow, back], [rl, y + rise, z], [rr, y + rise, z]], [[left, hipLow, back], [left, hipLow, front], [rl, y + rise, z]], [[right, hipLow, front], [right, hipLow, back], [rr, y + rise, z]]];
    }
    facets = facets.map((points) => points.filter((p, i) => !points.slice(0, i).some((other) => p.every((v, j) => v === other[j]))));
  } else {
    const ratio = r.ridgeRatio ?? 0.5, ridge = x - w + r.width * ratio, leftY = y - rise * e / (r.width * ratio), rightY = y - rise * e / (r.width * (1 - ratio));
    facets = [[[left, leftY, front], [ridge, y + rise, front], [ridge, y + rise, back], [left, leftY, back]], [[ridge, y + rise, front], [right, rightY, front], [right, rightY, back], [ridge, y + rise, back]]];
  }
  return paintUV(merge(facets.map((points, i) => brokenFacet(points, r.damage ?? 0, r.id + "_" + i, r.kind === "hip" ? 0.12 * Math.sqrt(1 + (rise / Math.min(w, d)) ** 2) : r.kind === "flat" ? r.flatThickness : void 0))));
}

// work/Pixel_Tree-main/src/structures/geometry/beams.ts
import * as THREE6 from "three";
function buildBeam(start, end, section, jointCuts = 0, cuts, faceHeight = section) {
  const a = new THREE6.Vector3(...start), span = new THREE6.Vector3(...end).sub(a), length = Math.max(1e-3, span.length() - jointCuts * 2), axis = span.clone().normalize();
  const g = new THREE6.BoxGeometry(faceHeight, length, section, 1, 2, 1), positions = g.attributes.position;
  const rotation = new THREE6.Quaternion().setFromUnitVectors(new THREE6.Vector3(0, 1, 0), axis);
  if (cuts) {
    for (let i = 0; i < positions.count; i++) {
      const fraction = positions.getY(i) / length + 0.5;
      const offset = new THREE6.Vector3(positions.getX(i), 0, positions.getZ(i)).applyQuaternion(rotation);
      const point = a.clone().addScaledVector(span, fraction).add(offset);
      if (fraction < 1e-3 || fraction > 0.999) {
        const normal = new THREE6.Vector3(...fraction < 1e-3 ? cuts.start : cuts.end);
        point.addScaledVector(axis, -normal.dot(offset) / normal.dot(axis));
      }
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    g.computeVertexNormals();
  } else {
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i) / length + 0.5;
      positions.setX(i, positions.getX(i) * (1 - 0.035 * Math.sin(y * Math.PI)));
    }
    g.applyQuaternion(rotation);
    g.translate(a.x + span.x / 2, a.y + span.y / 2, a.z + span.z / 2);
  }
  return g;
}

// work/Pixel_Tree-main/src/structures/materials.ts
import * as THREE11 from "three";

// work/Pixel_Tree-main/src/services/mossStyle.ts
function pixelMossNoiseGLSL(seedUniform) {
  return (
    /* glsl */
    `
    float mhash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
    float mnoise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(mhash3(i), mhash3(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(mhash3(i + vec3(0.0, 1.0, 0.0)), mhash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(mhash3(i + vec3(0.0, 0.0, 1.0)), mhash3(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(mhash3(i + vec3(0.0, 1.0, 1.0)), mhash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
    }
    float mossField(vec3 p) {
      return mnoise3(p / 8.0 + ${seedUniform}) * 0.75
        + mnoise3(p / 3.0 + 17.0 + ${seedUniform}) * 0.25;
    }
  `
  );
}

// work/Pixel_Tree-main/src/services/pixelArtTextureSystem.ts
import * as THREE7 from "three";
var SPECIES_DEFAULTS = {
  hyrule_oak: { clusterSize: 5, gaps: 0.34, hueCold: 34, hueWarm: -22 },
  korok_ancient: { clusterSize: 5.6, gaps: 0.3, contrast: 0.56, hueCold: 40, hueWarm: -18 },
  satori_sakura: { clusterSize: 4.2, gaps: 0.38, accent: 0.55, hueCold: 22, hueWarm: -12 },
  akkala_birch: { clusterSize: 4, gaps: 0.44, contrast: 0.54, hueCold: 30, hueWarm: -26 },
  hebra_pine: { clusterSize: 3.4, irregularity: 0.72, gaps: 0.26, shadow: 0.62, hueCold: 44, hueWarm: -14 },
  faron_palm: { clusterSize: 4.6, gaps: 0.22, hueCold: 26, hueWarm: -24 },
  swamp_mangrove: { clusterSize: 5.2, irregularity: 0.62, gaps: 0.3, shadow: 0.64, hueCold: 46, hueWarm: -16 },
  gerudo_cactus: { clusterSize: 6, gaps: 0.14, hueCold: 24, hueWarm: -20 },
  dry_withered: { clusterSize: 5, gaps: 0.5, contrast: 0.6, shadow: 0.68, highlights: 0.4, hueCold: 18, hueWarm: -10 },
  savanna_acacia: { clusterSize: 3.2, irregularity: 0.6, gaps: 0.42, hueCold: 20, hueWarm: -30 },
  // autumn maples: a softer hue shift, so the reds and golds stay warm
  maple_red: { clusterSize: 4.6, gaps: 0.3, accent: 0.3, hueCold: 14, hueWarm: -8 },
  maple_orange: { clusterSize: 4.6, gaps: 0.3, accent: 0.3, hueCold: 14, hueWarm: -8 },
  maple_yellow: { clusterSize: 4.6, gaps: 0.3, accent: 0.3, hueCold: 16, hueWarm: -10 },
  arctic_willow: { clusterSize: 2.4, irregularity: 0.6, gaps: 0.24, hueCold: 30, hueWarm: -16 },
  // bushes: smaller leaves, so the crown reads as a bush and not a shrunk tree
  hyrule_shrub: { clusterSize: 3.4, gaps: 0.28, hueCold: 34, hueWarm: -22 },
  berry_shrub: { clusterSize: 3.2, gaps: 0.26, hueCold: 38, hueWarm: -18 },
  flowering_shrub: { clusterSize: 3.4, gaps: 0.3, hueCold: 30, hueWarm: -20 },
  desert_shrub: { clusterSize: 2.6, irregularity: 0.65, gaps: 0.46, contrast: 0.45, hueCold: 18, hueWarm: -26 },
  // one bush per biome: that biome's tree's leaf character, at bush scale
  satori_shrub: { clusterSize: 3.2, gaps: 0.32, accent: 0.55, hueCold: 22, hueWarm: -12 },
  akkala_shrub: { clusterSize: 3.2, gaps: 0.34, contrast: 0.54, hueCold: 30, hueWarm: -26 },
  hebra_shrub: { clusterSize: 2.8, irregularity: 0.7, gaps: 0.26, shadow: 0.6, hueCold: 44, hueWarm: -14 },
  faron_shrub: { clusterSize: 4, gaps: 0.22, hueCold: 26, hueWarm: -24 },
  korok_shrub: { clusterSize: 3.6, gaps: 0.26, contrast: 0.56, hueCold: 40, hueWarm: -18 },
  swamp_shrub: { clusterSize: 3.4, irregularity: 0.62, gaps: 0.3, shadow: 0.64, hueCold: 46, hueWarm: -16 },
  savanna_shrub: { clusterSize: 2.6, irregularity: 0.6, gaps: 0.42, hueCold: 20, hueWarm: -30 },
  withered_shrub: { clusterSize: 5, gaps: 0.5, contrast: 0.6, shadow: 0.68, highlights: 0.4, hueCold: 18, hueWarm: -10 }
};
var BASE_DEFAULTS = {
  clusterSize: 5,
  irregularity: 0.55,
  gaps: 0.34,
  barkVariation: 0,
  contrast: 0.5,
  shadow: 0.55,
  highlights: 0.5,
  accent: 0.25,
  hueCold: 34,
  hueWarm: -22
};
function speciesKey(species) {
  return species.replace(/_sapling$|_fallen$/, "").replace(/_snowy$/, "");
}
function speciesDefaults(species) {
  return { ...BASE_DEFAULTS, ...SPECIES_DEFAULTS[speciesKey(species)] ?? {} };
}
var BARK_PATTERN_BY_STYLE = {
  oak: "lobed",
  birch: "papery",
  pine: "plated",
  ancient: "lobed",
  swamp: "lobed",
  deadwood: "grain",
  cactus: "flat"
};
var PIXEL_SIZE_TABLE = [
  { tile: 64, barkW: 64, barkH: 86, woodTexelsPerMetre: 13 },
  { tile: 54, barkW: 48, barkH: 64, woodTexelsPerMetre: 10 },
  { tile: 44, barkW: 40, barkH: 54, woodTexelsPerMetre: 8 },
  { tile: 34, barkW: 32, barkH: 44, woodTexelsPerMetre: 6 },
  { tile: 26, barkW: 24, barkH: 32, woodTexelsPerMetre: 4.5 }
];
function resolvePixelTextureParams(config) {
  const d = speciesDefaults(config.species);
  const sizeIdx = Math.max(0, Math.min(4, Math.round((config.pixelSize ?? 1) - 1)));
  const size = PIXEL_SIZE_TABLE[sizeIdx];
  const tileRes = size.tile;
  const clusterSizeBase = config.leafClusterSize ?? d.clusterSize;
  const clusterSize = clusterSizeBase * (tileRes / 44);
  return {
    enabled: config.pixelTextureEnabled !== false,
    seed: Math.floor(config.textureSeed ?? config.seed ?? 1234),
    pixelSize: sizeIdx + 1,
    clusterSizeBase,
    tileRes,
    barkWidth: size.barkW,
    barkHeight: size.barkH,
    steps: Math.max(4, Math.min(9, Math.round(config.paletteSteps ?? 6))),
    detail: clamp01(config.detailDensity ?? 0.5),
    contrast: clamp01(config.textureContrast ?? d.contrast),
    shadow: clamp01(config.shadowStrength ?? d.shadow),
    highlights: clamp01(config.highlightAmount ?? d.highlights),
    clusterSize: Math.max(2, clusterSize),
    irregularity: clamp01(config.leafClusterIrregularity ?? d.irregularity),
    gaps: clamp01(config.canopyGapAmount ?? d.gaps),
    barkVariation: clamp01(config.barkVariation ?? d.barkVariation),
    barkPattern: config.barkPattern ?? BARK_PATTERN_BY_STYLE[config.barkStyle] ?? "furrowed",
    barkTexelsPerMetre: size.woodTexelsPerMetre,
    // a wider lobe needs more texels across it; barkVariation narrows them
    // Must be an INTEGER: a fractional count makes the bands across a lobe
    // unequal in width, which shows up as a checkerboard on the flared base.
    barkTexelsPerLobe: Math.max(4, Math.min(7, Math.round(7 - clamp01(config.barkVariation ?? d.barkVariation) * 3))),
    accent: clamp01(config.textureAccentAmount ?? d.accent),
    lightAzimuth: config.textureLightAzimuth ?? 135,
    lightElevation: config.textureLightElevation ?? 55,
    // Wood UVs are (angle, arcLength * 0.4). This keeps the bark texels roughly
    // square on a trunk of ~1.1 m radius; see barkVScaleFor().
    barkVScale: config.barkTexelScale ?? barkVScaleFor(size.barkW, size.barkH)
  };
}
function barkVScaleFor(w, h) {
  const referenceCircumference = 7;
  return 2.5 * w / (referenceCircumference * h);
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function pixelTextureLightDir(params) {
  const az = params.lightAzimuth * Math.PI / 180;
  const el = params.lightElevation * Math.PI / 180;
  return new THREE7.Vector3(
    Math.cos(az) * Math.cos(el),
    Math.sin(el),
    Math.sin(az) * Math.cos(el)
  ).normalize();
}
function smoothStepT(t) {
  return t * t * (3 - 2 * t);
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0
  ];
}
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  let s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  h = (h % 360 + 360) % 360 / 360;
  s = clamp01(s);
  l = clamp01(l);
  if (s < 1e-6) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
}
function buildFoliageRamp(darkHex, lightHex, steps, opts) {
  const hueCold = opts.hueCold ?? 34;
  const hueWarm = opts.hueWarm ?? -22;
  const contrast = opts.contrast ?? 0.5;
  const shadow = opts.shadow ?? 0.5;
  const satBoost = opts.satBoost ?? 1;
  const dark = rgbToHsl(...hexToRgb(darkHex));
  const light = rgbToHsl(...hexToRgb(lightHex));
  const lLow = Math.max(0.075, Math.min(0.24, dark[2] * (0.58 - shadow * 0.16)));
  const lHigh = Math.max(0.6, Math.min(0.74, light[2] + 0.09 + contrast * 0.06));
  const hMid = light[0] + (dark[0] - light[0]) * 0.5;
  const sMid = Math.max(0.5, (dark[1] + light[1]) * 0.5);
  const out = [];
  const n = Math.max(3, steps | 0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tc = t + (smoothStepT(t) - t) * (0.2 + contrast * 0.3);
    const l = lLow + (lHigh - lLow) * tc;
    const h = hMid + (1 - tc) * hueCold + tc * hueWarm;
    const s = Math.min(1, sMid * satBoost * (1.02 + 0.26 * Math.abs(tc - 0.5) * 2));
    out.push(hslToRgb(h, s, l));
  }
  return out;
}
var PALETTE_ROW_MAIN = 0.75;
var PALETTE_ROW_ACCENT = 0.25;
function buildPixelMossRamp(steps, lightHex = "#7ba33a") {
  return buildFoliageRamp("#2c3f16", lightHex, steps, {
    hueCold: 26,
    hueWarm: -8,
    contrast: 0.4,
    shadow: 0.5,
    satBoost: 0.82
  });
}
var SNOW_GLSL = (
  /* glsl */
  `
  vec3 snowRamp(float i) {
    if (i < 0.5) return vec3(0.435, 0.529, 0.690);   // #6f87b0 deep shade
    if (i < 1.5) return vec3(0.643, 0.737, 0.859);   // #a4bcdb shade
    if (i < 2.5) return vec3(0.851, 0.906, 0.965);   // #d9e7f6 lit
    return vec3(0.973, 0.988, 1.0);                  // #f8fcff sunlit
  }
  float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`
);
var PIXEL_LEAF_FRAGMENT_SHADER = (
  /* glsl */
  `
  uniform sampler2D uStruct;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform float uAlphaTest;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uAccentAmount;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;
  uniform float uSnow;
  ${SNOW_GLSL}

  varying vec2 vAtlasUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vShade;
  varying float vHueShift;
  varying float vCrownDepth;
  varying float vCardNdl;
  varying float vNeighbor;

  void main() {
    vec4 s = texture2D(uStruct, vAtlasUv);
    if (s.a < uAlphaTest) discard;

    float N1 = uPaletteSteps - 1.0;
    float idx = floor(s.r * N1 + 0.5);   // the tone painted into the tile
    float exposure = s.b;                // texel-quantised, so bands stay crisp
    float clumpH = s.g;

    float heightN = clamp(
      (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY), 0.0, 1.0);

    // Geometry-driven tone, deliberately zero-centred: the tile's own hierarchy
    // survives and the shader only pushes it up or down a whole step at a time.
    float tone =
        vCardNdl * (0.65 + 0.15 * exposure)
      + (heightN - 0.50) * 0.65
      - vCrownDepth * (0.30 + uShadowStrength * 0.45)
      - vNeighbor * (0.12 + uShadowStrength * 0.20)
      + (vShade - 0.50) * 0.30
      + (exposure - 0.55) * 0.75
      + vHueShift * 0.45
      - uShadowStrength * 0.15;

    // Jitter the quantisation threshold with the clump hash: the light
    // terminator breaks along leaf-cluster borders instead of sweeping a
    // mathematically smooth curve across the canopy.
    tone += (clumpH - 0.5) * 0.55;

    float off = floor(tone * (0.85 + uTextureContrast * 0.75) + 0.5);
    off = clamp(off, -3.0, 3.0);
    idx = clamp(idx + off, 0.0, N1);

    // painted sparks keep their place at the top of the ramp
    if (clumpH > 0.975 && uHighlightAmount > 0.02) idx = max(idx, N1 - 1.0);

    float row = (clumpH < uAccentAmount * 0.20) ? ${PALETTE_ROW_ACCENT} : ${PALETTE_ROW_MAIN};
    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;

    // Snow settles on the top of the crown's outer leaves (the Hebra bush):
    // ragged along the leaf clusters, never inside the crown.
    if (uSnow > 0.001) {
      float sf = vNormal.y + (clumpH - 0.5) * 0.6 - vCrownDepth * 0.8 - (1.0 - uSnow) * 0.9;
      if (sf > 0.3) {
        float si = 2.0 + (vCardNdl > 0.2 ? 1.0 : 0.0) - (sf < 0.45 ? 1.0 : 0.0);
        col = snowRamp(si);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`
);
var PIXEL_CONIFER_FRAGMENT_SHADER = (
  /* glsl */
  `
  uniform sampler2D uStruct;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform float uAlphaTest;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uAccentAmount;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;
  uniform float uSnow;
  uniform float uTileTexels;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vCrownDepth;
  varying float vShade;
  ${SNOW_GLSL}

  // Snow lying along one spray, for a texel of its atlas cell (x across,
  // y from the root at 0 to the tip at uTileTexels): a drift heaped along the
  // spray's spine, thinning toward the tip so the needle ends stay green,
  // with a ragged per-texel edge.
  float snowField(vec2 t) {
    vec2 c = (t + 0.5) / uTileTexels;
    float spine = 1.0 - abs(c.x - 0.5) * 2.1;
    float along = 1.0 - smoothstep(0.62, 0.95, c.y);
    return spine * along + (snowHash(t + vShade * 61.0) - 0.5) * 0.3;
  }

  void main() {
    vec4 s = texture2D(uStruct, vUv);
    if (s.a < uAlphaTest) discard;

    float N1 = uPaletteSteps - 1.0;
    float idx = floor(s.r * N1 + 0.5);   // tone painted into the tile
    float exposure = s.b;
    float clumpH = s.g;

    // one flat normal per spray: the whole spray steps together
    vec3 n = normalize(vNormal);
    // Needle sprays transmit light on both sides, independently of the camera.
    float ndl = abs(dot(n, normalize(uTexLightDir))) * 0.65;

    float heightN = clamp(
      (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY), 0.0, 1.0);

    float tone =
        ndl * 1.35
      + (heightN - 0.45) * 0.80
      - vCrownDepth * (0.55 + uShadowStrength * 0.85)
      + (vShade - 0.5) * 0.70
      + (exposure - 0.55) * 0.75
      + (clumpH - 0.5) * 0.45;

    float off = floor(tone * (0.85 + uTextureContrast * 0.75) + 0.5);
    off = clamp(off, -3.0, 3.0);
    idx = clamp(idx + off, 0.0, N1);
    if (clumpH > 0.975 && uHighlightAmount > 0.02 && ndl > 0.2) idx = max(idx, N1 - 1.0);

    float row = (clumpH < uAccentAmount * 0.20) ? ${PALETTE_ROW_ACCENT} : ${PALETTE_ROW_MAIN};
    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;

    // Snow rests on the TOP of each spray only - seen from below, the needles
    // stay green - and less of it reaches the tufts deep inside a tier.
    if (uSnow > 0.001 && n.y > 0.05) {
      vec2 t = floor(fract(vUv * vec2(4.0, 2.0)) * uTileTexels);
      float thr = 1.0 - uSnow * (1.0 - vCrownDepth * 0.5);
      float f = snowField(t) + (clumpH - 0.5) * 0.25;
      if (f > thr) {
        // a lit top and a shaded lower rim where the drift ends, so it reads
        // as a heap with thickness rather than white paint
        float rim = (snowField(t + vec2(0.0, 1.0)) < thr
                  || snowField(t + vec2(1.0, 0.0)) < thr
                  || snowField(t - vec2(1.0, 0.0)) < thr) ? 1.0 : 0.0;
        float si = 2.0 + (ndl > 0.25 ? 1.0 : 0.0) - vCrownDepth * 1.6 - rim + (heightN > 0.6 ? 0.5 : 0.0);
        col = snowRamp(floor(clamp(si, 0.0, 3.0) + 0.5));
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`
);
var PIXEL_BARK_FRAGMENT_SHADER = (
  /* glsl */
  `
  uniform sampler2D uStruct;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uMossAmount;
  uniform float uRootY;
  uniform float uTreeHeight;
  uniform float uRootSpread;
  uniform float uBarkVariation;
  uniform float uTextureSeed;
  // Analytic lobed bark: texels sized in metres instead of in UV space.
  uniform float uLobedMode;        // 1 = draw the lobes analytically
  uniform float uPlatedMode;       // 1 = break the lobes into staggered pine plates
  uniform float uTexelsPerMetre;   // apparent pixel size, in texels per metre
  uniform float uTexelsPerLobe;    // how many texels across one lobe
  uniform float uForcedLobes;      // >0 pins the ridge count (modelled ribs)
  uniform float uBarkDarkCoverage;
  uniform float uLitSign;
  // Shade cast by a dense crown on the wood inside it (0 = off). Set for the
  // pine, whose trunk and limbs run up through the middle of its needles
  // (a cone), and for the full broadleaf crowns (uCrownEllipsoid = 1: a
  // rounded mass centred at uCrownCenterY, uCrownRadius wide, uCrownRadiusY
  // tall).
  uniform float uCrownShade;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;
  uniform float uCrownRadius;
  uniform float uCrownEllipsoid;
  uniform float uCrownCenterY;
  uniform float uCrownRadiusY;
  // Snow lying on the upward-facing wood (0 = off): root flare, branch tops.
  uniform float uSnow;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vBarkUv;
  varying vec3 vWood;
  varying vec2 vBarkAngle;
  varying float vAngleU;

  float bhash(float n) { return fract(sin(n * 12.9898) * 43758.5453123); }
  float bhash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  ${SNOW_GLSL}

  // Smooth value noise, for the moss: sampled only at texel centres, so its
  // blobs come out as clusters of whole texels with ragged pixel edges.
  ${pixelMossNoiseGLSL("uTextureSeed")}

  void main() {
    float N1 = uPaletteSteps - 1.0;
    float qs = N1 / 5.0;

    float idx;
    float plateH;
    float crevice;
    float hiMask;
    // texel cell for the snow edge; the lobed path swaps in its metre grid
    vec2 snowTexel = floor(vBarkUv * vec2(48.0, 64.0));
    // Where this texel sits for the moss noise, and which way is "up the
    // wood" in that space (one texel). The lobed path wraps the texel grid
    // onto a circle so the noise runs on unbroken across the seam at angle 0.
    vec3 mossP = vec3(snowTexel, 0.0);
    vec3 mossUp = vec3(0.0, 1.0, 0.0);
    // 1 down in a furrow .. 0 on a ridge's crest: moss fills the furrows first
    float mossGroove = 0.5;

    if (uLobedMode > 0.5 && vWood.z > 0.001) {
      // ----------------------------------------------------------------------
      // Two things have to hold at once here, and they pull against each other:
      //
      //  * the RIDGES must run unbroken from root to tip. Their count therefore
      //    comes from vWood.z, one representative radius for the whole branch.
      //    Deriving it from each ring's own radius makes the count step as the
      //    wood tapers, and every step re-phases the pattern, so the ridges
      //    break and jump sideways - each stretch of trunk looking unrelated to
      //    the next. With a fixed count they just narrow as the wood narrows.
      //
      //  * the TEXELS must stay the same size. That grid is therefore built
      //    separately, in metres, from this ring's actual radius, and rounded
      //    to a whole number of texels around so it still closes with no seam.
      //
      // Decoupling them is what lets the ridges be continuous AND the pixels
      // uniform; tying the texel grid to the lobe count forces a choice.
      // ----------------------------------------------------------------------
      float r = max(0.02, vWood.x);
      float along = vWood.y;
      float rChain = vWood.z;
      float lobesPerMetre = uTexelsPerMetre / max(1.0, uTexelsPerLobe);
      // Linear in the radius, so a ridge is the same width in METRES on every
      // piece of wood: trunk, bough, stilt root. Anything sub-linear makes the
      // ridges of a thin part visibly finer than a thick one, and the tree
      // stops looking like it is made of one material. The count only stays
      // usable at this law because the radius handed in is weighted by surface
      // area rather than plainly averaged.
      float lobes = floor(6.2831853 * rChain * lobesPerMetre + 0.5);
      // A mesh whose ridges are already modelled in the geometry (a cactus and
      // its botanical ribs) pins the count, so the painted ridges sit on the
      // real ones instead of beating against them.
      if (uForcedLobes > 0.5) lobes = uForcedLobes;

      // Never fewer than a couple, never more than the texel budget can show:
      // a ridge narrower than about three texels has no room for a crest and
      // two seams, so on very thin wood the count gives way to the budget.
      //
      // The budget MUST come from the chain's radius, not from this ring's. Ring
      // radius changes along the wood, so a budget computed from it re-clamps
      // the count partway up the trunk, and every change of count re-phases the
      // ridges - which is the very misalignment this whole path exists to avoid.
      float texelsAroundChain = max(4.0, floor(6.2831853 * rChain * uTexelsPerMetre + 0.5));
      lobes = clamp(lobes, 2.0, min(16.0, max(2.0, floor(texelsAroundChain / 3.0))));

      // texel grid in metres from the ACTUAL ring radius, closed to a whole
      // number of texels around: this is what keeps the pixels a constant size
      float texelsAround = max(4.0, floor(6.2831853 * r * uTexelsPerMetre + 0.5));

      // slow, smooth drift so the lobes are not perfectly straight columns
      float aw = along * 0.55;
      float i0 = floor(aw);
      float f0 = fract(aw);
      float w0 = bhash(i0 + uTextureSeed * 1.7);
      float w1 = bhash(i0 + 1.0 + uTextureSeed * 1.7);
      float wander = mix(w0, w1, f0 * f0 * (3.0 - 2.0 * f0)) - 0.5;

      // Reconstruct the azimuth from the interpolated (cos, sin) when the mesh
      // supplies it. Interpolating the angle itself breaks on any triangle that
      // straddles the 0/1 wrap.
      float angleU = vAngleU;
      if (dot(vBarkAngle, vBarkAngle) > 0.01) {
        angleU = atan(vBarkAngle.y, vBarkAngle.x) * 0.15915494 + 0.5;
      }

      float lobeF = angleU * lobes + wander * 0.7;
      float li = floor(lobeF);
      float t = fract(lobeF);

      float texelsPerLobeHere = max(2.0, texelsAround / lobes);
      float texU = floor(angleU * texelsAround);
      float texV = floor(along * uTexelsPerMetre);
      snowTexel = vec2(texU, texV);
      float mossA = 6.2831853 * (texU + 0.5) / texelsAround;
      float mossR = texelsAround / 6.2831853;
      mossP = vec3(cos(mossA) * mossR, sin(mossA) * mossR, texV);
      mossUp = vec3(0.0, 0.0, 1.0);
      // snap across-lobe onto that grid, so the shading steps in hard pixels
      float tq = (floor(t * texelsPerLobeHere) + 0.5) / texelsPerLobeHere;

      float lobeId = mod(li, lobes);
      float lh = bhash(lobeId * 7.13 + uTextureSeed);

      // narrow lit crest, offset toward the light, falling away steeply
      float lh2 = bhash(lobeId * 3.91 + uTextureSeed + 11.0);
      // crest and seam width both vary per lobe: identical lobes all round the
      // trunk read as machine corrugation, not as wood
      float crest = 0.5 + (lh - 0.5) * 0.44 + uLitSign * 0.08;
      float span = max(0.18, max(crest, 1.0 - crest));
      float across = min(1.0, abs(tq - crest) / span);
      float relief = 1.0 - 2.0 * pow(across, 0.55);
      mossGroove = clamp(0.5 - relief * 0.5, 0.0, 1.0);

      idx = N1 * 0.30;
      // plates are flatter than oak ridges: the column's round relief is
      // softened so the plate marks, not the ridge, carry the drawing
      float reliefGain = uPlatedMode > 0.5 ? 0.55 : 1.0;
      idx += relief * reliefGain * (1.5 + uTextureContrast * 1.2 + lh * 0.5) * qs;
      hiMask = relief > 0.62 ? 1.0 : 0.0;

      // Thick near-black seam between neighbouring lobes, measured in TEXELS so
      // it stays the same pixel width whether the ridge is wide at the root or
      // narrow near the tip.
      crevice = 0.0;
      float seamTexels = min(tq, 1.0 - tq) * texelsPerLobeHere;
      // pine plate columns are narrow, so their furrows are too: at the oak's
      // width the dark seams took half of every column
      float seamWidth = uPlatedMode > 0.5
        ? 0.55 + lh2 * 0.35
        : 0.9 + uBarkVariation * 0.5 + lh2 * 0.5;
      seamWidth *= uBarkDarkCoverage;
      if (seamTexels < seamWidth) {
        idx -= (1.6 + uShadowStrength * 1.6) * qs;
        crevice = 1.0;
        hiMask = 0.0;
      }

      // Every per-ridge variation below is keyed on the LOBE ALONE, never on
      // the position along it. Anything that changes along the ridge - tonal
      // blocks, a terminator jitter re-rolled every few texels, ridges that
      // stop partway - steps the ridge's tone at regular intervals once it is
      // quantised, and the ridge reads as a row of dashes instead of one
      // continuous groove running the length of the branch. Neighbouring
      // ridges still differ from each other, which is what keeps the bark
      // from looking machine-made.

      // per-ridge tonal offset
      float zoneH = bhash(lobeId * 9.7 + uTextureSeed * 3.1);
      idx += (zoneH - 0.5) * (0.45 + uBarkVariation * 0.35) * qs;

      // Hash used below to break the light terminator and to threshold the
      // moss: one value per ridge, so the terminator steps between ridges
      // rather than wandering over the texels of one.
      plateH = bhash(lobeId * 5.1 + uTextureSeed * 2.0);

      // ---- pine plates -----------------------------------------------------
      // Pine bark is not a run of continuous ridges: each narrow column between
      // the vertical furrows is broken into stacked plates, and the plates of
      // neighbouring columns do not line up. Each plate gets its own tone, a
      // dark crack along its foot (stepping a texel up or down across the
      // column, so it reads as a drawn crack rather than a ruled line), a
      // shaded row above that, and a light top edge where the flake lifts and
      // catches the sun.
      if (uPlatedMode > 0.5) {
        float plen = 6.0 + floor(bhash(lobeId * 2.7 + uTextureSeed + 3.0) * 6.0); // 6..11 texels
        float stagger = floor(bhash(lobeId * 6.1 + uTextureSeed + 9.0) * plen);
        // ONE step per crack, at a point chosen per column - re-rolling the
        // step for every texel column zig-zagged the crack into a checkerboard
        float crackSplit = 0.3 + bhash(lobeId * 8.3 + uTextureSeed + 1.0) * 0.4;
        float jag = tq > crackSplit ? 1.0 : 0.0;
        float pv = texV + stagger + jag;
        float plateIdx = floor(pv / plen);
        float inPlate = pv - plateIdx * plen;                 // 0 = foot .. plen-1 = top
        float plateTone = bhash(lobeId * 4.3 + plateIdx * 1.91 + uTextureSeed);
        if (crevice < 0.5) {
          idx += (plateTone - 0.5) * 1.1 * qs;
          if (inPlate < 0.5 && plateTone > 0.1) {
            idx -= (1.4 + uShadowStrength * 1.2) * qs;       // crack at the plate's foot
            crevice = 0.8;
            hiMask = 0.0;
          } else if (inPlate < 1.5) {
            idx -= 0.6 * qs;                                  // tucked under the plate below's lip
          } else if (inPlate > plen - 1.5) {
            idx += (0.8 + uHighlightAmount * 0.6) * qs;       // lifted top edge in the light
            hiMask = 1.0;
          }
        }
        plateH = plateTone;
      }
      idx = floor(idx + 0.5);
    } else {
      // Texture path, for the bark languages that are painted on the CPU.
      vec4 s = texture2D(uStruct, vBarkUv);
      idx = floor(s.r * N1 + 0.5);
      plateH = s.g;
      // B packs two signals: the high bit is the lit-ridge flag, the low 7 bits
      // are the crevice depth. Exact under NEAREST with no mipmaps.
      float packed = floor(s.b * 255.0 + 0.5);
      hiMask = step(127.5, packed);
      crevice = (packed - hiMask * 128.0) / 127.0;
      mossGroove = 0.35 + crevice * 0.65;
    }

    vec3 N = normalize(vNormal);
    float ndl = dot(N, normalize(uTexLightDir));
    float heightN = clamp((vWorldPos.y - uRootY) / max(1.0, uTreeHeight), 0.0, 1.0);
    // The dark well between the roots: only the downward-facing surfaces of the
    // buttress flare, and only very close to the ground.
    float rootWell = (1.0 - smoothstep(0.0, 0.08, heightN))
                   * clamp(-N.y, 0.0, 1.0)
                   * (0.5 + uRootSpread * 0.3);

    // How much of the crown's needles stand between this bit of wood and the
    // sky: full inside the crown band, fading out at its bottom and top, and
    // weaker toward the rim of the cone at that height - a limb's tip that
    // reaches the edge of the foliage catches some light, the trunk up the
    // middle gets none.
    float crownCover = 0.0;
    if (uCrownShade > 0.001 && uCrownEllipsoid > 0.5) {
      // A broadleaf crown is a rounded mass, not a cone: the cover is deepest
      // at its heart and eases off toward its surface, so the limbs darken as
      // they climb into the leaves and their tips at the rim stay lit. The
      // trunk below the crown sits outside the mass and is untouched.
      vec3 q = vec3(
        vWorldPos.x / max(0.5, uCrownRadius),
        (vWorldPos.y - uCrownCenterY) / max(0.5, uCrownRadiusY),
        vWorldPos.z / max(0.5, uCrownRadius));
      crownCover = (1.0 - smoothstep(0.35, 1.0, length(q))) * uCrownShade;
    } else if (uCrownShade > 0.001) {
      float ch = (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY);
      // eased in over the lower part of the crown: the needles thicken
      // gradually, and a short ramp drew a hard dark band across the trunk
      float band = smoothstep(-0.2, 0.3, ch) * (1.0 - smoothstep(0.86, 1.0, ch));
      float tierR = max(0.4, uCrownRadius * pow(max(0.05, 1.0 - 0.76 * clamp(ch, 0.0, 1.0)), 0.82));
      float radialF = length(vWorldPos.xz) / tierR;
      crownCover = band * (1.0 - smoothstep(0.45, 1.05, radialF)) * uCrownShade;
    }

    float tone =
        ndl * 1.10 * (1.0 - crownCover * 0.75)   // the sun barely reaches it
      - crevice * (1.05 + uShadowStrength * 1.5)
      - rootWell * (0.9 + uShadowStrength * 0.8)
      + (heightN - 0.30) * 0.50
      + hiMask * uHighlightAmount * 0.80 * (1.0 - crownCover)
      - crownCover * (1.6 + uShadowStrength * 0.8);

    // Jitter so the terminator wanders along the bark's own shapes rather than
    // drawing a clean curve around the trunk. Kept well under a full step: any
    // larger and it stops breaking the terminator and starts repainting flat
    // areas on its own.
    tone += (plateH - 0.5) * 0.28;

    float off = floor(tone * (0.85 + uTextureContrast * 0.7) + 0.5);
    // Asymmetric clamp: the deepest wood step is reserved for real crevices and
    // the root well. Letting the light term alone reach it turns whole patches
    // of the shadow side into flat near-black blotches.
    // ...except under a dense crown, where the wood genuinely is that dark
    off = clamp(off, -2.0 - floor(crownCover * 1.5 + 0.5), 3.0);
    idx = clamp(idx + off, 0.0, N1);

    // Keep the darkest tones in narrower grooves; the rest becomes mid brown.
    if (uBarkDarkCoverage < 1.0 && crevice < 0.5) {
      idx = max(idx, floor((1.0 - uBarkDarkCoverage) * N1 * 0.7 + 0.5));
    }

    // Moss. It used to be switched on a whole ridge (or plate) at a time, so it
    // came out as long random green stripes. It grows in cushions instead: a
    // noise field on the texel grid, thresholded per texel by how much moss
    // this spot wants - most near the ground, on the damp shaded side and on
    // surfaces facing up (the tops of the root flare), and first down in the
    // furrows, where it creeps out from. Its own tones: the cushion is lit on
    // top and shaded along its lower edge, so it reads as growth on the bark
    // rather than green paint.
    //
    // It also follows the bark's relief (mossGroove, 1 in a furrow .. 0 on a
    // crest): it settles more readily in the furrows than on the crests, and
    // inside a cushion the crests stay lighter and the furrows darker, so the
    // ridges still read through the green instead of it lying on the roots as
    // one flat sheet.
    float damp = clamp(dot(N, vec3(0.0, 0.25, -0.95)), 0.0, 1.0);
    float up = clamp(N.y, 0.0, 1.0);
    // capped, so even the mossiest roots (Korok, mangrove) stay a patchwork
    // of cushions with bark between them instead of one green lawn
    float mossWant = min(0.5,
        pow(1.0 - heightN, 2.2) * (0.1 + damp * 0.45 + up * 0.3) * uMossAmount * 2.0
      + crevice * 0.15 * uMossAmount)
      * (0.55 + mossGroove * 0.9);
    float row = ${PALETTE_ROW_MAIN};
    if (mossWant > 0.04 && mossField(mossP) < mossWant) {
      row = ${PALETTE_ROW_ACCENT};
      bool topEdge = mossField(mossP + mossUp) >= mossWant;
      bool bottomEdge = mossField(mossP - mossUp) >= mossWant;
      // tone varies across a cushion in soft patches, not texel by texel
      float mi = N1 * 0.35 + (ndl > 0.15 ? qs * 0.8 : -qs * 0.6) - crownCover * qs * 1.5
               + (mnoise3(mossP / 3.0 + 41.0) - 0.5) * qs * 1.6
               + (0.5 - mossGroove) * qs * 2.4;              // crests lighter, furrows darker
      if (topEdge) mi += qs * 1.0;
      if (bottomEdge) mi -= qs * 1.2;
      idx = clamp(floor(mi + 0.5), 0.0, N1);
    }

    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;

    // Snow: only where the wood faces the sky and the crown does not cover it,
    // with a ragged per-texel edge, in the shared snow ramp.
    if (uSnow > 0.001) {
      float sf = N.y + (bhash2(snowTexel + uTextureSeed) - 0.5) * 0.35
               - (1.0 - uSnow) * 0.6 - crownCover * 0.9;
      if (sf > 0.42) {
        float si = 2.0 + (ndl > 0.2 ? 1.0 : 0.0) - (sf < 0.6 ? 1.0 : 0.0);
        col = snowRamp(si);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`
);
var PIXEL_BLADE_FRAGMENT_SHADER = (
  /* glsl */
  `
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uHighlightAmount;
  uniform float uTextureContrast;
  uniform float uAccentAmount;
  uniform float uDetailDensity;
  uniform vec2 uBladeTexels;
  uniform float uTextureSeed;
  uniform float uCrownBottomY;
  uniform float uCrownTopY;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  float bladeHash(vec2 cell, float s) {
    float h = dot(floor(cell), vec2(127.1, 311.7)) + s * 0.137;
    return fract(sin(h) * 43758.5453);
  }

  void main() {
    // Snap to the blade's texel grid first: every tone below is decided per
    // texel, which is what keeps the pixels square and hard-edged.
    vec2 cell = floor(vUv * uBladeTexels);
    vec2 quv = (cell + 0.5) / uBladeTexels;

    float sparkH = bladeHash(cell, uTextureSeed);
    // neighbouring texels share a tone in small groups -> leaf clusters, not static
    float groupH = bladeHash(floor(vUv * uBladeTexels / (2.0 + uDetailDensity * 1.6)), uTextureSeed + 17.0);

    float N1 = uPaletteSteps - 1.0;
    vec3 N = normalize(vNormal);
    float ndl = dot(N, normalize(uTexLightDir));
    float heightN = clamp(
      (vWorldPos.y - uCrownBottomY) / max(0.5, uCrownTopY - uCrownBottomY), 0.0, 1.0);

    // dark at the stem, light toward the tip
    float tone = 0.22 + quv.y * 0.56;
    tone += ndl * 0.26;
    tone += (heightN - 0.5) * 0.16;
    tone += (groupH - 0.5) * 0.26;
    tone -= uShadowStrength * 0.12;

    // lit midrib down the centre of the blade
    float rib = 1.0 - min(1.0, abs(quv.x - 0.5) * uBladeTexels.x * 0.55);
    tone += rib * (0.09 + uHighlightAmount * 0.13);
    // darker margins
    tone -= step(0.84, abs(quv.x - 0.5) * 2.0) * (0.15 + uShadowStrength * 0.18);

    float t = clamp(0.5 + (tone - 0.5) * (1.0 + uTextureContrast * 0.8), 0.0, 1.0);
    float idx = floor(t * N1 + 0.5);
    if (sparkH > 0.985 && uHighlightAmount > 0.02) idx = N1;
    idx = clamp(idx, 0.0, N1);

    float row = (groupH < uAccentAmount * 0.18) ? ${PALETTE_ROW_ACCENT} : ${PALETTE_ROW_MAIN};
    vec3 col = texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, row)).rgb;
    gl_FragColor = vec4(col, 1.0);
  }
`
);
var PIXEL_SAPLING_LEAF_FRAGMENT_SHADER = (
  /* glsl */
  `
  uniform sampler2D uLeaf;
  uniform sampler2D uPalette;
  uniform float uPaletteSteps;
  uniform vec3 uTexLightDir;
  uniform float uShadowStrength;
  uniform float uTextureContrast;
  uniform float uSnow;
  varying vec3 vNormal;
  varying vec2 vUv;
  ${SNOW_GLSL}

  // Snow heaped on the middle of the sprite (16 x 24 texels, base at v = 0):
  // it fills the gaps between needles, so it reads as a drift sitting on the
  // spray, and leaves the base and the tips clear.
  float leafSnow(vec2 t) {
    vec2 c = (t + 0.5) / vec2(16.0, 24.0);
    float spine = 1.0 - abs(c.x - 0.5) * 3.2;
    float along = smoothstep(0.08, 0.22, c.y) * (1.0 - smoothstep(0.55, 0.82, c.y));
    return spine * along + (snowHash(t) - 0.5) * 0.35;
  }

  void main() {
    vec3 n = normalize(vNormal);
    float back = gl_FrontFacing ? 0.0 : 1.0;
    // Needle sprays transmit light on both sides, independently of the camera.
    float ndl = abs(dot(n, normalize(uTexLightDir))) * 0.65;

    // snow on the face turned to the sky only
    if (uSnow > 0.001 && n.y > 0.2) {
      vec2 t = floor(vUv * vec2(16.0, 24.0));
      float thr = 1.0 - uSnow * 0.8;
      if (leafSnow(t) > thr) {
        float rim = (leafSnow(t + vec2(1.0, 0.0)) < thr
                  || leafSnow(t - vec2(1.0, 0.0)) < thr
                  || leafSnow(t + vec2(0.0, 1.0)) < thr) ? 1.0 : 0.0;
        gl_FragColor = vec4(snowRamp(2.0 + (ndl > 0.3 ? 1.0 : 0.0) - rim), 1.0);
        return;
      }
    }

    vec4 s = texture2D(uLeaf, vUv);
    if (s.a < 0.5) discard;
    float N1 = uPaletteSteps - 1.0;
    float idx = floor(s.r * N1 + 0.5);
    // the leaf's V-fold gives its two halves different normals, so light and
    // shade split along the midrib, in whole palette steps
    float tone = dot(n, normalize(uTexLightDir)) * 1.25 - back * 0.7 - uShadowStrength * 0.25;
    float off = clamp(floor(tone * (0.85 + uTextureContrast * 0.75) + 0.5), -2.0, 2.0);
    idx = clamp(idx + off, 0.0, N1);
    gl_FragColor = vec4(texture2D(uPalette, vec2((idx + 0.5) / uPaletteSteps, 0.75)).rgb, 1.0);
  }
`
);

// work/Pixel_Tree-main/src/structures/surfacePainting.ts
import * as THREE8 from "three";
var periods = { wood: [0.84, 2.8], stone: [2.8, 1.6], plaster: [3.2, 3.2], roof: [2.8, 2], thatch: [2.4, 2.4], metal: [1.2, 1.2], cloth: [2.4, 2.4], dark: [1, 1], earth: [3.2, 3.2], water: [3.2, 3.2] };
var STONE_COURSE_HEIGHT = periods.stone[1] / 4;
var fract = (n) => n - Math.floor(n);
var hash = (x, y, seed) => fract(Math.sin(x * 127.1 + y * 311.7 + seed * 0.37) * 43758.5453);
function surfaceColorRamp(color) {
  const base2 = new THREE8.Color(color).convertLinearToSRGB(), rgb = [base2.r, base2.g, base2.b];
  return Array.from({ length: 7 }, (_, i) => {
    const strength = [0.36, 0.51, 0.67, 0.83, 1, 1.13, 1.28][i], warm = Math.max(0, i - 3) * 0.017;
    return rgb.map((c, k) => Math.round(Math.min(1, c * strength + warm * (k === 0 ? 1 : k === 1 ? 0.75 : 0.25) + (i < 3 && k === 2 ? 0.035 : 0)) * 255));
  });
}
function paintSurface(kind, color, density, seed, finish, solidTimber = false, softMetal = false) {
  const period = periods[kind], width = Math.max(8, Math.round(period[0] * density)), height = Math.max(8, Math.round(period[1] * density));
  const ramp = surfaceColorRamp(color);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let tone = 4;
    const cluster = hash(Math.floor(x / 4), Math.floor(y / 5), seed);
    if (kind === "wood") {
      const plank = width / 3, board = Math.floor(x / plank), px = x - board * plank, b = hash(board, 0, seed);
      tone = solidTimber ? 4 : b < 0.3 ? 3 : 4;
      if (!solidTimber) {
        if (px < 1) tone = 1;
        else if (px < 2) tone = 2;
        else if (px > plank - 2) tone = 5;
      }
      const line = plank * (0.35 + Math.sin(y * 0.1 + b * 8) * 0.16);
      if (Math.abs(px - line) < 0.8 && fract(y / 17 + b) > 0.25) tone -= 1;
      const knotY = height * (0.2 + b * 0.6), knot = (px - plank * 0.63) ** 2 / (plank * 0.17) ** 2 + (y - knotY) ** 2 / 25;
      if (knot < 1.5 && knot > 0.5) tone = 2;
      if (cluster > 0.9 && (solidTimber || px > 2 && px < plank - 2)) tone = Math.min(5, tone + 1);
    } else if (kind === "stone") {
      const rowHeight = height / 4, row = Math.floor(y / rowHeight), py = y - row * rowHeight;
      const brickWidth = width / 4, shift = row % 2 * brickWidth * 0.5;
      const bx = Math.floor((x + shift) / brickWidth), px = x + shift - bx * brickWidth, b = hash(bx, row, seed);
      const pixel = hash(x, y, seed + 11);
      const chip = hash(Math.floor(px), row, seed + 23) > 0.82 ? 1 : 0;
      tone = b < 0.16 ? 3 : 4;
      if (py < 1 || px < 1) tone = 1;
      else if (py < 1 + chip || px + py < 2.5 + hash(bx, row, seed + 31) * 2) tone = 2;
      else if (py < 1.8 || px < 1.8) tone = 5;
      else if (py > rowHeight - 1.3 - chip || px > brickWidth - 1.2) tone = 3;
      else if (pixel > 0.975) tone = 3;
    } else if (kind === "roof") {
      const rowHeight = height / 5, row = Math.floor(y / rowHeight), py = y - row * rowHeight;
      const tileWidth = width / 7, shift = row % 2 * tileWidth * 0.5;
      const tile = Math.floor((x + shift) / tileWidth), px = x + shift - tile * tileWidth, b = hash(tile, row, seed);
      tone = b < 0.25 ? 3 : 4;
      const lightEdge = tileWidth * 0.46 + Math.floor(hash(Math.floor(py / 2), tile + row * 7, seed + 41) * 3) - 1;
      const lightStart = rowHeight * 0.4 + Math.floor(hash(Math.floor(px / 2), row, seed + 53) * 3) - 1;
      const lip = hash(Math.floor(px / 2), row, seed + 29) > 0.8 ? 0.5 : 0;
      if (py < 1 || px < 1) tone = 1;
      else if (py < 2 || px < 2) tone = 2;
      else if (py > rowHeight - 1.5 - lip) tone = 6;
      else if (px > tileWidth - 1.5) tone = 5;
      else if (px < lightEdge && py > lightStart) tone += 1;
    } else if (kind === "thatch") {
      const tuft = Math.floor(x / 5), band = Math.floor(y / 9), clump = hash(tuft, band, seed + 7);
      tone = clump < 0.18 ? 3 : 4;
      const bend = Math.floor(hash(tuft, Math.floor(y / 12), seed + 17) * 3) - 1;
      const fiber = (x + bend + width) % 5;
      const tip = hash(tuft, band, seed + 31), length = 3 + Math.floor(tip * 6);
      const py = (y + Math.floor(hash(tuft, 0, seed) * 7)) % 9;
      if (fiber === 0 && py < length) tone = tip > 0.88 ? 6 : 5;
      else if (fiber === 1 && py < length - 3) tone = 5;
      else if (fiber === 4 && py < length && clump < 0.4) tone = 3;
    } else if (kind === "plaster") {
      tone = 4;
      const field = hash(Math.floor(x / 10), Math.floor(y / 9), seed);
      if (field < 0.12 && cluster < 0.65) tone = 3;
      if (field > 0.92 && cluster > 0.4) tone = 5;
      if (finish < 0.45 && field < 0.1 && cluster < 0.3) tone = 2;
    } else if (kind === "cloth") {
      tone = 4;
      const fold = x % Math.max(4, Math.round(width / 7));
      if (fold < 2) tone = 3;
      else if (fold === 2) tone = 5;
    } else if (kind === "water") {
      tone = 3;
      if (y % 12 < 2 && cluster > 0.4) tone = 5;
      else if (cluster < 0.15) tone = 2;
    } else if (kind === "earth") tone = cluster > 0.78 ? 5 : cluster < 0.22 ? 3 : 4;
    else if (kind === "metal") tone = softMetal ? 4 : x < width * 0.25 ? 3 : x < width * 0.42 ? 6 : 4;
    else tone = 1;
    let paint = ramp[Math.max(0, Math.min(6, Math.round(tone)))];
    if (kind === "metal" && softMetal) {
      const strength = 0.96 + hash(Math.floor(x / 4), Math.floor(y / 4), seed + 47) * 0.07;
      paint = paint.map((v) => Math.round(v * strength));
      const worn = hash(Math.floor(x / 3), Math.floor(y / 2), seed + 61);
      const chip = hash(x, y, seed + 73);
      const darkPatch = hash(Math.floor(x / 4), Math.floor(y / 3), seed + 83);
      if (darkPatch < 0.2 && chip > 0.2) {
        const amount = 0.4 + chip * 0.15;
        paint = paint.map((v, i) => Math.round(v * (1 - amount) + ramp[2][i] * amount));
      } else if (worn > 0.9 && chip > 0.35) {
        const amount = 0.25 + chip * 0.25;
        paint = paint.map((v, i) => Math.round(v * (1 - amount) + ramp[6][i] * amount));
        if (worn > 0.97 && chip > 0.8) {
          const highlight = [230, 235, 237];
          paint = paint.map((v, i) => Math.round(v * 0.25 + highlight[i] * 0.75));
        }
      }
    }
    data.set([...paint, 255], (y * width + x) * 4);
  }
  const map = new THREE8.DataTexture(data, width, height);
  map.colorSpace = THREE8.SRGBColorSpace;
  map.magFilter = THREE8.NearestFilter;
  map.minFilter = kind === "roof" ? THREE8.NearestMipmapLinearFilter : THREE8.NearestFilter;
  map.generateMipmaps = kind === "roof";
  map.wrapS = map.wrapT = THREE8.RepeatWrapping;
  map.repeat.set(1 / period[0], 1 / period[1]);
  map.needsUpdate = true;
  return map;
}

// work/Pixel_Tree-main/src/structures/geometry/bridge.ts
import * as THREE9 from "three";
function bridgeWaterTexture(density, seed) {
  const period = 4, size = Math.max(8, Math.round(period * density)), data = new Uint8Array(size * size * 4);
  const colors = [[35, 103, 119], [38, 116, 132], [47, 131, 145], [56, 145, 154]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xx = Math.floor(x / size * 8), yy = Math.floor(y / size * 8);
    const hash2 = Math.sin(xx * 127.1 + yy * 311.7 + seed * 0.37) * 43758.5453;
    const index = Math.floor((hash2 - Math.floor(hash2)) * colors.length);
    data.set([...colors[index], 255], (y * size + x) * 4);
  }
  const map = new THREE9.DataTexture(data, size, size);
  map.colorSpace = THREE9.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE9.NearestFilter;
  map.wrapS = map.wrapT = THREE9.RepeatWrapping;
  map.repeat.set(1 / period, 1 / period);
  map.needsUpdate = true;
  return map;
}

// work/Pixel_Tree-main/src/services/rockSnowStyle.ts
import * as THREE10 from "three";
function rockSnowColors(linear = false) {
  return ["#354a65", "#a6b5c5", "#d1d7de", "#e6e9ed"].map((hex) => {
    const color = new THREE10.Color(hex);
    if (!linear) color.convertLinearToSRGB();
    return new THREE10.Vector3(color.r, color.g, color.b);
  });
}
var ROCK_SNOW_PAINT_GLSL = (
  /* glsl */
  `
 vec3 rockSnowColor(vec3 surfaceP,vec3 surfaceN,vec3 lightDir){
  float snowLight=dot(normalize(surfaceN),normalize(lightDir));
  float pigment=mnoise3(surfaceP/9.0+137.0);
  float speckle=mhash3(floor(surfaceP)+151.0);
  vec3 color=uSnowColors[2];
  if(pigment<0.38||snowLight<-0.1)color=uSnowColors[1];
  if(pigment>0.65&&snowLight>0.25)color=uSnowColors[3];
  if(speckle<0.12&&pigment<0.57)color=uSnowColors[1];
  if(speckle>0.88&&pigment<0.44)color=uSnowColors[2];
  return color;
 }
`
);
var ROCK_SNOW_COVERAGE_GLSL = (
  /* glsl */
  `
 float rockSnowCoverage(vec3 p,vec3 normal,float snow){
  float field=mnoise3(p/16.0+91.0)*0.78+mnoise3(p/5.0+113.0)*0.17+mhash3(floor(p)+71.0)*0.05;
  return min(0.94,snow*(0.32+max(0.0,normalize(normal).y)*0.9))-field;
 }
`
);
var ROCK_SNOW_RIM_GLSL = (
  /* glsl */
  `
 vec3 rockSnowSurface(vec3 exposedColor,vec3 p,vec3 n,vec3 down,vec3 downN,vec3 across,vec3 acrossN,vec3 lightDir,float snow,float rim){
  if(snow<=0.0)return exposedColor;
  float snowMask=rockSnowCoverage(p,n,snow);
  float belowSnow=rockSnowCoverage(p+down,n+downN,snow);
  float belowSnow2=rockSnowCoverage(p+down*2.0,n+downN*2.0,snow);
  float aboveSnow=rockSnowCoverage(p-down,n-downN,snow);
  bool onSnow=snowMask>0.0;
  float borderDistance=3.0;
  for(int i=1;i<=2;i++){
   float r=float(i);
   bool below=rockSnowCoverage(p+down*r,n+downN*r,snow)>0.0;
   bool above=rockSnowCoverage(p-down*r,n-downN*r,snow)>0.0;
   bool left=rockSnowCoverage(p-across*r,n-acrossN*r,snow)>0.0;
   bool right=rockSnowCoverage(p+across*r,n+acrossN*r,snow)>0.0;
   if(below!=onSnow||above!=onSnow||left!=onSnow||right!=onSnow)borderDistance=min(borderDistance,r);
  }
  float fringe=mnoise3(p/3.0+173.0)*0.65+mhash3(floor(p)+173.0)*0.35;
  vec3 color=exposedColor;
  if(onSnow){
   float snowLight=dot(n,normalize(lightDir));
   bool lowerRim=belowSnow<=0.0||belowSnow2<=0.0;
   bool upperRim=aboveSnow<=0.0;
   color=rockSnowColor(p,n,lightDir);
   if(rim>0.5&&borderDistance<2.5){
    float band=(3.0-borderDistance)/2.0;
    if(fringe<band*0.12)color=exposedColor;
    else if(fringe<band*(lowerRim?0.54:0.38))color=uSnowColors[0];
    else if(fringe<band*0.78)color=uSnowColors[1];
    else if(upperRim&&snowLight>0.1)color=uSnowColors[3];
   }
  }else if(rim>0.5&&borderDistance<2.5){
   float band=(3.0-borderDistance)/2.0;
   if(fringe<band*0.18)color=uSnowColors[2];
   else if(fringe<band*0.3)color=uSnowColors[1];
   else if(fringe<band*(aboveSnow>0.0?0.62:0.43))color=mix(exposedColor,uSnowColors[0]*0.75,0.8);
  }
  return color;
 }
`
);

// work/Pixel_Tree-main/src/constants/rockBiomes.ts
var base = {
  biome: "hyrule",
  shape: "boulder",
  width: 2.8,
  height: 2.1,
  depth: 2.4,
  irregularity: 0.35,
  detail: 1,
  count: 1,
  spread: 2.8,
  color: "#8a8990",
  mossColor: "#7ba33a",
  moss: 0.15,
  snow: 0,
  cracks: 0.3,
  mushrooms: false,
  mushroomCount: 6,
  mushroomSize: 0.38,
  gravel: false,
  gravelCount: 6,
  gravelSize: 0.18,
  gravelSpread: 0.8
};
function biome(key, name, description, ground, grass, overrides) {
  return { name, description, ground, grass, config: {
    ...base,
    mushrooms: ["swamp", "faron", "korok", "satori"].includes(key),
    mushroomCount: key === "korok" ? 8 : key === "satori" ? 3 : 6,
    ...overrides,
    biome: key
  } };
}
var ROCK_BIOMES = {
  hyrule: biome("hyrule", "Hyrule", "Pedra cinzenta das pradarias; blocos arredondados e musgo discreto.", "#588e36", "#7cb342", {}),
  satori: biome("satori", "Satori", "Rocha clara da montanha, com l\xEDquens suaves e musgo do bosque.", "#4e8555", "#81c784", { color: "#a8a6a0", mossColor: "#7ba33a", moss: 0.52, irregularity: 0.25 }),
  akkala: biome("akkala", "Akkala", "Rocha ferruginosa da floresta de outono, com faces ocres e desgastadas.", "#7d5a31", "#c98a3a", { color: "#ad7855", mossColor: "#a09a50", moss: 0.18, shape: "slab", cracks: 0.5 }),
  hebra: biome("hebra", "Hebra", "Granito frio e angular das con\xEDferas, com l\xEDquens nas faces superiores.", "#5a4838", "#6e9970", { color: "#697987", mossColor: "#7ba33a", shape: "spire", height: 3.2, irregularity: 0.48, moss: 0.22 }),
  hebra_snowy: biome("hebra_snowy", "Hebra Nevada", "Granito escuro com neve acumulada nas faces voltadas ao c\xE9u.", "#e4edf6", "#9aa17a", { color: "#596674", moss: 0.05, snow: 0.8, shape: "spire", height: 3.1, irregularity: 0.45 }),
  faron: biome("faron", "Faron", "Pedra tropical escura, arredondada pela \xE1gua e coberta de musgo.", "#c2a66e", "#79aa47", { color: "#626f6c", mossColor: "#7ba33a", moss: 0.65, irregularity: 0.18, detail: 2, height: 1.7 }),
  korok: biome("korok", "Floresta Korok", "Blocos ancestrais irregulares com musgo espesso e fissuras profundas.", "#476334", "#769844", { color: "#777b68", mossColor: "#7ba33a", moss: 0.82, cracks: 0.65, irregularity: 0.55, shape: "cluster", count: 3 }),
  swamp: biome("swamp", "P\xE2ntano", "Rochas baixas e \xFAmidas, em tons escuros, com cobertura verde densa.", "#2e271f", "#6f9a44", { color: "#4e6059", mossColor: "#7ba33a", moss: 0.78, shape: "slab", height: 1.2, detail: 1 }),
  gerudo: biome("gerudo", "Gerudo", "Arenito quente esculpido pelo vento, com fissuras e faces amplas.", "#d4a359", "#bfa466", { color: "#c89662", moss: 0, shape: "spire", height: 3.4, cracks: 0.7, irregularity: 0.6 }),
  savanna: biome("savanna", "Savana", "Blocos de pedra ocre entre gram\xEDneas douradas e l\xEDquens secos.", "#c09a58", "#d8bd62", { color: "#ac885c", mossColor: "#aaa15a", moss: 0.12, shape: "cluster", count: 3, height: 1.8, irregularity: 0.4 }),
  withered: biome("withered", "Terras Secas", "Pedra erodida de solo \xE1rido, com rachaduras e pouco l\xEDquen.", "#6e5c49", "#a89368", { color: "#8c8171", mossColor: "#a39a55", moss: 0.1, cracks: 0.85, irregularity: 0.65 }),
  tundra: biome("tundra", "Tundra", "Rochas achatadas pelo gelo, com l\xEDquens claros e neve esparsa.", "#7b7d62", "#9aa17a", { color: "#858c8b", mossColor: "#a1aa83", moss: 0.32, snow: 0.2, shape: "slab", height: 1.1, cracks: 0.45 })
};
function createRockPresets(template, withOre = false, gravel = false) {
  return Object.fromEntries(Object.entries(ROCK_BIOMES).map(([key, preset], index) => {
    const species = `${key}_${gravel ? "gravel" : withOre ? "ore" : "rock"}`;
    return [species, {
      ...template,
      id: species,
      species,
      name: `${gravel ? "Pedrinhas e cascalho" : withOre ? "Pedra com min\xE9rios" : "Pedra"} de ${preset.name}`,
      seed: 6200 + index,
      growthStage: "rock",
      rock: { ...preset.config, ...gravel ? { gravel: true, mushrooms: false } : {}, ...withOre ? {
        ore: ["satori", "hebra", "hebra_snowy", "tundra"].includes(key) ? "quartz" : ["akkala", "gerudo", "savanna"].includes(key) ? "copper" : "iron",
        oreCount: 6,
        oreSize: 0.3
      } : {} },
      trunkHeight: preset.config.height,
      useSpaceColonization: false,
      foliageType: "none",
      clusterCount: 0,
      branchCount: 0,
      foliageColorTop: preset.config.color,
      mossAmount: preset.config.moss,
      snowCover: preset.config.snow,
      pixelSize: 2,
      paletteSteps: 6,
      showApples: false,
      showMushrooms: false,
      showFallingLeaves: false,
      fallingLeafCount: 0,
      windStrength: 0
    }];
  }));
}

// work/Pixel_Tree-main/src/constants/wildflowers.ts
var profile = (family, petals, core, cup, height, radius, leaf, leafWidth, leaves, layout, color, pollen = "#d5ad45") => ({ family, petals, core, cup, height, radius, leaf, leafWidth, leaves, layout, color, pollen });
var FLOWER_PROFILES = {
  hyrule: profile("margarida", 8, 0.25, 0.08, 0.95, 0.23, "faron_palm_sapling", 0.55, 3, "single", "#eee5ba"),
  satori: profile("pr\xEDmula", 5, 0.48, 0.18, 0.68, 0.25, "satori_sakura_sapling", 0.9, 4, "rosette", "#dfa1be"),
  akkala: profile("papoula", 4, 0.64, 0.3, 1.12, 0.29, "hyrule_oak_sapling", 0.85, 3, "single", "#d38242", "#483329"),
  hebra: profile("espiga alpina", 5, 0.42, 0.18, 1.2, 0.12, "faron_palm_sapling", 0.3, 3, "spike", "#9e8bc2", "#c7b47b"),
  hebra_snowy: profile("a\xE7afr\xE3o da neve", 6, 0.57, 0.85, 0.44, 0.18, "faron_palm_sapling", 0.22, 5, "rosette", "#d0daeb", "#d5b35d"),
  faron: profile("hibisco", 5, 0.62, 0.24, 1.36, 0.33, "swamp_mangrove_sapling", 1.1, 4, "single", "#e38e77"),
  korok: profile("camp\xE2nula", 5, 0.56, 0.6, 0.88, 0.17, "korok_ancient_sapling", 0.85, 3, "droop", "#b4a8d2", "#d5cc9b"),
  swamp: profile("\xEDris", 3, 0.3, 0.32, 1.08, 0.27, "faron_palm_sapling", 0.24, 5, "rosette", "#8faecb", "#d7be63"),
  gerudo: profile("flor do deserto", 6, 0.45, 0.16, 0.28, 0.24, "swamp_mangrove_sapling", 1, 6, "rosette", "#dba6a0"),
  savanna: profile("\xE1ster", 10, 0.23, 0.1, 1.03, 0.22, "faron_palm_sapling", 0.38, 3, "single", "#dbc36b", "#795a30"),
  withered: profile("umbela seca", 5, 0.42, 0.08, 0.76, 0.095, "savanna_acacia_sapling", 0.6, 2, "umbel", "#baa487", "#84704c"),
  tundra: profile("sax\xEDfraga", 5, 0.46, 0.18, 0.34, 0.16, "satori_sakura_sapling", 0.7, 5, "rosette", "#b9a8cf", "#d6c580")
};

// work/Pixel_Tree-main/src/constants/groundProps.ts
var PROP_LABELS = { flowers: "Flores silvestres", crystals: "Cristais", leaves: "Folhas secas" };
function createGroundPropPresets(template) {
  const rocks = createRockPresets(template);
  return Object.fromEntries(["flowers", "crystals", "leaves"].flatMap((kind) => Object.entries(ROCK_BIOMES).map(([biome2, base2], index) => {
    const species = `${biome2}_${kind}`;
    const colors = kind === "flowers" ? Object.values(FLOWER_PROFILES).map((p) => p.color) : ["#b99042", "#c59273", "#cd7436", "#a68651", "#8c775e", "#ad8651", "#9c763c", "#8c6e47", "#bd8850", "#c5a45a", "#9b774c", "#a49a72"];
    return [species, {
      ...rocks[`${biome2}_rock`],
      id: species,
      species,
      name: `${PROP_LABELS[kind]} de ${base2.name}`,
      growthStage: "prop",
      seed: 7100 + index,
      foliageColorTop: kind === "crystals" ? "#ae83da" : colors[index],
      prop: {
        kind,
        biome: biome2,
        count: kind === "flowers" ? 7 : kind === "crystals" ? 3 : 4,
        size: kind === "flowers" ? 0.55 : kind === "crystals" ? 0.8 : 0.65,
        spread: 1.1,
        density: 0.55,
        color: colors[index],
        flowerShape: ["daisy", "star", "poppy", "bell"][index % 4],
        crystal: ["amethyst", "quartz", "ruby", "sapphire", "diamond", "emerald"][index % 6]
      }
    }];
  })));
}

// work/Pixel_Tree-main/src/constants/presets.ts
var SHRUB_BASE = {
  growthStage: "shrub",
  useSpaceColonization: true,
  scaAttractorCount: 420,
  scaAttractionRadius: 1.1,
  scaKillDistance: 0.16,
  scaStepSize: 0.1,
  scaCrownShape: "sphere",
  showAttractors: false,
  trunkHeight: 1.5,
  trunkRadiusBase: 0.06,
  trunkRadiusTop: 0.02,
  trunkCurvature: 0.2,
  trunkTwist: 0.2,
  rootSpread: 0.1,
  branchCount: 6,
  branchLength: 0.3,
  branchAngle: 0.8,
  branchStartHeight: 0.04,
  canopySpread: 0.85,
  subBranchDensity: 0.6,
  foliageType: "cloud",
  clusterCount: 24,
  clusterRadius: 0.55,
  clusterDetail: 2,
  foliageColorTop: "#6cb33e",
  foliageColorBottom: "#1f4a1c",
  foliageRoughness: 0.4,
  celSteps: 3,
  rimLightIntensity: 0.5,
  foliageDensity: 0.85,
  patchRadius: 0.5,
  patchRadiusVariance: 0.2,
  patchSpacing: 0.35,
  patchDensity: 0.85,
  terminalBranchBias: 0.9,
  crownWidth: 1,
  crownHeight: 1,
  noiseScale: 0.5,
  noiseStrength: 0.5,
  noiseThreshold: 0.4,
  clustersPerPatch: 4,
  cardsPerClusterMin: 2,
  cardsPerClusterMax: 4,
  leafCardSize: 0.6,
  leafCardSizeVariance: 0.2,
  alphaTest: 0.4,
  interiorDarkening: 0.45,
  flutterStrength: 0.03,
  barkColor: "#5a3d26",
  barkRoughness: 0.8,
  barkStyle: "oak",
  mossAmount: 0.05,
  showApples: false,
  appleCount: 0,
  showMushrooms: false,
  mushroomCount: 0,
  showFallingLeaves: false,
  fallingLeafCount: 0,
  windStrength: 0.3,
  windSpeed: 1
};
var LOG_BASE = {
  ...SHRUB_BASE,
  growthStage: "log",
  useSpaceColonization: false,
  trunkHeight: 5.5,
  trunkRadiusBase: 0.55,
  trunkRadiusTop: 0.45,
  trunkCurvature: 0.25,
  trunkTwist: 0,
  rootSpread: 1,
  branchCount: 3,
  branchLength: 0.6,
  foliageType: "none",
  clusterCount: 0,
  foliageDensity: 0,
  patchDensity: 0,
  foliageColorTop: "#6d8f3a",
  // the moss the wood carries (colour chip in the UI)
  foliageColorBottom: "#3b4f22",
  barkColor: "#5e4330",
  barkRoughness: 0.9,
  barkStyle: "oak",
  mossAmount: 0.45,
  showMushrooms: true,
  mushroomCount: 6,
  windStrength: 0.15,
  windSpeed: 0.8
};
var MAPLE_BASE = {
  growthStage: "adult",
  useSpaceColonization: true,
  scaAttractorCount: 380,
  scaAttractionRadius: 3.8,
  scaKillDistance: 0.66,
  scaStepSize: 0.4,
  scaCrownShape: "sphere",
  showAttractors: false,
  trunkHeight: 8.5,
  trunkRadiusBase: 0.95,
  trunkRadiusTop: 0.42,
  trunkCurvature: 0.12,
  trunkTwist: 0.15,
  rootSpread: 1.1,
  branchCount: 5,
  branchLength: 3.6,
  branchAngle: 0.62,
  branchStartHeight: 0.46,
  canopySpread: 1.05,
  subBranchDensity: 0.55,
  foliageType: "cloud",
  clusterCount: 28,
  clusterRadius: 1.35,
  clusterDetail: 2,
  foliageColorTop: "#d8452b",
  foliageColorBottom: "#6e1a12",
  foliageRoughness: 0.35,
  celSteps: 3,
  rimLightIntensity: 0.4,
  foliageDensity: 0.78,
  patchRadius: 1.1,
  patchRadiusVariance: 0.26,
  patchSpacing: 0.95,
  patchDensity: 0.78,
  terminalBranchBias: 0.9,
  crownWidth: 0.95,
  crownHeight: 1.2,
  noiseScale: 0.32,
  noiseStrength: 0.5,
  noiseThreshold: 0.4,
  clustersPerPatch: 4,
  cardsPerClusterMin: 2,
  cardsPerClusterMax: 4,
  leafCardSize: 1.5,
  leafCardSizeVariance: 0.22,
  alphaTest: 0.4,
  interiorDarkening: 0.5,
  flutterStrength: 0.04,
  barkColor: "#3f2e24",
  barkRoughness: 0.8,
  barkStyle: "oak",
  mossAmount: 0.1,
  showApples: false,
  appleCount: 0,
  showMushrooms: true,
  mushroomCount: 4,
  showFallingLeaves: true,
  fallingLeafCount: 70,
  // an autumn tree sheds all the time
  windStrength: 0.5,
  windSpeed: 1
};
var PLANT_BASE = {
  ...SHRUB_BASE,
  growthStage: "plant",
  useSpaceColonization: false,
  trunkHeight: 1,
  foliageType: "none",
  clusterCount: 0,
  foliageDensity: 0,
  patchDensity: 0,
  mossAmount: 0,
  showApples: false,
  appleCount: 0,
  showMushrooms: false,
  mushroomCount: 0,
  showFallingLeaves: false,
  fallingLeafCount: 0,
  windStrength: 0.45,
  windSpeed: 1
};
var TREE_PRESETS = {
  ...createRockPresets(SHRUB_BASE),
  ...createRockPresets(SHRUB_BASE, true),
  ...createRockPresets(SHRUB_BASE, false, true),
  ...createGroundPropPresets(SHRUB_BASE),
  hyrule_oak: {
    id: "hyrule_oak",
    name: "Carvalho de Hyrule",
    species: "hyrule_oak",
    growthStage: "adult",
    seed: 42,
    useSpaceColonization: true,
    scaAttractorCount: 360,
    scaAttractionRadius: 4.2,
    scaKillDistance: 0.72,
    scaStepSize: 0.42,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 10.5,
    trunkRadiusBase: 1.35,
    trunkRadiusTop: 0.55,
    trunkCurvature: 0.18,
    trunkTwist: 0.28,
    rootSpread: 1.55,
    branchCount: 4,
    branchLength: 4.3,
    branchAngle: 0.72,
    branchStartHeight: 0.48,
    canopySpread: 1.25,
    subBranchDensity: 0.5,
    foliageType: "cloud",
    clusterCount: 28,
    clusterRadius: 1.45,
    clusterDetail: 2,
    foliageColorTop: "#5d9f31",
    // natural sunlit green without fluorescent clipping
    foliageColorBottom: "#1e431c",
    // deep interior green for readable crown volume
    foliageRoughness: 0.35,
    celSteps: 3,
    rimLightIntensity: 0.35,
    foliageDensity: 0.76,
    patchRadius: 1.15,
    patchRadiusVariance: 0.28,
    patchSpacing: 1,
    patchDensity: 0.76,
    terminalBranchBias: 0.9,
    crownWidth: 1,
    crownHeight: 1.15,
    noiseScale: 0.32,
    noiseStrength: 0.55,
    noiseThreshold: 0.4,
    clustersPerPatch: 4,
    cardsPerClusterMin: 2,
    cardsPerClusterMax: 4,
    leafCardSize: 1.7,
    leafCardSizeVariance: 0.22,
    alphaTest: 0.4,
    interiorDarkening: 0.52,
    flutterStrength: 0.038,
    barkColor: "#5c3e23",
    barkRoughness: 0.8,
    barkStyle: "oak",
    mossAmount: 0.2,
    showApples: true,
    appleCount: 5,
    showMushrooms: true,
    mushroomCount: 4,
    showFallingLeaves: true,
    fallingLeafCount: 60,
    windStrength: 0.45,
    windSpeed: 1
  },
  satori_sakura: {
    id: "satori_sakura",
    name: "Cerejeira de Satori",
    species: "satori_sakura",
    seed: 108,
    useSpaceColonization: true,
    scaAttractorCount: 580,
    scaAttractionRadius: 4.2,
    scaKillDistance: 0.6,
    scaStepSize: 0.35,
    scaCrownShape: "multi_cloud",
    showAttractors: false,
    trunkHeight: 8.5,
    trunkRadiusBase: 1.3,
    trunkRadiusTop: 0.42,
    trunkCurvature: 0.55,
    trunkTwist: 0.65,
    rootSpread: 1.6,
    branchCount: 10,
    branchLength: 4.6,
    branchAngle: 0.85,
    branchStartHeight: 0.38,
    canopySpread: 1.25,
    subBranchDensity: 0.75,
    foliageType: "cloud",
    clusterCount: 24,
    clusterRadius: 1.65,
    clusterDetail: 2,
    foliageColorTop: "#ffa3cb",
    // glowing sacred pink
    foliageColorBottom: "#d44f88",
    // magenta undertone
    foliageRoughness: 0.3,
    celSteps: 3,
    rimLightIntensity: 1.2,
    foliageDensity: 0.85,
    patchRadius: 1.45,
    patchRadiusVariance: 0.38,
    patchSpacing: 0.75,
    patchDensity: 0.85,
    terminalBranchBias: 0.9,
    crownWidth: 1.25,
    crownHeight: 1.1,
    noiseScale: 0.28,
    noiseStrength: 0.6,
    noiseThreshold: 0.35,
    clustersPerPatch: 6,
    cardsPerClusterMin: 3,
    cardsPerClusterMax: 4,
    leafCardSize: 1.15,
    leafCardSizeVariance: 0.3,
    alphaTest: 0.38,
    interiorDarkening: 0.22,
    flutterStrength: 0.055,
    barkColor: "#453531",
    barkRoughness: 0.75,
    barkStyle: "ancient",
    mossAmount: 0.25,
    showApples: false,
    appleCount: 0,
    showMushrooms: true,
    mushroomCount: 5,
    showFallingLeaves: true,
    fallingLeafCount: 120,
    windStrength: 0.5,
    windSpeed: 1.2
  },
  akkala_birch: {
    id: "akkala_birch",
    name: "B\xE9tula Dourada de Akkala",
    species: "akkala_birch",
    seed: 77,
    useSpaceColonization: true,
    scaAttractorCount: 380,
    scaAttractionRadius: 3.4,
    scaKillDistance: 0.58,
    scaStepSize: 0.38,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 11.5,
    trunkRadiusBase: 0.8,
    trunkRadiusTop: 0.25,
    trunkCurvature: 0.22,
    trunkTwist: 0.25,
    rootSpread: 0.9,
    branchCount: 7,
    branchLength: 3.4,
    branchAngle: 0.6,
    branchStartHeight: 0.52,
    canopySpread: 0.95,
    subBranchDensity: 0.5,
    foliageType: "cloud",
    clusterCount: 18,
    clusterRadius: 1.5,
    clusterDetail: 2,
    foliageColorTop: "#f9a825",
    // Akkala radiant golden-yellow
    foliageColorBottom: "#d84315",
    // autumn amber-red
    foliageRoughness: 0.35,
    celSteps: 3,
    rimLightIntensity: 0.9,
    foliageDensity: 0.72,
    patchRadius: 1.15,
    patchRadiusVariance: 0.3,
    patchSpacing: 0.85,
    patchDensity: 0.78,
    terminalBranchBias: 0.88,
    crownWidth: 0.95,
    crownHeight: 1.2,
    noiseScale: 0.38,
    noiseStrength: 0.7,
    noiseThreshold: 0.42,
    clustersPerPatch: 4,
    cardsPerClusterMin: 2,
    cardsPerClusterMax: 3,
    leafCardSize: 0.95,
    leafCardSizeVariance: 0.25,
    alphaTest: 0.42,
    interiorDarkening: 0.26,
    flutterStrength: 0.05,
    barkColor: "#e8e2d8",
    // pale white birch with ring markings
    barkRoughness: 0.5,
    barkStyle: "birch",
    mossAmount: 0.1,
    showApples: true,
    appleCount: 3,
    showMushrooms: true,
    mushroomCount: 3,
    showFallingLeaves: true,
    fallingLeafCount: 80,
    windStrength: 0.55,
    windSpeed: 1.1
  },
  hebra_pine: {
    id: "hebra_pine",
    name: "Pinheiro de Hebra",
    species: "hebra_pine",
    seed: 256,
    useSpaceColonization: true,
    scaAttractorCount: 750,
    scaAttractionRadius: 3.8,
    scaKillDistance: 0.42,
    scaStepSize: 0.32,
    scaCrownShape: "conical",
    showAttractors: false,
    trunkHeight: 14.5,
    trunkRadiusBase: 1.12,
    trunkRadiusTop: 0.18,
    trunkCurvature: 0.08,
    trunkTwist: 0.16,
    rootSpread: 1.25,
    branchCount: 11,
    branchLength: 3.8,
    branchAngle: 1.15,
    branchStartHeight: 0.35,
    canopySpread: 0.85,
    subBranchDensity: 0.72,
    foliageType: "pine_cone",
    clusterCount: 32,
    clusterRadius: 1.95,
    clusterDetail: 2,
    foliageColorTop: "#3ca85a",
    // vibrant BotW subalpine evergreen
    foliageColorBottom: "#133e24",
    foliageRoughness: 0.45,
    celSteps: 3,
    rimLightIntensity: 0.9,
    foliageDensity: 0.92,
    patchRadius: 1.35,
    patchRadiusVariance: 0.22,
    patchSpacing: 0.65,
    patchDensity: 0.88,
    terminalBranchBias: 0.88,
    crownWidth: 0.92,
    crownHeight: 1.25,
    noiseScale: 0.4,
    noiseStrength: 0.6,
    noiseThreshold: 0.36,
    clustersPerPatch: 5,
    cardsPerClusterMin: 3,
    cardsPerClusterMax: 4,
    leafCardSize: 1.25,
    leafCardSizeVariance: 0.15,
    alphaTest: 0.35,
    interiorDarkening: 0.35,
    flutterStrength: 0.032,
    barkColor: "#362217",
    barkRoughness: 0.92,
    barkStyle: "pine",
    mossAmount: 0.15,
    showApples: false,
    appleCount: 0,
    showMushrooms: true,
    mushroomCount: 6,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.55,
    windSpeed: 1.2
  },
  hebra_pine_snowy: {
    id: "hebra_pine_snowy",
    name: "Pinheiro Nevado de Hebra",
    species: "hebra_pine_snowy",
    seed: 512,
    useSpaceColonization: true,
    scaAttractorCount: 750,
    scaAttractionRadius: 3.8,
    scaKillDistance: 0.42,
    scaStepSize: 0.32,
    scaCrownShape: "conical",
    showAttractors: false,
    trunkHeight: 14.5,
    trunkRadiusBase: 1.12,
    trunkRadiusTop: 0.18,
    trunkCurvature: 0.08,
    trunkTwist: 0.16,
    rootSpread: 1.25,
    branchCount: 11,
    branchLength: 3.8,
    branchAngle: 1.15,
    branchStartHeight: 0.35,
    canopySpread: 0.85,
    subBranchDensity: 0.72,
    foliageType: "pine_cone",
    clusterCount: 32,
    clusterRadius: 1.95,
    clusterDetail: 2,
    foliageColorTop: "#3e9a72",
    // cold, blue-green needles under the snow
    foliageColorBottom: "#0f3428",
    foliageRoughness: 0.45,
    celSteps: 3,
    rimLightIntensity: 0.9,
    foliageDensity: 0.92,
    patchRadius: 1.35,
    patchRadiusVariance: 0.22,
    patchSpacing: 0.65,
    patchDensity: 0.88,
    terminalBranchBias: 0.88,
    crownWidth: 0.92,
    crownHeight: 1.25,
    noiseScale: 0.4,
    noiseStrength: 0.6,
    noiseThreshold: 0.36,
    clustersPerPatch: 5,
    cardsPerClusterMin: 3,
    cardsPerClusterMax: 4,
    leafCardSize: 1.25,
    leafCardSizeVariance: 0.15,
    alphaTest: 0.35,
    interiorDarkening: 0.35,
    flutterStrength: 0.032,
    barkColor: "#3b2a22",
    barkRoughness: 0.92,
    barkStyle: "pine",
    mossAmount: 0.05,
    snowCover: 0.85,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: true,
    // snowfall
    fallingLeafCount: 220,
    windStrength: 0.35,
    windSpeed: 1.2
  },
  faron_palm: {
    id: "faron_palm",
    name: "Palmeira de Faron",
    species: "faron_palm",
    seed: 512,
    useSpaceColonization: true,
    scaAttractorCount: 250,
    scaAttractionRadius: 3,
    scaKillDistance: 0.65,
    scaStepSize: 0.4,
    scaCrownShape: "umbrella",
    showAttractors: false,
    trunkHeight: 11,
    trunkRadiusBase: 0.9,
    trunkRadiusTop: 0.32,
    trunkCurvature: 0.85,
    trunkTwist: 0.45,
    rootSpread: 0.95,
    branchCount: 6,
    branchLength: 5,
    branchAngle: 1.1,
    branchStartHeight: 0.92,
    canopySpread: 1.45,
    subBranchDensity: 0.2,
    foliageType: "palm_frond",
    clusterCount: 16,
    clusterRadius: 2.3,
    clusterDetail: 2,
    foliageColorTop: "#7cb342",
    // lush tropical lime-emerald
    foliageColorBottom: "#2e5b1e",
    foliageRoughness: 0.32,
    celSteps: 3,
    rimLightIntensity: 1.15,
    foliageDensity: 0.65,
    patchRadius: 1.5,
    patchRadiusVariance: 0.3,
    patchSpacing: 1.1,
    patchDensity: 0.7,
    terminalBranchBias: 0.95,
    crownWidth: 1.3,
    crownHeight: 0.9,
    noiseScale: 0.3,
    noiseStrength: 0.5,
    noiseThreshold: 0.35,
    clustersPerPatch: 4,
    cardsPerClusterMin: 2,
    cardsPerClusterMax: 3,
    leafCardSize: 1.35,
    leafCardSizeVariance: 0.3,
    alphaTest: 0.4,
    interiorDarkening: 0.25,
    flutterStrength: 0.06,
    barkColor: "#6d4c41",
    barkRoughness: 0.7,
    barkStyle: "oak",
    mossAmount: 0.15,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.7,
    windSpeed: 1.4
  },
  korok_ancient: {
    id: "korok_ancient",
    name: "\xC1rvore Ancestral de Korok",
    species: "korok_ancient",
    seed: 999,
    useSpaceColonization: true,
    scaAttractorCount: 780,
    scaAttractionRadius: 4.8,
    scaKillDistance: 0.68,
    scaStepSize: 0.38,
    scaCrownShape: "umbrella",
    showAttractors: false,
    trunkHeight: 10.5,
    trunkRadiusBase: 1.85,
    trunkRadiusTop: 0.75,
    trunkCurvature: 0.42,
    trunkTwist: 0.8,
    rootSpread: 2.2,
    branchCount: 14,
    branchLength: 5.4,
    branchAngle: 0.8,
    branchStartHeight: 0.36,
    canopySpread: 1.55,
    subBranchDensity: 0.8,
    foliageType: "cloud",
    clusterCount: 30,
    clusterRadius: 2.1,
    clusterDetail: 2,
    foliageColorTop: "#55b33e",
    foliageColorBottom: "#184a1d",
    foliageRoughness: 0.4,
    celSteps: 4,
    rimLightIntensity: 1.1,
    foliageDensity: 0.9,
    patchRadius: 1.6,
    patchRadiusVariance: 0.4,
    patchSpacing: 0.75,
    patchDensity: 0.9,
    terminalBranchBias: 0.82,
    crownWidth: 1.45,
    crownHeight: 1.15,
    noiseScale: 0.25,
    noiseStrength: 0.72,
    noiseThreshold: 0.32,
    clustersPerPatch: 7,
    cardsPerClusterMin: 3,
    cardsPerClusterMax: 5,
    leafCardSize: 1.25,
    leafCardSizeVariance: 0.35,
    alphaTest: 0.4,
    interiorDarkening: 0.35,
    flutterStrength: 0.038,
    barkColor: "#3b281c",
    barkRoughness: 0.95,
    barkStyle: "ancient",
    mossAmount: 0.45,
    showApples: true,
    appleCount: 6,
    showMushrooms: true,
    mushroomCount: 12,
    showFallingLeaves: true,
    fallingLeafCount: 100,
    windStrength: 0.35,
    windSpeed: 0.8
  },
  gerudo_cactus: {
    id: "gerudo_cactus",
    name: "Cacto de Gerudo",
    species: "gerudo_cactus",
    seed: 340,
    useSpaceColonization: true,
    scaAttractorCount: 380,
    scaAttractionRadius: 3.5,
    scaKillDistance: 0.6,
    scaStepSize: 0.35,
    scaCrownShape: "candelabra",
    showAttractors: false,
    trunkHeight: 8.5,
    trunkRadiusBase: 0.95,
    trunkRadiusTop: 0.48,
    trunkCurvature: 0.35,
    trunkTwist: 0.2,
    rootSpread: 0.5,
    branchCount: 3,
    branchLength: 3.2,
    branchAngle: 0.5,
    branchStartHeight: 0.35,
    canopySpread: 1.15,
    subBranchDensity: 0.2,
    foliageType: "cactus_bloom",
    clusterCount: 8,
    clusterRadius: 1.2,
    clusterDetail: 2,
    foliageColorTop: "#7ebd38",
    // bright sunlit sage green
    foliageColorBottom: "#3a6c20",
    // deep desert shadow green
    foliageRoughness: 0.4,
    celSteps: 3,
    rimLightIntensity: 1.25,
    foliageDensity: 0.6,
    patchRadius: 1.2,
    patchRadiusVariance: 0.2,
    patchSpacing: 0.8,
    patchDensity: 0.6,
    terminalBranchBias: 0.9,
    crownWidth: 1,
    crownHeight: 1,
    noiseScale: 0.3,
    noiseStrength: 0.3,
    noiseThreshold: 0.4,
    clustersPerPatch: 3,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 3,
    leafCardSize: 1,
    leafCardSizeVariance: 0.2,
    alphaTest: 0.4,
    interiorDarkening: 0.2,
    flutterStrength: 0.02,
    barkColor: "#639b33",
    barkRoughness: 0.5,
    barkStyle: "cactus",
    mossAmount: 0,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.22,
    windSpeed: 0.7
  },
  swamp_mangrove: {
    id: "swamp_mangrove",
    name: "\xC1rvore do P\xE2ntano (Manguezal)",
    species: "swamp_mangrove",
    seed: 777,
    useSpaceColonization: true,
    scaAttractorCount: 820,
    scaAttractionRadius: 4.6,
    scaKillDistance: 0.46,
    scaStepSize: 0.32,
    scaCrownShape: "swamp_vault",
    showAttractors: false,
    trunkHeight: 10.5,
    trunkRadiusBase: 1.25,
    trunkRadiusTop: 0.42,
    trunkCurvature: 0.4,
    trunkTwist: 0.5,
    rootSpread: 1.35,
    branchCount: 10,
    branchLength: 5.4,
    branchAngle: 0.88,
    branchStartHeight: 0.48,
    canopySpread: 1.6,
    subBranchDensity: 0.75,
    foliageType: "swamp_weeping",
    clusterCount: 16,
    clusterRadius: 1.65,
    clusterDetail: 2,
    foliageColorTop: "#95e834",
    // luminous anime chartreuse from reference image
    foliageColorBottom: "#2a5416",
    // deep tropical understory green
    foliageRoughness: 0.55,
    celSteps: 3,
    rimLightIntensity: 1.05,
    foliageDensity: 0.8,
    patchRadius: 1.55,
    patchRadiusVariance: 0.3,
    patchSpacing: 1.05,
    patchDensity: 0.75,
    terminalBranchBias: 0.88,
    crownWidth: 1.55,
    crownHeight: 1.1,
    noiseScale: 0.32,
    noiseStrength: 0.65,
    noiseThreshold: 0.38,
    clustersPerPatch: 3,
    cardsPerClusterMin: 3,
    cardsPerClusterMax: 5,
    leafCardSize: 1.75,
    leafCardSizeVariance: 0.25,
    alphaTest: 0.4,
    interiorDarkening: 0.38,
    flutterStrength: 0.045,
    barkColor: "#4f3e26",
    // warm organic olive-brown bark matching roots and branches
    barkRoughness: 0.88,
    barkStyle: "swamp",
    mossAmount: 0.35,
    aerialRootCount: 8,
    aerialRootSpread: 1.45,
    aerialRootHeight: 1.75,
    showHangingMoss: true,
    hangingMossCount: 16,
    showSwampWater: true,
    showShelfMushrooms: true,
    shelfMushroomCount: 12,
    showApples: false,
    appleCount: 0,
    showMushrooms: true,
    mushroomCount: 16,
    showFallingLeaves: true,
    fallingLeafCount: 40,
    windStrength: 0.35,
    windSpeed: 0.85
  },
  savanna_acacia: {
    id: "savanna_acacia",
    name: "Ac\xE1cia da Savana",
    species: "savanna_acacia",
    growthStage: "adult",
    seed: 1207,
    useSpaceColonization: true,
    scaAttractorCount: 520,
    scaAttractionRadius: 4,
    scaKillDistance: 0.6,
    scaStepSize: 0.38,
    scaCrownShape: "flat_top",
    // wide tabletop crown over a few long, open limbs
    showAttractors: false,
    trunkHeight: 7.5,
    trunkRadiusBase: 0.95,
    trunkRadiusTop: 0.2,
    trunkCurvature: 0.35,
    trunkTwist: 0.3,
    rootSpread: 0.9,
    branchCount: 4,
    branchLength: 4.6,
    branchAngle: 0.9,
    branchStartHeight: 0.3,
    canopySpread: 1.2,
    subBranchDensity: 0.45,
    foliageType: "cloud",
    clusterCount: 30,
    clusterRadius: 1.3,
    clusterDetail: 2,
    foliageColorTop: "#9bb541",
    // sun-bleached olive of the dry season
    foliageColorBottom: "#3b5a1e",
    foliageRoughness: 0.4,
    celSteps: 3,
    rimLightIntensity: 0.45,
    foliageDensity: 0.8,
    patchRadius: 1.1,
    patchRadiusVariance: 0.25,
    patchSpacing: 0.9,
    patchDensity: 0.8,
    terminalBranchBias: 0.9,
    crownWidth: 1.4,
    crownHeight: 0.6,
    noiseScale: 0.32,
    noiseStrength: 0.5,
    noiseThreshold: 0.4,
    clustersPerPatch: 4,
    cardsPerClusterMin: 2,
    cardsPerClusterMax: 4,
    leafCardSize: 1.75,
    leafCardSizeVariance: 0.2,
    alphaTest: 0.4,
    interiorDarkening: 0.4,
    flutterStrength: 0.03,
    barkColor: "#5a4636",
    // grey-brown, deeply fissured
    barkRoughness: 0.9,
    barkStyle: "oak",
    mossAmount: 0,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: true,
    fallingLeafCount: 25,
    windStrength: 0.4,
    windSpeed: 0.9
  },
  // =========================================================================
  // MUDAS & BROTOS JOVENS (SAPLINGS & SPROUTS)
  // Versões genuinamente jovens, compactas e delicadas (0.8m - 1.4m de altura)
  // =========================================================================
  hyrule_oak_sapling: {
    id: "hyrule_oak_sapling",
    name: "Muda de Carvalho de Hyrule",
    species: "hyrule_oak_sapling",
    growthStage: "sapling",
    seed: 420,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.3,
    scaStepSize: 0.15,
    scaCrownShape: "dome",
    showAttractors: false,
    trunkHeight: 1.2,
    // muda tenra de 1.2 metros
    trunkRadiusBase: 0.06,
    trunkRadiusTop: 0.028,
    trunkCurvature: 0.18,
    trunkTwist: 0.15,
    rootSpread: 0.28,
    branchCount: 0,
    branchLength: 0.45,
    branchAngle: 0.65,
    branchStartHeight: 0.5,
    canopySpread: 0.55,
    subBranchDensity: 0.1,
    foliageType: "cloud",
    clusterCount: 4,
    clusterRadius: 0.45,
    clusterDetail: 1,
    foliageColorTop: "#8fe83a",
    // broto verde limão tenro e vibrante
    foliageColorBottom: "#2d6d1b",
    foliageRoughness: 0.35,
    celSteps: 3,
    rimLightIntensity: 0.95,
    foliageDensity: 0.6,
    patchRadius: 0.45,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.6,
    terminalBranchBias: 0.9,
    crownWidth: 0.55,
    crownHeight: 0.45,
    noiseScale: 0.35,
    noiseStrength: 0.4,
    noiseThreshold: 0.38,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.35,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.15,
    flutterStrength: 0.04,
    barkColor: "#6e472a",
    barkRoughness: 0.7,
    barkStyle: "oak",
    mossAmount: 0.1,
    showApples: true,
    // pequeno broto de maçã
    appleCount: 1,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.35,
    windSpeed: 1
  },
  satori_sakura_sapling: {
    id: "satori_sakura_sapling",
    name: "Muda de Cerejeira de Satori",
    species: "satori_sakura_sapling",
    growthStage: "sapling",
    seed: 1080,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.3,
    scaStepSize: 0.15,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 1.25,
    // ramo jovem esbelto
    trunkRadiusBase: 0.055,
    trunkRadiusTop: 0.025,
    trunkCurvature: 0.28,
    trunkTwist: 0.25,
    rootSpread: 0.25,
    branchCount: 0,
    branchLength: 0.4,
    branchAngle: 0.7,
    branchStartHeight: 0.55,
    canopySpread: 0.5,
    subBranchDensity: 0.1,
    foliageType: "cloud",
    clusterCount: 4,
    clusterRadius: 0.4,
    clusterDetail: 1,
    foliageColorTop: "#ffb9d8",
    // pétalas jovens cor-de-rosa translúcidas
    foliageColorBottom: "#d94c8b",
    foliageRoughness: 0.3,
    celSteps: 3,
    rimLightIntensity: 1.3,
    foliageDensity: 0.65,
    patchRadius: 0.4,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.65,
    terminalBranchBias: 0.9,
    crownWidth: 0.5,
    crownHeight: 0.45,
    noiseScale: 0.28,
    noiseStrength: 0.4,
    noiseThreshold: 0.35,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.35,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.38,
    interiorDarkening: 0.15,
    flutterStrength: 0.05,
    barkColor: "#52403b",
    barkRoughness: 0.65,
    barkStyle: "ancient",
    mossAmount: 0.15,
    showApples: false,
    appleCount: 0,
    showMushrooms: true,
    mushroomCount: 1,
    showFallingLeaves: true,
    fallingLeafCount: 6,
    // algumas poucas pétalas flutuando sutilmente
    windStrength: 0.4,
    windSpeed: 1.1
  },
  akkala_birch_sapling: {
    id: "akkala_birch_sapling",
    name: "Muda de B\xE9tula de Akkala",
    species: "akkala_birch_sapling",
    growthStage: "sapling",
    seed: 770,
    useSpaceColonization: false,
    scaAttractorCount: 75,
    scaAttractionRadius: 0.9,
    scaKillDistance: 0.3,
    scaStepSize: 0.15,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 1.35,
    // haste alvo esguia
    trunkRadiusBase: 0.048,
    trunkRadiusTop: 0.022,
    trunkCurvature: 0.15,
    trunkTwist: 0.12,
    rootSpread: 0.22,
    branchCount: 0,
    branchLength: 0.35,
    branchAngle: 0.55,
    branchStartHeight: 0.6,
    canopySpread: 0.45,
    subBranchDensity: 0.1,
    foliageType: "cloud",
    clusterCount: 4,
    clusterRadius: 0.38,
    clusterDetail: 1,
    foliageColorTop: "#ffba24",
    // folhas douradas brilhantes de outono
    foliageColorBottom: "#e65100",
    foliageRoughness: 0.35,
    celSteps: 3,
    rimLightIntensity: 1.05,
    foliageDensity: 0.65,
    patchRadius: 0.4,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.65,
    terminalBranchBias: 0.9,
    crownWidth: 0.45,
    crownHeight: 0.45,
    noiseScale: 0.32,
    noiseStrength: 0.4,
    noiseThreshold: 0.38,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.32,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.15,
    flutterStrength: 0.05,
    barkColor: "#f2ede6",
    // tronco alvo esguio
    barkRoughness: 0.4,
    barkStyle: "birch",
    mossAmount: 0.05,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.4,
    windSpeed: 1.1
  },
  hebra_pine_sapling: {
    id: "hebra_pine_sapling",
    name: "Muda de Pinheiro de Hebra",
    species: "hebra_pine_sapling",
    growthStage: "sapling",
    seed: 2560,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.25,
    scaStepSize: 0.14,
    scaCrownShape: "conical",
    showAttractors: false,
    trunkHeight: 1.05,
    // conífera brotando delicadamente
    trunkRadiusBase: 0.055,
    trunkRadiusTop: 0.024,
    trunkCurvature: 0.04,
    trunkTwist: 0.08,
    rootSpread: 0.25,
    branchCount: 0,
    branchLength: 0.35,
    branchAngle: 1.05,
    branchStartHeight: 0.3,
    canopySpread: 0.45,
    subBranchDensity: 0.1,
    foliageType: "pine_cone",
    clusterCount: 3,
    clusterRadius: 0.4,
    clusterDetail: 1,
    foliageColorTop: "#45be65",
    // broto jovem conífero
    foliageColorBottom: "#134724",
    foliageRoughness: 0.45,
    celSteps: 3,
    rimLightIntensity: 0.95,
    foliageDensity: 0.7,
    patchRadius: 0.4,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.7,
    terminalBranchBias: 0.9,
    crownWidth: 0.45,
    crownHeight: 0.5,
    noiseScale: 0.4,
    noiseStrength: 0.4,
    noiseThreshold: 0.36,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.35,
    leafCardSizeVariance: 0.08,
    alphaTest: 0.35,
    interiorDarkening: 0.2,
    flutterStrength: 0.03,
    barkColor: "#3a2419",
    barkRoughness: 0.8,
    barkStyle: "pine",
    mossAmount: 0.1,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.4,
    windSpeed: 1.1
  },
  hebra_pine_snowy_sapling: {
    id: "hebra_pine_snowy_sapling",
    name: "Muda de Pinheiro Nevado de Hebra",
    species: "hebra_pine_snowy_sapling",
    growthStage: "sapling",
    seed: 5120,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.25,
    scaStepSize: 0.14,
    scaCrownShape: "conical",
    showAttractors: false,
    trunkHeight: 1.05,
    // conífera brotando delicadamente
    trunkRadiusBase: 0.055,
    trunkRadiusTop: 0.024,
    trunkCurvature: 0.04,
    trunkTwist: 0.08,
    rootSpread: 0.25,
    branchCount: 0,
    branchLength: 0.35,
    branchAngle: 1.05,
    branchStartHeight: 0.3,
    canopySpread: 0.45,
    subBranchDensity: 0.1,
    foliageType: "pine_cone",
    clusterCount: 3,
    clusterRadius: 0.4,
    clusterDetail: 1,
    foliageColorTop: "#44ad78",
    // young needles, cooled by the snow
    foliageColorBottom: "#113f2b",
    foliageRoughness: 0.45,
    celSteps: 3,
    rimLightIntensity: 0.95,
    foliageDensity: 0.7,
    patchRadius: 0.4,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.7,
    terminalBranchBias: 0.9,
    crownWidth: 0.45,
    crownHeight: 0.5,
    noiseScale: 0.4,
    noiseStrength: 0.4,
    noiseThreshold: 0.36,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.35,
    leafCardSizeVariance: 0.08,
    alphaTest: 0.35,
    interiorDarkening: 0.2,
    flutterStrength: 0.03,
    barkColor: "#3a2419",
    barkRoughness: 0.8,
    barkStyle: "pine",
    mossAmount: 0,
    snowCover: 0.8,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: true,
    // snowfall
    fallingLeafCount: 70,
    windStrength: 0.3,
    windSpeed: 1.1
  },
  faron_palm_sapling: {
    id: "faron_palm_sapling",
    name: "Broto de Palmeira de Faron",
    species: "faron_palm_sapling",
    growthStage: "sapling",
    seed: 5120,
    useSpaceColonization: false,
    scaAttractorCount: 60,
    scaAttractionRadius: 1,
    scaKillDistance: 0.3,
    scaStepSize: 0.15,
    scaCrownShape: "umbrella",
    showAttractors: false,
    trunkHeight: 1.1,
    // broto esguio emergindo do coco
    trunkRadiusBase: 0.05,
    trunkRadiusTop: 0.026,
    trunkCurvature: 0.45,
    trunkTwist: 0.25,
    rootSpread: 0.22,
    branchCount: 0,
    branchLength: 0.5,
    branchAngle: 1,
    branchStartHeight: 0.8,
    canopySpread: 0.65,
    subBranchDensity: 0,
    foliageType: "palm_frond",
    clusterCount: 4,
    clusterRadius: 0.5,
    clusterDetail: 1,
    foliageColorTop: "#8cc838",
    // frondes tropicais jovens cor de limão fresco
    foliageColorBottom: "#2d681c",
    foliageRoughness: 0.32,
    celSteps: 3,
    rimLightIntensity: 1.2,
    foliageDensity: 0.65,
    patchRadius: 0.5,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.35,
    patchDensity: 0.65,
    terminalBranchBias: 0.95,
    crownWidth: 0.65,
    crownHeight: 0.4,
    noiseScale: 0.35,
    noiseStrength: 0.4,
    noiseThreshold: 0.4,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.4,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.15,
    flutterStrength: 0.08,
    barkColor: "#7a554a",
    barkRoughness: 0.6,
    barkStyle: "oak",
    mossAmount: 0.08,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.5,
    windSpeed: 1.2
  },
  korok_ancient_sapling: {
    id: "korok_ancient_sapling",
    name: "Broto da \xC1rvore Ancestral Korok",
    species: "korok_ancient_sapling",
    growthStage: "sapling",
    seed: 9990,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.3,
    scaStepSize: 0.15,
    scaCrownShape: "umbrella",
    showAttractors: false,
    trunkHeight: 1.2,
    // muda mística da floresta Korok
    trunkRadiusBase: 0.065,
    trunkRadiusTop: 0.03,
    trunkCurvature: 0.25,
    trunkTwist: 0.35,
    rootSpread: 0.32,
    branchCount: 0,
    branchLength: 0.45,
    branchAngle: 0.75,
    branchStartHeight: 0.5,
    canopySpread: 0.6,
    subBranchDensity: 0.1,
    foliageType: "cloud",
    clusterCount: 4,
    clusterRadius: 0.45,
    clusterDetail: 1,
    foliageColorTop: "#68c642",
    // jovem copa mística de Deku
    foliageColorBottom: "#1b541d",
    foliageRoughness: 0.4,
    celSteps: 4,
    rimLightIntensity: 1.2,
    foliageDensity: 0.7,
    patchRadius: 0.45,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.7,
    terminalBranchBias: 0.88,
    crownWidth: 0.6,
    crownHeight: 0.45,
    noiseScale: 0.25,
    noiseStrength: 0.4,
    noiseThreshold: 0.32,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.4,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.18,
    flutterStrength: 0.04,
    barkColor: "#453022",
    barkRoughness: 0.8,
    barkStyle: "ancient",
    mossAmount: 0.4,
    showApples: false,
    appleCount: 0,
    showMushrooms: true,
    mushroomCount: 2,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.35,
    windSpeed: 0.9
  },
  gerudo_cactus_sapling: {
    id: "gerudo_cactus_sapling",
    name: "Muda de Cacto de Gerudo",
    species: "gerudo_cactus_sapling",
    growthStage: "sapling",
    seed: 3400,
    useSpaceColonization: false,
    scaAttractorCount: 60,
    scaAttractionRadius: 0.8,
    scaKillDistance: 0.3,
    scaStepSize: 0.15,
    scaCrownShape: "candelabra",
    showAttractors: false,
    trunkHeight: 0.78,
    // broto gordinho e fofo de cacto de deserto
    trunkRadiusBase: 0.19,
    trunkRadiusTop: 0.14,
    trunkCurvature: 0.05,
    trunkTwist: 0.05,
    rootSpread: 0.22,
    branchCount: 0,
    // coluna única carnosa com flor/broto no ápice
    branchLength: 0.2,
    branchAngle: 0.5,
    branchStartHeight: 0.4,
    canopySpread: 0.35,
    subBranchDensity: 0,
    foliageType: "cactus_bloom",
    clusterCount: 1,
    clusterRadius: 0.3,
    clusterDetail: 1,
    foliageColorTop: "#8cdb3e",
    // broto carnoso fresco e brilhante
    foliageColorBottom: "#3d7222",
    foliageRoughness: 0.4,
    celSteps: 3,
    rimLightIntensity: 1.3,
    foliageDensity: 0.5,
    patchRadius: 0.35,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.5,
    terminalBranchBias: 0.9,
    crownWidth: 0.35,
    crownHeight: 0.35,
    noiseScale: 0.3,
    noiseStrength: 0.2,
    noiseThreshold: 0.4,
    clustersPerPatch: 1,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 1,
    leafCardSize: 0.35,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.15,
    flutterStrength: 0.02,
    barkColor: "#6da638",
    barkRoughness: 0.4,
    barkStyle: "cactus",
    mossAmount: 0,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.2,
    windSpeed: 0.7
  },
  swamp_mangrove_sapling: {
    id: "swamp_mangrove_sapling",
    name: "Muda de Manguezal do P\xE2ntano",
    species: "swamp_mangrove_sapling",
    growthStage: "sapling",
    seed: 7770,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.25,
    scaStepSize: 0.15,
    scaCrownShape: "swamp_vault",
    showAttractors: false,
    trunkHeight: 1.1,
    // propágulo vivíparo ereto com folhas apicais
    trunkRadiusBase: 0.06,
    trunkRadiusTop: 0.03,
    trunkCurvature: 0.12,
    trunkTwist: 0.15,
    rootSpread: 0.35,
    branchCount: 0,
    branchLength: 0.35,
    branchAngle: 0.7,
    branchStartHeight: 0.5,
    canopySpread: 0.55,
    subBranchDensity: 0.1,
    foliageType: "swamp_weeping",
    clusterCount: 4,
    clusterRadius: 0.45,
    clusterDetail: 1,
    foliageColorTop: "#82d22e",
    // folhas tenras brilhantes de mangue
    foliageColorBottom: "#285812",
    foliageRoughness: 0.45,
    celSteps: 3,
    rimLightIntensity: 1.1,
    foliageDensity: 0.65,
    patchRadius: 0.45,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.65,
    terminalBranchBias: 0.9,
    crownWidth: 0.55,
    crownHeight: 0.4,
    noiseScale: 0.32,
    noiseStrength: 0.4,
    noiseThreshold: 0.38,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.45,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.2,
    flutterStrength: 0.04,
    barkColor: "#5c4832",
    barkRoughness: 0.75,
    barkStyle: "swamp",
    mossAmount: 0.35,
    aerialRootCount: 3,
    // 3 pequenas raízes escoras jovens
    aerialRootSpread: 0.4,
    aerialRootHeight: 0.3,
    showHangingMoss: false,
    hangingMossCount: 0,
    showSwampWater: true,
    showShelfMushrooms: false,
    shelfMushroomCount: 0,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.3,
    windSpeed: 0.85
  },
  dry_withered: {
    id: "dry_withered",
    name: "\xC1rvore Seca de Hyrule",
    species: "dry_withered",
    growthStage: "adult",
    seed: 5150,
    useSpaceColonization: true,
    scaAttractorCount: 680,
    scaAttractionRadius: 4.5,
    scaKillDistance: 0.55,
    scaStepSize: 0.32,
    scaCrownShape: "gnarled",
    showAttractors: false,
    trunkHeight: 8.8,
    trunkRadiusBase: 1.15,
    trunkRadiusTop: 0.38,
    trunkCurvature: 0.58,
    // tronco com curvatura orgânica e porte altivo
    trunkTwist: 0.75,
    // veios torcidos de madeira morta
    rootSpread: 1.55,
    // raízes expostas e ressequidas
    branchCount: 8,
    // galhos mestres esculturais bem definidos
    branchLength: 5.6,
    branchAngle: 0.88,
    branchStartHeight: 0.35,
    canopySpread: 1.35,
    subBranchDensity: 0.85,
    // ramificação de galhos e gravetos pontiagudos nus
    foliageType: "none",
    // sem folhagem (esqueleto botânico puro)
    clusterCount: 0,
    clusterRadius: 1.5,
    clusterDetail: 1,
    foliageColorTop: "#bba588",
    // poeira de madeira seca / palha
    foliageColorBottom: "#635343",
    foliageRoughness: 0.9,
    celSteps: 3,
    rimLightIntensity: 0.7,
    foliageDensity: 0,
    patchRadius: 1,
    patchRadiusVariance: 0.2,
    patchSpacing: 0.8,
    patchDensity: 0,
    terminalBranchBias: 0.85,
    crownWidth: 1.25,
    crownHeight: 1.1,
    noiseScale: 0.35,
    noiseStrength: 0.5,
    noiseThreshold: 0.38,
    clustersPerPatch: 1,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 1,
    leafCardSize: 0.5,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.2,
    flutterStrength: 0.02,
    barkColor: "#7a6f64",
    // tom cinza-esbranquiçado de madeira seca curtida ao sol
    barkRoughness: 0.95,
    barkStyle: "deadwood",
    mossAmount: 0.05,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: true,
    fallingLeafCount: 20,
    windStrength: 0.45,
    windSpeed: 1.1
  },
  dry_withered_sapling: {
    id: "dry_withered_sapling",
    name: "Muda Seca de Hyrule",
    species: "dry_withered_sapling",
    growthStage: "sapling",
    seed: 5151,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.25,
    scaStepSize: 0.15,
    scaCrownShape: "gnarled",
    showAttractors: false,
    trunkHeight: 1.15,
    // pequeno arbusto de gravetos secos
    trunkRadiusBase: 0.065,
    trunkRadiusTop: 0.028,
    trunkCurvature: 0.45,
    trunkTwist: 0.65,
    rootSpread: 0.35,
    branchCount: 3,
    branchLength: 0.38,
    branchAngle: 0.85,
    branchStartHeight: 0.4,
    canopySpread: 0.6,
    subBranchDensity: 0.4,
    foliageType: "none",
    clusterCount: 0,
    clusterRadius: 0.3,
    clusterDetail: 1,
    foliageColorTop: "#bba588",
    foliageColorBottom: "#635343",
    foliageRoughness: 0.9,
    celSteps: 3,
    rimLightIntensity: 0.7,
    foliageDensity: 0,
    patchRadius: 0.4,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0,
    terminalBranchBias: 0.85,
    crownWidth: 0.6,
    crownHeight: 0.4,
    noiseScale: 0.35,
    noiseStrength: 0.5,
    noiseThreshold: 0.38,
    clustersPerPatch: 1,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 1,
    leafCardSize: 0.3,
    leafCardSizeVariance: 0.1,
    alphaTest: 0.4,
    interiorDarkening: 0.2,
    flutterStrength: 0.02,
    barkColor: "#7a6f64",
    barkRoughness: 0.92,
    barkStyle: "deadwood",
    mossAmount: 0.04,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.3,
    windSpeed: 0.85
  },
  savanna_acacia_sapling: {
    id: "savanna_acacia_sapling",
    name: "Muda de Ac\xE1cia da Savana",
    species: "savanna_acacia_sapling",
    growthStage: "sapling",
    seed: 12070,
    useSpaceColonization: false,
    scaAttractorCount: 80,
    scaAttractionRadius: 1,
    scaKillDistance: 0.25,
    scaStepSize: 0.14,
    scaCrownShape: "flat_top",
    showAttractors: false,
    trunkHeight: 1,
    // espinhosa, com uma mini copa achatada
    trunkRadiusBase: 0.05,
    trunkRadiusTop: 0.02,
    trunkCurvature: 0.2,
    trunkTwist: 0.1,
    rootSpread: 0.25,
    branchCount: 0,
    branchLength: 0.35,
    branchAngle: 0.9,
    branchStartHeight: 0.4,
    canopySpread: 0.6,
    subBranchDensity: 0.1,
    foliageType: "cloud",
    clusterCount: 3,
    clusterRadius: 0.4,
    clusterDetail: 1,
    foliageColorTop: "#a6c24a",
    foliageColorBottom: "#405f20",
    foliageRoughness: 0.4,
    celSteps: 3,
    rimLightIntensity: 0.8,
    foliageDensity: 0.7,
    patchRadius: 0.4,
    patchRadiusVariance: 0.1,
    patchSpacing: 0.3,
    patchDensity: 0.7,
    terminalBranchBias: 0.9,
    crownWidth: 0.6,
    crownHeight: 0.3,
    noiseScale: 0.4,
    noiseStrength: 0.4,
    noiseThreshold: 0.36,
    clustersPerPatch: 2,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 2,
    leafCardSize: 0.35,
    leafCardSizeVariance: 0.08,
    alphaTest: 0.35,
    interiorDarkening: 0.2,
    flutterStrength: 0.03,
    barkColor: "#6b5140",
    barkRoughness: 0.8,
    barkStyle: "oak",
    mossAmount: 0,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.35,
    windSpeed: 0.9
  },
  // =========================================================================
  // ARBUSTOS (SHRUBS)
  // Grown by the same space colonisation as the trees, branching right at the
  // ground into several stems, leafy all the way down (growthStage 'shrub').
  // =========================================================================
  hyrule_shrub: {
    id: "hyrule_shrub",
    name: "Arbusto de Hyrule",
    species: "hyrule_shrub",
    growthStage: "shrub",
    seed: 311,
    useSpaceColonization: true,
    scaAttractorCount: 420,
    scaAttractionRadius: 1.1,
    scaKillDistance: 0.16,
    scaStepSize: 0.1,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 1.5,
    trunkRadiusBase: 0.06,
    trunkRadiusTop: 0.02,
    trunkCurvature: 0.2,
    trunkTwist: 0.2,
    rootSpread: 0.1,
    branchCount: 6,
    branchLength: 0.3,
    branchAngle: 0.8,
    branchStartHeight: 0.04,
    canopySpread: 0.85,
    subBranchDensity: 0.6,
    foliageType: "cloud",
    clusterCount: 24,
    clusterRadius: 0.55,
    clusterDetail: 2,
    foliageColorTop: "#6cb33e",
    // the round, bright bush of Hyrule Field
    foliageColorBottom: "#1f4a1c",
    foliageRoughness: 0.4,
    celSteps: 3,
    rimLightIntensity: 0.5,
    foliageDensity: 0.85,
    patchRadius: 0.5,
    patchRadiusVariance: 0.2,
    patchSpacing: 0.35,
    patchDensity: 0.85,
    terminalBranchBias: 0.9,
    crownWidth: 1,
    crownHeight: 1,
    noiseScale: 0.5,
    noiseStrength: 0.5,
    noiseThreshold: 0.4,
    clustersPerPatch: 4,
    cardsPerClusterMin: 2,
    cardsPerClusterMax: 4,
    leafCardSize: 0.6,
    leafCardSizeVariance: 0.2,
    alphaTest: 0.4,
    interiorDarkening: 0.45,
    flutterStrength: 0.03,
    barkColor: "#5a3d26",
    barkRoughness: 0.8,
    barkStyle: "oak",
    mossAmount: 0.05,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.3,
    windSpeed: 1
  },
  berry_shrub: {
    id: "berry_shrub",
    name: "Arbusto de Frutinhas",
    species: "berry_shrub",
    growthStage: "shrub",
    seed: 422,
    useSpaceColonization: true,
    scaAttractorCount: 420,
    scaAttractionRadius: 1.1,
    scaKillDistance: 0.16,
    scaStepSize: 0.1,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 1.4,
    trunkRadiusBase: 0.06,
    trunkRadiusTop: 0.02,
    trunkCurvature: 0.25,
    trunkTwist: 0.2,
    rootSpread: 0.1,
    branchCount: 6,
    branchLength: 0.3,
    branchAngle: 0.8,
    branchStartHeight: 0.04,
    canopySpread: 0.85,
    subBranchDensity: 0.6,
    foliageType: "cloud",
    clusterCount: 24,
    clusterRadius: 0.55,
    clusterDetail: 2,
    foliageColorTop: "#4f9a3a",
    // deeper green, so the berries stand out
    foliageColorBottom: "#173d1a",
    foliageRoughness: 0.4,
    celSteps: 3,
    rimLightIntensity: 0.5,
    foliageDensity: 0.85,
    patchRadius: 0.5,
    patchRadiusVariance: 0.2,
    patchSpacing: 0.35,
    patchDensity: 0.85,
    terminalBranchBias: 0.9,
    crownWidth: 1,
    crownHeight: 1,
    noiseScale: 0.5,
    noiseStrength: 0.5,
    noiseThreshold: 0.4,
    clustersPerPatch: 4,
    cardsPerClusterMin: 2,
    cardsPerClusterMax: 4,
    leafCardSize: 0.6,
    leafCardSizeVariance: 0.2,
    alphaTest: 0.4,
    interiorDarkening: 0.45,
    flutterStrength: 0.03,
    barkColor: "#4e3524",
    barkRoughness: 0.8,
    barkStyle: "oak",
    mossAmount: 0.05,
    showApples: true,
    appleCount: 8,
    bushAccent: "berries",
    accentColor: "#b0203a",
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.3,
    windSpeed: 1
  },
  flowering_shrub: {
    id: "flowering_shrub",
    name: "Arbusto Florido",
    species: "flowering_shrub",
    growthStage: "shrub",
    seed: 533,
    useSpaceColonization: true,
    scaAttractorCount: 440,
    scaAttractionRadius: 1.1,
    scaKillDistance: 0.16,
    scaStepSize: 0.1,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 1.6,
    trunkRadiusBase: 0.06,
    trunkRadiusTop: 0.02,
    trunkCurvature: 0.2,
    trunkTwist: 0.2,
    rootSpread: 0.1,
    branchCount: 6,
    branchLength: 0.35,
    branchAngle: 0.8,
    branchStartHeight: 0.04,
    canopySpread: 0.9,
    subBranchDensity: 0.6,
    foliageType: "cloud",
    clusterCount: 24,
    clusterRadius: 0.55,
    clusterDetail: 2,
    foliageColorTop: "#7cbf4a",
    foliageColorBottom: "#24521f",
    foliageRoughness: 0.4,
    celSteps: 3,
    rimLightIntensity: 0.5,
    foliageDensity: 0.85,
    patchRadius: 0.5,
    patchRadiusVariance: 0.2,
    patchSpacing: 0.35,
    patchDensity: 0.85,
    terminalBranchBias: 0.9,
    crownWidth: 1,
    crownHeight: 1,
    noiseScale: 0.5,
    noiseStrength: 0.5,
    noiseThreshold: 0.4,
    clustersPerPatch: 4,
    cardsPerClusterMin: 2,
    cardsPerClusterMax: 4,
    leafCardSize: 0.6,
    leafCardSizeVariance: 0.2,
    alphaTest: 0.4,
    interiorDarkening: 0.45,
    flutterStrength: 0.03,
    barkColor: "#5a3d26",
    barkRoughness: 0.8,
    barkStyle: "oak",
    mossAmount: 0.05,
    showApples: true,
    appleCount: 14,
    bushAccent: "flowers",
    accentColor: "#f28ab8",
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.3,
    windSpeed: 1
  },
  desert_shrub: {
    id: "desert_shrub",
    name: "Arbusto do Deserto",
    species: "desert_shrub",
    growthStage: "shrub",
    seed: 644,
    useSpaceColonization: true,
    scaAttractorCount: 260,
    scaAttractionRadius: 1,
    scaKillDistance: 0.18,
    scaStepSize: 0.1,
    scaCrownShape: "sphere",
    showAttractors: false,
    trunkHeight: 1.2,
    trunkRadiusBase: 0.055,
    trunkRadiusTop: 0.018,
    trunkCurvature: 0.45,
    trunkTwist: 0.4,
    rootSpread: 0.1,
    branchCount: 5,
    branchLength: 0.25,
    branchAngle: 0.9,
    branchStartHeight: 0.04,
    canopySpread: 0.75,
    subBranchDensity: 0.4,
    foliageType: "cloud",
    clusterCount: 16,
    clusterRadius: 0.45,
    clusterDetail: 1,
    foliageColorTop: "#a9b97a",
    // dusty sage of the Gerudo scrub
    foliageColorBottom: "#56663d",
    foliageRoughness: 0.5,
    celSteps: 3,
    rimLightIntensity: 0.4,
    foliageDensity: 0.55,
    patchRadius: 0.4,
    patchRadiusVariance: 0.2,
    patchSpacing: 0.4,
    patchDensity: 0.6,
    terminalBranchBias: 0.9,
    crownWidth: 1,
    crownHeight: 0.9,
    noiseScale: 0.5,
    noiseStrength: 0.5,
    noiseThreshold: 0.45,
    clustersPerPatch: 3,
    cardsPerClusterMin: 1,
    cardsPerClusterMax: 3,
    leafCardSize: 0.45,
    leafCardSizeVariance: 0.2,
    alphaTest: 0.45,
    interiorDarkening: 0.3,
    flutterStrength: 0.02,
    barkColor: "#8a7a66",
    barkRoughness: 0.9,
    barkStyle: "oak",
    mossAmount: 0,
    showApples: false,
    appleCount: 0,
    showMushrooms: false,
    mushroomCount: 0,
    showFallingLeaves: false,
    fallingLeafCount: 0,
    windStrength: 0.35,
    windSpeed: 1
  },
  // --- One bush per biome, next to that biome's tree ----------------------
  satori_shrub: {
    ...SHRUB_BASE,
    id: "satori_shrub",
    name: "Arbusto de Satori",
    species: "satori_shrub",
    seed: 755,
    trunkHeight: 1.6,
    canopySpread: 0.9,
    foliageColorTop: "#ffa3cb",
    // the sacred pink of the Satori grove
    foliageColorBottom: "#d44f88",
    barkColor: "#453531",
    barkStyle: "ancient"
  },
  akkala_shrub: {
    ...SHRUB_BASE,
    id: "akkala_shrub",
    name: "Arbusto de Akkala",
    species: "akkala_shrub",
    seed: 866,
    trunkHeight: 1.4,
    foliageColorTop: "#f9a825",
    // Akkala's autumn gold into amber-red
    foliageColorBottom: "#d84315",
    barkColor: "#e8e2d8",
    barkStyle: "birch",
    mossAmount: 0
  },
  hebra_shrub: {
    ...SHRUB_BASE,
    id: "hebra_shrub",
    name: "Arbusto de Hebra",
    species: "hebra_shrub",
    seed: 977,
    trunkHeight: 1.3,
    crownHeight: 0.9,
    foliageColorTop: "#4f8f6e",
    // cold alpine evergreen
    foliageColorBottom: "#12352b",
    barkColor: "#4a3528",
    barkStyle: "pine",
    mossAmount: 0,
    windStrength: 0.4
  },
  hebra_shrub_snowy: {
    ...SHRUB_BASE,
    id: "hebra_shrub_snowy",
    name: "Arbusto de Hebra Nevado",
    species: "hebra_shrub_snowy",
    seed: 988,
    trunkHeight: 1.3,
    crownHeight: 0.9,
    foliageColorTop: "#4f8f6e",
    // the same evergreen, under the snow
    foliageColorBottom: "#12352b",
    barkColor: "#4a3528",
    barkStyle: "pine",
    mossAmount: 0,
    snowCover: 0.6,
    windStrength: 0.4
  },
  faron_shrub: {
    ...SHRUB_BASE,
    id: "faron_shrub",
    name: "Arbusto de Faron",
    species: "faron_shrub",
    seed: 1088,
    trunkHeight: 1.6,
    canopySpread: 0.95,
    leafCardSize: 0.75,
    // big tropical leaves
    foliageColorTop: "#5fd14a",
    foliageColorBottom: "#0f5a2a",
    barkColor: "#6b4a2e",
    showApples: true,
    appleCount: 10,
    bushAccent: "flowers",
    accentColor: "#ff5a3c"
    // hibiscus red
  },
  korok_shrub: {
    ...SHRUB_BASE,
    id: "korok_shrub",
    name: "Arbusto Korok",
    species: "korok_shrub",
    seed: 1199,
    trunkHeight: 1.5,
    foliageColorTop: "#55b33e",
    // the deep green of the Korok Forest
    foliageColorBottom: "#184a1d",
    barkColor: "#3b281c",
    barkStyle: "ancient",
    mossAmount: 0.35
  },
  swamp_shrub: {
    ...SHRUB_BASE,
    id: "swamp_shrub",
    name: "Arbusto do P\xE2ntano",
    species: "swamp_shrub",
    seed: 1310,
    trunkHeight: 1.3,
    trunkCurvature: 0.4,
    canopySpread: 1,
    crownWidth: 1.15,
    crownHeight: 0.8,
    foliageColorTop: "#8a9a3e",
    // murky olive of the marsh
    foliageColorBottom: "#26331a",
    barkColor: "#3a2e22",
    mossAmount: 0.4
  },
  savanna_shrub: {
    ...SHRUB_BASE,
    id: "savanna_shrub",
    name: "Arbusto da Savana",
    species: "savanna_shrub",
    seed: 1421,
    scaAttractorCount: 320,
    trunkHeight: 1.2,
    trunkCurvature: 0.35,
    canopySpread: 1,
    crownWidth: 1.25,
    crownHeight: 0.75,
    clusterCount: 18,
    foliageDensity: 0.65,
    patchDensity: 0.7,
    leafCardSize: 0.5,
    foliageColorTop: "#c2b64a",
    // sun-bleached olive of the grassland
    foliageColorBottom: "#5e5a24",
    barkColor: "#6b4a33",
    mossAmount: 0,
    windStrength: 0.4
  },
  withered_shrub: {
    ...SHRUB_BASE,
    id: "withered_shrub",
    name: "Arbusto Seco",
    species: "withered_shrub",
    seed: 1532,
    scaAttractorCount: 300,
    trunkHeight: 1.3,
    trunkCurvature: 0.5,
    trunkTwist: 0.5,
    branchAngle: 0.9,
    foliageType: "none",
    // bare, brittle twigs
    clusterCount: 0,
    foliageDensity: 0,
    patchDensity: 0,
    foliageColorTop: "#bba588",
    foliageColorBottom: "#635343",
    barkColor: "#7a6f64",
    barkRoughness: 0.95,
    barkStyle: "deadwood",
    mossAmount: 0,
    windStrength: 0.45
  },
  fallen_log: {
    ...LOG_BASE,
    id: "fallen_log",
    name: "Tronco Ca\xEDdo",
    species: "fallen_log",
    seed: 2101
  },
  hollow_log: {
    ...LOG_BASE,
    id: "hollow_log",
    name: "Tronco Oco",
    species: "hollow_log",
    seed: 2212,
    trunkHeight: 4.2,
    trunkRadiusBase: 0.72,
    trunkRadiusTop: 0.66,
    trunkCurvature: 0.12,
    branchCount: 1,
    foliageColorTop: "#7a9a3c",
    barkColor: "#54402f",
    mossAmount: 0.6,
    mushroomCount: 9
  },
  rooted_log: {
    ...LOG_BASE,
    id: "rooted_log",
    name: "Tronco com Ra\xEDzes",
    species: "rooted_log",
    seed: 2323,
    trunkHeight: 6,
    trunkRadiusBase: 0.5,
    trunkRadiusTop: 0.36,
    rootSpread: 1.2,
    branchCount: 4,
    foliageColorTop: "#8a6a45",
    // the torn-up earth of its root plate
    barkColor: "#6a4c34",
    mossAmount: 0.25,
    mushroomCount: 3
  },
  tree_stump: {
    ...LOG_BASE,
    id: "tree_stump",
    name: "Toco",
    species: "tree_stump",
    seed: 2434,
    trunkHeight: 0.9,
    trunkRadiusBase: 0.62,
    trunkRadiusTop: 0.58,
    rootSpread: 1,
    branchCount: 0,
    foliageColorTop: "#c9a36b",
    // the pale cut face with its rings
    barkColor: "#5a3f2b",
    mossAmount: 0.35,
    mushroomCount: 6
  },
  maple_red: {
    ...MAPLE_BASE,
    id: "maple_red",
    name: "Bordo Outonal (Vermelho)",
    species: "maple_red",
    seed: 3101,
    foliageColorTop: "#dc4a2c",
    foliageColorBottom: "#6a1911"
  },
  maple_orange: {
    ...MAPLE_BASE,
    id: "maple_orange",
    name: "Bordo Outonal (Laranja)",
    species: "maple_orange",
    seed: 3212,
    foliageColorTop: "#f08c26",
    foliageColorBottom: "#86370d"
  },
  maple_yellow: {
    ...MAPLE_BASE,
    id: "maple_yellow",
    name: "Bordo Outonal (Amarelo)",
    species: "maple_yellow",
    seed: 3323,
    foliageColorTop: "#e9c83c",
    foliageColorBottom: "#7f6112"
  },
  arctic_willow: {
    ...SHRUB_BASE,
    id: "arctic_willow",
    name: "Salgueiro-an\xE3o \xC1rtico",
    species: "arctic_willow",
    seed: 3434,
    // a low mat hugging the tundra: many creeping stems, wide and flat
    scaAttractorCount: 520,
    trunkHeight: 0.5,
    trunkCurvature: 0.3,
    branchCount: 8,
    branchAngle: 1.1,
    branchStartHeight: 0.02,
    canopySpread: 1.2,
    crownWidth: 1.45,
    crownHeight: 0.45,
    foliageDensity: 0.95,
    patchDensity: 0.95,
    leafCardSize: 0.45,
    foliageColorTop: "#4f6d42",
    // the dark dusty sage of the tundra willow
    foliageColorBottom: "#15271a",
    barkColor: "#5b4637",
    mossAmount: 0.1,
    windStrength: 0.35
  },
  lilyPads: {
    ...PLANT_BASE,
    id: "lilyPads",
    species: "lilyPads",
    name: "Vit\xF3ria-r\xE9gia",
    seed: 4721,
    trunkHeight: 0.6,
    branchCount: 0,
    windStrength: 0,
    foliageColorTop: "#789844",
    foliageColorBottom: "#354e27"
  },
  duckweed: {
    ...PLANT_BASE,
    id: "duckweed",
    species: "duckweed",
    name: "Lentilha-d'\xE1gua",
    seed: 4823,
    trunkHeight: 0.6,
    branchCount: 0,
    windStrength: 0,
    foliageColorTop: "#7da34b",
    foliageColorBottom: "#3f622f"
  },
  pneumatophore_patch: {
    ...PLANT_BASE,
    id: "pneumatophore_patch",
    name: "Pneumat\xF3foros",
    species: "pneumatophore_patch",
    seed: 4571,
    trunkHeight: 0.7,
    rootSpread: 1.15,
    barkColor: "#776e5b",
    foliageColorTop: "#6e8a42",
    foliageColorBottom: "#32452c",
    windStrength: 0
  },
  fern_plant: {
    ...PLANT_BASE,
    id: "fern_plant",
    name: "Samambaia",
    species: "fern_plant",
    seed: 4101,
    trunkHeight: 1,
    foliageColorTop: "#5fae3a",
    // the forest floor's fresh green
    foliageColorBottom: "#1f4f1c"
  },
  reed_clump: {
    ...PLANT_BASE,
    id: "reed_clump",
    name: "Juncos",
    species: "reed_clump",
    seed: 4323,
    trunkHeight: 1.7,
    foliageColorTop: "#6f9e3c",
    // reed green, a little yellow
    foliageColorBottom: "#274a20",
    windStrength: 0.55
  }
};

// work/Pixel_Tree-main/src/structures/snowStyle.ts
function structureRockSnowStyle(c) {
  const preset = Object.values(TREE_PRESETS).find((p) => p.rock?.biome === c.biome && !p.rock.gravel && !p.rock.ore);
  const params = resolvePixelTextureParams(preset);
  return { density: params.barkTexelsPerMetre * 2.8, lightDir: pixelTextureLightDir(params) };
}

// work/Pixel_Tree-main/src/structures/materials.ts
var StructureResources = class {
  constructor() {
    this.geometries = /* @__PURE__ */ new Set();
    this.materials = /* @__PURE__ */ new Set();
    this.textures = /* @__PURE__ */ new Set();
    this.instances = /* @__PURE__ */ new Set();
    this.disposed = false;
    this.dispose = () => {
      if (this.disposed) return;
      this.disposed = true;
      this.instances.forEach((mesh) => mesh.dispose());
      this.geometries.forEach((g) => g.dispose());
      this.materials.forEach((m) => m.dispose());
      this.textures.forEach((t) => t.dispose());
    };
  }
};
function createStructureMaterials(c, resources, seed = 0) {
  const snowStyle = structureRockSnowStyle(c);
  const mossSteps = 6, mossData = new Uint8Array(mossSteps * 4);
  buildPixelMossRamp(mossSteps).forEach((rgb, i) => mossData.set([...rgb, 255], i * 4));
  const mossPalette = new THREE11.DataTexture(mossData, mossSteps, 1);
  mossPalette.colorSpace = THREE11.SRGBColorSpace;
  mossPalette.magFilter = mossPalette.minFilter = THREE11.NearestFilter;
  mossPalette.generateMipmaps = false;
  mossPalette.needsUpdate = true;
  resources.textures.add(mossPalette);
  const colors = { wood: c.palette.wood, stone: c.palette.stone, plaster: c.palette.plaster, roof: c.palette.roof, thatch: c.type === "bridge" || c.type === "dock" || c.type === "outpost" ? "#b49b65" : "#c59138", metal: "#687681", cloth: c.type === "outpost" ? "#ffd071" : c.type === "watchtower" || c.type === "ruinedTower" || c.type === "lighthouse" ? "#ffd071" : c.type === "treehouse" ? "#ffc561" : c.type === "windmill" ? "#ead3a0" : c.type === "fortress" ? "#a93840" : "#b97a58", dark: c.type === "windmill" ? "#24435a" : "#1f2830", earth: "#978568", water: c.type === "swamp" ? "#426756" : "#3c858f" };
  const result = {};
  for (const [name, color] of Object.entries(colors)) {
    const kind = name, map = kind === "water" && (c.type === "bridge" || c.type === "dock" || c.type === "outpost") ? bridgeWaterTexture(c.texelsPerMetre, seed) : paintSurface(kind, color, c.texelsPerMetre, seed, c.finish, false, kind === "metal");
    resources.textures.add(map);
    const mossAffinity = kind === "stone" ? 1 : kind === "wood" ? 0.45 : kind === "plaster" ? 0.16 : 0;
    const mossHeight = kind === "stone" ? 1.8 : kind === "wood" ? 1.1 : 0.65;
    const material = new THREE11.MeshStandardMaterial({ color: "#ffffff", map, roughness: kind === "metal" ? 0.65 : 1, metalness: kind === "metal" ? 0.15 : 0, side: kind === "cloth" ? THREE11.DoubleSide : THREE11.FrontSide });
    if (kind === "cloth" && (c.type === "treehouse" || c.type === "watchtower" || c.type === "ruinedTower" || c.type === "lighthouse")) {
      material.emissive.set("#ffad38");
      material.emissiveIntensity = 0.65;
    }
    material.userData.pixelDensity = c.texelsPerMetre;
    material.onBeforeCompile = (shader) => {
      if (kind === "metal") {
        shader.vertexShader = "attribute vec3 ironLocalPosition,ironHalfSize;varying vec3 vIronLocal,vIronHalf;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvIronLocal=ironLocalPosition;vIronHalf=ironHalfSize;");
        shader.fragmentShader = "varying vec3 vIronLocal,vIronHalf;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
     vec3 ironDistances=max(vIronHalf-abs(vIronLocal),vec3(0.));
     float ironEdge=min(max(ironDistances.x,ironDistances.y),min(max(ironDistances.x,ironDistances.z),max(ironDistances.y,ironDistances.z)));
     vec3 ironCell=floor(vIronLocal*${c.texelsPerMetre.toFixed(1)});
     float ironChip=fract(sin(dot(ironCell,vec3(12.9898,78.233,37.719)))*43758.5453);
     float ironFacet=fract(sin(dot(floor(ironCell/3.),vec3(41.71,17.31,63.29)))*29371.37);
     diffuseColor.rgb*=.96+ironFacet*.08;
     if(ironChip<.022)diffuseColor.rgb*=.84;
     else if(ironChip>.985)diffuseColor.rgb*=1.10;
     float ironWear=(1.-step(.018+ironChip*.013,ironEdge))*(ironChip>.14?.36:.12);
     diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.28,.34,.38),ironWear);
    `);
      }
      shader.uniforms.uPixelDensity = { value: c.texelsPerMetre };
      shader.uniforms.uStructureMoss = { value: c.vegetation * mossAffinity };
      shader.uniforms.uStructureMossHeight = { value: mossHeight };
      shader.uniforms.uStructureMossPalette = { value: mossPalette };
      shader.uniforms.uStructureSnow = { value: kind === "water" ? 0 : c.snow };
      shader.uniforms.uStructureSeed = { value: seed };
      shader.uniforms.uSnowColors = { value: rockSnowColors(true) };
      shader.uniforms.uSnowDensity = { value: snowStyle.density };
      shader.uniforms.uSnowLightDir = { value: snowStyle.lightDir };
      shader.vertexShader = "varying vec3 vStructurePos;varying vec3 vStructureNormal;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvStructurePos=position;vStructureNormal=normal;");
      shader.fragmentShader = "uniform vec3 uSnowColors[4],uSnowLightDir;uniform float uSnowDensity,uPixelDensity,uStructureMoss,uStructureMossHeight,uStructureSnow,uStructureSeed;uniform sampler2D uStructureMossPalette;varying vec3 vStructurePos;varying vec3 vStructureNormal;\n" + pixelMossNoiseGLSL("uStructureSeed") + ROCK_SNOW_PAINT_GLSL + ROCK_SNOW_COVERAGE_GLSL + ROCK_SNOW_RIM_GLSL + shader.fragmentShader;
      if (kind === "thatch") {
        shader.vertexShader = "attribute float thatchLayer;varying float vThatchLayer;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvThatchLayer=thatchLayer;");
        shader.fragmentShader = "varying float vThatchLayer;\n" + shader.fragmentShader;
      }
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
    vec3 cell=floor(vStructurePos*uPixelDensity)+.5;
    ${kind === "thatch" ? `if(vThatchLayer>.92+(mhash3(cell)-.5)*.035)diffuseColor.rgb*=.72;` : ""}
    vec3 mossN=normalize(vStructureNormal);
    float damp=clamp(dot(mossN,vec3(0.,.25,-.95)),0.,1.);
    float up=clamp(mossN.y,0.,1.);
    float weather=1.-smoothstep(.15,uStructureMossHeight,vStructurePos.y);
    float groove=1.-smoothstep(.015,.12,abs(mnoise3(cell/8.+57.)-.5));
    float mossGroove=.35+groove*.65;
    float mossWant=min(.5,((.1+damp*.45+up*.3)*1.6+groove*.15)*uStructureMoss*weather)
      *(.55+mossGroove*.9);
    if(mossWant>.04&&mossField(cell)<mossWant){
     float N1=5.,qs=N1/5.;
     float ndl=dot(mossN,normalize(vec3(-.5,.8,-.6)));
     float mi=N1*.35+(ndl>.15?qs*.8:-qs*.6)
       +(mnoise3(cell/3.+41.)-.5)*qs*1.6+(.5-mossGroove)*qs*2.4;
     if(mossField(cell+vec3(0.,1.,0.))>=mossWant)mi+=qs;
     if(mossField(cell-vec3(0.,1.,0.))>=mossWant)mi-=qs*1.2;
     float idx=clamp(floor(mi+.5),0.,N1);
     diffuseColor.rgb=texture2D(uStructureMossPalette,vec2((idx+.5)/6.,.5)).rgb;
    }
    if(vStructureNormal.y>.35&&uStructureSnow>0.){
     ${kind === "roof" && c.type === "snowy" ? `
      vec3 snowN=normalize(vStructureNormal);
      vec3 snowDown=vec3(0.,-1.,0.)+snowN*snowN.y;
      if(dot(snowDown,snowDown)<.0001)snowDown=vec3(0.,0.,1.);
      snowDown=normalize(snowDown);
      vec3 snowAcross=normalize(cross(snowN,snowDown));
      diffuseColor.rgb=rockSnowSurface(diffuseColor.rgb,floor(vStructurePos*uSnowDensity)+.5,snowN,snowDown,vec3(0.),snowAcross,vec3(0.),uSnowLightDir,uStructureSnow,1.);
     ` : `float sn=step(1.-uStructureSnow,mossField(cell+73.));diffuseColor.rgb=mix(diffuseColor.rgb,rockSnowColor(floor(vStructurePos*uSnowDensity)+.5,vStructureNormal,uSnowLightDir),sn);`}
    }
   `);
    };
    material.customProgramCacheKey = () => kind + "_painted-rock-snow-v3" + (kind === "roof" && c.type === "snowy" ? "_flat-snow-rim" : "") + (kind === "metal" ? "_barrel-iron-bridge-v3" : "");
    resources.materials.add(material);
    result[kind] = material;
  }
  if (c.type === "bridge" || c.type === "dock" || c.type === "outpost") {
    result.metal.roughness = 0.65;
    result.metal.metalness = 0.15;
    result.dark.map = result.metal.map;
    result.dark.color.set("#aaa69d");
    result.dark.roughness = 0.9;
    result.dark.metalness = 0.2;
  }
  return result;
}
export {
  StructureResources,
  buildBeam,
  buildRoof,
  buildStoneLanternPiece,
  createStructureMaterials,
  paintSurface,
  paintUV,
  stoneLantern,
  stoneLanternGlassTexture
};
