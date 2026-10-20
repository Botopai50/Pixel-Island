import {buildThatchRoof} from './thatch';
import * as THREE from 'three';
import type {RoofSurface,V3} from '../types';
import {merge,extrudePolygon} from './common';
import {paintUV} from './paintUV';

/** Closed slab for a triangle or quad; collapsed ridge points are removed. */
const edgeKey=(a:V3,b:V3)=>[a.map(v=>v.toFixed(5)).join(','),b.map(v=>v.toFixed(5)).join(',')].sort().join('|');
function slab(points:V3[],exposed?:Set<string>,lift?:number) {
 const unique=points.filter((p,i)=>i===0||new THREE.Vector3(...p).distanceToSquared(new THREE.Vector3(...points[i-1]))>1e-10);
 if(unique.length>2&&new THREE.Vector3(...unique[0]).distanceToSquared(new THREE.Vector3(...unique.at(-1)!))<1e-10)unique.pop();
 const vectors=unique.map(p=>new THREE.Vector3(...p));
 let normal=vectors[1].clone().sub(vectors[0]).cross(vectors[2].clone().sub(vectors[0])).normalize();
 if(normal.y<0){unique.reverse();vectors.reverse();normal.negate();}
 const n=unique.length,vertices=[...vectors,...vectors.map(p=>lift===undefined?p.clone().addScaledVector(normal,.12):p.clone().add(new THREE.Vector3(0,lift,0)))],positions:number[]=[];
 const tri=(i:number,j:number,k:number)=>{const a=vertices[i],b=vertices[j],c=vertices[k];if(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()>1e-16)positions.push(...a.toArray(),...b.toArray(),...c.toArray());};
 for(let i=1;i<n-1;i++){tri(0,i+1,i);tri(n,n+i,n+i+1);}
 for(let i=0;i<n;i++){const next=(i+1)%n;if(exposed&&!exposed.has(edgeKey(unique[i],unique[next])))continue;tri(i,next,n+next);tri(i,n+next,n+i);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(Array(positions.length/3*2).fill(0),2));g.computeVertexNormals();return g;
}
function brokenFacet(points:V3[],damage:number,id:string,lift?:number) {
 if(damage<=.08)return slab(points,undefined,lift);
 const triangles=points.length===3?[points]:[[points[0],points[1],points[2]],[points[0],points[2],points[3]]];
 const kept:V3[][]=[];let phase=0;for(const letter of id)phase+=letter.charCodeAt(0)*.07;
 const cuts=5;
 for(const triangle of triangles){const [a,b,c]=triangle.map(p=>new THREE.Vector3(...p));
  const point=(i:number,j:number)=>a.clone().addScaledVector(b.clone().sub(a),i/cuts).addScaledVector(c.clone().sub(a),j/cuts).toArray() as V3;
  const emit=(t:V3[])=>{const center=new THREE.Vector3();t.forEach(p=>center.add(new THREE.Vector3(...p)));center.divideScalar(3);const field=(Math.sin(center.x*1.2+phase)+Math.cos(center.z*.9-phase)+2)/4;if(field>damage*.95)kept.push(t);};
  for(let i=0;i<cuts;i++)for(let j=0;j<cuts-i;j++){emit([point(i,j),point(i+1,j),point(i,j+1)]);if(j<cuts-i-1)emit([point(i+1,j),point(i+1,j+1),point(i,j+1)]);}
 }
 const counts=new Map<string,number>();for(const t of kept)for(let i=0;i<3;i++){const key=edgeKey(t[i],t[(i+1)%3]);counts.set(key,(counts.get(key)??0)+1);}
 const exposed=new Set([...counts].filter(([,count])=>count===1).map(([key])=>key));
 return kept.length?merge(kept.map(t=>slab(t,exposed,lift))):new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([],3));
}
export function buildRoof(r:RoofSurface):THREE.BufferGeometry {
 if(r.rotationY){const g=buildRoof({...r,rotationY:undefined});g.translate(-r.x,0,-r.z);g.rotateY(r.rotationY);g.translate(r.x,0,r.z);return g;}
 if(r.kind==='flat'&&r.accessHole&&(r.damage??0)<=.08){
  const h=r.accessHole,shape=new THREE.Shape(),hole=new THREE.Path();
  const rectangle=(path:THREE.Path,x:number,z:number,w:number,d:number)=>{path.moveTo(x-w/2,z-d/2);path.lineTo(x+w/2,z-d/2);path.lineTo(x+w/2,z+d/2);path.lineTo(x-w/2,z+d/2);path.closePath();};
  rectangle(shape,r.x,r.z,r.width+2*r.eaves,r.depth+2*r.eaves);rectangle(hole,h.x,h.z,h.width,h.depth);shape.holes.push(hole);
  const g=new THREE.ExtrudeGeometry(shape,{depth:r.flatThickness??.12,bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);g.translate(0,r.y+(r.flatThickness??.12),0);return paintUV(g);
 }
 if(r.kind==='thatch'&&(r.damage??0)<=.08)return paintUV(buildThatchRoof(r));
 const {x,z,y,rise,eaves:e}=r,w=r.width/2,d=r.depth/2,left=x-w-e,right=x+w+e,front=z-d-e,back=z+d+e;
 let facets:V3[][];
 if(r.kind==='flat')facets=[[[left,y,front],[right,y,front],[right,y,back],[left,y,back]]];
 else if(r.kind==='shed'){const direction=r.shedDirection??1,axis=r.shedAxis??0;const height=(px:number,pz:number)=>y+rise*(.5+direction*(axis===0?(px-x)/(2*w):(pz-z)/(2*d)));facets=[[[left,height(left,front),front],[right,height(right,front),front],[right,height(right,back),back],[left,height(left,back),back]]];}
 else if(r.kind==='hip'){
 const hipLow=y-rise*e/Math.min(w,d);
 if(d>=w){const rf=z-(d-w),rb=z+(d-w);facets=[[[left,hipLow,front],[x,y+rise,rf],[x,y+rise,rb],[left,hipLow,back]],[[x,y+rise,rf],[right,hipLow,front],[right,hipLow,back],[x,y+rise,rb]],[[left,hipLow,front],[right,hipLow,front],[x,y+rise,rf]],[[right,hipLow,back],[left,hipLow,back],[x,y+rise,rb]]];}
 else {const rl=x-(w-d),rr=x+(w-d);facets=[[[left,hipLow,front],[right,hipLow,front],[rr,y+rise,z],[rl,y+rise,z]],[[right,hipLow,back],[left,hipLow,back],[rl,y+rise,z],[rr,y+rise,z]],[[left,hipLow,back],[left,hipLow,front],[rl,y+rise,z]],[[right,hipLow,front],[right,hipLow,back],[rr,y+rise,z]]];}
 facets=facets.map(points=>points.filter((p,i)=>!points.slice(0,i).some(other=>p.every((v,j)=>v===other[j]))));
 }else {const ratio=r.ridgeRatio??.5,ridge=x-w+r.width*ratio,leftY=y-rise*e/(r.width*ratio),rightY=y-rise*e/(r.width*(1-ratio));facets=[[[left,leftY,front],[ridge,y+rise,front],[ridge,y+rise,back],[left,leftY,back]],[[ridge,y+rise,front],[right,rightY,front],[right,rightY,back],[ridge,y+rise,back]]];}
 return paintUV(merge(facets.map((points,i)=>brokenFacet(points,r.damage??0,r.id+'_'+i,r.kind==='hip'?.12*Math.sqrt(1+(rise/Math.min(w,d))**2):r.kind==='flat'?r.flatThickness:undefined))));
}

/** A pitched ridge cover closes the two roof skins without a square projecting nose. */
export function buildRidgeCap(r:RoofSurface){
 const ratio=r.ridgeRatio??.5,x=r.x-r.width/2+r.width*ratio,y=r.y+r.rise;
 if(r.kind==='thatch'){
  const left=r.rise/(r.width*ratio),right=r.rise/(r.width*(1-ratio));
  const half=.27,peak=.415*Math.sqrt(1+Math.max(left,right)**2)+.025;
  const g=extrudePolygon([
   [x-half,y+.25-half*left],[x+half,y+.25-half*right],
   [x+half,y+peak-half*right-.025],[x+.135,y+peak-.135*right],
   [x,y+peak],[x-.135,y+peak-.135*left],[x-half,y+peak-half*left-.025],
  ],r.depth+2*r.eaves+.02);
  g.translate(0,0,r.z);return g;
 }
 const half=.18,leftSlope=r.rise/(r.width*ratio),rightSlope=r.rise/(r.width*(1-ratio));
 const bottom=.08,top=.17;
 const g=extrudePolygon([
  [x-half,y+bottom-half*leftSlope],[x,y+bottom],[x+half,y+bottom-half*rightSlope],
  [x+half,y+top-half*rightSlope],[x,y+top],[x-half,y+top-half*leftSlope],
 ],r.depth+2*r.eaves-.13);
 g.translate(0,0,r.z);return g;
}

/** The eave profile matches the sloping fascia exactly at its inner end face. */
export function buildEaveFascia(r:RoofSurface,left:boolean){
 const ratio=r.ridgeRatio??.5,slope=r.rise/(r.width*(left?ratio:1-ratio));
 const x=r.x+(left?-1:1)*(r.width/2+r.eaves),y=r.y-slope*r.eaves;
 const height=.24*Math.sqrt(1+slope*slope),signedSlope=left?slope:-slope;
 const top=(dx:number)=>y+.17+signedSlope*dx;
 const g=extrudePolygon([
  [x-.12,top(-.12)-height],[x+.12,top(.12)-height],
  [x+.12,top(.12)],[x-.12,top(-.12)],
 ],r.depth+2*r.eaves-.13);
 g.translate(0,0,r.z);return g;
}

/** Folded cover follows both roof planes along a hip or the short ridge. */
export function buildHipCover(r:RoofSurface,start:V3,end:V3){
 const slope=r.rise/Math.min(r.width/2,r.depth/2),lift=.12*Math.sqrt(1+slope*slope);
 const axis=new THREE.Vector3(end[0]-start[0],0,end[2]-start[2]).normalize();
 const across=new THREE.Vector3(axis.z,0,-axis.x);
 const halfX=Math.max(0,(r.width-r.depth)/2),halfZ=Math.max(0,(r.depth-r.width)/2);
 const surface=(x:number,z:number)=>r.y+r.rise-slope*Math.max(Math.abs(x-r.x)-halfX,Math.abs(z-r.z)-halfZ,0)+lift;
 const hip=start[1]<end[1];
 const section=(p:V3,atEave=false)=>[-.12,0,.12,.12,0,-.12].map((offset,i)=>{
  // V-shaped end seats against the two mitred fascia inner faces.
  const advance=atEave?.12/Math.min(Math.abs(axis.x),Math.abs(axis.z))+Math.abs(offset):0;
  const x=p[0]+across.x*offset+axis.x*advance,z=p[2]+across.z*offset+axis.z*advance;
  return new THREE.Vector3(x,surface(x,z)+(i<3?.012:.07),z);
 });
 const vertices=[...section(start,hip),...section(end)],positions:number[]=[];
 const triangle=(a:number,b:number,c:number)=>positions.push(...vertices[a].toArray(),...vertices[b].toArray(),...vertices[c].toArray());
 for(let i=0;i<6;i++){const j=(i+1)%6;triangle(i,j,j+6);triangle(i,j+6,i+6);}
 for(let i=1;i<5;i++){triangle(0,i+1,i);triangle(6,6+i,7+i);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));g.computeVertexNormals();return g;
}

/** Mitred fascia corners share the hip cover's pitched upper surface. */
export function buildHipFascia(r:RoofSurface,side:'front'|'back'|'left'|'right'){
 const x0=r.x-r.width/2-r.eaves,x1=r.x+r.width/2+r.eaves;
 const z0=r.z-r.depth/2-r.eaves,z1=r.z+r.depth/2+r.eaves,t=.12;
 const slope=r.rise/Math.min(r.width/2,r.depth/2),lift=.12*Math.sqrt(1+slope*slope);
 const halfX=Math.max(0,(r.width-r.depth)/2),halfZ=Math.max(0,(r.depth-r.width)/2);
 const top=(x:number,z:number)=>r.y+r.rise-slope*Math.max(Math.abs(x-r.x)-halfX,Math.abs(z-r.z)-halfZ,0)+lift+.07;
 const outlines:Record<typeof side,[number,number][]>={
  front:[[x0-t,z0-t],[x1+t,z0-t],[x1-t,z0+t],[x0+t,z0+t]],
  back:[[x1+t,z1+t],[x0-t,z1+t],[x0+t,z1-t],[x1-t,z1-t]],
  left:[[x0-t,z1+t],[x0-t,z0-t],[x0+t,z0+t],[x0+t,z1-t]],
  right:[[x1+t,z0-t],[x1+t,z1+t],[x1-t,z1-t],[x1-t,z0+t]],
 };
 const vertices=[...outlines[side].map(([x,z])=>new THREE.Vector3(x,top(x,z),z)),
  ...outlines[side].map(([x,z])=>new THREE.Vector3(x,top(x,z)-.24,z))];
 const positions:number[]=[];
 const tri=(a:number,b:number,c:number)=>positions.push(...vertices[a].toArray(),...vertices[b].toArray(),...vertices[c].toArray());
 tri(0,2,1);tri(0,3,2);tri(4,5,6);tri(4,6,7);
 for(let i=0;i<4;i++){const j=(i+1)%4;tri(i,j,j+4);tri(i,j+4,i+4);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));g.computeVertexNormals();return g;
}

