import type {Architect} from './blueprint';
import type {RoofSurface,V3} from './types';

/** Fascias sit outside the slab faces. They attach to the roof so destruction
 * never leaves intact ornamental borders suspended around a missing roof.
 */
export function dressRoof(a:Architect,r:RoofSurface){
 if(r.plainEdge)return;
 const w=r.width/2,d=r.depth/2,e=r.eaves;
 const left=r.x-w-e,right=r.x+w+e,front=r.z-d-e,back=r.z+d+e;
 const ratio=r.ridgeRatio??.5,ridge=r.x-w+r.width*ratio;
 const beam=(from:V3,to:V3,role:string,section=.24,cuts?:{start:V3;end:V3})=>a.beam(from,to,section,r.material==='stone'?'stone':'wood',role,r.id,cuts);
 if(r.royalTrim&&r.kind==='hip'){
  const y=r.y-r.rise*e/Math.min(w,d)+.06;
  for(const z of [front,back])beam([left,y,z],[right,y,z],'castle-eave-beam',.16);
  for(const x of [left,right])beam([x,y,front],[x,y,back],'castle-eave-beam',.16);
  const depthAxis=d>=w,first:V3=depthAxis?[r.x,r.y+r.rise,r.z-d+w]:[r.x-w+d,r.y+r.rise,r.z],last:V3=depthAxis?[r.x,r.y+r.rise,r.z+d-w]:[r.x+w-d,r.y+r.rise,r.z];
  for(const point of [[left,y-.06,front],[right,y-.06,front],[right,y-.06,back],[left,y-.06,back]] as V3[])a.beam(point,depthAxis?(point[2]<r.z?first:last):(point[0]<r.x?first:last),.16,'wood','hip-cap',r.id);
  if(Math.abs(w-d)>.001)a.beam(first,last,.16,'wood','hip-ridge-cap',r.id);
  return;
 }
 if(r.kind==='shed'&&r.shedAxis===2){
  const height=(z:number)=>r.y+r.rise*(.5+(r.shedDirection??1)*(z-r.z)/(2*d));
  for(const z of [front,back])beam([left,height(z)-.055,z],[right,height(z)-.055,z],'roof-fascia');
  for(const x of [left-.035,right+.035])beam([x,height(front)-.055,front],[x,height(back)-.055,back],'eave-fascia');
  return;
 }
 if(r.kind==='gable'||r.kind==='thatch'){
  const ly=r.y-r.rise*e/(r.width*ratio),ry=r.y-r.rise*e/(r.width*(1-ratio));
  const leftOffset=.17-.12*Math.sqrt(1+(r.rise/(r.width*ratio))**2),rightOffset=.17-.12*Math.sqrt(1+(r.rise/(r.width*(1-ratio)))**2);
  for(const z of [front-.055,back+.055]){
   beam([left-.12,ly+leftOffset-.12*r.rise/(r.width*ratio),z],[ridge,r.y+r.rise+leftOffset,z],'roof-fascia',.24,{start:[1,0,0],end:[1,0,0]});
   beam([ridge,r.y+r.rise+rightOffset,z],[right+.12,ry+rightOffset-.12*r.rise/(r.width*(1-ratio)),z],'roof-fascia',.24,{start:[1,0,0],end:[1,0,0]});
  }
  beam([left,ly+leftOffset,front+.065],[left,ly+leftOffset,back-.065],'eave-fascia');
  beam([right,ry+rightOffset,front+.065],[right,ry+rightOffset,back-.065],'eave-fascia');
  if(r.kind!=='thatch')a.beam([ridge,r.y+r.rise+.125,front+.065],[ridge,r.y+r.rise+.125,back-.065],.36,r.material==='stone'?'stone':'wood','ridge-cap',r.id);
 }else {
  const y=r.kind==='hip'?r.y-r.rise*e/Math.min(w,d):r.y;
  const ly=r.kind==='shed'?r.y+r.rise*(.5+(r.shedDirection??1)*(-w-e)/(2*w)):y;
  const ry=r.kind==='shed'?r.y+r.rise*(.5+(r.shedDirection??1)*(w+e)/(2*w)):y;
  for(const z of [front-.055,back+.055])beam([left,ly-.055,z],[right,ry-.055,z],'roof-fascia');
  beam([left-.035,ly-.055,front],[left-.035,ly-.055,back],'eave-fascia');
  beam([right+.035,ry-.055,front],[right+.035,ry-.055,back],'eave-fascia');
  if(r.kind==='hip'){
   const low=r.y-r.rise*e/Math.min(w,d),high=r.y+r.rise;
   const axisDepth=d>=w;
   const first:V3=axisDepth?[r.x,high,r.z-d+w]:[r.x-w+d,high,r.z];
   const last:V3=axisDepth?[r.x,high,r.z+d-w]:[r.x+w-d,high,r.z];
   const corners:V3[]=[[left,low,front],[right,low,front],[right,low,back],[left,low,back]];
   for(const corner of corners){const end=axisDepth?(corner[2]<r.z?first:last):(corner[0]<r.x?first:last);a.beam(corner,end,.24,'wood','hip-cap',r.id);}
   if(Math.abs(w-d)>.001)a.beam(first,last,.24,'wood','hip-ridge-cap',r.id);
  }
 }
}
