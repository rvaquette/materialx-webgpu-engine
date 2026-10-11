import { describe, it, expect } from 'vitest';
import { optimize } from '../../src/compiler/optimize.ts';
import {
  IrModuleBuilder,
  FLOAT,
  COLOR3,
  vector,
  shaderType,
  closureType,
} from '../../src/compiler/ir.ts';

describe('optimize', () => {
  it('eliminates dead code and unused resources', () => {
    const b = new IrModuleBuilder();
    b.declareParam({ name: 'used', type: FLOAT, editable: true });
    b.declareParam({ name: 'orphan', type: FLOAT, editable: true });
    b.declareTexture({ name: 'tUsed', valueType: COLOR3 });
    b.declareTexture({ name: 'tOrphan', valueType: COLOR3 });
    b.declareSampler({ name: 'sUsed' });
    b.declareSampler({ name: 'sOrphan' });
    b.declarePrimvar({ name: 'st', type: vector(2, 'float', 'texcoord') });
    b.declarePrimvar({ name: 'unusedPrimvar', type: vector(2, 'float', 'texcoord') });

    const used = b.add({ kind: 'param', type: FLOAT, name: 'used' });
    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    const tex = b.add({ kind: 'texture', type: COLOR3, texture: 'tUsed', uv, sampler: 'sUsed' });
    const bsdf = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'diffuse', params: { color: tex, weight: used } });
    // Dead expression chain, never referenced by any output.
    b.add({ kind: 'param', type: FLOAT, name: 'orphan' });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: bsdf });

    const out = optimize(b.build());
    expect(out.params.map((p) => p.name)).toEqual(['used']);
    expect(out.textures.map((t) => t.name)).toEqual(['tUsed']);
    expect(out.samplers.map((s) => s.name)).toEqual(['sUsed']);
    expect(out.primvars.map((p) => p.name)).toEqual(['st']);
  });

  it('folds identity and broadcast converts and swizzles of constants', () => {
    const b = new IrModuleBuilder();
    const c = b.constant(FLOAT, 0.5);
    const broadcast = b.add({ kind: 'convert', type: COLOR3, source: c, from: FLOAT });
    const sw = b.add({ kind: 'swizzle', type: FLOAT, source: broadcast, pattern: 'y' });
    b.output({ name: 'out', type: FLOAT, ref: sw });

    const out = optimize(b.build());
    const folded = out.exprs.get(out.outputs[0]!.ref);
    expect(folded).toMatchObject({ kind: 'const', value: 0.5 });
  });

  it('merges common subexpressions including commutative closure combines', () => {
    const b = new IrModuleBuilder();
    const a = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'diffuse', params: {} });
    const c = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: 'specular', params: {} });
    // add(a,c) and add(c,a) must canonicalize + merge into one node.
    const left = b.add({ kind: 'combine', type: closureType('bsdf'), op: 'add', operands: [a, c] });
    const right = b.add({ kind: 'combine', type: closureType('bsdf'), op: 'add', operands: [c, a] });
    b.output({ name: 'a', type: closureType('bsdf'), ref: left });
    b.output({ name: 'b', type: closureType('bsdf'), ref: right });

    const out = optimize(b.build());
    expect(out.outputs[0]!.ref).toBe(out.outputs[1]!.ref);
    const combines = [...out.exprs.values()].filter((e) => e.kind === 'combine');
    expect(combines).toHaveLength(1);
  });

  it('does not freeze editable params unless explicitly specialized', () => {
    const b = new IrModuleBuilder();
    b.declareParam({ name: 'gain', type: FLOAT, editable: true });
    const gain = b.add({ kind: 'param', type: FLOAT, name: 'gain' });
    b.output({ name: 'out', type: FLOAT, ref: gain });
    const ir = b.build();

    const unspecialized = optimize(ir);
    expect(unspecialized.exprs.get(unspecialized.outputs[0]!.ref)?.kind).toBe('param');

    const specialized = optimize(ir, { specialize: { gain: 2 } });
    expect(specialized.exprs.get(specialized.outputs[0]!.ref)).toMatchObject({ kind: 'const', value: 2 });
    expect(specialized.params).toHaveLength(0); // the frozen param is no longer referenced
  });
});
