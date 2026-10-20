import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function watchtower(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.06),d=a.value(p.depth,.06),h=a.value(p.height,.06);
 const base=.24,deckY=base+h*.72,deckTop=deckY+.12,px=w*.36,pz=d*.36,postWidth=.38;
 const foundation=a.piece('box',[0,.12,0],[w+.65,.24,d+.65],'stone','foundation');
 const columns:string[]=[];
 const metalJoint=(x:number,y:number,z:number,parent:string,columnWidth=postWidth)=>{
  for(const side of [-1,1]){
   a.piece('box',[x+side*(columnWidth/2+.027),y,z],[.055,.25,columnWidth+.08],'metal','tower-joint-plate',parent);
   a.piece('box',[x,y,z+side*(columnWidth/2+.027)],[columnWidth+.08,.25,.055],'metal','tower-joint-plate',parent);
   for(const u of [-.12,.12])a.piece('box',[x+u,y,z+side*(columnWidth/2+.063)],[.065,.065,.035],'metal','tower-joint-bolt',parent);
  }
 };
 for(const x of [-px,px])for(const z of [-pz,pz]){
  const post=a.beam([x,base,z],[x,deckTop,z],postWidth,'wood','tower-post',foundation);columns.push(post);
  for(const y of [base+.18,base+(deckY-base)*.5,deckY-.25])metalJoint(x,y,z,post);
 }
 // Two levels of crossed braces meet the columns; the ladder stays outside this frame.
 const corners:V3[]=[[-px,0,-pz],[px,0,-pz],[px,0,pz],[-px,0,pz]];
 for(let side=0;side<4;side++){
  const start=corners[side],end=corners[(side+1)%4];
  for(let level=0;level<2;level++){
   const low=base+.26+level*(deckY-base-.55)/2,high=base+.26+(level+1)*(deckY-base-.55)/2;
   // Separate crossed timbers by their thickness, avoiding an intersecting coplanar joint.
   const offset:V3=[side===1?.10:side===3?-.10:0,0,side===0?-.10:side===2?.10:0];
   a.beam([start[0],low,start[2]],[end[0],high,end[2]],.22,'wood','tower-brace',columns[side]);
   a.beam([end[0]+offset[0],low,end[2]+offset[2]],[start[0]+offset[0],high,start[2]+offset[2]],.22,'wood','tower-brace',columns[(side+1)%4]);
  }
 }
 const deck=a.piece('box',[0,deckY,0],[w,.24,d],'wood','observation',columns[0]);a.depend(deck,columns,2);
 const rx=w/2-.11,rz=d/2-.11;
 for(const side of [-1,1]){
  a.beam([-w/2,deckY-.04,side*d/2],[w/2,deckY-.04,side*d/2],.26,'wood','tower-deck-fascia',deck,{start:[1,0,side],end:[1,0,-side]});
  a.beam([side*w/2,deckY-.04,-d/2],[side*w/2,deckY-.04,d/2],.26,'wood','tower-deck-fascia',deck,{start:[side,0,1],end:[-side,0,1]});
 }
 for(const sx of [-1,1])for(const sz of [-1,1]){
  const column=columns.find(id=>{const p=a.plan.pieces.find(p=>p.id===id)!;return Math.sign(p.position[0])===sx&&Math.sign(p.position[2])===sz;})!;
  const corner:V3=[sx*w/2,deckY-.18,sz*d/2];
  const joist=a.beam([sx*px,deckY-.18,sz*pz],corner,.26,'wood','tower-corner-joist',column);
  a.beam([sx*px,deckY-.95,sz*pz],corner,.21,'wood','tower-corner-brace',column,{start:[0,1,0],end:[0,1,0]});
  a.piece('box',[sx*(w/2-.08),deckY-.15,sz*(d/2-.08)],[.34,.36,.34],'wood','tower-corner-block',joist);
  const xPlate=a.piece('box',[sx*(w/2+.16),deckY-.06,sz*(d/2-.14)],[.055,.30,.55],'metal','tower-corner-plate',joist);
  const zPlate=a.piece('box',[sx*(w/2-.14),deckY-.06,sz*(d/2+.16)],[.55,.30,.055],'metal','tower-corner-plate',joist);
  for(const offset of [-.06,.25]){
   a.piece('box',[sx*(w/2+.205),deckY-.06,sz*(d/2-offset)],[.04,.065,.065],'metal','tower-corner-bolt',xPlate);
   a.piece('box',[sx*(w/2-offset),deckY-.06,sz*(d/2+.205)],[.065,.065,.04],'metal','tower-corner-bolt',zPlate);
  }
 }
 const guardPosts=new Set<string>();
 const guard=(from:V3,to:V3)=>{
  const length=Math.hypot(to[0]-from[0],to[2]-from[2]),count=Math.max(1,Math.ceil(length/1.25));
  for(let i=0;i<=count;i++){
   const x=from[0]+(to[0]-from[0])*i/count,z=from[2]+(to[2]-from[2])*i/count;
   const key=x.toFixed(5)+':'+z.toFixed(5);if(guardPosts.has(key))continue;guardPosts.add(key);
   const post=a.beam([x,deckTop-.05,z],[x,deckTop+1.05,z],.17,'wood','tower-guard-post',deck);
   a.piece('box',[x,deckTop+1.07,z],[.24,.10,.24],'wood','tower-guard-cap',post);
  }
  for(const y of [deckTop+.32,deckTop+.66,deckTop+1.0])a.beam([from[0],y,from[2]],[to[0],y,to[2]],.14,'wood','tower-guard-rail',deck);
 };
 guard([-rx,0,rz],[rx,0,rz]);guard([-rx,0,-rz],[-rx,0,rz]);guard([rx,0,-rz],[rx,0,rz]);
 guard([-rx,0,-rz],[-.66,0,-rz]);guard([.66,0,-rz],[rx,0,-rz]);
 const roofY=deckTop+Math.max(1.8,Math.min(2.3,w*.46)),rise=w*.36;
 const roofSeat=roofY+rise*(1-px/(w/2))-.08;
 const canopy:string[]=[];
 for(const x of [-px,px])for(const z of [-pz,pz]){
  const post=a.beam([x,deckTop,z],[x,roofSeat,z],.28,'wood','roof-post',deck);canopy.push(post);
  metalJoint(x,deckTop+.18,z,post,.28);
  a.beam([x,roofSeat-.55,z],[x-Math.sign(x)*.50,roofSeat-.04,z],.16,'wood','tower-roof-brace',post);
  a.beam([x,roofSeat-.55,z],[x,roofSeat-.04,z-Math.sign(z)*.50],.16,'wood','tower-roof-brace',post);
 }
 for(const z of [-pz,pz])a.beam([-px,roofSeat-.03,z],[px,roofSeat-.03,z],.20,'wood','tower-canopy-header',canopy[0]);
 for(const x of [-px,px])a.beam([x,roofSeat-.03,-pz],[x,roofSeat-.03,pz],.20,'wood','tower-canopy-header',canopy[0]);
 a.plan.roofs.push({id:'tower-roof',volume:'tower',x:0,z:0,width:w,depth:d,y:roofY,rise,eaves:Math.min(.45,p.eaves),kind:'gable',material:'roof'});
 a.depend('tower-roof',canopy,2);
 const overhang=Math.min(.45,p.eaves),eaveSeat=roofY-rise*overhang/(w/2)-.08;
 for(const z of [-pz,pz])for(const side of [-1,1])a.beam([side*(w/2+overhang),eaveSeat,z],[0,roofY+rise-.08,z],.22,'wood','tower-roof-rafter','tower-roof');
 const roofEdge=d/2+Math.min(.45,p.eaves);
 for(const z of [-roofEdge,roofEdge]){
  for(const side of [-1,1])a.beam([side*(w/2+.35),roofY-.22,z],[0,roofY+rise+.07,z],.23,'wood','tower-roof-trim','tower-roof');
  a.piece('box',[0,roofY+rise+.12,z],[.30,.26,.30],'wood','tower-roof-finial','tower-roof');
 }
 // Near-vertical ladder continues above the floor as handholds, through the front rail gap.
 const footZ=-d/2-.65,topZ=-d/2-.03;
 const rails=[-1,1].map(side=>a.beam([side*.52,base,footZ],[side*.52,deckTop+.85,topZ+.08],.18,'wood','tower-ladder-rail',deck));
 const rungCount=Math.ceil((deckTop-base)/.32);
 for(let i=1;i<=rungCount;i++){
  const y=base+(deckTop-base-.05)*i/rungCount,z=footZ+(topZ+.08-footZ)*(y-base)/(deckTop+.85-base);
  const rung=a.beam([-.52,y,z],[.52,y,z],.14,'wood','tower-ladder-rung',rails[0]);a.depend(rung,rails,2);
  for(const x of [-.52,.52])a.piece('box',[x,y,z-.105],[.065,.065,.035],'metal','tower-ladder-bolt',rung);
 }
 a.plan.accesses.push({id:'tower-ladder-access',from:[0,base,footZ],to:[0,deckTop,topZ],width:1.04,role:'ladder'});
 for(const [x,z,size] of [[-w*.23,d*.22,.65],[-w*.06,d*.29,.48]]){
  const crate=a.piece('box',[x,deckTop+size/2,z],[size,size,size],'wood','tower-supply-crate',deck);
  for(const y of [deckTop+.08,deckTop+size-.08])a.piece('box',[x,y,z-size/2-.015],[size+.04,.10,.055],'wood','tower-crate-frame',crate);
  a.beam([x-size*.38,deckTop+.12,z-size/2-.045],[x+size*.38,deckTop+size-.12,z-size/2-.045],.075,'wood','tower-crate-diagonal',crate);
 }
 const barrelX=w*.21,barrelZ=d*.23,barrel=a.piece('column',[barrelX,deckTop+.45,barrelZ],[.72,.90,.72],'wood','tower-barrel',deck);
 for(const y of [.14,.73])a.piece('column',[barrelX,deckTop+y,barrelZ],[.72,.065,.72],'metal','tower-barrel-hoop',barrel);
 a.piece('column',[barrelX,deckTop+.91,barrelZ],[.58,.04,.58],'wood','tower-barrel-lid',barrel);
 return a.finish();
}
