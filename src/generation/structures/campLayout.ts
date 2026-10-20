import type {GrammarContext} from './types';

export interface CampRect {left:number;right:number;front:number;back:number;}
export interface CampPitch {x:number;z:number;width:number;depth:number;height:number;yaw:number;bounds:CampRect;}
export function campTentBounds(x:number,z:number,width:number,depth:number,yaw=0):CampRect{
 const points=[-width/2-.65,width/2+.65].flatMap(xx=>[-depth/2-.90,depth/2+.40].map(zz=>({x:x+Math.cos(yaw)*xx+Math.sin(yaw)*zz,z:z-Math.sin(yaw)*xx+Math.cos(yaw)*zz})));
 return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),front:Math.min(...points.map(p=>p.z)),back:Math.max(...points.map(p=>p.z))};
}
export const campRectsClear=(a:CampRect,b:CampRect,gap=.35)=>a.right+gap<=b.left||b.right+gap<=a.left||a.back+gap<=b.front||b.back+gap<=a.front;

export function campLayout(c:GrammarContext){
 const rnd=c.streams.streamFor('camp-layout','pitches'),p=c.config;
 const count=p.campTentCount||1+Math.floor(c.streams.streamFor('camp-layout','count')()*4);
 const shuffle=<T>(list:T[])=>{for(let i=list.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;};
 // The front-centre slot remains open as the approach to the communal fire.
 const anchors=shuffle([[-.33,-.33],[.33,-.33],[-.33,.33],[.33,.33],[0,.48],[-.48,0],[.48,0]]);
 const pitches:CampPitch[]=anchors.map(([sx,sz])=>{
  const x=sx*p.width+(rnd()-.5)*.32*p.asymmetry,z=sz*p.depth+(rnd()-.5)*.32*p.asymmetry;
  const width=Math.min(4.8,p.width*.23,p.depth*.23)*(.88+rnd()*.22),depth=Math.min(5,p.depth*.25,p.width*.25)*(.88+rnd()*.22);
  const height=Math.min(width*.98,p.height*(.74+rnd()*.17));
  const yaw=sx===0?(sz<0?Math.PI:0):sz===0?(sx<0?-Math.PI/2:Math.PI/2):(rnd()<.5?(sz<0?Math.PI:0):(sx<0?-Math.PI/2:Math.PI/2));
  return {x,z,width,depth,height,yaw,bounds:campTentBounds(x,z,width,depth,yaw)};
 });
 const search=(index:number,selected:CampPitch[]):CampPitch[]|undefined=>{
  if(selected.length===count)return selected;
  for(let i=index;i<pitches.length;i++){
   const next=pitches[i],b=next.bounds,dx=Math.max(b.left,0,-b.right),dz=Math.max(b.front,0,-b.back);
   if(Math.hypot(dx,dz)<1.5||selected.some(t=>!campRectsClear(t.bounds,b)))continue;
   const result=search(i+1,[...selected,next]);if(result)return result;
  }
 };
 const selected=search(0,[]);
 if(!selected)throw Error('Camp pitches do not fit the configured footprint');
 // Pull the pitches into a coherent camp while keeping all reserved space.
 for(const pitch of selected)for(let step=0;step<100;step++){
  const x=pitch.x*.985,z=pitch.z*.985,b=campTentBounds(x,z,pitch.width,pitch.depth,pitch.yaw);
  const dx=Math.max(b.left,0,-b.right),dz=Math.max(b.front,0,-b.back);
  if(Math.hypot(dx,dz)<1.6||selected.some(other=>other!==pitch&&!campRectsClear(other.bounds,b)))break;
  pitch.x=x;pitch.z=z;pitch.bounds=b;
 }
 return selected;
}

/** Allocate the complete prop footprint, rather than checking its centre. */
export function campPropPlacement(c:GrammarContext,pitches:CampPitch[]){
 const rnd=c.streams.streamFor('camp-props','placement'),used:CampRect[]=pitches.map(p=>p.bounds);
 // Keep the approach from the front of the clearing unobstructed.
 used.push({left:-.65,right:.65,front:-c.config.depth*.62,back:-1.5});
 return (width:number,depth:number,near?:number|{x:number;z:number})=>{
  const target=typeof near==='object'?near:{x:0,z:0};
  let best:{x:number;z:number;bounds:CampRect;score:number}|undefined;
  for(let trial=0;trial<240;trial++){
   const span=typeof near==='number'?near*2:3.2;
   const expansion=trial<120?0:(trial-120)*.045;
   const x=target.x+(rnd()-.5)*(span+expansion),z=target.z+(rnd()-.5)*(span+expansion);
   const bounds={left:x-width/2,right:x+width/2,front:z-depth/2,back:z+depth/2};
   // The hearth is round: diagonal seating can approach it safely.
   if(Math.hypot(Math.max(bounds.left,0,-bounds.right),Math.max(bounds.front,0,-bounds.back))<1.65)continue;
   if(used.some(b=>!campRectsClear(b,bounds)))continue;
   const score=Math.hypot(x-target.x,z-target.z);
   if(!best||score<best.score)best={x,z,bounds,score};
  }
  if(best){used.push(best.bounds);return {x:best.x,z:best.z};}
  // A free spot beyond every reserved footprint is always available.
  const right=Math.max(...used.map(b=>b.right)),x=right+.6+width/2,z=(rnd()-.5)*c.config.depth;
  used.push({left:x-width/2,right:x+width/2,front:z-depth/2,back:z+depth/2});return {x,z};
 };
}
