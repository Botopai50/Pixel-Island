import * as THREE from 'three';

/** A tapered leaf blade with a raised midrib, folded sides and painted veins. */
export function createIvyLeafSurface(size=12){
 const pixels=new Uint8Array(size*size*4),greens=[[36,61,32],[48,80,38],[66,103,45],[88,129,53],[117,151,65]];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=(x+.5)/size,v=(y+.5)/size,side=u-.5;
  const branch=Math.abs(((v-Math.abs(side)*.65)*4)%1-.5)<.08&&Math.abs(side)>.09;
  let tone=side<-.06?3:2;
  if(v>.55&&side<-.06)tone=4;
  if(x===Math.floor(size/2)&&v>.12&&v<.85)tone=4;
  else if(branch)tone=Math.min(4,tone+1);
  if(u<.15||u>.85)tone=Math.max(1,tone-1);
  pixels.set([...greens[tone],255],(y*size+x)*4);
 }
 const texture=new THREE.DataTexture(pixels,size,size);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 // The silhouette itself follows the texel grid, including the tapered tip.
 const points:number[]=[],uvs:number[]=[],indices:number[]=[],vertices=new Map<string,number>();
 const vertex=(x:number,y:number)=>{
  const key=x+':'+y,existing=vertices.get(key);if(existing!==undefined)return existing;
  const u=x/size,v=y/size,xx=u-.5,width=Math.max(.02,.30*Math.pow(Math.sin(v*Math.PI),.85)),ridge=.13*Math.sin(v*Math.PI);
  const z=ridge-.09*Math.min(1,Math.abs(xx)/width)*Math.sin(v*Math.PI),index=points.length/3;
  points.push(xx,v,z);uvs.push(u,v);vertices.set(key,index);return index;
 };
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const v=(y+.5)/size,xx=(x+.5)/size-.5,width=Math.max(.015,.30*Math.pow(Math.sin(v*Math.PI),.85));
  if(Math.abs(xx)>width)continue;
  const a=vertex(x,y),b=vertex(x+1,y),c=vertex(x,y+1),d=vertex(x+1,y+1);indices.push(a,b,d,a,d,c);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.userData.pixelGrid=size;
 const material=new THREE.MeshStandardMaterial({map:texture,side:THREE.DoubleSide,roughness:1,fog:true});
 return {geometry,material,texture};
}
