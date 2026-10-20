import * as THREE from 'three';
import type { TerrainGenerator } from '../terrain/terrainGenerator.ts';
import { CONFIG } from '../../config.ts';
import { SETTLEMENT_CELL, SETTLEMENT_SCALE, type SettlementEntry } from './settlementField.ts';
import { createSettlement, createSettlementLibrary, settlementWarmupTasks, type SettlementLibrary } from './builder';
import type { TerrainSampler } from './types';
import { STRUCTURE_PRESETS } from '../structures/catalog';
import { VEGETABLE_DETAIL } from '../structures/geometry/vegetables';
import { BiomeType } from '../types.ts';
import { groveAt } from '../vegetation/vegetationPlanner.ts';
import type { GameTreeKind } from '../vegetation/pixelTrees/gameTrees';
import { enableAssetEnvironment } from '../vegetation/pixelTrees/services/assetEnvironment';

/** distância (m) até onde as cidades são planejadas (antes dos chunks chegarem) e montadas */
const PLAN_RADIUS = 1500;
const BUILD_RADIUS = 640;
/** os modelos (a parte cara) são gerados com a cidade ainda longe, enquanto o jogador anda: a montagem, ao chegar, só clona */
const WARM_RADIUS = 1400;
const DROP_RADIUS = 800;

interface Town {
  entry: SettlementEntry;
  tasks: { label: string; run: () => void }[] | null;
  group: THREE.Group | null;
  update: ((t: number) => void) | null;
  dispose: (() => void) | null;
  /** fusão das peças estáticas, um grupo por quadro depois da montagem (null quando terminou) */
  mergeStep: (() => 0 | 1 | 2) | null;
  /** posição do jogador para o detalhe das plantas (espaço da cidade) */
  setViewer: ((x: number, z: number) => void) | null;
  /** malhas de água: vivem no grupo de água do mundo (desenhado em passe próprio, com profundidade e reflexo) */
  waters: THREE.Object3D[];
  /** luzes das lanternas: filhas diretas da cena (ver `assemble`) */
  lights: THREE.Light[];
  /** grupo das plantas do jardim (fica de fora do reflexo da água: a imagem é pequena e borrada) */
  plants: THREE.Object3D | null;
  /** esferas (mundo) das malhas da cidade pronta, para o corte por distância do reflexo da água */
  spheres: { o: THREE.Object3D; c: THREE.Vector3; r: number }[] | null;
}

/**
 * Mantém as cidades em volta do jogador: o worker planeja as células próximas (o terreno só é
 * achatado depois que o plano chega), e a cidade é montada quando o jogador chega perto - os
 * modelos um por quadro, depois a montagem, que só clona.
 */
export class SettlementManager {
  private group = new THREE.Group();
  private worker: Worker | null = null;
  private requested = new Set<string>();
  private towns = new Map<string, Town>();
  private library: SettlementLibrary;
  private seed: number;
  private clock = 0;
  private waterGroup: THREE.Group | null = null;
  /** só uma tarefa pesada de montagem por vez, com folga proporcional ao que a anterior custou */
  private nextWork = 0;

  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, private terrainGen: TerrainGenerator, private waterMaterial?: THREE.Material, private onSceneChanged: () => void = () => {}) {
    this.scene = scene;
    this.group.name = 'settlements';
    // o material de água do mundo já tem névoa e luz próprias: enableAssetEnvironment não pode remendá-lo de novo
    if (waterMaterial) waterMaterial.userData.assetEnvironment = true;
    scene.add(this.group);
    this.seed = terrainGen.getSeed();
    this.library = createSettlementLibrary(this.seed, this.waterMaterial);
    VEGETABLE_DETAIL.cells = 7;
    terrainGen.settlements.mode = 'external';
    if (CONFIG.SETTLEMENTS_ENABLED) this.startWorker();
  }

  /** Grupo de água do mundo: a água das fontes e canais é desenhada ali, com o shader do mundo. */
  public attachWater(group: THREE.Group): void { this.waterGroup = group; }

  /** Compila os shaders da cidade em segundo plano (compilação paralela) para o primeiro desenho não travar o quadro. */
  public setPrecompiler(fn: (obj: THREE.Object3D) => Promise<unknown>): void { this.precompile = fn; }
  private precompile: ((obj: THREE.Object3D) => Promise<unknown>) | null = null;

  private startWorker(): void {
    this.worker = new Worker(new URL('./settlement.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<{ seed: number; cx: number; cz: number; entry: SettlementEntry | null }>) => {
      const { seed, cx, cz, entry } = ev.data;
      if (seed !== this.seed) return;
      this.terrainGen.settlements.provide(cx, cz, entry);
      if (entry) {
        console.info(`[cidade] ${entry.site.kind} em (${Math.round(entry.site.x)}, ${Math.round(entry.site.z)}): ${entry.plan.buildings.length} construções`);
        this.towns.set(cx + ':' + cz, { entry, tasks: null, group: null, update: null, dispose: null, mergeStep: null, setViewer: null, lights: [], plants: null, spheres: null, waters: [] });
      }
    };
  }

  public update(x: number, z: number): void {
    if (!CONFIG.SETTLEMENTS_ENABLED) return;
    this.clock = performance.now() / 1000;
    const field = this.terrainGen.settlements;
    // planejar: uma célula por vez no worker
    const r = Math.ceil(PLAN_RADIUS / SETTLEMENT_CELL) + 1;
    const ccx = Math.floor(x / SETTLEMENT_CELL), ccz = Math.floor(z / SETTLEMENT_CELL);
    if (this.worker && this.requested.size - this.towns.size < 64) {
      let best: { cx: number; cz: number; d: number } | null = null;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const cx = ccx + dx, cz = ccz + dz, key = cx + ':' + cz;
        if (this.requested.has(key) || field.has(cx, cz)) continue;
        const site = field.siteAt(cx, cz);
        if (!site) { field.provide(cx, cz, null); this.requested.add(key); continue; }
        const d = Math.hypot(site.x - x, site.z - z);
        if (d < PLAN_RADIUS && (!best || d < best.d)) best = { cx, cz, d };
      }
      if (best) {
        this.requested.add(best.cx + ':' + best.cz);
        this.worker.postMessage({ seed: this.seed, cx: best.cx, cz: best.cz });
      }
    }
    // montar / desmontar: as cidades já montadas se atualizam (ou saem se ficaram longe); das que faltam, só a MAIS PERTO do jogador
    // trabalha, e tarefas baratas (modelo já em cache) rodam várias por quadro dentro de um orçamento, sem esperar o intervalo
    let target: { key: string; town: Town; d: number } | null = null;
    for (const [key, town] of this.towns) {
      const e = town.entry;
      const d = Math.hypot(e.site.x - x, e.site.z - z);
      if (town.group) {
        if (d > DROP_RADIUS) this.unload(town);
        else {
          town.update?.(this.clock);
          town.setViewer?.((x - e.site.x) / SETTLEMENT_SCALE, (z - e.site.z) / SETTLEMENT_SCALE);
          if (town.mergeStep) {
            // vários grupos por quadro enquanto couberem em ~4 ms (um grupo sozinho custa 1–3 ms)
            const t0 = performance.now();
            let st: 0 | 1 | 2 = 1;
            while (st === 1 && performance.now() - t0 < 4) st = town.mergeStep();
            if (st === 0) { town.mergeStep = null; this.onSceneChanged(); this.freeze(town); }
          }
        }
        continue;
      }
      const hasWork = !town.tasks || town.tasks.length > 0 || d <= BUILD_RADIUS;
      if (d <= WARM_RADIUS && hasWork && (!target || d < target.d)) target = { key, town, d };
    }
    if (target && this.clock >= this.nextWork) {
      const { key, town } = target;
      const e = town.entry;
      if (!town.tasks) town.tasks = settlementWarmupTasks(e.plan, this.library, e.site.biome);
      const start = performance.now();
      while (performance.now() - start < 8) {
        const t0 = performance.now();
        if (town.tasks.length === 0 && target.d > BUILD_RADIUS) break;   // modelos prontos; espera o jogador chegar para montar
        const task = town.tasks.shift();
        if (task) task.run(); else { this.assemble(key, town); this.nextWork = performance.now() / 1000 + 0.05; break; }
        const cost = performance.now() - t0;
        if (cost > 12) { this.nextWork = performance.now() / 1000 + Math.max(0.03, cost * 0.002); break; }   // tarefa pesada: o próximo quadro respira
      }
    }
  }

  private assemble(_key: string, town: Town): void {
    const { entry } = town;
    const { site, plan } = entry;
    const field = this.terrainGen.settlements;
    const ox = site.x, oz = site.z, S = SETTLEMENT_SCALE;
    const terrain: TerrainSampler = {
      // espaço da cidade: metros / SETTLEMENT_SCALE (o grupo é escalado de volta ao entrar no mundo)
      height: (x, z) => this.terrainGen.getHeight(ox + x * S, oz + z * S) / S,
      isWater: (x, z) => this.terrainGen.getHeightRaw(ox + x * S, oz + z * S) < this.terrainGen.getWaterSurfaceY(ox + x * S, oz + z * S) - 0.04,
      waterLevel: site.waterLevel,
    };
    void field;
    const source = { ...STRUCTURE_PRESETS.structure_house, seed: site.seed, structure: { ...STRUCTURE_PRESETS.structure_house.structure, type: site.kind, biome: site.biome } };
    // a cópia do plano: o construtor poda construções que se sobrepõem
    const planCopy = structuredClone(plan);
    const inst = createSettlement(source as never, { terrain, plan: planCopy, pads: entry.pads, library: this.library, withGround: false, deferMerge: true, precompile: this.precompile ?? undefined, onMergeCommit: () => this.onSceneChanged(), plazaTree: this.plazaTreeKind(site.x + (plan.plaza.x) * SETTLEMENT_SCALE, site.z + plan.plaza.z * SETTLEMENT_SCALE) });
    inst.group.position.set(ox, 0, oz);
    inst.group.scale.setScalar(S);
    inst.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).receiveShadow = true; } });
    enableAssetEnvironment(inst.group);
    this.group.add(inst.group);
    if (this.precompile) {
      // escondida até os programas ficarem prontos (no máximo 0,5 s, para nunca deixar a cidade sumida)
      const g = inst.group;
      g.visible = false;
      const show = () => { g.visible = true; this.onSceneChanged(); };
      const timer = setTimeout(show, 500);
      this.precompile(g).catch(() => undefined).then(() => { clearTimeout(timer); show(); });
    }
    if (this.waterGroup && this.library.water) {
      const waters: THREE.Object3D[] = [];
      inst.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === this.library.water) waters.push(o); });
      inst.group.updateMatrixWorld(true);
      // o shader de água do mundo espera a malha como o oceano: girada -90° em X e em coordenadas de mundo
      // (ondas, grade de pixels e normais saem de pos.xy + translação). Aqui a geometria é cozida
      // em mundo e girada, e a malha entra no grupo de água sem transformação própria além da rotação.
      const placed: THREE.Mesh[] = [];
      for (const w of waters) {
        const src = w as THREE.Mesh;
        const geo = src.geometry.clone().applyMatrix4(src.matrixWorld).rotateX(Math.PI / 2);
        const mesh = new THREE.Mesh(geo, src.material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = src.renderOrder;
        mesh.userData.assetEnvironmentRegistered = true;
        mesh.frustumCulled = true;
        src.removeFromParent();
        this.waterGroup.add(mesh);
        placed.push(mesh);
      }
      town.waters = placed;
    }
    // As luzes das lanternas viram filhas diretas da cena: a camada de longe esconde os grupos da cidade ao desenhar e, com a luz escondida
    // junto, a contagem de luzes mudava duas vezes por quadro e todo material iluminado recompilava a ficha do programa (~15% da CPU).
    inst.group.updateMatrixWorld(true);
    const lamps: THREE.Light[] = [];
    inst.group.traverse((o) => { if ((o as THREE.Light).isLight) lamps.push(o as THREE.Light); });
    const wp = new THREE.Vector3();
    for (const l of lamps) {
      l.getWorldPosition(wp);
      l.removeFromParent();
      l.position.copy(wp);
      this.scene.add(l);
    }
    town.lights = lamps;
    town.plants = inst.group.getObjectByName('village_plants') ?? null;
    town.group = inst.group;
    this.onSceneChanged();
    town.update = inst.update;
    town.dispose = inst.dispose;
    town.mergeStep = inst.mergeStep ?? null;
    town.setViewer = inst.setViewer ?? null;
    if (!town.mergeStep) this.freeze(town);
  }

  /**
   * A cidade pronta não se mexe (a biblioteca de modelos não anima nada nela): as matrizes locais ficam fixas e o motor deixa de
   * recompor e multiplicar as ~700 matrizes dos objetos a cada quadro (era ~15% da CPU de quadro dentro de uma cidade).
   */
  private freeze(town: Town): void {
    const g = town.group;
    if (!g) return;
    g.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    g.updateMatrixWorld(true);
  }

  /** Árvore do centro da praça: a espécie que o mundo mais planta no bioma dali. */
  private plazaTreeKind(x: number, z: number): GameTreeKind {
    const biome = this.terrainGen.getPointFast(x, z).biome;
    // bosques especiais (cerejeiras, árvores ancestrais) mandam no que o mundo planta ali
    const grove = groveAt(x, z, biome.type, biome.moisture);
    if (biome.type === BiomeType.SAKURA_GROVE) return 'sakura';
    if (grove) return 'korok';
    const d = biome.treeTypeDistribution as unknown as Record<string, number | undefined>;
    const map: [string, GameTreeKind][] = [
      ['oak', 'oak'], ['pine', 'pine'], ['birch', 'birch'], ['acacia', 'acacia'], ['coastalPalm', 'palm'], ['autumnMaple', 'mapleRed'],
      ['snowPine', 'snowPine'], ['arcticWillow', 'willow'], ['mangrove', 'mangrove'],
    ];
    let best: GameTreeKind = 'oak', w = 0;
    for (const [key, kind] of map) if ((d[key] ?? 0) > w) { w = d[key] ?? 0; best = kind; }
    return best;
  }

  private unload(town: Town): void {
    if (!town.group) return;
    this.onSceneChanged();
    this.group.remove(town.group);
    for (const w of town.waters) { w.removeFromParent(); (w as THREE.Mesh).geometry.dispose(); }
    town.waters = [];
    for (const l of town.lights) l.removeFromParent();
    town.lights = [];
    town.plants = null;
    town.spheres = null;
    // geometrias e materiais são da biblioteca (compartilhados); só o que a cidade criou sozinha vai embora
    town.dispose?.();
    town.group = null;
    town.update = null;
    town.dispose = null;
    town.tasks = null;
  }

  /** Esconde o que não aparece no reflexo da água (plantas do jardim); devolve o que escondeu, para o chamador mostrar de novo. */
  public hideForReflection(cam: THREE.Vector3, maxDist: number): THREE.Object3D[] {
    const hidden: THREE.Object3D[] = [];
    for (const town of this.towns.values()) {
      const p = town.plants;
      if (!town.group) continue;
      if (p && p.visible) { p.visible = false; hidden.push(p); }
      // as peças a mais de `maxDist` metros (como as árvores e os chunks distantes) não entram no reflexo de 256 x 256: viram poucos pixels
      if (town.mergeStep) continue;                       // (a fusão ainda muda as malhas)
      if (!town.spheres) {
        const list: { o: THREE.Object3D; c: THREE.Vector3; r: number }[] = [];
        town.group.updateMatrixWorld(true);
        town.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;       // (instanciadas: bandas de LOD próprias, ficam como estão)
          const g = m.geometry;
          if (!g.boundingSphere) g.computeBoundingSphere();
          const s = g.boundingSphere!;
          const sc = Math.max(m.matrixWorld.getMaxScaleOnAxis(), 1e-6);
          list.push({ o: m, c: s.center.clone().applyMatrix4(m.matrixWorld), r: s.radius * sc });
        });
        town.spheres = list;
      }
      for (const s of town.spheres) {
        if (s.o.visible && s.c.distanceTo(cam) - s.r > maxDist) { s.o.visible = false; hidden.push(s.o); }
      }
    }
    return hidden;
  }

  /** Cidades montadas agora (depuração). */
  public list(): { kind: string; x: number; z: number; built: boolean }[] {
    return [...this.towns.values()].map((t) => ({ kind: t.entry.site.kind, x: t.entry.site.x, z: t.entry.site.z, built: !!t.group }));
  }

  public reset(): void {
    for (const t of this.towns.values()) this.unload(t);
    this.towns.clear();
    this.requested.clear();
    this.seed = this.terrainGen.getSeed();
    this.terrainGen.settlements.reset();
    this.terrainGen.settlements.mode = 'external';
    this.library = createSettlementLibrary(this.seed, this.waterMaterial);
  }
}
