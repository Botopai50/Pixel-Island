import * as THREE from 'three';
import type {PieceSpec,StructureConfig} from '../types';
import {PROVISION_PROFILE,PROVISION_SEAMS,provisionRadiusAt,provisionFoldAt} from '../provisionProfile';
import {buildAncientPiece} from './ancientRuins';

export function provisionFabricTexture(c:StructureConfig,seed:number){
 const size=Math.max(32,Math.round(c.texelsPerMetre*2)),data=new Uint8Array(size*size*4),base=new THREE.Color(c.palette.plaster).convertLinearToSRGB();
 const hash=(x:number,y:number,salt=0)=>{const n=Math.sin(x*127.1+y*311.7+(seed+salt)*.31)*43758.5453;return n-Math.floor(n);};
 const noise=(x:number,y:number,step:number,salt:number)=>{
  const px=x/step,py=y/step,ix=Math.floor(px),iy=Math.floor(py);
  const fx=px-ix,fy=py-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const a=hash(ix,iy,salt)*(1-sx)+hash(ix+1,iy,salt)*sx;
  const b=hash(ix,iy+1,salt)*(1-sx)+hash(ix+1,iy+1,salt)*sx;
  return a*(1-sy)+b*sy;
 };
 // Quantized, irregular dyed patches and rare short fibres. Avoid a regular
 // weave grid: it creates moiré when this small object is viewed at a distance.
 const shades=[.90,.95,.985,1.015,1.045];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const field=noise(x,y,8,0)*.72+noise(x,y,3,47)*.28;
  let shade=field<.32?0:field<.43?1:field<.55?2:field<.69?3:4;
  const fleck=hash(Math.floor(x/7),Math.floor(y/7),91);
  if(fleck>.89&&x%7>=2&&x%7<=3&&y%7===Math.floor(fleck*13)%7)shade=Math.min(4,shade+1);
  const tone=shades[shade];
  data.set([Math.round(Math.min(255,base.r*255*tone)),Math.round(Math.min(255,base.g*255*tone)),Math.round(Math.min(255,base.b*255*tone)),255],(y*size+x)*4);
 }
 const map=new THREE.DataTexture(data,size,size);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(1,1);map.minFilter=map.magFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

export function provisionRopeTexture(){
 const w=32,h=16,data=new Uint8Array(w*h*4),base=new THREE.Color('#845328').convertLinearToSRGB();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const strand=(x+Math.floor(y/2))%8,tone=strand<2?1.23:strand>5?.69:1;data.set([Math.min(255,base.r*255*tone),Math.min(255,base.g*255*tone),Math.min(255,base.b*255*tone),255],(y*w+x)*4);}
 const map=new THREE.DataTexture(data,w,h);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(12,1);map.minFilter=map.magFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

export function buildProvisionPiece(p:PieceSpec){
 if(!p.role.startsWith('provision-'))return;
 const [w,h,d]=p.size;
 if(p.role==='provision-stitch')return buildAncientPiece({...p,role:'ancient-masonry'});
 if(p.role==='provision-rope-end'){const g=new THREE.IcosahedronGeometry(w/2,0);g.scale(1,h/w,d/w);g.translate(...p.position);return g;}
 if(p.role==='provision-knot'){
  const g=new THREE.TorusGeometry(w*.30,h*.22,5,10);g.scale(1,h/w*1.25,1);g.rotateZ(.45);g.rotateY(p.rotation![1]);g.translate(...p.position);g.userData.preservePaintUV=true;return g;
 }
 if(p.role==='provision-rope-ring'||p.role==='provision-rope-tail'){
  const points:THREE.Vector3[]=[];
  if(p.role==='provision-rope-ring')for(let i=0;i<=64;i++){const angle=i*Math.PI/32;points.push(new THREE.Vector3(Math.sin(angle)*w*.15,h*(.765+.005*Math.sin(angle*3)),Math.cos(angle)*d*.15));}
  else{
   const angle=p.rotation![1],end=angle<2.55?.53:.57;
   for(let i=0;i<=12;i++){const t=.765-(.765-end)*i/12,rr=provisionRadiusAt(t)*provisionFoldAt(t,angle);points.push(new THREE.Vector3(Math.sin(angle)*(w*.5*rr+.028*h),h*t,Math.cos(angle)*(d*.5*rr+.028*h)));}
  }
  const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),p.role==='provision-rope-ring'?64:24,h*.019,6,false);g.userData.preservePaintUV=true;return g;
 }
 const positions:number[]=[],uv:number[]=[],colors:number[]=[],segments=36;
 const at=(t:number,angle:number,inner=false)=>{
  let r=provisionRadiusAt(t)*provisionFoldAt(t,angle),y=t;
  if(p.role==='provision-mouth'){
   const f=(t-.79)/.21,flare=Math.pow(Math.max(0,f),.85),foldAngle=angle+.15*Math.sin(angle*3+1.2);
   r=.25*provisionFoldAt(.79,angle)+flare*(.30+.075*Math.cos(foldAngle*5+.4)+.020*Math.sin(angle*2));
   // Tall rear folds and a lower front lip make an actual gathered cloth opening.
   y=t+f*(-.036*Math.cos(angle-2.55)+.028*Math.sin(angle*3+.7)-.018*(1+Math.cos(foldAngle*5+.4))/2);
  }
  const thickness=inner?.016*h:0;return [Math.sin(angle)*(w*.5*r-thickness),h*y,Math.cos(angle)*(d*.5*r-thickness)];
 };
 const quad=(a:number[],b:number[],cc:number[],dd:number[],shade=1)=>{
  for(const v of [a,b,cc,a,cc,dd]){positions.push(...v);uv.push(Math.atan2(v[0]/w,v[2]/d)*Math.min(w,d)*.5,v[1]);colors.push(shade,shade,shade);}
 };
 if(p.role==='provision-seam'){
  const angle=p.rotation![1],half=.006*h/Math.min(w,d);
  const levels=[.08,...PROVISION_PROFILE.map(([t])=>t).filter(t=>t>.08&&t<.69),.69];
  for(let i=0;i<levels.length-1;i++){const a=at(levels[i],angle-half),b=at(levels[i],angle+half),cc=at(levels[i+1],angle+half),dd=at(levels[i+1],angle-half);for(const v of [a,b,cc,dd]){v[0]+=Math.sin(angle)*.0015*h;v[2]+=Math.cos(angle)*.0015*h;}quad(a,b,cc,dd);}
 }else{
  const levels=p.role==='provision-mouth'?[.79,.84,.90,.955,1]:PROVISION_PROFILE.map(([t])=>t);
  const angles=[...Array.from({length:segments+1},(_,i)=>i*Math.PI*2/segments),...PROVISION_SEAMS].sort((a,b)=>a-b);
  for(let i=0;i<angles.length-1;i++){
   const lo=angles[i],hi=angles[i+1];
   for(let row=0;row<levels.length-1;row++){
    quad(at(levels[row],lo),at(levels[row],hi),at(levels[row+1],hi),at(levels[row+1],lo));
    if(p.role==='provision-mouth')quad(at(levels[row],hi,true),at(levels[row],lo,true),at(levels[row+1],lo,true),at(levels[row+1],hi,true),.60);
   }
   if(p.role==='provision-mouth')quad(at(1,lo,true),at(1,lo),at(1,hi),at(1,hi,true),1.13);
   else{
    quad([0,0,0],at(0,hi),at(0,lo),[0,0,0],.70);
    quad([0,.79*h,0],at(.79,lo),at(.79,hi),[0,.79*h,0],.48);
   }
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();
 if(p.role==='provision-body'){
  const pos=g.getAttribute('position'),normals=g.getAttribute('normal');
  for(let i=0;i<pos.count;i++){
   const angle=Math.atan2(pos.getX(i)/w,pos.getZ(i)/d),t=pos.getY(i)/h;
   if(normals.getX(i)*Math.sin(angle)+normals.getZ(i)*Math.cos(angle)<.1)continue;
   const left=new THREE.Vector3(...at(t,angle-.004)),right=new THREE.Vector3(...at(t,angle+.004));
   const below=new THREE.Vector3(...at(Math.max(0,t-.002),angle)),above=new THREE.Vector3(...at(Math.min(.79,t+.002),angle));
   const normal=right.sub(left).cross(above.sub(below)).normalize();normals.setXYZ(i,normal.x,normal.y,normal.z);
  }
 }
 g.userData.preservePaintUV=true;return g;
}
