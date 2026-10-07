import * as THREE from 'three';

/**
 * Simulação de ondas da superfície em volta do personagem, como o mod Wakes: uma grade de alturas
 * (RES x RES células de CELL m) presa ao mundo e recentrada no personagem (o conteúdo rola junto), que
 * evolui pela equação da onda (integração de Verlet: altura atual e anterior nos canais R e G, em
 * duas texturas que se alternam). Quem anda na água empurra a superfície onde está; as ondas se
 * espalham, se cruzam e somem com o amortecimento - a esteira em V e as "bolhas" surgem sozinhas. O
 * shader da água (waterShader.ts) lê a altura e pinta espuma/ciano/sombra em pixels.
 */
const RES = 256;
const CELL = 0.1;
const SPAN = RES * CELL;
const STEP = 1 / 75;

/** Uniforms compartilhados com o shader da água (por referência). */
export const WAKE_SIM = {
  uWakeTex: { value: null as THREE.Texture | null },
  /** origem x, z da grade (m) e tamanho (m) */
  uWakeGrid: { value: new THREE.Vector3(0, 0, SPAN) },
  uWakeOn: { value: 0 },
};

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = /* glsl */ `
uniform sampler2D tPrev;
uniform vec2 uShift;      // deslocamento da grade neste passo (uv)
uniform vec2 uTexel;
uniform vec3 uSrc;        // uv do personagem e força
uniform float uSrcR;      // raio do empurrão (células)
uniform float uC2;
uniform float uDamp;
uniform float uCell;
varying vec2 vUv;
float hAt(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(tPrev, uv).r;
}
void main() {
  vec2 uv = vUv + uShift;
  vec2 s = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec2(0.0) : texture2D(tPrev, uv).rg;
  float lap = hAt(uv + vec2(uTexel.x, 0.0)) + hAt(uv - vec2(uTexel.x, 0.0))
            + hAt(uv + vec2(0.0, uTexel.y)) + hAt(uv - vec2(0.0, uTexel.y)) - 4.0 * s.r;
  // amortecimento: fraco perto do personagem (a esteira fica nítida junto dele) e forte longe (as
  // frentes de onda não seguem viajando metros à frente/ao lado depois que ele passou)
  float dm = length(vUv - uSrc.xy) / uTexel.x * uCell;
  float damp = mix(uDamp, 0.95, smoothstep(2.5, 6.0, dm));
  float hn = (2.0 * s.r - s.g + uC2 * lap) * damp;
  // o personagem desloca a água: sob ele a superfície é PRESA numa depressão (não se soma altura a
  // cada passo, que acumulava e levantava um bloco inteiro de água); andando, a depressão se move e
  // as ondas nascem dela, como a esteira de um barco
  float d = length((vUv - uSrc.xy) / uTexel);
  // perfil preso: afundado no meio e uma borda levantada em volta (a "onda de proa"), para a espuma
  // já nascer colada ao personagem, sem esperar as ondas se formarem atrás dele
  if (uSrc.z > 0.0 && d < uSrcR) {
    float k = d / uSrcR;
    float prof = -uSrc.z * (1.0 - smoothstep(0.3, 1.0, k));
    hn = mix(hn, prof, 0.75 * (1.0 - smoothstep(0.85, 1.0, k)));
  }
  // a borda da grade absorve as ondas (sem refletir de volta)
  vec2 e = min(vUv, 1.0 - vUv);
  hn *= smoothstep(0.0, 0.06, min(e.x, e.y));
  gl_FragColor = vec4(clamp(hn, -4.0, 4.0), s.r, 0.0, 1.0);
}
`;

export class WakeSim {
  private rt: THREE.WebGLRenderTarget[];
  private cur = 0;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private originX = NaN;
  private originZ = NaN;
  private acc = 0;
  private active = 0;
  /** impacto de uma queda na água: afunda a superfície com força por um instante (as ondas saem dele) */
  private kickT = 0;
  private kickS = 0;
  private kickX = 0;
  private kickZ = 0;

  /** Queda na água em x, z: strength 0-1. */
  public splash(x: number, z: number, strength: number): void {
    this.kickT = 0.12;
    this.kickS = 1.2 + 1.6 * strength;
    this.kickX = x; this.kickZ = z;
    this.active = 6;
  }

  constructor() {
    const opt = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    };
    this.rt = [new THREE.WebGLRenderTarget(RES, RES, opt), new THREE.WebGLRenderTarget(RES, RES, opt)];
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2(1 / RES, 1 / RES) },
        uSrc: { value: new THREE.Vector3() }, uSrcR: { value: 4.0 }, uC2: { value: 0.12 }, uDamp: { value: 0.994 }, uCell: { value: CELL },
      },
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
  }

  /** x, z = pés; push = força do empurrão (0 parado; cresce com a velocidade, só dentro d'água). */
  public update(renderer: THREE.WebGLRenderer, dt: number, x: number, z: number, push: number): void {
    // recentra a grade no personagem, em células inteiras
    const ox = Math.floor((x - SPAN / 2) / CELL) * CELL;
    const oz = Math.floor((z - SPAN / 2) / CELL) * CELL;
    let shiftX = 0, shiftZ = 0;
    if (Number.isNaN(this.originX) || Math.abs(ox - this.originX) > SPAN * 0.5 || Math.abs(oz - this.originZ) > SPAN * 0.5) {
      this.clear(renderer);
    } else {
      shiftX = (ox - this.originX) / SPAN;
      shiftZ = (oz - this.originZ) / SPAN;
    }
    this.originX = ox; this.originZ = oz;

    // dorme quando não há onda (economiza a GPU)
    this.active = push > 0 || this.kickT > 0 ? 6 : Math.max(0, this.active - dt);
    if (this.active <= 0) {
      WAKE_SIM.uWakeOn.value = 0;
      return;
    }

    this.acc = Math.min(this.acc + dt, STEP * 12);
    const u = this.mat.uniforms;
    const prevRT = renderer.getRenderTarget();
    let first = true;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const src = this.rt[this.cur], dst = this.rt[1 - this.cur];
      u.tPrev.value = src.texture;
      u.uShift.value.set(first ? shiftX : 0, first ? shiftZ : 0);
      if (this.kickT > 0) {
        u.uSrc.value.set((this.kickX - ox) / SPAN, (this.kickZ - oz) / SPAN, Math.max(push, this.kickS));
        this.kickT -= STEP;
      } else {
        u.uSrc.value.set((x - ox) / SPAN, (z - oz) / SPAN, push);
      }
      renderer.setRenderTarget(dst);
      renderer.render(this.scene, this.cam);
      this.cur = 1 - this.cur;
      first = false;
    }
    // se não houve passo, a grade não rolou: guarda o deslocamento para o próximo
    if (first) { this.originX -= shiftX * SPAN; this.originZ -= shiftZ * SPAN; }
    renderer.setRenderTarget(prevRT);

    WAKE_SIM.uWakeTex.value = this.rt[this.cur].texture;
    WAKE_SIM.uWakeGrid.value.set(this.originX, this.originZ, SPAN);
    WAKE_SIM.uWakeOn.value = 1;
  }

  private clear(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    const cc = new THREE.Color();
    renderer.getClearColor(cc);
    const ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);
    for (const r of this.rt) { renderer.setRenderTarget(r); renderer.clear(true, false, false); }
    renderer.setClearColor(cc, ca);
    renderer.setRenderTarget(prev);
  }
}
