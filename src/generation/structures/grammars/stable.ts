import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

/** An open timber barn: enclosed tack room, individual stalls and a front yard. */
export function stable(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.035),d=a.value(p.depth,.035),h=Math.max(2.8,a.value(p.height,.035)),base=.18;
 a.building(0,0,w,d,h,1,{base,open:true,door:false,roof:'gable',role:'stable'});const roof=a.plan.roofs[0];
 roof.rise=w*.36;roof.ridgeRatio=.5;roof.eaves=Math.max(.38,p.eaves);
 // Earth and straw belong under the stalls; remove the generic wooden floor and low framing.
 for(const piece of a.plan.pieces)if(piece.role==='floor'||piece.role==='foundation'||piece.role==='corner-post'||piece.role==='wall-frame')piece.removed=true;
 const front=-d/2,back=d/2,top=roof.y,split=-w*.24,bay=(w/2-split)/3,yard=front-Math.min(2.5,d*.36);
 const soil=a.piece('box',[0,.035,(yard+back)/2],[w+.55,.07,back-yard+.45],'earth','stable-earth-floor');
 const wood=(at:V3,size:V3,role:string,parent=soil)=>a.piece('box',at,size,'wood',role,parent);
 const beam=(from:V3,to:V3,width:number,role:string,parent=soil)=>a.beam(from,to,width,'wood',role,parent);
 const slope=roof.rise/(w/2),run=w/2+roof.eaves,angle=Math.atan(slope);
 const undersideY=roof.y+roof.rise/2-slope*roof.eaves/2-.05;
 for(const side of [-1,1])a.piece('box',[side*run/2,undersideY,0],[run*Math.sqrt(1+slope*slope),.055,d+2*roof.eaves-.12],'wood','stable-roof-underside',roof.id,[0,0,-side*angle]);
 const plate=(x:number,y:number,z:number,parent:string)=>{
  const id=a.piece('box',[x,y,z],[.28,.34,.055],'metal','stable-joint-plate',parent);
  for(const xx of [-.075,.075])for(const yy of [-.1,.1])a.piece('wheel',[x+xx,y+yy,z-.038],[.042,.042,.022],'metal','stable-rivet',id);
 };
 const post=(x:number,z:number,height:number,role='stable-post')=>{
  const foot=a.piece('box',[x,.20,z],[.55,.40,.55],'stone','stable-stone-footing');
  const id=beam([x,.4,z],[x,height,z],.32,role,foot);
  return id;
 };
 const xs=[-w/2,split,split+bay,split+bay*2,w/2];
 for(const z of [front,back]){
  for(const x of xs){const id=post(x,z,top);plate(x,top-.13,z-.19,id);
   for(const sign of [-1,1])if(x+sign*.8>=-w/2&&x+sign*.8<=w/2)beam([x,top-.90,z],[x+sign*.8,top-.15,z],.21,'stable-knee-brace',id);
  }
  const header=beam([-w/2,top-.12,z],[w/2,top-.12,z],.34,'stable-header');
  beam([-w/2,top-.04,z],[0,top+roof.rise-.10,z],.28,'stable-gable-rafter',header);
  beam([0,top+roof.rise-.10,z],[w/2,top-.04,z],.28,'stable-gable-rafter',header);
  const tieY=top+roof.rise*.36,reach=w*.32;
  beam([-reach,tieY,z],[reach,tieY,z],.28,'stable-truss-tie',header);
  beam([0,top-.1,z],[0,top+roof.rise-.1,z],.30,'stable-king-post',header);
  for(const side of [-1,1])beam([0,tieY,z],[side*w*.26,top+roof.rise*.46,z],.22,'stable-truss-diagonal',header);
  plate(0,tieY,z-.18,header);
 }
 for(const x of [-w/2,w/2]){
  const middle=post(x,0,top);
  beam([x,top-.12,front],[x,top-.12,back],.32,'stable-eave-header',middle);
  for(const side of [-1,1])beam([x,top-.9,0],[x,top-.18,side*.8],.22,'stable-side-brace',middle);
 }
 // Closed boards only around the storage room and rear wall, leaving the bays visible.
 const roomW=split+w/2,doorW=Math.min(1.25,roomW*.56),doorX=-w/2+roomW*.5;
 wood([-w/2,base+h/2,0],[.14,h,d],'stable-tack-side');
 wood([split,base+h/2,0],[.14,h,d],'stable-tack-partition');
 wood([0,base+h/2,back],[w,h,.14],'stable-rear-boards');
 const doorH=Math.min(2.25,h*.76),sideW=(roomW-doorW)/2;
 for(const sign of [-1,1])wood([doorX+sign*(doorW/2+sideW/2),base+h/2,front],[sideW,h,.14],'stable-tack-front');
 wood([doorX,base+doorH+(h-doorH)/2,front],[doorW,h-doorH,.14],'stable-door-lintel');
 const door=wood([doorX,base+doorH/2,front-.08],[doorW-.055,doorH-.04,.12],'stable-tack-door');
 for(const yy of [.40,doorH-.25]){a.piece('box',[doorX,base+yy,front-.16],[doorW*.83,.13,.045],'metal','stable-door-strap',door);}
 a.piece('wheel',[doorX+doorW*.3,1.04,front-.205],[.16,.16,.04],'metal','stable-door-ring',door);
 for(const x of [-w/2,split])beam([x,.5,front-.11],[x,top-.18,front-.11],.23,'stable-door-frame');
 // Masonry curb is confined to the walls, so the open gates have no raised sill.
 for(const x of [-w/2,split])a.piece('box',[x,.15,0],[.36,.30,d],'stone','stable-wall-plinth');
 a.piece('box',[0,.15,back],[w,.30,.36],'stone','stable-wall-plinth');
 const rail=(x1:number,z1:number,x2:number,z2:number,role='stable-fence-rail')=>{
  for(const yy of [.65,1.16])beam([x1,yy,z1],[x2,yy,z2],.17,role);
 };
 const gate=(left:number,right:number,z:number)=>{
  const y=.82,id=wood([(left+right)/2,y,z],[right-left,.12,.16],'stable-gate-top');
  for(const yy of [.42,1.2])wood([(left+right)/2,yy,z],[right-left,.16,.16],'stable-gate-rail',id);
  for(const x of [left+.1,right-.1])wood([x,.81,z],[.18,.95,.18],'stable-gate-stile',id);
  beam([left+.13,.47,z-.11],[right-.13,1.15,z-.11],.14,'stable-gate-diagonal',id);
  for(const yy of [.45,1.18])a.piece('box',[left+.15,yy,z-.13],[.32,.12,.05],'metal','stable-gate-hinge',id);
  a.piece('box',[right-.1,.94,z-.14],[.10,.24,.045],'metal','stable-gate-latch',id);
 };
 for(let i=0;i<3;i++){
  const l=split+i*bay,r=l+bay,x=(l+r)/2;
  gate(l+.19,r-.19,front);
  for(const xx of [l,r])rail(xx,front+.17,xx,back-.17,'stable-stall-rail');
  const trough=wood([x,.43,back-.48],[bay*.62,.12,.52],'stable-feed-trough-bottom');
  for(const zz of [back-.76,back-.20])wood([x,.62,zz],[bay*.62,.40,.08],'stable-feed-trough-side',trough);
  for(const xx of [x-bay*.31,x+bay*.31])wood([xx,.62,back-.48],[.08,.40,.52],'stable-feed-trough-end',trough);
  a.piece('box',[x,.56,back-.48],[bay*.54,.04,.43],'thatch','stable-trough-hay',trough);
 }
 // Front paddock, with its own gate and clear path from the storage-room door.
 for(const x of [split,w/2]){post(x,yard,1.5,'stable-fence-post');post(x,(yard+front)/2,1.5,'stable-fence-post');rail(x,yard,x,front);}
 const gateL=split+bay,gateR=gateL+Math.min(1.65,bay*.84);
 for(const x of [gateL,gateR])post(x,yard,1.5,'stable-fence-post');
 rail(split,yard,gateL,yard);rail(gateR,yard,w/2,yard);gate(gateL+.17,gateR-.17,yard);
 // One continuous bedding layer crosses the stall rails and gates without coplanar overlaps.
 // Its ragged fringe extends beyond the yard's outer rails instead of stopping at each bay.
 const hayLeft=split-.12,hayRight=w/2+.16,hayFront=yard-.16,hayBack=back-.12;
 a.piece('box',[(hayLeft+hayRight)/2,.085,(hayFront+hayBack)/2],[hayRight-hayLeft,.04,hayBack-hayFront],'thatch','stable-straw-bed',soil);
 // Supplies at the tack room.
 const bx=doorX-roomW*.34,bz=front-.65;
 const barrel=a.piece('column',[bx,.46,bz],[.66,.92,.66],'wood','barn-barrel');
 for(const yy of [.18,.72])a.piece('column',[bx,yy,bz],[.67,.06,.67],'metal','barn-barrel-hoop',barrel);
 a.piece('column',[bx,.94,bz],[.55,.04,.55],'wood','barn-barrel-lid',barrel);
 for(const offset of [0,.8])a.piece('box',[doorX+roomW*.35,.34,front-.55-offset],[.65,.68,.72],'thatch','stable-hay-bale');
 a.depend(roof.id,a.plan.pieces.filter(piece=>piece.role==='stable-header').map(piece=>piece.id),1);
 return a.finish();
}
