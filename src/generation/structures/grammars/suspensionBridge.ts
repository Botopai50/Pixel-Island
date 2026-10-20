import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function suspensionBridge(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.025),d=a.value(p.depth,.02),h=a.value(p.height,.025);
 const zRail=d/2-.08,sag=Math.min(h*.34,w*.095),bankLength=Math.min(1.8,w*.26);
 const floor=(x:number)=>h-sag*(1-(2*x/w)**2);
 const bankIds:string[]=[],towers:string[]=[];
 const rope=(from:V3,to:V3,width:number,role:string,parent:string)=>a.beam(from,to,width,'thatch',role,parent);
 const knot=(x:number,y:number,z:number,parent:string,width=.20)=>a.piece('box',[x,y,z],[width,width,width],'thatch','bridge-rope-knot',parent);
 for(const sx of [-1,1]){
  const x=sx*w/2,bank=a.piece('box',[x+sx*bankLength/2,(h-.14)/2,0],[bankLength,h-.14,zRail*2],'stone','bridge-variant-bank');bankIds.push(bank);
  a.piece('box',[x+sx*bankLength/2,.16,0],[bankLength+.22,.32,d+.24],'stone','bridge-bank-plinth',bank);
  const landingCount=Math.max(3,Math.ceil(bankLength/.34));
  for(let i=0;i<landingCount;i++)a.piece('box',[x+sx*(i+.5)*bankLength/landingCount,h-.07,0],[bankLength/landingCount-.014,.14,d+.13],'wood','bridge-rope-landing',bank);
  a.plan.accesses.push({id:'rope-landing-'+sx,from:[x+sx*bankLength,h,0],to:[x,h,0],width:d,role:'landing'});
  for(const sz of [-1,1]){
   const z=sz*zRail,foot=a.piece('box',[x,h-.19,z],[.68,.38,.68],'stone','bridge-rope-tower-foot',bank);
   const post=a.piece('box',[x,h+1.30,z],[.43,2.60,.43],'wood','bridge-rope-tower',foot);towers.push(post);
   a.piece('box',[x,h+2.67,z],[.49,.14,.49],'metal','bridge-post-cap',post);
   for(const y of [.08,.63,1.45])a.piece('box',[x,h+y,z],[.49,.16,.49],'metal','bridge-rope-tower-collar',post);
   for(let turn=0;turn<4;turn++)a.piece('box',[x,h+1.58+turn*.08,z],[.59,.085,.59],'thatch','bridge-rope-wrap',post);
   knot(x-sx*.23,h+1.72,z,post,.23);
   const braceFoot=a.piece('box',[x+sx*(bankLength-.12),h-.20,z],[.50,.40,.50],'stone','bridge-rope-brace-foot',bank);
   a.beam([x+sx*.14,h+1.32,z],[x+sx*(bankLength-.12),h+.04,z],.27,'wood','bridge-rope-tower-brace',braceFoot);
   // A long outer rake anchors each tower beyond the masonry, as in the reference.
   const anchorX=x+sx*(bankLength+.55),anchorZ=z+sz*.48,anchor=a.piece('box',[anchorX,.16,anchorZ],[.52,.32,.52],'stone','bridge-rope-anchor-foot');
   a.beam([x+sx*.12,h+.70,z],[anchorX,.30,anchorZ],.24,'wood','bridge-rope-anchor-brace',anchor);
  }
  // The portal has 2.30 m of clear headroom above the walking surface.
  a.beam([x,h+2.44,-zRail+.22],[x,h+2.44,zRail-.22],.28,'wood','bridge-rope-end-crossbar',towers[towers.length-2]);
  const inner=x+sx*bankLength,run=Math.max(2.2,h*1.02),outer=inner+sx*run,count=Math.ceil(h/.32),step=run/count;
  a.plan.accesses.push({id:'rope-stairs-'+sx,from:[outer,0,0],to:[inner,h,0],width:d,role:'stairs'});
  for(let i=0;i<count;i++){
   const xx=inner+sx*(i+.5)*step,y=h*(1-i/count);
   const stone=a.piece('box',[xx,(y-.14)/2,0],[step,y-.14,zRail*2],'stone','bridge-stair-retaining-wall',bank);
   a.piece('box',[xx,y-.07,0],[step-.014,.14,d+.13],'wood','bridge-stair-tread',stone);
  }
  for(const sz of [-1,1]){
   const z=sz*zRail,foot=a.piece('box',[outer,.16,z],[.64,.32,.64],'stone','bridge-stair-foot');
   const lower=a.piece('box',[outer,.76,z],[.34,1.20,.34],'wood','bridge-stair-post',foot);
   const upper=a.piece('box',[inner,h+.65,z],[.34,1.30,.34],'wood','bridge-stair-post',bank);
   for(const [xx,yy,post] of [[outer,1.42,lower],[inner,h+1.36,upper]] as const)a.piece('box',[xx,yy,z],[.42,.12,.42],'metal','bridge-post-cap',post);
   a.beam([inner-sx*.17,h+1.10,z],[x+sx*.215,h+1.10,z],.21,'wood','bridge-handrail',upper,{start:[1,0,0],end:[1,0,0]});
   a.beam([inner-sx*.17,h+.23,z],[x+sx*.215,h+.23,z],.17,'wood','bridge-rail-sill',upper);
   a.beam([outer-sx*.17,1.10+h*.17/run,z],[inner+sx*.17,h+1.10-h*.17/run,z],.21,'wood','bridge-stair-handrail',upper,{start:[1,0,0],end:[1,0,0]});a.plan.pieces.at(-1)!.size[1]=.25;
   a.beam([outer,.13,z],[inner,h-.16,z],.17,'wood','bridge-stair-stringer',bank);a.plan.pieces.at(-1)!.size[1]=.42;
   a.piece('box',[inner,h+.08,z],[.40,.13,.40],'metal','bridge-post-shoe',upper);
  }
 }
 const foundation=a.piece('box',[0,floor(0)-.16,0],[.01,.01,.01],'wood','bridge-rope-support',bankIds[0]);a.depend(foundation,bankIds,2);
 const n=Math.max(8,Math.ceil(w/.40)),pitch=w/n,boards:string[]=[];
 for(let i=0;i<n;i++){
  const x=-w/2+(i+.5)*pitch,slope=8*sag*x/(w*w),jitter=(a.rnd()-.5)*.018;
  const board=a.piece('box',[x,floor(x)-.08+jitter,(a.rnd()-.5)*.028],[pitch-.018,.16,d+.10+(a.rnd()-.5)*.04],'wood','deck-plank',foundation,[0,0,Math.atan(slope)]);boards.push(board);
  for(const sz of [-1,1])for(const offset of [-.075,.075])a.piece('box',[x+offset,floor(x)+jitter+.012,sz*(zRail-.12)],[.042,.026,.042],'metal','bridge-deck-nail',board);
 }
 for(const sz of [-1,1]){
  const z=sz*zRail,segments=Math.max(32,n*2),railY=(x:number)=>floor(x)+1.72;
  for(let i=0;i<segments;i++){
   const x=-w/2+i*w/segments,next=-w/2+(i+1)*w/segments;
   rope([x,railY(x),z],[next,railY(next),z],.12,'bridge-rope-handrail',foundation);
   rope([x,floor(x)-.13,z],[next,floor(next)-.13,z],.115,'bridge-rope-deck',foundation);
  }
  // Fewer, heavier hangers; each ties around an actual tread, with visible lashings.
  const hangers=Math.max(4,Math.round(w/1.35));
  for(let i=1;i<hangers;i++){
   const index=Math.min(n-1,Math.floor(i*n/hangers)),board=boards[index],x=-w/2+(index+.5)*pitch,y=floor(x);
   rope([x,y-.13,z],[x,railY(x),z],.085,'bridge-rope-hanger',board);
   knot(x,railY(x),z,board,.23);knot(x,y-.07,z+sz*.035,board,.21);
   a.piece('box',[x,y-.07,z],[pitch+.055,.075,.23],'thatch','bridge-rope-tread-lashing',board);
   rope([x,y-.12,z+sz*.07],[x+.055,y-.31,z+sz*.06],.045,'bridge-rope-knot-tail',board);
  }
 }
 if(p.vegetation>.15)for(const bankId of bankIds){
  const bank=a.plan.pieces.find(piece=>piece.id===bankId)!;
  for(const side of [-1,1])for(let col=0;col<3;col++)for(let i=0;i<Math.ceil(h*p.vegetation*4);i++){
   const x=bank.position[0]+(col-1)*bankLength*.27+Math.sin(i*1.7+col)*.08;
   a.piece('rock',[x,.12+i*.21,side*(zRail+.035)],[.14,.16,.06],'wood','bridge-bank-ivy',bankId);
  }
 }
 a.plan.propZones.push({id:'stream',x:0,z:0,width:w-.22,depth:d+9,y:0,kind:'water'});
 for(const sx of [-1,1])for(const sz of [-1,1])a.plan.propZones.push({id:`bank-${sx}-${sz}`,x:sx*(w/2+bankLength*.6),z:sz*(d/2+.9),width:bankLength,depth:1.3,y:0,kind:'garden'});
 return a.finish();
}
