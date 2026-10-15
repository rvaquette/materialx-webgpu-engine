// T058b: assemble a complete scene-forward WGSL shader from a compiled layered
// surface module (emitLayeredSurface, surface-wgsl.ts). The material module
// already carries LAYERED_CLOSURE_PRELUDE + CLOSURE_LIBRARY_PRELUDE (mx_closure_*),
// its MxUniforms at @group(0) @binding(0), texture/sampler bindings and the
// mx_surface_layered(vary) -> LayeredClosure fill function. This builder appends a
// dedicated frame uniform block on a distinct bind group, an orthonormal basis
// helper and the vertex/fragment stages. The fragment reconstructs the surface
// LayeredClosure and evaluates it against the single directional light plus the
// constant environment through the shared mx_closure_eval -- the same direct term
// the path tracer megakernel computes per bounce (pathtracing/compute.ts, T057),
// minus shadows, NEE/MIS multi-bounce and textured environments. Additive only:
// no backend consumes this yet (wiring lands in T058c-e, device parity in T059).

import type { LayeredSurfaceModule } from '../../compiler/surface-wgsl.ts';

/** Bind group / binding of the dedicated frame uniform, kept distinct from the
 *  material MxUniforms (group 0), textures (group 1) and samplers (group 2). */
export const IR_FORWARD_FRAME_GROUP = 3;
export const IR_FORWARD_FRAME_BINDING = 0;

export const IR_FORWARD_VERTEX_ENTRY = 'vs_forward';
export const IR_FORWARD_FRAGMENT_ENTRY = 'fs_forward';

export interface IrForwardShader {
  code: string;
  vertexEntry: string;
  fragmentEntry: string;
  frameGroup: number;
  frameBinding: number;
}

/** The dedicated per-frame uniform: object transform, camera and the single
 *  directional light plus the constant environment radiance. Separate from the
 *  material MxUniforms so the frame is shared across every material variant. */
function frameBlock(): string {
  return `struct MxFrame {
  model: mat4x4f,
  viewProj: mat4x4f,
  eye: vec4f,
  lightDir: vec4f,
  lightColor: vec4f,
  env: vec4f,
};
@group(${IR_FORWARD_FRAME_GROUP}) @binding(${IR_FORWARD_FRAME_BINDING}) var<uniform> fu: MxFrame;`;
}

/** Branchless orthonormal basis (Duff et al. 2017); columns (t, bt, n) map local
 *  +Z to the world normal. Matches basis() in pathtracing/compute.ts so the raster
 *  and the path tracer evaluate the shared closure in the same shading frame. */
function basisHelper(): string {
  return `fn basis(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3f(t, bt, n);
}`;
}

/** Vertex stage: world-transform position/normal, project to clip space and fill
 *  the interpolated outputs the fragment turns into MxVaryings (viewDir points at
 *  the eye). The upper 3x3 of model transforms the normal (uniform-scale only). */
function vertexStage(): string {
  return `struct MxVertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) texcoord: vec2f,
};
struct MxVertexOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) texcoord: vec2f,
  @location(3) viewDir: vec3f,
};
@vertex
fn ${IR_FORWARD_VERTEX_ENTRY}(vin: MxVertexIn) -> MxVertexOut {
  let world = fu.model * vec4f(vin.position, 1.0);
  let worldPos = world.xyz;
  let worldNormal = normalize((fu.model * vec4f(vin.normal, 0.0)).xyz);
  var out: MxVertexOut;
  out.clip = fu.viewProj * world;
  out.worldPos = worldPos;
  out.worldNormal = worldNormal;
  out.texcoord = vin.texcoord;
  out.viewDir = normalize(fu.eye.xyz - worldPos);
  return out;
}`;
}

/** Fragment stage: rebuild the surface LayeredClosure then shade it with the same
 *  direct term as the path tracer -- delta-light next-event (no shadows) plus a
 *  single constant-environment sample along the normal -- via mx_closure_eval. */
function fragmentStage(surfaceEntry: string, primvarNames: readonly string[]): string {
  // Feed the MxVaryings primvar fields the surface fn reads. 'st' is the default
  // MaterialX texcoord set, so it mirrors the interpolated UV, exactly as the path
  // tracer megakernel maps it (pathtracing/compute.ts). Other primvar/extra-input
  // fields default to zero (WGSL zero-initializes `var vary: MxVaryings`).
  const primvarAssigns = primvarNames
    .filter((name) => name === 'st')
    .map((name) => `  vary.v_${name} = fin.texcoord;`)
    .join('\n');
  return `@fragment
fn ${IR_FORWARD_FRAGMENT_ENTRY}(fin: MxVertexOut) -> @location(0) vec4f {
  var vary: MxVaryings;
  vary.position = fin.worldPos;
  vary.normal = normalize(fin.worldNormal);
  vary.viewDir = normalize(fin.viewDir);
  vary.texcoord = fin.texcoord;${primvarAssigns ? '\n' + primvarAssigns : ''}
  let c = ${surfaceEntry}(vary);
  let n = vary.normal;
  let sframe = basis(n);
  let wo = transpose(sframe) * vary.viewDir;

  // Direct next-event term for the distant (delta) light: a delta direction has
  // no BSDF-sampling counterpart, mirroring the delta light in compute.ts. Raster
  // omits the shadow ray (no occlusion test in the forward pass).
  let toLight = normalize(-fu.lightDir.xyz);
  let wiLight = transpose(sframe) * toLight;
  let ev = mx_closure_eval(c, wo, wiLight);
  let cosL = max(dot(n, toLight), 0.0);
  var radiance = ev.value * (fu.lightColor.xyz * fu.lightColor.w) * cosL;

  // Constant-environment ambient: a single deterministic cosine sample along the
  // normal (wi = +Z), the raster approximation of the env NEE term in compute.ts
  // (no RNG, no MIS). envPdf = wi.z / PI with wi.z = 1 folds to the MX_PI factor.
  let wiEnv = vec3f(0.0, 0.0, 1.0);
  let evEnv = mx_closure_eval(c, wo, wiEnv);
  radiance = radiance + evEnv.value * fu.env.xyz * MX_PI;

  if (c.hasEmission != 0u) { radiance = radiance + c.emission; }
  return vec4f(radiance, 1.0);
}`;
}

/**
 * Assemble the scene-forward WGSL shader for a compiled layered surface module.
 * The material module source is used verbatim (preludes, MxUniforms, MxVaryings,
 * the shared closure library and mx_surface_layered) and extended with the frame
 * uniform, basis helper and vertex/fragment stages. Not consumed by the backend
 * yet (T058b is additive; backend wiring lands in T058d/e).
 */
export function assembleIrForwardShader(surface: LayeredSurfaceModule): IrForwardShader {
  const code = [
    surface.code.trimEnd(),
    frameBlock(),
    basisHelper(),
    vertexStage(),
    fragmentStage(surface.entryPoint, [...surface.primvarFields.keys()]),
  ].join('\n\n') + '\n';
  return {
    code,
    vertexEntry: IR_FORWARD_VERTEX_ENTRY,
    fragmentEntry: IR_FORWARD_FRAGMENT_ENTRY,
    frameGroup: IR_FORWARD_FRAME_GROUP,
    frameBinding: IR_FORWARD_FRAME_BINDING,
  };
}
