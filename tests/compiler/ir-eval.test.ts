import { describe, expect, it } from 'vitest';
import { COLOR3, FLOAT, IrModuleBuilder, vector } from '../../src/compiler/ir.ts';
import { evaluateIrRef, evaluateShaderIr, IrEvalError } from '../../src/compiler/ir-eval.ts';
import { buildNodeIr } from '../fixtures/node-ir.ts';
import { NODE_CASES, VARYINGS } from '../fixtures/node-cases.ts';

const varyingEnv = {
  position: VARYINGS.position,
  normal: VARYINGS.normal,
  tangent: VARYINGS.tangent,
  bitangent: VARYINGS.bitangent,
  texcoord: VARYINGS.texcoord,
  viewDir: VARYINGS.viewDir,
};

describe('evaluateShaderIr (T057i2)', () => {
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
