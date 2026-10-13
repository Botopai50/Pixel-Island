// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import {
  buildFullTreeGeometry,
  runSpaceColonization,
  WOOD_LOD,
} from './spaceColonization';
import type { SCANode, SCATreeData } from './spaceColonization';
import { generateLeafAtlasTexture } from './foliageSystem';
import { createPixelConiferMaterial } from './pixelArtTextureSystem';

// Share of the OPTIONAL needle tufts dropped from the crown (see the thinning
// note in buildSCAConiferFoliageGeometry). The leader, branch-root and
// branch-tip tufts are always kept, so 0.41 here removes about 30% of all
// the needle sprays.
const CONIFER_THINNING = 0.41;

/**
 * Per-seed shape variation for a conifer, applied ON TOP of the configured
 * values (so every slider still means what it says): a pine is otherwise the
 * least varied tree in the set, every seed the same upright cone.
 *  - height x0.82 .. x1.20, crown spread x0.88 .. x1.12, one branch tier more
 *    or fewer;
 *  - about one seed in three leans: the whole tree bends progressively to one
 *    side toward the top, like a pine shaped by wind (see coniferLean).
 * An explicitly set coniferLean / coniferLeanAngle is left alone.
 */
export function varyConiferConfig(config: TreeConfig): TreeConfig {
  const s = config.seed ?? 0;
  const h = (k: number) => Math.abs(Math.sin((s + 1) * 12.9898 + k * 78.233) * 43758.5453) % 1;
  const tierRoll = h(3);
  const tierShift = tierRoll < 0.33 ? -1 : tierRoll > 0.66 ? 1 : 0;
  const leans = h(4) < 0.35;
  return {
    ...config,
    trunkHeight: config.trunkHeight * (0.82 + h(1) * 0.38),
    canopySpread: (config.canopySpread ?? 1) * (0.88 + h(2) * 0.24),
    branchCount: Math.max(8, Math.min(13, Math.round((config.branchCount ?? 10) + tierShift))),
    coniferLean: config.coniferLean ?? (leans ? 0.45 + h(5) * 0.55 : 0),
    coniferLeanAngle: config.coniferLeanAngle ?? h(6) * Math.PI * 2,
  };
}

/** Deterministic 0..1 per tuft, for the small yaw that breaks up the skirts. */
function tuftYawHash(nodeId: number, seed: number): number {
  return Math.abs(Math.sin((nodeId + 3) * 91.337 + seed * 0.0271) * 43758.5453) % 1;
}

export interface ConiferResult {
  woodMesh: THREE.Mesh;
  foliageGroup: THREE.Group;
  materialsToDispose: (THREE.Material | THREE.Material[])[];
  geometriesToDispose: THREE.BufferGeometry[];
  branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[];
  update: (time: number, windStrength: number, windSpeed: number) => void;
}

/**
 * Builds thousands of short, overlapping needle sprays directly on SCA nodes.
 * Each disconnected patch remains a small tuft; no wide foliage plate can cross the crown.
 */
function buildSCAConiferFoliageGeometry(
  config: TreeConfig,
  treeData: SCATreeData,
  rnd: () => number
): THREE.BufferGeometry {
  const crownHeight = Math.max(0.01, treeData.crownTopY - treeData.crownBottomY);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Per-spray data for the pixel needle shader (constant over each quad):
  // depth across the cone's tier at that height, and a per-tuft tone offset.
  const crownDepths: number[] = [];
  const shades: number[] = [];
  const worldUp = new THREE.Vector3(0, 1, 0);

  // The leader (trunk) as a polyline. "Outward" and "deep inside the tier" are
  // measured from the trunk at each height, not from the vertical axis: a
  // leaning pine's trunk is metres off that axis near the top.
  const leader = treeData.allNodes
    .filter((n) => n.isTrunk)
    .sort((a, b) => a.position.y - b.position.y);
  const leaderPointAt = (y: number): THREE.Vector3 => {
    if (leader.length === 0) return new THREE.Vector3(0, y, 0);
    for (let i = 1; i < leader.length; i++) {
      if (leader[i].position.y >= y) {
        const a = leader[i - 1].position, b = leader[i].position;
        const f = THREE.MathUtils.clamp((y - a.y) / Math.max(1e-4, b.y - a.y), 0, 1);
        return a.clone().lerp(b, f);
      }
    }
    return leader[leader.length - 1].position.clone();
  };

  function appendNeedleSpray(
    node: SCANode,
    direction: THREE.Vector3,
    length: number,
    width: number,
    phase: number,
    widthMultiplier: number,
    crownDepth: number,
    shade: number
  ) {
    for (let k = 0; k < 4; k++) {
      crownDepths.push(crownDepth);
      shades.push(shade);
    }
    const side = new THREE.Vector3().crossVectors(direction, worldUp);
    if (side.lengthSq() < 1e-5) side.set(Math.cos(phase), 0, Math.sin(phase));
    side.normalize().applyAxisAngle(direction, phase * 0.18);

    const surfaceNormal = new THREE.Vector3().crossVectors(side, direction).normalize();
    if (surfaceNormal.y < 0) surfaceNormal.negate();
    surfaceNormal.lerp(worldUp, 0.5).normalize();
    const vertexOffset = positions.length / 3;
    const root = node.position.clone().addScaledVector(direction, -length * 0.18);
    const tip = node.position.clone().addScaledVector(direction, length * 0.82);
    tip.y -= length * 0.16 * config.branchAngle;
    const halfWidth = width * widthMultiplier
      * (0.92 + Math.sin(node.id * 1.71 + phase) * 0.08)
      * 0.5;

    const corners = [
      root.clone().addScaledVector(side, -halfWidth),
      root.clone().addScaledVector(side, halfWidth),
      tip.clone().addScaledVector(side, -halfWidth),
      tip.clone().addScaledVector(side, halfWidth),
    ];
    corners.forEach((vertex) => {
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z);
    });
    const atlasIndex = Math.abs(Math.floor(node.id + phase)) % 8;
    const atlasColumn = atlasIndex % 4;
    const atlasRow = Math.floor(atlasIndex / 4);
    const u0 = (atlasColumn + 0.008) * 0.25;
    const u1 = (atlasColumn + 0.992) * 0.25;
    const v0 = (1 - atlasRow + 0.008) * 0.5;
    const v1 = (1 - atlasRow + 0.992) * 0.5;
    uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
    indices.push(
      vertexOffset,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset + 2,
      vertexOffset + 1,
      vertexOffset + 3
    );
  }

  const foliageDensity = THREE.MathUtils.clamp(config.foliageDensity ?? 0.9, 0.2, 1);
  const tuftScale = 1.6;
  treeData.allNodes.forEach((node) => {
    const inCrown = node.position.y >= treeData.crownBottomY * 0.55;
    const heightFraction = THREE.MathUtils.clamp(
      (node.position.y - treeData.crownBottomY) / crownHeight,
      0,
      1
    );
    // The top of a pine is a dense spire. Up there the tree has few branches,
    // so every tuft counts: the trunk carries its own needles from 60% of the
    // crown up (not only the last 16%, which left the leader showing bare
    // below the tip), and no upper tuft is ever skipped or thinned.
    const UPPER_CROWN = 0.6;
    const isUpperCrown = heightFraction >= UPPER_CROWN;
    const apexTrunk = node.isTrunk && isUpperCrown;
    const needsBranchCover = !node.isTrunk && (node.parent?.isTrunk || node.children.length === 0);
    const needsLeaderCover = node.isTrunk && isUpperCrown;
    if (
      !inCrown
      || (node.isTrunk && !apexTrunk)
      || (!needsBranchCover && !needsLeaderCover && !isUpperCrown && rnd() > foliageDensity)
    ) return;
    // Thin the crown: a tuft on every node packs the cone into one solid
    // mass with no room for light and shadow to read, so optional tufts are
    // dropped - never the leader or the tufts that cover a branch's root and
    // tip, which keep the silhouette and stop limbs showing bare. The thinning
    // fades out up the crown (full below 35%, none above 60%) so the spire is
    // not left sparse. Hashed on the node, so the same seed always thins the
    // same tufts.
    const thinHash = Math.abs(Math.sin((node.id + 1) * 12.9898 + (config.seed ?? 0) * 0.0173) * 43758.5453) % 1;
    const thinning = CONIFER_THINNING * (1 - THREE.MathUtils.smoothstep(heightFraction, 0.35, UPPER_CROWN));
    if (!needsLeaderCover && !needsBranchCover && thinHash < thinning) return;
    // jogo: os degraus de detalhe distantes mantêm só uma parte dos tufos de agulhas (a fração vem de WOOD_LOD.needleKeep; 1 = todos)
    const needleKeep = WOOD_LOD.needleKeep ?? 1;
    if (needleKeep < 1 && Math.abs(Math.sin((node.id + 3) * 39.3468 + (config.seed ?? 0) * 0.0291) * 43758.5453) % 1 > needleKeep) return;
    // Outward from the trunk axis. A node ON the trunk has no meaningful
    // offset from the axis, so its sprays are spread around it by the golden
    // angle instead.
    const axisHere = leaderPointAt(node.position.y);
    const radial = new THREE.Vector3(node.position.x - axisHere.x, 0, node.position.z - axisHere.z);
    const rXZ = radial.length();
    if (node.isTrunk || radial.lengthSq() < 1e-4) {
      const angle = node.id * 2.399963;
      radial.set(Math.cos(angle), 0, Math.sin(angle));
    }
    radial.normalize();

    // Sprays point clearly OUT from the trunk and tip down a little, which is
    // what stacks a pine into readable skirts, each with a lit top and a
    // shaded underside. The colonised branch only nudges the heading (15%) -
    // it wanders, and following it scattered sprays sideways - and a small
    // per-tuft yaw keeps the whole tree from reading as a row of umbrellas.
    // The droop is strongest on the broad lower tiers (~28 deg) and eases to
    // nearly level (~6 deg) up top, where the spire takes over.
    const apexT = THREE.MathUtils.smoothstep(heightFraction, 0.76, 1);
    const branchFlat = new THREE.Vector3(node.dir.x, 0, node.dir.z);
    const heading = radial.clone().multiplyScalar(0.85);
    if (branchFlat.lengthSq() > 1e-6) heading.addScaledVector(branchFlat.normalize(), 0.15);
    heading.normalize();
    const yawJitter = (tuftYawHash(node.id, config.seed ?? 0) - 0.5) * THREE.MathUtils.degToRad(24);
    heading.applyAxisAngle(worldUp, yawJitter);
    const droop = THREE.MathUtils.degToRad(
      THREE.MathUtils.lerp(28, 6, THREE.MathUtils.smoothstep(heightFraction, 0.1, 0.9))
    );
    const baseDirection = heading.multiplyScalar(Math.cos(droop)).setY(-Math.sin(droop)).normalize();
    if (node.isTrunk && apexT > 0) {
      baseDirection.lerp(worldUp, apexT * 0.82).normalize();
    }

    // how deep inside its tier of the cone this tuft sits (0 = rim, 1 = axis)
    const tierRadius = Math.max(
      0.5,
      (treeData.crownRadiusX ?? 4) * Math.pow(Math.max(0.05, 1 - 0.76 * heightFraction), 0.82)
    );
    const tuftDepth = THREE.MathUtils.clamp(1 - rXZ / tierRadius, 0, 1)
      * (1 - THREE.MathUtils.smoothstep(heightFraction, 0.78, 0.95)); // the apex is lit, not deep
    const tuftShade = Math.abs(Math.sin((node.id + 7) * 78.233 + (config.seed ?? 0) * 0.031) * 43758.5453) % 1;

    const crownScale = THREE.MathUtils.lerp(1, 0.78, Math.pow(heightFraction, 0.8));
    // sprays still taper toward the tip, but not so far that the spire thins out
    const apexScale = THREE.MathUtils.lerp(1, node.isTrunk ? 0.55 : 0.7, apexT);
    const scale = crownScale * apexScale;
    const terminalLeader = node.isTrunk && heightFraction >= 0.86;
    const leaderProgress = terminalLeader
      ? THREE.MathUtils.smoothstep(heightFraction, 0.86, 1)
      : 0;
    const baseSprayCount = terminalLeader ? 5 : (node.isTrunk ? 4 : 3);
    // the spire keeps its full spray count; only the broad lower tiers are lightened
    const reduceLateralSpray = !terminalLeader && !isUpperCrown && node.id % 3 !== 2;
    const sprayCount = reduceLateralSpray ? baseSprayCount - 1 : baseSprayCount;
    for (let spray = 0; spray < sprayCount; spray++) {
      let direction: THREE.Vector3;
      let length: number;
      let width: number;

      if (terminalLeader) {
        const leaderAngle = node.id * 2.399963 + (spray / sprayCount) * Math.PI * 2;
        const leaderOutward = radial.clone().applyAxisAngle(worldUp, leaderAngle);
        const centerDistance = Math.abs(spray - (sprayCount - 1) * 0.5)
          / Math.max(1, (sprayCount - 1) * 0.5);
        const centerSpray = 1 - centerDistance;
        const isCenterSpray = centerDistance < 0.01;
        const outwardTilt = isCenterSpray
          ? THREE.MathUtils.lerp(0.18, 0.05, leaderProgress)
          : THREE.MathUtils.lerp(0.75, 0.56, leaderProgress)
            * THREE.MathUtils.lerp(0.72, 1, centerDistance);
        direction = worldUp.clone().addScaledVector(leaderOutward, outwardTilt).normalize();
        length = THREE.MathUtils.lerp(0.86, 1.12, leaderProgress)
          * THREE.MathUtils.lerp(0.72, 1, centerSpray)
          * (0.94 + rnd() * 0.1);
        width = length * THREE.MathUtils.lerp(0.32, 0.24, leaderProgress);
      } else {
        const angleOffset = (spray - (sprayCount - 1) * 0.5) * 0.34 + (rnd() - 0.5) * 0.14;
        direction = baseDirection.clone().applyAxisAngle(worldUp, angleOffset);
        direction.y += (spray - (sprayCount - 1) * 0.5) * 0.035;
        direction.normalize();
        length = THREE.MathUtils.lerp(1.28, 0.9, heightFraction)
          * scale
          * (0.9 + rnd() * 0.18);
        width = length * (0.48 + rnd() * 0.1);
      }
      appendNeedleSpray(
        node,
        direction,
        length * tuftScale,
        width * tuftScale,
        node.id * 0.37 + spray * 1.9,
        terminalLeader ? 1.32 : 1.85,
        tuftDepth,
        tuftShade
      );
    }
  });

  // ---------------------------------------------------------------------
  // SPIRE. Up top the colonisation has almost no branches - the attractor
  // cone narrows and the few limbs there are short - so needles hung on
  // nodes leave the last fifth of the tree a thin, sparse stick with the
  // leader showing through. The spire is therefore dressed on its own: rings
  // of sprays around the leader every ~0.3 m from 60% of the crown to the
  // tip, their reach following a full, convex taper from the crown's width
  // at that height down to a point.
  // ---------------------------------------------------------------------
  if (leader.length >= 2) {
    const spireStart = treeData.crownBottomY + crownHeight * 0.6;
    const spireTip = Math.max(treeData.crownTopY, leader[leader.length - 1].position.y);
    const baseReach = Math.max(
      0.8,
      (treeData.crownRadiusX ?? 4) * Math.pow(1 - 0.76 * 0.6, 0.82)
    );
    const ringStep = 0.25;
    const rings = Math.max(2, Math.floor((spireTip - spireStart) / ringStep));
    const seedOffset = (config.seed ?? 0) * 0.0137;
    for (let ring = 0; ring <= rings; ring++) {
      const t = ring / rings;                                  // 0 at the spire base, 1 at the tip
      const y = spireStart + (spireTip - spireStart) * t;
      // convex taper: stays full most of the way up, closes quickly at the point
      const reach = Math.max(0.3, baseReach * Math.pow(1 - t * 0.97, 0.4));
      const centre = leaderPointAt(Math.min(y, leader[leader.length - 1].position.y));
      centre.y = y;
      const count = t < 0.85 ? 6 : (t < 0.95 ? 5 : 4);
      const ringTurn = ring * 2.399963 + seedOffset;
      for (let k = 0; k < count; k++) {
        const angle = ringTurn + (k / count) * Math.PI * 2;
        const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        // continuing the skirts' gentle droop at the base of the spire, then
        // sweeping up over its last part so the tip stays a sharp point
        out.y = THREE.MathUtils.lerp(-0.2, 0.38, THREE.MathUtils.smoothstep(t, 0.45, 1.0));
        out.normalize();
        const length = reach / 0.82;                           // the spray's tip lands at `reach`
        const hash = Math.abs(Math.sin((ring * 13 + k + 1) * 12.9898 + seedOffset) * 43758.5453) % 1;
        appendNeedleSpray(
          { position: centre, id: 100000 + ring * 7 + k } as SCANode,
          out,
          length * (0.92 + hash * 0.16),
          length * 0.55,
          angle,
          1.85,
          0.3 * (1 - t),                                         // mostly lit, a little depth at the base
          hash
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aCrownDepth', new THREE.Float32BufferAttribute(crownDepths, 1));
  geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(shades, 1));
  geometry.setIndex(indices);
  if (positions.length > 0) {
    geometry.computeBoundingSphere();
  }
  return geometry;
}

export function buildProceduralConifer(
  config: TreeConfig,
  barkMaterial: THREE.Material,
  sharedUniforms: {
    uTime: { value: number };
    uWindStrength: { value: number };
    uWindSpeed: { value: number };
    uLightDir: { value: THREE.Vector3 };
  },
  rnd: () => number,
  scaData?: SCATreeData | null
): ConiferResult {
  const treeData = scaData ?? runSpaceColonization(config);
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];

  treeData.allNodes.forEach((node) => {
    const heightFraction = THREE.MathUtils.clamp(node.position.y / Math.max(config.trunkHeight, 0.01), 0, 1);
    if (node.isTrunk) {
      const controlledRadius = THREE.MathUtils.lerp(
        config.trunkRadiusBase * 0.72,
        config.trunkRadiusTop * 0.48,
        Math.pow(heightFraction, 0.7)
      );
      node.radius = Math.min(node.radius, controlledRadius);
    } else {
      const attachmentScale = node.parent?.isTrunk ? 1.15 : 1;
      node.radius = THREE.MathUtils.clamp(
        node.radius * 0.48 * attachmentScale,
        0.022,
        node.parent?.isTrunk ? 0.115 : 0.09
      );
    }
  });

  // the pine keeps the plain chain sweep (smoothJoins off): its look was
  // tuned on it
  const woodGeometry = buildFullTreeGeometry(
    treeData.rootNode,
    10,
    config.rootSpread * 0.45,
    config.trunkTwist,
    false,
    false
  );
  geometriesToDispose.push(woodGeometry);

  // The trunk and limbs run up through the middle of a pine's needles, so the
  // wood inside the crown is in deep shade. Turn on the bark shader's crown
  // shade with this tree's own crown band (pixel bark material only).
  const barkUniforms = (barkMaterial as THREE.ShaderMaterial).uniforms;
  if (barkUniforms?.uCrownShade) {
    barkUniforms.uCrownShade.value = 1;
    barkUniforms.uCrownBottomY.value = treeData.crownBottomY * 0.55; // where the needles start
    barkUniforms.uCrownTopY.value = treeData.crownTopY;
    barkUniforms.uCrownRadius.value = treeData.crownRadiusX ?? 4;
  }

  const woodMesh = new THREE.Mesh(woodGeometry, barkMaterial);
  woodMesh.name = 'BotW_ConiferWood';
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;

  const foliageGeometry = buildSCAConiferFoliageGeometry(config, treeData, rnd);
  geometriesToDispose.push(foliageGeometry);
  const usePixelNeedles = config.pixelTextureEnabled !== false;
  // Legacy path only: the pixel path samples the shared, cached structure
  // atlas instead, and must not dispose it with the material.
  const foliageAtlas = usePixelNeedles ? null : generateLeafAtlasTexture(config.species, config.seed, config);

  const foliageMaterial = usePixelNeedles
    ? createPixelConiferMaterial(config, sharedUniforms, treeData.crownBottomY, treeData.crownTopY)
    : new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uAtlas: { value: foliageAtlas },
      uAlphaTest: { value: config.alphaTest ?? 0.4 },
      uColorTop: { value: new THREE.Color(config.foliageColorTop) },
      uColorBottom: { value: new THREE.Color(config.foliageColorBottom) },
      uRimColor: { value: new THREE.Color(0xdffff0) },
      uTreeHeight: { value: config.trunkHeight },
      uRimIntensity: { value: config.rimLightIntensity },
      uSnow: { value: THREE.MathUtils.clamp(config.snowCover ?? 0, 0, 1) },
    },
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      uniform float uTreeHeight;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      void main() {
        vUv = uv;
        vec3 pos = position;
        float heightFrac = clamp(position.y / uTreeHeight, 0.0, 1.0);
        float branchWave = sin(uTime * uWindSpeed * 1.45 + position.x * 0.65 + position.z * 0.55);
        float needleFlutter = sin(uTime * uWindSpeed * 3.1 + uv.y * 18.0 + position.x * 1.7);
        pos.x += branchWave * 0.13 * uWindStrength * heightFrac;
        pos.z += cos(uTime * uWindSpeed * 1.2 + position.y * 0.42) * 0.08 * uWindStrength * heightFrac;
        pos.y += needleFlutter * 0.018 * uWindStrength * sin(uv.y * 3.14159265);

        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPosition.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform float uAlphaTest;
      uniform vec3 uLightDir;
      uniform vec3 uColorTop;
      uniform vec3 uColorBottom;
      uniform vec3 uRimColor;
      uniform float uTreeHeight;
      uniform float uRimIntensity;
      uniform float uSnow;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      void main() {
        vec4 texColor = texture2D(uAtlas, vUv);
        if (texColor.a < uAlphaTest) discard;

        vec3 N = normalize(vNormal);
        if (!gl_FrontFacing) N = -N;
        float lighting = dot(N, normalize(uLightDir));
        float cel = lighting > 0.30 ? 1.0 : (lighting > -0.12 ? 0.67 : 0.38);
        float heightMix = clamp(vWorldPos.y / uTreeHeight, 0.0, 1.0);
        vec3 foliage = mix(uColorBottom, uColorTop, heightMix * 0.78 + 0.16);
        float needleBands = sin(vUv.y * 54.0 + vUv.x * 9.0) * 0.045;
        vec3 color = foliage * (cel * 0.79 + 0.25 + needleBands);
        color = mix(color * 0.84, color * 1.14, texColor.g);
        color *= 0.82 + texColor.r * 0.24;
        vec3 viewDirection = normalize(cameraPosition - vWorldPos);
        float rim = pow(1.0 - max(dot(viewDirection, N), 0.0), 4.0) * uRimIntensity;
        color += uRimColor * rim * 0.12;
        // snow on the top of each spray, heaped along its spine
        if (uSnow > 0.001 && N.y > 0.05) {
          vec2 c = fract(vUv * vec2(4.0, 2.0));
          float f = (1.0 - abs(c.x - 0.5) * 2.6) * (1.0 - smoothstep(0.5, 0.88, c.y)) + (texColor.g - 0.5) * 0.3;
          if (f > 1.0 - uSnow * 0.8) color = cel > 0.9 ? vec3(0.97, 0.99, 1.0) : vec3(0.72, 0.8, 0.9);
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  if (foliageAtlas) foliageMaterial.addEventListener('dispose', () => foliageAtlas.dispose());
  materialsToDispose.push(foliageMaterial);

  const foliageMesh = new THREE.Mesh(foliageGeometry, foliageMaterial);
  foliageMesh.name = 'BotW_SCAConiferFoliageMesh';
  foliageMesh.castShadow = true;
  foliageMesh.receiveShadow = true;

  const foliageGroup = new THREE.Group();
  foliageGroup.name = 'BotW_ConiferFoliage';
  foliageGroup.add(foliageMesh);

  const branchTips = treeData.leafNodes.map((node) => ({
    position: node.position.clone(),
    normal: node.dir.clone().normalize(),
    scale: THREE.MathUtils.clamp(node.radius / Math.max(config.trunkRadiusTop, 0.01), 0.45, 1.15),
  }));

  const update = (time: number, windStrength: number, windSpeed: number) => {
    foliageMaterial.uniforms.uTime.value = time;
    foliageMaterial.uniforms.uWindStrength.value = windStrength;
    foliageMaterial.uniforms.uWindSpeed.value = windSpeed;
  };

  return {
    woodMesh,
    foliageGroup,
    materialsToDispose,
    geometriesToDispose,
    branchTips,
    update,
  };
}
