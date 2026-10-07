import * as THREE from 'three';
import { AERIAL } from './atmosphericFog.ts';
import type { Wind } from './wind.ts';
import { RainSplashes, type GroundQuery } from './rainSplashes.ts';

/**
 * Chuva em pixel art: cada gota é um traço (a distância que ela cai em ~1/10s), inclinado pelo
 * vento do mundo (wind.ts), desenhado como os rastros de vento: numa grade de pixels grandes (cada
 * um acende inteiro), com a ponta forte e a cauda sumindo em degraus pontilhados. As gotas ficam presas ao mundo numa caixa em volta da câmera (mod) e caem rápido; tudo
 * animado na GPU. A quantidade visível vem do clima (0-1).
 */

const FALL = 13.0;
/**
 * Duas camadas: a de perto (caixa de 36m, o detalhe em volta do personagem) e a de longe (caixa de
 * 120m, mais rala): sem ela a chuva acabava a ~15m e parecia um cilindro preso ao personagem.
 */
const LAYERS = [
  { count: 800, box: 36, boxH: 22, drop: 6, alpha: 0.75 },
  { count: 1500, box: 120, boxH: 48, drop: 12, alpha: 0.6 },
];

const VERT = /* glsl */ `
attribute vec2 aCorner;   // x: 0 = cauda, 1 = ponta; y: lado
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform vec3 uVel;
uniform float uAmount;
uniform float uPix;
uniform vec2 uRes;
varying vec2 vA;
varying vec2 vB;
varying float vFade;
void main() {
  if (aSeed.w >= uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 lo = uCenter - uBox * 0.5;
  vec3 p = lo + mod(aSeed.xyz * uBox + uOffset - lo, uBox);
  // traço: a ponta é onde a gota está, a cauda fica para trás na direção de onde ela vem
  float len = 0.08 + aSeed.w * 0.05;
  vec3 pT = p - uVel * len;
  vec3 rr = abs(p - uCenter) / (uBox * 0.5);
  vFade = 1.0 - smoothstep(0.7, 1.0, max(rr.x, max(rr.y, rr.z)));
  vec4 c0 = projectionMatrix * viewMatrix * vec4(pT, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (c0.w <= 0.3 || c1.w <= 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 s0 = (c0.xy / c0.w * 0.5 + 0.5) * uRes;
  vec2 s1 = (c1.xy / c1.w * 0.5 + 0.5) * uRes;
  vA = s0; vB = s1;
  vec2 d = s1 - s0;
  vec2 u = length(d) > 1e-3 ? normalize(d) : vec2(0.0, -1.0);
  vec2 n = vec2(-u.y, u.x);
  vec2 s = (aCorner.x > 0.5 ? s1 + u * uPix : s0 - u * uPix) + n * aCorner.y * uPix;
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
varying float vFade;
void main() {
  vec2 cell = (floor(gl_FragCoord.xy / uPix) + 0.5) * uPix;
  vec2 ab = vB - vA;
  float t = clamp(dot(cell - vA, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  if (length(cell - (vA + ab * t)) > uPix * 0.5) discard;
  // como os rastros de vento: a ponta forte e a cauda sumindo em degraus com pontilhado
  // (Bayer 2x2 nos pixels grandes), sem degradê liso
  float a = smoothstep(0.0, 0.75, t) * uAlpha * vFade;
  vec2 cc = mod(floor(gl_FragCoord.xy / uPix), 2.0);
  float bay = (cc.x * 2.0 + cc.y * 3.0 - 4.0 * cc.x * cc.y) / 4.0;
  a = floor(a * 4.0 + bay) / 4.0;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class Rain {
  private layers: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; off: THREE.Vector3; box: number; boxH: number; drop: number }[] = [];
  public splashes: RainSplashes;

  constructor(scene: THREE.Scene) {
    let seed = 4242;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const L of LAYERS) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('aCorner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const seeds = new Float32Array(L.count * 4);
      for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      geo.instanceCount = L.count;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(L.box, L.boxH, L.box) },
          uOffset: { value: new THREE.Vector3() },
          uVel: { value: new THREE.Vector3(0, -FALL, 0) },
          uAmount: { value: 0 },
          uPix: { value: 4 },
          uRes: { value: new THREE.Vector2(800, 600) },
          uColor: { value: new THREE.Color(0.75, 0.82, 0.9) },
          uAlpha: { value: L.alpha },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        // escreve no depth: a água (desenhada depois, recortada pelo depth da cena) não passa por
        // cima dos pingos que estão na frente dela
        depthWrite: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'rain';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 7;
      scene.add(mesh);
      this.layers.push({ mesh, mat, off: new THREE.Vector3(), box: L.box, boxH: L.boxH, drop: L.drop });
    }
    this.splashes = new RainSplashes(scene);
  }

  /** amount: intensidade da chuva (0-1), já com o modo de câmera aplicado */
  /** ground: altura do chão (ou da água) num ponto, para os respingos */
  public update(dt: number, camera: THREE.Camera, wind: Wind, amount: number, viewW: number, viewH: number, ground: GroundQuery): void {
    const pix = viewH > 700 ? 5 : 4;   // pixel grande da gota: 5 px em telas grandes, 4 px nas menores
    const sunY = AERIAL.uFogSunDir.value.y;
    const light = THREE.MathUtils.clamp(sunY * 2.0 + 0.35, 0.2, 1.0);
    const color = this.layers[0].mat.uniforms.uColor.value as THREE.Color;
    color.setRGB(0.72 * light, 0.8 * light, 0.88 * light);
    this.splashes.update(dt, camera, amount, ground, color, pix, viewH);
    // o vento empurra a chuva de lado (a mesma direção das partículas e dos rastros de vento)
    const push = 4.5 * wind.strength;
    const vx = wind.x * push, vz = wind.z * push;
    for (const L of this.layers) {
      L.mesh.visible = amount > 0.01;
      if (!L.mesh.visible) continue;
      L.off.x = (L.off.x + vx * dt) % L.box;
      L.off.y = (L.off.y - FALL * dt) % L.boxH;
      L.off.z = (L.off.z + vz * dt) % L.box;
      const u = L.mat.uniforms;
      u.uOffset.value.copy(L.off);
      u.uVel.value.set(vx, -FALL, vz);
      u.uAmount.value = Math.min(1, amount);
      u.uCenter.value.set(camera.position.x, camera.position.y + L.boxH * 0.5 - L.drop, camera.position.z);
      u.uRes.value.set(viewW, viewH);
      u.uPix.value = pix;
      u.uColor.value.copy(color);
    }
  }
}
