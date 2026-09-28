import { TerrainGenerator } from './terrainGenerator.ts';
import { planChunkVegetation } from '../vegetation/vegetationPlanner.ts';
import type { Matrix4, Color } from 'three';
import { HorizonTreeData, IMPOSTOR_TYPES } from './horizonGeometry.ts';
import { CONFIG } from '../../config.ts';

/** Tamanho (m) de cada pedaço de árvores distantes pedido aos workers (16 chunks, ~100ms) */
export const IMPOSTOR_BLOCK = 256;

/** As mudas usam o mesmo impostor da adulta, menor */
const SAPLING_SCALE = 0.5;

const T = (name: typeof IMPOSTOR_TYPES[number]) => IMPOSTOR_TYPES.indexOf(name);
const MAPLE_TINTS: Record<number, number> = { 0xd44022: T('mapleRed'), 0xe87a1a: T('mapleOrange'), 0xe8b824: T('mapleYellow') };

/**
 * Árvores distantes (impostores) de um pedaço do mundo: roda o MESMO planejamento da vegetação de
 * perto (vegetationPlanner) em cada chunk, então cada impostor fica exatamente onde a árvore de
 * verdade vai estar, com a mesma espécie e o mesmo tamanho. Posições locais a (originX, originZ).
 * Roda no worker.
 */
export function buildImpostorBlock(
  terrainGen: TerrainGenerator,
  minX: number,
  minZ: number,
  size: number,
  originX: number,
  originZ: number
): HorizonTreeData {
  const CS = CONFIG.CHUNK_SIZE;
  const pos: number[] = [], tree: number[] = [], col: number[] = [], idx: number[] = [];
  const push = (items: { matrix: Matrix4; leafTint?: Color }[], type: number, sapling: boolean) => {
    for (const it of items) {
      const e = it.matrix.elements;
      // escala vertical da árvore (coluna y da matriz)
      const sy = Math.hypot(e[4], e[5], e[6]) * (sapling ? SAPLING_SCALE : 1);
      let t = type;
      if (t < 0) t = (it.leafTint && MAPLE_TINTS[it.leafTint.getHex()]) ?? T('mapleOrange');
      const x = e[12], y = e[13], z = e[14];
      // metade espelhada (fixo por árvore)
      const flip = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 < 0 ? -1 : 1;
      const first = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        pos.push(x - originX, y, z - originZ);
        tree.push(k === 0 || k === 3 ? -0.5 : 0.5, k < 2 ? 0 : 1, t, sy * flip);
        col.push(255, 255, 255);
      }
      idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  };
  const hydro = terrainGen.getHydrology();
  hydro.setDeferMissing(true); // como na thread principal: ilha não calculada = sem água (não trava)
  try {
    // chunks com o centro dentro do pedaço (os chunks são centrados em múltiplos de CS)
    const c0x = Math.ceil(minX / CS), c1x = Math.ceil((minX + size) / CS);
    const c0z = Math.ceil(minZ / CS), c1z = Math.ceil((minZ + size) / CS);
    for (let cz = c0z; cz < c1z; cz++) {
      for (let cx = c0x; cx < c1x; cx++) {
        // sem a flora rasteira: ela tem sequência própria e não muda as árvores
        const p = planChunkVegetation(cx, cz, CS, terrainGen as any, false);
        push(p.oakItems, T('oak'), false);
        push(p.broadOakItems, T('broadOak'), false);
        push(p.oakSaplingItems, T('oak'), true);
        push(p.pineItems, T('pine'), false);
        push(p.pineSaplingItems, T('pine'), true);
        push(p.birchItems, T('birch'), false);
        push(p.twinBirchItems, T('birch'), false);
        push(p.birchSaplingItems, T('birch'), true);
        push(p.palmItems, T('palm'), false);
        push(p.palmSaplingItems, T('palm'), true);
        push(p.acaciaItems, T('acacia'), false);
        push(p.acaciaSaplingItems, T('acacia'), true);
        push(p.mapleItems, -1, false);
        push(p.mangroveItems, T('mangrove'), false);
        push(p.mangroveSaplingItems, T('mangrove'), true);
        push(p.snowPineItems, T('snowPine'), false);
        push(p.arcticWillowItems, T('willow'), false);
        push(p.deadTreeTransforms, T('dead'), false);
        push(p.cactusTransforms, T('cactus'), false);
        push(p.cactusSaplingTransforms, T('cactusSapling'), false);
      }
    }
  } finally {
    hydro.setDeferMissing(false);
  }
  return {
    positions: new Float32Array(pos), tree: new Float32Array(tree), colors: new Uint8Array(col), index: new Uint32Array(idx),
  };
}
