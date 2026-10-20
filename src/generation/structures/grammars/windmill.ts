import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function windmill(c:GrammarContext){
 const a=new Architect(c),p=c.config,h=a.value(p.height,.08),diameter=Math.min(p.width,p.depth)*.78;
 const topRatio=.82+c.streams.streamFor('architecture','mill-taper')()*.08,taper=(1-topRatio)/3;
 const base=a.piece('column',[0,.14,0],[diameter+.4,.28,diameter+.4],'stone','mill-plinth');
 let support=base;
 for(let level=0;level<3;level++){
  const bottom=.32+level*h/3,db=diameter*(1-level*taper),dt=diameter*(1-(level+1)*taper);
  support=a.piece('column',[0,bottom+h/6,0],[db,h/3,dt],'stone','mill-body',support);
  const beltY=level===1?.32+h*.30:level===2?.32+h*.53:bottom+.08,beltDiameter=diameter*(1-(1-topRatio)*(beltY-.32)/h);
  if(level>0)a.piece('column',[0,beltY,0],[beltDiameter+.44,.22,beltDiameter+.44],'wood','mill-belt',support);
  const windowFraction=level===2?.70:level===1?.80:.60,windowY=bottom+h/3*windowFraction,windowR=(db+(dt-db)*windowFraction)/2;
  for(const angle of (level===0?[-Math.PI/2]:level===2?[Math.PI/2]:[0,Math.PI/2])){
   const r=windowR*Math.cos(Math.PI/12),slope=(db-dt)*Math.cos(Math.PI/12)/(2*h/3);
   const face=r+.09+slope*.38,back=r-.12-slope*.38;
   const point=(u:number,y:number,radius:number):V3=>[Math.sin(angle)*radius+Math.cos(angle)*u,y,-Math.cos(angle)*radius+Math.sin(angle)*u];
   a.piece('box',point(0,windowY,back),[.42,.76,.04],'dark','mill-window',support,[0,-angle,0]);
   const depth=face-back+.06,frameR=(face+back)/2;
   for(const side of [-1,1])a.piece('box',point(side*.25,windowY,frameR),[.08,.84,depth],'wood','mill-window-frame',support,[0,-angle,0]);
   for(const side of [-1,1])a.piece('box',point(0,windowY+side*.42,frameR),[.58,.10,depth],'wood','mill-window-frame',support,[0,-angle,0]);
   a.piece('box',point(0,windowY-.48,frameR+.035),[.66,.10,depth+.14],'wood','mill-window-sill',support,[0,-angle,0]);
   a.piece('box',point(0,windowY,back+.045),[.035,.76,.045],'wood','mill-window-bar',support,[0,-angle,0]);
   a.piece('box',point(0,windowY+.08,back+.045),[.42,.035,.045],'wood','mill-window-bar',support,[0,-angle,0]);
  }
 }
 const front=-diameter/2*Math.cos(Math.PI/12),doorWidth=Math.min(1.1,diameter*.3),doorY=.32;
 a.piece('box',[0,doorY+.75,front+.46],[doorWidth,1.5,.10],'wood','mill-door',base);
 a.piece('arch',[0,doorY+1.5,front+.20],[doorWidth,1,.18],'stone','mill-door-arch',base);
 for(const side of [-1,1])a.piece('box',[side*(doorWidth/2+.09),doorY+.75,front+.20],[.18,1.5,.64],'stone','mill-door-jamb',base);
 for(const y of [.6,1.35])a.piece('box',[0,y,front+.39],[doorWidth,.08,.04],'metal','mill-door-strap',base);
 a.stairs([0,0,front-1.55],[0,.32,front-.86],doorWidth+.4);
 a.plan.pieces[a.plan.pieces.length-1].material='wood';

 const galleryY=.32+h*.76,bodyR=diameter*(1-(1-topRatio)*.76)/2,outerR=bodyR+.95;
 const gallery=a.piece('column',[0,galleryY,0],[outerR*2,.18,bodyR*2-.10],'wood','mill-gallery',support);
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6,half=Math.PI/12;
  const point=(t:number,r:number,y:number):V3=>[Math.sin(t)*r,y,Math.cos(t)*r];
  const corner=angle-half,rr=outerR+.015;
  for(const y of [galleryY-.03,galleryY+.25,galleryY+.72])a.beam(point(corner,rr,y),point(angle+half,rr,y),.13,'wood','mill-gallery-rail',gallery);
  a.beam(point(corner,rr,galleryY-.12),point(corner,rr,galleryY+.80),.15,'wood','mill-gallery-post',gallery);
  a.beam(point(angle,bodyR*Math.cos(half)+.025,galleryY-.72),point(angle,outerR*Math.cos(half),galleryY-.12),.17,'wood','mill-gallery-brace',support);
  a.beam(point(angle,bodyR*Math.cos(half),galleryY-.12),point(angle,outerR*Math.cos(half),galleryY-.12),.16,'wood','mill-gallery-joist',support);
  for(const level of [1,2]){
   const y=.32+h*(level===1?.30:.53),rr=diameter*(1-(1-topRatio)*(y-.32)/h)/2+.22;
   a.beam(point(corner,rr,y),point(angle+half,rr,y),.18,'wood','mill-belt-facing',support,{start:[Math.cos(corner),0,-Math.sin(corner)],end:[Math.cos(angle+half),0,-Math.sin(angle+half)]});
   a.piece('box',point(corner,rr,y-.18),[.21,.92,.21],'wood','mill-belt-post',support,[0,corner,0]);
   const seat=diameter*(1-(1-topRatio)*(y-.38-.32)/h)/2*Math.cos(half)+.07;
   a.beam(point(angle,seat,y-.38),point(angle,rr*Math.cos(half),y-.09),.16,'wood','mill-belt-brace',support,{start:[Math.sin(angle),0,Math.cos(angle)],end:[0,1,0]});
   a.beam(point(angle,seat,y-.09),point(angle,rr*Math.cos(half),y-.09),.16,'wood','mill-belt-joist',support);
   a.piece('box',point(corner,rr+.11,y+.08),[.075,.075,.04],'metal','mill-belt-bolt',support,[0,corner,0]);
  }
 }

 const entryRadius=diameter/2+.95;
 const entryGallery=a.piece('column',[0,.24,0],[entryRadius*2,.16,diameter-.10],'wood','mill-entry-gallery',base);
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6,half=Math.PI/12;
  const point=(t:number,r:number,y:number):V3=>[Math.sin(t)*r,y,Math.cos(t)*r];
  const rr=entryRadius+.015,corner=angle-half;
  a.beam(point(corner,rr,.05),point(corner,rr,1.10),.16,'wood','mill-entry-gallery-post',entryGallery);
  a.beam(point(corner,rr,.17),point(angle+half,rr,.17),.18,'wood','mill-entry-gallery-fascia',entryGallery);
  if(i!==6)for(const y of [.55,1.02])a.beam(point(corner,rr,y),point(angle+half,rr,y),.12,'wood','mill-entry-gallery-rail',entryGallery);
  a.beam(point(angle,diameter/2*Math.cos(half)-.04,.10),point(angle,entryRadius*Math.cos(half),.16),.14,'wood','mill-entry-gallery-joist',entryGallery);
 }
 const coverWidth=doorWidth+.70,coverDepth=.62,coverY=doorY+1.5+doorWidth/2+.50;
 const canopySeat=coverY-coverWidth/4*Math.sin(.22)-.06;
 for(const side of [-1,1]){
  const xx=side*coverWidth/2;
  a.beam([xx,.32,front-.18],[xx,canopySeat,front-.18],.16,'wood','mill-entry-canopy-post',base);
  a.beam([xx,canopySeat-.55,front-.18],[xx,canopySeat,front-.65],.13,'wood','mill-entry-canopy-brace',base);
  a.piece('box',[side*coverWidth/4,coverY,front-.40],[coverWidth/2+.08,.12,coverDepth],'wood','mill-entry-canopy',base,[0,0,-side*.22]);
 }
 const neck=diameter*topRatio,capBottom=h+.32;
 const collar=a.piece('column',[0,capBottom+.12,0],[neck+.5,.30,neck+.5],'wood','mill-collar',support);
 const cap=a.piece('column',[0,capBottom+.70,0],[neck+.95,.88,.12],'roof','mill-cap',collar);
 const edge=neck+.95;
 a.piece('column',[0,capBottom+.20,0],[edge+.06,.24,edge+.06],'wood','mill-eave',collar);
 for(let side=0;side<8;side++){
  const angle=Math.PI/8+side*Math.PI/4,r=(neck+.95)/2;
  a.beam([Math.sin(angle)*r,capBottom+.28,Math.cos(angle)*r],[Math.sin(angle)*.06,capBottom+1.16,Math.cos(angle)*.06],.11,'wood','mill-cap-seam',cap,{start:[Math.sin(angle),0,Math.cos(angle)],end:[0,1,0]});
 }
 a.piece('column',[0,capBottom+1.13,0],[.46,.18,.30],'wood','mill-peak',cap);
 for(let i=0;i<4;i++){
  const angle=Math.PI/4+i*Math.PI/2,rr=bodyR+.05;
  a.beam([Math.sin(angle)*rr,galleryY+.09,Math.cos(angle)*rr],[Math.sin(angle)*rr,capBottom+.22,Math.cos(angle)*rr],.17,'wood','mill-gallery-canopy-post',gallery);
 }
 const origin:V3=[0,.32+h*.93,-(Math.max(outerR,entryRadius)+.35)],shaft=a.beam([0,origin[1],0],origin,.28,'wood','mill-axis',collar);
 a.piece('box',origin,[.62,.62,.30],'wood','mill-hub',shaft);
 a.piece('box',[0,origin[1],origin[2]-.18],[.35,.35,.08],'wood','mill-hub-cover',shaft);
 a.piece('box',[0,origin[1],origin[2]-.235],[.09,.09,.04],'metal','mill-hub-bolt',shaft);
 const radius=Math.min(h*.94,diameter*1.75),turn=.62+(a.rnd()-.5)*.12;
 for(let i=0;i<4;i++){
  const angle=turn+i*Math.PI/2,ux=Math.sin(angle),uy=Math.cos(angle),vx=Math.cos(angle),vy=-Math.sin(angle),width=radius*.32;
  const point=(r:number,s=0,z=0):V3=>[ux*r+vx*s,origin[1]+uy*r+vy*s,origin[2]+z];
  const spar=a.beam(point(0),point(radius),.20,'wood','mill-spar',shaft);
  const start=radius*.24,end=radius*.96;
  a.beam(point(start,width),point(end,width),.14,'wood','mill-sail-edge',spar);
  for(let panel=0;panel<6;panel++){
   const lo=start+(end-start)*panel/6,hi=start+(end-start)*(panel+1)/6;
   a.piece('cloth',point((lo+hi)/2,width/2,.035),[width-.035,hi-lo-.025,.025],'cloth','mill-canvas',spar,[0,0,-angle]);
   a.beam(point(lo,0,-.025),point(lo,width,-.025),.105,'wood','mill-sail-rib',spar);
   for(const edge of [0,width])a.piece('box',point(lo,edge,-.095),[.18,.18,.045],'metal','mill-sail-joint',spar,[0,0,-angle]);
  }
  a.beam(point(end,0),point(end,width),.105,'wood','mill-sail-rib',spar);
 }
 return a.finish();
}
