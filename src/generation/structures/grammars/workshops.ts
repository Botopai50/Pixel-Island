import {Architect} from '../blueprint';import type {GrammarContext,V3,SurfaceMaterial} from '../types';
import {watermill} from './watermill';
import {market} from './market';

export function workshops(c:GrammarContext){
 if(c.config.type==='watermill')return watermill(c);
 if(c.config.type==='market')return market(c);
 const a=new Architect(c),p=c.config,w=p.width,d=p.depth,h=p.height;
 const box=(at:V3,size:V3,mat:SurfaceMaterial,role:string,support='ground',rotation?:V3)=>a.piece('box',at,size,mat,role,support,rotation);
 {
  const forge=p.type==='blacksmith',house=a.building(forge?-w*.12:-w*.10,d*.12,w*.63,d*.65,h*.70,1,{base:.28,material:forge?'stone':'plaster',roof:p.roof==='auto'?'gable':p.roof,role:forge?'smithy':'mill-house'});
  if(forge){
   a.chimney(house);
   const shopZ=-d*.28,base=box([w*.10,.15,shopZ],[w*.78,.30,d*.27],'stone','smithy-workfloor');
   const coverY=house.bottom+house.height*.80;
   for(const side of [-1,1])a.beam([side*w*.30,.30,shopZ-d*.11],[side*w*.30,coverY-.12,shopZ-d*.11],.17,'wood','smithy-awning-post',base);
   box([0,coverY,shopZ],[w*.78,.13,d*.33],'wood','smithy-cover',base,[-.12,0,0]);
   const hearth=box([-w*.24,.74,shopZ],[1.05,.85,.78],'stone','smithy-hearth',base);
   box([-w*.24,.82,shopZ-.40],[.70,.45,.035],'dark','smithy-fire-recess',hearth);
   box([-w*.24,.67,shopZ-.43],[.56,.12,.03],'dark','smithy-embers',hearth);
   box([w*.12,.57,shopZ],[.56,.55,.52],'wood','smithy-anvil-base',base);
   a.piece('box',[w*.12,.98,shopZ],[.73,.30,.38],'metal','smithy-anvil',base);
   box([w*.29,1.19,shopZ-.09],[.25,.06,.05],'wood','smithy-hammer-handle',base);
   box([w*.40,1.19,shopZ-.09],[.10,.12,.10],'metal','smithy-hammer-head',base);
   box([w*.29,.88,shopZ+d*.07],[.72,.13,.42],'wood','smithy-workbench',base);
   for(const side of [-1,1])box([w*.29+side*.27,.57,shopZ+d*.07],[.10,.54,.35],'wood','smithy-bench-leg',base);
  }else{
   const radius=Math.min(h*.34,d*.24),wheelX=house.x+house.width/2+.47,wheelY=radius+.12;
   a.piece('wheel',[wheelX,wheelY,0],[radius*2,radius*2,.60],'wood','mill-waterwheel');
   a.beam([wheelX-.60,wheelY,0],[wheelX+.55,wheelY,0],.16,'metal','mill-waterwheel-axle');
   box([wheelX+.55,wheelY*.44,0],[.28,wheelY*.88,.40],'stone','mill-axle-support');
   box([wheelX,.07,0],[1.28,.14,d*1.05],'stone','mill-water-channel');
   a.piece('box',[wheelX,.152,0],[1.03,.014,d*1.04],'water','mill-channel-water');
   for(const side of [-1,1])box([wheelX+side*.66,.17,0],[.18,.34,d*1.05],'stone','mill-channel-bank');
  }
 }
 return a.finish();
}
