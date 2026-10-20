import {Architect} from '../blueprint';import type {GrammarContext,VolumeSpec} from '../types';
function connectedHouse(a:Architect){
 const main=a.plan.volumes[0];
 for(const roof of a.plan.roofs){
  const v=a.plan.volumes.find(volume=>volume.id===roof.volume)!;
  if(v===main||!['annex','wing','entrance'].includes(v.role))continue;
  const axis=Math.abs(v.x-main.x)>(main.width+v.width)/2-.01?0:2;
  const side=Math.sign(axis===0?v.x-main.x:v.z-main.z) as 1|-1;
  const value=(axis===0?main.x:main.z)+side*(axis===0?main.width:main.depth)/2;
  roof.abutment={axis,value:value+side*.025,keep:side};
  if(a.context.config.roof!=='auto')continue;
  // Preserve the chosen silhouette unless its ridge crowds the host eaves.
  const clearance=main.bottom+main.height-roof.y;
  if(roof.kind==='flat'||roof.y+roof.rise+.65<main.bottom+main.height)continue;
  roof.kind='shed';roof.shedAxis=axis;roof.shedDirection=side>0?-1:1;
  const run=axis===0?v.width:v.depth;
  roof.rise=Math.max(.12,Math.min(run*(.18+a.context.config.roofPitch*.16),clearance-.32));
  const top=(position:number)=>v.height+roof.rise*(.5+roof.shedDirection!*(position-(axis===0?v.x:v.z))/run);
  for(const wall of a.plan.walls.filter(w=>w.volume===v.id)){
   delete wall.gable;wall.height=v.height;wall.topLeft=top(wall.start[axis]);wall.topRight=top(wall.end[axis]);
   if(Math.abs(wall.start[axis]-value)<.01&&Math.abs(wall.end[axis]-value)<.01)wall.removed=true;
  }
  const foundation=a.plan.supports.find(s=>s.component===roof.id)?.on;
  for(const piece of a.plan.pieces)if(piece.role==='corner-post'&&piece.support===foundation&&piece.end)piece.end[1]=v.bottom+top(piece.position[axis]);
 }
 return a.finish();
}
export function projectTimber(a:Architect,v:VolumeSpec=a.plan.volumes[0]){
 const foundation=a.plan.supports.find(s=>s.component===v.id+'_roof')?.on;
 for(const p of a.plan.pieces){
  if(p.id!==foundation&&p.support!==foundation)continue;
  if(p.role==='foundation'){p.size[0]=v.width+.70;p.size[2]=v.depth+.70;}
  if(!p.end)continue;
  if(p.role==='corner-post'){
   for(const axis of [0,2] as const){const center=axis===0?v.x:v.z,shift=Math.sign(p.position[axis]-center)*.10;p.position[axis]+=shift;p.end[axis]+=shift;}
   p.size=[.34,.34,.34];
  }else if(p.role==='wall-frame'||p.role==='facade-brace'){
   const axis=Math.abs(p.position[0]-p.end[0])>Math.abs(p.position[2]-p.end[2])?2:0;
   const center=axis===0?v.x:v.z,shift=Math.sign(p.position[axis]-center)*(p.role==='wall-frame'?.13:.10);
   p.position[axis]+=shift;p.end[axis]+=shift;
   if(p.role==='wall-frame'){
    const along=axis===0?2:0,sign=Math.sign(p.end[along]-p.position[along]);p.position[along]-=sign*.07;p.end[along]+=sign*.07;p.size=[.32,.32,.32];
   }else p.size=[.24,.24,.24];
  }
 }
 // Endpoints changed, so discard stale joint coordinates before rebuilding them.
 a.plan.joints=[];
 for(const p of a.plan.pieces.filter(p=>p.end))for(const point of [p.position,p.end!]){
  const id=point.map(n=>n.toFixed(4)).join(':');let joint=a.plan.joints.find(j=>j.id===id);
  if(!joint){joint={id,point:[...point],members:[]};a.plan.joints.push(joint);}joint.members.push(p.id);
 }
}
export function house(c:GrammarContext){const a=new Architect(c),p=c.config,w=a.value(p.width),d=a.value(p.depth),h=a.value(p.height,.12);const v=a.building(0,0,w,d,h,p.floors);if(p.annexes&&a.rnd()>.48){const aw=w*(.35+a.rnd()*.2),ad=d*(.5+a.rnd()*.18);a.building(w/2+aw/2, d*.1,aw,ad,h*.76,1,{door:false,role:'annex'});}if(p.balconies&&a.rnd()>.32)a.veranda(v);if(a.rnd()>.3)a.chimney(v);return connectedHouse(a);}
export function largeHouse(c:GrammarContext){const a=new Architect(c),p=c.config,w=a.value(p.width*.7),d=a.value(p.depth),h=a.value(p.height,.13);const v=a.building(-p.width*.12,0,w,d,h,Math.max(2,p.floors));const aw=a.value(w*.55),ad=a.value(d*.62);a.building(v.x+w/2+aw/2,d*.15,aw,ad,h*(.5+a.rnd()*.25),1,{door:false,role:'wing'});let entrance=v;if(p.annexes&&a.rnd()>.4)entrance=a.building(v.x,-d/2-ad/2,w*.62,ad,h*.55,1,{role:'entrance'});if(p.balconies)a.veranda(entrance);a.chimney(v);return connectedHouse(a);}
export function cabin(c:GrammarContext){const a=new Architect(c),p=c.config;const v=a.building(0,0,a.value(p.width),a.value(p.depth),a.value(p.height),1,{material:'wood',roof:p.roof==='auto'?'thatch':p.roof});projectTimber(a);a.veranda(v);a.chimney(v);return connectedHouse(a);}
export function mansion(c:GrammarContext){const a=new Architect(c),p=c.config,w=a.value(p.width*.48),d=a.value(p.depth*.72),h=a.value(p.height,.1);const v=a.building(0,0,w,d,h,Math.max(2,p.floors),{roof:p.roof});for(const side of [-1,1]){const ww=a.value(w*.6),dd=a.value(d*.88);a.building(side*(w+ww)/2,.3,ww,dd,h*(.70+a.rnd()*.16),2,{door:false,roof:p.roof,role:'wing'});}a.veranda(v);a.chimney(v);return connectedHouse(a);}

export function abandonedHouse(c:GrammarContext){const p=house(c);p.openings.forEach(o=>o.broken=true);return p;}
export function ruinedHouse(c:GrammarContext){return house(c);}
