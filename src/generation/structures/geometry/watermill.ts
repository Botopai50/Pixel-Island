import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {buildAncientPiece} from './ancientRuins';
import {buildCratePiece} from './crate';
import {box,merge} from './common';

export function watermillWaterTexture(density:number,seed:number){
 const w=Math.max(32,Math.round(density*2)),h=Math.max(64,Math.round(density*4)),data=new Uint8Array(w*h*4);
 const palette=[[26,103,121],[31,121,138],[40,139,153],[51,153,164]],hash=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7+seed*.37)*43758.5453;return n-Math.floor(n);};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const cell=hash(Math.floor(x/5),Math.floor(y/4)),foam=hash(Math.floor(x/8),Math.floor(y/9)),index=Math.floor(cell*palette.length);
  const color=foam>.85&&y%9<2&&x%8>1?[151,220,221]:palette[index];data.set([...color,255],(y*w+x)*4);
 }
 const map=new THREE.DataTexture(data,w,h);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(.5,.25);map.minFilter=map.magFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

export function buildWatermillPiece(p:PieceSpec){
 if(!p.role.startsWith('watermill-'))return;
 if(p.role==='watermill-channel-base'){
  const [w,h,d]=p.size,bank=h*.60,floor=h*.30,inner=w-bank*2,parts:THREE.BufferGeometry[]=[box([0,-h/2+floor/2,0],[w,floor,d])];
  for(const side of [-1,1]){
   parts.push(box([side*(w/2-bank/2),floor/2,0],[bank,h-floor,d]));
   parts.push(box([0,-h/2+floor+h*.10,side*(d/2-bank/2)],[inner,h*.20,bank]));
  }
  const g=merge(parts);g.translate(...p.position);return g;
 }
 if(p.role==='watermill-pier'){const g=new THREE.BoxGeometry(...p.size);g.translate(...p.position);return g;}
 if(p.role==='watermill-bolt')return buildCratePiece({...p,role:'crate-rivet'});
 if(p.role==='watermill-wheel-rim'){
  const outer=p.size[0]/2,inner=outer-p.size[1],depth=p.size[2],angle=p.rotation![0]+Math.PI/2,half=Math.PI/16-.002,shape=new THREE.Shape();
  for(let i=0;i<=3;i++){const at=angle-half+i*half*2/3;i?shape.lineTo(Math.cos(at)*outer,Math.sin(at)*outer):shape.moveTo(Math.cos(at)*outer,Math.sin(at)*outer);}
  for(let i=3;i>=0;i--){const at=angle-half+i*half*2/3;shape.lineTo(Math.cos(at)*inner,Math.sin(at)*inner);}shape.closePath();
  const bevel=Math.min(.009,depth*.10),g=new THREE.ExtrudeGeometry(shape,{depth:depth-2*bevel,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,steps:1});g.translate(0,0,-depth/2+bevel);g.rotateY(Math.PI/2);g.translate(...p.position);return g;
 }
 if(p.role==='watermill-axle'||p.role==='watermill-wheel-hub'){
  const g=new THREE.CylinderGeometry(p.size[0]/2,p.size[0]/2,p.size[1],12);g.rotateZ(Math.PI/2);g.translate(...p.position);return g;
 }
 if(p.kind==='box'&&p.material!=='water'){
  const g=buildAncientPiece({...p,role:'ancient-masonry'})!;
  if(p.role==='watermill-masonry'){
   const index=Number(p.id.split('_').at(-1))||0,row=index%4,col=Math.floor(index/4)%4,sourceX=(col+.5)*.7-(row%2)*.35,sourceY=(row+.5)*.4;
   const pos=g.getAttribute('position'),normal=g.getAttribute('normal'),uv=g.getAttribute('uv');
   for(let i=0;i<pos.count;i++){
    const x=pos.getX(i)-p.position[0],y=pos.getY(i)-p.position[1],z=pos.getZ(i)-p.position[2],nx=Math.abs(normal.getX(i)),ny=Math.abs(normal.getY(i)),nz=Math.abs(normal.getZ(i));
    const a=ny>Math.max(nx,nz)?x:nx>nz?z:x,b=ny>Math.max(nx,nz)?z:y;
    uv.setXY(i,sourceX+Math.max(-.28,Math.min(.28,a)),sourceY+Math.max(-.14,Math.min(.14,b)));
   }
   g.userData.preservePaintUV=true;
  }
  return g;
 }
}
