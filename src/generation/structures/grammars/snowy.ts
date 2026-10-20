import {Architect} from '../blueprint';
import type {GrammarContext} from '../types';

/** Alpine timber cabin, stone plinth and a usable attic under the steep roof. */
export function snowy(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.035),d=a.value(p.depth,.035),h=Math.max(2.9,Math.min(3.9,p.height*.82)),base=.95;
 const v=a.building(0,0,w,d,h,1,{base,material:'wood',roof:'gable',door:false,role:'alpine-home'}),roof=a.plan.roofs[0];
 const foundation=a.plan.pieces.find(piece=>piece.role==='foundation')!;
 foundation.size=[w-.02,base,d-.02];
 roof.ridgeRatio=.5;roof.rise=w*(.40+p.roofPitch*.17);roof.eaves=.55;
 for(const wall of a.plan.walls)if(wall.gable)wall.gable={peak:roof.rise,ratio:.5};
 a.plan.openings=[];
 a.plan.openings.push({id:'snowy-door',wall:v.id+'_wall_0',kind:'door',offset:0,width:1.18,bottom:0,height:2.15});
 for(const side of [1,3])a.plan.openings.push({id:'snowy-side-window-'+side,wall:v.id+'_wall_'+side,kind:'window',offset:-d*.12,width:.94,bottom:.85,height:.95,shutterAngles:[0,0]});
 const atticWidth=Math.min(.82,w*.20),atticHeight=Math.min(.94,roof.rise*.34),atticBottom=h+.32;
 for(const side of [0,2])a.plan.openings.push({id:'snowy-attic-window-'+side,wall:v.id+'_wall_'+side,kind:'window',offset:0,width:atticWidth,bottom:atticBottom,height:atticHeight,shutterAngles:[0,0]});
 // Continuous stone courses and raised corner stones carry the timber frame.
 for(const side of [-1,1]){
  a.piece('box',[side*(w/2+.14),base/2,0],[.28,base,d+.28],'stone','snowy-stone-plinth',foundation.id);
  a.piece('box',[0,base/2,side*(d/2+.14)],[w+.28,base,.28],'stone','snowy-stone-plinth',foundation.id);
 }
 for(const x of [-w/2,w/2])for(const z of [-d/2,d/2]){
  a.piece('box',[x,.60,z],[.59,1.20,.59],'stone','snowy-corner-stone',foundation.id);
  const post=a.plan.pieces.find(piece=>piece.role==='corner-post'&&piece.position[0]===x&&piece.position[2]===z);if(post)post.position[1]=1.20;
 }
 a.stairs([0,.025,-d/2-1.85],[0,base+.12,-d/2-.20],1.55);
 a.piece('box',[0,base+.06,-d/2-.10],[1.55,.12,.20],'stone','snowy-door-landing',foundation.id);
 for(const z of [-d/2-.11,d/2+.11]){
  const gableBar=a.beam([-w/2+.16,base+h+.12,z],[w/2-.16,base+h+.12,z],.22,'wood','snow-brace',foundation.id);
  for(const side of [-1,1]){
   a.beam([side*(w/2-.17),base+h+.20,z],[0,roof.y+roof.rise-.22,z],.24,'wood','snow-brace',gableBar);
   if(w>5)a.beam([side*w*.22,base+h+.20,z],[side*w*.10,base+h+.70,z],.13,'wood','snowy-attic-brace',gableBar);
  }
  const postBottom=base+atticBottom+atticHeight+.20;
  if(postBottom<roof.y+roof.rise-.15)a.beam([0,postBottom,z],[0,roof.y+roof.rise-.15,z],.16,'wood','snowy-gable-post',gableBar);
 }
 for(const z of [-d/2-.60,d/2+.60])a.piece('box',[0,roof.y+roof.rise+.30,z],[.28,.56,.29],'wood','snowy-ridge-finial',roof.id,[0,0,.14]);
 for(let i=0;i<6;i++)a.piece('box',[0,roof.y+roof.rise+.22,-d/2+(i+.5)*d/6],[.19,.32,.18],'wood','snowy-ridge-peg',roof.id,[0,0,.18]);
 // A chimney starts at the slope, with an open flue and separate stone rim.
 const chimneyX=-w*.22,chimneyZ=d*.12,slope=roof.rise/(w/2),chimneyBottom=roof.y+roof.rise-Math.abs(chimneyX)*slope-.12,chimneyTop=roof.y+roof.rise+1.02;
 const shaft=a.piece('box',[chimneyX,(chimneyBottom+chimneyTop)/2,chimneyZ],[.78,chimneyTop-chimneyBottom,.78],'stone','snowy-chimney',roof.id);
 a.piece('box',[chimneyX,chimneyTop+.02,chimneyZ],[.52,.05,.52],'dark','snowy-flue',shaft);
 for(const side of [-1,1]){
  a.piece('box',[chimneyX+side*.40,chimneyTop+.15,chimneyZ],[.18,.28,.98],'stone','snowy-chimney-rim',shaft);
  a.piece('box',[chimneyX,chimneyTop+.15,chimneyZ+side*.40],[.62,.28,.18],'stone','snowy-chimney-rim',shaft);
 }
 if(p.snow>.01){
  const rnd=c.streams.streamFor('snowy-details','ice');
  for(const side of [-1,1])for(let i=0;i<8;i++){
   if(rnd()>p.snow+.15)continue;
   const length=.16+rnd()*.46,z=-d/2-.40+(i+.3+rnd()*.4)*(d+.8)/8,y=roof.y-slope*roof.eaves-.10;
   a.piece('box',[side*(w/2+roof.eaves),y-length/2,z],[.06+rnd()*.04,length,.07],'plaster','snowy-icicle',roof.id);
  }
 }
 return a.finish();
}
