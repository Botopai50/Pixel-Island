import * as THREE from 'three';
import {box,merge} from './common';

/** A half-window leaf rotating around its hinge, from closed to fully open. */
export function buildOpenShutter(width:number,height:number,side:number,openingDegrees=155){
 const leafWidth=width/2+.015,leafHeight=height-.02,angle=(180-openingDegrees)*Math.PI/180;
 const parts:{geometry:THREE.BufferGeometry;material:'wood'|'metal';role:string}[]=[];
 const boards=4,boardWidth=leafWidth/boards;
 parts.push({geometry:merge(Array.from({length:boards},(_,i)=>
  box([(i+.5)*boardWidth,0,0],[boardWidth-.006,leafHeight,.045]))),material:'wood',role:'shutter'});
 for(const level of [-.30,.30]){
  parts.push({geometry:box([leafWidth/2,leafHeight*level,-side*.0375],[leafWidth,.07,.03]),material:'wood',role:'shutter-rail'});
  const hinge=new THREE.CylinderGeometry(.023,.023,.11,8);
  hinge.translate(0,leafHeight*level,0);
  parts.push({geometry:hinge,material:'metal',role:'shutter-hinge'});
  parts.push({geometry:box([.075,leafHeight*level,-side*.058],[.15,.035,.012]),material:'metal',role:'shutter-strap'});
 }
 for(const part of parts)part.geometry.rotateY(side>0?angle:Math.PI-angle);
 return parts;
}
