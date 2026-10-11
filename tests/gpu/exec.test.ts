import { describe, it, expect } from 'vitest';
import { NODE_CASES } from '../fixtures/node-cases.ts';
import { buildNodeIr, isRunnableOnGpu } from '../fixtures/node-ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import {
  COMPUTE_ENTRY,
  collectVaryingFields,
  composeComputeModule,
  outputComponentCount,
} from '../../src/gpu/exec.ts';

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
    const ir = buildNodeIr(NODE_CASES.find((c) => c.category === 'image')!);
    const fields = collectVaryingFields(ir);
    expect(fields.primvars).toEqual([{ name: 'st', wgslType: 'vec2f', width: 2 }]);
    expect(fields.inputs).toEqual([]);
  });
});

describe('composeComputeModule', () => {
  const runnable = NODE_CASES.filter(isRunnableOnGpu);

  for (const c of runnable) {
    it(`wraps ${c.category} into a dispatchable compute module`, () => {
      const ir = buildNodeIr(c);
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
    const ir = buildNodeIr(NODE_CASES.find((c) => c.category === 'position')!);
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir));
    expect(code).toContain('vary.position = vec3f(0.25, -0.5, 0.75);');
    expect(code).toContain('vary.texcoord = vec2f(0.3, 0.7);');
  });

  it('assigns primvar fields, defaulting a vec2 primvar to texcoord', () => {
    const ir = buildNodeIr(NODE_CASES.find((c) => c.category === 'image')!);
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir));
    expect(code).toContain('vary.v_st = vec2f(0.3, 0.7);');
  });

  it('honours primvar overrides', () => {
    const ir = buildNodeIr(NODE_CASES.find((c) => c.category === 'image')!);
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir), { primvars: { st: [0.1, 0.9] } });
    expect(code).toContain('vary.v_st = vec2f(0.1, 0.9);');
  });

  it('packs a Closure output as color.xyz + weight', () => {
    const ir = buildNodeIr(NODE_CASES.find((c) => c.category === 'chiang_hair_bsdf')!);
    const code = composeComputeModule(emitWgsl(ir), collectVaryingFields(ir));
    expect(code).toContain('mxResult[0] = mxOut.out.color.x;');
    expect(code).toContain('mxResult[3] = mxOut.out.weight;');
  });
});
