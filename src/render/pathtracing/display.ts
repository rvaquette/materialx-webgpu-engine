import { displayTransformWgsl } from '../raster/shaders.ts';

export const PT_DISPLAY_PIXEL_BYTES = 48;
export const PT_DISPLAY_INFO_BYTES = 144;

/** Hysteresis keeps resolution stable while targeting a ~40 ms preview budget. */
export function previewScale(scale: number, milliseconds: number): number {
  if (milliseconds > 55) return Math.min(8, scale * 2);
  if (milliseconds < 22) return Math.max(2, scale / 2);
  return scale;
}

export function pathTraceDisplayWgsl(environment: boolean): string {
  return `
struct Info {
  size: vec2u, exposure: f32, denoise: u32,
  previewSize: vec2u, outputSize: vec2u,
  backgroundInverse: mat4x4f, eye: vec4f, env: vec4f, constantEnv: vec4f,
};
@group(0) @binding(0) var<storage, read> pixels: array<vec4f>;
@group(0) @binding(1) var<uniform> info: Info;
@group(0) @binding(2) var<storage, read> preview: array<vec4f>;
${environment ? `
@group(0) @binding(3) var dome: texture_2d<f32>;
@group(0) @binding(4) var domeSampler: sampler;
` : ''}
struct Sample { radiance: vec3f, count: f32, guide: vec4f, coverage: f32 };
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
${displayTransformWgsl('acesFilmic')}
fn load_preview(uv: vec2f) -> Sample {
  var result = Sample(vec3f(0.0), 0.0, vec4f(0.0), 0.0);
  if (info.previewSize.x == 0u) { return result; }
  let p = uv * vec2f(info.previewSize) - 0.5;
  let base = vec2i(floor(p));
  let f = fract(p);
  for (var y = 0; y <= 1; y++) {
    for (var x = 0; x <= 1; x++) {
      let xy = vec2u(clamp(base + vec2i(x, y), vec2i(0), vec2i(info.previewSize) - 1));
      let index = (xy.y * info.previewSize.x + xy.x) * 3u;
      let weight = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1);
      result.radiance += preview[index].xyz * weight;
      result.count += preview[index].w * weight;
      result.guide += preview[index + 1u] * weight;
      result.coverage += preview[index + 2u].x * weight;
    }
  }
  return result;
}
fn load_pixel(p: vec2i) -> Sample {
  let xy = vec2u(clamp(p, vec2i(0), vec2i(info.size) - 1));
  let i = (xy.y * info.size.x + xy.x) * 3u;
  if (pixels[i].w == 0.0) {
    return load_preview((vec2f(xy) + 0.5) / vec2f(info.size));
  }
  return Sample(pixels[i].xyz, pixels[i].w, pixels[i + 1u], pixels[i + 2u].x);
}
fn reconstruct(uv: vec2f) -> Sample {
  if (all(info.size == info.outputSize)) {
    return load_pixel(vec2i(uv * vec2f(info.size)));
  }
  let p = uv * vec2f(info.size) - 0.5;
  let base = vec2i(floor(p));
  let f = fract(p);
  var result = Sample(vec3f(0.0), 0.0, vec4f(0.0), 0.0);
  for (var y = 0; y <= 1; y++) {
    for (var x = 0; x <= 1; x++) {
      let s = load_pixel(base + vec2i(x, y));
      let w = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1);
      result.radiance += s.radiance * w;
      result.count += s.count * w;
      result.guide += s.guide * w;
      result.coverage += s.coverage * w;
    }
  }
  return result;
}
fn filtered(center: Sample, p: vec2i) -> vec3f {
  if (info.denoise == 0u || center.coverage < 0.999 || center.count == 0.0) {
    return center.radiance;
  }
  var color = center.radiance;
  var total = 1.0;
  let luminance = vec3f(0.2126, 0.7152, 0.0722);
  let lum = dot(center.radiance, luminance);
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      if (x == 0 && y == 0) { continue; }
      let s = load_pixel(p + vec2i(x, y));
      if (s.count == 0.0 || s.coverage < 0.999) { continue; }
      let a = center.guide.xyz * inverseSqrt(max(dot(center.guide.xyz, center.guide.xyz), 1e-12));
      let b = s.guide.xyz * inverseSqrt(max(dot(s.guide.xyz, s.guide.xyz), 1e-12));
      let normal = pow(max(dot(a, b), 0.0), 32.0);
      let depth = exp(-100.0 * abs(center.guide.w - s.guide.w) / max(center.guide.w, 1e-5));
      let range = exp(-abs(lum - dot(s.radiance, luminance)) / (0.25 + abs(lum) * 1.5));
      let spatial = exp(-f32(x*x + y*y) * 0.5);
      let w = normal * depth * range * spatial;
      color += s.radiance * w;
      total += w;
    }
  }
  // Fade filtering as the unbiased accumulated image converges.
  return mix(center.radiance, color / total, min(1.0, 8.0 / max(center.count, 1.0)));
}
fn background(uv: vec2f) -> vec3f {
${environment ? `
  let near = info.backgroundInverse * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  let d = normalize(near.xyz / near.w - info.eye.xyz);
  let texcoord = vec2f(atan2(d.z, d.x) * (0.5 / 3.14159265358979) + 0.5,
    acos(clamp(d.y, -1.0, 1.0)) / 3.14159265358979);
  return textureSampleLevel(dome, domeSampler, texcoord, 0.0).xyz * info.env.xyz;
` : '  return info.constantEnv.xyz;'}
}
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let uv = frag.xy / vec2f(info.outputSize);
  let center = reconstruct(uv);
  let p = vec2i(uv * vec2f(info.size));
  let foreground = filtered(center, p);
  let hdr = foreground + (1.0 - clamp(center.coverage, 0.0, 1.0)) * background(uv);
  return vec4f(display_color(hdr, info.exposure), 1.0);
}`;
}
