#version 450

layout(location=0) in vec3 inPosition;
layout(location=1) in vec3 inNormal;
layout(location=2) in vec3 inColor;
layout(location=3) in vec4 instanceM0;
layout(location=4) in vec4 instanceM1;
layout(location=5) in vec4 instanceM2;
layout(location=6) in vec4 instanceM3;
layout(location=7) in vec4 instanceColor;
layout(location=8) in vec3 inWall;
layout(location=9) in float inMorph;
layout(location=10) in vec2 inUV;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;    // xyz camera, w fogNear
    vec4 sunAmbient;   // xyz sunDir, w ambient
    vec4 environment;  // x time, y fogFar, z renderMode (0 prop,1 chunk,2 horizon), w density
    vec4 terrain;      // chunk: originX,originZ,size,chunkEnd / horizon: centerX,centerZ,inner,outer
} pc;

layout(location=0) out vec3 vColor;
layout(location=1) out vec3 vWorldPos;
layout(location=2) out vec3 vWorldNormal;
layout(location=3) out vec3 vWall;
layout(location=4) out float vLight;
layout(location=5) out float vMode;
layout(location=6) out vec2 vUV;

void main(){
    mat4 inst=mat4(instanceM0,instanceM1,instanceM2,instanceM3);
    vec3 worldPos=(inst*vec4(inPosition,1.0)).xyz;
    vec3 worldNormal=normalize(mat3(inst)*inNormal);
    float mode=pc.environment.z;

    // Exatamente a faixa de geomorphing usada pelos chunks no terrainShader.ts:
    // uChunkFade.x=chunkEnd-110; smoothstep(uChunkFade.x-140,uChunkFade.x+20,...)
    if(mode>0.5 && mode<1.5){
        float d=distance(worldPos.xz,pc.cameraFog.xz);
        float morphK=smoothstep(pc.terrain.w-250.0,pc.terrain.w-90.0,d);
        worldPos.y += inMorph*morphK;
    }

    gl_Position=pc.viewProj*vec4(worldPos,1.0);

    vec3 sunDir=normalize(pc.sunAmbient.xyz);
    float ndl=max(dot(worldNormal,sunDir),0.0);
    // Rampa toon do projeto: 4 patamares claros em vez do toon binário provisório.
    float toon = ndl < 0.18 ? 0.43 :
                 ndl < 0.42 ? 0.58 :
                 ndl < 0.72 ? 0.80 : 1.0;

    vColor=inColor*instanceColor.rgb;
    vWorldPos=worldPos;
    vWorldNormal=worldNormal;
    vWall=inWall;
    vLight=mix(pc.sunAmbient.w,1.0,toon);
    vMode=mode;
    vUV=inUV;
}
