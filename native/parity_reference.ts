import { PRNG } from '../src/generation/math/prng.ts';
import { TerrainGenerator } from '../src/generation/terrain/terrainGenerator.ts';

const seedText = process.argv[2] || 'Avalon';
const seed = PRNG.hashString(seedText);
const world = new TerrainGenerator(seed);

const pts: [number, number][] = [
  [0,0],[32,64],[-64,32],[128,-96],[256,256],[-256,-256],
  [400,120],[-420,330],[700,-540],[-800,640],[1000,0],
  [0,1000],[-1000,0],[0,-1000],[1450,720],[-1300,900],
  [2200,-1750],[-2400,1900],[3200,0],[0,3200],[-3200,-3200],
  [77.25,-19.5],[511.5,511.5],[-613.125,204.875],
];

for (const [x,z] of pts) {
  const h = world.getDryHeight(x,z);
  const v = world.getVolcanoGenerator().query(x,z);
  const c = world.getCanyonGenerator().query(x,z,h);
  const g = world.queryGeothermal(x,z,h);
  const p = world.getBiomeManager().polarLatitudeZ(x,z);
  console.log([x,z,h,p,v.influence,c.influence,g.influence].map(Number).join(','));
}
