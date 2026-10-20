import * as THREE from 'three';
import { AERIAL } from './atmosphericFog.ts';
import type { Wind } from './wind.ts';
import type { TerrainGenerator } from '../generation/terrain/terrainGenerator.ts';
import { TREE_PRESETS } from '../generation/vegetation/pixelTrees/constants/presets.ts';
import { getPixelSaplingLeafTexture, getPixelFoliageTextures } from '../generation/vegetation/pixelTrees/services/pixelArtTextureSystem.ts';

/**
 * Folhas e pétalas que caem das copas de verdade. Cada árvore que solta algo (cerejeira, bordo, bétula, carvalho, árvore ancestral) se registra aqui
 * com a posição da copa (vegetationManager.createGameTrees); um conjunto pequeno de partículas nasce nas copas de perto da câmera, cai balançando com o
 * vento do mundo e some perto do chão (ou ao pousar).
 *
 * A folha que cai é a FOLHA DA MUDA da própria espécie (a textura de folha do Pixel_Tree que as mudas usam em cada cartão, com a paleta e o sombreado
 * dela), inteira, reduzida a CELLS x CELLS texels, cada texel com o tamanho do texel do mundo (21,3 por metro): do mesmo tamanho e desenho da folha
 * que se vê na muda. Gira em passos de 90° (e espelha), então cada pose é nítida. As partículas soltas no ar de cada bioma (biomeParticles.ts) continuam: o vento leva essas de longe, e estas
 * saem das árvores que o jogador vê.
 */

/** estilos de queda, na ordem de FALL_STYLE_OF */
interface Style { preset: string; rate: number; fall: number }
const STYLES: Style[] = [
  { preset: 'hyrule_oak_sapling', rate: 0.35, fall: 0.8 },    // carvalho
  { preset: 'akkala_birch_sapling', rate: 0.6, fall: 0.8 },   // bétula
  { preset: 'maple_red', rate: 1.0, fall: 0.9 },              // bordo vermelho
  { preset: 'maple_orange', rate: 1.0, fall: 0.9 },           // bordo laranja
  { preset: 'maple_yellow', rate: 1.0, fall: 0.9 },           // bordo amarelo
  { preset: 'satori_sakura_sapling', rate: 1.3, fall: 0.6 },  // cerejeira
  { preset: 'korok_ancient_sapling', rate: 0.5, fall: 0.5 },  // árvore ancestral
];
const FALL_STYLE_OF: Record<string, number> = { oak: 0, birch: 1, mapleRed: 2, mapleOrange: 3, mapleYellow: 4, sakura: 5, korok: 6 };
/** texels do atlas por folha, variações de folha por espécie, texels por metro do mundo */
/**
 * A folha é a da MUDA, igual: o desenho de 16 x 24 texels (getPixelSaplingLeafTexture: o formato da folha de cada espécie, com o índice de tom de cada texel) e a paleta
 * de folhagem da espécie (getPixelFoliageTextures), a mesma que o shader da muda usa. O shader da muda divide a folha em duas metades (a dobra no meio da nervura dá
 * a cada metade uma normal diferente) e sobe ou desce o tom em degraus inteiros da paleta; aqui as variações do atlas são essas poses: uma metade mais clara e a outra
 * mais escura (nos dois lados) e a face de trás, toda mais escura. O desenho fica numa célula de 24 x 24 (a folha, de 16 de largura, no meio).
 * Os pixels são os do MUNDO (21,33 por metro, o mesmo da grama e do chão): a folha de 16 x 24 texels da muda é reduzida (média por bloco) para 7 x 9 texels, que a
 * 21,33 por metro dá 0,33 x 0,42 m, quase o tamanho da folha da muda (0,24 x 0,36 m).
 */
const CELLS = 9, CROPS = 4, LEAF_W = 7, LEAF_H = 9, SRC_W = 16, SRC_H = 24, WORLD_TEXELS = 32 / 1.5;

/** Registro das copas (fora da classe: o gerenciador da vegetação escreve aqui sem conhecer a cena). Por chunk: x, y (centro da copa), z, raio, base, estilo. */
const emitters = new Map<number, number[]>();
let emitterVersion = 0;
export function fallStyleOf(kind: string): number { return FALL_STYLE_OF[kind] ?? -1; }
export function addTreeFall(owner: number, x: number, crownY: number, z: number, radius: number, baseY: number, style: number): void {
  let l = emitters.get(owner);
  if (!l) emitters.set(owner, l = []);
  l.push(x, crownY, z, radius, baseY, style);
  emitterVersion++;
}
export function removeTreeFall(owner: number): void { if (emitters.delete(owner)) emitterVersion++; }

const POOL = 260;
const VERT = /* glsl */ `
attribute vec4 aInfo;   // x: recorte (0..CROPS-1), y: espécie (linha do atlas), z: fase, w: opacidade
uniform float uTime;
uniform float uViewH;
attribute float aShade;  // 0 = no sol, 1 = na sombra de uma copa
varying vec4 vInfo;
varying float vTurn;
varying float vShade;
varying float vDepth;
void main() {
  vShade = aShade;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  vDepth = depth;
  vInfo = aInfo;
  // o pixel do atlas tem o tamanho do texel do mundo: quantos pixels de tela ele ocupa a esta distância
  float cell = projectionMatrix[1][1] * uViewH * 0.5 / (max(depth, 0.1) * ${WORLD_TEXELS.toFixed(4)});
  if (aInfo.w <= 0.01 || depth < 0.5 || cell < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_PointSize = max(2.0, min(cell >= 3.0 ? floor(cell + 0.5) : cell, floor(150.0 / ${CELLS}.0)) * ${CELLS}.0);
  // a folha gira em passos de 90° (e espelha): cada passo é uma pose nítida, sem rotação que borre os pixels
  vTurn = floor(mod(uTime * 1.7 + aInfo.z, 8.0));
}
`;
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform float uLight;
varying vec4 vInfo;
varying float vTurn;
varying float vShade;
varying float vDepth;
void main() {
  ivec2 c = ivec2(floor(gl_PointCoord * ${CELLS}.0));
  c = clamp(c, ivec2(0), ivec2(${CELLS - 1}));
  int t = int(vTurn);
  int x = c.x, y = c.y;
  if (t >= 4) x = ${CELLS - 1} - x;
  int r = t - (t / 4) * 4;
  for (int i = 0; i < 3; i++) { if (i >= r) break; int nx = ${CELLS - 1} - y; y = x; x = nx; }
  vec2 uv = (vec2(vInfo.x * ${CELLS}.0 + float(x), vInfo.y * ${CELLS}.0 + float(y)) + 0.5) / uAtlasSize;
  vec4 tx = texture2D(uAtlas, uv);
  if (tx.a < 0.5) discard;
  // a textura da folha é a paleta CLARA da muda; as folhas das árvores chegam à tela já sombreadas pela luz do jogo (mais escuras e menos vivas): sem esse
  // abaixamento (0,76 ao sol) a folha que cai parecia brilhar no meio da copa. Na sombra de uma copa escurece mais (e esfria um pouco)
  vec3 col = tx.rgb * uLight * mix(0.62, 0.26, vShade) * mix(vec3(1.0), vec3(0.88, 0.95, 1.08), vShade);
  // menos viva (as folhas das árvores chegam à tela já sombreadas e sem o brilho da paleta crua) e com a névoa do ar: de longe a folha desbota para o tom do céu,
  // como as copas; sem isso, a folha ficava mais viva e mais clara que a árvore a seu lado e parecia brilhar
  float g = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(vec3(g), col, 0.85);
  float haze = 1.0 - exp(-vDepth * 0.016);
  col = mix(col, vec3(0.58, 0.70, 0.80) * uLight, haze * 0.55);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Atlas de folhas: uma linha por espécie; as 4 colunas são as poses da folha da muda (ver CELLS). */
function buildLeafAtlas(): THREE.CanvasTexture {
  const W = CROPS * CELLS, H = STYLES.length * CELLS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d')!;
  const out = cx.createImageData(W, H);
  STYLES.forEach((st, row) => {
    const preset = (TREE_PRESETS as Record<string, unknown>)[st.preset] as object | undefined;
    if (!preset) return;
    const config = { ...preset, seed: 1 } as never;
    const leaf = getPixelSaplingLeafTexture(config);
    const foliage = getPixelFoliageTextures(config);
    const steps = foliage.steps as number;
    // a paleta: `steps` cores por linha; o shader lê a linha v = 0,75 (a de cima). A imagem é um canvas (ou um DataTexture): leio os dois jeitos
    const palImg = foliage.palette.image as unknown as { width: number; height: number; data?: ArrayLike<number>; getContext?: (t: string) => CanvasRenderingContext2D | null };
    const palData: ArrayLike<number> = palImg.data ?? palImg.getContext!('2d')!.getImageData(0, 0, palImg.width, palImg.height).data;
    // (canvas: a linha 0 é a de cima; DataTexture: a linha 0 é a de baixo; o shader lê v = 0,75, que é a linha de cima do desenho)
    const palRow = palImg.data ? Math.min(palImg.height - 1, Math.floor(0.75 * palImg.height)) : Math.max(0, palImg.height - 1 - Math.floor(0.75 * palImg.height));
    const palColor = (i: number): [number, number, number] => {
      const o = (palRow * palImg.width + Math.max(0, Math.min(steps - 1, i))) * 4;
      return [palData[o] as number, palData[o + 1] as number, palData[o + 2] as number];
    };
    const im = leaf.image as HTMLCanvasElement;
    const sd = im.getContext('2d')!.getImageData(0, 0, im.width, im.height).data;
    // a pose k: desvios de tom (em degraus da paleta) para a metade esquerda e a direita da folha
    const OFFS: [number, number][] = [[1, -1], [-1, 1], [-1, -1], [0, 0]];
    const ox = (CELLS - LEAF_W) >> 1, oy = (CELLS - LEAF_H) >> 1;
    for (let k = 0; k < CROPS; k++) {
      // reduz a folha de SRC_W x SRC_H para LEAF_W x LEAF_H: cada texel novo é a média do bloco (o texel conta se metade do bloco é folha), com o índice de tom médio
      for (let y = 0; y < LEAF_H; y++) for (let x = 0; x < LEAF_W; x++) {
        const x0 = Math.floor((x / LEAF_W) * SRC_W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / LEAF_W) * SRC_W));
        const y0 = Math.floor((y / LEAF_H) * SRC_H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / LEAF_H) * SRC_H));
        let sum = 0, n = 0, tot = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          tot++;
          const o = (yy * im.width + xx) * 4;
          if (sd[o + 3] >= 128) { sum += sd[o] / 255 * (steps - 1); n++; }
        }
        if (n === 0 || n / tot < 0.5) continue;
        const half = x < LEAF_W / 2 ? OFFS[k][0] : x >= (LEAF_W + 1) / 2 ? OFFS[k][1] : 0;      // a coluna do meio (a nervura) fica no tom base
        const c = palColor(Math.round(sum / n) + half);
        const o2 = ((row * CELLS + oy + y) * W + (k * CELLS + ox + x)) * 4;
        out.data[o2] = c[0]; out.data[o2 + 1] = c[1]; out.data[o2 + 2] = c[2]; out.data[o2 + 3] = 255;
      }
    }
  });
  cx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  return t;
}

export class TreeFall {
  private readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos = new Float32Array(POOL * 3);
  private readonly info = new Float32Array(POOL * 4);
  private readonly shade = new Float32Array(POOL);
  private frame = 0;
  private readonly vel = new Float32Array(POOL * 3);
  private readonly ground = new Float32Array(POOL);
  private readonly alive = new Uint8Array(POOL);
  private readonly age = new Float32Array(POOL);
  private time = 0;
  private cursor = 0;
  private groundCursor = 0;
  private emitAcc = 0;
  // copas perto da câmera (refeito a cada segundo, ou quando o registro muda)
  private near: number[] = [];
  private nearWeight = 0;
  private nearAt = -10;
  private nearVersion = -1;
  private nearX = 1e9;
  private nearZ = 1e9;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aShade', new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    const atlas = buildLeafAtlas();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uViewH: { value: 1000 }, uLight: { value: 1 }, uAtlas: { value: atlas }, uAtlasSize: { value: new THREE.Vector2(CROPS * CELLS, STYLES.length * CELLS) } },
      vertexShader: VERT, fragmentShader: FRAG,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.name = 'treeFall';
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  private refreshNear(cam: THREE.Vector3): void {
    this.near = [];
    this.nearWeight = 0;
    const R2 = 42 * 42;
    for (const l of emitters.values()) {
      for (let i = 0; i < l.length; i += 6) {
        const dx = l[i] - cam.x, dz = l[i + 2] - cam.z;
        if (dx * dx + dz * dz > R2) continue;
        this.near.push(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4], l[i + 5]);
        this.nearWeight += STYLES[l[i + 5]].rate;
      }
    }
    this.nearAt = this.time;
    this.nearVersion = emitterVersion;
    this.nearX = cam.x; this.nearZ = cam.z;
  }

  /** o ponto está dentro da copa (esfera) de OUTRA árvore, de outro estilo? Então a folha estaria atravessando uma copa de outra cor. */
  private insideOther(x: number, y: number, z: number, st: number): boolean {
    const n = this.near;
    for (let i = 0; i < n.length; i += 6) {
      if (n[i + 5] === st) continue;
      const rad = n[i + 3] * 0.95;
      const dx = x - n[i], dy = y - n[i + 1], dz = z - n[i + 2];
      if (dx * dx + dz * dz < rad * rad && Math.abs(dy) < rad * 1.1) return true;
    }
    return false;
  }

  /** Quanto da luz do sol a copa de alguém tapa neste ponto (0-1): o raio até o sol atravessa a esfera da copa? Mais fundo na esfera, mais sombra. */
  private shadeAt(x: number, y: number, z: number, sx: number, sy: number, sz: number): number {
    const n = this.near;
    let sh = 0;
    for (let i = 0; i < n.length; i += 6) {
      const R = n[i + 3] * 0.9;
      const cx = n[i] - x, cy = n[i + 1] - y, cz = n[i + 2] - z;
      const t = cx * sx + cy * sy + cz * sz;
      if (t < -R * 0.3) continue;                                   // a copa está do outro lado do sol
      const d2 = cx * cx + cy * cy + cz * cz - t * t;
      if (d2 >= R * R) continue;
      const k = 1 - Math.sqrt(d2) / R;
      if (k > sh) sh = Math.min(1, k * 2.2);
      if (sh >= 1) break;
    }
    return sh;
  }

  private emit(): boolean {
    if (this.near.length === 0 || this.nearWeight <= 0) return false;
    // sorteia uma copa pelo peso (a cerejeira solta mais que o carvalho)
    let r = Math.random() * this.nearWeight, idx = 0;
    for (let i = 0; i < this.near.length; i += 6) {
      r -= STYLES[this.near[i + 5]].rate;
      if (r <= 0) { idx = i; break; }
    }
    const x = this.near[idx], y = this.near[idx + 1], z = this.near[idx + 2], rad = this.near[idx + 3], base = this.near[idx + 4], st = this.near[idx + 5];
    const s = STYLES[st];
    let slot = -1;
    for (let k = 0; k < POOL; k++) {
      const j = (this.cursor + k) % POOL;
      if (!this.alive[j]) { slot = j; break; }
    }
    if (slot < 0) return false;
    this.cursor = (slot + 1) % POOL;
    // dentro da copa (70% do raio): a folha nasce bem debaixo dos galhos da própria árvore
    let px = x, py = y, pz = z, ok = false;
    for (let tries = 0; tries < 4 && !ok; tries++) {
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * rad * 0.7;
      px = x + Math.cos(a) * d; py = y + (Math.random() - 0.3) * rad * 0.8; pz = z + Math.sin(a) * d;
      ok = !this.insideOther(px, py, pz, st);      // copas que se sobrepõem: a folha só nasce onde só a própria árvore chega
    }
    if (!ok) return false;
    this.pos[slot * 3] = px; this.pos[slot * 3 + 1] = py; this.pos[slot * 3 + 2] = pz;
    this.vel[slot * 3] = 0; this.vel[slot * 3 + 1] = -s.fall * (0.75 + Math.random() * 0.5); this.vel[slot * 3 + 2] = 0;
    this.ground[slot] = base;
    this.age[slot] = 0;
    this.info[slot * 4] = Math.floor(Math.random() * CROPS); this.info[slot * 4 + 1] = st; this.info[slot * 4 + 2] = Math.random() * 8; this.info[slot * 4 + 3] = 1;
    this.shade[slot] = 0.8;     // nasce dentro da copa: já à sombra
    this.alive[slot] = 1;
    return true;
  }

  public update(dt: number, camera: THREE.Camera, amount: number, viewH: number, wind: Wind, tg: TerrainGenerator, calm: number): void {
    this.time = (this.time + dt) % 3600;
    const cam = camera.position;
    if (amount > 0.05 && (this.nearVersion !== emitterVersion && this.time - this.nearAt > 1.0 || this.time - this.nearAt > 2.5 || Math.hypot(cam.x - this.nearX, cam.z - this.nearZ) > 10 || this.time < this.nearAt)) this.refreshNear(cam);
    // emissão: ~ taxa por segundo (limitada pelo peso das copas em volta, para uma floresta cheia não soltar um dilúvio)
    if (amount > 0.05) {
      const perSec = Math.min(20, 3 + this.nearWeight * 0.4) * amount * (0.6 + 0.5 * wind.strength) * calm;
      this.emitAcc += perSec * dt;
      while (this.emitAcc >= 1) { this.emitAcc -= 1; this.emit(); }
    }
    const sunY = AERIAL.uFogSunDir.value.y;
    const light = THREE.MathUtils.clamp(sunY * 2.0 + 0.35, 0.18, 1.0);
    let any = false;
    this.frame++;
    const sv = AERIAL.uFogSunDir.value, sl = Math.hypot(sv.x, sv.y, sv.z) || 1, sdx = sv.x / sl, sdy = sv.y / sl, sdz = sv.z / sl;
    const gi0 = this.groundCursor; this.groundCursor = (gi0 + 6) % POOL;
    for (let i = 0; i < POOL; i++) {
      if (!this.alive[i]) { this.info[i * 4 + 3] = 0; continue; }
      this.age[i] += dt;
      const ph = this.info[i * 4 + 2];
      // deriva: o vento do mundo, mais um balanço próprio (a folha vai de um lado a outro enquanto cai)
      // O VENTO do mundo (wind.ts: direção e rajadas) carrega a folha: ela anda quase na velocidade do vento (até uns 3 m/s nas rajadas), com um balanço próprio por cima.
      // A rajada também a segura no ar (cai mais devagar) e a faz oscilar mais
      const gust = Math.min(1.6, wind.strength);
      const sx = Math.sin(this.time * 1.7 + ph) * (0.35 + 0.35 * gust), sz = Math.cos(this.time * 1.3 + ph * 1.3) * (0.35 + 0.35 * gust);
      this.vel[i * 3] += ((wind.x * gust * 1.2 + sx) - this.vel[i * 3]) * Math.min(1, 1.3 * dt);
      this.vel[i * 3 + 2] += ((wind.z * gust * 1.2 + sz) - this.vel[i * 3 + 2]) * Math.min(1, 1.3 * dt);
      // cai SEMPRE (a queda de cada espécie, de 1,4 a 2,1 m/s: bem mais rápida que o vento lateral, uns 45 graus para baixo) enquanto o vento a empurra de lado: o caminho é uma diagonal, e a rajada só a segura um pouco no ar. Um sobe e
      // desce curto (a folha plana e mergulha) dá o balanço vertical
      const flutter = 0.75 + 0.35 * Math.sin(this.time * 2.6 + ph * 2.1);
      this.vel[i * 3 + 1] = -STYLES[this.info[i * 4 + 1]].fall * 2.3 * (1 - 0.12 * Math.min(1, gust)) * flutter;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // o chão sob a folha, relido em rodízio (6 por quadro)
      if (((i - gi0 + POOL) % POOL) < 6) this.ground[i] = tg.getPointFast(this.pos[i * 3], this.pos[i * 3 + 2]).height;
      const above = this.pos[i * 3 + 1] - this.ground[i];
      const dcam = Math.hypot(this.pos[i * 3] - cam.x, this.pos[i * 3 + 2] - cam.z);
      const cross = this.near.length > 0 && this.insideOther(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], this.info[i * 4 + 1]);
      if (cross || above < 0.12 || this.age[i] > 40 || dcam > 60) { this.alive[i] = 0; this.info[i * 4 + 3] = 0; continue; }
      // sombra das copas, refeita em rodízio (1 a cada 3 quadros por folha) e suavizada
      if ((i + this.frame) % 3 === 0) {
        const target = sunY > 0.02 ? this.shadeAt(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], sdx, sdy, sdz) : 1;
        this.shade[i] += (target - this.shade[i]) * 0.5;
      }
      this.info[i * 4 + 3] = 1;
      any = true;
    }
    this.points.visible = any;
    if (!any) return;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aInfo as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aShade as THREE.BufferAttribute).needsUpdate = true;
    const u = this.mat.uniforms;
    u.uTime.value = this.time; u.uViewH.value = viewH; u.uLight.value = light;
  }
}

