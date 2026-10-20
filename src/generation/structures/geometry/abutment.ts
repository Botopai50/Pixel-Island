import * as THREE from 'three';
import type {RoofSurface} from '../types';

/** Trim roof skins and framing at the host wall, including interpolated texture attributes. */
export function trimAtWall(source:THREE.BufferGeometry,plane:NonNullable<RoofSurface['abutment']>){
 const g=source.index?source.toNonIndexed():source;
 const attributes=Object.entries(g.attributes),output=new Map(attributes.map(([name])=>[name,[] as number[]]));
 const count=g.getAttribute('position').count;
 type Vertex=Record<string,number[]>;
 const distance=(v:Vertex)=>plane.keep*(v.position[plane.axis]-plane.value);
 for(let i=0;i<count;i+=3){
  let polygon:Vertex[]=Array.from({length:3},(_,j)=>Object.fromEntries(attributes.map(([name,a])=>[name,Array.from({length:a.itemSize},(_,k)=>a.array[(i+j)*a.itemSize+k])])));
  const clipped:Vertex[]=[];
  for(let j=0;j<polygon.length;j++){
   const a=polygon[j],b=polygon[(j+1)%polygon.length],da=distance(a),db=distance(b);
   if(da>=0)clipped.push(a);
   if((da>=0)!==(db>=0)){
    const t=da/(da-db);clipped.push(Object.fromEntries(attributes.map(([name])=>[name,a[name].map((n,k)=>n+(b[name][k]-n)*t)])));
   }
  }
  polygon=clipped;
  for(let j=1;j<polygon.length-1;j++)for(const vertex of [polygon[0],polygon[j],polygon[j+1]])for(const [name] of attributes)output.get(name)!.push(...vertex[name]);
 }
 const result=new THREE.BufferGeometry();
 for(const [name,a] of attributes)result.setAttribute(name,new THREE.Float32BufferAttribute(output.get(name)!,a.itemSize));
 g.dispose();if(g!==source)source.dispose();return result;
}
