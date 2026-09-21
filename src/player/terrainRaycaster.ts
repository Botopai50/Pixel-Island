import * as THREE from 'three';
import { CONFIG } from '../config.ts';

export interface RaycastHit {
  hit: boolean;
  point: THREE.Vector3;
  height: number;
  isWater: boolean;
}

export interface ITerrainHeightQueryable {
  getHeight(x: number, z: number): number;
}

export class TerrainRaycaster {
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private ndc: THREE.Vector2 = new THREE.Vector2();

  /**
   * Projeta um raio da tela contra o relevo analítico contínuo do terreno procedural.
   * Utiliza raymarching híbrido (varredura intervalar com refinamento por bissecção).
   */
  public castFromScreen(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    terrain: ITerrainHeightQueryable
  ): RaycastHit | null {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width <= 0 || height <= 0) return null;

    this.ndc.x = (screenX / width) * 2 - 1;
    this.ndc.y = -(screenY / height) * 2 + 1;

    this.raycaster.setFromCamera(this.ndc, camera);
    const ray = this.raycaster.ray;

    // Se o raio não aponta para baixo, não interceptará o terreno
    if (ray.direction.y >= -0.001) return null;

    // Determina o intervalo vertical plausível da ilha
    const topY = CONFIG.MAX_HEIGHT + 30.0;
    const bottomY = CONFIG.OCEAN_FLOOR - 15.0;

    let tMin = (topY - ray.origin.y) / ray.direction.y;
    let tMax = (bottomY - ray.origin.y) / ray.direction.y;

    if (tMin < 0) tMin = 0;
    if (tMax <= tMin) return null;

    // Passo 1: Varredura grosseira em passos uniformes para encontrar o intervalo de cruzamento
    const coarseSteps = 24;
    const stepSize = (tMax - tMin) / coarseSteps;

    let tA = tMin;
    let tB = tMin;
    let found = false;

    let prevT = tMin;

    for (let i = 1; i <= coarseSteps; i++) {
      const curT = tMin + i * stepSize;
      const curX = ray.origin.x + curT * ray.direction.x;
      const curY = ray.origin.y + curT * ray.direction.y;
      const curZ = ray.origin.z + curT * ray.direction.z;
      const terrainH = terrain.getHeight(curX, curZ);
      const diff = curY - terrainH;

      if (diff <= 0.0) {
        // Cruzou a superfície do relevo!
        tA = prevT;
        tB = curT;
        found = true;
        break;
      }

      prevT = curT;
    }

    if (!found) {
      // Se não cruzou o relevo, testa interseção plana com o nível do mar (0.0m)
      const tSea = (CONFIG.SEA_LEVEL - ray.origin.y) / ray.direction.y;
      if (tSea > 0) {
        const seaX = ray.origin.x + tSea * ray.direction.x;
        const seaZ = ray.origin.z + tSea * ray.direction.z;
        const hAtSea = terrain.getHeight(seaX, seaZ);
        return {
          hit: true,
          point: new THREE.Vector3(seaX, CONFIG.SEA_LEVEL, seaZ),
          height: hAtSea,
          isWater: true
        };
      }
      return null;
    }

    // Passo 2: Refinamento de alta precisão por bissecção (10 iterações -> precisão milimétrica)
    let low = tA;
    let high = tB;
    for (let j = 0; j < 10; j++) {
      const mid = (low + high) * 0.5;
      const midX = ray.origin.x + mid * ray.direction.x;
      const midY = ray.origin.y + mid * ray.direction.y;
      const midZ = ray.origin.z + mid * ray.direction.z;
      const h = terrain.getHeight(midX, midZ);
      if (midY > h) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const finalT = (low + high) * 0.5;
    const finalX = ray.origin.x + finalT * ray.direction.x;
    const finalZ = ray.origin.z + finalT * ray.direction.z;
    const finalH = terrain.getHeight(finalX, finalZ);

    return {
      hit: true,
      point: new THREE.Vector3(finalX, finalH, finalZ),
      height: finalH,
      isWater: finalH <= CONFIG.SEA_LEVEL
    };
  }
}
