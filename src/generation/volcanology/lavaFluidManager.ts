import * as THREE from 'three';
import { VolcanoGenerator } from './volcanoGenerator.ts';
import { createLavaMaterial } from '../shaders/lavaShader.ts';

export class LavaFluidManager {
  private group: THREE.Group;
  private lavaMaterial: THREE.ShaderMaterial;
  private lavaMeshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene, volcanoGen: VolcanoGenerator) {
    this.group = new THREE.Group();
    this.group.name = 'lava_fluid_pools';
    scene.add(this.group);

    this.lavaMaterial = createLavaMaterial();
    this.buildLavaLakes(volcanoGen);
  }

  private buildLavaLakes(volcanoGen: VolcanoGenerator): void {
    const volcanoes = volcanoGen.getVolcanoes();

    for (const v of volcanoes) {
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
    }
  }

  public rebuild(volcanoGen: VolcanoGenerator): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    this.lavaMeshes = [];
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

  public getMaterial(): THREE.ShaderMaterial {
    return this.lavaMaterial;
  }
}
