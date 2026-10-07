import * as THREE from 'three';
import { VolcanoGenerator } from './volcanoGenerator.ts';
import { createLavaMaterial } from '../shaders/lavaShader.ts';

export class LavaFluidManager {
  private group: THREE.Group;
  private lavaMaterial: THREE.ShaderMaterial;
  private lavaMeshes: THREE.Mesh[] = [];
  /** lagos de lava montados, por posição do vulcão (os de longe são desmontados) */
  private byKey = new Map<string, THREE.Mesh>();

  constructor(scene: THREE.Scene, volcanoGen: VolcanoGenerator) {
    this.group = new THREE.Group();
    this.group.name = 'lava_fluid_pools';
    scene.add(this.group);

    this.lavaMaterial = createLavaMaterial();
    this.buildLavaLakes(volcanoGen);
  }

  /** Mantém montados os lagos de lava dos vulcões até ~9km do jogador. */
  public syncNear(volcanoGen: VolcanoGenerator, x: number, z: number): void {
    const near = volcanoGen.volcanoesNear(x, z, 9000);
    const keep = new Set<string>();
    for (const v of near) {
      const key = Math.round(v.x) + ':' + Math.round(v.z);
      keep.add(key);
      if (this.byKey.has(key)) continue;
      this.byKey.set(key, this.addLake(v));
    }
    for (const [key, mesh] of this.byKey) {
      if (keep.has(key)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.lavaMeshes = this.lavaMeshes.filter((m) => m !== mesh);
      this.byKey.delete(key);
    }
  }

  private addLake(v: { x: number; z: number; calderaRadius: number; lavaLevel: number }): THREE.Mesh {
    const radius = v.calderaRadius * 0.88;
    const geo = new THREE.CircleGeometry(radius, 48);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.lavaMaterial);
    mesh.position.set(v.x, v.lavaLevel, v.z);
    mesh.receiveShadow = false;
    this.lavaMeshes.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  private buildLavaLakes(volcanoGen: VolcanoGenerator): void {
    const volcanoes = volcanoGen.getVolcanoes();

    for (const v of volcanoes) {
      const key = Math.round(v.x) + ':' + Math.round(v.z);
      if (this.byKey.has(key)) continue;
      // Cria plano líquido perfeitamente horizontal para a lava dentro da cratera
      const radius = v.calderaRadius * 0.88;
      const geo = new THREE.CircleGeometry(radius, 48);
      geo.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geo, this.lavaMaterial);
      // Assenta a lâmina líquida exatamente na cota de lava, confinada no interior dos paredões
      mesh.position.set(v.x, v.lavaLevel, v.z);
      mesh.receiveShadow = false;

      this.lavaMeshes.push(mesh);
      this.group.add(mesh);
      this.byKey.set(key, mesh);
    }
  }

  public rebuild(volcanoGen: VolcanoGenerator): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    this.lavaMeshes = [];
    this.byKey.clear();
    this.buildLavaLakes(volcanoGen);
  }

  public update(dt: number): void {
    this.lavaMaterial.uniforms.uTime.value += dt;
  }

  public syncLighting(sunDirection: THREE.Vector3, sunColor: THREE.Color, fogColor: THREE.Color): void {
    this.lavaMaterial.uniforms.uSunDirection.value.copy(sunDirection);
    this.lavaMaterial.uniforms.uSunColor.value.copy(sunColor);
    this.lavaMaterial.uniforms.uFogColor.value.copy(fogColor);
  }

  public setFogRange(near: number, far: number): void {
    this.lavaMaterial.uniforms.uFogNear.value = near;
    this.lavaMaterial.uniforms.uFogFar.value = far;
  }

  public getMaterial(): THREE.ShaderMaterial {
    return this.lavaMaterial;
  }
}
