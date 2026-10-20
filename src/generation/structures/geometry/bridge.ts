import * as THREE from 'three';

/** Broad blue-green water facets, on the same metre-based UVs as the bridge. */
export function bridgeWaterTexture(density:number,seed:number){
 const period=4,size=Math.max(8,Math.round(period*density)),data=new Uint8Array(size*size*4);
 const colors=[[35,103,119],[38,116,132],[47,131,145],[56,145,154]];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const xx=Math.floor(x/size*8),yy=Math.floor(y/size*8);
  const hash=Math.sin(xx*127.1+yy*311.7+seed*.37)*43758.5453;
  const index=Math.floor((hash-Math.floor(hash))*colors.length);
  data.set([...colors[index],255],(y*size+x)*4);
 }
 const map=new THREE.DataTexture(data,size,size);map.colorSpace=THREE.SRGBColorSpace;
 map.magFilter=map.minFilter=THREE.NearestFilter;map.wrapS=map.wrapT=THREE.RepeatWrapping;
 map.repeat.set(1/period,1/period);map.needsUpdate=true;return map;
}
