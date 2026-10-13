// @ts-nocheck
import * as THREE from 'three';

/**
 * Felling a generated tree: splits the tree that is already on screen into the
 * stump and the part above it, along a level cut.
 *
 * Nothing is regenerated or swapped for a stock model. Every wood mesh that
 * crosses the cut is sliced: the triangles that straddle the plane are split
 * where they cross it, with every vertex attribute (bark UVs, the wood metrics
 * the pixel bark shader lays its texels out by, normals) interpolated at the
 * crossing. Both halves therefore end on the very same ring of points and the
 * bark runs on across the cut unbroken. The open ends are closed with the
 * growth-ring end grain, built from that same ring.
 *
 * Whole objects (fruit, mushrooms, the ground) go to the side they lie on; a
 * crown's leaf cards go with the crown, even the ones hanging below the cut.
 */

export interface CutResult {
  /** holds everything above the cut; rotate about its origin (the hinge) to fell it */
  pivot: THREE.Group;
  /** height of the cut */
  cutY: number;
  /** where the hinge sits: the edge of the cut face on the side the tree falls */
  hingeX: number;
  /** radius of the trunk at the cut */
  radius: number;
  /** how far the felled part reaches from the cut to its top */
  topLength: number;
  /** how far the break's splinters reach above and below the cut */
  depth: number;
  geometries: THREE.BufferGeometry[];
}

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

interface Loop {
  points: THREE.Vector3[];
  centre: THREE.Vector3;
  radius: number;
}

// -----------------------------------------------------------------------------
// Slicing one geometry
// -----------------------------------------------------------------------------

interface SliceOutput {
  below: THREE.BufferGeometry | null;
  above: THREE.BufferGeometry | null;
  /** the cut's trace across the surface, in the geometry's own space */
  segments: Segment[];
}

/**
 * Splits a geometry by a cutting surface: `dist` is the signed distance of a
 * point (in the geometry's own space) from it, negative below. With
 * `traceOnly` only the trace is collected and nothing is built.
 */
function sliceGeometry(
  geo: THREE.BufferGeometry,
  dist: (p: THREE.Vector3) => number,
  traceOnly = false
): SliceOutput {
  const names = Object.keys(geo.attributes);
  const attrs = names.map((n) => geo.attributes[n] as THREE.BufferAttribute);
  const sizes = attrs.map((a) => a.itemSize);
  const stride = sizes.reduce((s, x) => s + x, 0);
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const index = geo.index;
  const triCount = index ? index.count : posAttr.count;

  // every vertex as one flat record of all its attributes
  const readVertex = (i: number): number[] => {
    const out: number[] = new Array(stride);
    let o = 0;
    for (let k = 0; k < attrs.length; k++) {
      const a = attrs[k];
      for (let c = 0; c < sizes[k]; c++) out[o++] = a.getComponent(i, c);
    }
    return out;
  };
  let posOffset = 0;
  for (let k = 0; k < names.length; k++) {
    if (names[k] === 'position') break;
    posOffset += sizes[k];
  }
  const posOf = (v: number[]) => new THREE.Vector3(v[posOffset], v[posOffset + 1], v[posOffset + 2]);

  const below: number[] = [];
  const above: number[] = [];
  const belowGroups: { start: number; count: number; materialIndex: number }[] = [];
  const aboveGroups: { start: number; count: number; materialIndex: number }[] = [];
  const segments: Segment[] = [];

  const ranges = geo.groups.length > 0
    ? geo.groups.map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex ?? 0 }))
    : [{ start: 0, count: triCount, materialIndex: 0 }];

  // the crossing of an edge, always computed from its lower end to its upper
  // end, so the two triangles sharing an edge get the identical point
  const cross = (v0: number[], d0: number, v1: number[], d1: number): number[] => {
    if (d0 > d1) return cross(v1, d1, v0, d0);
    const t = d0 / (d0 - d1);
    const out = new Array(stride);
    for (let c = 0; c < stride; c++) out[c] = v0[c] + (v1[c] - v0[c]) * t;
    return out;
  };

  const emit = (target: number[], poly: number[][]) => {
    for (let i = 1; i + 1 < poly.length; i++) {
      target.push(...poly[0], ...poly[i], ...poly[i + 1]);
    }
  };

  for (const range of ranges) {
    const belowStart = below.length / stride;
    const aboveStart = above.length / stride;
    const end = Math.min(triCount, range.start + range.count);
    for (let t = range.start; t + 2 < end; t += 3) {
      const ids = index ? [index.getX(t), index.getX(t + 1), index.getX(t + 2)] : [t, t + 1, t + 2];
      const vs = ids.map(readVertex);
      const ds = vs.map((v) => dist(posOf(v)));
      const neg = ds.map((d) => d < 0);
      if (neg[0] && neg[1] && neg[2]) {
        if (!traceOnly) emit(below, vs);
        continue;
      }
      if (!neg[0] && !neg[1] && !neg[2]) {
        if (!traceOnly) emit(above, vs);
        continue;
      }
      // split: walk the triangle's edges, handing each corner to its side and
      // adding the crossing point to both
      const polyBelow: number[][] = [];
      const polyAbove: number[][] = [];
      const hits: number[][] = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        (neg[i] ? polyBelow : polyAbove).push(vs[i]);
        if (neg[i] !== neg[j]) {
          const x = cross(vs[i], ds[i], vs[j], ds[j]);
          polyBelow.push(x);
          polyAbove.push(x);
          hits.push(x);
        }
      }
      if (!traceOnly) {
        emit(below, polyBelow);
        emit(above, polyAbove);
      }
      if (hits.length === 2) segments.push({ a: posOf(hits[0]), b: posOf(hits[1]) });
    }
    belowGroups.push({ start: belowStart, count: below.length / stride - belowStart, materialIndex: range.materialIndex });
    aboveGroups.push({ start: aboveStart, count: above.length / stride - aboveStart, materialIndex: range.materialIndex });
  }

  const build = (data: number[], groups: typeof belowGroups): THREE.BufferGeometry | null => {
    const n = data.length / stride;
    if (n === 0) return null;
    const g = new THREE.BufferGeometry();
    let o = 0;
    for (let k = 0; k < names.length; k++) {
      const size = sizes[k];
      const src = attrs[k];
      const arr = new Float32Array(n * size);
      for (let v = 0; v < n; v++) {
        for (let c = 0; c < size; c++) arr[v * size + c] = data[v * stride + o + c];
      }
      g.setAttribute(names[k], new THREE.BufferAttribute(arr, size, src.normalized));
      o += size;
    }
    if (geo.groups.length > 0) groups.forEach((gr) => gr.count > 0 && g.addGroup(gr.start, gr.count, gr.materialIndex));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };

  if (traceOnly) return { below: null, above: null, segments };
  return { below: build(below, belowGroups), above: build(above, aboveGroups), segments };
}

// -----------------------------------------------------------------------------
// Rebuilding the cut outline and closing it
// -----------------------------------------------------------------------------

function chainLoops(segments: Segment[]): Loop[] {
  const key = (p: THREE.Vector3) => `${Math.round(p.x * 2000)},${Math.round(p.y * 2000)},${Math.round(p.z * 2000)}`;
  const adj = new Map<string, { p: THREE.Vector3; next: string[] }>();
  const node = (p: THREE.Vector3) => {
    const k = key(p);
    let n = adj.get(k);
    if (!n) {
      n = { p, next: [] };
      adj.set(k, n);
    }
    return k;
  };
  for (const s of segments) {
    const ka = node(s.a);
    const kb = node(s.b);
    if (ka === kb) continue;
    adj.get(ka)!.next.push(kb);
    adj.get(kb)!.next.push(ka);
  }
  const used = new Set<string>();
  const loops: Loop[] = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const pts: THREE.Vector3[] = [];
    let prev = '';
    let cur = start;
    while (cur && !used.has(cur)) {
      used.add(cur);
      const n = adj.get(cur)!;
      pts.push(n.p);
      const nxt = n.next.find((k) => k !== prev && !used.has(k));
      prev = cur;
      cur = nxt ?? '';
    }
    if (pts.length < 3) continue;
    const centre = new THREE.Vector3();
    pts.forEach((p) => centre.add(p));
    centre.multiplyScalar(1 / pts.length);
    let radius = 0;
    pts.forEach((p) => (radius = Math.max(radius, Math.hypot(p.x - centre.x, p.z - centre.z))));
    loops.push({ points: pts, centre, radius });
  }
  return loops;
}

/**
 * Closes each loop with the break surface: rings of vertices from the loop
 * (where the bark ends) in to the middle. The height at each point comes from
 * `surfaceY`, the same function for both parts, so the stump's face and the
 * trunk's face are one surface seen from either side: every spike on one is a
 * notch in the other. Built once facing up; `flip` turns it to face down.
 */
function buildCap(loops: Loop[], surfaceY: (x: number, z: number, rimY: number, rho: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const grainR: number[] = [];
  const RINGS = 5;
  for (const loop of loops) {
    const r = Math.max(loop.radius, 1e-3);
    const c = loop.centre;
    const n = loop.points.length;
    // rings[k][j]: k = 0 on the rim .. RINGS at the middle
    const rings: THREE.Vector3[][] = [];
    for (let k = 0; k <= RINGS; k++) {
      const rho = 1 - k / RINGS;
      rings.push(loop.points.map((p) => {
        const x = c.x + (p.x - c.x) * rho;
        const z = c.z + (p.z - c.z) * rho;
        return new THREE.Vector3(x, k === 0 ? p.y : surfaceY(x, z, p.y, rho), z);
      }));
    }
    const tris: THREE.Vector3[][] = [];
    for (let k = 0; k < RINGS; k++) {
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        const a = rings[k][j], b = rings[k][j1], c2 = rings[k + 1][j], d = rings[k + 1][j1];
        if (k === RINGS - 1) tris.push([a, b, c2]); // the middle ring is a point
        else tris.push([a, b, c2], [b, d, c2]);
      }
    }
    // wind the whole loop to face up, whichever way round its points run
    let up = 0;
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (const [a, b, c2] of tris) up += e1.subVectors(b, a).cross(e2.subVectors(c2, a)).y;
    for (const t of tris) {
      const [a, b, c2] = up >= 0 ? t : [t[0], t[2], t[1]];
      for (const v of [a, b, c2]) {
        pos.push(v.x, v.y, v.z);
        uv.push(0.5 + 0.5 * (v.x - c.x) / r, 0.5 + 0.5 * (v.z - c.z) / r);
        grainR.push(r);                    // for the end grain's texel grid
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aGrainR', new THREE.Float32BufferAttribute(grainR, 1));
  g.computeVertexNormals();
  return g;
}

/** The same cap turned over, to face down. */
function flipCap(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.clone();
  const pos = f.attributes.position as THREE.BufferAttribute;
  const uv = f.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of [pos, uv]) {
      const s = attr.itemSize;
      for (let c = 0; c < s; c++) {
        const t = attr.getComponent(i + 1, c);
        attr.setComponent(i + 1, c, attr.getComponent(i + 2, c));
        attr.setComponent(i + 2, c, t);
      }
    }
  }
  f.computeVertexNormals();
  return f;
}

/**
 * The break's profile around the trunk: stepped per sector like splinters,
 * some standing up out of the stump, some left hanging from the trunk, a
 * couple of long ones. Signed height above the cut, by angle.
 */
function makeBreakProfile(seed: number, depth: number): (a: number) => number {
  let s = (Math.floor(seed) * 7 + 101) % 233280;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const sectors = 10;
  const h: number[] = [];
  for (let i = 0; i < sectors; i++) h.push((rnd() - 0.5) * depth * 0.9);
  h[Math.floor(rnd() * sectors)] = depth;           // a tall splinter left on the stump
  h[Math.floor(rnd() * sectors)] = -depth * 0.85;   // ...and one torn out with the trunk
  if (rnd() > 0.4) h[Math.floor(rnd() * sectors)] = depth * 0.75;
  return (a: number) => {
    const x = (((a / (Math.PI * 2)) % 1) + 1) % 1 * sectors;
    const i0 = Math.floor(x) % sectors;
    const i1 = (i0 + 1) % sectors;
    const f = x - Math.floor(x);
    // flat across a sector, a short ramp to the next: splinters, not waves
    const k = f < 0.7 ? 0 : (f - 0.7) / 0.3;
    return h[i0] * (1 - k) + h[i1] * k;
  };
}

// -----------------------------------------------------------------------------
// Sorting the tree's objects
// -----------------------------------------------------------------------------

function isLeafLike(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.some((m) => {
    const sm = m as THREE.ShaderMaterial;
    return m.side === THREE.DoubleSide || m.transparent || m.alphaTest > 0 || !!sm.uniforms?.uAlphaTest;
  });
}

/** Hands a crowd of leaf cards to the side most of them are on. */
function splitInstanced(
  mesh: THREE.InstancedMesh,
  surfaceDist: (p: THREE.Vector3) => number,
  geometries: THREE.BufferGeometry[]
): { below: THREE.InstancedMesh | null; above: THREE.InstancedMesh | null } {
  const m = new THREE.Matrix4();
  const w = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const lowIds: number[] = [];
  const highIds: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    w.multiplyMatrices(mesh.matrixWorld, m);
    p.setFromMatrixPosition(w);
    (surfaceDist(p) < 0 ? lowIds : highIds).push(i);
  }
  // The leaf cards all belong to the twigs that carry them, which go with the
  // crown: a bush cut near the ground keeps none hanging over its stump.
  if (highIds.length >= lowIds.length) {
    highIds.push(...lowIds);
    highIds.sort((a, b) => a - b);
    lowIds.length = 0;
  } else {
    lowIds.push(...highIds);
    lowIds.sort((a, b) => a - b);
    highIds.length = 0;
  }
  const make = (ids: number[]): THREE.InstancedMesh | null => {
    if (ids.length === 0) return null;
    const geo = mesh.geometry.clone();
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name];
      if (!(a instanceof THREE.InstancedBufferAttribute)) continue;
      const arr = new Float32Array(ids.length * a.itemSize);
      ids.forEach((id, k) => {
        for (let c = 0; c < a.itemSize; c++) arr[k * a.itemSize + c] = a.getComponent(id, c);
      });
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, a.itemSize, a.normalized, a.meshPerAttribute));
    }
    geometries.push(geo);
    const out = new THREE.InstancedMesh(geo, mesh.material, ids.length);
    ids.forEach((id, k) => {
      mesh.getMatrixAt(id, m);
      out.setMatrixAt(k, m);
      if (mesh.instanceColor) {
        const col = new THREE.Color();
        mesh.getColorAt(id, col);
        out.setColorAt(k, col);
      }
    });
    out.name = mesh.name;
    out.castShadow = mesh.castShadow;
    out.receiveShadow = mesh.receiveShadow;
    out.frustumCulled = mesh.frustumCulled;
    out.renderOrder = mesh.renderOrder;
    return out;
  };
  return { below: make(lowIds), above: make(highIds) };
}

// -----------------------------------------------------------------------------
// The cut
// -----------------------------------------------------------------------------

/**
 * Splits `root` (a generated tree, standing at the origin) at height `cutY`.
 * Everything below stays in `root`; everything above is moved into the
 * returned pivot, which sits on the hinge at the edge of the cut on the +X
 * side. The pivot starts unrotated: the tree still looks whole until it is
 * turned.
 */
export function cutTree(root: THREE.Object3D, cutY: number, endGrain: THREE.Material, seed = 1): CutResult {
  root.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];

  // ---- where the trunk is at the cut: a first, level pass over the wood --
  const levelSegments: Segment[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || o.userData.ground) return;
    if (isLeafLike(mesh.material)) return;
    const b = new THREE.Box3().setFromObject(mesh);
    if (b.isEmpty() || b.min.y > cutY || b.max.y < cutY) return;
    const out = sliceGeometry(mesh.geometry, (p) => p.clone().applyMatrix4(mesh.matrixWorld).y - cutY, true);
    out.segments.forEach((sg) =>
      levelSegments.push({ a: sg.a.clone().applyMatrix4(mesh.matrixWorld), b: sg.b.clone().applyMatrix4(mesh.matrixWorld) })
    );
  });
  const trunk = chainLoops(levelSegments).sort((a, b) => b.radius - a.radius)[0];
  const trunkC = trunk ? trunk.centre : new THREE.Vector3(0, cutY, 0);
  const trunkR = trunk ? trunk.radius : 0.1;

  // ---- the break: a jagged surface round the trunk, level further out ---
  // (other stems and roots crossing the cut are cut clean)
  const depth = Math.min(trunkR * 0.9, cutY * 0.55);
  const profile = makeBreakProfile(seed, depth);
  const breakHeight = (x: number, z: number) => {
    const d = Math.hypot(x - trunkC.x, z - trunkC.z);
    const w = 1 - THREE.MathUtils.smoothstep(d, trunkR * 1.25, trunkR * 1.8);
    return w > 0 ? profile(Math.atan2(z - trunkC.z, x - trunkC.x)) * w : 0;
  };
  const surfaceDist = (p: THREE.Vector3) => p.y - cutY - breakHeight(p.x, p.z);
  const lowY = cutY - depth - 1e-3;
  const highY = cutY + depth + 1e-3;

  const below = new THREE.Group();
  below.name = 'Cut_Stump';
  const above = new THREE.Group();
  above.name = 'Cut_Top';
  root.add(below, above);
  root.updateMatrixWorld(true);

  const allSegments: Segment[] = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();

  const place = (o: THREE.Object3D, group: THREE.Group) => group.attach(o);

  const cloneMeshWith = (src: THREE.Mesh, geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, src.material);
    m.name = src.name;
    m.castShadow = src.castShadow;
    m.receiveShadow = src.receiveShadow;
    m.renderOrder = src.renderOrder;
    m.frustumCulled = src.frustumCulled;
    src.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    return m;
  };

  const sort = (o: THREE.Object3D) => {
    if (o === below || o === above) return;
    if (o.userData.ground) {
      place(o, below);
      return;
    }
    box.setFromObject(o);
    if (box.isEmpty()) {
      place(o, below);
      return;
    }
    if (box.max.y <= lowY) {
      place(o, below);
      return;
    }
    if (box.min.y >= highY) {
      place(o, above);
      return;
    }
    // crossing the cut
    const isMesh = (o as THREE.Mesh).isMesh;
    if (!isMesh) {
      // a small group (a sprite on its holder) goes whole, by its middle
      box.getSize(size);
      if (o.children.length > 0 && Math.max(size.x, size.y, size.z) >= 0.8) {
        [...o.children].forEach(sort);
        return;
      }
      box.getCenter(centre);
      place(o, surfaceDist(centre) < 0 ? below : above);
      return;
    }
    // Small things (a mushroom, a grass tuft, a flower) are not cut in two:
    // what grows from the ground stays with the stump, the rest goes by where
    // its middle is.
    box.getSize(size);
    if (Math.max(size.x, size.y, size.z) < 0.5 && !(o as THREE.InstancedMesh).isInstancedMesh) {
      box.getCenter(centre);
      place(o, box.min.y < 0.05 || surfaceDist(centre) < 0 ? below : above);
      return;
    }
    // children first (they would go along with the mesh otherwise)
    [...o.children].forEach(sort);

    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      const inst = o as THREE.InstancedMesh;
      const parts = splitInstanced(inst, surfaceDist, geometries);
      if (parts.below) {
        inst.matrixWorld.decompose(parts.below.position, parts.below.quaternion, parts.below.scale);
        below.add(parts.below);
      }
      if (parts.above) {
        inst.matrixWorld.decompose(parts.above.position, parts.above.quaternion, parts.above.scale);
        above.add(parts.above);
      }
      inst.removeFromParent();
      return;
    }

    const mesh = o as THREE.Mesh;
    const toWorld = mesh.matrixWorld;
    const w = new THREE.Vector3();
    const out = sliceGeometry(mesh.geometry, (p) => surfaceDist(w.copy(p).applyMatrix4(toWorld)));
    if (out.below) {
      geometries.push(out.below);
      below.add(cloneMeshWith(mesh, out.below));
    }
    if (out.above) {
      geometries.push(out.above);
      above.add(cloneMeshWith(mesh, out.above));
    }
    // leaf cards and grass are open sheets: only solid wood gets a cut face
    if (!isLeafLike(mesh.material)) {
      out.segments.forEach((s) =>
        allSegments.push({ a: s.a.clone().applyMatrix4(mesh.matrixWorld), b: s.b.clone().applyMatrix4(mesh.matrixWorld) })
      );
    }
    mesh.removeFromParent();
  };

  [...root.children].forEach(sort);

  // The outline of the cut, and the faces that close it. Overlapping pieces of
  // wood (a root flare over the trunk) cut into rings inside one another:
  // only the outermost ring of each gets a face, so no two faces fight.
  const loops = chainLoops(allSegments)
    .filter((l) => l.radius > 0.01)
    .sort((a, b) => b.radius - a.radius);
  const kept: Loop[] = [];
  for (const l of loops) {
    const inside = kept.some((k) => Math.hypot(l.centre.x - k.centre.x, l.centre.z - k.centre.z) < k.radius * 0.9);
    if (!inside) kept.push(l);
  }
  if (kept.length > 0) {
    // Inside the wood the break falls from the splinters at the bark toward a
    // ragged middle, torn a little across the grain.
    const surfaceY = (x: number, z: number, rimY: number, rho: number) => {
      const a = Math.atan2(z - trunkC.z, x - trunkC.x);
      const tear = Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7 - seed * 0.7) * 0.25;
      return cutY + (rimY - cutY) * Math.pow(rho, 1.4) + tear * depth * 0.18 * rho * (1 - rho) * 4;
    };
    const capBelow = buildCap(kept, surfaceY);
    const capAbove = flipCap(capBelow);
    geometries.push(capBelow, capAbove);
    const stumpFace = new THREE.Mesh(capBelow, endGrain);
    stumpFace.name = 'Cut_StumpFace';
    stumpFace.receiveShadow = true;
    below.add(stumpFace);
    const topFace = new THREE.Mesh(capAbove, endGrain);
    topFace.name = 'Cut_TopFace';
    topFace.castShadow = true;
    above.add(topFace);
  }

  // the hinge: the edge of the main cut face on the side the tree falls
  const main = kept[0];
  const radius = main ? main.radius : 0.3;
  let hingeX = radius;
  if (main) main.points.forEach((p) => (hingeX = Math.max(hingeX, p.x)));

  const pivot = new THREE.Group();
  pivot.name = 'Cut_FallPivot';
  pivot.position.set(hingeX, cutY, 0);
  root.add(pivot);
  root.updateMatrixWorld(true);
  pivot.attach(above);

  box.setFromObject(above);
  const topLength = box.isEmpty() ? 1 : Math.max(0.5, box.max.y - cutY);

  return { pivot, cutY, hingeX, radius, topLength, depth, geometries };
}
