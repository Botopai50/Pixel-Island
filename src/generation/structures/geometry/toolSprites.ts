import * as THREE from 'three';
import type {StructureConfig} from '../types';
import {paintSurface} from '../surfacePainting';

/** Hand-drawn silhouettes and stepped lighting, sampled on a crisp texel grid. */
export function toolSpriteTexture(kind:'fork'|'shovel'|'hammer',c:StructureConfig,seed:number){
 const gw=24,gh=64,layers=new Uint8Array(gw*gh),details=new Uint8Array(gw*gh);
 const rect=(x0:number,y0:number,x1:number,y1:number,layer:number)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(x>=0&&x<gw&&y>=0&&y<gh)layers[y*gw+x]=layer;};
 const polygon=(points:number[][],layer:number)=>{for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [ax,ay]=points[i],[bx,by]=points[j];if((ay>y+.5)!==(by>y+.5)&&(x+.5)<(bx-ax)*(y+.5-ay)/(by-ay)+ax)inside=!inside;}if(inside)layers[y*gw+x]=layer;}};
 const grip=()=>{rect(7,2,16,5,2);rect(6,4,9,12,2);rect(14,4,17,12,2);rect(8,11,15,14,2);rect(10,5,13,10,0);rect(8,3,15,4,1);};
 if(kind==='shovel'){
  grip();polygon([[9,12],[15,12],[15,41],[13,44],[9,44],[9,38]],1);
  rect(9,34,14,41,2);
  polygon([[4,39],[8,36],[16,36],[20,39],[20,49],[18,55],[12,61],[6,56],[3,49]],2);
  for(let y=40;y<=55;y++)details[y*gw+11]=1;
  for(let x=7;x<=16;x++)details[40*gw+x]=2;
 }else if(kind==='fork'){
  grip();polygon([[9,12],[15,12],[15,40],[9,40]],1);rect(9,34,14,40,2);
  polygon([[4,38],[19,38],[20,44],[17,47],[6,47],[3,44]],2);
  for(const x of [4,9,14,19])polygon([[x-1,43],[x+1,43],[x+1,57],[x,61],[x-2,58],[x-2,47]],2);
  for(let x=6;x<=17;x++)details[41*gw+x]=2;
 }else{
  polygon([[10,18],[14,18],[14,46],[16,57],[14,61],[8,61],[7,57],[9,45]],1);
  rect(7,50,15,57,3);rect(9,20,14,26,2);
  polygon([[2,7],[5,4],[19,4],[22,7],[22,17],[19,20],[5,20],[2,17]],2);
  rect(2,7,5,17,2);rect(18,7,22,17,2);
  for(let y=7;y<=17;y++){details[y*gw+6]=1;details[y*gw+17]=1;}
  for(let x=7;x<=16;x++)details[7*gw+x]=2;
 }
 const width=Math.max(18,Math.round(c.height*.38*c.texelsPerMetre)),height=Math.max(48,Math.round(c.height*.94*c.texelsPerMetre)),data=new Uint8Array(width*height*4);
 const wood=paintSurface('wood',c.palette.wood,c.texelsPerMetre,seed,c.finish),iron=paintSurface('metal','#687681',c.texelsPerMetre,seed,c.finish);
 const sample=(map:THREE.Texture,x:number,y:number)=>{const img=map.image as {data:Uint8Array;width:number;height:number};const at=((Math.floor(y/2)%img.height)*img.width+Math.floor(x/2)%img.width)*4;return Array.from(img.data.slice(at,at+3));};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const gx=Math.min(gw-1,Math.floor((x+.5)/width*gw)),gy=Math.min(gh-1,Math.floor((y+.5)/height*gh)),at=gy*gw+gx,layer=layers[at];if(!layer)continue;
  const edge=[[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy])=>gx+dx<0||gx+dx>=gw||gy+dy<0||gy+dy>=gh||!layers[(gy+dy)*gw+gx+dx]);
  const light=gx>0&&gy>0&&(!layers[at-1]||!layers[at-gw]);
  let rgb=layer===3?[87,56,32]:sample(layer===2?iron:wood,gx,gy);
  if(edge)rgb=light?(layer===2?[147,159,161]:[193,145,86]):(layer===2?[38,44,47]:[57,36,22]);
  else if(details[at]===1)rgb=rgb.map(v=>Math.round(v*.65));
  else if(details[at]===2)rgb=rgb.map(v=>Math.min(255,Math.round(v*1.45+10)));
  else if(layer===1&&gx<12)rgb=rgb.map(v=>Math.min(255,Math.round(v*1.18)));
  else if(layer===2)rgb=rgb.map(v=>Math.min(255,Math.round(v*(gx<11?1.20:gx>15?.80:1))));
  else if(layer===3&&gy%3===0)rgb=[130,88,46];
  data.set([...rgb,255],((height-1-y)*width+x)*4);
 }
 wood.dispose();iron.dispose();
 const map=new THREE.DataTexture(data,width,height);map.colorSpace=THREE.SRGBColorSpace;map.magFilter=map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}
