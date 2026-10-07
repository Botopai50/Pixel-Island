import { makeHorizonL0Sampler } from './horizonGeometry.ts';
import { TerrainGenerator } from './terrainGenerator.ts';
import { localWaterfall, waterfallCenter, waterfallWidth } from '../hydrology/waterfallFeatures.ts';
import { CONFIG } from '../../config.ts';

export interface ChunkGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  /**
   * Por vértice (3 valores): metros abaixo da borda de cima do paredão e metros acima do pé dele,
   * ambos +1 (0 = sem informação: geometria antiga/sem o atributo; longe de paredões: 99), e a
   * subida máxima até os vizinhos mais altos (1 - cos do ângulo, como 1 - normal.y). O shader usa os
   * dois primeiros para a grama que escorre do topo e a terra que sobe pela base, e o terceiro
   * para decidir parede x chão: suave entre triângulos (sem dentes de serra na quina) e, no pé do
   * paredão, já enxerga a parede ao lado (sem a grama esticada em triângulos verdes).
   */
  wall: Float32Array;
  /**
   * Por vértice: quanto subir/descer para cair na superfície do horizonte (nível 0). O shader
   * aplica no fim do raio dos chunks, antes de eles sumirem com pontilhado (geomorphing).
   */
  morph: Float32Array;
  index: Uint16Array;
  segments: number;
  deformed: boolean;
}

/**
 * Malha de relevo de um chunk (coordenadas locais ao centro do chunk), com a mesma ordem de
 * vértices e triangulação do PlaneGeometry deitado usado antes. Roda no worker de texturas.
 *
 * Chunks vizinhos podem ter resoluções diferentes (LOD por distância): nas bordas, o lado mais
 * grosso interpola alturas em linha reta e abriria frestas. Cada borda ganha uma "saia" vertical
 * que desce alguns metros e tapa essas frestas; entre chunks de mesma resolução ela fica escondida.
 */
export function buildChunkGeometry(
  terrainGen: TerrainGenerator,
  centerX: number,
  centerZ: number,
  size: number,
  segments: number,
  /** medir os paredões (grama que escorre / terra no pé): só nos chunks perto da câmera */
  walls: boolean = true
): ChunkGeometryData {
  // Refine only nearby waterfall chunks. Large triangles cut diagonal curtains
  // into wedges even when the analytic terrain profile has the right contact.
  if(size<=CONFIG.CHUNK_SIZE&&segments>=CONFIG.CHUNK_SEGMENTS){
    const hydro=terrainGen.getHydrology(),G=CONFIG.ISLAND_GRID_SIZE;
    const cx=Math.round(centerX/G),cz=Math.round(centerZ/G);
    let refine=false;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      if((dx||dz)&&!hydro.hasIsland(cx+dx,cz+dz))continue;
      for(const f of hydro.getWaterfalls(cx+dx,cz+dz)){
        const q=localWaterfall(f,centerX,centerZ),reach=size*Math.SQRT1_2;
        // a queda e TODO o rio de cima (e o lago): a margem da água sobre triângulos de 2 m sai em
        // dentes de serra, então a faixa em volta da água usa grade de 1 m
        if(q.z>f.radius+12+reach||q.z< -f.length-12-reach)continue;
        const zc=Math.max(-f.length,Math.min(q.z,f.radius));
        const center=waterfallCenter(f,zc),half=(q.z<0?waterfallWidth(f,zc):f.width)*.5+6;
        if(Math.abs(q.x-center)<half+reach)refine=true;
      }
    }
    if(refine)segments=Math.max(segments,Math.ceil(size));
  }
  const grid = segments + 1;
  const half = size / 2;
  const step = size / segments;

  // Alturas com um anel extra de 1 vértice em volta, para as normais das bordas
  const ext = grid + 2;
  const heights = new Float32Array(ext * ext);
  let deformed=false;
  const sampleX=new Float64Array(ext*ext),sampleZ=new Float64Array(ext*ext);
  for (let iz = 0; iz < ext; iz++) {
    const z = centerZ - half + (iz - 1) * step;
    for (let ix = 0; ix < ext; ix++) {
      const cornerRing = (ix === 0 || ix === ext - 1) && (iz === 0 || iz === ext - 1);
      if (cornerRing) continue; // cantos do anel não entram em nenhuma diferença central
      const p=terrainGen.getMeshPoint(centerX-half+(ix-1)*step,z),k=iz*ext+ix;
      if(Math.abs(p.x-(centerX-half+(ix-1)*step))>1e-6||Math.abs(p.z-z)>1e-6)deformed=true;
      sampleX[k]=p.x;sampleZ[k]=p.z;heights[k]=terrainGen.getHeight(p.x,p.z);
    }
  }

  const skirtVerts = segments * 4;
  const vertCount = grid * grid + skirtVerts;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const wall = new Float32Array(vertCount * 3).fill(99);

  // Paredões: vértices íngremes e os vizinhos deles. Para cada um, anda morro acima (e abaixo) pelo
  // relevo de verdade até a inclinação cair - a altura da borda de cima e do pé do paredão. Usa
  // getHeight (e não só a grade do chunk) para o resultado não mudar entre chunks e LODs.
  const steep = new Uint8Array(grid * grid);
  // só nas malhas de perto (vértices a até 4m): nos blocos distantes a grama/terra da borda dos
  // paredões nem aparece, e andar pelo relevo a partir de cada vértice íngreme custava caro
  for (let iz = 0; walls && step <= 4 && iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const e = (iz + 1) * ext + (ix + 1);
      const gx = (heights[e + 1] - heights[e - 1]) / (2 * step), gz = (heights[e + ext] - heights[e - ext]) / (2 * step);
      if (gx * gx + gz * gz > 0.6 * 0.6) {
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const xx = ix + dx, zz = iz + dz;
          if (xx >= 0 && zz >= 0 && xx < grid && zz < grid) steep[zz * grid + xx] = 1;
        }
      }
    }
  }
  // alcance de 20m na horizontal: os paredões (mesas, degraus) sobem quase tudo em ~6m
  const WSTEP = 2.0, WMAX = 10; // passos de 2m (antes 1.25m, 16 passos): ~40% menos consultas
  // gradiente de cada vértice (na grade com o anel extra)
  const gradX = new Float32Array(grid * grid), gradZ = new Float32Array(grid * grid);
  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const e = (iz + 1) * ext + (ix + 1);
      gradX[iz * grid + ix] = heights[e + 1] - heights[e - 1];
      gradZ[iz * grid + ix] = heights[e + ext] - heights[e - ext];
    }
  }
  // anda na direção (dx, dz) enquanto sobe (ou desce) íngreme; tolera até 2 passos planos no
  // começo (o vértice pode estar no pé ou no topo, a um ou dois metros do começo da parede)
  const march = (x0: number, z0: number, h0: number, dx: number, dz: number, dir: number): number => {
    let hEnd = h0, prev = h0, started = false, flat = 0;
    for (let s = 1; s <= WMAX; s++) {
      const h = terrainGen.getHeight(x0 + dx * s * WSTEP, z0 + dz * s * WSTEP);
      if ((h - prev) * dir < 0.45 * WSTEP) {
        if (started || ++flat > 2) break;
        prev = h;
        continue;
      }
      started = true;
      hEnd = h; prev = h;
    }
    return hEnd;
  };
  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const i = iz * grid + ix;
      if (!steep[i]) continue;
      // direção do paredão: a do vizinho mais íngreme (um vértice plano no pé ou no topo tem o
      // próprio gradiente virado para qualquer lado - para longe da parede, a grama nascia de baixo)
      // vértice íngreme: a própria direção de subida (a do vizinho pode estar virada ao longo da
      // parede, e a busca falhava); vértice plano: a do vizinho mais íngreme
      const selfM = gradX[i] * gradX[i] + gradZ[i] * gradZ[i];
      const selfSteep = selfM > (0.6 * 2 * step) * (0.6 * 2 * step);
      let bx = selfSteep ? gradX[i] : 0, bz = selfSteep ? gradZ[i] : 0, bm = selfSteep ? selfM : 0;
      for (let dz = -1; dz <= 1 && !selfSteep; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = ix + dx, zz = iz + dz;
        if (xx < 0 || zz < 0 || xx >= grid || zz >= grid) continue;
        const k = zz * grid + xx, mg = gradX[k] * gradX[k] + gradZ[k] * gradZ[k];
        if (mg > bm) { bm = mg; bx = gradX[k]; bz = gradZ[k]; }
      }
      if (bm < 1e-8) continue;
      const gl = Math.sqrt(bm), gx = bx / gl, gz = bz / gl;
      const e = (iz + 1) * ext + (ix + 1);
      const x0 = sampleX[e], z0 = sampleZ[e], h0 = heights[e];
      const rise = march(x0, z0, h0, gx, gz, 1) - h0;    // até a borda de cima
      const drop = h0 - march(x0, z0, h0, -gx, -gz, -1);  // até o pé
      // sem subida: é topo (se há descida grande) ou não está num paredão; idem para o pé
      wall[i * 3] = rise >= 0.5 ? rise + 1 : drop > 2 ? 1 : 99;
      wall[i * 3 + 1] = drop >= 0.5 ? drop + 1 : rise > 2 ? 1 : 99;
    }
  }

  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const i = iz * grid + ix;
      const e = (iz + 1) * ext + (ix + 1);
      positions[i * 3] = sampleX[e]-centerX;
      positions[i * 3 + 1] = heights[e];
      positions[i * 3 + 2] = sampleZ[e]-centerZ;

      const nx = (heights[e - 1] - heights[e + 1]) / (2 * step);
      const nz = (heights[e - ext] - heights[e + ext]) / (2 * step);
      const len = Math.sqrt(nx * nx + 1 + nz * nz);
      normals[i * 3] = nx / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = nz / len;
    }
  }

  // subida máxima até os vizinhos MAIS ALTOS de cada vértice (a grade tem o anel extra; os cantos
  // do anel não foram amostrados e ficam de fora). Só a subida: o pé do paredão enxerga a parede
  // acima dele, mas o topo plano junto da quina (todos os vizinhos mais baixos) continua chão - com
  // a inclinação para qualquer lado, uma faixa do topo virava parede pintada de verde liso
  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const e = (iz + 1) * ext + (ix + 1), h0 = heights[e];
      let g = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const ex = ix + 1 + dx, ez = iz + 1 + dz;
        if ((ex === 0 || ex === ext - 1) && (ez === 0 || ez === ext - 1)) continue;
        const d = (dx && dz) ? step * Math.SQRT2 : step;
        g = Math.max(g, (heights[ez * ext + ex] - h0) / d);
      }
      wall[(iz * grid + ix) * 3 + 2] = 1 - 1 / Math.sqrt(1 + g * g);
    }
  }

  // Perímetro em sentido único (fechado), sem repetir cantos
  const perimeter: number[] = [];
  for (let ix = 0; ix < segments; ix++) perimeter.push(ix);                                   // borda z-
  for (let iz = 0; iz < segments; iz++) perimeter.push(iz * grid + segments);                 // borda x+
  for (let ix = segments; ix > 0; ix--) perimeter.push(segments * grid + ix);                 // borda z+
  for (let iz = segments; iz > 0; iz--) perimeter.push(iz * grid);                            // borda x-

  // Profundidade da saia ~ erro máximo esperado entre LODs vizinhos
  const skirtDepth = 2 + step * 0.6;
  const skirtBase = grid * grid;
  for (let k = 0; k < perimeter.length; k++) {
    const src = perimeter[k];
    const dst = skirtBase + k;
    positions[dst * 3] = positions[src * 3];
    positions[dst * 3 + 1] = positions[src * 3 + 1] - skirtDepth;
    positions[dst * 3 + 2] = positions[src * 3 + 2];
    normals[dst * 3] = normals[src * 3];
    normals[dst * 3 + 1] = normals[src * 3 + 1];
    normals[dst * 3 + 2] = normals[src * 3 + 2];
    wall[dst * 3] = wall[src * 3];
    wall[dst * 3 + 1] = wall[src * 3 + 1];
    wall[dst * 3 + 2] = wall[src * 3 + 2];
  }

  const index = new Uint16Array(segments * segments * 6 + perimeter.length * 12);
  let o = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = ix + grid * iz;
      const b = ix + grid * (iz + 1);
      const c = ix + 1 + grid * (iz + 1);
      const d = ix + 1 + grid * iz;
      index[o++] = a; index[o++] = b; index[o++] = d;
      index[o++] = b; index[o++] = c; index[o++] = d;
    }
  }
  // Saias com as duas faces (visíveis de qualquer lado da fresta)
  for (let k = 0; k < perimeter.length; k++) {
    const k2 = (k + 1) % perimeter.length;
    const t0 = perimeter[k], t1 = perimeter[k2];
    const b0 = skirtBase + k, b1 = skirtBase + k2;
    index[o++] = t0; index[o++] = b0; index[o++] = t1;
    index[o++] = t1; index[o++] = b0; index[o++] = b1;
    index[o++] = t0; index[o++] = t1; index[o++] = b0;
    index[o++] = t1; index[o++] = b1; index[o++] = b0;
  }

  // alvo do morph: a malha do horizonte no mesmo ponto (a saia acompanha a borda)
  const hz = makeHorizonL0Sampler(terrainGen);
  const morph = new Float32Array(vertCount);
  for (let i = 0; i < grid * grid; i++) {
    // meio metro ACIMA da malha do horizonte: coplanar, as duas brigavam pela profundidade
    morph[i] = hz(centerX + positions[i * 3], centerZ + positions[i * 3 + 2]) + 0.5 - positions[i * 3 + 1];
  }
  for (let k = 0; k < perimeter.length; k++) morph[skirtBase + k] = morph[perimeter[k]];

  return { positions, normals, wall, morph, index, segments, deformed };
}
