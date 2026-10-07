import * as THREE from 'three';
import { AERIAL } from './atmosphericFog.ts';

/**
 * Splash ao cair na água: um estouro de gotas em pixel art (quadradinhos de pixels inteiros, em 3 tons
 * de azul e branco) que sobem em leque, caem de volta e somem ao tocar a água. As ondas do impacto
 * vêm da simulação da superfície (wakeSim.ts) e dos anéis da água.
 */
const MAX = 280;

const VERT = /* glsl */ `
attribute float aLife;
attribute float aSeed;
uniform float uViewH;
varying float vSeed;
void main() {
  vSeed = aSeed;
  if (aLife > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  float persp = projectionMatrix[3][3] > 0.5 ? 2.6 : 1.0 / max(depth, 0.1);
  // gotas pequenas, em pixels inteiros; encolhem no fim da vida
  float px = (0.12 + 0.1 * aSeed) * (1.0 - 0.45 * aLife) * projectionMatrix[1][1] * uViewH * 0.5 * persp;
  gl_PointSize = clamp(floor(px + 0.5), 3.0, 16.0);
}
`;

const FRAG = /* glsl */ `
uniform float uDim;
varying float vSeed;
void main() {
  vec3 col = vSeed < 0.35 ? vec3(0.42, 0.8, 0.95) : vSeed < 0.7 ? vec3(0.74, 0.94, 1.0) : vec3(1.0);
  // pixel de brilho no canto
  if (gl_PointCoord.x < 0.45 && gl_PointCoord.y < 0.45) col = mix(col, vec3(1.0), 0.6);
  col *= mix(vec3(0.20, 0.27, 0.42), vec3(1.0), uDim);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Coroa d'água do impacto (como a referência): uma parede de água em anel que sobe do ponto da queda,
 * com o topo recortado em pontas brancas, o corpo em degradê de azul (claro em cima, fundo embaixo),
 * a face de dentro mais escura e um colar de espuma branca na base; no meio, um jato mais estreito que
 * sobe um pouco depois. Desenhada em pixels (colunas em volta e linhas na altura, de ~10cm), cresce,
 * abre e afunda de volta, desfazendo-se por dither no fim.
 */
const CROWN_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const CROWN_FRAG = /* glsl */ `
uniform float uCols;
uniform float uPx;
uniform float uH;
uniform vec3 uCenter;
uniform float uFade;
uniform float uSeed;
uniform float uDim;
varying vec3 vWorld;
float h11(float p) { return fract(sin(p * 127.1 + uSeed * 31.7) * 43758.5453); }
float bayer(vec2 p) {
  vec2 f = mod(floor(p), 4.0);
  float m = f.y < 0.5 ? (f.x < 0.5 ? 0.0 : f.x < 1.5 ? 8.0 : f.x < 2.5 ? 2.0 : 10.0)
          : f.y < 1.5 ? (f.x < 0.5 ? 12.0 : f.x < 1.5 ? 4.0 : f.x < 2.5 ? 14.0 : 6.0)
          : f.y < 2.5 ? (f.x < 0.5 ? 3.0 : f.x < 1.5 ? 11.0 : f.x < 2.5 ? 1.0 : 9.0)
          : (f.x < 0.5 ? 15.0 : f.x < 1.5 ? 7.0 : f.x < 2.5 ? 13.0 : 5.0);
  return (m + 0.5) / 16.0;
}
void main() {
  // grade de pixels FIXA no mundo (não estica com a coroa crescendo): colunas pelo ângulo em volta do
  // centro (largura de um pixel no raio final) e linhas a cada uPx metros de altura
  vec3 d = vWorld - uCenter;
  float col = floor((atan(d.z, d.x) / 6.2831853 + 0.5) * uCols);
  float row = floor(d.y / uPx);
  float v = (row + 0.5) * uPx / max(uH, 0.001);
  // topo recortado: cada coluna tem a sua altura (pontas), com pontas mais altas de vez em quando
  float hc = 0.45 + 0.3 * h11(col) + 0.25 * step(0.72, h11(col + 50.0));
  if (v > hc) discard;
  // desfaz por dither no fim
  if (uFade < bayer(vec2(col, row) + vec2(3.0, 1.0))) discard;
  // corpo: degradê de azul (fundo embaixo, claro em cima), 3 faixas
  vec3 col3 = v < 0.33 ? vec3(0.10, 0.42, 0.78) : v < 0.62 ? vec3(0.22, 0.62, 0.92) : vec3(0.52, 0.84, 0.98);
  // veios verticais mais escuros em algumas colunas (volume)
  if (h11(col + 9.0) < 0.3 && v < hc - 0.2) col3 *= 0.82;
  // pontas brancas no topo e colar de espuma na base
  if (v > hc - 0.16) col3 = vec3(0.97, 0.99, 1.0);
  if (v < 0.12 && h11(col + 21.0) < 0.75) col3 = vec3(0.92, 0.97, 1.0);
  // face de dentro mais escura
  if (!gl_FrontFacing) col3 *= vec3(0.62, 0.72, 0.85);
  col3 *= mix(vec3(0.20, 0.27, 0.42), vec3(1.0), uDim);
  gl_FragColor = vec4(col3, 1.0);
}
`;

interface Crown { outer: THREE.Mesh; inner: THREE.Mesh; age: number; strength: number }

export class Splash {
  private points: THREE.Points;
  private pos: THREE.BufferAttribute;
  private life: THREE.BufferAttribute;
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX).fill(99);
  private span = new Float32Array(MAX).fill(1);
  private surf = new Float32Array(MAX);
  private next = 0;
  private mat: THREE.ShaderMaterial;
  private crowns: Crown[] = [];
  private scene: THREE.Scene;
  private crownGeo: THREE.CylinderGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // cilindro aberto com a base em y = 0 (escalado: x/z = raio, y = altura)
    this.crownGeo = new THREE.CylinderGeometry(1.3, 0.8, 1, 40, 1, true); // abre para cima, como a coroa
    this.crownGeo.translate(0, 0.5, 0);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.life = new THREE.BufferAttribute(new Float32Array(MAX).fill(2), 1);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aLife', this.life);
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(MAX).map(() => Math.random()), 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uViewH: { value: 540 }, uDim: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Estoura um splash em x, z na superfície surfY; strength 0-1 (pela velocidade da queda). */
  private makeCrownMesh(cols: number): THREE.Mesh {
    const m = new THREE.ShaderMaterial({
      uniforms: { uCols: { value: cols }, uPx: { value: 0.11 }, uH: { value: 0.01 }, uCenter: { value: new THREE.Vector3() }, uFade: { value: 1 }, uSeed: { value: Math.random() * 100 }, uDim: { value: 1 } },
      vertexShader: CROWN_VERT,
      fragmentShader: CROWN_FRAG,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.crownGeo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  public burst(x: number, surfY: number, z: number, strength: number): void {
    // coroa d'água (no máximo 3 ao mesmo tempo)
    if (this.crowns.length >= 3) {
      const old = this.crowns.shift()!;
      this.scene.remove(old.outer, old.inner);
      (old.outer.material as THREE.Material).dispose();
      (old.inner.material as THREE.Material).dispose();
    }
    // colunas com a largura de um pixel (~11cm) no raio final de cada parede
    // tudo escala com a força (altura da queda): k vai de ~0.45 (pulo) a ~1.9 (gêiser)
    const k = 0.35 + 1.55 * strength;
    const Rmax = (0.32 + 0.7) * k * 1.05;
    const outer = this.makeCrownMesh(Math.max(12, Math.round(2 * Math.PI * Rmax / 0.11)));
    const inner = this.makeCrownMesh(Math.max(8, Math.round(2 * Math.PI * (0.48 * k * 1.05) / 0.11)));
    outer.position.set(x, surfY - 0.05, z);
    inner.position.set(x, surfY - 0.05, z);
    outer.scale.set(0.001, 0.001, 0.001);
    inner.scale.set(0.001, 0.001, 0.001);
    this.scene.add(outer, inner);
    this.crowns.push({ outer, inner, age: 0, strength });

    const n = Math.round(45 + 90 * strength);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.35;
      this.pos.setXYZ(i, x + Math.cos(a) * r, surfY + 0.05, z + Math.sin(a) * r);
      const out = (0.8 + Math.random() * 2.2) * (0.6 + 0.6 * strength);
      const up = (2.5 + Math.random() * 3.5) * (0.6 + 0.7 * strength);
      this.vel[i * 3] = Math.cos(a) * out;
      this.vel[i * 3 + 1] = up;
      this.vel[i * 3 + 2] = Math.sin(a) * out;
      this.age[i] = 0;
      this.span[i] = 0.7 + Math.random() * 0.6;
      this.surf[i] = surfY;
    }
  }

  public update(dt: number, viewH: number): void {
    this.mat.uniforms.uViewH.value = viewH;
    const dim = THREE.MathUtils.smoothstep(AERIAL.uFogSunDir.value.y, -0.2, 0.14);
    this.mat.uniforms.uDim.value = dim;
    // coroas: a parede sobe rápido, abre e afunda; o jato do meio sobe um pouco depois
    const LIFE = 0.95;
    for (let k = this.crowns.length - 1; k >= 0; k--) {
      const cr = this.crowns[k];
      cr.age += dt;
      const t = cr.age / LIFE;
      if (t >= 1) {
        this.scene.remove(cr.outer, cr.inner);
        (cr.outer.material as THREE.Material).dispose();
        (cr.inner.material as THREE.Material).dispose();
        this.crowns.splice(k, 1);
        continue;
      }
      const s = cr.strength;
      const sk = 0.35 + 1.55 * s;
      const H = 0.95 * sk * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.6);
      const R = (0.32 + 0.7 * Math.sqrt(t)) * sk;
      cr.outer.scale.set(R, Math.max(H, 0.001), R);
      const ti = Math.max(0, (t - 0.12) / 0.88);
      const Hi = 1.3 * sk * Math.pow(Math.sin(Math.PI * ti), 0.8);
      const Ri = (0.34 + 0.14 * ti) * sk;
      cr.inner.scale.set(Ri, Math.max(Hi, 0.001), Ri);
      const fade = 1 - THREE.MathUtils.smoothstep(t, 0.6, 1.0);
      for (const mesh of [cr.outer, cr.inner]) {
        const u = (mesh.material as THREE.ShaderMaterial).uniforms;
        u.uFade.value = fade;
        u.uDim.value = dim;
        u.uH.value = mesh.scale.y;
        u.uCenter.value.copy(mesh.position);
      }
    }
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.span[i]) { this.life.setX(i, 2); continue; }
      this.age[i] += dt;
      this.vel[i * 3 + 1] -= 12 * dt;
      const x = this.pos.getX(i) + this.vel[i * 3] * dt;
      const y = this.pos.getY(i) + this.vel[i * 3 + 1] * dt;
      const z = this.pos.getZ(i) + this.vel[i * 3 + 2] * dt;
      // voltou para a água: some
      if (y < this.surf[i] && this.vel[i * 3 + 1] < 0) { this.age[i] = 99; this.life.setX(i, 2); continue; }
      this.pos.setXYZ(i, x, y, z);
      this.life.setX(i, Math.min(1, this.age[i] / this.span[i]));
    }
    this.pos.needsUpdate = true;
    this.life.needsUpdate = true;
  }
}
