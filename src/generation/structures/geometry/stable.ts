import * as THREE from 'three';
import type {PieceSpec} from '../types';

import {pixelMossNoiseGLSL} from '../../vegetation/pixelTrees/services/mossStyle';
import {ROCK_SNOW_COVERAGE_GLSL} from '../../vegetation/pixelTrees/services/rockSnowStyle';


export function looseHayMaterial(density:number,seed:number,map:THREE.Texture,amount=.7){
 const material=new THREE.MeshStandardMaterial({map,alphaTest:.5,roughness:1});
 material.name='LooseHayBedding';
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute vec2 hayLocalPosition,hayHalfSize;varying vec2 vHayLocal,vHayHalf;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvHayLocal=hayLocalPosition;vHayHalf=hayHalfSize;');
  shader.uniforms.uHaySeed={value:seed};shader.uniforms.uHayAmount={value:amount};
  shader.fragmentShader='uniform float uHaySeed,uHayAmount;varying vec2 vHayLocal,vHayHalf;\n'+pixelMossNoiseGLSL('uHaySeed')+ROCK_SNOW_COVERAGE_GLSL+`
   float hayCoverage(vec2 cell){
    vec2 point=(cell+.5)/${density.toFixed(1)};
    vec2 distances=vHayHalf-abs(point);
    float edge=min(distances.x,distances.y);
    float feather=min(.12,min(vHayHalf.x,vHayHalf.y)*.5);
    float amount=.72*uHayAmount*smoothstep(0.,feather,edge);
    return rockSnowCoverage(vec3(cell.x,0.,cell.y),vec3(0.,1.,0.),amount);
   }
  `+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 hayCell=floor(vHayLocal*${density.toFixed(1)});
   if(hayCoverage(hayCell)<=0.)discard;
   float hayBorder=3.;
   for(int i=1;i<=2;i++){
    float r=float(i);
    if(hayCoverage(hayCell+vec2(r,0.))<=0.||hayCoverage(hayCell-vec2(r,0.))<=0.||hayCoverage(hayCell+vec2(0.,r))<=0.||hayCoverage(hayCell-vec2(0.,r))<=0.)hayBorder=min(hayBorder,r);
   }
   float hayFringe=mnoise3(vec3(hayCell.x,0.,hayCell.y)/3.+173.)*.65+mhash3(vec3(hayCell.x,0.,hayCell.y)+173.)*.35;
   if(hayBorder<2.5){
    float band=(3.-hayBorder)/2.;
    if(hayFringe<band*.12)discard;
    if(hayFringe<band*.54)diffuseColor.rgb*=.63;
    else if(hayFringe<band*.78)diffuseColor.rgb*=.84;
    else diffuseColor.rgb*=1.08;
   }
  `);
 };
 material.customProgramCacheKey=()=>`roof-hay-native-snow-mask-v5-${density}`;
 return material;
}

export function buildStablePiece(p:PieceSpec):THREE.BufferGeometry|undefined{
 if(['stable-straw-bed','stable-yard-straw','stable-trough-hay'].includes(p.role)){
  const [w,,d]=p.size,g=new THREE.PlaneGeometry(w,d);g.rotateX(-Math.PI/2);
  const positions=g.getAttribute('position'),local=new Float32Array(positions.count*2),half=new Float32Array(positions.count*2);
  for(let i=0;i<positions.count;i++){local.set([positions.getX(i),positions.getZ(i)],i*2);half.set([w/2,d/2],i*2);}
  g.setAttribute('hayLocalPosition',new THREE.BufferAttribute(local,2));g.setAttribute('hayHalfSize',new THREE.BufferAttribute(half,2));
  g.translate(...p.position);return g;
 }
 return undefined;
}
