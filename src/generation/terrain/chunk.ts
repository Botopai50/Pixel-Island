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
// Identifica as instâncias de vegetação de cada chunk no pool compartilhado (único por instância,
// não por coordenada: um chunk descarregado e recriado ganha um id novo)
let nextVegetationOwner = 1;

export class Chunk {
  public readonly cx: number;
  public readonly cz: number;
  public readonly group: THREE.Group;
  public isSubmerged: boolean = false;
  public hasVegetation: boolean = false;
  private terrainMesh?: THREE.Mesh;
  private readonly vegetationOwner = nextVegetationOwner++;
  private vegetationMgr?: VegetationManager;
  private isDestroyed: boolean = false;

  private forge: TerrainTextureForge;
  private chunkMaterial?: THREE.MeshToonMaterial;
  private topTex?: THREE.DataTexture;
  private topDarkTex?: THREE.DataTexture;
  private bioTex?: THREE.DataTexture;
  private cancelRequest?: () => void;
  private onSceneChanged?: () => void;
  private terrainGeo?: THREE.BufferGeometry;
  // LOD por distância: densidade de texels (tx/m) e subdivisões da malha aplicadas e desejadas.
  // A primeira textura pode vir numa prévia mais barata e depois subir até targetDensity.
  private appliedDensity = 0;
  private appliedSegments = 0;
  private targetDensity = 0;
  private targetSegments = 0;

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
    textureDensity?: number,
    segments?: number
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

    // Malha e textura são geradas juntas num worker; a malha aparece quando as duas chegam.
    this.targetDensity = textureDensity ?? this.forge.density;
    this.targetSegments = segments ?? CONFIG.CHUNK_SEGMENTS;
    this.refine();

    // Popula árvores, arbustos e rochas apenas se permitido pelo LOD de distância
    if (enableVegetation) {
      this.populateVegetation(vegetationMgr, terrainGen, enableDetailFlora);
    }
  }

  public populateVegetation(vegetationMgr: VegetationManager, terrainGen: TerrainGenerator, enableDetailFlora: boolean = true): void {
    if (this.hasVegetation || this.isSubmerged || this.isDestroyed) return;
    this.hasVegetation = true;
    this.vegetationMgr = vegetationMgr;
    vegetationMgr.populateChunk(this.cx, this.cz, CONFIG.CHUNK_SIZE, terrainGen, this.vegetationOwner, enableDetailFlora);
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

  /** Sobe o LOD desejado (densidade de texels e subdivisões da malha); nunca desce. */
  public setLOD(density: number, segments: number): void {
    if (this.isSubmerged || this.isDestroyed) return;
    this.targetDensity = Math.max(this.targetDensity, density);
    this.targetSegments = Math.max(this.targetSegments, segments);
    this.refine();
  }

  /**
   * Pede ao worker o que falta para chegar no LOD desejado: textura (se a densidade subiu) e/ou
   * malha (se as subdivisões subiram). Um pedido por vez; quando ele chega, o próximo passo é
   * pedido. A primeira resposta cria a malha; as seguintes trocam textura/geometria sem piscar.
   */
  private refine(): void {
    if (this.isSubmerged || this.isDestroyed || this.cancelRequest) return;

    let density = this.targetDensity > this.appliedDensity ? this.targetDensity : 0;
    // Primeira textura: prévia barata (no máx. 6 tx/m) para o mundo aparecer rápido
    if (density > 0 && !this.terrainMesh && density > PREVIEW_DENSITY) {
      density = Math.max(PREVIEW_DENSITY, density / 4);
    }
    const segments = this.targetSegments > this.appliedSegments ? this.targetSegments : 0;
    if (density === 0 && segments === 0) return;

    const size = CONFIG.CHUNK_SIZE;
    const originX = this.cx * size - size / 2;
    const originZ = this.cz * size - size / 2;
    // Primeiro pedido (chunk ainda invisível) tem prioridade sobre upgrades de LOD
    const priority = this.terrainMesh ? 1 : 0;
    const { promise, cancel } = this.forge.generateChunkAsync(originX, originZ, size, density, priority, segments);
    this.cancelRequest = cancel;

    promise.then(({ textures, geometry }) => {
      if (this.isDestroyed) {
        textures?.topTex.dispose();
        textures?.topDarkTex.dispose();
        textures?.bioTex.dispose();
        return;
      }
      this.cancelRequest = undefined;

      if (geometry) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(geometry.normals, 3));
        geo.setIndex(new THREE.BufferAttribute(geometry.index, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const oldGeo = this.terrainGeo;
        this.terrainGeo = geo;
        this.appliedSegments = geometry.segments;
        if (this.terrainMesh) this.terrainMesh.geometry = geo;
        oldGeo?.dispose();
      }

      if (textures) {
        const oldMaterial = this.chunkMaterial;
        const oldTextures = [this.topTex, this.topDarkTex, this.bioTex];
        this.topTex = textures.topTex;
        this.topDarkTex = textures.topDarkTex;
        this.bioTex = textures.bioTex;
        this.chunkMaterial = createChunkTerrainMaterial(
          this.forge, this.topTex, this.topDarkTex, this.bioTex, originX, originZ, size, density
        );
        this.appliedDensity = density;
        if (this.terrainMesh) this.terrainMesh.material = this.chunkMaterial;
        oldMaterial?.dispose();
        for (const t of oldTextures) t?.dispose();
      }

      if (!this.terrainMesh && this.terrainGeo && this.chunkMaterial) {
        this.terrainMesh = new THREE.Mesh(this.terrainGeo, this.chunkMaterial);
        this.terrainMesh.position.set(this.cx * size, 0, this.cz * size);
        this.terrainMesh.castShadow = true;
        this.terrainMesh.receiveShadow = true;
        this.group.add(this.terrainMesh);
        this.onSceneChanged?.();
      } else if (geometry) {
        this.onSceneChanged?.();
      }

      this.refine();
    }).catch((err) => {
      this.cancelRequest = undefined;
      if (!this.isDestroyed && err?.message !== 'cancelled') {
        console.error(`Falha ao gerar o chunk ${this.cx}_${this.cz}:`, err);
      }
    });
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
    if (this.cancelRequest) {
      this.cancelRequest();
      this.cancelRequest = undefined;
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

    // Libera as instâncias de vegetação deste chunk no pool compartilhado
    this.vegetationMgr?.releaseChunk(this.vegetationOwner);

    this.group.clear();
  }
}
