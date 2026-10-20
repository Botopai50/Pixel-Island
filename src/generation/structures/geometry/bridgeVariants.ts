import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {extrudePolygon,merge} from './common';

function ropeLoop(halfX:number,halfY:number,tube:number){
 const r=Math.min(.075,halfX*.32,halfY*.32),points:THREE.Vector3[]=[];
 for(const [x,y,start] of [[halfX-r,halfY-r,0],[-halfX+r,halfY-r,Math.PI/2],[-halfX+r,-halfY+r,Math.PI],[halfX-r,-halfY+r,Math.PI*1.5]]){
  for(let i=0;i<=4;i++){const angle=start+i*Math.PI/8;points.push(new THREE.Vector3(x+r*Math.cos(angle),y+r*Math.sin(angle),0));}
 }
 return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points,true,'centripetal'),48,tube,5,true);
}

/** Three raised helical strands keep the braid visible under the game's lighting. */
function braidedRope(length:number,width:number){
 const parts:THREE.BufferGeometry[]=[new THREE.CylinderGeometry(width*.38,width*.38,length+.006,7)];
 const steps=Math.max(8,Math.ceil(length/.16*8));
 for(let strand=0;strand<3;strand++){
  const points:THREE.Vector3[]=[];
  for(let i=0;i<=steps;i++){
   const y=length*i/steps,angle=y/.16*Math.PI*2+strand*Math.PI*2/3;
   points.push(new THREE.Vector3(Math.cos(angle)*width*.33,y-length/2,Math.sin(angle)*width*.33));
  }
  parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),steps,width*.14,4,false));
 }
 return merge(parts);
}

export function buildBridgeVariantPiece(p:PieceSpec):THREE.BufferGeometry|null{
 if(p.role==='bridge-arch-voussoir'){
  const [w,h,d]=p.size,[start,end]=p.rotation!;
  const point=(angle:number,outer:boolean):[number,number]=>[(w*.4+(outer?.28:0))*Math.cos(angle),(h*.74+(outer?.28:0))*Math.sin(angle)];
  const g=extrudePolygon([point(start,false),point(end,false),point(end,true),point(start,true)],d);g.translate(...p.position);return g;
 }
 if(p.role==='bridge-stone-arch'){
  const [w,h,d]=p.size,points:[number,number][]=[[-w/2,0]],segments=32;
  for(let i=0;i<=segments;i++){const x=-w/2+w*i/segments,t=i/segments;points.push([x,h*.55+(h*.45+.35)*4*t*(1-t)-.04]);}
  points.push([w/2,0],[w*.4,0]);
  for(let i=0;i<=segments;i++){const angle=i/segments*Math.PI;points.push([w*.4*Math.cos(angle),h*.74*Math.sin(angle)]);}
  points.push([-w*.4,0]);
  const g=extrudePolygon(points,d);g.translate(...p.position);return g;
 }
 if(p.role==='bridge-rope-wrap'){
  const g=ropeLoop(p.size[0]/2,p.size[2]/2,p.size[1]/2);g.rotateX(Math.PI/2);g.translate(...p.position);return g;
 }
 if(p.role==='bridge-rope-tread-lashing'){
  const g=ropeLoop(p.size[0]/2,p.size[2]/2,p.size[1]/2);g.translate(...p.position);return g;
 }
 if(p.role==='bridge-rope-knot'){
  const radius=p.size[0]*.33,tube=p.size[0]*.14;
  const first=new THREE.TorusGeometry(radius,tube,5,12),second=new THREE.TorusGeometry(radius,tube,5,12);
  first.rotateY(Math.PI/4);second.rotateX(Math.PI/2);second.translate(0,0,tube*.7);
  const g=merge([first,second]);g.translate(...p.position);return g;
 }
 if(p.role.startsWith('bridge-rope-')&&p.kind==='beam'&&p.material==='thatch'){
  const from=new THREE.Vector3(...p.position),to=new THREE.Vector3(...p.end!),delta=to.clone().sub(from);
  const g=braidedRope(delta.length(),p.size[0]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate(...from.add(to).multiplyScalar(.5).toArray());return g;
 }
 return null;
}
