// Subsurface scattering preparation for the raster backend (plan section 9.1,
// T025). Raster subsurface is a screen-space diffusion approximation built on a
// normalized Christensen-Burley profile plus a shadow-map thickness estimate for
// back-lit translucency. It is deliberately kept distinct from transmission
// (transmission.ts) and from participating media (volume.ts): it is not a
// substitute for either. CPU-side data only; it records no GPU commands.

import type { Vec3 } from '../../scene/transforms.ts';

export interface SubsurfaceProfile {
  /** Multiple-scattering albedo per channel, in [0,1]. */
  albedo: Vec3;
  /** Mean free path per channel, in scene units. */
  meanFreePath: Vec3;
  /** Relative index of refraction of the surface. */
  ior: number;
}

/**
 * Christensen-Burley diffusion remap s(A): relates the mean free path to the
 * diffusion scattering distance so the profile matches a reference albedo.
 */
export function burleyScalingFactor(albedo: number): number {
  const a = Math.min(Math.max(albedo, 0), 1);
  const d = a - 0.8;
  return 1.9 - a + 3.5 * d * d;
}

/** Per-channel diffusion scattering distance d = meanFreePath / s(albedo). */
export function scatterDistances(profile: SubsurfaceProfile): Vec3 {
  const at = (i: 0 | 1 | 2): number => {
    const s = burleyScalingFactor(profile.albedo[i]);
    return s > 0 ? profile.meanFreePath[i] / s : 0;
  };
  return [at(0), at(1), at(2)];
}

/**
 * Normalized Burley diffusion profile R(r) for a scattering distance d:
 * (e^{-r/d} + e^{-r/3d}) / (8 pi d r). Integrates to 1 over the plane.
 */
export function burleyProfile(radius: number, scatterDistance: number): number {
  if (!(scatterDistance > 0)) return 0;
  const r = Math.max(radius, 1e-6);
  const d = scatterDistance;
  return (Math.exp(-r / d) + Math.exp(-r / (3 * d))) / (8 * Math.PI * d * r);
}

/**
 * Sampling radius capturing `quantile` of the Burley profile energy, found by
 * bisection on its CDF: CDF(r) = 1 - 1/4 e^{-r/d} - 3/4 e^{-r/3d}.
 */
export function diffusionMaxRadius(scatterDistance: number, quantile = 0.997): number {
  if (!(scatterDistance > 0)) return 0;
  const q = Math.min(Math.max(quantile, 0), 0.999999);
  const cdf = (r: number): number =>
    1 - 0.25 * Math.exp(-r / scatterDistance) - 0.75 * Math.exp(-r / (3 * scatterDistance));
  let lo = 0;
  let hi = scatterDistance * 50;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (cdf(mid) < q) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Back-lit translucency transmittance for an estimated `thickness`, per channel,
 * using the diffusion scattering distances. Thickness comes from a shadow-map
 * front/back depth difference, not from volumetric transport.
 */
export function translucencyTransmittance(thickness: number, scatterDistance: Vec3): Vec3 {
  const t = Math.max(thickness, 0);
  const at = (i: 0 | 1 | 2): number => (scatterDistance[i] > 0 ? Math.exp(-t / scatterDistance[i]) : 0);
  return [at(0), at(1), at(2)];
}

export interface SubsurfacePlan {
  scatterDistances: Vec3;
  /** Largest per-channel sampling radius for the screen-space blur. */
  maxRadius: number;
  approximations: readonly string[];
}

export function planSubsurface(profile: SubsurfaceProfile): SubsurfacePlan {
  const d = scatterDistances(profile);
  const maxRadius = Math.max(
    diffusionMaxRadius(d[0]),
    diffusionMaxRadius(d[1]),
    diffusionMaxRadius(d[2]),
  );
  return {
    scatterDistances: d,
    maxRadius,
    approximations: [
      'screen-space separable Burley diffusion; assumes a locally flat, semi-infinite slab',
      'back-lit translucency uses shadow-map thickness, not volumetric transport',
      'distinct from transmission and participating media; not a substitute for either',
    ],
  };
}
