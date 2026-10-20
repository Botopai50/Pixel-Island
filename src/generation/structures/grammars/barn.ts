import {Architect} from '../blueprint';
import type {GrammarContext} from '../types';
export function barn(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.07),d=a.value(p.depth,.07),h=a.value(p.height,.07)*.80,v=a.building(0,0,w,d,h,1,{base:.36,material:'wood',roof:p.roof==='auto'?'thatch':p.roof,role:'barn'}),roof=a.plan.roofs[0];
 const door=a.plan.openings.find(o=>o.kind==='door')!;door.offset=0;door.width=Math.min(w*.54,4.2);door.height=h*.82; a.plan.openings=a.plan.openings.filter(o=>o.kind==='door');
 if(p.openingDensity>0)for(const side of [1,3])for(const sign of [-1,1])a.plan.openings.push({id:v.id+'_wall_'+side+'_window_'+sign,wall:v.id+'_wall_'+side,kind:'window',offset:sign*d*.25,width:Math.min(.85,d*.14),bottom:Math.max(.75,h*.38),height:Math.min(.90,h*.25)});
 const height=(x:number,z:number)=>roof.y+(roof.kind==='flat'?0:roof.kind==='shed'?roof.rise*((roof.shedDirection??1)*x/w+.5):roof.kind==='hip'?roof.rise*Math.min((w/2-Math.abs(x))/Math.min(w/2,d/2),(d/2-Math.abs(z))/Math.min(w/2,d/2)):roof.rise*(x<=-w/2+w*(roof.ridgeRatio??.5)?(x+w/2)/(w*(roof.ridgeRatio??.5)):(w/2-x)/(w*(1-(roof.ridgeRatio??.5)))));
 const foundation=a.plan.pieces.find(x=>x.role==='foundation')!.id;
 const stoneBase=a.plan.pieces.find(piece=>piece.id===foundation)!;
 // Exposed pillars reach .27 m past each wall; leave a stone ledge beyond them.
 stoneBase.size[0]=w+.70;stoneBase.size[2]=d+.70;
 // The reference's exposed corner pillars and eave beams sit in front of the wall skin.
 for(const piece of a.plan.pieces){
  if(!piece.end)continue;
  if(piece.role==='corner-post'){
   piece.size=[.34,.34,.34];
   for(const point of [piece.position,piece.end]){point[0]+=Math.sign(point[0])*.10;point[2]+=Math.sign(point[2])*.10;}
  }else if(piece.role==='wall-frame'&&piece.position[1]>v.bottom+h/2){
   const axis=Math.abs(piece.end[0]-piece.position[0])>Math.abs(piece.end[2]-piece.position[2])?2:0;
   for(const point of [piece.position,piece.end])point[axis]+=Math.sign(point[axis])*.13;
   piece.size=[.32,.32,.32];
  }
 }
 for(let i=0;i<4;i++){const z=-d/2+(i+.5)*d/4,left=height(-w/2,z),right=height(w/2,z),peakX=roof.kind==='shed'?(roof.shedDirection??1)*w/2:-w/2+w*(roof.ridgeRatio??.5),peak=height(peakX,z);const posts=[a.beam([-w/2,v.bottom,z],[-w/2,left,z],.18,'wood','barn-truss-post',foundation),a.beam([w/2,v.bottom,z],[w/2,right,z],.18,'wood','barn-truss-post',foundation)];
 const parts=roof.kind==='flat'||roof.kind==='shed'?[a.beam([-w/2,left,z],[w/2,right,z],.2,'wood','barn-truss',posts[0])]:[a.beam([-w/2,left,z],[peakX,peak,z],.2,'wood','barn-truss',posts[0]),a.beam([peakX,peak,z],[w/2,right,z],.2,'wood','barn-truss',posts[0]),a.beam([-w/2,roof.y,z],[w/2,roof.y,z],.17,'wood','barn-truss',posts[0])];parts.forEach(id=>a.depend(id,posts,2));
 }
 const front=-d/2,base=v.bottom,doorTop=base+door.height,face=front-.20,railY=doorTop+.20,railZ=face-.12,railWidth=Math.min(w-.65,door.width+1.70);
 const track=a.piece('box',[0,railY,railZ],[railWidth,.13,.085],'metal','barn-door-track',door.wall);
 for(const side of [-1,1])a.piece('box',[side*(railWidth/2-.08),railY,front-.17],[.12,.25,.34],'metal','barn-door-track-anchor',door.wall);
 for(const side of [-1,1]){
  const center=side*door.width/4,leafWidth=door.width/2-.035;
  const leaf=a.piece('box',[center,base+door.height/2,front-.14],[leafWidth,door.height-.05,.12],'wood','barn-door-leaf',door.wall);
  for(const y of [base+.10,doorTop-.10])a.beam([center-leafWidth/2,y,face],[center+leafWidth/2,y,face],.15,'wood','barn-door-frame',leaf);
  for(const x of [center-leafWidth/2,center+leafWidth/2])a.beam([x,base+.10,face],[x,doorTop-.10,face],.14,'wood','barn-door-frame',leaf);
  a.beam([side*(door.width/2-.14),doorTop-.22,face-.04],[side*.10,base+.18,face-.04],.18,'wood','barn-door-diagonal',leaf);
  a.piece('box',[side*.11,base+door.height*.46,face-.08],[.10,.26,.055],'metal','barn-door-handle',leaf);
  const bracketX=side*door.width*.31;
  const strap=a.piece('box',[bracketX,railY-.12,railZ-.09],[.17,.46,.065],'metal','barn-door-slider',leaf);
  a.piece('wheel',[bracketX,railY+.075,railZ-.045],[.14,.14,.075],'metal','barn-door-roller',track);
  a.piece('box',[bracketX,railY+.045,railZ-.095],[.21,.14,.08],'metal','barn-door-slider-cap',strap);
  for(const y of [railY-.075,railY-.27])a.piece('wheel',[bracketX,y,railZ-.135],[.047,.047,.025],'metal','barn-door-slider-rivet',strap);
 }
 a.piece('box',[0,.16,front-.40],[door.width+.20,.32,.8],'stone','barn-threshold',foundation);
 // Replace the thin side braces with exposed, square-cut knee supports.
 const oldSideBraces=new Set(a.plan.pieces.filter(piece=>piece.role==='facade-brace'&&piece.end&&Math.abs(piece.end[2]-piece.position[2])>.1).map(piece=>piece.id));
 for(const piece of a.plan.pieces)if(oldSideBraces.has(piece.id))piece.removed=true;
 a.plan.supports=a.plan.supports.filter(support=>!oldSideBraces.has(support.component));
 for(const side of [-1,1]){
  const x=side*(w/2+.10);
  for(const z of [0]){
   const post=a.beam([x,base,z],[x,base+h-.16,z],.34,'wood','barn-side-post',foundation);
   for(const sign of [-1,1])a.beam([side*(w/2+.16),base+h-1.25,z+sign*.14],[side*(w/2+.16),base+h-.29,z+sign*1.10],.28,'wood','barn-side-brace',post,{start:[0,0,1],end:[0,1,0]});
  }
  for(const sign of [-1,1]){
   const z=sign*(d/2+.10),post=a.plan.pieces.find(piece=>piece.role==='corner-post'&&Math.sign(piece.position[0])===side&&Math.sign(piece.position[2])===sign)!;
   a.beam([side*(w/2+.16),base+h-1.25,z-sign*.14],[side*(w/2+.16),base+h-.29,z-sign*1.10],.28,'wood','barn-side-brace',post.id,{start:[0,0,1],end:[0,1,0]});
  }
 }
 if(roof.kind==='thatch'||roof.kind==='gable'){
  const ridge=-w/2+w*(roof.ridgeRatio??.5),ratio=roof.ridgeRatio??.5;
  const strawLift=roof.kind==='thatch'?.415*Math.sqrt(1+(roof.rise/(w*Math.min(ratio,1-ratio)))**2):.16;
  const ridgeY=roof.y+roof.rise+strawLift-.02;
  const ridgeCap=a.beam([ridge,ridgeY,-d/2-roof.eaves],[ridge,ridgeY,d/2+roof.eaves],.26,'wood','barn-ridge-cap',roof.id);
  for(const side of [-1,1]){
   const z=side*(d/2+roof.eaves+.015);
   a.beam([ridge,roof.y+roof.rise-.08,z],[ridge,ridgeY,z],.26,'wood','barn-ridge-joint',ridgeCap);
   a.beam([ridge,roof.y+roof.rise-.08,side*(d/2+.23)],[ridge,roof.y+roof.rise-.08,z],.26,'wood','barn-ridge-connection',roof.id);
  }
  const bindings=Math.max(4,Math.ceil(d/1.7));
  for(let i=0;i<=bindings;i++){
   const z=-d/2+i*d/bindings;
   for(const side of [-1,1]){
    const span=w*(side<0?ratio:1-ratio),reach=.45;
    a.beam([ridge,roof.y+roof.rise+strawLift+.12,z],[ridge+side*reach,roof.y+roof.rise-roof.rise*reach/span+strawLift+.01,z],.18,'wood','barn-ridge-binding',roof.id);
   }
  }
  const peakX=-w/2+w*ratio,gableZ=front-.23,headerY=base+h-.08;
  const header=a.beam([-w/2,headerY,gableZ],[w/2,headerY,gableZ],.30,'wood','barn-gable-header',foundation);
  for(const level of [.30]){
   const y=roof.y+roof.rise*level,left=-w/2+w*ratio*level,right=w/2-w*(1-ratio)*level;
   const crossbeam=a.beam([left,y,gableZ],[right,y,gableZ],.28,'wood','barn-gable-crossbeam',header,{start:[1,0,0],end:[1,0,0]});
   a.beam([peakX,y,gableZ],[peakX,roof.y+roof.rise-.08,gableZ],.28,'wood','barn-gable-upper-post',crossbeam);
  }
  for(const side of [-1,1]){
   a.beam([side*w/2,roof.y-.08,gableZ],[peakX,roof.y+roof.rise-.08,gableZ],.30,'wood','barn-gable-rafter',header,{start:[1,0,0],end:[1,0,0]});
   const corner=a.plan.pieces.find(piece=>piece.role==='corner-post'&&Math.sign(piece.position[0])===side&&piece.position[2]<0)!;
   a.beam([side*(w/2-.10),headerY-.95,gableZ],[side*(w/2-1.05),headerY,gableZ],.27,'wood','barn-front-brace',corner.id,{start:[1,0,0],end:[0,1,0]});
   a.piece('box',[side*(w/2-1.05),headerY,gableZ-.04],[.38,.38,.34],'wood','barn-gable-joint',header);
  }
  for(const piece of a.plan.pieces)if(piece.role==='facade-brace'&&piece.end&&piece.position[2]<front&&Math.abs(piece.end[0]-piece.position[0])>.1)piece.removed=true;
 }
 const hay=(x:number,y:number,z:number)=>{
  const bale=a.piece('box',[x,y+.38,z],[.85,.76,.90],'thatch','barn-hay-bale',foundation);
  for(const offset of [-.24,.24]){
   a.piece('box',[x+offset,y+.765,z],[.045,.035,.91],'wood','barn-hay-tie',bale);
   for(const side of [-1,1])a.piece('box',[x+offset,y+.38,z+side*.46],[.045,.77,.035],'wood','barn-hay-tie',bale);
  }
 };
 hay(-w/2-.70,0,d*.22);hay(-w/2-.70,0,d*.22+1.02);hay(-w/2-.70,.78,d*.22+.45);
 hay(w/2+.2,0,front-.90);
 for(const [x,z] of [[-w/2-.7,-d*.12],[w/2+.30,front-.72]]){
  const barrel=a.piece('column',[x,.43,z],[.72,.86,.72],'wood','barn-barrel',foundation);
  for(const y of [.14,.70])a.piece('column',[x,y,z],[.73,.06,.73],'metal','barn-barrel-hoop',barrel);
  a.piece('column',[x,.88,z],[.58,.035,.58],'wood','barn-barrel-lid',barrel);
 }
 for(const [x,z] of [[-w/2-.72,-d*.12-.90],[w/2+.30,front-1.62]]){
  const crate=a.piece('box',[x,.28,z],[.58,.56,.58],'wood','barn-supply-crate',foundation);
  for(const y of [.08,.48])a.piece('box',[x,y,z-.30],[.62,.09,.06],'wood','barn-crate-frame',crate);
  a.beam([x-.22,.10,z-.335],[x+.22,.46,z-.335],.07,'wood','barn-crate-diagonal',crate);
 }
 return a.finish();}
