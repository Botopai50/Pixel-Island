import * as THREE from 'three';
import { Hydrology } from './hydrology.ts';

/**
 * Gerenciador Hidrológico Continental.
 * IMPORTANTE: Zero planos ou malhas adicionais de água são criados.
 * Rios e lagos utilizam 100% a mesma água do oceano global contínuo (y = 0.0m),
 * aparecendo exclusivamente através da depressão e do desnível natural da terra.
 */
export class InlandWaterManager {
  private group: THREE.Group;

  constructor(scene: THREE.Scene, _hydrology: Hydrology) {
    this.group = new THREE.Group();
    this.group.name = 'inland_water_system';
    scene.add(this.group);
  }

  public rebuild(_hydrology: Hydrology): void {
    // Rios e lagos utilizam 100% a mesma água do oceano global (y = 0.0m)
  }

  public update(_dt: number): void {}

  public syncLighting(
    _sunDirection: THREE.Vector3,
    _sunColor: THREE.Color,
    _fogColor: THREE.Color
  ): void {}

  public getGroup(): THREE.Group {
    return this.group;
  }
}
