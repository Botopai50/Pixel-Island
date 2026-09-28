import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createTree } from 'pixel-tree/src/services/treeGenerator.ts';
import { TREE_PRESETS } from 'pixel-tree/src/constants/presets.ts';
import {
  getPixelLeafColorAtlas,
  getPixelSingleLeafTexture,
} from 'pixel-tree/src/services/pixelArtTextureSystem.ts';
import { PRNG } from '../math/prng.ts';
import type { VegetationInstancePool } from './instancePool.ts';

export type PixelTreePresetKey = keyof typeof TREE_PRESETS;
export type PixelTreeFadeMode = 'tree' | 'veg' | 'none';

type LambertStyler = (
  material: THREE.MeshLambertMaterial,
  fade: PixelTreeFadeMode
) => THREE.MeshLambertMaterial;

interface PixelTreePart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
  castShadow: boolean;
  name: string;
}

interface PixelTreeAsset {
  preset: PixelTreePresetKey;
  parts: PixelTreePart[];
  materials: THREE.MeshLambertMaterial[];
  ownedTextures: THREE.Texture[];
  dispose(): void;
}

type MatrixItem = { matrix: THREE.Matrix4 };

const WHITE = new THREE.Color(0xffffff);

function isGroundDecoration(obj: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = obj;
  while (current) {
    if (current.userData?.ground) return true;
    if (/GroundMound|SCA_AttractorPoints|PixelRocks|SwampPool/i.test(current.name)) return true;
    current = current.parent;
  }
  return false;
}

function attrSignature(g: THREE.BufferGeometry): string {
  return Object.entries(g.attributes)
    .map(([name, a]) => `${name}:${a.itemSize}:${a.normalized ? 1 : 0}`)
    .sort()
    .join('|');
}

function copyInstancedAttribute(
  source: THREE.InstancedBufferAttribute,
  vertexCount: number,
  instanceIndex: number
): THREE.BufferAttribute {
  const out = new Float32Array(vertexCount * source.itemSize);
  for (let v = 0; v < vertexCount; v++) {
    const base = v * source.itemSize;
    const src = instanceIndex * source.itemSize;
    for (let k = 0; k < source.itemSize; k++) {
      out[base + k] = Number(source.array[src + k]);
    }
  }
  return new THREE.BufferAttribute(out, source.itemSize, source.normalized);
}

function bakeInstancedMesh(mesh: THREE.InstancedMesh): THREE.BufferGeometry | null {
  const instancedAttrs = Object.entries(mesh.geometry.attributes)
    .filter(([, a]) => (a as any).isInstancedBufferAttribute) as [string, THREE.InstancedBufferAttribute][];

  let base = mesh.geometry.clone();
  for (const [name] of instancedAttrs) base.deleteAttribute(name);

  if (base.index) {
    const nonIndexed = base.toNonIndexed();
    base.dispose();
    base = nonIndexed;
  }

  const pieces: THREE.BufferGeometry[] = [];
  const instanceMatrix = new THREE.Matrix4();
  const composed = new THREE.Matrix4();

  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, instanceMatrix);
    const g = base.clone();
    const vertexCount = g.getAttribute('position').count;

    for (const [name, a] of instancedAttrs) {
      g.setAttribute(name, copyInstancedAttribute(a, vertexCount, i));
    }

    composed.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
    g.applyMatrix4(composed);
    pieces.push(g);
  }

  base.dispose();
  if (pieces.length === 0) return null;
  if (pieces.length === 1) return pieces[0];

  const merged = BufferGeometryUtils.mergeGeometries(pieces, false);
  for (const g of pieces) g.dispose();
  return merged;
}

function bakeMesh(mesh: THREE.Mesh): THREE.BufferGeometry {
  let g = mesh.geometry.clone();
  if (g.index) {
    const nonIndexed = g.toNonIndexed();
    g.dispose();
    g = nonIndexed;
  }
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

function getUniform<T>(material: THREE.Material, name: string): T | undefined {
  const uniforms = (material as any).uniforms;
  return uniforms?.[name]?.value as T | undefined;
}

function getTexture(material: THREE.Material, name: string): THREE.Texture | undefined {
  const value = getUniform<any>(material, name);
  return value?.isTexture ? value as THREE.Texture : undefined;
}

function canvasPixels(texture: THREE.Texture): ImageData | null {
  const image: any = texture.image;
  if (!image || !image.width || !image.height) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    if (image instanceof HTMLCanvasElement || image instanceof HTMLImageElement || image instanceof ImageBitmap) {
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    if (image.data && image.width && image.height) {
      const raw = image.data instanceof Uint8ClampedArray
        ? image.data
        : new Uint8ClampedArray(image.data.buffer ?? image.data);
      return new ImageData(new Uint8ClampedArray(raw), image.width, image.height);
    }
  } catch {
    return null;
  }

  return null;
}

function finishColorTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.premultiplyAlpha = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converte a paleta procedural do Pixel_Tree em uma textura de albedo simples
 * para troncos/cactos/partes que eram pintadas inteiramente no fragment shader.
 * O padrão só mantém variação pixel-art; a luz vem 100% do Pixel-Island.
 */
function bakePalettePattern(
  source: THREE.Material,
  fallback: THREE.Color,
  seed: number,
  ownedTextures: THREE.Texture[]
): THREE.Texture {
  const palette = getTexture(source, 'uPalette');
  const p = palette ? canvasPixels(palette) : null;
  const steps = Math.max(3, Math.round(Number(getUniform<number>(source, 'uPaletteSteps') ?? (p?.width ?? 5))));
  const size = 16;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const rng = new PRNG(seed || 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (p && p.width > 0) {
        const band = Math.sin(y * 0.85) * 0.55 + Math.sin((x + y) * 0.33) * 0.35;
        const jitter = (rng.next() - 0.5) * 1.2;
        const idx = Math.max(0, Math.min(steps - 1, Math.round((steps - 1) * 0.48 + band + jitter)));
        const pi = Math.min(p.width - 1, idx) * 4;
        pixels[i] = p.data[pi];
        pixels[i + 1] = p.data[pi + 1];
        pixels[i + 2] = p.data[pi + 2];
      } else {
        const mul = 0.80 + rng.next() * 0.28;
        pixels[i] = Math.min(255, Math.round(fallback.r * 255 * mul));
        pixels[i + 1] = Math.min(255, Math.round(fallback.g * 255 * mul));
        pixels[i + 2] = Math.min(255, Math.round(fallback.b * 255 * mul));
      }

      pixels[i + 3] = 255;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, size, size), 0, 0);
  const tex = finishColorTexture(canvas, true);
  tex.repeat.set(2, 4);
  ownedTextures.push(tex);
  return tex;
}

/**
 * Leaf cards originally use uv 0..1 plus aAtlasIndex to choose one of 8 tiles.
 * MeshLambert does not know aAtlasIndex, so bake that selection directly into UV.
 */
function cloneResolvedColorTexture(
  source: THREE.Texture,
  ownedTextures: THREE.Texture[]
): THREE.Texture {
  const tex = source.clone();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  ownedTextures.push(tex);
  return tex;
}

function bakeLeafAtlasUv(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const atlas = geometry.getAttribute('aAtlasIndex') as THREE.BufferAttribute | undefined;
  if (!uv || !atlas || uv.count !== atlas.count) return;

  for (let i = 0; i < uv.count; i++) {
    const index = Math.max(0, Math.round(atlas.getX(i)));
    const col = index % 4;
    const row = Math.floor(index / 4);
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, (u + col) / 4, (v + (1 - row)) / 2);
  }
  uv.needsUpdate = true;
}

function isFoliagePart(name: string, source: THREE.Material): boolean {
  if (/foliage|leaf|leaves|canopy|frond|needle|fern|flower|reed|grass|shrub|petal/i.test(name)) return true;
  if (getTexture(source, 'uStruct')) return true;
  if (getTexture(source, 'uAtlas')) return true;
  if (getUniform(source, 'uColorTop') || getUniform(source, 'uColorBottom')) return true;
  return false;
}

function isWoodPart(name: string, source: THREE.Material): boolean {
  if (/wood|bark|trunk|branch|log|stump|endgrain|root/i.test(name)) return true;

  // Pixel_Tree pixel-bark shaders ALSO have uStruct/uPalette, exactly like leaves.
  // These uniforms are bark-specific and must win over the generic foliage test.
  if (getUniform(source, 'uBarkColor')) return true;
  if (getUniform(source, 'uBarkVScale') !== undefined) return true;
  if (getUniform(source, 'uMossAmount') !== undefined && getUniform(source, 'uRootY') !== undefined) return true;

  return false;
}

function chooseBaseColor(
  preset: PixelTreePresetKey,
  foliage: boolean,
  source: THREE.Material
): THREE.Color {
  const cfg: any = TREE_PRESETS[preset];

  const direct = (source as any).color;
  if (direct?.isColor) return direct.clone();

  const uniformColor = getUniform<THREE.Color>(
    source,
    foliage ? 'uColorBottom' : 'uBarkColor'
  );
  if (uniformColor?.isColor) return uniformColor.clone();

  const hex = foliage
    ? (cfg?.foliageColorBottom ?? cfg?.foliageColorTop ?? '#4f8d3a')
    : (cfg?.barkColor ?? '#6f5137');

  return new THREE.Color(hex);
}

function buildPixelIslandMaterial(
  preset: PixelTreePresetKey,
  source: THREE.Material,
  geometry: THREE.BufferGeometry,
  partName: string,
  fade: PixelTreeFadeMode,
  seed: number,
  ownedTextures: THREE.Texture[],
  styleMaterial: LambertStyler
): THREE.MeshLambertMaterial {
  // IMPORTANT: bark and foliage both use uStruct/uPalette in Pixel_Tree.
  // Classify wood FIRST or the trunk is mistaken for a leaf atlas.
  const wood = isWoodPart(partName, source);
  const foliage = !wood && isFoliagePart(partName, source);
  const baseColor = chooseBaseColor(preset, foliage, source);

  let map: THREE.Texture | null = null;
  let alphaTest = 0;

  if (wood) {
    // Madeira do Pixel_Tree vira albedo opaco comum do Pixel-Island.
    // Nenhum alpha/alphaTest do material original é reaproveitado.
    map = bakePalettePattern(source, baseColor, seed, ownedTextures);
    alphaTest = 0;
  } else if (foliage) {
    const cfg = TREE_PRESETS[preset] as any;
    const hasStructAtlas = !!getTexture(source, 'uStruct');
    const legacyAtlas = getTexture(source, 'uAtlas');
    const hasAtlasIndex = !!geometry.getAttribute('aAtlasIndex');

    if (hasStructAtlas) {
      // Usa o atlas COLORIDO oficial do Pixel_Tree. Ele já resolve:
      // estrutura procedural + paleta + silhueta + buracos internos.
      // Nenhuma iluminação do shader do gerador é preservada.
      const resolved = getPixelLeafColorAtlas(cfg);
      map = cloneResolvedColorTexture(resolved, ownedTextures);
      alphaTest = 0.5;

      // Broadleaf cards armazenam o tile em aAtlasIndex. Coníferas já trazem UV de atlas.
      if (hasAtlasIndex) bakeLeafAtlasUv(geometry);
    } else if (legacyAtlas) {
      map = cloneResolvedColorTexture(legacyAtlas, ownedTextures);
      alphaTest = Math.max(0.3, Number(getUniform<number>(source, 'uAlphaTest') ?? 0.5));
      if (hasAtlasIndex) bakeLeafAtlasUv(geometry);
    } else if (getTexture(source, 'uPalette')) {
      // Mudas/folhas isoladas usam uma única silhueta 0..1.
      const single = getPixelSingleLeafTexture(cfg, Math.abs(seed) % 8);
      map = cloneResolvedColorTexture(single, ownedTextures);
      alphaTest = 0.5;
    }
  }

  if (!map) {
    if (wood) {
      map = bakePalettePattern(source, baseColor, seed, ownedTextures);
      alphaTest = 0;
    } else {
      const sourceMap = (source as any).map;
      if (sourceMap?.isTexture) {
        map = cloneResolvedColorTexture(sourceMap, ownedTextures);
        alphaTest = Number((source as any).alphaTest ?? 0);
      } else {
        map = bakePalettePattern(source, baseColor, seed, ownedTextures);
        alphaTest = 0;
      }
    }
  }

  const material = new THREE.MeshLambertMaterial({
    map,
    color: map ? 0xffffff : baseColor,
    flatShading: false,
    vertexColors: !!geometry.getAttribute('color'),
    side: wood
      ? THREE.FrontSide
      : (foliage || source.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide),
    shadowSide: wood
      ? THREE.FrontSide
      : (foliage ? THREE.DoubleSide : THREE.FrontSide),
    alphaTest: foliage ? 0.5 : 0,
    opacity: 1.0,
    transparent: false,
    alphaToCoverage: false,
    depthWrite: true,
    depthTest: true,
    fog: true,
  });

  material.name = `PixelTree_IslandLit_${String(preset)}_${partName || 'part'}`;
  material.toneMapped = true;
  return styleMaterial(material, fade);
}

export class PixelTreeAssetLibrary {
  private worldSeed = 0;
  private cache = new Map<string, PixelTreeAsset>();

  constructor(
    private readonly styleMaterial: LambertStyler = (material) => material
  ) {}

  public ensureWorldSeed(seed: number): void {
    seed >>>= 0;
    if (this.worldSeed === seed) return;
    this.dispose();
    this.worldSeed = seed;
  }

  public variantCount(preset: PixelTreePresetKey): number {
    const cfg = TREE_PRESETS[preset];
    if (!cfg) return 1;
    if (cfg.growthStage === 'adult') return 3;
    if (cfg.growthStage === 'sapling') return 2;
    if (cfg.growthStage === 'shrub') return 2;
    if (cfg.growthStage === 'log') return 2;
    return 2;
  }

  public chooseVariant(preset: PixelTreePresetKey, matrix: THREE.Matrix4): number {
    const count = this.variantCount(preset);
    if (count <= 1) return 0;

    const e = matrix.elements;
    const species = PRNG.hashString(String(preset));
    const r = PRNG.hash2D(
      Math.round(e[12] * 8),
      Math.round(e[14] * 8),
      (this.worldSeed ^ species) >>> 0
    );
    return Math.min(count - 1, Math.floor(r * count));
  }

  public get(
    preset: PixelTreePresetKey,
    variant: number,
    fade: PixelTreeFadeMode
  ): PixelTreeAsset {
    const key = `${String(preset)}:${variant}:${fade}:${this.worldSeed}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const cfg = TREE_PRESETS[preset];
    if (!cfg) throw new Error(`Pixel_Tree preset not found: ${String(preset)}`);

    const speciesHash = PRNG.hashString(String(preset));
    const seed01 = PRNG.hash2D(
      speciesHash,
      variant + 1,
      (this.worldSeed ^ 0x9e3779b9) >>> 0
    );
    const seed = Math.max(1, Math.floor(seed01 * 0x7fffffff));

    const generated = createTree({
      ...cfg,
      seed,
      textureSeed: seed,
      showAttractors: false,
      showApples: false,
      appleCount: 0,
      showMushrooms: false,
      mushroomCount: 0,
      showFallingLeaves: false,
      fallingLeafCount: 0,
      pixelTextureEnabled: true,
    });

    generated.group.updateMatrixWorld(true);

    type Piece = {
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      internal: boolean;
      castShadow: boolean;
      name: string;
    };

    const pieces: Piece[] = [];

    generated.group.traverse((obj) => {
      if (isGroundDecoration(obj)) return;
      if ((obj as any).isSprite || (obj as any).isPoints) return;

      if ((obj as any).isInstancedMesh) {
        const mesh = obj as THREE.InstancedMesh;
        const g = bakeInstancedMesh(mesh);
        if (!g) return;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        pieces.push({
          geometry: g,
          material,
          internal: true,
          castShadow: mesh.castShadow,
          name: mesh.name || 'pixel_tree_instanced',
        });
      } else if ((obj as any).isMesh) {
        const mesh = obj as THREE.Mesh;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        pieces.push({
          geometry: bakeMesh(mesh),
          material,
          internal: false,
          castShadow: mesh.castShadow,
          name: mesh.name || 'pixel_tree_mesh',
        });
      }
    });

    const groups = new Map<string, Piece[]>();
    for (const p of pieces) {
      const k = `${p.material.uuid}|${p.internal ? 1 : 0}|${attrSignature(p.geometry)}|${p.castShadow ? 1 : 0}`;
      const list = groups.get(k);
      if (list) list.push(p);
      else groups.set(k, [p]);
    }

    const parts: PixelTreePart[] = [];
    const materials: THREE.MeshLambertMaterial[] = [];
    const ownedTextures: THREE.Texture[] = [];
    let partIndex = 0;

    for (const groupPieces of groups.values()) {
      const geos = groupPieces.map((p) => p.geometry);
      const geometry = geos.length === 1
        ? geos[0]
        : BufferGeometryUtils.mergeGeometries(geos, false);

      if (!geometry) {
        for (const g of geos) g.dispose();
        continue;
      }
      if (geos.length > 1) for (const g of geos) g.dispose();

      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();

      const sourceMaterial = groupPieces[0].material;
      const partName = groupPieces[0].name;
      const material = buildPixelIslandMaterial(
        preset,
        sourceMaterial,
        geometry,
        partName,
        fade,
        (seed ^ (partIndex++ * 0x9e3779b9)) >>> 0,
        ownedTextures,
        this.styleMaterial
      );

      materials.push(material);
      parts.push({
        geometry,
        material,
        castShadow: groupPieces[0].castShadow,
        name: partName,
      });
    }

    const asset: PixelTreeAsset = {
      preset,
      parts,
      materials,
      ownedTextures,
      dispose: () => {
        for (const part of parts) part.geometry.dispose();
        for (const material of materials) material.dispose();
        for (const texture of ownedTextures) texture.dispose();
      },
    };

    this.cache.set(key, asset);
    return asset;
  }

  public addInstances(
    pool: VegetationInstancePool,
    owner: number,
    preset: PixelTreePresetKey,
    items: MatrixItem[],
    fade: PixelTreeFadeMode,
    name?: string
  ): void {
    if (items.length === 0) return;

    const byVariant = new Map<number, THREE.Matrix4[]>();
    for (const item of items) {
      const variant = this.chooseVariant(preset, item.matrix);
      const list = byVariant.get(variant);
      if (list) list.push(item.matrix);
      else byVariant.set(variant, [item.matrix]);
    }

    for (const [variant, matrices] of byVariant) {
      const asset = this.get(preset, variant, fade);
      const colors = matrices.map(() => WHITE);

      for (let i = 0; i < asset.parts.length; i++) {
        const part = asset.parts[i];
        pool.add(
          owner,
          part.geometry,
          part.material,
          matrices,
          colors,
          name ? `${name}_${variant}_${i}` : undefined,
          part.castShadow
        );
      }
    }
  }

  public createPreviewObject(
    preset: PixelTreePresetKey,
    variant = 0
  ): THREE.Group {
    const asset = this.get(preset, variant, 'none');
    const group = new THREE.Group();

    for (const part of asset.parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = part.castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return group;
  }

  public update(_time: number): void {
    // Os materiais agora são os mesmos Lambert/SMSR do Pixel-Island.
    // Não existe mais uTime/uLightDir/rim/SSS próprio do Pixel_Tree.
  }

  public syncLighting(
    _sunDirection: THREE.Vector3,
    _sunColor: THREE.Color,
    _ambientColor: THREE.Color
  ): void {
    // Intencionalmente vazio: MeshLambertMaterial usa as luzes reais da scene.
  }

  public dispose(): void {
    for (const asset of this.cache.values()) asset.dispose();
    this.cache.clear();
  }
}
