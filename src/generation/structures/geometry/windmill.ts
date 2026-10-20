import * as THREE from 'three';
import {extrudePolygon,merge} from './common';
import type {PieceSpec} from '../types';

export function buildMillDoor(p:PieceSpec){
 const r=p.size[0]/2,h=p.size[1],points:[number,number][]=[[-r,0],[r,0],[r,h]];
 for(let i=1;i<=10;i++)points.push([Math.cos(i*Math.PI/10)*r,h+Math.sin(i*Math.PI/10)*r]);
 const g=extrudePolygon(points,p.size[2]);
 g.translate(p.position[0],p.position[1]-h/2,p.position[2]);return g;
}

export function buildMillPeak(p:PieceSpec){
 const g=new THREE.CylinderGeometry(p.size[2]/2,p.size[0]/2,p.size[1],8);
 g.rotateY(Math.PI/8);g.translate(...p.position);return g;
}

/** Straight cap strips terminate inside the sloping timber border. */
export function buildMillSeam(p:PieceSpec,cap:PieceSpec){
 const radius=cap.size[0]/2-.15,bottom=cap.position[1]-cap.size[1]/2,top=bottom+cap.size[1],slope=cap.size[1]/(cap.size[0]/2-.06),jointY=bottom+.055+.15*slope;
 const half=p.size[0]/2,sideRadius=radius-half*Math.tan(Math.PI/8),vertices:number[]=[],indices:number[]=[];
 // The chevron end follows both inner faces of the octagonal border.
 for(const [r,t] of [[sideRadius,-half],[radius,0],[sideRadius,half],[.06,half],[.06,0],[.06,-half]])vertices.push(r,r>.1?jointY:top+.055,t);
 for(let i=0;i<6;i++)vertices.push(vertices[i*3],vertices[i*3+1]-.11,vertices[i*3+2]);
 for(const face of [[0,1,4,5],[1,2,3,4],[6,11,10,7],[7,10,9,8],[0,6,7,1],[1,7,8,2],[2,8,9,3],[3,9,10,4],[4,10,11,5],[5,11,6,0]])indices.push(face[0],face[2],face[1],face[0],face[3],face[2]);
 const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));indexed.setIndex(indices);const g=indexed.toNonIndexed();indexed.dispose();g.computeVertexNormals();
 const angle=Math.atan2(p.position[0]-cap.position[0],p.position[2]-cap.position[2]);
 g.rotateY(angle-Math.PI/2);g.translate(cap.position[0],0,cap.position[2]);return g;
}

export function buildMillEave(_p:PieceSpec,cap:PieceSpec){
 const r=cap.size[0]/2+.03,inner=r-.18,y=cap.position[1]-cap.size[1]/2,slope=cap.size[1]/(cap.size[0]/2-.06);
 const vertices:number[]=[],indices:number[]=[];
 for(let side=0;side<8;side++){
  const a=Math.PI/8+side*Math.PI/4,b=a+Math.PI/4;
  const points=[[r,y+.055-.03*slope,a],[r,y+.055-.03*slope,b],[inner,y+.055+.15*slope,b],[inner,y+.055+.15*slope,a],[r,y-.18,a],[r,y-.18,b],[inner,y-.18,b],[inner,y-.18,a]];
  const base=vertices.length/3;for(const [rr,yy,angle] of points)vertices.push(cap.position[0]+Math.sin(angle)*rr,yy,cap.position[2]+Math.cos(angle)*rr);
  for(const face of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]])indices.push(...[face[0],face[1],face[2],face[0],face[2],face[3]].map(i=>base+i));
 }
 const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));indexed.setIndex(indices);const g=indexed.toNonIndexed();indexed.dispose();g.computeVertexNormals();return g;
}

/** Single closed slab: neighbouring facets share the same eave and peak. */
export function buildMillCap(p:PieceSpec){
 const indexed=new THREE.CylinderGeometry(p.size[2]/2,p.size[0]/2,p.size[1],8,1,false),g=indexed.toNonIndexed();indexed.dispose();
 g.rotateY(Math.PI/8);g.translate(...p.position);g.computeVertexNormals();return g;
}

/** Faceted taper with real openings and solid reveals on the exposed edges. */
export function buildMillBody(p:PieceSpec,level:number){
 const parts:THREE.BufferGeometry[]=[],height=p.size[1],bottom=p.position[1]-height/2;
 // A whole number of texture repeats closes the wrap at the back seam.
 const perimeter=Math.max(2.8,Math.round(12*(p.size[0]+.18/Math.cos(Math.PI/12))*Math.sin(Math.PI/12)/2.8)*2.8);
 for(let side=0;side<12;side++){
  const angle=side*Math.PI/6,rb=p.size[0]/2,rt=p.size[2]/2;
  const widthB=2*rb*Math.sin(Math.PI/12),widthT=2*rt*Math.sin(Math.PI/12);
  const hasDoor=level===0&&side===0,hasWindow=level===0?side===9:side===3||(level===1&&side===0);
  const doorRadius=Math.min(1.1,p.size[0]*.3)/2;
  const ys=hasDoor?[0,1.5,...Array.from({length:5},(_,i)=>1.5+doorRadius*Math.sin((i+1)*Math.PI/10)),height]:hasWindow?[0,height*(level===2?.70:level===1?.80:.60)-.38,height*(level===2?.70:level===1?.80:.60)+.38,height]:[0,height];
  const xs=hasDoor?[-.5,-Math.min(1.1,p.size[0]*.3)/widthB/2,Math.min(1.1,p.size[0]*.3)/widthB/2,.5]:hasWindow?[-.5,-.21/widthB,.21/widthB,.5]:[-.5,.5];
  const width=(y:number)=>widthB+(widthT-widthB)*y/height;
  for(let iy=0;iy<ys.length-1;iy++)for(let ix=0;ix<xs.length-1;ix++){
   if(ix===1&&((hasDoor&&iy<ys.length-2)||(hasWindow&&iy===1)))continue;
   const lo=ys[iy],hi=ys[iy+1];
   const edge=(index:number,y:number)=>{
    if(!hasDoor||index===0||index===3)return xs[index]*width(y);
    const row=ys.indexOf(y),half=row<=1?doorRadius:row<ys.length-1?doorRadius*Math.cos((row-1)*Math.PI/10):0;
    return (index===1?-half:half)/(1+.09/((p.size[0]/2+(p.size[2]-p.size[0])/2*y/height)*Math.cos(Math.PI/12)));
   };
   const g=extrudePolygon([[edge(ix,lo),lo],[edge(ix+1,lo),lo],[edge(ix+1,hi),hi],[edge(ix,hi),hi]],.18);
   const pos=g.getAttribute('position'),uv=new Float32Array(pos.count*2);
   for(let n=0;n<pos.count;n++){
    const y=pos.getY(n),radius=rb+(rt-rb)*y/height,offset=pos.getZ(n);
    uv[n*2]=(side+.5+pos.getX(n)/width(y))*perimeter/12;
    uv[n*2+1]=bottom+y;
    const x=pos.getX(n)*(1-offset/(radius*Math.cos(Math.PI/12))),z=offset-radius*Math.cos(Math.PI/12);
    pos.setXYZ(n,x*Math.cos(angle)-z*Math.sin(angle),bottom+y,x*Math.sin(angle)+z*Math.cos(angle));
   }
   g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.computeVertexNormals();parts.push(g);
  }
 }
 const body=merge(parts);body.userData.preservePaintUV=true;return body;
}


export function buildMillGallery(p:PieceSpec){
 const shape=new THREE.Shape(),hole=new THREE.Path(),r=p.size[0]/2,inner=p.size[2]/2;
 for(let i=0;i<=12;i++){const t=(i+.5)*Math.PI/6,x=Math.sin(t)*r,z=Math.cos(t)*r;i?shape.lineTo(x,z):shape.moveTo(x,z);}
 for(let i=12;i>=0;i--){const t=(i+.5)*Math.PI/6,x=Math.sin(t)*inner,z=Math.cos(t)*inner;i===12?hole.moveTo(x,z):hole.lineTo(x,z);}
 shape.holes.push(hole);const g=new THREE.ExtrudeGeometry(shape,{depth:p.size[1],bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);g.translate(0,p.position[1]+p.size[1]/2,0);return g;
}
