import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';
import {campLayout,campPropPlacement} from '../campLayout';

export function camp(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth;
 const pitches=campLayout(c),place=campPropPlacement(c,pitches),props=c.streams.streamFor('camp-props','inventory');
 for(const {x,z,width,depth,height,yaw} of pitches){
  const foot=.06,pieceStart=a.plan.pieces.length,jointStart=a.plan.joints.length;
  const id='tent_'+a.plan.volumes.length;
  const across=Math.abs(Math.cos(yaw)),along=Math.abs(Math.sin(yaw));
  a.plan.volumes.push({id,x,z,width:width*across+depth*along,depth:depth*across+width*along,bottom:0,height,floors:1,role:'tent'});
  const poles:string[]=[];
  for(const end of [-1,1]){
   const zz=z+end*(depth/2+.04);
   for(const side of [-1,1]){
    const start:V3=[x+side*(width/2+.07),foot,zz],peak:V3=[x-side*.18,height+.36,zz];
    const pole=a.beam(start,peak,.15,'wood','camp-tent-pole');poles.push(pole);
    a.piece('box',[start[0],.15,zz],[.23,.22,.23],'metal','camp-pole-shoe',pole);
   }
   a.piece('box',[x,foot+height,zz],[.27,.17,.20],'metal','camp-ridge-binding',poles.at(-1)!);
  }
  const ridge=a.beam([x,foot+height,z-depth/2-.07],[x,foot+height,z+depth/2+.07],.13,'wood','camp-ridge',poles[0]);
  a.plan.roofs.push({id:id+'_roof',volume:id,x,z,width,depth,y:foot,rise:height,eaves:0,kind:'gable',material:'cloth',plainEdge:true,rotationY:yaw});
  a.depend(id+'_roof',poles,3);
  for(const end of [-1,1])a.piece('cloth',[x,foot,z+end*depth/2],[width,height,.045],'cloth',end<0?'camp-entry-flaps':'camp-back-canvas',id+'_roof');
  a.piece('box',[x,.055,z],[width*.73,.09,depth*.88],'thatch','camp-bed-mat');
  a.piece('column',[x,.23,z-depth*.12],[width*.49,.35,.35],'cloth',a.rnd()<.5?'camp-bedroll-blue':'camp-bedroll-red','ground',[0,0,Math.PI/2]);
  for(const side of [-1,1])for(const end of [-1,1]){
   const anchor:V3=[x+side*(width/2+.50),.38,z+end*(depth/2+.22)];
   const stake=a.beam([anchor[0],0,anchor[2]],[anchor[0],.42,anchor[2]],.12,'wood','camp-stake');
   a.piece('box',[anchor[0],.25,anchor[2]],[.15,.07,.15],'metal','camp-stake-binding',stake);
   a.beam([x,foot+height-.10,z+end*(depth/2+.06)],anchor,.026,'cloth','camp-guy-rope',ridge);
  }
  const turn=(point:V3):V3=>{const xx=point[0]-x,zz=point[2]-z;return [x+Math.cos(yaw)*xx+Math.sin(yaw)*zz,point[1],z-Math.sin(yaw)*xx+Math.cos(yaw)*zz];};
  for(const piece of a.plan.pieces.slice(pieceStart)){
   piece.position=turn(piece.position);if(piece.end)piece.end=turn(piece.end);
   else piece.rotation=[piece.rotation?.[0]??0,(piece.rotation?.[1]??0)+yaw,piece.rotation?.[2]??0];
  }
  for(const joint of a.plan.joints.slice(jointStart))joint.point=turn(joint.point);
 }
 const fireRadius=Math.min(1.08,Math.min(w,d)*.105);
 a.piece('column',[0,.025,0],[fireRadius*2.9,.035,fireRadius*2.9],'earth','camp-hearth-ground');
 for(let i=0;i<16;i++){
  const angle=i*Math.PI/8,rr=fireRadius*a.value(1,.035),height=a.value(.28,.12);
  a.piece('rock',[Math.cos(angle)*rr,height/2,Math.sin(angle)*rr],[.27,height/2,.23],'stone','fire-ring','ground',[0,-angle,0]);
 }
 for(let i=0;i<5;i++){
  const angle=i*Math.PI/5,rotation:V3=[0,angle,Math.PI/2];
  const log=a.piece('column',[0,.16,0],[.21,.85,.21],'wood','camp-burning-log','ground',rotation);
  for(const side of [-1,1])a.piece('column',[-side*Math.cos(angle)*.435,.16,side*Math.sin(angle)*.435],[.19,.025,.19],'wood','camp-burning-log-end',log,rotation);
 }
 // Preserve the existing seeded prop sizes after removing the seven flames.
 for(let i=0;i<7;i++)a.value(i===0?.85:.54,.22);
 const rackHeight=1.95,rackWidth=fireRadius*2.08,rackPosts:string[]=[];
 for(const side of [-1,1])for(const end of [-1,1]){
  rackPosts.push(a.beam([side*rackWidth/2,0,end*.44],[side*rackWidth*.45,rackHeight+.14,-end*.08],.12,'wood','camp-cooking-post'));
 }
 const bar=a.beam([-rackWidth*.55,rackHeight,0],[rackWidth*.55,rackHeight,0],.12,'wood','camp-cooking-bar',rackPosts[0]);
 a.depend(bar,rackPosts,3);
 const pot=a.piece('column',[0,1.07,0],[.68,.43,.68],'metal','camp-kettle',bar);
 a.piece('column',[0,1.275,0],[.51,.025,.51],'dark','camp-kettle-soup',pot);
 a.piece('column',[0,1.49,0],[.68,.48,.07],'metal','camp-kettle-handle',pot);
 a.beam([0,1.59,0],[0,rackHeight-.05,0],.035,'metal','camp-pot-chain',bar);
 const seatCount=1+Math.floor(props()*Math.min(4,pitches.length+1));
 for(let i=0;i<seatCount;i++){
  const {x,z}=place(.58,.58,2.8);
  const height=a.value(.48,.12);
  const stump=a.piece('column',[x,height/2,z],[.54,height,.54],'wood','camp-stump');
  a.piece('column',[x,height+.012,z],[.48,.028,.48],'wood','camp-stump-end',stump);
 }
 const crate=(x:number,z:number,size=.72)=>{
  const id=a.piece('box',[x,size/2,z],[size,size,size],'wood','camp-crate');
  for(const side of [-1,1]){
   for(const y of [.09,size-.09])a.piece('box',[x,y,z+side*(size/2+.025)],[size+.06,.10,.065],'wood','camp-crate-frame',id);
   a.beam([x-size*.40,.13,z+side*(size/2+.05)],[x+size*.40,size-.13,z+side*(size/2+.05)],.08,'wood','camp-crate-brace',id);
  }
  return id;
 };
 const barrel=(x:number,z:number)=>{
  const id=a.piece('column',[x,.47,z],[.74,.94,.74],'wood','camp-barrel');
  for(const y of [.13,.76])a.piece('column',[x,y,z],[.74,.065,.74],'metal','camp-barrel-hoop',id);
  a.piece('column',[x,.95,z],[.58,.045,.58],'wood','camp-barrel-lid',id);
 };
 const crateCount=1+Math.floor(props()*(1+p.complexity*2)),barrelCount=1+Math.floor(props()*(1+p.complexity));
 const supplyHubs=Array.from({length:Math.min(crateCount,Math.ceil(pitches.length/2))},()=>{
  const tent=pitches[Math.floor(props()*pitches.length)],side=props()<.5?-1:1;
  const xx=side*(tent.width/2+1.6),zz=tent.depth*.15;
  return {x:tent.x+Math.cos(tent.yaw)*xx+Math.sin(tent.yaw)*zz,z:tent.z-Math.sin(tent.yaw)*xx+Math.cos(tent.yaw)*zz};
 });
 for(let i=0;i<crateCount;i++){
  const hub=i%supplyHubs.length,size=.60+props()*.24,{x,z}=place(size+.14,size+.16,supplyHubs[hub]);crate(x,z,size);
  if(i<supplyHubs.length)supplyHubs[hub]={x,z};
 }
 for(let i=0;i<barrelCount;i++){const {x,z}=place(.8,.8,supplyHubs[i%supplyHubs.length]);barrel(x,z);}
 const utilityHub=supplyHubs[Math.floor(props()*supplyHubs.length)];
 const wood=place(.8,1.05,utilityHub),woodX=wood.x,woodZ=wood.z,rows=2+Math.floor(props()*2);
 for(let row=0;row<rows;row++)for(let i=0;i<rows-row;i++){
  const x=woodX+(i-(2-row)/2)*.22,y=.12+row*.19,z=woodZ;
  const firewood=a.piece('column',[x,y,z],[.22,.90,.22],'wood','camp-firewood','ground',[Math.PI/2,0,0]);
  for(const side of [-1,1])a.piece('column',[x,y,z+side*.46],[.19,.025,.19],'wood','camp-firewood-end',firewood,[Math.PI/2,0,0]);
 }
 const logLength=.90+props()*.55,log=place(logLength+.1,.55,3);
 const fallenLog=a.piece('column',[log.x,.24,log.z],[.46,logLength,.46],'wood','camp-fallen-log','ground',[0,0,Math.PI/2]);
 for(const side of [-1,1])a.piece('column',[log.x+side*(logLength/2+.015),.24,log.z],[.42,.035,.42],'wood','camp-log-end',fallenLog,[0,0,Math.PI/2]);
 if(props()<.25+p.complexity*.65){
  const {x,z}=place(1.25,.25,utilityHub);
  const posts=[-1,1].map(side=>a.beam([x+side*.53,0,z],[x+side*.53,1.45,z],.10,'wood','camp-drying-post'));
  const line=a.beam([x-.57,1.35,z],[x+.57,1.35,z],.065,'wood','camp-drying-line',posts[0]);
  a.piece('cloth',[x,1.00,z],[.87,.69,.035],'cloth','camp-drying-cloth',line);
 }
 a.plan.accesses.push({id:'camp-path',from:[0,0,-d*.58],to:[0,0,-fireRadius-.35],width:1.5,role:'path'});
 return a.finish();
}
