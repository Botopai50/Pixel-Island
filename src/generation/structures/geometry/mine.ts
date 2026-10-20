import {ConvexGeometry} from 'three/examples/jsm/geometries/ConvexGeometry.js';
import * as THREE from 'three';
import type {PieceSpec,StructureConfig} from '../types';
import {extrudePolygon,merge} from './common';
import {natureAsset} from '../natureAdapters';

/** A mass of interlocking fractured strata, cut around a blind mine throat. */
function mineShell(p:PieceSpec,seed:number){
 const [w,h,d]=p.size,r=Math.max(2.1,Math.min(3.6,w*.36))/2+.12,spring=2.05,rise=1.28;
 const xs=[-.5,-.35,-.20,-.075,.075,.20,.35,.5].map((x,i)=>
  (x+(i>0&&i<7?Math.sin(seed*.23+i*4.7)*.018:0))*w);
 const zs=[-.5,-.31,-.10,.13,.33,.5].map((z,i)=>
  (z+(i>0&&i<5?Math.sin(seed*.37+i*7.1)*.025:0))*d);
 const heights=[
  [.28,.55,.85,.94,.86,.60,.34],
  [.41,.73,.96,1,.95,.74,.43],
  [.34,.68,.86,.96,.90,.66,.32],
  [.22,.51,.70,.82,.74,.49,.20],
  [.12,.31,.48,.58,.49,.28,.09],
 ];
 const parts:THREE.BufferGeometry[]=[];
 for(let z=0;z<zs.length-1;z++)for(let x=0;x<xs.length-1;x++){
  const x0=xs[x],x1=xs[x+1],z0=zs[z],z1=zs[z+1];
  const jitter=Math.sin(seed*.41+x*17.1+z*6.8);
  const top=heights[z][x]*h+jitter*.10;
  let bottom=0;
  if(z0< -d/2+d*.5625&&x0<r&&x1> -r){
   const near=Math.max(0,Math.min(Math.abs(x0),Math.abs(x1))*(x0*x1>0?1:0));
   bottom=spring+rise*Math.sqrt(Math.max(0,1-near*near/(r*r)));
  }
  // Carve the continuous backing by narrow strips following the actual arch.
  // Columns that only touch the tunnel keep their full-height outer shoulder.
  const end=-d/2+d*.5625,cuts=[x0,x1];
  for(let i=1;i<12;i++)cuts.push(x0+(x1-x0)*i/12);
  for(const edge of [-r,r])if(edge>x0&&edge<x1)cuts.push(edge);
  cuts.sort((a,b)=>a-b);
  const depths=z0<end&&z1>end?[[z0,end],[end,z1]]:[[z0,z1]];
  for(const [startZ,endZ] of depths)for(let i=0;i<cuts.length-1;i++){
   const left=cuts[i],right=cuts[i+1],middle=(left+right)/2;
   let floor=0;
   if(startZ<end&&Math.abs(middle)<r){
    const nearest=left*right<=0?0:Math.min(Math.abs(left),Math.abs(right));
    floor=spring+rise*Math.sqrt(Math.max(0,1-nearest*nearest/(r*r)));
   }
   const height=top-.035-floor;if(height<=.005)continue;
   const core=new THREE.BoxGeometry(right-left,height,endZ-startZ);
   core.translate(middle,floor+height/2-h/2,(startZ+endZ)/2);
   parts.push(core);
  }
  if(top<=bottom+.13)continue;
  const count=x===0||x===xs.length-2?1:Math.max(1,Math.round((top-bottom)/(1.18+.25*Math.sin(x*2+z+seed))));
  const bed=(level:number)=>bottom+(top-bottom)*(level/count+Math.sin(level/count*Math.PI)*Math.sin(seed+x*8.3+z*3.1)*.13);
  for(let level=0;level<count;level++){
   const y0=bed(level),y1=bed(level+1);
   const width=(x1-x0)*1.36,depth=(z1-z0)*1.36,height=y1-y0;
   const centreX=(x0+x1)/2,centreZ=(z0+z1)/2;
   const phase=seed*.17+x*2.31+z*4.17+level*1.83;
   const corners:THREE.Vector3[]=[];
   // Unequal polygonal rings form fractured polyhedra, without rectangular caps.
   for(let ring=0;ring<3;ring++)for(let i=0;i<7;i++){
    const angle=phase+i*Math.PI*2/7+Math.sin(phase+i*3.7)*.11;
    const radial=.68*(.94+.10*Math.sin(phase*2+i*5.1+ring*.7));
    const taper=ring===2?.93:ring===1?1.03:1;
    let px=centreX+Math.cos(angle)*width*radial*taper+ring*Math.sin(phase)*.055;
    const pz=centreZ+Math.sin(angle)*depth*radial*taper+ring*Math.cos(phase)*.05;
    const py=ring===0?y0:ring===1?y0+height*(.48+.10*Math.sin(angle+phase)):y1+.055+Math.sin(angle*2+phase)*Math.min(.13,height*.13);
    if(y0<spring+rise&&Math.abs(centreX)>r&&pz<end&&Math.abs(px)<r+.025)px=Math.sign(centreX)*(r+.025);
    corners.push(new THREE.Vector3(px,py-h/2,pz));
   }
   corners.push(new THREE.Vector3(centreX+width*.13*Math.sin(phase),y1+Math.min(.25,height*.23)-h/2,centreZ+depth*.12*Math.cos(phase)));
   const g=new ConvexGeometry(corners);
   g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
   parts.push(g);
  }
 }
 // Keep the solid backing in its original coordinates. Nonlinear displacement
 // of differently subdivided faces caused cracks and stretched strip triangles.
 return rockAttributes(merge(parts));
}

function rockAttributes(geometry:THREE.BufferGeometry){
 const pos=geometry.attributes.position;geometry.computeVertexNormals();const normals=geometry.attributes.normal;
 const sums=new Map<string,THREE.Vector3>(),edges=new Map<string,number[]>(),face:THREE.Vector3[]=[];
 const key=(i:number)=>[pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>v.toFixed(4)).join(',');
 const edgeKey=(a:number,b:number)=>[key(a),key(b)].sort().join('|');
 for(let i=0;i<pos.count;i+=3){
  face.push(new THREE.Vector3().fromBufferAttribute(normals,i));
  for(let k=0;k<3;k++){const at=i+k,id=key(at),sum=sums.get(id)??new THREE.Vector3();sum.add(face[i/3]);sums.set(id,sum);const ek=edgeKey(i+(k+1)%3,i+(k+2)%3);edges.set(ek,[...(edges.get(ek)??[]),i/3]);}
 }
 const moss=new Float32Array(pos.count*3),distance=new Float32Array(pos.count*3),flags=new Float32Array(pos.count*3).fill(.5),light=new THREE.Vector3(-.5,.8,-.5).normalize();
 for(let i=0;i<pos.count;i++)sums.get(key(i))!.clone().normalize().toArray(moss,i*3);
 for(let i=0;i<pos.count;i+=3)for(let k=0;k<3;k++){
  const a=new THREE.Vector3().fromBufferAttribute(pos,i+k),b=new THREE.Vector3().fromBufferAttribute(pos,i+(k+1)%3),c=new THREE.Vector3().fromBufferAttribute(pos,i+(k+2)%3);
  const height=b.clone().sub(a).cross(c.clone().sub(a)).length()/Math.max(.0001,b.distanceTo(c));
  const other=edges.get(edgeKey(i+(k+1)%3,i+(k+2)%3))!.find(t=>t!==i/3),n=face[i/3];
  const flag=other!==undefined&&n.dot(face[other])<.93&&n.dot(light)>.25&&n.dot(light)>face[other].dot(light)+.15?1:.5;
  for(let j=0;j<3;j++)flags[(i+j)*3+k]=flag;
  distance[(i+k)*3+k]=height;
 }
 geometry.setAttribute('aMossNormal',new THREE.BufferAttribute(moss,3));geometry.setAttribute('aEdge',new THREE.BufferAttribute(distance,3));geometry.setAttribute('aEdgeFlag',new THREE.BufferAttribute(flags,3));return geometry;
}

function mineMasonry(p:PieceSpec,seed:number){
 const bevel=Math.min(.055,p.size[1]*.1),w=p.size[0]/2-bevel,h=p.size[1]/2-bevel,corner=Math.min(w,h)*.28;
 const tilt=Math.sin(seed*2.7)*.025,shape=new THREE.Shape();
 const points:[number,number][]=[[-w,-h+corner],[-w+corner,-h],[w-corner,-h],[w,-h+corner],[w,h-corner],[w-corner,h+tilt],[-w+corner,h-tilt],[-w,h-corner]];
 points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:p.size[2]-bevel*2,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,steps:1});
 geometry.translate(0,0,-p.size[2]/2+bevel);return rockAttributes(geometry);
}

/** Native faceted rock and its pixel shader, fitted to a cavity-safe envelope. */
export function mineRock(p:PieceSpec,c:StructureConfig,seed:number){
 const asset=natureAsset('rock',c,seed,undefined,p.size);
 if(p.role==='mine-rock-shell'||p.role==='mine-tunnel-lining'||p.role==='mine-portal-rock'||p.role==='mine-footing'){
  const mesh=asset.group.getObjectByName('Rock_1') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  const geometry=p.role==='mine-rock-shell'?mineShell(p,seed):p.role==='mine-tunnel-lining'?rockAttributes(buildMinePiece(p)!.translate(-p.position[0],-p.position[1],-p.position[2])):mineMasonry(p,seed);
  mesh.geometry=geometry;
  if(p.role==='mine-rock-shell'||p.role==='mine-tunnel-lining')asset.group.position.set(...p.position);
  else {geometry.computeBoundingBox();asset.group.position.copy(new THREE.Vector3(...p.position).sub(geometry.boundingBox!.getCenter(new THREE.Vector3())));}
  asset.group.name=p.role;let disposed=false;
  return {group:asset.group,update:asset.update,dispose:()=>{if(disposed)return;disposed=true;geometry.dispose();asset.dispose();}};
 }
 const bounds=new THREE.Box3().setFromObject(asset.group),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 asset.group.scale.set(p.size[0]/size.x,p.size[1]/size.y,p.size[2]/size.z);
 asset.group.position.set(p.position[0]-center.x*asset.group.scale.x,p.position[1]-center.y*asset.group.scale.y,p.position[2]-center.z*asset.group.scale.z);
 asset.group.name=p.role;return asset;
}

export function buildMinePiece(p:PieceSpec){
 if(p.role==='mine-tunnel-lining'){
  const curve:[number,number][]=[[p.size[0]/2,-p.position[1]],[p.size[0]/2,0]];
  for(let i=1;i<=24;i++){const angle=i*Math.PI/24;curve.push([p.size[0]/2*Math.cos(angle),p.size[1]*Math.sin(angle)]);}
  curve.push([-p.size[0]/2,-p.position[1]]);
  const positions:number[]=[];
  for(let i=0;i<curve.length-1;i++){
   const a=[...curve[i],-p.size[2]/2],b=[...curve[i+1],-p.size[2]/2],c=[...curve[i+1],p.size[2]/2],d=[...curve[i],p.size[2]/2];
   positions.push(...a,...c,...b,...a,...d,...c);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));g.computeVertexNormals();g.translate(...p.position);return g;
 }
 if(p.role==='mine-mouth'){
  const parts:THREE.BufferGeometry[]=[],radius=p.size[0]/2,rise=p.size[1];
  for(let layer=0;layer<3;layer++)for(let i=0;i<16;i++){
   const start=i*Math.PI/16,end=(i+1)*Math.PI/16,gap=.003;
   const inner=layer*.11,outer=inner+.108;
   const point=(angle:number,offset:number):[number,number]=>[(radius+offset)*Math.cos(angle),(rise+offset)*Math.sin(angle)];
   parts.push(extrudePolygon([point(start+gap,inner),point(end-gap,inner),point(end-gap,outer),point(start+gap,outer)],p.size[2]));
  }
  const geometry=merge(parts);geometry.translate(...p.position);return geometry;
 }
 if(p.role==='mine-hook'){
  const geometry=new THREE.TorusGeometry(p.size[0]/2,.017,4,8);geometry.translate(...p.position);return geometry;
 }
 return undefined;
}
