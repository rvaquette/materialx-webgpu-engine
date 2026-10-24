// Per-lobe BSDF evaluation, pdf and importance sampling for the reference path
// tracer (plan section 9.2, T044). Each lobe exposes a coherent triplet:
//   eval(wo, wi)  -> { value: f(wo,wi), pdf }   (solid-angle pdf)
//   sample(wo, u) -> { wi, value, pdf }          (pdf matches eval at wi)
// so the Monte Carlo estimator f*cos/pdf is unbiased and the lobes conserve
// energy (hemispherical reflectance <= 1, exactly the albedo for diffuse).
// Microfacet math reuses the same GGX NDF and separable Smith masking as the
// raster reference (src/render/bsdf/reference.ts) so both backends agree on the
// model; only sampling and pdf are added here. Everything below works in a local
// shading frame where the surface normal is +Z; world-space adapters are at the
// end. Subsurface/BSSRDF sampling stays in subsurface.ts (T029); transmission
// here is the rough-surface diffuse-transmission lobe (translucent_bsdf).

import type { Vec3 } from '../../scene/transforms.ts';
import type { CoatLayer, LayeredBsdfLobe, LayeredClosure, ThinFilmLayer } from '../../compiler/ir.ts';
import { dispersionIor, thinFilmTint } from './spectrum.ts';

const PI = Math.PI;
const INV_PI = 1 / Math.PI;

type V = Vec3;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const mul = (a: V, b: V): V => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function normalize(a: V): V {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}

export type Rng = () => number;

export interface BsdfEval {
  /** Pure BSDF value f(wo, wi) (no cosine term). */
  value: Vec3;
  /** Solid-angle pdf of sampling wi; zero for directions the lobe cannot emit. */
  pdf: number;
}

export interface BsdfSampleLocal {
  /** Sampled direction in the local shading frame (+Z = normal). */
  wi: Vec3;
  value: Vec3;
  pdf: number;
  /** True only for delta lobes; these lobes are all rough (false). */
  specular: boolean;
}

export interface Lobe {
  eval(wo: Vec3, wi: Vec3): BsdfEval;
  sample(wo: Vec3, rng: Rng): BsdfSampleLocal | null;
}

// --- shared GGX / Fresnel (mirrors reference.ts conventions) ----------------

/** GGX (Trowbridge-Reitz) normal distribution; a is the roughness^2 alpha. */
function ggxNdf(cosThetaH: number, a: number): number {
  const a2 = a * a;
  const d = cosThetaH * cosThetaH * (a2 - 1) + 1;
  return a2 / Math.max(PI * d * d, 1e-7);
}

/** Separable Smith masking term G1, matching reference.ts. */
function smithG1(cosThetaX: number, a: number): number {
  const a2 = a * a;
  return (2 * cosThetaX) / Math.max(cosThetaX + Math.sqrt(a2 + (1 - a2) * cosThetaX * cosThetaX), 1e-7);
}

function fresnelSchlick(f0: Vec3, cosTheta: number): Vec3 {
  const f = Math.pow(clamp01(1 - cosTheta), 5);
  return [f0[0] + (1 - f0[0]) * f, f0[1] + (1 - f0[1]) * f, f0[2] + (1 - f0[2]) * f];
}

/** Dielectric F0 from an index of refraction (air interface). */
export function dielectricF0(ior: number): number {
  const r = (ior - 1) / (ior + 1);
  return r * r;
}

/** Clamp a perceptual roughness to the alpha the microfacet math uses. */
function alphaOf(roughness: number): number {
  return Math.max(roughness * roughness, 1e-3);
}

// --- hemisphere sampling helpers --------------------------------------------

/** Cosine-weighted hemisphere sample around +Z; pdf = cosTheta / pi. */
function cosineHemisphere(u1: number, u2: number): V {
  const r = Math.sqrt(u1);
  const phi = 2 * PI * u2;
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u1))];
}

/** Sample a GGX microfacet normal (around +Z) from the NDF. */
function sampleGgxNormal(a: number, u1: number, u2: number): V {
  const phi = 2 * PI * u1;
  const cosT = Math.sqrt((1 - u2) / (1 + (a * a - 1) * u2));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  return [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT];
}

/** Reflect wo about a microfacet normal wm (both in local frame). */
function reflectAbout(wo: V, wm: V): V {
  return sub(scale(wm, 2 * dot(wo, wm)), wo);
}

// --- diffuse lobes -----------------------------------------------------------

/** Lambert diffuse reflection; hemispherical reflectance equals albedo. */
export function lambertLobe(albedo: Vec3): Lobe {
  const f: V = scale(albedo, INV_PI);
  return {
    eval(wo, wi) {
      if (wo[2] <= 0 || wi[2] <= 0) return { value: [0, 0, 0], pdf: 0 };
      return { value: [...f], pdf: wi[2] * INV_PI };
    },
    sample(wo, rng) {
      if (wo[2] <= 0) return null;
      const wi = cosineHemisphere(rng(), rng());
      return { wi, value: [...f], pdf: wi[2] * INV_PI, specular: false };
    },
  };
}

/** Diffuse transmission (translucent_bsdf): cosine lobe in the far hemisphere. */
export function translucentLobe(albedo: Vec3): Lobe {
  const f: V = scale(albedo, INV_PI);
  return {
    eval(wo, wi) {
      if (wo[2] <= 0 || wi[2] >= 0) return { value: [0, 0, 0], pdf: 0 };
      return { value: [...f], pdf: -wi[2] * INV_PI };
    },
    sample(wo, rng) {
      if (wo[2] <= 0) return null;
      const h = cosineHemisphere(rng(), rng());
      const wi: V = [h[0], h[1], -h[2]];
      return { wi, value: [...f], pdf: -wi[2] * INV_PI, specular: false };
    },
  };
}

/**
 * Subsurface scattering as a local shading lobe (T056g). The non-local BSSRDF
 * random walk in subsurface.ts (T029) exits the medium diffusely, and under the
 * Chiang et al. 2016 albedo inversion the directional-hemispherical reflectance
 * of the optically-thick (radius -> 0) medium equals the artist diffuse albedo.
 * The sampled lobe is therefore the cosine-hemisphere response with that albedo,
 * replacing the former null fallback: it keeps the estimator unbiased and matches
 * the diffuse lobe exactly in the radius -> 0 limit (the spatial profile stays in
 * subsurface.ts for the integrator wiring in T057).
 */
export function subsurfaceLobe(albedo: Vec3): Lobe {
  const f: V = scale(albedo, INV_PI);
  return {
    eval(wo, wi) {
      if (wo[2] <= 0 || wi[2] <= 0) return { value: [0, 0, 0], pdf: 0 };
      return { value: [...f], pdf: wi[2] * INV_PI };
    },
    sample(wo, rng) {
      if (wo[2] <= 0) return null;
      const wi = cosineHemisphere(rng(), rng());
      return { wi, value: [...f], pdf: wi[2] * INV_PI, specular: false };
    },
  };
}

// --- microfacet reflection lobes --------------------------------------------

function microfacetEval(wo: V, wi: V, a: number, fresnel: (cosVH: number) => V): BsdfEval {
  if (wo[2] <= 0 || wi[2] <= 0) return { value: [0, 0, 0], pdf: 0 };
  const wm0 = add(wo, wi);
  if (wm0[0] === 0 && wm0[1] === 0 && wm0[2] === 0) return { value: [0, 0, 0], pdf: 0 };
  const wm = normalize(wm0);
  const cosVH = dot(wo, wm);
  if (cosVH <= 0) return { value: [0, 0, 0], pdf: 0 };
  const D = ggxNdf(wm[2], a);
  const G = smithG1(wo[2], a) * smithG1(wi[2], a);
  const F = fresnel(cosVH);
  const value = scale(F, (D * G) / (4 * wo[2] * wi[2]));
  const pdf = (D * wm[2]) / (4 * cosVH);
  return { value, pdf };
}

function microfacetSample(wo: V, a: number, fresnel: (cosVH: number) => V, rng: Rng): BsdfSampleLocal | null {
  if (wo[2] <= 0) return null;
  const wm = sampleGgxNormal(a, rng(), rng());
  const wi = reflectAbout(wo, wm);
  if (wi[2] <= 0) return null;
  const { value, pdf } = microfacetEval(wo, wi, a, fresnel);
  if (pdf <= 0) return null;
  return { wi, value, pdf, specular: false };
}

/** Conductor GGX reflection with a coloured F0 (Schlick), e.g. a metal tint. */
export function conductorLobe(f0: Vec3, roughness: number): Lobe {
  const a = alphaOf(roughness);
  const fresnel = (cosVH: number): V => fresnelSchlick(f0, cosVH);
  return {
    eval: (wo, wi) => microfacetEval(wo as V, wi as V, a, fresnel),
    sample: (wo, rng) => microfacetSample(wo as V, a, fresnel, rng),
  };
}

/** Dielectric GGX reflection; achromatic F0 from the index of refraction. */
export function dielectricLobe(ior: number, roughness: number): Lobe {
  const a = alphaOf(roughness);
  const f0v: V = [dielectricF0(ior), dielectricF0(ior), dielectricF0(ior)];
  const fresnel = (cosVH: number): V => fresnelSchlick(f0v, cosVH);
  return {
    eval: (wo, wi) => microfacetEval(wo as V, wi as V, a, fresnel),
    sample: (wo, rng) => microfacetSample(wo as V, a, fresnel, rng),
  };
}

// --- anisotropic microfacet reflection (GGX alpha_u/alpha_v + rotation) ------
// anisotropy 0 gives aspect 1 so alphaU = alphaV = alphaOf(roughness) and every
// formula collapses to the isotropic core above; lobeFromLayered keeps the
// isotropic path for anisotropy <= 0 so the existing lobes stay byte-identical.

/** Split the GGX alpha into (alphaU, alphaV) from roughness and anisotropy. */
function anisoAlphas(roughness: number, anisotropy: number): [number, number] {
  const base = alphaOf(roughness);
  const aspect = Math.sqrt(1 - Math.min(Math.max(anisotropy, 0), 0.98));
  return [Math.min(base / aspect, 1), base * aspect];
}

/** Rotate a local-frame direction by `rotation` turns about +Z. */
function rotateTangent(w: V, rotation: number): V {
  if (rotation === 0) return w;
  const ang = 2 * PI * rotation;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [w[0] * c + w[1] * s, -w[0] * s + w[1] * c, w[2]];
}

function ggxNdfAniso(wm: V, au: number, av: number): number {
  const t = (wm[0] * wm[0]) / (au * au) + (wm[1] * wm[1]) / (av * av) + wm[2] * wm[2];
  return 1 / Math.max(PI * au * av * t * t, 1e-7);
}

function smithG1Aniso(w: V, au: number, av: number): number {
  const lam = Math.sqrt(au * au * w[0] * w[0] + av * av * w[1] * w[1] + w[2] * w[2]);
  return (2 * w[2]) / Math.max(w[2] + lam, 1e-7);
}

/** Sample an anisotropic GGX microfacet normal (full NDF, around +Z). */
function sampleGgxNormalAniso(au: number, av: number, u1: number, u2: number): V {
  const phi = Math.atan2(av * Math.sin(2 * PI * u1), au * Math.cos(2 * PI * u1));
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const a2 = 1 / ((cosP * cosP) / (au * au) + (sinP * sinP) / (av * av));
  const tan2 = (a2 * u2) / Math.max(1 - u2, 1e-7);
  const cosT = 1 / Math.sqrt(1 + tan2);
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  return [sinT * cosP, sinT * sinP, cosT];
}

function microfacetEvalAniso(
  wo: V,
  wi: V,
  au: number,
  av: number,
  rotation: number,
  fresnel: (cosVH: number) => V,
): BsdfEval {
  if (wo[2] <= 0 || wi[2] <= 0) return { value: [0, 0, 0], pdf: 0 };
  const wor = rotateTangent(wo, rotation);
  const wir = rotateTangent(wi, rotation);
  const wm0 = add(wor, wir);
  if (wm0[0] === 0 && wm0[1] === 0 && wm0[2] === 0) return { value: [0, 0, 0], pdf: 0 };
  const wm = normalize(wm0);
  const cosVH = dot(wor, wm);
  if (cosVH <= 0) return { value: [0, 0, 0], pdf: 0 };
  const D = ggxNdfAniso(wm, au, av);
  const G = smithG1Aniso(wor, au, av) * smithG1Aniso(wir, au, av);
  const F = fresnel(cosVH);
  const value = scale(F, (D * G) / (4 * wor[2] * wir[2]));
  const pdf = (D * wm[2]) / (4 * cosVH);
  return { value, pdf };
}

function microfacetSampleAniso(
  wo: V,
  au: number,
  av: number,
  rotation: number,
  fresnel: (cosVH: number) => V,
  rng: Rng,
): BsdfSampleLocal | null {
  if (wo[2] <= 0) return null;
  const wor = rotateTangent(wo, rotation);
  const wm = sampleGgxNormalAniso(au, av, rng(), rng());
  const wir = reflectAbout(wor, wm);
  if (wir[2] <= 0) return null;
  const wi = rotateTangent(wir, -rotation);
  const { value, pdf } = microfacetEvalAniso(wo, wi, au, av, rotation, fresnel);
  if (pdf <= 0) return null;
  return { wi, value, pdf, specular: false };
}

/** Anisotropic conductor GGX reflection (coloured F0). */
export function conductorAnisoLobe(f0: Vec3, roughness: number, anisotropy: number, rotation: number): Lobe {
  const [au, av] = anisoAlphas(roughness, anisotropy);
  const fresnel = (cosVH: number): V => fresnelSchlick(f0, cosVH);
  return {
    eval: (wo, wi) => microfacetEvalAniso(wo as V, wi as V, au, av, rotation, fresnel),
    sample: (wo, rng) => microfacetSampleAniso(wo as V, au, av, rotation, fresnel, rng),
  };
}

/** Anisotropic dielectric GGX reflection; achromatic F0 from the index of refraction. */
export function dielectricAnisoLobe(ior: number, roughness: number, anisotropy: number, rotation: number): Lobe {
  const [au, av] = anisoAlphas(roughness, anisotropy);
  const f0v: V = [dielectricF0(ior), dielectricF0(ior), dielectricF0(ior)];
  const fresnel = (cosVH: number): V => fresnelSchlick(f0v, cosVH);
  return {
    eval: (wo, wi) => microfacetEvalAniso(wo as V, wi as V, au, av, rotation, fresnel),
    sample: (wo, rng) => microfacetSampleAniso(wo as V, au, av, rotation, fresnel, rng),
  };
}

// --- thin film (Airy interference on the specular Fresnel, T056f) ------------
// A thin dielectric film over the specular interface produces view- and
// wavelength-dependent interference (iridescence). thinFilmTint (spectrum.ts)
// returns the exact angle-correct Airy reflectance per RGB channel over a
// substrate reproducing the lobe's F0; here it replaces the specular Fresnel,
// blended by the film weight. The guard (weight 0 or thickness 0) returns the
// nominal Schlick Fresnel byte-for-byte, so a closure without an active film
// reproduces the plain conductor/dielectric lobe exactly (non-regression).

/** Modulate a Schlick Fresnel by thin-film interference over a substrate F0. */
function thinFilmFresnel(baseFresnel: V, baseF0: V, cosVH: number, film: ThinFilmLayer): V {
  if (film.weight <= 0 || film.thickness <= 0) return baseFresnel;
  const iris = thinFilmTint(film.thickness, cosVH, film.ior, baseF0);
  const w = clamp01(film.weight);
  return [
    baseFresnel[0] + (iris[0] - baseFresnel[0]) * w,
    baseFresnel[1] + (iris[1] - baseFresnel[1]) * w,
    baseFresnel[2] + (iris[2] - baseFresnel[2]) * w,
  ];
}

/** Build the specular Fresnel closure, optionally modulated by a thin film. */
function specularFresnel(f0v: V, film: ThinFilmLayer | undefined): (cosVH: number) => V {
  if (!film || film.weight <= 0 || film.thickness <= 0) return (c) => fresnelSchlick(f0v, c);
  return (c) => thinFilmFresnel(fresnelSchlick(f0v, c), f0v, c, film);
}

/** Conductor GGX reflection with a thin-film-modulated Fresnel (iso or aniso). */
export function conductorThinFilmLobe(
  f0: Vec3,
  roughness: number,
  anisotropy: number,
  rotation: number,
  film: ThinFilmLayer,
): Lobe {
  const fresnel = specularFresnel([...f0] as V, film);
  if (anisotropy > 0) {
    const [au, av] = anisoAlphas(roughness, anisotropy);
    return {
      eval: (wo, wi) => microfacetEvalAniso(wo as V, wi as V, au, av, rotation, fresnel),
      sample: (wo, rng) => microfacetSampleAniso(wo as V, au, av, rotation, fresnel, rng),
    };
  }
  const a = alphaOf(roughness);
  return {
    eval: (wo, wi) => microfacetEval(wo as V, wi as V, a, fresnel),
    sample: (wo, rng) => microfacetSample(wo as V, a, fresnel, rng),
  };
}

/** Dielectric GGX reflection with a thin-film-modulated Fresnel (iso or aniso). */
export function dielectricThinFilmLobe(
  ior: number,
  roughness: number,
  anisotropy: number,
  rotation: number,
  film: ThinFilmLayer,
): Lobe {
  const f0v: V = [dielectricF0(ior), dielectricF0(ior), dielectricF0(ior)];
  const fresnel = specularFresnel(f0v, film);
  if (anisotropy > 0) {
    const [au, av] = anisoAlphas(roughness, anisotropy);
    return {
      eval: (wo, wi) => microfacetEvalAniso(wo as V, wi as V, au, av, rotation, fresnel),
      sample: (wo, rng) => microfacetSampleAniso(wo as V, au, av, rotation, fresnel, rng),
    };
  }
  const a = alphaOf(roughness);
  return {
    eval: (wo, wi) => microfacetEval(wo as V, wi as V, a, fresnel),
    sample: (wo, rng) => microfacetSample(wo as V, a, fresnel, rng),
  };
}

// --- sheen -------------------------------------------------------------------

/** Charlie sheen distribution (Estevez/Kulla). */
function charlieSheenNdf(cosH: number, roughness: number): number {
  const inv = 1 / Math.max(roughness, 1e-3);
  const sin2 = Math.max(1 - cosH * cosH, 0);
  return ((2 + inv) * Math.pow(sin2, inv * 0.5)) / (2 * PI);
}

function sheenEval(color: V, roughness: number, wo: V, wi: V): BsdfEval {
  if (wo[2] <= 0 || wi[2] <= 0) return { value: [0, 0, 0], pdf: 0 };
  const wm0 = add(wo, wi);
  if (wm0[0] === 0 && wm0[1] === 0 && wm0[2] === 0) return { value: [0, 0, 0], pdf: 0 };
  const wm = normalize(wm0);
  const D = charlieSheenNdf(wm[2], roughness);
  const vis = 1 / (4 * (wi[2] + wo[2] - wi[2] * wo[2]));
  return { value: scale(color, D * vis), pdf: wi[2] * INV_PI };
}

/** Charlie sheen reflection (Ashikhmin visibility); cosine-sampled layer lobe. */
export function sheenLobe(color: Vec3, roughness: number): Lobe {
  return {
    eval: (wo, wi) => sheenEval(color, roughness, wo as V, wi as V),
    sample(wo, rng) {
      if ((wo as V)[2] <= 0) return null;
      const wi = cosineHemisphere(rng(), rng());
      const { value, pdf } = sheenEval(color, roughness, wo as V, wi);
      if (pdf <= 0) return null;
      return { wi, value, pdf, specular: false };
    },
  };
}

/** Gaussian directional-albedo fit for the Zeltner et al. LTC sheen model. */
export function fuzzDirectionalAlbedo(cosView: number, roughness: number): number {
  const r = Math.min(1, Math.max(0.01, roughness));
  const sigma = r * (0.0206607 + 1.58491 * r) / (0.0379424 + r * (1.32227 + r));
  const mean = r * (-0.193854 + r * (-1.14885 + r * (1.7932 - 0.95943 * r * r))) / (0.046391 + r);
  const offset = r * (0.000654023 + r * (-0.0207818 + 0.119681 * r)) / (1.26264 + r * (-1.92021 + r));
  const z = (clamp01(cosView) - mean) / sigma;
  return clamp01(Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * PI)) + offset);
}

/** Zeltner LTC sheen: the normalized transformed cosine is its sampling PDF. */
export function fuzzLobe(color: Vec3, roughness: number): Lobe {
  function parameters(wo: V) {
    const v = clamp01(wo[2]);
    const r = Math.min(1, Math.max(0.01, roughness));
    const a = r * (2.58126 * v + 0.813703 * r) / (1 + 0.310327 * v * v + 2.60994 * v * r);
    const b = Math.sqrt(1 - v) * (r - 1) * r * r * r / (0.0000254053 + 1.71228 * v - 1.71506 * v * r + 1.34174 * r * r);
    const length = Math.hypot(wo[0], wo[1]);
    const tangent: V = length > 0 ? [wo[0] / length, wo[1] / length, 0] : [1, 0, 0];
    return { a, b, tangent };
  }
  function ev(wo: V, wi: V): BsdfEval {
    if (wo[2] <= 0 || wi[2] <= 0) return { value: [0, 0, 0], pdf: 0 };
    const { a, b, tangent: t } = parameters(wo);
    const x = a * dot(wi, t) + b * wi[2];
    const y = a * (-wi[0] * t[1] + wi[1] * t[0]);
    const lengthSquared = x * x + y * y + wi[2] * wi[2];
    const densityOverCosine = INV_PI * (a / lengthSquared) ** 2;
    return {
      value: scale(color, fuzzDirectionalAlbedo(wo[2], roughness) * densityOverCosine),
      pdf: wi[2] * densityOverCosine,
    };
  }
  return {
    eval: ev,
    sample(wo, rng) {
      if (wo[2] <= 0) return null;
      const { a, b, tangent: t } = parameters(wo);
      const cosine = cosineHemisphere(rng(), rng());
      const local = normalize([(cosine[0] - b * cosine[2]) / a, cosine[1] / a, cosine[2]]);
      const wi: V = [t[0] * local[0] - t[1] * local[1], t[1] * local[0] + t[0] * local[1], local[2]];
      return { wi, ...ev(wo, wi), specular: false };
    },
  };
}

// --- dielectric transmission (BTDF): refraction + thin-walled ----------------
// Rough dielectric transmission from the Walter et al. 2007 microfacet BTDF. The
// refractive variant bends the transmitted ray by Snell's law and carries the
// 1/eta^2 radiance compression on the refraction side (the eta^2 half-vector
// Jacobian in the pdf is not matched in the radiance-mode value, so the sampled
// throughput is compressed by 1/eta^2). The thin-walled variant skips refraction
// (straight-through, both sides) by mirroring the microfacet reflection into the
// opposite hemisphere. Both weight by the dielectric Fresnel transmittance
// (1 - F) and a transmission tint. lobeFromLayered only builds these when a
// dielectric_transmission lobe is present, so an opaque stack is unchanged.

/** Unpolarized dielectric Fresnel reflectance; eta = n_t / n_i, any-sign cosI. */
export function fresnelDielectric(cosI: number, eta: number): number {
  const c = Math.abs(cosI);
  const sin2t = (1 - c * c) / (eta * eta);
  if (sin2t >= 1) return 1; // total internal reflection
  const cosT = Math.sqrt(1 - sin2t);
  const rs = (c - eta * cosT) / (c + eta * cosT);
  const rp = (eta * c - cosT) / (eta * c + cosT);
  return 0.5 * (rs * rs + rp * rp);
}

/** Refract wo about the microfacet normal wm; invEta = n_i / n_t. Null on TIR. */
function refractAboutMicrofacet(wo: V, wm: V, invEta: number): V | null {
  const cosI = dot(wo, wm);
  const sin2t = invEta * invEta * Math.max(0, 1 - cosI * cosI);
  if (sin2t >= 1) return null;
  const cosT = Math.sqrt(1 - sin2t);
  return normalize(add(scale(wo, -invEta), scale(wm, invEta * cosI - cosT)));
}

function transmissionEval(wo: V, wi: V, a: number, ior: number, tint: V): BsdfEval {
  if (wo[2] === 0 || wi[2] === 0 || wo[2] * wi[2] > 0) return { value: [0, 0, 0], pdf: 0 };
  const eta = wo[2] > 0 ? ior : 1 / ior; // n_t / n_i across the crossing
  let wm = normalize(add(wo, scale(wi, eta)));
  if (wm[2] < 0) wm = scale(wm, -1);
  const dotO = dot(wo, wm);
  const dotI = dot(wi, wm);
  const denom = dotO + eta * dotI;
  if (Math.abs(denom) < 1e-7) return { value: [0, 0, 0], pdf: 0 };
  const F = fresnelDielectric(dotO, eta);
  const D = ggxNdf(Math.abs(wm[2]), a);
  const G = smithG1(Math.abs(wo[2]), a) * smithG1(Math.abs(wi[2]), a);
  // Radiance-mode BTDF value: the eta^2 of the Jacobian is absent here so that
  // value / pdf carries the 1/eta^2 compression on the refracted radiance.
  const common = (Math.abs(dotO) * Math.abs(dotI)) / (Math.abs(wo[2]) * Math.abs(wi[2]));
  const scalar = ((1 - F) * common * D * G) / (denom * denom);
  const pdf = (D * Math.abs(wm[2]) * eta * eta * Math.abs(dotI)) / (denom * denom);
  return { value: scale(tint, scalar), pdf };
}

/** Refractive dielectric transmission (glass): Snell + 1/eta^2 compression. */
export function dielectricTransmissionLobe(tint: Vec3, roughness: number, ior: number): Lobe {
  const a = alphaOf(roughness);
  const t: V = [...tint];
  return {
    eval: (wo, wi) => transmissionEval(wo as V, wi as V, a, ior, t),
    sample(wo, rng) {
      const w = wo as V;
      if (w[2] === 0) return null;
      let wm = sampleGgxNormal(a, rng(), rng());
      if (w[2] < 0) wm = scale(wm, -1); // face the incident side
      if (dot(w, wm) <= 0) return null;
      const invEta = w[2] > 0 ? 1 / ior : ior; // n_i / n_t
      const wi = refractAboutMicrofacet(w, wm, invEta);
      if (!wi || w[2] * wi[2] > 0) return null; // TIR or no crossing
      const { value, pdf } = transmissionEval(w, wi, a, ior, t);
      if (pdf <= 0) return null;
      return { wi, value, pdf, specular: false };
    },
  };
}

function thinWalledEval(wo: V, wi: V, a: number, ior: number, tint: V): BsdfEval {
  if (wo[2] === 0 || wi[2] === 0 || wo[2] * wi[2] > 0) return { value: [0, 0, 0], pdf: 0 };
  const s = wo[2] > 0 ? 1 : -1;
  const woU: V = [wo[0], wo[1], s * wo[2]];
  const wiU: V = [wi[0], wi[1], -s * wi[2]]; // mirror wi into wo's hemisphere
  const wm0 = add(woU, wiU);
  if (wm0[0] === 0 && wm0[1] === 0 && wm0[2] === 0) return { value: [0, 0, 0], pdf: 0 };
  const wm = normalize(wm0);
  const cosVH = dot(woU, wm);
  if (cosVH <= 0) return { value: [0, 0, 0], pdf: 0 };
  const F = fresnelDielectric(cosVH, ior);
  const D = ggxNdf(wm[2], a);
  const G = smithG1(woU[2], a) * smithG1(wiU[2], a);
  const scalar = ((1 - F) * D * G) / (4 * woU[2] * wiU[2]);
  const pdf = (D * wm[2]) / (4 * cosVH);
  return { value: scale(tint, scalar), pdf };
}

/** Thin-walled transmission: no refraction, transmits from both sides. */
export function thinWalledTransmissionLobe(tint: Vec3, roughness: number, ior: number): Lobe {
  const a = alphaOf(roughness);
  const t: V = [...tint];
  return {
    eval: (wo, wi) => thinWalledEval(wo as V, wi as V, a, ior, t),
    sample(wo, rng) {
      const w = wo as V;
      if (w[2] === 0) return null;
      const s = w[2] > 0 ? 1 : -1;
      const woU: V = [w[0], w[1], s * w[2]];
      const wm = sampleGgxNormal(a, rng(), rng());
      const wrU = reflectAbout(woU, wm);
      if (wrU[2] <= 0) return null;
      const wi: V = [wrU[0], wrU[1], -s * wrU[2]]; // mirror to the far hemisphere
      const { value, pdf } = thinWalledEval(w, wi, a, ior, t);
      if (pdf <= 0) return null;
      return { wi, value, pdf, specular: false };
    },
  };
}

// --- combined OpenPBR-style surface -----------------------------------------

export interface SurfaceParams {
  readonly baseColor: Vec3;
  readonly metalness: number;
  readonly roughness: number;
  readonly transmission: number;
  readonly subsurface: number;
  readonly ior: number;
  readonly specular: number;
}

interface WeightedLobe {
  weight: number;
  lobe: Lobe;
}

/**
 * Compose a set of weighted lobes into a single one-sample multi-lobe BSDF. Each
 * lobe conserves energy and the weights partition the surface, so the combined
 * reflectance stays bounded while the combined pdf = sum(selectProb_k * pdf_k)
 * keeps importance sampling coherent with evaluation (one-sample MIS). This is
 * the shared stack sampler used by both the fixed seven-parameter surface and
 * the layered closure (T054).
 */
export function composeLobes(input: readonly WeightedLobe[]): Lobe {
  const entries = input.filter((e) => e.weight > 0);
  const total = entries.reduce((s, e) => s + e.weight, 0);

  function combinedEval(wo: V, wi: V): BsdfEval {
    let value: V = [0, 0, 0];
    let pdf = 0;
    if (total <= 0) return { value, pdf };
    for (const e of entries) {
      const r = e.lobe.eval(wo, wi);
      value = add(value, scale(r.value, e.weight));
      pdf += (e.weight / total) * r.pdf;
    }
    return { value, pdf };
  }

  return {
    eval: (wo, wi) => combinedEval(wo as V, wi as V),
    sample(wo, rng) {
      if (total <= 0 || (wo as V)[2] === 0) return null;
      let pick = rng() * total;
      let chosen = entries[entries.length - 1]!;
      for (const e of entries) {
        if (pick < e.weight) {
          chosen = e;
          break;
        }
        pick -= e.weight;
      }
      const s = chosen.lobe.sample(wo as V, rng);
      if (!s) return null;
      const { value, pdf } = combinedEval(wo as V, s.wi as V);
      if (pdf <= 0) return null;
      return { wi: s.wi, value, pdf, specular: false };
    },
  };
}

/**
 * One-sample multi-lobe surface BSDF built from the already-validated lobes. The
 * lobe weights partition unity (metal + dielectric-with-transmission + diffuse),
 * and each lobe conserves energy, so the surface stays energy-conserving while
 * the combined pdf = sum(selectProb_k * pdf_k) keeps sampling coherent with
 * evaluation. The specular dielectric is a coat over the diffuse base; the
 * subsurface weight folds into the diffuse base (documented raster-grade
 * approximation -- true BSSRDF sampling lives in subsurface.ts, T029).
 */
export function surfaceBsdf(params: SurfaceParams): Lobe {
  const metal = clamp01(params.metalness);
  const trans = clamp01(params.transmission);
  const specStrength = clamp01(params.specular);
  const dielectricShare = (1 - metal) * (1 - trans);
  return composeLobes([
    { weight: metal, lobe: conductorLobe(params.baseColor, params.roughness) },
    { weight: (1 - metal) * trans, lobe: translucentLobe(params.baseColor) },
    { weight: dielectricShare * specStrength, lobe: dielectricLobe(params.ior, params.roughness) },
    { weight: dielectricShare, lobe: lambertLobe(params.baseColor) },
  ]);
}

/**
 * Build the sample-capable lobe for one layered-closure BSDF lobe, or null when
 * the lobe has no importance sampler yet. The diffuse families share the cosine
 * sampler (their directional Burley / Oren-Nayar detail is a T056 refinement);
 * conductor and generalized-schlick use coloured-F0 GGX reflection; the
 * dielectric reflection uses achromatic GGX from the index of refraction; both
 * switch to the anisotropic GGX core when the lobe carries anisotropy > 0
 * (T056c). When a thin-film layer is supplied, the conductor and dielectric
 * specular lobes use the Airy-modulated Fresnel instead (T056f); an inactive film
 * (weight 0 or thickness 0) yields the nominal lobe byte-for-byte. translucent is
 * the diffuse-transmission lobe; dielectric_transmission is the specular glass
 * BTDF (refractive, or thin-walled when l.thinWalled is set, T056e). Sheen uses
 * the Charlie lobe (T056b); subsurface uses the BSSRDF diffuse lobe wired on the
 * random walk of subsurface.ts (T056g).
 */
export function lobeFromLayered(l: LayeredBsdfLobe, film?: ThinFilmLayer): Lobe | null {
  const roughness = l.roughness ?? 0;
  const aniso = l.anisotropy ?? 0;
  const rotation = l.rotation ?? 0;
  switch (l.kind) {
    case 'oren_nayar_diffuse':
    case 'burley_diffuse':
      return lambertLobe(l.color);
    case 'translucent':
      return translucentLobe(l.color);
    case 'conductor':
    case 'generalized_schlick':
      return film
        ? conductorThinFilmLobe(l.color, roughness, aniso, rotation, film)
        : aniso > 0
          ? conductorAnisoLobe(l.color, roughness, aniso, rotation)
          : conductorLobe(l.color, roughness);
    case 'dielectric_reflection':
      return film
        ? dielectricThinFilmLobe(l.ior ?? 1.5, roughness, aniso, rotation, film)
        : aniso > 0
          ? dielectricAnisoLobe(l.ior ?? 1.5, roughness, aniso, rotation)
          : dielectricLobe(l.ior ?? 1.5, roughness);
    case 'dielectric_transmission':
      return l.thinWalled
        ? thinWalledTransmissionLobe(l.color, roughness, l.ior ?? 1.5)
        : dielectricTransmissionLobe(l.color, roughness, l.ior ?? 1.5);
    case 'sheen':
      return sheenLobe(l.color, l.roughness ?? 0.3);
    case 'subsurface':
      return subsurfaceLobe(l.color);
  }
}

/**
 * Layer a dielectric coat over an already-composed base lobe (T056d). The coat
 * reflects via the dielectric GGX lobe weighted by its presence; the base is
 * attenuated by the two Fresnel crossings and a coloured, view-dependent
 * MaterialX coat tint on the substrate. Coat weight 0
 * returns the base untouched -- the non-regression anchor. Sampling is a two-way
 * one-sample MIS (coat vs base) whose selection probability matches the composed
 * pdf, so the estimator stays unbiased.
 */
function coatOverBase(coat: CoatLayer, base: Lobe): Lobe {
  const coatW = clamp01(coat.weight);
  if (coatW <= 0) return base;
  const coatLobe = dielectricLobe(coat.ior, coat.roughness);
  const f0 = dielectricF0(coat.ior);
  const schlick = (c: number): number => f0 + (1 - f0) * Math.pow(clamp01(1 - c), 5);
  const coatProbability = (wo: V): number => Math.min(coatW * schlick(wo[2]), 0.95);
  const attenuation = (wo: V, wi: V): V => {
    const att = (1 - coatW * schlick(wo[2])) * (1 - coatW * schlick(wi[2]));
    return [
      att * (1 - coatW + coatW * coat.color[0]),
      att * (1 - coatW + coatW * coat.color[1]),
      att * (1 - coatW + coatW * coat.color[2]),
    ];
  };
  function ev(wo: V, wi: V): BsdfEval {
    const b = base.eval(wo, wi);
    const c = coatLobe.eval(wo, wi);
    const t = attenuation(wo, wi);
    const value: V = [
      coatW * c.value[0] + t[0] * b.value[0],
      coatW * c.value[1] + t[1] * b.value[1],
      coatW * c.value[2] + t[2] * b.value[2],
    ];
    const pCoat = coatProbability(wo);
    return { value, pdf: pCoat * c.pdf + (1 - pCoat) * b.pdf };
  }
  return {
    eval: (wo, wi) => ev(wo as V, wi as V),
    sample(wo, rng) {
      const w = wo as V;
      if (w[2] <= 0) return null;
      const s = rng() < coatProbability(w) ? coatLobe.sample(w, rng) : base.sample(w, rng);
      if (!s) return null;
      const { value, pdf } = ev(w, s.wi as V);
      if (pdf <= 0) return null;
      return { wi: s.wi, value, pdf, specular: false };
    },
  };
}

function fuzzOverBase(fuzz: NonNullable<LayeredClosure['fuzz']>, base: Lobe): Lobe {
  const fuzzW = clamp01(fuzz.weight);
  if (fuzzW <= 0) return base;
  const top = fuzzLobe(fuzz.color, fuzz.roughness);
  const coverage = (wo: V) => wo[2] > 0 ? fuzzW * fuzzDirectionalAlbedo(wo[2], fuzz.roughness) : 0;
  function ev(wo: V, wi: V): BsdfEval {
    const f = top.eval(wo, wi);
    const b = base.eval(wo, wi);
    const p = coverage(wo);
    return {
      value: [
        fuzzW * f.value[0] + (1 - p) * b.value[0],
        fuzzW * f.value[1] + (1 - p) * b.value[1],
        fuzzW * f.value[2] + (1 - p) * b.value[2],
      ],
      pdf: p * f.pdf + (1 - p) * b.pdf,
    };
  }
  return {
    eval: (wo, wi) => ev(wo as V, wi as V),
    sample(wo, rng) {
      const w = wo as V;
      const fuzzProb = coverage(w);
      let sample: BsdfSampleLocal | null;
      if (fuzzProb > 0 && rng() < fuzzProb) {
        sample = top.sample(w, rng);
      } else {
        sample = base.sample(w, rng);
      }
      if (!sample) return null;
      const { value, pdf } = ev(w, sample.wi as V);
      if (pdf <= 0) return null;
      return { wi: sample.wi, value, pdf, specular: false };
    },
  };
}

/**
 * Sample-capable surface BSDF for a lowered LayeredClosure (T054). The base lobe
 * stack is composed with the shared one-sample MIS sampler; a thin-film layer
 * (T056f) modulates the specular lobes' Fresnel with Airy interference; sheen
 * stays in the base stack. Coat wraps that stack, then the OpenPBR Zeltner fuzz
 * layer attenuates the substrate by its directional albedo.
 * A closure produced by canonicalSurfaceToLayered has no coat, sheen, fuzz or thin
 * film, so it reproduces surfaceBsdf exactly -- the non-regression anchor for the
 * layered model.
 */
export function layeredSurfaceBsdf(closure: LayeredClosure, channel: 0 | 1 | 2 = 1): Lobe {
  const film = closure.thinFilm;
  const entries: WeightedLobe[] = [];
  for (const l of closure.lobes) {
    const spectral = l.kind === 'dielectric_transmission' && !l.thinWalled && (l.dispersion ?? 0) > 0
      ? { ...l, ior: dispersionIor(l.ior ?? 1.5, l.dispersion ?? 0, channel) }
      : l;
    const lobe = lobeFromLayered(spectral, film);
    if (lobe) entries.push({ weight: l.weight, lobe });
  }
  if (closure.sheen && closure.sheen.weight > 0) {
    entries.push({ weight: closure.sheen.weight, lobe: sheenLobe(closure.sheen.color, closure.sheen.roughness) });
  }
  const base = composeLobes(entries);
  const coated = closure.coat ? coatOverBase(closure.coat, base) : base;
  return closure.fuzz ? fuzzOverBase(closure.fuzz, coated) : coated;
}

// --- hemispherical reflectance (energy / unbiasedness checks) ----------------

/**
 * Directional albedo rho(wo) = integral over the sphere of f(wo,wi)*|cos| via
 * BSDF importance sampling. For an energy-conserving lobe rho <= 1. Reflection
 * lobes integrate the upper hemisphere; the translucent lobe the lower one.
 */
export function hemisphericalReflectance(lobe: Lobe, wo: Vec3, rng: Rng, samples: number): Vec3 {
  let acc: V = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < samples; i++) {
    const s = lobe.sample(wo, rng);
    n++;
    if (!s || s.pdf <= 0) continue;
    acc = add(acc, scale(s.value, Math.abs(s.wi[2]) / s.pdf));
  }
  return n > 0 ? scale(acc, 1 / n) : [0, 0, 0];
}

// --- world-space adapters ----------------------------------------------------

/** Branchless orthonormal basis (Duff et al. 2017) around a unit normal. */
export function shadingFrame(n: Vec3): [Vec3, Vec3] {
  const s = n[2] >= 0 ? 1 : -1;
  const a = -1 / (s + n[2]);
  const b = n[0] * n[1] * a;
  return [
    [1 + s * n[0] * n[0] * a, s * b, -s * n[0]],
    [b, s + n[1] * n[1] * a, -n[1]],
  ];
}

function toLocal(v: V, t: V, b: V, n: V): V {
  return [dot(v, t), dot(v, b), dot(v, n)];
}

function toWorld(v: V, t: V, b: V, n: V): V {
  return [
    v[0] * t[0] + v[1] * b[0] + v[2] * n[0],
    v[0] * t[1] + v[1] * b[1] + v[2] * n[1],
    v[0] * t[2] + v[1] * b[2] + v[2] * n[2],
  ];
}

/** Evaluate a lobe for world-space directions around a world-space normal. */
export function evalWorld(lobe: Lobe, n: Vec3, woWorld: Vec3, wiWorld: Vec3): BsdfEval {
  const [t, b] = shadingFrame(n);
  return lobe.eval(toLocal(woWorld as V, t as V, b as V, n as V), toLocal(wiWorld as V, t as V, b as V, n as V));
}

export interface WorldBsdfSample {
  direction: Vec3;
  value: Vec3;
  pdf: number;
  specular: boolean;
}

/** Sample a lobe in world space; returns a world-space scattering direction. */
export function sampleWorld(lobe: Lobe, n: Vec3, woWorld: Vec3, rng: Rng): WorldBsdfSample | null {
  const [t, b] = shadingFrame(n);
  const s = lobe.sample(toLocal(woWorld as V, t as V, b as V, n as V), rng);
  if (!s) return null;
  return {
    direction: toWorld(s.wi as V, t as V, b as V, n as V),
    value: s.value,
    pdf: s.pdf,
    specular: s.specular,
  };
}

export const __testing = { ggxNdf, smithG1, fresnelSchlick, alphaOf, mul };
