import * as THREE from 'three';

/**
 * Pegadas na areia e na neve. A cada passo (~0.7m andados em primeira pessoa) guarda uma pegada
 * (pé esquerdo e direito alternados, ao lado da linha do caminho), até MAX ao mesmo tempo; o
 * shader do terreno desenha a marca do pé em pixels (na grade da textura do chão) só em chão claro
 * (areia, neve), e ela some aos poucos em LIFE segundos.
 */
export const FOOT_MAX = 48;
const LIFE = 40;
const STEP = 0.7;

export const FOOTPRINTS = {
  /** x, z, ângulo (direção do passo), idade (s; > LIFE = vazia) */
  uFoot: { value: Array.from({ length: FOOT_MAX }, () => new THREE.Vector4(0, 0, 0, 1e6)) },
  /** centro e raio de onde há pegadas (o shader só olha perto delas) */
  uFootArea: { value: new THREE.Vector3(0, 0, -1) },
};

export const FOOTPRINT_GLSL = /* glsl */ `
uniform vec4 uFoot[${FOOT_MAX}];
uniform vec3 uFootArea;
// quanto de pegada há neste ponto do chão (0-1, já com o desbotar da idade)
float footprintAt(vec2 p) {
  if (uFootArea.z < 0.0 || distance(p, uFootArea.xy) > uFootArea.z) return 0.0;
  float best = 0.0;
  for (int i = 0; i < ${FOOT_MAX}; i++) {
    vec4 f = uFoot[i];
    if (f.w > ${LIFE.toFixed(1)}) continue;
    vec2 d = p - f.xy;
    if (dot(d, d) > 0.25) continue;
    float c = cos(f.z), s = sin(f.z);
    vec2 l = vec2(c * d.x + s * d.y, -s * d.x + c * d.y); // l.x ao longo do passo
    // sola: elipse comprida; calcanhar mais estreito atrás
    float sole = (l.x * l.x) / (0.22 * 0.22) + (l.y * l.y) / (0.11 * 0.11);
    if (sole < 1.0) best = max(best, 1.0 - smoothstep(${(LIFE * 0.4).toFixed(1)}, ${LIFE.toFixed(1)}, f.w));
  }
  return best;
}
`;

export class Footprints {
  private next = 0;
  private walked = 0;
  private last = new THREE.Vector2(NaN, NaN);
  private left = false;

  /** feet: posição dos pés; active: primeira pessoa, no chão e fora d'água */
  public update(dt: number, feet: THREE.Vector3, active: boolean): void {
    const prints = FOOTPRINTS.uFoot.value;
    for (const f of prints) f.w += dt;
    if (!active) { this.last.set(NaN, NaN); return; }
    if (Number.isNaN(this.last.x)) { this.last.set(feet.x, feet.z); return; }
    const dx = feet.x - this.last.x, dz = feet.z - this.last.y;
    const d = Math.hypot(dx, dz);
    if (d > 5) { this.last.set(feet.x, feet.z); return; } // teleporte
    this.walked += d;
    this.last.set(feet.x, feet.z);
    if (this.walked < STEP || d < 1e-4) return;
    this.walked = 0;
    const ang = Math.atan2(dz, dx);
    const side = this.left ? 1 : -1;
    this.left = !this.left;
    const f = prints[this.next];
    this.next = (this.next + 1) % FOOT_MAX;
    // ao lado da linha do caminho (pé esquerdo/direito)
    f.set(feet.x - Math.sin(ang) * 0.18 * side, feet.z + Math.cos(ang) * 0.18 * side, ang, 0);
    // área com pegadas: em volta do jogador, cobrindo as mais antigas ainda visíveis
    FOOTPRINTS.uFootArea.value.set(feet.x, feet.z, 60);
  }
}
