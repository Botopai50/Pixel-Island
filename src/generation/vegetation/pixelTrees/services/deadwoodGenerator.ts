// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { SCATreeData } from './spaceColonization';

// Surface-area weighted radius of a linearly tapered tube. A plain average of
// the two ends is dragged down by the thin end, and the bark shader turns that
// into too few ridges for the thick part, which is most of what you see.
function taperedRepresentativeRadius(r1: number, r2: number): number {
  const sum = r1 + r2;
  if (sum < 1e-6) return 0.03;
  return Math.max(0.03, (2 / 3) * (r1 * r1 + r1 * r2 + r2 * r2) / sum);
}

export interface DeadwoodResult {
  woodMesh: THREE.Mesh;
  foliageGroup: THREE.Group;
  materialsToDispose: (THREE.Material | THREE.Material[])[];
  geometriesToDispose: THREE.BufferGeometry[];
  branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[];
  update: (time: number, windStrength: number, windSpeed: number) => void;
}

/**
 * Procedural Zelda: Breath of the Wild Withered / Dead Tree (Árvore Seca de Hyrule).
 * Inspired by the dramatic ancient dead trees and weather-beaten snags found across
 * Central Hyrule plains, Tabantha Tundra, Great Plateau ruins, and Death Mountain foothills.
 *
 * Distinctive BotW Design Features:
 * - Dramatic, gnarled, twisting trunk with deep fluted root flare and root knuckles.
 * - Split shattered crown (lightning-struck snag / broken fork apex) with fibrous wood splinters.
 * - Muscular primary scaffold limbs that sweep in expressive S-curves and angular forks.
 * - Multi-tiered secondary & tertiary antler twigs with sharp needle/stag-horn tapered tips.
 * - Broken snapped branch stubs with jagged fractured ends along the trunk.
 * - Sun-baked arid steppe mound with weathered boulders and dry brittle tufts.
 * - Smooth, continuous geometry with zero detached ribbons or slicing artifacts.
 */
export function buildProceduralDeadwood(
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
): DeadwoodResult {
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: (THREE.Material | THREE.Material[])[] = [];
  const branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[] = [];

  const foliageGroup = new THREE.Group();
  foliageGroup.name = 'BotW_DeadwoodAccessories';

  const trunkHeight = Math.max(4.0, config.trunkHeight ?? 9.5);
  const trunkRadiusBase = Math.max(0.45, config.trunkRadiusBase ?? 1.25);
  const trunkRadiusTop = Math.max(0.18, config.trunkRadiusTop ?? 0.32);
  const curvature = config.trunkCurvature ?? 0.72;
  const twist = config.trunkTwist ?? 0.85;
  const rootSpread = config.rootSpread ?? 1.6;
  const canopySpread = config.canopySpread ?? 1.25;
  const branchCount = Math.max(4, Math.min(18, config.branchCount ?? 10));
  const branchLength = Math.max(2.0, config.branchLength ?? 5.2);
  const branchAngle = config.branchAngle ?? 0.95;
  const branchStartHeight = Math.max(0.25, Math.min(0.65, config.branchStartHeight ?? 0.38));
  const subBranchDensity = config.subBranchDensity ?? 0.85;

  // -------------------------------------------------------------
  // 1. GENERATE DRAMATIC GNARLED MAIN TRUNK WITH SPLIT/SHATTERED APEX
  // -------------------------------------------------------------
  const trunkPoints: THREE.Vector3[] = [];
  const trunkSegments = 24;
  const trunkLeanAngle = (rnd() - 0.5) * Math.PI * 2;
  const leanDir = new THREE.Vector3(Math.cos(trunkLeanAngle), 0, Math.sin(trunkLeanAngle));
  const orthoLeanDir = new THREE.Vector3(-leanDir.z, 0, leanDir.x);

  for (let i = 0; i <= trunkSegments; i++) {
    const t = i / trunkSegments;
    const y = t * trunkHeight;

    // Organic S-curve swaying with dramatic posture
    const primaryBend = Math.sin(t * Math.PI * 0.95) * curvature * 1.6;
    const secondarySway = Math.sin(t * Math.PI * 2.1 + twist) * (curvature * 0.7);
    const spiralOffset = Math.cos(t * Math.PI * 1.5 + twist * 2.0) * (curvature * 0.4);

    const x = leanDir.x * primaryBend + orthoLeanDir.x * secondarySway + spiralOffset;
    const z = leanDir.z * primaryBend + orthoLeanDir.z * secondarySway - spiralOffset;

    trunkPoints.push(new THREE.Vector3(x, y, z));
  }

  const trunkCurve = new THREE.CatmullRomCurve3(trunkPoints);

  // Collect all branch and trunk splines for mesh generation
  interface DeadwoodSpline {
    curve: THREE.CatmullRomCurve3;
    rStart: number;
    rEnd: number;
    isTrunk: boolean;
    isBrokenStub?: boolean;
    taperPower?: number;
  }

  const allSplines: DeadwoodSpline[] = [];

  // Main Trunk Spline
  allSplines.push({
    curve: trunkCurve,
    rStart: trunkRadiusBase,
    rEnd: trunkRadiusTop,
    isTrunk: true,
    taperPower: 0.85,
  });

  const trunkApexPos = trunkCurve.getPoint(1.0);
  const trunkApexTangent = trunkCurve.getTangent(1.0).normalize();

  // -------------------------------------------------------------
  // 2. SHATTERED CROWN FORK / LIGHTNING SPLIT AT THE TRUNK APEX
  // -------------------------------------------------------------
  // The iconic BotW withered tree has a dramatic double-horned or jagged broken crown
  const crownForks = 2 + Math.floor(rnd() * 2); // 2 to 3 crown leaders
  for (let f = 0; f < crownForks; f++) {
    const forkFrac = f / crownForks;
    const forkAngle = forkFrac * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    const forkPitch = 0.35 + rnd() * 0.45;
    const forkLength = branchLength * (0.45 + rnd() * 0.35);

    const forkDir = new THREE.Vector3(
      Math.cos(forkAngle) * Math.sin(forkPitch),
      Math.cos(forkPitch) * 0.9 + 0.3,
      Math.sin(forkAngle) * Math.sin(forkPitch)
    ).normalize();

    const p0 = trunkApexPos.clone();
    const p1 = p0.clone().add(forkDir.clone().multiplyScalar(forkLength * 0.45)).add(
      new THREE.Vector3((rnd() - 0.5) * 0.4, (rnd() - 0.2) * 0.3, (rnd() - 0.5) * 0.4)
    );
    const p2 = p0.clone().add(forkDir.clone().multiplyScalar(forkLength)).add(
      new THREE.Vector3((rnd() - 0.5) * 0.5, 0.4 + rnd() * 0.4, (rnd() - 0.5) * 0.5)
    );

    const forkCurve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const isBrokenFork = f === 0 && rnd() > 0.4;

    allSplines.push({
      curve: forkCurve,
      rStart: trunkRadiusTop * 0.85,
      rEnd: isBrokenFork ? trunkRadiusTop * 0.4 : 0.03,
      isTrunk: false,
      isBrokenStub: isBrokenFork,
      taperPower: 1.1,
    });

    branchTips.push({
      position: p2,
      normal: forkDir,
      scale: 1.0,
    });

    // Sub-twigs off the crown fork
    if (!isBrokenFork && subBranchDensity > 0.2) {
      const subCount = 2 + Math.floor(rnd() * 2);
      for (let s = 0; s < subCount; s++) {
        const subT = 0.45 + (s / subCount) * 0.45;
        const subOrigin = forkCurve.getPoint(subT);
        const subAngle = forkAngle + (s % 2 === 0 ? 1.1 : -1.1) + (rnd() - 0.5) * 0.3;
        const subDir = new THREE.Vector3(
          Math.cos(subAngle) * 0.7,
          0.6 + rnd() * 0.4,
          Math.sin(subAngle) * 0.7
        ).normalize();

        const subLen = forkLength * (0.35 + rnd() * 0.3);
        const subEnd = subOrigin.clone().add(subDir.multiplyScalar(subLen));
        const subMid = subOrigin.clone().lerp(subEnd, 0.5).add(new THREE.Vector3((rnd() - 0.5) * 0.2, 0.1, (rnd() - 0.5) * 0.2));

        allSplines.push({
          curve: new THREE.CatmullRomCurve3([subOrigin, subMid, subEnd]),
          rStart: trunkRadiusTop * 0.38,
          rEnd: 0.02,
          isTrunk: false,
          taperPower: 1.2,
        });

        branchTips.push({
          position: subEnd,
          normal: subDir,
          scale: 0.7,
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 3. PRIMARY SCAFFOLD LIMBS (GALHOS MESTRES SINUOSOS)
  // -------------------------------------------------------------
  const mainBranchCount = branchCount;
  for (let b = 0; b < mainBranchCount; b++) {
    const tStart = branchStartHeight + ((1.0 - branchStartHeight) * (b / (mainBranchCount - 1 || 1))) * (0.92 + rnd() * 0.08);
    const bOrigin = trunkCurve.getPoint(tStart);
    const trunkTangent = trunkCurve.getTangent(tStart).normalize();
    const trunkRadiusAtStart = THREE.MathUtils.lerp(trunkRadiusBase, trunkRadiusTop, Math.pow(tStart, 0.85));

    // Golden spiral angle distribution around trunk
    const bAngle = b * 2.39996 + (rnd() - 0.5) * 0.4;
    const isSnappedStub = b > 0 && b % 4 === 0 && rnd() > 0.3; // Staggered broken stubs
    const lengthMultiplier = isSnappedStub ? 0.22 + rnd() * 0.15 : 0.8 + rnd() * 0.45;
    const bLength = branchLength * lengthMultiplier * (1.0 - tStart * 0.35) * canopySpread;

    const outPitch = (branchAngle * 0.8 + (rnd() - 0.5) * 0.25) * Math.PI * 0.45;
    const radialDir = new THREE.Vector3(Math.cos(bAngle), 0, Math.sin(bAngle));

    // Expressive S-Curve path for dead branches:
    // 1. Emerge outward & slightly up
    // 2. Dip downward under weight of massive deadwood
    // 3. Curve upward again at the jagged claw/antler tips!
    const p0 = bOrigin.clone().addScaledVector(radialDir, trunkRadiusAtStart * 0.35);

    const midReach = bLength * 0.48;
    const p1 = p0.clone()
      .addScaledVector(radialDir, midReach)
      .add(new THREE.Vector3(0, Math.sin(outPitch) * (bLength * 0.28) - (isSnappedStub ? 0 : 0.45), 0))
      .add(new THREE.Vector3((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4));

    const endReach = bLength;
    const p2 = p0.clone()
      .addScaledVector(radialDir, endReach)
      .add(new THREE.Vector3(
        (rnd() - 0.5) * 0.6,
        Math.sin(outPitch) * (bLength * 0.4) + (isSnappedStub ? 0.1 : 0.35 + rnd() * 0.45),
        (rnd() - 0.5) * 0.6
      ));

    const bCurve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const bBaseRadius = trunkRadiusAtStart * (isSnappedStub ? 0.55 : 0.48);
    const bEndRadius = isSnappedStub ? bBaseRadius * 0.65 : 0.025;

    allSplines.push({
      curve: bCurve,
      rStart: bBaseRadius,
      rEnd: bEndRadius,
      isTrunk: false,
      isBrokenStub: isSnappedStub,
      taperPower: isSnappedStub ? 0.6 : 1.05,
    });

    if (!isSnappedStub) {
      branchTips.push({
        position: p2,
        normal: p2.clone().sub(p1).normalize(),
        scale: 1.0,
      });

      // ---------------------------------------------------------
      // 4. SECONDARY & TERTIARY DRY ANTLER TWIGS
      // ---------------------------------------------------------
      if (subBranchDensity > 0.15) {
        const subCount = Math.max(1, Math.round(2 * subBranchDensity + rnd() * 2));
        for (let s = 0; s < subCount; s++) {
          const subT = 0.38 + (s / (subCount + 0.5)) * 0.52;
          const subOrigin = bCurve.getPoint(subT);
          const subRadiusAtStart = THREE.MathUtils.lerp(bBaseRadius, bEndRadius, subT) * 0.7;

          // Fork at sharp botanical angles (stag antler forks)
          const sideSign = s % 2 === 0 ? 1 : -1;
          const forkAngleOffset = sideSign * (0.75 + rnd() * 0.45);
          const subDir2D = new THREE.Vector2(radialDir.x, radialDir.z).rotateAround(new THREE.Vector2(0, 0), forkAngleOffset);
          const subLength = bLength * (0.35 + rnd() * 0.35);

          const sp0 = subOrigin.clone();
          const sp1 = sp0.clone().add(new THREE.Vector3(
            subDir2D.x * (subLength * 0.5),
            subLength * 0.25 + (rnd() - 0.3) * 0.2,
            subDir2D.y * (subLength * 0.5)
          ));
          const sp2 = sp0.clone().add(new THREE.Vector3(
            subDir2D.x * subLength + (rnd() - 0.5) * 0.3,
            subLength * (0.55 + rnd() * 0.35),
            subDir2D.y * subLength + (rnd() - 0.5) * 0.3
          ));

          const subCurve = new THREE.CatmullRomCurve3([sp0, sp1, sp2]);
          allSplines.push({
            curve: subCurve,
            rStart: subRadiusAtStart,
            rEnd: 0.02,
            isTrunk: false,
            taperPower: 1.15,
          });

          branchTips.push({
            position: sp2,
            normal: sp2.clone().sub(sp1).normalize(),
            scale: 0.75,
          });

          // Tertiary sharp twiglets (pontas finas de gravetos secos)
          if (subBranchDensity > 0.6 && rnd() > 0.4) {
            const tertT = 0.5 + rnd() * 0.35;
            const tertOrigin = subCurve.getPoint(tertT);
            const tertDir = new THREE.Vector3(
              (rnd() - 0.5) * 0.8 + subDir2D.x * 0.5,
              0.6 + rnd() * 0.4,
              (rnd() - 0.5) * 0.8 + subDir2D.y * 0.5
            ).normalize();
            const tertLen = subLength * (0.4 + rnd() * 0.3);
            const tertEnd = tertOrigin.clone().add(tertDir.multiplyScalar(tertLen));

            allSplines.push({
              curve: new THREE.CatmullRomCurve3([tertOrigin, tertEnd]),
              rStart: subRadiusAtStart * 0.5,
              rEnd: 0.015,
              isTrunk: false,
              taperPower: 1.3,
            });

            branchTips.push({
              position: tertEnd,
              normal: tertDir,
              scale: 0.5,
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 5. MESH CONSTRUCTION: CONTINUOUS TUBES WITH ROTATION-MINIMIZING FRAMES
  // -------------------------------------------------------------
  const fullTreePositions: number[] = [];
  const fullTreeNormals: number[] = [];
  const fullTreeUvs: number[] = [];
  // Wood metrics for the bark shader: (ring radius m, arc length m, spline mean
  // radius m) plus (cos, sin) of the ring angle. Without these this mesh falls
  // back to a UV-space mapping and ends up with its own pixel scale and its own
  // ridge phase, unrelated to the rest of the tree.
  const fullTreeWood: number[] = [];
  const fullTreeAngle: number[] = [];
  const fullTreeIndices: number[] = [];
  let vertOffset = 0;

  allSplines.forEach((spline) => {
    const radialSegs = spline.isTrunk ? 20 : 8;
    const tubularSegs = spline.isTrunk ? 32 : (spline.isBrokenStub ? 6 : 14);
    const samplePoints: THREE.Vector3[] = [];
    const tangents: THREE.Vector3[] = [];

    for (let i = 0; i <= tubularSegs; i++) {
      const t = i / tubularSegs;
      samplePoints.push(spline.curve.getPoint(t));
      tangents.push(spline.curve.getTangent(t).normalize());
    }

    // Parallel transport frame
    const normalFrames: { u: THREE.Vector3; v: THREE.Vector3 }[] = [];
    let initialU = new THREE.Vector3().crossVectors(tangents[0], new THREE.Vector3(0, 1, 0));
    if (initialU.lengthSq() < 0.001) {
      initialU = new THREE.Vector3().crossVectors(tangents[0], new THREE.Vector3(1, 0, 0));
    }
    initialU.normalize();
    let initialV = new THREE.Vector3().crossVectors(tangents[0], initialU).normalize();
    normalFrames.push({ u: initialU, v: initialV });

    for (let i = 1; i <= tubularSegs; i++) {
      const prevT = tangents[i - 1];
      const currT = tangents[i];
      const prevU = normalFrames[i - 1].u.clone();

      const rotAxis = new THREE.Vector3().crossVectors(prevT, currT);
      if (rotAxis.lengthSq() > 1e-6) {
        const angle = prevT.angleTo(currT);
        rotAxis.normalize();
        prevU.applyAxisAngle(rotAxis, angle);
      }
      prevU.sub(currT.clone().multiplyScalar(prevU.dot(currT))).normalize();
      const currV = new THREE.Vector3().crossVectors(currT, prevU).normalize();
      normalFrames.push({ u: prevU, v: currV });
    }

    const startVert = vertOffset;
    let accumulatedLength = 0;
    const splineMeanRadius = taperedRepresentativeRadius(spline.rStart, spline.rEnd);

    for (let i = 0; i <= tubularSegs; i++) {
      const t = i / tubularSegs;
      const pt = samplePoints[i];
      if (i > 0) {
        accumulatedLength += pt.distanceTo(samplePoints[i - 1]);
      }

      const taper = Math.pow(t, spline.taperPower ?? 1.0);
      let r = THREE.MathUtils.lerp(spline.rStart, spline.rEnd, taper);

      const frame = normalFrames[i];
      const isTrunkBase = spline.isTrunk && pt.y < 2.5;
      const groundFactor = isTrunkBase ? Math.pow(Math.max(0, 1.0 - pt.y / 2.5), 2.0) : 0;

      for (let j = 0; j <= radialSegs; j++) {
        const frac = j / radialSegs;
        const angle = frac * Math.PI * 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        // Fluted gnarled buttress roots at the trunk base (5 prominent weathered root knuckles)
        let flute = 1.0;
        if (isTrunkBase) {
          flute += rootSpread * groundFactor * (0.65 + 0.3 * Math.cos(angle * 4.0 + twist * 2.0));
        }

        // Deadwood longitudinal ribs/fissures
        const woodGrainRib = spline.isTrunk ? 1.0 + Math.sin(angle * 8.0 + pt.y * 1.5) * 0.04 : 1.0;
        const effectiveR = r * flute * woodGrainRib;

        const nX = frame.u.x * cosA + frame.v.x * sinA;
        const nY = frame.u.y * cosA + frame.v.y * sinA;
        const nZ = frame.u.z * cosA + frame.v.z * sinA;

        let pX = pt.x + nX * effectiveR;
        let pY = pt.y + nY * effectiveR;
        let pZ = pt.z + nZ * effectiveR;

        // Submerge ground anchor ring firmly into the soil
        if (spline.isTrunk && i === 0) {
          pY = Math.min(-0.06, pY);
        }

        fullTreePositions.push(pX, pY, pZ);

        fullTreeNormals.push(nX, nY, nZ);
        fullTreeUvs.push(frac, accumulatedLength * 0.35);
        fullTreeWood.push(Math.max(0.03, r), accumulatedLength, splineMeanRadius);
        fullTreeAngle.push(cosA, sinA);
        vertOffset++;
      }
    }

    // Connect adjacent rings
    const vertsPerRing = radialSegs + 1;
    for (let i = 0; i < tubularSegs; i++) {
      const ring1Start = startVert + i * vertsPerRing;
      const ring2Start = startVert + (i + 1) * vertsPerRing;

      for (let j = 0; j < radialSegs; j++) {
        const a = ring1Start + j;
        const b = ring2Start + j;
        const c = ring2Start + (j + 1);
        const d = ring1Start + (j + 1);

        fullTreeIndices.push(a, d, b);
        fullTreeIndices.push(b, d, c);
      }
    }

    // End cap (splintered flat face for broken stubs, or cone tip for branches)
    const tipRingStart = startVert + tubularSegs * vertsPerRing;
    const tipPos = samplePoints[samplePoints.length - 1];
    const tipNormal = tangents[tangents.length - 1];

    fullTreePositions.push(tipPos.x, tipPos.y, tipPos.z);
    fullTreeNormals.push(tipNormal.x, tipNormal.y, tipNormal.z);
    fullTreeUvs.push(0.5, (accumulatedLength + 0.05) * 0.35);
    fullTreeWood.push(Math.max(0.03, spline.rEnd), accumulatedLength + 0.05, splineMeanRadius);
    fullTreeAngle.push(1, 0);
    const tipCenterVert = vertOffset;
    vertOffset++;

    for (let j = 0; j < radialSegs; j++) {
      fullTreeIndices.push(tipRingStart + j, tipRingStart + j + 1, tipCenterVert);
    }

    // Solid bottom cap for deadwood trunk base
    if (spline.isTrunk) {
      const bottomPos = samplePoints[0].clone();
      bottomPos.y = -0.08;
      fullTreePositions.push(bottomPos.x, bottomPos.y, bottomPos.z);
      fullTreeNormals.push(0, -1, 0);
      fullTreeUvs.push(0.5, 0);
      fullTreeWood.push(Math.max(0.03, spline.rStart), 0, splineMeanRadius);
      fullTreeAngle.push(1, 0);
      const bottomCenterVert = vertOffset;
      vertOffset++;

      const bottomRingStart = startVert;
      for (let j = 0; j < radialSegs; j++) {
        fullTreeIndices.push(bottomCenterVert, bottomRingStart + j + 1, bottomRingStart + j);
      }
    }
  });

  const deadwoodGeo = new THREE.BufferGeometry();
  deadwoodGeo.setAttribute('position', new THREE.Float32BufferAttribute(fullTreePositions, 3));
  deadwoodGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fullTreeNormals, 3));
  deadwoodGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fullTreeUvs, 2));
  deadwoodGeo.setAttribute('aWood', new THREE.Float32BufferAttribute(fullTreeWood, 3));
  deadwoodGeo.setAttribute('aBarkAngle', new THREE.Float32BufferAttribute(fullTreeAngle, 2));
  deadwoodGeo.setIndex(fullTreeIndices);
  deadwoodGeo.computeVertexNormals();

  geometriesToDispose.push(deadwoodGeo);
  const woodMesh = new THREE.Mesh(deadwoodGeo, barkMaterial);
  woodMesh.name = 'BotW_DeadwoodMainWood';
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;

  // (The steppe boulders by its roots are laid out with the ground, by the
  // rock system: seeded, in the pixel style, and never part of the tree.)

  // -------------------------------------------------------------
  // 7. WIND SWAY ANIMATOR FOR DEADWOOD SKELETON
  // -------------------------------------------------------------
  const update = (time: number, windStrength: number, windSpeed: number) => {
    const sway = Math.sin(time * windSpeed * 1.2) * 0.015 * windStrength;
    const shudder = Math.cos(time * windSpeed * 2.8) * 0.008 * windStrength;
    woodMesh.rotation.z = sway + shudder;
    woodMesh.rotation.x = Math.cos(time * windSpeed * 0.9) * 0.012 * windStrength;
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
