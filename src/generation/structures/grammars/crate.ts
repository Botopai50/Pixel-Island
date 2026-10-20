import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function woodenCrate(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth,h=p.height,u=Math.min(w,d,h),f=u*.13,t=u*.035;
 const box=(position:V3,size:V3,role:string,support='ground')=>a.piece('box',position,size,'wood',role,support);
 const core=box([0,h/2,0],[w-2*f,h-2*f,d-2*f],'crate-core');
 const nail=(position:V3,size:number,rotation:V3,support=core)=>a.piece('box',position,[size,size*.52,size],'metal','crate-rivet',support,rotation);
 const rows=Math.max(3,Math.round((h-2*f)/(u*.18))),boardH=(h-2*f)/rows;
 for(const side of [-1,1]){
  for(const y of [f/2,h-f/2]){
   box([0,y,side*(d/2-f/2)],[w-2*f,f,f],'crate-frame',core);
   box([side*(w/2-f/2),y,0],[f,f,d-2*f],'crate-frame',core);
  }
  for(let row=0;row<rows;row++){
   const y=f+(row+.5)*boardH;
   box([0,y,side*(d/2-f*.72)],[w-2*f+.004*u,boardH-.003*u,t],'crate-board',core);
   box([side*(w/2-f*.72),y,0],[t,boardH-.003*u,d-2*f+.004*u],'crate-board',core);
  }
  for(const other of [-1,1]){
   const x=side*(w/2-f/2),z=other*(d/2-f/2);
   const post=box([x,h/2,z],[f,h-2*f,f],'crate-post',core);
   for(const y of [f/2,h-f/2]){
    const corner=box([x,y,z],[f*1.16,f*1.08,f*1.16],'crate-corner',post);
    nail([side*(w/2+f*.08+.011*u),y,z],u*.045,[0,side*Math.PI/2,0],corner);
    nail([x,y,other*(d/2+f*.08+.011*u)],u*.045,[0,other>0?0:Math.PI,0],corner);
    if(y>h/2)nail([x,h+f*.04+.006*u,z],u*.027,[-Math.PI/2,0,0],corner);
   }
  }
  const high=h-f-u*.04,low=f+u*.04;
  const addBrace=(start:V3,end:V3,angle:number)=>{
   const brace=a.piece('beam',start,[u*.14,u*.14,u*.035],'wood','crate-brace',core,[0,angle,0],end);
   const n:V3=[Math.sin(angle),0,Math.cos(angle)];
   for(const fraction of [.08,.92])nail(start.map((v,i)=>v+(end[i]-v)*fraction+n[i]*u*.027) as V3,u*.026,[0,angle,0],brace);
  };
  addBrace([-w/2+f+u*.04,high,side*(d/2-u*.025)],[w/2-f-u*.04,low,side*(d/2-u*.025)],side>0?0:Math.PI);
  addBrace([side*(w/2-u*.025),high,-d/2+f+u*.04],[side*(w/2-u*.025),low,d/2-f-u*.04],side*Math.PI/2);
 }
 const lidCount=Math.max(4,Math.round((d-2*f)/(u*.15))),lidW=(d-2*f)/lidCount;
 for(let i=0;i<lidCount;i++)box([0,h-f*.48,-d/2+f+(i+.5)*lidW],[w-2*f+.004*u,t,lidW-.003*u],'crate-lid-board',core);
 box([0,f*.5,0],[w-2*f,t,d-2*f],'crate-floor',core);
 return a.finish();
}
