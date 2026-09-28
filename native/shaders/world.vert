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
layout(location=11) in vec4 inTree;

layout(set=0,binding=2,std140) uniform ImpostorInfo {
    vec4 uImp[16];
} imp;

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
    float rawMode=pc.environment.z;
    float mode=mod(rawMode,10.0);
    vec3 worldPos=(inst*vec4(inPosition,1.0)).xyz;
    vec3 worldNormal=normalize(mat3(inst)*inNormal);
    vec2 finalUV=inUV;

    // Impositor de árvore distante: mesma conta de HorizonTerrain.setTreeAtlas().
    if(mode>3.5 && mode<4.5){
        vec3 foot=worldPos;
        vec2 hzTo=pc.cameraFog.xz-foot.xz;
        hzTo/=max(length(hzTo),1e-3);
        int type=int(inTree.z+0.5);
        vec4 hzInfo=imp.uImp[clamp(type,0,15)];

        float hzGrow=1.0-smoothstep(
            max(pc.terrain.w-350.0,pc.terrain.w*0.65),
            pc.terrain.w,
            distance(foot.xz,pc.terrain.xy)
        );
        float swapEnd=(3.0-0.8)*64.0;
        if(distance(foot.xz,pc.terrain.xy)<swapEnd-0.05) hzGrow=0.0;
        float hzS=abs(inTree.w)*hzGrow;
        vec3 hzRight=vec3(-hzTo.y,0.0,hzTo.x);
        worldPos += hzRight*(inTree.x*hzInfo.x+hzInfo.y*sign(inTree.w))*hzS;
        worldPos.y += ((inTree.y-0.5)*hzInfo.x+hzInfo.z)*hzS;
        worldNormal=normalize(vec3(hzTo.x,0.45,hzTo.y));

        vec2 cell=vec2(mod(float(type),4.0),floor(float(type)/4.0+0.01));
        float hu=inTree.x+0.5;
        if(inTree.w<0.0)hu=1.0-hu;
        finalUV=(cell+vec2(hu,inTree.y))/vec2(4.0,4.0);
    }

    // Exatamente a faixa de geomorphing usada pelos chunks no terrainShader.ts.
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
    vMode=rawMode;
    vUV=finalUV;
}
