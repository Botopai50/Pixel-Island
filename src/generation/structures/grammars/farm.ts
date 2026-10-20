import {Architect} from '../blueprint';
import {projectTimber} from './houses';
import type {GrammarContext,V3} from '../types';

export function farm(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.025),d=a.value(p.depth,.025),h=a.value(p.height,.035),roof=p.roof==='auto'?'thatch':p.roof;
 const home=a.building(w*.24,d*.24,w*.40,d*.43,h,1,{base:.36,roof,role:'farmhouse'});
 const shed=a.building(-w*.28,d*.12,w*.29,d*.38,h*.83,1,{base:.22,material:'wood',roof,role:'farm-barn'});
 for(const piece of a.plan.pieces)if(piece.kind==='stairs')piece.removed=true;
 for(const v of [home,shed])projectTimber(a,v);
 a.plan.openings=a.plan.openings.filter(o=>o.kind==='door');
 for(const side of [1,3])for(const sign of [-1,1]){
  const wall=home.id+'_wall_'+side;
  a.plan.openings.push({id:wall+'_window_'+sign,wall,kind:'window',offset:sign*home.depth*.22,bottom:h*.40,height:Math.min(.96,h*.32),width:Math.min(.85,home.depth*.23),shutterAngles:[155,155]});
 }
 const shedDoor=a.plan.openings.find(o=>o.wall===shed.id+'_wall_0')!;
 shedDoor.offset=0;shedDoor.width=Math.min(2.35,shed.width*.65);shedDoor.height=Math.min(2.22,shed.height*.87);
 a.veranda(home);
 for(const piece of a.plan.pieces)if(piece.role==='veranda')piece.material='stone';
 a.chimney(home);
 const beam=(from:V3,to:V3,section:number,role:string,support='ground')=>a.beam(from,to,section,'wood',role,support);
 const box=(at:V3,size:V3,role:string,support='ground')=>a.piece('box',at,size,'wood',role,support);
 for(const v of [home,shed]){
  const r=a.plan.roofs.find(r=>r.volume===v.id)!,z=v.z-v.depth/2-.15,top=v.bottom+v.height,peak=v.x-v.width/2+v.width*(r.ridgeRatio??.5);
  beam([v.x-v.width/2,top-.08,z],[v.x+v.width/2,top-.08,z],.25,'farm-gable-header',r.id);
  beam([peak,top-.08,z],[peak,top+r.rise-.08,z],.20,'farm-gable-post',r.id);
  for(const side of [-1,1])beam([v.x+side*v.width*.40,top,z],[peak,top+r.rise*.76,z],.18,'farm-gable-brace',r.id);
  if(r.kind==='thatch'){
   const yy=top+r.rise+.45*Math.sqrt(1+(r.rise/(v.width*.5))**2)+.05;
   const ridge=a.piece('column',[peak,yy,v.z],[.36,.36,v.depth+2*r.eaves],'thatch','farm-ridge-bundle',r.id);
   const count=Math.max(3,Math.ceil(v.depth/.65));
   for(let i=0;i<=count;i++)a.piece('column',[peak,yy,v.z-v.depth/2+i*v.depth/count],[.21,.02,.21],'wood','farm-ridge-binding',ridge);
  }
  if(v===home){
   const yy=top+r.rise*.48,size=Math.min(.28,r.rise*.24),zz=z-.08;
   a.piece('box',[peak,yy,zz],[size,size,.045],'dark','farm-attic-pane',r.id,[0,0,Math.PI/4]);
   for(const side of [-1,1]){
    beam([peak-size*.78,yy,zz-.03],[peak,yy+side*size*.78,zz-.03],.07,'farm-attic-frame',r.id);
    beam([peak,yy+side*size*.78,zz-.03],[peak+size*.78,yy,zz-.03],.07,'farm-attic-frame',r.id);
   }
  }
 }
 // Two hinged leaves fill the actual barn opening, without an automatic door behind them.
 const z=shed.z-shed.depth/2-.12,doorWall=shedDoor.wall,doorY=shed.bottom+shedDoor.height/2;
 for(const side of [-1,1]){
  const x=shed.x+side*shedDoor.width/4,leafW=shedDoor.width/2-.025;
  const leaf=box([x,doorY,z],[leafW,shedDoor.height-.05,.12],'farm-barn-door',doorWall);
  for(const yy of [shed.bottom+.15,shed.bottom+shedDoor.height-.15])box([x,yy,z-.09],[leafW,.14,.12],'farm-door-frame',leaf);
  beam([x-side*leafW*.38,shed.bottom+.22,z-.16],[x+side*leafW*.38,shed.bottom+shedDoor.height-.22,z-.16],.12,'farm-door-brace',leaf);
  for(const yy of [.27,.77])a.piece('box',[x, shed.bottom+shedDoor.height*yy,z-.18],[leafW*.85,.09,.035],'metal','farm-door-strap',leaf);
  a.piece('wheel',[shed.x+side*.13,doorY-.15,z-.21],[.12,.12,.025],'metal','farm-door-ring',leaf);
 }
 const barrel=(x:number,z:number)=>{
  const id=a.piece('column',[x,.44,z],[.65,.88,.65],'wood','barn-barrel');
  for(const yy of [.17,.71])a.piece('column',[x,yy,z],[.66,.06,.66],'metal','barn-barrel-hoop',id);
  a.piece('column',[x,.89,z],[.55,.035,.55],'wood','barn-barrel-lid',id);
 };
 barrel(shed.x+shed.width/2+.45,shed.z-shed.depth*.30);barrel(home.x-home.width*.19,home.z-home.depth/2-.85);
 const crate=(x:number,z:number)=>{
  const id=box([x,.28,z],[.54,.56,.54],'farm-crate');
  for(const yy of [.08,.47])box([x,yy,z-.29],[.58,.085,.06],'farm-crate-frame',id);
  beam([x-.20,.12,z-.325],[x+.20,.45,z-.325],.065,'farm-crate-brace',id);
 };
 crate(shed.x+shed.width/2+.42,shed.z-shed.depth*.30-.75);
 // Lean-to supplies on the outer side of the barn.
 const hayX=shed.x-shed.width/2-.45;
 for(let i=0;i<3;i++){
  const yy=i===2?.86:.29,zz=shed.z+(i===1?.48:-.18);
  const bale=a.piece('box',[hayX,yy,zz],[.65,.58,.63],'thatch','farm-hay-bale');
  for(const off of [-.18,.18])box([hayX+off,yy+.30,zz],[.035,.025,.65],'farm-hay-tie',bale);
 }
 const cover=box([hayX,2.02,shed.z],[1.18,.12,1.85],'farm-supply-cover');
 for(const zz of [-.72,.72])beam([hayX-.45,0,shed.z+zz],[hayX-.45,1.94,shed.z+zz],.15,'farm-supply-post',cover);
 const toolX=shed.x-shed.width*.34,toolZ=shed.z-shed.depth/2-.37;
 for(const offset of [0,.30]){
  const handle=beam([toolX+offset,.12,toolZ-.20],[toolX+offset,1.70,toolZ],.045,'farm-tool-handle');
  a.piece('box',[toolX+offset,.20,toolZ-.20],[.19,.32,.055],'metal','farm-shovel',handle);
 }
 // Window boxes fit the two visible side windows and stay out of the shutters' sweep.
 for(const opening of a.plan.openings.filter(o=>o.kind==='window')){
  const wall=a.plan.walls.find(w=>w.id===opening.wall)!,dx=wall.end[0]-wall.start[0],dz=wall.end[2]-wall.start[2],len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len,nx=uz,nz=-ux;
  const x=(wall.start[0]+wall.end[0])/2+ux*opening.offset+nx*.25,zz=(wall.start[2]+wall.end[2])/2+uz*opening.offset+nz*.25,yy=wall.bottom+opening.bottom-.21;
  const id=box([x,yy,zz],[opening.width+.2,.25,.34],'farm-window-box',wall.id);
  const piece=a.plan.pieces.find(p=>p.id===id)!;piece.rotation=[0,-Math.atan2(dz,dx),0];
  for(const role of ['farm-window-flowers','farm-window-blossoms'])a.piece('box',[x,yy+.17,zz],[.6,.15,.28],'cloth',role,id,[0,-Math.atan2(dz,dx),0]);
 }
 // Three framed, cultivated beds with a different vegetable in each.
 const bedW=w*.45,bedD=d*.078,bedX=-w*.14;
 const zone={id:'cultivation',x:bedX,z:-d*.285,width:bedW,depth:d*.33,y:.08,kind:'cultivation' as const};a.plan.propZones.push(zone);
 for(let row=0;row<3;row++){
  const zz=-d*.405+row*d*.115;
  const soil=a.piece('box',[bedX,.095,zz],[bedW,.15,bedD],'earth','farm-crop-soil');
  for(const side of [-1,1]){
   box([bedX,.13,zz+side*(bedD/2+.025)],[bedW+.16,.18,.09],'farm-bed-frame',soil);
   box([bedX+side*(bedW/2+.025),.13,zz],[.09,.18,bedD+.18],'farm-bed-frame',soil);
  }
  const count=Math.max(3,Math.floor(bedW/.63)),scale=Math.min(.40,bedW/count*.64,bedD*.47);
  for(let i=0;i<count;i++)for(const sign of [-1,1]){
   const x=bedX-bedW/2+(i+.5)*bedW/count+(a.rnd()-.5)*.07,z=zz+sign*bedD*.23;
   a.piece('box',[x,.18,z],[scale,scale,scale],'cloth',row===0?'farm-cabbage':row===1?'farm-carrot-leaves':'farm-leafy-crop',soil);
   if(row===1)a.piece('box',[x,.18,z],[scale*.65,scale*.55,scale*.65],'cloth','farm-carrot-root',soil);
  }
 }
 const gateX=w*.27,gateW=Math.min(1.9,w*.17),front=-d/2;
 // Dirt paths join the real entrance opening rather than passing through the planting beds.
 const path=(x:number,z:number,ww:number,dd:number)=>a.piece('box',[x,.012,z],[ww,.012,dd],'earth','farm-path');
 const porchFront=home.z-home.depth/2-1.65;
 path(gateX,(front-1+porchFront)/2,Math.min(1.0,w*.08),porchFront-front+1);
 path((shed.x+gateX)/2,porchFront+.1,gateX-shed.x,Math.min(.80,d*.065));
 for(let i=0;i<14;i++)a.piece('rock',[gateX+(a.rnd()-.5)*.85,.04,front-.65+i*(porchFront-front+.3)/14],[.09+a.rnd()*.06,.025,.07+a.rnd()*.05],'stone','farm-path-pebble');
 const posts=new Set<string>();
 const post=(x:number,z:number)=>{
  const key=x.toFixed(5)+':'+z.toFixed(5);if(posts.has(key))return;posts.add(key);
  const id=beam([x,0,z],[x,1.16,z],.19,'farm-fence-post');
  box([x,1.18,z],[.25,.10,.25],'farm-fence-cap',id);
 };
 const fence=(x1:number,z1:number,x2:number,z2:number)=>{
  const n=Math.max(1,Math.ceil(Math.hypot(x2-x1,z2-z1)/1.8));
  for(let i=0;i<=n;i++)post(x1+(x2-x1)*i/n,z1+(z2-z1)*i/n);
  for(const yy of [.43,.87])beam([x1,yy,z1],[x2,yy,z2],.12,'farm-fence-rail');
 };
 fence(-w/2,front,gateX-gateW/2,front);fence(gateX+gateW/2,front,w/2,front);
 fence(-w/2,front,-w/2,d/2);fence(w/2,front,w/2,d/2);fence(-w/2,d/2,w/2,d/2);
 const gate=box([gateX,.55,front],[gateW-.10,.93,.11],'farm-gate');
 for(const yy of [.18,.94])box([gateX,yy,front-.095],[gateW-.10,.13,.11],'farm-gate-frame',gate);
 beam([gateX-gateW*.42,.22,front-.16],[gateX+gateW*.42,.91,front-.16],.10,'farm-gate-brace',gate);
 for(const yy of [.26,.85])a.piece('box',[gateX-gateW*.32,yy,front-.17],[.37,.10,.035],'metal','farm-gate-hinge',gate);
 return a.finish();
}
