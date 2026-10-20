import * as THREE from 'three';import type {PieceSpec} from '../types';
import {buildAncientPiece} from './ancientRuins';
import {merge} from './common';

export function buildTemplePiece(p:PieceSpec){
 if(p.role==='temple-ivy')return buildAncientPiece({...p,role:'ancient-ivy'});
 if(p.material!=='stone'||p.kind!=='box'||p.role==='temple-glyph')return;
 if(['temple-column','temple-wall-pier','temple-upper-pier'].includes(p.role)){
  const count=Math.max(3,Math.ceil(p.size[1]/(p.size[0]*1.2))),height=p.size[1]/count,parts:THREE.BufferGeometry[]=[];
  for(let i=0;i<count;i++)parts.push(buildAncientPiece({...p,role:'ancient-masonry',position:[p.position[0],p.position[1]-p.size[1]/2+(i+.5)*height,p.position[2]],size:[p.size[0],height-.009,p.size[2]]})!);
  return merge(parts);
 }
 return buildAncientPiece({...p,role:'ancient-masonry'});
}

export function buildTempleGlyph(p:PieceSpec){
 const geometry=new THREE.PlaneGeometry(p.size[0],p.size[1]);
 if(p.rotation)geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));
 geometry.translate(...p.position);geometry.userData.preservePaintUV=true;return geometry;
}

/** Shallow carved geometric marks: lit rims, recessed grooves and chipped stone pixels. */
export function createTempleGlyphTexture(color:string,variant:number){
 const size=32,data=new Uint8Array(size*size*4),base=new THREE.Color(color).convertLinearToSRGB();
 const ramp=[.40,.72,.91,1.05].map(t=>[base.r,base.g,base.b].map(c=>Math.round(Math.min(1,c*t)*255)));
 const groove=new Set<string>(),mark=(x:number,y:number)=>{for(let a=0;a<2;a++)for(let b=0;b<2;b++)groove.add((x+a)+','+(y+b));};
 const points=variant%2===0?[[8,8],[23,8],[23,23],[8,23],[8,13],[18,13],[18,18],[13,18]]:[[8,8],[23,8],[23,23],[8,23],[8,18],[18,18],[18,13],[13,13]];
 for(let i=0;i<points.length-1;i++){const [x,y]=points[i],[xx,yy]=points[i+1],steps=Math.max(Math.abs(xx-x),Math.abs(yy-y));for(let j=0;j<=steps;j++)mark(Math.round(x+(xx-x)*j/steps),Math.round(y+(yy-y)*j/steps));}
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const xx=variant>1?31-x:x,edge=x<2||y<2||x>29||y>29,key=xx+','+y;
  let tone=edge?1:2;
  if(groove.has(key))tone=0;else if(groove.has((xx+1)+','+(y-1)))tone=3;
  if((x*17+y*13+variant*7)%97===0)tone=Math.max(1,tone-1);
  data.set([...ramp[tone],255],((size-y-1)*size+x)*4);
 }
 const map=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);map.colorSpace=THREE.SRGBColorSpace;map.magFilter=map.minFilter=THREE.NearestFilter;map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

export function createTemplePavingTexture(color:string,density:number,seed:number){
 const size=Math.max(32,Math.round(density*2.8)),data=new Uint8Array(size*size*4),tile=size/4,base=new THREE.Color(color).convertLinearToSRGB();
 const ramp=[.42,.63,.81,.97,1.06].map(t=>[base.r,base.g,base.b].map(c=>Math.round(Math.min(1,c*t)*255)));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const row=Math.floor(y/tile),shift=(row%2)*tile*.30,col=Math.floor((x+shift)/tile),px=(x+shift)%tile,py=y%tile,hash=Math.abs(Math.sin(col*17.13+row*31.71+seed));
  let tone=hash<.22?2:3;
  if(px<1||py<1)tone=0;else if(px<2||py<2)tone=4;else if(px>tile-1.6||py>tile-1.6)tone=2;
  if(hash>.68&&Math.abs(px-(tile*.38+Math.floor(py/3)))<.7&&py>tile*.55)tone=1;
  if((x*11+y*19+seed)%109===0)tone=Math.max(1,tone-1);
  data.set([...ramp[tone],255],(y*size+x)*4);
 }
 const map=new THREE.DataTexture(data,size,size);map.colorSpace=THREE.SRGBColorSpace;map.magFilter=map.minFilter=THREE.NearestFilter;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(1/2.8,1/2.8);map.needsUpdate=true;return map;
}
