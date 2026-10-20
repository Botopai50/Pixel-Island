import * as THREE from 'three';
import type {PieceSpec,StructureConfig} from '../types';
import type {StructureResources} from '../materials';
import {buildBridgeVariantPiece} from './bridgeVariants';
import {buildFortressBarrel} from './fortress';
import {box,merge,extrudePolygon} from './common';
import {paintSurface} from '../surfacePainting';

export function buildSwampPiece(p:PieceSpec):THREE.BufferGeometry|undefined{
 if(p.role==='swamp-fish'){
  const g=extrudePolygon([[0,-.14],[-.055,-.06],[-.075,.035],[-.045,.085],[-.065,.14],[.065,.14],[.035,.085],[.075,.035],[.05,-.065]],p.size[2]);
  if(p.rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));g.translate(...p.position);return g;
 }
 if(p.role==='swamp-barrel')return buildFortressBarrel(p);
 if(p.role==='swamp-rope-wrap'){
  const g=buildBridgeVariantPiece({...p,role:'bridge-rope-wrap'})!;
  if(p.rotation){g.translate(-p.position[0],-p.position[1],-p.position[2]);g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));g.translate(...p.position);}
  return g;
 }
 if(p.role==='swamp-net'){
  const from=new THREE.Vector3(...p.position),to=new THREE.Vector3(...p.end!),delta=to.clone().sub(from),g=new THREE.CylinderGeometry(p.size[0]/2,p.size[0]/2,delta.length(),5);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate(...from.add(to).multiplyScalar(.5).toArray());return g;
 }
 if(p.role==='swamp-lily-pad'||p.role==='swamp-duckweed'){
  const g=new THREE.PlaneGeometry(p.size[0],p.size[2]);g.rotateX(-Math.PI/2);g.translate(...p.position);g.userData.preservePaintUV=true;return g;
 }
 if(p.role==='swamp-hanging-moss'){
  const grid=1/32,rows=Math.ceil(p.size[1]/grid),points:[number,number][]=[];
  for(let i=0;i<=rows;i++){const width=Math.max(grid,p.size[0]*(i<rows*.65?.45:.22));points.push([-Math.round(width/grid)*grid,-i*grid+p.size[1]/2]);}
  for(let i=rows;i>=0;i--)points.push([Math.round((i%3?1:2)*p.size[0]*.2/grid)*grid,-i*grid+p.size[1]/2]);
  const g=extrudePolygon(points,.012);g.translate(...p.position);return g;
 }
 if(p.role==='swamp-water-flower'){
  const parts:THREE.BufferGeometry[]=[];
  for(let i=0;i<7;i++){
   const center=i===6,angle=i*Math.PI/3,g=box([p.position[0]+(center?0:Math.sin(angle)*.10),p.position[1]+(center?.02:0),p.position[2]+(center?0:Math.cos(angle)*.10)],center?[.07,.04,.07]:[.08,.025,.13],[0,angle,0]);
   const c=new THREE.Color(center?'#eac151':'#efe8c7');g.setAttribute('color',new THREE.Float32BufferAttribute(Array.from({length:g.attributes.position.count},()=>[c.r,c.g,c.b]).flat(),3));parts.push(g);
  }
  return merge(parts);
 }
 return undefined;
}

export function swampMaterials(c:StructureConfig,resources:StructureResources){
 const result=new Map<string,THREE.MeshStandardMaterial>();
 const painted=(roles:string[],kind:'wood'|'thatch',color:string)=>{
  const map=paintSurface(kind,color,c.texelsPerMetre,32,.5,false),m=new THREE.MeshStandardMaterial({map,roughness:1,side:THREE.DoubleSide});resources.textures.add(map);resources.materials.add(m);roles.forEach(role=>result.set(role,m));
 };
 painted(['swamp-rope-wrap','swamp-net'],'thatch','#b49c68');painted(['swamp-hanging-moss'],'wood','#57713a');
 painted(['swamp-fish'],'wood','#c8c1a2');
 for(const role of ['swamp-lily-pad','swamp-duckweed','swamp-cloth']){
  const size=role==='swamp-lily-pad'?.65:role==='swamp-duckweed'?.4:.65,width=Math.max(8,Math.round(size*c.texelsPerMetre)),height=role==='swamp-cloth'?Math.round(.98*c.texelsPerMetre):width,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const u=(x+.5)/width-.5,v=(y+.5)/height-.5,cloth=role==='swamp-cloth',pad=role==='swamp-lily-pad';
   const visible=cloth?(y>3||x%4!==0):pad?(u*u+v*v<.24&&!(u>0&&Math.abs(v)<u*.35)):Math.sin(Math.floor(x/2)*17+Math.floor(y/2)*31)>.1;
   const emblem=cloth&&Math.abs(Math.abs(u)*1.8+Math.abs(v)-.45)<.075;
   const color=new THREE.Color(cloth?(emblem?'#d9ccb0':(x%4===0?'#4f8387':'#659a99')):((x+y)%5===0?'#7d9547':'#567937')).convertLinearToSRGB();
   data.set([Math.round(color.r*255),Math.round(color.g*255),Math.round(color.b*255),visible?255:0],(y*width+x)*4);
  }
  const map=new THREE.DataTexture(data,width,height);map.colorSpace=THREE.SRGBColorSpace;map.magFilter=map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;
  const m=new THREE.MeshStandardMaterial({map,roughness:1,alphaTest:.5,side:THREE.DoubleSide});resources.textures.add(map);resources.materials.add(m);result.set(role,m);
 }
 const flower=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});resources.materials.add(flower);result.set('swamp-water-flower',flower);
 return result;
}
