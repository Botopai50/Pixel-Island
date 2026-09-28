import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createTree } from 'pixel-tree/src/services/treeGenerator.ts';
import { TREE_PRESETS } from 'pixel-tree/src/constants/presets.ts';
import { PRNG } from '../math/prng.ts';
import { FADE, FADE_GLSL } from '../shaders/fadeDither.ts';
import type { VegetationInstancePool } from './instancePool.ts';

export type PixelTreePresetKey = keyof typeof TREE_PRESETS;
type FadeMode = 'tree' | 'veg' | 'none';

interface PixelTreePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  name: string;
}

interface PixelTreeAsset {
  preset: PixelTreePresetKey;
  parts: PixelTreePart[];
  materials: THREE.Material[];
  update(time: number): void;
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
    for (let k = 0; k < source.itemSize; k++) out[base + k] = Number(source.array[src + k]);
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

function injectBeforeMainEnd(shader: string, code: string): string {
  const mainIndex = shader.indexOf('void main');
  if (mainIndex < 0) return shader;
  const open = shader.indexOf('{', mainIndex);
  if (open < 0) return shader;

  let depth = 0;
  for (let i = open; i < shader.length; i++) {
    const ch = shader[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return shader.slice(0, i) + '\n' + code + '\n' + shader.slice(i);
    }
  }
  return shader;
}

function injectStandardFade(material: THREE.Material, fade: FadeMode): void {
  if (fade === 'none') return;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous.call(material, shader, renderer);
    shader.uniforms.uFadeCam = FADE.uFadeCam;
    shader.uniforms.uInstFade = fade === 'tree' ? FADE.uTreeSwap : FADE.uVegFade;
    shader.vertexShader =
      'uniform vec2 uFadeCam;\nvarying float vPTInstDist;\nvarying float vPTInstHash;\n' +
      FADE_GLSL +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  vec2 ptW = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;',
          '  vPTInstDist = distance(ptW, uFadeCam);',
          '  vPTInstHash = fadeHash(floor(ptW * 4.0));',
          '#else',
          '  vPTInstDist = 0.0;',
          '  vPTInstHash = 0.0;',
          '#endif',
        ].join('\n')
      );
    shader.fragmentShader =
      'uniform vec2 uInstFade;\nvarying float vPTInstDist;\nvarying float vPTInstHash;\n' +
      shader.fragmentShader.replace(
        'void main() {',
        'void main() {\n  if (vPTInstHash > 1.0 - smoothstep(uInstFade.x, uInstFade.y, vPTInstDist)) discard;'
      );
  };
  material.customProgramCacheKey = () => `pixel_tree_std_${fade}_${material.type}`;
}

function patchShaderMaterial(
  source: THREE.ShaderMaterial,
  fade: FadeMode,
  bakedInternalInstancing: boolean
): THREE.ShaderMaterial {
  const mat = source.clone();
  let vertex = mat.vertexShader;

  if (bakedInternalInstancing) {
    vertex = vertex
      .replace(/instanceMatrix\s*\*\s*vec4\(pos\s*,\s*1\.0\)/g, 'vec4(pos, 1.0)')
      .replace(
        /modelMatrix\s*\*\s*instanceMatrix\s*\*\s*vec4\(0\.0\s*,\s*0\.5\s*,\s*0\.0\s*,\s*1\.0\)/g,
        'modelMatrix * vec4(pos, 1.0)'
      );
  }

  // The generated model becomes an outer InstancedMesh in Pixel-Island.
  // Make every world-space transform include that outer instance transform.
  vertex = vertex.replace(/\bmodelMatrix\b/g, 'PT_MODEL_MATRIX');
  vertex =
    '#ifdef USE_INSTANCING\n' +
    '#define PT_MODEL_MATRIX (modelMatrix * instanceMatrix)\n' +
    '#else\n' +
    '#define PT_MODEL_MATRIX modelMatrix\n' +
    '#endif\n' +
    vertex;

  if (fade !== 'none') {
    mat.uniforms.uFadeCam = FADE.uFadeCam;
    mat.uniforms.uInstFade = fade === 'tree' ? FADE.uTreeSwap : FADE.uVegFade;

    vertex =
      'uniform vec2 uFadeCam;\nvarying float vPTInstDist;\nvarying float vPTInstHash;\n' +
      FADE_GLSL +
      vertex.replace(
        'void main() {',
        [
          'void main() {',
          '#ifdef USE_INSTANCING',
          '  vec2 ptW = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;',
          '  vPTInstDist = distance(ptW, uFadeCam);',
          '  vPTInstHash = fadeHash(floor(ptW * 4.0));',
          '#else',
          '  vPTInstDist = 0.0;',
          '  vPTInstHash = 0.0;',
          '#endif',
        ].join('\n')
      );

    mat.fragmentShader =
      'uniform vec2 uInstFade;\nvarying float vPTInstDist;\nvarying float vPTInstHash;\n' +
      mat.fragmentShader.replace(
        'void main() {',
        'void main() {\n  if (vPTInstHash > 1.0 - smoothstep(uInstFade.x, uInstFade.y, vPTInstDist)) discard;'
      );
  }

  mat.vertexShader = vertex;
  mat.needsUpdate = true;
  return mat;
}

function cloneForPixelIsland(
  material: THREE.Material,
  fade: FadeMode,
  bakedInternalInstancing: boolean
): THREE.Material {
  if ((material as any).isShaderMaterial) {
    const shader = patchShaderMaterial(material as THREE.ShaderMaterial, fade, bakedInternalInstancing);

    // O Pixel_Tree foi desenhado para uma cena própria e possui rim light/SSS/highlights
    // bastante fortes. Dentro do Pixel-Island isso fazia as copas parecerem autoiluminadas.
    if (shader.uniforms.uRimIntensity && typeof shader.uniforms.uRimIntensity.value === 'number') {
      shader.uniforms.uRimIntensity.value = Math.min(shader.uniforms.uRimIntensity.value * 0.32, 0.28);
    }
    if (shader.uniforms.uHighlightAmount && typeof shader.uniforms.uHighlightAmount.value === 'number') {
      shader.uniforms.uHighlightAmount.value *= 0.58;
    }

    shader.uniforms.uPixelIslandBrightness = { value: 0.74 };
    shader.fragmentShader =
      'uniform float uPixelIslandBrightness;\n' +
      injectBeforeMainEnd(
        shader.fragmentShader,
        'gl_FragColor.rgb *= uPixelIslandBrightness;'
      );
    shader.needsUpdate = true;
    return shader;
  }

  const clone = material.clone() as any;
  // Materiais Toon/Standard auxiliares do gerador também trazem emissive pensado para o preview.
  if (clone.emissive?.isColor) clone.emissive.multiplyScalar(0.12);
  injectStandardFade(clone, fade);
  clone.needsUpdate = true;
  return clone;
}

function disposeMaterialTextures(material: THREE.Material): void {
  const seen = new Set<THREE.Texture>();
  const anyMat = material as any;
  for (const value of Object.values(anyMat)) {
    if (value && (value as any).isTexture) seen.add(value as THREE.Texture);
  }
  if (anyMat.uniforms) {
    for (const u of Object.values(anyMat.uniforms) as any[]) {
      const value = u?.value;
      if (value && value.isTexture) seen.add(value);
    }
  }
  for (const t of seen) t.dispose();
}

export class PixelTreeAssetLibrary {
  private worldSeed = 0;
  private cache = new Map<string, PixelTreeAsset>();

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
    const r = PRNG.hash2D(Math.round(e[12] * 8), Math.round(e[14] * 8), (this.worldSeed ^ species) >>> 0);
    return Math.min(count - 1, Math.floor(r * count));
  }

  public get(
    preset: PixelTreePresetKey,
    variant: number,
    fade: FadeMode
  ): PixelTreeAsset {
    const key = `${String(preset)}:${variant}:${fade}:${this.worldSeed}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const cfg = TREE_PRESETS[preset];
    if (!cfg) throw new Error(`Pixel_Tree preset not found: ${String(preset)}`);

    const speciesHash = PRNG.hashString(String(preset));
    const seed01 = PRNG.hash2D(speciesHash, variant + 1, (this.worldSeed ^ 0x9e3779b9) >>> 0);
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

    type Piece = { geometry: THREE.BufferGeometry; material: THREE.Material; internal: boolean; castShadow: boolean; name: string };
    const pieces: Piece[] = [];

    generated.group.traverse((obj) => {
      if (isGroundDecoration(obj)) return;
      if ((obj as any).isSprite || (obj as any).isPoints) return;

      if ((obj as any).isInstancedMesh) {
        const mesh = obj as THREE.InstancedMesh;
        const g = bakeInstancedMesh(mesh);
        if (!g) return;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        pieces.push({ geometry: g, material, internal: true, castShadow: mesh.castShadow, name: mesh.name || 'pixel_tree_instanced' });
      } else if ((obj as any).isMesh) {
        const mesh = obj as THREE.Mesh;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        pieces.push({ geometry: bakeMesh(mesh), material, internal: false, castShadow: mesh.castShadow, name: mesh.name || 'pixel_tree_mesh' });
      }
    });

    // Merge pieces that share material, attribute layout and instancing mode.
    const groups = new Map<string, Piece[]>();
    for (const p of pieces) {
      const k = `${p.material.uuid}|${p.internal ? 1 : 0}|${attrSignature(p.geometry)}|${p.castShadow ? 1 : 0}`;
      const list = groups.get(k);
      if (list) list.push(p);
      else groups.set(k, [p]);
    }

    const parts: PixelTreePart[] = [];
    const materials: THREE.Material[] = [];

    for (const groupPieces of groups.values()) {
      const geos = groupPieces.map((p) => p.geometry);
      const geometry = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
      if (!geometry) {
        for (const g of geos) g.dispose();
        continue;
      }
      if (geos.length > 1) for (const g of geos) g.dispose();

      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      const sourceMaterial = groupPieces[0].material;
      const material = cloneForPixelIsland(sourceMaterial, fade, groupPieces[0].internal);
      materials.push(material);
      parts.push({
        geometry,
        material,
        castShadow: groupPieces[0].castShadow,
        name: groupPieces[0].name,
      });
    }

    const asset: PixelTreeAsset = {
      preset,
      parts,
      materials,
      update: (time: number) => {
        for (const material of materials) {
          const uniforms = (material as any).uniforms;
          if (uniforms?.uTime) uniforms.uTime.value = time;
        }
      },
      dispose: () => {
        for (const part of parts) part.geometry.dispose();
        for (const material of materials) {
          disposeMaterialTextures(material);
          material.dispose();
        }
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
    fade: FadeMode,
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

  public createPreviewObject(preset: PixelTreePresetKey, variant = 0): THREE.Group {
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

  public update(time: number): void {
    for (const asset of this.cache.values()) asset.update(time);
  }

  /**
   * Sincroniza os shaders do Pixel_Tree com a iluminação real do Pixel-Island.
   * uTexLightDir continua fixo porque faz parte da pintura procedural das texturas;
   * uLightDir, por outro lado, deve acompanhar o sol da cena.
   */
  public syncLighting(
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color,
    ambientColor: THREE.Color
  ): void {
    const sunLum = sunColor.r * 0.2126 + sunColor.g * 0.7152 + sunColor.b * 0.0722;
    const ambientLum = ambientColor.r * 0.2126 + ambientColor.g * 0.7152 + ambientColor.b * 0.0722;
    const brightness = THREE.MathUtils.clamp(0.45 + ambientLum * 0.20 + sunLum * 0.10, 0.42, 0.76);

    for (const asset of this.cache.values()) {
      for (const material of asset.materials) {
        const uniforms = (material as any).uniforms;
        if (!uniforms) continue;
        if (uniforms.uLightDir?.value?.isVector3) {
          uniforms.uLightDir.value.copy(sunDirection).normalize();
        }
        if (uniforms.uPixelIslandBrightness) {
          uniforms.uPixelIslandBrightness.value = brightness;
        }
      }
    }
  }

  public dispose(): void {
    for (const asset of this.cache.values()) asset.dispose();
    this.cache.clear();
  }
}
