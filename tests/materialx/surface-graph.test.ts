// T055a: resolveSurface normalizes a ResolvedGraph surfaceshader interface into
// a per-family input map, applying official nodedef defaults, standard_surface
// version inheritance, interface resolution, and REQ-013 diagnostics. These are
// pure data tests (no WASM): a ResolvedGraph is built directly as plain data.

import { describe, it, expect, vi } from 'vitest';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import type {
  ResolvedGraph,
  ResolvedNode,
  ResolvedInput,
  ResolvedValueSource,
} from '../../src/materialx/graph.ts';
import {
  resolveSurface,
  type NormalizedSurfaceSource,
} from '../../src/materialx/surface-graph.ts';

function input(name: string, type: string, source: ResolvedValueSource): ResolvedInput {
  return { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

interface SurfaceSpec {
  id?: string;
  category: string;
  nodeString?: string;
  version?: string;
  inputs?: ResolvedInput[];
  extraNodes?: ResolvedNode[];
}

function graphOf(spec: SurfaceSpec): ResolvedGraph {
  const id = spec.id ?? 'SR';
  const node: ResolvedNode = {
    id,
    category: spec.category,
    type: 'surfaceshader',
    nodeDef: {
      name: `ND_${spec.category}`,
      nodeString: spec.nodeString ?? spec.category,
      type: 'surfaceshader',
      ...(spec.version !== undefined ? { version: spec.version } : {}),
      implementation: { kind: 'nodegraph', name: `NG_${spec.category}` },
    },
    inputs: spec.inputs ?? [],
    provenance: { namePath: `/mat/${id}` },
  };
  const nodes = new Map<string, ResolvedNode>([[id, node]]);
  for (const extra of spec.extraNodes ?? []) nodes.set(extra.id, extra);
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: id, provenance: { namePath: `/mat/${id}` } }],
    nodes,
  };
}

function upstream(id: string, category: string): ResolvedNode {
  return {
    id,
    category,
    type: 'color3',
    inputs: [],
    provenance: { namePath: `/mat/${id}` },
  };
}

describe('resolveSurface (T055a)', () => {
  it('uses the loaded active NodeDef interface and its own types/defaults before family fallbacks', () => {
    const graph = graphOf({ category: 'standard_surface' });
    const node = graph.nodes.get('SR')!;
    node.nodeDef = {
      ...node.nodeDef!,
      inputs: [
        { name: 'base_color', type: 'color3', value: '0.1, 0.2, 0.3' },
        { name: 'custom_flag', type: 'boolean', value: 'true' },
        { name: 'custom_count', type: 'integer', value: '7' },
        { name: 'normal', type: 'vector3', geomprop: 'Nworld' },
      ],
    };
    const surface = resolveSurface(graph)!;
    expect([...surface.inputs.keys()]).toEqual(['base_color', 'custom_flag', 'custom_count', 'normal']);
    expect(surface.inputs.get('base_color')?.source).toEqual({ kind: 'default', value: [0.1, 0.2, 0.3] });
    expect(surface.inputs.get('custom_flag')).toMatchObject({ type: 'boolean', source: { value: [1] } });
    expect(surface.inputs.get('custom_count')).toMatchObject({ type: 'integer', source: { value: [7] } });
    expect(surface.inputs.get('normal')?.source).toEqual({ kind: 'geomprop', name: 'Nworld' });
  });
  it('classifies every known family and fills the full declared interface', () => {
    const cases: Array<{ category: string; count: number }> = [
      { category: 'standard_surface', count: 42 },
      { category: 'open_pbr_surface', count: 41 },
      { category: 'disney_principled', count: 14 },
      { category: 'gltf_pbr', count: 24 },
      { category: 'UsdPreviewSurface', count: 14 },
    ];
    for (const { category, count } of cases) {
      const resolved = resolveSurface(graphOf({ category }));
      expect(resolved, category).not.toBeNull();
      expect(resolved!.family).toBe(category);
      expect(resolved!.inputs.size, category).toBe(count);
    }
  });

  it('applies official nodedef defaults for unauthored inputs', () => {
    const resolved = resolveSurface(graphOf({ category: 'standard_surface' }))!;
    expect(resolved.inputs.get('specular_roughness')!.source).toEqual({ kind: 'default', value: [0.2] });
    expect(resolved.inputs.get('coat_IOR')!.source).toEqual({ kind: 'default', value: [1.5] });
    // geomprop-backed inputs resolve to a geomprop source, not a literal default.
    expect(resolved.inputs.get('normal')!.source).toEqual({ kind: 'geomprop', name: 'Nworld' });
    expect(resolved.inputs.get('tangent')!.source).toEqual({ kind: 'geomprop', name: 'Tworld' });
  });

  it('parses authored literal values by type', () => {
    const resolved = resolveSurface(
      graphOf({
        category: 'standard_surface',
        inputs: [
          input('base_color', 'color3', { kind: 'value', value: '0.1, 0.2, 0.3', type: 'color3' }),
          input('metalness', 'float', { kind: 'value', value: '1.0', type: 'float' }),
          input('thin_walled', 'boolean', { kind: 'value', value: 'true', type: 'boolean' }),
        ],
      }),
    )!;
    expect(resolved.inputs.get('base_color')!.source).toEqual({ kind: 'value', value: [0.1, 0.2, 0.3] });
    expect(resolved.inputs.get('metalness')!.source).toEqual({ kind: 'value', value: [1] });
    expect(resolved.inputs.get('thin_walled')!.source).toEqual({ kind: 'value', value: [1] });
  });

  it('keeps supported upstream connections intact without diagnostics', () => {
    const diag = vi.fn();
    const resolved = resolveSurface(
      graphOf({
        category: 'standard_surface',
        inputs: [input('base_color', 'color3', { kind: 'connection', nodeId: 'tex', output: 'out' })],
        extraNodes: [upstream('tex', 'image')],
      }),
      { onDiagnostic: diag },
    )!;
    expect(resolved.inputs.get('base_color')!.source).toEqual({ kind: 'connection', nodeId: 'tex', output: 'out' });
    expect(diag).not.toHaveBeenCalled();
  });

  it('warns when a connection drives an unsupported node category (REQ-013)', () => {
    const diag = vi.fn<(d: Diagnostic) => void>();
    const resolved = resolveSurface(
      graphOf({
        category: 'standard_surface',
        inputs: [input('base_color', 'color3', { kind: 'connection', nodeId: 'weird' })],
        extraNodes: [upstream('weird', 'triplanarprojection_zzz')],
      }),
      { onDiagnostic: diag },
    )!;
    // The connection is preserved but a diagnostic is emitted.
    expect(resolved.inputs.get('base_color')!.source).toEqual({ kind: 'connection', nodeId: 'weird' });
    const warnings = diag.mock.calls.map((c) => c[0]).filter((d) => d.level === 'warning');
    expect(warnings.some((d) => d.message.includes('unsupported node'))).toBe(true);
  });

  it('resolves standard_surface version inheritance (1.0.0 vs default 1.0.1)', () => {
    const v100 = resolveSurface(graphOf({ category: 'standard_surface', version: '1.0.0' }))!;
    expect(v100.inputs.get('base')!.source).toEqual({ kind: 'default', value: [0.8] });
    expect(v100.inputs.get('base_color')!.source).toEqual({ kind: 'default', value: [1, 1, 1] });

    const v101 = resolveSurface(graphOf({ category: 'standard_surface', version: '1.0.1' }))!;
    expect(v101.inputs.get('base')!.source).toEqual({ kind: 'default', value: [1] });
    expect(v101.inputs.get('base_color')!.source).toEqual({ kind: 'default', value: [0.8, 0.8, 0.8] });

    // No version authored defaults to the current (1.0.1) interface.
    const vDefault = resolveSurface(graphOf({ category: 'standard_surface' }))!;
    expect(vDefault.inputs.get('base')!.source).toEqual({ kind: 'default', value: [1] });
  });

  it('resolves interface inputs from the provided lookup', () => {
    const iface = new Map<string, NormalizedSurfaceSource>([
      ['roughness_param', { kind: 'value', value: [0.42] }],
    ]);
    const resolved = resolveSurface(
      graphOf({
        category: 'standard_surface',
        inputs: [input('specular_roughness', 'float', { kind: 'interface', name: 'roughness_param' })],
      }),
      { interface: iface },
    )!;
    expect(resolved.inputs.get('specular_roughness')!.source).toEqual({ kind: 'value', value: [0.42] });
  });

  it('warns and falls back to default for an unresolved interface input (REQ-013)', () => {
    const diag = vi.fn<(d: Diagnostic) => void>();
    const resolved = resolveSurface(
      graphOf({
        category: 'standard_surface',
        inputs: [input('specular_roughness', 'float', { kind: 'interface', name: 'missing' })],
      }),
      { onDiagnostic: diag },
    )!;
    expect(resolved.inputs.get('specular_roughness')!.source).toEqual({ kind: 'default', value: [0.2] });
    expect(diag.mock.calls.some((c) => c[0].message.includes('unresolved'))).toBe(true);
  });

  it('warns for inputs outside the family nodedef interface (REQ-013)', () => {
    const diag = vi.fn<(d: Diagnostic) => void>();
    resolveSurface(
      graphOf({
        category: 'standard_surface',
        inputs: [input('not_a_real_input', 'float', { kind: 'value', value: '1', type: 'float' })],
      }),
      { onDiagnostic: diag },
    );
    expect(diag.mock.calls.some((c) => c[0].message.includes("Unknown input 'not_a_real_input'"))).toBe(true);
  });

  it('diagnoses and returns null for an unsupported surface family (REQ-013)', () => {
    const diag = vi.fn<(d: Diagnostic) => void>();
    const resolved = resolveSurface(graphOf({ category: 'my_custom_surface' }), { onDiagnostic: diag });
    expect(resolved).toBeNull();
    expect(diag.mock.calls.some((c) => c[0].level === 'error' && c[0].message.includes('Unsupported surface family'))).toBe(true);
  });

  it('diagnoses and returns null when no surfaceshader terminal is connected (REQ-013)', () => {
    const diag = vi.fn<(d: Diagnostic) => void>();
    const resolved = resolveSurface({ terminals: [], nodes: new Map() }, { onDiagnostic: diag });
    expect(resolved).toBeNull();
    expect(diag.mock.calls.some((c) => c[0].level === 'error')).toBe(true);
  });
});
