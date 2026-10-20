import * as THREE from 'three';
import type {V3} from '../types';

/** Shaft and crown share the same flue, leaving the top genuinely open. */
export function buildChimney(position:V3,size:V3){
 const [width,height,depth]=size,hole=.35;
 const shape=new THREE.Shape();
 shape.moveTo(-width/2,-depth/2);shape.lineTo(width/2,-depth/2);
 shape.lineTo(width/2,depth/2);shape.lineTo(-width/2,depth/2);shape.closePath();
 const flue=new THREE.Path();
 flue.moveTo(-hole/2,-hole/2);flue.lineTo(-hole/2,hole/2);
 flue.lineTo(hole/2,hole/2);flue.lineTo(hole/2,-hole/2);flue.closePath();
 shape.holes.push(flue);
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1});
 geometry.rotateX(-Math.PI/2);
 geometry.translate(position[0],position[1]-height/2,position[2]);
 return geometry;
}
