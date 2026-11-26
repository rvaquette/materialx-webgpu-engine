import { describe, expect, it } from 'vitest';
import { BOOL, COLOR3, COLOR4, FLOAT, INT, IrModuleBuilder, matrix, vector } from '../../src/compiler/ir.ts';
import { evaluateIrRef, evaluateShaderIr, IrEvalError } from '../../src/compiler/ir-eval.ts';
import { buildNodeIr } from '../fixtures/node-ir.ts';
import { NODE_CASES, VARYINGS } from '../fixtures/node-cases.ts';
import { emitWgsl, wgslType } from '../../src/compiler/wgsl.ts';

const varyingEnv = {
  position: VARYINGS.position,
  normal: VARYINGS.normal,
  tangent: VARYINGS.tangent,
  bitangent: VARYINGS.bitangent,
  texcoord: VARYINGS.texcoord,
  viewDir: VARYINGS.viewDir,
};

describe('evaluateShaderIr (T057i2)', () => {
  it('uses the MaterialX positional order for range gamma and output bounds', () => {
    for (const named of [false, true]) {
      const b = new IrModuleBuilder();
      const value = b.constant(COLOR3, [0.25, 0.5, 1]);
      const inlow = b.constant(FLOAT, 0);
      const inhigh = b.constant(FLOAT, 1);
      const gamma = b.constant(FLOAT, 2);
      const outlow = b.constant(FLOAT, 1);
      const outhigh = b.constant(FLOAT, 3);
      const doclamp = b.constant(BOOL, false);
      const ref = b.add(named
        ? { kind: 'call', type: COLOR3, op: 'range', args: [], namedArgs: { in: value, inlow, inhigh, gamma, outlow, outhigh, doclamp } }
        : { kind: 'call', type: COLOR3, op: 'range', args: [value, inlow, inhigh, gamma, outlow, outhigh, doclamp] });
      b.output({ name: 'result', type: COLOR3, ref });
      const ir = b.build();
      const result = evaluateIrRef(ir, ref);
      [2, 1 + Math.SQRT2, 3].forEach((expected, i) => expect(result[i]).toBeCloseTo(expected, 10));
      const code = emitWgsl(ir).code;
      expect(code).toContain(`vec3f(${gamma})`);
      expect(code).toContain(`vec3f(${outlow})`);
      expect(code).toContain(`vec3f(${outhigh})`);
    }
  });

  it('returns outlow for equal input bounds component-wise in range', () => {
    const b = new IrModuleBuilder();
    const input = b.constant(COLOR3, [-4, 3, 2]);
    const inlow = b.constant(COLOR3, [0, 1, 0]);
    const inhigh = b.constant(COLOR3, [0, 1, 4]);
    const gamma = b.constant(FLOAT, 2);
    const outlow = b.constant(COLOR3, [10, 20, 30]);
    const outhigh = b.constant(COLOR3, [20, 30, 40]);
    const ref = b.add({ kind: 'call', type: COLOR3, op: 'range', args: [],
      namedArgs: { in: input, inlow, inhigh, gamma, outlow, outhigh } });
    b.output({ name: 'result', type: COLOR3, ref });
    const ir = b.build();
    const result = evaluateIrRef(ir, ref);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
    expect(result[2]).toBeCloseTo(30 + 5 * Math.SQRT2, 10);
    expect(emitWgsl(ir).code).toContain(`vec3f(${inhigh}) == vec3f(${inlow})`);
  });

  it('clamps a descending range between its output endpoints', () => {
    const b = new IrModuleBuilder();
    const value = b.constant(COLOR3, [0, 0.5, 2]);
    const outlow = b.constant(FLOAT, 3);
    const outhigh = b.constant(FLOAT, 1);
    const doclamp = b.constant(BOOL, true);
    const ref = b.add({ kind: 'call', type: COLOR3, op: 'range', args: [],
      namedArgs: { in: value, outlow, outhigh, doclamp } });
    expect(evaluateIrRef(b.build(), ref)).toEqual([3, 2, 1]);
  });

  it.each([false, true])('clamps a vector with scalar bounds using named or positional inputs (named=%s)', named => {
    const b = new IrModuleBuilder();
    const input = b.constant(COLOR4, [-1, 0.25, 0.75, 2]);
    const low = b.constant(FLOAT, 0.2);
    const high = b.constant(FLOAT, 0.8);
    const ref = b.add(named
      ? { kind: 'call', type: COLOR4, op: 'clamp', args: [], namedArgs: { in: input, low, high } }
      : { kind: 'call', type: COLOR4, op: 'clamp', args: [input, low, high] });
    b.output({ name: 'result', type: COLOR4, ref });
    const ir = b.build();
    expect(evaluateIrRef(ir, ref)).toEqual([0.2, 0.25, 0.75, 0.8]);
    expect(emitWgsl(ir).code).toContain(`clamp(${input}, vec4f(${low}), vec4f(${high}))`);
  });

  it.each([
    { order: 0, expected: [1.5, -0.25] },
    { order: -1, expected: [1.5, -0.25] },
    { order: 1, expected: [2.875, 0.625] },
    { order: 2, expected: [0, 0] },
    { order: 10, expected: [0, 0] },
  ])('evaluates place2d operation order $order with named and positional inputs', ({ order, expected }) => {
    for (const named of [false, true]) {
      const b = new IrModuleBuilder();
      const type = vector(2);
      const texcoord = b.constant(type, [3, 5]);
      const pivot = b.constant(type, [1, 1]);
      const scale = b.constant(type, [2, 4]);
      const rotate = b.constant(FLOAT, 90);
      const offset = b.constant(type, [0.5, 0.25]);
      const operationorder = b.constant(INT, order);
      const args = [texcoord, pivot, scale, rotate, offset, operationorder];
      const ref = b.add(named
        ? { kind: 'call', type, op: 'place2d', args: [], namedArgs: { texcoord, pivot, scale, rotate, offset, operationorder } }
        : { kind: 'call', type, op: 'place2d', args });
      b.output({ name: 'result', type, ref });
      const ir = b.build();
      evaluateIrRef(ir, ref, { texcoord: [99, 99] }).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 10));
      expect(emitWgsl(ir).code).toContain(`mx_place2d(${args.slice(0, 5).join(', ')}, i32(${operationorder}))`);
    }
  });

  it('uses the place2d NodeDef defaults without an implicit geometric UV', () => {
    const b = new IrModuleBuilder();
    const type = vector(2);
    const ref = b.add({ kind: 'call', type, op: 'place2d', args: [], namedArgs: {} });
    b.output({ name: 'result', type, ref });
    expect(evaluateIrRef(b.build(), ref, { texcoord: [0.7, 0.8] })).toEqual([0, 0]);
    expect(emitWgsl(b.build()).code).toContain('mx_place2d(vec2f(0.0)');
  });

  it.each([
    { op: 'rotate2d', input: [1, 0], expected: [0, -1] },
    { op: 'rotate3d', input: [1, 0, 0], expected: [0, 0, 1] },
  ])('rotates $op in the MaterialX direction using its default axis', ({ op, input, expected }) => {
    for (const named of [false, true]) {
      const b = new IrModuleBuilder();
      const type = vector(input.length as 2 | 3);
      const value = b.constant(type, input);
      const amount = b.constant(FLOAT, 90);
      const ref = b.add(named
        ? { kind: 'call', type, op, args: [], namedArgs: { in: value, amount } }
        : { kind: 'call', type, op, args: [value, amount] });
      b.output({ name: 'result', type, ref });
      const ir = b.build();
      evaluateIrRef(ir, ref).forEach((component, i) => expect(component).toBeCloseTo(expected[i]!, 10));
      if (op === 'rotate3d') expect(emitWgsl(ir).code).toContain(`mx_rotate3d(${value}, ${amount}, vec3f(0.0, 1.0, 0.0))`);
    }
  });

  it('normalizes an authored rotate3d axis and follows the MaterialX rotation direction', () => {
    const b = new IrModuleBuilder();
    const type = vector(3);
    const value = b.constant(type, [1, 0, 0]);
    const amount = b.constant(FLOAT, 90);
    const axis = b.constant(type, [0, 2, 0]);
    const ref = b.add({ kind: 'call', type, op: 'rotate3d', args: [value, amount, axis] });
    const result = evaluateIrRef(b.build(), ref);
    expect(result[0]).toBeCloseTo(0, 10);
    expect(result[1]).toBeCloseTo(0, 10);
    expect(result[2]).toBeCloseTo(1, 10);
  });

  it.each([['rotate2d', 2], ['rotate3d', 3]] as const)('uses the %s NodeDef defaults', (op, size) => {
    const b = new IrModuleBuilder();
    const type = vector(size);
    const ref = b.add({ kind: 'call', type, op, args: [], namedArgs: {} });
    b.output({ name: 'result', type, ref });
    expect(evaluateIrRef(b.build(), ref)).toEqual(Array(size).fill(0));
    expect(emitWgsl(b.build()).code).toContain(`mx_${op}(vec${size}f(0.0), 0.0`);
  });

  it.each([
    { first: [1], second: [2], size: 2 as const, expected: [1, 2] },
    { first: [1, 2, 3], second: [4], size: 4 as const, expected: [1, 2, 3, 4] },
    { first: [1, 2], second: [3, 4], size: 4 as const, expected: [1, 2, 3, 4] },
  ])('combines $first and $second with named and positional inputs', ({ first, second, size, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const type = vector(size);
      const a = builder.constant(first.length === 1 ? FLOAT : vector(first.length as 2 | 3), first.length === 1 ? first[0]! : first);
      const b = builder.constant(second.length === 1 ? FLOAT : vector(2), second.length === 1 ? second[0]! : second);
      const ref = builder.add(named
        ? { kind: 'call', type, op: 'combine2', args: [], namedArgs: { in1: a, in2: b } }
        : { kind: 'call', type, op: 'combine2', args: [a, b] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual(expected);
      expect(emitWgsl(ir).code).toContain(`vec${size}f(${a}, ${b})`);
    }
  });

  it('combines four positional scalar inputs and defaults missing named inputs to zero', () => {
    const builder = new IrModuleBuilder();
    const type = vector(4);
    const args = [1, 2, 3, 4].map(value => builder.constant(FLOAT, value));
    const ref = builder.add({ kind: 'call', type, op: 'combine4', args });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([1, 2, 3, 4]);
    expect(emitWgsl(ir).code).toContain(`vec4f(${args.join(', ')})`);
    const partial = builder.add({ kind: 'call', type, op: 'combine4', args: [], namedArgs: { in2: args[1]! } });
    expect(evaluateIrRef(builder.build(), partial)).toEqual([0, 2, 0, 0]);
  });

  it.each([3, 4] as const)('extracts an entire column from a size-%i matrix', (size) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const type = vector(size);
      const values = Array.from({ length: size * size }, (_, i) => i + 1);
      const source = builder.constant(matrix(size), values);
      const index = builder.constant(INT, 1);
      const ref = builder.add(named
        ? { kind: 'call', type, op: 'extract', args: [], namedArgs: { in: source, index } }
        : { kind: 'call', type, op: 'extract', args: [source, index] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual(values.slice(size, 2 * size));
      expect(emitWgsl(ir).code).toContain(`${source}[${index}]`);
    }
  });

  it('reports an out-of-range matrix column during CPU evaluation', () => {
    const builder = new IrModuleBuilder();
    const source = builder.constant(matrix(3), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const index = builder.constant(INT, 3);
    const ref = builder.add({ kind: 'call', type: vector(3), op: 'extract', args: [source, index] });
    expect(() => evaluateIrRef(builder.build(), ref)).toThrow('extract matrix index 3 is out of bounds');
  });

  it.each([
    { op: 'min', expected: [0.25, 0.5, 0.5] },
    { op: 'max', expected: [0.5, 0.5, 0.75] },
  ])('broadcasts positional scalar operands for vector $op', ({ op, expected }) => {
    const builder = new IrModuleBuilder();
    const type = vector(3);
    const value = builder.constant(type, [0.25, 0.5, 0.75]);
    const bound = builder.constant(FLOAT, 0.5);
    const ref = builder.add({ kind: 'call', type, op, args: [value, bound] });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual(expected);
    expect(emitWgsl(ir).code).toContain(`${op}(${value}, vec3f(${bound}))`);
  });

  it.each([
    { op: 'power', values: [0.25, 1, 4], exponent: 0.5, expected: [0.5, 1, 2] },
    { op: 'safepower', values: [-4, -1, 4], exponent: 0.5, expected: [-2, -1, 2] },
  ])('evaluates vector $op with a scalar exponent for named and positional arguments', ({ op, values, exponent, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const type = vector(3);
      const base = builder.constant(type, values);
      const power = builder.constant(FLOAT, exponent);
      const ref = builder.add(named
        ? { kind: 'call', type, op, args: [], namedArgs: { in1: base, in2: power } }
        : { kind: 'call', type, op, args: [base, power] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual(expected);
      expect(emitWgsl(ir).code).toContain(`vec3f(${power})`);
    }
  });

  it('evaluates safepower with independent vector exponents', () => {
    const builder = new IrModuleBuilder();
    const type = vector(3);
    const base = builder.constant(type, [-4, -1, 4]);
    const power = builder.constant(type, [1, 2, 3]);
    const ref = builder.add({ kind: 'call', type, op: 'safepower', args: [base, power] });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([-4, -1, 64]);
    expect(emitWgsl(ir).code).toContain(`pow(abs(${base}), vec3f(${power}))`);
  });

  it.each([
    { op: 'smoothstep', values: [0.3, 0.2, 0.6], expected: 0.15625 },
    { op: 'remap', values: [0.3, 0.2, 0.6, -1, 3], expected: 0 },
  ])('uses the same $op operands for named and positional calls', ({ op, values, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const inputs = values.map(value => builder.constant(FLOAT, value));
      const names = op === 'smoothstep' ? ['in', 'low', 'high'] : ['in', 'inlow', 'inhigh', 'outlow', 'outhigh'];
      const ref = builder.add(named
        ? { kind: 'call', type: FLOAT, op, args: [], namedArgs: Object.fromEntries(names.map((name, i) => [name, inputs[i]!])) }
        : { kind: 'call', type: FLOAT, op, args: inputs });
      builder.output({ name: 'result', type: FLOAT, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)[0]).toBeCloseTo(expected, 12);
      const code = emitWgsl(ir).code;
      for (const input of inputs) expect(code).toContain(input);
    }
  });

  it.each([
    { size: 2 as const, fg: [1, 0], bg: [0, 1], weights: [0.25, 0.75], expected: [0.25, 0.25] },
    { size: 3 as const, fg: [1, 0.2, 0], bg: [0, 0.6, 1], weights: [0, 0.5, 1], expected: [0, 0.4, 0] },
    { size: 4 as const, fg: [1, 0.2, 0, 1], bg: [0, 0.6, 1, 0], weights: [-1, 0.5, 2, 0.25], expected: [-1, 0.4, -1, 0.25] },
  ])('mixes vector$size channels independently with named and positional weights', ({ size, fg, bg, weights, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const type = vector(size);
      const front = builder.constant(type, fg);
      const back = builder.constant(type, bg);
      const amount = builder.constant(type, weights);
      const ref = builder.add(named
        ? { kind: 'call', type, op: 'mix', args: [], namedArgs: { fg: front, bg: back, mix: amount } }
        : { kind: 'call', type, op: 'mix', args: [front, back, amount] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      evaluateIrRef(ir, ref).forEach((actual, i) => expect(actual).toBeCloseTo(expected[i]!, 12));
      expect(emitWgsl(ir).code).toContain(`mix(${back}, ${front}, ${amount})`);
    }
  });

  it.each([
    { size: 2 as const, input: [3, 4], normalized: [0.6, 0.8] },
    { size: 3 as const, input: [0, 3, 4], normalized: [0, 0.6, 0.8] },
    { size: 4 as const, input: [0, 3, 4, 0], normalized: [0, 0.6, 0.8, 0] },
  ])('evaluates vector$size magnitude, dot product and normalization', ({ size, input, normalized }) => {
    const builder = new IrModuleBuilder();
    const type = vector(size);
    const v = builder.constant(type, input);
    const norm = builder.add({ kind: 'call', type, op: 'normalize', args: [v] });
    const magnitude = builder.add({ kind: 'call', type: FLOAT, op: 'magnitude', args: [v] });
    const dot = builder.add({ kind: 'call', type: FLOAT, op: 'dotproduct', args: [v, v] });
    builder.output({ name: 'normal', type, ref: norm });
    builder.output({ name: 'magnitude', type: FLOAT, ref: magnitude });
    builder.output({ name: 'dot', type: FLOAT, ref: dot });
    const ir = builder.build();
    expect(evaluateIrRef(ir, norm)).toEqual(normalized);
    expect(evaluateIrRef(ir, magnitude)).toEqual([5]);
    expect(evaluateIrRef(ir, dot)).toEqual([25]);
    expect(emitWgsl(ir).code).toContain(`dot(${v}, ${v})`);
  });

  it('returns a zero vector for zero-length normalization', () => {
    const builder = new IrModuleBuilder();
    const type = vector(3);
    const input = builder.constant(type, [0, 0, 0]);
    const ref = builder.add({ kind: 'call', type, op: 'normalize', args: [input] });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([0, 0, 0]);
    expect(emitWgsl(ir).code).toContain(`select(1.0, length(${input}), length(${input}) > 0.0)`);
  });

  it.each([
    { op: 'reflect', incident: [0.6, -0.8, 0], ior: 0.5, expected: [0.6, 0.8, 0] },
    { op: 'refract', incident: [0.6, -0.8, 0], ior: 0.5, expected: [0.3, -Math.sqrt(0.91), 0] },
    { op: 'refract', incident: [0.8, -0.6, 0], ior: 2, expected: [0, 0, 0] },
  ])('evaluates $op for named and positional arguments', ({ op, incident, ior, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const type = vector(3);
      const input = builder.constant(type, incident);
      const normal = builder.constant(type, [0, 1, 0]);
      const ratio = builder.constant(FLOAT, ior);
      const ref = builder.add(named
        ? { kind: 'call', type, op, args: [], namedArgs: op === 'reflect' ? { in: input, normal } : { in: input, normal, ior: ratio } }
        : { kind: 'call', type, op, args: op === 'reflect' ? [input, normal] : [input, normal, ratio] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      evaluateIrRef(ir, ref).forEach((actual, i) => expect(actual).toBeCloseTo(expected[i]!, 12));
      expect(emitWgsl(ir).code).toContain(op === 'reflect'
        ? `reflect(${input}, ${normal})` : `refract(${input}, ${normal}, ${ratio})`);
    }
  });

  it('uses the varying normal and MaterialX defaults for reflection and refraction', () => {
    const builder = new IrModuleBuilder();
    const type = vector(3);
    for (const op of ['reflect', 'refract']) {
      const ref = builder.add({ kind: 'call', type, op, args: [], namedArgs: {} });
      builder.output({ name: op, type, ref });
    }
    const ir = builder.build();
    const result = evaluateShaderIr(ir, { normal: [1, 0, 0] });
    expect(result.get('reflect')).toEqual([-1, 0, 0]);
    expect(result.get('refract')).toEqual([-1, 0, 0]);
    const code = emitWgsl(ir).code;
    expect(code).toContain('reflect(vec3f(1.0, 0.0, 0.0), vary.normal)');
    expect(code).toContain('refract(vec3f(1.0, 0.0, 0.0), vary.normal, 1.0)');
  });

  it.each([
    { op: 'ifequal', a: 2, b: 2, expected: 1 },
    { op: 'ifgreater', a: 2, b: 2, expected: 0 },
    { op: 'ifgreatereq', a: 2, b: 2, expected: 1 },
  ])('evaluates $op boolean comparisons with named and positional inputs', ({ op, a, b, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const value1 = builder.constant(FLOAT, a);
      const value2 = builder.constant(FLOAT, b);
      const ref = builder.add(named
        ? { kind: 'call', type: BOOL, op, args: [], namedArgs: { value1, value2 } }
        : { kind: 'call', type: BOOL, op, args: [value1, value2] });
      builder.output({ name: 'result', type: BOOL, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual([expected]);
      expect(emitWgsl(ir).code).toContain(op === 'ifequal' ? ' == ' : op === 'ifgreater' ? ' > ' : ' >= ');
    }
  });

  it.each([3, 4] as const)('selects size-%i matrix conditional branches', (size) => {
    const builder = new IrModuleBuilder();
    const type = matrix(size);
    const a = builder.constant(type, Array.from({ length: size * size }, (_, i) => i + 1));
    const b = builder.constant(type, Array.from({ length: size * size }, (_, i) => i + 21));
    const one = builder.constant(INT, 1);
    const two = builder.constant(INT, 2);
    const ref = builder.add({
      kind: 'call', type, op: 'ifgreater', args: [],
      namedArgs: { value1: two, value2: one, in1: a, in2: b },
    });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual(Array.from({ length: size * size }, (_, i) => i + 1));
    expect(emitWgsl(ir).code).toContain(`mx_select_matrix${size}(${b}, ${a},`);
  });

  it.each([
    { which: -3, expected: 1 },
    { which: 0.99, expected: 1 },
    { which: 1, expected: 2 },
    { which: 9.99, expected: 10 },
    { which: 10, expected: 0 },
    { which: 25, expected: 0 },
  ])('selects the MaterialX switch input at $which', ({ which, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const inputs = Array.from({ length: 10 }, (_, i) => builder.constant(FLOAT, i + 1));
      const selector = builder.constant(FLOAT, which);
      const ref = builder.add(named
        ? { kind: 'call', type: FLOAT, op: 'switch', args: [], namedArgs: { ...Object.fromEntries(inputs.map((input, i) => [`in${i + 1}`, input])), which: selector } }
        : { kind: 'call', type: FLOAT, op: 'switch', args: [...inputs, selector] });
      builder.output({ name: 'result', type: FLOAT, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual([expected]);
      expect(emitWgsl(ir).code).toContain(selector);
    }
  });

  it('uses zero for an omitted switch input instead of the last provided input', () => {
    const builder = new IrModuleBuilder();
    const first = builder.constant(FLOAT, 7);
    const selector = builder.constant(INT, 3);
    const ref = builder.add({ kind: 'call', type: FLOAT, op: 'switch', args: [], namedArgs: { in1: first, which: selector } });
    builder.output({ name: 'result', type: FLOAT, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([0]);
    expect(emitWgsl(ir).code).toContain('f32(');
  });

  it.each([3, 4] as const)('selects a size-%i matrix switch input', (size) => {
    const builder = new IrModuleBuilder();
    const type = matrix(size);
    const expected = Array.from({ length: size * size }, (_, i) => i + 1);
    const second = builder.constant(type, expected);
    const which = builder.constant(INT, 1);
    const ref = builder.add({ kind: 'call', type, op: 'switch', args: [], namedArgs: { in2: second, which } });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual(expected);
    expect(emitWgsl(ir).code).toContain(`mx_select_matrix${size}(`);
  });

  it.each([
    { op: 'and', symbol: '&&', expected: [0, 0, 0, 1] },
    { op: 'or', symbol: '||', expected: [0, 1, 1, 1] },
    { op: 'xor', symbol: '!=', expected: [0, 1, 1, 0] },
  ])('evaluates $op truth table with named and positional inputs', ({ op, symbol, expected }) => {
    for (const named of [false, true]) {
      for (const [i, [a, b]] of [[0, 0], [0, 1], [1, 0], [1, 1]].entries()) {
        const builder = new IrModuleBuilder();
        const left = builder.constant(BOOL, a!);
        const right = builder.constant(BOOL, b!);
        const ref = builder.add(named
          ? { kind: 'call', type: BOOL, op, args: [], namedArgs: { in1: left, in2: right } }
          : { kind: 'call', type: BOOL, op, args: [left, right] });
        builder.output({ name: 'result', type: BOOL, ref });
        const ir = builder.build();
        expect(evaluateIrRef(ir, ref)).toEqual([expected[i]]);
        expect(emitWgsl(ir).code).toContain(`(${left} ${symbol} ${right})`);
      }
    }
    const builder = new IrModuleBuilder();
    const left = builder.constant(BOOL, 1);
    const ref = builder.add({ kind: 'call', type: BOOL, op, args: [], namedArgs: { in1: left } });
    builder.output({ name: 'result', type: BOOL, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([expected[2]]);
    expect(emitWgsl(ir).code).toContain(`(${left} ${symbol} false)`);
  });

  it('evaluates not with named and positional inputs and defaults', () => {
    for (const named of [false, true]) {
      for (const input of [0, 1]) {
        const builder = new IrModuleBuilder();
        const source = builder.constant(BOOL, input);
        const ref = builder.add(named
          ? { kind: 'call', type: BOOL, op: 'not', args: [], namedArgs: { in: source } }
          : { kind: 'call', type: BOOL, op: 'not', args: [source] });
        builder.output({ name: 'result', type: BOOL, ref });
        const ir = builder.build();
        expect(evaluateIrRef(ir, ref)).toEqual([1 - input]);
        expect(emitWgsl(ir).code).toContain(`(!${source})`);
      }
    }
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind: 'call', type: BOOL, op: 'not', args: [], namedArgs: {} });
    builder.output({ name: 'result', type: BOOL, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([1]);
    expect(emitWgsl(ir).code).toContain('(!false)');
  });

  it('uses the same atan2 argument order for named and positional IR', () => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const y = builder.constant(FLOAT, -1);
      const x = builder.constant(FLOAT, -2);
      const ref = builder.add(named
        ? { kind: 'call', type: FLOAT, op: 'atan2', args: [], namedArgs: { iny: y, inx: x } }
        : { kind: 'call', type: FLOAT, op: 'atan2', args: [y, x] });
      builder.output({ name: 'result', type: FLOAT, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)[0]).toBeCloseTo(Math.atan2(-1, -2), 12);
      expect(emitWgsl(ir).code).toContain(`atan2(${y}, ${x})`);
    }
  });

  it.each([
    { op: 'cellnoise2d', point: [0.25, 0.75], expected: 0.8603127598762512 },
    { op: 'cellnoise2d', point: [-0.5, -1.5], expected: 0.4490436613559723 },
    { op: 'cellnoise3d', point: [-0.5, -1.5, -2.5], expected: 0.9865114092826843 },
    { op: 'cellnoise3d', point: [1.25, 2.75, 3.5], expected: 0.7219463586807251 },
  ])('evaluates $op using the MaterialX cell hash', ({ op, point, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const coordinate = builder.constant(vector(point.length as 2 | 3), point);
      const ref = builder.add(named
        ? { kind: 'call', type: FLOAT, op, args: [], namedArgs: { [op === 'cellnoise2d' ? 'texcoord' : 'position']: coordinate } }
        : { kind: 'call', type: FLOAT, op, args: [coordinate] });
      builder.output({ name: 'result', type: FLOAT, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)[0]).toBeCloseTo(expected, 7);
      expect(emitWgsl(ir).code).toContain(op === 'cellnoise2d' ? 'mx_cellnoise2(' : 'mx_materialx_cellnoise3(');
    }
  });

  it.each([
    { op: 'noise2d', point: [0.25, 0.75], expected: [-0.5117831, -0.5341188, 0.2630683] },
    { op: 'noise3d', point: [-0.5, 1.25, 2.75], expected: [-0.263695, -0.687346, 0.1682076] },
  ])('evaluates $op consistently for named and positional inputs', ({ op, point, expected }) => {
    const results = [];
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const coordinate = builder.constant(vector(point.length as 2 | 3), point);
      const amplitude = builder.constant(FLOAT, 1.5);
      const pivot = builder.constant(FLOAT, -0.25);
      const ref = builder.add(named
        ? { kind: 'call', type: COLOR3, op, args: [], namedArgs: {
          [op === 'noise2d' ? 'texcoord' : 'position']: coordinate, amplitude, pivot,
        } }
        : { kind: 'call', type: COLOR3, op, args: [coordinate, amplitude, pivot] });
      builder.output({ name: 'result', type: COLOR3, ref });
      const ir = builder.build();
      results.push(evaluateIrRef(ir, ref));
      expect(emitWgsl(ir).code).toContain('mx_perlin3');
    }
    expect(results[0]).toEqual(results[1]);
    results[0]!.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));

    const builder = new IrModuleBuilder();
    const coordinate = builder.constant(vector(point.length as 2 | 3), point);
    const ref = builder.add({
      kind: 'call', type: FLOAT, op, args: [],
      namedArgs: { [op === 'noise2d' ? 'texcoord' : 'position']: coordinate },
    });
    expect(evaluateIrRef(builder.build(), ref)[0]).toBeCloseTo((expected[0]! + 0.25) / 1.5, 6);
  });

  it.each([
    { inputType: FLOAT, value: 0.125, expected: 0.3100903630256653 },
    { inputType: FLOAT, value: 2, expected: 0.31585249304771423 },
    { inputType: INT, value: 2, expected: 0.611083984375 },
  ])('matches randomfloat NodeDef for $inputType.scalar input', ({ inputType, value, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const input = builder.constant(inputType, value);
      const min = builder.constant(FLOAT, -1);
      const max = builder.constant(FLOAT, 3);
      const seed = builder.constant(INT, 5);
      const ref = builder.add(named
        ? { kind: 'call', type: FLOAT, op: 'randomfloat', args: [], namedArgs: { in: input, min, max, seed } }
        : { kind: 'call', type: FLOAT, op: 'randomfloat', args: [input, min, max, seed] });
      builder.output({ name: 'result', type: FLOAT, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)[0]).toBeCloseTo(-1 + 4 * expected, 7);
      const code = emitWgsl(ir).code;
      expect(code).toContain(`f32(${input})${inputType === FLOAT ? ' * 4096.0' : ''}`);
      expect(code).toContain('mx_cellnoise2(');
    }
  });

  it('uses the default seed and range of randomfloat', () => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind: 'call', type: FLOAT, op: 'randomfloat', args: [], namedArgs: {} });
    builder.output({ name: 'result', type: FLOAT, ref });
    expect(evaluateIrRef(builder.build(), ref)[0]).toBeCloseTo(0.8603127598762512, 7);
  });

  it('accepts positional randomcolor inputs, including custom ranges', () => {
    const builder = new IrModuleBuilder();
    const refs = [
      builder.constant(INT, 2),
      builder.constant(FLOAT, 0.25), builder.constant(FLOAT, 0.25),
      builder.constant(FLOAT, 0.5), builder.constant(FLOAT, 0.5),
      builder.constant(FLOAT, 0.8), builder.constant(FLOAT, 0.8),
      builder.constant(INT, 5),
    ];
    const ref = builder.add({ kind: 'call', type: COLOR3, op: 'randomcolor', args: refs });
    builder.output({ name: 'result', type: COLOR3, ref });
    const ir = builder.build();
    evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo([0.6, 0.8, 0.4][i]!, 7));
    const code = emitWgsl(ir).code;
    for (const arg of refs) expect(code).toContain(arg);
  });

  it.each([
    { op: 'hsvtorgb', input: [-1 / 3, 1, 0.8, 0.4], expected: [0, 0, 0.8, 0.4] },
    { op: 'hsvtorgb', input: [0.25, 0.00005, 0.8, 0.4], expected: [0.8, 0.8, 0.8, 0.4] },
    { op: 'rgbtohsv', input: [-1, -0.5, -0.25, 0.4], expected: [0, 0, -0.25, 0.4] },
    { op: 'rgbtohsv', input: [1, 0, 0, 0.4], expected: [0, 1, 1, 0.4] },
  ])('evaluates $op for color4 and preserves alpha', ({ op, input: inputValue, expected }) => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(COLOR4, inputValue);
    const ref = builder.add({ kind: 'call', type: COLOR4, op, args: [input] });
    builder.output({ name: 'result', type: COLOR4, ref });
    const ir = builder.build();
    evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 10));
    expect(emitWgsl(ir).code).toContain(`${input}.rgb`);
  });

  it.each([COLOR3, COLOR4])('adjusts HSV with a wrapped hue and scaled saturation and value', type => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const input = builder.constant(type, type === COLOR4 ? [1, 0, 0, 0.3] : [1, 0, 0]);
      const amount = builder.constant(vector(3), [-1 / 3, 0.5, 0.8]);
      const ref = builder.add(named
        ? { kind: 'call', type, op: 'hsvadjust', args: [], namedArgs: { in: input, amount } }
        : { kind: 'call', type, op: 'hsvadjust', args: [input, amount] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      const expected = type === COLOR4 ? [0.4, 0.4, 0.8, 0.3] : [0.4, 0.4, 0.8];
      evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 10));
      expect(emitWgsl(ir).code).toContain(`mx_hsvadjust(${type === COLOR4 ? `${input}.rgb` : input}, ${amount})`);
    }
  });

  it.each(['luminance', 'saturate'])('uses custom luminance coefficients and preserves alpha in %s', op => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const input = builder.constant(COLOR4, [0.2, 0.6, 1, 0.4]);
      const coeffs = builder.constant(COLOR3, [0, 1, 0]);
      const amount = builder.constant(FLOAT, 0.5);
      const refs = op === 'luminance' ? [input, coeffs] : [input, amount, coeffs];
      const namedArgs = op === 'luminance' ? { in: input, lumacoeffs: coeffs } : { in: input, amount, lumacoeffs: coeffs };
      const ref = builder.add(named
        ? { kind: 'call', type: COLOR4, op, args: [], namedArgs }
        : { kind: 'call', type: COLOR4, op, args: refs });
      builder.output({ name: 'result', type: COLOR4, ref });
      const ir = builder.build();
      const expected = op === 'luminance' ? [0.6, 0.6, 0.6, 0.4] : [0.4, 0.6, 0.8, 0.4];
      evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 10));
      expect(emitWgsl(ir).code).toContain(coeffs);
    }
  });

  it('applies scalar or per-channel contrast to color4 including alpha', () => {
    for (const scalar of [false, true]) {
      const builder = new IrModuleBuilder();
      const input = builder.constant(COLOR4, [0.2, 0.4, 0.6, 0.8]);
      const amount = builder.constant(scalar ? FLOAT : COLOR4, scalar ? 2 : [2, 1, 0, -1]);
      const pivot = builder.constant(scalar ? FLOAT : COLOR4, scalar ? 0.5 : [0.5, 0.5, 0.5, 0.5]);
      const ref = builder.add({ kind: 'call', type: COLOR4, op: 'contrast', args: [input, amount, pivot] });
      builder.output({ name: 'result', type: COLOR4, ref });
      const ir = builder.build();
      const expected = scalar ? [-0.1, 0.3, 0.7, 1.1] : [-0.1, 0.4, 0.5, 0.2];
      evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 10));
      expect(emitWgsl(ir).code).toContain(`vec4f(${pivot})`);
    }
  });

  it('applies colorcorrect stages in MaterialX order without altering alpha', () => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const input = builder.constant(COLOR4, [1, 0, 0, 0.25]);
      const hue = builder.constant(FLOAT, 0);
      const saturation = builder.constant(FLOAT, 0);
      const gamma = builder.constant(FLOAT, 2);
      const lift = builder.constant(FLOAT, 0.1);
      const gain = builder.constant(FLOAT, 2);
      const contrast = builder.constant(FLOAT, 0.5);
      const contrastpivot = builder.constant(FLOAT, 0.3);
      const exposure = builder.constant(FLOAT, 1);
      const refs = [input, hue, saturation, gamma, lift, gain, contrast, contrastpivot, exposure];
      const ref = builder.add(named
        ? { kind: 'call', type: COLOR4, op: 'colorcorrect', args: [], namedArgs: { in: input, hue, saturation, gamma, lift, gain, contrast, contrastpivot, exposure } }
        : { kind: 'call', type: COLOR4, op: 'colorcorrect', args: refs });
      builder.output({ name: 'result', type: COLOR4, ref });
      const ir = builder.build();
      const gray = ((Math.sqrt(0.2722287) * 0.9 + 0.1) * 2 - 0.3) + 0.6;
      evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(i === 3 ? 0.25 : gray, 10));
      expect(emitWgsl(ir).code).toContain(`mx_colorcorrect(${input}.rgb, ${hue}, ${saturation}, ${gamma}, ${lift}, ${gain}, ${contrast}, ${contrastpivot}, ${exposure})`);
    }
  });

  it('preserves the sign of negative colorcorrect channels through gamma', () => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({
      kind: 'call', type: COLOR3, op: 'colorcorrect', args: [],
      namedArgs: {
        in: builder.constant(COLOR3, [1, 0, 0]),
        saturation: builder.constant(FLOAT, 2),
        gamma: builder.constant(FLOAT, 0.5),
      },
    });
    builder.output({ name: 'result', type: COLOR3, ref });
    const ir = builder.build();
    const expected = [(2 - 0.2722287) ** 2, -(0.2722287 ** 2), -(0.2722287 ** 2)];
    evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 10));
  });

  it.each([
    {
      size: 3 as const,
      columns: [[1, 2, 3], [4, 5, 6], [7, 8, 10]],
      expected: [1, 2, 3, 4, 5, 6, 7, 8, 10],
    },
    {
      size: 4 as const,
      columns: [[1, 2, 3], [4, 5, 6], [7, 8, 10], [11, 12, 13]],
      expected: [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 10, 0, 11, 12, 13, 1],
    },
  ])('creates matrix$size from MaterialX column vectors', ({ size, columns, expected }) => {
    const builder = new IrModuleBuilder();
    const namedArgs = Object.fromEntries(columns.map((column, i) =>
      [`in${i + 1}`, builder.constant(vector(column.length as 3 | 4), column)]));
    const ref = builder.add({ kind: 'call', type: matrix(size), op: 'creatematrix', args: [], namedArgs });
    builder.output({ name: 'result', type: matrix(size), ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual(expected);
    expect(emitWgsl(ir).code).toContain(size === 3 ? 'mat3x3f(' : 'mat4x4f(');
  });

  it('creates matrix44 from vector4 columns and defaults matrix creation to identity', () => {
    const builder = new IrModuleBuilder();
    const columns = [
      [2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], [5, 6, 7, 1],
    ];
    const ref = builder.add({
      kind: 'call', type: matrix(4), op: 'creatematrix', args: [],
      namedArgs: Object.fromEntries(columns.map((column, i) =>
        [`in${i + 1}`, builder.constant(vector(4), column)])),
    });
    const identityRef = builder.add({ kind: 'call', type: matrix(3), op: 'creatematrix', args: [], namedArgs: {} });
    builder.output({ name: 'matrix', type: matrix(4), ref });
    builder.output({ name: 'identity', type: matrix(3), ref: identityRef });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]);
    expect(evaluateIrRef(ir, identityRef)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(emitWgsl(ir).code).toContain('vec3f(0.0, 0.0, 1.0)');
  });

  it.each([
    { size: 3 as const, values: [1, 2, 3, 4, 5, 6, 7, 8, 10], determinant: -3 },
    { size: 4 as const, values: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1], determinant: 24 },
  ])('evaluates matrix$size determinant and transpose', ({ size, values, determinant }) => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(matrix(size), values);
    const det = builder.add({ kind: 'call', type: FLOAT, op: 'determinant', args: [input] });
    const transpose = builder.add({ kind: 'call', type: matrix(size), op: 'transpose', args: [input] });
    builder.output({ name: 'determinant', type: FLOAT, ref: det });
    builder.output({ name: 'transpose', type: matrix(size), ref: transpose });
    const ir = builder.build();
    expect(evaluateIrRef(ir, det)).toEqual([determinant]);
    expect(evaluateIrRef(ir, transpose)).toEqual(Array.from({ length: size * size }, (_, i) =>
      values[(i % size) * size + Math.floor(i / size)]!));
    const code = emitWgsl(ir).code;
    expect(code).toContain('determinant(');
    expect(code).toContain('transpose(');
  });

  it.each([
    { size: 3 as const, values: [1, 2, 3, 4, 5, 6, 7, 8, 10], inverse: [-2 / 3, -4 / 3, 1, -2 / 3, 11 / 3, -2, 1, -2, 1] },
    { size: 4 as const, values: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1], inverse: [0.5, 0, 0, 0, 0, 1 / 3, 0, 0, 0, 0, 0.25, 0, -2.5, -2, -1.75, 1] },
  ])('inverts matrix$size in column-major order', ({ size, values, inverse }) => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(matrix(size), values);
    const ref = builder.add({ kind: 'call', type: matrix(size), op: 'invertmatrix', args: [input] });
    builder.output({ name: 'result', type: matrix(size), ref });
    const ir = builder.build();
    evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(inverse[i]!, 10));
    expect(emitWgsl(ir).code).toContain(size === 3 ? 'mx_inverse3(' : 'mx_inverse4(');
  });

  it.each([
    { op: 'matrix33', matrixValues: [2, 0, 0, 0, 3, 0, 7, 8, 1], input: [2, 3], type: vector(2), expected: [11, 17] },
    { op: 'matrix33', matrixValues: [2, 0, 0, 0, 3, 0, 0, 0, 4], input: [2, 3, 4], type: vector(3), expected: [4, 9, 16] },
    { op: 'matrix44', matrixValues: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1], input: [2, 3, 4], type: vector(3), expected: [9, 15, 23] },
    { op: 'matrix44', matrixValues: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1], input: [2, 3, 4, 2], type: vector(4), expected: [14, 21, 30, 2] },
  ])('transforms $type with $op', ({ matrixValues, input: inputValue, type, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const vectorRef = builder.constant(type, inputValue);
      const matrixRef = builder.constant(matrix(matrixValues.length === 9 ? 3 : 4), matrixValues);
      const ref = builder.add(named
        ? { kind: 'call', type, op: 'transformmatrix', args: [], namedArgs: { in: vectorRef, mat: matrixRef } }
        : { kind: 'call', type, op: 'transformmatrix', args: [vectorRef, matrixRef] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual(expected);
      expect(emitWgsl(ir).code).toContain(' * ');
    }
  });

  it.each([
    { op: 'transformpoint', expected: [7, 12, 19] },
    { op: 'transformvector', expected: [2, 6, 12] },
    { op: 'transformnormal', expected: [2 / Math.sqrt(184), 6 / Math.sqrt(184), 12 / Math.sqrt(184)] },
  ])('evaluates $op with named and positional matrix inputs', ({ op, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const type = vector(3);
      const input = builder.constant(type, [1, 2, 3]);
      const mat = builder.constant(matrix(4), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]);
      const ref = builder.add(named
        ? { kind: 'call', type, op, args: [], namedArgs: { in: input, mat } }
        : { kind: 'call', type, op, args: [input, mat] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      evaluateIrRef(ir, ref).forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 10));
      expect(emitWgsl(ir).code).toContain(op === 'transformnormal' ? 'transpose(' : `vec4f(${input},`);
    }
  });

  it('uses identity defaults for matrix operations', () => {
    const builder = new IrModuleBuilder();
    const transpose = builder.add({ kind: 'call', type: matrix(4), op: 'transpose', args: [], namedArgs: {} });
    const inverse = builder.add({ kind: 'call', type: matrix(4), op: 'invertmatrix', args: [], namedArgs: {} });
    const determinant = builder.add({ kind: 'call', type: FLOAT, op: 'determinant', args: [], namedArgs: {} });
    const created = builder.add({ kind: 'call', type: matrix(4), op: 'creatematrix', args: [], namedArgs: {} });
    const transformed = builder.add({ kind: 'call', type: vector(2), op: 'transformmatrix', args: [], namedArgs: {} });
    builder.output({ name: 'transpose', type: matrix(4), ref: transpose });
    builder.output({ name: 'inverse', type: matrix(4), ref: inverse });
    builder.output({ name: 'determinant', type: FLOAT, ref: determinant });
    builder.output({ name: 'created', type: matrix(4), ref: created });
    builder.output({ name: 'transformed', type: vector(2), ref: transformed });
    const ir = builder.build();
    const identity4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    evaluateIrRef(ir, transpose).forEach((value, i) => expect(value).toBeCloseTo(identity4[i]!, 10));
    evaluateIrRef(ir, inverse).forEach((value, i) => expect(value).toBeCloseTo(identity4[i]!, 10));
    expect(evaluateIrRef(ir, determinant)).toEqual([1]);
    evaluateIrRef(ir, created).forEach((value, i) => expect(value).toBeCloseTo(identity4[i]!, 10));
    expect(evaluateIrRef(ir, transformed)).toEqual([0, 0]);
    const code = emitWgsl(ir).code;
    expect(code).toMatch(/mx_inverse4\(mat4x4f\(vec4f\(1\.0, 0\.0, 0\.0, 0\.0\)/);
    expect(code).toMatch(/transpose\(mat4x4f\(vec4f\(1\.0, 0\.0, 0\.0, 0\.0\)/);
    expect(code).toContain('mat4x4f(vec4f(1.0, 0.0, 0.0, 0.0)');
  });

  const aces = (r: number, g: number, b: number) => [
    1.705050992658 * r - 0.621792120657 * g - 0.083258872001 * b,
    -0.130256417507 * r + 1.140804736575 * g - 0.010548319068 * b,
    -0.024003356805 * r - 0.128968976065 * g + 1.15297233287 * b,
  ];
  const adobe = (r: number, g: number, b: number) => [
    1.39835574 * r - 0.398355744 * g,
    -2.50233861e-16 * r + g,
    2.77555756e-17 * r - 0.0429289893 * g + 1.04292899 * b,
  ];
  const p3 = (r: number, g: number, b: number) => [
    1.22493029 * r - 0.22492968 * g + 0.00000006 * b,
    -0.04205868 * r + 1.04205894 * g - 0.00000001 * b,
    -0.01964128 * r - 0.07864794 * g + 1.09828925 * b,
  ];
  const srgb = (value: number) => value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92;
  const gamma = (power: number) => (value: number) => Math.max(value, 0) ** power;
  const transforms: readonly [string, (rgb: number[]) => number[]][] = [
    ['g18_rec709_to_lin_rec709', rgb => rgb.map(gamma(1.8))],
    ['g22_rec709_to_lin_rec709', rgb => rgb.map(gamma(2.2))],
    ['rec709_display_to_lin_rec709', rgb => rgb.map(gamma(2.4))],
    ['acescg_to_lin_rec709', ([r, g, b]) => aces(r!, g!, b!)],
    ['g22_ap1_to_lin_rec709', rgb => { const [r, g, b] = rgb.map(gamma(2.2)); return aces(r!, g!, b!); }],
    ['srgb_texture_to_lin_rec709', rgb => rgb.map(srgb)],
    ['lin_adobergb_to_lin_rec709', ([r, g, b]) => adobe(r!, g!, b!)],
    ['adobergb_to_lin_rec709', rgb => { const [r, g, b] = rgb.map(gamma(563 / 256)); return adobe(r!, g!, b!); }],
    ['srgb_displayp3_to_lin_rec709', rgb => { const [r, g, b] = rgb.map(srgb); return p3(r!, g!, b!); }],
    ['lin_displayp3_to_lin_rec709', ([r, g, b]) => p3(r!, g!, b!)],
  ];

  it.each(transforms)('evaluates %s for primaries, signed HDR and sRGB thresholds', (op, expected) => {
    const samples = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-0.2, 0.5, 1.25], [0.04044, 0.04045, 0.04046]];
    for (const rgb of samples) {
      for (const type of [COLOR3, COLOR4]) {
        for (const named of [false, true]) {
          const builder = new IrModuleBuilder();
          const color = type === COLOR4 ? [...rgb, 0.37] : rgb;
          const input = builder.constant(type, color);
          const ref = builder.add(named
            ? { kind: 'call', type, op, args: [], namedArgs: { in: input } }
            : { kind: 'call', type, op, args: [input] });
          builder.output({ name: 'result', type, ref });
          const ir = builder.build();
          const want = type === COLOR4 ? [...expected(rgb), 0.37] : expected(rgb);
          evaluateIrRef(ir, ref).forEach((component, i) => expect(component).toBeCloseTo(want[i]!, 10));
          expect(emitWgsl(ir).code).toContain(input);
        }
      }
    }
  });

  it.each(transforms)('uses the MaterialX defaults for %s', (op) => {
    for (const type of [COLOR3, COLOR4]) {
      const builder = new IrModuleBuilder();
      const ref = builder.add({ kind: 'call', type, op, args: [], namedArgs: {} });
      builder.output({ name: 'result', type, ref });
      expect(evaluateIrRef(builder.build(), ref)).toEqual(type === COLOR4 ? [0, 0, 0, 1] : [0, 0, 0]);
      expect(emitWgsl(builder.build()).code).toContain(type === COLOR4 ? 'vec4f(0.0, 0.0, 0.0, 1.0)' : 'vec3f(0.0)');
    }
  });

  it('rejects mismatched color transform input types', () => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(COLOR3, [1, 0, 0]);
    const ref = builder.add({ kind: 'call', type: COLOR4, op: 'acescg_to_lin_rec709', args: [input] });
    builder.output({ name: 'result', type: COLOR4, ref });
    expect(() => evaluateIrRef(builder.build(), ref)).toThrow(IrEvalError);
    expect(() => emitWgsl(builder.build())).toThrow(/input must match/);
  });

  it.each([
    { type: vector(2), values: [-2, 3], min: -2, max: 3 },
    { type: vector(3), values: [2, 3, -4], min: -4, max: 3 },
    { type: COLOR3, values: [-2, 3, 5], min: -2, max: 5 },
    { type: vector(4), values: [2, 3, 4, -5], min: -5, max: 4 },
    { type: COLOR4, values: [-2, -3, -4, 5], min: -4, max: 5 },
  ])('reduces all components of $type', ({ type, values, min, max }) => {
    for (const [op, expected] of [['mincomponent', min], ['maxcomponent', max]] as const) {
      for (const named of [false, true]) {
        const builder = new IrModuleBuilder();
        const input = builder.constant(type, values);
        const ref = builder.add(named
          ? { kind: 'call', type: FLOAT, op, args: [], namedArgs: { in: input } }
          : { kind: 'call', type: FLOAT, op, args: [input] });
        builder.output({ name: 'result', type: FLOAT, ref });
        const ir = builder.build();
        expect(evaluateIrRef(ir, ref)).toEqual([expected]);
        const code = emitWgsl(ir).code;
        expect(code).toContain(`${op === 'mincomponent' ? 'min' : 'max'}(`);
        expect(code).toContain(`${input}.${'xyzw'[values.length - 1]}`);
      }
    }
  });

  it.each([
    [0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.25], [1, 0],
    [1.25, 0.25], [-0.25, 0.25], [-0.5, 0.5], [-0.75, 0.25], [-1, 0],
  ])('evaluates the MaterialX trianglewave graph at %s', (value, expected) => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(FLOAT, value);
    for (const named of [false, true]) {
      const ref = builder.add(named
        ? { kind: 'call', type: FLOAT, op: 'trianglewave', args: [], namedArgs: { in: input } }
        : { kind: 'call', type: FLOAT, op: 'trianglewave', args: [input] });
      builder.output({ name: `result_${named}`, type: FLOAT, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual([expected]);
      expect(emitWgsl(ir).code).toContain('floor(');
    }
  });

  it('uses the trianglewave default input', () => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind: 'call', type: FLOAT, op: 'trianglewave', args: [], namedArgs: {} });
    builder.output({ name: 'result', type: FLOAT, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([0]);
    expect(emitWgsl(ir).code).toContain('abs(0.0)');
  });

  it.each(['mincomponent', 'maxcomponent'])('rejects a scalar input for %s', (op) => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(FLOAT, 1);
    const ref = builder.add({ kind: 'call', type: FLOAT, op, args: [input] });
    builder.output({ name: 'result', type: FLOAT, ref });
    expect(() => evaluateIrRef(builder.build(), ref)).toThrow(IrEvalError);
    expect(() => emitWgsl(builder.build())).toThrow(/vector/i);
  });

  it.each([
    { op: 'over', expected: [0.625, 0.75, 0.875, 0.875] },
    { op: 'in', expected: [0.1875, 0.375, 0.5625, 0.375] },
    { op: 'out', expected: [0.0625, 0.125, 0.1875, 0.125] },
    { op: 'mask', expected: [0.375, 0.25, 0.125, 0.375] },
    { op: 'matte', expected: [0.5, 0.5, 0.5, 0.875] },
    { op: 'disjointover', expected: [0.75, 5 / 6, 11 / 12, 1] },
  ])('composites $op using foreground and background alpha', ({ op, expected }) => {
    for (const named of [false, true]) {
      for (const amount of [0, 0.25, 1, 1.5]) {
        const builder = new IrModuleBuilder();
        const fg = builder.constant(COLOR4, [0.25, 0.5, 0.75, 0.5]);
        const bgValue = [0.75, 0.5, 0.25, 0.75];
        const bg = builder.constant(COLOR4, bgValue);
        const t = builder.constant(FLOAT, amount);
        const ref = builder.add(named
          ? { kind: 'call', type: COLOR4, op, args: [], namedArgs: { fg, bg, mix: t } }
          : { kind: 'call', type: COLOR4, op, args: [fg, bg, t] });
        builder.output({ name: 'result', type: COLOR4, ref });
        const ir = builder.build();
        evaluateIrRef(ir, ref).forEach((value, i) =>
          expect(value).toBeCloseTo(bgValue[i]! * (1 - amount) + expected[i]! * amount, 10));
        const code = emitWgsl(ir).code;
        expect(code).toContain(op === 'disjointover' ? 'mx_disjointover(' : 'mix(');
        expect(code).toContain(op === 'disjointover' ? `mx_disjointover(${fg}, ${bg}, ${t})` : `mix(${bg},`);
        if (op !== 'disjointover') expect(code).toContain(`, ${t})`);
      }
    }
  });

  it.each([
    { fgAlpha: 0.25, bgAlpha: 0.5, expected: [1, 1, 1, 0.75] },
    { fgAlpha: 0.5, bgAlpha: 0.5, expected: [1, 1, 1, 1] },
    { fgAlpha: 1.5, bgAlpha: 0, expected: [0, 0, 0, 1] },
    { fgAlpha: 1.5, bgAlpha: 0.000000001, expected: [0, 0, 0, 1] },
  ])('handles disjointover alpha boundaries $fgAlpha, $bgAlpha', ({ fgAlpha, bgAlpha, expected }) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({
      kind: 'call', type: COLOR4, op: 'disjointover', args: [],
      namedArgs: {
        fg: builder.constant(COLOR4, [0.25, 0.5, 0.75, fgAlpha]),
        bg: builder.constant(COLOR4, [0.75, 0.5, 0.25, bgAlpha]),
      },
    });
    expect(evaluateIrRef(builder.build(), ref)).toEqual(expected);
  });

  it.each([
    { op: 'inside', amount: 0.25, expected: [0.125, -0.25, 0.5] },
    { op: 'outside', amount: 0.25, expected: [0.375, -0.75, 1.5] },
    { op: 'inside', amount: 1.5, expected: [0.75, -1.5, 3] },
    { op: 'outside', amount: 1.5, expected: [-0.25, 0.5, -1] },
  ])('applies $op mask $amount componentwise', ({ op, amount, expected }) => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(COLOR3, [0.5, -1, 2]);
    const mask = builder.constant(FLOAT, amount);
    const ref = builder.add({ kind: 'call', type: COLOR3, op, args: [input, mask] });
    builder.output({ name: 'result', type: COLOR3, ref });
    expect(evaluateIrRef(builder.build(), ref)).toEqual(expected);
    expect(emitWgsl(builder.build()).code).toContain(mask);
  });

  it.each(['inside', 'outside'])('uses the MaterialX default mask for %s', (op) => {
    const builder = new IrModuleBuilder();
    const input = builder.constant(FLOAT, -2);
    const ref = builder.add({ kind: 'call', type: FLOAT, op, args: [], namedArgs: { in: input } });
    expect(evaluateIrRef(builder.build(), ref)).toEqual([-2]);
  });

  it.each([
    { op: 'plus', expected: [1, 1, 0.7, 1.4] },
    { op: 'minus', expected: [0.5, -0.5, 0.3, -0.4] },
    { op: 'difference', expected: [0.5, 0.5, 0.3, 0.4] },
    { op: 'screen', expected: [0.8125, 0.8125, 0.6, 0.95] },
    { op: 'overlay', expected: [0.625, 0.375, 0.2, 0.9] },
    { op: 'burn', expected: [0, 0, -1.5, 4 / 9] },
    { op: 'dodge', expected: [1, 1, 0.625, 5] },
  ])('evaluates $op on float and color channels with named and positional inputs', ({ op, expected }) => {
    const fgValue = [0.25, 0.75, 0.2, 0.9];
    const bgValue = [0.75, 0.25, 0.5, 0.5];
    for (const [type, size] of [[FLOAT, 1], [COLOR3, 3], [COLOR4, 4]] as const) {
      for (const named of [false, true]) {
        for (const amount of [0, 0.25, 1, 1.5]) {
          const builder = new IrModuleBuilder();
          const fg = builder.constant(type, size === 1 ? fgValue[0]! : fgValue.slice(0, size));
          const bg = builder.constant(type, size === 1 ? bgValue[0]! : bgValue.slice(0, size));
          const t = builder.constant(FLOAT, amount);
          const ref = builder.add(named
            ? { kind: 'call', type, op, args: [], namedArgs: { fg, bg, mix: t } }
            : { kind: 'call', type, op, args: [fg, bg, t] });
          builder.output({ name: 'result', type, ref });
          const ir = builder.build();
          evaluateIrRef(ir, ref).forEach((value, i) =>
            expect(value).toBeCloseTo(bgValue[i]! * (1 - amount) + expected[i]! * amount, 10));
          const code = emitWgsl(ir).code;
          expect(code).toContain(`mix(${bg},`);
          if (op === 'overlay') expect(code).toContain(`${bg} < `);
        }
      }
    }
  });

  it.each([
    { op: 'burn', fg: [0, 0.000000001, 0.0000001, -0.5], expected: [0, 0, -2499999.25, 1.25] },
    { op: 'dodge', fg: [1, 1, 0, -1], expected: [0, 0, 0.5, 0.375] },
  ])('applies the MaterialX $op singularity rule before mixing', ({ op, fg: fgValue, expected }) => {
    const builder = new IrModuleBuilder();
    const fg = builder.constant(COLOR4, fgValue);
    const bg = builder.constant(COLOR4, [0.5, 0.5, 0.5, 0.5]);
    const amount = builder.constant(FLOAT, 0.5);
    const ref = builder.add({ kind: 'call', type: COLOR4, op, args: [fg, bg, amount] });
    builder.output({ name: 'result', type: COLOR4, ref });
    const ir = builder.build();
    evaluateIrRef(ir, ref).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 7));
    const code = emitWgsl(ir).code;
    expect(code).toContain('1e-8');
    expect(code).toContain('select(');
  });

  it.each([{ op: 'burn', fg: 0 }, { op: 'dodge', fg: 1 }])(
    'returns zero for singular $op even when mix is zero',
    ({ op, fg: foreground }) => {
      for (const named of [false, true]) {
        const builder = new IrModuleBuilder();
        const fg = builder.constant(FLOAT, foreground);
        const bg = builder.constant(FLOAT, 0.75);
        const amount = builder.constant(FLOAT, 0);
        const ref = builder.add(named
          ? { kind: 'call', type: FLOAT, op, args: [], namedArgs: { fg, bg, mix: amount } }
          : { kind: 'call', type: FLOAT, op, args: [fg, bg, amount] });
        builder.output({ name: 'result', type: FLOAT, ref });
        expect(evaluateIrRef(builder.build(), ref)).toEqual([0]);
      }
    },
  );

  it.each([
    { op: 'premult', input: [0.2, 0.4, 0.8, 0.5], expected: [0.1, 0.2, 0.4, 0.5] },
    { op: 'unpremult', input: [0.1, 0.2, 0.4, 0.5], expected: [0.2, 0.4, 0.8, 0.5] },
    { op: 'unpremult', input: [0.1, 0.2, 0.4, 0], expected: [0.1, 0.2, 0.4, 0] },
  ])('evaluates $op and preserves alpha', ({ op, input: inputValue, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const input = builder.constant(COLOR4, inputValue);
      const ref = builder.add(named
        ? { kind: 'call', type: COLOR4, op, args: [], namedArgs: { in: input } }
        : { kind: 'call', type: COLOR4, op, args: [input] });
      builder.output({ name: 'result', type: COLOR4, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual(expected);
      expect(emitWgsl(ir).code).toContain(`${input}.rgb`);
    }
  });

  it.each(['premult', 'unpremult'])('uses the NodeDef default input for %s', op => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind: 'call', type: COLOR4, op, args: [], namedArgs: {} });
    builder.output({ name: 'result', type: COLOR4, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([0, 0, 0, 1]);
    expect(emitWgsl(ir).code).toContain('vec4f(0.0, 0.0, 0.0, 1.0)');
  });

  it.each([
    { op: 'absval', expected: [1.25, 0, 2, 2.75] },
    { op: 'fract', expected: [0.75, 0, 0, 0.75] },
    { op: 'floor', expected: [-2, 0, 2, 2] },
    { op: 'ceil', expected: [-1, 0, 2, 3] },
  ])('evaluates $op componentwise on signed values', ({ op, expected }) => {
    const builder = new IrModuleBuilder();
    const type = vector(4);
    const input = builder.constant(type, [-1.25, 0, 2, 2.75]);
    const ref = builder.add({ kind: 'call', type, op, args: [], namedArgs: { in: input } });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual(expected);
    const code = emitWgsl(ir).code;
    expect(code).toContain(`${op === 'absval' ? 'abs' : op === 'fract' ? 'floor' : op}(`);
    if (op === 'fract') expect(code).toContain(`${input} - floor(${input})`);
  });

  it.each([
    { type: FLOAT, values: [-2], amount: [0.5], expected: [2.5] },
    { type: vector(2), values: [-2, 0.5], amount: [0.5], expected: [2.5, 0] },
    { type: COLOR3, values: [-2, 0, 0.5], amount: [0.5, 1, 2], expected: [2.5, 1, 1.5] },
    { type: COLOR4, values: [-2, 0, 0.5, 3], amount: [0.5], expected: [2.5, 0.5, 0, -2.5] },
  ])('evaluates invert with named and positional scalar or vector amounts', ({ type, values, amount, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const source = builder.constant(type, type.kind === 'scalar' ? values[0]! : values);
      const amountRef = builder.constant(amount.length === 1 ? FLOAT : type, amount.length === 1 ? amount[0]! : amount);
      const ref = builder.add(named
        ? { kind: 'call', type, op: 'invert', args: [], namedArgs: { in: source, amount: amountRef } }
        : { kind: 'call', type, op: 'invert', args: [source, amountRef] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual(expected);
      expect(emitWgsl(ir).code).toContain(`(${wgslType(type)}(${amountRef}) - ${source})`);
    }
  });

  it.each(['sign', 'invert'])('uses zero and the MaterialX defaults for %s without inputs', op => {
    const builder = new IrModuleBuilder();
    const type = vector(3);
    const ref = builder.add({ kind: 'call', type, op, args: [], namedArgs: {} });
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual(op === 'sign' ? [0, 0, 0] : [1, 1, 1]);
    expect(emitWgsl(ir).code).toContain(op === 'sign' ? 'sign(vec3f(0.0))' : '(vec3f(1.0) - vec3f(0.0))');
  });

  it('evaluates sign componentwise for negative, zero and positive values', () => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const source = builder.constant(COLOR3, [-3, 0, 0.25]);
      const ref = builder.add(named
        ? { kind: 'call', type: COLOR3, op: 'sign', args: [], namedArgs: { in: source } }
        : { kind: 'call', type: COLOR3, op: 'sign', args: [source] });
      builder.output({ name: 'result', type: COLOR3, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref)).toEqual([-1, 0, 1]);
      expect(emitWgsl(ir).code).toContain(`sign(${source})`);
    }
  });

  it.each([
    { op: 'floor', input: -2.01, expected: -3 },
    { op: 'floor', input: 2, expected: 2 },
    { op: 'ceil', input: -2.01, expected: -2 },
    { op: 'ceil', input: 2.01, expected: 3 },
  ])('emits integer $op for $input', ({ op, input, expected }) => {
    const builder = new IrModuleBuilder();
    const source = builder.constant(FLOAT, input);
    const ref = builder.add({ kind: 'call', type: INT, op, args: [source] });
    builder.output({ name: 'result', type: INT, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([expected]);
    expect(emitWgsl(ir).code).toContain(`i32(${op}(`);
  });

  it.each([false, true])('evaluates modulo with scalar and vector divisors (named: %s)', (named) => {
    const builder = new IrModuleBuilder();
    const type = vector(3);
    const a = builder.constant(type, [-5, 5, -4]);
    const scalar = builder.constant(FLOAT, 2);
    const vectorDivisor = builder.constant(type, [2, -2, 3]);
    for (const [b, expected] of [[scalar, [1, 1, 0]], [vectorDivisor, [1, -1, 2]]] as const) {
      const ref = builder.add(named
        ? { kind: 'call', type, op: 'modulo', args: [], namedArgs: { in1: a, in2: b } }
        : { kind: 'call', type, op: 'modulo', args: [a, b] });
      builder.output({ name: `result_${b}`, type, ref });
      expect(evaluateIrRef(builder.build(), ref)).toEqual(expected);
    }
    expect(emitWgsl(builder.build()).code).toContain('floor(');
  });

  it.each([
    { op: 'splitlr', uv: [0.24, 0.9], expected: [1, 2, 3, 4] },
    { op: 'splitlr', uv: [0.25, 0.1], expected: [5, 6, 7, 8] },
    { op: 'splitlr', uv: [0.8, 0.1], expected: [5, 6, 7, 8] },
    { op: 'splittb', uv: [0.9, 0.24], expected: [1, 2, 3, 4] },
    { op: 'splittb', uv: [0.1, 0.25], expected: [5, 6, 7, 8] },
    { op: 'splittb', uv: [0.1, 0.8], expected: [5, 6, 7, 8] },
  ])('evaluates $op on each side and at the boundary with named and positional arguments', ({ op, uv, expected }) => {
    for (const named of [false, true]) {
      const builder = new IrModuleBuilder();
      const type = vector(4);
      const low = builder.constant(type, [1, 2, 3, 4]);
      const high = builder.constant(type, [5, 6, 7, 8]);
      const center = builder.constant(FLOAT, 0.25);
      const texcoord = builder.constant(vector(2), uv);
      const first = op === 'splitlr' ? low : high;
      const second = op === 'splitlr' ? high : low;
      const namedArgs = op === 'splitlr'
        ? { valuel: first, valuer: second, center, texcoord }
        : { valuet: first, valueb: second, center, texcoord };
      const ref = builder.add(named
        ? { kind: 'call', type, op, args: [], namedArgs }
        : { kind: 'call', type, op, args: [first, second, center, texcoord] });
      builder.output({ name: 'result', type, ref });
      const ir = builder.build();
      expect(evaluateIrRef(ir, ref, { texcoord: [0, 0] })).toEqual(expected);
      expect(emitWgsl(ir).code).toContain(`mix(${low}, ${high}, step(${center}, ${texcoord}.${op === 'splitlr' ? 'x' : 'y'}))`);
    }
  });

  it.each(['splitlr', 'splittb'])('uses zero values, center 0.5 and geometric UV by default for %s', (op) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind: 'call', type: FLOAT, op, args: [], namedArgs: {} });
    builder.output({ name: 'result', type: FLOAT, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref, { texcoord: [0.8, 0.1] })).toEqual([0]);
    expect(emitWgsl(ir).code).toContain(`step(0.5, vary.texcoord.${op === 'splitlr' ? 'x' : 'y'})`);
    const first = builder.constant(FLOAT, 1);
    const second = builder.constant(FLOAT, 2);
    const namedArgs = op === 'splitlr' ? { valuel: first, valuer: second } : { valuet: first, valueb: second };
    const withValues = builder.add({ kind: 'call', type: FLOAT, op, args: [], namedArgs });
    expect(evaluateIrRef(builder.build(), withValues, { texcoord: [0.8, 0.1] })).toEqual([2]);
  });

  it.each([
    { type: FLOAT, low: [1], high: [2] },
    { type: vector(2), low: [1, 2], high: [3, 4] },
    { type: COLOR3, low: [1, 2, 3], high: [4, 5, 6] },
  ])('preserves $type output shapes in split masks', ({ type, low, high }) => {
    const builder = new IrModuleBuilder();
    const valuel = builder.constant(type, low.length === 1 ? low[0]! : low);
    const valuer = builder.constant(type, high.length === 1 ? high[0]! : high);
    const ref = builder.add({ kind: 'call', type, op: 'splitlr', args: [], namedArgs: { valuel, valuer } });
    expect(evaluateIrRef(builder.build(), ref, { texcoord: [0.1, 0.9] })).toEqual(low);
    expect(evaluateIrRef(builder.build(), ref, { texcoord: [0.9, 0.1] })).toEqual(high);
  });

  it.each([
    { op: 'ramplr', uv: [-1, 0.8], expected: [0, 2, 4] },
    { op: 'ramplr', uv: [0.25, 0.8], expected: [1, 3, 5] },
    { op: 'ramplr', uv: [2, 0.8], expected: [4, 6, 8] },
    { op: 'ramptb', uv: [0.8, -1], expected: [0, 2, 4] },
    { op: 'ramptb', uv: [0.8, 0.25], expected: [1, 3, 5] },
    { op: 'ramptb', uv: [0.8, 2], expected: [4, 6, 8] },
  ])('evaluates $op at UV $uv with clamped coordinates', ({ op, uv, expected }) => {
    const builder = new IrModuleBuilder();
    const start = builder.constant(COLOR3, [0, 2, 4]);
    const end = builder.constant(COLOR3, [4, 6, 8]);
    const namedArgs = op === 'ramplr' ? { valuel: start, valuer: end } : { valueb: start, valuet: end };
    const ref = builder.add({ kind: 'call', type: COLOR3, op, args: [], namedArgs });
    expect(evaluateIrRef(builder.build(), ref, { texcoord: uv })).toEqual(expected);
  });

  it.each([
    { uv: [0.25, 0.75], expected: [1, 3] },
    { uv: [-1, 2], expected: [0, 4] },
  ])('evaluates ramp4 bilinear interpolation at UV $uv', ({ uv, expected }) => {
    const builder = new IrModuleBuilder();
    const type = vector(2);
    const ref = builder.add({
      kind: 'call', type, op: 'ramp4', args: [],
      namedArgs: {
        valuetl: builder.constant(type, [0, 4]),
        valuetr: builder.constant(type, [4, 4]),
        valuebl: builder.constant(type, [0, 0]),
        valuebr: builder.constant(type, [4, 0]),
      },
    });
    expect(evaluateIrRef(builder.build(), ref, { texcoord: uv })).toEqual(expected);
  });

  it.each(['ramplr', 'ramptb', 'ramp4'])('uses zero-valued vector defaults for %s', (op) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind: 'call', type: vector(4), op, args: [], namedArgs: {} });
    expect(evaluateIrRef(builder.build(), ref, { texcoord: [0.2, 0.7] })).toEqual([0, 0, 0, 0]);
  });

  it.each([
    { uv: [0, 0], expected: [0, 0, 0] },
    { uv: [0.125, 0], expected: [1, 1, 1] },
    { uv: [-0.001, 0], expected: [1, 1, 1] },
    { uv: [-0.125, -0.125], expected: [0, 0, 0] },
  ])('evaluates checkerboard parity at UV $uv', ({ uv, expected }) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({ kind: 'call', type: COLOR3, op: 'checkerboard', args: [], namedArgs: {} });
    expect(evaluateIrRef(builder.build(), ref, { texcoord: uv })).toEqual(expected);
  });

  it('evaluates checkerboard colors, anisotropic tiling and offset', () => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({
      kind: 'call', type: COLOR3, op: 'checkerboard', args: [],
      namedArgs: {
        texcoord: builder.constant(vector(2), [0.25, 0.5]),
        uvtiling: builder.constant(vector(2), [4, 2]),
        uvoffset: builder.constant(vector(2), [1, 0]),
        color1: builder.constant(COLOR3, [0.1, 0.2, 0.3]),
        color2: builder.constant(COLOR3, [0.7, 0.8, 0.9]),
      },
    });
    expect(evaluateIrRef(builder.build(), ref)).toEqual([0.1, 0.2, 0.3]);
  });

  it.each([
    { op: 'circle', uv: [0.75, 0.5], center: [0.25, 0.5], radius: 0.5, expected: 1 },
    { op: 'circle', uv: [0.76, 0.5], center: [0.25, 0.5], radius: 0.5, expected: 0 },
    { op: 'cloverleaf', uv: [0.65, 0.5], center: [0.25, 0.5], radius: 0.5, expected: 1 },
    { op: 'cloverleaf', uv: [0.8, 0.5], center: [0.25, 0.5], radius: 0.5, expected: 0 },
    { op: 'cloverleaf', uv: [0.51, 0.76], center: [0.25, 0.5], radius: 0.5, expected: 0 },
  ])('evaluates $op at UV $uv with its translated center', ({ op, uv, center, radius, expected }) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({
      kind: 'call', type: FLOAT, op, args: [],
      namedArgs: {
        center: builder.constant(vector(2), center),
        radius: builder.constant(FLOAT, radius),
      },
    });
    builder.output({ name: 'shape', type: FLOAT, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref, { texcoord: uv })).toEqual([expected]);
    expect(emitWgsl(ir).code).toContain(op === 'circle' ? 'dot(' : 'mx_cloverleaf(');
  });

  it.each([
    { uv: [0.5, 0.125], a: [0, 0], b: [1, 0], radius: 0.125, expected: 1 },
    { uv: [1.5, 0.625], center: [1, 0.5], a: [0, 0], b: [1, 0], radius: 0.125, expected: 1 },
    { uv: [0.5, 0.126], a: [0, 0], b: [1, 0], radius: 0.125, expected: 0 },
    { uv: [1.125, 0], a: [0, 0], b: [1, 0], radius: 0.125, expected: 1 },
    { uv: [1.126, 0], a: [0, 0], b: [1, 0], radius: 0.125, expected: 0 },
    { uv: [0.375, 0.25], a: [0.25, 0.25], b: [0.25, 0.25], radius: 0.125, expected: 1 },
    { uv: [0.38, 0.25], a: [0.25, 0.25], b: [0.25, 0.25], radius: 0.125, expected: 0 },
    { uv: [0.5, 0], a: [0, 0], b: [1, 0], radius: -0.1, expected: 0 },
  ])('evaluates line segments and rounded ends at UV $uv', ({ uv, center, a, b, radius, expected }) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({
      kind: 'call', type: FLOAT, op: 'line', args: [],
      namedArgs: {
        texcoord: builder.constant(vector(2), uv),
        ...(center ? { center: builder.constant(vector(2), center) } : {}),
        point1: builder.constant(vector(2), a),
        point2: builder.constant(vector(2), b),
        radius: builder.constant(FLOAT, radius),
      },
    });
    builder.output({ name: 'shape', type: FLOAT, ref });
    const ir = builder.build();
    expect(evaluateIrRef(ir, ref)).toEqual([expected]);
    expect(emitWgsl(ir).code).toContain('mx_line(');
  });

  it.each([
    { texcoord: [0, 0], center: [0, 0], radius: 0.5, expected: 1 },
    { texcoord: [1, 0], center: [0, 0], radius: 0.5, expected: 0 },
    { texcoord: [1, 0], center: [1, 0], radius: 0.5, expected: 1 },
  ])('matches the MaterialX hexagon nodegraph for $texcoord', ({ texcoord, center, radius, expected }) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({
      kind: 'call', type: FLOAT, op: 'hexagon', args: [],
      namedArgs: {
        texcoord: builder.constant(vector(2), texcoord),
        center: builder.constant(vector(2), center),
        radius: builder.constant(FLOAT, radius),
      },
    });
    builder.output({ name: 'shape', type: FLOAT, ref });
    const ir = builder.build();

    expect(evaluateIrRef(ir, ref)).toEqual([expected]);
    expect(emitWgsl(ir).code).toContain('fn mx_hexagon(');
  });

  it.each([
    { type: FLOAT, value: 0.125, expected: [0.1346801, 0.4314369, 1] },
    { type: INT, value: 2, expected: [0.4544628, 0.0772700, 1] },
  ])('matches MaterialX randomcolor for $type.kind input and emits its WGSL helpers', ({ type, value, expected }) => {
    const builder = new IrModuleBuilder();
    const ref = builder.add({
      kind: 'call', type: COLOR3, op: 'randomcolor', args: [],
      namedArgs: {
        in: builder.constant(type, value),
        seed: builder.constant(INT, 5),
        huelow: builder.constant(FLOAT, 0),
        huehigh: builder.constant(FLOAT, 1),
        saturationlow: builder.constant(FLOAT, 0.825),
        saturationhigh: builder.constant(FLOAT, 1),
        brightnesslow: builder.constant(FLOAT, 1),
        brightnesshigh: builder.constant(FLOAT, 1),
      },
    });
    builder.output({ name: 'color', type: COLOR3, ref });
    const ir = builder.build();

    const result = evaluateIrRef(ir, ref);
    result.forEach((component, i) => expect(component).toBeCloseTo(expected[i]!, 5));
    const code = emitWgsl(ir).code;
    expect(code).toContain('mx_unified_hash');
    expect(code).toContain('mx_hsvtorgb');
    expect(code).toContain('413.3');
  });

  it.each([1, -1])('uses the supplied bitangent with handedness %i for normal maps', (sign) => {
    const builder = new IrModuleBuilder();
    const normal = builder.add({
      kind: 'call', type: vector(3), op: 'normalmap', args: [],
      namedArgs: {
        in: builder.constant(vector(3), [0.5, 1, 1]),
        scale: builder.constant(vector(2), [0.2, 0.5]),
      },
    });
    builder.output({ name: 'normal', type: vector(3), ref: normal });
    const ir = builder.build();
    const result = evaluateIrRef(ir, normal, { normal: [0, 0, 1], tangent: [1, 0, 0], bitangent: [0, sign, 0] });
    expect(result[0]).toBeCloseTo(0, 6);
    expect(result[1]).toBeCloseTo(sign * 0.5 / Math.hypot(0.5, 1), 6);
    expect(result[2]).toBeCloseTo(1 / Math.hypot(0.5, 1), 6);
    expect(emitWgsl(ir).code).toContain('vary.bitangent)');
  });

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

    expect(evaluateIrRef(ir, ref)).toEqual([0, 1, 1, 1]);
    const code = emitWgsl(ir).code;
    expect(code).toContain('select(');
    expect(code).toContain(`${input} >= vec4f(${high})`);
    expect(code).toContain(`${input} <= vec4f(${low})`);
  });

  it('prioritizes the high threshold for inverted smoothstep bounds in CPU and WGSL', () => {
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

    expect(evaluateIrRef(ir, ref)).toEqual([0, 1, 1, 1]);
    const code = emitWgsl(ir).code;
    expect(code).toContain(`${input} >= vec4f(${high})`);
    expect(code).toContain(`${input} <= vec4f(${low})`);
    expect(code).not.toContain('smoothstep(');
  });

  it.each([FLOAT, vector(2), COLOR3, vector(4)])('matches MaterialX smoothstep boundary priority for %j', (type) => {
    const size = type.kind === 'vector' ? type.size : 1;
    for (const [low, high, cases] of [
      [0.25, 0.75, [[0, 0], [0.25, 0], [0.375, 0.15625], [0.5, 0.5], [0.75, 1], [1, 1]]],
      [0.75, 0.25, [[0, 0], [0.249, 0], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]]],
      [0.5, 0.5, [[0, 0], [0.499, 0], [0.5, 1], [0.501, 1], [1, 1]]],
    ] as const) {
      for (const [x, expected] of cases) {
        const builder = new IrModuleBuilder();
        const input = builder.constant(type, size === 1 ? x : Array(size).fill(x));
        const lo = builder.constant(FLOAT, low);
        const hi = builder.constant(FLOAT, high);
        const ref = builder.add({ kind: 'call', type, op: 'smoothstep', args: [], namedArgs: { in: input, low: lo, high: hi } });
        builder.output({ name: 'out', type, ref });
        const ir = builder.build();
        expect(evaluateIrRef(ir, ref)).toEqual(Array(size).fill(expected));
        expect(emitWgsl(ir).code).toContain('select(');
      }
    }
  });

  it('preserves the white upper band of the inverted vector4 debug material', () => {
    const builder = new IrModuleBuilder();
    const type = vector(4);
    const input = builder.add({ kind: 'primvar', type, name: 'step_in' });
    const low = builder.constant(type, [0.75, 0.8, 0.9, 0.95]);
    const high = builder.constant(type, [0.25, 0.2, 0.1, 0.05]);
    const step = builder.add({ kind: 'call', type, op: 'smoothstep', args: [], namedArgs: { in: input, low, high } });
    const color = builder.add({ kind: 'swizzle', type: COLOR3, source: step, pattern: 'xyw' });
    const ir = builder.build();
    const sample = (u: number, v: number) => evaluateIrRef(ir, color, { primvars: { step_in: [u, v, 0.25, 0.75] } });
    expect(sample(0.5, 0.21)).toEqual([1, 1, 1]);
    expect(sample(0.5, 0.19)).toEqual([1, 0, 1]);
    expect(sample(0.1, 0.19)).toEqual([0, 0, 1]);
    expect(sample(0.1, 0.21)).toEqual([0, 1, 1]);
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

  it.each([
    { from: BOOL, to: FLOAT, value: true, expected: [1] },
    { from: BOOL, to: INT, value: false, expected: [0] },
    { from: BOOL, to: COLOR3, value: true, expected: [1, 1, 1] },
    { from: BOOL, to: COLOR4, value: false, expected: [0, 0, 0, 0] },
    { from: INT, to: BOOL, value: -2, expected: [1] },
    { from: INT, to: BOOL, value: 0, expected: [0] },
    { from: INT, to: COLOR4, value: -2, expected: [-2, -2, -2, -2] },
    { from: FLOAT, to: INT, value: -1.7, expected: [-1] },
    { from: vector(2), to: COLOR4, value: [0.2, 0.4], expected: [0.2, 0.4, 0, 1] },
    { from: COLOR3, to: vector(2), value: [0.2, 0.4, 0.6], expected: [0.2, 0.4] },
    { from: vector(3), to: vector(4), value: [0.2, 0.4, 0.6], expected: [0.2, 0.4, 0.6, 1] },
    { from: vector(4), to: vector(2), value: [0.2, 0.4, 0.6, 0.8], expected: [0.2, 0.4] },
  ])('evaluates scalar and channel conversions', ({ from, to, value, expected }) => {
    const b = new IrModuleBuilder();
    const input = b.constant(from, value);
    const result = b.add({ kind: 'convert', type: to, source: input, from });
    expect(evaluateIrRef(b.build(), result)).toEqual(expected);
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
