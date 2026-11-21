import { describe, expect, it } from 'vitest';
import type { ResolvedGraph, ResolvedInput } from '../../src/materialx/graph.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
import { materialBackendApproximations } from '../../src/render/material-approximations.ts';
import type { MaterialResource } from '../../src/render/scene-resources.ts';

const value = (name: string, type: string, raw: string): ResolvedInput =>
  ({ name, type, source: { kind: 'value', type, value: raw }, provenance: { namePath: `/s/${name}` } });

function material(inputs: ResolvedInput[]): MaterialResource {
  const graph: ResolvedGraph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
    nodes: new Map([
      ['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs, provenance: { namePath: '/s' } }],
      ['cd', { id: 'cd', category: 'geompropvalue', type: 'color3', provenance: { namePath: '/cd' },
        inputs: [value('geomprop', 'string', 'Cd')] }],
    ]),
  };
  const surfaceModule = emitLayeredSurface(graph, resolveSurface(graph, {})!, () => {});
  return { surfaceGraph: graph, surfaceModule } as unknown as MaterialResource;
}

describe('materialBackendApproximations', () => {
  it('reports lowering warnings in both backends and raster-only subsurface and emission approximations', () => {
    const resource = material([
      { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'cd' }, provenance: { namePath: '/s/base_color' } },
      value('subsurface', 'float', '0.5'),
      value('emission', 'float', '1'),
    ]);
    const lowering = expect.stringContaining("Unsupported geometry property 'Cd'");
    const pathTracing = materialBackendApproximations(resource, 'pathtracing');
    expect(pathTracing).toEqual([lowering]);
    expect(materialBackendApproximations(resource, 'raster', 'opaque')).toEqual([
      lowering,
      expect.stringContaining('Subsurface réduit à sa réponse diffuse'),
      expect.stringContaining('n’éclaire pas les autres objets'),
    ]);
  });

  it('reports nothing for a plain opaque surface', () => {
    expect(materialBackendApproximations(material([value('base', 'float', '0.8')]), 'raster', 'opaque')).toEqual([]);
  });
});
