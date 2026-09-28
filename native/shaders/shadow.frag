#version 450

layout(set=0,binding=0) uniform sampler2D uMap;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;
    vec4 sunAmbient;
    vec4 environment;
    vec4 terrain;
} pc;

layout(location=0) in vec2 vUV;
layout(location=1) flat in float vMode;

void main(){
    if(vMode>2.5&&vMode<3.5){
        vec2 uv=vUV*pc.terrain.xy;
        if(pc.terrain.w>0.5)uv.y=1.0-uv.y;
        vec4 texel=texture(uMap,uv);
        if(pc.terrain.z>0.0&&texel.a<pc.terrain.z)discard;
    }
}
