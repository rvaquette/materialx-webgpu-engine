import { describe, it, expect } from 'vitest';
import { emitWgsl, wgslType, WgslEmitError } from '../../src/compiler/wgsl.ts';
import {
  IrModuleBuilder,
  FLOAT,
  INT,
  COLOR3,
  vector,
  shaderType,
  closureType,
} from '../../src/compiler/ir.ts';

function sampleIr() {
  const b = new IrModuleBuilder();
  b.declareParam({ name: 'gain', type: FLOAT, editable: true });
  b.declarePrimvar({ name: 'st', type: vector(2, 'float', 'texcoord') });
  b.declareTexture({ name: 'baseColor', valueType: COLOR3, colorSpace: 'srgb_texture' });
  b.declareSampler({ name: 'linear' });

  const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
  const tex = b.add({ kind: 'texture', type: COLOR3, texture: 'baseColor', uv, sampler: 'linear' });
  const gain = b.add({ kind: 'param', type: FLOAT, name: 'gain' });
  const scaled = b.add({ kind: 'call', type: COLOR3, op: 'multiply', args: [tex, tex] });
  const diffuse = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'oren_nayar_diffuse_bsdf', params: { weight: gain, color: scaled } });
  const surface = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { bsdf: diffuse, opacity: gain } });
  b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: surface });
  return b.build();
}

describe('wgslType', () => {
  it('maps IR types to WGSL types', () => {
    expect(wgslType(FLOAT)).toBe('f32');
    expect(wgslType(COLOR3)).toBe('vec3f');
    expect(wgslType(vector(2, 'float', 'texcoord'))).toBe('vec2f');
    expect(wgslType(closureType('bsdf'))).toBe('Closure');
    expect(wgslType(shaderType('surface'))).toBe('Closure');
  });
});

describe('emitWgsl', () => {
  function unifiedNoiseModule(dimensions: 2 | 3, explicitPosition = false, kind = 1) {
    const b = new IrModuleBuilder();
    const namedArgs = {
      freq: b.constant(vector(dimensions, 'float'), dimensions === 3 ? [1.8, 2.4, 1.6] : [1.8, 2.4]),
      offset: b.constant(vector(dimensions, 'float'), dimensions === 3 ? [0.2, 0.35, 0.1] : [0.2, 0.35]),
      jitter: b.constant(FLOAT, 0.75),
      type: b.constant(INT, kind),
      octaves: b.constant(INT, 4),
      lacunarity: b.constant(FLOAT, 2.2),
      diminish: b.constant(FLOAT, 0.6),
      outmin: b.constant(FLOAT, -0.7),
      outmax: b.constant(FLOAT, 0.9),
      ...(explicitPosition ? {
        [dimensions === 3 ? 'position' : 'texcoord']: b.constant(vector(dimensions, 'float'), dimensions === 3 ? [2, 3, 4] : [2, 3]),
      } : {}),
    };
    const ref = b.add({ kind: 'call', type: FLOAT, op: `unifiednoise${dimensions}d`, args: [], namedArgs });
    b.output({ name: 'out', type: FLOAT, ref });
    return emitWgsl(b.build()).code;
  }

  it.each([2, 3] as const)('rotates unified cell noise in %i dimensions and emits all dependencies once', (dims) => {
    const code = unifiedNoiseModule(dims);
    expect(code).toContain('let angle = (jitter - 1.0) * 90000.0;');
    expect(code).toContain('mx_rotate3d(p, angle, vec3f(0.1, 1.0, 0.0))');
    expect(code).toContain('mx_rotate2d(p.xy, angle)');
    expect(code).toContain('case 1 { return mx_unified_cell(q, dims); }');
    expect(code).toContain('case 2 { return mx_worley(p, jitter, dims, style, 1).x; }');
    for (const helper of ['mx_unified_cell', 'mx_rotate2d', 'mx_rotate3d', 'mx_unifiednoise']) {
      expect(code.split(`fn ${helper}(`)).toHaveLength(2);
    }
    expect(code).toContain('let seed = 0xdeadbeefu + u32(dims) * 4u + 13u;');
    expect(code).toContain('return f32(mx_unified_hash(vec3i(floor(p)), dims)) / 4294967295.0;');
  });

  it('uses the default geometric position only when unifiednoise3d position is omitted', () => {
    const implicit = unifiedNoiseModule(3);
    const explicit = unifiedNoiseModule(3, true);
    expect(implicit).toMatch(/mx_unifiednoise\(\(vary\.position \*/);
    const position = explicit.match(/let (e\d+) = vec3f\(2\.0, 3\.0, 4\.0\);/)?.[1];
    expect(position).toBeDefined();
    expect(explicit).toContain(`mx_unifiednoise((${position} *`);
    expect(explicit).not.toMatch(/mx_unifiednoise\(\(vary\.position \*/);
  });

  it('keeps the fractal sum signed instead of lifting its zero to 0.5', () => {
    const code = unifiedNoiseModule(3, true, 3);
    const fractalBranch = code.match(/case 3 \{([\s\S]*?)\}/)?.[1];
    expect(fractalBranch).toContain('return mx_unified_fractal3(');
    expect(fractalBranch).not.toContain('0.5');
    expect(code).toContain('result = result + amplitude * mx_unified_perlin3(q);');
    expect(code).toContain('amplitude = amplitude * diminish;');
    expect(code).toContain('q = q * lacunarity;');
    expect(code).toContain('mx_grad3(mx_unified_hash(cell + corner, 3), f - vec3f(corner))');
  });

  it('embeds the 2D fractal position with the jitter angle as its third coordinate', () => {
    const code = unifiedNoiseModule(2, true, 3);
    expect(code).toContain('mx_unified_fractal3(select(q, vec3f(p.xy, angle), dims == 2), octaves, lacunarity, diminish)');
  });

  it('keeps the unified noise helpers out of standalone cellnoise3d modules', () => {
    const b = new IrModuleBuilder();
    const ref = b.add({ kind: 'call', type: FLOAT, op: 'cellnoise3d', args: [] });
    b.output({ name: 'out', type: FLOAT, ref });
    const code = emitWgsl(b.build()).code;
    expect(code).toContain('fn mx_cellnoise3(');
    expect(code).not.toContain('mx_rotate3d');
    expect(code).not.toContain('mx_unified_cell');
  });

  it('emits a complete, deterministic WGSL module', () => {
    const ir = sampleIr();
    const a = emitWgsl(ir);
    const b = emitWgsl(ir);
    expect(a.code).toBe(b.code);

    expect(a.entryPoint).toBe('mx_shade');
    expect(a.code).toContain('struct Closure');
    expect(a.code).toContain('struct MxUniforms');
    expect(a.code).toContain('u.gain');
    expect(a.code).toContain('@group(1) @binding(0) var tex_baseColor: texture_2d<f32>;');
    expect(a.code).toContain('@group(2) @binding(0) var samp_linear: sampler;');
    expect(a.code).toContain('textureSample(tex_baseColor, samp_linear,');
    expect(a.code).toContain('vary.v_st');
    expect(a.code).toContain('mx_oren_nayar_diffuse_bsdf(');
    expect(a.code).toContain('mx_surface(');
    expect(a.code).toContain('result.surfaceshader =');
  });

  it('includes a node prelude only when the node is used', () => {
    const b = new IrModuleBuilder();
    const c = b.constant(COLOR3, [0.5, 0.5, 0.5]);
    const lum = b.add({ kind: 'call', type: COLOR3, op: 'luminance', args: [c] });
    b.output({ name: 'out', type: COLOR3, ref: lum });
    expect(emitWgsl(b.build()).code).toContain('fn mx_luminance');
  });

  it('reports metadata for uniforms, textures, samplers and outputs', () => {
    const m = emitWgsl(sampleIr());
    expect(m.uniforms.map((u) => u.field)).toEqual(['gain']);
    expect(m.textures.map((t) => t.handle)).toEqual(['tex_baseColor']);
    expect(m.samplers.map((s) => s.handle)).toEqual(['samp_linear']);
    expect(m.outputs.map((o) => o.field)).toEqual(['surfaceshader']);
  });

  it('throws on a node without a registered lowering', () => {
    const b = new IrModuleBuilder();
    const c = b.constant(FLOAT, 1);
    const bad = b.add({ kind: 'call', type: FLOAT, op: 'not_a_real_node', args: [c] });
    b.output({ name: 'out', type: FLOAT, ref: bad });
    expect(() => emitWgsl(b.build())).toThrow(WgslEmitError);
  });

  it('folds constants into valid WGSL literals', () => {
    const b = new IrModuleBuilder();
    const c = b.constant(COLOR3, [1, 0.25, 0]);
    b.output({ name: 'out', type: COLOR3, ref: c });
    expect(emitWgsl(b.build()).code).toContain('vec3f(1.0, 0.25, 0.0)');
  });
});

describe('surface closure model (T038/T039)', () => {
  it('injects the BSDF struct and lighting context and integrates over lights', () => {
    const m = emitWgsl(sampleIr());
    // BSDF closure result + lighting context are declared in the shader.
    expect(m.code).toContain('struct BSDF');
    expect(m.code).toContain('response: vec3f');
    expect(m.code).toContain('throughput: vec3f');
    expect(m.code).toContain('struct MxLighting');
    expect(m.code).toContain('@group(0) @binding(1) var<uniform> mxLighting: MxLighting;');
    // The real BSDF lobe integrates radiance by looping over the lights.
    expect(m.code).toContain('for (var i = 0u; i < count; i = i + 1u)');
    expect(m.code).toContain('mxLighting.lights[i]');
    // The lobe receives the view and normal from the varyings; surface composes the result.
    expect(m.code).toContain('mx_surface(');
    expect(m.code).toContain('vary.normal, vary.viewDir)');
    // Lighting metadata is reported for the binder.
    expect(m.lighting).toEqual({ group: 0, binding: 1 });
  });

  it('omits the lighting context for shaders without a lit BSDF lobe', () => {
    const b = new IrModuleBuilder();
    const c = b.constant(COLOR3, [0.5, 0.5, 0.5]);
    b.output({ name: 'out', type: COLOR3, ref: c });
    const m = emitWgsl(b.build());
    expect(m.lighting).toBeUndefined();
    expect(m.code).not.toContain('mxLighting');
    expect(m.code).not.toContain('struct BSDF');
  });
});

describe('real BSDF lobes (T039)', () => {
  function lobeIr(op: string, params: Record<string, string> = {}) {
    const b = new IrModuleBuilder();
    const named: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      named[k] = b.constant(v === 'f32' ? FLOAT : COLOR3, v === 'f32' ? 0.5 : [0.5, 0.5, 0.5]);
    }
    const lobe = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op, params: named });
    const surface = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { bsdf: lobe } });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: surface });
    return b.build();
  }

  it('emits the GGX microfacet + Smith + Schlick helpers for a dielectric lobe', () => {
    const m = emitWgsl(lobeIr('dielectric_bsdf'));
    expect(m.code).toContain('fn mx_ggx_ndf(');
    expect(m.code).toContain('fn mx_smith_g1(');
    expect(m.code).toContain('fn mx_fresnel_schlick(');
    expect(m.code).toContain('fn mx_ggx_reflection(');
    // Real microfacet evaluation, not a constant stub.
    expect(m.code).toContain('mx_fresnel_schlick(F0, VdotH)');
    expect(m.code).toContain('mx_ggx_reflection(F, a, N, V, L)');
  });

  it('emits the unpolarized conductor Fresnel (n/k) for a conductor lobe', () => {
    const m = emitWgsl(lobeIr('conductor_bsdf'));
    expect(m.code).toContain('fn mx_fresnel_conductor(');
    expect(m.code).toContain('mx_fresnel_conductor(ior, extinction, VdotH)');
  });

  it('emits the Charlie sheen distribution for a sheen lobe', () => {
    const m = emitWgsl(lobeIr('sheen_bsdf'));
    expect(m.code).toContain('fn mx_sheen_ndf(');
    expect(m.code).toContain('mx_sheen_ndf(NdotH, r)');
  });

  it('integrates each lit lobe over the lighting context', () => {
    for (const op of [
      'oren_nayar_diffuse_bsdf',
      'burley_diffuse_bsdf',
      'translucent_bsdf',
      'dielectric_bsdf',
      'conductor_bsdf',
      'generalized_schlick_bsdf',
      'sheen_bsdf',
      'subsurface_bsdf',
    ]) {
      const m = emitWgsl(lobeIr(op));
      expect(m.lighting).toEqual({ group: 0, binding: 1 });
      expect(m.code).toContain('for (var i = 0u; i < count; i = i + 1u)');
      expect(m.code).toContain('mxLighting.lights[i]');
    }
  });
});

describe('EDF/VDF and energetic composition (T040)', () => {
  it('emits a view-dependent generalized Schlick EDF', () => {
    const b = new IrModuleBuilder();
    const c0 = b.constant(COLOR3, [0.2, 0.2, 0.2]);
    const c90 = b.constant(COLOR3, [0.8, 0.8, 0.8]);
    const edf = b.add({ kind: 'closure', type: closureType('edf'), closure: 'edf', op: 'generalized_schlick_edf', params: { color: c0, tint: c90 } });
    const surface = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { edf } });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: surface });
    const m = emitWgsl(b.build());
    expect(m.code).toContain('fn mx_generalized_schlick_edf(color0: vec3f, color90: vec3f, N: vec3f, V: vec3f)');
    // View-dependent Schlick factor, not a constant tint multiply.
    expect(m.code).toContain('pow(1.0 - NdotV, 5.0)');
    // Emission receives the shading normal and view direction from the varyings.
    expect(m.code).toContain('vary.normal, vary.viewDir)');
  });

  it('emits uniform EDF emission with zero blocking reflectance', () => {
    const b = new IrModuleBuilder();
    const c = b.constant(COLOR3, [1, 1, 1]);
    const edf = b.add({ kind: 'closure', type: closureType('edf'), closure: 'edf', op: 'uniform_edf', params: { color: c } });
    b.output({ name: 'out', type: closureType('edf'), ref: edf });
    const m = emitWgsl(b.build());
    expect(m.code).toContain('fn mx_uniform_edf(color: vec3f) -> Closure { return Closure(color, 0.0); }');
  });

  it('integrates the anisotropic VDF over the lighting context with a Henyey-Greenstein phase', () => {
    const b = new IrModuleBuilder();
    const vdf = b.add({ kind: 'closure', type: closureType('vdf'), closure: 'vdf', op: 'anisotropic_vdf', params: {} });
    b.output({ name: 'vol', type: closureType('vdf'), ref: vdf });
    const m = emitWgsl(b.build());
    expect(m.lighting).toEqual({ group: 0, binding: 1 });
    expect(m.code).toContain('fn mx_anisotropic_vdf(absorption: vec3f, scattering: vec3f, anisotropy: f32, V: vec3f)');
    // Single-scattering albedo + HG phase, not a scattering - absorption stub.
    expect(m.code).toContain('let albedo = clamp(scattering / extinction');
    expect(m.code).toContain('let phase = (1.0 - g2) / (4.0 * MX_PI * denom);');
    expect(m.code).toContain('mxLighting.lights[i]');
  });

  it('couples the base through the top throughput when layering closures', () => {
    const b = new IrModuleBuilder();
    const top = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'dielectric_bsdf', params: {} });
    const base = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'oren_nayar_diffuse_bsdf', params: {} });
    const layered = b.add({ kind: 'combine', type: closureType('bsdf'), op: 'layer', operands: [top, base] });
    const surface = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { bsdf: layered } });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: surface });
    const m = emitWgsl(b.build());
    expect(m.code).toContain('mx_layer(');
    // Energetic coupling: base attenuated by the top throughput, coverage composited.
    expect(m.code).toContain('top.color + base.color * (1.0 - t)');
    expect(m.code).toContain('t + base.weight * (1.0 - t)');
    // Closure multiply scales the reflectance, not only the response.
    expect(m.code).toContain('a.weight * clamp(dot(w,');
  });
});
