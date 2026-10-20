import * as THREE from 'three';
import type {PieceSpec} from '../types';
export function buildStoneLanternPiece(piece:PieceSpec){
 if(!['stone-lantern-base','stone-lantern-corbel'].includes(piece.role))return;
 const taper=piece.role==='stone-lantern-corbel'?.64:1;
 const geometry=new THREE.CylinderGeometry(piece.size[0]/2,piece.size[0]/2*taper,piece.size[1],8);
 geometry.rotateY(Math.PI/8);geometry.scale(1,1,piece.size[2]/piece.size[0]);geometry.translate(...piece.position);return geometry;
}
export function stoneLanternGlassTexture(){
 const w=12,h=16,data=new Uint8Array(w*h*4),colors=[[170,110,46],[217,158,67],[240,189,89],[255,224,136],[255,242,181]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const edge=Math.min(x,w-1-x,y,h-1-y),centre=Math.abs(x-w/2);
  const tone=edge<1?0:centre<2&&y>3&&y<13?4:x<5?3:2;data.set([...colors[tone],255],(y*w+x)*4);
 }
 const texture=new THREE.DataTexture(data,w,h);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}
