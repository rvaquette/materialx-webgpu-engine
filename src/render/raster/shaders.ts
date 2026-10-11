// Executable raster WGSL shaders (plan sections 9.1 and 9.4, T026b). These are
// the real entry-point shaders the WebGPU backend compiles: a forward opaque
// pass that transforms geometry and shades it with a directional light into a
// linear HDR target, and a fullscreen resolve pass that applies exposure,
// tonemapping and the sRGB OETF to the swapchain. The resolve mirrors the CPU
// reference in src/render/output.ts so both paths agree. Material (mx_shade)
// integration plugs into the fragment stage of the forward shader later.

import type { Tonemap } from '../output.ts';

/**
 * Forward opaque pass. Vertex stage transforms position by the view-projection
 * matrix and forwards the world-space normal; fragment stage evaluates a simple
 * Lambert + ambient term and writes linear HDR radiance (rgba16float target).
 */
export function forwardOpaqueWgsl(): string {
  return `struct Uniforms {
  viewProj : mat4x4<f32>,
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  baseColor : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) normal : vec3<f32>,
};

@vertex
fn vs_main(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>) -> VsOut {
  var out : VsOut;
  out.clip = u.viewProj * vec4<f32>(position, 1.0);
  out.normal = normal;
  return out;
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let l = normalize(u.lightDir.xyz);
  let ndotl = max(dot(n, l), 0.0);
  let ambient = 0.03;
  let lit = u.baseColor.rgb * (ambient + u.lightColor.rgb * ndotl);
  return vec4<f32>(lit, 1.0);
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
