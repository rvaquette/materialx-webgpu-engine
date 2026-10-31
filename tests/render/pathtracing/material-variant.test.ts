// T057g: buildMaterialDispatch (src/render/pathtracing/material-variant.ts)
// lowers each graph-backed scene material to a renamed fill function and
// assembles the megakernel's mx_eval_material switch with a constant-record
// fallback. These structural tests build ResolvedGraphs as plain data, resolve +
// dispatch, and assert on the generated WGSL and merged bindings. No WebGPU is
// exercised (pure string builder).

import { describe, it, expect } from 'vitest';
import type {
  ResolvedGraph,
  ResolvedInput,
  ResolvedNode,
  ResolvedValueSource,
} from '../../../src/materialx/graph.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import { emitSurfaceVariant } from '../../../src/compiler/surface-wgsl.ts';
import {
  buildMaterialDispatch,
  type PtVariantSource,
} from '../../../src/render/pathtracing/material-variant.ts';

function value(name: string, type: string, raw: string, colorSpace?: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return colorSpace !== undefined
    ? { name, type, source, colorSpace, provenance: { namePath: `/mat/${name}` } }
    : { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

function conn(name: string, type: string, nodeId: string): ResolvedInput {
  return { name, type, source: { kind: 'connection', nodeId }, provenance: { namePath: `/mat/${name}` } };
}

function upstream(id: string, category: string, type: string, inputs: ResolvedInput[]): ResolvedNode {
  return { id, category, type, inputs, provenance: { namePath: `/mat/${id}` } };
}

function surfaceGraph(category: string, surfaceInputs: ResolvedInput[], upstreamNodes: ResolvedNode[] = []): ResolvedGraph {
  const surfaceId = 'SR';
  const surface: ResolvedNode = {
    id: surfaceId,
    category,
    type: 'surfaceshader',
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

/** Build a PtVariantSource at a given material index from a resolved graph. */
function source(materialIndex: number, graph: ResolvedGraph): PtVariantSource {
  const surface = resolveSurface(graph, {});
  expect(surface).not.toBeNull();
  return { materialIndex, graph, surface: surface! };
}

/** A standard_surface with its base_color driven by a tiled image on `file`. */
function texturedBaseColor(file: string): ResolvedGraph {
  return surfaceGraph(
    'standard_surface',
    [conn('base_color', 'color3', 'tex')],
    [upstream('tex', 'image', 'color3', [value('file', 'filename', file, 'srgb_texture')])],
  );
}

describe('emitSurfaceVariant (T057g)', () => {
  it('renames the fill function by material index and omits the shared preludes', () => {
    const graph = surfaceGraph('standard_surface', [value('base_color', 'color3', '0.8, 0.1, 0.1')]);
    const variant = emitSurfaceVariant(graph, resolveSurface(graph, {})!, 5);
    expect(variant.index).toBe(5);
    expect(variant.fnName).toBe('mx_surface_layered_5');
    expect(variant.fnCode.startsWith('fn mx_surface_layered_5(vary: MxVaryings) -> LayeredClosure {')).toBe(true);
    // The fill function alone: no closure library / struct preludes baked in.
    expect(variant.fnCode).not.toContain('struct LayeredClosure {');
    expect(variant.fnCode).not.toContain('fn mx_closure_eval');
  });
});

describe('buildMaterialDispatch (T057g)', () => {
  it('shares identical constant variants without changing material indices', () => {
    const graph = surfaceGraph('disney_principled', [value('metallic', 'float', '1')]);
    const dispatch = buildMaterialDispatch([source(0, graph), source(7, graph)]);
    expect(dispatch.variants.map(v => v.index)).toEqual([0, 7]);
    expect(dispatch.dispatcherWgsl.match(/fn mx_surface_layered_/g)).toHaveLength(1);
    expect(dispatch.dispatcherWgsl).toContain('case 7u: { return mx_surface_layered_0(vary); }');
    expect(dispatch.variants[0]!.lobeCount).toBe(1);
    expect(dispatch.variants[0]!.features?.opaque).toBe(true);
  });

  it('assembles a switch over graph materials with a constant-record fallback', () => {
    const dispatch = buildMaterialDispatch([
      source(2, surfaceGraph('standard_surface', [value('base_color', 'color3', '0.2, 0.4, 0.6')])),
      source(0, surfaceGraph('standard_surface', [value('base_color', 'color3', '0.8, 0.1, 0.1')])),
    ]);
    // Variants sorted by material index.
    expect(dispatch.variants.map((v) => v.index)).toEqual([0, 2]);
    expect(dispatch.dispatcherWgsl).toContain('fn mx_eval_material(matId: u32, vary: MxVaryings) -> LayeredClosure {');
    expect(dispatch.dispatcherWgsl).toContain('case 0u: { return mx_surface_layered_0(vary); }');
    expect(dispatch.dispatcherWgsl).toContain('case 2u: { return mx_surface_layered_2(vary); }');
    expect(dispatch.dispatcherWgsl).toContain('default: { return mx_material_closure(matId); }');
    // Both fill functions precede the dispatcher.
    expect(dispatch.dispatcherWgsl.indexOf('fn mx_surface_layered_0('))
      .toBeLessThan(dispatch.dispatcherWgsl.indexOf('fn mx_eval_material('));
  });

  it('falls back to only the constant record when no material has a graph', () => {
    const dispatch = buildMaterialDispatch([]);
    expect(dispatch.variants).toHaveLength(0);
    expect(dispatch.textures).toHaveLength(0);
    expect(dispatch.dispatcherWgsl).toBe(
      'fn mx_eval_material(matId: u32, vary: MxVaryings) -> LayeredClosure {\n  switch matId {\n    default: { return mx_material_closure(matId); }\n  }\n}',
    );
  });

  it('namespaces handles per material so distinct materials never collide', () => {
    const dispatch = buildMaterialDispatch([
      source(0, texturedBaseColor('albedo.png')),
      source(1, texturedBaseColor('albedo.png')),
    ]);
    // Same image node id in two materials stays separate (prefixed per material);
    // sharing one GPU texture by file identity is deferred to T057j.
    expect(dispatch.textures).toHaveLength(2);
    expect(dispatch.textures.map((t) => t.binding)).toEqual([0, 1]);
    expect(dispatch.textures[0]!.handle).not.toBe(dispatch.textures[1]!.handle);
    expect(dispatch.samplers).toHaveLength(2);
    expect(dispatch.textures[0]!.group).toBe(1);
    expect(dispatch.samplers[0]!.group).toBe(2);
    // The per-material prefixed handle appears in the generated fill function.
    expect(dispatch.dispatcherWgsl).toContain('m0_tex_tex');
    expect(dispatch.dispatcherWgsl).toContain('m1_tex_tex');
    // The textured input forces the st primvar into the merged varyings.
    expect(dispatch.primvarFields.has('st')).toBe(true);
  });
});
