// Executable raster WGSL shaders (plan sections 9.1 and 9.4, T026b/T045). These
// are the real entry-point shaders the WebGPU backend compiles: a forward opaque
// pass that transforms geometry and shades it with the composed OpenPBR surface
// into a linear HDR target, and a fullscreen resolve pass that applies exposure,
// tonemapping and the sRGB OETF to the swapchain. The resolve mirrors the CPU
// reference in src/render/output.ts so both paths agree. The forward fragment
// evaluates the same canonical OpenPBR surface the analytic reference composes
// (src/render/bsdf/reference.ts evaluateSurface): a Burley diffuse, translucent
// and wrap-diffuse subsurface base, a dielectric specular coat layered over it,
// and a generalized-Schlick metal lobe mixed in by metalness.

import type { Tonemap } from '../output.ts';

/**
 * Shared OpenPBR surface evaluation in WGSL (T045). This is a self-contained,
 * context-independent block of helper functions and a single `mx_openpbr_surface`
 * entry that both the executable forward fragment (below) and the scene device
 * harness (tests/render/scene-device.harness.ts) embed, so the two GPU callers
 * evaluate exactly one surface model. The math mirrors, lobe for lobe and op for
 * op, the independent TypeScript reference in src/render/bsdf/reference.ts
 * (evaluateSurface): a single directional light with `L = normalize(-direction)`
 * and `radiance = color * intensity`, a constant environment radiance added once
 * per lobe, GGX/Trowbridge-Reitz microfacet with Smith masking, Schlick Fresnel,
 * Burley diffuse, wrap-diffuse subsurface and the mix/layer composition. The
 * reference stays the oracle; this block is validated against it on real GPUs.
 */
export function openPbrSurfaceWgsl(): string {
  return `struct MxSurface {
  baseColor : vec3<f32>,
  metalness : f32,
  roughness : f32,
  transmission : f32,
  subsurface : f32,
  ior : f32,
  specular : f32,
};

struct MxLight {
  direction : vec3<f32>,
  color : vec3<f32>,
  intensity : f32,
  environment : vec3<f32>,
};

struct MxClosure {
  color : vec3<f32>,
  weight : f32,
};

const MX_PI : f32 = 3.14159265358979;

fn mx_ggx_ndf(NdotH : f32, a : f32) -> f32 {
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(MX_PI * d * d, 1e-7);
}

fn mx_smith_g1(NdotX : f32, a : f32) -> f32 {
  let a2 = a * a;
  return (2.0 * NdotX) / max(NdotX + sqrt(a2 + (1.0 - a2) * NdotX * NdotX), 1e-7);
}

fn mx_fresnel_schlick(F0 : vec3<f32>, cosTheta : f32) -> vec3<f32> {
  let f = pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  return F0 + (vec3<f32>(1.0) - F0) * f;
}

fn mx_fresnel_schlick_f90(F0 : vec3<f32>, F90 : vec3<f32>, cosTheta : f32) -> vec3<f32> {
  let f = pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  return F0 + (F90 - F0) * f;
}

fn mx_ggx_reflection(F : vec3<f32>, a : f32, N : vec3<f32>, V : vec3<f32>, L : vec3<f32>) -> vec3<f32> {
  let NdotL = max(dot(N, L), 0.0);
  let NdotV = max(dot(N, V), 0.0);
  if (NdotL <= 0.0 || NdotV <= 0.0) {
    return vec3<f32>(0.0);
  }
  let H = normalize(L + V);
  let NdotH = max(dot(N, H), 0.0);
  let D = mx_ggx_ndf(NdotH, a);
  let G = mx_smith_g1(NdotL, a) * mx_smith_g1(NdotV, a);
  return F * (D * G / (4.0 * NdotV));
}

fn mx_burley_diffuse(weight : f32, color : vec3<f32>, roughness : f32, N : vec3<f32>, V : vec3<f32>, lit : MxLight) -> MxClosure {
  let NdotV = max(dot(N, V), 1e-4);
  var acc = color * lit.environment;
  let L = normalize(-lit.direction);
  let radiance = lit.color * lit.intensity;
  let NdotL = max(dot(N, L), 0.0);
  if (NdotL > 0.0) {
    let H = normalize(L + V);
    let LdotH = max(dot(L, H), 0.0);
    let fd90 = 0.5 + 2.0 * roughness * LdotH * LdotH;
    let fl = pow(1.0 - NdotL, 5.0);
    let fv = pow(1.0 - NdotV, 5.0);
    let fd = (1.0 + (fd90 - 1.0) * fl) * (1.0 + (fd90 - 1.0) * fv);
    acc = acc + color * (fd * NdotL / MX_PI) * radiance;
  }
  return MxClosure(acc * weight, weight);
}

fn mx_translucent(weight : f32, color : vec3<f32>, N : vec3<f32>, lit : MxLight) -> MxClosure {
  var acc = color * lit.environment;
  let L = normalize(-lit.direction);
  let radiance = lit.color * lit.intensity;
  let NdotL = max(dot(-N, L), 0.0);
  acc = acc + color * (NdotL / MX_PI) * radiance;
  return MxClosure(acc * weight, weight);
}

fn mx_subsurface(weight : f32, color : vec3<f32>, N : vec3<f32>, lit : MxLight) -> MxClosure {
  let wrap = 0.5;
  var acc = color * lit.environment;
  let L = normalize(-lit.direction);
  let radiance = lit.color * lit.intensity;
  let wrapped = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
  acc = acc + color * (wrapped / MX_PI) * radiance;
  return MxClosure(acc * weight, weight);
}

fn mx_dielectric(weight : f32, tint : vec3<f32>, ior : f32, roughness : f32, N : vec3<f32>, V : vec3<f32>, lit : MxLight) -> MxClosure {
  let a = max(roughness * roughness, 1e-3);
  let r = (ior - 1.0) / (ior + 1.0);
  let f0 = clamp(r * r, 0.0, 1.0);
  let F0 = vec3<f32>(f0);
  var acc = tint * lit.environment * f0;
  let L = normalize(-lit.direction);
  let radiance = lit.color * lit.intensity;
  let H = normalize(L + V);
  let VdotH = max(dot(V, H), 0.0);
  let F = mx_fresnel_schlick(F0, VdotH);
  acc = acc + tint * mx_ggx_reflection(F, a, N, V, L) * radiance;
  return MxClosure(acc * weight, weight);
}

fn mx_conductor_schlick(weight : f32, color0 : vec3<f32>, color90 : vec3<f32>, roughness : f32, N : vec3<f32>, V : vec3<f32>, lit : MxLight) -> MxClosure {
  let a = max(roughness * roughness, 1e-3);
  var acc = color0 * lit.environment;
  let L = normalize(-lit.direction);
  let radiance = lit.color * lit.intensity;
  let H = normalize(L + V);
  let VdotH = max(dot(V, H), 0.0);
  let F = mx_fresnel_schlick_f90(color0, color90, VdotH);
  acc = acc + mx_ggx_reflection(F, a, N, V, L) * radiance;
  return MxClosure(acc * weight, weight);
}

fn mx_closure_mix(a : MxClosure, b : MxClosure, t : f32) -> MxClosure {
  return MxClosure(a.color * (1.0 - t) + b.color * t, a.weight * (1.0 - t) + b.weight * t);
}

fn mx_layer(top : MxClosure, base : MxClosure) -> MxClosure {
  let t = clamp(top.weight, 0.0, 1.0);
  return MxClosure(top.color + base.color * (1.0 - t), t + base.weight * (1.0 - t));
}

fn mx_openpbr_surface(m : MxSurface, N : vec3<f32>, V : vec3<f32>, lit : MxLight) -> vec3<f32> {
  let white = vec3<f32>(1.0);
  let diffuseWeight = (1.0 - m.metalness) * (1.0 - m.transmission);
  let diffuse = mx_burley_diffuse(diffuseWeight, m.baseColor, m.roughness, N, V, lit);
  let trans = mx_translucent(m.transmission, m.baseColor, N, lit);
  let subs = mx_subsurface(m.subsurface, m.baseColor, N, lit);
  let spec = mx_dielectric(m.specular, white, m.ior, m.roughness, N, V, lit);
  let metal = mx_conductor_schlick(m.metalness, m.baseColor, white, m.roughness, N, V, lit);
  let base1 = mx_closure_mix(diffuse, trans, m.transmission);
  let base2 = mx_closure_mix(base1, subs, m.subsurface);
  let dielectricSurface = mx_layer(spec, base2);
  let bsdf = mx_closure_mix(dielectricSurface, metal, m.metalness);
  return bsdf.color;
}`;
}

/**
 * Forward opaque pass. Vertex stage transforms position by the view-projection
 * matrix and forwards the world-space normal and position; fragment stage
 * evaluates the composed OpenPBR surface (openPbrSurfaceWgsl) with the view
 * direction `V = normalize(eye - worldPos)` and writes linear HDR radiance
 * (rgba16float target). The uniform carries the camera eye, the directional
 * light (scene-convention travel direction + color/intensity), a constant
 * environment radiance and the seven canonical surface parameters.
 */
export function forwardOpaqueWgsl(): string {
  return `struct Uniforms {
  viewProj : mat4x4<f32>,
  eye : vec4<f32>,
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  baseColor : vec4<f32>,
  material : vec4<f32>,
  coat : vec4<f32>,
  environment : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

${openPbrSurfaceWgsl()}

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) normal : vec3<f32>,
  @location(1) worldPos : vec3<f32>,
};

@vertex
fn vs_main(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>) -> VsOut {
  var out : VsOut;
  out.clip = u.viewProj * vec4<f32>(position, 1.0);
  out.normal = normal;
  out.worldPos = position;
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let v = normalize(u.eye.xyz - in.worldPos);
  var m : MxSurface;
  m.baseColor = u.baseColor.rgb;
  m.metalness = u.material.x;
  m.roughness = u.material.y;
  m.transmission = u.material.z;
  m.subsurface = u.material.w;
  m.ior = u.coat.x;
  m.specular = u.coat.y;
  var lit : MxLight;
  lit.direction = u.lightDir.xyz;
  lit.color = u.lightColor.rgb;
  lit.intensity = u.lightColor.w;
  lit.environment = u.environment.rgb;
  let radiance = mx_openpbr_surface(m, n, v, lit);
  return vec4<f32>(radiance, 1.0);
}`;
}

/**
 * Scene forward pass (T051). The multi-object variant of forwardOpaqueWgsl: each
 * instance carries its own model matrix so one pipeline renders every scene
 * object, and position/normal arrive in two separate vertex buffers to match the
 * un-interleaved streams produced by the SceneAsset -> GPU bridge (T050,
 * src/render/scene-resources.ts). The vertex stage transforms position and
 * normal to world space; the fragment stage evaluates the same canonical OpenPBR
 * surface (openPbrSurfaceWgsl) as the single-object forward path. The uniform
 * adds the model matrix ahead of the shared camera/light/surface block.
 */
export function sceneForwardWgsl(): string {
  return `struct Uniforms {
  model : mat4x4<f32>,
  viewProj : mat4x4<f32>,
  eye : vec4<f32>,
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  baseColor : vec4<f32>,
  material : vec4<f32>,
  coat : vec4<f32>,
  environment : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

${openPbrSurfaceWgsl()}

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) normal : vec3<f32>,
  @location(1) worldPos : vec3<f32>,
};

@vertex
fn vs_main(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>) -> VsOut {
  var out : VsOut;
  let world = u.model * vec4<f32>(position, 1.0);
  out.clip = u.viewProj * world;
  out.normal = (u.model * vec4<f32>(normal, 0.0)).xyz;
  out.worldPos = world.xyz;
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let v = normalize(u.eye.xyz - in.worldPos);
  var m : MxSurface;
  m.baseColor = u.baseColor.rgb;
  m.metalness = u.material.x;
  m.roughness = u.material.y;
  m.transmission = u.material.z;
  m.subsurface = u.material.w;
  m.ior = u.coat.x;
  m.specular = u.coat.y;
  var lit : MxLight;
  lit.direction = u.lightDir.xyz;
  lit.color = u.lightColor.rgb;
  lit.intensity = u.lightColor.w;
  lit.environment = u.environment.rgb;
  let radiance = mx_openpbr_surface(m, n, v, lit);
  return vec4<f32>(radiance, u.baseColor.a);
}`;
}

function tonemapExpr(op: Tonemap): string {
  switch (op) {
    case 'none':
      return 'c';
    case 'reinhard':
      return 'c / (vec3<f32>(1.0) + c)';
    case 'acesFilmic':
      return 'clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0))';
  }
}

/**
 * Fullscreen resolve pass. Vertex stage emits a single covering triangle;
 * fragment stage samples the linear HDR target, applies exposure and the chosen
 * tonemap, then encodes with the sRGB OETF. Exposure is a push-style uniform.
 */
export function tonemapResolveWgsl(op: Tonemap): string {
  return `struct Resolve {
  exposure : f32,
};
@group(0) @binding(0) var hdrTex : texture_2d<f32>;
@group(0) @binding(1) var hdrSampler : sampler;
@group(0) @binding(2) var<uniform> r : Resolve;

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VsOut {
  var out : VsOut;
  let uv = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u));
  out.uv = uv;
  out.clip = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

fn srgb(c : vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let hdr = textureSample(hdrTex, hdrSampler, vec2<f32>(in.uv.x, 1.0 - in.uv.y)).rgb;
  var c = hdr * exp2(r.exposure);
  c = ${tonemapExpr(op)};
  return vec4<f32>(srgb(clamp(c, vec3<f32>(0.0), vec3<f32>(1e8))), 1.0);
}`;
}
