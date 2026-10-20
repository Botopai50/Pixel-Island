import {Architect} from '../blueprint';
import type {GrammarContext} from '../types';

/** A raised bank pavilion, an internal stair flight and a long, lower river span. */
export function steppedBridge(c:GrammarContext){
 const a=new Architect(c),p=c.config;
 const w=a.value(p.width,.025),d=a.value(p.depth,.02),h=a.value(p.height,.025),zRail=d/2-.08;
 const low=h*.72,high=low+Math.max(.8,h*.40);
 // Every change of slope has its own newels; the river span remains horizontal.
 const nodes:[number,number][]=[[-w*.50,low*.65],[-w*.43,low*.65],[-w*.29,high],[-w*.17,high],[-w*.02,low],[w*.15,low],[w*.32,low],[w*.46,.32],[w*.50,.32]];
 const roots:string[]=[],postIds:string[][]=[[],[]];
 const cap=(x:number,y:number,z:number,id:string)=>a.piece('box',[x,y+.06,z],[.43,.12,.43],'metal','bridge-post-cap',id);
 const collar=(x:number,y:number,z:number,id:string)=>a.piece('box',[x,y,z],[.42,.12,.42],'metal','bridge-post-shoe',id);
 const plate=(x:number,y:number,z:number,parent:string)=>{
  const id=a.piece('box',[x,y,z],[.32,.32,.045],'metal','bridge-joint-plate',parent);
  for(const xx of [-.09,.09])for(const yy of [-.09,.09])a.piece('box',[x+xx,y+yy,z+Math.sign(z)*.03],[.043,.043,.025],'metal','bridge-rivet',id);
 };
 // Solid stone under both approaches, but an open timber span over the water.
 for(let section=0;section<nodes.length-1;section++){
  const [x0,y0]=nodes[section],[x1,y1]=nodes[section+1],length=x1-x0,stairs=y0!==y1;
  const bank=section<=3||section>=6;
  const root=bank?a.piece('box',[(x0+x1)/2,.08,0],[length,.16,zRail*2],'stone','bridge-abutment'):a.piece('box',[(x0+x1)/2,Math.min(y0,y1)-.20,0],[length,.10,d-.12],'wood','deck');
  roots.push(root);
  const count=stairs?Math.max(2,Math.ceil(Math.abs(y1-y0)/.32)):Math.max(2,Math.ceil(length/.30)),pitch=length/count;
  for(let i=0;i<count;i++){
   const x=x0+(i+.5)*pitch,y=stairs?y0+(y1-y0)*(y1>y0?(i+1)/count:i/count):y0;
   let support=root;
   if(bank)support=a.piece('box',[x,Math.max(.08,y-.14)/2,0],[pitch,Math.max(.08,y-.14),zRail*2],'stone','bridge-stair-retaining-wall',root);
   a.piece('box',[x,y-.07,0],[pitch-.012,.14,d+.12],'wood',stairs?'bridge-stair-tread':'deck-plank',support);
   if(stairs&&!bank)a.piece('box',[x-pitch/2,y-.16,0],[.08,.24,d-.12],'wood','bridge-stair-riser',root);
  }
  if(stairs)a.plan.accesses.push({id:'stepped-flight-'+section,from:[x0,y0,0],to:[x1,y1,0],width:d,role:'stairs'});
  for(const sz of [-1,1]){
   const z=sz*zRail,role=stairs?'bridge-stair-stringer':'bridge-deck-girder';
   a.beam([x0,y0-.17,z],[x1,y1-.17,z],.23,'wood',role,root);a.plan.pieces.at(-1)!.size[1]=.36;
  }
 }
 // Tall posts at the upper landing, short posts at stair feet and full-height river piers.
 for(const [side,sz] of [-1,1].entries())for(let i=0;i<nodes.length;i++){
  const [x,y]=nodes[i],z=sz*zRail,overRiver=i>=4&&i<=6;
  const foot=a.piece('box',[x,.25,z],[.72,.50,.72],'stone','bridge-pier-foot');
  const pier=a.piece('box',[x,(.5+y-.10)/2,z],[.34,Math.max(.05,y-.60),.34],'wood','bridge-pier',foot);
  if(y>.8)collar(x,.62,z,pier);
  const post=a.piece('box',[x,y+.58,z],[.34,1.30,.34],'wood','bridge-rail-post',pier);postIds[side].push(post);
  cap(x,y+1.23,z,post);collar(x,y+.06,z,post);plate(x,y-.16,sz*(zRail+.18),post);
  if(overRiver){
   for(const dir of [-1,1]){
    const adjacent=nodes[i+dir];if(!adjacent)continue;
    const reach=Math.min(.95,Math.abs(adjacent[0]-x)*.45),xx=x+dir*reach;
    const yy=y+(adjacent[1]-y)*reach/Math.abs(adjacent[0]-x);
    a.beam([x,Math.max(.65,y*.44),z],[xx,yy-.34,z],.24,'wood','bridge-pier-brace',pier);
   }
  }
 }
 for(const [side,sz] of [-1,1].entries())for(let i=0;i<nodes.length-1;i++){
  const [x0,y0]=nodes[i],[x1,y1]=nodes[i+1],z=sz*zRail,slope=(y1-y0)/(x1-x0),inset=.17;
  const beam=(offset:number,width:number,role:string)=>a.beam([x0+inset,y0+offset+slope*inset,z],[x1-inset,y1+offset-slope*inset,z],width,'wood',role,postIds[side][i],{start:[1,0,0],end:[1,0,0]});
  beam(1.05,.21,y0===y1?'bridge-handrail':'bridge-stair-handrail');a.plan.pieces.at(-1)!.size[1]=.25;
  beam(.22,.17,'bridge-rail-sill');
  // Small vertical infill and triangular bracing follow the stair's slope.
  const count=Math.max(1,Math.floor((x1-x0)/1.3));
  for(let k=1;k<=count;k++){
   const t=k/(count+1),x=x0+(x1-x0)*t,y=y0+(y1-y0)*t;
   a.piece('box',[x,y+.62,z],[.15,.68,.16],'wood','bridge-baluster',postIds[side][i]);
   if(y0===y1)a.beam([x0+.23,y0+.95,z],[x-.08,y+.30,z],.16,'wood','bridge-rail-brace',postIds[side][i]);
  }
 }
 // The masonry below the raised bank stops at its pier; the water starts there.
 a.plan.propZones.push({id:'stream',x:(nodes[4][0]+nodes[6][0])/2,z:0,width:nodes[6][0]-nodes[4][0]-.18,depth:d+9,y:0,kind:'water'});
 if(p.vegetation>.15)for(const wall of a.plan.pieces.filter(piece=>piece.role==='bridge-stair-retaining-wall'))for(const side of [-1,1]){
  for(let i=0;i<Math.ceil(wall.size[1]*p.vegetation*2);i++)a.piece('rock',[wall.position[0]+Math.sin(i*1.7)*.08,.12+i*.22,side*(zRail+.035)],[.12,.14,.06],'wood','bridge-bank-ivy',wall.id);
 }
 for(const sx of [-1,1])for(const sz of [-1,1])a.plan.propZones.push({id:`bank-${sx}-${sz}`,x:sx*w*.44,z:sz*(d/2+.85),width:w*.18,depth:1.3,y:0,kind:'garden'});
 return a.finish();
}
