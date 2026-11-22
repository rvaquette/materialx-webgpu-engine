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

/** KHR_materials_dispersion RGB approximation (R/G/B = 0/1/2). */
export function dispersionIor(ior: number, dispersion: number, channel: 0 | 1 | 2): number {
  return Math.max(1, ior + (channel - 1) * (ior - 1) * 0.025 * Math.max(dispersion, 0));
}

// Spectral dispersion (path tracer): one wavelength per path, drawn from a
// piecewise-constant distribution proportional to |r| + |g| + |b| of the
// monochromatic sRGB response, and an IOR following Cauchy's law fitted to the
// Abbe number (V = 20 / dispersion, as KHR_materials_dispersion): n(587.6 nm) is
// the authored IOR and n(486.1) - n(656.3) = (n - 1) / V.
export const DISPERSION_LAMBDA_MIN = 380;
export const DISPERSION_LAMBDA_MAX = 720;
export const DISPERSION_BINS = 34;
const LAMBDA_D = 0.5876, LAMBDA_F = 0.4861, LAMBDA_C = 0.6563;

/** IOR at a wavelength (nm) for the authored IOR and KHR dispersion (20 / Abbe number). */
export function dispersionIorAt(ior: number, dispersion: number, wavelengthNm: number): number {
  if (!(dispersion > 0)) return ior;
  const abbe = 20 / dispersion;
  const b = (ior - 1) / (abbe * (1 / (LAMBDA_F * LAMBDA_F) - 1 / (LAMBDA_C * LAMBDA_C)));
  const um = wavelengthNm / 1000;
  return Math.max(1, ior + b * (1 / (um * um) - 1 / (LAMBDA_D * LAMBDA_D)));
}

/** Linear sRGB response of a unit monochromatic stimulus. */
export function wavelengthRgb(wavelengthNm: number): Vec3 {
  return xyzToLinearSrgb([cieX(wavelengthNm), cieY(wavelengthNm), cieZ(wavelengthNm)]);
}

interface DispersionTable { cdf: number[]; normalization: Vec3 }
let dispersionTable: DispersionTable | undefined;

/** Bin CDF of the sampling distribution and per-channel integrals of the response. */
export function dispersionSamplingTable(): DispersionTable {
  if (dispersionTable) return dispersionTable;
  const width = (DISPERSION_LAMBDA_MAX - DISPERSION_LAMBDA_MIN) / DISPERSION_BINS;
  const steps = 16;
  const masses: number[] = [];
  const normalization: [number, number, number] = [0, 0, 0];
  for (let bin = 0; bin < DISPERSION_BINS; bin++) {
    let mass = 0;
    for (let k = 0; k < steps; k++) {
      const rgb = wavelengthRgb(DISPERSION_LAMBDA_MIN + (bin + (k + 0.5) / steps) * width);
      mass += (Math.abs(rgb[0]) + Math.abs(rgb[1]) + Math.abs(rgb[2])) * width / steps;
      for (let c = 0; c < 3; c++) normalization[c] = normalization[c]! + rgb[c]! * width / steps;
    }
    masses.push(mass);
  }
  const total = masses.reduce((a, b) => a + b, 0);
  const cdf: number[] = [];
  let sum = 0;
  for (const mass of masses) cdf.push(sum += mass / total);
  cdf[cdf.length - 1] = 1;
  return dispersionTable = { cdf, normalization };
}

/** Wavelength and the RGB path weight (unit mean per channel) for a uniform sample u. */
export function sampleDispersionWavelength(u: number): { wavelength: number; weight: Vec3 } {
  const { cdf, normalization } = dispersionSamplingTable();
  let bin = 0;
  while (bin < DISPERSION_BINS - 1 && u >= cdf[bin]!) bin++;
  const lower = bin === 0 ? 0 : cdf[bin - 1]!;
  const probability = cdf[bin]! - lower;
  const width = (DISPERSION_LAMBDA_MAX - DISPERSION_LAMBDA_MIN) / DISPERSION_BINS;
  const wavelength = DISPERSION_LAMBDA_MIN + (bin + (u - lower) / probability) * width;
  const pdf = probability / width;
  const rgb = wavelengthRgb(wavelength);
  return { wavelength, weight: [rgb[0] / (normalization[0] * pdf), rgb[1] / (normalization[1] * pdf), rgb[2] / (normalization[2] * pdf)] };
}

/** WGSL twin of sampleDispersionWavelength and dispersionIorAt (constants baked from the same table). */
export function dispersionWgsl(): string {
  const { cdf, normalization } = dispersionSamplingTable();
  const f = (v: number) => v.toPrecision(9);
  return `
const MX_DISPERSION_CDF = array<f32, ${DISPERSION_BINS}>(${cdf.map(f).join(', ')});
fn mx_cie_lobe(x: f32, alpha: f32, mu: f32, s1: f32, s2: f32) -> f32 {
  let t = (x - mu) / select(s2, s1, x < mu);
  return alpha * exp(-0.5 * t * t);
}
fn mx_wavelength_rgb(l: f32) -> vec3f {
  let x = mx_cie_lobe(l, 1.056, 599.8, 37.9, 31.0) + mx_cie_lobe(l, 0.362, 442.0, 16.0, 26.7) + mx_cie_lobe(l, -0.065, 501.1, 20.4, 26.2);
  let y = mx_cie_lobe(l, 0.821, 568.8, 46.9, 40.5) + mx_cie_lobe(l, 0.286, 530.9, 16.3, 31.1);
  let z = mx_cie_lobe(l, 1.217, 437.0, 11.8, 36.0) + mx_cie_lobe(l, 0.681, 459.0, 26.0, 13.8);
  return vec3f(3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z);
}
// xyz: wavelength (nm), then the path weight (unit mean per channel) in w of a vec4 pair.
fn mx_sample_dispersion_wavelength(u: f32) -> vec4f {
  var cdf = MX_DISPERSION_CDF;
  var bin = 0u;
  for (; bin < ${DISPERSION_BINS - 1}u; bin++) { if (u < cdf[bin]) { break; } }
  let lower = select(cdf[max(bin, 1u) - 1u], 0.0, bin == 0u);
  let probability = cdf[bin] - lower;
  let width = ${f((DISPERSION_LAMBDA_MAX - DISPERSION_LAMBDA_MIN) / DISPERSION_BINS)};
  let wavelength = ${f(DISPERSION_LAMBDA_MIN)} + (f32(bin) + (u - lower) / probability) * width;
  return vec4f(mx_wavelength_rgb(wavelength) * width / (probability * vec3f(${normalization.map(f).join(', ')})), wavelength);
}
fn mx_dispersion_ior_at(ior: f32, dispersion: f32, wavelength: f32) -> f32 {
  if (dispersion <= 0.0) { return ior; }
  let b = (ior - 1.0) * dispersion / (20.0 * (1.0 / (${LAMBDA_F} * ${LAMBDA_F}) - 1.0 / (${LAMBDA_C} * ${LAMBDA_C})));
  let um = wavelength / 1000.0;
  return max(1.0, ior + b * (1.0 / (um * um) - 1.0 / (${LAMBDA_D} * ${LAMBDA_D})));
}
`;
}

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

// sRGB primary-ish wavelengths used to collapse the spectral Airy response into
// an RGB Fresnel modulation without a full spectral integral (T056f).
const RGB_LAMBDA: Vec3 = [612, 549, 465];

/**
 * RGB thin-film reflectance over a substrate whose air-interface Fresnel at
 * normal incidence is `substrateF0` (per channel). Each channel derives the real
 * substrate index that reproduces its F0, then evaluates the exact angle-correct
 * Airy reflectance at the matching sRGB primary wavelength. As thickness -> 0 the
 * Airy stack collapses to the bare substrate Fresnel, so this reduces to the
 * nominal dielectric/conductor reflectance; non-zero thickness introduces the
 * chromatic interference. Used to modulate the specular Fresnel term (T056f).
 */
export function thinFilmTint(thicknessNm: number, cosTheta0: number, filmIor: number, substrateF0: Vec3): Vec3 {
  const channel = (c: 0 | 1 | 2): number => {
    const f0 = Math.min(Math.max(substrateF0[c], 0), 0.9999);
    const s = Math.sqrt(f0);
    const n2 = (1 + s) / (1 - s);
    return thinFilmReflectance(RGB_LAMBDA[c], thicknessNm, cosTheta0, 1, filmIor, n2).reflectance;
  };
  return [channel(0), channel(1), channel(2)];
}

/** Remap the angle used by the film, without changing the geometric shading frame. */
export function remapThinFilmCosine(cosine: number, scale = 1, offsetDegrees = 0): number {
  if (scale === 1 && offsetDegrees === 0) return cosine;
  const angle = Math.acos(Math.min(1, Math.max(0, cosine)));
  const remapped = Math.min(Math.PI / 2, Math.max(0, angle * scale + offsetDegrees * Math.PI / 180));
  return Math.cos(remapped);
}

function rgbHue(color: Vec3): number {
  const [r, g, b] = color;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const chroma = maximum - minimum;
  if (chroma <= 1e-8) return 0;
  const hue = maximum === r ? (g - b) / chroma + (g < b ? 6 : 0)
    : maximum === g ? (b - r) / chroma + 2
      : (r - g) / chroma + 4;
  return hue / 6;
}

/** Rotate an RGB color's hue while preserving its HSV saturation and value. */
export function rotateRgbHue(color: Vec3, hueOffset: number): Vec3 {
  const maximum = Math.max(...color);
  const minimum = Math.min(...color);
  const chroma = maximum - minimum;
  if (chroma <= 1e-8 || !Number.isFinite(hueOffset)) return color;
  const hue = ((rgbHue(color) + hueOffset) % 1 + 1) % 1;
  const sector = hue * 6;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const m = minimum;
  const rgb: Vec3 = sector < 1 ? [chroma, x, 0]
    : sector < 2 ? [x, chroma, 0]
      : sector < 3 ? [0, chroma, x]
        : sector < 4 ? [0, x, chroma]
          : sector < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

/** Map physical hues to Target Hue, preserving film saturation/value; neutral targets disable mapping. */
export function mapThinFilmHue(color: Vec3, targetHue: Vec3): Vec3 {
  const targetChroma = Math.max(...targetHue) - Math.min(...targetHue);
  if (targetChroma <= 1e-8) return color;
  return rotateRgbHue(color, rgbHue(targetHue) - rgbHue(color));
}
