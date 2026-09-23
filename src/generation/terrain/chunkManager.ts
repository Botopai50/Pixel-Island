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

// Blocos distantes: além do anel NEAR_RING, cada bloco de FAR_TILE x FAR_TILE chunks vira UMA
// malha com UMA textura. Chunks distantes já usam a malha e a textura mais leves, então o bloco
// tem o mesmo visual - mas custa 1 draw call (e 1 job de worker) em vez de 16.
const FAR_TILE = 4;
const NEAR_RING = 7;

export class ChunkManager {
  private scene: THREE.Scene;
  private terrainGen: TerrainGenerator;
  private vegetationMgr: VegetationManager;
  private forge: TerrainTextureForge;

  private chunks: Map<string, Chunk> = new Map();
  private tiles: Map<string, Chunk> = new Map();
  private buildQueue: ChunkQueueItem[] = [];
  private queuedKeys: Set<string> = new Set();

  private currentCenterCx: number = 999999;
  private currentCenterCz: number = 999999;
  private viewRadius: number = CONFIG.VIEW_RADIUS_CHUNKS;
  private retainRadius: number = 0;
  // Incrementa sempre que algo que projeta/recebe sombra entra ou sai da cena (malha de relevo
  // pronta, vegetação populada, chunk descarregado) - sinaliza que o shadow map está velho.
  private sceneVersion: number = 0;
  private resolvedVersion: number = -1;
  private readonly bumpSceneVersion = (): void => { this.sceneVersion++; };

  constructor(
    scene: THREE.Scene,
    terrainGen: TerrainGenerator,
    vegetationMgr: VegetationManager,
    _terrainMaterial: THREE.Material,
    _waterMaterial: THREE.Material,
    forge?: TerrainTextureForge
  ) {
    this.scene = scene;
    this.terrainGen = terrainGen;
    this.vegetationMgr = vegetationMgr;
    // A vegetação de todos os chunks vive em InstancedMeshes compartilhados
    scene.add(vegetationMgr.instances.root);
    this.forge = forge || TerrainTextureForge.getInstance(terrainGen.getSeed());
  }

  /**
   * retainRadius: chunks já carregados até esse raio não são descarregados mesmo fora do raio de
   * visão (ex.: ao aproximar o zoom), para não serem regerados quando o zoom afastar de novo.
   */
  public setViewRadius(r: number, retainRadius: number = 0): void {
    if (this.viewRadius !== r || this.retainRadius !== retainRadius) {
      this.viewRadius = r;
      this.retainRadius = retainRadius;
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

    // Algo terminou de carregar: troca chunks <-> blocos distantes que já estejam prontos
    if (this.resolvedVersion !== this.sceneVersion) {
      this.resolvedVersion = this.sceneVersion;
      this.resolveTileOverlaps();
    }
  }

  /** Distância (em chunks, por eixo) do chunk central até o chunk mais próximo do bloco. */
  private tileDelta(tx: number, tz: number, cx: number, cz: number): { dx: number; dz: number } {
    const x0 = tx * FAR_TILE, z0 = tz * FAR_TILE;
    const dx = Math.max(0, x0 - cx, cx - (x0 + FAR_TILE - 1));
    const dz = Math.max(0, z0 - cz, cz - (z0 + FAR_TILE - 1));
    return { dx, dz };
  }

  private isFarTile(tx: number, tz: number): boolean {
    const { dx, dz } = this.tileDelta(tx, tz, this.currentCenterCx, this.currentCenterCz);
    return Math.max(dx, dz) > NEAR_RING;
  }

  private refreshChunkPlan(cx: number, cz: number): void {
    const r = this.viewRadius;
    const viewSq = r * r + 1;
    const keep = Math.max(r, this.retainRadius) + CONFIG.UNLOAD_MARGIN_CHUNKS;
    const keepSq = keep * keep;

    // 0. Chunks já carregados que ficaram perto sobem de LOD de textura/malha
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - cx, dz = chunk.cz - cz;
      chunk.setLOD(this.textureDensityFor(dx, dz), this.segmentsFor(dx, dz));
    }

    // 1. Percorre os blocos que tocam o raio de visão: os distantes viram um bloco único, os
    //    próximos são quebrados nos chunks individuais que estão dentro do raio
    const t0x = Math.floor((cx - r) / FAR_TILE), t1x = Math.floor((cx + r) / FAR_TILE);
    const t0z = Math.floor((cz - r) / FAR_TILE), t1z = Math.floor((cz + r) / FAR_TILE);
    for (let tx = t0x; tx <= t1x; tx++) {
      for (let tz = t0z; tz <= t1z; tz++) {
        const { dx, dz } = this.tileDelta(tx, tz, cx, cz);
        if (dx * dx + dz * dz > viewSq) continue;

        if (Math.max(dx, dz) > NEAR_RING) {
          const key = `${tx}_${tz}`;
          if (!this.tiles.has(key)) this.createTile(tx, tz, key);
          continue;
        }

        for (let ix = 0; ix < FAR_TILE; ix++) {
          for (let iz = 0; iz < FAR_TILE; iz++) {
            const ccx = tx * FAR_TILE + ix, ccz = tz * FAR_TILE + iz;
            const distSq = (ccx - cx) ** 2 + (ccz - cz) ** 2;
            if (distSq > viewSq) continue;
            const key = `${ccx}_${ccz}`;
            if (!this.chunks.has(key) && !this.queuedKeys.has(key)) {
              this.buildQueue.push({ cx: ccx, cz: ccz, key, distSq });
              this.queuedKeys.add(key);
            }
          }
        }
      }
    }

    // 2. Ordena a fila priorizando chunks mais próximos da câmera
    this.buildQueue.sort((a, b) => a.distSq - b.distSq);

    // 3. Descarrega da memória chunks e blocos distantes
    for (const [key, chunk] of this.chunks.entries()) {
      if ((chunk.cx - cx) ** 2 + (chunk.cz - cz) ** 2 > keepSq) {
        this.removeChunk(key, chunk);
      }
    }
    for (const [key, tile] of this.tiles.entries()) {
      const { dx, dz } = this.tileDelta(tile.cx, tile.cz, cx, cz);
      if (dx * dx + dz * dz > keepSq) this.removeTile(key, tile);
    }

    // 4. Descarta da fila itens que saíram do raio ou que agora pertencem a um bloco distante
    this.buildQueue = this.buildQueue.filter((item) => {
      const distSq = (item.cx - cx) ** 2 + (item.cz - cz) ** 2;
      const tileFar = this.isFarTile(Math.floor(item.cx / FAR_TILE), Math.floor(item.cz / FAR_TILE));
      if (distSq > keepSq || tileFar) {
        this.queuedKeys.delete(item.key);
        return false;
      }
      return true;
    });

    this.resolveTileOverlaps();
  }

  private createTile(tx: number, tz: number, key: string): void {
    const size = CONFIG.CHUNK_SIZE * FAR_TILE;
    // Chunks são centrados em (cx * CHUNK_SIZE); o bloco vai da borda do primeiro à do último
    const minX = tx * FAR_TILE * CONFIG.CHUNK_SIZE - CONFIG.CHUNK_SIZE / 2;
    const minZ = tz * FAR_TILE * CONFIG.CHUNK_SIZE - CONFIG.CHUNK_SIZE / 2;
    const tile = new Chunk(tx, tz, this.terrainGen, this.vegetationMgr, this.forge, {
      onSceneChanged: this.bumpSceneVersion,
      textureDensity: this.textureDensityFor(NEAR_RING + 1, 0),
      segments: this.segmentsFor(NEAR_RING + 1, 0) * FAR_TILE,
      area: { centerX: minX + size / 2, centerZ: minZ + size / 2, size }
    });
    this.tiles.set(key, tile);
    this.scene.add(tile.group);
  }

  /**
   * Troca sem buracos: um bloco distante só substitui seus chunks quando já está pronto, e um
   * bloco que ficou perto só sai quando todos os chunks que o substituem já apareceram.
   */
  private resolveTileOverlaps(): void {
    const cx = this.currentCenterCx, cz = this.currentCenterCz;
    const viewSq = this.viewRadius * this.viewRadius + 1;

    for (const [key, tile] of this.tiles.entries()) {
      const far = this.isFarTile(tile.cx, tile.cz);
      if (far && !tile.isReady()) continue;

      let replacementsReady = true;
      for (let ix = 0; ix < FAR_TILE; ix++) {
        for (let iz = 0; iz < FAR_TILE; iz++) {
          const ccx = tile.cx * FAR_TILE + ix, ccz = tile.cz * FAR_TILE + iz;
          const chunkKey = `${ccx}_${ccz}`;
          const chunk = this.chunks.get(chunkKey);
          if (far) {
            if (chunk) this.removeChunk(chunkKey, chunk);
          } else if ((ccx - cx) ** 2 + (ccz - cz) ** 2 <= viewSq && !chunk?.isReady()) {
            replacementsReady = false;
          }
        }
      }
      if (!far && replacementsReady) this.removeTile(key, tile);
    }
  }

  private removeChunk(key: string, chunk: Chunk): void {
    this.scene.remove(chunk.group);
    chunk.destroy();
    this.chunks.delete(key);
    this.sceneVersion++;
  }

  private removeTile(key: string, tile: Chunk): void {
    this.scene.remove(tile.group);
    tile.destroy();
    this.tiles.delete(key);
    this.sceneVersion++;
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

    // Textura e malha de relevo são geradas em Web Workers, então criar um Chunk aqui custa só
    // o teste de submersão e (perto da câmera) a vegetação: dá para despachar muitos por frame.
    const isInitialBurst = this.chunks.size < 35;

    const startTime = performance.now();
    const MAX_TIME_MS = isInitialBurst ? 24.0 : 5.0;
    const maxChunksPerFrame = isInitialBurst ? 64 : 24;
    let chunksBuilt = 0;

    const vegRadiusSq = (CONFIG.VEGETATION_RADIUS_CHUNKS || 9) * (CONFIG.VEGETATION_RADIUS_CHUNKS || 9);

    while (this.buildQueue.length > 0) {
      const item = this.buildQueue.shift()!;
      this.queuedKeys.delete(item.key);

      if (this.chunks.has(item.key)) continue;

      const dx = item.cx - this.currentCenterCx;
      const dz = item.cz - this.currentCenterCz;
      const distSq = dx * dx + dz * dz;

      const chunk = new Chunk(item.cx, item.cz, this.terrainGen, this.vegetationMgr, this.forge, {
        enableVegetation: distSq <= vegRadiusSq,
        enableDetailFlora: distSq <= 16,
        onSceneChanged: this.bumpSceneVersion,
        textureDensity: this.textureDensityFor(dx, dz),
        segments: this.segmentsFor(dx, dz)
      });

      this.chunks.set(item.key, chunk);
      this.scene.add(chunk.group);
      chunksBuilt++;

      if (chunksBuilt >= maxChunksPerFrame || (performance.now() - startTime >= MAX_TIME_MS)) {
        break;
      }
    }
  }

  public clearAll(): void {
    for (const chunk of this.chunks.values()) {
      this.scene.remove(chunk.group);
      chunk.destroy();
    }
    for (const tile of this.tiles.values()) {
      this.scene.remove(tile.group);
      tile.destroy();
    }
    this.chunks.clear();
    this.tiles.clear();
    this.buildQueue = [];
    this.queuedKeys.clear();
    this.currentCenterCx = 999999;
    this.currentCenterCz = 999999;
  }

  public setForge(forge: TerrainTextureForge): void {
    this.forge = forge;
  }

  public updatePixelScale(scale: number): void {
    for (const chunk of this.chunks.values()) chunk.updatePixelScale(scale);
    for (const tile of this.tiles.values()) tile.updatePixelScale(scale);
  }

  public getLoadedChunkCount(): number {
    return this.chunks.size;
  }

  public getQueueLength(): number {
    return this.buildQueue.length;
  }

  /**
   * LOD de textura por anel (distância em chunks): densidade total nos 3x3 chunks em volta da
   * câmera, metade até o anel 3, um quarto até o anel 7 (piso 3 tx/m) e um oitavo além (piso
   * 1.5 tx/m). O custo de gerar uma textura cresce com o quadrado da densidade, e chunks
   * distantes só aparecem com a câmera bem afastada, quando cada chunk ocupa poucos pixels.
   */
  private textureDensityFor(dx: number, dz: number): number {
    const base = this.forge.density;
    const ring = Math.max(Math.abs(dx), Math.abs(dz));
    const factor = ring <= 1 ? 1.0 : ring <= 3 ? 0.5 : ring <= NEAR_RING ? 0.25 : 0.125;
    const floor = ring <= NEAR_RING ? 3.0 : 1.5;
    return Math.max(Math.min(base, floor), base * factor);
  }

  /** LOD da malha de relevo por anel: 32 subdivisões (2m) perto, 16 até o anel 7 e 8 além. */
  private segmentsFor(dx: number, dz: number): number {
    const full = CONFIG.CHUNK_SEGMENTS;
    const ring = Math.max(Math.abs(dx), Math.abs(dz));
    return ring <= 3 ? full : ring <= NEAR_RING ? Math.max(8, full / 2) : Math.max(8, full / 4);
  }

  public getSceneVersion(): number {
    return this.sceneVersion;
  }
}
