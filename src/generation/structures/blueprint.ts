import {resolveConnections} from './connections';
import {dressRoof} from './roofDetails';
import {selectAutomaticRoof} from './roofSelection';
import type {GrammarContext,StructurePlan,VolumeSpec,PieceSpec,SurfaceMaterial,V3,RoofKind,WallSpec} from './types';
export class Architect {
 readonly plan:StructurePlan;readonly rnd:()=>number;
 constructor(readonly context:GrammarContext){this.rnd=context.streams.streamFor('architecture','main');this.plan={schemaVersion:1,type:context.config.type,seed:context.seed,volumes:[],walls:[],openings:[],roofs:[],pieces:[],joints:[],supports:[],accesses:[],damage:[],debris:[],propZones:[]};}
 depend(component:string,on:string[],minimum=on.length){this.plan.supports=this.plan.supports.filter(s=>s.component!==component);for(const parent of on)this.plan.supports.push({component,on:parent,minimum});const piece=this.plan.pieces.find(p=>p.id===component);if(piece)piece.support=on[0];}
 value(n:number,spread=.18){return n*(1+(this.rnd()-.5)*2*spread);}
 piece(kind:PieceSpec['kind'],position:V3,size:V3,material:SurfaceMaterial,role:string,support='ground',rotation?:V3,end?:V3){const p:PieceSpec={id:'piece_'+this.plan.pieces.length,kind,position,size,material,role,support,rotation,end};this.plan.pieces.push(p);this.plan.supports.push({component:p.id,on:support});return p.id;}
 beam(start:V3,end:V3,width:number,material:SurfaceMaterial='wood',role='brace',support='ground',cuts?:PieceSpec['cuts']){
 const id=this.piece('beam',start,[width,width,width],material,role,support,undefined,end);
 if(cuts)this.plan.pieces[this.plan.pieces.length-1].cuts=cuts;
 for(const point of [start,end]){const key=point.map(n=>n.toFixed(4)).join(':');let joint=this.plan.joints.find(j=>j.id===key);if(!joint){joint={id:key,point:[...point],members:[]};this.plan.joints.push(joint);}joint.members.push(id);}return id;
 }
 stairs(from:V3,to:V3,width=1.5){this.plan.accesses.push({id:'access_'+this.plan.accesses.length,from,to,width,role:'stairs'});return this.piece('stairs',from,[width,Math.abs(to[1]-from[1]),Math.hypot(to[0]-from[0],to[2]-from[2])],'stone','stairs','ground',undefined,to);}
 building(x:number,z:number,w:number,d:number,h:number,floors=1,options:{base?:number;material?:SurfaceMaterial;roof?:RoofKind;open?:boolean;door?:boolean;role?:string}={}){
 const cfg=this.context.config,base=options.base??.25,id='volume_'+this.plan.volumes.length;
 const v:VolumeSpec={id,x,z,width:w,depth:d,bottom:base,height:h,floors,role:options.role??'building'};this.plan.volumes.push(v);
 const foundation=this.piece('box',[x,base/2,z],[w+.25,base,d+.25],'stone','foundation');
 for(let level=0;level<floors;level++){
  const y=base+level*h/floors+.06;
  if(level===0||w<2.6||d<2.6)this.piece('box',[x,y,z],[w-.04,.12,d-.04],'wood','floor',foundation);
  else {const strip=1.45;this.piece('box',[x+strip/2,y,z],[w-strip-.04,.12,d-.04],'wood','floor',foundation);this.piece('box',[x-w/2+strip/2,y,z+d/2-.65],[strip-.04,.12,1.25],'wood','floor-landing',foundation);this.stairs([x-w/2+.74,base+(level-1)*h/floors+.12,z-d/2+.55],[x-w/2+.74,base+level*h/floors+.12,z+d/2-.65],1.15);}
 }
 const corners:V3[]=[[x-w/2,base,z-d/2],[x+w/2,base,z-d/2],[x+w/2,base,z+d/2],[x-w/2,base,z+d/2]];
 const roofKind=options.roof??cfg.roof,resolved=roofKind==='auto'?selectAutomaticRoof(cfg,v.role,this.rnd()):roofKind;
 const main=this.plan.volumes[0],sideAnnex=['annex','wing','entrance','shed'].includes(v.role)&&Math.abs(x-main.x)>.25;
 const shedDirection:1|-1=sideAnnex?(x>main.x?-1:1):(this.context.streams.streamFor('roof-direction',id)()<.5?1:-1);
 const rise=resolved==='flat'?.16:(resolved==='hip'?Math.min(w,d):w)*(.20+cfg.roofPitch*.33),ridgeRatio=.5+(this.rnd()-.5)*.16*cfg.asymmetry;
 for(let s=0;s<4;s++){
  if(!options.open){const wall:WallSpec={id:id+'_wall_'+s,volume:id,start:corners[s],end:corners[(s+1)%4],bottom:base,height:h,thickness:.18,material:options.material??'plaster'};
  if((resolved==='gable'||resolved==='thatch')&&(s===0||s===2))wall.gable={peak:rise,ratio:s===0?ridgeRatio:1-ridgeRatio};
  if(resolved==='shed'){const left=h+(shedDirection<0?rise:0),right=h+(shedDirection>0?rise:0);if(s===0){wall.topLeft=left;wall.topRight=right;}if(s===2){wall.topLeft=right;wall.topRight=left;}if(s===(shedDirection>0?1:3))wall.height=h+rise;}
  this.plan.walls.push(wall);this.plan.supports.push({component:wall.id,on:foundation});
  const len=s%2?d:w;
  const door=s===0&&options.door!==false,doorOffset=(this.rnd()-.5)*Math.max(0,len-3)*cfg.asymmetry;
  if(door)this.plan.openings.push({id:wall.id+'_door',wall:wall.id,kind:'door',offset:doorOffset,width:Math.min(1.35,len*.3),bottom:0,height:Math.min(2.15,h*.78)});
  const spacing=2.5,count=Math.min(6,Math.floor(len/spacing*cfg.openingDensity*(.55+cfg.complexity*.9)));
  for(let l=0;l<floors;l++)for(let k=0;k<count;k++){const off=-len/2+(k+1)*len/(count+1);if(l===0&&door&&Math.abs(off-doorOffset)<1.6)continue;const bottom=l*h/floors+Math.max(.55,h/floors*.4),wh=Math.min(1.1,h/floors*.35);if(bottom+wh<h-.25)this.plan.openings.push({id:wall.id+'_window_'+l+'_'+k,wall:wall.id,kind:'window',offset:off,width:Math.min(.9,len/(count+1)*.5),bottom,height:wh});}
  }
  const a=corners[s],b=corners[(s+1)%4];
  const masonry=options.material==='stone',frameMaterial=masonry?'stone':'wood',postWidth=masonry?.38:.30;
  for(let l=0;l<=floors;l++){const frameWidth=masonry?.28:.24,y=base+l*h/floors-(l===floors?frameWidth/2+.025:0);const delta:[number,number]=[(b[0]-a[0])/Math.hypot(b[0]-a[0],b[2]-a[2]),(b[2]-a[2])/Math.hypot(b[0]-a[0],b[2]-a[2])];this.beam([a[0]+delta[0]*(postWidth/2-.01),y,a[2]+delta[1]*(postWidth/2-.01)],[b[0]-delta[0]*(postWidth/2-.01),y,b[2]-delta[1]*(postWidth/2-.01)],frameWidth,frameMaterial,'wall-frame',foundation);}
  this.beam(a,[a[0],base+h+(resolved==='shed'&&((a[0]>x)===(shedDirection>0))?rise:0),a[2]],postWidth,frameMaterial,'corner-post',foundation);
  // The plaster field is broken into timber bays, with short corner braces
  // outside the skin and above the openings instead of random face clutter.
  if(!options.open&&(options.material??'plaster')!=='stone'&&cfg.complexity>.25){
   const len=Math.hypot(b[0]-a[0],b[2]-a[2]),ux=(b[0]-a[0])/len,uz=(b[2]-a[2])/len,nx=uz,nz=-ux;
   const reach=Math.min(.75,len*.18),y=base+h-.265;
   for(const side of [0,1]){
    const corner=side===0?a:b,sign=side===0?1:-1;
    this.beam([corner[0]+ux*sign*(postWidth/2)+nx*.07,y-reach,corner[2]+uz*sign*(postWidth/2)+nz*.07],[corner[0]+ux*sign*reach+nx*.07,y,corner[2]+uz*sign*reach+nz*.07],.13,'wood','facade-brace',foundation,{start:[ux,0,uz],end:[0,1,0]});
   }
  }
 }
 const roof={id:id+'_roof',volume:id,x,z,width:w,depth:d,y:base+h,rise,ridgeRatio,shedDirection,eaves:cfg.eaves,kind:resolved,material:resolved==='thatch'?'thatch' as const:'roof' as const};this.plan.roofs.push(roof);this.plan.supports.push({component:roof.id,on:foundation});
 if(options.door!==false&&!options.open){const o=this.plan.openings.find(o=>o.wall===id+'_wall_0'&&o.kind==='door')!;if(base>.32)this.stairs([x+o.offset,0,z-d/2-1.9],[x+o.offset,base,z-d/2],1.55);}
 return v;
 }
 chimney(v:VolumeSpec){const x=v.x+v.width*.27,z=v.z+v.depth*.19,h=(this.plan.roofs.find(r=>r.volume===v.id)?.rise??v.width*(.2+this.context.config.roofPitch*.33))+.9;const shaft=this.piece('box',[x,v.bottom+v.height+h/2,z],[.65,h,.65],'stone','chimney','volume_'+this.plan.volumes.indexOf(v)+'_roof');this.piece('box',[x,v.bottom+v.height+h-.9,z],[.35,.03,.35],'dark','chimney-recess',shaft);for(let tier=0;tier<3;tier++){const heights=[.13,.18,.655],tops=[.08,-.05,-.23],height=heights[tier],yy=v.bottom+v.height+h+tops[tier]-height/2;for(const side of [-1,1]){this.piece('box',[x+side*.169,yy,z],[.012,height,.35],'stone','chimney-lining-'+tier,shaft);this.piece('box',[x,yy,z+side*.169],[.326,height,.012],'stone','chimney-lining-'+tier,shaft);}}this.piece('box',[x,v.bottom+v.height+h,z],[.82,.18,.82],'stone','chimney-cap','volume_'+this.plan.volumes.indexOf(v)+'_roof');}
 veranda(v:VolumeSpec){
  const reach=1.65,y=v.bottom+.12,z=v.z-v.depth/2-reach/2,w=v.width*.72;
  const baseHeight=y-.10;
  const base=this.piece('box',[v.x,baseHeight/2,z],[w-.12,baseHeight,reach-.06],'stone','veranda-base');
  const floor=this.piece('box',[v.x,y,z],[w,.2,reach],'wood','veranda',base);
  const pitch=.17,slope=Math.tan(pitch),cos=Math.cos(pitch),coverY=y+2.43;
  // Rafters follow the cover's underside; posts end on their lower face.
  const rafterY=(zz:number)=>coverY+slope*(zz-z)-(.065+.08)/cos-.01;
  const postZ=z-reach/2+.12,headerTop=rafterY(postZ)-.08/cos,headerBottom=headerTop-.24;
  this.piece('box',[v.x,headerTop-.12,postZ],[w-.06,.24,.18],'wood','veranda-header',floor);
  for(const side of [-1,1]){
   const x=v.x+side*(w/2-.12);
   this.beam([x,y,postZ],[x,headerBottom,postZ],.18,'wood','veranda-post',floor,
    {start:[0,1,0],end:[0,1,0]});
   const braceReach=Math.min(.5,w*.15);
   this.beam([x-side*.09,headerBottom-braceReach,postZ],[x-side*(.09+braceReach),headerBottom,postZ],.10,'wood','veranda-brace',floor,
    {start:[1,0,0],end:[0,1,0]});
   const startZ=postZ-.09,endZ=z+reach/2;
   this.beam([x,rafterY(startZ),startZ],[x,rafterY(endZ),endZ],.16,'wood','veranda-rafter',floor,
    {start:[0,0,1],end:[0,0,1]});
  }
  const coverMaterial=this.plan.roofs.find(r=>r.volume===v.id)?.material==='thatch'?'thatch':'roof';
  this.piece('box',[v.x,coverY,z],[w+.35,.13,reach+.2],coverMaterial,'porch-cover',floor,[-pitch,0,0]);
  // Borders touch the slab edges in the cover's own coordinate frame.
  const coverWidth=w+.35,coverDepth=reach+.2;
  const coverPoint=(xx:number,yy:number,zz:number):V3=>[v.x+xx,coverY+cos*yy+Math.sin(pitch)*zz,z-Math.sin(pitch)*yy+cos*zz];
  for(const side of [-1,1])this.piece('box',coverPoint(side*(coverWidth/2+.07),-.025,0),[.14,.18,coverDepth],'wood','veranda-fascia',floor,[-pitch,0,0]);
  this.piece('box',coverPoint(0,-.025,-coverDepth/2-.07),[coverWidth+.28,.18,.14],'wood','veranda-fascia',floor,[-pitch,0,0]);
  this.stairs([v.x,0,z-reach/2-1],[v.x,y,z-reach/2],1.6);
 } fence(x:number,z:number,w:number,d:number){const cs:V3[]=[[x-w/2,0,z-d/2],[x+w/2,0,z-d/2],[x+w/2,0,z+d/2],[x-w/2,0,z+d/2]];for(let s=0;s<4;s++){const a=cs[s],b=cs[(s+1)%4],n=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/2);for(let i=0;i<=n;i++){const px=a[0]+(b[0]-a[0])*i/n,pz=a[2]+(b[2]-a[2])*i/n;this.beam([px,0,pz],[px,1.1,pz],.13,'wood','fence-post');}for(const y of [.45,.85])this.beam([a[0],y,a[2]],[b[0],y,b[2]],.10,'wood','fence-rail');}}
 finish(){for(const roof of this.plan.roofs)if(roof.material!=='cloth')dressRoof(this,roof);return resolveConnections(this.plan);}
}
