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

/**
 * Evaluate a volumeshader MaterialBuild at constant varyings and extract
 * the HomogeneousMedium parameters (absorption, scattering, anisotropy).
 * Returns null if the build has no volume or evaluation fails.
 */
export function evaluateVolumeMedium(build: MaterialBuild, _varyings: IrEvalVaryings): HomogeneousMedium | null {
  if (!build.volume || !build.module) return null;

  // For now: placeholder that returns neutral medium.
  // Full implementation requires:
  // 1. Create IR evaluator for the volumeshader
  // 2. Sample textures at the varyings (if any volume inputs reference textures)
  // 3. Evaluate input expressions and extract absorption/scattering/anisotropy
  // 4. Pack into HomogeneousMedium
  //
  // For Phase 3: assume volumeshaders are constant (no texture inputs),
  // so we can read parameters directly from the IR constants.

  // Placeholder: Neutral medium (no absorption, no scattering, isotropic)
  return {
    absorption: [0, 0, 0],
    scattering: [0, 0, 0],
    anisotropy: 0,
  };
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
