import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function bridgeVariant(c:GrammarContext){
 const a=new Architect(c),p=c.config,style=p.bridgeStyle;
 const w=a.value(p.width,.04),d=a.value(p.depth,.025),h=a.value(p.height,.04),zRail=d/2-.08;
 const suspension=style==='suspension',arch=style==='stoneArch';
 const profile=(x:number)=>{
  const t=(x+w/2)/w;
  if(arch)return h*.55+(h*.45+.35)*4*t*(1-t);
  if(suspension)return h-Math.min(h*.45,w*.12)*4*t*(1-t);
  if(x<-w*.3)return h+.9;
  if(x<-w*.1)return h+.9-Math.floor((x+w*.3)/(w*.2)*4)*.225;
  return h;
 };
 const cap=(x:number,y:number,z:number,post:string)=>a.piece('box',[x,y+.065,z],[.48,.13,.48],'metal','bridge-post-cap',post);
 const bankIds:string[]=[];
 for(const sx of [-1,1]){
  const x=sx*w/2,y=profile(x),bank=a.piece('box',[sx*(w/2-.38),y/2,0],[.76,y,d+.28],'stone','bridge-variant-bank');bankIds.push(bank);
  if(suspension)for(const sz of [-1,1]){
   const post=a.piece('box',[x,y+1.0,sz*zRail],[.43,2.0,.43],'wood','bridge-rope-tower',bank);cap(x,y+2.0,sz*zRail,post);
   a.piece('box',[x,y+.10,sz*zRail],[.50,.18,.50],'metal','bridge-rope-tower-collar',post);
   a.beam([x,y+1.5,sz*zRail],[x+sx*.9,.24,sz*zRail],.28,'wood','bridge-rope-tower-brace',bank);
   for(let ring=0;ring<3;ring++)a.piece('box',[x,y+1.72+ring*.09,sz*zRail],[.57,.07,.57],'thatch','bridge-rope-wrap',post);
  }
  const end=profile(x)+.12,run=Math.max(2,end*.9);
  a.plan.accesses.push({id:'bridge-access-'+sx,from:[x+sx*run,0,0],to:[x,end,0],width:d,role:'stairs'});
  const count=Math.ceil(end/.36);
  for(let i=0;i<count;i++){const length=run/count,height=Math.max(.08,end*(1-i/count)-.14),xx=x+sx*(i+.5)*length;
   const stone=a.piece('box',[xx,height/2,0],[length,height,d-.16],'stone','bridge-variant-stair-stone');
   a.piece('box',[xx,height+.07,0],[length-.018,.14,d+.04],'wood','bridge-stair-tread',stone);
  }
  for(const sz of [-1,1]){
   const zz=sz*zRail,outer=x+sx*run,foot=a.piece('box',[outer,.18,zz],[.68,.36,.68],'stone','bridge-stair-foot');
   const post=a.piece('box',[outer,.8,zz],[.34,1.24,.34],'wood','bridge-stair-post',foot);cap(outer,1.42,zz,post);
   const rail=a.beam([outer-sx*.17,1.22,zz],[x+sx*.17,end+1.04,zz],.21,'wood','bridge-stair-handrail',post,{start:[1,0,0],end:[1,0,0]});a.plan.pieces.find(p=>p.id===rail)!.size[1]=.25;
   const stringer=a.beam([outer,.07,zz],[x,end+.08,zz],.17,'wood','bridge-stair-stringer',foot);a.plan.pieces.find(p=>p.id===stringer)!.size[1]=.42;
  }
 }
 const foundation=arch?a.piece('arch',[0,0,0],[w,h,d-.16],'stone','bridge-stone-arch'):suspension?a.piece('box',[0,profile(0)-.20,0],[.01,.01,.01],'wood','bridge-rope-support',bankIds[0]):a.piece('box',[0,profile(0)-.20,0],[w,.10,d-.12],'wood','deck',bankIds[0]);
 a.depend(foundation,bankIds,2);
 if(arch)for(const side of [-1,1])for(let i=0;i<18;i++)a.piece('arch',[0,0,side*(d/2-.07)],[w,h,.20],'stone','bridge-arch-voussoir',foundation,[i*Math.PI/18,(i+.94)*Math.PI/18,0]);
 const n=Math.max(12,Math.ceil(w/.34)),dx=w/n;
 const boards:string[]=[];
 for(let i=0;i<n;i++){
  const x=-w/2+(i+.5)*dx,y=profile(x),slope=arch||suspension?(profile(x+dx*.25)-profile(x-dx*.25))/(dx*.5):0;
  boards.push(a.piece('box',[x,y+.05,0],[dx-.012,.14,d+.05],'wood','deck-plank',foundation,[0,0,Math.atan(slope)]));
 }
 const bays=Math.max(3,Math.round(w/3)),points=Array.from({length:bays+1},(_,i)=>-w/2+i*w/bays);
 if(!suspension){
  for(const sz of [-1,1]){
   const posts:string[]=[];
   for(const x of points){const y=profile(x),foot=arch?foundation:a.piece('box',[x,.26,sz*zRail],[.78,.52,.78],'stone','bridge-pier-foot');
    const support=arch?foundation:a.piece('box',[x,(.52+y-.13)/2,sz*zRail],[.38,Math.max(.2,y-.65),.38],'wood','bridge-pier',foot);
    const post=a.piece('box',[x,y+.70,sz*zRail],[.34,1.36,.34],'wood','bridge-rail-post',support);posts.push(post);cap(x,y+1.38,sz*zRail,post);
    a.piece('box',[x,y+.12,sz*zRail],[.40,.14,.40],'metal','bridge-post-shoe',post);
    if(!arch)for(const dir of [-1,1])if(x+dir*.9>-w/2&&x+dir*.9<w/2)a.beam([x,y*.5,sz*zRail],[x+dir*.9,profile(x+dir*.9)-.18,sz*zRail],.24,'wood','bridge-pier-brace',support);
   }
   for(let i=0;i<bays;i++){
    const left=points[i],right=points[i+1],mid=(left+right)/2;
    a.beam([left,profile(left)+1.19,sz*zRail],[right,profile(right)+1.19,sz*zRail],.23,'wood','bridge-handrail',posts[i]);
    a.beam([left,profile(left)+.30,sz*zRail],[right,profile(right)+.30,sz*zRail],.18,'wood','bridge-rail-sill',posts[i]);
    a.piece('box',[mid,profile(mid)+.74,sz*zRail],[.17,.70,.17],'wood','bridge-baluster',posts[i]);
    a.beam([left+.2,profile(left)+1.03,sz*zRail],[mid,profile(mid)+.35,sz*zRail],.17,'wood','bridge-rail-brace',posts[i]);
    if(!arch)a.beam([left,profile(left)-.12,sz*zRail],[right,profile(right)-.12,sz*zRail],.30,'wood','bridge-deck-girder',foundation);
   }
  }
 }else{
  const rope=(from:V3,to:V3,role:string,width=.065)=>a.beam(from,to,width,'thatch',role,foundation);
  for(const sz of [-1,1]){
   const z=sz*zRail,ropeY=(x:number)=>profile(x)+1.70;
   const ropeSegments=Math.max(24,n*2);
   for(let i=0;i<ropeSegments;i++){
    const x=-w/2+i*w/ropeSegments,next=x+w/ropeSegments;
    rope([x,ropeY(x),z],[next,ropeY(next),z],'bridge-rope-handrail',.08);
    rope([x,profile(x)-.05,z],[next,profile(next)-.05,z],'bridge-rope-deck',.075);
   }
   for(let i=1;i<n;i+=2){const x=-w/2+i*dx;
    rope([x,profile(x)+.1,z],[x,ropeY(x),z],'bridge-rope-hanger',.055);
    for(const y of [profile(x)+.1,ropeY(x)])a.piece('box',[x,y,z],[.15,.15,.15],'thatch','bridge-rope-knot',foundation);
    for(const zz of [-1,1])a.piece('box',[x,profile(x)+.135,zz*(d/2-.12)],[.045,.025,.045],'metal','bridge-deck-nail',boards[Math.min(i,n-1)]);
   }
  }
  for(const sx of [-1,1])a.beam([sx*w/2,profile(sx*w/2)+1.5,-zRail],[sx*w/2,profile(sx*w/2)+1.5,zRail],.25,'wood','bridge-rope-end-crossbar',bankIds[sx<0?0:1]);
 }
 a.plan.propZones.push({id:'stream',x:0,z:0,width:Math.max(1,w-.9),depth:d+9,y:0,kind:'water'});
 if(p.vegetation>.15)for(const bankId of bankIds){const bank=a.plan.pieces.find(p=>p.id===bankId)!;
  for(const side of [-1,1])for(const column of [-1,1])for(let i=0;i<Math.ceil(bank.size[1]*p.vegetation*4);i++){
   const y=.12+i*.20,x=bank.position[0]+column*.18+Math.sin(i*1.4)*.08;
   a.piece('rock',[x,y,side*(d/2+.16)],[.12,.14,.06],'wood','bridge-bank-ivy',bankId);
  }
 }
 for(const sx of [-1,1])for(const sz of [-1,1])a.plan.propZones.push({id:`bank-${sx}-${sz}`,x:sx*(w/2+1),z:sz*(d/2+1),width:1.5,depth:1.5,y:0,kind:'garden'});
 return a.finish();
}
