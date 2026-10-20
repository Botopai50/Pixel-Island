import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function stoneLantern(context:GrammarContext){
 const a=new Architect(context),c=context.config,u=c.height/3.5,w=Math.min(c.width,c.depth);
 const stone=(at:V3,size:V3,role:string,on='ground')=>a.piece('box',at,size,'stone',role,on);
 const base=stone([0,.09*u,0],[1.38*u,.18*u,1.38*u],'stone-lantern-base');
 const step=stone([0,.26*u,0],[1.12*u,.16*u,1.12*u],'stone-lantern-base',base);
 let support=stone([0,.41*u,0],[.88*u,.14*u,.88*u],'stone-lantern-foot',step);
 for(let course=0;course<4;course++)support=stone([0,(.48+(course+.5)*.28)*u,0],[.5*u,.28*u,.5*u],'stone-lantern-pillar',support);
 const corbel=stone([0,1.70*u,0],[.93*u,.20*u,.93*u],'stone-lantern-corbel',support);
 const shelf=stone([0,1.91*u,0],[1.10*u,.22*u,1.10*u],'stone-lantern-shelf',corbel);
 const posts:string[]=[];
 for(const x of [-.36,.36])for(const z of [-.36,.36])posts.push(stone([x*u,2.28*u,z*u],[.16*u,.52*u,.16*u],'stone-lantern-corner',shelf));
 const cap=stone([0,2.62*u,0],[.94*u,.16*u,.94*u],'stone-lantern-cap',posts[0]);a.depend(cap,posts,2);
 const volume='stone-lantern-chamber';a.plan.volumes.push({id:volume,x:0,z:0,width:.94*u,depth:.94*u,bottom:2.02*u,height:.68*u,floors:1,role:'lantern'});
 const roof={id:'stone-lantern-roof',volume,x:0,z:0,width:w,depth:w,y:2.70*u,rise:.55*u,eaves:0,kind:'hip' as const,material:'stone' as const,plainEdge:true};
 a.plan.roofs.push(roof);a.plan.supports.push({component:roof.id,on:cap});
 for(const side of [-1,1]){
  a.beam([-w/2,2.76*u,side*w/2],[w/2,2.76*u,side*w/2],.16*u,'wood','stone-lantern-fascia',roof.id);
  a.beam([side*w/2,2.76*u,-w/2],[side*w/2,2.76*u,w/2],.16*u,'wood','stone-lantern-fascia',roof.id);
 }
 for(const x of [-w/2,w/2])for(const z of [-w/2,w/2])a.beam([x,2.82*u,z],[0,3.37*u,0],.065*u,'wood','stone-lantern-roof-frame',roof.id);
 stone([0,3.36*u,0],[.24*u,.22*u,.24*u],'stone-lantern-finial',roof.id);
 a.piece('box',[0,2.25*u,0],[.20*u,.29*u,.20*u],'dark','stone-lantern-light',shelf);
 for(const side of [-1,1]){
  a.piece('box',[0,2.28*u,side*.365*u],[.56*u,.46*u,.016*u],'dark','stone-lantern-glass',shelf);
  a.piece('box',[side*.365*u,2.28*u,0],[.016*u,.46*u,.56*u],'dark','stone-lantern-glass',shelf);
 }
 return a.finish();
}
