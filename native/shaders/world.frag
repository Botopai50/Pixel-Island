#version 450

layout(set=0,binding=0) uniform sampler2D uChunkTopPack; // top à esquerda, topDark à direita
layout(set=0,binding=1) uniform sampler2D uWallAtlas;    // A/B/C/D em 4 colunas de 128px

layout(push_constant) uniform PushConstants {
    mat4 viewProj;
    vec4 cameraFog;    // xyz camera, w fogNear
    vec4 sunAmbient;   // xyz sunDir, w ambient
    vec4 environment;  // x time, y fogFar, z renderMode, w density
    vec4 terrain;      // chunk origin,size,end OR horizon center,inner,outer
} pc;

layout(location=0) in vec3 vColor;
layout(location=1) in vec3 vWorldPos;
layout(location=2) in vec3 vWorldNormal;
layout(location=3) in vec3 vWall;
layout(location=4) in float vLight;
layout(location=5) in float vMode;
layout(location=6) in vec2 vUV;
layout(location=0) out vec4 outColor;

float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float vn2(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),
               mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);
}
float clg(vec2 t){
    return h21(floor(t*0.5))*0.30
         + h21(floor((t+vec2(1,3))/3.0)+17.0)*0.32
         + h21(floor((t+vec2(5,2))/5.0)+53.0)*0.22
         + h21(floor((t+vec2(3,6))/9.0)+91.0)*0.16;
}

float fadeHash(vec2 p){return h21(p+vec2(37.0,17.0));}

vec3 hzPix(vec2 uv,float cell,float wall){
    float n=h21(floor(uv/cell)+cell*0.173);
    float n2=h21(floor(uv/(cell*4.0))+cell*0.311+31.7);
    vec3 t=n<0.22?vec3(0.66,0.74,0.74):
           n<0.55?vec3(0.88,0.92,0.90):
           n<0.85?vec3(1.05,1.04,0.98):vec3(1.20,1.16,0.94);
    vec3 tw=vec3(n<0.2?0.60:n<0.55?0.84:n<0.85?1.0:1.16);
    return mix(t,tw,wall)*(n2<0.5?0.92:1.05);
}

vec3 horizonPixelTone(vec3 base){
    vec3 hzA=abs(normalize(vWorldNormal));
    float hzWall=1.0-smoothstep(0.55,0.70,hzA.y);
    vec2 hzUV=hzA.y>=0.62?vWorldPos.xz:(hzA.x>hzA.z?vWorldPos.zy:vWorldPos.xy);
    if(hzA.y<0.62)hzUV.x*=0.5;
    vec2 hzFw=fwidth(hzUV);
    float hzFoot=max(max(hzFw.x,hzFw.y),1e-4);
    vec3 tone=vec3(1.0);
    for(int k=0;k<3;k++){
        float hzC=2.0*exp2(float(k)*2.0);
        float hzF=1.0-smoothstep(0.35,0.60,hzFoot/hzC);
        tone*=mix(vec3(1.0),hzPix(hzUV,hzC,hzWall),hzF*(k==0?1.0:0.6));
    }
    return base*tone;
}

vec4 sampleTop(bool dark,vec2 localUV){
    float texW=round(64.0*pc.environment.w);
    // imagem nativa fixa 256x128; pixels válidos ocupam texW x texW.
    float x=(dark?128.0:0.0)+clamp(localUV.x,0.0,0.999999)*texW+0.5;
    float y=clamp(localUV.y,0.0,0.999999)*texW+0.5;
    return texture(uChunkTopPack,vec2(x/256.0,y/128.0));
}

vec3 sampleWall(int which,vec2 uv){
    // atlas 1024x1024: A,B,C,D em colunas de 256x1024.
    vec2 f=fract(uv);
    float x=(float(which)*256.0+f.x*255.0+0.5)/1024.0;
    float y=(f.y*1023.0+0.5)/1024.0;
    return texture(uWallAtlas,vec2(x,y)).rgb;
}

// Port literal do atmosphericFog.ts.
float fogAmountAt(vec3 wpos,float fNear,float fFar){
    float d=length(wpos-pc.cameraFog.xyz);
    float span=max(fFar-fNear,1.0);
    float dd=max(d-fNear,0.0);
    float fd=max(1.0-exp(-dd/(span*0.4)),smoothstep(fNear+span*0.7,fFar,d));
    float hf=0.55*exp(-max(wpos.y-2.0,0.0)/35.0)
             *(1.0-exp(-max(d-fNear*0.5,0.0)/800.0));
    return 1.0-(1.0-fd)*(1.0-hf);
}

vec3 aerialPerspective(vec3 col,vec3 wpos,vec3 fogCol,float fNear,float fFar){
    vec3 rel=wpos-pc.cameraFog.xyz;
    float d=length(rel);
    float nh=0.55*(1.0-exp(-max(d-fNear,0.0)/260.0));
    float t=1.0-(1.0-fogAmountAt(wpos,fNear,fFar))*(1.0-nh);
    vec3 tc=1.0-pow(vec3(1.0-t),vec3(0.85,1.0,1.2));
    float lum=dot(col,vec3(0.2126,0.7152,0.0722));
    col=mix(col,vec3(lum),clamp(t*0.7,0.0,1.0));
    float sunUp=clamp(pc.sunAmbient.y*4.0+0.2,0.0,1.0);
    float glow=pow(max(dot(rel/max(d,1e-3),normalize(pc.sunAmbient.xyz)),0.0),5.0)*sunUp;
    // #88bce8 e #fff9ed convertidos para linear.
    vec3 fogC=vec3(0.2462,0.5029,0.8069);
    vec3 sunC=vec3(1.0,0.9473,0.8469);
    vec3 inscat=mix(fogC,sunC,glow*0.45);
    return mix(col,inscat,tc);
}

vec3 terrainColor(){
    vec2 localUV=(vWorldPos.xz-pc.terrain.xy)/pc.terrain.z;
    vec4 topS=sampleTop(false,localUV);
    vec4 topD=sampleTop(true,localUV);

    vec3 wn=normalize(vWorldNormal);
    float totalD=pc.environment.w;
    vec2 texel=vWorldPos.xz*totalD;
    float nearK=1.0; // fwidth-based fade preservado abaixo
    vec2 texFw=fwidth(texel);
    nearK=1.0-smoothstep(0.6,1.6,max(texFw.x,texFw.y));
    float dth=(clg(texel)-0.5)*nearK;

    float slope=1.0-abs(wn.y);
    if(vWall.x>0.5)slope=max(slope,vWall.z);
    float thr=min(0.46,0.38+dth*0.12+topS.a*(0.20*0.4+dth*0.12));
    float wallMix=step(thr,slope);

    // projeção de paredão em 8 direções, igual ao terrainShader.ts.
    float wAng=atan(wn.z,wn.x);
    float wOct=floor(wAng/0.78539816+0.5+dth*0.7)*0.78539816;
    vec2 wTan=vec2(-sin(wOct),cos(wOct));
    vec2 uvW=vec2(dot(vWorldPos.xz,wTan),vWorldPos.y);
    uvW*=totalD/256.0;

    float bi=floor(topD.a*255.0+0.5);
    vec2 uvD=vec2(uvW.x,(fract(uvW.y*0.7)+bi)/4.0);
    vec2 uvRock=vec2(uvW.x,(fract(uvW.y)+bi)/4.0);

    float rockVar=(vn2(vWorldPos.xz*0.045)-0.5)*9.0
                 +(vn2(vWorldPos.xz*0.21+7.3)-0.5)*3.0
                 +(vn2(vWorldPos.xz*0.8+3.1)-0.5)*0.9;
    float yl=9.5+rockVar+dth*1.6;
    float bel=yl-vWorldPos.y;
    float rk=step(0.0,bel);

    vec3 rockA=sampleWall(1,uvRock);
    vec3 rockB=sampleWall(2,uvRock);
    vec3 dirtA=sampleWall(0,uvD);
    vec3 dirtD=sampleWall(3,uvD);
    float contact=1.0-step(2.2/max(totalD,0.01),abs(bel));
    vec3 rock=mix(rockA,rockB,contact*0.45);
    vec3 dirt=mix(dirtA,dirtD,contact*0.40);
    vec3 wall=mix(dirt,rock,rk);

    // Barranco baixo: mantém a cor do chão, como o shader original.
    float lowBank=1.0-step(3.0+dth*0.6,vWorldPos.y);
    if(lowBank>0.0 && (wallMix>0.0||slope>0.3)){
        wall=topS.rgb*0.84;
        wallMix*=1.0-lowBank;
    }

    vec3 topBase=mix(topS.rgb,topD.rgb,0.08*nearK);
    return mix(topBase,wall,wallMix);
}

void main(){
    float mode=vMode;

    // Mesma faixa de dissolve dos chunks: blocos de 4m fixos no mundo.
    if(mode>0.5&&mode<1.5){
        float d=distance(vWorldPos.xz,pc.cameraFog.xz);
        float chunkEnd=pc.terrain.w;
        float fade=smoothstep(chunkEnd-110.0,chunkEnd,d);
        if(fadeHash(floor(vWorldPos.xz/4.0))>1.0-fade)discard;
    }

    // Distant Horizons: buraco interno e fade externo do horizonTerrain.ts.
    if(mode>1.5){
        float d=distance(vWorldPos.xz,pc.cameraFog.xz);
        float inner=pc.terrain.z,outer=pc.terrain.w;
        if(d<inner)discard;
        float fade=smoothstep(outer,outer+250.0,d);
        if(fadeHash(floor(vWorldPos.xz/16.0))>1.0-fade)discard;
    }

    vec3 color;
    if(mode>0.5&&mode<1.5) {
        color=terrainColor()*vLight;
    } else if(mode>2.5&&mode<3.5) {
        vec2 uv=vUV*pc.terrain.xy;
        if(pc.terrain.w>0.5) uv.y=1.0-uv.y;
        vec4 texel=texture(uChunkTopPack,uv);
        if(pc.terrain.z>0.0 && texel.a<pc.terrain.z) discard;
        color=texel.rgb*vColor*vLight;
    } else if(mode>1.5) {
        color=horizonPixelTone(vColor)*vLight;
    } else {
        color=vColor*vLight;
    }

    color=aerialPerspective(color,vWorldPos,vec3(0.2462,0.5029,0.8069),pc.cameraFog.w,pc.environment.y);
    outColor=vec4(color,1.0);
}
