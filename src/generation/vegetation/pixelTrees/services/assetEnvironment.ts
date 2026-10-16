// @ts-nocheck
import * as THREE from 'three';

/** Give custom pixel shaders the same scene shadows and fog as standard materials. */
// A luz da cena é calculada UMA vez por quadro e vale para todos os objetos. Antes este cache era criado dentro da função
// (um por malha instanciada, uns 600): cada malha refazia o percurso pela cena inteira a cada quadro (~70 ms de CPU).
const sceneLighting=new WeakMap<THREE.Scene,{frame:number;ambient:THREE.Color;sun:THREE.Color;direction:THREE.Vector3}>();
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
    uAssetAmbient:{value:new THREE.Color(.3,.3,.3)},uAssetSun:{value:new THREE.Color(.7,.7,.7)}
   });
   const clean=(shader:string)=>shader.replace(/#include <(?:common|fog_(?:pars_vertex|pars_fragment|vertex|fragment))>/g,'');
   const common=(_shader:string)=>'#include <common>\n';
   material.vertexShader=common(material.vertexShader)+`uniform mat4 uAssetInverseProjection,uAssetCameraWorld;
varying vec3 vAssetWP;
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
`+clean(material.vertexShader);
   material.vertexShader=injectMain(material.vertexShader,`{
 vec4 mvPosition=uAssetInverseProjection*gl_Position;
 mvPosition/=mvPosition.w;
 vec4 worldPosition=uAssetCameraWorld*mvPosition;
 vec3 transformedNormal=normalize(normalMatrix*normal);
 vAssetWP=worldPosition.xyz;
 #include <shadowmap_vertex>
 #include <fog_vertex>
}`,false);
   // A sombra do sol nos objetos (árvores, pedras, plantas) é lida no CENTRO do texel do mundo (21,3 texels por metro, a mesma grade do chão e da grama),
   // e não por pixel da tela: a borda da sombra anda em degraus de pixel, como a do chão. Precisa da normal do mundo (vNormal) para o afastamento
   // contra manchas; sem ela, volta à sombra comum.
   const snapShadow=/varying\s+vec3\s+vNormal\s*;/.test(material.fragmentShader);
   material.userData.snapShadow=snapShadow;
   material.fragmentShader=common(material.fragmentShader)+`#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
uniform vec3 uAssetAmbient,uAssetSun;
uniform float uAssetLeafFill;
varying vec3 vAssetWP;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
float assetShadowGrid(vec3 N){
 float shadow=1.0;
 vec3 q=(floor(vAssetWP*21.3333)+0.5)/21.3333;
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
#else
float assetShadowGrid(vec3 N){return getShadowMask();}
#endif
`+clean(material.fragmentShader);
   // as paletas são cores de tela (sRGB); o jogo trabalha em linear e converte na saída
   const toLinear=material.userData.pixelTree?' gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(2.2)) * '+(material.userData.brightness ?? 0.62).toFixed(3)+';':'';
   material.fragmentShader=injectMain(material.fragmentShader,`{
${toLinear} gl_FragColor.rgb *= uAssetAmbient + uAssetSun * mix(${snapShadow?'assetShadowGrid(normalize(vNormal))':'getShadowMask()'}, 1.0, uAssetLeafFill);
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
   if(uniforms.uTexLightDir?.value instanceof THREE.Vector3)uniforms.uTexLightDir.value.copy(lighting.direction);
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
