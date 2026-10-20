import * as THREE from 'three';import type {PieceSpec,StructureConfig,V3} from '../types';
import {buildCampPiece} from './camp';
import {buildAncientPiece} from './ancientRuins';
import {buildBarrelPiece} from './barrel';
import {buildCratePiece} from './crate';
import {buildProvisionPiece} from './provisions';
import {buildWatermillPiece} from './watermill';
import {buildMarketPiece} from './market';
import {merge,box} from './common';

export function sceneryMossTexture(c:StructureConfig,seed:number){
 const width=Math.max(8,Math.round(c.width*c.texelsPerMetre)),height=Math.max(8,Math.round(c.depth*c.texelsPerMetre)),data=new Uint8Array(width*height*4),base=new THREE.Color(c.palette.plaster).convertLinearToSRGB();
 const random=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7+seed)*43758.5453;return n-Math.floor(n);};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const xx=(x+.5)/width-.5,yy=(y+.5)/height-.5,noise=random(Math.floor(x/3),Math.floor(y/3));
  const edge=.40+(noise-.5)*.14+.025*Math.sin(Math.atan2(yy,xx)*5+seed),visible=Math.hypot(xx,yy)<edge&&random(x,y)>.025;
  const shade=[.68,.85,1,1.16][Math.floor(noise*4)];data.set([Math.min(255,Math.round(base.r*255*shade)),Math.min(255,Math.round(base.g*255*shade)),Math.min(255,Math.round(base.b*255*shade)),visible?255:0],(y*width+x)*4);
 }
 const map=new THREE.DataTexture(data,width,height);map.colorSpace=THREE.SRGBColorSpace;map.minFilter=map.magFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

/** Whole grid cells give the dirt a stepped pixel edge while the open ends join. */
function pathGeometry(p:PieceSpec,c:StructureConfig){
 const w=p.size[0],d=p.size[2],style=c.pathStyle??'straight',width=Math.min(c.pathWidth??1.1,w*.65,d*.80);
 const nx=Math.min(96,Math.max(24,Math.round(w*12))),nz=Math.min(96,Math.max(24,Math.round(d*12))),dx=w/nx,dz=d/nz,cells=new Set<string>();
 const key=(i:number,j:number)=>i+':'+j;
 for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
  const x=-w/2+(i+.5)*dx,z=-d/2+(j+.5)*dz;
  let inside=false;
  if(style==='curve'){
   // An L connector: a rounded bend links the left edge to the upper edge.
   const rx=w-width/2,rz=d-width/2,cx=-w/2,cz=d/2;
   inside=Math.abs(Math.hypot((x-cx)/rx,(z-cz)/rz)-1)*Math.min(rx,rz)<width/2;
  }else{
   const edge=c.type==='dirtPath'&&i>1&&i<nx-2?Math.sin(Math.floor(i/3)*2.4+c.texelsPerMetre)*.035:0;
   inside=Math.abs(z)<width/2+edge||(style==='junction'&&z>=0&&Math.abs(x)<width/2);
  }
  if(inside)cells.add(key(i,j));
 }
 const points:number[]=[],quad=(a:number[],b:number[],cc:number[],dd:number[])=>points.push(...a,...b,...cc,...a,...cc,...dd),top=.035,bottom=0;
 for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)if(cells.has(key(i,j))){
  const x=-w/2+i*dx,z=-d/2+j*dz;
  quad([x,top,z],[x,top,z+dz],[x+dx,top,z+dz],[x+dx,top,z]);
  quad([x,bottom,z],[x+dx,bottom,z],[x+dx,bottom,z+dz],[x,bottom,z+dz]);
  if(!cells.has(key(i-1,j)))quad([x,bottom,z],[x,bottom,z+dz],[x,top,z+dz],[x,top,z]);
  if(!cells.has(key(i+1,j)))quad([x+dx,bottom,z+dz],[x+dx,bottom,z],[x+dx,top,z],[x+dx,top,z+dz]);
  if(!cells.has(key(i,j-1)))quad([x+dx,bottom,z],[x,bottom,z],[x,top,z],[x+dx,top,z]);
  if(!cells.has(key(i,j+1)))quad([x,bottom,z+dz],[x+dx,bottom,z+dz],[x+dx,top,z+dz],[x,top,z+dz]);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(points.length/3*2),2));g.computeVertexNormals();return g;
}

function fountainBoxUV(g:THREE.BufferGeometry,p:PieceSpec){
 const inverse=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(p.rotation??[0,0,0]) as V3)).invert(),position=g.getAttribute('position'),normal=g.getAttribute('normal'),uv=g.getAttribute('uv'),point=new THREE.Vector3(),n=new THREE.Vector3();
 for(let i=0;i<position.count;i++){
  point.fromBufferAttribute(position,i).sub(new THREE.Vector3(...p.position)).applyMatrix4(inverse);n.fromBufferAttribute(normal,i).transformDirection(inverse);
  const ax=Math.abs(n.x),ay=Math.abs(n.y),az=Math.abs(n.z);
  if(ay>=Math.max(ax,az))uv.setXY(i,point.x/p.size[0]+.5,point.z/p.size[2]+.5);
  else if(ax>az)uv.setXY(i,point.z/p.size[2]+.5,point.y/p.size[1]+.5);
  else uv.setXY(i,point.x/p.size[0]+.5,point.y/p.size[1]+.5);
 }
 g.userData.preservePaintUV=true;return g;
}

export function buildSceneryPiece(p:PieceSpec,c:StructureConfig){
 const market=buildMarketPiece(p);if(market)return market;
 const barrel=buildBarrelPiece(p);if(barrel)return barrel;
 const crate=buildCratePiece(p);if(crate)return crate;
 const provision=buildProvisionPiece(p);if(provision)return provision;
 const watermill=buildWatermillPiece(p);if(watermill)return watermill;
 if(p.role==='fountain-ring-block')return buildSceneryPiece({...p,role:p.rotation?'well-stone-block':'well-core'},c);
 if(p.role==='fountain-buttress'){
  const g=fountainBoxUV(buildAncientPiece({...p,role:'ancient-masonry'})!,p),normals=g.getAttribute('normal'),front=new Float32Array(normals.count);
  const inverse=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(p.rotation??[0,0,0]) as V3)).invert(),n=new THREE.Vector3();
  for(let i=0;i<normals.count;i++){n.fromBufferAttribute(normals,i).transformDirection(inverse);front[i]=n.z>.95?1:0;}
  g.setAttribute('fountainPanelFront',new THREE.BufferAttribute(front,1));return g;
 }
 if(p.kind==='box'&&p.material==='stone'&&p.role.startsWith('fountain-'))return fountainBoxUV(buildAncientPiece({...p,role:'ancient-masonry'})!,p);
 if(['fountain-column','fountain-pedestal','fountain-moulding','fountain-water'].includes(p.role)){
  const r=p.size[0]/2,h=p.size[1],fluted=p.role==='fountain-column',steps=fluted?32:16;
  const g=new THREE.CylinderGeometry(r,r,h,steps);
  if(fluted){const pos=g.getAttribute('position');for(let i=0;i<pos.count;i++){const angle=Math.atan2(pos.getZ(i),pos.getX(i)),scale=1-.065*(1+Math.cos(angle*16))/2;pos.setX(i,pos.getX(i)*scale);pos.setZ(i,pos.getZ(i)*scale);}g.computeVertexNormals();}
  const pos=g.getAttribute('position'),normal=g.getAttribute('normal'),uv=g.getAttribute('uv');
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i),z=pos.getZ(i),y=pos.getY(i);
   if(p.role==='fountain-water')uv.setXY(i,x/(2*r)+.5,z/(2*r)+.5);
   else if(Math.abs(normal.getY(i))>.6)uv.setXY(i,x/(2*r)+.5,z/(2*r)+.5);
   else uv.setXY(i,uv.getX(i),y/h+.5);
  }
  if(p.role!=='fountain-water'){
   const local=new Float32Array(pos.count*2),half=new Float32Array(pos.count*2),colors=new Float32Array(pos.count*3);
   for(let i=0;i<pos.count;i++){local.set([uv.getX(i),pos.getY(i)],i*2);half.set([1000,h/2],i*2);colors.set([1,1,1],i*3);}
   g.setAttribute('wellFacePosition',new THREE.BufferAttribute(local,2));g.setAttribute('wellFaceHalf',new THREE.BufferAttribute(half,2));g.setAttribute('color',new THREE.BufferAttribute(colors,3));
  }
  g.userData.preservePaintUV=true;g.translate(...p.position);return g;
 }
 if(p.role==='well-rope-coil'){
  const points:THREE.Vector3[]=[];
  for(let i=0;i<=216;i++){const t=i/216,angle=t*Math.PI*18;points.push(new THREE.Vector3((t-.5)*p.size[0],Math.cos(angle)*p.size[1]/2,Math.sin(angle)*p.size[1]/2));}
  const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),216,p.size[2]/2,5,false);g.translate(...p.position);return g;
 }
 if(p.role==='well-roof-board'){
  const g=new THREE.BoxGeometry(...p.size);
  if(p.rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)));
  g.translate(...p.position);return g;
 }
 if(p.kind==='box'&&p.material==='wood'&&p.role.startsWith('well-'))return buildAncientPiece({...p,role:'ancient-masonry'});
 if(p.role==='well-core'||p.role==='well-stone-block'){
  const outer=p.size[0]/2,inner=p.size[2]/2,height=p.size[1],shape=new THREE.Shape(),full=p.role==='well-core',angle=p.rotation?.[1]??0,half=Math.PI/12-.012;
  if(full){
   shape.absarc(0,0,outer,0,Math.PI*2,false);const hole=new THREE.Path();hole.absarc(0,0,inner,0,Math.PI*2,true);shape.holes.push(hole);
  }else{
   for(let i=0;i<=3;i++){const at=angle-half+i*half*2/3;i?shape.lineTo(Math.cos(at)*outer,Math.sin(at)*outer):shape.moveTo(Math.cos(at)*outer,Math.sin(at)*outer);}
   for(let i=3;i>=0;i--){const at=angle-half+i*half*2/3;shape.lineTo(Math.cos(at)*inner,Math.sin(at)*inner);}shape.closePath();
  }
  const bevel=full?0:Math.min(.009,height*.05),g=new THREE.ExtrudeGeometry(shape,{depth:height-2*bevel,bevelEnabled:!full,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,steps:1,curveSegments:24});g.rotateX(Math.PI/2);g.translate(p.position[0],p.position[1]+height/2-bevel,p.position[2]);
  const pos=g.getAttribute('position'),normal=g.getAttribute('normal'),uv=g.getAttribute('uv'),local=new Float32Array(pos.count*2),halfSize=new Float32Array(pos.count*2),colors=new Float32Array(pos.count*3),index=Number(p.id.split('_').at(-1))||0;
  const tone=full?(c.type==='stoneFountain'?.85:.64):.88+((Math.sin(index*71.3)*43758.5)%1+1)%1*.18;
  // Sample the interior of one painted brick per real stone, so the atlas
  // joints never cut across a curved block. Keep the pixel scale on thin caps.
  const sourceRow=index%4,sourceColumn=Math.floor(index/4)%4,inset=2/c.texelsPerMetre;
  const sourceX=(sourceColumn+.5)*.7-(sourceRow%2)*.35,sourceY=(sourceRow+.5)*.4;
  const clampUnit=(value:number)=>Math.max(-1,Math.min(1,value));
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i)-p.position[0],z=pos.getZ(i)-p.position[2],y=pos.getY(i)-p.position[1],phi=Math.atan2(z,x),delta=Math.atan2(Math.sin(phi-angle),Math.cos(phi-angle)),radius=Math.hypot(x,z)>(inner+outer)/2?outer:inner;
   const tangent=full?phi*radius:delta*radius;
   if(c.type==='stoneFountain'){
    const radial=Math.hypot(x,z),top=Math.abs(normal.getY(i))>=.65;
    const cutFace=!top&&Math.abs(normal.getX(i)*Math.cos(phi)+normal.getZ(i)*Math.sin(phi))<.5;
    // One stone face per geometric block: border wear follows the real joints.
    if(full)uv.setXY(i,top?x/(2*outer)+.5:(phi+Math.PI)/(2*Math.PI),top?z/(2*outer)+.5:y/height+.5);
    else uv.setXY(i,cutFace?(radial-inner)/(outer-inner):delta/(2*half)+.5,top?(radial-inner)/(outer-inner):y/height+.5);
   }else if(full){
    uv.setXY(i,tangent,y);
   }else{
    const radial=Math.hypot(x,z),top=Math.abs(normal.getY(i))>=.65;
    const cutFace=!top&&Math.abs(normal.getX(i)*Math.cos(phi)+normal.getZ(i)*Math.sin(phi))<.5;
    const faceWidth=cutFace?outer-inner:2*radius*half,faceHeight=top?outer-inner:height;
    const faceU=cutFace?clampUnit((radial-(outer+inner)/2)/((outer-inner)/2)):clampUnit(tangent/(radius*half));
    const faceV=top?clampUnit((radial-(outer+inner)/2)/((outer-inner)/2)):clampUnit(y/(height/2));
    const spanU=Math.max(.01,Math.min(.7-2*inset,faceWidth*1.35)),spanV=Math.max(.01,Math.min(.4-2*inset,faceHeight*1.35));
    uv.setXY(i,sourceX+faceU*spanU/2,sourceY+faceV*spanV/2);
   }
   local.set(full?[0,0]:[tangent,y],i*2);halfSize.set(full?[1000,1000]:[radius*half,height/2],i*2);colors.set([tone,tone,tone],i*3);
  }
  g.setAttribute('wellFacePosition',new THREE.BufferAttribute(local,2));g.setAttribute('wellFaceHalf',new THREE.BufferAttribute(halfSize,2));g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.userData.preservePaintUV=true;return g;
 }
 if(p.role==='well-bucket'){
  const r=p.size[0]/2,h=p.size[1],g=new THREE.LatheGeometry([new THREE.Vector2(0,-h/2),new THREE.Vector2(r*.74,-h/2),new THREE.Vector2(r,h/2),new THREE.Vector2(r*.86,h/2),new THREE.Vector2(r*.65,-h/2+.025),new THREE.Vector2(0,-h/2+.025)],12);g.translate(...p.position);return g;
 }
 if(p.role==='well-bucket-hoop'){
  const g=new THREE.TorusGeometry(p.size[0]/2,p.size[1]/2,5,12);g.rotateX(Math.PI/2);g.translate(...p.position);return g;
 }
 if(['well-spindle','well-crank-grip','well-rope'].includes(p.role)){
  const g=new THREE.CylinderGeometry(p.size[0]/2,p.size[0]/2,p.size[1],10);if(p.role!=='well-rope')g.rotateZ(Math.PI/2);g.translate(...p.position);return g;
 }
 if(p.role.startsWith('scenery-tool-sprite-')){
  const g=new THREE.PlaneGeometry(p.size[0],p.size[1]);g.translate(...p.position);g.userData.preservePaintUV=true;return g;
 }
 if(p.kind==='box'&&p.material==='wood'&&p.role.startsWith('scenery-cart-'))return buildAncientPiece({...p,role:'ancient-masonry'});
 if(p.role==='scenery-cart-wheel'||p.role==='scenery-cart-tyre'){
  const r=p.size[0]/2,t=p.size[2],metal=p.role==='scenery-cart-tyre',bevel=metal?0:r*.025,shape=new THREE.Shape(),hole=new THREE.Path();
  const outer=metal?r+.016*(c.height/1.45):r-bevel,inner=metal?r-.025*(c.height/1.45):r*.67+bevel;
  for(let i=0;i<12;i++){const angle=i*Math.PI/6,x=Math.cos(angle)*outer,y=Math.sin(angle)*outer;i?shape.lineTo(x,y):shape.moveTo(x,y);}
  shape.closePath();
  for(let i=0;i<12;i++){const angle=-i*Math.PI/6,x=Math.cos(angle)*inner,y=Math.sin(angle)*inner;i?hole.lineTo(x,y):hole.moveTo(x,y);}
  hole.closePath();shape.holes.push(hole);
  const rim=new THREE.ExtrudeGeometry(shape,{depth:t-bevel*2,bevelEnabled:!metal,bevelThickness:bevel,bevelSize:bevel,bevelSegments:1,steps:1});rim.translate(0,0,-t/2+bevel);rim.rotateY(Math.PI/2);
  const parts:THREE.BufferGeometry[]=[rim];
  if(!metal){
   for(let i=0;i<2;i++){const spoke=new THREE.BoxGeometry(t*.90,r*.28,r*1.75);spoke.rotateX(i*Math.PI/2);parts.push(spoke);}
   const hub=new THREE.CylinderGeometry(r*.24,r*.24,t+.075*(c.height/1.45),10);hub.rotateZ(Math.PI/2);parts.push(hub);
  }
  const g=merge(parts);g.translate(...p.position);return g;
 }
 if(p.role==='scenery-gate-pull-ring'){
  const g=new THREE.TorusGeometry(p.size[0]/2,p.size[2]/2,5,12);g.scale(1,p.size[1]/p.size[0],1);g.translate(...p.position);return g;
 }
 if(p.kind==='box'&&p.role==='scenery-gate-stile')return buildAncientPiece({...p,role:'ancient-masonry'});
 if(p.role==='scenery-fence-joint-strap'){
  const [w,h,d]=p.size,thickness=h*.014/.208;
  const parts=[
   box([0,(h-thickness)/2,0],[w,thickness,d]),
   box([0,-(h-thickness)/2,0],[w,thickness,d]),
   box([0,0,(d-thickness)/2],[w,h-thickness*2,thickness]),
   box([0,0,-(d-thickness)/2],[w,h-thickness*2,thickness]),
  ];
  const g=merge(parts);g.translate(...p.position);return g;
 }
 if(p.kind==='box'&&(p.role==='scenery-fence-post'||p.role==='scenery-fence-rail'||p.role==='scenery-fence-rear-rail')){
  const g=buildAncientPiece({...p,role:'ancient-masonry'})!;
  if(p.role==='scenery-fence-post'){
   const pos=g.getAttribute('position'),top=p.position[1]+p.size[1]/2;
   for(let i=0;i<pos.count;i++)if(pos.getY(i)>top-.012){
    const chip=(.5+.5*Math.sin(pos.getX(i)*51+pos.getZ(i)*37))*Math.min(.018,p.size[0]*.055);
    pos.setY(i,pos.getY(i)-chip);
   }
   g.computeVertexNormals();
  }
  return g;
 }
 if(p.role==='scenery-fence-rope'){
  const [w,h,d]=p.size,points=[[-w/2+.025,-d/2],[w/2-.025,-d/2],[w/2,-d/2+.025],[w/2,d/2-.025],[w/2-.025,d/2],[-w/2+.025,d/2],[-w/2,d/2-.025],[-w/2,-d/2+.025],[-w/2+.025,-d/2]];
  const curve=new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,Math.sin(x*24+z*17)*h*.10,z))),g=new THREE.TubeGeometry(curve,24,h*.47,5,false);g.translate(...p.position);return g;
 }
 if(p.role==='scenery-ivy')return buildAncientPiece({...p,role:'ancient-ivy'});
 if(p.role==='scenery-moss'){
  const g=new THREE.PlaneGeometry(p.size[0],p.size[2]);g.rotateX(-Math.PI/2);g.translate(...p.position);g.userData.preservePaintUV=true;return g;
 }
 if(p.role==='scenery-basin'){
  const r=p.size[0]/2,h=p.size[1],g=new THREE.LatheGeometry([new THREE.Vector2(r,-h/2),new THREE.Vector2(r,h/2),new THREE.Vector2(r*.82,h/2),new THREE.Vector2(r*.82,-h/2),new THREE.Vector2(r,-h/2)],16);g.translate(...p.position);return g;
 }
 if(p.role==='scenery-basin-water'||p.role.startsWith('scenery-fountain-')){
  const g=new THREE.CylinderGeometry(p.size[0]/2,p.size[0]/2,p.size[1],16);g.translate(...p.position);return g;
 }
 if(p.role==='scenery-root'&&p.end){
  const delta=new THREE.Vector3(...p.end).sub(new THREE.Vector3(...p.position)),g=new THREE.CylinderGeometry(p.size[0]*.27,p.size[0]*.55,delta.length(),7);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize()));g.translate(...new THREE.Vector3(...p.position).add(new THREE.Vector3(...p.end)).multiplyScalar(.5).toArray() as V3);return g;
 }
 if(p.role==='mill-waterwheel'){
  const r=p.size[0]/2,t=p.size[2],parts:THREE.BufferGeometry[]=[];
  for(const side of [-1,1]){const rim=new THREE.TorusGeometry(r,.07,4,16);rim.rotateY(Math.PI/2);rim.translate(side*t/2,0,0);parts.push(rim);}
  for(let i=0;i<8;i++){const spoke=new THREE.BoxGeometry(t,.065,r*1.88);spoke.rotateX(i*Math.PI/8);parts.push(spoke);}
  const hub=new THREE.CylinderGeometry(r*.14,r*.14,t+.10,10);hub.rotateZ(Math.PI/2);parts.push(hub);
  if(p.role==='mill-waterwheel')for(let i=0;i<16;i++){const paddle=new THREE.BoxGeometry(t+.16,.13,.35);paddle.translate(0,r,0);paddle.rotateX(i*Math.PI/8);parts.push(paddle);}
  const g=merge(parts);g.translate(...p.position);return g;
 }
 if(p.role==='smithy-anvil'){
  const shape=new THREE.Shape(),points=[[-.50,-.50],[-.32,-.50],[-.23,.12],[-.50,.12],[-.50,.50],[.32,.50],[.70,.20],[.32,.12],[.23,.12],[.32,-.50]];
  points.forEach(([x,y],i)=>i?shape.lineTo(x*p.size[0],y*p.size[1]):shape.moveTo(x*p.size[0],y*p.size[1]));shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:p.size[2],bevelEnabled:false,steps:1});g.translate(p.position[0],p.position[1],p.position[2]-p.size[2]/2);return g;
 }
 if(p.role==='scenery-path')return pathGeometry(p,c);
 if(p.role.startsWith('scenery-sack')){
  const profile=p.role==='scenery-sack'?[[0,-.5],[.35,-.48],[.48,-.25],[.50,.04],[.40,.35],[.15,.5]]:[[0,-.5],[.5,-.5],[.45,.5],[0,.5]];
  const g=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),10);g.scale(...p.size);g.translate(...p.position);return g;
 }
 if(p.role==='scenery-log'||p.role==='scenery-log-end'){
  return buildCampPiece({...p,role:p.role==='scenery-log'?'camp-firewood':'camp-firewood-end'});
 }
}
