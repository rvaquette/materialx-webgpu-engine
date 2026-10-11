import { describe, it, expect } from 'vitest';
import { NODE_CASES } from '../fixtures/node-cases.ts';
import { buildNodeIr, isRunnableOnGpu } from '../fixtures/node-ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { IrModuleBuilder, closureType, shaderType } from '../../src/compiler/ir.ts';
import {
  COMPUTE_ENTRY,
  collectVaryingFields,
  composeComputeModule,
  outputComponentCount,
  packLighting,
  DEFAULT_LIGHTING,
  MX_MAX_LIGHTS,
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

describe('packLighting (T038)', () => {
  it('packs the default directional light and environment into std140 layout', () => {
    const data = new Float32Array(packLighting());
    // params.x = light count, params.yzw = environment.
    expect(data[0]).toBe(1);
    expect(data[1]).toBeCloseTo(DEFAULT_LIGHTING.environment[0]!, 6);
    expect(data[2]).toBeCloseTo(DEFAULT_LIGHTING.environment[1]!, 6);
    expect(data[3]).toBeCloseTo(DEFAULT_LIGHTING.environment[2]!, 6);
    // First light: direction.xyz, direction.w = intensity, color.rgb.
    expect([data[4], data[5], data[6]]).toEqual([0, 0, -1]);
    expect(data[7]).toBe(1);
    expect([data[8], data[9], data[10]]).toEqual([1, 1, 1]);
  });

  it('allocates a fixed MX_MAX_LIGHTS array and clamps overflow', () => {
    const many = Array.from({ length: MX_MAX_LIGHTS + 3 }, () => ({
      direction: [0, -1, 0] as const,
      color: [1, 1, 1] as const,
      intensity: 2,
    }));
    const data = new Float32Array(packLighting({ lights: many }));
    expect(data.length).toBe(4 + MX_MAX_LIGHTS * 8);
    expect(data[0]).toBe(MX_MAX_LIGHTS);
  });

  it('exposes the lighting binding for a surface with a real BSDF lobe', () => {
    const b = new IrModuleBuilder();
    const diffuse = b.add({
      kind: 'closure',
      type: closureType('bsdf'),
      closure: 'bsdf',
      op: 'oren_nayar_diffuse_bsdf',
      params: {},
    });
    const surface = b.add({
      kind: 'closure',
      type: shaderType('surface'),
      closure: 'bsdf',
      op: 'surface',
      params: { bsdf: diffuse },
    });
    b.output({ name: 'surfaceshader', type: shaderType('surface'), ref: surface });
    const ir = b.build();
    const module = emitWgsl(ir);
    expect(module.lighting).toEqual({ group: 0, binding: 1 });
    const code = composeComputeModule(module, collectVaryingFields(ir));
    expect(code).toContain('struct MxLighting');
    expect(code).toContain(`fn ${COMPUTE_ENTRY}()`);
  });
});
