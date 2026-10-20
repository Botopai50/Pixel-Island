import {Architect} from '../blueprint';
import type {GrammarContext,V3,VolumeSpec} from '../types';

/** Six square piers support a broad paved terrace and its small rooftop shrine. */
export function ancientTemple(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.025),d=a.value(p.depth,.025),h=a.value(p.height,.025)*.76,u=h/5.32,base=1.05*u;
 const stone=(at:V3,size:V3,role:string,support='ground',rotation?:V3)=>a.piece('box',at,size,'stone',role,support,rotation);
 const platform=stone([0,base/2,0],[w+1.12*u,base,d+1.0*u],'temple-platform');
 for(let tier=0;tier<3;tier++)stone([0,(tier+.5)*base/3,0],[w+(1.12-tier*.32)*u,base/3,d+(1.0-tier*.28)*u],'temple-platform-course',platform);
 const room:VolumeSpec={id:'volume_0',x:0,z:d*.08,width:w*.88,depth:d*.66,bottom:base,height:h,floors:1,role:'sanctuary'};
 a.plan.volumes.push(room,{id:'volume_1',x:0,z:-d*.34,width:w*.88,depth:d*.20,bottom:base,height:h,floors:1,role:'portico'});
 const walls=(v:VolumeSpec,support:string)=>{
  const corners:V3[]=[[v.x-v.width/2,v.bottom,v.z-v.depth/2],[v.x+v.width/2,v.bottom,v.z-v.depth/2],[v.x+v.width/2,v.bottom,v.z+v.depth/2],[v.x-v.width/2,v.bottom,v.z+v.depth/2]];
  for(let i=0;i<4;i++){const id=v.id+'_wall_'+i;a.plan.walls.push({id,volume:v.id,start:corners[i],end:corners[(i+1)%4],bottom:v.bottom,height:v.height,thickness:.28*u,material:'stone'});a.plan.supports.push({component:id,on:support});}
 };
 walls(room,platform);
 a.plan.openings.push({id:'temple-main-door',wall:room.id+'_wall_0',kind:'door',offset:0,width:Math.min(1.6*u,w*.22),bottom:0,height:h*.64});
 const columnWidth=Math.min(.74*u,w*.055),front=-d*.43,back=room.z+room.depth/2;
 const glyph=(x:number,y:number,z:number,width:number,height:number,support:string,rotation=Math.PI)=>stone([x,y,z],[width,height,.018*u],'temple-glyph',support,[0,rotation,0]);
 const pier=(x:number,z:number,bottom:number,height:number,width:number,support:string,role:string)=>{
  const foot=stone([x,bottom+.12*u,z],[width*1.65,.24*u,width*1.65],'temple-column-base',support);
  stone([x,bottom+.34*u,z],[width*1.34,.20*u,width*1.34],'temple-column-base',foot);
  const lo=bottom+.44*u,hi=bottom+height-.57*u,shaft=stone([x,(lo+hi)/2,z],[width,hi-lo,width],role,foot);
  for(const side of [-1,1]){
   stone([x+side*width*.27,(lo+hi)/2,z-width/2-.018*u],[.065*u,hi-lo-.04*u,.035*u],'temple-column-flute',shaft);
   stone([x-width/2-.018*u,(lo+hi)/2,z+side*width*.27],[.035*u,hi-lo-.04*u,.065*u],'temple-column-flute',shaft);
  }
  for(const [off,factor,tall] of [[.45,1.16,.22],[.23,1.40,.22],[.06,1.66,.12]])stone([x,bottom+height-off*u,z],[width*factor,tall*u,width*factor],'capital',shaft);
  glyph(x,bottom+height-.25*u,z-width*.70-.01*u,width,.16*u,shaft);return shaft;
 };
 const columns:string[]=[];for(let i=0;i<6;i++)columns.push(pier(-w*.44+i*w*.88/5,front,base,h,columnWidth,platform,'temple-column'));
 for(const side of [-1,1])for(const z of [room.z-room.depth/2,back])pier(side*(room.width/2+.015*u),z,base,h,columnWidth,platform,'temple-wall-pier');
 const terrace=base+h+.68*u,roofId='temple-terrace';
 a.plan.roofs.push({id:roofId,volume:room.id,x:0,z:0,width:w,depth:d,y:terrace-.25*u,rise:0,eaves:.30*u,kind:'flat',material:'stone',flatThickness:.25*u,plainEdge:true});
 const frieze=(x:number,z:number,length:number,axis:0|2)=>{
  const id=stone([x,base+h+.27*u,z],axis===0?[length,.54*u,.64*u]:[.64*u,.54*u,length],'entablature',platform);
  stone([x,base+h+.60*u,z],axis===0?[length+.20*u,.12*u,.86*u]:[.86*u,.12*u,length+.20*u],'temple-frieze-cap',id);
  stone([x,base+h-.04*u,z],axis===0?[length+.12*u,.10*u,.76*u]:[.76*u,.10*u,length+.12*u],'temple-frieze-base',id);
  const count=Math.max(3,Math.ceil(length/(.78*u))),outside=Math.sign(axis===0?z:x);
  for(let i=0;i<count;i++)glyph(x+(axis===0?-length/2+(i+.5)*length/count:outside*.326*u),base+h+.27*u,z+(axis===2?-length/2+(i+.5)*length/count:outside*.326*u),Math.min(.60*u,length/count*.8),.36*u,id,axis===0?(outside<0?Math.PI:0):(outside<0?-Math.PI/2:Math.PI/2));return id;
 };
 const beam=frieze(0,front,w+.34*u,0);a.depend(beam,columns,4);frieze(0,back,w+.34*u,0);for(const side of [-1,1])frieze(side*w*.44,(front+back)/2,back-front,2);
 a.depend(roofId,[platform,beam],2);
 const paving=(x:number,z:number,width:number,depth:number,y:number,support:string,role:string)=>{
  const nx=Math.max(3,Math.ceil(width/(.95*u))),nz=Math.max(3,Math.ceil(depth/(.95*u)));
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)stone([x-width/2+(i+.5)*width/nx,y+.07*u,z-depth/2+(j+.5)*depth/nz],[width/nx-.014*u,.14*u,depth/nz-.014*u],role,support);
 };
 paving(0,0,w+.58*u,d+.58*u,terrace,roofId,'temple-terrace-paver');paving(0,0,w,d,base,platform,'temple-floor-paver');
 for(const side of [-1,1]){
  stone([side*(w/2-.12*u),terrace+.32*u,d*.18],[.28*u,.36*u,d*.50],'terrace-cornice',roofId);
  for(const z of [-d*.07,d*.43])stone([side*(w/2-.12*u),terrace+.39*u,z],[.47*u,.50*u,.47*u],'temple-parapet-post',roofId);
 }
 stone([0,terrace+.32*u,d*.43],[w,.36*u,.28*u],'terrace-cornice',roofId);
 for(const side of [-1,1])for(const z of [d*.01,d*.25]){
  const x=side*(room.width/2+.15*u),y=base+h*.48,height=h*.29;
  a.piece('box',[x,y,z],[.02*u,height,.27*u],'dark','temple-blind-recess',platform);
  for(const edge of [-1,1])stone([x+side*.035*u,y,z+edge*.24*u],[.14*u,height+.20*u,.18*u],'temple-relief-frame',platform);
  for(const edge of [-1,1]){stone([x+side*.035*u,y+edge*(height/2+.12*u),z],[.15*u,.24*u,.68*u],'temple-relief-frame',platform);glyph(x+side*.12*u,y+edge*(height/2+.12*u),z,.56*u,.18*u,platform,side<0?-Math.PI/2:Math.PI/2);}
 }
 const upper:VolumeSpec={id:'volume_2',x:0,z:d*.19,width:w*.43,depth:d*.30,bottom:terrace+.14*u,height:2.30*u,floors:1,role:'upper-shrine'};a.plan.volumes.push(upper);walls(upper,roofId);
 a.plan.openings.push({id:'temple-shrine-door',wall:upper.id+'_wall_0',kind:'door',offset:0,width:Math.min(1.12*u,upper.width*.30),bottom:0,height:1.96*u});
 const upperRoof='temple-shrine-roof',upperTop=upper.bottom+upper.height;
 a.plan.roofs.push({id:upperRoof,volume:upper.id,x:upper.x,z:upper.z,width:upper.width,depth:upper.depth,y:upperTop-.05*u,rise:0,eaves:.24*u,kind:'flat',material:'stone',flatThickness:.20*u,plainEdge:true});a.depend(upperRoof,[upper.id+'_wall_0',upper.id+'_wall_2'],2);
 paving(0,upper.z,upper.width+.48*u,upper.depth+.48*u,upperTop+.15*u,upperRoof,'temple-shrine-paver');
 for(const side of [-1,1])for(const z of [upper.z-upper.depth/2,upper.z+upper.depth/2])pier(side*(upper.width/2-.06*u),z,upper.bottom,upper.height,.40*u,roofId,'temple-upper-pier');
 const ivy=(at:V3,length:number,support:string,angle=Math.PI)=>{if(p.vegetation>.02)a.piece('cloth',at,[.32*u,length*(.5+p.vegetation),.30*u],'cloth','temple-ivy',support,[0,angle,0]);};
 for(const side of [-1,1]){
  ivy([side*(w*.44+.38*u),terrace,-d*.38],h*.85,beam,side*Math.PI/2);ivy([side*(room.width/2+.18*u),terrace,d*.16],h*.72,roofId,side*Math.PI/2);ivy([side*(upper.width/2+.10*u),upperTop,upper.z-upper.depth/2-.17*u],upper.height*.8,roofId);
  a.plan.propZones.push({id:'temple-garden-'+side,x:side*(w/2+.65*u),z:0,width:1.3*u,depth:d+1.6*u,y:0,kind:'garden'});
 }
 const stairFront=-d/2-.50*u,run=2.9*u,stairWidth=w*.56,steps=6;
 for(let i=0;i<steps;i++){
  const top=(base+.14*u)*(i+1)/steps,depth=run*(steps-i)/steps,count=Math.max(3,Math.ceil(stairWidth/(.9*u)));
  for(let j=0;j<count;j++)stone([-stairWidth/2+(j+.5)*stairWidth/count,top/2,stairFront-depth/2],[stairWidth/count-.014*u,top,depth],'temple-entry-step','ground');
 }
 a.plan.accesses.push({id:'temple-entry',from:[0,0,stairFront-run],to:[0,base+.14*u,stairFront],width:stairWidth,role:'stairs'});
 return a.finish();
}
