#version 450

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;
layout(location = 2) in vec3 inColor;

layout(location = 3) in vec4 instanceM0;
layout(location = 4) in vec4 instanceM1;
layout(location = 5) in vec4 instanceM2;
layout(location = 6) in vec4 instanceM3;
layout(location = 7) in vec4 instanceColor;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;
    vec4 sunAmbient;
    vec4 environment;
    vec4 terrainAtlas;
} pc;

layout(location = 0) out vec3 vColor;
layout(location = 1) out float vDistance;
layout(location = 2) out vec3 vWorldPos;
layout(location = 3) out float vLight;

void main() {
    mat4 instanceMatrix = mat4(instanceM0, instanceM1, instanceM2, instanceM3);
    vec3 worldPos = (instanceMatrix * vec4(inPosition, 1.0)).xyz;
    vec3 worldNormal = normalize(mat3(instanceMatrix) * inNormal);

    gl_Position = pc.viewProj * vec4(worldPos, 1.0);

    vec3 sunDir = normalize(pc.sunAmbient.xyz);
    float ndl = max(dot(worldNormal, sunDir), 0.0);
    float toon = ndl > 0.56 ? 1.0 : (ndl > 0.18 ? 0.72 : 0.46);

    vLight = mix(pc.sunAmbient.w, 1.0, toon);
    vColor = inColor * instanceColor.rgb;
    vDistance = distance(worldPos, pc.cameraFog.xyz);
    vWorldPos = worldPos;
}
