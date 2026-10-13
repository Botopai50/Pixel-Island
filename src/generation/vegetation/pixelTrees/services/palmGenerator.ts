// @ts-nocheck
import * as THREE from 'three';
import { coconutSprite, makeSprite, spriteMaterial } from './pixelSprites';
import { TreeConfig } from '../types';
import { SCATreeData, cleanStemPath, groundedRingFrame } from './spaceColonization';
import { PIXEL_BLADE_FRAGMENT_SHADER, createPixelBladeUniforms } from './pixelArtTextureSystem';

// Surface-area weighted radius of a linearly tapered tube. A plain average of
// the two ends is dragged down by the thin end, and the bark shader turns that
// into too few ridges for the thick part, which is most of what you see.
function taperedRepresentativeRadius(r1: number, r2: number): number {
  const sum = r1 + r2;
  if (sum < 1e-6) return 0.03;
  return Math.max(0.03, (2 / 3) * (r1 * r1 + r1 * r2 + r2 * r2) / sum);
}

export interface PalmResult {
  woodMesh: THREE.Mesh;
  foliageGroup: THREE.Group;
  materialsToDispose: (THREE.Material | THREE.Material[])[];
  geometriesToDispose: THREE.BufferGeometry[];
  branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[];
  update: (time: number, windStrength: number, windSpeed: number) => void;
}

/**
 * Procedural Breath of the Wild Tropical Palm (Faron Palm).
 * Features:
 * - Slender, gracefully curved trunk guided by 3D Space Colonization or organic procedural spline.
 * - Leaf scar ring ridges and flared root base.
 * - Fibrous crown collar at the apex where fronds emerge.
 * - 18-24 arching, double-sided palm fronds arranged in botanical 3-tier radial tiers (upright, spreading, drooping).
 * - Fronds feature an authentic V-crease midrib, tapered width, and feathered pinnate leaflet serrations.
 * - Clusters of coconuts under the crown and central young spear shoots.
 * - Responsive cel-shading with sunlit lime-chartreuse gradients and tropical breeze flutter.
 */
export function buildProceduralPalm(
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
): PalmResult {
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: (THREE.Material | THREE.Material[])[] = [];
  const branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[] = [];

  const usePixelTextures = config.pixelTextureEnabled !== false;
  const trunkHeight = config.trunkHeight ?? 10.5;
  const curvature = config.trunkCurvature ?? 0.85;
  const canopySpread = config.canopySpread ?? 1.35;
  const baseFrondLength = (config.branchLength ?? 4.8) * canopySpread;

  // -------------------------------------------------------------
  // 1. SLENDER CURVED PALM TRUNK WITH RING RIDGES
  // Derived directly from Space Colonization spine when available
  // -------------------------------------------------------------
  let trunkCurve: THREE.Curve<THREE.Vector3>;

  if (scaData && scaData.rootNode) {
    // Trace the primary trunk spine upwards through the SCA graph
    const trunkPoints: THREE.Vector3[] = [scaData.rootNode.position.clone()];
    let curr = scaData.rootNode;
    while (curr.children.length > 0) {
      // Pick child that is marked isTrunk or has the greatest height / thickness
      let bestChild = curr.children[0];
      for (let cIdx = 1; cIdx < curr.children.length; cIdx++) {
        const child = curr.children[cIdx];
        if (child.isTrunk && !bestChild.isTrunk) {
          bestChild = child;
        } else if (child.position.y > bestChild.position.y) {
          bestChild = child;
        }
      }
      trunkPoints.push(bestChild.position.clone());
      curr = bestChild;
    }

    if (trunkPoints.length >= 3) {
      // A palm may lean a long way, but its crown never hooks over sideways or
      // down: cut the wandering tip and keep every bend wider than the trunk.
      const cleaned = cleanStemPath(trunkPoints, {
        radius: Math.max(config.trunkRadiusTop, config.trunkRadiusBase * 0.8),
        minUp: 0.25,
        maxTurnDeg: 38,
        protectFraction: 0.45,
      });
      trunkCurve = new THREE.CatmullRomCurve3(cleaned);
    } else {
      // Fallback if SCA tree spine had very few steps
      const leanAngle = (rnd() - 0.5) * Math.PI * 0.4 + 0.2;
      const leanDist = curvature * 2.6;
      const curveDirX = Math.cos(leanAngle);
      const curveDirZ = Math.sin(leanAngle);
      const p0 = new THREE.Vector3(0, 0, 0);
      const p1 = new THREE.Vector3(curveDirX * leanDist * 0.25, trunkHeight * 0.32, curveDirZ * leanDist * 0.25);
      const p2 = new THREE.Vector3(curveDirX * leanDist * 0.72, trunkHeight * 0.68, curveDirZ * leanDist * 0.72);
      const p3 = new THREE.Vector3(curveDirX * leanDist * 1.05, trunkHeight, curveDirZ * leanDist * 1.05);
      trunkCurve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    }
  } else {
    const leanAngle = (rnd() - 0.5) * Math.PI * 0.4 + 0.2;
    const leanDist = curvature * 2.6;
    const curveDirX = Math.cos(leanAngle);
    const curveDirZ = Math.sin(leanAngle);
    const p0 = new THREE.Vector3(0, 0, 0);
    const p1 = new THREE.Vector3(curveDirX * leanDist * 0.25, trunkHeight * 0.32, curveDirZ * leanDist * 0.25);
    const p2 = new THREE.Vector3(curveDirX * leanDist * 0.72, trunkHeight * 0.68, curveDirZ * leanDist * 0.72);
    const p3 = new THREE.Vector3(curveDirX * leanDist * 1.05, trunkHeight, curveDirZ * leanDist * 1.05);
    trunkCurve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
  }

  const trunkSegments = 32;
  const radialSegments = 14;
  const frames = trunkCurve.computeFrenetFrames(trunkSegments, false);

  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  // Wood metrics for the bark shader, in metres, so the palm trunk shares the
  // pixel scale and the ridge layout of every other piece of wood.
  const wood: number[] = [];
  const barkAngle: number[] = [];
  const indices: number[] = [];
  const trunkLength = trunkCurve.getLength();
  const trunkMeanRadius = taperedRepresentativeRadius(config.trunkRadiusBase, config.trunkRadiusTop);

  for (let i = 0; i <= trunkSegments; i++) {
    const t = i / trunkSegments;
    // level foot on the ground, easing into the lean over the first 1.6 m
    const grounded = groundedRingFrame(
      trunkCurve.getPointAt(t),
      frames.tangents[i],
      frames.normals[i],
      frames.binormals[i],
      t * trunkLength,
      1.6
    );
    const pt = grounded.center;
    const N = grounded.normal;
    const B = grounded.binormal;

    // Trunk radius profile: flares at root base, tapers gently, slightly swells at crown collar
    let radius = THREE.MathUtils.lerp(config.trunkRadiusBase, config.trunkRadiusTop, Math.pow(t, 0.7));
    if (t < 0.25) {
      // Buttressed root flare
      radius += Math.pow(1.0 - t / 0.25, 2) * config.rootSpread * 0.75;
    } else if (t > 0.90) {
      // Swelling crown collar where old frond stems insert
      const collarFrac = (t - 0.90) / 0.10;
      radius += collarFrac * config.trunkRadiusTop * 0.28;
    }

    // Authentic tropical palm growth ring ridges (leaf scars)
    const ringWave = Math.sin(t * 36.0 * Math.PI);
    radius *= 1.0 + ringWave * 0.038 * (1.0 - t * 0.25);

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const surfaceNormal = new THREE.Vector3()
        .addScaledVector(N, cosT)
        .addScaledVector(B, sinT)
        .normalize();

      const vertex = new THREE.Vector3().copy(pt).addScaledVector(surfaceNormal, radius);

      vertices.push(vertex.x, vertex.y, vertex.z);
      normals.push(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z);
      uvs.push(j / radialSegments, t * 8.0);
      wood.push(Math.max(0.04, radius), t * trunkLength, trunkMeanRadius);
      barkAngle.push(cosT, sinT);
    }
  }

  for (let i = 0; i < trunkSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = (i + 1) * (radialSegments + 1) + j;
      const c = (i + 1) * (radialSegments + 1) + (j + 1);
      const d = i * (radialSegments + 1) + (j + 1);

      // Counter-clockwise winding facing outward from the trunk cylinder
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  const trunkGeo = new THREE.BufferGeometry();
  trunkGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  trunkGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  trunkGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  trunkGeo.setAttribute('aWood', new THREE.Float32BufferAttribute(wood, 3));
  trunkGeo.setAttribute('aBarkAngle', new THREE.Float32BufferAttribute(barkAngle, 2));
  trunkGeo.setIndex(indices);
  trunkGeo.computeVertexNormals();
  geometriesToDispose.push(trunkGeo);

  const woodMesh = new THREE.Mesh(trunkGeo, barkMaterial);
  woodMesh.name = 'ProceduralPalmTrunk';
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;

  const crownTop = trunkCurve.getPointAt(1.0);
  const crownTangent = trunkCurve.getTangentAt(1.0).normalize();

  // Register crown top as a branch tip for interactive items (fruit)
  branchTips.push({
    position: crownTop.clone().add(new THREE.Vector3(0, 0.4, 0)),
    normal: crownTangent.clone(),
    scale: 1.2,
  });

  // -------------------------------------------------------------
  // 2. BOTW CEL-SHADED PALM FROND SHADER MATERIAL
  // -------------------------------------------------------------
  const colorTop = new THREE.Color(config.foliageColorTop ?? '#8bc34a'); // Sunlit tropical chartreuse
  const colorBottom = new THREE.Color(config.foliageColorBottom ?? '#2e7d32'); // Shaded emerald
  const colorCrease = colorBottom.clone().multiplyScalar(0.75); // Darker midrib crease

  const palmFoliageMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uColorTop: { value: colorTop },
      uColorBottom: { value: colorBottom },
      uColorCrease: { value: colorCrease },
      uTreeHeight: { value: trunkHeight },
      uRimIntensity: { value: config.rimLightIntensity ?? 0.95 },
      uCelSteps: { value: config.celSteps ?? 3 },
      // Palm fronds are blades, so they share the pixel art blade shader and
      // the tree's palette instead of carrying their own gradient.
      ...(usePixelTextures
        ? createPixelBladeUniforms(
            config,
            trunkHeight * 0.82,
            trunkHeight * 1.3,
            new THREE.Vector2(10, 34)
          )
        : {}),
    },
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vFrondLenFrac;

      void main() {
        vUv = uv;
        vFrondLenFrac = uv.y; // 0 at base, 1 at tip
        
        vec3 pos = position;

        // Tropical Wind Animation:
        // Progressive sway that amplifies toward the frond tip
        float tipFactor = pow(uv.y, 1.6);
        float sway1 = sin(uTime * uWindSpeed * 2.2 + position.x * 1.5 + position.z * 1.5);
        float sway2 = cos(uTime * uWindSpeed * 1.6 + position.y * 1.2);
        
        // Vertical arch oscillation + lateral flutter
        pos.y += (sway1 * 0.22 + sway2 * 0.12) * tipFactor * uWindStrength;
        pos.x += sway2 * 0.18 * tipFactor * uWindStrength;
        pos.z += sway1 * 0.18 * tipFactor * uWindStrength;

        // Micro-flutter along outer leaflet edges
        float edgeDist = abs(uv.x - 0.5) * 2.0; // 0 at center crease, 1 at edge
        float flutter = sin(uTime * uWindSpeed * 4.5 + uv.y * 20.0) * 0.04 * edgeDist * tipFactor * uWindStrength;
        pos += normal * flutter;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: usePixelTextures ? PIXEL_BLADE_FRAGMENT_SHADER : `
      uniform vec3 uLightDir;
      uniform vec3 uColorTop;
      uniform vec3 uColorBottom;
      uniform vec3 uColorCrease;
      uniform float uRimIntensity;
      uniform float uCelSteps;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vFrondLenFrac;

      void main() {
        vec3 N = normalize(vNormal);
        // Ensure lighting works on both sides of the double-sided frond
        if (!gl_FrontFacing) {
          N = -N;
        }

        vec3 L = normalize(uLightDir);
        float NdotL = dot(N, L);

        // Discrete stepped cel-shading (BotW Anime Tone Curve)
        float stepVal;
        if (uCelSteps > 3.5) {
          if (NdotL > 0.5) stepVal = 1.0;
          else if (NdotL > 0.15) stepVal = 0.75;
          else if (NdotL > -0.2) stepVal = 0.5;
          else stepVal = 0.3;
        } else if (uCelSteps > 2.5) {
          if (NdotL > 0.35) stepVal = 1.0;
          else if (NdotL > -0.15) stepVal = 0.65;
          else stepVal = 0.35;
        } else {
          if (NdotL > 0.1) stepVal = 1.0;
          else stepVal = 0.45;
        }

        // Gradient: Base of frond is deep emerald; tips and sunlit edges are vibrant chartreuse
        float lengthGrad = clamp(vFrondLenFrac * 1.15, 0.0, 1.0);
        vec3 baseColor = mix(uColorBottom, uColorTop, lengthGrad);

        // V-crease midrib darkening
        float centerDist = abs(vUv.x - 0.5) * 2.0;
        baseColor = mix(uColorCrease, baseColor, smoothstep(0.0, 0.35, centerDist));

        // Subtle BotW painterly leaflet streaks
        float streak = sin(vUv.y * 70.0 + vUv.x * 20.0) * 0.035;
        baseColor += streak;

        // Apply Cel-shading
        vec3 finalColor = baseColor * (stepVal * 0.85 + 0.2);

        // Sunlit Fresnel Rim Lighting
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = 1.0 - max(dot(V, N), 0.0);
        rim = pow(rim, 2.5) * uRimIntensity;
        vec3 rimColor = vec3(1.0, 0.98, 0.82); // Warm sun glow
        finalColor += rimColor * rim * 0.6;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
  materialsToDispose.push(palmFoliageMaterial);

  // -------------------------------------------------------------
  // 3. ARCHING V-CREASE PALM FRONDS (3 BOTANICAL TIERS)
  // -------------------------------------------------------------
  const foliageGroup = new THREE.Group();
  foliageGroup.name = 'BotW_PalmCanopy';

  // Woody central rachis material
  const rachisMat = new THREE.MeshToonMaterial({
    color: 0x5d4037,
  });
  materialsToDispose.push(rachisMat);

  const frondCount = Math.max(16, Math.min(24, config.clusterCount ? Math.floor(config.clusterCount * 1.8) : 20));

  interface FrondSpec {
    tier: number;
    angle: number;
    elevation: number;
    length: number;
    width: number;
  }

  const frondSpecs: FrondSpec[] = [];

  // Botanical 3-Tier Distribution for Palm Fronds (Pure botanical crown, unaffected by SCA):
  // Tier 1 (Upper, ~6 fronds): upright arch (+45° to +60°)
  // Tier 2 (Middle, ~9 fronds): spreading wide (+15° to +25°)
  // Tier 3 (Lower, ~6 fronds): drooping down (-10° to -30°)
  const tier1Count = Math.floor(frondCount * 0.28);
  const tier2Count = Math.floor(frondCount * 0.44);
  const tier3Count = frondCount - tier1Count - tier2Count;

  // Tier 1: Young upright fronds
  for (let i = 0; i < tier1Count; i++) {
    const angle = (i / tier1Count) * Math.PI * 2 + (rnd() - 0.5) * 0.2;
    frondSpecs.push({
      tier: 1,
      angle,
      elevation: 0.85 + (rnd() - 0.5) * 0.15, // ~48°
      length: baseFrondLength * (0.80 + rnd() * 0.15),
      width: (config.clusterRadius ?? 2.2) * 0.42,
    });
  }

  // Tier 2: Grand sweeping mature fronds
  for (let i = 0; i < tier2Count; i++) {
    const angle = (i / tier2Count) * Math.PI * 2 + 0.35 + (rnd() - 0.5) * 0.2;
    frondSpecs.push({
      tier: 2,
      angle,
      elevation: 0.28 + (rnd() - 0.5) * 0.12, // ~16°
      length: baseFrondLength * (1.0 + rnd() * 0.18),
      width: (config.clusterRadius ?? 2.2) * 0.52,
    });
  }

  // Tier 3: Drooping mature outer fronds
  for (let i = 0; i < tier3Count; i++) {
    const angle = (i / tier3Count) * Math.PI * 2 + 0.65 + (rnd() - 0.5) * 0.2;
    frondSpecs.push({
      tier: 3,
      angle,
      elevation: -0.22 + (rnd() - 0.5) * 0.15, // ~-12° arching down
      length: baseFrondLength * (0.90 + rnd() * 0.15),
      width: (config.clusterRadius ?? 2.2) * 0.46,
    });
  }

  frondSpecs.forEach((spec) => {
    const cosA = Math.cos(spec.angle);
    const sinA = Math.sin(spec.angle);
    const L = spec.length;

    // Build arching backbone curve with gravity droop
    const startP = crownTop.clone().add(new THREE.Vector3(cosA * 0.2, -0.1, sinA * 0.2));
    
    // Upward/outward impulse from stem base
    const midImpulseY = Math.sin(spec.elevation) * L * 0.45;
    const midP = startP.clone().add(new THREE.Vector3(
      cosA * L * 0.42,
      midImpulseY,
      sinA * L * 0.42
    ));

    // Drooping tip: gravity pulls it down
    const tipDroop = spec.tier === 1 ? L * 0.15 : spec.tier === 2 ? L * 0.45 : L * 0.70;
    const endP = startP.clone().add(new THREE.Vector3(
      cosA * L * 0.95,
      midImpulseY - tipDroop,
      sinA * L * 0.95
    ));

    const frondSpline = new THREE.CatmullRomCurve3([startP, midP, endP]);

    // Build contoured V-crease frond blade geometry
    const lengthDivisions = 20;
    const fVerts: number[] = [];
    const fNorms: number[] = [];
    const fUvs: number[] = [];
    const fIndices: number[] = [];

    // 5 cross-section points across the frond width:
    // 0: Left serrated edge
    // 1: Left mid wing
    // 2: Center crease (rachis)
    // 3: Right mid wing
    // 4: Right serrated edge
    const crossSections = 5;

    for (let uIdx = 0; uIdx <= lengthDivisions; uIdx++) {
      const u = uIdx / lengthDivisions;
      const pt = frondSpline.getPointAt(u);
      const tangent = frondSpline.getTangentAt(u).normalize();

      // Perpendicular horizontal direction
      const up = new THREE.Vector3(0, 1, 0);
      let side = new THREE.Vector3().crossVectors(tangent, up).normalize();
      if (side.lengthSq() < 0.001) {
        side = new THREE.Vector3(1, 0, 0);
      }
      const frondNormal = new THREE.Vector3().crossVectors(side, tangent).normalize();

      // Natural tapered width profile
      const widthEnvelope = Math.sin(Math.pow(u, 0.55) * Math.PI);
      const baseWidth = spec.width * widthEnvelope;

      // Feathered pinnate leaflet serration along outer edges
      const sawLeft = Math.abs(Math.sin(u * 28.0 * Math.PI));
      const sawRight = Math.abs(Math.sin(u * 28.0 * Math.PI + 0.6));

      const wLeft = baseWidth * (0.82 + sawLeft * 0.18);
      const wRight = baseWidth * (0.82 + sawRight * 0.18);

      // V-fold upward angle: lifts the wings upward by ~20 degrees
      const vLift = baseWidth * 0.22;

      // Generate the 5 points
      const pLeftEdge = pt.clone().addScaledVector(side, -wLeft).addScaledVector(frondNormal, vLift);
      const pLeftMid = pt.clone().addScaledVector(side, -wLeft * 0.5).addScaledVector(frondNormal, vLift * 0.4);
      const pCenter = pt.clone(); // Midrib crease
      const pRightMid = pt.clone().addScaledVector(side, wRight * 0.5).addScaledVector(frondNormal, vLift * 0.4);
      const pRightEdge = pt.clone().addScaledVector(side, wRight).addScaledVector(frondNormal, vLift);

      const pts = [pLeftEdge, pLeftMid, pCenter, pRightMid, pRightEdge];
      const uCoordAcross = [0.0, 0.25, 0.5, 0.75, 1.0];

      pts.forEach((p, pIdx) => {
        fVerts.push(p.x, p.y, p.z);
        // Outward/upward normal with V-crease orientation
        const nVec = frondNormal.clone();
        if (pIdx < 2) nVec.addScaledVector(side, 0.35).normalize();
        else if (pIdx > 2) nVec.addScaledVector(side, -0.35).normalize();
        fNorms.push(nVec.x, nVec.y, nVec.z);
        fUvs.push(uCoordAcross[pIdx], u);
      });
    }

    // Connect indices
    for (let uIdx = 0; uIdx < lengthDivisions; uIdx++) {
      for (let c = 0; c < crossSections - 1; c++) {
        const row1 = uIdx * crossSections;
        const row2 = (uIdx + 1) * crossSections;

        const a = row1 + c;
        const b = row2 + c;
        const cPt = row2 + (c + 1);
        const d = row1 + (c + 1);

        fIndices.push(a, d, b);
        fIndices.push(b, d, cPt);
      }
    }

    const frondGeo = new THREE.BufferGeometry();
    frondGeo.setAttribute('position', new THREE.Float32BufferAttribute(fVerts, 3));
    frondGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fNorms, 3));
    frondGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fUvs, 2));
    frondGeo.setIndex(fIndices);
    frondGeo.computeVertexNormals();
    geometriesToDispose.push(frondGeo);

    const frondMesh = new THREE.Mesh(frondGeo, palmFoliageMaterial);
    frondMesh.castShadow = true;
    frondMesh.receiveShadow = true;
    foliageGroup.add(frondMesh);

    // Woody central rachis stem (runs along first 80% of frond)
    const rachisCurve = new THREE.CatmullRomCurve3([
      startP,
      frondSpline.getPointAt(0.4),
      frondSpline.getPointAt(0.8),
    ]);
    const rachisGeo = new THREE.TubeGeometry(rachisCurve, 10, 0.055, 5, false);
    geometriesToDispose.push(rachisGeo);
    const rachisMesh = new THREE.Mesh(rachisGeo, rachisMat);
    rachisMesh.castShadow = true;
    foliageGroup.add(rachisMesh);
  });

  // -------------------------------------------------------------
  // 4. CROWN SPEAR SHOOTS & COCONUTS
  // -------------------------------------------------------------
  // Young unopened spear leaves standing upright in the crown center
  const spearMat = new THREE.MeshToonMaterial({
    color: 0xa3e635,
  });
  materialsToDispose.push(spearMat);

  for (let s = 0; s < 2; s++) {
    const sAngle = s * Math.PI + 0.4;
    const sCurve = new THREE.CatmullRomCurve3([
      crownTop.clone().add(new THREE.Vector3(0, 0.1, 0)),
      crownTop.clone().add(new THREE.Vector3(Math.cos(sAngle) * 0.15, 1.3, Math.sin(sAngle) * 0.15)),
      crownTop.clone().add(new THREE.Vector3(Math.cos(sAngle) * 0.35, 2.2, Math.sin(sAngle) * 0.35)),
    ]);
    const spearGeo = new THREE.TubeGeometry(sCurve, 8, 0.06, 5, false);
    geometriesToDispose.push(spearGeo);
    const spearMesh = new THREE.Mesh(spearGeo, spearMat);
    foliageGroup.add(spearMesh);
  }

  // Coconuts: pixel-art bunches hanging under the crown collar
  const coconutMat = spriteMaterial(coconutSprite());
  materialsToDispose.push(coconutMat);
  const bunches = 3;
  for (let c = 0; c < bunches; c++) {
    const cAngle = (c / bunches) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    // (below the frond bases and out from the trunk, or the crown hides them)
    const dist = 0.75 + rnd() * 0.1;
    const bunch = makeSprite(coconutMat, 1.1 + rnd() * 0.2, new THREE.Vector2(0.5, 1));
    bunch.position.set(
      crownTop.x + Math.cos(cAngle) * dist,
      crownTop.y - 0.45 - rnd() * 0.2,
      crownTop.z + Math.sin(cAngle) * dist
    );
    foliageGroup.add(bunch);
  }

  const update = (time: number, windStrength: number, windSpeed: number) => {
    palmFoliageMaterial.uniforms.uTime.value = time;
    palmFoliageMaterial.uniforms.uWindStrength.value = windStrength;
    palmFoliageMaterial.uniforms.uWindSpeed.value = windSpeed;
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
