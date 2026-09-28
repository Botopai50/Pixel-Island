#version 450

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;
    vec4 sunAmbient;
    vec4 environment;
} pc;

layout(location = 0) in vec3 vColor;
layout(location = 1) in float vDistance;
layout(location = 2) in vec3 vWorldPos;

layout(location = 0) out vec4 outColor;

void main() {
    float fogFar = pc.cameraFog.w;
    float fog = smoothstep(fogFar * 0.52, fogFar, vDistance);
    vec3 fogColor = vec3(0.54, 0.70, 0.78);

    // leve oclusão atmosférica por altura para manter o visual de diorama
    float valleyHaze = clamp((16.0 - vWorldPos.y) / 80.0, 0.0, 0.11);
    vec3 color = mix(vColor, fogColor, clamp(fog + valleyHaze, 0.0, 1.0));
    outColor = vec4(color, 1.0);
}
