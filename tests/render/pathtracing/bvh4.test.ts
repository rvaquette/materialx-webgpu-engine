import { describe, expect, it } from 'vitest';
import { buildBvh } from '../../../src/geometry/bvh.ts';
import { BVH4_FLOATS, packBvh4 } from '../../../src/render/pathtracing/bvh4.ts';
import { bvhTraversalWgsl, BVH_TRAVERSAL_WGSL } from '../../../src/render/pathtracing/bvh-wgsl.ts';
import { traversalFixture } from './bvh-traversal-cases.ts';

describe('uncompressed BVH4 experiment', () => {
  it('is opt-in and shares the exact reference triangle arithmetic', () => {
    const code = bvhTraversalWgsl('bvh4');
    expect(code.slice(0, code.indexOf('const WIDE_STRIDE')).trim()).toBe(
      BVH_TRAVERSAL_WGSL.slice(0, BVH_TRAVERSAL_WGSL.indexOf('fn aabb_hit(')).trim());
    expect(BVH_TRAVERSAL_WGSL).not.toContain('WIDE_STRIDE');
    expect(code).toContain('array<u32, 96>');
    expect(code).toContain('let leftFirst = leftT <= rightT');
    expect(code).not.toContain('array<f32, 2>');
    expect(code).not.toContain('array<u32, 2>');
  });

  it('packs empty and root-leaf scenes without changing canonical data', () => {
    expect(packBvh4(new Float32Array())).toHaveLength(0);
    const leaf = traversalFixture().nodes.slice(12, 24), copy = leaf.slice();
    const wide = packBvh4(leaf);
    expect(wide).toHaveLength(BVH4_FLOATS);
    expect(wide.slice(0, 12)).toEqual(copy);
    expect([wide[21], wide[33], wide[45]]).toEqual([-1, -1, -1]);
    expect(leaf).toEqual(copy);
  });

  it('preserves sibling groups, leaf ranges and triangle IDs', () => {
    const fixture = traversalFixture(), wide = packBvh4(fixture.nodes);
    expect(wide).toHaveLength(BVH4_FLOATS);
    expect(wide.slice(0, 12)).toEqual(fixture.nodes.slice(12, 24));
    expect(wide.slice(24, 36)).toEqual(fixture.nodes.slice(24, 36));
    expect(wide[21]).toBe(-1);
    expect(wide[45]).toBe(-1);
  });

  it.each([1, 4, 5, 16, 65, 256])('collapses a %i-triangle hierarchy and covers every leaf once', count => {
    const positions = new Float32Array(count * 9);
    for (let tri = 0; tri < count; tri++) positions.set([tri, 0, 0, tri + 0.5, 0, 0, tri, 1, 0], tri * 9);
    const bvh = buildBvh(positions, Uint32Array.from({ length: count * 3 }, (_, i) => i), { splitStrategy: 'sah' });
    const binary = Float32Array.from(bvh.nodes.flatMap(n =>
      [...n.min, n.left, ...n.max, n.right, n.start, n.count, 0, 0]));
    const wide = packBvh4(binary);
    const seen = new Set<number>(), covered = new Set<number>(), pending = [0];
    while (pending.length) {
      const node = pending.pop()!;
      expect(seen.has(node)).toBe(false);
      seen.add(node);
      for (let lane = 0; lane < 4; lane++) {
        const base = node * BVH4_FLOATS + lane * 12, size = wide[base + 9]!;
        if (size < 0) continue;
        if (size === 0) pending.push(wide[base + 3]!);
        else for (let i = wide[base + 8]!; i < wide[base + 8]! + size; i++) {
          expect(covered.has(i)).toBe(false);
          covered.add(i);
        }
      }
    }
    expect(seen.size).toBe(wide.length / BVH4_FLOATS);
    expect(covered.size).toBe(count);
    expect(wide).toEqual(packBvh4(binary));
  });

  it('rejects malformed, cyclic, unreachable and non-reconstructible hierarchies', () => {
    expect(() => packBvh4(new Float32Array(1))).toThrow(/complete/);
    const cyclic = traversalFixture().nodes;
    cyclic[3] = 0;
    expect(() => packBvh4(cyclic)).toThrow(/topology/);
    const nonUnion = traversalFixture().nodes;
    nonUnion[0] = -2;
    expect(() => packBvh4(nonUnion)).toThrow(/exact binary bounds/);
    const unreachable = new Float32Array(48);
    unreachable.set(traversalFixture().nodes);
    expect(() => packBvh4(unreachable)).toThrow(/Unreachable/);
  });
});
