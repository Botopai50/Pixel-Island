// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { runSpaceColonization, buildFullTreeGeometry, SCANode } from './spaceColonization';
import { buildProceduralFoliage, CrownBounds } from './foliageSystem';
import { buildProceduralPalm } from './palmGenerator';
import { buildProceduralConifer, varyConiferConfig } from './coniferGenerator';
import { buildProceduralCactus } from './cactusGenerator';
import { buildSwampRootsAndAccessories } from './swampGenerator';
import { buildStylizedMangroveCanopy } from './stylizedRosetteCanopy';
import { buildProceduralSapling } from './saplingGenerator';
import { buildProceduralDeadwood } from './deadwoodGenerator';
import { createPixelBarkMaterial } from './pixelArtTextureSystem';
import { buildHangingFruit } from './fruitSystem';
import { bracketSprite, mushroomSprite, spriteMaterial, MUSHROOM_CAPS, MUSHROOM_FOOT } from './pixelSprites';
import { treeMushroomCard } from './mushroomRotation';
import { createGroundProps } from './groundPropGenerator';
import { buildProceduralLog, LogResult } from './logGenerator';
import { createPixelEndGrainMaterial } from './endGrainMaterial';
import { cutTree, CutResult } from './treeCutter';
import { buildPixelRocks } from './rockSystem';
import { buildGroundPlant, GroundPlantResult } from './groundPlantGenerator';
import { createProceduralRock } from './rockGenerator';

export interface TreeInstance {
  group: THREE.Group;
  foliageMaterials: THREE.ShaderMaterial[];
  barkMaterial: THREE.ShaderMaterial;
  update: (time: number) => void;
  dispose: () => void;
  /** false for what is already dead wood on the ground (the logs) */
  canFell?: boolean;
  /** Fells this very tree: splits it at the cut into the stump and the part
   *  above, which then falls over and comes to rest beside the stump. */
  fell?: () => FellInfo | null;
}

/** Where the felled tree ends up, for framing it. */
export interface FellInfo {
  /** middle of the stump + felled trunk, on the ground */
  centre: THREE.Vector3;
  /** from the far side of the stump to the felled tree's top */
  span: number;
}

/** How high the cut goes: a stump's height, below every branch. */
function cutHeightFor(config: TreeConfig): number {
  const h = config.trunkHeight;
  if (config.growthStage === 'sapling' || config.species.endsWith('_sapling')) return Math.max(0.06, h * 0.12);
  if (config.growthStage === 'shrub') return Math.max(0.08, h * 0.08);
  let y = THREE.MathUtils.clamp(h * 0.1, 0.6, 1.3);
  // the mangrove is cut above its stilt roots, which stay with the stump
  if (config.species.startsWith('swamp_mangrove') || config.barkStyle === 'swamp') {
    y = Math.max(y, (config.aerialRootHeight ?? 2.5) + 0.35);
  }
  return y;
}

/**
 * Creates the tree, and gives it an axe: see TreeInstance.fell.
 */
export function createTree(sourceConfig: TreeConfig): TreeInstance {
  if (sourceConfig.prop) return createGroundProps(sourceConfig, (sourceConfig as { flowerTexelsPerMetre?: number }).flowerTexelsPerMetre);
  if (sourceConfig.growthStage === 'rock') return createProceduralRock(sourceConfig);
  // A private copy, read live by every animation below: felling the tree
  // stills the wind on it (a trunk lying on the ground does not sway) without
  // touching the settings the panel shows.
  const config: TreeConfig = { ...sourceConfig };
  const tree = buildTree(config);
  // (what is already a log or a stump, or a plant on the ground, has nothing to fell)
  const canFell = config.growthStage !== 'log' && config.growthStage !== 'plant';

  const extraGeometries: THREE.BufferGeometry[] = [];
  const extraMaterials: THREE.Material[] = [];
  const extraTextures: THREE.Texture[] = [];
  let felled: { cut: CutResult; gap: number; start: number | null } | null = null;
  const FALL_SECONDS = 1.5;

  const update = (time: number) => {
    tree.update(time);
    if (!felled) return;
    if (felled.start === null) felled.start = time;
    const t = THREE.MathUtils.clamp((time - felled.start) / FALL_SECONDS, 0, 1);
    // it tips slowly, then falls faster and faster, as a real trunk does,
    // pivoting on the hinge at the edge of the cut...
    const tip = t * t;
    // ...and slides off the stump as it goes down, to lie beside it
    const slide = THREE.MathUtils.smoothstep(t, 0.35, 1);
    const { pivot, hingeX, cutY } = felled.cut;
    pivot.rotation.z = -Math.PI / 2 * tip;
    pivot.position.set(hingeX + felled.gap * slide, cutY * (1 - slide), 0);
  };

  const fell = (): FellInfo | null => {
    if (!canFell) return null;
    if (felled) return fellInfo(felled.cut, felled.gap);
    config.windStrength = 0;
    config.flutterStrength = 0;

    const isCactus = config.species.startsWith('gerudo_cactus') || config.foliageType === 'cactus_bloom';
    let endGrain: THREE.Material;
    if (isCactus) {
      endGrain = new THREE.MeshToonMaterial({ color: 0xb8d68a, emissive: 0x3a4a28 }); // pale green flesh
    } else {
      // pixel-art rings on a texel grid in metres (see endGrainMaterial)
      const grain = createPixelEndGrainMaterial(config);
      extraTextures.push(grain.palette);
      endGrain = grain.material;
    }
    extraMaterials.push(endGrain);

    const cut = cutTree(tree.group, cutHeightFor(config), endGrain, config.seed);
    extraGeometries.push(...cut.geometries);
    // far enough that the splinters of the two parts don't cross
    const gap = Math.max(0.35, cut.radius * 0.8, cut.depth + 0.3);
    felled = { cut, gap, start: null };

    // The island grows to hold the fallen tree. Its geometry is swapped for a
    // wider one rather than the mesh scaled: some grounds carry their grass
    // as children, which a scale would stretch flat.
    const need = cut.hingeX + gap + cut.topLength + 1.2;
    tree.group.traverse((o) => {
      if (o.name !== 'GroundMound') return;
      const mesh = o as THREE.Mesh;
      const p = (mesh.geometry as THREE.CylinderGeometry).parameters;
      if (!p || p.radiusTop >= need) return;
      const f = need / p.radiusTop;
      const wider = new THREE.CylinderGeometry(p.radiusTop * f, p.radiusBottom * f, p.height, Math.max(p.radialSegments, 48));
      extraGeometries.push(wider);
      mesh.geometry = wider;
    });
    return fellInfo(cut, gap);
  };

  return {
    ...tree,
    update,
    canFell,
    fell,
    dispose: () => {
      tree.dispose();
      extraGeometries.forEach((g) => g.dispose());
      extraMaterials.forEach((m) => m.dispose());
      extraTextures.forEach((t) => t.dispose());
    },
  };
}

function fellInfo(cut: CutResult, gap: number): FellInfo {
  const far = cut.hingeX + gap + cut.topLength;
  const near = -cut.radius * 1.5;
  return { centre: new THREE.Vector3((far + near) / 2, 0, 0), span: far - near };
}

// The ground, grass and stones a biome's bush stands on: the same as that
// biome's tree.
const SHRUB_BIOME: Record<string, string> = {
  // (and the ground plants and the new trees: where each one grows)
  arctic_willow: 'tundra',
  maple_red: 'maple',
  maple_orange: 'maple',
  maple_yellow: 'maple',
  fern_plant: 'korok_ancient',
  wildflower_patch: 'hyrule_oak',
  reed_clump: 'marsh',
  satori_shrub: 'satori_sakura',
  akkala_shrub: 'akkala_birch',
  hebra_shrub: 'hebra_pine',
  hebra_shrub_snowy: 'hebra_pine',
  faron_shrub: 'faron_palm',
  korok_shrub: 'korok_ancient',
  swamp_shrub: 'swamp_mangrove',
  savanna_shrub: 'savanna_acacia',
  withered_shrub: 'dry_withered',
};

/**
 * Creates a 100% procedural Zelda: Breath of the Wild style tree.
 * When useSpaceColonization is true (default), both the trunk and canopy are
 * grown entirely through the 3D Space Colonization Algorithm with Leonardo Da Vinci's
 * area-conserving pipe model, flared buttress roots, and Ghibli/BotW NPR cel-shading.
 */
function buildTree(config: TreeConfig): TreeInstance {
  const group = new THREE.Group();
  group.name = 'BotW_ProceduralTree';

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];
  const foliageMaterials: THREE.ShaderMaterial[] = [];
  let foliageUpdater: ((time: number) => void) | null = null;

  // Seeded PRNG
  let seed = config.seed;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // -------------------------------------------------------------
  // 1. LIGHTING & SHADER UNIFORMS (BOTW CEL-SHADING & RIM LIGHT)
  // -------------------------------------------------------------
  const sharedUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: config.windStrength },
    uWindSpeed: { value: config.windSpeed },
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
  };

  // -------------------------------------------------------------
  // SAPLINGS & SPROUTS (MUDAS / BROTOS DELICADOS & AUTÊNTICOS)
  // Mudas são compactas, simples, sem redes volumosas de galhos adultos
  // -------------------------------------------------------------
  if (config.growthStage === 'sapling' || config.species.endsWith('_sapling')) {
    const saplingResult = buildProceduralSapling(config, sharedUniforms);
    group.add(saplingResult.group);

    return {
      group,
      foliageMaterials: [],
      barkMaterial: new THREE.ShaderMaterial(),
      update: (time: number) => {
        saplingResult.update(time);
      },
      dispose: () => {
        saplingResult.geometriesToDispose.forEach((g) => g.dispose());
        saplingResult.materialsToDispose.forEach((m) => {
          if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
          else m.dispose();
        });
      },
    };
  }

  // -------------------------------------------------------------
  // 2. BARK MATERIAL (NPR CEL-SHADED BARK)
  // -------------------------------------------------------------
  const barkColor = new THREE.Color(config.barkColor);
  const barkDark = barkColor.clone().multiplyScalar(0.45);
  const mossColor = new THREE.Color(0x52793b);

  // Default path: procedural pixel art bark, shared by every wood mesh in the
  // tree (trunk, branches, buttress roots, stilt roots, deadwood, palm trunk),
  // so the transition between them stays coherent by construction.
  // Legacy path (pixelTextureEnabled: false): the original cel-shaded bark.
  const usePixelTextures = config.pixelTextureEnabled !== false;

  const barkMaterial = usePixelTextures
    ? createPixelBarkMaterial(config, sharedUniforms)
    : new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uBarkColor: { value: barkColor },
      uBarkDark: { value: barkDark },
      uMossColor: { value: mossColor },
      uMossAmount: { value: config.mossAmount },
      uRoughness: { value: config.barkRoughness },
      uTreeHeight: { value: config.trunkHeight },
      uRimIntensity: { value: config.rimLightIntensity },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vec3 pos = position;

        // Subtle trunk sway in strong wind, increasing with height
        float heightFactor = clamp(pos.y / 12.0, 0.0, 1.0);
        float trunkSway = sin(uTime * uWindSpeed * 1.2 + pos.y * 0.15) * 0.08 * uWindStrength * heightFactor;
        pos.x += trunkSway;
        pos.z += cos(uTime * uWindSpeed * 0.9 + pos.y * 0.15) * 0.05 * uWindStrength * heightFactor;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uLightDir;
      uniform vec3 uBarkColor;
      uniform vec3 uBarkDark;
      uniform vec3 uMossColor;
      uniform float uMossAmount;
      uniform float uRimIntensity;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(uLightDir);
        float NdotL = dot(N, L);

        // Cel Shading step bands (BotW aesthetic)
        float lightStep;
        if (NdotL > 0.25) {
          lightStep = 1.0;
        } else if (NdotL > -0.15) {
          lightStep = 0.65;
        } else {
          lightStep = 0.38;
        }

        // Procedural bark ring and grain texture
        float barkGrain = sin(vUv.y * 70.0) * 0.08 + sin(vUv.x * 24.0) * 0.05;
        vec3 baseBark = mix(uBarkDark, uBarkColor, clamp(lightStep + barkGrain, 0.0, 1.0));

        // BotW Base Moss gradient (heavier at roots and damp north-facing side)
        float heightFactor = clamp(1.0 - (vWorldPos.y / 4.0), 0.0, 1.0);
        float northFacing = clamp(dot(N, vec3(0.0, 0.2, -0.9)), 0.0, 1.0);
        float mossFactor = heightFactor * (0.6 + northFacing * 0.4) * uMossAmount;
        vec3 colorWithMoss = mix(baseBark, uMossColor, clamp(mossFactor, 0.0, 0.85));

        // Subtle Rim Lighting (Fresnel glow)
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = 1.0 - max(dot(V, N), 0.0);
        rim = pow(rim, 3.0) * uRimIntensity * 0.35;
        vec3 finalColor = colorWithMoss + vec3(0.9, 0.85, 0.7) * rim;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
  materialsToDispose.push(barkMaterial);

  // -------------------------------------------------------------
  // 3. FOLIAGE MATERIAL (BOTW NPR ANIME SHADER)
  // -------------------------------------------------------------
  const foliageColorTop = new THREE.Color(config.foliageColorTop);
  const foliageColorBottom = new THREE.Color(config.foliageColorBottom);

  const foliageMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uColorTop: { value: foliageColorTop },
      uColorBottom: { value: foliageColorBottom },
      uTreeHeight: { value: config.trunkHeight },
      uRimIntensity: { value: config.rimLightIntensity },
      uCelSteps: { value: config.celSteps },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;

      void main() {
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vLocalPos = position;

        vec3 pos = position;

        // BotW Wind flutter on leaf puffs
        float windWave = sin(uTime * uWindSpeed * 2.8 + pos.x * 1.5 + pos.y * 2.0) 
                       * cos(uTime * uWindSpeed * 1.7 + pos.z * 1.2);
        vec3 windOffset = normal * windWave * 0.12 * uWindStrength;
        
        // General tree sway
        float heightFactor = clamp(pos.y / 10.0, 0.0, 1.0);
        pos.x += sin(uTime * uWindSpeed * 1.5) * 0.2 * uWindStrength * heightFactor;
        pos.z += cos(uTime * uWindSpeed * 1.2) * 0.1 * uWindStrength * heightFactor;
        pos += windOffset;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uLightDir;
      uniform vec3 uColorTop;
      uniform vec3 uColorBottom;
      uniform float uTreeHeight;
      uniform float uRimIntensity;
      uniform float uCelSteps;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(uLightDir);
        float NdotL = dot(N, L);

        // Discrete stepped cel-shading (BotW / Ghibli NPR tone curve)
        float stepVal;
        if (uCelSteps > 3.5) {
          // 4 steps
          if (NdotL > 0.5) stepVal = 1.0;
          else if (NdotL > 0.15) stepVal = 0.75;
          else if (NdotL > -0.2) stepVal = 0.5;
          else stepVal = 0.3;
        } else if (uCelSteps > 2.5) {
          // 3 steps
          if (NdotL > 0.35) stepVal = 1.0;
          else if (NdotL > -0.15) stepVal = 0.65;
          else stepVal = 0.35;
        } else {
          // 2 steps
          if (NdotL > 0.1) stepVal = 1.0;
          else stepVal = 0.45;
        }

        // Vertical gradient: Sunlit canopy top vs deeper underbrush
        float heightGrad = clamp((vWorldPos.y - (uTreeHeight * 0.45)) / (uTreeHeight * 0.65), 0.0, 1.0);
        vec3 leafColor = mix(uColorBottom, uColorTop, heightGrad);

        // Internal clump curvature highlight
        float internalShade = clamp(vLocalPos.y * 0.25 + 0.5, 0.15, 1.0);
        leafColor *= (0.85 + internalShade * 0.2);

        // BotW Stylized painterly leaf clump dapple texture (micro-detail of leaves)
        float dapple1 = sin(vWorldPos.x * 5.0) * cos(vWorldPos.y * 5.0) * sin(vWorldPos.z * 5.0);
        float dapple2 = sin(vWorldPos.x * 12.0 + vWorldPos.z * 8.0) * 0.5;
        float leafDapple = (dapple1 * 0.7 + dapple2 * 0.3) * 0.08;
        leafColor += leafDapple;

        // Apply Cel Shading
        vec3 finalColor = leafColor * (stepVal * 0.85 + 0.2);

        // BotW Sky/Atmosphere Rim Lighting (Fresnel)
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = 1.0 - max(dot(V, N), 0.0);
        rim = pow(rim, 2.5) * uRimIntensity;
        
        // Soft golden/cyan sunlit rim glow
        vec3 rimColor = mix(vec3(1.0, 0.96, 0.75), vec3(0.75, 0.95, 1.0), heightGrad);
        finalColor += rimColor * rim * 0.65;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
  foliageMaterials.push(foliageMaterial);
  materialsToDispose.push(foliageMaterial);

  // -------------------------------------------------------------
  // 4. GENERATE FULL STRUCTURE (TRUNK, BRANCHES & FOLIAGE)
  // -------------------------------------------------------------
  const branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[] = [];
  let scaData: ReturnType<typeof runSpaceColonization> | null = null;
  // the broadleaf foliage, for the fruit to be set on (see buildHangingFruit)
  let fruitFoliage: THREE.Object3D | undefined;

  // logs and stumps: lying or standing dead wood, no crown at all
  const isLog = config.growthStage === 'log';
  let logResult: LogResult | null = null;
  // ground plants: fern, wildflowers, reeds
  const isPlant = config.growthStage === 'plant';
  let plantResult: GroundPlantResult | null = null;
  const texturesToDispose: THREE.Texture[] = [];

  const isPalm = !isLog && config.species.startsWith('faron_palm') || config.foliageType === 'palm_frond';
  const isPine = !isLog && config.species.startsWith('hebra_pine') || config.foliageType === 'pine_cone';
  const isCactus = !isLog && config.species.startsWith('gerudo_cactus') || config.foliageType === 'cactus_bloom';
  const isSwamp = !isLog && config.species.startsWith('swamp_mangrove') || config.foliageType === 'swamp_weeping' || config.barkStyle === 'swamp';
  // (a bare bush grows like any other bush, just without leaves)
  const isDeadwood = !isLog && !isPlant && config.growthStage !== 'shrub' &&
    (config.species.startsWith('dry_withered') || config.foliageType === 'none' || config.barkStyle === 'deadwood');

  if (isPlant) {
    plantResult = buildGroundPlant(config, sharedUniforms, rnd);
    group.add(plantResult.group);
    geometriesToDispose.push(...plantResult.geometries);
    materialsToDispose.push(...plantResult.materials);
    texturesToDispose.push(...plantResult.textures);
  } else if (isLog) {
    // The moss on the bark grows thickest low down and on surfaces facing
    // up; measured against a tree's height the whole log counts as "low",
    // so the moss settles on its top and flanks as it does on real logs.
    const barkUniforms = (barkMaterial as THREE.ShaderMaterial).uniforms;
    if (barkUniforms?.uTreeHeight) barkUniforms.uTreeHeight.value = 6;
    logResult = buildProceduralLog(config, barkMaterial, rnd);
    group.add(logResult.group);
    materialsToDispose.push(...logResult.materialsToDispose);
    geometriesToDispose.push(...logResult.geometriesToDispose);
    texturesToDispose.push(...logResult.texturesToDispose);
    branchTips.push(...logResult.branchTips);
  } else if (isPalm) {
    if (config.useSpaceColonization) {
      scaData = runSpaceColonization(config);
    }
    const palmResult = buildProceduralPalm(config, barkMaterial, sharedUniforms, rnd, scaData);
    group.add(palmResult.woodMesh);
    group.add(palmResult.foliageGroup);
    palmResult.materialsToDispose.forEach((m) => {
      if (Array.isArray(m)) m.forEach((mat) => materialsToDispose.push(mat));
      else materialsToDispose.push(m);
    });
    geometriesToDispose.push(...palmResult.geometriesToDispose);
    branchTips.push(...palmResult.branchTips);
    foliageUpdater = (time: number) => palmResult.update(time, config.windStrength, config.windSpeed);

    // 3D Visualizer for Space Colonization Attraction Points (Golden Orbs) when enabled for palm
    if (scaData && config.showAttractors && scaData.attractorPositions.length > 0) {
      const attractorGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(scaData.attractorPositions.length * 3);
      for (let i = 0; i < scaData.attractorPositions.length; i++) {
        const p = scaData.attractorPositions[i];
        posArray[i * 3] = p.x;
        posArray[i * 3 + 1] = p.y;
        posArray[i * 3 + 2] = p.z;
      }
      attractorGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const attractorMat = new THREE.PointsMaterial({
        color: 0xffd54f,
        size: 0.24,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
      });
      const attractorPointsMesh = new THREE.Points(attractorGeo, attractorMat);
      attractorPointsMesh.name = 'SCA_AttractorPoints';
      group.add(attractorPointsMesh);
      geometriesToDispose.push(attractorGeo);
      materialsToDispose.push(attractorMat);
    }
  } else if (isPine) {
    // each seed gets its own height, spread, tier count and (sometimes) lean
    const pineConfig = varyConiferConfig(config);
    if (config.useSpaceColonization) {
      scaData = runSpaceColonization(pineConfig, true);
    }

    const coniferResult = buildProceduralConifer(
      pineConfig,
      barkMaterial,
      sharedUniforms,
      rnd,
      scaData
    );

    group.add(coniferResult.woodMesh);
    group.add(coniferResult.foliageGroup);
    coniferResult.materialsToDispose.forEach((material) => {
      if (Array.isArray(material)) {
        material.forEach((entry) => materialsToDispose.push(entry));
      } else {
        materialsToDispose.push(material);
      }
    });
    coniferResult.geometriesToDispose.forEach((geometry) => geometriesToDispose.push(geometry));
    coniferResult.branchTips.forEach((tip) => branchTips.push(tip));
    foliageUpdater = (time: number) =>
      coniferResult.update(time, config.windStrength, config.windSpeed);

    if (scaData && config.showAttractors && scaData.attractorPositions.length > 0) {
      const attractorGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(scaData.attractorPositions.length * 3);
      for (let i = 0; i < scaData.attractorPositions.length; i++) {
        const p = scaData.attractorPositions[i];
        posArray[i * 3] = p.x;
        posArray[i * 3 + 1] = p.y;
        posArray[i * 3 + 2] = p.z;
      }
      attractorGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const attractorMat = new THREE.PointsMaterial({
        color: 0xffd54f,
        size: 0.24,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
      });
      const attractorPointsMesh = new THREE.Points(attractorGeo, attractorMat);
      attractorPointsMesh.name = 'SCA_AttractorPoints';
      group.add(attractorPointsMesh);
      geometriesToDispose.push(attractorGeo);
      materialsToDispose.push(attractorMat);
    }
  } else if (isCactus) {
    if (config.useSpaceColonization) {
      scaData = runSpaceColonization(config);
    }

    const cactusResult = buildProceduralCactus(
      config,
      barkMaterial,
      sharedUniforms,
      rnd,
      scaData
    );

    group.add(cactusResult.woodMesh);
    group.add(cactusResult.foliageGroup);
    cactusResult.materialsToDispose.forEach((material) => {
      if (Array.isArray(material)) {
        material.forEach((entry) => materialsToDispose.push(entry));
      } else {
        materialsToDispose.push(material);
      }
    });
    cactusResult.geometriesToDispose.forEach((geometry) => geometriesToDispose.push(geometry));
    cactusResult.branchTips.forEach((tip) => branchTips.push(tip));
    foliageUpdater = (time: number) =>
      cactusResult.update(time, config.windStrength, config.windSpeed);

    if (scaData && config.showAttractors && scaData.attractorPositions.length > 0) {
      const attractorGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(scaData.attractorPositions.length * 3);
      for (let i = 0; i < scaData.attractorPositions.length; i++) {
        const p = scaData.attractorPositions[i];
        posArray[i * 3] = p.x;
        posArray[i * 3 + 1] = p.y;
        posArray[i * 3 + 2] = p.z;
      }
      attractorGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const attractorMat = new THREE.PointsMaterial({
        color: 0xffd54f,
        size: 0.24,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
      });
      const attractorPointsMesh = new THREE.Points(attractorGeo, attractorMat);
      attractorPointsMesh.name = 'SCA_AttractorPoints';
      group.add(attractorPointsMesh);
      geometriesToDispose.push(attractorGeo);
      materialsToDispose.push(attractorMat);
    }
  } else if (isDeadwood) {
    if (config.useSpaceColonization) {
      scaData = runSpaceColonization(config);
    }

    const deadwoodResult = buildProceduralDeadwood(
      config,
      barkMaterial,
      sharedUniforms,
      rnd,
      scaData
    );

    group.add(deadwoodResult.woodMesh);
    group.add(deadwoodResult.foliageGroup);
    deadwoodResult.materialsToDispose.forEach((material) => {
      if (Array.isArray(material)) {
        material.forEach((entry) => materialsToDispose.push(entry));
      } else {
        materialsToDispose.push(material);
      }
    });
    deadwoodResult.geometriesToDispose.forEach((geometry) => geometriesToDispose.push(geometry));
    deadwoodResult.branchTips.forEach((tip) => branchTips.push(tip));
    foliageUpdater = (time: number) =>
      deadwoodResult.update(time, config.windStrength, config.windSpeed);

    if (scaData && config.showAttractors && scaData.attractorPositions.length > 0) {
      const attractorGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(scaData.attractorPositions.length * 3);
      for (let i = 0; i < scaData.attractorPositions.length; i++) {
        const p = scaData.attractorPositions[i];
        posArray[i * 3] = p.x;
        posArray[i * 3 + 1] = p.y;
        posArray[i * 3 + 2] = p.z;
      }
      attractorGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const attractorMat = new THREE.PointsMaterial({
        color: 0xffd54f,
        size: 0.24,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
      });
      const attractorPointsMesh = new THREE.Points(attractorGeo, attractorMat);
      attractorPointsMesh.name = 'SCA_AttractorPoints';
      group.add(attractorPointsMesh);
      geometriesToDispose.push(attractorGeo);
      materialsToDispose.push(attractorMat);
    }
  } else {
    // -------------------------------------------------------------
    // PURE 3D SPACE COLONIZATION (TRUNK + BRANCHES + CANOPY)
    // Used for Oak, Sakura, Birch, Korok, and Swamp Mangrove!
    // -------------------------------------------------------------
    scaData = runSpaceColonization(config);

    // Build unified continuous trunk + branch mesh (seamless welded chains)
    const treeGeo = buildFullTreeGeometry(
      scaData.rootNode,
      config.growthStage === 'shrub' ? 8 : 12,
      config.rootSpread,
      config.trunkTwist,
      isSwamp,
      true,
      // a bush's twigs are drawn much finer than a tree's
      config.growthStage === 'shrub' ? 0.006 : 0.025
    );

    // The full broadleaf crowns (oak, sakura, birch, Korok) wrap their limbs
    // in foliage, so the wood inside is in shade, as the pine's is: turn on
    // the bark shader's crown shade with this tree's own crown, as a rounded
    // mass. Not for the open crowns - the mangrove's rosettes and the
    // acacia's thin plates hide little of their wood.
    const barkUniforms = (barkMaterial as THREE.ShaderMaterial).uniforms;
    const openCrown = isSwamp || config.scaCrownShape === 'flat_top';
    if (barkUniforms?.uCrownShade && !openCrown) {
      // (a bush is thin inside: light gets in among its stems)
      barkUniforms.uCrownShade.value = config.growthStage === 'shrub' ? 0.45 : 0.8;
      barkUniforms.uCrownEllipsoid.value = 1;
      barkUniforms.uCrownCenterY.value = scaData.crownCenter.y;
      barkUniforms.uCrownRadius.value = (scaData.crownRadiusX + scaData.crownRadiusZ) * 0.5;
      barkUniforms.uCrownRadiusY.value = scaData.crownRadiusY;
    }

    const fullTreeMesh = new THREE.Mesh(treeGeo, barkMaterial);
    fullTreeMesh.name = 'ProceduralTreeWood';
    fullTreeMesh.castShadow = true;
    fullTreeMesh.receiveShadow = true;
    group.add(fullTreeMesh);
    geometriesToDispose.push(treeGeo);

    // Collect branch tips from leaf nodes for apples and accessories
    scaData.leafNodes.forEach((leaf) => {
      branchTips.push({
        position: leaf.position,
        normal: leaf.dir,
        scale: 1.0,
      });
    });

    // If Swamp Mangrove species: add proportional stilt roots, bracket fungi, and swamp pool
    if (isSwamp) {
      const swampAcc = buildSwampRootsAndAccessories(
        config,
        scaData,
        barkMaterial,
        sharedUniforms,
        branchTips,
        rnd
      );
      group.add(swampAcc.group);
      swampAcc.materialsToDispose.forEach((m) => {
        if (Array.isArray(m)) m.forEach((mat) => materialsToDispose.push(mat));
        else materialsToDispose.push(m);
      });
      geometriesToDispose.push(...swampAcc.geometriesToDispose);
      const prevUpdater = foliageUpdater;
      foliageUpdater = (time: number) => {
        if (prevUpdater) prevUpdater(time);
        swampAcc.update(time, config.windStrength, config.windSpeed);
      };
    }

    // 3D Visualizer for Space Colonization Attraction Points (Golden Orbs)
    if (config.showAttractors && scaData.attractorPositions.length > 0) {
      const attractorGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(scaData.attractorPositions.length * 3);
      for (let i = 0; i < scaData.attractorPositions.length; i++) {
        const p = scaData.attractorPositions[i];
        posArray[i * 3] = p.x;
        posArray[i * 3 + 1] = p.y;
        posArray[i * 3 + 2] = p.z;
      }
      attractorGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const attractorMat = new THREE.PointsMaterial({
        color: 0xffd54f,
        size: 0.24,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
      });
      const attractorPointsMesh = new THREE.Points(attractorGeo, attractorMat);
      attractorPointsMesh.name = 'SCA_AttractorPoints';
      group.add(attractorPointsMesh);
      geometriesToDispose.push(attractorGeo);
      materialsToDispose.push(attractorMat);
    }

  // -------------------------------------------------------------
  // 5. GENERATE FOLIAGE (BOTW VOLUMETRIC CLOUDS & STYLIZED CANOPY)
  // -------------------------------------------------------------
  const foliageGroup = new THREE.Group();
  foliageGroup.name = 'BotW_FoliageCanopy';

  if (!isPalm && (config.foliageType === 'cloud' || config.foliageType === 'pine_cone' || config.foliageType === 'swamp_weeping')) {
    const crownCenter = scaData?.crownCenter ?? new THREE.Vector3(0, config.trunkHeight * 0.85, 0);
    const isPineSpecies = config.species.startsWith('hebra_pine') || config.foliageType === 'pine_cone';
    const minBranchH = isPineSpecies ? 0.20 : 0.48;
    const branchStartRatio = Math.max(minBranchH, config.branchStartHeight ?? minBranchH);
    const crownBottomY = scaData ? scaData.crownBottomY : config.trunkHeight * branchStartRatio;
    const crownBounds: CrownBounds = {
      bottomY: crownBottomY,
      topY: scaData ? scaData.crownTopY : config.trunkHeight + (config.crownHeight ?? 4.5),
      centerY: crownCenter.y,
      radiusX: scaData ? scaData.crownRadiusX : ((config.branchLength ?? 4.0) * 0.95 + 1.2) * (config.canopySpread ?? 1.15),
      radiusZ: scaData ? scaData.crownRadiusZ : ((config.branchLength ?? 4.0) * 0.95 + 1.2) * (config.canopySpread ?? 1.15),
      radiusY: scaData ? scaData.crownRadiusY : (config.crownHeight ?? 4.5),
      shape: config.scaCrownShape ?? (isPineSpecies ? 'conical' : 'dome'),
    };

    const foliageNodes: SCANode[] = scaData ? [...scaData.allNodes] : [];
    if (foliageNodes.length === 0) {
      branchTips.forEach((tip, idx) => {
        foliageNodes.push({
          id: idx,
          position: tip.position.clone(),
          parent: null,
          children: [],
          dir: tip.normal.clone(),
          radius: config.trunkRadiusTop,
          depth: 1,
          isLeaf: true,
          isTrunk: false,
        });
      });
    }

    if (isSwamp && scaData) {
      const rosetteResult = buildStylizedMangroveCanopy(config, scaData, sharedUniforms, rnd);
      foliageGroup.add(rosetteResult.mesh);
      foliageMaterials.push(rosetteResult.material);
      materialsToDispose.push(rosetteResult.material);
      geometriesToDispose.push(...rosetteResult.geometriesToDispose);

      const swampFoliageUpdater = (time: number) => {
        rosetteResult.update(time, config.windStrength, config.windSpeed);
      };
      if (foliageUpdater) {
        const prev = foliageUpdater;
        foliageUpdater = (time: number) => {
          prev(time);
          swampFoliageUpdater(time);
        };
      } else {
        foliageUpdater = swampFoliageUpdater;
      }
    } else {
      const foliageResult = buildProceduralFoliage(config, foliageNodes, crownBounds);
      foliageGroup.add(foliageResult.instancedMesh);
      foliageMaterials.push(foliageResult.foliageMaterial);
      const baseFoliageUpdater = foliageResult.update;
      if (foliageUpdater) {
        const prev = foliageUpdater;
        foliageUpdater = (time: number) => {
          prev(time);
          baseFoliageUpdater(time);
        };
      } else {
        foliageUpdater = baseFoliageUpdater;
      }
      materialsToDispose.push(foliageResult.foliageMaterial);
      geometriesToDispose.push(foliageResult.instancedMesh.geometry);
    }
  }

  group.add(foliageGroup);
  fruitFoliage = foliageGroup;
  }

  // -------------------------------------------------------------
  // 6. BOTW ACCENTS (Apples, Mushrooms)
  // -------------------------------------------------------------

  // Fruit (not on the palm: it grows its own coconuts)
  if (config.showApples && config.appleCount > 0 && !isCactus && !isSwamp && !isPalm) {
    if (scaData) {
      // Bushes carry clusters of berries or flowers instead (the count on the
      // panel is then the number of clusters of three).
      const accent = config.growthStage === 'shrub' ? config.bushAccent : undefined;
      const fruit = buildHangingFruit(
        config,
        scaData,
        sharedUniforms,
        accent ? config.appleCount * 3 : config.appleCount,
        rnd,
        accent === 'berries'
          ? { radius: 0.055, color: config.accentColor ?? '#b0203a', perCluster: 3 }
          : accent === 'flowers'
          ? { radius: 0.09, color: config.accentColor ?? '#f28ab8', perCluster: 3, kind: 'flower' }
          : {
              // sized to the crown, so the apples still read on a big tree
              radius: THREE.MathUtils.clamp(scaData.crownRadiusX * 0.045, 0.18, 0.3),
              color: '#d8342b',
            },
        fruitFoliage
      );
      group.add(fruit.group);
      geometriesToDispose.push(...fruit.geometries);
      materialsToDispose.push(...fruit.materials);
      texturesToDispose.push(...fruit.textures);
    }
  }

  // Mushrooms and bracket fungi at the trunk.
  //
  // A capped mushroom is drawn standing up, so it can only stand on something
  // level: on the vertical bark, seen from the side, it stood beside the trunk
  // touching it at one corner of its foot. So the capped ones grow in little
  // clumps on the ground against the foot of the trunk, and the bark carries
  // bracket fungi, which really do grow out sideways and are drawn in profile.
  // (logs grow their own bracket fungi and toadstools)
  if (config.showMushrooms && config.mushroomCount > 0 && !isSwamp && !isLog && !isPlant) {
    // A mixed patch: every mushroom picks its own cap colour (the sacred
    // grove leans to the cool ones). One material per colour in use.
    const caps = config.species.startsWith('satori_sakura')
      ? MUSHROOM_CAPS.filter((c) => ['#3aa7e0', '#8e4fc4', '#e56a9a', '#d8b27a'].includes(c.color))
      : MUSHROOM_CAPS;
    const shroomMats = new Map<number, THREE.SpriteMaterial>();
    const shroomMatFor = (i: number) => {
      let m = shroomMats.get(i);
      if (!m) {
        m = spriteMaterial(mushroomSprite(caps[i].color, caps[i].spots));
        shroomMats.set(i, m);
        materialsToDispose.push(m);
      }
      return m;
    };
    const shelfColors: [string, string][] = [
      ['#e0923e', '#f3dfb4'],
      ['#b8743a', '#ecd2a4'],
      ['#d8b27a', '#f5ead0'],
      ['#c8553a', '#f0d0b0'],
    ];
    const shelfMats = new Map<number, THREE.SpriteMaterial>();
    const shelfMatFor = (i: number) => {
      let m = shelfMats.get(i);
      if (!m) {
        m = spriteMaterial(bracketSprite(shelfColors[i][0], shelfColors[i][1]));
        shelfMats.set(i, m);
        materialsToDispose.push(m);
      }
      return m;
    };

    // Everything sits on the bark that is actually RENDERED. The node radius
    // is not that surface - the mesh is tapered, flared at the foot and, on
    // some species, rebuilt with its own radii. A ray cast in toward the
    // trunk finds the real surface and its normal instead.
    const woodMeshes = group.children.filter(
      (o) => (o as THREE.Mesh).isMesh && /Wood|Trunk|Fork/i.test(o.name)
    ) as THREE.Mesh[];
    group.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const barkAt = (axisPoint: THREE.Vector3, around: THREE.Vector3, guess: number) => {
      let surface = axisPoint.clone().addScaledVector(around, guess);
      let outward = around.clone();
      if (woodMeshes.length > 0) {
        raycaster.set(axisPoint.clone().addScaledVector(around, 8), around.clone().negate());
        raycaster.far = 8.5;
        const hit = raycaster.intersectObjects(woodMeshes, false)[0];
        if (hit) {
          surface = hit.point.clone();
          if (hit.face) {
            const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            n.y *= 0.3; // mostly horizontal: bark normals near a flare tip up and down
            if (n.lengthSq() > 1e-6 && n.normalize().dot(around) > 0.2) outward = n;
          }
        }
      }
      return { surface, outward };
    };

    const trunkNodes = scaData ? scaData.allNodes.filter((n) => n.isTrunk) : [];
    const foot = trunkNodes.length > 0
      ? trunkNodes.reduce((a, b) => (b.position.y < a.position.y ? b : a)).position
      : new THREE.Vector3();
    const trunkUpperNodes = trunkNodes.filter(
      (n) => n.position.y >= 0.8 && n.position.y <= config.trunkHeight * 0.4
    );

    // about a third of the count as brackets on the bark, the rest on the ground
    const shelfCount = config.mushroomCount >= 3 ? Math.round(config.mushroomCount / 3) : 0;
    const groundCount = config.mushroomCount - shelfCount;

    // -- clumps of capped mushrooms at the foot of the trunk -----------------
    let placed = 0;
    let clump = 0;
    while (placed < groundCount) {
      const clumpAngle = clump * 2.39996 + rnd() * 0.4;
      const inClump = Math.min(groundCount - placed, 2 + Math.floor(rnd() * 2));
      for (let k = 0; k < inClump; k++, placed++) {
        const angle = clumpAngle + (k - (inClump - 1) / 2) * 0.16 + (rnd() - 0.5) * 0.06;
        const around = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        // where the bark (or the root flare) meets the ground on this side
        const { surface, outward } = barkAt(
          new THREE.Vector3(foot.x, 0.12, foot.z),
          around,
          config.trunkRadiusBase * 1.1
        );
        const at = surface.clone().addScaledVector(around, 0.05 + rnd() * 0.22);
        at.y = -0.02; // foot in the soil
        const cap = Math.floor(rnd() * caps.length);
        const fungus = treeMushroomCard(shroomMatFor(cap).map!, (0.34 + rnd() * 0.26) * (k === 0 ? 1.15 : 1), MUSHROOM_FOOT, at, outward);
        const holder = fungus.holder;
        geometriesToDispose.push(fungus.geometry); materialsToDispose.push(fungus.material);
        holder.userData.ground = true;   // stays with the stump when the tree is felled
        group.add(holder);
      }
      clump++;
    }

    // -- bracket fungi out of the bark ---------------------------------------
    for (let m = 0; m < shelfCount; m++) {
      const angle = (m * 2.39996 + 1.3) % (Math.PI * 2);
      const around = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const node = trunkUpperNodes.length > 0 ? trunkUpperNodes[(m * 3) % trunkUpperNodes.length] : null;
      const axisPoint = node ? node.position.clone() : new THREE.Vector3(foot.x, 1.0 + m * 0.5, foot.z);
      const { surface, outward } = barkAt(axisPoint, around, node ? node.radius : config.trunkRadiusBase * 0.82);
      const shelf = treeMushroomCard(shelfMatFor(Math.floor(rnd() * shelfColors.length)).map!, 0.45 + rnd() * 0.2, new THREE.Vector2(0.5, 0.5), surface, outward);
      geometriesToDispose.push(shelf.geometry); materialsToDispose.push(shelf.material);
      group.add(shelf.holder);
    }
  }

  // -------------------------------------------------------------
  // 7. PEDESTAL & HYRULE GROUND ISLAND (ILHA DE TERRA E RAÍZES BOTW)
  // -------------------------------------------------------------
  // a bush stands on a small island of its own size
  const isShrubGround = config.growthStage === 'shrub' || isPlant;
  // A biome's bush stands on the same ground as that biome's tree.
  const biome = SHRUB_BIOME[config.species] ?? config.species;
  const moundRadius = logResult
    ? Math.max(2.8, logResult.extent + 0.9)
    : isPlant
    ? 2.2
    : isShrubGround
    ? 2.6
    : Math.max(config.rootSpread * 3.8 + config.trunkRadiusBase + 2.5, 5.0);
  const moundDepth = isShrubGround || logResult ? 0.6 : 1.2;
  const moundGeo = new THREE.CylinderGeometry(moundRadius, moundRadius * 1.15, moundDepth, 32);
  
  // Snow cover (the snowy pine) whitens the whole island.
  const isSnowyGround = (config.snowCover ?? 0) > 0.05;
  const moundColor = isSnowyGround
    ? 0xe4edf6 // Hebra snowfield
    : biome.startsWith('desert_shrub')
    ? 0xd4a359 // Gerudo sand
    : biome.startsWith('savanna_acacia')
    ? 0xc09a58 // Savanna red-gold earth
    : biome.startsWith('hebra_pine')
    ? 0x5a4838 // Alpine cold earth
    : biome.startsWith('satori_sakura')
    ? 0x4e8555 // Satori Mountain sacred grove green
    : biome.startsWith('gerudo_cactus')
    ? 0xd4a359 // Gerudo Desert dunes
    : biome.startsWith('faron_palm')
    ? 0xc2a66e // Coastal sand
    : biome.startsWith('swamp_mangrove')
    ? 0x2e271f // Swamp marsh mud
    : biome.startsWith('dry_withered')
    ? 0x6e5c49 // Arid scorched steppe soil
    : biome === 'tundra'
    ? 0x7b7d62 // Cold tundra: grey-olive moss and lichen
    : biome === 'maple'
    ? 0x7d5a31 // Autumn forest floor, deep in fallen leaves
    : biome === 'marsh'
    ? 0x4a4630 // Damp mud at the water's edge
    : 0x588e36; // Lush Hyrule field green

  const moundMat = new THREE.MeshToonMaterial({
    color: moundColor,
  });
  const mound = new THREE.Mesh(moundGeo, moundMat);
  mound.position.set(0, -moundDepth / 2, 0);
  mound.receiveShadow = true;
  mound.name = 'GroundMound';
  mound.userData.ground = true;
  group.add(mound);
  geometriesToDispose.push(moundGeo);
  materialsToDispose.push(moundMat);

  // Stylized 3D Tapered Grass Tufts around the base (curved BotW grass blades)
  const isCactusOrPalm = biome.startsWith('gerudo_cactus') || biome.startsWith('faron_palm');
  if (!isCactusOrPalm && !isSnowyGround) {
    const tuftShape = new THREE.Shape();
    tuftShape.moveTo(-0.06, 0);
    tuftShape.lineTo(0.06, 0);
    tuftShape.quadraticCurveTo(0.05, 0.25, 0.0, 0.42);
    tuftShape.quadraticCurveTo(-0.05, 0.25, -0.06, 0);
    const grassBladeGeo = new THREE.ShapeGeometry(tuftShape);
    
    const grassBladeMat = new THREE.MeshToonMaterial({
      color: biome.startsWith('satori_sakura')
        ? 0x81c784
        : biome.startsWith('savanna_acacia')
        ? 0xd8bd62 // Tall golden savanna grass
        : biome.startsWith('dry_withered') || biome.startsWith('desert_shrub')
        ? 0xa89368 // Dry golden savannah grass
        : biome.startsWith('hebra_pine')
        ? 0x6e9970
        : biome === 'tundra'
        ? 0x9aa17a // Pale tundra sedge
        : biome === 'maple'
        ? 0xc98a3a // Autumn grass, gone gold
        : biome === 'marsh'
        ? 0x6f9a44 // Lush marsh grass
        : 0x7cb342, // Vibrant Hyrule green
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(grassBladeMat);
    geometriesToDispose.push(grassBladeGeo);

    const grassTuftCount = logResult
      ? 28 // grass grows up all round the fallen wood
      : biome.startsWith('dry_withered')
      ? 10
      : biome.startsWith('savanna_acacia') ? 30 : 18; // savanna: grassland all round
    for (let g = 0; g < grassTuftCount; g++) {
      const grAngle = rnd() * Math.PI * 2;
      const grDist = logResult
        ? 0.5 + rnd() * (moundRadius * 0.8)
        : isShrubGround
        ? 0.9 + rnd() * (moundRadius * 0.6)                         // round the bush, not under it
        : config.trunkRadiusBase * 1.2 + 0.4 + rnd() * (moundRadius * 0.7);
      const tuft = new THREE.Group();
      tuft.userData.ground = true;
      tuft.position.set(Math.cos(grAngle) * grDist, 0.0, Math.sin(grAngle) * grDist);
      // not through the log (or the plant): grass grows round it instead
      if (logResult && logResult.occupies(tuft.position.x, tuft.position.z)) continue;
      if (plantResult && plantResult.occupies(tuft.position.x, tuft.position.z)) continue;

      // 3 blades per cluster
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(grassBladeGeo, grassBladeMat);
        blade.rotation.y = (b / 3) * Math.PI + (rnd() - 0.5) * 0.4;
        blade.rotation.x = 0.12 + (rnd() - 0.5) * 0.15;
        const bladeScale = isShrubGround ? 0.55 : logResult ? 0.75 : 1;
        blade.scale.set((0.8 + rnd() * 0.5) * bladeScale, (0.8 + rnd() * 0.5) * bladeScale, (0.8 + rnd() * 0.5) * bladeScale);
        blade.castShadow = true;
        tuft.add(blade);
      }
      tuft.rotation.y = rnd() * Math.PI * 2;
      group.add(tuft);
    }

    // Weathered stones by the roots of the dry tree: pixel-art boulders,
    // seeded - some trees have none, others a cluster or three.
    if (biome.startsWith('dry_withered')) {
      const rocks = buildPixelRocks(config, {
        color: '#8c8171',
        mossColor: '#a39a55',          // dry ochre lichen, not green moss
        moss: 0.18,
        chance: 0.6,
        maxClusters: 3,
        scale: isShrubGround ? 0.5 : 1,
        minDist: isShrubGround ? 0.7 : config.trunkRadiusBase * 1.4 + 0.4,
        maxDist: isShrubGround ? 1.5 : Math.min(moundRadius - 0.8, config.trunkRadiusBase * 1.4 + 2.2),
      });
      group.add(rocks.group);
      geometriesToDispose.push(...rocks.geometries);
      materialsToDispose.push(...rocks.materials);
      texturesToDispose.push(...rocks.textures);
    }
  }

  // Snowy ground: a few dark stones break up the white, each wearing a cap of
  // the same snow.
  if (isSnowyGround) {
    const stoneMat = new THREE.MeshToonMaterial({ color: 0x5f6670 });
    const capMat = new THREE.MeshToonMaterial({ color: 0xf2f7fc });
    materialsToDispose.push(stoneMat, capMat);
    for (let s = 0; s < 6; s++) {
      const stoneR = (0.25 + rnd() * 0.3) * (isShrubGround ? 0.45 : 1);
      const stoneGeo = new THREE.DodecahedronGeometry(stoneR, 0);
      geometriesToDispose.push(stoneGeo);
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      const sAngle = (s / 6) * Math.PI * 2 + rnd() * 0.6;
      const sDist = isShrubGround
        ? 1.0 + rnd() * 0.9
        : config.trunkRadiusBase * 1.4 + 0.6 + rnd() * (moundRadius * 0.55);
      stone.position.set(Math.cos(sAngle) * sDist, stoneR * 0.3 - 0.05, Math.sin(sAngle) * sDist);
      stone.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
      stone.scale.set(1.25, 0.7, 1.0);
      stone.castShadow = true;
      stone.receiveShadow = true;
      stone.userData.ground = true;
      group.add(stone);

      const cap = new THREE.Mesh(stoneGeo, capMat);
      cap.position.copy(stone.position);
      cap.position.y += stoneR * 0.42;
      cap.rotation.y = rnd() * Math.PI;
      cap.scale.set(1.05, 0.28, 0.85);
      cap.receiveShadow = true;
      cap.userData.ground = true;
      group.add(cap);
    }
  }

  // -------------------------------------------------------------
  // ANIMATION LOOP & DISPOSAL
  // -------------------------------------------------------------
  const update = (time: number) => {
    sharedUniforms.uTime.value = time;
    sharedUniforms.uWindStrength.value = config.windStrength;
    sharedUniforms.uWindSpeed.value = config.windSpeed;

    if (foliageUpdater) {
      foliageUpdater(time);
    }

  };

  const dispose = () => {
    geometriesToDispose.forEach((g) => g.dispose());
    materialsToDispose.forEach((m) => m.dispose());
    texturesToDispose.forEach((t) => t.dispose());
    foliageMaterials.forEach((m) => m.dispose());
  };

  return {
    group,
    foliageMaterials,
    barkMaterial,
    update,
    dispose,
  };
}
export { WOOD_LOD } from './spaceColonization';
