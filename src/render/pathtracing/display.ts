import { displayTransformWgsl } from '../raster/shaders.ts';

export const PT_DISPLAY_PIXEL_BYTES = 32;
export const PT_SURFACE_AOV_PIXEL_BYTES = 16;
export const PT_DISPLAY_INFO_BYTES = 144;

export const PATH_TRACE_VIEWS = [
  { value: 'beauty', label: 'Rendu final' },
  { value: 'albedo', label: 'Albedo diffus' },
  { value: 'normal', label: 'Normales (monde)' },
  { value: 'depth', label: 'Profondeur' },
  { value: 'variance', label: 'Variance de luminance' },
  { value: 'emission', label: 'Émission primaire' },
  { value: 'transmission', label: 'Transmission matériau' },
] as const;
export type PathTraceView = typeof PATH_TRACE_VIEWS[number]['value'];

export interface PathTraceAovData {
  width: number;
  height: number;
  channels: 1 | 3;
  values: Float32Array;
}

export function pathTraceViewStoresAov(view: PathTraceView): boolean {
  return view !== 'beauty' && view !== 'variance';
}

export function pathTraceStorageBytesPerPixel(view: PathTraceView): number {
  return PT_DISPLAY_PIXEL_BYTES + (pathTraceViewStoresAov(view) ? PT_SURFACE_AOV_PIXEL_BYTES : 0);
}

export function pathTraceViewIndex(view: PathTraceView): number {
  return PATH_TRACE_VIEWS.findIndex(option => option.value === view);
}

/** Hysteresis keeps resolution stable while targeting a ~40 ms preview budget. */
export function previewScale(scale: number, milliseconds: number): number {
  if (milliseconds > 55) return Math.min(8, scale * 2);
  if (milliseconds < 22) return Math.max(2, scale / 2);
  return scale;
}

export function pathTraceDisplayWgsl(environment: boolean, dynamicTonemap = false, surfaceAovs = false): string {
  return `
struct Info {
  size: vec2u, exposure: f32, neuralEnabled: u32,
  previewSize: vec2u, outputSize: vec2u,
  backgroundInverse: mat4x4f, eye: vec4f, env: vec4f, constantEnv: vec4f,
};
@group(0) @binding(0) var<storage, read> pixels: array<vec4f>;
@group(0) @binding(1) var<uniform> info: Info;
@group(0) @binding(2) var<storage, read> preview: array<vec4f>;
@group(0) @binding(5) var neuralOutput: texture_2d<f32>;
${environment ? `
@group(0) @binding(3) var dome: texture_2d<f32>;
@group(0) @binding(4) var domeSampler: sampler;
` : ''}
struct Sample { radiance: vec3f, count: f32, coverage: f32 };
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
${displayTransformWgsl('acesFilmic', dynamicTonemap ? 'info.constantEnv.w' : undefined)}
fn load_preview(uv: vec2f) -> Sample {
  var result = Sample(vec3f(0.0), 0.0, 0.0);
  if (info.previewSize.x == 0u) { return result; }
  let p = uv * vec2f(info.previewSize) - 0.5;
  let base = vec2i(floor(p));
  let f = fract(p);
  for (var y = 0; y <= 1; y++) {
    for (var x = 0; x <= 1; x++) {
      let xy = vec2u(clamp(base + vec2i(x, y), vec2i(0), vec2i(info.previewSize) - 1));
      let index = (xy.y * info.previewSize.x + xy.x) * 2u;
      let weight = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1);
      result.radiance += preview[index].xyz * weight;
      result.count += preview[index].w * weight;
      result.coverage += preview[index + 1u].x * weight;
    }
  }
  return result;
}
fn load_pixel(p: vec2i) -> Sample {
  let xy = vec2u(clamp(p, vec2i(0), vec2i(info.size) - 1));
  let i = (xy.y * info.size.x + xy.x) * 2u;
  if (pixels[i].w == 0.0) {
    return load_preview((vec2f(xy) + 0.5) / vec2f(info.size));
  }
  return Sample(pixels[i].xyz, pixels[i].w, pixels[i + 1u].x);
}
fn reconstruct(uv: vec2f) -> Sample {
  if (all(info.size == info.outputSize)) {
    return load_pixel(vec2i(uv * vec2f(info.size)));
  }
  let p = uv * vec2f(info.size) - 0.5;
  let base = vec2i(floor(p));
  let f = fract(p);
  var result = Sample(vec3f(0.0), 0.0, 0.0);
  for (var y = 0; y <= 1; y++) {
    for (var x = 0; x <= 1; x++) {
      let s = load_pixel(base + vec2i(x, y));
      let w = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1);
      result.radiance += s.radiance * w;
      result.count += s.count * w;
      result.coverage += s.coverage * w;
    }
  }
  return result;
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
fn raw_color(frag: vec4f) -> vec4f {
  let uv = frag.xy / vec2f(info.outputSize);
  let center = reconstruct(uv);
  let hdr = center.radiance + (1.0 - clamp(center.coverage, 0.0, 1.0)) * background(uv);
  return vec4f(display_color(hdr, info.exposure), 1.0);
}
${surfaceAovs ? `
fn aov_color(frag: vec4f) -> vec4f {
  let uv = frag.xy / vec2f(info.outputSize);
  var dims = info.size;
  var xy = min(vec2u(uv * vec2f(dims)), dims - 1u);
  var index = (xy.y * dims.x + xy.x) * 2u;
  var fromPreview = false;
  if (pixels[index].w == 0.0 && info.previewSize.x > 0u) {
    dims = info.previewSize;
    xy = min(vec2u(uv * vec2f(dims)), dims - 1u);
    index = (xy.y * dims.x + xy.x) * 2u;
    fromPreview = true;
  }
  var pixel = pixels[index];
  var moments = pixels[index + 1u];
  if (fromPreview) {
    pixel = preview[index];
    moments = preview[index + 1u];
  }
  if (info.eye.w == 4.0) {
    if (pixel.w < 2.0) { return vec4f(1.0, 0.0, 1.0, 1.0); }
    let variance = max(moments.y, 0.0) / (pixel.w - 1.0);
    return vec4f(vec3f(variance / (1.0 + variance)), 1.0);
  }
  let aovIndex = dims.x * dims.y * 2u + xy.y * dims.x + xy.x;
  var aov = pixels[aovIndex];
  if (fromPreview) {
    aov = preview[aovIndex];
  }
  if (pixel.w == 0.0 || aov.w == 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  if (info.eye.w == 6.0) {
    return vec4f(srgb(clamp(aov.xyz, vec3f(0.0), vec3f(1.0))), 1.0);
  }
  if (info.eye.w == 5.0) {
    let emitted = max(aov.xyz, vec3f(0.0));
    return vec4f(srgb(emitted / (vec3f(1.0) + emitted)), 1.0);
  }
  if (info.eye.w == 1.0) {
    return vec4f(srgb(clamp(aov.xyz / aov.w, vec3f(0.0), vec3f(1.0))), 1.0);
  }
  if (info.eye.w == 2.0) {
    let n = aov.xyz;
    if (dot(n, n) < 1e-12) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    return vec4f(normalize(n) * 0.5 + 0.5, 1.0);
  }
  let depth = aov.x / aov.w;
  return vec4f(vec3f(1.0 / (1.0 + depth)), 1.0);
}
` : ''}
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
${surfaceAovs ? '  if (info.eye.w > 0.0) { return aov_color(frag); }' : ''}
  let raw = raw_color(frag);
  if (info.neuralEnabled == 0u) { return raw; }
  let coverage = reconstruct(frag.xy / vec2f(info.outputSize)).coverage;
  let denoised = textureLoad(neuralOutput, vec2i(frag.xy), 0).xyz;
  let denoisedComposite = mix(raw.xyz, denoised, clamp(coverage, 0.0, 1.0));
  if (info.env.w > 0.0) {
    let split = f32(info.outputSize.x) * info.env.w;
    if (abs(frag.x - split) < 1.0) { return vec4f(1.0, 1.0, 1.0, 1.0); }
    if (frag.x < split) { return raw; }
  }
  return vec4f(denoisedComposite, 1.0);
}`;
}
