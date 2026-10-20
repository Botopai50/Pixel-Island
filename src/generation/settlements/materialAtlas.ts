/**
 * Atlas de materiais da cidade.
 *
 * Cada variante de prédio cria os seus próprios materiais (a mesma luz e o mesmo shader, mas com uma textura pintada, uma semente de musgo e uma paleta
 * só dela): uma cidade chega a ~200 materiais, e cada TROCA de material custa ~15 µs de CPU do three.js (uniformes), contra ~3 µs de um desenho. Aqui os
 * materiais de MESMO shader viram UM: as texturas entram num atlas, e o que variava por material (retângulo no atlas, repetição, semente, musgo, neve, linha da
 * paleta) vai para uma textura de dados lida pelo número do material, que cada vértice traz num atributo (`aMatId`). O desenho de cada pixel é o mesmo: a
 * textura é lida no mesmo texel (vizinho mais próximo, repetição por `fract`).
 *
 * Só entram materiais que dá para provar equivalentes: MeshStandardMaterial só com `map` (DataTexture RGBA8, repetida, filtro vizinho, sem mipmaps),
 * opacos, e cujo `onBeforeCompile` produza exatamente o texto de shader esperado (testado de verdade, sobre o shader padrão do three, antes de aceitar).
 * O que não passar fica como está.
 */
import * as THREE from 'three';

export interface AtlasEntry { shared: THREE.Material; id: number }
export interface MaterialAtlas { entryOf(m: THREE.Material): AtlasEntry | null; readonly count: number; dispose(): void }

const STRUCT_FLOATS = ['uStructureMoss', 'uStructureMossHeight', 'uStructureSnow', 'uStructureSeed'];
const ATLAS_W = 2048;
const ATLAS_MAX_H = 4096;
const MIN_GROUP = 3;

interface Cand {
  m: THREE.MeshStandardMaterial;
  map: THREE.DataTexture;
  rep: [number, number];
  /** a textura prende na borda (ClampToEdge) em vez de repetir */
  clamp: boolean;
  seed: number; mossH: number; moss: number; snow: number;
  palette: THREE.DataTexture | null;
  hasStruct: boolean;
  key: string;
}

type ProbeShader = { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string; defines: Record<string, unknown> };

function probe(m: THREE.Material): ProbeShader | null {
  const sl = THREE.ShaderLib.standard;
  const shader: ProbeShader = { uniforms: {}, vertexShader: sl.vertexShader, fragmentShader: sl.fragmentShader, defines: {} };
  try { m.onBeforeCompile(shader as never, undefined as never); } catch { return null; }
  return shader;
}

/** Remenda o texto do shader (já passado pelo `onBeforeCompile` original). Devolve false se algo esperado não estiver lá. */
function patchShader(shader: ProbeShader, hasStruct: boolean): boolean {
  let vs = shader.vertexShader, fs = shader.fragmentShader;
  if (!vs.includes('#include <begin_vertex>') || !fs.includes('#include <map_fragment>') || !fs.includes('void main() {')) return false;
  vs = 'attribute float aMatId;\nflat varying float vMatId;\nvarying vec2 vAtlasUv;\n' + vs;
  vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMatId = aMatId;\nvAtlasUv = uv;');
  if (hasStruct) {
    // os números da estrutura deixam de ser uniformes e viram variáveis do shader, lidas da textura de dados no início do main
    let found = 0;
    fs = fs.replace(/uniform\s+float\s+([^;]*);/g, (full: string, list: string) => {
      const names = list.split(',').map((s) => s.trim());
      const drop = names.filter((n) => STRUCT_FLOATS.includes(n));
      if (drop.length === 0) return full;
      found += drop.length;
      const keep = names.filter((n) => !STRUCT_FLOATS.includes(n));
      return (keep.length ? `uniform float ${keep.join(',')};` : '') + `float ${drop.join(',')};`;
    });
    if (found !== STRUCT_FLOATS.length) return false;
    const before = fs;
    fs = fs.replace(/uniform\s+sampler2D\s+uStructureMossPalette\s*;/, '');
    if (fs === before) return false;
    fs = fs.replace(/texture2D\(\s*uStructureMossPalette\s*,\s*vec2\(([^,;]*),\s*\.5\s*\)\s*\)/g, 'texture2D(uPalAtlas,vec2($1,uPalRowV))');
    if (/uStructureMossPalette/.test(fs)) return false;
  }
  fs = 'uniform sampler2D uMatData;\nuniform sampler2D uPalAtlas;\nuniform vec2 uPalSize;\nflat varying float vMatId;\nvarying vec2 vAtlasUv;\nvec4 uAtlasRect;\nvec2 uAtlasRep;\nfloat uAtlasClamp;\nfloat uPalRowV;\n' + fs;
  fs = fs.replace('#include <map_fragment>', `#ifdef USE_MAP
 vec2 atlasUv = vAtlasUv * uAtlasRep;
 atlasUv = uAtlasClamp > 0.5 ? clamp( atlasUv, 0.0, 0.9999 ) : fract( atlasUv );
 vec4 sampledDiffuseColor = texture2D( map, uAtlasRect.xy + atlasUv * uAtlasRect.zw );
 diffuseColor *= sampledDiffuseColor;
#endif`);
  fs = fs.replace('void main() {', `void main() {
 { int mi = int(vMatId + 0.5);
   vec4 d0 = texelFetch(uMatData, ivec2(0, mi), 0); vec4 d1 = texelFetch(uMatData, ivec2(1, mi), 0); vec4 d2 = texelFetch(uMatData, ivec2(2, mi), 0);
   uAtlasRect = d0; uAtlasRep = d1.xy; uAtlasClamp = d2.w; uPalRowV = (d2.z + 0.5) / uPalSize.y;
   ${hasStruct ? 'uStructureSeed = d1.z; uStructureMossHeight = d1.w; uStructureMoss = d2.x; uStructureSnow = d2.y;' : ''}
 }`);
  shader.vertexShader = vs;
  shader.fragmentShader = fs;
  return true;
}

function candidate(m: THREE.Material): Cand | null {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || (s as unknown as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial) return null;
  if (s.transparent || s.opacity !== 1 || s.alphaTest !== 0 || s.alphaMap || s.normalMap || s.roughnessMap || s.metalnessMap || s.aoMap || s.emissiveMap || s.bumpMap || s.lightMap || s.envMap || s.displacementMap) return null;
  const t = s.map as THREE.DataTexture | null;
  if (!t || !(t as { isDataTexture?: boolean }).isDataTexture) return null;
  const img = t.image as { data: unknown; width: number; height: number };
  if (!(img.data instanceof Uint8Array) || img.data.length !== img.width * img.height * 4) return null;
  if (t.format !== THREE.RGBAFormat || t.type !== THREE.UnsignedByteType) return null;
  if (t.wrapS !== t.wrapT || (t.wrapS !== THREE.RepeatWrapping && t.wrapS !== THREE.ClampToEdgeWrapping) || t.minFilter !== THREE.NearestFilter || t.magFilter !== THREE.NearestFilter) return null;
  if (t.generateMipmaps || t.flipY || t.premultiplyAlpha || t.rotation !== 0 || t.offset.x !== 0 || t.offset.y !== 0 || t.channel !== 0 || t.colorSpace !== THREE.SRGBColorSpace) return null;
  const sh = probe(s);
  if (!sh) return null;
  const u = sh.uniforms;
  const hasStruct = 'uStructureSeed' in u;
  let palette: THREE.DataTexture | null = null;
  let seed = 0, mossH = 0, moss = 0, snow = 0;
  if (hasStruct) {
    const get = (k: string): number | null => { const v = u[k]?.value; return typeof v === 'number' ? v : null; };
    const a = get('uStructureSeed'), b = get('uStructureMossHeight'), c = get('uStructureMoss'), d = get('uStructureSnow');
    palette = (u.uStructureMossPalette?.value ?? null) as THREE.DataTexture | null;
    if (a === null || b === null || c === null || d === null || !palette) return null;
    const pi = palette.image as { data: unknown; width: number; height: number };
    if (!(pi.data instanceof Uint8Array) || pi.width !== 6 || pi.height !== 1 || pi.data.length !== 24 || palette.colorSpace !== THREE.SRGBColorSpace
      || palette.minFilter !== THREE.NearestFilter || palette.magFilter !== THREE.NearestFilter || palette.format !== THREE.RGBAFormat) return null;
    seed = a; mossH = b; moss = c; snow = d;
  }
  // o remendo precisa casar com o shader deste material (testado agora; no atlas ele roda de novo, no mesmo texto)
  if (!patchShader(sh, hasStruct)) return null;
  const key = [s.customProgramCacheKey(), s.side, s.vertexColors, s.roughness, s.metalness, s.color.getHex(), s.emissive.getHex(), s.emissiveIntensity, s.flatShading, s.envMapIntensity, hasStruct, s.shadowSide ?? ''].join('|');
  return { m: s, map: t, rep: [t.repeat.x, t.repeat.y], clamp: t.wrapS === THREE.ClampToEdgeWrapping, seed, mossH, moss, snow, palette, hasStruct, key };
}

/** Planeja o atlas para os materiais dados; devolve null se não valer a pena (menos de MIN_GROUP materiais iguais) ou se algo não coube. */
export function planMaterialAtlas(materials: THREE.Material[]): MaterialAtlas | null {
  if (new URLSearchParams(window.location.search).get('atlas') === '0') return null;     // (comparação com e sem atlas)
  const groups = new Map<string, Cand[]>();
  for (const m of new Set(materials)) {
    const c = candidate(m);
    if (!c) continue;
    const g = groups.get(c.key);
    if (g) g.push(c); else groups.set(c.key, [c]);
  }
  const chosen: Cand[][] = [...groups.values()].filter((g) => g.length >= MIN_GROUP);
  if (chosen.length === 0) return null;

  // atlas: prateleiras de altura decrescente, cada textura uma vez
  const textures = new Map<THREE.DataTexture, [number, number, number, number]>();
  for (const g of chosen) for (const c of g) textures.set(c.map, [0, 0, 0, 0]);
  const order = [...textures.keys()].sort((a, b) => b.image.height - a.image.height);
  let x = 0, y = 0, rowH = 0;
  for (const t of order) {
    const w = t.image.width, h = t.image.height;
    if (x + w > ATLAS_W) { y += rowH; x = 0; rowH = 0; }
    textures.set(t, [x, y, w, h]);
    x += w; rowH = Math.max(rowH, h);
  }
  const atlasH = y + rowH;
  if (atlasH > ATLAS_MAX_H || order.some((t) => t.image.width > ATLAS_W)) return null;
  const atlasData = new Uint8Array(ATLAS_W * atlasH * 4);
  for (const t of order) {
    const [px, py, w, h] = textures.get(t)!;
    const src = t.image.data as Uint8Array;
    for (let r = 0; r < h; r++) atlasData.set(src.subarray(r * w * 4, (r + 1) * w * 4), ((py + r) * ATLAS_W + px) * 4);
  }
  const atlasTex = new THREE.DataTexture(atlasData, ATLAS_W, atlasH, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.minFilter = atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.needsUpdate = true;

  // paletas de musgo: uma linha por paleta distinta
  const palettes: THREE.DataTexture[] = [];
  for (const g of chosen) for (const c of g) if (c.palette && !palettes.includes(c.palette)) palettes.push(c.palette);
  const palRows = Math.max(1, palettes.length);
  const palData = new Uint8Array(6 * palRows * 4);
  palettes.forEach((p, i) => palData.set(p.image.data as Uint8Array, i * 24));
  const palTex = new THREE.DataTexture(palData, 6, palRows, THREE.RGBAFormat, THREE.UnsignedByteType);
  palTex.colorSpace = THREE.SRGBColorSpace;
  palTex.minFilter = palTex.magFilter = THREE.NearestFilter;
  palTex.generateMipmaps = false;
  palTex.needsUpdate = true;

  const all = chosen.flat();
  const data = new Float32Array(3 * all.length * 4);
  const ids = new Map<THREE.Material, AtlasEntry>();
  const sharedList: THREE.Material[] = [];
  const dataTex = new THREE.DataTexture(data, 3, all.length, THREE.RGBAFormat, THREE.FloatType);
  dataTex.minFilter = dataTex.magFilter = THREE.NearestFilter;
  dataTex.generateMipmaps = false;
  const palSize = new THREE.Vector2(6, palRows);

  let id = 0;
  for (const g of chosen) {
    const first = g[0].m;
    const hasStruct = g[0].hasStruct;
    const shared = new THREE.MeshStandardMaterial({
      color: first.color.clone(), roughness: first.roughness, metalness: first.metalness, side: first.side, vertexColors: first.vertexColors,
      flatShading: first.flatShading, emissive: first.emissive.clone(), emissiveIntensity: first.emissiveIntensity, envMapIntensity: first.envMapIntensity, map: atlasTex,
    });
    shared.name = first.name;
    shared.shadowSide = first.shadowSide;
    shared.userData = { ...first.userData, atlas: true };
    const firstKey = first.customProgramCacheKey();
    shared.customProgramCacheKey = () => firstKey + '|atlas';
    // (`first` é um dos materiais já remendados pelo jogo: a cadeia de onBeforeCompile dele roda inteira, e só depois o remendo do atlas)
    shared.onBeforeCompile = (shader, renderer) => {
      first.onBeforeCompile.call(first, shader, renderer);
      const s = shader as unknown as ProbeShader;
      if (!patchShader(s, hasStruct)) throw new Error('atlas de materiais: shader inesperado');
      s.uniforms.uMatData = { value: dataTex };
      s.uniforms.uPalAtlas = { value: palTex };
      s.uniforms.uPalSize = { value: palSize };
    };
    sharedList.push(shared);
    for (const c of g) {
      const [rx, ry, rw, rh] = textures.get(c.map)!;
      const o = id * 12;
      data[o] = rx / ATLAS_W; data[o + 1] = ry / atlasH; data[o + 2] = rw / ATLAS_W; data[o + 3] = rh / atlasH;
      data[o + 4] = c.rep[0]; data[o + 5] = c.rep[1]; data[o + 6] = c.seed; data[o + 7] = c.mossH;
      data[o + 8] = c.moss; data[o + 9] = c.snow; data[o + 10] = c.palette ? palettes.indexOf(c.palette) : 0; data[o + 11] = c.clamp ? 1 : 0;
      ids.set(c.m, { shared, id });
      id++;
    }
  }
  dataTex.needsUpdate = true;

  return {
    entryOf: (m) => ids.get(m) ?? null,
    count: all.length,
    dispose: () => { atlasTex.dispose(); palTex.dispose(); dataTex.dispose(); for (const s of sharedList) s.dispose(); },
  };
}
