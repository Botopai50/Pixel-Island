// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import { SCATreeData, SCANode, WOOD_LOD } from './spaceColonization';
import { PIXEL_BLADE_FRAGMENT_SHADER, createPixelBladeUniforms } from './pixelArtTextureSystem';

export interface StylizedCanopyResult {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometriesToDispose: THREE.BufferGeometry[];
  update: (time: number, windStrength: number, windSpeed: number) => void;
}

/**
 * Creates a single 3D creased, curved lanceolate leaf blade.
 * - Width flaring to a broad middle, tapering to a sharp tip.
 * - V-shaped central ridge (crease) that catches highlights.
 * - Natural downward droop curvature matching the reference image.
 */
function createSingle3DLeafGeometry(
  length: number = 1.0,
  maxWidth: number = 0.32,
  droop: number = 0.35,
  curveLateral: number = 0.0
): THREE.BufferGeometry {
  const lengthSegments = 8;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Color palette (vivid hand-painted anime game foliage)
  const cBase = new THREE.Color('#224c0e');     // Deep shadow at stem
  const cMid = new THREE.Color('#6fca22');      // Radiant leaf green
  const cTip = new THREE.Color('#b5fa38');      // Sunlit chartreuse tip
  const cSpine = new THREE.Color('#d8ff68');    // Highlighted pale vein

  // Build grid of vertices: (lengthSegments + 1) rows, 3 columns (left margin, center spine, right margin)
  for (let i = 0; i <= lengthSegments; i++) {
    const t = i / lengthSegments; // 0 (stem) to 1 (tip)

    // Along length: starts horizontal, then arches up slightly, then droops down with gravity
    const z = t * length;
    const y = Math.sin(t * Math.PI * 0.75) * 0.12 * length - Math.pow(t, 2.0) * droop * length;
    const xOffset = Math.sin(t * Math.PI) * curveLateral * length * 0.15;

    // Leaf width envelope: 0 at base -> wide at 42% -> 0 at tip
    const widthFactor = Math.pow(Math.sin(t * Math.PI), 0.72);
    const halfW = (t === 1.0 ? 0.001 : maxWidth * 0.5 * widthFactor);

    // V-shaped fold: spine is raised, margins drop downward
    const marginDrop = (t === 1.0 ? 0.0 : 0.06 * widthFactor * maxWidth);

    // Vertex 0: Left Margin
    positions.push(-halfW + xOffset, y - marginDrop, z);
    uvs.push(0.0, t);
    const cLeft = cBase.clone().lerp(cMid, t).lerp(cTip, t * 0.7);
    colors.push(cLeft.r, cLeft.g, cLeft.b);

    // Vertex 1: Center Spine
    positions.push(xOffset, y, z);
    uvs.push(0.5, t);
    const cCenter = cBase.clone().lerp(cSpine, Math.pow(t, 0.6));
    colors.push(cCenter.r, cCenter.g, cCenter.b);

    // Vertex 2: Right Margin
    positions.push(halfW + xOffset, y - marginDrop, z);
    uvs.push(1.0, t);
    const cRight = cBase.clone().lerp(cMid, t).lerp(cTip, t * 0.7);
    colors.push(cRight.r, cRight.g, cRight.b);
  }

  // Generate face indices (quads split into 2 triangles on each side of spine)
  for (let i = 0; i < lengthSegments; i++) {
    const row = i * 3;
    const nextRow = (i + 1) * 3;

    // Left quad: (row+0, row+1, nextRow+1, nextRow+0)
    indices.push(row + 0, nextRow + 0, row + 1);
    indices.push(row + 1, nextRow + 0, nextRow + 1);

    // Right quad: (row+1, row+2, nextRow+2, nextRow+1)
    indices.push(row + 1, nextRow + 1, row + 2);
    indices.push(row + 2, nextRow + 1, nextRow + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

/**
 * Builds an authentic 3D Palmate Rosette (Umbrella Starburst) cluster.
 * 6 to 8 leaflets radiating outward, precisely matching the user's reference image!
 */
function build3DRosetteGeometry(
  leafCount: number = 7,
  scale: number = 1.0,
  rnd: () => number
): THREE.BufferGeometry {
  const mergedPositions: number[] = [];
  const mergedNormals: number[] = [];
  const mergedUvs: number[] = [];
  const mergedColors: number[] = [];
  const mergedIndices: number[] = [];
  let vertexOffset = 0;

  // Distribute leaflets in an authentic spreading fan / umbrella shape
  // Fan spans approx 260 degrees (-130 deg to +130 deg)
  const startAng = -2.25;
  const endAng = 2.25;
  const stepAng = (endAng - startAng) / Math.max(1, leafCount - 1);

  for (let l = 0; l < leafCount; l++) {
    const yaw = startAng + l * stepAng + (rnd() - 0.5) * 0.12;
    // Central leaves point higher, outer side leaves droop lower
    const distFromCenter = Math.abs(l - (leafCount - 1) * 0.5) / ((leafCount - 1) * 0.5);
    const pitch = -0.18 - distFromCenter * 0.42 + (rnd() - 0.5) * 0.10;
    const roll = (rnd() - 0.5) * 0.20;

    const leafLen = (0.95 + (1.0 - distFromCenter * 0.3) * 0.35 + (rnd() - 0.5) * 0.15) * scale;
    const leafWidth = (0.28 + (1.0 - distFromCenter * 0.2) * 0.08) * scale;
    const droopAmt = 0.30 + distFromCenter * 0.25;
    const curveLat = (l < leafCount * 0.5 ? -0.15 : 0.15) * distFromCenter;

    const leafGeo = createSingle3DLeafGeometry(leafLen, leafWidth, droopAmt, curveLat);

    // Apply rotation & translation to form the rosette
    const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const posAttr = leafGeo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = leafGeo.getAttribute('normal') as THREE.BufferAttribute;
    const uvAttr = leafGeo.getAttribute('uv') as THREE.BufferAttribute;
    const colAttr = leafGeo.getAttribute('color') as THREE.BufferAttribute;
    const idxAttr = leafGeo.getIndex()!;

    // Small radial offset from center hub (stipule)
    const hubOffset = new THREE.Vector3(0, 0, 0.08 * scale).applyQuaternion(quat);

    for (let v = 0; v < posAttr.count; v++) {
      const p = new THREE.Vector3(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v));
      p.applyQuaternion(quat).add(hubOffset);
      mergedPositions.push(p.x, p.y, p.z);

      const n = new THREE.Vector3(normAttr.getX(v), normAttr.getY(v), normAttr.getZ(v));
      n.applyQuaternion(quat);
      mergedNormals.push(n.x, n.y, n.z);

      mergedUvs.push(uvAttr.getX(v), uvAttr.getY(v));
      mergedColors.push(colAttr.getX(v), colAttr.getY(v), colAttr.getZ(v));
    }

    for (let i = 0; i < idxAttr.count; i++) {
      mergedIndices.push(idxAttr.getX(i) + vertexOffset);
    }
    vertexOffset += posAttr.count;

    leafGeo.dispose();
  }

  const rosetteGeo = new THREE.BufferGeometry();
  rosetteGeo.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
  rosetteGeo.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
  rosetteGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mergedUvs, 2));
  rosetteGeo.setAttribute('color', new THREE.Float32BufferAttribute(mergedColors, 3));
  rosetteGeo.setIndex(mergedIndices);

  return rosetteGeo;
}

/**
 * Builds the full 3D Stylized Mangrove / Palmate Canopy directly on top of the
 * Space Colonization tree branches, matching the reference image!
 */
export function buildStylizedMangroveCanopy(
  config: TreeConfig,
  scaData: SCATreeData,
  sharedUniforms: {
    uTime: { value: number };
    uWindStrength: { value: number };
    uWindSpeed: { value: number };
    uLightDir: { value: THREE.Vector3 };
  },
  rnd: () => number
): StylizedCanopyResult {
  const geometriesToDispose: THREE.BufferGeometry[] = [];

  // Default path: the procedural pixel art blade shader, so the mangrove
  // rosettes share the palette and the quantised tone hierarchy of the rest of
  // the tree. The rosette geometry and its vertex colours are untouched.
  const usePixelTextures = config.pixelTextureEnabled !== false;
  const rosetteCrownBottom = scaData.crownBottomY;
  const rosetteCrownTop = scaData.crownTopY;

  // Master Cel-Shaded Foliage Material with Subsurface Scattering & Wind Sway
  const foliageMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uColorTop: { value: new THREE.Color(config.foliageColorTop ?? '#9ee838') },
      uColorBottom: { value: new THREE.Color(config.foliageColorBottom ?? '#244a0e') },
      uLightDir: sharedUniforms.uLightDir,
      uTime: sharedUniforms.uTime,
      uWindStrength: sharedUniforms.uWindStrength,
      uWindSpeed: sharedUniforms.uWindSpeed,
      uRimIntensity: { value: config.rimLightIntensity ?? 1.15 },
      uCelSteps: { value: config.celSteps ?? 3.0 },
      ...(usePixelTextures
        ? createPixelBladeUniforms(
            config,
            rosetteCrownBottom,
            rosetteCrownTop,
            new THREE.Vector2(7, 15)
          )
        : {}),
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      varying vec3 vColor;
      varying vec2 vUv;

      void main() {
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vColor = color;
        vUv = uv;

        vec3 pos = position;

        // Natural flutter along leaf tips (uv.y goes 0 to 1)
        float tipFactor = pow(uv.y, 1.3);
        float sway = sin(uTime * uWindSpeed * 2.2 + pos.x * 1.8 + pos.y * 1.2) * 0.12 * uWindStrength * tipFactor;
        float flutter = cos(uTime * uWindSpeed * 3.8 + pos.z * 2.5) * 0.06 * uWindStrength * tipFactor;

        pos.x += sway;
        pos.y += flutter * 0.4;
        pos.z += sway * 0.6;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        vViewDir = normalize(cameraPosition - worldPos.xyz);

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: usePixelTextures ? PIXEL_BLADE_FRAGMENT_SHADER : `
      uniform vec3 uColorTop;
      uniform vec3 uColorBottom;
      uniform vec3 uLightDir;
      uniform float uRimIntensity;
      uniform float uCelSteps;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      varying vec3 vColor;
      varying vec2 vUv;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(uLightDir);
        vec3 V = normalize(vViewDir);

        float NdotL = dot(N, L);

        // Crisp multi-step Cel-Shading
        float cel = smoothstep(-0.15, 0.25, NdotL);
        if (uCelSteps > 2.5) {
          cel = floor(cel * 3.0 + 0.5) / 3.0;
        } else {
          cel = floor(cel * 2.0 + 0.5) / 2.0;
        }
        cel = clamp(cel * 0.55 + 0.45, 0.38, 1.0);

        // Subsurface Translucency (warm back-lighting through leaves)
        float subSurface = pow(max(0.0, dot(-L, V)), 2.5) * 0.32;

        // Luminous Anime Rim Light
        float rim = pow(1.0 - max(0.0, dot(N, V)), 2.8) * uRimIntensity * 0.45;

        // Blend vertex colors with user-configured top/bottom palette
        vec3 baseCol = mix(uColorBottom, uColorTop, vUv.y * 0.85);
        // Boost with vertex highlight
        baseCol = mix(baseCol, vColor, 0.65);

        vec3 finalColor = baseCol * cel + vec3(0.95, 1.0, 0.45) * subSurface + vec3(0.85, 1.0, 0.60) * rim;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  // Find placement locations on the Space Colonization tree:
  // 1. Branch tips (terminal leaf nodes)
  // 2. Branch forks & elbows (intermediate nodes with multiple children or depth >= 2)
  interface RosettePlacement {
    pos: THREE.Vector3;
    dir: THREE.Vector3;
    up: THREE.Vector3;
    scale: number;
    leafCount: number;
  }
  const placements: RosettePlacement[] = [];

  // (A) Terminal tips: 1 cluster proudly crowning each tip
  //
  // Not every terminal node is a branch tip. The colonisation also leaves
  // short dead-end stubs that sprout from the trunk and stop growing at once -
  // 30 cm to a metre long, low down, pressed against or even inside the
  // flared trunk - and a rosette on one of those grows straight out of the
  // bark near the ground. A tip only carries a rosette when it is up in the
  // crown, or, lower down, when it ends a real limb: clear of the trunk and
  // at least ~0.9 m of wood away from where it left it.
  const crownFloorY = scaData.crownBottomY * 0.85;
  const trunkClearance = Math.max(1.0, config.trunkRadiusBase ?? 1.0);
  const isRealTip = (leaf: SCANode): boolean => {
    if (leaf.position.y >= crownFloorY) return true;
    if (Math.hypot(leaf.position.x, leaf.position.z) < trunkClearance) return false;
    let limbLength = 0;
    let n: SCANode = leaf;
    while (n.parent && !n.isTrunk) {
      limbLength += n.position.distanceTo(n.parent.position);
      n = n.parent;
    }
    return limbLength >= 0.9;
  };
  const minLeafSpacing = 0.60;
  const pickedLeaves: SCANode[] = [];
  for (const leaf of scaData.leafNodes) {
    if (!isRealTip(leaf)) continue;
    const tooClose = pickedLeaves.some((pl) => pl.position.distanceTo(leaf.position) < minLeafSpacing);
    if (!tooClose) {
      pickedLeaves.push(leaf);
    }
  }

  pickedLeaves.forEach((leaf) => {
    const tipDir = leaf.dir.lengthSq() > 0.001 ? leaf.dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const yFrac = leaf.position.y / config.trunkHeight;
    // Lower tier gets slightly larger cascading rosettes; top tier gets sunlit crowning rosettes
    const tierScale = yFrac < 0.60 ? 1.25 : (yFrac < 0.82 ? 1.15 : 1.10);
    placements.push({
      pos: leaf.position.clone(),
      dir: tipDir,
      up,
      scale: tierScale + (rnd() - 0.5) * 0.16,
      leafCount: 7 + (rnd() > 0.4 ? 1 : 0),
    });
  });

  // (B) Intermediate branch forks/elbows: add rosettes perched on limbs
  // Strictly filter to ensure bare trunk and clear vertical gaps between tiers!
  const branchNodes = scaData.allNodes.filter((n) => {
    if (n.isTrunk || n.depth < 2) return false;
    const distFromAxis = Math.hypot(n.position.x, n.position.z);
    return distFromAxis >= 1.25 && n.position.y >= config.trunkHeight * 0.45;
  });

  // Pick nodes with spacing to avoid clutter while ensuring full coverage
  const minSpacing = 1.35;
  const pickedNodes: SCANode[] = [];

  for (const bNode of branchNodes) {
    const tooCloseToLeaf = scaData.leafNodes.some((ln) => ln.position.distanceTo(bNode.position) < minSpacing);
    const tooCloseToPicked = pickedNodes.some((pn) => pn.position.distanceTo(bNode.position) < minSpacing);
    if (!tooCloseToLeaf && !tooCloseToPicked) {
      pickedNodes.push(bNode);
      if (pickedNodes.length >= 10) break;
    }
  }

  pickedNodes.forEach((bNode) => {
    const outward = new THREE.Vector3(bNode.position.x, 0, bNode.position.z).normalize();
    if (outward.lengthSq() < 0.001) outward.set(1, 0, 0);
    const growDir = bNode.dir.lengthSq() > 0.001 ? bNode.dir.clone().normalize() : outward;

    // Perched on top or side of the bough
    const offsetDir = outward.clone().setY(0.40).normalize();
    const pos = bNode.position.clone().add(offsetDir.clone().multiplyScalar(0.18));
    const yFrac = bNode.position.y / config.trunkHeight;
    const tierScale = yFrac < 0.60 ? 1.20 : 1.10;

    placements.push({
      pos,
      dir: growDir,
      up: new THREE.Vector3(0, 1, 0),
      scale: tierScale + (rnd() - 0.5) * 0.16,
      leafCount: 6 + (rnd() > 0.4 ? 1 : 0),
    });
  });

  // Build and merge all rosettes into one single unified high-performance mesh
  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allUvs: number[] = [];
  const allColors: number[] = [];
  const allIndices: number[] = [];
  let masterVertexOffset = 0;

  // jogo: só uma parte das rosetas (as que ficam crescem para cobrir o mesmo volume)
  const keepRos = WOOD_LOD.canopyKeep;
  if (keepRos < 1) {
    const kept = placements.filter((_, i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x) < keepRos; });
    for (const p of kept) p.scale *= 1 / Math.sqrt(keepRos);
    placements.length = 0;
    placements.push(...kept);
  }
  placements.forEach((p) => {
    const rosetteGeo = build3DRosetteGeometry(p.leafCount, p.scale, rnd);

    // Compute orientation matrix
    const mLook = new THREE.Matrix4();
    const target = p.pos.clone().add(p.dir);
    mLook.lookAt(p.pos, target, p.up);

    // Three.js lookAt points -Z towards target. Rotate so +Z faces target.
    const mRot = new THREE.Matrix4().makeRotationY(Math.PI);
    mLook.multiply(mRot);
    mLook.setPosition(p.pos);

    const pAttr = rosetteGeo.getAttribute('position') as THREE.BufferAttribute;
    const nAttr = rosetteGeo.getAttribute('normal') as THREE.BufferAttribute;
    const uAttr = rosetteGeo.getAttribute('uv') as THREE.BufferAttribute;
    const cAttr = rosetteGeo.getAttribute('color') as THREE.BufferAttribute;
    const iAttr = rosetteGeo.getIndex()!;

    const tempV = new THREE.Vector3();
    const tempN = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mLook);

    for (let v = 0; v < pAttr.count; v++) {
      tempV.set(pAttr.getX(v), pAttr.getY(v), pAttr.getZ(v)).applyMatrix4(mLook);
      allPositions.push(tempV.x, tempV.y, tempV.z);

      tempN.set(nAttr.getX(v), nAttr.getY(v), nAttr.getZ(v)).applyMatrix3(normalMatrix).normalize();
      allNormals.push(tempN.x, tempN.y, tempN.z);

      allUvs.push(uAttr.getX(v), uAttr.getY(v));
      allColors.push(cAttr.getX(v), cAttr.getY(v), cAttr.getZ(v));
    }

    for (let i = 0; i < iAttr.count; i++) {
      allIndices.push(iAttr.getX(i) + masterVertexOffset);
    }
    masterVertexOffset += pAttr.count;

    rosetteGeo.dispose();
  });

  const fullCanopyGeo = new THREE.BufferGeometry();
  fullCanopyGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  fullCanopyGeo.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
  fullCanopyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(allUvs, 2));
  fullCanopyGeo.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
  fullCanopyGeo.setIndex(allIndices);

  geometriesToDispose.push(fullCanopyGeo);

  const canopyMesh = new THREE.Mesh(fullCanopyGeo, foliageMaterial);
  canopyMesh.name = 'BotW_Stylized3DCanopy';
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;

  const update = (time: number, windStrength: number, windSpeed: number) => {
    foliageMaterial.uniforms.uTime.value = time;
    foliageMaterial.uniforms.uWindStrength.value = windStrength;
    foliageMaterial.uniforms.uWindSpeed.value = windSpeed;
  };

  return {
    mesh: canopyMesh,
    material: foliageMaterial,
    geometriesToDispose,
    update,
  };
}
