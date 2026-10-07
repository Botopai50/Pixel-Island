export const CascadeVertexShader=/* glsl */ `
 attribute vec2 flowPosition,cascadePosition,fallDirection;
 attribute vec3 springPool;
 attribute float waveWeight;
 uniform float uTime;
 uniform mat4 uSpringReflectMatrix,uCascadeReflectMatrix;
 varying vec4 vCascadeReflectCoord,vReflectCoord;
 varying vec3 vPool;
 varying vec3 vWorldPosition,vNormal,vSurfaceNormal;
 varying vec2 vUv,vFlowPosition,vCascadePosition;
 varying float vWaveHeight,vRippleOffset;
 void main(){
  vUv=uv;vFlowPosition=flowPosition;vCascadePosition=cascadePosition;vPool=springPool;
  float travel=cascadePosition.y-uTime*3.5;
  float a=travel*1.8+cascadePosition.x*.55;
  float b=travel*4.8-cascadePosition.x*1.15;
  float offset=(sin(a)*.18+sin(b)*.045)*waveWeight;
  vec3 forward=vec3(fallDirection.x,0.,fallDirection.y);
  vec3 side=vec3(fallDirection.y,0.,-fallDirection.x);
  // ondas do rio de cima (só onde a malha é plana): a água sobe e desce devagar ao correr
  float flat_=smoothstep(.97,1.,normal.y);
  float swell=(sin(cascadePosition.y*.9-uTime*2.2+cascadePosition.x*.6)*.5+sin(cascadePosition.y*1.7-uTime*3.1-cascadePosition.x*.9)*.3)*.05*flat_;
  vec3 displaced=position+forward*offset+vec3(0.,swell,0.);
  float across=(cos(a)*.18*.55-cos(b)*.045*1.15)*waveWeight;
  float down=(cos(a)*.18*1.8+cos(b)*.045*4.8)*waveWeight;
  vec3 animatedNormal=normalize(normal-side*across+vec3(0.,down,0.));
  vec4 w=modelMatrix*vec4(displaced,1.);
  vWorldPosition=w.xyz;vNormal=normalize(mat3(modelMatrix)*animatedNormal);
  vSurfaceNormal=vNormal;vWaveHeight=0.;vRippleOffset=0.;
  vReflectCoord=uSpringReflectMatrix*w;
  vCascadeReflectCoord=uCascadeReflectMatrix*w;
  gl_Position=projectionMatrix*viewMatrix*w;
 }
`;
