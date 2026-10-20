import * as THREE from 'three';
import type {PieceSpec,StructureConfig} from '../types';
import type {StructureResources} from '../materials';
import {pixelMossNoiseGLSL} from '../../vegetation/pixelTrees/services/mossStyle';
import {rockSnowColors,ROCK_SNOW_PAINT_GLSL} from '../../vegetation/pixelTrees/services/rockSnowStyle';
import {structureRockSnowStyle} from '../snowStyle';

/** Ice hanging below the eaves; roof snow is painted on the original tiles. */
export function buildSnowyPiece(p:PieceSpec):THREE.BufferGeometry|undefined{
 if(p.role==='snowy-icicle'){
  const g=new THREE.ConeGeometry(p.size[0]/2,p.size[1],5);g.rotateZ(Math.PI);g.translate(...p.position);return g;
 }
 return undefined;
}

export function snowySnowMaterial(c:StructureConfig,seed:number,resources:StructureResources){
 const material=new THREE.MeshStandardMaterial({roughness:1,side:THREE.DoubleSide});
 const style=structureRockSnowStyle(c);
 material.onBeforeCompile=shader=>{
  shader.uniforms.uSnowColors={value:rockSnowColors(true)};
  shader.uniforms.uSnowDensity={value:style.density};shader.uniforms.uSnowLightDir={value:style.lightDir};shader.uniforms.uSnowSeed={value:seed};
  shader.vertexShader='varying vec3 vSnowWorldPos,vSnowWorldNormal;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSnowWorldPos=(modelMatrix*vec4(position,1.)).xyz;vSnowWorldNormal=mat3(modelMatrix)*normal;');
  shader.fragmentShader='uniform vec3 uSnowColors[4],uSnowLightDir;uniform float uSnowDensity,uSnowSeed;varying vec3 vSnowWorldPos,vSnowWorldNormal;\n'+pixelMossNoiseGLSL('uSnowSeed')+ROCK_SNOW_PAINT_GLSL+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=rockSnowColor(floor(vSnowWorldPos*uSnowDensity)+.5,vSnowWorldNormal,uSnowLightDir);');
 };
 material.customProgramCacheKey=()=> 'rock-snow-structure-v1';
 resources.materials.add(material);return material;
}
