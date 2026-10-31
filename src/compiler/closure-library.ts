// T056a: the SHARED runtime closure library. A single WGSL string that both
// backends consume (path tracer in T057, raster in T058) instead of the three
// drifted inline copies (nodes.ts, pathtracing/compute.ts, raster/shaders.ts).
// Each lobe exposes the coherent triplet the Monte Carlo estimator needs:
//   mx_<lobe>_eval(ctx, wi)   -> MxBsdfEval { value: f(wo,wi), pdf }
//   mx_<lobe>_pdf(ctx, wi)    -> f32  (solid-angle pdf, matches eval)
//   mx_<lobe>_sample(ctx, u2) -> MxBsdfSample { wi, value, pdf, valid }
// Everything works in a local shading frame (+Z = normal); world-space adapters
// stay in each backend. This file ports the four isotropic lobes that already
// agree across the three copies -- diffuse (Lambert cosine, shared by the two
// diffuse kinds until their directional detail lands), translucent (diffuse
// transmission), dielectric_reflection (achromatic GGX) and conductor (coloured
// GGX). The formulas mirror the CPU oracle src/render/pathtracing/bsdf.ts
// EXACTLY, so eval/pdf are numerically identical; device parity is checked in
// T059. T056b adds the Charlie sheen lobe (cosine sampled). T056c extends the
// two specular lobes with anisotropic GGX (alpha_u/alpha_v from anisotropy plus
// a tangent rotation); anisotropy <= 0 takes the isotropic path unchanged. T056d
// adds the dielectric coat layering helpers (view-dependent darkening and
// coloured absorption the base receives under a clearcoat). T056e adds the
// dielectric transmission lobe (Walter microfacet BTDF: Snell refraction with the
// 1/eta^2 radiance compression, plus a thin-walled straight-through variant). T056f
// adds the thin-film Airy helpers (angle-correct spectral interference collapsed to
// an RGB Fresnel modulation). T056g adds the subsurface lobe (BSSRDF random walk
// collapsed to its optically-thick cosine-diffuse response). T056h adds the full-
// stack assembler (mx_closure_eval/pdf/sample over the LayeredClosure emitted by
// surface-wgsl.ts: weighted lobe selection, coat/sheen/fuzz/thin-film layering,
// one-sample MIS mirroring composeLobes + coatOverBase) and has the surface
// module emit this library so both backends call one identical source.

import { HAIR_WGSL } from '../render/bsdf/hair.ts';

/** The lobe families in the library; each has an eval/pdf/sample fn. T056a ported
 *  the four isotropic families; T056b adds the Charlie sheen lobe. */
export const CLOSURE_LIBRARY_LOBES = [
  'diffuse',
  'translucent',
  'dielectric_reflection',
  'dielectric_transmission',
  'conductor',
  'sheen',
  'subsurface',
] as const;

export type ClosureLibraryLobe = (typeof CLOSURE_LIBRARY_LOBES)[number];

/** The three WGSL function names a lobe exposes. */
export interface LobeFns {
  eval: string;
  pdf: string;
  sample: string;
  sampleInputType: 'vec2f' | 'vec3f';
}

/** Map a lobe family to its eval/pdf/sample WGSL function names. */
export function lobeFns(lobe: ClosureLibraryLobe): LobeFns {
  return {
    eval: `mx_${lobe}_eval`,
    pdf: `mx_${lobe}_pdf`,
    sample: `mx_${lobe}_sample`,
    sampleInputType: lobe === 'dielectric_transmission' ? 'vec3f' : 'vec2f',
  };
}

/** Shared math helper functions declared by the library prelude. */
export const CLOSURE_LIBRARY_HELPERS = [
  'mx_ggx_ndf',
  'mx_smith_g1',
  'mx_fresnel_schlick',
  'mx_alpha_of',
  'mx_dielectric_f0',
  'mx_cosine_hemisphere',
  'mx_sample_ggx_normal',
  'mx_sheen_ndf',
  'mx_microfacet_eval',
  'mx_microfacet_pdf',
  'mx_microfacet_sample',
  'mx_aniso_alphas',
  'mx_rotate_tangent',
  'mx_ggx_ndf_aniso',
  'mx_smith_g1_aniso',
  'mx_sample_ggx_normal_aniso',
  'mx_microfacet_eval_aniso',
  'mx_microfacet_pdf_aniso',
  'mx_microfacet_sample_aniso',
  'mx_coat_fresnel',
  'mx_coat_attenuation',
  'mx_fresnel_dielectric',
  'mx_refract_microfacet',
  'mx_fresnel_s',
  'mx_fresnel_p',
  'mx_airy',
  'mx_thin_film_reflectance',
  'mx_thin_film_channel',
  'mx_thin_film_tint',
  'mx_thin_film_fresnel',
  'mx_microfacet_eval_tf',
  'mx_microfacet_eval_aniso_tf',
] as const;

/** Lobe kinds (MX_LOBE_* values) a closure dispatch may reach, plus whether thin film can be active. */
export interface ClosureDispatchSpec {
  kinds: ReadonlySet<number>;
  thinFilm: boolean;
}

const ALL_DISPATCH: ClosureDispatchSpec = { kinds: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), thinFilm: true };

/** mx_closure_lobe_eval/sample restricted to `spec`; unreachable kinds fall to the zero default. */
function lobeDispatch(spec: ClosureDispatchSpec): string {
  const has = (...kinds: number[]) => kinds.filter((k) => spec.kinds.has(k));
  const label = (kinds: number[]) => kinds.map((k) => `${k}u`).join(', ');
  const evalCases: string[] = [];
  const sampleCases: string[] = [];
  const diffuse = has(0, 1);
  if (diffuse.length) {
    evalCases.push(`    case ${label(diffuse)}: { return mx_diffuse_eval(ctx, wi); }`);
    sampleCases.push(`    case ${label(diffuse)}: { return mx_diffuse_sample(ctx, u.xy); }`);
  }
  if (has(2).length) {
    evalCases.push('    case 2u: { return mx_translucent_eval(ctx, wi); }');
    sampleCases.push('    case 2u: { return mx_translucent_sample(ctx, u.xy); }');
  }
  if (has(3).length) {
    evalCases.push(spec.thinFilm ? `    case 3u: {
      let f0 = vec3f(mx_dielectric_f0(lobe.ior));
      if (filmActive) {
        if (lobe.anisotropy <= 0.0) { return mx_microfacet_eval_tf(wo, wi, mx_alpha_of(lobe.roughness), f0, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior); }
        return mx_microfacet_eval_aniso_tf(wo, wi, mx_aniso_alphas(lobe.roughness, lobe.anisotropy), lobe.rotation, f0, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior);
      }
      return mx_dielectric_reflection_eval(ctx, wi);
    }` : '    case 3u: { return mx_dielectric_reflection_eval(ctx, wi); }');
    sampleCases.push('    case 3u: { return mx_dielectric_reflection_sample(ctx, u.xy); }');
  }
  const conductor = has(4, 5);
  if (conductor.length) {
    evalCases.push(spec.thinFilm ? `    case ${label(conductor)}: {
      if (filmActive) {
        if (lobe.anisotropy <= 0.0) { return mx_microfacet_eval_tf(wo, wi, mx_alpha_of(lobe.roughness), lobe.color, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior); }
        return mx_microfacet_eval_aniso_tf(wo, wi, mx_aniso_alphas(lobe.roughness, lobe.anisotropy), lobe.rotation, lobe.color, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior);
      }
      return mx_conductor_eval(ctx, wi);
    }` : `    case ${label(conductor)}: { return mx_conductor_eval(ctx, wi); }`);
    sampleCases.push(`    case ${label(conductor)}: { return mx_conductor_sample(ctx, u.xy); }`);
  }
  if (has(6).length) {
    evalCases.push('    case 6u: { return mx_sheen_eval(ctx, wi); }');
    sampleCases.push('    case 6u: { return mx_sheen_sample(ctx, u.xy); }');
  }
  if (has(7).length) {
    evalCases.push('    case 7u: { return mx_subsurface_eval(ctx, wi); }');
    sampleCases.push('    case 7u: { return mx_subsurface_sample(ctx, u.xy); }');
  }
  if (has(8).length) {
    evalCases.push('    case 8u: { return mx_dielectric_transmission_eval(ctx, wi); }');
    sampleCases.push('    case 8u: { return mx_dielectric_transmission_sample(ctx, u); }');
  }
  if (has(9).length) {
    evalCases.push('    case 9u: { return mx_hair_eval(lobe, wo, wi); }');
    sampleCases.push('    case 9u: { return mx_hair_sample(lobe, wo, u); }');
  }
  const film = spec.thinFilm ? '\n  let filmActive = c.hasThinFilm != 0u && c.thinFilm.weight > 0.0 && c.thinFilm.thickness > 0.0;' : '';
  return `fn mx_closure_lobe_eval(lobe: MxBsdfLobe, c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let ctx = mx_closure_lobe_ctx(lobe, wo);${film}
  switch (lobe.kind) {
${[...evalCases, '    default: { return MxBsdfEval(vec3f(0.0), 0.0); }'].join('\n')}
  }
}
fn mx_closure_lobe_sample(lobe: MxBsdfLobe, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let ctx = mx_closure_lobe_ctx(lobe, wo);
  switch (lobe.kind) {
${[...sampleCases, '    default: { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }'].join('\n')}
  }
}`;
}

/** The closure library with its lobe dispatch restricted to the kinds a surface can reach. */
export function closureLibraryPrelude(spec: ClosureDispatchSpec = ALL_DISPATCH): string {
  if (spec === ALL_DISPATCH) return CLOSURE_LIBRARY_PRELUDE;
  const code = CLOSURE_LIBRARY_PRELUDE.replace(lobeDispatch(ALL_DISPATCH), lobeDispatch(spec));
  return spec.kinds.has(9) ? code : code.replace(HAIR_WGSL, '');
}

/** WGSL prelude: shared BSDF types, math helpers and the lobe triplets, plus the
 *  T056h full-stack assembler. The lobe library is self-contained (defines MX_PI,
 *  uses only WGSL builtins); the mx_closure_* assembler at the tail references the
 *  LayeredClosure struct family, so it must be emitted AFTER LAYERED_CLOSURE_PRELUDE
 *  (surface-wgsl.ts does this). Consumed by the backends in T057/T058. */
export const CLOSURE_LIBRARY_PRELUDE = `const MX_PI: f32 = 3.14159265358979;

struct MxBsdfEval {
  value: vec3f,
  pdf: f32,
};
struct MxBsdfSample {
  wi: vec3f,
  value: vec3f,
  pdf: f32,
  valid: bool,
};
// Per-lobe context in the local shading frame (+Z = normal). color carries the
// albedo (diffuse/translucent) or the microfacet F0 tint (conductor); ior drives
// the achromatic dielectric F0; roughness is the perceptual value squared into
// the GGX alpha by mx_alpha_of. anisotropy in [0,1] splits the GGX alpha into
// alpha_u/alpha_v (0 = isotropic) and rotation (turns) spins the tangent frame.
struct MxLobeCtx {
  wo: vec3f,
  color: vec3f,
  roughness: f32,
  ior: f32,
  anisotropy: f32,
  rotation: f32,
  thin: f32,
};

fn mx_ggx_ndf(cosH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = cosH * cosH * (a2 - 1.0) + 1.0;
  return a2 / max(MX_PI * d * d, 1.0e-7);
}
fn mx_smith_g1(cosX: f32, a: f32) -> f32 {
  let a2 = a * a;
  return (2.0 * cosX) / max(cosX + sqrt(a2 + (1.0 - a2) * cosX * cosX), 1.0e-7);
}
fn mx_fresnel_schlick(f0: vec3f, cosT: f32) -> vec3f {
  let f = pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  return f0 + (vec3f(1.0) - f0) * f;
}
fn mx_alpha_of(roughness: f32) -> f32 {
  return max(roughness * roughness, 1.0e-3);
}
fn mx_dielectric_f0(ior: f32) -> f32 {
  let r = (ior - 1.0) / (ior + 1.0);
  return r * r;
}
fn mx_cosine_hemisphere(u: vec2f) -> vec3f {
  let r = sqrt(u.x);
  let phi = 2.0 * MX_PI * u.y;
  return vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
}
fn mx_sample_ggx_normal(a: f32, u: vec2f) -> vec3f {
  let phi = 2.0 * MX_PI * u.x;
  let cosT = sqrt((1.0 - u.y) / (1.0 + (a * a - 1.0) * u.y));
  let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  return vec3f(sinT * cos(phi), sinT * sin(phi), cosT);
}
// Charlie sheen distribution (Estevez/Kulla), paired with the Ashikhmin visibility below.
fn mx_sheen_ndf(cosH: f32, roughness: f32) -> f32 {
  let inv = 1.0 / max(roughness, 1.0e-3);
  let sin2 = max(1.0 - cosH * cosH, 0.0);
  return (2.0 + inv) * pow(sin2, inv * 0.5) / (2.0 * MX_PI);
}

// --- diffuse (Lambert cosine): shared by oren_nayar/burley until T056 detail ---
fn mx_diffuse_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  return MxBsdfEval(ctx.color / MX_PI, wi.z / MX_PI);
}
fn mx_diffuse_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  return wi.z / MX_PI;
}
fn mx_diffuse_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_cosine_hemisphere(u);
  return MxBsdfSample(wi, ctx.color / MX_PI, wi.z / MX_PI, true);
}

// --- translucent (diffuse transmission): cosine lobe in the far hemisphere -----
fn mx_translucent_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z >= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  return MxBsdfEval(ctx.color / MX_PI, -wi.z / MX_PI);
}
fn mx_translucent_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z >= 0.0) { return 0.0; }
  return -wi.z / MX_PI;
}
fn mx_translucent_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let h = mx_cosine_hemisphere(u);
  let wi = vec3f(h.x, h.y, -h.z);
  return MxBsdfSample(wi, ctx.color / MX_PI, -wi.z / MX_PI, true);
}

// --- subsurface (BSSRDF optically-thick limit): cosine-diffuse response T056g --
fn mx_subsurface_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  return MxBsdfEval(ctx.color / MX_PI, wi.z / MX_PI);
}
fn mx_subsurface_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  return wi.z / MX_PI;
}
fn mx_subsurface_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_cosine_hemisphere(u);
  return MxBsdfSample(wi, ctx.color / MX_PI, wi.z / MX_PI, true);
}

// --- microfacet core (GGX NDF + separable Smith + Schlick Fresnel) -------------
fn mx_microfacet_eval(wo: vec3f, wi: vec3f, a: f32, f0: vec3f) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm0 = wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wo, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf(wm.z, a);
  let g = mx_smith_g1(wo.z, a) * mx_smith_g1(wi.z, a);
  let f = mx_fresnel_schlick(f0, cosVH);
  let value = f * (d * g / (4.0 * wo.z * wi.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}
fn mx_microfacet_pdf(wo: vec3f, wi: vec3f, a: f32) -> f32 {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  let wm0 = wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return 0.0; }
  let wm = normalize(wm0);
  let cosVH = dot(wo, wm);
  if (cosVH <= 0.0) { return 0.0; }
  return mx_ggx_ndf(wm.z, a) * wm.z / (4.0 * cosVH);
}
fn mx_microfacet_sample(wo: vec3f, a: f32, f0: vec3f, u: vec2f) -> MxBsdfSample {
  if (wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wm = mx_sample_ggx_normal(a, u);
  let wi = reflect(-wo, wm);
  if (wi.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let e = mx_microfacet_eval(wo, wi, a, f0);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}

// --- anisotropic microfacet core (GGX alpha_u/alpha_v + tangent rotation) ------
// alpha.x = alpha_u, alpha.y = alpha_v. With anisotropy 0 the aspect is 1 so
// alpha_u = alpha_v = mx_alpha_of(roughness) and every formula below collapses
// to the isotropic core above (same NDF, Smith term and sampled normal).
fn mx_aniso_alphas(roughness: f32, anisotropy: f32) -> vec2f {
  let base = mx_alpha_of(roughness);
  let aspect = sqrt(1.0 - min(max(anisotropy, 0.0), 0.98));
  return vec2f(min(base / aspect, 1.0), base * aspect);
}
fn mx_rotate_tangent(w: vec3f, rotation: f32) -> vec3f {
  if (rotation == 0.0) { return w; }
  let ang = 2.0 * MX_PI * rotation;
  let c = cos(ang);
  let s = sin(ang);
  return vec3f(w.x * c + w.y * s, -w.x * s + w.y * c, w.z);
}
fn mx_ggx_ndf_aniso(wm: vec3f, alpha: vec2f) -> f32 {
  let t = (wm.x * wm.x) / (alpha.x * alpha.x) + (wm.y * wm.y) / (alpha.y * alpha.y) + wm.z * wm.z;
  return 1.0 / max(MX_PI * alpha.x * alpha.y * t * t, 1.0e-7);
}
fn mx_smith_g1_aniso(w: vec3f, alpha: vec2f) -> f32 {
  let lam = sqrt(alpha.x * alpha.x * w.x * w.x + alpha.y * alpha.y * w.y * w.y + w.z * w.z);
  return (2.0 * w.z) / max(w.z + lam, 1.0e-7);
}
fn mx_sample_ggx_normal_aniso(alpha: vec2f, u: vec2f) -> vec3f {
  let phi = atan2(alpha.y * sin(2.0 * MX_PI * u.x), alpha.x * cos(2.0 * MX_PI * u.x));
  let cosP = cos(phi);
  let sinP = sin(phi);
  let a2 = 1.0 / ((cosP * cosP) / (alpha.x * alpha.x) + (sinP * sinP) / (alpha.y * alpha.y));
  let tan2 = a2 * u.y / max(1.0 - u.y, 1.0e-7);
  let cosT = 1.0 / sqrt(1.0 + tan2);
  let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  return vec3f(sinT * cosP, sinT * sinP, cosT);
}
fn mx_microfacet_eval_aniso(wo: vec3f, wi: vec3f, alpha: vec2f, rotation: f32, f0: vec3f) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wor = mx_rotate_tangent(wo, rotation);
  let wir = mx_rotate_tangent(wi, rotation);
  let wm0 = wor + wir;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wor, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf_aniso(wm, alpha);
  let g = mx_smith_g1_aniso(wor, alpha) * mx_smith_g1_aniso(wir, alpha);
  let f = mx_fresnel_schlick(f0, cosVH);
  let value = f * (d * g / (4.0 * wor.z * wir.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}
fn mx_microfacet_pdf_aniso(wo: vec3f, wi: vec3f, alpha: vec2f, rotation: f32) -> f32 {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  let wor = mx_rotate_tangent(wo, rotation);
  let wir = mx_rotate_tangent(wi, rotation);
  let wm0 = wor + wir;
  if (dot(wm0, wm0) <= 0.0) { return 0.0; }
  let wm = normalize(wm0);
  let cosVH = dot(wor, wm);
  if (cosVH <= 0.0) { return 0.0; }
  return mx_ggx_ndf_aniso(wm, alpha) * wm.z / (4.0 * cosVH);
}
fn mx_microfacet_sample_aniso(wo: vec3f, alpha: vec2f, rotation: f32, f0: vec3f, u: vec2f) -> MxBsdfSample {
  if (wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wor = mx_rotate_tangent(wo, rotation);
  let wm = mx_sample_ggx_normal_aniso(alpha, u);
  let wir = reflect(-wor, wm);
  if (wir.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_rotate_tangent(wir, -rotation);
  let e = mx_microfacet_eval_aniso(wo, wi, alpha, rotation, f0);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}

// --- dielectric_reflection (achromatic GGX from the index of refraction) -------
fn mx_dielectric_reflection_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  let f0 = vec3f(mx_dielectric_f0(ctx.ior));
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_eval(ctx.wo, wi, mx_alpha_of(ctx.roughness), f0);
  }
  return mx_microfacet_eval_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, f0);
}
fn mx_dielectric_reflection_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_pdf(ctx.wo, wi, mx_alpha_of(ctx.roughness));
  }
  return mx_microfacet_pdf_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation);
}
fn mx_dielectric_reflection_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  let f0 = vec3f(mx_dielectric_f0(ctx.ior));
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_sample(ctx.wo, mx_alpha_of(ctx.roughness), f0, u);
  }
  return mx_microfacet_sample_aniso(ctx.wo, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, f0, u);
}

// --- conductor (coloured GGX; color is the F0 tint) ----------------------------
fn mx_conductor_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_eval(ctx.wo, wi, mx_alpha_of(ctx.roughness), ctx.color);
  }
  return mx_microfacet_eval_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, ctx.color);
}
fn mx_conductor_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_pdf(ctx.wo, wi, mx_alpha_of(ctx.roughness));
  }
  return mx_microfacet_pdf_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation);
}
fn mx_conductor_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_sample(ctx.wo, mx_alpha_of(ctx.roughness), ctx.color, u);
  }
  return mx_microfacet_sample_aniso(ctx.wo, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, ctx.color, u);
}

// --- sheen (Charlie NDF + Ashikhmin visibility; cosine-sampled layer lobe) ------
fn mx_sheen_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm0 = ctx.wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let d = mx_sheen_ndf(wm.z, ctx.roughness);
  let vis = 1.0 / (4.0 * (wi.z + ctx.wo.z - wi.z * ctx.wo.z));
  return MxBsdfEval(ctx.color * (d * vis), wi.z / MX_PI);
}
fn mx_sheen_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  return wi.z / MX_PI;
}
fn mx_sheen_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_cosine_hemisphere(u);
  let e = mx_sheen_eval(ctx, wi);
  return MxBsdfSample(wi, e.value, e.pdf, true);
}

// OpenPBR fuzz uses the Zeltner LTC model, not the Charlie sheen above.
fn mx_fuzz_dir_albedo(cosView: f32, roughness: f32) -> f32 {
  let r = clamp(roughness, 0.01, 1.0);
  let sigma = r * (0.0206607 + 1.58491 * r) / (0.0379424 + r * (1.32227 + r));
  let mean = r * (-0.193854 + r * (-1.14885 + r * (1.7932 - 0.95943 * r * r))) / (0.046391 + r);
  let offset = r * (0.000654023 + r * (-0.0207818 + 0.119681 * r)) / (1.26264 + r * (-1.92021 + r));
  let z = (clamp(cosView, 0.0, 1.0) - mean) / sigma;
  return clamp(exp(-0.5 * z * z) / (sigma * sqrt(2.0 * MX_PI)) + offset, 0.0, 1.0);
}
fn mx_fuzz_ltc(cosView: f32, roughness: f32) -> vec2f {
  let v = clamp(cosView, 0.0, 1.0);
  let r = clamp(roughness, 0.01, 1.0);
  let a = r * (2.58126 * v + 0.813703 * r) / (1.0 + 0.310327 * v * v + 2.60994 * v * r);
  let b = sqrt(1.0 - v) * (r - 1.0) * r * r * r / (0.0000254053 + 1.71228 * v - 1.71506 * v * r + 1.34174 * r * r);
  return vec2f(a, b);
}
fn mx_fuzz_tangent(wo: vec3f) -> vec3f {
  let len = length(wo.xy);
  if (len > 0.0) { return vec3f(wo.xy / len, 0.0); }
  return vec3f(1.0, 0.0, 0.0);
}
fn mx_fuzz_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let ab = mx_fuzz_ltc(ctx.wo.z, ctx.roughness);
  let t = mx_fuzz_tangent(ctx.wo);
  let w = vec3f(ab.x * dot(wi, t) + ab.y * wi.z,
    ab.x * dot(wi, vec3f(-t.y, t.x, 0.0)), wi.z);
  let ratio = ab.x / dot(w, w);
  let densityOverCosine = ratio * ratio / MX_PI;
  return MxBsdfEval(ctx.color * (mx_fuzz_dir_albedo(ctx.wo.z, ctx.roughness) * densityOverCosine), wi.z * densityOverCosine);
}
fn mx_fuzz_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let ab = mx_fuzz_ltc(ctx.wo.z, ctx.roughness);
  let t = mx_fuzz_tangent(ctx.wo);
  let cosine = mx_cosine_hemisphere(u);
  let local = normalize(vec3f((cosine.x - ab.y * cosine.z) / ab.x, cosine.y / ab.x, cosine.z));
  let wi = vec3f(t.x * local.x - t.y * local.y, t.y * local.x + t.x * local.y, local.z);
  let e = mx_fuzz_eval(ctx, wi);
  return MxBsdfSample(wi, e.value, e.pdf, e.pdf > 0.0);
}

// --- coat (dielectric clearcoat layered over the base stack) -------------------
// The coat reflection reuses the dielectric GGX lobe (coat ior/roughness via its
// own MxLobeCtx); these helpers supply the view-dependent darkening the base
// receives under the coat. mx_coat_attenuation returns the per-channel factor
// applied to the base value: the two Fresnel crossings (1 - w*F(cosWo)) *
// (1 - w*F(cosWi)) times MaterialX's mix(white, coat_color, coat_weight).
// Coat weight <= 0 returns vec3f(1.0) so the
// base stays untouched. The full coat-over-base composition lands in the T056h
// assembler.
fn mx_coat_fresnel(ior: f32, cosT: f32) -> f32 {
  let f0 = mx_dielectric_f0(ior);
  let f = pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  return f0 + (1.0 - f0) * f;
}
fn mx_coat_attenuation(coatW: f32, ior: f32, color: vec3f, wo: vec3f, wi: vec3f) -> vec3f {
  if (coatW <= 0.0) { return vec3f(1.0); }
  let fo = mx_coat_fresnel(ior, wo.z);
  let fi = mx_coat_fresnel(ior, wi.z);
  let att = (1.0 - coatW * fo) * (1.0 - coatW * fi);
  let absorb = vec3f(1.0 - coatW) + coatW * color;
  return vec3f(att) * absorb;
}

// --- dielectric transmission (BTDF): refraction + thin-walled (T056e) ---------
// Rough dielectric transmission from the Walter 2007 microfacet BTDF, mirroring
// the CPU oracle src/render/pathtracing/bsdf.ts. ctx.thin selects the thin-walled
// branch (straight-through, both sides, mirror of the microfacet reflection) over
// the refractive branch (Snell bending; the eta^2 half-vector Jacobian stays in
// the pdf but not in the radiance-mode value, so value/pdf carries the 1/eta^2
// compression). Both weight by the dielectric Fresnel transmittance (1 - F) and
// the ctx.color transmission tint. The full-stack assembler lands in T056h.
struct MxRefract {
  dir: vec3f,
  valid: bool,
};
fn mx_fresnel_dielectric(cosI: f32, eta: f32) -> f32 {
  let c = abs(cosI);
  let sin2t = (1.0 - c * c) / (eta * eta);
  if (sin2t >= 1.0) { return 1.0; }
  let cosT = sqrt(1.0 - sin2t);
  let rs = (c - eta * cosT) / (c + eta * cosT);
  let rp = (eta * c - cosT) / (eta * c + cosT);
  return 0.5 * (rs * rs + rp * rp);
}
fn mx_refract_microfacet(wo: vec3f, wm: vec3f, invEta: f32) -> MxRefract {
  let cosI = dot(wo, wm);
  let sin2t = invEta * invEta * max(0.0, 1.0 - cosI * cosI);
  if (sin2t >= 1.0) { return MxRefract(vec3f(0.0), false); }
  let cosT = sqrt(1.0 - sin2t);
  return MxRefract(normalize(-invEta * wo + (invEta * cosI - cosT) * wm), true);
}
// Complete smooth dielectric: Fresnel reflection on the same side OR refraction on
// the far side, with total internal reflection folded into the reflection branch.
// The reflect/refract split carries F / (1 - F) in both value and pdf so the one-
// sample estimator is unbiased and energy-conserving (clear glass, no TIR leaks).
fn mx_transmission_refractive_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z == 0.0 || wi.z == 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let a = mx_alpha_of(ctx.roughness);
  let eta = select(1.0 / ctx.ior, ctx.ior, ctx.wo.z > 0.0);
  if (ctx.wo.z * wi.z > 0.0) {
    // Reflection branch (same hemisphere): microfacet mirror weighted by Fresnel F.
    var wm = normalize(ctx.wo + wi);
    if (dot(ctx.wo, wm) < 0.0) { wm = -wm; }
    let dotO = dot(ctx.wo, wm);
    if (dotO <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
    let f = mx_fresnel_dielectric(dotO, eta);
    let d = mx_ggx_ndf(abs(wm.z), a);
    let g = mx_smith_g1(abs(ctx.wo.z), a) * mx_smith_g1(abs(wi.z), a);
    let scalar = f * d * g / (4.0 * abs(ctx.wo.z) * abs(wi.z));
    let pdf = f * d * abs(wm.z) / (4.0 * dotO);
    return MxBsdfEval(vec3f(scalar), pdf);
  }
  // Refraction branch (far hemisphere): Walter BTDF weighted by (1 - F).
  var wm = normalize(ctx.wo + eta * wi);
  if (wm.z < 0.0) { wm = -wm; }
  let dotO = dot(ctx.wo, wm);
  let dotI = dot(wi, wm);
  let denom = dotO + eta * dotI;
  if (abs(denom) < 1.0e-7) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let f = mx_fresnel_dielectric(dotO, eta);
  let d = mx_ggx_ndf(abs(wm.z), a);
  let g = mx_smith_g1(abs(ctx.wo.z), a) * mx_smith_g1(abs(wi.z), a);
  let geomFactor = (abs(dotO) * abs(dotI)) / (abs(ctx.wo.z) * abs(wi.z));
  let scalar = (1.0 - f) * geomFactor * d * g / (denom * denom);
  let pdf = (1.0 - f) * d * abs(wm.z) * eta * eta * abs(dotI) / (denom * denom);
  return MxBsdfEval(ctx.color * scalar, pdf);
}
fn mx_transmission_thin_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z == 0.0 || wi.z == 0.0 || ctx.wo.z * wi.z > 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let a = mx_alpha_of(ctx.roughness);
  let s = select(-1.0, 1.0, ctx.wo.z > 0.0);
  let woU = vec3f(ctx.wo.x, ctx.wo.y, s * ctx.wo.z);
  let wiU = vec3f(wi.x, wi.y, -s * wi.z);
  let wm = normalize(woU + wiU);
  let cosVH = dot(woU, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let f = mx_fresnel_dielectric(cosVH, ctx.ior);
  let d = mx_ggx_ndf(wm.z, a);
  let g = mx_smith_g1(woU.z, a) * mx_smith_g1(wiU.z, a);
  let scalar = (1.0 - f) * d * g / (4.0 * woU.z * wiU.z);
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(ctx.color * scalar, pdf);
}
fn mx_dielectric_transmission_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.thin > 0.0) { return mx_transmission_thin_eval(ctx, wi); }
  return mx_transmission_refractive_eval(ctx, wi);
}
fn mx_dielectric_transmission_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  return mx_dielectric_transmission_eval(ctx, wi).pdf;
}
fn mx_dielectric_transmission_sample(ctx: MxLobeCtx, u: vec3f) -> MxBsdfSample {
  let a = mx_alpha_of(ctx.roughness);
  if (ctx.thin > 0.0) {
    let s = select(-1.0, 1.0, ctx.wo.z > 0.0);
    let woU = vec3f(ctx.wo.x, ctx.wo.y, s * ctx.wo.z);
    let wm = mx_sample_ggx_normal(a, u.xy);
    let wrU = reflect(-woU, wm);
    if (wrU.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    let wi = vec3f(wrU.x, wrU.y, -s * wrU.z);
    let e = mx_transmission_thin_eval(ctx, wi);
    if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    return MxBsdfSample(wi, e.value, e.pdf, true);
  }
  var wm = mx_sample_ggx_normal(a, u.xy);
  if (ctx.wo.z < 0.0) { wm = -wm; }
  if (dot(ctx.wo, wm) <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let eta = select(1.0 / ctx.ior, ctx.ior, ctx.wo.z > 0.0);
  let f = mx_fresnel_dielectric(dot(ctx.wo, wm), eta);
  let invEta = select(ctx.ior, 1.0 / ctx.ior, ctx.wo.z > 0.0);
  let r = mx_refract_microfacet(ctx.wo, wm, invEta);
  // Total internal reflection (invalid refraction) or the Fresnel coin flip both
  // reflect; otherwise refract. u.z is the free reflect/refract random.
  if (!r.valid || u.z < f) {
    let wi = reflect(-ctx.wo, wm);
    if (ctx.wo.z * wi.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    let e = mx_transmission_refractive_eval(ctx, wi);
    if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    return MxBsdfSample(wi, e.value, e.pdf, true);
  }
  if (ctx.wo.z * r.dir.z > 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let e = mx_transmission_refractive_eval(ctx, r.dir);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(r.dir, e.value, e.pdf, true);
}

// --- thin film (Airy interference on the specular Fresnel, T056f) --------------
// A thin dielectric film over the specular interface produces view- and
// wavelength-dependent iridescence. mx_thin_film_tint mirrors the CPU oracle
// (src/render/pathtracing/spectrum.ts thinFilmTint): per RGB primary wavelength it
// derives the real substrate index reproducing the lobe's F0 and evaluates the
// exact angle-correct Airy reflectance (unpolarised s/p average). mx_thin_film_fresnel
// blends this iridescent reflectance with the nominal Schlick Fresnel by the film
// weight; an inactive film (weight 0 or thickness 0) returns the nominal Fresnel
// unchanged (non-regression). The full-stack assembler wires this onto the
// specular lobes in T056h.
fn mx_fresnel_s(na: f32, cosA: f32, nb: f32, cosB: f32) -> f32 {
  return (na * cosA - nb * cosB) / (na * cosA + nb * cosB);
}
fn mx_fresnel_p(na: f32, cosA: f32, nb: f32, cosB: f32) -> f32 {
  return (nb * cosA - na * cosB) / (nb * cosA + na * cosB);
}
fn mx_airy(r01: f32, r12: f32, phi: f32) -> f32 {
  let cp = cos(phi);
  let sp = sin(phi);
  let numRe = r01 + r12 * cp;
  let numIm = r12 * sp;
  let denRe = 1.0 + r01 * r12 * cp;
  let denIm = r01 * r12 * sp;
  let num = numRe * numRe + numIm * numIm;
  let den = denRe * denRe + denIm * denIm;
  return select(1.0, num / den, den > 0.0);
}
fn mx_thin_film_reflectance(lambda: f32, thickness: f32, cosTheta0: f32, n0: f32, n1: f32, n2: f32) -> f32 {
  let c0 = clamp(cosTheta0, 0.0, 1.0);
  let sin0sq = 1.0 - c0 * c0;
  let sin1sq = (n0 / n1) * (n0 / n1) * sin0sq;
  let sin2sq = (n0 / n2) * (n0 / n2) * sin0sq;
  if (sin1sq >= 1.0 || sin2sq >= 1.0) { return 1.0; }
  let c1 = sqrt(1.0 - sin1sq);
  let c2 = sqrt(1.0 - sin2sq);
  let phi = 4.0 * MX_PI * n1 * thickness * c1 / lambda;
  let rs = mx_airy(mx_fresnel_s(n0, c0, n1, c1), mx_fresnel_s(n1, c1, n2, c2), phi);
  let rp = mx_airy(mx_fresnel_p(n0, c0, n1, c1), mx_fresnel_p(n1, c1, n2, c2), phi);
  return 0.5 * (rs + rp);
}
fn mx_thin_film_channel(lambda: f32, thickness: f32, cosTheta0: f32, filmIor: f32, f0c: f32) -> f32 {
  let s = sqrt(clamp(f0c, 0.0, 0.9999));
  let n2 = (1.0 + s) / (1.0 - s);
  return mx_thin_film_reflectance(lambda, thickness, cosTheta0, 1.0, filmIor, n2);
}
fn mx_thin_film_tint(thickness: f32, cosTheta0: f32, filmIor: f32, f0: vec3f) -> vec3f {
  return vec3f(
    mx_thin_film_channel(612.0, thickness, cosTheta0, filmIor, f0.x),
    mx_thin_film_channel(549.0, thickness, cosTheta0, filmIor, f0.y),
    mx_thin_film_channel(465.0, thickness, cosTheta0, filmIor, f0.z),
  );
}
fn mx_thin_film_fresnel(baseFresnel: vec3f, baseF0: vec3f, cosVH: f32, weight: f32, thickness: f32, filmIor: f32) -> vec3f {
  if (weight <= 0.0 || thickness <= 0.0) { return baseFresnel; }
  let tint = mx_thin_film_tint(thickness, cosVH, filmIor, baseF0);
  return mix(baseFresnel, tint, clamp(weight, 0.0, 1.0));
}

// --- thin-film specular cores (thin-film Fresnel applied to the GGX reflection) --
// Mirror mx_microfacet_eval / mx_microfacet_eval_aniso but swap the Schlick
// Fresnel for its thin-film modulation. The sampled DIRECTION is unchanged (it
// depends only on the GGX alpha), so the assembler keeps the base samplers and
// re-evaluates the value through these when a thin film is active (mirrors the
// CPU conductorThinFilmLobe / dielectricThinFilmLobe in bsdf.ts).
fn mx_microfacet_eval_tf(wo: vec3f, wi: vec3f, a: f32, f0: vec3f, filmW: f32, filmT: f32, filmIor: f32) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm0 = wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wo, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf(wm.z, a);
  let g = mx_smith_g1(wo.z, a) * mx_smith_g1(wi.z, a);
  let f = mx_thin_film_fresnel(mx_fresnel_schlick(f0, cosVH), f0, cosVH, filmW, filmT, filmIor);
  let value = f * (d * g / (4.0 * wo.z * wi.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}
fn mx_microfacet_eval_aniso_tf(wo: vec3f, wi: vec3f, alpha: vec2f, rotation: f32, f0: vec3f, filmW: f32, filmT: f32, filmIor: f32) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wor = mx_rotate_tangent(wo, rotation);
  let wir = mx_rotate_tangent(wi, rotation);
  let wm0 = wor + wir;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wor, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf_aniso(wm, alpha);
  let g = mx_smith_g1_aniso(wor, alpha) * mx_smith_g1_aniso(wir, alpha);
  let f = mx_thin_film_fresnel(mx_fresnel_schlick(f0, cosVH), f0, cosVH, filmW, filmT, filmIor);
  let value = f * (d * g / (4.0 * wor.z * wir.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}

// --- full-stack closure assembler (mirror of composeLobes + coatOverBase, T056h) --
// Operates on the LayeredClosure struct emitted by the surface compiler
// (LAYERED_CLOSURE_PRELUDE in surface-wgsl.ts, prepended before this library).
// mx_closure_eval/pdf/sample mirror the CPU oracle: composeLobes one-sample MIS
// over the weighted lobe stack (value = sum w_k f_k, pdf = sum (w_k/total) pdf_k)
// then coatOverBase (dielectric clearcoat with Fresnel/absorption attenuation).
// Sheen and fuzz ride in the lobe array as sheen lobes; an active thin film
// modulates the specular lobes' Fresnel. Wired onto the backends in T057/T058;
// device parity checked in T059.
fn mx_closure_lobe_ctx(lobe: MxBsdfLobe, wo: vec3f) -> MxLobeCtx {
  return MxLobeCtx(wo, lobe.color, lobe.roughness, lobe.ior, lobe.anisotropy, lobe.rotation, lobe.thin);
}
${lobeDispatch(ALL_DISPATCH)}
fn mx_closure_total_weight(c: LayeredClosure) -> f32 {
  var total = 0.0;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) { total = total + c.lobes[i].weight; }
  return total;
}
fn mx_closure_has_dispersion(c: LayeredClosure) -> bool {
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.weight > 0.0 && l.dispersion > 0.0 && l.thin == 0.0) {
      return true;
    }
  }
  return false;
}
fn mx_dispersion_ior(ior: f32, dispersion: f32, channel: u32) -> f32 {
  return max(1.0, ior + (f32(channel) - 1.0) * (ior - 1.0) * 0.025 * max(dispersion, 0.0));
}
fn mx_closure_spectral_channel(c: LayeredClosure, channel: u32) -> LayeredClosure {
  var result = c;
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin == 0.0 && l.dispersion > 0.0) {
      result.lobes[i].ior = mx_dispersion_ior(l.ior, l.dispersion, channel);
    }
  }
  return result;
}
${HAIR_WGSL}
fn mx_closure_has_hair(c: LayeredClosure) -> bool {
  for (var i = 0u; i < c.lobeCount; i++) {
    if (c.lobes[i].kind == MX_LOBE_CHIANG_HAIR && c.lobes[i].weight > 0.0) { return true; }
  }
  return false;
}
fn mx_closure_frame(c: LayeredClosure, n: vec3f, fallback: mat3x3f) -> mat3x3f {
  if (c.hasShadingTangent == 0u) { return fallback; }
  let t = c.shadingTangent - n * dot(c.shadingTangent, n);
  if (dot(t, t) < 1e-10) { return fallback; }
  let tangent = normalize(t);
  return mat3x3f(tangent, cross(n, tangent), n);
}
fn mx_closure_shading_normal(c: LayeredClosure, geometricNormal: vec3f) -> vec3f {
  if (c.hasShadingNormal != 0u && dot(c.shadingNormal, c.shadingNormal) > 1e-12) {
    return normalize(c.shadingNormal);
  }
  return geometricNormal;
}
fn mx_closure_oriented_normal(c: LayeredClosure, n: vec3f, viewDir: vec3f) -> vec3f {
  if (dot(n, viewDir) >= 0.0) { return n; }
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    // Solid glass needs the signed interface normal to distinguish entering
    // from exiting. Opaque backfaces exposed by cutouts must still scatter.
    if (l.weight > 0.0 && l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin == 0.0) {
      return n;
    }
  }
  return -n;
}
fn mx_closure_base_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let total = mx_closure_total_weight(c);
  var value = vec3f(0.0);
  var pdf = 0.0;
  if (total <= 0.0) { return MxBsdfEval(value, pdf); }
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let lobe = c.lobes[i];
    if (lobe.weight <= 0.0) { continue; }
    let r = mx_closure_lobe_eval(lobe, c, wo, wi);
    value = value + r.value * lobe.weight;
    pdf = pdf + (lobe.weight / total) * r.pdf;
  }
  return MxBsdfEval(value, pdf);
}
fn mx_closure_coat_ctx(c: LayeredClosure, wo: vec3f) -> MxLobeCtx {
  return MxLobeCtx(wo, vec3f(0.0), c.coat.roughness, c.coat.ior, 0.0, 0.0, 0.0);
}
fn mx_closure_eval_base(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let base = mx_closure_base_eval(c, wo, wi);
  if (c.hasCoat == 0u || c.coat.weight <= 0.0) { return base; }
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  let cc = mx_dielectric_reflection_eval(mx_closure_coat_ctx(c, wo), wi);
  let att = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, wi);
  let pCoat = min(coatW * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
  let value = coatW * cc.value + att * base.value;
  let pdf = pCoat * cc.pdf + (1.0 - pCoat) * base.pdf;
  return MxBsdfEval(value, pdf);
}
fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let base = mx_closure_eval_base(c, wo, wi);
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0) { return base; }
  let fuzzW = clamp(c.fuzz.weight, 0.0, 1.0);
  let fuzzCtx = MxLobeCtx(wo, c.fuzz.color, c.fuzz.roughness, 1.5, 0.0, 0.0, 0.0);
  let fuzz = mx_fuzz_eval(fuzzCtx, wi);
  let coverage = mx_closure_fuzz_coverage(c, wo);
  return MxBsdfEval(fuzz.value * fuzzW + base.value * (1.0 - coverage), fuzz.pdf * coverage + base.pdf * (1.0 - coverage));
}
fn mx_closure_fuzz_coverage(c: LayeredClosure, wo: vec3f) -> f32 {
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0 || wo.z <= 0.0) { return 0.0; }
  return clamp(c.fuzz.weight, 0.0, 1.0) * mx_fuzz_dir_albedo(wo.z, c.fuzz.roughness);
}
fn mx_closure_pdf(c: LayeredClosure, wo: vec3f, wi: vec3f) -> f32 {
  return mx_closure_eval(c, wo, wi).pdf;
}
fn mx_closure_base_direction(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let total = mx_closure_total_weight(c);
  // wo.z < 0 means a ray inside a refractive medium hitting the surface from the
  // dense side; the transmission lobe handles that, so only reject grazing.
  if (total <= 0.0 || wo.z == 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  var pick = u.z * total;
  var chosen = 0u;
  var found = false;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let w = c.lobes[i].weight;
    if (w <= 0.0) { continue; }
    if (!found) {
      chosen = i;
      if (pick < w) { found = true; } else { pick = pick - w; }
    }
  }
  return mx_closure_lobe_sample(c.lobes[chosen], wo, u);
}
fn mx_closure_base_sample(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let s = mx_closure_base_direction(c, wo, u);
  if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let e = mx_closure_base_eval(c, wo, s.wi);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(s.wi, e.value, e.pdf, true);
}
// A closure whose energy is carried entirely by smooth dielectric lobes (clear
// glass / mirror) behaves like a delta BSDF: next-event estimation can never
// hit its sharp refraction/reflection lobe, so NEE only injects fireflies that
// the firefly clamp later removes (losing energy and darkening the glass).
// The integrator uses this to skip NEE and treat the bounce as specular, letting
// the environment be seen directly through the glass at full weight.
fn mx_closure_is_specular(c: LayeredClosure) -> bool {
  if (c.hasCoat != 0u && c.coat.weight > 0.0) { return false; }
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) { return false; }
  var w = 0.0;
  var spec = 0.0;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    w = w + l.weight;
    if ((l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION || l.kind == MX_LOBE_DIELECTRIC_REFLECTION) && l.roughness < 0.07) {
      spec = spec + l.weight;
    }
  }
  return w > 0.0 && spec >= w * 0.999;
}
// Diffuse albedo carried by the non-specular lobes (oren-nayar/burley/translucent
// /sheen/subsurface). The integrator lights these from the SH9 irradiance probe
// (noise-free) instead of sampling the environment, so this returns the summed
// weighted lobe colour the probe is modulated by.
fn mx_closure_diffuse_albedo(c: LayeredClosure, wo: vec3f) -> vec3f {
  var a = vec3f(0.0);
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind == MX_LOBE_OREN_NAYAR_DIFFUSE || l.kind == MX_LOBE_BURLEY_DIFFUSE
        || l.kind == MX_LOBE_TRANSLUCENT || l.kind == MX_LOBE_SHEEN
        || l.kind == MX_LOBE_SUBSURFACE) {
      a = a + l.color * l.weight;
    }
  }
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) {
    let coverage = mx_closure_fuzz_coverage(c, wo);
    a = a * (1.0 - coverage) + c.fuzz.color * coverage;
  }
  return a;
}
// True when a BSDF sample drawn with random scalar uz picks a diffuse lobe (lit by
// the SH probe, so the integrator suppresses its env miss), including LTC fuzz.
fn mx_closure_sampled_is_diffuse(c: LayeredClosure, wo: vec3f, uz: f32) -> bool {
  var pz = uz;
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0 && wo.z > 0.0) {
    let coverage = mx_closure_fuzz_coverage(c, wo);
    if (uz < coverage) { return true; }
    pz = (uz - coverage) / max(1.0 - coverage, 1.0e-6);
  }
  if (c.hasCoat != 0u && c.coat.weight > 0.0) {
    let pCoat = min(clamp(c.coat.weight, 0.0, 1.0) * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
    if (uz < pCoat) { return false; }
    pz = (uz - pCoat) / max(1.0 - pCoat, 1.0e-6);
  }
  let total = mx_closure_total_weight(c);
  if (total <= 0.0) { return false; }
  var pick = pz * total;
  var chosen = 0u;
  var found = false;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let w = c.lobes[i].weight;
    if (w <= 0.0) { continue; }
    if (!found) {
      chosen = i;
      if (pick < w) { found = true; } else { pick = pick - w; }
    }
  }
  let k = c.lobes[chosen].kind;
  return k == MX_LOBE_OREN_NAYAR_DIFFUSE || k == MX_LOBE_BURLEY_DIFFUSE
      || k == MX_LOBE_TRANSLUCENT || k == MX_LOBE_SHEEN || k == MX_LOBE_SUBSURFACE;
}
// Specular-only closure response: the dielectric/conductor/schlick reflection
// lobes, the glass transmission lobe and the dielectric coat. The diffuse lobes
// are excluded (lit by the SH probe) so the environment NEE keeps importance
// sampling only the glossy/coat reflections (reflets du vernis).
fn mx_closure_specular_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  var specTotal = 0.0;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION || l.kind == MX_LOBE_CONDUCTOR
        || l.kind == MX_LOBE_GENERALIZED_SCHLICK || l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION
        || l.kind == MX_LOBE_CHIANG_HAIR) {
      specTotal = specTotal + l.weight;
    }
  }
  var value = vec3f(0.0);
  var pdf = 0.0;
  if (specTotal > 0.0) {
    for (var i = 0u; i < c.lobeCount; i = i + 1u) {
      let lobe = c.lobes[i];
      if (lobe.weight <= 0.0) { continue; }
      if (!(lobe.kind == MX_LOBE_DIELECTRIC_REFLECTION || lobe.kind == MX_LOBE_CONDUCTOR
          || lobe.kind == MX_LOBE_GENERALIZED_SCHLICK || lobe.kind == MX_LOBE_DIELECTRIC_TRANSMISSION
          || lobe.kind == MX_LOBE_CHIANG_HAIR)) { continue; }
      let r = mx_closure_lobe_eval(lobe, c, wo, wi);
      value = value + r.value * lobe.weight;
      pdf = pdf + (lobe.weight / specTotal) * r.pdf;
    }
  }
  var base = MxBsdfEval(value, pdf);
  if (c.hasCoat != 0u && c.coat.weight > 0.0) {
    let coatW = clamp(c.coat.weight, 0.0, 1.0);
    let cc = mx_dielectric_reflection_eval(mx_closure_coat_ctx(c, wo), wi);
    let att = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, wi);
    let pCoat = min(coatW * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
    base = MxBsdfEval(
      coatW * cc.value + att * base.value,
      pCoat * cc.pdf + (1.0 - pCoat) * base.pdf,
    );
  }
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0) { return base; }
  let coverage = mx_closure_fuzz_coverage(c, wo);
  return MxBsdfEval(base.value * (1.0 - coverage), mx_closure_pdf(c, wo, wi));
}
fn mx_closure_sample_base(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  if (wo.z == 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  if (c.hasCoat == 0u || c.coat.weight <= 0.0) { return mx_closure_base_sample(c, wo, u); }
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  let pCoat = min(coatW * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
  var wi: vec3f;
  if (u.z < pCoat) {
    let s = mx_dielectric_reflection_sample(mx_closure_coat_ctx(c, wo), u.xy);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  } else {
    let ru = vec3f(u.x, u.y, (u.z - pCoat) / max(1.0 - pCoat, 1.0e-6));
    let s = mx_closure_base_direction(c, wo, ru);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  }
  let e = mx_closure_eval_base(c, wo, wi);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}
fn mx_closure_sample(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0) { return mx_closure_sample_base(c, wo, u); }
  if (wo.z == 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let coverage = mx_closure_fuzz_coverage(c, wo);
  var wi: vec3f;
  if (u.z < coverage) {
    let fuzzCtx = MxLobeCtx(wo, c.fuzz.color, c.fuzz.roughness, 1.5, 0.0, 0.0, 0.0);
    let s = mx_fuzz_sample(fuzzCtx, u.xy);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  } else {
    var baseU = u;
    baseU.z = (u.z - coverage) / max(1.0 - coverage, 1.0e-6);
    let s = mx_closure_sample_base(c, wo, baseU);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  }
  let e = mx_closure_eval(c, wo, wi);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}`;
