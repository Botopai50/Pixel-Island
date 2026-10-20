import type { StructureStreams } from './types';
export function structureStreams(seed:number):StructureStreams {
 const base=Number.isFinite(seed)?Math.floor(seed):1;
 return {streamFor(stage,id){let state=2166136261;for(const c of base+'|'+stage+'|'+id)state=Math.imul(state^c.charCodeAt(0),16777619);return ()=>{state+=0x6D2B79F5;let t=Math.imul(state^(state>>>15),1|state);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}};
}
