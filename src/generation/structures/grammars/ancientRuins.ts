import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function ancientRuins(c:GrammarContext){
 const a=new Architect(c),p=c.config,unit=p.height/4,w=a.value(p.width/unit,.025),d=a.value(p.depth/unit,.025),h=4,floor=.64;
 const base=a.piece('box',[0,.24,0],[w,.48,d],'stone','ancient-plinth');
 const stone=(at:V3,size:V3,role:string,support=base,rotation?:V3)=>a.piece('box',at,size,'stone',role,support,rotation);
 // A continuous foundation closes the joints beneath the individual paving slabs.
 const nx=Math.max(5,Math.ceil(w/.95)),nz=Math.max(5,Math.ceil(d/.90));
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  stone([-w/2+(x+.5)*w/nx,.55,-d/2+(z+.5)*d/nz],[w/nx-.015,.18,d/nz-.015],'ancient-paving');
 }
 const gate=w*.43,steps=4,run=Math.min(1.9,d*.23);
 for(let i=0;i<steps;i++){
  const top=floor*(i+1)/steps,depth=run/steps*(steps-i),count=Math.max(3,Math.ceil(gate/.85));
  for(let j=0;j<count;j++)stone([-gate/2+(j+.5)*gate/count,top/2,-d/2-depth/2],[gate/count-.014,top,depth],'ancient-step','ground');
 }
 a.plan.accesses.push({id:'ruins-entry',from:[0,0,-d/2-run],to:[0,floor,-d/2],width:gate,role:'stairs'});
 // Low remnants along the edges, with an unobstructed opening for the steps.
 for(const side of [-1,1])for(let i=0;i<Math.ceil(d/.85);i++){
  const count=Math.ceil(d/.85),z=-d/2+(i+.5)*d/count;
  for(let tier=0;tier<(i%4===1?1:2);tier++)stone([side*(w/2-.18),floor+.18+tier*.34,z],[.49,.34,d/count-.02],'ancient-wall-remnant');
 }
 for(const side of [-1,1]){
  const length=(w-gate)/2,count=Math.ceil(length/.85);
  for(let i=0;i<count;i++)for(let tier=0;tier<2;tier++)stone([side*(gate/2+(i+.5)*length/count),floor+.18+tier*.34,-d/2+.16],[length/count-.02,.34,.49],'ancient-wall-remnant');
 }
 const diameter=Math.min(.72,w*.075),xCol=w*.38,front=-d*.35,back=d*.33,rows=5,columnTops:string[][]=[[],[]];
 const ivy=(at:V3,length:number,support:string,angle=Math.PI)=>{
  if(p.vegetation>.02)a.piece('cloth',at,[.32,length*(.55+p.vegetation),.30],'cloth','ancient-ivy',support,[0,angle,0]);
 };
 for(const [s,side] of ([-1,1] as const).entries())for(let i=0;i<rows;i++){
  const z=front+i*(back-front)/(rows-1),x=side*xCol;
  const broken=i===0||side===-1&&i===1&&p.ruin>.35;
  const reach=h*.80*(broken?(side===1?.28:.60):1),bottom=floor+.35;
  let support=stone([x,floor+.16,z],[diameter*1.45,.32,diameter*1.45],'ancient-column-foot');
  const count=Math.max(2,Math.ceil(reach/.53)),height=reach/count;
  for(let j=0;j<count;j++)support=a.piece('column',[x,bottom+(j+.5)*height,z],[diameter,height-.016,diameter],'stone',broken&&j===count-1?'ancient-broken-column':'ancient-column-block',support,[0,j*.18,0]);
  columnTops[s].push(support);
  if(!broken){
   stone([x,bottom+reach+.08,z],[diameter*1.16,.16,diameter*1.16],'ancient-column-ring',support);
   stone([x,bottom+reach+.24,z],[diameter*1.6,.20,diameter*1.6],'ancient-capital',support);
  }
  if(i===1||i===3)ivy([x+side*diameter*.40,bottom+reach-.08,z],Math.min(1.5,reach*.7),support,side*Math.PI/2);
 }
 const lintelY=floor+.35+h*.80+.46;
 for(const [s,side] of ([-1,1] as const).entries())for(let i=2;i<rows;i++){
  const z0=front+(i-1)*(back-front)/(rows-1),z1=front+i*(back-front)/(rows-1),count=Math.max(2,Math.ceil((z1-z0)/.75));
  // Two complete columns carry each surviving span; no unsupported floating beams.
  if(side===-1&&i===2&&p.ruin>.35)continue;
  for(let j=0;j<count;j++){
   const id=stone([side*xCol,lintelY,z0+(j+.5)*(z1-z0)/count],[diameter*1.38,.30,(z1-z0)/count-.012],'ancient-lintel',columnTops[s][i]);
   a.depend(id,[columnTops[s][i-1],columnTops[s][i]]);
   if(j===0&&i%2===0)ivy([side*xCol+side*diameter*.60,lintelY+.12,z0+.20],1.0,id,side*Math.PI/2);
  }
 }
 // The rear gateway uses separate wedge-shaped voussoirs and a central keystone.
 const radius=Math.min(w*.235,h*.52),archZ=d*.32,spring=floor+h*.49,archDepth=.65,ring=.42;const archPiers:string[]=[];
 for(const side of [-1,1]){
  let support=stone([side*radius,floor+.18,archZ],[.88,.36,.91],'ancient-arch-foot');
  const count=Math.max(3,Math.ceil((spring-floor-.36)/.5)),height=(spring-floor-.36)/count;
  for(let i=0;i<count;i++)support=stone([side*radius,floor+.36+(i+.5)*height,archZ],[.66,height-.012,.66],'ancient-arch-pier',support);
  archPiers.push(stone([side*radius,spring-.08,archZ],[.98,.22,.92],'ancient-arch-capital',support));
 }
 for(let i=0;i<13;i++){
  const angle=(i+.5)*Math.PI/13;
  const id=a.piece('arch',[0,spring,archZ],[radius,ring,archDepth],'stone',i===6?'ancient-keystone':'ancient-arch-wedge',base,[0,0,angle]);
  a.depend(id,archPiers,2);
  if(i===3||i===8)ivy([Math.cos(angle)*(radius+.08),spring+Math.sin(angle)*(radius+.05),archZ-.36],1.3,id);
 }
 // Fallen masonry stays near the perimeter rather than blocking the open hall.
 const rnd=c.streams.streamFor('decoration','ancient-rubble');
 for(let i=0;i<18+Math.round(p.ruin*18);i++){
  const side=i%2?-1:1,x=side*(w/2+.10+rnd()*.65),z=(rnd()-.5)*(d+1),height=.18+rnd()*.25;
  stone([x,height/2,z],[.30+rnd()*.42,height,.27+rnd()*.35],'ancient-rubble','ground',[rnd()*.25,rnd()*3,rnd()*.20]);
 }
 for(const side of [-1,1])a.plan.propZones.push({id:'ruins-garden-'+side,x:side*(w/2+.15),z:0,width:1.4,depth:d+1,y:0,kind:'garden'});
 // Keep details in proportion at both catalogue size and enlarged editor sizes.
 for(const piece of a.plan.pieces){piece.position=piece.position.map(v=>v*unit) as V3;piece.size=piece.size.map(v=>v*unit) as V3;}
 for(const access of a.plan.accesses){access.from=access.from.map(v=>v*unit) as V3;access.to=access.to.map(v=>v*unit) as V3;access.width*=unit;}
 for(const zone of a.plan.propZones){zone.x*=unit;zone.z*=unit;zone.y*=unit;zone.width*=unit;zone.depth*=unit;}
 return a.finish();
}
