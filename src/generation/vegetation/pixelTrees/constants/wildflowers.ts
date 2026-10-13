// @ts-nocheck
import { RockBiome, TreeSpecies } from '../types';

export type FlowerProfile={family:string;petals:number;core:number;cup:number;height:number;radius:number;leaf:TreeSpecies;leafWidth:number;leaves:number;layout:'single'|'spike'|'droop'|'rosette'|'umbel';color:string;pollen:string};
const profile=(family:string,petals:number,core:number,cup:number,height:number,radius:number,leaf:TreeSpecies,leafWidth:number,leaves:number,layout:FlowerProfile['layout'],color:string,pollen='#d5ad45'):FlowerProfile=>({family,petals,core,cup,height,radius,leaf,leafWidth,leaves,layout,color,pollen});
export const FLOWER_PROFILES:Record<RockBiome,FlowerProfile>={
  hyrule:profile('margarida',8,.25,.08,.95,.23,'faron_palm_sapling',.55,3,'single','#eee5ba'),
  satori:profile('prímula',5,.48,.18,.68,.25,'satori_sakura_sapling',.9,4,'rosette','#dfa1be'),
  akkala:profile('papoula',4,.64,.30,1.12,.29,'hyrule_oak_sapling',.85,3,'single','#d38242','#483329'),
  hebra:profile('espiga alpina',5,.42,.18,1.20,.12,'faron_palm_sapling',.30,3,'spike','#9e8bc2','#c7b47b'),
  hebra_snowy:profile('açafrão da neve',6,.57,.85,.44,.18,'faron_palm_sapling',.22,5,'rosette','#d0daeb','#d5b35d'),
  faron:profile('hibisco',5,.62,.24,1.36,.33,'swamp_mangrove_sapling',1.1,4,'single','#e38e77'),
  korok:profile('campânula',5,.56,.60,.88,.17,'korok_ancient_sapling',.85,3,'droop','#b4a8d2','#d5cc9b'),
  swamp:profile('íris',3,.30,.32,1.08,.27,'faron_palm_sapling',.24,5,'rosette','#8faecb','#d7be63'),
  gerudo:profile('flor do deserto',6,.45,.16,.28,.24,'swamp_mangrove_sapling',1.0,6,'rosette','#dba6a0'),
  savanna:profile('áster',10,.23,.10,1.03,.22,'faron_palm_sapling',.38,3,'single','#dbc36b','#795a30'),
  withered:profile('umbela seca',5,.42,.08,.76,.095,'savanna_acacia_sapling',.6,2,'umbel','#baa487','#84704c'),
  tundra:profile('saxífraga',5,.46,.18,.34,.16,'satori_sakura_sapling',.7,5,'rosette','#b9a8cf','#d6c580'),
};
