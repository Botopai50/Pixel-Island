import type {RoofKind,StructureConfig} from './types';

/** Seeded architectural choices, weighted for the setting and building role. */
export function selectAutomaticRoof(config:StructureConfig,role:string,roll:number):Exclude<RoofKind,'auto'>{
 type Choice=[Exclude<RoofKind,'auto'>,number];
 let choices:Choice[]=[['gable',.45],['hip',.30],['shed',.18],['flat',.07]];
 if(config.biome==='gerudo')choices=[['flat',.45],['shed',.25],['gable',.20],['hip',.10]];
 else if(['hebra','hebra_snowy','tundra'].includes(config.biome))choices=[['gable',.60],['hip',.25],['shed',.15]];
 else if(config.type==='mansion')choices=[['gable',.40],['hip',.40],['shed',.12],['flat',.08]];
 else if(['annex','wing','entrance','shed'].includes(role))choices=[['gable',.35],['hip',.25],['shed',.33],['flat',.07]];
 let cumulative=0;
 for(const [kind,weight] of choices){cumulative+=weight;if(roll<cumulative)return kind;}
 return choices[choices.length-1][0];
}
