import { describe, expect, it } from 'vitest';
import { composeSurfaceLayered, evaluateSurfaceToLayered, prepareSurface } from '../../src/compiler/surface-eval.ts';
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedNode } from '../../src/materialx/graph.ts';

const BRICK: [number, number, number] = [0.661876, 0.19088, 0];

/** standard_surface whose base_color is driven by a connected constant node. */
function brickGraph(): ResolvedGraph {
  const surfaceNode: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'brick' }, provenance: { namePath: '/mat/base_color' } },
    ],
    provenance: { namePath: '/mat/SR' },
  };
  const brick: ResolvedNode = {
    id: 'brick',
    category: 'constant',
    type: 'color3',
    inputs: [
      { name: 'value', type: 'color3', source: { kind: 'value', value: '0.661876, 0.19088, 0', type: 'color3' }, provenance: { namePath: '/mat/brick/value' } },
    ],
    provenance: { namePath: '/mat/brick' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode], ['brick', brick]]),
  };
}

/** standard_surface with a constant literal base_color (no connection). */
function constantGraph(): ResolvedGraph {
  const surfaceNode: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'value', value: '0.2, 0.4, 0.6', type: 'color3' }, provenance: { namePath: '/mat/base_color' } },
    ],
    provenance: { namePath: '/mat/SR' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode]]),
  };
}

const diffuse = (c: ReturnType<typeof surfaceGraphToLayered>) => c.lobes.find((l) => l.kind === 'burley_diffuse')!;

describe('evaluateSurfaceToLayered (T057i3)', () => {
  it('evaluates a connected procedural base_color instead of the nodedef default', () => {
    const graph = brickGraph();
    const surface = resolveSurface(graph, {})!;
    expect(surface).not.toBeNull();
    const closure = evaluateSurfaceToLayered(graph, surface);
    const lobe = diffuse(closure);
    expect(lobe.color[0]).toBeCloseTo(BRICK[0], 5);
    expect(lobe.color[1]).toBeCloseTo(BRICK[1], 5);
    expect(lobe.color[2]).toBeCloseTo(BRICK[2], 5);
    // Not the white nodedef default that the pre-i3 constant lowering fell back to.
    expect(lobe.color[0]).not.toBeCloseTo(1, 3);
  });

  it('lowers a constant surface byte-identically to surfaceGraphToLayered (non-regression)', () => {
    const graph = constantGraph();
    const surface = resolveSurface(graph, {})!;
    const composed = composeSurfaceLayered(prepareSurface(graph, surface));
    const direct = surfaceGraphToLayered(surface);
    expect(composed).toEqual(direct);
  });

  it('prepares once and composes at several shading points', () => {
    const graph = brickGraph();
    const surface = resolveSurface(graph, {})!;
    const prepared = prepareSurface(graph, surface);
    const a = composeSurfaceLayered(prepared, { texcoord: [0, 0] });
    const b = composeSurfaceLayered(prepared, { texcoord: [1, 1] });
    // base_color is constant math here, so the two points agree.
    expect(diffuse(a).color).toEqual(diffuse(b).color);
    expect(diffuse(a).color[0]).toBeCloseTo(BRICK[0], 5);
  });
});
