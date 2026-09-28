#version 450
layout(set=0,binding=0) uniform sampler2D tScene;
layout(location=0) in vec2 vUv;
layout(location=0) out vec4 outColor;

vec3 RRTAndODTFitD(vec3 v){
    vec3 a=v*(v+0.0245786)-0.000090537;
    vec3 b=v*(0.983729*v+0.4329510)+0.238081;
    return a/b;
}
vec3 acesD(vec3 color){
    const mat3 ACESInputMat=mat3(
        vec3(0.59719,0.07600,0.02840),
        vec3(0.35458,0.90834,0.13383),
        vec3(0.04823,0.01566,0.83777)
    );
    const mat3 ACESOutputMat=mat3(
        vec3(1.60475,-0.10208,-0.00327),
        vec3(-0.53108,1.10813,-0.07276),
        vec3(-0.07367,-0.00605,1.07602)
    );
    color*=1.05/0.6;
    color=ACESInputMat*color;
    color=RRTAndODTFitD(color);
    color=ACESOutputMat*color;
    return clamp(color,0.0,1.0);
}
void main(){
    vec3 t=acesD(texture(tScene,vUv).rgb);
    vec3 srgb=mix(
        pow(t,vec3(0.41666))*1.055-vec3(0.055),
        t*12.92,
        vec3(lessThanEqual(t,vec3(0.0031308)))
    );
    outColor=vec4(srgb,1.0);
}
