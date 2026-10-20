import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

/** A thick, walkable curtain wall with an optional stair at its right end. */
export function wall(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.025),h=a.value(p.height,.025),u=h/5,d=Math.max(.95*u,Math.min(3.2*u,p.depth*.50));
 const stone=(at:V3,size:V3,role:string,support='ground')=>a.piece('box',at,size,'stone',role,support);
 const body=stone([0,h/2,0],[w,h,d],'muralha');
 const walk=stone([0,h-.09*u,0],[w+.18*u,.18*u,d+.30*u],'walkway',body);
 const nx=Math.max(4,Math.ceil(w/(.85*u))),nz=Math.max(2,Math.ceil(d/(.85*u))),pavingTop=h+.12*u;
 for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)stone([-w/2+(i+.5)*w/nx,h+.06*u,-d/2+(j+.5)*d/nz],[w/nx-.012*u,.12*u,d/nz-.012*u],'wall-paver',walk);
 for(const side of [-1,1]){
  // The thin cornice sits beneath the merlons rather than cutting across the path.
  const count=Math.max(4,Math.ceil(w/(.80*u)));
  for(let i=0;i<count;i++)stone([-w/2+(i+.5)*w/count,h-.22*u,side*(d/2+.09*u)],[w/count-.01*u,.26*u,.28*u],'wall-cornice',body);
  const merlons=Math.max(4,Math.round(w/(1.28*u))),spacing=w/merlons,width=Math.min(.73*u,spacing*.58);
  for(let i=0;i<merlons;i++){
   const x=-w/2+(i+.5)*spacing,z=side*(d/2-.17*u);
   const sill=stone([x,pavingTop+.08*u,z],[width+.10*u,.16*u,.49*u],'wall-merlon-sill',walk);
   for(let course=0;course<2;course++)stone([x,pavingTop+.16*u+(course+.5)*.32*u,z],[width,.32*u-.012*u,.43*u],'battlement',sill);
  }
 }
 const bays=Math.max(2,Math.round(w/(3.25*u))),pillarWidth=.65*u;
 for(let i=0;i<=bays;i++)for(const side of [-1,1]){
  const x=-w/2+.26*u+i*(w-.52*u)/bays,z=side*(d/2+.12*u);
  let support=stone([x,.16*u,z],[.94*u,.32*u,.66*u],'wall-buttress-foot',body);
  const height=h-.52*u,count=Math.max(3,Math.ceil(height/(.70*u))),course=height/count;
  for(let j=0;j<count;j++)support=stone([x,.32*u+(j+.5)*course,z],[pillarWidth,course-.012*u,.48*u],'wall-buttress-block',support);
  stone([x,h-.11*u,z],[.92*u,.30*u,.70*u],'wall-buttress-cap',support);
  const ivyRnd=c.streams.streamFor('vegetation','wall-pillar-'+i+'-'+side);
  if(p.vegetation>.02&&(i===0&&side===-1||ivyRnd()<.62)){
   const start=h-(.18+ivyRnd()*.55)*u,length=h*(.22+ivyRnd()*.48)*(.65+p.vegetation);
   a.piece('cloth',[x+(ivyRnd()-.5)*pillarWidth*.75,start,side*(d/2+.39*u)],[(.24+ivyRnd()*.22)*u,Math.min(length,start-.20*u),.30*u],'cloth','wall-ivy',support,[0,side<0?Math.PI:0,0]);
  }
  if(p.vegetation>.02&&i<bays&&ivyRnd()<.35){
   const offset=(w-.52*u)/bays*(.28+ivyRnd()*.42),start=h-.26*u;
   a.piece('cloth',[x+offset,start,side*(d/2+.16*u)],[(.22+ivyRnd()*.13)*u,h*(.18+ivyRnd()*.30),.30*u],'cloth','wall-ivy',body,[0,side<0?Math.PI:0,0]);
  }
 }
 if (p.wallStairs !== false) {
  // The standalone wall keeps its original access stair.
  const run=h*1.02,end=w/2;
  if (p.wallStairSide) {
   // The wall's own stair, laid along one face of the wall: it climbs from the ground near this
   // end up to the walkway, and the wall itself carries on unbroken.
   const side=p.wallStairSide,stairWidth=1.7*u,x=end-run/2-.2*u,z=side*(d/2+stairWidth/2);
   stone([x,pavingTop/2,z],[run,pavingTop,stairWidth],'wall-stair-block');
   a.plan.accesses.push({id:'wall-stair-access',from:[end-.2*u,0,z],to:[end-run-.2*u,pavingTop,z],width:stairWidth,role:'stairs'});
  } else {
   // The standalone wall keeps its original access stair at the right end.
   const stairWidth=d+.26*u;
   stone([end+run/2,pavingTop/2,0],[run,pavingTop,stairWidth],'wall-stair-block');
   a.plan.accesses.push({id:'wall-stair-access',from:[end+run,0,0],to:[end,pavingTop,0],width:stairWidth,role:'stairs'});
  }
 }
 for(const side of [-1,1])a.plan.propZones.push({id:'wall-garden-'+side,x:0,z:side*(d/2+.75*u),width:w+1.3*u,depth:1.30*u,y:0,kind:'garden'});
 return a.finish();
}
