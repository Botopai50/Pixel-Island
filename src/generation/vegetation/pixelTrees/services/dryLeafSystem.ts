// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig, TreeSpecies } from '../types';
import { buildPixelSaplingLeafPixels, buildFoliageRamp } from './pixelArtTextureSystem';

const BIOME_LEAF: Record<string, TreeSpecies> = {
  hyrule:'hyrule_oak_sapling', satori:'satori_sakura_sapling', akkala:'akkala_birch_sapling',
  hebra:'hebra_pine_sapling', hebra_snowy:'hebra_pine_snowy_sapling', faron:'faron_palm_sapling',
  korok:'korok_ancient_sapling', swamp:'swamp_mangrove_sapling', gerudo:'savanna_acacia_sapling',
  savanna:'savanna_acacia_sapling', withered:'hyrule_oak_sapling', tundra:'satori_sakura_sapling',
};

/** Reuse the saplings' authored silhouettes and veins with a dry autumn palette. */
export function createDryLeafVariants(config: TreeConfig, light: THREE.Vector3, texelsPerMetre?: number) {
  const settings=config.prop!;
  const primary=BIOME_LEAF[settings.biome];
  // Vary proportions and curling within the local species, rather than mixing biomes.
  return [0,1,2].map(variant => {
    const leaf=buildPixelSaplingLeafPixels({...config,species:primary});
    let {width:W,height:H}=leaf;
    let pixels=new Uint8Array(W*H*4);
    for(let y=0;y<H;y++) pixels.set(leaf.pixels.subarray((H-1-y)*W*4,(H-y)*W*4),y*W*4);
    // (jogo) a folha tem os pixels da grama: o desenho é reduzido para os texels que cabem no tamanho dela no mundo
    if(texelsPerMetre){
      const H2=Math.max(5,Math.round(settings.size*.55*texelsPerMetre)),W2=Math.max(3,Math.round(W/H*H2));
      if(H2<H){
        const out=new Uint8Array(W2*H2*4);
        for(let y=0;y<H2;y++)for(let x=0;x<W2;x++){
          const x0=Math.floor(x/W2*W),x1=Math.max(x0+1,Math.floor((x+1)/W2*W)),y0=Math.floor(y/H2*H),y1=Math.max(y0+1,Math.floor((y+1)/H2*H));
          let r=0,n=0,op=0;
          for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const o=(yy*W+xx)*4;n++;if(pixels[o+3]>0){r+=pixels[o];op++;}}
          if(op>0&&op/n>=.4){const o=(y*W2+x)*4;out[o]=Math.round(r/op);out[o+3]=255;}
        }
        pixels=out;W=W2;H=H2;
      }
    }
    const texture=new THREE.DataTexture(pixels,W,H);
    texture.magFilter=texture.minFilter=THREE.NearestFilter;
    texture.generateMipmaps=false; texture.needsUpdate=true;
    const filled=(x:number,y:number)=>x>=0&&x<W&&y>=0&&y<H&&pixels[(y*W+x)*4+3]>0;
    const positions:number[]=[],uvs:number[]=[];
    const vertex=(x:number,y:number)=>{
      const across=(x-W/2)/H,along=y/H,halfWidth=W/H*.5;
      // The same raised midrib and longitudinal arch as sapling leaf geometry.
      const curl=[1,.72,1.3][variant];
      const fold=((1-Math.abs(across)/halfWidth)*(W/H*.16)+Math.sin(along*Math.PI)*.08)*curl;
      const width=[1,.88,1.08][variant],length=[1,1.08,.92][variant];
      positions.push(across*width,fold,along*length);uvs.push(x/W,y/H);
    };
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(!filled(x,y))continue;
      vertex(x,y);vertex(x+1,y+1);vertex(x+1,y);
      vertex(x,y);vertex(x,y+1);vertex(x+1,y+1);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();
    geometry.userData.leafShape=leaf.shape;geometry.userData.hasPetiole=true;
    const hsl=new THREE.Color(settings.color).getHSL({h:0,s:0,l:0},THREE.SRGBColorSpace);
    const top=new THREE.Color().setHSL(hsl.h+(variant-1)*.018,hsl.s,hsl.l,THREE.SRGBColorSpace);
    const bottom=new THREE.Color().setHSL(hsl.h,hsl.s*.8,Math.max(.12,hsl.l-.2),THREE.SRGBColorSpace);
    const ramp=buildFoliageRamp('#'+bottom.getHexString(),'#'+top.getHexString(),6,{hueCold:10,hueWarm:-6,contrast:.35,shadow:.4,satBoost:.8});
    const palettePixels=new Uint8Array(6*4);
    ramp.forEach((rgb,i)=>palettePixels.set([...rgb,255],i*4));
    const palette=new THREE.DataTexture(palettePixels,6,1);
    palette.magFilter=palette.minFilter=THREE.NearestFilter;palette.generateMipmaps=false;palette.needsUpdate=true;
    const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,
      uniforms:{uLeafMap:{value:texture},uPalette:{value:palette},uLight:{value:light}},
      vertexShader:`varying vec2 vUv;varying vec3 vNormal;void main(){vUv=uv;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform sampler2D uLeafMap;uniform sampler2D uPalette;uniform vec3 uLight;varying vec2 vUv;varying vec3 vNormal;
        void main(){vec4 ink=texture2D(uLeafMap,vUv);if(ink.a<.5)discard;vec3 N=normalize(vNormal);float back=gl_FrontFacing?0.:1.;if(!gl_FrontFacing)N=-N;
        float idx=floor(ink.r*5.+.5);float tone=dot(N,normalize(uLight))*1.25-back*.7-.1;float off=clamp(floor(tone*1.1+.5),-2.,2.);
        idx=clamp(idx+off,0.,5.);gl_FragColor=vec4(texture2D(uPalette,vec2((idx+.5)/6.,.5)).rgb,1.);}`,
    });
    return {geometry,material,texture,palette};
  });
}
