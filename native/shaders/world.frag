#version 450

layout(set = 0, binding = 0) uniform sampler2D uTerrainAtlas;

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;
    vec4 sunAmbient;
    vec4 environment;
    vec4 terrainAtlas; // originX, originZ, spanWorld, terrainPass
} pc;

layout(location = 0) in vec3 vColor;
layout(location = 1) in float vDistance;
layout(location = 2) in vec3 vWorldPos;
layout(location = 3) in float vLight;

layout(location = 0) out vec4 outColor;

vec3 sampleOriginalTerrainTexture() {
    const float CHUNK = 64.0;
    const float SLOT = 112.0;
    const float OUTER = 80.0;
    const float GRID = 13.0;
    const float ATLAS = SLOT * GRID;

    vec2 rel = vec2(vWorldPos.x - pc.terrainAtlas.x, vWorldPos.z - pc.terrainAtlas.y);
    vec2 cell = floor(rel / CHUNK);
    vec2 local = clamp(fract(rel / CHUNK), vec2(0.0), vec2(0.999999));

    // O centro do atlas é o chunk 6,6. O preset Intel UHD usa 1.75 tx/m
    // no 3x3 central e 1.25 tx/m no restante.
    float ring = max(abs(cell.x - 6.0), abs(cell.y - 6.0));
    float sourcePixels = ring <= 1.0 ? SLOT : OUTER;

    vec2 pixel = cell * SLOT + local * sourcePixels + vec2(0.5);
    vec2 uv = pixel / ATLAS;
    return texture(uTerrainAtlas, uv).rgb;
}

void main() {
    vec3 color = vColor * vLight;

    bool water = vColor.b > vColor.r * 1.55 && vColor.b > vColor.g * 0.82 && vWorldPos.y < 3.0;
    bool lava = vColor.r > 0.70 && vColor.g < 0.38 && vColor.b < 0.14 && vWorldPos.y > 0.0;

    if (pc.terrainAtlas.w > 0.5 && !water && !lava) {
        color = sampleOriginalTerrainTexture() * vLight;
    }

    if (water) {
        float waveA = sin(vWorldPos.x * 0.085 + pc.environment.x * 1.45);
        float waveB = sin(vWorldPos.z * 0.063 - pc.environment.x * 1.12);
        float wave = (waveA + waveB) * 0.5;
        color *= 0.90 + wave * 0.055;
        float sparkle = smoothstep(0.82, 1.0, sin((vWorldPos.x + vWorldPos.z) * 0.19 + pc.environment.x * 2.4));
        color += vec3(0.04, 0.08, 0.10) * sparkle;
    }

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
