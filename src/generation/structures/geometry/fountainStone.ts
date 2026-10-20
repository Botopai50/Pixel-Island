import * as THREE from 'three';
import type {StructureConfig} from '../types';
import {FOUNTAIN_STONE_PIXELS} from '../textures/fountainStonePixels';

/** Original bitmap art, sampled without smoothing at a consistent pixel size. */
export function fountainStoneTexture(c:StructureConfig,_seed:number){
 const size=32,source=atob(FOUNTAIN_STONE_PIXELS),data=new Uint8Array(size*size*4);
 const tint=new THREE.Color(c.palette.stone).convertLinearToSRGB(),reference=new THREE.Color('#8c8f87').convertLinearToSRGB();
 for(let i=0;i<size*size;i++)data.set([Math.min(255,Math.round(source.charCodeAt(i*3)*tint.r/reference.r)),Math.min(255,Math.round(source.charCodeAt(i*3+1)*tint.g/reference.g)),Math.min(255,Math.round(source.charCodeAt(i*3+2)*tint.b/reference.b)),255],i*4);
 const map=new THREE.DataTexture(data,size,size);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping;
 map.name='FountainCarvedBlockV3';
 map.minFilter=map.magFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}
