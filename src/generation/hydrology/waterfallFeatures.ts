import type { IslandHydrologyData } from './hydrology.ts';
import { clamp, lerp, smoothstep } from '../math/mathUtils.ts';

export interface WaterfallFeature {
 id:string; x:number; z:number; fx:number; fz:number;
 upper:number; width:number; radius:number; length:number;
 outlet:{x:number;z:number;along:number}[];
}
export function localWaterfall(f:WaterfallFeature,x:number,z:number){
 const dx=x-f.x,dz=z-f.z;return {x:dx*f.fz-dz*f.fx,z:dx*f.fx+dz*f.fz};
}
export function waterfallWorld(f:WaterfallFeature,x:number,z:number,y:number){
 return {x:f.x+x*f.fz+z*f.fx,y,z:f.z-x*f.fx+z*f.fz};
}
/** Compress terrain columns onto a near-vertical throat wall, independent of LOD. */
export function waterfallMeshPoint(f:WaterfallFeature,x:number,z:number){
 const q=localWaterfall(f,x,z);
 const throat=smoothstep(-10,-2,q.z)*(1-smoothstep(f.radius+1,f.radius+9,q.z));
 if(throat<.001)return {x,z};
 const center=waterfallCenter(f,q.z),half=waterfallWidth(f,q.z)*.5;
 const side=Math.sign(q.x-center),delta=Math.abs(q.x-center)-half,a=Math.abs(delta);
 if(a>=2.2)return {x,z};
 const compressed=a<=1.2?a*.05:.06+(a-1.2)*2.14;
 const offset=side*(lerp(delta,Math.sign(delta)*compressed,throat)-delta);
 return {x:x+offset*f.fz,z:z-offset*f.fx};
}
export function waterfallCenter(f:WaterfallFeature,z:number):number{
 if(z<=f.radius)return Math.sin(z*.055)*4.2*smoothstep(10,45,-z);
 const pts=f.outlet;
 for(let i=1;i<pts.length;i++)if(z<=pts[i].along){const a=pts[i-1],b=pts[i];return lerp(a.x,b.x,clamp((z-a.along)/Math.max(.01,b.along-a.along),0,1))*smoothstep(f.radius,f.radius+6,z);}
 return pts.at(-1)?.x??0;
}
export function waterfallWidth(f:WaterfallFeature,z:number):number{
 if(z<0){
  // A compact spring basin feeds a narrower river, fading to a closed shoreline upstream.
  const lake=1+1.7*Math.exp(-(((z+f.length-24)/17)**2));
  return f.width*lake*Math.sqrt(smoothstep(-f.length,-f.length+10,z));
 }
 return f.width*(1+.65*Math.sin(Math.PI*clamp((z-f.radius)/22,0,1)));
}
export function deriveWaterfalls(data:IslandHydrologyData,sample:(x:number,z:number)=>number):WaterfallFeature[]{
 const features:WaterfallFeature[]=[];
 for(const river of data.rivers){
  const points=river.points;
  const k=points.findIndex((p,i)=>i>8&&p.elevation<=.02&&points[i-8].elevation>.12);
  if(k<0)continue;
  const p=points[k],next=points[Math.min(k+8,points.length-1)];
  let fx=next.x-p.x,fz=next.z-p.z;const norm=Math.hypot(fx,fz);if(norm<1)continue;fx/=norm;fz/=norm;
  const dry=sample(p.x-fx*28,p.z-fz*28);
  if(dry<7||dry>110||features.some(f=>Math.hypot(f.x-p.x,f.z-p.z)<180))continue;
  const width=clamp(p.width*1.6,10,17),upper=clamp(dry*.58,9,22),radius=2.8+width*.04;
  const f:WaterfallFeature={id:river.id+'/cascade',x:p.x,z:p.z,fx,fz,upper,width,radius,length:80,outlet:[{x:0,z:radius,along:radius}]};
  // O rio de cima segue enquanto o terreno natural fica na altura da água (um vale encaixado); onde
  // o terreno cai muito abaixo dela pararia num dique alto, então ali o rio termina (com o lago).
  let reach=80;
  for(let L=100;L<=260;L+=20){
   const w=waterfallWorld(f,waterfallCenter(f,-L),-L,0);
   if(sample(w.x,w.z)<f.upper-6)break;
   reach=L;
  }
  f.length=reach;
  for(let i=k;i<points.length;i++){
   const q=localWaterfall(f,points[i].x,points[i].z);
   if(q.z>f.outlet.at(-1)!.along+.5)f.outlet.push({x:q.x,z:q.z,along:q.z});
   if(q.z>56)break;
  }
  if(f.outlet.at(-1)!.along<26)continue;
  features.push(f);if(features.length>=3)break;
 }
 return features;
}
/** Native heightfield alteration; identical in workers, collision and texture generation. */
/** A nascente aparece no pé de uma colina: um morro suave atrás (e em volta) do lago. */
export function sculptWaterfall(f:WaterfallFeature,x:number,z:number,original:number):number{
 const base=sculptWaterfallBase(f,x,z,original);
 const q=localWaterfall(f,x,z);
 if(q.z< -f.length-30||q.z> -f.length+30)return base;
 const lat=Math.abs(q.x-waterfallCenter(f,-f.length+24));
 const hill=7*Math.exp(-(((q.z+f.length+10)/11)**2))*Math.exp(-((lat/(waterfallWidth(f,-f.length+24)*.9+10))**2));
 return base+hill;
}
function sculptWaterfallBase(f:WaterfallFeature,x:number,z:number,original:number):number{
 const q=localWaterfall(f,x,z);
 if(q.z< -f.length-8||q.z>46)return original;
 const lateral=Math.abs(q.x-waterfallCenter(f,q.z)),half=waterfallWidth(f,q.z)*.5;
 if(lateral>half+16)return original;
 const top=f.upper*(1-smoothstep(-.6,f.radius-1.1,q.z));
 const level=q.z<0?f.upper:0;
 const channel=top-2.4;
 const lakeBed=Math.exp(-(((q.z+f.length-24)/14)**2))*(1-clamp(lateral/Math.max(1,half*.55),0,1)**2);
 const bed=(q.z< -f.length+10?f.upper-2.4*smoothstep(-f.length,-f.length+10,q.z):channel)-1.8*lakeBed;
 // Keep the cliff shoulders high alongside the entire curtain. Previously they
 // followed the lowered channel floor, leaving the upper sheet hanging in air.
 const throat=smoothstep(-10,-2,q.z)*(1-smoothstep(f.radius+1,f.radius+9,q.z));
 const bankSlope=smoothstep(half-1.4,half+2.5,lateral);
 const verticalWall=smoothstep(half-.055,half+.055,lateral);
 const shore=lerp(bankSlope,verticalWall,throat);
 const shoulder=f.upper*(1-smoothstep(f.radius+1,f.radius+9,q.z));
 const rim=Math.max(top+1.6,shoulder*throat+1.6);
 // A uniform throat profile prevents high native relief from protruding through
 // the sheet at arbitrary heights. Blend that relief back outside the contact.
 const contact=throat*(1-smoothstep(half+.3,half+5,lateral));
 const bank=lerp(Math.max(rim,original),rim,contact);
 const target=lerp(bed,bank,shore);
 const sideFade=1-smoothstep(half+3,half+16,lateral);
 const endFade=smoothstep(-f.length-8,-f.length+2,q.z)*(1-smoothstep(28,46,q.z));
 // The ocean stays the receiving pool and downstream river; never add a competing surface.
 return lerp(original,Math.max(level-3.5,target),sideFade*endFade);
}
export function waterfallSurface(f:WaterfallFeature,x:number,z:number):number|null{
 const q=localWaterfall(f,x,z);
 if(q.z< -f.length||q.z>0)return null;
 return Math.abs(q.x-waterfallCenter(f,q.z))<waterfallWidth(f,q.z)*.5?f.upper:null;
}
