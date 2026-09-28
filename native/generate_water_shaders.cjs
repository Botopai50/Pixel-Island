const fs=require('fs');

function extract(source,label){
  const re=new RegExp(label+'\\s*:\\s*\\/\\*\\s*glsl\\s*\\*\\/\\s*\\x60([\\s\\S]*?)\\x60');
  const m=source.match(re);
  if(!m)throw new Error('Nao encontrou '+label+' no WaterShader.');
  return m[1];
}
function extractConstTemplate(source,name){
  const re=new RegExp('export\\s+const\\s+'+name+'\\s*=\\s*\\/\\*\\s*glsl\\s*\\*\\/\\s*\\x60([\\s\\S]*?)\\x60');
  const m=source.match(re);
  if(!m)throw new Error('Nao encontrou '+name);
  return m[1];
}
function stripUniforms(s){ return s.replace(/^\\s*uniform\\s+[^;]+;\\s*$/gm,''); }
function varyings(s,isVertex){
  const names=[['vec3','vWorldPosition',0],['vec3','vNormal',1],['vec2','vUv',2],['float','vWaveHeight',3],['float','vRippleOffset',4],['vec4','vReflectCoord',5]];
  for(const [type,name,loc] of names){
    const re=new RegExp('\\s*varying\\s+'+type+'\\s+'+name+'\\s*;','g');
    s=s.replace(re,'\nlayout(location='+loc+') '+(isVertex?'out':'in')+' '+type+' '+name+';');
  }
  return s;
}

const waterSrc=fs.readFileSync('src/generation/shaders/waterShader.ts','utf8');
const fogSrc=fs.readFileSync('src/atmosphere/atmosphericFog.ts','utf8');
const fog=extractConstTemplate(fogSrc,'FOG_AMOUNT_GLSL');
let vs=extract(waterSrc,'vertexShader');
let fsx=extract(waterSrc,'fragmentShader').replace('${FOG_AMOUNT_GLSL}',fog);

const ubo=[
'layout(set=0,binding=3,std140) uniform WaterUniforms {',
'  mat4 uModel;',
'  mat4 uViewProj;',
'  mat4 uReflectTextureMatrixM;',
'  vec4 uCameraPosTime;',
'  vec4 uWaterParams0;',
'  vec4 uWaterParams1;',
'  vec4 uDeepColorV;',
'  vec4 uShallowColorV;',
'  vec4 uFoamColorV;',
'  vec4 uCrestColorV;',
'  vec4 uLightDirMode;',
'  vec4 uFogColorNear;',
'  vec4 uFogSunColorFar;',
'  vec4 uFogSunDirOn;',
'  vec4 uResolutionTexel;',
'  vec4 uBiomeOriginSpanReady;',
'  vec4 uCameraNearFarActive;',
'  vec4 uRipplesV[8];',
'} W;',
'#define modelMatrix W.uModel',
'#define uReflectTextureMatrix W.uReflectTextureMatrixM',
'#define cameraPosition W.uCameraPosTime.xyz',
'#define uTime W.uCameraPosTime.w',
'#define uWaveHeight W.uWaterParams0.x',
'#define uWaveFrequency W.uWaterParams0.y',
'#define uWaveSpeed W.uWaterParams0.z',
'#define uFoamAmount W.uWaterParams0.w',
'#define uFlowSpeed W.uWaterParams1.x',
'#define uWindAngle W.uWaterParams1.y',
'#define uOpacity W.uWaterParams1.z',
'#define uFoamDistance W.uWaterParams1.w',
'#define uDeepColor W.uDeepColorV.rgb',
'#define uShallowColor W.uShallowColorV.rgb',
'#define uFoamColor W.uFoamColorV.rgb',
'#define uCrestColor W.uCrestColorV.rgb',
'#define uLightDir W.uLightDirMode.xyz',
'#define uIsOrthographic W.uLightDirMode.w',
'#define uFogColor W.uFogColorNear.rgb',
'#define uFogNear W.uFogColorNear.w',
'#define uFogSunColor W.uFogSunColorFar.rgb',
'#define uFogFar W.uFogSunColorFar.w',
'#define uFogSunDir W.uFogSunDirOn.xyz',
'#define uFogOn W.uFogSunDirOn.w',
'#define uResolution W.uResolutionTexel.xy',
'#define uTexelDensity W.uResolutionTexel.z',
'#define uBiomeColorEnabled W.uResolutionTexel.w',
'#define uBiomeMapOrigin W.uBiomeOriginSpanReady.xy',
'#define uBiomeMapSpan W.uBiomeOriginSpanReady.z',
'#define uBiomeMapReady W.uBiomeOriginSpanReady.w',
'#define uCameraNear W.uCameraNearFarActive.x',
'#define uCameraFar W.uCameraNearFarActive.y',
'#define uActiveRipples int(W.uCameraNearFarActive.z + 0.5)',
'#define uRipples W.uRipplesV'
].join('\n');

vs=stripUniforms(vs);
vs=varyings(vs,true);
vs=vs.replace(/gl_Position\\s*=\\s*projectionMatrix\\s*\\*\\s*viewMatrix\\s*\\*\\s*worldPosition\\s*;/g,'gl_Position = W.uViewProj * worldPosition;');
vs=vs.replace(/\\btexture2D\\s*\\(/g,'texture(');
vs='#version 450\nlayout(location=0) in vec3 position;\nlayout(location=1) in vec2 uv;\nlayout(set=0,binding=2) uniform sampler2D uBiomeMap;\n'+ubo+'\n'+vs+'\n';

fsx=stripUniforms(fsx);
fsx=varyings(fsx,false);
fsx=fsx.replace(/\\btexture2D\\s*\\(/g,'texture(');
fsx=fsx.replace(/\\bgl_FragColor\\b/g,'outColor');
fsx='#version 450\nlayout(set=0,binding=0) uniform sampler2D tDepth;\nlayout(set=0,binding=1) uniform sampler2D tPlanarReflection;\nlayout(set=0,binding=2) uniform sampler2D uBiomeMap;\n'+ubo+'\nlayout(location=0) out vec4 outColor;\n'+fsx+'\n';

fs.writeFileSync('native/shaders/water.vert',vs);
fs.writeFileSync('native/shaders/water.frag',fsx);
console.log('WaterShader original convertido para GLSL Vulkan:',vs.length,fsx.length);
