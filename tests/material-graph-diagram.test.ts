import { describe, expect, it } from 'vitest';
import { layoutMaterialGraph } from '../src/material-graph-diagram.ts';
import type { ResolvedNode } from '../src/materialx/graph.ts';

function node(id: string, upstream: readonly string[] = []): ResolvedNode {
  return {
    id, category: 'test', type: 'float', provenance: { namePath: id },
    inputs: upstream.map((target, i) => ({
      name: `input${i}`, type: 'float', provenance: { namePath: `${id}/input${i}` },
      source: { kind: 'connection', nodeId: target, output: 'out' },
    })),
  };
}

function layout(...nodes: ResolvedNode[]) {
  return layoutMaterialGraph({ nodes: new Map(nodes.map(node => [node.id, node])), terminals: [] });
}

describe('MaterialX graph diagram layout', () => {
  it('places each dependency upstream, including a shared input used twice', () => {
    const { positions, edges } = layout(node('surface', ['mix', 'texture']), node('noise'), node('texture'), node('mix', ['texture', 'texture']));
    expect(positions.get('texture')!.x).toBeLessThan(positions.get('mix')!.x);
    expect(positions.get('mix')!.x).toBeLessThan(positions.get('surface')!.x);
    expect(positions.get('noise')!.y).not.toBe(positions.get('texture')!.y);
    expect(edges.filter(edge => edge.from === 'texture' && edge.to === 'mix').map(edge => edge.input))
      .toEqual(['input0', 'input1']);
  });

  it('keeps cyclic nodes visible and does not draw links to missing nodes', () => {
    const { positions, edges } = layout(node('a', ['b']), node('b', ['a']), node('constant'), node('surface', ['constant', 'missing']));
    expect(new Set([...positions.values()].map(({ x, y }) => `${x},${y}`)).size).toBe(4);
    expect(positions.get('surface')!.x).toBeGreaterThan(positions.get('constant')!.x);
    expect(edges.map(({ from, to }) => `${from}→${to}`)).toEqual(['b→a', 'a→b', 'constant→surface']);
  });
});
