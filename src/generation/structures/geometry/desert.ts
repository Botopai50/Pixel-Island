import * as THREE from 'three';
import type {PieceSpec} from '../types';
import type {StructureResources} from '../materials';
import {buildStairs} from './stairs';
import {box} from './common';
import {paintSurface} from '../surfacePainting';

export function desertTerraceMaterial(density:number,seed:number,resources:StructureResources){
 const texture=paintSurface('plaster','#c9ab7c',density,seed,.7,false);
 const material=new THREE.MeshStandardMaterial({map:texture,roughness:1});resources.textures.add(texture);resources.materials.add(material);return material;
}

export function buildDesertPiece(p:PieceSpec):THREE.BufferGeometry|undefined{
 if(p.role==='desert-stair-parapet-end-post'){
  const original=box(p.position,p.size),g=original.toNonIndexed(),normal=g.getAttribute('normal'),indices:number[]=[];
  for(let i=0;i<normal.count;i+=3)if(normal.getY(i)>-.5)indices.push(i,i+1,i+2);
  const result=new THREE.BufferGeometry();for(const [name,attribute] of Object.entries(g.attributes)){const values:number[]=[];for(const i of indices)for(let k=0;k<attribute.itemSize;k++)values.push(attribute.array[i*attribute.itemSize+k]);result.setAttribute(name,new THREE.Float32BufferAttribute(values,attribute.itemSize));}g.dispose();original.dispose();return result;
 }
 if(p.role==='desert-stair-landing'){
  const left=p.position[0]-p.size[0]/2,right=p.position[0]+p.size[0]/2;
  const front=p.position[2]-p.size[2]/2,back=p.position[2]+p.size[2]/2,join=back-.455,inner=right-.24;
  const shape=new THREE.Shape();shape.moveTo(left,front);shape.lineTo(inner,front);shape.lineTo(inner,join);shape.lineTo(right,join);shape.lineTo(right,back);shape.lineTo(left,back);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:p.size[1],bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);g.translate(0,p.position[1]+p.size[1]/2,0);
  const pos=g.getAttribute('position'),indices:number[]=[];
  for(let i=0;i<pos.count;i+=3)if(![i,i+1,i+2].every(j=>Math.abs(pos.getX(j)-inner)<1e-5&&pos.getZ(j)<=join+1e-5))indices.push(i,i+1,i+2);
  const result=new THREE.BufferGeometry();for(const [name,attribute] of Object.entries(g.attributes)){const values:number[]=[];for(const i of indices)for(let k=0;k<attribute.itemSize;k++)values.push(attribute.array[i*attribute.itemSize+k]);result.setAttribute(name,new THREE.Float32BufferAttribute(values,attribute.itemSize));}g.dispose();return result;
 }
 if(p.role==='desert-access-stairs'||p.role==='desert-stair-landing-wall'){
  const original=p.kind==='stairs'?buildStairs({id:p.id,from:[p.position[0],p.position[1]-.036,p.position[2]],to:[p.end![0],p.end![1]-.036,p.end![2]],width:p.size[0],role:p.role}):box(p.position,p.size);
  const g=original.index?original.toNonIndexed():original,positions=g.getAttribute('position'),right=p.position[0]+p.size[0]/2,indices:number[]=[];
  // This face is internal to the continuous side wall, so it must not be rendered twice.
  for(let i=0;i<positions.count;i+=3)if(![i,i+1,i+2].every(j=>Math.abs(positions.getX(j)-right)<1e-5))indices.push(i,i+1,i+2);
  const result=new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(g.attributes)){
   const values:number[]=[];for(const i of indices)for(let k=0;k<attribute.itemSize;k++)values.push(attribute.array[i*attribute.itemSize+k]);
   result.setAttribute(name,new THREE.Float32BufferAttribute(values,attribute.itemSize));
  }
  if(g!==original)g.dispose();original.dispose();return result;
 }
 if(p.role==='desert-stair-side-wall'){
  const count=Math.ceil(p.size[1]/.2),run=p.size[2],total=p.end![2]-p.position[2],shape=new THREE.Shape();
  shape.moveTo(0,0);shape.lineTo(-total,0);shape.lineTo(-total,p.size[1]+.56);shape.lineTo(-run,p.size[1]+.56);
  for(let i=count-1;i>=0;i--){shape.lineTo(-i*run/count,p.size[1]*(i+1)/count+.56);if(i>0)shape.lineTo(-i*run/count,p.size[1]*i/count+.56);}
  shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:p.size[0],bevelEnabled:false,steps:1});g.rotateY(Math.PI/2);g.translate(p.position[0]-p.size[0]/2,0,p.position[2]);
  const source=g.getAttribute('position'),vertices:number[]=[];
  // The lower end cap is internal to the rear wall; keep only its exposed part.
  for(let i=0;i<source.count;i+=3)if(![p.end![2],p.position[2]].some(plane=>[i,i+1,i+2].every(j=>Math.abs(source.getZ(j)-plane)<1e-5)))for(let j=i;j<i+3;j++)vertices.push(source.getX(j),source.getY(j),source.getZ(j));
  const left=p.position[0]-p.size[0]/2,right=left+p.size[0],bottom=p.end![1],top=p.size[1]+.56,z=p.end![2];
  vertices.push(left,bottom,z,right,bottom,z,right,top,z,left,bottom,z,right,top,z,left,top,z);
  const front=p.position[2],frontTop=p.size[1]/count+.56;
  // The stone plinth already closes the front below .74; no duplicate plaster cap.
  if(frontTop>.74)vertices.push(left,.74,front,right,frontTop,front,right,.74,front,left,.74,front,left,frontTop,front,right,frontTop,front);
  const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));result.computeVertexNormals();g.dispose();return result;
 }
 if(p.role==='desert-pot'){
  const profile=[[.25,-.5],[.40,-.40],[.50,-.10],[.43,.20],[.28,.36],[.31,.47],[.25,.50],[.22,.43],[.22,.31]].map(([x,y])=>new THREE.Vector2(x*p.size[0],y*p.size[1]));
  const g=new THREE.LatheGeometry(profile,12);g.translate(...p.position);g.userData.preservePaintUV=true;return g;
 }
 if(p.role==='desert-succulent'){
  const positions:number[]=[],colors:number[]=[];
  for(let leaf=0;leaf<11;leaf++){
   const angle=leaf*2.39996,reach=p.size[0]*(.45+(leaf%3)*.12),height=p.size[1]*(.48+(leaf%4)*.17),width=p.size[0]*.14;
   const center=new THREE.Vector3(Math.cos(angle)*reach,height,Math.sin(angle)*reach),side=new THREE.Vector3(-Math.sin(angle),0,Math.cos(angle)).multiplyScalar(width);
   const base=new THREE.Vector3(),mid=center.clone().multiplyScalar(.48),ridge=mid.clone().add(new THREE.Vector3(0,.045,0)),left=mid.clone().add(side),right=mid.clone().sub(side);
   for(const tri of [[base,left,ridge],[base,ridge,right],[left,center,ridge],[right,ridge,center]])for(const vertex of tri){positions.push(vertex.x+p.position[0],vertex.y+p.position[1],vertex.z+p.position[2]);const color=new THREE.Color(leaf%3===0?'#7c873b':leaf%3===1?'#4d6533':'#98a050');colors.push(color.r,color.g,color.b);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
 }
 if(p.role==='desert-awning'||p.role==='desert-side-awning'){
  const nx=16,nz=8,positions:number[]=[],uv:number[]=[];
  const side=p.role==='desert-side-awning';
  const vertex=(u:number,v:number)=>{positions.push(p.position[0]+(u-.5)*p.size[0],p.position[1]+(side?(p.rotation?.[1]?1-u:u)*.30-.28:v*.645-.25)-.15*Math.sin(u*Math.PI)*Math.sin(v*Math.PI),p.position[2]+(v-.5)*p.size[2]);uv.push(u,v);};
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)for(const [u,v] of [[x/nx,z/nz],[(x+1)/nx,(z+1)/nz],[(x+1)/nx,z/nz],[x/nx,z/nz],[x/nx,(z+1)/nz],[(x+1)/nx,(z+1)/nz]])vertex(u,v);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();g.userData.preservePaintUV=true;return g;
 }
 return undefined;
}

export function desertDetailMaterial(p:PieceSpec,density:number,resources:StructureResources){
 if(p.role==='desert-succulent'){const m=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1});resources.materials.add(m);return m;}
 if(p.role==='desert-lamp-glass'){const m=new THREE.MeshStandardMaterial({color:'#ffcf71',emissive:'#ffa836',emissiveIntensity:.7,roughness:1});resources.materials.add(m);return m;}
 if(!['desert-pot','desert-awning','desert-side-awning','desert-rug','desert-banner'].includes(p.role))return undefined;
 const pot=p.role==='desert-pot',rug=p.role==='desert-rug',banner=p.role==='desert-banner';
 const width=Math.max(12,Math.round((pot?p.size[0]*Math.PI:p.size[0])*density)),height=Math.max(12,Math.round((rug||p.role.includes('awning')?p.size[2]:p.size[1])*density));
 const pixels=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=(x+.5)/width,v=(y+.5)/height,noise=((x*17+y*23+x*y*3)%13)/13;
  let color=pot?(noise>.8?'#b98146':'#a46a39'):(noise>.8?'#b05a3c':'#a64d35');
  if(pot){if(v>.30&&v<.52)color=Math.abs(((u*8)%1)-.5)*.38<Math.abs(v-.41)?'#ddad63':'#7c4830';if(v>.88||v<.1)color='#d2a369';}
  else if(rug||banner){const edge=Math.min(u,1-u,v,1-v),diamond=Math.abs(u-.5)*1.8+Math.abs(v-.5)*1.3;if((edge>.035&&edge<.085)||(diamond>.35&&diamond<.42)||(diamond>.65&&diamond<.72))color='#d8ae65';}
  else{const stripe=(u*6)%1;if(stripe<.11||stripe>.89)color='#d7a05c';if(stripe>.13&&stripe<.17)color='#813d2e';}
  const c=new THREE.Color(color);pixels.set([Math.round(c.r*255),Math.round(c.g*255),Math.round(c.b*255),255],(y*width+x)*4);
 }
 const texture=new THREE.DataTexture(pixels,width,height);texture.colorSpace=THREE.LinearSRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 const m=new THREE.MeshStandardMaterial({map:texture,side:THREE.DoubleSide,roughness:1});resources.textures.add(texture);resources.materials.add(m);return m;
}
