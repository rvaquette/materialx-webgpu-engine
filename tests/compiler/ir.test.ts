import { describe, it, expect } from 'vitest';
import {
  FLOAT,
  INT,
  COLOR3,
  vector,
  matrix,
  closureType,
  shaderType,
  typeToString,
  typesEqual,
  isClosureType,
  irTypeFromMaterialX,
  IrModuleBuilder,
  type IrType,
} from '../../src/compiler/ir.ts';

describe('IR types', () => {
  it('stringifies types canonically with semantics', () => {
    expect(typeToString(FLOAT)).toBe('float');
    expect(typeToString(COLOR3)).toBe('vec3<float:color>');
    expect(typeToString(vector(3, 'float', 'normal'))).toBe('vec3<float:normal>');
    expect(typeToString(matrix(4))).toBe('mat4');
    expect(typeToString(closureType('bsdf'))).toBe('closure<bsdf>');
    expect(typeToString(shaderType('surface'))).toBe('shader<surface>');
  });

  it('compares by canonical form, distinguishing semantics', () => {
    expect(typesEqual(COLOR3, vector(3, 'float', 'color'))).toBe(true);
    expect(typesEqual(COLOR3, vector(3, 'float', 'vector'))).toBe(false);
  });

  it('identifies closure and shader types', () => {
    expect(isClosureType(closureType('edf'))).toBe(true);
    expect(isClosureType(shaderType('volume'))).toBe(true);
    expect(isClosureType(FLOAT)).toBe(false);
  });

  it('maps MaterialX type names', () => {
    expect(typesEqual(irTypeFromMaterialX('color3') as IrType, COLOR3)).toBe(true);
    expect(typesEqual(irTypeFromMaterialX('BSDF') as IrType, closureType('bsdf'))).toBe(true);
    expect(typesEqual(irTypeFromMaterialX('surfaceshader') as IrType, shaderType('surface'))).toBe(true);
    expect(typesEqual(irTypeFromMaterialX('integer') as IrType, INT)).toBe(true);
    expect(irTypeFromMaterialX('nonexistent')).toBeUndefined();
  });
});

describe('IrModuleBuilder', () => {
  it('deduplicates identical constants but not differently-typed ones', () => {
    const b = new IrModuleBuilder();
    const a1 = b.constant(FLOAT, 1);
    const a2 = b.constant(FLOAT, 1);
    const a3 = b.constant(INT, 1);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(a3);
    expect(b.build().exprs.size).toBe(2);
  });

  it('deduplicates vector constants by value', () => {
    const b = new IrModuleBuilder();
    const c1 = b.constant(COLOR3, [1, 0, 0]);
    const c2 = b.constant(COLOR3, [1, 0, 0]);
    const c3 = b.constant(COLOR3, [0, 1, 0]);
    expect(c1).toBe(c2);
    expect(c1).not.toBe(c3);
  });

  it('aggregates evaluation requirements monotonically', () => {
    const b = new IrModuleBuilder();
    b.require({ needsDerivatives: true });
    b.require({ needsPdf: true });
    b.require({ needsDerivatives: false }); // must not clear a set flag
    const r = b.build().requirements;
    expect(r).toEqual({
      needsDerivatives: true,
      needsTextureFootprint: false,
      needsPdf: true,
      needsSampling: false,
    });
  });

  it('declares deduplicated resources and builds a closure output', () => {
    const b = new IrModuleBuilder();
    b.declareTexture({ name: 'base', valueType: COLOR3, colorSpace: 'srgb_tx', fileRef: 'c.<UDIM>.tif' });
    b.declareTexture({ name: 'base', valueType: COLOR3, colorSpace: 'srgb_tx' }); // same name -> overwrite, still 1
    b.declareSampler({ name: 's0', filter: 'linear' });
    b.declareParam({ name: 'gain', type: FLOAT, defaultValue: 1, editable: true });
    b.declarePrimvar({ name: 'st', type: vector(2, 'float', 'texcoord') });

    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    const tex = b.add({ kind: 'texture', type: COLOR3, texture: 'base', uv, sampler: 's0' });
    const bsdf = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'oren_nayar_diffuse_bsdf', params: { color: tex } });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: bsdf });

    const ir = b.build();
    expect(ir.textures).toHaveLength(1);
    expect(ir.samplers).toHaveLength(1);
    expect(ir.params[0]?.editable).toBe(true);
    expect(ir.primvars[0]?.name).toBe('st');
    expect(ir.outputs[0]).toEqual({ name: 'surfaceshader', type: shaderType('surface'), ref: bsdf });
    expect(ir.exprs.get(tex)?.kind).toBe('texture');
  });
});
