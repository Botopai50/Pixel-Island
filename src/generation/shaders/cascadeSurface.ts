/** The game's cellular pixel water, reinterpreted as a descending, aerated sheet. */
export const cascadeTextureFunctions = /* glsl */ `
 varying vec2 vCascadePosition;
 varying vec4 vCascadeReflectCoord;
 uniform sampler2D tCascadeReflection;
 uniform float uCascadeReflectionReady;
 uniform vec4 uCascadeReflectionPlane;
 uniform sampler2D tSpringReflection;
 uniform float uSpringReflectionReady,uSpringReflectionHeight;

`;

export const cascadeSurfaceColor = /* glsl */ `
 float fallingBlend=smoothstep(.015,.32,1.-abs(normalize(vSurfaceNormal).y));
 float cascadeDensity=min(uTexelDensity,8.);
 vec2 fallGrid=floor(vCascadePosition*cascadeDensity)/cascadeDensity;
 float fallTime=floor(uTime*12.)/12.;
 // Native cells stretch moderately along the fall. Both layers flow down.
 vec2 fallCoord=fallGrid*vec2(.95,.36);
 vec2 fallWarp=vec2(sin(fallCoord.y*1.6-fallTime*2.2)*.13,
                    cos(fallCoord.x*1.6+fallTime*.7)*.10);
 float cellA=voronoi(fallCoord-vec2(0.,fallTime*2.5)+fallWarp);
 float cellB=voronoi(fallCoord*1.8-vec2(0.,fallTime*5.5)+vec2(4.5,2.1)-fallWarp*.7);
 float cells=floor((cellA*.55+cellB*.45)*8.)/8.;
 // The native stepped shapes and blue/white palette replace continuous ribbons.
 float softPatches=step(.46,cells);
 float whitePatches=max(step(.70,cells),step(.83,cellB))*softPatches;
 float aeration=floor(clamp(cells,0.,1.)*5.)/5.;
 vec3 fallBase=mix(activeDeep,activeShallow,.65)*(.9+diffuse*.15);
 fallBase*=.93+aeration*.12;
 vec3 fallColor=mix(fallBase,softFoamColor,.08+aeration*.12);
 fallColor=mix(fallColor,softFoamColor,softPatches*.48);
 fallColor=mix(fallColor,uFoamColor,whitePatches*.72);
 if(uCascadeReflectionReady>.5&&uIsOrthographic<.5&&fallingBlend>.01){
  vec2 mirrorUv=vCascadeReflectCoord.xy/max(vCascadeReflectCoord.w,.0001);
  float inMirror=step(0.,mirrorUv.x)*step(mirrorUv.x,1.)*step(0.,mirrorUv.y)*step(mirrorUv.y,1.);
  float onCurtain=1.-smoothstep(.3,1.8,abs(dot(vWorldPosition.xz-uCascadeReflectionPlane.xy,uCascadeReflectionPlane.zw)));
  // Advect refraction down the sheet. Project world-space distortions into
  // reflection UVs so their size stays consistent as the camera moves.
  float refractTime=floor(uTime*24.)/24.;
  vec2 flowing=fallGrid-vec2(0.,refractTime*5.5);
  float foldA=sin(flowing.y*2.7+flowing.x*1.1);
  float foldB=sin(flowing.y*5.3-flowing.x*2.1+sin(flowing.y*.9));
  float warpCell=voronoi(flowing*vec2(1.8,.45));
  float broken=floor(clamp(warpCell,0.,.999)*6.)/5.-.5;
  vec2 rippleWorld=vec2(foldA*.55+foldB*.24+broken*.40,foldB*.18+(cellB-.5)*.26);
  vec2 reflectionDx=dFdx(mirrorUv),reflectionDy=dFdy(mirrorUv);
  vec2 flowDx=dFdx(vCascadePosition),flowDy=dFdy(vCascadePosition);
  float flowDet=flowDx.x*flowDy.y-flowDx.y*flowDy.x;
  vec2 shimmer=vec2(0.);
  if(abs(flowDet)>.0000001){
   vec2 screenWarp=vec2(rippleWorld.x*flowDy.y-rippleWorld.y*flowDy.x,
                        flowDx.x*rippleWorld.y-flowDx.y*rippleWorld.x)/flowDet;
   shimmer=reflectionDx*screenWarp.x+reflectionDy*screenWarp.y;
  }
  shimmer=clamp(shimmer,vec2(-.085),vec2(.085));
  vec3 reflectionA=texture2D(tCascadeReflection,clamp(mirrorUv+shimmer,.001,.999)).rgb;
  vec3 reflectionB=texture2D(tCascadeReflection,clamp(mirrorUv+shimmer*.55+reflectionDy*1.5,.001,.999)).rgb;
  vec3 reflectedEnvironment=mix(reflectionA,reflectionB,.28);
  float surfaceFresnel=pow(1.-abs(dot(viewDir,normalize(vSurfaceNormal))),2.);
  float mirrorStrength=(.20+surfaceFresnel*.18)*(1.-softPatches*.65)*(1.-whitePatches*.85)*onCurtain*inMirror;
  fallColor=mix(fallColor,reflectedEnvironment,mirrorStrength);
 }
 // Aeration at the pool keeps the same cellular footprint.
 float impactTop=6.6+(cellA-.5)*1.3;
 float impactZone=1.-smoothstep(.15,impactTop,vWorldPosition.y);
 // More foam CELLS near impact, not a smooth white veil over the whole sheet.
 vec2 churnCoord=fallGrid*vec2(.85,.62)-vec2(0.,fallTime*5.);
 float churnA=voronoi(churnCoord);
 float churnB=voronoi(churnCoord*1.6+vec2(8.,3.));
 float churnCells=floor((churnA*.6+churnB*.4)*8.)/8.;
 float denseFoam=step(.78-impactZone*.65,churnCells)*step(.06,impactZone);
 float foamCore=step(.94-impactZone*.65,churnCells)*denseFoam;
 fallColor=mix(fallColor,softFoamColor,denseFoam*.88);
 fallColor=mix(fallColor,uFoamColor,foamCore*.97);
 finalColor=mix(finalColor,fallColor,fallingBlend);
 // OLHO D'ÁGUA da nascente (o lago no começo do rio, ~25 m rio abaixo do começo da malha): a água
 // que vem de baixo é mais clara e azul-turquesa no centro, com bolhas subindo
 {
  float springD=length(vec2(vCascadePosition.x*.75,(vCascadePosition.y-25.)*.55));
  float eye=(1.-smoothstep(0.,12.,springD))*(1.-fallingBlend);
  if(eye>.01){
   finalColor=mix(finalColor,vec3(.52,.88,.94),eye*eye*.30);
  }
 }
 // Native shoreline-style contact with opaque scene geometry only.
 // Small travelling scallops and highlights belong ONLY to the contact foam.
 float edgeTime=floor(uTime*24.)/24.;
 float edgeTravel=floor((vCascadePosition.y-edgeTime*4.)*cascadeDensity)/cascadeDensity;
 float edgePulse=.5+.5*sin(edgeTravel*3.7+sin(edgeTravel*1.3)*.65);
 float edgeWidth=foamLimit*(.82+edgePulse*.36);
 float solidContact=smoothstep(edgeWidth,edgeWidth-transWidth,cascadeSceneDepth);
 vec3 edgeColor=mix(softFoamColor,uFoamColor,.80+edgePulse*.20);
 finalColor=mix(finalColor,edgeColor,solidContact*fallingBlend);
 float cascadeOpacity=mix(uOpacity,.96,fallingBlend);
`;


