import { describe, expect, it } from 'vitest';
import { buildDisneyAcceleration } from '../../../src/render/pathtracing/disney-acceleration.ts';
import { disneyGeometryWrites, disneyInstanceWrites } from '../../../src/render/pathtracing/disney-dynamics.ts';
import { packDisneyGeometryTextures } from '../../../src/render/pathtracing/disney-geometry-textures.ts';
import { texelRows } from '../../../src/render/pathtracing/disney-gpu-backend.ts';
import type { DisneySceneData } from '../../../src/render/pathtracing/disney-scene.ts';
import { DisneyTextureRegistry } from '../../../src/render/pathtracing/disney-texture-array.ts';
import { buildGeometry, type InstanceResource, type SceneResources } from '../../../src/render/scene-resources.ts';
import { translation4 } from '../../../src/scene/transforms.ts';
import { buildTlas } from '../../../src/geometry/bvh.ts';

function sceneData(): { data: DisneySceneData; resources: SceneResources } {
  const geometry = buildGeometry('triangle', '/Triangle', {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]), attributes: new Map(), subsets: [],
    subdivision: { scheme: 'none', level: 0, applied: false }, displacement: { required: false },
  });
  const instances: InstanceResource[] = ['a', 'b', 'c'].map((id, i) => ({
    id, primPath: `/${id}`, prototypeId: 'triangle', transform: translation4(i * 10, 0, 0), hasGeometry: true, materialKey: 'm',
  }));
  const resources: SceneResources = {
    geometries: new Map([['triangle', geometry]]), materials: new Map(), instances,
    tlas: buildTlas([]), pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  };
  const acceleration = buildDisneyAcceleration(resources);
  return {
    resources,
    data: {
      geometry: packDisneyGeometryTextures(acceleration, [3, 4, 5]), acceleration,
      materials: [], textures: new DisneyTextureRegistry(), warnings: [],
    },
  };
}

/** TLAS nodes [min, max, [left, right, leaf]] of a nodes write, following children from the root. */
function tlasLeaves(nodes: Float32Array, base: number): Array<{ instance: number; material: number; min: number[]; max: number[] }> {
  const leaves = [];
  const pending = [base];
  while (pending.length) {
    const slot = pending.pop()! - base;
    const o = slot * 12;
    const [left, right, leaf] = [nodes[o + 8]!, nodes[o + 9]!, nodes[o + 10]!];
    if (leaf < 0) leaves.push({ instance: -leaf - 1, material: right, min: [...nodes.slice(o, o + 3)], max: [...nodes.slice(o + 4, o + 7)] });
    else pending.push(left, right);
  }
  return leaves.sort((a, b) => a.instance - b.instance);
}

describe('Disney dynamic updates', () => {
  it('rewrites transforms and rebuilds the TLAS over visible instances in its reserved slots', () => {
    const { data, resources } = sceneData();
    const moved = resources.instances.map(instance => instance.id === 'b' ? { ...instance, transform: translation4(0, 5, 0) } : instance);
    const writes = disneyInstanceWrites(data, moved, new Set(['c']));
    const transforms = writes.find(write => write.target === 'transforms')!;
    expect([...transforms.data.slice(16, 32)]).toEqual(translation4(0, 5, 0));
    const nodes = writes.find(write => write.target === 'nodes')!;
    expect(nodes.firstTexel).toBe(data.geometry.topLevelIndex * 3);
    expect(nodes.data.length).toBe(5 * 12);
    expect(tlasLeaves(nodes.data, data.geometry.topLevelIndex)).toEqual([
      { instance: 0, material: 3, min: [0, 0, 0], max: [1, 1, 0] },
      { instance: 1, material: 4, min: [0, 5, 0], max: [1, 6, 0] },
    ]);
    expect(() => disneyInstanceWrites(data, moved.slice(1), new Set())).toThrow('prepared again');
  });

  it('parks the TLAS root on an unreachable point when every instance is hidden', () => {
    const { data, resources } = sceneData();
    const nodes = disneyInstanceWrites(data, resources.instances, new Set(['a', 'b', 'c'])).find(write => write.target === 'nodes')!;
    expect([...nodes.data.slice(0, 3)]).toEqual([...nodes.data.slice(4, 7)]);
    expect(nodes.data[0]).toBeGreaterThan(1e18);
    expect(nodes.data[10]).toBe(0);
  });

  it('refits a deformed BLAS and feeds its new bounds to the TLAS', () => {
    const { data, resources } = sceneData();
    const geometry = resources.geometries.get('triangle')!;
    (geometry as { streams: typeof geometry.streams }).streams = geometry.streams.map(stream =>
      stream.name === 'position' ? { ...stream, data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 3, 0]) } : stream);
    const writes = disneyGeometryWrites(data, ['triangle']);
    expect(writes.map(write => [write.target, write.firstTexel])).toEqual([['vertices', 0], ['normals', 0], ['nodes', 0]]);
    expect([...writes[0]!.data.slice(8, 11)]).toEqual([0, 3, 0]);
    expect([...writes[2]!.data.slice(4, 7)]).toEqual([1, 3, 0]);
    const nodes = disneyInstanceWrites(data, resources.instances, new Set()).find(write => write.target === 'nodes')!;
    expect(tlasLeaves(nodes.data, data.geometry.topLevelIndex).every(leaf => leaf.max[1] === 3)).toBe(true);
    expect(disneyGeometryWrites(data, ['missing'])).toEqual([]);
  });

  it('splits texel writes into texture rows', () => {
    expect(texelRows(4, 6, 9)).toEqual([
      { texel: 0, x: 2, y: 1, columns: 2, rows: 1 },
      { texel: 2, x: 0, y: 2, columns: 4, rows: 1 },
      { texel: 6, x: 0, y: 3, columns: 3, rows: 1 },
    ]);
    expect(texelRows(4, 0, 9)).toEqual([
      { texel: 0, x: 0, y: 0, columns: 4, rows: 2 },
      { texel: 8, x: 0, y: 2, columns: 1, rows: 1 },
    ]);
  });
});
