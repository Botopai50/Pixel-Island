import { TerrainGenerator } from './terrainGenerator.ts';

export interface ChunkGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  index: Uint16Array;
  segments: number;
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
  segments: number
): ChunkGeometryData {
  const grid = segments + 1;
  const half = size / 2;
  const step = size / segments;

  // Alturas com um anel extra de 1 vértice em volta, para as normais das bordas
  const ext = grid + 2;
  const heights = new Float32Array(ext * ext);
  for (let iz = 0; iz < ext; iz++) {
    const z = centerZ - half + (iz - 1) * step;
    for (let ix = 0; ix < ext; ix++) {
      const cornerRing = (ix === 0 || ix === ext - 1) && (iz === 0 || iz === ext - 1);
      if (cornerRing) continue; // cantos do anel não entram em nenhuma diferença central
      heights[iz * ext + ix] = terrainGen.getHeight(centerX - half + (ix - 1) * step, z);
    }
  }

  const skirtVerts = segments * 4;
  const vertCount = grid * grid + skirtVerts;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);

  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const i = iz * grid + ix;
      const e = (iz + 1) * ext + (ix + 1);
      positions[i * 3] = -half + ix * step;
      positions[i * 3 + 1] = heights[e];
      positions[i * 3 + 2] = -half + iz * step;

      const nx = (heights[e - 1] - heights[e + 1]) / (2 * step);
      const nz = (heights[e - ext] - heights[e + ext]) / (2 * step);
      const len = Math.sqrt(nx * nx + 1 + nz * nz);
      normals[i * 3] = nx / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = nz / len;
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

  return { positions, normals, index, segments };
}
