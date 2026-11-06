// Point-sampled parameter adapter for the raster CPU reference.

import type { VolumeMaterial } from './volume.ts';
import type { Vec3 } from '../../scene/transforms.ts';
import type { MaterialBuild } from '../scene-resources.ts';
import type { IrEvalVaryings } from '../../compiler/ir-eval.ts';
import { evaluateVolumeIr } from '../../compiler/volume-ir.ts';

/**
 * Evaluate a volumeshader MaterialBuild at constant varyings and extract
 * the VolumeMaterial parameters (absorption, scattering, anisotropy, emission).
 * Returns null only for materials without a volume; invalid IR throws.
 */
export function evaluateVolumeMaterial(
  build: MaterialBuild,
  varyings: IrEvalVaryings,
): VolumeMaterial | null {
  return build.volume ? evaluateVolumeIr(build.ir, varyings) : null;
}

/**
 * Utility: convert a color3 array (like from volumeshader parameter) to Vec3.
 */
export function colorToVec3(color: [number, number, number] | number[]): Vec3 {
  return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0];
}

/**
 * Utility: clamp anisotropy to valid Henyey-Greenstein range [-0.99, 0.99].
 */
export function clampAnisotropy(g: number): number {
  return Math.min(Math.max(g, -0.99), 0.99);
}

/**
 * Get volume quality settings for the scene. Can be overridden by scene
 * configuration or material hints.
 */
export function getVolumeQuality(hint?: string): 'low' | 'medium' | 'high' {
  if (hint === 'low' || hint === 'medium' || hint === 'high') return hint;
  return 'medium'; // default quality
}
