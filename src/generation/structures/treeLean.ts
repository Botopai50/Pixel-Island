import * as THREE from 'three';

export interface TreeLean {direction:[number,number];start:number;slope:number;}
export function treeLeanOffset(y:number,lean:TreeLean){
 const height=Math.max(0,y-lean.start),bend=height*height/(height+1.2)*lean.slope;
 return new THREE.Vector3(lean.direction[0]*bend,0,lean.direction[1]*bend);
}

/** Bend the native wood and leaf instances together, keeping roots and deck penetration fixed. */
export function bendLivingTree(group:THREE.Group,lean:TreeLean){
 group.updateMatrixWorld(true);
 const rootInverse=group.matrixWorld.clone().invert(),point=new THREE.Vector3(),matrix=new THREE.Matrix4();
 group.traverse(object=>{
  if(!(object instanceof THREE.Mesh)||object.userData.ground||object.name==='GroundMound')return;
  const toTree=rootInverse.clone().multiply(object.matrixWorld),fromTree=toTree.clone().invert();
  if(object instanceof THREE.InstancedMesh){
   for(let i=0;i<object.count;i++){
    object.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix).applyMatrix4(toTree);
    const offset=treeLeanOffset(point.y,lean);point.add(offset).applyMatrix4(fromTree);matrix.setPosition(point);object.setMatrixAt(i,matrix);
   }
   object.instanceMatrix.needsUpdate=true;object.computeBoundingBox();object.computeBoundingSphere();
  }else{
   const positions=object.geometry.getAttribute('position');
   for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).applyMatrix4(toTree);point.add(treeLeanOffset(point.y,lean)).applyMatrix4(fromTree);positions.setXYZ(i,point.x,point.y,point.z);
   }
   positions.needsUpdate=true;object.geometry.computeVertexNormals();object.geometry.computeBoundingBox();object.geometry.computeBoundingSphere();
  }
 });
 group.userData.treeLean=lean;
}
