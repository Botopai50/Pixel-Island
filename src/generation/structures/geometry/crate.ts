import * as THREE from 'three';
import type {PieceSpec,V3} from '../types';
import {buildAncientPiece} from './ancientRuins';

export function buildCratePiece(p:PieceSpec){
 if(!p.role.startsWith('crate-'))return;
 if(p.role==='crate-rivet'){
  const g=new THREE.ConeGeometry(p.size[0]*.71,p.size[1],4);g.rotateY(Math.PI/4);g.rotateX(Math.PI/2);
  if(p.rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));
  g.translate(...p.position);return g;
 }
 if(p.role==='crate-brace'){
  const start=new THREE.Vector3(...p.position),end=new THREE.Vector3(...p.end!),axis=end.clone().sub(start),length=axis.length();axis.normalize();
  const normal=new THREE.Vector3(Math.sin(p.rotation![1]),0,Math.cos(p.rotation![1])),across=axis.clone().cross(normal).normalize();
  const g=buildAncientPiece({...p,kind:'box',role:'ancient-masonry',position:[0,0,0],rotation:undefined,size:[p.size[0],length,p.size[2]]})!;
  g.applyMatrix4(new THREE.Matrix4().makeBasis(across,axis,normal));g.translate(...start.add(end).multiplyScalar(.5).toArray() as V3);return g;
 }
 if(p.kind==='box'&&p.material==='wood')return buildAncientPiece({...p,role:'ancient-masonry'});
}
