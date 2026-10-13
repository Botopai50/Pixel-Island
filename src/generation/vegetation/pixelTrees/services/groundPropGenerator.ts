// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import type { TreeInstance } from './treeGenerator';
import { ROCK_BIOMES } from '../constants/rockBiomes';
import { mineralGeometry, orePalette, oreVertex, oreFragment, sparkleTexture } from './oreSystem';
import { resolvePixelTextureParams, pixelTextureLightDir } from './pixelArtTextureSystem';
import { createDryLeafVariants } from './dryLeafSystem';
import { createWildflowerKit } from './wildflowerSystem';

export function createGroundProps(config: TreeConfig, flowerTexelsPerMetre?:number): TreeInstance {
  const settings = config.prop!;
  const biome = ROCK_BIOMES[settings.biome];
  const group = new THREE.Group(); group.name = `BotW_${settings.kind}`;
  const asset = new THREE.Group(); asset.name = 'RockAsset'; group.add(asset);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  let state = ((Math.floor(config.seed) * 71 + 1847) % 233280 + 233280) % 233280;
  const rnd = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
  const params = resolvePixelTextureParams(config), light = pixelTextureLightDir(params);
  const density = params.barkTexelsPerMetre * 2.8;
  const size = THREE.MathUtils.clamp(settings.size, 0.15, 1.2);
  const spread = THREE.MathUtils.clamp(settings.spread, 0.1, 2.5);
  const count = THREE.MathUtils.clamp(Math.round(settings.count), 0, 16);
  const detail = THREE.MathUtils.clamp(settings.density, 0, 1);
  const dryLeaves = settings.kind === 'leaves' ? createDryLeafVariants(config, light, flowerTexelsPerMetre) : [];
  dryLeaves.forEach(leaf => { geometries.add(leaf.geometry); materials.add(leaf.material); textures.add(leaf.texture); textures.add(leaf.palette); });
  const wildflowers=settings.kind==='flowers'?createWildflowerKit(config,light,flowerTexelsPerMetre):null;
  wildflowers?.geometries.forEach(g=>geometries.add(g));
  wildflowers?.materials.forEach(m=>materials.add(m));
  wildflowers?.textures.forEach(t=>textures.add(t));
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
    const o = new THREE.Mesh(geo,mat); o.castShadow = o.receiveShadow = true; parent.add(o); return o;
  };
  const crystalPalette = orePalette(settings.crystal,true); textures.add(crystalPalette);
  const crystalMat = new THREE.ShaderMaterial({vertexShader:oreVertex,fragmentShader:oreFragment, uniforms: {
    uOrePalette:{value:crystalPalette},uLight:{value:light},uCrystalPaint:{value:1},uDensity:{value:density},uCopper:{value:0},uSteps:{value:6},uShine:{value:new THREE.Vector3(.95,24,.65)},
  }}); materials.add(crystalMat);
  const sparkMap = sparkleTexture(); textures.add(sparkMap);
  for (let i=0;i<count;i++) {
    const cluster = new THREE.Group(); cluster.name = `${settings.kind}_${i+1}`;
    const angle = i*2.39996+rnd()*.6, radius = i===0?0:spread*Math.sqrt(i/Math.max(1,count-1))*(.8+rnd()*.2);
    cluster.position.set(Math.cos(angle)*radius,0,Math.sin(angle)*radius); asset.add(cluster);
    if(settings.kind==='flowers') {
      const flowers=2+Math.round(detail*3);
      for(let f=0;f<flowers;f++) {
        const plant = wildflowers!.create(size,rnd); cluster.add(plant);
        const a=rnd()*Math.PI*2,r=rnd()*size*.45;
        plant.position.set(Math.cos(a)*r,0,Math.sin(a)*r); plant.rotation.y=rnd()*Math.PI*2;
      }
    } else if(settings.kind==='leaves') {
      const leaves=8+Math.round(detail*18);
      for(let l=0;l<leaves;l++) {
        const variant=dryLeaves[(l+i)%dryLeaves.length];
        const leaf=mesh(variant.geometry,variant.material,cluster); leaf.name='DryLeaf';
        const a=rnd()*Math.PI*2,r=Math.sqrt(rnd())*size*.5;
        leaf.position.set(Math.cos(a)*r,.015+size*.13*(1-r/(size*.55))+rnd()*.04,Math.sin(a)*r);
        leaf.rotation.set((rnd()-.5)*.4,rnd()*Math.PI*2,(rnd()-.5)*.25);
        const leafSize=size*(.4+rnd()*.3);
        leaf.scale.set(leafSize*(.8+rnd()*.3),size*.55,leafSize);
        leaf.updateWorldMatrix(true, false);
        const low = new THREE.Box3().setFromObject(leaf).min.y;
        if (low < 0.005) leaf.position.y += 0.005 - low;
      }
    } else {
      const shards=3+Math.round(detail*5);
      for(let c=0;c<shards;c++) {
        const geo=mineralGeometry(settings.crystal,rnd); geometries.add(geo);
        const shard=mesh(geo,crystalMat,cluster); shard.name='IndependentCrystal';
        const a=c*2.39996,r=c===0?0:size*(.2+rnd()*.2);
        shard.position.set(Math.cos(a)*r,0,Math.sin(a)*r); shard.rotation.set((rnd()-.5)*.55,rnd()*Math.PI*2,(rnd()-.5)*.55);
        shard.scale.set(size*(.45+rnd()*.3),size*(c===0?1.35:.6+rnd()*.5),size*(.45+rnd()*.3));
        shard.updateMatrix();
        const box=new THREE.Box3().setFromObject(shard); shard.position.y-=box.min.y; shard.updateMatrix();
        if(c===0 && i<3) {
          const mat=new THREE.SpriteMaterial({map:sparkMap,transparent:true,depthTest:true,depthWrite:false}); materials.add(mat);
          const spark=new THREE.Sprite(mat); spark.name='CrystalPixelSparkle'; spark.userData.excludeFromOBJ=true;
          spark.scale.setScalar(.45); shard.add(spark);
          const pos=geo.attributes.position,norm=geo.attributes.normal;
          const candidates=Array.from({length:pos.count/3},(_,j)=>({point:new THREE.Vector3().fromBufferAttribute(pos,j*3).add(new THREE.Vector3().fromBufferAttribute(pos,j*3+1)).add(new THREE.Vector3().fromBufferAttribute(pos,j*3+2)).divideScalar(3), normal:new THREE.Vector3().fromBufferAttribute(norm,j*3).normalize()}));
          spark.onBeforeRender=(_r,_s,camera)=>{
            const view=camera.getWorldPosition(new THREE.Vector3()).sub(shard.getWorldPosition(new THREE.Vector3())).normalize();
            let best=-Infinity;
            for(const candidate of candidates){const score=candidate.normal.clone().transformDirection(shard.matrixWorld).dot(view);if(score>best){best=score;spark.position.copy(candidate.point).addScaledVector(candidate.normal,.06);}}
            spark.updateMatrixWorld(true); mat.opacity=Math.pow(Math.max(0,Math.sin(performance.now()*.0016+i*1.7+config.seed*.013)),4);
          };
        }
      }
    }
  }
  wildflowers?.geometries.forEach(g=>geometries.add(g));
  asset.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(asset);
  const radius=bounds.isEmpty()?1.2:Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)))+.4;
  const groundGeo=new THREE.CylinderGeometry(radius,radius*1.06,.25,40); geometries.add(groundGeo);
  const groundMat=new THREE.MeshToonMaterial({color:biome.config.snow>.45?'#e4edf6':biome.ground}); materials.add(groundMat);
  const ground=mesh(groundGeo,groundMat,group); ground.position.y=-.125; ground.name='GroundMound'; ground.userData.ground=true;
  return {group,foliageMaterials:[],barkMaterial:wildflowers?.materials[0] ?? dryLeaves[0]?.material ?? crystalMat,canFell:false,fell:()=>null,update:()=>{},dispose:()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
