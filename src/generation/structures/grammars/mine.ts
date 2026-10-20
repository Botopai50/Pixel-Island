import {Architect} from '../blueprint';
import type {GrammarContext,V3} from '../types';

export function mine(c:GrammarContext){
 const a=new Architect(c),p=c.config,w=a.value(p.width,.035),d=a.value(p.depth,.035);
 const span=Math.max(2.1,Math.min(3.6,w*.36)),r=span/2,spring=2.05,rise=1.15;
 const front=-d*.22,back=front+d*.36,top=Math.max(spring+rise+.8,p.height*.88);
 const rock=(at:V3,size:V3,role='mine-native-rock')=>a.piece('box',at,size,'stone',role);
 // Interlocking cliff strata enclose a blind tunnel.
 rock([0,top/2,front+d*.32],[w,top,d*.64],'mine-rock-shell');
 // Irregular dressed stones around the mouth sit in front of the natural outcrops.
 for(const side of [-1,1])for(let row=0;row<5;row++){
  const width=.72+a.rnd()*.28;
  rock([side*(r+.33+width/2),.24+row*.45,front+.35],[width,.46,.78],'mine-portal-rock');
 }
 for(let i=0;i<9;i++){
  const angle=Math.PI*i/8;
  rock([(r+.43)*Math.cos(angle),spring+(rise+.43)*Math.sin(angle),front+.32],[.76,.59,.86],'mine-portal-rock');
 }
 if(p.vegetation>0)for(const side of [-1,1])for(let i=0;i<4;i++){
  a.piece('box',[side*(r+.65+i*.35),top+.9,front+.5+i*d*.09],[.4,.5,.4],'wood','mine-fern');
 }
 // A shallow elliptical arch, with layered timber following the grain of the curve.
 a.piece('arch',[0,spring,front-.18],[span,rise,.40],'wood','mine-mouth');
 for(const side of [-1,1]){
  rock([side*(r+.18),.28,front-.17],[.72,.56,.75],'mine-footing');
  const post=a.piece('box',[side*(r+.18),1.35,front-.18],[.44,2.15,.46],'wood','mine-post');
  a.piece('box',[side*(r+.18),spring,front-.27],[.68,.47,.56],'wood','mine-joint',post);
  for(const y of [.67,1.94])a.piece('box',[side*(r+.18),y,front-.425],[.47,.12,.045],'metal','mine-post-strap',post);
  a.piece('box',[side*(r+.18),spring,front-.57],[.43,.37,.045],'metal','mine-joint-plate',post);
  for(const dx of [-.14,.14])for(const dy of [-.11,.11])a.piece('box',[side*(r+.18)+dx,spring+dy,front-.605],[.045,.045,.035],'metal','mine-rivet',post);
  a.piece('wheel',[side*(r+.18),spring-.19,front-.64],[.14,.14,.035],'metal','mine-hook');
  const lampY=1.20,lampZ=front-.73;
  a.beam([side*(r+.18),spring-.25,lampZ],[side*(r+.18),lampY+.31,lampZ],.035,'metal','mine-lamp-chain');
  a.piece('box',[side*(r+.18),lampY,lampZ],[.23,.34,.23],'dark','mine-lamp-glass');
  for(const y of [lampY-.20,lampY+.20])a.piece('box',[side*(r+.18),y,lampZ],[.34,.065,.34],'metal','mine-lamp-frame');
  for(const dx of [-.13,.13])for(const dz of [-.13,.13])a.beam([side*(r+.18)+dx,lampY-.18,lampZ+dz],[side*(r+.18)+dx,lampY+.18,lampZ+dz],.035,'metal','mine-lamp-frame');
 }
 for(const angle of [Math.PI*.28,Math.PI*.72]){
  const x=(r+.16)*Math.cos(angle),y=spring+(rise+.16)*Math.sin(angle);
  a.piece('box',[x,y,front-.405],[.16,.48,.045],'metal','mine-arch-strap','ground',[0,0,angle-Math.PI/2]);
 }
 // Repeated frames recede into the dark throat; braces stay clear of the track gauge.
 for(let i=0;i<3;i++){
  const z=front+.75+i*(back-front-.95)/3;
  for(const side of [-1,1]){
   a.beam([side*(r-.20),.08,z],[side*(r-.20),2.23,z],.23,'wood','tunnel-support');
   a.beam([side*(r-.20),1.63,z],[side*(r-.72),2.23,z],.16,'wood','mine-tunnel-brace');
  }
  a.beam([-r+.20,2.23,z],[r-.20,2.23,z],.25,'wood','mine-tunnel-header');
 }
 a.piece('box',[0,spring,(front+back)/2],[span+.18,rise+.10,back-front],'stone','mine-tunnel-lining');
 a.piece('box',[0,1.72,back-.12],[span+.3,3.44,.09],'dark','mine-tunnel-darkness');
 a.piece('box',[0,.025,(front+back)/2],[span+.3,.05,back-front],'earth','mine-tunnel-floor');
 const start=front-2.9,end=back-.22,gauge=Math.min(1.22,span*.53);
 a.piece('box',[0,.035,(start+front)/2],[gauge+1.1,.07,front-start+.18],'earth','mine-track-bed');
 const ties=Math.ceil((end-start)/.43);
 for(let i=0;i<=ties;i++)a.piece('box',[0,.10,start+(end-start)*i/ties],[gauge+.52,.13,.18],'wood','mine-sleeper');
 for(const side of [-1,1]){
  a.piece('box',[side*gauge/2,.20,(start+end)/2],[.09,.13,end-start],'metal','rail');
  a.piece('box',[side*gauge/2,.265,(start+end)/2],[.13,.035,end-start],'metal','mine-rail-head');
 }
 a.plan.accesses.push({id:'mine-path',from:[0,0,start-.4],to:[0,0,end],width:gauge+.65,role:'tunnel'});
 // Retaining timbers frame the shoulders, with filled ore boxes outside the entrance.
 for(const side of [-1,1]){
  for(let i=0;i<3;i++){
   const x=side*(r+.85+i*.70),z=front-.55-i*.48;
   a.piece('box',[x,.90,z],[.22,1.8,.25],'wood','mine-fence-post');
   a.piece('box',[x,1.62,z],[.26,.13,.28],'metal','mine-fence-band');
   if(i<2)a.beam([x,1.34,z],[x+side*.7,1.16,z-.48],.18,'wood','mine-retaining-rail');
  }
  const x=side*(r+.90),z=front-1.14;
  a.piece('box',[x,.08,z],[.72,.16,.70],'wood','mine-ore-box-base');
  for(const dx of [-.32,.32])a.piece('box',[x+dx,.38,z],[.09,.60,.70],'wood','mine-ore-box-side');
  for(const dz of [-.31,.31])a.piece('box',[x,.38,z+dz],[.56,.60,.09],'wood','mine-ore-box-side');
  for(const dx of [-.31,.31])for(const dz of [-.31,.31])a.piece('box',[x+dx,.64,z+dz],[.14,.11,.14],'metal','mine-box-iron');
  for(let i=0;i<5;i++)rock([x+(a.rnd()-.5)*.40,.51+a.rnd()*.12,z+(a.rnd()-.5)*.38],[.22+a.rnd()*.1,.22,.24],'mine-ore');
 }
 for(let i=0;i<14;i++){
  const side=i%2?1:-1,x=side*(r+.75+a.rnd()*(w/2-r)),z=front-1.9+a.rnd()*d*.75,size=.22+a.rnd()*.64;
  rock([x,size*.35,z],[size,size*.7,size*.8],'mine-rubble');
 }
 // Small embedded clusters soften the side and rear outline, rather than a rim.
 const edgeCluster=(x:number,z:number,side:number)=>{
  const size=.66+a.rnd()*.34,height=size*(.48+a.rnd()*.20);
  rock([x,height*.45,z],[size,height,size*(.85+a.rnd()*.25)],'mine-edge-stone');
  const chip=size*(.40+a.rnd()*.20),chipHeight=chip*.63;
  rock([x+side*size*.40,chipHeight*.44,z+(a.rnd()-.5)*size],[chip,chipHeight,chip*.90],'mine-edge-stone');
 };
 for(const side of [-1,1])for(let i=0;i<4;i++){
  const t=.12+i*.25+(a.rnd()-.5)*.08;
  edgeCluster(side*w*(.53+a.rnd()*.025),front+d*.64*t,side);
 }
 for(let i=0;i<5;i++){
  const x=(-.40+i*.20+(a.rnd()-.5)*.055)*w;
  edgeCluster(x,front+d*(.65+a.rnd()*.018),x<0?-1:1);
 }
 return a.finish();
}
