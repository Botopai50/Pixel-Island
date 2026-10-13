import * as THREE from 'three';
import { VegetationManager, VegetationGeometries } from '../generation/vegetation/vegetationManager.ts';
import { ORE_BY_BIOME, ORE_LABEL, ORE_RARITY } from '../generation/vegetation/pixelTrees/oreAssign.ts';
import { getGameTrees, ROCK_BIOME_KEYS, type GameTreeKind } from '../generation/vegetation/pixelTrees/gameTrees.ts';
import { enableAssetEnvironment } from '../generation/vegetation/pixelTrees/services/assetEnvironment';
import { AERIAL } from '../atmosphere/atmosphericFog.ts';
import { FADE } from '../generation/shaders/fadeDither.ts';
import { VegetationTextures } from '../generation/vegetation/vegetationTextures.ts';

/**
 * Galeria de todos os elementos de vegetação/props do jogo: cada um é renderizado isolado com a
 * mesma geometria, material e cor (tint) que o VegetationManager usa no mundo.
 * Abrir em http://localhost:5173/gallery.html
 */

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; tint: number };
/** isNew: item adicionado recentemente (ganha a faixa NOVO); news: o que há de novo nele; image: imagem pronta (sem 3D) */
interface Item { id: string; name: string; where: string; parts: Part[]; isNew?: boolean; news?: string; image?: string }
interface Group { title: string; items: Item[] }

const vm = new VegetationManager();
const M = vm as any;
const G = VegetationGeometries;

const tree = (trunk: THREE.BufferGeometry, leaves: THREE.BufferGeometry, trunkMat: THREE.Material, leafMat: THREE.Material, trunkTint: number, leafTint: number): Part[] => [
  { geo: trunk, mat: trunkMat, tint: trunkTint },
  { geo: leaves, mat: leafMat, tint: leafTint },
];
const single = (geo: THREE.BufferGeometry, mat: THREE.Material, tint: number): Part[] => [{ geo, mat, tint }];

/** As árvores do Pixel_Tree que entraram no jogo (a variação 0, no nível de detalhe de perto). */
const PT: { kind: GameTreeKind; name: string; where: string; news: string }[] = [
  { kind: 'oak', name: 'Carvalho (Pixel_Tree)', where: 'Florestas e prados temperados', news: 'Substitui o carvalho antigo; folhas e casca em pixel art. NOVO: maçãs na copa e cogumelos no pé do tronco.' },
  { kind: 'pine', name: 'Pinheiro (Pixel_Tree)', where: 'Florestas de coníferas e encostas', news: 'Substitui o pinheiro antigo.' },
  { kind: 'birch', name: 'Bétula (Pixel_Tree)', where: 'Florestas temperadas', news: 'Substitui a bétula antiga. NOVO: maçãs, cogumelos no chão e cogumelos de tronco.' },
  { kind: 'acacia', name: 'Acácia (Pixel_Tree)', where: 'Savana', news: 'Substitui a acácia antiga (que saiu do deserto).' },
  { kind: 'palm', name: 'Palmeira (Pixel_Tree)', where: 'Praias e costa tropical', news: 'Substitui a palmeira antiga.' },
  { kind: 'mangrove', name: 'Mangue (Pixel_Tree)', where: 'Manguezal, em terra e na água rasa', news: 'Árvore nova, com raízes aéreas e altura variável.' },
  { kind: 'snowPine', name: 'Pinheiro nevado (Pixel_Tree)', where: 'Tundra e neve', news: 'Substitui o pinheiro nevado antigo.' },
  { kind: 'willow', name: 'Salgueiro ártico (Pixel_Tree)', where: 'Tundra', news: 'Substitui o salgueiro antigo.' },
  { kind: 'mapleRed', name: 'Bordo vermelho (Pixel_Tree)', where: 'Floresta de outono', news: 'Substitui o bordo antigo.' },
  { kind: 'mapleOrange', name: 'Bordo laranja (Pixel_Tree)', where: 'Floresta de outono', news: 'Substitui o bordo antigo.' },
  { kind: 'mapleYellow', name: 'Bordo amarelo (Pixel_Tree)', where: 'Floresta de outono', news: 'Substitui o bordo antigo.' },
  { kind: 'dead', name: 'Árvore seca (Pixel_Tree)', where: 'Deserto e campos vulcânicos', news: 'Árvore morta de verdade (antes era um toco); agora também no deserto.' },
  { kind: 'cactus', name: 'Cacto alto (Pixel_Tree)', where: 'Deserto', news: 'Substitui o saguaro antigo, com 60% da altura dele.' },
  { kind: 'sakura', name: 'Cerejeira (Pixel_Tree)', where: 'Bosques e árvores soltas em biomas temperados', news: 'Espécie nova: cerejeira de flores rosas.' },
  { kind: 'korok', name: 'Árvore ancestral (Pixel_Tree)', where: 'Bosques e árvores soltas em florestas', news: 'Espécie nova: árvore ancestral.' },
];
const SHRUBS: { kind: GameTreeKind; name: string; where: string; news: string }[] = [
  { kind: 'shrubHyrule', name: 'Arbusto de Hyrule', where: 'Florestas e prados temperados', news: 'Arbusto redondo e verde-vivo do Pixel_Tree.' },
  { kind: 'shrubBerry', name: 'Arbusto de frutinhas', where: 'Biomas temperados e de outono', news: 'Com frutinhas, no lugar do arbusto frutífero antigo.' },
  { kind: 'shrubFlower', name: 'Arbusto florido', where: 'Prados, selva e bosques', news: 'Arbusto novo, cheio de flores.' },
  { kind: 'shrubDesert', name: 'Arbusto do deserto', where: 'Deserto e cânions', news: 'Arbusto seco e espinhoso, só do deserto.' },
  { kind: 'shrubSakura', name: 'Arbusto de cerejeira', where: 'Bosque de cerejeiras', news: 'Arbusto de flores rosa do bosque de cerejeiras.' },
  { kind: 'shrubBirch', name: 'Arbusto de bétula', where: 'Bosque outonal', news: 'Arbusto de folhas outonais.' },
  { kind: 'shrubPine', name: 'Arbusto de conífera', where: 'Taiga, tundra e montanhas', news: 'Arbusto baixo e escuro de climas frios.' },
  { kind: 'shrubSnow', name: 'Arbusto nevado', where: 'Neve e gelo', news: 'Arbusto coberto de neve.' },
  { kind: 'shrubPalm', name: 'Arbusto tropical', where: 'Selva tropical', news: 'Arbusto de folhas largas e tropicais.' },
  { kind: 'shrubKorok', name: 'Arbusto ancestral', where: 'Florestas temperadas (raro)', news: 'Arbusto do mesmo estilo da árvore ancestral.' },
  { kind: 'shrubSwamp', name: 'Arbusto de pântano', where: 'Manguezal', news: 'Arbusto escuro e úmido do manguezal.' },
  { kind: 'shrubSavanna', name: 'Arbusto de savana', where: 'Savana', news: 'Arbusto seco e dourado da savana.' },
  { kind: 'shrubWithered', name: 'Arbusto seco calcinado', where: 'Campos vulcânicos e deserto', news: 'Arbusto de gravetos secos. NOVO: também no deserto, junto do arbusto verde.' },
];
const SAPLINGS: { kind: GameTreeKind; name: string; where: string }[] = [
  { kind: 'oakSapling', name: 'Muda de carvalho', where: 'Florestas e prados temperados' },
  { kind: 'pineSapling', name: 'Muda de pinheiro', where: 'Florestas de coníferas' },
  { kind: 'birchSapling', name: 'Muda de bétula', where: 'Florestas temperadas' },
  { kind: 'palmSapling', name: 'Muda de palmeira', where: 'Praias e costa tropical' },
  { kind: 'acaciaSapling', name: 'Muda de acácia', where: 'Savana' },
  { kind: 'mangroveSapling', name: 'Muda de mangue', where: 'Manguezal' },
  { kind: 'cactusSapling', name: 'Muda de cacto', where: 'Deserto' },
  { kind: 'sakuraSapling', name: 'Muda de cerejeira', where: 'Bosque de cerejeiras' },
  { kind: 'korokSapling', name: 'Muda de árvore ancestral', where: 'Florestas (junto das árvores ancestrais)' },
  { kind: 'deadSapling', name: 'Muda de árvore seca', where: 'Deserto' },
  { kind: 'snowPineSapling', name: 'Muda de pinheiro nevado', where: 'Neve e tundra' },
];
const saplingItemsCat = (): Item[] => SAPLINGS.map((t) => ({
  id: 'sp_' + t.kind, name: t.name + ' (Pixel_Tree)', where: t.where, isNew: true, news: 'Muda nova do Pixel_Tree, no lugar da muda antiga.',
  parts: getGameTrees(t.kind)[0].lods[0].parts.map((p) => ({ geo: p.geometry, mat: p.material, tint: 0xffffff })),
}));
const RASTEIRAS: { kind: GameTreeKind; name: string; where: string }[] = [
  { kind: 'fernPlant', name: 'Samambaia', where: 'Chão das florestas e do manguezal' },
  { kind: 'reedClump', name: 'Juncos', where: 'Margens de água e manguezal' },
  { kind: 'flowers_hyrule', name: 'Margaridas', where: 'Prados e florestas temperadas' },
  { kind: 'flowers_satori', name: 'Prímulas', where: 'Bosque de cerejeiras' },
  { kind: 'flowers_akkala', name: 'Papoulas', where: 'Bosque outonal' },
  { kind: 'flowers_hebra', name: 'Espigas alpinas', where: 'Taiga e montanhas' },
  { kind: 'flowers_hebra_snowy', name: 'Açafrão da neve', where: 'Neve e gelo' },
  { kind: 'flowers_faron', name: 'Hibiscos', where: 'Selva tropical' },
  { kind: 'flowers_korok', name: 'Campânulas', where: 'Florestas ancestrais' },
  { kind: 'flowers_swamp', name: 'Íris', where: 'Manguezal' },
  { kind: 'flowers_gerudo', name: 'Flor do deserto', where: 'Deserto' },
  { kind: 'flowers_savanna', name: 'Áster', where: 'Savana' },
  { kind: 'flowers_withered', name: 'Umbela seca', where: 'Campos vulcânicos' },
  { kind: 'flowers_tundra', name: 'Saxífraga', where: 'Tundra alpina' },
];
const rasteiraItemsCat = (): Item[] => RASTEIRAS.map((t) => ({
  id: 'ra_' + t.kind, name: t.name + ' (Pixel_Tree)', where: t.where, isNew: true, news: 'Planta rasteira nova do Pixel_Tree, no lugar da antiga.',
  parts: getGameTrees(t.kind)[0].lods[0].parts.map((p) => ({ geo: p.geometry, mat: p.material, tint: 0xffffff })),
}));
const TRONCOS: { kind: GameTreeKind; name: string; where: string; news: string }[] = [
  { kind: 'logFallen', name: 'Tronco caído', where: 'Florestas e manguezal (meio afundado na água)', news: 'Tronco novo do Pixel_Tree, no lugar do antigo.' },
  { kind: 'logHollow', name: 'Tronco oco', where: 'Florestas e margens', news: 'Tronco novo do Pixel_Tree: oco, com musgo e cogumelos.' },
  { kind: 'logRooted', name: 'Tronco com raízes', where: 'Florestas e margens', news: 'Tronco novo do Pixel_Tree: arrancado, com o bloco de raízes e terra.' },
  { kind: 'logStump', name: 'Toco', where: 'Florestas', news: 'Toco novo do Pixel_Tree, com os anéis do corte.' },
];
const troncoItemsCat = (): Item[] => TRONCOS.map((t) => ({
  id: 'tr_' + t.kind, name: t.name + ' (Pixel_Tree)', where: t.where, isNew: true, news: t.news,
  parts: getGameTrees(t.kind)[0].lods[0].parts.map((p) => ({ geo: p.geometry, mat: p.material, tint: 0xffffff })),
}));
// [nome curto (o bioma principal), onde nasce]: os nomes são os dos biomas do jogo (os do painel de biomas, tecla B)
const ROCK_WHERE: Record<string, [string, string]> = {
  hyrule: ['Floresta temperada', 'Floresta temperada e Campos costeiros'],
  satori: ['Bosque de cerejeiras', 'Bosque de cerejeiras'],
  akkala: ['Bosque outonal', 'Bosque outonal'],
  hebra: ['Taiga', 'Taiga e Penhascos'],
  hebra_snowy: ['Cumes nevados', 'Cumes nevados e Planície de gelo'],
  faron: ['Selva tropical', 'Selva tropical'],
  korok: ['Bosque ancestral', 'Bosque ancestral (dentro da floresta temperada)'],
  swamp: ['Manguezal', 'Manguezal'],
  gerudo: ['Deserto', 'Deserto e dunas e Cânions'],
  savanna: ['Savana', 'Savana'],
  withered: ['Terras secas', 'Campo vulcânico, Caldeira vulcânica, Fontes termais, praias e chão seco'],
  tundra: ['Tundra alpina', 'Tundra alpina'],
};
const pedraItemsCat = (): Item[] => ROCK_BIOME_KEYS.flatMap((b) => {
  const [nm, where] = ROCK_WHERE[b];
  return (['rock', 'gravel'] as const).map((p) => {
    const kind = (p + '_' + b) as GameTreeKind;
    return {
      id: 'pd_' + kind, name: (p === 'rock' ? 'Pedra – ' : 'Pedrinhas – ') + nm + ' (Pixel_Tree)', where, isNew: true,
      news: p === 'rock' ? 'Pedra nova do Pixel_Tree, no estilo do bioma (em três tamanhos).' : 'Pedrinhas e cascalho novos do Pixel_Tree.',
      parts: getGameTrees(kind)[getGameTrees(kind).length - 1].lods[0].parts.map((q) => ({ geo: q.geometry, mat: q.material, tint: 0xffffff })),
    } as Item;
  });
});
// um item para cada minério: a pedra vem do primeiro bioma onde ele aparece (nos outros, é a pedra do bioma com o mesmo minério)
const minerioItemsCat = (): Item[] => {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const b of ROCK_BIOME_KEYS) {
    for (const o of ORE_BY_BIOME[b]) {
      if (seen.has(o)) continue;
      seen.add(o);
      const kind = ('ore_' + b + '_' + o) as GameTreeKind;
      const list = getGameTrees(kind);
      const where = ORE_BY_BIOME_PLACES(o);
      out.push({
        id: 'mi_' + kind, name: 'Pedra com ' + ORE_LABEL[o] + ' (Pixel_Tree)', where, isNew: true,
        news: 'Pedra nova do Pixel_Tree com veios de ' + ORE_LABEL[o] + '. Raridade: ' + ORE_RARITY[o] + '.',
        parts: list[list.length - 1].lods[0].parts.map((q) => ({ geo: q.geometry, mat: q.material, tint: 0xffffff })),
      } as Item);
    }
  }
  return out;
};
const ORE_BY_BIOME_PLACES = (o: string): string => ROCK_BIOME_KEYS.filter((b) => (ORE_BY_BIOME[b] as string[]).includes(o)).map((b) => ROCK_WHERE[b][1]).join('; ');
// folhas secas: onde caem (os biomas onde o planejador as espalha)
const FOLHAS_ONDE: Record<string, string> = {
  hyrule: 'Floresta temperada', satori: 'Bosque de cerejeiras (no lugar do tapete de pétalas)', akkala: 'Bosque outonal (bastante)',
  hebra: 'Taiga', faron: 'Selva tropical', korok: 'Bosque ancestral', savanna: 'Savana',
};
const folhaItemsCat = (): Item[] => Object.keys(FOLHAS_ONDE).map((b) => {
  const kind = ('leaves_' + b) as GameTreeKind;
  const list = getGameTrees(kind);
  return {
    id: 'fo_' + kind, name: 'Folhas secas – ' + ROCK_WHERE[b][0] + ' (Pixel_Tree)', where: FOLHAS_ONDE[b], isNew: true,
    news: b === 'satori' ? 'Folhas secas novas do Pixel_Tree: substituem os tapetes de pétalas do bosque.' : 'Folhas secas caídas, novas do Pixel_Tree.',
    parts: list[0].lods[0].parts.map((q) => ({ geo: q.geometry, mat: q.material, tint: 0xffffff })),
  } as Item;
});
const shrubItemsCat = (): Item[] => SHRUBS.map((t) => ({
  id: 'sh_' + t.kind, name: t.name + ' (Pixel_Tree)', where: t.where, isNew: true, news: t.news,
  parts: getGameTrees(t.kind)[0].lods[0].parts.map((p) => ({ geo: p.geometry, mat: p.material, tint: 0xffffff })),
}));

const ptItems = (): Item[] => PT.map((t) => ({
  id: 'pt_' + t.kind, name: t.name, where: t.where, isNew: true, news: t.news,
  parts: getGameTrees(t.kind)[0].lods[0].parts.map((p) => ({ geo: p.geometry, mat: p.material, tint: 0xffffff })),
}));

/** O capim de brejo do manguezal: os sprites 2D que viram os tufos 3D */
const marshItems = (): Item[] => VegetationTextures.getGrassVariantTextures('marsh').map((tex, i) => {
  const src = tex.image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = c.height = 320;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e8eef4'; x.fillRect(0, 0, 320, 320);
  x.imageSmoothingEnabled = false;
  const k = Math.min(300 / src.width, 300 / src.height);
  x.drawImage(src, 160 - (src.width * k) / 2, 160 - (src.height * k) / 2, src.width * k, src.height * k);
  return { id: 'marshGrass' + i, name: 'Capim de brejo ' + (i + 1), where: 'Manguezal', parts: [], isNew: true,
    news: 'Capim próprio do manguezal (spartina): lâminas altas e arqueadas, oliva-amarelado.', image: c.toDataURL('image/png') };
});

const groups: Group[] = [
  {
    title: 'Árvores',
    items: [
      { id: 'oak', name: 'Carvalho', where: 'Florestas e prados temperados', parts: tree(G.oakTrunk, G.oakLeaves, M.trunkMaterial, M.foliageMaterial, 0x5c422d, 0x48aa32) },
      { id: 'broadOak', name: 'Carvalho de copa larga', where: 'Florestas temperadas (variante)', parts: tree(G.broadOakTrunk, G.broadOakLeaves, M.trunkMaterial, M.foliageMaterial, 0x563e2a, 0x429c2c) },
      { id: 'oakSapling', name: 'Muda de carvalho', where: 'Florestas temperadas', parts: tree(G.oakSaplingTrunk, G.oakSaplingLeaves, M.trunkMaterial, M.foliageMaterial, 0x72573e, 0x68c434) },
      { id: 'pine', name: 'Pinheiro', where: 'Florestas de coníferas e encostas', parts: tree(G.pineTrunk, G.pineLeaves, M.trunkMaterial, M.foliageMaterial, 0x4a3424, 0x2a7238) },
      { id: 'pineSapling', name: 'Muda de pinheiro', where: 'Florestas de coníferas', parts: tree(G.pineSaplingTrunk, G.pineSaplingLeaves, M.trunkMaterial, M.foliageMaterial, 0x563e2c, 0x388248) },
      { id: 'birch', name: 'Bétula', where: 'Florestas temperadas', parts: tree(G.birchTrunk, G.birchLeaves, M.birchTrunkMaterial, M.foliageMaterial, 0xeeeee8, 0x6ec430) },
      { id: 'twinBirch', name: 'Bétula de tronco duplo', where: 'Florestas temperadas (variante)', parts: tree(G.twinBirchTrunk, G.twinBirchLeaves, M.birchTrunkMaterial, M.foliageMaterial, 0xf0f0ea, 0x6ec430) },
      { id: 'birchSapling', name: 'Muda de bétula', where: 'Florestas temperadas', parts: tree(G.birchSaplingTrunk, G.birchSaplingLeaves, M.birchTrunkMaterial, M.foliageMaterial, 0xf4f4f0, 0x7ed638) },
      { id: 'palm', name: 'Palmeira', where: 'Praias e costa tropical', parts: tree(G.palmTrunk, G.palmLeaves, M.palmTrunkMaterial, M.palmFrondMaterial, 0xa68252, 0x4cb828) },
      { id: 'palmSapling', name: 'Muda de palmeira', where: 'Praias', parts: tree(G.palmSaplingTrunk, G.palmSaplingLeaves, M.palmTrunkMaterial, M.palmFrondMaterial, 0x8a633a, 0x76c22c) },
      { id: 'acacia', name: 'Acácia', where: 'Savana', parts: tree(G.acaciaTrunk, G.acaciaLeaves, M.trunkMaterial, M.foliageMaterial, 0x4c3826, 0x6e9c2e) },
      { id: 'acaciaSapling', name: 'Muda de acácia', where: 'Savana', parts: tree(G.acaciaSaplingTrunk, G.acaciaSaplingLeaves, M.trunkMaterial, M.foliageMaterial, 0x604a36, 0x78ab32) },
      { id: 'mapleRed', name: 'Bordo outonal (vermelho)', where: 'Floresta de outono', parts: tree(G.mapleTrunk, G.mapleLeaves, M.trunkMaterial, M.foliageMaterial, 0x4c3828, 0xd44022) },
      { id: 'mapleOrange', name: 'Bordo outonal (laranja)', where: 'Floresta de outono', parts: tree(G.mapleTrunk, G.mapleLeaves, M.trunkMaterial, M.foliageMaterial, 0x4c3828, 0xe87a1a) },
      { id: 'mapleYellow', name: 'Bordo outonal (amarelo)', where: 'Floresta de outono', parts: tree(G.mapleTrunk, G.mapleLeaves, M.trunkMaterial, M.foliageMaterial, 0x4c3828, 0xe8b824) },
      { id: 'mangrove', name: 'Mangue', where: 'Manguezal (costa quente e úmida)', parts: tree(G.mangroveTrunk, G.mangroveLeaves, M.trunkMaterial, M.foliageMaterial, 0x3e2d1f, 0x348c2c) },
      { id: 'mangroveSapling', name: 'Muda de mangue', where: 'Manguezal', parts: tree(G.mangroveSaplingTrunk, G.mangroveSaplingLeaves, M.trunkMaterial, M.foliageMaterial, 0x483626, 0x3e9834) },
      { id: 'snowPine', name: 'Pinheiro nevado', where: 'Tundra e neve', parts: tree(G.snowPineTrunk, G.snowPineLeaves, M.trunkMaterial, M.snowPineFoliageMaterial, 0x3c2c22, 0xffffff) },
      { id: 'arcticWillow', name: 'Salgueiro-anão ártico', where: 'Tundra', parts: tree(G.arcticWillowTrunk, G.arcticWillowLeaves, M.trunkMaterial, M.foliageMaterial, 0x44362a, 0x72927c) },
      { id: 'deadTrunk', name: 'Árvore morta calcinada', where: 'Campos vulcânicos', parts: single(G.deadTrunk, M.deadTreeMaterial, 0x22201e) },
    ],
  },
  {
    title: 'Novidades: manguezal',
    items: [
      { id: 'lilyPads', name: 'Vitória-régia', where: 'Água rasa do manguezal', isNew: true, news: 'Folhas redondas com flores rosas, na superfície.', parts: single(G.lilyPads, M.swampMaterial, 0xffffff) },
      { id: 'duckweed', name: "Lentilha-d'água", where: 'Água rasa do manguezal', isNew: true, news: 'Tapete verde de retalhos na superfície da água.', parts: single(G.duckweed, M.swampMaterial, 0xffffff) },
    ],
  },
  {
    title: 'Novidades: bosque de cerejeiras',
    items: [
      { id: 'stoneLantern', name: 'Lanterna de pedra', where: 'Bosque de cerejeiras', isNew: true, news: 'Lanterna japonesa (tōrō) de pedra, rara, com abertura acesa.', parts: single(G.stoneLantern, M.swampMaterial, 0xffffff) },
      { id: 'pinkFlowers', name: 'Flores cor-de-rosa', where: 'Bosque de cerejeiras', isNew: true, news: 'As flores silvestres em tom rosa, só nesse bioma.', parts: single(G.wildflowers, M.groundFloraMaterial, 0xf6a6c8) },
    ],
  },
  {
    title: 'Cactos e arbustos',
    items: [
      { id: 'cactus', name: 'Cacto saguaro', where: 'Deserto', parts: single(G.cactusBody, M.cactusMaterial, 0x4e8e42) },
      { id: 'cactusSapling', name: 'Cacto jovem', where: 'Deserto', parts: single(G.cactusSaplingBody, M.cactusMaterial, 0x5ca850) },
      { id: 'shrubLush', name: 'Arbusto folhoso', where: 'Quase todos os biomas com vegetação', parts: single(G.shrubLush, M.shrubMaterial, 0x4e9c2c) },
      { id: 'shrubArctic', name: 'Arbusto ártico', where: 'Tundra e áreas com gelo', parts: single(G.shrubLush, M.shrubMaterial, 0x94b4a2) },
      { id: 'shrubBerry', name: 'Arbusto frutífero', where: 'Biomas temperados', parts: single(G.shrubBerry, M.shrubMaterial, 0xffffff) },
    ],
  },
  {
    title: 'Pedras',
    items: [
      { id: 'rockBoulder', name: 'Rocha arredondada', where: 'Em quase todo lugar', parts: single(G.rockBoulder, M.rockMaterial, 0x8a8e92) },
      { id: 'rockPebbles', name: 'Pedregulhos', where: 'Campos, praias e florestas', parts: single(G.rockPebbles, M.rockMaterial, 0x8a8e92) },
      { id: 'rockSlate', name: 'Laje de ardósia', where: 'Picos, vulcões, cânions e campos', parts: single(G.rockSlate, M.rockMaterial, 0x8a8e92) },
      { id: 'rockSpire', name: 'Agulha de pedra', where: 'Picos rochosos, vulcões e cânions', parts: single(G.rockSpire, M.rockMaterial, 0x8a8e92) },
      { id: 'rockMossy', name: 'Rocha com musgo', where: 'Florestas temperadas e de outono', parts: single(G.rockMossy, M.rockMaterial, 0x8a8e92) },
      { id: 'rockArctic', name: 'Rocha ártica', where: 'Tundra (mesmas formas, tom azulado)', parts: single(G.rockBoulder, M.rockMaterial, 0xa8c2cf) },
      { id: 'rockShore', name: 'Rocha de praia', where: 'Beira-mar e costões', parts: single(G.rockBoulder, M.rockMaterial, 0x6e747c) },
      { id: 'rockRiver', name: 'Seixo de rio', where: 'Margens de rios e lagos', parts: single(G.rockPebbles, M.rockMaterial, 0x756e5e) },
    ],
  },
  {
    title: 'Troncos e madeira',
    items: [
      { id: 'fallenLog', name: 'Tronco caído', where: 'Florestas', parts: single(G.fallenLog, M.logMaterial, 0x6a5442) },
      { id: 'logHollow', name: 'Tronco oco', where: 'Florestas e margens', parts: single(G.logHollow, M.logMaterial, 0x6a5442) },
      { id: 'logRooted', name: 'Tronco com raízes', where: 'Florestas e margens', parts: single(G.logRooted, M.logMaterial, 0x6a5442) },
      { id: 'logStump', name: 'Toco', where: 'Florestas', parts: single(G.logStump, M.logMaterial, 0x6a5442) },
    ],
  },
  {
    title: 'Plantas rasteiras',
    items: [
      { id: 'groundFern', name: 'Samambaia', where: 'Chão das florestas', parts: single(G.groundFern, M.groundFloraMaterial, 0x42b828) },
      { id: 'wildflowers', name: 'Flores silvestres', where: 'Prados', parts: single(G.wildflowers, M.groundFloraMaterial, 0xffffff) },
      { id: 'reeds', name: 'Juncos', where: 'Margens de água', parts: single(G.reeds, M.groundFloraMaterial, 0x448a32) },
    ],
  },
];

/* ---- Renderização ---- */
const SIZE = 320;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Mesma luz do jogo ao meio-dia (skyAtmosphere: sol 2.0, hemisférica 0.50, ambiente 0.28)
const scene = new THREE.Scene();
const sun = new THREE.DirectionalLight(0xfff9ed, 2.0);
sun.position.set(0.6, 1.0, 0.8);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x6aa8ea, 0x94b8e0, 0.50));
scene.add(new THREE.AmbientLight(0x94b8e0, 0.28));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x7cb85a })
);
scene.add(ground);

const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 500);
const box = new THREE.Box3();
const sphere = new THREE.Sphere();

function render(item: Item): string {
  if (item.image) return item.image;
  const meshes = item.parts.map((p) => {
    const m = new THREE.InstancedMesh(p.geo, p.mat, 1);
    m.setMatrixAt(0, new THREE.Matrix4());
    m.setColorAt(0, new THREE.Color(p.tint));
    m.frustumCulled = false;
    // árvores do Pixel_Tree: o shader de pixel art ganha luz e névoa como no jogo
    if (p.mat.userData.pixelTree) {
      enableAssetEnvironment(m);
      Object.assign((p.mat as THREE.ShaderMaterial).uniforms, AERIAL);
    }
    scene.add(m);
    return m;
  });

  box.makeEmpty();
  for (const p of item.parts) {
    if (!p.geo.boundingBox) p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox!);
  }
  box.getBoundingSphere(sphere);
  const r = Math.max(sphere.radius, 0.2);
  ground.scale.setScalar(r * 1.3);
  ground.position.set(sphere.center.x, box.min.y + 0.001, sphere.center.z);

  const dist = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
  const dir = new THREE.Vector3(1.0, 0.62, 1.25).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = dist / 50;
  camera.far = dist * 4;
  camera.updateProjectionMatrix();
  camera.lookAt(sphere.center);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  for (const m of meshes) {
    scene.remove(m);
    m.dispose();
  }
  return url;
}

/* ---- Página ---- */
const root = document.getElementById('gallery')!;
let total = 0, totalNew = 0;
FADE.uTreeSwap.value.set(1e9, 1e9 + 1);   // sem o sumiço por distância das árvores do jogo
groups.unshift({ title: 'Novidades: árvores do Pixel_Tree', items: ptItems() });
groups.splice(1, 0, { title: 'Novidades: arbustos do Pixel_Tree', items: shrubItemsCat() });
groups.splice(2, 0, { title: 'Novidades: mudas do Pixel_Tree', items: saplingItemsCat() });
groups.splice(3, 0, { title: 'Novidades: plantas rasteiras do Pixel_Tree', items: rasteiraItemsCat() });
groups.splice(4, 0, { title: 'Novidades: troncos e tocos do Pixel_Tree', items: troncoItemsCat() });
groups.splice(5, 0, { title: 'Novidades: pedras do Pixel_Tree', items: pedraItemsCat() });
groups.splice(6, 0, { title: 'Novidades: pedras com minérios do Pixel_Tree', items: minerioItemsCat() });
groups.splice(7, 0, { title: 'Novidades: folhas secas do Pixel_Tree', items: folhaItemsCat() });
groups.splice(1, 0, { title: 'Novidades: capim de brejo', items: marshItems() });
for (const group of groups) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = `${group.title} (${group.items.length})`;
  section.appendChild(h2);
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const item of group.items) {
    const card = document.createElement('figure');
    const img = document.createElement('img');
    img.src = render(item);
    img.alt = item.name;
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<strong>${item.name}</strong><span>${item.where}</span><code>${item.id}</code>`;
    if (item.isNew) {
      card.classList.add('is-new');
      const badge = document.createElement('div');
      badge.className = 'badge-new';
      badge.textContent = 'NOVO';
      card.appendChild(badge);
      if (item.news) {
        const n = document.createElement('div');
        n.className = 'news';
        n.textContent = '🆕 ' + item.news;
        cap.appendChild(n);
      }
      totalNew++;
    }
    const dl = document.createElement('a');
    dl.href = img.src;
    dl.download = `${item.id}.png`;
    dl.textContent = 'baixar PNG';
    cap.appendChild(dl);
    card.append(img, cap);
    grid.appendChild(card);
    total++;
  }
  section.appendChild(grid);
  root.appendChild(section);
}
document.getElementById('count')!.textContent = String(total);
const newEl = document.getElementById('count-new');
if (newEl) newEl.textContent = String(totalNew);
