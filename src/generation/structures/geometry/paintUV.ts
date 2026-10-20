import * as THREE from 'three';

/** Metres on the actual face, with an optional grain axis for timber. */
export function paintUV(geometry:THREE.BufferGeometry,grain?:THREE.Vector3,roofSurface=false){
 const result=geometry.index?geometry.toNonIndexed():geometry;
 if(result!==geometry)geometry.dispose();
 if(geometry.userData.preservePaintUV)return result;
 const positions=result.getAttribute('position');
 const uv=new Float32Array(positions.count*2);
 const normal=new THREE.Vector3(),point=new THREE.Vector3(),along=new THREE.Vector3(),across=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let start=0;start<positions.count;start+=3){
  a.fromBufferAttribute(positions,start);b.fromBufferAttribute(positions,start+1);c.fromBufferAttribute(positions,start+2);
  normal.crossVectors(b.sub(a),c.sub(a)).normalize();
  along.copy(grain??new THREE.Vector3(0,1,0));along.addScaledVector(normal,-along.dot(normal));
  if(roofSurface&&normal.y>.5&&along.lengthSq()<.001)along.set(1,0,0).addScaledVector(normal,-normal.x);
  if(along.lengthSq()<.001)along.set(0,0,1).addScaledVector(normal,-normal.z);
  if(along.lengthSq()<.001)along.set(1,0,0).addScaledVector(normal,-normal.x);
  along.normalize();across.crossVectors(along,normal).normalize();
  for(let i=start;i<start+3;i++){point.fromBufferAttribute(positions,i);uv[i*2]=point.dot(across);uv[i*2+1]=point.dot(along);}
 }
 result.setAttribute('uv',new THREE.BufferAttribute(uv,2));return result;
}
