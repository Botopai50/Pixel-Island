import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function outpost(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.025),d=a.value(p.depth,.025),fh=p.height*.39,gate=Math.min(3.3,w*.27);
 const posts=new Map<string,string>();
 const collar=(x:number,y:number,z:number,size:number,parent:string)=>{
  const plate=a.piece('box',[x,y,z],[size,.20,size],'metal','outpost-iron-collar',parent);
  for(const side of [-1,1])for(const offset of [-size*.23,size*.23]){
   a.piece('box',[x+offset,y,z+side*(size/2+.018)],[.05,.055,.035],'metal','outpost-rivet',plate);
   a.piece('box',[x+side*(size/2+.018),y,z+offset],[.035,.055,.05],'metal','outpost-rivet',plate);
  }
 };
 const post=(x:number,z:number)=>{
  const key=x.toFixed(3)+':'+z.toFixed(3);if(posts.has(key))return posts.get(key)!;
  const foot=a.piece('box',[x,.15,z],[.69,.30,.69],'stone','outpost-post-foot');
  const id=a.piece('box',[x,(fh+.75)/2,z],[.57,fh+.75,.57],'wood','outpost-fence-post',foot);posts.set(key,id);
  a.piece('box',[x,fh+.77,z],[.64,.15,.64],'wood','outpost-post-cap',id);collar(x,.25,z,.63,id);collar(x,fh+.43,z,.64,id);return id;
 };
 const fence=(start:V3,end:V3)=>{
  const dx=end[0]-start[0],dz=end[2]-start[2],length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length,bays=Math.max(1,Math.ceil(length/4));
  for(let bay=0;bay<bays;bay++){
   const t0=bay/bays,t1=(bay+1)/bays,x0=start[0]+dx*t0,z0=start[2]+dz*t0,x1=start[0]+dx*t1,z1=start[2]+dz*t1;
   const root=post(x0,z0);post(x1,z1);
   const innerLength=length/bays-.57,n=Math.max(1,Math.ceil(innerLength/.38)),pitch=innerLength/n;
   for(let i=0;i<n;i++){
    const t=.285+(i+.5)*pitch,x=x0+ux*t,z=z0+uz*t,height=a.value(fh,.045);
    const stake=a.piece('box',[x,height/2,z],[pitch-.012,height,.30],'wood','outpost-palisade',root,[0,Math.atan2(-uz,ux),0]);
    a.piece('box',[x,height+.16,z],[pitch-.012,.32,.30],'wood','outpost-stake-tip',stake,[0,Math.atan2(-uz,ux),0]);
   }
   a.beam([x0+ux*.285,fh*.57,z0+uz*.285],[x1-ux*.285,fh*.57,z1-uz*.285],.18,'wood','outpost-fence-rail',root);
  }
 };
 fence([-w/2,0,-d/2],[-gate/2,0,-d/2]);fence([gate/2,0,-d/2],[w/2,0,-d/2]);
 fence([w/2,0,-d/2],[w/2,0,d/2]);fence([w/2,0,d/2],[-w/2,0,d/2]);fence([-w/2,0,d/2],[-w/2,0,-d/2]);
 const gateY=fh+.30,leftPost=post(-gate/2,-d/2),rightPost=post(gate/2,-d/2);
 a.piece('arch',[0,gateY,-d/2],[gate,.65,.34],'wood','outpost-gate-arch',leftPost);
 for(const side of [-1,1]){
  const cx=side*gate/4,count=Math.max(4,Math.ceil(gate/2/.28)),width=gate/2/count;
  for(let i=0;i<count;i++){
   const x=side<0?-gate/2+(i+.5)*width:(i+.5)*width,height=gateY-.12+.20*(1-(x/(gate/2))**2);
   a.piece('box',[x,height/2+.10,-d/2],[width-.015,height,.18],'wood','outpost-gate-plank',side<0?leftPost:rightPost);
  }
  for(const y of [.47,gateY*.53,gateY-.27]){
   const bar=a.piece('box',[cx,y,-d/2-.12],[gate/2-.17,.14,.07],'metal','outpost-gate-strap',leftPost);
   for(const dx of [-gate*.18,gate*.18])a.piece('box',[cx+dx,y,-d/2-.168],[.055,.055,.025],'metal','outpost-rivet',bar);
  }
  a.piece('box',[side*.25,gateY*.48,-d/2-.19],[.20,.20,.05],'metal','outpost-door-ring',leftPost);
  const bannerX=side*gate/2,bannerPost=side<0?leftPost:rightPost;
  a.beam([bannerX-.37,fh+.08,-d/2-.35],[bannerX+.37,fh+.08,-d/2-.35],.085,'wood','outpost-banner-rod',bannerPost);
  a.piece('box',[bannerX,fh-.58,-d/2-.39],[.57,1.24,.025],'cloth','fortress-banner',bannerPost);
 }
 const bw=w*.46,bd=d*.40,bh=p.height*.61,bz=d*.13,base=.43;
 const shedWidth=Math.min(1.65,w*.11),shedX=-w*.09+bw/2+shedWidth/2,shedZ=bz+bd*.24,shedY=base+bh*.70,shedPitch=.30,shedHalf=bd*.22;
 const home=a.building(-w*.09,bz,bw,bd,bh,1,{base,material:'wood',roof:p.roof==='auto'?'gable':p.roof,role:'guardhouse'});
 for(const opening of a.plan.openings){
  if(opening.kind!=='window')continue;
  if(opening.wall===home.id+'_wall_1'){
   // Include fascia, shutters and window frame when reserving the wall bay.
   const first=-bd/2+.38,last=shedZ-bz-shedHalf-.56;
   opening.width=Math.min(opening.width,Math.max(.20,(last-first)/2));
   opening.offset=Math.max(first+opening.width,Math.min(-bd*.25,last-opening.width));
  }
 }
 // The uncovered side has its own layout stream and no mirrored window bay.
 const sideWall=home.id+'_wall_3',windowLayout=c.streams.streamFor('outpost-side-windows',sideWall);
 a.plan.openings=a.plan.openings.filter(o=>o.wall!==sideWall||o.kind!=='window');
 if(p.openingDensity>0){
  const count=bd>=3.5&&windowLayout()<.5?2:1,width=Math.min(.9,(bd-.9)/4.6),span=bd/2-.38-width;
  const offsets=count===1?[(windowLayout()<.5?-1:1)*span*(.45+windowLayout()*.5)]:[
   -span+windowLayout()*Math.max(0,span-width-.15),span-windowLayout()*Math.max(0,span-width-.15),
  ];
  for(let i=0;i<count;i++)a.plan.openings.push({id:sideWall+'_window_0_'+i,wall:sideWall,kind:'window',offset:offsets[i],width,bottom:bh*.4,height:Math.min(1.1,bh*.35)});
 }
 const homeRoot=a.plan.pieces.find(piece=>piece.role==='foundation')!.id;
 for(const sx of [-1,1])for(const sz of [-1,1]){
  const x=home.x+sx*bw/2,z=bz+sz*bd/2;
  const foot=a.piece('box',[x,.22,z],[.57,.44,.57],'stone','outpost-house-foot',homeRoot);
  const post=a.piece('box',[x,base+bh/2,z],[.34,bh,.34],'wood','outpost-house-post',foot);collar(x,base+.14,z,.40,post);collar(x,base+bh-.22,z,.40,post);
 }
 const roof=a.plan.roofs.find(roof=>roof.volume===home.id)!;
 if(roof.kind==='gable')for(const side of [-1,1]){
  const z=bz+side*(bd/2+.15),ridge=home.x-bw/2+bw*(roof.ridgeRatio??.5),peak:V3=[ridge,base+bh+roof.rise-.16,z];
  const finialZ=bz+side*(bd/2+roof.eaves-.02),finialY=roof.y+roof.rise+.22;
  const finial=a.piece('box',[ridge,finialY,finialZ],[.40,.48,.40],'wood','outpost-roof-finial-post',homeRoot);
  a.piece('box',[ridge,finialY+.27,finialZ],[.46,.10,.46],'wood','outpost-roof-finial-cap',finial);
  collar(ridge,finialY-.10,finialZ,.45,finial);
  for(const sx of [-1,1]){
   const run=bw*(sx<0?(roof.ridgeRatio??.5):1-(roof.ridgeRatio??.5)),pitch=Math.atan(roof.rise/run);
   const x=home.x+sx*(bw/2+roof.eaves*.55),y=roof.y-roof.rise/run*roof.eaves*.55+.18/Math.cos(pitch);
   const plate=a.piece('box',[x,y,finialZ+side*.04],[.38,.045,.34],'metal','outpost-roof-strap',homeRoot,[0,0,-sx*pitch]);
   for(const offset of [-.11,.11])a.piece('box',[x+offset*Math.cos(pitch),y-sx*offset*Math.sin(pitch)+.035,finialZ+side*.04],[.05,.035,.05],'metal','outpost-rivet',plate,[0,0,-sx*pitch]);
  }
  // Structural rafters sit under the skin; native roof trim owns the eave joint.
  for(const sx of [-1,1])a.beam([home.x+sx*bw/2,base+bh-.16,z],peak,.24,'wood','outpost-roof-rafter',homeRoot,{start:[1,0,0],end:[1,0,0]});
  a.beam([home.x-bw/2,base+bh-.08,z],[home.x+bw/2,base+bh-.08,z],.30,'wood','outpost-gable-tie',homeRoot);
  a.beam([home.x,base+bh,z],[home.x,base+bh+roof.rise-.14,z],.22,'wood','outpost-gable-post',homeRoot);
  for(const sx of [-1,1])a.beam([home.x+sx*bw*.30,base+bh+.08,z],[home.x,base+bh+roof.rise*.62,z],.20,'wood','outpost-gable-brace',homeRoot);
  for(const sx of [-1,0,1]){
   const x=home.x+sx*bw*.38,y=base+bh-.08,plate=a.piece('box',[x,y,z+side*.17],[.28,.30,.06],'metal','outpost-gable-joint-plate',homeRoot);
   for(const offset of [-.08,.08])a.piece('box',[x+offset,y,z+side*.215],[.045,.045,.03],'metal','outpost-rivet',plate);
  }
 }
 // Vertical board cladding respects every native door and window opening.
 for(const wall of a.plan.walls.filter(w=>w.volume===home.id)){
  const dx=wall.end[0]-wall.start[0],dz=wall.end[2]-wall.start[2],length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length,n=Math.ceil(length/.30),pitch=length/n;
  for(let i=0;i<n;i++){
   const offset=-length/2+(i+.5)*pitch,openings=a.plan.openings.filter(o=>o.wall===wall.id&&Math.abs(o.offset-offset)<o.width/2+pitch/2);
   const intervals=([[0,bh]] as [number,number][]);
   for(const opening of openings){const bottom=opening.bottom,top=bottom+opening.height;for(let j=intervals.length-1;j>=0;j--){const [lo,hi]=intervals[j];if(top<=lo||bottom>=hi)continue;intervals.splice(j,1,...([[lo,Math.min(bottom,hi)],[Math.max(top,lo),hi]] as [number,number][]).filter(([a,b])=>b-a>.02));}}
   for(const [lo,hi] of intervals){const t=(i+.5)*pitch;
    a.piece('box',[wall.start[0]+ux*t+uz*.11,base+(lo+hi)/2,wall.start[2]+uz*t-ux*.11],[pitch-.012,hi-lo,.085],'wood','outpost-wall-plank',homeRoot,[0,Math.atan2(-uz,ux),0]);
   }
  }
 }
 const front=bz-bd/2,door=a.plan.openings.find(o=>o.wall===home.id+'_wall_0'&&o.kind==='door')!,doorX=home.x+door.offset;
 for(const piece of a.plan.pieces)if(piece.kind==='stairs')piece.removed=true;
 // Both lean-to roofs drain away from the house. Frame and posts share the
 // roof's slope, so their joints remain aligned at every building size.
 const porchW=Math.min(2.8,bw*.62),porchD=Math.min(1.45,bd*.48),porchY=base+Math.min(2.85,bh*.90),slope=.32;
 const porchPoint=(x:number,z:number,drop=0):V3=>[doorX+x,porchY+Math.tan(slope)*(z+porchD/2)-drop,front+z];
 a.piece('box',[doorX,porchY,front-porchD/2],[porchW+.40,.12,(porchD+.32)/Math.cos(slope)],'roof','outpost-entry-canopy',homeRoot,[-slope,0,0]);
 for(let edge=0;edge<4;edge++)a.piece('box',[doorX,porchY,front-porchD/2],[porchW+.64,.22,(porchD+.32)/Math.cos(slope)+.24],'wood','outpost-roof-fascia-'+edge,homeRoot,[-slope,0,0]);
 const porchHeaderY=porchPoint(0,-porchD,.24)[1];
 for(const side of [-1,1]){
  const x=doorX+side*porchW/2,z=front-porchD;
  const foot=a.piece('box',[x,.18,z],[.49,.36,.49],'stone','outpost-porch-foot');
  const top=porchHeaderY-.11;
  const post=a.piece('box',[x,(.36+top)/2,z],[.26,top-.36,.26],'wood','outpost-porch-post',foot);collar(x,.48,z,.31,post);
  collar(x,top-.13,z,.31,post);
  a.beam(porchPoint(side*porchW/2,-porchD,.12),porchPoint(side*porchW/2,.10,.12),.18,'wood','outpost-canopy-rafter',post);
  a.beam([x,top-.43,z],porchPoint(side*porchW/2,-porchD+.42,.16),.13,'wood','outpost-canopy-knee',post);
 }
 a.beam([doorX-porchW/2-.12,porchHeaderY,front-porchD],[doorX+porchW/2+.12,porchHeaderY,front-porchD],.22,'wood','outpost-canopy-header',homeRoot);
 for(let i=0;i<3;i++)a.piece('box',[doorX,(base*(1-i/3))/2,front-.25-i*.29],[porchW*.76,base*(1-i/3),.29],'stone','outpost-entry-step');
 // A lean-to and supplies sit beside the house, clear of the entrance path.
 const shedPoint=(x:number,z:number,drop=0):V3=>[shedX+x,shedY-Math.tan(shedPitch)*x-drop,shedZ+z];
 a.piece('box',[shedX,shedY,shedZ],[(shedWidth+.30)/Math.cos(shedPitch),.12,2*shedHalf+.32],'roof','outpost-side-awning',homeRoot,[0,0,-shedPitch]);
 for(let edge=0;edge<4;edge++)a.piece('box',[shedX,shedY,shedZ],[(shedWidth+.30)/Math.cos(shedPitch)+.24,.22,2*shedHalf+.56],'wood','outpost-roof-fascia-'+edge,homeRoot,[0,0,-shedPitch]);
 const shedOuter=shedWidth/2,shedHeaderY=shedPoint(shedOuter,0,.24)[1];
 a.beam(shedPoint(shedOuter,-shedHalf-.08,.24),shedPoint(shedOuter,shedHalf+.08,.24),.22,'wood','outpost-shed-header',homeRoot);
 for(const z of [-shedHalf,shedHalf]){
  const x=shedX+shedOuter,top=shedHeaderY-.11;
  const foot=a.piece('box',[x,.15,shedZ+z],[.43,.30,.43],'stone','outpost-shed-foot',homeRoot);
  const post=a.piece('box',[x,(top+.30)/2,shedZ+z],[.24,top-.30,.24],'wood','outpost-shed-post',foot);
  collar(x,top-.12,shedZ+z,.29,post);
  a.beam(shedPoint(-shedWidth/2,z,.12),shedPoint(shedOuter,z,.12),.18,'wood','outpost-shed-rafter',post);
  a.beam([x,top-.42,shedZ+z],shedPoint(shedOuter-.40,z,.16),.13,'wood','outpost-shed-knee',post);
 }
 for(let i=0;i<5;i++){
  const spacing=Math.min(.23,Math.max(.10,(shedWidth-.44)/2)),x=home.x+bw/2+.30+i%3*spacing,yy=.12+Math.floor(i/3)*.19,z=shedZ-shedHalf+.50;
  const log=a.piece('column',[x,yy,z],[.22,.90,.22],'wood','camp-firewood',homeRoot,[Math.PI/2,0,0]);
  for(const side of [-1,1])a.piece('column',[x,yy,z+side*.46],[.19,.025,.19],'wood','camp-firewood-end',log,[Math.PI/2,0,0]);
 }
 const supplyZ=front-.62,barrel=a.piece('box',[doorX-porchW*.68,.43,supplyZ],[.64,.86,.64],'wood','fortress-barrel');
 for(const y of [.16,.67])a.piece('box',[doorX-porchW*.68,y,supplyZ],[.66,.10,.66],'metal','fortress-barrel-hoop',barrel);
 a.piece('box',[doorX-porchW*.68,.87,supplyZ],[.53,.06,.53],'wood','fortress-barrel-lid',barrel);
 const crates: [number,number][]=[[doorX+porchW*.64,supplyZ]];
 if(shedHalf>.9)crates.push([home.x+bw/2+.55,shedZ+shedHalf-.35]);
 for(const [x,z] of crates){
  const crate=a.piece('box',[x,.36,z],[.66,.72,.66],'wood','outpost-crate');
  for(const yy of [.08,.65])a.piece('box',[x,yy,z-.345],[.70,.11,.08],'wood','outpost-crate-bar',crate);
 }
 const pathStart=-d/2-.7,pathEnd=front-.65,pathRows=Math.ceil((pathEnd-pathStart)/.23);
 for(let i=0;i<pathRows;i++)for(let j=-3;j<=3;j++){
  if(a.rnd()>(Math.abs(j)===3?.28:.85))continue;
  const t=i/pathRows,z=pathStart+(i+.5)*.23,x=doorX*t+Math.sin(t*5)*.14+j*.23;
  a.piece('box',[x,.008,z],[.23,.012,.23],'earth','outpost-yard-path');
 }
 a.plan.propZones.push({id:'outpost-yard',x:0,z:-d*.13,width:w*.65,depth:d*.35,y:0,kind:'garden'});
 for(const side of [-1,1])a.plan.propZones.push({id:'outpost-border-'+side,x:side*w*.43,z:0,width:.8,depth:d*.7,y:0,kind:'garden'});
 return a.finish();
}
