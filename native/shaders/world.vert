#version 450

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;
layout(location = 2) in vec3 inColor;

layout(location = 3) in vec3 instanceOffset;
layout(location = 4) in float instanceScale;
layout(location = 5) in float instanceRotation;
layout(location = 6) in vec3 instanceColor;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;
    vec4 sunAmbient;
    vec4 environment;
} pc;

layout(location = 0) out vec3 vColor;
layout(location = 1) out float vDistance;
layout(location = 2) out vec3 vWorldPos;

void main() {
    float c = cos(instanceRotation);
    float s = sin(instanceRotation);

    vec3 p = inPosition * instanceScale;
    vec3 n = inNormal;

    vec3 rp = vec3(
        p.x * c - p.z * s,
        p.y,
        p.x * s + p.z * c
    );

    vec3 rn = normalize(vec3(
        n.x * c - n.z * s,
        n.y,
        n.x * s + n.z * c
    ));

    vec3 worldPos = rp + instanceOffset;
    gl_Position = pc.viewProj * vec4(worldPos, 1.0);

    vec3 sunDir = normalize(pc.sunAmbient.xyz);
    float ndl = max(dot(rn, sunDir), 0.0);
    float toon = ndl > 0.56 ? 1.0 : (ndl > 0.18 ? 0.72 : 0.46);
    float light = mix(pc.sunAmbient.w, 1.0, toon);

    vColor = inColor * instanceColor * light;
    vDistance = distance(worldPos, pc.cameraFog.xyz);
    vWorldPos = worldPos;
}
