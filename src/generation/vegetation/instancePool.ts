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
  /** Lista mestre (todas as instâncias carregadas): matrizes 4x4 e cores RGB */
  private allM: Float32Array;
  private allC: Float32Array;
  /** Esfera de culling já transformada para o mundo: cx, cy, cz, raio. */
  private allS: Float32Array;
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
    this.allS = new Float32Array(initialCapacity * 4);
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
    const ns = new Float32Array(capacity * 4); ns.set(this.allS); this.allS = ns;
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
    for (let i = 0; i < matrices.length; i++) {
      const slot = this.used++;
      const matrix = matrices[i];
      matrix.toArray(this.allM, slot * 16);

      // Calcula a esfera em world-space uma única vez na entrada do pool.
      // Antes escala e centro eram recalculados para TODA instância em todo culling.
      const me = matrix.elements;
      const sx = me[0] * me[0] + me[1] * me[1] + me[2] * me[2];
      const sy = me[4] * me[4] + me[5] * me[5] + me[6] * me[6];
      const sz = me[8] * me[8] + me[9] * me[9] + me[10] * me[10];
      const sc = Math.sqrt(Math.max(sx, sy, sz));
      const so = slot * 4;
      this.allS[so] = me[0] * this.geoCenter.x + me[4] * this.geoCenter.y + me[8] * this.geoCenter.z + me[12];
      this.allS[so + 1] = me[1] * this.geoCenter.x + me[5] * this.geoCenter.y + me[9] * this.geoCenter.z + me[13];
      this.allS[so + 2] = me[2] * this.geoCenter.x + me[6] * this.geoCenter.y + me[10] * this.geoCenter.z + me[14];
      this.allS[so + 3] = this.geoRadius * sc;

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

    const matrixArr = this.allM, colorArr = this.allC, sphereArr = this.allS;
    // Libera do maior para o menor: a última instância em uso nunca é uma das que estão saindo
    const sorted = Array.from(slots).sort((a, b) => b - a);
    for (const slot of sorted) {
      const last = --this.used;
      if (slot !== last) {
        matrixArr.copyWithin(slot * 16, last * 16, last * 16 + 16);
        colorArr.copyWithin(slot * 3, last * 3, last * 3 + 3);
        sphereArr.copyWithin(slot * 4, last * 4, last * 4 + 4);
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
    const M = this.allM, C = this.allC, S = this.allS;
    const out = this.mesh.instanceMatrix.array as Float32Array;
    const outC = this.mesh.instanceColor!.array as Float32Array;
    let k = 0;
    for (let s = 0; s < this.used; s++) {
      const o = s * 16;
      const so = s * 4;
      const cx = S[so], cy = S[so + 1], cz = S[so + 2];
      const r = S[so + 3] + margin;
      let inside = true;
      for (let p = 0; p < 24; p += 4) {
        if (planes[p] * cx + planes[p + 1] * cy + planes[p + 2] * cz + planes[p + 3] < -r) { inside = false; break; }
      }
      if (!inside) continue;
      out.set(M.subarray(o, o + 16), k * 16);
      outC[k * 3] = C[s * 3]; outC[k * 3 + 1] = C[s * 3 + 1]; outC[k * 3 + 2] = C[s * 3 + 2];
      k++;
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
  private readonly planes = new Float32Array(24);
  private readonly lastCameraPos = new THREE.Vector3();
  private readonly lastCameraQuat = new THREE.Quaternion();
  private readonly tempCameraPos = new THREE.Vector3();
  private readonly tempCameraQuat = new THREE.Quaternion();
  private readonly lastProjection = new Float32Array(16);
  private hasCullState = false;

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
    camera.getWorldPosition(this.tempCameraPos);
    camera.getWorldQuaternion(this.tempCameraQuat);

    // A margem de 40m permite evitar refazer o culling por micromovimentos.
    // Quando o deslocamento acumulado passa de 0.35m ou a rotação muda ~0.5 grau, atualiza.
    let projectionChanged = !this.hasCullState;
    const pe = camera.projectionMatrix.elements;
    if (!projectionChanged) {
      for (let i = 0; i < 16; i++) {
        if (Math.abs(pe[i] - this.lastProjection[i]) > 1e-6) { projectionChanged = true; break; }
      }
    }

    const moved = !this.hasCullState || this.tempCameraPos.distanceToSquared(this.lastCameraPos) > 0.35 * 0.35;
    const rotated = !this.hasCullState || Math.abs(this.tempCameraQuat.dot(this.lastCameraQuat)) < 0.99999;
    const camChanged = moved || rotated || projectionChanged;

    if (camChanged) {
      this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projView);
      this.lastCameraPos.copy(this.tempCameraPos);
      this.lastCameraQuat.copy(this.tempCameraQuat);
      this.lastProjection.set(pe);
      this.hasCullState = true;
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
