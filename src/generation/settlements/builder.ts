import { planMaterialAtlas, type MaterialAtlas } from './materialAtlas';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetInstance } from '../structures/assetTypes';
import { STRUCTURE_PRESETS } from '../structures/catalog';
import { createStructure } from '../structures/generator';
import type { StructureAssetConfig, StructureKind } from '../structures/types';
import { createTree } from '../vegetation/pixelTrees/services/treeGenerator';
import { TREE_PRESETS } from '../vegetation/pixelTrees/constants/presets';
import { ROCK_BIOMES } from '../vegetation/pixelTrees/constants/rockBiomes';
import { DEFAULT_SETTLEMENT_SETTINGS, Footprint, Pad, PlannedBuilding, SettlementOptions, SettlementPlan, TerrainSampler, ValidationReport } from './types';
import { planSettlement, variantDims, realDims } from './planner';
import { terrainFor } from './terrain';
import { validatePlan } from './validation';
import { PointGrid, rectsOverlap, toWorld } from './geometry';
import { isSettlementType } from './kinds';
import { getGameTrees, singleLodKind, type GameTreeKind, type GameTreeVariant } from '../vegetation/pixelTrees/gameTrees';
import { SETTLEMENT_SCALE } from './settlementField';

/** texels por metro do CHÃO do mundo (a grama: 32 / 1,5): as texturas das construções seguem a mesma densidade na tela */
const WORLD_TEXELS_PER_METRE = 32 / 1.5;

/**
 * Turns a SettlementPlan into a scene, using the existing structure and tree
 * generators for every piece. Each distinct piece (a kind, a size variant) is
 * generated once and cloned: the clones share geometry and materials, so a
 * town of 70 houses costs a handful of generated models, not 70.
 */

const hashSeed = (seed: number, text: string, n: number): number => {
  let h = 2166136261 ^ Math.floor(seed);
  for (const c of text + ':' + n) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 90000 + 1000;
};

export interface Variant {
  inst: AssetInstance;
  /** the generated original goes in the scene once, every other use is a clone */
  used: boolean;
  /** measured footprint of the wood and stone, in the building's own frame */
  box: { x0: number; x1: number; z0: number; z1: number; top: number };
}

/**
 * Modelos já gerados, compartilhados entre as cidades do jogo: gerar uma casa custa dezenas de ms,
 * então cada tipo/variante é gerado uma vez e as cidades só clonam (geometria e materiais comuns).
 */
export interface SettlementLibrary {
  seed: number;
  variants: Map<string, Variant>;
  trees: Map<string, { inst: AssetInstance; used: boolean }>;
  updaters: ((t: number) => void)[];
  disposers: (() => void)[];
  /** material de água do mundo: a água de fontes e canais usa o mesmo shader do mar e dos rios */
  water?: THREE.Material;
}
export function createSettlementLibrary(seed: number, water?: THREE.Material): SettlementLibrary {
  // o material do mundo é de dois lados; fontes e canais só mostram a face de cima (visto de baixo, o disco da bacia superior aparecia branco).
  // Mesmos uniforms (o mundo continua animando a água), só o lado muda.
  let front: THREE.Material | undefined;
  if (water) {
    const sm = water as THREE.ShaderMaterial;
    const f = sm.clone();
    f.uniforms = sm.uniforms;
    f.side = THREE.FrontSide;
    // a água parada de uma fonte não sobe e desce como o mar (a onda deslocava a superfície e mostrava o fundo da bacia)
    f.vertexShader = sm.vertexShader.replace('pos.z += (totalWave', 'pos.z += 0.0 * (totalWave');
    front = f;
  }
  return { seed, variants: new Map(), trees: new Map(), updaters: [], disposers: [], water: front };
}

/** Integração com o jogo: tudo opcional; sem opções o resultado é o da galeria de ativos. */
export interface SettlementBuildOptions {
  /** relevo (já com o achatamento aplicado) em coordenadas locais do plano */
  terrain: TerrainSampler;
  /** plano pronto (vindo do worker): não replaneja */
  plan: SettlementPlan;
  /** achatamentos fixos do plano (os mesmos que o relevo do jogo usa) */
  pads: Pad[];
  library: SettlementLibrary;
  /** o jogo já tem chão: nada de lâmina de terreno própria */
  withGround: false;
  /** árvore do centro da praça: a mesma que o mundo planta naquele bioma */
  plazaTree?: string;
  /** Devolve a fusão das peças como `mergeStep()` (um grupo por chamada) em vez de fazê-la toda na criação. */
  deferMerge?: boolean;
  /** compila em segundo plano os shaders novos da cidade fundida (a troca só acontece depois) */
  precompile?: (o: THREE.Object3D) => Promise<unknown>;
  /** a fusão terminou de trocar as peças (as sombras precisam ser refeitas) */
  onMergeCommit?: () => void;
}

type VariantDims = { scale?: number; width?: number; depth?: number; bridgeStyle?: 'timber'; wallStairs?: boolean; wallStairSide?: 1 | -1 };
interface VariantContext {
  variants: Map<string, Variant>;
  modelSeed: number;
  biome: SettlementOptions['biome'];
  breakdown: Record<string, { meshes: number; triangles: number; cx?: number; cz?: number; w?: number; d?: number }>;
  disposers: (() => void)[];
  updaters: ((t: number) => void)[];
  /** modelos para o jogo (menos detalhe nas muralhas) */
  lean?: boolean;
  water?: THREE.Material;
}

function makeVariant(ctx: VariantContext, kind: StructureKind, variant: number, dims?: VariantDims): Variant {
  const key = `${kind}:${variant}:${dims?.width ?? ''}:${dims?.depth ?? ''}:${dims?.wallStairs ?? ''}:${dims?.wallStairSide ?? ''}:${dims?.scale ?? ''}`;
  const found = ctx.variants.get(key);
  if (found) return found;
  const preset = STRUCTURE_PRESETS[('structure_' + kind) as keyof typeof STRUCTURE_PRESETS];
  const base = variantDims(kind, variant);
  const config: StructureAssetConfig = {
    ...preset,
    seed: hashSeed(ctx.modelSeed, kind, variant),
    structure: {
      ...preset.structure,
      palette: { ...preset.structure.palette, ...(ctx.lean && (kind === 'stoneFountain' || kind === 'stoneWell') ? { stone: '#b8b6a8' } : {}) },
      width: dims?.width ?? base.width,
      depth: dims?.depth ?? base.depth,
      biome: ctx.biome,
      snow: ctx.biome === 'hebra_snowy' ? 0.65 : preset.structure.snow,
      ruin: kind === 'castle' || kind === 'fortress' ? 0 : preset.structure.ruin,
      // no jogo as plantas, árvores e pedras em volta das casas são as do gerador do mundo
      vegetation: ctx.lean ? 0 : preset.structure.vegetation * 0.7,
      // no random annexes: they swell a house by several metres and make its size unpredictable in a street
      annexes: false,
      // a cidade é ampliada por SETTLEMENT_SCALE: o modelo recebe mais texels por metro para dar a densidade do chão do mundo na tela
      ...(ctx.lean ? { texelsPerMetre: Math.round(WORLD_TEXELS_PER_METRE * SETTLEMENT_SCALE * 100) / 100 } : {}),
      // muralhas, portões e torres: o jogo não precisa de todo o detalhe de pedra (cada trecho de muro passava de 30 mil triângulos)
      ...(ctx.lean && (kind === 'wall' || kind === 'gate' || kind === 'stoneTower') ? { complexity: 0.2, finish: 0.3 } : {}),
      ...(dims?.scale ? { scale: dims.scale } : {}),
      ...(dims?.bridgeStyle ? { bridgeStyle: dims.bridgeStyle } : {}),
      ...(dims?.wallStairs !== undefined ? { wallStairs: dims.wallStairs } : {}),
      ...(dims?.wallStairSide ? { wallStairSide: dims.wallStairSide } : {}),
    },
  };
  const inst = createStructure(config);
  stripGround(inst.group);
  if (ctx.water) {
    const floors: THREE.Mesh[] = [];
    let stone: THREE.Material | undefined;
    inst.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && m.name === 'Architecture_stone') stone = m.material;
    });
    inst.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && m.material.userData.water) {
        // a tampa de baixo do disco de água (visto por baixo da bacia saía como um clarão branco) vira chão de pedra
        const { up, down } = splitDownFaces(m.geometry, kind === 'stoneFountain' ? 0.6 : -1);
        m.material = ctx.water!; m.geometry = up; m.renderOrder = 2; m.castShadow = false; m.userData.assetEnvironmentRegistered = true;
        if (down && stone) {
          // o fundo da bacia de cima assenta na borda de baixo da parede dela (y 0,85, raio até a parede ~0,41 no modelo: o fundo entra um pouco na pedra para não deixar fresta)
          down.computeBoundingBox();
          const bb = down.boundingBox!, r = Math.max(bb.max.x, bb.max.z);
          down.scale(0.41 / r, 1, 0.41 / r);
          down.translate(0, 0.87 - bb.max.y, 0);
          const f = new THREE.Mesh(down, stone); f.position.copy(m.position); f.quaternion.copy(m.quaternion); f.scale.copy(m.scale); f.castShadow = true; f.receiveShadow = true; m.parent?.add(f); floors.push(f); }
      }
    });
  }
  // a fonte é grande e dá para olhar por baixo da bacia superior: as faces de dentro não têm lado de trás (via-se o céu através da pedra)
  if (kind === 'stoneFountain') {
    inst.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && m.material !== ctx.water) m.material.side = THREE.DoubleSide;
    });
  }
  const v: Variant = { inst, used: false, box: measure(inst.group) };
  // (contagem de triângulos só para depuração: fora do caminho do jogo, onde cada modelo já custa dezenas de ms)
  if (!ctx.lean) { const cost = countTriangles(inst.group); ctx.breakdown[key] = { ...cost, cx: +((v.box.x0 + v.box.x1) / 2).toFixed(2), cz: +((v.box.z0 + v.box.z1) / 2).toFixed(2), w: +(v.box.x1 - v.box.x0).toFixed(2), d: +(v.box.z1 - v.box.z0).toFixed(2) }; }
  ctx.variants.set(key, v);
  ctx.disposers.push(() => inst.dispose());
  ctx.updaters.push((t) => inst.update(t));
  return v;
}

const wallDims = (w: SettlementPlan['walls'][number]): VariantDims => {
  const len = Math.round(w.length * 2) / 2;
  return w.stairSide ? { width: len, depth: 3.2, wallStairs: true, wallStairSide: w.stairSide } : { width: len, depth: 3.2, wallStairs: false };
};
const bridgeDims = (br: SettlementPlan['bridges'][number]): VariantDims => ({ width: Math.max(6, Math.round(br.length)), depth: Math.max(3.2, br.hd * 2), bridgeStyle: 'timber' });

/**
 * Os modelos que a cidade vai usar, um a um: o jogo gera um por quadro (cada casa custa dezenas de
 * ms) e só monta a cidade quando a biblioteca já tem tudo - a montagem em si só clona.
 */
export function settlementWarmupTasks(plan: SettlementPlan, lib: SettlementLibrary, biome: SettlementOptions['biome']): { label: string; run: () => void }[] {
  const ctx: VariantContext = { variants: lib.variants, modelSeed: lib.seed, biome, breakdown: {}, disposers: lib.disposers, updaters: lib.updaters, lean: true, water: lib.water };
  const tasks: { label: string; run: () => void }[] = [];
  const seen = new Set<string>();
  const add = (key: string, fn: () => void) => { if (!seen.has(key)) { seen.add(key); tasks.push({ label: key, run: fn }); } };
  for (const b of plan.buildings) add(`${b.kind}:${b.variant}`, () => { makeVariant(ctx, b.kind, b.variant); });
  for (const p of plan.props) if (p.id !== 'centre') add(`${p.kind}:${p.variant}`, () => { makeVariant(ctx, p.kind, p.variant); });
  for (const w of plan.walls) {
    const d = wallDims(w);
    add(`w:${w.kind}:${d.width}:${d.wallStairSide ?? 0}`, () => { if (w.kind === 'wall') makeVariant(ctx, 'wall', 0, d); else makeVariant(ctx, w.kind, 0); });
  }
  for (const kind of ['woodenBarrel', 'woodenCrate', 'supplySacks', 'toolRack', 'woodenCart', 'woodFence', 'stoneWell'] as StructureKind[]) add(`dress:${kind}`, () => { makeVariant(ctx, kind, 0); });
  add('dress:lantern', () => { makeVariant(ctx, 'stoneLantern', 0, { scale: 0.3 }); });
  for (const br of plan.bridges) { const d = bridgeDims(br); add(`b:${d.width}:${d.depth}`, () => { makeVariant(ctx, 'bridge', 0, d); }); }
  return tasks;
}

/**
 * Funde as peças estáticas da cidade por material e por quadrado de `cell` m: uma cidade tem milhares de peças (cada clone de casa traz dezenas de malhas) e cada
 * uma custa um desenho em cada passada de sombra. Os materiais de mesmo shader viram um só pelo atlas (materialAtlas.ts: a troca de material é o que custa).
 * Devolve um `step()` que faz UM grupo por chamada (o primeiro só coleta), para o gerente espalhar o trabalho por vários quadros: 1 = tem mais, 2 = espera os
 * shaders novos compilarem (as peças fundidas ficam escondidas e as originais continuam à vista até lá), 0 = terminou.
 */
type MergeStatus = 0 | 1 | 2;
interface MergeOptions { cell?: number; precompile?: (o: THREE.Object3D) => Promise<unknown>; onCommit?: () => void }
function mergeStatic(root: THREE.Object3D, opts: MergeOptions = {}): { step: () => MergeStatus; dispose: () => void } {
  const cell = opts.cell ?? 96;
  type Group = { mat: THREE.Material | THREE.Material[]; cast: boolean; recv: boolean; items: THREE.Mesh[]; ids: number[] | null };
  let queue: Group[] | null = null;
  let at = 0;
  let atlas: MaterialAtlas | null = null;
  let hold = false;
  let state: 'merge' | 'wait' | 'done' = 'merge';
  const rootInv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  const made: THREE.Mesh[] = [];
  const pendingRemove: THREE.Mesh[] = [];
  const holder = new THREE.Group();
  holder.name = 'SettlementStatic';
  const collect = (): Group[] => {
    root.updateMatrixWorld(true);
    // as peças são fundidas no espaço do PRÓPRIO `root` (a fusão agora roda depois de a cidade ser posta e ampliada no mundo: com a matriz de mundo, a posição
    // e a escala eram aplicadas duas vezes e as peças fundidas ficavam a mais de 1 km dali)
    rootInv.copy(root.matrixWorld).invert();
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m.material)) return;
      if (!m.geometry.getAttribute('position') || !m.visible) return;
      meshes.push(m);
    });
    try { atlas = planMaterialAtlas(meshes.map((m) => m.material as THREE.Material)); } catch { atlas = null; }
    hold = !!atlas && !!opts.precompile;
    const groups = new Map<string, Group>();
    for (const m of meshes) {
      m.geometry.computeBoundingSphere();
      const c = m.geometry.boundingSphere!.center.clone().applyMatrix4(rel.multiplyMatrices(rootInv, m.matrixWorld));
      const entry = atlas?.entryOf(m.material as THREE.Material) ?? null;
      const key = `${entry ? entry.shared.uuid : (m.material as THREE.Material).uuid}|${Math.floor(c.x / cell)}|${Math.floor(c.z / cell)}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { mat: entry ? entry.shared : m.material, cast: m.castShadow, recv: m.receiveShadow, items: [], ids: entry ? [] : null });
      g.items.push(m);
      if (entry) g.ids!.push(entry.id);
    }
    if (hold) holder.visible = false;
    root.add(holder);
    return [...groups.values()].filter((g) => g.items.length >= 2 || g.ids);
  };
  const mergeOne = (g: Group): void => {
    const names = (geo: THREE.BufferGeometry) => Object.keys(geo.attributes).sort().join(',') + (geo.index ? 'i' : 'n');
    // peças com conjuntos de atributos diferentes não se fundem entre si: cada conjunto vira a sua malha fundida
    const bySig = new Map<string, number[]>();
    g.items.forEach((m, i) => { const s = names(m.geometry); const l = bySig.get(s); if (l) l.push(i); else bySig.set(s, [i]); });
    for (const idxs of bySig.values()) if (idxs.length >= 2 || g.ids) mergeSet(g, idxs);
  };
  const mergeSet = (g: Group, idxs: number[]): void => {
    const items = idxs.map((i) => g.items[i]);
    const geos = items.map((m) => m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld)));
    // material do atlas: cada vértice leva o número do material de origem (a textura de dados diz retângulo, repetição, semente, paleta)
    if (g.ids) geos.forEach((geo, k) => geo.setAttribute('aMatId', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(g.ids![idxs[k]]), 1)));
    let merged: THREE.BufferGeometry | null = null;
    try { merged = mergeGeometries(geos, false); } catch { merged = null; }
    for (const geo of geos) geo.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, g.mat);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.recv;
    mesh.renderOrder = items[0].renderOrder;
    mesh.name = 'SettlementMerged';
    mesh.userData = { ...items[0].userData };
    made.push(mesh);
    holder.add(mesh);
    if (hold) pendingRemove.push(...items); else for (const m of items) m.removeFromParent();
  };
  const commit = (): void => {
    if (state === 'done') return;
    state = 'done';
    for (const m of pendingRemove) m.removeFromParent();
    holder.visible = true;
    opts.onCommit?.();
  };
  const step = (): MergeStatus => {
    if (state === 'done') return 0;
    if (state === 'wait') return 2;
    if (!queue) { queue = collect(); if (queue.length > 0) return 1; state = 'done'; return 0; }
    if (at < queue.length) mergeOne(queue[at++]);
    if (at < queue.length) return 1;
    if (!hold) { state = 'done'; return 0; }
    // as peças fundidas usam shaders novos: compila em paralelo (a cena segue com as originais) e só então troca
    state = 'wait';
    const timer = setTimeout(commit, 1500);
    opts.precompile!(holder).catch(() => undefined).then(() => { clearTimeout(timer); commit(); });
    return 2;
  };
  return { step, dispose: () => { for (const m of made) m.geometry.dispose(); atlas?.dispose(); } };
}

/** A água das estruturas é um disco fino e fechado: a tampa de baixo, vista por baixo da bacia, aparecia como um clarão branco. */
function splitDownFaces(src: THREE.BufferGeometry, lowBelow = -1): { up: THREE.BufferGeometry; down: THREE.BufferGeometry | null } {
  const geo = src.index ? src.toNonIndexed() : src;
  const normal = geo.getAttribute('normal');
  if (!normal) return { up: geo, down: null };
  const keep: number[] = [], drop: number[] = [], lowUp: number[] = [];
  for (let i = 0; i + 2 < normal.count; i += 3) {
    // só a face de cima é água; a de baixo vira chão; as bordas (finas) somem
    const ny = normal.getY(i) + normal.getY(i + 1) + normal.getY(i + 2);
    // lowBelow: o disco da bacia de baixo (o chão da praça é o fundo dele): desce e não ganha tampa de pedra
    const low = geo.getAttribute('position').getY(i) < lowBelow;
    if (ny > 1.5) (low ? lowUp : keep).push(i, i + 1, i + 2); else if (ny < -1.5 && !low) drop.push(i, i + 1, i + 2);
  }
  const pick = (list: number[]) => {
    const out = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) {
      const a = attr as THREE.BufferAttribute, size = a.itemSize, arr = new (a.array.constructor as new (n: number) => Float32Array)(list.length * size);
      list.forEach((v, k) => { for (let c = 0; c < size; c++) arr[k * size + c] = a.array[v * size + c]; });
      out.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
    }
    return out;
  };
  const up = pick(keep);
  // a água da bacia de cima sobe um pouco do fundo de pedra: o shader do mundo pinta de espuma branca quando o fundo está colado
  if (drop.length) up.translate(0, 0.03, 0);
  if (lowUp.length) {
    const lo = pick(lowUp);
    lo.translate(0, -0.1, 0);
    return { up: drop.length || keep.length ? mergeGeometries([up, lo], false) ?? up : lo, down: drop.length ? pick(drop) : null };
  }
  return { up, down: drop.length ? pick(drop) : null };
}

/**
 * Desce os pés de um modelo (tudo abaixo de 0,62 da base: sapata de pedra, ferragens e o pé da madeira)
 * até o chão: as pernas de ponte que ficavam no ar sobre o rio passam a se apoiar no leito, com a pedra
 * na ponta e a madeira esticada até ela. Cada pé (conjunto de vértices próximos, em todas as malhas)
 * desce INTEIRO o mesmo tanto, medido no centro dele - sem entortar a sapata nem achatar a pedra.
 */
function conformFeetToGround(holder: THREE.Object3D, terrain: TerrainSampler, disposers: (() => void)[]): void {
  holder.updateMatrixWorld(true);
  const CELL = 0.8;
  type Ref = { mesh: THREE.Mesh; i: number; x: number; y: number; z: number };
  const meshes: THREE.Mesh[] = [];
  const refs: Ref[] = [];
  const holderInv = holder.matrixWorld.clone().invert();
  const lv = new THREE.Vector3();
  holder.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    meshes.push(mesh);
    const pos = mesh.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      // a sapata de pedra (e a borda de pedra que a coroa, até ~1,3) e as ferragens descem inteiras; da madeira só o pé
      const limit = mesh.name === 'Architecture_stone' || mesh.name === 'Architecture_metal' ? 1.3 : 0.62;
      // altura no próprio modelo (a ponte pode estar inclinada)
      lv.copy(v).applyMatrix4(holderInv);
      if (lv.y <= limit) refs.push({ mesh, i, x: v.x, y: v.y, z: v.z });
    }
  });
  // pés = componentes conexos das células ocupadas (união por vizinhança de 8)
  const cellOf = (r: Ref) => `${Math.floor(r.x / CELL)},${Math.floor(r.z / CELL)}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(k, r); return r; };
  for (const r of refs) { const k = cellOf(r); if (!parent.has(k)) parent.set(k, k); }
  for (const k of [...parent.keys()]) {
    const [cx, cz] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const n = `${cx + dx},${cz + dz}`;
      if (parent.has(n)) { const a = find(k), b = find(n); if (a !== b) parent.set(a, b); }
    }
  }
  const sums = new Map<string, { x: number; z: number; n: number; low: number; x0: number; x1: number; z0: number; z1: number }>();
  for (const r of refs) {
    const root = find(cellOf(r));
    const s = sums.get(root) ?? { x: 0, z: 0, n: 0, low: Infinity, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    s.x += r.x; s.z += r.z; s.n++; s.low = Math.min(s.low, r.y);
    s.x0 = Math.min(s.x0, r.x); s.x1 = Math.max(s.x1, r.x); s.z0 = Math.min(s.z0, r.z); s.z1 = Math.max(s.z1, r.z);
    sums.set(root, s);
  }
  const drops = new Map<string, number>();
  for (const [root, s] of sums) {
    // pés largos (encontros de pedra): ficam como o modelo os fez - o terreno é nivelado sob eles (settlementField.planPads); esticar a base entortava as juntas da pedra
    if (Math.max(s.x1 - s.x0, s.z1 - s.z0) > 2.0) { drops.set(root, 0); continue; }
    // quanto o pé mais baixo está acima do chão no centro do pé; só desce
    const h = terrain.height(s.x / s.n, s.z / s.n);
    const d = s.low - (h - 0.1);
    drops.set(root, d > 0.05 ? Math.min(d, 14) : 0);
  }
  const perMesh = new Map<THREE.Mesh, Ref[]>();
  for (const r of refs) { const l = perMesh.get(r.mesh) ?? []; l.push(r); perMesh.set(r.mesh, l); }
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const list = perMesh.get(mesh);
    if (!list) continue;
    const todo = list.filter((r) => { const root = find(cellOf(r)); return (drops.get(root) ?? 0) > 0; });
    if (!todo.length) continue;
    const geo = mesh.geometry.clone();
    const pos = geo.getAttribute('position');
    const inv = mesh.matrixWorld.clone().invert();
    for (const r of todo) {
      const root = find(cellOf(r));
      const ny = r.y - drops.get(root)!;
      if (ny >= r.y - 0.001) continue;
      v.set(r.x, ny, r.z).applyMatrix4(inv);
      pos.setXYZ(r.i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    mesh.geometry = geo;
    disposers.push(() => geo.dispose());
  }
}

/**
 * Prolonga para baixo as paredes de pedra da ponte até o terreno (encontros que ficavam suspensos sobre a
 * margem inclinada). Em vez de esticar o fundo - o que entortava as juntas -, acrescenta uma faixa de parede
 * sob cada aresta de baixo, com a MESMA textura continuada (a UV segue o gradiente da própria parede).
 */
function skirtStoneWalls(holder: THREE.Object3D, terrain: TerrainSampler, disposers: (() => void)[]): void {
  holder.updateMatrixWorld(true);
  const holderInv = holder.matrixWorld.clone().invert();
  holder.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name !== 'Architecture_stone' || Array.isArray(mesh.material)) return;
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = src.getAttribute('position'), nor = src.getAttribute('normal'), uv = src.getAttribute('uv');
    if (!pos || !nor || !uv) return;
    const mw = mesh.matrixWorld, inv = mw.clone().invert();
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const L = new THREE.Vector3();
    const addPos: number[] = [], addNor: number[] = [], addUv: number[] = [];
    for (let i = 0; i + 2 < pos.count; i += 3) {
      for (let k = 0; k < 3; k++) P[k].fromBufferAttribute(pos, i + k).applyMatrix4(mw);
      const e1 = P[1].clone().sub(P[0]), e2 = P[2].clone().sub(P[0]);
      const n = e1.clone().cross(e2).normalize();
      if (Math.abs(n.y) > 0.3) continue;
      const minY = Math.min(P[0].y, P[1].y, P[2].y), maxY = Math.max(P[0].y, P[1].y, P[2].y);
      if (maxY - minY < 0.05) continue;
      const bot: number[] = [], top: number[] = [];
      for (let k = 0; k < 3; k++) (Math.abs(P[k].y - minY) < 0.02 ? bot : top).push(k);
      if (bot.length !== 2 || top.length !== 1) continue;
      L.copy(P[bot[0]]).applyMatrix4(holderInv);
      if (L.y > 0.12) continue; // só o fundo do modelo
      const a = bot[0], b = bot[1], c = top[0];
      const u1 = P[b].clone().sub(P[a]), u2 = P[c].clone().sub(P[a]);
      const beta = 1 / u2.y;
      const alpha = -beta * (u2.x * u1.x + u2.z * u1.z) / Math.max(1e-9, u1.x * u1.x + u1.z * u1.z);
      const uvOf = (k: number) => new THREE.Vector2(uv.getX(i + k), uv.getY(i + k));
      const ua = uvOf(a), ub = uvOf(b), uc = uvOf(c);
      // quanto a UV muda por metro para CIMA nesta parede
      const duvdy = ub.clone().sub(ua).multiplyScalar(alpha).add(uc.clone().sub(ua).multiplyScalar(beta));
      const dropA = Math.min(8, Math.max(0, P[a].y - (terrain.height(P[a].x, P[a].z) - 0.1)));
      const dropB = Math.min(8, Math.max(0, P[b].y - (terrain.height(P[b].x, P[b].z) - 0.1)));
      if (dropA < 0.04 && dropB < 0.04) continue;
      const A2 = P[a].clone(); A2.y -= dropA;
      const B2 = P[b].clone(); B2.y -= dropB;
      const uA2 = ua.clone().sub(duvdy.clone().multiplyScalar(dropA));
      const uB2 = ub.clone().sub(duvdy.clone().multiplyScalar(dropB));
      // quad A, B, B2, A2 com o mesmo sentido (normal) do triângulo original
      const quad = [[P[a], ua], [P[b], ub], [B2, uB2], [P[a], ua], [B2, uB2], [A2, uA2]] as [THREE.Vector3, THREE.Vector2][];
      const tn = P[b].clone().sub(P[a]).cross(B2.clone().sub(P[a])).normalize();
      if (tn.dot(n) < 0) { quad.reverse(); }
      for (const [pp, uu] of quad) {
        L.copy(pp).applyMatrix4(inv);
        addPos.push(L.x, L.y, L.z);
        const wn = n.clone().transformDirection(inv);
        addNor.push(wn.x, wn.y, wn.z);
        addUv.push(uu.x, uu.y);
      }
    }
    if (!addPos.length) { if (src !== mesh.geometry) src.dispose(); return; }
    const geo = new THREE.BufferGeometry();
    const join = (name: string, extra: number[], size: number) => {
      const a = src.getAttribute(name) as THREE.BufferAttribute;
      const arr = new Float32Array(a.count * size + extra.length);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) arr[i * size + c] = a.array[i * size + c];
      arr.set(extra, a.count * size);
      geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
    };
    join('position', addPos, 3); join('normal', addNor, 3); join('uv', addUv, 2);
    // atributos extras do material de pedra (se houver) repetem o último valor nos vértices novos
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (geo.getAttribute(name)) continue;
      const a = attr as THREE.BufferAttribute, size = a.itemSize, extraCount = addPos.length / 3;
      const arr = new Float32Array(a.count * size + extraCount * size);
      for (let i = 0; i < a.count * size; i++) arr[i] = a.array[i];
      for (let i = 0; i < extraCount; i++) for (let c = 0; c < size; c++) arr[(a.count + i) * size + c] = a.array[(a.count - 1) * size + c];
      geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    if (src !== mesh.geometry) src.dispose();
    mesh.geometry = geo;
    disposers.push(() => geo.dispose());
  });
}

/**
 * Plantas do mundo (arbustos e flores) da cidade: uma malha instanciada por peça e por degrau de detalhe, em vez de uma por planta.
 * Os degraus são os mesmos do mundo (0–70 m, 70–150 m, 150–260 m, dali em diante; distâncias em metros do mundo), então a planta
 * muda de desenho exatamente onde mudaria na floresta; só o degrau mais próximo tem todos os triângulos (eram 62% dos triângulos da cidade).
 */
const PLANT_BANDS = [70, 150, 260];
const PLANT_CELL = 96;
interface PlantGroup { variant: GameTreeVariant; single: boolean; cx: number; cz: number; items: { m: THREE.Matrix4; x: number; z: number }[] }
function addPlant(groups: Map<string, PlantGroup>, kind: GameTreeKind, variant: number, x: number, y: number, z: number, yaw: number, scale: number): void {
  let vs;
  try { vs = getGameTrees(kind); } catch { return; }
  const k = Math.abs(variant) % vs.length;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.03, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
  // por célula do espaço da cidade: cada malha tem a sua esfera de corte e some do quadro (e das sombras) quando está fora da vista
  const ix = Math.floor(x / PLANT_CELL), iz = Math.floor(z / PLANT_CELL);
  const key = `${kind}:${k}:${ix}:${iz}`;
  let g = groups.get(key);
  if (!g) groups.set(key, g = { variant: vs[k], single: singleLodKind(kind), cx: (ix + 0.5) * PLANT_CELL, cz: (iz + 0.5) * PLANT_CELL, items: [] });
  g.items.push({ m, x, z });
}
function plantMeshes(groups: Map<string, PlantGroup>): { group: THREE.Group; setViewer: (x: number, z: number) => void } {
  const g = new THREE.Group();
  g.name = 'village_plants';
  const white = new THREE.Color(1, 1, 1);
  interface Slot { mesh: THREE.InstancedMesh }
  const built: { pg: PlantGroup; bands: Slot[][] }[] = [];
  for (const pg of groups.values()) {
    const n = pg.items.length;
    let minY = Infinity, maxY = -Infinity;
    for (const it of pg.items) { const y = it.m.elements[13]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const bands: Slot[][] = [];
    for (let l = 0; l < (pg.single ? 1 : 4); l++) {
      const slots: Slot[] = [];
      for (const part of pg.variant.lods[l].parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, n);
        for (let i = 0; i < n; i++) mesh.setColorAt(i, white);
        // esfera fixa da célula (com folga para a planta maior): sem ela o corte recalcularia a esfera de todas as instâncias
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(pg.cx, (minY + maxY) / 2, pg.cz), Math.hypot(PLANT_CELL * 0.72, (maxY - minY) / 2) + 8);
        mesh.frustumCulled = true;
        mesh.castShadow = part.castShadow;
        mesh.receiveShadow = true;
        mesh.count = 0;
        mesh.visible = false;
        g.add(mesh);
        slots.push({ mesh });
      }
      bands.push(slots);
    }
    built.push({ pg, bands });
  }
  const S = SETTLEMENT_SCALE;
  let lastX = NaN, lastZ = NaN;
  // viewer: posição do jogador no espaço da cidade (antes da ampliação); refaz a divisão por degrau só depois de andar ~4 m
  const setViewer = (vx: number, vz: number): void => {
    if (Math.hypot(vx - lastX, vz - lastZ) * S < 4) return;
    lastX = vx; lastZ = vz;
    const edges = PLANT_BANDS.map((e) => (e / S) ** 2);
    for (const { pg, bands } of built) {
      const counts = bands.map((slots) => slots.map(() => 0));
      for (const it of pg.items) {
        const d2 = (it.x - vx) ** 2 + (it.z - vz) ** 2;
        const l = pg.single ? 0 : d2 < edges[0] ? 0 : d2 < edges[1] ? 1 : d2 < edges[2] ? 2 : 3;
        bands[l].forEach((slot, s) => slot.mesh.setMatrixAt(counts[l][s]++, it.m));
      }
      bands.forEach((slots, l) => slots.forEach((slot, s) => {
        slot.mesh.count = counts[l][s];
        slot.mesh.visible = counts[l][s] > 0;
        slot.mesh.instanceMatrix.needsUpdate = true;
      }));
    }
  };
  setViewer(0, 0);
  lastX = NaN; lastZ = NaN;
  return { group: g, setViewer };
}

function stripGround(root: THREE.Object3D) {
  const dead: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && (o.userData.ground || o.userData.excludeFromSettlement)) dead.push(o); });
  for (const o of dead) o.parent?.remove(o);
}

function countTriangles(root: THREE.Object3D): { meshes: number; triangles: number } {
  let meshes = 0, triangles = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { meshes++; const g = m.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; }
  });
  return { meshes, triangles: Math.round(triangles) };
}

/** Footprint of the building itself: plants, flowers and rocks scattered round it do not count. */
function measure(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const inVegetation = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === 'StructureVegetation') return true; return false; };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || inVegetation(o)) return;
    part.setFromObject(m, false);
    if (!part.isEmpty()) box.union(part);
  });
  return { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, top: box.max.y };
}

export function createSettlement(source: StructureAssetConfig, game?: SettlementBuildOptions): AssetInstance & { mergeStep?: () => MergeStatus; setViewer?: (x: number, z: number) => void } {
  const c = source.structure;
  if (!isSettlementType(c.type)) throw new Error('not a settlement type: ' + c.type);
  const settings = { ...DEFAULT_SETTLEMENT_SETTINGS, ...(c.settlement ?? {}) };
  const options: SettlementOptions = { ...settings, kind: c.type, seed: source.seed, biome: c.biome };
  const terrain = game ? game.terrain : terrainFor(source.seed, settings);
  const t0 = performance.now();
  const plan = game ? game.plan : planSettlement(options, terrain);
  const tPlan = performance.now() - t0;

  const lib = game?.library;
  const disposers: (() => void)[] = lib ? lib.disposers : [];
  const updaters: ((t: number) => void)[] = lib ? lib.updaters : [];
  const ownDisposers: (() => void)[] = [];
  let plantViewer: ((x: number, z: number) => void) | undefined;
  const root = new THREE.Group();
  root.name = 'ProceduralSettlement';
  const assets = new THREE.Group();
  assets.name = 'SettlementAssets';
  root.add(assets);

  // ---- real footprints, then the final validation -----------------------------
  const structureVariants = lib ? lib.variants : new Map<string, Variant>();
  const modelSeed = lib ? lib.seed : source.seed;
  const breakdown: Record<string, { meshes: number; triangles: number; cx?: number; cz?: number; w?: number; d?: number }> = {};
  const vctx: VariantContext = { variants: structureVariants, modelSeed, biome: c.biome, breakdown, disposers, updaters, lean: !!lib, water: lib?.water };
  const variantFor = (kind: StructureKind, variant: number, dims?: VariantDims): Variant => makeVariant(vctx, kind, variant, dims);
  const realRect = (b: PlannedBuilding): Footprint => {
    const v = variantFor(b.kind, b.variant);
    const [x, z] = toWorld({ x: b.px, z: b.pz, hw: 0, hd: 0, yaw: b.yaw }, (v.box.x0 + v.box.x1) / 2, (v.box.z0 + v.box.z1) / 2);
    return { x, z, hw: (v.box.x1 - v.box.x0) / 2 + 0.2, hd: (v.box.z1 - v.box.z0) / 2 + 0.2, yaw: b.yaw };
  };
  let report: ValidationReport = validatePlan(plan, terrain, realRect);
  let pruned = 0;
  for (let pass = 0; pass < 8 && report.overlaps.length; pass++) {
    const drop = new Set<string>();
    for (const [a, b] of report.overlaps) {
      const ba = plan.buildings.find((q) => q.id === a), bb = plan.buildings.find((q) => q.id === b);
      if (!ba && !bb) continue;
      if (!bb) { drop.add(a); continue; }
      if (!ba) { drop.add(b); continue; }
      // the more important or bigger building stays
      const rank = (q: PlannedBuilding) => (q.role === 'landmark' ? 1e6 : 0) + q.width * q.depth;
      drop.add(rank(ba) >= rank(bb) ? b : a);
    }
    plan.buildings = plan.buildings.filter((q) => !drop.has(q.id));
    plan.streets = plan.streets.filter((s) => !(s.to && drop.has(s.to)));
    pruned += drop.size;
    report = validatePlan(plan, terrain, realRect);
  }
  plan.pads = game ? game.pads : [
    ...plan.buildings.map((b): Pad => ({ x: b.x, z: b.z, hw: b.hw + 0.4, hd: b.hd + 0.4, yaw: b.yaw, y: b.baseY })),
    // the curtain wall stands on one level strip of ground
    ...plan.walls.map((w): Pad => ({ x: w.x, z: w.z, hw: w.hw + 0.3, hd: w.hd + (w.stairSide ? 2.4 : 0.6), yaw: w.yaw, y: w.baseY })),

  ];
  plan.stats.prunedByRealBounds = pruned;
  plan.stats.buildings = plan.buildings.length;

  // ---- ground: the terrain, levelled under the buildings ---------------------------
  // the slab reaches just past the outskirts, so the settlement fills the view
  const half = plan.radius * (c.type === 'fortifiedTown' ? 1.5 : 1.22) + 10;
  // no jogo o relevo já vem achatado: as ruas só acompanham o chão
  const heightAt = game ? (x: number, z: number) => terrain.height(x, z) : makeHeightAt(terrain, plan.pads);
  if (!game) {
    const ground = buildGround(plan, terrain, heightAt, half, c.biome);
    root.add(ground.group);
    disposers.push(ground.dispose);
  }

  // ---- streets ------------------------------------------------------------------------
  // no jogo as ruas são pintadas na textura do terreno (settlementGroundMask)
  if (!game) {
    const roads = buildRoads(plan, terrain, heightAt, c.type);
    assets.add(roads.group);
    ownDisposers.push(roads.dispose);
  }

  // ---- structures -----------------------------------------------------------------------
  const place = (v: Variant, x: number, y: number, z: number, yaw: number, scale = 1) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = yaw;
    if (scale !== 1) holder.scale.setScalar(scale);
    holder.add(v.used || lib ? v.inst.group.clone(true) : v.inst.group);
    v.used = true;
    holder.updateMatrix();
    holder.matrixAutoUpdate = false;
    assets.add(holder);
    return holder;
  };
  for (const b of plan.buildings) place(variantFor(b.kind, b.variant), b.px, b.baseY, b.pz, b.yaw).name = b.id;
  // no jogo a fonte/poço da praça e os adereços aparecem pequenos ao lado das casas: ampliados
  for (const p of plan.props) {
    // no jogo o centro da praça é a fonte de rochas do mundo (abaixo), não o modelo do gerador de estruturas
    if (game && p.id === 'centre') continue;
    const holder = place(variantFor(p.kind, p.variant), p.x, p.baseY, p.z, p.yaw, 1);
    holder.name = p.id;
    // a fonte/poço da praça: larga e baixa (só a altura é reduzida)
    if (game && p.id === 'centre') { holder.scale.y *= 0.62; holder.updateMatrix(); }
  }
  for (const w of plan.walls) {
    const v = w.kind === 'wall' ? variantFor('wall', 0, wallDims(w)) : variantFor(w.kind, 0);
    place(v, w.x, w.baseY - 0.35, w.z, w.yaw);
  }
  for (const br of plan.bridges) {
    const holder = place(variantFor('bridge', 0, bridgeDims(br)), br.x, br.baseY, br.z, br.yaw);
    if (game) {
      // as duas pontas ficam em alturas diferentes (uma margem é mais alta): a ponte inclina para acompanhar,
      // em vez de pairar sobre uma margem e afundar na outra
      const reach = br.length / 2 + 3.2;
      const hp = terrain.height(br.x + reach * Math.cos(br.yaw), br.z - reach * Math.sin(br.yaw));
      const hm = terrain.height(br.x - reach * Math.cos(br.yaw), br.z + reach * Math.sin(br.yaw));
      const pitch = Math.max(-0.3, Math.min(0.3, Math.atan2(hp - hm, reach * 2)));
      holder.rotation.order = 'YZX';
      holder.rotation.set(0, br.yaw, pitch);
      holder.position.y = (hp + hm) / 2 + 0.09;
      holder.updateMatrix();
      // as pernas da ponte descem até o leito (o modelo as corta na altura da margem); os encontros de pedra ganham uma faixa de parede até o chão
      conformFeetToGround(holder, terrain, ownDisposers);
      skirtStoneWalls(holder, terrain, ownDisposers);
    }
  }

  // ---- trees ------------------------------------------------------------------------------
  const treeVariants = lib ? lib.trees : new Map<string, { inst: AssetInstance; used: boolean }>();
  // no jogo as árvores são as do gerador do mundo (a vegetação natural cresce entre as casas)
  for (const t of game ? [] : plan.trees.slice(0, 24)) {
    const key = `${t.species}:${t.variant}`;
    let v = treeVariants.get(key);
    if (!v) {
      const cfg = { ...TREE_PRESETS[t.species], seed: hashSeed(modelSeed, t.species, t.variant) };
      const created = createTree(cfg);
      stripGround(created.group);
      const inst: AssetInstance = {
        group: created.group, assetGroup: created.group, bounds: new THREE.Box3().setFromObject(created.group),
        update: created.update, dispose: created.dispose, canFell: false,
      };
      v = { inst, used: false };
      treeVariants.set(key, v);
      breakdown['tree:' + key] = countTriangles(created.group);
      disposers.push(() => inst.dispose());
      updaters.push((time) => inst.update(time));
    }
    const holder = new THREE.Group();
    holder.position.set(t.x, t.baseY, t.z);
    holder.rotation.y = (t.x * 12.9898 + t.z * 78.233) % 6.28;
    holder.scale.setScalar(t.scale * 0.55);
    holder.add(v.used || lib ? v.inst.group.clone(true) : v.inst.group);
    v.used = true;
    holder.updateMatrix();
    holder.matrixAutoUpdate = false;
    assets.add(holder);
  }

  if (game) {
    // Casas com vida: barris, caixas, sacos, lenha, ferramentas e carroças encostados nas paredes, e cercas de madeira ao
    // lado de parte delas - só com o que o gerador já tem. Nada sobre ruas, água ou outra construção.
    const hash01 = (s: string, k: number): number => {
      let h = 2166136261;
      for (const ch of s + ':' + k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      return ((h >>> 0) % 10000) / 10000;
    };
    const streetPts = plan.streets.flatMap((s) => s.points.map((q) => ({ x: q[0], z: q[1], w: s.width / 2 })));
    const insideRect = (b: Footprint, x: number, z: number, r: number) => {
      const dx = x - b.x, dz = z - b.z, cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      return Math.abs(dx * cs - dz * sn) <= b.hw + r && Math.abs(dx * sn + dz * cs) <= b.hd + r;
    };
    const free = (self: Footprint, x: number, z: number, r: number): boolean => {
      if (terrain.isWater(x, z)) return false;
      if (streetPts.some((q) => Math.hypot(q.x - x, q.z - z) < q.w + r)) return false;
      if (plan.buildings.some((b) => b !== self && insideRect(b, x, z, r + 0.4))) return false;
      if (plan.bridges.some((br) => insideRect(br, x, z, r + 4))) return false;
      const sl = Math.hypot(terrain.height(x + 1, z) - terrain.height(x - 1, z), terrain.height(x, z + 1) - terrain.height(x, z - 1)) / 2;
      return sl < 0.45;
    };
    const plants = new Map<string, PlantGroup>();
    const SHRUBS: Record<string, GameTreeKind[]> = {
      hyrule: ['shrubHyrule', 'shrubBerry', 'shrubFlower'], satori: ['shrubSakura', 'shrubFlower', 'shrubBerry'], akkala: ['shrubBirch', 'shrubBerry'],
      hebra: ['shrubPine'], hebra_snowy: ['shrubSnow', 'shrubPine'], gerudo: ['shrubDesert'], savanna: ['shrubSavanna'], faron: ['shrubPalm'],
    };
    const SMALL: [StructureKind, number][] = [['woodenBarrel', 3], ['woodenCrate', 2], ['supplySacks', 2], ['toolRack', 1]];
    const RURAL_EXTRA: [StructureKind, number][] = [['woodenCart', 2], ['woodenCrate', 1], ['toolRack', 1]];
    const pickKind = (list: [StructureKind, number][], r: number): StructureKind => {
      const total = list.reduce((s, [, w]) => s + w, 0);
      let acc = 0;
      for (const [k, w] of list) { acc += w / total; if (r <= acc) return k; }
      return list[0][0];
    };
    for (const b of plan.buildings) {
      if (b.role === 'defence' || b.kind === 'watermill' || b.kind === 'windmill') continue;
      const n = 1 + (hash01(b.id, 1) > 0.45 ? 1 : 0) + (b.role === 'rural' ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const side = hash01(b.id, 10 + k) < 0.5 ? -1 : 1;
        const kind = pickKind(b.role === 'rural' && k === 0 ? RURAL_EXTRA : SMALL, hash01(b.id, 20 + k));
        const lx = side * (b.hw + 0.9 + hash01(b.id, 30 + k) * 0.8);
        const lz = -b.hd * 0.1 + hash01(b.id, 40 + k) * b.hd * 0.8;
        const [x, z] = toWorld(b, lx, lz);
        if (!free(b, x, z, 0.8)) continue;
        place(variantFor(kind, 0), x, terrain.height(x, z), z, b.yaw + (hash01(b.id, 50 + k) - 0.5) * 0.9);
      }
      // cercas: nas duas laterais e nos fundos do terreno de parte das casas (nunca na frente da porta)
      if (b.role === 'home' && hash01(b.id, 60) < 0.7) {
        for (const [fx, fz, quarter] of [[-(b.hw + 2.3), b.hd * 0.3, 1], [b.hw + 2.3, b.hd * 0.3, 1], [0, b.hd + 2.4, 0]] as [number, number, number][]) {
          if (hash01(b.id, 70 + Math.round(fx + fz)) < 0.2) continue;
          const half = quarter ? 2.2 : Math.min(2.4, b.hw);
          const a = quarter ? toWorld(b, fx, fz - half) : toWorld(b, fx - half, fz);
          const c = quarter ? toWorld(b, fx, fz + half) : toWorld(b, fx + half, fz);
          const mid = toWorld(b, fx, fz);
          if (![a, c, mid].every(([x, z]) => free(b, x, z, 0.7))) continue;
          place(variantFor('woodFence', 0), mid[0], terrain.height(mid[0], mid[1]), mid[1], b.yaw + (quarter ? Math.PI / 2 : 0));
        }
      }
      // jardim: arbustos e flores do mundo em volta da casa, fora da frente (onde fica o caminho da porta)
      const shrubs = SHRUBS[c.biome] ?? SHRUBS.hyrule;
      const nPlants = b.role === 'home' ? 7 : b.role === 'rural' ? 4 : 3;
      for (let k = 0; k < nPlants; k++) {
        const r1 = hash01(b.id, 100 + k), r2 = hash01(b.id, 120 + k), r3 = hash01(b.id, 140 + k);
        let lx: number, lz: number;
        if (r1 < 0.34) { lx = -(b.hw + 0.7 + r2 * 1.1); lz = (r3 * 2 - 1) * b.hd; }
        else if (r1 < 0.68) { lx = b.hw + 0.7 + r2 * 1.1; lz = (r3 * 2 - 1) * b.hd; }
        else { lx = (r3 * 2 - 1) * b.hw; lz = b.hd + 0.7 + r2 * 1.1; }
        // cantos da frente também ganham plantas, mas a faixa da porta fica livre
        const [x, z] = toWorld(b, lx, lz);
        if (!free(b, x, z, 0.5)) continue;
        const kind = hash01(b.id, 160 + k) < 0.55 ? shrubs[Math.floor(hash01(b.id, 180 + k) * shrubs.length) % shrubs.length] : (`flowers_${c.biome}` as GameTreeKind);
        addPlant(plants, kind, Math.floor(hash01(b.id, 200 + k) * 4), x, terrain.height(x, z), z, hash01(b.id, 220 + k) * 6.28, kind.startsWith('flowers') ? 0.7 : 0.55 + hash01(b.id, 240 + k) * 0.25);
      }
    }
    const planted = plantMeshes(plants);
    const plantGroup = planted.group;
    plantViewer = planted.setViewer;
    root.add(plantGroup);
    ownDisposers.push(() => plantGroup.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); }));
  }
  if (game) {
    // Praça de mercado: barracas em volta da árvore (as aberturas ficam onde as ruas chegam), com barris, caixas, sacos e
    // carroças junto a cada uma, e lanternas entre elas.
    const centre = plan.props.find((q) => q.id === 'centre');
    if (centre) {
      const cx = centre.x, cz = centre.z, pr = plan.plaza.radius;
      const hashA = (k: number, s: number): number => { const v = Math.sin(k * 127.1 + s * 311.7 + cx * 3.1 + cz * 1.7) * 43758.5453; return v - Math.floor(v); };
      const stallDims = realDims('market', 0);
      const nStalls = 6, Rs = pr * 0.68;
      const okAt = (x: number, z: number, r: number) => {
        if (terrain.isWater(x, z)) return false;
        for (const s of plan.streets) for (const q of s.points) if (Math.hypot(q[0] - x, q[1] - z) < s.width / 2 + r && Math.hypot(q[0] - cx, q[1] - cz) > pr * 0.95) return false;
        if (plan.buildings.some((b) => { const dx = x - b.x, dz = z - b.z, cs = Math.cos(b.yaw), sn = Math.sin(b.yaw); return Math.abs(dx * cs - dz * sn) <= b.hw + r && Math.abs(dx * sn + dz * cs) <= b.hd + r; })) return false;
        return true;
      };
      const SMALLP: StructureKind[] = ['woodenBarrel', 'woodenCrate', 'supplySacks', 'woodenBarrel', 'woodenCart'];
      for (let k = 0; k < nStalls; k++) {
        const th = (k / nStalls) * Math.PI * 2 + 0.35;
        const x = cx + Math.cos(th) * Rs, z = cz + Math.sin(th) * Rs;
        const yaw = Math.PI / 2 - th; // a frente da barraca olha para o centro
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const corners: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [x + (a * stallDims.width / 2) * cs + (b * stallDims.depth / 2) * sn, z - (a * stallDims.width / 2) * sn + (b * stallDims.depth / 2) * cs]);
        if (![[x, z] as [number, number], ...corners].every(([px, pz]) => okAt(px, pz, 0.6))) continue;
        place(variantFor('market', 0), x, terrain.height(x, z), z, yaw);
        // coisas em volta da barraca (lados e fundos)
        for (let j = 0; j < 3; j++) {
          const side = j === 0 ? -1 : j === 1 ? 1 : 0;
          const lx = side * (stallDims.width / 2 + 0.9), lz = side === 0 ? stallDims.depth / 2 + 1.0 : (hashA(k, j) - 0.2) * stallDims.depth * 0.6;
          const px = x + lx * cs + lz * sn, pz = z - lx * sn + lz * cs;
          if (!okAt(px, pz, 0.5)) continue;
          const kind = SMALLP[Math.floor(hashA(k, 10 + j) * SMALLP.length) % SMALLP.length];
          place(variantFor(kind, 0), px, terrain.height(px, pz), pz, yaw + (hashA(k, 20 + j) - 0.5) * 1.2);
        }
        // lanterna entre esta barraca e a próxima
        const la = th + Math.PI / nStalls, lx2 = cx + Math.cos(la) * (Rs * 0.95), lz2 = cz + Math.sin(la) * (Rs * 0.95);
        if (okAt(lx2, lz2, 0.4)) place(variantFor('stoneLantern', 0, { scale: 0.3 }), lx2, terrain.height(lx2, lz2), lz2, -la);
      }
    }
  }
  if (game) {
    // (as plantas do jardim entram junto com o resto, em um grupo à parte)
  }
  let mergeStep: (() => MergeStatus) | undefined;
  if (game) {
    const merge = mergeStatic(assets, { precompile: game.deferMerge ? game.precompile : undefined, onCommit: game.onMergeCommit });
    ownDisposers.push(merge.dispose);
    if (game.deferMerge) mergeStep = merge.step;
    else while (merge.step() === 1);
  }
  if (game && lib) {
    // Centro da praça: a árvore do mundo (a espécie que o bioma planta) num canteiro baixo de rochas do mundo, com flores.
    const centre = plan.props.find((q) => q.id === 'centre');
    const rockSpecies = `${c.biome}_rock`;
    const presets = TREE_PRESETS as Record<string, (typeof TREE_PRESETS)[keyof typeof TREE_PRESETS]>;
    const rockPreset = presets[rockSpecies];
    if (centre && rockPreset) {
      const gy = terrain.height(centre.x, centre.z);
      const plaza = new THREE.Group();
      plaza.name = 'plaza_centre';
      const instOf = (kind: GameTreeKind, k: number, scale: number, x: number, z: number, rotY: number, sy = 1) => {
        let vs;
        try { vs = getGameTrees(kind); } catch { return; }
        const pick = vs[k % vs.length];
        const g = new THREE.Group();
        g.position.set(x, terrain.height(x, z) - 0.05, z);
        g.rotation.y = rotY;
        g.scale.set(scale, scale * sy, scale);
        for (const part of pick.lods[0].parts) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1);
          mesh.setMatrixAt(0, new THREE.Matrix4());
          mesh.setColorAt(0, new THREE.Color(1, 1, 1));
          mesh.frustumCulled = false;
          mesh.castShadow = part.castShadow;
          mesh.receiveShadow = true;
          g.add(mesh);
        }
        plaza.add(g);
      };
      instOf((game.plazaTree ?? 'oak') as GameTreeKind, Math.abs(Math.floor(centre.x * 7.1 + centre.z * 3.3)), 0.75, centre.x, centre.z, 0);
      // canteiro: rochas baixas e redondas em círculo fechado, com flores do bioma dentro
      const R = 2.3, N = 12;
      const rockGroup = (i: number) => {
        const key = `plaza-planter:${rockSpecies}:${i}`;
        let v = lib.trees.get(key);
        if (!v) {
          const created = createTree({ ...rockPreset, seed: hashSeed(modelSeed, rockSpecies, 80 + i) });
          stripGround(created.group);
          const inst: AssetInstance = { group: created.group, assetGroup: created.group, bounds: new THREE.Box3().setFromObject(created.group), update: created.update, dispose: created.dispose, canFell: false };
          v = { inst, used: false };
          lib.trees.set(key, v);
          lib.disposers.push(() => inst.dispose());
          lib.updaters.push((time) => inst.update(time));
        }
        return v.inst.group;
      };
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const x = centre.x + Math.cos(a) * R, z = centre.z + Math.sin(a) * R;
        const h = new THREE.Group();
        h.position.set(x, terrain.height(x, z) - 0.12, z);
        h.rotation.y = -a - Math.PI / 2;
        h.scale.set(0.3 * 1.25, 0.3 * 0.5, 0.3 * 0.85);
        h.add(rockGroup(k % 3).clone(true));
        plaza.add(h);
      }
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.4;
        instOf(`flowers_${c.biome}` as GameTreeKind, k, 0.6, centre.x + Math.cos(a) * (R - 0.9), centre.z + Math.sin(a) * (R - 0.9), k * 1.7);
      }
      void gy;
      root.add(plaza);
    }
  }

  // ---- result ---------------------------------------------------------------------------------
  let meshes = 0, triangles = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { meshes++; const g = m.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; }
  });
  plan.stats.meshes = meshes;
  plan.stats.triangles = Math.round(triangles);
  plan.stats.planMs = Math.round(tPlan);
  plan.stats.totalMs = Math.round(performance.now() - t0);
  console.info('[settlement]', c.type, source.seed, JSON.stringify(plan.stats));
  const finalReport = validatePlan(plan, terrain, realRect);
  root.userData.settlementPlan = plan;
  root.userData.settlementValidation = finalReport;
  root.name = `Settlement_${c.type}_${source.seed}`;
  const bounds = new THREE.Box3(
    new THREE.Vector3(plan.centre[0] - half, -8, plan.centre[1] - half),
    new THREE.Vector3(plan.centre[0] + half, 30, plan.centre[1] + half)
  );
  return {
    group: root,
    assetGroup: assets,
    mergeStep,
    bounds,
    canFell: false,
    setViewer: (x, z) => plantViewer?.(x, z),
    update: (t) => { if (!lib) for (const u of updaters) u(t); },
    dispose: () => { for (const d of ownDisposers) d(); if (!lib) for (const d of disposers) d(); },
  };
}

// ---------------------------------------------------------------------------
// terrain mesh
// ---------------------------------------------------------------------------

/** Terrain height, blended flat under every pad so buildings never float or sink. */
function makeHeightAt(terrain: TerrainSampler, pads: Pad[]) {
  const blend = 6;
  const aabb = pads.map((p) => {
    const r = Math.hypot(p.hw, p.hd) + blend;
    return { p, minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, c: Math.cos(p.yaw), s: Math.sin(p.yaw) };
  });
  return (x: number, z: number): number => {
    let h = terrain.height(x, z);
    for (const a of aabb) {
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      const dx = x - a.p.x, dz = z - a.p.z;
      const lx = Math.abs(dx * a.c - dz * a.s), lz = Math.abs(dx * a.s + dz * a.c);
      const ox = Math.max(0, lx - a.p.hw), oz = Math.max(0, lz - a.p.hd);
      const d = Math.hypot(ox, oz);
      if (d >= blend) continue;
      const t = d / blend;
      const w = 1 - t * t * (3 - 2 * t);
      h += (a.p.y - h) * w;
    }
    return h;
  };
}

function buildGround(plan: SettlementPlan, terrain: TerrainSampler, heightAt: (x: number, z: number) => number, half: number, biome: keyof typeof ROCK_BIOMES) {
  const step = Math.max(1.5, half / 110);
  const n = Math.floor((half * 2) / step) + 1;
  const [cx, cz] = plan.centre;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const grass = new THREE.Color(biome === 'hebra_snowy' ? '#e4edf6' : ROCK_BIOMES[biome].ground);
  const mud = new THREE.Color('#6d5a3d');
  const rock = new THREE.Color('#7b786d');
  const tmp = new THREE.Color();
  let anyWater = false;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx - half + i * step, z = cz - half + j * step;
      const h = heightAt(x, z);
      const k = (j * n + i) * 3;
      positions[k] = x; positions[k + 1] = h; positions[k + 2] = z;
      const slope = Math.hypot(heightAt(x + 1.5, z) - heightAt(x - 1.5, z), heightAt(x, z + 1.5) - heightAt(x, z - 1.5)) / 3;
      const noise = (Math.sin(x * 0.37 + z * 0.21) * Math.sin(z * 0.43 - x * 0.17)) * 0.022;
      tmp.copy(grass).offsetHSL(0, 0, noise - Math.min(0.14, slope * 0.2));
      if (slope > 0.5) tmp.lerp(rock, Math.min(1, (slope - 0.5) * 2));
      if (h < terrain.waterLevel + 0.15) { tmp.lerp(mud, h < terrain.waterLevel ? 0.85 : 0.5); }
      if (h < terrain.waterLevel) anyWater = true;
      colors[k] = tmp.r; colors[k + 1] = tmp.g; colors[k + 2] = tmp.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'SettlementTerrain';
  mesh.receiveShadow = true;
  mesh.userData.excludeFromOBJ = false;
  const group = new THREE.Group();
  group.add(mesh);
  const disposables: { dispose: () => void }[] = [geo, mat];

  // a dark skirt closes the edge of the slab
  const edge: [number, number][] = [];
  for (let i = 0; i < n; i++) edge.push([i, 0]);
  for (let j = 1; j < n; j++) edge.push([n - 1, j]);
  for (let i = n - 2; i >= 0; i--) edge.push([i, n - 1]);
  for (let j = n - 2; j > 0; j--) edge.push([0, j]);
  const sp: number[] = [], si: number[] = [];
  edge.forEach(([i, j], e) => {
    const k = (j * n + i) * 3;
    sp.push(positions[k], positions[k + 1], positions[k + 2], positions[k], -8, positions[k + 2]);
    const a = e * 2, b = ((e + 1) % edge.length) * 2;
    si.push(a, a + 1, b, b, a + 1, b + 1);
  });
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  skirtGeo.setIndex(si);
  skirtGeo.computeVertexNormals();
  const skirtMat = new THREE.MeshStandardMaterial({ color: '#4a3b2a', roughness: 1, side: THREE.DoubleSide });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.name = 'SettlementTerrainSkirt';
  group.add(skirt);
  disposables.push(skirtGeo, skirtMat);

  if (anyWater) {
    const wGeo = new THREE.PlaneGeometry(half * 2, half * 2);
    wGeo.rotateX(-Math.PI / 2);
    const wMat = new THREE.MeshStandardMaterial({ color: '#3d7f9d', transparent: true, opacity: 0.82, roughness: 0.25 });
    const water = new THREE.Mesh(wGeo, wMat);
    water.position.set(cx, terrain.waterLevel, cz);
    water.name = 'SettlementWater';
    water.userData.excludeFromOBJ = true;
    group.add(water);
    disposables.push(wGeo, wMat);
  }
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
}

// ---------------------------------------------------------------------------
// streets and plaza as ribbons draped on the ground
// ---------------------------------------------------------------------------

function buildRoads(plan: SettlementPlan, terrain: TerrainSampler, heightAt: (x: number, z: number) => number, type: string) {
  const stoneMain = type === 'town' || type === 'fortifiedTown' || type === 'village';
  const col = {
    main: new THREE.Color(stoneMain ? '#8e8a80' : '#967348'),
    secondary: new THREE.Color('#8a6a40'),
    lane: new THREE.Color('#7b6039'),
    plaza: new THREE.Color('#9a968b'),
  };
  const pos: number[] = [], clr: number[] = [], idx: number[] = [];
  const lift = 0.07;
  const yAt = (x: number, z: number) => Math.max(heightAt(x, z), terrain.isWater(x, z) ? terrain.waterLevel + 0.25 : -99) + lift;
  const tmp = new THREE.Color();
  for (const s of plan.streets) {
    const base = pos.length / 3;
    const n = s.points.length;
    for (let i = 0; i < n; i++) {
      const p = s.points[i];
      const a = s.points[Math.max(0, i - 1)], b = s.points[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const w = s.width / 2 * (0.94 + 0.12 * Math.sin(i * 1.7));
      for (const side of [-1, 1]) {
        const x = p[0] - tz * w * side, z = p[1] + tx * w * side;
        pos.push(x, yAt(x, z), z);
        tmp.copy(col[s.cls]).offsetHSL(0, 0, (Math.sin(x * 0.9 + z * 1.3) * 0.02) - (Math.abs(side) > 0 && side === 1 ? 0 : 0));
        clr.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // the plaza: a paved disc
  {
    const base = pos.length / 3;
    const seg = 28;
    pos.push(plan.plaza.x, yAt(plan.plaza.x, plan.plaza.z), plan.plaza.z);
    clr.push(col.plaza.r, col.plaza.g, col.plaza.b);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const r = plan.plaza.radius * (0.92 + 0.12 * Math.sin(a * 5 + 1));
      const x = plan.plaza.x + Math.cos(a) * r, z = plan.plaza.z + Math.sin(a) * r;
      pos.push(x, yAt(x, z), z);
      tmp.copy(col.plaza).offsetHSL(0, 0, Math.sin(a * 7) * 0.025);
      clr.push(tmp.r, tmp.g, tmp.b);
    }
    for (let i = 0; i < seg; i++) idx.push(base, base + 1 + ((i + 1) % seg), base + 1 + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'SettlementStreets';
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, dispose: () => { geo.dispose(); mat.dispose(); } };
}

// kept for tests and tooling
export { PointGrid, rectsOverlap };
