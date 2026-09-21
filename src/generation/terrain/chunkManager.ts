import * as THREE from 'three';
import { Chunk } from './chunk.ts';
import { TerrainGenerator } from './terrainGenerator.ts';
import { VegetationManager } from '../vegetation/vegetationManager.ts';
import { TerrainTextureForge } from './terrainTextureForge.ts';
import { CONFIG } from '../../config.ts';

interface ChunkQueueItem {
  cx: number;
  cz: number;
  key: string;
  distSq: number;
}

export class ChunkManager {
  private scene: THREE.Scene;
  private terrainGen: TerrainGenerator;
  private vegetationMgr: VegetationManager;
  private terrainMaterial: THREE.Material;
  private waterMaterial: THREE.Material;
  private forge: TerrainTextureForge;

  private chunks: Map<string, Chunk> = new Map();
  private buildQueue: ChunkQueueItem[] = [];
  private queuedKeys: Set<string> = new Set();

  private currentCenterCx: number = 999999;
  private currentCenterCz: number = 999999;
  private viewRadius: number = CONFIG.VIEW_RADIUS_CHUNKS;

  constructor(
    scene: THREE.Scene,
    terrainGen: TerrainGenerator,
    vegetationMgr: VegetationManager,
    terrainMaterial: THREE.Material,
    waterMaterial: THREE.Material,
    forge?: TerrainTextureForge
  ) {
    this.scene = scene;
    this.terrainGen = terrainGen;
    this.vegetationMgr = vegetationMgr;
    this.terrainMaterial = terrainMaterial;
    this.waterMaterial = waterMaterial;
    this.forge = forge || TerrainTextureForge.getInstance(terrainGen.getSeed());
  }

  public setViewRadius(r: number): void {
    if (this.viewRadius !== r) {
      this.viewRadius = r;
      if (this.currentCenterCx !== 999999) {
        this.refreshChunkPlan(this.currentCenterCx, this.currentCenterCz);
      }
    }
  }

  public getViewRadius(): number {
    return this.viewRadius;
  }

  public update(targetX: number, targetZ: number, forceReload: boolean = false): void {
    const cx = Math.floor((targetX + CONFIG.CHUNK_SIZE / 2) / CONFIG.CHUNK_SIZE);
    const cz = Math.floor((targetZ + CONFIG.CHUNK_SIZE / 2) / CONFIG.CHUNK_SIZE);

    if (cx !== this.currentCenterCx || cz !== this.currentCenterCz || forceReload) {
      this.currentCenterCx = cx;
      this.currentCenterCz = cz;
      this.refreshChunkPlan(cx, cz);
    }

    // Processa a fila de construção com orçamento de tempo por frame (garante 60 FPS cravados)
    this.processBuildQueue();
  }

  private refreshChunkPlan(cx: number, cz: number): void {
    const r = this.viewRadius;
    const unloadDistSq = (r + CONFIG.UNLOAD_MARGIN_CHUNKS) * (r + CONFIG.UNLOAD_MARGIN_CHUNKS);

    // 1. Identifica chunks no raio de visão que precisam ser gerados
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > r * r + 1) continue;

        const targetCx = cx + dx;
        const targetCz = cz + dz;
        const key = `${targetCx}_${targetCz}`;

        if (!this.chunks.has(key) && !this.queuedKeys.has(key)) {
          this.buildQueue.push({ cx: targetCx, cz: targetCz, key, distSq });
          this.queuedKeys.add(key);
        }
      }
    }

    // 2. Ordena a fila priorizando chunks mais próximos da câmera
    this.buildQueue.sort((a, b) => a.distSq - b.distSq);

    // 3. Descarrega da memória chunks distantes
    for (const [key, chunk] of this.chunks.entries()) {
      const dx = chunk.cx - cx;
      const dz = chunk.cz - cz;
      const distSq = dx * dx + dz * dz;

      if (distSq > unloadDistSq) {
        this.scene.remove(chunk.group);
        chunk.destroy();
        this.chunks.delete(key);
      }
    }

    // 4. Descarta da fila itens que ficaram fora do raio de visão antes de serem gerados
    this.buildQueue = this.buildQueue.filter((item) => {
      const dx = item.cx - cx;
      const dz = item.cz - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq > unloadDistSq) {
        this.queuedKeys.delete(item.key);
        return false;
      }
      return true;
    });
  }

  private processBuildQueue(): void {
    if (this.buildQueue.length === 0 && this.chunks.size > 0) {
      // Atualiza LOD de vegetação para chunks que entraram no raio próximo enquanto a fila estiver ociosa
      const vegRadiusSq = (CONFIG.VEGETATION_RADIUS_CHUNKS || 9) * (CONFIG.VEGETATION_RADIUS_CHUNKS || 9);
      const startTime = performance.now();
      let vegPopulated = 0;
      for (const chunk of this.chunks.values()) {
        if (!chunk.hasVegetation && !chunk.isSubmerged) {
          const dx = chunk.cx - this.currentCenterCx;
          const dz = chunk.cz - this.currentCenterCz;
          if (dx * dx + dz * dz <= vegRadiusSq) {
            const enableDetail = (dx * dx + dz * dz) <= 16;
            chunk.populateVegetation(this.vegetationMgr, this.terrainGen, enableDetail);
            vegPopulated++;
            if (vegPopulated >= 2 || (performance.now() - startTime >= 6.0)) {
              break;
            }
          }
        }
      }
      return;
    }

    if (this.buildQueue.length === 0) return;

    const startTime = performance.now();
    // Burst inicial: no spawn (poucos chunks carregados), permitimos processamento acelerado para abrir a cena imediatamente
    const isInitialBurst = this.chunks.size < 45;
    const MAX_TIME_MS = isInitialBurst ? 32.0 : 6.0;
    const maxChunksPerFrame = isInitialBurst ? 4 : 1;
    let chunksBuilt = 0;

    const vegRadiusSq = (CONFIG.VEGETATION_RADIUS_CHUNKS || 9) * (CONFIG.VEGETATION_RADIUS_CHUNKS || 9);

    while (this.buildQueue.length > 0) {
      const item = this.buildQueue.shift()!;
      this.queuedKeys.delete(item.key);

      if (this.chunks.has(item.key)) continue;

      const distSq = (item.cx - this.currentCenterCx) ** 2 + (item.cz - this.currentCenterCz) ** 2;
      const enableVeg = distSq <= vegRadiusSq;
      const enableDetail = distSq <= 16;

      const chunk = new Chunk(
        item.cx,
        item.cz,
        this.terrainGen,
        this.vegetationMgr,
        this.terrainMaterial,
        this.waterMaterial,
        enableVeg,
        this.forge,
        enableDetail
      );

      this.chunks.set(item.key, chunk);
      if (!chunk.isSubmerged) {
        this.scene.add(chunk.group);
      }
      chunksBuilt++;

      if (chunksBuilt >= maxChunksPerFrame || (performance.now() - startTime >= MAX_TIME_MS)) {
        break;
      }
    }
  }

  public clearAll(): void {
    for (const [, chunk] of this.chunks.entries()) {
      this.scene.remove(chunk.group);
      chunk.destroy();
    }
    this.chunks.clear();
    this.buildQueue = [];
    this.queuedKeys.clear();
    this.currentCenterCx = 999999;
    this.currentCenterCz = 999999;
  }

  public setForge(forge: TerrainTextureForge): void {
    this.forge = forge;
  }

  public getLoadedChunkCount(): number {
    return this.chunks.size;
  }

  public getQueueLength(): number {
    return this.buildQueue.length;
  }
}
