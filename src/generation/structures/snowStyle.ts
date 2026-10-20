import {TREE_PRESETS} from '../vegetation/pixelTrees/constants/presets';
import {resolvePixelTextureParams,pixelTextureLightDir} from '../vegetation/pixelTrees/services/pixelArtTextureSystem';
import type {StructureConfig} from './types';

/** Match the native rocks used as scenery around this structure. */
export function structureRockSnowStyle(c:StructureConfig){
 const preset=Object.values(TREE_PRESETS).find(p=>p.rock?.biome===c.biome&&!p.rock.gravel&&!p.rock.ore)!;
 const params=resolvePixelTextureParams(preset);
 return {density:params.barkTexelsPerMetre*2.8,lightDir:pixelTextureLightDir(params)};
}
