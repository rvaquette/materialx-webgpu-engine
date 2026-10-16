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

/** Bind group of the optional vertex-displacement resources (VTF). The device only
 *  guarantees 4 bind groups (0..3), all already used by material (0), textures (1),
 *  samplers (2) and frame (3); the displacement height map, its sampler and the
 *  MxDisp params therefore share the frame group at free bindings 1, 2 and 3. Only
 *  emitted for materials that carry a height-map displacement. */
export const IR_FORWARD_DISP_GROUP = IR_FORWARD_FRAME_GROUP;

export const IR_FORWARD_VERTEX_ENTRY = 'vs_forward';
export const IR_FORWARD_FRAGMENT_ENTRY = 'fs_forward';

export interface IrForwardShader {
  code: string;
  vertexEntry: string;
  fragmentEntry: string;
  frameGroup: number;
  frameBinding: number;
  /** Set to IR_FORWARD_DISP_GROUP when the vertex stage samples a displacement map. */
  displacementGroup?: number;
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
  sh: array<vec4f, 9>,
};
@group(${IR_FORWARD_FRAME_GROUP}) @binding(${IR_FORWARD_FRAME_BINDING}) var<uniform> fu: MxFrame;

// Diffuse irradiance E(n) from the uploaded SH9 radiance coefficients (cosine-lobe
// convolution A_l). Basis matches projectIrradianceSH on the CPU and mx_sh_irradiance
// in the path tracer so raster and path-traced diffuse IBL agree.
fn mx_sh_irradiance(n: vec3f) -> vec3f {
  let x = n.x; let y = n.y; let z = n.z;
  let A0 = 3.141593; let A1 = 2.094395; let A2 = 0.785398;
  var e = fu.sh[0].xyz * (A0 * 0.282095);
  e = e + fu.sh[1].xyz * (A1 * 0.488603 * y);
  e = e + fu.sh[2].xyz * (A1 * 0.488603 * z);
  e = e + fu.sh[3].xyz * (A1 * 0.488603 * x);
  e = e + fu.sh[4].xyz * (A2 * 1.092548 * x * y);
  e = e + fu.sh[5].xyz * (A2 * 1.092548 * y * z);
  e = e + fu.sh[6].xyz * (A2 * 0.315392 * (3.0 * z * z - 1.0));
  e = e + fu.sh[7].xyz * (A2 * 1.092548 * x * z);
  e = e + fu.sh[8].xyz * (A2 * 0.546274 * (x * x - y * y));
  return e;
}`;
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
 *  the eye). The upper 3x3 of model transforms the normal (uniform-scale only).
 *  With displacement, the object-space position is pushed along the vertex normal
 *  by (height - midpoint) * scale sampled from the height map at the vertex UV
 *  (vertex texture fetch); the interpolated normal is kept and the normal map
 *  carries the fine shading relief. */
function vertexStage(displacement: boolean): string {
  const dispBindings = displacement
    ? `struct MxDisp { scale: f32, midpoint: f32, pad0: f32, pad1: f32 };
@group(${IR_FORWARD_DISP_GROUP}) @binding(1) var dispTex: texture_2d<f32>;
@group(${IR_FORWARD_DISP_GROUP}) @binding(2) var dispSamp: sampler;
@group(${IR_FORWARD_DISP_GROUP}) @binding(3) var<uniform> du: MxDisp;
`
    : '';
  const dispOffset = displacement
    ? `  let h = textureSampleLevel(dispTex, dispSamp, vin.texcoord, 0.0).r;
  let localPos = vin.position + vin.normal * ((h - du.midpoint) * du.scale);`
    : `  let localPos = vin.position;`;
  return `${dispBindings}struct MxVertexIn {
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
${dispOffset}
  let world = fu.model * vec4f(localPos, 1.0);
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

  // Diffuse environment IBL read analytically from the SH9 irradiance probe (the
  // same noise-free term the path tracer uses), so textured albedo reads at the
  // correct brightness instead of the dim constant-ambient estimate.
  radiance = radiance + mx_closure_diffuse_albedo(c) * (mx_sh_irradiance(n) / MX_PI);

  // Glossy/specular environment reflection: the SH probe is diffuse-only, so the
  // specular lobes still sample a constant dome radiance along the mirror direction
  // wiMir = reflect(wo) about the normal (in shading space -wo.xy, +wo.z). wiMir stays
  // above the horizon whenever wo is, so the estimate is valid at grazing (no black
  // silhouette). A hemisphere gradient indexed by the reflected view up (+Y) gives
  // metals the sky/ground variation a single constant term would flatten. Only the
  // specular lobes are evaluated here to avoid double-counting the diffuse SH term.
  let rWorld = reflect(-vary.viewDir, n);
  let up = clamp(rWorld.y * 0.5 + 0.5, 0.0, 1.0);
  let envDir = fu.env.xyz * mix(0.25, 1.0, up);
  let wiMir = vec3f(-wo.x, -wo.y, wo.z);
  let em = mx_closure_specular_eval(c, wo, wiMir);
  if (em.pdf > 0.0) {
    radiance = radiance + em.value * envDir * (wiMir.z / em.pdf);
  }

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
export function assembleIrForwardShader(surface: LayeredSurfaceModule, options: { displacement?: boolean } = {}): IrForwardShader {
  const displacement = options.displacement === true;
  const code = [
    surface.code.trimEnd(),
    frameBlock(),
    basisHelper(),
    vertexStage(displacement),
    fragmentStage(surface.entryPoint, [...surface.primvarFields.keys()]),
  ].join('\n\n') + '\n';
  return {
    code,
    vertexEntry: IR_FORWARD_VERTEX_ENTRY,
    fragmentEntry: IR_FORWARD_FRAGMENT_ENTRY,
    frameGroup: IR_FORWARD_FRAME_GROUP,
    frameBinding: IR_FORWARD_FRAME_BINDING,
    ...(displacement ? { displacementGroup: IR_FORWARD_DISP_GROUP } : {}),
  };
}
