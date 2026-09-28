#version 450

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;
    vec4 sunAmbient;
} pc;

layout(location = 0) in vec3 vColor;
layout(location = 1) in float vDistance;

layout(location = 0) out vec4 outColor;

void main() {
    float fogFar = pc.cameraFog.w;
    float fog = smoothstep(fogFar * 0.52, fogFar, vDistance);
    vec3 fogColor = vec3(0.54, 0.70, 0.78);
    vec3 color = mix(vColor, fogColor, fog);
    outColor = vec4(color, 1.0);
}
