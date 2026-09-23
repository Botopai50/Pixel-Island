import * as THREE from 'three';

/**
 * Um InstancedMesh compartilhado por todos os chunks para um par (geometria, material).
 * Cada chunk ocupa algumas posições; ao descarregar, as posições são liberadas trazendo as
 * últimas instâncias para os buracos (o buffer fica sempre contíguo e mesh.count = em uso).
 *
 * Antes cada chunk criava um InstancedMesh por espécie com poucas instâncias cada, o que dava
 * ~1000 draw calls (x3 com as cascatas de sombra) só de vegetação.
 */
class SharedInstances {
  public mesh: THREE.InstancedMesh;
  private capacity: number;
  private used = 0;
  private slotOwner: number[] = [];
  private ownerSlots = new Map<number, Set<number>>();

  constructor(
    private readonly root: THREE.Group,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    initialCapacity: number
  ) {
    this.capacity = initialCapacity;
    this.mesh = this.createMesh(initialCapacity);
    root.add(this.mesh);
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // As instâncias se espalham pelo mundo inteiro; o culling por objeto não ajudaria
    mesh.frustumCulled = false;
    return mesh;
  }

  private grow(minCapacity: number): void {
    let capacity = this.capacity;
    while (capacity < minCapacity) capacity *= 2;
    const next = this.createMesh(capacity);
    (next.instanceMatrix.array as Float32Array).set(this.mesh.instanceMatrix.array as Float32Array);
    (next.instanceColor!.array as Float32Array).set(this.mesh.instanceColor!.array as Float32Array);
    next.count = this.used;
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
      this.mesh.setMatrixAt(slot, matrices[i]);
      this.mesh.setColorAt(slot, colors[i]);
      this.slotOwner[slot] = owner;
      slots.add(slot);
    }
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  public remove(owner: number): void {
    const slots = this.ownerSlots.get(owner);
    if (!slots) return;
    this.ownerSlots.delete(owner);

    const matrixArr = this.mesh.instanceMatrix.array as Float32Array;
    const colorArr = this.mesh.instanceColor!.array as Float32Array;
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
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
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

  constructor() {
    this.root.name = 'vegetation_instances';
  }

  public add(owner: number, geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], colors: THREE.Color[], name?: string): void {
    if (matrices.length === 0) return;
    let byMat = this.pools.get(geometry);
    if (!byMat) {
      byMat = new Map();
      this.pools.set(geometry, byMat);
    }
    let pool = byMat.get(material);
    if (!pool) {
      pool = new SharedInstances(this.root, geometry, material, 256);
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

  public clear(): void {
    for (const byMat of this.pools.values()) {
      for (const pool of byMat.values()) pool.dispose();
    }
    this.pools.clear();
  }
}
