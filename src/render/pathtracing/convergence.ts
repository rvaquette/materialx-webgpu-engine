export const PT_CONVERGENCE_COLUMNS = 8;
export const PT_CONVERGENCE_ROWS = 8;
export const PT_CONVERGENCE_MIN_SAMPLES = 8;
export const PT_CONVERGENCE_TARGET_RELATIVE_ERROR = 0.05;
export const PT_CONVERGENCE_MIN_TARGET_RELATIVE_ERROR = 0.005;
export const PT_CONVERGENCE_MAX_TARGET_RELATIVE_ERROR = 0.25;
export const PT_CONVERGENCE_LUMINANCE_FLOOR = 0.01;
export const PT_CONVERGENCE_ZONE_BYTES = 16;
export const PT_CONVERGENCE_UNIFORM_BYTES = 32;
export const PT_ADAPTIVE_MIN_SAMPLES = 64;
export const PT_ADAPTIVE_PROBE_INTERVAL = 8;

export function pathTraceAdaptiveSamplingWgsl(): string {
  return /* wgsl */ `
fn mx_adaptive_sample(mean: vec3f, m2: f32, count: f32, sweep: u32, pixel: u32) -> bool {
  if (count < ${PT_ADAPTIVE_MIN_SAMPLES}.0) { return true; }
  // Keep exploring quiet pixels: a rare bright path must be able to reactivate them.
  if ((sweep + pixel) % ${PT_ADAPTIVE_PROBE_INTERVAL}u == 0u) { return true; }
  let luminance = dot(mean, vec3f(0.2126, 0.7152, 0.0722));
  let variance = max(m2, 0.0) / (count - 1.0);
  let uncertainty = 1.96 * sqrt(variance / count);
  return uncertainty > U.sh[8].w
    * max(abs(luminance), ${PT_CONVERGENCE_LUMINANCE_FLOOR});
}
`;
}

export interface PathTraceZoneConvergence {
  /** RMS 95% confidence interval as a fraction of luminance. */
  relativeError: number;
  /** Worst pixel 95% confidence interval as a fraction of luminance. */
  maximumRelativeError: number;
  /** Fraction of sampled pixels whose relative error meets the target. */
  convergedFraction: number;
  /** Fraction of zone pixels with enough samples to estimate variance. */
  validFraction: number;
}

export interface PathTraceConvergence {
  columns: number;
  rows: number;
  /** Completed full-resolution sweeps, not per-pixel sample counts in adaptive mode. */
  samples: number;
  targetRelativeError: number;
  zones: readonly PathTraceZoneConvergence[];
}

export function relativeNoiseEstimate(
  meanLuminance: number,
  sumSquaredDeviation: number,
  samples: number,
): number | undefined {
  if (samples < PT_CONVERGENCE_MIN_SAMPLES) return undefined;
  const variance = Math.max(0, sumSquaredDeviation / (samples - 1));
  const confidenceInterval = 1.96 * Math.sqrt(variance / samples);
  return confidenceInterval / Math.max(Math.abs(meanLuminance), PT_CONVERGENCE_LUMINANCE_FLOOR);
}

export function pathTraceConvergenceWgsl(): string {
  return /* wgsl */ `
struct ConvergenceUniforms {
  size: vec2u,
  zones: vec2u,
  targetRelativeError: f32,
  minSamples: u32,
  padding: vec2u,
};
@group(0) @binding(0) var<storage, read> accum: array<vec4f>;
@group(0) @binding(1) var<uniform> settings: ConvergenceUniforms;
@group(0) @binding(2) var<storage, read_write> zones: array<vec4f>;

var<workgroup> squaredErrors: array<f32, 64>;
var<workgroup> maximumErrors: array<f32, 64>;
var<workgroup> convergedPixels: array<u32, 64>;
var<workgroup> validPixels: array<u32, 64>;

@compute @workgroup_size(64)
fn mx_path_trace_convergence(
  @builtin(workgroup_id) workgroup: vec3u,
  @builtin(local_invocation_index) lane: u32,
) {
  let zoneIndex = workgroup.y * settings.zones.x + workgroup.x;
  let zoneCoord = vec2u(workgroup.xy);
  let first = zoneCoord * settings.size / settings.zones;
  let last = (zoneCoord + vec2u(1u)) * settings.size / settings.zones;
  let zoneSize = last - first;
  let pixelCount = zoneSize.x * zoneSize.y;
  var sumSquaredError = 0.0;
  var maximumError = 0.0;
  var convergedCount = 0u;
  var validCount = 0u;

  for (var localPixel = lane; localPixel < pixelCount; localPixel += 64u) {
    let coord = first + vec2u(localPixel % zoneSize.x, localPixel / zoneSize.x);
    let index = (coord.y * settings.size.x + coord.x) * 2u;
    let pixel = accum[index];
    let sampleCount = u32(pixel.w);
    if (sampleCount >= settings.minSamples) {
      let luminance = dot(pixel.xyz, vec3f(0.2126, 0.7152, 0.0722));
      let m2 = max(accum[index + 1u].y, 0.0);
      let variance = m2 / f32(sampleCount - 1u);
      let confidenceInterval = 1.96 * sqrt(variance / f32(sampleCount));
      let relativeError = confidenceInterval / max(abs(luminance), ${PT_CONVERGENCE_LUMINANCE_FLOOR});
      sumSquaredError += relativeError * relativeError;
      maximumError = max(maximumError, relativeError);
      convergedCount += select(0u, 1u, relativeError <= settings.targetRelativeError);
      validCount++;
    }
  }

  squaredErrors[lane] = sumSquaredError;
  maximumErrors[lane] = maximumError;
  convergedPixels[lane] = convergedCount;
  validPixels[lane] = validCount;
  workgroupBarrier();

  for (var stride = 32u; stride > 0u; stride /= 2u) {
    if (lane < stride) {
      squaredErrors[lane] += squaredErrors[lane + stride];
      maximumErrors[lane] = max(maximumErrors[lane], maximumErrors[lane + stride]);
      convergedPixels[lane] += convergedPixels[lane + stride];
      validPixels[lane] += validPixels[lane + stride];
    }
    workgroupBarrier();
  }

  if (lane == 0u) {
    let valid = validPixels[0];
    let rmsError = select(1.0, sqrt(squaredErrors[0] / f32(valid)), valid > 0u);
    let maxError = select(1.0, maximumErrors[0], valid > 0u);
    let converged = select(0.0, f32(convergedPixels[0]) / f32(valid), valid > 0u);
    zones[zoneIndex] = vec4f(rmsError, maxError, converged, f32(valid) / f32(pixelCount));
  }
}
`;
}
