import { describe, it, expect } from 'vitest';
import { emitWgsl, wgslType, WgslEmitError } from '../../src/compiler/wgsl.ts';
import {
  IrModuleBuilder,
  FLOAT,
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
