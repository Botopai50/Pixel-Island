import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

/** Timber cottage beside a living trunk, on a braced observation deck. */
export function treehouse(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.06),d=a.value(p.depth,.06),y=a.value(p.height*.65,.05),tx=-w*.12,tz=d*.12;
 const tree=a.piece('tree',[tx,0,tz],[w*.8,y+6.3,d*.8],'wood','living-tree');
 // Individual planks and a closed perimeter rim, leaving the trunk's footprint free.
 const deck=a.piece('box',[0,y-.12,0],[w,.24,d],'wood','tree-platform',tree);
 const pitch=.27,n=Math.ceil(d/pitch);
 for(let i=0;i<n;i++){const z=-d/2+(i+.5)*d/n;const half=.90,near=Math.abs(z-tz)<half;
  if(near){for(const [left,right] of [[-w/2,tx-half],[tx+half,w/2]])if(right>left)a.piece('box',[(left+right)/2,y+.035,z],[right-left,.10,d/n-.015],'wood','tree-deck-plank',deck);}
  else a.piece('box',[0,y+.035,z],[w,.10,d/n-.015],'wood','tree-deck-plank',deck);
 }
 const home=a.building(w*.26,-d*.08,w*.46,d*.61,3.15,1,{base:y+.09,material:'plaster',roof:p.roof==='auto'?'gable':p.roof,role:'tree-cabin'});
 const roof=a.plan.roofs[0];roof.material='roof';roof.ridgeRatio=.5;
 if(roof.kind==='gable'||roof.kind==='thatch')roof.rise=Math.max(1.65,roof.rise);
 for(const wall of a.plan.walls)if(wall.gable){wall.gable.ratio=.5;wall.gable.peak=roof.rise;}
 for(const item of a.plan.pieces.filter(x=>x.role==='foundation')){item.size[1]=.12;item.position[1]=y+.04;item.material='wood';item.support=deck;a.depend(item.id,[deck]);}
 for(const item of a.plan.pieces)if(item.kind==='stairs')item.removed=true;
 a.plan.accesses=[];
 // Explicit windows keep the lower and attic openings clear of the entry canopy.
 a.plan.openings=a.plan.openings.filter(o=>o.kind==='door');
 const door=a.plan.openings[0];door.offset=home.width*.22;door.arched=true;door.width=Math.min(1.1,home.width*.32);door.height=2.3;
 a.plan.openings.push({id:home.id+'_front-window',wall:home.id+'_wall_0',kind:'window',offset:-home.width*.24,width:Math.min(.9,home.width*.25),bottom:1.12,height:1.1});
 if(roof.kind==='gable'||roof.kind==='thatch')a.plan.openings.push({id:home.id+'_attic-window',wall:home.id+'_wall_0',kind:'window',offset:0,width:.65,bottom:home.height+.18,height:.65});
 for(const side of [1,3])a.plan.openings.push({id:home.id+'_side-window_'+side,wall:home.id+'_wall_'+side,kind:'window',offset:0,width:.95,bottom:1.1,height:1.1});
 a.chimney(home);const shift=home.width*.53;for(const piece of a.plan.pieces)if(piece.role.startsWith('chimney'))piece.position[0]-=shift;
 const front=home.z-home.depth/2,ex=home.x+door.offset,coverZ=front-.36,coverY=y+2.65,pitchAngle=-.23;
 a.piece('box',[ex,coverY,coverZ],[1.6,.13,1.0],'roof','tree-entry-cover',deck,[pitchAngle,0,0]);
 for(const side of [-1,1])a.beam([ex+side*.87,coverY-.12,front-.86],[ex+side*.87,coverY+.10,front+.15],.16,'wood','tree-entry-rafter',deck);
 a.beam([ex-.87,coverY-.12,front-.86],[ex+.87,coverY-.12,front-.86],.17,'wood','tree-entry-fascia',deck);
 for(const side of [-1,1])a.beam([ex+side*.66,y+2.05,front-.03],[ex+side*.66,coverY-.10,front-.65],.12,'wood','tree-entry-brace',deck);
 // Four timber piers with collars and a solid diagonal connection to the deck.
 const xs=[-w*.40,w*.40],zs=[-d*.39,d*.39];
 for(const x of xs)for(const z of zs){const foot=a.piece('box',[x,.18,z],[.62,.36,.62],'stone','tree-pier-foot');const post=a.beam([x,.35,z],[x,y+.02,z],.32,'wood','tree-pier-post',foot);
  for(const yy of [.48,y*.62,y-.05])a.piece('box',[x,yy,z],[.38,.16,.38],'metal','tree-pier-collar',post);
  a.beam([x,y*.55,z],[tx,y-.20,tz],.24,'wood','tree-platform-brace',post);
 }
 for(const z of [-d/2,d/2])a.beam([-w/2,y-.16,z],[w/2,y-.16,z],.25,'wood','tree-platform-rim',deck);
 for(const x of [-w/2,w/2])a.beam([x,y-.16,-d/2],[x,y-.16,d/2],.25,'wood','tree-platform-rim',deck);
 const ladderX=-w*.23,entryWidth=1.25,topZ=-d/2+.12,bottomZ=topZ-Math.max(2.2,y*.60),top=y+.10;
 for(const side of [-1,1])a.beam([ladderX+side*entryWidth/2,.12,bottomZ-.10],[ladderX+side*entryWidth/2,top,topZ],.17,'wood','tree-ladder-rail',deck);
 const steps=Math.ceil(y/.31);
 for(let i=1;i<=steps;i++){const t=i/steps;a.piece('box',[ladderX,top*t-.05,bottomZ+(topZ-bottomZ)*t],[entryWidth,.10,.30],'wood','tree-ladder-rung',deck);}
 a.plan.accesses.push({id:'tree-ladder-access',from:[ladderX,0,bottomZ],to:[ladderX,top,topZ],width:entryWidth,role:'ladder'});
 const rail=(from:V3,to:V3)=>{const distance=Math.hypot(to[0]-from[0],to[2]-from[2]),count=Math.ceil(distance/1.25);
  for(const h of [.40,1.0])a.beam([from[0],y+h,from[2]],[to[0],y+h,to[2]],.12,'wood','tree-rail',deck);
  for(let i=0;i<=count;i++){const t=i/count,x=from[0]+(to[0]-from[0])*t,z=from[2]+(to[2]-from[2])*t;a.beam([x,y-.10,z],[x,y+1.09,z],.19,'wood','tree-rail-post',deck);a.piece('box',[x,y+1.11,z],[.25,.09,.25],'wood','tree-rail-cap',deck);a.piece('box',[x,y-.12,z],[.27,.20,.27],'metal','tree-rail-shoe',deck);}
 };
 rail([-w/2,y,-d/2],[ladderX-entryWidth/2-.10,y,-d/2]);rail([ladderX+entryWidth/2+.10,y,-d/2],[w/2,y,-d/2]);rail([-w/2,y,d/2],[w/2,y,d/2]);
 rail([-w/2,y,-d/2],[-w/2,y,d/2]);
 rail([w/2,y,-d/2],[w/2,y,home.z-home.depth/2-.12]);rail([w/2,y,home.z+home.depth/2+.12],[w/2,y,d/2]);
 const planter=(x:number,z:number,width:number)=>{const id=a.piece('box',[x,y+.22,z],[width,.36,.42],'wood','tree-planter',deck);a.piece('box',[x,y+.405,z],[width-.12,.03,.30],'earth','tree-planter-soil',id);for(const side of [-1,1])a.piece('box',[x+side*(width/2-.09),y+.25,z-.23],[.09,.42,.08],'wood','tree-planter-band',id);};
 planter(home.x-home.width*.24,front-.22,.85);planter(w*.30,d*.35,1.15);planter(-w*.36,-d*.41,.80);
 return a.finish();
}
