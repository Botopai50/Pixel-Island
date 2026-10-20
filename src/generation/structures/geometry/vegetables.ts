import * as THREE from 'three';
import {merge} from './common';
import {pixelMossNoiseAt} from '../../vegetation/pixelTrees/services/mossStyle';

const hash=(x:number,y:number,seed:number)=>{const n=Math.sin(x*127.1+y*311.7+seed*.37)*43758.5453;return n-Math.floor(n);};
const texture=(data:Uint8Array,width:number,height:number)=>{
 const map=new THREE.DataTexture(data as Uint8Array<ArrayBuffer>,width,height);map.colorSpace=THREE.SRGBColorSpace;map.magFilter=map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
};

export function cultivatedSoilTexture(density:number,seed:number){
 const w=Math.round(density*3.2),h=Math.round(density*2.4),data=new Uint8Array(w*h*4),colors=[[60,43,28],[77,53,33],[93,65,39],[108,77,46],[124,90,56]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const field=pixelMossNoiseAt(x/11,y/9,seed*.1)*.7+pixelMossNoiseAt(x/4,y/3,seed*.1+17)*.3;
  let tone=Math.min(4,Math.max(1,Math.floor(field*4.5)));
  const grain=hash(x,y,seed);if(grain<.025)tone=Math.max(0,tone-1);else if(grain>.982)tone=Math.min(4,tone+1);
  data.set([...colors[tone],255],(y*w+x)*4);
 }
 const map=texture(data,w,h);map.name='CultivatedSoil';map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(1/3.2,1/2.4);return map;
}

export function vegetableLeafTexture(kind:'cabbage'|'carrot'|'leafy',density:number){
 const size=Math.max(10,Math.round(density*.5)),data=new Uint8Array(size*size*4);
 const colors=kind==='cabbage'?[[34,79,23],[56,112,32],[96,151,46],[143,185,66],[201,223,121]]:kind==='carrot'?[[25,65,12],[41,92,16],[65,126,22],[104,162,30],[147,191,44]]:[[37,77,34],[52,101,41],[76,128,53],[101,151,65],[128,170,84]];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=(x+.5)/size,v=(y+.5)/size,side=Math.abs(u-.5),vein=Math.abs(((v-side*.72)*4)%1-.5);
  let tone=u<.45?2:1;if(v>.55)tone++;
  if(kind==='cabbage'){
   const patch=hash(Math.floor(x/3),Math.floor(y/3),19);if(patch>.70)tone=Math.min(3,tone+1);
   if(side<.045||vein<.055&&side<.38)tone=4;
   else if(side>.40&&v<.65)tone=Math.max(0,tone-1);
  }else{
   if(side<.055)tone=4;else if(vein<.07&&side<.39)tone=Math.min(4,tone+1);
   if(side>.4)tone=Math.max(0,tone-1);
  }
  data.set([...colors[tone],255],(y*size+x)*4);
 }
 const map=texture(data,size,size);map.name='VegetableLeaf_'+kind;return map;
}

/** Quantas divisões tem cada folha (16 = galeria de ativos; o jogo usa menos: uma fazenda chegava a 300 mil triângulos). */
export const VEGETABLE_DETAIL = { cells: 16 };

/** Curved blades retain their volume, with outlines cut into whole surface texels. */
export function vegetableLeafGeometry(width:number,length:number,cup=false,lobed=false){
 const positions:number[]=[],uv:number[]=[],indices:number[]=[],rows=VEGETABLE_DETAIL.cells,columns=VEGETABLE_DETAIL.cells;
 for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
  const t=j/rows,s=i/columns*2-1,x=s*width;
  const y=cup?.06+t*.51:length*t;
  const z=cup?.10+.36*Math.sin(t*Math.PI*.90)-.10*s*s*Math.sin(t*Math.PI):.055*Math.sin(t*Math.PI)*(1-s*s);
  positions.push(x,y,z);uv.push(i/columns,t);
  if(j<rows&&i<columns){
   const centerT=(j+.5)/rows,centerS=(i+.5)/columns*2-1;
   const lobes=lobed?.48+.52*Math.abs(Math.sin(centerT*Math.PI*3)):1;
   const spread=Math.max(.04,Math.pow(Math.sin(centerT*Math.PI),.62)*lobes);
   if(Math.abs(centerS)<=spread){const at=j*(columns+1)+i;indices.push(at,at+1,at+columns+2,at,at+columns+2,at+columns+1);}
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}

/** Each stepped leaf cups the head rather than standing up as a flat petal. */
export function cabbageLeafGeometry(radius:number,tipAngle:number,halfAngle:number){
 const g=vegetableLeafGeometry(1,1),p=g.getAttribute('position'),uv=g.getAttribute('uv');
 for(let i=0;i<p.count;i++){
  const t=uv.getY(i),s=uv.getX(i)*2-1,theta=2.28+(tipAngle-2.28)*t,phi=s*halfAngle;
  const r=radius+.018*Math.sin(t*Math.PI)*Math.cos(s*Math.PI/2);
  p.setXYZ(i,r*Math.sin(theta)*Math.sin(phi),.36+r*Math.cos(theta),r*Math.sin(theta)*Math.cos(phi));
 }
 g.computeVertexNormals();return g;
}

export function cabbageGeometry(){
 const parts:THREE.BufferGeometry[]=[],head=new THREE.SphereGeometry(.31,12,8);head.scale(1,1.03,1);head.translate(0,.36,0);parts.push(head);
 // Staggered layers leave the rounded centre visible between overlapping leaves.
 for(let i=0;i<7;i++){
  const leaf=vegetableLeafGeometry(.29,1,true),p=leaf.getAttribute('position'),uv=leaf.getAttribute('uv');
  for(let j=0;j<p.count;j++){
   const t=uv.getY(j),s=uv.getX(j)*2-1;
   p.setXYZ(j,s*.29,.03+t*(.47+(i%3)*.09),.12+.40*Math.sin(t*Math.PI*.82)-.09*s*s*Math.sin(t*Math.PI));
  }
  leaf.computeVertexNormals();leaf.rotateY(i*Math.PI*2/7+.18);parts.push(leaf);
 }
 for(let i=0;i<5;i++){
  const leaf=cabbageLeafGeometry(.375,.53+(i%2)*.16,.88);leaf.rotateY(i*Math.PI*2/5+.58);parts.push(leaf);
 }
 for(let i=0;i<3;i++){
  const leaf=cabbageLeafGeometry(.337,.40+i*.10,.94);leaf.rotateY(i*Math.PI*2/3+.23);parts.push(leaf);
 }
 return merge(parts);
}

export function leafyCropGeometry(){
 const parts:THREE.BufferGeometry[]=[];
 for(let i=0;i<11;i++){
  const leaf=vegetableLeafGeometry(i<7?.20:.16,i<7?.78:.62);leaf.rotateX(i<7?-1.02:-.36);leaf.rotateY(i*2.399);leaf.translate(0,i<7?0:.08,0);parts.push(leaf);
 }
 return merge(parts);
}

export function carrotFoliageGeometry(){
 const parts:THREE.BufferGeometry[]=[],up=new THREE.Vector3(0,1,0);
 for(let i=0;i<3;i++){
  const angle=i*2.399,height=i===0?1.12:1.02-i*.10,reach=i===0?.09:.44,base=new THREE.Vector3(0,.12,0),end=new THREE.Vector3(Math.sin(angle)*reach,height,Math.cos(angle)*reach),delta=end.clone().sub(base);
  const stem=new THREE.CylinderGeometry(.026,.039,delta.length(),5);stem.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,delta.clone().normalize()));stem.translate(...base.clone().add(end).multiplyScalar(.5).toArray() as [number,number,number]);parts.push(stem);
  for(let j=1;j<=2;j++)for(const side of [-1,1]){
   const at=base.clone().addScaledVector(delta,j/3.2),leaf=vegetableLeafGeometry(.18-j*.008,.44-j*.025,false,true);
   leaf.rotateZ(side*.86);leaf.rotateX(-.30);leaf.rotateY(angle*.12);leaf.translate(...at.toArray() as [number,number,number]);parts.push(leaf);
  }
  const tip=vegetableLeafGeometry(.19,.40,false,true);tip.rotateX(-.18);tip.rotateY(angle*.12);tip.translate(...end.toArray() as [number,number,number]);parts.push(tip);
 }
 return merge(parts);
}

export function carrotRootGeometry(){
 const profile=[new THREE.Vector2(0,-.56),new THREE.Vector2(.16,-.50),new THREE.Vector2(.36,-.32),new THREE.Vector2(.48,-.12),new THREE.Vector2(.49,.08),new THREE.Vector2(.40,.28),new THREE.Vector2(.24,.39),new THREE.Vector2(.08,.34)];
 const g=new THREE.LatheGeometry(profile,10);g.computeVertexNormals();return g;
}

export function carrotRootTexture(density:number,seed:number){
 const period=.65,size=Math.max(8,Math.round(density*period)),data=new Uint8Array(size*size*4),colors=[[159,66,16],[194,83,15],[222,105,18],[241,133,29],[255,159,51],[255,185,74]];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const patch=hash(Math.floor(x/3),Math.floor(y/3),seed),band=hash(Math.floor(x/4),Math.floor(y/4),seed+17);
  let tone=patch<.28?2:3;if(band>.8&&y%4===0)tone=1;else if(patch>.78)tone=4;if(hash(x,y,seed+29)>.985)tone=5;
  data.set([...colors[tone],255],(y*size+x)*4);
 }
 const map=texture(data,size,size);map.name='CarrotOrange';map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(1/period,1/period);return map;
}
