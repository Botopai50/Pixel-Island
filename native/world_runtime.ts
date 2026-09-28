import { PRNG } from '../src/generation/math/prng.ts';
import { TerrainGenerator } from '../src/generation/terrain/terrainGenerator.ts';
import { planChunkVegetation } from '../src/generation/vegetation/vegetationPlanner.ts';
import {
  DEFAULT_FORGE_PARAMS,
  makePerlin,
  genChunkTexture,
} from '../src/generation/terrain/terrainTextureForge.ts';

let cachedSeed = '';
let terrain: TerrainGenerator | null = null;

function worldFor(seedText:string){
  if(!terrain || cachedSeed!==seedText){
    cachedSeed=seedText;
    terrain=new TerrainGenerator(PRNG.hashString(seedText));
    terrain.getHydrology().setDeferMissing(false);
  }
  return terrain;
}

function hexRgb(hex:string){
  const n=parseInt(hex.replace('#',''),16);
  return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255];
}

// Layout Float32 por vértice:
// x,y,z,nx,ny,nz,r,g,b,isWater,isLava,biomeId
const BIOMES=[
  'Oceano Profundo','Águas Rasas Costeiras','Lagoa e Recifes de Coral','Praia Arenosa',
  'Manguezal Estuarino','Campos Costeiros e Prados','Floresta Mista Temperada',
  'Bosque Outonal Dourado','Savana Tropical','Deserto & Dunas Áridas',
  'Cânions Estratificados & Ravinas','Selva Tropical Úmida','Taiga Boreal de Coníferas',
  'Tundra Alpina de Altitude','Planície Ártica de Gelo','Encostas Rochosas e Penhascos',
  'Cumes Nevados e Glaciais','Encostas Vulcânicas & Basalto','Caldeira Vulcânica & Lago de Lava',
  'Fontes Termais & Gêiseres'
];

(globalThis as any).pixelGenerateTerrain=function(seedText:string,centerX:number,centerZ:number,segments:number,size:number){
  const world=worldFor(seedText);
  const side=segments+1, stride=12;
  const out=new Float32Array(side*side*stride);
  let o=0;
  for(let iz=0;iz<side;iz++){
    for(let ix=0;ix<side;ix++){
      const x=centerX-size*0.5+size*(ix/segments);
      const z=centerZ-size*0.5+size*(iz/segments);
      const p=world.getPoint(x,z);
      const [r,g,b]=hexRgb(p.biome.groundColorHex);
      out[o++]=x;out[o++]=p.height;out[o++]=z;
      out[o++]=p.normal.x;out[o++]=p.normal.y;out[o++]=p.normal.z;
      out[o++]=r;out[o++]=g;out[o++]=b;
      out[o++]=p.isWater?1:0;out[o++]=p.isLava?1:0;
      out[o++]=Math.max(0,BIOMES.indexOf(p.biome.type));
    }
  }
  return out.buffer;
};

const PLAN_KEYS=[
 'oakItems','broadOakItems','oakSaplingItems','pineItems','pineSaplingItems','birchItems',
 'twinBirchItems','birchSaplingItems','palmItems','palmSaplingItems','acaciaItems',
 'acaciaSaplingItems','mapleItems','mangroveItems','mangroveSaplingItems','snowPineItems',
 'arcticWillowItems','deadTreeTransforms','cactusTransforms','cactusSaplingTransforms',
 'shrubLushTransforms','shrubBerryTransforms','rockBoulderTransforms','rockSlateTransforms',
 'rockPebblesTransforms','rockSpireTransforms','rockMossyTransforms','logHollowTransforms',
 'logRootedTransforms','logStumpTransforms','logStraightTransforms','fernTransforms',
 'wildflowerTransforms','reedTransforms'
];

// Float32 object layout: type + 16 matrix + rgb tint + rgb leafTint = 23 floats.
(globalThis as any).pixelGenerateVegetation=function(seedText:string,chunkX:number,chunkZ:number,chunkSize:number,detail:number){
  const world=worldFor(seedText);
  const plan:any=planChunkVegetation(chunkX,chunkZ,chunkSize,world,detail!==0);
  let count=0;
  for(const k of PLAN_KEYS) count+=(plan[k]?.length||0);
  const stride=23,out=new Float32Array(count*stride);
  let o=0;
  for(let type=0;type<PLAN_KEYS.length;type++){
    const arr=plan[PLAN_KEYS[type]]||[];
    for(const item of arr){
      out[o++]=type;
      const e=item.matrix.elements;
      for(let i=0;i<16;i++) out[o++]=e[i];
      const tint=item.tint||item.trunkTint;
      const leaf=item.leafTint||tint;
      out[o++]=tint?.r??1;out[o++]=tint?.g??1;out[o++]=tint?.b??1;
      out[o++]=leaf?.r??1;out[o++]=leaf?.g??1;out[o++]=leaf?.b??1;
    }
  }
  return out.buffer;
};

(globalThis as any).pixelSeedHash=(s:string)=>PRNG.hashString(s);


// RGBA8 original do Pixel Terrain Forge. O tamanho é round(chunkSize*density)^2 * 4.
(globalThis as any).pixelGenerateChunkTexture=function(
  seedText:string,
  minWorldX:number,
  minWorldZ:number,
  chunkSize:number,
  density:number
){
  const world=worldFor(seedText);
  const seed=PRNG.hashString(seedText);
  const params={...DEFAULT_FORGE_PARAMS, seed};
  const per=makePerlin(seed);
  const res=genChunkTexture(params,per,world,minWorldX,minWorldZ,chunkSize,density);
  return res.img.buffer;
};
