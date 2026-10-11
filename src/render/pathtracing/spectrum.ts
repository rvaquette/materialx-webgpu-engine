// Spectral processing for the reference path tracer (plan section 9.2, T030).
// Mandatory for thin-film interference and dispersion, which are wavelength
// dependent and cannot be expressed in RGB. Provides hero-wavelength sampling,
// analytic CIE 1931 color matching (Wyman et al. 2013 multi-lobe fit),
// spectrum -> XYZ -> linear Rec.709 conversion, dispersive IOR models
// (Cauchy, Sellmeier), and exact thin-film Airy reflectance for a dielectric
// layer. Color output stays linear lin_rec709 (plan section 9.4).

import type { Vec3 } from '../../scene/transforms.ts';

export const LAMBDA_MIN = 360;
export const LAMBDA_MAX = 830;

function lobe(x: number, alpha: number, mu: number, sigma1: number, sigma2: number): number {
  const t = (x - mu) * (x < mu ? 1 / sigma1 : 1 / sigma2);
  return alpha * Math.exp(-0.5 * t * t);
}

/** CIE 1931 x-bar at wavelength l (nm), analytic fit. */
export function cieX(l: number): number {
  return lobe(l, 1.056, 599.8, 37.9, 31.0) + lobe(l, 0.362, 442.0, 16.0, 26.7) + lobe(l, -0.065, 501.1, 20.4, 26.2);
}

/** CIE 1931 y-bar at wavelength l (nm), analytic fit. */
export function cieY(l: number): number {
  return lobe(l, 0.821, 568.8, 46.9, 40.5) + lobe(l, 0.286, 530.9, 16.3, 31.1);
}

/** CIE 1931 z-bar at wavelength l (nm), analytic fit. */
export function cieZ(l: number): number {
  return lobe(l, 1.217, 437.0, 11.8, 36.0) + lobe(l, 0.681, 459.0, 26.0, 13.8);
}

/** Integrates a spectral function against the CIE color matching functions. */
export function spectrumToXYZ(sample: (l: number) => number, step = 5): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let l = LAMBDA_MIN; l <= LAMBDA_MAX; l += step) {
    const s = sample(l);
    x += s * cieX(l);
    y += s * cieY(l);
    z += s * cieZ(l);
  }
  return [x * step, y * step, z * step];
}

/** CIE XYZ to linear sRGB / Rec.709 (D65). */
export function xyzToLinearSrgb(xyz: Vec3): Vec3 {
  const [x, y, z] = xyz;
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/**
 * Converts a spectral radiance function to linear Rec.709, normalized so that a
 * flat unit spectrum (equal energy) maps to luminance 1.
 */
export function spectrumToLinearSrgb(sample: (l: number) => number, step = 5): Vec3 {
  let yInt = 0;
  for (let l = LAMBDA_MIN; l <= LAMBDA_MAX; l += step) yInt += cieY(l);
  yInt *= step;
  const xyz = spectrumToXYZ(sample, step);
  const inv = yInt > 0 ? 1 / yInt : 0;
  return xyzToLinearSrgb([xyz[0] * inv, xyz[1] * inv, xyz[2] * inv]);
}

export interface WavelengthSample {
  wavelength: number;
  pdf: number;
}

/** Uniform hero-wavelength sampling for spectral Monte Carlo (dispersion). */
export function sampleWavelength(u: number, min = LAMBDA_MIN, max = LAMBDA_MAX): WavelengthSample {
  const range = max - min;
  return { wavelength: min + u * range, pdf: range > 0 ? 1 / range : 0 };
}

/** Cauchy dispersion n(l) = b + c/l^2 with wavelength in nm, c in um^2. */
export function cauchyIor(wavelengthNm: number, b: number, c: number): number {
  const um = wavelengthNm / 1000;
  return b + c / (um * um);
}

/** Sellmeier dispersion; wavelength in nm, coefficients c in um^2. */
export function sellmeierIor(wavelengthNm: number, b: Vec3, c: Vec3): number {
  const um = wavelengthNm / 1000;
  const l2 = um * um;
  let n2 = 1;
  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    n2 += (b[i] * l2) / (l2 - c[i]);
  }
  return Math.sqrt(Math.max(n2, 1e-6));
}

function fresnelS(na: number, cosA: number, nb: number, cosB: number): number {
  return (na * cosA - nb * cosB) / (na * cosA + nb * cosB);
}

function fresnelP(na: number, cosA: number, nb: number, cosB: number): number {
  return (nb * cosA - na * cosB) / (nb * cosA + na * cosB);
}

// Airy reflectance of a single film given interface amplitude coefficients.
function airy(r01: number, r12: number, phi: number): number {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const numRe = r01 + r12 * cp;
  const numIm = r12 * sp;
  const denRe = 1 + r01 * r12 * cp;
  const denIm = r01 * r12 * sp;
  const num = numRe * numRe + numIm * numIm;
  const den = denRe * denRe + denIm * denIm;
  return den > 0 ? num / den : 1;
}

export interface ThinFilmResponse {
  reflectance: number;
  transmittance: number;
}

/**
 * Exact thin-film Airy reflectance for a single dielectric layer (outer n0,
 * film n1 of thickness d in nm, substrate n2) at the given wavelength and outer
 * cosine. Unpolarized average of s and p. Lossless: T = 1 - R. Total internal
 * reflection in the film or substrate returns full reflection.
 */
export function thinFilmReflectance(
  wavelengthNm: number,
  thicknessNm: number,
  cosTheta0: number,
  n0: number,
  n1: number,
  n2: number,
): ThinFilmResponse {
  const c0 = Math.min(Math.max(cosTheta0, 0), 1);
  const sin0sq = 1 - c0 * c0;
  const sin1sq = (n0 / n1) * (n0 / n1) * sin0sq;
  const sin2sq = (n0 / n2) * (n0 / n2) * sin0sq;
  if (sin1sq >= 1 || sin2sq >= 1) return { reflectance: 1, transmittance: 0 };

  const c1 = Math.sqrt(1 - sin1sq);
  const c2 = Math.sqrt(1 - sin2sq);
  const phi = (4 * Math.PI * n1 * thicknessNm * c1) / wavelengthNm;

  const rs = airy(fresnelS(n0, c0, n1, c1), fresnelS(n1, c1, n2, c2), phi);
  const rp = airy(fresnelP(n0, c0, n1, c1), fresnelP(n1, c1, n2, c2), phi);
  const reflectance = 0.5 * (rs + rp);
  return { reflectance, transmittance: 1 - reflectance };
}

/**
 * Integrates thin-film reflectance across the spectrum into a linear Rec.709
 * iridescent tint under an equal-energy illuminant.
 */
export function thinFilmColor(
  thicknessNm: number,
  cosTheta0: number,
  n0: number,
  n1: number,
  n2: number,
  step = 5,
): Vec3 {
  return spectrumToLinearSrgb((l) => thinFilmReflectance(l, thicknessNm, cosTheta0, n0, n1, n2).reflectance, step);
}
