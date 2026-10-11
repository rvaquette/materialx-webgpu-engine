import { describe, it, expect } from 'vitest';
import { extractFeatures } from '../../src/compiler/features.ts';
import {
  IrModuleBuilder,
  FLOAT,
  COLOR3,
  vector,
  shaderType,
  closureType,
} from '../../src/compiler/ir.ts';

describe('extractFeatures', () => {
  it('extracts vertex attributes with canonical semantics and deterministic locations', () => {
    const b = new IrModuleBuilder();
    b.declarePrimvar({ name: 'st', type: vector(2, 'float', 'texcoord') });
    b.declarePrimvar({ name: 'normal', type: vector(3, 'float', 'normal') });
    b.declarePrimvar({ name: 'displayColor', type: vector(3, 'float', 'color') });
    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: uv });

    const f = extractFeatures(b.build());
    expect(f.attributes.map((a) => [a.semantic, a.location])).toEqual([
      ['normal', 0],
      ['texcoord', 1],
      ['color', 2],
    ]);
  });

  it('builds a logical binding layout for params, textures and samplers', () => {
    const b = new IrModuleBuilder();
    b.declareParam({ name: 'gain', type: FLOAT, editable: true });
    b.declareTexture({ name: 'baseColor', valueType: COLOR3, colorSpace: 'srgb_texture' });
    b.declareSampler({ name: 'linear' });
    const p = b.add({ kind: 'param', type: FLOAT, name: 'gain' });
    b.output({ name: 'out', type: FLOAT, ref: p });

    const f = extractFeatures(b.build());
    expect(f.layout.uniforms).toEqual([{ name: 'gain', type: FLOAT }]);
    expect(f.layout.textures[0]).toMatchObject({ name: 'baseColor', colorSpace: 'srgb_texture', group: 1, binding: 0 });
    expect(f.layout.samplers[0]).toMatchObject({ name: 'linear', group: 2, binding: 0 });
  });

  it('detects capability flags, closure usage and passes structurally', () => {
    const b = new IrModuleBuilder();
    const diffuse = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'oren_nayar_diffuse_bsdf', params: {} });
    const dielectric = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'dielectric_bsdf', params: { anisotropy: diffuse, thin_film_thickness: diffuse } });
    const vol = b.add({ kind: 'closure', type: closureType('vdf'), closure: 'vdf', op: 'anisotropic_vdf', params: {} });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: dielectric });
    b.output({ name: 'volumeshader', type: shaderType('volume'), ref: vol });
    b.output({ name: 'displacementshader', type: shaderType('displacement'), ref: diffuse });

    const f = extractFeatures(b.build());
    expect(f.flags).toMatchObject({
      hasBsdf: true,
      hasVdf: true,
      transmission: true,
      transparency: true,
      anisotropy: true,
      thinFilm: true,
      volume: true,
      displacement: true,
      needsTangentFrame: true,
    });
    expect(f.closures.map((c) => c.op)).toEqual(['anisotropic_vdf', 'dielectric_bsdf', 'oren_nayar_diffuse_bsdf']);
    expect(f.passes.map((p) => p.kind)).toEqual(['displacement', 'opaque', 'transmission', 'volume']);
  });

  it('produces a stable variant key that changes with features', () => {
    const base = new IrModuleBuilder();
    const d = base.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'burley_diffuse_bsdf', params: {} });
    base.output({ name: 'surfaceshader', type: shaderType('surface'), ref: d });
    const ir = base.build();

    const a = extractFeatures(ir).variantKey;
    const b2 = extractFeatures(ir).variantKey;
    expect(a).toBe(b2);

    const withTransmission = new IrModuleBuilder();
    const t = withTransmission.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'dielectric_bsdf', params: {} });
    withTransmission.output({ name: 'surfaceshader', type: shaderType('surface'), ref: t });
    expect(extractFeatures(withTransmission.build()).variantKey).not.toBe(a);
  });
});
