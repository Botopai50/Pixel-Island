// @ts-nocheck
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  stoneLantern, buildStoneLanternPiece, stoneLanternGlassTexture, buildRoof, buildBeam, paintUV, StructureResources, createStructureMaterials, paintSurface,
} from './lanternCore.ts';

/**
 * Lanterna de pedra (tōrō) do pacote gerador-lanterna-de-pedra (createStoneLantern): a mesma planta, o mesmo telhado, as vigas de madeira, as quatro
 * placas luminosas e a textura de pedra pintada em pixel art. Aqui as peças de cada material são juntadas numa geometria só (pedra, madeira, placas
 * e núcleo), para o jogo desenhar a lanterna por instâncias; a luz pontual do pacote fica de fora (uma luz por lanterna não cabe), o núcleo e as
 * placas já brilham sozinhos (material sem luz, como no original).
 */

export interface LanternPart { geometry: THREE.BufferGeometry; material: THREE.Material; castShadow: boolean; name: string }

// altura da lanterna em metros (o pacote usa 3,5 m; aqui ~1,7 m, o tamanho que a lanterna já tinha no jogo); a largura segue a proporção do pacote
const HEIGHT = 1.7;
// densidade de pixels do jogo (GRASS_TEXEL_DENSITY em gameTrees.ts): 32 texels por 1,5 m
const TEXELS_PER_METRE = 32 / 1.5;

let cache: LanternPart[] | null = null;

export function getStoneLanternParts(): LanternPart[] {
  if (cache) return cache;
  const seed = 7039;
  const u = HEIGHT / 3.5;
  const c = {
    type: 'stoneLantern', biome: 'hyrule',
    width: 1.9 * u, depth: 1.9 * u, height: HEIGHT, scale: 1,
    floors: 1, complexity: 0.55, roof: 'auto', roofPitch: 0.55, eaves: 0.55,
    asymmetry: 0.4, finish: 0.6, openingDensity: 0.6,
    annexes: false, balconies: false, ruin: 0,
    vegetation: 0.2, snow: 0,
    texelsPerMetre: TEXELS_PER_METRE,
    palette: { wood: '#795339', stone: '#96958b', plaster: '#d3ded8', roof: '#686e63' },
  };
  const plan = stoneLantern({ config: c, seed, streams: { streamFor: () => () => 0.5 } });
  const resources = new StructureResources();
  const materials = createStructureMaterials(c, resources, seed);
  const timber = materials.wood.clone();
  timber.name = 'SolidTimber';
  timber.onBeforeCompile = materials.wood.onBeforeCompile;
  timber.customProgramCacheKey = materials.wood.customProgramCacheKey;
  timber.map = paintSurface('wood', c.palette.wood, c.texelsPerMetre, seed, c.finish, true);
  const glassMap = stoneLanternGlassTexture();
  const glass = new THREE.MeshBasicMaterial({ map: glassMap, side: THREE.DoubleSide, transparent: true, opacity: 0.88, depthWrite: false, toneMapped: false, fog: true });
  const core = new THREE.MeshBasicMaterial({ color: '#fff1ae', toneMapped: false, fog: true });

  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const attach = (geometry: THREE.BufferGeometry, material: THREE.Material, grain?: THREE.Vector3) => {
    const painted = paintUV(geometry, grain) as THREE.BufferGeometry;
    // só o que as quatro matérias usam (posição, normal e uv): peças com atributos a mais não se juntam
    for (const name of Object.keys(painted.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') painted.deleteAttribute(name);
    let list = byMaterial.get(material);
    if (!list) { list = []; byMaterial.set(material, list); }
    list.push(painted);
    return painted;
  };
  for (const roof of plan.roofs) attach(buildRoof(roof), materials.stone);
  for (const piece of plan.pieces) {
    let geometry: THREE.BufferGeometry | undefined = buildStoneLanternPiece(piece);
    if (!geometry) {
      if (piece.kind === 'beam') geometry = buildBeam(piece.position, piece.end, piece.size[0]);
      else { geometry = new THREE.BoxGeometry(...(piece.size as [number, number, number])); geometry.translate(...(piece.position as [number, number, number])); }
    }
    const grain = piece.kind === 'beam' ? new THREE.Vector3(...piece.end).sub(new THREE.Vector3(...piece.position)).normalize() : undefined;
    const material = piece.role === 'stone-lantern-glass' ? glass : piece.role === 'stone-lantern-light' ? core : piece.material === 'wood' ? timber : materials[piece.material];
    const painted = attach(geometry, material, grain);
    if (material === glass) {
      // a textura da placa vai de 0 a 1 em cada face
      const pos = painted.getAttribute('position'), uv = painted.getAttribute('uv');
      const alongZ = piece.size[0] < piece.size[2];
      for (let i = 0; i < uv.count; i++) uv.setXY(i,
        ((alongZ ? pos.getZ(i) - piece.position[2] : pos.getX(i) - piece.position[0]) / (alongZ ? piece.size[2] : piece.size[0])) + 0.5,
        (pos.getY(i) - piece.position[1]) / piece.size[1] + 0.5);
    }
  }
  const parts: LanternPart[] = [];
  const names = new Map<THREE.Material, string>([[materials.stone, 'stoneLantern:stone'], [timber, 'stoneLantern:wood'], [glass, 'stoneLantern:glass'], [core, 'stoneLantern:core']]);
  for (const [material, list] of byMaterial) {
    const geometry = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    parts.push({ geometry, material, castShadow: material !== glass && material !== core, name: names.get(material) ?? 'stoneLantern' });
    list.forEach((g) => g.dispose());
  }
  cache = parts;
  return parts;
}
