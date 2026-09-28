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
    vec3 color = vColor;

    // Água: mantém custo de um único passe. Sem reflection render extra.
    // Detectada pela paleta azul do terreno procedural.
    bool water = color.b > color.r * 1.55 && color.b > color.g * 0.82 && vWorldPos.y < 3.0;
    if (water) {
        float waveA = sin(vWorldPos.x * 0.085 + pc.environment.x * 1.45);
        float waveB = sin(vWorldPos.z * 0.063 - pc.environment.x * 1.12);
        float wave = (waveA + waveB) * 0.5;
        color *= 0.90 + wave * 0.055;
        float sparkle = smoothstep(0.82, 1.0, sin((vWorldPos.x + vWorldPos.z) * 0.19 + pc.environment.x * 2.4));
        color += vec3(0.04, 0.08, 0.10) * sparkle;
    }

    // Lava: pulso de emissivo visual barato, sem luz dinâmica por fragmento.
    bool lava = color.r > 0.70 && color.g < 0.38 && color.b < 0.14 && vWorldPos.y > 0.0;
    if (lava) {
        float pulse = 0.86 + 0.14 * sin(pc.environment.x * 3.0 + vWorldPos.x * 0.13 + vWorldPos.z * 0.09);
        color = mix(color * pulse, vec3(1.0, 0.22, 0.025), 0.16);
    }

    float fogFar = pc.cameraFog.w;
    float fog = smoothstep(fogFar * 0.52, fogFar, vDistance);
    vec3 fogColor = vec3(0.54, 0.70, 0.78);

    float valleyHaze = clamp((16.0 - vWorldPos.y) / 80.0, 0.0, 0.11);
    color = mix(color, fogColor, clamp(fog + valleyHaze, 0.0, 1.0));
    outColor = vec4(color, 1.0);
}
