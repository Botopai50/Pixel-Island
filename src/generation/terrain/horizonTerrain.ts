import * as THREE from 'three';
import { getTextureWorkerPool } from './textureWorkerPool.ts';
import { setupCartoonMaterial } from '../vegetation/vegetationManager.ts';
import { FADE, FADE_GLSL } from '../shaders/fadeDither.ts';
import { IMPOSTOR_TYPES, HORIZON_L0_LOWER, HorizonTreeData } from './horizonGeometry.ts';
import { IMPOSTOR_BLOCK } from './horizonTrees.ts';

/**
 * Terreno do horizonte (no estilo "Distant Horizons"): além dos chunks detalhados, blocos de malha
 * grossa com a cor do chão por vértice cobrem até ~12km, em 3 níveis de detalhe concêntricos.
 * Cada nível só é desenhado no próprio anel (o shader descarta o resto): o de perto começa onde os
 * chunks detalhados acabam, e os anéis se sobrepõem um pouco com o mais grosso um pouco mais baixo
 * (sem frestas nem briga entre eles). Gerado nos workers com a menor prioridade de todas.
 *
 * O nível mais perto também traz as árvores distantes (impostores: um quadro virado para a câmera
 * com a imagem da árvore original) até ~3km, EXATAMENTE nas posições da vegetação de verdade
 * (mesmo planejamento, nos workers, em pedaços de 256m): além do raio da vegetação cada árvore
 * de verdade vira a sua imagem no mesmo lugar, sem pontilhado nem árvores sumindo/aparecendo. O chão ganha
 * "pixels" em tons discretos do tamanho de alguns pixels da tela (o estilo das texturas de perto).
 */
interface HorizonLevel {
  size: number;   // lado do bloco (m)
  seg: number;    // subdivisões da malha do bloco
  outer: number;  // raio externo do anel (m)
  lower: number;  // quanto o nível desce (o mais fino ganha na sobreposição)
  /** "pixel" da textura procedural do chão (m), fixo no mundo */
  px: number;
}

const LEVELS: HorizonLevel[] = [
  // blocos grandes (poucas chamadas de desenho), 64 subdivisões cada
  { size: 1024, seg: 64, outer: 3000, lower: HORIZON_L0_LOWER, px: 2 },  // vértices a 16m
  { size: 2048, seg: 64, outer: 6000, lower: 2.5, px: 2 },  // 32m
  { size: 4096, seg: 64, outer: 12000, lower: 6.0, px: 2 }, // 64m
];
/** sobreposição entre um anel e o seguinte (m): faixa em que o mais fino some com pontilhado */
const OVERLAP = 250;
/** a câmera anda isso antes de refazer a lista de blocos */
const REPLAN_DIST = 200;
/** prioridade na fila dos workers: depois de todos os chunks e melhorias de LOD (1000 + distância) */
const PRIORITY_BASE = 20000;
/** alcance das árvores distantes (encolhem até sumir nos últimos 500m) */
const TREE_OUTER = LEVELS[0].outer;

interface HorizonTile {
  key: string;
  level: number;
  mesh?: THREE.Mesh;
  trees?: THREE.Mesh;
  /** pedaços de árvores já recebidos e os pedidos ainda na fila */
  treeParts: HorizonTreeData[];
  treeReqs: number[];
  cancelled: boolean;
  reqId: number;
}

type RingUniforms = { uCenter: { value: THREE.Vector2 }; uInner: { value: number }; uOuter: { value: number }; uPx: { value: number }; uMorphLower: { value: number }; uFadeCell: { value: number } };

export class HorizonTerrain {
  private group = new THREE.Group();
  private tiles = new Map<string, HorizonTile>();
  private materials: THREE.MeshToonMaterial[] = [];
  private uniforms: RingUniforms[] = [];
  /** material das árvores distantes: só existe depois que o atlas de impostores foi desenhado */
  private treeMaterial?: THREE.MeshLambertMaterial;
  private treeUniforms = {
    uCenter: { value: new THREE.Vector2() },
    uImp: { value: [] as THREE.Vector3[] },
    uCells: { value: new THREE.Vector2(4, 3) },
    uAtlasSize: { value: new THREE.Vector2(512, 384) },
    uTreeOuter: { value: TREE_OUTER },
  };
  private planX = Infinity;
  private planZ = Infinity;
  private planHole = -1;
  private seed: number;
  private activeLevels = LEVELS.length;
  private distanceScale = 1.0;
  private treeOuter = TREE_OUTER;

  constructor(scene: THREE.Scene, gradientMap: THREE.Texture, seed: number) {
    this.seed = seed;
    this.group.name = 'horizon';
    scene.add(this.group);
    for (let l = 0; l < LEVELS.length; l++) {
      const u: RingUniforms = {
        uCenter: { value: new THREE.Vector2() }, uInner: { value: 0 }, uOuter: { value: LEVELS[l].outer }, uPx: { value: LEVELS[l].px },
        // o nível seguinte fica mais baixo: o morph desce junto (o último não tem seguinte)
        uMorphLower: { value: l + 1 < LEVELS.length ? LEVELS[l + 1].lower - LEVELS[l].lower : 0 },
        // blocos da transição para o anel seguinte: alguns pixels de lado na distância do fim do anel
        uFadeCell: { value: 16 * Math.pow(2, l) },
      };
      const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        // geomorphing: no fim do anel a malha toma a forma do nível seguinte antes do pontilhado
        sh.vertexShader = 'attribute float morph;\nuniform vec2 uCenter;\nuniform float uOuter;\nuniform float uMorphLower;\nvarying vec3 vHzPos;\nvarying vec3 vHzN;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            // posição para a textura antes do morph (a textura fica presa ao relevo, sem deslizar)
            '  vHzPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
            '  vHzN = normal;',
            '  {',
            '    float hzM = smoothstep(uOuter - 150.0, uOuter + 20.0, distance(vHzPos.xz, uCenter));',
            '    if (uMorphLower > 0.0) transformed.y += (morph - uMorphLower) * hzM;',
            '  }',
          ].join('\n')
        );
        sh.fragmentShader = [
          'varying vec3 vHzPos;',
          'varying vec3 vHzN;',
          'uniform vec2 uCenter;',
          'uniform float uInner;',
          'uniform float uOuter;',
          'uniform float uPx;',
          'uniform float uFadeCell;',
          FADE_GLSL,
          'float hzHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
          // cor de um "pixel" (célula de lado 'cell'): 4 tons discretos (sombra azulada até realce
          // amarelado, como as paletas das texturas de perto), e manchas 4x maiores
          'vec3 hzPix(vec2 uv, float cell, float wall) {',
          '  float n = hzHash(floor(uv / cell) + cell * 0.173);',
          '  float n2 = hzHash(floor(uv / (cell * 4.0)) + cell * 0.311 + 31.7);',
          '  vec3 t = n < 0.22 ? vec3(0.66, 0.74, 0.74) : n < 0.55 ? vec3(0.88, 0.92, 0.9) : n < 0.85 ? vec3(1.05, 1.04, 0.98) : vec3(1.2, 1.16, 0.94);',
          '  vec3 tw = vec3(n < 0.2 ? 0.6 : n < 0.55 ? 0.84 : n < 0.85 ? 1.0 : 1.16);',
          '  return mix(t, tw, wall) * (n2 < 0.5 ? 0.92 : 1.05);',
          '}',
          sh.fragmentShader,
        ].join('\n')
          // fim do anel: blocos presos ao mundo somem ao longo da sobreposição, mostrando o nível
          // seguinte (logo abaixo)
          .replace('void main() {', 'void main() {\n  float hzD = distance(vHzPos.xz, uCenter);\n  if (hzD < uInner || fadeHash(floor(vHzPos.xz / uFadeCell)) > 1.0 - smoothstep(uOuter, uOuter + 250.0, hzD)) discard;')
          // "pixels" do chão em tons discretos (como as texturas pixel art de perto), de tamanho fixo
          // no mundo (2m e manchas de 8m e 32m): nada muda com a câmera andando. Cada escala some
          // suave quando o pixel dela fica pequeno demais na tela (menos de ~2 pixels), em vez de
          // trocar de tamanho (a troca fazia o padrão das montanhas piscar). Paredões: projeção de
          // lado e blocos mais largos que altos (estratos de rocha), com mais contraste.
          .replace('#include <color_fragment>', [
            '#include <color_fragment>',
            '  {',
            '    vec3 hzA = abs(normalize(vHzN));',
            '    float hzWall = 1.0 - smoothstep(0.55, 0.7, hzA.y);',
            '    vec2 hzUV = hzA.y >= 0.62 ? vHzPos.xz : (hzA.x > hzA.z ? vHzPos.zy : vHzPos.xy);',
            '    if (hzA.y < 0.62) hzUV.x *= 0.5;',
            '    vec2 hzFw = fwidth(hzUV);',
            '    float hzFoot = max(max(hzFw.x, hzFw.y), 1e-4);',
            '    vec3 hzTone = vec3(1.0);',
            '    for (int k = 0; k < 3; k++) {',
            '      float hzC = uPx * exp2(float(k) * 2.0);',
            '      float hzF = 1.0 - smoothstep(0.35, 0.6, hzFoot / hzC);',
            '      hzTone *= mix(vec3(1.0), hzPix(hzUV, hzC, hzWall), hzF * (k == 0 ? 1.0 : 0.6));',
            '    }',
            '    diffuseColor.rgb *= hzTone;',
            '  }',
          ].join('\n'));
      };
      mat.customProgramCacheKey = () => 'horizon_ring';
      this.materials.push(mat);
      this.uniforms.push(u);
    }

  }

  /**
   * Reduz o horizonte em hardware fraco. Isso corta tanto draw calls quanto trabalho dos workers.
   * activeLevels: 1..3. distanceScale encurta o raio de cada anel.
   */
  public setQuality(activeLevels: number, distanceScale: number): void {
    this.activeLevels = THREE.MathUtils.clamp(Math.round(activeLevels), 1, LEVELS.length);
    this.distanceScale = THREE.MathUtils.clamp(distanceScale, 0.35, 1.0);
    this.treeOuter = Math.min(TREE_OUTER, LEVELS[0].outer * this.distanceScale);
    this.treeUniforms.uTreeOuter.value = this.treeOuter;
    this.planX = Infinity;
    this.planZ = Infinity;
    this.planHole = -1;

    // O próximo update remove automaticamente tiles que ficaram fora do novo orçamento.
  }

  /**
   * Atlas de impostores das árvores (desenhado na thread principal com os modelos originais).
   * info: por tipo (lado S, centro x, centro y) da imagem em metros.
   */
  public setTreeAtlas(texture: THREE.Texture, info: THREE.Vector3[], cols: number, rows: number): void {
    const tu = this.treeUniforms;
    tu.uImp.value = info;
    tu.uCells.value.set(cols, rows);
    tu.uAtlasSize.value.set(texture.image?.width ?? cols * 128, texture.image?.height ?? rows * 128);
    const N = IMPOSTOR_TYPES.length;
    const mat = setupCartoonMaterial(new THREE.MeshLambertMaterial({
      map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide,
    }), 'none');
    const cartoon = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      cartoon.call(mat, sh, r);
      // troca árvore de verdade <-> impostor (seco, na mesma distância das duas)
      Object.assign(sh.uniforms, tu, { uFadeCam: FADE.uFadeCam, uVegFade: FADE.uTreeSwap });
      sh.vertexShader = [
        'attribute vec4 aTree;',
        FADE_GLSL,
        'uniform vec2 uCenter;',
        'uniform vec2 uFadeCam;',
        'uniform vec2 uVegFade;',
        'uniform float uTreeOuter;',
        'varying float vImpDist;',
        'varying float vImpHash;',
        `uniform vec3 uImp[${N}];`,
        'uniform vec2 uCells;',
        sh.vertexShader,
      ].join('\n')
        // célula da espécie no atlas (espelhada em metade das árvores)
        .replace('#include <uv_vertex>', [
          '#include <uv_vertex>',
          '  {',
          '    vec2 hzCell = vec2(mod(aTree.z, uCells.x), floor(aTree.z / uCells.x + 0.01));',
          '    float hzU = aTree.x + 0.5;',
          '    if (aTree.w < 0.0) hzU = 1.0 - hzU;',
          '    vMapUv = (hzCell + vec2(hzU, aTree.y)) / uCells;',
          '  }',
        ].join('\n'))
        // quadro virado para a câmera (só gira em volta do eixo vertical); normal meio para cima,
        // como a média das folhas
        .replace('#include <beginnormal_vertex>', [
          '  vec3 hzCamL = cameraPosition - modelMatrix[3].xyz;',
          '  vec2 hzTo = hzCamL.xz - position.xz;',
          '  hzTo /= max(length(hzTo), 1e-3);',
          '  vec3 objectNormal = normalize(vec3(hzTo.x, 0.45, hzTo.y));',
        ].join('\n'))
        // aparece com pontilhado onde a vegetação de verdade some (fora disso encolhe até o pé,
        // nem ocupa a tela) e encolhe no fim do alcance
        .replace('#include <begin_vertex>', [
          '  vec3 transformed = position;',
          '  {',
          '    vec3 hzInfo = uImp[int(aTree.z + 0.5)];',
          '    vec2 hzW = position.xz + modelMatrix[3].xz;',
          '    vImpDist = distance(hzW, uFadeCam);',
          '    vImpHash = fadeHash(floor(hzW * 4.0));',
          '    float hzGrow = 1.0 - smoothstep(max(uTreeOuter - 350.0, uTreeOuter * 0.65), uTreeOuter, distance(hzW, uCenter));',
          '    if (vImpDist < uVegFade.x) hzGrow = 0.0;',
          '    float hzS = abs(aTree.w) * hzGrow;',
          '    vec3 hzRight = vec3(-hzTo.y, 0.0, hzTo.x);',
          '    transformed += hzRight * (aTree.x * hzInfo.x + hzInfo.y * sign(aTree.w)) * hzS;',
          '    transformed.y += ((aTree.y - 0.5) * hzInfo.x + hzInfo.z) * hzS;',
          '  }',
        ].join('\n'));
      // de longe a imagem vem de um mip pequeno: a opacidade média cai e a copa "some"; reforça
      sh.fragmentShader = 'uniform vec2 uAtlasSize;\nuniform vec2 uVegFade;\nvarying float vImpDist;\nvarying float vImpHash;\n' + FADE_GLSL + sh.fragmentShader
        .replace('void main() {', 'void main() {\n  if (vImpHash <= 1.0 - smoothstep(uVegFade.x, uVegFade.y, vImpDist)) discard;')
        .replace('#include <map_fragment>', [
        '#include <map_fragment>',
        '  {',
        '    vec2 hzTs = vMapUv * uAtlasSize;',
        '    vec2 hzDx = dFdx(hzTs), hzDy = dFdy(hzTs);',
        '    float hzLod = max(0.5 * log2(max(dot(hzDx, hzDx), dot(hzDy, hzDy))), 0.0);',
        '    diffuseColor.a = clamp(diffuseColor.a * (1.0 + hzLod * 0.35), 0.0, 1.0);',
        '  }',
      ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'horizon_impostors';
    this.treeMaterial = mat;
  }

  /**
   * holeRadius: raio já coberto pelos chunks detalhados (o horizonte começa ali).
   */
  public update(x: number, z: number, holeRadius: number): void {
    for (let l = 0; l < LEVELS.length; l++) {
      this.uniforms[l].uCenter.value.set(x, z);
      this.uniforms[l].uOuter.value = LEVELS[l].outer * this.distanceScale;
      this.uniforms[l].uInner.value = l === 0 ? holeRadius : LEVELS[l - 1].outer * this.distanceScale;
      this.uniforms[l].uMorphLower.value =
        l + 1 < this.activeLevels ? LEVELS[l + 1].lower - LEVELS[l].lower : 0;
    }
    this.treeUniforms.uCenter.value.set(x, z);

    if (Math.hypot(x - this.planX, z - this.planZ) < REPLAN_DIST && Math.abs(holeRadius - this.planHole) < 64) return;
    this.planX = x; this.planZ = z; this.planHole = holeRadius;

    const wanted = new Set<string>();
    for (let l = 0; l < this.activeLevels; l++) {
      const { size, seg } = LEVELS[l];
      const outer = LEVELS[l].outer * this.distanceScale;
      // o nível 0 cobre também a área dos chunks (as árvores simples aparecem além do raio da vegetação)
      const inner = l === 0 ? 0 : LEVELS[l - 1].outer * this.distanceScale;
      const reach = outer + OVERLAP;
      const t0x = Math.floor((x - reach) / size), t1x = Math.floor((x + reach) / size);
      const t0z = Math.floor((z - reach) / size), t1z = Math.floor((z + reach) / size);
      for (let tx = t0x; tx <= t1x; tx++) {
        for (let tz = t0z; tz <= t1z; tz++) {
          const minX = tx * size, minZ = tz * size;
          // distância do centro ao ponto mais perto e ao mais longe do bloco
          const nx = Math.max(minX - x, 0, x - (minX + size)), nz = Math.max(minZ - z, 0, z - (minZ + size));
          const near = Math.hypot(nx, nz);
          const fx = Math.max(Math.abs(x - minX), Math.abs(x - minX - size)), fz = Math.max(Math.abs(z - minZ), Math.abs(z - minZ - size));
          const far = Math.hypot(fx, fz);
          if (near > reach || far < inner) continue; // fora do anel
          const key = l + ':' + tx + ':' + tz;
          wanted.add(key);
          if (this.tiles.has(key)) continue;
          const tile: HorizonTile = { key, level: l, cancelled: false, reqId: 0, treeParts: [], treeReqs: [] };
          this.tiles.set(key, tile);
          const { promise, reqId } = getTextureWorkerPool().requestHorizon(
            this.seed, minX, minZ, size, seg, PRIORITY_BASE + l * 1000 + near / 10
          );
          if (l === 0) this.requestTrees(tile, minX, minZ, size, x, z);
          tile.reqId = reqId;
          promise.then((r) => {
            if (tile.cancelled || !r.horizon) return;
            const h = r.horizon;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(h.positions, 3));
            geo.setAttribute('normal', new THREE.BufferAttribute(h.normals, 3));
            geo.setAttribute('color', new THREE.BufferAttribute(h.colors, 3));
            geo.setAttribute('morph', new THREE.BufferAttribute(h.morph, 1));
            geo.setIndex(new THREE.BufferAttribute(h.index, 1));
            geo.computeBoundingSphere();
            const mesh = new THREE.Mesh(geo, this.materials[l]);
            mesh.position.set(minX + size / 2, -LEVELS[l].lower, minZ + size / 2);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            tile.mesh = mesh;
            this.group.add(mesh);
          }).catch(() => {});
        }
      }
    }
    // blocos que saíram dos anéis
    for (const [key, tile] of this.tiles) {
      if (wanted.has(key)) continue;
      this.dropTile(tile);
      this.tiles.delete(key);
    }
  }

  /**
   * Árvores de um bloco do nível 0: pedaços de 256m (os de perto primeiro) até o alcance delas;
   * cada pedaço que chega entra na malha única do bloco (uma chamada de desenho por bloco).
   */
  private requestTrees(tile: HorizonTile, minX: number, minZ: number, size: number, x: number, z: number): void {
    const B = IMPOSTOR_BLOCK, ox = minX + size / 2, oz = minZ + size / 2;
    for (let bz = minZ; bz < minZ + size; bz += B) {
      for (let bx = minX; bx < minX + size; bx += B) {
        const nx = Math.max(bx - x, 0, x - (bx + B)), nz = Math.max(bz - z, 0, z - (bz + B));
        const near = Math.hypot(nx, nz);
        if (near > this.treeOuter) continue;
        const { promise, reqId } = getTextureWorkerPool().requestImpostors(this.seed, bx, bz, B, ox, oz, PRIORITY_BASE + 300 + near / 10);
        tile.treeReqs.push(reqId);
        promise.then((r) => {
          tile.treeReqs = tile.treeReqs.filter((id) => id !== reqId);
          if (tile.cancelled || !r.impostors || r.impostors.index.length === 0) return;
          tile.treeParts.push(r.impostors);
          this.rebuildTrees(tile, ox, oz);
        }).catch(() => {});
      }
    }
  }

  /** Junta os pedaços recebidos numa malha só (os índices de cada pedaço são deslocados). */
  private rebuildTrees(tile: HorizonTile, ox: number, oz: number): void {
    if (!this.treeMaterial) return;
    let nv = 0, ni = 0;
    for (const p of tile.treeParts) { nv += p.positions.length / 3; ni += p.index.length; }
    const pos = new Float32Array(nv * 3), tree = new Float32Array(nv * 4), col = new Uint8Array(nv * 3), idx = new Uint32Array(ni);
    let v = 0, i = 0;
    for (const p of tile.treeParts) {
      pos.set(p.positions, v * 3); tree.set(p.tree, v * 4); col.set(p.colors, v * 3);
      for (let k = 0; k < p.index.length; k++) idx[i + k] = p.index[k] + v;
      v += p.positions.length / 3; i += p.index.length;
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tg.setAttribute('aTree', new THREE.BufferAttribute(tree, 4));
    tg.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    tg.setIndex(new THREE.BufferAttribute(idx, 1));
    tg.computeBoundingSphere();
    tg.boundingSphere!.radius += 25; // os quadros crescem a partir do pé
    if (tile.trees) {
      tile.trees.geometry.dispose();
      tile.trees.geometry = tg;
      return;
    }
    const tm = new THREE.Mesh(tg, this.treeMaterial);
    tm.position.set(ox, 0, oz);
    tm.castShadow = false;
    tm.receiveShadow = false;
    tm.matrixAutoUpdate = false;
    tm.updateMatrix();
    tile.trees = tm;
    this.group.add(tm);
  }

  private dropTile(tile: HorizonTile): void {
    tile.cancelled = true;
    for (const id of tile.treeReqs) getTextureWorkerPool().cancel(id);
    if (!tile.mesh) getTextureWorkerPool().cancel(tile.reqId); // ainda na fila: nem gera
    if (tile.mesh) { this.group.remove(tile.mesh); tile.mesh.geometry.dispose(); }
    if (tile.trees) { this.group.remove(tile.trees); tile.trees.geometry.dispose(); }
  }

  public setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Outra seed: descarta tudo (os blocos são refeitos no próximo update). */
  public reset(seed: number): void {
    this.seed = seed;
    for (const tile of this.tiles.values()) this.dropTile(tile);
    this.tiles.clear();
    this.planX = this.planZ = Infinity;
  }
}
