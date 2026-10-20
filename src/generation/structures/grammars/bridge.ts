import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';
import {bridgeVariant} from './bridgeVariants';
import {steppedBridge} from './steppedBridge';
import {suspensionBridge} from './suspensionBridge';

/** Timber footbridge carried by stone shoes, with open wooden stairs at both banks. */
export function bridge(c:GrammarContext){
 if(c.config.bridgeStyle==='stepped')return steppedBridge(c);
 if(c.config.bridgeStyle==='suspension')return suspensionBridge(c);
 if(c.config.bridgeStyle&&c.config.bridgeStyle!=='timber'&&c.config.bridgeStyle!=='covered')return bridgeVariant(c);
 const a=new Architect(c),p=c.config;
 const w=a.value(p.width,.06),d=a.value(p.depth,.04),h=a.value(p.height,.06);
 const walkingY=h+.17,railZ=d/2-.08,bays=Math.max(2,Math.round(w/3.7));
 const bearingIds:string[]=[],postIds:string[][]=[[],[]];
 const cap=(position:V3,post:string,width=.42)=>a.piece('box',position,[width,.12,width],'metal','bridge-post-cap',post);
 const plate=(x:number,y:number,z:number,parent:string)=>{
  const id=a.piece('box',[x,y,z],[.33,.33,.045],'metal','bridge-joint-plate',parent);
  for(const xx of [-.09,.09])for(const yy of [-.09,.09])a.piece('box',[x+xx,y+yy,z+Math.sign(z)*.03],[.045,.045,.024],'metal','bridge-rivet',id);
 };
 // Tall masonry abutments carry the landings at the two banks.
 // Both exposed masonry edges align with the timber piers' centre lines.
 const masonryEdge=railZ;
 const bankHeight=h-.18-walkingY*.95/Math.max(2.6,walkingY*1.12);
 // The river-facing edge begins at the centreline of the landing's timber pier.
 for(const sx of [-1,1])a.piece('box',[sx*(w/2+.95/2),bankHeight/2,0],[.95,bankHeight,masonryEdge*2],'stone','bridge-abutment');
 for(let i=0;i<=bays;i++){
  const x=-w/2+i*w/bays;
  for(const [side,sz] of [-1,1].entries()){
   const z=sz*railZ;
   const foot=a.piece('box',[x,.27,z],[.78,.54,.78],'stone','bridge-pier-foot');
   const pier=a.piece('box',[x,(.54+h-.13)/2,z],[.38,h-.67,.38],'wood','bridge-pier',foot);
   bearingIds.push(pier);
   a.piece('box',[x,.67,z],[.44,.15,.44],'metal','bridge-pier-collar',pier);
   const post=a.piece('box',[x,h+.64,z],[.34,1.48,.34],'wood','bridge-rail-post',pier);
   postIds[side].push(post);cap([x,h+1.40,z],post);
   a.piece('box',[x,h+.09,z],[.39,.11,.39],'metal','bridge-post-shoe',post);
   plate(x,h-.10,sz*(d/2+.185),post);
   // Opposing knee braces spread each pier's load into the side girder.
   for(const direction of [-1,1]){
    const endX=x+direction*Math.min(1.12,w/bays*.35);
    if(endX<-w/2+.1||endX>w/2-.1)continue;
    a.beam([x,h*.47,z],[endX,h-.26,z],.23,'wood','bridge-pier-brace',pier);
   }
  }
  a.piece('box',[x,h-.24,0],[.30,.28,d+.20],'wood','bridge-cross-joist',bearingIds.at(-1)!);
 }
 const deck=a.piece('box',[0,h-.20,0],[w,.10,d-.12],'wood','deck');
 a.depend(deck,bearingIds,2);
 const boards=Math.max(8,Math.ceil(w/.30)),boardWidth=w/boards;
 for(let i=0;i<boards;i++)a.piece('box',[-w/2+(i+.5)*boardWidth,h+.10,0],[boardWidth-.016,.14,d+.12],'wood','deck-plank',deck);
 for(const [side,sz] of [-1,1].entries()){
  const z=sz*railZ;
  a.piece('box',[0,h-.10,sz*(d/2+.05)],[w+.36,.40,.24],'wood','bridge-deck-girder',deck);
  for(let i=0;i<bays;i++){
   const left=-w/2+i*w/bays,right=left+w/bays,mid=(left+right)/2;
   const parent=postIds[side][i];
   a.piece('box',[mid,h+1.17,z],[right-left-.34,.25,.21],'wood','bridge-handrail',parent);
   a.piece('box',[mid,h+.29,z],[right-left-.34,.16,.17],'wood','bridge-rail-sill',parent);
   const baluster=a.piece('box',[mid,h+.71,z],[.15,.68,.16],'wood','bridge-baluster',parent);
   if(p.bridgeStyle!=='covered'){
    a.beam([left+.22,h+1.02,z],[mid-.09,h+.39,z],.16,'wood','bridge-rail-brace',parent);
    a.beam([mid+.09,h+.39,z],[right-.22,h+1.02,z],.16,'wood','bridge-rail-brace',baluster);
   }
  }
 }
 // Individual timber treads rest on a continuous stepped stone foundation.
 const run=Math.max(2.6,walkingY*1.12),steps=Math.ceil(walkingY/.36);
 for(const sx of [-1,1]){
  const outer=sx*(w/2+run),inner=sx*w/2;
  const access={id:'bridge-stairs-'+sx,from:[outer,0,0] as V3,to:[inner,walkingY,0] as V3,width:d,role:'stairs'};
  a.plan.accesses.push(access);
  const stringers:string[]=[];
  for(const sz of [-1,1]){
   const z=sz*railZ;
   const base=a.piece('box',[outer,.18,z],[.64,.36,.64],'stone','bridge-stair-foot');
   const newel=a.piece('box',[outer,.80,z],[.34,1.24,.34],'wood','bridge-stair-post',base);
   cap([outer,1.48,z],newel);
   stringers.push(a.beam([outer,.07,z],[inner,h+.26,z],.17,'wood','bridge-stair-stringer',base));
   a.plan.pieces.at(-1)!.size[1]=.42;
   const railSlope=(h+.19)/run,postHalf=.17;
   const railStartY=1.42-.04-.125*Math.sqrt(1+railSlope*railSlope)-railSlope*postHalf;
   const midX=(inner+outer)/2,midY=walkingY/2;
   const railY=(x:number)=>railStartY+railSlope*Math.abs(outer-x);
   const midTop=railY(midX)+.125*Math.sqrt(1+railSlope*railSlope)+railSlope*.18+.04;
   const midPost=a.piece('box',[midX,(midY+midTop)/2,z],[.28,midTop-midY,.28],'wood','bridge-stair-post',base);
   cap([midX,midTop+.06,z],midPost,.36);
   // Stop each rail at the post face instead of running one beam through the post.
   for(const [from,to,support] of [[outer-sx*postHalf,midX+sx*.14,newel],[midX-sx*.14,inner+sx*postHalf,midPost]] as const){
    a.beam([from,railY(from),z],[to,railY(to),z],.21,'wood','bridge-stair-handrail',support,
     {start:[1,0,0],end:[1,0,0]});
    a.plan.pieces.at(-1)!.size[1]=.25;
   }
   plate(outer,.30,sz*(railZ+.19),newel);
  }
  // The stone profile fills the centre as well as the sides, up to each tread's underside.
  for(let tier=0;tier<steps;tier++){
   const length=run/steps,x=sx*(w/2+(tier+.5)*length);
   const height=Math.max(.08,walkingY*(1-tier/steps)-.14);
   a.piece('box',[x,height/2,0],[length,height,masonryEdge*2],'stone','bridge-stair-retaining-wall');
  }
  for(let i=0;i<steps;i++){
   const t=(i+.5)/steps,x=outer+(inner-outer)*t,y=walkingY*(i+1)/steps;
   const tread=a.piece('box',[x,y-.07,0],[run/steps-.018,.14,d-.06],'wood','bridge-stair-tread',stringers[0]);
   a.depend(tread,stringers,1);
  }
 }
 a.plan.propZones.push({id:'stream',x:0,z:0,width:Math.max(1,w-.95),depth:d+9,y:0,kind:'water'});
 for(const sx of [-1,1])for(const sz of [-1,1])a.plan.propZones.push({id:`bridge-bank-${sx}-${sz}`,x:sx*(w/2+run*.55),z:sz*(d/2+1.3),width:1.5,depth:1.2,y:0,kind:'garden'});
 if(p.bridgeStyle==='covered'){
  const roofY=h+3.0,rise=Math.max(.8,d*.34),half=d/2+.45,angle=Math.atan2(rise,half);
  for(let i=0;i<=bays;i++)for(const sz of [-1,1]){
   const x=-w/2+i*w/bays,z=sz*railZ;
   const post=a.piece('box',[x,(h+.17+roofY)/2,z],[.34,roofY-h-.17,.34],'wood','bridge-covered-post',postIds[sz<0?0:1][i]);
   a.piece('box',[x,h+1.15,z],[.40,.14,.40],'metal','bridge-covered-collar',post);
   for(const dx of [-1,1])if(x+dx*.7>-w/2&&x+dx*.7<w/2)a.beam([x,roofY-.9,z],[x+dx*.7,roofY,z],.22,'wood','bridge-covered-brace',post);
   if(sz===1){a.beam([x,roofY,-railZ],[x,roofY,railZ],.24,'wood','bridge-covered-tie',post);for(const side of [-1,1])a.beam([x,roofY,side*half],[x,roofY+rise,0],.26,'wood','bridge-covered-rafter',post);}
  }
  for(const side of [-1,1]){
   a.piece('box',[0,roofY+rise/2,side*half/2],[w+.9,.14,Math.hypot(half,rise)],'roof','bridge-covered-roof',deck,[side*angle,0,0]);
   a.beam([-w/2-.45,roofY,side*half],[w/2+.45,roofY,side*half],.26,'wood','bridge-covered-eave',deck);
   for(const x of [-w/2-.45,w/2+.45])a.beam([x,roofY,side*half],[x,roofY+rise,0],.28,'wood','bridge-covered-roof-frame',deck);
  }
  a.beam([-w/2-.45,roofY+rise,0],[w/2+.45,roofY+rise,0],.26,'wood','bridge-covered-ridge',deck);
  for(const sz of [-1,1])for(let i=0;i<boards;i++)a.piece('box',[-w/2+(i+.5)*boardWidth,h+.58,sz*(railZ-.145)],[boardWidth-.02,.76,.11],'wood','bridge-covered-side-board',deck);
 }
 return a.finish();
}
