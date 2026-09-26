import * as THREE from 'three';
import { VegetationManager, VegetationGeometries } from '../generation/vegetation/vegetationManager.ts';

/**
 * Galeria de todos os elementos de vegetação/props do jogo: cada um é renderizado isolado com a
 * mesma geometria, material e cor (tint) que o VegetationManager usa no mundo.
 * Abrir em http://localhost:5173/gallery.html
 */

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; tint: number };
interface Item { id: string; name: string; where: string; parts: Part[] }
interface Group { title: string; items: Item[] }

const vm = new VegetationManager();
const M = vm as any;
const G = VegetationGeometries;

const tree = (trunk: THREE.BufferGeometry, leaves: THREE.BufferGeometry, trunkMat: THREE.Material, leafMat: THREE.Material, trunkTint: number, leafTint: number): Part[] => [
  { geo: trunk, mat: trunkMat, tint: trunkTint },
  { geo: leaves, mat: leafMat, tint: leafTint },
];
const single = (geo: THREE.BufferGeometry, mat: THREE.Material, tint: number): Part[] => [{ geo, mat, tint }];

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
  const meshes = item.parts.map((p) => {
    const m = new THREE.InstancedMesh(p.geo, p.mat, 1);
    m.setMatrixAt(0, new THREE.Matrix4());
    m.setColorAt(0, new THREE.Color(p.tint));
    m.frustumCulled = false;
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
let total = 0;
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
