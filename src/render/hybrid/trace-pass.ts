// Hybrid traced-shadow compute pass (plan section 9.3). Reuses the world-space
// BVH packed by scene-buffers.ts (PathTraceScene.nodes / triangles / triangleOrder)
// to resolve per-pixel visibility toward the dominant distant light, on top of a
// raster base pass. The pass reads a G-buffer (world position + world normal
// produced by the raster forward pass) and writes a single-channel visibility
// texture (1 = lit, 0 = occluded) that the raster composite multiplies into the
// direct-light term. It runs as its own compute pass with its own bind group, so
// it is unaffected by the raster pipeline's maxBindGroups budget.
//
// The WGSL generator is a pure string builder (Node-testable); the GPU buffer
// uploads, texture creation and dispatch live in the device harness.

import { BVH_NODE_STRIDE, BVH_TRI_STRIDE, BVH_TRAVERSAL_WGSL } from '../pathtracing/bvh-wgsl.ts';

/** Compute workgroup tile edge (threads per dimension). */
export const HYBRID_WORKGROUP_SIZE = 8;
/** Entry point name of the generated traced-shadow compute shader. */
export const HYBRID_SHADOW_ENTRY = 'mx_hybrid_shadow';

/** Binding slots in the single compute bind group (group 0). */
export const HYBRID_SHADOW_BINDINGS = {
  uniform: 0,
  nodes: 1,
  triangles: 2,
  triangleOrder: 3,
  gPosition: 4,
  gNormal: 5,
  visibility: 6,
} as const;

/** Floats in the shadow uniform (HYBRID_SHADOW_UNIFORM_SIZE / 4): lightDir(4) +
 *  params(4: width, height, normalBias, maxDistance). */
export const HYBRID_SHADOW_UNIFORM_FLOATS = 8;
/** Bytes in the shadow uniform buffer. */
export const HYBRID_SHADOW_UNIFORM_SIZE = HYBRID_SHADOW_UNIFORM_FLOATS * 4;

export interface HybridShadowPass {
  code: string;
  entryPoint: string;
  workgroupSize: number;
}

export interface ShadowUniformInput {
  /** Distant-light direction (the direction light travels), as stored in the
   *  frame uniform; the shader traces toward -lightDir. */
  lightDir: readonly [number, number, number];
  width: number;
  height: number;
  /** Shadow-ray origin offset along the surface normal (world units), to avoid
   *  self-intersection acne. */
  normalBias?: number;
  /** Ray length cutoff (world units); 0 selects an effectively unbounded ray. */
  maxDistance?: number;
}

/** Pack the traced-shadow uniform buffer (HYBRID_SHADOW_UNIFORM_FLOATS floats). */
export function packShadowUniform(input: ShadowUniformInput): Float32Array {
  const d = new Float32Array(HYBRID_SHADOW_UNIFORM_FLOATS);
  d[0] = input.lightDir[0];
  d[1] = input.lightDir[1];
  d[2] = input.lightDir[2];
  d[3] = 0;
  d[4] = input.width;
  d[5] = input.height;
  d[6] = input.normalBias ?? 1.0e-3;
  d[7] = input.maxDistance ?? 0;
  return d;
}

/**
 * Emit the traced-shadow compute shader. For every pixel the raster pass marked
 * as a surface (G-buffer position w > 0), it traces a single occlusion ray from
 * the shaded point toward the light through the shared BVH and writes 0 (shadow)
 * or 1 (lit); background pixels and points facing away from the light are written
 * as 1 and 0 respectively so the composite leaves them untouched / unlit.
 */
export function emitHybridShadowPass(): HybridShadowPass {
  const b = HYBRID_SHADOW_BINDINGS;
  const code = /* wgsl */ `
struct HybridUniforms {
  lightDir : vec4<f32>, // xyz = direction light travels; trace toward -lightDir
  params : vec4<f32>,   // x = width, y = height, z = normalBias, w = maxDistance
};

@group(0) @binding(${b.uniform}) var<uniform> HU : HybridUniforms;
@group(0) @binding(${b.nodes}) var<storage, read> nodes : array<f32>;
@group(0) @binding(${b.triangles}) var<storage, read> tris : array<f32>;
@group(0) @binding(${b.triangleOrder}) var<storage, read> triOrder : array<u32>;
@group(0) @binding(${b.gPosition}) var gPosition : texture_2d<f32>;
@group(0) @binding(${b.gNormal}) var gNormal : texture_2d<f32>;
@group(0) @binding(${b.visibility}) var visibility : texture_storage_2d<r32float, write>;

const NODE_STRIDE : u32 = ${BVH_NODE_STRIDE}u;
const TRI_STRIDE : u32 = ${BVH_TRI_STRIDE}u;
const RAY_EPS : f32 = 1.0e-4;
${BVH_TRAVERSAL_WGSL}

@compute @workgroup_size(${HYBRID_WORKGROUP_SIZE}, ${HYBRID_WORKGROUP_SIZE})
fn ${HYBRID_SHADOW_ENTRY}(@builtin(global_invocation_id) gid : vec3<u32>) {
  let w = u32(HU.params.x);
  let h = u32(HU.params.y);
  if (gid.x >= w || gid.y >= h) { return; }
  let px = vec2<i32>(i32(gid.x), i32(gid.y));

  let posTexel = textureLoad(gPosition, px, 0);
  // Background pixels (no surface) stay fully lit so the composite ignores them.
  if (posTexel.w <= 0.0) {
    textureStore(visibility, px, vec4<f32>(1.0, 0.0, 0.0, 1.0));
    return;
  }

  let pos = posTexel.xyz;
  let n = normalize(textureLoad(gNormal, px, 0).xyz);
  let toLight = normalize(-HU.lightDir.xyz);

  // Surfaces facing away from the light are self-shadowed: emit 0 without tracing.
  let nDotL = dot(n, toLight);
  if (nDotL <= 0.0) {
    textureStore(visibility, px, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let bias = HU.params.z;
  let tMax = select(HU.params.w, 1.0e30, HU.params.w <= 0.0);
  let ro = pos + n * bias;
  let hit = traverse(ro + toLight * RAY_EPS, toLight, tMax, true);
  let vis = select(1.0, 0.0, hit.hitAny);
  textureStore(visibility, px, vec4<f32>(vis, 0.0, 0.0, 1.0));
}
`;
  return { code, entryPoint: HYBRID_SHADOW_ENTRY, workgroupSize: HYBRID_WORKGROUP_SIZE };
}

/** G-buffer vertex/fragment entry points producing the world position + normal
 *  the shadow pass consumes. */
export const GBUFFER_VERTEX_ENTRY = 'mx_gbuffer_vs';
export const GBUFFER_FRAGMENT_ENTRY = 'mx_gbuffer_fs';
/** World-position target carries a surface mask in .w (1 = surface, 0 = cleared). */
export const GBUFFER_POSITION_FORMAT: GPUTextureFormat = 'rgba32float';
export const GBUFFER_NORMAL_FORMAT: GPUTextureFormat = 'rgba16float';

export interface GBufferPass {
  code: string;
  vertexEntry: string;
  fragmentEntry: string;
}

/**
 * Emit the G-buffer pass shader: it transforms position/normal (vertex loc 0/1)
 * by the scene frame uniform's model + viewProj prefix (so it binds the SAME
 * per-draw frame buffer the forward pass uses) and writes world position (.w = 1)
 * and world normal into the two G-buffer targets. Displacement is not re-applied
 * here, so shadows use the base (undisplaced) surface.
 */
export function emitGBufferPass(): GBufferPass {
  const code = /* wgsl */ `
struct GBufUniforms { model : mat4x4<f32>, viewProj : mat4x4<f32> };
@group(0) @binding(0) var<uniform> GU : GBufUniforms;

struct GOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) worldNormal : vec3<f32>,
};

@vertex
fn ${GBUFFER_VERTEX_ENTRY}(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>) -> GOut {
  var o : GOut;
  let world = GU.model * vec4<f32>(position, 1.0);
  o.clip = GU.viewProj * world;
  o.worldPos = world.xyz;
  o.worldNormal = normalize((GU.model * vec4<f32>(normal, 0.0)).xyz);
  return o;
}

struct GTargets {
  @location(0) position : vec4<f32>,
  @location(1) normal : vec4<f32>,
};

@fragment
fn ${GBUFFER_FRAGMENT_ENTRY}(in : GOut) -> GTargets {
  var t : GTargets;
  t.position = vec4<f32>(in.worldPos, 1.0);
  t.normal = vec4<f32>(normalize(in.worldNormal), 0.0);
  return t;
}
`;
  return { code, vertexEntry: GBUFFER_VERTEX_ENTRY, fragmentEntry: GBUFFER_FRAGMENT_ENTRY };
}

/** Shadow-composite fullscreen entry points. */
export const SHADOW_COMPOSITE_VERTEX_ENTRY = 'mx_shadow_composite_vs';
export const SHADOW_COMPOSITE_FRAGMENT_ENTRY = 'mx_shadow_composite_fs';

export interface ShadowCompositePass {
  code: string;
  vertexEntry: string;
  fragmentEntry: string;
}

/**
 * Emit the fullscreen composite that shadows only the direct-light term. It reads
 * the full shaded HDR and an IBL-only HDR (the same scene rendered with the
 * distant light disabled); the per-pixel direct contribution is their difference,
 * so out = ibl + (full - ibl) * (1 - strength * (1 - visibility)). IBL/ambient is
 * never darkened, which is the physically correct behaviour for a cast shadow.
 */
export function emitShadowCompositePass(): ShadowCompositePass {
  const code = /* wgsl */ `
@group(0) @binding(0) var hdrTex : texture_2d<f32>;
@group(0) @binding(1) var iblTex : texture_2d<f32>;
@group(0) @binding(2) var visTex : texture_2d<f32>;
@group(0) @binding(3) var<uniform> CU : vec4<f32>; // x = shadowStrength

@vertex
fn ${SHADOW_COMPOSITE_VERTEX_ENTRY}(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}

@fragment
fn ${SHADOW_COMPOSITE_FRAGMENT_ENTRY}(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  let px = vec2<i32>(i32(frag.x), i32(frag.y));
  let hdr = textureLoad(hdrTex, px, 0);
  let ibl = textureLoad(iblTex, px, 0);
  let vis = textureLoad(visTex, px, 0).r;
  let direct = hdr.rgb - ibl.rgb;
  let atten = 1.0 - CU.x * (1.0 - vis);
  return vec4<f32>(ibl.rgb + direct * atten, hdr.a);
}
`;
  return { code, vertexEntry: SHADOW_COMPOSITE_VERTEX_ENTRY, fragmentEntry: SHADOW_COMPOSITE_FRAGMENT_ENTRY };
}
