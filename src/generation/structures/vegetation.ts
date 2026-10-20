import {TREE_PRESETS} from '../vegetation/pixelTrees/constants/presets';
import {createWildflowerKit} from '../vegetation/pixelTrees/services/wildflowerSystem';
import * as THREE from 'three';
import type {StructurePlan,StructureConfig} from './types';
import {structureStreams} from './random';
import {natureAsset} from './natureAdapters';
import {createIvyLeafSurface} from './ivySurface';
import {treeLeanOffset,type TreeLean} from './treeLean';

export function blockedByArchitecture(p:StructurePlan,x:number,z:number,padding=.8) {
 if(p.volumes.some(v=>Math.abs(x-v.x)<v.width/2+padding&&Math.abs(z-v.z)<v.depth/2+padding))return true;
 if(p.pieces.some(piece=>!piece.removed&&piece.kind!=='tree'&&Math.abs(x-piece.position[0])<piece.size[0]/2+padding&&Math.abs(z-piece.position[2])<piece.size[2]/2+padding))return true;
 return p.accesses.some(access=>{const a=new THREE.Vector2(access.from[0],access.from[2]),b=new THREE.Vector2(access.to[0],access.to[2]),at=new THREE.Vector2(x,z),delta=b.clone().sub(a);const t=THREE.MathUtils.clamp(at.clone().sub(a).dot(delta)/Math.max(.001,delta.lengthSq()),0,1);return at.distanceTo(a.addScaledVector(delta,t))<access.width/2+padding;});
}
export function buildStructureNature(p:StructurePlan,c:StructureConfig,architecture?:THREE.Group) {
 const group=new THREE.Group();group.name='StructureVegetation';const attachments:ReturnType<typeof natureAsset>[]=[];
 if(c.vegetation>0) {
  const rnd=structureStreams(p.seed).streamFor('vegetation','placement');
  const bounds=new THREE.Box3();p.volumes.forEach(v=>{bounds.expandByPoint(new THREE.Vector3(v.x-v.width/2,0,v.z-v.depth/2));bounds.expandByPoint(new THREE.Vector3(v.x+v.width/2,0,v.z+v.depth/2));});
  if(bounds.isEmpty())bounds.set(new THREE.Vector3(-c.width/2,0,-c.depth/2),new THREE.Vector3(c.width/2,0,c.depth/2));
  const count=Math.round(c.vegetation*10),zones=p.propZones.filter(z=>z.kind==='garden'||z.kind==='cultivation');
  for(let i=0;i<count;i++)for(let trial=0;trial<20;trial++) {
   const zone=zones[i%Math.max(1,zones.length)];let x:number,z:number;
   if(zone&&trial<8){x=zone.x+(rnd()-.5)*zone.width;z=zone.z+(rnd()-.5)*zone.depth;}else {x=bounds.min.x-2+rnd()*(bounds.max.x-bounds.min.x+4);z=bounds.min.z-2+rnd()*(bounds.max.z-bounds.min.z+4);}
   if(blockedByArchitecture(p,x,z,.8))continue;
   if((c.type==='bridge'||c.type==='dock'||c.type==='swamp')&&p.propZones.some(zone=>zone.kind==='water'&&Math.abs(x-zone.x)<zone.width/2+.15&&Math.abs(z-zone.z)<zone.depth/2+.15))continue;
   if(attachments.some(o=>Math.hypot(o.group.position.x-x,o.group.position.z-z)<1.1))continue;
   const kind=c.type==='snowy'||i%4===0?'rock':c.ruin>.15&&i%3===0?'leaves':'flowers',asset=natureAsset(kind,c,p.seed+i*71);asset.group.position.set(x,0,z);asset.group.name='StructureNature_'+kind;attachments.push(asset);group.add(asset.group);break;
  }
 }
 if(c.type==='treehouse'&&p.pieces.some(piece=>piece.kind==='tree'&&!piece.removed)){
  for(const planter of p.pieces.filter(piece=>piece.role==='tree-planter'&&!piece.removed)){
   for(let i=0;i<3;i++){
    const flowers=natureAsset('flowers',c,p.seed+Number(planter.id.slice(6))*71+i*13,c.texelsPerMetre);
    flowers.group.position.set(planter.position[0]+(i-1)*planter.size[0]*.24,planter.position[1]+.20,planter.position[2]);
    flowers.group.name='TreehousePlanterFlowers';attachments.push(flowers);group.add(flowers.group);
   }
  }
  const tree=p.pieces.find(piece=>piece.kind==='tree')!,deck=p.pieces.find(piece=>piece.role==='tree-platform')!,rnd=structureStreams(p.seed).streamFor('vegetation','treehouse-ivy');
  const pixelDensity=c.texelsPerMetre,leafGrids=[Math.max(3,Math.round(.22*pixelDensity)),Math.max(3,Math.round(.31*pixelDensity)),Math.max(3,Math.round(.44*pixelDensity))],variants=leafGrids.map(grid=>({...createIvyLeafSurface(grid),matrices:[] as THREE.Matrix4[],trunkLeafCount:0}));
  const stems:THREE.Matrix4[]=[],dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
  const wood=architecture?.getObjectByName('ProceduralTreeWood'),ray=new THREE.Raycaster();
  const inverse=architecture?architecture.matrixWorld.clone().invert():new THREE.Matrix4();
  const lean=architecture?.getObjectByName('LivingTree')?.userData.treeLean as TreeLean|undefined;
  const axis=(y:number)=>new THREE.Vector3(tree.position[0],y,tree.position[2]).add(lean?treeLeanOffset(y-tree.position[1],lean):new THREE.Vector3());
  const surface=(point:THREE.Vector3,previous?:THREE.Vector3)=>{
   if(!wood||!architecture)return {point,normal:new THREE.Vector3(point.x-tree.position[0],0,point.z-tree.position[2]).normalize()};
   const center=axis(point.y),direction=point.clone().sub(center).normalize();
   const origin=center.clone().addScaledVector(direction,6).applyMatrix4(architecture.matrixWorld);
   ray.set(origin,direction.clone().negate().transformDirection(architecture.matrixWorld));
   const candidates=ray.intersectObject(wood,false).filter(hit=>hit.face&&hit.face.normal.clone().transformDirection(wood.matrixWorld).dot(ray.ray.direction)<0);
   const target=previous??center;candidates.sort((a,b)=>a.point.clone().applyMatrix4(inverse).distanceToSquared(target)-b.point.clone().applyMatrix4(inverse).distanceToSquared(target));
   const hit=candidates[0];if(!hit)return undefined;
   const normal=hit.face!.normal.clone().transformDirection(wood.matrixWorld).transformDirection(inverse);
   return {point:hit.point.clone().applyMatrix4(inverse).addScaledVector(normal,.015),normal};
  };
  const leaf=(at:THREE.Vector3,normal:THREE.Vector3,fan:number)=>{const roll=rnd(),variant=roll<.28?0:roll>.81?2:1;dummy.position.copy(at);dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);dummy.rotateX((rnd()-.5)*.35);dummy.rotateZ(fan);const scale=leafGrids[variant]/pixelDensity;dummy.scale.setScalar(scale);dummy.updateMatrix();variants[variant].matrices.push(dummy.matrix.clone());};
  const cluster=(at:THREE.Vector3,normal:number|THREE.Vector3)=>{const count=2+(rnd()>.35?1:0),turn=(rnd()-.5)*.8;for(let k=0;k<count;k++){const facing=typeof normal==='number'?new THREE.Vector3(Math.sin(normal),0,Math.cos(normal)):normal.clone();facing.applyAxisAngle(up,(rnd()-.5)*.45);leaf(at,facing,turn+[-1.05,1.05,.10][k]+(rnd()-.5)*.35);}};
  const stem=(from:THREE.Vector3,to:THREE.Vector3)=>{const span=to.clone().sub(from);dummy.position.copy(from).add(to).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(up,span.clone().normalize());dummy.scale.set(1,span.length(),1);dummy.updateMatrix();stems.push(dummy.matrix.clone());};
  const shoot=(at:THREE.Vector3,normal:number,side:number,cling=false)=>{
   const tangent=new THREE.Vector3(Math.cos(normal),0,-Math.sin(normal)),bend=at.clone().addScaledVector(tangent,side*.17).add(new THREE.Vector3(0,-.08,.0)),tip=at.clone().addScaledVector(tangent,side*(.28+rnd()*.10)).add(new THREE.Vector3(0,-.22,0));
   const bendSurface=cling?surface(bend):undefined,tipSurface=cling?surface(tip):undefined;
   const b=cling?bendSurface?.point:bend,t=cling?tipSurface?.point:tip;if(!b||!t)return;
   stem(at,b);stem(b,t);cluster(b,bendSurface?.normal??normal);cluster(t,tipSurface?.normal??normal+(rnd()-.5)*.25);
  };
  const woodBounds=wood?new THREE.Box3().setFromObject(wood).applyMatrix4(inverse):undefined;
  const climbTop=woodBounds?woodBounds.max.y-.12:tree.size[1],climbSteps=Math.ceil(climbTop/.12);
  // Coherent patches create leafy runs and bare stems rather than evenly spaced nodes.
  for(let strand=0;strand<3;strand++){
   let previous:THREE.Vector3|undefined,nextLeafY=.08+rnd()*.30;const phase=rnd()*6;
   for(let i=0;i<=climbSteps;i++){
    const y=i*climbTop/climbSteps,angle=strand*2.1+y*.54+Math.sin(y*.8+phase)*.16,radius=.78+Math.max(0,1-y)*.4;
    const projected=surface(axis(y).add(new THREE.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius)),previous);
    if(!projected){previous=undefined;continue;}
    const at=projected.point,normal=Math.atan2(projected.normal.x,projected.normal.z),patch=Math.sin(y*1.9+phase)+.42*Math.sin(y*4.7+phase*2);
    if(previous&&previous.distanceTo(at)<.70)stem(previous,at);
    if(y>=nextLeafY&&patch>-.15){cluster(at,projected.normal);nextLeafY=y+.20+rnd()*.25;if(patch>.6&&rnd()<.13)shoot(at,normal,rnd()>.5?-1:1,true);}
    previous=at;
   }
  }
  variants.forEach(variant=>variant.trunkLeafCount=variant.matrices.length);
  if(!deck.removed)for(const x of [-c.width*.36,c.width*.40])for(let strand=0;strand<2;strand++){
   let previous:THREE.Vector3|undefined,nextNode=rnd()*2;const count=strand?16+Math.floor(rnd()*7):25+Math.floor(rnd()*5),phase=rnd()*6;
   for(let i=0;i<count;i++){
    const at=new THREE.Vector3(x+strand*.17+Math.sin(i*.45+phase)*.10,deck.position[1]+.9-i*.09,-deck.size[2]/2-.12-strand*.025),normal=Math.PI+(rnd()-.5)*.30;
    if(previous)stem(previous,at);
    const patch=Math.sin(i*.44+phase)+Math.sin(i*.83+phase)*.28;
    if(i>=nextNode&&patch>-.30){cluster(at,normal);nextNode=i+2+rnd()*2.5;if(patch>.6&&rnd()<.17)shoot(at,normal,rnd()>.5?-1:1);}
    previous=at;
   }
  }
  const ivies=variants.map((variant,i)=>{const ivy=new THREE.InstancedMesh(variant.geometry,variant.material,variant.matrices.length);ivy.name=i===1?'TreehouseIvy':i===0?'TreehouseIvySmall':'TreehouseIvyLarge';ivy.userData.trunkLeafCount=variant.trunkLeafCount;ivy.userData.pixelDensity=pixelDensity;variant.matrices.forEach((matrix,j)=>ivy.setMatrixAt(j,matrix));ivy.castShadow=ivy.receiveShadow=true;group.add(ivy);return ivy;});
  const stemGeometry=new THREE.CylinderGeometry(.009,.012,1,5),stemMaterial=new THREE.MeshStandardMaterial({color:'#526137',roughness:1,fog:true}),stemMesh=new THREE.InstancedMesh(stemGeometry,stemMaterial,stems.length);stemMesh.name='TreehouseIvyStems';stems.forEach((matrix,i)=>stemMesh.setMatrixAt(i,matrix));stemMesh.castShadow=stemMesh.receiveShadow=true;group.add(stemMesh);
  attachments.push({group:new THREE.Group(),update:()=>{},dispose:()=>{ivies.forEach(ivy=>ivy.dispose());stemMesh.dispose();variants.forEach(variant=>{variant.geometry.dispose();variant.material.dispose();variant.texture.dispose();});stemGeometry.dispose();stemMaterial.dispose();}});
 }
 if(c.vegetation>.15&&c.ruin>.1){
  const source=Object.values(TREE_PRESETS).find(p=>p.prop?.kind==='flowers'&&p.prop.biome===c.biome)!;
  const kit=createWildflowerKit({...source,seed:p.seed},new THREE.Vector3(-.4,1,.3));
  const leaves:THREE.Matrix4[]=[],stems:THREE.Matrix4[]=[],dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),rnd=structureStreams(p.seed).streamFor('vegetation','ivy');
  for(const wall of p.walls.filter(w=>!w.removed).slice(0,8)){
   const dx=wall.end[0]-wall.start[0],dz=wall.end[2]-wall.start[2],length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length,nx=uz,nz=-ux;
   const offset=(rnd()>.5?1:-1)*length*.34,reach=Math.min(wall.height*.75,2.8)*c.vegetation,segments=Math.max(2,Math.ceil(reach/.28));let previous:THREE.Vector3|null=null;
   for(let i=0;i<=segments;i++){const y=wall.bottom+i*reach/segments,o=offset+Math.sin(i*.65)*.12;
    if(p.openings.some(opening=>opening.wall===wall.id&&Math.abs(o-opening.offset)<opening.width/2+.3&&y-wall.bottom>opening.bottom-.3&&y-wall.bottom<opening.bottom+opening.height+.3)){previous=null;continue;}
    const at=new THREE.Vector3((wall.start[0]+wall.end[0])/2+ux*o+nx*(wall.thickness/2+.06),y,(wall.start[2]+wall.end[2])/2+uz*o+nz*(wall.thickness/2+.06));
    if(previous){const delta=at.clone().sub(previous);dummy.position.copy(at).add(previous).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(up,delta.clone().normalize());dummy.scale.set(.7,delta.length(),.7);dummy.updateMatrix();stems.push(dummy.matrix.clone());}
    dummy.position.copy(at);dummy.rotation.set(Math.PI/2,-Math.atan2(dz,dx)+(i%2?-.5:.5),0);dummy.scale.setScalar(.25+rnd()*.12);dummy.updateMatrix();leaves.push(dummy.matrix.clone());previous=at;
   }
  }
  const ivy=new THREE.Group();ivy.name='ClimbingIvy';ivy.userData.wallVegetation=true;
  for(const [geometry,matrices] of [[kit.geometries[0],leaves],[kit.geometries[2],stems]] as const){if(!matrices.length)continue;const mesh=new THREE.InstancedMesh(geometry,kit.materials[1],matrices.length);matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=mesh.receiveShadow=true;ivy.add(mesh);}
  if(ivy.children.length)group.add(ivy);
  attachments.push({group:new THREE.Group(),update:()=>{},dispose:()=>{ivy.children.forEach(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});kit.geometries.forEach(g=>g.dispose());kit.materials.forEach(m=>m.dispose());kit.textures.forEach(t=>t.dispose());}});
 }
 let disposed=false;return {group,update:(time:number)=>attachments.forEach(a=>a.update(time)),dispose:()=>{if(disposed)return;disposed=true;attachments.forEach(a=>a.dispose());}};
}
