import * as THREE from 'three';
import type {RoofSurface,V3} from '../types';
import {merge} from './common';

/** Overlapping bundles make the layered and frayed silhouette of straw. */
export function buildThatchRoof(r:RoofSurface,singleSlope=false,thicknessScale=1){
 const ratio=r.ridgeRatio??.5,ridge=r.x-r.width/2+r.width*ratio;
 const front=r.z-r.depth/2-r.eaves,back=r.z+r.depth/2+r.eaves;
 const count=Math.ceil((back-front)/.11),step=(back-front)/count;
 const parts:THREE.BufferGeometry[]=[];
 const hash=(i:number,j:number)=>{const n=Math.sin(i*127.1+j*311.7+r.x*17+r.z*23)*43758.5453;return n-Math.floor(n);};
 for(const side of singleSlope?[-1]:[-1,1]){
  const span=r.width*(side<0?ratio:1-ratio),slope=r.rise/span;
  const edge=ridge+side*(span+r.eaves),low=r.y-slope*r.eaves;
  const normal=new THREE.Vector3(side*slope,1,0).normalize();
  const point=(t:number,z:number):V3=>[ridge+(edge-ridge)*t,r.y+r.rise+(low-r.y-r.rise)*t,z];
  for(let row=0;row<4;row++)for(let i=0;i<count;i++){
   const tuft=hash(i,row+side*11),upper=Math.max(0,row/4-.035);
   const lower=(row+1)/4+(row===3?.012+tuft*.025:(tuft-.25)*.025);
   const a=front+i*step,b=a+step;
   let points=[point(upper,a),point(lower,a),point(lower,b),point(upper,b)].map(p=>new THREE.Vector3(...p));
   if(points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).y<0)points.reverse();
   const thickness=(.28+(3-row)*.045)*thicknessScale;
   const vertices=[...points,...points.map(p=>p.clone().addScaledVector(normal,thickness))],positions:number[]=[],layers:number[]=[];
   // Both slopes terminate on the same ridge, without an overlapping cover.
   if(row===0&&!singleSlope){
    const ridgeLift=thickness*Math.sqrt(1+(r.rise/(r.width*Math.min(ratio,1-ratio)))**2);
    points.forEach((p,j)=>{if(Math.abs(p.x-ridge)<1e-8)vertices[j+4].set(ridge,r.y+r.rise+ridgeLift,p.z);});
   }
   const progress=points.map(p=>(((p.x-ridge)/(edge-ridge))-upper)/(lower-upper));
   const tri=(a:number,b:number,c:number)=>{for(const i of [a,b,c]){positions.push(...vertices[i].toArray());layers.push(progress[i%4]);}};
   tri(0,2,1);tri(0,3,2);tri(4,5,6);tri(4,6,7);
   for(let j=0;j<4;j++){const k=(j+1)%4;tri(j,k,k+4);tri(j,k+4,j+4);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
   g.setAttribute('thatchLayer',new THREE.Float32BufferAttribute(layers,1));
   g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));g.computeVertexNormals();parts.push(g);
  }
 }
 return merge(parts);
}
