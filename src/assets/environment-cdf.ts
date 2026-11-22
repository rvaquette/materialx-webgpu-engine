import type { HdrImage } from './hdr.ts';

/**
 * Equirectangular environment sampling distribution shared by the path tracer and the
 * raster reference mode. Layout of `cdf`: one normalized conditional CDF per row
 * (`width` floats, last = 1), then the normalized marginal CDF over rows (`height`
 * floats). A texel's probability is the product of its row and column CDF steps, read
 * back from the same arrays the sampler searches, so sampling and pdf evaluation agree.
 *
 * Texel weights are luminance × sin θ (texel solid angle), MIS-compensated: the
 * solid-angle mean luminance is subtracted (Karlík et al. 2019, "MIS Compensation"),
 * leaving dim regions to BSDF sampling. A uniform-looking map falls back to the
 * uncompensated weights. `totalSum` is the weight total (> 0 when sampling is possible).
 */
export function buildEnvCdf(image: HdrImage) {
  const { width, height, data } = image;
  const luminance = new Float64Array(width * height);
  const sines = new Float64Array(height);
  let weighted = 0;
  let solidAngle = 0;
  for (let y = 0; y < height; y++) {
    sines[y] = Math.sin(Math.PI * (y + 0.5) / height);
    for (let x = 0; x < width; x++) {
      const i = y * width + x, o = i * 3;
      const value = Math.max(0, 0.212671 * data[o]! + 0.71516 * data[o + 1]! + 0.072169 * data[o + 2]!);
      luminance[i] = Number.isFinite(value) ? value : 0;
      weighted += luminance[i]! * sines[y]!;
      solidAngle += sines[y]!;
    }
  }
  const mean = solidAngle > 0 ? weighted / solidAngle : 0;
  const build = (offset: number) => {
    const cdf = new Float32Array(width * height + height);
    const rows = new Float64Array(height);
    let total = 0;
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) row += Math.max(0, luminance[y * width + x]! - offset);
      let running = 0;
      for (let x = 0; x < width; x++) {
        running += Math.max(0, luminance[y * width + x]! - offset);
        cdf[y * width + x] = row > 0 ? running / row : (x + 1) / width;
      }
      cdf[y * width + width - 1] = 1;
      rows[y] = row * sines[y]!;
      total += rows[y]!;
    }
    let running = 0;
    for (let y = 0; y < height; y++) {
      running += rows[y]!;
      cdf[width * height + y] = total > 0 ? running / total : (y + 1) / height;
    }
    cdf[width * height + height - 1] = 1;
    return { cdf, totalSum: total };
  };
  let result = build(mean);
  // A constant (or nearly constant) map leaves nothing above its mean: sample by luminance.
  if (!(result.totalSum > 1e-6 * weighted)) result = build(0);
  return { ...result, width, height };
}

export interface EnvironmentSamplingWgslOptions {
  /** Storage array holding the buildEnvCdf layout. */
  cdf: string;
  /** f32 expressions for the map dimensions. */
  width: string;
  height: string;
  pi: string;
  prefix: string;
}

/**
 * WGSL sampling helpers for buildEnvCdf: `<prefix>_sample_uv(u)` returns the jittered
 * uv and the texel probability, `<prefix>_uv_probability(uv)` the probability of the texel
 * containing uv, and `<prefix>_pdf(uv, probability)` the solid-angle density.
 */
export function environmentSamplingWgsl(o: EnvironmentSamplingWgslOptions): string {
  const p = o.prefix;
  return /* wgsl */ `
fn ${p}_marginal(y: i32) -> f32 {
  if (y < 0) { return 0.0; }
  return ${o.cdf}[i32(${o.width}) * i32(${o.height}) + y];
}
fn ${p}_conditional(x: i32, y: i32) -> f32 {
  if (x < 0) { return 0.0; }
  return ${o.cdf}[y * i32(${o.width}) + x];
}
// x, y = jittered uv; z = probability of the selected texel.
fn ${p}_sample_uv(u: vec2f) -> vec3f {
  let w = i32(${o.width});
  let h = i32(${o.height});
  var lower = 0;
  var upper = h - 1;
  loop {
    if (lower >= upper) { break; }
    let middle = (lower + upper) / 2;
    if (u.x < ${p}_marginal(middle)) { upper = middle; } else { lower = middle + 1; }
  }
  let y = lower;
  let rowStart = ${p}_marginal(y - 1);
  let rowProbability = ${p}_marginal(y) - rowStart;
  lower = 0;
  upper = w - 1;
  loop {
    if (lower >= upper) { break; }
    let middle = (lower + upper) / 2;
    if (u.y < ${p}_conditional(middle, y)) { upper = middle; } else { lower = middle + 1; }
  }
  let x = lower;
  let columnStart = ${p}_conditional(x - 1, y);
  let columnProbability = ${p}_conditional(x, y) - columnStart;
  let jitter = clamp(vec2f((u.y - columnStart) / max(columnProbability, 1.0e-30),
    (u.x - rowStart) / max(rowProbability, 1.0e-30)), vec2f(0.0), vec2f(0.99999994));
  return vec3f((vec2f(f32(x), f32(y)) + jitter) / vec2f(${o.width}, ${o.height}), rowProbability * columnProbability);
}
// Deterministic quadrature from one number: u selects the row, its remainder the
// column; returns the selected texel centre.
fn ${p}_sample_center(u: f32) -> vec2f {
  let rowRemainder = fract(${p}_sample_uv(vec2f(u, 0.0)).y * ${o.height});
  let sampled = ${p}_sample_uv(vec2f(u, rowRemainder));
  return (floor(sampled.xy * vec2f(${o.width}, ${o.height})) + 0.5) / vec2f(${o.width}, ${o.height});
}
fn ${p}_uv_probability(uv: vec2f) -> f32 {
  let w = i32(${o.width});
  let h = i32(${o.height});
  let x = clamp(i32(floor(fract(uv.x) * f32(w))), 0, w - 1);
  let y = clamp(i32(floor(uv.y * f32(h))), 0, h - 1);
  return (${p}_marginal(y) - ${p}_marginal(y - 1)) * (${p}_conditional(x, y) - ${p}_conditional(x - 1, y));
}
fn ${p}_pdf(uv: vec2f, probability: f32) -> f32 {
  let s = sin(uv.y * ${o.pi});
  if (s <= 0.0 || probability <= 0.0) { return 0.0; }
  return probability * ${o.width} * ${o.height} / (2.0 * ${o.pi} * ${o.pi} * s);
}
`;
}
