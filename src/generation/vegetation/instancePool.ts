import * as THREE from 'three';
import { enableAssetEnvironment } from './pixelTrees/services/assetEnvironment';
import { AERIAL } from '../../atmosphere/atmosphericFog.ts';
import { HF } from '../terrain/terrainHeightField.ts';
import { FADE } from '../shaders/fadeDither.ts';
import { MD, MD_MAX, MD_TEX_W, MD_COL_W } from './multiDraw.ts';
import type { MdMaterials } from './multiDraw.ts';

/** meia largura (m) da zona onde um desenho de detalhe dá lugar ao seguinte */
const LOD_FADE = 12;
/**
 * Quem projeta sombra (tronco, copa-proxy) entra no mapa de sombra em TODAS as direções até esta distância do observador, e não só
 * dentro do campo de visão da câmera. Com o recorte só pelo frustum, girar a câmera mudava quem projetava sombra (árvores atrás ou ao
 * lado deixavam de sombrear a copa à frente) e as copas piscavam entre claro e escuro a cada giro do mouse.
 */
const SHADOW_OMNI = 120;
/** o recorte pela câmera só é refeito depois de andar CULL_MOVE m ou girar ~12 graus; o frustum é alargado em CULL_TURN_PAD (rad) de cada lado para cobrir o giro */
const CULL_MOVE = 8;
const CULL_TURN_PAD = (14 * Math.PI) / 180;
const CULL_TURN_COS = Math.cos((12 * Math.PI) / 180);
/**
 * Câmeras de sombra das 3 faixas do clipmap (da mais próxima à mais distante), preenchidas por ShadowClipmap. Cada faixa só desenha as
 * árvores que ela precisa: antes as três refaziam o mapa com TODAS as árvores que projetam sombra (~11 milhões de triângulos cada), e
 * cada refazer era uma travada de 20 a 30 ms. A 1ª faixa (35 m) só precisa do degrau de detalhe mais perto (até ~94 m), a 2ª (200 m) dos
 * três primeiros e a 3ª (600 m) só dos dois mais longe: o que está perto já é coberto pelas faixas finas.
 */
export const SHADOW_CASCADE_CAMS: THREE.Camera[] = [];
/**
 * Os grupos que projetam sombra e as cópias leves (veja SharedInstances.makeLite). Antes de cada mapa de sombra, ShadowClipmap diz qual
 * faixa será refeita (setShadowCascade) e cada grupo liga ou desliga o seu castShadow e a sua cópia leve para ela. Pular o grupo de verdade
 * é o que importa: um grupo com 0 instâncias ainda passava por setProgram e custava ~15 µs de CPU por faixa, centenas de grupos por mapa.
 */
const SHADOW_POOLS = new Set<{ applyCascade(ci: number): void }>();
/**
 * ci = faixa que será refeita (0..2); -1 = vários mapas no mesmo quadro (todos projetam, sem cópias leves); -2 = o desenho dos mapas terminou.
 * Durante o desenho dos mapas cada grupo desenha TODAS as instâncias que guarda (inclusive as atrás da câmera, que só servem de sombra); fora
 * dele, só as que estão na vista (ver cullInto).
 */
export function setShadowCascade(ci: number): void {
  for (const p of SHADOW_POOLS) p.applyCascade(ci);
}
// quem projeta sombra em cada faixa, por degrau de detalhe (0 a 3). Sem cópia leve: a tabela inteira com o desenho do próprio degrau.
const CASCADE_LODS: boolean[][] = [
  [true, false, false, false],
  [true, true, true, false],
  [false, false, true, true],
];
// com cópia leve: o desenho completo só na faixa 1 (degrau 0) e o degrau 3 (já leve) na faixa 3; a cópia leve nas faixas 2 e 3
const MAIN_WITH_LITE: boolean[][] = [
  [true, false, false, false],
  [false, false, false, false],
  [false, false, false, true],
];
const LITE_CASCADES: boolean[][] = [
  [false, false, false, false],
  [true, true, true, false],
  [false, false, true, false],
];
const lodOfBand = (b: number): number => (b <= 0 ? 0 : b < 100 ? 1 : b < 200 ? 2 : 3);

/**
 * Um InstancedMesh compartilhado por todos os chunks para um par (geometria, material).
 * Cada chunk ocupa algumas posições; ao descarregar, as posições são liberadas trazendo as
 * últimas instâncias para os buracos (a lista mestre fica sempre contígua).
 *
 * Antes cada chunk criava um InstancedMesh por espécie com poucas instâncias cada, o que dava
 * ~1000 draw calls (x3 com as cascatas de sombra) só de vegetação.
 *
 * Recorte pela câmera: a lista MESTRE guarda todas as instâncias carregadas, mas o buffer
 * enviado à GPU recebe só as que estão dentro do frustum da câmera (com uma margem para as
 * sombras de quem está logo fora da tela). Sem isso o raio de vegetação inteiro (centenas de
 * metros em volta) era desenhado a cada quadro, milhões de triângulos fora da tela.
 */
class SharedInstances {
  public mesh: THREE.InstancedMesh;
  private capacity: number;
  private used = 0;
  private slotOwner: number[] = [];
  private ownerSlots = new Map<number, Set<number>>();
  /**
   * Caixa (AABB dos centros) e maior raio das instâncias de cada dono (chunk): o recorte testa o
   * chunk inteiro primeiro e só desce às instâncias dos chunks na borda da tela.
   */
  private ownerBox = new Map<number, Float32Array>();
  /** Lista mestre (todas as instâncias carregadas): matrizes 4x4 e cores RGB */
  private allM: Float32Array;
  private allC: Float32Array;
  /** Raio da esfera envolvente da geometria (escala 1) e centro local */
  private readonly geoRadius: number;
  private readonly geoCenter: THREE.Vector3;
  public dirty = true;
  /** instâncias na vista (as primeiras da lista) e total (as que só servem de sombra vêm depois) */
  private visCount = 0;
  private totalCount = 0;
  private shadowActive = false;
  private readonly extra: number[] = [];
  /** a câmera mudou e este grupo ainda não foi recortado de novo (os grupos são refeitos aos poucos, ver VegetationInstancePool.cull) */
  public stale = true;
  /** faixa de recorte: a lógica ± a margem de transição (12 m) e a folga do recorte (o grupo só é refeito a cada ~4 m andados) */
  private readonly cullBand: [number, number] | null;

  constructor(
    private readonly root: THREE.Group,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    initialCapacity: number,
    private readonly castShadow: boolean = true,
    /** só desenha as instâncias nesta faixa de distância (m, na horizontal) da câmera */
    private readonly band: [number, number] | null = null,
    /** só guarda a lista mestre de instâncias (sem malha própria): usado pelas variações do multi-draw, que desenham todas numa malha só */
    private readonly headless: boolean = false
  ) {
    this.capacity = initialCapacity;
    this.cullBand = band ? [band[0] <= 0 ? band[0] : band[0] - LOD_FADE - 12, band[1] >= 1e8 ? band[1] : band[1] + LOD_FADE + 12] : null;
    this.allM = new Float32Array(initialCapacity * 16);
    this.allC = new Float32Array(initialCapacity * 3);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.geoRadius = geometry.boundingSphere?.radius ?? 1;
    this.geoCenter = geometry.boundingSphere?.center.clone() ?? new THREE.Vector3();
    if (headless) {
      this.mesh = null as unknown as THREE.InstancedMesh;
      this.lodInColor = !!(band && material.userData.pixelTree);
    } else {
      this.mesh = this.createMesh(initialCapacity);
      root.add(this.mesh);
    }
  }

  public get usedCount(): number { return this.used; }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    // O recorte é feito aqui mesmo (cull), instância por instância; o culling por objeto do
    // three.js usaria a esfera da geometria-base e esconderia o grupo inteiro por engano.
    mesh.frustumCulled = false;
    if (this.band && this.castShadow) {
      this.shadowLod = lodOfBand(this.band[0]);
      SHADOW_POOLS.add(this);
      this.makeLite(mesh);
    }
    // árvores do Pixel_Tree: o shader de pixel art ganha sombra, luz e névoa do mundo
    if (this.material.userData.pixelTree) {
      if (this.material.userData.depthMaterial) mesh.customDepthMaterial = this.material.userData.depthMaterial;
      enableAssetEnvironment(mesh);
      Object.assign((this.material as THREE.ShaderMaterial).uniforms, AERIAL, HF);
      // Transição entre os desenhos de detalhe: cada árvore troca numa distância um pouco diferente (dentro de ±12 m da divisa) em
      // vez de todas de uma vez. O material é compartilhado entre os degraus, então a faixa deste desenho é enviada a cada chamada.
      // (a faixa deste degrau vai na cor de cada instância, ver add(): o material é compartilhado entre os degraus)
      if (this.band) this.lodInColor = true;
    }
    return mesh;
  }

  /**
   * Cópia só de sombra: um InstancedMesh com o desenho mais leve do mesmo grupo (o 3º degrau), que divide as MESMAS matrizes do desenho
   * principal e só projeta sombra nas faixas 2 e 3 (200 m e 600 m). Nessas faixas cada texel tem 20 a 30 cm: o galho fino de um carvalho
   * de 15 mil triângulos não aparece, e as três faixas desenhavam ~11 milhões de triângulos cada uma a cada refazer.
   */
  private lite: THREE.InstancedMesh | null = null;
  private lodInColor = false;
  private shadowLod = 0;
  /** liga/desliga o que este grupo projeta para a faixa de sombra ci (ver setShadowCascade) */
  public applyCascade(ci: number): void {
    const lod = this.shadowLod;
    if (ci === -2) {
      // fim dos mapas de sombra: volta a desenhar só o que está na vista
      this.shadowActive = false;
      this.mesh.castShadow = true;
      if (this.lite && this.lite.parent) this.root.remove(this.lite);
      this.mesh.count = this.visCount;
      this.mesh.visible = this.visCount > 0;
      return;
    }
    this.shadowActive = true;
    this.mesh.count = this.totalCount;
    this.mesh.visible = this.totalCount > 0;
    const n = this.totalCount;
    if (ci < 0) {
      this.mesh.castShadow = true;
      if (this.lite && this.lite.parent) this.root.remove(this.lite);
      return;
    }
    const table = this.lite || lod === 3 ? MAIN_WITH_LITE : CASCADE_LODS;
    this.mesh.castShadow = table[ci][lod] && n > 0;
    if (this.lite) {
      const want = LITE_CASCADES[ci][lod] && n > 0;
      if (want && !this.lite.parent) this.root.add(this.lite);
      else if (!want && this.lite.parent) this.root.remove(this.lite);
    }
  }
  private makeLite(mesh: THREE.InstancedMesh): void {
    if (this.lite) { this.root.remove(this.lite); this.lite = null; }
    const lg = this.geometry.userData.shadowLite as THREE.BufferGeometry | undefined;
    if (!lg) return;
    const lite = new THREE.InstancedMesh(lg, this.material, 1);
    lite.instanceMatrix = mesh.instanceMatrix;      // mesmo buffer da GPU do desenho principal
    lite.count = 0;
    lite.frustumCulled = false;
    lite.castShadow = true;
    lite.receiveShadow = false;
    if (this.material.userData.depthMaterial) lite.customDepthMaterial = this.material.userData.depthMaterial;
    this.lite = lite;
  }

  private grow(minCapacity: number): void {
    let capacity = this.capacity;
    while (capacity < minCapacity) capacity *= 2;
    const nm = new Float32Array(capacity * 16); nm.set(this.allM); this.allM = nm;
    const nc = new Float32Array(capacity * 3); nc.set(this.allC); this.allC = nc;
    if (this.headless) { this.capacity = capacity; return; }
    const next = this.createMesh(capacity);
    next.name = this.mesh.name;
    this.root.remove(this.mesh);
    this.mesh.dispose();
    this.root.add(next);
    this.mesh = next;
    this.capacity = capacity;
  }

  public add(owner: number, matrices: THREE.Matrix4[], colors: THREE.Color[]): void {
    if (matrices.length === 0) return;
    if (this.used + matrices.length > this.capacity) this.grow(this.used + matrices.length);

    let slots = this.ownerSlots.get(owner);
    if (!slots) {
      slots = new Set();
      this.ownerSlots.set(owner, slots);
    }
    let box = this.ownerBox.get(owner);
    if (!box) {
      box = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, 0]);
      this.ownerBox.set(owner, box);
    }
    const gcx = this.geoCenter.x, gcy = this.geoCenter.y, gcz = this.geoCenter.z, gr = this.geoRadius;
    for (let i = 0; i < matrices.length; i++) {
      const slot = this.used++;
      matrices[i].toArray(this.allM, slot * 16);
      const M = this.allM, o = slot * 16;
      const cx = M[o] * gcx + M[o + 4] * gcy + M[o + 8] * gcz + M[o + 12];
      const cy = M[o + 1] * gcx + M[o + 5] * gcy + M[o + 9] * gcz + M[o + 13];
      const cz = M[o + 2] * gcx + M[o + 6] * gcy + M[o + 10] * gcz + M[o + 14];
      const sx = M[o] * M[o] + M[o + 1] * M[o + 1] + M[o + 2] * M[o + 2];
      const sy = M[o + 4] * M[o + 4] + M[o + 5] * M[o + 5] + M[o + 6] * M[o + 6];
      const sz = M[o + 8] * M[o + 8] + M[o + 9] * M[o + 9] + M[o + 10] * M[o + 10];
      const r = gr * Math.sqrt(Math.max(sx, sy, sz));
      if (cx < box[0]) box[0] = cx; if (cy < box[1]) box[1] = cy; if (cz < box[2]) box[2] = cz;
      if (cx > box[3]) box[3] = cx; if (cy > box[4]) box[4] = cy; if (cz > box[5]) box[5] = cz;
      if (r > box[6]) box[6] = r;
      const c = colors[i];
      if (this.lodInColor) {
        // a faixa de distância deste degrau de detalhe viaja na cor da instância (r = início, g = fim, b = 2: "tem faixa"), em vez de uniforms
        // trocados a cada desenho: o forçar de uniforms a cada malha custava ~1 ms de CPU por quadro (356 grupos de árvores)
        this.allC[slot * 3] = this.band![0]; this.allC[slot * 3 + 1] = Math.min(this.band![1], 99999); this.allC[slot * 3 + 2] = 2;
      } else {
        this.allC[slot * 3] = c.r; this.allC[slot * 3 + 1] = c.g; this.allC[slot * 3 + 2] = c.b;
      }
      this.slotOwner[slot] = owner;
      slots.add(slot);
    }
    this.dirty = true;
  }

  public remove(owner: number): void {
    const slots = this.ownerSlots.get(owner);
    if (!slots) return;
    this.ownerSlots.delete(owner);
    this.ownerBox.delete(owner);

    const matrixArr = this.allM, colorArr = this.allC;
    // Libera do maior para o menor: a última instância em uso nunca é uma das que estão saindo
    const sorted = Array.from(slots).sort((a, b) => b - a);
    for (const slot of sorted) {
      const last = --this.used;
      if (slot !== last) {
        matrixArr.copyWithin(slot * 16, last * 16, last * 16 + 16);
        colorArr.copyWithin(slot * 3, last * 3, last * 3 + 3);
        const movedOwner = this.slotOwner[last];
        this.slotOwner[slot] = movedOwner;
        const movedSlots = this.ownerSlots.get(movedOwner)!;
        movedSlots.delete(last);
        movedSlots.add(slot);
      }
    }
    this.slotOwner.length = this.used;
    this.dirty = true;
  }

  /**
   * Copia para o buffer da GPU só as instâncias cuja esfera envolvente (aumentada pela margem)
   * toca o frustum. `planes` = [nx, ny, nz, d] x 6 no espaço do mundo.
   */
  public cull(planes: Float32Array, margin: number, camX = 0, camZ = 0): void {
    const k = this.cullInto(this.mesh.instanceMatrix.array as Float32Array, this.mesh.instanceColor!.array as Float32Array, 0, 3, planes, margin, camX, camZ);
    this.finishCull(k);
  }

  /** como cull, mas escreve nos buffers dados (a partir da instância k0; cs = floats por cor) e devolve onde parou: o multi-draw junta as variações num buffer só */
  public cullInto(out: Float32Array, outC: Float32Array, k0: number, cs: number, planes: Float32Array, margin: number, camX: number, camZ: number): number {
    const M = this.allM, C = this.allC;
    const gcx = this.geoCenter.x, gcy = this.geoCenter.y, gcz = this.geoCenter.z, gr = this.geoRadius;
    let k = k0;
    // copia uma instância para o buffer da GPU (sem criar objetos: antes um subarray por instância)
    const emit = (s: number) => {
      const o = s * 16, d = k * 16;
      for (let j = 0; j < 16; j++) out[d + j] = M[o + j];
      outC[k * cs] = C[s * 3]; outC[k * cs + 1] = C[s * 3 + 1]; outC[k * cs + 2] = C[s * 3 + 2];
      k++;
    };
    const omni = this.castShadow ? SHADOW_OMNI : 0;
    const extra = this.extra;
    extra.length = 0;
    for (const [owner, slots] of this.ownerSlots) {
      // o chunk inteiro: todo fora (pula), todo dentro (copia sem testar) ou na borda (testa cada)
      const bx = this.ownerBox.get(owner);
      let mode = 1; // 0 fora, 1 borda, 2 dentro
      if (bx) {
        const hx = (bx[3] - bx[0]) * 0.5, hy = (bx[4] - bx[1]) * 0.5, hz = (bx[5] - bx[2]) * 0.5;
        const cx = bx[0] + hx, cy = bx[1] + hy, cz = bx[2] + hz;
        const R = Math.sqrt(hx * hx + hy * hy + hz * hz) + bx[6] + margin;
        mode = 2;
        for (let p = 0; p < 24; p += 4) {
          const dist = planes[p] * cx + planes[p + 1] * cy + planes[p + 2] * cz + planes[p + 3];
          if (dist < -R) { mode = 0; break; }
          if (dist < R) mode = 1;
        }
      }
      // quem projeta sombra e está perto do observador fica, mesmo fora da vista (ver SHADOW_OMNI)
      if (mode === 0 && omni > 0 && bx) {
        const rr0 = Math.hypot((bx[3] - bx[0]) * 0.5, (bx[5] - bx[2]) * 0.5) + bx[6];
        if (Math.hypot((bx[0] + bx[3]) * 0.5 - camX, (bx[2] + bx[5]) * 0.5 - camZ) - rr0 < omni) mode = 1;
      }
      if (mode === 0) continue;
      // faixa de distância: o chunk todo fora (pula), todo dentro (segue) ou na borda (testa cada)
      let bandMode = 2;
      if (this.band && bx) {
        const dc = Math.hypot((bx[0] + bx[3]) * 0.5 - camX, (bx[2] + bx[5]) * 0.5 - camZ);
        const rr = Math.hypot((bx[3] - bx[0]) * 0.5, (bx[5] - bx[2]) * 0.5) + bx[6];
        if (dc - rr > this.cullBand![1] || dc + rr < this.cullBand![0]) continue;
        if (dc + rr > this.cullBand![1] || dc - rr < this.cullBand![0]) bandMode = 1;
      }
      if (mode === 2 && bandMode === 2) { for (const s of slots) emit(s); continue; }
      for (const s of slots) {
        const o = s * 16;
        if (this.band) {
          const dd = Math.hypot(M[o + 12] - camX, M[o + 14] - camZ);
          if (dd < this.cullBand![0] || dd > this.cullBand![1]) continue;
        }
        // escala = maior comprimento de coluna da matriz
        const sx = M[o] * M[o] + M[o + 1] * M[o + 1] + M[o + 2] * M[o + 2];
        const sy = M[o + 4] * M[o + 4] + M[o + 5] * M[o + 5] + M[o + 6] * M[o + 6];
        const sz = M[o + 8] * M[o + 8] + M[o + 9] * M[o + 9] + M[o + 10] * M[o + 10];
        const sc = Math.sqrt(Math.max(sx, sy, sz));
        // centro da esfera no mundo
        const cx = M[o] * gcx + M[o + 4] * gcy + M[o + 8] * gcz + M[o + 12];
        const cy = M[o + 1] * gcx + M[o + 5] * gcy + M[o + 9] * gcz + M[o + 13];
        const cz = M[o + 2] * gcx + M[o + 6] * gcy + M[o + 10] * gcz + M[o + 14];
        const r = gr * sc + margin;
        let inside = true;
        for (let p = 0; p < 24; p += 4) {
          if (planes[p] * cx + planes[p + 1] * cy + planes[p + 2] * cz + planes[p + 3] < -r) { inside = false; break; }
        }
        // (fora da vista, mas perto: só projeta sombra, então vai depois das instâncias visíveis)
        if (!inside && omni > 0 && Math.hypot(cx - camX, cz - camZ) < omni + r) { extra.push(s); continue; }
        if (inside) emit(s);
      }
    }
    this.visK = k - k0;
    for (let i = 0; i < extra.length; i++) emit(extra[i]);
    return k;
  }
  private visK = 0;

  private finishCull(k: number): void {
    this.totalCount = k;
    this.visCount = this.visK;
    // fora dos mapas de sombra o grupo desenha só as instâncias na vista (as de trás só projetam sombra)
    const n = this.shadowActive ? k : this.visCount;
    this.mesh.count = n;
    // um grupo sem instâncias nenhuma vez passa pelo setProgram do three (~15 µs) para depois não desenhar nada: invisível ele é pulado
    this.mesh.visible = n > 0;
    if (this.lite) this.lite.count = k;
    // só a parte usada vai para a GPU (o buffer tem a capacidade inteira, que cresce em dobros: mandar tudo a cada recorte custava ms)
    const im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor!;
    im.clearUpdateRanges(); im.addUpdateRange(0, k * 16); im.needsUpdate = true;
    ic.clearUpdateRanges(); ic.addUpdateRange(0, k * 3); ic.needsUpdate = true;
    this.dirty = false;
    this.stale = false;
  }

  public dispose(): void {
    if (this.headless) return;
    SHADOW_POOLS.delete(this);
    if (this.lite) { this.root.remove(this.lite); this.lite = null; }
    this.root.remove(this.mesh);
    this.mesh.dispose();
  }
}

/** O que é preciso para montar um grupo de multi-draw (ver multiDraw.ts): feito uma vez por (espécie, degrau, parte) pelo VegetationManager. */
export interface MultiSpec {
  /** a geometria de cada variação (para o raio de recorte de cada uma) */
  geos: THREE.BufferGeometry[];
  /** as geometrias coladas (com userData.reflGeo e userData.shadowLite, também coladas) */
  main: THREE.BufferGeometry;
  materials: MdMaterials;
  castShadow: boolean;
}

/**
 * Um grupo de instâncias para TODAS as variações de uma espécie/degrau/parte: uma lista mestre por variação (SharedInstances sem malha) e uma
 * malha só, que desenha todas numa chamada (multi-draw). As matrizes e cores recortadas vão em texturas (o shader lê pelo gl_DrawID).
 */
class MultiVariantInstances {
  public mesh!: THREE.InstancedMesh;
  public dirty = true;
  public stale = true;
  private lite: THREE.InstancedMesh | null = null;
  private readonly subs: SharedInstances[];
  private capacity = 0;
  private outM!: Float32Array;
  private outC!: Float32Array;
  private texM!: THREE.DataTexture;
  private texC!: THREE.DataTexture;
  private readonly start: Int32Array;
  private readonly count: Int32Array;
  private readonly counts = new Int32Array(MD_MAX);
  private readonly offsets = new Int32Array(MD_MAX);
  private readonly insts = new Int32Array(MD_MAX);
  private readonly shadowLod: number;
  private readonly pendingList = { counts: this.counts, offsets: this.offsets, instances: this.insts, n: 0 };

  constructor(private readonly root: THREE.Group, private readonly spec: MultiSpec, band: [number, number] | null) {
    const mats = spec.materials;
    Object.assign(mats.main.uniforms, AERIAL, HF);
    if (mats.depth) Object.assign(mats.depth.uniforms, AERIAL, HF);
    this.subs = spec.geos.map((g) => new SharedInstances(root, g, spec.materials.main, 64, spec.castShadow, band, true));
    this.start = new Int32Array(spec.geos.length);
    this.count = new Int32Array(spec.geos.length);
    this.shadowLod = band ? lodOfBand(band[0]) : 0;
    this.allocate(256);
    this.mesh = this.makeMesh(spec.main, spec.castShadow);
    root.add(this.mesh);
    const lg = spec.main.userData.shadowLite as THREE.BufferGeometry | undefined;
    if (spec.castShadow && band) {
      SHADOW_POOLS.add(this);
      if (lg) {
        this.lite = this.makeMesh(lg, true);
        this.lite.receiveShadow = false;
      }
    }
  }

  private allocate(cap: number): void {
    this.capacity = cap;
    const rows = Math.ceil((cap * 4) / MD_TEX_W);
    this.outM = new Float32Array(MD_TEX_W * rows * 4);
    const rowsC = Math.ceil(cap / MD_COL_W);
    this.outC = new Float32Array(MD_COL_W * rowsC * 4);
    const mk = (data: Float32Array, w: number, h: number): THREE.DataTexture => {
      const t = new THREE.DataTexture(data as never, w, h, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
      return t;
    };
    const oldM = this.texM, oldC = this.texC;
    this.texM = mk(this.outM, MD_TEX_W, rows);
    this.texC = mk(this.outC, MD_COL_W, rowsC);
    oldM?.dispose(); oldC?.dispose();
    const u = this.spec.materials.uniforms;
    u.uMdTex.value = this.texM; u.uMdCol.value = this.texC;
  }

  private makeMesh(geometry: THREE.BufferGeometry, castShadow: boolean): THREE.InstancedMesh {
    const mats = this.spec.materials;
    const mesh = new THREE.InstancedMesh(geometry, mats.main, 1);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));    // (só para o shader ter USE_INSTANCING_COLOR; os dados reais vêm das texturas)
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (mats.depth) mesh.customDepthMaterial = mats.depth;
    // os ganchos vêm ANTES do enableAssetEnvironment, que os chama primeiro e depois cuida da luz
    mesh.onBeforeRender = (_r, _s, _c, g) => this.prepare(g);
    mesh.onAfterRender = () => { MD.pending = null; };
    mesh.onBeforeShadow = (_r, _o, _c, _sc, g) => this.prepare(g);
    mesh.onAfterShadow = () => { MD.pending = null; };
    enableAssetEnvironment(mesh);
    return mesh;
  }

  /** monta as listas do desenho (uma entrada por variação com instâncias) e a base de cada uma para o shader */
  private prepare(geometry: THREE.BufferGeometry): void {
    const md = geometry.userData.md as { counts: Int32Array; offsets: Int32Array } | undefined;
    if (!md) { MD.pending = null; return; }
    const base = this.spec.materials.uniforms.uMdBase.value;
    let n = 0;
    for (let v = 0; v < this.count.length; v++) {
      if (this.count[v] === 0) continue;
      this.counts[n] = md.counts[v]; this.offsets[n] = md.offsets[v]; this.insts[n] = this.count[v]; base[n] = this.start[v];
      n++;
    }
    this.pendingList.n = n;
    MD.pending = this.pendingList;
  }

  public add(owner: number, variant: number, matrices: THREE.Matrix4[], colors: THREE.Color[]): void {
    this.subs[variant].add(owner, matrices, colors);
    this.dirty = true;
  }

  public remove(owner: number): void {
    for (const s of this.subs) s.remove(owner);
    this.dirty = true;
  }

  public cull(planes: Float32Array, margin: number, camX = 0, camZ = 0): void {
    let used = 0;
    for (const s of this.subs) used += s.usedCount;
    if (used > this.capacity) { let c = this.capacity; while (c < used) c *= 2; this.allocate(c); }
    let k = 0;
    for (let v = 0; v < this.subs.length; v++) {
      this.start[v] = k;
      k = this.subs[v].cullInto(this.outM, this.outC, k, 4, planes, margin, camX, camZ);
      this.count[v] = k - this.start[v];
    }
    this.mesh.count = k;
    this.mesh.visible = k > 0;
    if (this.lite) this.lite.count = k;
    this.texM.needsUpdate = true; this.texC.needsUpdate = true;
    this.dirty = false;
    this.stale = false;
  }

  public applyCascade(ci: number): void {
    const lod = this.shadowLod;
    const n = this.mesh.count;
    if (ci === -2) { this.mesh.castShadow = true; if (this.lite && this.lite.parent) this.root.remove(this.lite); return; }
    if (ci < 0) {
      this.mesh.castShadow = true;
      if (this.lite && this.lite.parent) this.root.remove(this.lite);
      return;
    }
    const table = this.lite || lod === 3 ? MAIN_WITH_LITE : CASCADE_LODS;
    this.mesh.castShadow = table[ci][lod] && n > 0;
    if (this.lite) {
      const want = LITE_CASCADES[ci][lod] && n > 0;
      if (want && !this.lite.parent) this.root.add(this.lite);
      else if (!want && this.lite.parent) this.root.remove(this.lite);
    }
  }

  public dispose(): void {
    SHADOW_POOLS.delete(this);
    if (this.lite) { this.root.remove(this.lite); this.lite = null; }
    this.root.remove(this.mesh);
    this.mesh.dispose();
    this.texM.dispose(); this.texC.dispose();
  }
}

/** Conjunto de SharedInstances indexado por (geometria, material). */
export class VegetationInstancePool {
  public readonly root = new THREE.Group();
  private pools = new Map<THREE.BufferGeometry, Map<THREE.Material, SharedInstances>>();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly wideProj = new THREE.Matrix4();
  private readonly lastProjView = new Float32Array(16);
  private readonly planes = new Float32Array(24);
  /** câmera do último recorte: só refaz quando ela girou ~2° ou andou ~4m (a margem cobre o resto) */
  private readonly cullPos = new THREE.Vector3(Infinity, 0, 0);
  private cullObsX = Infinity;
  private cullObsZ = 0;
  private readonly cullDir = new THREE.Vector3();
  private readonly cullProj = new Float32Array(16);
  private readonly _dir = new THREE.Vector3();

  public readonly nearRoot = new THREE.Group();
  public readonly farRoot = new THREE.Group();
  private multi = new Map<string, MultiVariantInstances | null>();

  /**
   * Garante o grupo de multi-draw `key` (criado na primeira vez, com a especificação de `makeSpec`). false = não dá para juntar as variações
   * (geometrias ou materiais diferentes): quem chama usa um grupo por variação, como antes.
   */
  public ensureMulti(key: string, makeSpec: () => MultiSpec | null, band: [number, number] | null, name: string): boolean {
    if (!MD.enabled) return false;
    if (!this.multi.has(key)) {
      const spec = makeSpec();
      if (!spec) this.multi.set(key, null);
      else { const m = new MultiVariantInstances(this.nearRoot, spec, band); m.mesh.name = name; this.multi.set(key, m); }
    }
    return this.multi.get(key) != null;
  }

  /** instâncias de cada variação (índice = variação) de um chunk no grupo de multi-draw `key` */
  public addMulti(owner: number, key: string, perVariant: ({ matrices: THREE.Matrix4[]; colors: THREE.Color[] } | null)[]): void {
    const pool = this.multi.get(key);
    if (!pool) return;
    if (this.removalQueue.length > 0 && this.removalQueue.includes(owner)) this.flushRemoval(owner);
    let any = false;
    perVariant.forEach((pv, vi) => { if (pv && pv.matrices.length > 0) { pool.add(owner, vi, pv.matrices, pv.colors); any = true; } });
    if (!any) return;
    let set = this.ownerPools.get(owner);
    if (!set) { set = new Set(); this.ownerPools.set(owner, set); }
    set.add(pool);
  }

  constructor() {
    this.root.name = 'vegetation_instances';
    // os grupos de instâncias ficam na origem e nunca se mexem (a posição de cada árvore vai nas matrizes das instâncias): o three não precisa
    // recalcular as matrizes de ~400 malhas a cada quadro
    this.root.matrixAutoUpdate = false;
    this.root.matrixWorldAutoUpdate = false;
    // Dois grupos: o desenho das árvores até 150 m (nearRoot) e os degraus distantes (farRoot), que o campo distante (farLayer.ts) pode
    // desenhar numa imagem à parte e reaproveitar por alguns quadros.
    this.nearRoot.name = 'veg_near';
    this.farRoot.name = 'veg_far';
    this.root.add(this.nearRoot, this.farRoot);
  }

  public add(owner: number, geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], colors: THREE.Color[], name?: string, castShadow: boolean = true, band: [number, number] | null = null): void {
    if (matrices.length === 0) return;
    if (this.removalQueue.length > 0 && this.removalQueue.includes(owner)) this.flushRemoval(owner);
    let byMat = this.pools.get(geometry);
    if (!byMat) {
      byMat = new Map();
      this.pools.set(geometry, byMat);
    }
    let pool = byMat.get(material);
    if (!pool) {
      pool = new SharedInstances(band && band[0] >= 150 ? this.farRoot : this.nearRoot, geometry, material, 256, castShadow, band);
      if (name) pool.mesh.name = name;
      byMat.set(material, pool);
    }
    pool.add(owner, matrices, colors);
    let set = this.ownerPools.get(owner);
    if (!set) { set = new Set(); this.ownerPools.set(owner, set); }
    set.add(pool);
  }

  /** os grupos em que cada chunk (dono) tem instâncias: ao descarregar só esses são mexidos, e não as centenas de malhas */
  private ownerPools = new Map<number, Set<{ remove(owner: number): void }>>();

  /**
   * Descarregar um chunk mexe em ~260 grupos (a cada um, as últimas instâncias vêm preencher os buracos): num quadro só eram 5 a 15 ms, uma
   * das travadas ao andar. Agora a retirada entra numa fila e é feita aos poucos (processRemovals, ~1 ms por quadro): quem sai já está além da
   * distância em que a árvore/grama some (o impostor do horizonte já a substituiu), então alguns quadros a mais no grupo não aparecem.
   */
  private removalQueue: number[] = [];
  public remove(owner: number): void {
    if (!this.ownerPools.has(owner) || this.removalQueue.includes(owner)) return;
    this.removalQueue.push(owner);
  }

  private flushRemoval(owner: number, deadline = Infinity): boolean {
    const set = this.ownerPools.get(owner);
    if (set) {
      for (const pool of set) {
        pool.remove(owner);
        set.delete(pool);
        if (performance.now() >= deadline) return false;
      }
      this.ownerPools.delete(owner);
    }
    const qi = this.removalQueue.indexOf(owner);
    if (qi >= 0) this.removalQueue.splice(qi, 1);
    return true;
  }

  public processRemovals(budgetMs: number): void {
    const deadline = performance.now() + budgetMs;
    while (this.removalQueue.length > 0 && performance.now() < deadline) {
      if (!this.flushRemoval(this.removalQueue[0], deadline)) return;
    }
  }

  /**
   * Recorta as instâncias pelo frustum da câmera. Só refaz um grupo quando a câmera mudou ou
   * quando chunks entraram/saíram dele. `margin` (m) mantém quem está logo fora da tela, para
   * as sombras que ele projeta para dentro da vista continuarem aparecendo. Devolve true se
   * o conjunto enviado à GPU foi refeito (as sombras precisam ser redesenhadas).
   */
  public cull(camera: THREE.Camera, margin: number = 40): boolean {
    this.processRemovals(0.8);
    camera.updateMatrixWorld();
    // Refaz o recorte só quando a câmera mudou o bastante: girou mais de ~2°, andou mais de ~4m
    // ou mudou a projeção (zoom, tela). A margem de 40m em volta da vista cobre a diferença, e
    // recortar todas as ~90 mil instâncias a cada quadro custava ~4ms de CPU (e disparava a
    // atualização das sombras).
    const dir = camera.getWorldDirection(this._dir);
    const pe = camera.projectionMatrix.elements;
    let projChanged = false;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(pe[i] - this.cullProj[i]) > 1e-4) { projChanged = true; break; }
    }
    const camChanged = projChanged
      || camera.position.distanceToSquared(this.cullPos) > CULL_MOVE * CULL_MOVE
      || (FADE.uFadeCam.value.x - this.cullObsX) ** 2 + (FADE.uFadeCam.value.y - this.cullObsZ) ** 2 > CULL_MOVE * CULL_MOVE
      || dir.dot(this.cullDir) < CULL_TURN_COS;
    if (camChanged) {
      this.cullPos.copy(camera.position);
      this.cullObsX = FADE.uFadeCam.value.x; this.cullObsZ = FADE.uFadeCam.value.y;
      this.cullDir.copy(dir);
      this.cullProj.set(pe);
      // O recorte vale por vários graus de giro: o frustum usado é MAIS LARGO que o da tela (CULL_TURN_PAD de cada lado), então girar o
      // mouse não refaz os ~700 grupos a cada 2 graus (era o que custava ~7 ms por quadro ao correr mexendo a câmera)
      const pc = camera as THREE.PerspectiveCamera;
      if (pc.isPerspectiveCamera) {
        const tv = Math.tan(Math.atan(Math.tan((pc.fov * Math.PI) / 360) / pc.zoom) + CULL_TURN_PAD);
        const th = Math.tan(Math.atan(Math.tan((pc.fov * Math.PI) / 360) / pc.zoom * pc.aspect) + CULL_TURN_PAD);
        this.wideProj.makePerspective(-pc.near * th, pc.near * th, pc.near * tv, -pc.near * tv, pc.near, pc.far);
        this.projView.multiplyMatrices(this.wideProj, camera.matrixWorldInverse);
      } else {
        this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      }
      const e = this.projView.elements;
      this.lastProjView.set(e);
      this.frustum.setFromProjectionMatrix(this.projView);
      for (let p = 0; p < 6; p++) {
        const pl = this.frustum.planes[p];
        this.planes[p * 4] = pl.normal.x; this.planes[p * 4 + 1] = pl.normal.y;
        this.planes[p * 4 + 2] = pl.normal.z; this.planes[p * 4 + 3] = pl.constant;
      }
    }
    let changed = false;
    // Os grupos (uma malha cada, centenas) são recortados aos poucos: um orçamento de ~2,5 ms por quadro, e os que faltam seguem no
    // quadro seguinte (a margem de 40 m cobre a diferença). Antes todos eram refeitos no mesmo quadro, e isso era uma travada.
    if (camChanged) for (const byMat of this.pools.values()) for (const pool of byMat.values()) pool.stale = true;
    if (camChanged) for (const m of this.multi.values()) if (m) m.stale = true;
    const t0 = performance.now();
    for (const byMat of this.pools.values()) {
      for (const pool of byMat.values()) {
        if (!pool.stale && !pool.dirty) continue;
        if (performance.now() - t0 > 1.5) { changed = true; continue; }
        // as faixas de distância (detalhe das árvores) contam a partir do observador, o mesmo ponto do shader (uFadeCam); na visão
        // aérea a câmera fica longe do personagem e a conta pela câmera sumia com as árvores
        pool.cull(this.planes, margin, FADE.uFadeCam.value.x, FADE.uFadeCam.value.y); changed = true;
      }
    }
    for (const m of this.multi.values()) {
      if (!m || (!m.stale && !m.dirty)) continue;
      if (performance.now() - t0 > 1.5) { changed = true; continue; }
      m.cull(this.planes, margin, FADE.uFadeCam.value.x, FADE.uFadeCam.value.y); changed = true;
    }
    return changed;
  }

  public clear(): void {
    this.removalQueue.length = 0;
    this.ownerPools.clear();
    for (const byMat of this.pools.values()) {
      for (const pool of byMat.values()) pool.dispose();
    }
    this.pools.clear();
    for (const m of this.multi.values()) m?.dispose();
    this.multi.clear();
  }
}
