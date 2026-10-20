import {woodenBarrel} from './grammars/barrel';
import {woodenCrate} from './grammars/crate';
import type {GrammarContext,StructurePlan,V3} from './types';

/** Place the Objects models without translating dimension metadata in `end`. */
export function placeObject(target:StructurePlan,object:StructurePlan,prefix:string,offset:V3,support='ground',rootId?:string){
 const move=(point:V3):V3=>point.map((value,i)=>value+offset[i]) as V3;
 const core=object.pieces.find(piece=>piece.role==='barrel-core'||piece.role==='crate-core')!;
 const id=(value:string)=>value==='ground'?support:value===core.id&&rootId?rootId:prefix+'_'+value;
 for(const piece of object.pieces)target.pieces.push({...piece,id:id(piece.id),support:id(piece.support),position:move(piece.position),
  end:piece.end&&(piece.kind==='beam'||piece.kind==='stairs')?move(piece.end):piece.end,
  cuts:piece.cuts?{start:move(piece.cuts.start),end:move(piece.cuts.end)}:undefined});
 for(const dependency of object.supports)target.supports.push({...dependency,component:id(dependency.component),on:id(dependency.on)});
 for(const joint of object.joints)target.joints.push({...joint,id:prefix+'_'+joint.id,point:move(joint.point),members:joint.members.map(id)});
}

const barrelRoles=new Set(['barn-barrel','fortress-barrel','tower-barrel','camp-barrel','swamp-barrel']);
const crateRoles=new Set(['barn-supply-crate','fortress-supply-crate','tower-supply-crate','camp-crate','farm-crate','desert-crate','outpost-crate','swamp-crate','market-crate']);
const oldDetail=/^(barn|fortress|tower|camp|farm|desert|outpost|swamp|market)-(?:.*crate|barrel)/;

/** Legacy grammar slots retain their footprint and floor height, but share the authored Objects models. */
export function replaceConstructionObjects(plan:StructurePlan,context:GrammarContext){
 const slots=plan.pieces.filter(piece=>barrelRoles.has(piece.role)||crateRoles.has(piece.role));
 if(!slots.length)return plan;
 const removed=new Set(plan.pieces.filter(piece=>oldDetail.test(piece.role)).map(piece=>piece.id));
 plan.pieces=plan.pieces.filter(piece=>!removed.has(piece.id));
 plan.supports=plan.supports.filter(dependency=>!removed.has(dependency.component));
 plan.joints=plan.joints.map(joint=>({...joint,members:joint.members.filter(id=>!removed.has(id))})).filter(joint=>joint.members.length);
 for(const slot of slots){
  const type=barrelRoles.has(slot.role)?'woodenBarrel':'woodenCrate';
  const [width,height,depth]=slot.size;
  const objectContext={...context,config:{...context.config,type,width,height,depth}} as GrammarContext;
  const object=type==='woodenBarrel'?woodenBarrel(objectContext):woodenCrate(objectContext);
  placeObject(plan,object,'object_'+slot.id,[slot.position[0],slot.position[1]-height/2,slot.position[2]],slot.support,slot.id);
 }
 return plan;
}
