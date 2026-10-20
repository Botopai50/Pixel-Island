import * as THREE from 'three';
import type {PieceSpec} from '../types';
import {extrudePolygon,merge} from './common';
import {TREE_PRESETS} from '../../vegetation/pixelTrees/constants/presets';
import {createPixelEndGrainMaterial} from '../../vegetation/pixelTrees/services/endGrainMaterial';
import {resolvePixelTextureParams,createPixelBarkMaterial} from '../../vegetation/pixelTrees/services/pixelArtTextureSystem';
import {surfaceColorRamp} from '../surfacePainting';

export function buildCampPiece(p:PieceSpec):THREE.BufferGeometry|undefined{
 const [w,h]=p.size;
 let g:THREE.BufferGeometry;
 if(p.role==='camp-entry-flaps'){
  // Two folded wings leave a triangular, physically open entrance.
  g=merge([-1,1].map(side=>extrudePolygon([[side*w/2,0],[0,h],[side*w*.23,h*.20],[side*w*.31,0]],p.size[2])));
 }else if(p.role==='camp-back-canvas')g=extrudePolygon([[-w/2,0],[w/2,0],[0,h]],p.size[2]);
 else if(p.role==='camp-hearth-ground'){
  g=new THREE.PlaneGeometry(w,p.size[2]);g.rotateX(-Math.PI/2);g.translate(0,h/2,0);
  g.userData.preservePaintUV=true;
 }
 else if(p.role==='camp-kettle'){
  const r=w/2;
  g=new THREE.LatheGeometry([
   new THREE.Vector2(0,-h/2),new THREE.Vector2(r*.60,-h/2),new THREE.Vector2(r*.83,-h*.35),
   new THREE.Vector2(r,-h*.05),new THREE.Vector2(r*.96,h*.32),
   new THREE.Vector2(r*1.025,h*.34),new THREE.Vector2(r*1.025,h/2),
   new THREE.Vector2(r*.84,h/2),new THREE.Vector2(r*.84,h*.32),
   new THREE.Vector2(r*.80,-h*.13),new THREE.Vector2(0,-h*.25)],14);
  // Keep the iron texture continuous around the rounded pot.
  const uv=g.getAttribute('uv'),positions=g.getAttribute('position');
  for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*Math.PI*w,positions.getY(i)+h/2);
  g.userData.preservePaintUV=true;
 }else if(p.role==='camp-kettle-handle'){
  g=new THREE.TorusGeometry(w/2,.035,4,12,Math.PI);g.translate(0,-h/2,0);
  const uv=g.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*Math.PI*w/2,uv.getY(i)*Math.PI*.07);
  g.userData.preservePaintUV=true;
 }else if(p.role==='camp-barrel-hoop'){
  const r=w/2;
  g=new THREE.LatheGeometry([new THREE.Vector2(r*.96,-h/2),new THREE.Vector2(r,-h/2),new THREE.Vector2(r,h/2),new THREE.Vector2(r*.96,h/2),new THREE.Vector2(r*.96,-h/2)],12);
 }else if(p.role==='camp-flame')g=new THREE.ConeGeometry(w/2,h,5);
 else if(p.role.startsWith('camp-bedroll')){
  g=new THREE.CylinderGeometry(p.size[1]/2,p.size[1]/2,w,10);g.rotateZ(Math.PI/2);
  if(p.rotation?.[1])g.rotateY(p.rotation[1]);
 }else if(p.kind==='column'&&p.role.startsWith('camp-')){
  const horizontal=p.rotation!==undefined;
  g=new THREE.CylinderGeometry(w*.48,w*.53,h,10);
  if(['camp-burning-log','camp-stump','camp-firewood','camp-fallen-log'].includes(p.role)){
   const positions=g.getAttribute('position'),wood=new Float32Array(positions.count*3),angle=new Float32Array(positions.count*2);
   for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i),radius=Math.hypot(x,z),a=Math.atan2(z,x);
    wood.set([Math.max(.02,radius),positions.getY(i)+h/2,w*.505],i*3);
    angle.set([Math.cos(a),Math.sin(a)],i*2);
   }
   g.setAttribute('aWood',new THREE.BufferAttribute(wood,3));g.setAttribute('aBarkAngle',new THREE.BufferAttribute(angle,2));
   g.userData.preservePaintUV=true;
  }
  if(horizontal)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation!)));
 }else return;
 if(['camp-entry-flaps','camp-back-canvas'].includes(p.role)&&p.rotation?.[1])g.rotateY(p.rotation[1]);
 if(['camp-stump-end','camp-firewood-end','camp-log-end','camp-burning-log-end'].includes(p.role)){
  g.userData.preservePaintUV=true;
  g.setAttribute('aGrainR',new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(w/2),1));
 }
 g.translate(...p.position);return g;
}

/** Static camp wood uses the same scene fog as the surrounding standard materials. */
function enableCampWoodFog(material:THREE.ShaderMaterial){
 material.fog=true;
 material.uniforms={...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),...material.uniforms};
 material.vertexShader='#include <fog_pars_vertex>\n'+material.vertexShader.replace(/}\s*$/,`
  #ifdef USE_FOG
   vFogDepth = -(viewMatrix * modelMatrix * vec4(position, 1.0)).z;
  #endif
 }`);
 material.fragmentShader='#include <fog_pars_fragment>\n'+material.fragmentShader.replace(/}\s*$/,`\n #include <fog_fragment>\n }`);
}

/** Tree bark keeps its drawing, while only its colours follow the camp barrel. */
export function campCutWoodMaterial(density:number,seed:number,woodColor='#855b3e'){
 const config={...TREE_PRESETS.hyrule_oak,seed,barkColor:woodColor,mossAmount:0,snowCover:0};
 const params=resolvePixelTextureParams(config);
 // The bark shader displays its palette directly; compensate for the warmer,
 // darker appearance of the barrel's lit standard material.
 const ramp=surfaceColorRamp(woodColor).map((rgb,i)=>[
  Math.round(rgb[0]*.92),Math.round(rgb[1]*.88),Math.round(Math.max(0,rgb[2]-(i<3?9:0))*.80),
 ]);
 const colors=new Uint8Array(ramp.length*2*4);
 for(let row=0;row<2;row++)ramp.forEach((rgb,i)=>colors.set([...rgb,255],(row*ramp.length+i)*4));
 const palette=new THREE.DataTexture(colors,ramp.length,2),structure=new THREE.DataTexture(new Uint8Array([128,0,0,255]),1,1);
 for(const texture of [palette,structure]){texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.needsUpdate=true;}
 const bark=createPixelBarkMaterial(config,{uTime:{value:0},uWindStrength:{value:0},uWindSpeed:{value:0}},{structure,palette,steps:ramp.length,params});
 bark.uniforms.uTexelsPerMetre.value=density;bark.uniforms.uTexelsPerLobe.value=8;bark.uniforms.uBarkDarkCoverage.value=.75;
 const end=createPixelEndGrainMaterial(config);end.material.uniforms.uTexelsPerMetre.value=density;
 end.material.uniforms.uCompactCuts.value=1;
 enableCampWoodFog(bark);enableCampWoodFog(end.material);
 for(const texture of [end.palette as THREE.DataTexture]){
  const data=texture.image.data;
  for(let i=0;i<data.length;i+=4){
   const grey=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
   for(let channel=0;channel<3;channel++)data[i+channel]=Math.round(data[i+channel]*.75+grey*.25);
  }
  texture.needsUpdate=true;
 }
 return {bark,end:end.material,textures:[palette,structure,end.palette]};
}

/** One texture pixel per world texel, including the irregular dirt outline. */
export function campHearthTexture(width:number,depth:number,density:number,seed:number){
 const columns=Math.max(2,Math.round(width*density)),rows=Math.max(2,Math.round(depth*density));
 const data=new Uint8Array(columns*rows*4);
 const noise=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7+seed*.37)*43758.5453;return n-Math.floor(n);};
 const palette=[[63,54,44],[80,66,50],[98,78,55],[118,95,65],[138,112,78],[156,128,89]];
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  const xx=(x+.5)/columns-.5,zz=(y+.5)/rows-.5,r=Math.hypot(xx,zz),angle=Math.atan2(zz,xx);
  const edge=.44+Math.sin(angle*5+seed)*.024+Math.sin(angle*9-seed)*.018;
  const patch=noise(Math.floor(x/3),Math.floor(y/3)),pixel=noise(x,y);
  const outside=r>edge||(r>edge-.025&&pixel<.25);
  let tone=r<.19?1:r<.29?2:3;
  if(patch>.72)tone++;else if(patch<.16)tone--;
  if(pixel>.94)tone++;else if(pixel<.06)tone--;
  data.set([...palette[Math.max(0,Math.min(5,tone))],outside?0:255],(y*columns+x)*4);
 }
 const map=new THREE.DataTexture(data,columns,rows);map.name='CampHearthWorldPixels';map.colorSpace=THREE.SRGBColorSpace;
 map.magFilter=map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}

export function campCanvasTexture(density:number,seed:number){
 const size=Math.max(2,Math.round(density*2.4)),data=new Uint8Array(size*size*4);
 const noise=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7+seed)*43758.5453;return n-Math.floor(n);};
 const palette=[[183,163,126],[204,183,144],[222,202,164],[237,219,183],[245,230,199]];
 const folds=Array.from({length:4},(_,i)=>({
  x:Math.round(size*(i+.25+noise(i,1)*.45)/4),phase:noise(i,3)*Math.PI*2,
 }));
 const seamY=Math.round(size*.58),stitchStep=Math.max(3,Math.round(density*.15));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  // Mostly clean linen; only a few stepped creases interrupt the light canvas.
  const patch=noise(Math.floor(x/3),Math.floor(y/4));
  let tone=3;
  for(let i=0;i<folds.length;i++){
   const fold=folds[i],band=Math.floor(y/4);
   const center=fold.x+Math.round(Math.sin(band*.22+fold.phase));
   const delta=((x-center+size/2)%size+size)%size-size/2,run=noise(i+70,Math.floor(y/7));
   if(delta===0&&run>.12)tone=2;
   else if(delta===-1&&run>.72)tone=2;
   else if(delta===1&&run>.4)tone=4;
  }
  const edge=Math.min(y,size-1-y);
  if(edge<1+Math.floor(noise(Math.floor(x/3),90)*2))tone=1;
  else if(edge<Math.max(2,Math.round(density*.06))&&patch<.35)tone=2;
  if(y===seamY)tone=1;
  if(Math.abs(y-seamY)===1&&x%stitchStep===0)tone=0;
  if(y===seamY+1&&x%stitchStep===1)tone=4;
  data.set([...palette[tone],255],(y*size+x)*4);
 }
 const map=new THREE.DataTexture(data,size,size);map.colorSpace=THREE.SRGBColorSpace;map.magFilter=map.minFilter=THREE.NearestFilter;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(1/2.4,1/2.4);map.needsUpdate=true;return map;
}

/** Irregular hammered iron facets and small, warm worn edges. */
export function campKettleTexture(density:number,seed:number){
 const size=Math.max(8,Math.round(density)),data=new Uint8Array(size*size*4);
 const palette=[[47,49,51],[59,62,64],[72,75,77],[86,88,87],[119,115,105]];
 const hash=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7+seed)*43758.5453;return n-Math.floor(n);};
 const cells=8,sites=Array.from({length:cells*cells},(_,i)=>({
  x:(i%cells+hash(i,1))/cells,y:(Math.floor(i/cells)+hash(i,2))/cells,
  tone:hash(i,3)<.20?1:hash(i,3)>.82?3:2,
 }));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let nearest=Infinity,tone=2;
  for(const site of sites){
   const dx=Math.min(Math.abs((x+.5)/size-site.x),1-Math.abs((x+.5)/size-site.x));
   const dy=Math.min(Math.abs((y+.5)/size-site.y),1-Math.abs((y+.5)/size-site.y));
   const distance=dx*dx+dy*dy;
   if(distance<nearest){nearest=distance;tone=site.tone;}
  }
  const mark=hash(Math.floor(x/2)+31,Math.floor(y/2)+72);
  if(mark>.955&&((x+y)%3!==0))tone=4;
  else if(mark<.018&&x%2===0)tone=0;
  data.set([...palette[tone],255],(y*size+x)*4);
 }
 const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;
 texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;
 texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.needsUpdate=true;return texture;
}
