import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createTree, WOOD_LOD } from './services/treeGenerator';
import { TREE_PRESETS } from './constants/presets';
import { ORE_BY_BIOME, type OreName } from './oreAssign';
import { FADE, FADE_GLSL } from '../../shaders/fadeDither';
import { GRASS, DIRT, ROCK } from '../../terrain/terrainTextureForge';
import { WIND_U, GRASS_PUSHER } from '../../../atmosphere/wind.ts';

/**
 * Árvores do Pixel_Tree no formato do jogo: para cada espécie, algumas variações (sementes
 * diferentes) em dois níveis de detalhe, cada uma com as suas partes (madeira, copa, raízes...) como
 * geometrias prontas para InstancedMesh. Os cartões de folha (um InstancedMesh) são "assados" numa
 * malha só e as partes que usam o mesmo material são juntas. Os materiais são os shaders de pixel
 * art do projeto, adaptados para instanciar a árvore inteira.
 */
export type GameTreeKind =
  | 'oak' | 'pine' | 'birch' | 'acacia' | 'palm' | 'mangrove' | 'snowPine' | 'willow'
  | 'mapleRed' | 'mapleOrange' | 'mapleYellow' | 'dead' | 'cactus' | 'sakura' | 'korok'
  // arbustos do Pixel_Tree, um por clima
  | 'shrubHyrule' | 'shrubBerry' | 'shrubFlower' | 'shrubDesert' | 'shrubSakura' | 'shrubBirch' | 'shrubPine'
  | 'shrubSnow' | 'shrubPalm' | 'shrubKorok' | 'shrubSwamp' | 'shrubSavanna' | 'shrubWithered'
  // mudas do Pixel_Tree
  | 'oakSapling' | 'pineSapling' | 'birchSapling' | 'palmSapling' | 'acaciaSapling' | 'mangroveSapling' | 'cactusSapling'
  | 'sakuraSapling' | 'korokSapling' | 'deadSapling' | 'snowPineSapling'
  // plantas rasteiras do Pixel_Tree: samambaia, junco e canteiros de flores (um por clima)
  | 'fernPlant' | 'reedClump'
  // troncos e tocos do Pixel_Tree
  | 'logFallen' | 'logHollow' | 'logRooted' | 'logStump'
  // pedras e pedrinhas do Pixel_Tree: uma de cada bioma
  | `rock_${RockBiomeKey}` | `gravel_${RockBiomeKey}` | `ore_${RockBiomeKey}_${OreName}`
  // folhas secas caídas, uma por clima
  | `leaves_${RockBiomeKey}`
  | 'flowers_hyrule' | 'flowers_satori' | 'flowers_akkala' | 'flowers_hebra' | 'flowers_hebra_snowy' | 'flowers_faron'
  | 'flowers_korok' | 'flowers_swamp' | 'flowers_gerudo' | 'flowers_savanna' | 'flowers_withered' | 'flowers_tundra';

export type RockBiomeKey = 'hyrule' | 'satori' | 'akkala' | 'hebra' | 'hebra_snowy' | 'faron' | 'korok' | 'swamp' | 'gerudo' | 'savanna' | 'withered' | 'tundra';
export const ROCK_BIOME_KEYS: RockBiomeKey[] = ['hyrule', 'satori', 'akkala', 'hebra', 'hebra_snowy', 'faron', 'korok', 'swamp', 'gerudo', 'savanna', 'withered', 'tundra'];
const SPECIES: Record<GameTreeKind, string> = {
  oak: 'hyrule_oak', pine: 'hebra_pine', birch: 'akkala_birch', acacia: 'savanna_acacia',
  palm: 'faron_palm', mangrove: 'swamp_mangrove', snowPine: 'hebra_pine_snowy', willow: 'arctic_willow',
  mapleRed: 'maple_red', mapleOrange: 'maple_orange', mapleYellow: 'maple_yellow',
  dead: 'dry_withered', cactus: 'gerudo_cactus', sakura: 'satori_sakura', korok: 'korok_ancient',
  shrubHyrule: 'hyrule_shrub', shrubBerry: 'berry_shrub', shrubFlower: 'flowering_shrub', shrubDesert: 'desert_shrub',
  shrubSakura: 'satori_shrub', shrubBirch: 'akkala_shrub', shrubPine: 'hebra_shrub', shrubSnow: 'hebra_shrub_snowy',
  shrubPalm: 'faron_shrub', shrubKorok: 'korok_shrub', shrubSwamp: 'swamp_shrub', shrubSavanna: 'savanna_shrub',
  shrubWithered: 'withered_shrub',
  oakSapling: 'hyrule_oak_sapling', pineSapling: 'hebra_pine_sapling', birchSapling: 'akkala_birch_sapling',
  palmSapling: 'faron_palm_sapling', acaciaSapling: 'savanna_acacia_sapling', mangroveSapling: 'swamp_mangrove_sapling',
  cactusSapling: 'gerudo_cactus_sapling', sakuraSapling: 'satori_sakura_sapling', korokSapling: 'korok_ancient_sapling',
  deadSapling: 'dry_withered_sapling', snowPineSapling: 'hebra_pine_snowy_sapling',
  fernPlant: 'fern_plant', reedClump: 'reed_clump',
  logFallen: 'fallen_log', logHollow: 'hollow_log', logRooted: 'rooted_log', logStump: 'tree_stump',
  flowers_hyrule: 'hyrule_flowers', flowers_satori: 'satori_flowers', flowers_akkala: 'akkala_flowers', flowers_hebra: 'hebra_flowers',
  flowers_hebra_snowy: 'hebra_snowy_flowers', flowers_faron: 'faron_flowers', flowers_korok: 'korok_flowers', flowers_swamp: 'swamp_flowers',
  flowers_gerudo: 'gerudo_flowers', flowers_savanna: 'savanna_flowers', flowers_withered: 'withered_flowers', flowers_tundra: 'tundra_flowers',
  ...(Object.fromEntries(ROCK_BIOME_KEYS.flatMap((b) => [['rock_' + b, b + '_rock'], ['gravel_' + b, b + '_gravel'], ['leaves_' + b, b + '_leaves'], ...ORE_BY_BIOME[b].map((o) => ['ore_' + b + '_' + o, b + '_ore'])])) as Record<`rock_${RockBiomeKey}` | `gravel_${RockBiomeKey}` | `leaves_${RockBiomeKey}` | `ore_${RockBiomeKey}_${OreName}`, string>),
};
const VARIANTS = 3;
/** texels por metro do mundo (terreno e água): o das árvores segue o mesmo */
/** brilho da luz por espécie (padrão 0,62, calibrado para casar com as árvores antigas) */
const BRIGHTNESS: Record<string, number> = { satori_sakura: 1.25, satori_leaves: 1.2, fern_plant: 1.15, reed_clump: 1.35 };
/** ajustes de cor por espécie no jogo (a cerejeira do preset é um rosa bem forte) */
const OVERRIDES: Partial<Record<string, Record<string, unknown>>> = {
  satori_sakura: { foliageColorTop: '#fff4f8', foliageColorBottom: '#f8bdd5' },
  // o salgueiro-anão do preset é um verde-musgo escuro que some na neve: um verde mais claro e frio
  arctic_willow: { foliageColorTop: '#86ad74', foliageColorBottom: '#3c5c3e' },
  // samambaia maior: o desenho é gerado maior (as frondes ganham pixels), sem esticar a instância
  fern_plant: { trunkHeight: 1.7 },
  // muda de cacto maior: o desenho é gerado maior (os pixels continuam do tamanho do mundo), sem esticar a instância
  gerudo_cactus_sapling: { trunkHeight: 1.3, trunkRadiusBase: 0.32, trunkRadiusTop: 0.23, clusterRadius: 0.5, patchRadius: 0.58, crownWidth: 0.58, crownHeight: 0.58, leafCardSize: 0.58 },
};

interface LodSpec {
  wood: { trunk: number; branch: number | null; passes: number; minRadiusMul: number; prune: number; canopyKeep: number; cactusRadial: number; needleKeep?: number; ringSkip?: number };
  /** fração dos cartões de folha mantidos e quanto os que ficam crescem */
  keep: number;
  cardScale: number;
}
// (degraus 2 e 3, de 150 m em diante: menos cartões e maiores, na mesma cobertura da copa (keep x cardScale² ficou igual): ~30% menos triângulos,
// que somavam mais da metade dos 10 milhões de triângulos de uma floresta densa e custavam ~2 ms de GPU)
const LODS: LodSpec[] = [
  { wood: { trunk: 6, branch: 4, passes: 0, minRadiusMul: 1, prune: 0.05, canopyKeep: 0.45, cactusRadial: 2 }, keep: 0.7, cardScale: 1.12 },
  // Escada de detalhe: a madeira era mais da metade dos triângulos da cena e as árvores distantes tinham quase o mesmo
  // desenho das próximas (uma árvore de 15 mil triângulos a 250 m ocupa poucos pixels). Cada degrau tira os galhos mais
  // finos e parte da copa; o último é só o tronco e os cartões de folha, que é o que se enxerga de longe.
  // (os degraus 1 a 3 ficaram bem mais leves: ~8,6 mil, ~4,6 mil e ~2,1 mil triângulos num carvalho, contra ~15 mil do degrau 0; eram 13,7 / 7,5 / 4 mil.
  // Os cartões que sobram crescem para manter a cobertura da copa)
  // (ringSkip: só 1 nó em cada 2 ou 3 dos galhos vira anel do tubo; foi o que mais cortou os troncos grandes: o carvalho do degrau 2 caiu de
  // 4,5 mil para 2,5 mil triângulos, a cerejeira de 9,5 mil para 4,8 mil, a árvore ancestral de 14,8 mil para 7,7 mil)
  { wood: { trunk: 5, branch: 3, passes: 0, minRadiusMul: 1, prune: 0.22, canopyKeep: 0.16, cactusRadial: 2, needleKeep: 0.45, ringSkip: 2 }, keep: 0.28, cardScale: 1.65 },
  { wood: { trunk: 4, branch: 3, passes: 0, minRadiusMul: 1, prune: 0.36, canopyKeep: 0.07, cactusRadial: 2, needleKeep: 0.22, ringSkip: 3 }, keep: 0.10, cardScale: 2.85 },
  { wood: { trunk: 3, branch: 2, passes: 0, minRadiusMul: 1, prune: 0.60, canopyKeep: 0.03, cactusRadial: 2, needleKeep: 0.09, ringSkip: 3 }, keep: 0.04, cardScale: 4.15 },
];

export interface GameTreePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** madeira/tronco: projeta sombra (a copa usa o proxy de sombra) */
  castShadow: boolean;
}
export interface GameTreeLod { parts: GameTreePart[] }
export interface GameTreeVariant { lods: [GameTreeLod, GameTreeLod, GameTreeLod, GameTreeLod]; height: number }

/** Plantas pequenas, pedras e pedrinhas só aparecem de perto: um desenho só (as outras faixas de distância ficam vazias). */
export function singleLodKind(kind: GameTreeKind): boolean {
  return kind.startsWith('flowers_') || kind.startsWith('leaves_') || kind === 'fernPlant' || kind === 'reedClump' || kind.startsWith('gravel_') || kind.startsWith('rock_') || kind.startsWith('ore_');
}

const cache = new Map<GameTreeKind, GameTreeVariant[]>();
/** os uniforms de tempo de todas as árvores (atualizados a cada quadro) */
const timeUniforms: { value: number }[] = [];

const hash01 = (i: number, s: number): number => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Junta os cartões de folha (um InstancedMesh) numa geometria só, em coordenadas da árvore. */
function bakeCards(mesh: THREE.InstancedMesh, root: THREE.Matrix4, keep: number, cardScale: number, seed: number): THREE.BufferGeometry {
  const base = mesh.geometry;
  const bp = base.attributes.position as THREE.BufferAttribute;
  const vcount = bp.count;
  const sel: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (keep >= 1 || hash01(i, seed) < keep) sel.push(i);
  const total = sel.length * vcount;
  const out = new THREE.BufferGeometry();
  const arrays = new Map<string, { src: THREE.BufferAttribute; dst: Float32Array; size: number; inst: boolean }>();
  for (const [name, attr] of Object.entries(base.attributes)) {
    const a = attr as THREE.BufferAttribute;
    arrays.set(name, { src: a, dst: new Float32Array(total * a.itemSize), size: a.itemSize, inst: (a as unknown as { isInstancedBufferAttribute?: boolean }).isInstancedBufferAttribute === true });
  }
  const mid = new Float32Array(total * 3);
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), sc = new THREE.Matrix4().makeScale(cardScale, cardScale, cardScale);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k < sel.length; k++) {
    const i = sel[k];
    mesh.getMatrixAt(i, m);
    m.premultiply(root).multiply(sc);
    nm.getNormalMatrix(m);
    c.set(0, 0.5, 0).applyMatrix4(m);
    for (let j = 0; j < vcount; j++) {
      const o = k * vcount + j;
      mid[o * 3] = c.x; mid[o * 3 + 1] = c.y; mid[o * 3 + 2] = c.z;
      for (const [name, e] of arrays) {
        if (name === 'position') {
          v.fromBufferAttribute(bp, j).applyMatrix4(m);
          e.dst[o * 3] = v.x; e.dst[o * 3 + 1] = v.y; e.dst[o * 3 + 2] = v.z;
        } else if (name === 'normal') {
          n.fromBufferAttribute(e.src, j).applyMatrix3(nm).normalize();
          e.dst[o * 3] = n.x; e.dst[o * 3 + 1] = n.y; e.dst[o * 3 + 2] = n.z;
        } else {
          const idx = e.inst ? i : j;
          for (let s = 0; s < e.size; s++) e.dst[o * e.size + s] = (e.src.array as ArrayLike<number>)[idx * e.size + s];
        }
      }
    }
  }
  const pack = (names: string[]): Float32Array => {
    const res = new Float32Array(total * names.length);
    names.forEach((nm2, ci) => {
      const e = arrays.get(nm2)!;
      for (let o = 0; o < total; o++) res[o * names.length + ci] = e.dst[o];
      arrays.delete(nm2);
    });
    return res;
  };
  const p1 = pack(['aCrownDepth', 'aNeighborDensity', 'aShade', 'aHueShift']);
  const p2 = pack(['aWindPhase', 'aWindStrength', 'aAtlasIndex']);
  for (const [name, e] of arrays) out.setAttribute(name, new THREE.BufferAttribute(e.dst, e.size));
  out.setAttribute('aPack1', new THREE.BufferAttribute(p1, 4));
  out.setAttribute('aPack2', new THREE.BufferAttribute(p2, 3));
  out.setAttribute('aCardMid', new THREE.BufferAttribute(mid, 3));
  const bi = base.index ? (base.index.array as ArrayLike<number>) : null;
  const per = bi ? bi.length : vcount;
  const idx = total > 65535 ? new Uint32Array(sel.length * per) : new Uint16Array(sel.length * per);
  for (let k = 0; k < sel.length; k++) {
    for (let t = 0; t < per; t++) idx[k * per + t] = (bi ? bi[t] : t) + k * vcount;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** uniforms de força do vento de cada material e o valor de base deles (multiplicado pela força do vento do mundo a cada quadro) */
const WIND_LIST: { u: { value: number }; base: number }[] = [];
const WIND_SEEN = new Set<object>();

/** O shader do projeto desenha UMA árvore; aqui cada árvore é uma instância (matriz de instância). */
function adaptShaders(mat: THREE.ShaderMaterial, bakedCards: boolean, hug = false, fullHug = false, lowPlant = false, windy = true, worldTexels = false): void {
  let vs = mat.vertexShader, fs = mat.fragmentShader;
  const isWood = vs.includes('attribute vec3 aWood;');
  if (bakedCards) {
    // (o limite é 16 atributos por vértice, contando a matriz de instância: os pequenos vão juntos)
    vs = vs.replace('attribute vec3 aClumpCenter;', 'attribute vec3 aClumpCenter;\n  attribute vec3 aCardMid;\n  attribute vec4 aPack1;\n  attribute vec3 aPack2;');
    const packed: [string, string][] = [['aCrownDepth', 'aPack1.x'], ['aNeighborDensity', 'aPack1.y'], ['aShade', 'aPack1.z'], ['aHueShift', 'aPack1.w'], ['aWindPhase', 'aPack2.x'], ['aWindStrength', 'aPack2.y'], ['aAtlasIndex', 'aPack2.z']];
    for (const [n, e] of packed) vs = vs.replace(new RegExp('attribute float ' + n + ';'), '#define ' + n + ' ' + e);
    vs = vs.replace('vec4 localPos = instanceMatrix * vec4(pos, 1.0);', 'vec4 localPos = vec4(pos, 1.0);');
    vs = vs.replace('modelMatrix * instanceMatrix * vec4(0.0, 0.5, 0.0, 1.0)', 'modelMatrix * vec4(aCardMid, 1.0)');
  }
  vs = vs.replace(/\bmodelMatrix\b/g, '(modelMatrix * instanceMatrix)');
  // (shaders que usam modelViewMatrix direto, como as flores, também precisam da matriz da instância)
  vs = vs.replace(/\bmodelViewMatrix\b/g, '(viewMatrix * (modelMatrix * instanceMatrix))');
  // (a pedra monta os texels no plano da face, em metros do MUNDO, e escolhe o plano pela normal do mundo: com a posição local da instância trocada pela do mundo
  // o desenho saía esticado e torto nas faces oblíquas, e a pedra girada ficava com os texels em outro ângulo que a normal)
  if (!worldTexels && /vWorldPos\s*=/.test(vs) && !/varying vec3 vLocalPos;/.test(vs)) {
    vs = vs.replace('varying vec3 vWorldPos;', 'varying vec3 vWorldPos;\n  varying vec3 vLocalPos;');
    vs = vs.replace(/(vWorldPos\s*=\s*[^;]+;)/, '$1\n    vLocalPos = position;');
    // as alturas e a copa são medidas na árvore, não no mundo (a árvore está em qualquer lugar)
    fs = fs.replace('varying vec3 vWorldPos;', 'varying vec3 vLocalPos;');
    fs = fs.replace(/\bvWorldPos\b/g, 'vLocalPos');
  }
  // plantas baixas (flores, samambaia, junco, arbustos, mudas): cada vértice da base segue a altura REAL do relevo
  // (mapa de alturas), então os caules e as raízes não ficam no ar nem enterrados em encostas e desníveis
  // flores: a planta inteira sobe ou desce com o chão (a altura do caule fica a mesma); o resto só da base
  const FULL_HUG = fullHug ? '1.0' : '(1.0 - smoothstep(0.06, 0.9, hugPos.y))';
  if (hug && !vs.includes('attribute vec3 aWood;') && /\bposition\b/.test(vs)) {
    vs = vs.replace(/\bposition\b/g, 'hugPos');
    vs = vs.replace(/void\s+main\s*\(\s*\)\s*\{/, `uniform sampler2D uHFTex;
uniform vec2 uHFOrigin;
uniform float uHFSize;
uniform float uHFOn;
void main() {
  vec3 hugPos = position;
  if (uHFOn > 0.5) {
    mat4 im = (modelMatrix * instanceMatrix);
    vec4 wp = im * vec4(hugPos, 1.0);
    vec2 huv = vec2((wp.x - uHFOrigin.x) / uHFSize, 1.0 - (wp.z - uHFOrigin.y) / uHFSize);
    if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) {
      vec4 hs = texture2D(uHFTex, huv);
      if (hs.a > 0.5) {
        float sy = max(0.01, length(im[1].xyz));
        float dy = (hs.r - im[3].y) / sy;
        hugPos.y += clamp(dy, -4.0, 4.0) * ${FULL_HUG};
      }
    }
  }
  /*GWHUG*/`);
  }
  // raízes até o chão: a casca (tem aWood) lê a altura REAL do relevo (mapa de alturas, terrainHeightField.ts) em cada
  // vértice da base e leva o vértice até lá: raízes e galhos baixos acompanham o terreno, em qualquer desnível
  if (vs.includes('attribute vec3 aWood;') && vs.includes('vec3 pos = position;')) {
    vs = vs.replace('void main() {', `uniform sampler2D uHFTex;
uniform vec2 uHFOrigin;
uniform float uHFSize;
uniform float uHFOn;
void main() {`);
    vs = vs.replace('vec3 pos = position;', `vec3 pos = position;
    {
      // só a primeira camada de vértices da base (os de baixo) vai até o chão: o resto da árvore não muda
      float rr0 = length(pos.xz);
      if (uHFOn > 0.5) {
        mat4 im = (modelMatrix * instanceMatrix);
        vec4 wp = im * vec4(pos, 1.0);
        vec2 huv = vec2((wp.x - uHFOrigin.x) / uHFSize, 1.0 - (wp.z - uHFOrigin.y) / uHFSize);
        if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) {
          vec4 hs = texture2D(uHFTex, huv);
          if (hs.a > 0.5) {
            float sy = max(0.01, length(im[1].xyz));
            float dy = (hs.r - im[3].y) / sy;
            float wy0 = 1.0 - smoothstep(0.08, 0.4, pos.y);
            pos.y += clamp(dy, -4.0, 4.0) * wy0;
          }
        }
      }
    }`);
  }
  // Vento do mundo (wind.ts) nas árvores, copas, folhas, arbustos e mudas: direção, rajadas e uma onda que atravessa a mata, como na grama. O
  // deslocamento cresce com a altura acima do pé (tronco preso ao chão) e é calculado no mundo e levado para o espaço da árvore, então a madeira, os
  // cartões de folha e a sombra balançam juntos. O balanço próprio de cada shader (uTime, uWindStrength) continua, como tremor das pontas.
  const gwPat = /vec3 pos = (position|hugPos);/;
  const gwMarker = vs.includes('/*GWHUG*/');
  const gwPlain = !gwPat.test(vs) && !gwMarker && /\bposition\b/.test(vs);
  // (pedras, cascalho, minérios, troncos caídos e tocos não balançam com o vento)
  if (windy && (gwPat.test(vs) || gwMarker || gwPlain) && /\binstanceMatrix\b/.test(vs)) {
    vs = vs.replace('void main() {', `uniform vec2 uWindDir;
uniform float uWindStr;
uniform float uWindT;
uniform float uGWAmp;
uniform float uGWLin;
uniform vec4 uGrassPusher;
uniform float uGPAmt;
uniform float uGPRef;
float gwGust = 0.0;
float gwGate() { return 0.35 + 0.65 * gwGust; }
vec3 globalWindLocal(vec3 p) {
  mat3 R = mat3(instanceMatrix);
  float s2 = max(dot(R[1], R[1]), 1e-4);
  float h = max(p.y, 0.0) * sqrt(s2);
  ${hug ? '' : 'h = min(h, 10.0);'}
  vec3 base = instanceMatrix[3].xyz;
  vec2 wb = base.xz;
  vec2 wPerp = vec2(-uWindDir.y, uWindDir.x);
  // a MESMA onda de rajada da grama (vegetationManager.ts): a faixa que inclina a grama inclina as copas na mesma hora
  float waveArg = dot(wb, uWindDir) * 0.11 - uWindT * 2.3 + sin(dot(wb, wPerp) * 0.045) * 1.6;
  float gustWave = smoothstep(0.35, 1.0, sin(waveArg));
  gwGust = gustWave;
  float ph = dot(wb, vec2(0.13, 0.17));
  float amt = (0.55 + gustWave * 0.45) * uWindStr * (0.8 + 0.2 * sin(uWindT * 2.1 + ph));
  vec3 dirW = vec3(uWindDir.x, 0.0, uWindDir.y);
  vec3 offW = dirW * amt * (uGWAmp * h * h / (1.0 + h) + uGWLin * min(h, 1.5));
  // farfalhar das folhas na rajada: cada ponto da copa oscila no seu ritmo (mais rápido que a inclinação) e só enquanto a faixa passa
  float fl = sin(uWindT * 6.5 + dot(p, vec3(2.1, 1.7, 2.9)) + ph * 3.0) * gustWave * uWindStr;
  offW += (dirW * 0.7 + vec3(wPerp.x, 0.0, wPerp.y) * 0.5) * fl * (uGWAmp * 0.6 + uGWLin * 0.5) * h / (1.0 + h);
  // Personagem passando (o mesmo da grama): as pontas perto dele se afastam e abaixam, mais as altas que a base
  if (uGPAmt > 0.0 && uGrassPusher.w > 0.0) {
    vec2 away = base.xz - uGrassPusher.xz;
    float dist = length(away);
    float near = 1.0 - smoothstep(uGrassPusher.w * 0.35, uGrassPusher.w, dist);
    near *= 1.0 - smoothstep(1.0, 2.5, abs(base.y - uGrassPusher.y));
    float tipW = clamp(h / uGPRef, 0.0, 1.0);
    vec2 dirP = dist > 0.001 ? away / dist : vec2(1.0, 0.0);
    float bend = near * tipW * tipW * uGPAmt;
    offW += vec3(dirP.x * 0.9, -0.45, dirP.y * 0.9) * bend * uGrassPusher.w;
  }
  return transpose(R) * offW / s2;
}
void main() {`);
    let gi = -1;
    if (gwPat.test(vs)) {
      vs = vs.replace(gwPat, (_m: string, nm: string) => `vec3 pos = ${nm};
    pos += globalWindLocal(${nm});`);
      gi = vs.indexOf('pos += globalWindLocal(');
    } else if (gwMarker) {
      vs = vs.replace('/*GWHUG*/', 'hugPos += globalWindLocal(hugPos);');
      gi = vs.indexOf('hugPos += globalWindLocal(');
    } else {
      // sem a linha "vec3 pos = position;" (flores, samambaias, juncos): o vento entra na posição que o shader usa no resto do main
      const mk = 'void main() {';
      const mi = vs.indexOf(mk) + mk.length;
      vs = vs.slice(0, mi) + '\n  vec3 gwPosition = position + globalWindLocal(position);' + vs.slice(mi).replace(/\bposition\b/g, 'gwPosition');
      gi = mi;
    }
    // o balanço e o farfalhar próprios do shader (seno com fase por folha) só acontecem enquanto a faixa de rajada da grama passa por ali, em vez de
    // oscilar o tempo todo por conta própria: as folhas mexem junto com a grama
    if (gi > 0) vs = vs.slice(0, gi) + vs.slice(gi).replace(/\b(uWindStrength|uFlutterStrength)\b/g, '($1 * gwGate())');
    Object.assign(mat.uniforms, WIND_U, {
      // árvores: só as folhas balançam (com a intensidade de antes; a altura conta até 10 m); a casca (tronco e galhos, tem aWood) fica parada
      uGWAmp: { value: hug ? (fullHug ? 0.3 : 0.12) : isWood ? 0 : 0.04 },
      // plantas baixas: inclinação proporcional à altura (a fórmula das copas quase não move uma flor de 40 cm)
      uGWLin: { value: hug ? (fullHug ? 0.2 : 0.1) : 0 },
      // empurrão do personagem: flores e folhas caídas (0,6 m) se afastam pouco (20%), samambaias/juncos (0,8 m) bastante; arbustos e mudas menos; árvores não
      uGrassPusher: GRASS_PUSHER,
      uGPAmt: { value: hug ? (fullHug ? 0.2 : lowPlant ? 0.7 : 0.35) : 0 },
      uGPRef: { value: hug ? (fullHug ? 0.6 : lowPlant ? 0.8 : 1.4) : 1 },
    });
  }
  // sumiço por distância: a troca seca com o impostor, pelo pé de cada árvore (o mesmo das outras)
  vs = vs.replace('void main() {', `uniform vec2 uFadeCam;\nvarying float vInstDist;\nvarying float vInstHash;\nvarying vec3 vLodBand;\nvarying vec3 vFadeLocal;\n${FADE_GLSL}\nvoid main() {
    vFadeLocal = position;
    vec2 instW = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;
    vInstDist = distance(instW, uFadeCam);
    vInstHash = fadeHash(floor(instW * 4.0));
    #ifdef USE_INSTANCING_COLOR
    vLodBand = instanceColor;
    #else
    vLodBand = vec3(0.0);
    #endif`);
  // vLodBand (vem da cor da instância, ver instancePool.ts): x = início e y = fim da faixa deste degrau de detalhe, z = 2 quando há faixa. A
  // árvore aparece quando o sorteio dela fica abaixo do avanço da zona de entrada (±12 m da divisa), e o degrau vizinho some pelo sorteio
  // contrário (sem buraco e sem sobreposição)
  // A troca entre degraus de detalhe se dissolve aos poucos: cada pedaço da árvore (células de ~0,5 m do desenho dela, presas à árvore, então não
  // fervem quando a câmera anda) tem o seu sorteio, somado ao da árvore. Antes a árvore inteira trocava de uma vez, num ponto da faixa, e isso
  // aparecia andando; agora o degrau novo vai ocupando a árvore pedaço a pedaço. A faixa também é mais larga nas divisas distantes (22% da
  // distância, no mínimo 12 m para cada lado)
  fs = fs.replace('void main() {', `uniform vec2 uInstFade;\nvarying float vInstDist;\nvarying float vInstHash;\nvarying vec3 vLodBand;\nvarying vec3 vFadeLocal;
float fadeCellHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    if (vInstHash > 1.0 - smoothstep(uInstFade.x, uInstFade.y, vInstDist)) discard;
    if (vLodBand.z > 1.5) {
      float fadeH = fract(vInstHash + fadeCellHash(floor(vFadeLocal.xy * 2.0 + vFadeLocal.z * vec2(1.7, 2.9)) + vInstHash * 91.0));
      float wIn = max(12.0, vLodBand.x * 0.22), wOut = max(12.0, vLodBand.y * 0.22);
      float inT = vLodBand.x <= 0.0 ? 1.0 : smoothstep(vLodBand.x - wIn, vLodBand.x + wIn, vInstDist);
      float outT = vLodBand.y >= 99990.0 ? 0.0 : smoothstep(vLodBand.y - wOut, vLodBand.y + wOut, vInstDist);
      if (fadeH >= inT || fadeH < outT) discard;
    }`);
  // o balanço próprio do shader (uWindStrength) também segue a força do vento do mundo (rajadas e o clima do bioma)
  const wsU = mat.uniforms.uWindStrength as { value: number } | undefined;
  if (wsU && !WIND_SEEN.has(wsU)) { WIND_SEEN.add(wsU); WIND_LIST.push({ u: wsU, base: wsU.value }); }
  mat.uniforms.uFadeCam = FADE.uFadeCam;
  mat.uniforms.uInstFade = FADE.uTreeSwap;
  mat.vertexShader = vs;
  mat.fragmentShader = fs;
  // o shader original (antes de o assetEnvironment mexer nele): o multi-draw parte dele (ver multiDraw.ts)
  mat.userData.srcVS = vs;
  mat.userData.srcFS = fs;
  // sombra recortada: as folhas projetam pelo mesmo recorte do alfa da textura (os cartões não viram bloco)
  const cut = /texture2D\(uStruct, (vAtlasUv|vUv)\)/.exec(fs);
  if (cut) {
    const depth = new THREE.ShaderMaterial({
      uniforms: mat.uniforms,
      vertexShader: vs,
      fragmentShader: '#include <packing>\n' + fs.slice(0, fs.indexOf('void main() {')) + `void main() {
    if (vInstHash > 1.0 - smoothstep(uInstFade.x, uInstFade.y, vInstDist)) discard;
    if (texture2D(uStruct, ${cut[1]}).a < uAlphaTest) discard;
    gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
  }`,
      side: THREE.DoubleSide,
    });
    mat.userData.depthMaterial = depth;
    mat.userData.castsCutShadow = true;
  } else if (vs.includes('uHFTex')) {
    // madeira que acompanha o relevo (raízes, tronco caído, galhos baixos): o vértice da base é levado até o chão no shader. O desenho da sombra
    // usava o material de profundidade padrão, sem esse ajuste, e a sombra saía de uma madeira mais alta ou mais baixa que a visível (uma faixa de chão
    // claro entre o tronco e a sombra). Agora a profundidade sai do mesmo vertex shader.
    mat.userData.depthMaterial = new THREE.ShaderMaterial({
      uniforms: mat.uniforms,
      vertexShader: vs,
      fragmentShader: '#include <packing>\nvoid main() { gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }',
      side: THREE.DoubleSide,
    });
  }
  // plantas baixas se sombreiam entre si e viram uma mancha escura: a sombra delas pesa menos (como as folhas das árvores)
  if (hug) mat.userData.leafFill = 0.3;
  mat.userData.pixelTree = true;
  mat.needsUpdate = true;
}

/** Chave que junta as partes que usam o "mesmo" material (os shaders e as texturas iguais). */
function materialKey(mat: THREE.Material): string {
  if ((mat as THREE.ShaderMaterial).isShaderMaterial) {
    const sm = mat as THREE.ShaderMaterial;
    const tex: string[] = [];
    for (const [k, u] of Object.entries(sm.uniforms)) {
      const val = (u as { value: unknown }).value as { uuid?: string; isTexture?: boolean } | undefined;
      if (val && val.isTexture) tex.push(k + ':' + val.uuid);
    }
    return 'S' + sm.vertexShader.length + ':' + sm.fragmentShader.length + ':' + tex.join(',');
  }
  return mat.type + ':' + ((mat as THREE.MeshToonMaterial).color?.getHex() ?? 0);
}

const GRASS_TEXEL_DENSITY = 32 / 1.5;

/** Tamanho (m) de uma folha de muda (largura, comprimento): metros por unidade de uv, nas primeiras folhas. */
function leafQuadSize(geo: THREE.BufferGeometry, q = 0.5): [number, number] {
  const pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
  const ws: number[] = [], hs: number[] = [];
  if (!uv) return [0.2, 0.4];
  const n = Math.min(60, Math.floor((idx ? idx.count : pos.count) / 3));
  const vi = (k: number) => (idx ? idx.getX(k) : k);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    for (let e = 0; e < 3; e++) {
      const i0 = vi(t * 3 + e), i1 = vi(t * 3 + ((e + 1) % 3));
      const du = Math.abs(uv.getX(i0) - uv.getX(i1)), dv = Math.abs(uv.getY(i0) - uv.getY(i1));
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1);
      const L = a.distanceTo(b);
      if (du > 0.02 && dv < du * 0.15) ws.push(L / du);
      else if (dv > 0.02 && du < dv * 0.15) hs.push(L / dv);
    }
  }
  const med = (v: number[], d: number, qq = 0.5) => (v.length ? v.sort((x, y) => x - y)[Math.min(v.length - 1, Math.floor(v.length * qq))] : d);
  return [med(ws, 0.2, q), med(hs, 0.4)];
}

const leafTexCache = new Map<string, THREE.Texture>();
const SHARED_MATS = new Map<string, THREE.Material>();
/**
 * As folhas das mudas são sprites de 16 x 24 texels, bem mais finos que a grama. Refaz o sprite com os texels
 * da grama para o tamanho que a folha tem no mundo (média dos texels, borda dura).
 */
/**
 * Textura da samambaia desenhada à mão na resolução da grama (tw x th pixels): nervura central escura e folíolos em
 * degraus alternados (par, ímpar), com um pixel vazio entre eles para cada folíolo ler como folha. As cores vêm da
 * textura original (as mais escuras e as mais claras que ela usa).
 */
function drawFernTexture(src: ArrayLike<number>, sx: number, sy: number, tw: number, th: number): THREE.CanvasTexture {
  const pool: { l: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < sx * sy; i++) {
    if (src[i * 4 + 3] < 128) continue;
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
    pool.push({ l: r * 0.3 + g * 0.59 + b * 0.11, r, g, b });
  }
  pool.sort((p, q) => p.l - q.l);
  const pick = (q: number) => pool[Math.min(pool.length - 1, Math.floor(q * pool.length))] ?? { r: 60, g: 140, b: 60 };
  // 6 tons como o capim (sombra funda, sombra, meio-escuro, meio, luz, ponta): da paleta da própria samambaia
  // o verde do preset (#5fae3a) é vivo demais perto da grama e das árvores: dessatura para o verde-oliva da mata, um pouco mais escuro e mais
  // amarelado nas luzes, e mantém o degradê de 6 tons
  const muted = (c: { r: number; g: number; b: number }) => {
    const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    const m = (v: number) => l + (v - l) * 0.55;
    return { l: 0, r: Math.min(255, m(c.r) * 1.06 * 0.88), g: Math.min(255, m(c.g) * 0.94 * 0.88), b: Math.min(255, m(c.b) * 0.8 * 0.88) };
  };
  const T = [0.05, 0.23, 0.45, 0.66, 0.85, 0.98].map(pick).map(muted);
  T[0] = { l: 0, r: T[0].r * 0.55, g: T[0].g * 0.55, b: T[0].b * 0.55 };
  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(tw, th);
  const put = (x: number, y: number, tone: number) => {
    if (x < 0 || x >= tw || y < 0 || y >= th) return;
    const c = T[Math.max(0, Math.min(5, tone))];
    const o = (y * tw + x) * 4;
    img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b; img.data[o + 3] = 255;
  };
  // fronde pinada cheia, no estilo do capim: folíolos colados (um por linha, inclinados para a ponta) viram uma lâmina
  // serrilhada; escura junto ao caule e na base, clara na ponta de cada folíolo; o pixel de baixo de cada um fica na sombra
  const mx = Math.floor((tw - 1) / 2);
  const rx = mx + (tw % 2 === 0 ? 1 : 0);
  const half = Math.max(1, tw - 1 - rx + (tw % 2 === 0 ? 0 : 0));
  const stalk = Math.max(2, Math.round(th * 0.12));
  for (let y = 0; y < th - stalk; y++) {
    const u = y / Math.max(1, th - stalk - 1);                          // 0 ponta .. 1 base
    const prof = Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.85));
    const len = Math.max(1, Math.round(half * (0.3 + 0.7 * prof)));
    for (const side of [-1, 1]) {
      if ((y + (side > 0 ? 1 : 0)) % 2 !== 0) continue;                  // um folíolo a cada duas linhas, com vão entre eles
      for (let k = 1; k <= len; k++) {
        const py = y + 1 - Math.floor(k * 0.5);                          // sobe em direção à ponta
        const px = side < 0 ? mx - k : rx + k;
        let tone = 1.6 + (1 - u) * 1.6 + (k / len) * 1.6 + (side < 0 ? 0.5 : -0.4);   // luz à esquerda, sombra à direita
        if (k === len) tone += 0.7;
        put(px, py, Math.round(tone));
        if (k > 1 && k < len) put(px, py + 1, Math.round(tone) - 1);
      }
    }
  }
  for (let y = 0; y < th; y++) {
    const tone = y >= th - stalk ? 0 : y < 3 ? 3 : 1;
    put(mx, y, tone);
    if (tw % 2 === 0) put(rx, y, tone);
  }
  // ponta terminal
  put(mx, 0, 5); put(mx, 1, 4);
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

/** 6 tons (sombra funda .. ponta) tirados da paleta da textura original. */
function tonesOfSource(src: ArrayLike<number>, n: number): { r: number; g: number; b: number }[] {
  const pool: { l: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (src[i * 4 + 3] < 128) continue;
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
    pool.push({ l: r * 0.3 + g * 0.59 + b * 0.11, r, g, b });
  }
  pool.sort((p, q) => p.l - q.l);
  const pick = (q: number) => pool[Math.min(pool.length - 1, Math.floor(q * pool.length))] ?? { r: 60, g: 140, b: 60 };
  const T = [0.02, 0.15, 0.35, 0.58, 0.8, 0.97].map(pick);
  T[0] = { l: 0, r: T[0].r * 0.55, g: T[0].g * 0.55, b: T[0].b * 0.55 };
  return T;
}

/**
 * Lâmina de junco e talo, no estilo do capim: afina da base até a ponta, luz à esquerda e sombra à direita, escura
 * na base e clara na ponta, com a nervura central mais clara nas lâminas largas.
 */
function drawReedTexture(src: ArrayLike<number>, sx: number, sy: number, tw: number, th: number, blade: boolean): THREE.CanvasTexture {
  const T = tonesOfSource(src, sx * sy);
  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(tw, th);
  const put = (x: number, y: number, tone: number) => {
    if (x < 0 || x >= tw || y < 0 || y >= th) return;
    const c = T[Math.max(0, Math.min(5, Math.round(tone)))];
    const o = (y * tw + x) * 4;
    img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b; img.data[o + 3] = 255;
  };
  for (let y = 0; y < th; y++) {
    const u = 1 - y / Math.max(1, th - 1);                      // 0 ponta .. 1 base (a textura tem a ponta no alto)
    const base = blade ? 1.2 + (1 - u) * 2.6 : 1.4 + (1 - u) * 1.4;
    // largura: cheia até 55% e afina até 1 pixel na ponta (talos mantêm a largura)
    const wdt = blade ? (u > 0.55 ? tw : Math.max(1, Math.round(1 + (tw - 1) * (u / 0.55)))) : tw;
    const x0 = Math.floor((tw - wdt) / 2);
    for (let k = 0; k < wdt; k++) {
      const left = k === 0, right = k === wdt - 1 && wdt > 1;
      let tone = base + (left ? 0.9 : right ? -1.2 : 0);
      if (blade && wdt >= 3 && k === Math.floor(wdt / 2) && y % 6 !== 5) tone += 0.6;   // nervura
      put(x0 + k, y, tone);
    }
    if (!blade && y % 7 === 3 && tw >= 2) put(0, y, base + 1.8);                       // nó do talo
  }
  if (blade) put(Math.floor((tw - 1) / 2), 0, 5);
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

function matchSaplingLeafTexels(sm: THREE.ShaderMaterial, geo: THREE.BufferGeometry, fern = false, reed = false, origFern = false): void {
  const densityMul = 1;
  // as folhas das mudas (uLeaf) e as folhas/talos das plantas rasteiras (uMap): sprites de poucos texels, mais finos que a grama
  for (const name of ['uLeaf', 'uMap']) {
    const tex = sm.uniforms[name]?.value as THREE.Texture | undefined;
    if (!tex || !tex.image) continue;
    const im = tex.image as { width: number; height: number; data?: ArrayLike<number>; getContext?: unknown };
    let sd: ArrayLike<number> | null = null;
    if (im.data) sd = im.data;
    else if ((im as unknown as HTMLCanvasElement).getContext) sd = (im as unknown as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, im.width, im.height).data;
    if (!sd) continue;
    const [w, h] = leafQuadSize(geo, fern || origFern ? 0.97 : 0.5);   // a fronde afina nas pontas: a largura de referência é a da parte larga
    const tw = Math.max(2, Math.round(w * GRASS_TEXEL_DENSITY * densityMul)), th = Math.max(3, Math.round(h * GRASS_TEXEL_DENSITY * densityMul));
    if (tw >= im.width && th >= im.height) continue;
    const reedKind = reed && (im.width === 8 && im.height === 64 ? 'blade' : im.width === 4 && im.height === 32 ? 'stem' : '');
    const key = tex.uuid + ':' + tw + 'x' + th + (fern ? 'f' : '') + (origFern ? 'o' : '') + (reedKind ? 'r' : '');
    let out = leafTexCache.get(key);
    if (!out && reedKind) {
      const nt = drawReedTexture(sd, im.width, im.height, tw, th, reedKind === 'blade');
      nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT; nt.flipY = tex.flipY; nt.colorSpace = tex.colorSpace;
      out = nt;
      leafTexCache.set(key, out);
    }
    if (!out && fern) {
      const nt = drawFernTexture(sd, im.width, im.height, tw, th);
      nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT; nt.flipY = tex.flipY; nt.colorSpace = tex.colorSpace;
      out = nt;
      leafTexCache.set(key, out);
    }
    if (!out) {
      const sx = im.width, sy = im.height;
      const cv = document.createElement('canvas');
      cv.width = Math.min(tw, sx); cv.height = Math.min(th, sy);
      const ow = cv.width, oh = cv.height;
      const cx = cv.getContext('2d')!;
      const img = cx.createImageData(ow, oh);
      for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
          const x0 = Math.floor((x / ow) * sx), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / ow) * sx));
          const y0 = Math.floor((y / oh) * sy), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / oh) * sy));
          let r = 0, g = 0, b = 0, n = 0, op = 0;
          for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
            const o = (yy * sx + xx) * 4; n++;
            if (sd[o + 3] > 127) { r += sd[o]; g += sd[o + 1]; b += sd[o + 2]; op++; }
          }
          const o2 = (y * ow + x) * 4;
          if (op > 0 && op / n >= (origFern ? 0.28 : 0.4)) { img.data[o2] = r / op; img.data[o2 + 1] = g / op; img.data[o2 + 2] = b / op; img.data[o2 + 3] = 255; }
        }
      }
      cx.putImageData(img, 0, 0);
      const nt = new THREE.CanvasTexture(cv);
      nt.magFilter = THREE.NearestFilter; nt.minFilter = THREE.NearestFilter; nt.generateMipmaps = false;
      nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT; nt.flipY = tex.flipY; nt.colorSpace = tex.colorSpace;
      out = nt;
      leafTexCache.set(key, out);
    }
    sm.uniforms[name].value = out;
  }
}

/**
 * Terra, grama e pedras soltas (o bloco de raízes do tronco arrancado, as pedras e o musgo): em vez de cor lisa, os mesmos
 * 6 tons do terreno (as rampas GRASS, DIRT e ROCK do gerador de texturas), em pixels do tamanho dos da grama.
 */
type GroundKind = 'grass' | 'dirt' | 'rock';
const GROUND_RAMPS: Record<GroundKind, { ramp: [number, number, number][]; base: number }> = {
  grass: { ramp: GRASS, base: 2.7 }, dirt: { ramp: DIRT, base: 2.0 }, rock: { ramp: ROCK, base: 2.4 },
};
function groundKindOf(color: THREE.Color): GroundKind {
  const mx = Math.max(color.r, color.g, color.b), mn = Math.min(color.r, color.g, color.b);
  if (color.g > color.r * 1.05 && color.g >= color.b * 1.2) return 'grass';
  return mx > 0 && (mx - mn) / mx < 0.5 && color.r > 0.1 && Math.abs(color.r - color.b) < 0.12 ? 'rock' : 'dirt';
}
function makeGroundMaterial(kind: GroundKind): THREE.ShaderMaterial {
  const g = GROUND_RAMPS[kind];
  const mat = new THREE.ShaderMaterial({
    uniforms: { uRamp: { value: g.ramp.map((c) => new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255)) }, uDensity: { value: GRASS_TEXEL_DENSITY }, uBase: { value: g.base } },
    vertexShader: `varying vec3 vLocal;
varying vec3 vN;
void main() {
  vLocal = position;
  vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `uniform vec3 uRamp[6];
uniform float uDensity;
uniform float uBase;
varying vec3 vLocal;
varying vec3 vN;
float h31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 cell = floor(vLocal * uDensity);
  float n = h31(cell) * 0.45 + h31(floor(cell / 3.0) + 17.0) * 0.55;
  float lit = normalize(vN).y * 0.9;
  float t = uBase + (n - 0.5) * 2.6 + lit - 0.4;
  int i = int(clamp(floor(t + 0.5), 0.0, 5.0));
  gl_FragColor = vec4(uRamp[i], 1.0);
}`,
  });
  return mat;
}

/** Um cartão de sprite do Pixel_Tree (maçã, baga, cogumelo, cogumelo de tronco): sempre de frente para a câmera. */
interface SpriteCard { tex: THREE.Texture; w: number; h: number; ax: number; ay: number; at: THREE.Vector3; ground: boolean }

const SPRITE_VS = `attribute vec3 aCenter;
attribute vec3 aNrm;
attribute float aHug;
// a sombra recebida usa "normal" (afasta o ponto lido do mapa de sombras): o cartão não tem superfície, então usa a direção
// para fora da árvore, já no mundo (com a rotação da instância), e não fica "dentro" do que o sombreia
vec3 sprNormalWorld;
#define normal sprNormalWorld
uniform sampler2D uHFTex;
uniform vec2 uHFOrigin;
uniform float uHFSize;
uniform float uHFOn;
varying vec2 vUv;
void main() {
  mat4 im = modelMatrix;
  sprNormalWorld = normalize(mat3(im) * aNrm);
  vec3 ctr = aCenter;
  if (aHug > 0.5 && uHFOn > 0.5) {
    vec4 wp = im * vec4(ctr, 1.0);
    vec2 huv = vec2((wp.x - uHFOrigin.x) / uHFSize, 1.0 - (wp.z - uHFOrigin.y) / uHFSize);
    if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) {
      vec4 hs = texture2D(uHFTex, huv);
      if (hs.a > 0.5) {
        float sy = max(0.01, length(im[1].xyz));
        ctr.y += clamp((hs.r - im[3].y) / sy, -4.0, 4.0);
      }
    }
  }
  vec4 mv = viewMatrix * (im * vec4(ctr, 1.0));
  mv.xy += position.xy * length(im[0].xyz);
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}`;
const SPRITE_FS = `uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(t.rgb, 1.0);
}`;

/** Reduz a textura de um sprite para tw x th pixels (média das cores opacas, recorte duro). */
function downsampleSprite(tex: THREE.Texture, tw: number, th: number): THREE.Texture {
  const key = 'spr:' + tex.uuid + ':' + tw + 'x' + th;
  const hit = leafTexCache.get(key);
  if (hit) return hit;
  const im = tex.image as HTMLCanvasElement;
  const sx = im.width, sy = im.height;
  const sd = im.getContext('2d')!.getImageData(0, 0, sx, sy).data;
  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(tw, th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x / tw) * sx), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / tw) * sx));
      const y0 = Math.floor((y / th) * sy), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / th) * sy));
      let r = 0, g = 0, b = 0, n = 0, op = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * sx + xx) * 4; n++;
        if (sd[o + 3] > 127) { r += sd[o]; g += sd[o + 1]; b += sd[o + 2]; op++; }
      }
      const o2 = (y * tw + x) * 4;
      if (op > 0 && op / n >= 0.4) { img.data[o2] = r / op; img.data[o2 + 1] = g / op; img.data[o2 + 2] = b / op; img.data[o2 + 3] = 255; }
    }
  }
  cx.putImageData(img, 0, 0);
  const nt = new THREE.CanvasTexture(cv);
  nt.magFilter = THREE.NearestFilter; nt.minFilter = THREE.NearestFilter; nt.generateMipmaps = false;
  leafTexCache.set(key, nt);
  return nt;
}

/**
 * Maçãs, bagas e cogumelos do Pixel_Tree viram cartões de frente para a câmera (uma instância por árvore), com os
 * pixels na densidade da grama. Os cogumelos do chão acompanham o relevo (mapa de alturas); os de tronco e as frutas ficam.
 */
function buildSpriteParts(cards: SpriteCard[], brightness: number | undefined): GameTreePart[] {
  const byKey = new Map<string, { tex: THREE.Texture; tw: number; th: number; items: SpriteCard[] }>();
  for (const cd of cards) {
    const im = cd.tex.image as { width: number; height: number } | undefined;
    if (!im || !(cd.tex.image as HTMLCanvasElement).getContext) continue;
    const tw = Math.max(5, Math.min(im.width, Math.round(cd.w * GRASS_TEXEL_DENSITY)));
    const th = Math.max(5, Math.min(im.height, Math.round(tw * im.height / im.width)));
    const key = cd.tex.uuid + ':' + tw + 'x' + th;
    let g = byKey.get(key);
    if (!g) { g = { tex: cd.tex, tw, th, items: [] }; byKey.set(key, g); }
    g.items.push(cd);
  }
  if (byKey.size === 0) return [];
  // Atlas: todos os cartões (maçãs, bagas, cogumelos de cores e tamanhos diferentes) numa textura só, para a árvore inteira
  // gastar UM desenho (antes eram uns 500 desenhos de poucos triângulos, que custavam ~15 ms de GPU)
  const groups = [...byKey.values()];
  const aw = Math.max(...groups.map((g) => g.tw));
  const ah = groups.reduce((s, g) => s + g.th + 1, 0);
  const atlas = document.createElement('canvas');
  atlas.width = aw; atlas.height = ah;
  const actx = atlas.getContext('2d')!;
  const rect = new Map<typeof groups[number], { oy: number }>();
  let oy = 0;
  for (const g of groups) {
    const small = downsampleSprite(g.tex, g.tw, g.th).image as HTMLCanvasElement;
    actx.drawImage(small, 0, oy);
    rect.set(g, { oy });
    oy += g.th + 1;
  }
  const map = new THREE.CanvasTexture(atlas);
  map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false;
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const pos = new Float32Array(total * 12), uv = new Float32Array(total * 8), ctr = new Float32Array(total * 12), hug = new Float32Array(total * 4);
  const idx = new Uint16Array(total * 6), nrm = new Float32Array(total * 12);
  const box = new THREE.Box3();
  let i = 0;
  for (const g of groups) {
    const qw = g.tw / GRASS_TEXEL_DENSITY, qh = g.th / GRASS_TEXEL_DENSITY;
    const oyg = rect.get(g)!.oy;
    const u1 = g.tw / aw, v0 = 1 - (oyg + g.th) / ah, v1 = 1 - oyg / ah;      // retângulo do cartão no atlas
    for (const cd of g.items) {
      const x0 = -cd.ax * qw, x1 = (1 - cd.ax) * qw, y0 = -cd.ay * qh, y1 = (1 - cd.ay) * qh;
      const corners = [[x0, y0, 0, v0], [x1, y0, u1, v0], [x1, y1, u1, v1], [x0, y1, 0, v1]];
      corners.forEach((cn, k) => {
        pos.set([cn[0], cn[1], 0], (i * 4 + k) * 3);
        uv.set([cn[2], cn[3]], (i * 4 + k) * 2);
        ctr.set([cd.at.x, cd.at.y, cd.at.z], (i * 4 + k) * 3);
        hug[i * 4 + k] = cd.ground ? 1 : 0;
        const hl = Math.hypot(cd.at.x, cd.at.z) || 1;
        if (cd.ground) nrm.set([0, 1, 0], (i * 4 + k) * 3);
        else nrm.set([cd.at.x / hl * 0.93, 0.37, cd.at.z / hl * 0.93], (i * 4 + k) * 3);
      });
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      box.expandByPoint(cd.at);
      i++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 3));
  geo.setAttribute('aHug', new THREE.BufferAttribute(hug, 1));
  geo.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingBox = box.expandByScalar(0.6);
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: map } }, vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS, side: THREE.DoubleSide });
  adaptShaders(mat, false);
  if (brightness) mat.userData.brightness = brightness;
  // sombra projetada: o cartão recortado pelo alfa da textura (de frente para a luz, como de frente para a câmera)
  mat.userData.depthMaterial = new THREE.ShaderMaterial({
    uniforms: mat.uniforms,
    vertexShader: mat.vertexShader,
    fragmentShader: `#include <packing>
uniform sampler2D uMap;
uniform vec2 uInstFade;
varying vec2 vUv;
varying float vInstDist;
varying float vInstHash;
void main() {
  if (vInstHash > 1.0 - smoothstep(uInstFade.x, uInstFade.y, vInstDist)) discard;
  if (texture2D(uMap, vUv).a < 0.5) discard;
  gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
}`,
    side: THREE.DoubleSide,
  });
  mat.userData.castsCutShadow = true;
  return [{ geometry: geo, material: mat, castShadow: true }];
}

/**
 * As folhas do coqueiro e do mangue são geometria de lâminas com a forma já feita (sem recorte pelo alfa de uma textura), então projetam sombra
 * pela própria geometria. Elas não estavam marcadas para projetar (só o tronco e as copas de cartões recortados), e a copa não fazia sombra no chão.
 */
function foliageCasts(species: string, mat: THREE.ShaderMaterial): boolean {
  return /palm|mangrove/.test(species) && !!mat.uniforms?.uPalette;
}

function buildLod(species: string, seed: number, lod: LodSpec, sizeMul = 1, oreName?: OreName, withCards = true): GameTreeLod & { box: THREE.Box3 } {
  Object.assign(WOOD_LOD, { needleKeep: 1, ringSkip: 1 }, lod.wood);
  // arbusto seco: só galhos finos, sem copa que esconda a falta deles. No degrau de perto sai como no gerador (tronco de 18 lados, galhos suavizados,
  // todos os galhos: com a poda dos finos e os lados reduzidos sobravam só uns poucos galhos tortos); nos degraus de longe, só uma poda leve
  if (species === 'withered_shrub') {
    if (lod === LODS[0]) Object.assign(WOOD_LOD, { trunk: 18, branch: null, passes: 2, minRadiusMul: 1, prune: 0, canopyKeep: 1, cactusRadial: 4, needleKeep: 1, ringSkip: 1 });
    else WOOD_LOD.prune = Math.min(WOOD_LOD.prune, 0.012);
  }
  // mesma densidade de texels da grama: o sprite do tufo tem 32 px em 1,5 m (~21 texels por metro).
  // A folha tem tantos texels quanto cabem no cartão (x1,7: os cartões chegam maiores ao mundo, pela escala
  // da instância e a variação) e a casca usa a faixa mais fina de pixel.
  const base = TREE_PRESETS[species] as { leafCardSize?: number };
  const tileRes = Math.max(12, Math.min(64, Math.round(GRASS_TEXEL_DENSITY * 1.7 * (base.leafCardSize ?? 1.3))));
  const inst = createTree({ ...TREE_PRESETS[species], ...(OVERRIDES[species] ?? {}),
    // flores: o tamanho vem do próprio desenho (prop.size no máximo), e não de esticar a instância - esticar também
    // esticaria os pixels (a flor ficava com pixels maiores que os do capim)
    // pedras: o tamanho da variação e, nos lugares secos (deserto, savana, terras secas), sem musgo nenhum
    ...((TREE_PRESETS[species] as { rock?: object }).rock && (sizeMul !== 1 || /^(gerudo|savanna|withered)_/.test(species) || /_ore$/.test(species)) ? (() => {
      const r = (TREE_PRESETS[species] as { rock: { width: number; height: number; depth: number; spread: number; moss: number }; trunkHeight: number }).rock;
      const dry = /^(gerudo|savanna|withered)_/.test(species);
      return { rock: { ...r, width: r.width * sizeMul, height: r.height * sizeMul, depth: r.depth * sizeMul, spread: r.spread * sizeMul, ...(dry ? { moss: 0 } : {}), ...(/_ore$/.test(species) ? { ...(oreName ? { ore: oreName } : {}), oreSize: Math.min(0.8, ((r as { oreSize?: number }).oreSize ?? 0.3) * 1.8), oreCount: 9 } : {}) },
        trunkHeight: (TREE_PRESETS[species] as { trunkHeight: number }).trunkHeight * sizeMul, ...(dry ? { mossAmount: 0 } : {}) };
    })() : {}),
    ...(species.endsWith('_leaves') ? { prop: { ...(TREE_PRESETS[species] as { prop?: object }).prop, size: 1.0, count: 3, density: 0.4,
      // no bosque de cerejeiras as folhas caídas são as pétalas: tom rosa, como as cerejeiras
      ...(species === 'satori_leaves' ? { color: '#d9b0a6' } : {}) } } : {}),
    ...(species.endsWith('_flowers') ? { prop: { ...(TREE_PRESETS[species] as { prop?: object }).prop, size: 1.2, count: 3, density: 0.25 } } : {}),
    seed, pixelSize: 1, tileResOverride: tileRes, flowerTexelsPerMetre: GRASS_TEXEL_DENSITY } as never);
  // todos os shaders de pixel (casca, galhos, mudas, folhas de muda, cacto) usam a densidade de texels da grama
  inst.group.traverse((o) => {
    const mm = (o as THREE.Mesh).material as THREE.ShaderMaterial | THREE.ShaderMaterial[] | undefined;
    if (!mm) return;
    for (const m of Array.isArray(mm) ? mm : [mm]) {
      const u = m.uniforms;
      if (!u) continue;
      // os sulcos da casca (uma crista por "lóbulo") contam em texels: com mais texels por metro a mesma casca ganhava mais sulcos. O lóbulo passa a ter
      // mais texels na mesma proporção, e os sulcos continuam com a largura em metros de antes (só os pixels ficam menores)
      if (u.uTexelsPerMetre && u.uTexelsPerLobe && u.uTexelsPerMetre.value > 0) u.uTexelsPerLobe.value *= GRASS_TEXEL_DENSITY / u.uTexelsPerMetre.value;
      // a casca: o escuro mais fundo fica nos sulcos e na sombra mais forte, mas sem tomar o lado sem sol do tronco inteiro
      if (u.uBarkDarkCoverage) u.uBarkDarkCoverage.value = Math.min(u.uBarkDarkCoverage.value, 0.6);
      if (u.uTexelsPerMetre) u.uTexelsPerMetre.value = GRASS_TEXEL_DENSITY;
      if (u.uTexelSize) u.uTexelSize.value = 1 / GRASS_TEXEL_DENSITY;
      if (u.uDensity && u.uOrePalette) u.uDensity.value = GRASS_TEXEL_DENSITY;     // os veios de minério também
    }
  });
  inst.group.updateMatrixWorld(true);
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; baked: boolean; shadow: boolean }>();
  const groundMats = new Map<GroundKind, THREE.ShaderMaterial>();
  const cards: SpriteCard[] = [];
  inst.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const spr = o as THREE.Sprite;
    if (spr.isSprite) {
      if (/Sparkle/.test(spr.name)) return;     // os brilhos dos minérios e cristais são animados (piscam): não viram cartões fixos
      const tex = (spr.material as THREE.SpriteMaterial).map;
      if (tex) cards.push({ tex, w: spr.scale.x, h: spr.scale.y, ax: spr.center.x, ay: spr.center.y, at: new THREE.Vector3().setFromMatrixPosition(spr.matrixWorld), ground: false });
      return;
    }
    if (mesh.isMesh && mesh.name === 'TreeMushroom') {
      const tex = (mesh.material as THREE.MeshBasicMaterial).map;
      const bb = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!);
      const w = (bb.max.x - bb.min.x) * mesh.scale.x, h = (bb.max.y - bb.min.y) * mesh.scale.x;
      if (tex && w > 0) {
        const at = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
        cards.push({ tex, w, h, ax: -bb.min.x / (bb.max.x - bb.min.x), ay: -bb.min.y / (bb.max.y - bb.min.y), at, ground: at.y < 0.15 });
      }
      return;
    }
    if (!mesh.isMesh || mesh.name === 'GroundMound' || mesh.name === 'TreeMushroom' || Array.isArray(mesh.material)) return;
    let mat = mesh.material as THREE.Material;
    const isShader = (mat as THREE.ShaderMaterial).isShaderMaterial === true;
    const isToon = (mat as THREE.MeshToonMaterial).isMeshToonMaterial === true;
    let groundKey = '';
    if (!isShader && !isToon) return;
    const g0 = mesh.geometry;
    const tris = g0.index ? g0.index.count / 3 : g0.attributes.position.count / 3;
    if (isToon && tris <= 30) return;     // a grama e as pedrinhas do chão da apresentação
    if (isToon && !(mat as THREE.MeshToonMaterial).map) {
      const gk = groundKindOf((mat as THREE.MeshToonMaterial).color);
      let gm = groundMats.get(gk);
      if (!gm) { gm = makeGroundMaterial(gk); groundMats.set(gk, gm); }
      mat = gm; groundKey = 'ground:' + gk;
    }
    let geo: THREE.BufferGeometry;
    const instMesh = mesh as THREE.InstancedMesh;
    if (instMesh.isInstancedMesh) {
      geo = bakeCards(instMesh, mesh.matrixWorld, lod.keep, lod.cardScale, seed);
    } else {
      geo = g0.clone();
      geo.applyMatrix4(mesh.matrixWorld);
    }
    const key = groundKey || materialKey(mat) + (instMesh.isInstancedMesh ? ':baked' : '');
    let gp = groups.get(key);
    if (!gp) {
      gp = { mat, geos: [], baked: !!instMesh.isInstancedMesh, shadow: !!groundKey || /Wood|Trunk|Root|Cactus|^Rock_/i.test(mesh.name) };
      groups.set(key, gp);
    }
    gp.geos.push(geo);
  });
  const parts: GameTreePart[] = [];
  const box = new THREE.Box3();
  const sigOrdinal = new Map<string, number>();
  for (const gp of groups.values()) {
    let geometry: THREE.BufferGeometry;
    if (gp.geos.length === 1) {
      geometry = gp.geos[0];
    } else {
      // todos com os mesmos atributos e o mesmo tipo de índice
      const names = Object.keys(gp.geos[0].attributes).filter((nm) => gp.geos.every((g) => g.attributes[nm]));
      for (const g of gp.geos) for (const nm of Object.keys(g.attributes)) if (!names.includes(nm)) g.deleteAttribute(nm);
      const idx = gp.geos.every((g) => g.index);
      const list = idx ? gp.geos : gp.geos.map((g) => (g.index ? g.toNonIndexed() : g));
      geometry = mergeGeometries(list, false) ?? gp.geos[0];
    }
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!);
    let sm = gp.mat as THREE.ShaderMaterial;
    // Materiais compartilhados: as variações e os degraus de distância de uma espécie usam o MESMO material (paleta e
    // texturas iguais). Antes cada um tinha o seu (528 materiais): o desenho trocava de material a cada chamada e reenviava
    // todos os uniforms de luz e sombra, ~0,25 ms de CPU por chamada. Só as plantas com textura própria por geometria ficam de fora.
    let sigKey = '';
    if (sm.isShaderMaterial && !sm.uniforms.uLeaf && !sm.uniforms.uMap) {
      const texSig = Object.entries(sm.uniforms).filter(([, u]) => (u as { value: { isTexture?: boolean } }).value?.isTexture)
        .map(([k, u]) => { const im = (u as { value: { image?: { width: number; height: number } } }).value.image; return k + (im ? im.width + 'x' + im.height : ''); }).join(',');
      const base = species + '|' + (oreName ?? '') + '|' + gp.baked + '|' + sm.vertexShader.length + ':' + sm.fragmentShader.length + '|' + texSig;
      const ord = sigOrdinal.get(base) ?? 0;
      sigOrdinal.set(base, ord + 1);
      sigKey = base + '#' + ord;
      const hit = SHARED_MATS.get(sigKey);
      if (hit) {
        parts.push({ geometry, material: hit, castShadow: gp.shadow || !!hit.userData.castsCutShadow || foliageCasts(species, hit as THREE.ShaderMaterial) });
        continue;
      }
    }
    if (sm.isShaderMaterial) {
      // samambaia: a textura ORIGINAL do Pixel_Tree, reduzida para a densidade da grama (a borda dos folíolos finos é mantida)
      matchSaplingLeafTexels(sm, geometry, false, species === 'reed_clump', species === 'fern_plant');
      adaptShaders(sm, gp.baked, /_flowers$|_leaves$|^fern_plant$|^reed_clump$|shrub|_sapling$/.test(species), /_flowers$|_leaves$/.test(species), /^fern_plant$|^reed_clump$/.test(species),
        !((TREE_PRESETS[species] as { rock?: object }).rock || /_log$|stump/.test(species)), !!(TREE_PRESETS[species] as { rock?: object }).rock);
      if (BRIGHTNESS[species]) sm.userData.brightness = BRIGHTNESS[species];
      // pedras: na sombra o que sobra é só a luz ambiente, e a paleta escura delas virava quase preto; uma parte da luz do sol chega mesmo na sombra
      // (como nas folhas e plantas), então a pedra à sombra fica cinza-escura, com o relevo à mostra
      if ((TREE_PRESETS[species] as { rock?: object }).rock) sm.userData.leafFill = 0.38;
      if (sm.uniforms.uTime) timeUniforms.push(sm.uniforms.uTime);
      if (sigKey) SHARED_MATS.set(sigKey, sm);
    }
    parts.push({ geometry, material: gp.mat, castShadow: gp.shadow || !!gp.mat.userData.castsCutShadow || foliageCasts(species, gp.mat as THREE.ShaderMaterial) });
  }
  // maçãs, bagas e cogumelos (cartões de frente para a câmera); o chão e as pedrinhas da apresentação não entram
  if (withCards && cards.length) parts.push(...buildSpriteParts(cards, BRIGHTNESS[species]));
  return { parts, box };
}

/** Variações de uma espécie (geradas na primeira vez, e guardadas). */
function variantCount(kind: GameTreeKind): number {
  // arbustos são pequenos e muitos: duas variações bastam
  return kind.startsWith('shrub') || kind.endsWith('Sapling') || kind.startsWith('flowers_') || kind === 'fernPlant' || kind === 'reedClump' || kind.startsWith('log') || kind.startsWith('gravel_') || kind.startsWith('leaves_') ? 2 : VARIANTS;
}

/** Gera a variação k de uma espécie (as duas faixas de distância). */
function buildVariant(kind: GameTreeKind, k: number): GameTreeVariant {
  const species = SPECIES[kind];
  const baseSeed = (TREE_PRESETS[species] as { seed: number }).seed;
  const oreName = kind.startsWith('ore_') ? (kind.slice(kind.lastIndexOf('_') + 1) as OreName) : undefined;
  const seed = baseSeed + k * 7919 + 13 + (oreName ? [...oreName].reduce((s, ch) => s + ch.charCodeAt(0), 0) * 31 : 0);
  // pedras: três tamanhos (esticar a instância esticaria os pixels), do seixo grande ao bloco
  const sizeMul = kind.startsWith('rock_') ? [0.42, 0.68, 1.0][k] : kind.startsWith('ore_') ? [1.3, 1.8, 2.4][k] : 1;   // as de minério são maiores: os veios têm tamanho fixo
  const a = buildLod(species, seed, LODS[0], sizeMul, oreName);
  if (singleLodKind(kind)) return { lods: [{ parts: a.parts }, { parts: a.parts }, { parts: a.parts }, { parts: a.parts }], height: Math.max(a.box.max.y, 0.5) };
  // maçãs, bagas e cogumelos só no desenho mais próximo (até 70 m): de 70 a 150 m cada fruta é menos de um pixel e custava um desenho por variação (~33)
  const m = buildLod(species, seed, LODS[1], sizeMul, oreName, false);
  const b = buildLod(species, seed, LODS[2], sizeMul, oreName, false);
  const c = buildLod(species, seed, LODS[3], sizeMul, oreName, false);
  return { lods: [{ parts: a.parts }, { parts: m.parts }, { parts: b.parts }, { parts: c.parts }], height: Math.max(a.box.max.y, 0.5) };
}

/** Variações de uma espécie (geradas na primeira vez, e guardadas; as que o pré-aquecimento já fez não se repetem). */
export function getGameTrees(kind: GameTreeKind): GameTreeVariant[] {
  let list = cache.get(kind);
  if (!list) { list = []; cache.set(kind, list); }
  const n = variantCount(kind);
  while (list.length < n) list.push(buildVariant(kind, list.length));
  return list;
}

/**
 * Pré-aquecimento: gera as árvores e plantas em segundo plano (uma variação por vez, quando o navegador está ocioso),
 * para que andar até um bioma novo não trave o jogo com a geração de uma árvore inteira (0,4 a 1,2 s cada).
 * O visual é o mesmo: só muda o momento em que cada uma é gerada.
 */
const WARM_FIRST: GameTreeKind[] = ['oak', 'birch', 'pine', 'sakura', 'mapleRed', 'mapleOrange', 'mapleYellow', 'korok', 'palm', 'mangrove', 'acacia', 'snowPine', 'willow', 'dead', 'cactus',
  'shrubHyrule', 'shrubBerry', 'shrubFlower', 'shrubBirch', 'shrubPine', 'shrubSakura', 'shrubKorok', 'shrubPalm', 'shrubSwamp', 'shrubSavanna', 'shrubDesert', 'shrubWithered', 'shrubSnow',
  'fernPlant', 'reedClump', 'logHollow', 'logRooted', 'logStump', 'logFallen'];
let warmQueue: [GameTreeKind, number][] | null = null;
export function warmGameTreesStep(): boolean {
  if (!warmQueue) {
    const kinds = [...WARM_FIRST, ...(Object.keys(SPECIES) as GameTreeKind[]).filter((k) => !WARM_FIRST.includes(k) && !k.startsWith('ore_'))];
    warmQueue = kinds.flatMap((k) => Array.from({ length: variantCount(k) }, (_, v) => [k, v] as [GameTreeKind, number]));
  }
  while (warmQueue.length) {
    const [kind, v] = warmQueue.shift()!;
    const list = cache.get(kind) ?? [];
    if (!cache.has(kind)) cache.set(kind, list);
    if (list.length > v) continue;            // já foi gerada (pelo jogo ou pelo catálogo)
    while (list.length <= v) list.push(buildVariant(kind, list.length));
    return warmQueue.length > 0;
  }
  return false;
}

/** Relógio dos shaders (vento). */
export function tickGameTrees(time: number): void {
  for (const u of timeUniforms) u.value = time;
  const ws = WIND_U.uWindStr.value;
  // (o balanço próprio dos shaders só vale dentro da faixa de rajada, ver adaptShaders; a força dele segue o vento do mundo)
  for (const w of WIND_LIST) w.u.value = w.base * ws * 0.8;
}

/** (depuração) triângulos de cada parte de uma espécie num desenho de teste */
export function probeLod(kind: GameTreeKind, spec: LodSpec): number[] {
  const parts = buildLod(SPECIES[kind], (TREE_PRESETS[SPECIES[kind]] as { seed: number }).seed + 13, spec).parts;
  return parts.map((p) => Math.round((p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3));
}
