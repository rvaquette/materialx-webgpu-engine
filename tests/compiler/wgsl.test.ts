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
