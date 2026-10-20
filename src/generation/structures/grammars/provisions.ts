import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';
import {PROVISION_SEAMS,provisionRadiusAt,provisionFoldAt} from '../provisionProfile';

export function supplySack(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth,h=p.height;
 const body=a.piece('column',[0,0,0],[w,h,d],'cloth','provision-body');
 a.piece('column',[0,0,0],[w,h,d],'cloth','provision-mouth',body);
 a.piece('column',[0,0,0],[w,h,d],'cloth','provision-rope-ring',body);
 const angle=2.55,neck=.765*h,knot:V3=[Math.sin(angle)*(w*.15+.022*h),neck,Math.cos(angle)*(d*.15+.022*h)];
 a.piece('column',knot,[h*.075,h*.060,h*.055],'cloth','provision-knot',body,[0,angle,0]);
 for(const side of [-1,1]){
  a.piece('column',[0,0,0],[w,h,d],'cloth','provision-rope-tail',body,[0,angle+side*.105,0]);
  const t=side<0?.53:.57,at=angle+side*.105,rad=provisionRadiusAt(t)*provisionFoldAt(t,at);
  a.piece('column',[Math.sin(at)*(w*.5*rad+.028*h),t*h,Math.cos(at)*(d*.5*rad+.028*h)],[h*.055,h*.042,h*.055],'cloth','provision-rope-end',body);
 }
 for(const at of PROVISION_SEAMS){
  a.piece('cloth',[0,0,0],[w,h,d],'cloth','provision-seam',body,[0,at,0]);
  for(let t=.11;t<.70;t+=.075){
   const rr=provisionRadiusAt(t)*provisionFoldAt(t,at);
   a.piece('box',[Math.sin(at)*(w*.5*rr+.003*h),t*h,Math.cos(at)*(d*.5*rr+.003*h)],[h*.035,h*.009,h*.008],'cloth','provision-stitch',body,[0,at,sideTilt(t)]);
  }
 }
 return a.finish();
}
function sideTilt(t:number){return Math.sin(t*37)*.10;}
