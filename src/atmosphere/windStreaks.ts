import * as THREE from 'three';
import { AERIAL } from './atmosphericFog.ts';
import type { Wind } from './wind.ts';

/**
 * Rastros de vento em pixel art: linhas finas e compridas que nascem, correm na direção do vento
 * (wind.ts) e somem, como o ar riscado numa ventania.
 *
 * Cada rastro é um quad instanciado, animado só na GPU: em cada ciclo de vida ele sorteia um ponto
 * de partida (preso ao mundo, dobrado numa caixa em volta da câmera), a cabeça avança na direção do
 * vento e a cauda vem atrás (cresce e depois encolhe). A linha é desenhada numa grade de pixels
 * grandes (2-3 px): cada pixel grande acende inteiro se a linha passa por ele, em degraus de
 * escada, e a transparência vai em poucos degraus da cauda à cabeça. Sempre acima da cabeça e na
 * horizontal (o vento corre paralelo ao chão). Mais ou menos metade termina enrolando num caracol
 * (espiral que sobe ou vai de lado), desenhado em pedaços de reta.
 */

const COUNT = 28;
const BOX = 70;
const BOX_H = 16;
/** pedaços de reta por rastro (a curva do caracol) */
const SEGS = 32;

const VERT = /* glsl */ `
attribute vec2 aCorner;   // x: 0 = início do pedaço, 1 = fim; y: lado (-1/1)
attribute float aSeg;     // índice do pedaço ao longo do rastro
attribute vec4 aSeed;
uniform float uTime;
uniform float uAmount;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uDir;
uniform float uPix;
uniform vec2 uRes;
varying vec2 vA;
varying vec2 vB;
varying vec2 vT;
varying vec2 vS;
varying vec2 vCurl;
varying float vLife;
varying float vFade;

float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

// caminho do rastro: reto na direção do vento e, nos que enrolam, termina numa espiral que vai
// fechando até o centro (raio cai de R a 0 ao longo de curlMax radianos)
vec3 dirW, axW, waveW;
float L0, R, curlMax, waveA, waveK, wavePh;
// ondulação da parte reta: sobe e desce (ou vai de lado) como uma onda; some perto do começo da
// espiral para emendar liso nela
vec3 waveAt(float s) {
  float env = smoothstep(0.0, 5.0, s) * (1.0 - smoothstep(L0 - 7.0, L0 - 1.0, s));
  return waveW * (waveA * env * sin(s * waveK + wavePh));
}
vec3 pathAt(vec3 base, float s) {
  if (s <= L0) return base + dirW * s + waveAt(s);
  // raio r(th) = R * (1 - th/T): o comprimento do arco é s = R * (th - th²/2T), invertido aqui
  // para a espiral andar com velocidade constante (o fim, apertado, não dispara)
  float T = curlMax;
  float q = clamp(1.0 - 2.0 * (s - L0) / (R * T), 0.0, 1.0);
  float th = T * (1.0 - sqrt(q));
  float rr = R * (1.0 - th / T);
  // centro fixo da espiral: ao lado da reta, na direção do eixo do laço
  vec3 C = base + dirW * L0 + axW * R;
  return C + dirW * (rr * sin(th)) - axW * (rr * cos(th));
}

void main() {
  float period = 2.8 + aSeed.y * 2.4;
  float cyc = uTime / period + aSeed.w * 7.0;
  float k = floor(cyc);
  float ph = fract(cyc);
  // nem todo rastro aparece em todo ciclo: a quantidade do bioma/vento escolhe quais
  float pick = h1(aSeed.xyz + k * 0.137);
  if (pick >= uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // ponto de partida deste ciclo, preso ao mundo e dobrado na caixa (toda acima da cabeça)
  vec3 r = vec3(h1(aSeed.xyz + k), h1(aSeed.zxy + k * 1.31), h1(aSeed.yzx + k * 0.71));
  vec3 lo = uCenter - uBox * 0.5;
  vec3 base = lo + mod(r * uBox * 13.0 - lo, uBox);

  // forma deste ciclo: ~metade enrola no fim; o laço sobe ou vai de lado (nunca para o chão)
  dirW = normalize(uDir + vec3(0.0, (aSeed.x - 0.5) * 0.06, 0.0));
  vec3 side = normalize(cross(dirW, vec3(0.0, 1.0, 0.0)));
  float ang = (h1(aSeed.yxz + k * 2.3) - 0.5) * 1.8;
  axW = normalize(vec3(0.0, 1.0, 0.0) * cos(ang) + side * sin(ang));
  bool curls = h1(aSeed.zyx + k * 3.7) < 0.55;
  L0 = 18.0 + aSeed.z * 16.0;
  // onda: só ~40% dos rastros ondulam, de leve (0.2-0.5m de altura, comprimento de 8-14m)
  waveW = normalize(axW + side * (h1(aSeed.wzy + k) - 0.5));
  waveA = h1(aSeed.wyz + k * 1.9) < 0.4 ? 0.2 + 0.3 * h1(aSeed.yzw + k) : 0.0;
  waveK = 6.2832 / (8.0 + 6.0 * h1(aSeed.zwx + k));
  wavePh = h1(aSeed.xwz + k) * 6.2832 - ph * 2.5;
  R = 0.8 + h1(aSeed.xzy + k) * 0.8;
  curlMax = curls ? 6.2832 * (1.5 + 0.7 * h1(aSeed.wxy + k)) : 0.0;
  float spiral = R * curlMax * 0.5;
  float dist = L0 + spiral;

  // cabeça corre na frente; a cauda nasce no início e alcança no fim
  float head = dist * smoothstep(0.0, 0.75, ph);
  // a cauda para no começo da espiral (ela fica inteira à vista enquanto some)
  float tail = (L0 + spiral * 0.15) * smoothstep(0.4, 1.0, ph);
  float t0 = aSeg / SEGS, t1 = (aSeg + 1.0) / SEGS;
  vec3 p0 = pathAt(base, mix(tail, head, t0));
  vec3 p1 = pathAt(base, mix(tail, head, t1));
  vT = vec2(t0, t1);
  vS = vec2(mix(tail, head, t0), mix(tail, head, t1));
  vCurl = vec2(L0, curls ? dist : 1e6);
  // vida: aparece rápido; os que enrolam começam a sumir assim que a cabeça entra na espiral e
  // somem por completo antes de chegar no centro; os retos somem no fim do ciclo
  float fadeIn = smoothstep(0.0, 0.08, ph);
  vLife = fadeIn * (curls ? 1.0 - smoothstep(L0, L0 + spiral * 0.85, head) : 1.0 - smoothstep(0.65, 1.0, ph));

  vec3 rr = abs(mix(p0, p1, 0.5) - uCenter) / (uBox * 0.5);
  vFade = 1.0 - smoothstep(0.65, 1.0, max(rr.x, max(rr.y, rr.z)));

  vec4 c0 = projectionMatrix * viewMatrix * vec4(p0, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(p1, 1.0);
  if (c0.w <= 0.05 || c1.w <= 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // pedaço na tela, em pixels (o fragmento desenha a linha em "pixels grandes")
  vec2 s0 = (c0.xy / c0.w * 0.5 + 0.5) * uRes;
  vec2 s1 = (c1.xy / c1.w * 0.5 + 0.5) * uRes;
  vA = s0; vB = s1;
  vec2 d = s1 - s0;
  vec2 u = length(d) > 1e-3 ? normalize(d) : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  // quad folgado em volta do pedaço (cobre os pixels grandes dos degraus e das pontas)
  vec2 s = (aCorner.x > 0.5 ? s1 + u * uPix * 1.5 : s0 - u * uPix * 1.5) + n * aCorner.y * uPix * 1.5;
  vec4 cc = aCorner.x > 0.5 ? c1 : c0;
  gl_Position = vec4((s / uRes * 2.0 - 1.0) * cc.w, cc.z, cc.w);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPix;
varying vec2 vA;
varying vec2 vB;
varying vec2 vT;
varying vec2 vS;
varying vec2 vCurl;
varying float vLife;
varying float vFade;
void main() {
  // pixel art: a tela vira uma grade de pixels grandes; um pixel grande acende inteiro se a
  // linha passa por ele (escada de degraus, como uma linha desenhada à mão em pixel)
  vec2 cell = (floor(gl_FragCoord.xy / uPix) + 0.5) * uPix;
  vec2 ab = vB - vA;
  float tRaw = dot(cell - vA, ab) / max(dot(ab, ab), 1e-4);
  // a emenda entre dois pedaços fica só com o pedaço seguinte (sem pixel mais forte dobrado)
  if (tRaw > 1.0 && vT.y < 0.999) discard;
  if (tRaw < 0.0 && vT.x > 0.001) discard;
  float t = clamp(tRaw, 0.0, 1.0);
  if (length(cell - (vA + ab * t)) > uPix * 0.5) discard;
  // mais forte na cabeça, some na cauda; nasce e morre suave no ciclo; em poucos degraus
  // gradiente nas duas pontas: a cauda nasce do nada e a cabeça afina (mais forte perto da cabeça)
  float u = mix(vT.x, vT.y, t);
  float taper = smoothstep(0.0, 0.4, u) * (1.0 - smoothstep(0.9, 1.0, u));
  // dentro da espiral vai apagando em direção ao centro
  float s = mix(vS.x, vS.y, t);
  float curl = 1.0 - 0.55 * smoothstep(vCurl.x, vCurl.y, s);
  float a = taper * curl * vLife * vFade;
  // gradiente em pixel art: degraus com pontilhado (Bayer 2x2 nos pixels grandes) entre eles
  vec2 cc = mod(floor(gl_FragCoord.xy / uPix), 2.0);
  float bay = (cc.x * 2.0 + cc.y * 3.0 - 4.0 * cc.x * cc.y) / 4.0;
  a = min(1.0, floor(a * 5.0 + bay + 0.3) / 4.0);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor, a * uAlpha);
}
`;

export class WindStreaks {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private time = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.InstancedBufferGeometry();
    // um quad (2 triângulos: início/fim x lado) por pedaço do rastro
    const corner: number[] = [], seg: number[] = [], index: number[] = [];
    for (let s = 0; s < SEGS; s++) {
      corner.push(0, -1, 1, -1, 1, 1, 0, 1);
      seg.push(s, s, s, s);
      const o = s * 4;
      index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
    geo.setAttribute('aSeg', new THREE.Float32BufferAttribute(seg, 1));
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(SEGS * 12).fill(0), 3));
    geo.setIndex(index);
    let seed = 99173;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const seeds = new Float32Array(COUNT * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = COUNT;

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAmount: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(BOX, BOX_H, BOX) },
        uDir: { value: new THREE.Vector3(1, 0, 0) },
        uPix: { value: 3 },
        uRes: { value: new THREE.Vector2(800, 600) },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uAlpha: { value: 1.0 },
      },
      defines: { SEGS: SEGS.toFixed(1) },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'windStreaks';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  /** amount: quanto o bioma tem de rastros (0-1); viewW/viewH: tamanho do alvo em pixels */
  public update(dt: number, camera: THREE.Camera, wind: Wind, amount: number, viewW: number, viewH: number): void {
    // mais rastros nas rajadas (relativo ao vento do bioma: no deserto venta menos, mas risca igual)
    const amt = Math.min(1, amount * (0.45 + 0.55 * wind.gust));
    this.mesh.visible = amt > 0.02;
    if (!this.mesh.visible) return;
    this.time += dt;
    const u = this.mat.uniforms;
    u.uTime.value = this.time % 3600;
    u.uAmount.value = amt;
    u.uDir.value.set(wind.x, 0, wind.z);
    // caixa toda acima da cabeça (de ~1.5m a ~17m acima dos olhos): nada sai do chão
    u.uCenter.value.set(camera.position.x, camera.position.y + BOX_H * 0.5 + 1.5, camera.position.z);
    u.uRes.value.set(viewW, viewH);
    // tamanho do pixel grande da linha: 2 px em telas pequenas, 3 px em telas grandes
    u.uPix.value = viewH > 700 ? 3 : 2;
    // cor clara do ar, apagada à noite
    const sunY = AERIAL.uFogSunDir.value.y;
    const light = THREE.MathUtils.clamp(sunY * 2.0 + 0.35, 0.15, 1.0);
    u.uColor.value.setRGB(light, light * 0.98, light * 0.93);
  }
}
