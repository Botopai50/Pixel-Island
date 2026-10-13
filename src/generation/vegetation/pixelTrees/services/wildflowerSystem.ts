// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { ROCK_BIOMES } from '../constants/rockBiomes';
import { buildFoliageRamp, buildPixelSaplingLeafPixels } from './pixelArtTextureSystem';

import { FLOWER_PROFILES, FlowerProfile as Profile } from '../constants/wildflowers';

function paintedGrid(width:number,height:number,cell:(x:number,y:number)=>[number,number]|null,
  vertex:(x:number,y:number)=>[number,number,number]) {
  const positions:number[]=[],ink:number[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const paint=cell(x,y);if(!paint)continue;
    for(const [xx,yy] of [[x,y],[x+1,y+1],[x+1,y],[x,y],[x,y+1],[x+1,y+1]]) {
      positions.push(...vertex(xx,yy));ink.push(...paint);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('ink',new THREE.Float32BufferAttribute(ink,2));geometry.computeVertexNormals();
  return geometry;
}

/** One authored pixel grid for the whole blossom, rather than differently oriented petal grids. */
function blossom(p:Profile,N=16) {
  const step=2/N;
  const point=(x:number,y:number)=>[(x/N-.5)*2,(y/N-.5)*2];
  const edge=(x:number,z:number)=>{
    const angle=Math.atan2(z,x),lobe=(Math.cos(angle*p.petals)+1)*.5;
    return p.core+(1-p.core)*Math.pow(lobe,p.petals>=8?1.25:.55);
  };
  const geometry=paintedGrid(N,N,(x,y)=>{
    const [xx,zz]=point(x+.5,y+.5),r=Math.hypot(xx,zz);
    if(r>edge(xx,zz))return null;
    const pollen=r<(p.family==='papoula'?.28:.19);
    const sector=Math.cos(Math.atan2(zz,xx)*p.petals);
    const boundary=r+step*.7>edge(xx,zz);
    const tone=pollen?3:boundary?2:sector<.2?1:r<.4?2:zz<-.15?4:3;
    return [tone,pollen?1:0];
  },(x,y)=>{
    const [xx,zz]=point(x,y),r=Math.hypot(xx,zz);
    const fold=p.family==='íris'&&r>.55?-.35*(r-.55):p.cup*r*r;
    return [xx,fold,zz];
  });
  geometry.userData.pixelGrid=N;return geometry;
}

function paletteMaterial(color:string,pollen:string,light:THREE.Vector3) {
  const dark=(hex:string)=>'#'+new THREE.Color(hex).multiplyScalar(.38).getHexString();
  const ramps=[color,pollen].map(c=>buildFoliageRamp(dark(c),c,6,{hueCold:14,hueWarm:-6,contrast:.35,shadow:.4,satBoost:.82}));
  const pixels=new Uint8Array(6*2*4);
  ramps.forEach((r,row)=>r.forEach((rgb,i)=>pixels.set([...rgb,255],(row*6+i)*4)));
  const texture=new THREE.DataTexture(pixels,6,2);texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{uFlowerPalette:{value:texture},uLight:{value:light}},
    vertexShader:`attribute vec2 ink;varying vec2 vInk;varying vec3 vN;void main(){vInk=ink;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform sampler2D uFlowerPalette;uniform vec3 uLight;varying vec2 vInk;varying vec3 vN;void main(){vec3 N=normalize(vN);if(!gl_FrontFacing)N=-N;float lit=dot(N,normalize(uLight));float shift=clamp(floor(lit*1.4+.25),-1.,1.);float tone=clamp(floor(vInk.x+.5)+shift,0.,5.);gl_FragColor=vec4(texture2D(uFlowerPalette,vec2((tone+.5)/6.,vInk.y>.5?.75:.25)).rgb,1.);}`});
  return {material,texture};
}

/** Shared authored blossom surface for ground flowers and flowering shrubs. */
export function createFlowerBloom(profile:Profile,color:string,light:THREE.Vector3) {
  return {geometry:blossom(profile),...paletteMaterial(color,profile.pollen,light)};
}

export function createWildflowerKit(config:TreeConfig,light:THREE.Vector3,texelsPerMetre?:number) {
  const settings=config.prop!,p=FLOWER_PROFILES[settings.biome];
  const flower=createFlowerBloom(p,settings.color,light);
  const green=p.family==='umbela seca'?'#8d8554':ROCK_BIOMES[settings.biome].grass;
  const foliage=paletteMaterial(green,green,light);
  const source=buildPixelSaplingLeafPixels({...config,species:p.leaf});
  const leafHeight=texelsPerMetre?Math.max(4,Math.round(settings.size*(p.layout==='rosette'?.5:.34)*texelsPerMetre)):source.height;
  const leafWidth=Math.max(2,Math.round(source.width/source.height*leafHeight*(texelsPerMetre?p.leafWidth:1)));
  const leaf=paintedGrid(leafWidth,leafHeight,(x,y)=>{
    const sx=Math.min(source.width-1,Math.floor((x+.5)*source.width/leafWidth));
    const sy=Math.min(source.height-1,Math.floor((y+.5)*source.height/leafHeight));
    const at=((source.height-1-sy)*source.width+sx)*4;
    return source.pixels[at+3]?[Math.round(source.pixels[at]/255*5),0]:null;
  },(x,y)=>[(x-leafWidth/2)/leafHeight,.10*Math.sin(y/leafHeight*Math.PI),y/leafHeight]);
  leaf.userData.pixelGrid=leafHeight;
  const bloom=flower.geometry,stem=new THREE.CylinderGeometry(.017,.03,1,6,5);
  // o caule escurece para a base e clareia para o alto (tons da paleta), em degraus de pixel
  stem.setAttribute('ink',new THREE.Float32BufferAttribute(Array.from({length:stem.attributes.position.count},(_,i)=>[1.1+(stem.attributes.position.getY(i)+.5)*2.6,0]).flat(),2));
  const resources={geometries:[leaf,bloom,stem],materials:[flower.material,foliage.material],textures:[flower.texture,foliage.texture]};
  const coarseBlooms=new Map<number,THREE.BufferGeometry>();
  const attach=(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D)=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  return {...resources,create(size:number,rnd:()=>number) {
    const plant=new THREE.Group();plant.name='Wildflower';plant.userData.flowerFamily=p.family;
    // (jogo) altura do caule bem variada entre as flores de um mesmo canteiro: de menos da metade até a altura normal (nunca mais alta)
    const height=size*Math.min(p.height,.85)*(.45+rnd()*.50),radius=size*p.radius;
    const branch=(from:THREE.Vector3,to:THREE.Vector3,thin=1)=>{
      const mesh=attach(stem,foliage.material,plant),span=to.clone().sub(from);
      mesh.position.copy(from).add(to).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),span.clone().normalize());mesh.scale.set(size*thin,span.length(),size*thin);
    };
    // cada flor se inclina um pouco para um lado (o alto do caule sai do prumo)
    const lean=(p.layout==='spike'||p.layout==='umbel'||p.layout==='droop')?0:height*(.04+rnd()*.14),leanAngle=rnd()*Math.PI*2;
    const tip=new THREE.Vector3(Math.cos(leanAngle)*lean,height,Math.sin(leanAngle)*lean);
    branch(new THREE.Vector3(),tip);
    for(let l=0;l<p.leaves;l++) {
      const mesh=attach(leaf,foliage.material,plant),basal=p.layout==='rosette';
      mesh.position.y=basal?.014:height*(.18+l*.13);if(!basal){mesh.position.x=tip.x*mesh.position.y/height;mesh.position.z=tip.z*mesh.position.y/height;}
      const length=texelsPerMetre?leafHeight/texelsPerMetre:size*(basal?.5:.34);
      mesh.scale.set(length*(texelsPerMetre?1:p.leafWidth),length,length);mesh.rotation.set(basal?-.28:-.65,l*2.39996,0);
    }
    const head=(position:THREE.Vector3,scale=1,droop=false)=>{
      let geometry=bloom,headRadius=radius*scale;
      if(texelsPerMetre){
        const grid=Math.max(3,Math.round(2*headRadius*texelsPerMetre));
        if(!coarseBlooms.has(grid)){const coarse=blossom(p,grid);coarseBlooms.set(grid,coarse);resources.geometries.push(coarse);}
        geometry=coarseBlooms.get(grid)!;headRadius=grid/(2*texelsPerMetre);
      }
      const mesh=attach(geometry,flower.material,plant);mesh.name='PixelWildflowerBloom';mesh.position.copy(position);
      mesh.scale.setScalar(headRadius);mesh.rotation.set(droop?Math.PI+.45:(rnd()-.5)*.18,rnd()*Math.PI*2,0);
      return mesh;
    };
    if(p.layout==='spike') {
      for(let level=0;level<5;level++)for(let side=0;side<3;side++) {
        const angle=side*Math.PI*2/3+level*.7;
        const mesh=head(new THREE.Vector3(Math.cos(angle)*radius*.40,height*(.52+level*.10),Math.sin(angle)*radius*.40),.6-level*.055);
        mesh.rotation.z=.65;
      }
    }else if(p.layout==='umbel'||p.layout==='droop') {
      const heads=p.layout==='umbel'?5:3;
      for(let f=0;f<heads;f++) {
        const angle=f*Math.PI*2/heads,reach=size*(p.layout==='umbel'?.28:.16);
        const end=new THREE.Vector3(Math.cos(angle)*reach,height*(p.layout==='umbel'?1.08:.75+f*.10),Math.sin(angle)*reach);
        branch(new THREE.Vector3(0,height*.62,0),end,.65);head(end,p.layout==='umbel'?.8:1,p.layout==='droop');
      }
    }else {
      head(tip.clone());
      if(p.family==='hibisco') {
        const stamen=attach(stem,flower.material,plant);stamen.position.set(tip.x,height+radius*.24,tip.z);stamen.scale.set(size*.45,radius*.48,size*.45);
        head(new THREE.Vector3(tip.x,height+radius*.5,tip.z),.14);
      }
    }
    return plant;
  }};
}
