import * as THREE from 'three';
import { WaterfallFeature, waterfallCenter, waterfallWidth, waterfallWorld } from './waterfallFeatures.ts';
/** One indexed ribbon: the first arc quad reuses the final river row. */
export function createWaterfallGeometry(f:WaterfallFeature){
 const springWorld=waterfallWorld(f,waterfallCenter(f,-f.length+24),-f.length+24,0),springRadius=f.width*1.15;
 const springPool:number[]=[];
 const positions:number[]=[],uv:number[]=[],flow:number[]=[],cascade:number[]=[],waveWeight:number[]=[],direction:number[]=[],indices:number[]=[];let previous:number[]|null=null,length=0,last:THREE.Vector3|null=null,lipLength=0,falling=false;
 const columns=24;
 function row(x:number,z:number,y:number,width:number){
  const center=waterfallWorld(f,x,z,y),p=new THREE.Vector3(center.x,center.y,center.z);
  if(last)length+=last.distanceTo(p);last=p;
  const current:number[]=[];
  for(let j=0;j<=columns;j++){
   const q=waterfallWorld(f,x+(j/columns-.5)*width*1.14,z,y);
   current.push(positions.length/3);positions.push(q.x,q.y,q.z);uv.push(j/columns,length);springPool.push(springWorld.x,springWorld.z,springRadius);
   const texturePoint=falling?waterfallWorld(f,x+(j/columns-.5)*width*1.14,length-lipLength,0):q;
   flow.push(texturePoint.x,texturePoint.z);
   cascade.push((j/columns-.5)*width*1.14,length);
   const t=j/columns;
   const sides=THREE.MathUtils.smoothstep(t,.14,.32)*(1-THREE.MathUtils.smoothstep(t,.68,.86));
   const vertical=falling?THREE.MathUtils.smoothstep(length-lipLength,.8,2)*THREE.MathUtils.smoothstep(y,.2,1.6)*THREE.MathUtils.smoothstep(f.upper-y,0,2):0;
   waveWeight.push(sides*vertical);direction.push(f.fx,f.fz);
  }
  if(previous)for(let j=0;j<columns;j++)indices.push(previous[j],current[j],previous[j+1],current[j],current[j+1],previous[j+1]);
  previous=current;return current;
 }
 for(let i=0;i<=100;i++){const z=-f.length+f.length*i/100;row(waterfallCenter(f,z),z,f.upper,waterfallWidth(f,z));}
 const sharedRow=previous!;const arcOffset=indices.length;
 lipLength=length;falling=true;
 for(let i=1;i<=32;i++){const a=i/32*Math.PI*.5;row(0,f.radius*Math.sin(a),f.upper-f.radius*(1-Math.cos(a)),f.width);}
 for(let i=1;i<=48;i++){const t=i/48;row(0,f.radius+.18*t*t,THREE.MathUtils.lerp(f.upper-f.radius,-.35,t),f.width*(1+.03*t));}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setAttribute('flowPosition',new THREE.Float32BufferAttribute(flow,2));geometry.setAttribute('cascadePosition',new THREE.Float32BufferAttribute(cascade,2));geometry.setAttribute('waveWeight',new THREE.Float32BufferAttribute(waveWeight,1));geometry.setAttribute('fallDirection',new THREE.Float32BufferAttribute(direction,2));geometry.setAttribute('springPool',new THREE.Float32BufferAttribute(springPool,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.boundingSphere!.radius+=.225;
 return {geometry,sharedRow,arcOffset,columns};
}

