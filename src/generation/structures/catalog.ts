import type { StructureDescriptor,StructureKind,StructureAssetConfig } from './types';
const d=(name:string,family:string,w=7,dep=6,h=3,floors=2,extra:Partial<StructureDescriptor>={}):StructureDescriptor=>({name,family,width:[3,w*2.5],depth:[3,dep*2.5],height:[2,h*3],floors,...extra});
export const STRUCTURE_DESCRIPTORS:Record<StructureKind,StructureDescriptor>={
 house:d('Casa simples','Moradias'),largeHouse:d('Casa grande','Moradias',10,8,6,3),cabin:d('Cabana','Moradias',5,5,3,1),abandonedHouse:d('Casa abandonada','Moradias',7,6,3,2,{ruin:.24}),ruinedHouse:d('Casa em ruínas','Moradias',7,6,3,2,{ruin:.40}),mansion:d('Mansão','Moradias',14,10,7,3),
 farm:d('Fazenda','Rurais',14,12),barn:d('Celeiro','Rurais',8,11,5,1),stable:d('Estábulo','Rurais',11,7,3,1),watchtower:d('Torre de vigia','Rurais',5,5,9,4),ruinedTower:d('Torre em ruínas','Rurais',5,5,9,4,{ruin:.40}),windmill:d('Moinho','Rurais',6,6,12,3),
 fortress:d('Fortaleza pequena','Fortificações',16,14,6,3),castle:d('Castelo','Fortificações',22,19,9,4),ruinedCastle:d('Castelo em ruínas','Fortificações',22,19,9,4,{ruin:.40}),ancientRuins:d('Ruínas antigas','Ancestrais',12,9,4,1,{ruin:.40}),temple:d('Templo antigo','Ancestrais',13,15,7,2),
 bridge:d('Ponte','Infraestrutura',12,4,3,1,{depth:[2,8]}),wall:d('Muralha','Infraestrutura',15,4,5,1,{depth:[1,8]}),gate:d('Portão','Infraestrutura',10,5,6,2),dock:d('Doca','Infraestrutura',12,8,3,1),lighthouse:d('Farol','Infraestrutura',6,6,13,4),
 camp:d('Acampamento','Conjuntos',12,10,3,1),outpost:d('Posto avançado','Conjuntos',15,12,6,2),treehouse:d('Casa na árvore','Especiais',8,7,7,2),desert:d('Estrutura de deserto','Regionais',11,10,5,2,{biome:'gerudo'}),swamp:d('Estrutura de pântano','Regionais',9,8,4,1,{biome:'swamp'}),snowy:d('Estrutura nevada','Regionais',7,7,4,2,{biome:'hebra_snowy'}),mine:d('Mina','Especiais',10,10,5,1),
 hamlet:d('Vila pequena','Assentamentos',10,10,6,1,{width:[8,40],depth:[8,40],height:[3,15]}),village:d('Vilarejo','Assentamentos',10,10,6,1,{width:[8,40],depth:[8,40],height:[3,15]}),town:d('Cidade','Assentamentos',10,10,6,1,{width:[8,40],depth:[8,40],height:[3,15]}),fortifiedTown:d('Cidade fortificada','Assentamentos',10,10,6,1,{width:[8,40],depth:[8,40],height:[3,15]}),
 stoneTower:d('Torre de pedra','Fortificações',6,6,9,1,{width:[4,10],depth:[4,10],height:[5,16]}),
 woodFence:d('Cerca de madeira','Objetos',3,.3,1.1,1,{width:[1,8],depth:[.2,1],height:[.6,2]}),
 woodGate:d('Portão de cerca','Objetos',1.7,.3,1.2,1,{width:[.8,3],depth:[.2,1],height:[.6,2]}),
 woodenCart:d('Carroça','Objetos',1.4,2.0,1.4,1,{width:[1,2.5],depth:[1.2,3.5],height:[1,2]}),
 toolRack:d('Ferramentas','Objetos',1.2,.4,1.2,1,{width:[.6,2],depth:[.3,1],height:[.7,2]}),
 stoneWell:d('Poço de pedra','Objetos',2,2,2.3,1,{width:[1.2,3],depth:[1.2,3],height:[1.5,3]}),
 stoneFountain:d('Fonte de pedra','Objetos',2.6,2.6,2,1,{width:[1.5,4],depth:[1.5,4],height:[1.2,3]}),
 mossPatch:d('Mancha de musgo','Vegetação',2,2,.05,1,{width:[.5,5],depth:[.5,5],height:[.02,.1]}),
 ivyPatch:d('Vinhas pendentes','Vegetação',1,1,2,1,{width:[.4,3],depth:[.3,2],height:[.5,4]}),
 rootPatch:d('Raízes expostas','Vegetação',2,2,.35,1,{width:[.8,4],depth:[.8,4],height:[.15,.8]}),
 blacksmith:d('Ferreiro','Ofícios',8,7,4,1,{width:[6,14],depth:[6,12],height:[3,6]}),
 market:d('Mercado com barracas','Ofícios',9,6,2.6,1,{width:[6,16],depth:[4,10],height:[2,4]}),
 watermill:d('Moinho d’água','Ofícios',8,8,5,1,{width:[6,16],depth:[6,14],height:[3,7]}),
 dirtPath:d('Caminho de terra','Caminhos',7,4,.05,1,{width:[2,16],depth:[1,10],height:[.03,.20]}),
 stonePath:d('Caminho de pedra','Caminhos',7,4,.05,1,{width:[2,16],depth:[1,10],height:[.03,.20]}),
 woodenCrate:d('Caixa de madeira','Objetos',1.1,.9,1,1,{width:[.4,3],depth:[.4,3],height:[.4,3]}),
 woodenBarrel:d('Barril de madeira','Objetos',.9,.9,1.2,1,{width:[.4,2],depth:[.4,2],height:[.5,2.5]}),
 supplySacks:d('Saco de provisões','Objetos',.75,.65,.95,1,{width:[.3,2],depth:[.3,2],height:[.3,2]}),
 firewoodPile:d('Pilha de lenha','Objetos',1.4,1.5,.8,1,{width:[.5,3],depth:[.5,3],height:[.3,1.8]}),
 stoneLantern:d('Lanterna de pedra','Decoração',1.9,1.9,3.5,1,{width:[1.4,3.0],depth:[1.4,3.0],height:[2.4,5.0]}),
};
STRUCTURE_DESCRIPTORS.camp.width[0]=10;STRUCTURE_DESCRIPTORS.camp.depth[0]=10;
// Functional minima keep towers, passages and room widths usable at the slider extremes.
for(const kind of ['fortress','castle','ruinedCastle'] as const){STRUCTURE_DESCRIPTORS[kind].width[0]=12;STRUCTURE_DESCRIPTORS[kind].depth[0]=10;}
for(const kind of ['farm','outpost','temple','treehouse','desert','swamp','mine','gate','lighthouse'] as const){STRUCTURE_DESCRIPTORS[kind].width[0]=6;STRUCTURE_DESCRIPTORS[kind].depth[0]=6;}
export const STRUCTURE_PRESETS=Object.fromEntries(Object.entries(STRUCTURE_DESCRIPTORS).map(([key,p],i)=>{const type=key as StructureKind;const id=`structure_${type}` as const;return [id,{id,species:id,name:p.name,seed:7010+i,structure:{type,...(type==='stable'?{hayAmount:.7}:{}),biome:p.biome??'hyrule',scale:1,width:p.width[1]/2.5,depth:p.depth[1]/2.5,height:p.height[1]/3,floors:type==='largeHouse'||type==='mansion'||type==='castle'||type==='windmill'?2:1,complexity:.55,roof:'auto',roofPitch:.55,eaves:.55,asymmetry:.4,finish:.6,openingDensity:.6,annexes:true,balconies:true,ruin:p.ruin??0,vegetation:.3,snow:p.biome==='hebra_snowy'?.65:0,texelsPerMetre:32,palette:{wood:'#855b3e',stone:p.biome==='gerudo'?'#b19772':type==='windmill'?'#bbae91':(type==='temple'||type==='ancientRuins')?'#b4ae9b':type==='castle'||type==='ruinedCastle'?'#b1ad9d':'#929096',plaster:type==='desert'?'#e4c998':'#d3ded8',roof:p.biome==='gerudo'?'#b47f4c':type==='windmill'||(type==='outpost'||type==='treehouse')?'#3f6684':type==='barn'||type==='farm'?'#9c7044':type==='mansion'?'#426e58':type==='castle'||type==='ruinedCastle'?'#3f617b':'#42576a'}}} satisfies StructureAssetConfig];})) as Record<`structure_${StructureKind}`,StructureAssetConfig>;

const stoneLanternPreset=STRUCTURE_PRESETS.structure_stoneLantern;
Object.assign(stoneLanternPreset.structure,{width:1.9,depth:1.9,height:3.5,vegetation:.20,annexes:false,balconies:false,palette:{wood:'#795339',stone:'#96958b',plaster:'#d3ded8',roof:'#686e63'}});

for(const type of ['dirtPath','stonePath','woodenCrate','woodenBarrel','supplySacks','firewoodPile'] as const){const c=STRUCTURE_PRESETS[`structure_${type}`].structure;Object.assign(c,{vegetation:0,ruin:0,snow:0,annexes:false,balconies:false,pathStyle:'straight',pathWidth:1.1});}


STRUCTURE_PRESETS.structure_dirtPath.structure.palette.plaster='#967348';
STRUCTURE_PRESETS.structure_supplySacks.structure.palette.plaster='#b49c71';

for(const type of ['woodFence','woodGate','woodenCart','toolRack','stoneWell','stoneFountain','mossPatch','ivyPatch','rootPatch'] as const){const c=STRUCTURE_PRESETS[`structure_${type}`].structure;Object.assign(c,{vegetation:0,ruin:0,snow:0,annexes:false,balconies:false});}
Object.assign(STRUCTURE_PRESETS.structure_blacksmith.structure,{width:8,depth:7,height:4});
Object.assign(STRUCTURE_PRESETS.structure_market.structure,{width:9,depth:6,height:2.6,vegetation:.15});
Object.assign(STRUCTURE_PRESETS.structure_watermill.structure,{width:8,depth:8,height:5});

STRUCTURE_PRESETS.structure_mossPatch.structure.palette.plaster='#567b32';Object.assign(STRUCTURE_PRESETS.structure_stoneTower.structure,{width:5.8,depth:4.8,height:9.5,vegetation:.35,annexes:false,balconies:false,ruin:0});


Object.assign(STRUCTURE_PRESETS.structure_woodFence.structure,{width:4.8,depth:.36,height:1.3});
STRUCTURE_PRESETS.structure_woodFence.structure.palette.wood='#896039';


Object.assign(STRUCTURE_PRESETS.structure_woodGate.structure,{width:2.4,depth:.40,height:1.45});
STRUCTURE_PRESETS.structure_woodGate.structure.palette.wood='#896039';



Object.assign(STRUCTURE_PRESETS.structure_woodenCart.structure,{width:1.5,depth:2.2,height:1.45});
STRUCTURE_PRESETS.structure_woodenCart.structure.palette.wood='#896039';


Object.assign(STRUCTURE_PRESETS.structure_toolRack.structure,{width:1.55,depth:.4,height:1.35});


Object.assign(STRUCTURE_PRESETS.structure_stoneWell.structure,{width:2,depth:2,height:2.3});


STRUCTURE_PRESETS.structure_stoneWell.structure.palette.stone='#8c8f87';
STRUCTURE_PRESETS.structure_stoneFountain.structure.palette.stone='#8c8f87';
STRUCTURE_PRESETS.structure_stoneFountain.structure.vegetation=.16;
Object.assign(STRUCTURE_PRESETS.structure_woodenBarrel.structure,{width:1,depth:1,height:1.2});
STRUCTURE_PRESETS.structure_woodenBarrel.structure.palette.wood='#855b3e';
Object.assign(STRUCTURE_PRESETS.structure_woodenCrate.structure,{width:1.1,depth:1,height:1});
STRUCTURE_PRESETS.structure_woodenCrate.structure.palette.wood='#855b3e';
Object.assign(STRUCTURE_PRESETS.structure_supplySacks.structure,{width:.8,depth:.74,height:1});
STRUCTURE_PRESETS.structure_supplySacks.structure.palette.plaster='#bd9358';
Object.assign(STRUCTURE_PRESETS.structure_watermill.structure,{width:8,depth:8,height:5,floors:1,roof:'gable',asymmetry:.12,vegetation:.18});
Object.assign(STRUCTURE_PRESETS.structure_watermill.structure.palette,{wood:'#855b3e',plaster:'#c7c1ac',stone:'#8d9088',roof:'#42657a'});

// Keep legacy geometry definitions for old configurations, without exposing
// these standalone assets in the catalog. Existing asset seeds stay unchanged.
for(const type of ['mossPatch','ivyPatch','rootPatch','firewoodPile','dirtPath','stonePath'] as const){
 delete STRUCTURE_PRESETS[`structure_${type}`];
}
