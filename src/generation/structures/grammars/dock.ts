import {Architect} from '../blueprint';
import type {GrammarContext} from '../types';

/** Broad quay with two narrow fingers, mooring posts and a masonry shore stair. */
export function dock(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.035),d=a.value(p.depth,.035),y=a.value(p.height*.52,.025);
 const mainDepth=d*.32,fingerWidth=Math.min(w*.22,mainDepth*.90),junction=-w*.27;
 const piers=new Map<string,string>();
 const pier=(x:number,z:number)=>{
  const key=x.toFixed(4)+':'+z.toFixed(4);if(piers.has(key))return piers.get(key)!;
  const id=a.piece('box',[x,(y+.66)/2,z],[.43,y+.66,.43],'wood','dock-mooring-post');piers.set(key,id);
  a.piece('box',[x,y+.66,z],[.46,.12,.46],'wood','dock-post-cap',id);
  a.piece('box',[x,y+.04,z],[.52,.24,.52],'metal','dock-post-collar',id);
  for(let i=0;i<3;i++)a.piece('box',[x,y+.36+i*.075,z],[.58,.075,.58],'thatch','bridge-rope-wrap',id);
  for(const side of [-1,1]){
   a.piece('box',[x+side*.275,y+.04,z],[.045,.095,.095],'metal','dock-collar-rivet',id);
   a.piece('box',[x,y+.04,z+side*.275],[.095,.095,.045],'metal','dock-collar-rivet',id);
  }
  return id;
 };
 const mainLeft=junction-fingerWidth/2;
 const sections=[{x:(mainLeft+w/2)/2,z:0,width:w/2-mainLeft,depth:mainDepth,role:'dock-main-platform'},{x:junction,z:-(mainDepth+d)/4,width:fingerWidth,depth:(d-mainDepth)/2,role:'dock-finger'},{x:junction,z:(mainDepth+d)/4,width:fingerWidth,depth:(d-mainDepth)/2,role:'dock-finger'}];
 for(const s of sections){
  const floor=a.piece('box',[s.x,y-.17,s.z],[s.width,.10,s.depth],'wood',s.role);
  const alongX=s.role==='dock-main-platform',length=alongX?s.width:s.depth,bays=Math.max(1,Math.ceil(length/3));
  const supports:string[]=[];
  const stations=alongX?[mainLeft,junction+fingerWidth/2,(junction+fingerWidth/2+w/2)/2,w/2].map(x=>x-s.x):Array.from({length:bays+1},(_,i)=>-length/2+i*length/bays);
  for(const t of stations)for(const side of [-1,1]){
   const x=alongX?s.x+t:s.x+side*s.width/2,z=alongX?s.z+side*s.depth/2:s.z+t;
   const post=pier(x,z);supports.push(post);
   for(const dir of [-1,1]){
    const reach=Math.min(.90,length/bays*.36),end=t+dir*reach;if(end<=-length/2||end>=length/2)continue;
    a.beam([alongX?x+dir*.215:x,y*.38,alongX?z:z+dir*.215],[alongX?x+dir*reach:x,y-.19,alongX?z:z+dir*reach],.22,'wood','dock-pier-brace',post,{start:alongX?[1,0,0]:[0,0,1],end:[0,1,0]});
   }
  }
  a.depend(floor,supports,2);
  // Narrow board rows and staggered seams give every part the same timber scale.
  const rows=Math.max(3,Math.ceil(s.depth/.28)),rowDepth=s.depth/rows;
  for(let row=0;row<rows;row++){
   const segments=Math.max(1,Math.ceil(s.width/3.2)),offset=row%2?.32:-.32;
   const seams=[s.x-s.width/2,...Array.from({length:segments-1},(_,i)=>s.x-s.width/2+(i+1)*s.width/segments+offset),s.x+s.width/2];
   for(let i=0;i<seams.length-1;i++){
    const xx=(seams[i]+seams[i+1])/2,zz=s.z-s.depth/2+(row+.5)*rowDepth;
    const board=a.piece('box',[xx,y-.07,zz],[seams[i+1]-seams[i]-.014,.14,rowDepth-.014],'wood','deck-plank',floor);
    for(const x of [seams[i]+.07,seams[i+1]-.07])a.piece('box',[x,y+.012,zz],[.027,.023,.027],'metal','dock-plank-nail',board);
   }
  }
  for(const side of [-1,1]){
   const from: [number,number,number]=alongX?[s.x-s.width/2,y-.07,s.z+side*s.depth/2]:[s.x+side*s.width/2,y-.07,s.z-s.depth/2];
   const to: [number,number,number]=alongX?[s.x+s.width/2,y-.07,s.z+side*s.depth/2]:[s.x+side*s.width/2,y-.07,s.z+s.depth/2];
   if(alongX){
    a.beam([junction+fingerWidth/2,y-.07,to[2]],to,.24,'wood','dock-edge-girder',floor);
   }else a.beam(from,to,.24,'wood','dock-edge-girder',floor);
   for(let i=0;i<bays;i++){
    const t=-length/2+(i+.5)*length/bays;
    a.piece('box',[alongX?s.x+t:s.x+side*s.width/2,y+.067,alongX?s.z+side*s.depth/2:s.z+t],alongX?[.14,.035,.26]:[.26,.035,.14],'metal','dock-girder-strap',floor);
   }
  }
 }
 const run=Math.max(1.7,y*1.2),steps=Math.ceil(y/.30),landing=w/2;
 a.plan.accesses.push({id:'dock-shore-stairs',from:[landing+run,0,0],to:[landing,y,0],width:mainDepth,role:'stairs'});
 for(let i=0;i<steps;i++){
  const height=y*(1-i/steps),x=landing+(i+.5)*run/steps;
  a.piece('box',[x,height/2,0],[run/steps,height,mainDepth+.18],'stone','dock-stone-step');
 }
 a.plan.propZones.push({id:'dock-water',x:-run/2-.3,z:0,width:w+run+2.4,depth:d+3,y:0,kind:'water'});
 for(const side of [-1,1])a.plan.propZones.push({id:'dock-shore-'+side,x:landing+run+.7,z:side*(mainDepth/2+.5),width:1.3,depth:1,y:0,kind:'garden'});
 return a.finish();
}
