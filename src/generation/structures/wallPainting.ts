import * as THREE from 'three';
import type {WallSpec,OpeningSpec,StructurePlan,StructureConfig,V3} from './types';

type Contact=[number,number,number,number,number];
const noise=(x:number,y:number,seed:number)=>{const v=Math.sin(x*127.1+y*311.7+seed*.37)*43758.5453;return v-Math.floor(v);};

/** Paint in wall coordinates so the dark pixels follow real structural contacts. */
export function paintWallSurface(g:THREE.BufferGeometry,w:WallSpec,openings:OpeningSpec[],plan:StructurePlan,c:StructureConfig){
 const dx=w.end[0]-w.start[0],dz=w.end[2]-w.start[2],length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length;
 const height=Math.max(w.height+(w.gable?.peak??0),w.topLeft??0,w.topRight??0);
 const project=(p:V3)=>[(p[0]-w.start[0])*ux+(p[2]-w.start[2])*uz,p[1]-w.bottom];
 // Shared walls can be split into cells. Only the original building outline
 // casts an edge shadow; internal cell boundaries must stay invisible.
 const volume=plan.volumes.find(v=>v.id===w.volume),roof=plan.roofs.find(r=>r.volume===w.volume);
 const fullLength=volume?(Math.abs(ux)>.5?volume.width:volume.depth):length;
 const center=volume?project([volume.x,w.bottom,volume.z])[0]:length/2;
 const left=center-fullLength/2,right=center+fullLength/2,bottom=volume?volume.bottom-w.bottom:0;
 const top=volume?volume.bottom+volume.height-w.bottom:w.height;
 const contacts:Contact[]=[[left,bottom,right,bottom,0],[left,bottom,left,top,0],[right,bottom,right,top,0]];
 if(roof&&(roof.kind==='gable'||roof.kind==='thatch')&&Math.abs(ux)>.5){
  const ratio=ux>0?(roof.ridgeRatio??.5):1-(roof.ridgeRatio??.5),peak=left+fullLength*ratio;
  contacts.push([left,top,peak,top+roof.rise,0],[peak,top+roof.rise,right,top,0]);
 }else if(roof?.kind==='shed'){
  const lt=top+(Math.abs(ux)>.5?(ux*(roof.shedDirection??1)<0?roof.rise:0):(w.start[0]-roof.x)*(roof.shedDirection??1)>0?roof.rise:0);
  const rt=top+(Math.abs(ux)>.5?(ux*(roof.shedDirection??1)>0?roof.rise:0):(w.end[0]-roof.x)*(roof.shedDirection??1)>0?roof.rise:0);
  contacts.push([left,lt,right,rt,0]);
 }else contacts.push([left,top,right,top,0]);
 for(const o of openings){const x=o.offset+length/2-o.width/2,y=o.bottom;
  contacts.push([x,y,x,y+o.height,.07],[x+o.width,y,x+o.width,y+o.height,.07],[x,y+o.height,x+o.width,y+o.height,.08]);
  if(o.kind==='window')contacts.push([x,y,x+o.width,y,.07]);
 }
 for(const p of plan.pieces){
  if(p.removed||p.material!=='wood'||p.kind!=='beam'||!p.end)continue;
  const normalDistance=((p.position[0]+p.end[0])/2-w.start[0])*uz-((p.position[2]+p.end[2])/2-w.start[2])*ux;
  if(Math.abs(normalDistance)>w.thickness/2+.3)continue;
  const a=project(p.position),b=project(p.end);
  if(Math.max(a[0],b[0])<-.3||Math.min(a[0],b[0])>length+.3)continue;
  contacts.push([a[0],a[1],b[0],b[1],p.size[0]/2]);
 }
 const width=Math.max(8,Math.min(768,Math.ceil(length*c.texelsPerMetre))),rows=Math.max(8,Math.min(768,Math.ceil(height*c.texelsPerMetre)));
 const data=new Uint8Array(width*rows*4),base=new THREE.Color(c.palette.plaster).convertLinearToSRGB();
 const color=[base.r,base.g,base.b];
 const shadow=[.32,.39,.37];
 const palette=[0,.18,.36].map(shade=>color.map((value,k)=>Math.round((value*(1-shade)+shadow[k]*shade)*255)));
 // Só os texels perto de algum contato (a menos de 0,285 m, a maior largura de faixa) recebem tom: cada contato percorre só o retângulo
 // dele, em vez de todos os contatos para todos os texels (era 95% do tempo de criar uma casa). O resultado é o mesmo.
 const REACH=.285,distances=new Float64Array(width*rows).fill(Infinity);
 const tx=width/length,ty=rows/height;
 for(const [ax,ay,bx,by,radius] of contacts){
  const vx=bx-ax,vy=by-ay,len=vx*vx+vy*vy,pad=radius+REACH+.02;
  const i0=Math.max(0,Math.floor((Math.min(ax,bx)-pad)*tx)),i1=Math.min(width-1,Math.ceil((Math.max(ax,bx)+pad)*tx));
  const j0=Math.max(0,Math.floor((Math.min(ay,by)-pad)*ty)),j1=Math.min(rows-1,Math.ceil((Math.max(ay,by)+pad)*ty));
  for(let j=j0;j<=j1;j++){const y=(j+.5)*height/rows;
   for(let i=i0;i<=i1;i++){const x=(i+.5)*length/width;
    const t=len>0?Math.max(0,Math.min(1,((x-ax)*vx+(y-ay)*vy)/len)):0;
    const ex=x-ax-t*vx,ey=y-ay-t*vy,d=Math.sqrt(ex*ex+ey*ey)-radius,k=j*width+i;
    if(d<distances[k])distances[k]=d;
   }
  }
 }
 for(let j=0;j<rows;j++)for(let i=0;i<width;i++){
  const distance=distances[j*width+i];let tone=0;
  if(distance<REACH){
   // One- and two-texel clusters keep the edge pixelated rather than chunky.
   const patch=noise(Math.floor(i/2),Math.floor(j/2),plan.seed);
   const pixel=noise(i,j,plan.seed+17);
   const band=.135+patch*.07+pixel*.08;
   // Noise changes the silhouette, never the color of a palette entry.
   tone=distance<band*.38?2:distance<band?1:0;
  }
  data.set(palette[tone],(j*width+i)*4);data[(j*width+i)*4+3]=255;
 }
 const positions=g.getAttribute('position'),uv=new Float32Array(positions.count*2);
 for(let i=0;i<positions.count;i++){const local=project([positions.getX(i),positions.getY(i),positions.getZ(i)]);uv[i*2]=local[0]/length;uv[i*2+1]=local[1]/height;}
 g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 const map=new THREE.DataTexture(data,width,rows);map.colorSpace=THREE.SRGBColorSpace;
 map.magFilter=map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;
 return map;
}
