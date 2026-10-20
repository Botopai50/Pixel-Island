import type {StructurePlan,V3,WallSpec,PieceSpec} from './types';
import {Euler,Vector3} from 'three';

function wallContact(w:WallSpec,p:V3){
 const dx=w.end[0]-w.start[0],dz=w.end[2]-w.start[2],length2=dx*dx+dz*dz;
 const t=Math.max(0,Math.min(1,((p[0]-w.start[0])*dx+(p[2]-w.start[2])*dz)/length2));
 const distance=Math.hypot(p[0]-w.start[0]-dx*t,p[2]-w.start[2]-dz*t);
 let top=(w.topLeft??w.height)*(1-t)+(w.topRight??w.height)*t;
 if(w.gable)top+=w.gable.peak*(t<=w.gable.ratio?t/w.gable.ratio:(1-t)/(1-w.gable.ratio));
 return distance<=w.thickness/2+.22&&p[1]>=w.bottom-.15&&p[1]<=w.bottom+top+.15;
}

/** Foundation ownership alone cannot hold up an elevated fragment. */
export function collapseUnsupportedFraming(plan:StructurePlan,removed:Set<string>){
 const standing=plan.walls.filter(w=>!w.removed);
 const connected=new Set(standing.filter(w=>w.bottom<=.55).map(w=>w.id));
 let changed=true;
 while(changed){changed=false;for(const w of standing){
  if(connected.has(w.id))continue;
  const points:V3[]=[w.start,w.end,[(w.start[0]+w.end[0])/2,w.bottom,(w.start[2]+w.end[2])/2]].map(p=>[p[0],w.bottom,p[2]]);
  if(standing.some(s=>connected.has(s.id)&&s.bottom<w.bottom-.05&&points.some(p=>wallContact(s,p)))){connected.add(w.id);changed=true;}
 }}
 for(const w of standing)if(!connected.has(w.id)){w.removed=true;removed.add(w.id);}
 const walls=standing.filter(w=>!w.removed);
 const posts=plan.pieces.filter(p=>!p.removed&&p.role==='corner-post'&&p.end);
 for(const floor of plan.pieces.filter(p=>!p.removed&&['floor','floor-landing'].includes(p.role))){
  const volume=plan.volumes.find(v=>Math.abs(floor.position[0]-v.x)<=v.width/2+.1&&Math.abs(floor.position[2]-v.z)<=v.depth/2+.1&&floor.position[1]>=v.bottom);
  if(!volume||floor.position[1]<=volume.bottom+.2)continue;
  const corners:V3[]=[];
  for(const x of [-1,1])for(const z of [-1,1])corners.push([floor.position[0]+x*floor.size[0]/2,floor.position[1],floor.position[2]+z*floor.size[2]/2]);
  if(corners.filter(p=>walls.some(w=>wallContact(w,p))||posts.some(post=>Math.hypot(p[0]-post.position[0],p[2]-post.position[2])<.35&&post.end![1]>=p[1]-.15)).length<3){floor.removed=true;removed.add(floor.id);}
 }
 const framing=plan.pieces.filter(p=>['wall-frame','facade-brace'].includes(p.role)).sort((a,b)=>Number(a.role==='facade-brace')-Number(b.role==='facade-brace'));
 for(const piece of framing){
  if(piece.removed||!piece.end||!['wall-frame','facade-brace'].includes(piece.role))continue;
  const points=[piece.position,piece.end];
  // Ground-level rails may rest directly on the foundation.
  if(points.every(p=>p[1]<=(plan.volumes.find(v=>Math.abs(p[0]-v.x)<=v.width/2+.3&&Math.abs(p[2]-v.z)<=v.depth/2+.3)?.bottom??.25)+.2))continue;
  const supported=points.every(p=>walls.some(w=>wallContact(w,p))||posts.some(post=>{
   const low=Math.min(post.position[1],post.end![1]),high=Math.max(post.position[1],post.end![1]);
   return p[1]>=low-.15&&p[1]<=high+.15&&Math.hypot(p[0]-post.position[0],p[2]-post.position[2])<=post.size[0]/2+piece.size[0]/2+.2;
  })||(piece.role==='facade-brace'&&framing.some(rail=>{
   if(rail.role!=='wall-frame'||rail.removed||!rail.end)return false;
   const d=rail.end.map((v,i)=>v-rail.position[i]),length2=d.reduce((s,v)=>s+v*v,0);
   const t=Math.max(0,Math.min(1,d.reduce((s,v,i)=>s+v*(p[i]-rail.position[i]),0)/length2));
   return Math.hypot(...d.map((v,i)=>p[i]-rail.position[i]-v*t))<rail.size[0]/2+piece.size[0]/2+.08;
  })));
  if(!supported){piece.removed=true;removed.add(piece.id);}
 }
}

/** Trace actual contact back to the ground; ownership is not a physical support. */
export function collapseFloatingPieces(plan:StructurePlan,removed:Set<string>){
 const pieces=plan.pieces.filter(p=>!p.removed);
 const computeBounds=(p:PieceSpec)=>{
  if(p.end&&(p.kind==='beam'||p.kind==='stairs'))return {lo:p.position.map((v,i)=>Math.min(v,p.end![i])-p.size[0]/2) as V3,hi:p.position.map((v,i)=>Math.max(v,p.end![i])+p.size[0]/2) as V3};
  const corners:V3[]=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
   const v=new Vector3(x*p.size[0]/2,y*p.size[1]/2,z*p.size[2]/2);if(p.rotation)v.applyEuler(new Euler(...p.rotation));corners.push(v.toArray().map((v,i)=>v+p.position[i]) as V3);
  }
  return {lo:[0,1,2].map(i=>Math.min(...corners.map(v=>v[i]))) as V3,hi:[0,1,2].map(i=>Math.max(...corners.map(v=>v[i]))) as V3};
 };
 const boundCache=new Map(pieces.map(p=>[p.id,computeBounds(p)]));const bounds=(p:PieceSpec)=>boundCache.get(p.id)!;
 const grounded=new Set(pieces.filter(p=>bounds(p).lo[1]<=.35).map(p=>p.id));
 const contact=(point:V3,p:PieceSpec)=>{
  if(p.kind==='beam'&&p.end){
   const d=p.end.map((v,i)=>v-p.position[i]),l=d.reduce((s,v)=>s+v*v,0);
   const t=Math.max(0,Math.min(1,d.reduce((s,v,i)=>s+v*(point[i]-p.position[i]),0)/Math.max(l,.0001)));
   return Math.hypot(...d.map((v,i)=>point[i]-p.position[i]-v*t))<=p.size[0]/2+.12;
  }
  const b=bounds(p);
  return point.every((v,i)=>v>=b.lo[i]-.12&&v<=b.hi[i]+.12);
 };
 const samples=(p:PieceSpec):V3[]=>{
  if(p.end&&(p.kind==='beam'||p.kind==='stairs')){const lower=p.position[1]<p.end[1]?p.position:p.end;return Math.abs(p.end[1]-p.position[1])>Math.hypot(p.end[0]-p.position[0],p.end[2]-p.position[2])?[lower]:[p.position,p.end];}
  const b=bounds(p),y=b.lo[1];
  if(p.size[0]>.9||p.size[2]>.9||/floor|deck|gallery|walkway|observation|truss|lintel|crown|cornice|platform/.test(p.role))return [-1,1].flatMap(x=>[-1,1].map(z=>[p.position[0]+x*Math.max(0,p.size[0]/2-.16),y,p.position[2]+z*Math.max(0,p.size[2]/2-.16)] as V3));
  return [[p.position[0],y,p.position[2]]];
 };
 let changed=true;
 while(changed){changed=false;for(const p of pieces){
  if(grounded.has(p.id))continue;
  const points=samples(p),providers=new Map<string,V3[]>();
  for(const point of points){
   for(const w of plan.walls)if(!w.removed&&wallContact(w,point)){const hits=providers.get(w.id)??[];hits.push(point);providers.set(w.id,hits);}
   for(const s of pieces)if(s.id!==p.id&&grounded.has(s.id)&&contact(point,s)){const hits=providers.get(s.id)??[];hits.push(point);providers.set(s.id,hits);}
  }
  const hitPoints=points.filter(point=>[...providers.values()].some(hits=>hits.includes(point)));
  // A single narrow post must never masquerade as several supports because
  // multiple sample points happen to touch its bounding box.
  const span=points.length>1&&(/floor|deck|gallery|walkway|observation|truss|lintel|crown|cornice|platform/.test(p.role)||p.kind==='beam');
  const continuousBearing=[...providers].some(([id,hits])=>{
   const bearing=pieces.find(s=>s.id===id);
   if(bearing&&(bearing.kind==='beam'||bearing.material==='wood'))return false;
   return hits.some(a=>hits.some(b=>Math.hypot(a[0]-b[0],a[2]-b[2])>.45));
  });
  const enough=hitPoints.length>=Math.min(points.length,span?2:3)&&(!span||providers.size>=2||continuousBearing);
  // Authored masonry spans comprise several touching blocks. Their two
  // declared piers support the assembly, rather than each block separately.
  const masonryAssembly=['ancient-lintel','ancient-arch-wedge','ancient-keystone'].includes(p.role);
  const anchors=plan.supports.filter(s=>s.component===p.id);
  const anchoredAssembly=masonryAssembly&&new Set(anchors.map(s=>s.on)).size>=2&&anchors.every(s=>grounded.has(s.on));
  if(enough||anchoredAssembly){grounded.add(p.id);changed=true;}
 }}
 for(const p of pieces)if(!grounded.has(p.id)){p.removed=true;removed.add(p.id);}
 // Roof ownership by a foundation does not make the roof load-bearing.
 for(const roof of plan.roofs.filter(r=>!r.removed)){
  const providers=new Set<string>();let contacts=0;
  for(const x of [-1,1])for(const z of [-1,1]){
   const point:V3=[roof.x+x*(roof.width/2-.10),roof.y,roof.z+z*(roof.depth/2-.10)];let hit=false;
   for(const w of plan.walls)if(!w.removed&&wallContact(w,point)){providers.add(w.id);hit=true;}
   for(const p of pieces)if(grounded.has(p.id)&&contact(point,p)){providers.add(p.id);hit=true;}
   if(hit)contacts++;
  }
  if(contacts<2||providers.size<2){roof.removed=true;removed.add(roof.id);}
 }
}

/** Re-run geometric and declared supports until the entire ruin is stable. */
export function enforceRuinSupports(plan:StructurePlan,removed:Set<string>){
 const items=[...plan.walls,...plan.roofs,...plan.pieces],byId=new Map(items.map(p=>[p.id,p]));
 const dependencies=new Map<string,typeof plan.supports>();
 for(const edge of plan.supports){const links=dependencies.get(edge.component)??[];links.push(edge);dependencies.set(edge.component,links);}
 let previous=-1;
 while(previous!==removed.size){
  previous=removed.size;
  for(const [id,links] of dependencies){
   const item=byId.get(id);if(!item||item.removed)continue;
   const surviving=new Set(links.filter(s=>s.on==='ground'||byId.has(s.on)&&!removed.has(s.on)&&!byId.get(s.on)!.removed).map(s=>s.on)).size;
   if(surviving<(links[0].minimum??new Set(links.map(s=>s.on)).size)){item.removed=true;removed.add(id);}
  }
  collapseUnsupportedFraming(plan,removed);
  collapseFloatingPieces(plan,removed);
 }
}
