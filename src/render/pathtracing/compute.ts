// Compute path-tracing backend (plan section 9, P9, T052). Ports the reference
// path integrator (src/render/pathtracing/integrator.ts) to a WebGPU compute
// shader fed by the packed scene buffers (scene-buffers.ts): it unprojects a
// camera ray per pixel, traverses the world BVH with Moller-Trumbore triangle
// tests, evaluates the OpenPBR surface closures (mirroring surfaceBsdf in
// bsdf.ts), does next-event estimation against the single distant light plus the
// constant environment, continues by BSDF sampling with power-heuristic MIS, and
// terminates with Russian roulette. Samples are accumulated progressively into a
// storage buffer keyed by frame index, so the image refines over frames without
// reimporting the scene. The WGSL generator is a pure string builder (Node-
// testable); pipeline creation is exercised against a mock device; the GPUBuffer
// uploads and dispatch run in the browser (src/main.ts) and are device-only.

import type { PathTraceScene } from './scene-buffers.ts';

/** Compute workgroup tile edge (threads per dimension). */
export const PT_WORKGROUP_SIZE = 8;
/** Entry point name of the generated compute shader. */
export const PT_COMPUTE_ENTRY = 'mx_path_trace';
/** Floats in the path-trace uniform (PT_UNIFORM_SIZE / 4). */
export const PT_UNIFORM_FLOATS = 36;
/** Bytes in the path-trace uniform buffer. */
export const PT_UNIFORM_SIZE = PT_UNIFORM_FLOATS * 4;

// --- WGSL generator ----------------------------------------------------------

function wgslStructsAndBindings(textures: boolean): string {
  const texBindings = textures
    ? /* wgsl */ `
@group(0) @binding(6) var<storage, read> triUv : array<f32>;
@group(0) @binding(7) var<storage, read> matLayer : array<i32>;
@group(0) @binding(8) var bakedTex : texture_2d_array<f32>;
@group(0) @binding(9) var bakedSampler : sampler;
const UV_STRIDE : u32 = 6u;
`
    : '';
  return /* wgsl */ `
struct Uniforms {
  invViewProj : mat4x4<f32>,
  eye : vec4<f32>,
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  env : vec4<f32>,
  frame : vec4<f32>, // x = frameIndex, y = samplesPerFrame, z = width, w = height
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
const MAT_STRIDE : u32 = 12u;
const RAY_EPS : f32 = 1.0e-4;
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

function wgslSurface(): string {
  // Combined OpenPBR surface, mirroring surfaceBsdf in bsdf.ts: a metal conductor
  // lobe, a dielectric specular coat and a Lambert diffuse base, weighted to a
  // partition of unity. GGX NDF + separable Smith masking + Schlick Fresnel.
  return /* wgsl */ `
struct Surface {
  baseColor : vec3<f32>,
  metalness : f32,
  roughness : f32,
  transmission : f32,
  subsurface : f32,
  ior : f32,
  specular : f32,
};

fn load_surface(idx : u32) -> Surface {
  let b = idx * MAT_STRIDE;
  var s : Surface;
  s.baseColor = vec3<f32>(materials[b], materials[b + 1u], materials[b + 2u]);
  s.metalness = materials[b + 3u];
  s.roughness = materials[b + 4u];
  s.transmission = materials[b + 5u];
  s.subsurface = materials[b + 6u];
  s.ior = materials[b + 7u];
  s.specular = materials[b + 8u];
  return s;
}

fn ggx_ndf(cosH : f32, a : f32) -> f32 {
  let a2 = a * a;
  let d = cosH * cosH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1.0e-7);
}

fn smith_g1(cosX : f32, a : f32) -> f32 {
  let a2 = a * a;
  return (2.0 * cosX) / max(cosX + sqrt(a2 + (1.0 - a2) * cosX * cosX), 1.0e-7);
}

fn fresnel_schlick(f0 : vec3<f32>, cosT : f32) -> vec3<f32> {
  let f = pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * f;
}

fn basis(n : vec3<f32>) -> mat3x3<f32> {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3<f32>(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3<f32>(b, s + n.y * n.y * a, -n.y);
  return mat3x3<f32>(t, bt, n);
}

// Local-frame (+Z = normal) combined BSDF value f(wo, wi) and its pdf.
fn surface_eval(s : Surface, wo : vec3<f32>, wi : vec3<f32>) -> vec4<f32> {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return vec4<f32>(0.0); }
  let a = max(s.roughness * s.roughness, 1.0e-3);
  let metal = clamp(s.metalness, 0.0, 1.0);
  let trans = clamp(s.transmission, 0.0, 1.0);
  let spec = clamp(s.specular, 0.0, 1.0);
  let dielectricShare = (1.0 - metal) * (1.0 - trans);
  // The dielectric specular is a Fresnel coat layered OVER the diffuse base: the
  // specular weight scales the highlight, it does not remove the diffuse albedo
  // (only Fresnel, ~F0, attenuates it). Keeping the diffuse at full dielectric
  // share is what lets a brick read as its base color instead of a gray coat.
  let wLambert = dielectricShare;
  let wDielectric = dielectricShare * spec;
  let total = max(metal + wDielectric + wLambert, 1.0e-6);

  let h = normalize(wo + wi);
  let ndf = ggx_ndf(max(h.z, 0.0), a);
  let g = smith_g1(wo.z, a) * smith_g1(wi.z, a);
  let specTerm = ndf * g / max(4.0 * wo.z * wi.z, 1.0e-7);
  let r = (s.ior - 1.0) / (s.ior + 1.0);
  let f0 = clamp(r * r, 0.0, 1.0);
  let fDielectric = fresnel_schlick(vec3<f32>(f0), max(dot(wo, h), 0.0));
  let fMetal = fresnel_schlick(s.baseColor, max(dot(wo, h), 0.0));

  var value = vec3<f32>(0.0);
  value = value + metal * fMetal * specTerm;
  value = value + wDielectric * fDielectric * specTerm;
  value = value + wLambert * s.baseColor / PI;

  // Combined one-sample pdf: diffuse cosine + specular NDF, selection-weighted.
  let diffusePdf = wi.z / PI;
  let specPdf = ndf * max(h.z, 0.0) / max(4.0 * max(dot(wo, h), 1.0e-4), 1.0e-4);
  var pdf = 0.0;
  pdf = pdf + (metal / total) * specPdf;
  pdf = pdf + (wDielectric / total) * specPdf;
  pdf = pdf + (wLambert / total) * diffusePdf;
  return vec4<f32>(value, pdf);
}

struct SurfaceSample { wi : vec3<f32>, value : vec3<f32>, pdf : f32 };

fn cosine_hemisphere(u1 : f32, u2 : f32) -> vec3<f32> {
  let r = sqrt(u1);
  let phi = 2.0 * PI * u2;
  return vec3<f32>(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u1)));
}

fn surface_sample(s : Surface, wo : vec3<f32>, state : ptr<function, u32>) -> SurfaceSample {
  var out : SurfaceSample;
  out.pdf = 0.0;
  if (wo.z <= 0.0) { return out; }
  let a = max(s.roughness * s.roughness, 1.0e-3);
  let metal = clamp(s.metalness, 0.0, 1.0);
  let trans = clamp(s.transmission, 0.0, 1.0);
  let spec = clamp(s.specular, 0.0, 1.0);
  let dielectricShare = (1.0 - metal) * (1.0 - trans);
  let wLambert = dielectricShare;
  let specularWeight = metal + dielectricShare * spec;
  let total = max(specularWeight + wLambert, 1.0e-6);

  let pick = rng_next(state) * total;
  var wi : vec3<f32>;
  if (pick < specularWeight) {
    // Sample a GGX half vector and reflect.
    let u1 = rng_next(state);
    let u2 = rng_next(state);
    let phi = 2.0 * PI * u1;
    let cosTheta = sqrt((1.0 - u2) / (1.0 + (a * a - 1.0) * u2));
    let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
    let hLocal = vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
    wi = reflect(-wo, hLocal);
  } else {
    wi = cosine_hemisphere(rng_next(state), rng_next(state));
  }
  if (wi.z <= 0.0) { return out; }
  let ev = surface_eval(s, wo, wi);
  if (ev.w <= 0.0) { return out; }
  out.wi = wi;
  out.value = ev.xyz;
  out.pdf = ev.w;
  return out;
}
`;
}

function wgslIntegrator(textures: boolean): string {
  const texOverride = textures
    ? /* wgsl */ `
    let layer = matLayer[tri_material(hit.tri)];
    if (layer >= 0) {
      let uv = surface_hit_uv(hit);
      let tx = textureSampleLevel(bakedTex, bakedSampler, uv, layer, 0.0);
      s.baseColor = tx.rgb;
      s.roughness = clamp(tx.a, 0.03, 1.0);
    }`
    : '';
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
  let hasEnv = dot(U.env.xyz, vec3<f32>(1.0)) > 0.0;

  for (var bounce = 0; bounce < 64; bounce = bounce + 1) {
    let hit = traverse(ro, rd, 1.0e30, false);
    if (!hit.hitAny) {
      if (hasEnv) { radiance = radiance + beta * U.env.xyz; }
      break;
    }
    let pos = ro + rd * hit.t;
    let n = surface_hit_normal(hit);
    var s = load_surface(tri_material(hit.tri));${texOverride}
    let frame = basis(n);
    let wo = transpose(frame) * (-rd);

    // Next-event estimation for the distant (delta) light; unit pdf, no MIS.
    let shadow = traverse(pos + toLight * RAY_EPS, toLight, 1.0e30, true);
    if (!shadow.hitAny) {
      let wiLight = transpose(frame) * toLight;
      let ev = surface_eval(s, wo, wiLight);
      let cosL = abs(dot(n, toLight));
      radiance = radiance + beta * ev.xyz * lightRadiance * cosL;
    }

    let bs = surface_sample(s, wo, state);
    if (bs.pdf <= 0.0) { break; }
    let wiWorld = frame * bs.wi;
    let cosS = abs(dot(n, wiWorld));
    beta = beta * bs.value * cosS / bs.pdf;
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
  var sample = vec3<f32>(0.0);
  for (var i = 0u; i < spp; i = i + 1u) {
    let jitter = vec2<f32>(rng_next(&state), rng_next(&state));
    let rd = camera_ray(vec2<f32>(f32(gid.x), f32(gid.y)), dims, jitter);
    sample = sample + integrate(U.eye.xyz, rd, &state);
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
export function pathTraceComputeWgsl(options: { textures?: boolean } = {}): string {
  const textures = options.textures ?? false;
  return [
    wgslStructsAndBindings(textures),
    wgslRng(),
    wgslTraversal(),
    wgslSurface(),
    wgslIntegrator(textures),
    wgslEntry(),
  ].join('\n');
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
): Float32Array {
  const d = new Float32Array(PT_UNIFORM_FLOATS);
  d.set(scene.camera.invViewProj, 0);
  d.set([scene.camera.eye[0], scene.camera.eye[1], scene.camera.eye[2], 0], 16);
  d.set([scene.light.direction[0], scene.light.direction[1], scene.light.direction[2], 0], 20);
  d.set([scene.light.color[0], scene.light.color[1], scene.light.color[2], scene.light.intensity], 24);
  d.set([scene.environment.radiance[0], scene.environment.radiance[1], scene.environment.radiance[2], 0], 28);
  d.set([frameIndex, samplesPerFrame, width, height], 32);
  return d;
}

// --- backend -----------------------------------------------------------------

export interface PathTracePipeline {
  pipeline: GPUComputePipeline;
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
  #pipeline: PathTracePipeline | null = null;
  #frameIndex = 0;

  constructor(device: GPUDevice, options: { textures?: boolean } = {}) {
    this.#device = device;
    this.#textures = options.textures ?? false;
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
    const module = this.#device.createShaderModule({ code: pathTraceComputeWgsl({ textures: this.#textures }) });
    const pipeline = this.#device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: PT_COMPUTE_ENTRY },
    });
    this.#pipeline = { pipeline };
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
