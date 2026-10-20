import {Architect} from '../blueprint';
import {woodenBarrel} from './barrel';
import {woodenCrate} from './crate';
import {placeObject} from '../objectProps';
import type {GrammarContext,V3,SurfaceMaterial} from '../types';

export function watermill(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth,h=p.height,u=h/5,base=.40*u;
 const box=(position:V3,size:V3,material:SurfaceMaterial,role:string,support='ground',rotation?:V3)=>a.piece('box',position,size,material,role,support,rotation);
 const house=a.building(w*.12,d*.03,w*.60,d*.60,h*.62,1,{base,material:'plaster',roof:p.roof==='auto'?'gable':p.roof,role:'watermill-house'});
 const roof=a.plan.roofs[0],eave=base+house.height;
 roof.rise=h*(.23+p.roofPitch*.17);roof.ridgeRatio=.5;
 for(const wall of a.plan.walls)if(wall.gable)wall.gable={peak:roof.rise,ratio:.5};
 a.plan.openings=[];
 const opening=(wall:number,kind:'door'|'window',offset:number,bottom:number,width:number,height:number)=>a.plan.openings.push({id:house.id+'_watermill_'+wall+'_'+kind,wall:house.id+'_wall_'+wall,kind,offset,bottom,width,height});
 opening(0,'door',-house.width*.22,0,1.1*u,Math.min(2.15*u,house.height*.75));
 opening(0,'window',house.width*.24,house.height*.36,1.08*u,1.1*u);
 opening(3,'window',-house.depth*.28,house.height*.43,1.0*u,1.08*u);
 opening(1,'window',0,house.height*.40,1.0*u,1.08*u);
 const front=house.z-house.depth/2,back=house.z+house.depth/2,left=house.x-house.width/2;
 const doorX=house.x-house.width*.22;
 const stair=a.plan.pieces.find(piece=>piece.kind==='stairs');
 const stairFrom:V3=[doorX,0,front-1.9*u],stairTo:V3=[doorX,base,front];
 if(stair){
  stair.position=stairFrom;stair.end=stairTo;stair.size=[1.55*u,base,1.9*u];
  const access=a.plan.accesses.find(access=>access.role==='stairs')!;
  access.from=stairFrom;access.to=stairTo;access.width=1.55*u;
 }else a.stairs(stairFrom,stairTo,1.55*u);
 for(const z of [front-.10*u,back+.10*u]){
  a.beam([house.x,base,z],[house.x,eave+roof.rise,z],.22*u,'wood','watermill-gable-post');
  for(const side of [-1,1])a.beam([house.x,eave+.06*u,z],[house.x+side*house.width*.35,eave+roof.rise*.30,z],.17*u,'wood','watermill-gable-brace');
 }
 for(const side of [-1,1])for(const end of [-1,1]){
  const x=house.x+side*house.width/2,z=house.z+end*house.depth/2;
  box([x,base+.24*u,z],[.325,.12*u,.325],'metal','watermill-post-band');
  box([x+side*.176,base+.24*u,z],[.035,.042,.042],'metal','watermill-bolt','ground',[0,side*Math.PI/2,0]);
 }
 const masonry=(position:V3,size:V3)=>box(position,size,'stone','watermill-masonry');
 const foundation=a.plan.pieces.find(piece=>piece.role==='foundation')!;
 foundation.size=[house.width+.35*u,base,house.depth+.35*u];
 const radius=Math.min(h*.29,d*.19),wheelWidth=radius*.62,wheelX=left-wheelWidth/2-.50*u,wheelZ=house.z-house.depth*.16,wheelY=radius+.14*u;
 const channelW=wheelWidth+.36*u,channelL=d*1.05;
 box([wheelX,.20*u,house.z],[channelW+.48*u,.40*u,channelL],'stone','watermill-channel-base');
 box([wheelX,.185*u,house.z],[channelW,.018*u,channelL-.24*u],'water','watermill-channel-water');
 const pierX=wheelX-wheelWidth/2-.34*u;
 masonry([pierX,.13*u,wheelZ],[.51*u,.26*u,.61*u]);
 box([pierX,(wheelY+.26*u)/2,wheelZ],[.34*u,wheelY-.26*u,.46*u],'stone','watermill-pier');
 masonry([pierX,wheelY+.055*u,wheelZ],[.43*u,.11*u,.54*u]);
 const axleLeft=pierX-.16*u,axleRight=left+.22*u;
 a.piece('column',[(axleLeft+axleRight)/2,wheelY,wheelZ],[.19*u,axleRight-axleLeft,.19*u],'metal','watermill-axle');
 const nail=(position:V3,rotation:V3,size=.045*u)=>a.piece('box',position,[size,size*.48,size],'metal','watermill-bolt','ground',rotation);
 for(const side of [-1,1]){
  const x=wheelX+side*wheelWidth/2;
  for(let i=0;i<16;i++){
   const angle=i*Math.PI/8;
   a.piece('column',[x,wheelY,wheelZ],[radius*1.88,radius*.18,.11*u],'wood','watermill-wheel-rim','ground',[angle,0,0]);
   nail([x+side*.068*u,wheelY+Math.cos(angle)*radius*.855,wheelZ+Math.sin(angle)*radius*.855],[0,side*Math.PI/2,0]);
  }
  for(let i=0;i<8;i++){
   const angle=i*Math.PI/4;
   a.beam([x,wheelY+Math.cos(angle)*radius*.12,wheelZ+Math.sin(angle)*radius*.12],[x,wheelY+Math.cos(angle)*radius*.85,wheelZ+Math.sin(angle)*radius*.85],.15*u,'wood','watermill-wheel-spoke');
  }
 }
 for(let i=0;i<16;i++){
  const angle=i*Math.PI/8;
  box([wheelX,wheelY+Math.cos(angle)*radius*.965,wheelZ+Math.sin(angle)*radius*.965],[wheelWidth+.10*u,.15*u,.32*u],'wood','watermill-wheel-paddle','ground',[angle,0,0]);
  for(const side of [-1,1])nail([wheelX+side*wheelWidth*.36,wheelY+Math.cos(angle)*(radius*.965+.085*u),wheelZ+Math.sin(angle)*(radius*.965+.085*u)],[angle-Math.PI/2,0,0],.035*u);
 }
 a.piece('column',[wheelX,wheelY,wheelZ],[radius*.37,wheelWidth+.24*u,radius*.37],'wood','watermill-wheel-hub');
 box([pierX-.19*u,wheelY,wheelZ],[.07*u,.32*u,.32*u],'metal','watermill-bearing');
 nail([pierX-.235*u,wheelY,wheelZ],[0,-Math.PI/2,0],.095*u);
 const barrelX=house.x+house.width*.32;
 placeObject(a.plan,woodenBarrel({...c,config:{...p,type:'woodenBarrel',width:.70*u,depth:.70*u,height:.94*u}}),'mill_barrel',[barrelX,0,front-.62*u]);
 placeObject(a.plan,woodenCrate({...c,config:{...p,type:'woodenCrate',width:.78*u,depth:.68*u,height:.71*u}}),'mill_crate',[barrelX-.94*u,0,front-.62*u]);
 return a.finish();
}
