// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';
import {
  getPixelSingleLeafTexture,
  createPixelSucculentMaterial,
  buildPixelCactusFlower,
  createPixelSaplingLeafMaterial,
  createPixelSaplingStemMaterial,
  createPixelPropMaterial,
} from './pixelArtTextureSystem';

export interface SaplingGenerationResult {
  group: THREE.Group;
  materialsToDispose: (THREE.Material | THREE.Material[])[];
  geometriesToDispose: THREE.BufferGeometry[];
  update: (time: number) => void;
}

/**
 * Creates a stylized, authentic Zelda: BotW seedling / sapling (muda / broto).
 * Saplings are delicate, simple, and recognizable:
 * - Small scale (0.8m - 1.4m height, slender stem 0.04m - 0.08m radius)
 * - Individual distinct stylized leaves or young fronds on thin petioles
 * - Distinct germination relics (acorn shell, coconut seed, cactus nub, mangrove propagule)
 * - Cel-shaded NPR shaders with gentle wind flutter
 */
/**
 * Generates an organic 3D leaf geometry with authentic volume:
 * - Segmented 3x4 grid
 * - Pivot at (0, 0, 0) at the base of the petiole
 * - V-shaped fold along the central midrib
 * - Gentle longitudinal arching curve so leaves catch light realistically
 */
function createCurvedLeafGeometry(width: number, length: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, length, 3, 4);
  geo.translate(0, length * 0.5, 0); // Pivot at petiole base

  const pos = geo.attributes.position;
  const halfW = width * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const normX = Math.min(1.0, Math.abs(x) / halfW);
    const normY = Math.min(1.0, Math.max(0.0, y / length));

    // V-shaped fold along midrib
    const foldZ = (1.0 - normX) * (width * 0.16);
    // Longitudinal arching curve
    const archZ = Math.sin(normY * Math.PI) * (length * 0.08);

    pos.setZ(i, pos.getZ(i) + foldZ + archZ);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a 100% airtight, solid, closed tapered branch geometry.
 * Ensures zero hollow holes, gaps, or dark cut pipe openings at the tips.
 */
function createClosedTaperedBranchGeo(
  curve: THREE.Curve<THREE.Vector3>,
  rStart: number,
  rEnd: number,
  tubularSegs = 10,
  radialSegs = 8,
  closeStart = true
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const samplePoints: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    samplePoints.push(curve.getPoint(t));
    tangents.push(curve.getTangent(t).normalize());
  }

  // Parallel transport frames
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

  let vertOffset = 0;
  let accumLen = 0;

  // Build rings
  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    const pt = samplePoints[i];
    if (i > 0) accumLen += pt.distanceTo(samplePoints[i - 1]);
    const r = THREE.MathUtils.lerp(rStart, rEnd, t);
    const frame = normalFrames[i];

    for (let j = 0; j <= radialSegs; j++) {
      const frac = j / radialSegs;
      const angle = frac * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const nX = frame.u.x * cosA + frame.v.x * sinA;
      const nY = frame.u.y * cosA + frame.v.y * sinA;
      const nZ = frame.u.z * cosA + frame.v.z * sinA;

      positions.push(pt.x + nX * r, pt.y + nY * r, pt.z + nZ * r);
      normals.push(nX, nY, nZ);
      uvs.push(frac, accumLen);
      vertOffset++;
    }
  }

  // Tube ring quads
  const vertsPerRing = radialSegs + 1;
  for (let i = 0; i < tubularSegs; i++) {
    const ring1 = i * vertsPerRing;
    const ring2 = (i + 1) * vertsPerRing;
    for (let j = 0; j < radialSegs; j++) {
      const a = ring1 + j;
      const b = ring2 + j;
      const c = ring2 + j + 1;
      const d = ring1 + j + 1;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  // Solid Welded Tip Cap (Sharp end point, NO HOLE!)
  const tipPt = samplePoints[tubularSegs];
  const tipTan = tangents[tubularSegs];
  const pointedTip = tipPt.clone().addScaledVector(tipTan, Math.max(0.015, rEnd * 1.5));
  positions.push(pointedTip.x, pointedTip.y, pointedTip.z);
  normals.push(tipTan.x, tipTan.y, tipTan.z);
  uvs.push(0.5, accumLen + 0.05);
  const tipVertIdx = vertOffset++;

  const lastRingStart = tubularSegs * vertsPerRing;
  for (let j = 0; j < radialSegs; j++) {
    indices.push(lastRingStart + j, lastRingStart + j + 1, tipVertIdx);
  }

  // Optional Bottom Start Cap
  if (closeStart) {
    const startPt = samplePoints[0];
    const startTan = tangents[0].clone().negate();
    positions.push(startPt.x, startPt.y, startPt.z);
    normals.push(startTan.x, startTan.y, startTan.z);
    uvs.push(0.5, 0);
    const startVertIdx = vertOffset++;

    for (let j = 0; j < radialSegs; j++) {
      indices.push(startVertIdx, j + 1, j);
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates an authentic BotW stylized leaf texture on a 512x512 canvas with alpha cutout:
 * - Transparent background (eliminates rectangular box edges completely)
 * - Species-specific organic leaf silhouettes (lobed oak, pointed birch, delicate sakura, tropical palm blade, glossy mangrove)
 * - Luminous translucent midrib and branching lateral veins
 * - Hand-painted anime gradient and soft edge rim
 */
function generateSaplingLeafTexture(species: string, config: TreeConfig): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = 'rgba(255, 255, 255, 0)';
  ctx.fillRect(0, 0, 512, 512);

  const topColor = new THREE.Color(config.foliageColorTop || '#8fe83a');
  const botColor = new THREE.Color(config.foliageColorBottom || '#2d6d1b');
  const topHex = '#' + topColor.getHexString();
  const botHex = '#' + botColor.getHexString();

  const isPalm = species.startsWith('faron_palm');
  const isMangrove = species.startsWith('swamp_mangrove');
  const isPine = species.startsWith('hebra_pine');
  const isSakura = species.startsWith('satori_sakura');
  const isBirch = species.startsWith('akkala_birch');
  const isKorok = species.startsWith('korok_ancient');

  if (isPalm) {
    // -------------------------------------------------------------
    // TROPICAL PALM FROND LEAFLET (Sleek, tapered spear blade)
    // -------------------------------------------------------------
    const grad = ctx.createLinearGradient(256, 512, 256, 30);
    grad.addColorStop(0.0, botHex);
    grad.addColorStop(0.55, topHex);
    grad.addColorStop(1.0, '#e8ff8f');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(250, 512);
    ctx.bezierCurveTo(225, 360, 215, 210, 256, 30);
    ctx.bezierCurveTo(297, 210, 287, 360, 262, 512);
    ctx.closePath();
    ctx.fill();

    // Edge highlight rim
    ctx.strokeStyle = 'rgba(255, 255, 220, 0.45)';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Central golden ridge
    ctx.strokeStyle = 'rgba(255, 250, 180, 0.9)';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.moveTo(256, 512);
    ctx.lineTo(256, 35);
    ctx.stroke();

    // Fine parallel striations
    ctx.strokeStyle = 'rgba(255, 255, 220, 0.24)';
    ctx.lineWidth = 1.2;
    for (let offset = -14; offset <= 14; offset += 7) {
      if (offset === 0) continue;
      ctx.beginPath();
      ctx.moveTo(256 + offset * 0.4, 490);
      ctx.quadraticCurveTo(256 + offset, 260, 256, 50);
      ctx.stroke();
    }

  } else if (isMangrove) {
    // -------------------------------------------------------------
    // SWAMP MANGROVE LEAF (Glossy, leathery oval with smooth rolled margin)
    // -------------------------------------------------------------
    const grad = ctx.createLinearGradient(256, 512, 256, 45);
    grad.addColorStop(0.0, botHex);
    grad.addColorStop(0.6, topHex);
    grad.addColorStop(1.0, '#86efac');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(246, 512);
    ctx.bezierCurveTo(140, 390, 140, 130, 256, 45);
    ctx.bezierCurveTo(372, 130, 372, 390, 266, 512);
    ctx.closePath();
    ctx.fill();

    // Glossy sunlight glare
    const glare = ctx.createRadialGradient(240, 160, 10, 240, 160, 95);
    glare.addColorStop(0.0, 'rgba(255, 255, 255, 0.45)');
    glare.addColorStop(0.55, 'rgba(255, 255, 255, 0.12)');
    glare.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = glare;
    ctx.fill();

    // Cel edge rim
    ctx.strokeStyle = 'rgba(230, 255, 210, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Thick central vein
    ctx.strokeStyle = 'rgba(220, 255, 180, 0.9)';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(256, 512);
    ctx.lineTo(256, 55);
    ctx.stroke();

    // Arched lateral veins
    ctx.lineWidth = 2.0;
    for (let i = 1; i <= 5; i++) {
      const y = 460 - i * 65;
      const spread = 75 - i * 8;
      ctx.beginPath();
      ctx.moveTo(256, y);
      ctx.quadraticCurveTo(256 - spread * 0.6, y - 20, 256 - spread, y - 35);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(256, y);
      ctx.quadraticCurveTo(256 + spread * 0.6, y - 20, 256 + spread, y - 35);
      ctx.stroke();
    }

  } else if (isSakura) {
    // -------------------------------------------------------------
    // SATORI SAKURA (Tender young cherry leaf with notched apex & soft pink tones)
    // -------------------------------------------------------------
    const grad = ctx.createRadialGradient(256, 200, 20, 256, 260, 240);
    grad.addColorStop(0.0, '#ffffff');
    grad.addColorStop(0.35, '#fbcfe8');
    grad.addColorStop(0.7, '#f472b6');
    grad.addColorStop(1.0, '#be185d');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(248, 512);
    ctx.bezierCurveTo(155, 380, 160, 160, 245, 45);
    ctx.lineTo(256, 65); // Notched apex
    ctx.lineTo(267, 45);
    ctx.bezierCurveTo(352, 160, 357, 380, 264, 512);
    ctx.closePath();
    ctx.fill();

    // Edge highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Radiant pink-white midrib & veins
    ctx.strokeStyle = 'rgba(255, 242, 248, 0.85)';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(256, 512);
    ctx.lineTo(256, 75);
    ctx.stroke();

    ctx.lineWidth = 1.8;
    for (let i = 1; i <= 5; i++) {
      const y = 450 - i * 65;
      const span = 65 - i * 7;
      ctx.beginPath();
      ctx.moveTo(256, y);
      ctx.quadraticCurveTo(256 - span * 0.6, y - 18, 256 - span, y - 32);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(256, y);
      ctx.quadraticCurveTo(256 + span * 0.6, y - 18, 256 + span, y - 32);
      ctx.stroke();
    }

  } else if (isBirch) {
    // -------------------------------------------------------------
    // AKKALA BIRCH (Golden teardrop ovate with serrated margins)
    // -------------------------------------------------------------
    const grad = ctx.createLinearGradient(256, 512, 256, 40);
    grad.addColorStop(0.0, '#b45309');
    grad.addColorStop(0.45, '#f59e0b');
    grad.addColorStop(0.85, '#fde047');
    grad.addColorStop(1.0, '#fef08a');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(248, 512);
    const teethLeft = [
      [230, 460], [215, 420], [195, 385], [165, 340], [150, 300],
      [145, 255], [155, 210], [175, 160], [205, 110], [235, 70]
    ];
    teethLeft.forEach(([tx, ty], idx) => {
      if (idx % 2 === 0) ctx.lineTo(tx, ty);
      else ctx.lineTo(tx + 7, ty + 5);
    });
    ctx.lineTo(256, 40);

    const teethRight = [
      [277, 70], [307, 110], [337, 160], [357, 210],
      [367, 255], [362, 300], [347, 340], [317, 385], [297, 420], [282, 460]
    ];
    teethRight.forEach(([tx, ty], idx) => {
      if (idx % 2 === 0) ctx.lineTo(tx, ty);
      else ctx.lineTo(tx - 7, ty + 5);
    });
    ctx.lineTo(264, 512);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(254, 240, 138, 0.65)';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 251, 190, 0.9)';
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(256, 512);
    ctx.lineTo(256, 50);
    ctx.stroke();

    ctx.lineWidth = 1.8;
    for (let i = 1; i <= 6; i++) {
      const y = 450 - i * 55;
      const span = 85 - i * 10;
      ctx.beginPath();
      ctx.moveTo(256, y);
      ctx.lineTo(256 - span, y - 28);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(256, y);
      ctx.lineTo(256 + span, y - 28);
      ctx.stroke();
    }

  } else if (species.startsWith('savanna_acacia')) {
    // -------------------------------------------------------------
    // SAVANNA ACACIA (pinnate leaf: a rachis lined with tiny leaflet pairs)
    // -------------------------------------------------------------
    ctx.strokeStyle = '#5a4030';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(256, 512);
    ctx.lineTo(256, 40);
    ctx.stroke();
    for (let y = 470; y > 60; y -= 26) {
      const f = (512 - y) / 472;                     // 0 at the base, 1 at the tip
      const reach = 150 * (1 - 0.6 * f);
      [-1, 1].forEach((side) => {
        const grad = ctx.createLinearGradient(256, y, 256 + side * reach, y - 14);
        grad.addColorStop(0, botHex);
        grad.addColorStop(1, topHex);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(256 + side * reach * 0.55, y - 7, reach * 0.5, 10, side * -0.18, 0, Math.PI * 2);
        ctx.fill();
      });
    }

  } else if (isPine) {
    // -------------------------------------------------------------
    // HEBRA PINE (Lush fan of tapered conifer needles with frost highlights)
    // -------------------------------------------------------------
    // Delicate central woody twig anchored at y = 512
    ctx.strokeStyle = '#432617';
    ctx.lineWidth = 4.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(256, 512);
    ctx.lineTo(256, 210);
    ctx.stroke();

    // 13 conifer needles radiating in a tiered BotW fan
    const needles = [
      // Base wide-spreading needles
      { startY: 460, tipX: 130, tipY: 280, cpX: 175, cpY: 390, width: 8.5 },
      { startY: 460, tipX: 382, tipY: 280, cpX: 337, cpY: 390, width: 8.5 },
      { startY: 410, tipX: 105, tipY: 210, cpX: 155, cpY: 320, width: 8.5 },
      { startY: 410, tipX: 407, tipY: 210, cpX: 357, cpY: 320, width: 8.5 },
      // Mid-tier arching needles
      { startY: 355, tipX: 125, tipY: 140, cpX: 170, cpY: 255, width: 8.0 },
      { startY: 355, tipX: 387, tipY: 140, cpX: 342, cpY: 255, width: 8.0 },
      { startY: 305, tipX: 160, tipY: 85,  cpX: 190, cpY: 205, width: 8.0 },
      { startY: 305, tipX: 352, tipY: 85,  cpX: 322, cpY: 205, width: 8.0 },
      // Upper needles reaching upwards
      { startY: 255, tipX: 205, tipY: 48,  cpX: 220, cpY: 160, width: 7.5 },
      { startY: 255, tipX: 307, tipY: 48,  cpX: 292, cpY: 160, width: 7.5 },
      { startY: 220, tipX: 232, tipY: 30,  cpX: 238, cpY: 125, width: 7.0 },
      { startY: 220, tipX: 280, tipY: 30,  cpX: 274, cpY: 125, width: 7.0 },
      // Central terminal needle
      { startY: 210, tipX: 256, tipY: 20,  cpX: 256, cpY: 110, width: 7.0 },
    ];

    // Draw each needle with rich BotW evergreen gradient and luminous cel spine
    needles.forEach((nd) => {
      const grad = ctx.createLinearGradient(256, nd.startY, nd.tipX, nd.tipY);
      grad.addColorStop(0.0, botHex);
      grad.addColorStop(0.55, topHex);
      grad.addColorStop(0.88, '#86efac'); // fresh tender conifer tip
      grad.addColorStop(1.0, '#e0f2fe');  // subtle frosty subalpine glint

      ctx.strokeStyle = grad;
      ctx.lineWidth = nd.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(256, nd.startY);
      ctx.quadraticCurveTo(nd.cpX, nd.cpY, nd.tipX, nd.tipY);
      ctx.stroke();

      // Sharp central spine highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.lineWidth = nd.width * 0.28;
      ctx.beginPath();
      ctx.moveTo(256, nd.startY);
      ctx.quadraticCurveTo(nd.cpX, nd.cpY, nd.tipX, nd.tipY);
      ctx.stroke();
    });

  } else {
    // -------------------------------------------------------------
    // HYRULE OAK & KOROK ANCIENT (Authentic BotW Scalloped Lobed Leaf)
    // 4-5 organic lobes, delicate branching venation, translucent midrib
    // -------------------------------------------------------------
    const grad = ctx.createLinearGradient(256, 512, 256, 38);
    grad.addColorStop(0.0, botHex);
    grad.addColorStop(0.5, topHex);
    grad.addColorStop(1.0, isKorok ? '#a7f3d0' : '#d9f99d');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(246, 512); // Base petiole firmly at bottom boundary

    // Left lobes from base up to apex
    ctx.bezierCurveTo(232, 475, 205, 435, 195, 400); // Lobe 1 base
    ctx.bezierCurveTo(185, 370, 215, 355, 220, 340); // Notch 1
    ctx.bezierCurveTo(160, 335, 140, 290, 145, 250); // Lobe 2 (prominent)
    ctx.bezierCurveTo(150, 220, 195, 215, 205, 195); // Notch 2
    ctx.bezierCurveTo(155, 185, 155, 145, 175, 120); // Lobe 3
    ctx.bezierCurveTo(190, 100, 225, 95, 235, 75);   // Notch 3
    ctx.bezierCurveTo(240, 60, 250, 48, 256, 38);    // Pointed apex tip

    // Right lobes from apex back down to base
    ctx.bezierCurveTo(262, 48, 272, 60, 277, 75);
    ctx.bezierCurveTo(287, 95, 322, 100, 337, 120);
    ctx.bezierCurveTo(357, 145, 357, 185, 307, 195);
    ctx.bezierCurveTo(317, 215, 362, 220, 367, 250);
    ctx.bezierCurveTo(372, 290, 352, 335, 292, 340);
    ctx.bezierCurveTo(297, 355, 327, 370, 317, 400);
    ctx.bezierCurveTo(307, 435, 280, 475, 266, 512);
    ctx.closePath();
    ctx.fill();

    // Stylized Anime Edge Highlight
    ctx.strokeStyle = isKorok ? 'rgba(220, 255, 240, 0.65)' : 'rgba(240, 255, 205, 0.6)';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Central Translucent Midrib anchored at y = 512
    ctx.strokeStyle = isKorok ? 'rgba(235, 255, 240, 0.9)' : 'rgba(245, 255, 200, 0.9)';
    ctx.lineWidth = 4.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(256, 512);
    ctx.lineTo(256, 50);
    ctx.stroke();

    // Lateral veins branching into each lobe
    ctx.lineWidth = 2.2;
    const lobeVeins = [
      { y: 410, dx: -48, dy: -18 },
      { y: 410, dx: 48, dy: -18 },
      { y: 315, dx: -82, dy: -32 },
      { y: 315, dx: 82, dy: -32 },
      { y: 225, dx: -68, dy: -38 },
      { y: 225, dx: 68, dy: -38 },
      { y: 140, dx: -45, dy: -30 },
      { y: 140, dx: 45, dy: -30 },
    ];
    lobeVeins.forEach(v => {
      ctx.beginPath();
      ctx.moveTo(256, v.y);
      ctx.quadraticCurveTo(256 + v.dx * 0.45, v.y + v.dy * 0.4, 256 + v.dx, v.y + v.dy);
      ctx.stroke();
    });

    if (isKorok) {
      // Mystical tiny Korok spiral glyph
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(256, 260, 16, 0, Math.PI * 1.5);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;

  return texture;
}

export function buildProceduralSapling(
  config: TreeConfig,
  sharedUniforms: {
    uTime: { value: number };
    uWindStrength: { value: number };
    uWindSpeed: { value: number };
    uLightDir: { value: THREE.Vector3 };
  }
): SaplingGenerationResult {
  const group = new THREE.Group();
  group.name = 'BotW_ProceduralSapling';

  const materialsToDispose: (THREE.Material | THREE.Material[])[] = [];
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const leafMeshes: { mesh: THREE.Object3D; baseRotation: THREE.Euler; phase: number; amp: number }[] = [];

  // Seeded PRNG
  let seed = config.seed || 12345;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const species = config.species;
  const isCactus = species.startsWith('gerudo_cactus');
  const isPalm = species.startsWith('faron_palm');
  const isPine = species.startsWith('hebra_pine');
  const isMangrove = species.startsWith('swamp_mangrove');
  const isSakura = species.startsWith('satori_sakura');
  const isBirch = species.startsWith('akkala_birch');
  const isKorok = species.startsWith('korok_ancient');
  const isDry = species.startsWith('dry_withered');
  const isAcacia = species.startsWith('savanna_acacia');
  const isOak = species.startsWith('hyrule_oak') || (!isCactus && !isPalm && !isPine && !isMangrove && !isSakura && !isBirch && !isKorok && !isDry && !isAcacia);

  const saplingHeight = Math.max(0.7, Math.min(1.8, config.trunkHeight || 1.15));
  const baseRadius = Math.max(0.035, Math.min(0.12, (config.trunkRadiusBase || 0.35) * 0.18));
  const topRadius = Math.max(0.02, Math.min(0.06, (config.trunkRadiusTop || 0.15) * 0.2));

  // -------------------------------------------------------------
  // 1. CEL-SHADED MATERIALS
  // -------------------------------------------------------------
  const foliageColorTop = new THREE.Color(config.foliageColorTop || '#8fe83a');
  const foliageColorBottom = new THREE.Color(config.foliageColorBottom || '#2d6d1b');
  const barkColor = new THREE.Color(config.barkColor || '#6e472a');

  // Pixel art path: stems, petioles and buds share the tree's bark palette,
  // and every leaf is a per-species pixel sprite in the tree's foliage palette.
  const usePixelSapling = config.pixelTextureEnabled !== false;
  // Snow lying on the sapling and its mound (the snowy pine variant).
  const isSnowy = (config.snowCover ?? 0) > 0.05;

  // NPR Stem / Bark Material
  const stemMaterial = usePixelSapling
    ? createPixelSaplingStemMaterial(config, sharedUniforms)
    : new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uBarkColor: { value: isBirch ? new THREE.Color('#f0ece1') : barkColor },
      uBarkDark: { value: isBirch ? new THREE.Color('#333333') : barkColor.clone().multiplyScalar(0.45) },
      uRimIntensity: { value: 0.8 },
      uIsBirch: { value: isBirch ? 1.0 : 0.0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        // Convert the inverse-transpose normal back to world space.
        vNormal = normalize((normalMatrix * normal) * mat3(viewMatrix));
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uBarkColor;
      uniform vec3 uBarkDark;
      uniform vec3 uLightDir;
      uniform float uRimIntensity;
      uniform float uIsBirch;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        vec3 N = normalize(vNormal);
        float NdotL = dot(N, uLightDir);
        float celStep = NdotL > 0.15 ? 1.0 : (NdotL > -0.2 ? 0.68 : 0.42);

        vec3 col = mix(uBarkDark, uBarkColor, celStep);

        // Birch lenticel marks (small dark notches)
        if (uIsBirch > 0.5) {
          float marks = step(0.92, fract(vUv.y * 18.0 + sin(vUv.x * 20.0) * 0.3));
          col = mix(col, vec3(0.18, 0.14, 0.12), marks * 0.75);
        }

        // Rim Fresnel
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = pow(1.0 - max(dot(V, N), 0.0), 3.0) * uRimIntensity * 0.4;
        col += vec3(0.9, 0.95, 0.75) * rim;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  materialsToDispose.push(stemMaterial);

  // Saplings share the adults' procedural pixel art leaves so a young tree
  // reads as the same species in the same art direction. The pixel textures are
  // cached and shared, so ownership of disposal stays with the cache.
  const usePixelLeaf = usePixelSapling;
  const leafTexture = usePixelLeaf
    ? getPixelSingleLeafTexture(config)
    : generateSaplingLeafTexture(species, config);
  if (!usePixelLeaf) {
    materialsToDispose.push({
      dispose: () => {
        leafTexture.dispose();
      },
    } as unknown as THREE.Material);
  }

  // NPR Leaf Shader Material with Alpha Cutout & Organic Veins
  const leafMaterial = usePixelLeaf
    ? createPixelSaplingLeafMaterial(config, sharedUniforms)
    : new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uLeafTexture: { value: leafTexture },
      uAlphaTest: { value: 0.35 },
      uRimIntensity: { value: config.rimLightIntensity || 1.1 },
      uSnow: { value: THREE.MathUtils.clamp(config.snowCover ?? 0, 0, 1) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        // Convert the inverse-transpose normal back to world space.
        vNormal = normalize((normalMatrix * normal) * mat3(viewMatrix));
        vUv = uv;
        vec3 pos = position;

        // Gentle leaf flutter at the tips
        float flutter = sin(uTime * uWindSpeed * 4.0 + pos.x * 6.0 + pos.y * 4.0) * uWindStrength * 0.06;
        pos.z += flutter * pos.y;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uLeafTexture;
      uniform float uAlphaTest;
      uniform vec3 uLightDir;
      uniform float uRimIntensity;
      uniform float uSnow;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        // snow heaped on the middle of the sky-facing side, over the gaps too
        vec3 Ns = normalize(vNormal);
        if (!gl_FrontFacing) Ns = -Ns;
        if (uSnow > 0.001 && Ns.y > 0.2) {
          float f = (1.0 - abs(vUv.x - 0.5) * 3.2)
                  * smoothstep(0.08, 0.22, vUv.y) * (1.0 - smoothstep(0.55, 0.82, vUv.y));
          if (f > 1.0 - uSnow * 0.8) {
            gl_FragColor = vec4(dot(Ns, normalize(uLightDir)) > 0.3 ? vec3(0.97, 0.99, 1.0) : vec3(0.78, 0.85, 0.94), 1.0);
            return;
          }
        }
        vec4 texColor = texture2D(uLeafTexture, vUv);

        // Alpha Cutout: Discards transparent pixels so the quad bounding box vanishes completely!
        if (texColor.a < uAlphaTest) {
          discard;
        }

        vec3 N = normalize(vNormal);
        vec3 L = normalize(uLightDir);

        // Two-sided lighting calculation so underside of leaves stay beautifully lit
        float NdotL = dot(N, L);
        float wrapNdotL = mix(NdotL, max(NdotL, -NdotL * 0.45), 0.5);

        // 3-tone BotW Cel Shading
        float lightStep = wrapNdotL > 0.18 ? 1.0 : (wrapNdotL > -0.15 ? 0.72 : 0.48);

        vec3 col = texColor.rgb * lightStep;

        // BotW Sunlit Backlight Translucency (light passing through leaf blade)
        vec3 V = normalize(cameraPosition - vWorldPos);
        float backlight = max(0.0, dot(V, -L));
        col += texColor.rgb * pow(backlight, 2.2) * 0.38;

        // BotW Sunlit Rim Light
        float rim = pow(1.0 - max(dot(V, N), 0.0), 2.5) * uRimIntensity * 0.45;
        col += vec3(1.0, 0.98, 0.8) * rim;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });
  materialsToDispose.push(leafMaterial);

  // -------------------------------------------------------------
  // 2. EARTHEN MOUND & GERMINATION BASE
  // -------------------------------------------------------------
  const moundR = 0.85;
  const moundGeo = new THREE.CylinderGeometry(moundR * 0.85, moundR * 1.1, 0.22, 24);
  const moundColor = isSnowy
    ? 0xe4edf6 // snow
    : isMangrove
    ? 0x2e271f // swamp mud
    : isAcacia
    ? 0xc09a58 // savanna red-gold earth
    : isPalm || isCactus
    ? 0xc2a66e // sand
    : isDry
    ? 0x7a6956 // arid steppe soil
    : isPine
    ? 0x5a4838 // mountain pine soil
    : 0x483c2e; // rich garden soil

  const moundMat = new THREE.MeshToonMaterial({ color: moundColor });
  materialsToDispose.push(moundMat);
  geometriesToDispose.push(moundGeo);

  const mound = new THREE.Mesh(moundGeo, moundMat);
  mound.position.set(0, -0.11, 0);
  mound.name = 'GroundMound';
  mound.userData.ground = true;
  mound.receiveShadow = true;
  group.add(mound);

  // Subtle grassy rim on the mound
  if (!isCactus && !isSnowy) {
    const tuftShape = new THREE.Shape();
    tuftShape.moveTo(-0.025, 0);
    tuftShape.lineTo(0.025, 0);
    tuftShape.quadraticCurveTo(0.02, 0.11, 0.0, 0.18);
    tuftShape.quadraticCurveTo(-0.02, 0.11, -0.025, 0);
    const tuftGeo = new THREE.ShapeGeometry(tuftShape);
    const tuftMat = new THREE.MeshToonMaterial({
      color: isSakura ? 0x81c784 : isDry ? 0xa89368 : isAcacia ? 0xd8bd62 : 0x7cb342,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(tuftMat);
    geometriesToDispose.push(tuftGeo);

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + rnd() * 0.3;
      const dist = 0.3 + rnd() * 0.35;
      const blade = new THREE.Mesh(tuftGeo, tuftMat);
      blade.position.set(Math.cos(angle) * dist, 0.08, Math.sin(angle) * dist);
      blade.rotation.y = rnd() * Math.PI;
      blade.rotation.x = 0.15 * (rnd() - 0.5);
      blade.userData.ground = true;
      group.add(blade);
    }
  }

  // -------------------------------------------------------------
  // 3. SPECIES-SPECIFIC SAPLING GENERATION
  // -------------------------------------------------------------

  if (isCactus) {
    // =========================================================
    // BABY GERUDO CACTUS (MUDA DE CACTO)
    // A single cute chubby ribbed columnar seedling with spines and a flower bud
    // =========================================================
    const cactusHeight = saplingHeight * 0.78; // ~0.8m tall
    const cactusRadius = 0.19;
    const ribCount = 8;

    // Build ribbed cylinder geometry
    const segmentsY = 16;
    const radialSegments = ribCount * 4;
    const cactusGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    // Same per-vertex data the adult cactus hands the pixel succulent shader.
    // Frame N = +X, B = -Z with the angle mirrored, so radial = (cos, 0, sin)
    // matches the positions below AND the frame tangent N x B points up.
    const wood: number[] = [];
    const barkAngle: number[] = [];
    const axisN: number[] = [];
    const axisB: number[] = [];
    const succ: number[] = [];

    for (let y = 0; y <= segmentsY; y++) {
      const v = y / segmentsY;
      const posY = v * cactusHeight;
      // Dome profile: slight curve in at base and rounded dome at apex
      let radiusFactor = 1.0;
      if (v < 0.2) {
        radiusFactor = 0.85 + (v / 0.2) * 0.15;
      } else if (v > 0.75) {
        const topRatio = (v - 0.75) / 0.25;
        radiusFactor = Math.sqrt(Math.max(0.01, 1.0 - topRatio * topRatio));
      }

      for (let r = 0; r <= radialSegments; r++) {
        const u = r / radialSegments;
        const angle = u * Math.PI * 2;
        // Rib indentation
        const ribDepth = Math.cos(angle * ribCount) * 0.013 * radiusFactor;   // soft ribs
        const currentR = Math.max(0.04, cactusRadius * radiusFactor + ribDepth);

        const px = Math.cos(angle) * currentR;
        const pz = Math.sin(angle) * currentR;

        positions.push(px, posY, pz);
        normals.push(Math.cos(angle), (1.0 - radiusFactor) * 0.5, Math.sin(angle));
        uvs.push(u, v);
        wood.push(Math.max(0.03, cactusRadius * radiusFactor), posY, cactusRadius);
        barkAngle.push(Math.cos(angle), -Math.sin(angle));
        axisN.push(1, 0, 0);
        axisB.push(0, 0, -1);
        succ.push(v > 0.75 ? Math.acos(Math.min(1, radiusFactor)) : 0, 0);
      }
    }

    for (let y = 0; y < segmentsY; y++) {
      for (let r = 0; r < radialSegments; r++) {
        const a = y * (radialSegments + 1) + r;
        const b = (y + 1) * (radialSegments + 1) + r;
        const c = (y + 1) * (radialSegments + 1) + (r + 1);
        const d = y * (radialSegments + 1) + (r + 1);
        indices.push(a, b, d);
        indices.push(d, b, c);
      }
    }

    cactusGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    cactusGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    cactusGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    cactusGeo.setAttribute('aWood', new THREE.Float32BufferAttribute(wood, 3));
    cactusGeo.setAttribute('aBarkAngle', new THREE.Float32BufferAttribute(barkAngle, 2));
    cactusGeo.setAttribute('aAxisN', new THREE.Float32BufferAttribute(axisN, 3));
    cactusGeo.setAttribute('aAxisB', new THREE.Float32BufferAttribute(axisB, 3));
    cactusGeo.setAttribute('aSucc', new THREE.Float32BufferAttribute(succ, 2));
    cactusGeo.setIndex(indices);
    cactusGeo.computeVertexNormals();
    geometriesToDispose.push(cactusGeo);

    const cactusMat = config.pixelTextureEnabled !== false
      ? createPixelSucculentMaterial(config, sharedUniforms, ribCount, cactusHeight, cactusRadius, 0.013 / cactusRadius)
      : new THREE.MeshToonMaterial({
      color: 0x68b030, // fresh cactus green
    });
    materialsToDispose.push(cactusMat);

    const cactusMesh = new THREE.Mesh(cactusGeo, cactusMat);
    cactusMesh.castShadow = true;
    cactusMesh.receiveShadow = true;
    group.add(cactusMesh);

    // Baby Cactus Spines (Areoles along the ridges)
    const spineGeo = new THREE.ConeGeometry(0.008, 0.045, 4);
    const spineMat = new THREE.MeshToonMaterial({ color: 0xf5f0c8 });
    materialsToDispose.push(spineMat);
    geometriesToDispose.push(spineGeo);

    for (let rib = 0; rib < ribCount; rib++) {
      const ribAngle = (rib / ribCount) * Math.PI * 2;
      for (let tier = 2; tier < segmentsY - 1; tier += 2) {
        const v = tier / segmentsY;
        const posY = v * cactusHeight;
        let radiusFactor = 1.0;
        if (v < 0.2) radiusFactor = 0.85 + (v / 0.2) * 0.15;
        else if (v > 0.75) {
          const topRatio = (v - 0.75) / 0.25;
          radiusFactor = Math.sqrt(Math.max(0.01, 1.0 - topRatio * topRatio));
        }
        const currentR = cactusRadius * radiusFactor + 0.032 * radiusFactor;
        const spinePos = new THREE.Vector3(
          Math.cos(ribAngle) * currentR,
          posY,
          Math.sin(ribAngle) * currentR
        );

        // Cluster of 2 tiny spines pointing out
        for (let s = -1; s <= 1; s += 2) {
          const spine = new THREE.Mesh(spineGeo, spineMat);
          spine.position.copy(spinePos);
          spine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(ribAngle), s * 0.3, Math.sin(ribAngle)).normalize());
          group.add(spine);
        }
      }
    }

    // Apex Flower Bud (Voltfruit Blossom)
    if (config.pixelTextureEnabled !== false) {
      // Pixel-art blossom on the same texel grid as the cactus beneath it
      const cactusTexel = (cactusMat as THREE.ShaderMaterial).uniforms?.uTexelSize?.value ?? 0.03;
      const flower = buildPixelCactusFlower(config, sharedUniforms, {
        texelSize: cactusTexel,
        swayHeight: cactusHeight,
      });
      // just above the apex: the cup's inner half would otherwise sink into the dome
      flower.group.position.set(0, cactusHeight + 0.004, 0);
      flower.geometries.forEach((g) => geometriesToDispose.push(g));
      flower.materials.forEach((m) => materialsToDispose.push(m));
      group.add(flower.group);
    } else {
    const flowerGroup = new THREE.Group();
    flowerGroup.position.set(0, cactusHeight * 0.98, 0);

    const petalGeo = new THREE.ConeGeometry(0.045, 0.11, 5);
    geometriesToDispose.push(petalGeo);
    const petalMat = new THREE.MeshToonMaterial({ color: 0xff3b77 }); // vibrant pink desert flower
    materialsToDispose.push(petalMat);

    for (let p = 0; p < 7; p++) {
      const pAngle = (p / 7) * Math.PI * 2;
      const petal = new THREE.Mesh(petalGeo, petalMat);
      petal.position.set(Math.cos(pAngle) * 0.045, 0.03, Math.sin(pAngle) * 0.045);
      petal.rotation.z = Math.cos(pAngle) * 0.5;
      petal.rotation.x = -Math.sin(pAngle) * 0.5;
      petal.rotation.y = pAngle;
      flowerGroup.add(petal);
    }

    // Yellow flower center
    const centerGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const centerMat = new THREE.MeshToonMaterial({ color: 0xffea00 });
    materialsToDispose.push(centerMat);
    geometriesToDispose.push(centerGeo);
    const centerMesh = new THREE.Mesh(centerGeo, centerMat);
    centerMesh.position.set(0, 0.04, 0);
    flowerGroup.add(centerMesh);

    group.add(flowerGroup);
    }

  } else if (isPalm) {
    // A young coconut palm: short sheathed shoot, arching pinnate leaves,
    // and one folded spear growing from the centre.
    const coconutGeo = new THREE.SphereGeometry(0.21, 12, 8);
    coconutGeo.scale(1.22, 0.88, 0.95);
    geometriesToDispose.push(coconutGeo);
    const coconutMat = createPixelPropMaterial(config, sharedUniforms, '#68503a', 'scales');
    materialsToDispose.push(coconutMat);
    const coconut = new THREE.Mesh(coconutGeo, coconutMat);
    coconut.name = 'PalmSeed';
    coconut.position.set(-0.06, 0.12, 0.02);
    coconut.rotation.set(0.12, rnd() * Math.PI, 0.3);
    coconut.castShadow = true;
    group.add(coconut);

    const palmStemMat = usePixelSapling
      ? createPixelSaplingStemMaterial(config, sharedUniforms, true)
      : new THREE.MeshToonMaterial({ color: 0x648333 });
    materialsToDispose.push(palmStemMat);
    const crownHeight = saplingHeight * 0.57;
    const stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.035, 0.18, 0),
      new THREE.Vector3(0.045, crownHeight * 0.65, -0.015),
      new THREE.Vector3(0.07, crownHeight, -0.025),
    ]);
    const stemGeo = createClosedTaperedBranchGeo(stemCurve, 0.047, 0.022, 10, 7);
    geometriesToDispose.push(stemGeo);
    const stem = new THREE.Mesh(stemGeo, palmStemMat);
    stem.name = 'PalmShoot'; stem.castShadow = true; group.add(stem);
    const apex = stemCurve.getPoint(1);

    // Curved, folded ribbons, with UVs following each blade from base to tip.
    const blade = (start: THREE.Vector3, end: THREE.Vector3, width: number) => {
      const geo = new THREE.PlaneGeometry(width, 1, 2, 7);
      const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
      const direction = end.clone().sub(start);
      const across = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
      for (let i = 0; i < pos.count; i++) {
        const t = uv.getY(i), x = (uv.getX(i) - 0.5) * width;
        const p = start.clone().addScaledVector(direction, t).addScaledVector(across, x);
        p.y += Math.sin(t * Math.PI) * direction.length() * 0.16;
        p.y += (1 - Math.abs(x) / (width * 0.5)) * width * 0.13;
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      geo.computeVertexNormals(); geometriesToDispose.push(geo);
      const mesh = new THREE.Mesh(geo, leafMaterial);
      mesh.name = 'PalmBlade'; mesh.castShadow = true;
      return mesh;
    };

    const rotation = rnd() * Math.PI * 2;
    for (let f = 0; f < 5; f++) {
      const frond = new THREE.Group(); frond.name = 'PalmFrond';
      frond.position.copy(apex); frond.position.y -= f * 0.009;
      frond.rotation.y = rotation + f * Math.PI * 2 / 5 + (rnd() - 0.5) * 0.24;
      const length = saplingHeight * (0.77 + rnd() * 0.18);
      const rise = f < 2 ? 0.36 : 0.21;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(),
        new THREE.Vector3(0, rise, length * 0.34),
        new THREE.Vector3(0.02, rise * 0.72, length * 0.7),
        new THREE.Vector3(0.03, -0.15 - rnd() * 0.09, length),
      ]);
      const spineGeo = createClosedTaperedBranchGeo(curve, 0.015, 0.003, 14, 5);
      geometriesToDispose.push(spineGeo);
      const spine = new THREE.Mesh(spineGeo, palmStemMat); spine.castShadow = true; frond.add(spine);
      for (let l = 0; l < 8; l++) {
        const t = 0.19 + l * 0.091;
        for (const side of [-1, 1]) {
          const start = curve.getPoint(t + (side === 1 ? 0.016 : 0));
          const reach = length * (0.34 * Math.sin(t * Math.PI) + 0.035) * (0.94 + rnd() * 0.12);
          const end = start.clone().add(new THREE.Vector3(side * reach, -reach * (0.25 + t * 0.45), reach * 0.48));
          frond.add(blade(start, end, 0.057 + (1 - t) * 0.032));
        }
      }
      frond.add(blade(curve.getPoint(0.84), curve.getPoint(1).add(new THREE.Vector3(0, -0.035, 0.12)), 0.055));
      group.add(frond);
      leafMeshes.push({mesh: frond, baseRotation: frond.rotation.clone(), phase: f * 1.7, amp: 0.045});
    }
    const spear = new THREE.Group(); spear.name = 'PalmSpear'; spear.position.copy(apex);
    spear.add(blade(new THREE.Vector3(), new THREE.Vector3(0.12, saplingHeight * 0.53, 0.07), 0.09));
    spear.add(blade(new THREE.Vector3(), new THREE.Vector3(-0.06, saplingHeight * 0.42, -0.13), 0.075));
    group.add(spear);
    leafMeshes.push({mesh: spear, baseRotation: spear.rotation.clone(), phase: 2.3, amp: 0.025});

  } else if (isPine) {
    // =========================================================
    // BABY HEBRA PINE SPROUT (MUDA DE PINHEIRO DE HEBRA)
    // Authentic BotW conifer seedling:
    // - Sprouted miniature pine cone (pinha) and alpine frost on the ground mound
    // - Slender supple woody stem with gentle natural curve
    // - 3 tiered whorls of soft feathery pine needle fan sprays with wooden branchlets
    // - Fresh apical pine candle bud and upright young needle crown
    // =========================================================

    // 1. Ground Relic: Sprouted Pine Cone (Pinha germinada de Hebra)
    const pineconeGroup = new THREE.Group();
    pineconeGroup.position.set(0.19, 0.04, 0.13);
    pineconeGroup.rotation.set(0.35, 0.75, -0.42);

    const coneCoreGeo = new THREE.ConeGeometry(0.065, 0.16, 8);
    coneCoreGeo.translate(0, 0.08, 0);
    geometriesToDispose.push(coneCoreGeo);
    const coneMat = new THREE.MeshToonMaterial({ color: 0x45271a });
    materialsToDispose.push(coneMat);
    const coneCore = new THREE.Mesh(coneCoreGeo, coneMat);
    coneCore.castShadow = true;
    pineconeGroup.add(coneCore);

    // Radiating woody scales on the sprouted cone
    const coneScaleGeo = new THREE.ConeGeometry(0.024, 0.048, 4);
    coneScaleGeo.rotateX(Math.PI / 2);
    geometriesToDispose.push(coneScaleGeo);

    for (let layer = 0; layer < 4; layer++) {
      const layerY = 0.028 + layer * 0.034;
      const count = 5 + layer;
      const layerR = (1.0 - layer * 0.18) * 0.064;
      for (let s = 0; s < count; s++) {
        const sAngle = (s / count) * Math.PI * 2 + layer * 0.55;
        const scaleMesh = new THREE.Mesh(coneScaleGeo, coneMat);
        scaleMesh.position.set(Math.cos(sAngle) * layerR, layerY, Math.sin(sAngle) * layerR);
        scaleMesh.rotation.y = sAngle;
        scaleMesh.rotation.x = -0.38;
        pineconeGroup.add(scaleMesh);
      }
    }
    group.add(pineconeGroup);

    // Alpine frost / light snow patches on the soil mound
    const snowGeo = new THREE.CircleGeometry(0.16, 12);
    snowGeo.rotateX(-Math.PI / 2);
    geometriesToDispose.push(snowGeo);
    const snowMat = new THREE.MeshToonMaterial({
      color: 0xebf8ff,
      transparent: true,
      opacity: 0.82,
    });
    materialsToDispose.push(snowMat);

    for (let sn = 0; sn < (isSnowy ? 0 : 4); sn++) {
      const snAngle = sn * 1.55 + 0.35;
      const snDist = 0.38 + (sn % 2) * 0.16;
      const snowPatch = new THREE.Mesh(snowGeo, snowMat);
      snowPatch.position.set(Math.cos(snAngle) * snDist, 0.005, Math.sin(snAngle) * snDist);
      snowPatch.scale.set(1.0 + (sn % 2) * 0.35, 1.0, 0.75 + (sn % 2) * 0.25);
      snowPatch.rotation.y = sn * 0.65;
      group.add(snowPatch);
    }

    // 2. Slender supple stem with gentle curve
    const pineHeight = saplingHeight * 0.95; // ~0.85m
    const pineStemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.015, pineHeight * 0.35, 0.012),
      new THREE.Vector3(-0.014, pineHeight * 0.7, -0.012),
      new THREE.Vector3(0.005, pineHeight, 0.002),
    ]);

    const pineStemGeo = new THREE.TubeGeometry(pineStemCurve, 18, baseRadius * 0.72, 8, false);
    geometriesToDispose.push(pineStemGeo);
    const pineStem = new THREE.Mesh(pineStemGeo, stemMaterial);
    pineStem.castShadow = true;
    group.add(pineStem);

    // Apical pine candle bud capping the hollow stem tube seamlessly
    const apexPt = pineStemCurve.getPoint(1.0);
    const apexTangent = pineStemCurve.getTangent(1.0).normalize();

    const pineCandleBudGeo = new THREE.ConeGeometry(0.024, 0.12, 8);
    pineCandleBudGeo.translate(0, 0.06, 0);
    geometriesToDispose.push(pineCandleBudGeo);
    const pineCandleBudMat = new THREE.MeshToonMaterial({ color: 0x5cdb7a }); // fresh tender conifer candle
    materialsToDispose.push(pineCandleBudMat);
    const pineCandleBud = new THREE.Mesh(pineCandleBudGeo, pineCandleBudMat);
    pineCandleBud.position.copy(apexPt);
    pineCandleBud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), apexTangent);
    pineCandleBud.castShadow = true;
    group.add(pineCandleBud);

    // 3. Curved conifer needle fan geometry with 3D midrib fold and BotW alpha cutout
    const pineFanGeo = createCurvedLeafGeometry(0.32, 0.42);
    geometriesToDispose.push(pineFanGeo);

    // 3 Tiered whorls of spreading lateral conifer branches
    const pineWhorls = [
      { t: 0.36, branchCount: 4, twigLen: 0.12, pitch: 0.62, scale: 1.05, angleOffset: 0.1 },
      { t: 0.60, branchCount: 4, twigLen: 0.09, pitch: 0.54, scale: 0.94, angleOffset: 0.85 },
      { t: 0.80, branchCount: 3, twigLen: 0.07, pitch: 0.46, scale: 0.86, angleOffset: 0.35 },
    ];

    let branchIndex = 0;
    pineWhorls.forEach((whorl) => {
      const stemPt = pineStemCurve.getPoint(whorl.t);

      for (let b = 0; b < whorl.branchCount; b++) {
        const branchAngle = (b / whorl.branchCount) * Math.PI * 2 + whorl.angleOffset + (rnd() - 0.5) * 0.15;
        const branchGroup = new THREE.Group();
        branchGroup.position.copy(stemPt);
        branchGroup.rotation.y = branchAngle;
        branchGroup.rotation.z = -(whorl.pitch + (isSnowy ? 0.42 : 0));

        // Wooden twig (branchlet) starting 0.015 inside the trunk for seamless continuous connection
        const twigGeo = new THREE.CylinderGeometry(0.005 * whorl.scale, 0.009 * whorl.scale, whorl.twigLen + 0.02, 5);
        twigGeo.translate(0, whorl.twigLen * 0.5 - 0.01, 0);
        geometriesToDispose.push(twigGeo);

        const twigMesh = new THREE.Mesh(twigGeo, stemMaterial);
        twigMesh.castShadow = true;
        branchGroup.add(twigMesh);

        // Conifer needle fan spray attached directly at the twig tip
        const fanBladeGroup = new THREE.Group();
        fanBladeGroup.position.set(0, whorl.twigLen * 0.88, 0);
        fanBladeGroup.rotation.x = 0.24; // gentle outward-spreading arch

        const fanMesh = new THREE.Mesh(pineFanGeo, leafMaterial);
        fanMesh.scale.set(whorl.scale, whorl.scale, whorl.scale);
        fanMesh.rotation.z = (b % 2 === 0 ? 0.12 : -0.12); // slight natural roll
        // Snowy variant: the spray is turned flat, a shelf that snow can rest
        // on (as modelled it stands edge-up along the twig), and its twig
        // sags further under the weight (see the pitch above).
        if (isSnowy) fanMesh.rotation.y = Math.PI / 2;
        fanMesh.castShadow = true;
        fanBladeGroup.add(fanMesh);
        branchGroup.add(fanBladeGroup);

        group.add(branchGroup);
        leafMeshes.push({
          mesh: branchGroup,
          baseRotation: branchGroup.rotation.clone(),
          phase: branchIndex * 1.3,
          amp: 0.06,
        });
        branchIndex++;
      }
    });

    // 4. Apical Crown of 4 fresh upright conifer needle fans surrounding the candle bud
    for (let c = 0; c < 4; c++) {
      const crownAngle = (c / 4) * Math.PI * 2 + 0.35;
      const crownGroup = new THREE.Group();
      crownGroup.position.copy(apexPt);
      crownGroup.rotation.y = crownAngle;
      crownGroup.rotation.z = isSnowy ? -0.5 : -0.32; // steeply upright (~20 degrees from vertical)

      // Short apical twig
      const crownTwigGeo = new THREE.CylinderGeometry(0.004, 0.007, 0.05, 5);
      crownTwigGeo.translate(0, 0.02, 0);
      geometriesToDispose.push(crownTwigGeo);
      const crownTwig = new THREE.Mesh(crownTwigGeo, stemMaterial);
      crownGroup.add(crownTwig);

      // Fresh young needle fan
      const crownBladeGroup = new THREE.Group();
      crownBladeGroup.position.set(0, 0.045, 0);
      crownBladeGroup.rotation.x = 0.15;

      const fanMesh = new THREE.Mesh(pineFanGeo, leafMaterial);
      fanMesh.scale.set(0.78, 0.78, 0.78);
      if (isSnowy) fanMesh.rotation.y = Math.PI / 2; // laid flat, holding snow
      fanMesh.castShadow = true;
      crownBladeGroup.add(fanMesh);
      crownGroup.add(crownBladeGroup);

      group.add(crownGroup);
      leafMeshes.push({
        mesh: crownGroup,
        baseRotation: crownGroup.rotation.clone(),
        phase: c * 1.5 + 3.0,
        amp: 0.07,
      });
    }

  } else if (isMangrove) {
    // =========================================================
    // SWAMP MANGROVE PROPAGULE (PROPÁGULO / MUDA DE MANGUE)
    // Elongated pencil-like viviparous hypocotyl, 3 arched stilt rootlets, and 4 broad shiny leaves
    // =========================================================
    // 1. Propagule main spear (the green-brown pencil-like hypocotyl)
    const spearCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.1, 0),
      new THREE.Vector3(0.02, saplingHeight * 0.45, -0.01),
      new THREE.Vector3(-0.01, saplingHeight * 0.8, 0.02),
      new THREE.Vector3(0, saplingHeight, 0),
    ]);

    const spearGeo = new THREE.TubeGeometry(spearCurve, 16, baseRadius * 0.9, 8, false);
    geometriesToDispose.push(spearGeo);
    const spearMesh = new THREE.Mesh(spearGeo, stemMaterial);
    spearMesh.castShadow = true;
    group.add(spearMesh);

    // Apical pointed spear bud capping the hollow tube
    const apexPt = spearCurve.getPoint(1.0);
    const spearBudGeo = new THREE.ConeGeometry(baseRadius * 0.92, 0.12, 8);
    spearBudGeo.translate(0, 0.06, 0);
    geometriesToDispose.push(spearBudGeo);
    const spearBud = new THREE.Mesh(spearBudGeo, stemMaterial);
    spearBud.position.copy(apexPt);
    const spearTangent = spearCurve.getTangent(1.0).normalize();
    spearBud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spearTangent);
    spearBud.castShadow = true;
    group.add(spearBud);

    // 2. 3 tiny arched stilt prop rootlets anchoring the propagule into mud
    for (let r = 0; r < 3; r++) {
      const rAngle = (r / 3) * Math.PI * 2 + 0.3;
      const rootR = 0.32;
      const rootH = 0.28;

      const rootCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, rootH, 0),
        new THREE.Vector3(Math.cos(rAngle) * rootR * 0.65, rootH * 0.75, Math.sin(rAngle) * rootR * 0.65),
        new THREE.Vector3(Math.cos(rAngle) * rootR, 0.0, Math.sin(rAngle) * rootR),
      ]);

      const rootGeo = new THREE.TubeGeometry(rootCurve, 10, 0.022, 6, false);
      geometriesToDispose.push(rootGeo);
      const rootMesh = new THREE.Mesh(rootGeo, stemMaterial);
      group.add(rootMesh);
    }

    // 3. 5 broad glossy oval leaves at the tip (firmly attached with wooden petioles)
    const mangroveLeafGeo = createCurvedLeafGeometry(0.22, 0.36);
    geometriesToDispose.push(mangroveLeafGeo);

    for (let m = 0; m < 5; m++) {
      const mAngle = (m / 5) * Math.PI * 2 + (rnd() - 0.5) * 0.2;
      const leafGroup = new THREE.Group();
      leafGroup.position.copy(apexPt);
      leafGroup.rotation.y = mAngle;
      leafGroup.rotation.z = -0.55; // arching outward

      const mPetioleGeo = new THREE.CylinderGeometry(0.005, 0.009, 0.07, 5);
      mPetioleGeo.translate(0, 0.03, 0);
      geometriesToDispose.push(mPetioleGeo);
      const mPetiole = new THREE.Mesh(mPetioleGeo, stemMaterial);
      leafGroup.add(mPetiole);

      const leafBladeGroup = new THREE.Group();
      leafBladeGroup.position.set(0, 0.055, 0);
      leafBladeGroup.rotation.x = 0.22;

      const leaf = new THREE.Mesh(mangroveLeafGeo, leafMaterial);
      leaf.castShadow = true;
      leafBladeGroup.add(leaf);
      leafGroup.add(leafBladeGroup);
      group.add(leafGroup);

      leafMeshes.push({
        mesh: leafGroup,
        baseRotation: leafGroup.rotation.clone(),
        phase: m * 1.3,
        amp: 0.06,
      });
    }

  } else if (isAcacia) {
    // =========================================================
    // SAVANNA ACACIA SAPLING (MUDA DE ACÁCIA DA SAVANA)
    // A slender stem that zig-zags from node to node, a pair of pale thorns
    // at every node, and pinnate leaves held flat - on short side shoots and
    // in a ring at the top, already the flat little crown of the adult tree.
    // =========================================================
    const acaciaHeight = saplingHeight * 0.88;
    const zig = 0.035;
    const stemPts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
    const nodes = 5;
    for (let n = 1; n <= nodes; n++) {
      const side = n % 2 === 0 ? 1 : -1;
      const ang = n * 2.1 + rnd() * 0.3;
      stemPts.push(new THREE.Vector3(
        Math.cos(ang) * zig * side,
        (n / nodes) * acaciaHeight,
        Math.sin(ang) * zig * side
      ));
    }
    const acaciaCurve = new THREE.CatmullRomCurve3(stemPts, false, 'centripetal');
    const acaciaStemGeo = createClosedTaperedBranchGeo(acaciaCurve, baseRadius * 0.8, topRadius * 0.7, 24, 8, false);
    geometriesToDispose.push(acaciaStemGeo);
    const acaciaStem = new THREE.Mesh(acaciaStemGeo, stemMaterial);
    acaciaStem.castShadow = true;
    group.add(acaciaStem);

    // Paired thorns at each node, pale against the bark
    const thornGeo = new THREE.ConeGeometry(0.006, 0.07, 5);
    thornGeo.translate(0, 0.035, 0);
    geometriesToDispose.push(thornGeo);
    const thornMat = usePixelSapling
      ? createPixelPropMaterial(config, sharedUniforms, '#e9e0c8', 'smooth')
      : new THREE.MeshToonMaterial({ color: 0xe9e0c8 });
    materialsToDispose.push(thornMat);
    const up = new THREE.Vector3(0, 1, 0);
    for (let n = 1; n < nodes; n++) {
      const t = n / nodes;
      const p = acaciaCurve.getPoint(t);
      const tangent = acaciaCurve.getTangent(t).normalize();
      const around = n * 2.4;
      [0, Math.PI].forEach((offset) => {
        const outward = new THREE.Vector3(Math.cos(around + offset), 0, Math.sin(around + offset));
        const dir = outward.addScaledVector(tangent, 0.9).normalize();
        const thorn = new THREE.Mesh(thornGeo, thornMat);
        thorn.position.copy(p).addScaledVector(dir, baseRadius * 0.4);
        thorn.quaternion.setFromUnitVectors(up, dir);
        group.add(thorn);
      });
    }

    // One pinnate leaf lying (almost) flat, pointing along `azimuth`.
    const acaciaLeafGeo = createCurvedLeafGeometry(0.16, 0.3);
    geometriesToDispose.push(acaciaLeafGeo);
    const addFlatLeaf = (parent: THREE.Object3D, azimuth: number, scale: number, droop: number) => {
      const holder = new THREE.Group();
      holder.rotation.y = azimuth;
      const leaf = new THREE.Mesh(acaciaLeafGeo, leafMaterial);
      // the leaf is modelled growing up +Y with its face on +Z; turn it to
      // grow outward along -Z with its face to the sky, tipped down by `droop`
      leaf.rotation.x = -Math.PI / 2 - droop;
      leaf.scale.setScalar(scale);
      leaf.castShadow = true;
      holder.add(leaf);
      parent.add(holder);
    };

    // Short side shoots, each ending in a small flat spray of leaves
    [0.5, 0.68].forEach((t, i) => {
      const shoot = new THREE.Group();
      shoot.position.copy(acaciaCurve.getPoint(t));
      shoot.rotation.y = i * 2.6 + rnd() * 0.5;
      const len = 0.16 - i * 0.03;
      const twigGeo = new THREE.CylinderGeometry(0.004, 0.007, len, 5);
      twigGeo.rotateZ(-Math.PI / 2 + 0.35);                 // out and a little up
      twigGeo.translate(len * 0.47, len * 0.17, 0);
      geometriesToDispose.push(twigGeo);
      shoot.add(new THREE.Mesh(twigGeo, stemMaterial));
      const tip = new THREE.Group();
      tip.position.set(len * 0.94, len * 0.34, 0);
      for (let k = 0; k < 3; k++) addFlatLeaf(tip, -Math.PI / 2 + (k - 1) * 0.75, 0.75 - i * 0.1, 0.1);
      shoot.add(tip);
      group.add(shoot);
      leafMeshes.push({ mesh: shoot, baseRotation: shoot.rotation.clone(), phase: i * 1.7, amp: 0.05 });
    });

    // The flat crown: a ring of leaves spread level around the top
    const crown = new THREE.Group();
    crown.position.copy(acaciaCurve.getPoint(1));
    const ringCount = 9;
    for (let k = 0; k < ringCount; k++) {
      addFlatLeaf(crown, (k / ringCount) * Math.PI * 2 + rnd() * 0.3, 0.9 + rnd() * 0.2, -0.04 + rnd() * 0.06);
    }
    // a smaller, fresher ring just above closes the middle
    const crownTop = new THREE.Group();
    crownTop.position.y = 0.02;
    for (let k = 0; k < 5; k++) addFlatLeaf(crownTop, (k / 5) * Math.PI * 2 + 0.4, 0.62, -0.08);
    crown.add(crownTop);
    group.add(crown);
    leafMeshes.push({ mesh: crown, baseRotation: crown.rotation.clone(), phase: 3.1, amp: 0.04 });

  } else if (isDry) {
    // =========================================================
    // DRY WITHERED SAPLING (MUDA / ARBUSTO DE GRAVETOS SECOS)
    // 100% airtight, solid closed tapered deadwood branches with sharp pointed tips,
    // split apical prongs, weathered steppe rocks, and cracked dry bark!
    // ZERO hollow holes, gaps, or cut pipe openings!
    // =========================================================

    // 1. Weathered steppe relic stones at the base
    const rockGeo = new THREE.DodecahedronGeometry(0.12, 0);
    rockGeo.scale(1.3, 0.65, 1.1);
    geometriesToDispose.push(rockGeo);
    const rockMat = new THREE.MeshToonMaterial({ color: 0x7c7368 });
    materialsToDispose.push(rockMat);
    const rockMesh = new THREE.Mesh(rockGeo, rockMat);
    rockMesh.position.set(0.16, 0.04, -0.08);
    rockMesh.rotation.set(0.3, 0.5, -0.2);
    rockMesh.castShadow = true;
    group.add(rockMesh);

    const rock2Geo = new THREE.DodecahedronGeometry(0.08, 0);
    rock2Geo.scale(1.2, 0.5, 0.9);
    geometriesToDispose.push(rock2Geo);
    const rock2Mesh = new THREE.Mesh(rock2Geo, rockMat);
    rock2Mesh.position.set(-0.14, 0.03, 0.12);
    rock2Mesh.rotation.set(-0.2, 0.8, 0.1);
    rock2Mesh.castShadow = true;
    group.add(rock2Mesh);

    // 2. Gnarled twisting main stem with solid closed tapering geometry
    const dryStemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.04, saplingHeight * 0.32, 0.03),
      new THREE.Vector3(-0.04, saplingHeight * 0.68, -0.02),
      new THREE.Vector3(0.02, saplingHeight * 0.92, 0.01),
    ]);

    const dryStemGeo = createClosedTaperedBranchGeo(
      dryStemCurve,
      baseRadius * 0.85,
      baseRadius * 0.32,
      18,
      8,
      true
    );
    geometriesToDispose.push(dryStemGeo);
    const dryStemMesh = new THREE.Mesh(dryStemGeo, stemMaterial);
    dryStemMesh.castShadow = true;
    group.add(dryStemMesh);

    // 3. Naturally split sharp apical fork at the top of the main stem
    const topPt = dryStemCurve.getPoint(1.0);
    const prong1End = topPt.clone().add(new THREE.Vector3(0.035, 0.14, 0.025));
    const prong1Curve = new THREE.CatmullRomCurve3([topPt, prong1End]);
    const prong1Geo = createClosedTaperedBranchGeo(prong1Curve, baseRadius * 0.28, 0.005, 8, 6, false);
    geometriesToDispose.push(prong1Geo);
    const prong1Mesh = new THREE.Mesh(prong1Geo, stemMaterial);
    prong1Mesh.castShadow = true;
    group.add(prong1Mesh);

    const prong2End = topPt.clone().add(new THREE.Vector3(-0.028, 0.11, -0.032));
    const prong2Curve = new THREE.CatmullRomCurve3([topPt, prong2End]);
    const prong2Geo = createClosedTaperedBranchGeo(prong2Curve, baseRadius * 0.24, 0.005, 8, 6, false);
    geometriesToDispose.push(prong2Geo);
    const prong2Mesh = new THREE.Mesh(prong2Geo, stemMaterial);
    prong2Mesh.castShadow = true;
    group.add(prong2Mesh);

    // 4. Bare gnarled side branches branching off the stem
    const branchConfigs = [
      { t: 0.36, angle: 0.4, pitch: 0.95, length: 0.36, radius: baseRadius * 0.52 },
      { t: 0.60, angle: 2.4, pitch: 0.82, length: 0.30, radius: baseRadius * 0.44 },
      { t: 0.80, angle: 4.6, pitch: 0.70, length: 0.24, radius: baseRadius * 0.36 },
    ];

    branchConfigs.forEach((bCfg) => {
      const stemPt = dryStemCurve.getPoint(bCfg.t);
      const bDir = new THREE.Vector3(
        Math.cos(bCfg.angle) * Math.sin(bCfg.pitch),
        Math.cos(bCfg.pitch),
        Math.sin(bCfg.angle) * Math.sin(bCfg.pitch)
      ).normalize();

      const bMid = stemPt.clone().add(bDir.clone().multiplyScalar(bCfg.length * 0.52)).add(new THREE.Vector3(0.015, 0.02, -0.01));
      const bEnd = stemPt.clone().add(bDir.clone().multiplyScalar(bCfg.length));

      const bCurve = new THREE.CatmullRomCurve3([stemPt, bMid, bEnd]);
      const bGeo = createClosedTaperedBranchGeo(bCurve, bCfg.radius, 0.006, 10, 6, false);
      geometriesToDispose.push(bGeo);
      const bMesh = new THREE.Mesh(bGeo, stemMaterial);
      bMesh.castShadow = true;
      group.add(bMesh);

      // Secondary sub-twig fork with tapered closed point
      const subDir = new THREE.Vector3(
        Math.cos(bCfg.angle + 0.85) * 0.72,
        0.55,
        Math.sin(bCfg.angle + 0.85) * 0.72
      ).normalize();
      const subEnd = bMid.clone().add(subDir.multiplyScalar(bCfg.length * 0.48));
      const subCurve = new THREE.CatmullRomCurve3([bMid, subEnd]);
      const subGeo = createClosedTaperedBranchGeo(subCurve, bCfg.radius * 0.65, 0.004, 8, 5, false);
      geometriesToDispose.push(subGeo);
      const subMesh = new THREE.Mesh(subGeo, stemMaterial);
      subMesh.castShadow = true;
      group.add(subMesh);
    });

  } else {
    // =========================================================
    // DECIDUOUS & MYSTICAL SAPLINGS (OAK, SAKURA, BIRCH, KOROK)
    // Slender graceful stem, germination relic, and 5-8 distinct stylized leaves!
    // =========================================================

    // 1. Germination relic / ground charm:
    if (isOak) {
      // The acorn the seedling grew from: a whole nut with its scaly cup,
      // tipped over on the soil beside the stem, with the root it put out
      // curving from its split tip into the base of the stem. (The old
      // version - a flattened sphere over an upside-down cone, both sunk
      // into the mound - read as an empty bowl.)
      const nutRadius = 0.05;
      const nutStretch = 1.35;
      const acornAngle = 0.65 + rnd() * 0.6;
      const acornPos = new THREE.Vector3(Math.cos(acornAngle) * 0.13, nutRadius * 0.9, Math.sin(acornAngle) * 0.13);
      // tip toward the stem and a little down into the soil
      const toStem = new THREE.Vector3(-acornPos.x, -0.03, -acornPos.z).normalize();

      const nutMat = usePixelSapling
        ? createPixelPropMaterial(config, sharedUniforms, '#a8743a', 'smooth')
        : new THREE.MeshToonMaterial({ color: 0x8d5b32 });
      const cupMat = usePixelSapling
        ? createPixelPropMaterial(config, sharedUniforms, '#6b4a2a', 'scales')
        : new THREE.MeshToonMaterial({ color: 0x4a2e18 });
      materialsToDispose.push(nutMat, cupMat);

      const acorn = new THREE.Group();
      acorn.position.copy(acornPos);
      // local -Y is the nut's tip
      acorn.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), toStem);

      const nutGeo = new THREE.SphereGeometry(nutRadius, 14, 10);
      nutGeo.scale(1, nutStretch, 1);
      const tipGeo = new THREE.ConeGeometry(nutRadius * 0.34, nutRadius * 0.7, 8);
      tipGeo.rotateX(Math.PI);
      tipGeo.translate(0, -nutRadius * nutStretch - nutRadius * 0.2, 0);
      // cup: the upper cap of a slightly larger sphere, flattened
      const cupGeo = new THREE.SphereGeometry(nutRadius * 1.14, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.46);
      cupGeo.scale(1, 0.85, 1);
      cupGeo.translate(0, nutRadius * nutStretch * 0.42, 0);
      const cupStalkGeo = new THREE.CylinderGeometry(nutRadius * 0.12, nutRadius * 0.16, nutRadius * 0.5, 6);
      cupStalkGeo.translate(0, nutRadius * nutStretch * 0.42 + nutRadius * 1.14 * 0.85 + nutRadius * 0.15, 0);
      geometriesToDispose.push(nutGeo, tipGeo, cupGeo, cupStalkGeo);

      acorn.add(new THREE.Mesh(nutGeo, nutMat));
      acorn.add(new THREE.Mesh(tipGeo, nutMat));
      acorn.add(new THREE.Mesh(cupGeo, cupMat));
      acorn.add(new THREE.Mesh(cupStalkGeo, cupMat));
      acorn.children.forEach((c) => { (c as THREE.Mesh).castShadow = true; });
      group.add(acorn);

      // the root: from the split tip, arching down into the stem's foot
      const tipWorld = acornPos.clone().addScaledVector(toStem, nutRadius * (nutStretch + 0.45));
      const rootCurve = new THREE.CatmullRomCurve3([
        tipWorld,
        tipWorld.clone().lerp(new THREE.Vector3(0, 0, 0), 0.5).add(new THREE.Vector3(0, -0.015, 0)),
        new THREE.Vector3(0, -0.01, 0),
      ]);
      const rootGeo = createClosedTaperedBranchGeo(rootCurve, baseRadius * 0.28, baseRadius * 0.55, 8, 6, false);
      geometriesToDispose.push(rootGeo);
      const rootMesh = new THREE.Mesh(rootGeo, stemMaterial);
      rootMesh.castShadow = true;
      group.add(rootMesh);
    }

    // 2. Slender supple stem with organic gentle curve
    const stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.03, saplingHeight * 0.35, 0.02),
      new THREE.Vector3(-0.02, saplingHeight * 0.7, -0.02),
      new THREE.Vector3(0.01, saplingHeight, 0.01),
    ]);

    const stemGeo = new THREE.TubeGeometry(stemCurve, 18, baseRadius * 0.7, 8, false);
    geometriesToDispose.push(stemGeo);
    const stemMesh = new THREE.Mesh(stemGeo, stemMaterial);
    stemMesh.castShadow = true;
    group.add(stemMesh);

    // Apical terminal bud capping the hollow stem tube so it is never hollow ("cabo vazado")
    const apexPt = stemCurve.getPoint(1.0);
    const apexRadius = baseRadius * 0.72;
    const apexTangent = stemCurve.getTangent(1.0).normalize();
    const apexBudGeo = new THREE.SphereGeometry(apexRadius * 1.05, 10, 8);
    apexBudGeo.scale(1.0, 1.4, 1.0);
    geometriesToDispose.push(apexBudGeo);
    const apexBud = new THREE.Mesh(apexBudGeo, stemMaterial);
    apexBud.position.copy(apexPt);
    apexBud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), apexTangent);
    apexBud.castShadow = true;
    group.add(apexBud);

    // 3. Individual leaves along the stem + apical cluster
    // Distinct stylized leaf geometry with curved 3D midrib fold and authentic BotW texture
    const leafGeo = createCurvedLeafGeometry(0.24, 0.36);
    geometriesToDispose.push(leafGeo);

    const leafPositions = [
      { t: 0.36, angle: 0.2, pitch: 0.65, scale: 0.88 },
      { t: 0.50, angle: 2.2, pitch: 0.60, scale: 0.94 },
      { t: 0.64, angle: 4.1, pitch: 0.55, scale: 1.0 },
      { t: 0.77, angle: 1.1, pitch: 0.50, scale: 1.04 },
      { t: 0.89, angle: 3.3, pitch: 0.45, scale: 0.96 },
    ];

    leafPositions.forEach((lp, idx) => {
      const stemPt = stemCurve.getPoint(lp.t);
      const leafGroup = new THREE.Group();
      leafGroup.position.copy(stemPt);
      // Natural branch orientation: azimuthal angle around trunk + outward elevation tilt
      leafGroup.rotation.y = lp.angle + (rnd() - 0.5) * 0.15;
      leafGroup.rotation.z = -lp.pitch;

      const petioleLen = 0.11 * lp.scale;
      // Petiole cylinder anchored 0.015 inside the stem wood for a solid unbroken connection
      // thick enough to see: at 5-9 mm the stalk vanished and the blade floated
      const petioleGeo = new THREE.CylinderGeometry(0.009 * lp.scale, 0.015 * lp.scale, petioleLen + 0.02, 6);
      petioleGeo.translate(0, petioleLen * 0.5 - 0.01, 0);
      geometriesToDispose.push(petioleGeo);

      const petiole = new THREE.Mesh(petioleGeo, stemMaterial);
      petiole.castShadow = true;
      leafGroup.add(petiole);

      // Leaf blade attached directly at the petiole tip with slight overlap so petiole enters leaf midrib
      const bladeGroup = new THREE.Group();
      bladeGroup.position.set(0, petioleLen * 0.88, 0);
      bladeGroup.rotation.x = 0.22; // gentle natural arch along growth axis

      const leaf = new THREE.Mesh(leafGeo, leafMaterial);
      leaf.scale.set(lp.scale, lp.scale, lp.scale);
      leaf.rotation.z = (idx % 2 === 0 ? 0.15 : -0.15); // subtle natural roll
      leaf.castShadow = true;
      bladeGroup.add(leaf);
      leafGroup.add(bladeGroup);

      group.add(leafGroup);
      leafMeshes.push({
        mesh: leafGroup,
        baseRotation: leafGroup.rotation.clone(),
        phase: idx * 1.4,
        amp: 0.07,
      });
    });

    // Apical cluster of 4 fresh leaves crowning the shoot (rooted seamlessly in the apical bud)
    for (let a = 0; a < 4; a++) {
      const aAngle = (a / 4) * Math.PI * 2 + 0.3;
      const apexLeafGroup = new THREE.Group();
      apexLeafGroup.position.copy(apexPt);
      apexLeafGroup.rotation.y = aAngle;
      apexLeafGroup.rotation.z = -0.50; // arching gently outwards

      // Short apical petiole anchored in the terminal bud
      const apexPetioleGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.06, 6);
      apexPetioleGeo.translate(0, 0.025, 0);
      geometriesToDispose.push(apexPetioleGeo);
      const apexPetiole = new THREE.Mesh(apexPetioleGeo, stemMaterial);
      apexLeafGroup.add(apexPetiole);

      // Leaf blade emerging directly from petiole tip
      const apexBladeGroup = new THREE.Group();
      apexBladeGroup.position.set(0, 0.05, 0);
      apexBladeGroup.rotation.x = 0.18;

      const leaf = new THREE.Mesh(leafGeo, leafMaterial);
      leaf.scale.set(0.85, 0.85, 0.85);
      leaf.castShadow = true;
      apexBladeGroup.add(leaf);
      apexLeafGroup.add(apexBladeGroup);

      group.add(apexLeafGroup);
      leafMeshes.push({
        mesh: apexLeafGroup,
        baseRotation: apexLeafGroup.rotation.clone(),
        phase: a * 1.5 + 2.0,
        amp: 0.08,
      });
    }

    // (No apple: a sapling does not bear fruit, so the apple option inherited
    // from the adult oak preset does not apply here.)
  }

  // -------------------------------------------------------------
  // 4. ANIMATION & WIND UPDATE LOOP
  // -------------------------------------------------------------
  const update = (time: number) => {
    sharedUniforms.uTime.value = time;

    // Gentle swaying of sapling leaves and fronds
    const windSpeed = config.windSpeed || 1.0;
    const windStr = config.windStrength || 0.35;

    for (let i = 0; i < leafMeshes.length; i++) {
      const item = leafMeshes[i];
      const sway = Math.sin(time * windSpeed * 2.5 + item.phase) * item.amp * windStr * 1.5;
      item.mesh.rotation.z = item.baseRotation.z + sway;
    }
  };

  return {
    group,
    materialsToDispose,
    geometriesToDispose,
    update,
  };
}
