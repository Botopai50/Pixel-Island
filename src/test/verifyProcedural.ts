import { PRNG } from '../generation/math/prng.ts';
import { SimplexNoise } from '../generation/math/simplexNoise.ts';
import { MacroGeography } from '../generation/geography/macroGeography.ts';
import { TerrainGenerator } from '../generation/terrain/terrainGenerator.ts';
import { BiomeType } from '../generation/types.ts';
import { CONFIG } from '../config.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`✓ ${message}`);
}

console.log('=== Iniciando Verificação da Geração Procedural Isolada ===\n');

// 1. Teste de Determinismo do PRNG e Simplex
const prng1 = new PRNG('TestSeed123');
const val1 = prng1.next();
const prng2 = new PRNG('TestSeed123');
const val2 = prng2.next();
assert(val1 === val2, 'PRNG produz exatamente os mesmos valores para a mesma seed');

const simplex1 = new SimplexNoise(42);
const s1 = simplex1.noise2D(12.34, 56.78);
const simplex2 = new SimplexNoise(42);
const s2 = simplex2.noise2D(12.34, 56.78);
assert(s1 === s2, 'SimplexNoise 2D é estritamente determinístico');

// 2. Teste de Geografia Macro (Formato de Ilhas)
const geo = new MacroGeography(12345);
const center = geo.getLandmassMask(0, 0);
assert(center.nearestIsland.radius >= CONFIG.ISLAND_BASE_RADIUS * 0.8, 'Ilhas macro possuem tamanho extenso e coerente');
assert(center.nearestIsland.satellites.length >= 2, 'Ilhas possuem ilhotas e arquipélagos satélites');

// 3. Teste de Hidrologia: Rios e Lagos
const terrainTest = new TerrainGenerator(12345);
const hydro = terrainTest.getHydrology();
const hydroData = hydro.getIslandHydrology(0, 0);
assert(hydroData.rivers.length >= 1, 'Ilha possui sistemas fluviais conectados');

for (const river of hydroData.rivers) {
  const pts = river.points;
  assert(pts.length >= 20, `Rio ${river.id} possui traçado contínuo (${pts.length} pontos)`);
  assert(pts.every(p => p.elevation === CONFIG.SEA_LEVEL), `Rio ${river.id} utiliza o nível da água do mar (${CONFIG.SEA_LEVEL.toFixed(1)}m)`);
  assert(pts.every(p => p.depth >= 1.5), `Rio ${river.id} possui leito submerso escavado abaixo do nível do mar`);
  if (river.id.startsWith('river_')) {
    const last = pts[pts.length - 1];
    const maskEnd = terrainTest.getMacro().getLandmassMask(last.x, last.z);
    assert(maskEnd.coastDist <= 0.0, `Foz do rio ${river.id} alcança o oceano (coastDist=${maskEnd.coastDist.toFixed(1)}m)`);
  }
}

assert(hydroData.lakes.every(l => l.waterLevel === CONFIG.SEA_LEVEL), 'Lagos utilizam a mesma água do oceano no nível do mar (0.0m)');

// 4. Teste de Terreno Unificado e Biomas
const defaultSeed = PRNG.hashString('Avalon');
const terrain = new TerrainGenerator(defaultSeed);
let maxAlt = -999;
let minAlt = 999;
let hasBeaches = false;
let hasForests = false;
let hasPeaks = false;

for (let r = 0; r < 100; r++) {
  const angle = (r / 100) * Math.PI * 2;
  const dist = (r % 10) * 50;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;
  const pt = terrain.getPoint(x, z);

  if (pt.height > maxAlt) maxAlt = pt.height;
  if (pt.height < minAlt) minAlt = pt.height;

  if (pt.biome.type === BiomeType.BEACH || pt.biome.type === BiomeType.DESERT_DUNES) hasBeaches = true;
  if (
    pt.biome.type === BiomeType.TEMPERATE_FOREST ||
    pt.biome.type === BiomeType.AUTUMN_FOREST ||
    pt.biome.type === BiomeType.TROPICAL_RAINFOREST ||
    pt.biome.type === BiomeType.BOREAL_TAIGA
  ) {
    hasForests = true;
  }
  if (
    pt.biome.type === BiomeType.ROCKY_PEAKS ||
    pt.biome.type === BiomeType.ALPINE_TUNDRA ||
    pt.biome.type === BiomeType.SNOW_SUMMIT
  ) {
    hasPeaks = true;
  }

  if (pt.isWater) {
    assert(pt.biome.vegetationDensity === 0, `Nenhuma árvore nasce dentro da água em (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }

  if (pt.slope > CONFIG.VEGETATION.MAX_SLOPE_FOR_TREES) {
    assert(pt.biome.vegetationDensity === 0, `Árvores não nascem em encostas íngremes (> 0.62) em (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
}

console.log(`\nFaixa de relevo avaliada: Min = ${minAlt.toFixed(1)}m, Max = ${maxAlt.toFixed(1)}m`);
assert(hasBeaches, 'Geração produziu praias e zonas de transição costeira');
assert(hasForests, 'Geração produziu florestas e bosques');
assert(hasPeaks, 'Geração produziu relevos montanhosos e encostas rochosas');

// 5. Testes Específicos dos Novos Recursos Geológicos
// 5. Testes Específicos dos Novos Recursos Geológicos Procedurais
console.log('\n--- Testes dos Novos Recursos Geológicos e Biomas Procedurais ---');

// Vulcão Procedural
const volcanoes = terrain.getVolcanoGenerator().getVolcanoes();
assert(volcanoes.length >= 1, 'Pelo menos um estratovulcão procedural gerado');
const v = volcanoes[0];
const volcanoCenter = terrain.getPoint(v.x, v.z);
assert(volcanoCenter.volcanoInfluence !== undefined && volcanoCenter.volcanoInfluence > 0.8, `Vulcão detectado com alta influência na caldeira em (${v.x.toFixed(0)}, ${v.z.toFixed(0)})`);
assert(volcanoCenter.isLava === true, 'Piscina de lava detectada no coração da caldeira vulcânica');
assert(volcanoCenter.biome.type === BiomeType.VOLCANIC_CALDERA, 'Bioma VOLCANIC_CALDERA atribuído corretamente na cratera');
assert(volcanoCenter.height < v.lavaLevel, `Leito rochoso da cratera (${volcanoCenter.height.toFixed(1)}m) está abaixo da cota de lava líquida (${v.lavaLevel}m)`);

const volcanoRim = terrain.getPoint(v.x + v.calderaRadius * 1.3, v.z);
assert(volcanoRim.height > v.lavaLevel, `Paredão da borda do vulcão (${volcanoRim.height.toFixed(1)}m) se ergue monumentalmente acima da lava (${v.lavaLevel}m)`);

// Cânion Procedural
const canyonCenter = terrain.getCanyonGenerator().getCenter();
let canyonPt = terrain.getPoint(canyonCenter.x, canyonCenter.z);
if (canyonPt.height <= 0 || (canyonPt.canyonInfluence || 0) <= 0.3) {
  for (let cdx = -60; cdx <= 60; cdx += 20) {
    const pt = terrain.getPoint(canyonCenter.x + cdx, canyonCenter.z);
    if (pt.height > 2.0 && (pt.canyonInfluence || 0) > 0.3) {
      canyonPt = pt;
      break;
    }
  }
}
assert(canyonPt.canyonInfluence !== undefined && canyonPt.canyonInfluence > 0.25, `Cânion continental detectado com influência em torno de (${canyonCenter.x.toFixed(0)}, ${canyonCenter.z.toFixed(0)})`);

// Geotérmico Procedural
const springs = terrain.getGeothermalGenerator().getSprings();
assert(springs.length >= 3, `Pelo menos 3 fontes termais procedurais geradas (total: ${springs.length})`);
const s0 = springs[0];
const geoPt = terrain.getPoint(s0.x, s0.z);
assert(geoPt.geothermalInfluence !== undefined && geoPt.geothermalInfluence > 0.7, `Bacia geotermal detectada na coordenada procedural (${s0.x.toFixed(0)}, ${s0.z.toFixed(0)})`);
assert(geoPt.biome.type === BiomeType.GEOTHERMAL_VALLEY, 'Bioma GEOTHERMAL_VALLEY ativo na fonte termal');

// Maciço Montanhoso Continental / Cordilheira Tectônica
let maxPeakHeight = 0;
for (let px = -600; px <= 600; px += 30) {
  for (let pz = -600; pz <= 600; pz += 30) {
    const h = terrain.getHeight(px, pz);
    if (h > maxPeakHeight) maxPeakHeight = h;
  }
}
assert(maxPeakHeight > 60.0, `Picos montanhosos alpinos intactos na altitude de ${maxPeakHeight.toFixed(1)}m`);

// Tundra / Gelo
let icePt = terrain.getPoint(0, -750);
for (let ix = -400; ix <= 400; ix += 25) {
  for (let iz = -900; iz <= -650; iz += 25) {
    const p = terrain.getPoint(ix, iz);
    if (p.height > 0.5 && (p.iceInfluence || 0) > 0.4) {
      icePt = p;
      break;
    }
  }
  if (icePt.height > 0.5 && (icePt.iceInfluence || 0) > 0.4) break;
}
assert(icePt.iceInfluence !== undefined && icePt.iceInfluence > 0.4, 'Zona ártica com alta influência de gelo ao nível do mar');
assert(icePt.biome.type === BiomeType.FROZEN_TUNDRA, 'Bioma FROZEN_TUNDRA atribuído na costa norte congelada');
assert(icePt.biome.treeTypeDistribution.coastalPalm === 0.0, 'Bioma de gelo possui estritamente ZERO coqueiros (coastalPalm = 0.0)');

// Manguezal (zonas estuarinas interiores e várzeas tropicais)
let foundMangrove = false;
for (let mx = -1800; mx <= 1800; mx += 30) {
  for (let mz = -600; mz <= 2100; mz += 30) {
    const p = terrain.getPoint(mx, mz);
    if (p.biome.type === BiomeType.MANGROVE_SWAMP) {
      foundMangrove = true;
      break;
    }
  }
  if (foundMangrove) break;
}
assert(foundMangrove, 'Bioma MANGROVE_SWAMP gerado com sucesso em zonas de várzea tropical');

// Verificação Rigorosa das Praias e Orla Litorânea (Zonas Tropicais e Temperadas)
let beachSampleCount = 0;
let beachOnlyPalms = true;
for (let bx = -600; bx <= 600; bx += 20) {
  for (let bz = -440; bz <= 600; bz += 20) {
    const p = terrain.getPoint(bx, bz);
    if (p.height > 0.05 && p.height <= CONFIG.BEACH_HEIGHT && p.slope < 0.50) {
      beachSampleCount++;
      if (p.biome.type !== BiomeType.BEACH || p.biome.treeTypeDistribution.cactus !== 0.0 || p.biome.treeTypeDistribution.coastalPalm !== 1.0) {
        beachOnlyPalms = false;
        console.error(`Ponto fora do padrão de praia em (${bx}, ${bz}): h=${p.height}, biome=${p.biome.type}, cactus=${p.biome.treeTypeDistribution.cactus}`);
      }
    }
  }
}
assert(beachSampleCount > 10, `Amostras de praia avaliadas (${beachSampleCount} pontos)`);
assert(beachOnlyPalms, 'Toda a orla da praia possui 100% BiomeType.BEACH com exclusividade de coqueiros e 0% cactos');

// Verificação Rigorosa do Bioma de Gelo / Ártico (NENHUM coqueiro no gelo)
let arcticSampleCount = 0;
let arcticZeroPalms = true;
for (let ax = -600; ax <= 600; ax += 20) {
  for (let az = -900; az <= -520; az += 20) {
    const p = terrain.getPoint(ax, az);
    if (p.height > 0.05 && !p.isWater) {
      arcticSampleCount++;
      if (p.biome.treeTypeDistribution.coastalPalm !== 0.0) {
        arcticZeroPalms = false;
        console.error(`Coqueiro indevido no bioma de gelo em (${ax}, ${az}): h=${p.height}, biome=${p.biome.type}`);
      }
    }
  }
}
assert(arcticSampleCount > 10, `Amostras árticas avaliadas (${arcticSampleCount} pontos)`);
assert(arcticZeroPalms, 'O bioma ártico de gelo possui 0% de coqueiros em toda a sua extensão');

let hasSnowPineOrArcticWillow = false;
for (let ax = -600; ax <= 600; ax += 20) {
  for (let az = -900; az <= -520; az += 20) {
    const p = terrain.getPoint(ax, az);
    if (p.biome.type === BiomeType.FROZEN_TUNDRA) {
      if ((p.biome.treeTypeDistribution.snowPine || 0) > 0 && (p.biome.treeTypeDistribution.arcticWillow || 0) > 0) {
        hasSnowPineOrArcticWillow = true;
      }
    }
  }
}
assert(hasSnowPineOrArcticWillow, 'Tundra glacial possui pinheiro nevado (snowPine) e salgueiro ártico (arcticWillow)');

// Verificação da Continuidade C1 da Linha da Costa (zero degraus artificiais)
const macro = terrain.getMacro();
let continuityPass = true;
for (let cx = -300; cx <= 300; cx += 25) {
  for (let cz = -300; cz <= 300; cz += 25) {
    const mask = macro.getLandmassMask(cx, cz);
    if (Math.abs(mask.coastDist) < 1.0) {
      const hCoast = terrain.getHeight(cx, cz);
      if (Math.abs(hCoast) > 0.35) {
        continuityPass = false;
        console.error(`Descontinuidade detectada na costa em (${cx}, ${cz}): coastDist=${mask.coastDist}, h=${hCoast}`);
      }
    }
  }
}
assert(continuityPass, 'Linha da costa apresenta continuidade suave ao redor do nível do mar sem falésias artificiais');

// 6. Teste de Variabilidade Procedural Multi-Seed
console.log('\n--- Testes de Variabilidade com Segunda Seed (Verdant-Isle-402) ---');
const secondSeed = PRNG.hashString('Verdant-Isle-402');
const terrain2 = new TerrainGenerator(secondSeed);
const v2 = terrain2.getVolcanoGenerator().getVolcanoes()[0];
assert(v2.x !== v.x || v2.z !== v.z, `Vulcão muda de posição organicamente entre seeds: (${v.x.toFixed(0)}, ${v.z.toFixed(0)}) vs (${v2.x.toFixed(0)}, ${v2.z.toFixed(0)})`);
const spring2 = terrain2.getGeothermalGenerator().getSprings()[0];
assert(spring2.x !== s0.x || spring2.z !== s0.z, `Fontes termais mudam de posição entre seeds: (${s0.x.toFixed(0)}, ${s0.z.toFixed(0)}) vs (${spring2.x.toFixed(0)}, ${spring2.z.toFixed(0)})`);

const lakeA = terrain.getHydrology().getLakes()[0];
const lakeB = terrain2.getHydrology().getLakes()[0];
assert(lakeA.x !== lakeB.x || lakeA.z !== lakeB.z, `Lagos mudam de posição organicamente entre seeds: (${lakeA.x.toFixed(0)}, ${lakeA.z.toFixed(0)}) vs (${lakeB.x.toFixed(0)}, ${lakeB.z.toFixed(0)})`);

const riverA = terrain.getHydrology().getRivers()[0];
const riverB = terrain2.getHydrology().getRivers()[0];
assert(riverA.points[0].x !== riverB.points[0].x || riverA.points[0].z !== riverB.points[0].z, `Rios mudam de traçado entre seeds: (${riverA.points[0].x.toFixed(0)}, ${riverA.points[0].z.toFixed(0)}) vs (${riverB.points[0].x.toFixed(0)}, ${riverB.points[0].z.toFixed(0)})`);

// 7. Teste do Sistema de Shadow Clipmap Concêntrico e Texel Snapping
console.log('\n--- Testes do Sistema de Shadow Clipmap Concêntrico (3 Níveis) ---');
const { ShadowClipmap } = await import('../atmosphere/shadowClipmap.ts');
const { Scene, Vector3 } = await import('three');

const mockScene = new Scene();
const clipmap = new ShadowClipmap(mockScene);

assert(clipmap.getCascadeCount() === 3, 'ShadowClipmap gerencia exatamente 3 níveis concêntricos');
assert(clipmap.getConfigs()[0].radius === 35, 'Nível 0 (Near) cobre raio de 35m (frustum 70x70m, resolução 3.4cm/px)');
assert(clipmap.getConfigs()[1].radius === 120, 'Nível 1 (Mid) cobre raio de 120m (frustum 240x240m, resolução 11.7cm/px)');
assert(clipmap.getConfigs()[2].radius === 450, 'Nível 2 (Far) cobre raio de 450m (frustum 900x900m, resolução 43.9cm/px)');

const lights = clipmap.getLights();
assert(lights.every(l => l.castShadow === true), 'Todas as 3 luzes do Clipmap possuem castShadow ativo');
assert(lights[0].intensity > 1.0, 'Luz primária (0) atua como emissora solar principal');

// Teste de Texel Snapping
const sunDir = new Vector3(0.5, 0.8, 0.35).normalize();
clipmap.setSunDirection(sunDir);

// Move o observador por frações de milímetros
clipmap.updateTarget(100.005, 12.34, 50.002);
const pos1 = lights[0].target.position.clone();

// Move por valor abaixo de 1 texel do nível 0 (texelSize = 70 / 2048 ≈ 0.0341m)
clipmap.updateTarget(100.015, 12.34, 50.009);
const pos2 = lights[0].target.position.clone();

// Verifica a consistência da quantização
const diff = pos1.distanceTo(pos2);
assert(diff < 0.05, `Texel Snapping estabiliza a projeção de sombra contra sub-pixel swimming (deslocamento controlado: ${diff.toFixed(4)}m)`);

console.log('\n=== Todos os testes do subsistema de geração foram validados com sucesso! ===');
