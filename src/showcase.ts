import * as THREE from 'three';
import { VegetationGeometries } from './generation/vegetation/vegetationManager.ts';
import { VegetationTextures } from './generation/vegetation/vegetationTextures.ts';

interface ItemSpec {
  id: string;
  name: string;
  category: 'Mature Tree' | 'Sapling (Muda)' | 'Shrub' | 'Flora' | 'Rock Variety' | 'Timber Variety' | 'Tree Variant' | 'Ground Flora';
  biome: string;
  height: string;
  desc: string;
  createMesh: () => THREE.Object3D;
}

VegetationGeometries.init();

// Materials
const barkTex = VegetationTextures.getBarkTexture();
const birchTex = VegetationTextures.getBirchBarkTexture();
const palmBarkTex = VegetationTextures.getPalmBarkTexture();
const foliageTex = VegetationTextures.getFoliageTexture();
const palmFrondTex = VegetationTextures.getPalmFrondTexture();
const cactusTex = VegetationTextures.getCactusTexture();
const snowFoliageTex = VegetationTextures.getSnowFoliageTexture();
const burntTex = VegetationTextures.getBurntWoodTexture();
const rockTex = VegetationTextures.getRockTexture();
const woodTex = VegetationTextures.getWeatheredWoodTexture();

const matTrunk = new THREE.MeshLambertMaterial({ map: barkTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matBirchTrunk = new THREE.MeshLambertMaterial({ map: birchTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matPalmTrunk = new THREE.MeshLambertMaterial({ map: palmBarkTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matOakLeaves = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matBirchLeaves = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matPineLeaves = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matPalmLeaves = new THREE.MeshLambertMaterial({ map: palmFrondTex, color: 0xffffff, vertexColors: true, flatShading: false, side: THREE.DoubleSide });
const matAcaciaTrunk = new THREE.MeshLambertMaterial({ map: barkTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matAcaciaLeaves = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matCactus = new THREE.MeshLambertMaterial({ map: cactusTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matSnowPineTrunk = new THREE.MeshLambertMaterial({ map: barkTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matSnowPineLeaves = new THREE.MeshLambertMaterial({ map: snowFoliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matArcticWillowTrunk = new THREE.MeshLambertMaterial({ map: barkTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matArcticWillowLeaves = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matMangroveTrunk = new THREE.MeshLambertMaterial({ map: barkTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matMangroveLeaves = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matBurntTrunk = new THREE.MeshLambertMaterial({ map: burntTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matShrub = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matBerryBush = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matRock = new THREE.MeshLambertMaterial({ map: rockTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matWood = new THREE.MeshLambertMaterial({ map: woodTex, color: 0xffffff, vertexColors: true, flatShading: false });
const matFlora = new THREE.MeshLambertMaterial({ map: foliageTex, color: 0xffffff, vertexColors: true, flatShading: false, side: THREE.DoubleSide });

function createPairGroup(trunkGeo: THREE.BufferGeometry, leavesGeo: THREE.BufferGeometry, trunkMat: THREE.Material, leavesMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  const leaves = new THREE.Mesh(leavesGeo, leavesMat);
  trunk.castShadow = true; trunk.receiveShadow = true;
  leaves.castShadow = true; leaves.receiveShadow = true;
  group.add(trunk);
  group.add(leaves);
  return group;
}

const ITEMS: Record<string, ItemSpec> = {
  oak: {
    id: 'oak',
    name: 'Carvalho Temperado Adulto (Mature Oak)',
    category: 'Mature Tree',
    biome: 'TEMPERATE_FOREST',
    height: '11.8m (Escala Humana)',
    desc: 'Tronco cilíndrico robusto e 3 galhos mestres estruturais contínuos enraizados no cerne. Copa majestosa de 5 aglomerados facetados interpenetrantes com textura de casca e folhas estilizadas.',
    createMesh: () => createPairGroup(VegetationGeometries.oakTrunk, VegetationGeometries.oakLeaves, matTrunk, matOakLeaves)
  },
  oak_sapling: {
    id: 'oak_sapling',
    name: 'Muda de Carvalho (Oak Sapling)',
    category: 'Sapling (Muda)',
    biome: 'TEMPERATE_FOREST',
    height: '3.6m (Porte Jovem)',
    desc: 'Espécime jovem esbelto, com caule flexível e copa compacta esférica. Perfeita transição de escala comparada ao carvalho ancestral adulto.',
    createMesh: () => createPairGroup(VegetationGeometries.oakSaplingTrunk, VegetationGeometries.oakSaplingLeaves, matTrunk, matOakLeaves)
  },
  pine: {
    id: 'pine',
    name: 'Pinheiro Conífero Adulto (Mature Pine)',
    category: 'Mature Tree',
    biome: 'BOREAL_FOREST / MOUNTAINS',
    height: '15.2m (Grande Porte)',
    desc: 'Conífera majestosa com fuste reto e copa em 4 andares cônicos concêntricos decrescentes com domo apical facetado. Alta fidelidade volumétrica.',
    createMesh: () => createPairGroup(VegetationGeometries.pineTrunk, VegetationGeometries.pineLeaves, matTrunk, matPineLeaves)
  },
  pine_sapling: {
    id: 'pine_sapling',
    name: 'Muda de Pinheiro (Pine Sapling)',
    category: 'Sapling (Muda)',
    biome: 'BOREAL_FOREST / MOUNTAINS',
    height: '4.5m (Porte Jovem)',
    desc: 'Pinheirinho jovem piramidal de 2 patamares cônicos bem definidos, mantendo a silhueta conífera em escala de crescimento.',
    createMesh: () => createPairGroup(VegetationGeometries.pineSaplingTrunk, VegetationGeometries.pineSaplingLeaves, matTrunk, matPineLeaves)
  },
  birch: {
    id: 'birch',
    name: 'Bétula Branca Adulta (Mature Birch)',
    category: 'Mature Tree',
    biome: 'TEMPERATE_FOREST / PLAINS',
    height: '11.5m (Escala Humana)',
    desc: 'Fuste elegante e esguio com textura exclusiva de ritidoma branco e lenticelas horizontais pretas características. Copa esbelta elipsoidal em 3 níveis verticais.',
    createMesh: () => createPairGroup(VegetationGeometries.birchTrunk, VegetationGeometries.birchLeaves, matBirchTrunk, matBirchLeaves)
  },
  birch_sapling: {
    id: 'birch_sapling',
    name: 'Muda de Bétula (Birch Sapling)',
    category: 'Sapling (Muda)',
    biome: 'TEMPERATE_FOREST / PLAINS',
    height: '3.8m (Porte Jovem)',
    desc: 'Caule jovem com textura de bétula branca e copa cônica de 2 folhagens delicadas, expressando delicadeza e vigor juvenil.',
    createMesh: () => createPairGroup(VegetationGeometries.birchSaplingTrunk, VegetationGeometries.birchSaplingLeaves, matBirchTrunk, matBirchLeaves)
  },
  palm: {
    id: 'palm',
    name: 'Coqueiro Costeiro Adulto (Mature Palm)',
    category: 'Mature Tree',
    biome: 'BEACH / TROPICAL_COAST',
    height: '12.5m (Grande Porte Costeiro)',
    desc: 'Tronco contínuo sem cortes ou anéis flutuantes (mesh único com curvatura suave matemática dx = -1.95*t^2). Coroa tropical com 7 frondes curvadas radialmente com textura de folíolos.',
    createMesh: () => createPairGroup(VegetationGeometries.palmTrunk, VegetationGeometries.palmLeaves, matPalmTrunk, matPalmLeaves)
  },
  palm_sapling: {
    id: 'palm_sapling',
    name: 'Muda de Coqueiro (Palm Sprout)',
    category: 'Sapling (Muda)',
    biome: 'BEACH / TROPICAL_COAST',
    height: '2.6m (Broto Costeiro)',
    desc: 'Broto litorâneo germinando de um coco basal realista, com 5 folíolos arqueados abertos captando a brisa costeira.',
    createMesh: () => createPairGroup(VegetationGeometries.palmSaplingTrunk, VegetationGeometries.palmSaplingLeaves, matPalmTrunk, matPalmLeaves)
  },
  acacia: {
    id: 'acacia',
    name: 'Acácia da Savana Adulta (Mature Acacia)',
    category: 'Mature Tree',
    biome: 'SAVANNA',
    height: '10.2m (Copa Umbreliforme)',
    desc: 'Arquitetura africana autêntica: tronco angulado com galhos bifurcados sustentando 3 discos de folhagem achatada horizontalmente (umbrella canopy).',
    createMesh: () => createPairGroup(VegetationGeometries.acaciaTrunk, VegetationGeometries.acaciaLeaves, matAcaciaTrunk, matAcaciaLeaves)
  },
  acacia_sapling: {
    id: 'acacia_sapling',
    name: 'Muda de Acácia (Acacia Sapling)',
    category: 'Sapling (Muda)',
    biome: 'SAVANNA',
    height: '3.5m (Porte Jovem)',
    desc: 'Muda jovem de savana com tronco reto e copa em disco umbreliforme inicial, prenunciando a expansão horizontal adulta.',
    createMesh: () => createPairGroup(VegetationGeometries.acaciaSaplingTrunk, VegetationGeometries.acaciaSaplingLeaves, matAcaciaTrunk, matAcaciaLeaves)
  },
  saguaro: {
    id: 'saguaro',
    name: 'Cacto Saguaro Adulto (Mature Saguaro)',
    category: 'Flora',
    biome: 'DESERT',
    height: '6.5m (Colunar Imponente)',
    desc: 'Cacto colunar icônico com fuste canelado e dois braços verticais soldados solidamente ao corpo sem costuras ou aberturas. Textura procedural com estrias e espinhos.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.cactusBody, matCactus);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  saguaro_sapling: {
    id: 'saguaro_sapling',
    name: 'Muda de Cacto Saguaro (Saguaro Sprout)',
    category: 'Sapling (Muda)',
    biome: 'DESERT',
    height: '2.4m (Coluna Jovem)',
    desc: 'Coluna juvenil individual simples e robusta, típica dos primeiros anos de desenvolvimento do saguaro desértico antes do surgimento dos braços.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.cactusSaplingBody, matCactus);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  snow_pine: {
    id: 'snow_pine',
    name: 'Pinheiro Nevado Glacial (Snow Pine)',
    category: 'Mature Tree',
    biome: 'FROZEN_TUNDRA / GLACIAL_PEAKS',
    height: '14.5m (Conífera Ártica)',
    desc: 'Conífera polar imponente adaptada a nevascas extremas. Copa escalonada de 4 patamares com topo pontiagudo nevado e textura de acículas cobertas por geada.',
    createMesh: () => createPairGroup(VegetationGeometries.snowPineTrunk, VegetationGeometries.snowPineLeaves, matSnowPineTrunk, matSnowPineLeaves)
  },
  arctic_willow: {
    id: 'arctic_willow',
    name: 'Salgueiro-Anão da Tundra (Arctic Willow)',
    category: 'Flora',
    biome: 'FROZEN_TUNDRA',
    height: '2.2m (Arbóreo Rasteiro)',
    desc: 'Vegetação polar adaptada a ventos catabáticos gélidos. Caule tortuoso e retorcido rente ao solo com massas foliares densas que resistem ao congelamento permafrost.',
    createMesh: () => createPairGroup(VegetationGeometries.arcticWillowTrunk, VegetationGeometries.arcticWillowLeaves, matArcticWillowTrunk, matArcticWillowLeaves)
  },
  mangrove: {
    id: 'mangrove',
    name: 'Manguezal Adulto com Raízes Escoras (Mature Mangrove)',
    category: 'Mature Tree',
    biome: 'MANGROVE_SWAMP',
    height: '11.5m (Halófita Monumental)',
    desc: 'Tronco sólido conectado a 4 raízes escoras curvadas e contínuas (stilt roots) que nascem diretamente do caule sem partes flutuantes. Copa frondosa densa em 4 camadas.',
    createMesh: () => createPairGroup(VegetationGeometries.mangroveTrunk, VegetationGeometries.mangroveLeaves, matMangroveTrunk, matMangroveLeaves)
  },
  mangrove_sapling: {
    id: 'mangrove_sapling',
    name: 'Muda de Manguezal (Mangrove Sapling)',
    category: 'Sapling (Muda)',
    biome: 'MANGROVE_SWAMP',
    height: '3.4m (Propágulo Jovem)',
    desc: 'Muda vigorosa com fuste vertical enraizado e broto foliar apical, representando o propágulo fixado na lama costeira da maré.',
    createMesh: () => createPairGroup(VegetationGeometries.mangroveSaplingTrunk, VegetationGeometries.mangroveSaplingLeaves, matMangroveTrunk, matMangroveLeaves)
  },
  burnt_tree: {
    id: 'burnt_tree',
    name: 'Árvore Calcinada Vulcânica (Burnt Tree)',
    category: 'Flora',
    biome: 'VOLCANIC_CALDERA / GEOTHERMAL_VALLEY',
    height: '4.8m (Tronco Fóssil Carbonizado)',
    desc: 'Tronco esquelético calcinado por erupções e cinzas vulcânicas, com galho quebrado residual e textura de carvão piroclástico.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.deadTrunk, matBurntTrunk);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  lush_shrub: {
    id: 'lush_shrub',
    name: 'Arbusto Exuberante da Floresta (Lush Shrub)',
    category: 'Shrub',
    biome: 'TEMPERATE_FOREST / PLAINS',
    height: '1.5m (Sub-bosque)',
    desc: 'Massa foliar rasteira densa composta por 3 aglomerados facetados interpenetrantes com textura de folhagem e sombreamento natural.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.shrubLush, matShrub);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  berry_bush: {
    id: 'berry_bush',
    name: 'Arbusto com Bagas Silvestres (Berry Bush)',
    category: 'Shrub',
    biome: 'TEMPERATE_FOREST / PLAINS',
    height: '1.6m (Sub-bosque Frutífero)',
    desc: 'Arbusto robusto ornamentado com 10 bagas silvestres distribuídas organicamente pelo perímetro foliar, conferindo vida e riqueza ao sub-bosque.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.shrubBerry, matBerryBush);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },

  // ROCHAS VARIADAS (5 Formatos)
  rock_boulder: {
    id: 'rock_boulder',
    name: 'Bloco Granítico Erodido (Weathered Boulder)',
    category: 'Rock Variety',
    biome: 'ALL_BIOMES / PLAINS / FORESTS',
    height: '1.2m (Bloco Maciço)',
    desc: 'Bloco granítico arredondado com erosão natural, base assentada firmemente no solo e pátina de líquen dourado/esverdeado no topo.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.rockBoulder, matRock);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  rock_slate: {
    id: 'rock_slate',
    name: 'Laje Angulada de Crag (Sharp Slate Crag)',
    category: 'Rock Variety',
    biome: 'ROCKY_PEAKS / VOLCANIC / CANYON',
    height: '1.3m (Laje Chanfrada)',
    desc: 'Rocha prismática estratificada com planos de clivagem facetados, quinas afiadas e veios geológicos de ardósia.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.rockSlate, matRock);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  rock_pebbles: {
    id: 'rock_pebbles',
    name: 'Cacho de Seixos Rolados de Rio (Pebble Cluster)',
    category: 'Rock Variety',
    biome: 'BEACH / RIVER_BANKS / SHALLOWS',
    height: '0.5m (Agrupamento Fluvial)',
    desc: 'Conjunto orgânico de 5 seixos polidos e arredondados pela ação da água corrente e ondas da praia, com oclusão mútua natural.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.rockPebbles, matRock);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  rock_spire: {
    id: 'rock_spire',
    name: 'Coluna Basáltica / Agulha de Rocha (Rock Spire)',
    category: 'Rock Variety',
    biome: 'VOLCANIC_FIELD / PEAKS / CLIFFS',
    height: '4.2m (Pilar Basáltico Monumental)',
    desc: 'Coluna hexagonal inspirada em basaltos vulcânicos (estilo Calçada dos Gigantes) com degraus em patamares e quinas esculpidas.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.rockSpire, matRock);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  rock_mossy: {
    id: 'rock_mossy',
    name: 'Rocha Florestal com Manto de Musgo (Mossy Rock)',
    category: 'Rock Variety',
    biome: 'TEMPERATE_FOREST / AUTUMN_FOREST',
    height: '1.4m (Pedra Aveludada)',
    desc: 'Pedra de sub-bosque florestal envolvida por espessa camada de musgo verde aveludado, assentada harmoniosamente no chão úmido.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.rockMossy, matRock);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },

  // MADEIRA CAÍDA E TOCOS (4 Formatos)
  log_hollow: {
    id: 'log_hollow',
    name: 'Tronco Oco Apodrecido (Hollow Decayed Log)',
    category: 'Timber Variety',
    biome: 'FORESTS / SHORELINE DRIFTWOOD',
    height: '0.9m x 4.8m (Madeira Decaída)',
    desc: 'Tronco caído com cavidade interna oca escavada pelo tempo, pontas estilhaçadas e ritidoma externo envelhecido com fungos.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.logHollow, matWood);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  log_rooted: {
    id: 'log_rooted',
    name: 'Tronco com Raiz Arrancada (Branching Rooted Log)',
    category: 'Timber Variety',
    biome: 'TEMPERATE_FOREST / COAST',
    height: '1.4m x 5.2m (Tronco Tombado)',
    desc: 'Tronco tombado por tempestades com cepo de raízes arrancadas expostas e forquilha de galho lateral quebrado.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.logRooted, matWood);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  log_stump: {
    id: 'log_stump',
    name: 'Toco de Árvore Enraizado com Anéis (Mossy Tree Stump)',
    category: 'Timber Variety',
    biome: 'FORESTS / CLEARINGS',
    height: '1.2m (Toco Ancestral)',
    desc: 'Toco de árvore centenário enraizado firmemente na terra, com anéis de crescimento visíveis no platô do corte e cogumelo orelha-de-pau.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.logStump, matWood);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },

  // VARIANTES ARBÓREAS E SUB-BOSQUE
  broad_oak: {
    id: 'broad_oak',
    name: 'Carvalho de Copa Ampla e Assimétrica (Broad Oak)',
    category: 'Tree Variant',
    biome: 'TEMPERATE_FOREST',
    height: '9.5m (Copa Espalhada 7m)',
    desc: 'Variante antiga do carvalho temperado com tronco espesso bifurcado em ramo lateral massivo, proporcionando silhueta pictórica orgânica.',
    createMesh: () => createPairGroup(VegetationGeometries.broadOakTrunk, VegetationGeometries.broadOakLeaves, matTrunk, matOakLeaves)
  },
  twin_birch: {
    id: 'twin_birch',
    name: 'Bétula de Tronco Duplo (Twin-Stem Birch)',
    category: 'Tree Variant',
    biome: 'TEMPERATE_FOREST / PLAINS',
    height: '10.5m (Clube de 2 Fustes)',
    desc: 'Espécime clássico de floresta temperada onde dois troncos esguios de ritidoma branco brotam do mesmo nó de raiz inclinando-se graciosamente.',
    createMesh: () => createPairGroup(VegetationGeometries.twinBirchTrunk, VegetationGeometries.twinBirchLeaves, matBirchTrunk, matBirchLeaves)
  },
  forest_fern: {
    id: 'forest_fern',
    name: 'Samambaia de Sub-bosque (Forest Fern)',
    category: 'Ground Flora',
    biome: 'TEMPERATE_FOREST / MANGROVE',
    height: '0.7m (Roseta de 7 Frondes)',
    desc: 'Roseta clássica de frondes de samambaia arqueadas em taça com recorte estilizado de folíolos em verde esmeralda luminoso.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.groundFern, matFlora);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  wildflowers: {
    id: 'wildflowers',
    name: 'Cacho de Flores Silvestres Campestres (Wildflowers)',
    category: 'Ground Flora',
    biome: 'PLAINS / MEADOWS / CLEARINGS',
    height: '0.5m (Canteiro Campestre)',
    desc: 'Conjunto delicado de flores silvestres com hastes delgadas e corolas vibrantes em amarelo ouro, carmesim e azul campestre.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.wildflowers, matFlora);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  },
  reeds: {
    id: 'reeds',
    name: 'Juncos Aquáticos Costeiros (Wetland Reeds)',
    category: 'Ground Flora',
    biome: 'COASTAL_SHALLOWS / LAKES / RIVERS',
    height: '2.4m (Vegetação Palustre)',
    desc: 'Cacho de juncos e taboas altas com espigas marrons aveludadas, adornando lagoas, foz de rios e esteiros.',
    createMesh: () => {
      const mesh = new THREE.Mesh(VegetationGeometries.reeds, matFlora);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
  }
};

// Setup 3D Studio Scene
const container = document.getElementById('canvas-container')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161a20);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Lighting
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.65);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfffaed, 1.25);
dirLight.position.set(15, 30, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 80;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 20;
dirLight.shadow.camera.bottom = -20;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x90cdf4, 0.45);
fillLight.position.set(-15, 10, -10);
scene.add(fillLight);

// Pedestal Studio Floor
const floorGeo = new THREE.CylinderGeometry(14, 15, 0.8, 48);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x242d38, roughness: 0.8, metalness: 0.1 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.position.y = -0.4;
floor.receiveShadow = true;
scene.add(floor);

// Pedestal Grid Ring
const gridHelper = new THREE.PolarGridHelper(13, 8, 8, 48, 0x475569, 0x334155);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// Human Reference Silhouette (1.75m high, eye level 1.65m)
const humanGroup = new THREE.Group();
const humanMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 }); // Gold-yellow human reference
const humanBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.35, 8), humanMat);
humanBody.position.y = 0.675;
humanBody.castShadow = true;
const humanHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), humanMat);
humanHead.position.y = 1.55;
humanHead.castShadow = true;
humanGroup.add(humanBody);
humanGroup.add(humanHead);
humanGroup.position.set(-3.2, 0, 0);
scene.add(humanGroup);

// URL parameters: ?item=oak or ?pair=oak or ?all=true
const urlParams = new URLSearchParams(window.location.search);
const itemKey = urlParams.get('item');
const pairKey = urlParams.get('pair');

const currentGroup = new THREE.Group();
scene.add(currentGroup);

if (pairKey) {
  const matureKey = pairKey;
  const saplingKey = pairKey + '_sapling';
  const matureSpec = ITEMS[matureKey];
  const saplingSpec = ITEMS[saplingKey];

  if (matureSpec && saplingSpec) {
    document.getElementById('item-title')!.innerText = matureSpec.name + ' & ' + saplingSpec.name;
    document.getElementById('item-meta')!.innerHTML = 
      '<strong>Bioma:</strong> ' + matureSpec.biome + '<br>' +
      '<strong>Adulto:</strong> ' + matureSpec.height + ' | <strong>Muda:</strong> ' + saplingSpec.height;
    document.getElementById('item-desc')!.innerText = matureSpec.desc + ' | ' + saplingSpec.desc;

    const mMesh = matureSpec.createMesh();
    mMesh.position.set(1.5, 0, 0);
    currentGroup.add(mMesh);

    const sMesh = saplingSpec.createMesh();
    sMesh.position.set(-1.2, 0, 0.6);
    currentGroup.add(sMesh);

    camera.position.set(0, 7.5, 22);
    camera.lookAt(0, 5.8, 0);
  }
} else if (itemKey && ITEMS[itemKey]) {
  const spec = ITEMS[itemKey];
  document.getElementById('item-title')!.innerText = spec.name;
  document.getElementById('item-meta')!.innerHTML = 
    '<strong>Categoria:</strong> ' + spec.category + ' | <strong>Bioma:</strong> ' + spec.biome + '<br>' +
    '<strong>Altura Efetiva:</strong> ' + spec.height;
  document.getElementById('item-desc')!.innerText = spec.desc;

  const mesh = spec.createMesh();
  mesh.position.set(0.5, 0, 0);
  currentGroup.add(mesh);

  // Auto camera framing based on exact item height
  const hMatch = spec.height.match(/([0-9.]+)m/);
  const hVal = hMatch ? parseFloat(hMatch[1]) : 5.0;

  if (hVal >= 8.0) {
    // Árvores de grande porte e carvalhos com copa espalhada
    camera.position.set(0, 6.0, 23);
    camera.lookAt(0, 5.2, 0);
  } else if (hVal >= 2.5) {
    // Árvores jovens, cactos e pilares
    camera.position.set(0, 3.2, 11.5);
    camera.lookAt(0, 2.2, 0);
  } else if (hVal >= 1.0) {
    // Rochas médias, tocos e troncos caídos
    camera.position.set(0, 1.8, 6.5);
    camera.lookAt(0, 0.8, 0);
  } else {
    // Flora rasteira, samambaias, flores silvestres e seixos
    camera.position.set(0, 0.85, 3.4);
    camera.lookAt(0, 0.38, 0);
    humanGroup.position.set(-1.5, 0, 0);
  }
} else {
  // Gallery mode: display default oak pair
  const matureSpec = ITEMS.oak;
  const saplingSpec = ITEMS.oak_sapling;
  document.getElementById('item-title')!.innerText = 'Galeria Botânica do Procedural Island Explorer';
  document.getElementById('item-meta')!.innerText = 'Parâmetro ?item=<chave> ou ?pair=<chave> para inspeção detalhada.';
  document.getElementById('item-desc')!.innerText = 'Selecione qualquer item da vegetação para avaliação botânica individual.';
  const mMesh = matureSpec.createMesh();
  mMesh.position.set(1.5, 0, 0);
  currentGroup.add(mMesh);
  const sMesh = saplingSpec.createMesh();
  sMesh.position.set(-1.2, 0, 0.6);
  currentGroup.add(sMesh);
  camera.position.set(0, 6.5, 18);
  camera.lookAt(0, 5.0, 0);
}

// Orbit/Rotate animation
let angle = 0;
function animate() {
  requestAnimationFrame(animate);
  // Gentle turntable rotation if specified
  if (urlParams.get('rotate') === 'true') {
    angle += 0.005;
    currentGroup.rotation.y = angle;
  }
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
