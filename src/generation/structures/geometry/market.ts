import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {merge} from './common';

/** Small, deliberately coarse maps so every food item keeps the market's pixel scale. */
export function marketFoodTexture(kind:'fish'|'salmon'|'fillet'|'meat'|'ham',texelsPerMetre:number,seed:number){
 const fish=kind==='fish'||kind==='salmon',width=Math.max(12,Math.round((fish?.38:.40)*texelsPerMetre)),height=Math.max(14,Math.round(((fish||kind==='ham'||kind==='fillet')?.64:.42)*texelsPerMetre));
 const data=new Uint8Array(width*height*4);
 const rgb=(hex:string)=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
 const palette=kind==='fish'?['#1d3440','#3d6675','#6d9aac','#a7c6c3','#ded9bf']:
  kind==='salmon'?['#4d3539','#995146','#c87762','#e8a181','#eed0aa']:
  kind==='fillet'?['#633e37','#a75242','#d77a55','#f0a77a','#f5d0a3']:
  ['#522329','#803038','#a84242','#c4685d','#dc9a85','#f0d0ad'];
 const colors=palette.map(rgb);
 const hash=(x:number,y:number)=>{let n=(x*374761393+y*668265263+seed*1442695041)|0;n=(n^(n>>>13))*1274126177;return ((n^(n>>>16))>>>0)/4294967295;};
 for(let py=0;py<height;py++)for(let px=0;px<width;px++){
  const u=(px+.5)/width,v=(py+.5)/height,noise=hash(px,py),pixel=1/width;
  let index:number;
  if(fish){
   const side=Math.abs(u-.5),tail=v>.80;
   const half=tail?.15+(v-.80)*1.25:v<.18?.11+v*1.10:v<.60?.31+(v-.18)*.15:.37-(v-.60)*.95;
   const fin=v>.40&&v<.68&&u<.22&&u>.09;
   const fork=tail&&v>.88&&side<.07+(v-.88)*.65;
   if((side>half&&!fin)||fork){data[(py*width+px)*4+3]=0;continue;}
   const eye=v>.17&&v<.29&&u>.61&&u<.76;
   const gill=v>.31&&v<.43&&u>.63&&u<.72;
   const scale=v>.42&&v<.78&&((px+Math.floor(py/2))%4===0);
   index=eye?0:gill?0:side>half-pixel||fin?0:tail?1:u>.62?4:u<.34?1:scale?3:2;
   if(noise>.94&&v>.48&&v<.77&&index===2)index=3;
  }else if(kind==='fillet'){
   const half=.39-v*.13,side=Math.abs(u-.51);
   if(v<.07||v>.91||side>half){data[(py*width+px)*4+3]=0;continue;}
   const skin=u<.51-half+.07;
   const fatLine=Math.abs(v-(.14+.56*u))<.055||Math.abs(v-(.62-.40*u))<.04;
   index=skin?0:side>half-.055?1:fatLine?4:noise>.84?3:2;
  }else{
   const dx=(u-.5)/(kind==='ham'?(v>.64?.23:.39):.43),dy=(v-.5)/(kind==='ham'?.49:.40);
   const outline=Math.pow(Math.abs(dx),2.6)+Math.pow(Math.abs(dy),2.6)+Math.sin(v*15+seed)*.045;
   if(outline>1){data[(py*width+px)*4+3]=0;continue;}
   const fatEdge=outline>.58&&outline<.83&&((u>.62&&v>.18&&v<.85)||(v>.69&&u>.25&&u<.72));
   const marbling=Math.abs(v-(.25+.48*u+.035*Math.sin(u*16)))<.04&&u>.19&&u<.75;
   const hamBone=kind==='ham'&&v>.78&&u>.40&&u<.60;
   index=outline>.83?0:hamBone?5:fatEdge?5:marbling?4:noise>.84?3:noise<.19?1:2;
  }
  const color=colors[index];data.set([color[0],color[1],color[2],255],(py*width+px)*4);
 }
 const map=new THREE.DataTexture(data,width,height);map.colorSpace=THREE.SRGBColorSpace;
 map.minFilter=map.magFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

export function buildMarketPiece(p:PieceSpec):THREE.BufferGeometry|undefined{
 const {role,position:[x,y,z],size:[w,h,d]}=p;
 if(role.startsWith('market-pennant-')){
  const shape=new THREE.Shape();shape.moveTo(-w/2,h/2);shape.lineTo(w/2,h/2);shape.lineTo(0,-h/2);shape.closePath();
  const g=new THREE.ShapeGeometry(shape);g.translate(x,y,z);return g;
 }
 if(role.startsWith('market-banner-')&&role!=='market-banner-mark'){
  const shape=new THREE.Shape();shape.moveTo(-w/2,h/2);shape.lineTo(w/2,h/2);shape.lineTo(w/2,-h/2);
  shape.lineTo(0,-h*.32);shape.lineTo(-w/2,-h/2);shape.closePath();
  const g=new THREE.ShapeGeometry(shape);g.translate(x,y,z);return g;
 }
 if(role==='market-banner-mark'){
  const shape=new THREE.Shape();shape.moveTo(0,h/2);shape.lineTo(w/2,0);shape.lineTo(0,-h/2);shape.lineTo(-w/2,0);shape.closePath();
  const g=new THREE.ShapeGeometry(shape);g.translate(x,y,z);return g;
 }
 if(role==='market-sack'){
  const body=new THREE.CylinderGeometry(w*.32,w*.50,h*.82,7,2),neck=new THREE.CylinderGeometry(w*.23,w*.32,h*.22,7);
  body.translate(x,y-h*.04,z);neck.translate(x,y+h*.42,z);return merge([body,neck]);
 }
 if(role==='market-meat-cut'||role==='market-hanging-meat'){
  const hanging=role==='market-hanging-meat',g=new THREE.PlaneGeometry(w,hanging?h:d);
  g.userData.preservePaintUV=true;
  if(!hanging)g.rotateX(-Math.PI/2);
  g.translate(x,y,z);return g;
 }
 if(role==='market-fish'||role==='market-fish-red'||role==='market-hanging-fish'||role==='market-hanging-fish-red'){
  const hanging=role.includes('hanging'),length=hanging?h:d;
  const g=new THREE.PlaneGeometry(w,length);
  g.userData.preservePaintUV=true;
  if(!hanging){g.rotateX(-Math.PI/2);g.rotateY(Math.PI/2);}
  g.translate(x,y,z);return g;
 }
 return undefined;
}
