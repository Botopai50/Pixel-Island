import {Architect} from '../blueprint';import type {GrammarContext,V3,SurfaceMaterial} from '../types';

export function woodenCart(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth,h=p.height,u=h/1.45,r=h*.28,wheelT=.25*u,floorTop=h*.40;
 const box=(at:V3,size:V3,mat:SurfaceMaterial,role:string,support='ground',rotation?:V3)=>a.piece('box',at,size,mat,role,support,rotation);
 const chassis=box([0,floorTop-.12*u,0],[w-.04*u,.12*u,d-.04*u],'wood','scenery-cart-chassis');
 // Lengthwise boards close the bed; only the narrow seams are recessed.
 const boards=Math.max(5,Math.ceil(w/(.24*u)));
 const floorWidth=w-.025*u;
 for(let i=0;i<boards;i++)box([-floorWidth/2+(i+.5)*floorWidth/boards,floorTop-.05*u,0],[floorWidth/boards-.008*u,.10*u,d-.025*u],'wood','scenery-cart-floor-board',chassis);
 const wallH=h*.49,course=wallH/3,postT=.18*u,wallT=.11*u;
 for(let i=0;i<3;i++)for(const side of [-1,1]){
  const yy=floorTop+(i+.5)*course;
  box([side*(w/2-wallT/2),yy,0],[wallT,course-.008*u,d-postT*2],'wood','scenery-cart-side-board',chassis);
  box([0,yy,side*(d/2-wallT/2)],[w-postT*2,course-.008*u,wallT],'wood','scenery-cart-tailboard',chassis);
 }
 for(const side of [-1,1])for(const end of [-1,1]){
  const x=side*(w/2-postT/2),z=end*(d/2-postT/2),bottom=floorTop-.10*u,top=h;
  const post=box([x,(bottom+top)/2,z],[postT,top-bottom,postT],'wood','scenery-cart-corner-post',chassis);
  box([x,top+.015*u,z],[postT+.04*u,.05*u,postT+.04*u],'wood','scenery-cart-post-cap',post);
  for(const yy of [floorTop+.14*u,top-.14*u]){
   box([x,yy,z],[postT+.022*u,.11*u,postT+.022*u],'metal','scenery-cart-post-band',post);
   box([x+side*(postT/2+.022*u),yy,z],[.022*u,.044*u,.044*u],'metal','scenery-cart-corner-bolt',post);
   box([x,yy,z+end*(postT/2+.022*u)],[.044*u,.044*u,.022*u],'metal','scenery-cart-corner-bolt',post);
  }
 }
 for(const z of [-d*.31,d*.31]){
  const axle=a.beam([-w/2-.36*u,r,z],[w/2+.36*u,r,z],.13*u,'wood','scenery-cart-axle',chassis);
  for(const side of [-1,1]){
   const x=side*(w/2+.18*u),wheel=a.piece('wheel',[x,r,z],[r*2,r*2,wheelT],'wood','scenery-cart-wheel',axle);
   a.piece('wheel',[x,r,z],[r*2,r*2,wheelT*.60],'metal','scenery-cart-tyre',wheel);
   box([x+side*(wheelT/2+.052*u),r,z],[.035*u,.15*u,.15*u],'metal','scenery-cart-hub-plate',wheel);
   box([x+side*(wheelT/2+.077*u),r,z],[.035*u,.055*u,.055*u],'metal','scenery-cart-hub-bolt',wheel);
   for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,yy=r+Math.cos(angle)*(r+.019*u),zz=z+Math.sin(angle)*(r+.019*u);
    box([x,yy,zz],[wheelT*.48,.024*u,.055*u],'metal','scenery-cart-tyre-rivet',wheel,[angle,0,0]);
   }
  }
 }
 // Parallel shafts join the front beam and extend slightly down toward their tips.
 const shaftLength=d*.86,shaftY=floorTop-.10*u,tipY=shaftY-.09*u;
 for(const side of [-1,1]){
  const x=side*w*.32,from:V3=[x,shaftY,-d/2+.10*u],to:V3=[x,tipY,-d/2-shaftLength];
  const shaft=a.beam(from,to,.13*u,'wood','scenery-cart-shaft',chassis);
  box([x,shaftY,-d/2-.02*u],[.23*u,.23*u,.17*u],'metal','scenery-cart-shaft-socket',shaft);
  box([x,shaftY+.135*u,-d/2-.02*u],[.055*u,.03*u,.055*u],'metal','scenery-cart-shaft-bolt',shaft);
  box([x,tipY,-d/2-shaftLength],[.155*u,.155*u,.06*u],'metal','scenery-cart-shaft-end',shaft);
  box([x,tipY,-d/2-shaftLength-.042*u],[.045*u,.045*u,.025*u],'metal','scenery-cart-shaft-bolt',shaft);
 }
 return a.finish();
}
