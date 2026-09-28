import { PRNG } from '../src/generation/math/prng.ts';
import { TerrainGenerator } from '../src/generation/terrain/terrainGenerator.ts';
import { planChunkVegetation } from '../src/generation/vegetation/vegetationPlanner.ts';
import { buildChunkGeometry } from '../src/generation/terrain/chunkGeometry.ts';
import { buildHorizonTile } from '../src/generation/terrain/horizonGeometry.ts';
import { buildImpostorBlock } from '../src/generation/terrain/horizonTrees.ts';
import {
  DEFAULT_FORGE_PARAMS,
  TerrainTextureForge,
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


function copyInto(dst:Uint8Array, offset:number, src:ArrayBufferView){
  dst.set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength), offset);
  return offset + src.byteLength;
}
function align4(v:number){ return (v + 3) & ~3; }

/**
 * Pacote binário do chunk ORIGINAL:
 * header uint32[10]:
 * magic, version, segments, vertexCount, indexCount, texW, texH, grassFloatCount, reserved0, reserved1
 * depois: positions f32, normals f32, wall f32, morph f32, indices u16, padding4,
 *         top RGBA8, topDark RGBA8, grass f32.
 */
(globalThis as any).pixelGenerateExactChunk=function(
  seedText:string,
  cx:number,
  cz:number,
  chunkSize:number,
  density:number,
  segments:number,
  walls:number
){
  const world=worldFor(seedText);
  const seed=PRNG.hashString(seedText);
  const centerX=cx*chunkSize, centerZ=cz*chunkSize;
  const minX=centerX-chunkSize*0.5, minZ=centerZ-chunkSize*0.5;

  const geo=buildChunkGeometry(world,centerX,centerZ,chunkSize,segments,walls!==0);
  const grid=segments+1;
  const hs=new Float32Array(grid*grid);
  for(let i=0;i<grid*grid;i++) hs[i]=geo.positions[i*3+1];

  const params={...DEFAULT_FORGE_PARAMS,seed};
  const per=makePerlin(seed);
  const tex=genChunkTexture(params,per,world,minX,minZ,chunkSize,density,{
    heights:hs,grid,step:chunkSize/segments
  });

  const headerBytes=10*4;
  const posBytes=geo.positions.byteLength;
  const nrmBytes=geo.normals.byteLength;
  const wallBytes=geo.wall.byteLength;
  const morphBytes=geo.morph.byteLength;
  const idxBytes=geo.index.byteLength;
  const texBytes=tex.img.byteLength;
  const darkBytes=tex.imgD.byteLength;
  const grass=tex.grass ?? new Float32Array(0);
  const grassBytes=grass.byteLength;

  let size=headerBytes+posBytes+nrmBytes+wallBytes+morphBytes+idxBytes;
  size=align4(size)+texBytes+darkBytes+grassBytes;
  const out=new ArrayBuffer(size);
  const dv=new DataView(out);
  const u8=new Uint8Array(out);
  const H=[0x50494348,1,geo.segments,geo.positions.length/3,geo.index.length,tex.width,tex.height,grass.length,0,0];
  for(let i=0;i<H.length;i++) dv.setUint32(i*4,H[i],true);

  let o=headerBytes;
  o=copyInto(u8,o,geo.positions);
  o=copyInto(u8,o,geo.normals);
  o=copyInto(u8,o,geo.wall);
  o=copyInto(u8,o,geo.morph);
  o=copyInto(u8,o,geo.index);
  o=align4(o);
  o=copyInto(u8,o,tex.img);
  o=copyInto(u8,o,tex.imgD);
  o=copyInto(u8,o,grass);
  return out;
};

/**
 * Pacote binário do Distant Horizons ORIGINAL.
 * header uint32[6]: magic,version,vertexCount,indexCount,seg,reserved
 * positions/normals/colors f32, morph f32, index u16.
 */
(globalThis as any).pixelGenerateHorizonTile=function(
  seedText:string,minX:number,minZ:number,size:number,seg:number
){
  const world=worldFor(seedText);
  const h=buildHorizonTile(world,minX,minZ,size,seg);
  const headerBytes=6*4;
  const total=headerBytes+h.positions.byteLength+h.normals.byteLength+h.colors.byteLength+h.morph.byteLength+h.index.byteLength;
  const out=new ArrayBuffer(total),dv=new DataView(out),u8=new Uint8Array(out);
  const H=[0x5049485a,1,h.positions.length/3,h.index.length,seg,0];
  for(let i=0;i<H.length;i++) dv.setUint32(i*4,H[i],true);
  let o=headerBytes;
  o=copyInto(u8,o,h.positions);
  o=copyInto(u8,o,h.normals);
  o=copyInto(u8,o,h.colors);
  o=copyInto(u8,o,h.morph);
  o=copyInto(u8,o,h.index);
  return out;
};

/**
 * Pacote de impostores do horizonte ORIGINAL.
 * header uint32[5]: magic,version,vertexCount,indexCount,reserved
 * positions f32x3, tree f32x4, colors u8x3, padding4, indices u32.
 */
(globalThis as any).pixelGenerateImpostorBlock=function(
  seedText:string,minX:number,minZ:number,size:number,originX:number,originZ:number
){
  const world=worldFor(seedText);
  const h=buildImpostorBlock(world,minX,minZ,size,originX,originZ);
  const headerBytes=5*4;
  let body=headerBytes+h.positions.byteLength+h.tree.byteLength+h.colors.byteLength;
  body=align4(body);
  const total=body+h.index.byteLength;
  const out=new ArrayBuffer(total),dv=new DataView(out),u8=new Uint8Array(out);
  const H=[0x5049494d,1,h.positions.length/3,h.index.length,0];
  for(let i=0;i<H.length;i++) dv.setUint32(i*4,H[i],true);
  let o=headerBytes;
  o=copyInto(u8,o,h.positions);
  o=copyInto(u8,o,h.tree);
  o=copyInto(u8,o,h.colors);
  o=align4(o);
  o=copyInto(u8,o,h.index);
  return out;
};


/**
 * Recursos globais do TerrainTextureForge ORIGINAL.
 * header uint32[8]: magic,version,wallW,wallH,gradW,gradH,res0,res1
 * wallA, wallB, wallC, wallD, gradMap — todos RGBA8.
 */
(globalThis as any).pixelGetForgeGlobals=function(seedText:string){
  const seed=PRNG.hashString(seedText);
  const forge:any=new TerrainTextureForge(seed);
  const wallA=forge.wallA.image.data as Uint8Array;
  const wallB=forge.wallB.image.data as Uint8Array;
  const wallC=forge.wallC.image.data as Uint8Array;
  const wallD=forge.wallD.image.data as Uint8Array;
  const grad=forge.gradMap.image.data as Uint8Array;
  const wallW=forge.wallA.image.width|0, wallH=forge.wallA.image.height|0;
  const gradW=forge.gradMap.image.width|0, gradH=forge.gradMap.image.height|0;
  const headerBytes=8*4;
  const total=headerBytes+wallA.byteLength+wallB.byteLength+wallC.byteLength+wallD.byteLength+grad.byteLength;
  const out=new ArrayBuffer(total),dv=new DataView(out),u8=new Uint8Array(out);
  const H=[0x50494647,1,wallW,wallH,gradW,gradH,0,0];
  for(let i=0;i<H.length;i++) dv.setUint32(i*4,H[i],true);
  let o=headerBytes;
  o=copyInto(u8,o,wallA);o=copyInto(u8,o,wallB);o=copyInto(u8,o,wallC);o=copyInto(u8,o,wallD);o=copyInto(u8,o,grad);
  return out;
};


(globalThis as any).pixelGetSpawn=function(seedText:string){
  const terrainGen=worldFor(seedText);
  const startX=0,startZ=0;
  let bestX=startX,bestZ=startZ,bestScore=-9999;
  const maxR=650,stepR=25;
  const hydro=terrainGen.getHydrology();
  hydro.setDeferMissing(false);
  for(let r=0;r<=maxR;r+=stepR){
    const angleSteps=Math.max(8,Math.floor((r*2*Math.PI)/30));
    for(let a=0;a<angleSteps;a++){
      const theta=(a/angleSteps)*Math.PI*2;
      const testX=startX+Math.cos(theta)*r;
      const testZ=startZ+Math.sin(theta)*r;
      const pt=terrainGen.getPoint(testX,testZ);
      if(!pt.isWater && pt.height>CONFIG.BEACH_HEIGHT+2.0 && pt.slope<0.35){
        const altScore=50.0-Math.abs(pt.height-18.0);
        const slopePenalty=pt.slope*40.0;
        const score=altScore-slopePenalty;
        if(score>bestScore){bestScore=score;bestX=testX;bestZ=testZ;}
      }
    }
    if(bestScore>35.0)break;
  }
  const elevation=terrainGen.getHeight(bestX,bestZ);
  hydro.setDeferMissing(true);
  return new Float32Array([bestX,bestZ,elevation]).buffer;
};
