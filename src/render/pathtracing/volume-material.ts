// Path tracer volume material support (Phase 3). Bridges MaterialBuild.volume
// (compiled volumeshader) to HomogeneousMedium (volumetric transport). Evaluates
// the volumeshader for constant parameters and extracts the medium properties.
//
// Note: This is the CPU-side interface for SceneSampler. The GPU side (compute.ts)
// needs parallel handling in WGSL to evaluate volumeshaders and populate the
// medium record.

import type { HomogeneousMedium } from './media.ts';
import type { Vec3 } from '../../scene/transforms.ts';
import type { MaterialBuild } from '../scene-resources.ts';
import type { IrEvalVaryings } from '../../compiler/ir-eval.ts';
import { evaluateVolumeIr } from '../../compiler/volume-ir.ts';

/**
 * Evaluate a volumeshader MaterialBuild at constant varyings and extract
 * the HomogeneousMedium parameters (absorption, scattering, anisotropy).
 * Returns null if the build has no volume or evaluation fails.
 */
export function evaluateVolumeMedium(build: MaterialBuild, varyings: IrEvalVaryings): HomogeneousMedium | null {
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
