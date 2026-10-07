import * as THREE from 'three';
import { PRNG } from '../math/prng.ts';
import { waterfallWorld } from './waterfallFeatures.ts';
import type { WaterfallFeature } from './waterfallFeatures.ts';

/** Short, opaque-looking foam bursts at the foot, rather than a cloud of mist. */
export function createImpactFoam(f:WaterfallFeature,water:THREE.ShaderMaterial,pixelScale:{value:number}){
 const rng=new PRNG(f.id+'/impact-foam'),positions:number[]=[],motions:number[]=[],params:number[]=[];
 for(let i=0;i<340;i++){
  const p=waterfallWorld(f,(rng.next()-.5)*f.width*1.22,f.radius+.45+rng.next()*.85,.035);
  positions.push(p.x,p.y,p.z);
  const across=(rng.next()-.5)*.7,forward=.1+rng.next()*.6;
  motions.push(across*f.fz+forward*f.fx,.25+Math.pow(rng.next(),1.4)*1.3,-across*f.fx+forward*f.fz);
  params.push(rng.next(),.8+rng.next()*.8,.42+rng.next()*.46,rng.next());
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('motion',new THREE.Float32BufferAttribute(motions,3));
 geometry.setAttribute('params',new THREE.Float32BufferAttribute(params,4));
 geometry.computeBoundingSphere();geometry.boundingSphere!.radius+=3;
 const u=water.uniforms;
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{
  uTime:u.uTime,uResolution:u.uResolution,tDepth:u.tDepth,uFoamColor:u.uFoamColor,
  uFogColor:u.uFogColor,uFogNear:u.uFogNear,uFogFar:u.uFogFar,pixelScale,uTexelDensity:u.uTexelDensity,uNightDim:u.uNightDim
 },vertexShader:`
 attribute vec3 motion;attribute vec4 params;
 uniform float uTime,pixelScale;
 varying float opacity,seed,dist,sizeM;
 void main(){
  float age=fract(uTime/params.y+params.x);
  sizeM=params.z*(.8+age*.9);
  float t=age*params.y;
  vec3 p=position+motion*t;
  p.y=position.y+sin(age*3.14159265)*motion.y;
  opacity=smoothstep(0.,.12,age)*(1.-smoothstep(.55,1.,age))*.9;
  seed=params.w;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  dist=length(mv.xyz);gl_Position=projectionMatrix*mv;
  float perspective=projectionMatrix[3][3]>.5?1.:max(.1,-mv.z);
  gl_PointSize=clamp(params.z*(.8+age*.9)*pixelScale*projectionMatrix[1][1]/perspective,1.,90.);
 }`,fragmentShader:`
 uniform sampler2D tDepth;uniform vec2 uResolution;
 uniform vec3 uFoamColor,uFogColor;uniform float uFogNear,uFogFar,uTexelDensity,uNightDim;
 varying float opacity,seed,dist,sizeM;
 void main(){
  if(gl_FragCoord.z>texture2D(tDepth,gl_FragCoord.xy/uResolution).r+.00001)discard;
  // Seis blocos duros por sprite, com silhueta em tufos.
  vec2 q=(floor(gl_PointCoord*6.)+.5)/6.-.5;
  float body=length(q*vec2(1.,1.15));
  float lobes=max(.31-length(q-vec2(-.17,-.06)),.28-length(q-vec2(.16,.08)));
  if(body>.4&&lobes<0.)discard;
  // Sombreado em 3 tons duros (o topo recebe a luz): branco em cima, espuma no meio e azul-claro embaixo;
  // o dither por bloco quebra a divisa entre os tons, e a borda da silhueta puxa para o azul.
  vec2 cell=floor(gl_PointCoord*6.);
  float jitter=fract(sin(dot(cell+seed*7.,vec2(12.9,78.2)))*43758.5453)-.5;
  float lit=-q.y*1.5+jitter*.3;
  vec3 color=mix(uFoamColor,vec3(.88,.96,.98),step(.22,q.y+seed*.12)*.18);
  color*=mix(vec3(0.15,0.21,0.36),vec3(1.0),uNightDim);
  color=mix(color,uFogColor,smoothstep(uFogNear,uFogFar,dist));
  if(opacity<.02)discard;
  gl_FragColor=vec4(color,opacity);
 }`});
 const points=new THREE.Points(geometry,material);points.name='cascade_impact_foam';points.renderOrder=4;
 return points;
}
