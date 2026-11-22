import { describe, expect, it } from 'vitest';
import { buildPathTraceScene, PT_NODE_FLOATS, PT_TRIANGLE_FLOATS, type PathTraceScene } from '../../../src/render/pathtracing/scene-buffers.ts';
import { PathTraceDynamics, REBUILD_COST_RATIO, type DynamicInstanceSource } from '../../../src/render/pathtracing/dynamic-geometry.ts';
import { rebuildPackedBvh } from '../../../src/render/pathtracing/bvh-pack.ts';
import type { GeometryResource, MaterialResource, SceneResources } from '../../../src/render/scene-resources.ts';
import { multiply4, rotationAxis4, translation4, type Mat4 } from '../../../src/scene/transforms.ts';

function grid(prototypeId: string, size: number): GeometryResource {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) { positions.push(x, y, 0); normals.push(0, 0, 1); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = y * (size + 1) + x;
    indices.push(a, a + 1, a + size + 2, a, a + size + 2, a + size + 1);
  }
  return {
    prototypeId, primPath: prototypeId, indices: new Uint32Array(indices),
    streams: [{ name: 'position', data: new Float32Array(positions), components: 3 }, { name: 'normal', data: new Float32Array(normals), components: 3 }],
    vertexCount: positions.length / 3, triangleCount: indices.length / 3,
  } as unknown as GeometryResource;
}

function resourcesWith(transforms: Mat4[]): SceneResources {
  return {
    geometries: new Map([['/grid', grid('/grid', 6)]]),
    materials: new Map([['mat', { unitKey: 'mat', features: { passes: [] } } as unknown as MaterialResource]]),
    instances: transforms.map((transform, i) => ({ id: `/i${i}`, prototypeId: '/grid', primPath: `/i${i}`, transform, hasGeometry: true, materialKey: 'mat' })),
    tlas: { nodes: [], instanceOrder: new Uint32Array(), bounds: { min: [0, 0, 0], max: [0, 0, 0] } },
    pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  } as unknown as SceneResources;
}

function sourceFor(resources: SceneResources, model: Mat4, hidden = false): DynamicInstanceSource {
  const geometry = resources.geometries.get('/grid')!;
  return {
    model, indices: geometry.indices, hidden,
    positions: geometry.streams.find(s => s.name === 'position')!.data,
    normals: geometry.streams.find(s => s.name === 'normal')!.data,
  };
}

/** Every node bound equals the union of its children (or its triangles). */
function expectTightBounds(scene: PathTraceScene): void {
  for (let node = scene.nodeCount - 1; node >= 0; node--) {
    const b = node * PT_NODE_FLOATS;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const grow = (x: number, a: number) => { min[a] = Math.min(min[a]!, x); max[a] = Math.max(max[a]!, x); };
    if (scene.nodes[b + 9]! > 0) {
      for (let i = scene.nodes[b + 8]!; i < scene.nodes[b + 8]! + scene.nodes[b + 9]!; i++) {
        const t = scene.triangleOrder[i]! * PT_TRIANGLE_FLOATS;
        for (let v = 0; v < 9; v++) grow(scene.triangles[t + v]!, v % 3);
      }
    } else {
      for (const child of [scene.nodes[b + 3]!, scene.nodes[b + 7]!]) {
        for (let a = 0; a < 3; a++) { grow(scene.nodes[child * PT_NODE_FLOATS + a]!, a); grow(scene.nodes[child * PT_NODE_FLOATS + 4 + a]!, a); }
      }
    }
    expect([...scene.nodes.subarray(b, b + 3)]).toEqual(min.map(Math.fround));
    expect([...scene.nodes.subarray(b + 4, b + 7)]).toEqual(max.map(Math.fround));
  }
}

describe('dynamic path-tracing geometry', () => {
  const start = [0, 10, 20, 30, 40].map(x => translation4(x, 0, 0));

  it('rewrites moved instances exactly as a full build and refits only their ancestors', () => {
    const resources = resourcesWith(start);
    const scene = buildPathTraceScene(resources);
    const cachedNodes = scene.nodes, cachedTriangles = scene.triangles;
    const nodesBefore = cachedNodes.slice(), trianglesBefore = cachedTriangles.slice();
    const moved = multiply4(translation4(3, 2, 1), rotationAxis4(1, 40));
    const dynamics = new PathTraceDynamics(scene);
    const range = scene.transformRanges!.find(r => r.instanceId === '/i1')!;
    const upload = dynamics.update([{ range, source: sourceFor(resources, moved) }]);

    const rebuilt = buildPathTraceScene(resourcesWith(start.map((m, i) => i === 1 ? moved : m)));
    expect(scene.triangles).toEqual(rebuilt.triangles);
    expectTightBounds(scene);
    expect(upload.triangles).toEqual([range.firstTriangle, range.firstTriangle + range.triangleCount]);
    expect(upload.nodes[0]![0]).toBe(0);
    expect(upload.nodes.reduce((n, [a, b]) => n + b - a, 0)).toBeLessThan(scene.nodeCount);
    expect(range.model).toBe(moved);
    // Arrays shared with geometry caches are never mutated.
    expect(cachedNodes).toEqual(nodesBefore);
    expect(cachedTriangles).toEqual(trianglesBefore);
  });

  it('collapses hidden instances to points and restores them when shown', () => {
    const resources = resourcesWith(start);
    const scene = buildPathTraceScene(resources);
    const original = scene.triangles.slice();
    const dynamics = new PathTraceDynamics(scene);
    const range = scene.transformRanges![0]!;
    dynamics.update([{ range, source: sourceFor(resources, start[0]!, true) }]);
    for (let t = range.firstTriangle; t < range.firstTriangle + range.triangleCount; t++) {
      const b = t * PT_TRIANGLE_FLOATS;
      expect([...scene.triangles.subarray(b + 3, b + 9)]).toEqual([...scene.triangles.subarray(b, b + 3), ...scene.triangles.subarray(b, b + 3)]);
    }
    expectTightBounds(scene);
    dynamics.update([{ range, source: sourceFor(resources, start[0]!) }]);
    expect(scene.triangles).toEqual(original);
  });

  it('refits the whole tree when most triangles move', () => {
    const resources = resourcesWith(start);
    const scene = buildPathTraceScene(resources);
    const dynamics = new PathTraceDynamics(scene);
    const upload = dynamics.update(scene.transformRanges!.map(range => ({ range, source: sourceFor(resources, translation4(0, 5, 0)) })));
    expect(upload.nodes).toEqual([[0, scene.nodeCount]]);
    expectTightBounds(scene);
    expect(scene.bounds.min[1]).toBe(5);
    expect(dynamics.needsRebuild).toBe(false);
  });

  it('detects a degraded refit and adopts a rebuilt topology refitted to the current triangles', () => {
    const resources = resourcesWith(start);
    const scene = buildPathTraceScene(resources);
    const dynamics = new PathTraceDynamics(scene);
    expect(dynamics.costRatio).toBeCloseTo(1, 6);
    // Scattering neighbours of the row apart makes their shared subtrees huge.
    const moved = [translation4(20, 60, 0), translation4(10, -60, 0), translation4(20, 0, 0), translation4(30, 0, 60), translation4(40, 0, -60)];
    scene.transformRanges!.forEach((range, i) => dynamics.update([{ range, source: sourceFor(resources, moved[i]!) }]));
    const first = scene.transformRanges![0]!;
    expect(dynamics.costRatio).toBeGreaterThan(REBUILD_COST_RATIO);
    expect(dynamics.needsRebuild).toBe(true);
    // The rebuild was computed from a stale snapshot: adopt() refits it to the moved triangles.
    const stale = rebuildPackedBvh(scene.triangles.slice(), scene.triangleCount, 0);
    dynamics.update([{ range: first, source: sourceFor(resources, translation4(20, 61, 0)) }]);
    const upload = dynamics.adopt(stale.nodes, stale.nodeCount, stale.triangleOrder);
    expect(upload).toEqual({ nodes: [[0, stale.nodeCount]], topology: true });
    expect(scene.nodeCount).toBe(stale.nodeCount);
    expectTightBounds(scene);
    // The reference is the tree as built; the small later motion barely changes it.
    expect(dynamics.costRatio).toBeGreaterThan(0.9);
    expect(dynamics.needsRebuild).toBe(false);
    expect(scene.bounds.max[1]).toBe(67);
    expect(() => dynamics.adopt(stale.nodes, stale.nodeCount, new Uint32Array(1))).toThrow('does not match');
  });
});
