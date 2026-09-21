import { TerrainGenerator } from '../generation/terrain/terrainGenerator.ts';
import { PRNG } from '../generation/math/prng.ts';

const defaultSeed = PRNG.hashString('Avalon');
const tg = new TerrainGenerator(defaultSeed);

let highest = { h: -999, x: 0, z: 0 };
for (let x = -900; x <= 900; x += 10) {
  for (let z = -900; z <= 900; z += 10) {
    const vRes = tg.getVolcanoGenerator().query(x, z);
    if (vRes.influence > 0.05) continue; // Pula vulcão
    const h = tg.getHeight(x, z);
    if (h > highest.h) {
      highest = { h, x, z };
    }
  }
}
console.log('Pico montanhoso mais alto (não vulcânico):', highest);

console.log('\nPerfil de alturas em torno do pico ao longo de X (passo 2m - resolucao do grid):');
for (let dx = -30; dx <= 30; dx += 2) {
  const h = tg.getHeight(highest.x + dx, highest.z);
  const diff = dx > -30 ? (h - tg.getHeight(highest.x + dx - 2, highest.z)) : 0;
  console.log(`dx=${dx >= 0 ? '+' : ''}${dx}m: h=${h.toFixed(2)}m (delta=${diff >= 0 ? '+' : ''}${diff.toFixed(2)}m)`);
}

console.log('\nPerfil de alturas em torno do pico ao longo de Z (passo 2m):');
for (let dz = -30; dz <= 30; dz += 2) {
  const h = tg.getHeight(highest.x, highest.z + dz);
  const diff = dz > -30 ? (h - tg.getHeight(highest.x, highest.z + dz - 2)) : 0;
  console.log(`dz=${dz >= 0 ? '+' : ''}${dz}m: h=${h.toFixed(2)}m (delta=${diff >= 0 ? '+' : ''}${diff.toFixed(2)}m)`);
}
