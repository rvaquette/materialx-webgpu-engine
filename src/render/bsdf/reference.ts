// Independent CPU analytic reference for the MaterialX BSDF/EDF/VDF closures (T041).
//
// This module re-implements, in plain TypeScript, the same physical formulas the
// WGSL lobes in src/compiler/nodes.ts evaluate (GGX/Trowbridge-Reitz microfacet,
// Smith masking-shadowing, Schlick and unpolarized conductor Fresnel, Oren-Nayar
// and Burley diffuse, Charlie sheen, wrap-diffuse subsurface, Henyey-Greenstein
// volume phase). It is a deliberately SEPARATE implementation -- it never imports
// or parses the generated WGSL -- so it can serve as a non-circular oracle for the
// device/CPU comparisons in T042/T043.
//
// Lighting semantics mirror src/gpu/exec.ts packLighting: each light carries a
// scene-convention travel direction (L = normalize(-direction)), an intensity and
// a color (radiance = color * intensity); `environment` is a constant ambient
// radiance added once per lobe.

export type Vec3 = readonly [number, number, number];

export interface ReferenceLight {
  /** Direction the light travels (scene convention); L = normalize(-direction). */
  direction: Vec3;
  color: Vec3;
  intensity: number;
}

export interface ReferenceLighting {
  /** Constant environment/ambient radiance. */
  environment: Vec3;
  lights: readonly ReferenceLight[];
}

/** Shading frame: unit normal N and unit view direction V (surface -> eye). */
export interface ShadingGeometry {
  normal: Vec3;
  view: Vec3;
}

/** A closure result: outgoing radiance `color` and reflectance/coverage `weight`. */
export interface ReferenceClosure {
  color: Vec3;
  weight: number;
}

export const MX_PI = Math.PI;

/** Rec.709-ish luminance weights used by the WGSL closure ops. */
export const LUMINANCE_WEIGHTS: Vec3 = [0.2722287, 0.6740818, 0.0536895];

/** Mirrors DEFAULT_LIGHTING in src/gpu/exec.ts. */
export function defaultLighting(): ReferenceLighting {
  return { environment: [0.03, 0.03, 0.03], lights: [{ direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 }] };
}

// --- vector helpers ----------------------------------------------------------

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulv = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clampScalar = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
const clampVec = (a: Vec3, lo: number, hi: number): Vec3 => [clampScalar(a[0], lo, hi), clampScalar(a[1], lo, hi), clampScalar(a[2], lo, hi)];
const maxVec = (a: Vec3, s: number): Vec3 => [Math.max(a[0], s), Math.max(a[1], s), Math.max(a[2], s)];
const divv = (a: Vec3, b: Vec3): Vec3 => [a[0] / b[0], a[1] / b[1], a[2] / b[2]];

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(dot(v, v));
  return len > 0 ? scale(v, 1 / len) : v;
}

export function luminance(c: Vec3): number {
  return dot(c, LUMINANCE_WEIGHTS);
}

// --- microfacet / Fresnel helpers -------------------------------------------

export function ggxNdf(NdotH: number, a: number): number {
  const a2 = a * a;
  const d = NdotH * NdotH * (a2 - 1) + 1;
  return a2 / Math.max(MX_PI * d * d, 1e-7);
}

export function smithG1(NdotX: number, a: number): number {
  const a2 = a * a;
  return (2 * NdotX) / Math.max(NdotX + Math.sqrt(a2 + (1 - a2) * NdotX * NdotX), 1e-7);
}

export function fresnelSchlick(F0: Vec3, cosTheta: number): Vec3 {
  const f = Math.pow(clampScalar(1 - cosTheta, 0, 1), 5);
  return [F0[0] + (1 - F0[0]) * f, F0[1] + (1 - F0[1]) * f, F0[2] + (1 - F0[2]) * f];
}

export function fresnelSchlickF90(F0: Vec3, F90: Vec3, cosTheta: number): Vec3 {
  const f = Math.pow(clampScalar(1 - cosTheta, 0, 1), 5);
  return [F0[0] + (F90[0] - F0[0]) * f, F0[1] + (F90[1] - F0[1]) * f, F0[2] + (F90[2] - F0[2]) * f];
}

export function fresnelConductor(n: Vec3, k: Vec3, cosTheta: number): Vec3 {
  const c = clampScalar(cosTheta, 0, 1);
  const c2 = c * c;
  const out: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const n2k2 = n[i]! * n[i]! + k[i]! * k[i]!;
    const twoNc = 2 * n[i]! * c;
    const rs = (n2k2 - twoNc + c2) / (n2k2 + twoNc + c2);
    const rp = (n2k2 * c2 - twoNc + 1) / (n2k2 * c2 + twoNc + 1);
    out[i] = clampScalar(0.5 * (rs + rp), 0, 1);
  }
  return [out[0]!, out[1]!, out[2]!];
}

export function sheenNdf(NdotH: number, r: number): number {
  const inv = 1 / Math.max(r, 1e-3);
  const sin2 = Math.max(1 - NdotH * NdotH, 0);
  return ((2 + inv) * Math.pow(sin2, inv * 0.5)) / (2 * MX_PI);
}

/** GGX specular reflection integrand F * D * G / (4 * NdotV), guarded like the WGSL. */
export function ggxReflection(F: Vec3, a: number, N: Vec3, V: Vec3, L: Vec3): Vec3 {
  const NdotL = Math.max(dot(N, L), 0);
  const NdotV = Math.max(dot(N, V), 0);
  if (NdotL <= 0 || NdotV <= 0) return [0, 0, 0];
  const H = normalize(add(L, V));
  const NdotH = Math.max(dot(N, H), 0);
  const D = ggxNdf(NdotH, a);
  const G = smithG1(NdotL, a) * smithG1(NdotV, a);
  return scale(F, (D * G) / (4 * NdotV));
}

// --- per-light accumulation --------------------------------------------------

function lightL(light: ReferenceLight): Vec3 {
  return normalize(scale(light.direction, -1));
}

function lightRadiance(light: ReferenceLight): Vec3 {
  return scale(light.color, light.intensity);
}

// --- diffuse lobes -----------------------------------------------------------

export function orenNayarDiffuse(weight: number, color: Vec3, roughness: number, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N, view: V } = geom;
  const sigma2 = clampScalar(roughness, 0, 1) * clampScalar(roughness, 0, 1);
  const A = 1 - (0.5 * sigma2) / (sigma2 + 0.33);
  const B = (0.45 * sigma2) / (sigma2 + 0.09);
  const NdotV = Math.max(dot(N, V), 1e-4);
  let acc = mulv(color, lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const NdotL = Math.max(dot(N, L), 0);
    if (NdotL <= 0) continue;
    const s = dot(L, V) - dot(N, L) * dot(N, V);
    const t = s > 0 ? Math.max(NdotL, NdotV) : 1;
    acc = add(acc, mulv(scale(color, ((A + (B * s) / t) * NdotL) / MX_PI), radiance));
  }
  return { color: scale(acc, weight), weight };
}

export function burleyDiffuse(weight: number, color: Vec3, roughness: number, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N, view: V } = geom;
  const NdotV = Math.max(dot(N, V), 1e-4);
  let acc = mulv(color, lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const NdotL = Math.max(dot(N, L), 0);
    if (NdotL <= 0) continue;
    const H = normalize(add(L, V));
    const LdotH = Math.max(dot(L, H), 0);
    const fd90 = 0.5 + 2 * roughness * LdotH * LdotH;
    const fl = Math.pow(1 - NdotL, 5);
    const fv = Math.pow(1 - NdotV, 5);
    const fd = (1 + (fd90 - 1) * fl) * (1 + (fd90 - 1) * fv);
    acc = add(acc, mulv(scale(color, (fd * NdotL) / MX_PI), radiance));
  }
  return { color: scale(acc, weight), weight };
}

export function translucent(weight: number, color: Vec3, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N } = geom;
  let acc = mulv(color, lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const NdotL = Math.max(dot(scale(N, -1), L), 0);
    acc = add(acc, mulv(scale(color, NdotL / MX_PI), radiance));
  }
  return { color: scale(acc, weight), weight };
}

// --- specular / microfacet lobes --------------------------------------------

export function dielectric(weight: number, tint: Vec3, ior: number, roughness: number, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N, view: V } = geom;
  const a = Math.max(roughness * roughness, 1e-3);
  const r = (ior - 1) / (ior + 1);
  const f0 = clampScalar(r * r, 0, 1);
  const F0: Vec3 = [f0, f0, f0];
  let acc = scale(mulv(tint, lighting.environment), f0);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const H = normalize(add(L, V));
    const VdotH = Math.max(dot(V, H), 0);
    const F = fresnelSchlick(F0, VdotH);
    acc = add(acc, mulv(mulv(tint, ggxReflection(F, a, N, V, L)), radiance));
  }
  return { color: scale(acc, weight), weight };
}

export function conductor(weight: number, ior: Vec3, extinction: Vec3, roughness: number, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N, view: V } = geom;
  const a = Math.max(roughness * roughness, 1e-3);
  let acc = mulv(fresnelConductor(ior, extinction, 1), lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const H = normalize(add(L, V));
    const VdotH = Math.max(dot(V, H), 0);
    const F = fresnelConductor(ior, extinction, VdotH);
    acc = add(acc, mulv(ggxReflection(F, a, N, V, L), radiance));
  }
  return { color: scale(acc, weight), weight };
}

export function generalizedSchlick(weight: number, color0: Vec3, color90: Vec3, roughness: number, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N, view: V } = geom;
  const a = Math.max(roughness * roughness, 1e-3);
  let acc = mulv(color0, lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const H = normalize(add(L, V));
    const VdotH = Math.max(dot(V, H), 0);
    const F = fresnelSchlickF90(color0, color90, VdotH);
    acc = add(acc, mulv(ggxReflection(F, a, N, V, L), radiance));
  }
  return { color: scale(acc, weight), weight };
}

export function sheen(weight: number, color: Vec3, roughness: number, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N, view: V } = geom;
  const r = clampScalar(roughness, 1e-3, 1);
  const NdotV = Math.max(dot(N, V), 1e-4);
  let acc = mulv(color, lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const NdotL = Math.max(dot(N, L), 0);
    if (NdotL <= 0) continue;
    const H = normalize(add(L, V));
    const NdotH = Math.max(dot(N, H), 0);
    const D = sheenNdf(NdotH, r);
    const vis = 1 / (4 * (NdotL + NdotV - NdotL * NdotV));
    acc = add(acc, mulv(scale(color, D * vis * NdotL), radiance));
  }
  return { color: scale(acc, weight), weight };
}

/** Wrap-diffuse raster approximation of subsurface (radius unused, as in the WGSL). */
export function subsurface(weight: number, color: Vec3, _radius: Vec3, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { normal: N } = geom;
  const wrap = 0.5;
  let acc = mulv(color, lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const wrapped = Math.max((dot(N, L) + wrap) / (1 + wrap), 0);
    acc = add(acc, mulv(scale(color, wrapped / MX_PI), radiance));
  }
  return { color: scale(acc, weight), weight };
}

// --- emission (EDF) ----------------------------------------------------------

export function uniformEdf(color: Vec3): ReferenceClosure {
  return { color, weight: 0 };
}

export function generalizedSchlickEdf(color0: Vec3, color90: Vec3, geom: ShadingGeometry): ReferenceClosure {
  const NdotV = clampScalar(dot(geom.normal, geom.view), 0, 1);
  const f = Math.pow(1 - NdotV, 5);
  return { color: add(color0, scale(sub(color90, color0), f)), weight: 0 };
}

// --- volume (VDF) ------------------------------------------------------------

/** Raster single-scattering approximation of a volume at unit optical depth. */
export function anisotropicVdf(absorption: Vec3, scattering: Vec3, anisotropy: number, geom: ShadingGeometry, lighting: ReferenceLighting): ReferenceClosure {
  const { view: V } = geom;
  const extinction = maxVec(add(absorption, scattering), 1e-4);
  const albedo = clampVec(divv(scattering, extinction), 0, 1);
  const g = clampScalar(anisotropy, -0.99, 0.99);
  const g2 = g * g;
  let acc = mulv(albedo, lighting.environment);
  for (const light of lighting.lights) {
    const L = lightL(light);
    const radiance = lightRadiance(light);
    const cosTheta = dot(scale(L, -1), V);
    const denom = Math.pow(Math.max(1 + g2 - 2 * g * cosTheta, 1e-4), 1.5);
    const phase = (1 - g2) / (4 * MX_PI * denom);
    acc = add(acc, mulv(scale(albedo, phase), radiance));
  }
  return { color: acc, weight: clampScalar(luminance(albedo), 0, 1) };
}

// --- energetic composition (mirrors the CLOSURE_PRELUDE ops, T040) -----------

export function closureZero(): ReferenceClosure {
  return { color: [0, 0, 0], weight: 0 };
}

export function closureAdd(a: ReferenceClosure, b: ReferenceClosure): ReferenceClosure {
  return { color: add(a.color, b.color), weight: Math.min(a.weight + b.weight, 1) };
}

export function closureMul(a: ReferenceClosure, w: Vec3): ReferenceClosure {
  return { color: mulv(a.color, w), weight: a.weight * clampScalar(luminance(w), 0, 1) };
}

export function closureMix(a: ReferenceClosure, b: ReferenceClosure, t: number): ReferenceClosure {
  return { color: add(scale(a.color, 1 - t), scale(b.color, t)), weight: a.weight * (1 - t) + b.weight * t };
}

export function layer(top: ReferenceClosure, base: ReferenceClosure): ReferenceClosure {
  const t = clampScalar(top.weight, 0, 1);
  return { color: add(top.color, scale(base.color, 1 - t)), weight: t + base.weight * (1 - t) };
}
