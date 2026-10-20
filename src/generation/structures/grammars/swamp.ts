import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

/** A fishing hut raised above marsh water, with a clear entrance and tied timberwork. */
export function swamp(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.045)*.76,d=a.value(p.depth,.045)*.72;
 const base=2.05,h=Math.max(3.10,Math.min(3.8,p.height*.72)),front=-d/2,back=d/2;
 const v=a.building(0,0,w,d,h,1,{base,material:'wood',roof:'thatch',door:false,role:'stilt-house'});
 const foundation=a.plan.pieces.find(piece=>piece.role==='foundation')!,roof=a.plan.roofs[0];
 const deckW=w+1.0,deckFront=front-1.75,deckBack=back+.35,deckD=deckBack-deckFront,deckY=base+.12;
 foundation.material='wood';foundation.position=[0,base-.12,(deckFront+deckBack)/2];foundation.size=[deckW,.22,deckD];
 for(const piece of a.plan.pieces)if(piece.role==='floor'||piece.role==='facade-brace')piece.removed=true;
 a.plan.openings=[];
 const doorX=-w*.13;
 a.plan.openings.push({id:'swamp-door',wall:v.id+'_wall_0',kind:'door',offset:doorX,width:1.12,bottom:0,height:2.05});
 a.plan.openings.push({id:'swamp-window',wall:v.id+'_wall_1',kind:'window',offset:0,width:.92,bottom:1.05,height:.86});
 a.plan.openings.push({id:'swamp-left-window',wall:v.id+'_wall_3',kind:'window',offset:0,width:.92,bottom:1.05,height:.86});
 a.plan.openings.push({id:'swamp-back-window',wall:v.id+'_wall_2',kind:'window',offset:w*.12,width:.75,bottom:1.10,height:.80});
 // The ridge runs across the facade, leaving the door under a long straw eave.
 roof.width=d;roof.depth=w;roof.ridgeRatio=.5;roof.rotationY=Math.PI/2;roof.rise=d*.46;roof.eaves=.62;roof.plainEdge=true;
 for(const wall of a.plan.walls){delete wall.gable;if(wall.id.endsWith('_1')||wall.id.endsWith('_3'))wall.gable={peak:roof.rise,ratio:.5};}
 const wrap=(at:V3,width:number,support:string,rotation?:V3)=>{
  for(let i=0;i<3;i++)a.piece('box',[at[0],at[1]+i*.06,at[2]],[width+.12,.045,width+.12],'thatch','swamp-rope-wrap',support,rotation);
 };
 const piles:string[]=[];
 const pile=(x:number,z:number,railing=false)=>{
  const id=a.beam([x,-.08,z],[x,base-.03,z],.38,'wood','stilt');piles.push(id);
  a.piece('box',[x,.20,z],[.50,.50,.50],'stone','swamp-pile-foot',id);
  wrap([x,.64,z],.38,id);wrap([x,base-.38,z],.38,id);
  if(railing){const post=a.beam([x,base-.02,z],[x,deckY+.95,z],.38,'wood','swamp-rail-post',id);wrap([x,deckY+.68,z],.38,post);}
  return id;
 };
 const left=-deckW/2+.13,right=deckW/2-.13,railFront=deckFront+.13,railBack=deckBack-.13;
 const entranceLeft=doorX-.88,entranceRight=doorX+.88;
 for(const x of [left,entranceLeft,entranceRight,right])pile(x,railFront,true);
 for(const x of [left,right]){pile(x,railBack);pile(x,0);}
 a.depend(foundation.id,piles,4);
 const boardCount=Math.ceil(deckD/.25);
 for(let i=0;i<boardCount;i++)a.piece('box',[0,base+.055,deckFront+(i+.5)*deckD/boardCount],[deckW,.13,deckD/boardCount-.012],'wood','swamp-deck-plank',foundation.id);
 for(const x of [left,right])a.beam([x,base-.22,deckFront],[x,base-.22,deckBack],.25,'wood','swamp-deck-joist',foundation.id);
 for(const z of [railFront,0,railBack])a.beam([left-.15,base-.22,z],[right+.15,base-.22,z],.27,'wood','swamp-deck-frame',foundation.id);
 const rail=(from:V3,to:V3)=>{for(const y of [.38,.73])a.beam([from[0],deckY+y,from[2]],[to[0],deckY+y,to[2]],.12,'wood','swamp-rail-bar',foundation.id);};
 rail([left,0,railFront],[entranceLeft,0,railFront]);rail([entranceRight,0,railFront],[right,0,railFront]);
 for(const x of [left,right])rail([x,0,railFront],[x,0,front-.15]);
 // Braces support the deck below the walkway, rather than crossing the entrance.
 for(const x of [left,right])for(const z of [railFront,railBack])a.beam([x,.75,z],[x,base-.20,z+(z<0?.8:-.8)],.19,'wood','swamp-pile-brace',foundation.id);
 for(const x of [left,right]){
  a.beam([x,.65,0],[x,base-.18,railBack-.25],.19,'wood','swamp-underfloor-brace',foundation.id);
  a.beam([x,base-.18,0],[x,.65,railBack-.25],.19,'wood','swamp-underfloor-brace',foundation.id);
 }
 const stairRun=2.25;
 const stair=a.stairs([doorX,.03,deckFront-stairRun],[doorX,deckY,deckFront],1.50);
 a.plan.pieces.find(piece=>piece.id===stair)!.role='swamp-stone-stairs';
 const roofY=(z:number)=>roof.y+roof.rise*(1-Math.abs(z)/(d/2));
 for(const x of [-w/2-.66,w/2+.66])for(const side of [-1,1]){
  const z=side*(d/2+.66);
  a.beam([x,roofY(z)+.25,z],[x,roof.y+roof.rise+.52,0],.29,'wood','swamp-roof-rafter',roof.id);
 }
 const ridge=a.beam([-w/2-.92,roof.y+roof.rise+.69,0],[w/2+.92,roof.y+roof.rise+.69,0],.28,'wood','swamp-ridge-log',roof.id);
 for(const x of [-w/2-.60,w/2+.60]){
  a.beam([x,roof.y+roof.rise+.30,0],[x,roof.y+roof.rise+1.0,0],.27,'wood','swamp-ridge-post',ridge);
 }
 // The plank awning extends beyond the straw fringe, with clearance above the door frame.
 const coverY=base+2.215,coverZ=front-.44,coverAngle=-.28,coverDepth=1.02;
 const doorCover=a.piece('box',[doorX,coverY-.085,coverZ],[1.72,.065,coverDepth],'wood','swamp-door-canopy',foundation.id,[coverAngle,0,0]);
 for(let i=0;i<7;i++)a.piece('box',[doorX+(i-3)*.25,coverY,coverZ],[.242,.10,coverDepth+(i%3-1)*.035],'wood','swamp-door-canopy-plank',doorCover,[coverAngle,0,0]);
 a.beam([doorX-.65,base+.96,front-.26],[doorX-.65,base+2.24,front-.26],.02,'thatch','swamp-net',doorCover);
 for(let i=0;i<3;i++)a.piece('box',[doorX-.65,base+1.15+i*.29,front-.30],[.15,.28,.055],'cloth','swamp-fish',doorCover,[0,0,(i-1)*.12]);
 for(const sx of [-1,1])a.beam([doorX+sx*.70,base+1.78,front-.12],[doorX+sx*.70,base+2.06,front-.78],.10,'wood','swamp-door-canopy-brace',doorCover);
 for(const side of [-1,1])a.piece('box',[side*(w/2+.30),base+2.23,0],[.62,.09,1.18],'wood','swamp-window-hood',foundation.id,[0,0,-side*.22]);
 for(const x of [-w/2,w/2])for(const z of [front,back]){wrap([x,base+.28,z],.30,foundation.id);wrap([x,base+1.48,z],.30,foundation.id);}
 for(const x of [-w/2-.13,w/2+.13])for(const y of [base+.70,base+2.26])a.beam([x,y,front+.17],[x,y,back-.17],.12,'wood','swamp-wall-bar',foundation.id);
 // Fishing gear stays clear of the door and of the stair landing.
 const barrel=a.piece('box',[w*.29,deckY+.43,front-.62],[.67,.86,.67],'wood','swamp-barrel',foundation.id);
 for(const yy of [.13,.72])a.piece('box',[w*.29,deckY+yy,front-.62],[.66,.075,.66],'metal','fortress-barrel-hoop',barrel);
 a.piece('box',[w*.29,deckY+.86,front-.62],[.53,.045,.53],'wood','fortress-barrel-lid',barrel);
 const crateX=w*.29+.77;
 const crate=a.piece('box',[crateX,deckY+.29,front-.65],[.58,.58,.56],'wood','swamp-crate',foundation.id);
 for(const x of [-.25,.25])a.piece('box',[crateX+x,deckY+.29,front-.946],[.07,.59,.05],'wood','swamp-crate-frame',crate);
 a.beam([crateX-.25,deckY+.05,front-.98],[crateX+.25,deckY+.52,front-.98],.06,'wood','swamp-crate-brace',crate);
 const netX=(entranceRight+right)/2,netW=Math.min(.95,right-entranceRight-.10),netZ=railFront-.10;
 if(netW>.2)for(let row=0;row<6;row++)for(let column=0;column<5;column++){
  const x=netX-netW/2+column*netW/5,y=deckY+.57-row*.19,z=netZ-Math.sin(row*.7)*.05;
  a.beam([x,y,z],[x+netW/5,y-.19,netZ-Math.sin((row+1)*.7)*.05],.025,'thatch','swamp-net',foundation.id);
  a.beam([x+netW/5,y,z],[x,y-.19,netZ-Math.sin((row+1)*.7)*.05],.025,'thatch','swamp-net',foundation.id);
 }
 a.piece('cloth',[(left+entranceLeft)/2,deckY+.28,railFront-.10],[Math.min(.65,entranceLeft-left-.1),.98,.035],'cloth','swamp-cloth',foundation.id);
 const mossRnd=c.streams.streamFor('swamp-details','moss');
 for(let i=0;i<12;i++){
  const x=(mossRnd()-.5)*(w+1.0),z=(i%2?-1:1)*(d/2+.65),length=.18+mossRnd()*.43;
  a.piece('cloth',[x,roofY(z)+.20-length/2,z],[.08+mossRnd()*.08,length,.025],'wood','swamp-hanging-moss',roof.id);
 }
 for(let i=0;i<18;i++){
  const x=-deckW/2+mossRnd()*deckW,z=i%2?deckFront-.025:deckBack+.025,length=.24+mossRnd()*.62;
  a.piece('cloth',[x,base-length/2,z],[.10+mossRnd()*.11,length,.04],'wood','swamp-hanging-moss',foundation.id);
 }
 for(let cluster=0;cluster<4;cluster++){
  const x=(cluster%2?-1:1)*(deckW/2+.65),z=(cluster<2?deckFront-.45:deckBack+.45);
  a.piece('box',[x,.035,z],[.80,1.70,.80],'wood','swamp-reed-clump');
  a.piece('box',[x,.055,z-.35],[.65,.025,.65],'wood','swamp-lily-pad');
  if(cluster%2===0)a.piece('box',[x,.075,z-.35],[.3,.05,.3],'wood','swamp-water-flower');
 }
 for(let i=0;i<18;i++){
  const x=(mossRnd()-.5)*(deckW+3),z=(mossRnd()-.5)*(deckD+3)+(deckFront+deckBack)/2;
  a.piece('box',[x,.048,z],[.40,.01,.40],'wood','swamp-duckweed');
 }
 a.plan.propZones.push({id:'swamp-water',x:0,z:(deckFront-stairRun+deckBack)/2,width:deckW+4,depth:deckD+stairRun+3,y:.02,kind:'water'});
 return a.finish();
}
