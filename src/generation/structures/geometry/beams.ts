import * as THREE from 'three';import type {V3} from '../types';
export function buildBeam(start:V3,end:V3,section:number,jointCuts=0,cuts?:{start:V3;end:V3},faceHeight=section){
 const a=new THREE.Vector3(...start),span=new THREE.Vector3(...end).sub(a),length=Math.max(.001,span.length()-jointCuts*2),axis=span.clone().normalize();
 const g=new THREE.BoxGeometry(faceHeight,length,section,1,2,1),positions=g.attributes.position;
 const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis);
 if(cuts){
  for(let i=0;i<positions.count;i++){
   const fraction=positions.getY(i)/length+.5;
   const offset=new THREE.Vector3(positions.getX(i),0,positions.getZ(i)).applyQuaternion(rotation);
   const point=a.clone().addScaledVector(span,fraction).add(offset);
   if(fraction<.001||fraction>.999){const normal=new THREE.Vector3(...(fraction<.001?cuts.start:cuts.end));point.addScaledVector(axis,-normal.dot(offset)/normal.dot(axis));}
   positions.setXYZ(i,point.x,point.y,point.z);
  }
  g.computeVertexNormals();
 }else{
  for(let i=0;i<positions.count;i++){const y=positions.getY(i)/length+.5;positions.setX(i,positions.getX(i)*(1-.035*Math.sin(y*Math.PI)));}
  g.applyQuaternion(rotation);g.translate(a.x+span.x/2,a.y+span.y/2,a.z+span.z/2);
 }
 return g;
}
