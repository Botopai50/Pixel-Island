// exact-parity exporter
import fs from 'node:fs';
import { createCanvas, Image, ImageData } from '@napi-rs/canvas';

const probe:any=createCanvas(1,1);
(globalThis as any).window=globalThis;
(globalThis as any).document={
  createElement(tag:string){
    if(tag==='canvas') return createCanvas(1,1);
    return {};
  }
};
(globalThis as any).ImageData=ImageData;
(globalThis as any).HTMLCanvasElement=probe.constructor;
(globalThis as any).HTMLImageElement=Image;
(globalThis as any).ImageBitmap=class ImageBitmap {};

const PRESETS=[
  'hyrule_oak','korok_ancient','hyrule_oak_sapling','hebra_pine','hebra_pine_sapling',
  'akkala_birch','akkala_birch_sapling','faron_palm','faron_palm_sapling',
  'savanna_acacia','savanna_acacia_sapling','maple_red','maple_orange','maple_yellow',
  'swamp_mangrove','swamp_mangrove_sapling','hebra_pine_snowy','arctic_willow',
  'dry_withered','gerudo_cactus','gerudo_cactus_sapling','hyrule_shrub','berry_shrub',
  'hollow_log','rooted_log','tree_stump','fallen_log','fern_plant','wildflower_patch','reed_clump'
] as const;

function align4(n:number){return (n+3)&~3;}
function u32(v:number){const b=Buffer.alloc(4);b.writeUInt32LE(v>>>0);return b;}
function u16(v:number){const b=Buffer.alloc(2);b.writeUInt16LE(v&0xffff);return b;}
function f32(v:number){const b=Buffer.alloc(4);b.writeFloatLE(v);return b;}
function pad4(buf:Buffer){const n=align4(buf.length)-buf.length;return n?Buffer.concat([buf,Buffer.alloc(n)]):buf;}

function arrayF32(attr:any,count:number,itemSize:number,defaults:number[]){
  const out=new Float32Array(count*itemSize);
  if(attr){
    for(let i=0;i<count;i++)for(let k=0;k<itemSize;k++)
      out[i*itemSize+k]=Number(attr.array[i*attr.itemSize+k] ?? defaults[k] ?? 0);
  }else{
    for(let i=0;i<count;i++)for(let k=0;k<itemSize;k++)out[i*itemSize+k]=defaults[k]??0;
  }
  return out;
}

function rgbaFromTexture(tex:any):{w:number,h:number,rgba:Uint8Array}{
  if(!tex)return {w:1,h:1,rgba:new Uint8Array([255,255,255,255])};
  const image:any=tex.image;
  const w=Number(image?.width ?? 1),h=Number(image?.height ?? 1);
  if(image?.data){
    const src=new Uint8Array(image.data.buffer ?? image.data, image.data.byteOffset ?? 0, image.data.byteLength ?? image.data.length);
    return {w,h,rgba:new Uint8Array(src)};
  }
  if(image?.getContext){
    const data=image.getContext('2d').getImageData(0,0,w,h).data;
    return {w,h,rgba:new Uint8Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength))};
  }
  const canvas:any=createCanvas(w,h);
  const ctx:any=canvas.getContext('2d');
  ctx.drawImage(image,0,0,w,h);
  const data=ctx.getImageData(0,0,w,h).data;
  return {w,h,rgba:new Uint8Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength))};
}

async function main(){
  const [{PixelTreeAssetLibrary},{PRNG}]=await Promise.all([
    import('../src/generation/vegetation/pixelTreeAdapter.ts'),
    import('../src/generation/math/prng.ts')
  ]);

  const worldSeed=PRNG.hashString('Avalon');
  const lib:any=new PixelTreeAssetLibrary((m:any)=>m);
  lib.ensureWorldSeed(worldSeed);

  const assetBuffers:Buffer[]=[];
  let assetCount=0;

  for(let presetId=0;presetId<PRESETS.length;presetId++){
    const preset:any=PRESETS[presetId];
    const variants=lib.variantCount(preset);
    for(let variant=0;variant<variants;variant++){
      const asset:any=lib.get(preset,variant,'none');
      const partBuffers:Buffer[]=[];

      for(const part of asset.parts){
        const g:any=part.geometry;
        const mat:any=part.material;
        const pos=g.getAttribute('position');
        const count=pos.count;
        const positions=arrayF32(pos,count,3,[0,0,0]);
        const normals=arrayF32(g.getAttribute('normal'),count,3,[0,1,0]);
        const uvs=arrayF32(g.getAttribute('uv'),count,2,[0,0]);
        const colors=arrayF32(g.getAttribute('color'),count,3,[1,1,1]);

        let indices:Uint32Array;
        if(g.index){
          indices=new Uint32Array(g.index.count);
          for(let i=0;i<g.index.count;i++)indices[i]=g.index.getX(i);
        }else{
          indices=new Uint32Array(count);
          for(let i=0;i<count;i++)indices[i]=i;
        }

        const tex=rgbaFromTexture(mat.map);
        const name=Buffer.from(String(part.name||'part'),'utf8');
        let flags=0;
        if(Number(mat.alphaTest||0)>0)flags|=1;
        if(mat.map?.flipY)flags|=2;
        if(part.castShadow)flags|=4;
        if(!!g.getAttribute('color'))flags|=8;
        if(mat.side===2)flags|=16;

        const color=mat.color ?? {r:1,g:1,b:1};
        const repeat=mat.map?.repeat ?? {x:1,y:1};

        const header=Buffer.concat([
          u32(name.length),u32(count),u32(indices.length),u32(tex.w),u32(tex.h),u32(flags),
          f32(Number(repeat.x||1)),f32(Number(repeat.y||1)),f32(Number(mat.alphaTest||0)),
          f32(Number(color.r??1)),f32(Number(color.g??1)),f32(Number(color.b??1))
        ]);

        partBuffers.push(Buffer.concat([
          header,pad4(name),
          Buffer.from(positions.buffer),Buffer.from(normals.buffer),Buffer.from(uvs.buffer),
          Buffer.from(colors.buffer),Buffer.from(indices.buffer),
          Buffer.from(tex.rgba.buffer,tex.rgba.byteOffset,tex.rgba.byteLength)
        ]));
      }

      assetBuffers.push(Buffer.concat([u16(presetId),u16(variant),u16(asset.parts.length),u16(0),...partBuffers]));
      assetCount++;
      console.log('Pixel_Tree '+preset+' variant '+variant+': '+asset.parts.length+' parts');
    }
  }

  const header=Buffer.concat([u32(0x41544950),u32(1),u32(assetCount),u32(PRESETS.length),u32(worldSeed)]);
  const out=Buffer.concat([header,...assetBuffers]);
  fs.writeFileSync('native/pixel_tree_assets.bin',out);
  fs.writeFileSync('native/pixel_tree_presets.json',JSON.stringify(PRESETS,null,2));
  console.log('Wrote pixel_tree_assets.bin: '+out.length+' bytes, assets='+assetCount);
  lib.dispose();
}

main().catch((e)=>{console.error(e);process.exit(1);});
