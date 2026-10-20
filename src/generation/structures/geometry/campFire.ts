import * as THREE from 'three';

/** Eight crisp frames on one camera-facing plane, with no crossed flame meshes. */
export function createCampFire(density:number){
 const frames=8,width=Math.max(16,Math.round(.84*density)),height=Math.max(20,Math.round(.62*density));
 const data=new Uint8Array(width*frames*height*4);
 const palette=[[218,64,24],[249,115,20],[255,180,34],[255,221,83],[255,245,163]];
 for(let frame=0;frame<frames;frame++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const xx=(x+.5)/width*2-1,yy=(y+.5)/height;
  let inside=false,heat=0;
  for(let tongue=0;tongue<3;tongue++){
   const phase=frame*Math.PI/4+tongue*2.1;
   const tip=[.69,.98,.79][tongue]+Math.sin(phase)*.07;
   if(yy>=tip)continue;
   const center=[-.40,0,.39][tongue]+Math.sin(phase+Math.floor(y/2)*.42)*.08*yy;
   const halfWidth=[.35,.43,.32][tongue]*Math.pow(1-yy/tip,.65);
   const across=Math.abs(xx-center)/halfWidth;
   if(across<1){inside=true;heat=Math.max(heat,(1-across)*(1-yy/tip));}
  }
  if(!inside)continue;
  let tone=heat>.55?4:heat>.36?3:heat>.19?2:heat>.07?1:0;
  // A small stepped core rises from the logs; the orange edge stays opaque.
  if(yy<.16&&Math.abs(xx)<.52)tone=Math.max(tone,3);
  data.set([...palette[tone],255],(y*width*frames+frame*width+x)*4);
 }
 const texture=new THREE.DataTexture(data,width*frames,height);
 texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;
 texture.generateMipmaps=false;texture.repeat.set(1/frames,1);texture.needsUpdate=true;
 const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.5,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
 const geometry=new THREE.PlaneGeometry(.84,.62),mesh=new THREE.Mesh(geometry,material);
 mesh.name='CampFireBillboard';mesh.position.set(0,.51,0);
 mesh.userData.excludeFromOBJ=true;
 const cameraRotation=new THREE.Quaternion(),parentRotation=new THREE.Quaternion();
 mesh.onBeforeRender=(_renderer,_scene,camera)=>{
  camera.getWorldQuaternion(cameraRotation);
  if(mesh.parent){mesh.parent.getWorldQuaternion(parentRotation);mesh.quaternion.copy(parentRotation.invert()).multiply(cameraRotation);}
  else mesh.quaternion.copy(cameraRotation);
  mesh.updateMatrixWorld(true);
 };
 return {mesh,geometry,material,texture,update:(time:number)=>{
  texture.offset.x=((Math.floor(time*8)%frames)+frames)%frames/frames;
 }};
}
