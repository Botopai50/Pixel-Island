// @ts-nocheck
import * as THREE from 'three';
import { RockConfig, TreeConfig } from '../types';
import { boulderGeometry, createPixelRockMaterial } from './rockSystem';

/** Independent seed stream keeps the parent rocks and their accessories stable. */
export function addRockGravel(asset: THREE.Group, config: TreeConfig, settings: RockConfig) {
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  const count = THREE.MathUtils.clamp(Math.round(settings.gravelCount ?? 6), 0, 16);
  if (!settings.gravel || count === 0) return { geometries, materials, textures };
  const size = THREE.MathUtils.clamp(settings.gravelSize ?? 0.18, 0.06, 0.4);
  const spread = THREE.MathUtils.clamp(settings.gravelSpread ?? 0.8, 0.1, 2.5);
  let state = ((Math.floor(config.seed) * 59 + 7319) % 233280 + 233280) % 233280;
  const rnd = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
  const { material, palette, lightDir } = createPixelRockMaterial(config, {
    ...settings, moss: settings.moss * 0.25, cracks: settings.cracks * 0.25, snowRim: false,
  });
  materials.push(material); textures.push(palette);
  const gravel = new THREE.Group(); gravel.name = 'RockGravel';
  const placed: { point: THREE.Vector3; radius: number }[] = [];
  for (let cluster = 0; cluster < count; cluster++) {
    const angle = cluster * 2.39996 + rnd() * 0.7;
    const clusterRadius = cluster === 0 ? 0 : (spread + size * Math.sqrt(count) * 0.6) * (0.35 + rnd() * 0.65);
    const anchor = new THREE.Vector3(Math.cos(angle) * clusterRadius, 0, Math.sin(angle) * clusterRadius);
    const target = 3 + Math.floor(rnd() * 4);
    let added = 0;
    for (let attempt = 0; attempt < target * 30 && added < target; attempt++) {
      const diameter = size * (0.35 + rnd() * 0.85);
      const radius = diameter * 0.65;
      const theta = rnd() * Math.PI * 2, distance = Math.sqrt(rnd()) * (0.12 + spread * 0.45);
      const point = anchor.clone().add(new THREE.Vector3(Math.cos(theta) * distance, 0, Math.sin(theta) * distance));
      if (placed.some(p => p.point.distanceTo(point) < p.radius + radius)) continue;
      const geometry = boulderGeometry(rnd, new THREE.Vector3(diameter, diameter * (0.4 + rnd() * 0.4), diameter * (0.65 + rnd() * 0.5)), rnd() * Math.PI * 2, lightDir, {
        grounded: true, detail: 0, irregularity: 0.25 + rnd() * 0.3, shape: rnd() < 0.35 ? 'slab' : 'boulder',
      });
      geometries.push(geometry);
      const pebble = new THREE.Mesh(geometry, material); pebble.name = `Pebble_${placed.length + 1}`;
      pebble.position.copy(point); pebble.castShadow = pebble.receiveShadow = true;
      gravel.add(pebble); placed.push({ point, radius }); added++;
    }
  }
  asset.add(gravel);
  return { geometries, materials, textures };
}
