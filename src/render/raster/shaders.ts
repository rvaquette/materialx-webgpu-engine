// Executable raster resolve WGSL (plan section 9.4). Forward opaque shading now
// lives in the compiled IR forward shader (ir-forward.ts); this module keeps the
// fullscreen resolve pass that applies exposure, tonemapping and the sRGB OETF to
// the swapchain, mirroring the CPU reference in src/render/output.ts so both
// paths agree.

import type { Tonemap } from '../output.ts';

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

/** Shared display transform; inputs are linear HDR, outputs are encoded sRGB. */
export function displayTransformWgsl(op: Tonemap): string {
  return `
fn srgb(c : vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}
fn display_color(hdr: vec3<f32>, exposure: f32) -> vec3<f32> {
  var c = max(hdr, vec3<f32>(0.0)) * exp2(exposure);
  c = ${tonemapExpr(op)};
  return srgb(clamp(c, vec3<f32>(0.0), vec3<f32>(1e8)));
}`;
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

${displayTransformWgsl(op)}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let hdr = textureSample(hdrTex, hdrSampler, vec2<f32>(in.uv.x, 1.0 - in.uv.y)).rgb;
  return vec4<f32>(display_color(hdr, r.exposure), 1.0);
}`;
}
