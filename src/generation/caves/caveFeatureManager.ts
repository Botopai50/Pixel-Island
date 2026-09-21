import * as THREE from 'three';
import { PRNG } from '../math/prng.ts';
import { TerrainGenerator } from '../terrain/terrainGenerator.ts';

export class CaveFeatureManager {
  private group: THREE.Group;
  private terrainGen?: TerrainGenerator;

  constructor(scene: THREE.Scene, seed: number = 0, terrainGen?: TerrainGenerator) {
    this.terrainGen = terrainGen;
    this.group = new THREE.Group();
    this.group.name = 'cave_and_arch_features';
    scene.add(this.group);
    this.buildFeatures(seed);
  }

  private buildFeatures(seed: number): void {
    const prng = new PRNG(seed ^ 0x6b82c1a4);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x5a5856, flatShading: false });
    const darkInteriorMat = new THREE.MeshBasicMaterial({ color: 0x0a0c10 });

    // 1. Arcos Rochosos Naturais Procedurais (Sea Arches na linha da costa)
    const archLocations: { x: number; y: number; z: number; angle: number; scale: number }[] = [];

    if (this.terrainGen) {
      const macro = this.terrainGen.getMacro();
      // Varredura radial em torno do continente buscando pontos da linha d'água costeira
      for (let attempt = 0; attempt < 48 && archLocations.length < 4; attempt++) {
        const theta = (attempt / 48) * Math.PI * 2 + prng.range(-0.1, 0.1);
        const dist = prng.range(380.0, 750.0);
        const candX = Math.cos(theta) * dist;
        const candZ = Math.sin(theta) * dist;
        const mask = macro.getLandmassMask(candX, candZ);

        if (Math.abs(mask.coastDist) < 18.0) {
          // Calcula a tangente da orla costeira
          const d = 6.0;
          const gx = macro.getLandmassMask(candX + d, candZ).coastDist - macro.getLandmassMask(candX - d, candZ).coastDist;
          const gz = macro.getLandmassMask(candX, candZ + d).coastDist - macro.getLandmassMask(candX, candZ - d).coastDist;
          const tangent = Math.atan2(gz, gx) + Math.PI * 0.5;
          const scale = prng.range(16.0, 22.0);

          const groundY = this.terrainGen.getHeight(candX, candZ);
          archLocations.push({
            x: candX,
            y: groundY,
            z: candZ,
            angle: tangent,
            scale
          });
        }
      }
    }

    if (archLocations.length === 0) {
      const g0 = this.terrainGen ? this.terrainGen.getHeight(380.0, -160.0) : 0.0;
      const g1 = this.terrainGen ? this.terrainGen.getHeight(-310.0, 280.0) : 0.0;
      const g2 = this.terrainGen ? this.terrainGen.getHeight(540.0, 220.0) : 0.0;
      archLocations.push(
        { x: 380.0, y: g0, z: -160.0, angle: 0.65, scale: 18.0 },
        { x: -310.0, y: g1, z: 280.0, angle: -0.42, scale: 16.0 },
        { x: 540.0, y: g2, z: 220.0, angle: 1.25, scale: 20.0 }
      );
    }

    for (const arch of archLocations) {
      this.buildSeaArch(arch.x, arch.y, arch.z, arch.angle, arch.scale, rockMat);
    }

    // 2. Grutas e Entradas de Caverna Procedurais em Paredões de Montanha
    const caveEntrances: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];

    if (this.terrainGen) {
      for (let attempt = 0; attempt < 64 && caveEntrances.length < 4; attempt++) {
        const theta = prng.range(0, Math.PI * 2);
        const dist = prng.range(120.0, 480.0);
        const candX = Math.cos(theta) * dist;
        const candZ = Math.sin(theta) * dist;
        const pt = this.terrainGen.getPoint(candX, candZ);

        if (pt.height > 22.0 && pt.slope > 0.38) {
          const yaw = Math.atan2(pt.normal.x, pt.normal.z);
          const scale = prng.range(10.0, 14.0);
          caveEntrances.push({
            x: candX,
            y: pt.height - 0.4,
            z: candZ,
            yaw,
            scale
          });
        }
      }
    }

    if (caveEntrances.length === 0) {
      caveEntrances.push(
        { x: -80.0, y: 32.0, z: -85.0, yaw: 0.45, scale: 11.0 },
        { x: 120.0, y: 26.0, z: 190.0, yaw: -1.2, scale: 13.0 },
        { x: -240.0, y: 38.0, z: 80.0, yaw: 2.1, scale: 12.0 }
      );
    }

    for (const cave of caveEntrances) {
      this.buildCaveGrotto(cave.x, cave.y, cave.z, cave.yaw, cave.scale, rockMat, darkInteriorMat);
    }
  }

  private buildSeaArch(x: number, y: number, z: number, angle: number, scale: number, mat: THREE.Material): void {
    const archGroup = new THREE.Group();
    archGroup.position.set(x, y, z);
    archGroup.rotation.y = angle;

    // Torus facetado do arco superior
    const archGeo = new THREE.TorusGeometry(scale * 0.52, scale * 0.22, 6, 12, Math.PI);
    const archMesh = new THREE.Mesh(archGeo, mat);
    archMesh.position.y = scale * 0.52;
    archGroup.add(archMesh);

    // Pilares rochosos verticais ancorados profundamente no leito rochoso (sem faces coplanares soltas)
    const p1Geo = new THREE.CylinderGeometry(scale * 0.24, scale * 0.38, scale * 1.1, 6);
    const p1 = new THREE.Mesh(p1Geo, mat);
    p1.position.set(-scale * 0.52, scale * 0.15, 0);
    archGroup.add(p1);

    const p2Geo = new THREE.CylinderGeometry(scale * 0.24, scale * 0.38, scale * 1.1, 6);
    const p2 = new THREE.Mesh(p2Geo, mat);
    p2.position.set(scale * 0.52, scale * 0.15, 0);
    archGroup.add(p2);

    this.group.add(archGroup);
  }

  private buildCaveGrotto(
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    rockMat: THREE.Material,
    interiorMat: THREE.Material
  ): void {
    const grotto = new THREE.Group();
    grotto.position.set(x, y, z);
    grotto.rotation.y = yaw;

    // Arco superior da boca da caverna
    const rimGeo = new THREE.TorusGeometry(scale * 0.45, scale * 0.18, 5, 8, Math.PI);
    const rimMesh = new THREE.Mesh(rimGeo, rockMat);
    rimMesh.position.y = scale * 0.45;
    grotto.add(rimMesh);

    // Interior sombreado escuro que dá a ilusão de profundidade misteriosa
    const backGeo = new THREE.CircleGeometry(scale * 0.44, 8);
    const backMesh = new THREE.Mesh(backGeo, interiorMat);
    backMesh.position.set(0, scale * 0.45, -0.4);
    grotto.add(backMesh);

    // Estalactites suspensas na abóbada
    for (let i = 0; i < 4; i++) {
      const stGeo = new THREE.ConeGeometry(scale * 0.05, scale * 0.28, 4);
      stGeo.rotateX(Math.PI);
      const st = new THREE.Mesh(stGeo, rockMat);
      st.position.set((i - 1.5) * scale * 0.18, scale * 0.72, -0.1);
      grotto.add(st);
    }

    this.group.add(grotto);
  }
}
