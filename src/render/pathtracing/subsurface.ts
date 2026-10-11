// Subsurface scattering for the reference path tracer (plan section 9.2, T029).
// Brute-force volumetric random walk (BSSRDF): the surface is treated as a
// dense participating medium and photons random-walk until they exit. No
// diffusion/profile approximation is used, so the estimator is unbiased. Two
// termination strategies trade variance for cost at equal expectation:
//   - 'analog'   : scatter survives with probability = single-scatter albedo
//                  (analog absorption), weights stay 1. Lowest variance per
//                  sample for high-albedo media, zero bias.
//   - 'weighted' : throughput is multiplied by the albedo and Russian roulette
//                  terminates the walk; decouples absorption from termination.
// Both converge to the same reflectance/transmittance. The albedo inversion of
// Chiang et al. 2016 maps an artist diffuse albedo to the medium's
// single-scatter albedo that drives the walk.

import type { Vec3 } from '../../scene/transforms.ts';
import type { Rng } from './integrator.ts';
import { sampleHenyeyGreenstein } from './media.ts';

type V = Vec3;

function normalize(v: V): V {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
}

/**
 * Chiang et al. 2016 inversion mapping a diffuse surface albedo A to the
 * single-scatter albedo alpha used to drive a random walk. Per channel.
 */
export function singleScatterAlbedo(a: Vec3): Vec3 {
  const f = (x: number): number => {
    const c = Math.min(Math.max(x, 0), 1);
    return 1 - Math.exp(-5.09406 * c + 2.61188 * c * c - 4.31805 * c * c * c);
  };
  return [f(a[0]), f(a[1]), f(a[2])];
}

/**
 * Christensen-Burley scaling s(A) used to turn an artist mean free path into a
 * volumetric extinction: sigma_t = 1 / (meanFreePath * s). Parameterization
 * only; the walk itself stays unbiased. Per channel.
 */
export function extinctionFromMeanFreePath(meanFreePath: Vec3, albedo: Vec3): Vec3 {
  const sigma = (d: number, a: number): number => {
    const s = 1.9 - a + 3.5 * (a - 0.8) * (a - 0.8);
    const dd = d * s;
    return dd > 0 ? 1 / dd : 0;
  };
  return [sigma(meanFreePath[0], albedo[0]), sigma(meanFreePath[1], albedo[1]), sigma(meanFreePath[2], albedo[2])];
}

export type WalkMode = 'analog' | 'weighted';

export interface RandomWalkOptions {
  mode?: WalkMode;
  maxBounces?: number;
  minBounces?: number;
  rrProbability?: number;
}

export type ExitKind = 'front' | 'back' | 'absorbed' | 'terminated';

export interface RandomWalkResult {
  exit: ExitKind;
  /** Throughput carried out of the medium (0 when absorbed/terminated). */
  weight: number;
  bounces: number;
}

/**
 * Single-channel random walk through a homogeneous slab of the given thickness,
 * bounded by z=0 (entry/front) and z=thickness (back). The photon exits 'front'
 * (diffuse reflectance) or 'back' (transmittance). Unbiased for both modes.
 */
export function randomWalkSlabChannel(
  sigmaT: number,
  albedo: number,
  anisotropy: number,
  thickness: number,
  entryDir: Vec3,
  rng: Rng,
  options: RandomWalkOptions = {},
): RandomWalkResult {
  const mode = options.mode ?? 'analog';
  const maxBounces = options.maxBounces ?? 1_000_000;
  const minBounces = options.minBounces ?? 0;
  const rrP = Math.min(Math.max(options.rrProbability ?? 0.95, 1e-3), 1);

  let z = 0;
  let dir = normalize(entryDir);
  let weight = 1;

  for (let b = 0; b < maxBounces; b += 1) {
    if (!(sigmaT > 0)) return { exit: 'back', weight, bounces: b };
    const t = -Math.log(1 - rng()) / sigmaT;
    const nz = z + dir[2] * t;
    if (nz < 0) return { exit: 'front', weight, bounces: b };
    if (nz > thickness) return { exit: 'back', weight, bounces: b };
    z = nz;

    if (mode === 'analog') {
      if (rng() >= albedo) return { exit: 'absorbed', weight: 0, bounces: b };
    } else {
      weight *= albedo;
      if (b >= minBounces) {
        if (rng() >= rrP) return { exit: 'terminated', weight: 0, bounces: b };
        weight /= rrP;
      }
    }

    dir = sampleHenyeyGreenstein(dir, anisotropy, rng(), rng()).wi;
  }
  return { exit: 'terminated', weight, bounces: maxBounces };
}

export interface SlabResponse {
  reflectance: Vec3;
  transmittance: Vec3;
  absorbed: Vec3;
}

/**
 * Monte Carlo estimate of the spectral slab response by averaging per-channel
 * random walks. Diffuse reflectance (front exits) and transmittance (back
 * exits); the remainder is absorbed. Unbiased in the sample count.
 */
export function estimateSlabResponse(
  singleScatter: Vec3,
  sigmaT: Vec3,
  anisotropy: number,
  thickness: number,
  entryDir: Vec3,
  rng: Rng,
  samples: number,
  options: RandomWalkOptions = {},
): SlabResponse {
  const reflectance: [number, number, number] = [0, 0, 0];
  const transmittance: [number, number, number] = [0, 0, 0];
  for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
    let r = 0;
    let tr = 0;
    for (let i = 0; i < samples; i += 1) {
      const walk = randomWalkSlabChannel(sigmaT[c], singleScatter[c], anisotropy, thickness, entryDir, rng, options);
      if (walk.exit === 'front') r += walk.weight;
      else if (walk.exit === 'back') tr += walk.weight;
    }
    reflectance[c] = r / samples;
    transmittance[c] = tr / samples;
  }
  return {
    reflectance,
    transmittance,
    absorbed: [
      Math.max(0, 1 - reflectance[0] - transmittance[0]),
      Math.max(0, 1 - reflectance[1] - transmittance[1]),
      Math.max(0, 1 - reflectance[2] - transmittance[2]),
    ],
  };
}
