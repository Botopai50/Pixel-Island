import * as THREE from 'three';
import type {StructurePlan} from './types';
import {buildRoof} from './geometry/roofs';
import {box} from './geometry/common';

/** Reserve the whole window, including trim and the sweep of its shutters. */
export function fitWindowsAroundRoofs(plan:StructurePlan){
 const blockers=[
  ...plan.roofs.filter(r=>!r.removed).map(r=>({volume:r.volume,geometry:buildRoof(r)})),
  ...plan.pieces.filter(p=>p.role==='porch-cover'&&!p.removed).map(p=>({volume:'',geometry:box(p.position,p.size,p.rotation)})),
 ].map(b=>{
  const geometry=b.geometry.index?b.geometry.toNonIndexed():b.geometry;
  if(geometry!==b.geometry)b.geometry.dispose();
  const pos=geometry.getAttribute('position'),triangles:THREE.Triangle[]=[];
  for(let i=0;i<pos.count;i+=3)triangles.push(new THREE.Triangle(
   new THREE.Vector3().fromBufferAttribute(pos,i),new THREE.Vector3().fromBufferAttribute(pos,i+1),new THREE.Vector3().fromBufferAttribute(pos,i+2)));
  geometry.dispose();return {volume:b.volume,triangles};
 });
 plan.openings=plan.openings.filter(o=>{
  if(o.kind!=='window')return true;
  const wall=plan.walls.find(w=>w.id===o.wall)!;
  const along=new THREE.Vector3(...wall.end).sub(new THREE.Vector3(...wall.start)).normalize();
  const normal=new THREE.Vector3(along.z,0,-along.x);
  const center=new THREE.Vector3(...wall.start).add(new THREE.Vector3(...wall.end)).multiplyScalar(.5).addScaledVector(along,o.offset);
  center.y=wall.bottom+o.bottom;
  const bounds=new THREE.Box3();
  for(const horizontal of [-o.width-.06,o.width+.06])for(const height of [-.14,o.height+.16])for(const depth of [-.08,wall.thickness/2+o.width/2+.25])
   bounds.expandByPoint(center.clone().addScaledVector(along,horizontal).addScaledVector(normal,depth).add(new THREE.Vector3(0,height,0)));
  bounds.expandByScalar(.04);
  return !blockers.some(b=>b.volume!==wall.volume&&b.triangles.some(t=>bounds.intersectsTriangle(t)));
 });
 return plan;
}
