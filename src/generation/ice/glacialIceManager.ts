import * as THREE from 'three';
import { PRNG } from '../math/prng.ts';
import { TerrainGenerator } from '../terrain/terrainGenerator.ts';

export class GlacialIceManager {
  private group: THREE.Group;
  private iceFloesMesh!: THREE.InstancedMesh;
  private terrainGen?: TerrainGenerator;

  constructor(scene: THREE.Scene, seed: number = 0, terrainGen?: TerrainGenerator) {
    this.terrainGen = terrainGen;
    this.group = new THREE.Group();
    this.group.name = 'glacial_ice_features';
    scene.add(this.group);
    this.buildIceFloes(seed);
  }

  private buildIceFloes(seed: number): void {
    const prng = new PRNG(seed ^ 0x2e81d4b6);

    // Geometria poligonal facetada para placas de gelo flutuantes (ice floes)
    const floeGeo = new THREE.CylinderGeometry(4.5, 5.0, 0.45, 7);
    const floeMat = new THREE.MeshLambertMaterial({
      color: 0xebf7ff,
      flatShading: false,
      reflectivity: 0.8
    });

    const floeTransforms: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
    const dummy = new THREE.Object3D();

    // Distribuição procedural de blocos de gelo na zona ártica marinha
    for (let attempt = 0; attempt < 120 && floeTransforms.length < 65; attempt++) {
      const x = prng.range(-850, 650);
      const z = prng.range(-1150, -580);

      if (this.terrainGen) {
        const iceInfl = this.terrainGen.getIceInfluence(x, z, 0);
        if (iceInfl < 0.22) continue;
        const pt = this.terrainGen.getPoint(x, z);
        if (!pt.isWater) continue; // Blocos de gelo flutuam exclusivamente na água
      }

      const scale = prng.range(1.2, 4.8);
      const rot = prng.range(0, Math.PI * 2);

      dummy.position.set(x, 0.18, z);
      dummy.scale.set(scale, 1.0, scale * prng.range(0.8, 1.2));
      dummy.rotation.set(0, rot, 0);
      dummy.updateMatrix();

      // Variação de tons entre branco neve pura e azul glacial profundo
      const tint = new THREE.Color(0xd6f0ff).lerp(new THREE.Color(0xffffff), prng.next() * 0.7);
      floeTransforms.push({ matrix: dummy.matrix.clone(), color: tint });
    }

    this.iceFloesMesh = new THREE.InstancedMesh(floeGeo, floeMat, floeTransforms.length);
    for (let i = 0; i < floeTransforms.length; i++) {
      this.iceFloesMesh.setMatrixAt(i, floeTransforms[i].matrix);
      this.iceFloesMesh.setColorAt(i, floeTransforms[i].color);
    }
    this.iceFloesMesh.instanceMatrix.needsUpdate = true;
    if (this.iceFloesMesh.instanceColor) this.iceFloesMesh.instanceColor.needsUpdate = true;

    this.group.add(this.iceFloesMesh);
  }
}
