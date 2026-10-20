import * as THREE from 'three';
import type {StructureConfig} from '../types';
import {pixelMossNoiseAt} from '../../vegetation/pixelTrees/services/mossStyle';

/** Weathered stone inside each real block; no second painted brick grid. */
export function wellStoneTexture(c:StructureConfig,seed:number,carved=false){
 const period=1.4,size=Math.max(16,Math.round(c.texelsPerMetre*period)),data=new Uint8Array(size*size*4),base=new THREE.Color(c.palette.stone).convertLinearToSRGB();
 const hash=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7+seed*.37)*43758.5453;return n-Math.floor(n);};
 const levels=carved?[.66,.77,.87,.97,1.07,1.17]:[.58,.73,.87,1,1.09,1.18];
 const cracks=new Set<number>(),highlights=new Set<number>();
 for(let i=0;i<(carved?0:4);i++){
  let x=Math.floor(hash(i,7)*size),y=Math.floor(hash(i,13)*size);
  for(let j=0;j<3;j++){
   const dx=Math.round((hash(i,j+21)-.5)*size*.34),dy=Math.round((hash(i,j+31)-.5)*size*.34),steps=Math.max(1,Math.abs(dx),Math.abs(dy));
   for(let k=0;k<=steps;k++){const xx=(x+Math.round(dx*k/steps)+size)%size,yy=(y+Math.round(dy*k/steps)+size)%size;cracks.add(yy*size+xx);highlights.add(((yy+1)%size)*size+xx);}
   x=(x+dx+size)%size;y=(y+dy+size)%size;
  }
 }
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const noise=pixelMossNoiseAt(x/(carved?5:8),y/(carved?5:8),seed*.13),grain=hash(x,y);
  let tone=noise<.27?2:noise>.76?4:3;
  if(grain<(carved?.008:.025))tone=Math.max(1,tone-1);else if(grain>(carved?.994:.982))tone=Math.min(5,tone+1);
  if(carved){
   // Irregular mineral patches, drawn as clusters rather than isolated speckles.
   const pitch=7,tiles=Math.max(2,Math.round(size/pitch)),cell=size/tiles,cx=Math.floor(x/cell),cy=Math.floor(y/cell);
   let nearest=Infinity,patch=.5,facet=0;
   for(let yy=cy-1;yy<=cy+1;yy++)for(let xx=cx-1;xx<=cx+1;xx++){
    const tx=(xx+tiles)%tiles,ty=(yy+tiles)%tiles;
    const px=(xx+.2+hash(tx,ty+83)*.6)*cell,py=(yy+.2+hash(tx+67,ty)*.6)*cell;
    const distance=(x-px)**2+(y-py)**2;
    if(distance<nearest){nearest=distance;patch=hash(tx+19,ty+41);facet=(x-px)*.45+(y-py)*.55;}
   }
   tone=patch<.13?1:patch<.36?2:patch>.88?4:3;
   if(facet<-cell*.32&&patch>.62)tone=Math.min(5,tone+1);
   if(grain<.003)tone=Math.max(1,tone-1);
  }
  if(cracks.has(y*size+x))tone=0;else if(highlights.has(y*size+x))tone=4;
  data.set([Math.min(255,Math.round(base.r*255*levels[tone])),Math.min(255,Math.round(base.g*255*levels[tone])),Math.min(255,Math.round(base.b*255*levels[tone])),255],(y*size+x)*4);
 }
 const map=new THREE.DataTexture(data,size,size);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(1/period,1/period);map.minFilter=map.magFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}
