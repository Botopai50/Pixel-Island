import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function stoneFountain(c:GrammarContext){
 const a=new Architect(c),p=c.config,h=p.height,r=Math.min(p.width,p.depth)*.44,u=h/2;
 const stone=(at:V3,size:V3,role:string,support='ground',rotation?:V3)=>a.piece('column',at,size,'stone',role,support,rotation);
 const column=(bottom:number,top:number,radius:number,role='fountain-column')=>stone([0,(bottom+top)/2,0],[radius*2,top-bottom,radius*2],role);
 const basin=(radius:number,bottom:number,height:number,count:number)=>{
  const inner=radius*.82;
  for(let i=0;i<count;i++)stone([0,bottom+height/2,0],[radius*2,height,inner*2],'fountain-ring-block','ground',[0,i*Math.PI*2/count,0]);
  a.piece('column',[0,bottom+height*.67,0],[inner*1.995,.018*u,inner*1.995],'water','fountain-water');
 };
 // A broad plinth supports the lower bowl; the upper bowl sits on a fluted pier.
 stone([0,.045*h,0],[r*2.08,.09*h,r*1.62],'fountain-ring-block');
 basin(r,.085*h,.225*h,28);
 column(.09*h,.30*h,r*.24,'fountain-pedestal');
 column(.30*h,.345*h,r*.265,'fountain-moulding');
 column(.345*h,.60*h,r*.19);
 column(.60*h,.645*h,r*.25,'fountain-moulding');
 column(.645*h,.685*h,r*.205,'fountain-pedestal');
 column(.685*h,.725*h,r*.30,'fountain-moulding');
 basin(r*.56,.72*h,.12*h,24);
 column(.785*h,.855*h,r*.115,'fountain-pedestal');
 column(.855*h,.97*h,r*.09);
 a.piece('box',[0,.979*h,0],[r*.24,.042*h,r*.24],'stone','fountain-finial-cap');
 a.piece('box',[0,h+.001*u,0],[r*.13,.002*u,r*.13],'dark','fountain-finial-inset');
 return a.finish();
}
