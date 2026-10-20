import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {createIvyLeafSurface} from '../ivySurface';
import {merge} from './common';

export function buildAncientPiece(p:PieceSpec){
 if(!p.role.startsWith('ancient-')||p.role==='ancient-plinth')return;
 let g:THREE.BufferGeometry;
 if(p.role==='ancient-ivy'){
  const leaf=createIvyLeafSurface(12),parts:THREE.BufferGeometry[]=[],unit=p.size[0]/.32,count=Math.max(4,Math.ceil(p.size[1]/(.14*unit)));
  const phase=p.position[0]*13.7+p.position[2]*19.3;
  const random=(i:number)=>{const n=Math.sin(i*127.1+phase)*43758.5453;return n-Math.floor(n);};
  for(let i=0;i<count;i++)for(const side of [-1,1]){
   const key=i*7+(side+1)*2;if(i>0&&random(key)<.16)continue;
   const width=.25+random(key+1)*.23,length=.18+random(key+2)*.16;
   const blade=leaf.geometry.clone();blade.scale(width*unit,length*unit,width*unit);blade.rotateZ(side*(.35+random(key+3)*.55));blade.rotateY((random(key+4)-.5)*.55);
   const bend=Math.sin(i*.63+phase)*.09+i/count*Math.sin(phase)*.12;
   blade.translate((bend+side*(.07+random(key+5)*.06))*unit,-(i+random(key+6)*.35)*p.size[1]/count,(.04+random(key+7)*.035)*unit);parts.push(blade);
  }
  leaf.geometry.dispose();leaf.material.dispose();leaf.texture.dispose();g=merge(parts);g.userData.preservePaintUV=true;
  if(p.rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));
 }else if(p.role==='ancient-arch-wedge'||p.role==='ancient-keystone'){
  const [r,thickness,depth]=p.size,angle=p.rotation![2],half=Math.PI/26-.003,shape=new THREE.Shape();
  const inner=r-thickness/2,outer=r+thickness/2;
  shape.moveTo(Math.cos(angle-half)*inner,Math.sin(angle-half)*inner);
  shape.lineTo(Math.cos(angle-half)*outer,Math.sin(angle-half)*outer);
  shape.lineTo(Math.cos(angle+half)*outer,Math.sin(angle+half)*outer);
  shape.lineTo(Math.cos(angle+half)*inner,Math.sin(angle+half)*inner);shape.closePath();
  g=new THREE.ExtrudeGeometry(shape,{depth:depth-.05,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:1,steps:1});g.translate(0,0,-depth/2+.025);
 }else if(p.role==='ancient-column-block'||p.role==='ancient-broken-column'){
  g=new THREE.CylinderGeometry(p.size[0]*.48,p.size[0]*.50,p.size[1],10);g.rotateY(p.rotation?.[1]??0);
  if(p.role==='ancient-broken-column'){
   const pos=g.getAttribute('position');for(let i=0;i<pos.count;i++)if(pos.getY(i)>0)pos.setY(i,pos.getY(i)-.07*(1+Math.sin(pos.getX(i)*16+pos.getZ(i)*7)));g.computeVertexNormals();
  }
 }else{
  const [w,h,d]=p.size,b=Math.min(.035,h*.16,w*.12,d*.12),shape=new THREE.Shape();
  shape.moveTo(-w/2+b,-h/2+b);shape.lineTo(w/2-b,-h/2+b);shape.lineTo(w/2-b,h/2-b);shape.lineTo(-w/2+b,h/2-b);shape.closePath();
  g=new THREE.ExtrudeGeometry(shape,{depth:d-2*b,bevelEnabled:true,bevelSize:b,bevelThickness:b,bevelSegments:1,steps:1});g.translate(0,0,-d/2+b);
  if(p.rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));
 }
 g.translate(...p.position);return g;
}
