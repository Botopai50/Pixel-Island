import type {StructureKind} from './types';
export const isPathType=(type:StructureKind)=>type==='dirtPath'||type==='stonePath';
export const isObjectType=(type:StructureKind)=>['woodenCrate','woodenBarrel','supplySacks','firewoodPile','woodFence','woodGate','woodenCart','toolRack','stoneWell','stoneFountain','mossPatch','ivyPatch','rootPatch'].includes(type);
export const isSceneryType=(type:StructureKind)=>isPathType(type)||isObjectType(type);
