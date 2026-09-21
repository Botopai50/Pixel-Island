import { PRNG } from './src/generation/math/prng.ts';
import { TerrainGenerator } from './src/generation/terrain/terrainGenerator.ts';

const tg = new TerrainGenerator(PRNG.hashString('Avalon'));
const v = tg.getVolcanoGenerator().getVolcanoes()[0];
console.log('Volcano:', v);
const mask = tg.getMacro().getLandmassMask(v.x, v.z);
console.log('Mask at volcano:', mask.coastDist, 'landFactor:', mask.landFactor);
console.log('Terrain height at volcano center:', tg.getHeight(v.x, v.z));
console.log('Terrain height at volcano rim:', tg.getHeight(v.x + 50, v.z));
console.log('Terrain height at volcano base:', tg.getHeight(v.x + v.baseRadius, v.z));
