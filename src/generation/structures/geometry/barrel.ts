import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {buildAncientPiece} from './ancientRuins';
import {BARREL_PROFILE,barrelRadiusAt} from '../barrelProfile';

export function buildBarrelPiece(p:PieceSpec){
 if(!p.role.startsWith('barrel-'))return;
 const r=p.size[0]/2,h=p.size[1];
 if(p.role==='barrel-stave'){
  const angle=p.rotation![1],half=Math.PI/20-.003,index=Math.round(angle/(Math.PI/10)),points:number[]=[],uv:number[]=[],colors:number[]=[];
  const levels=BARREL_PROFILE.map(([t])=>t),radius=(t:number)=>r*barrelRadiusAt(t),tone=.88+(Math.sin(angle*41.7)*.5+.5)*.22;
  const point=(t:number,at:number,inside=false)=>{const rr=radius(t)-(inside?r*.09:0);return [Math.sin(at)*rr,(t-.5)*h,Math.cos(at)*rr];};
  const quad=(a:number[],b:number[],c:number[],d:number[],shade:number)=>{
   for(const v of [a,b,c,a,c,d]){points.push(...v);const delta=Math.atan2(Math.sin(Math.atan2(v[0],v[2])-angle),Math.cos(Math.atan2(v[0],v[2])-angle));uv.push(((index%3)+delta/(half*2)+.5)*.28,v[1]+h/2+(index%4)*.41);colors.push(shade,shade,shade);}
  };
  for(let row=0;row<levels.length-1;row++)for(let side=0;side<3;side++){
   const lo=angle-half+side*half*2/3,hi=lo+half*2/3,t0=levels[row],t1=levels[row+1];
   quad(point(t0,lo),point(t0,hi),point(t1,hi),point(t1,lo),tone*(side===0?.94:side===2?1.04:1));
   quad(point(t0,hi,true),point(t0,lo,true),point(t1,lo,true),point(t1,hi,true),tone*.62);
  }
  for(let row=0;row<levels.length-1;row++)for(const side of [-1,1]){
   const at=angle+side*half,t0=levels[row],t1=levels[row+1];
   const a=point(t0,at),b=point(t0,at,true),cc=point(t1,at,true),d=point(t1,at);
   side<0?quad(a,b,cc,d,tone*.62):quad(b,a,d,cc,tone*.62);
  }
  for(let side=0;side<3;side++){
   const lo=angle-half+side*half*2/3,hi=lo+half*2/3;
   quad(point(1,lo,true),point(1,lo),point(1,hi),point(1,hi,true),tone*1.14);
   quad(point(0,hi,true),point(0,hi),point(0,lo),point(0,lo,true),tone*.70);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.translate(...p.position);g.userData.preservePaintUV=true;return g;
 }
 if(p.role==='barrel-core'){
  const profile=BARREL_PROFILE.map(([t,radius])=>new THREE.Vector2(r*radius,(t-.5)*h));
  profile.unshift(new THREE.Vector2(0,-h/2));
  const g=new THREE.LatheGeometry(profile,40);g.translate(...p.position);return g;
 }
 if(p.role==='barrel-hoop'){
  const [wholeH,rr,u]=p.end!;
  const radius=(y:number)=>rr*barrelRadiusAt(y/wholeH)+.018*u;
  const lower=radius(p.position[1]-h/2),upper=radius(p.position[1]+h/2),thickness=.025*u;
  const profile=[new THREE.Vector2(lower-thickness,-h/2),new THREE.Vector2(lower,-h/2),new THREE.Vector2(upper,h/2),new THREE.Vector2(upper-thickness,h/2),new THREE.Vector2(lower-thickness,-h/2)];
  const g=new THREE.LatheGeometry(profile,40),uv=g.getAttribute('uv'),pos=g.getAttribute('position');
  for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*Math.PI*2*r,pos.getY(i));
  g.translate(...p.position);g.userData.preservePaintUV=true;return g;
 }
 if(p.role==='barrel-rivet'){
  const g=new THREE.ConeGeometry(p.size[0]*.71,p.size[1],4);g.rotateY(Math.PI/4);g.rotateX(Math.PI/2);g.rotateY(p.rotation![1]);g.translate(...p.position);return g;
 }
 if(p.role==='barrel-lid-brace')return buildAncientPiece({...p,role:'ancient-masonry'});
 if(p.role==='barrel-lid-board'){
  const [left,right,radius]=p.end!;
  let polygon=Array.from({length:40},(_,i)=>[Math.cos(i*Math.PI/20)*radius,Math.sin(i*Math.PI/20)*radius]);
  for(const [bound,direction] of [[left,1],[right,-1]]){
   const output:number[][]=[];
   for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],insideA=(a[0]-bound)*direction>=0,insideB=(b[0]-bound)*direction>=0;if(insideA)output.push(a);if(insideA!==insideB){const t=(bound-a[0])/(b[0]-a[0]);output.push([bound,a[1]+(b[1]-a[1])*t]);}}
   polygon=output;
  }
  const shape=new THREE.Shape();polygon.forEach(([x,z],i)=>i?shape.lineTo(x,z):shape.moveTo(x,z));shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);
  const pos=g.getAttribute('position'),uv=g.getAttribute('uv'),board=Math.round((left+radius)/(radius*2/7));
  // These pieces store clipping bounds in `end`, not a timber direction.
  // Explicit UVs keep every lid board's grain parallel to its actual length.
  for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)-left+board*.19,pos.getZ(i)+radius);
  g.userData.preservePaintUV=true;g.translate(p.position[0],p.position[1]+h/2,p.position[2]);return g;
 }
}
