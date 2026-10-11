import { describe, expect, it } from 'vitest';
import { buildBvh, buildTlas, refitBvh, refitTlas, reorderTriangleData, transformAabb, type Aabb } from '../../src/geometry/bvh.ts';

function twoSeparatedTriangles(): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    100, 0, 0, 101, 0, 0, 100, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  return { positions, indices };
}

describe('buildBvh', () => {
  it('splits separated triangles into leaves and keeps a permutation', () => {
    const { positions, indices } = twoSeparatedTriangles();
    const bvh = buildBvh(positions, indices, { maxLeafTriangles: 1 });
    expect(bvh.nodes.length).toBe(3); // root + two leaves
    expect(Array.from(bvh.triangleOrder).sort()).toEqual([0, 1]);
    expect(bvh.bounds.min[0]).toBeCloseTo(0);
    expect(bvh.bounds.max[0]).toBeCloseTo(101);
  });

  it('refits bounds in place when a vertex moves without retopology', () => {
    const { positions, indices } = twoSeparatedTriangles();
    const bvh = buildBvh(positions, indices, { maxLeafTriangles: 1 });
    positions[4 * 3] = 200; // push one vertex of the far triangle outward
    refitBvh(bvh, positions, indices);
    expect(bvh.bounds.max[0]).toBeCloseTo(200);
  });

  it('reorders per-triangle data to match the leaf order', () => {
    const { positions, indices } = twoSeparatedTriangles();
    const bvh = buildBvh(positions, indices, { maxLeafTriangles: 1 });
    const faceMaterial = ['a', 'b'];
    const reordered = reorderTriangleData(faceMaterial, bvh.triangleOrder);
    expect(reordered.length).toBe(2);
    expect(reordered.sort()).toEqual(['a', 'b']);
  });
});

describe('buildTlas', () => {
  const boxes: Aabb[] = [
    { min: [0, 0, 0], max: [1, 1, 1] },
    { min: [10, 0, 0], max: [11, 1, 1] },
    { min: [20, 0, 0], max: [21, 1, 1] },
  ];

  it('bounds the union of instance AABBs', () => {
    const tlas = buildTlas(boxes, { maxLeafTriangles: 1 });
    expect(Array.from(tlas.instanceOrder).sort()).toEqual([0, 1, 2]);
    expect(tlas.bounds.min[0]).toBeCloseTo(0);
    expect(tlas.bounds.max[0]).toBeCloseTo(21);
  });

  it('refits after an instance transform changes', () => {
    const tlas = buildTlas(boxes, { maxLeafTriangles: 1 });
    const moved: Aabb[] = [...boxes.slice(0, 2), { min: [40, 0, 0], max: [41, 1, 1] }];
    refitTlas(tlas, moved);
    expect(tlas.bounds.max[0]).toBeCloseTo(41);
  });
});

describe('transformAabb', () => {
  it('maps a local box through a translation', () => {
    const local: Aabb = { min: [0, 0, 0], max: [1, 1, 1] };
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
    const world = transformAabb(local, m);
    expect(world.min[0]).toBeCloseTo(5);
    expect(world.max[0]).toBeCloseTo(6);
  });
});
