import {Architect} from '../blueprint';
import {STONE_COURSE_HEIGHT} from '../surfacePainting';
import type {GrammarContext,V3} from '../types';

/** Masonry shaft and a timber beacon pavilion, based on the reference tower. */
export function lighthouse(c:GrammarContext) {
 const a=new Architect(c),p=c.config,variation=a.value(1,.07);
 const w=p.width*variation,d=p.depth*variation,h=a.value(p.height,.08);
 const tw=w*.68,td=d*.68;
 const tower=a.building(0,0,tw,td,h,3,{base:STONE_COURSE_HEIGHT*2,material:'stone',roof:'flat',role:'lighthouse-tower'});
 // Narrow shafts can round the generic window count down to zero.
 // Keep a sparse seeded arrangement in that case, with at least one opening.
 if(!a.plan.openings.some(o=>o.kind==='window')){
  const windowRnd=c.streams.streamFor('lighthouse','minimum-windows');
  const walls=a.plan.walls.filter(wall=>wall.volume===tower.id).slice(1);
  for(let level=0;level<3;level++){
   if(level>0&&windowRnd()<.4)continue;
   const wall=walls[Math.floor(windowRnd()*walls.length)],storey=h/3;
   a.plan.openings.push({id:wall.id+'_minimum_window_'+level,wall:wall.id,kind:'window',offset:0,width:Math.min(.9,Math.hypot(wall.end[0]-wall.start[0],wall.end[2]-wall.start[2])*.25),bottom:level*storey+storey*.4,height:Math.min(1.1,storey*.35)});
  }
 }
 const base=tower.bottom,top=base+h,foundation=a.plan.pieces.find(x=>x.role==='foundation')!.id;
 const towerRoof=a.plan.roofs.find(x=>x.volume===tower.id)!;
 towerRoof.eaves=0;towerRoof.material='stone';towerRoof.plainEdge=true;
 // Wide, stepped foot and timber belts separate the three masonry storeys.
 const foot=a.piece('box',[0,STONE_COURSE_HEIGHT/2,0],[tw+1.5,STONE_COURSE_HEIGHT,td+1.5],'stone','lighthouse-foot');
 a.piece('box',[0,STONE_COURSE_HEIGHT*1.5,0],[tw+.9,STONE_COURSE_HEIGHT,td+.9],'stone','lighthouse-foot-step',foot);
 const corners=(ww:number,dd:number,y:number):V3[]=>[[-ww/2,y,-dd/2],[ww/2,y,-dd/2],[ww/2,y,dd/2],[-ww/2,y,dd/2]];
 for(const level of [1,2,3]) {
  const y=base+h*level/3-.10,bracketWidth=.46,beltDepth=.32;
  // Flat face timbers meet at butt joints instead of thin square beams on corners.
  for(const side of [0,1,2,3]){
   const alongX=side%2===0,sign=side<2?-1:1;
   const span=alongX?tw:td,face=(alongX?td:tw)/2;
   const point=(u:number,yy:number,out:number):V3=>alongX?[u,yy,sign*(face+out)]:[sign*(face+out),yy,u];
   const size=(length:number,height:number,depth:number):V3=>alongX?[length,height,depth]:[depth,height,length];
   const belt=a.piece('box',point(0,y,beltDepth/2),size(span+(alongX?beltDepth*2:0),bracketWidth,beltDepth),'wood','lighthouse-timber-belt',foundation);
   for(const edge of [-1,1]){
    // The stone corner post occupies the first .14 m of each facade.
    // Put the wooden hanger and its plate beside it, rather than across the quoin.
    const u=edge*(span/2-.14-bracketWidth/2-.05);
    // A long back leg and a shorter projecting cheek form the stepped corbel.
    const post=a.piece('box',point(u,y-.61,.065),size(bracketWidth,1.06,.15),'wood','lighthouse-belt-post',foundation);
    a.piece('box',point(u,y-.345,.205),size(bracketWidth,.53,.13),'wood','lighthouse-belt-post',post);
    const plate=a.piece('box',point(u,y,beltDepth+.029),size(bracketWidth,bracketWidth,.058),'metal','lighthouse-belt-clamp',belt);
    for(const uu of [-.13,.13])for(const yy of [-.13,.13])a.piece('box',point(u+uu,y+yy,beltDepth+.069),size(.055,.055,.022),'metal','lighthouse-belt-rivet',plate);
    a.depend(plate,[belt,post],1);
   }
  }
 }
 const deckY=top+.18,deckWidth=w,deckDepth=d;
 const deck=a.piece('box',[0,deckY-.10,0],[deckWidth,.24,deckDepth],'wood','lantern-deck',towerRoof.id);
 const plankCount=Math.ceil(deckWidth/.28),plankWidth=deckWidth/plankCount;
 for(let i=0;i<plankCount;i++)a.piece('box',[-deckWidth/2+(i+.5)*plankWidth,deckY+.045,0],[plankWidth-.018,.07,deckDepth],'wood','lighthouse-deck-plank',deck);
 // Real joists and diagonal corbels carry the overhanging balcony.
 for(const sx of [-1,1])for(const sz of [-1,1]) {
  const x=sx*(tw/2+.10),z=sz*(td/2+.10);
  const corbel=a.beam([x,top-1.30,z],[sx*(w/2-.22),deckY-.24,sz*(d/2-.22)],.28,'wood','lighthouse-deck-brace',foundation);
  a.beam([x,top-1.45,z],[x,top-.15,z],.32,'wood','lighthouse-corbel-post',foundation);
  a.piece('box',[x,top-.25,z],[.40,.26,.40],'metal','lighthouse-corbel-clamp',corbel);
 }
 const perimeter=corners(w-.24,d-.24,deckY-.13);
 for(let side=0;side<4;side++){
  const start=perimeter[side],end=perimeter[(side+1)%4];
  a.beam(start,end,.30,'wood','lighthouse-deck-fascia',deck);
  for(const y of [.53,1.03])a.beam([start[0],deckY+y,start[2]],[end[0],deckY+y,end[2]],.16,'wood','lighthouse-balcony-rail',deck);
  const count=Math.max(2,Math.ceil(Math.hypot(end[0]-start[0],end[2]-start[2])/1.8));
  for(let i=0;i<count;i++){
   const x=start[0]+(end[0]-start[0])*i/count,z=start[2]+(end[2]-start[2])*i/count;
   const post=a.beam([x,deckY-.18,z],[x,deckY+1.16,z],.23,'wood','lighthouse-balcony-post',deck);
   // The lower collar must stand proud of the .30 m fascia, whose side faces
   // otherwise coincide with the collar throughout their overlapping height.
   for(const y of [.04,1.14]){const width=y===.04?.34:.30;a.piece('box',[x,deckY+y,z],[width,.18,width],'metal','lighthouse-post-cap',post);}
  }
 }
 const pavilionHeight=Math.min(3.2,Math.max(2.2,h*.22)),roofY=deckY+pavilionHeight;
 const pw=tw*.88,pd=td*.88,posts=corners(pw,pd,deckY+.08),postIds:string[]=[];
 for(const [x,y,z] of posts){
  const id=a.beam([x,y,z],[x,roofY,z],.30,'wood','lighthouse-pavilion-post',deck);postIds.push(id);
  for(const axis of [0,2] as const){
   const start:V3=[x,roofY-.65,z],end:V3=[x,roofY-.10,z];end[axis]-=Math.sign(end[axis])*.62;
   a.beam(start,end,.18,'wood','lighthouse-pavilion-brace',id);
  }
 }
 for(let side=0;side<4;side++)a.beam([posts[side][0],roofY-.12,posts[side][2]],[posts[(side+1)%4][0],roofY-.12,posts[(side+1)%4][2]],.30,'wood','lighthouse-pavilion-header',postIds[side]);
 const roofId='lighthouse-pavilion-roof',rise=Math.min(w,d)*(.25+p.roofPitch*.14);
 a.plan.roofs.push({id:roofId,volume:tower.id,x:0,z:0,width:pw+.7,depth:pd+.7,y:roofY,rise,eaves:Math.min(.65,p.eaves),kind:'hip',material:'roof'});
 a.depend(roofId,postIds,2);
 // Faceted amber lantern with an iron cage and a wooden finial above the hip roof.
 const radius=Math.min(pw,pd)*.20,lanternHeight=pavilionHeight*.62,ly=deckY+.30;
 const lanternBase=a.piece('column',[0,ly,0],[radius*2.35,.22,radius*2.35],'metal','lighthouse-lantern-base',deck);
 const glass=a.piece('column',[0,ly+.18+lanternHeight/2,0],[radius*2,lanternHeight,radius*2],'cloth','lantern',lanternBase);
 for(let i=0;i<8;i++){
  const angle=i*Math.PI/4,next=angle+Math.PI/4;
  const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
  a.beam([x,ly+.12,z],[x,ly+.22+lanternHeight,z],.065,'metal','lighthouse-lantern-bar',lanternBase);
  for(const y of [ly+.20,ly+.20+lanternHeight*.27,ly+.20+lanternHeight])a.beam([x,y,z],[Math.cos(next)*radius,y,Math.sin(next)*radius],.07,'metal','lighthouse-lantern-ring',glass);
 }
 a.piece('column',[0,ly+.30+lanternHeight,0],[radius*2.25,.18,radius*2.25],'metal','lighthouse-lantern-cap',glass);
 a.beam([0,ly+.39+lanternHeight,0],[0,roofY-.14,0],.12,'metal','lighthouse-lantern-hanger',postIds[0]);
 a.piece('column',[0,roofY+rise+.20,0],[.50,.30,.50],'metal','lighthouse-finial-collar',roofId);
 a.piece('column',[0,roofY+rise+.64,0],[.40,.65,.40],'wood','lighthouse-finial',roofId);
 return a.finish();
}
