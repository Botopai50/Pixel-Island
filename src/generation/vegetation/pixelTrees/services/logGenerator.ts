// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { createPixelEndGrainMaterial } from './endGrainMaterial';
import { bracketSprite, mushroomSprite, MUSHROOM_CAPS, MUSHROOM_FOOT } from './pixelSprites';
import { treeMushroomCard } from './mushroomRotation';

/**
 * Logs and stumps (the "Troncos" category): dead wood lying on, or standing
 * in, the forest floor.
 *
 *  - fallen_log  (Tronco Caído)       a long trunk on its side, both ends
 *                                     snapped, a few broken branch stubs
 *  - hollow_log  (Tronco Oco)         a thick fallen trunk rotted out: open at
 *                                     both ends, dark inside
 *  - rooted_log  (Tronco com Raízes)  a windthrown trunk, its root plate torn
 *                                     up out of the ground at one end
 *  - tree_stump  (Toco)               a short cut stump on flared roots, the
 *                                     growth rings showing on top
 *
 * All the bark goes into one mesh drawn with the tree's pixel bark material
 * (the same aWood / aBarkAngle attributes the other generators write), so the
 * texels match every other tree. Cut and broken faces show pixel-art growth
 * rings; the hollow log's inside is its own darkening mesh.
 *
 * The sliders keep a meaning here: trunkHeight is the log's length (the
 * stump's height), trunkRadiusBase / trunkRadiusTop its radius at either end,
 * trunkCurvature how bent it lies, rootSpread how far the roots reach,
 * branchCount the number of broken branch stubs and mushroomCount the number
 * of bracket fungi.
 */

type LogKind = 'fallen' | 'hollow' | 'rooted' | 'stump';

type EndKind = 'broken' | 'cut';

export interface LogResult {
  group: THREE.Group;
  materialsToDispose: THREE.Material[];
  geometriesToDispose: THREE.BufferGeometry[];
  texturesToDispose: THREE.Texture[];
  branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[];
  /** true where the wood covers the ground (no grass tufts there) */
  occupies: (x: number, z: number) => boolean;
  /** how far the wood reaches from the centre, for the ground island */
  extent: number;
}

export function logKindOf(config: TreeConfig): LogKind {
  const s = config.species as string;
  if (s.startsWith('hollow')) return 'hollow';
  if (s.startsWith('rooted')) return 'rooted';
  if (s.includes('stump')) return 'stump';
  return 'fallen';
}

// -----------------------------------------------------------------------------
// Geometry buffers
// -----------------------------------------------------------------------------

/** Bark mesh buffers, laid out like the other generators' wood. */
class BarkBuffers {
  positions: number[] = [];
  uvs: number[] = [];
  wood: number[] = [];
  angle: number[] = [];
  indices: number[] = [];
  count = 0;

  push(p: THREE.Vector3, u: number, along: number, r: number, meanR: number, cosA: number, sinA: number): number {
    this.positions.push(p.x, p.y, p.z);
    this.uvs.push(u, along * 0.35);
    this.wood.push(Math.max(0.03, r), along, meanR);
    this.angle.push(cosA, sinA);
    return this.count++;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aWood', new THREE.Float32BufferAttribute(this.wood, 3));
    g.setAttribute('aBarkAngle', new THREE.Float32BufferAttribute(this.angle, 2));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}

/** Plain position / uv / colour buffers, for the end grain and the hollow. */
class PlainBuffers {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  /** radius (m) of the end face a vertex belongs to, for the end grain */
  grainR: number[] = [];
  indices: number[] = [];
  count = 0;

  push(p: THREE.Vector3, u: number, v: number, shade = 1, grainR = 0): number {
    this.positions.push(p.x, p.y, p.z);
    this.uvs.push(u, v);
    this.colors.push(shade, shade, shade);
    this.grainR.push(grainR);
    return this.count++;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aGrainR', new THREE.Float32BufferAttribute(this.grainR, 1));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}

// -----------------------------------------------------------------------------
// Tubes
// -----------------------------------------------------------------------------

interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3; // tangent
  u: THREE.Vector3; // normal
  v: THREE.Vector3; // binormal, t x u
  along: number;    // arc length from the start
}

/** Parallel-transport frames along a polyline: no flips on a bending log. */
function framesAlong(path: THREE.Vector3[], firstNormalHint?: THREE.Vector3): Frame[] {
  const n = path.length;
  const frames: Frame[] = [];
  let along = 0;
  let prevU: THREE.Vector3 | null = null;
  let prevT: THREE.Vector3 | null = null;
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    if (i > 0) along += path[i].distanceTo(path[i - 1]);
    let u: THREE.Vector3;
    if (!prevU || !prevT) {
      const hint = firstNormalHint ?? (Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
      u = hint.clone().sub(t.clone().multiplyScalar(hint.dot(t))).normalize();
    } else {
      const q = new THREE.Quaternion().setFromUnitVectors(prevT, t);
      u = prevU.clone().applyQuaternion(q);
      u.sub(t.clone().multiplyScalar(u.dot(t))).normalize();
    }
    const v = t.clone().cross(u).normalize();
    frames.push({ p: path[i].clone(), t, u, v, along });
    prevU = u;
    prevT = t;
  }
  return frames;
}

function ringPoint(f: Frame, a: number, r: number): THREE.Vector3 {
  return f.p.clone()
    .addScaledVector(f.u, Math.cos(a) * r)
    .addScaledVector(f.v, Math.sin(a) * r);
}

/**
 * The ragged outline of a snapped end: how far each splinter sticks out past
 * the break, stepped per angular sector so it reads as pixel-art splinters.
 */
function makeSplinters(rnd: () => number, sectors: number, depth: number): (a: number) => number {
  const h: number[] = [];
  for (let i = 0; i < sectors; i++) h.push(Math.pow(rnd(), 1.8) * depth);
  // one or two long splinters
  h[Math.floor(rnd() * sectors)] = depth * (1.1 + rnd() * 0.6);
  if (rnd() > 0.4) h[Math.floor(rnd() * sectors)] = depth * (0.8 + rnd() * 0.5);
  return (a: number) => {
    const s = ((a / (Math.PI * 2)) % 1 + 1) % 1 * sectors;
    const i0 = Math.floor(s) % sectors;
    const i1 = (i0 + 1) % sectors;
    const f = s - Math.floor(s);
    // mostly flat per sector with a short ramp between: stepped, not wavy
    const k = f < 0.8 ? 0 : (f - 0.8) / 0.2;
    return h[i0] * (1 - k) + h[i1] * k;
  };
}

interface TubeOptions {
  radial: number;
  radius: (s: number, a: number) => number; // s: 0..1 along the tube
  meanRadius: number;
  /** extra axial length per angle at the start / end (a snapped end) */
  startJag?: (a: number) => number;
  endJag?: (a: number) => number;
  /** close the end in a point (roots, twigs) instead of leaving it open */
  pointEnd?: boolean;
  /** radius of the hollow core, as a fraction of the outer radius */
  hollow?: number;
}

/** Adds a bark tube; returns the rim rings of both ends for the caps. */
function addBarkTube(
  buf: BarkBuffers,
  frames: Frame[],
  opt: TubeOptions
): { startRim: THREE.Vector3[]; endRim: THREE.Vector3[] } {
  const radial = opt.radial;
  const n = frames.length;
  const length = frames[n - 1].along;
  const rings: number[] = [];
  const startRim: THREE.Vector3[] = [];
  const endRim: THREE.Vector3[] = [];

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const s = length > 0 ? f.along / length : 0;
    const ringStart = buf.count;
    rings.push(ringStart);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      let r = opt.radius(s, a);
      let p = ringPoint(f, a, r);
      let along = f.along;
      if (i === 0 && opt.startJag) {
        const d = opt.startJag(a);
        p.addScaledVector(f.t, -d);
        along -= d;
      }
      if (i === n - 1 && opt.endJag) {
        const d = opt.endJag(a);
        p.addScaledVector(f.t, d);
        along += d;
      }
      if (i === n - 1 && opt.pointEnd) {
        r = 0.01;
        p = f.p.clone();
      }
      buf.push(p, j / radial, along, r, opt.meanRadius, Math.cos(a), Math.sin(a));
      if (j < radial) {
        if (i === 0) startRim.push(p.clone());
        if (i === n - 1) endRim.push(p.clone());
      }
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = rings[i] + j;
      const b = rings[i + 1] + j;
      const c = rings[i + 1] + j + 1;
      const d = rings[i] + j + 1;
      buf.indices.push(a, d, b, b, d, c);
    }
  }
  return { startRim, endRim };
}

/**
 * The face of a cut or snapped end: concentric rings of vertices from the
 * bark rim in to the pith (or to the hollow), UV-mapped onto the growth-ring
 * texture. `inward` is the direction into the wood (the face looks the other
 * way). For a snapped end the face is torn: it falls back from the splinters
 * at the rim toward a ragged middle.
 */
function addEndFace(
  buf: PlainBuffers,
  frame: Frame,
  rim: THREE.Vector3[],
  outward: THREE.Vector3,
  kind: EndKind,
  rnd: () => number,
  hollow = 0
) {
  const radial = rim.length;
  const K = 4;
  const rings: number[][] = [];
  // the face's radius, for the end grain's texel grid
  let faceR = 0;
  for (const rp of rim) {
    const rel = rp.clone().sub(frame.p);
    faceR += rel.addScaledVector(outward, -rel.dot(outward)).length();
  }
  faceR /= Math.max(1, radial);
  // the break's depth varies across the face
  const tearPhase = rnd() * Math.PI * 2;
  for (let k = 0; k <= K; k++) {
    const rho = hollow + (1 - hollow) * (1 - k / K); // 1 at the rim .. hollow (or 0)
    const ring: number[] = [];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const rimP = rim[j];
      // the rim point relative to the axis, split into radial and axial parts
      const rel = rimP.clone().sub(frame.p);
      const axial = rel.dot(outward);
      const radialV = rel.clone().addScaledVector(outward, -axial);
      // a snapped end falls back from its splinters toward a ragged middle; a
      // cut end is level, and whatever stands up at its rim (the hinge
      // splinter of a felled stump) is a thin wall at the edge
      let off = axial * Math.pow(rho, kind === 'broken' ? 1.6 : 10);
      if (kind === 'broken' && k > 0) {
        off += (Math.sin(a * 2 + tearPhase) * 0.5 + 0.5) * 0.06 * (1 - rho) - rnd() * 0.02;
      }
      const p = frame.p.clone().add(radialV.multiplyScalar(rho)).addScaledVector(outward, off);
      if (k === 0) p.copy(rimP);
      ring.push(buf.push(p, 0.5 + 0.5 * rho * Math.cos(a), 0.5 + 0.5 * rho * Math.sin(a), 1, faceR));
    }
    rings.push(ring);
  }
  // the face looks along `outward`: wind the triangles for that side
  const flip = frame.t.dot(outward) < 0;
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = rings[k][j];
      const b = rings[k + 1][j];
      const c = rings[k + 1][j1];
      const d = rings[k][j1];
      if (flip) buf.indices.push(a, b, d, b, c, d);
      else buf.indices.push(a, d, b, b, d, c);
    }
  }
  if (hollow <= 0) {
    // close on the pith
    const inner = rings[K];
    const c = new THREE.Vector3();
    inner.forEach((idx) => c.add(new THREE.Vector3(buf.positions[idx * 3], buf.positions[idx * 3 + 1], buf.positions[idx * 3 + 2])));
    c.multiplyScalar(1 / inner.length);
    const centre = buf.push(c, 0.5, 0.5, 1, faceR);
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      if (flip) buf.indices.push(inner[j], centre, inner[j1]);
      else buf.indices.push(inner[j], inner[j1], centre);
    }
  }
  // The lining must share the exact inner boundary, including tears and cut offsets.
  return rings[K].map(idx=>new THREE.Vector3(buf.positions[idx*3],buf.positions[idx*3+1],buf.positions[idx*3+2]));
}

// -----------------------------------------------------------------------------
// Textures
// -----------------------------------------------------------------------------

function hexToRgb(c: THREE.Color): [number, number, number] {
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** Rotten wood for the inside of the hollow: dark fibres running along it. */
function makeHollowTexture(barkColor: string, seed: number): THREE.CanvasTexture {
  const w = 16;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const base = new THREE.Color(barkColor).lerp(new THREE.Color('#8a6440'), 0.5).multiplyScalar(0.8);
  const dark = base.clone().multiplyScalar(0.62);
  const light = base.clone().lerp(new THREE.Color('#c79a63'), 0.35);
  let s = (seed * 7 + 13) % 233280;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const colTone = Array.from({ length: w }, () => rnd());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = colTone[x];
      let c = t < 0.25 ? dark : t > 0.8 ? light : base;
      if (rnd() < 0.06) c = dark;
      const [r, g, b] = hexToRgb(c);
      const o = (y * w + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// -----------------------------------------------------------------------------
// The generator
// -----------------------------------------------------------------------------

export function buildProceduralLog(
  config: TreeConfig,
  barkMaterial: THREE.Material,
  rnd: () => number
): LogResult {
  const kind = logKindOf(config);
  const group = new THREE.Group();
  group.name = 'BotW_Log';
  const materialsToDispose: THREE.Material[] = [];
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const texturesToDispose: THREE.Texture[] = [];
  const branchTips: LogResult['branchTips'] = [];

  const bark = new BarkBuffers();
  const grain = new PlainBuffers();
  const radial = 20;

  const length = Math.max(0.3, config.trunkHeight);
  const r0 = Math.max(0.15, config.trunkRadiusBase);
  const r1 = Math.max(0.1, Math.min(r0, config.trunkRadiusTop));
  const bend = config.trunkCurvature ?? 0.2;
  const spread = config.rootSpread ?? 1;
  const hollow = kind === 'hollow' ? 0.7 : 0;

  // footprint on the ground: capsules in XZ, for keeping the grass off the wood
  const footprint: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [];
  let extent = 0;

  // knots and bumps along the bark, so it is not a machined cylinder
  const knotPhase = rnd() * 10;
  const bumpy = (s: number, a: number) =>
    1 + 0.035 * Math.sin(a * 5 + s * 9 + knotPhase) + 0.025 * Math.sin(a * 3 - s * 14 + knotPhase * 2);

  // ---------------------------------------------------------------------------
  // STUMP
  // ---------------------------------------------------------------------------
  if (kind === 'stump') {
    const height = length;
    const tilt = new THREE.Vector3((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
    const path: THREE.Vector3[] = [];
    const segs = Math.max(6, Math.ceil(height / 0.12));
    for (let i = 0; i <= segs; i++) {
      const y = -0.12 + (height + 0.12) * (i / segs);
      path.push(new THREE.Vector3(tilt.x * y, y, tilt.z * y));
    }
    const frames = framesAlong(path, new THREE.Vector3(1, 0, 0));
    // the cut: nearly level, a little ragged, with a hinge splinter left
    // standing on one side where the tree tore off as it fell
    const hingeA = rnd() * Math.PI * 2;
    const cutJag = (a: number) => {
      const d = Math.abs(((a - hingeA + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      const hinge = d < 0.5 ? (1 - d / 0.5) * r0 * 0.55 : 0;
      return 0.02 * Math.sin(a * 7 + knotPhase) + hinge;
    };
    const flare = (s: number) => {
      const y = s * (height + 0.12) - 0.12;
      const k = Math.max(0, 1 - y / Math.min(0.55, height * 0.8));
      return 1 + 0.45 * spread * k * k;
    };
    const rimOf = addBarkTube(bark, frames, {
      radial,
      meanRadius: r0,
      radius: (s, a) => THREE.MathUtils.lerp(r0, Math.max(r1, r0 * 0.9), s) * bumpy(s, a) * flare(s)
        * (1 + (s < 0.3 ? 0.12 * Math.cos(a * 5 + knotPhase) * (1 - s / 0.3) : 0)),
      endJag: cutJag,
    });
    addEndFace(grain, frames[frames.length - 1], rimOf.endRim, frames[frames.length - 1].t, 'cut', rnd);

    // buttress roots running off into the soil
    const rootCount = 5 + Math.floor(rnd() * 3);
    for (let k = 0; k < rootCount; k++) {
      const a = (k / rootCount) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const reach = (0.8 + rnd() * 0.7) * spread + r0;
      const pts: THREE.Vector3[] = [];
      const rootSegs = 10;
      for (let i = 0; i <= rootSegs; i++) {
        const t = i / rootSegs;
        const d = r0 * 0.35 + (reach - r0 * 0.35) * t;
        const y = THREE.MathUtils.lerp(Math.min(height * 0.55, 0.45), -0.12, Math.pow(t, 0.7));
        pts.push(dir.clone().multiplyScalar(d).add(new THREE.Vector3(0, y, 0))
          .add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.sin(t * 3 + k) * 0.08)));
      }
      const rr = r0 * (0.24 + rnd() * 0.08);
      addBarkTube(bark, framesAlong(pts), {
        radial: 10,
        meanRadius: rr * 0.6,
        radius: (s) => rr * Math.pow(1 - s, 0.8) + 0.02,
        pointEnd: true,
      });
      extent = Math.max(extent, reach);
    }
    footprint.push({ a: new THREE.Vector2(0, 0), b: new THREE.Vector2(0, 0), r: r0 * 1.5 });
    const top = frames[frames.length - 1];
    branchTips.push({ position: top.p.clone(), normal: top.t.clone(), scale: 1 });
    extent = Math.max(extent, r0 * 1.5);
  } else {
    // -------------------------------------------------------------------------
    // LYING TRUNKS: fallen, hollow, rooted
    // -------------------------------------------------------------------------
    const segs = Math.max(12, Math.ceil(length / 0.2));
    // not always square to the camera; the hollow log turns one open end
    // toward it, so you can look inside
    const heading = kind === 'hollow' ? 0.5 + (rnd() - 0.5) * 0.2 : (rnd() - 0.5) * 0.6;
    const dir = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const bendSign = rnd() > 0.5 ? 1 : -1;
    // sunk a little into the soil, never floating
    const sink = kind === 'hollow' ? 0.9 : 0.82;
    // an uprooted trunk still rests with its root end lifted
    const lift = kind === 'rooted' ? r0 * 0.6 : 0;
    const path: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = (t - 0.5) * length;
      const rHere = THREE.MathUtils.lerp(r0, r1, t);
      const y = rHere * sink + lift * Math.pow(1 - t, 1.5) + Math.sin(t * Math.PI) * bend * 0.08;
      const lateral = Math.sin(t * Math.PI) * bend * 0.5 * bendSign;
      path.push(dir.clone().multiplyScalar(x).addScaledVector(side, lateral).add(new THREE.Vector3(0, y, 0)));
    }
    const frames = framesAlong(path);

    // base flare at the thick end (where the tree stood)
    const baseFlare = (s: number, a: number) => {
      if (kind === 'hollow') return 1;
      const k = Math.max(0, 1 - s / 0.14);
      return 1 + (kind === 'rooted' ? 0.4 : 0.22) * k * k * (1 + 0.3 * Math.cos(a * 5 + knotPhase));
    };
    const radiusAt = (s: number, a: number) => THREE.MathUtils.lerp(r0, r1, s) * bumpy(s, a) * baseFlare(s, a);

    const startKind: EndKind = kind === 'rooted' ? 'cut' : kind === 'hollow' ? 'cut' : 'broken';
    const endKind: EndKind = 'broken';
    const startJag = startKind === 'broken' ? makeSplinters(rnd, 11, r0 * 0.7) : (a: number) => 0.03 * Math.sin(a * 4 + knotPhase);
    const endJag = makeSplinters(rnd, 11, r1 * (kind === 'hollow' ? 0.6 : 0.9));

    const rims = addBarkTube(bark, frames, {
      radial,
      meanRadius: (r0 + r1) * 0.5,
      radius: radiusAt,
      startJag: kind === 'rooted' ? undefined : startJag,
      endJag,
    });

    const f0 = frames[0];
    const fN = frames[frames.length - 1];
    // (the rooted trunk's end is hidden in its root plate, but closed anyway)
    const innerStartRim=addEndFace(grain, f0, rims.startRim, f0.t.clone().negate(), startKind, rnd, hollow);
    const innerEndRim=addEndFace(grain, fN, rims.endRim, fN.t.clone(), endKind, rnd, hollow);

    // ---- the hollow ---------------------------------------------------------
    if (hollow > 0) {
      const inner = new PlainBuffers();
      const n = frames.length;
      const iradial = radial;
      const ringIdx: number[] = [];
      for (let i = 0; i < n; i++) {
        const f = frames[i];
        const s = f.along / frames[n-1].along;
        // darker toward the middle, where no light gets in
        const shade = 0.3 + 0.7 * Math.pow(Math.abs(s - 0.5) * 2, 2.5);
        ringIdx.push(inner.count);
        for (let j = 0; j <= iradial; j++) {
          const a = (j / iradial) * Math.PI * 2;
          const p = ringPoint(f, a, radiusAt(s, a) * hollow);
          // Reuse the cap boundary instead of approximating its jagged displacement.
          if(i===0)p.copy(innerStartRim[j%iradial]);
          if(i===n-1)p.copy(innerEndRim[j%iradial]);
          inner.push(p, (j / iradial) * 2, f.along * 0.8, shade);
        }
      }
      // wound to face the axis
      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < iradial; j++) {
          const a = ringIdx[i] + j;
          const b = ringIdx[i + 1] + j;
          const c = ringIdx[i + 1] + j + 1;
          const d = ringIdx[i] + j + 1;
          inner.indices.push(a, b, d, b, c, d);
        }
      }
      const innerGeo = inner.build();
      const innerTex = makeHollowTexture(config.barkColor, config.seed);
      const innerMat = new THREE.MeshToonMaterial({ map: innerTex, vertexColors: true });
      const innerMesh = new THREE.Mesh(innerGeo, innerMat);
      innerMesh.name = 'LogHollow';
      innerMesh.castShadow = true;
      innerMesh.receiveShadow = true;
      group.add(innerMesh);
      geometriesToDispose.push(innerGeo);
      materialsToDispose.push(innerMat);
      texturesToDispose.push(innerTex);

      // a little rotten debris and moss on the floor of the hollow
      const debrisMat = new THREE.MeshToonMaterial({ color: 0x4f6b2a });
      materialsToDispose.push(debrisMat);
      const debrisGeo = new THREE.DodecahedronGeometry(1, 0);
      geometriesToDispose.push(debrisGeo);
      for (let d = 0; d < 5; d++) {
        const s = 0.08 + rnd() * 0.25;
        const f = frames[Math.floor(s * (n - 1))];
        const rr = THREE.MathUtils.lerp(r0, r1, s) * hollow;
        const m = new THREE.Mesh(debrisGeo, debrisMat);
        m.position.copy(f.p).addScaledVector(f.u, -rr * 0.82).addScaledVector(f.v, (rnd() - 0.5) * rr * 0.6);
        m.scale.set(0.12 + rnd() * 0.1, 0.05, 0.1 + rnd() * 0.08);
        m.rotation.y = rnd() * Math.PI;
        group.add(m);
      }
    }

    // ---- broken branch stubs ------------------------------------------------
    const stubCount = kind === 'hollow' ? Math.min(2, config.branchCount) : Math.min(6, config.branchCount);
    for (let b = 0; b < stubCount; b++) {
      const s = 0.25 + rnd() * 0.6;
      const f = frames[Math.round(s * (frames.length - 1))];
      // up or out to the side, never into the ground
      const a = (rnd() - 0.5) * Math.PI * 1.1;
      const out = f.u.clone().multiplyScalar(Math.cos(a)).addScaledVector(f.v, Math.sin(a)).normalize();
      const rTrunk = THREE.MathUtils.lerp(r0, r1, s);
      const rStub = rTrunk * (0.2 + rnd() * 0.12);
      const len = rTrunk * (0.9 + rnd() * 0.9);
      const grow = out.clone().addScaledVector(f.t, 0.35 + rnd() * 0.3).normalize();
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 4; i++) {
        pts.push(f.p.clone().addScaledVector(out, rTrunk * 0.5).addScaledVector(grow, (i / 4) * (len + rTrunk * 0.5)));
      }
      const sf = framesAlong(pts);
      const jag = makeSplinters(rnd, 7, rStub * 1.2);
      const stubRims = addBarkTube(bark, sf, {
        radial: 10,
        meanRadius: rStub,
        radius: (t) => rStub * (1 - t * 0.3) * (1 + Math.max(0, 1 - t / 0.25) * 0.25),
        endJag: jag,
      });
      addEndFace(grain, sf[sf.length - 1], stubRims.endRim, sf[sf.length - 1].t, 'broken', rnd);
      branchTips.push({ position: pts[pts.length - 1].clone(), normal: grow, scale: 0.6 });
    }

    // ---- root plate of the uprooted trunk -----------------------------------
    if (kind === 'rooted') {
      const base = f0;
      const back = base.t.clone().negate();
      const plateR = r0 * (1.6 + 0.4 * spread);
      // soil torn up with the roots: a thick disc standing on edge
      const soilGeo = new THREE.IcosahedronGeometry(1, 1);
      const pos = soilGeo.attributes.position as THREE.BufferAttribute;
      // (the polyhedron repeats each corner per face: jitter by position, so
      // the copies move together and the faceted clod stays closed)
      const lumpSeed = rnd() * 100;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + lumpSeed) * 43758.5453;
        v.multiplyScalar(1 + ((h - Math.floor(h)) - 0.5) * 0.25);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      soilGeo.computeVertexNormals();
      geometriesToDispose.push(soilGeo);
      const soilMat = new THREE.MeshToonMaterial({ color: 0x5b4130 });
      materialsToDispose.push(soilMat);
      const soil = new THREE.Mesh(soilGeo, soilMat);
      soil.scale.set(plateR * 0.28, plateR, plateR);
      // disc axis along the trunk
      soil.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), back);
      const plateCentre = base.p.clone().addScaledVector(back, plateR * 0.12);
      // its lower edge rests on the ground
      plateCentre.y = Math.max(plateCentre.y, plateR * 0.85);
      soil.position.copy(plateCentre);
      soil.castShadow = true;
      soil.receiveShadow = true;
      group.add(soil);

      // grass still growing on what was the ground surface: it turned over
      // with the tree, and now faces along the trunk
      const turfMat = new THREE.MeshToonMaterial({ color: 0x5f8f34 });
      materialsToDispose.push(turfMat);
      const turf = new THREE.Mesh(soilGeo, turfMat);
      turf.scale.set(plateR * 0.08, plateR * 0.96, plateR * 0.96);
      turf.quaternion.copy(soil.quaternion);
      turf.position.copy(plateCentre).addScaledVector(back, -plateR * 0.24);
      group.add(turf);

      // stones caught in the roots
      const stoneMat = new THREE.MeshToonMaterial({ color: 0x7d766c });
      materialsToDispose.push(stoneMat);
      const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
      geometriesToDispose.push(stoneGeo);
      for (let s = 0; s < 4; s++) {
        const a = rnd() * Math.PI * 2;
        const rr = plateR * (0.3 + rnd() * 0.55);
        const st = new THREE.Mesh(stoneGeo, stoneMat);
        const upv = new THREE.Vector3(0, 1, 0);
        const sidev = back.clone().cross(upv).normalize();
        st.position.copy(plateCentre)
          .addScaledVector(upv, Math.sin(a) * rr)
          .addScaledVector(sidev, Math.cos(a) * rr)
          .addScaledVector(back, -plateR * 0.22);
        const k = 0.1 + rnd() * 0.12;
        st.scale.set(k, k * 0.8, k);
        st.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        st.castShadow = true;
        group.add(st);
      }

      // roots fanning out of the trunk's end, past the soil's edge
      const rootCount = 9 + Math.floor(rnd() * 4);
      const upv = new THREE.Vector3(0, 1, 0);
      const sidev = back.clone().cross(upv).normalize();
      for (let k = 0; k < rootCount; k++) {
        const a = (k / rootCount) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
        const radialDir = upv.clone().multiplyScalar(Math.sin(a)).addScaledVector(sidev, Math.cos(a));
        const reach = plateR * (0.95 + rnd() * 0.45);
        const pts: THREE.Vector3[] = [];
        const rootSegs = 10;
        for (let i = 0; i <= rootSegs; i++) {
          const t = i / rootSegs;
          const p = base.p.clone()
            .addScaledVector(base.t, r0 * 0.3 * (1 - t))
            .addScaledVector(back, plateR * 0.35 * Math.pow(t, 1.5))
            .addScaledVector(radialDir, r0 * 0.4 + (reach - r0 * 0.4) * t);
          // roots curl back at the tips and droop a little
          p.addScaledVector(back, Math.sin(t * Math.PI) * 0.12 * (k % 2 ? 1 : -1));
          p.y -= t * t * 0.25;
          p.y = Math.max(p.y, 0.05);
          pts.push(p);
        }
        const rr = r0 * (0.22 + rnd() * 0.1);
        addBarkTube(bark, framesAlong(pts), {
          radial: 8,
          meanRadius: rr * 0.6,
          radius: (s) => rr * Math.pow(1 - s, 0.9) + 0.015,
          pointEnd: true,
        });
        // thin root hairs off some of them
        if (rnd() > 0.45) {
          const from = pts[5];
          const h: THREE.Vector3[] = [];
          const hd = radialDir.clone().addScaledVector(back, 0.8).normalize();
          for (let i = 0; i <= 5; i++) {
            h.push(from.clone().addScaledVector(hd, (i / 5) * reach * 0.45).add(new THREE.Vector3(0, -((i / 5) ** 2) * 0.15, 0)));
          }
          addBarkTube(bark, framesAlong(h), {
            radial: 6,
            meanRadius: rr * 0.3,
            radius: (s) => rr * 0.4 * (1 - s) + 0.01,
            pointEnd: true,
          });
        }
      }
      extent = Math.max(extent, plateCentre.clone().setY(0).length() + plateR * 0.5);
    }

    // footprint and extent
    for (let i = 0; i < frames.length - 1; i += 2) {
      const a = frames[i].p;
      const b = frames[Math.min(frames.length - 1, i + 2)].p;
      footprint.push({ a: new THREE.Vector2(a.x, a.z), b: new THREE.Vector2(b.x, b.z), r: THREE.MathUtils.lerp(r0, r1, i / frames.length) * 1.05 });
    }
    frames.forEach((f) => (extent = Math.max(extent, Math.hypot(f.p.x, f.p.z) + r0)));

    // ---- bracket fungi on the flanks ---------------------------------------
    if (config.showMushrooms && config.mushroomCount > 0) {
      addBracketFungi(config, frames, r0, r1, rnd, group, materialsToDispose, geometriesToDispose);
    }
  }

  // ---- stump: toadstools at its foot -----------------------------------------
  if (kind === 'stump' && config.showMushrooms && config.mushroomCount > 0) {
    // pixel-art toadstools standing in the grass: mostly red with pale
    // flecks, a few other caps among them
    const count = Math.min(10, config.mushroomCount);
    for (let m = 0; m < count; m++) {
      const a = (m * 2.39996 + knotPhase) % (Math.PI * 2);
      const d = r0 * (1.2 + rnd() * 0.5) + 0.15;
      const cap = rnd() < 0.5 ? 0 : Math.floor(rnd() * MUSHROOM_CAPS.length);
      const toad = treeMushroomCard(mushroomSprite(MUSHROOM_CAPS[cap].color, MUSHROOM_CAPS[cap].spots),
        0.34 + rnd() * 0.16, MUSHROOM_FOOT,
        new THREE.Vector3(Math.cos(a) * d, -0.02, Math.sin(a) * d),
        new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      group.add(toad.holder);
      materialsToDispose.push(toad.material);
      geometriesToDispose.push(toad.geometry);
    }
    // and a shelf or two on the stump's own side
    const f: Frame[] = framesAlong(
      Array.from({ length: 11 }, (_, i) => new THREE.Vector3(0, (i / 10) * length, 0)),
      new THREE.Vector3(1, 0, 0)
    );
    addBracketFungi({ ...config, mushroomCount: Math.max(1, Math.floor(config.mushroomCount / 3)) }, f, r0 * 1.02, r0, rnd, group, materialsToDispose, geometriesToDispose, true);
  }

  // ---- build the meshes --------------------------------------------------------
  const barkGeo = bark.build();
  geometriesToDispose.push(barkGeo);
  const woodMesh = new THREE.Mesh(barkGeo, barkMaterial);
  woodMesh.name = 'BotW_LogWood';
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;
  group.add(woodMesh);

  const grainGeo = grain.build();
  geometriesToDispose.push(grainGeo);
  // pixel-art rings on a texel grid in metres (see endGrainMaterial)
  const endGrain = createPixelEndGrainMaterial(config);
  texturesToDispose.push(endGrain.palette);
  const grainMat = endGrain.material;
  materialsToDispose.push(grainMat);
  const grainMesh = new THREE.Mesh(grainGeo, grainMat);
  grainMesh.name = 'BotW_LogEndGrain';
  grainMesh.castShadow = true;
  grainMesh.receiveShadow = true;
  group.add(grainMesh);

  const occupies = (x: number, z: number) => {
    const p = new THREE.Vector2(x, z);
    return footprint.some(({ a, b, r }) => {
      const ab = b.clone().sub(a);
      const l2 = ab.lengthSq();
      const t = l2 > 1e-6 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / l2, 0, 1) : 0;
      return a.clone().addScaledVector(ab, t).distanceTo(p) < r + 0.12;
    });
  };

  return { group, materialsToDispose, geometriesToDispose, texturesToDispose, branchTips, occupies, extent };
}

/** Shelves of bracket fungus stacked on the sides of the wood. */
function addBracketFungi(
  config: TreeConfig,
  frames: Frame[],
  r0: number,
  r1: number,
  rnd: () => number,
  group: THREE.Group,
  materialsToDispose: THREE.Material[],
  geometriesToDispose: THREE.BufferGeometry[],
  upright = false
) {
  // Keep the authored shelf pixels, with the shared cap-only pitch limiter.
  const shelfTexture = bracketSprite();

  const clusters = Math.max(1, Math.round(config.mushroomCount / 3));
  for (let c = 0; c < clusters; c++) {
    const s = upright ? 0.15 + rnd() * 0.45 : 0.15 + rnd() * 0.7;
    const f = frames[Math.min(frames.length - 1, Math.round(s * (frames.length - 1)))];
    const rHere = THREE.MathUtils.lerp(r0, r1, s);
    // on the flank: roughly horizontal outward normal
    let out: THREE.Vector3;
    if (upright) {
      const a = rnd() * Math.PI * 2;
      out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    } else {
      const sideSign = rnd() > 0.5 ? 1 : -1;
      const flank = f.t.clone().cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(sideSign);
      out = flank.addScaledVector(new THREE.Vector3(0, 1, 0), (rnd() - 0.2) * 0.4).normalize();
    }
    const width = rHere * (upright ? 0.55 : 0.75) * (0.9 + rnd() * 0.25);
    const at = f.p.clone()
      .addScaledVector(out, rHere)
      .addScaledVector(f.t, upright ? 0 : (rnd() - 0.5) * rHere * 0.5);
    const shelf = treeMushroomCard(shelfTexture, width, new THREE.Vector2(0.5, 0.5), at, out);
    group.add(shelf.holder);
    materialsToDispose.push(shelf.material);
    geometriesToDispose.push(shelf.geometry);
  }
}
