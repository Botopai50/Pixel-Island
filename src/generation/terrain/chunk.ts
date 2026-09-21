import * as THREE from 'three';
import { TerrainGenerator } from './terrainGenerator.ts';
import { VegetationManager } from '../vegetation/vegetationManager.ts';
import { CONFIG } from '../../config.ts';
import { TerrainTextureForge } from './terrainTextureForge.ts';
import { createChunkTerrainMaterial } from '../shaders/terrainShader.ts';

export type ChunkLOD = 'HIGH' | 'MED' | 'LOW';

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

  constructor(
    cx: number,
    cz: number,
    terrainGen: TerrainGenerator,
    vegetationMgr: VegetationManager,
    _terrainMaterial: THREE.Material,
    _waterMaterial: THREE.Material,
    enableVegetation: boolean = true,
    forge?: TerrainTextureForge
  ) {
    this.cx = cx;
    this.cz = cz;
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
      return;
    }

    // Constrói o relevo procedural do chunk com o sistema de texturas procedurais
    this.buildTerrain(terrainGen);

    this.group.add(this.vegetationGroup);

    // Popula árvores, arbustos e rochas apenas se permitido pelo LOD de distância
    if (enableVegetation) {
      this.populateVegetation(vegetationMgr, terrainGen);
    }
  }

  public populateVegetation(vegetationMgr: VegetationManager, terrainGen: TerrainGenerator): void {
    if (this.hasVegetation || this.isSubmerged || this.isDestroyed) return;
    this.hasVegetation = true;
    vegetationMgr.populateChunk(this.cx, this.cz, CONFIG.CHUNK_SIZE, terrainGen, this.vegetationGroup);
  }

  private buildTerrain(terrainGen: TerrainGenerator): void {
    const size = CONFIG.CHUNK_SIZE;
    const half = size / 2;
    const startX = this.cx * size;
    const startZ = this.cz * size;
    const originX = startX - half;
    const originZ = startZ - half;

    const segments = CONFIG.CHUNK_SEGMENTS;

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position;
    const normalAttr = geo.attributes.normal;
    const count = posAttr.count;

    const gridDim = segments + 1;
    const heightMap = new Float32Array(count);
    const climateMap = new Float32Array(count * 2);
    const extraMap = new Float32Array(count * 4);
    const deltaX = size / segments;
    const deltaZ = size / segments;

    // Passo 1: Calcula as alturas dos vértices, clima e relevos especiais
    for (let i = 0; i < count; i++) {
      const localX = posAttr.getX(i);
      const localZ = posAttr.getZ(i);
      const worldX = startX + localX;
      const worldZ = startZ + localZ;

      const vData = terrainGen.getVertexData(worldX, worldZ);
      posAttr.setY(i, vData.height);
      heightMap[i] = vData.height;

      climateMap[i * 2] = vData.temperature;
      climateMap[i * 2 + 1] = vData.moisture;

      extraMap[i * 4] = vData.extra[0];
      extraMap[i * 4 + 1] = vData.extra[1];
      extraMap[i * 4 + 2] = vData.extra[2];
      extraMap[i * 4 + 3] = vData.extra[3];
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
    geo.setAttribute('aClimate', new THREE.BufferAttribute(climateMap, 2));
    geo.setAttribute('aExtra', new THREE.BufferAttribute(extraMap, 4));

    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    // Geração procedural das texturas do chunk via Pixel Terrain Forge
    const textures = this.forge.generateChunkTextures(originX, originZ, size, terrainGen);
    this.topTex = textures.topTex;
    this.topDarkTex = textures.topDarkTex;
    this.bioTex = textures.bioTex;

    this.chunkMaterial = createChunkTerrainMaterial(
      this.forge,
      this.topTex,
      this.topDarkTex,
      this.bioTex,
      originX,
      originZ,
      size
    );

    this.terrainMesh = new THREE.Mesh(geo, this.chunkMaterial);
    this.terrainMesh.position.set(startX, 0, startZ);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.group.add(this.terrainMesh);
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Descarta estritamente a geometria única de terreno alocada para este chunk
    if (this.terrainMesh && this.terrainMesh.geometry) {
      this.terrainMesh.geometry.dispose();
    }

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
