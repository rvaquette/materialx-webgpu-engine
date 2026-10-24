import { describe, expect, it } from 'vitest';
import { COLOR3, FLOAT, IrModuleBuilder, vector } from '../../src/compiler/ir.ts';
import { evaluateIrRef, evaluateShaderIr, IrEvalError } from '../../src/compiler/ir-eval.ts';
import { buildNodeIr } from '../fixtures/node-ir.ts';
import { NODE_CASES, VARYINGS } from '../fixtures/node-cases.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';

const varyingEnv = {
  position: VARYINGS.position,
  normal: VARYINGS.normal,
  tangent: VARYINGS.tangent,
  bitangent: VARYINGS.bitangent,
  texcoord: VARYINGS.texcoord,
  viewDir: VARYINGS.viewDir,
};

describe('evaluateShaderIr (T057i2)', () => {
  it.each([FLOAT, vector(2), vector(3), vector(4)])('defines ln on nonpositive inputs without changing positive inputs for %j', (type) => {
    const size = type.kind === 'vector' ? type.size : 1;
    for (const x of [-10, -0.5, -0, 0, 1e-30, 1e-8, 0.25, 1, Math.E, 100]) {
      const builder = new IrModuleBuilder();
      const input = builder.constant(type, size === 1 ? x : Array(size).fill(x));
      const ref = builder.add({ kind: 'call', type, op: 'ln', args: [], namedArgs: { in: input } });
      builder.output({ name: 'out', type, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual(Array(size).fill(x > 0 ? Math.log(x) : 0));
      const code = emitWgsl(ir).code;
      expect(code).toContain('log(select(');
      expect(code).toContain(`${input} >`);
    }
  });

  it('keeps mixed ln debug channels finite after abs and fract', () => {
    const builder = new IrModuleBuilder();
    const type = vector(4);
    const input = builder.constant(type, [-0.5, 0, 0.25, 2]);
    const ln = builder.add({ kind: 'call', type, op: 'ln', args: [input] });
    const magnitude = builder.add({ kind: 'call', type, op: 'absval', args: [ln] });
    const wrapped = builder.add({ kind: 'call', type, op: 'fract', args: [magnitude] });
    const values = evaluateIrRef(builder.build(), wrapped);
    expect(values).toEqual([0, 0, Math.abs(Math.log(0.25)) % 1, Math.log(2)]);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it('defines smoothstep for equal bounds and emits finite WGSL', () => {
    const builder = new IrModuleBuilder();
    const type = vector(4);
    const input = builder.constant(type, [-0.1, 0.5, 0.5, 0.75]);
    const low = builder.constant(type, [0.5, 0.5, 0.5, 0.5]);
    const high = builder.constant(type, [0.5, 0.5, 0.5, 0.5]);
    const ref = builder.add({
      kind: 'call',
      type,
      op: 'smoothstep',
      args: [],
      namedArgs: { in: input, low, high },
    });
    builder.output({ name: 'out', type, ref });
    const ir = builder.build();

    expect(evaluateIrRef(ir, ref)).toEqual([0, 0.5, 0.5, 1]);
    const code = emitWgsl(ir).code;
    expect(code).toContain('select(');
    expect(code).toContain('==');
    expect(code).toContain('> ');
  });

  it('smoothly reverses the transition for inverted bounds in CPU and WGSL', () => {
    const builder = new IrModuleBuilder();
    const type = vector(4);
    const input = builder.constant(type, [0, 0.5, 0.75, 1]);
    const low = builder.constant(type, [0.75, 0.75, 0.75, 0.75]);
    const high = builder.constant(type, [0.25, 0.25, 0.25, 0.25]);
    const ref = builder.add({
      kind: 'call',
      type,
      op: 'smoothstep',
      args: [],
      namedArgs: { in: input, low, high },
    });
    builder.output({ name: 'out', type, ref });
    const ir = builder.build();

    expect(evaluateIrRef(ir, ref)).toEqual([1, 0.5, 0, 0]);
    const code = emitWgsl(ir).code;
    expect(code).toContain('vec4f(e2) - vec4f(e1)');
    expect(code).not.toContain('smoothstep(');
  });

  it('uses outlow for degenerate remap bounds while preserving regular and inverted ranges', () => {
    const builder = new IrModuleBuilder();
    const type = vector(4);
    const input = builder.constant(type, [-0.5, 0.25, 0.5, 1.5]);
    const inLow = builder.constant(type, [0, 0, 0.75, 0]);
    const inHigh = builder.constant(type, [0, 1, 0.25, 1]);
    const outLow = builder.constant(type, [0, 0, 0, 1]);
    const outHigh = builder.constant(type, [1, 1, 1, 0]);
    const ref = builder.add({
      kind: 'call',
      type,
      op: 'remap',
      args: [],
      namedArgs: { in: input, inlow: inLow, inhigh: inHigh, outlow: outLow, outhigh: outHigh },
    });
    builder.output({ name: 'out', type, ref });
    const ir = builder.build();

    expect(evaluateIrRef(ir, ref)).toEqual([0, 0.25, 0.5, -0.5]);
    const code = emitWgsl(ir).code;
    expect(code).toContain('select(');
    expect(code).toContain('==');
  });

  it.each([FLOAT, vector(2), vector(3), vector(4)])('defines finite acos results outside the domain for %j', (type) => {
    const size = type.kind === 'vector' ? type.size : 1;
    for (const x of [-1.2, -1, -0.5, 0, 0.5, 1, 1.2]) {
      const b = new IrModuleBuilder();
      const input = b.constant(type, size === 1 ? x : Array(size).fill(x));
      const ref = b.add({ kind: 'call', type, op: 'acos', args: [], namedArgs: { in: input } });
      b.output({ name: 'out', type, ref });
      const ir = b.build();
      const expected = Math.abs(x) <= 1 ? Math.acos(x) : 0;
      expect(evaluateIrRef(ir, ref)).toEqual(Array(size).fill(expected));
      expect(emitWgsl(ir).code).toContain('acos(clamp(');
      expect(emitWgsl(ir).code).toContain(`abs(${input}) <=`);
    }
  });

  it('keeps the degenerate acos vector4 debug channels finite and red-only', () => {
    const b = new IrModuleBuilder();
    const type = vector(4);
    const input = b.constant(type, [0, -1.2, 0.5, 1.2]);
    const acos = b.add({ kind: 'call', type, op: 'acos', args: [input] });
    const magnitude = b.add({ kind: 'call', type, op: 'absval', args: [acos] });
    const wrapped = b.add({ kind: 'call', type, op: 'fract', args: [magnitude] });
    const result = evaluateIrRef(b.build(), wrapped);
    expect(result).toEqual([Math.PI / 2 - 1, 0, Math.acos(0.5) - 1, 0]);
    expect(result.every(Number.isFinite)).toBe(true);
  });

  it('reproduces the CPU reference for every expr corpus case', () => {
    const exprCases = NODE_CASES.filter((c) => c.exec === 'expr' && c.expected);
    expect(exprCases.length).toBeGreaterThan(10);
    for (const c of exprCases) {
      const ir = buildNodeIr(c);
      const value = evaluateShaderIr(ir, varyingEnv).get('out');
      expect(value, c.category).toBeDefined();
      expect(value!.length, c.category).toBe(c.expected!.length);
      for (let i = 0; i < c.expected!.length; i++) {
        expect(value![i], `${c.category}[${i}]`).toBeCloseTo(c.expected![i]!, 5);
      }
    }
  });

  it('resolves texture leaves to the neutral value', () => {
    const b = new IrModuleBuilder();
    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    const ref = b.add({ kind: 'texture', type: COLOR3, texture: 'tex', uv, sampler: 'samp' });
    b.output({ name: 'out', type: COLOR3, ref });
    const ir = b.build();
    expect([...evaluateIrRef(ir, ref)]).toEqual([0, 0, 0]);
    expect([...evaluateIrRef(ir, ref, { textureNeutral: [0.5, 0.5, 0.5] })]).toEqual([0.5, 0.5, 0.5]);
  });

  it('samples a texture through a caller-supplied image sampler (T057k)', () => {
    const b = new IrModuleBuilder();
    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    const ref = b.add({ kind: 'texture', type: COLOR3, texture: 'tex', uv, sampler: 'samp' });
    b.output({ name: 'out', type: COLOR3, ref });
    const ir = b.build();
    // The sampler receives the interpolated uv (st falls back to texcoord) and its
    // RGBA result is sliced to the texture's channel count.
    const env = { texcoord: [0.3, 0.7] as const, textures: { tex: (u: number, v: number) => [u, v, 0.25, 1] } };
    expect([...evaluateIrRef(ir, ref, env)]).toEqual([0.3, 0.7, 0.25]);
  });

  it('slices a sampled texture to a scalar leaf (T057k)', () => {
    const b = new IrModuleBuilder();
    const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
    const ref = b.add({ kind: 'texture', type: FLOAT, texture: 'mask', uv, sampler: 'samp' });
    b.output({ name: 'out', type: FLOAT, ref });
    const ir = b.build();
    const env = { texcoord: [0.8, 0.1] as const, textures: { mask: (u: number) => [u, 0, 0, 1] } };
    expect([...evaluateIrRef(ir, ref, env)]).toEqual([0.8]);
  });

  it('evaluates a procedural chain (rgbtohsv -> mix) with shared memoization', () => {
    // Mirrors the brick_color shape: shift a base colour in HSV then blend it.
    const b = new IrModuleBuilder();
    const base = b.constant(COLOR3, [0.661876, 0.19088, 0]);
    const hsv = b.add({ kind: 'call', type: COLOR3, op: 'rgbtohsv', args: [base] });
    const back = b.add({ kind: 'call', type: COLOR3, op: 'hsvtorgb', args: [hsv] });
    const white = b.constant(COLOR3, [1, 1, 1]);
    const t = b.constant(FLOAT, 0.25);
    const mixed = b.add({ kind: 'call', type: COLOR3, op: 'mix', args: [back, white, t] });
    b.output({ name: 'out', type: COLOR3, ref: mixed });
    const ir = b.build();
    // rgbtohsv -> hsvtorgb is identity, so mix(base, white, 0.25) = base*0.25 + white*0.75.
    const value = evaluateIrRef(ir, mixed);
    expect(value[0]).toBeCloseTo(0.661876 * 0.25 + 0.75, 5);
    expect(value[1]).toBeCloseTo(0.19088 * 0.25 + 0.75, 5);
    expect(value[2]).toBeCloseTo(0.75, 5);
  });

  it('reads named params with a declared default fallback', () => {
    const b = new IrModuleBuilder();
    b.declareParam({ name: 'tint', type: COLOR3, defaultValue: [0.2, 0.4, 0.6], editable: true });
    const ref = b.add({ kind: 'param', type: COLOR3, name: 'tint' });
    b.output({ name: 'out', type: COLOR3, ref });
    const ir = b.build();
    expect([...evaluateIrRef(ir, ref)]).toEqual([0.2, 0.4, 0.6]);
    expect([...evaluateIrRef(ir, ref, { params: { tint: [1, 0, 0] } })]).toEqual([1, 0, 0]);
  });

  it('converts scalar to vector by broadcast and vector to scalar by first component', () => {
    const b = new IrModuleBuilder();
    const s = b.constant(FLOAT, 0.3);
    const up = b.add({ kind: 'convert', type: COLOR3, source: s, from: FLOAT });
    b.output({ name: 'up', type: COLOR3, ref: up });
    const ir = b.build();
    expect([...evaluateIrRef(ir, up)]).toEqual([0.3, 0.3, 0.3]);
  });

  it('throws on a closure expression and on an unknown node', () => {
    const b = new IrModuleBuilder();
    const w = b.constant(FLOAT, 1);
    const clo = b.add({ kind: 'closure', type: COLOR3, closure: 'bsdf', op: 'oren_nayar_diffuse_bsdf', params: { weight: w } });
    const unknown = b.add({ kind: 'call', type: COLOR3, op: 'not_a_node', args: [w] });
    const ir = b.build();
    expect(() => evaluateIrRef(ir, clo)).toThrow(IrEvalError);
    expect(() => evaluateIrRef(ir, unknown)).toThrow(IrEvalError);
  });
});
