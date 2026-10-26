// T058b: assemble a complete scene-forward WGSL shader from a compiled layered
// surface module (emitLayeredSurface, surface-wgsl.ts). The material module
// already carries LAYERED_CLOSURE_PRELUDE + CLOSURE_LIBRARY_PRELUDE (mx_closure_*),
// its MxUniforms at @group(0) @binding(0), texture/sampler bindings and the
// mx_surface_layered(vary) -> LayeredClosure fill function. This builder appends a
// dedicated frame uniform block on a distinct bind group, an orthonormal basis
// helper and the vertex/fragment stages. The fragment reconstructs the surface
// LayeredClosure and evaluates it against the single directional light plus the
// environment through the shared closures. Reference quadrature retains 64
// BSDF/environment MIS samples; interactive IBL uses 16 mip-filtered BSDF samples.

import type { LayeredSurfaceModule, SurfaceFeatures } from '../../compiler/surface-wgsl.ts';

const ALL_FEATURES: SurfaceFeatures = { coat: true, transmission: true, dispersion: true, thinFilm: true, lobeKinds: [0, 1, 2, 3, 4, 5, 6, 7, 8] };

export type RasterQuality = 'interactive' | 'reference';

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
  rasterQuality?: RasterQuality;
  /** Set to IR_FORWARD_DISP_GROUP when the vertex stage samples a displacement map. */
  displacementGroup?: number;
}

/** The dedicated per-frame uniform: object transform, camera and the single
 *  directional light plus the constant environment radiance. Separate from the
 *  material MxUniforms so the frame is shared across every material variant. */
function frameBlock(f: SurfaceFeatures, quality: RasterQuality): string {
  const reference = quality === 'reference';
  const samples = reference ? 64 : 16;
  return `struct MxFrame {
  model: mat4x4f,
  viewProj: mat4x4f,
  eye: vec4f,
  lightDir: vec4f,
  lightColor: vec4f,
  env: vec4f,
  sh: array<vec4f, 9>,
  envMap: vec4f,
  envInfo: vec4f,
};
@group(${IR_FORWARD_FRAME_GROUP}) @binding(${IR_FORWARD_FRAME_BINDING}) var<uniform> fu: MxFrame;
@group(${IR_FORWARD_FRAME_GROUP}) @binding(4) var forwardEnv: texture_2d<f32>;
@group(${IR_FORWARD_FRAME_GROUP}) @binding(5) var forwardEnvSampler: sampler;
${reference ? `@group(${IR_FORWARD_FRAME_GROUP}) @binding(6) var<storage, read> forwardEnvCdf: array<f32>;` : ''}

fn mx_forward_uv(d: vec3f) -> vec2f {
  let n = normalize(d);
  return vec2f(atan2(n.z, n.x) * (0.5 / MX_PI) + 0.5, acos(clamp(n.y, -1.0, 1.0)) / MX_PI);
}

${reference ? `fn mx_forward_env_pdf(d: vec3f) -> f32 {
  if (fu.envMap.w == 0.0 || fu.envInfo.z <= 0.0) { return 0.0; }
  let uv = mx_forward_uv(d);
  let color = textureSampleLevel(forwardEnv, forwardEnvSampler, uv, 0.0).rgb * fu.envInfo.w;
  let lum = dot(color, vec3f(0.212671, 0.715160, 0.072169));
  return lum * fu.envInfo.x * fu.envInfo.y / (fu.envInfo.z * 2.0 * MX_PI * MX_PI * max(sin(uv.y * MX_PI), 1e-6));
}

fn mx_forward_env_direction(u: f32) -> vec3f {
  let width = u32(fu.envInfo.x);
  var low = 0u;
  var high = width * u32(fu.envInfo.y) - 1u;
  loop {
    if (low >= high) { break; }
    let mid = (low + high) / 2u;
    if (u * fu.envInfo.z < forwardEnvCdf[mid]) { high = mid; } else { low = mid + 1u; }
  }
  let uv = vec2f(f32(low % width), f32(low / width)) / fu.envInfo.xy;
  let phi = uv.x * (2.0 * MX_PI);
  let theta = uv.y * MX_PI;
  return vec3f(-sin(theta) * cos(phi), cos(theta), -sin(theta) * sin(phi));
}` : ''}

fn mx_forward_environment(d: vec3f) -> vec3f {
  if (fu.envMap.w == 0.0) { return fu.env.xyz; }
  let uv = mx_forward_uv(d);
  return textureSampleLevel(forwardEnv, forwardEnvSampler, uv, 0.0).rgb * fu.envMap.xyz;
}
${reference ? '' : `
fn mx_forward_filtered_environment(d: vec3f, pdf: f32) -> vec3f {
  if (fu.envMap.w == 0.0) { return fu.env.xyz; }
  let uv = mx_forward_uv(d);
  let dimensions = vec2f(textureDimensions(forwardEnv));
  let texelSolidAngle = 2.0 * MX_PI * MX_PI * max(sin(uv.y * MX_PI), 1e-6)
    / (dimensions.x * dimensions.y);
  let sampleSolidAngle = 1.0 / max(${samples}.0 * pdf, 1e-20);
  let lod = clamp(0.5 * log2(sampleSolidAngle / texelSolidAngle),
    0.0, f32(textureNumLevels(forwardEnv) - 1u));
  return textureSampleLevel(forwardEnv, forwardEnvSampler, uv, lod).rgb * fu.envMap.xyz;
}
`}

fn mx_forward_sample_diffuse(c: LayeredClosure) -> bool {
  return c.hasCoat != 0u && c.coat.weight > 0.0
    && !(c.hasFuzz != 0u && c.fuzz.weight > 0.0);
}
${f.coat ? `
fn mx_forward_coated_diffuse(c: LayeredClosure, wo: vec3f, frame: mat3x3f) -> vec3f {
  let albedo = mx_closure_diffuse_albedo(c, wo);
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  var radiance = vec3f(0.0);
  for (var i = 0u; i < ${samples}u; i++) {
    let u = vec2f((f32(i) + 0.5) / ${samples}.0,
      f32(reverseBits(i)) * 2.3283064365386963e-10);
    let wi = mx_cosine_hemisphere(u);
    let wiWorld = frame * wi;
    let pdf = wi.z / MX_PI;
${reference ? `    let envPdf = mx_forward_env_pdf(wiWorld);
    let mis = pdf * pdf / max(pdf * pdf + envPdf * envPdf, 1e-20);` : '    let mis = 1.0;'}
    let attenuation = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, wi);
    radiance = radiance + albedo * attenuation * ${reference ? 'mx_forward_environment(wiWorld)' : 'mx_forward_filtered_environment(wiWorld, pdf)'} * (mis / ${samples}.0);
${reference ? `    if (fu.envMap.w != 0.0 && fu.envInfo.z > 0.0) {
      let lightWorld = mx_forward_env_direction(u.x);
      let light = transpose(frame) * lightWorld;
      let lightPdf = mx_forward_env_pdf(lightWorld);
      if (light.z > 0.0 && lightPdf > 0.0) {
        let bsdfPdf = light.z / MX_PI;
        let lightMis = lightPdf * lightPdf / max(lightPdf * lightPdf + bsdfPdf * bsdfPdf, 1e-20);
        let att = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, light);
        radiance = radiance + albedo * att * mx_forward_environment(lightWorld)
          * (lightMis * bsdfPdf / (64.0 * lightPdf));
      }
    }` : ''}
  }
  return radiance;
}
` : ''}
// SH integrates diffuse and LTC fuzz. Keep the fuzz attenuation but remove its
// response from the sampled closure so its environment energy is not counted twice.
fn mx_forward_specular_closure(c: LayeredClosure) -> LayeredClosure {
  var spec = c;
  spec.fuzz.color = vec3f(0.0);
  for (var i = 0u; i < spec.lobeCount; i++) {
    let kind = spec.lobes[i].kind;
    if (!(kind == MX_LOBE_DIELECTRIC_REFLECTION || kind == MX_LOBE_CONDUCTOR
        || kind == MX_LOBE_GENERALIZED_SCHLICK || kind == MX_LOBE_DIELECTRIC_TRANSMISSION)) {
      spec.lobes[i].weight = 0.0;
    }
  }
  return spec;
}
${f.transmission ? `
fn mx_forward_is_smooth_sheet(c: LayeredClosure) -> bool {
  if (c.hasCoat != 0u && c.coat.weight > 0.0) { return false; }
  var hasTransmission = false;
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.roughness != 0.0 || l.anisotropy != 0.0) { return false; }
    if (l.kind != MX_LOBE_DIELECTRIC_REFLECTION
        && !(l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin > 0.0)) { return false; }
    if (l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION) { hasTransmission = true; }
  }
  return hasTransmission;
}

// A smooth sheet has two delta directions; integrate them without repeatedly
// evaluating the thin-film interference inside the GGX quadrature.
fn mx_forward_smooth_sheet(c: LayeredClosure, wo: vec3f, frame: mat3x3f) -> vec3f {
  let cosV = abs(wo.z);
  let reflected = mx_forward_environment(frame * vec3f(-wo.xy, wo.z));
  let transmitted = mx_forward_environment(frame * (-wo));
  var radiance = vec3f(0.0);
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION) {
      let f0 = vec3f(mx_dielectric_f0(l.ior));
      var f = mx_fresnel_schlick(f0, cosV);
      if (c.hasThinFilm != 0u) {
        f = mx_thin_film_fresnel(f, f0, cosV, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior);
      }
      radiance = radiance + l.weight * f * reflected;
    } else {
      let f = mx_fresnel_dielectric(cosV, l.ior);
      radiance = radiance + l.weight * l.color * (1.0 - f) * transmitted;
    }
  }
  return radiance;
}
` : ''}
fn mx_forward_single_dielectric(c: LayeredClosure) -> i32 {
  if (c.hasCoat != 0u && c.coat.weight > 0.0) { return -1; }
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) { return -1; }
  if (c.hasThinFilm != 0u && c.thinFilm.weight > 0.0 && c.thinFilm.thickness > 0.0) { return -1; }
  var index = -1;
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (index >= 0 || (l.kind != MX_LOBE_DIELECTRIC_TRANSMISSION
        && l.kind != MX_LOBE_DIELECTRIC_REFLECTION
        && l.kind != MX_LOBE_CONDUCTOR && l.kind != MX_LOBE_GENERALIZED_SCHLICK)) { return -1; }
    index = i32(i);
  }
  return index;
}

// A single specular lobe can be sampled directly; transmission includes both
// reflection and refraction. Avoid re-evaluating the entire layered stack at
// every quadrature sample, which can exhaust the mobile fragment budget.
fn mx_forward_dielectric_environment(l: MxBsdfLobe, wo: vec3f, frame: mat3x3f) -> vec3f {
  return mx_forward_lobe_environment(l, wo, frame, 0.0, 1.0, vec3f(1.0));
}

fn mx_forward_lobe_environment(l: MxBsdfLobe, wo: vec3f, frame: mat3x3f,
    coatW: f32, coatIor: f32, coatColor: vec3f) -> vec3f {
  let ctx = mx_closure_lobe_ctx(l, wo);
  let deltaSpecular = (l.kind == MX_LOBE_DIELECTRIC_REFLECTION
    || l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION) && l.roughness < 0.07;
  var radiance = vec3f(0.0);
  for (var i = 0u; i < ${samples}u; i++) {
    let u = vec3f((f32(i) + 0.5) / ${samples}.0,
      f32(reverseBits(i)) * 2.3283064365386963e-10,
      fract((f32(i) + 0.5) * 0.61803398875));
    var bs: MxBsdfSample;
    if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION) {
      bs = mx_dielectric_reflection_sample(ctx, u.xy);
    } else if (l.kind == MX_LOBE_CONDUCTOR || l.kind == MX_LOBE_GENERALIZED_SCHLICK) {
      bs = mx_conductor_sample(ctx, u.xy);
    } else {
      bs = mx_dielectric_transmission_sample(ctx, u);
    }
    if (bs.valid && bs.pdf > 0.0) {
${reference ? '      let envDir = mx_forward_environment(frame * bs.wi);' : `      var envDir: vec3f;
      if (deltaSpecular) { envDir = mx_forward_environment(frame * bs.wi); }
      else { envDir = mx_forward_filtered_environment(frame * bs.wi, bs.pdf); }`}
      var mis = 1.0;
${reference ? `      if (!deltaSpecular) {
        let envPdf = mx_forward_env_pdf(frame * bs.wi);
        mis = bs.pdf * bs.pdf / max(bs.pdf * bs.pdf + envPdf * envPdf, 1e-20);
      }` : ''}
      let att = mx_coat_attenuation(coatW, coatIor, coatColor, wo, bs.wi);
      radiance = radiance + att * l.weight * bs.value * envDir * (mis * abs(bs.wi.z) / (${samples}.0 * bs.pdf));
    }
${reference ? `    if (!deltaSpecular && fu.envMap.w != 0.0 && fu.envInfo.z > 0.0) {
      let wiWorld = mx_forward_env_direction((f32(i) + 0.5) / 64.0);
      let wi = transpose(frame) * wiWorld;
      let envPdf = mx_forward_env_pdf(wiWorld);
      if (envPdf > 0.0) {
        var em: MxBsdfEval;
        if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION) {
          em = mx_dielectric_reflection_eval(ctx, wi);
        } else if (l.kind == MX_LOBE_CONDUCTOR || l.kind == MX_LOBE_GENERALIZED_SCHLICK) {
          em = mx_conductor_eval(ctx, wi);
        } else {
          em = mx_dielectric_transmission_eval(ctx, wi);
        }
        let mis = envPdf * envPdf / max(envPdf * envPdf + em.pdf * em.pdf, 1e-20);
        let att = mx_coat_attenuation(coatW, coatIor, coatColor, wo, wi);
        radiance = radiance + att * l.weight * em.value * mx_forward_environment(wiWorld) * (mis * abs(wi.z) / (64.0 * envPdf));
      }
    }` : ''}
  }
  return radiance;
}
${f.coat ? `
fn mx_forward_simple_coat(c: LayeredClosure) -> bool {
  if (!mx_forward_sample_diffuse(c) || c.hasThinFilm != 0u) { return false; }
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind != MX_LOBE_DIELECTRIC_REFLECTION && l.kind != MX_LOBE_CONDUCTOR
        && l.kind != MX_LOBE_GENERALIZED_SCHLICK) { return false; }
  }
  return true;
}

fn mx_forward_coated_specular(c: LayeredClosure, wo: vec3f, frame: mat3x3f) -> vec3f {
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  var coat: MxBsdfLobe;
  coat.kind = MX_LOBE_DIELECTRIC_REFLECTION;
  coat.weight = coatW;
  coat.ior = c.coat.ior;
  coat.roughness = c.coat.roughness;
  var radiance = mx_forward_dielectric_environment(coat, wo, frame);
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    radiance = radiance + mx_forward_lobe_environment(l, wo, frame, coatW, c.coat.ior, c.coat.color);
  }
  return radiance;
}
` : ''}
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
  @location(3) tangent: vec4f,
};
struct MxVertexOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) texcoord: vec2f,
  @location(3) viewDir: vec3f,
  @location(4) worldTangent: vec4f,
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
  let tangent = (fu.model * vec4f(vin.tangent.xyz, 0.0)).xyz;
  let modelSign = select(1.0, -1.0, determinant(mat3x3f(fu.model[0].xyz, fu.model[1].xyz, fu.model[2].xyz)) < 0.0);
  out.worldTangent = vec4f(tangent / max(length(tangent), 1e-20), vin.tangent.w * modelSign);
  return out;
}`;
}

/** Rebuild the material closure, shade direct light and integrate dome IBL. */
function fragmentStage(surfaceEntry: string, primvarNames: readonly string[], f: SurfaceFeatures, quality: RasterQuality): string {
  const reference = quality === 'reference';
  const samples = reference ? 64 : 16;
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
  let fallbackFrame = basis(vary.normal);
  let projectedTangent = fin.worldTangent.xyz - vary.normal * dot(vary.normal, fin.worldTangent.xyz);
  var tangent = fallbackFrame[0];
  var bitangent = fallbackFrame[1];
  if (dot(projectedTangent, projectedTangent) > 1e-10) {
    tangent = normalize(projectedTangent);
    bitangent = normalize(cross(vary.normal, tangent)) * select(1.0, -1.0, fin.worldTangent.w < 0.0);
  }
  vary.tangent = tangent;
  vary.bitangent = bitangent;
  vary.viewDir = normalize(fin.viewDir);
  vary.texcoord = fin.texcoord;${primvarAssigns ? '\n' + primvarAssigns : ''}
  let c = ${surfaceEntry}(vary);
  if (c.opacity <= 0.0) { discard; }
  let authoredNormal = mx_closure_shading_normal(c, vary.normal);
  let n = mx_closure_oriented_normal(c, authoredNormal, vary.viewDir);
  let sframe = basis(n);
  let wo = transpose(sframe) * vary.viewDir;

  var radiance = vec3f(0.0);
${f.dispersion ? `  if (mx_closure_has_dispersion(c)) {
    for (var channel = 0u; channel < 3u; channel++) {
      let spectral = mx_closure_spectral_channel(c, channel);
      let light = mx_forward_lighting(spectral, n, wo, sframe);
      radiance[channel] = light[channel];
    }
  } else {
    radiance = mx_forward_lighting(c, n, wo, sframe);
  }` : '  radiance = mx_forward_lighting(c, n, wo, sframe);'}
  return vec4f(radiance, clamp(c.opacity, 0.0, 1.0));
}

fn mx_forward_lighting(c: LayeredClosure, n: vec3f, wo: vec3f, sframe: mat3x3f) -> vec3f {
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
${f.coat ? `  if (!mx_forward_sample_diffuse(c)) {
    radiance = radiance + mx_closure_diffuse_albedo(c, wo) * (mx_sh_irradiance(n) / MX_PI);
  } else {
    radiance = radiance + mx_forward_coated_diffuse(c, wo, sframe);
  }` : '  radiance = radiance + mx_closure_diffuse_albedo(c, wo) * (mx_sh_irradiance(n) / MX_PI);'}

  // Deterministic BSDF quadrature of the actual dome; diffuse stays in SH above.
  let spec = mx_forward_specular_closure(c);
  let deltaSpecular = mx_closure_is_specular(spec);
  let dielectricIndex = mx_forward_single_dielectric(spec);
  ${f.coat ? `if (mx_forward_simple_coat(spec)) {
    radiance = radiance + mx_forward_coated_specular(spec, wo, sframe);
  } else ` : ''}${f.transmission ? `if (mx_forward_is_smooth_sheet(spec)) {
    radiance = radiance + mx_forward_smooth_sheet(spec, wo, sframe);
  } else ` : ''}if (dielectricIndex >= 0) {
    radiance = radiance + mx_forward_dielectric_environment(spec.lobes[u32(dielectricIndex)], wo, sframe);
  } else {
    for (var i = 0u; i < ${samples}u; i++) {
      let u = vec3f((f32(i) + 0.5) / ${samples}.0,
        f32(reverseBits(i)) * 2.3283064365386963e-10,
        fract((f32(i) + 0.5) * 0.61803398875));
      let bs = mx_closure_sample(spec, wo, u);
      if (bs.valid && bs.pdf > 0.0) {
${reference ? '        let envDir = mx_forward_environment(sframe * bs.wi);' : `        var envDir: vec3f;
        if (deltaSpecular) { envDir = mx_forward_environment(sframe * bs.wi); }
        else { envDir = mx_forward_filtered_environment(sframe * bs.wi, bs.pdf); }`}
        var mis = 1.0;
${reference ? `        if (!deltaSpecular) {
          let envPdf = mx_forward_env_pdf(sframe * bs.wi);
          mis = bs.pdf * bs.pdf / max(bs.pdf * bs.pdf + envPdf * envPdf, 1e-20);
        }` : ''}
        radiance = radiance + bs.value * envDir * (mis * abs(bs.wi.z) / (${samples}.0 * bs.pdf));
      }
${reference ? `      if (!deltaSpecular && fu.envMap.w != 0.0 && fu.envInfo.z > 0.0) {
        let wiWorld = mx_forward_env_direction((f32(i) + 0.5) / 64.0);
        let wi = transpose(sframe) * wiWorld;
        let envPdf = mx_forward_env_pdf(wiWorld);
        if (envPdf > 0.0) {
          let em = mx_closure_eval(spec, wo, wi);
          let mis = envPdf * envPdf / max(envPdf * envPdf + em.pdf * em.pdf, 1e-20);
          radiance = radiance + em.value * mx_forward_environment(wiWorld) * (mis * abs(wi.z) / (64.0 * envPdf));
        }
      }` : ''}
    }
  }

  if (c.hasEmission != 0u) { radiance = radiance + c.emission; }
  return radiance;
}`;
}

/**
 * Assemble the scene-forward WGSL shader for a compiled layered surface module.
 * The material module source is used verbatim (preludes, MxUniforms, MxVaryings,
 * the shared closure library and mx_surface_layered) and extended with the frame
 * uniform, basis helper and vertex/fragment stages. Captures default to reference
 * quality; the interactive viewer explicitly selects filtered IBL.
 */
export function assembleIrForwardShader(surface: LayeredSurfaceModule, options: { displacement?: boolean; rasterQuality?: RasterQuality } = {}): IrForwardShader {
  const displacement = options.displacement === true;
  const rasterQuality = options.rasterQuality ?? 'reference';
  const features = surface.features ?? ALL_FEATURES;
  const code = [
    surface.code.trimEnd(),
    frameBlock(features, rasterQuality),
    basisHelper(),
    vertexStage(displacement),
    fragmentStage(surface.entryPoint, [...surface.primvarFields.keys()], features, rasterQuality),
  ].join('\n\n') + '\n';
  return {
    code,
    vertexEntry: IR_FORWARD_VERTEX_ENTRY,
    fragmentEntry: IR_FORWARD_FRAGMENT_ENTRY,
    frameGroup: IR_FORWARD_FRAME_GROUP,
    frameBinding: IR_FORWARD_FRAME_BINDING,
    rasterQuality,
    ...(displacement ? { displacementGroup: IR_FORWARD_DISP_GROUP } : {}),
  };
}
