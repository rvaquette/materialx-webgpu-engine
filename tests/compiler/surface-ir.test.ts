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
import { emitWgsl, type WgslModule } from '../../src/compiler/wgsl.ts';
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
          value('fg', 'color3', '1, 0, 0'),
          value('bg', 'color3', '0, 0, 1'),
          value('mix', 'float', '0.25'),
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

  it('diagnoses an unsupported upstream node and bakes a neutral constant', () => {
    const diagnostics: Diagnostic[] = [];
    const graph = surfaceGraph(
      [conn('base_color', 'color3', 'nz')],
      [upstream('nz', 'noise3d', 'color3', [value('amplitude', 'float', '1')])],
    );
    const { module } = lowerAndEmit(graph, [{ name: 'base_color', type: COLOR3 }], (d) => diagnostics.push(d));
    expect(diagnostics.some((d) => d.level === 'warning' && d.message.includes('noise3d'))).toBe(true);
    expect(module.code).not.toContain('noise3d');
    expect(module.textures).toHaveLength(0);
    expect(module.code).toContain('vec3f(0.0, 0.0, 0.0)');
  });
});
