// @ts-nocheck
import * as THREE from 'three';
import { bracketSprite, spriteMaterial } from './pixelSprites';
import { treeMushroomCard } from './mushroomRotation';
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

export interface SwampAccessoriesResult {
  group: THREE.Group;
  materialsToDispose: (THREE.Material | THREE.Material[])[];
  geometriesToDispose: THREE.BufferGeometry[];
  update: (time: number, windStrength: number, windSpeed: number) => void;
}

/**
 * Builds the authentic Swamp Mangrove prop roots (raízes escoras) and ecosystem
 * using the EXACT same bark material as the Space Colonization tree.
 *
 * Guarantees:
 * 1. Tree trunk and branches are 100% Space Colonization.
 * 2. Tree and roots share the exact same bark material — 100% identical color, shading, and texture.
 * 3. Proportional, natural root dimensions — no towering or giant spider legs.
 * 4. Staggered purple shelf mushrooms (bracket fungi) along root arches.
 * 5. Spanish moss / weeping vines hanging directly from Space Colonization branches.
 * 6. Murky swamp water pool with Victoria lily pads and lotuses.
 */
export function buildSwampRootsAndAccessories(
  config: TreeConfig,
  scaData: Pick<SCATreeData, 'allNodes'>,
  barkMaterial: THREE.Material,
  sharedUniforms: {
    uTime: { value: number };
    uWindStrength: { value: number };
    uWindSpeed: { value: number };
    uLightDir: { value: THREE.Vector3 };
  },
  branchTips: { position: THREE.Vector3; normal: THREE.Vector3; scale: number }[],
  rnd: () => number,
  rootAngleFilter?: (angle: number) => boolean
): SwampAccessoriesResult {
  const group = new THREE.Group();
  group.name = 'Swamp_EcosystemGroup';

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: (THREE.Material | THREE.Material[])[] = [];

  const trunkBaseR = config.trunkRadiusBase ?? 1.35;
  const rootCount = Math.max(3, Math.min(14, config.aerialRootCount ?? 8));
  // Proportional spread (supporting wider majestic stilt radius)
  const spreadMult = Math.max(0.5, Math.min(2.8, config.aerialRootSpread ?? 1.40));
  // Proportional emergence height: strictly around 0.5m to 2.8m
  const maxEmergenceH = Math.max(0.5, Math.min(2.8, config.aerialRootHeight ?? 1.8));

  // -------------------------------------------------------------
  // 1. PROPORTIONAL STILT ROOTS (RAÍZES ESCORAS)
  // Shared with the exact same barkMaterial!
  // -------------------------------------------------------------
  interface RootCurve {
    points: THREE.Vector3[];
    rStart: number;
    rEnd: number;
  }
  const rootCurves: RootCurve[] = [];
  const mushroomAnchors: { pos: THREE.Vector3; normal: THREE.Vector3 }[] = [];

  // Find lower trunk nodes to get the real trunk centerline
  const lowerTrunkNodes = scaData.allNodes
    .filter((n) => n.isTrunk && n.position.y <= maxEmergenceH * 1.5)
    .sort((a, b) => a.position.y - b.position.y);

  function getTrunkCenterAtY(y: number): THREE.Vector3 {
    if (lowerTrunkNodes.length === 0) return new THREE.Vector3(0, y, 0);
    for (let i = 0; i < lowerTrunkNodes.length - 1; i++) {
      const n1 = lowerTrunkNodes[i];
      const n2 = lowerTrunkNodes[i + 1];
      if (y >= n1.position.y && y <= n2.position.y) {
        const factor = (y - n1.position.y) / Math.max(0.001, n2.position.y - n1.position.y);
        return n1.position.clone().lerp(n2.position, factor);
      }
    }
    return new THREE.Vector3(0, y, 0);
  }

  for (let r = 0; r < rootCount; r++) {
    const angleFrac = r / rootCount;
    const angle = angleFrac * Math.PI * 2 + (rnd() - 0.5) * 0.28;
    if (rootAngleFilter && !rootAngleFilter(angle)) continue;
    const radDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
    const tanDir = new THREE.Vector3(-radDir.z, 0, radDir.x);

    // Staggered emergence height near trunk base
    const minEmergenceH = Math.min(0.5, maxEmergenceH * 0.5);
    const emergenceY = THREE.MathUtils.lerp(minEmergenceH, maxEmergenceH, (r % 3) / 2.0 + (rnd() - 0.5) * 0.12);
    const trunkCenter = getTrunkCenterAtY(emergenceY);
    const trunkRadiusAtEmergence = THREE.MathUtils.lerp(trunkBaseR * 0.95, trunkBaseR * 0.72, Math.min(1.0, emergenceY / 2.5));

    // Proportional knee distance & ground distance - pronounced wide arch providing strong stilt stance
    const kneeDist = (trunkRadiusAtEmergence + 1.05 * spreadMult) * (0.95 + rnd() * 0.12);
    const groundDist = (trunkBaseR + 1.25 * spreadMult) * (0.95 + rnd() * 0.14);
    const kneeY = emergenceY * 0.58 + 0.28 + (rnd() - 0.5) * 0.10;
    const lateralSway = (rnd() - 0.5) * 0.25;

    // 0: Inside trunk core (seamless welded anchor)
    const p0 = trunkCenter.clone().addScaledVector(radDir, trunkRadiusAtEmergence * 0.25);
    // 1: Emerging through bark surface
    const p1 = trunkCenter.clone().addScaledVector(radDir, trunkRadiusAtEmergence * 0.96).add(new THREE.Vector3(0, -0.05, 0));
    // 2: Shoulder arch forming the stilt curve
    const p2 = new THREE.Vector3(
      trunkCenter.x + radDir.x * (trunkRadiusAtEmergence + (kneeDist - trunkRadiusAtEmergence) * 0.52) + tanDir.x * (lateralSway * 0.35),
      kneeY + 0.18,
      trunkCenter.z + radDir.z * (trunkRadiusAtEmergence + (kneeDist - trunkRadiusAtEmergence) * 0.52) + tanDir.z * (lateralSway * 0.35)
    );
    // 3: Muscular knuckle / Knee apex
    const p3 = new THREE.Vector3(
      trunkCenter.x + radDir.x * kneeDist + tanDir.x * lateralSway,
      kneeY,
      trunkCenter.z + radDir.z * kneeDist + tanDir.z * lateralSway
    );
    // 4: Plunging into ground / water with graceful stride
    const p4 = new THREE.Vector3(
      trunkCenter.x + radDir.x * groundDist + tanDir.x * (lateralSway * 1.15),
      0.02,
      trunkCenter.z + radDir.z * groundDist + tanDir.z * (lateralSway * 1.15)
    );
    // 5: Mud anchor below water
    const p5 = new THREE.Vector3(
      p4.x + radDir.x * 0.10,
      -0.35,
      p4.z + radDir.z * 0.10
    );

    const rootStartGirth = Math.max(0.18, trunkBaseR * (0.19 + rnd() * 0.03));
    const rootEndGirth = rootStartGirth * 0.56;

    rootCurves.push({
      points: [p0, p1, p2, p3, p4, p5],
      rStart: rootStartGirth,
      rEnd: rootEndGirth,
    });

    // Anchor shelf mushrooms along the outer flank of the knee
    mushroomAnchors.push({
      pos: p3.clone().add(new THREE.Vector3(tanDir.x * 0.12, 0.04, tanDir.z * 0.12)),
      normal: tanDir.clone().multiplyScalar(rnd() > 0.5 ? 1 : -1),
    });

    // Forked secondary leg for every 2nd root (adds authentic complexity without huge bulk)
    if (r % 2 === 0) {
      const forkAngle = angle + (rnd() > 0.5 ? 0.35 : -0.35);
      const forkDir = new THREE.Vector3(Math.cos(forkAngle), 0, Math.sin(forkAngle));
      const forkGroundDist = groundDist * (0.95 + rnd() * 0.15);

      const fp0 = p3.clone();
      const fp1 = new THREE.Vector3(
        trunkCenter.x + forkDir.x * (groundDist * 0.65),
        kneeY * 0.45,
        trunkCenter.z + forkDir.z * (groundDist * 0.65)
      );
      const fp2 = new THREE.Vector3(
        trunkCenter.x + forkDir.x * forkGroundDist,
        -0.3,
        trunkCenter.z + forkDir.z * forkGroundDist
      );

      rootCurves.push({
        points: [fp0, fp1, fp2],
        rStart: rootStartGirth * 0.65,
        rEnd: rootEndGirth * 0.7,
      });
    }
  }

  // -------------------------------------------------------------
  // BUILD STILT ROOTS BUFFERGEOMETRY
  // -------------------------------------------------------------
  const radialSegments = 10;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  // Wood metrics for the bark shader: (ring radius m, arc length m, root mean
  // radius m) plus (cos, sin) of the ring angle. Without them these stilt roots
  // fall back to a UV-space mapping, so their pixels and their ridges do not
  // match the trunk they grow out of.
  const wood: number[] = [];
  const barkAngle: number[] = [];
  const indices: number[] = [];
  let vertOffset = 0;

  rootCurves.forEach((curveData) => {
    const curve = new THREE.CatmullRomCurve3(curveData.points);
    const length = curve.getLength();
    const lengthSteps = Math.max(6, Math.min(22, Math.floor(length * 5.0)));
    const frames = curve.computeFrenetFrames(lengthSteps, false);

    const ringStartIndices: number[] = [];
    const rootMeanRadius = taperedRepresentativeRadius(curveData.rStart, curveData.rEnd);

    for (let i = 0; i <= lengthSteps; i++) {
      const t = i / lengthSteps;
      const pt = curve.getPointAt(t);
      const normal = frames.normals[i];
      const binormal = frames.binormals[i];

      const r = THREE.MathUtils.lerp(curveData.rStart, curveData.rEnd, t);
      ringStartIndices.push(vertOffset);

      for (let j = 0; j <= radialSegments; j++) {
        const frac = j / radialSegments;
        const a = frac * Math.PI * 2;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);

        // Fluted muscular cross-section (taller than wide, with ridge along spine)
        const flute = 1.0 + Math.abs(cosA) * 0.18 + Math.sin(a * 3.0) * 0.05;
        const effectiveR = r * flute;

        const vNormal = new THREE.Vector3()
          .addScaledVector(normal, cosA)
          .addScaledVector(binormal, sinA)
          .normalize();

        const vPos = new THREE.Vector3()
          .copy(pt)
          .addScaledVector(vNormal, effectiveR);

        positions.push(vPos.x, vPos.y, vPos.z);
        normals.push(vNormal.x, vNormal.y, vNormal.z);
        uvs.push(frac, t * (length / 1.5));
        wood.push(Math.max(0.03, r), t * length, rootMeanRadius);
        barkAngle.push(cosA, sinA);
        vertOffset++;
      }
    }

    for (let i = 0; i < lengthSteps; i++) {
      const r1 = ringStartIndices[i];
      const r2 = ringStartIndices[i + 1];
      for (let j = 0; j < radialSegments; j++) {
        const a = r1 + j;
        const b = r2 + j;
        const c = r2 + j + 1;
        const d = r1 + j + 1;
        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }
  });

  const rootsGeo = new THREE.BufferGeometry();
  rootsGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  rootsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  rootsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  rootsGeo.setAttribute('aWood', new THREE.Float32BufferAttribute(wood, 3));
  rootsGeo.setAttribute('aBarkAngle', new THREE.Float32BufferAttribute(barkAngle, 2));
  rootsGeo.setIndex(indices);
  rootsGeo.computeVertexNormals();
  geometriesToDispose.push(rootsGeo);

  // Uses the EXACT same barkMaterial as the tree! Zero color mismatch!
  const rootsMesh = new THREE.Mesh(rootsGeo, barkMaterial);
  rootsMesh.name = 'Swamp_StiltRoots';
  rootsMesh.castShadow = true;
  rootsMesh.receiveShadow = true;
  group.add(rootsMesh);

  // -------------------------------------------------------------
  // 2. PURPLE SHELF MUSHROOMS (BRACKET FUNGI)
  // Stepped tiers hugging the root curves
  // -------------------------------------------------------------
  const showMushrooms = config.showShelfMushrooms ?? true;
  if (showMushrooms && mushroomAnchors.length > 0) {
    // pixel-art shelves in the violet of the marsh, a lilac pore rim
    const shelfMat = spriteMaterial(bracketSprite('#8e2fb0', '#ecc8f5'));
    materialsToDispose.push(shelfMat);

    // one sprite (three stepped shelves) for every three the count asks for
    const targetCount = Math.min(22, config.shelfMushroomCount ?? 14);
    rootsMesh.updateWorldMatrix(true, false);
    const rootRay = new THREE.Raycaster();
    for (let m = 0; m < targetCount; m += 3) {
      const anchor = mushroomAnchors[(m / 3) % mushroomAnchors.length | 0];
      const width = 0.55 + rnd() * 0.25;
      const at = anchor.pos.clone()
        .add(new THREE.Vector3((rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.1));
      const normal = anchor.normal.clone().normalize();
      rootRay.set(at.clone().addScaledVector(normal, 2), normal.clone().negate());
      rootRay.far = 2.5;
      const hit = rootRay.intersectObject(rootsMesh, false).find(h => h.point.distanceTo(at) < 0.7);
      if (hit?.face) {
        at.copy(hit.point);
        normal.copy(hit.face.normal).transformDirection(rootsMesh.matrixWorld);
      }
      const shelf = treeMushroomCard(shelfMat.map!, width, new THREE.Vector2(0.5, 0.5), at, normal);
      geometriesToDispose.push(shelf.geometry); materialsToDispose.push(shelf.material);
      group.add(shelf.holder);
    }
  }

  // -------------------------------------------------------------
  // 3. HANGING LIANAS & VINES (CIPÓS EM U E PENDENTES)
  // Replicating the distinct looping vines and slender dangling strands
  // hanging from branch to branch and boughs, matching reference image!
  // -------------------------------------------------------------
  const showMoss = config.showHangingMoss ?? true;
  if (showMoss) {
    const vineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...sharedUniforms,
        uVineColorTop: { value: new THREE.Color('#687e2b') }, // warm olive-green vine
        uVineColorBottom: { value: new THREE.Color('#39441a') }, // earthy shadowed vine
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

          // Natural organic pendular sway in wind
          float swayY = clamp(1.0 - uv.y, 0.0, 1.0);
          float swayAmt = pow(swayY, 1.2) * 0.18 * uWindStrength;
          pos.x += sin(uTime * uWindSpeed * 1.6 + pos.y * 1.5 + pos.z * 1.8) * swayAmt;
          pos.z += cos(uTime * uWindSpeed * 1.3 + pos.y * 1.3 + pos.x * 1.8) * swayAmt;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uVineColorTop;
        uniform vec3 uVineColorBottom;
        uniform vec3 uLightDir;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying vec2 vUv;

        void main() {
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uLightDir);
          float NdotL = dot(N, L);
          float cel = NdotL > 0.15 ? 1.0 : (NdotL > -0.15 ? 0.72 : 0.48);

          vec3 col = mix(uVineColorBottom, uVineColorTop, vUv.y);
          col *= cel;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(vineMaterial);

    const boughNodes = scaData.allNodes.filter(
      (n) => !n.isTrunk && n.depth >= 1 && n.position.y >= config.trunkHeight * 0.42
    );

    // (A) Looping Lianas (Cipós em U conectando galhos, como na imagem de referência)
    if (boughNodes.length >= 2) {
      const loopCount = Math.min(8, Math.max(3, Math.floor((config.hangingMossCount ?? 16) * 0.35)));
      for (let l = 0; l < loopCount; l++) {
        const nA = boughNodes[Math.floor(rnd() * boughNodes.length)];
        // Find partner node at moderate distance (1.2m to 3.8m)
        const candidates = boughNodes.filter((n) => {
          const d = n.position.distanceTo(nA.position);
          return d > 1.2 && d < 3.8 && n.id !== nA.id;
        });
        const nB = candidates.length > 0 ? candidates[Math.floor(rnd() * candidates.length)] : null;
        if (!nB) continue;

        const pA = nA.position.clone().add(new THREE.Vector3(0, -0.08, 0));
        const pB = nB.position.clone().add(new THREE.Vector3(0, -0.08, 0));
        const dist = pA.distanceTo(pB);

        const sagDepth = THREE.MathUtils.lerp(0.8, 1.8, rnd()) * Math.min(1.2, dist * 0.6);
        const midX = (pA.x + pB.x) * 0.5 + (rnd() - 0.5) * 0.35;
        const midZ = (pA.z + pB.z) * 0.5 + (rnd() - 0.5) * 0.35;
        const lowestY = Math.min(pA.y, pB.y) - sagDepth;

        const pMid1 = new THREE.Vector3(
          pA.x * 0.65 + midX * 0.35,
          pA.y - sagDepth * 0.65,
          pA.z * 0.65 + midZ * 0.35
        );
        const pMidLowest = new THREE.Vector3(midX, lowestY, midZ);
        const pMid2 = new THREE.Vector3(
          pB.x * 0.65 + midX * 0.35,
          pB.y - sagDepth * 0.65,
          pB.z * 0.65 + midZ * 0.35
        );

        const curve = new THREE.CatmullRomCurve3([pA, pMid1, pMidLowest, pMid2, pB]);
        const tubeGeo = new THREE.TubeGeometry(curve, 22, 0.024 + rnd() * 0.008, 6, false);
        geometriesToDispose.push(tubeGeo);

        const loopMesh = new THREE.Mesh(tubeGeo, vineMaterial);
        loopMesh.name = `Swamp_LianaLoop_${l}`;
        loopMesh.castShadow = true;
        group.add(loopMesh);
      }
    }

    // (B) Slender Dangling Vines (Cipós pendentes verticais balançando ao vento)
    const strandCount = Math.min(24, Math.max(8, config.hangingMossCount ?? 16));
    const tipAnchors = branchTips.length > 0 ? branchTips : boughNodes.map((n) => ({ position: n.position }));

    for (let s = 0; s < strandCount; s++) {
      const anchor = tipAnchors[s % tipAnchors.length];
      const startP = anchor.position.clone().add(
        new THREE.Vector3((rnd() - 0.5) * 0.4, -0.06, (rnd() - 0.5) * 0.4)
      );
      const len = 1.2 + rnd() * 1.8;
      const midSway = (rnd() - 0.5) * 0.25;
      const endSway = (rnd() - 0.5) * 0.38;

      const p0 = startP.clone();
      const p1 = new THREE.Vector3(p0.x + midSway * 0.5, p0.y - len * 0.5, p0.z + (rnd() - 0.5) * 0.2);
      const p2 = new THREE.Vector3(p0.x + endSway, p0.y - len, p0.z + endSway * 0.6);

      const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
      const strandGeo = new THREE.TubeGeometry(curve, 14, 0.016 + rnd() * 0.006, 5, false);
      geometriesToDispose.push(strandGeo);

      const strandMesh = new THREE.Mesh(strandGeo, vineMaterial);
      strandMesh.name = `Swamp_DanglingVine_${s}`;
      strandMesh.castShadow = true;
      group.add(strandMesh);
    }
  }

  // -------------------------------------------------------------
  // 4. SWAMP WATER POOL WITH LOTUS LILY PADS
  // Proportional pool radius hugging the stilt roots base
  // -------------------------------------------------------------
  const showWater = config.showSwampWater ?? true;
  if (showWater) {
    const poolRadius = (trunkBaseR * 1.5 + 1.2 * spreadMult) * 1.2;

    const waterGeo = new THREE.CircleGeometry(poolRadius, 36);
    waterGeo.rotateX(-Math.PI * 0.5);
    geometriesToDispose.push(waterGeo);

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x142416,
      roughness: 0.14,
      metalness: 0.35,
      transparent: true,
      opacity: 0.92,
    });
    materialsToDispose.push(waterMat);

    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = 0.04;
    waterMesh.receiveShadow = true;
    group.add(waterMesh);

    const lilyPadMat = new THREE.MeshToonMaterial({
      color: 0x3d7026,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(lilyPadMat);

    const lotusMat = new THREE.MeshToonMaterial({
      color: 0xfffae6,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(lotusMat);

    const lilyCount = 14;
    for (let l = 0; l < lilyCount; l++) {
      const lAngle = (l / lilyCount) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const lDist = (0.45 + rnd() * 0.5) * poolRadius;
      const lScale = 0.32 + rnd() * 0.28;

      const lilyGeo = new THREE.CircleGeometry(lScale, 14, 0, Math.PI * 1.84);
      lilyGeo.rotateX(-Math.PI * 0.5);
      geometriesToDispose.push(lilyGeo);

      const lilyMesh = new THREE.Mesh(lilyGeo, lilyPadMat);
      const lPosX = Math.cos(lAngle) * lDist;
      const lPosZ = Math.sin(lAngle) * lDist;
      lilyMesh.position.set(lPosX, 0.05, lPosZ);
      lilyMesh.rotation.y = rnd() * Math.PI * 2;
      group.add(lilyMesh);

      // Lotus flower on every 3rd pad
      if (l % 3 === 0) {
        const flowerGroup = new THREE.Group();
        flowerGroup.position.set(lPosX, 0.06, lPosZ);

        const petalGeo = new THREE.ConeGeometry(0.06, 0.14, 5);
        petalGeo.rotateX(Math.PI * 0.4);
        geometriesToDispose.push(petalGeo);

        for (let p = 0; p < 6; p++) {
          const petalMesh = new THREE.Mesh(petalGeo, lotusMat);
          petalMesh.rotation.y = (p / 6) * Math.PI * 2;
          flowerGroup.add(petalMesh);
        }

        const centerGeo = new THREE.SphereGeometry(0.04, 5, 5);
        geometriesToDispose.push(centerGeo);
        const centerMat = new THREE.MeshBasicMaterial({ color: 0xffca28 });
        materialsToDispose.push(centerMat);
        const centerMesh = new THREE.Mesh(centerGeo, centerMat);
        centerMesh.position.y = 0.03;
        flowerGroup.add(centerMesh);

        group.add(flowerGroup);
      }
    }
  }

  const update = (time: number, windStrength: number, windSpeed: number) => {
    sharedUniforms.uTime.value = time;
    sharedUniforms.uWindStrength.value = windStrength;
    sharedUniforms.uWindSpeed.value = windSpeed;
  };

  return {
    group,
    materialsToDispose,
    geometriesToDispose,
    update,
  };
}
