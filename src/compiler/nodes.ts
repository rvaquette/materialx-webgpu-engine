// Per-node WGSL lowering registry (plan section 7, T014). Covers every source-code
// leaf of docs/materialx-node-coverage.md. Each entry turns a resolved IR node
// (a 'call' for math/procedural leaves, a 'closure' for BSDF/EDF/VDF leaves) into
// a WGSL expression string; the emitter in wgsl.ts walks the IR and wires these
// together. Texture leaves (image/tiledimage/hextiledimage), surfacematerial and
// layer are lowered directly to IR primitives by the emitter and are listed in
// PRIMITIVE_LOWERED rather than carrying a math emitter here.
//
// Closure helpers are simplified, documented energy combiners: they preserve
// weight/color provenance for compositing but are not a full OpenPBR evaluation.

import type { IrType } from './ir.ts';

export interface NodeEmitContext {
  readonly varyings: Readonly<{
    position: string;
    normal: string;
    tangent: string;
    bitangent: string;
    texcoord: string;
    viewDir: string;
  }>;
  wgslType(type: IrType): string;
  /** True when emitting for a compute stage (no screen-space derivatives). */
  computeStage?: boolean;
}

export interface NodeInputs {
  /** Positional argument (call nodes); throws if absent and no fallback. */
  at(index: number, fallback?: string): string;
  /** Named input; legacyIndex is used only for older positional call IR. */
  named(name: string, fallback?: string, legacyIndex?: number): string;
  has(name: string): boolean;
  /** IR type of a named input, when known (lets lowerings pick type-specific code). */
  typeOf(name: string): IrType | undefined;
}

export type NodeEmit = (inp: NodeInputs, type: IrType, ctx: NodeEmitContext) => string;

export interface NodeLowering {
  category: string;
  kind: 'expr' | 'closure';
  emit: NodeEmit;
  /** WGSL helper function(s) this node needs; emitted once, deduplicated. */
  prelude?: string | readonly string[];
}

// --- WGSL preludes -----------------------------------------------------------

export const CLOSURE_PRELUDE = `struct Closure {
  color: vec3f,
  weight: f32,
};
fn mx_closure_zero() -> Closure { return Closure(vec3f(0.0), 0.0); }
fn mx_closure_add(a: Closure, b: Closure) -> Closure { return Closure(a.color + b.color, min(a.weight + b.weight, 1.0)); }
// Scale a closure response and its reflectance by the modulation weight (T040).
fn mx_closure_mul(a: Closure, w: vec3f) -> Closure { return Closure(a.color * w, a.weight * clamp(dot(w, vec3f(0.2722287, 0.6740818, 0.0536895)), 0.0, 1.0)); }
fn mx_closure_mix(a: Closure, b: Closure, t: f32) -> Closure { return Closure(mix(a.color, b.color, t), mix(a.weight, b.weight, t)); }
// Energetic layering (T040): the base is coupled through the top's throughput
// (1 - top reflectance) and the combined coverage is composited, not maxed.
fn mx_layer(top: Closure, base: Closure) -> Closure {
  let t = clamp(top.weight, 0.0, 1.0);
  return Closure(top.color + base.color * (1.0 - t), t + base.weight * (1.0 - t));
}
fn mx_chiang_hair_bsdf(weight: f32, color: vec3f, roughness: vec2f) -> Closure { return Closure(color * weight, weight); }
// EDF emission (T040): emission adds radiance without blocking an underlying layer,
// so its reflectance (weight) is zero for the energetic composition.
fn mx_uniform_edf(color: vec3f) -> Closure { return Closure(color, 0.0); }
fn mx_generalized_schlick_edf(color0: vec3f, color90: vec3f, N: vec3f, V: vec3f) -> Closure {
  let NdotV = clamp(dot(N, V), 0.0, 1.0);
  let f = pow(1.0 - NdotV, 5.0);
  return Closure(color0 + (color90 - color0) * f, 0.0);
}
`;

// Lighting context (T038): directional lights + constant environment, packed by
// src/gpu/exec.ts and bound at group(0) binding(1). Shared by the real BSDF lobes
// (which integrate radiance over the lights, T039) and emitted once per module.
export const LIGHTING_PRELUDE = `const MX_MAX_LIGHTS: u32 = 4u;
struct MxLight {
  direction: vec4f,
  color: vec4f,
};
struct MxLighting {
  params: vec4f,
  lights: array<MxLight, MX_MAX_LIGHTS>,
};
@group(0) @binding(1) var<uniform> mxLighting: MxLighting;
`;

// Real microfacet/diffuse BSDF lobes (T039). Each lobe evaluates its physical
// reflection (or transmission) response integrated over the lighting context plus
// a constant-environment ambient term, and returns a Closure whose `color` is the
// integrated outgoing radiance and `weight` the lobe reflectance used for
// layering/compositing. The microfacet model is GGX (Trowbridge-Reitz) with the
// Smith separable masking-shadowing term; dielectric and generalized-Schlick use a
// Schlick Fresnel, the conductor uses the unpolarized Fresnel for n/k. Subsurface
// is a declared raster wrap-diffuse approximation; translucent is diffuse
// transmission. Depends on CLOSURE_PRELUDE (Closure) and LIGHTING_PRELUDE.
const BSDF_PRELUDE = `const MX_PI: f32 = 3.14159265359;
fn mx_ggx_ndf(NdotH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(MX_PI * d * d, 1e-7);
}
fn mx_smith_g1(NdotX: f32, a: f32) -> f32 {
  let a2 = a * a;
  return 2.0 * NdotX / max(NdotX + sqrt(a2 + (1.0 - a2) * NdotX * NdotX), 1e-7);
}
fn mx_fresnel_schlick(F0: vec3f, cosTheta: f32) -> vec3f {
  return F0 + (vec3f(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
fn mx_fresnel_schlick_f90(F0: vec3f, F90: vec3f, cosTheta: f32) -> vec3f {
  return F0 + (F90 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
fn mx_fresnel_conductor(n: vec3f, k: vec3f, cosTheta: f32) -> vec3f {
  let c = clamp(cosTheta, 0.0, 1.0);
  let c2 = c * c;
  let n2k2 = n * n + k * k;
  let two_nc = 2.0 * n * c;
  let rs = (n2k2 - two_nc + c2) / (n2k2 + two_nc + c2);
  let rp = (n2k2 * c2 - two_nc + 1.0) / (n2k2 * c2 + two_nc + 1.0);
  return clamp(0.5 * (rs + rp), vec3f(0.0), vec3f(1.0));
}
fn mx_sheen_ndf(NdotH: f32, r: f32) -> f32 {
  let inv = 1.0 / max(r, 1e-3);
  let sin2 = max(1.0 - NdotH * NdotH, 0.0);
  return (2.0 + inv) * pow(sin2, inv * 0.5) / (2.0 * MX_PI);
}
// GGX specular reflection integrand (f_r * NdotL, with NdotL folded against the 1/NdotL in f_r).
fn mx_ggx_reflection(F: vec3f, a: f32, N: vec3f, V: vec3f, L: vec3f) -> vec3f {
  let NdotL = max(dot(N, L), 0.0);
  let NdotV = max(dot(N, V), 0.0);
  if (NdotL <= 0.0 || NdotV <= 0.0) { return vec3f(0.0); }
  let H = normalize(L + V);
  let NdotH = max(dot(N, H), 0.0);
  let D = mx_ggx_ndf(NdotH, a);
  let G = mx_smith_g1(NdotL, a) * mx_smith_g1(NdotV, a);
  return F * (D * G / (4.0 * NdotV));
}
fn mx_oren_nayar_diffuse_bsdf(weight: f32, color: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let sigma2 = clamp(roughness, 0.0, 1.0) * clamp(roughness, 0.0, 1.0);
  let A = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);
  let B = 0.45 * sigma2 / (sigma2 + 0.09);
  let NdotV = max(dot(N, V), 1e-4);
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) { continue; }
    let s = dot(L, V) - dot(N, L) * dot(N, V);
    let t = select(1.0, max(NdotL, NdotV), s > 0.0);
    acc = acc + color * ((A + B * s / t) * NdotL / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_burley_diffuse_bsdf(weight: f32, color: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let NdotV = max(dot(N, V), 1e-4);
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) { continue; }
    let H = normalize(L + V);
    let LdotH = max(dot(L, H), 0.0);
    let fd90 = 0.5 + 2.0 * roughness * LdotH * LdotH;
    let fl = pow(1.0 - NdotL, 5.0);
    let fv = pow(1.0 - NdotV, 5.0);
    let fd = (1.0 + (fd90 - 1.0) * fl) * (1.0 + (fd90 - 1.0) * fv);
    acc = acc + color * (fd * NdotL / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_translucent_bsdf(weight: f32, color: vec3f, N: vec3f, V: vec3f) -> Closure {
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(-N, L), 0.0);
    acc = acc + color * (NdotL / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_dielectric_bsdf(weight: f32, tint: vec3f, ior: f32, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let a = max(roughness * roughness, 1e-3);
  let r = (ior - 1.0) / (ior + 1.0);
  let F0 = vec3f(clamp(r * r, 0.0, 1.0));
  let count = u32(mxLighting.params.x);
  var acc = tint * F0 * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let H = normalize(L + V);
    let VdotH = max(dot(V, H), 0.0);
    let F = mx_fresnel_schlick(F0, VdotH);
    acc = acc + tint * mx_ggx_reflection(F, a, N, V, L) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_conductor_bsdf(weight: f32, ior: vec3f, extinction: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let a = max(roughness * roughness, 1e-3);
  let count = u32(mxLighting.params.x);
  var acc = mx_fresnel_conductor(ior, extinction, 1.0) * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let H = normalize(L + V);
    let VdotH = max(dot(V, H), 0.0);
    let F = mx_fresnel_conductor(ior, extinction, VdotH);
    acc = acc + mx_ggx_reflection(F, a, N, V, L) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_generalized_schlick_bsdf(weight: f32, color0: vec3f, color90: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let a = max(roughness * roughness, 1e-3);
  let count = u32(mxLighting.params.x);
  var acc = color0 * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let H = normalize(L + V);
    let VdotH = max(dot(V, H), 0.0);
    let F = mx_fresnel_schlick_f90(color0, color90, VdotH);
    acc = acc + mx_ggx_reflection(F, a, N, V, L) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_sheen_bsdf(weight: f32, color: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let r = clamp(roughness, 1e-3, 1.0);
  let NdotV = max(dot(N, V), 1e-4);
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) { continue; }
    let H = normalize(L + V);
    let NdotH = max(dot(N, H), 0.0);
    let D = mx_sheen_ndf(NdotH, r);
    let vis = 1.0 / (4.0 * (NdotL + NdotV - NdotL * NdotV));
    acc = acc + color * (D * vis * NdotL) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_subsurface_bsdf(weight: f32, color: vec3f, radius: vec3f, N: vec3f, V: vec3f) -> Closure {
  let wrap = 0.5;
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let wrapped = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
    acc = acc + color * (wrapped / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
// Anisotropic VDF (T040): raster single-scattering approximation at unit optical
// depth. Full volume transport is handled by the media integrator (path tracer)
// and the raster volume pass; a VDF composed as a surface closure here contributes
// single-scattered radiance with a Henyey-Greenstein phase and a single-scattering
// albedo scattering / (absorption + scattering).
fn mx_anisotropic_vdf(absorption: vec3f, scattering: vec3f, anisotropy: f32, V: vec3f) -> Closure {
  let extinction = max(absorption + scattering, vec3f(1e-4));
  let albedo = clamp(scattering / extinction, vec3f(0.0), vec3f(1.0));
  let g = clamp(anisotropy, -0.99, 0.99);
  let g2 = g * g;
  let count = u32(mxLighting.params.x);
  var acc = albedo * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let cosTheta = dot(-L, V);
    let denom = pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);
    let phase = (1.0 - g2) / (4.0 * MX_PI * denom);
    acc = acc + albedo * phase * radiance;
  }
  let w = clamp(dot(albedo, vec3f(0.2722287, 0.6740818, 0.0536895)), 0.0, 1.0);
  return Closure(acc, w);
}
`;

// Surface shading prelude (T038/T039): the BSDF closure result `{response, throughput}`
// and the `surface` node. The real lobes (BSDF_PRELUDE) already integrate radiance
// over the lights, so `surface` composes the accumulated reflection with the EDF
// emission and carries opacity; T040 adds EDF/VDF energetic composition.
const SURFACE_PRELUDE = `struct BSDF {
  response: vec3f,
  throughput: vec3f,
};
fn mx_surface(bsdf: Closure, edf: Closure, opacity: f32) -> Closure {
  var result: BSDF;
  result.response = bsdf.color + edf.color;
  result.throughput = max(vec3f(1.0) - vec3f(bsdf.weight), vec3f(0.0));
  return Closure(result.response, opacity);
}
`;

// Closure ops that read the lighting context (and therefore require LIGHTING_PRELUDE
// plus the group(0) binding(1) uniform): the real BSDF lobes that integrate over lights.
const LIGHTING_CLOSURE_OPS: ReadonlySet<string> = new Set([
  'oren_nayar_diffuse_bsdf',
  'burley_diffuse_bsdf',
  'translucent_bsdf',
  'dielectric_bsdf',
  'conductor_bsdf',
  'generalized_schlick_bsdf',
  'sheen_bsdf',
  'subsurface_bsdf',
  'anisotropic_vdf',
]);

/** True when a closure op reads the lighting context uniform (real BSDF lobes). */
export function closureUsesLighting(op: string): boolean {
  return LIGHTING_CLOSURE_OPS.has(op);
}

const LUMINANCE_PRELUDE = `fn mx_luminance(c: vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2722287, 0.6740818, 0.0536895));
  return vec3f(l);
}
`;

const HSV_PRELUDE = `fn mx_rgbtohsv(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let d = mx - mn;
  var h = 0.0;
  if (d > 0.0) {
    if (mx == c.r) { h = (c.g - c.b) / d; }
    else if (mx == c.g) { h = 2.0 + (c.b - c.r) / d; }
    else { h = 4.0 + (c.r - c.g) / d; }
    h = fract(h / 6.0);
  }
  let s = select(0.0, d / mx, mx > 0.0);
  return vec3f(h, s, mx);
}
fn mx_hsvtorgb(c: vec3f) -> vec3f {
  let h = c.x * 6.0;
  let s = c.y;
  let v = c.z;
  let i = floor(h);
  let f = h - i;
  let p = v * (1.0 - s);
  let q = v * (1.0 - s * f);
  let t = v * (1.0 - s * (1.0 - f));
  let m = i32(i) % 6;
  switch (m) {
    case 0 { return vec3f(v, t, p); }
    case 1 { return vec3f(q, v, p); }
    case 2 { return vec3f(p, v, t); }
    case 3 { return vec3f(p, q, v); }
    case 4 { return vec3f(t, p, v); }
    default { return vec3f(v, p, q); }
  }
}
`;

const ROTATE2D_PRELUDE = `fn mx_rotate2d(v: vec2f, deg: f32) -> vec2f {
  let a = radians(deg);
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x + s * v.y, -s * v.x + c * v.y);
}
`;

const ROTATE3D_PRELUDE = `fn mx_rotate3d(v: vec3f, deg: f32, axis: vec3f) -> vec3f {
  let a = radians(deg);
  let n = normalize(axis);
  let c = cos(a);
  let s = sin(a);
  return v * c + cross(n, v) * s + n * dot(n, v) * (1.0 - c);
}
`;

const NORMALMAP_PRELUDE = `fn mx_normalmap(sample: vec3f, scale: vec2f, N: vec3f, T: vec3f, B: vec3f) -> vec3f {
  let m = select(sample * 2.0 - 1.0, vec3f(0.0, 0.0, 1.0), dot(sample, sample) == 0.0);
  let v = vec3f(m.xy * scale, m.z);
  return normalize(T * v.x + B * v.y + N * v.z);
}
`;

const FRACTAL3D_PRELUDE = `fn mx_hash3(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}
fn mx_fractal3d(p: vec3f, amplitude: f32, octaves: f32) -> f32 {
  var sum = 0.0;
  var amp = amplitude;
  var freq = 1.0;
  let n = i32(octaves);
  for (var i = 0; i < n; i = i + 1) {
    sum = sum + mx_hash3(p * freq) * amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  return sum;
}
`;

// Hash-based gradient (Perlin-style) noise shared by the noise2d/3d, fractal,
// cellnoise, worley and unifiednoise lowerings. Integer hashing keeps results
// stable across GPUs (no fract(sin) precision drift on mobile).
const NOISE_PRELUDE = `fn mx_hash_u32(x: u32) -> u32 {
  var h = x;
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}
fn mx_hash_cell(c: vec3i, seed: u32) -> u32 {
  return mx_hash_u32(bitcast<u32>(c.x) ^ mx_hash_u32(bitcast<u32>(c.y) ^ mx_hash_u32(bitcast<u32>(c.z) ^ mx_hash_u32(seed))));
}
fn mx_cell_float(c: vec3i, seed: u32) -> f32 {
  return f32(mx_hash_cell(c, seed) >> 8u) / 16777216.0;
}
fn mx_grad3(h: u32, d: vec3f) -> f32 {
  let k = h & 15u;
  let u = select(d.y, d.x, k < 8u);
  let v = select(select(d.z, d.x, k == 12u || k == 14u), d.y, k < 4u);
  return select(-u, u, (k & 1u) == 0u) + select(-v, v, (k & 2u) == 0u);
}
fn mx_perlin3(p: vec3f, seed: u32) -> f32 {
  let fl = floor(p);
  let i = vec3i(fl);
  let f = p - fl;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = mx_grad3(mx_hash_cell(i, seed), f);
  let n100 = mx_grad3(mx_hash_cell(i + vec3i(1, 0, 0), seed), f - vec3f(1.0, 0.0, 0.0));
  let n010 = mx_grad3(mx_hash_cell(i + vec3i(0, 1, 0), seed), f - vec3f(0.0, 1.0, 0.0));
  let n110 = mx_grad3(mx_hash_cell(i + vec3i(1, 1, 0), seed), f - vec3f(1.0, 1.0, 0.0));
  let n001 = mx_grad3(mx_hash_cell(i + vec3i(0, 0, 1), seed), f - vec3f(0.0, 0.0, 1.0));
  let n101 = mx_grad3(mx_hash_cell(i + vec3i(1, 0, 1), seed), f - vec3f(1.0, 0.0, 1.0));
  let n011 = mx_grad3(mx_hash_cell(i + vec3i(0, 1, 1), seed), f - vec3f(0.0, 1.0, 1.0));
  let n111 = mx_grad3(mx_hash_cell(i + vec3i(1, 1, 1), seed), f - vec3f(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);
  return 0.982 * mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
fn mx_perlin3v(p: vec3f) -> vec3f {
  return vec3f(mx_perlin3(p, 0u), mx_perlin3(p, 1u), mx_perlin3(p, 2u));
}
fn mx_fractal3(p: vec3f, octaves: i32, lacunarity: f32, diminish: f32, seed: u32) -> f32 {
  var result = 0.0;
  var amp = 1.0;
  var q = p;
  let n = clamp(octaves, 0, 16);
  for (var i = 0; i < n; i = i + 1) {
    result = result + amp * mx_perlin3(q, seed);
    amp = amp * diminish;
    q = q * lacunarity;
  }
  return result;
}
fn mx_fractal3v(p: vec3f, octaves: i32, lacunarity: f32, diminish: f32) -> vec3f {
  return vec3f(mx_fractal3(p, octaves, lacunarity, diminish, 0u), mx_fractal3(p, octaves, lacunarity, diminish, 1u), mx_fractal3(p, octaves, lacunarity, diminish, 2u));
}
fn mx_cellnoise3(p: vec3f) -> f32 {
  return mx_cell_float(vec3i(floor(p)), 0u);
}
`;

const WORLEY_PRELUDE = `fn mx_worley_cell_color(cell: vec3i, dims: i32) -> vec3f {
  if (dims == 2) {
    return vec3f(f32(mx_unified_hash(vec3i(cell.xy, 0), 3)), f32(mx_unified_hash(vec3i(cell.xy, 1), 3)), f32(mx_unified_hash(vec3i(cell.xy, 2), 3))) / 4294967295.0;
  }
  let seed = 0xdeadbeefu + 16u + 13u;
  var a = seed + bitcast<u32>(cell.x);
  var b = seed + bitcast<u32>(cell.y);
  var c = seed + bitcast<u32>(cell.z);
  a = (a - c) ^ mx_noise_rotl(c, 4u); c = c + b;
  b = (b - a) ^ mx_noise_rotl(a, 6u); a = a + c;
  c = (c - b) ^ mx_noise_rotl(b, 8u); b = b + a;
  a = (a - c) ^ mx_noise_rotl(c, 16u); c = c + b;
  b = (b - a) ^ mx_noise_rotl(a, 19u); a = a + c;
  c = (c - b) ^ mx_noise_rotl(b, 4u); b = b + a;
  return vec3f(f32(mx_noise_final(a, b, c)), f32(mx_noise_final(a + 1u, b, c)), f32(mx_noise_final(a + 2u, b, c))) / 4294967295.0;
}
fn mx_worley(p: vec3f, jitter: f32, dims: i32, style: i32, channels: i32) -> vec3f {
  let fl = floor(p);
  let base = vec3i(fl);
  let f = p - fl;
  var d = vec3f(1e6);
  var nearest = base;
  let zr = select(0, 1, dims == 3);
  for (var x = -1; x <= 1; x = x + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var z = -zr; z <= zr; z = z + 1) {
        let o = vec3i(x, y, z);
        let c = base + o;
        let r = mx_worley_cell_color(c, dims);
        let cellpos = vec3f(o) + vec3f(0.5) + (r - vec3f(0.5)) * jitter;
        var diff = cellpos - f;
        if (dims == 2) { diff.z = 0.0; }
        let dist = dot(diff, diff);
        if (dist < d.x) {
          d = vec3f(dist, d.x, d.y);
          nearest = vec3i(floor(cellpos + fl));
        }
        else if (dist < d.y) { d = vec3f(d.x, dist, d.y); }
        else if (dist < d.z) { d.z = dist; }
      }
    }
  }
  if (style == 1) {
    if (channels == 1) { return vec3f(f32(mx_unified_hash(nearest, dims)) / 4294967295.0); }
    return mx_worley_cell_color(nearest, dims);
  }
  return sqrt(d);
}
`;

const MATERIALX_NOISE_HASH_PRELUDE = `fn mx_noise_rotl(x: u32, k: u32) -> u32 {
  return (x << k) | (x >> (32u - k));
}
fn mx_noise_final(a0: u32, b0: u32, c0: u32) -> u32 {
  var a = a0;
  var b = b0;
  var c = c0;
  c = (c ^ b) - mx_noise_rotl(b, 14u);
  a = (a ^ c) - mx_noise_rotl(c, 11u);
  b = (b ^ a) - mx_noise_rotl(a, 25u);
  c = (c ^ b) - mx_noise_rotl(b, 16u);
  a = (a ^ c) - mx_noise_rotl(c, 4u);
  b = (b ^ a) - mx_noise_rotl(a, 14u);
  c = (c ^ b) - mx_noise_rotl(b, 24u);
  return c;
}
fn mx_unified_hash(cell: vec3i, dims: i32) -> u32 {
  let seed = 0xdeadbeefu + u32(dims) * 4u + 13u;
  return mx_noise_final(seed + bitcast<u32>(cell.x), seed + bitcast<u32>(cell.y), seed + select(0u, bitcast<u32>(cell.z), dims == 3));
}
`;

const UNIFIED_NOISE_PRELUDE = `fn mx_unified_cell(p: vec3f, dims: i32) -> f32 {
  return f32(mx_unified_hash(vec3i(floor(p)), dims)) / 4294967295.0;
}
fn mx_unified_perlin3(p: vec3f) -> f32 {
  let fl = floor(p);
  let cell = vec3i(fl);
  let f = p - fl;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var result = 0.0;
  for (var z = 0; z <= 1; z = z + 1) {
    for (var y = 0; y <= 1; y = y + 1) {
      for (var x = 0; x <= 1; x = x + 1) {
        let corner = vec3i(x, y, z);
        let w = mix(vec3f(1.0) - u, u, vec3f(corner));
        result = result + w.x * w.y * w.z * mx_grad3(mx_unified_hash(cell + corner, 3), f - vec3f(corner));
      }
    }
  }
  return 0.982 * result;
}
fn mx_unified_fractal3(p: vec3f, octaves: i32, lacunarity: f32, diminish: f32) -> f32 {
  var result = 0.0;
  var amplitude = 1.0;
  var q = p;
  for (var i = 0; i < octaves; i = i + 1) {
    result = result + amplitude * mx_unified_perlin3(q);
    amplitude = amplitude * diminish;
    q = q * lacunarity;
  }
  return result;
}
fn mx_unifiednoise(p: vec3f, dims: i32, jitter: f32, octaves: i32, lacunarity: f32, diminish: f32, kind: i32, style: i32) -> f32 {
  let angle = (jitter - 1.0) * 90000.0;
  var q = mx_rotate3d(p, angle, vec3f(0.1, 1.0, 0.0));
  if (dims == 2) { q = vec3f(mx_rotate2d(p.xy, angle), 0.0); }
  switch (kind) {
    case 1 { return mx_unified_cell(q, dims); }
    case 2 { return mx_worley(p, jitter, dims, style, 1).x; }
    case 3 {
      return mx_unified_fractal3(select(q, vec3f(p.xy, angle), dims == 2), octaves, lacunarity, diminish);
    }
    default { return mx_perlin3(q, 0u) * 0.5 + 0.5; }
  }
}
`;

const MATRIX_PRELUDE = `fn mx_inverse3(m: mat3x3f) -> mat3x3f {
  let r0 = cross(m[1], m[2]);
  let r1 = cross(m[2], m[0]);
  let r2 = cross(m[0], m[1]);
  let det = dot(m[0], r0);
  let inv = 1.0 / select(det, 1e-8, abs(det) < 1e-8);
  return transpose(mat3x3f(r0, r1, r2)) * inv;
}
fn mx_inverse4(m: mat4x4f) -> mat4x4f {
  let a00 = m[0][0]; let a01 = m[0][1]; let a02 = m[0][2]; let a03 = m[0][3];
  let a10 = m[1][0]; let a11 = m[1][1]; let a12 = m[1][2]; let a13 = m[1][3];
  let a20 = m[2][0]; let a21 = m[2][1]; let a22 = m[2][2]; let a23 = m[2][3];
  let a30 = m[3][0]; let a31 = m[3][1]; let a32 = m[3][2]; let a33 = m[3][3];
  let b00 = a00 * a11 - a01 * a10;
  let b01 = a00 * a12 - a02 * a10;
  let b02 = a00 * a13 - a03 * a10;
  let b03 = a01 * a12 - a02 * a11;
  let b04 = a01 * a13 - a03 * a11;
  let b05 = a02 * a13 - a03 * a12;
  let b06 = a20 * a31 - a21 * a30;
  let b07 = a20 * a32 - a22 * a30;
  let b08 = a20 * a33 - a23 * a30;
  let b09 = a21 * a32 - a22 * a31;
  let b10 = a21 * a33 - a23 * a31;
  let b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  let inv = 1.0 / select(det, 1e-8, abs(det) < 1e-8);
  return mat4x4f(
    a11 * b11 - a12 * b10 + a13 * b09, a02 * b10 - a01 * b11 - a03 * b09, a31 * b05 - a32 * b04 + a33 * b03, a22 * b04 - a21 * b05 - a23 * b03,
    a12 * b08 - a10 * b11 - a13 * b07, a00 * b11 - a02 * b08 + a03 * b07, a32 * b02 - a30 * b05 - a33 * b01, a20 * b05 - a22 * b02 + a23 * b01,
    a10 * b10 - a11 * b08 + a13 * b06, a01 * b08 - a00 * b10 - a03 * b06, a30 * b04 - a31 * b02 + a33 * b00, a21 * b02 - a20 * b04 - a23 * b00,
    a11 * b07 - a10 * b09 - a12 * b06, a00 * b09 - a01 * b07 + a02 * b06, a31 * b01 - a30 * b03 - a32 * b00, a20 * b03 - a21 * b01 + a22 * b00) * inv;
}
`;

const PLACE2D_PRELUDE = `fn mx_place2d(tc: vec2f, pivot: vec2f, scale: vec2f, rotate: f32, offset: vec2f, order: i32) -> vec2f {
  let a = radians(rotate);
  let c = cos(a);
  let s = sin(a);
  let rot = mat2x2f(c, -s, s, c);
  let centered = tc - pivot;
  if (order == 0) { return rot * (centered / scale) - offset + pivot; }
  return (rot * (centered - offset)) / scale + pivot;
}
`;

const BLACKBODY_PRELUDE = `fn mx_blackbody(temperature: f32) -> vec3f {
  let k = clamp(temperature, 800.0, 25000.0);
  let t = 1000.0 / k;
  let t2 = t * t;
  let t3 = t2 * t;
  var xc = -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
  if (k < 4000.0) { xc = -0.2661239 * t3 - 0.2343580 * t2 + 0.8776956 * t + 0.179910; }
  let xc2 = xc * xc;
  let xc3 = xc2 * xc;
  var yc = 3.0817580 * xc3 - 5.87338670 * xc2 + 3.75112997 * xc - 0.37001483;
  if (k < 2222.0) { yc = -1.1063814 * xc3 - 1.34811020 * xc2 + 2.18555832 * xc - 0.20219683; }
  else if (k < 4000.0) { yc = -0.9549476 * xc3 - 1.37418593 * xc2 + 2.09137015 * xc - 0.16748867; }
  if (yc <= 0.0) { return vec3f(1.0); }
  let xyz = vec3f(xc / yc, 1.0, (1.0 - xc - yc) / yc);
  let m = mat3x3f(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570);
  return max(m * xyz, vec3f(0.0));
}
`;

// Derivatives are passed in so the helper stays valid in compute modules.
const HEIGHTTONORMAL_PRELUDE = `fn mx_heighttonormal(dh: vec2f, du: vec2f, dv: vec2f, scale: f32) -> vec3f {
  let h = dh * scale * (1.0 / 16.0);
  var n = cross(vec3f(du.x, dv.x, h.x), vec3f(du.y, dv.y, h.y));
  if (dot(n, n) < 1e-12) { n = vec3f(0.0, 0.0, 1.0); }
  else if (n.z < 0.0) { n = -n; }
  return normalize(n) * 0.5 + 0.5;
}
`;

const RAMP_PRELUDE = `fn mx_ramp_gradient(x: f32, i1: f32, i2: f32, c1: vec4f, c2: vec4f, interpolation: i32, prev: vec4f, num: i32, count: i32) -> vec4f {
  if (num > count || !(x > i1)) { return prev; }
  if (interpolation >= 2) { return select(c2, c1, i2 > x); }
  let t = select((clamp(x, i1, i2) - i1) / (i2 - i1), smoothstep(i1, i2, x), interpolation == 1);
  return mix(c1, c2, t);
}
fn mx_ramp_x(uv: vec2f, kind: i32) -> f32 {
  let d = uv - vec2f(0.5);
  switch (kind) {
    case 1 { return atan2(d.x, d.y) / 6.28319 + 0.5; }
    case 2 { return length(d * 1.414); }
    case 3 { return 2.0 * max(abs(d.x), abs(d.y)); }
    default { return uv.x; }
  }
}
`;

const COLORCORRECT_PRELUDE = `fn mx_colorcorrect(c: vec3f, hue: f32, saturation: f32, gamma: f32, lift: f32, gain: f32, contrast: f32, pivot: f32, exposure: f32) -> vec3f {
  let hsv = mx_rgbtohsv(c);
  var r = mx_hsvtorgb(vec3f(fract(hsv.x + hue), hsv.y * saturation, hsv.z));
  r = sign(r) * pow(abs(r), vec3f(1.0 / max(gamma, 1e-4)));
  r = r * (1.0 - lift) + vec3f(lift);
  r = r * gain;
  r = (r - vec3f(pivot)) * contrast + vec3f(pivot);
  return r * exp2(exposure);
}
`;

const ARTISTIC_IOR_PRELUDE = `fn mx_artistic_ior(reflectivity: vec3f, edge_color: vec3f) -> vec3f {
  let r = clamp(reflectivity, vec3f(0.0), vec3f(0.99));
  let s = sqrt(r);
  let nMin = (1.0 - r) / (1.0 + r);
  let nMax = (1.0 + s) / (1.0 - s);
  return mix(nMax, nMin, edge_color);
}
fn mx_artistic_ior_extinction(reflectivity: vec3f, edge_color: vec3f) -> vec3f {
  let r = clamp(reflectivity, vec3f(0.0), vec3f(0.99));
  let ior = mx_artistic_ior(reflectivity, edge_color);
  let np1 = ior + 1.0;
  let nm1 = ior - 1.0;
  return sqrt(max((np1 * np1 * r - nm1 * nm1) / (1.0 - r), vec3f(0.0)));
}
`;

const ROUGHNESS_ANISO_PRELUDE = `fn mx_roughness_anisotropy(roughness: f32, anisotropy: f32) -> vec2f {
  let r2 = roughness * roughness;
  let a = clamp(anisotropy, 0.0, 1.0);
  return vec2f(r2 / max(1.0 - a * 0.9, 1e-3), r2 * (1.0 - a * 0.9));
}
`;

const ROUGHNESS_DUAL_PRELUDE = `fn mx_roughness_dual(roughness: vec2f) -> vec2f { return roughness * roughness; }
`;

const HAIR_PRELUDE = `fn mx_chiang_hair_absorption_from_color(color: vec3f) -> vec3f {
  let c = clamp(color, vec3f(1e-4), vec3f(1.0));
  let l = log(c);
  return l * l;
}
fn mx_chiang_hair_roughness(longitudinal: f32, azimuthal: f32) -> vec2f {
  return vec2f(longitudinal * longitudinal, azimuthal * azimuthal);
}
fn mx_deon_hair_absorption_from_melanin(eumelanin: f32, pheomelanin: f32) -> vec3f {
  return eumelanin * vec3f(0.419, 0.697, 1.37) + pheomelanin * vec3f(0.187, 0.4, 1.05);
}
`;

// --- Registry ----------------------------------------------------------------

const op2 = (sym: string): NodeEmit => (inp) => `(${inp.named('in1', undefined, 0)} ${sym} ${inp.named('in2', undefined, 1)})`;
const fn1 = (name: string): NodeEmit => (inp) => `${name}(${inp.named('in', undefined, 0)})`;
const fn2 = (name: string): NodeEmit => (inp) => `${name}(${inp.named('in1', undefined, 0)}, ${inp.named('in2', undefined, 1)})`;
/** Binary builtin whose second operand may be a scalar for vector nodes (FA variants). */
const fn2Splat = (name: string): NodeEmit => (inp, type, ctx) => {
  const in2 = inp.named('in2', undefined, 1);
  const t2 = inp.typeOf('in2');
  const splat = type.kind === 'vector' && t2 !== undefined && t2.kind === 'scalar' ? `${ctx.wgslType(type)}(${in2})` : in2;
  return `${name}(${inp.named('in1', undefined, 0)}, ${splat})`;
};

function zeroOf(type: IrType, ctx: NodeEmitContext): string {
  if (type.kind === 'scalar' && type.scalar === 'bool') return 'false';
  if (type.kind === 'matrix') return `${ctx.wgslType(type)}()`;
  return `${ctx.wgslType(type)}(0)`;
}

function vectorSize(type: IrType): number {
  return type.kind === 'vector' ? type.size : 1;
}

/** Fit a 3-channel noise expression (vec3 `v`, scalar `s(seed)`) to the node type. */
function fitNoise(type: IrType, scalar: (seed: string) => string, vec3: string): string {
  switch (vectorSize(type)) {
    case 1:
      return scalar('0u');
    case 2:
      return `(${vec3}).xy`;
    case 3:
      return vec3;
    default:
      return `vec4f(${vec3}, ${scalar('3u')})`;
  }
}

const texcoordOf = (inp: NodeInputs, ctx: NodeEmitContext): string => inp.named('texcoord', ctx.varyings.texcoord);
const positionOf = (inp: NodeInputs, ctx: NodeEmitContext): string => inp.named('position', ctx.varyings.position);

/** Compositing node: mix(bg, op(fg, bg), mix). */
const blend = (op: (fg: string, bg: string, t: string) => string): NodeEmit => (inp, type, ctx) => {
  const t = ctx.wgslType(type);
  const fg = inp.named('fg', `${t}(0.0)`);
  const bg = inp.named('bg', `${t}(0.0)`);
  return `mix(${bg}, ${op(fg, bg, t)}, ${inp.named('mix', '1.0')})`;
};

/** if* conditional; the boolean-output variants only compare value1/value2. */
const conditional = (cmp: string): NodeEmit => (inp, type) => {
  const test = `${inp.named('value1', undefined, 0)} ${cmp} ${inp.named('value2', undefined, 1)}`;
  if (type.kind === 'scalar' && type.scalar === 'bool' && !inp.has('in1')) return `(${test})`;
  return `select(${inp.named('in2', undefined, 3)}, ${inp.named('in1', undefined, 2)}, ${test})`;
};

function expr(category: string, emit: NodeEmit, prelude?: string | readonly string[]): NodeLowering {
  return prelude !== undefined ? { category, kind: 'expr', emit, prelude } : { category, kind: 'expr', emit };
}
function closure(category: string, emit: NodeEmit, prelude?: string): NodeLowering {
  return prelude !== undefined ? { category, kind: 'closure', emit, prelude } : { category, kind: 'closure', emit };
}

const LOWERINGS: readonly NodeLowering[] = [
  // math
  expr('absval', fn1('abs')),
  expr('fract', fn1('fract')),
  expr('add', op2('+')),
  expr('subtract', op2('-')),
  expr('multiply', op2('*')),
  expr('divide', op2('/')),
  expr('power', fn2Splat('pow')),
  expr('sin', fn1('sin')),
  expr('sqrt', fn1('sqrt')),
  expr('ln', (inp, type, ctx) => {
    const input = inp.named('in', undefined, 0);
    const t = ctx.wgslType(type);
    const positive = `${input} > ${t}(0.0)`;
    return `select(${t}(0.0), log(select(${t}(1.0), ${input}, ${positive})), ${positive})`;
  }),
  expr('sign', fn1('sign')),
  expr('normalize', fn1('normalize')),
  expr('min', fn2Splat('min')),
  expr('max', fn2Splat('max')),
  expr('clamp', (inp, type, ctx) => {
    // clamp is a builtin (no scalar->vector broadcast); splat the bounds to the
    // node type so a color3/vector clamp gets vecN bounds, not scalars.
    const t = ctx.wgslType(type);
    return `clamp(${inp.named('in', undefined, 0)}, ${t}(${inp.named('low', '0.0', 1)}), ${t}(${inp.named('high', '1.0', 2)}))`;
  }),
  expr('range', (inp, type, ctx) => {
    const target = ctx.wgslType(type);
    const low = `${target}(${inp.named('inlow', '0.0', 1)})`;
    const high = `${target}(${inp.named('inhigh', '1.0', 2)})`;
    const outLow = `${target}(${inp.named('outlow', '0.0', 3)})`;
    const outHigh = `${target}(${inp.named('outhigh', '1.0', 4)})`;
    const gamma = `${target}(${inp.named('gamma', '1.0', 5)})`;
    const normalized = `((${inp.named('in', undefined, 0)} - ${low}) / (${high} - ${low}))`;
    const corrected = `(sign(${normalized}) * pow(abs(${normalized}), ${target}(1.0) / ${gamma}))`;
    const mapped = `(${outLow} + (${outHigh} - ${outLow}) * ${corrected})`;
    return `select(${mapped}, clamp(${mapped}, min(${outLow}, ${outHigh}), max(${outLow}, ${outHigh})), ${inp.named('doclamp', 'false', 6)})`;
  }),
  expr('dotproduct', fn2('dot')),
  expr('dot', (inp) => inp.named('in', undefined, 0)),
  expr('invert', (inp) => `(${inp.named('amount', '1.0', 1)} - ${inp.named('in', undefined, 0)})`),
  // compositing / channel
  expr('mix', (inp) => `mix(${inp.named('bg', undefined, 1)}, ${inp.named('fg', undefined, 0)}, ${inp.named('mix', undefined, 2)})`),
  expr('extract', (inp) => `${inp.named('in', undefined, 0)}[${inp.named('index', undefined, 1)}]`),
  expr('combine2', (inp) => `vec2f(${inp.named('in1', undefined, 0)}, ${inp.named('in2', undefined, 1)})`),
  expr('combine3', (inp) => `vec3f(${inp.named('in1', undefined, 0)}, ${inp.named('in2', undefined, 1)}, ${inp.named('in3', undefined, 2)})`),
  expr('combine4', (inp) => `vec4f(${inp.named('in1', '0.0')}, ${inp.named('in2', '0.0')}, ${inp.named('in3', '0.0')}, ${inp.named('in4', '0.0')})`),
  expr('constant', (inp) => inp.named('value', undefined, 0)),
  // conditionals / logic
  expr('ifequal', conditional('==')),
  expr('ifgreater', conditional('>')),
  expr('ifgreatereq', conditional('>=')),
  expr('switch', (inp, type, ctx) => {
    let count = 10;
    while (count > 1 && !inp.has(`in${count}`)) count--;
    const zero = zeroOf(type, ctx);
    const which = `clamp(i32(floor(f32(${inp.named('which', '0.0')}))), 0, ${count - 1})`;
    let acc = inp.named(`in${count}`, zero);
    for (let k = count - 1; k >= 1; k--) acc = `select(${acc}, ${inp.named(`in${k}`, zero)}, ${which} == ${k - 1})`;
    return acc;
  }),
  expr('and', (inp) => `(${inp.named('in1', 'false')} && ${inp.named('in2', 'false')})`),
  expr('or', (inp) => `(${inp.named('in1', 'false')} || ${inp.named('in2', 'false')})`),
  expr('xor', (inp) => `(${inp.named('in1', 'false')} != ${inp.named('in2', 'false')})`),
  expr('not', (inp) => `(!${inp.named('in', 'false')})`),
  // more math
  expr('cos', fn1('cos')),
  expr('tan', fn1('tan')),
  expr('asin', fn1('asin')),
  expr('acos', (inp, type, ctx) => {
    const input = inp.named('in', undefined, 0);
    const t = ctx.wgslType(type);
    // Out-of-domain GLSL results vary by driver; use the reference's zero channels.
    return `select(${t}(0.0), acos(clamp(${input}, ${t}(-1.0), ${t}(1.0))), abs(${input}) <= ${t}(1.0))`;
  }),
  expr('atan2', (inp) => `atan2(${inp.named('iny')}, ${inp.named('inx')})`),
  expr('exp', fn1('exp')),
  expr('floor', fn1('floor')),
  expr('ceil', fn1('ceil')),
  expr('round', fn1('round')),
  expr('magnitude', fn1('length')),
  expr('distance', fn2('distance')),
  expr('crossproduct', fn2('cross')),
  expr('reflect', (inp, _type, ctx) => `reflect(${inp.named('in')}, ${inp.named('normal', ctx.varyings.normal)})`),
  expr('refract', (inp, _type, ctx) => `refract(${inp.named('in')}, ${inp.named('normal', ctx.varyings.normal)}, ${inp.named('ior', '1.0')})`),
  expr('modulo', (inp) => {
    const a = inp.named('in1');
    const b = inp.named('in2', '1.0');
    return `(${a} - ${b} * floor(${a} / ${b}))`;
  }),
  expr('safepower', (inp, type, ctx) => {
    const a = inp.named('in1');
    return `(sign(${a}) * pow(abs(${a}), ${ctx.wgslType(type)}(${inp.named('in2', '1.0')})))`;
  }),
  expr('smoothstep', (inp, type, ctx) => {
    const target = ctx.wgslType(type);
    const low = `${target}(${inp.named('low', '0.0')})`;
    const high = `${target}(${inp.named('high', '1.0')})`;
    const value = inp.named('in');
    const denominator = `select(${target}(1.0), ${high} - ${low}, ${high} > ${low})`;
    const t = `clamp((${value} - ${low}) / ${denominator}, ${target}(0.0), ${target}(1.0))`;
    const smooth = `(${t} * ${t} * (${target}(3.0) - ${target}(2.0) * ${t}))`;
    return `select(select(${smooth}, ${target}(0.0), ${value} <= ${low}), ${target}(1.0), ${value} >= ${high})`;
  }),
  expr('remap', (inp, type, ctx) => {
    const target = ctx.wgslType(type);
    const inLow = `${target}(${inp.named('inlow', '0.0')})`;
    const inHigh = `${target}(${inp.named('inhigh', '1.0')})`;
    const outLow = `${target}(${inp.named('outlow', '0.0')})`;
    const outHigh = `${target}(${inp.named('outhigh', '1.0')})`;
    const degenerate = `${inHigh} == ${inLow}`;
    const denominator = `select(${inHigh} - ${inLow}, ${target}(1.0), ${degenerate})`;
    const normalized = `((${inp.named('in')} - ${inLow}) / ${denominator})`;
    const mapped = `(${outLow} + ${normalized} * (${outHigh} - ${outLow}))`;
    return `select(${mapped}, ${outLow}, ${degenerate})`;
  }),
  // matrices
  expr('creatematrix', (inp, type) => {
    const a = inp.named('in1');
    const b = inp.named('in2');
    const c = inp.named('in3');
    if (type.kind === 'matrix' && type.size === 4) {
      const d = inp.named('in4');
      return vectorSize(inp.typeOf('in1') ?? type) === 3
        ? `mat4x4f(vec4f(${a}, 0.0), vec4f(${b}, 0.0), vec4f(${c}, 0.0), vec4f(${d}, 1.0))`
        : `mat4x4f(${a}, ${b}, ${c}, ${d})`;
    }
    return `mat3x3f(${a}, ${b}, ${c})`;
  }),
  expr('determinant', fn1('determinant')),
  expr('transpose', fn1('transpose')),
  expr('invertmatrix', (inp, type) => `${type.kind === 'matrix' && type.size === 4 ? 'mx_inverse4' : 'mx_inverse3'}(${inp.named('in')})`, MATRIX_PRELUDE),
  expr('transformmatrix', (inp, type) => {
    const m = inp.named('mat');
    const v = inp.named('in');
    const matType = inp.typeOf('mat');
    const size = vectorSize(type);
    if (size === 2) return `(${m} * vec3f(${v}, 1.0)).xy`;
    if (size === 3 && matType?.kind === 'matrix' && matType.size === 4) return `(${m} * vec4f(${v}, 1.0)).xyz`;
    return `(${m} * ${v})`;
  }),
  // spaces: the shading frame is world space for both backends, so space
  // transforms between object/world are identity here.
  expr('transformpoint', (inp) => inp.named('in')),
  expr('transformvector', (inp) => inp.named('in')),
  expr('transformnormal', (inp) => `normalize(${inp.named('in')})`),
  // compositing
  expr('plus', blend((fg, bg) => `(${bg} + ${fg})`)),
  expr('minus', blend((fg, bg) => `(${bg} - ${fg})`)),
  expr('difference', blend((fg, bg) => `abs(${bg} - ${fg})`)),
  expr('screen', blend((fg, bg, t) => `(${t}(1.0) - (${t}(1.0) - ${fg}) * (${t}(1.0) - ${bg}))`)),
  expr('overlay', blend((fg, bg, t) => `select(${t}(1.0) - 2.0 * (${t}(1.0) - ${fg}) * (${t}(1.0) - ${bg}), 2.0 * ${fg} * ${bg}, ${fg} < ${t}(0.5))`)),
  expr('burn', blend((fg, bg, t) => `select(${t}(1.0) - (${t}(1.0) - ${bg}) / ${fg}, ${t}(0.0), abs(${fg}) < ${t}(1e-6))`)),
  expr('dodge', blend((fg, bg, t) => `select(${bg} / (${t}(1.0) - ${fg}), ${t}(0.0), abs(${t}(1.0) - ${fg}) < ${t}(1e-6))`)),
  expr('premult', (inp) => `vec4f(${inp.named('in')}.rgb * ${inp.named('in')}.a, ${inp.named('in')}.a)`),
  expr('unpremult', (inp) => {
    const c = inp.named('in');
    return `vec4f(${c}.rgb / select(${c}.a, 1.0, ${c}.a == 0.0), ${c}.a)`;
  }),
  // adjustment
  expr('contrast', (inp) => {
    const pivot = inp.named('pivot', '0.5');
    return `((${inp.named('in')} - ${pivot}) * ${inp.named('amount', '1.0')} + ${pivot})`;
  }),
  expr('saturate', (inp, type) => {
    const c = inp.named('in');
    const rgb = vectorSize(type) === 4 ? `${c}.rgb` : c;
    const lum = inp.named('lumacoeffs', 'vec3f(0.2722287, 0.6740818, 0.0536895)');
    const out = `mix(vec3f(dot(${rgb}, ${lum})), ${rgb}, ${inp.named('amount', '1.0')})`;
    return vectorSize(type) === 4 ? `vec4f(${out}, ${c}.a)` : out;
  }),
  expr('colorcorrect', (inp, type) => {
    const c = inp.named('in');
    const rgb = vectorSize(type) === 4 ? `${c}.rgb` : c;
    const args = [
      inp.named('hue', '0.0'),
      inp.named('saturation', '1.0'),
      inp.named('gamma', '1.0'),
      inp.named('lift', '0.0'),
      inp.named('gain', '1.0'),
      inp.named('contrast', '1.0'),
      inp.named('contrastpivot', '0.5'),
      inp.named('exposure', '0.0'),
    ].join(', ');
    const out = `mx_colorcorrect(${rgb}, ${args})`;
    return vectorSize(type) === 4 ? `vec4f(${out}, ${c}.a)` : out;
  }, [HSV_PRELUDE, COLORCORRECT_PRELUDE]),
  expr('blackbody', (inp) => `mx_blackbody(${inp.named('temperature', '5000.0')})`, BLACKBODY_PRELUDE),
  // adjustment
  expr('luminance', (inp, type) => {
    const lum = `mx_luminance(${inp.named('in', undefined, 0)})`;
    return vectorSize(type) === 1 ? `${lum}.x` : vectorSize(type) === 4 ? `vec4f(${lum}, 1.0)` : lum;
  }, LUMINANCE_PRELUDE),
  expr('rgbtohsv', fn1('mx_rgbtohsv'), HSV_PRELUDE),
  expr('hsvtorgb', fn1('mx_hsvtorgb'), HSV_PRELUDE),
  // geometric
  expr('position', (_inp, _type, ctx) => ctx.varyings.position),
  expr('texcoord', (_inp, _type, ctx) => ctx.varyings.texcoord),
  expr('normal', (_inp, _type, ctx) => ctx.varyings.normal),
  expr('tangent', (_inp, _type, ctx) => ctx.varyings.tangent),
  expr('bitangent', (_inp, _type, ctx) => ctx.varyings.bitangent),
  // MaterialX view direction points from the camera towards the surface.
  expr('viewdirection', (_inp, _type, ctx) => `normalize(-${ctx.varyings.viewDir})`),
  expr('geomcolor', (_inp, type, ctx) => `${ctx.wgslType(type)}(1.0)`),
  // Static scenes: no animation clock is bound, time/frame are constants.
  expr('time', () => '0.0'),
  expr('frame', () => '1.0'),
  expr(
    'normalmap',
    (inp, _type, ctx) => `mx_normalmap(${inp.named('in', undefined, 0)}, vec2f(${inp.named('scale', '1.0', 1)}), ${inp.named('normal', ctx.varyings.normal)}, ${inp.named('tangent', ctx.varyings.tangent)}, ${inp.named('bitangent', ctx.varyings.bitangent)})`,
    NORMALMAP_PRELUDE,
  ),
  // texture coordinates / patterns
  expr('place2d', (inp, _type, ctx) => {
    const args = [
      texcoordOf(inp, ctx),
      inp.named('pivot', 'vec2f(0.0)'),
      inp.named('scale', 'vec2f(1.0)'),
      inp.named('rotate', '0.0'),
      inp.named('offset', 'vec2f(0.0)'),
      `i32(${inp.named('operationorder', '0')})`,
    ];
    return `mx_place2d(${args.join(', ')})`;
  }, PLACE2D_PRELUDE),
  expr('ramplr', (inp, type, ctx) => `mix(${inp.named('valuel', zeroOf(type, ctx))}, ${inp.named('valuer', zeroOf(type, ctx))}, clamp(${texcoordOf(inp, ctx)}.x, 0.0, 1.0))`),
  expr('ramptb', (inp, type, ctx) => `mix(${inp.named('valueb', zeroOf(type, ctx))}, ${inp.named('valuet', zeroOf(type, ctx))}, clamp(${texcoordOf(inp, ctx)}.y, 0.0, 1.0))`),
  expr('ramp4', (inp, type, ctx) => {
    const tc = texcoordOf(inp, ctx);
    const z = zeroOf(type, ctx);
    const s = `clamp(${tc}.x, 0.0, 1.0)`;
    const bottom = `mix(${inp.named('valuebl', z)}, ${inp.named('valuebr', z)}, ${s})`;
    const top = `mix(${inp.named('valuetl', z)}, ${inp.named('valuetr', z)}, ${s})`;
    return `mix(${bottom}, ${top}, clamp(${tc}.y, 0.0, 1.0))`;
  }),
  expr('splitlr', (inp, type, ctx) => `mix(${inp.named('valuel', zeroOf(type, ctx))}, ${inp.named('valuer', zeroOf(type, ctx))}, step(${inp.named('center', '0.5')}, ${texcoordOf(inp, ctx)}.x))`),
  expr('splittb', (inp, type, ctx) => `mix(${inp.named('valueb', zeroOf(type, ctx))}, ${inp.named('valuet', zeroOf(type, ctx))}, step(${inp.named('center', '0.5')}, ${texcoordOf(inp, ctx)}.y))`),
  expr('checkerboard', (inp, _type, ctx) => {
    const cell = `floor(${texcoordOf(inp, ctx)} * ${inp.named('uvtiling', 'vec2f(8.0)')} - ${inp.named('uvoffset', 'vec2f(0.0)')})`;
    const sum = `dot(${cell}, vec2f(1.0))`;
    return `mix(${inp.named('color2', 'vec3f(0.0)')}, ${inp.named('color1', 'vec3f(1.0)')}, (${sum} - 2.0 * floor(${sum} / 2.0)))`;
  }),
  expr('circle', (inp, _type, ctx) => {
    const delta = `(${texcoordOf(inp, ctx)} - ${inp.named('center', 'vec2f(0.0)')})`;
    const radius = inp.named('radius', '0.5');
    return `select(1.0, 0.0, dot(${delta}, ${delta}) > ${radius} * ${radius})`;
  }),
  expr('ramp_gradient', (inp) => {
    const args = [
      inp.named('x', '0.0'),
      inp.named('interval1', '0.0'),
      inp.named('interval2', '1.0'),
      inp.named('color1', 'vec4f(0.0, 0.0, 0.0, 1.0)'),
      inp.named('color2', 'vec4f(1.0)'),
      `i32(${inp.named('interpolation', '1')})`,
      inp.named('prev_color', 'vec4f(0.0, 0.0, 0.0, 1.0)'),
      `i32(${inp.named('interval_num', '1')})`,
      `i32(${inp.named('num_intervals', '2')})`,
    ];
    return `mx_ramp_gradient(${args.join(', ')})`;
  }, RAMP_PRELUDE),
  expr('ramp', (inp, _type, ctx) => {
    const x = `mx_ramp_x(${texcoordOf(inp, ctx)}, i32(${inp.named('type', '0')}))`;
    const interpolation = `i32(${inp.named('interpolation', '1')})`;
    const count = `i32(${inp.named('num_intervals', '2')})`;
    const interval = (k: number): string => inp.named(`interval${k}`, k === 1 ? '0.0' : '1.0');
    const color = (k: number): string => inp.named(`color${k}`, k === 1 ? 'vec4f(0.0, 0.0, 0.0, 1.0)' : 'vec4f(1.0)');
    let acc = color(1);
    for (let k = 1; k <= 9; k++) {
      acc = `mx_ramp_gradient(${x}, ${interval(k)}, ${interval(k + 1)}, ${color(k)}, ${color(k + 1)}, ${interpolation}, ${acc}, ${k}, ${count})`;
    }
    return acc;
  }, RAMP_PRELUDE),
  // Graph-aware finite differences are emitted by lowerExprs for both stages.
  expr('heighttonormal', (inp, _type, ctx) => {
    if (ctx.computeStage) throw new Error('heighttonormal requires graph-aware UV finite differences');
    const h = inp.named('in', '0.0');
    const uv = texcoordOf(inp, ctx);
    return `mx_heighttonormal(vec2f(dpdx(${h}), dpdy(${h})), vec2f(dpdx(${uv}.x), dpdy(${uv}.x)), vec2f(dpdx(${uv}.y), dpdy(${uv}.y)), ${inp.named('scale', '1.0')})`;
  }, HEIGHTTONORMAL_PRELUDE),
  expr('bump', (inp, _type, ctx) => {
    const normal = inp.named('normal', ctx.varyings.normal);
    if (ctx.computeStage) return normal;
    const h = inp.named('height', '0.0');
    const uv = ctx.varyings.texcoord;
    const encoded = `mx_heighttonormal(vec2f(dpdx(${h}), dpdy(${h})), vec2f(dpdx(${uv}.x), dpdy(${uv}.x)), vec2f(dpdx(${uv}.y), dpdy(${uv}.y)), 1.0)`;
    return `mx_normalmap(${encoded}, vec2f(${inp.named('scale', '1.0')}), ${normal}, ${inp.named('tangent', ctx.varyings.tangent)}, ${inp.named('bitangent', ctx.varyings.bitangent)})`;
  }, [HEIGHTTONORMAL_PRELUDE, NORMALMAP_PRELUDE]),
  // noise
  expr('noise2d', (inp, type, ctx) => {
    const p = `vec3f(${texcoordOf(inp, ctx)}, 0.0)`;
    const n = fitNoise(type, (seed) => `mx_perlin3(${p}, ${seed})`, `mx_perlin3v(${p})`);
    return `(${n} * ${inp.named('amplitude', '1.0')} + ${inp.named('pivot', '0.0')})`;
  }, NOISE_PRELUDE),
  expr('noise3d', (inp, type, ctx) => {
    const p = positionOf(inp, ctx);
    const n = fitNoise(type, (seed) => `mx_perlin3(${p}, ${seed})`, `mx_perlin3v(${p})`);
    return `(${n} * ${inp.named('amplitude', '1.0')} + ${inp.named('pivot', '0.0')})`;
  }, NOISE_PRELUDE),
  expr('fractal2d', (inp, type, ctx) => {
    const p = `vec3f(${texcoordOf(inp, ctx)}, 0.0)`;
    const args = `i32(${inp.named('octaves', '3')}), ${inp.named('lacunarity', '2.0')}, ${inp.named('diminish', '0.5')}`;
    const n = fitNoise(type, (seed) => `mx_fractal3(${p}, ${args}, ${seed})`, `mx_fractal3v(${p}, ${args})`);
    return `(${n} * ${inp.named('amplitude', '1.0')})`;
  }, NOISE_PRELUDE),
  expr('cellnoise2d', (inp, type, ctx) => `${ctx.wgslType(type)}(mx_cellnoise3(vec3f(${texcoordOf(inp, ctx)}, 0.0)))`, NOISE_PRELUDE),
  expr('cellnoise3d', (inp, type, ctx) => `${ctx.wgslType(type)}(mx_cellnoise3(${positionOf(inp, ctx)}))`, NOISE_PRELUDE),
  expr('worleynoise2d', (inp, type, ctx) => {
    const w = `mx_worley(vec3f(${texcoordOf(inp, ctx)}, 0.0), ${inp.named('jitter', '1.0')}, 2, i32(${inp.named('style', '0')}), ${vectorSize(type)})`;
    return vectorSize(type) === 1 ? `${w}.x` : vectorSize(type) === 2 ? `${w}.xy` : w;
  }, [MATERIALX_NOISE_HASH_PRELUDE, WORLEY_PRELUDE]),
  expr('worleynoise3d', (inp, type, ctx) => {
    const w = `mx_worley(${positionOf(inp, ctx)}, ${inp.named('jitter', '1.0')}, 3, i32(${inp.named('style', '0')}), ${vectorSize(type)})`;
    return vectorSize(type) === 1 ? `${w}.x` : vectorSize(type) === 2 ? `${w}.xy` : w;
  }, [MATERIALX_NOISE_HASH_PRELUDE, WORLEY_PRELUDE]),
  ...(['unifiednoise2d', 'unifiednoise3d'] as const).map((category) => expr(category, (inp, _type, ctx) => {
    const is2d = category === 'unifiednoise2d';
    const scaled = `${is2d ? texcoordOf(inp, ctx) : positionOf(inp, ctx)} * ${inp.named('freq', '1.0')} + ${inp.named('offset', '0.0')}`;
    const p = is2d ? `vec3f(${scaled}, 0.0)` : `(${scaled})`;
    const args = [
      p,
      is2d ? '2' : '3',
      inp.named('jitter', '1.0'),
      `i32(${inp.named('octaves', '3')})`,
      inp.named('lacunarity', '2.0'),
      inp.named('diminish', '0.5'),
      `i32(${inp.named('type', '0')})`,
      `i32(${inp.named('style', '0')})`,
    ];
    const outMin = inp.named('outmin', '0.0');
    const outMax = inp.named('outmax', '1.0');
    const mapped = `mix(${outMin}, ${outMax}, mx_unifiednoise(${args.join(', ')}))`;
    return `select(${mapped}, clamp(${mapped}, min(${outMin}, ${outMax}), max(${outMin}, ${outMax})), ${inp.named('clampoutput', 'true')})`;
  }, [ROTATE2D_PRELUDE, ROTATE3D_PRELUDE, NOISE_PRELUDE, MATERIALX_NOISE_HASH_PRELUDE, WORLEY_PRELUDE, UNIFIED_NOISE_PRELUDE])),
  // transforms
  expr('rotate2d', (inp) => `mx_rotate2d(${inp.named('in', undefined, 0)}, ${inp.named('amount', '0.0', 1)})`, ROTATE2D_PRELUDE),
  expr('rotate3d', (inp) => `mx_rotate3d(${inp.named('in', undefined, 0)}, ${inp.named('amount', '0.0', 1)}, ${inp.named('axis', 'vec3f(0.0, 0.0, 1.0)', 2)})`, ROTATE3D_PRELUDE),
  // procedural
  expr('fractal3d', (inp, type, ctx) => {
    if (!inp.has('lacunarity') && !inp.has('diminish')) {
      const octaves = `f32(${inp.named('octaves', '3.0', 1)})`;
      if (vectorSize(type) === 1) return `mx_fractal3d(${ctx.varyings.position}, ${inp.named('amplitude', '1.0', 0)}, ${octaves})`;
      return `(${ctx.wgslType(type)}(mx_fractal3d(${ctx.varyings.position}, 1.0, ${octaves})) * ${inp.named('amplitude', '1.0', 0)})`;
    }
    const p = positionOf(inp, ctx);
    const args = `i32(${inp.named('octaves', '3')}), ${inp.named('lacunarity', '2.0')}, ${inp.named('diminish', '0.5')}`;
    const n = fitNoise(type, (seed) => `mx_fractal3(${p}, ${args}, ${seed})`, `mx_fractal3v(${p}, ${args})`);
    return `(${n} * ${inp.named('amplitude', '1.0')})`;
  }, [FRACTAL3D_PRELUDE, NOISE_PRELUDE]),
  // pbr helpers
  expr('artistic_ior', (inp) => `mx_artistic_ior(${inp.named('reflectivity', undefined, 0)}, ${inp.named('edge_color', 'vec3f(0.0)', 1)})`, ARTISTIC_IOR_PRELUDE),
  expr('artistic_ior_extinction', (inp) => `mx_artistic_ior_extinction(${inp.named('reflectivity', undefined, 0)}, ${inp.named('edge_color', 'vec3f(0.0)', 1)})`, ARTISTIC_IOR_PRELUDE),
  expr('roughness_anisotropy', (inp) => `mx_roughness_anisotropy(${inp.named('roughness', '0.0', 0)}, ${inp.named('anisotropy', '0.0', 1)})`, ROUGHNESS_ANISO_PRELUDE),
  expr('roughness_dual', (inp) => `mx_roughness_dual(${inp.named('roughness', 'vec2f(0.0)', 0)})`, ROUGHNESS_DUAL_PRELUDE),
  expr('open_pbr_anisotropy', (inp) => {
    const inv = `(1.0 - ${inp.named('anisotropy', '0.0')})`;
    const r = inp.named('roughness', '0.0');
    const ax = `(${r} * ${r} * sqrt(2.0 / (1.0 + ${inv} * ${inv})))`;
    return `vec2f(${ax}, ${inv} * ${ax})`;
  }),
  expr('chiang_hair_absorption_from_color', (inp) => `mx_chiang_hair_absorption_from_color(${inp.named('color', undefined, 0)})`, HAIR_PRELUDE),
  expr('chiang_hair_roughness', (inp) => `mx_chiang_hair_roughness(${inp.named('longitudinal', '0.0', 0)}, ${inp.named('azimuthal', '0.0', 1)})`, HAIR_PRELUDE),
  expr('deon_hair_absorption_from_melanin', (inp) => `mx_deon_hair_absorption_from_melanin(${inp.named('melanin_concentration', '0.0', 0)}, ${inp.named('melanin_redness', '0.0', 1)})`, HAIR_PRELUDE),
  // closures (BSDF / EDF / VDF / surface)
  closure(
    'oren_nayar_diffuse_bsdf',
    (inp, _type, ctx) => `mx_oren_nayar_diffuse_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(0.18)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'burley_diffuse_bsdf',
    (inp, _type, ctx) => `mx_burley_diffuse_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(0.18)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'translucent_bsdf',
    (inp, _type, ctx) => `mx_translucent_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(1.0)')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'dielectric_bsdf',
    (inp, _type, ctx) => `mx_dielectric_bsdf(${inp.named('weight', '1.0')}, ${inp.named('tint', 'vec3f(1.0)')}, ${inp.named('ior', '1.5')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'conductor_bsdf',
    (inp, _type, ctx) => `mx_conductor_bsdf(${inp.named('weight', '1.0')}, ${inp.named('ior', 'vec3f(0.18)')}, ${inp.named('extinction', 'vec3f(3.0)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'generalized_schlick_bsdf',
    (inp, _type, ctx) => `mx_generalized_schlick_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color0', 'vec3f(1.0)')}, ${inp.named('color90', 'vec3f(1.0)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'sheen_bsdf',
    (inp, _type, ctx) => `mx_sheen_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(1.0)')}, ${inp.named('roughness', '0.3')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'subsurface_bsdf',
    (inp, _type, ctx) => `mx_subsurface_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(1.0)')}, ${inp.named('radius', 'vec3f(1.0)')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure(
    'chiang_hair_bsdf',
    (inp) => `mx_chiang_hair_bsdf(${inp.named('weight', '1.0')}, ${inp.named('tint', 'vec3f(1.0)')}, ${inp.named('roughness', 'vec2f(0.1)')})`,
  ),
  closure(
    'anisotropic_vdf',
    (inp, _type, ctx) => `mx_anisotropic_vdf(${inp.named('absorption', 'vec3f(0.0)')}, ${inp.named('scattering', 'vec3f(0.0)')}, ${inp.named('anisotropy', '0.0')}, ${ctx.varyings.viewDir})`,
    BSDF_PRELUDE,
  ),
  closure('uniform_edf', (inp) => `mx_uniform_edf(${inp.named('color', 'vec3f(0.0)')})`),
  closure(
    'generalized_schlick_edf',
    (inp, _type, ctx) => `mx_generalized_schlick_edf(${inp.named('color', 'vec3f(0.0)')}, ${inp.named('tint', 'vec3f(1.0)')}, ${inp.named('normal', ctx.varyings.normal)}, ${ctx.varyings.viewDir})`,
  ),
  closure('surface', (inp) => `mx_surface(${inp.named('bsdf', 'mx_closure_zero()')}, ${inp.named('edf', 'mx_closure_zero()')}, ${inp.named('opacity', '1.0')})`, SURFACE_PRELUDE),
];

export const NODE_REGISTRY: ReadonlyMap<string, NodeLowering> = new Map(LOWERINGS.map((l) => [l.category, l]));

/** Categories lowered directly to IR primitives by the emitter (textures, layering, material root). */
export const PRIMITIVE_LOWERED: ReadonlySet<string> = new Set([
  'image',
  'tiledimage',
  'hextiledimage',
  'layer',
  'surfacematerial',
  'displacement',
]);

export function getNodeLowering(category: string): NodeLowering | undefined {
  return NODE_REGISTRY.get(category);
}

export function isNodeCovered(category: string): boolean {
  return NODE_REGISTRY.has(category) || PRIMITIVE_LOWERED.has(category);
}

export function coveredCategories(): string[] {
  return [...NODE_REGISTRY.keys(), ...PRIMITIVE_LOWERED];
}
