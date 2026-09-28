import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PRNG } from '../math/prng.ts';
import { TerrainGenerator } from '../terrain/terrainGenerator.ts';
import { BiomeType } from '../types.ts';

const CELL_SIZE = 460;
const ACTIVE_RADIUS = 2;

type LandmarkKind = 'stoneCircle' | 'monolith' | 'rockArch' | 'fossil';

export class LandmarkManager {
  public readonly root = new THREE.Group();

  private readonly cells = new Map<string, THREE.Group>();
  private readonly stoneMaterial = new THREE.MeshLambertMaterial({ color: 0x77766f, flatShading: true });
  private readonly darkStoneMaterial = new THREE.MeshLambertMaterial({ color: 0x4f514f, flatShading: true });
  private readonly boneMaterial = new THREE.MeshLambertMaterial({ color: 0xcabf9d, flatShading: true });

  private seed: number;
  private lastCellX = Number.NaN;
  private lastCellZ = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    seed: number,
    private readonly terrain: TerrainGenerator
  ) {
    this.seed = seed >>> 0;
    this.root.name = 'procedural_landmarks';
    this.scene.add(this.root);
  }

  public reseed(seed: number): void {
    this.seed = seed >>> 0;
    this.clear();
    this.lastCellX = Number.NaN;
    this.lastCellZ = Number.NaN;
  }

  public update(x: number, z: number, force: boolean = false): void {
    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);
    if (!force && cx === this.lastCellX && cz === this.lastCellZ) return;

    this.lastCellX = cx;
    this.lastCellZ = cz;

    const wanted = new Set<string>();
    for (let dz = -ACTIVE_RADIUS; dz <= ACTIVE_RADIUS; dz++) {
      for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
        if (dx * dx + dz * dz > ACTIVE_RADIUS * ACTIVE_RADIUS + 1) continue;
        const k = this.key(cx + dx, cz + dz);
        wanted.add(k);
        if (!this.cells.has(k)) {
          const built = this.buildCell(cx + dx, cz + dz);
          if (built) {
            this.cells.set(k, built);
            this.root.add(built);
          }
        }
      }
    }

    for (const [k, group] of this.cells) {
      if (wanted.has(k)) continue;
      this.disposeGroup(group);
      this.root.remove(group);
      this.cells.delete(k);
    }
  }

  public clear(): void {
    for (const group of this.cells.values()) {
      this.disposeGroup(group);
      this.root.remove(group);
    }
    this.cells.clear();
  }

  private key(cx: number, cz: number): string {
    return `${cx}_${cz}`;
  }

  private buildCell(cx: number, cz: number): THREE.Group | null {
    const cellSeed01 = PRNG.hash2D(cx, cz, (this.seed ^ 0xa511e9b3) >>> 0);
    const cellSeed = Math.max(1, Math.floor(cellSeed01 * 0xffffffff));
    const rng = new PRNG(cellSeed);

    // Landmarks são raros de propósito: devem ser pontos de interesse, não decoração repetitiva.
    if (!rng.chance(0.36)) return null;

    let bestX = 0;
    let bestZ = 0;
    let bestY = 0;
    let bestBiome = BiomeType.COASTAL_MEADOW;
    let bestSlope = Infinity;

    for (let attempt = 0; attempt < 8; attempt++) {
      const x = cx * CELL_SIZE + rng.range(70, CELL_SIZE - 70);
      const z = cz * CELL_SIZE + rng.range(70, CELL_SIZE - 70);
      const pt = this.terrain.getPoint(x, z);

      if (pt.isWater || pt.height < 1.8 || pt.isLava) continue;
      if (pt.biome.type === BiomeType.VOLCANIC_CALDERA) continue;
      if (pt.slope > 0.30) continue;

      if (pt.slope < bestSlope) {
        bestSlope = pt.slope;
        bestX = x;
        bestZ = z;
        bestY = pt.height;
        bestBiome = pt.biome.type;
      }
    }

    if (!Number.isFinite(bestSlope)) return null;

    const kind = this.pickKind(bestBiome, rng);
    const landmark = this.buildLandmark(kind, rng);
    if (!landmark) return null;

    landmark.position.set(bestX, bestY, bestZ);
    landmark.rotation.y = rng.range(0, Math.PI * 2);
    landmark.name = `landmark_${kind}_${cx}_${cz}`;

    return landmark;
  }

  private pickKind(biome: BiomeType, rng: PRNG): LandmarkKind {
    if (
      biome === BiomeType.DESERT_DUNES ||
      biome === BiomeType.CANYON_DESERT ||
      biome === BiomeType.FROZEN_TUNDRA ||
      biome === BiomeType.ALPINE_TUNDRA
    ) {
      const r = rng.next();
      if (r < 0.38) return 'fossil';
      if (r < 0.72) return 'rockArch';
      return 'monolith';
    }

    if (
      biome === BiomeType.ROCKY_PEAKS ||
      biome === BiomeType.VOLCANIC_FIELD ||
      biome === BiomeType.SNOW_SUMMIT
    ) {
      return rng.chance(0.58) ? 'monolith' : 'rockArch';
    }

    return rng.chance(0.58) ? 'stoneCircle' : 'monolith';
  }

  private buildLandmark(kind: LandmarkKind, rng: PRNG): THREE.Group | null {
    switch (kind) {
      case 'stoneCircle': return this.buildStoneCircle(rng);
      case 'monolith': return this.buildMonolith(rng);
      case 'rockArch': return this.buildRockArch(rng);
      case 'fossil': return this.buildFossil(rng);
      default: return null;
    }
  }

  private buildStoneCircle(rng: PRNG): THREE.Group {
    const geos: THREE.BufferGeometry[] = [];
    const count = rng.rangeInt(7, 11);
    const radius = rng.range(5.0, 7.5);

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.10, 0.10);
      const h = rng.range(2.1, 4.5);
      const w = rng.range(0.75, 1.35);
      const d = rng.range(0.55, 1.05);
      const g = new THREE.BoxGeometry(w, h, d);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
        rng.range(-0.10, 0.10),
        -a + rng.range(-0.20, 0.20),
        rng.range(-0.08, 0.08)
      )));
      g.translate(Math.cos(a) * radius, h * 0.46, Math.sin(a) * radius);
      geos.push(g);
    }

    const center = new THREE.CylinderGeometry(rng.range(1.0, 1.7), rng.range(1.3, 2.0), 0.55, 6);
    center.translate(0, 0.18, 0);
    geos.push(center);

    return this.groupFromMerged(geos, this.stoneMaterial, 'stone_circle');
  }

  private buildMonolith(rng: PRNG): THREE.Group {
    const geos: THREE.BufferGeometry[] = [];
    const height = rng.range(7.0, 12.0);
    const main = new THREE.CylinderGeometry(
      rng.range(0.9, 1.4),
      rng.range(1.4, 2.1),
      height,
      rng.rangeInt(5, 6)
    );
    main.rotateX(rng.range(-0.035, 0.035));
    main.rotateZ(rng.range(-0.055, 0.055));
    main.translate(0, height * 0.48, 0);
    geos.push(main);

    const stones = rng.rangeInt(3, 6);
    for (let i = 0; i < stones; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(2.8, 5.0);
      const s = rng.range(0.6, 1.25);
      const g = new THREE.DodecahedronGeometry(1, 0);
      g.scale(s * 1.2, s * 0.7, s);
      g.rotateY(rng.range(0, Math.PI * 2));
      g.translate(Math.cos(a) * r, s * 0.35, Math.sin(a) * r);
      geos.push(g);
    }

    return this.groupFromMerged(geos, this.darkStoneMaterial, 'monolith');
  }

  private buildRockArch(rng: PRNG): THREE.Group {
    const geos: THREE.BufferGeometry[] = [];
    const width = rng.range(7.5, 11.0);
    const pillarH = rng.range(5.5, 8.5);

    for (const side of [-1, 1]) {
      const g = new THREE.DodecahedronGeometry(1.65, 0);
      g.scale(rng.range(1.0, 1.35), pillarH * 0.55, rng.range(1.0, 1.45));
      g.rotateY(rng.range(-0.35, 0.35));
      g.translate(side * width * 0.36, pillarH * 0.48, 0);
      geos.push(g);
    }

    const top = new THREE.DodecahedronGeometry(1.7, 0);
    top.scale(width * 0.34, rng.range(0.9, 1.3), rng.range(1.0, 1.4));
    top.rotateZ(rng.range(-0.06, 0.06));
    top.translate(0, pillarH * 0.92, 0);
    geos.push(top);

    return this.groupFromMerged(geos, this.stoneMaterial, 'rock_arch');
  }

  private buildFossil(rng: PRNG): THREE.Group {
    const group = new THREE.Group();
    const bones: THREE.BufferGeometry[] = [];

    const spineLength = rng.range(8, 13);
    const spine = new THREE.CylinderGeometry(0.25, 0.34, spineLength, 5);
    spine.rotateZ(Math.PI / 2);
    spine.rotateY(rng.range(-0.15, 0.15));
    spine.translate(0, 0.35, 0);
    bones.push(spine);

    const ribs = rng.rangeInt(5, 8);
    for (let i = 0; i < ribs; i++) {
      const t = ribs <= 1 ? 0 : i / (ribs - 1);
      const x = (t - 0.5) * spineLength * 0.82;
      const rib = new THREE.TorusGeometry(
        rng.range(1.55, 2.35),
        rng.range(0.14, 0.22),
        4,
        8,
        Math.PI * rng.range(0.72, 0.90)
      );
      rib.rotateX(Math.PI / 2);
      rib.rotateY((i % 2 === 0 ? 1 : -1) * rng.range(0.10, 0.28));
      rib.translate(x, rng.range(0.45, 0.8), 0);
      bones.push(rib);
    }

    const skull = new THREE.DodecahedronGeometry(1.0, 0);
    skull.scale(1.55, 0.85, 1.05);
    skull.rotateY(rng.range(-0.25, 0.25));
    skull.translate(spineLength * 0.58, 0.75, 0);
    bones.push(skull);

    const merged = BufferGeometryUtils.mergeGeometries(bones, false);
    for (const g of bones) g.dispose();
    if (!merged) return group;

    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, this.boneMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    group.name = 'fossil';
    return group;
  }

  private groupFromMerged(
    geometries: THREE.BufferGeometry[],
    material: THREE.Material,
    name: string
  ): THREE.Group {
    const group = new THREE.Group();
    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) return group;

    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
    return group;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
  }
}
