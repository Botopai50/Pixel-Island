// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig, CrownShape } from '../types';
import { SCANode } from './spaceColonization';
import {
  getPixelFoliageTextures,
  getPixelLeafColorAtlas,
  pixelTextureLightDir,
  resolvePixelTextureParams,
  PIXEL_LEAF_VERTEX_SHADER,
  PIXEL_LEAF_FRAGMENT_SHADER,
} from './pixelArtTextureSystem';

// ============================================================================
// 1. DETERMINISTIC SEEDED 3D NOISE (Zero external dependencies)
// ============================================================================

export class SeededNoise3D {
  private perm: Uint8Array = new Uint8Array(512);

  constructor(seed: number) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;

    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  public noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(u, this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z)),
        this.lerp(u, this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z))
      ),
      this.lerp(
        v,
        this.lerp(u, this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1))
      )
    );
  }

  public fbm(x: number, y: number, z: number, octaves = 2): number {
    let total = 0;
    let freq = 1.0;
    let amp = 1.0;
    let maxAmp = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * freq, y * freq, z * freq) * amp;
      maxAmp += amp;
      freq *= 2.0;
      amp *= 0.5;
    }
    return (total / maxAmp) * 0.5 + 0.5;
  }
}

// ============================================================================
// 2. PROCEDURAL LEAF TEXTURE ATLAS (Authentic BotW / Anime Style)
// ============================================================================

let cachedAtlasTexture: THREE.CanvasTexture | null = null;
let cachedAtlasKey = '';

/**
 * Creates an in-memory 8-tile Canvas Texture Atlas (4 columns x 2 rows, 1024x512).
 * Strictly species-tailored: Hyrule Oak trees will NEVER get pine needles or palm fronds!
 * Each tile features hand-painted anime foliage silhouettes with organic dappled light slits.
 */
export function generateLeafAtlasTexture(
  species: string,
  seed: number,
  config?: TreeConfig
): THREE.CanvasTexture {
  // When the procedural pixel art system is on, serve the same 4x2 atlas layout
  // but painted by the pixel generator, so every shader that samples an albedo
  // atlas (conifer needles, sapling blades) stays in the same art direction
  // without needing its own material rewritten.
  if (config && config.pixelTextureEnabled !== false) {
    return getPixelLeafColorAtlas(config);
  }
  return generateLegacyLeafAtlasTexture(species, seed);
}

/** The original hand-painted gradient atlas, kept as the fallback for
 *  `pixelTextureEnabled: false`. */
export function generateLegacyLeafAtlasTexture(species: string, seed: number): THREE.CanvasTexture {
  const cacheKey = `${species}_${seed}`;
  if (cachedAtlasTexture && cachedAtlasKey === cacheKey) {
    return cachedAtlasTexture;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Initialize canvas with pure white and alpha 0:
  // This guarantees that bilinear filtering and mipmapping NEVER bleed black borders or dark fringes!
  ctx.fillStyle = 'rgba(255, 255, 255, 0)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tileW = 256;
  const tileH = 256;

  // Draw 8 stylized leaf variations tailored for the specific tree species
  for (let tileIdx = 0; tileIdx < 8; tileIdx++) {
    const col = tileIdx % 4;
    const row = Math.floor(tileIdx / 4);
    const ox = col * tileW;
    const oy = row * tileH;

    ctx.save();
    // Anchor near bottom center of the tile: base of branch/stem at (128, 242)
    const cx = ox + tileW * 0.5;
    const cy = oy + tileH * 0.94;

    drawSpeciesLeafTile(ctx, species, tileIdx, cx, cy);

    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;

  cachedAtlasTexture = texture;
  cachedAtlasKey = cacheKey;

  return texture;
}

function drawSpeciesLeafTile(
  ctx: CanvasRenderingContext2D,
  species: string,
  tileIdx: number,
  cx: number,
  cy: number
) {
  ctx.save();
  ctx.translate(cx, cy);

  // If tileIdx >= 4, apply subtle horizontal flip / organic scale to enrich silhouette diversity
  if (tileIdx >= 4) {
    ctx.scale(-0.96, 1.02);
  }

  const variant = tileIdx % 4;

  if (species === 'satori_sakura') {
    drawBotWSakuraClump(ctx, variant);
  } else if (species.startsWith('hebra_pine')) {
    drawBotWPineBranch(ctx, variant);
  } else if (species === 'akkala_birch') {
    drawBotWBirchClump(ctx, variant);
  } else if (species === 'faron_palm') {
    drawBotWPalmFrond(ctx, variant);
  } else if (species === 'swamp_mangrove') {
    drawBotWMangroveRosette(ctx, variant);
  } else if (species === 'korok_ancient' || species === 'hyrule_oak') {
    // Both Korok Ancient and Hyrule Oak share the exact same authentic Korok leaf silhouette
    drawBotWAncientClump(ctx, variant);
  } else {
    // Default to the Korok ancient leaf cluster
    drawBotWAncientClump(ctx, variant);
  }

  ctx.restore();
}

/**
 * Draws a billowing organic anime foliage lobe with scalloped leaf margins and painterly gradient.
 * This forms the characteristic puffy, cloud-like leaf clusters of Breath of the Wild.
 */
function drawBillowingAnimeLobe(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  scallops: number = 7,
  rot: number = 0,
  palette?: { highlight: string; mid: string; shadow: string }
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // Painterly anime radial gradient: bright sunlit tip to deep soft ambient occlusion
  const p = palette ?? {
    highlight: '#e8ffbe',
    mid: '#72c836',
    shadow: '#20561a',
  };

  const grad = ctx.createRadialGradient(0, -ry * 0.35, Math.min(rx, ry) * 0.1, 0, 0, Math.max(rx, ry) * 1.15);
  grad.addColorStop(0.0, p.highlight);
  grad.addColorStop(0.55, p.mid);
  grad.addColorStop(1.0, p.shadow);

  ctx.fillStyle = grad;

  ctx.beginPath();
  for (let i = 0; i < scallops; i++) {
    const a1 = (i / scallops) * Math.PI * 2;
    const a2 = ((i + 1) / scallops) * Math.PI * 2;
    const midA = (a1 + a2) * 0.5;

    const x1 = Math.cos(a1) * rx;
    const y1 = Math.sin(a1) * ry;
    const x2 = Math.cos(a2) * rx;
    const y2 = Math.sin(a2) * ry;

    // Organic scalloped outward bump
    const bumpR = Math.min(rx, ry) * 0.28;
    const cpx = Math.cos(midA) * (rx + bumpR);
    const cpy = Math.sin(midA) * (ry + bumpR);

    if (i === 0) {
      ctx.moveTo(x1, y1);
    }
    ctx.quadraticCurveTo(cpx, cpy, x2, y2);
  }
  ctx.closePath();
  ctx.fill();

  // Subtle leaf lobe edge highlight rim for anime illustration feel
  ctx.strokeStyle = 'rgba(255, 255, 230, 0.35)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.restore();
}

/**
 * Authentic Zelda BotW Deciduous Foliage Clump
 * Billowing cloud-scalloped anime foliage with lush, dense overlapping leaf lobes.
 */
function drawBotWOakClump(ctx: CanvasRenderingContext2D, variant: number) {
  const pal = {
    highlight: '#edffc2',
    mid: '#70c934',
    shadow: '#225a1b',
  };

  switch (variant) {
    case 0: {
      // Main Crown Puff (Lush central cloud with spreading wings)
      drawBillowingAnimeLobe(ctx, 0, -115, 68, 60, 8, 0, pal);
      drawBillowingAnimeLobe(ctx, -52, -92, 54, 48, 7, -0.32, pal);
      drawBillowingAnimeLobe(ctx, 52, -92, 54, 48, 7, 0.32, pal);
      drawBillowingAnimeLobe(ctx, -34, -168, 48, 44, 7, -0.18, pal);
      drawBillowingAnimeLobe(ctx, 34, -168, 48, 44, 7, 0.18, pal);
      drawBillowingAnimeLobe(ctx, 0, -200, 42, 40, 6, 0, pal);

      // Organic leaf scallops along perimeter
      drawAnimeLeaflet(ctx, -72, -64, 44, 60, -0.92, pal);
      drawAnimeLeaflet(ctx, 72, -64, 44, 60, 0.92, pal);
      break;
    }
    case 1: {
      // Broad Spreading Canopy Wing
      drawBillowingAnimeLobe(ctx, 0, -110, 64, 56, 8, 0, pal);
      drawBillowingAnimeLobe(ctx, -62, -86, 58, 48, 7, -0.42, pal);
      drawBillowingAnimeLobe(ctx, 62, -86, 58, 48, 7, 0.42, pal);
      drawBillowingAnimeLobe(ctx, -82, -54, 46, 42, 6, -0.88, pal);
      drawBillowingAnimeLobe(ctx, 82, -54, 46, 42, 6, 0.88, pal);
      drawBillowingAnimeLobe(ctx, -42, -158, 46, 40, 7, -0.22, pal);
      drawBillowingAnimeLobe(ctx, 42, -158, 46, 40, 7, 0.22, pal);
      drawBillowingAnimeLobe(ctx, 0, -190, 40, 36, 6, 0, pal);
      break;
    }
    case 2: {
      // Terminal Tip Spray (Tapered upward billowing bouquet)
      drawBillowingAnimeLobe(ctx, 0, -108, 58, 54, 8, 0, pal);
      drawBillowingAnimeLobe(ctx, -44, -82, 50, 44, 7, -0.32, pal);
      drawBillowingAnimeLobe(ctx, 44, -82, 50, 44, 7, 0.32, pal);
      drawBillowingAnimeLobe(ctx, -30, -154, 44, 40, 6, -0.18, pal);
      drawBillowingAnimeLobe(ctx, 30, -154, 44, 40, 6, 0.18, pal);
      drawBillowingAnimeLobe(ctx, 0, -195, 42, 40, 6, 0, pal);

      drawAnimeLeaflet(ctx, -56, -54, 38, 56, -0.82, pal);
      drawAnimeLeaflet(ctx, 56, -54, 38, 56, 0.82, pal);
      break;
    }
    case 3:
    default: {
      // Soft Volumetric Canopy Body (Plump rounded cloud mass)
      drawBillowingAnimeLobe(ctx, 0, -108, 72, 62, 8, 0, pal);
      drawBillowingAnimeLobe(ctx, -54, -80, 60, 50, 7, -0.38, pal);
      drawBillowingAnimeLobe(ctx, 54, -80, 60, 50, 7, 0.38, pal);
      drawBillowingAnimeLobe(ctx, -68, -46, 48, 42, 6, -0.82, pal);
      drawBillowingAnimeLobe(ctx, 68, -46, 48, 42, 6, 0.82, pal);
      drawBillowingAnimeLobe(ctx, -36, -160, 48, 44, 7, -0.2, pal);
      drawBillowingAnimeLobe(ctx, 36, -160, 48, 44, 7, 0.2, pal);
      drawBillowingAnimeLobe(ctx, 0, -194, 44, 40, 6, 0, pal);
      break;
    }
  }

  // Delicate interior leaf veins for hand-painted craftsmanship
  ctx.strokeStyle = 'rgba(215, 255, 180, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -50);
  ctx.lineTo(0, -130);
  ctx.moveTo(0, -80);
  ctx.lineTo(-24, -100);
  ctx.moveTo(0, -95);
  ctx.lineTo(24, -115);
  ctx.stroke();
}

/**
 * Draws a single stylized anime leaflet with scalloped organic curvature.
 */
function drawAnimeLeaflet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
  palette?: { highlight: string; mid: string; shadow: string }
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  const p = palette ?? {
    highlight: '#edffc2',
    mid: '#70c934',
    shadow: '#225a1b',
  };

  const hw = w * 0.5;
  const hh = h * 0.5;

  const grad = ctx.createRadialGradient(0, -hh * 0.3, hw * 0.1, 0, 0, Math.max(hw, hh) * 1.1);
  grad.addColorStop(0.0, p.highlight);
  grad.addColorStop(0.55, p.mid);
  grad.addColorStop(1.0, p.shadow);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, hh);
  ctx.bezierCurveTo(-hw * 1.15, hh * 0.3, -hw * 1.1, -hh * 0.35, 0, -hh);
  ctx.bezierCurveTo(hw * 1.1, -hh * 0.35, hw * 1.15, hh * 0.3, 0, hh);
  ctx.closePath();
  ctx.fill();

  // Subtle central vein for painterly depth
  ctx.strokeStyle = 'rgba(255, 255, 220, 0.45)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, hh * 0.85);
  ctx.lineTo(0, -hh * 0.7);
  ctx.stroke();

  ctx.restore();
}

/**
 * Authentic BotW Satori Sakura Cherry Blossom Clump
 */
function drawBotWSakuraClump(ctx: CanvasRenderingContext2D, variant: number) {
  const palLeaf = {
    highlight: '#ffffff',
    mid: '#f7bed8',
    shadow: '#ba487e',
  };

  // Blossom bouquets radiating outward with glowing anime petals
  const blossomCount = 6 + variant;
  for (let i = 0; i < blossomCount; i++) {
    const angle = ((i - (blossomCount - 1) * 0.5) / blossomCount) * 1.6 - Math.PI * 0.5;
    const dist = 60 + (i % 3) * 35;
    const bx = Math.cos(angle) * dist;
    const by = Math.sin(angle) * dist - 25;
    const sz = 26 + (i % 2) * 8;

    drawSakuraBlossom(ctx, bx, by, sz);
  }

  // Supporting young tender sakura leaves with soft pink-green tones
  drawAnimeLeaflet(ctx, -48, -72, 38, 64, -0.58, palLeaf);
  drawAnimeLeaflet(ctx, 48, -72, 38, 64, 0.58, palLeaf);
  drawAnimeLeaflet(ctx, 0, -190, 34, 56, 0, palLeaf);
}

function drawSakuraBlossom(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);

  for (let p = 0; p < 5; p++) {
    const a = (p * Math.PI * 2) / 5;
    ctx.save();
    ctx.rotate(a);

    const grad = ctx.createRadialGradient(0, -r * 0.4, r * 0.1, 0, -r * 0.5, r * 0.7);
    grad.addColorStop(0.0, '#ffffff');
    grad.addColorStop(0.45, '#ffd8ea');
    grad.addColorStop(1.0, '#e55f9e');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-r * 0.5, -r * 0.4, -r * 0.4, -r * 0.9, -r * 0.15, -r);
    ctx.lineTo(0, -r * 0.82); // Notched petal tip
    ctx.lineTo(r * 0.15, -r);
    ctx.bezierCurveTo(r * 0.4, -r * 0.9, r * 0.5, -r * 0.4, 0, 0);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();
  }

  // Sacred glowing blossom center
  ctx.fillStyle = '#ff3f85';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Flat, single-color serrated leaf based on the simplified BotW foliage language.
 * The shader supplies the final green and cel lighting; the atlas is only a mask.
 */
function drawFlatSerratedPineLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  width: number,
  rotation: number
) {
  const lobes = 5;
  const shapeWidth = width * 0.65;
  const shapeLength = length * 0.5625;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(-shapeWidth * 0.06, 0);

  for (let lobe = 0; lobe < lobes; lobe++) {
    const startT = 0.04 + lobe * 0.15;
    const peakT = startT + 0.075;
    const endT = startT + 0.14;
    const envelope = 0.72 + Math.sin(peakT * Math.PI) * 0.28;
    const outerX = -shapeWidth * 0.5 * envelope;
    const valleyX = -shapeWidth * 0.15 * Math.sin(endT * Math.PI);
    ctx.quadraticCurveTo(
      -shapeWidth * 0.28,
      -shapeLength * (startT + 0.025),
      outerX,
      -shapeLength * peakT
    );
    ctx.quadraticCurveTo(
      outerX * 0.94,
      -shapeLength * (peakT + 0.05),
      valleyX,
      -shapeLength * endT
    );
  }

  ctx.quadraticCurveTo(-shapeWidth * 0.2, -shapeLength * 0.91, 0, -shapeLength);
  ctx.quadraticCurveTo(
    shapeWidth * 0.2,
    -shapeLength * 0.91,
    shapeWidth * 0.15 * Math.sin(0.78 * Math.PI),
    -shapeLength * 0.78
  );

  for (let lobe = lobes - 1; lobe >= 0; lobe--) {
    const startT = 0.04 + lobe * 0.15;
    const peakT = startT + 0.075;
    const envelope = 0.72 + Math.sin(peakT * Math.PI) * 0.28;
    const outerX = shapeWidth * 0.5 * envelope;
    const valleyX = shapeWidth * 0.15 * Math.sin(startT * Math.PI);
    ctx.quadraticCurveTo(
      outerX * 0.94,
      -shapeLength * (peakT + 0.05),
      outerX,
      -shapeLength * peakT
    );
    ctx.quadraticCurveTo(
      shapeWidth * 0.28,
      -shapeLength * (startT + 0.025),
      valleyX,
      -shapeLength * startT
    );
  }

  ctx.lineTo(shapeWidth * 0.06, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Dense triangular spray assembled from many simple, overlapping leaves.
 * Small deterministic layout changes create atlas variety without adding color detail.
 */
function drawBotWPineBranch(ctx: CanvasRenderingContext2D, variant: number) {
  ctx.fillStyle = '#ffffff';
  const variantLean = (variant - 1.5) * 0.025;

  for (let row = 0; row < 6; row++) {
    const heightT = row / 5;
    const rowY = -24 - row * 29;
    const rowWidth = 84 - heightT * 46;
    const leafLength = 66 - heightT * 12;
    const leafWidth = 27 - heightT * 5;
    const stagger = variant === 2 ? Math.sin(row * 1.7) * 4 : 0;

    for (const side of [-1, 1]) {
      drawFlatSerratedPineLeaf(
        ctx,
        stagger + side * 7,
        rowY,
        leafLength,
        leafWidth,
        variantLean + side * (0.72 - heightT * 0.2)
      );
      drawFlatSerratedPineLeaf(
        ctx,
        stagger + side * rowWidth * 0.42,
        rowY + 5,
        leafLength * 0.9,
        leafWidth * 0.92,
        variantLean + side * (0.98 - heightT * 0.26)
      );
    }
  }

  drawFlatSerratedPineLeaf(ctx, 0, -164, 74, 29, variantLean);
  drawFlatSerratedPineLeaf(ctx, -9, -169, 60, 24, variantLean - 0.42);
  drawFlatSerratedPineLeaf(ctx, 9, -169, 60, 24, variantLean + 0.42);
}

/**
 * Akkala Birch pointed leaf spray with golden autumn palette
 */
function drawBotWBirchClump(ctx: CanvasRenderingContext2D, _variant: number) {
  const palBirch = {
    highlight: '#fff8a8',
    mid: '#f7b42c',
    shadow: '#944208',
  };

  drawAnimeLeaflet(ctx, 0, -130, 52, 90, 0, palBirch);
  drawAnimeLeaflet(ctx, -52, -95, 46, 80, -0.52, palBirch);
  drawAnimeLeaflet(ctx, 52, -95, 46, 80, 0.52, palBirch);
  drawAnimeLeaflet(ctx, -74, -50, 40, 68, -1.02, palBirch);
  drawAnimeLeaflet(ctx, 74, -50, 40, 68, 1.02, palBirch);
  drawAnimeLeaflet(ctx, -34, -182, 38, 64, -0.2, palBirch);
  drawAnimeLeaflet(ctx, 34, -182, 38, 64, 0.2, palBirch);
  drawAnimeLeaflet(ctx, 0, -220, 34, 58, 0, palBirch);
}

/**
 * Faron Palm tropical frond
 */
function drawBotWPalmFrond(ctx: CanvasRenderingContext2D, _variant: number) {
  const frondCount = 9;
  for (let i = 0; i < frondCount; i++) {
    const t = i / (frondCount - 1);
    const angle = -Math.PI * 0.8 + t * Math.PI * 1.6;
    ctx.save();
    ctx.rotate(angle);

    const grad = ctx.createLinearGradient(0, 0, 0, -170);
    grad.addColorStop(0.0, '#1c5c24');
    grad.addColorStop(0.6, '#56b834');
    grad.addColorStop(1.0, '#ccff80');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-12, -90);
    ctx.lineTo(0, -170);
    ctx.lineTo(12, -90);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Korok Ancient Woodland Clump with sacred emerald gradient
 */
function drawBotWAncientClump(ctx: CanvasRenderingContext2D, _variant: number) {
  const palAncient = {
    highlight: '#d2ffd0',
    mid: '#4bb852',
    shadow: '#154a20',
  };

  drawAnimeLeaflet(ctx, 0, -125, 60, 88, 0, palAncient);
  drawAnimeLeaflet(ctx, -50, -90, 54, 78, -0.48, palAncient);
  drawAnimeLeaflet(ctx, 50, -90, 54, 78, 0.48, palAncient);
  drawAnimeLeaflet(ctx, -72, -48, 44, 66, -0.98, palAncient);
  drawAnimeLeaflet(ctx, 72, -48, 44, 66, 0.98, palAncient);
  drawAnimeLeaflet(ctx, -32, -178, 44, 66, -0.18, palAncient);
  drawAnimeLeaflet(ctx, 32, -178, 44, 66, 0.18, palAncient);
  drawAnimeLeaflet(ctx, 0, -214, 38, 60, 0, palAncient);
}

// ============================================================================
// 3. 3D CROWN DENSITY FIELD
// ============================================================================

export interface CrownBounds {
  bottomY: number;
  topY: number;
  centerY: number;
  radiusX: number;
  radiusZ: number;
  radiusY: number;
  shape: CrownShape;
}

export interface BranchSkeletonData {
  start: THREE.Vector3;
  end: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  radius: number;
  depth: number;
  isTerminal: boolean;
  branchId: number;
}

export class CrownDensityField {
  private noise: SeededNoise3D;
  private config: TreeConfig;
  private bounds: CrownBounds;
  private branches: BranchSkeletonData[];

  constructor(
    config: TreeConfig,
    bounds: CrownBounds,
    branches: BranchSkeletonData[]
  ) {
    this.config = config;
    this.bounds = bounds;
    this.branches = branches;
    this.noise = new SeededNoise3D(config.seed + 1337);
  }

  public evaluate(pos: THREE.Vector3): number {
    const { bottomY, topY, centerY, radiusX, radiusZ, radiusY } = this.bounds;

    if (pos.y < bottomY - 0.5 || pos.y > topY + 1.0) return 0;

    const dx = pos.x / Math.max(0.2, radiusX);
    const dz = pos.z / Math.max(0.2, radiusZ);
    const dy = (pos.y - centerY) / Math.max(0.2, radiusY);
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > 1.45) return 0;

    // Organic 3D Noise variation for BotW clumps
    const nScale = this.config.noiseScale ?? 0.35;
    const nVal = this.noise.fbm(pos.x * nScale, pos.y * nScale, pos.z * nScale, 2);
    const nStrength = this.config.noiseStrength ?? 0.55;
    const noiseFactor = THREE.MathUtils.lerp(1.0, nVal * 1.2, nStrength);

    const shapeFactor = Math.max(0.1, 1.0 - distSq * 0.7);
    return Math.max(0.1, Math.min(1.0, shapeFactor * noiseFactor));
  }
}

// ============================================================================
// 4. SPATIAL HASH / 3D GRID INDEX
// ============================================================================

export class SpatialPatchIndex {
  private cellSize: number;
  private grid: Map<string, THREE.Vector3[]> = new Map();

  constructor(cellSize: number) {
    this.cellSize = Math.max(0.15, cellSize);
  }

  private key(x: number, y: number, z: number): string {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    const gz = Math.floor(z / this.cellSize);
    return `${gx}_${gy}_${gz}`;
  }

  public canAdd(pos: THREE.Vector3, minDistance: number): boolean {
    const gx = Math.floor(pos.x / this.cellSize);
    const gy = Math.floor(pos.y / this.cellSize);
    const gz = Math.floor(pos.z / this.cellSize);
    const minDistSq = minDistance * minDistance;

    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        for (let iz = -1; iz <= 1; iz++) {
          const k = `${gx + ix}_${gy + iy}_${gz + iz}`;
          const list = this.grid.get(k);
          if (list) {
            for (let i = 0; i < list.length; i++) {
              if (pos.distanceToSquared(list[i]) < minDistSq) {
                return false;
              }
            }
          }
        }
      }
    }
    return true;
  }

  public add(pos: THREE.Vector3) {
    const k = this.key(pos.x, pos.y, pos.z);
    if (!this.grid.has(k)) {
      this.grid.set(k, []);
    }
    this.grid.get(k)!.push(pos.clone());
  }
}

/**
 * Draws a single elongated, lanceolate leaflet characteristic of Schefflera / Mangrove / Money Tree.
 * Tapered at petiole base, widest at center, sharp pointed tip with crisp central midrib.
 */
function drawSingleMangroveLeaflet(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  length: number,
  maxWidth: number,
  angleRad: number,
  curvature: number = 0,
  palette?: { highlight: string; mid: string; shadow: string; vein: string }
) {
  ctx.save();
  ctx.translate(originX, originY);
  ctx.rotate(angleRad);

  const p = palette ?? {
    highlight: '#c8f94d',
    mid: '#74c926',
    shadow: '#1e4d12',
    vein: 'rgba(235, 255, 165, 0.85)',
  };

  const tipX = curvature * length * 0.22;
  const tipY = -length;
  const midY = -length * 0.52;
  const halfW = maxWidth * 0.5;

  // Rich gradient: deep ambient shadow at stem to luminous chartreuse tip
  const grad = ctx.createLinearGradient(0, 0, tipX, tipY);
  grad.addColorStop(0.0, p.shadow);
  grad.addColorStop(0.24, p.shadow);
  grad.addColorStop(0.68, p.mid);
  grad.addColorStop(1.0, p.highlight);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  // Left lanceolate margin
  ctx.bezierCurveTo(
    -halfW * 0.85, -length * 0.22,
    -halfW * 1.15 + curvature * 14, midY,
    tipX, tipY
  );
  // Right lanceolate margin
  ctx.bezierCurveTo(
    halfW * 1.15 + curvature * 14, midY,
    halfW * 0.85, -length * 0.22,
    0, 0
  );
  ctx.closePath();
  ctx.fill();

  // Subtle sunlit rim highlight on leaf edges
  ctx.strokeStyle = 'rgba(220, 255, 150, 0.40)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Prominent pale midrib vein running from stem to tip (vital for Schefflera look!)
  ctx.strokeStyle = p.vein;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -length * 0.08);
  ctx.quadraticCurveTo(curvature * 10, midY, tipX, tipY * 0.94);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws an authentic Schefflera / Mangrove umbrella rosette of 6-8 radiating lanceolate leaves.
 * Perfectly matches the reference image with starburst clusters and drooping sprays!
 */
function drawBotWMangroveRosette(ctx: CanvasRenderingContext2D, variant: number) {
  const pal = {
    highlight: '#d2fa5a',
    mid: '#78cc28',
    shadow: '#1b4a10',
    vein: 'rgba(240, 255, 175, 0.85)',
  };

  const hubX = 0;
  const hubY = -92;

  // Small woody petiole stem connecting rosette cluster to branch
  ctx.strokeStyle = '#4e3d22';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(0, -45, hubX, hubY);
  ctx.stroke();

  switch (variant) {
    case 0: {
      // Classic Starburst Umbrella Rosette (7 lanceolate leaflets radiating in a full fan/star)
      const angles = [
        -2.50, // -143 deg (drooping bottom-left)
        -1.92, // -110 deg (left)
        -1.32, // -75 deg (top-left)
        -0.78, // -45 deg (top-center)
        -0.24, // -14 deg (top-right)
        0.34,  // +19 deg (right)
        0.92,  // +53 deg (drooping bottom-right)
      ];
      angles.forEach((ang, i) => {
        const len = 92 + (i % 2 === 0 ? 14 : 0);
        const w = 33 + (i === 3 ? 4 : 0);
        drawSingleMangroveLeaflet(ctx, hubX, hubY, len, w, ang, (i - 3) * 0.05, pal);
      });
      break;
    }
    case 1: {
      // Gracefully Drooping Umbrella Spray (leaves arching downwards like heavy wet canopy)
      const angles = [
        -2.70, // down-left
        -2.10,
        -1.55,
        -1.00,
        -0.45,
        0.10,
        0.68,
        1.25,  // down-right
      ];
      angles.forEach((ang, i) => {
        const len = 88 + (i % 3) * 8;
        const w = 31;
        const curve = i < 4 ? -0.12 : 0.12;
        drawSingleMangroveLeaflet(ctx, hubX, hubY, len, w, ang, curve, pal);
      });
      break;
    }
    case 2: {
      // Tiered Double Rosette (mature umbrella below + young 3-leaflet spray at apex)
      // Mature lower rosette (5 spreading leaves)
      [-2.35, -1.65, -0.95, -0.25, 0.45].forEach((ang) => {
        drawSingleMangroveLeaflet(ctx, hubX, hubY, 96, 35, ang, 0, pal);
      });
      // Young fresh chartreuse apex leaflets (3 leaves)
      const palYoung = {
        highlight: '#eeff8a',
        mid: '#9fe838',
        shadow: '#2e6616',
        vein: '#ffffff',
      };
      [-1.25, -0.65, -0.05].forEach((ang) => {
        drawSingleMangroveLeaflet(ctx, hubX, hubY - 26, 68, 25, ang, 0, palYoung);
      });
      break;
    }
    case 3:
    default: {
      // Lateral Fan Rosette (asymmetrical arching clump along lateral bough)
      const angles = [
        -2.80,
        -2.20,
        -1.50,
        -0.80,
        -0.10,
        0.58,
      ];
      angles.forEach((ang, i) => {
        const len = 98 - i * 4;
        const w = 34;
        drawSingleMangroveLeaflet(ctx, hubX, hubY, len, w, ang, 0.08, pal);
      });
      break;
    }
  }

  // Central hub bud (botanical stipule node where petioles meet)
  ctx.fillStyle = '#3a5018';
  ctx.beginPath();
  ctx.arc(hubX, hubY, 5.5, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================================
// 5. FOLIAGE PATCHES & LEAF CLUSTERS DATA STRUCTURES
// ============================================================================

export interface FoliagePatch {
  id: number;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  radius: number;
  density: number;
  seed: number;
}

export interface LeafCardData {
  matrix: THREE.Matrix4;
  clumpCenter: THREE.Vector3;
  atlasIndex: number;
  shade: number;
  hueShift: number;
  windPhase: number;
  windStrength: number;
  /** 0 on the outer shell of the crown, 1 at its core. Drives the procedural
   *  texture's interior darkening. */
  crownDepth: number;
  /** How crowded this clump's neighbourhood is (0 isolated, 1 packed). Feeds
   *  the "proximity of other clusters" term of the texture shading. */
  neighborDensity: number;
}

export interface FoliageSystemResult {
  instancedMesh: THREE.InstancedMesh;
  foliageMaterial: THREE.ShaderMaterial;
  leafCardsCount: number;
  patchCount: number;
  update: (time: number) => void;
  dispose: () => void;
}

// ============================================================================
// 6. PROCEDURAL LEAF CARD GEOMETRY & GENERATOR
// ============================================================================

/**
 * Builds a 3x3 curved organic leaf card mesh anchored at the stem (y = 0.0).
 * Curving the card in an organic convex arc gives it true 3D volume,
 * catches smooth lighting gradients across its surface from every angle,
 * and completely prevents razor-thin disappearing cards!
 */
export function buildLeafCardQuadGeometry(width: number, height: number): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const halfW = width * 0.5;

  const positions = new Float32Array(9 * 3);
  const uvs = new Float32Array(9 * 2);
  const normals = new Float32Array(9 * 3);

  let vIdx = 0;
  for (let j = 0; j < 3; j++) {
    const vFrac = j / 2.0;
    const y = vFrac * height;
    for (let i = 0; i < 3; i++) {
      const uFrac = i / 2.0;
      const x = (uFrac - 0.5) * width;

      // Convex parabolic bow: curves outward at center, softly curling back at perimeter
      const bowX = Math.sin(uFrac * Math.PI) * 0.18 * width;
      const bowY = Math.sin(vFrac * Math.PI) * 0.12 * height;
      const z = bowX + bowY;

      positions[vIdx * 3] = x;
      positions[vIdx * 3 + 1] = y;
      positions[vIdx * 3 + 2] = z;

      uvs[vIdx * 2] = uFrac;
      uvs[vIdx * 2 + 1] = vFrac;

      normals[vIdx * 3] = (uFrac - 0.5) * 0.35;
      normals[vIdx * 3 + 1] = 0.25;
      normals[vIdx * 3 + 2] = 0.90;

      vIdx++;
    }
  }

  // 8 triangles forming 4 quads across the 3x3 grid
  const indices = new Uint16Array([
    0, 1, 4,  0, 4, 3,
    1, 2, 5,  1, 5, 4,
    3, 4, 7,  3, 7, 6,
    4, 5, 8,  4, 8, 7,
  ]);

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  return geom;
}

interface CanopyCloudClump {
  center: THREE.Vector3;
  radius: number;
  outward: THREE.Vector3;
  isTerminal: boolean;
}

export function buildProceduralFoliage(
  config: TreeConfig,
  allNodes: SCANode[],
  crownBounds: CrownBounds
): FoliageSystemResult {
  let seed = config.seed + 777;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // 1. Minimum height for foliage: strictly keep the main lower trunk clean of leaves
  const isConifer = config.species.startsWith('hebra_pine') || config.foliageType === 'pine_cone';
  const isSwamp = config.species === 'swamp_mangrove' || config.foliageType === 'swamp_weeping';
  const defaultStartRatio = isConifer ? 0.24 : (isSwamp ? 0.44 : 0.48);
  const branchStartRatio = Math.max(isConifer ? 0.18 : 0.40, config.branchStartHeight ?? defaultStartRatio);
  // A flat-topped (acacia) crown keeps its foliage in the top layer: tufts
  // along the limbs below it would fill in the open vase of bare limbs that
  // is half of the tree's silhouette.
  const isFlatTop = crownBounds.shape === 'flat_top';
  // A bush is leafy all the way down to the ground.
  const isShrub = config.growthStage === 'shrub';
  const minFoliageY = isShrub
    ? config.trunkHeight * 0.06
    : isFlatTop
    ? Math.max(config.trunkHeight * branchStartRatio, crownBounds.topY - crownBounds.radiusY * 1.95)
    : Math.max(crownBounds.bottomY * 0.92, config.trunkHeight * branchStartRatio);

  // 2. Extract valid crown branches and terminal nodes
  const branches: BranchSkeletonData[] = [];
  const terminalNodes: SCANode[] = [];
  const upperNodes: SCANode[] = [];

  allNodes.forEach((node) => {
    if (node.isTrunk || node.position.y < minFoliageY) {
      return;
    }

    if (node.children.length === 0 || node.isLeaf) {
      terminalNodes.push(node);
    } else if (node.depth >= 1) {
      upperNodes.push(node);
    }

    if (node.parent && !node.parent.isTrunk && node.parent.position.y >= minFoliageY * 0.85) {
      const dir = node.position.clone().sub(node.parent.position);
      const len = dir.length();
      if (len > 0.001) {
        dir.normalize();
        branches.push({
          start: node.parent.position,
          end: node.position,
          dir,
          length: len,
          radius: node.radius,
          depth: node.depth,
          isTerminal: node.children.length === 0,
          branchId: node.id,
        });
      }
    }
  });

  const crownCenter = new THREE.Vector3(0, crownBounds.centerY, 0);

  // --------------------------------------------------------------------------
  // BOTW MACRO CANOPY CLOUD CLUMPS ARCHITECTURE
  // In Breath of the Wild, trees are crowned by distinct, voluminous, billowing
  // cloud clumps (bouquets) placed at the branch tips and apex of the canopy,
  // forming an organic, lush, unbroken canopy mantle!
  // --------------------------------------------------------------------------
  const clumps: CanopyCloudClump[] = [];
  const clumpSpacing = isConifer
    ? Math.max(0.45, (config.patchSpacing ?? 0.8) * 0.65)
    : isSwamp
    ? Math.max(0.85, (config.patchSpacing ?? 1.0) * 1.05)
    : isShrub
    ? Math.max(0.28, (config.patchSpacing ?? 0.4) * 0.88)       // bush-sized tufts
    : Math.max(0.70, (config.patchSpacing ?? 0.8) * 0.88);
  const clumpIndex = new SpatialPatchIndex(clumpSpacing);

  const baseClusterRadius = (config.clusterRadius ?? 1.85) * (isSwamp ? 0.95 : 0.85);

  // Broadleaf tufts must hang on wood you can SEE. The colonisation graph ends
  // in fine twigs (~4.5 cm radius) that vanish on screen, so a tuft sitting on
  // a twig tip reads as floating in the air beside the crown. Every broadleaf
  // tuft is therefore kept within `tuftReach` of a bough at least
  // VISIBLE_WOOD_RADIUS thick - close enough that its own leaves cover the
  // join. Tufts further out are drawn in toward the nearest such bough; volume
  // infill is only accepted where it already is that close.
  const anchorTufts = !isConifer && !isSwamp;
  // (a bush's stems are all thin, so all of its wood counts)
  const VISIBLE_WOOD_RADIUS = isShrub ? 0.005 : 0.07;
  // (a bush's tufts hug its stems more closely: its whole crown is small)
  const tuftReach = baseClusterRadius * (isShrub ? 0.35 : 0.55);
  type WoodSegment = { a: THREE.Vector3; b: THREE.Vector3; node: SCANode };
  const woodSegments = (minRadius: number): WoodSegment[] =>
    allNodes
      .filter((n) => n.parent && Math.max(n.radius, n.parent.radius) >= minRadius)
      .map((n) => ({ a: n.parent!.position, b: n.position, node: n }));
  const visibleWood = anchorTufts ? woodSegments(VISIBLE_WOOD_RADIUS) : [];

  const nearestWood = new THREE.Vector3();
  // direction of that nearest piece of wood, from its base toward its tip,
  // and the graph node at its tip end
  const nearestWoodDir = new THREE.Vector3(0, 1, 0);
  let nearestWoodNode: SCANode | null = null;

  // Every tuft AND every leaf card is checked against the wood (thousands of
  // queries on a big crown), so the segments are bucketed in a coarse grid: a
  // query looks at its own neighbourhood first and only scans everything when
  // the nearest piece is further away than that. Returns the distance, and
  // sets nearestWood / nearestWoodDir / nearestWoodNode.
  const WOOD_CELL = 1.5;
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const segAB = new THREE.Vector3();
  const segAP = new THREE.Vector3();
  const segQ = new THREE.Vector3();
  const makeWoodIndex = (segments: WoodSegment[]) => {
    const grid = new Map<string, number[]>();
    segments.forEach((s, idx) => {
      const x0 = Math.floor(Math.min(s.a.x, s.b.x) / WOOD_CELL), x1 = Math.floor(Math.max(s.a.x, s.b.x) / WOOD_CELL);
      const y0 = Math.floor(Math.min(s.a.y, s.b.y) / WOOD_CELL), y1 = Math.floor(Math.max(s.a.y, s.b.y) / WOOD_CELL);
      const z0 = Math.floor(Math.min(s.a.z, s.b.z) / WOOD_CELL), z1 = Math.floor(Math.max(s.a.z, s.b.z) / WOOD_CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const k = cellKey(x, y, z);
        let bucket = grid.get(k);
        if (!bucket) grid.set(k, (bucket = []));
        bucket.push(idx);
      }
    });
    return (pos: THREE.Vector3): number => {
      let bestSq = Infinity;
      const test = (idx: number) => {
        const s = segments[idx];
        segAB.subVectors(s.b, s.a);
        const lenSq = segAB.lengthSq();
        const t = lenSq > 1e-9 ? THREE.MathUtils.clamp(segAP.subVectors(pos, s.a).dot(segAB) / lenSq, 0, 1) : 0;
        segQ.copy(s.a).addScaledVector(segAB, t);
        const dSq = segQ.distanceToSquared(pos);
        if (dSq < bestSq) {
          bestSq = dSq;
          nearestWood.copy(segQ);
          if (lenSq > 1e-9) nearestWoodDir.copy(segAB).normalize();
          nearestWoodNode = s.node;
        }
      };
      const cx = Math.floor(pos.x / WOOD_CELL), cy = Math.floor(pos.y / WOOD_CELL), cz = Math.floor(pos.z / WOOD_CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
        if (bucket) bucket.forEach(test);
      }
      // the neighbourhood only proves a result nearer than one cell
      if (bestSq > WOOD_CELL * WOOD_CELL) {
        for (let i = 0; i < segments.length; i++) test(i);
      }
      return Math.sqrt(bestSq);
    };
  };
  const nearestVisibleWood = makeWoodIndex(visibleWood);
  // The wood a leaf card is laid along (see the card loop): on a bush the
  // same stems the tufts hang on; on a tree ANY wood that is drawn, twigs
  // included - the tufts are hung on the thick boughs, but the leaves
  // themselves should follow the twigs that carry them.
  const followWood = !anchorTufts ? [] : isShrub ? visibleWood : woodSegments(0);
  const nearestFollowWood = isShrub ? nearestVisibleWood : makeWoodIndex(followWood);
  const anchorToVisibleWood = (
    pos: THREE.Vector3,
    relocate: boolean,
    reach: number = tuftReach
  ): THREE.Vector3 | null => {
    if (!anchorTufts || visibleWood.length === 0) return pos;
    const d = nearestVisibleWood(pos);
    if (d <= reach) return pos;
    if (!relocate) return null;
    // keep it on the same side of the bough, just close enough to it
    return nearestWood.clone().addScaledVector(pos.clone().sub(nearestWood), reach / d);
  };

  // (a) Branch Tip Clumps: Voluminous anime cloud bouquet at each bough terminus
  terminalNodes.forEach((tn) => {
    const tipPos = tn.position;
    const outward = tipPos.clone().sub(crownCenter).normalize();
    const branchDir = tn.dir.lengthSq() > 0.001 ? tn.dir.clone().normalize() : outward.clone();

    // Center of bouquet placed gracefully at branch terminus
    const tipCenter = tipPos.clone().add(branchDir.clone().multiplyScalar(isConifer ? 0.22 : (isSwamp ? 0.40 : (isShrub ? 0.12 : 0.35))));
    tipCenter.y += isShrub ? 0.03 : 0.08;
    const clumpCenter = anchorToVisibleWood(tipCenter, true);

    if (clumpCenter && clumpIndex.canAdd(clumpCenter, clumpSpacing)) {
      clumpIndex.add(clumpCenter);
      const radius = Math.max(isShrub ? 0.35 : 1.2, baseClusterRadius * (0.90 + (rnd() - 0.5) * 0.20));
      clumps.push({
        center: clumpCenter,
        radius,
        outward,
        isTerminal: true,
      });
    }
  });

  // (b) Crown Apex Bouquet: Grand central crowning cloud mass atop the tree (omit on swamp to preserve open bonsai boughs!)
  if (!isSwamp) {
    const apexY = crownBounds.topY - 0.35;
    const apexCenter = anchorToVisibleWood(new THREE.Vector3(0, apexY, 0), true);
    if (apexCenter && clumpIndex.canAdd(apexCenter, clumpSpacing * 0.75)) {
      clumpIndex.add(apexCenter);
      clumps.push({
        center: apexCenter,
        radius: baseClusterRadius * (isConifer ? 0.82 : 1.25),
        outward: new THREE.Vector3(0, 1, 0),
        isTerminal: false,
      });
    }
  }

  // (c) Mid-Canopy Infill Bouquets: Plump cloud masses along upper boughs
  const desiredClumpCount = Math.max(35, Math.min(80, (config.clusterCount ?? 16) * 2.5));
  for (let i = 0; i < upperNodes.length && clumps.length < desiredClumpCount; i++) {
    const node = upperNodes[i];
    if (node.position.y >= minFoliageY) {
      if (isConifer) {
        // Conifers only have foliage on the outer portion of branches,
        // leaving the core trunk and inner branch attachments cleanly visible
        const rXZ = Math.sqrt(node.position.x * node.position.x + node.position.z * node.position.z);
        const fracH = (node.position.y - crownBounds.bottomY) / Math.max(1, crownBounds.topY - crownBounds.bottomY);
        const tierExpectedR = crownBounds.radiusX * Math.pow(1.0 - 0.76 * fracH, 0.82);
        if (rXZ < tierExpectedR * 0.40) {
          continue;
        }
      }

      const outward = node.position.clone().sub(crownCenter).normalize();
      const rawPos = node.position.clone().add(outward.clone().multiplyScalar(isConifer ? 0.22 : 0.35));
      rawPos.y += 0.15;
      const candPos = anchorToVisibleWood(rawPos, true);

      if (candPos && clumpIndex.canAdd(candPos, clumpSpacing)) {
        clumpIndex.add(candPos);
        clumps.push({
          center: candPos,
          radius: baseClusterRadius * 0.98,
          outward,
          isTerminal: false,
        });
      }
    }
  }

  // (d) Crown Volume Fill: Only for broadleaf trees!
  // Conifers maintain foliage strictly anchored to real wooden branches
  if (!isConifer) {
    const densityField = new CrownDensityField(config, crownBounds, branches);
    // more attempts than before: infill is now only kept where a visible bough
    // is near, so a good share of random points are rejected
    for (let attempt = 0; attempt < 320 && clumps.length < desiredClumpCount; attempt++) {
      const angle = rnd() * Math.PI * 2;
      const rFrac = 0.20 + rnd() * 0.72;
      const hFrac = 0.25 + rnd() * 0.70;
      const x = Math.cos(angle) * crownBounds.radiusX * rFrac;
      const z = Math.sin(angle) * crownBounds.radiusZ * rFrac;
      const y = crownBounds.bottomY + (crownBounds.topY - crownBounds.bottomY) * hFrac;
      const pos = new THREE.Vector3(x, y, z);

      if (
        densityField.evaluate(pos) > 0.20 &&
        anchorToVisibleWood(pos, false) &&
        clumpIndex.canAdd(pos, clumpSpacing)
      ) {
        clumpIndex.add(pos);
        const outward = pos.clone().sub(crownCenter).normalize();
        clumps.push({
          center: pos,
          radius: baseClusterRadius * 1.02,
          outward,
          isTerminal: false,
        });
      }
    }
  }

  // 3. Build Volumetric 3x3 Curved Leaf Card Mesh Geometry
  const cardScale = config.leafCardSize ?? 1.0;
  const quadW = (isConifer ? 1.85 : 0.92) * cardScale;
  const quadH = (isConifer ? 2.10 : 1.22) * cardScale;
  const quadGeo = buildLeafCardQuadGeometry(quadW, quadH);

  // 4. Populate 3D Volumetric Anime Foliage Bouquets inside each Cloud Clump
  const leafCards: LeafCardData[] = [];
  const sizeVariance = config.leafCardSizeVariance ?? 0.18;

  // Neighbourhood occupancy per clump. Clump counts are small (tens), so the
  // direct pass is cheaper than building another index, and the result lets the
  // procedural texture darken leaves that sit inside a crowded mass.
  const neighborRadius = Math.max(1.0, clumpSpacing * 2.4);
  const neighborRadiusSq = neighborRadius * neighborRadius;
  const neighborDensities: number[] = clumps.map((a) => {
    let count = 0;
    for (let i = 0; i < clumps.length; i++) {
      if (clumps[i] === a) continue;
      if (a.center.distanceToSquared(clumps[i].center) < neighborRadiusSq) count++;
    }
    return Math.min(1.0, count / 7.0);
  });

  clumps.forEach((clump, clumpIdx) => {
    const distFromCenter = clump.center.distanceTo(crownCenter);
    const maxR = Math.max(1.0, crownBounds.radiusX, crownBounds.radiusY);
    const rimDist = Math.min(1.0, distFromCenter / maxR);
    const crownDepth = Math.max(0, Math.min(1, 1.0 - rimDist));
    const neighborDensity = neighborDensities[clumpIdx] ?? 0;
    const heightGrad = THREE.MathUtils.clamp(
      (clump.center.y - crownBounds.bottomY) / Math.max(1.0, crownBounds.topY - crownBounds.bottomY),
      0,
      1
    );

    // Harmonious interior shade gradient
    const clumpShade = THREE.MathUtils.clamp(
      rimDist * 0.45 + heightGrad * 0.50 + (rnd() - 0.5) * 0.05,
      0.25,
      0.98
    );

    // Subtle natural hue/saturation shift per cloud clump (-0.05 to +0.05)
    const hueShift = (rnd() - 0.5) * 0.08;
    const windPhase = rnd() * Math.PI * 2;
    const windStrength = 0.55 + rimDist * 0.45;

    interface CardPlan {
      pos: THREE.Vector3;
      growDir: THREE.Vector3;
      faceNormal: THREE.Vector3;
      scaleMultiplier: number;
    }

    const plans: CardPlan[] = [];

    if (isConifer) {
      const isApexClump = clump.center.y > crownBounds.topY - 1.6;

      if (isApexClump) {
        // Conifer Apex Needle Spire: Upright conical evergreen pinnacle
        const spireCount = 4;
        for (let sc = 0; sc < spireCount; sc++) {
          const yaw = (sc * Math.PI * 2) / spireCount + (rnd() - 0.5) * 0.25;
          const elevation = 0.95 + (rnd() - 0.5) * 0.15; // ~55° upward
          const cosEl = Math.cos(elevation);
          const dir = new THREE.Vector3(
            Math.cos(yaw) * cosEl,
            Math.sin(elevation),
            Math.sin(yaw) * cosEl
          ).normalize();

          const faceNormal = new THREE.Vector3(dir.x, 0.45, dir.z).normalize();
          plans.push({
            pos: clump.center.clone().add(dir.clone().multiplyScalar(0.24)),
            growDir: dir,
            faceNormal,
            scaleMultiplier: 0.96 + (rnd() - 0.5) * sizeVariance,
          });
        }
      } else {
        // Conifer Horizontal Bough Fans:
        // Authentic BotW layered pine branch shelves with slight gravitational droop!
        const boughDir = clump.outward.clone();
        boughDir.y = 0;
        if (boughDir.lengthSq() < 0.001) boughDir.set(1, 0, 0);
        boughDir.normalize();

        const boughRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), boughDir).normalize();

        // 1. Central fan card (outward with snow-shedding droop)
        const droopY = -0.22 - rnd() * 0.12;
        const mainGrow = boughDir.clone().setY(droopY).normalize();
        const mainNormal = new THREE.Vector3(boughDir.x * 0.25, 0.88, boughDir.z * 0.25).normalize();

        plans.push({
          pos: clump.center.clone().add(mainGrow.clone().multiplyScalar(clump.radius * 0.28)),
          growDir: mainGrow,
          faceNormal: mainNormal,
          scaleMultiplier: 1.08 + (rnd() - 0.5) * sizeVariance,
        });

        // 2 & 3. Left and Right wing bough fans (angled outwards at ±38°)
        [-1, 1].forEach((side) => {
          const wingDir = boughDir.clone().add(boughRight.clone().multiplyScalar(side * 0.72));
          wingDir.y = droopY * 0.9;
          wingDir.normalize();

          const wingNormal = new THREE.Vector3(wingDir.x * 0.2, 0.88, wingDir.z * 0.2).normalize();

          plans.push({
            pos: clump.center.clone().add(wingDir.clone().multiplyScalar(clump.radius * 0.36)),
            growDir: wingDir,
            faceNormal: wingNormal,
            scaleMultiplier: 1.02 + (rnd() - 0.5) * sizeVariance,
          });
        });

        // 4. Sunlit top overlay card
        const topGrow = boughDir.clone().setY(0.08).normalize();
        plans.push({
          pos: clump.center.clone().add(new THREE.Vector3(0, 0.14, 0)),
          growDir: topGrow,
          faceNormal: new THREE.Vector3(0, 0.96, 0),
          scaleMultiplier: 0.92 + (rnd() - 0.5) * sizeVariance,
        });

        // 5. Cross card for understory volume
        plans.push({
          pos: clump.center.clone(),
          growDir: boughRight.clone(),
          faceNormal: mainNormal,
          scaleMultiplier: 0.96,
        });
      }
    } else if (isSwamp) {
      // Mangrove Palmately Radiating Umbrella Rosette Placement
      // Matches reference image: distinct umbrella-like starburst clusters placed
      // gracefully along boughs and branch tips, showing the sculptural wood branches!
      const outwardDir = clump.outward.clone();
      outwardDir.y = 0;
      if (outwardDir.lengthSq() < 0.001) outwardDir.set(1, 0, 0);
      outwardDir.normalize();

      const boughRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outwardDir).normalize();

      // (1) Primary Umbrella Canopy Card: sits on top of bough, facing upward & outward
      const topGrow = outwardDir.clone().setY(0.12).normalize();
      const topNormal = new THREE.Vector3(outwardDir.x * 0.35, 0.90, outwardDir.z * 0.35).normalize();
      plans.push({
        pos: clump.center.clone().add(new THREE.Vector3(0, 0.12, 0)),
        growDir: topGrow,
        faceNormal: topNormal,
        scaleMultiplier: 1.32 * (1.0 + (rnd() - 0.5) * sizeVariance),
      });

      // (2) Side-Flaring Umbrella Cards (Left & Right fans rotated ~35 deg)
      const leftDir = outwardDir.clone().addScaledVector(boughRight, -0.65).setY(-0.08).normalize();
      const leftNormal = new THREE.Vector3(leftDir.x * 0.45, 0.72, leftDir.z * 0.45).normalize();
      plans.push({
        pos: clump.center.clone().addScaledVector(boughRight, -clump.radius * 0.28).add(new THREE.Vector3(0, 0.04, 0)),
        growDir: leftDir,
        faceNormal: leftNormal,
        scaleMultiplier: 1.25 * (1.0 + (rnd() - 0.5) * sizeVariance),
      });

      const rightDir = outwardDir.clone().addScaledVector(boughRight, 0.65).setY(-0.08).normalize();
      const rightNormal = new THREE.Vector3(rightDir.x * 0.45, 0.72, rightDir.z * 0.45).normalize();
      plans.push({
        pos: clump.center.clone().addScaledVector(boughRight, clump.radius * 0.28).add(new THREE.Vector3(0, 0.04, 0)),
        growDir: rightDir,
        faceNormal: rightNormal,
        scaleMultiplier: 1.25 * (1.0 + (rnd() - 0.5) * sizeVariance),
      });

      // (3) Drooping Under-Fan Card: hanging downwards gracefully below the branch
      // Exactly reproducing the drooping downward leaf clusters in the user's reference image!
      const droopDir = outwardDir.clone().setY(-0.48).normalize();
      const droopNormal = new THREE.Vector3(droopDir.x * 0.85, 0.25, droopDir.z * 0.85).normalize();
      plans.push({
        pos: clump.center.clone().add(new THREE.Vector3(0, -clump.radius * 0.24, 0)),
        growDir: droopDir,
        faceNormal: droopNormal,
        scaleMultiplier: 1.28 * (1.0 + (rnd() - 0.5) * sizeVariance),
      });

      // (4) If terminal tip: outward crowning rosette
      if (clump.isTerminal) {
        const termGrow = clump.outward.clone().setY(-0.15).normalize();
        const termNormal = new THREE.Vector3(termGrow.x, 0.45, termGrow.z).normalize();
        plans.push({
          pos: clump.center.clone().add(termGrow.clone().multiplyScalar(0.18)),
          growDir: termGrow,
          faceNormal: termNormal,
          scaleMultiplier: 1.30 * (1.0 + (rnd() - 0.5) * sizeVariance),
        });
      }
    } else if (isFlatTop) {
      // Acacia pads: the leaves lie in flat plates, not billowing clouds. A
      // star of near-horizontal cards (faces up, tipped a little outward)
      // makes one plate, a centre card closes its middle, and a second,
      // smaller layer just below gives the plate its shaded underside.
      const out = clump.outward.clone().setY(0);
      if (out.lengthSq() < 0.001) out.set(1, 0, 0);
      out.normalize();
      const padCount = 5;
      const turn = rnd() * Math.PI * 2;
      for (let p = 0; p < padCount; p++) {
        const az = turn + (p / padCount) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
        const dir = new THREE.Vector3(Math.cos(az), -0.04 + rnd() * 0.1, Math.sin(az)).normalize();
        plans.push({
          pos: clump.center.clone()
            .addScaledVector(dir, clump.radius * 0.08)
            .add(new THREE.Vector3(0, (rnd() - 0.5) * 0.14, 0)),
          growDir: dir,
          faceNormal: new THREE.Vector3(dir.x * 0.25, 1, dir.z * 0.25).normalize(),
          scaleMultiplier: 1.04 + (rnd() - 0.5) * sizeVariance,
        });
      }
      plans.push({
        pos: clump.center.clone().addScaledVector(out, -0.3).add(new THREE.Vector3(0, 0.1, 0)),
        growDir: out.clone().setY(0.05).normalize(),
        faceNormal: new THREE.Vector3(0, 1, 0),
        scaleMultiplier: 0.9,
      });
      for (let u = 0; u < 2; u++) {
        const az = turn + Math.PI / padCount + u * Math.PI;
        const dir = new THREE.Vector3(Math.cos(az), -0.12, Math.sin(az)).normalize();
        plans.push({
          pos: clump.center.clone().add(new THREE.Vector3(0, -clump.radius * 0.2, 0)),
          growDir: dir,
          faceNormal: new THREE.Vector3(dir.x * 0.3, 1, dir.z * 0.3).normalize(),
          scaleMultiplier: 0.82 + (rnd() - 0.5) * sizeVariance,
        });
      }
    } else {
      // Standard broadleaf dome & skirt logic:
      // (1) Core Crossed Star (3 cards at 60 deg yaw) for dense, opaque cloud heart
      const coreGrow = new THREE.Vector3(0, 1, 0).add(clump.outward.clone().multiplyScalar(0.18)).normalize();
      const coreRight = new THREE.Vector3().crossVectors(coreGrow, new THREE.Vector3(0, 0, 1)).normalize();
      if (coreRight.lengthSq() < 0.001) coreRight.set(1, 0, 0);

      for (let c = 0; c < 3; c++) {
        const yaw = (c * Math.PI) / 3; // 0, 60, 120 deg
        const rotQ = new THREE.Quaternion().setFromAxisAngle(coreGrow, yaw);
        const normal = coreRight.clone().applyQuaternion(rotQ).normalize();

        plans.push({
          pos: clump.center.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06)),
          growDir: coreGrow,
          faceNormal: normal,
          scaleMultiplier: 1.02,
        });
      }

      // (2) Upper Dome Shell (3 billowing sunlit cards)
      const domeCount = 3;
      for (let d = 0; d < domeCount; d++) {
        const azimuth = (d / domeCount) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
        const elevation = 0.50 + rnd() * 0.38; // ~28° to 50° upward
        const cosEl = Math.cos(elevation);
        const dir = new THREE.Vector3(
          Math.cos(azimuth) * cosEl,
          Math.sin(elevation),
          Math.sin(azimuth) * cosEl
        ).normalize();

        // rooted a little further in, for the same reason as the skirt below
        const cardPos = clump.center.clone().add(dir.clone().multiplyScalar(clump.radius * 0.28));
        const faceNormal = new THREE.Vector3(dir.x, 0.30, dir.z).normalize();

        plans.push({
          pos: cardPos,
          growDir: dir,
          faceNormal,
          scaleMultiplier: 0.96 + (rnd() - 0.5) * sizeVariance,
        });
      }

      // (3) Lateral & Drooping Skirt (3 soft scalloped hanging cards)
      const skirtCount = 3;
      for (let s = 0; s < skirtCount; s++) {
        const azimuth = ((s + 0.5) / skirtCount) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
        const elevation = -0.10 + rnd() * 0.22; // ~ -6° to +12°
        const cosEl = Math.cos(elevation);
        const dir = new THREE.Vector3(
          Math.cos(azimuth) * cosEl,
          Math.sin(elevation),
          Math.sin(azimuth) * cosEl
        ).normalize();

        // The skirt is the UNDERSIDE of the tuft, not a fringe hanging off it.
        // Rooted at half the radius and drooping outward, a skirt card ended
        // ~2 m from the tuft's centre, below everything else; seen from below
        // or edge-on at the rim of the crown it read as a lone dark leaf
        // floating beside the canopy. Rooted just under the centre and growing
        // out and slightly up, it stays inside the tuft's own volume.
        const cardPos = clump.center
          .clone()
          .add(dir.clone().multiplyScalar(clump.radius * 0.22))
          .add(new THREE.Vector3(0, -clump.radius * 0.22, 0));
        const growDir = dir.clone();
        growDir.y += 0.22;
        growDir.normalize();

        const faceNormal = new THREE.Vector3(dir.x, 0.08, dir.z).normalize();

        plans.push({
          pos: cardPos,
          growDir,
          faceNormal,
          scaleMultiplier: 0.94 + (rnd() - 0.5) * sizeVariance,
        });
      }
    }

    // Construct precise orthonormal 3D transformation matrix for each card
    plans.forEach((plan, planIdx) => {
      const finalScale = plan.scaleMultiplier * (1.0 + (rnd() - 0.5) * 0.10);

      // Orthonormal frame for a card growing along `growDir`: local Y runs
      // from its stem to its tip, X across its width, Z is its face normal.
      const orient = (growDir: THREE.Vector3) => {
        const Y = growDir.clone().normalize();
        let X = new THREE.Vector3().crossVectors(Y, plan.faceNormal).normalize();
        if (X.lengthSq() < 0.001) {
          X = new THREE.Vector3().crossVectors(Y, new THREE.Vector3(0, 1, 0)).normalize();
          if (X.lengthSq() < 0.001) X.set(1, 0, 0);
        }
        const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
        return { Y, q };
      };
      let { Y: Y_axis, q: quat } = orient(plan.growDir);

      // The tuft's centre is kept near a visible bough, but its cards fan out
      // up to ~1.2 m from that centre, and the ones on the far side of the
      // bough still hung in the air. So each CARD is held to the same rule:
      // its middle must be within reach of visible wood, and a card further
      // out is slid toward that wood until it is.
      let cardPos = plan.pos;
      if (anchorTufts) {
        const mid = plan.pos.clone().addScaledVector(Y_axis, quadH * 0.5 * finalScale);
        const anchoredMid = anchorToVisibleWood(mid, true, tuftReach);
        if (anchoredMid && anchoredMid !== mid) {
          cardPos = plan.pos.clone().add(anchoredMid.sub(mid));
        }
      }

      // Cards follow their twig. Measured on a bush, a card pointed in the
      // tuft layout's fixed direction (up, out, down) had half its length a
      // quarter-metre or more from any wood and its tip up to 0.8 m off -
      // leaves hanging in empty air; trees have the same problem at a larger
      // scale. So a card is laid ALONG the nearest twig, from there toward the
      // twig's tip, fanned by the tuft's own direction so the sprays still
      // open out, and slid back down the twig if the twig ends before the
      // card. Not for a flat-topped crown: the acacia's cards are its flat
      // plates on purpose.
      if (anchorTufts && !isFlatTop && followWood.length > 0) {
        nearestFollowWood(plan.pos);
        const nearestPoint = nearestWood.clone();
        const root = nearestWood.clone();
        const along = nearestWoodDir.clone();
        let rootNode: SCANode | null = nearestWoodNode;

        // On a tree, every card of a tuft found the same nearest twig and
        // started from the same spot, so the tuft closed into a ball with bare
        // wood between tufts. Each card is slid a random distance up or down
        // its twig (following the wood, so it never leaves it): the tuft is
        // strung out along the branch instead of piled on one point.
        if (!isShrub && rootNode) {
          let slide = (rnd() - 0.5) * 2 * quadH * finalScale * 0.8;
          let at: SCANode = rootNode;
          while (Math.abs(slide) > 1e-4) {
            if (slide > 0) {
              const d = root.distanceTo(at.position);
              if (slide <= d) { root.lerp(at.position, slide / Math.max(d, 1e-6)); break; }
              slide -= d;
              root.copy(at.position);
              if (at.children.length === 0) break;
              at = at.children[Math.floor(rnd() * at.children.length)];
            } else {
              const base = at.parent;
              if (!base || base.isTrunk) break;
              const d = root.distanceTo(base.position);
              if (-slide <= d) { root.lerp(base.position, -slide / Math.max(d, 1e-6)); break; }
              slide += d;
              root.copy(base.position);
              if (!base.parent || base.parent.isTrunk) break;
              at = base;
            }
          }
          rootNode = at;
          if (at.parent) along.subVectors(at.position, at.parent.position).normalize();
        }

        // wood left beyond this point, following the twig out to its end
        let remaining = rootNode ? rootNode.position.distanceTo(root) : 0;
        let walk: SCANode | null = rootNode;
        while (walk && walk.children.length > 0 && remaining < 3) {
          const next: SCANode = walk.children.reduce((best, c) =>
            c.position.clone().sub(walk!.position).normalize().dot(along) >
            best.position.clone().sub(walk!.position).normalize().dot(along) ? c : best
          );
          remaining += next.position.distanceTo(walk.position);
          walk = next;
        }
        const cardLen = quadH * finalScale * 0.85;
        if (remaining < cardLen) root.addScaledVector(along, -(cardLen - remaining));
        // Snapped exactly onto the twig, every card of a tuft started from the
        // same point and the tuft closed up into a tight ball. Each keeps part
        // of the offset the tuft layout gave it, so the cards still start
        // spread apart around the twig.
        const spread = plan.pos.clone().sub(nearestPoint);
        const maxSpread = isShrub ? 0.08 : quadH * finalScale * 0.2;
        if (spread.length() > maxSpread) spread.setLength(maxSpread);
        root.add(spread);

        // Trees get more slack than bushes (their tufts are bigger and read
        // better opening wider off the twig). But a tree's card is up to ~2 m
        // long, and one rooted on a twig at the top of the crown and fanned
        // upward stood a metre and more above the canopy with nothing under
        // it. So the tip is checked: while it ends too far from any wood the
        // card is turned further onto its twig.
        const baseWeight = isShrub ? 0.65 : 0.3;
        const tipReach = quadH * finalScale * (isShrub ? 0.3 : 0.4);
        let grow = along.clone();
        for (const w of [baseWeight, (baseWeight + 1) / 2, 0.95]) {
          grow = along.clone().multiplyScalar(w)
            .addScaledVector(plan.growDir.clone().normalize(), 1 - w)
            .normalize();
          const tip = root.clone().addScaledVector(grow, quadH * finalScale * 0.95);
          if (nearestFollowWood(tip) <= tipReach) break;
        }
        ({ Y: Y_axis, q: quat } = orient(grow));
        cardPos = root;
      }

      const matrix = new THREE.Matrix4();
      matrix.compose(cardPos, quat, new THREE.Vector3(finalScale, finalScale, finalScale));


      const atlasIdx = (clumpIdx * 3 + planIdx) % 8;

      leafCards.push({
        matrix,
        clumpCenter: clump.center.clone(),
        atlasIndex: atlasIdx,
        shade: clumpShade,
        hueShift,
        windPhase: windPhase + planIdx * 0.42,
        windStrength,
        crownDepth,
        neighborDensity,
      });
    });
  });

  // 5. Foliage material.
  //    Default path: the procedural pixel art texture system - a low resolution
  //    structure atlas plus a limited palette LUT, with the tone offset derived
  //    from this tree's own geometry and hard-quantised to whole palette steps.
  //    Legacy path (pixelTextureEnabled: false): the original cel-shaded
  //    gradient material, left completely intact.
  const pixelParams = resolvePixelTextureParams(config);
  const colorTop = new THREE.Color(config.foliageColorTop);
  const colorBottom = new THREE.Color(config.foliageColorBottom);
  // Saturated, rich cool forest shadow (no dark pitch-black crushing)
  const colorShadow = colorBottom.clone().lerp(new THREE.Color('#144d22'), 0.45).multiplyScalar(0.72);

  let foliageMaterial: THREE.ShaderMaterial;

  if (pixelParams.enabled) {
    const pix = getPixelFoliageTextures(config);
    foliageMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uStruct: { value: pix.structure },
        uPalette: { value: pix.palette },
        uPaletteSteps: { value: pix.steps },
        uTileRes: { value: pix.tileRes },
        uAlphaTest: { value: config.alphaTest ?? 0.5 },
        uShadowStrength: { value: pix.params.shadow },
        uHighlightAmount: { value: pix.params.highlights },
        uTextureContrast: { value: pix.params.contrast },
        uAccentAmount: { value: pix.params.accent },
        uCrownBottomY: { value: crownBounds.bottomY },
        uCrownTopY: { value: crownBounds.topY },
        uSnow: { value: THREE.MathUtils.clamp(config.snowCover ?? 0, 0, 1) },
        uCanopyCenter: { value: crownCenter },
        uTexLightDir: { value: pixelTextureLightDir(pix.params) },
        uTime: { value: 0.0 },
        uWindStrength: { value: config.windStrength },
        uWindSpeed: { value: config.windSpeed },
        uFlutterStrength: { value: config.flutterStrength ?? 0.045 },
      },
      vertexShader: PIXEL_LEAF_VERTEX_SHADER,
      fragmentShader: PIXEL_LEAF_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
    });
  } else {
  const leafTexture = generateLegacyLeafAtlasTexture(config.species, config.seed);

  foliageMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: leafTexture },
      uColorTop: { value: colorTop },
      uColorBottom: { value: colorBottom },
      uColorShadow: { value: colorShadow },
      uAlphaTest: { value: config.alphaTest ?? 0.30 },
      uCelSteps: { value: config.celSteps ?? 3 },
      uRimIntensity: { value: config.rimLightIntensity ?? 0.85 },
      uLightDir: { value: new THREE.Vector3(0.65, 0.9, 0.45).normalize() },
      uTime: { value: 0.0 },
      uWindStrength: { value: config.windStrength },
      uWindSpeed: { value: config.windSpeed },
      uFlutterStrength: { value: config.flutterStrength ?? 0.045 },
      uCanopyCenter: { value: crownCenter },
    },
    vertexShader: `
      attribute vec3 aClumpCenter;
      attribute float aAtlasIndex;
      attribute float aShade;
      attribute float aHueShift;
      attribute float aWindPhase;
      attribute float aWindStrength;

      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      uniform float uFlutterStrength;
      uniform vec3 uCanopyCenter;

      varying vec2 vAtlasUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vShade;
      varying float vHueShift;

      void main() {
        // Safe atlas UV sampling with padding to prevent tile boundary bleeding
        float col = mod(aAtlasIndex, 4.0);
        float row = floor(aAtlasIndex / 4.0);
        float safeU = mix(0.008, 0.992, uv.x);
        float safeV = mix(0.008, 0.992, uv.y);
        float u = (safeU + col) * 0.25;
        float v = (safeV + (1.0 - row)) * 0.5;
        vAtlasUv = vec2(u, v);
        vShade = aShade;
        vHueShift = aHueShift;

        vec3 pos = position;

        // Hierarchical Wind Flutter:
        // uv.y=0 is anchored to branch; uv.y=1 flutters in wind
        float tipWeight = uv.y * uv.y;

        // 1. Global canopy sway
        float swayX = sin(uTime * uWindSpeed * 1.25 + aWindPhase + pos.y * 0.22) * 0.08 * uWindStrength;
        float swayZ = cos(uTime * uWindSpeed * 1.05 + aWindPhase) * 0.07 * uWindStrength;
        pos.x += swayX * tipWeight;
        pos.z += swayZ * tipWeight;

        // 2. Leaf tip high-frequency flutter
        float flutter = sin(uTime * uWindSpeed * 5.2 + aWindPhase * 2.8 + pos.x * 3.5)
                      * cos(uTime * uWindSpeed * 3.8 + pos.z * 3.2)
                      * uFlutterStrength * aWindStrength * tipWeight;
        pos.x += flutter;
        pos.y += abs(flutter) * 0.25;
        pos.z += flutter * 0.60;

        vec4 localPos = instanceMatrix * vec4(pos, 1.0);
        vec4 worldPos = modelMatrix * localPos;
        vWorldPos = worldPos.xyz;

        // BotW Clump-Centric Dual Normal Transfer:
        // outwardClump gives each individual bouquet soft, fluffy, rounded 3D pillowy lighting!
        // outwardCrown gives the whole tree its macroscopic sunlit gradient!
        vec3 worldClump = (modelMatrix * vec4(aClumpCenter, 1.0)).xyz;
        vec3 worldCrown = (modelMatrix * vec4(uCanopyCenter, 1.0)).xyz;
        vec3 outwardClump = normalize(worldPos.xyz - worldClump);
        vec3 outwardCrown = normalize(worldPos.xyz - worldCrown);
        
        // Soft pillowy Ghibli volume: 55% clump expansion + 30% crown outward + 15% skyward
        vec3 softNorm = normalize(mix(outwardClump, outwardCrown, 0.35) + vec3(0.0, 0.20, 0.0));
        mat3 normalMat = mat3(modelMatrix);
        vNormal = normalize(normalMat * softNorm);

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform vec3 uColorTop;
      uniform vec3 uColorBottom;
      uniform vec3 uColorShadow;
      uniform float uAlphaTest;
      uniform float uCelSteps;
      uniform float uRimIntensity;
      uniform vec3 uLightDir;

      varying vec2 vAtlasUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vShade;
      varying float vHueShift;

      void main() {
        vec4 texColor = texture2D(uAtlas, vAtlasUv);

        // Alpha Cutout: Discards transparent pixels, leaving crisp organic leaf silhouettes!
        if (texColor.a < uAlphaTest) {
          discard;
        }

        vec3 N = normalize(vNormal);
        vec3 L = normalize(uLightDir);

        // Two-sided lighting calculation with backface translucency for leaf cards
        float NdotL = dot(N, L);
        NdotL = mix(NdotL, max(NdotL, -NdotL * 0.40), 0.45);

        // Authentic BotW 3-Tone NPR Cel Shading
        float sunStep = smoothstep(0.06, 0.22, NdotL);
        float shadowStep = smoothstep(-0.25, -0.05, NdotL);

        // Harmonious foliage base tone with smooth interior occlusion
        vec3 baseTone = mix(uColorBottom, uColorTop, vShade);
        baseTone = mix(uColorShadow * 1.15, baseTone, smoothstep(0.12, 0.42, vShade));

        // Subtle natural instance hue/saturation shift
        baseTone.r += vHueShift * 0.08;
        baseTone.g += vHueShift * 0.14;
        baseTone.b -= vHueShift * 0.05;

        // Modulate with hand-painted anime leaf lobe highlights and depth
        float paintedLobeHighlight = texColor.g;
        float paintedOcclusion = texColor.r;
        baseTone = mix(baseTone * 0.84, baseTone * 1.16, paintedLobeHighlight);
        baseTone *= (0.80 + paintedOcclusion * 0.28);

        // Stylized Cel Color Ramp
        vec3 litColor = mix(baseTone, uColorTop * 1.18, sunStep);
        vec3 finalColor = mix(uColorShadow, litColor, shadowStep);

        // BotW Subsurface Scattering Terminator (Warm golden-amber glow along shadow line)
        float sssTerminator = smoothstep(-0.25, 0.06, NdotL) * (1.0 - smoothstep(0.06, 0.32, NdotL));
        vec3 sssGlow = vec3(0.96, 0.85, 0.26);
        finalColor += sssGlow * sssTerminator * 0.35;

        // BotW Backlit Leaf Translucency (Sunlight transmitting through leaf canopy)
        vec3 V = normalize(cameraPosition - vWorldPos);
        float backlight = max(0.0, dot(V, -L));
        vec3 sssTranslucent = uColorTop * 1.25 * pow(backlight, 2.2) * 0.42;
        finalColor += sssTranslucent;

        // BotW Sunlit Rim Light (Fresnel glow with sunlight back-scatter)
        float rim = 1.0 - max(dot(V, N), 0.0);
        rim = pow(rim, 2.8);
        float rimPower = uRimIntensity * (0.85 + backlight * 1.5);
        vec3 rimColor = mix(vec3(1.0, 0.98, 0.78), vec3(0.88, 1.0, 0.80), vShade);
        finalColor += rimColor * (rim * rimPower * 0.55);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });
  }

  // 6. Populate InstancedMesh
  const totalCards = Math.max(1, leafCards.length);
  const instancedMesh = new THREE.InstancedMesh(quadGeo, foliageMaterial, totalCards);
  instancedMesh.name = 'Foliage_ProceduralLeafCards';
  instancedMesh.castShadow = true;
  instancedMesh.receiveShadow = true;

  const aClumpCenter = new Float32Array(totalCards * 3);
  const aAtlasIndex = new Float32Array(totalCards);
  const aShade = new Float32Array(totalCards);
  const aHueShift = new Float32Array(totalCards);
  const aWindPhase = new Float32Array(totalCards);
  const aWindStrength = new Float32Array(totalCards);
  const aCrownDepth = new Float32Array(totalCards);
  const aNeighborDensity = new Float32Array(totalCards);

  for (let i = 0; i < totalCards; i++) {
    const card = leafCards[i];
    if (!card) continue;
    instancedMesh.setMatrixAt(i, card.matrix);
    aClumpCenter[i * 3 + 0] = card.clumpCenter.x;
    aClumpCenter[i * 3 + 1] = card.clumpCenter.y;
    aClumpCenter[i * 3 + 2] = card.clumpCenter.z;
    aAtlasIndex[i] = card.atlasIndex;
    aShade[i] = card.shade;
    aHueShift[i] = card.hueShift;
    aWindPhase[i] = card.windPhase;
    aWindStrength[i] = card.windStrength;
    aCrownDepth[i] = card.crownDepth;
    aNeighborDensity[i] = card.neighborDensity;
  }

  quadGeo.setAttribute('aCrownDepth', new THREE.InstancedBufferAttribute(aCrownDepth, 1));
  quadGeo.setAttribute('aNeighborDensity', new THREE.InstancedBufferAttribute(aNeighborDensity, 1));
  quadGeo.setAttribute('aClumpCenter', new THREE.InstancedBufferAttribute(aClumpCenter, 3));
  quadGeo.setAttribute('aAtlasIndex', new THREE.InstancedBufferAttribute(aAtlasIndex, 1));
  quadGeo.setAttribute('aShade', new THREE.InstancedBufferAttribute(aShade, 1));
  quadGeo.setAttribute('aHueShift', new THREE.InstancedBufferAttribute(aHueShift, 1));
  quadGeo.setAttribute('aWindPhase', new THREE.InstancedBufferAttribute(aWindPhase, 1));
  quadGeo.setAttribute('aWindStrength', new THREE.InstancedBufferAttribute(aWindStrength, 1));

  instancedMesh.instanceMatrix.needsUpdate = true;

  const update = (time: number) => {
    foliageMaterial.uniforms.uTime.value = time;
    foliageMaterial.uniforms.uWindStrength.value = config.windStrength;
    foliageMaterial.uniforms.uWindSpeed.value = config.windSpeed;
    foliageMaterial.uniforms.uFlutterStrength.value = config.flutterStrength ?? 0.045;
  };

  const dispose = () => {
    quadGeo.dispose();
    foliageMaterial.dispose();
  };

  return {
    instancedMesh,
    foliageMaterial,
    leafCardsCount: totalCards,
    patchCount: clumps.length,
    update,
    dispose,
  };
}
