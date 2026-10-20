import {Architect} from '../blueprint';
import type {GrammarContext,VolumeSpec,V3} from '../types';

/** Square royal stronghold: accessible outer defences and a stepped central keep. */
export function royalCastle(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.05),d=a.value(p.depth,.05),h=Math.max(6,a.value(p.height,.06));
 // Expand the enclosure independently of the keep and courtyard buildings.
 const enclosureW=w*1.25,enclosureD=d*1.25;
 const base=.30,tw=Math.min(w,d)*.145,tx=enclosureW/2-tw/2,tz=enclosureD/2-tw/2,originalWallH=h*.52,wallH=originalWallH*1.12,walkY=base+wallH;
 const court=a.piece('box',[0,base/2,0],[enclosureW-tw,base,enclosureD-tw],'stone','castle-court');
 const foundation=(v:VolumeSpec)=>a.plan.pieces.find(x=>x.role==='foundation'&&x.position[0]===v.x&&x.position[2]===v.z)!;
 const banner=(x:number,y:number,z:number,width:number,height:number,support:string,rotation=0)=>{
  a.piece('cloth',[x,y,z],[width,height,.01],'cloth','castle-banner',support,[0,rotation,0]);
  a.beam([x-width*.58,y+height/2+.09,z],[x+width*.58,y+height/2+.09,z],.09,'metal','castle-banner-bar',support);
  a.plan.openings=a.plan.openings.filter(o=>{
   if(o.kind!=='window')return true;
   const wall=a.plan.walls.find(w=>w.id===o.wall)!,volume=a.plan.volumes.find(v=>v.id===wall.volume)!;
   const dx=wall.end[0]-wall.start[0],dz=wall.end[2]-wall.start[2],length=Math.hypot(dx,dz),px=x-(wall.start[0]+wall.end[0])/2,pz=z-(wall.start[2]+wall.end[2])/2;
   return Math.abs((px*dz-pz*dx)/length)>.45||Math.abs((px*dx+pz*dz)/length-o.offset)>(width+o.width)/2+.18||volume.bottom+o.bottom+o.height<y-height/2||volume.bottom+o.bottom>y+height/2;
  });
 };
 const crown=(x:number,z:number,ww:number,dd:number,y:number,support:string,role='castle-crenel')=>{
  const t=.28;
  for(const side of [-1,1]){
   a.piece('box',[x+side*(ww/2-t/2),y+.24,z],[t,.48,dd],'stone','castle-parapet',support);
   a.piece('box',[x,y+.24,z+side*(dd/2-t/2)],[ww-t*2,.48,t],'stone','castle-parapet',support);
   for(const axis of [0,2] as const){
    const length=axis===0?ww:dd,n=Math.max(0,Math.floor((length-t)/.95)-1),spacing=(length-t)/(n+1);
    for(let i=0;i<n;i++){
     const along=-length/2+t/2+(i+1)*spacing;
     a.piece('box',[x+(axis===0?along:side*(ww/2-t/2)),y+.68,z+(axis===2?along:side*(dd/2-t/2))],[.48,.46,.48],'stone',role,support);
    }
   }
  }
  for(const sx of [-1,1])for(const sz of [-1,1])a.piece('box',[x+sx*(ww/2-t/2),y+.68,z+sz*(dd/2-t/2)],[.48,.46,.48],'stone',role,support);
 };
 const wallTowerRoof=c.streams.streamFor('architecture','wall-tower-roofs');
 const royalBuilding=(x:number,z:number,ww:number,dd:number,height:number,role:string,floors=1,bottom=base,roofKind:'hip'|'flat'|'gable'='hip')=>{
  const v=a.building(x,z,ww,dd,height,floors,{base:bottom,material:'stone',roof:['corner-tower','gate-tower'].includes(role)&&roofKind==='flat'?'flat':p.roof==='auto'?roofKind:p.roof,door:false,role});
  a.plan.openings=a.plan.openings.filter(o=>!o.wall.startsWith(v.id+'_'));
  const roof=a.plan.roofs.find(r=>r.volume===v.id)!;
  if(roof.kind==='hip')roof.rise=Math.min(ww,dd)*(.68+p.roofPitch*.20)*1.25;
  if(roof.kind==='flat'){roof.material='stone';roof.eaves=.12;roof.rise=0;}
  if(['corner-tower','gate-tower'].includes(role)&&roof.kind==='flat'){roof.width=ww+1.25;roof.depth=dd+1.25;roof.y=bottom+height-.06;roof.flatThickness=.16;roof.plainEdge=true;a.piece('box',[x,bottom+height-.60,z],[ww+1.25,1.10,dd+1.25],'stone','castle-tower-crown-base',foundation(v).id);crown(x,z,ww+1.25,dd+1.25,roof.y+.16,roof.id);}
  roof.eaves=['corner-tower','gate-tower'].includes(role)&&roof.kind==='flat'?0:Math.min(.35,p.eaves);
  roof.royalTrim=true;
  const timberCrown=roof.kind==='hip'&&['corner-tower','keep-turret'].includes(role);
  if(roof.kind==='hip'&&['corner-tower','keep-turret','gate-tower','high-keep'].includes(role)){
   roof.width+=.95;roof.depth+=.95;roof.eaves=.18;
  }
  if(roof.kind==='hip'&&(role==='high-keep'||role==='gate-tower')){
   roof.width=ww+.25;roof.depth=dd+.25;roof.y+=.12;roof.eaves=.08;
   a.piece('box',[x,bottom+height+.06,z],[roof.width,.12,roof.depth],'stone','castle-roof-seat',foundation(v).id);
   a.piece('box',[x,bottom+height-.60,z],[ww+1.25,1.10,dd+1.25],'stone','castle-tower-crown-base',foundation(v).id);
  }
  for(const piece of a.plan.pieces.filter(x=>x.support===foundation(v).id&&x.role==='wall-frame'))piece.size=[.22,.22,.22];
  if(bottom>base+.01){const f=foundation(v);f.size[1]=.16;f.position[1]=bottom-.08;}
  // Slender masonry windows replace domestic shutters and broad timber frames.
  for(const wall of a.plan.walls.filter(w=>w.volume===v.id)){
   if(role==='keep-turret')continue;
   const length=Math.hypot(wall.end[0]-wall.start[0],wall.end[2]-wall.start[2]);
   const levels=role==='high-keep'?1:role==='keep'?2:height>h?3:2;
   for(let level=0;level<levels;level++){
    const bottom=role==='high-keep'?Math.max(2.35,height*.45):height*(.24+level*.24),heightWindow=role==='high-keep'?Math.min(2.1,height*.38):Math.min(1.10,height*.13),width=Math.min(role==='high-keep'?.75:.52,length*.20);
    if(bottom+heightWindow>height-.6)continue;
    const openingHeight=Math.min(heightWindow,height-(['gate-tower','high-keep'].includes(role)?1.30:.60)-bottom);
    if(openingHeight<.35)continue;
    const count=role==='keep'?3:1;
    for(let i=0;i<count;i++)a.plan.openings.push({id:wall.id+'_slit_'+level+'_'+i,wall:wall.id,kind:'window',arched:true,offset:count===1?0:(i-1)*length*.25,width,bottom,height:openingHeight});
   }
  }
  const y=bottom+height;
  if((roof.kind==='hip'&&['gate-tower','high-keep'].includes(role))||(roof.kind==='flat'&&['corner-tower','gate-tower'].includes(role))){
   const crownBottom=y-1.15;
   for(const axis of [0,2] as const)for(const side of [-1,1]){
    const length=axis===0?ww:dd,wall=axis===0?dd/2:ww/2,count=Math.max(2,Math.ceil(length/1.3));
    const wallId=v.id+'_wall_'+(axis===0?(side<0?0:2):(side<0?3:1));
    for(let i=0;i<count;i++){
     const along=-length/2+.28+(length-.56)*i/(count-1);
     if(a.plan.openings.some(o=>o.wall===wallId&&Math.abs(along-o.offset)<o.width/2+.22&&bottom+o.bottom+o.height>crownBottom-.55))continue;
     for(const [offset,drop,depth,thickness,width] of [[.24,.10,.84,.20,.32],[.12,.29,.52,.18,.28],[.035,.465,.33,.17,.24]]){
      a.piece('box',axis===0?[x+along,crownBottom-drop,z+side*(wall+offset)]:[x+side*(wall+offset),crownBottom-drop,z+along],axis===0?[width,thickness,depth]:[depth,thickness,width],'stone','castle-stone-corbel',foundation(v).id);
     }
    }
   }
  }
  for(const side of [-1,1]){
   a.piece('box',[x+side*(ww/2+.06),y-.20,z],[.25,.28,dd+.25],'stone','castle-cornice',v.id+'_roof');
   a.piece('box',[x,y-.20,z+side*(dd/2+.06)],[ww,.28,.25],'stone','castle-cornice',v.id+'_roof');
   if(roof.kind==='hip'&&!timberCrown&&!['gate-tower','high-keep'].includes(role))for(let i=0;i<Math.max(2,Math.ceil(ww/.85));i++){
    const n=Math.max(2,Math.ceil(ww/.85)),xx=x-ww/2+(i+.5)*ww/n;
    a.piece('box',[xx,y-.42,z+side*(dd/2+.09)],[.20,.36,.25],'wood','castle-roof-corbel',v.id+'_roof');
   }
  }
  if(timberCrown){
   const projection=['gate-tower','high-keep'].includes(role)?.65:.44;
   const halfX=ww/2+projection,halfZ=dd/2+projection,support=foundation(v).id;
   for(const sx of [-1,1])for(const sz of [-1,1])a.beam([x+sx*halfX,y-.62,z+sz*halfZ],[x+sx*halfX,y+.02,z+sz*halfZ],.22,'wood','castle-tower-crown-post',support);
   for(const axis of [0,2] as const)for(const side of [-1,1]){
    const half=axis===0?halfX:halfZ,wall=axis===0?dd/2:ww/2,outer=wall+projection;
    const point=(along:number,yy:number,out:number):V3=>axis===0?[x+along,yy,z+side*out]:[x+side*out,yy,z+along];
    for(const yy of [y-.32,y-.10])a.beam(point(-half+.11,yy,outer),point(half-.11,yy,outer),.18,'wood','castle-tower-crown-belt',support);
    const count=Math.max(2,Math.ceil(half*2/1.35)),seatSpan=(axis===0?ww:dd)/2-.18;
    for(let i=0;i<count;i++){
     const along=-seatSpan+seatSpan*2*i/(count-1);
     a.beam(point(along,y-.56,outer),point(along,y+.02,outer),.18,'wood','castle-tower-crown-post',support);
     a.beam(point(along,y-.98,wall-.06),point(along,y-.40,outer),.20,'wood','castle-tower-crown-brace',support);
     a.beam(point(along,y-.40,wall-.06),point(along,y-.40,outer),.20,'wood','castle-tower-crown-joist',support);
    }
   }
  }
  if(roof.kind==='hip'){
   const peak=roof.y+roof.rise+.20;
   a.piece('box',[x,peak-.06,z],[.30,.35,.30],'wood','castle-roof-joint',roof.id);
   a.beam([x,peak,z],[x,peak+1.20,z],.065,'metal','castle-flag-pole',roof.id);
   a.piece('cloth',[x+.53,peak+.82,z],[1.02,.48,.01],'cloth','castle-standard',roof.id);
   a.piece('box',[x,peak+1.24,z],[.12,.18,.12],'cloth','castle-flag-finial',roof.id);
  }
  return v;
 };
 const door=(v:VolumeSpec,side:number,y:number,width=1.12,offset=0)=>{
  const wall=a.plan.walls.find(w=>w.id===v.id+'_wall_'+side)!;
  width=Math.min(width,Math.hypot(wall.end[0]-wall.start[0],wall.end[2]-wall.start[2])-.24);
  const maxOffset=Math.max(0,(Math.hypot(wall.end[0]-wall.start[0],wall.end[2]-wall.start[2])-width)/2-.12);offset=Math.max(-maxOffset,Math.min(maxOffset,offset));
  const doorHeight=Math.min(2.1,v.bottom+v.height-y-.20);
  a.plan.openings=a.plan.openings.filter(o=>o.wall!==wall.id||Math.abs(o.offset-offset)>(o.width+width)/2+.18||o.bottom+o.height<y-v.bottom-.12||o.bottom>y-v.bottom+doorHeight+.12);
  a.plan.openings.push({id:wall.id+'_passage_'+y,wall:wall.id,kind:'door',arched:true,offset,width,bottom:y-v.bottom,height:doorHeight});
 };
 const doorGallery=(x:number,z:number,length:number,axis:0|2,outside:number,support:string,doorWidth=0,doorAlong=0)=>{
  const floorY=walkY+.03;
  const deck=a.piece('box',[x,floorY-.08,z],axis===0?[length,.16,.72]:[.72,.16,length],'wood','castle-door-gallery',support);
  const point=(along:number,y:number,out:number):V3=>axis===0?[x+along,y,z+outside*out]:[x+outside*out,y,z+along];
  const gap=doorWidth>0?doorWidth/2+.18:0,intervals=gap>0?[[-length/2,doorAlong-gap],[doorAlong+gap,length/2]]:[[-length/2,length/2]];
  for(const [lo,hi] of intervals)if(hi>lo)for(const yy of [.34,.82])a.beam(point(lo,floorY+yy,.31),point(hi,floorY+yy,.31),.12,'wood','castle-gallery-rail',deck);
  const count=Math.max(2,Math.ceil(length/1.3));
  for(let i=0;i<=count;i++){
   const along=-length/2+length*i/count;
   if(gap>0&&Math.abs(along-doorAlong)<gap)continue;
   a.beam(point(along,floorY,.31),point(along,floorY+.91,.31),.12,'wood','castle-gallery-post',deck);
   const seat=point(along,floorY-.65,-.43),tip=point(along,floorY-.12,.24);a.beam(seat,tip,.16,'wood','castle-gallery-brace',support);
  }
  return deck;
 };
 const towerWalk=(v:VolumeSpec,sx:number,sz:number)=>{
  const f=foundation(v).id;
  a.piece('box',[v.x,walkY-.06,v.z],[v.width,.12,v.depth],'wood','floor',f);
  door(v,sz===-1?2:0,base);
  const xSide=sx===-1?1:3;
  door(v,xSide,walkY);
  if(v.role==='corner-tower'){
   const zSide=sz===-1?2:0;
   door(v,zSide,walkY);
  }else if(v.role==='gate-tower'){
   const outerSide=sx===-1?3:1;
   door(v,outerSide,walkY);
  }
  a.stairs([v.x-v.width*.22,base,v.z-v.depth*.32],[v.x-v.width*.22,walkY,v.z+v.depth*.32],Math.min(1.1,v.width*.5));
  a.plan.accesses.push({id:v.id+'_walk',from:[v.x,walkY,v.z],to:[v.x-sx*v.width/2,walkY,v.z],width:1.1,role:'wall-walk'});
 };
 const galleryEntryZ=tz-tw/2-1.10,galleryEntryWidth=1.55;
 const wallCrown=(x:number,z:number,length:number,axis:0|2,body:string,openingWidth=0)=>{
  const outside=Math.sign(axis===0?z:x),n=Math.max(2,Math.ceil(length/.95));
  const edgePoint=(along:number,y:number,out:number):V3=>axis===0?[x+along,y,z+outside*out]:[x+outside*out,y,z+along];
  // The outer crown projects from the wall; its inner edge leaves the walk clear.
  a.piece('box',edgePoint(0,walkY-.43,.785),axis===0?[length,1.10,.93]:[.93,1.10,length],'stone','castle-curtain-crown-base',body);
  a.piece('box',edgePoint(0,walkY+.36,1.11),axis===0?[length,.48,.28]:[.28,.48,length],'stone','castle-curtain-parapet',body);
  for(let i=0;i<n;i++)a.piece('box',edgePoint(-length/2+(i+.5)*length/n,walkY+.80,1.11),[.48,.46,.48],'stone','crenel',body);
  const corbels=Math.max(2,Math.ceil(length/1.3));
  for(let i=0;i<corbels;i++){
   const along=-length/2+.28+(length-.56)*i/(corbels-1);
   if(openingWidth>0&&Math.abs(along)<openingWidth/2+.32)continue;
   for(const [offset,drop,depth,thickness,width] of [[.24,.10,.84,.20,.32],[.12,.29,.52,.18,.28],[.035,.465,.33,.17,.24]])a.piece('box',edgePoint(along,walkY-.98-drop,.60+offset),axis===0?[width,thickness,depth]:[depth,thickness,width],'stone','castle-stone-corbel',body);
  }
 };
 const curtain=(x:number,z:number,length:number,axis:0|2,entry?:number)=>{
  if(length<.1)return;
  const thickness=1.2,body=a.piece('box',[x,base+wallH/2,z],axis===0?[length,wallH,thickness]:[thickness,wallH,length],'stone','curtain',court);
  a.piece('box',[x,walkY-.06,z],axis===0?[length,.12,thickness]:[thickness,.12,length],'stone','wall-walk',body);
  const outside=Math.sign(axis===0?z:x),normal=axis===0?2:0;
  wallCrown(x,z,length,axis,body);
  // Wooden inner gallery meets the stone walking cap without a coplanar seam.
  const offset=-outside*.82,deckY=walkY+.03;
  const deck=a.piece('box',[x+(normal===0?offset:0),deckY-.08,z+(normal===2?offset:0)],axis===0?[length,.16,.72]:[.72,.16,length],'wood','castle-gallery',body);
  const count=Math.max(1,Math.ceil(length/1.6));
  for(let i=0;i<=count;i++){
   const point:V3=[x+(axis===0?-length/2+i*length/count:-outside*1.13),deckY,z+(axis===2?-length/2+i*length/count:-outside*1.13)];
   if(i>0&&i<count&&(entry===undefined||Math.abs(point[2]-entry)>galleryEntryWidth/2))a.beam(point,[point[0],deckY+.91,point[2]],.12,'wood','castle-gallery-post',deck);
   const seat:V3=[...point];seat[normal]=normal===0?x-outside*.49:z-outside*.49;seat[1]=deckY-.72;
   a.beam(seat,[point[0],deckY-.12,point[2]],.15,'wood','castle-gallery-brace',body);
  }
  for(const y of [deckY+.34,deckY+.82]){
   const intervals=entry===undefined?[[-length/2+.35,length/2-.35]]:[[-length/2+.35,entry-z-galleryEntryWidth/2],[entry-z+galleryEntryWidth/2,length/2-.35]];
   for(const [lo,hi] of intervals){const from:V3=[x,y,z],to:V3=[x,y,z];from[axis]+=lo;to[axis]+=hi;from[normal]-=outside*1.13;to[normal]-=outside*1.13;a.beam(from,to,.12,'wood','castle-gallery-rail',deck);}
  }
  if(entry!==undefined)for(const side of [-1,1])a.beam([x-outside*1.13,deckY,entry+side*galleryEntryWidth/2],[x-outside*1.13,deckY+.91,entry+side*galleryEntryWidth/2],.12,'wood','castle-gallery-entry-post',deck);
  return body;
 };
 const outerTowers:VolumeSpec[]=[];
 for(const sx of [-1,1])for(const sz of [-1,1]){
  const v=royalBuilding(sx*tx,sz*tz,tw,tw,h*1.10*(sz===1?.93:.84)*(1+(a.rnd()-.5)*.06),'corner-tower',1,base,wallTowerRoof()<.45?'flat':'hip');outerTowers.push(v);towerWalk(v,sx,sz);
 }
 curtain(0,tz,enclosureW-2*tw,0);
 for(const side of [-1,1])curtain(side*tx,0,enclosureD-2*tw,2,side===1?galleryEntryZ:undefined);
 const gateWidth=Math.min(3.0,w*.16),gateSpan=Math.max(gateWidth,Math.min(4.8,w*.25,originalWallH*1.10)),gt=tw*1.08,gx=gateSpan/2+gt/2;
 for(const side of [-1,1]){
  const gate=royalBuilding(side*gx,-tz,gt,gt,h*.78*1.10,'gate-tower',1,base,wallTowerRoof()<.45?'flat':'hip');towerWalk(gate,side,-1);
  if(a.plan.roofs.find(r=>r.volume===gate.id)!.kind!=='flat')crown(gate.x,gate.z,gt+1.25,gt+1.25,base+gate.height-.52,gate.id+'_roof');
  banner(gate.x,base+gate.height*.48,-tz-gt/2-.18,gt*.47,gate.height*.48,foundation(gate).id);
  const start=gx+gt/2,end=tx-tw/2;curtain(side*(start+end)/2,-tz,Math.max(.05,end-start),0);
 }
 const gateWall=a.piece('box',[0,base,-tz],[gateWidth,originalWallH,1.2],'stone','fortress-gate-wall',court);
 a.piece('box',[0,base+(originalWallH+wallH)/2,-tz],[gateWidth,wallH-originalWallH,1.2],'stone','castle-gate-header',gateWall);
 for(const side of [-1,1])if(gateSpan>gateWidth)a.piece('box',[side*(gateWidth+gateSpan)/4,base+wallH/2,-tz],[(gateSpan-gateWidth)/2,wallH,1.2],'stone','castle-gate-shoulder',court);
 const spring=Math.min(2.05,(originalWallH-.7)*.57);
 a.piece('arch',[0,base+spring,-tz-.68],[gateWidth,1,.28],'stone','castle-gate-arch',gateWall);
 const gate=gateWall;
 for(let i=0;i<Math.max(4,Math.ceil(gateWidth/.45));i++){
  const n=Math.max(4,Math.ceil(gateWidth/.45)),x=-gateWidth/2+(i+.5)*gateWidth/n;
  const top=base+spring+Math.sqrt(Math.max(0,(gateWidth/2-.10)**2-x*x));
  a.beam([x,base+.06,-tz-.24],[x,top-.08,-tz-.24],.20,'wood','castle-portcullis-bar',gate);
 }
 for(const y of [base+.35,base+spring*.55,base+spring+.20]){
  a.beam([-gateWidth/2+.09,y,-tz-.27],[gateWidth/2-.09,y,-tz-.27],.18,'wood','castle-portcullis-rail',gate);
  const count=Math.max(4,Math.ceil(gateWidth/.45));
  for(let i=0;i<count;i++)a.piece('box',[-gateWidth/2+(i+.5)*gateWidth/count,y,-tz-.375],[.06,.06,.025],'metal','castle-portcullis-rivet',gate);
 }
 a.piece('box',[0,walkY-.06,-tz],[gateSpan,.12,1.2],'stone','wall-walk',gateWall);
 wallCrown(0,-tz,gateSpan,0,gateWall,gateWidth);
 doorGallery(0,-tz+.82,gateSpan,0,1,gateWall);
 // Exposed gate framing carries the projecting crown without crossing the arch.
 const gateLintelY=Math.max(walkY-1.12,base+spring+gateWidth/2+.38),gatePostX=Math.min(gateWidth/2+.32,gateSpan/2-.10);
 a.beam([-gateSpan/2+.03,gateLintelY,-tz-1.29],[gateSpan/2-.03,gateLintelY,-tz-1.29],.24,'wood','castle-gate-timber-lintel',gateWall);
 const gateBrackets=Math.max(3,Math.ceil((gateSpan-.60)/.70)),bracketDrop=Math.min(.62,gateLintelY-base-spring-gateWidth/2-.12);
 for(let i=0;i<gateBrackets;i++){
  const x=-gateSpan/2+.30+(gateSpan-.60)*i/(gateBrackets-1);
  a.beam([x,gateLintelY-.12,-tz-.62],[x,gateLintelY-.12,-tz-1.40],.16,'wood','castle-gate-timber-bracket-seat',gateWall);
  a.beam([x,gateLintelY-bracketDrop,-tz-.65],[x,gateLintelY-.16,-tz-1.31],.14,'wood','castle-gate-timber-bracket',gateWall);
 }
 for(const side of [-1,1]){
  a.beam([side*gatePostX,base+.08,-tz-.86],[side*gatePostX,gateLintelY+.15,-tz-.86],.20,'wood','castle-gate-timber-post',gateWall);
  a.beam([side*gatePostX,gateLintelY-.85,-tz-.86],[side*gatePostX,gateLintelY-.06,-tz-1.29],.18,'wood','castle-gate-timber-brace',gateWall);
  a.beam([side*gatePostX,gateLintelY-.08,-tz-.86],[side*gatePostX,gateLintelY-.08,-tz-1.35],.20,'wood','castle-gate-timber-joist',gateWall);
 }
 // Low stone bridge with a timber deck and defensive parapets.
 const bridgeStart=-tz-gt/2-Math.min(4.0,d*.22),bridgeEnd=-tz,bridgeLength=bridgeEnd-bridgeStart,bridgeZ=(bridgeStart+bridgeEnd)/2;
 const bridge=a.piece('box',[0,(base-.10)/2,bridgeZ],[gateWidth+.42,base-.10,bridgeLength],'stone','castle-bridge',court);
 a.piece('box',[0,base-.05,bridgeZ],[gateWidth,.10,bridgeLength],'wood','castle-bridge-deck',bridge);
 a.piece('box',[0,base+.025,bridgeZ],[.34,.15,bridgeLength],'stone','castle-bridge-center-beam',bridge);
 const railEnd=-tz-.72,railLength=railEnd-bridgeStart,railZ=(bridgeStart+railEnd)/2;
 for(const side of [-1,1]){
  a.piece('box',[side*(gateWidth/2+.12),base+.25,railZ],[.25,.70,railLength],'stone','castle-bridge-parapet',bridge);
  for(let i=0;i<Math.ceil(railLength/.85);i++)a.piece('box',[side*(gateWidth/2+.12),base+.74,bridgeStart+(i+.5)*railLength/Math.ceil(railLength/.85)],[.32,.30,.45],'stone','castle-bridge-crenel',bridge);
 }
 a.stairs([0,0,bridgeStart-.75],[0,base,bridgeStart],gateWidth);
 const kw=w*.38,kd=d*.34,kz=d*.19,keep=royalBuilding(0,kz,kw,kd,originalWallH*2,'keep',2,base,'flat');
 const keepTop=base+keep.height;
 const keepRoof=a.plan.roofs.find(r=>r.volume===keep.id)!;
 keepRoof.width=kw-.05;keepRoof.depth=kd-.05;keepRoof.eaves=0;
 keepRoof.y=keepTop-.28;keepRoof.flatThickness=.40;keepRoof.plainEdge=true;
 const hiddenCornices=new Set(a.plan.pieces.filter(piece=>piece.role==='castle-cornice'&&piece.support===keepRoof.id).map(piece=>piece.id));
 const capWidth=kw+1.25,capDepth=kd+1.25,capThickness=.65,capBottom=keepTop-.98;
 for(const side of [-1,1]){
  a.piece('box',[side*(capWidth/2-capThickness/2),keepTop-.43,kz],[capThickness,1.10,capDepth],'stone','castle-tower-crown-base',foundation(keep).id);
  a.piece('box',[0,keepTop-.43,kz+side*(capDepth/2-capThickness/2)],[kw-.05,1.10,capThickness],'stone','castle-tower-crown-base',foundation(keep).id);
 }
 crown(0,kz,capWidth,capDepth,keepTop+.12,keep.id+'_roof');
 for(const axis of [0,2] as const)for(const side of [-1,1]){
  const length=axis===0?kw:kd,wall=axis===0?kd/2:kw/2,count=Math.max(2,Math.ceil(length/1.3));
  for(let i=0;i<count;i++){
   const along=-length/2+.28+(length-.56)*i/(count-1);
   for(const [offset,drop,depth,thickness,width] of [[.24,.10,.84,.20,.32],[.12,.29,.52,.18,.28],[.035,.465,.33,.17,.24]])a.piece('box',axis===0?[along,capBottom-drop,kz+side*(wall+offset)]:[side*(wall+offset),capBottom-drop,kz+along],axis===0?[width,thickness,depth]:[depth,thickness,width],'stone','castle-stone-corbel',foundation(keep).id);
  }
 }
 const entryWidth=Math.min(2.0,kw*.30),entryZ=kz-kd/2,entryY=base+.36,entrySupport=foundation(keep).id;
 door(keep,0,entryY,entryWidth);
 const entryLanding=a.piece('box',[0,base+.18,entryZ-.54],[entryWidth+.76,.36,1.08],'stone','floor-landing',entrySupport);
 a.stairs([0,base,entryZ-1.82],[0,entryY,entryZ-1.08],entryWidth+.76);
 for(const side of [-1,1]){
  const x=side*((entryWidth+.76)/2+.21),z=entryZ-1.48;
  const post=a.piece('box',[x,base+.42,z],[.42,.84,.54],'stone','castle-entry-stair-pier',entrySupport);
  a.piece('box',[x,base+.06,z],[.50,.12,.62],'stone','castle-entry-stair-pier-base',post);
  a.piece('box',[x,base+.88,z],[.54,.16,.66],'stone','castle-entry-stair-pier-cap',post);
  const wallPost=a.piece('box',[x,base+.42,entryZ-.20],[.42,.84,.54],'stone','castle-entry-wall-pier',entrySupport);
  a.piece('box',[x,base+.06,entryZ-.20],[.50,.12,.62],'stone','castle-entry-wall-pier-base',wallPost);
  a.piece('box',[x,base+.88,entryZ-.20],[.54,.16,.66],'stone','castle-entry-wall-pier-cap',wallPost);
  for(const railY of [base+.34,base+.74])a.beam([x,railY,z+.24],[x,railY,entryZ-.44],.14,'wood','castle-entry-side-rail',post);
 }
 const canopyWidth=entryWidth+1.10,canopyDepth=1.35,canopyY=entryY+2.40;
 a.plan.roofs.push({id:'castle-entry-canopy',volume:keep.id,x:0,z:entryZ-canopyDepth/2,y:canopyY,rise:.65,width:canopyWidth,depth:canopyDepth,eaves:.10,kind:'shed',shedAxis:2,shedDirection:1,material:'roof'});
 a.plan.supports.push({component:'castle-entry-canopy',on:entrySupport});
 a.beam([-canopyWidth/2,canopyY-.08,entryZ-canopyDepth],[canopyWidth/2,canopyY-.08,entryZ-canopyDepth],.18,'wood','castle-entry-canopy-lintel',entrySupport);
 for(const side of [-1,1]){
  const x=side*(entryWidth/2+.25);
  a.beam([x,entryY+.10,entryZ-.24],[x,canopyY+.55,entryZ-.24],.18,'wood','castle-entry-post',entryLanding);
  a.beam([x,canopyY-.65,entryZ-.24],[x,canopyY-.10,entryZ-canopyDepth],.16,'wood','castle-entry-brace',entrySupport);
  a.beam([x,canopyY-.08,entryZ-canopyDepth],[x,canopyY+.57,entryZ],.16,'wood','castle-entry-rafter',entrySupport);

 }
 for(const side of [-1,1])banner(side*kw*.32,base+keep.height*.60,kz-kd/2-.20,kw*.14,keep.height*.50,foundation(keep).id);
 const highWidth=kw*.46,highDepth=kd*.48,high=royalBuilding(0,kz+kd*.15,highWidth,highDepth,h*.61,'high-keep',1,keepTop+.12);
 a.depend(foundation(high).id,[keep.id+'_roof']);
 door(high,0,high.bottom);
 crown(high.x,high.z,highWidth+1.25,highDepth+1.25,high.bottom+high.height-.52,high.id+'_roof');
 for(const side of [-1,1]){
  const tt=Math.min(kw*.23,kd*.26),v=royalBuilding(side*kw*.40,kz+kd*.20,tt,tt,h*.34,'keep-turret',1,keepTop+.12);
  a.depend(foundation(v).id,[keep.id+'_roof']);
  door(v,0,v.bottom,.80);
 }
 a.stairs([-kw*.30,walkY+.12,kz-kd*.40],[-kw*.30,keepTop+.12,kz],1.12);
 a.plan.roofs.find(r=>r.id===keep.id+'_roof')!.accessHole={x:-kw*.30,z:kz-.65,width:1.35,depth:1.55};
 // Each exterior stair ends on a level landing, with an unobstructed exit.
 const guardedStair=(from:V3,to:V3,width:number,role:string,sides=[-1,1])=>{
  const id=a.stairs(from,to,width);a.plan.accesses[a.plan.accesses.length-1].role=role;
  const dx=to[0]-from[0],dz=to[2]-from[2],length=Math.hypot(dx,dz),nx=dz/length,nz=-dx/length;
  for(const side of sides){
   const offset=side*(width/2-.055),start:V3=[from[0]+nx*offset,from[1]+.86,from[2]+nz*offset],end:V3=[to[0]+nx*offset,to[1]+.86,to[2]+nz*offset];
   a.beam(start,end,.10,'wood','castle-stair-rail',id);
   const count=Math.max(2,Math.ceil(length/1.20));
   for(let i=0;i<=count;i++){const t=i/count,point:V3=[from[0]+dx*t+nx*offset,from[1]+(to[1]-from[1])*t,from[2]+dz*t+nz*offset];a.beam(point,[point[0],point[1]+.92,point[2]],.11,'wood','castle-stair-post',id);}
  }
  return id;
 };
 // Like the fortress house, a narrow timber gallery sits beside an outboard stair.
 const keepLeft=-kw/2,sideSpace=w*.15-.30,sideWidth=Math.min(1.25,sideSpace*.48),stairWidth=Math.min(.95,sideSpace-sideWidth);
 const stairX=keepLeft-sideWidth-stairWidth/2,stairEnd=kz+kd/2-.85,stairZ=stairEnd-Math.min(wallH*1.45,d*.36),sideStart=kz-kd/2-.10;
 guardedStair([stairX,base,stairZ],[stairX,walkY,stairEnd],stairWidth,'keep-stair',[-1]);
 const sideGallery=a.piece('box',[keepLeft-sideWidth/2,walkY-.08,(sideStart+stairEnd)/2],[sideWidth,.16,stairEnd-sideStart],'wood','floor-landing',foundation(keep).id);
 const landingBack=kz+kd/2+.30,outer=keepLeft-sideWidth-stairWidth;
 const landing=a.piece('box',[keepLeft-(sideWidth+stairWidth)/2,walkY-.08,(stairEnd+landingBack)/2],[sideWidth+stairWidth,.16,landingBack-stairEnd],'wood','floor-landing',sideGallery);
 door(keep,3,walkY);
 a.plan.openings=a.plan.openings.filter(o=>o.wall!==keep.id+'_wall_3'||o.kind!=='window');
 for(const [x,z] of [[outer+.06,stairEnd+.06],[outer+.06,landingBack-.06],[keepLeft-.06,landingBack-.06],[keepLeft-sideWidth+.06,sideStart+.06],[keepLeft-sideWidth+.06,stairEnd-.06]]){
  a.beam([x,base,z],[x,walkY+.86,z],.11,'wood','castle-landing-post',landing);
  a.beam([x,walkY-.70,z],[keepLeft-.03,walkY-.08,z],.10,'wood','castle-gallery-brace',landing);
 }
 for(const y of [walkY+.20,walkY+.73]){
  a.beam([outer+.06,y,stairEnd+.06],[outer+.06,y,landingBack-.06],.085,'wood','castle-landing-rail',landing);
  a.beam([outer+.06,y,landingBack-.06],[keepLeft-.06,y,landingBack-.06],.085,'wood','castle-landing-rail',landing);
  a.beam([keepLeft-sideWidth+.06,y,sideStart+.06],[keepLeft-sideWidth+.06,y,stairEnd-.06],.085,'wood','castle-landing-rail',sideGallery);
  a.beam([keepLeft-sideWidth+.06,y,sideStart+.06],[keepLeft-.06,y,sideStart+.06],.085,'wood','castle-landing-rail',sideGallery);
 }
 // The courtyard stair enters through a gap in the inner gallery railing.
 const galleryY=walkY+.03,galleryX=tx-1.885,galleryEndZ=galleryEntryZ-.70,galleryRun=Math.min(wallH*1.45,d*.36);
 guardedStair([galleryX,base,galleryEndZ-galleryRun],[galleryX,galleryY,galleryEndZ],1.25,'gallery-stair');
 const galleryLanding=a.piece('box',[tx-1.845,base+(galleryY-base)/2,galleryEntryZ],[1.33,galleryY-base,1.55],'stone','floor-landing',court);
 for(const y of [galleryY+.34,galleryY+.86]){
  a.beam([tx-2.51,y,galleryEntryZ-.775],[tx-2.51,y,galleryEntryZ+.775],.10,'wood','castle-landing-rail',galleryLanding);
  a.beam([tx-2.51,y,galleryEntryZ+.775],[tx-1.18,y,galleryEntryZ+.775],.10,'wood','castle-landing-rail',galleryLanding);
 }
 for(const [x,z] of [[tx-2.51,galleryEntryZ-.775],[tx-2.51,galleryEntryZ+.775],[tx-1.18,galleryEntryZ+.775]])a.beam([x,galleryY,z],[x,galleryY+.92,z],.11,'wood','castle-landing-post',galleryLanding);
 // Small timber buildings leave the central entrance and stair route open.
 const houseW=w*.16,houseD=d*.18,houseX=Math.min(w*.30,tx-2.51-houseW/2-.40);
 const houseZ=houseX-houseW/2>=kw/2+.45?d*.36:-d*.16;
 if(p.annexes){
  const house=a.building(houseX,houseZ,houseW,houseD,h*.40,1,{base,material:'wood',roof:p.roof==='auto'?'gable':p.roof,role:'castle-workshop'});
  const workshopRoof=a.plan.roofs.find(r=>r.volume===house.id)!;workshopRoof.eaves=.20;
  a.veranda(house);
  a.building(-w*.40,d*.36,w*.10,d*.12,h*.18,1,{base,material:'wood',roof:p.roof==='auto'?'gable':p.roof,role:'castle-store'});
 }
 // Reuse the fortress's authored barrel and hollow masonry well geometry.
 const wellX=-w*.28,wellZ=-d*.34;
 const well=a.piece('column',[wellX,base+.32,wellZ],[1.25,.64,1.25],'stone','fortress-well',court);
 a.piece('column',[wellX,base+.70,wellZ],[1.40,.14,1.40],'stone','fortress-well-rim',well);
 a.piece('column',[wellX,base+.08,wellZ],[.95,.035,.95],'dark','fortress-well-depth',well);
 for(const side of [-1,1])a.beam([wellX+side*.62,base,wellZ],[wellX+side*.62,base+2.0,wellZ],.13,'wood','castle-well-post',well);
 a.beam([wellX-.62,base+1.65,wellZ],[wellX+.62,base+1.65,wellZ],.10,'wood','castle-well-winch',well);
 a.beam([wellX,base+1.65,wellZ],[wellX,base+.32,wellZ],.025,'metal','castle-well-rope',well);
 a.plan.roofs.push({id:'castle-well-roof',volume:'castle-well',x:wellX,z:wellZ,y:base+2,width:1.60,depth:1.20,rise:.60,eaves:.16,kind:'gable',material:'roof'});a.plan.supports.push({component:'castle-well-roof',on:well});
 for(const [x,z] of [[houseX+.20,houseZ-d*.21],[houseX+.85,houseZ-d*.21],[-w*.39,d*.22]]){
  const barrel=a.piece('column',[x,base+.35,z],[.57,.70,.57],'wood','fortress-barrel',court);
  for(const offset of [-.24,.24])a.piece('column',[x,base+.35+offset,z],[.59,.055,.59],'metal','fortress-barrel-hoop',barrel);
  a.piece('column',[x,base+.70,z],[.45,.04,.45],'wood','fortress-barrel-lid',barrel);
 }
 a.plan.propZones.push({id:'castle-garden',x:w*.34,z:-d*.20,width:w*.10,depth:d*.12,y:base,kind:'garden'});
 const plinthH=Math.min(1.45,h*.14);
 const plinth=(x:number,z:number,length:number,axis:0|2,outside:number,wallHalf:number,support:string)=>{
  const point:V3=axis===0?[x,(base+plinthH)/2,z+outside*(wallHalf+.08)]:[x+outside*(wallHalf+.08),(base+plinthH)/2,z];
  a.piece('box',point,axis===0?[length,base+plinthH,.44]:[.44,base+plinthH,length],'stone','castle-stone-plinth',support);
 };
 // A continuous footing follows each wall recess and projecting tower.
 for(const body of [...a.plan.pieces].filter(piece=>piece.role==='curtain'||piece.role==='castle-gate-shoulder')){
  const axis:0|2=Math.abs(body.position[2])>=tz-.01?0:2;
  plinth(body.position[0],body.position[2],body.size[axis],axis,Math.sign(body.position[axis===0?2:0]),.60,body.id);
 }
 for(const tower of a.plan.volumes.filter(v=>v.role==='corner-tower'||v.role==='gate-tower')){
  plinth(tower.x,tower.z,tower.width+.60,0,Math.sign(tower.z),tower.depth/2,foundation(tower).id);
  for(const side of [-1,1])plinth(tower.x,tower.z,tower.depth-.28,2,side,tower.width/2,foundation(tower).id);
  const groundDoor=a.plan.openings.find(o=>o.wall===tower.id+'_wall_'+(tower.z<0?2:0)&&o.kind==='door'&&o.bottom<.1);
  const doorGap=(groundDoor?.width??1.12)+.24,returnWidth=(tower.width+.60-doorGap)/2;
  for(const side of [-1,1])plinth(tower.x+side*(doorGap+returnWidth)/2,tower.z,returnWidth,0,-Math.sign(tower.z),tower.depth/2,foundation(tower).id);
 }
 // Match the courtyard keep footing to the darker outer masonry, leaving the entrance clear.
 plinth(keep.x,keep.z,keep.width+.60,0,1,keep.depth/2,entrySupport);
 for(const side of [-1,1]){
  plinth(keep.x,keep.z,keep.depth-.28,2,side,keep.width/2,entrySupport);
  const gap=entryWidth+.24,length=(keep.width+.60-gap)/2;
  plinth(keep.x+side*(gap+length)/2,keep.z,length,0,-1,keep.depth/2,entrySupport);
 }
 a.plan.pieces=a.plan.pieces.filter(piece=>!hiddenCornices.has(piece.id));
 a.plan.supports=a.plan.supports.filter(s=>!hiddenCornices.has(s.component));
 return a.finish();
}



