import * as THREE from 'three';
import { createTree } from './services/treeGenerator';
import * as presets from './constants/presets';

/** Medição: triângulos, meshes e materiais de cada espécie de árvore adulta. */
export function measureTrees(): any[] {
  const list: any[] = Object.values((presets as any).TREE_PRESETS);
  const out: any[] = [];
  for (const cfg of list) {
    if (!cfg || !cfg.species) continue;
    if (cfg.growthStage && cfg.growthStage !== 'adult') continue;
    const t0 = performance.now();
    try {
      const inst = createTree({ ...cfg });
      let tris = 0, meshes = 0, inst_ = 0;
      const mats = new Set<string>();
      inst.group.traverse((o: any) => {
        if (o.isMesh || o.isPoints) {
          meshes++;
          const g = o.geometry;
          tris += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
          const m = Array.isArray(o.material) ? o.material : [o.material];
          m.forEach((x: any) => mats.add(x.type));
          if (o.isInstancedMesh) inst_++;
        }
      });
      const b = new THREE.Box3().setFromObject(inst.group);
      out.push({ id: cfg.id, species: cfg.species, tris: Math.round(tris), meshes, mats: [...mats].join('/'), h: +(b.max.y - b.min.y).toFixed(1), ms: Math.round(performance.now() - t0) });
      inst.dispose();
    } catch (e: any) {
      out.push({ id: cfg.id, species: cfg.species, error: String(e?.message || e).slice(0, 120) });
    }
  }
  return out;
}
