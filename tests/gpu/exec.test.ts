import { describe, it, expect } from 'vitest';
import { NODE_CASES, type NodeCase } from '../fixtures/node-cases.ts';
import {
  IrModuleBuilder,
  FLOAT,
  INT,
  COLOR3,
  COLOR4,
  vector,
  closureType,
  shaderType,
  type IrType,
  type IrRef,
} from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import {
  COMPUTE_ENTRY,
  collectVaryingFields,
  composeComputeModule,
  outputComponentCount,
} from '../../src/gpu/exec.ts';

const irTypeByLen = (n: number): IrType =>
  n === 1 ? FLOAT : n === 2 ? vector(2, 'float') : n === 3 ? COLOR3 : COLOR4;
const irTypeByOut = (out: NonNullable<NodeCase['out']>): IrType =>
  out === 'f32' ? FLOAT : out === 'vec2f' ? vector(2, 'float') : out === 'vec3f' ? COLOR3 : COLOR4;

function buildIr(c: NodeCase): IrModuleBuilder {
  const b = new IrModuleBuilder();
  let ref: IrRef;
  let type: IrType;
  if (c.exec === 'texture') {
    b.declareTexture({ name: 'tex', valueType: COLOR3 });
    b.declareSampler({ name: 'samp' });
    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    ref = b.add({ kind: 'texture', type: COLOR3, texture: 'tex', uv, sampler: 'samp' });
    type = COLOR3;
  } else if (c.exec === 'closure') {
    if (c.category === 'surface') {
      const opacity = b.constant(FLOAT, 1);
      ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      type = shaderType('surface');
    } else {
      const weight = b.constant(FLOAT, 0.8);
      const tint = b.constant(COLOR3, [0.6, 0.3, 0.1]);
      const roughness = b.constant(vector(2, 'float'), [0.1, 0.2]);
      ref = b.add({ kind: 'closure', type: closureType('bsdf'), closure: 'bsdf', op: c.category, params: { weight, tint, roughness } });
      type = closureType('bsdf');
    }
  } else {
    const args = c.inputs.map((v, i) => {
      if (c.category === 'extract' && i === 1) return b.constant(INT, v[0]!);
      return b.constant(irTypeByLen(v.length), v.length === 1 ? v[0]! : [...v]);
    });
    type = irTypeByOut(c.out!);
    ref = b.add({ kind: 'call', type, op: c.category, args });
  }
  b.output({ name: 'out', type, ref });
  return b;
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n++;
  return n;
}

describe('outputComponentCount', () => {
  it('maps WGSL output types to component widths', () => {
    expect(outputComponentCount('f32')).toBe(1);
    expect(outputComponentCount('vec2f')).toBe(2);
    expect(outputComponentCount('vec3f')).toBe(3);
    expect(outputComponentCount('vec4f')).toBe(4);
    expect(outputComponentCount('Closure')).toBe(4);
  });
});

describe('collectVaryingFields', () => {
  it('reports primvars declared in the IR', () => {
    const b = buildIr(NODE_CASES.find((c) => c.category === 'image')!);
    const fields = collectVaryingFields(b.build());
    expect(fields.primvars).toEqual([{ name: 'st', wgslType: 'vec2f', width: 2 }]);
    expect(fields.inputs).toEqual([]);
  });
});

describe('composeComputeModule', () => {
  const runnable = NODE_CASES.filter((c) => c.exec === 'expr' || c.exec === 'texture' || c.exec === 'closure');

  for (const c of runnable) {
    it(`wraps ${c.category} into a dispatchable compute module`, () => {
      const ir = buildIr(c).build();
      const module = emitWgsl(ir);
      const code = composeComputeModule(module, collectVaryingFields(ir));

      // Keeps the node shader and adds a single compute entry.
      expect(code).toContain('fn mx_shade(vary: MxVaryings) -> MxOutputs');
      expect(code).toContain('@compute @workgroup_size(1)');
      expect(code).toContain(`fn ${COMPUTE_ENTRY}()`);
      expect(code).toContain('let mxOut = mx_shade(vary);');
      expect(code).toContain('var<storage, read_write> mxResult : array<f32>;');

      // Writes exactly the declared number of output components.
      const comps = outputComponentCount(module.outputs[0]!.wgslType);
      expect(countChar(code, '{')).toBe(countChar(code, '}'));
      expect(countChar(code, '(')).toBe(countChar(code, ')'));
      for (let i = 0; i < comps; i++) expect(code).toContain(`mxResult[${i}] =`);
      expect(code).not.toContain(`mxResult[${comps}] =`);
    });
  }

  it('bakes the fixed varyings as deterministic literals', () => {
    const ir = buildIr(NODE_CASES.find((c) => c.category === 'position')!).build();
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir));
    expect(code).toContain('vary.position = vec3f(0.25, -0.5, 0.75);');
    expect(code).toContain('vary.texcoord = vec2f(0.3, 0.7);');
  });

  it('assigns primvar fields, defaulting a vec2 primvar to texcoord', () => {
    const ir = buildIr(NODE_CASES.find((c) => c.category === 'image')!).build();
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir));
    expect(code).toContain('vary.v_st = vec2f(0.3, 0.7);');
  });

  it('honours primvar overrides', () => {
    const ir = buildIr(NODE_CASES.find((c) => c.category === 'image')!).build();
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir), { primvars: { st: [0.1, 0.9] } });
    expect(code).toContain('vary.v_st = vec2f(0.1, 0.9);');
  });

  it('packs a Closure output as color.xyz + weight', () => {
    const ir = buildIr(NODE_CASES.find((c) => c.category === 'chiang_hair_bsdf')!).build();
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir));
    expect(code).toContain('mxResult[0] = mxOut.out.color.x;');
    expect(code).toContain('mxResult[3] = mxOut.out.weight;');
  });
});
