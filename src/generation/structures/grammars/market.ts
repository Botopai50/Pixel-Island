import {Architect} from '../blueprint';
import type {GrammarContext,SurfaceMaterial,V3} from '../types';

/** Three connected stalls, with their goods supported by the shared timber stage. */
export function market(c:GrammarContext){
 const a=new Architect(c),{width:w,depth:d,height:h}=c.config;
 const span=w/3-.045,stallDepth=d*.73,front=-stallDepth/2,rear=stallDepth/2;
 const box=(p:V3,s:V3,m:SurfaceMaterial,r:string,on='ground',rotation?:V3)=>a.piece('box',p,s,m,r,on,rotation);
 const beam=(from:V3,to:V3,size:number,material:SurfaceMaterial,role:string,on:string)=>a.beam(from,to,size,material,role,on);
 const goods=(p:V3,s:V3,role:string,on:string)=>a.piece('box',p,s,'cloth',role,on);
 for(let i=0;i<3;i++){
  const butcher=i===2;
  const salmonStall=i===0;
  const x=(i-1)*w/3,z=(i-1)*d*.025,fw=z+front,bw=z+rear;
  const base=box([x,.13,z],[span,.26,stallDepth],'wood','market-floor');
  // Narrow separated deck boards make the whole row read as one wooden platform.
  for(let k=0;k<11;k++)box([x,.274,z-stallDepth/2+(k+.5)*stallDepth/11],[span-.05,.035,stallDepth/11-.022],'wood','market-deck-board',base);
  for(const side of [-1,1]){
   const px=x+side*(span/2-.10);
   beam([px,.13,fw-.09],[px,.13,bw+.09],.13,'wood','market-floor-rim',base);
   for(const end of [-1,1]){
    const pz=z+end*(stallDepth/2-.13),post=beam([px,.28,pz],[px,h-.10+(end===1?.17:0),pz],.19,'wood','market-post',base);
    for(const y of [.37,h-.28+(end===1?.17:0)])box([px,y,pz],[.255,.11,.255],'metal','market-post-band',post);
    const braceX=px-side*.42;
    beam([px,h-.61+(end===1?.17:0),pz],[braceX,h-.20+(end===1?.17:0),pz],.105,'wood','market-brace',post);
   }
   beam([px,h-.13,fw-.16],[px,h+.04,bw+.16],.105,'wood','market-canopy-side-rail',base);
  }
  beam([x-span/2+.12,h-.12,fw-.08],[x+span/2-.12,h-.12,fw-.08],.15,'wood','market-front-beam',base);
  beam([x-span/2+.12,h+.055,bw-.08],[x+span/2-.12,h+.055,bw-.08],.14,'wood','market-back-beam',base);
  const roof=box([x,h+.07,z],[span+.10,.075,stallDepth+.20],'cloth','market-canopy-'+i,base,[-.045,0,0]);
  // Long stitched lanes, stitched cross seams, and a small patched corner.
  for(let lane=1;lane<4;lane++)box([x-span/2+lane*span/4,h+.116,z],[.012,.008,stallDepth-.20],'cloth','market-stitch-'+i,roof,[-.045,0,0]);
  for(const seam of [-.18,.23])box([x,h+.115,z+seam*stallDepth],[span-.12,.008,.013],'cloth','market-stitch-'+i,roof,[-.045,0,0]);
  box([x-span*.20,h+.122,z+stallDepth*.12],[span*.16,.009,stallDepth*.12],'cloth','market-patch-'+i,roof,[-.045,0,0]);
  const apron=box([x,h-.12,fw-.105],[span+.09,.23,.055],'cloth','market-canopy-'+i,roof);
  for(let k=1;k<8;k++)box([x-span/2+k*span/8,h-.12,fw-.137],[.011,.20,.009],'cloth','market-stitch-'+i,apron);
  for(let k=0;k<9;k++)goods([x-span*.445+k*span*.111,h-.31,fw-.15],[span*.085,.22,.025],butcher?'market-pennant-red':'market-pennant-cream',apron);
  // Counter and open rear shelf, with real crate/barrel models in the foreground.
  const counter=box([x,.76,fw+.68],[span-.39,.16,.80],'wood','market-counter',base);
  const counterLinen=box([x,.849,fw+.68],[span-.52,.016,.72],'cloth','market-display-cloth',counter);
  for(const side of [-1,1])box([x+side*(span/2-.37),.52,fw+.68],[.16,.52,.75],'wood','market-counter-leg',base);
  const rearShelf=box([x,.61,bw-.43],[span-.36,.12,.55],'wood','market-rear-shelf',base);
  box([x,.679,bw-.43],[span-.49,.012,.49],'cloth','market-display-cloth',rearShelf);
  for(const side of [-1,1])box([x+side*(span/2-.30),.46,bw-.43],[.12,.38,.45],'wood','market-shelf-leg',base);
  const crate=(cx:number,cy:number,cz:number,sx=.68,sy=.42,sz=.58)=>box([cx,cy,cz],[sx,sy,sz],'wood','market-crate',base);
  crate(x-span*.27,.49,fw+.30,.69,.42,.54);
  crate(x+span*.28,.49,fw+.33,.65,.42,.52);
  crate(x-span*.28,.49,bw-.38,.61,.42,.54);
  const barrel=(bx:number,bz:number)=>a.piece('column',[bx,.48,bz],[.63,.96,.63],'wood','barn-barrel',base);
  barrel(x-span*.39,fw+.76);barrel(x+span*.39,bw-.32);
  // Hanging rail is continuous across the stall. The goods sit below the awning.
  const rail=beam([x-span*.37,h-.54,bw-.70],[x+span*.37,h-.54,bw-.70],.065,'metal','market-hanging-rail',base);
  for(let n=0;n<4;n++){
   const gx=x+(n-1.5)*span*.20,gy=h-.82-(n%2)*.055,gz=bw-.70;
   beam([gx,h-.54,gz],[gx,gy+.13,gz],.026,'metal','market-hook',rail);
   goods([gx,gy-.15,gz],[.36,.70,.12],butcher?'market-hanging-meat':salmonStall&&n%2===0?'market-hanging-fish-red':'market-hanging-fish',rail);
  }
  for(let n=0;n<3;n++){
   const gx=x+(n-1)*span*.255,gz=fw+.67+(n%2)*.05;
   goods([gx,.864,gz],butcher?[.50,.18,.56]:[.49,.18,.68],butcher?'market-meat-cut':salmonStall&&n!==1?'market-fish-red':'market-fish',counterLinen);
  }
  for(let n=0;n<2;n++)goods([x+(n-.5)*span*.31,.691,bw-.42],butcher?[.48,.17,.49]:[.45,.17,.58],butcher?'market-meat-cut':salmonStall?'market-fish-red':'market-fish',rearShelf);
  goods([x+span*.12,.46,bw-.20],[.34,.43,.31],'market-sack',base);
  const banner=box([x+span*.19,h-.78,fw+.04],[span*.22,.48,.04],'cloth',butcher?'market-banner-red':i===1?'market-banner-green':'market-banner-blue',base);
  box([x+span*.19,h-.77,fw+.011],[span*.09,.17,.008],'cloth','market-banner-mark',banner);
  beam([x+span*.19,h-.51,fw+.04],[x+span*.19,h-.36,fw+.04],.035,'metal','market-banner-hook',banner);
  if(butcher){
   const lx=x-span*.37,lz=fw-.10;
   beam([lx,h-.14,lz],[lx,h-.48,lz],.035,'metal','market-lantern-chain',base);
   box([lx,h-.68,lz],[.20,.28,.19],'metal','market-lantern-frame',base);
   box([lx,h-.68,lz-.105],[.125,.19,.012],'cloth','market-lantern-light',base);
  }
 }
 return a.finish();
}
