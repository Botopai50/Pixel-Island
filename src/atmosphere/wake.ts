import * as THREE from 'three';

/**
 * Rastro d'água (como o mod Wakes do Minecraft): quem anda na água deixa atrás de si uma esteira em V
 * de espuma que se abre e vai sumindo, com um borbulho branco junto aos pés. O rastro é uma fila de
 * amostras (posição, idade, direção do movimento) deixadas a cada ~0.6m andados; o shader da água
 * (waterShader.ts) lê as amostras e desenha a espuma em pixels no mar, nos rios, nos lagos e nas
 * poças termais (o material é o mesmo).
 */
export const WAKE_MAX = 56;
export const WAKE_LIFE = 4.0;
const SPACING = 0.5;
const MARGIN = 6.0;
/** O rastro tem no máximo ~TRAIL amostras: ao nascer uma nova, a mais velha se desmancha (esmaece com a posição na fila) */
const TRAIL = 22;

/** Uniforms compartilhados por referência (waterShader.ts os liga ao material da água). */
export const WAKE = {
  /** x, z, idade (s; > WAKE_LIFE = vazia), ângulo do movimento (rad, no plano xz) */
  uWake: { value: Array.from({ length: WAKE_MAX }, () => new THREE.Vector4(0, 0, 99, 0)) },
  /** centro e raio da área com rastro (o shader só olha as amostras perto dele); raio < 0 = sem rastro */
  uWakeArea: { value: new THREE.Vector3(0, 0, -1) },
  /** velocidade recente (m/s): quanto mais rápido, mais aberto o V */
  uWakeSpeed: { value: 0 },
  /** meia espessura (m) da fatia que cada amostra cobre ao longo do caminho (cresce com o espaçamento) */
  uWakeSlab: { value: 0.42 },
  /** ondas em volta do personagem parado na água: x, z, intensidade (0-1), relógio (s) */
  uWakeIdle: { value: new THREE.Vector4(0, 0, 0, 0) },
};

export class WakeTrail {
  private next = 0;
  private acc = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private speed = 0;
  private angle = 0;
  private spacing = SPACING;
  /** idade em segundos e número de ordem de cada amostra (a idade que o shader recebe é a maior das duas) */
  private timeAge = new Float32Array(WAKE_MAX).fill(99);
  private seq = new Float64Array(WAKE_MAX);
  private head = 0;
  private idle = 0;
  private clock = 0;

  /** x, z = pés do personagem; inWater = está andando na superfície da água. */
  public update(dt: number, x: number, z: number, inWater: boolean): void {
    const samples = WAKE.uWake.value;
    let any = false;
    for (let i = 0; i < WAKE_MAX; i++) {
      if (this.timeAge[i] > WAKE_LIFE) continue;
      this.timeAge[i] += dt;
      // quanto mais amostras novas nasceram depois dela, mais ela esmaece (some a ~TRAIL amostras)
      const byOrder = ((this.head - this.seq[i]) / TRAIL) * WAKE_LIFE;
      const eff = Math.max(this.timeAge[i], byOrder);
      if (eff > WAKE_LIFE) { this.timeAge[i] = 99; samples[i].z = 99; continue; }
      samples[i].z = eff;
      any = true;
    }
    if (Number.isNaN(this.lastX)) { this.lastX = x; this.lastZ = z; }
    const dx = x - this.lastX, dz = z - this.lastZ;
    const d = Math.hypot(dx, dz);
    this.lastX = x; this.lastZ = z;
    if (d > 5) { this.acc = 0; return; } // teleporte: sem rastro
    const inst = dt > 0 ? d / dt : 0;
    this.speed += (inst - this.speed) * Math.min(1, dt * 4);
    if (d > 0.002) this.angle = Math.atan2(dz, dx);

    // Correndo, as 56 amostras acabariam antes de a esteira esmaecer (o rastro sumia de repente no
    // fim da fila): o espaçamento cresce com a velocidade para a fila durar sempre a vida inteira
    this.spacing = Math.max(SPACING, this.speed * WAKE_LIFE / WAKE_MAX * 1.1);
    WAKE.uWakeSlab.value = this.spacing * 0.5 + 0.08;
    const emitting = inWater && d > 0.002 && this.speed > 0.5;
    // Parado (ou fora d'água), a esteira se desfaz da ponta para o personagem: é como se nascessem
    // amostras novas (~9/s) sem sair do lugar, e as mais velhas esmaecem primeiro
    if (!emitting) this.head += 9 * dt;
    // ondas em volta do personagem parado na água: crescem enquanto ele está parado e somem ao andar
    const idleTarget = inWater && this.speed < 0.6 ? 1 : 0;
    this.idle += (idleTarget - this.idle) * (1 - Math.exp(-dt * (idleTarget > this.idle ? 2.5 : 6)));
    this.clock = (this.clock + dt) % 1000;
    WAKE.uWakeIdle.value.set(x, z, this.idle < 0.01 ? 0 : this.idle, this.clock);
    if (emitting) {
      this.acc += d;
      while (this.acc >= this.spacing) {
        this.acc -= this.spacing;
        samples[this.next].set(x - Math.cos(this.angle) * this.acc, z - Math.sin(this.angle) * this.acc, 0, this.angle);
        this.timeAge[this.next] = 0;
        this.seq[this.next] = this.head++;
        this.next = (this.next + 1) % WAKE_MAX;
        any = true;
      }
    } else if (!inWater) {
      this.acc = 0;
    }
    WAKE.uWakeSpeed.value = Math.min(this.speed, 14);
    // área do rastro: centrada no personagem, até a amostra ativa mais distante (+ folga): o shader
    // só olha as amostras dentro dela, e um raio fixo cortava a ponta da esteira de repente
    let far = 0;
    for (const s of samples) {
      if (s.z > WAKE_LIFE) continue;
      const dd = Math.hypot(s.x - x, s.y - z);
      if (dd > far) far = dd;
    }
    WAKE.uWakeArea.value.set(x, z, any ? far + MARGIN : -1);
  }
}
