const fs=require('fs');

function extract(source,label){
  const re=new RegExp('const\\s+'+label+'\\s*=\\s*\\/\\*\\s*glsl\\s*\\*\\/\\s*\\x60([\\s\\S]*?)\\x60');
  const m=source.match(re);
  if(!m)throw new Error('Nao encontrou '+label+' no CartoonSkybox.');
  return m[1];
}
function stripUniforms(s){
  return s.split('\n').filter(line=>!line.trim().startsWith('uniform ')).join('\n');
}
function varyings(s,isVertex){
  const names=[['vec3','vWorldPosition',0],['vec3','vRayDir',1]];
  for(const [type,name,loc] of names){
    const re=new RegExp('\\s*varying\\s+'+type+'\\s+'+name+'\\s*;','g');
    s=s.replace(re,'\nlayout(location='+loc+') '+(isVertex?'out':'in')+' '+type+' '+name+';');
  }
  return s;
}

const src=fs.readFileSync('src/atmosphere/skybox.ts','utf8');
let vs=extract(src,'vertexShader');
let fsx=extract(src,'fragmentShader');

const ubo=[
'layout(set=0,binding=0,std140) uniform SkyUniforms {',
'  mat4 uModel;',
'  mat4 uViewProj;',
'  vec4 uSunDirTime;',
'  vec4 uMoonDirStar;',
'  vec4 uZenithColorV;',
'  vec4 uHorizonColorV;',
'  vec4 uGroundColorV;',
'  vec4 uCloudColorV;',
'  vec4 uCloudShadowColorV;',
'  vec4 uSunColorV;',
'  vec4 uCoronaColorV;',
'  vec4 uFogColorMoon;',
'  vec4 uCoveragePixel;',
'  vec4 uWindOffsets;',
'  vec4 uCameraPosV;',
'} S;',
'#define modelMatrix S.uModel',
'#define uTime S.uSunDirTime.w',
'#define uSunDir S.uSunDirTime.xyz',
'#define uMoonDir S.uMoonDirStar.xyz',
'#define uStarVisibility S.uMoonDirStar.w',
'#define uZenithColor S.uZenithColorV.rgb',
'#define uHorizonColor S.uHorizonColorV.rgb',
'#define uGroundColor S.uGroundColorV.rgb',
'#define uCloudColor S.uCloudColorV.rgb',
'#define uCloudShadowColor S.uCloudShadowColorV.rgb',
'#define uSunColor S.uSunColorV.rgb',
'#define uCoronaColor S.uCoronaColorV.rgb',
'#define uFogColor S.uFogColorMoon.rgb',
'#define uMoonVisibility S.uFogColorMoon.w',
'#define uCloudCoverage S.uCoveragePixel.x',
'#define uPixelScale S.uCoveragePixel.y',
'#define uWindOffset S.uWindOffsets.xy',
'#define uWindOffset2 S.uWindOffsets.zw',
'#define uCameraPos S.uCameraPosV.xyz'
].join('\n');

vs=stripUniforms(vs);
vs=varyings(vs,true);
vs=vs.split('gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);')
     .join('gl_Position = S.uViewProj * (S.uModel * vec4(position, 1.0));');
vs='#version 450\nlayout(location=0) in vec3 position;\n'+ubo+'\n'+vs+'\n';

fsx=stripUniforms(fsx);
fsx=varyings(fsx,false);
fsx=fsx.split('gl_FragColor').join('outColor');
fsx='#version 450\n'+ubo+'\nlayout(location=0) out vec4 outColor;\n'+fsx+'\n';

fs.writeFileSync('native/shaders/sky.vert',vs);
fs.writeFileSync('native/shaders/sky.frag',fsx);
console.log('CartoonSkybox original convertido para GLSL Vulkan:',vs.length,fsx.length);
