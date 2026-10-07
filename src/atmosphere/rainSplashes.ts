import * as THREE from 'three';

/**
 * Respingos da chuva no chão, em pixel art. A chuva cai na GPU sem saber onde está o chão, então os
 * respingos são à parte: a cada quadro alguns pontos do chão à frente da câmera (2-16m, dentro da
 * vista) são sorteados, na altura do terreno ou da superfície da água, e cada um vira um pixel de
 * impacto e 3-4 gotinhas que saltam para os lados e caem de volta (~0.4s). Cada gotinha é um
 * quadrado de pixels inteiros, com a mesma cor da chuva.
 */

const MAX = 90;            // respingos vivos ao mesmo tempo
const PARTS = 5;           // por respingo: 1 impacto + 4 gotinhas
const LIFE = 0.42;
const RATE = 70;           // respingos por segundo com a chuva no máximo

/** altura do chão (ou da água) num ponto e se ali é água */
export type GroundQuery = (x: number, z: number) => { y: number; water: boolean };

export class RainSplashes {
  private points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private alpha: Float32Array;
  private age = new Float32Array(MAX).fill(LIFE);
  private origin = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * PARTS * 3);
  private next = 0;
  private acc = 0;
  private _fwd = new THREE.Vector3();
  /** pingo caindo na água: um anelzinho na superfície (as ondulações da água, como ao clicar) */
  public onWaterHit: (x: number, z: number) => void = () => {};

  constructor(scene: THREE.Scene) {
    const n = MAX * PARTS;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.75, 0.82, 0.9) }, uPix: { value: 4 }, uViewH: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        uniform float uPix;
        uniform float uViewH;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          if (aAlpha <= 0.01) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          // ~6cm no mundo, em pixels inteiros, nunca menor que o pixel grande da chuva
          float px = 0.06 * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1);
          gl_PointSize = max(uPix, floor(px / uPix + 0.5) * uPix);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float a = floor(vA * 3.0 + 0.5) / 3.0;   // poucos degraus
          if (a <= 0.0) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.name = 'rainSplashes';
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.visible = false;
    scene.add(this.points);
  }

  public update(dt: number, camera: THREE.Camera, amount: number, ground: GroundQuery,
    color: THREE.Color, pix: number, viewH: number): void {
    const alive = this.age.some((a) => a < LIFE);
    this.points.visible = amount > 0.01 || alive;
    if (!this.points.visible) return;

    // novos respingos à frente da câmera
    this.acc += dt * RATE * amount;
    const fwd = camera.getWorldDirection(this._fwd);
    const baseAng = Math.atan2(fwd.z, fwd.x);
    while (this.acc >= 1) {
      this.acc -= 1;
      const i = this.next;
      this.next = (i + 1) % MAX;
      const ang = baseAng + (Math.random() - 0.5) * 1.9;
      const r = 2 + Math.sqrt(Math.random()) * 14;
      const x = camera.position.x + Math.cos(ang) * r;
      const z = camera.position.z + Math.sin(ang) * r;
      const gq = ground(x, z);
      const y = gq.y + 0.03;
      if (gq.water && Math.random() < 0.6) this.onWaterHit(x, z);
      this.origin[i * 3] = x; this.origin[i * 3 + 1] = y; this.origin[i * 3 + 2] = z;
      this.age[i] = 0;
      for (let k = 0; k < PARTS; k++) {
        const j = (i * PARTS + k) * 3;
        if (k === 0) { this.vel[j] = 0; this.vel[j + 1] = 0; this.vel[j + 2] = 0; continue; }
        const a = (k / (PARTS - 1)) * Math.PI * 2 + Math.random() * 1.2;
        const s = 0.7 + Math.random() * 0.8;
        this.vel[j] = Math.cos(a) * s;
        this.vel[j + 1] = 1.4 + Math.random() * 1.1;
        this.vel[j + 2] = Math.sin(a) * s;
      }
    }

    // anima: impacto some rápido; gotinhas em parábola
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] < LIFE) this.age[i] += dt;
      const t = Math.min(this.age[i], LIFE);
      const life = 1 - t / LIFE;
      for (let k = 0; k < PARTS; k++) {
        const p = i * PARTS + k, j = p * 3;
        if (this.age[i] >= LIFE) { this.alpha[p] = 0; continue; }
        this.pos[j] = this.origin[i * 3] + this.vel[j] * t;
        this.pos[j + 1] = Math.max(this.origin[i * 3 + 1], this.origin[i * 3 + 1] + this.vel[j + 1] * t - 4.9 * t * t);
        this.pos[j + 2] = this.origin[i * 3 + 2] + this.vel[j + 2] * t;
        this.alpha[p] = k === 0 ? Math.max(0, 1 - t / (LIFE * 0.5)) * 0.8 : life * 0.85;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uPix.value = pix;
    this.mat.uniforms.uViewH.value = viewH;
  }
}
