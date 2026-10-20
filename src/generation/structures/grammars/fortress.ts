import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

/** Small garrison: an open court enclosed by accessible stone defences. */
export function compactFortress(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.07),d=a.value(p.depth,.07),h=a.value(p.height,.07);
 const r=Math.min(w,d)*.115,tx=w/2-r,tz=d/2-r,wallH=h*.62,thickness=1.05;
 const wallAccessStart=tz-r-1.55,wallAccessEnd=tz-r-.22,wallAccessTop=.24+wallH+.21;
 const court=a.piece('box',[0,.12,0],[w-r*2,.24,d-r*2],'stone','fortress-courtyard');
 const pixelBanner=(x:number,y:number,z:number,width:number,height:number,support:string,role:string)=>{a.piece('cloth',[x,y,z],[width,height,0],'cloth',role,support);};
 const towers:string[]=[];
 const cornerOrder=[0,1,2,3];
 for(let i=cornerOrder.length-1;i>0;i--){const j=Math.floor(a.rnd()*(i+1));[cornerOrder[i],cornerOrder[j]]=[cornerOrder[j],cornerOrder[i]];}
 const watchCorners=new Set(cornerOrder.slice(0,a.rnd()<.5?1:2));
 const heightRatios=[.84,.91,.98,1.05],heightByCorner:number[]=[];
 for(let i=0;i<4;i++)heightByCorner[cornerOrder[i]]=heightRatios[i];
 for(const sx of [-1,1])for(const sz of [-1,1]){
  const corner=(sx===1?2:0)+(sz===1?1:0);
  const height=h*heightByCorner[corner]*(1+(a.rnd()-.5)*.04),x=sx*tx,z=sz*tz;
  const crownRadius=r+.30;
  const tower=a.piece('column',[x,.24+height/2,z],[r*2,height,r*2],'stone','fortress-tower',court);towers.push(tower);
  a.piece('column',[x,.26,z],[r*2+.24,.52,r*2+.24],'stone','fortress-tower-foot',tower);
  a.piece('column',[x,height+.18,z],[crownRadius*2+.06,.28,crownRadius*2+.06],'stone','fortress-tower-cornice',tower);
  a.piece('column',[x,.24+height*.48,z],[r*2+.12,.14,r*2+.12],'stone','fortress-tower-band',tower);
  // A support needs solid masonry at its seat and must leave both walk doorways clear.
  const supportedBeam=(from:V3,to:V3,width:number,role:string)=>{
   const padding=width/2+.06,apothem=r*Math.cos(Math.PI/12),doorTop=Math.min(height+.02,.24+wallH+1.65);
   for(const axis of [0,2]){
    const sign=axis===0?-sx:-sz;
    const local=(v:V3)=>[axis===0?v[2]-z:v[0]-x,v[1],sign*(v[axis]-(axis===0?x:z))];
    const start=local(from),end=local(to),min=[-.58-padding,.24+wallH-padding,apothem-.26-padding],max=[.58+padding,doorTop+padding,crownRadius+.20+padding];
    let enter=0,leave=1;
    for(let i=0;i<3;i++){
     const delta=end[i]-start[i];
     if(Math.abs(delta)<1e-8){if(start[i]<min[i]||start[i]>max[i]){enter=2;break;}continue;}
     const a=(min[i]-start[i])/delta,b=(max[i]-start[i])/delta;
     enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
    }
    if(enter<=leave)return;
   }
   a.beam(from,to,width,'wood',role,tower);
  };
  // Continuous timber belts share the curtain height at every tower junction.
  const timberRing=(y:number,upper:boolean)=>{
   const radius=upper?crownRadius+.10:r+.12,half=Math.PI/12;
   const point=(angle:number,rr:number,yy:number):V3=>[x+Math.sin(angle)*rr,yy,z+Math.cos(angle)*rr];
   for(let i=0;i<12;i++){
    const angle=i*Math.PI/6,start=angle-half,end=angle+half;
    if(!upper&&sx*Math.sin(angle)<=1e-6&&sz*Math.cos(angle)<=1e-6)continue;
    for(const yy of upper?[y-.10,y+.08]:[y-.17,y+.17])a.beam(point(start,radius,yy),point(end,radius,yy),.16,'wood',upper?'fortress-tower-crown-belt':'fortress-tower-connection-belt',tower);
    supportedBeam(point(start,radius,y-.36),point(start,radius,y+.29),.18,'fortress-tower-crown-post');
    const seat=r*Math.cos(half)-.07,outer=radius*Math.cos(half);
    supportedBeam(point(angle,seat,y-.90),point(angle,outer,y-.25),.18,'fortress-tower-crown-brace');
    supportedBeam(point(angle,seat,y-.25),point(angle,outer,y-.25),.18,'fortress-tower-crown-joist');
   }
  };
  timberRing(.24+wallH-.42,false);
  timberRing(height+.26,true);
  const upperBottom=.24+wallH-.42+.36,upperTop=height+.26-.90;
  const upperY=(upperBottom+upperTop)/2,upperScale=Math.min(1,(upperTop-upperBottom-.08)/.96);
  for(const level of [0,1])for(const side of [sx<0?9:3,sz<0?0:6]){
   const angle=side*Math.PI/6+(side===0||side===6?sx*Math.PI/6:0),rr=r*Math.cos(Math.PI/12)+.13,yy=level?upperY:.24+height*.36,scale=level?Math.max(.35,upperScale):1;
   const point=(u:number,y:number,out:number):V3=>[x+Math.sin(angle)*out+Math.cos(angle)*u,y,z-Math.cos(angle)*out+Math.sin(angle)*u];
   // Reserve the entire frame and a small gap from structural timber.
   const local=(p:V3):V3=>[(p[0]-x)*Math.cos(angle)+(p[2]-z)*Math.sin(angle),p[1]-yy,(p[0]-x)*Math.sin(angle)-(p[2]-z)*Math.cos(angle)-rr];
   const blocked=a.plan.pieces.some(p=>{
    if(p.support!==tower||p.material!=='wood'||p.kind!=='beam'||!p.end||p.role.startsWith('fortress-window'))return false;
    const start=local(p.position),end=local(p.end),padding=p.size[0]/2+.10;
    const min=[-.23*scale-padding,-.43*scale-padding,-.06-padding],max=[.23*scale+padding,.43*scale+padding,.22+padding];
    let enter=0,leave=1;
    for(let axis=0;axis<3;axis++){
     const delta=end[axis]-start[axis];
     if(Math.abs(delta)<1e-8){if(start[axis]<min[axis]||start[axis]>max[axis])return false;continue;}
     const a=(min[axis]-start[axis])/delta,b=(max[axis]-start[axis])/delta;
     enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
     if(enter>leave)return false;
    }
    return true;
   });
   if(blocked)continue;
   a.piece('cloth',point(0,yy,rr+.015),[.28*scale,.74*scale,0],'cloth','fortress-window-glow',tower,[0,-angle,0]);
   for(const u of [-.19*scale,.19*scale])a.beam(point(u,yy-.43*scale,rr+.055),point(u,yy+.43*scale,rr+.055),.085*scale,'wood','fortress-window-frame',tower);
   for(const y of [yy-.43*scale,yy+.43*scale])a.beam(point(-.23*scale,y,rr+.055),point(.23*scale,y,rr+.055),.10*scale,'wood','fortress-window-frame',tower);
   a.beam(point(0,yy-.32*scale,rr+.06),point(0,yy+.32*scale,rr+.06),.035*scale,'wood','fortress-window-mullion',tower);
   a.beam(point(-.13*scale,yy-.03,rr+.065),point(.13*scale,yy-.03,rr+.065),.035*scale,'wood','fortress-window-mullion',tower);
   a.piece('box',point(0,yy-.43*scale-.04,rr+.10),[.48*scale,.10,.22],'wood','fortress-window-sill',tower,[0,-angle,0]);
  }

  if(sz===-1){
   const bannerZ=z-(r+.12)*Math.cos(Math.PI/12)-.14,y=.24+wallH-.25-.92;
   const hanger=a.beam([x-.48,y+.92,bannerZ],[x+.48,y+.92,bannerZ],.065,'wood','fortress-banner-hanger',tower);
   for(const side of [-1,1])a.beam([x+side*.42,y+.92,bannerZ+.19],[x+side*.42,y+.92,bannerZ],.045,'metal','fortress-banner-mount',tower);
   pixelBanner(x,y,bannerZ,.70,1.8,hanger,'fortress-tower-standard');
  }
  for(let i=0;i<12;i++){
   const angle=(i+.5)*Math.PI/6;
   a.piece('box',[x+Math.sin(angle)*r,height-.12,z+Math.cos(angle)*r],[.22,.40,.28],'stone','fortress-corbel',tower,[0,angle,0]);
  }
  if(watchCorners.has(corner)){
   const loft=a.piece('column',[x,height+.83,z],[crownRadius*2+.06,1.15,crownRadius*2+.06],'wood','fortress-watch-loft',tower);
   const roof=a.piece('column',[x,height+2.25,z],[crownRadius*2+.70,1.7,.08],'roof','fortress-watch-roof',loft);
   a.piece('column',[x,height+.30,z],[crownRadius*2+.26,.12,crownRadius*2+.26],'wood','fortress-watch-loft',tower);
   for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,rr=(crownRadius+.03)*Math.cos(Math.PI/8)+.02;
    a.piece('box',[x+Math.sin(angle)*rr,height+.84,z-Math.cos(angle)*rr],[.44,.60,.035],'dark','fortress-watch-window',loft,[0,-angle,0]);
    a.piece('cloth',[x+Math.sin(angle)*(rr+.023),height+.84,z-Math.cos(angle)*(rr+.023)],[.40,.55,0],'cloth','fortress-window-glow',loft,[0,-angle,0]);
    const face=(u:number,y:number):V3=>[x+Math.sin(angle)*(rr+.035)+Math.cos(angle)*u,y,z-Math.cos(angle)*(rr+.035)+Math.sin(angle)*u];
    for(const u of [-.27,.27])a.beam(face(u,height+.47),face(u,height+1.20),.085,'wood','fortress-watch-window-frame',loft);
    for(const y of [height+.47,height+1.20])a.beam(face(-.31,y),face(.31,y),.10,'wood','fortress-watch-window-frame',loft);
    a.beam(face(0,height+.53),face(0,height+1.14),.045,'wood','fortress-watch-window-mullion',loft);
    const corner=angle+Math.PI/8,nextCorner=corner+Math.PI/4,cornerRadius=crownRadius+.055;
    const vertex=(t:number,y:number):V3=>[x+Math.sin(t)*cornerRadius,y,z-Math.cos(t)*cornerRadius];
    a.beam(vertex(corner,height+.30),vertex(corner,height+1.40),.13,'wood','fortress-watch-post',loft);
    for(const y of [height+.34,height+1.37])a.beam(vertex(corner,y),vertex(nextCorner,y),.13,'wood','fortress-watch-belt',loft);
    const radial=(crownRadius*2+.70)/2;
    a.piece('box',[x+Math.sin(angle)*(rr-.08),height+.10,z-Math.cos(angle)*(rr-.08)],[.14,.30,.22],'wood','fortress-watch-corbel',loft,[0,-angle,0]);
    a.beam([x+Math.sin(angle+Math.PI/8)*radial,height+1.4,z+Math.cos(angle+Math.PI/8)*radial],[x,height+3.12,z],.09,'wood','fortress-roof-rib',roof);
   }
   a.piece('column',[x,height+3.1,z],[.22,.14,.12],'wood','fortress-roof-peak',roof);
   continue;
  }
  a.piece('column',[x,height+.40,z],[crownRadius*2,.28,crownRadius*2],'stone','fortress-parapet',tower);
  for(let i=0;i<12;i++){
   const angle=(i+.5)*Math.PI/6;
   a.piece('box',[x+Math.sin(angle)*(crownRadius-.12),height+.77,z+Math.cos(angle)*(crownRadius-.12)],[r*.37,.62,.38],'stone','fortress-merlon',tower,[0,angle,0]);
  }
 }
 const curtain=(x:number,z:number,length:number,alongX:boolean,normal:number)=>{
  const size:V3=alongX?[length,wallH,thickness]:[thickness,wallH,length];
  const wall=a.piece('box',[x,.24+wallH/2,z],size,'stone','fortress-curtain',court);
  a.piece('box',[x,.12,z],alongX?[length,.24,thickness]:[thickness,.24,length],'stone','fortress-curtain-foot',wall);
  a.piece('box',[x,.24+wallH,z],alongX?[length,.22,1.45]:[1.45,.22,length],'stone','fortress-wall-walk',wall);
  if(!alongX){
   const deckLength=Math.max(.4,length-2*(r+.22)),deckY=.24+wallH+.17;
   const deck=a.piece('box',[x-normal*.23,deckY,z],[1.16,.08,deckLength],'wood','fortress-timber-walk',wall);
   const innerX=x-normal*.78,railLength=deckLength+.12;
   const railSpans=normal===-1?[[z-railLength/2,wallAccessStart],[wallAccessEnd,z+railLength/2]]:[[z-railLength/2,z+railLength/2]];
   for(const [start,end] of railSpans)if(end-start>.08)for(const y of [deckY+.32,deckY+.85])a.beam([innerX,y,start],[innerX,y,end],.10,'wood','fortress-walk-rail',deck);
   const posts=Math.max(2,Math.ceil(railLength/1.15));
   for(let i=0;i<=posts;i++){
    const zz=z-railLength/2+i*railLength/posts;
    if(normal===-1&&zz>wallAccessStart-.08&&zz<wallAccessEnd+.08)continue;
    a.beam([innerX,deckY-.04,zz],[innerX,deckY+.95,zz],.12,'wood','fortress-walk-post',deck);
    a.beam([x-normal*.47,deckY-.75,zz],[innerX,deckY-.05,zz],.13,'wood','fortress-walk-brace',wall);
    a.beam([x-normal*.43,deckY-.09,zz],[innerX,deckY-.09,zz],.14,'wood','fortress-walk-joist',deck);
   }
  }
  const face=(offset:number,yy:number,out:number):V3=>[x+(alongX?offset:normal*out),yy,z+(alongX?normal*out:offset)];
  const timberLength=length+.12,beltY=.24+wallH-.25;
  for(const yy of [beltY,beltY-.34])a.beam(face(-timberLength/2,yy,.59),face(timberLength/2,yy,.59),.16,'wood','fortress-curtain-timber-belt',wall);
  const timberPosts=Math.max(1,Math.ceil(timberLength/1.25));
  for(let i=0;i<=timberPosts;i++){
   const offset=-timberLength/2+i*timberLength/timberPosts;
   a.beam(face(offset,beltY-.48,.60),face(offset,beltY+.26,.60),.18,'wood','fortress-curtain-timber-post',wall);
   a.beam(face(offset,beltY-1.04,.48),face(offset,beltY-.10,.67),.15,'wood','fortress-curtain-timber-brace',wall);
  }
  const edge=normal*.55;
  a.piece('box',[x+(alongX?0:edge),.24+wallH+.26,z+(alongX?edge:0)],alongX?[length,.42,.32]:[.32,.42,length],'stone','fortress-parapet-wall',wall);
  const count=Math.max(2,Math.round(length/.95));
  for(let i=1;i<Math.floor(length/2.4);i++){
   const offset=-length/2+i*length/Math.floor(length/2.4),xx=x+(alongX?offset:normal*.65),zz=z+(alongX?normal*.65:offset);
   const buttress=a.piece('box',[xx,.24+wallH*.35,zz],alongX?[.50,wallH*.70,.85]:[.85,wallH*.70,.50],'stone','fortress-buttress',wall);
   a.piece('box',[xx,.18,zz],alongX?[.70,.36,1.08]:[1.08,.36,.70],'stone','fortress-buttress-foot',buttress);
   a.piece('box',[xx,.24+wallH*.70,zz],alongX?[.57,.16,.94]:[.94,.16,.57],'stone','fortress-buttress-cap',buttress);
  }
  // Lower timber panels occupy the sides and rear only.
  if(!alongX||normal===1){
  const blocked:[number,number][]=[];
  for(const id of towers){
   const t=a.plan.pieces.find(piece=>piece.id===id)!;
   const normalDistance=Math.abs((alongX?t.position[2]-z:t.position[0]-x)-normal*.60);
   if(normalDistance<r+.10){
    const projection=alongX?t.position[0]-x:t.position[2]-z,reach=Math.sqrt((r+.10)**2-normalDistance**2);
    blocked.push([projection-reach,projection+reach]);
   }
  }
  const pierCount=Math.floor(length/2.4);
  for(let i=1;i<pierCount;i++){const offset=-length/2+i*length/pierCount;blocked.push([offset-.30,offset+.30]);}
  if(alongX&&normal===-1){const clear=Math.min(2.5,w*.19)/2+.46;blocked.push([-x-clear,-x+clear]);}
  blocked.sort((a,b)=>a[0]-b[0]);
  const bays:[number,number][]=[];let cursor=-length/2;
  for(const [left,right] of blocked){if(left>cursor)bays.push([cursor,Math.min(left,length/2)]);cursor=Math.max(cursor,right);}
  if(cursor<length/2)bays.push([cursor,length/2]);
  for(const [left,right] of bays){
   const lo=left+.03,hi=right-.03;if(hi-lo<.45)continue;
   const panelDepth=.72;
   // A framed rectangular panel, with short balusters rather than stacked fence rails.
   for(const yy of [.92,1.53])a.beam(face(lo,yy,panelDepth),face(hi,yy,panelDepth),.19,'wood','fortress-lower-wall-rail',wall);
   const divisions=Math.max(2,Math.round((hi-lo)/.50));
   for(let i=1;i<divisions;i++){
    const offset=lo+i*(hi-lo)/divisions;
    a.beam(face(offset,1.02,panelDepth),face(offset,1.43,panelDepth),.085,'wood','fortress-lower-wall-baluster',wall);
   }
   for(const offset of [lo,hi]){
    const foot=a.piece('box',face(offset,.09,panelDepth),alongX?[.28,.18,.30]:[.30,.18,.28],'wood','fortress-lower-wall-foot',wall);
    a.beam(face(offset,.18,panelDepth),face(offset,1.76,panelDepth),.18,'wood','fortress-lower-wall-post',foot);
    a.beam(face(offset,.43,.47),face(offset,.84,panelDepth),.16,'wood','fortress-lower-wall-brace',wall);
    a.beam(face(offset,.84,.47),face(offset,.84,panelDepth),.16,'wood','fortress-lower-wall-joist',wall);
    for(const yy of [.93,1.53]){
     a.piece('box',face(offset,yy,panelDepth),alongX?[.26,.23,.26]:[.26,.23,.26],'wood','fortress-lower-wall-joint',foot);
     a.piece('box',face(offset,yy,panelDepth+.15),alongX?[.06,.06,.025]:[.025,.06,.06],'metal','fortress-lower-wall-bolt',foot);
    }
   }
  }
  }
  for(let i=0;i<count;i++)a.piece('box',[x+(alongX?-length/2+(i+.5)*length/count:edge),.24+wallH+.73,z+(alongX?edge:-length/2+(i+.5)*length/count)],alongX?[length/count*.52,.55,.38]:[.38,.55,length/count*.52],'stone','fortress-merlon',wall);
  return wall;
 };
 curtain(0,tz,tx*2,true,1);
 for(const side of [-1,1])curtain(side*tx,0,tz*2,false,side);
 const gap=Math.min(2.5,w*.19),spring=Math.min(2.05,wallH*.57),gateH=Math.max(wallH+.15,spring+gap/2+.55);
 const wings=(tx*2-gap)/2;
 for(const side of [-1,1])curtain(side*(gap/2+wings/2),-tz,wings,true,-1);
 const gate=a.piece('box',[0,.24,-tz],[gap,gateH,thickness],'stone','fortress-gate-wall',court);
 a.piece('box',[0,.24+spring/2,-tz+.12],[gap,spring,.16],'wood','fortress-gate',gate);
 a.piece('arch',[0,.24+spring,-tz-.55],[gap,1,.22],'stone','fortress-gate-arch',gate);
 for(const side of [-1,1]){
  a.piece('box',[side*(gap/2+.11),(spring+.24)/2,-tz-.54],[.22,spring+.24,.28],'stone','fortress-gate-jamb',gate);
  for(const y of [.65,1.55])a.piece('box',[side*gap*.25,.24+y,-tz+.01],[gap*.46,.10,.05],'metal','fortress-gate-strap',gate);
  for(const y of [.65,1.55])for(const offset of [-.18,.18])a.piece('box',[side*gap*.25+offset,.24+y,-tz-.025],[.045,.045,.035],'metal','fortress-gate-rivet',gate);
  a.piece('wheel',[side*.19,1.18,-tz-.025],[.14,.14,.035],'metal','fortress-door-knocker',gate);
  const pole=a.beam([side*(gap/2+.7),.24+gateH-.1,-tz-.65],[side*(gap/2+.7),.24+gateH+1.6,-tz-.65],.06,'wood','fortress-flagpole',gate);
  pixelBanner(side*(gap/2+.94),.24+gateH+1.0,-tz-.65,.48,1.1,pole,'fortress-banner');
 }
 const seamHeight=spring+gap/2-.006;
 a.piece('box',[0,.24+seamHeight/2,-tz+.02],[.055,seamHeight,.06],'metal','fortress-gate-seam',gate);
 a.piece('box',[0,.24+gateH,-tz],[gap+.55,.22,1.45],'stone','fortress-gate-cornice',gate);
 a.piece('box',[0,.24+spring+gap/2+.12,-tz-.60],[.28,.38,.30],'stone','fortress-arch-keystone',gate);
 // A single timber fascia continues over the gate; the canopy sits beneath it.
 const archTop=.24+spring+gap/2,frontZ=-tz-.65,frontBelt=.24+wallH-.25;
 const canopyWidth=gap+.80,canopyDepth=.95,canopyRise=.38,canopyBack=-tz-.78,canopyFront=canopyBack-canopyDepth,canopyLow=frontBelt-.46;
 const headerY=Math.max(frontBelt,archTop+.36);
 const header=a.beam([-gap/2-.80,headerY,frontZ],[gap/2+.80,headerY,frontZ],.22,'wood','fortress-front-header',gate);
 // Side frames meet the wall belts rather than forming a second frame above the roof.
 for(const side of [-1,1]){
  const xx=side*(gap/2+.48);
  const foot=a.piece('box',[xx,.22,frontZ],[.48,.44,.48],'stone','fortress-front-post-foot',gate);
  a.beam([xx,.44,frontZ],[xx,headerY+.13,frontZ],.25,'wood','fortress-front-post',foot);
  for(const yy of [.61,canopyLow-.12,headerY+.03]){
   a.piece('box',[xx,yy,frontZ],[.34,.16,.32],'wood','fortress-front-post-collar',foot);
   a.piece('box',[xx,yy,frontZ-.18],[.065,.065,.025],'metal','fortress-front-post-bolt',foot);
  }
  a.beam([side*(gap/2+.27),frontBelt-.34,frontZ],[side*(gap/2+.80),frontBelt-.34,frontZ],.16,'wood','fortress-front-junction',gate);
  a.beam([xx,canopyLow-.86,frontZ],[xx,canopyLow-.10,canopyFront+.08],.18,'wood','fortress-canopy-brace',gate);
  a.beam([xx,canopyLow-.10,frontZ],[xx,canopyLow-.10,canopyFront+.08],.18,'wood','fortress-canopy-joist',header);
 }
 const canopy=a.piece('box',[0,canopyLow+canopyRise/2,(canopyBack+canopyFront)/2],[canopyWidth,.10,Math.hypot(canopyDepth,canopyRise)],'roof','fortress-gate-canopy',header,[-Math.atan2(canopyRise,canopyDepth),0,0]);
 for(const zz of [canopyFront,canopyBack]){
  const yy=zz===canopyFront?canopyLow:canopyLow+canopyRise;
  a.beam([-canopyWidth/2,yy-.04,zz],[canopyWidth/2,yy-.04,zz],.14,'wood','fortress-canopy-fascia',canopy);
 }
 for(const side of [-1,1])a.beam([side*canopyWidth/2,canopyLow-.04,canopyFront],[side*canopyWidth/2,canopyLow+canopyRise-.04,canopyBack],.14,'wood','fortress-canopy-edge',canopy);
 a.piece('box',[0,.24+gateH+.26,-tz-.55],[gap,.42,.32],'stone','fortress-gate-parapet',gate);
 for(let i=0;i<4;i++)a.piece('box',[-gap/2+(i+.5)*gap/4,.24+gateH+.73,-tz-.55],[gap*.14,.55,.38],'stone','fortress-gate-merlon',gate);
 a.piece('box',[0,.12,-tz-.3],[gap+.35,.24,.8],'stone','fortress-entry-threshold',court);
 a.stairs([0,0,-tz-1.2],[0,.24,-tz-.65],gap+.35);
 a.stairs([-tx+1.45,.24,-tz+r+.3],[-tx+1.45,wallAccessTop,wallAccessStart],1.25);
 const accessLeft=-tx+.81,accessRight=-tx+2.10;
 const wallLanding=a.piece('box',[(accessLeft+accessRight)/2,wallAccessTop-.12,(wallAccessStart+wallAccessEnd)/2],[accessRight-accessLeft,.24,wallAccessEnd-wallAccessStart],'stone','fortress-stair-landing',court);
 for(const [x,z] of [[accessRight,wallAccessStart],[accessRight,wallAccessEnd],[accessLeft-.03,wallAccessEnd],[accessLeft-.03,wallAccessStart]])a.beam([x,wallAccessTop,z],[x,wallAccessTop+.90,z],.11,'wood','fortress-stair-landing-post',wallLanding);
 for(const y of [wallAccessTop+.28,wallAccessTop+.80]){
  a.beam([accessRight,y,wallAccessStart],[accessRight,y,wallAccessEnd],.10,'wood','fortress-stair-landing-rail',wallLanding);
  a.beam([accessLeft-.03,y,wallAccessEnd],[accessRight,y,wallAccessEnd],.10,'wood','fortress-stair-landing-rail',wallLanding);
 }
 const hallDepth=d*.19,hallZ=tz-.70-Math.min(p.eaves,.45)-hallDepth/2;
 const hall=a.building(w*.10,hallZ,w*.28,hallDepth,h*.66,1,{base:.24,material:'stone',roof:p.roof==='auto'?'gable':p.roof,role:'barracks'});
 // The masonry wall already includes its gable; an added frame creates a ledge.
 const hallFoundation=a.plan.supports.find(s=>s.component===hall.id+'_wall_0')!.on;
 for(const piece of a.plan.pieces)if(piece.support===hallFoundation&&piece.role==='wall-frame'&&piece.material==='stone')piece.removed=true;
 const hallFront=a.plan.walls.find(w=>w.id===hall.id+'_wall_0')!;
 if(hallFront.gable){
  const width=Math.min(.65,hall.width*.13),height=Math.min(.85,hallFront.gable.peak*.38),offset=hall.width*(hallFront.gable.ratio-.5),bottom=Math.max(hall.height-.65,hall.height*.58+1.04);
  a.plan.openings.push({id:hallFront.id+'_gable_window',wall:hallFront.id,kind:'window',offset,width,bottom,height});
 }
 a.plan.roofs.find(roof=>roof.volume===hall.id)!.eaves=Math.min(p.eaves,.45);
 const galleryZ=hall.z-hall.depth/2-.55,galleryY=.24+hall.height*.58;
 // The house has a window only in the gable, leaving the gallery walls solid.
 a.plan.openings=a.plan.openings.filter(o=>!o.wall.startsWith(hall.id+'_wall_')||o.kind!=='window'||o.id.endsWith('_gable_window'));
 const gallery=a.piece('box',[hall.x,galleryY,galleryZ],[hall.width,.16,1.1],'wood','fortress-gallery',court);
 const hallDoor=a.plan.openings.find(o=>o.wall===hall.id+'_wall_0'&&o.kind==='door')!;
 const doorX=hall.x+hallDoor.offset,doorClearance=hallDoor.width/2+.24;
 for(let i=0;i<5;i++){
  const x=hall.x-hall.width/2+.15+i*(hall.width-.30)/4;
  if(Math.abs(x-doorX)<doorClearance)continue;
  a.beam([x,.24,galleryZ-.38],[x,galleryY+.86,galleryZ-.38],.11,'wood','fortress-gallery-post',gallery);
  a.beam([x,galleryY-.70,galleryZ-.38],[x,galleryY-.08,galleryZ+.40],.10,'wood','fortress-gallery-brace',gallery);
 }
 for(const y of [galleryY+.20,galleryY+.73])a.beam([hall.x-hall.width/2,y,galleryZ-.38],[hall.x+hall.width/2,y,galleryZ-.38],.085,'wood','fortress-gallery-rail',gallery);
 const galleryLeft=hall.x-hall.width/2;
 for(const z of [galleryZ-.38,galleryZ+.46])a.beam([galleryLeft,galleryY-.08,z],[galleryLeft,galleryY+.86,z],.11,'wood','fortress-gallery-end-post',gallery);
 for(const y of [galleryY+.20,galleryY+.73])a.beam([galleryLeft,y,galleryZ-.38],[galleryLeft,y,galleryZ+.46],.085,'wood','fortress-gallery-end-rail',gallery);
 // The gallery wraps the right corner; the outboard stair climbs toward its side landing.
 const hallRight=hall.x+hall.width/2,sideSpace=tx-thickness/2-hallRight-.12;
 const sideWidth=Math.min(1.1,sideSpace*.52),stairWidth=Math.min(.9,sideSpace-sideWidth-.06);
 const sideX=hallRight+sideWidth/2,stairX=hallRight+sideWidth+stairWidth/2,sideEnd=hall.z+.15,sideStart=galleryZ-.55;
 const landingStart=sideEnd-.65,landingEnd=sideEnd+.40;
 const sideGallery=a.piece('box',[sideX,galleryY,(sideStart+landingStart)/2],[sideWidth,.16,landingStart-sideStart],'wood','fortress-gallery-side',gallery);
 a.stairs([stairX,.24,galleryZ+.10],[stairX,galleryY,landingStart],stairWidth);
 const landing=a.piece('box',[hallRight+(sideWidth+stairWidth)/2,galleryY,(landingStart+landingEnd)/2],[sideWidth+stairWidth,.16,landingEnd-landingStart],'wood','fortress-gallery-landing',sideGallery);
 const landingOuter=hallRight+sideWidth+stairWidth-.06,landingBack=landingEnd-.06;
 for(const [x,z] of [[hallRight+.06,landingBack],[landingOuter,landingBack],[landingOuter,landingStart+.06]])a.beam([x,galleryY-.08,z],[x,galleryY+.86,z],.11,'wood','fortress-gallery-landing-post',landing);
 for(const y of [galleryY+.20,galleryY+.73]){
  a.beam([hallRight+.06,y,landingBack],[landingOuter,y,landingBack],.085,'wood','fortress-gallery-landing-rail',landing);
  a.beam([landingOuter,y,landingStart+.06],[landingOuter,y,landingBack],.085,'wood','fortress-gallery-landing-rail',landing);
 }
 for(const z of [sideStart+.15,landingStart-.06]){
  a.beam([sideX+sideWidth/2-.08,.24,z],[sideX+sideWidth/2-.08,galleryY+.86,z],.11,'wood','fortress-gallery-side-post',sideGallery);
  a.beam([sideX+sideWidth/2-.08,galleryY-.65,z],[hallRight+.05,galleryY-.08,z],.10,'wood','fortress-gallery-brace',sideGallery);
 }
 for(const y of [galleryY+.20,galleryY+.73]){
  a.beam([hall.x+hall.width/2,y,galleryZ-.38],[sideX+sideWidth/2-.08,y,galleryZ-.38],.085,'wood','fortress-gallery-rail',sideGallery);
  a.beam([sideX+sideWidth/2-.08,y,sideStart+.15],[sideX+sideWidth/2-.08,y,landingStart-.06],.085,'wood','fortress-gallery-rail',sideGallery);
 }
 // Put the store beside the hall, opposite the gallery stair, clear of the wall stair.
 const storeEaves=Math.min(.25,p.eaves),storeRight=hall.x-hall.width/2-1.3;
 const storeLeftLimit=-tx+1.45+1.25/2+.22;
 const storeWidth=Math.min(w*.15,Math.max(.8,storeRight-storeLeftLimit-storeEaves));
 const storeDepth=d*.16,storeZ=hall.z;
 const store=a.building(storeRight-storeWidth/2,storeZ,storeWidth,storeDepth,wallH*.60,1,{base:.24,material:'wood',roof:p.roof==='auto'?'shed':p.roof,role:'fortress-store'});
 a.plan.roofs.find(roof=>roof.volume===store.id)!.eaves=storeEaves;
 for(let i=0;i<4;i++){
  const x=storeRight+.40,z=store.z-store.depth/2+.25+(i%2)*.65,base=.24+Math.floor(i/2)*.5;
  const crate=a.piece('box',[x,base+.25,z],[.52,.5,.52],'wood','fortress-supply-crate',court);
  for(const yy of [base+.07,base+.40])a.piece('box',[x,yy,z],[.56,.065,.56],'metal','fortress-crate-band',crate);
 }
 // Supplies sit on the court or beside the entry, clear of the main passage.
 for(const [x,z] of [[storeRight+.90,store.z-store.depth/2-.65],[storeRight+.90,store.z-store.depth/2-1.40],[gap/2+1.15,-tz-1.25]]){
  const outside=z<-tz,baseY=outside?0:.24;
  const barrel=a.piece('column',[x,baseY+.40,z],[.68,.80,.68],'wood','fortress-barrel',outside?'ground':court);
  for(const y of [-.27,.27])a.piece('column',[x,baseY+.40+y,z],[.66,.055,.66],'metal','fortress-barrel-hoop',barrel);
  a.piece('column',[x,baseY+.80,z],[.54,.035,.54],'wood','fortress-barrel-lid',barrel);
 }
 const wellX=-w*.16,wellZ=-d*.16;
 const well=a.piece('column',[wellX,.57,wellZ],[1.45,.66,1.45],'stone','fortress-well',court);
 a.piece('column',[wellX,.93,wellZ],[1.60,.12,1.60],'stone','fortress-well-rim',well);
 a.piece('column',[wellX,.29,wellZ],[1,.05,1],'dark','fortress-well-depth',well);
 for(const side of [-1,1])a.beam([wellX+side*.68,.24,wellZ],[wellX+side*.68,2.18,wellZ],.10,'wood','fortress-well-post',well);
 a.beam([wellX-.78,2.18,wellZ],[wellX+.78,2.18,wellZ],.13,'wood','fortress-well-crossbeam',well);
 a.beam([wellX-.78,1.65,wellZ],[wellX+.78,1.65,wellZ],.10,'wood','fortress-well-winch',well);
 a.beam([wellX,1.65,wellZ],[wellX,.45,wellZ],.025,'metal','fortress-well-rope',well);
 const benchX=-gap/2-.2-1.65/2,benchZ=-tz+thickness/2+.33;
 const bench=a.piece('box',[benchX,.70,benchZ],[1.65,.12,.43],'wood','fortress-bench',court);
 for(const side of [-1,1])a.piece('box',[benchX+side*.58,.44,benchZ],[.12,.40,.32],'wood','fortress-bench-leg',bench);
 for(const side of [-1,1]){
  a.beam([benchX+side*.66,.66,benchZ-.20],[benchX+side*.66,1.20,benchZ-.20],.07,'wood','fortress-bench-back-post',bench);
 }
 a.piece('box',[benchX,1.10,benchZ-.20],[1.65,.18,.08],'wood','fortress-bench-back',bench);
 return a.finish();
}
