import * as THREE from 'three';
import type {PieceSpec,StructureConfig} from '../types';
import type {StructureResources} from '../materials';
import {createIvyLeafSurface} from '../ivySurface';
import {merge,box} from './common';
import {paintSurface} from '../surfacePainting';
import {cultivatedSoilTexture,vegetableLeafTexture,cabbageGeometry,carrotFoliageGeometry,leafyCropGeometry,carrotRootGeometry,carrotRootTexture} from './vegetables';

export function farmMaterials(c:StructureConfig,resources:StructureResources,seed:number){
 const result=new Map<string,THREE.Material>(),leaf=createIvyLeafSurface(Math.max(8,Math.round(c.texelsPerMetre*.4)));
 leaf.material.name='FarmWindowLeaves';leaf.geometry.dispose();resources.materials.add(leaf.material);resources.textures.add(leaf.texture);result.set('farm-window-flowers',leaf.material);
 for(const [role,kind] of [['farm-cabbage','cabbage'],['farm-carrot-leaves','carrot'],['farm-leafy-crop','leafy']] as const){
  const map=vegetableLeafTexture(kind,c.texelsPerMetre),material=new THREE.MeshStandardMaterial({map,side:THREE.DoubleSide,roughness:1});
  material.name='FarmVegetable_'+kind;resources.textures.add(map);resources.materials.add(material);result.set(role,material);
 }
 const soilMap=cultivatedSoilTexture(c.texelsPerMetre,seed),soil=new THREE.MeshStandardMaterial({map:soilMap,roughness:1});
 soil.name='FarmCultivatedSoil';resources.textures.add(soilMap);resources.materials.add(soil);result.set('farm-crop-soil',soil);
 const root=new THREE.MeshStandardMaterial({map:carrotRootTexture(c.texelsPerMetre,seed),roughness:1,flatShading:true});
 root.name='FarmCarrot';resources.materials.add(root);resources.textures.add(root.map!);result.set('farm-carrot-root',root);
 const flowers=new THREE.MeshStandardMaterial({map:paintSurface('plaster','#f0e9c4',c.texelsPerMetre,seed,c.finish),roughness:1});
 flowers.name='FarmFlowers';resources.materials.add(flowers);resources.textures.add(flowers.map!);result.set('farm-window-blossoms',flowers);
 return result;
}

export function buildFarmPiece(p:PieceSpec):THREE.BufferGeometry|undefined{
 if(p.role==='farm-ridge-bundle'){
  const g=new THREE.CylinderGeometry(p.size[0]/2,p.size[0]/2,p.size[2],10);g.rotateX(Math.PI/2);g.translate(...p.position);return g;
 }
 if(p.role==='farm-ridge-binding'){
  const g=new THREE.TorusGeometry(p.size[0],p.size[1],4,10);g.translate(...p.position);return g;
 }
 if(p.role==='farm-path'){
  const [w,,d]=p.size,shape=new THREE.Shape(),horizontal=w>d,length=horizontal?w:d,width=horizontal?d:w;
  const points:THREE.Vector2[]=[];
  for(const side of [-1,1])for(let i=0;i<=12;i++){
   const at=(side<0?i:12-i)/12,along=(at-.5)*length,edge=side*width*(.42+.08*Math.sin(i*2.6+Number(p.id.slice(6))));
   points.push(new THREE.Vector2(horizontal?along:edge,horizontal?edge:along));
  }
  points.forEach((v,i)=>i?shape.lineTo(v.x,v.y):shape.moveTo(v.x,v.y));shape.closePath();
  const g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);g.translate(...p.position);return g;
 }
 if(p.role==='farm-carrot-root'){
  const g=carrotRootGeometry();g.scale(...p.size);g.translate(...p.position);return g;
 }
 if(p.role==='farm-window-blossoms'){
  const parts:THREE.BufferGeometry[]=[];
  for(let i=0;i<7;i++){
   const x=(i/6-.5)*.82,z=Math.sin(i*5.4)*.28,y=.55+Math.sin(i*3.2)*.22;
   for(const [xx,zz] of [[0,0],[-.05,0],[.05,0],[0,-.08],[0,.08]])parts.push(box([x+xx,y,z+zz],[.07,.06,.10]));
  }
  const g=merge(parts);g.scale(...p.size);if(p.rotation)g.rotateY(p.rotation[1]);g.translate(...p.position);return g;
 }
 let crop:THREE.BufferGeometry|undefined;
 if(p.role==='farm-cabbage')crop=cabbageGeometry();
 else if(p.role==='farm-carrot-leaves')crop=carrotFoliageGeometry();
 else if(p.role==='farm-leafy-crop')crop=leafyCropGeometry();
 else if(p.role==='farm-window-flowers'){
  const source=createIvyLeafSurface(12),parts:THREE.BufferGeometry[]=[];
  for(let i=0;i<8;i++){
   const blade=source.geometry.clone();blade.scale(.6,.75,1);blade.rotateX(-.45-(i%4)*.22);blade.rotateY(i*2.399);blade.translate((i/7-.5)*.75,0,Math.sin(i*4.7)*.16);parts.push(blade);
  }
  source.geometry.dispose();source.material.dispose();source.texture.dispose();crop=merge(parts);
 }
 if(!crop)return;
 crop.userData.preservePaintUV=true;
 if(p.role!=='farm-window-flowers')crop.rotateY(Number(p.id.slice(6))*2.399);
 crop.scale(...p.size);if(p.rotation)crop.rotateY(p.rotation[1]);crop.translate(...p.position);return crop;
}
