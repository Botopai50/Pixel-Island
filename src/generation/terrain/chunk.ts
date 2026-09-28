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
// Chunks com textura final acima de PREVIEW_ABOVE (tx/m) apareciam primeiro numa prévia barata de
// PREVIEW_DENSITY enquanto a final era gerada. Desligado: o custo de uma textura é quase todo fixo
// (grade de campos, bioma, tufos), e a prévia em 3 tx/m custava ~420ms contra ~450ms da final -
// só dobrava o trabalho dos chunks de perto.
const PREVIEW_ABOVE = Infinity;
const PREVIEW_DENSITY = 3;
const seabedMaterial = new THREE.MeshLambertMaterial({ color: 0x3d5c58 });

/**
 * Dissolve das trocas de LOD (ms). Trocar de uma vez a textura/malha de um chunk por outra de
 * resolução diferente, ou um bloco distante pelos chunks (e vice-versa), aparecia como o terreno
 * piscando com a câmera andando. Agora a versão velha some e a nova aparece nos mesmos blocos de
 * 2m (ver terrainShader), nunca as duas no mesmo pixel.
 */
const REVEAL_MS = 600;
type RevealUniforms = { uReveal: { value: number }; uRevealInv: { value: number } };
const fades: { u: RevealUniforms; t0: number; done?: () => void }[] = [];

function startFade(material: THREE.Material | undefined, out: boolean, done?: () => void): void {
  const u = material?.userData?.uniforms as RevealUniforms | undefined;
  if (!u?.uReveal) { done?.(); return; }
  u.uRevealInv.value = out ? 1 : 0;
  u.uReveal.value = 0;
  fades.push({ u, t0: performance.now(), done });
}

/** Avança os dissolves (chamado a cada quadro pelo ChunkManager). */
export function tickChunkFades(now: number = performance.now()): void {
  for (let i = fades.length - 1; i >= 0; i--) {
    const f = fades[i];
    const k = Math.min(1, (now - f.t0) / REVEAL_MS);
    f.u.uReveal.value = k;
    if (k >= 1) {
      fades.splice(i, 1);
      f.done?.();
    }
  }
}
// Identifica as instâncias de vegetação de cada chunk no pool compartilhado (único por instância,
// não por coordenada: um chunk descarregado e recriado ganha um id novo)
let nextVegetationOwner = 1;

export interface ChunkOptions {
  enableVegetation?: boolean;
  enableDetailFlora?: boolean;
  onSceneChanged?: () => void;
  textureDensity?: number;
  segments?: number;
  /** Distância (em chunks) até a câmera: ordena os pedidos aos workers (perto primeiro) */
  distance?: number;
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
  private readonly grassOwner = nextVegetationOwner++;
  private grassData?: Float32Array;
  private grassWanted = false;
  private grassPlanted = false;
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
  /** a malha aplicada tem a medição dos paredões (só é feita nos chunks perto da câmera) */
  private appliedWalls = false;
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
    this.distance = options.distance ?? 0;
    this.targetDensity = options.textureDensity ?? this.forge.density;
    this.targetSegments = options.segments ?? CONFIG.CHUNK_SEGMENTS;
    this.refine();

    // Popula árvores, arbustos e rochas apenas se permitido pelo LOD de distância
    if (options.enableVegetation) {
      this.populateVegetation(vegetationMgr, terrainGen, options.enableDetailFlora ?? true);
    }
  }

  /** Teste rápido numa grade com no máx. 32m entre pontos: tudo abaixo de -8m? (mais fundo que
   *  as represas, que chegam a 6m - senão um chunk no meio de uma virava "fundo do mar" chapado) */
  private isAllUnderwater(terrainGen: TerrainGenerator): boolean {
    const n = Math.max(2, Math.ceil(this.size / 32));
    const x0 = this.centerX - this.size / 2;
    const z0 = this.centerZ - this.size / 2;
    const step = this.size / n;
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        // altura seca basta (rios/lagos não passam de -8m e o mar só abaixa o relevo) e não
        // depende da hidrologia, que na thread principal chega depois, dos workers
        if (terrainGen.getDryHeight(x0 + ix * step, z0 + iz * step) >= -8.0) return false;
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

  /** Tira as árvores/pedras/arbustos (o chunk saiu do raio de vegetação: o horizonte põe as simples). */
  public releaseVegetation(): void {
    if (!this.hasVegetation) return;
    this.hasVegetation = false;
    this.vegetationMgr?.releaseChunk(this.vegetationOwner);
    this.onSceneChanged?.();
  }

  /** Escondido enquanto um bloco distante ainda cobre a área (a troca é feita de uma vez, com dissolve). */
  private heldBack = false;

  public setHeldBack(on: boolean): void {
    if (on === this.heldBack) return;
    this.heldBack = on;
    this.group.visible = !on;
    if (!on && this.terrainMesh && !this.isSubmerged) startFade(this.chunkMaterial, false);
  }

  public isHeldBack(): boolean {
    return this.heldBack;
  }

  /** Some com dissolve (substituído por outro LOD) e depois é destruído. */
  public fadeOutAndDestroy(scene: THREE.Object3D): void {
    const finish = () => { scene.remove(this.group); this.destroy(); };
    if (!this.terrainMesh || this.isSubmerged || !this.group.visible || this.isDestroyed) { finish(); return; }
    // a vegetação sai já (a do LOD novo, se houver, já está no lugar)
    this.vegetationMgr?.releaseChunk(this.vegetationOwner);
    this.vegetationMgr?.releaseChunk(this.grassOwner);
    startFade(this.chunkMaterial, true, finish);
  }

  /** A malha já está na cena (primeira resposta do worker chegou). */
  public isReady(): boolean {
    return !!this.terrainMesh;
  }

  /** Distância (em chunks) até a câmera, para a ordem dos pedidos */
  public distance = 0;

  /** Sobe o LOD desejado (densidade de texels e subdivisões da malha); nunca desce. */
  public setLOD(density: number, segments: number, distance?: number): void {
    if (this.isSubmerged || this.isDestroyed) return;
    if (distance !== undefined) this.distance = distance;
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
    if (density > 0 && !this.terrainMesh && density > PREVIEW_ABOVE) {
      density = PREVIEW_DENSITY;
    }
    // medição dos paredões (grama que escorre, terra no pé, rocha na metade de baixo) só até 2
    // chunks da câmera: é o que mais custa na malha e mais longe o detalhe não aparece. Um chunk
    // que se aproxima refaz a malha com ela.
    const wantWalls = this.distance <= 2.5;
    const segments = this.targetSegments > this.appliedSegments || (wantWalls && !this.appliedWalls && this.appliedSegments > 0)
      ? this.targetSegments : 0;
    if (density === 0 && segments === 0) return;

    const size = this.size;
    const originX = this.centerX - size / 2;
    const originZ = this.centerZ - size / 2;
    // Primeiro pedido (ainda invisível) antes de qualquer upgrade de LOD; entre eles, o mais perto
    // da câmera primeiro (os blocos distantes pediam a textura ao serem criados e passavam na
    // frente dos chunks ao lado da câmera)
    const priority = (this.terrainMesh ? 1000 : 0) + this.distance;
    const { promise, cancel } = this.forge.generateChunkAsync(originX, originZ, size, density, priority, segments, wantWalls);
    this.cancelRequest = cancel;

    promise.then(({ textures, geometry, grass }) => {
      if (this.isDestroyed) {
        textures?.topTex.dispose();
        textures?.topDarkTex.dispose();
        return;
      }
      this.cancelRequest = undefined;
      if (grass && !this.grassData) {
        this.grassData = grass;
        this.syncGrass();
      }

      // Troca num chunk já visível: a versão velha vira um "fantasma" que some com dissolve
      // enquanto a nova aparece (material novo sempre, para os dois terem o dissolve separado)
      const swapVisible = !!this.terrainMesh && !this.isSubmerged && this.group.visible && !!this.chunkMaterial && !!(geometry || textures);
      const ghostGeo = this.terrainGeo;
      const ghostMat = this.chunkMaterial;
      const ghostTex = [this.topTex, this.topDarkTex];

      if (geometry) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(geometry.normals, 3));
        if (geometry.wall) geo.setAttribute('wallInfo', new THREE.BufferAttribute(geometry.wall, 3));
        geo.setAttribute('morph', new THREE.BufferAttribute(geometry.morph, 1));
        geo.setIndex(new THREE.BufferAttribute(geometry.index, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const oldGeo = this.terrainGeo;
        this.terrainGeo = geo;
        this.appliedSegments = geometry.segments;
        this.appliedWalls = wantWalls;
        if (this.terrainMesh) this.terrainMesh.geometry = geo;
        if (!swapVisible) oldGeo?.dispose();
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
        if (!swapVisible) {
          oldMaterial?.dispose();
          for (const t of oldTextures) t?.dispose();
        }
      } else if (swapVisible && this.topTex && this.topDarkTex) {
        // só a malha mudou: material novo com as mesmas texturas
        this.chunkMaterial = createChunkTerrainMaterial(
          this.forge, this.topTex, this.topDarkTex, originX, originZ, size, this.appliedDensity
        );
        this.terrainMesh!.material = this.chunkMaterial;
      }

      if (swapVisible && ghostGeo && ghostMat) {
        const ghost = new THREE.Mesh(ghostGeo, ghostMat);
        ghost.position.copy(this.terrainMesh!.position);
        ghost.receiveShadow = true;
        this.group.add(ghost);
        startFade(this.chunkMaterial, false);
        startFade(ghostMat, true, () => {
          this.group.remove(ghost);
          if (geometry) ghostGeo.dispose();
          ghostMat.dispose();
          if (textures) for (const t of ghostTex) t?.dispose();
        });
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

  /** Liga/desliga a grama 3D deste chunk (só perto da câmera). */
  public setGrassEnabled(on: boolean, vegetationMgr: VegetationManager): void {
    this.grassWanted = on;
    this.vegetationMgr = this.vegetationMgr ?? vegetationMgr;
    this.syncGrass();
  }

  private syncGrass(): void {
    if (this.isDestroyed || !this.vegetationMgr) return;
    if (this.grassWanted && !this.grassPlanted && this.grassData) {
      this.vegetationMgr.populateGrass(this.grassOwner, this.grassData);
      this.grassPlanted = true;
    } else if (!this.grassWanted && this.grassPlanted) {
      this.vegetationMgr.releaseChunk(this.grassOwner);
      this.grassPlanted = false;
    }
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
    this.vegetationMgr?.releaseChunk(this.grassOwner);

    this.group.clear();
  }
}
