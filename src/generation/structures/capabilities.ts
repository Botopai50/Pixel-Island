import {isSceneryType} from './sceneryTypes';
import type {StructureKind} from './types';
export function structureCapabilities(type:StructureKind){return {
 floors:['house','largeHouse','abandonedHouse','ruinedHouse','mansion','castle','ruinedCastle','snowy','windmill'].includes(type),
 windows:!isSceneryType(type)&&!['stoneLantern','bridge','dock','camp','wall','watchtower','ruinedTower','stable','ancientRuins','mine','market'].includes(type),
 roof:!isSceneryType(type)&&!['stoneLantern','bridge','dock','camp','wall','watchtower','ruinedTower','lighthouse','mine','snowy','temple','ancientRuins','market'].includes(type),
 minFloors:['largeHouse','mansion','windmill'].includes(type)?2:1,
};}
