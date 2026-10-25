// T058b: structural checks for the scene-forward shader assembled from a compiled
// layered surface module (src/render/raster/ir-forward.ts). The builder is
// additive -- no backend consumes it yet -- so these tests assert the emitted WGSL
// embeds the shared closure library, reconstructs the surface LayeredClosure and
// evaluates the same direct term as the path tracer megakernel. Numeric raster <->
// path tracer parity and device validation are deferred (T058f/T059).

import { describe, it, expect } from 'vitest';
import type {
  ResolvedGraph,
  ResolvedInput,
  ResolvedNode,
  ResolvedValueSource,
} from '../../../src/materialx/graph.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import { emitLayeredSurface } from '../../../src/compiler/surface-wgsl.ts';
import type { LayeredSurfaceModule } from '../../../src/compiler/surface-wgsl.ts';
import { FLOAT } from '../../../src/compiler/ir.ts';
import {
  assembleIrForwardShader,
  IR_FORWARD_FRAME_GROUP,
} from '../../../src/render/raster/ir-forward.ts';

function value(name: string, type: string, raw: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

function surfaceGraph(category: string, surfaceInputs: ResolvedInput[]): ResolvedGraph {
  const surface: ResolvedNode = {
    id: 'SR',
    category,
    type: 'surfaceshader',
    inputs: surfaceInputs,
    provenance: { namePath: '/mat/SR' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surface]]),
  };
}

function forward(category: string, inputs: ResolvedInput[]) {
  const resolved = resolveSurface(surfaceGraph(category, inputs), {});
  expect(resolved).not.toBeNull();
  const surface = emitLayeredSurface(surfaceGraph(category, inputs), resolved!);
  return { surface, shader: assembleIrForwardShader(surface) };
}

describe('assembleIrForwardShader (T058b)', () => {
  it('integrates coated diffuse against the actual HDR without an uncoated SH term', () => {
    const { shader } = forward('standard_surface', [
      value('coat', 'float', '1'), value('coat_color', 'color3', '0.85, 0.2, 0.25'),
    ]);
    expect(shader.code).toContain('if (!mx_forward_sample_diffuse(c))');
    expect(shader.code).toContain('mx_forward_coated_diffuse(c, wo, sframe)');
    expect(shader.code).toContain('albedo * attenuation * mx_forward_environment(wiWorld)');
    expect(shader.code).toContain('albedo * att * mx_forward_environment(lightWorld)');
    expect(shader.code).toContain('if (mx_forward_simple_coat(spec))');
    expect(shader.code).toContain('mx_forward_lobe_environment(l, wo, frame, coatW, c.coat.ior, c.coat.color)');
  });

  it('integrates each RGB channel with its own dispersive closure', () => {
    const { shader } = forward('gltf_pbr', [value('transmission', 'float', '1'), value('dispersion', 'float', '0.35')]);
    expect(shader.code).toContain('if (mx_closure_has_dispersion(c))');
    expect(shader.code).toContain('let spectral = mx_closure_spectral_channel(c, channel);');
    expect(shader.code).toContain('radiance[channel] = light[channel];');
    expect(shader.code).toContain('radiance = mx_forward_lighting(c, n, wo, sframe);');
  });
  it('omits coat, smooth-sheet and dispersion paths a surface cannot reach', () => {
    const { surface, shader } = forward('gltf_pbr', [value('dispersion', 'float', '0.35')]);
    expect(surface.features).toEqual({ coat: false, transmission: false, dispersion: false });
    expect(shader.code).not.toContain('mx_closure_has_dispersion(c)');
    expect(shader.code).not.toContain('mx_forward_coated_diffuse');
    expect(shader.code).not.toContain('mx_forward_simple_coat');
    expect(shader.code).not.toContain('mx_forward_smooth_sheet');
    expect(shader.code).toContain('radiance = mx_forward_lighting(c, n, wo, sframe);');
    expect(shader.code).toContain('if (dielectricIndex >= 0) {');
  });
  it('discards zero coverage and outputs straight alpha for blending', () => {
    const { shader } = forward('gltf_pbr', [value('alpha_mode', 'integer', '2'), value('alpha', 'float', '0.35')]);
    expect(shader.code).toContain('if (c.opacity <= 0.0) { discard; }');
    expect(shader.code).toContain('return vec4f(radiance, clamp(c.opacity, 0.0, 1.0));');
  });

  it('keeps the material module source: shared closure library and surface entry', () => {
    const { surface, shader } = forward('standard_surface', [value('base_color', 'color3', '0.8, 0.1, 0.1')]);
    // The shared library (LayeredClosure struct + mx_closure_eval) rides along.
    expect(shader.code).toContain('struct LayeredClosure {');
    expect(shader.code).toContain('fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval');
    // The surface fill function is preserved and called by the fragment.
    expect(shader.code).toContain('fn mx_surface_layered(vary: MxVaryings) -> LayeredClosure {');
    expect(shader.code).toContain(`let c = ${surface.entryPoint}(vary);`);
  });

  it('declares a dedicated frame uniform on a distinct bind group', () => {
    const { shader } = forward('open_pbr_surface', [value('base_color', 'color3', '0.2, 0.5, 0.9')]);
    expect(shader.code).toContain('struct MxFrame {');
    expect(shader.code).toContain(`@group(${IR_FORWARD_FRAME_GROUP}) @binding(0) var<uniform> fu: MxFrame;`);
    expect(shader.frameGroup).toBe(IR_FORWARD_FRAME_GROUP);
    // Distinct from the material binds: group 0 (MxUniforms), 1 (textures), 2 (samplers).
    expect(IR_FORWARD_FRAME_GROUP).toBeGreaterThan(2);
  });

  it('emits vertex and fragment stages that fill MxVaryings and project the vertex', () => {
    const { shader } = forward('standard_surface', [value('base_color', 'color3', '0.5, 0.5, 0.5')]);
    expect(shader.code).toContain('@vertex');
    expect(shader.code).toContain(`fn ${shader.vertexEntry}(vin: MxVertexIn) -> MxVertexOut`);
    expect(shader.code).toContain('out.clip = fu.viewProj * world;');
    expect(shader.code).toContain('out.viewDir = normalize(fu.eye.xyz - worldPos);');
    expect(shader.code).toContain('@fragment');
    expect(shader.code).toContain(`fn ${shader.fragmentEntry}(fin: MxVertexOut) -> @location(0) vec4f`);
    expect(shader.code).toContain('var vary: MxVaryings;');
    expect(shader.code).toContain('vary.viewDir = normalize(fin.viewDir);');
    expect(shader.code).toContain('let authoredNormal = mx_closure_shading_normal(c, vary.normal);');
    expect(shader.code).toContain('let n = mx_closure_oriented_normal(c, authoredNormal, vary.viewDir);');
  });

  it('shades the closure with the same direct term as the path tracer (delta light, no shadow)', () => {
    const { shader } = forward('standard_surface', [value('base_color', 'color3', '0.5, 0.5, 0.5')]);
    // Orthonormal frame + local wo, mirroring compute.ts.
    expect(shader.code).toContain('fn basis(n: vec3f) -> mat3x3f {');
    expect(shader.code).toContain('let wo = transpose(sframe) * vary.viewDir;');
    // Delta-light next-event term evaluated through the shared closure.
    expect(shader.code).toContain('let toLight = normalize(-fu.lightDir.xyz);');
    expect(shader.code).toContain('let ev = mx_closure_eval(c, wo, wiLight);');
    expect(shader.code).toContain('var radiance = ev.value * (fu.lightColor.xyz * fu.lightColor.w) * cosL;');
    // No shadow ray in the raster forward pass.
    expect(shader.code).not.toContain('traverse(');
  });

  it('integrates specular HDR reflections with the path tracer latlong convention and MIS', () => {
    const { shader } = forward('open_pbr_surface', [value('base_color', 'color3', '0.2, 0.5, 0.9')]);
    expect(shader.code).toContain('radiance = radiance + mx_closure_diffuse_albedo(c, wo) * (mx_sh_irradiance(n) / MX_PI);');
    expect(shader.code).toContain('spec.fuzz.color = vec3f(0.0);');
    expect(shader.code).toContain('atan2(n.z, n.x) * (0.5 / MX_PI) + 0.5');
    expect(shader.code).toContain('acos(clamp(n.y, -1.0, 1.0)) / MX_PI');
    expect(shader.code).toContain('textureSampleLevel(forwardEnv, forwardEnvSampler, uv, 0.0).rgb * fu.envMap.xyz');
    expect(shader.code).toContain('let spec = mx_forward_specular_closure(c);');
    expect(shader.code).toContain('let bs = mx_closure_sample(spec, wo, u);');
    expect(shader.code).toContain('let wi = transpose(sframe) * wiWorld;');
    expect(shader.code).toContain('let em = mx_closure_eval(spec, wo, wi);');
    expect(shader.code).toContain('mx_forward_env_direction((f32(i) + 0.5) / 64.0)');
    expect(shader.code).not.toContain('mix(0.25, 1.0, up)');
  });

  it('excludes SH-lit lobes from HDR sampling without reducing the quadrature', () => {
    const { shader } = forward('standard_surface', []);
    expect(shader.code).toContain('var spec = c;');
    expect(shader.code).toContain('kind == MX_LOBE_DIELECTRIC_REFLECTION || kind == MX_LOBE_CONDUCTOR');
    expect(shader.code).toContain('kind == MX_LOBE_GENERALIZED_SCHLICK || kind == MX_LOBE_DIELECTRIC_TRANSMISSION');
    expect(shader.code).toContain('spec.lobes[i].weight = 0.0;');
    expect(shader.code).toContain('for (var i = 0u; i < 64u; i++)');
    expect(shader.code).toContain('radiance = radiance + bs.value * envDir');
    expect(shader.code).toContain('envPdf * envPdf + em.pdf * em.pdf');
    const fragment = shader.code.slice(shader.code.indexOf('@fragment'));
    expect(fragment).not.toContain('mx_closure_specular_eval(');
    expect(fragment).not.toContain('mx_closure_eval(c, wo, wi).pdf');
  });

  it('uses BSDF-only environment sampling for near-delta glass without lowering the sample count', () => {
    const { shader } = forward('gltf_pbr', [
      value('metallic', 'float', '0'),
      value('transmission', 'float', '1'),
      value('roughness', 'float', '0.01'),
      value('ior', 'float', '1.52'),
    ]);
    const fragment = shader.code.slice(shader.code.indexOf('@fragment'));
    expect(fragment).toContain('let deltaSpecular = mx_closure_is_specular(spec);');
    expect(fragment).toContain('for (var i = 0u; i < 64u; i++)');
    expect(fragment).toContain('var mis = 1.0;');
    expect(fragment).toMatch(/if \(!deltaSpecular\) \{\s+let envPdf = mx_forward_env_pdf/);
    expect(fragment).toContain('if (!deltaSpecular && fu.envMap.w != 0.0 && fu.envInfo.z > 0.0)');
    expect(fragment).toContain('let em = mx_closure_eval(spec, wo, wi);');
    expect(shader.code).toContain('l.roughness < 0.07');
    expect(shader.code).toContain('if (c.hasCoat != 0u && c.coat.weight > 0.0) { return false; }');
  });

  it('integrates exactly smooth thin sheets analytically, retaining the generic path for other closures', () => {
    const { shader } = forward('open_pbr_surface', [
      value('specular_roughness', 'float', '0'),
      value('specular_ior', 'float', '1'),
      value('transmission_weight', 'float', '1'),
      value('geometry_thin_walled', 'boolean', 'true'),
      value('thin_film_weight', 'float', '1'),
      value('thin_film_thickness', 'float', '0.5'),
      value('thin_film_ior', 'float', '1.4'),
    ]);
    expect(shader.code).toContain('if (l.roughness != 0.0 || l.anisotropy != 0.0) { return false; }');
    expect(shader.code).toContain('l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin > 0.0');
    expect(shader.code).toContain('return hasTransmission;');
    expect(shader.code).toContain('frame * vec3f(-wo.xy, wo.z)');
    expect(shader.code).toContain('frame * (-wo)');
    expect(shader.code).toContain('mx_thin_film_fresnel(f, f0, cosV, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior)');
    expect(shader.code).toContain('l.weight * l.color * (1.0 - f) * transmitted');
    expect(shader.code).toMatch(/if \(mx_forward_is_smooth_sheet\(spec\)\) \{\s+radiance = radiance \+ mx_forward_smooth_sheet\(spec, wo, sframe\);/);
    expect(shader.code).toMatch(/else if \(dielectricIndex >= 0\) \{\s+radiance = radiance \+ mx_forward_dielectric_environment\(spec.lobes\[u32\(dielectricIndex\)\], wo, sframe\);\s+\} else \{\s+for \(var i = 0u; i < 64u; i\+\+\)/);
  });

  it('integrates single-lobe rough glass directly with the same 64 samples and both MIS strategies', () => {
    const { shader } = forward('standard_surface', [
      value('base', 'float', '0'),
      value('specular_roughness', 'float', '0.15'),
      value('transmission', 'float', '1'),
      value('transmission_color', 'color3', '0.2, 0.1, 1'),
    ]);
    const direct = shader.code.slice(
      shader.code.indexOf('fn mx_forward_dielectric_environment('),
      shader.code.indexOf('fn mx_sh_irradiance('),
    );
    expect(direct).toContain('for (var i = 0u; i < 64u; i++)');
    expect(direct).toContain('mx_dielectric_transmission_sample(ctx, u)');
    expect(direct).toContain('mx_dielectric_transmission_eval(ctx, wi)');
    expect(direct).toContain('l.weight * bs.value');
    expect(direct).toContain('l.weight * em.value');
    expect(direct).toContain('bs.pdf * bs.pdf + envPdf * envPdf');
    expect(direct).toContain('envPdf * envPdf + em.pdf * em.pdf');
    expect(direct).not.toContain('mx_closure_sample(');
    expect(direct).not.toContain('mx_closure_eval(');
    expect(shader.code).toContain('if (index >= 0 || (l.kind != MX_LOBE_DIELECTRIC_TRANSMISSION');
    expect(direct).toContain('mx_dielectric_reflection_sample(ctx, u.xy)');
    expect(direct).toContain('mx_dielectric_reflection_eval(ctx, wi)');
    expect(direct).toContain('mx_conductor_sample(ctx, u.xy)');
    expect(direct).toContain('mx_conductor_eval(ctx, wi)');
  });

  it('adds the closure emission when present', () => {
    const { shader } = forward('standard_surface', [
      value('base_color', 'color3', '0.5, 0.5, 0.5'),
      value('emission', 'float', '2'),
      value('emission_color', 'color3', '1, 1, 1'),
    ]);
    expect(shader.code).toContain('if (c.hasEmission != 0u) { radiance = radiance + c.emission; }');
  });

  it('feeds the interpolated geometry tangent and derives bitangent before evaluating the material', () => {
    const { shader } = forward('standard_surface', []);
    expect(shader.code).toContain('@location(3) tangent: vec4f');
    expect(shader.code).toContain('let projectedTangent = fin.worldTangent.xyz - vary.normal * dot(vary.normal, fin.worldTangent.xyz);');
    expect(shader.code).toContain('bitangent = normalize(cross(vary.normal, tangent)) * select(1.0, -1.0, fin.worldTangent.w < 0.0);');
    expect(shader.code).toContain('vin.tangent.w * modelSign');
    expect(shader.code).toContain('vary.tangent = tangent;');
    expect(shader.code).toContain('vary.bitangent = bitangent;');
    expect(shader.code.indexOf('vary.bitangent = bitangent;')).toBeLessThan(shader.code.indexOf('let c = mx_surface_layered(vary);'));
    expect(shader.code).toContain('var bitangent = fallbackFrame[1];');
  });
});

// Minimal surface module stub: assembleIrForwardShader only reads the primvar
// keys to decide which v_* varyings the host must feed, so the body is trivial.
function stubModule(primvars: readonly string[]): LayeredSurfaceModule {
  return {
    code: 'fn mx_surface_layered(vary: MxVaryings) -> LayeredClosure { var c: LayeredClosure; return c; }',
    entryPoint: 'mx_surface_layered',
    returnType: 'LayeredClosure',
    family: 'standard_surface',
    uniforms: [],
    textures: [],
    samplers: [],
    primvarFields: new Map(primvars.map((name) => [name, FLOAT])),
    extraInputs: new Map(),
  };
}

describe('assembleIrForwardShader primvar feed (st -> texcoord)', () => {
  it('feeds the st primvar from the interpolated texcoord like the megakernel', () => {
    const shader = assembleIrForwardShader(stubModule(['st']));
    expect(shader.code).toContain('vary.v_st = fin.texcoord;');
  });

  it('omits the primvar assignment when the surface reads no st primvar', () => {
    const shader = assembleIrForwardShader(stubModule([]));
    expect(shader.code).not.toContain('vary.v_st');
  });
});
