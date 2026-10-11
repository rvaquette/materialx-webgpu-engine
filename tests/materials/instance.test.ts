import { describe, it, expect } from 'vitest';
import {
  computeUniformLayout,
  createMaterialVariant,
  MaterialInstance,
  MaterialInstanceError,
  type MaterialVariant,
} from '../../src/materials/instance.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { IrModuleBuilder, FLOAT, COLOR3, vector, shaderType } from '../../src/compiler/ir.ts';

function variant(): MaterialVariant {
  const b = new IrModuleBuilder();
  b.declareParam({ name: 'baseColor', type: COLOR3, editable: true });
  b.declareParam({ name: 'roughness', type: FLOAT, editable: true });
  b.declareTexture({ name: 'albedoTex', valueType: COLOR3 });
  b.declareSampler({ name: 'linear' });
  const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
  b.declarePrimvar({ name: 'st', type: vector(2, 'float', 'texcoord') });
  const tex = b.add({ kind: 'texture', type: COLOR3, texture: 'albedoTex', uv, sampler: 'linear' });
  b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: tex });
  return createMaterialVariant(emitWgsl(b.build()), 'pipeline-key-xyz');
}

describe('computeUniformLayout', () => {
  it('applies std140-like alignment and padding', () => {
    const layout = computeUniformLayout([
      { name: 'a', wgslType: 'f32' },
      { name: 'b', wgslType: 'vec3f' },
      { name: 'c', wgslType: 'f32' },
    ]);
    const [a, b, c] = layout.fields;
    expect(a!.offset).toBe(0);
    expect(b!.offset).toBe(16);
    expect(c!.offset).toBe(28);
    expect(layout.byteLength).toBe(32);
  });

  it('is empty when there are no uniforms', () => {
    expect(computeUniformLayout([]).byteLength).toBe(0);
  });
});

describe('MaterialInstance', () => {
  it('references the shared pipeline and owns params and bindings', () => {
    const inst = new MaterialInstance(variant());
    expect(inst.pipelineKey).toBe('pipeline-key-xyz');
    inst.setParam('baseColor', [1, 0.5, 0.25]);
    inst.setTexture('albedoTex', 'tex-handle-1');
    inst.setSampler('linear', 'samp-handle-1');
    expect(inst.getParam('baseColor')).toEqual([1, 0.5, 0.25]);
  });

  it('editing a parameter never changes the pipeline key (no recompile)', () => {
    const inst = new MaterialInstance(variant());
    const before = inst.pipelineKey;
    inst.setParam('roughness', 0.8);
    inst.setTexture('albedoTex', 'another-texture');
    expect(inst.pipelineKey).toBe(before);
  });

  it('packs uniforms into the laid-out buffer', () => {
    const inst = new MaterialInstance(variant());
    inst.setParam('baseColor', [1, 0.5, 0.25]);
    inst.setParam('roughness', 0.8);
    const buffer = inst.packUniforms();
    const view = new DataView(buffer);
    expect(view.getFloat32(0, true)).toBeCloseTo(1);
    expect(view.getFloat32(4, true)).toBeCloseTo(0.5);
    expect(view.getFloat32(8, true)).toBeCloseTo(0.25);
    // roughness (f32) packs into the vec3 padding slot at offset 12.
    expect(view.getFloat32(12, true)).toBeCloseTo(0.8);
  });

  it('tracks dirty uniforms and bindings and clears them on take', () => {
    const inst = new MaterialInstance(variant());
    expect(inst.uniformsDirty).toBe(true); // constructed dirty for first upload
    expect(inst.takeDirtyUniforms()).toBeInstanceOf(ArrayBuffer);
    expect(inst.uniformsDirty).toBe(false);
    expect(inst.takeDirtyUniforms()).toBeUndefined();

    expect(inst.bindingsDirty).toBe(false);
    inst.setTexture('albedoTex', 't1');
    expect(inst.bindingsDirty).toBe(true);
    expect(inst.takeDirtyBindings()).toEqual({ textures: { albedoTex: 't1' }, samplers: {} });
    expect(inst.takeDirtyBindings()).toBeUndefined();
  });

  it('rejects unknown parameters, textures and samplers', () => {
    const inst = new MaterialInstance(variant());
    expect(() => inst.setParam('nope', 1)).toThrow(MaterialInstanceError);
    expect(() => inst.setTexture('nope', 'x')).toThrow(MaterialInstanceError);
    expect(() => inst.setSampler('nope', 'x')).toThrow(MaterialInstanceError);
  });

  it('applies constructor defaults', () => {
    const inst = new MaterialInstance(variant(), { defaults: { roughness: 0.3 } });
    expect(inst.getParam('roughness')).toBe(0.3);
  });
});
