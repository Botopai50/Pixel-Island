import type {StructurePlan,WallSpec,OpeningSpec} from './types';
/** Partition shared boundary walls before triangulation; no hidden duplicate wall skins. */
export function resolveConnections(plan:StructurePlan){const walls:WallSpec[]=[],openings:OpeningSpec[]=[];const parents=new Map(plan.supports.map(s=>[s.component,s.on]));const oldWalls=new Set(plan.walls.map(w=>w.id));
 for(const w of plan.walls){const dx=w.end[0]-w.start[0],dz=w.end[2]-w.start[2],L=Math.hypot(dx,dz),ux=dx/L,uz=dz/L;const neighbors=plan.volumes.filter(v=>v.id!==w.volume&&((Math.abs(dx)>Math.abs(dz)&&Math.abs(Math.abs(w.start[2]-v.z)-v.depth/2)<1e-5)||(Math.abs(dz)>Math.abs(dx)&&Math.abs(Math.abs(w.start[0]-v.x)-v.width/2)<1e-5)));if(!neighbors.length){walls.push(w);openings.push(...plan.openings.filter(o=>o.wall===w.id));continue;}
 const project=(x:number,z:number)=>(x-w.start[0])*ux+(z-w.start[2])*uz;
 const intervals=neighbors.map(v=>{const ends=[project(v.x-v.width/2,v.z-v.depth/2),project(v.x+v.width/2,v.z+v.depth/2)].sort((a,b)=>a-b);return {lo:Math.max(0,ends[0]),hi:Math.min(L,ends[1]),bottom:Math.max(0,v.bottom-w.bottom),top:Math.min(w.height,v.bottom+v.height-w.bottom)};}).filter(i=>i.hi>i.lo&&i.top>i.bottom);
 if(!intervals.length){walls.push(w);openings.push(...plan.openings.filter(o=>o.wall===w.id));continue;}
 const xs=[...new Set([0,L,...intervals.flatMap(i=>[i.lo,i.hi]),...(w.gable?[L*w.gable.ratio]:[])])].sort((a,b)=>a-b),ys=[...new Set([0,w.height,...intervals.flatMap(i=>[i.bottom,i.top])])].sort((a,b)=>a-b);
 for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){const lo=xs[i],hi=xs[i+1],b=ys[j],t=ys[j+1],mx=(lo+hi)/2,my=(b+t)/2;if(intervals.some(r=>mx>r.lo-1e-6&&mx<r.hi+1e-6&&my>r.bottom-1e-6&&my<r.top+1e-6))continue;
 const id=w.id+'_section_'+i+'_'+j;const cell:WallSpec={...w,id,start:[w.start[0]+ux*lo,w.bottom+b,w.start[2]+uz*lo],end:[w.start[0]+ux*hi,w.bottom+b,w.start[2]+uz*hi],bottom:w.bottom+b,height:t-b,gable:undefined,topLeft:undefined,topRight:undefined};
 if(t===w.height){const profile=(x:number)=>{const u=x/L;let height=(w.topLeft??w.height)*(1-u)+(w.topRight??w.height)*u;if(w.gable){const at=w.gable.ratio;height+=w.gable.peak*(u<at?u/at:(1-u)/(1-at));}return height-b;};cell.topLeft=profile(lo);cell.topRight=profile(hi);}
 walls.push(cell);parents.set(id,parents.get(w.id)!);
 for(const o of plan.openings.filter(o=>o.wall===w.id)){const center=o.offset+L/2;if(center-o.width/2>=lo+.101&&center+o.width/2<=hi-.101&&o.bottom>=b&&o.bottom+o.height<=t)openings.push({...o,id:o.id+'_section',wall:id,offset:center-(lo+hi)/2,bottom:o.bottom-b});}
 }
 }
 plan.supports=plan.supports.filter(s=>!oldWalls.has(s.component));walls.forEach(w=>plan.supports.push({component:w.id,on:parents.get(w.id)!}));plan.walls=walls;plan.openings=openings;
 // Collinear framing members on shared edges become a single physical piece.
 const removed=new Set<string>();for(let i=0;i<plan.pieces.length;i++){const a=plan.pieces[i];if(a.kind!=='beam'||removed.has(a.id))continue;const ae=a.end!,axis=a.position.findIndex((x,k)=>Math.abs(x-ae[k])>1e-5);if(axis<0||a.position.some((x,k)=>k!==axis&&Math.abs(x-ae[k])>1e-5))continue;for(let j=i+1;j<plan.pieces.length;j++){const b=plan.pieces[j];if(b.kind!=='beam'||removed.has(b.id)||b.material!==a.material||b.size[0]!==a.size[0]||!b.end)continue;if(a.position.some((x,k)=>k!==axis&&(Math.abs(x-b.position[k])>1e-5||Math.abs(x-b.end![k])>1e-5)))continue;const [al,ah]=[a.position[axis],a.end![axis]].sort((x,y)=>x-y),[bl,bh]=[b.position[axis],b.end[axis]].sort((x,y)=>x-y);if(bl>ah+1e-5||al>bh+1e-5)continue;a.position[axis]=Math.min(al,bl);a.end![axis]=Math.max(ah,bh);removed.add(b.id);}}
 plan.pieces=plan.pieces.filter(p=>!removed.has(p.id));plan.supports=plan.supports.filter(s=>!removed.has(s.component));plan.joints=plan.joints.map(j=>({...j,members:j.members.filter(id=>!removed.has(id))})).filter(j=>j.members.length);return plan;
}
