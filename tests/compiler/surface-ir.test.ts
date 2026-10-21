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
import { IrModuleBuilder, COLOR3, FLOAT, type IrRef } from '../../src/compiler/ir.ts';
import { emitWgsl, lowerExprs, type WgslModule } from '../../src/compiler/wgsl.ts';
import { evaluateShaderIr } from '../../src/compiler/ir-eval.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';

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

function surfaceGraph(surfaceInputs: ResolvedInput[], upstreamNodes: ResolvedNode[]): ResolvedGraph {
  const surfaceId = 'SR';
  const surface: ResolvedNode = {
    id: surfaceId,
    category: 'standard_surface',
    type: 'surfaceshader',
    nodeDef: {
      name: 'ND_standard_surface',
      nodeString: 'standard_surface',
      type: 'surfaceshader',
      implementation: { kind: 'nodegraph', name: 'NG_standard_surface' },
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
  refFor: (name: string) => IrRef;
}

function lowerAndEmit(
  graph: ResolvedGraph,
  outputs: readonly { name: string; type: typeof COLOR3 | typeof FLOAT }[],
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
  return { module: emitWgsl(builder.build()), refFor };
}

describe('lowerSurfaceInputsToIr (T055c)', () => {
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
    expect(code).toContain('fract(');
  });

  it('lowers a connected color input to a texture-binding sub-graph', () => {
    const graph = surfaceGraph(
      [conn('base_color', 'color3', 'tex'), value('specular', 'float', '0')],
      [upstream('tex', 'image', 'color3', [value('file', 'filename', 'albedo.png', 'srgb_texture')])],
    );
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }]);
    expect(module.textures).toHaveLength(1);
    expect(module.textures[0]!.name).toBe('tex');
    expect(module.code).toContain('textureSample(tex_tex, samp_tex');
    // UV comes from a declared texcoord primvar, not a baked constant.
    expect(module.code).toContain('vary.v_st');
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

  it('uses derivatives for heighttonormal in raster and a flat normal in compute stages', () => {
    const graph = surfaceGraph([conn('normal', 'vector3', 'htn')], [
      upstream('htn', 'heighttonormal', 'vector3', [value('in', 'float', '0.5'), value('scale', 'float', '2')]),
    ]);
    const builder = new IrModuleBuilder();
    const lowered = lowerSurfaceInputsToIr(graph, resolveSurface(graph)!, builder);
    builder.output({ name: 'normal', type: COLOR3, ref: lowered.inputs.get('normal')! });
    const ir = builder.build();
    expect(lowerExprs(ir).body.join('\n')).toContain('mx_heighttonormal(vec2f(dpdx(');
    const compute = lowerExprs(ir, '', true).body.join('\n');
    expect(compute).not.toContain('dpdx');
    expect(compute).toContain('vec3f(0.5, 0.5, 1.0)');
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
