// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import type { TreeInstance } from './treeGenerator';
import { ROCK_BIOMES, rockBiomeForSpecies } from '../constants/rockBiomes';
import { boulderGeometry, createPixelRockMaterial } from './rockSystem';
import { addRockMushrooms } from './rockMushrooms';
import { addRockOre } from './oreSystem';
import { addRockGravel } from './rockGravel';

/** Builds the asset separately from its biome presentation island. */
export function createProceduralRock(config: TreeConfig): TreeInstance {
  const settings = config.rock ?? ROCK_BIOMES[rockBiomeForSpecies(config.species)].config;
  const biome = ROCK_BIOMES[settings.biome];
  const group = new THREE.Group();
  group.name = 'BotW_ProceduralRock';
  const asset = new THREE.Group();
  asset.name = 'RockAsset';
  group.add(asset);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const { material, palette, lightDir } = createPixelRockMaterial(config, settings);
  materials.push(material);
  let state = ((Math.floor(config.seed) % 233280) + 233280) % 233280;
  const rnd = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
  const count = THREE.MathUtils.clamp(Math.round(settings.count), 1, 12);
  const width = THREE.MathUtils.clamp(settings.width, 0.3, 8);
  const height = THREE.MathUtils.clamp(settings.height, 0.2, 8);
  const depth = THREE.MathUtils.clamp(settings.depth, 0.3, 8);
  for (let i = 0; i < (settings.gravel ? 0 : count); i++) {
    const scale = i === 0 ? 1 : 0.35 + rnd() * 0.35;
    const geometry = boulderGeometry(rnd, new THREE.Vector3(width * scale, height * scale, depth * scale), rnd() * Math.PI * 2, lightDir, {
      irregularity: THREE.MathUtils.clamp(settings.irregularity, 0, 1),
      detail: THREE.MathUtils.clamp(Math.round(settings.detail), 0, 2),
      shape: settings.shape, grounded: true,
    });
    geometries.push(geometry);
    const rock = new THREE.Mesh(geometry, material);
    rock.name = `Rock_${i + 1}`;
    rock.castShadow = true;
    rock.receiveShadow = true;
    if (i > 0) {
      const angle = ((i - 1) / Math.max(1, count - 1)) * Math.PI * 2 + rnd() * 0.5;
      const distance = Math.max(width, depth) * 0.45 + settings.spread * (0.3 + rnd() * 0.35);
      rock.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    }
    asset.add(rock);
  }
  const gravel = addRockGravel(asset, config, settings);
  geometries.push(...gravel.geometries); materials.push(...gravel.materials);
  const bounds = new THREE.Box3().setFromObject(asset);
  const radius = bounds.isEmpty() ? 1.2 : settings.gravel
    ? Math.max(...[bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.z, bounds.max.z].map(z => Math.hypot(x, z)))) + 0.6
    : Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z)) + 1.2;
  const groundGeo = new THREE.CylinderGeometry(radius, radius * 1.08, 0.55, 40);
  const groundMat = new THREE.MeshToonMaterial({ color: settings.snow > 0.45 ? '#e4edf6' : biome.ground });
  geometries.push(groundGeo); materials.push(groundMat);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -0.275;
  ground.name = 'GroundMound'; ground.userData.ground = true; ground.receiveShadow = true;
  group.add(ground);

  const grass = new THREE.Group(); grass.name = 'RockGrass'; grass.userData.ground = true;
  if (settings.biome !== 'gerudo' && settings.snow < 0.45) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.04, 0); shape.lineTo(0.04, 0); shape.quadraticCurveTo(0.04, 0.22, -0.04, 0.34); shape.lineTo(-0.04, 0);
    const bladeGeo = new THREE.ShapeGeometry(shape);
    const bladeMat = new THREE.MeshToonMaterial({ color: biome.grass, side: THREE.DoubleSide });
    geometries.push(bladeGeo); materials.push(bladeMat);
    for (let i = 0; i < 36; i++) {
      const angle = rnd() * Math.PI * 2;
      const r = radius * (0.78 + rnd() * 0.15);
      const tuft = new THREE.Group();
      tuft.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      for (let j = 0; j < 3; j++) {
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.rotation.y = j * Math.PI / 3 + rnd();
        blade.scale.setScalar(0.7 + rnd() * 0.6);
        tuft.add(blade);
      }
      grass.add(tuft);
    }
  }
  group.add(grass);
  const mushrooms = addRockMushrooms(asset, config, settings);
  materials.push(...mushrooms.materials);
  geometries.push(...mushrooms.geometries);
  const ore = addRockOre(asset, config, settings, material);
  geometries.push(...ore.geometries); materials.push(...ore.materials);
  return {
    group, foliageMaterials: [], barkMaterial: material, canFell: false,
    fell: () => null, update: () => {},
    dispose: () => {
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); palette.dispose();
      mushrooms.textures.forEach(texture => texture.dispose());
      ore.textures.forEach(texture => texture.dispose());
      gravel.textures.forEach(texture => texture.dispose());
    },
  };
}
