import { describe, expect, it } from 'vitest';
import {
  graphNodePositionStorageKey, layoutMaterialGraph, parseGraphNodePositions, readGraphNodePositions,
  unsupportedSurfaceGraphNodes, writeGraphNodePositions,
} from '../src/material-graph-diagram.ts';
import { compareMaterialGraphs } from '../src/materialx/graph-comparison.ts';
import type { ResolvedGraph, ResolvedNode } from '../src/materialx/graph.ts';

function node(id: string, upstream: readonly string[] = [], category = 'test'): ResolvedNode {
  return {
    id, category, type: 'float', provenance: { namePath: id },
    inputs: upstream.map((target, i) => ({
      name: `input${i}`, type: 'float', provenance: { namePath: `${id}/input${i}` },
      source: { kind: 'connection', nodeId: target, output: 'out' },
    })),
  };
}

function graph(...nodes: ResolvedNode[]) {
  return { nodes: new Map(nodes.map(node => [node.id, node])), terminals: [] };
}

function layout(...nodes: ResolvedNode[]) {
  return layoutMaterialGraph(graph(...nodes));
}

describe('MaterialX graph diagram layout', () => {
  it('restores valid saved positions for existing nodes and rejects corrupt coordinates', () => {
    expect(parseGraphNodePositions(null, new Set(['a']))).toEqual(new Map());
    expect(parseGraphNodePositions('{"a":{"x":48,"y":96},"removed":{"x":80,"y":80}}', new Set(['a'])))
      .toEqual(new Map([['a', { x: 48, y: 96 }]]));
    expect(() => parseGraphNodePositions('{"a":{"x":-1,"y":96}}', new Set(['a']))).toThrow('Position enregistrée invalide');
    expect(() => parseGraphNodePositions('{', new Set(['a']))).toThrow();
  });

  it('round-trips layouts with independent object, material and variant keys', () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    const current = graphNodePositionStorageKey('/World/Ball', 'mat')!;
    const variantA = graphNodePositionStorageKey('/World/Ball', 'mat', 'A')!;
    const variantB = graphNodePositionStorageKey('/World/Ball', 'mat', 'B')!;
    expect(new Set([current, variantA, variantB]).size).toBe(3);
    writeGraphNodePositions(storage, variantA, new Map([['surface', { x: 48, y: 96 }]]));
    expect(readGraphNodePositions(storage, variantA, new Set(['surface'])))
      .toEqual(new Map([['surface', { x: 48, y: 96 }]]));
    expect(readGraphNodePositions(storage, variantB, new Set(['surface']))).toEqual(new Map());
  });

  it('places each dependency upstream, including a shared input used twice', () => {
    const { positions, edges } = layout(node('surface', ['mix', 'texture']), node('noise'), node('texture'), node('mix', ['texture', 'texture']));
    expect(positions.get('texture')!.x).toBeLessThan(positions.get('mix')!.x);
    expect(positions.get('mix')!.x).toBeLessThan(positions.get('surface')!.x);
    expect(positions.get('noise')!.y).not.toBe(positions.get('texture')!.y);
    expect(edges.filter(edge => edge.from === 'texture' && edge.to === 'mix').map(edge => edge.input))
      .toEqual(['input0', 'input1']);
  });

  describe('MaterialX graph A/B comparison', () => {
    it('reports changed literals and links as well as added and removed nodes', () => {
      const literal = (value: string) => ({
        name: 'roughness', type: 'float', provenance: { namePath: 'surface/roughness' },
        source: { kind: 'value' as const, type: 'float', value },
      });
      const a = node('surface', ['old']);
      const b = node('surface', ['new']);
      a.inputs.push(literal('0.4'));
      b.inputs.push(literal('0.8'));
      expect(compareMaterialGraphs(graph(a, node('old')), graph(b, node('new')))).toEqual([
        { node: 'surface', input: 'input0', a: '← old.out (float)', b: '← new.out (float)' },
        { node: 'surface', input: 'roughness', a: '0.4 (float)', b: '0.8 (float)' },
        { node: 'old', a: 'test (float)' },
        { node: 'new', b: 'test (float)' },
      ]);
    });

    it('ignores equivalent bindings and node ordering across distinct snapshots', () => {
      expect(compareMaterialGraphs(graph(node('root', ['source']), node('source')), graph(node('source'), node('root', ['source']))))
        .toEqual([]);
    });
  });

  it('keeps cyclic nodes visible and does not draw links to missing nodes', () => {
    const { positions, edges } = layout(node('a', ['b']), node('b', ['a']), node('constant'), node('surface', ['constant', 'missing']));
    expect(new Set([...positions.values()].map(({ x, y }) => `${x},${y}`)).size).toBe(4);
    expect(positions.get('surface')!.x).toBeGreaterThan(positions.get('constant')!.x);
    expect(edges.map(({ from, to }) => `${from}→${to}`)).toEqual(['b→a', 'a→b', 'constant→surface']);
  });

  it('flags only unsupported nodes reachable upstream of the surface terminal', () => {
    const graph: ResolvedGraph = {
      nodes: new Map([
        ['surface', { ...node('surface', ['add'], 'standard_surface'), type: 'surfaceshader' }],
        ['add', node('add', ['custom_noise'], 'add')],
        ['custom_noise', node('custom_noise', [], 'custom_noise')],
        ['unreachable', node('unreachable', [], 'custom_node')],
      ]),
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'surface', provenance: { namePath: 'surface' } }],
    };
    expect(unsupportedSurfaceGraphNodes(graph)).toEqual(['custom_noise']);
  });
});
