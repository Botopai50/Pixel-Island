import {stoneWell} from './well';
import {stoneFountain} from './fountain';
import {woodenCart} from './cart';
import {Architect} from '../blueprint';import type {GrammarContext,V3,SurfaceMaterial} from '../types';

export function moreScenery(c:GrammarContext){if(c.config.type==='woodenCart')return woodenCart(c);if(c.config.type==='stoneWell')return stoneWell(c);if(c.config.type==='stoneFountain')return stoneFountain(c);
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth,h=p.height;
 const box=(at:V3,size:V3,mat:SurfaceMaterial,role:string,support='ground',rotation?:V3)=>a.piece('box',at,size,mat,role,support,rotation);
 const beam=(from:V3,to:V3,size:number,mat:SurfaceMaterial,role:string,support='ground')=>a.beam(from,to,size,mat,role,support);
 if(p.type==='woodFence'){
  const u=h/1.3,count=Math.max(1,Math.round(w/(2.4*u))),t=Math.min(.28*u,w*.13),depth=Math.max(t*.85,Math.min(d,.38*u)),posts:string[]=[];
  for(let i=0;i<=count;i++){
   const x=-w/2+i*w/count,id=box([x,h/2,0],[t,h,depth],'wood','scenery-fence-post');posts.push(id);
   for(const level of [.26,.75])for(const side of [-1,1]){
    box([x,h*level,side*(depth/2+.012*u)],[t*.30,.08*u,.035*u],'metal','scenery-fence-rivet',id);
   }
   // A few bound posts break up the rhythm without covering every joint.
   if(i>0&&(i%2===1||i===count))for(let turn=0;turn<2;turn++)a.piece('column',[x,h*.59+turn*.035*u,0],[t+.018*u,.030*u,depth+.018*u],'cloth','scenery-fence-rope',id);
  }
  for(let i=0;i<count;i++){
   const left=-w/2+i*w/count,right=-w/2+(i+1)*w/count;
   for(const level of [.26,.75]){
    const start=i===0?left-t/2-.14*u:left,end=i===count-1?right+t/2+.14*u:right;
    const rail=box([(start+end)/2,h*level,.018*u],[end-start,.18*u,depth*.58],'wood','scenery-fence-rail',posts[i]);
    a.depend(rail,[posts[i],posts[i+1]],2);
    for(const end of [left+t*.65,right-t*.65]){
     box([end,h*level,.018*u],[.075*u,.208*u,depth*.58+.028*u],'metal','scenery-fence-joint-strap',rail);
     for(const side of [-1,1])box([end,h*level,.018*u+side*(depth*.29+.025*u)],[.052*u,.052*u,.022*u],'metal','scenery-fence-joint-nail',rail);
    }
   }
   for(const side of [-1,1]){
    const from:V3=[side===-1?left+t*.60:right-t*.60,h*.26+.09*u,.018*u];
    const to:V3=[side===-1?left+(right-left)*.29:right-(right-left)*.29,h*.75-.09*u,.018*u];
    a.beam(from,to,.13*u,'wood','scenery-fence-brace',posts[side===-1?i:i+1],{start:[0,1,0],end:[0,1,0]});
   }
  }
 }else if(p.type==='woodGate'){
  const u=h/1.45,t=Math.min(.34*u,w*.16),depth=Math.max(.26*u,Math.min(d,.42*u));
  const left=box([-w/2,h/2,0],[t,h,depth],'wood','scenery-fence-post'),right=box([w/2,h/2,0],[t,h,depth],'wood','scenery-fence-post');
  const span=w-t-.065*u,railH=.16*u,leafDepth=.20*u,low=h*.19,high=h*.83,middle=h*.51;
  const leaf=box([0,low,0],[span,railH,leafDepth],'wood','scenery-fence-rail',right);
  box([0,high,0],[span,railH,leafDepth],'wood','scenery-fence-rail',leaf);
  box([0,middle,0],[span,.115*u,leafDepth],'wood','scenery-fence-rail',leaf);
  const stileX=span/2-.075*u;
  for(const side of [-1,1])box([side*stileX,(low+high)/2,0],[.15*u,high-low+.29*u,.24*u],'wood','scenery-gate-stile',leaf);
  a.beam([-stileX+.075*u,low+railH/2,.018*u],[stileX-.075*u,high-railH/2,.018*u],.145*u,'wood','scenery-gate-diagonal',leaf,{start:[0,1,0],end:[0,1,0]});
  // Two broad hinges connect the right stile to the fixed right post.
  for(const level of [low,high]){
   box([stileX-.12*u,level,-.142*u],[.36*u,.14*u,.035*u],'metal','scenery-gate-hinge',leaf);
   box([w/2-t*.13,level,-depth/2-.020*u],[t*.62,.15*u,.035*u],'metal','scenery-gate-hinge-base',right);
   a.piece('column',[(stileX+w/2-t/2)/2,level,-.16*u],[.070*u,.21*u,.070*u],'metal','scenery-gate-hinge-pin',right);
   for(const offset of [-.12,.12])box([stileX-.12*u+offset*u,level,-.17*u],[.045*u,.045*u,.026*u],'metal','scenery-gate-hinge-bolt',leaf);
   box([w/2-t*.13,level,-depth/2-.05*u],[.045*u,.045*u,.024*u],'metal','scenery-gate-post-bolt',right);
   box([-stileX,level,-.14*u],[.05*u,.05*u,.025*u],'metal','scenery-gate-stile-bolt',leaf);
  }
  // A sliding latch and a hanging pull ring sit on the left side.
  const latchY=h*.68,front=-depth/2-.020*u;
  for(const [x,support] of [[-w/2,left],[-stileX,leaf]] as const){
   const spacer=depth/2-.12*u;
   if(support===leaf&&spacer>.002*u)box([x,latchY,-.12*u-spacer/2],[.11*u,.15*u,spacer+.004*u],'metal','scenery-gate-latch-spacer',leaf);
   box([x,latchY,front],[.13*u,.19*u,.04*u],'metal','scenery-gate-latch-plate',support);
   for(const side of [-1,1])box([x,latchY+side*.062*u,front-.027*u],[.035*u,.035*u,.022*u],'metal','scenery-gate-latch-bolt',support);
  }
  box([(-w/2-stileX)/2,latchY,front-.045*u],[w/2-stileX+.20*u,.055*u,.060*u],'metal','scenery-gate-latch',leaf);
  box([-w/2+.045*u,latchY-.13*u,front-.015*u],[.07*u,.15*u,.04*u],'metal','scenery-gate-ring-plate',left);
  a.piece('column',[-w/2+.045*u,latchY-.20*u,front-.049*u],[.10*u,.17*u,.019*u],'metal','scenery-gate-pull-ring',left);
 }else if(p.type==='toolRack'){
  const rack=box([0,h*.66,0],[w,.12,.15],'wood','scenery-tool-rack');
  for(const [i,kind] of (['fork','shovel','hammer'] as const).entries())a.piece('cloth',[(i-1)*w*.31,h*.52,0],[h*.38,h*.94,.001],'cloth','scenery-tool-sprite-'+kind,rack);
 }else if(p.type==='stoneWell'||p.type==='stoneFountain'){
  const radius=Math.min(w,d)*.42,wallH=p.type==='stoneWell'?h*.36:h*.20;
  const wall=a.piece('column',[0,wallH/2,0],[radius*2,wallH,radius*2],'stone','scenery-basin');
  a.piece('column',[0,.035,0],[radius*1.70,.02,radius*1.70],p.type==='stoneWell'?'dark':'water','scenery-basin-water',wall);
  if(p.type==='stoneWell'){
   for(const side of [-1,1])beam([side*radius,wallH,0],[side*radius,h-.12,0],.14,'wood','scenery-well-post',wall);
   beam([-radius,h-.12,0],[radius,h-.12,0],.16,'wood','scenery-well-crossbar',wall);
   beam([0,h-.12,0],[0,wallH+.20,0],.025,'wood','scenery-well-rope',wall);
   a.piece('column',[0,wallH+.13,0],[.28,.26,.28],'wood','barn-barrel',wall);
   for(const side of [-1,1])box([side*radius*.55,h+radius*.18,0],[radius*1.24,.10,radius*1.7],'wood','scenery-well-cover',wall,[0,0,side*.30]);
  }else{
   a.piece('column',[0,h*.38,0],[radius*.32,h*.70,radius*.32],'stone','scenery-fountain-pillar',wall);
   a.piece('column',[0,h*.78,0],[radius*1.02,h*.15,radius*1.02],'stone','scenery-basin',wall);
   a.piece('column',[0,h*.80,0],[radius*.82,.02,radius*.82],'water','scenery-basin-water',wall);
   a.piece('column',[0,h*.93,0],[radius*.16,h*.14,radius*.16],'stone','scenery-fountain-finial',wall);
  }
 }else if(p.type==='mossPatch'){
  a.piece('cloth',[0,.012,0],[w,.01,d],'cloth','scenery-moss');
 }else if(p.type==='ivyPatch'){
  for(let i=0;i<4;i++)a.piece('cloth',[(i/3-.5)*w,h,0],[w*.26,h*(.55+.10*i),.2],'cloth','scenery-ivy','ground',[0,(i-1.5)*.08,0]);
 }else if(p.type==='rootPatch'){
  for(let i=0;i<5;i++){
   const angle=i*2.399,end:V3=[Math.cos(angle)*w*.48,.025,Math.sin(angle)*d*.48];
   const from:V3=[0,h*.72,0];beam(from,[end[0]*.45,h*.20,end[2]*.45],h*.16,'wood','scenery-root');beam([end[0]*.45,h*.20,end[2]*.45],end,h*.10,'wood','scenery-root');
  }
 }
 return a.finish();
}
