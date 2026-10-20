import {Architect} from '../blueprint';import type {GrammarContext,V3} from '../types';
import {woodenBarrel} from './barrel';
import {woodenCrate} from './crate';
import {supplySack} from './provisions';

export function scenery(c:GrammarContext){
 if(c.config.type==='woodenBarrel')return woodenBarrel(c);
 if(c.config.type==='woodenCrate')return woodenCrate(c);
 if(c.config.type==='supplySacks')return supplySack(c);
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth,h=p.height;
 const box=(at:V3,size:V3,material:'wood'|'metal'|'cloth'|'dark',role:string,support='ground')=>a.piece('box',at,size,material,role,support);
 if(p.type==='dirtPath'||p.type==='stonePath'){
  a.piece('box',[0,.025,0],[w,.05,d],p.type==='stonePath'?'stone':'earth','scenery-path');
 }else if(p.type==='woodenCrate'){
  const body=box([0,h/2,0],[w,h,d],'wood','scenery-crate');
  const frame=Math.min(w,d,h)*.095;
  for(const side of [-1,1]){
   for(const level of [frame/2,h-frame/2]){
    box([0,level,side*(d/2+.015)],[w+frame,frame,frame],'wood','scenery-crate-frame',body);
    box([side*(w/2+.015),level,0],[frame,frame,d+frame],'wood','scenery-crate-frame',body);
   }
   for(const xx of [-1,1])box([xx*(w/2-frame/2),h/2,side*(d/2+.025)],[frame,h,frame],'wood','scenery-crate-post',body);
   a.beam([-w/2+frame,frame,side*(d/2+frame*.6)],[w/2-frame,h-frame,side*(d/2+frame*.6)],frame*.8,'wood','scenery-crate-brace',body);
   for(const xx of [-1,1])for(const level of [frame/2,h-frame/2])box([xx*(w/2-frame*.5),level,side*(d/2+frame*.6)],[frame*.22,frame*.22,frame*.12],'metal','scenery-crate-nail',body);
  }
 }else if(p.type==='woodenBarrel'){
  const diameter=Math.min(w,d),body=a.piece('column',[0,h/2,0],[diameter,h,diameter],'wood','barn-barrel');
  for(const t of [.13,.50,.87])a.piece('column',[0,h*t,0],[diameter*(t===.50?1.015:.96),h*.065,diameter],'metal','barn-barrel-hoop',body);
  a.piece('column',[0,h+.008,0],[diameter*.80,h*.035,diameter*.80],'wood','barn-barrel-lid',body);
 }else if(p.type==='supplySacks'){
  const body=a.piece('column',[0,h*.45,0],[w,h*.90,d],'cloth','scenery-sack');
  a.piece('column',[0,h*.93,0],[w*.30,h*.12,d*.30],'cloth','scenery-sack-neck',body);
  a.piece('column',[0,h*.93,0],[w*.32,h*.035,d*.32],'wood','scenery-sack-tie',body);
 }else if(p.type==='firewoodPile'){
  const rows=3,radius=h/(rows*2),spacing=radius*2.05,rnd=c.streams.streamFor('decoration','firewood');
  for(let row=0;row<rows;row++)for(let i=0;i<rows-row;i++){
   const x=(i-(rows-row-1)/2)*spacing,y=radius+row*radius*1.74,length=d*(.86+rnd()*.14);
   const id=a.piece('column',[x,y,0],[radius*2,length,radius*2],'wood','scenery-log','ground',[Math.PI/2,0,0]);
   for(const side of [-1,1])a.piece('column',[x,y,side*(length/2+.006)],[radius*1.75,.016,radius*1.75],'wood','scenery-log-end',id,[Math.PI/2,0,0]);
  }
  // Width can spread the stack without deforming the round log sections.
  for(const piece of a.plan.pieces)piece.position[0]*=w/(spacing*3);
 }
 return a.finish();
}
