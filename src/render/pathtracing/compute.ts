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

import type { PathTraceScene } from './scene-buffers.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../compiler/surface-wgsl.ts';
import { CLOSURE_LIBRARY_PRELUDE } from '../../compiler/closure-library.ts';
import { emitVaryingsStruct } from '../../compiler/wgsl.ts';
import type { IrType } from '../../compiler/ir.ts';
import { materialClosureReaderWgsl } from './material-record.ts';
import { PT_MATERIAL_DISPATCH_ENTRY, type PtMaterialDispatch } from './material-variant.ts';

/** Compute workgroup tile edge (threads per dimension). */
export const PT_WORKGROUP_SIZE = 8;
/** Entry point name of the generated compute shader. */
export const PT_COMPUTE_ENTRY = 'mx_path_trace';
/** Floats in the path-trace uniform (PT_UNIFORM_SIZE / 4). */
export const PT_UNIFORM_FLOATS = 40;
/** Bytes in the path-trace uniform buffer. */
export const PT_UNIFORM_SIZE = PT_UNIFORM_FLOATS * 4;

// --- WGSL generator ----------------------------------------------------------

/** Merged MxVaryings fields the layered-surface variants consume (T057h). */
export interface PtVaryings {
  primvarFields: Map<string, IrType>;
  extraInputs: Map<string, IrType>;
}

function wgslStructsAndBindings(textures: boolean, varyings: boolean, environment: boolean): string {
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
const TAN_STRIDE : u32 = 9u;
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
const TRI_STRIDE : u32 = 24u;
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
    return c * U.env.xyz * U.env.w;
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
fn env_cdf_at(x : i32, y : i32) -> f32 {
  return envCdf[y * i32(U.envExtra.x) + x];
}
// Two-stage binary search over the single monotonic flat CDF (GLSL-PathTracer-JS
// style): first the row-end checkpoints (column W-1) for the row, then within it.
fn env_map_binary_search(value : f32) -> vec2<f32> {
  let resX = i32(U.envExtra.x);
  let resY = i32(U.envExtra.y);
  var lower = 0;
  var upper = resY - 1;
  loop {
    if (lower >= upper) { break; }
    let mid = (lower + upper) / 2;
    if (value < env_cdf_at(resX - 1, mid)) { upper = mid; } else { lower = mid + 1; }
  }
  let y = clamp(lower, 0, resY - 1);
  lower = 0;
  upper = resX - 1;
  loop {
    if (lower >= upper) { break; }
    let mid = (lower + upper) / 2;
    if (value < env_cdf_at(mid, y)) { upper = mid; } else { lower = mid + 1; }
  }
  let x = clamp(lower, 0, resX - 1);
  return vec2<f32>(f32(x), f32(y)) / vec2<f32>(U.envExtra.x, U.envExtra.y);
}
// Solid-angle PDF of an env sample at uv with pixel radiance 'color'.
fn env_map_pdf_from_uv(uv : vec2<f32>, color : vec3<f32>) -> f32 {
  let theta = uv.y * PI;
  let s = sin(theta);
  if (s <= 0.0) { return 0.0; }
  let p = env_map_luminance(color) / max(U.envExtra.z, 1.0e-6);
  return (p * U.envExtra.x * U.envExtra.y) / (2.0 * PI * PI * s);
}
// Solid-angle PDF the env-importance strategy would assign to direction d (for MIS).
fn sky_pdf(d : vec3<f32>) -> f32 {
  let uv = env_dir_to_uv(normalize(d));
  let color = textureSampleLevel(envTex, envSampler, uv, 0.0).xyz;
  return env_map_pdf_from_uv(uv, color);
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

fn rng_next(state : ptr<function, u32>) -> f32 {
  *state = pcg_hash(*state);
  return f32(*state) * (1.0 / 4294967296.0);
}
`;
}

function wgslTraversal(): string {
  return /* wgsl */ `
struct Hit { t : f32, tri : u32, u : f32, v : f32, hitAny : bool };

fn tri_vertex(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * TRI_STRIDE + slot * 3u;
  return vec3<f32>(tris[b], tris[b + 1u], tris[b + 2u]);
}

fn tri_normal(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * TRI_STRIDE + 9u + slot * 3u;
  return vec3<f32>(tris[b], tris[b + 1u], tris[b + 2u]);
}

fn tri_material(tri : u32) -> u32 {
  return u32(tris[tri * TRI_STRIDE + 18u]);
}

fn intersect_tri(tri : u32, ro : vec3<f32>, rd : vec3<f32>, tMax : f32) -> vec4<f32> {
  let v0 = tri_vertex(tri, 0u);
  let v1 = tri_vertex(tri, 1u);
  let v2 = tri_vertex(tri, 2u);
  let e1 = v1 - v0;
  let e2 = v2 - v0;
  let p = cross(rd, e2);
  let det = dot(e1, p);
  if (abs(det) < 1.0e-9) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let inv = 1.0 / det;
  let tvec = ro - v0;
  let u = dot(tvec, p) * inv;
  if (u < 0.0 || u > 1.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let q = cross(tvec, e1);
  let vv = dot(rd, q) * inv;
  if (vv < 0.0 || u + vv > 1.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let t = dot(e2, q) * inv;
  if (t <= RAY_EPS || t >= tMax) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  return vec4<f32>(t, u, vv, 1.0);
}

fn aabb_hit(node : u32, ro : vec3<f32>, invDir : vec3<f32>, tMax : f32) -> bool {
  let b = node * NODE_STRIDE;
  var tmin = RAY_EPS;
  var tmax = tMax;
  for (var a = 0u; a < 3u; a = a + 1u) {
    let lo = (nodes[b + a] - ro[a]) * invDir[a];
    let hi = (nodes[b + 4u + a] - ro[a]) * invDir[a];
    tmin = max(tmin, min(lo, hi));
    tmax = min(tmax, max(lo, hi));
    if (tmax < tmin) { return false; }
  }
  return true;
}

fn traverse(ro : vec3<f32>, rd : vec3<f32>, tMax : f32, anyHit : bool) -> Hit {
  var result : Hit;
  result.t = tMax;
  result.hitAny = false;
  let invDir = vec3<f32>(1.0 / select(rd.x, 1.0e-20, rd.x == 0.0),
                         1.0 / select(rd.y, 1.0e-20, rd.y == 0.0),
                         1.0 / select(rd.z, 1.0e-20, rd.z == 0.0));
  var stack : array<u32, 64>;
  var sp = 0;
  stack[0] = 0u;
  sp = 1;
  var closest = tMax;
  loop {
    if (sp <= 0) { break; }
    sp = sp - 1;
    let node = stack[sp];
    if (!aabb_hit(node, ro, invDir, closest)) { continue; }
    let b = node * NODE_STRIDE;
    let count = u32(nodes[b + 9u]);
    if (count > 0u) {
      let start = u32(nodes[b + 8u]);
      for (var i = 0u; i < count; i = i + 1u) {
        let tri = triOrder[start + i];
        let h = intersect_tri(tri, ro, rd, closest);
        if (h.w > 0.5) {
          if (anyHit) {
            result.hitAny = true;
            result.t = h.x;
            result.tri = tri;
            return result;
          }
          closest = h.x;
          result.t = h.x;
          result.tri = tri;
          result.u = h.y;
          result.v = h.z;
          result.hitAny = true;
        }
      }
    } else {
      if (sp < 62) {
        stack[sp] = u32(nodes[b + 3u]);
        sp = sp + 1;
        stack[sp] = u32(nodes[b + 7u]);
        sp = sp + 1;
      }
    }
  }
  return result;
}
`;
}

function wgslClosureSurface(textures: boolean): string {
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
    LAYERED_CLOSURE_PRELUDE,
    CLOSURE_LIBRARY_PRELUDE,
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
  return [
    emitVaryingsStruct(varyings.primvarFields, varyings.extraInputs),
    /* wgsl */ `
fn mx_tri_uv(tri : u32, slot : u32) -> vec2<f32> {
  let b = tri * UV_STRIDE + slot * 2u;
  return vec2<f32>(triUv[b], triUv[b + 1u]);
}

fn mx_hit_uv(h : Hit) -> vec2<f32> {
  let w = 1.0 - h.u - h.v;
  return mx_tri_uv(h.tri, 0u) * w + mx_tri_uv(h.tri, 1u) * h.u + mx_tri_uv(h.tri, 2u) * h.v;
}

fn mx_tri_tangent(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * TAN_STRIDE + slot * 3u;
  return vec3<f32>(triTangent[b], triTangent[b + 1u], triTangent[b + 2u]);
}

// Barycentric-interpolated per-triangle tangent; zero when no tangent stream was
// packed (empty buffer), so the caller keeps the branchless basis tangent.
fn mx_hit_tangent(h : Hit) -> vec3<f32> {
  if (arrayLength(&triTangent) < TAN_STRIDE) { return vec3<f32>(0.0); }
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
  let tRaw = mx_hit_tangent(h);
  let hasT = dot(tRaw, tRaw) > 1.0e-10;
  let tang = select(f[0], normalize(tRaw - n * dot(n, tRaw)), hasT);
  vary.position = pos;
  vary.normal = n;
  vary.tangent = tang;
  vary.bitangent = select(f[1], normalize(cross(n, tang)), hasT);
  vary.texcoord = uv;
  vary.viewDir = viewDir;
${assigns.join('\n')}
  return vary;
}`,
  ].join('\n');
}

function wgslIntegrator(textures: boolean, dispatch: boolean, environment: boolean): string {
  const envMiss = environment ? 'env_radiance(rd)' : 'U.env.xyz';
  const envNee = environment ? 'env_radiance(wiW)' : 'U.env.xyz';
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
    var c = ${PT_MATERIAL_DISPATCH_ENTRY}(tri_material(hit.tri), vary);`
    : /* wgsl */ `    var c = mx_material_closure(tri_material(hit.tri));${texOverride}`;
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
${texHelpers}

fn integrate(ro0 : vec3<f32>, rd0 : vec3<f32>, state : ptr<function, u32>) -> vec3<f32> {
  var radiance = vec3<f32>(0.0);
  var beta = vec3<f32>(1.0);
  var ro = ro0;
  var rd = rd0;
  let toLight = normalize(-U.lightDir.xyz);
  let lightRadiance = U.lightColor.xyz * U.lightColor.w;
  let hasEnv = U.env.w > 0.0 || dot(U.env.xyz, vec3<f32>(1.0)) > 0.0;
  // MIS state carried across bounces (mirrors integratePath in integrator.ts).
  var specularBounce = true;
  var bsdfPdf = 0.0;
  var lastN = vec3<f32>(0.0, 0.0, 1.0);

  for (var bounce = 0; bounce < 64; bounce = bounce + 1) {
    let hit = traverse(ro, rd, 1.0e30, false);
    if (!hit.hitAny) {
      // Environment reached by BSDF sampling; MIS-weight it against the env
      // next-event strategy unless the previous bounce was specular.
      if (hasEnv) {
        if (specularBounce) {
          radiance = radiance + beta * ${envMiss};
        } else {
          ${environment ? 'let envPdf = select(max(dot(lastN, rd), 0.0) / PI, sky_pdf(rd), U.envExtra.w > 0.5);' : 'let envPdf = max(dot(lastN, rd), 0.0) / PI;'}
          let w = power_heuristic(1.0, bsdfPdf, 1.0, envPdf);
          radiance = radiance + beta * ${envMiss} * w;
        }
      }
      break;
    }
    let pos = ro + rd * hit.t;
    let n = surface_hit_normal(hit);
${closureBuild}
    let frame = basis(n);
    let wo = transpose(frame) * (-rd);

    // Next-event estimation for the distant (delta) light: a delta direction has
    // no BSDF-sampling counterpart, so its MIS weight is 1 (no power heuristic).
    let shadow = traverse(pos + toLight * RAY_EPS, toLight, 1.0e30, true);
    if (!shadow.hitAny) {
      let wiLight = transpose(frame) * toLight;
      let ev = mx_closure_eval(c, wo, wiLight);
      let cosL = abs(dot(n, toLight));
      radiance = radiance + beta * ev.value * lightRadiance * cosL;
    }

    // Environment next-event estimation, MIS-weighted against BSDF sampling.
    if (hasEnv) {
${
      environment
        ? /* wgsl */ `      if (U.envExtra.w > 0.5) {
        // Importance-sample the HDR by its luminance CDF (unbiased, low variance).
        let uvS = env_map_binary_search(rng_next(state) * max(U.envExtra.z, 1.0e-6));
        let wiW = normalize(env_map_uv_to_dir(uvS));
        let wiLocal = transpose(frame) * wiW;
        if (wiLocal.z > 0.0) {
          let colS = textureSampleLevel(envTex, envSampler, uvS, 0.0).xyz;
          let envPdf = env_map_pdf_from_uv(uvS, colS);
          if (envPdf > 0.0) {
            let shadowE = traverse(pos + wiW * RAY_EPS, wiW, 1.0e30, true);
            if (!shadowE.hitAny) {
              let ev = mx_closure_eval(c, wo, wiLocal);
              let w = power_heuristic(1.0, envPdf, 1.0, ev.pdf);
              radiance = radiance + beta * ev.value * (colS * U.env.xyz * U.env.w) * (w * wiLocal.z / envPdf);
            }
          }
        }
      } else {
        let eu = vec2<f32>(rng_next(state), rng_next(state));
        let wiLocal = mx_cosine_hemisphere(eu);
        let envPdf = wiLocal.z / PI;
        if (envPdf > 0.0) {
          let wiW = frame * wiLocal;
          let shadowE = traverse(pos + wiW * RAY_EPS, wiW, 1.0e30, true);
          if (!shadowE.hitAny) {
            let ev = mx_closure_eval(c, wo, wiLocal);
            let w = power_heuristic(1.0, envPdf, 1.0, ev.pdf);
            radiance = radiance + beta * ev.value * ${envNee} * (w * wiLocal.z / envPdf);
          }
        }
      }`
        : /* wgsl */ `      let eu = vec2<f32>(rng_next(state), rng_next(state));
      let wiLocal = mx_cosine_hemisphere(eu);
      let envPdf = wiLocal.z / PI;
      if (envPdf > 0.0) {
        let wiW = frame * wiLocal;
        let shadowE = traverse(pos + wiW * RAY_EPS, wiW, 1.0e30, true);
        if (!shadowE.hitAny) {
          let ev = mx_closure_eval(c, wo, wiLocal);
          let w = power_heuristic(1.0, envPdf, 1.0, ev.pdf);
          radiance = radiance + beta * ev.value * ${envNee} * (w * wiLocal.z / envPdf);
        }
      }`
    }
    }

    let u = vec3<f32>(rng_next(state), rng_next(state), rng_next(state));
    let bs = mx_closure_sample(c, wo, u);
    if (!bs.valid || bs.pdf <= 0.0) { break; }
    let wiWorld = frame * bs.wi;
    let cosS = abs(dot(n, wiWorld));
    beta = beta * bs.value * cosS / bs.pdf;
    bsdfPdf = bs.pdf;
    specularBounce = false;
    lastN = n;
    ro = pos + wiWorld * RAY_EPS;
    rd = wiWorld;

    if (bounce >= 3) {
      let q = clamp(max(beta.x, max(beta.y, beta.z)), 0.0, 0.95);
      if (rng_next(state) >= q) { break; }
      beta = beta / q;
    }
  }
  return radiance;
}
`;
}

function wgslEntry(): string {
  return /* wgsl */ `
fn camera_ray(px : vec2<f32>, dims : vec2<f32>, jitter : vec2<f32>) -> vec3<f32> {
  let ndc = vec2<f32>(
    ((px.x + jitter.x) / dims.x) * 2.0 - 1.0,
    1.0 - ((px.y + jitter.y) / dims.y) * 2.0,
  );
  let far = U.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let world = far.xyz / far.w;
  return normalize(world - U.eye.xyz);
}

@compute @workgroup_size(${PT_WORKGROUP_SIZE}, ${PT_WORKGROUP_SIZE}, 1)
fn ${PT_COMPUTE_ENTRY}(@builtin(global_invocation_id) gid : vec3<u32>) {
  let width = u32(U.frame.z);
  let height = u32(U.frame.w);
  if (gid.x >= width || gid.y >= height) { return; }
  let pixel = gid.y * width + gid.x;
  let frameIndex = u32(U.frame.x);
  let spp = max(u32(U.frame.y), 1u);
  let dims = vec2<f32>(U.frame.z, U.frame.w);

  var state = pcg_hash(pixel + 0x9e3779b9u * (frameIndex + 1u));
  // eye.w carries an optional per-sample luminance clamp; 0 keeps the tracer
  // unbiased, > 0 tames glossy/env fireflies (hue-preserving down-scale).
  let fireflyMax = U.eye.w;
  var sample = vec3<f32>(0.0);
  for (var i = 0u; i < spp; i = i + 1u) {
    let jitter = vec2<f32>(rng_next(&state), rng_next(&state));
    let rd = camera_ray(vec2<f32>(f32(gid.x), f32(gid.y)), dims, jitter);
    var radiance = integrate(U.eye.xyz, rd, &state);
    if (fireflyMax > 0.0) {
      let lum = dot(radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
      if (lum > fireflyMax) { radiance = radiance * (fireflyMax / lum); }
    }
    sample = sample + radiance;
  }
  sample = sample / f32(spp);

  // Progressive accumulation: running mean keyed by frame index.
  let prev = accum[pixel];
  let count = prev.w;
  let mean = (prev.xyz * count + sample) / (count + 1.0);
  accum[pixel] = vec4<f32>(mean, count + 1.0);
}
`;
}

/** Full WGSL source of the compute path tracer. */
export function pathTraceComputeWgsl(
  options: { textures?: boolean; varyings?: PtVaryings; dispatch?: PtMaterialDispatch; environment?: boolean } = {},
): string {
  const textures = options.textures ?? false;
  const environment = options.environment ?? false;
  const dispatch = options.dispatch;
  // The dispatcher's merged MxVaryings fields drive the varyings struct, so a
  // graph path always emits the varyings machinery it consumes.
  const varyings = dispatch
    ? { primvarFields: dispatch.primvarFields, extraInputs: dispatch.extraInputs }
    : options.varyings;
  return [
    wgslStructsAndBindings(textures, varyings !== undefined, environment),
    wgslRng(),
    wgslTraversal(),
    wgslClosureSurface(textures),
    ...(varyings !== undefined ? [wgslVaryings(varyings)] : []),
    ...(dispatch !== undefined ? [wgslDispatch(dispatch)] : []),
    wgslIntegrator(textures, dispatch !== undefined, environment),
    wgslEntry(),
  ].join('\n');
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
    parts.push(`@group(${t.group}) @binding(${t.binding}) var ${t.handle}: texture_2d<f32>;`);
  }
  for (const s of dispatch.samplers) {
    parts.push(`@group(${s.group}) @binding(${s.binding}) var ${s.handle}: sampler;`);
  }
  parts.push(dispatch.dispatcherWgsl);
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
): Float32Array {
  const d = new Float32Array(PT_UNIFORM_FLOATS);
  d.set(scene.camera.invViewProj, 0);
  d.set([scene.camera.eye[0], scene.camera.eye[1], scene.camera.eye[2], fireflyClamp], 16);
  d.set([scene.light.direction[0], scene.light.direction[1], scene.light.direction[2], 0], 20);
  d.set([scene.light.color[0], scene.light.color[1], scene.light.color[2], scene.light.intensity], 24);
  const env = scene.environment;
  if (env.hasTexture) {
    const tint = env.tint ?? [1, 1, 1];
    d.set([tint[0], tint[1], tint[2], env.intensity ?? 1], 28);
  } else {
    d.set([env.radiance[0], env.radiance[1], env.radiance[2], 0], 28);
  }
  d.set([frameIndex, samplesPerFrame, width, height], 32);
  const hasCdf = env.hasTexture && (env.envTotalSum ?? 0) > 0 && (env.envResX ?? 0) > 0 ? 1 : 0;
  d.set([env.envResX ?? 0, env.envResY ?? 0, env.envTotalSum ?? 0, hasCdf], 36);
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
  readonly #textures: boolean;
  readonly #environment: boolean;
  readonly #dispatch: PtMaterialDispatch | undefined;
  #pipeline: PathTracePipeline | null = null;
  #frameIndex = 0;

  constructor(device: GPUDevice, options: { textures?: boolean; dispatch?: PtMaterialDispatch; environment?: boolean } = {}) {
    this.#device = device;
    this.#textures = options.textures ?? false;
    this.#environment = options.environment ?? false;
    this.#dispatch = options.dispatch;
  }

  get frameIndex(): number {
    return this.#frameIndex;
  }

  /** Reset progressive accumulation (new scene / camera / resize). */
  resetAccumulation(): void {
    this.#frameIndex = 0;
  }

  /** Advance to the next frame and return the previous (current sample) index. */
  advanceFrame(): number {
    const current = this.#frameIndex;
    this.#frameIndex += 1;
    return current;
  }

  /** Create (once) the compute pipeline from the generated WGSL. */
  createPipeline(): PathTracePipeline {
    if (this.#pipeline) return this.#pipeline;
    const code = pathTraceComputeWgsl({
      textures: this.#textures,
      environment: this.#environment,
      ...(this.#dispatch ? { dispatch: this.#dispatch } : {}),
    });
    const module = this.#device.createShaderModule({ code });
    const pipeline = this.#device.createComputePipeline({
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
}
