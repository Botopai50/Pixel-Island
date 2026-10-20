import * as THREE from 'three';import type {WallSpec,OpeningSpec} from '../types';
export function buildWall(w:WallSpec,openings:OpeningSpec[]){const dx=w.end[0]-w.start[0],dz=w.end[2]-w.start[2],length=Math.hypot(dx,dz),half=length/2;
 const shape=new THREE.Shape();shape.moveTo(-half,0);shape.lineTo(-half,w.topLeft??w.height);
 if((w.damage??0)>.08){const count=Math.max(4,Math.ceil(length/.55)),damage=w.damage!;let phase=0;for(const char of w.id)phase+=char.charCodeAt(0)*.09;for(let i=1;i<count;i++){const t=i/count,x=-half+length*t;const base=w.gable?w.height+w.gable.peak*(t<=w.gable.ratio?t/w.gable.ratio:(1-t)/(1-w.gable.ratio)):(w.topLeft??w.height)*(1-t)+(w.topRight??w.height)*t;const near=openings.filter(o=>Math.abs(x-o.offset)<o.width/2+.2);const floor=near.reduce((h,o)=>Math.max(h,o.bottom+o.height+.1),.15);shape.lineTo(x,Math.max(floor,base-damage*(.3+.65*(Math.sin(i*1.8+phase)+1)/2)));}}
 else if(w.gable)shape.lineTo(-half+length*w.gable.ratio,w.height+w.gable.peak);
 shape.lineTo(half,w.topRight??w.height);shape.lineTo(half,0);
 const top=(path:THREE.Path,o:OpeningSpec)=>{const r=o.width/2,spring=o.bottom+o.height-r;path.lineTo(o.offset+r,o.arched?spring:o.bottom+o.height);if(o.arched)for(let i=1;i<=12;i++){const angle=i*Math.PI/12;path.lineTo(o.offset+Math.cos(angle)*r,spring+Math.sin(angle)*r);}else path.lineTo(o.offset-r,o.bottom+o.height);};
 const doors=openings.filter(o=>o.kind==='door'&&o.bottom===0).sort((a,b)=>b.offset-a.offset);for(const o of doors){shape.lineTo(o.offset+o.width/2,0);top(shape,o);shape.lineTo(o.offset-o.width/2,0);}shape.lineTo(-half,0);
 for(const o of openings.filter(o=>o.kind==='window'||o.bottom>0)){const hole=new THREE.Path(),x=o.offset-o.width/2,y=o.bottom;hole.moveTo(x,y);hole.lineTo(x+o.width,y);top(hole,o);hole.closePath();shape.holes.push(hole);}
 const g=new THREE.ExtrudeGeometry(shape,{depth:w.thickness,bevelEnabled:false,steps:1});g.translate(0,0,-w.thickness/2);g.rotateY(-Math.atan2(dz,dx));g.translate((w.start[0]+w.end[0])/2,w.bottom,(w.start[2]+w.end[2])/2);return g;
}
