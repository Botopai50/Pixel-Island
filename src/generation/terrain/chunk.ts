import * as THREE from 'three';
import { TerrainGenerator } from './terrainGenerator.ts';
import { VegetationManager } from '../vegetation/vegetationManager.ts';
import { CONFIG } from '../../config.ts';
import { TerrainTextureForge } from './terrainTextureForge.ts';
import { createChunkTerrainMaterial } from '../shaders/terrainShader.ts';

export type ChunkLOD = 'HIGH' | 'MED' | 'LOW';

// Fundo do mar dos chunks totalmente submersos: só precisa existir no depth buffer para a água
// calcular a profundidade (e escurecer gradualmente). Material único e barato, compartilhado.
const SEABED_SEGMENTS = 8;
// Densidade máxima da prévia de textura (tx/m) enquanto a textura final é gerada
const PREVIEW_DENSITY = 6;
const seabedMaterial = new THREE.MeshLambertMaterial({ color: 0x3d5c58 });

export class Chunk {
  public readonly cx: number;
  public readonly cz: number;
  public readonly group: THREE.Group;
  public isSubmerged: boolean = false;
  public hasVegetation: boolean = false;
  private terrainMesh?: THREE.Mesh;
  private vegetationGroup: THREE.Group = new THREE.Group();
  private isDestroyed: boolean = false;

  private forge: TerrainTextureForge;
  private chunkMaterial?: THREE.MeshToonMaterial;
  private topTex?: THREE.DataTexture;
  private topDarkTex?: THREE.DataTexture;
  private bioTex?: THREE.DataTexture;
  private cancelTextureRequest?: () => void;
  private onSceneChanged?: () => void;
  private terrainGeo?: THREE.BufferGeometry;
  // Densidade de texels (tx/m) pedida por último e a densidade final desejada (LOD por distância).
  // A primeira textura pode vir numa prévia mais barata e depois subir até targetDensity.
  private requestedDensity = 0;
  private targetDensity = 0;
  private textureRequestId = 0;

  constructor(
    cx: number,
    cz: number,
    terrainGen: TerrainGenerator,
    vegetationMgr: VegetationManager,
    _terrainMaterial: THREE.Material,
    _waterMaterial: THREE.Material,
    enableVegetation: boolean = true,
    forge?: TerrainTextureForge,
    enableDetailFlora: boolean = true,
    onSceneChanged?: () => void,
    textureDensity?: number
  ) {
    this.cx = cx;
    this.cz = cz;
    this.onSceneChanged = onSceneChanged;
    this.group = new THREE.Group();
    this.group.name = `chunk_${cx}_${cz}`;

    this.forge = forge || TerrainTextureForge.getInstance(terrainGen.getSeed());

    const size = CONFIG.CHUNK_SIZE;
    const half = size / 2;
    const startX = this.cx * size;
    const startZ = this.cz * size;

    // Teste ultrarrápido: se o chunk inteiro estiver em oceano sob a água (centro e 4 cantos < -2.5m)
    const hCenter = terrainGen.getHeight(startX, startZ);
    const hC1 = terrainGen.getHeight(startX - half, startZ - half);
    const hC2 = terrainGen.getHeight(startX + half, startZ - half);
    const hC3 = terrainGen.getHeight(startX - half, startZ + half);
    const hC4 = terrainGen.getHeight(startX + half, startZ + half);

    if (hCenter < -2.5 && hC1 < -2.5 && hC2 < -2.5 && hC3 < -2.5 && hC4 < -2.5) {
      this.isSubmerged = true;
      this.buildSeabed(terrainGen);
      return;
    }

    // Constrói o relevo procedural do chunk com o sistema de texturas procedurais
    this.buildTerrain(terrainGen);
    // Prévia barata primeiro (no máx. 6 tx/m) para o mundo aparecer rápido; o upgrade para a
    // densidade desejada é pedido automaticamente quando a prévia chega.
    const wanted = textureDensity ?? this.forge.density;
    this.targetDensity = wanted;
    this.requestTextures(wanted > PREVIEW_DENSITY ? Math.max(PREVIEW_DENSITY, wanted / 4) : wanted);

    this.group.add(this.vegetationGroup);

    // Popula árvores, arbustos e rochas apenas se permitido pelo LOD de distância
    if (enableVegetation) {
      this.populateVegetation(vegetationMgr, terrainGen, enableDetailFlora);
    }
  }

  public populateVegetation(vegetationMgr: VegetationManager, terrainGen: TerrainGenerator, enableDetailFlora: boolean = true): void {
    if (this.hasVegetation || this.isSubmerged || this.isDestroyed) return;
    this.hasVegetation = true;
    vegetationMgr.populateChunk(this.cx, this.cz, CONFIG.CHUNK_SIZE, terrainGen, this.vegetationGroup, enableDetailFlora);
    this.onSceneChanged?.();
  }

  private buildSeabed(terrainGen: TerrainGenerator): void {
    const size = CONFIG.CHUNK_SIZE;
    const startX = this.cx * size;
    const startZ = this.cz * size;

    const geo = new THREE.PlaneGeometry(size, size, SEABED_SEGMENTS, SEABED_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainGen.getHeight(startX + pos.getX(i), startZ + pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    this.terrainMesh = new THREE.Mesh(geo, seabedMaterial);
    this.terrainMesh.position.set(startX, 0, startZ);
    this.group.add(this.terrainMesh);
    this.onSceneChanged?.();
  }

  private buildTerrain(terrainGen: TerrainGenerator): void {
    const size = CONFIG.CHUNK_SIZE;
    const startX = this.cx * size;
    const startZ = this.cz * size;

    const segments = CONFIG.CHUNK_SEGMENTS;

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position;
    const normalAttr = geo.attributes.normal;
    const count = posAttr.count;

    const gridDim = segments + 1;
    const heightMap = new Float32Array(count);
    const deltaX = size / segments;
    const deltaZ = size / segments;

    // Passo 1: Alturas dos vértices (mesma função em que o jogador anda)
    for (let i = 0; i < count; i++) {
      const h = terrainGen.getHeight(startX + posAttr.getX(i), startZ + posAttr.getZ(i));
      posAttr.setY(i, h);
      heightMap[i] = h;
    }

    // Passo 2: Calcula as normais analíticas
    for (let iy = 0; iy < gridDim; iy++) {
      for (let ix = 0; ix < gridDim; ix++) {
        const i = iy * gridDim + ix;
        const localX = posAttr.getX(i);
        const localZ = posAttr.getZ(i);
        const worldX = startX + localX;
        const worldZ = startZ + localZ;

        // Vizinhança X
        let hL: number;
        let hR: number;
        if (ix > 0 && ix < segments) {
          hL = heightMap[iy * gridDim + (ix - 1)];
          hR = heightMap[iy * gridDim + (ix + 1)];
        } else if (ix === 0) {
          hL = terrainGen.getHeight(worldX - deltaX, worldZ);
          hR = heightMap[iy * gridDim + 1];
        } else {
          hL = heightMap[iy * gridDim + (segments - 1)];
          hR = terrainGen.getHeight(worldX + deltaX, worldZ);
        }

        // Vizinhança Z
        let hD: number;
        let hU: number;
        if (iy > 0 && iy < segments) {
          hD = heightMap[(iy - 1) * gridDim + ix];
          hU = heightMap[(iy + 1) * gridDim + ix];
        } else if (iy === 0) {
          hD = terrainGen.getHeight(worldX, worldZ - deltaZ);
          hU = heightMap[1 * gridDim + ix];
        } else {
          hD = heightMap[(iy - 1) * gridDim + ix];
          hU = terrainGen.getHeight(worldX, worldZ + deltaZ);
        }

        const nx = (hL - hR) / (2 * deltaX);
        const nz = (hD - hU) / (2 * deltaZ);
        const len = Math.sqrt(nx * nx + 1.0 + nz * nz);
        normalAttr.setXYZ(i, nx / len, 1.0 / len, nz / len);
      }
    }

    posAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;

    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this.terrainGeo = geo;
  }

  /** Sobe a densidade desejada (LOD). Se a primeira textura ainda não chegou, o upgrade espera por ela. */
  public setTextureDensity(density: number): void {
    if (this.isSubmerged || this.isDestroyed || !this.terrainGeo) return;
    this.targetDensity = Math.max(this.targetDensity, density);
    if (!this.terrainMesh && this.cancelTextureRequest) return;
    if (this.targetDensity > this.requestedDensity) this.requestTextures(this.targetDensity);
  }

  /**
   * Pede as texturas do chunk numa densidade de texels. A rasterização roda num Web Worker; a
   * malha só aparece quando a primeira textura chega, e trocas de LOD mantêm a textura antiga até
   * a nova ficar pronta (sem piscar). Uma resposta de pedido antigo é descartada.
   */
  private requestTextures(density: number): void {
    if (this.isSubmerged || this.isDestroyed || !this.terrainGeo) return;
    if (density === this.requestedDensity) return;

    this.cancelTextureRequest?.();
    this.requestedDensity = density;
    const requestId = ++this.textureRequestId;

    const size = CONFIG.CHUNK_SIZE;
    const originX = this.cx * size - size / 2;
    const originZ = this.cz * size - size / 2;
    // Primeira textura (chunk ainda invisível) tem prioridade sobre upgrades de LOD
    const priority = this.terrainMesh ? 1 : 0;
    const { promise, cancel } = this.forge.generateChunkTexturesAsync(originX, originZ, size, density, priority);
    this.cancelTextureRequest = cancel;

    promise.then((textures) => {
      if (this.isDestroyed || requestId !== this.textureRequestId) {
        textures.topTex.dispose();
        textures.topDarkTex.dispose();
        textures.bioTex.dispose();
        return;
      }
      this.cancelTextureRequest = undefined;

      const oldMaterial = this.chunkMaterial;
      const oldTextures = [this.topTex, this.topDarkTex, this.bioTex];

      this.topTex = textures.topTex;
      this.topDarkTex = textures.topDarkTex;
      this.bioTex = textures.bioTex;
      this.chunkMaterial = createChunkTerrainMaterial(
        this.forge, this.topTex, this.topDarkTex, this.bioTex, originX, originZ, size, density
      );

      if (this.terrainMesh) {
        this.terrainMesh.material = this.chunkMaterial;
      } else {
        this.terrainMesh = new THREE.Mesh(this.terrainGeo, this.chunkMaterial);
        this.terrainMesh.position.set(this.cx * size, 0, this.cz * size);
        this.terrainMesh.castShadow = true;
        this.terrainMesh.receiveShadow = true;
        this.group.add(this.terrainMesh);
        this.onSceneChanged?.();
      }

      oldMaterial?.dispose();
      for (const t of oldTextures) t?.dispose();

      if (this.targetDensity > density) this.requestTextures(this.targetDensity);
    }).catch((err) => {
      if (requestId === this.textureRequestId) this.cancelTextureRequest = undefined;
      if (!this.isDestroyed && err?.message !== 'cancelled') {
        console.error(`Falha ao gerar texturas do chunk ${this.cx}_${this.cz}:`, err);
      }
    });
  }

  /** Densidade de texels final desejada para este chunk (aplicada ou a caminho). */
  public getTextureDensity(): number {
    return this.targetDensity;
  }

  public updatePixelScale(scale: number): void {
    if (this.chunkMaterial?.userData?.uniforms?.uPixelScale) {
      this.chunkMaterial.userData.uniforms.uPixelScale.value = scale;
    }
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Cancela a requisição de textura no worker pool se o chunk ainda não estiver pronto
    if (this.cancelTextureRequest) {
      this.cancelTextureRequest();
      this.cancelTextureRequest = undefined;
    }

    // Descarta a geometria do chunk (existe mesmo se a malha ainda esperava a primeira textura)
    if (this.terrainMesh && this.terrainMesh.geometry) {
      this.terrainMesh.geometry.dispose();
    }
    this.terrainGeo?.dispose();

    // Descarta material e texturas locais do chunk para liberação total de VRAM
    if (this.chunkMaterial) {
      this.chunkMaterial.dispose();
    }
    if (this.topTex) {
      this.topTex.dispose();
    }
    if (this.topDarkTex) {
      this.topDarkTex.dispose();
    }
    if (this.bioTex) {
      this.bioTex.dispose();
    }

    // Para a vegetação, desvincula as instâncias sem descartar as geometrias compartilhadas
    this.vegetationGroup.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        if (obj.instanceMatrix) obj.instanceMatrix.needsUpdate = false;
      }
    });

    this.group.clear();
  }
}
