import * as THREE from 'three';
import { TerrainGenerator } from './terrainGenerator.ts';
import { VegetationManager } from '../vegetation/vegetationManager.ts';
import { CONFIG } from '../../config.ts';
import { TerrainTextureForge } from './terrainTextureForge.ts';
import { createChunkTerrainMaterial } from '../shaders/terrainShader.ts';

export type ChunkLOD = 'HIGH' | 'MED' | 'LOW';

// Fundo do mar das áreas totalmente submersas: só precisa existir no depth buffer para a água
// calcular a profundidade (e escurecer gradualmente). Material único e barato, compartilhado.
const SEABED_SPACING = 8; // metros entre vértices
// Densidade máxima da prévia de textura (tx/m) enquanto a textura final é gerada
const PREVIEW_DENSITY = 6;
const seabedMaterial = new THREE.MeshLambertMaterial({ color: 0x3d5c58 });
// Identifica as instâncias de vegetação de cada chunk no pool compartilhado (único por instância,
// não por coordenada: um chunk descarregado e recriado ganha um id novo)
let nextVegetationOwner = 1;

export interface ChunkOptions {
  enableVegetation?: boolean;
  enableDetailFlora?: boolean;
  onSceneChanged?: () => void;
  textureDensity?: number;
  segments?: number;
  /**
   * Área coberta, quando não é o chunk padrão (cx, cz): usado pelos blocos distantes que juntam
   * vários chunks numa malha e numa textura só.
   */
  area?: { centerX: number; centerZ: number; size: number };
}

/**
 * Pedaço quadrado de relevo: malha e textura geradas num worker, vegetação opcional.
 * Normalmente é um chunk de CONFIG.CHUNK_SIZE centrado em (cx, cz) * CHUNK_SIZE; com `area`
 * vira um bloco maior de LOD distante.
 */
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

  private readonly centerX: number;
  private readonly centerZ: number;
  private readonly size: number;

  private forge: TerrainTextureForge;
  private chunkMaterial?: THREE.MeshToonMaterial;
  private topTex?: THREE.DataTexture;
  private topDarkTex?: THREE.DataTexture;
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
    forge: TerrainTextureForge,
    options: ChunkOptions = {}
  ) {
    this.cx = cx;
    this.cz = cz;
    this.onSceneChanged = options.onSceneChanged;
    this.group = new THREE.Group();
    this.group.name = options.area ? `farTile_${cx}_${cz}` : `chunk_${cx}_${cz}`;
    this.forge = forge;

    this.size = options.area?.size ?? CONFIG.CHUNK_SIZE;
    this.centerX = options.area?.centerX ?? cx * CONFIG.CHUNK_SIZE;
    this.centerZ = options.area?.centerZ ?? cz * CONFIG.CHUNK_SIZE;

    if (this.isAllUnderwater(terrainGen)) {
      // Só geometria (sem textura), com o material barato de fundo do mar
      this.isSubmerged = true;
      this.targetSegments = Math.max(8, Math.round(this.size / SEABED_SPACING));
      this.refine();
      return;
    }

    // Malha e textura são geradas juntas num worker; a malha aparece quando as duas chegam.
    this.targetDensity = options.textureDensity ?? this.forge.density;
    this.targetSegments = options.segments ?? CONFIG.CHUNK_SEGMENTS;
    this.refine();

    // Popula árvores, arbustos e rochas apenas se permitido pelo LOD de distância
    if (options.enableVegetation) {
      this.populateVegetation(vegetationMgr, terrainGen, options.enableDetailFlora ?? true);
    }
  }

  /** Teste rápido numa grade com no máx. 32m entre pontos: tudo abaixo de -2.5m? */
  private isAllUnderwater(terrainGen: TerrainGenerator): boolean {
    const n = Math.max(2, Math.ceil(this.size / 32));
    const x0 = this.centerX - this.size / 2;
    const z0 = this.centerZ - this.size / 2;
    const step = this.size / n;
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        if (terrainGen.getHeight(x0 + ix * step, z0 + iz * step) >= -2.5) return false;
      }
    }
    return true;
  }

  public populateVegetation(vegetationMgr: VegetationManager, terrainGen: TerrainGenerator, enableDetailFlora: boolean = true): void {
    if (this.hasVegetation || this.isSubmerged || this.isDestroyed) return;
    this.hasVegetation = true;
    this.vegetationMgr = vegetationMgr;
    vegetationMgr.populateChunk(this.cx, this.cz, CONFIG.CHUNK_SIZE, terrainGen, this.vegetationOwner, enableDetailFlora);
    this.onSceneChanged?.();
  }

  /** A malha já está na cena (primeira resposta do worker chegou). */
  public isReady(): boolean {
    return !!this.terrainMesh;
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
    if (this.isDestroyed || this.cancelRequest) return;

    let density = this.targetDensity > this.appliedDensity ? this.targetDensity : 0;
    // Primeira textura: prévia barata (no máx. 6 tx/m) para o mundo aparecer rápido
    if (density > 0 && !this.terrainMesh && density > PREVIEW_DENSITY) {
      density = Math.max(PREVIEW_DENSITY, density / 4);
    }
    const segments = this.targetSegments > this.appliedSegments ? this.targetSegments : 0;
    if (density === 0 && segments === 0) return;

    const size = this.size;
    const originX = this.centerX - size / 2;
    const originZ = this.centerZ - size / 2;
    // Primeiro pedido (ainda invisível) tem prioridade sobre upgrades de LOD
    const priority = this.terrainMesh ? 1 : 0;
    const { promise, cancel } = this.forge.generateChunkAsync(originX, originZ, size, density, priority, segments);
    this.cancelRequest = cancel;

    promise.then(({ textures, geometry }) => {
      if (this.isDestroyed) {
        textures?.topTex.dispose();
        textures?.topDarkTex.dispose();
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
        const oldTextures = [this.topTex, this.topDarkTex];
        this.topTex = textures.topTex;
        this.topDarkTex = textures.topDarkTex;
        this.chunkMaterial = createChunkTerrainMaterial(
          this.forge, this.topTex, this.topDarkTex, originX, originZ, size, density
        );
        this.appliedDensity = density;
        if (this.terrainMesh) this.terrainMesh.material = this.chunkMaterial;
        oldMaterial?.dispose();
        for (const t of oldTextures) t?.dispose();
      }

      const material = this.isSubmerged ? seabedMaterial : this.chunkMaterial;
      if (!this.terrainMesh && this.terrainGeo && material) {
        this.terrainMesh = new THREE.Mesh(this.terrainGeo, material);
        this.terrainMesh.position.set(this.centerX, 0, this.centerZ);
        this.terrainMesh.castShadow = !this.isSubmerged;
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
        console.error(`Falha ao gerar ${this.group.name}:`, err);
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

    // Cancela a requisição no worker pool se ainda não tiver chegado
    if (this.cancelRequest) {
      this.cancelRequest();
      this.cancelRequest = undefined;
    }

    // Geometria, material e texturas locais (o material de fundo do mar é compartilhado)
    this.terrainGeo?.dispose();
    this.chunkMaterial?.dispose();
    this.topTex?.dispose();
    this.topDarkTex?.dispose();

    // Libera as instâncias de vegetação deste chunk no pool compartilhado
    this.vegetationMgr?.releaseChunk(this.vegetationOwner);

    this.group.clear();
  }
}
