import * as THREE from 'three';
import { Hydrology } from './hydrology.ts';
import { WaterfallFeature, waterfallWorld, waterfallCenter, waterfallWidth } from './waterfallFeatures.ts';
import { createWaterfallGeometry } from './waterfallGeometry.ts';
import { CascadeVertexShader } from '../shaders/cascadeVertex.ts';
import { WaterShader } from '../shaders/waterShader.ts';
import { cascadeTextureFunctions, cascadeSurfaceColor } from '../shaders/cascadeSurface.ts';
import { PRNG } from '../math/prng.ts';
import { CONFIG } from '../../config.ts';
import { createImpactFoam } from './impactFoam.ts';

const EXTRA_REFLECTIONS:boolean=true;

/** Native water pass, terrain and uniforms; the receiving pool remains the existing ocean. */
export class InlandWaterManager {
 private group=new THREE.Group();
 private entries=new Map<string,{group:THREE.Group;feature:WaterfallFeature}>();
 private hydro:Hydrology;
 private material:THREE.ShaderMaterial;
 private reflectionMaterial:THREE.ShaderMaterial;
 private native:THREE.ShaderMaterial;
 private pixelScale={value:800};
 private impacts={value:Array.from({length:12},()=>new THREE.Vector4(0,0,0,0))};
 private impactDirections={value:Array.from({length:12},()=>new THREE.Vector2(0,1))};
 private surfaceTarget=new THREE.WebGLRenderTarget(512,512,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
 private surfaceCamera=new THREE.PerspectiveCamera();
 private surfaceMatrix={value:new THREE.Matrix4()};
 private surfacePlane={value:new THREE.Vector4()};
 private surfaceReady={value:0};
 private springTarget=new THREE.WebGLRenderTarget(512,512,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
 private springMatrix={value:new THREE.Matrix4()};
 private springHeight={value:0};
 private springReady={value:0};
 private lastReflectionAt=-Infinity;
 private lastReflectionKey='';
 private reflectionFrustum=new THREE.Frustum();
 private reflectionView=new THREE.Matrix4();
 constructor(waterRoot:THREE.Group,hydrology:Hydrology,native:THREE.ShaderMaterial){
  this.hydro=hydrology;this.native=native;this.group.name='inland_water_system';waterRoot.add(this.group);
  native.uniforms.uCascadeImpacts=this.impacts;
  native.uniforms.uCascadeDirections=this.impactDirections;
  native.uniforms.tCascadeReflection={value:this.surfaceTarget.texture};
  native.uniforms.uCascadeReflectMatrix=this.surfaceMatrix;
  native.uniforms.uCascadeReflectionPlane=this.surfacePlane;
  native.uniforms.uCascadeReflectionReady=this.surfaceReady;
  native.uniforms.tSpringReflection={value:this.springTarget.texture};
  native.uniforms.uSpringReflectMatrix=this.springMatrix;
  native.uniforms.uSpringReflectionHeight=this.springHeight;
  native.uniforms.uSpringReflectionReady=this.springReady;
  this.material=new THREE.ShaderMaterial({uniforms:native.uniforms,transparent:true,depthWrite:true,side:THREE.DoubleSide,
   vertexShader:CascadeVertexShader,
   // Native water upstream blends into a dedicated descending curtain texture.
   fragmentShader:WaterShader.fragmentShader
    .replace('varying vec2 vUv;', 'varying vec2 vUv;varying vec2 vFlowPosition;varying vec3 vSurfaceNormal;'+cascadeTextureFunctions)
    .replace('vec2 worldGrid = floor(vWorldPosition.xz * pixelDensity) / pixelDensity;', 'vec2 worldGrid = floor(vFlowPosition * pixelDensity) / pixelDensity;')
    .replace('vec2 foamGrid = floor(vWorldPosition.xz * foamDensity) / foamDensity;', 'vec2 foamGrid = floor(vFlowPosition * foamDensity) / foamDensity;')
    .replace('vec2 worldGrid =', 'float cascadeSceneDepth = mix(verticalDepth, depthDifference * clamp(abs(dot(viewDir,normalize(vSurfaceNormal))),.18,1.), smoothstep(.01,.4,1.-abs(normalize(vSurfaceNormal).y)));\n      verticalDepth = mix(verticalDepth, 1.1, smoothstep(.01,.4,1.-abs(normalize(vSurfaceNormal).y)));\n      vec2 worldGrid =')
    .replace('vec3 fragNormal = normalize(vec3(-dhdx * 1.5, 1.0, -dhdz * 1.5));', `vec3 fragNormal = normalize(vec3(-dhdx * 1.5, 1.0, -dhdz * 1.5));
      fragNormal = normalize(mix(fragNormal, normalize(vSurfaceNormal), smoothstep(.01,.4,1.-abs(normalize(vSurfaceNormal).y))));`)
    .replace('float reflStrength = clamp(0.08 + fresnel * 0.32, 0.0, 0.40);', 'float reflStrength = clamp(0.08 + fresnel * 0.32, 0.0, 0.40) * pow(abs(normalize(vSurfaceNormal).y), 2.);')
    .replace('vec3 sampledReflectColor = texture2D(tPlanarReflection, finalReflectUv).rgb;', 'vec3 sampledReflectColor = texture2D(tSpringReflection, finalReflectUv).rgb;')
    .replace('// Blend planar reflection into water', `reflStrength *= step(.5,uSpringReflectionReady)*(1.-smoothstep(.05,.7,abs(vWorldPosition.y-uSpringReflectionHeight)));
      // Blend planar reflection into water`)
    .replace('// névoa (a água', cascadeSurfaceColor+'\n      // névoa (a água')
    .replace('if (uThermal > 0.5) {\n        // distância ao centro da poça', 'if (uThermal > 0.5 || vPool.z > 0.001) {\n        // distância ao centro da poça')
    .replace('if (tring < 0.06 && td > 0.12 && td < 0.9)', 'if (uThermal > 0.5 && tring < 0.06 && td > 0.12 && td < 0.9)')
    .replace('smoothstep(0.90, 1.0, td) * 0.6);', 'smoothstep(0.90, 1.0, td) * 0.6 * step(0.5, uThermal));')
    .replace('gl_FragColor = vec4(finalColor, uOpacity);','gl_FragColor = vec4(finalColor, cascadeOpacity);')
  });
  // Reflection uses the same animated water colors, with opaque-scene depth
  // testing from the reflection target. Never sample the target being written.
  this.reflectionMaterial=new THREE.ShaderMaterial({uniforms:native.uniforms,transparent:true,depthWrite:true,side:THREE.DoubleSide,
   vertexShader:this.material.vertexShader,
   fragmentShader:this.material.fragmentShader
    .replace('float sceneDepthRaw = texture2D(tDepth, screenUv).r;', 'if(vWorldPosition.y<.05)discard; float sceneDepthRaw = 1.;')
    .replace('vec3 sampledReflectColor = texture2D(tSpringReflection, finalReflectUv).rgb;', 'vec3 sampledReflectColor = waterBase;')
    .replace('if(uCascadeReflectionReady>.5&&uIsOrthographic<.5', 'if(false&&uCascadeReflectionReady>.5&&uIsOrthographic<.5')
  });
 }
 public renderSurfaceReflection(renderer:THREE.WebGLRenderer,camera:THREE.PerspectiveCamera,scene:THREE.Scene){
  // A água das cachoeiras usa o reflexo normal do jogo (o do mar, atualizado todo quadro): os reflexos
  // extras eram guardados e só atualizados 12 vezes por segundo, e davam saltos ao mexer a câmera.
  if(!EXTRA_REFLECTIONS){this.surfaceReady.value=0;this.springReady.value=0;return;}
  camera.updateMatrixWorld();
  this.reflectionFrustum.setFromProjectionMatrix(this.reflectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  let nearest:WaterfallFeature|undefined,best=180;
  let seeCurtain=false,seeSpring=false;
  for(const e of this.entries.values()){
   const f=e.feature,d=Math.hypot(camera.position.x-f.x,camera.position.z-f.z);if(d>=best)continue;
   const curtain=this.reflectionFrustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(f.x+f.fx*f.radius,f.upper*.5,f.z+f.fz*f.radius),Math.hypot(f.width*.6,f.upper*.5)));
   const spring=camera.position.y>f.upper+.1&&this.reflectionFrustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(f.x-f.fx*f.length*.5,f.upper,f.z-f.fz*f.length*.5),Math.hypot(f.length*.5,f.width)));
   if(curtain||spring){best=d;nearest=f;seeCurtain=curtain;seeSpring=spring;}
  }
  if(!nearest){this.surfaceReady.value=0;this.springReady.value=0;this.lastReflectionKey='';return;}
  const key=nearest.id+':'+Number(seeCurtain)+Number(seeSpring),now=performance.now();
  // Retain both texture AND its projection matrix between updates.
  void now; void this.lastReflectionKey; void this.lastReflectionAt;
  this.lastReflectionKey=key;this.lastReflectionAt=now;
  this.surfaceReady.value=0;this.springReady.value=0;
  const f=nearest,point=new THREE.Vector3(f.x+f.fx*(f.radius+.09),0,f.z+f.fz*(f.radius+.09));
  const normal=new THREE.Vector3(f.fx,0,f.fz);
  if(camera.position.clone().sub(point).dot(normal)<0)normal.negate();
  const mirror=(p:THREE.Vector3)=>p.addScaledVector(normal,-2*p.clone().sub(point).dot(normal));
  const look=camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()));
  const reflected=this.surfaceCamera;reflected.copy(camera,false);
  reflected.position.copy(mirror(camera.position.clone()));reflected.up.copy(camera.up);
  reflected.lookAt(mirror(look));reflected.updateMatrixWorld();
  this.surfaceMatrix.value.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1)
   .multiply(reflected.projectionMatrix).multiply(reflected.matrixWorldInverse);
  this.surfacePlane.value.set(point.x,point.z,f.fx,f.fz);
  const oldTarget=renderer.getRenderTarget(),oldClip=renderer.clippingPlanes,oldShadows=renderer.shadowMap.enabled;
  if(seeCurtain){
   renderer.shadowMap.enabled=false;
   renderer.clippingPlanes=[new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point)];
   renderer.setRenderTarget(this.surfaceTarget);renderer.clear();
   try{renderer.render(scene,reflected);this.surfaceReady.value=1;}finally{
    renderer.setRenderTarget(oldTarget);renderer.clippingPlanes=oldClip;renderer.shadowMap.enabled=oldShadows;
   }
  }
  if(!seeSpring)return;
  // The spring is a horizontal surface at its own elevation, not sea level.
  point.set(0,f.upper,0);normal.set(0,1,0);
  const springLook=camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()));
  reflected.copy(camera,false);reflected.position.copy(mirror(camera.position.clone()));
  reflected.up.set(0,-1,0);reflected.lookAt(mirror(springLook));reflected.updateMatrixWorld();
  this.springMatrix.value.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1)
   .multiply(reflected.projectionMatrix).multiply(reflected.matrixWorldInverse);
  this.springHeight.value=f.upper;
  renderer.shadowMap.enabled=false;
  renderer.clippingPlanes=[new THREE.Plane(normal.clone(),.05-f.upper)];
  renderer.setRenderTarget(this.springTarget);renderer.clear();
  try{renderer.render(scene,reflected);this.springReady.value=1;}finally{
   renderer.setRenderTarget(oldTarget);renderer.clippingPlanes=oldClip;renderer.shadowMap.enabled=oldShadows;
  }
 }
 public renderReflection(renderer:THREE.WebGLRenderer,camera:THREE.Camera){
  const meshes:THREE.Mesh[]=[],spray:THREE.Points[]=[];
  this.group.traverse(o=>{if(o instanceof THREE.Mesh){meshes.push(o);o.material=this.reflectionMaterial;}else if(o instanceof THREE.Points){spray.push(o);o.visible=false;}});
  const autoClear=renderer.autoClear;renderer.autoClear=false;
  try{renderer.render(this.group,camera);}finally{
   renderer.autoClear=autoClear;for(const mesh of meshes)mesh.material=this.material;for(const points of spray)points.visible=true;
  }
 }
 public rebuild(hydrology:Hydrology){
  this.lastReflectionKey='';this.lastReflectionAt=-Infinity;this.surfaceReady.value=0;this.springReady.value=0;
  for(const id of [...this.rocks.keys()])this.removeRocks(id);
  for(const e of this.entries.values())this.dispose(e.group);this.entries.clear();this.hydro=hydrology;this.refreshImpacts();
 }
 private dispose(group:THREE.Group){
  group.removeFromParent();group.traverse(o=>{const p=o as THREE.Mesh;if(p.geometry)p.geometry.dispose();if(p.material&&p.material!==this.material)(p.material as THREE.Material).dispose();});
 }
 public updateObserver(x:number,z:number){
  const G=CONFIG.ISLAND_GRID_SIZE,cx=Math.round(x/G),cz=Math.round(z/G);
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(const f of this.hydro.getWaterfalls(cx+dx,cz+dz)){
   if(Math.hypot(x-f.x,z-f.z)>950||this.entries.has(f.id))continue;
   const group=new THREE.Group();group.name=f.id;
   const mesh=new THREE.Mesh(createWaterfallGeometry(f).geometry,this.material);mesh.renderOrder=2;group.add(mesh);
   this.addSpray(group,f);this.addSpray(group,f,true);this.addRocks(f);group.add(createImpactFoam(f,this.native,this.pixelScale));this.group.add(group);this.entries.set(f.id,{group,feature:f});
  }
  for(const [key,e] of this.entries)if(Math.hypot(x-e.feature.x,z-e.feature.z)>1150){this.dispose(e.group);this.removeRocks(key);this.entries.delete(key);}
  this.refreshImpacts();
 }
 private refreshImpacts(){
  this.impacts.value.forEach(p=>p.set(0,0,0,0));let i=0;
  for(const e of this.entries.values()){if(i>=12)break;const f=e.feature,p=waterfallWorld(f,0,f.radius+.9,0);this.impacts.value[i].set(p.x,p.z,f.width*.55,1);this.impactDirections.value[i++].set(f.fx,f.fz);}
 }
 private addSpray(group:THREE.Group,f:WaterfallFeature,spring=false){
  const rng=new PRNG(spring?f.id+'/spring-mist':f.id),pos:number[]=[],velocity:number[]=[],param:number[]=[];
  for(let i=0;i<(spring?22:144);i++){
   const mist=spring||i<60;
   // nascente: flocos sobre a superfície do lago (a névoa leve de um lugar úmido e fresco)
   const sz=-f.length+24+(rng.next()-.5)*26;
   const p=spring
    ?waterfallWorld(f,waterfallCenter(f,sz)+(rng.next()-.5)*waterfallWidth(f,sz)*.8,sz,f.upper+.12)
    :waterfallWorld(f,(rng.next()-.5)*f.width*1.18,f.radius+.5+rng.next()*2,.1);
   pos.push(p.x,p.y,p.z);
   const vx=(rng.next()-.5)*(mist?1.4:5),vz=mist?.3+rng.next()*.6:1+rng.next()*3;
   velocity.push(vx*f.fz+vz*f.fx,mist?.45+rng.next()*.4:3+rng.next()*5,-vx*f.fx+vz*f.fz);
   // nascente: flocos pequenos e finos (pixels pequenos), bem mais leves que o vapor da cortina
   if(spring)param.push(rng.next(),5+rng.next()*3,.9+rng.next()*.9,-1);
   else param.push(rng.next(),mist?3+rng.next()*2:1+rng.next()*.7,mist?2.5+rng.next()*2:.055+rng.next()*.08,mist?0:1);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('velocity',new THREE.Float32BufferAttribute(velocity,3));geo.setAttribute('params',new THREE.Float32BufferAttribute(param,4));
  const u=this.native.uniforms;
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uTime:u.uTime,uResolution:u.uResolution,tDepth:u.tDepth,uFoamColor:u.uFoamColor,uFogColor:u.uFogColor,uFogNear:u.uFogNear,uFogFar:u.uFogFar,pixelScale:this.pixelScale,uTexelDensity:u.uTexelDensity},
   vertexShader:`attribute vec3 velocity;attribute vec4 params;uniform float uTime,pixelScale;varying float alpha,kind,phase,dist,sizeM;
   void main(){float age=fract(uTime/params.y+params.x),t=age*params.y;vec3 p=position+velocity*t;kind=params.w;phase=params.x*19.+t*.2;sizeM=params.z*(kind>.5?1.8:.85+age*.8);
   if(kind>.5)p.y-=4.9*t*t;else{p.x+=sin(phase)*.4;p.z+=cos(phase)*.4;}
   alpha=sin(age*3.14159)*(kind<-.5?.3:(kind>.5?.85:.48))*smoothstep(.02,.2,p.y);vec4 mv=modelViewMatrix*vec4(p,1.);dist=length(mv.xyz);gl_Position=projectionMatrix*mv;
   float perspective=projectionMatrix[3][3]>.5?1.:max(.1,-mv.z);
   gl_PointSize=clamp(params.z*(kind>.5?1.8:.85+age*.8)*pixelScale*projectionMatrix[1][1]/perspective,1.,150.);}`,
   fragmentShader:`uniform sampler2D tDepth;uniform vec2 uResolution;uniform vec3 uFoamColor,uFogColor;uniform float uFogNear,uFogFar,uTexelDensity;varying float alpha,kind,phase,dist,sizeM;
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
   void main(){if(gl_FragCoord.z>texture2D(tDepth,gl_FragCoord.xy/uResolution).r+.00001)discard;
   vec2 q=gl_PointCoord-.5;float density;
   if(kind<.5){
    float cg=kind<-.5?clamp(floor(sizeM*uTexelDensity+.5),4.,64.):12.;
    q=(floor(gl_PointCoord*cg)+.5)/cg-.5;
    float cloud=max(.32-length(q*vec2(1.,1.15)),max(.23-length(q-vec2(-.20,.02)),.25-length(q-vec2(.18,-.06))));
    if(cloud<0.)discard;
    float n=noise(q*5.+floor(phase*4.)/4.);
    density=(.35+floor(n*3.)*.2)*mix(.6,1.,step(.07,cloud));
   }
   else{q.x*=2.1;density=1.-smoothstep(.1,.46,length(q));}
   float a=density*alpha;if(a<.003)discard;vec3 color=mix(uFoamColor,vec3(.9,.97,1.),.3);color=mix(color,uFogColor,smoothstep(uFogNear,uFogFar,dist));gl_FragColor=vec4(color,a);}`
  });
  const points=new THREE.Points(geo,mat);points.renderOrder=3;points.frustumCulled=false;group.add(points);
 }
 /** onde ficam as pedras da margem da nascente (a cena do mundo) e como ler a altura do terreno */
 public sceneRoot:THREE.Object3D|null=null;
 public heightAt:((x:number,z:number)=>number)|null=null;
 private rocks=new Map<string,THREE.InstancedMesh>();
 private removeRocks(id:string){
  const m=this.rocks.get(id);if(!m)return;
  m.removeFromParent();m.geometry.dispose();(m.material as THREE.Material).dispose();m.dispose();this.rocks.delete(id);
 }
 /** Pedras em volta do lago da nascente: a margem de pedras de onde a água brota. */
 private addRocks(f:WaterfallFeature){
  if(!this.sceneRoot||!this.heightAt||this.rocks.has(f.id))return;
  const rng=new PRNG(f.id+'/rocks'),N=34,zc=-f.length+24;
  const mesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshLambertMaterial({flatShading:true}),N);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),s=new THREE.Vector3(),pv=new THREE.Vector3(),col=new THREE.Color();
  for(let i=0;i<N;i++){
   const z=zc+(rng.next()-.5)*44,c=waterfallCenter(f,z),half=waterfallWidth(f,z)*.5,side=rng.next()<.5?-1:1;
   // mais pedras junto da margem do lago, menos ao longo do riacho
   const p=waterfallWorld(f,c+side*(half+.3+rng.next()*2.4),z,0),y=this.heightAt(p.x,p.z);
   const k=.4+rng.next()*rng.next()*1.5;
   e.set(rng.next()*.6,rng.next()*6.28,rng.next()*.6);q.setFromEuler(e);
   s.set(k*(1+rng.next()*.5),k*.62,k*(1+rng.next()*.5));
   pv.set(p.x,y+k*.12,p.z);m.compose(pv,q,s);mesh.setMatrixAt(i,m);
   const g=.36+rng.next()*.2;col.setRGB(g,g*1.03,g*1.1);mesh.setColorAt(i,col);
  }
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.name=f.id+'/spring_rocks';mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;
  this.sceneRoot.add(mesh);this.rocks.set(f.id,mesh);
 }
 /** pede uma ondulação na água (worldEngine liga ao addRipple) */
 public onRipple:((x:number,z:number)=>void)|null=null;
 private springT=0;
 public update(dt:number,observerX=0,observerZ=0){
  // NASCENTE: a água brota no centro do lago em anéis que se abrem, a cada ~1 s (só das que estão perto)
  this.springT-=dt;
  if(this.springT>0||!this.onRipple)return;
  this.springT=.9;
  for(const e of this.entries.values()){
   const f=e.feature,zc=-f.length+24,c=waterfallCenter(f,zc),p=waterfallWorld(f,c,zc,0);
   if(Math.hypot(observerX-p.x,observerZ-p.z)>140)continue;
   const a=Math.random()*Math.PI*2,r=Math.random()*1.6;
   this.onRipple(p.x+Math.cos(a)*r,p.z+Math.sin(a)*r);
  }
 }
 public syncLighting(_direction:THREE.Vector3,_sun:THREE.Color,_fog:THREE.Color){}
 public syncResolution(height:number){this.pixelScale.value=height*.5;}
 public getGroup(){return this.group;}
 public getFeatures(){return [...this.entries.values()].map(e=>e.feature);}
}





