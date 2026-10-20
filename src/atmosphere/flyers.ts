import * as THREE from 'three';
import { AERIAL } from './atmosphericFog.ts';
import type { Wind } from './wind.ts';
import type { TerrainGenerator } from '../generation/terrain/terrainGenerator.ts';

/**
 * Borboletas e libélulas, em pixel art: sprites de 7x7 pixels de tela desenhados no shader (o gl_PointCoord vira uma grade de 7x7 células, cada célula
 * um pixel inteiro), com dois quadros de asa que alternam. Sempre de frente para a câmera e virados para onde andam (espelhados pelo lado).
 *
 * São poucos (dezenas) e andam na CPU: cada um tem um alvo que muda de tempos em tempos, uma altura sobre o chão e uma fase. A altura do chão de cada um
 * é relida aos poucos (um por quadro, em rodízio) e a quantidade ativa vem da mistura de biomas (biomeAmbience.ts), como nas partículas do ar.
 * Borboletas só de dia, em campos, florestas e selva; libélulas só de dia, sobre a água (rios, lagos, manguezal) e por perto dela.
 */
export const FLYER_KINDS = ['butterflies', 'dragonflies'] as const;
export type FlyerKind = typeof FLYER_KINDS[number];

/** Registro das flores (por chunk: x, y, z de cada uma). As borboletas só nascem perto delas. */
const flowerSpots = new Map<number, number[]>();
let flowerVersion = 0;
export function addFlowerSpot(owner: number, x: number, y: number, z: number): void {
  let l = flowerSpots.get(owner);
  if (!l) flowerSpots.set(owner, l = []);
  l.push(x, y, z);
  flowerVersion++;
}
export function removeFlowerSpots(owner: number): void { if (flowerSpots.delete(owner)) flowerVersion++; }

interface Flyer {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  tx: number; ty: number; tz: number;   // alvo atual
  ax: number; az: number;                 // âncora (libélula: a água onde fica)
  ground: number;                          // altura do chão (ou da água) sob ele
  retarget: number;                        // segundos até trocar de alvo
  phase: number; color: number; speed: number;
  alive: boolean; fade: number;
  /** borboleta: 0 bate as asas, 1 plana de asas abertas, 2 pousada; segundos que faltam no modo; passos de asa acumulados; lado para onde olha */
  mode: number; modeT: number; flap: number; side: number;
  /** segundos de fuga que faltam (assustada pelo jogador): voa para longe, rápido, batendo as asas depressa */
  scare: number;
  /** inclinação suavizada do desenho (rad) */
  rotS: number;
  /** inclinação para a frente/trás suavizada (vista de cima) */
  tiltS: number;
  /** vista: 0 de cima (vem ou vai na direção da câmera), 1 de lado (cruza a tela) */
  view: number;
  /** borboleta: o rumo (rad), quanto está virando (rad/s), para quanto vira e até quando */
  heading: number; turn: number; turnTarget: number; turnT: number;
}

/**
 * Quadros da borboleta no atlas: 0 asas abertas, 1 a meio, 2 quase fechadas (vistas de cima); 3, 4, 5 em voo de lado (asa em cima, a meio e embaixo).
 * Se ela cruza a tela, aparece de lado (3 4 5 4), olhando para onde voa e com o nariz inclinado pela subida; se vem ou vai na direção da câmera, de cima
 * (0 1 2 1), inclinada para o lado da curva. Pousada, fica quase sempre de asas fechadas e as abre e fecha devagar (como as borboletas ao sol).
 */
const FLAP_SEQ = [0, 1, 2, 1];
const SIDE_SEQ = [3, 4, 5, 4];
const REST_SEQ = [2, 2, 2, 1, 0, 0, 1];

const VERT = /* glsl */ `
attribute vec4 aState;   // x: quadro (borboleta) ou fase da asa (libélula), y: cor (0-3), z: lado (+1/-1), w: opacidade
attribute float aRot;    // giro do desenho na tela (rad, antihorário): inclinação da subida e da curva
attribute float aTilt;   // inclinação para a frente (+, a cabeça vai para longe da câmera) ou para trás (-), só na vista de cima
uniform float uSize;     // tamanho no mundo (m)
uniform float uViewH;
uniform float uMaxPx;
uniform float uGrid;     // células do desenho por lado (borboleta 19, libélula 7)
varying vec4 vState;
varying float vDepth;
varying float vRot;
varying float vTilt;
void main() {
  vRot = aRot;
  vTilt = aTilt;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  vState = aState;
  vDepth = depth;
  if (aState.w <= 0.01 || depth < 0.6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  // 1:1 COM O MUNDO: cada célula do desenho é um pixel do mundo (21,33 por metro, o mesmo do chão e da grama); a esta distância ele ocupa "cell" pixels de
  // tela, arredondado para inteiro (pixel art). Onde o pixel do mundo já é menor que um pixel de tela, ela some (de longe seria um borrão maior que o mundo).
  float cell = projectionMatrix[1][1] * uViewH * 0.5 / (depth * 21.3333);
  if (cell < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  // de perto o pixel é inteiro (pixel art nítido, 1:1); de longe (menos de 4 pixels de tela por pixel do mundo) o tamanho é contínuo: com degraus inteiros o
  // desenho dava um pulo de tamanho (e parecia teleportar) toda vez que a borboleta se afastava um pouco
  float cs = cell >= 4.0 ? floor(cell + 0.5) : cell;
  // ao surgir ou sumir (ao nascer ou ao se afastar demais) ela cresce ou encolhe em vez de aparecer de uma vez
  gl_PointSize = max(2.0, min(cs, uMaxPx) * uGrid * (0.35 + 0.65 * clamp(aState.w, 0.0, 1.0)));
}
`;

const FRAG = /* glsl */ `
uniform vec3 uCol[4];
uniform vec3 uBody;
uniform float uKind;     // 0 = borboleta, 1 = libélula
uniform float uTime;
uniform float uLight;
uniform sampler2D uSprite;   // borboleta: quadros x cores desenhados em pixel art (butterflyAtlas)
varying vec4 vState;
varying float vDepth;
varying float vRot;
varying float vTilt;
void main() {
  vec2 pc = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
  // inclinação para a frente ou para trás (vista de cima), como uma perspectiva leve: voando para longe da câmera a cabeça (o alto do desenho) fica mais estreita e
  // a cauda mais larga; voando para perto, o contrário. O desenho também se achata um pouco na vertical
  if (uKind < 0.5 && abs(vTilt) > 0.02) {
    float dy = pc.y - 0.5;
    pc.x = 0.5 + (pc.x - 0.5) / (1.0 + vTilt * dy * 2.0);
    pc.y = 0.5 + dy / cos(vTilt * 1.4);
    if (pc.x < 0.0 || pc.x >= 1.0 || pc.y < 0.0 || pc.y >= 1.0) discard;
  }
  // giro em passos de 22,5 graus (pixel art: poses nítidas, e não uma rotação suave que borra os pixels); o desenho gira em volta do centro
  if (uKind < 0.5 && abs(vRot) > 0.05) {
    float ang = floor(vRot / 0.3927 + 0.5) * 0.3927;
    vec2 d = pc - 0.5;
    float cs = cos(ang), sn = sin(ang);
    pc = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y) + 0.5;
    if (pc.x < 0.0 || pc.x >= 1.0 || pc.y < 0.0 || pc.y >= 1.0) discard;
  }
  if (vState.z < 0.0) pc.x = 1.0 - pc.x;
  ivec2 c = ivec2(floor(pc * 7.0));
  int x = c.x, y = c.y;            // y = 0 embaixo
  bool flap = sin(uTime * (uKind < 0.5 ? 17.0 : 52.0) + vState.x) > 0.0;
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uKind < 0.5) {
    // BORBOLETA: o desenho vem do atlas (8 quadros: 3 em voo de frente, 2 pousada de lado e 3 em voo de lado; uma linha por cor), em células de 22 x 22.
    vec2 q = clamp(floor(vec2(pc.x, 1.0 - pc.y) * 19.0), vec2(0.0), vec2(18.0));
    float frame = floor(vState.x + 0.5);        // o quadro vem da CPU (batida, planeio, pousada)
    vec4 t = texture2D(uSprite, (vec2(frame * 19.0 + q.x, vState.y * 19.0 + q.y) + 0.5) / vec2(114.0, 76.0));
    col = t.rgb; a = t.a;
  } else {
    // LIBÉLULA: corpo comprido na horizontal (cabeça à direita) e dois pares de asas finas e claras, que vibram.
    bool body = y == 3 && x >= 0 && x <= 6;
    bool head = y == 3 && x == 6;
    bool wing = (y == 4 || (y == 2 && flap)) && x >= 2 && x <= 4;
    bool wing2 = (y == 5 && !flap) && x >= 2 && x <= 3;
    vec3 wc = uCol[int(vState.y + 0.5)];
    if (head) { col = wc * 1.1; a = 1.0; }
    else if (body) { col = x >= 5 ? wc : (x <= 1 ? wc * 0.7 : wc * 0.85); a = 1.0; }
    else if (wing || wing2) { col = vec3(0.86, 0.95, 1.0); a = 0.75; }
  }
  a *= vState.w;
  if (a < 0.2) discard;
  gl_FragColor = vec4(col * uLight, 1.0);
}
`;

const BUTTERFLY_COLORS = ['#f6e24a', '#f2f2ea', '#f08a3a', '#7ec8f0'];

/**
 * A borboleta em pixel art, 11 x 11 células, vista de frente para a câmera. Três quadros, todos simétricos (as duas asas sempre aparecem): abertas, a meio e fechadas (finas, coladas ao corpo).
 * a antena, b corpo, o contorno da asa, w asa, l mancha clara da asa. Cada metade da asa é escrita à esquerda do corpo e espelhada.
 */
/**
 * A borboleta em pixel art, desenhada à mão (vista de cima, com a cabeça para cima), em 3 quadros: asas abertas, a meio e quase fechadas. Cada célula é UM pixel do
 * mundo (21,33 por metro, o mesmo do chão e da grama); a grade é de 19 x 19 células (a arte tem 19 x 13, com o corpo no meio e margem em cima e embaixo).
 * Cada letra é uma cor da paleta BUTTERFLY_PALETTE; o ponto é transparente.
 */
const BUTTERFLY_PALETTE = ['#2d1c13', '#fdb715', '#5e271b', '#fe8d0e', '#fcf2b2', '#fc6811', '#7d4a3b', '#9d3c15', '#140803'];
const BUTTERFLY_FRAMES: string[][] = [
  [
    '...aa..d...d..aa...',
    '.accca.a...a.accca.',
    'aceecc..a.a..cceeca',
    'acebdfa.a.a.afdbeca',
    'acbdddfa.g.afdddbca',
    '.cbddddfacafddddbc.',
    '.acbbddfcacfddbbca.',
    '..acccacagacaccaa..',
    '...abddfcgcfddba...',
    '..acbbdbacabdbbca..',
    '..acbeba.a.abebca..',
    '...acbc.....cbca...',
    '....aa.......aa....',
  ],
  [
    '....aa.d...d.aa....',
    '...accaa...aacca...',
    '..aceec.a.a.ceeca..',
    '..acebfaa.aafbeca..',
    '..acbbdf.g.fdbbca..',
    '...cbdddacadddbc...',
    '...acbddcacddbca...',
    '....accaagaacca....',
    '....abddcgcddba....',
    '....abedacadeba....',
    '....acbc...cbca....',
    '.....aa.....aa.....',
    '...................',
  ],
  [
    '....aa..d.d..aa....',
    '...acca.a.a.acca...',
    '...aeca.a.a.acea...',
    '....adfaa.aafda....',
    '....abfa.g.afba....',
    '.....adfacafda.....',
    '.....abfcacfba.....',
    '......acagaca......',
    '......afcgcfa......',
    '.....abdacadba.....',
    '.....aea.a.aea.....',
    '.....aca...aca.....',
    '......a.....a......',
  ],
  // DE LADO (olhando para a direita), em voo: asa em cima, a meio e embaixo. Cada quadro já está na célula de 19 x 19 inteira (sem a margem de 3 linhas); alinhados pelo corpo
  [
    '...................',
    '...................',
    '....aaa............',
    '...acccc.aa........',
    '...ceeccaaaa.......',
    '..acebddcaaa.......',
    '..acbdddfcha.......',
    '...abdddfahh..ad...',
    '...acbddfch..a.....',
    '....ahbdffc..i.....',
    '.....ichfhacg......',
    '....chffcaaca......',
    '...bbddffaga.......',
    '...cebddiga.c......',
    '...acbba.c..a......',
    '....aa...a.........',
    '...................',
    '...................',
    '...................',
  ],
  [
    '...................',
    '...................',
    '.......ac..........',
    '......cbcc.a.......',
    '......deecaaa......',
    '......bebdcaa......',
    '......bbddca.......',
    '......dbdfch.......',
    '......addfch..ad...',
    '......cfffc..a.....',
    '.......hfhacg......',
    '......cfcaaca......',
    '......fddaga.......',
    '......bebga.c......',
    '......cbac..a......',
    '......aa.a.........',
    '...................',
    '...................',
    '...................',
  ],
  [
    '...................',
    '...................',
    '...................',
    '...........cca.....',
    '..........cccaa....',
    '..........cecaa....',
    '..........bcaha....',
    '.........bbchh.....',
    '.........dda.......',
    '........dfch.ii....',
    '........fhacg..d...',
    '........caaca......',
    '.......dfaga.......',
    '......cbiga.c......',
    '......aeaa..a......',
    '.......a...........',
    '...................',
    '...................',
    '...................',
  ],
];
/** as quatro cores de borboleta: a original (laranja, desenhada à mão) e três variações girando o matiz da paleta (o escuro e o creme ficam) */
function butterflyColor(hex: string, variant: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (variant === 0 || hsl.s < 0.35 || hsl.l < 0.12) {
    // a variação branca desbota as cores vivas; escuros e cremes ficam
    if (variant === 3 && hsl.s >= 0.35 && hsl.l >= 0.12) c.setHSL(hsl.h, 0.05, Math.min(0.95, hsl.l * 1.25 + 0.12));
    return '#' + c.getHexString();
  }
  if (variant === 1) c.setHSL(hsl.h + 0.045, hsl.s, Math.min(0.9, hsl.l * 1.05));      // amarela
  else if (variant === 2) c.setHSL(hsl.h + 0.52, hsl.s, hsl.l);                       // azul
  else c.setHSL(hsl.h, 0.05, Math.min(0.95, hsl.l * 1.25 + 0.12));                    // branca
  return '#' + c.getHexString();
}
function butterflyAtlas(): THREE.CanvasTexture {
  const G = 19;
  const cv = document.createElement('canvas');
  cv.width = G * BUTTERFLY_FRAMES.length; cv.height = G * 4;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(cv.width, cv.height);
  const put = (x: number, y: number, hex: string) => {
    const c = new THREE.Color(hex).convertLinearToSRGB();
    const o = (y * cv.width + x) * 4;
    img.data[o] = Math.round(c.r * 255); img.data[o + 1] = Math.round(c.g * 255); img.data[o + 2] = Math.round(c.b * 255); img.data[o + 3] = 255;
  };
  for (let v = 0; v < 4; v++) {
    BUTTERFLY_FRAMES.forEach((rows, f) => {
      // a arte (13 linhas) fica no meio da célula quadrada de 19 (3 linhas de margem em cima e embaixo): o giro é em volta do corpo
      const top = rows.length === G ? 0 : 3;      // a arte de cima (13 linhas) leva 3 de margem; a de lado já vem na célula inteira
      rows.forEach((row, y) => {
        for (let x = 0; x < G; x++) {
          const ch = row[x];
          if (ch === '.' || ch === undefined) continue;
          put(f * G + x, v * G + top + y, butterflyColor(BUTTERFLY_PALETTE[ch.charCodeAt(0) - 97], v));
        }
      });
    });
  }
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  return t;
}
const DRAGONFLY_COLORS = ['#3ac8d8', '#4a78e0', '#d83a3a', '#5ad87a'];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

class FlyerSet {
  public readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private readonly flyers: Flyer[] = [];
  private readonly pos: Float32Array;
  private readonly state: Float32Array;
  private readonly rot: Float32Array;
  private readonly tilt: Float32Array;
  private groundCursor = 0;
  // flores perto da câmera (refeito a cada 1,5 s, ou quando o registro muda)
  private nearFlowers: number[] = [];
  private nearFlowersAt = -10;
  private nearFlowersVersion = -1;
  private nearFlowersX = 1e9;
  private nearFlowersZ = 1e9;

  constructor(scene: THREE.Scene, private readonly kind: FlyerKind, private readonly count: number) {
    this.pos = new Float32Array(count * 3);
    this.state = new Float32Array(count * 4);
    this.rot = new Float32Array(count);
    this.tilt = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.flyers.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0, tz: 0, ax: 0, az: 0, ground: 0, retarget: 0, phase: rnd(0, 6.28), color: Math.floor(rnd(0, 4)), speed: 1, alive: false, fade: 0, mode: 0, modeT: rnd(0.5, 2), flap: rnd(0, 4), side: 1, scare: 0, rotS: 0, tiltS: 0, view: 0, heading: rnd(0, 6.28), turn: 0, turnTarget: 0, turnT: 0 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aState', new THREE.BufferAttribute(this.state, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aTilt', new THREE.BufferAttribute(this.tilt, 1).setUsage(THREE.DynamicDrawUsage));
    const butterfly = kind === 'butterflies';
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: butterfly ? 0.55 : 0.26 }, uViewH: { value: 1000 }, uMaxPx: { value: butterfly ? 9 : 20 }, uGrid: { value: butterfly ? 19 : 7 }, uSprite: { value: butterfly ? butterflyAtlas() : null },
        uCol: { value: (butterfly ? BUTTERFLY_COLORS : DRAGONFLY_COLORS).map((c) => new THREE.Color(c)) },
        uBody: { value: new THREE.Color('#2a2420') }, uKind: { value: butterfly ? 0 : 1 }, uTime: { value: 0 }, uLight: { value: 1 },
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: false, depthWrite: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.name = 'flyers:' + kind;
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** Ponto por onde o bicho pode nascer: borboleta em qualquer chão seco; libélula só com água (ou o leito dela) por perto. */
  private refreshFlowers(cam: THREE.Vector3, time: number): void {
    this.nearFlowers = [];
    const R2 = 28 * 28;
    for (const l of flowerSpots.values()) {
      for (let i = 0; i < l.length; i += 3) {
        const dx = l[i] - cam.x, dz = l[i + 2] - cam.z;
        if (dx * dx + dz * dz < R2) this.nearFlowers.push(l[i], l[i + 1], l[i + 2]);
      }
    }
    this.nearFlowersAt = time; this.nearFlowersVersion = flowerVersion; this.nearFlowersX = cam.x; this.nearFlowersZ = cam.z;
  }

  private spawn(f: Flyer, cam: THREE.Vector3, tg: TerrainGenerator): boolean {
    if (this.kind === 'butterflies') {
      // só nasce perto de uma FLOR (a 5 m ou mais da câmera, para não aparecer no rosto do jogador); a âncora é a flor, e ela passeia em volta
      const n = this.nearFlowers.length / 3;
      if (n === 0) return false;
      for (let attempt = 0; attempt < 6; attempt++) {
        const k = Math.floor(Math.random() * n) * 3;
        const fx = this.nearFlowers[k], fy = this.nearFlowers[k + 1], fz = this.nearFlowers[k + 2];
        const dx = fx - cam.x, dz = fz - cam.z;
        if (dx * dx + dz * dz < 25) continue;
        f.x = f.ax = fx + rnd(-0.8, 0.8); f.z = f.az = fz + rnd(-0.8, 0.8);
        f.ground = fy;
        f.y = fy + rnd(0.6, 1.4);
        f.vx = f.vy = f.vz = 0;
        f.retarget = 0;
        f.speed = rnd(0.7, 1.3);
        f.color = Math.floor(rnd(0, 4));
        f.alive = true; f.fade = 0; f.mode = 0; f.modeT = rnd(0.8, 2.2); f.flap = rnd(0, 4); f.scare = 0; f.heading = rnd(0, 6.28); f.turn = 0; f.turnT = 0;
        return true;
      }
      return false;
    }
    for (let attempt = 0; attempt < (this.kind === 'dragonflies' ? 8 : 2); attempt++) {
      const a = rnd(0, 6.2832), d = rnd(5, 26);
      const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
      const p = tg.getPointFast(x, z);
      const water = p.isWater || p.waterSurfaceY > p.height;
      if (this.kind === 'dragonflies') {
        if (!water || p.waterSurfaceY < 0.3) continue;       // só água doce/rasa (o mar aberto não)
        f.ground = Math.max(p.height, p.waterSurfaceY);
      } else {
        if (water || p.height < 1.0) continue;
        f.ground = p.height;
      }
      f.x = f.ax = x; f.z = f.az = z;
      f.y = f.ground + rnd(0.6, 1.4);
      f.vx = f.vy = f.vz = 0;
      f.retarget = 0;
      f.speed = this.kind === 'dragonflies' ? rnd(2.2, 3.4) : rnd(0.7, 1.3);
      f.color = Math.floor(rnd(0, 4));
      f.alive = true; f.fade = 0; f.mode = 0; f.modeT = rnd(0.8, 2.2); f.flap = rnd(0, 4); f.scare = 0; f.heading = rnd(0, 6.28); f.turn = 0; f.turnT = 0;
      return true;
    }
    return false;
  }

  public update(dt: number, time: number, cam: THREE.Vector3, camRight: THREE.Vector3, amount: number, tg: TerrainGenerator, wind: Wind, light: number, viewH: number): void {
    if (this.kind === 'butterflies' && (this.nearFlowersVersion !== flowerVersion && time - this.nearFlowersAt > 1.0 || time - this.nearFlowersAt > 2.5 || time < this.nearFlowersAt || Math.hypot(cam.x - this.nearFlowersX, cam.z - this.nearFlowersZ) > 8)) this.refreshFlowers(cam, time);
    // quantas borboletas: a quantidade do bioma, e só se houver flores (poucas flores, poucas borboletas; nenhuma flor, nenhuma nova)
    const flowerK = this.kind === 'butterflies' ? Math.min(1, Math.max(0, (this.nearFlowers.length / 3 - 2) / 12)) : 1;
    const want = Math.round(this.count * Math.min(1, amount) * flowerK);
    let active = 0;
    // a altura do chão de um por quadro (rodízio)
    const gi = this.groundCursor = (this.groundCursor + 1) % this.count;
    const butterfly = this.kind === 'butterflies';
    for (let i = 0; i < this.count; i++) {
      const f = this.flyers[i];
      if (!f.alive) {
        if (active < want && Math.random() < dt * 1.5) this.spawn(f, cam, tg);
        if (!f.alive) { this.state[i * 4 + 3] = 0; continue; }
      }
      active++;
      // some devagar quando sobra (a quantidade caiu: outro bioma, noite) ou quando ficou longe demais
      const far = Math.hypot(f.x - cam.x, f.z - cam.z) > 38;
      const surplus = i >= want;
      f.fade = THREE.MathUtils.clamp(f.fade + (far || surplus ? -dt * 0.8 : dt * 0.8), 0, 1);
      if (f.fade <= 0 && (far || surplus)) { f.alive = false; this.state[i * 4 + 3] = 0; active--; continue; }
      if (i === gi) {
        const p = tg.getPointFast(f.x, f.z);
        f.ground = this.kind === 'dragonflies' ? Math.max(p.height, p.waterSurfaceY) : p.height;
      }
      // SUSTO: o jogador se aproximando as faz fugir. A pousada é a mais desconfiada de se mexer (3,5 m), a que voa se assusta mais perto (4,5 m): sai voando para
      // longe do jogador, para cima e depressa, batendo as asas em disparada por uns 2 s; depois fica onde parou (a âncora passa a ser o novo lugar)
      if (f.scare > 0) {
        f.scare -= dt;
        // continua fugindo ENQUANTO estiver perto do jogador (até uns 26 m, no máximo 14 s): a cada instante o rumo é o de se afastar dele, mesmo que ele a persiga
        const sx = f.x - cam.x, sz = f.z - cam.z;
        if (Math.hypot(sx, sz) > 26) f.scare = 0;
        else {
          const away = Math.atan2(sz, sx);
          if (butterfly) {
            let diff = away - f.heading;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            f.heading += diff * Math.min(1, 3 * dt);
            f.turn = 0; f.turnTarget = 0; f.modeT = Math.max(f.modeT, 0.5); f.mode = 0;
          } else { f.tx = f.x + Math.cos(away) * 9; f.tz = f.z + Math.sin(away) * 9; f.retarget = 0.5; }
          f.ax = f.x + Math.cos(away) * 14; f.az = f.z + Math.sin(away) * 14;
        }
      } else if (f.fade >= 0.5) {
        const dx = f.x - cam.x, dy = f.y - cam.y, dz = f.z - cam.z;
        const near = (butterfly ? (f.mode === 2 ? 3.5 : 4.5) : 4.0);
        if (dx * dx + dy * dy + dz * dz < near * near) {
          f.scare = 14;
          const away = Math.atan2(dz, dx) + rnd(-0.6, 0.6);
          // a âncora vai para longe, no rumo da fuga (14 m): depois do susto ela continua se afastando, e não volta a passear em volta do jogador
          f.ax = f.x + Math.cos(away) * 14; f.az = f.z + Math.sin(away) * 14;
          if (butterfly) {
            f.mode = 0; f.modeT = 1; f.heading = away; f.turn = 0; f.turnTarget = 0; f.turnT = 0.6;
            f.ty = Math.max(f.y + 1.2, f.ground + rnd(2.5, 4.2));
          } else {
            // a libélula risca para longe e para lá fica
            f.tx = f.x + Math.cos(away) * 9; f.tz = f.z + Math.sin(away) * 9; f.ty = Math.max(f.y, f.ground + rnd(0.8, 1.6)); f.retarget = f.scare;
          }
        }
      }
      // a borboleta alterna: bate as asas (voa), planeia de asas abertas, e de vez em quando pousa e fica parada abrindo e fechando as asas devagar
      if (butterfly) {
        f.modeT -= dt;
        if (f.modeT <= 0) {
          if (f.mode === 2) { f.mode = 0; f.modeT = rnd(1.4, 2.8); f.retarget = 0; }
          else if (f.mode === 0) {
            if (f.y < f.ground + 1.1 && f.fade >= 1 && Math.random() < 0.35) { f.mode = 2; f.modeT = rnd(3.5, 7.0); f.tx = f.x; f.tz = f.z; f.ty = f.ground + 0.22; f.flap = 0; }
            else { f.mode = 1; f.modeT = rnd(0.3, 0.8); }
          } else { f.mode = 0; f.modeT = rnd(1.0, 2.4); }
        }
        if (f.mode === 0) f.flap = (f.flap + dt * (f.scare > 0 ? 22 : 10)) % 4;
        else if (f.mode === 1) f.flap = 0;
        else f.flap = (f.flap + dt * 1.6) % 7;
      }
      // novo alvo: a borboleta passeia perto de onde está; a libélula risca a água em volta da âncora e para no ar
      f.retarget -= dt;
      if (f.retarget <= 0 && !(butterfly && f.mode === 2)) {
        if (butterfly) {
          const a = rnd(0, 6.28), d = rnd(1.5, 5);
          f.tx = f.x + Math.cos(a) * d; f.tz = f.z + Math.sin(a) * d;
          f.ty = f.ground + rnd(0.5, 1.8);
          f.retarget = rnd(1.2, 3.0);
        } else {
          const a = rnd(0, 6.28), d = rnd(0.5, 5);
          f.tx = f.ax + Math.cos(a) * d; f.tz = f.az + Math.sin(a) * d;
          f.ty = f.ground + rnd(0.5, 1.2);
          f.retarget = rnd(0.5, 2.2);
        }
      }
      // aceleração até o alvo, mais um tremor (voo errático da borboleta; a libélula é reta e para de repente)
      const dx = f.tx - f.x, dy = f.ty - f.y, dz = f.tz - f.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const sp = f.speed * (butterfly ? 1 : (dl > 0.6 ? 1 : 0.1)) * (!butterfly && f.scare > 0 ? 3.6 : 1);
      const k = butterfly ? 2.4 : 7.0;
      if (butterfly && f.mode === 2) {
        // pousada: para depressa e desce até a flor
        const damp = Math.exp(-6 * dt);
        f.vx *= damp; f.vz *= damp; f.vy = (f.ty - f.y) * 2.0;
      } else if (butterfly && f.mode === 1) {
        // planeio: sem impulso, a velocidade vai se perdendo e ela afunda devagar
        const damp = Math.exp(-0.9 * dt);
        f.vx *= damp; f.vz *= damp; f.vy = f.vy * damp - 0.9 * dt; f.turn *= damp;
      } else {
        if (butterfly) {
          // VOO COM RUMO: ela segue uma direção e vai virando (curvas, voltas, zigue-zague), em vez de ir reta até um alvo. O rumo muda de tempos em tempos;
          // longe da âncora (10 m) a curva puxa de volta para ela
          f.turnT -= dt;
          if (f.turnT <= 0) {
            f.turnT = rnd(0.5, 1.6);
            f.turnTarget = rnd(-2.4, 2.4) * (f.scare > 0 ? 0.2 : 1);
            const ax = f.ax - f.x, az = f.az - f.z;
            if (f.scare <= 0 && ax * ax + az * az > 100) {
              let diff = Math.atan2(az, ax) - f.heading;
              diff = Math.atan2(Math.sin(diff), Math.cos(diff));
              f.turnTarget = Math.sign(diff || 1) * rnd(1.2, 2.4);
            }
          }
          f.turn += (f.turnTarget - f.turn) * Math.min(1, 3 * dt);
          f.heading += f.turn * dt;
          // a batida empurra para a frente e para cima (a velocidade pulsa a cada batida)
          const pulse = Math.max(0, Math.sin(f.flap * Math.PI / 2 + 1.2));
          const spd = f.scare > 0 ? 5.5 + f.speed * 1.5 + pulse * 1.5 : f.speed * (0.7 + 0.6 * pulse);   // assustada: dispara a uns 7 m/s (voo normal: ~1 m/s)
          f.vx += (Math.cos(f.heading) * spd - f.vx) * Math.min(1, (f.scare > 0 ? 10 : 6) * dt);
          f.vz += (Math.sin(f.heading) * spd - f.vz) * Math.min(1, (f.scare > 0 ? 10 : 6) * dt);
          // a altura: vai até a faixa escolhida (retarget), com um sobe e desce curto a cada batida
          f.vy += (((f.ty - f.y) * (f.scare > 0 ? 2.2 : 0.9)) - f.vy) * Math.min(1, 2.5 * dt) + (pulse - 0.35) * 2.2 * dt;
        } else {
          f.vx += ((dx / dl) * sp - f.vx) * Math.min(1, k * dt);
          f.vy += ((dy / dl) * sp * 0.7 - f.vy) * Math.min(1, k * dt);
          f.vz += ((dz / dl) * sp - f.vz) * Math.min(1, k * dt);
        }
      }
      const windK = butterfly ? (f.mode === 2 ? 0 : 0.25) : 0;
      f.x += (f.vx + wind.x * wind.strength * windK) * dt;
      f.y += f.vy * dt;
      f.z += (f.vz + wind.z * wind.strength * windK) * dt;
      // nunca dentro do chão
      const minY = f.ground + (butterfly && f.mode === 2 ? 0.18 : 0.35);
      if (f.y < minY) { f.y = minY; f.vy = Math.max(0, f.vy); }
      this.pos[i * 3] = f.x; this.pos[i * 3 + 1] = f.y; this.pos[i * 3 + 2] = f.z;
      // o lado para onde olha só vira com uma velocidade lateral clara (sem ficar espelhando quando está quase parada)
      const lateral = f.vx * camRight.x + f.vz * camRight.z;
      if (Math.abs(lateral) > 0.2) f.side = lateral >= 0 ? 1 : -1;
      const side = f.side;
      // borboleta: o quadro vem da máquina de estados; libélula: a fase do tremor das asas
      // vista: se ela cruza a tela, aparece de lado; se vem ou vai na direção da câmera, de cima (com histerese, para não ficar trocando)
      const fwdV = f.vx * camRight.z - f.vz * camRight.x;      // componente da velocidade na direção em que a câmera olha
      const ratio = Math.abs(lateral) / (Math.abs(fwdV) + 0.05);
      if (f.view === 0 && ratio > 0.9 && Math.abs(lateral) > 0.25) f.view = 1;
      else if (f.view === 1 && ratio < 0.45) f.view = 0;
      const frame = butterfly
        ? (f.mode === 2 ? REST_SEQ[Math.floor(f.flap) % 7]
          : f.mode === 1 ? (f.view ? 3 : 0)
          : (f.view ? SIDE_SEQ : FLAP_SEQ)[Math.floor(f.flap) % 4])
        : f.phase;
      // inclinação: de lado, o nariz sobe e desce com a subida e a descida (o lado inverte o sentido do giro); de cima, ela se inclina para o lado em que vai
      let rot = 0;
      if (butterfly && f.mode !== 2) {
        const hs = Math.hypot(f.vx, f.vz);
        const target = f.view
          ? Math.max(-0.6, Math.min(0.6, Math.atan2(f.vy, hs + 0.3))) * side
          : Math.max(-0.6, Math.min(0.6, -lateral * 0.35));
        f.rotS += (target - f.rotS) * Math.min(1, 6 * dt);
        rot = f.rotS;
      } else f.rotS = 0;
      this.rot[i] = rot;
      // inclinação para a frente ou para trás: só na vista de cima e voando; moderada (no máximo 0,38), segue a velocidade para longe (+) ou para perto (-) da câmera
      const tiltTarget = butterfly && f.mode !== 2 && !f.view ? Math.max(-0.38, Math.min(0.38, fwdV * 0.11)) : 0;
      f.tiltS += (tiltTarget - f.tiltS) * Math.min(1, 5 * dt);
      this.tilt[i] = f.tiltS;
      this.state[i * 4] = frame; this.state[i * 4 + 1] = f.color; this.state[i * 4 + 2] = butterfly && !(f.mode !== 2 && f.view) ? 1 : side; this.state[i * 4 + 3] = f.fade;
    }
    this.points.visible = active > 0;
    if (!this.points.visible) return;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aState as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aRot as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aTilt as THREE.BufferAttribute).needsUpdate = true;
    const u = this.mat.uniforms;
    u.uTime.value = time; u.uViewH.value = viewH; u.uLight.value = light;
  }

  public hide(): void { this.points.visible = false; for (const f of this.flyers) f.alive = false; }
}

export class Flyers {
  private readonly sets: Record<FlyerKind, FlyerSet>;
  private time = 0;
  private readonly right = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.sets = { butterflies: new FlyerSet(scene, 'butterflies', 12), dragonflies: new FlyerSet(scene, 'dragonflies', 5) };
  }

  public update(dt: number, camera: THREE.Camera, amounts: Partial<Record<FlyerKind, number>>, nearMode: number, viewH: number, wind: Wind, tg: TerrainGenerator): void {
    this.time = (this.time + dt) % 3600;
    const sunY = AERIAL.uFogSunDir.value.y;
    const day = THREE.MathUtils.smoothstep(sunY, 0.05, 0.3);          // só de dia
    const light = THREE.MathUtils.clamp(sunY * 2.0 + 0.35, 0.3, 1.0);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    for (const kind of FLYER_KINDS) {
      const amt = (amounts[kind] ?? 0) * nearMode * day;
      const set = this.sets[kind];
      if (amt < 0.01 && !set.points.visible) continue;
      set.update(dt, this.time, camera.position, this.right, amt, tg, wind, light, viewH);
    }
  }
}
