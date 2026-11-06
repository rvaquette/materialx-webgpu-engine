// Point-sampled CPU adapter for the coefficients retained in compiled volume IR.

import type { Vec3 } from '../../scene/transforms.ts';
import type { MaterialBuild } from '../scene-resources.ts';
import type { IrEvalVaryings } from '../../compiler/ir-eval.ts';
import { evaluateVolumeIr, type VolumeMedium } from '../../compiler/volume-ir.ts';

/**
 * Evaluate a volumeshader at a point, including its emitted radiance.
 * Returns null only for materials without a volume; invalid IR throws.
 */
export function evaluateVolumeMedium(build: MaterialBuild, varyings: IrEvalVaryings): VolumeMedium | null {
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
