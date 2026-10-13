// @ts-nocheck
import * as THREE from 'three';

/** Shared by rock snow and structural snow. Standard materials consume linear colors. */
export function rockSnowColors(linear=false){
 return ['#354a65','#a6b5c5','#d1d7de','#e6e9ed'].map(hex=>{
  const color=new THREE.Color(hex);if(!linear)color.convertLinearToSRGB();
  return new THREE.Vector3(color.r,color.g,color.b);
 });
}

/** Uses the shared moss noise functions; all marks are evaluated on surface texels. */
export const ROCK_SNOW_PAINT_GLSL=/* glsl */ `
 vec3 rockSnowColor(vec3 surfaceP,vec3 surfaceN,vec3 lightDir){
  float snowLight=dot(normalize(surfaceN),normalize(lightDir));
  float pigment=mnoise3(surfaceP/9.0+137.0);
  float speckle=mhash3(floor(surfaceP)+151.0);
  vec3 color=uSnowColors[2];
  if(pigment<0.38||snowLight<-0.1)color=uSnowColors[1];
  if(pigment>0.65&&snowLight>0.25)color=uSnowColors[3];
  if(speckle<0.12&&pigment<0.57)color=uSnowColors[1];
  if(speckle>0.88&&pigment<0.44)color=uSnowColors[2];
  return color;
 }
`;

export const ROCK_SNOW_COVERAGE_GLSL=/* glsl */ `
 float rockSnowCoverage(vec3 p,vec3 normal,float snow){
  float field=mnoise3(p/16.0+91.0)*0.78+mnoise3(p/5.0+113.0)*0.17+mhash3(floor(p)+71.0)*0.05;
  return min(0.94,snow*(0.32+max(0.0,normalize(normal).y)*0.9))-field;
 }
`;

/** The same broken two-texel fringe and contact shadow on rocks and roofs. */
export const ROCK_SNOW_RIM_GLSL=/* glsl */ `
 vec3 rockSnowSurface(vec3 exposedColor,vec3 p,vec3 n,vec3 down,vec3 downN,vec3 across,vec3 acrossN,vec3 lightDir,float snow,float rim){
  if(snow<=0.0)return exposedColor;
  float snowMask=rockSnowCoverage(p,n,snow);
  float belowSnow=rockSnowCoverage(p+down,n+downN,snow);
  float belowSnow2=rockSnowCoverage(p+down*2.0,n+downN*2.0,snow);
  float aboveSnow=rockSnowCoverage(p-down,n-downN,snow);
  bool onSnow=snowMask>0.0;
  float borderDistance=3.0;
  for(int i=1;i<=2;i++){
   float r=float(i);
   bool below=rockSnowCoverage(p+down*r,n+downN*r,snow)>0.0;
   bool above=rockSnowCoverage(p-down*r,n-downN*r,snow)>0.0;
   bool left=rockSnowCoverage(p-across*r,n-acrossN*r,snow)>0.0;
   bool right=rockSnowCoverage(p+across*r,n+acrossN*r,snow)>0.0;
   if(below!=onSnow||above!=onSnow||left!=onSnow||right!=onSnow)borderDistance=min(borderDistance,r);
  }
  float fringe=mnoise3(p/3.0+173.0)*0.65+mhash3(floor(p)+173.0)*0.35;
  vec3 color=exposedColor;
  if(onSnow){
   float snowLight=dot(n,normalize(lightDir));
   bool lowerRim=belowSnow<=0.0||belowSnow2<=0.0;
   bool upperRim=aboveSnow<=0.0;
   color=rockSnowColor(p,n,lightDir);
   if(rim>0.5&&borderDistance<2.5){
    float band=(3.0-borderDistance)/2.0;
    if(fringe<band*0.12)color=exposedColor;
    else if(fringe<band*(lowerRim?0.54:0.38))color=uSnowColors[0];
    else if(fringe<band*0.78)color=uSnowColors[1];
    else if(upperRim&&snowLight>0.1)color=uSnowColors[3];
   }
  }else if(rim>0.5&&borderDistance<2.5){
   float band=(3.0-borderDistance)/2.0;
   if(fringe<band*0.18)color=uSnowColors[2];
   else if(fringe<band*0.3)color=uSnowColors[1];
   else if(fringe<band*(aboveSnow>0.0?0.62:0.43))color=mix(exposedColor,uSnowColors[0]*0.75,0.8);
  }
  return color;
 }
`;
