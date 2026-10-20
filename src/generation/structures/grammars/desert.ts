import {Architect} from '../blueprint';
import type {GrammarContext,V3,VolumeSpec} from '../types';

/** Sandstone courtyard house with usable terraces and an exterior stair. */
export function desert(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.05),d=a.value(p.depth,.05),h=Math.max(2.85,p.height*.62);
 const lower=a.building(0,0,w,d,h,1,{base:.3,material:'plaster',roof:'flat',role:'terrace'});
 const terrace=lower.bottom+h+.18;
 const upper=a.building(-w*.14,d*.16,w*.62,d*.55,Math.max(2.5,h*.82),1,{base:terrace,material:'plaster',roof:'flat',role:'desert-upper'});
 const upperBase=a.plan.pieces.find(piece=>piece.role==='foundation'&&piece.position[0]===upper.x&&piece.position[2]===upper.z)!;
 upperBase.size[1]=.16;upperBase.position[1]=terrace-.08;upperBase.support=lower.id+'_roof';a.depend(upperBase.id,[lower.id+'_roof']);
 // The upper door opens onto the terrace, never onto an automatic ground stair.
 for(const piece of a.plan.pieces)if(piece.kind==='stairs')piece.removed=true;a.plan.accesses=[];
 a.plan.openings=[];
 for(const v of [lower,upper]){
  const doorWidth=Math.min(1.3,v.width*.35);
  a.plan.openings.push({id:v.id+'_front-door',wall:v.id+'_wall_0',kind:'door',offset:0,width:doorWidth,bottom:0,height:2.05});
  if(v===lower)for(const side of [-1,1])a.plan.openings.push({id:v.id+'_front-window_'+side,wall:v.id+'_wall_0',kind:'window',offset:side*w*.32,width:.75,bottom:1.02,height:.96,shutterAngles:[0,0]});
  for(const side of (v===lower?[3]:[1,3]))a.plan.openings.push({id:v.id+'_side-window_'+side,wall:v.id+'_wall_'+side,kind:'window',offset:0,width:.75,bottom:1.02,height:.96,shutterAngles:[0,0]});
  const r=a.plan.roofs.find(roof=>roof.volume===v.id)!;r.material='stone';r.eaves=.28;r.flatThickness=.18;r.plainEdge=true;
  for(const zz of [v.z-v.depth/2-.28,v.z+v.depth/2+.28])a.beam([v.x-v.width/2-.38,r.y-.08,zz],[v.x+v.width/2+.38,r.y-.08,zz],.27,'wood','desert-terrace-fascia',r.id);
  for(const xx of [v.x-v.width/2-.28,v.x+v.width/2+.28])a.beam([xx,r.y-.08,v.z-v.depth/2-.14],[xx,r.y-.08,v.z+v.depth/2+.14],.27,'wood','desert-terrace-fascia',r.id);
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const x=v.x+sx*v.width/2,z=v.z+sz*v.depth/2;
   for(const yy of [v.bottom+.40,v.bottom+v.height-.5])a.piece('box',[x,yy,z],[.36,.15,.36],'metal','desert-post-collar',v.id);
   if(v===lower)a.piece('box',[x,.25,z],[.46,.5,.46],'stone','desert-post-foot',v.id);
  }
  // Pale stone courses at the foot of each plaster wall.
  for(const z of [v.z-v.depth/2,v.z+v.depth/2]){
   if(z<v.z){for(const side of [-1,1])a.piece('box',[v.x+side*(v.width/4+doorWidth/4),v.bottom+.22,z],[v.width/2-doorWidth/2,.44,.22],'stone','desert-wall-base',v.id);}
   else a.piece('box',[v.x,v.bottom+.22,z],[v.width,.44,.22],'stone','desert-wall-base',v.id);
  }
  for(const x of [v.x-v.width/2,v.x+v.width/2])a.piece('box',[x,v.bottom+.22,v.z],[.22,.44,v.depth],'stone','desert-wall-base',v.id);
 }
 const timberRandom=c.streams.streamFor('desert-parapet-timber','walls');
 let parapetBay=0,nextTimberBay=2+Math.floor(timberRandom()*5);
 const rail=(from:V3,to:V3,support:string,open=false)=>{
  const dx=to[0]-from[0],dz=to[2]-from[2],length=Math.hypot(dx,dz),n=Math.max(1,Math.ceil(length/1.35));
  for(let i=0;i<=n;i++){
   const x=from[0]+dx*i/n,z=from[2]+dz*i/n;
   a.piece('box',[x,from[1]+.39,z],[.35,.88,.35],'plaster','desert-parapet-post',support);
  }
  for(let i=0;i<n;i++){
   const mid={x:from[0]+dx*(i+.5)/n,z:from[2]+dz*(i+.5)/n};
   const horizontal=Math.abs(dx)>Math.abs(dz),span=length/n-.34;
   if(open){a.beam([from[0]+dx*i/n,from[1]+.49,from[2]+dz*i/n],[from[0]+dx*(i+1)/n,from[1]+.49,from[2]+dz*(i+1)/n],.14,'wood','desert-parapet-rail',support);continue;}
   const box=(along:number,yy:number,width:number,height:number)=>a.piece('box',[mid.x+(horizontal?along:0),from[1]+yy,mid.z+(horizontal?0:along)],[horizontal?width:.19,height,horizontal?.19:width],'plaster','desert-parapet',support);
   box(0,.21,span,.42);
   if(parapetBay++===nextTimberBay){
    a.piece('box',[mid.x,from[1]+.64,mid.z],[horizontal?span:.19,.16,horizontal?.19:span],'wood','desert-parapet-timber-bar',support);
    nextTimberBay+=7+Math.floor(timberRandom()*4);
   }else box(0,.64,span,.16);
   const gap=Math.min(.21,span*.3),side=(span-gap)/2;
   for(const sign of [-1,1])box(sign*(gap/2+side/2),.49,side,.14);
  }
 };
 const parapets=(v:VolumeSpec,y:number,isUpper:boolean)=>{
  const left=v.x-v.width/2,right=v.x+v.width/2,front=v.z-v.depth/2,back=v.z+v.depth/2,support=v.id+'_roof';
  rail([left,y,front],[right,y,front],support);
  rail([left,y,front],[left,y,back],support);
  rail([left,y,back],[right,y,back],support,true);
  rail([right,y,front],[right,y,isUpper?back:back-1.45],support);
 };
 parapets(lower,terrace,false);parapets(upper,upper.bottom+upper.height+.16,true);
 // Solid external stair against the right wall, arriving through the parapet opening.
 const stairX=w/2+.72,topZ=d/2-.7,run=Math.max(d*.8,terrace*1.45),width=1.4;
 const stairId=a.stairs([stairX,0,topZ-run],[stairX,terrace,topZ],width);
 const stair=a.plan.pieces.find(piece=>piece.id===stairId)!;
 stair.material='plaster';stair.role='desert-access-stairs';
 // Separate stone treads leave a continuous rendered plaster wall under the stair.
 const steps=Math.ceil(terrace/.2);
 for(let i=0;i<steps;i++){
  const inset=i===steps-1?.26:0;
  a.piece('box',[stairX-.12+inset/2,terrace*(i+1)/steps-.018,topZ-run+(i+.5)*run/steps],[width-.24-inset,.036,run/steps],'stone','desert-stair-tread',stairId);
 }
 const outerX=stairX+width/2,backZ=d/2;
 const stairBack=backZ-topZ;
 a.piece('box',[outerX-.175,terrace+.415,backZ],[.35,.83,.35],'plaster','desert-stair-parapet-end-post',lower.id+'_roof');
 a.beam([w/2,terrace+.49,backZ],[outerX-.175,terrace+.49,backZ],.14,'wood','desert-stair-rear-rail',lower.id+'_roof');
 stair.size[0]=width-.24;stair.position=[...stair.position];stair.end=[...stair.end!];stair.position[0]-=.12;stair.end[0]-=.12;
 // Fill the whole landing down to the ground; its thin slab alone left an open slot.
 a.piece('box',[(w/2+outerX-.24)/2,(lower.bottom+h)/2,topZ+stairBack/2],[outerX-w/2-.24,lower.bottom+h,stairBack],'plaster','desert-stair-landing-wall',lower.id+'_roof');
 const rearWall=a.plan.walls.find(wall=>wall.id===lower.id+'_wall_2')!;
 const rearBase=a.plan.pieces.find(piece=>piece.role==='desert-wall-base'&&Math.abs(piece.position[2]-backZ)<.01&&Math.abs(piece.position[1]-(lower.bottom+.22))<.01)!;
 rearBase.position[0]=(outerX-w/2)/2;rearBase.size[0]=w+outerX-w/2;
 a.piece('box',[outerX,.52,(topZ-run+backZ)/2],[.22,.44,run+stairBack],'stone','desert-stair-wall-base',lower.id+'_roof');
 a.piece('box',[outerX,.15,(topZ-run+backZ)/2],[.25,.30,run+stairBack],'stone','desert-stair-foundation-edge',lower.id+'_roof');
 a.piece('box',[(w/2+outerX)/2,.15,backZ],[outerX-w/2,.30,.25],'stone','desert-stair-foundation-return',lower.id+'_roof');
 // Keep the house's original four walls; only a short rear return closes the stair.
 a.piece('box',[(w/2+outerX)/2,(lower.bottom+h)/2,backZ],[outerX-w/2,lower.bottom+h,rearWall.thickness],'plaster','desert-stair-rear-wall',lower.id+'_roof');
 for(const piece of a.plan.pieces){
  const atBack=Math.abs(piece.position[2]-backZ)<.01;
  if(piece.role==='corner-post'&&atBack&&Math.abs(piece.position[0]-w/2)<.01&&piece.position[1]<terrace){piece.position=[...piece.position];piece.position[0]=outerX;if(piece.end){piece.end=[...piece.end];piece.end[0]=outerX;}}
  if(['desert-post-collar','desert-post-foot'].includes(piece.role)&&atBack&&Math.abs(piece.position[0]-w/2)<.01&&piece.position[1]<terrace)piece.position[0]=outerX;
  if(piece.role==='facade-brace'&&piece.position[0]>w/2-.8&&piece.position[2]>backZ-.8&&piece.position[1]<terrace)piece.removed=true;
 }
 for(const yy of [lower.bottom,lower.bottom+h-.145])a.beam([w/2-.14,yy,backZ],[outerX-.14,yy,backZ],.24,'wood','desert-stair-rear-frame',lower.id+'_roof');
 a.beam([w/2+.15,lower.bottom+h-.08,backZ+.28],[outerX+.15,lower.bottom+h-.08,backZ+.28],.27,'wood','desert-stair-rear-fascia',lower.id+'_roof');
 a.beam([outerX,lower.bottom+h-.85,backZ],[outerX-.65,lower.bottom+h-.20,backZ],.13,'wood','desert-stair-corner-brace',lower.id+'_roof');
 a.piece('box',[(w/2+.28+outerX)/2,terrace-.09,topZ+(stairBack+.28)/2],[outerX-w/2-.28,.18,stairBack+.28],'stone','desert-stair-landing',lower.id+'_roof');
 // A single stepped solid replaces overlapping parapet boxes.
 const sideWall=a.piece('box',[outerX-.12,0,topZ-run],[.24,terrace,run],'plaster','desert-stair-side-wall',stairId);
 a.plan.pieces.find(piece=>piece.id===sideWall)!.end=[outerX-.12,lower.bottom+h,backZ-.175];
 const doorZ=-d/2;
 a.stairs([0,0,doorZ-.90],[0,.30,doorZ-.02],1.6);
 const awningWidth=w*.61,reach=1.65,awningY=lower.bottom+h-.40,awningBackZ=doorZ-.28,awningZ=(doorZ-reach+awningBackZ)/2;
 a.piece('cloth',[0,awningY,awningZ],[awningWidth,.10,reach-.28],'cloth','desert-awning',lower.id);
 for(const side of [-1,1]){
  const x=side*(awningWidth/2-.12),z=doorZ-reach+.08;
  const post=a.beam([x,0,z],[x,awningY-.26,z],.21,'wood','desert-awning-post');
  for(const yy of [.35,awningY-.55])a.piece('box',[x,yy,z],[.25,.13,.25],'metal','desert-awning-collar',post);
  const rafterX=side*(awningWidth/2-.085);
  a.beam([rafterX,awningY-.25,doorZ-reach],[rafterX,awningY+.31,awningBackZ],.17,'wood','desert-awning-rafter',post);
 }
 a.beam([-awningWidth/2,awningY-.25,doorZ-reach],[awningWidth/2,awningY-.25,doorZ-reach],.17,'wood','desert-awning-header');
 // Small wooden hoods over the upper door and lower windows.
 for(const [x,yy,z,ww] of [[upper.x,upper.bottom+2.25,upper.z-upper.depth/2-.2,1.55],[-w*.32,lower.bottom+2.28,doorZ-.19,1.12],[w*.32,lower.bottom+2.28,doorZ-.19,1.12]]){
  a.piece('box',[x,yy,z],[ww,.10,.5],'wood','desert-window-hood','ground',[-.25,0,0]);
 }
 a.piece('cloth',[0,.025,doorZ-1.5],[1.65,.03,.9],'cloth','desert-rug');
 a.piece('cloth',[upper.x,terrace+.025,upper.z-upper.depth/2-.73],[1.75,.03,.85],'cloth','desert-rug',lower.id+'_roof');
 const banner=(x:number,y:number,z:number,support:string)=>{a.piece('cloth',[x,y,z],[.60,1.50,.035],'cloth','desert-banner',support);a.beam([x-.36,y+.79,z],[x+.36,y+.79,z],.055,'wood','desert-banner-hanger',support);};
 banner(upper.x-upper.width*.31,terrace+1.37,upper.z-upper.depth/2-.13,upper.id);
 // Side shade and banner are turned toward the uncovered side wall.
 const sideShade=a.piece('cloth',[-w/2-.55,lower.bottom+2.70,0],[1.1,.08,1.6],'cloth','desert-side-awning',lower.id);
 for(const z of [-.8,.8])a.beam([-w/2-.025,lower.bottom+2.675,z],[-w/2-1.1,lower.bottom+2.375,z],.09,'wood','desert-shade-rafter',sideShade);
 for(const side of [-1,1]){
  const wallX=upper.x+side*upper.width/2,shadeY=upper.bottom+2.55;
  const shade=a.piece('cloth',[wallX+side*.55,shadeY,upper.z],[1.1,.08,1.6],'cloth','desert-side-awning',upper.id,[0,side>0?Math.PI:0,0]);
  for(const z of [upper.z-.8,upper.z+.8])a.beam([wallX+side*.025,shadeY-.025,z],[wallX+side*1.1,shadeY-.325,z],.09,'wood','desert-shade-rafter',shade);
 }
 const crate=(x:number,y:number,z:number)=>{const id=a.piece('box',[x,y+.23,z],[.55,.46,.5],'wood','desert-crate');for(const xx of [-.23,.23])a.piece('box',[x+xx,y+.23,z-.26],[.08,.48,.06],'wood','desert-crate-frame',id);a.beam([x-.22,y+.05,z-.30],[x+.22,y+.40,z-.30],.07,'wood','desert-crate-brace',id);};
 crate(w*.35,terrace,upper.z-upper.depth/2-.25);crate(-w*.34,0,doorZ-.62);
 const benchX=w*.31,z=doorZ-.75;
 a.piece('box',[benchX,.50,z],[1.15,.13,.45],'wood','desert-bench');for(const sx of [-1,1])for(const sz of [-1,1])a.piece('box',[benchX+sx*.46,.23,z+sz*.15],[.12,.46,.12],'wood','desert-bench-leg');
 // The ground-level plinth is uninterrupted stone, without a timber belt.
 for(const piece of a.plan.pieces)if(['wall-frame','desert-stair-rear-frame'].includes(piece.role)&&piece.end&&Math.abs(piece.position[1]-lower.bottom)<.01&&Math.abs(piece.end[1]-lower.bottom)<.01)piece.removed=true;
 const hosts=new Map(a.plan.volumes.map(v=>[v.id,v.id+'_roof']));
 for(const piece of a.plan.pieces)piece.support=hosts.get(piece.support)??piece.support;
 for(const support of a.plan.supports)support.on=hosts.get(support.on)??support.on;
 return a.finish();
}
