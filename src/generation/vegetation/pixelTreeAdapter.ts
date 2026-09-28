import type * as THREE from 'three';
import { createTree } from 'pixel-tree/src/services/treeGenerator.ts';
import { TREE_PRESETS } from 'pixel-tree/src/constants/presets.ts';

export type PixelTreePresetKey = keyof typeof TREE_PRESETS;

export function createPixelTreePrototype(
  presetKey: PixelTreePresetKey,
  seed: number
): THREE.Group {
  const preset = TREE_PRESETS[presetKey];
  if (!preset) throw new Error(`Pixel_Tree preset not found: ${String(presetKey)}`);
  const tree = createTree({
    ...preset,
    seed,
    textureSeed: seed,
    showAttractors: false,
    showFallingLeaves: false,
  });
  return tree.group;
}
