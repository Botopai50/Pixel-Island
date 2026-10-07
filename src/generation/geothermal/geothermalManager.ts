import * as THREE from 'three';
import { GeothermalGenerator, ThermalSpring, ThermalVent } from './geothermalGenerator.ts';
import { WIND_U } from '../../atmosphere/wind.ts';
import { AERIAL } from '../../atmosphere/atmosphericFog.ts';

/**
 * Fontes termais: poças, vapor e gêiseres. A água das poças é a MESMA da água do mundo (waterShader.ts,
 * com uThermal = 1: paleta turquesa, anéis de convecção e bolhas), desenhada no passe de água com a
 * profundidade da cena (espuma de contato, faixas de profundidade, sombras). O vapor é de pixels
 * inteiros com dither. Os anéis minerais em volta das poças são pintados no chão pelo shader do
 * terreno (terrainShader.ts), a partir de THERMAL.uSpr.
 */
export const MAX_SPRINGS = 4;
export const MAX_VENTS = 10;

/**
 * Posição e raio das fontes (x, z, raio, 0), para o shader do terreno pintar os anéis minerais em
 * volta de cada poça. Compartilhado por referência (terrainShader.ts liga o mesmo objeto).
 */
export const THERMAL = {
  uSpr: { value: Array.from({ length: MAX_SPRINGS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  /** fumarolas e poças de lama: x, z, raio, tipo (0 = fumarola, 1 = lama) */
  uVent: { value: Array.from({ length: MAX_VENTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
};

/**
 * Vapor e jato: cada partícula é uma NUVEM de pixel art (não um quadrado): o fragment desenha uma
 * bolha irregular feita de três círculos, numa grade de "pixels de arte" de 3 pixels da tela, com
 * 3 tons (luz de cima à esquerda, tom médio e sombra embaixo), uma linha escura no pé e bordas
 * recortadas. Nasce pequena, cresce, escurece de leve e se desmancha por dither (por pixel de arte).
 * aLife = idade (0-1; > 1 apagada, calculada na CPU) e aSeed = formato próprio de cada nuvem.
 */
export const PUFF_VERT = /* glsl */ `
attribute float aLife;
attribute float aSeed;
uniform float uSize;
uniform float uMaxPx;
uniform float uViewH;
varying float vLife;
varying float vSeed;
varying float vPx;
void main() {
  vLife = aLife;
  vSeed = aSeed;
  if (aLife > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vPx = 0.0; return; }
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  // nasce pequena e vai abrindo; sempre múltiplo de 3 pixels (o pixel de arte da nuvem)
  // câmera em perspectiva: o tamanho cai com a distância; na ortográfica (visão aérea) é fixo, em pixels por metro
  float persp = projectionMatrix[3][3] > 0.5 ? 2.6 : 1.0 / max(depth, 0.1);
  float px = uSize * (0.35 + vLife * 2.4) * projectionMatrix[1][1] * uViewH * 0.5 * persp;
  gl_PointSize = clamp(floor(px / 3.0 + 0.5) * 3.0, 6.0, uMaxPx);
  vPx = gl_PointSize;
}
`;

export const PUFF_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uAlpha;
uniform float uDim;
varying float vLife;
varying float vSeed;
varying float vPx;
float bayer(vec2 p) {
  vec2 f = mod(floor(p), 4.0);
  float m = f.y < 0.5 ? (f.x < 0.5 ? 0.0 : f.x < 1.5 ? 8.0 : f.x < 2.5 ? 2.0 : 10.0)
          : f.y < 1.5 ? (f.x < 0.5 ? 12.0 : f.x < 1.5 ? 4.0 : f.x < 2.5 ? 14.0 : 6.0)
          : f.y < 2.5 ? (f.x < 0.5 ? 3.0 : f.x < 1.5 ? 11.0 : f.x < 2.5 ? 1.0 : 9.0)
          : (f.x < 0.5 ? 15.0 : f.x < 1.5 ? 7.0 : f.x < 2.5 ? 13.0 : 5.0);
  return (m + 0.5) / 16.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sd(vec2 p, vec2 c, float r) { return length(p - c) - r; }
void main() {
  // grade de pixels de arte: 1 pixel de arte = 3 pixels da tela
  float n = max(floor(vPx / 3.0 + 0.5), 2.0);
  vec2 cell = floor(gl_PointCoord * n);
  vec2 p = (cell + 0.5) / n - 0.5;                    // -0.5..0.5, y para baixo
  float s1 = fract(vSeed * 7.13) * 2.0 - 1.0, s2 = fract(vSeed * 13.7) * 2.0 - 1.0, s3 = fract(vSeed * 3.9) * 2.0 - 1.0;
  // some de dentro para fora: a nuvem encolhe no fim da vida
  float k = 1.0 - 0.5 * smoothstep(0.5, 1.0, vLife);
  // três círculos (o maior no meio): a silhueta de uma nuvem
  float d = min(sd(p, vec2(0.0, 0.03), 0.27 * k),
            min(sd(p, vec2(0.17 * s1, -0.10 + 0.05 * s2), 0.19 * k),
                sd(p, vec2(-0.16 * s2, 0.12 * s3 + 0.02), 0.17 * k)));
  // borda recortada, pixel a pixel
  d += (hash(cell + vSeed * 31.7) - 0.5) * 0.05;
  if (d > 0.0) discard;
  // entra aos poucos e se desmancha no fim, por dither em pixels de arte
  float a = uAlpha * smoothstep(0.0, 0.2, vLife) * (1.0 - smoothstep(0.62, 1.0, vLife));
  if (a < bayer(cell)) discard;
  // tons: luz de cima à esquerda, tom médio e sombra embaixo à direita
  float lit = dot(p, normalize(vec2(-0.55, -0.83))) / 0.3 - d * 2.2;
  vec3 light = uColA;
  vec3 mid = uColA * vec3(0.87, 0.91, 0.93);
  vec3 shade = uColA * vec3(0.68, 0.76, 0.82);
  vec3 col = lit > 0.35 ? light : lit > -0.30 ? mid : shade;
  // linha escura no pé da nuvem (a borda de baixo)
  if (d > -0.045 && lit < -0.45) col = shade * vec3(0.86, 0.9, 0.95);
  // ao envelhecer a fumaça esfria e escurece de leve
  col = mix(col, col * uColB, smoothstep(0.1, 1.0, vLife) * 0.8);
  // noite: a fumaça não acende sozinha, fica um cinza-azulado escuro (luar)
  col *= mix(vec3(0.20, 0.27, 0.42), vec3(1.0), uDim);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** O que o ambiente termal faz com o personagem neste quadro (geothermalManager.interact). */
export interface ThermalEffects {
  /** lentidão: 1 normal, < 1 na lama e na água quente */
  speedMul: number;
  /** vapor no rosto, 0-1 (a névoa branca por cima da tela) */
  haze: number;
  /** empurrão horizontal (m/s²) de uma baforada de fumarola */
  pushX: number; pushZ: number;
  /** impulso vertical (m/s) do gêiser; 0 = nenhum */
  launch: number;
  /** pede uma ondulação na água sob os pés */
  ripple: boolean;
  /** piso mínimo (m) dentro de uma poça: o personagem boia na superfície; -1e9 = sem piso */
  floorY: number;
}

/**
 * Gotas do jato de água do gêiser: cada uma é uma GOTA de pixel art, alongada no sentido em que
 * voa (a velocidade projetada na tela), com a cabeça redonda na frente e a cauda fina atrás, em 3
 * tons de azul (cauda funda, corpo, cabeça clara) e um pixel de brilho. Desenhada numa grade de
 * pixels de arte de 2 pixels da tela. O voo em arco é na CPU (updateDrops).
 */
const DROP_VERT = /* glsl */ `
attribute float aLife;
attribute float aSeed;
attribute vec3 velocity;
uniform float uSize;
uniform float uMaxPx;
uniform float uViewH;
uniform float uAspect;
varying float vSeed;
varying float vPx;
varying vec2 vDir;
void main() {
  vSeed = aSeed;
  vDir = vec2(0.0, -1.0);
  if (aLife > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vPx = 0.0; return; }
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vec4 c1 = projectionMatrix * mv;
  gl_Position = c1;
  // sentido do voo na tela (em coordenadas do ponto: y para baixo)
  vec4 c2 = projectionMatrix * viewMatrix * (wp + vec4(velocity * 0.05, 0.0));
  vec2 d = c2.xy / c2.w - c1.xy / c1.w;
  d.x *= uAspect;
  if (length(d) > 1e-6) vDir = normalize(vec2(d.x, -d.y));
  float depth = -mv.z;
  float persp = projectionMatrix[3][3] > 0.5 ? 2.6 : 1.0 / max(depth, 0.1);
  float px = uSize * (0.75 + 0.5 * aSeed) * projectionMatrix[1][1] * uViewH * 0.5 * persp;
  // a caixa é maior que a gota (ela fica alongada, de qualquer ângulo), em múltiplos de 2 pixels
  gl_PointSize = clamp(floor(px * 1.7 / 2.0 + 0.5) * 2.0, 6.0, uMaxPx);
  vPx = gl_PointSize;
}
`;

const DROP_FRAG = /* glsl */ `
uniform float uDim;
varying float vSeed;
varying float vPx;
varying vec2 vDir;
void main() {
  // grade de pixels de arte (2 pixels da tela)
  float n = max(floor(vPx / 2.0), 3.0);
  vec2 p = (floor(gl_PointCoord * n) + 0.5) / n - 0.5;
  vec2 a = normalize(vDir);
  vec2 b = vec2(-a.y, a.x);
  float u = dot(p, a) * 1.6;     // -0.8..0.8: ao longo do voo (cabeça em +u)
  float v = dot(p, b) * 1.6;
  // gota: cabeça redonda à frente e cauda fina atrás
  float w = u > 0.18 ? 0.30 * sqrt(max(0.0, 1.0 - pow((u - 0.18) / 0.42, 2.0)))
                     : 0.30 * clamp((u + 0.6) / 0.78, 0.0, 1.0);
  if (abs(v) > w || u < -0.62 || u > 0.62) discard;
  // 3 tons: cauda funda, corpo, cabeça clara
  vec3 col = u < -0.12 ? vec3(0.20, 0.58, 0.84) : u < 0.22 ? vec3(0.42, 0.80, 0.95) : vec3(0.74, 0.96, 1.0);
  // pixel de brilho no lado de cima da cabeça
  if (v < -w * 0.35 && u > 0.05 && u < 0.34) col = vec3(1.0);
  col *= mix(vec3(0.20, 0.27, 0.42), vec3(1.0), uDim);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class GeothermalManager {
  private generator: GeothermalGenerator;
  private springs: ThermalSpring[] = [];
  private group: THREE.Group;
  private geyserParticles: THREE.Points[] = [];
  private steamParticles: THREE.Points[] = [];
  private ventParticles: THREE.Points[] = [];
  private dropParticles: THREE.Points[] = [];
  private dropMats: THREE.ShaderMaterial[] = [];
  /** Chamado quando uma gota cai na poça (worldEngine liga às ondulações da água). */
  public onSplash: ((x: number, z: number) => void) | null = null;
  private fx: ThermalEffects = { speedMul: 1, haze: 0, pushX: 0, pushZ: 0, launch: 0, ripple: false, floorY: -1e9 };
  private launchCool = 0;
  private rippleT = 0;
  private poolMeshes: THREE.Mesh[] = [];
  private waterGroup: THREE.Group | null = null;
  private waterMat: THREE.Material | null = null;
  private elapsedTime: number = 0;
  private viewH = 540;
  private puffMats: THREE.ShaderMaterial[] = [];

  constructor(scene: THREE.Scene, geothermalGen: GeothermalGenerator) {
    this.generator = geothermalGen;
    this.springs = this.generator.getSprings();
    this.group = new THREE.Group();
    this.group.name = 'geothermal_features';
    scene.add(this.group);
    this.buildGeysersAndSteam();
    this.buildVentSteam();
    this.syncUniforms();
  }

  /** Liga as poças ao grupo e ao material de água do mundo (worldEngine.ts). */
  public attachWater(group: THREE.Group, material: THREE.Material): void {
    this.waterGroup = group;
    this.waterMat = material;
    this.buildPoolWaterMeshes();
  }

  public reseed(seed: number): void {
    this.generator.reseed(seed);
    this.springs = this.generator.getSprings();
    this.rebuildAll();
  }

  /** Altura (px) da imagem da cena, para o tamanho dos pixels do vapor. */
  public setView(viewH: number): void {
    this.viewH = viewH;
  }

  private syncUniforms(): void {
    const arr = THERMAL.uSpr.value;
    for (let i = 0; i < MAX_SPRINGS; i++) {
      const s = this.springs[i];
      if (s) arr[i].set(s.x, s.z, s.radius, 0); else arr[i].set(0, 0, 0, 0);
    }
    const va = THERMAL.uVent.value;
    const vents = this.generator.getVents();
    for (let i = 0; i < MAX_VENTS; i++) {
      const v = vents[i];
      if (v) va[i].set(v.x, v.z, v.radius, v.kind === 'mudpot' ? 1 : 0); else va[i].set(0, 0, 0, 0);
    }
  }

  private rebuildAll(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    for (const m of this.puffMats) m.dispose();
    this.puffMats = [];
    for (const dm of this.dropMats) dm.dispose();
    this.dropMats = [];
    this.dropParticles = [];
    this.clearPools();
    this.geyserParticles = [];
    this.steamParticles = [];
    this.ventParticles = [];
    this.buildPoolWaterMeshes();
    this.buildGeysersAndSteam();
    this.buildVentSteam();
    this.syncUniforms();
  }

  private clearPools(): void {
    for (const mesh of this.poolMeshes) {
      this.waterGroup?.remove(mesh);
      mesh.geometry.dispose();
    }
    this.poolMeshes = [];
  }

  private buildPoolWaterMeshes(): void {
    if (!this.waterGroup || !this.waterMat) return;
    for (const spring of this.springs) {
      // Disco de água (um pouco maior que a bacia: a borda some sob o terreno). Como a água do
      // mundo, é um plano XY girado -90° em X (o shader da água espera isso).
      const geo = new THREE.CircleGeometry(spring.radius * 1.02, 64);
      // centro e raio, para o shader da água medir a distância ao centro na grade de pixels
      const pool = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < pool.length; i += 3) { pool[i] = spring.x; pool[i + 1] = spring.z; pool[i + 2] = spring.radius * 1.02; }
      geo.setAttribute('aPool', new THREE.BufferAttribute(pool, 3));
      const mesh = new THREE.Mesh(geo, this.waterMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(spring.x, spring.waterLevel, spring.z);
      mesh.renderOrder = 3;
      this.poolMeshes.push(mesh);
      this.waterGroup.add(mesh);
    }
  }

  private makePuffMaterial(size: number, maxPx: number, alpha: number, colA: string, colB: string): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: size },
        uMaxPx: { value: maxPx }, uViewH: { value: this.viewH }, uAlpha: { value: alpha }, uDim: { value: 1.0 },
        uColA: { value: new THREE.Color(colA) }, uColB: { value: new THREE.Color(colB) },
      },
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
    });
    this.puffMats.push(m);
    return m;
  }

  public query(x: number, z: number, currentElevation: number = 16.0) {
    return this.generator.query(x, z, currentElevation);
  }

  private buildGeysersAndSteam(): void {
    // 1. Vapor contínuo sobre todas as piscinas
    for (const spring of this.springs) {
      const steamCount = 28;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(steamCount * 3);
      const vel = new Float32Array(steamCount * 3);
      const lifeA = new Float32Array(steamCount);
      const seedA = new Float32Array(steamCount).map(() => Math.random());

      for (let i = 0; i < steamCount; i++) {
        const r = Math.random() * (spring.radius * 0.85);
        const theta = Math.random() * Math.PI * 2;
        pos[i * 3] = spring.x + Math.cos(theta) * r;
        pos[i * 3 + 1] = spring.waterLevel + Math.random() * 7.0;
        pos[i * 3 + 2] = spring.z + Math.sin(theta) * r;

        vel[i * 3] = (Math.random() - 0.5) * 0.8;
        vel[i * 3 + 1] = 0.8 + Math.random() * 1.2;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
        lifeA[i] = (pos[i * 3 + 1] - spring.waterLevel) / 8.0;
      }

      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('velocity', new THREE.BufferAttribute(vel, 3));
      geo.setAttribute('aLife', new THREE.BufferAttribute(lifeA, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 1));

      const steam = new THREE.Points(geo, this.makePuffMaterial(1.7, 90, 1.0, '#f4f9fb', '#d6e4ea'));
      steam.frustumCulled = false;
      (steam as any).__spring = spring;
      this.steamParticles.push(steam);
      this.group.add(steam);
    }

    // 2. Jatos eruptivos dos gêiseres: partículas com idade (nascem, sobem desacelerando e somem)
    for (const spring of this.springs) {
      if (!spring.isGeyser) continue;

      const count = 260;
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);
      const lifeA = new Float32Array(count).fill(2.0); // todas apagadas (idade > 1)
      const seedA = new Float32Array(count).map(() => Math.random());

      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
      geo.setAttribute('aLife', new THREE.BufferAttribute(lifeA, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 1));

      const p = new THREE.Points(geo, this.makePuffMaterial(1.5, 120, 1.0, '#f8fcfd', '#d2e2ea'));
      p.frustumCulled = false;
      (p as any).__spring = spring;
      (p as any).__age = new Float32Array(count).fill(99);
      (p as any).__span = new Float32Array(count).fill(1);
      (p as any).__acc = 0;
      this.geyserParticles.push(p);
      this.group.add(p);

      // jato de ÁGUA: gotas em arco, que voltam à poça
      const dropCount = 420;
      const dgeo = new THREE.BufferGeometry();
      dgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dropCount * 3), 3));
      dgeo.setAttribute('velocity', new THREE.BufferAttribute(new Float32Array(dropCount * 3), 3));
      dgeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(dropCount).fill(2.0), 1));
      dgeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(dropCount).map(() => Math.random()), 1));
      const dmat = new THREE.ShaderMaterial({
        uniforms: { uSize: { value: 0.6 }, uMaxPx: { value: 22 }, uViewH: { value: this.viewH }, uDim: { value: 1.0 }, uAspect: { value: 1.6 } },
        vertexShader: DROP_VERT,
        fragmentShader: DROP_FRAG,
      });
      this.dropMats.push(dmat);
      const dp = new THREE.Points(dgeo, dmat);
      dp.frustumCulled = false;
      (dp as any).__spring = spring;
      (dp as any).__alive = new Uint8Array(dropCount);
      (dp as any).__acc = 0;
      this.dropParticles.push(dp);
      this.group.add(dp);
    }
  }

  /** Atualiza as gotas do jato: nascem na base com velocidade para cima, caem com a gravidade e somem na poça. */
  private updateDrops(dt: number): void {
    for (const dp of this.dropParticles) {
      const spring: ThermalSpring = (dp as any).__spring;
      const alive: Uint8Array = (dp as any).__alive;
      const env = this.geyserEnvAt(spring);
      const power = this.geyserPowerAt(spring);
      const pos = dp.geometry.attributes.position as THREE.BufferAttribute;
      const vel = dp.geometry.attributes.velocity as THREE.BufferAttribute;
      const lifeA = dp.geometry.attributes.aLife as THREE.BufferAttribute;
      const count = pos.count;

      // só o jato forte (acima do fiapo de vapor) solta água
      const wet = Math.max(0, (env - 0.2) / 0.8);
      let acc: number = (dp as any).__acc + wet * 95 * power * dt;
      let scan = 0;
      while (acc >= 1 && scan < count) {
        if (!alive[scan]) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 0.6;
          pos.setXYZ(scan, spring.x + Math.cos(a) * r, spring.waterLevel + 0.1, spring.z + Math.sin(a) * r);
          const spread = 0.8 + 1.8 * wet * power * power;
          vel.setXYZ(scan, (Math.random() - 0.5) * spread, (10 + 8 * wet) * 1.15 * power * (0.75 + Math.random() * 0.5), (Math.random() - 0.5) * spread);
          alive[scan] = 1;
          lifeA.setX(scan, 0.0);
          acc -= 1;
        }
        scan++;
      }
      (dp as any).__acc = Math.min(acc, 4);

      for (let i = 0; i < count; i++) {
        if (!alive[i]) { lifeA.setX(i, 2.0); continue; }
        const vy = vel.getY(i) - 11.0 * dt;
        const x = pos.getX(i) + vel.getX(i) * dt, z = pos.getZ(i) + vel.getZ(i) * dt;
        const y = pos.getY(i) + vy * dt;
        vel.setY(i, vy);
        if (y < spring.waterLevel - 0.05) {
          // caiu na poça
          alive[i] = 0;
          lifeA.setX(i, 2.0);
          if (this.onSplash && Math.random() < 0.06) this.onSplash(x, z);
          continue;
        }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
      vel.needsUpdate = true;
      lifeA.needsUpdate = true;
    }
  }

  /** Vapor fino das fumarolas e da lama: o mesmo sistema de nuvens, em escala pequena. */
  private buildVentSteam(): void {
    const base = this.generator.getValley().baseElevation + 0.15;
    for (const v of this.generator.getVents()) {
      const count = v.kind === 'mudpot' ? 14 : 22;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('velocity', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(count).fill(2.0), 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(count).map(() => Math.random()), 1));
      const size = v.kind === 'mudpot' ? 0.55 : 0.7;
      const p = new THREE.Points(geo, this.makePuffMaterial(size, 56, 1.0, '#f2f6f6', '#cfdbdf'));
      p.frustumCulled = false;
      (p as any).__vent = v;
      (p as any).__base = base;
      (p as any).__age = new Float32Array(count).fill(99);
      (p as any).__span = new Float32Array(count).fill(1);
      (p as any).__acc = 0;
      this.ventParticles.push(p);
      this.group.add(p);
    }
  }

  /** Força do jato do gêiser agora (0-1): o fiapo antes da erupção, o pico no meio, a queda no fim. */
  /** Força da erupção deste ciclo: ~1 em cada 3 é um jatão (1.55x mais alto e mais longo). */
  private geyserPowerAt(spring: ThermalSpring): number {
    const idx = Math.floor(this.elapsedTime / spring.geyserInterval);
    const h = Math.sin(idx * 12.9898 + spring.x * 0.37 + spring.z * 0.11) * 43758.5453;
    return (h - Math.floor(h)) < 0.34 ? 1.4 : 1.0;
  }

  private geyserEnvAt(spring: ThermalSpring): number {
    const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const cycle = this.elapsedTime % spring.geyserInterval;
    // o jatão dura mais (sem passar do intervalo: sobra tempo até a próxima erupção)
    const dur = Math.min(spring.geyserDuration * (this.geyserPowerAt(spring) > 1 ? 1.35 : 1), spring.geyserInterval - 1.6);
    const erupt = cycle < dur ? sstep(0, dur * 0.4, cycle) * (1 - sstep(dur * 0.6, dur, cycle)) : 0;
    const pre = 0.16 * sstep(spring.geyserInterval - 1.5, spring.geyserInterval, cycle);
    return Math.max(erupt, pre);
  }

  /** Baforada da fumarola (0-1): a cada ~7s um sopro forte de ~1,4s. */
  public ventBurst(v: ThermalVent): number {
    if (v.kind !== 'fumarole') return 0;
    const period = 6.5 + (v.phase % 3);
    const ph = (this.elapsedTime + v.phase) % period;
    return ph < 1.4 ? Math.sin((ph / 1.4) * Math.PI) : 0;
  }

  /**
   * Efeitos do ambiente termal sobre o personagem (pés em x, y, z): a lama segura (devagar), a água
   * quente dá vapor no rosto e ondulações, a fumarola sopra uma baforada que empurra e esconde a
   * vista, e o gêiser em erupção lança para o alto quem está em cima dele.
   */
  public interact(dt: number, x: number, y: number, z: number): ThermalEffects {
    const fx = this.fx;
    fx.speedMul = 1; fx.haze = 0; fx.pushX = 0; fx.pushZ = 0; fx.launch = 0; fx.ripple = false; fx.floorY = -1e9;
    this.launchCool = Math.max(0, this.launchCool - dt);
    this.rippleT -= dt;

    for (const s of this.springs) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > s.radius * 1.6) continue;
      const n = d / s.radius;
      if (n < 0.97) fx.floorY = s.waterLevel - 0.3;
      if (n < 0.97 && y < s.waterLevel + 0.6) {
        // dentro da poça: água quente na canela (devagar), vapor e ondulações
        fx.speedMul = Math.min(fx.speedMul, 0.72);
        fx.haze = Math.max(fx.haze, 0.3);
        if (this.rippleT <= 0) { fx.ripple = true; this.rippleT = 0.45; }
      } else if (n < 1.3) {
        fx.haze = Math.max(fx.haze, 0.1);
      }
      if (s.isGeyser) {
        const env = this.geyserEnvAt(s);
        // em cima do jato, durante a erupção: lançado para o alto
        if (env > 0.55 && d < 2.6 && this.launchCool <= 0 && y < s.waterLevel + 1.5) {
          fx.launch = 15 * (this.geyserPowerAt(s) > 1 ? 1.5 : 1);
          this.launchCool = 4.5;
        }
        if (env > 0.3 && d < 6) fx.haze = Math.max(fx.haze, 0.5 * env * (1 - d / 6));
      }
    }

    for (const v of this.generator.getVents()) {
      const dx = x - v.x, dz = z - v.z;
      const d = Math.hypot(dx, dz);
      if (d > v.radius * 2.6) continue;
      if (v.kind === 'mudpot') {
        // dentro da lama: afunda e fica lento
        if (d < v.radius * 0.95) fx.speedMul = Math.min(fx.speedMul, 0.42);
      } else {
        const b = this.ventBurst(v);
        if (b > 0.05 && d < v.radius * 2.4) {
          // a baforada empurra para longe do buraco e enche a vista de vapor
          const k = (1 - d / (v.radius * 2.4)) * b;
          const inv = d > 0.01 ? 1 / d : 0;
          fx.pushX += dx * inv * 16 * k;
          fx.pushZ += dz * inv * 16 * k;
          fx.haze = Math.max(fx.haze, 0.75 * k);
        }
      }
    }
    return fx;
  }

  public update(dt: number): void {
    this.elapsedTime += dt;
    // claridade do dia pelo sol de verdade (a mesma conta da água)
    const dim = THREE.MathUtils.smoothstep(AERIAL.uFogSunDir.value.y, -0.2, 0.14);
    for (const m of this.puffMats) { m.uniforms.uViewH.value = this.viewH; m.uniforms.uDim.value = dim; }
    for (const m of this.dropMats) { m.uniforms.uViewH.value = this.viewH; m.uniforms.uDim.value = dim; m.uniforms.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight); }
    this.updateDrops(dt);

    this.updateVents(dt);

    // Atualiza vapor suave
    for (const s of this.steamParticles) {
      const spring: ThermalSpring = (s as any).__spring;
      const pos = s.geometry.attributes.position as THREE.BufferAttribute;
      const vel = s.geometry.attributes.velocity as THREE.BufferAttribute;
      const lifeA = s.geometry.attributes.aLife as THREE.BufferAttribute;
      const count = pos.count;

      for (let i = 0; i < count; i++) {
        let y = pos.getY(i) + vel.getY(i) * dt;
        let x = pos.getX(i) + vel.getX(i) * dt;
        let z = pos.getZ(i) + vel.getZ(i) * dt;

        if (y > spring.waterLevel + 8.0) {
          const r = Math.random() * (spring.radius * 0.85);
          const theta = Math.random() * Math.PI * 2;
          x = spring.x + Math.cos(theta) * r;
          y = spring.waterLevel + 0.2;
          z = spring.z + Math.sin(theta) * r;
        }

        pos.setXYZ(i, x, y, z);
        lifeA.setX(i, (y - spring.waterLevel) / 8.0);
      }
      pos.needsUpdate = true;
      lifeA.needsUpdate = true;
    }

    // Atualiza gêiseres: o jato sobe aos poucos (um fiapo de vapor antes, força plena no meio da
    // erupção) e cai devagar depois; as partículas que já saíram terminam a vida sozinhas
    for (const p of this.geyserParticles) {
      const spring: ThermalSpring = (p as any).__spring;
      const age: Float32Array = (p as any).__age;
      const span: Float32Array = (p as any).__span;
      const env = this.geyserEnvAt(spring);
      const power = this.geyserPowerAt(spring);

      const pos = p.geometry.attributes.position as THREE.BufferAttribute;
      const vel = p.geometry.attributes.velocity as THREE.BufferAttribute;
      const lifeA = p.geometry.attributes.aLife as THREE.BufferAttribute;
      const count = pos.count;

      // nascimentos
      let acc: number = (p as any).__acc + env * 110 * (power > 1 ? 1.4 : 1) * dt;
      let scan = 0;
      while (acc >= 1 && scan < count) {
        if (age[scan] >= span[scan]) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * (0.4 + 0.8 * env);
          pos.setXYZ(scan, spring.x + Math.cos(a) * r, spring.waterLevel + 0.1, spring.z + Math.sin(a) * r);
          const spread = 0.9 + 2.2 * env;
          vel.setXYZ(scan, (Math.random() - 0.5) * spread, (3.5 + 11 * env) * 1.15 * power * (0.75 + Math.random() * 0.5), (Math.random() - 0.5) * spread);
          age[scan] = 0;
          span[scan] = 1.8 + Math.random() * 1.4;
          acc -= 1;
        }
        scan++;
      }
      (p as any).__acc = Math.min(acc, 3);

      // movimento: sobe desacelerando, abre para os lados
      for (let i = 0; i < count; i++) {
        if (age[i] >= span[i]) { lifeA.setX(i, 2.0); continue; }
        age[i] += dt;
        const k = Math.exp(-0.5 * dt);
        const vy = vel.getY(i) - 3.5 * dt;
        const lf = age[i] / span[i];
        // turbulência: a fumaça abre para os lados enquanto sobe, e o vento a entorta com a idade
        const turb = (0.6 + 3.2 * lf) * dt;
        const wk = (0.3 + 1.6 * lf) * WIND_U.uWindStr.value;
        vel.setXYZ(i, vel.getX(i) * k + (Math.random() - 0.5) * turb * 4, vy, vel.getZ(i) * k + (Math.random() - 0.5) * turb * 4);
        pos.setXYZ(i,
          pos.getX(i) + (vel.getX(i) + WIND_U.uWindDir.value.x * wk) * dt,
          pos.getY(i) + vy * dt,
          pos.getZ(i) + (vel.getZ(i) + WIND_U.uWindDir.value.y * wk) * dt);
        lifeA.setX(i, age[i] >= span[i] ? 2.0 : age[i] / span[i]);
      }
      pos.needsUpdate = true;
      vel.needsUpdate = true;
      lifeA.needsUpdate = true;
    }
  }

  /** Atualiza o vapor dos respiradouros: fumarola solta um fio constante e pulsante; a lama, baforadas. */
  private updateVents(dt: number): void {
    const t = this.elapsedTime;
    for (const p of this.ventParticles) {
      const v: ThermalVent = (p as any).__vent;
      const base: number = (p as any).__base;
      const age: Float32Array = (p as any).__age;
      const span: Float32Array = (p as any).__span;
      const pos = p.geometry.attributes.position as THREE.BufferAttribute;
      const vel = p.geometry.attributes.velocity as THREE.BufferAttribute;
      const lifeA = p.geometry.attributes.aLife as THREE.BufferAttribute;
      const count = pos.count;
      const mud = v.kind === 'mudpot';
      const s = Math.sin(t * 0.8 + v.phase);
      const burst = this.ventBurst(v);
      const env = mud ? Math.pow(Math.max(0, s), 3) * 0.9 : Math.max(0.55 + 0.4 * Math.sin(t * 0.55 + v.phase), burst * 1.4);

      let acc: number = (p as any).__acc + env * (mud ? 6 : 9) * dt;
      let scan = 0;
      while (acc >= 1 && scan < count) {
        if (age[scan] >= span[scan]) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * v.radius * (mud ? 0.5 : 0.25);
          pos.setXYZ(scan, v.x + Math.cos(a) * r, base, v.z + Math.sin(a) * r);
          vel.setXYZ(scan, (Math.random() - 0.5) * (0.5 + burst * 2.5), (mud ? 1.4 : 2.6 + burst * 4) * (0.8 + Math.random() * 0.5), (Math.random() - 0.5) * (0.5 + burst * 2.5));
          age[scan] = 0;
          span[scan] = 1.6 + Math.random() * 1.4;
          acc -= 1;
        }
        scan++;
      }
      (p as any).__acc = Math.min(acc, 2);

      for (let i = 0; i < count; i++) {
        if (age[i] >= span[i]) { lifeA.setX(i, 2.0); continue; }
        age[i] += dt;
        const lf = age[i] / span[i];
        const wk = (0.2 + 1.2 * lf) * WIND_U.uWindStr.value;
        pos.setXYZ(i,
          pos.getX(i) + (vel.getX(i) + WIND_U.uWindDir.value.x * wk) * dt,
          pos.getY(i) + (vel.getY(i) - 0.4 * lf) * dt,
          pos.getZ(i) + (vel.getZ(i) + WIND_U.uWindDir.value.y * wk) * dt);
        lifeA.setX(i, age[i] >= span[i] ? 2.0 : lf);
      }
      pos.needsUpdate = true;
      lifeA.needsUpdate = true;
    }
  }

  public getSprings(): ThermalSpring[] {
    return this.springs;
  }
}
