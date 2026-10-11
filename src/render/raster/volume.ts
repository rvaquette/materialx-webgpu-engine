// Participating-media preparation and single-scattering ray-march reference for
// the raster backend (plan section 9.1, T025). Volumes are integrated by ray
// marching with Beer-Lambert transmittance and a Henyey-Greenstein phase; the
// integration quality (step size, max steps) and the single-scattering
// approximation are declared explicitly. `marchVolume` is a CPU reference the
// WGSL volume pass mirrors; it records no GPU commands.

import type { Vec3 } from '../../scene/transforms.ts';

export interface VolumeMaterial {
  /** Absorption coefficient per channel. */
  absorption: Vec3;
  /** Scattering coefficient per channel. */
  scattering: Vec3;
  /** Emission radiance per channel; defaults to zero. */
  emission?: Vec3;
  /** Henyey-Greenstein anisotropy g in (-1,1); 0 is isotropic. */
  anisotropy: number;
}

/** Extinction (sigma_t = absorption + scattering) per channel. */
export function extinction(material: VolumeMaterial): Vec3 {
  return [
    material.absorption[0] + material.scattering[0],
    material.absorption[1] + material.scattering[1],
    material.absorption[2] + material.scattering[2],
  ];
}

/** Single-scattering albedo (scattering / extinction) per channel. */
export function scatteringAlbedo(material: VolumeMaterial): Vec3 {
  const e = extinction(material);
  const at = (i: 0 | 1 | 2): number => (e[i] > 0 ? material.scattering[i] / e[i] : 0);
  return [at(0), at(1), at(2)];
}

/** Henyey-Greenstein phase value for the cosine between in/out directions. */
export function henyeyGreenstein(cosTheta: number, g: number): number {
  const gg = Math.min(Math.max(g, -0.99), 0.99);
  const denom = 1 + gg * gg - 2 * gg * cosTheta;
  return (1 - gg * gg) / (4 * Math.PI * Math.max(denom, 1e-6) ** 1.5);
}

/** Beer-Lambert transmittance over a homogeneous segment of given length. */
export function beerLambert(extinctionCoeff: Vec3, distance: number): Vec3 {
  const t = Math.max(distance, 0);
  return [
    Math.exp(-extinctionCoeff[0] * t),
    Math.exp(-extinctionCoeff[1] * t),
    Math.exp(-extinctionCoeff[2] * t),
  ];
}

export interface VolumeMarchOptions {
  material: VolumeMaterial;
  near: number;
  far: number;
  stepSize: number;
  maxSteps: number;
  /** Density multiplier along the ray at parametric distance t. */
  density: (t: number) => number;
  /** In-scattered light radiance reaching distance t (phase already applied). */
  inScatter?: (t: number) => Vec3;
  /** Fraction in [0,1) offsetting the first sample to reduce banding. */
  jitter?: number;
  /** Stop once max transmittance drops below this; defaults to 1e-3. */
  minTransmittance?: number;
}

export interface VolumeMarchResult {
  /** Accumulated in-scattered and emitted radiance. */
  radiance: Vec3;
  /** Transmittance of the whole marched segment. */
  transmittance: Vec3;
  /** Steps actually taken before `far` or early termination. */
  steps: number;
}

/**
 * Front-to-back single-scattering ray march. Each step integrates emission and
 * in-scattering analytically against the step transmittance, accumulating into
 * the running radiance and transmittance, with early-out when the segment is
 * effectively opaque.
 */
export function marchVolume(options: VolumeMarchOptions): VolumeMarchResult {
  const { material, near, far, density } = options;
  const emission: Vec3 = material.emission ?? [0, 0, 0];
  const sigmaT = extinction(material);
  const minT = options.minTransmittance ?? 1e-3;
  const dt = Math.max(options.stepSize, 1e-6);
  const maxSteps = Math.max(1, Math.floor(options.maxSteps));
  const jitter = Math.min(Math.max(options.jitter ?? 0, 0), 1);

  const T: [number, number, number] = [1, 1, 1];
  const L: [number, number, number] = [0, 0, 0];
  let steps = 0;

  for (let i = 0; i < maxSteps; i++) {
    const t = near + (i + jitter) * dt;
    if (t >= far) break;
    steps++;
    const d = Math.max(density(t), 0);
    const light: Vec3 = options.inScatter ? options.inScatter(t) : [0, 0, 0];
    for (const c of [0, 1, 2] as const) {
      const st = sigmaT[c] * d;
      const stepTrans = Math.exp(-st * dt);
      const source = emission[c] * d + material.scattering[c] * d * light[c];
      const integrated = st > 0 ? (source / st) * (1 - stepTrans) : source * dt;
      L[c] += T[c] * integrated;
      T[c] *= stepTrans;
    }
    if (Math.max(T[0], T[1], T[2]) < minT) break;
  }

  return { radiance: [L[0], L[1], L[2]], transmittance: [T[0], T[1], T[2]], steps };
}

export type VolumeQuality = 'low' | 'medium' | 'high';

export interface VolumePlan {
  extinction: Vec3;
  scatteringAlbedo: Vec3;
  stepSize: number;
  maxSteps: number;
  approximations: readonly string[];
}

const QUALITY: Record<VolumeQuality, { steps: number; stepScale: number }> = {
  low: { steps: 32, stepScale: 2 },
  medium: { steps: 64, stepScale: 1 },
  high: { steps: 128, stepScale: 0.5 },
};

/**
 * Plans a volume pass: derives extinction and single-scattering albedo, picks a
 * step size and budget from the quality preset, and declares the integration
 * and diffusion approximations. The preset tunes convergence, not the model.
 */
export function planVolume(
  material: VolumeMaterial,
  quality: VolumeQuality = 'medium',
  baseStep = 1,
): VolumePlan {
  const q = QUALITY[quality];
  return {
    extinction: extinction(material),
    scatteringAlbedo: scatteringAlbedo(material),
    stepSize: baseStep * q.stepScale,
    maxSteps: q.steps,
    approximations: [
      'single scattering only; multiple scattering is not integrated',
      `fixed-step ray march (max ${q.steps} steps); step size controls integration bias`,
      'homogeneous Henyey-Greenstein phase evaluated per step',
    ],
  };
}
