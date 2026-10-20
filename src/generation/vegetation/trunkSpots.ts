/**
 * Registro dos troncos das árvores (por dono = chunk): x, z e raio em metros. A grama 3D usa para não nascer dentro de um tronco. Escrito pelo gerenciador da
 * vegetação (createGameTrees), lido ao plantar a grama (populateGrass); sai junto com o chunk (releaseChunk).
 */
const spots = new Map<number, number[]>();

export function addTrunkSpot(owner: number, x: number, z: number, r: number): void {
  let l = spots.get(owner);
  if (!l) spots.set(owner, l = []);
  l.push(x, z, r);
}
export function removeTrunkSpots(owner: number): void { spots.delete(owner); }

/** Os troncos que caem na caixa [x0, x1] x [z0, z1] (mais a folga `pad`), de todos os chunks. */
export function trunksIn(x0: number, z0: number, x1: number, z1: number, pad: number): number[] {
  const out: number[] = [];
  for (const l of spots.values()) {
    for (let i = 0; i < l.length; i += 3) {
      const r = l[i + 2] + pad;
      if (l[i] > x0 - r && l[i] < x1 + r && l[i + 1] > z0 - r && l[i + 1] < z1 + r) out.push(l[i], l[i + 1], l[i + 2]);
    }
  }
  return out;
}
