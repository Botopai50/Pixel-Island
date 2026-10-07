import * as THREE from 'three';
import type { TerrainGenerator } from '../terrain/terrainGenerator.ts';
import { LANDMARK_CELL, landmarkForCell, type LandmarkSite } from './landmarkPlanner.ts';
import { LandmarkBuilder } from './landmarkBuilder.ts';
import { CONFIG } from '../../config.ts';

/** Distância (m) até onde as cenas ficam montadas, e onde são desmontadas (com folga) */
const BUILD_RADIUS = 1600;
const DROP_RADIUS = 1900;
/** orçamento por quadro: planejar células e montar cenas custa alguns ms cada */
const PLAN_PER_FRAME = 2;
const BUILD_PER_FRAME = 1;

/**
 * Mantém montados os landmarks (landmarkPlanner) em volta do jogador: planeja as células aos
 * poucos, monta a cena das mais próximas primeiro e desmonta as que ficaram longe.
 */
export class LandmarkManager {
  private group = new THREE.Group();
  private built = new Map<string, THREE.Group | null>();
  private builder: LandmarkBuilder;

  constructor(scene: THREE.Scene, private terrainGen: TerrainGenerator) {
    this.group.name = 'landmarks';
    scene.add(this.group);
    this.builder = new LandmarkBuilder((x, z) => this.terrainGen.getHeight(x, z));
  }

  public update(x: number, z: number): void {
    if (!CONFIG.LANDMARKS_ENABLED) return;
    const r = Math.ceil(BUILD_RADIUS / LANDMARK_CELL);
    const ccx = Math.floor(x / LANDMARK_CELL), ccz = Math.floor(z / LANDMARK_CELL);
    // células por distância (as mais perto primeiro)
    const cells: [number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      const mx = (cx + 0.5) * LANDMARK_CELL, mz = (cz + 0.5) * LANDMARK_CELL;
      const d = Math.hypot(mx - x, mz - z);
      if (d < BUILD_RADIUS + LANDMARK_CELL * 0.7) cells.push([cx, cz, d]);
    }
    cells.sort((a, b) => a[2] - b[2]);
    let planned = 0, builds = 0;
    for (const [cx, cz] of cells) {
      const key = this.terrainGen.getSeed() + ':' + cx + ':' + cz;
      if (this.built.has(key)) continue;
      if (planned >= PLAN_PER_FRAME || builds >= BUILD_PER_FRAME) break;
      planned++;
      const site = landmarkForCell(this.terrainGen, cx, cz);
      if (!site || Math.hypot(site.x - x, site.z - z) > BUILD_RADIUS) {
        if (!site) this.built.set(key, null);
        continue;
      }
      builds++;
      this.built.set(key, this.buildSite(site));
    }
    // desmonta o que ficou longe
    for (const [key, obj] of this.built) {
      if (!obj) {
        const [, cx, cz] = key.split(':').map(Number);
        if (Math.hypot((cx + 0.5) * LANDMARK_CELL - x, (cz + 0.5) * LANDMARK_CELL - z) > DROP_RADIUS + LANDMARK_CELL) this.built.delete(key);
        continue;
      }
      if (Math.hypot(obj.position.x - x, obj.position.z - z) > DROP_RADIUS) {
        this.dispose(obj);
        this.built.delete(key);
      }
    }
  }

  private buildSite(site: LandmarkSite): THREE.Group | null {
    // rio ou lago passou por cima do lugar (o planejamento usa o relevo sem a água): não monta
    const h = this.terrainGen.getHeight(site.x, site.z);
    if (h < 0.25 || site.y - h > 2.0) return null;
    const obj = this.builder.build(site);
    this.group.add(obj);
    return obj;
  }

  private dispose(obj: THREE.Group): void {
    this.group.remove(obj);
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  }

  /** Lista dos landmarks montados agora (para depuração). */
  public list(): { type: string; x: number; z: number }[] {
    const out: { type: string; x: number; z: number }[] = [];
    for (const obj of this.built.values()) if (obj) out.push({ type: obj.name.replace('landmark:', ''), x: obj.position.x, z: obj.position.z });
    return out;
  }

  /** Outra seed: desmonta tudo. */
  public reset(): void {
    for (const obj of this.built.values()) if (obj) this.dispose(obj);
    this.built.clear();
  }
}
