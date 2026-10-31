import type { SceneAsset } from '../../scene/types.ts';

export interface PathTraceSettings {
  converted: boolean;
  maxDepth: number;
  rouletteDepth: number;
}

export function pathTraceSettings(scene: SceneAsset): PathTraceSettings {
  const root = scene.prims.get(`/${scene.stage.defaultPrim ?? 'World'}`);
  const converted = typeof root?.attributes.get('pathtracer:sourceScene')?.value === 'string';
  const depth = root?.attributes.get('pathtracer:maxDepth')?.value;
  if (depth !== undefined && (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > 64)) {
    throw new Error('pathtracer:maxDepth must be an integer between 0 and 64.');
  }
  return { converted, maxDepth: typeof depth === 'number' ? depth : 64, rouletteDepth: converted ? 2 : 3 };
}
