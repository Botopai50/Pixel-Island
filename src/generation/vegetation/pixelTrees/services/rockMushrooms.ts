// @ts-nocheck
import * as THREE from 'three';
import { RockConfig, TreeConfig } from '../types';
import { resolvePixelTextureParams } from './pixelArtTextureSystem';
import { pixelMossNoiseAt as noise } from './mossStyle';
import { rockMushroomTexture } from './pixelSprites';
import { limitMushroomPitch } from './mushroomRotation';

/** Tiny mushrooms on damp, mossy surface pockets. Separate seeded RNG
 * keeps the stone itself unchanged when the accessory controls are adjusted. */
export function addRockMushrooms(asset: THREE.Group, config: TreeConfig, settings: RockConfig) {
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  if (!settings.mushrooms || (settings.mushroomCount ?? 6) <= 0) return { materials, textures, geometries };
  const count = THREE.MathUtils.clamp(Math.round(settings.mushroomCount ?? 6), 0, 24);
  const size = THREE.MathUtils.clamp(settings.mushroomSize ?? 0.38, 0.12, 0.8);
  const params = resolvePixelTextureParams(config);
  const density = params.barkTexelsPerMetre * 2.8;
  let state = ((Math.floor(config.seed) * 31 + 5321) % 233280 + 233280) % 233280;
  const rnd = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
  const stones = asset.children.filter(o => o instanceof THREE.Mesh) as THREE.Mesh[];
  asset.updateWorldMatrix(true, true);
  const bounds = stones.map(stone => new THREE.Box3().setFromObject(stone));
  const stoneVertices: THREE.Vector3[] = [];
  for (const stone of stones) {
    const positions = stone.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) stoneVertices.push(stone.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)));
  }
  const ray = new THREE.Raycaster();
  const anchors: THREE.Vector3[] = [];
  const mats = new Map<number, THREE.MeshBasicMaterial>();
  let cardGeometry: THREE.PlaneGeometry | undefined;
  for (let attempt = 0; attempt < Math.max(500, count * 100) && anchors.length < count; attempt++) {
    const index = Math.floor(rnd() * stones.length);
    const stone = stones[index], box = bounds[index];
    ray.set(new THREE.Vector3(THREE.MathUtils.lerp(box.min.x, box.max.x, rnd()), box.max.y + 1,
      THREE.MathUtils.lerp(box.min.z, box.max.z, rnd())), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(stone, false)[0];
    if (!hit?.face || hit.face.normal.y <= 0.25) continue;
    const growthNormal = hit.face.normal.clone().transformDirection(stone.matrixWorld);
    // A supporting plane is a strict geometric guarantee: all stone vertices
    // lie behind it, while the mushroom cap stays in front of it.
    // Reject concave pockets and neighbouring rocks that invade that space.
    if (stoneVertices.some(vertex => vertex.clone().sub(hit.point).dot(growthNormal) > 0.00001)) continue;
    const local = stone.worldToLocal(hit.point.clone());
    const pos = stone.geometry.attributes.position;
    const normals = stone.geometry.attributes.aMossNormal;
    const corners = [hit.face.a, hit.face.b, hit.face.c];
    const triangle = new THREE.Triangle(...corners.map(i => new THREE.Vector3().fromBufferAttribute(pos, i)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
    const bary = triangle.getBarycoord(local, new THREE.Vector3())!;
    const normal = new THREE.Vector3();
    corners.forEach((i, k) => normal.addScaledVector(new THREE.Vector3().fromBufferAttribute(normals, i), bary.getComponent(k)));
    normal.normalize();
    const p = hit.point.clone().multiplyScalar(density);
    const field = noise(p.x / 8 + params.seed, p.y / 8 + params.seed, p.z / 8 + params.seed) * 0.75
      + noise(p.x / 3 + 17 + params.seed, p.y / 3 + 17 + params.seed, p.z / 3 + 17 + params.seed) * 0.25;
    const groove = (1 - THREE.MathUtils.smoothstep(Math.abs(noise(p.x / 8 + 57, p.y / 8 + 57, p.z / 8 + 57) - 0.5), 0.015, 0.12)) * settings.cracks;
    const damp = Math.max(0, normal.dot(new THREE.Vector3(0, 0.25, -0.95)));
    const want = Math.min(0.5, (0.1 + damp * 0.45 + Math.max(0, normal.y) * 0.3) * settings.moss * 1.6
      + groove * 0.15 * settings.moss) * (0.55 + (0.35 + groove * 0.65) * 0.9);
    if (settings.moss > 0.05 && field >= want) continue;
    const snow = noise(p.x / 16 + 91, p.y / 16 + 91, p.z / 16 + 91) * 0.78
      + noise(p.x / 5 + 113, p.y / 5 + 113, p.z / 5 + 113) * 0.17;
    if (settings.snow > 0 && snow < Math.min(0.94, settings.snow * (0.32 + Math.max(0, normal.y) * 0.9))) continue;
    if (anchors.some(point => point.distanceTo(hit.point) < size * 0.65)) continue;
    const variant = Math.floor(rnd() * (settings.biome === 'swamp' || settings.biome === 'korok' ? 3 : 2));
    let material = mats.get(variant);
    if (!material) {
      const texture = rockMushroomTexture(variant, variant === 2 && settings.biome === 'korok');
      material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide }); mats.set(variant, material);
      materials.push(material); textures.push(texture);
    }
    if (!cardGeometry) {
      cardGeometry = new THREE.PlaneGeometry(1, 1);
      cardGeometry.translate(0.5 - 7 / 16, 0.5, 0);
      geometries.push(cardGeometry);
    }
    const card = new THREE.Mesh(cardGeometry, material);
    const width = size * (0.8 + rnd() * 0.4);
    card.scale.setScalar(width);
    card.name = `RockMushroom_${anchors.length + 1}`;
    card.userData.excludeFromOBJ = true;
    // Only the authored cap pixels and their rim stop rotation. The stalk
    // remains free to enter the surface as the mushroom follows the camera.
    const image = material.map!.image as { width: number; height: number; data: Uint8Array };
    const capMask = material.map!.userData.capMask as Uint8Array;
    const collisionPoints: THREE.Vector3[] = [];
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (!capMask[y * image.width + x]) continue;
      for (const dx of [0, 1]) for (const dy of [0, 1]) collisionPoints.push(new THREE.Vector3((x + dx) / image.width - 7 / 16, (y + dy) / image.height, 0));
    }
    card.userData.collisionPoints = collisionPoints;
    const holder = new THREE.Group();
    holder.name = 'RockMushroomAnchor'; holder.position.copy(local); holder.add(card);
    holder.userData.surfacePoint = hit.point.clone(); holder.userData.surfaceNormal = growthNormal;
    const clearance = 0.008;
    card.position.copy(hit.face.normal).multiplyScalar(clearance);
    limitMushroomPitch(card, hit.face.normal.clone(), width, collisionPoints, clearance, image.width);
    stone.add(holder); anchors.push(hit.point.clone());
  }
  return { materials, textures, geometries };
}
