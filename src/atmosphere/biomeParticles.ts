import * as THREE from 'three';
import { AERIAL } from './atmosphericFog.ts';
import type { Wind } from './wind.ts';

/**
 * Partículas do ar de cada bioma, em pixel art: quadradinhos de 1-4 pixels inteiros, sem textura.
 *
 * Cada tipo é uma nuvem fixa de pontos animada na GPU: a posição é semente + deslocamento + balanço,
 * dobrada (mod) numa caixa em volta da câmera. O deslocamento soma a queda/subida própria do tipo e
 * o vento do mundo (wind.ts: uma direção só, com rajadas), acumulado na CPU a cada quadro. Presas
 * ao mundo: andar ou girar a câmera não muda para onde elas vão. A quantidade visível é a mistura do bioma (0-1): cada
 * ponto tem um sorteio e só aparece se o sorteio for menor que ela.
 */
export const PARTICLE_KINDS = ['snow', 'leaves', 'pollen', 'fireflies', 'dust', 'sand', 'ash', 'embers', 'motes', 'steam'] as const;
export type ParticleKind = typeof PARTICLE_KINDS[number];

interface KindDef {
  count: number;
  /** caixa (m): largura/profundidade e altura; e quanto o centro fica abaixo dos olhos */
  box: number; boxH: number; drop: number;
  /** velocidade vertical própria (m/s: neve cai, brasas sobem) e quanto o vento arrasta (m/s) */
  fall: number; wind: number;
  /** balanço lateral (m) e frequência */
  sway: number; swayF: number;
  /** tamanho no mundo (m), teto e piso em pixels */
  size: number; maxPx: number; minPx?: number;
  colors: string[];
  alpha: number;
  /** brilha sozinho (vaga-lumes, brasas): soma em vez de cobrir, e pisca */
  glow?: boolean;
  /** 0 = sempre; 1 = só de noite; -1 = some de noite */
  night?: number;
}

const KINDS: Record<ParticleKind, KindDef> = {
  snow: { count: 3000, box: 40, boxH: 22, drop: 4, fall: -1.3, wind: 1, sway: 0.6, swayF: 0.7, size: 0.11, maxPx: 5, minPx: 2, colors: ['#f6f9ff', '#e4ecf8'], alpha: 0.95 },
  leaves: { count: 1200, box: 36, boxH: 16, drop: 3, fall: -0.85, wind: 1.4, sway: 1.1, swayF: 0.9, size: 0.17, maxPx: 5, minPx: 2, colors: ['#d8762a', '#b8402a', '#e2b03a', '#a8582a'], alpha: 1.0 },
  pollen: { count: 1000, box: 30, boxH: 8, drop: 2.5, fall: 0.05, wind: 0.35, sway: 0.7, swayF: 0.35, size: 0.08, maxPx: 3, minPx: 2, colors: ['#fff4b8', '#ffffff'], alpha: 0.85, night: -1 },
  fireflies: { count: 520, box: 36, boxH: 6, drop: 2.0, fall: 0.02, wind: 0.05, sway: 1.3, swayF: 0.22, size: 0.12, maxPx: 4, colors: ['#d8ff6a', '#f4ff9a'], alpha: 1.0, glow: true, night: 1 },
  dust: { count: 1000, box: 40, boxH: 8, drop: 2.5, fall: 0.06, wind: 1.6, sway: 0.35, swayF: 0.3, size: 0.09, maxPx: 4, minPx: 2, colors: ['#ead0a0', '#d8b47a'], alpha: 0.6 },
  sand: { count: 1100, box: 34, boxH: 6, drop: 1.6, fall: 0.0, wind: 6.5, sway: 0.25, swayF: 1.6, size: 0.12, maxPx: 5, minPx: 2, colors: ['#f6e2b8', '#c8965a', '#fff0d0'], alpha: 0.9 },
  ash: { count: 2000, box: 40, boxH: 20, drop: 4, fall: -0.55, wind: 0.6, sway: 0.45, swayF: 0.5, size: 0.09, maxPx: 4, minPx: 2, colors: ['#5c5856', '#7a7470', '#3e3a3a'], alpha: 0.9 },
  embers: { count: 380, box: 36, boxH: 14, drop: 6, fall: 1.3, wind: 0.5, sway: 0.8, swayF: 0.8, size: 0.09, maxPx: 4, minPx: 2, colors: ['#ff8a2a', '#ffc04a', '#ff5a1a'], alpha: 1.0, glow: true },
  motes: { count: 900, box: 32, boxH: 10, drop: 3, fall: 0.12, wind: 0.15, sway: 0.5, swayF: 0.25, size: 0.07, maxPx: 3, minPx: 2, colors: ['#e8f0e0', '#d8e4d0'], alpha: 0.45 },
  steam: { count: 800, box: 32, boxH: 14, drop: 4, fall: 0.9, wind: 0.4, sway: 0.6, swayF: 0.4, size: 0.18, maxPx: 6, minPx: 2, colors: ['#f2f4f4', '#e2e8ea'], alpha: 0.3 },
};

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uAmount;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform vec2 uSway;
uniform float uSize;
uniform float uMaxPx;
uniform float uViewH;
uniform float uMinPx;
varying float vSeed;
varying float vFade;
void main() {
  vSeed = aSeed.w;
  vec3 lo = uCenter - uBox * 0.5;
  float ph = aSeed.w * 6.2831;
  vec3 p = aSeed.xyz * uBox + uOffset
         + vec3(sin(uTime * uSway.y + ph), sin(uTime * uSway.y * 0.7 + ph * 1.7) * 0.4, cos(uTime * uSway.y * 0.83 + ph)) * uSway.x;
  p = lo + mod(p - lo, uBox);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  // borda da caixa e rente à câmera: somem suave (sem estalar ao dobrar)
  vec3 r = abs(p - uCenter) / (uBox * 0.5);
  vFade = (1.0 - smoothstep(0.7, 1.0, max(r.x, max(r.y, r.z)))) * smoothstep(0.5, 1.2, depth);
  // só os sorteados pela quantidade do bioma
  if (fract(aSeed.w * 7.31 + aSeed.x * 3.7) >= uAmount || vFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  // tamanho em pixels inteiros (pixel art)
  float px = uSize * projectionMatrix[1][1] * uViewH * 0.5 / max(depth, 0.1);
  gl_PointSize = clamp(floor(px + 0.5), uMinPx, uMaxPx);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uCol0;
uniform vec3 uCol1;
uniform vec3 uCol2;
uniform vec3 uCol3;
uniform float uAlpha;
uniform float uLight;
uniform float uGlow;
uniform float uTime;
varying float vSeed;
varying float vFade;
void main() {
  float k = fract(vSeed * 13.7);
  vec3 c = k < 0.25 ? uCol0 : k < 0.5 ? uCol1 : k < 0.75 ? uCol2 : uCol3;
  float a = uAlpha * vFade;
  if (uGlow > 0.5) {
    // piscar: acende e apaga devagar, cada um no seu ritmo
    float b = sin(uTime * (0.9 + fract(vSeed * 5.3) * 1.4) + vSeed * 40.0);
    a *= smoothstep(0.1, 0.8, b);
  } else {
    c *= uLight;
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(c, a);
}
`;

export class BiomeParticles {
  private systems = new Map<ParticleKind, { points: THREE.Points; mat: THREE.ShaderMaterial; def: KindDef; off: THREE.Vector3 }>();
  private time = 0;

  constructor(scene: THREE.Scene) {
    let seed = 1234567;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const kind of PARTICLE_KINDS) {
      const def = KINDS[kind];
      const seeds = new Float32Array(def.count * 4);
      for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      // posição não é usada (vem da semente), mas o three.js precisa dela para a contagem
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(def.count * 3), 3));
      const cols = [0, 1, 2, 3].map((i) => new THREE.Color(def.colors[i % def.colors.length]));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uAmount: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(def.box, def.boxH, def.box) },
          uOffset: { value: new THREE.Vector3() },
          uSway: { value: new THREE.Vector2(def.sway, def.swayF) },
          uSize: { value: def.size }, uMaxPx: { value: def.maxPx }, uMinPx: { value: def.minPx ?? (def.glow ? 2 : 1) }, uViewH: { value: 1000 },
          uCol0: { value: cols[0] }, uCol1: { value: cols[1] }, uCol2: { value: cols[2] }, uCol3: { value: cols[3] },
          uAlpha: { value: def.alpha }, uLight: { value: 1 }, uGlow: { value: def.glow ? 1 : 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        // as comuns escrevem no depth (a água desenhada depois não passa por cima delas); as que
        // brilham (somadas) não precisam
        depthWrite: !def.glow,
        blending: def.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const points = new THREE.Points(geo, mat);
      points.name = 'biomeParticles:' + kind;
      points.frustumCulled = false;
      points.visible = false;
      points.renderOrder = 5;
      scene.add(points);
      this.systems.set(kind, { points, mat, def, off: new THREE.Vector3() });
    }
  }

  public update(dt: number, camera: THREE.Camera, amounts: Record<ParticleKind, number>, nearMode: number, viewH: number, wind: Wind): void {
    this.time += dt;
    // a fase do tempo é dobrada para não perder precisão no float da GPU depois de horas
    const t = this.time % 3600;
    const sunY = AERIAL.uFogSunDir.value.y;
    const night = 1 - THREE.MathUtils.smoothstep(sunY, -0.05, 0.25);
    const light = THREE.MathUtils.clamp(sunY * 2.0 + 0.35, 0.18, 1.0);
    for (const [, s] of this.systems) {
      // deslocamento acumulado (mesmo invisível, para não pular ao reaparecer), dobrado na caixa
      const d = s.def, o = s.off, w = d.wind * wind.strength;
      o.x = (o.x + wind.x * w * dt) % d.box;
      o.y = (o.y + d.fall * dt) % d.boxH;
      o.z = (o.z + wind.z * w * dt) % d.box;
      const kind = s.points.name.split(':')[1] as ParticleKind;
      let amt = (amounts[kind] ?? 0) * nearMode;
      if (s.def.night === 1) amt *= night;
      else if (s.def.night === -1) amt *= 1 - night * 0.8;
      s.points.visible = amt > 0.01;
      if (!s.points.visible) continue;
      const u = s.mat.uniforms;
      u.uAmount.value = Math.min(1, amt);
      u.uTime.value = t;
      u.uOffset.value.copy(s.off);
      u.uViewH.value = viewH;
      u.uLight.value = light;
      u.uCenter.value.set(camera.position.x, camera.position.y - s.def.drop + s.def.boxH * 0.5, camera.position.z);
    }
  }
}
