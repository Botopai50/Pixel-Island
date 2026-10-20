// @ts-nocheck
import * as THREE from 'three';

/** Give custom pixel shaders the same scene shadows and fog as standard materials. */
// A luz da cena é calculada UMA vez por quadro e vale para todos os objetos. Antes este cache era criado dentro da função
// (um por malha instanciada, uns 600): cada malha refazia o percurso pela cena inteira a cada quadro (~70 ms de CPU).
const sceneLighting=new WeakMap<THREE.Scene,{frame:number;ambient:THREE.Color;sun:THREE.Color;direction:THREE.Vector3}>();
export const OBJECT_GRID={value:0};
export function enableAssetEnvironment(root:THREE.Object3D){
 const prepared=new Set<THREE.Material>(),litMaterials=new Map<THREE.Material,THREE.Material>();
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh||object instanceof THREE.Sprite)||object.userData.assetEnvironmentRegistered)return;
  object.userData.assetEnvironmentRegistered=true;
  if(object instanceof THREE.Sprite&&object.material instanceof THREE.SpriteMaterial){
   const original=object.material,uniforms=THREE.UniformsUtils.clone(THREE.ShaderLib.sprite.uniforms);
   uniforms.map.value=original.map;uniforms.diffuse.value.copy(original.color);uniforms.opacity.value=original.opacity;
   uniforms.rotation.value=original.rotation;uniforms.center.value.copy(object.center);uniforms.alphaTest.value=original.alphaTest;
   original.map?.updateMatrix();if(original.map)uniforms.mapTransform.value.copy(original.map.matrix);
   const sprite=new THREE.ShaderMaterial({uniforms,vertexShader:THREE.ShaderLib.sprite.vertexShader,fragmentShader:THREE.ShaderLib.sprite.fragmentShader,transparent:original.transparent,depthWrite:original.depthWrite,side:original.side,fog:true,defines:{...(original.map?{USE_MAP:'',MAP_UV:'uv'}:{}),...(original.alphaTest>0?{USE_ALPHATEST:''}:{}),...(original.sizeAttenuation?{USE_SIZEATTENUATION:''}:{})}});
   sprite.name=original.name;original.addEventListener('dispose',()=>sprite.dispose());
   object.material=sprite as unknown as THREE.SpriteMaterial;
  }
  const materials=Array.isArray(object.material)?object.material:[object.material];
  for(const material of materials){
   // Fire sprites deliberately emit light. Everything else participates in atmosphere.
   material.fog=true;
   if(!(material instanceof THREE.ShaderMaterial)||material.userData.assetEnvironment)continue;
   if(prepared.has(material))continue;prepared.add(material);
   material.userData.assetEnvironment=true;
   material.lights=true;
   Object.assign(material.uniforms,THREE.UniformsUtils.clone({...THREE.UniformsLib.lights,...THREE.UniformsLib.fog}),{
    uAssetInverseProjection:{value:new THREE.Matrix4()},uAssetCameraWorld:{value:new THREE.Matrix4()},
    uAssetLeafFill:{value:material.userData.leafFill ?? ((material.uniforms.uStruct || material.uniforms.uLeaf) ? 0.35 : 0)},
    uAssetAmbient:{value:new THREE.Color(.3,.3,.3)},uAssetSun:{value:new THREE.Color(.7,.7,.7)},uObjGrid:OBJECT_GRID
   });
   const clean=(shader:string)=>shader.replace(/#include <(?:common|fog_(?:pars_vertex|pars_fragment|vertex|fragment))>/g,'');
   const common=(_shader:string)=>'#include <common>\n';
   const hasInst=material.vertexShader.includes('instanceMatrix');
   material.vertexShader=common(material.vertexShader)+`uniform mat4 uAssetInverseProjection,uAssetCameraWorld;
varying vec3 vAssetWP;
varying vec3 vAssetOrg;
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
`+clean(material.vertexShader);
   material.vertexShader=injectMain(material.vertexShader,`{
 vec4 mvPosition=uAssetInverseProjection*gl_Position;
 mvPosition/=mvPosition.w;
 vec4 worldPosition=uAssetCameraWorld*mvPosition;
 vec3 transformedNormal=normalize(normalMatrix*normal);
 vAssetWP=worldPosition.xyz;
 vAssetOrg=(modelMatrix*vec4(${hasInst?'instanceMatrix[3].xyz':'0.0,0.0,0.0'},1.0)).xyz;
 #include <shadowmap_vertex>
 #include <fog_vertex>
}`,false);
   // A sombra do sol nos objetos (árvores, pedras, plantas) é lida no CENTRO do texel do mundo (21,3 texels por metro, a mesma grade do chão e da grama),
   // e não por pixel da tela: a borda da sombra anda em degraus de pixel, como a do chão. Precisa da normal do mundo (vNormal) para o afastamento
   // contra manchas; sem ela, volta à sombra comum.
   // Os que não têm vNormal (cartões de maçã e cogumelo, seixos) usam a normal tirada da superfície (derivadas da posição no mundo): leem a sombra na mesma grade.
   const hasNormal=/varying\s+vec3\s+vNormal\s*;/.test(material.fragmentShader);
   const snapShadow=true;
   const isBark=/varying\s+vec2\s+vBarkAngle\s*;/.test(material.fragmentShader)&&/uniform\s+float\s+uLobedMode\s*;/.test(material.fragmentShader);
   material.userData.snapShadow=snapShadow;
   material.fragmentShader=common(material.fragmentShader)+`#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
uniform vec3 uAssetAmbient,uAssetSun;
uniform float uObjGrid;
uniform float uAssetLeafFill;
varying vec3 vAssetWP;
varying vec3 vAssetOrg;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
float assetShadowGridP(vec3 N,vec3 q){
 float shadow=1.0;
 // o afastamento contra acne não pode descer: na parte de baixo de uma pedra ou de um tronco deitado "para fora" é para dentro do chão, que está na
 // sombra do próprio terreno, e a base do objeto saía preta, cortada rente ao chão. Sem a componente para baixo e com o ponto uns 6 cm mais alto.
 vec3 Nb=vec3(N.x,max(N.y,0.0),N.z);
 q.y+=0.06;
 DirectionalLightShadow dls;
 #pragma unroll_loop_start
 for(int i=0;i<NUM_DIR_LIGHT_SHADOWS;i++){
  dls=directionalLightShadows[i];
  shadow*=receiveShadow?getShadow(directionalShadowMap[i],dls.shadowMapSize,dls.shadowIntensity,dls.shadowBias,dls.shadowRadius,directionalShadowMatrix[i]*vec4(q+Nb*dls.shadowNormalBias,1.0)):1.0;
 }
 #pragma unroll_loop_end
  return shadow;
}
// a grade é a do PLANO em que a superfície mais se deita (o mesmo plano dos texels da pedra): no chão e em tampos é xz, nas paredes é zy ou xy; a terceira
// coordenada fica contínua. Assim a borda da sombra segue os texels da superfície, e não cubos 3D cortados de qualquer jeito pela superfície.
float assetShadowGrid(vec3 N){
 vec3 q=vAssetWP; vec3 aN=abs(N);
 // o centro da célula tem que continuar NO PLANO da superfície: mexer só nas duas coordenadas do plano tirava o ponto de cima da superfície inclinada (para dentro ou para fora dela),
 // e a leitura caía na sombra do próprio objeto (acne). A terceira coordenada acompanha a inclinação, como o chão faz.
 if(aN.y>=aN.x&&aN.y>=aN.z){ q.xz=(floor(q.xz*21.3333)+0.5)/21.3333; vec2 d=q.xz-vAssetWP.xz; q.y=vAssetWP.y-(N.x*d.x+N.z*d.y)/(N.y>=0.0?max(N.y,0.3):min(N.y,-0.3)); }
 else if(aN.x>=aN.z){ q.zy=(floor(q.zy*21.3333)+0.5)/21.3333; vec2 d=q.zy-vAssetWP.zy; q.x=vAssetWP.x-(N.z*d.x+N.y*d.y)/(N.x>=0.0?max(N.x,0.3):min(N.x,-0.3)); }
 else { q.xy=(floor(q.xy*21.3333)+0.5)/21.3333; vec2 d=q.xy-vAssetWP.xy; q.z=vAssetWP.z-(N.x*d.x+N.y*d.y)/(N.z>=0.0?max(N.z,0.3):min(N.z,-0.3)); }
 return assetShadowGridP(N,q);
}
#else
float assetShadowGridP(vec3 N,vec3 q){return getShadowMask();}
float assetShadowGrid(vec3 N){return getShadowMask();}
#endif
`+clean(material.fragmentShader);
   // as paletas são cores de tela (sRGB); o jogo trabalha em linear e converte na saída
   const toLinear=material.userData.pixelTree?' gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(2.2)) * '+(material.userData.brightness ?? 0.62).toFixed(3)+';':'';
   // Casca: o texel é uma célula de (ângulo em volta do tronco, altura) da própria casca (o shader da casca: texelsAround x uTexelsPerMetre); o ponto da sombra vai para o
   // centro dessa célula, deslocado pela superfície (derivadas da célula em tela e da posição no mundo), então a borda da sombra segue as mesmas células da casca.
   const gridDraw=`
 if(uObjGrid>0.5){
  ${isBark?'':'vec2 objG=vec2(0.0); float objGOn=1.0; { vec3 gN=abs('+(hasNormal?'normalize(vNormal)':'normalize(cross(dFdx(vAssetWP),dFdy(vAssetWP)))')+'); objG=(gN.y>=gN.x&&gN.y>=gN.z?vAssetWP.xz:(gN.x>=gN.z?vAssetWP.zy:vAssetWP.xy))*21.3333; }'}
  if(objGOn>0.5){
   vec2 gF=abs(fract(objG-0.5)-0.5)/max(fwidth(objG),vec2(1e-4));
   float gLine=1.0-min(1.0,min(gF.x,gF.y));
   gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(1.0,0.1,0.1),gLine*0.85);
  }
 }`;
   const barkSnap=isBark?`
 vec3 barkShadowP=vAssetWP; vec2 objG=vec2(0.0); float objGOn=0.0; vec2 bGs=vec2(0.0);
 if(uLobedMode>0.5&&vWood.z>0.001){
  float bR=max(0.02,vWood.x);
  float bAC=(floor(vWood.y*uTexelsPerMetre)+0.5)/uTexelsPerMetre;
  vec2 bgA=vec2(dFdx(vWood.y),dFdy(vWood.y));
  float bdR=dot(bgA,bgA)>1e-8?(dFdx(bR)*bgA.x+dFdy(bR)*bgA.y)/dot(bgA,bgA):0.0;
  float bRR=max(0.02,bR+clamp((bAC-vWood.y)*bdR,-0.006,0.006));
  float bNB=max(8.0,8.0*floor(6.2831853*vWood.z*uTexelsPerMetre/8.0+0.5));
  float bTA=bNB;
  float bAU=vAngleU;
  if(dot(vBarkAngle,vBarkAngle)>0.01)bAU=atan(vBarkAngle.y,vBarkAngle.x)*0.15915494+0.5;
  vec2 bG=vec2(bAU*bTA,vWood.y*uTexelsPerMetre);
  objG=bG; objGOn=1.0; bGs=bG;
  { vec3 bNc; cellCentreSmooth(vAssetWP,normalize(vNormal),bG,floor(bG)+0.5,0.0,barkShadowP,bNc);   /* nx = 0: o ponto vem do grid de mundo (abaixo), igual para qualquer triângulo */ }
 } else {
  vec2 bG=vBarkUv*vec2(textureSize(uStruct,0));
  objG=bG; objGOn=1.0; bGs=bG;
  { vec3 bNc; cellCentreSmooth(vAssetWP,normalize(vNormal),bG,floor(bG)+0.5,0.0,barkShadowP,bNc);   /* casca de textura: nx = 0, o ponto vem do grid de mundo (abaixo) */ }
 }

 // A sombra da casca é a MÉDIA de 9 leituras ao redor do centro da célula (centro e 8 vizinhas a 2,5 a 3,5 cm): as sombras que vêm das folhas têm furos de poucos centímetros, e uma
 // única leitura mudava de lado com qualquer erro de milímetros no centro da célula (a borda da sombra cortava as células). Com a média o resultado é o mesmo em todos os
 // pixels da célula e some quando a câmera se mexe; o corte em tudo ou nada vem depois (step).
 // A normal e o ponto da leitura são IGUAIS para todos os pixels da célula: a normal é a normal arredondada da própria casca (N, a mesma do tom) e o ponto é o centro 3D da
 // célula do grid de mundo (21,33 por metro) empurrado 4,5 cm para fora por essa normal. Antes a terceira coordenada acompanhava cada pixel, e numa parede curva o ponto
 // andava até uns 4 cm dentro da célula, o bastante para cair noutro buraco da sombra das folhas e cortar a célula ao meio.
 vec3 bNn=normalize(vNormal);
 { float hq=length(bNn.xz); float stq=6.2831853/max(colsQ,6.0); float azq=(floor(atan(bNn.z,bNn.x)/stq)+0.5)*stq; bNn=normalize(vec3(cos(azq)*hq,floor(bNn.y*12.0+0.5)/12.0,sin(azq)*hq)); }
 // Nas paredes do tronco (normal quase horizontal) a célula é CILÍNDRICA, como a da casca: colunas por azimute da normal (o mesmo número de colunas da casca) e linhas pela
 // altura de mundo. O centro é o ponto do mesmo círculo girado até o meio da coluna (raio vindo das derivadas da posição e do azimute) com a altura no meio da linha: no
 // olho os degraus ficam em colunas e linhas do tronco, e não em diagonais como o grid de eixos de mundo faz numa superfície redonda. Fora das paredes (raiz que se
 // abre, topo) vale o centro 3D do grid de mundo.
 // A CÉLULA DA SOMBRA é polar em volta do eixo do tronco (a origem da instância): colunas de ~4,7 cm (21,33 por metro, a densidade da grama) por azimute e linhas de 4,7 cm
 // por altura de mundo. Só usa números estáveis (posição, origem, altura), sem derivadas, e é igual para qualquer triângulo; os degraus saem em colunas e linhas do
 // tronco, e não em diagonais como o grid de eixos de mundo faz num tronco redondo. Fora das paredes (normal pouco horizontal) vale o centro 3D do grid de mundo.
 vec3 bP=(floor(vAssetWP*21.3333)+0.5)/21.3333;
 {
  vec2 rel=vAssetWP.xz-vAssetOrg.xz;
  float Rf=length(rel);
  float hl1=length(normalize(vNormal).xz);
  if(hl1>0.6&&Rf>0.04&&Rf<3.0){
   float Rc=(floor(Rf*21.3333)+0.5)/21.3333;
   float nSec=max(8.0,floor(6.2831853*Rc*21.3333+0.5));
   float stp=6.2831853/nSec;
   float azc=(floor(atan(rel.y,rel.x)/stp)+0.5)*stp;
   vec2 dirc=vec2(cos(azc),sin(azc));
   bP=vec3(vAssetOrg.x+dirc.x*Rc,(floor(vAssetWP.y*21.3333)+0.5)/21.3333,vAssetOrg.z+dirc.y*Rc);
   bNn=normalize(vec3(dirc.x*hl1,floor(normalize(vNormal).y*12.0+0.5)/12.0,dirc.y*hl1));
  }
 }
 // PRIMEIRO o centro EXATO da célula da textura (coluna e linha da própria casca, a grade do F4), com o limite acompanhando o tamanho da célula (as linhas da bétula são altas:
 // o centro fica a até uns 10 cm do pixel, e um limite fixo descartava o centro certo). Só se o cálculo falhar valem a célula polar acima.
 {
  vec3 bPc=vAssetWP; vec3 bNc2=vec3(0.0);
  cellCentreSmooth(vAssetWP,normalize(vNormal),bGs,floor(bGs)+0.5,0.0,bPc,bNc2);
  if(length(bPc-vAssetWP)>1e-5&&length(bNc2)>0.5){ bP=bPc; bNn=normalize(vec3(bNc2.x,max(bNc2.y,-0.2),bNc2.z)); }
 }
 barkShadowP=bP+bNn*0.045;
 vec3 bT=cross(bNn,vec3(0.0,1.0,0.0));
 bT=dot(bT,bT)>1e-4?normalize(bT):vec3(1.0,0.0,0.0);
 vec3 bB=cross(bNn,bT);
 float barkShadowV=(assetShadowGridP(bNn,barkShadowP)*2.0+assetShadowGridP(bNn,barkShadowP+bT*0.035)+assetShadowGridP(bNn,barkShadowP-bT*0.035)+assetShadowGridP(bNn,barkShadowP+bB*0.035)+assetShadowGridP(bNn,barkShadowP-bB*0.035)+assetShadowGridP(bNn,barkShadowP+(bT+bB)*0.025)+assetShadowGridP(bNn,barkShadowP+(bT-bB)*0.025)+assetShadowGridP(bNn,barkShadowP-(bT+bB)*0.025)+assetShadowGridP(bNn,barkShadowP-(bT-bB)*0.025))/10.0;
`:'';
   material.fragmentShader=injectMain(material.fragmentShader,`{
${barkSnap}${toLinear} gl_FragColor.rgb *= uAssetAmbient + uAssetSun * mix(step(0.5,${snapShadow?(isBark?'barkShadowV':hasNormal?'assetShadowGrid(normalize(vNormal))':'assetShadowGrid(normalize(cross(dFdx(vAssetWP),dFdy(vAssetWP))))'):'getShadowMask()'}), 1.0, uAssetLeafFill);
 ${gridDraw}
 #include <fog_fragment>
${material.userData.pixelTree?' #include <colorspace_fragment>':''}
}`,true);
   // Palette shaders previously added an artificial camera-facing glow.
   for(const name of ['uRimIntensity','uRimLightIntensity'])if(material.uniforms[name])material.uniforms[name].value=0;
   material.needsUpdate=true;
  }
  // Mapped basic materials on vegetation and windows should receive real lighting.
  for(let i=0;i<materials.length;i++){
   const basic=materials[i];
   if(basic instanceof THREE.MeshBasicMaterial&&basic.toneMapped){
    const lit=new THREE.MeshStandardMaterial({map:basic.map,color:basic.color,side:basic.side,alphaTest:basic.alphaTest,transparent:basic.transparent,opacity:basic.opacity,depthWrite:basic.depthWrite,alphaMap:basic.alphaMap,vertexColors:basic.vertexColors,wireframe:basic.wireframe,roughness:1,fog:true});
    const existing=litMaterials.get(basic);
    if(existing){lit.dispose();materials[i]=existing;}else{
     lit.name=basic.name;litMaterials.set(basic,lit);materials[i]=lit;
     basic.addEventListener('dispose',()=>lit.dispose());
    }
   }
  }
  object.material=Array.isArray(object.material)?materials:materials[0];
  object.receiveShadow=true;
  const previous=object.onBeforeRender;
  object.onBeforeRender=function(renderer,scene,camera,geometry,material,group){
   previous.call(this,renderer,scene,camera,geometry,material,group);
   if(!(material instanceof THREE.ShaderMaterial)||!material.userData.assetEnvironment)return;
   const uniforms=material.uniforms;
   if(this instanceof THREE.Sprite&&uniforms.center)uniforms.center.value.copy(this.center);
   // as matrizes da câmera e a luz valem para o quadro inteiro: o material é compartilhado por dezenas de malhas e recopiava tudo a cada uma
   // (~600 vezes por quadro). Copia só na primeira vez que o material aparece num desenho (quadro e câmera novos).
   const frameNow=renderer.info.render.frame,ud=material.userData;
   if(ud.assetFrame===frameNow&&ud.assetCam===camera)return;
   ud.assetFrame=frameNow;ud.assetCam=camera;
   uniforms.uAssetInverseProjection.value.copy(camera.projectionMatrixInverse);
   uniforms.uAssetCameraWorld.value.copy(camera.matrixWorld);
   let lighting=sceneLighting.get(scene);
   if(!lighting||lighting.frame!==renderer.info.render.frame){
    lighting={frame:renderer.info.render.frame,ambient:new THREE.Color(0,0,0),sun:new THREE.Color(0,0,0),direction:new THREE.Vector3(0,1,0)};
    // (as luzes são filhas diretas da cena: não precisa percorrer os mais de mil objetos)
    for(const light of scene.children){
     if(!light.visible)continue;
     if(light instanceof THREE.HemisphereLight)lighting!.ambient.add(light.color.clone().multiplyScalar(.3*light.intensity/.75));
     if(light instanceof THREE.AmbientLight)lighting!.ambient.add(light.color.clone().multiplyScalar(.3*light.intensity));
     if(light instanceof THREE.DirectionalLight){
      lighting!.sun.add(light.color.clone().multiplyScalar(.7*light.intensity/1.45));
      lighting!.direction.setFromMatrixPosition(light.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld)).normalize();
     }
    }
    sceneLighting.set(scene,lighting);
   }
   uniforms.uAssetAmbient.value.copy(lighting.ambient);uniforms.uAssetSun.value.copy(lighting.sun);
   if(uniforms.uLightDir?.value instanceof THREE.Vector3)uniforms.uLightDir.value.copy(lighting.direction);
   // a casca (uLobedMode) fica com a luz de desenho fixa: o tom dos sulcos e das faces não pode andar pelo tronco enquanto o sol se move; a luz do sol e a sombra de verdade continuam vindo do resto do shader
   if(!uniforms.uLobedMode&&uniforms.uTexLightDir?.value instanceof THREE.Vector3)uniforms.uTexLightDir.value.copy(lighting.direction);
  };
 });
}

/** Run after the final output, including early exits used by snow/leaf palettes. */
function injectMain(shader:string,code:string,earlyReturns:boolean){
 const match=/void\s+main\s*\([^)]*\)\s*\{/.exec(shader);if(!match)throw new Error('Asset shader has no main');
 const start=match.index+match[0].length;let depth=1,end=start;
 for(;end<shader.length;end++){if(shader[end]==='{')depth++;else if(shader[end]==='}'&&--depth===0)break;}
 let body=shader.slice(start,end);
 if(earlyReturns)body=body.replace(/\breturn\s*;/g,code+'\nreturn;');
 return shader.slice(0,start)+body+'\n'+code+'\n'+shader.slice(end);
}
