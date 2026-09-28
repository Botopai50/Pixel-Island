#version 450

layout(location=0) in vec3 inPosition;
layout(location=1) in vec3 inNormal;
layout(location=3) in vec4 instanceM0;
layout(location=4) in vec4 instanceM1;
layout(location=5) in vec4 instanceM2;
layout(location=6) in vec4 instanceM3;
layout(location=10) in vec2 inUV;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;
    vec4 sunAmbient;
    vec4 environment;
    vec4 terrain;
} pc;

layout(location=0) out vec2 vUV;
layout(location=1) flat out float vMode;

void main(){
    mat4 inst=mat4(instanceM0,instanceM1,instanceM2,instanceM3);
    vec3 worldPos=(inst*vec4(inPosition,1.0)).xyz;
    gl_Position=pc.viewProj*vec4(worldPos,1.0);
    vUV=inUV;
    vMode=mod(pc.environment.z,10.0);
}
