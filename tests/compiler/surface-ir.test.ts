// T055c: lowerSurfaceInputsToIr (src/compiler/surface-ir.ts) lowers a resolved
// surface's inputs into shader IR, so textured/procedural inputs emit their node
// sub-graph into the generated WGSL while literal inputs become baked constants.
// These tests build a multi-node ResolvedGraph as plain data, run resolveSurface,
// lower the inputs, declare outputs for the refs under test, then emit WGSL and
// assert on the generated module.

import { describe, it, expect } from 'vitest';
import type {
  ResolvedGraph,
  ResolvedInput,
  ResolvedNode,
  ResolvedValueSource,
} from '../../src/materialx/graph.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import { lowerSurfaceInputsToIr } from '../../src/compiler/surface-ir.ts';
import { IrModuleBuilder, BOOL, COLOR3, FLOAT, INT, vector, type IrRef } from '../../src/compiler/ir.ts';
import { emitWgsl, lowerExprs, type WgslModule } from '../../src/compiler/wgsl.ts';
import { evaluateShaderIr } from '../../src/compiler/ir-eval.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { createImageSampler } from '../../src/render/pathtracing/texture-sample.ts';

function value(name: string, type: string, raw: string, colorSpace?: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return colorSpace !== undefined
    ? { name, type, source, colorSpace, provenance: { namePath: `/mat/${name}` } }
    : { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

function conn(name: string, type: string, nodeId: string, output?: string): ResolvedInput {
  return { name, type, source: { kind: 'connection', nodeId, ...(output ? { output } : {}) }, provenance: { namePath: `/mat/${name}` } };
}

function upstream(id: string, category: string, type: string, inputs: ResolvedInput[]): ResolvedNode {
  return { id, category, type, inputs, provenance: { namePath: `/mat/${id}` } };
}

function surfaceGraph(
  surfaceInputs: ResolvedInput[],
  upstreamNodes: ResolvedNode[],
  category = 'standard_surface',
): ResolvedGraph {
  const surfaceId = 'SR';
  const surface: ResolvedNode = {
    id: surfaceId,
    category,
    type: 'surfaceshader',
    nodeDef: {
      name: `ND_${category}`,
      nodeString: category,
      type: 'surfaceshader',
      implementation: { kind: 'nodegraph', name: `NG_${category}` },
    },
    inputs: surfaceInputs,
    provenance: { namePath: `/mat/${surfaceId}` },
  };
  const nodes = new Map<string, ResolvedNode>([[surfaceId, surface]]);
  for (const n of upstreamNodes) nodes.set(n.id, n);
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: surfaceId, provenance: { namePath: `/mat/${surfaceId}` } }],
    nodes,
  };
}

interface Lowered {
  module: WgslModule;
  ir: ReturnType<IrModuleBuilder['build']>;
  refFor: (name: string) => IrRef;
}

function lowerAndEmit(
  graph: ResolvedGraph,
  outputs: readonly { name: string; type: typeof BOOL | typeof COLOR3 | typeof FLOAT | typeof INT }[],
  sink?: (d: Diagnostic) => void,
): Lowered {
  const resolved = resolveSurface(graph, sink ? { onDiagnostic: sink } : {});
  expect(resolved).not.toBeNull();
  const builder = new IrModuleBuilder();
  const lowered = lowerSurfaceInputsToIr(graph, resolved!, builder, sink);
  const refFor = (name: string): IrRef => {
    const ref = lowered.inputs.get(name);
    expect(ref, name).toBeDefined();
    return ref!;
  };
  for (const o of outputs) builder.output({ name: o.name, type: o.type, ref: refFor(o.name) });
  const ir = builder.build();
  return { module: emitWgsl(ir), ir, refFor };
}

describe('lowerSurfaceInputsToIr (T055c)', () => {
  it.each([
    { op: 'separate2', type: 'vector2', values: '0.2,0.7', output: 'outy', expected: 0.7 },
    { op: 'separate3', type: 'color3', values: '0.2,0.7,0.9', output: 'outb', expected: 0.9 },
    { op: 'separate4', type: 'color4', values: '0.2,0.7,0.9,0.4', output: 'outa', expected: 0.4 },
  ])('recognizes $op directly connected to a surface input', ({ op, type, values, output, expected }) => {
    const graph = surfaceGraph([conn('base', 'float', 'split', output)], [
      upstream('split', op, 'multioutput', [value('in', type, values)]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([expected]);
  });

  it('uses the declared separate4 input default for its alpha output', () => {
    const node = upstream('split', 'separate4', 'multioutput', []);
    node.nodeDef = {
      name: 'ND_separate4_color4', nodeString: 'separate4', type: 'multioutput',
      inputs: [{ name: 'in', type: 'color4', value: '0.1,0.2,0.3,0.4' }],
      implementation: { kind: 'nodegraph', name: 'NG_separate4_color4' },
    };
    const graph = surfaceGraph([conn('base', 'float', 'split', 'outa')], [node]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([0.4]);
  });

  it('diagnoses an invalid separate output instead of generating an invalid swizzle', () => {
    const graph = surfaceGraph([conn('base', 'float', 'split', 'outw')], [
      upstream('split', 'separate2', 'multioutput', [value('in', 'vector2', '0.2,0.7')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics.some(d => d.message.includes("Unsupported separate2 output 'outw'"))).toBe(true);
    expect(evaluateShaderIr(ir).get('base')).toEqual([0]);
  });

  it('preserves combine2 mixed inputs and their NodeDef defaults through extract', () => {
    const combine = upstream('combined', 'combine2', 'color4', [value('in1', 'color3', '0.1,0.2,0.3')]);
    combine.nodeDef = {
      name: 'ND_combine2_color4CF', nodeString: 'combine2', type: 'color4',
      inputs: [{ name: 'in1', type: 'color3', value: '0,0,0' }, { name: 'in2', type: 'float', value: '0.4' }],
      implementation: { kind: 'sourcecode' },
    };
    const graph = surfaceGraph([conn('base', 'float', 'channel')], [
      combine, upstream('channel', 'extract', 'float', [
        conn('in', 'color4', 'combined'), value('index', 'integer', '3'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([0.4]);
    expect(module.code).toMatch(/vec4f\(e\d+, e\d+\)/);
  });

  it('extracts a matrix column through a surface graph', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'column')], [
      upstream('column', 'extract', 'vector3', [
        value('in', 'matrix33', '1,2,3,4,5,6,7,8,9'), value('index', 'integer', '1'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base_color')).toEqual([4, 5, 6]);
  });

  it('reports swizzle nodes as unsupported by surface lowering', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'channel')], [
      upstream('channel', 'swizzle', 'color3', []),
    ]);
    const diagnostics: Diagnostic[] = [];
    resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    expect(diagnostics.some(d => d.message.includes("unsupported node 'swizzle'"))).toBe(true);
  });

  it.each([
    { op: 'sqrt', inputs: [value('in', 'float', '0.25')], expected: 0.5 },
    { op: 'ln', inputs: [value('in', 'float', '1')], expected: 0 },
    { op: 'exp', inputs: [value('in', 'float', '0')], expected: 1 },
    { op: 'power', inputs: [value('in1', 'float', '0.5'), value('in2', 'float', '2')], expected: 0.25 },
    { op: 'safepower', inputs: [value('in1', 'float', '-0.5'), value('in2', 'float', '2')], expected: -0.25 },
  ])('recognizes $op directly connected to a surface input', ({ op, inputs, expected }) => {
    const graph = surfaceGraph([conn('base', 'float', 'math')], [
      upstream('math', op, 'float', inputs),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([expected]);
  });

  it.each([
    { op: 'power', values: '0.25,1,4', expected: [0.5, 1, 2] },
    { op: 'safepower', values: '-4,-1,4', expected: [-2, -1, 2] },
  ])('uses the connected color and NodeDef scalar exponent for $op', ({ op, values, expected }) => {
    const node = upstream('math', op, 'color3', [conn('in1', 'color3', 'source')]);
    node.nodeDef = {
      name: `ND_${op}_color3FA`, nodeString: op, type: 'color3',
      inputs: [
        { name: 'in1', type: 'color3', value: '0,0,0' },
        { name: 'in2', type: 'float', value: '0.5' },
      ],
      implementation: op === 'safepower'
        ? { kind: 'nodegraph', name: 'NG_safepower_color3FA' }
        : { kind: 'sourcecode' },
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'math')], [
      node, upstream('source', 'constant', 'color3', [value('value', 'color3', values)]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base_color')).toEqual(expected);
    expect(module.code).toContain('pow(');
  });

  it.each([
    { op: 'smoothstep', inputs: [value('in', 'color3', '0,0.5,1'), value('low', 'float', '0.75'), value('high', 'float', '0.25')], expected: [0, 1, 1] },
    { op: 'remap', inputs: [value('in', 'color3', '0,0.5,1.5'), value('inlow', 'float', '0.25'), value('inhigh', 'float', '0.75'), value('outhigh', 'float', '2')], expected: [-1, 1, 5] },
  ])('recognizes $op directly connected to a color surface input', ({ op, inputs, expected }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'adjust')], [
      upstream('adjust', op, 'color3', inputs),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base_color')).toEqual(expected);
  });

  it('uses the NodeDef scalar defaults and connected inputs in an adjustment chain', () => {
    const remap = upstream('adjust', 'remap', 'color3', [
      conn('in', 'color3', 'source'), value('inhigh', 'float', '0.75'),
    ]);
    remap.nodeDef = {
      name: 'ND_remap_color3FA', nodeString: 'remap', type: 'color3',
      inputs: [
        { name: 'in', type: 'color3', value: '0,0,0' },
        { name: 'inlow', type: 'float', value: '0.25' },
        { name: 'inhigh', type: 'float', value: '1' },
        { name: 'outlow', type: 'float', value: '0' },
        { name: 'outhigh', type: 'float', value: '1' },
      ],
      implementation: { kind: 'sourcecode' },
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'adjust')], [
      remap, upstream('source', 'constant', 'color3', [value('value', 'color3', '0.25,0.5,0.75')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base_color')).toEqual([0, 0.5, 1]);
  });

  it('uses connected per-channel mix weights in a surface graph', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'blend')], [
      upstream('blend', 'mix', 'color3', [
        value('fg', 'color3', '1,0.2,0'), value('bg', 'color3', '0,0.6,1'),
        conn('mix', 'color3', 'weights'),
      ]),
      upstream('weights', 'constant', 'color3', [value('value', 'color3', '0,0.5,1')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base_color')).toEqual([0, 0.4, 0]);
    expect(module.code).toContain('mix(');
  });

  it.each([
    { op: 'dotproduct', inputs: [value('in1', 'vector3', '1,2,3'), value('in2', 'vector3', '3,2,1')], expected: 10 },
    { op: 'magnitude', inputs: [value('in', 'vector3', '0,3,4')], expected: 5 },
  ])('recognizes $op directly connected to a scalar surface input', ({ op, inputs, expected }) => {
    const graph = surfaceGraph([conn('base', 'float', 'vectorOp')], [
      upstream('vectorOp', op, 'float', inputs),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([expected]);
  });

  it.each([
    { op: 'normalize', inputs: [value('in', 'vector3', '0,3,4')], expected: [0, 0.6, 0.8] },
    { op: 'reflect', inputs: [value('in', 'vector3', '0.6,-0.8,0')], expected: [0.6, 0.8, 0] },
    { op: 'refract', inputs: [value('in', 'vector3', '0.6,-0.8,0'), value('ior', 'float', '0.5')], expected: [0.3, -Math.sqrt(0.91), 0] },
  ])('evaluates $op connected to a surface normal', ({ op, inputs, expected }) => {
    const graph = surfaceGraph([conn('normal', 'vector3', 'vectorOp')], [
      upstream('vectorOp', op, 'vector3', inputs),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'normal', type: vector(3) }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(ir, { normal: [0, 1, 0] }).get('normal')!.forEach((actual, i) =>
      expect(actual).toBeCloseTo(expected[i]!, 12));
  });

  it('uses the reflection NodeDef incident default and varying normal', () => {
    const node = upstream('reflection', 'reflect', 'vector3', []);
    node.nodeDef = {
      name: 'ND_reflect_vector3', nodeString: 'reflect', type: 'vector3',
      inputs: [
        { name: 'in', type: 'vector3', value: '1,0,0' },
        { name: 'normal', type: 'vector3', geomprop: 'Nworld' },
      ],
      implementation: { kind: 'nodegraph', name: 'NG_reflect_vector3' },
    };
    const graph = surfaceGraph([conn('normal', 'vector3', 'reflection')], [node]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'normal', type: vector(3) }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir, { normal: [1, 0, 0] }).get('normal')).toEqual([-1, 0, 0]);
    expect(module.code).toContain('vary.normal');
  });

  it.each([
    { op: 'ifequal', value1: '1', value2: '1', expected: 0.25 },
    { op: 'ifgreater', value1: '1', value2: '1', expected: 0.75 },
    { op: 'ifgreatereq', value1: '1', value2: '1', expected: 0.25 },
  ])('recognizes $op directly connected to a surface input', ({ op, value1, value2, expected }) => {
    const graph = surfaceGraph([conn('base', 'float', 'condition')], [
      upstream('condition', op, 'float', [
        value('value1', 'float', value1), value('value2', 'float', value2),
        value('in1', 'float', '0.25'), value('in2', 'float', '0.75'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([expected]);
    expect(module.code).toContain('select(');
  });

  it('uses the selected missing switch input rather than clamping to the authored inputs', () => {
    const node = upstream('pick', 'switch', 'float', [
      value('in1', 'float', '0.8'), value('which', 'integer', '3'),
    ]);
    node.nodeDef = {
      name: 'ND_switch_floatI', nodeString: 'switch', type: 'float',
      inputs: [
        ...Array.from({ length: 10 }, (_, i) => ({ name: `in${i + 1}`, type: 'float', value: '0.0' })),
        { name: 'which', type: 'integer', value: '0' },
      ],
      implementation: { kind: 'nodegraph', name: 'NG_switch_floatI' },
    };
    const graph = surfaceGraph([conn('base', 'float', 'pick')], [node]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([0]);
  });

  it.each([
    { op: 'and', result: 0 },
    { op: 'or', result: 1 },
    { op: 'xor', result: 1 },
    { op: 'not', result: 0 },
  ])('recognizes $op directly connected to a boolean surface input', ({ op, result }) => {
    const graph = surfaceGraph([conn('thin_walled', 'boolean', 'logic')], [
      upstream('logic', op, 'boolean', op === 'not'
        ? [value('in', 'boolean', 'true')]
        : [value('in1', 'boolean', 'true'), value('in2', 'boolean', 'false')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'thin_walled', type: BOOL }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('thin_walled')).toEqual([result]);
  });

  it.each([
    { first: 'true', second: 'false', expected: 0 },
    { first: 'false', second: 'true', expected: 1 },
  ])('evaluates connected logical nodes in a surface graph', ({ first, second, expected }) => {
    const graph = surfaceGraph([conn('base', 'float', 'number')], [
      upstream('a', 'constant', 'boolean', [value('value', 'boolean', first)]),
      upstream('b', 'constant', 'boolean', [value('value', 'boolean', second)]),
      upstream('not', 'not', 'boolean', [conn('in', 'boolean', 'b')]),
      upstream('and', 'and', 'boolean', [conn('in1', 'boolean', 'a'), conn('in2', 'boolean', 'not')]),
      upstream('or', 'or', 'boolean', [conn('in1', 'boolean', 'a'), conn('in2', 'boolean', 'b')]),
      upstream('xor', 'xor', 'boolean', [conn('in1', 'boolean', 'and'), conn('in2', 'boolean', 'or')]),
      upstream('number', 'convert', 'float', [conn('in', 'boolean', 'xor')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([expected]);
    expect(module.code).toMatch(/!\s*e\d+/);
    for (const operator of ['&&', '||', '!=']) expect(module.code).toContain(operator);
  });

  it('uses the NodeDef boolean default for a missing logical input', () => {
    const node = upstream('flag', 'not', 'boolean', []);
    node.nodeDef = {
      name: 'ND_logical_not', nodeString: 'not', type: 'boolean',
      inputs: [{ name: 'in', type: 'boolean', value: 'false' }],
      implementation: { kind: 'sourcecode' },
    };
    const graph = surfaceGraph([conn('base', 'float', 'number')], [
      node, upstream('number', 'convert', 'float', [conn('in', 'boolean', 'flag')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([1]);
    expect(module.code).toContain('false');
  });

  it.each([
    ['sin', 0.5, Math.sin(0.5)],
    ['cos', 0.5, Math.cos(0.5)],
    ['tan', 0.5, Math.tan(0.5)],
    ['asin', -0.5, Math.asin(-0.5)],
    ['acos', -0.5, Math.acos(-0.5)],
  ])('evaluates scalar %s in a surface graph', (category, argument, expected) => {
    const graph = surfaceGraph([conn('base', 'float', 'trig')], [
      upstream('trig', category, 'float', [value('in', 'float', String(argument))]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const { ir, module } = lowerAndEmit(graph, [{ name: 'base', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')![0]).toBeCloseTo(expected, 12);
    expect(module.code).toContain(`${category}(`);
  });

  it('evaluates a connected vector cosine on all components', () => {
    const graph = surfaceGraph([conn('normal', 'vector3', 'cosine')], [
      upstream('cosine', 'cos', 'vector3', [conn('in', 'vector3', 'angles')]),
      upstream('angles', 'constant', 'vector3', [value('value', 'vector3', '0,1,-1')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) })!;
    const lowered = lowerSurfaceInputsToIr(graph, surface, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: vector(3, 'float', 'vector'), ref: lowered.inputs.get('normal')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(ir).get('result')!.forEach((actual, i) =>
      expect(actual).toBeCloseTo([1, Math.cos(1), Math.cos(-1)][i]!, 12));
    expect(emitWgsl(ir).code).toContain('cos(');
  });

  it('evaluates vector atan2 with a connected input and declared defaults', () => {
    const trig = upstream('trig', 'atan2', 'vector3', [
      conn('iny', 'vector3', 'coords'),
    ]);
    trig.nodeDef = {
      name: 'ND_atan2_vector3', nodeString: 'atan2', type: 'vector3',
      inputs: [
        { name: 'iny', type: 'vector3', value: '0,0,0' },
        { name: 'inx', type: 'vector3', value: '1,1,1' },
      ],
      implementation: { kind: 'sourcecode' },
    };
    const graph = surfaceGraph([conn('normal', 'vector3', 'trig')], [
      trig, upstream('coords', 'constant', 'vector3', [value('value', 'vector3', '-1,0,1')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) })!;
    const lowered = lowerSurfaceInputsToIr(graph, surface, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: vector(3, 'float', 'vector'), ref: lowered.inputs.get('normal')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(ir).get('result')!.forEach((actual, i) =>
      expect(actual).toBeCloseTo([-Math.PI / 4, 0, Math.PI / 4][i]!, 12));
    expect(emitWgsl(ir).code).toContain('atan2(');
  });

  it.each([
    {
      input: 'base_color',
      surfaceType: 'color3',
      nodeType: 'color3',
      nodeInput: value('in', 'color3', '-1.6, 0.2, 1.8'),
      outputType: COLOR3,
      expected: [-2, 0, 2],
    },
    {
      input: 'alpha_mode',
      surfaceType: 'integer',
      nodeType: 'integer',
      nodeInput: value('in', 'float', '3.7'),
      outputType: INT,
      expected: [4],
    },
  ])('lowers round to the $nodeType surface output', ({ input, surfaceType, nodeType, nodeInput, outputType, expected }) => {
    const graph = surfaceGraph(
      [conn(input, surfaceType, 'rounded')],
      [upstream('rounded', 'round', nodeType, [nodeInput])],
      nodeType === 'integer' ? 'gltf_pbr' : 'standard_surface',
    );
    const { ir, module } = lowerAndEmit(graph, [{ name: input, type: outputType }]);
    expect(evaluateShaderIr(ir).get(input)).toEqual(expected);
    expect(module.code).toContain(nodeType === 'integer' ? 'i32(round(' : 'round(');
  });

  it.each([
    {
      category: 'crossproduct',
      surfaceInput: 'normal',
      surfaceType: 'vector3',
      nodeType: 'vector3',
      inputs: [value('in1', 'vector3', '1,2,3'), value('in2', 'vector3', '4,5,6')],
      expected: [-3, 6, -3],
    },
    {
      category: 'distance',
      surfaceInput: 'metalness',
      surfaceType: 'float',
      nodeType: 'float',
      inputs: [value('in1', 'vector3', '1,2,2'), value('in2', 'vector3', '4,6,5')],
      expected: [Math.sqrt(34)],
    },
  ])('lowers the $category vector operation in a surface graph', ({ category, surfaceInput, surfaceType, nodeType, inputs, expected }) => {
    const graph = surfaceGraph(
      [conn(surfaceInput, surfaceType, 'operation')],
      [upstream('operation', category, nodeType, inputs)],
    );
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: diagnostic => diagnostics.push(diagnostic) })!;
    const lowered = lowerSurfaceInputsToIr(graph, surface, builder, diagnostic => diagnostics.push(diagnostic));
    const type = surfaceType === 'float' ? FLOAT : vector(3, 'float', 'vector');
    builder.output({ name: 'result', type, ref: lowered.inputs.get(surfaceInput)! });
    const ir = builder.build();

    expect(diagnostics).toEqual([]);
    const result = evaluateShaderIr(ir).get('result')!;
    result.forEach((component, index) => expect(component).toBeCloseTo(expected[index]!, 12));
    expect(emitWgsl(ir).code).toContain(category === 'crossproduct' ? 'cross(' : 'distance(');
  });

  it('lowers blur as the stdlib pass-through and warns when a blur size is requested', () => {
    const blurNode = upstream('blur', 'blur', 'color3', [
      value('in', 'color3', '0.2, 0.4, 0.6'),
      value('size', 'float', '0.25'),
      value('filtertype', 'string', 'gaussian'),
    ]);
    blurNode.nodeDef = {
      name: 'ND_blur_color3',
      nodeString: 'blur',
      type: 'color3',
      inputs: [
        { name: 'in', type: 'color3', value: '0, 0, 0' },
        { name: 'size', type: 'float', value: '0' },
        { name: 'filtertype', type: 'string', value: 'box' },
      ],
      implementation: { kind: 'nodegraph', name: 'NG_blur_color3' },
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'blur')], [blurNode]);
    const diagnostics: Diagnostic[] = [];
    const { ir } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], d => diagnostics.push(d));

    expect(evaluateShaderIr(ir).get('base_color')).toEqual([0.2, 0.4, 0.6]);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      level: 'warning',
      message: expect.stringContaining('pass-through implementation'),
    }));
  });

  it.each([
    {
      uv: '0.13, 0.27', size: '0.1', roughness: '0.5', coverage: '1',
      expected: [13538935, 0.806983470916748, 0.7175992727279663, -0.09195718169212341, 0.7116554975509644, 0.6964842081069946],
    },
    {
      uv: '0.75, -1.25', size: '0.3', roughness: '0.3', coverage: '1',
      expected: [13265866, 0.7907072901725769, 0.8059425354003906, 0.03592246398329735, 0.02156495675444603, 0.999121904373169],
    },
    { uv: '0, 0', size: '0.01', roughness: '0.1', coverage: '0', expected: [0, 0, 0, 0, 0, 1] },
  ])('evaluates the four flake2d outputs at UV $uv', ({ uv, size, roughness, coverage, expected }) => {
    const graph = surfaceGraph([
      conn('specular', 'float', 'flake', 'id'),
      conn('metalness', 'float', 'flake', 'rand'),
      conn('base', 'float', 'flake', 'presence'),
      conn('base_color', 'color3', 'flake', 'flakenormal'),
    ], [upstream('flake', 'flake2d', 'multioutput', [
      value('texcoord', 'vector2', uv), value('size', 'float', size),
      value('roughness', 'float', roughness), value('coverage', 'float', coverage),
    ])]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    for (const [name, type] of [['specular', FLOAT], ['metalness', FLOAT], ['base', FLOAT], ['base_color', COLOR3]] as const) {
      builder.output({ name, type, ref: lowered.inputs.get(name)! });
    }
    const ir = builder.build();
    const outputs = evaluateShaderIr(ir, { normal: [0, 0, 1], tangent: [1, 0, 0], bitangent: [0, 1, 0] });
    const actual = [outputs.get('specular')![0]!, outputs.get('metalness')![0]!, outputs.get('base')![0]!, ...outputs.get('base_color')!];
    expect(diagnostics).toEqual([]);
    expect(actual[0]).toBe(expected[0]);
    actual.slice(1).forEach((component, i) => expect(component).toBeCloseTo(expected[i + 1]!, 5));
    for (const stage of [false, true]) {
      const code = lowerExprs(ir, '', stage).body.join('\n');
      expect(code).toContain('.id');
      expect(code).toContain('.rand');
      expect(code).toContain('.presence');
      expect(code).toContain('.normal');
    }
    expect(emitWgsl(ir).code).toContain('fn mx_flake2d(');
  });

  it('uses the geometric UV and connected tangent frame for flake2d', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'flake', 'flakenormal')], [
      upstream('flake', 'flake2d', 'multioutput', [
        value('size', 'float', '0.1'), value('roughness', 'float', '0.5'), value('coverage', 'float', '1'),
        conn('normal', 'vector3', 'normal'), conn('tangent', 'vector3', 'tangent'), conn('bitangent', 'vector3', 'bitangent'),
      ]),
      upstream('normal', 'constant', 'vector3', [value('value', 'vector3', '0, 1, 0')]),
      upstream('tangent', 'constant', 'vector3', [value('value', 'vector3', '0, 0, 1')]),
      upstream('bitangent', 'constant', 'vector3', [value('value', 'vector3', '1, 0, 0')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'normal', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const result = evaluateShaderIr(builder.build(), { texcoord: [0.13, 0.27] }).get('normal')!;
    const expected = [0.7116554975509644, 0.6964842081069946, -0.09195718169212341];
    result.forEach((component, i) => expect(component).toBeCloseTo(expected[i]!, 5));
  });

  it('diagnoses an unspecified flake2d output instead of selecting one silently', () => {
    const graph = surfaceGraph([conn('base', 'float', 'flake')], [upstream('flake', 'flake2d', 'multioutput', [])]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'base', type: FLOAT, ref: lowered.inputs.get('base')! });
    expect(evaluateShaderIr(builder.build()).get('base')).toEqual([0]);
    expect(diagnostics.some(d => d.message.includes("Unsupported flake2d output '<unspecified>'"))).toBe(true);
  });

  it('diagnoses a zero flake size once and rejects CPU evaluation', () => {
    const graph = surfaceGraph([
      conn('base', 'float', 'flake', 'presence'),
      conn('metalness', 'float', 'flake', 'rand'),
    ], [upstream('flake', 'flake2d', 'multioutput', [value('size', 'float', '0')])]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'base', type: FLOAT, ref: lowered.inputs.get('base')! });
    expect(diagnostics.filter(d => d.message.includes('requires a finite, nonzero size'))).toHaveLength(1);
    expect(() => evaluateShaderIr(builder.build())).toThrow('flake2d size must be finite and nonzero');
  });

  it('evaluates integer randomfloat inputs in a surface graph', () => {
    const graph = surfaceGraph([conn('base', 'float', 'random')], [
      upstream('random', 'randomfloat', 'float', [
        value('in', 'integer', '2'),
        value('min', 'float', '-1'),
        value('max', 'float', '3'),
        value('seed', 'integer', '5'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: FLOAT, ref: lowered.inputs.get('base')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('result')![0]).toBeCloseTo(1.4443359375, 7);
    expect(emitWgsl(ir).code).toContain('mx_cellnoise2(');
  });

  it('evaluates a connected HSV and saturation adjustment graph', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'saturation')], [
      upstream('saturation', 'saturate', 'color3', [
        conn('in', 'color3', 'hsv'),
        value('amount', 'float', '0'),
        value('lumacoeffs', 'color3', '0, 0, 1'),
      ]),
      upstream('hsv', 'hsvadjust', 'color3', [
        value('in', 'color3', '1, 0, 0'),
        value('amount', 'vector3', '-0.3333333333333333, 1, 1'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(ir).get('result')!.forEach(component => expect(component).toBeCloseTo(1, 10));
    expect(emitWgsl(ir).code).toContain('mx_hsvadjust(');
  });

  it('lowers connected compositing nodes without unsupported diagnostics', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'overlay')], [
      upstream('overlay', 'overlay', 'color3', [
        value('fg', 'color3', '0.25, 0.75, 0.2'),
        value('bg', 'color3', '0.75, 0.25, 0.5'),
        value('mix', 'float', '0.5'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(ir).get('result')!.forEach((component, i) =>
      expect(component).toBeCloseTo([0.6875, 0.3125, 0.35][i]!, 10));
    expect(emitWgsl(ir).code).toContain('select(');
  });

  it('lowers matrix construction and transforms as a connected surface graph', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'convert')], [
      upstream('convert', 'convert', 'color3', [conn('in', 'vector3', 'transform')]),
      upstream('transform', 'transformmatrix', 'vector3', [
        value('in', 'vector3', '2, 3, 4'),
        conn('mat', 'matrix33', 'matrix'),
      ]),
      upstream('matrix', 'creatematrix', 'matrix33', [
        value('in1', 'vector3', '2, 0, 0'),
        value('in2', 'vector3', '0, 3, 0'),
        value('in3', 'vector3', '0, 0, 4'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('result')).toEqual([4, 9, 16]);
    const code = emitWgsl(ir).code;
    expect(code).toContain('mat3x3f(');
    expect(code).toContain('(e5 * e1)');
  });

  it('lowers connected explicit color transforms without treating them as texture colorspaces', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'convert')], [
      upstream('convert', 'convert', 'color3', [conn('in', 'color4', 'transform')]),
      upstream('transform', 'srgb_displayp3_to_lin_rec709', 'color4', [
        conn('in', 'color4', 'source'),
      ]),
      upstream('source', 'constant', 'color4', [value('value', 'color4', '1, 0, 0, 0.37')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(ir).get('result')!.forEach((component, i) =>
      expect(component).toBeCloseTo([1.22493029, -0.04205868, -0.01964128][i]!, 8));
    const code = emitWgsl(ir).code;
    expect(code).toContain('mx_cmlib_srgb_to_linear(');
    expect(code).toContain('mat3x3f(');
  });

  it('uses the color4 NodeDef default when a transform input is unconnected', () => {
    const transform = upstream('transform', 'acescg_to_lin_rec709', 'color4', []);
    transform.nodeDef = {
      name: 'ND_acescg_to_lin_rec709_color4', nodeString: 'acescg_to_lin_rec709', type: 'color4',
      implementation: { kind: 'nodegraph', name: 'NG_acescg_to_lin_rec709_color4' },
      inputs: [{ name: 'in', type: 'color4', value: '0, 0, 0, 1' }],
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'convert')], [
      upstream('convert', 'convert', 'color3', [conn('in', 'color4', 'transform')]),
      transform,
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(builder.build()).get('result')).toEqual([0, 0, 0]);
    expect(emitWgsl(builder.build()).code).toContain('vec4f(0.0, 0.0, 0.0, 1.0)');
  });

  it.each([
    { category: 'mincomponent', type: 'vector2', raw: '2, -1', expected: -1 },
    { category: 'mincomponent', type: 'color4', raw: '2, 3, 4, -5', expected: -5 },
    { category: 'maxcomponent', type: 'vector3', raw: '-2, -1, 4', expected: 4 },
    { category: 'maxcomponent', type: 'color4', raw: '-2, -1, 0, 5', expected: 5 },
    { category: 'trianglewave', type: 'float', raw: '-1.25', expected: 0.25 },
  ])('lowers $category into a connected surface input', ({ category, type, raw, expected }) => {
    const graph = surfaceGraph([conn('base', 'float', 'math')], [
      upstream('math', category, 'float', [conn('in', type, 'source')]),
      upstream('source', 'constant', type, [value('value', type, raw)]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: FLOAT, ref: lowered.inputs.get('base')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('result')).toEqual([expected]);
    expect(emitWgsl(ir).code).toContain(category === 'trianglewave' ? 'floor(' : category === 'mincomponent' ? 'min(' : 'max(');
  });

  it('uses the vector input default declared by a reduction NodeDef', () => {
    const reduction = upstream('math', 'maxcomponent', 'float', []);
    reduction.nodeDef = {
      name: 'ND_maxcomponent_color4', nodeString: 'maxcomponent', type: 'float',
      implementation: { kind: 'nodegraph', name: 'NG_maxcomponent_color4' },
      inputs: [{ name: 'in', type: 'color4', value: '0, 0, 0, 0' }],
    };
    const graph = surfaceGraph([conn('base', 'float', 'math')], [reduction]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: FLOAT, ref: lowered.inputs.get('base')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('result')).toEqual([0]);
    expect(emitWgsl(ir).code).toMatch(/max\(e\d+\.z, e\d+\.w\)/);
  });

  it.each([
    { category: 'over', expected: [0.625, 0.75, 0.875] },
    { category: 'in', expected: [0.1875, 0.375, 0.5625] },
    { category: 'out', expected: [0.0625, 0.125, 0.1875] },
    { category: 'mask', expected: [0.375, 0.25, 0.125] },
    { category: 'matte', expected: [0.5, 0.5, 0.5] },
    { category: 'disjointover', expected: [0.75, 5 / 6, 11 / 12] },
  ])('lowers connected $category color4 into a surface color', ({ category, expected }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'convert')], [
      upstream('convert', 'convert', 'color3', [conn('in', 'color4', 'composite')]),
      upstream('composite', category, 'color4', [
        conn('fg', 'color4', 'foreground'),
        value('bg', 'color4', '0.75, 0.5, 0.25, 0.75'),
      ]),
      upstream('foreground', 'constant', 'color4', [value('value', 'color4', '0.25, 0.5, 0.75, 0.5')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(ir).get('result')!.forEach((component, i) => expect(component).toBeCloseTo(expected[i]!, 10));
    expect(emitWgsl(ir).code).toContain(category === 'disjointover' ? 'mx_disjointover(' : 'mix(');
  });

  it.each([
    { category: 'inside', input: 'base', type: 'float', outputType: FLOAT, raw: '0.8', expected: [0.2] },
    { category: 'outside', input: 'base_color', type: 'color3', outputType: COLOR3, raw: '0.8, 0.4, 0.2', expected: [0.6, 0.3, 0.15] },
  ])('lowers $category masks in a surface graph', ({ category, input, type, outputType, raw, expected }) => {
    const graph = surfaceGraph([conn(input, type, 'masked')], [
      upstream('masked', category, type, [value('in', type, raw), value('mask', 'float', '0.25')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: outputType, ref: lowered.inputs.get(input)! });
    expect(diagnostics).toEqual([]);
    evaluateShaderIr(builder.build()).get('result')!.forEach((component, i) => expect(component).toBeCloseTo(expected[i]!, 10));
    expect(emitWgsl(builder.build()).code).toContain('0.25');
  });

  it.each([
    { category: 'absval', inputs: [value('in', 'float', '-1.25')], expected: [1.25] },
    { category: 'fract', inputs: [value('in', 'float', '-1.25')], expected: [0.75] },
    { category: 'floor', inputs: [value('in', 'float', '-1.25')], expected: [-2] },
    { category: 'ceil', inputs: [value('in', 'float', '-1.25')], expected: [-1] },
    { category: 'modulo', inputs: [value('in1', 'float', '-5'), value('in2', 'float', '2')], expected: [1] },
  ])('supports $category in a surface graph', ({ category, inputs, expected }) => {
    const graph = surfaceGraph([conn('base', 'float', 'math')], [upstream('math', category, 'float', inputs)]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: FLOAT, ref: lowered.inputs.get('base')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('result')).toEqual(expected);
    expect(emitWgsl(ir).code).toContain(`${category === 'absval' ? 'abs' : category === 'modulo' || category === 'fract' ? 'floor' : category}(`);
  });

  it('lowers color modulo with a scalar divisor', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'math')], [
      upstream('math', 'modulo', 'color3', [value('in1', 'color3', '-5, 5, -4'), value('in2', 'float', '2')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(builder.build()).get('result')).toEqual([1, 1, 0]);
    expect(emitWgsl(builder.build()).code).toContain('floor(');
  });

  it.each(['floor', 'ceil'])('lowers integer $s through a surface conversion', (category) => {
    const graph = surfaceGraph([conn('base', 'float', 'convert')], [
      upstream('convert', 'convert', 'float', [conn('in', 'integer', 'math')]),
      upstream('math', category, 'integer', [value('in', 'float', '-1.25')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: FLOAT, ref: lowered.inputs.get('base')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('result')).toEqual([category === 'floor' ? -2 : -1]);
    expect(emitWgsl(ir).code).toContain(`i32(${category}(`);
  });

  it('selects UDIM arrays with original UVs, local V flip and authored missing-tile default', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'color')], [
      upstream('color', 'image', 'color3', [
        value('file', 'filename', 'color.%3CUDIM%3E.jpg'),
        value('default', 'color3', '0.2, 0.3, 0.4'),
        value('uaddressmode', 'string', 'constant'),
      ]),
    ]);
    const module = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }]).module;
    expect(module.textures.map(texture => texture.textureKind)).toEqual(['udim', 'udim-index']);
    expect(module.samplers[0]!.sampler).toMatchObject({ addressU: 'clamp', addressV: 'clamp' });
    expect(module.code).toContain('texture_2d_array<f32>');
    expect(module.code).toContain('texture_2d<u32>');
    expect(module.code).toContain('vec2i(floor(uv))');
    expect(module.code).toContain('1.0 - local.y');
    expect(module.code).toContain('vec3f(0.2, 0.3, 0.4)');
    expect(module.code).not.toContain('vec2f(1.0, -1.0)');
  });
  it.each(['st', 'UV0'])('lowers geompropvalue(%s) to the interpolated UV stream', (name) => {
    const diagnostics: Diagnostic[] = [];
    const graph = surfaceGraph([conn('base_color', 'color3', 'color')], [
      upstream('st', 'geompropvalue', 'vector2', [value('geomprop', 'string', name)]),
      upstream('color', 'image', 'color3', [conn('texcoord', 'vector2', 'st'), value('uvtiling', 'vector2', '0.25, 1')]),
    ]);
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([]);
    expect(module.code).toContain('vary.v_st');
    expect(module.code).toContain('0.25');
    expect(module.code).toContain('textureSample');
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(evaluateShaderIr(ir, {
      texcoord: [0.8, 0.3], textures: { color: (u, v) => [u, v, 0, 1] },
    }).get('color')).toEqual([0.2, 0.7, 0]);
    expect(lowerExprs(ir, '', true).body.join('\n')).toContain('textureSampleLevel');
  });

  it('diagnoses unsupported geometry properties and preserves the authored default', () => {
    const diagnostics: Diagnostic[] = [];
    const graph = surfaceGraph([conn('specular', 'float', 'custom')], [
      upstream('custom', 'geompropvalue', 'float', [
        value('geomprop', 'string', 'missing'), value('default', 'float', '0.75'),
      ]),
    ]);
    const { module } = lowerAndEmit(graph, [{ name: 'specular', type: FLOAT }], d => diagnostics.push(d));
    expect(diagnostics).toEqual([expect.objectContaining({ message: expect.stringContaining("Unsupported geometry property 'missing'") })]);
    expect(module.code).toContain('0.75');
  });

  it('keeps integer NodeDef defaults typed and converts them at the WGSL helper boundary', () => {
    const noise = upstream('noise', 'fractal3d', 'float', [value('amplitude', 'float', '0.5')]);
    noise.nodeDef = {
      name: 'ND_fractal3d_float', nodeString: 'fractal3d', type: 'float', implementation: { kind: 'unresolved' },
      inputs: [{ name: 'octaves', type: 'integer', value: '3' }],
    };
    const graph = surfaceGraph([conn('specular', 'float', 'noise')], [noise]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'specular', type: FLOAT, ref: lowered.inputs.get('specular')! });
    const ir = builder.build();
    expect([...ir.exprs.values()]).toContainEqual({ kind: 'const', type: { kind: 'scalar', scalar: 'int' }, value: 3 });
    expect(emitWgsl(ir).code).toMatch(/mx_fractal3d\(vary.position, e\d+, f32\(e\d+\)\)/);
    expect(Number.isFinite(evaluateShaderIr(ir, { position: [0.2, 0.3, 0.4] }).get('specular')![0])).toBe(true);
  });

  it.each([false, true])('keeps range defaults when intermediate inputs are omitted (reversed=%s)', (reversed) => {
    const inputs = [value('in', 'color3', '0.25, 0.5, 0.75'), value('outhigh', 'color3', '2, 2, 2')];
    const graph = surfaceGraph([conn('base_color', 'color3', 'range')], [
      upstream('range', 'range', 'color3', reversed ? inputs.reverse() : inputs),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    const ref = lowered.inputs.get('base_color')!;
    builder.output({ name: 'color', type: COLOR3, ref });
    const ir = builder.build();
    expect(ir.exprs.get(ref)).toMatchObject({ kind: 'call', args: [], namedArgs: { in: expect.any(String), outhigh: expect.any(String) } });
    expect(evaluateShaderIr(ir).get('color')).toEqual([0.5, 1, 1.5]);
    expect(emitWgsl(ir).code).toContain('pow(');
  });

  it('uses typed NodeDef defaults by name and gives authored values precedence', () => {
    const blend = upstream('blend', 'mix', 'color3', [value('mix', 'float', '0.5')]);
    blend.nodeDef = {
      name: 'ND_mix_color3', nodeString: 'mix', type: 'color3', implementation: { kind: 'unresolved' },
      inputs: [
        { name: 'mix', type: 'float', value: '0.25' },
        { name: 'bg', type: 'color3', value: '0.2, 0.4, 0.6' },
        { name: 'fg', type: 'color3', value: '1, 0, 0' },
      ],
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'blend')], [blend]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    const ref = lowered.inputs.get('base_color')!;
    builder.output({ name: 'color', type: COLOR3, ref });
    const ir = builder.build();
    expect(evaluateShaderIr(ir).get('color')).toEqual([0.6, 0.2, 0.3]);
    expect(emitWgsl(ir).code).toContain('vec3f(0.2, 0.4, 0.6)');
    expect([...ir.exprs.values()].some((expression) => expression.kind === 'const' && expression.value === 0.25)).toBe(false);
  });

  it('reports a missing required named input instead of injecting a zero', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'multiply')], [
      upstream('multiply', 'multiply', 'color3', [value('in1', 'color3', '1, 1, 1')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(() => emitWgsl(ir)).toThrow("missing named input 'in2'");
    expect(() => evaluateShaderIr(ir)).toThrow("missing named input 'in2'");
  });

  it('emits and evaluates named call arguments without positional arguments', () => {
    const builder = new IrModuleBuilder();
    const source = builder.constant(COLOR3, [-0.2, 0.4, -0.6]);
    const ref = builder.add({ kind: 'call', type: COLOR3, op: 'absval', args: [], namedArgs: { in: source } });
    builder.output({ name: 'color', type: COLOR3, ref });
    const ir = builder.build();
    expect(emitWgsl(ir).code).toContain(`abs(${source})`);
    expect(evaluateShaderIr(ir).get('color')).toEqual([0.2, 0.4, 0.6]);
  });

  it('lowers a connected randomcolor node with MaterialX cell-noise seeding', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'random')], [
      upstream('random', 'randomcolor', 'color3', [
        value('in', 'float', '0.125'),
        value('seed', 'integer', '5'),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();

    expect(diagnostics).toEqual([]);
    const color = evaluateShaderIr(ir).get('color')!;
    expect(color[0]).toBeCloseTo(0.1346801, 5);
    expect(color[1]).toBeCloseTo(0.4314369, 5);
    expect(color[2]).toBeCloseTo(1, 5);
    expect(emitWgsl(ir).code).toContain('mx_unified_hash');
  });

  it.each([
    {
      category: 'ramplr', input: 'base', type: 'float', outputType: FLOAT,
      inputs: [value('valuel', 'float', '0'), value('valuer', 'float', '4'), value('texcoord', 'vector2', '0.25, 0.75')],
      expected: [1],
    },
    {
      category: 'ramptb', input: 'base', type: 'float', outputType: FLOAT,
      inputs: [value('valueb', 'float', '0'), value('valuet', 'float', '4'), value('texcoord', 'vector2', '0.25, 0.75')],
      expected: [3],
    },
    {
      category: 'ramp4', input: 'base', type: 'float', outputType: FLOAT,
      inputs: [
        value('valuebl', 'float', '0'), value('valuebr', 'float', '4'),
        value('valuetl', 'float', '8'), value('valuetr', 'float', '12'),
        value('texcoord', 'vector2', '0.25, 0.75'),
      ],
      expected: [7],
    },
    {
      category: 'checkerboard', input: 'base_color', type: 'color3', outputType: COLOR3,
      inputs: [value('texcoord', 'vector2', '-0.125, 0')],
      expected: [1, 1, 1],
    },
  ])('supports $category when connected to a surface input', ({ category, input, type, outputType, inputs, expected }) => {
    const graph = surfaceGraph([conn(input, type, 'pattern')], [upstream('pattern', category, type, inputs)]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: outputType, ref: lowered.inputs.get(input)! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('result')).toEqual(expected);
    expect(emitWgsl(ir).code).toContain(category === 'checkerboard' ? 'floor(' : 'mix(');
  });

  it('uses a connected ramp endpoint and the default geometric UV', () => {
    const graph = surfaceGraph([conn('base', 'float', 'ramp')], [
      upstream('ramp', 'ramplr', 'float', [
        value('valuel', 'float', '0'),
        conn('valuer', 'float', 'sum'),
      ]),
      upstream('sum', 'add', 'float', [value('in1', 'float', '1'), value('in2', 'float', '3')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'result', type: FLOAT, ref: lowered.inputs.get('base')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir, { texcoord: [0.25, 0.9] }).get('result')).toEqual([1]);
    expect(emitWgsl(ir).code).toContain('vary.texcoord.x');
  });

  it.each([
    { texcoord: '0.01, 0.5', staggered: 'false', expected: 1 },
    { texcoord: '0, 1.5', staggered: 'false', expected: 1 },
    { texcoord: '0, 1.5', staggered: 'true', expected: 0 },
  ])('lowers grid lines and staggered rows for UV $texcoord', ({ texcoord, staggered, expected }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'grid')], [
      upstream('grid', 'grid', 'color3', [
        value('texcoord', 'vector2', texcoord),
        value('staggered', 'boolean', staggered),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();

    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('color')).toEqual([expected, expected, expected]);
    expect(emitWgsl(ir).code).toContain('floor(');
  });

  it.each([
    { texcoord: '0.25, 0.25', staggered: 'false', expected: 1 },
    { texcoord: '0.25, 0.75', staggered: 'false', expected: 1 },
    { texcoord: '0.25, 0.25', staggered: 'false', thickness: '0', expected: 1 },
    { texcoord: '0, 0.5', staggered: 'false', expected: 0 },
    { texcoord: '0, 1.5', staggered: 'false', expected: 0 },
    { texcoord: '0, 1.5', staggered: 'true', expected: 1 },
  ])('lowers crosshatch diagonals and staggered rows for UV $texcoord', ({ texcoord, staggered, thickness, expected }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'crosshatch')], [
      upstream('crosshatch', 'crosshatch', 'color3', [
        value('texcoord', 'vector2', texcoord),
        value('staggered', 'boolean', staggered),
        ...(thickness ? [value('thickness', 'float', thickness)] : []),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();

    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('color')).toEqual([expected, expected, expected]);
    expect(emitWgsl(ir).code).toContain('1.41421356237');
  });

  it.each([
    { texcoord: '0.5, 0.5', staggered: 'false', expected: 1 },
    { texcoord: '0.5, 0.5', staggered: 'true', expected: 0 },
    { texcoord: '0.5, 0.9', staggered: 'true', expected: 1 },
    { texcoord: '0.5, 0.75', staggered: 'true', size: '0.1', expected: 0 },
    { texcoord: '0.25, 0.25', staggered: 'false', tiling: '2, 2', expected: 1 },
    { texcoord: '0.25, 0.25', staggered: 'false', offset: '-0.25, -0.25', expected: 1 },
  ])('lowers tiledcircles regular and staggered patterns for UV $texcoord', ({ texcoord, staggered, size, tiling, offset, expected }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'tiledcircles')], [
      upstream('tiledcircles', 'tiledcircles', 'color3', [
        value('texcoord', 'vector2', texcoord),
        value('staggered', 'boolean', staggered),
        ...(size ? [value('size', 'float', size)] : []),
        ...(tiling ? [value('uvtiling', 'vector2', tiling)] : []),
        ...(offset ? [value('uvoffset', 'vector2', offset)] : []),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();

    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('color')).toEqual([expected, expected, expected]);
    expect(emitWgsl(ir).code).toContain('1.73205');
  });

  it.each([
    { texcoord: '0.5, 0.5', staggered: 'false', expected: 1 },
    { texcoord: '0.8, 0.5', staggered: 'false', expected: 0 },
    { texcoord: '0.05, 0.05', staggered: 'false', expected: 0 },
    { texcoord: '0, 0', staggered: 'true', expected: 1 },
    { texcoord: '0.1, 0', staggered: 'true', expected: 1 },
    { texcoord: '0.3, 0', staggered: 'true', expected: 0 },
    { texcoord: '0.5, 0.49', staggered: 'true', expected: 1 },
    { texcoord: '0.5, 0.74', staggered: 'true', expected: 1 },
    { texcoord: '0.5, -0.26', staggered: 'true', expected: 1 },
    { texcoord: '0.15, 0', staggered: 'true', size: '0.1', expected: 0 },
    { texcoord: '0.25, 0.25', staggered: 'false', tiling: '2, 2', expected: 1 },
    { texcoord: '0.25, 0.25', staggered: 'false', offset: '-0.25, -0.25', expected: 1 },
  ])('lowers tiledcloverleafs regular and staggered patterns for UV $texcoord', ({ texcoord, staggered, size, tiling, offset, expected }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'tiledcloverleafs')], [
      upstream('tiledcloverleafs', 'tiledcloverleafs', 'color3', [
        value('texcoord', 'vector2', texcoord),
        value('staggered', 'boolean', staggered),
        ...(size ? [value('size', 'float', size)] : []),
        ...(tiling ? [value('uvtiling', 'vector2', tiling)] : []),
        ...(offset ? [value('uvoffset', 'vector2', offset)] : []),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();

    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('color')).toEqual([expected, expected, expected]);
    expect(emitWgsl(ir).code).toContain('mx_cloverleaf(');
  });

  it.each(['circle', 'line', 'cloverleaf'])('accepts a connected %s primitive without unsupported diagnostics', (category) => {
    const graph = surfaceGraph([conn('base', 'float', 'shape')], [
      upstream('shape', category, 'float', [value('texcoord', 'vector2', '0.5, 0.5'), value('radius', 'float', '1')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'base', type: FLOAT, ref: lowered.inputs.get('base')! });
    const ir = builder.build();
    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('base')).toEqual([1]);
    expect(emitWgsl(ir).code).toContain(category === 'circle' ? 'dot(' : `mx_${category}(`);
  });

  it.each([
    { texcoord: '0.5, 0.5', staggered: 'false', expected: 1 },
    { texcoord: '0, 0', staggered: 'false', expected: 0 },
    { texcoord: '0, 0', staggered: 'true', expected: 1 },
    { texcoord: '0.1, 0', staggered: 'true', size: '0.1', expected: 0 },
    { texcoord: '0.25, 0.25', staggered: 'false', tiling: '2, 2', expected: 1 },
    { texcoord: '0.25, 0.25', staggered: 'false', offset: '-0.25, -0.25', expected: 1 },
  ])('lowers tiledhexagons regular and staggered patterns for UV $texcoord', ({ texcoord, staggered, size, tiling, offset, expected }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'tiledhexagons')], [
      upstream('tiledhexagons', 'tiledhexagons', 'color3', [
        value('texcoord', 'vector2', texcoord),
        value('staggered', 'boolean', staggered),
        ...(size ? [value('size', 'float', size)] : []),
        ...(tiling ? [value('uvtiling', 'vector2', tiling)] : []),
        ...(offset ? [value('uvoffset', 'vector2', offset)] : []),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();

    expect(diagnostics).toEqual([]);
    expect(evaluateShaderIr(ir).get('color')).toEqual([expected, expected, expected]);
    expect(emitWgsl(ir).code).toContain('mx_hexagon(');
  });

  it.each([
    ['false', [-1, 1, 4]],
    ['true', [0, 1, 2]],
  ] as const)('evaluates range gamma and doclamp=%s', (doclamp, expected) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'remap')], [
      upstream('remap', 'range', 'color3', [
        value('in', 'color3', '-0.25, 0.25, 4'),
        value('inlow', 'color3', '0, 0, 0'),
        value('inhigh', 'color3', '1, 1, 1'),
        value('outlow', 'color3', '0, 0, 0'),
        value('outhigh', 'color3', '2, 2, 2'),
        value('gamma', 'color3', '2, 2, 2'),
        value('doclamp', 'boolean', doclamp),
      ]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const surface = resolveSurface(graph, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) })!;
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, surface, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(evaluateShaderIr(ir).get('color')).toEqual(expected);
    expect(emitWgsl(ir).code).toContain(`= ${doclamp};`);
    expect(diagnostics).toEqual([]);
  });

  it('preserves both artistic IOR outputs and ranges the copper display instead of substituting black', () => {
    const graph = surfaceGraph([
      conn('base_color', 'color3', 'display'),
      conn('emission_color', 'color3', 'extinction_display'),
    ], [
      upstream('copper', 'artistic_ior', 'multioutput', [
        value('reflectivity', 'color3', '0.955, 0.638, 0.538'),
        value('edge_color', 'color3', '0.969, 0.906, 0.726'),
      ]),
      upstream('ior_display', 'range', 'color3', [
        conn('in', 'color3', 'copper', 'ior'),
        value('inlow', 'color3', '1, 1, 1'),
        value('inhigh', 'color3', '5, 5, 5'),
        value('outlow', 'color3', '0, 0, 0'),
        value('outhigh', 'color3', '1, 1, 1'),
        value('gamma', 'color3', '1, 1, 1'),
      ]),
      upstream('extinction_display', 'range', 'color3', [
        conn('in', 'color3', 'copper', 'extinction'),
        value('inlow', 'color3', '0, 0, 0'),
        value('inhigh', 'color3', '8, 8, 8'),
      ]),
      upstream('display', 'mix', 'color3', [
        conn('fg', 'color3', 'extinction_display'),
        conn('bg', 'color3', 'ior_display'),
        value('mix', 'float', '0.35'),
      ]),
    ]);
    const builder = new IrModuleBuilder();
    const diagnostics: Diagnostic[] = [];
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder, (diagnostic) => diagnostics.push(diagnostic));
    for (const name of ['base_color', 'emission_color']) {
      builder.output({ name, type: COLOR3, ref: lowered.inputs.get(name)! });
    }
    const ir = builder.build();
    const result = evaluateShaderIr(ir);
    const reflectivity = [0.955, 0.638, 0.538];
    const edge = [0.969, 0.906, 0.726];
    reflectivity.forEach((r, index) => {
      const n = ((1 + Math.sqrt(r)) / (1 - Math.sqrt(r))) * (1 - edge[index]!) + ((1 - r) / (1 + r)) * edge[index]!;
      const k = Math.sqrt(Math.max(((n + 1) ** 2 * r - (n - 1) ** 2) / (1 - r), 0));
      expect(result.get('emission_color')![index]).toBeCloseTo(k / 8, 10);
      expect(result.get('base_color')![index]).toBeCloseTo((n - 1) / 4 * 0.65 + k / 8 * 0.35, 10);
      expect(result.get('base_color')![index]).toBeGreaterThan(0);
    });
    expect(diagnostics).toEqual([]);
    const code = emitWgsl(ir).code;
    expect(code).toMatch(/= mx_artistic_ior\(e\d+, e\d+\);/);
    expect(code).toMatch(/= mx_artistic_ior_extinction\(e\d+, e\d+\);/);
  });

  it.each([
    ['separate2', 'vector2', '-0.2, 0.7', 'outx', 'outy'],
    ['separate3', 'color3', '-0.2, 0.7, 0.4', 'outr', 'outg'],
    ['separate4', 'vector4', '-0.2, 0.7, 0.4, 1', 'outx', 'outy'],
  ])('preserves named scalar outputs from %s through an absval graph', (category, type, raw, first, second) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'abs')], [
      upstream('split', category, 'multioutput', [value('in', type, raw)]),
      upstream('color', 'combine3', 'color3', [
        conn('in1', 'float', 'split', first),
        conn('in2', 'float', 'split', second),
        conn('in3', 'float', 'fraction'),
      ]),
      upstream('fraction', 'fract', 'float', [value('in', 'float', '-0.6')]),
      upstream('abs', 'absval', 'color3', [conn('in', 'color3', 'color')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(evaluateShaderIr(ir).get('color')).toEqual([0.2, 0.7, 0.4]);
    const code = emitWgsl(ir).code;
    expect(code).toContain(`.${first.slice(3)};`);
    expect(code).toContain(`.${second.slice(3)};`);
    expect(code).toContain('abs(');
    expect(code).toMatch(/e\d+ - floor\(e\d+\)/);
  });

  it('lowers a connected color input to a texture-binding sub-graph', () => {
    const graph = surfaceGraph(
      [conn('base_color', 'color3', 'tex'), value('specular', 'float', '0')],
      [upstream('tex', 'image', 'color3', [value('file', 'filename', 'albedo.png', 'srgb_texture')])],
    );
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }]);
    expect(module.textures).toHaveLength(1);
    expect(module.textures[0]!.name).toBe('tex');
    expect(module.textures[0]!.colorSpace).toBe('srgb_texture');
    expect(module.code).toContain('textureSample(tex_tex, samp_tex');
    // UV comes from a declared texcoord primvar, not a baked constant.
    expect(module.code).toContain('vary.v_st');
  });

  it.each([
    { direction: '0, 0, 1', rotation: '0', uv: [0.5, 0.5] },
    { direction: '1, 0, 0', rotation: '90', uv: [0.5, 0.5] },
    { direction: '-1, 0, 0', rotation: '-90', uv: [0.5, 0.5] },
    { direction: '0, 0.5, 0.8660254037844386', rotation: '450', uv: [1.75, 1 / 3] },
    { direction: '0, -0.5, 0.8660254037844386', rotation: '0', uv: [0.5, 2 / 3] },
  ])('projects latlongimage direction $direction and rotation $rotation', ({ direction, rotation, uv }) => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'env')], [
      upstream('env', 'latlongimage', 'color3', [
        value('file', 'filename', 'env.png', 'srgb_texture'),
        conn('viewdir', 'vector3', 'direction'),
        conn('rotation', 'float', 'angle'),
      ]),
      upstream('direction', 'constant', 'vector3', [value('value', 'vector3', direction)]),
      upstream('angle', 'constant', 'float', [value('value', 'float', rotation)]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    const color = evaluateShaderIr(ir, { textures: { env: (u, v) => [u, v, 0, 1] } }).get('color')!;
    expect(diagnostics).toEqual([]);
    expect(color[0]).toBeCloseTo(uv[0]!, 5);
    expect(color[1]).toBeCloseTo(uv[1]!, 5);
    expect(ir.textures).toEqual([expect.objectContaining({ name: 'env', fileRef: 'env.png', colorSpace: 'srgb_texture' })]);
    expect(ir.samplers).toEqual([expect.objectContaining({ name: 'env', addressU: 'periodic', addressV: 'mirror', filter: 'linear' })]);
    const raster = emitWgsl(ir);
    expect(raster.textures[0]).toMatchObject({ fileRef: 'env.png', colorSpace: 'srgb_texture' });
    expect(raster.code).toContain('textureSample(tex_env, samp_env');
    expect(lowerExprs(ir, '', true).body.join('\n')).toContain('textureSampleLevel(tex_env, samp_env');
  });

  it('uses latlongimage NodeDef defaults and preserves image sampling across the longitude seam', () => {
    const image = upstream('env', 'latlongimage', 'color3', []);
    image.nodeDef = {
      name: 'ND_latlongimage', nodeString: 'latlongimage', type: 'color3', implementation: { kind: 'unresolved' },
      inputs: [
        { name: 'file', type: 'filename', value: 'env.png' },
        { name: 'viewdir', type: 'vector3', value: '0, 0.5, 0.8660254037844386' },
        { name: 'rotation', type: 'float', value: '360' },
      ],
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'env')], [image]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    const sampler = createImageSampler({
      kind: 'pixels', width: 2, height: 2, channels: 4, componentType: 'uint8', colorSpace: 'lin_rec709',
      data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    }, ir.samplers[0]);
    const actual = evaluateShaderIr(ir, { textures: { env: sampler } }).get('color')!;
    const expected = sampler(0.5 + 360 * 0.00277778, 0.5 - Math.asin(0.5) * 0.31830989);
    actual.forEach((component, i) => expect(component).toBeCloseTo(expected[i]!, 7));
    expect(ir.textures[0]!.fileRef).toBe('env.png');
  });

  it('uses the standard latlongimage view direction and rotation when omitted', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'env')], [
      upstream('env', 'latlongimage', 'color3', [value('file', 'filename', 'env.png')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    expect(evaluateShaderIr(builder.build(), { textures: { env: (u, v) => [u, v, 0, 1] } }).get('color')).toEqual([0.5, 0.5, 0]);
  });

  it('preserves the declared latlongimage default in the UDIM fallback', () => {
    const image = upstream('env', 'latlongimage', 'color3', [value('file', 'filename', 'env.<UDIM>.png')]);
    image.nodeDef = {
      name: 'ND_latlongimage', nodeString: 'latlongimage', type: 'color3', implementation: { kind: 'unresolved' },
      inputs: [{ name: 'default', type: 'color3', value: '0.2, 0.4, 0.6' }],
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'env')], [image]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(evaluateShaderIr(ir).get('color')).toEqual([0.2, 0.4, 0.6]);
    expect(emitWgsl(ir).code).toContain('mx_sample_udim(');
  });

  it.each(['missing', 'empty', 'connected'] as const)('uses the connected default when the latlongimage file is %s', (mode) => {
    const inputs = [conn('default', 'color3', 'fallback')];
    if (mode === 'empty') inputs.push(value('file', 'filename', ''));
    if (mode === 'connected') inputs.push(conn('file', 'filename', 'filename'));
    const graph = surfaceGraph([conn('base_color', 'color3', 'env')], [
      upstream('env', 'latlongimage', 'color3', inputs),
      upstream('fallback', 'constant', 'color3', [value('value', 'color3', '0.2, 0.4, 0.6')]),
    ]);
    const diagnostics: Diagnostic[] = [];
    const builder = new IrModuleBuilder();
    const surface = resolveSurface(graph, { onDiagnostic: d => diagnostics.push(d) });
    const lowered = lowerSurfaceInputsToIr(graph, surface!, builder, d => diagnostics.push(d));
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(evaluateShaderIr(ir).get('color')).toEqual([0.2, 0.4, 0.6]);
    expect(ir.textures).toEqual([]);
    if (mode === 'connected') expect(diagnostics.some(d => d.message.includes('Dynamic filename'))).toBe(true);
    else expect(diagnostics).toEqual([]);
  });

  it.each(['literal', 'connected', 'omitted'] as const)('applies %s hextiledimage tiling before the image-space V flip in both shader stages', (mode) => {
    const inputs = [
      value('file', 'filename', 'grid.png', 'srgb_texture'),
      conn('texcoord', 'vector2', 'uv'),
      value('rotation', 'float', '0'),
      value('scale', 'float', '0'),
      value('offset', 'float', '0'),
    ];
    if (mode === 'literal') inputs.push(value('tiling', 'vector2', '2, 1.5'));
    if (mode === 'connected') inputs.push(conn('tiling', 'vector2', 'tiles'));
    const graph = surfaceGraph([conn('base_color', 'color3', 'tex')], [
      upstream('tex', 'hextiledimage', 'color3', inputs),
      upstream('uv', 'texcoord', 'vector2', []),
      upstream('tiles', 'constant', 'vector2', [value('value', 'vector2', '2, 1.5')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    for (const uv of [[0.2, 0.4], [-0.3, 1.2]]) {
      const sampled = evaluateShaderIr(ir, { texcoord: uv, textures: { tex: (u, v) => [u, v, 0, 1] } }).get('color')!;
      expect(sampled[0]).toBeCloseTo(uv[0]! * (mode === 'omitted' ? 1 : 2));
      expect(sampled[1]).toBeCloseTo(1 - uv[1]! * (mode === 'omitted' ? 1 : 1.5));
    }
    expect(ir.textures).toHaveLength(1);
    expect(ir.textures[0]).toMatchObject({ name: 'tex', fileRef: 'grid.png', colorSpace: 'srgb_texture' });
    expect(emitWgsl(ir).textures[0]!.colorSpace).toBe('srgb_texture');
    for (const compute of [false, true]) {
      const code = lowerExprs(ir, '', compute).body.join('\n');
      expect(code).toContain(compute ? 'textureSampleLevel(' : 'textureSample(');
      expect(code).toMatch(/\(e\d+ \* e\d+\)/);
    }
  });

  it.each(['literal', 'connected', 'nodedef', 'omitted'] as const)(
    'applies %s tiledimage transforms in MaterialX order for color, scalar and normal textures',
    (mode) => {
      const settings = [
        value('uvtiling', 'vector2', '3, 2'),
        value('uvoffset', 'vector2', '0.1, -0.2'),
        value('realworldimagesize', 'vector2', '2, 4'),
        value('realworldtilesize', 'vector2', '5, 3'),
      ];
      for (const [type, input, irType] of [
        ['color3', 'base_color', COLOR3],
        ['float', 'specular_roughness', FLOAT],
        ['vector3', 'normal', vector(3)],
      ] as const) {
        const tex = upstream('tex', 'tiledimage', type, [
          value('file', 'filename', 'brick.png'),
          ...(mode === 'literal' ? settings : mode === 'connected'
            ? settings.map((s) => conn(s.name, s.type, s.name)) : []),
        ]);
        if (mode === 'nodedef') tex.nodeDef = {
          name: `ND_tiledimage_${type}`, nodeString: 'tiledimage', type, implementation: { kind: 'unresolved' },
          inputs: settings.map((s) => ({ name: s.name, type: s.type, value: s.source.kind === 'value' ? s.source.value : '' })),
        };
        const graph = surfaceGraph([conn(input, type, 'tex')], [
          tex,
          ...settings.map((s) => upstream(s.name, 'constant', 'vector2', [
            value('value', 'vector2', s.source.kind === 'value' ? s.source.value : ''),
          ])),
        ]);
        const builder = new IrModuleBuilder();
        const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
        builder.output({ name: 'result', type: irType, ref: lowered.inputs.get(input)! });
        const ir = builder.build();
        expect(ir.samplers[0]).toMatchObject({ addressU: 'periodic', addressV: 'periodic' });
        for (const uv of [[0.2, 0.4], [-0.3, 1.2]]) {
          const coordinates: number[][] = [];
          evaluateShaderIr(ir, { texcoord: uv, textures: { tex: (u, v) => {
            coordinates.push([u, v]);
            return [u, v, 0, 1];
          } } });
          expect(coordinates).toHaveLength(1);
          const expected = mode === 'omitted'
            ? [uv[0]!, 1 - uv[1]!]
            : [(uv[0]! * 3 - 0.1) / 2 * 5, 1 - (uv[1]! * 2 + 0.2) / 4 * 3];
          expect(coordinates[0]![0]).toBeCloseTo(expected[0]!);
          expect(coordinates[0]![1]).toBeCloseTo(expected[1]!);
        }
        for (const compute of [false, true]) {
          const code = lowerExprs(ir, '', compute).body.join('\n');
          expect(code).toContain(compute ? 'textureSampleLevel(' : 'textureSample(');
          expect(code).toMatch(/\(e\d+ \* e\d+\)/);
        }
      }
    },
  );

  it('preserves Brick procedural scalar-to-vector tiling shared by its image inputs', () => {
    const graph = surfaceGraph([
      conn('base_color', 'color3', 'color'), conn('specular_roughness', 'float', 'roughness'),
    ], [
      upstream('tiles', 'convert', 'vector2', [value('in', 'float', '3')]),
      upstream('color', 'tiledimage', 'color3', [conn('uvtiling', 'vector2', 'tiles')]),
      upstream('roughness', 'tiledimage', 'float', [conn('uvtiling', 'vector2', 'tiles')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    builder.output({ name: 'roughness', type: FLOAT, ref: lowered.inputs.get('specular_roughness')! });
    const ir = builder.build();
    const coordinates: number[][] = [];
    const texture = (u: number, v: number): number[] => {
      coordinates.push([u, v]);
      return [0.2, 0.4, 0.6, 1];
    };
    evaluateShaderIr(ir, { texcoord: [0.2, 0.4], textures: { color: texture, roughness: texture } });
    expect(coordinates).toHaveLength(2);
    for (const uv of coordinates) {
      expect(uv[0]).toBeCloseTo(0.6);
      expect(uv[1]).toBeCloseTo(-0.2);
    }
  });

  it('does not apply a hextiledimage tiling transform to plain image nodes', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'tex')], [
      upstream('tex', 'image', 'color3', [value('tiling', 'vector2', '2, 1.5')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    expect(evaluateShaderIr(builder.build(), {
      texcoord: [0.2, 0.4], textures: { tex: (u, v) => [u, v, 0, 1] },
    }).get('color')).toEqual([0.2, 0.6, 0]);
  });

  it('hex-tiles and rotates normal samples before applying flip_g and strength', () => {
    const render = (flipG: boolean, rotation = 0, rotationRange = '0, 0') => {
      const graph = surfaceGraph([conn('normal', 'vector3', 'hex')], [
        upstream('hex', 'hextilednormalmap', 'vector3', [
          value('file', 'filename', 'normal.png', 'none'),
          value('default', 'vector3', '0.5, 0.5, 1'),
          value('texcoord', 'vector2', '0.25, 0.4'),
          value('tiling', 'vector2', '1, 1'),
          value('rotation', 'float', String(rotation)),
          value('rotationrange', 'vector2', rotationRange),
          value('scale', 'float', '0'),
          value('offset', 'float', '0'),
          value('strength', 'float', '1'),
          value('flip_g', 'boolean', String(flipG)),
        ]),
      ]);
      const builder = new IrModuleBuilder();
      const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
      builder.output({ name: 'normal', type: vector(3), ref: lowered.inputs.get('normal')! });
      const ir = builder.build();
      const coordinates: number[][] = [];
      const normal = evaluateShaderIr(ir, {
        normal: [0, 0, 1],
        tangent: [1, 0, 0],
        bitangent: [0, 1, 0],
        textures: { hex: (u, v) => {
          coordinates.push([u, v]);
          return [0.75, 0.25, 0.9];
        } },
      }).get('normal')!;
      return { coordinates, normal, ir };
    };

    const normal = render(false);
    const flipped = render(true);
    const rotated = render(false, 1, '90, 90');
    expect(normal.coordinates).toHaveLength(3);
    expect(flipped.coordinates).toHaveLength(3);
    expect(normal.normal[1]).toBeLessThan(0);
    expect(flipped.normal[1]).toBeGreaterThan(0);
    expect(rotated.normal[0]).toBeGreaterThan(0);
    expect(rotated.normal[1]).toBeGreaterThan(0);
    for (const [compute, token] of [[false, 'textureSample('], [true, 'textureSampleLevel(']] as const) {
      const code = lowerExprs(normal.ir, '', compute).body.join('\n');
      expect(code.match(new RegExp(token.replace(/[()]/g, '\\$&'), 'g'))).toHaveLength(3);
      expect(code).toContain('mx_normalmap(');
    }
  });

  it.each([false, true])('preserves image sampler settings and flips V after the connected UV transform (defaults=%s)', (defaults) => {
    const settings = [
      value('uaddressmode', 'string', 'clamp'), value('vaddressmode', 'string', 'clamp'),
      value('filtertype', 'string', 'closest'),
    ];
    const tex = upstream('tex', 'image', 'color3', [
      conn('texcoord', 'vector2', 'expanded'), ...(defaults ? [] : settings),
    ]);
    if (defaults) tex.nodeDef = {
      name: 'ND_image_color3', nodeString: 'image', type: 'color3', implementation: { kind: 'unresolved' },
      inputs: settings.map((input) => ({ name: input.name, type: input.type, value: input.source.kind === 'value' ? input.source.value : '' })),
    };
    const graph = surfaceGraph([conn('base_color', 'color3', 'tex')], [
      tex,
      upstream('expanded', 'add', 'vector2', [conn('in1', 'vector2', 'scaled'), value('in2', 'vector2', '-1, -1')]),
      upstream('scaled', 'multiply', 'vector2', [conn('in1', 'vector2', 'uv'), value('in2', 'vector2', '3, 3')]),
      upstream('uv', 'texcoord', 'vector2', []),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    expect(ir.samplers[0]).toMatchObject({ addressU: 'clamp', addressV: 'clamp', filter: 'closest' });
    const sampler = createImageSampler({
      kind: 'pixels', data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
      componentType: 'uint8', channels: 3, width: 2, height: 2, colorSpace: 'lin_rec709',
    }, ir.samplers[0]);
    for (const [uv, expected] of [
      [[0, 0], [0, 0, 1]], [[1, 0], [1, 1, 1]], [[0, 1], [1, 0, 0]], [[1, 1], [0, 1, 0]],
    ] as const) {
      expect(evaluateShaderIr(ir, { texcoord: uv, textures: { tex: sampler } }).get('color')).toEqual(expected);
    }
    for (const compute of [false, true]) {
      expect(lowerExprs(ir, '', compute).samplers[0]!.sampler).toEqual({ addressU: 'clamp', addressV: 'clamp', filter: 'closest' });
    }
  });

  it('uses the declared default for constant-addressed UVs without clamping the other axis', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'tex')], [
      upstream('tex', 'image', 'color3', [
        value('uaddressmode', 'string', 'constant'), value('default', 'color3', '1, 0, 1'),
      ]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'color', type: COLOR3, ref: lowered.inputs.get('base_color')! });
    const ir = builder.build();
    const evaluate = (u: number, v: number) => evaluateShaderIr(ir, { texcoord: [u, v], textures: { tex: () => [0, 1, 0, 1] } }).get('color');
    expect(evaluate(-0.01, 0.5)).toEqual([1, 0, 1]);
    expect(evaluate(1.01, 0.5)).toEqual([1, 0, 1]);
    expect(evaluate(0.5, 2)).toEqual([0, 1, 0]);
    expect(evaluate(0, 0.5)).toEqual([0, 1, 0]);
    expect(evaluate(1, 0.5)).toEqual([0, 1, 0]);
  });

  it('lowers a literal input to a baked constant with no bindings', () => {
    const graph = surfaceGraph(
      [value('specular', 'float', '0.3'), value('base_color', 'color3', '0.2, 0.4, 0.6')],
      [],
    );
    const { module } = lowerAndEmit(graph, [{ name: 'specular', type: FLOAT }]);
    // A literal input is baked: no texture binding and no node call.
    expect(module.textures).toHaveLength(0);
    expect(module.code).not.toContain('textureSample');
    expect(module.code).toContain('= 0.3;');
  });

  it('lowers a procedural (mix) input to a node-call sub-graph', () => {
    const graph = surfaceGraph(
      [conn('base_color', 'color3', 'blend')],
      [
        upstream('blend', 'mix', 'color3', [
          value('mix', 'float', '0.25'),
          value('fg', 'color3', '1, 0, 0'),
          value('bg', 'color3', '0, 0, 1'),
        ]),
      ],
    );
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }]);
    expect(module.textures).toHaveLength(0);
    // mix lowering emits mix(bg, fg, t) with the three operands as constants.
    expect(module.code).toContain('mix(');
    expect(module.code).toContain('vec3f(0.0, 0.0, 1.0)'); // bg
    expect(module.code).toContain('vec3f(1.0, 0.0, 0.0)'); // fg
  });

  it('lowers a convert node to an IR conversion of its sub-graph', () => {
    const graph = surfaceGraph(
      [conn('base_color', 'color3', 'cvt')],
      [
        upstream('cvt', 'convert', 'color3', [conn('in', 'float', 'prod')]),
        upstream('prod', 'multiply', 'float', [value('in1', 'float', '0.5'), value('in2', 'float', '2')]),
      ],
    );
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }]);
    // multiply sub-graph emitted (operands referenced by IR var), then wrapped by
    // a scalar->vec3f conversion.
    expect(module.code).toContain('= 0.5;');
    expect(module.code).toMatch(/\(e\d+ \* e\d+\)/);
    expect(module.code).toMatch(/vec3f\(e\d+\)/);
  });

  it('shares a sub-graph feeding two inputs (CSE across surface fields)', () => {
    const graph = surfaceGraph(
      [conn('base_color', 'color3', 'tex'), conn('coat_color', 'color3', 'tex')],
      [upstream('tex', 'image', 'color3', [value('file', 'filename', 'albedo.png')])],
    );
    const { module, refFor } = lowerAndEmit(graph, [
      { name: 'base_color', type: COLOR3 },
      { name: 'coat_color', type: COLOR3 },
    ]);
    expect(refFor('base_color')).toBe(refFor('coat_color'));
    expect(module.textures).toHaveLength(1);
  });

  it('coerces mismatched upstream types to the declared input and surface types', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'tint'), conn('opacity', 'color3', 'alpha')], [
      upstream('tint', 'multiply', 'color4', [value('in1', 'color4', '0.5, 0.25, 1, 1'), value('in2', 'float', '2')]),
      upstream('alpha', 'constant', 'float', [value('value', 'float', '0.5')]),
    ]);
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }, { name: 'opacity', type: COLOR3 }]);
    expect(module.code).toMatch(/= e\d+\.xyz;/);
    expect(module.code).toMatch(/= vec3f\(e\d+\);/);
  });

  it('lowers boolean-output conditionals, logic and zero-based switch', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'pick')], [
      upstream('test', 'ifgreater', 'boolean', [value('value1', 'float', '0.7'), value('value2', 'float', '0.5')]),
      upstream('flag', 'not', 'boolean', [conn('in', 'boolean', 'test')]),
      upstream('which', 'convert', 'integer', [conn('in', 'boolean', 'flag')]),
      upstream('pick', 'switch', 'color3', [
        value('in1', 'color3', '1, 0, 0'),
        value('in2', 'color3', '0, 1, 0'),
        conn('which', 'integer', 'which'),
      ]),
    ]);
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }]);
    expect(module.code).toMatch(/= \(e\d+ > e\d+\);/);
    expect(module.code).toMatch(/= \(!e\d+\);/);
    expect(module.code).toMatch(/= i32\(e\d+\);/);
    expect(module.code).toContain('select(');
  });

  it('lowers glTF color images to a modulated texture sample with split outputs', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'img', 'outcolor'), conn('specular', 'float', 'img', 'outa')], [
      upstream('img', 'gltf_colorimage', 'multioutput', [
        value('file', 'filename', 'albedo.png'),
        value('color', 'color4', '0.5, 0.5, 0.5, 1'),
      ]),
    ]);
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }, { name: 'specular', type: FLOAT }]);
    expect(module.textures).toHaveLength(1);
    expect(module.code).toContain('textureSample(tex_img, samp_img');
    expect(module.code).toMatch(/= e\d+\.xyz;/);
    expect(module.code).toMatch(/= e\d+\.w;/);
  });

  it('reevaluates heighttonormal at neighboring UVs in both raster and compute stages', () => {
    const graph = surfaceGraph([conn('normal', 'vector3', 'htn')], [
      upstream('htn', 'heighttonormal', 'vector3', [value('in', 'float', '0.5'), value('scale', 'float', '2')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'normal', type: COLOR3, ref: lowered.inputs.get('normal')! });
    const ir = builder.build();
    const raster = lowerExprs(ir).body.join('\n');
    expect(raster).toContain('mx_heighttonormal(vec2f(');
    expect(raster).not.toContain('dpdx');
    const compute = lowerExprs(ir, '', true).body.join('\n');
    expect(compute).not.toContain('dpdx');
    expect(compute).not.toContain('vec3f(0.5, 0.5, 1.0)');
    expect(compute).toBe(raster);
    expect(compute).toContain('_0_p_');
    expect(compute).toContain('_1_m_');
  });

  it('resamples the upstream image and procedural height graph with namespaced texture handles', () => {
    const graph = surfaceGraph([conn('normal', 'vector3', 'htn')], [
      upstream('img', 'image', 'float', [value('file', 'filename', 'grid.png')]),
      upstream('height', 'multiply', 'float', [conn('in1', 'float', 'img'), value('in2', 'float', '0.5')]),
      upstream('htn', 'heighttonormal', 'vector3', [conn('in', 'float', 'height'), value('scale', 'float', '2')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'normal', type: COLOR3, ref: lowered.inputs.get('normal')! });
    const loweredWgsl = lowerExprs(builder.build(), 'm7_', true);
    const code = loweredWgsl.body.join('\n');
    expect(code).toContain('textureDimensions(m7_tex_img, 0)');
    expect(code.match(/textureSampleLevel\(m7_tex_img/g)).toHaveLength(5);
    expect(code).toContain('vary.v_st + vec2f(');
    expect(code).not.toContain('dpdx');
    expect(loweredWgsl.textures).toHaveLength(1);
    expect(loweredWgsl.primvarFields.has('st')).toBe(true);
  });

  it('reevaluates bump height at neighboring UVs in the compute path tracer', () => {
    const graph = surfaceGraph([conn('normal', 'vector3', 'bump')], [
      upstream('img', 'image', 'float', [value('file', 'filename', 'height.png')]),
      upstream('bump', 'bump', 'vector3', [conn('height', 'float', 'img'), value('scale', 'float', '2')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'normal', type: COLOR3, ref: lowered.inputs.get('normal')! });

    const ir = builder.build();
    const raster = lowerExprs(ir).body.join('\n');
    expect(raster).toContain('mx_normalmap(mx_heighttonormal(vec2f(dpdx(');
    expect(raster).not.toContain('textureSampleLevel');

    const loweredWgsl = lowerExprs(ir, '', true);
    const code = loweredWgsl.body.join('\n');
    expect(code).toContain('mx_normalmap(mx_heighttonormal(');
    expect(code).toMatch(/mx_normalmap\(mx_heighttonormal\([\s\S]*?, 1\.0\), vec2f\(e\d+\), vary\.normal/);
    expect(code).toContain('textureDimensions(tex_img, 0)');
    expect(code.match(/textureSampleLevel\(tex_img/g)).toHaveLength(5);
    expect(code).toContain('vary.v_st + vec2f(');
    expect(code).not.toContain('dpdx');
  });

  it('differentiates the explicit heighttonormal UV frame after upstream UV transforms', () => {
    const graph = surfaceGraph([conn('normal', 'vector3', 'htn')], [
      upstream('uv', 'texcoord', 'vector2', []),
      upstream('scaled', 'multiply', 'vector2', [conn('in1', 'vector2', 'uv'), value('in2', 'float', '-2')]),
      upstream('img', 'image', 'float', [value('file', 'filename', 'grid.png'), conn('texcoord', 'vector2', 'scaled')]),
      upstream('htn', 'heighttonormal', 'vector3', [
        conn('in', 'float', 'img'), conn('texcoord', 'vector2', 'scaled'), value('scale', 'float', '2'),
      ]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'normal', type: COLOR3, ref: lowered.inputs.get('normal')! });
    const code = lowerExprs(builder.build(), '', true).body.join('\n');
    expect(code).toContain('_uv_dx');
    expect(code).toContain('_uv_dy');
    expect(code).toMatch(/_uv_dx\.x, e\d+_uv_dy\.x/);
    expect(code).not.toMatch(/dpd[xy]|textureSample\(/);
    const variables = [...code.matchAll(/let (\w+) =/g)].map((match) => match[1]);
    expect(new Set(variables).size).toBe(variables.length);
  });

  it('chains ramp gradients over the ten control points', () => {
    const graph = surfaceGraph([conn('base_color', 'color3', 'ramp')], [
      upstream('ramp', 'ramp', 'color4', [value('num_intervals', 'integer', '3')]),
    ]);
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }]);
    expect(module.code.match(/mx_ramp_gradient\(/g)!.length).toBeGreaterThanOrEqual(10);
    expect(module.code).toContain('mx_ramp_x(');
  });

  it('diagnoses an unsupported upstream node and bakes a neutral constant', () => {
    const diagnostics: Diagnostic[] = [];
    const graph = surfaceGraph(
      [conn('base_color', 'color3', 'nz')],
      [upstream('nz', 'custom_unsupported', 'color3', [value('x', 'float', '1')])],
    );
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], (d) => diagnostics.push(d));
    expect(diagnostics.some((d) => d.level === 'warning' && d.message.includes('custom_unsupported'))).toBe(true);
    expect(module.code).not.toContain('custom_unsupported');
    expect(module.textures).toHaveLength(0);
    expect(module.code).toContain('vec3f(0.0, 0.0, 0.0)');
  });
});
