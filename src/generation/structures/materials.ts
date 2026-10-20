import * as THREE from 'three';
import type {StructureConfig,SurfaceMaterial} from './types';
import {pixelMossNoiseGLSL} from '../vegetation/pixelTrees/services/mossStyle';
import {buildPixelMossRamp} from '../vegetation/pixelTrees/services/pixelArtTextureSystem';
import {paintSurface} from './surfacePainting';
import {bridgeWaterTexture} from './geometry/bridge';
import {rockSnowColors,ROCK_SNOW_PAINT_GLSL,ROCK_SNOW_COVERAGE_GLSL,ROCK_SNOW_RIM_GLSL} from '../vegetation/pixelTrees/services/rockSnowStyle';
import {structureRockSnowStyle} from './snowStyle';

export class StructureResources {
 geometries=new Set<THREE.BufferGeometry>();materials=new Set<THREE.Material>();
 textures=new Set<THREE.Texture>();instances=new Set<THREE.InstancedMesh>();private disposed=false;
 dispose=()=>{if(this.disposed)return;this.disposed=true;this.instances.forEach(mesh=>mesh.dispose());this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());};
}

export function createStructureMaterials(c:StructureConfig,resources:StructureResources,seed=0){
 const snowStyle=structureRockSnowStyle(c);
 const mossSteps=6,mossData=new Uint8Array(mossSteps*4);
 buildPixelMossRamp(mossSteps).forEach((rgb,i)=>mossData.set([...rgb,255],i*4));
 const mossPalette=new THREE.DataTexture(mossData,mossSteps,1);
 mossPalette.colorSpace=THREE.SRGBColorSpace;
 mossPalette.magFilter=mossPalette.minFilter=THREE.NearestFilter;
 mossPalette.generateMipmaps=false;mossPalette.needsUpdate=true;resources.textures.add(mossPalette);
 const colors:Record<SurfaceMaterial,string>={wood:c.palette.wood,stone:c.palette.stone,plaster:c.palette.plaster,roof:c.palette.roof,thatch:(c.type==='bridge'||c.type==='dock'||c.type==='outpost')?'#b49b65':'#c59138',metal:'#687681',cloth:c.type==='outpost'?'#ffd071':(c.type==='watchtower'||c.type==='ruinedTower'||c.type==='lighthouse')?'#ffd071':c.type==='treehouse'?'#ffc561':c.type==='windmill'?'#ead3a0':c.type==='fortress'?'#a93840':'#b97a58',dark:c.type==='windmill'?'#24435a':'#1f2830',earth:'#978568',water:c.type==='swamp'?'#426756':'#3c858f'};
 const result={} as Record<SurfaceMaterial,THREE.MeshStandardMaterial>;
 for(const [name,color] of Object.entries(colors)){
  const kind=name as SurfaceMaterial,map=kind==='water'&&(c.type==='bridge'||c.type==='dock'||c.type==='outpost')?bridgeWaterTexture(c.texelsPerMetre,seed):paintSurface(kind,color,c.texelsPerMetre,seed,c.finish,false,kind==='metal');resources.textures.add(map);
  const mossAffinity=kind==='stone'?1:kind==='wood'?.45:kind==='plaster'?.16:0;
  const mossHeight=kind==='stone'?1.8:kind==='wood'?1.1:.65;
  const material=new THREE.MeshStandardMaterial({color:'#ffffff',map,roughness:kind==='metal'?.65:1,metalness:kind==='metal'?.15:0,side:kind==='cloth'?THREE.DoubleSide:THREE.FrontSide});
  if(kind==='cloth'&&(c.type==='treehouse'||c.type==='watchtower'||c.type==='ruinedTower'||c.type==='lighthouse')){material.emissive.set('#ffad38');material.emissiveIntensity=.65;}
  material.userData.pixelDensity=c.texelsPerMetre;
  material.onBeforeCompile=shader=>{
   if(kind==='metal'){
    shader.vertexShader='attribute vec3 ironLocalPosition,ironHalfSize;varying vec3 vIronLocal,vIronHalf;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvIronLocal=ironLocalPosition;vIronHalf=ironHalfSize;');
    shader.fragmentShader='varying vec3 vIronLocal,vIronHalf;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
     vec3 ironDistances=max(vIronHalf-abs(vIronLocal),vec3(0.));
     float ironEdge=min(max(ironDistances.x,ironDistances.y),min(max(ironDistances.x,ironDistances.z),max(ironDistances.y,ironDistances.z)));
     vec3 ironCell=floor(vIronLocal*${c.texelsPerMetre.toFixed(1)});
     float ironChip=fract(sin(dot(ironCell,vec3(12.9898,78.233,37.719)))*43758.5453);
     float ironFacet=fract(sin(dot(floor(ironCell/3.),vec3(41.71,17.31,63.29)))*29371.37);
     diffuseColor.rgb*=.96+ironFacet*.08;
     if(ironChip<.022)diffuseColor.rgb*=.84;
     else if(ironChip>.985)diffuseColor.rgb*=1.10;
     float ironWear=(1.-step(.018+ironChip*.013,ironEdge))*(ironChip>.14?.36:.12);
     diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.28,.34,.38),ironWear);
    `);
   }
   shader.uniforms.uPixelDensity={value:c.texelsPerMetre};// a curve, not a straight line: a low slider gives a light dusting, only the top of it covers stone
   shader.uniforms.uStructureMoss={value:Math.pow(c.vegetation,1.9)*mossAffinity};
   shader.uniforms.uStructureMossHeight={value:mossHeight};
   shader.uniforms.uStructureMossPalette={value:mossPalette};
   shader.uniforms.uStructureSnow={value:kind==='water'?0:c.snow};shader.uniforms.uStructureSeed={value:seed};
   shader.uniforms.uSnowColors={value:rockSnowColors(true)};
   shader.uniforms.uSnowDensity={value:snowStyle.density};shader.uniforms.uSnowLightDir={value:snowStyle.lightDir};
   shader.vertexShader='varying vec3 vStructurePos;varying vec3 vStructureNormal;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvStructurePos=position;vStructureNormal=normal;');
   shader.fragmentShader='uniform vec3 uSnowColors[4],uSnowLightDir;uniform float uSnowDensity,uPixelDensity,uStructureMoss,uStructureMossHeight,uStructureSnow,uStructureSeed;uniform sampler2D uStructureMossPalette;varying vec3 vStructurePos;varying vec3 vStructureNormal;\n'+pixelMossNoiseGLSL('uStructureSeed')+ROCK_SNOW_PAINT_GLSL+ROCK_SNOW_COVERAGE_GLSL+ROCK_SNOW_RIM_GLSL+shader.fragmentShader;
   if(kind==='thatch'){
    shader.vertexShader='attribute float thatchLayer;varying float vThatchLayer;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvThatchLayer=thatchLayer;');
    shader.fragmentShader='varying float vThatchLayer;\n'+shader.fragmentShader;
   }
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec3 cell=floor(vStructurePos*uPixelDensity)+.5;
    ${kind==='thatch'?`if(vThatchLayer>.92+(mhash3(cell)-.5)*.035)diffuseColor.rgb*=.72;`:''}
    vec3 mossN=normalize(vStructureNormal);
    float damp=clamp(dot(mossN,vec3(0.,.25,-.95)),0.,1.);
    float up=clamp(mossN.y,0.,1.);
    float weather=1.-smoothstep(.15,uStructureMossHeight,vStructurePos.y);
    float groove=1.-smoothstep(.015,.12,abs(mnoise3(cell/8.+57.)-.5));
    float mossGroove=.35+groove*.65;
    float mossWant=min(.5,((.1+damp*.45+up*.2)*1.6+groove*.15)*uStructureMoss*weather)
      *(.55+mossGroove*.9);
    if(mossWant>.04&&mossField(cell)<mossWant){
     float N1=5.,qs=N1/5.;
     float ndl=dot(mossN,normalize(vec3(-.5,.8,-.6)));
     float mi=N1*.35+(ndl>.15?qs*.8:-qs*.6)
       +(mnoise3(cell/3.+41.)-.5)*qs*1.6+(.5-mossGroove)*qs*2.4;
     if(mossField(cell+vec3(0.,1.,0.))>=mossWant)mi+=qs;
     if(mossField(cell-vec3(0.,1.,0.))>=mossWant)mi-=qs*1.2;
     float idx=clamp(floor(mi+.5),0.,N1);
     diffuseColor.rgb=texture2D(uStructureMossPalette,vec2((idx+.5)/6.,.5)).rgb;
    }
    if(vStructureNormal.y>.35&&uStructureSnow>0.){
     ${kind==='roof'&&c.type==='snowy'?`
      vec3 snowN=normalize(vStructureNormal);
      vec3 snowDown=vec3(0.,-1.,0.)+snowN*snowN.y;
      if(dot(snowDown,snowDown)<.0001)snowDown=vec3(0.,0.,1.);
      snowDown=normalize(snowDown);
      vec3 snowAcross=normalize(cross(snowN,snowDown));
      diffuseColor.rgb=rockSnowSurface(diffuseColor.rgb,floor(vStructurePos*uSnowDensity)+.5,snowN,snowDown,vec3(0.),snowAcross,vec3(0.),uSnowLightDir,uStructureSnow,1.);
     `:`float sn=step(1.-uStructureSnow,mossField(cell+73.));diffuseColor.rgb=mix(diffuseColor.rgb,rockSnowColor(floor(vStructurePos*uSnowDensity)+.5,vStructureNormal,uSnowLightDir),sn);`}
    }
   `);
  };
  material.customProgramCacheKey=()=>kind+'_painted-rock-snow-v3'+(kind==='roof'&&c.type==='snowy'?'_flat-snow-rim':'')+(kind==='metal'?'_barrel-iron-bridge-v3':'');resources.materials.add(material);result[kind]=material;
 }
 if((c.type==='bridge'||c.type==='dock'||c.type==='outpost')){
  result.metal.roughness=.65;result.metal.metalness=.15;
  result.dark.map=result.metal.map;result.dark.color.set('#aaa69d');
  result.dark.roughness=.9;result.dark.metalness=.20;
 }
 return result;
}
