import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {extrudePolygon,merge} from './common';

/** Matching bark and cut-wood faces, with a stepped, chipped boundary. */
function stakeFaces(p:PieceSpec,tip:boolean){
 const x=p.size[0]/2,z=p.size[2]/2,h=p.size[1]/2;
 const corners=[[-x,-z],[x,-z],[x,z],[-x,z]],parts:THREE.BufferGeometry[]=[];
 for(let face=0;face<4;face++){
  const start=corners[face],end=corners[(face+1)%4],length=Math.hypot(end[0]-start[0],end[1]-start[1]),steps=6;
  const boundary:[number,number][]=[];
  const depth=(i:number)=>i===0||i===steps-1||i===steps?.075:.025*(2+Math.floor((Math.sin(p.position[0]*31+p.position[2]*47+face*13+i*7)*.5+.5)*5));
  for(let i=0;i<steps;i++){
   const lo=length*i/steps,hi=length*(i+1)/steps;
   boundary.push([lo,(tip?-h:h)-depth(i)],[hi,(tip?-h:h)-depth(i)]);
  }
  // A shared corner height prevents cracks between adjacent faces.
  boundary.push([length,(tip?-h:h)-depth(steps)]);
  const polygon:[number,number][]=tip?[[0,-h],[length/2,h],[length,-h],...boundary.reverse()]:[[0,-h],[length,-h],...boundary.reverse()];
  const shape=new THREE.Shape();polygon.forEach(([u,y],i)=>i?shape.lineTo(u,y):shape.moveTo(u,y));shape.closePath();
  const g=new THREE.ShapeGeometry(shape),positions=g.getAttribute('position');
  for(let i=0;i<positions.count;i++){
   const t=positions.getX(i)/length,y=positions.getY(i);
   // All four sharpened faces meet at one central apex, not at four flat fins.
   if(tip&&Math.abs(y-h)<1e-6)positions.setXYZ(i,0,h,0);
   else positions.setXYZ(i,start[0]+(end[0]-start[0])*t,y,start[1]+(end[1]-start[1])*t);
  }
  // Shape winding varies with the polygon; orient every face outwards.
  const nonIndexed=g.toNonIndexed();g.dispose();const pos=nonIndexed.getAttribute('position');
  const normal=new THREE.Vector3(end[1]-start[1],0,start[0]-end[0]);
  const a=new THREE.Vector3().fromBufferAttribute(pos,0),b=new THREE.Vector3().fromBufferAttribute(pos,1),c=new THREE.Vector3().fromBufferAttribute(pos,2);
  if(b.sub(a).cross(c.sub(a)).dot(normal)<0)for(let i=0;i<pos.count;i+=3)for(let axis=0;axis<3;axis++){
   const value=pos.array[(i+1)*3+axis];pos.array[(i+1)*3+axis]=pos.array[(i+2)*3+axis];pos.array[(i+2)*3+axis]=value;
  }
  nonIndexed.computeVertexNormals();parts.push(nonIndexed);
 }
 if(!tip){const bottom=new THREE.PlaneGeometry(p.size[0],p.size[2]);bottom.rotateX(Math.PI/2);bottom.translate(0,-h,0);parts.push(bottom);}
 return merge(parts);
}
export function buildOutpostPiece(p:PieceSpec){
 let g:THREE.BufferGeometry;
 if(p.role.startsWith('outpost-roof-fascia-')){
  // Four mitred strips share one roof-local plane and exact corner vertices.
  const x=p.size[0]/2,z=p.size[2]/2,rim=.20;
  const outer:[number,number][]=[[-x,-z],[x,-z],[x,z],[-x,z]];
  const inner:[number,number][]=[[-x+rim,-z+rim],[x-rim,-z+rim],[x-rim,z-rim],[-x+rim,z-rim]];
  const side=Number(p.role.at(-1)),next=(side+1)%4;
  g=extrudePolygon([outer[side],outer[next],inner[next],inner[side]],p.size[1]);
  g.rotateX(Math.PI/2);g.translate(0,.075-p.size[1]/2,0);
 }else if(p.role==='outpost-stake-tip'||p.role==='outpost-palisade'){
  g=stakeFaces(p,p.role==='outpost-stake-tip');
 }else if(p.role==='outpost-door-ring')g=new THREE.TorusGeometry(p.size[0]*.38,.023,5,12);
 else if(p.role==='outpost-gate-arch'){
  const points:[number,number][]=[];
  for(let i=0;i<=16;i++){const t=i*Math.PI/16;points.push([p.size[0]/2*Math.cos(t),p.size[1]*Math.sin(t)+.17]);}
  for(let i=16;i>=0;i--){const t=i*Math.PI/16;points.push([p.size[0]/2*Math.cos(t),p.size[1]*Math.sin(t)-.17]);}
  g=extrudePolygon(points,p.size[2]);
 }else return null;
 if(p.rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));g.translate(...p.position);return g;
}
