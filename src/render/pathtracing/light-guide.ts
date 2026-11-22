// Observed-visibility light guide for the path tracer's light resampling.
//
// The reservoir target (compute.ts) estimates each candidate's unshadowed
// contribution; this guide multiplies it by the visibility observed so far for the
// light from the shading point's cell of a coarse world grid. Each pixel records
// its first light shadow-ray outcome in the free z slot of its accumulation moments;
// a gather pass counts hits/trials per (cell, light) and a build pass turns them into
// Laplace-smoothed visibilities, copied into the light buffer between dispatches.
// The target only shapes the resampling, and stays positive, so the estimator is
// unbiased whatever the guide holds; it is constant within a dispatch.
import type { Aabb } from '../../geometry/bvh.ts';

/** Grid cells per axis. */
export const PT_LIGHT_GUIDE_RESOLUTION = 8;
export const PT_LIGHT_GUIDE_CELLS = PT_LIGHT_GUIDE_RESOLUTION ** 3;
/** Light indices are packed on 8 bits next to the 9-bit cell index. */
export const PT_LIGHT_GUIDE_MAX_LIGHTS = 255;
/** Lowest visibility a guided light keeps in the resampling target. */
export const PT_LIGHT_GUIDE_FLOOR = 0.05;
const HEADER_VEC4 = 2;

export function lightGuideEnabled(lightCount: number): boolean {
  return lightCount >= 2 && lightCount <= PT_LIGHT_GUIDE_MAX_LIGHTS;
}

/** Guide region appended to the packed lights: two header vec4s, then one visibility per (cell, light). */
export function packLightGuide(bounds: Aabb, lightCount: number): Float32Array {
  const enabled = lightGuideEnabled(lightCount);
  const values = enabled ? PT_LIGHT_GUIDE_CELLS * lightCount : 0;
  const data = new Float32Array(HEADER_VEC4 * 4 + Math.ceil(values / 4) * 4);
  const n = PT_LIGHT_GUIDE_RESOLUTION;
  const extent = [0, 1, 2].map(a => bounds.max[a]! - bounds.min[a]!);
  // A margin keeps points on the bounds inside the grid.
  const scale = extent.map(e => e > 0 && Number.isFinite(e) ? n / (e * 1.0001) : 0);
  data.set([bounds.min[0], bounds.min[1], bounds.min[2], enabled ? n : 0, scale[0]!, scale[1]!, scale[2]!, 0]);
  data.fill(1, HEADER_VEC4 * 4, HEADER_VEC4 * 4 + values);
  return data;
}

/** Byte offset of the visibilities inside the light buffer. */
export function lightGuideValuesOffset(lightCount: number): number {
  return (lightCount * 7 + HEADER_VEC4) * 16;
}

/** Kernel-side lookups; requires analyticLightsWgsl. */
export function lightGuideWgsl(): string {
  return /* wgsl */ `
fn mx_guide_base() -> u32 { return mx_light_count() * 7u; }
fn mx_guide_cell(p: vec3f) -> u32 {
  let origin = analyticLights[mx_guide_base()];
  let n = u32(origin.w);
  if (n == 0u) { return 0xffffffffu; }
  let scale = analyticLights[mx_guide_base() + 1u].xyz;
  let q = clamp(vec3i(floor((p - origin.xyz) * scale)), vec3i(0), vec3i(i32(n) - 1));
  return (u32(q.z) * n + u32(q.y)) * n + u32(q.x);
}
fn mx_guide_visibility(cell: u32, light: u32) -> f32 {
  if (cell == 0xffffffffu) { return 1.0; }
  let i = cell * mx_light_count() + light;
  return analyticLights[mx_guide_base() + ${HEADER_VEC4}u + i / 4u][i % 4u];
}
// Observation packed in an exactly representable f32: valid, visible, light, cell.
fn mx_guide_observation(cell: u32, light: u32, visible: bool) -> f32 {
  if (cell == 0xffffffffu) { return 0.0; }
  return f32((1u << 18u) | (select(0u, 1u, visible) << 17u) | (light << 9u) | cell);
}
`;
}

export const PT_LIGHT_GUIDE_SETTINGS_BYTES = 16;

/** Gather (per pixel) and build (per cell and light) passes. */
export function lightGuideUpdateWgsl(): string {
  return /* wgsl */ `
struct GuideSettings { pixels: u32, lights: u32, cells: u32, unused: u32 };
@group(0) @binding(0) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> guide: array<f32>;
@group(0) @binding(3) var<uniform> settings: GuideSettings;

@compute @workgroup_size(64)
fn mx_light_guide_gather(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.pixels) { return; }
  let slot = id.x * 2u + 1u;
  let packed = u32(accum[slot].z);
  if ((packed & (1u << 18u)) == 0u) { return; }
  accum[slot].z = 0.0;
  let cell = packed & 511u;
  let light = (packed >> 9u) & 255u;
  if (cell >= settings.cells || light >= settings.lights) { return; }
  let i = (cell * settings.lights + light) * 2u;
  atomicAdd(&counts[i], 1u);
  if ((packed & (1u << 17u)) != 0u) { atomicAdd(&counts[i + 1u], 1u); }
}

@compute @workgroup_size(64)
fn mx_light_guide_build(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.cells * settings.lights) { return; }
  let trials = f32(atomicLoad(&counts[id.x * 2u]));
  let hits = f32(atomicLoad(&counts[id.x * 2u + 1u]));
  guide[id.x] = max((hits + 1.0) / (trials + 2.0), ${PT_LIGHT_GUIDE_FLOOR});
}
`;
}
