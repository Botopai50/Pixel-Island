import {Architect} from '../blueprint';
import type {GrammarContext} from '../types';
import {barrelRadiusAt} from '../barrelProfile';

export function woodenBarrel(c:GrammarContext){
 const a=new Architect(c),p=c.config,h=p.height,r=Math.min(p.width,p.depth)/2,u=h/1.2;
 const core=a.piece('column',[0,h/2,0],[r*1.96,h,r*1.96],'wood','barrel-core');
 for(let i=0;i<20;i++)a.piece('column',[0,h/2,0],[r*2,h,r*2],'wood','barrel-stave',core,[0,i*Math.PI/10,0]);
 const radius=(t:number)=>r*barrelRadiusAt(t);
 for(const t of [.10,.46,.84]){
  const bandH=h*.080,rr=radius(t)+.018*u;
  const band=a.piece('column',[0,h*t,0],[rr*2,bandH,r*2],'metal','barrel-hoop',core,undefined,[h,r,u]);
  for(let i=0;i<12;i++){
   const angle=i*Math.PI/6,dist=rr+.012*u;
   a.piece('box',[Math.sin(angle)*dist,h*t,Math.cos(angle)*dist],[.048*u,.020*u,.048*u],'metal','barrel-rivet',band,[0,angle,0]);
  }
 }
 const lidR=r*.825,count=7;
 for(let i=0;i<count;i++){
  const left=-lidR+i*lidR*2/count+.0015*u,right=-lidR+(i+1)*lidR*2/count-.0015*u;
  a.piece('box',[0,h*.975,0],[lidR*2,.032*u,lidR*2],'wood','barrel-lid-board',core,undefined,[left,right,lidR]);
 }
 a.piece('box',[0,h*.995,0],[lidR*1.91,.040*u,lidR*.24],'wood','barrel-lid-brace',core);
 return a.finish();
}
