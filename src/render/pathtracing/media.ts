// Participating-media sampling for the reference path tracer (plan section 9.2,
// T028). Unbiased volumetric transport: spectral homogeneous medium sampling,
// delta (Woodcock) tracking and ratio-tracking transmittance for heterogeneous
// densities with a valid majorant, plus Henyey-Greenstein phase sampling and
// evaluation. No model approximations: the estimators are unbiased. These are
// the CPU reference the compute media path mirrors.

import type { Vec3 } from '../../scene/transforms.ts';
import type { Rng } from './integrator.ts';

type V = Vec3;

function normalize(v: V): V {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

// Duff et al. 2017 branchless orthonormal basis around a unit vector.
function coordinateSystem(w: V): [V, V] {
  const sign = w[2] >= 0 ? 1 : -1;
  const a = -1 / (sign + w[2]);
  const b = w[0] * w[1] * a;
  const t1: V = [1 + sign * w[0] * w[0] * a, sign * b, -sign * w[0]];
  const t2: V = [b, sign + w[1] * w[1] * a, -w[1]];
  return [t1, t2];
}

export interface HomogeneousMedium {
  /** Absorption coefficient per channel. */
  absorption: Vec3;
  /** Scattering coefficient per channel. */
  scattering: Vec3;
  /** Henyey-Greenstein anisotropy g in (-1,1); 0 is isotropic. */
  anisotropy: number;
}

/** Extinction (sigma_t = absorption + scattering) per channel. */
export function extinction(medium: HomogeneousMedium): Vec3 {
  return [
    medium.absorption[0] + medium.scattering[0],
    medium.absorption[1] + medium.scattering[1],
    medium.absorption[2] + medium.scattering[2],
  ];
}

/**
 * Pure-absorption interior for a transmissive surface (OpenPBR / glTF
 * KHR_materials_volume). attenuationColor is the Beer-Lambert tint reached after
 * attenuationDistance, so sigma_a = -ln(color)/distance and there is no scattering.
 * An infinite or non-positive distance yields a vacuum (no absorption).
 */
export function absorbingMedium(attenuationColor: Vec3, attenuationDistance: number): HomogeneousMedium {
  const sigma = (c: number): number => {
    if (!(attenuationDistance > 0) || !Number.isFinite(attenuationDistance)) return 0;
    return -Math.log(Math.min(Math.max(c, 1e-6), 1)) / attenuationDistance;
  };
  return {
    absorption: [sigma(attenuationColor[0]), sigma(attenuationColor[1]), sigma(attenuationColor[2])],
    scattering: [0, 0, 0],
    anisotropy: 0,
  };
}

/** Beer-Lambert transmittance of a homogeneous segment, per channel. */
export function transmittanceHomogeneous(sigmaT: Vec3, distance: number): Vec3 {
  const d = Math.max(distance, 0);
  return [Math.exp(-sigmaT[0] * d), Math.exp(-sigmaT[1] * d), Math.exp(-sigmaT[2] * d)];
}

/** Henyey-Greenstein phase value for the cosine between in/out directions. */
export function phaseHG(cosTheta: number, g: number): number {
  const gg = Math.min(Math.max(g, -0.99), 0.99);
  const denom = 1 + gg * gg - 2 * gg * cosTheta;
  return (1 - gg * gg) / (4 * Math.PI * Math.max(denom, 1e-6) ** 1.5);
}

export interface PhaseSample {
  wi: Vec3;
  pdf: number;
}

/**
 * Samples a scattered direction from the Henyey-Greenstein phase around `wo`.
 * The returned pdf equals phaseHG(dot(wi, wo), g), so the phase is sampled
 * exactly (importance sampled, unbiased).
 */
export function sampleHenyeyGreenstein(wo: Vec3, g: number, u1: number, u2: number): PhaseSample {
  const w = normalize(wo);
  let cosTheta: number;
  if (Math.abs(g) < 1e-3) {
    cosTheta = 1 - 2 * u1;
  } else {
    const sqr = (1 - g * g) / (1 + g - 2 * g * u1);
    cosTheta = -(1 + g * g - sqr * sqr) / (2 * g);
  }
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * u2;
  const [t1, t2] = coordinateSystem(w);
  const sc = sinTheta * Math.cos(phi);
  const ss = sinTheta * Math.sin(phi);
  const wi: V = [
    sc * t1[0] + ss * t2[0] + cosTheta * w[0],
    sc * t1[1] + ss * t2[1] + cosTheta * w[1],
    sc * t1[2] + ss * t2[2] + cosTheta * w[2],
  ];
  return { wi, pdf: phaseHG(cosTheta, g) };
}

export interface MediumInteraction {
  /** True for a real scattering event inside the medium; false at the surface. */
  scattered: boolean;
  /** Distance along the ray where the event occurs. */
  t: number;
  /** Throughput importance weight for the sampled event. */
  weight: Vec3;
}

/**
 * Spectral free-flight sampling in a homogeneous medium up to `tMax`. A hero
 * channel drives the distance sample; the returned weight accounts for the
 * spectral pdf so both the scatter and the surface-reaching case stay unbiased.
 */
export function sampleHomogeneous(medium: HomogeneousMedium, tMax: number, rng: Rng): MediumInteraction {
  const sigmaT = extinction(medium);
  const sigmaS = medium.scattering;
  const ch = Math.min(2, Math.floor(rng() * 3)) as 0 | 1 | 2;
  const st = sigmaT[ch];
  const t = st > 0 ? -Math.log(1 - rng()) / st : Infinity;
  const scattered = t < tMax;
  const dist = scattered ? t : tMax;
  const tr = transmittanceHomogeneous(sigmaT, dist);

  if (scattered) {
    const pdf = (sigmaT[0] * tr[0] + sigmaT[1] * tr[1] + sigmaT[2] * tr[2]) / 3;
    const density = pdf > 0 ? pdf : 1;
    return {
      scattered: true,
      t: dist,
      weight: [(tr[0] * sigmaS[0]) / density, (tr[1] * sigmaS[1]) / density, (tr[2] * sigmaS[2]) / density],
    };
  }
  const pdf = (tr[0] + tr[1] + tr[2]) / 3;
  const density = pdf > 0 ? pdf : 1;
  return { scattered: false, t: tMax, weight: [tr[0] / density, tr[1] / density, tr[2] / density] };
}

export interface FreeFlight {
  scattered: boolean;
  t: number;
}

/**
 * Delta (Woodcock) tracking of a free-flight distance through a heterogeneous
 * scalar extinction field, using the majorant `sigmaMaj` (which must bound the
 * field). Null collisions are rejected so the real-collision distance is
 * sampled without bias.
 */
export function deltaTrack(
  sigmaMaj: number,
  sigmaTAt: (t: number) => number,
  tMax: number,
  rng: Rng,
): FreeFlight {
  if (!(sigmaMaj > 0)) return { scattered: false, t: tMax };
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng()) / sigmaMaj;
    if (t >= tMax) return { scattered: false, t: tMax };
    if (sigmaTAt(t) / sigmaMaj > rng()) return { scattered: true, t };
  }
}

/**
 * Ratio-tracking estimator of transmittance through a heterogeneous scalar
 * extinction field. Unbiased: its expected value is the true transmittance.
 */
export function ratioTrackingTransmittance(
  sigmaMaj: number,
  sigmaTAt: (t: number) => number,
  tMax: number,
  rng: Rng,
): number {
  if (!(sigmaMaj > 0)) return 1;
  let tr = 1;
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng()) / sigmaMaj;
    if (t >= tMax) break;
    tr *= 1 - sigmaTAt(t) / sigmaMaj;
  }
  return tr;
}
