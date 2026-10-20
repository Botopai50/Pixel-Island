// @ts-nocheck
import * as THREE from 'three';

/** World size of one texel of the root-fibre pixel art: 1/21.33 m, about 4.7 cm. */
export const FIBRE_TEXELS_PER_METRE = 21.33;

/**
 * Pixel-art texture of dry root fibres, for the hanging root skirt of a palm.
 * Fibres run from the bottom of the image (where they leave the trunk) up to
 * the tips; everything between them is transparent, so a few crossed planes
 * read as hundreds of hairs. The texture is made at exactly the size of the
 * plane it goes on (w x h texels), so every texel is the same size in the world.
 */
export function rootFibreTexture(seed: number, w: number, h: number): THREE.CanvasTexture {
  let state = (Math.floor(seed) * 9301 + 49297) % 233280;
  const rnd = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // the trunk's own warm red-browns: dark and dense at the root end, drying to lighter tips
  const deep = ['#2b1810', '#3a2016'];
  const dark = ['#4d2a1d', '#5e3322'];
  const mid = ['#7a4630', '#8a5238'];
  const light = ['#a8694a', '#bd7f58'];
  const tip = ['#cf9a6c', '#dcae80'];
  const pick = (a: string[]) => a[Math.floor(rnd() * a.length)];
  const fibres = Math.max(4, Math.round(w * 0.55));
  for (let i = 0; i < fibres; i++) {
    let x = 1 + (i / fibres) * (w - 2) + (rnd() - 0.5) * 1.5;
    const len = Math.floor(h * (0.55 + rnd() * 0.45));
    const drift = (rnd() - 0.5) * 0.55;
    const shift = Math.floor(rnd() * 2); // some fibres run a shade lighter
    for (let y = h - 1; y > h - 1 - len; y--) {
      x += drift + (rnd() - 0.5) * 0.35;
      const t = (h - 1 - y) / len;
      // t = 0 at the root end (dark, like the trunk), 1 at the dry tip (light)
      const r = t;
      const set = r < 0.25 ? deep : r < 0.5 ? (shift ? dark : mid) : r < 0.75 ? (shift ? mid : light) : (shift ? light : tip);
      ctx.fillStyle = pick(set);
      ctx.fillRect(Math.round(x), y, 1, 1);
      // fibres are thicker at the root end and break up toward the tip
      if (r < 0.45) { ctx.fillStyle = pick(r < 0.2 ? deep : dark); ctx.fillRect(Math.round(x) + 1, y, 1, 1); }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
