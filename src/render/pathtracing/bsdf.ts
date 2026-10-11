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
  const entries: WeightedLobe[] = [
    { weight: metal, lobe: conductorLobe(params.baseColor, params.roughness) },
    { weight: (1 - metal) * trans, lobe: translucentLobe(params.baseColor) },
    { weight: dielectricShare * specStrength, lobe: dielectricLobe(params.ior, params.roughness) },
    { weight: dielectricShare * (1 - specStrength), lobe: lambertLobe(params.baseColor) },
  ].filter((e) => e.weight > 0);
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
      if (total <= 0 || (wo as V)[2] <= 0) return null;
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
