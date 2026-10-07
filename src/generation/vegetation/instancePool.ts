import * as THREE from 'three';

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

  constructor(
    private readonly root: THREE.Group,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    initialCapacity: number,
    private readonly castShadow: boolean = true
  ) {
    this.capacity = initialCapacity;
    this.allM = new Float32Array(initialCapacity * 16);
    this.allC = new Float32Array(initialCapacity * 3);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.geoRadius = geometry.boundingSphere?.radius ?? 1;
    this.geoCenter = geometry.boundingSphere?.center.clone() ?? new THREE.Vector3();
    this.mesh = this.createMesh(initialCapacity);
    root.add(this.mesh);
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    // O recorte é feito aqui mesmo (cull), instância por instância; o culling por objeto do
    // three.js usaria a esfera da geometria-base e esconderia o grupo inteiro por engano.
    mesh.frustumCulled = false;
    return mesh;
  }

  private grow(minCapacity: number): void {
    let capacity = this.capacity;
    while (capacity < minCapacity) capacity *= 2;
    const nm = new Float32Array(capacity * 16); nm.set(this.allM); this.allM = nm;
    const nc = new Float32Array(capacity * 3); nc.set(this.allC); this.allC = nc;
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
      this.allC[slot * 3] = c.r; this.allC[slot * 3 + 1] = c.g; this.allC[slot * 3 + 2] = c.b;
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
  public cull(planes: Float32Array, margin: number): void {
    const M = this.allM, C = this.allC;
    const out = this.mesh.instanceMatrix.array as Float32Array;
    const outC = this.mesh.instanceColor!.array as Float32Array;
    const gcx = this.geoCenter.x, gcy = this.geoCenter.y, gcz = this.geoCenter.z, gr = this.geoRadius;
    let k = 0;
    // copia uma instância para o buffer da GPU (sem criar objetos: antes um subarray por instância)
    const emit = (s: number) => {
      const o = s * 16, d = k * 16;
      for (let j = 0; j < 16; j++) out[d + j] = M[o + j];
      outC[k * 3] = C[s * 3]; outC[k * 3 + 1] = C[s * 3 + 1]; outC[k * 3 + 2] = C[s * 3 + 2];
      k++;
    };
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
      if (mode === 0) continue;
      if (mode === 2) { for (const s of slots) emit(s); continue; }
      for (const s of slots) {
        const o = s * 16;
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
        if (inside) emit(s);
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.dirty = false;
  }

  public dispose(): void {
    this.root.remove(this.mesh);
    this.mesh.dispose();
  }
}

/** Conjunto de SharedInstances indexado por (geometria, material). */
export class VegetationInstancePool {
  public readonly root = new THREE.Group();
  private pools = new Map<THREE.BufferGeometry, Map<THREE.Material, SharedInstances>>();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly lastProjView = new Float32Array(16);
  private readonly planes = new Float32Array(24);
  /** câmera do último recorte: só refaz quando ela girou ~2° ou andou ~4m (a margem cobre o resto) */
  private readonly cullPos = new THREE.Vector3(Infinity, 0, 0);
  private readonly cullDir = new THREE.Vector3();
  private readonly cullProj = new Float32Array(16);
  private readonly _dir = new THREE.Vector3();

  constructor() {
    this.root.name = 'vegetation_instances';
  }

  public add(owner: number, geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], colors: THREE.Color[], name?: string, castShadow: boolean = true): void {
    if (matrices.length === 0) return;
    let byMat = this.pools.get(geometry);
    if (!byMat) {
      byMat = new Map();
      this.pools.set(geometry, byMat);
    }
    let pool = byMat.get(material);
    if (!pool) {
      pool = new SharedInstances(this.root, geometry, material, 256, castShadow);
      if (name) pool.mesh.name = name;
      byMat.set(material, pool);
    }
    pool.add(owner, matrices, colors);
  }

  public remove(owner: number): void {
    for (const byMat of this.pools.values()) {
      for (const pool of byMat.values()) pool.remove(owner);
    }
  }

  /**
   * Recorta as instâncias pelo frustum da câmera. Só refaz um grupo quando a câmera mudou ou
   * quando chunks entraram/saíram dele. `margin` (m) mantém quem está logo fora da tela, para
   * as sombras que ele projeta para dentro da vista continuarem aparecendo. Devolve true se
   * o conjunto enviado à GPU foi refeito (as sombras precisam ser redesenhadas).
   */
  public cull(camera: THREE.Camera, margin: number = 40): boolean {
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
      || camera.position.distanceToSquared(this.cullPos) > 16
      || dir.dot(this.cullDir) < 0.99939;
    if (camChanged) {
      this.cullPos.copy(camera.position);
      this.cullDir.copy(dir);
      this.cullProj.set(pe);
      this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
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
    for (const byMat of this.pools.values()) {
      for (const pool of byMat.values()) {
        if (camChanged || pool.dirty) { pool.cull(this.planes, margin); changed = true; }
      }
    }
    return changed;
  }

  public clear(): void {
    for (const byMat of this.pools.values()) {
      for (const pool of byMat.values()) pool.dispose();
    }
    this.pools.clear();
  }
}
