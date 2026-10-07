import * as THREE from 'three';
import type { TerrainGenerator } from '../terrain/terrainGenerator.ts';

/**
 * Diz se há água à vista, para o reflexo planar da água (que redesenha a cena inteira, ~40% do
 * custo da GPU em primeira pessoa) só ser desenhado quando ela aparece na tela.
 *
 * Uma grade de raios cobre a tela; poucos raios por quadro (a varredura completa leva alguns
 * quadros). Cada raio anda em passos crescentes usando só a altura do terreno (barata) e, onde
 * bate no chão (ou desce abaixo do nível do mar), pergunta uma vez se ali é água (rio, lago, mar).
 * Depois de ver água, o reflexo continua ligado por HOLD segundos (sem acender e apagar).
 */
const COLS = 9, ROWS = 4;
const RAYS_PER_FRAME = 6;
const HOLD = 1.0;

export class WaterVisibility {
  private next = 0;
  private lastSeen = -Infinity;
  private _ndc = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _p = new THREE.Vector3();

  /** true enquanto há (ou houve há pouco) água na tela */
  public update(camera: THREE.PerspectiveCamera, tg: TerrainGenerator, now: number): boolean {
    for (let i = 0; i < RAYS_PER_FRAME; i++) {
      const k = this.next;
      this.next = (k + 1) % (COLS * ROWS);
      // da metade de cima até a borda de baixo da tela (água fica no chão)
      const nx = -0.95 + 1.9 * ((k % COLS) + 0.5) / COLS;
      const ny = -0.98 + 1.33 * (Math.floor(k / COLS) + 0.5) / ROWS;
      if (this.rayHitsWater(camera, tg, nx, ny)) this.lastSeen = now;
    }
    return now - this.lastSeen < HOLD;
  }

  private rayHitsWater(camera: THREE.PerspectiveCamera, tg: TerrainGenerator, nx: number, ny: number): boolean {
    const o = camera.position;
    const d = this._dir.copy(this._ndc.set(nx, ny, 0.5).unproject(camera)).sub(o).normalize();
    if (d.y > 0.02) return false;
    const p = this._p;
    for (let t = 1.5; t < 3000; t *= 1.45) {
      p.copy(o).addScaledVector(d, t);
      const h = tg.getHeight(p.x, p.z);
      // abaixo do nível do mar com o fundo ainda mais baixo: é o mar
      if (p.y <= 0.0 && h < 0.0) return true;
      if (p.y <= h + 0.3) {
        const q = tg.getPointFast(p.x, p.z);
        return q.isWater || q.waterSurfaceY > q.height + 0.05;
      }
    }
    return false;
  }
}
