import {moreScenery} from './grammars/moreScenery';
import {workshops} from './grammars/workshops';
import {scenery} from './grammars/scenery';
import {stoneLantern} from './grammars/stoneLantern';
import {camp,outpost,treehouse,desert,swamp,snowy,mine,dock,lighthouse} from './grammars/special';
import {fortress,castle,ruinedCastle,ancientRuins,temple} from './grammars/fortified';
import {farm,barn,stable,watchtower,ruinedTower,windmill} from './grammars/rural';
import {bridge,wall,gate,stoneTower} from './grammars/infrastructure';
import {fitWindowsAroundRoofs} from './windowPlacement';
import {replaceConstructionObjects} from './objectProps';
import type {StructureAssetConfig,Grammar,StructurePlan} from './types';import {normalizeStructureConfig} from './config';import {structureStreams} from './random';import {house,largeHouse,cabin,mansion,abandonedHouse,ruinedHouse} from './grammars/houses';import {validateStructurePlan} from './validation';
const grammars:Partial<Record<StructureAssetConfig['structure']['type'],Grammar>>={stoneTower,woodFence:moreScenery,woodGate:moreScenery,woodenCart:moreScenery,toolRack:moreScenery,stoneWell:moreScenery,stoneFountain:moreScenery,mossPatch:moreScenery,ivyPatch:moreScenery,rootPatch:moreScenery,blacksmith:workshops,market:workshops,watermill:workshops,dirtPath:scenery,stonePath:scenery,woodenCrate:scenery,woodenBarrel:scenery,supplySacks:scenery,firewoodPile:scenery,stoneLantern,house,largeHouse,cabin,mansion,abandonedHouse,ruinedHouse,farm,barn,stable,watchtower,ruinedTower,windmill,bridge,wall,gate,fortress,castle,ruinedCastle,ancientRuins,temple,camp,outpost,treehouse,desert,swamp,snowy,mine,dock,lighthouse};
export function buildStructurePlan(asset:StructureAssetConfig):StructurePlan{const config=normalizeStructureConfig(asset.structure),seed=Number.isFinite(asset.seed)?Math.floor(asset.seed):1;const grammar=grammars[config.type];if(!grammar)throw Error('Gramática ainda não implementada: '+config.type);const context={config,seed,streams:structureStreams(seed)};const plan=fitWindowsAroundRoofs(replaceConstructionObjects(grammar(context),context));// Window poses have their own streams so appearance controls cannot move the leaves.
for(const opening of plan.openings)if(opening.kind==='window'){
 const rnd=structureStreams(seed).streamFor('window-pose',opening.id),state=rnd();
 const partial=()=>Math.round(35+rnd()*45),open=()=>Math.round(145+rnd()*25);
 if(plan.type==='snowy')continue;opening.shutterAngles=state<.25?[0,0]:state<.65?[partial(),rnd()<.3?0:partial()]:[open(),open()];
}
const errors=validateStructurePlan(plan);if(errors.length)throw Error(errors.join('; '));return plan;}
