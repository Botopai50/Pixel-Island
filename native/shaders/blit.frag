#version 450
layout(set=0,binding=0) uniform sampler2D tScene;
layout(location=0) in vec2 vUv;
layout(location=0) out vec4 outColor;

vec3 ACESFilm(vec3 x){
    // Mesma aproximação usada pelo ACESFilmicToneMapping do Three.js.
    const float a=2.51;
    const float b=0.03;
    const float c=2.43;
    const float d=0.59;
    const float e=0.14;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
void main(){
    vec4 s=texture(tScene,vUv);
    outColor=vec4(ACESFilm(s.rgb*1.05),s.a);
}
