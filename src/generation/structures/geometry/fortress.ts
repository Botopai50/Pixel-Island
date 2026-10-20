import * as THREE from 'three';
import {extrudePolygon,merge} from './common';
import type {PieceSpec} from '../types';

export function buildFortressBanner(p:PieceSpec){
 const g=new THREE.PlaneGeometry(p.size[0],p.size[1]);if(p.rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));g.translate(...p.position);g.userData.preservePaintUV=true;return g;
}

export function createCastleBannerTexture(flag=false){
 const width=flag?32:20,height=flag?16:40,data=new Uint8Array(width*height*4);
 const fleur=['000001100000','000011110000','000011110000','011011110110','111111111111','110111111011','010011110010','000011110000','001111111100','000011110000','000110011000','001100001100'];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const visible=flag?(x<25||Math.abs(y-7.5)>(x-24)*.72):(y<30||Math.abs(x-9.5)<(height-y)*.94);
  const emblemX=flag?x-6:x-4,emblemY=flag?y-2:y-10;
  const emblem=emblemX>=0&&emblemX<12&&emblemY>=0&&emblemY<12&&fleur[emblemY][emblemX]==='1';
  const edge=flag?(y===1||y===height-2):(x===1||x===width-2)&&y<30;
  const color=emblem||edge?[213,162,60]:x%5===0?[47,86,124]:[36,70,105];
  data.set([...color,visible?255:0],((height-y-1)*width+x)*4);
 }
 const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}

export function createFortressBannerTexture(){
 const width=16,height=32,data=new Uint8Array(width*height*4);
 const crest=['0000110000','0011111100','0110110110','1100110011','1001111001','0011111100','0001111000','0010110100','0110110110','0100110010','0001111000','0000110000'];
 for(let row=0;row<height;row++)for(let col=0;col<width;col++){
  const visible=row<24||Math.abs(col-7.5)<=31.5-row;
  const emblem=row>=6&&row<18&&col>=3&&col<13&&crest[row-6][col-3]==='1';
  const border=(col===1||col===14)&&row>=1&&row<24;
  const red=col<2||col>13?[133,37,47]:col%4===0?[171,54,64]:[158,43,54];
  data.set([...(emblem||border?[238,222,181]:red),visible?255:0],((height-1-row)*width+col)*4);
 }
 const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
 texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;
 texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}

export function buildFortressBarrel(p:PieceSpec){
 const r=p.size[0]/2,h=p.size[1];
 const points=[new THREE.Vector2(r*.80,-h/2),new THREE.Vector2(r*.97,-h*.32),new THREE.Vector2(r,h*.05),new THREE.Vector2(r*.97,h*.32),new THREE.Vector2(r*.80,h/2)];
 const g=new THREE.LatheGeometry(points,12);g.translate(...p.position);return g;
}

export function buildFortressGateWall(p:PieceSpec){
 const r=p.size[0]/2,spring=Math.min(2.05,(p.size[1]-.7)*.57),points:[number,number][]=[[-r,p.size[1]],[r,p.size[1]],[r,spring]];
 for(let i=1;i<=10;i++)points.push([Math.cos(i*Math.PI/10)*r,spring+Math.sin(i*Math.PI/10)*r]);
 const g=extrudePolygon(points,p.size[2]);g.translate(...p.position);return g;
}
export function buildFortressParapet(p:PieceSpec){
 const r=p.size[0]/2,shape=new THREE.Shape(),hole=new THREE.Path();
 for(let i=0;i<=12;i++){const angle=i*Math.PI/6,x=Math.sin(angle)*r,z=Math.cos(angle)*r;i?shape.lineTo(x,z):shape.moveTo(x,z);}
 for(let i=12;i>=0;i--){const angle=i*Math.PI/6,x=Math.sin(angle)*(r-(p.role==='fortress-tower-timber-ring'?.44:.34)),z=Math.cos(angle)*(r-(p.role==='fortress-tower-timber-ring'?.44:.34));i===12?hole.moveTo(x,z):hole.lineTo(x,z);}
 shape.holes.push(hole);const g=new THREE.ExtrudeGeometry(shape,{depth:p.size[1],bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);g.translate(p.position[0],p.position[1]+p.size[1]/2,p.position[2]);return g;
}
export function buildFortressTower(p:PieceSpec,walkHeight:number){
 const parts:THREE.BufferGeometry[]=[],r=p.size[0]/2,h=p.size[1],bottom=p.position[1]-h/2,width=2*r*Math.sin(Math.PI/12),apothem=r*Math.cos(Math.PI/12);
 const repeats=Math.max(1,Math.round(12*width/2.8)),perimeter=repeats*2.8;
 for(let side=0;side<12;side++){
  const half=width/2,top=Math.min(h-.22,walkHeight+1.65);
  let cutLeft=half,cutRight=-half;
  for(const doorSide of [p.position[0]<0?3:9,p.position[2]<0?6:0]){
   const delta=((side-doorSide+18)%12-6)*Math.PI/6;
   if(Math.abs(delta)>Math.PI/6+.001)continue;
   const shift=apothem*Math.sin(delta),cos=Math.cos(delta);
   const left=Math.max(-half,(-.58-shift)/cos),right=Math.min(half,(.58-shift)/cos);
   if(right>left){cutLeft=left;cutRight=right;}
  }
  const walkDoor=cutRight>cutLeft,shapes:THREE.Shape[]=[];
  const polygon=(points:number[][])=>{const s=new THREE.Shape();points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y));s.closePath();shapes.push(s);return s;};
  let shape:THREE.Shape;
  if(walkDoor&&cutLeft<=-half+.0001&&cutRight>=half-.0001){
   shape=polygon([[-half,0],[half,0],[half,walkHeight],[-half,walkHeight]]);
   polygon([[-half,top],[half,top],[half,h],[-half,h]]);
  }else if(walkDoor&&cutLeft<=-half+.0001){
   shape=polygon([[-half,0],[half,0],[half,h],[-half,h],[-half,top],[cutRight,top],[cutRight,walkHeight],[-half,walkHeight]]);
  }else if(walkDoor&&cutRight>=half-.0001){
   shape=polygon([[-half,0],[half,0],[half,walkHeight],[cutLeft,walkHeight],[cutLeft,top],[half,top],[half,h],[-half,h]]);
  }else{
   shape=polygon([[-half,0],[half,0],[half,h],[-half,h]]);
   if(walkDoor){const hole=new THREE.Path();hole.moveTo(cutLeft,walkHeight);hole.lineTo(cutLeft,top);hole.lineTo(cutRight,top);hole.lineTo(cutRight,walkHeight);hole.closePath();shape.holes.push(hole);}
  }
  const g=new THREE.ExtrudeGeometry(shapes,{depth:.26,bevelEnabled:false,steps:1});g.translate(0,0,-.13);
  const pos=g.getAttribute('position'),uv=new Float32Array(pos.count*2),angle=side*Math.PI/6;
  for(let i=0;i<pos.count;i++){
   const originalX=pos.getX(i),y=pos.getY(i),offset=pos.getZ(i),x=originalX*(1-offset/apothem),z=offset-apothem;
   uv[i*2]=(side+.5+originalX/width)*perimeter/12;uv[i*2+1]=bottom+y;
   pos.setXYZ(i,p.position[0]+x*Math.cos(angle)-z*Math.sin(angle),bottom+y,p.position[2]+x*Math.sin(angle)+z*Math.cos(angle));
  }
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.computeVertexNormals();parts.push(g);
 }
 const g=merge(parts);g.userData.preservePaintUV=true;return g;
}

export function buildFortressWindow(p:PieceSpec){
 const g=new THREE.PlaneGeometry(p.size[0],p.size[1]);g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation??[0,0,0])));g.translate(...p.position);g.userData.preservePaintUV=true;return g;
}
export function createFortressWindowTexture(){
 const w=8,h=16,data=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const border=x===0||x===7||y===0||y===15,bar=x===3||y===8;
  const color=border?[63,36,19]:bar?[110,64,24]:(x+y)%4===0?[255,237,132]:[245,177,51];
  data.set([...color,255],((h-1-y)*w+x)*4);
 }
 const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat);t.colorSpace=THREE.SRGBColorSpace;t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;
}
