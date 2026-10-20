import * as THREE from 'three';
import {TREE_PRESETS} from '../vegetation/pixelTrees/constants/presets';
import {createGroundProps} from '../vegetation/pixelTrees/services/groundPropGenerator';
import {createProceduralRock} from '../vegetation/pixelTrees/services/rockGenerator';
import {createTree} from '../vegetation/pixelTrees/services/treeGenerator';
import {createSceneLitPixelBarkMaterial,getPixelLeafColorAtlas,resolvePixelTextureParams} from '../vegetation/pixelTrees/services/pixelArtTextureSystem';
import type {TreeConfig} from '../vegetation/pixelTrees/types';
import type {StructureConfig,PieceSpec,StructurePlan} from './types';
import {bendLivingTree} from './treeLean';
import type {StructureResources} from './materials';

/** Original generator keeps ownership of detached asset and its unused presentation resources. */
export function natureAsset(kind:'flowers'|'leaves'|'rock'|'reeds'|'fern',c:StructureConfig,seed:number,flowerTexelsPerMetre?:number,rockSize?:[number,number,number]) {
 if(kind==='reeds'||kind==='fern'){
  const instance=createTree({...TREE_PRESETS[kind==='reeds'?'reed_clump':'fern_plant'],...(kind==='fern'?{trunkHeight:.45}:{}),seed}),group=instance.group.getObjectByName('GroundPlant') as THREE.Group;
  // The structure supplies the water; keep the native plant and its wind/sprite callbacks.
  group.children.filter(child=>child.userData.ground).forEach(child=>child.removeFromParent());
  group.removeFromParent();group.name=kind==='reeds'?'SwampNativeReeds':'MineNativeFern';let disposed=false;
  return {group,update:instance.update,dispose:()=>{if(disposed)return;disposed=true;instance.dispose();}};
 }
 const original=Object.values(TREE_PRESETS).find(p=>kind==='rock'?p.rock?.biome===c.biome&&!p.rock.gravel&&!p.rock.ore:p.prop?.kind===kind&&p.prop.biome===c.biome)!;
 const config:TreeConfig={...original,seed};
 if(kind==='rock')config.rock={...original.rock!,width:rockSize?.[0]??.65,height:rockSize?.[1]??.45,depth:rockSize?.[2]??.55,count:1,mushrooms:false,ore:undefined,gravel:false,moss:c.vegetation*.5,snow:c.snow};
 else config.prop={...original.prop!,count:1,size:kind==='flowers'?.4:.55,spread:.15,density:.2};
 const instance=kind==='rock'?createProceduralRock(config):createGroundProps(config,flowerTexelsPerMetre);
 const group=instance.group.getObjectByName('RockAsset') as THREE.Group;
 group.removeFromParent();let disposed=false;
 return {group,update:instance.update,dispose:()=>{if(disposed)return;disposed=true;instance.dispose();}};
}

/** The game's full tree generator owns its bark, canopy and animation resources. */
export function livingTree(p:PieceSpec,c:StructureConfig,seed:number,resources:StructureResources,plan?:StructurePlan) {
 const species=c.biome==='akkala'?'akkala_birch':c.biome==='korok'?'korok_ancient':c.biome==='satori'?'satori_sakura':'hyrule_oak';
 const original=TREE_PRESETS[species];
 const radius=Math.max(.70,Math.min(1.35,p.size[0]*.15));
 const config:TreeConfig={...original,seed,trunkHeight:p.size[1],trunkRadiusBase:radius,trunkRadiusTop:radius*.38,trunkCurvature:.19,rootSpread:1.05,branchStartHeight:.58,branchLength:original.branchLength*1.08,canopySpread:1.24,crownWidth:1.0,crownHeight:1.05,clusterRadius:(original.clusterRadius??1.45)*.90,patchSpacing:(original.patchSpacing??1)*1.35,showAttractors:false,showApples:false,showMushrooms:false,showFallingLeaves:false,snowCover:c.snow};
 const instance=createTree(config),group=instance.group;
 group.name='LivingTree';group.position.set(...p.position);group.userData.treeSpecies=species;
 const house=plan?.volumes[0],deck=plan?.pieces.find(piece=>piece.role==='tree-platform');
 if(house&&deck){
  const away=new THREE.Vector2(p.position[0]-house.x,p.position[2]-house.z).normalize();
  // Share the gentle lean between the free side of the deck and its rear edge.
  away.y+=.45;away.normalize();
  // Allow the canopy to overlap the roof's silhouette before asking for a stronger lean.
  const tolerance=.65,clearance=Math.max(0,radius-tolerance);
  const slope=THREE.MathUtils.clamp(.22+clearance*.20,.22,.34);
  bendLivingTree(group,{direction:[away.x,away.y],start:deck.position[1]+.3,slope});
 }
 const nativeBark=createSceneLitPixelBarkMaterial(config),bark=nativeBark.material;
 const leafMap=getPixelLeafColorAtlas(config).clone();leafMap.colorSpace=THREE.SRGBColorSpace;leafMap.needsUpdate=true;
 const leaves=new THREE.MeshStandardMaterial({map:leafMap,roughness:1,side:THREE.DoubleSide,alphaTest:config.alphaTest??.5,fog:true});
 const tileRes=resolvePixelTextureParams(config).tileRes;
 // Only select each existing leaf's atlas tile; lighting and fog stay native.
 leaves.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float aAtlasIndex;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
   float inset=.5/${tileRes.toFixed(1)};
   vec2 tileUV=mix(vec2(inset),vec2(1.-inset),uv);
   vMapUv=vec2((tileUV.x+mod(aAtlasIndex,4.))*.25,(tileUV.y+1.-floor(aAtlasIndex/4.))*.5);`);
 };
 leaves.customProgramCacheKey=()=> 'structure-native-tree-leaves-'+tileRes;
 nativeBark.textures.forEach(texture=>resources.textures.add(texture));resources.textures.add(leafMap);resources.materials.add(bark);resources.materials.add(leaves);
 const ground:THREE.Object3D[]=[];
 group.traverse(o=>{if(o.userData.ground||o.name==='GroundMound')ground.push(o);if(o instanceof THREE.InstancedMesh)resources.instances.add(o);});
 ground.forEach(o=>o.removeFromParent());
 group.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return;
  if(o instanceof THREE.InstancedMesh&&o.geometry.getAttribute('aAtlasIndex'))o.material=leaves;
  else if(o.material===instance.barkMaterial){
   o.material=bark;
  }
 });
 let disposed=false;
 return {group,update:instance.update,dispose:()=>{if(disposed)return;disposed=true;instance.dispose();}};
}
