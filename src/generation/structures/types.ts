import type { RockBiome } from '../vegetation/pixelTrees/types';
export type StructureKind='house'|'largeHouse'|'cabin'|'abandonedHouse'|'ruinedHouse'|'farm'|'barn'|'stable'|'watchtower'|'ruinedTower'|'windmill'|'fortress'|'castle'|'ruinedCastle'|'ancientRuins'|'temple'|'bridge'|'wall'|'gate'|'camp'|'outpost'|'mansion'|'treehouse'|'desert'|'swamp'|'snowy'|'mine'|'dock'|'lighthouse'|'stoneLantern'|'dirtPath'|'stonePath'|'woodenCrate'|'woodenBarrel'|'supplySacks'|'firewoodPile'|'woodFence'|'woodGate'|'woodenCart'|'toolRack'|'stoneWell'|'stoneFountain'|'mossPatch'|'ivyPatch'|'rootPatch'|'blacksmith'|'market'|'watermill'|'hamlet'|'village'|'town'|'fortifiedTown'|'stoneTower';
export type StructureId=`structure_${StructureKind}`;
export type V3=[number,number,number];
export type SurfaceMaterial='wood'|'stone'|'plaster'|'roof'|'thatch'|'metal'|'cloth'|'dark'|'earth'|'water';
export type RoofKind='auto'|'gable'|'hip'|'shed'|'flat'|'thatch';
export type BridgeStyle='timber'|'stoneArch'|'covered'|'suspension'|'stepped';
export interface StructureConfig {settlement?:import('../settlements/types').SettlementSettings;wallStairs?:boolean;wallStairSide?:1|-1;pathStyle?:'straight'|'curve'|'junction';pathWidth?:number;bridgeStyle?:BridgeStyle;campTentCount?:number;hayAmount?:number;type:StructureKind;biome:RockBiome;scale:number;width:number;depth:number;height:number;floors:number;complexity:number;roof:RoofKind;roofPitch:number;eaves:number;asymmetry:number;finish:number;openingDensity:number;annexes:boolean;balconies:boolean;ruin:number;vegetation:number;snow:number;texelsPerMetre:number;palette:{wood:string;stone:string;plaster:string;roof:string};}
export interface StructureAssetConfig {id:StructureId;species:StructureId;name:string;seed:number;structure:StructureConfig;}
export interface VolumeSpec {id:string;x:number;z:number;width:number;depth:number;bottom:number;height:number;floors:number;role:string;}
export interface WallSpec {id:string;volume:string;start:V3;end:V3;bottom:number;height:number;thickness:number;material:SurfaceMaterial;gable?:{peak:number;ratio:number};topLeft?:number;topRight?:number;removed?:boolean;damage?:number;}
export interface OpeningSpec {arched?:boolean;id:string;wall:string;kind:'door'|'window';offset:number;width:number;bottom:number;height:number;shutterAngles?:[number,number];broken?:boolean;}
export interface RoofSurface {rotationY?:number;plainEdge?:boolean;flatThickness?:number;accessHole?:{x:number;z:number;width:number;depth:number};royalTrim?:boolean;abutment?:{axis:0|2;value:number;keep:1|-1};shedAxis?:0|2;shedDirection?:1|-1;id:string;volume:string;x:number;z:number;width:number;depth:number;y:number;rise:number;eaves:number;ridgeRatio?:number;kind:Exclude<RoofKind,'auto'>;material:SurfaceMaterial;removed?:boolean;damage?:number;}
export interface PieceSpec {id:string;kind:'box'|'beam'|'column'|'arch'|'stairs'|'wheel'|'rock'|'cloth'|'tree';position:V3;size:V3;rotation?:V3;end?:V3;cuts?:{start:V3;end:V3};material:SurfaceMaterial;support:string;role:string;removed?:boolean;damage?:number;}
export interface JointSpec {id:string;point:V3;members:string[];}
export interface AccessSpec {id:string;from:V3;to:V3;width:number;role:string;}
export interface SupportSpec {component:string;on:string;minimum?:number;}
export interface PropZone {id:string;x:number;z:number;width:number;depth:number;y:number;kind:'garden'|'rubble'|'cultivation'|'water';}
export interface StructurePlan {schemaVersion:1;type:StructureKind;seed:number;volumes:VolumeSpec[];walls:WallSpec[];openings:OpeningSpec[];roofs:RoofSurface[];pieces:PieceSpec[];joints:JointSpec[];supports:SupportSpec[];accesses:AccessSpec[];damage:string[];debris:PieceSpec[];propZones:PropZone[];}
export interface StructureStreams {streamFor(stage:string,id:string):()=>number;}
export interface GrammarContext {config:StructureConfig;seed:number;streams:StructureStreams;}
export type Grammar=(context:GrammarContext)=>StructurePlan;
export interface StructureDescriptor {name:string;family:string;width:[number,number];depth:[number,number];height:[number,number];floors:number;biome?:RockBiome;ruin?:number;}
