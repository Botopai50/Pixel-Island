// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { FLOWER_PROFILES } from '../constants/wildflowers';
import { rockBiomeForSpecies } from '../constants/rockBiomes';
import { pixelTextureLightDir, resolvePixelTextureParams } from './pixelArtTextureSystem';
import { createFlowerBloom } from './wildflowerSystem';
import type { SCANode, SCATreeData } from './spaceColonization';
import { appleSprite, berrySprite, makeSprite, spriteMaterial } from './pixelSprites';

export interface FruitOptions {
  /** Radius of one fruit, metres. */
  radius: number;
  /** Fruit colour (the pixel material builds its ramp from it). */
  color: string;
  /** Fruits hung from each chosen twig: 1 for apples, 2-3 for berries. */
  perCluster?: number;
  /** 'flower': five-petal blossoms opening outward on the foliage's skin,
   *  with no stalk, instead of hanging fruit. */
  kind?: 'fruit' | 'flower';
}

export interface FruitResult {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

/**
 * Twigs a fruit can hang from. A fruit reads when it hangs from real wood at
 * the SKIN of the crown - just under the leaves on the lower and outer part,
 * where it is seen against them - not deep inside the foliage where it is
 * hidden, nor on the upper surface where nothing would hold it up. So the
 * candidates are the fine, non-trunk nodes in a shell of the crown's rounded
 * mass, below its upper third.
 */
function fruitAnchors(data: SCATreeData, anywhere = false): SCANode[] {
  const cy = data.crownCenter.y;
  const rx = Math.max(0.5, data.crownRadiusX);
  const ry = Math.max(0.5, data.crownRadiusY);
  const rz = Math.max(0.5, data.crownRadiusZ);
  const pick = (dMin: number, dMax: number, yMax: number) =>
    data.allNodes.filter((n) => {
      if (n.isTrunk || !n.parent || n.radius > 0.16) return false;
      const qx = n.position.x / rx;
      const qy = (n.position.y - cy) / ry;
      const qz = n.position.z / rz;
      const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
      return d >= dMin && d <= dMax && qy <= yMax;
    });
  // (flowers open all over the crown, the top included)
  let anchors = pick(0.55, 1.2, anywhere ? 1.5 : 0.35);
  if (anchors.length < 8) anchors = pick(0.35, 1.4, 0.7);       // small or odd crowns
  if (anchors.length < 4) anchors = data.allNodes.filter((n) => !n.isTrunk && n.parent);
  return anchors;
}

/**
 * Picks `count` anchors spread over the whole crown: a seeded shuffle, then a
 * greedy pass that only accepts an anchor far enough from every one already
 * taken, relaxing the spacing until enough are found. Taking the first twigs
 * in graph order put every fruit in the same corner of the tree.
 */
function spreadAnchors(anchors: SCANode[], count: number, spacing: number, rnd: () => number): SCANode[] {
  const pool = [...anchors];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen: SCANode[] = [];
  let minDist = spacing;
  while (chosen.length < count && minDist > 0.05) {
    for (const a of pool) {
      if (chosen.length >= count) break;
      if (chosen.includes(a)) continue;
      if (chosen.every((c) => c.position.distanceTo(a.position) >= minDist)) chosen.push(a);
    }
    minDist *= 0.7;
  }
  return chosen;
}

const flowerSpriteCache = new Map<string, THREE.CanvasTexture>();

/**
 * A five-petal blossom drawn as pixel art, 12 x 12 texels with nearest
 * filtering: a dark outline, petals lit from the top left and shaded to the
 * bottom right, a darker ring where they meet, and a yellow heart with its
 * own shade - the same hard-stepped look as the rest of the tree, where a
 * smooth petal shape read as a vector sticker.
 */
export function flowerSprite(color: string): THREE.CanvasTexture {
  const hit = flowerSpriteCache.get(color);
  if (hit) return hit;
  const N = 12;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const base = new THREE.Color(color);
  const hex = (c: THREE.Color) => `#${c.getHexString()}`;
  const light = hex(base.clone().offsetHSL(0, 0, 0.12));
  const mid = hex(base);
  const dark = hex(base.clone().offsetHSL(0, 0.05, -0.17));
  const outline = hex(base.clone().offsetHSL(0, 0.1, -0.34));
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) - Math.PI / 2;
      const petalR = 5.9 * (0.52 + 0.48 * Math.abs(Math.cos(a * 2.5)));
      if (d > petalR) continue;
      let fill: string;
      if (d <= 1.6) fill = dx + dy > 0.5 ? '#c78a1a' : '#f2c230';   // heart
      else if (d > petalR - 1.0) fill = outline;                      // outline
      else if (d < 2.6) fill = dark;                                  // ring round the heart
      else if (dx + dy < -1.2) fill = light;                          // lit side
      else if (dx + dy > 2.2) fill = dark;                            // shaded side
      else fill = mid;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  flowerSpriteCache.set(color, tex);
  return tex;
}

/**
 * Fruit on the tree, spread over the lower and outer part of the crown.
 *
 * Hung straight from its twig, a fruit sits INSIDE the foliage - the leaf
 * tufts reach a metre or more past the wood - and almost none of them show.
 * So when the foliage is handed in, each fruit is set where a ray from
 * outside the tree toward its twig first meets the leaves: on the crown's
 * skin, nestled into it, with its stalk and leaf running back into the
 * foliage. Without foliage (or if the ray misses) it hangs from the twig on
 * its stalk. Drawn in the pixel-art prop style when the pixel textures are on.
 */
export function buildHangingFruit(
  config: TreeConfig,
  data: SCATreeData,
  sharedUniforms: Record<string, THREE.IUniform>,
  count: number,
  rnd: () => number,
  options: FruitOptions,
  foliage?: THREE.Object3D
): FruitResult {
  const group = new THREE.Group();
  group.name = 'BotW_Fruit';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const r = options.radius;
  const perCluster = Math.max(1, options.perCluster ?? 1);

  // Fruit is a pixel-art sprite, like the flowers: an apple with its stalk
  // and leaf, or a whole bunch of berries in one sprite. The sprite is wider
  // than the fruit itself (the stalk, the leaf, the outline).
  const isBunch = perCluster > 1;
  const fruitMat = options.kind === 'flower' ? null : spriteMaterial(isBunch ? berrySprite(options.color) : appleSprite(options.color));
  const fruitWidth = isBunch ? r * 5.8 : r * 2.8;
  if (fruitMat) materials.push(fruitMat);
  void sharedUniforms;

  // The same pixel grid and palette as the ground blossoms, opening along +Z.
  let flowerGeo: THREE.BufferGeometry | null = null;
  let flowerMat: THREE.Material | null = null;
  if (options.kind === 'flower') {
    const profile = FLOWER_PROFILES[rockBiomeForSpecies(config.species)];
    const bloom = createFlowerBloom(profile, options.color, pixelTextureLightDir(resolvePixelTextureParams(config)));
    flowerGeo = bloom.geometry;
    flowerGeo.scale(r * 1.2, r * 1.2, r * 1.2);
    flowerGeo.rotateX(Math.PI / 2);
    flowerMat = bloom.material;
    geometries.push(flowerGeo); materials.push(flowerMat); textures.push(bloom.texture);
  }

  const crownR = Math.max(1, (data.crownRadiusX + data.crownRadiusZ) * 0.5);
  const spacing = (crownR * 2.2) / Math.sqrt(Math.max(1, count / perCluster));
  const anchors = spreadAnchors(
    fruitAnchors(data, options.kind === 'flower'),
    Math.ceil(count / perCluster),
    spacing,
    rnd
  );

  let placed = 0;
  const down = new THREE.Vector3(0, -1, 0);
  const raycaster = new THREE.Raycaster();
  if (foliage) foliage.updateMatrixWorld(true);

  // Points along every leaf card (a card grows along its local Y from its
  // base), for flowers to be held against: where the leaves really are.
  const leafPoints: THREE.Vector3[] = [];
  if (foliage && options.kind === 'flower') {
    const m = new THREE.Matrix4();
    const cardH = 1.22 * (config.leafCardSize ?? 1);
    foliage.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        m.premultiply(mesh.matrixWorld);
        for (const t of [0.25, 0.5, 0.75]) {
          leafPoints.push(new THREE.Vector3(0, cardH * t, 0).applyMatrix4(m));
        }
      }
    });
  }
  const nearestLeaf = (p: THREE.Vector3): THREE.Vector3 | null => {
    let best: THREE.Vector3 | null = null;
    let bestSq = Infinity;
    for (const q of leafPoints) {
      const d = q.distanceToSquared(p);
      if (d < bestSq) {
        bestSq = d;
        best = q;
      }
    }
    return best;
  };
  const center = data.crownCenter;
  for (const anchor of anchors) {
    // out of the crown a little, so the fruit shows against the leaves
    const outward = new THREE.Vector3(
      anchor.position.x,
      0,
      anchor.position.z
    );
    if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
    outward.normalize();

    // Where the leaves are, seen from outside along the line to this twig.
    let skin: THREE.Vector3 | null = null;
    let skinDir: THREE.Vector3 | null = null;
    if (foliage) {
      const dir = anchor.position.clone().sub(center);
      if (dir.lengthSq() < 1e-4) dir.copy(outward);
      dir.normalize();
      raycaster.set(anchor.position.clone().addScaledVector(dir, crownR * 3), dir.clone().negate());
      raycaster.far = crownR * 3.2;
      const hit = raycaster.intersectObject(foliage, true)[0];
      if (hit) {
        // A leaf card is a quad: the ray can land on its transparent corner,
        // well out from any leaf, and the fruit hung in the air there. So the
        // skin is never taken further from the twig than a tuft reaches.
        const maxOut = (config.clusterRadius ?? 1) * 0.8;
        const out = Math.min(hit.point.distanceTo(anchor.position), maxOut);
        skin = anchor.position.clone().addScaledVector(dir, out);
        skinDir = dir;
      }
    }

    if (options.kind === 'flower') {
      // Blossoms open in the leaves, facing out. Spread sideways from ONE
      // point on the skin and set a little in front of it, the flowers of a
      // cluster at the edge of a bush stood out past its outline, in the air.
      // So each flower gets its own spot: offset from its twig, then found on
      // the leaves along its own line in, never further out than a tuft
      // reaches, and set INTO the leaves so only its face shows.
      const facing = skinDir ?? outward;
      const side = new THREE.Vector3().crossVectors(facing, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      const up = new THREE.Vector3().crossVectors(side, facing).normalize();
      const maxOut = (config.clusterRadius ?? 1) * 0.6;
      for (let k = 0; k < perCluster && placed < count; k++, placed++) {
        const a = (k / perCluster) * Math.PI * 2 + rnd();
        const base = anchor.position.clone()
          .addScaledVector(side, perCluster > 1 ? Math.cos(a) * r * 1.8 : 0)
          .addScaledVector(up, perCluster > 1 ? Math.sin(a) * r * 1.8 : 0);
        let out = maxOut * 0.5;                        // no leaves found: kept well inside
        if (foliage) {
          raycaster.set(base.clone().addScaledVector(facing, crownR * 3), facing.clone().negate());
          raycaster.far = crownR * 3.2;
          const hit = raycaster.intersectObject(foliage, true)[0];
          if (hit) out = THREE.MathUtils.clamp(hit.point.clone().sub(base).dot(facing), 0, maxOut);
        }
        const pos = base.addScaledVector(facing, out - r * 0.4);
        // The ray can still stop on a card's transparent corner, out in the
        // air: a flower is finally held within reach of real leaf.
        const leaf = nearestLeaf(pos);
        if (leaf && leaf.distanceTo(pos) > r * 2) {
          pos.copy(leaf).addScaledVector(pos.clone().sub(leaf).normalize(), r * 2);
        }
        const face = facing.clone().addScaledVector(up, 0.35).normalize();   // turned a little to the sky
        const flower = new THREE.Mesh(flowerGeo!, flowerMat!);
        flower.name = 'PixelShrubBloom';
        flower.userData.flowerFamily = FLOWER_PROFILES[rockBiomeForSpecies(config.species)].family;
        flower.position.copy(pos);
        flower.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face);
        flower.rotateZ((rnd() - 0.5) * 0.8);          // (the sprite is lit from its top left)
        flower.scale.setScalar(0.85 + rnd() * 0.3);
        group.add(flower);
      }
      continue;
    }

    // one sprite per twig: an apple, or a whole bunch of berries
    placed += perCluster;
    const size = fruitWidth * (0.9 + rnd() * 0.2);
    if (skin && skinDir) {
      // on the crown's skin, set a little into the leaves so it sits among them
      const fruit = makeSprite(fruitMat!, size);
      fruit.position.copy(skin).addScaledVector(skinDir, -r * (0.2 + rnd() * 0.3));
      group.add(fruit);
      continue;
    }
    // no leaves found: it hangs from the twig by the stalk drawn at its top
    const fruit = makeSprite(fruitMat!, size, new THREE.Vector2(0.5, 0.95));
    fruit.position.copy(anchor.position).addScaledVector(down, r * 0.2).addScaledVector(outward, r * 0.3);
    group.add(fruit);
  }

  return { group, geometries, materials, textures };
}
