// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { createPixelSucculentMaterial, buildPixelCactusFlower } from './pixelArtTextureSystem';
import { SCATreeData, SCANode, cleanStemPath, groundedRingFrame, WOOD_LOD } from './spaceColonization';

// Surface-area weighted radius of a linearly tapered tube.
function taperedRepresentativeRadius(r1: number, r2: number): number {
  const sum = r1 + r2;
  if (sum < 1e-6) return 0.03;
  return Math.max(0.03, (2 / 3) * (r1 * r1 + r1 * r2 + r2 * r2) / sum);
}

export interface CactusResult {
  woodMesh: THREE.Mesh;
  foliageGroup: THREE.Group;
  materialsToDispose: (THREE.Material | THREE.Material[])[];
  geometriesToDispose: THREE.BufferGeometry[];
  branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[];
  update: (time: number, windStrength: number, windSpeed: number) => void;
}

/**
 * Procedural Zelda: Breath of the Wild Gerudo Desert Saguaro Cactus.
 * Inspired by the desert cacti and Voltfruit blossoms found throughout the Gerudo Wasteland.
 *
 * Features:
 * - 100% Space Colonization Algorithm skeletal architecture (candelabra arms & upright central leader).
 * - Saguaro succulent morphology with 14-16 longitudinal ribs (sulcos e cristas verticais profundas).
 * - Smooth domed apex caps where the ribs converge gracefully.
 * - Procedural radial areoles & golden desert spines along the rib ridges.
 * - Zelda BotW Voltfruit & desert flower blooms crowning the branch and trunk apices:
 *   - Flared green sepal calyx base.
 *   - Voluptuous segmented Voltfruit bulb in glowing amber-orange hues.
 *   - Flaming solar petal crown and delicate central golden stamen filament tufts.
 * - Stylized BotW NPR cel-shading with rib groove occlusion, sunlit desert rim lighting, and rigid wind sway.
 */
export function buildProceduralCactus(
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
): CactusResult {
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: (THREE.Material | THREE.Material[])[] = [];
  const branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[] = [];

  const trunkHeight = config.trunkHeight ?? 8.5;
  const canopySpread = config.canopySpread ?? 1.15;
  const baseTrunkRadius = Math.max(0.20, (config.trunkRadiusBase ?? 0.85) * 0.7);
  const topTrunkRadius = Math.max(0.14, (config.trunkRadiusTop ?? 0.45) * 0.85);

  const foliageGroup = new THREE.Group();
  foliageGroup.name = 'GerudoCactusFoliage';

  // -------------------------------------------------------------
  // 1. EXTRACT STEM & CANDELABRA ARM PATHS FROM SCA SKELETON
  // -------------------------------------------------------------
  interface StemPath {
    points: THREE.Vector3[];
    radiusStart: number;
    radiusEnd: number;
    isMainTrunk: boolean;
    apexPosition: THREE.Vector3;
    apexDirection: THREE.Vector3;
  }

  const stemPaths: StemPath[] = [];

  if (scaData && scaData.rootNode) {
    // A) Trace primary vertical trunk from root
    const trunkNodes: SCANode[] = [scaData.rootNode];
    let curr = scaData.rootNode;
    while (curr.children.length > 0) {
      let nextChild = curr.children[0];
      for (let i = 1; i < curr.children.length; i++) {
        const c = curr.children[i];
        if (c.isTrunk && !nextChild.isTrunk) {
          nextChild = c;
        } else if (c.position.y > nextChild.position.y) {
          nextChild = c;
        }
      }
      trunkNodes.push(nextChild);
      curr = nextChild;
    }

    // A saguaro column ends pointing up: cut the tip where the traced path
    // wanders off, and keep every bend wider than the column so the tube (and
    // the dome built along its last tangent) never folds.
    const trunkPts = cleanStemPath(trunkNodes.map((n) => n.position.clone()), {
      radius: baseTrunkRadius,
      minUp: 0.55,
      maxTurnDeg: 35,
      protectFraction: 0.5,
    });
    const trunkApex = trunkPts[trunkPts.length - 1].clone();
    const trunkDir = trunkPts.length > 1
      ? new THREE.Vector3().subVectors(trunkPts[trunkPts.length - 1], trunkPts[trunkPts.length - 2]).normalize()
      : new THREE.Vector3(0, 1, 0);

    stemPaths.push({
      points: trunkPts,
      radiusStart: baseTrunkRadius,
      radiusEnd: topTrunkRadius,
      isMainTrunk: true,
      apexPosition: trunkApex,
      apexDirection: trunkDir,
    });

    // B) Find candelabra arm branches originating from the trunk
    const desiredArms = config.branchCount !== undefined ? Math.round(config.branchCount) : 3;

    if (desiredArms > 0) {
      const armRoots: SCANode[] = [];
      const trunkNodeSet = new Set<SCANode>(trunkNodes);

      trunkNodes.forEach((tNode) => {
        tNode.children.forEach((c) => {
          if (!trunkNodeSet.has(c)) {
            armRoots.push(c);
          }
        });
      });

      // Trace each arm upwards to its apex
      const candidateArms: { pts: THREE.Vector3[]; length: number; apex: THREE.Vector3; dir: THREE.Vector3 }[] = [];

      armRoots.forEach((armStart) => {
        const armNodes: SCANode[] = [armStart.parent || armStart, armStart];
        let armCurr = armStart;
        while (armCurr.children.length > 0) {
          let bestChild = armCurr.children[0];
          for (let i = 1; i < armCurr.children.length; i++) {
            if (armCurr.children[i].position.y > bestChild.position.y) {
              bestChild = armCurr.children[i];
            }
          }
          armNodes.push(bestChild);
          armCurr = bestChild;
        }

        if (armNodes.length >= 3) {
          const rawArm = armNodes.map((n) => n.position.clone());
          // The elbow is meant to run sideways, so trimming only starts once
          // the arm has turned upward; past that point it must keep rising.
          let upIndex = rawArm.length;
          for (let i = 1; i < rawArm.length; i++) {
            const step = new THREE.Vector3().subVectors(rawArm[i], rawArm[i - 1]);
            if (step.lengthSq() > 1e-10 && step.normalize().y > 0.6) {
              upIndex = i;
              break;
            }
          }
          const armPts = cleanStemPath(rawArm, {
            radius: topTrunkRadius * 0.88,
            minUp: 0.45,
            maxTurnDeg: 35,
            protectFraction: 0,
            startIndex: upIndex + 2,
          });
          const armApex = armPts[armPts.length - 1].clone();
          const armDir = armPts.length > 1
            ? new THREE.Vector3().subVectors(armPts[armPts.length - 1], armPts[armPts.length - 2]).normalize()
            : new THREE.Vector3(0, 1, 0);

          const armHeightGain = armApex.y - armPts[0].y;
          candidateArms.push({
            pts: armPts,
            length: armHeightGain,
            apex: armApex,
            dir: armDir,
          });
        }
      });

      // Sort candidate arms by vertical prominence/length and keep up to desiredArms
      candidateArms.sort((a, b) => b.length - a.length);
      const selectedArms = candidateArms.slice(0, desiredArms);

      selectedArms.forEach((arm) => {
        stemPaths.push({
          points: arm.pts,
          radiusStart: topTrunkRadius * 0.88,
          radiusEnd: topTrunkRadius * 0.82,
          isMainTrunk: false,
          apexPosition: arm.apex,
          apexDirection: arm.dir,
        });
      });
    }
  }

  // Fallback if SCA tree had insufficient nodes or wasn't provided
  if (stemPaths.length === 0) {
    const desiredArms = config.branchCount !== undefined ? Math.round(config.branchCount) : 3;
    const swayAmp = config.trunkCurvature * 0.55;

    // Organic curved trunk (not a straight line)
    const p0 = new THREE.Vector3(0, 0, 0);
    const p1 = new THREE.Vector3(swayAmp * 0.15, trunkHeight * 0.25, swayAmp * 0.05);
    const p2 = new THREE.Vector3(swayAmp * 0.45, trunkHeight * 0.55, -swayAmp * 0.1);
    const p3 = new THREE.Vector3(swayAmp * 0.35, trunkHeight * 0.80, swayAmp * 0.15);
    const p4 = new THREE.Vector3(swayAmp * 0.5, trunkHeight, swayAmp * 0.2);

    stemPaths.push({
      points: [p0, p1, p2, p3, p4],
      radiusStart: baseTrunkRadius,
      radiusEnd: topTrunkRadius,
      isMainTrunk: true,
      apexPosition: p4.clone(),
      apexDirection: new THREE.Vector3(0.1, 0.98, 0.05).normalize(),
    });

    // Procedural graceful candelabra arms with varied angles, heights, and organic curves
    if (desiredArms > 0) {
      const baseArmDist = (config.branchLength * 0.45 + 1.1) * canopySpread;

      for (let a = 0; a < desiredArms; a++) {
        const frac = desiredArms === 1 ? 0.5 : a / (desiredArms - 1);
        const emergenceY = trunkHeight * (0.32 + 0.30 * frac);
        const angle = (a / desiredArms) * Math.PI * 2 + (a % 2 === 0 ? 0.2 : -0.2);
        const dirX = Math.cos(angle);
        const dirZ = Math.sin(angle);
        const sideX = -dirZ;
        const sideZ = dirX;

        const armDist = baseArmDist * (0.8 + (a % 2 === 0 ? 0.2 : -0.1));
        const armTopY = trunkHeight * (0.70 + 0.28 * (a % 2 === 0 ? 0.95 : 0.75));

        const elbowX = dirX * armDist;
        const elbowZ = dirZ * armDist;
        const elbowY = emergenceY + armDist * 0.42;

        const midY = (elbowY + armTopY) * 0.5;
        // Organic bow and lateral sway
        const bow = armDist * 0.12 * (a % 2 === 0 ? 1 : -0.8);
        const sway = 0.15 * (a % 2 === 0 ? -1 : 1);

        const pts = [
          new THREE.Vector3(dirX * 0.2, emergenceY, dirZ * 0.2),
          new THREE.Vector3(dirX * armDist * 0.5, emergenceY + 0.08, dirZ * armDist * 0.5),
          new THREE.Vector3(elbowX, elbowY, elbowZ),
          new THREE.Vector3(dirX * (armDist + bow) + sideX * sway, midY, dirZ * (armDist + bow) + sideZ * sway),
          new THREE.Vector3(elbowX, armTopY, elbowZ),
        ];

        stemPaths.push({
          points: pts,
          radiusStart: topTrunkRadius * 0.88,
          radiusEnd: topTrunkRadius * 0.82,
          isMainTrunk: false,
          apexPosition: pts[pts.length - 1].clone(),
          apexDirection: new THREE.Vector3(0, 1, 0),
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 2. BUILD RIBBED SAGUARO MESH GEOMETRY
  // -------------------------------------------------------------
  const numRibs = 14; // Saguaro botanical longitudinal ribs
  // Ring radius / arc length in metres plus (cos, sin) of the ring angle, so the
  // pixel shader lays its texels out in world units like every other surface.
  const allWood: number[] = [];
  const allBarkAngle: number[] = [];
  // The stem frame (radial = cos*N + sin*B) and (dome angle, stem base height):
  // the pixel shader rebuilds each rib's normal from these once per texel.
  const allAxisN: number[] = [];
  const allAxisB: number[] = [];
  const allSucc: number[] = [];
  let mainStemRadius = 0;
  const flowerAnchors: {
    position: THREE.Vector3;
    direction: THREE.Vector3;
    radius: number;
    isMain: boolean;
  }[] = [];
  const radialSegments = numRibs * WOOD_LOD.cactusRadial; // 56 vertices per ring for crisp stylized ridge definition
  // depth of the grooves between ribs: shallow, so the stem reads as a
  // smooth column with soft ribs rather than a deeply fluted one
  const ribDepthFactor = 0.06;

  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allUvs: number[] = [];
  const allIndices: number[] = [];
  let indexOffset = 0;

  // Spine areoles collection for instanced/merged needle placement
  interface AreolePoint {
    pos: THREE.Vector3;
    normal: THREE.Vector3;
    angle: number;
    stemY: number;
  }
  const areolePoints: AreolePoint[] = [];

  stemPaths.forEach((stem) => {
    const curve = new THREE.CatmullRomCurve3(stem.points);
    const tubeLength = curve.getLength();
    const lengthSteps = Math.max(16, Math.min(60, Math.floor(tubeLength * 5.5)));

    // Frenet frames along the curve
    const frames = curve.computeFrenetFrames(lengthSteps, false);

    // Domed cap configuration at the apex
    const domeSteps = 6;
    const totalRings = lengthSteps + 1 + domeSteps;

    const ringStartIndices: number[] = [];
    const stemRepRadius = taperedRepresentativeRadius(stem.radiusStart, stem.radiusEnd);
    if (stem.isMainTrunk || mainStemRadius === 0) mainStemRadius = stemRepRadius;
    const stemBaseY = curve.getPointAt(0).y;

    // A) Main stem rings
    for (let i = 0; i <= lengthSteps; i++) {
      const t = i / lengthSteps;
      // The main column stands on the ground: its foot ring is levelled so a
      // leaning column does not lift off on one side. Arms start inside the
      // trunk and keep their plain frames.
      const grounded = stem.isMainTrunk
        ? groundedRingFrame(
            curve.getPointAt(t),
            frames.tangents[i],
            frames.normals[i],
            frames.binormals[i],
            t * tubeLength,
            1.0
          )
        : { center: curve.getPointAt(t), normal: frames.normals[i], binormal: frames.binormals[i] };
      const point = grounded.center;
      const normal = grounded.normal;
      const binormal = grounded.binormal;

      // Taper and base flare
      const stemRadius = THREE.MathUtils.lerp(stem.radiusStart, stem.radiusEnd, t);
      const flare = stem.isMainTrunk ? 1.0 + Math.pow(Math.max(0, 1.0 - t * 4.0), 2.5) * (config.rootSpread ? (config.rootSpread - 1.0) * 0.4 : 0.25) : 1.0;
      const ringRadius = stemRadius * flare;

      ringStartIndices.push(indexOffset);

      for (let j = 0; j <= radialSegments; j++) {
        const theta = (j / radialSegments) * Math.PI * 2;
        // Rib modulation: cosine peaks along the circumference
        const ribMod = 1.0 + Math.cos(theta * numRibs) * ribDepthFactor;
        const currentR = ringRadius * ribMod;

        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const radialDir = new THREE.Vector3()
          .addScaledVector(normal, cosT)
          .addScaledVector(binormal, sinT)
          .normalize();

        const vPos = point.clone().addScaledVector(radialDir, currentR);

        // Approximate normal accounting for ribs
        const ribSlope = -Math.sin(theta * numRibs) * numRibs * ribDepthFactor;
        const tangentCirc = new THREE.Vector3()
          .addScaledVector(normal, -sinT)
          .addScaledVector(binormal, cosT)
          .normalize();
        const ribbedNormal = radialDir.clone().addScaledVector(tangentCirc, -ribSlope * 0.4).normalize();

        allPositions.push(vPos.x, vPos.y, vPos.z);
        allNormals.push(ribbedNormal.x, ribbedNormal.y, ribbedNormal.z);
        allUvs.push(j / radialSegments, t);
        allWood.push(Math.max(0.03, ringRadius), t * tubeLength, stemRepRadius);
        allBarkAngle.push(cosT, sinT);
        allAxisN.push(normal.x, normal.y, normal.z);
        allAxisB.push(binormal.x, binormal.y, binormal.z);
        allSucc.push(0, stemBaseY);
        indexOffset++;

        // Sample areoles along the rib peaks (crest of the wave: cos(theta * numRibs) ~ 1.0)
        if (i % 3 === 0 && i > 1 && i < lengthSteps - 1) {
          const ribPeakIndex = Math.round((theta * numRibs) / (Math.PI * 2));
          const peakTheta = (ribPeakIndex / numRibs) * Math.PI * 2;
          if (Math.abs(theta - peakTheta) < (Math.PI * 2) / radialSegments * 0.5) {
            areolePoints.push({
              pos: vPos.clone(),
              normal: radialDir.clone(),
              angle: theta,
              stemY: vPos.y,
            });
          }
        }
      }
    }

    // B) Domed Apex Cap (smooth hemispherical closure with converging ribs)
    const apexCenter = curve.getPointAt(1.0);
    const apexTangent = frames.tangents[lengthSteps];
    const apexNormal = frames.normals[lengthSteps];
    const apexBinormal = frames.binormals[lengthSteps];
    const capBaseRadius = stem.radiusEnd;

    for (let d = 1; d <= domeSteps; d++) {
      const capFrac = d / domeSteps;
      // Spherical dome curve
      const phi = capFrac * (Math.PI * 0.5); // 0 to 90 degrees
      const capRadius = capBaseRadius * Math.cos(phi);
      const capElevation = capBaseRadius * Math.sin(phi) * 0.85;

      const domeCenter = apexCenter.clone().addScaledVector(apexTangent, capElevation);
      ringStartIndices.push(indexOffset);

      for (let j = 0; j <= radialSegments; j++) {
        const theta = (j / radialSegments) * Math.PI * 2;
        // Rib modulation smoothly decreases as it converges towards apex center
        // (faster than the dome itself, so the crown is smooth, not a star)
        const ribAtten = Math.pow(Math.cos(phi), 2);
        const ribMod = 1.0 + Math.cos(theta * numRibs) * ribDepthFactor * ribAtten;
        const currentR = capRadius * ribMod;

        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const radialDir = new THREE.Vector3()
          .addScaledVector(apexNormal, cosT)
          .addScaledVector(apexBinormal, sinT)
          .normalize();

        const vPos = domeCenter.clone().addScaledVector(radialDir, currentR);
        const domeNorm = radialDir.clone().multiplyScalar(Math.cos(phi)).addScaledVector(apexTangent, Math.sin(phi)).normalize();

        allPositions.push(vPos.x, vPos.y, vPos.z);
        allNormals.push(domeNorm.x, domeNorm.y, domeNorm.z);
        allUvs.push(j / radialSegments, 1.0 + capFrac * 0.15);
        allWood.push(Math.max(0.03, capRadius), tubeLength + capElevation, stemRepRadius);
        allBarkAngle.push(cosT, sinT);
        allAxisN.push(apexNormal.x, apexNormal.y, apexNormal.z);
        allAxisB.push(apexBinormal.x, apexBinormal.y, apexBinormal.z);
        allSucc.push(phi, stemBaseY);
        indexOffset++;
      }
    }

    // Apex Center Pole Vertex
    const poleIndex = indexOffset;
    const polePos = apexCenter.clone().addScaledVector(apexTangent, capBaseRadius * 0.92);
    allPositions.push(polePos.x, polePos.y, polePos.z);
    allNormals.push(apexTangent.x, apexTangent.y, apexTangent.z);
    allUvs.push(0.5, 1.2);
    allWood.push(Math.max(0.03, capBaseRadius * 0.2), tubeLength + capBaseRadius, stemRepRadius);
    allBarkAngle.push(1, 0);
    allAxisN.push(apexNormal.x, apexNormal.y, apexNormal.z);
    allAxisB.push(apexBinormal.x, apexBinormal.y, apexBinormal.z);
    allSucc.push(Math.PI * 0.5, stemBaseY);
    indexOffset++;

    // Blossom seat: just above where the dome closes (its last ring converges at
    // 0.85 R), so the cup clears the dome and the pollen disc is not buried.
    flowerAnchors.push({
      position: apexCenter.clone().addScaledVector(apexTangent, capBaseRadius * 0.855),
      direction: apexTangent.clone().normalize(),
      radius: capBaseRadius,
      isMain: stem.isMainTrunk,
    });

    // Register branch tip for Korok/apple/flower placements
    branchTips.push({
      position: polePos.clone(),
      normal: apexTangent.clone(),
      scale: stem.isMainTrunk ? 1.0 : 0.85,
    });

    // C) Triangulate tube rings
    for (let r = 0; r < totalRings - 1; r++) {
      const curRing = ringStartIndices[r];
      const nextRing = ringStartIndices[r + 1];

      for (let j = 0; j < radialSegments; j++) {
        const a = curRing + j;
        const b = nextRing + j;
        const c = nextRing + j + 1;
        const d = curRing + j + 1;

        // Counter-clockwise winding for outward-facing normals
        allIndices.push(a, d, b);
        allIndices.push(b, d, c);
      }
    }

    // Connect top dome ring to pole vertex (counter-clockwise outward)
    const topDomeRing = ringStartIndices[totalRings - 1];
    for (let j = 0; j < radialSegments; j++) {
      allIndices.push(topDomeRing + j, topDomeRing + j + 1, poleIndex);
    }
  });

  const cactusGeo = new THREE.BufferGeometry();
  cactusGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  cactusGeo.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
  cactusGeo.setAttribute('uv', new THREE.Float32BufferAttribute(allUvs, 2));
  if (allWood.length === allUvs.length / 2 * 3) {
    cactusGeo.setAttribute('aWood', new THREE.Float32BufferAttribute(allWood, 3));
    cactusGeo.setAttribute('aBarkAngle', new THREE.Float32BufferAttribute(allBarkAngle, 2));
    cactusGeo.setAttribute('aAxisN', new THREE.Float32BufferAttribute(allAxisN, 3));
    cactusGeo.setAttribute('aAxisB', new THREE.Float32BufferAttribute(allAxisB, 3));
    cactusGeo.setAttribute('aSucc', new THREE.Float32BufferAttribute(allSucc, 2));
  }
  cactusGeo.setIndex(allIndices);
  cactusGeo.computeVertexNormals();

  geometriesToDispose.push(cactusGeo);

  // -------------------------------------------------------------
  // 3. SPECIALIZED BOTW GERUDO CACTUS SHADER MATERIAL
  // Rich succulent cel-shading with rib groove shadows & sunlit rim
  // -------------------------------------------------------------
  const cactusTopColor = new THREE.Color(config.foliageColorTop || '#7ebd38'); // bright sunlit sage green
  const cactusBottomColor = new THREE.Color(config.foliageColorBottom || '#3e7423'); // deep desert shadow green
  const cactusRidgeHighlight = new THREE.Color('#98db44'); // sun-kissed ridge peak
  const desertSunlight = new THREE.Color('#fff2a3');

  const cactusMaterial = config.pixelTextureEnabled !== false
    ? createPixelSucculentMaterial(config, sharedUniforms, numRibs, trunkHeight, mainStemRadius, ribDepthFactor)
    : new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uColorTop: { value: cactusTopColor },
      uColorBottom: { value: cactusBottomColor },
      uColorRidge: { value: cactusRidgeHighlight },
      uSunColor: { value: desertSunlight },
      uHeight: { value: trunkHeight },
      uNumRibs: { value: numRibs },
      uRimIntensity: { value: config.rimLightIntensity ?? 1.15 },
    },
    side: THREE.FrontSide,
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      uniform float uHeight;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vHeightFrac;

      void main() {
        vUv = uv;
        // Transform normal to world space for consistent directional lighting and rim light
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

        vec3 pos = position;
        vHeightFrac = clamp(pos.y / uHeight, 0.0, 1.0);

        // Subtle, heavy rigid succulent sway in desert winds
        float sway = pow(vHeightFrac, 1.8) * uWindStrength * 0.12;
        float windWave = sin(uTime * uWindSpeed * 1.2 + pos.y * 0.3) * sway;
        pos.x += windWave;
        pos.z += cos(uTime * uWindSpeed * 0.9 + pos.y * 0.25) * sway * 0.6;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColorTop;
      uniform vec3 uColorBottom;
      uniform vec3 uColorRidge;
      uniform vec3 uSunColor;
      uniform vec3 uLightDir;
      uniform float uRimIntensity;
      uniform float uNumRibs;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vHeightFrac;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(uLightDir);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);

        // 1. Base Height Gradient (sunlit desert crown to deep grounded base)
        vec3 baseColor = mix(uColorBottom, uColorTop, smoothstep(0.05, 0.9, vHeightFrac));

        // 2. Rib Groove Occlusion & Ridge Highlight
        // Calculate rib phase from UV coordinates
        float ribPhase = cos(vUv.x * uNumRibs * 6.2831853);
        // Grooves are darker, ridges are lighter
        float grooveShade = smoothstep(-0.8, 0.7, ribPhase);
        baseColor = mix(baseColor * 0.72, baseColor, grooveShade);
        if (ribPhase > 0.82) {
          baseColor = mix(baseColor, uColorRidge, (ribPhase - 0.82) * 2.5);
        }

        // 3. BotW NPR 3-Step Cel-Shading
        float NdotL = dot(normal, lightDir);
        float celLight;
        if (NdotL > 0.45) {
          celLight = 1.0;
        } else if (NdotL > -0.05) {
          celLight = 0.68;
        } else {
          celLight = 0.42;
        }

        vec3 litColor = baseColor * mix(vec3(0.5, 0.58, 0.45), uSunColor, celLight);

        // 4. Warm Desert Sunlit Rim Light
        float fresnel = 1.0 - max(dot(normal, viewDir), 0.0);
        float rimFactor = pow(fresnel, 3.2) * smoothstep(-0.2, 0.8, NdotL);
        vec3 rimColor = vec3(1.0, 0.92, 0.65) * rimFactor * uRimIntensity;

        gl_FragColor = vec4(litColor + rimColor, 1.0);
      }
    `,
  });

  materialsToDispose.push(cactusMaterial);

  const woodMesh = new THREE.Mesh(cactusGeo, cactusMaterial);
  woodMesh.name = 'GerudoCactusWood';
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;

  // -------------------------------------------------------------
  // 4. RADIAL SPINES & AREOLES ALONG THE RIBS
  // Instanced clusters of thin golden spines protecting the ribs
  // -------------------------------------------------------------
  const spineCountPerAreole = 4;
  const totalSpineInstances = Math.min(600, areolePoints.length * spineCountPerAreole);

  if (totalSpineInstances > 0) {
    const spineGeo = new THREE.ConeGeometry(0.014, 0.22, 3);
    spineGeo.translate(0, 0.11, 0);
    spineGeo.rotateX(Math.PI * 0.5); // point along +Z
    geometriesToDispose.push(spineGeo);

    const spineMaterial = new THREE.MeshBasicMaterial({
      color: 0xfae19c, // desert bleached spine gold
    });
    materialsToDispose.push(spineMaterial);

    const spineInstMesh = new THREE.InstancedMesh(spineGeo, spineMaterial, totalSpineInstances);
    spineInstMesh.name = 'CactusSpines';

    const dummy = new THREE.Object3D();
    let instIdx = 0;

    // Distribute spines among areoles
    const step = Math.max(1, Math.floor(areolePoints.length / (totalSpineInstances / spineCountPerAreole)));
    for (let a = 0; a < areolePoints.length && instIdx < totalSpineInstances; a += step) {
      const areole = areolePoints[a];

      for (let s = 0; s < spineCountPerAreole && instIdx < totalSpineInstances; s++) {
        dummy.position.copy(areole.pos);
        dummy.lookAt(areole.pos.clone().add(areole.normal));

        // Fan out radially from areole center with slight downward tilt
        const spreadAngle = (s / spineCountPerAreole) * Math.PI * 2;
        dummy.rotateZ(spreadAngle);
        dummy.rotateX(0.35 + (s % 2) * 0.18); // tilt outward
        dummy.scale.set(1, 1, 0.8 + (s % 3) * 0.2);

        dummy.updateMatrix();
        spineInstMesh.setMatrixAt(instIdx++, dummy.matrix);
      }
    }

    spineInstMesh.instanceMatrix.needsUpdate = true;
    foliageGroup.add(spineInstMesh);
  }

  // -------------------------------------------------------------
  // 4b. PIXEL-ART BLOSSOMS ON THE APICES
  // A blossom is an occasional event, not a fixture: only about one cactus in
  // three flowers at all, and one that does usually carries a single blossom,
  // with a second one now and then. Decided by the seed - hashed rather than
  // drawn from rnd() so the flowers leave every other random choice of the
  // cactus unchanged.
  // -------------------------------------------------------------
  const BLOOM_CHANCE = 0.33;        // share of cacti that flower at all
  const EXTRA_BLOSSOM_CHANCE = 0.07; // per remaining apex, once a cactus flowers
  const seedBase = Math.floor(config.textureSeed ?? config.seed ?? 1);
  const bloomHash = (k: number) =>
    Math.abs(Math.sin((seedBase + 1) * 12.9898 + k * 78.233) * 43758.5453) % 1;
  if (
    config.pixelTextureEnabled !== false &&
    flowerAnchors.length > 0 &&
    bloomHash(-1) < BLOOM_CHANCE
  ) {
    const texel = (cactusMaterial as THREE.ShaderMaterial).uniforms?.uTexelSize?.value ?? 0.05;
    const up = new THREE.Vector3(0, 1, 0);
    // the apex with the lowest hash always carries the blossom
    let first = 0;
    flowerAnchors.forEach((_, i) => { if (bloomHash(i) < bloomHash(first)) first = i; });
    flowerAnchors.forEach((anchor, i) => {
      if (i !== first && bloomHash(i + 101) > EXTRA_BLOSSOM_CHANCE) return;
      const flower = buildPixelCactusFlower(config, sharedUniforms, {
        texelSize: texel,
        swayHeight: trunkHeight,
        // almost as wide as the apex: on a tall column a smaller blossom
        // shrinks to a speck at any normal viewing distance
        size: (anchor.radius * 0.85) / 0.12,
        variant: i + 1,
      });
      flower.group.position.copy(anchor.position);
      flower.group.quaternion.setFromUnitVectors(up, anchor.direction);
      flower.geometries.forEach((g) => geometriesToDispose.push(g));
      flower.materials.forEach((m) => materialsToDispose.push(m));
      foliageGroup.add(flower.group);
    });
  }

  // -------------------------------------------------------------
  // 5. UPDATE LOOP (WIND DYNAMICS)
  // -------------------------------------------------------------
  const update = (time: number, windStrength: number, windSpeed: number) => {
    sharedUniforms.uTime.value = time;
    sharedUniforms.uWindStrength.value = windStrength;
    sharedUniforms.uWindSpeed.value = windSpeed;
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
