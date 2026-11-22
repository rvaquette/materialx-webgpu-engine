// Compute path-tracing backend (plan section 9, P9, T052). Ports the reference
// path integrator (src/render/pathtracing/integrator.ts) to a WebGPU compute
// shader fed by the packed scene buffers (scene-buffers.ts): it unprojects a
// camera ray per pixel, traverses the world BVH with Moller-Trumbore triangle
// tests, rebuilds each hit's LayeredClosure from the packed material record
// (material-record.ts) and evaluates it through the shared closure library
// (closure-library.ts, T056), does next-event estimation against the single distant light plus the
// constant environment, continues by BSDF sampling with power-heuristic MIS, and
// terminates with Russian roulette. Samples are accumulated progressively into a
// storage buffer keyed by frame index, so the image refines over frames without
// reimporting the scene. The WGSL generator is a pure string builder (Node-
// testable); pipeline creation is exercised against a mock device; the GPUBuffer
// uploads and dispatch run in the browser (src/main.ts) and are device-only.

import { PT_OBJECT_VERTEX_FLOATS, type PathTraceScene } from './scene-buffers.ts';
import { BVH_TRI_STRIDE, BVH_TRAVERSAL_WGSL } from './bvh-wgsl.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../compiler/surface-wgsl.ts';
import { closureLibraryPrelude, type ClosureDispatchSpec } from '../../compiler/closure-library.ts';
import { emitVaryingsStruct, textureWgslType } from '../../compiler/wgsl.ts';
import {
  OBJECT_TO_WORLD_INPUT, WORLD_TO_OBJECT_INPUT, OBJECT_POSITION_INPUT,
  OBJECT_NORMAL_INPUT, OBJECT_TANGENT_INPUT, OBJECT_BITANGENT_INPUT, type IrType,
} from '../../compiler/ir.ts';
import { materialClosureReaderWgsl, PT_MAX_LOBES, PT_MATERIAL_RECORD_FLOATS, PT_MATERIAL_HEADER_FLOATS, PT_LOBE_FLOATS } from './material-record.ts';
import { volumeFieldWgsl, VOLUME_TRANSPORT_WGSL } from '../volume-field.ts';
import {
  PT_MATERIAL_DISPATCH_ENTRY,
  PT_MATERIAL_OPACITY_ENTRY,
  PT_MATERIAL_OPACITY_VARYINGS,
  type PtMaterialDispatch,
} from './material-variant.ts';
import { ANALYTIC_LIGHTS_WGSL } from './analytic-lights.ts';
import { environmentSamplingWgsl } from '../../assets/environment-cdf.ts';
import { pruneWgslFunctions } from '../../compiler/wgsl-reachability.ts';
import { MAX_SSS_WALK_EVENTS, sssCoefficientsWgsl } from './subsurface.ts';
import { pathTraceAdaptiveSamplingWgsl, PT_CONVERGENCE_TARGET_RELATIVE_ERROR } from './convergence.ts';
import { pathTraceViewIndex, type PathTraceView } from './display.ts';

/** Compute workgroup tile edge (threads per dimension). */
export const PT_WORKGROUP_SIZE = 8;
/** Reservoir candidates per light next-event estimate (capped by the light count). */
export const PT_LIGHT_CANDIDATES = 8;
/** Entry point name of the generated compute shader. */
export const PT_COMPUTE_ENTRY = 'mx_path_trace';
/** Floats in the path-trace uniform (PT_UNIFORM_SIZE / 4). Slots 0..39 hold the
 *  camera/light/env/frame blocks; 40..75 hold the 9 RGB SH irradiance coefficients
 *  (one vec4 per coefficient, w unused); 76..79 hold the tile and 80..83 the HDR
 *  texture radiance scale (x), panorama flag (y) and adaptive flag (z); 84..99 hold the optional
 *  display-only inverse background view-projection; 100..103 hold max depth,
 *  roulette depth, analytic light count and converted primary-camera flag. */
export const PT_UNIFORM_FLOATS = 104;
/** Bytes in the path-trace uniform buffer. */
export const PT_UNIFORM_SIZE = PT_UNIFORM_FLOATS * 4;

/** Include record fallbacks as well as graph variants; neither may lose a reachable lobe. */
export function pathTraceClosureDispatch(dispatch: PtMaterialDispatch, materials: Float32Array): ClosureDispatchSpec {
  const kinds = new Set<number>();
  let thinFilm = false;
  let fuzz = false;
  const variants = new Set(dispatch.variants.map(variant => variant.index));
  for (const variant of dispatch.variants) {
    if (!variant.features) return { kinds: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), thinFilm: true };
    variant.features.lobeKinds.forEach(kind => kinds.add(kind));
    thinFilm ||= variant.features.thinFilm;
    fuzz ||= variant.features.fuzz !== false;
  }

  for (let base = 0, index = 0; base < materials.length; base += PT_MATERIAL_RECORD_FLOATS, index++) {
    if (variants.has(index)) continue;
    thinFilm ||= materials[base + 5]! !== 0;
    fuzz ||= materials[base + 4]! !== 0;
    for (let lobe = 0; lobe < materials[base]!; lobe++) {
      const offset = base + PT_MATERIAL_HEADER_FLOATS + lobe * PT_LOBE_FLOATS;
      if (materials[offset + 1]! > 0) kinds.add(materials[offset]!);
    }
  }
  return { kinds, thinFilm, fuzz };
}

export function pathTraceOpaqueScene(dispatch: PtMaterialDispatch, materials: Float32Array): boolean {
  if (dispatch.variants.some(v => v.features?.opaque !== true)) return false;
  const variants = new Set(dispatch.variants.map(v => v.index));
  for (let base = 0, index = 0; base < materials.length; base += PT_MATERIAL_RECORD_FLOATS, index++) {
    if (!variants.has(index) && materials[base + 1] !== 1) return false;
  }
  return true;
}

export interface PathTraceTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PT_MAX_TILE_EDGE = 64;

function pathTraceTileGrid(width: number, height: number): { columns: number; rows: number } {
  return {
    columns: Math.max(4, Math.ceil(width / PT_MAX_TILE_EDGE)),
    rows: Math.max(4, Math.ceil(height / PT_MAX_TILE_EDGE)),
  };
}

export function pathTraceTileCount(width: number, height: number): number {
  const { columns, rows } = pathTraceTileGrid(width, height);
  return columns * rows;
}

export function pathTraceTile(width: number, height: number, index: number): PathTraceTile {
  const { columns, rows } = pathTraceTileGrid(width, height);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = Math.floor(column * width / columns);
  const y = Math.floor(row * height / rows);
  return {
    x,
    y,
    width: Math.floor((column + 1) * width / columns) - x,
    height: Math.floor((row + 1) * height / rows) - y,
  };
}

// --- WGSL generator ----------------------------------------------------------

/** Merged MxVaryings fields the layered-surface variants consume (T057h). */
export interface PtVaryings {
  primvarFields: Map<string, IrType>;
  extraInputs: Map<string, IrType>;
}

function wgslStructsAndBindings(
  textures: boolean, varyings: boolean, environment: boolean,
): string {
  // The baked path binds the full UV + baked-texture group; a graph path only
  // needs the per-triangle UVs (binding 6) to interpolate texcoords.
  const texBindings = textures
    ? /* wgsl */ `
@group(0) @binding(6) var<storage, read> triUv : array<f32>;
@group(0) @binding(7) var<storage, read> matLayer : array<i32>;
@group(0) @binding(8) var bakedTex : texture_2d_array<f32>;
@group(0) @binding(9) var bakedSampler : sampler;
const UV_STRIDE : u32 = 6u;
`
    : varyings
      ? /* wgsl */ `
@group(0) @binding(6) var<storage, read> triUv : array<f32>;
@group(0) @binding(7) var<storage, read> triTangent : array<f32>;
const UV_STRIDE : u32 = 6u;
const TAN_STRIDE : u32 = 12u;
`
      : '';
  return /* wgsl */ `
struct Uniforms {
  invViewProj : mat4x4<f32>,
  eye : vec4<f32>,
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  env : vec4<f32>, // xyz = skyColor, w = skyPower (dome intensity; > 0 selects textured path)
  frame : vec4<f32>, // x = frameIndex, y = samplesPerFrame, z = width, w = height
  envExtra : vec4<f32>, // x = envResX, y = envResY, z = envTotalSum, w = hasEnvCdf
  sh : array<vec4<f32>, 9>, // SH9 irradiance (.xyz); sh[8].w = relative noise target
  tile : vec4<f32>,
  envTexture : vec4<f32>, // radiance scale, panorama flag, adaptive flag, selected AOV index
  backgroundInvViewProj : mat4x4<f32>,
  transport : vec4<f32>, // depth, roulette depth, analytic light count, converted camera
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> nodes : array<f32>;
@group(0) @binding(2) var<storage, read> tris : array<f32>;
@group(0) @binding(3) var<storage, read> triOrder : array<u32>;
@group(0) @binding(4) var<storage, read> materials : array<f32>;
@group(0) @binding(5) var<storage, read_write> accum : array<vec4<f32>>;
${texBindings}
const PI : f32 = 3.14159265358979;
const NODE_STRIDE : u32 = 12u;
const TRI_STRIDE : u32 = ${BVH_TRI_STRIDE}u;
const RAY_EPS : f32 = 1.0e-4;
${environment ? envBindings() : ''}`;
}

/** Equirectangular environment map (UsdLuxDomeLight) bound as its own group so it
 *  stays independent of the per-material texture registry (groups 1/2). env.w in
 *  the uniform carries the dome intensity: > 0 selects the textured path, 0 keeps
 *  the constant env.xyz the non-environment megakernel uses. */
function envBindings(): string {
  return /* wgsl */ `
@group(3) @binding(0) var envTex : texture_2d<f32>;
@group(3) @binding(1) var envSampler : sampler;
@group(3) @binding(2) var<storage, read> envCdf : array<f32>;
fn env_dir_to_uv(d : vec3<f32>) -> vec2<f32> {
  let n = normalize(d);
  let u = atan2(n.z, n.x) * (0.5 / PI) + 0.5;
  let v = acos(clamp(n.y, -1.0, 1.0)) / PI;
  return vec2<f32>(u, v);
}
fn env_radiance(d : vec3<f32>) -> vec3<f32> {
  if (U.env.w > 0.0) {
    let c = textureSampleLevel(envTex, envSampler, env_dir_to_uv(d), 0.0).xyz;
    return c * U.envTexture.x * U.env.xyz * U.env.w;
  }
  return U.env.xyz;
}
// Equirectangular latlong <-> direction (raw scanline order, matching the env
// texture and the flat row-major luminance CDF). env_map_uv_to_dir is the exact
// inverse of env_dir_to_uv used for CDF importance sampling.
fn env_map_uv_to_dir(uv : vec2<f32>) -> vec3<f32> {
  let phi = uv.x * (2.0 * PI);
  let theta = uv.y * PI;
  let s = sin(theta);
  return vec3<f32>(-s * cos(phi), cos(theta), -s * sin(phi));
}
fn env_map_luminance(c : vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.212671, 0.715160, 0.072169));
}
${environmentSamplingWgsl({ cdf: 'envCdf', width: 'U.envExtra.x', height: 'U.envExtra.y', pi: 'PI', prefix: 'env_map' })}
// Solid-angle PDF the env-importance strategy would assign to direction d (for MIS).
fn sky_pdf(d : vec3<f32>) -> f32 {
  let uv = env_dir_to_uv(normalize(d));
  return env_map_pdf(uv, env_map_uv_probability(uv));
}
// Diffuse irradiance E(n) from the uploaded SH9 radiance coefficients (cosine-lobe
// convolution A_l; basis matches projectIrradianceSH / evalIrradianceSH on the CPU).
// Returns radiance to be multiplied by albedo/PI and the dome tint/intensity.
fn mx_sh_irradiance(n : vec3<f32>) -> vec3<f32> {
  let A0 = 3.14159265358979;
  let A1 = 2.09439510239320; // 2*PI/3
  let A2 = 0.78539816339745; // PI/4
  let x = n.x; let y = n.y; let z = n.z;
  var e = U.sh[0].xyz * (A0 * 0.282095);
  e = e + U.sh[1].xyz * (A1 * 0.488603 * y);
  e = e + U.sh[2].xyz * (A1 * 0.488603 * z);
  e = e + U.sh[3].xyz * (A1 * 0.488603 * x);
  e = e + U.sh[4].xyz * (A2 * 1.092548 * x * y);
  e = e + U.sh[5].xyz * (A2 * 1.092548 * y * z);
  e = e + U.sh[6].xyz * (A2 * 0.315392 * (3.0 * z * z - 1.0));
  e = e + U.sh[7].xyz * (A2 * 1.092548 * x * z);
  e = e + U.sh[8].xyz * (A2 * 0.546274 * (x * x - y * y));
  return max(e, vec3<f32>(0.0));
}
`;
}

function wgslRng(): string {
  return /* wgsl */ `
// PCG32 hash -> uniform f32 in [0,1); mirrors createPcg32 in integrator.ts.
fn pcg_hash(v : u32) -> u32 {
  var state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// Per-pixel Owen-scrambled, padded 2D Sobol sampling (Burley 2020, "Practical
// Hash-based Owen Scrambling"): consecutive dimensions pair up into (0,2)-sequences
// whose sample order is shuffled per pair, so each pixel's samples are stratified
// over time in every dimension while staying independent across pixels and pairs.
// The state argument is still advanced for callers that hash it.
var<private> mx_sample_index: u32;
var<private> mx_sample_dimension: u32;
var<private> mx_pixel_seed: u32;
fn mx_begin_sample(pixel: u32, index: u32) {
  mx_pixel_seed = pcg_hash(pixel * 0x9e3779b9u + 0x85ebca6bu);
  mx_sample_index = index;
  mx_sample_dimension = 0u;
}
fn mx_nested_uniform_scramble(value: u32, seed: u32) -> u32 {
  var x = reverseBits(value);
  x += seed;
  x ^= x * 0x6c50b47cu;
  x ^= x * 0xb82f1e52u;
  x ^= x * 0xc7afe638u;
  x ^= x * 0x8d22f6e6u;
  return reverseBits(x);
}
// Second Sobol dimension: its generator is Pascal's matrix mod 2, so by Lucas' theorem
// output bit j is the parity of the index bits k that are supersets of j -- a GF(2)
// superset transform in five masked steps, without a per-bit loop.
fn mx_sobol_second(index: u32) -> u32 {
  var f = index;
  f ^= (f >> 1u) & 0x55555555u;
  f ^= (f >> 2u) & 0x33333333u;
  f ^= (f >> 4u) & 0x0f0f0f0fu;
  f ^= (f >> 8u) & 0x00ff00ffu;
  f ^= (f >> 16u) & 0x0000ffffu;
  return reverseBits(f);
}
fn rng_next(state : ptr<function, u32>) -> f32 {
  *state = pcg_hash(*state);
  let dimension = mx_sample_dimension;
  mx_sample_dimension += 1u;
  let pairSeed = pcg_hash(mx_pixel_seed ^ ((dimension >> 1u) * 0x632be5abu));
  let index = mx_nested_uniform_scramble(mx_sample_index, pairSeed);
  var value = select(mx_sobol_second(index), reverseBits(index), (dimension & 1u) == 0u);
  value = mx_nested_uniform_scramble(value, pairSeed ^ (0x68bc21ebu * (1u + (dimension & 1u))));
  // 24-bit mantissa: f32(u32) could round up to 1.0; keep the documented [0, 1) range.
  return f32(value >> 8u) * (1.0 / 16777216.0);
}
// Independent (white) numbers for decisions that need no stratification (reservoir picks).
fn rng_white(state : ptr<function, u32>) -> f32 {
  *state = pcg_hash(*state);
  return f32(*state >> 8u) * (1.0 / 16777216.0);
}
`;
}

// Homogeneous participating-medium helpers shared by the packed material reader
// (interior-medium derivation) and the integrator free-flight sampler. Mirrors
// media.ts / subsurface.ts on the CPU reference; rng_next is defined earlier.
export const MEDIA_HELPERS_PRELUDE = /* wgsl */ `struct MxMedium {
  sigmaA: vec3f,
  sigmaS: vec3f,
  g: f32,
};
struct MxMediumSample {
  scattered: bool,
  t: f32,
  weight: vec3f,
};
${sssCoefficientsWgsl('mx_sss_controls')}
fn mx_sample_davis_density(bleed: f32, state: ptr<function, u32>) -> f32 {
  let shape = 2.0 - 0.75 * clamp(bleed, 0.0, 1.0);
  let d = shape - 1.0 / 3.0;
  let c = 1.0 / sqrt(9.0 * d);
  for (var attempt = 0u; attempt < 128u; attempt++) {
    let normal = sqrt(-2.0 * log(max(rng_next(state), 1e-12))) * cos(2.0 * PI * rng_next(state));
    let root = 1.0 + c * normal;
    if (root <= 0.0) { continue; }
    let cube = root * root * root;
    let variate = max(rng_next(state), 1e-12);
    if (variate < 1.0 - 0.0331 * normal * normal * normal * normal || log(variate) < 0.5 * normal * normal + d * (1.0 - cube + log(cube))) {
      return d * cube / shape;
    }
  }
  return -1.0;
}
fn mx_pick3(v : vec3f, ch : u32) -> f32 {
  if (ch == 0u) { return v.x; }
  if (ch == 1u) { return v.y; }
  return v.z;
}
fn mx_absorbing_medium(attenColor : vec3f, attenDist : f32) -> MxMedium {
  var m : MxMedium;
  if (attenDist > 0.0) {
    let c = clamp(attenColor, vec3f(1.0e-6), vec3f(1.0));
    m.sigmaA = -log(c) / attenDist;
  }
  return m;
}
fn mx_single_scatter_albedo(a : vec3f) -> vec3f {
  let c = clamp(a, vec3f(0.0), vec3f(1.0));
  return vec3f(1.0) - exp(-5.09406 * c + 2.61188 * c * c - 4.31805 * c * c * c);
}
fn mx_extinction_from_mfp(mfp : vec3f, albedo : vec3f) -> vec3f {
  let d = albedo - vec3f(0.8);
  let s = vec3f(1.9) - albedo + 3.5 * d * d;
  let dd = mfp * s;
  return select(vec3f(0.0), vec3f(1.0) / dd, dd > vec3f(0.0));
}
fn mx_subsurface_medium(albedo : vec3f, mfp : vec3f, g : f32) -> MxMedium {
  let alpha = mx_single_scatter_albedo(albedo);
  let sigmaT = mx_extinction_from_mfp(mfp, albedo);
  var m : MxMedium;
  m.sigmaS = alpha * sigmaT;
  m.sigmaA = (vec3f(1.0) - alpha) * sigmaT;
  m.g = g;
  return m;
}
// Hero-wavelength free-flight sampler: picks a channel, samples a collision
// distance from its extinction, and returns the MIS-balanced throughput for the
// scatter or the surface-reaching branch (matches sampleHomogeneous in media.ts).
// The free-flight distance does not depend on the surface distance, so the
// integrator can draw it before tracing and bound the ray to it (short rays
// prune the BVH), then resolve the event with mx_homogeneous_event.
fn mx_homogeneous_free_flight(m : MxMedium, state : ptr<function, u32>) -> f32 {
  let sigmaT = m.sigmaA + m.sigmaS;
  let ch = min(2u, u32(floor(rng_next(state) * 3.0)));
  let st = mx_pick3(sigmaT, ch);
  var t = 1.0e30;
  if (st > 0.0) { t = -log(1.0 - rng_next(state)) / st; }
  return t;
}
fn mx_sample_homogeneous(m : MxMedium, tMax : f32, state : ptr<function, u32>) -> MxMediumSample {
  return mx_homogeneous_event(m, mx_homogeneous_free_flight(m, state), tMax);
}
fn mx_homogeneous_event(m : MxMedium, t : f32, tMax : f32) -> MxMediumSample {
  let sigmaT = m.sigmaA + m.sigmaS;
  var samp : MxMediumSample;
  samp.scattered = t < tMax;
  let dist = select(tMax, t, samp.scattered);
  samp.t = dist;
  let tr = exp(-sigmaT * max(dist, 0.0));
  if (samp.scattered) {
    let density = dot(sigmaT * tr, vec3f(1.0)) / 3.0;
    samp.weight = select(vec3f(0.0), (tr * m.sigmaS) / density, density > 0.0);
  } else {
    let density = dot(tr, vec3f(1.0)) / 3.0;
    samp.weight = select(vec3f(0.0), tr / density, density > 0.0);
  }
  return samp;
}`;

// Henyey-Greenstein phase sampling; depends on basis() so it is emitted after it.
// Matches sampleHenyeyGreenstein in media.ts (importance-sampled, so f/pdf = 1).
const MEDIA_PHASE_PRELUDE = /* wgsl */ `fn mx_sample_hg(wo : vec3f, g : f32, u1 : f32, u2 : f32) -> vec3f {
  let w = normalize(wo);
  let gg = clamp(g, -0.99, 0.99);
  var cosTheta : f32;
  if (abs(gg) < 1.0e-3) {
    cosTheta = 1.0 - 2.0 * u1;
  } else {
    let sqr = (1.0 - gg * gg) / (1.0 + gg - 2.0 * gg * u1);
    cosTheta = -(1.0 + gg * gg - sqr * sqr) / (2.0 * gg);
  }
  let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  let phi = 2.0 * PI * u2;
  let local = vec3f(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
  return basis(w) * local;
}`;

function wgslClosureSurface(textures: boolean, maxLobes: number, closureDispatch?: ClosureDispatchSpec): string {
  // Shared layered-closure shading: the struct family (LAYERED_CLOSURE_PRELUDE),
  // the runtime lobe library plus the mx_closure_eval/pdf/sample assembler
  // (CLOSURE_LIBRARY_PRELUDE, T056) and the megakernel material-record reader
  // (materialClosureReaderWgsl, T057b). The integrator rebuilds the hit's
  // LayeredClosure from the packed materials buffer and evaluates it here, so the
  // path tracer and raster backend share one identical shading source.
  const bakedApply = textures
    ? /* wgsl */ `
// Apply a baked albedo + roughness texel onto the reconstructed closure. The
// albedo rides the colour-carrying lobes (diffuse, conductor, translucent); the
// achromatic dielectric specular keeps its white tint. Roughness updates every
// lobe, matching the former seven-parameter baseColor/roughness override.
fn mx_apply_baked(c : ptr<function, LayeredClosure>, albedo : vec3<f32>, rough : f32) {
  for (var i : u32 = 0u; i < (*c).lobeCount; i = i + 1u) {
    let k = (*c).lobes[i].kind;
    if (k != MX_LOBE_DIELECTRIC_REFLECTION && k != MX_LOBE_SHEEN) {
      (*c).lobes[i].color = albedo;
    }
    (*c).lobes[i].roughness = rough;
  }
}`
    : '';
  return [
    LAYERED_CLOSURE_PRELUDE.replace('const MX_MAX_LOBES: u32 = 8u;', `const MX_MAX_LOBES: u32 = ${maxLobes}u;`),
    closureLibraryPrelude(closureDispatch),
    MEDIA_HELPERS_PRELUDE,
    materialClosureReaderWgsl(),
    /* wgsl */ `
// Branchless orthonormal basis (Duff et al. 2017) around a unit normal; matches
// shadingFrame in bsdf.ts. Columns (t, bt, n) map local +Z to the world normal.
fn basis(n : vec3<f32>) -> mat3x3<f32> {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3<f32>(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3<f32>(b, s + n.y * n.y * a, -n.y);
  return mat3x3<f32>(t, bt, n);
}`,
    MEDIA_PHASE_PRELUDE,
    bakedApply,
  ].join('\n');
}

function wgslVaryings(varyings: PtVaryings): string {
  // 'st' is the default MaterialX texcoord set, so it mirrors the interpolated UV;
  // other primvar/extra-input fields default to zero until later tasks feed them.
  const assigns: string[] = [];
  for (const [name] of varyings.primvarFields) {
    if (name === 'st') assigns.push('  vary.v_st = uv;');
  }
  const objectToWorld = varyings.extraInputs.has(OBJECT_TO_WORLD_INPUT);
  const worldToObject = varyings.extraInputs.has(WORLD_TO_OBJECT_INPUT);
  const objectPosition = varyings.extraInputs.has(OBJECT_POSITION_INPUT);
  const objectTangent = varyings.extraInputs.has(OBJECT_TANGENT_INPUT) || varyings.extraInputs.has(OBJECT_BITANGENT_INPUT);
  const objectNormal = varyings.extraInputs.has(OBJECT_NORMAL_INPUT) || objectTangent;
  const objectGeometry = objectPosition || objectNormal;
  if (objectToWorld) assigns.push(`  vary.in_${OBJECT_TO_WORLD_INPUT} = mx_hit_transform(h.tri, 0u);`);
  if (worldToObject) assigns.push(`  vary.in_${WORLD_TO_OBJECT_INPUT} = mx_hit_transform(h.tri, 1u);`);
  if (objectGeometry) {
    assigns.push('  let oa = mx_object_vertex(h.tri, 0u);', '  let ob = mx_object_vertex(h.tri, 1u);',
      '  let oc = mx_object_vertex(h.tri, 2u);', '  let objectWeight = 1.0 - h.u - h.v;');
    if (objectPosition) assigns.push(`  vary.in_${OBJECT_POSITION_INPUT} = oa.position * objectWeight + ob.position * h.u + oc.position * h.v;`);
    if (objectNormal) {
      assigns.push(
        '  var objectN: vec3f;',
        '  if (oa.hasNormal) { objectN = normalize(oa.normal * objectWeight + ob.normal * h.u + oc.normal * h.v); }',
        '  else { objectN = normalize(cross(ob.position - oa.position, oc.position - oa.position)); }',
      );
      if (varyings.extraInputs.has(OBJECT_NORMAL_INPUT)) assigns.push(`  vary.in_${OBJECT_NORMAL_INPUT} = objectN;`);
    }
    if (objectTangent) {
      assigns.push(
        '  let objectFrame = basis(objectN);',
        '  let objectRaw = oa.tangent * objectWeight + ob.tangent * h.u + oc.tangent * h.v;',
        '  let objectProjected = objectRaw.xyz - objectN * dot(objectN, objectRaw.xyz);',
        '  let hasObjectTangent = dot(objectProjected, objectProjected) > 1e-10;',
        '  let objectT = select(objectFrame[0], normalize(objectProjected), hasObjectTangent);',
      );
      if (varyings.extraInputs.has(OBJECT_TANGENT_INPUT)) assigns.push(`  vary.in_${OBJECT_TANGENT_INPUT} = objectT;`);
      if (varyings.extraInputs.has(OBJECT_BITANGENT_INPUT)) {
        assigns.push(`  vary.in_${OBJECT_BITANGENT_INPUT} = select(objectFrame[1], normalize(cross(objectN, objectT)) * select(1.0, -1.0, objectRaw.w < 0.0), hasObjectTangent);`);
      }
    }
  }
  return [
    emitVaryingsStruct(varyings.primvarFields, varyings.extraInputs),
    ...(objectGeometry ? [/* wgsl */ `
struct MxObjectVertex {
  position: vec3f,
  normal: vec3f,
  tangent: vec4f,
  hasNormal: bool,
};
fn mx_object_vertex(tri: u32, slot: u32) -> MxObjectVertex {
  let count = arrayLength(&tris) / TRI_STRIDE;
  // The final triangle belongs to the final contiguous instance range.
  let rangeCount = u32(triUv[count * (UV_STRIDE + 1u) - 1u]) + 1u;
  let indices = count * (UV_STRIDE + 1u) + rangeCount * 32u;
  let vertex = u32(triUv[indices + tri * 3u + slot]);
  let b = indices + count * 3u + vertex * ${PT_OBJECT_VERTEX_FLOATS}u;
  return MxObjectVertex(
    vec3f(triUv[b], triUv[b + 1u], triUv[b + 2u]),
    vec3f(triUv[b + 3u], triUv[b + 4u], triUv[b + 5u]),
    vec4f(triUv[b + 6u], triUv[b + 7u], triUv[b + 8u], triUv[b + 9u]),
    triUv[b + 10u] != 0.0);
}`] : []),
    ...(objectToWorld || worldToObject ? [/* wgsl */ `
fn mx_hit_transform(tri : u32, inverseFlag : u32) -> mat4x4f {
  let count = arrayLength(&tris) / TRI_STRIDE;
  let objectIndex = u32(triUv[count * UV_STRIDE + tri]);
  let b = count * (UV_STRIDE + 1u) + objectIndex * 32u + inverseFlag * 16u;
  return mat4x4f(
    vec4f(triUv[b], triUv[b + 1u], triUv[b + 2u], triUv[b + 3u]),
    vec4f(triUv[b + 4u], triUv[b + 5u], triUv[b + 6u], triUv[b + 7u]),
    vec4f(triUv[b + 8u], triUv[b + 9u], triUv[b + 10u], triUv[b + 11u]),
    vec4f(triUv[b + 12u], triUv[b + 13u], triUv[b + 14u], triUv[b + 15u]));
}`] : []),
    /* wgsl */ `
fn mx_tri_uv(tri : u32, slot : u32) -> vec2<f32> {
  let b = tri * UV_STRIDE + slot * 2u;
  return vec2<f32>(triUv[b], triUv[b + 1u]);
}

fn mx_hit_uv(h : Hit) -> vec2<f32> {
  let w = 1.0 - h.u - h.v;
  return mx_tri_uv(h.tri, 0u) * w + mx_tri_uv(h.tri, 1u) * h.u + mx_tri_uv(h.tri, 2u) * h.v;
}

fn mx_tri_tangent(tri : u32, slot : u32) -> vec4<f32> {
  let b = tri * TAN_STRIDE + slot * 4u;
  return vec4<f32>(triTangent[b], triTangent[b + 1u], triTangent[b + 2u], triTangent[b + 3u]);
}

// Barycentric-interpolated per-triangle tangent; zero when no tangent stream was
// packed (empty buffer), so the caller keeps the branchless basis tangent.
fn mx_hit_tangent(h : Hit) -> vec4<f32> {
  if (arrayLength(&triTangent) < TAN_STRIDE) { return vec4<f32>(0.0); }
  let w = 1.0 - h.u - h.v;
  return mx_tri_tangent(h.tri, 0u) * w + mx_tri_tangent(h.tri, 1u) * h.u + mx_tri_tangent(h.tri, 2u) * h.v;
}

// Build the MxVaryings the layered-surface variants consume from a hit: the
// interpolated position/normal come from the integrator, the texcoord from the
// per-triangle UVs, and the tangent frame from the authored per-triangle
// tangents when present, else the branchless basis (anisotropy/normalmap safe,
// T057l). Primvar/extra-input fields default to zero.
fn mx_hit_varyings(h : Hit, pos : vec3<f32>, n : vec3<f32>, viewDir : vec3<f32>) -> MxVaryings {
  var vary : MxVaryings;
  let uv = mx_hit_uv(h);
  let f = basis(n);
  let tangentWithSign = mx_hit_tangent(h);
  let tRaw = tangentWithSign.xyz;
  let projectedTangent = tRaw - n * dot(n, tRaw);
  let hasT = dot(projectedTangent, projectedTangent) > 1.0e-10;
  let tang = select(f[0], normalize(projectedTangent), hasT);
  vary.position = pos;
  vary.normal = n;
  vary.tangent = tang;
  vary.bitangent = select(f[1], normalize(cross(n, tang)) * select(1.0, -1.0, tangentWithSign.w < 0.0), hasT);
  vary.texcoord = uv;
  vary.viewDir = viewDir;
  vary.frontFacing = select(-1.0, 1.0, dot(surface_hit_geometric_normal(h), viewDir) >= 0.0);
${assigns.join('\n')}
  return vary;
}`,
  ].join('\n');
}

function wgslIntegrator(
  textures: boolean, dispatch: PtMaterialDispatch | undefined, environment: boolean,
  displayAovs: boolean, opaque: boolean, analyticLights: boolean, rouletteDepth?: number,
): string {
  const envMiss = environment ? 'env_radiance(rd)' : 'U.env.xyz';
  const envNee = environment ? 'env_radiance(wiW)' : 'U.env.xyz';
  const rouletteDepthExpr = rouletteDepth === undefined ? 'i32(U.transport.y)' : `i32(${rouletteDepth})`;
  const texOverride = textures
    ? /* wgsl */ `
    let layer = matLayer[tri_material(hit.tri)];
    if (layer >= 0) {
      let uv = surface_hit_uv(hit);
      let tx = textureSampleLevel(bakedTex, bakedSampler, uv, layer, 0.0);
      mx_apply_baked(&c, tx.rgb, clamp(tx.a, 0.03, 1.0));
    }`
    : '';
  // Graph path (T057i): evaluate the hit's material graph through the megakernel
  // dispatcher at the interpolated varyings instead of unpacking the constant
  // record. Falls back to mx_material_closure internally for non-graph materials.
  const closureBuild = dispatch
    ? /* wgsl */ `    let vary = mx_hit_varyings(hit, pos, n, normalize(-rd));
    var c = ${PT_MATERIAL_DISPATCH_ENTRY}(tri_material(hit.tri), vary);
    c = mx_material_apply_volume(tri_material(hit.tri), c);`
    : /* wgsl */ `    var c = mx_material_closure(tri_material(hit.tri));${texOverride}`;
  // Opacity-only path: the dispatcher's dependency-pruned per-variant opacity
  // functions, or the packed record's opacity slot (baked textures never alter
  // opacity). Varyings are interpolated only for materials whose opacity reads them.
  const opacityBuild = !dispatch
    ? '  return clamp(mx_material_opacity(tri_material(hit.tri)), 0.0, 1.0);'
    : [
      '  let matId = tri_material(hit.tri);',
      ...(dispatch.opacityReadsVaryings
        ? [`  if (${PT_MATERIAL_OPACITY_VARYINGS}(matId)) {`,
          `    return ${PT_MATERIAL_OPACITY_ENTRY}(matId, mx_hit_varyings(hit, pos, surface_hit_normal(hit), normalize(-rd)));`,
          '  }']
        : []),
      '  var vary: MxVaryings;',
      `  return ${PT_MATERIAL_OPACITY_ENTRY}(matId, vary);`,
    ].join('\n');
  const texHelpers = textures
    ? /* wgsl */ `
fn tri_uv(tri : u32, slot : u32) -> vec2<f32> {
  let b = tri * UV_STRIDE + slot * 2u;
  return vec2<f32>(triUv[b], triUv[b + 1u]);
}

fn surface_hit_uv(h : Hit) -> vec2<f32> {
  let w = 1.0 - h.u - h.v;
  return tri_uv(h.tri, 0u) * w + tri_uv(h.tri, 1u) * h.u + tri_uv(h.tri, 2u) * h.v;
}`
    : '';
  return /* wgsl */ `
fn power_heuristic(nf : f32, fp : f32, ng : f32, gp : f32) -> f32 {
  let f = nf * fp;
  let g = ng * gp;
  let f2 = f * f;
  let g2 = g * g;
  if (f2 + g2 <= 0.0) { return 0.0; }
  return f2 / (f2 + g2);
}

fn surface_hit_normal(h : Hit) -> vec3<f32> {
  let w = 1.0 - h.u - h.v;
  let n = tri_normal(h.tri, 0u) * w + tri_normal(h.tri, 1u) * h.u + tri_normal(h.tri, 2u) * h.v;
  return normalize(n);
}
fn surface_hit_geometric_normal(h: Hit) -> vec3f {
  return normalize(cross(tri_vertex(h.tri, 1u) - tri_vertex(h.tri, 0u),
    tri_vertex(h.tri, 2u) - tri_vertex(h.tri, 0u)));
}
fn mx_burley_lengths(lobe: MxBsdfLobe) -> vec3f {
  let radius = max(lobe.hairTintTRT, vec3f(0.0));
  if (lobe.dispersion < 2.5) { return mx_sss_controls_burley_dmfp(lobe.color, radius); }
  let alpha = mx_sss_controls_alpha(lobe.color, lobe.anisotropy, max(lobe.ior, 1.0), lobe.roughness);
  return radius / sqrt(3.0 * (vec3f(1.0) - alpha) * (vec3f(1.0) - alpha * lobe.anisotropy));
}
fn mx_burley_profile(radius: f32, lengths: vec3f) -> vec3f {
  let distance = max(lengths, vec3f(1e-20));
  return select(vec3f(0.0), (exp(-radius / distance) + exp(-radius / (3.0 * distance)))
    / (8.0 * PI * distance * max(radius, 1e-20)), lengths > vec3f(0.0));
}
// Bit-level test so fast-math cannot fold away a NaN/Inf check.
fn mx_finite3(v: vec3f) -> bool {
  let exponent = bitcast<vec3u>(v) & vec3u(0x7f800000u);
  return all(exponent != vec3u(0x7f800000u));
}
struct MxBurleyExit { position: vec3f, normal: vec3f, geometricNormal: vec3f, weight: vec3f, valid: bool };
struct MxBurleyProjection { position: vec3f, normal: vec3f, shadingNormal: vec3f, count: u32, valid: bool };
fn mx_project_burley(probe: vec3f, axis: vec3f, halfChord: f32, material: u32, subset: u32, choose: bool, state: ptr<function, u32>) -> MxBurleyProjection {
  var result: MxBurleyProjection;
  var origin = probe - axis * halfChord;
  var remaining = 2.0 * halfChord;
  for (var crossing = 0u; crossing < 128u; crossing++) {
    let candidate = traverse_min(origin, axis, remaining, false, 1e-7);
    if (!candidate.hitAny) { result.valid = true; return result; }
    let position = origin + axis * candidate.t;
    if (select(tri_material(candidate.tri) == material, ${dispatch ? 'mx_eval_material_sss_subset' : 'mx_material_sss_subset'}(tri_material(candidate.tri)) == subset, subset > 0u)) {
      result.count++;
      if (choose) {
        if (rng_next(state) * f32(result.count) < 1.0) {
          result.position = position;
          result.normal = surface_hit_geometric_normal(candidate);
          result.shadingNormal = surface_hit_normal(candidate);
        }
      }
    }
    let step = candidate.t + 1e-6;
    origin += axis * step; remaining -= step;
    if (remaining <= 0.0) { result.valid = true; return result; }
  }
  return result;
}
fn mx_sample_burley(entry: vec3f, normal: vec3f, entryGeometric: vec3f, material: u32, lobe: MxBsdfLobe, state: ptr<function, u32>) -> MxBurleyExit {
  var result: MxBurleyExit;
  let lengths = mx_burley_lengths(lobe);
  let channel = min(2u, u32(rng_next(state) * 3.0));
  if (lengths[channel] <= 0.0) {
    let localMask = select(vec3f(0.0), vec3f(1.0), lengths <= vec3f(0.0));
    result.position = entry; result.normal = normal; result.geometricNormal = entryGeometric;
    result.weight = clamp(lobe.color, vec3f(0.0), vec3f(1.0)) * localMask * 3.0 / dot(localMask, vec3f(1.0));
    result.valid = true; return result;
  }
  let scale = lengths[channel] * select(3.0, 1.0, rng_next(state) < 0.25);
  let radius = -scale * log(max(1.0 - rng_next(state), 1e-7));
  // Probe rays cover only the chord of a sphere of radius rMax around the entry
  // (the truncated profile tail holds ~e^-20/3 of the energy), not the scene.
  let rMax = 20.0 * max(lengths.x, max(lengths.y, lengths.z));
  if (radius <= 0.0 || radius >= rMax) { return result; }
  let frame = basis(normal);
  let axes = mat3x3f(normal, frame[0], frame[1]);
  let choice = rng_next(state);
  let axisIndex = select(select(2u, 1u, choice < 0.75), 0u, choice < 0.5);
  let phi = 2.0 * PI * rng_next(state);
  let probe = entry + radius * (cos(phi) * axes[(axisIndex + 1u) % 3u] + sin(phi) * axes[(axisIndex + 2u) % 3u]);
  let projection = mx_project_burley(probe, axes[axisIndex], sqrt(rMax * rMax - radius * radius), material, u32(lobe.rotation), true, state);
  if (projection.count == 0u || !projection.valid) { return result; }
  result.position = projection.position; result.normal = projection.shadingNormal; result.geometricNormal = projection.normal;
  // Degenerate exit triangles produce NaN normals; reject them instead of poisoning the path.
  if (!mx_finite3(result.normal) || !mx_finite3(result.geometricNormal)) { return result; }
  let offset = result.position - entry;
  var pdf = 0.0;
  for (var index = 0u; index < 3u; index++) {
    let axis = axes[index];
    let jacobian = abs(dot(result.geometricNormal, axis));
    if (jacobian <= 0.0) { continue; }
    let radialOffset = offset - axis * dot(offset, axis);
    let radialDistance = length(radialOffset);
    var count = projection.count;
    if (index != axisIndex) {
      let halfChord = sqrt(max(rMax * rMax - radialDistance * radialDistance, 0.0)) * 1.0001 + 1e-6;
      let candidates = mx_project_burley(entry + radialOffset, axis, halfChord, material, u32(lobe.rotation), false, state);
      if (!candidates.valid) { return result; }
      count = candidates.count;
    }
    if (count == 0u) { continue; }
    let probability = select(0.25, 0.5, index == 0u);
    pdf += probability * dot(mx_burley_profile(radialDistance, lengths), vec3f(1.0 / 3.0)) * jacobian / f32(count);
  }
  if (!(pdf > 0.0) || !mx_finite3(vec3f(pdf))) { return result; }
  result.weight = clamp(lobe.color, vec3f(0.0), vec3f(1.0)) * mx_burley_profile(distance(entry, result.position), lengths) / pdf;
  result.weight *= 1.0 - clamp(lobe.extinction.y, 0.0, 1.0) * (1.0 - clamp(dot(normal, result.normal), 0.0, 1.0));
  // The 1/r profile overflows when the exit lands on the entry point (Inf/Inf).
  result.valid = mx_finite3(result.weight);
  return result;
}
fn mx_is_burley(lobe: MxBsdfLobe) -> bool {
  return lobe.kind == MX_LOBE_SUBSURFACE && lobe.dispersion >= 2.0 && lobe.weight > 0.0
    && any(lobe.hairTintTRT > vec3f(0.0));
}
fn mx_spatial_base_attenuation(layers: LayeredClosure, outgoingCosine: f32, incoming: vec3f) -> vec3f {
  var interfaceIor = 1.0;
  for (var index = 0u; index < layers.lobeCount; index++) {
    if (layers.lobes[index].kind == MX_LOBE_SUBSURFACE && layers.lobes[index].dispersion >= 2.0) {
      interfaceIor = max(layers.lobes[index].ior, 1.0);
    }
  }
  let interfaceTransmission = (1.0 - mx_fresnel_dielectric(outgoingCosine, interfaceIor))
    * (1.0 - mx_fresnel_dielectric(abs(incoming.z), 1.0 / interfaceIor));
  if (layers.hasCoat == 0u && layers.hasSheen == 0u && layers.hasFuzz == 0u) {
    return vec3f(interfaceTransmission);
  }
  var base = layers;
  base.lobeCount = 1u;
  base.hasInterior = 0u;
  var white: MxBsdfLobe;
  white.kind = MX_LOBE_SUBSURFACE; white.weight = 1.0; white.color = vec3f(1.0);
  base.lobes[0] = white;
  let outgoing = vec3f(sqrt(max(0.0, 1.0 - outgoingCosine * outgoingCosine)), 0.0, outgoingCosine);
  // One evaluation site for both passes (with, then without the white base) keeps
  // this inlined closure evaluation from being duplicated by the shader compiler.
  var combined = vec3f(0.0);
  var top = vec3f(0.0);
  for (var evaluation = 0u; evaluation < 2u; evaluation++) {
    let value = mx_closure_eval(base, outgoing, incoming).value;
    if (evaluation == 0u) { combined = value; base.lobeCount = 0u; } else { top = value; }
  }
  return max((combined - top) * PI, vec3f(0.0)) * interfaceTransmission;
}
${texHelpers}

fn mx_hit_closure(hit: Hit, pos: vec3f, rd: vec3f) -> LayeredClosure {
  let n = surface_hit_normal(hit);
${closureBuild}
  return c;
}

// Coverage opacity only (alpha visibility): never rebuilds the hit's lobes.
fn mx_hit_opacity(hit: Hit, pos: vec3f, rd: vec3f) -> f32 {
${opacityBuild}
}

fn mx_visibility(origin: vec3f, direction: vec3f, distance: f32) -> f32 {
${analyticLights ? '  if (mx_intersect_lights(origin, direction).distance < distance) { return 0.0; }' : ''}
${opaque ? '  return select(1.0, 0.0, traverse(origin, direction, distance, true).hitAny);' : `
  // Keep the common opaque first hit outside the nested alpha/BVH loops.
  let first = traverse(origin, direction, distance, false);
  if (!first.hitAny) { return 1.0; }
  let firstPos = origin + direction * first.t;
  var visibility = 1.0 - mx_hit_opacity(first, firstPos, direction);
  if (visibility <= 0.0) { return 0.0; }
  var ro = firstPos + direction * RAY_EPS;
  for (var layer = 1u; layer < 128u; layer++) {
    let hit = traverse(ro, direction, distance - dot(ro - origin, direction), false);
    if (!hit.hitAny) { return visibility; }
    let pos = ro + direction * hit.t;
    visibility = visibility * (1.0 - mx_hit_opacity(hit, pos, direction));
    if (visibility <= 0.0) { return 0.0; }
    ro = pos + direction * RAY_EPS;
  }
  return 0.0;
`}
}
fn mx_alpha_visibility(origin: vec3f, direction: vec3f) -> f32 {
  return mx_visibility(origin, direction, 1.0e30);
}

${displayAovs ? 'struct MxSurfaceAov { value: vec4f };' : ''}
fn integrate(ro0 : vec3<f32>, rd0 : vec3<f32>, backgroundDirection : vec3<f32>, state : ptr<function, u32>${displayAovs ? ', coverage: ptr<function, f32>, surfaceAov: ptr<function, MxSurfaceAov>' : ''}) -> vec3<f32> {
  var radiance = vec3<f32>(0.0);
  var beta = vec3<f32>(1.0);
  var ro = ro0;
  var rd = rd0;
  let toLight = normalize(-U.lightDir.xyz);
  let lightRadiance = U.lightColor.xyz * U.lightColor.w;
  let hasEnv = U.env.w > 0.0 || dot(U.env.xyz, vec3<f32>(1.0)) > 0.0;
  // MIS state carried across bounces (mirrors integratePath in integrator.ts).
  var specularBounce = true;
  var diffuseBounce = false;
  var splitFuzzEnvironment = false;
  var environmentBeta = vec3f(0.0);
  var bsdfPdf = 0.0;
  var lastN = vec3<f32>(0.0, 0.0, 1.0);
  // Active interior medium (entered through a transmissive/subsurface interface).
  var inMedium = false;
  var interiorIor = 1.0;
  var subsurfaceWalk = false;
  var subsurfaceEvents = 0;
  var subsurfaceMode = 2.0;
  var subsurfaceMaterial = 0xffffffffu;
  var subsurfaceSubset = 0u;
  var subsurfaceSelective = false;
  var subsurfaceTopology = 0.0;
  var subsurfaceEntryNormal = vec3f(0.0, 0.0, 1.0);
  var bounce = 0;
  var medium : MxMedium;
  var volumeIndex = 0xffffffffu;
  // Select once, at the first dispersive interface, and reuse at every bounce.
  var spectralChannel = 3u;
  var cameraSegment = true;
${analyticLights ? '  var analyticNee = false;' : ''}

  for (var pathStep = 0u; pathStep < 65536u; pathStep++) {
    if (subsurfaceWalk && subsurfaceEvents >= ${MAX_SSS_WALK_EVENTS}) { break; }
    // Homogeneous media draw the collision distance first and trace only up to it.
    let preFlight = inMedium && volumeIndex == 0xffffffffu;
    var flight = 1.0e30;
    if (preFlight) { flight = mx_homogeneous_free_flight(medium, state); }
${analyticLights ? `    let emitter = mx_intersect_lights(ro, rd);
    let traceLimit = min(emitter.distance, flight);` : '    let traceLimit = flight;'}
    var hit = traverse_min(ro, rd, traceLimit, false,select(RAY_EPS,1e-7,inMedium));
    if (inMedium && subsurfaceWalk && subsurfaceSelective) {
      var exhausted = true;
      for (var crossing = 0u; crossing <= 128u; crossing++) {
        if (!hit.hitAny) { exhausted = false; break; }
        let matches = select(tri_material(hit.tri) == subsurfaceMaterial,
          ${dispatch ? 'mx_eval_material_sss_subset' : 'mx_material_sss_subset'}(tri_material(hit.tri)) == subsurfaceSubset, subsurfaceSubset > 0u);
        if (matches) { exhausted = false; break; }
        if (crossing == 128u) { break; }
        hit = traverse_min(ro, rd, traceLimit, false, hit.t + 1e-6);
      }
      if (exhausted) { break; }
    }
    // Free-flight sampling: when inside a medium, a collision before the surface
    // scatters off the Henyey-Greenstein phase (importance-sampled, f/pdf = 1);
    // otherwise beta carries the surface-reaching transmittance (media.ts).
    let tMax = select(${analyticLights ? 'emitter.distance' : '1.0e30'}, hit.t, hit.hitAny);
    if (pathStep == 0u && hit.hitAny && mx_material_volume_boundary(tri_material(hit.tri)) &&
        dot(rd,surface_hit_normal(hit)) > 0.0) {
      inMedium = true;
      volumeIndex = tri_material(hit.tri);
${displayAovs ? '      *coverage = 1.0; cameraSegment = false;' : ''}
    }
    if (inMedium) {
      var ms: MxMediumSample;
      var g = medium.g;
      if (volumeIndex != 0xffffffffu) {
        let vs = volume_sample(volumeIndex,ro,rd,tMax,state);
        radiance += beta*vs.emission;
        ms = MxMediumSample(vs.scattered,vs.t,vs.weight);
        g = vs.g;
      } else if (preFlight) {
        ms = mx_homogeneous_event(medium, flight, tMax);
      } else {
        ms = mx_sample_homogeneous(medium, tMax, state);
      }
      beta = beta * ms.weight;
      environmentBeta = environmentBeta * ms.weight;
      if (ms.scattered) {
        if (!subsurfaceWalk && bounce >= i32(U.transport.x)) { break; }
        let sp = ro + rd * ms.t;
        let wiM = mx_sample_hg(-rd, g, rng_next(state), rng_next(state));
        specularBounce = false;
        diffuseBounce = false;
        splitFuzzEnvironment = false;
        bsdfPdf = 0.0;
${analyticLights ? '        analyticNee = false; // No analytic-light NEE is performed at a volume collision.' : ''}
        ro = sp;
        rd = wiM;
        let rouletteDepth = select(bounce, subsurfaceEvents, subsurfaceWalk);
        if (rouletteDepth >= ${rouletteDepthExpr} && (!subsurfaceWalk || (subsurfaceEvents - ${rouletteDepthExpr}) % 32 == 0)) {
          let q = clamp(max(beta.x, max(beta.y, beta.z)), 0.0, 0.95);
          if (rng_next(state) >= q) { break; }
          beta = beta / q;
          environmentBeta = environmentBeta / q;
        }
        if (subsurfaceWalk) { subsurfaceEvents++; }
        else { bounce++; }
        continue;
      }
    }
${analyticLights ? `    if (!hit.hitAny && emitter.hit) {
${displayAovs ? '      if (cameraSegment) { *coverage = 1.0; }' : ''}
      var weight = 1.0;
      if (analyticNee) {
        weight = power_heuristic(1.0, bsdfPdf, 1.0, emitter.pdf);
      }
      radiance += beta * emitter.radiance * weight;
      break;
    }` : ''}
    if (!hit.hitAny) {
${displayAovs ? '      if (cameraSegment) { break; } // Visible dome is composited at display resolution.' : ''}
      // Environment reached by BSDF sampling; MIS-weight it against the env
      // next-event strategy unless the previous bounce was specular. Only the
      // separate fuzz/SH path has an analytically integrated environment term.
      if (hasEnv) {
${
        environment
          ? /* wgsl */ `        if (cameraSegment && U.envTexture.y > 0.5) {
          radiance = radiance + beta * env_radiance(backgroundDirection);
        } else if (specularBounce) {
          radiance = radiance + beta * ${envMiss};
        } else if (splitFuzzEnvironment || !diffuseBounce) {
          // Full diffuse/glossy transport, or the residual glossy response when
          // the preceding surface used the separate fuzz/SH integration.
          var envPdf = max(dot(lastN, rd), 0.0) / PI;
          if (U.envExtra.w > 0.5) { envPdf = sky_pdf(rd); }
          let w = power_heuristic(1.0, bsdfPdf, 1.0, envPdf);
          let missBeta = select(beta, environmentBeta, splitFuzzEnvironment);
          radiance = radiance + missBeta * ${envMiss} * w;
        }`
          : /* wgsl */ `        if (specularBounce) {
          radiance = radiance + beta * ${envMiss};
        } else {
          let envPdf = max(dot(lastN, rd), 0.0) / PI;
          let w = power_heuristic(1.0, bsdfPdf, 1.0, envPdf);
          radiance = radiance + beta * ${envMiss} * w;
        }`
      }
      }
      break;
    }
    var pos = ro + rd * hit.t;
    var geometricNormal = surface_hit_geometric_normal(hit);
    var n = surface_hit_normal(hit);
${closureBuild}
    let subsurfaceExit = inMedium && subsurfaceWalk && dot(rd, geometricNormal) > 0.0;
    if (inMedium && dot(rd, geometricNormal) > 0.0) {
      let cosine = dot(rd, geometricNormal);
      let totalInternal = interiorIor > 1.0 && interiorIor * interiorIor * max(0.0, 1.0 - cosine * cosine) >= 1.0;
      let topologyProbability = select(0.0, clamp(subsurfaceTopology, 0.0, 1.0)
        * (1.0 - clamp(dot(subsurfaceEntryNormal, n), 0.0, 1.0)), subsurfaceWalk);
      if (totalInternal || (topologyProbability > 0.0 && rng_next(state) < topologyProbability)) {
        rd = reflect(rd, geometricNormal); ro = pos + rd * 1e-6;
        if (subsurfaceWalk) {
          if (subsurfaceEvents >= ${rouletteDepthExpr} && (subsurfaceEvents - ${rouletteDepthExpr}) % 32 == 0) {
            let probability = clamp(max(beta.x, max(beta.y, beta.z)), 0.0, 0.95);
            if (rng_next(state) >= probability) { break; }
            beta /= probability; environmentBeta /= probability;
          }
          subsurfaceEvents++;
        } else {
          if (bounce >= i32(U.transport.x)) { break; }
          bounce++;
        }
        continue;
      }
    }
    if (mx_material_volume_boundary(tri_material(hit.tri))) {
      subsurfaceWalk = false;
      subsurfaceEvents = 0;
      inMedium = dot(rd, geometricNormal) < 0.0;
      volumeIndex = select(0xffffffffu,tri_material(hit.tri),inMedium);
      medium = MxMedium(c.interiorSigmaA, c.interiorSigmaS, c.interiorG);
${displayAovs ? '      if (inMedium && cameraSegment) { *coverage = 1.0; cameraSegment = false; }' : ''}
      ro = pos + rd * RAY_EPS;
      continue;
    }
    let opacity = clamp(c.opacity, 0.0, 1.0);
    // Null events preserve throughput, MIS state and direction; alpha is
    // coverage, not coloured transmission or a refractive interface.
    if (opacity <= 0.0 || (opacity < 1.0 && rng_next(state) >= opacity)) {
      ro = pos + rd * RAY_EPS;
      continue;
    }
${displayAovs ? `    let aovMode = u32(U.envTexture.w);
    if (cameraSegment) {
      *coverage = 1.0;
      if (aovMode != 0u && aovMode != 4u) {
        let aovNormal = mx_closure_oriented_normal(c, mx_closure_shading_normal(c, n), -rd);
        let aovWo = transpose(basis(aovNormal)) * -rd;
        if (aovMode == 1u) {
          (*surfaceAov).value = vec4f(mx_closure_diffuse_albedo(c, aovWo), 1.0);
        } else if (aovMode == 2u) {
          (*surfaceAov).value = vec4f(aovNormal, 1.0);
        } else if (aovMode == 3u) {
          (*surfaceAov).value = vec4f(length(pos - ro0), 0.0, 0.0, 1.0);
        } else if (aovMode == 5u) {
          (*surfaceAov).value = vec4f(c.emission, 1.0);
        } else if (aovMode == 6u) {
          (*surfaceAov).value = vec4f(mx_closure_transmission_albedo(c), 1.0);
        }
      }
    }` : ''}
    cameraSegment = false;
    if (c.hasEmission != 0u) { radiance = radiance + beta * c.emission; }
    if (subsurfaceExit && subsurfaceMode == 1.0) { break; }
    var allowDirectLighting = !subsurfaceExit || subsurfaceMode >= 1.5;
    var diffusionCount = 0u;
    var spatialLayers: LayeredClosure;
    var spatialOutgoingCosine = 1.0;
    var otherWeight = 0.0;
    for (var index = 0u; index < c.lobeCount; index++) {
      if (mx_is_burley(c.lobes[index])) { diffusionCount++; }
      else { otherWeight += max(c.lobes[index].weight, 0.0); }
    }
    if (diffusionCount > 0u) {
      let hasLayers = c.hasCoat != 0u || c.hasSheen != 0u || c.hasFuzz != 0u;
      let probability = select(0.5, 1.0, otherWeight <= 0.0 && !hasLayers);
      if (rng_next(state) < probability) {
        spatialLayers = c;
        spatialOutgoingCosine = clamp(abs(dot(normalize(-rd), normalize(mx_closure_shading_normal(c, n)))), 0.0, 1.0);
        var selectedDiffusion = min(diffusionCount - 1u, u32(rng_next(state) * f32(diffusionCount)));
        var lobe: MxBsdfLobe;
        for (var index = 0u; index < c.lobeCount; index++) {
          if (mx_is_burley(c.lobes[index])) {
            if (selectedDiffusion == 0u) { lobe = c.lobes[index]; break; }
            selectedDiffusion--;
          }
        }
        let exit = mx_sample_burley(pos, n, geometricNormal, tri_material(hit.tri), lobe, state);
        if (!exit.valid) { break; }
        beta *= exit.weight * lobe.weight * f32(diffusionCount) / probability;
        allowDirectLighting = lobe.extinction.x >= 1.5;
        pos = exit.position; n = exit.normal; geometricNormal = exit.geometricNormal; rd = -n;
        var local: LayeredClosure;
        local.opacity = 1.0; local.lobeCount = 1u;
        local.lobes[0].kind = MX_LOBE_SUBSURFACE;
        local.lobes[0].weight = 1.0; local.lobes[0].color = vec3f(1.0);
        c = local;
      } else {
        beta /= 1.0 - probability;
        var remaining = c;
        remaining.lobeCount = 0u;
        for (var index = 0u; index < c.lobeCount; index++) {
          if (!mx_is_burley(c.lobes[index])) {
            remaining.lobes[remaining.lobeCount] = c.lobes[index]; remaining.lobeCount++;
          }
        }
        c = remaining;
      }
    }
    if (mx_closure_has_dispersion(c) && spectralChannel == 3u) {
      spectralChannel = min(u32(rng_next(state) * 3.0), 2u);
      var channelWeight = vec3f(0.0);
      channelWeight[spectralChannel] = 3.0;
      beta = beta * channelWeight;
      environmentBeta = environmentBeta * channelWeight;
    }
    if (spectralChannel < 3u) { c = mx_closure_spectral_channel(c, spectralChannel); }
    let authoredNormal = mx_closure_shading_normal(c, n);
    let shadingNormal = mx_closure_oriented_normal(c, authoredNormal, -rd);
    let frame = mx_closure_frame(c, shadingNormal, basis(shadingNormal));
    let wo = transpose(frame) * (-rd);

    if (bounce >= i32(U.transport.x)) { break; }

    // A smooth dielectric (clear glass / mirror) is a near-delta BSDF: NEE can
    // only produce fireflies that the clamp removes, so skip it and treat the
    // bounce as specular (environment seen directly, at full weight).
    let specular = mx_closure_is_specular(c);

    // Light and environment next-event estimation, then BSDF sampling. Each
    // strategy only proposes a direction (and radiance/pdf); the shared
    // visibility, BSDF evaluation and layering attenuation below are emitted once
    // so the shader compiler does not inline them per strategy. Random numbers are
    // drawn in the same order as separate blocks would. A delta light has no
    // BSDF-sampling counterpart, so its MIS weight is 1.
    var bs = MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false);
    var bsAttenuation = vec3f(1.0);
    var bsGlossy = vec3f(0.0);
    var u = vec3f(0.0);
    for (var strategy = 0u; strategy < 3u; strategy++) {
      var neeValid = false;
      var neeDirection = vec3f(0.0, 0.0, 1.0);
      var neeLocal = vec3f(0.0, 0.0, 1.0);
      var neeDistance = 1.0e30;
      var neeRadiance = vec3f(0.0);
      var neePdf = 1.0;
      var neeCosine = 0.0;
      var neeDelta = false;
      var neeSpecularOnly = false;
      var neeMisPdf = 1.0;
      var neeBsdf = false;
      var neeFromBase = true;
      if (strategy == 0u) {
${analyticLights ? `        if (allowDirectLighting && !specular && mx_light_count() > 0u) {
          // Resampled importance sampling with a streaming reservoir: candidates follow
          // the power-based selection, the unshadowed target adds distance, emitter
          // orientation and the receiver cosine (floored to keep transmissive support),
          // and one shadow ray is traced for the chosen candidate. MIS against BSDF
          // sampling uses the candidate's source pdf, like emitter hits.
          let candidates = min(mx_light_count(), ${PT_LIGHT_CANDIDATES}u);
          var weightSum = 0.0;
          var chosenTarget = 0.0;
          var chosenPdf = 0.0;
          var chosen: MxLightSample;
          for (var candidate = 0u; candidate < candidates; candidate++) {
            let lightU = vec3f(rng_next(state), rng_next(state), rng_next(state));
            let index = mx_select_light(lightU.x);
            let light = mx_sample_light_at(index, pos, lightU.yz);
            let sourcePdf = light.pdf * mx_light_selection_pmf(index);
            if (!(sourcePdf > 0.0) || sourcePdf > 3.0e38) { continue; }
            let lightTarget = dot(light.radiance, vec3f(0.2126, 0.7152, 0.0722))
              * (max(dot(shadingNormal, light.direction), 0.0) + 0.05);
            let weight = lightTarget / sourcePdf;
            if (!(weight > 0.0)) { continue; }
            weightSum += weight;
            if (rng_white(state) * weightSum < weight) {
              chosen = light;
              chosenTarget = lightTarget;
              chosenPdf = sourcePdf;
            }
          }
          if (chosenTarget > 0.0) {
            neeValid = true;
            neeDirection = chosen.direction;
            neeLocal = transpose(frame) * chosen.direction;
            neeDistance = chosen.distance - 2.0 * RAY_EPS;
            neeRadiance = chosen.radiance;
            neePdf = chosenTarget * f32(candidates) / weightSum;
            neeMisPdf = chosenPdf;
            neeCosine = abs(neeLocal.z);
            neeDelta = chosen.delta;
          }
        }` : `        if (allowDirectLighting && !specular && dot(lightRadiance, lightRadiance) > 0.0) {
          neeValid = true;
          neeDirection = toLight;
          neeLocal = transpose(frame) * toLight;
          neeRadiance = lightRadiance;
          neeCosine = abs(dot(shadingNormal, toLight));
          neeDelta = true;
        }`}
      } else if (strategy == 2u) {
        u = vec3<f32>(rng_next(state), rng_next(state), rng_next(state));
        let pick = mx_closure_sample_pick(c, wo, u);
        if (!pick.valid) { break; }
        neeValid = true;
        neeBsdf = true;
        neeFromBase = pick.fromBase;
        neeLocal = pick.wi;
      } else if (allowDirectLighting && hasEnv && !specular) {
        // Diffuse illumination must test visibility too. Retain the separate SH/LTC
        // integration only for the existing fuzz path.
${
      environment
        ? /* wgsl */ `        let shFuzz = c.hasFuzz != 0u && c.fuzz.weight > 0.0;
        neeSpecularOnly = shFuzz;
        if (shFuzz) {
          let diffE = mx_sh_irradiance(shadingNormal) * U.env.xyz * U.env.w;
          radiance = radiance + beta * mx_closure_diffuse_albedo(c, wo) * (diffE / PI);
        }
        if (U.envExtra.w > 0.5) {
          // Importance-sample the HDR by its MIS-compensated luminance (environment-cdf.ts).
          let sampled = env_map_sample_uv(vec2f(rng_next(state), rng_next(state)));
          let uvS = sampled.xy;
          let wiW = normalize(env_map_uv_to_dir(uvS));
          let wiLocal = transpose(frame) * wiW;
          if (wiLocal.z > 0.0 || mx_closure_has_hair(c)) {
            let colS = textureSampleLevel(envTex, envSampler, uvS, 0.0).xyz * U.envTexture.x;
            let envPdf = env_map_pdf(uvS, sampled.z);
            if (envPdf > 0.0) {
              neeValid = true;
              neeDirection = wiW;
              neeLocal = wiLocal;
              neeRadiance = colS * U.env.xyz * U.env.w;
              neePdf = envPdf;
              neeMisPdf = envPdf;
              neeCosine = abs(wiLocal.z);
            }
          }
        } else {
          let eu = vec2<f32>(rng_next(state), rng_next(state));
          let wiLocal = mx_cosine_hemisphere(eu);
          let envPdf = wiLocal.z / PI;
          if (envPdf > 0.0) {
            let wiW = frame * wiLocal;
            neeValid = true;
            neeDirection = wiW;
            neeLocal = wiLocal;
            neeRadiance = ${envNee};
            neePdf = envPdf;
            neeMisPdf = envPdf;
            neeCosine = wiLocal.z;
          }
        }`
        : /* wgsl */ `        let eu = vec2<f32>(rng_next(state), rng_next(state));
        let wiLocal = mx_cosine_hemisphere(eu);
        let envPdf = wiLocal.z / PI;
        if (envPdf > 0.0) {
          let wiW = frame * wiLocal;
          neeValid = true;
          neeDirection = wiW;
          neeLocal = wiLocal;
          neeRadiance = ${envNee};
          neePdf = envPdf;
          neeMisPdf = envPdf;
          neeCosine = wiLocal.z;
        }`
    }
      }
      if (!neeValid) { continue; }
      var visibility = 1.0;
      if (!neeBsdf) {
        visibility = mx_visibility(pos + neeDirection * RAY_EPS, neeDirection, neeDistance);
        if (visibility <= 0.0) { continue; }
      }
      var ev: MxBsdfEval;
      var basePdf = 1.0;
${environment ? `      // A fuzz BSDF sample also needs its glossy-only response (split SH environment).
      var glossy = vec3f(0.0);
      if (neeSpecularOnly || (neeBsdf && c.hasFuzz != 0u && c.fuzz.weight > 0.0)) {
        ev = mx_closure_specular_eval(c, wo, neeLocal);
        glossy = ev.value;
      }
      if (!neeSpecularOnly) {
        let parts = mx_closure_eval_parts(c, wo, neeLocal);
        ev = parts.full;
        basePdf = parts.base.pdf;
      }` : `      let parts = mx_closure_eval_parts(c, wo, neeLocal);
      ev = parts.full;
      basePdf = parts.base.pdf;`}
      let attenuation = mx_spatial_base_attenuation(spatialLayers, spatialOutgoingCosine, neeLocal);
      if (neeBsdf) {
        // Same validity as mx_closure_sample: a base-lobe direction needs a positive base pdf.
        if (!(neeFromBase && basePdf <= 0.0) && ev.pdf > 0.0) {
          bs = MxBsdfSample(neeLocal, ev.value, ev.pdf, true);
          bsAttenuation = attenuation;
${environment ? '          bsGlossy = glossy;' : ''}
        }
        break;
      }
      let weight = select(power_heuristic(1.0, neeMisPdf, 1.0, ev.pdf), 1.0, neeDelta);
      radiance += beta * ev.value * attenuation * neeRadiance * (neeCosine * visibility * weight / neePdf);
    }
    if (!bs.valid || bs.pdf <= 0.0) { break; }
    let wiWorld = frame * bs.wi;
    let cosS = abs(dot(shadingNormal, wiWorld));
    splitFuzzEnvironment = false;
${
      environment
        ? /* wgsl */ `    if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) {
      // SH already integrated fuzz and diffuse. A mixture sample reaching the
      // dome must carry only the remaining glossy response, regardless of pick.
      splitFuzzEnvironment = true;
      environmentBeta = beta * bsGlossy * cosS / bs.pdf;
    }`
        : ''
    }
    beta = beta * bs.value * bsAttenuation * cosS / bs.pdf;
    bsdfPdf = bs.pdf;
${analyticLights ? '    analyticNee = allowDirectLighting && !specular && mx_light_count() > 0u;' : ''}
  specularBounce = specular || !allowDirectLighting;
    diffuseBounce = splitFuzzEnvironment && mx_closure_sampled_is_diffuse(c, wo, u.z);
    lastN = shadingNormal;
    ro = pos + wiWorld * RAY_EPS;
    rd = wiWorld;

    // Convex-interface assumption: a transmissive bounce enters the surface's
    // interior medium (or leaves the current one), matching integratePath.
    let transmitted = (wo.z > 0.0) != (bs.wi.z > 0.0);
    if (transmitted) {
      if (inMedium) {
        inMedium = false;
        interiorIor = 1.0;
        subsurfaceWalk = false;
        subsurfaceEvents = 0;
        subsurfaceMode = 2.0;
        subsurfaceSelective = false;
        volumeIndex = 0xffffffffu;
      } else if (c.hasInterior != 0u) {
        interiorIor = 1.0;
        subsurfaceWalk = false;
        subsurfaceEvents = 0;
        subsurfaceMode = 2.0;
        subsurfaceMaterial = tri_material(hit.tri);
        subsurfaceEntryNormal = n;
        subsurfaceSubset = 0u;
        subsurfaceTopology = 0.0;
        subsurfaceSelective = false;
        for (var index = 0u; index < c.lobeCount; index++) {
          if (c.lobes[index].kind == MX_LOBE_SUBSURFACE && c.lobes[index].weight > 0.0) {
            interiorIor = max(1.0, c.lobes[index].ior);
            subsurfaceWalk = subsurfaceWalk || any(c.lobes[index].hairTintTRT > vec3f(0.0));
            subsurfaceMode = c.lobes[index].extinction.x;
            subsurfaceSubset = u32(c.lobes[index].rotation);
            subsurfaceTopology = c.lobes[index].extinction.y;
            subsurfaceSelective = subsurfaceSubset > 0u || c.lobes[index].thin > 0.5;
          }
        }
        medium = MxMedium(c.interiorSigmaA, c.interiorSigmaS, c.interiorG);
        inMedium = true;
        let matBase = tri_material(hit.tri)*${PT_MATERIAL_RECORD_FLOATS}u;
        volumeIndex = select(0xffffffffu,tri_material(hit.tri),materials[matBase+29u] != 0.0);
        if (subsurfaceWalk && volumeIndex == 0xffffffffu && any(medium.sigmaS > vec3f(0.0))) {
          if (spectralChannel == 3u) {
            spectralChannel = min(2u, u32(rng_next(state) * 3.0));
            var channelWeight = vec3f(0.0);
            channelWeight[spectralChannel] = 3.0;
            beta *= channelWeight; environmentBeta *= channelWeight;
          }
          medium = MxMedium(vec3f(medium.sigmaA[spectralChannel]), vec3f(medium.sigmaS[spectralChannel]), medium.g);
        }
        if (subsurfaceWalk && volumeIndex == 0xffffffffu) {
          for (var index = 0u; index < c.lobeCount; index++) {
            let lobe = c.lobes[index];
            if (lobe.kind == MX_LOBE_SUBSURFACE && lobe.weight > 0.0 && lobe.dispersion == 0.0 && lobe.ior >= 1.0) {
              let density = mx_sample_davis_density(lobe.extinction.z, state);
              if (density <= 0.0) { return radiance; }
              medium.sigmaA *= density; medium.sigmaS *= density;
              break;
            }
          }
        }
      }
    }

    if (bounce >= ${rouletteDepthExpr}) {
      let q = clamp(max(beta.x, max(beta.y, beta.z)), 0.0, 0.95);
      if (rng_next(state) >= q) { break; }
      beta = beta / q;
      environmentBeta = environmentBeta / q;
    }
    bounce++;
  }
  return radiance;
}
`;
}

function wgslEntry(displayAovs: boolean): string {
  return /* wgsl */ `
struct MxCameraRay {
  origin: vec3<f32>,
  direction: vec3<f32>,
  backgroundDirection: vec3<f32>,
};

fn camera_ray(px : vec2<f32>, dims : vec2<f32>, jitter : vec2<f32>) -> MxCameraRay {
  let ndc = vec2<f32>(
    ((px.x + jitter.x) / dims.x) * 2.0 - 1.0,
    1.0 - ((px.y + jitter.y) / dims.y) * 2.0,
  );
  let near = U.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  // An interior depth avoids a zero homogeneous w at distant far planes in f32.
  let far = U.invViewProj * vec4<f32>(ndc, 0.5, 1.0);
  var ray : MxCameraRay;
  ray.origin = near.xyz / near.w;
  ray.direction = normalize(far.xyz / far.w - ray.origin);
  if (U.transport.w > 0.5) {
    ray.origin = U.eye.xyz;
    ray.direction = normalize(far.xyz / far.w - ray.origin);
  }
  ray.backgroundDirection = ray.direction;
  if (U.envTexture.y > 0.5) {
    let backgroundNear = U.backgroundInvViewProj * vec4<f32>(ndc, 0.0, 1.0);
    ray.backgroundDirection = normalize(backgroundNear.xyz / backgroundNear.w - U.eye.xyz);
  }
  return ray;
}

${displayAovs ? `
${pathTraceAdaptiveSamplingWgsl()}
fn camera_jitter(index: u32, pixel: u32) -> vec2f {
  var n = index + 1u;
  var base3 = 0.0;
  var place = 1.0 / 3.0;
  while (n > 0u) {
    base3 += f32(n % 3u) * place;
    n /= 3u;
    place /= 3.0;
  }
  let shift = vec2f(f32(pcg_hash(pixel)), f32(pcg_hash(pixel ^ 0x68bc21ebu))) * 2.3283064365386963e-10;
  return fract(vec2f(f32(reverseBits(index + 1u)) * 2.3283064365386963e-10, base3) + shift);
}
` : ''}

@compute @workgroup_size(${PT_WORKGROUP_SIZE}, ${PT_WORKGROUP_SIZE}, 1)
fn ${PT_COMPUTE_ENTRY}(@builtin(global_invocation_id) gid : vec3<u32>) {
  let width = u32(U.frame.z);
  let height = u32(U.frame.w);
  if (gid.x >= u32(U.tile.z) || gid.y >= u32(U.tile.w)) { return; }
  let pixelCoord = gid.xy + vec2<u32>(U.tile.xy);
  if (pixelCoord.x >= width || pixelCoord.y >= height) { return; }
  let pixel = pixelCoord.y * width + pixelCoord.x;
  let frameIndex = u32(U.frame.x);
  let spp = max(u32(U.frame.y), 1u);
  let dims = vec2<f32>(U.frame.z, U.frame.w);
${displayAovs ? `  let outputPixel = pixel * 2u;
  let previous = accum[outputPixel];
  let adaptive = U.envTexture.z > 0.5;
  if (adaptive && !mx_adaptive_sample(previous.xyz, accum[outputPixel + 1u].y, previous.w, frameIndex, pixel)) {
    return;
  }
  // Skipped sweeps must not skip or repeat a pixel's own sampling sequence.
  let sampleIndex = select(frameIndex * spp, u32(previous.w), adaptive);
` : ''}

  var state = pcg_hash(pixel + 0x9e3779b9u * (${displayAovs ? 'select(frameIndex, u32(previous.w), adaptive)' : 'frameIndex'} + 1u));
  // eye.w carries an optional per-sample luminance clamp; 0 keeps the tracer
  // unbiased, > 0 tames glossy/env fireflies (hue-preserving down-scale).
  let fireflyMax = U.eye.w;
  var sample = vec3<f32>(0.0);
${displayAovs ? '  var coverage = 0.0;' : ''}
${displayAovs ? '  var batchMeanLuminance = 0.0;\n  var batchM2 = 0.0;' : ''}
${displayAovs ? '  var surfaceSum: MxSurfaceAov;' : ''}
  for (var i = 0u; i < spp; i = i + 1u) {
    mx_begin_sample(pixel, ${displayAovs ? 'sampleIndex' : 'frameIndex * spp'} + i);
    let jitter = ${displayAovs ? 'camera_jitter(sampleIndex + i, pixel)' : 'vec2<f32>(rng_next(&state), rng_next(&state))'};
    let ray = camera_ray(vec2<f32>(pixelCoord), dims, jitter);
${displayAovs ? '    var hitCoverage = 0.0;' : ''}
${displayAovs ? '    var surfaceAov: MxSurfaceAov;' : ''}
    var radiance = integrate(ray.origin, ray.direction, ray.backgroundDirection, &state${displayAovs ? ', &hitCoverage, &surfaceAov' : ''});
${displayAovs ? '    coverage += hitCoverage;' : ''}
${displayAovs ? '    surfaceSum.value += surfaceAov.value;' : ''}
    if (fireflyMax > 0.0) {
      let lum = dot(radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
      if (lum > fireflyMax) { radiance = radiance * (fireflyMax / lum); }
    }
${displayAovs ? `    let sampleLuminance = dot(radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
    let batchDelta = sampleLuminance - batchMeanLuminance;
    batchMeanLuminance += batchDelta / f32(i + 1u);
    batchM2 += batchDelta * (sampleLuminance - batchMeanLuminance);` : ''}
    sample = sample + radiance;
  }
  sample = sample / f32(spp);

  // Progressive accumulation: running mean keyed by frame index.
  let prev = accum[${displayAovs ? 'outputPixel' : 'pixel'}];
  let count = prev.w;
  let sampleCount = f32(spp);
  let totalCount = count + sampleCount;
  let mean = (prev.xyz * count + sample * sampleCount) / totalCount;
  accum[${displayAovs ? 'outputPixel' : 'pixel'}] = vec4<f32>(mean, totalCount);
${displayAovs ? `  let oldCoverage = accum[outputPixel + 1u].x;
  let hits = coverage / f32(spp);
  let oldM2 = accum[outputPixel + 1u].y;
  let oldMeanLuminance = dot(prev.xyz, vec3f(0.2126, 0.7152, 0.0722));
  let delta = batchMeanLuminance - oldMeanLuminance;
  let totalM2 = oldM2 + batchM2 + delta * delta * count * sampleCount / totalCount;
  accum[outputPixel + 1u] = vec4f((oldCoverage * count + hits * sampleCount) / totalCount, totalM2, 0.0, 0.0);
  // Only the explicitly selected guide is stored after the radiance/moments prefix.
  let aovMode = u32(U.envTexture.w);
  if (aovMode != 0u && aovMode != 4u) {
    let aovPixel = width * height * 2u + pixel;
    accum[aovPixel] = (accum[aovPixel] * count + surfaceSum.value) / totalCount;
  }` : ''}
}
`;
}

export interface PathTraceComputeOptions {
    volumeGrid?: boolean;
    textures?: boolean;
    varyings?: PtVaryings;
    dispatch?: PtMaterialDispatch;
    environment?: boolean;
    /** LayeredClosure lobe capacity; must cover every variant and record (default PT_MAX_LOBES). */
    maxLobes?: number;
    /** Specialize runtime lobe dispatch only when all scene materials are known. */
    closureDispatch?: ClosureDispatchSpec;
    /** Viewer-only radiance/moments prefix followed by one explicitly selected AOV. */
    displayAovs?: boolean;
    opaque?: boolean;
    analyticLights?: boolean;
    /** Remove unreachable functions without altering any reachable function body. */
    pruneUnusedFunctions?: boolean;
    /** Compile-time roulette threshold; omit to keep reading it from the frame uniform. */
    rouletteDepth?: number;
}

/** Full WGSL source of the compute path tracer. */
export function pathTraceComputeWgsl(options: PathTraceComputeOptions = {}): string {
  if (options.rouletteDepth !== undefined &&
      (!Number.isSafeInteger(options.rouletteDepth) || options.rouletteDepth < 0 || options.rouletteDepth > 0x7fffffff)) {
    throw new Error('Path-tracing roulette depth specialization must be a non-negative 32-bit integer.');
  }
  const textures = options.textures ?? false;
  const environment = options.environment ?? false;
  const dispatch = options.dispatch;
  const maxLobes = Math.min(Math.max(1, options.maxLobes ?? PT_MAX_LOBES), PT_MAX_LOBES);
  // The dispatcher's merged MxVaryings fields drive the varyings struct, so a
  // graph path always emits the varyings machinery it consumes.
  const varyings = dispatch
    ? { primvarFields: dispatch.primvarFields, extraInputs: dispatch.extraInputs }
    : options.varyings;
  const code = [
    wgslStructsAndBindings(textures, varyings !== undefined, environment),
    wgslRng(),
    BVH_TRAVERSAL_WGSL,
    wgslClosureSurface(textures, maxLobes, options.closureDispatch),
    volumeFieldWgsl(options.volumeGrid ?? false),
    VOLUME_TRANSPORT_WGSL,
    ...(options.analyticLights ? [ANALYTIC_LIGHTS_WGSL] : []),
    ...(varyings !== undefined ? [wgslVaryings(varyings)] : []),
    ...(dispatch !== undefined ? [wgslDispatch(dispatch)] : []),
    wgslIntegrator(textures, dispatch, environment, options.displayAovs ?? false, options.opaque ?? false,
      options.analyticLights ?? false, options.rouletteDepth),
    wgslEntry(options.displayAovs ?? false),
  ].join('\n');
  return options.pruneUnusedFunctions ? pruneWgslFunctions(code, [PT_COMPUTE_ENTRY]) : code;
}

function wgslDispatch(dispatch: PtMaterialDispatch): string {
  const parts: string[] = [];
  if (dispatch.preludes.length > 0) parts.push(dispatch.preludes.join('\n'));
  // Editable params become a MxUniforms block the variants read as `u.<field>`.
  // Current surface lowering bakes constants, so this stays empty for now (T057i3
  // note); the binding sits past the scene buffers (0..7, incl. triTangent) in the
  // graph path.
  if (dispatch.uniforms.length > 0) {
    parts.push(
      `struct MxUniforms {\n${dispatch.uniforms.map((u) => `  ${u.field}: ${u.wgslType},`).join('\n')}\n};\n@group(0) @binding(8) var<uniform> u: MxUniforms;`,
    );
  }
  // Texture/sampler bindings for graph variants: the dedup registry (T057j)
  // lays textures in group 1 and samplers in group 2 so the megakernel binds
  // every material's textures at once. Sampling is wired in T057k.
  for (const t of dispatch.textures) {
    parts.push(`@group(${t.group}) @binding(${t.binding}) var ${t.handle}: ${textureWgslType(t)};`);
  }
  for (const s of dispatch.samplers) {
    parts.push(`@group(${s.group}) @binding(${s.binding}) var ${s.handle}: sampler;`);
  }
  parts.push(dispatch.dispatcherWgsl);
  parts.push(dispatch.sssSubsetDispatcherWgsl ?? 'fn mx_eval_material_sss_subset(matId: u32) -> u32 { return mx_material_sss_subset(matId); }');
  parts.push(dispatch.opacityDispatcherWgsl);
  return parts.join('\n\n');
}

// --- uniform packing ---------------------------------------------------------

/**
 * Pack the per-frame uniform: inverse view-projection (for ray generation), eye,
 * the distant light, the environment radiance and the frame/resolution counters.
 */
export function buildPathTraceUniform(
  scene: PathTraceScene,
  frameIndex: number,
  samplesPerFrame: number,
  width: number,
  height: number,
  fireflyClamp = 0,
  tile?: PathTraceTile,
  maxDepthOverride?: number,
  adaptiveSampling = false,
  pathTracingView: PathTraceView = 'beauty',
  targetRelativeError = PT_CONVERGENCE_TARGET_RELATIVE_ERROR,
): Float32Array {
  const d = new Float32Array(PT_UNIFORM_FLOATS);
  d.set(scene.camera.invViewProj, 0);
  d.set([scene.camera.eye[0], scene.camera.eye[1], scene.camera.eye[2], fireflyClamp], 16);
  d.set([scene.light.direction[0], scene.light.direction[1], scene.light.direction[2], 0], 20);
  d.set([scene.light.color[0], scene.light.color[1], scene.light.color[2], scene.light.intensity], 24);
  const env = scene.environment;
  if (env.enabled === false) {
    d.set([0, 0, 0, 0], 28);
  } else if (env.hasTexture) {
    const tint = env.tint ?? [1, 1, 1];
    d.set([tint[0], tint[1], tint[2], env.intensity ?? 1], 28);
  } else {
    d.set([env.radiance[0], env.radiance[1], env.radiance[2], 0], 28);
  }
  d.set([frameIndex, samplesPerFrame, width, height], 32);
  const hasCdf = env.enabled !== false && env.hasTexture && (env.envTotalSum ?? 0) > 0 && (env.envResX ?? 0) > 0 ? 1 : 0;
  d.set([env.envResX ?? 0, env.envResY ?? 0, env.envTotalSum ?? 0, hasCdf], 36);
  // SH9 irradiance coefficients (9 RGB), one vec4 per coefficient from offset 40.
  const sh = env.sh;
  if (sh && env.enabled !== false) {
    for (let k = 0; k < 9; k++) {
      d.set([sh[k * 3] ?? 0, sh[k * 3 + 1] ?? 0, sh[k * 3 + 2] ?? 0, 0], 40 + k * 4);
    }
  }
  d[75] = targetRelativeError;
  d.set(tile ? [tile.x, tile.y, tile.width, tile.height] : [0, 0, width, height], 76);
  d[80] = env.textureRadianceScale ?? 1;
  d[82] = adaptiveSampling ? 1 : 0;
  d[83] = pathTraceViewIndex(pathTracingView);
  if (scene.camera.backgroundInvViewProj) {
    d[81] = 1;
    d.set(scene.camera.backgroundInvViewProj, 84);
  }
  d.set([maxDepthOverride ?? scene.settings?.maxDepth ?? 64, scene.settings?.rouletteDepth ?? 3,
    scene.analyticLightCount ?? 0, scene.settings?.converted ? 1 : 0], 100);
  return d;
}

// --- backend -----------------------------------------------------------------

export interface PathTracePipeline {
  pipeline: GPUComputePipeline;
  /** The compiled WGSL module, exposed for getCompilationInfo diagnostics. */
  module: GPUShaderModule;
}

/**
 * Owns the compute pipeline and the progressive-accumulation frame counter. The
 * pipeline is created from the generated WGSL with an auto layout (matching the
 * raster backend); buffer uploads and dispatch happen in the browser. The frame
 * counter is reset whenever the scene or camera changes so accumulation restarts
 * cleanly.
 */
export class PathTraceBackend {
  readonly #device: GPUDevice;
  readonly #options: PathTraceComputeOptions;
  #pipeline: PathTracePipeline | null = null;
  #frameIndex = 0;
  #tileIndex = 0;

  constructor(device: GPUDevice, options: PathTraceComputeOptions = {}) {
    this.#device = device;
    this.#options = options;
  }

  get frameIndex(): number {
    return this.#frameIndex;
  }

  /** Reset progressive accumulation (new scene / camera / resize). */
  resetAccumulation(): void {
    this.#frameIndex = 0;
    this.#tileIndex = 0;
  }

  advanceTile(width: number, height: number): { tile: PathTraceTile; frameIndex: number } {
    const frameIndex = this.#frameIndex;
    const tile = pathTraceTile(width, height, this.#tileIndex);
    this.#tileIndex += 1;
    if (this.#tileIndex === pathTraceTileCount(width, height)) {
      this.#tileIndex = 0;
      this.#frameIndex += 1;
    }
    return { tile, frameIndex };
  }

  /** Advance to the next frame and return the previous (current sample) index. */
  advanceFrame(): number {
    const current = this.#frameIndex;
    this.#frameIndex += 1;
    this.#tileIndex = 0;
    return current;
  }

  /** Create (once) the compute pipeline from the generated WGSL. */
  createPipeline(checkedModule?: GPUShaderModule): PathTracePipeline {
    if (this.#pipeline) return this.#pipeline;
    const code = pathTraceComputeWgsl(this.#options);
    const module = checkedModule ?? this.#device.createShaderModule({ code });
    const pipeline = this.#device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: PT_COMPUTE_ENTRY },
    });
    this.#pipeline = { pipeline, module };
    return this.#pipeline;
  }

  /** Async variant: the driver compile (seconds on mobile) does not stall the GPU queue. */
  async createPipelineAsync(module: GPUShaderModule): Promise<PathTracePipeline> {
    if (this.#pipeline) return this.#pipeline;
    const pipeline = await this.#device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module, entryPoint: PT_COMPUTE_ENTRY },
    });
    this.#pipeline = { pipeline, module };
    return this.#pipeline;
  }

  /** Number of workgroups to dispatch to cover a width x height image. */
  static workgroupCount(width: number, height: number): [number, number] {
    return [
      Math.ceil(width / PT_WORKGROUP_SIZE),
      Math.ceil(height / PT_WORKGROUP_SIZE),
    ];
  }

  workgroupCount(width: number, height: number): [number, number] {
    return PathTraceBackend.workgroupCount(width, height);
  }
}
