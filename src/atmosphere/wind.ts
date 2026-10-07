/**
 * Vento do mundo: uma direção só para tudo (partículas e nuvens), que gira devagar ao longo de
 * minutos, com rajadas. Não depende da câmera: olhar para outro lado não muda para onde o vento
 * sopra.
 */
import * as THREE from 'three';

/**
 * O vento para os shaders (grama, copas): direção no plano xz, força (com rajadas) e relógio.
 * Compartilhados por referência; biomeAmbience.ts atualiza a cada quadro.
 */
export const WIND_U = {
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uWindStr: { value: 1 },
  uWindT: { value: 0 },
};

export class Wind {
  /** direção no plano xz (unitária) */
  public x = 1;
  public z = 0;
  /** força atual (1 = vento normal), já com as rajadas e o multiplicador do bioma */
  public strength = 1;
  /** rajada atual, 0 (calmaria) a 1 (pico), sem o multiplicador do bioma */
  public gust = 0;
  private t = 0;
  private baseAngle: number;

  constructor(seed = 0.7) {
    this.baseAngle = seed * Math.PI * 2;
  }

  /** biomeMul: quanto venta no bioma em volta (1 = normal) */
  public update(dt: number, biomeMul: number): void {
    this.t += dt;
    const t = this.t;
    // direção: passeia uns ±35° em volta da base, em vários minutos
    const a = this.baseAngle + Math.sin(t * 0.011) * 0.45 + Math.sin(t * 0.027 + 1.3) * 0.17;
    this.x = Math.cos(a);
    this.z = Math.sin(a);
    // rajadas: sobe e desce em alguns segundos, nunca para por completo
    const gust = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.083 + 2.1);
    this.gust = gust * gust;
    this.strength = biomeMul * (0.75 + 0.55 * this.gust);
  }
}
