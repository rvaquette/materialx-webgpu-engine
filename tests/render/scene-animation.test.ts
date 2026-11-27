import { describe, expect, it, vi } from 'vitest';
import { animateScene, deformGeometry, isInvisible } from '../../src/render/scene-animation.ts';
import { gpuDeformations } from '../../src/render/deformer-animation.ts';
import { buildGeometry, type SceneResources } from '../../src/render/scene-resources.ts';
import { prepareMesh } from '../../src/geometry/prepare.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { meshSourceFromScene } from '../../src/render/usd-scene-assets.ts';
import { evaluateSceneAt } from '../../src/scene/time.ts';

const SCENE = `#usda 1.0
def Xform "World"
{
    token visibility.timeSamples = { 0: "inherited", 5: "invisible" }
    def Mesh "Quad"
    {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        point3f[] points.timeSamples = {
            0: [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)],
            10: [(0, 0, 0), (1, 0, 0), (1, 1, 2), (0, 1, 2)],
        }
        double3 xformOp:translate.timeSamples = { 0: (0, 0, 0), 10: (10, 0, 0) }
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
`;

async function setup() {
  const scene = await importUsdStage('a.usda', { reader: { read: async () => SCENE } });
  const prepared = prepareMesh({ points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faceVertexCounts: [4], faceVertexIndices: [0, 1, 2, 3] });
  const geometry = buildGeometry('/World/Quad', '/World/Quad', prepared);
  const resources = {
    geometries: new Map([['/World/Quad', geometry]]),
    instances: [{ id: '/World/Quad', prototypeId: '/World/Quad', primPath: '/World/Quad', transform: [], hasGeometry: true }],
  } as unknown as SceneResources;
  return { scene, geometry, resources };
}

describe('scene animation', () => {
  it('warns and uses USD samples when a NanoVDB deformer resource is unavailable', async () => {
    const { scene } = await setup();
    const prim = scene.prims.get('/World/Quad')!;
    const attributes = new Map(prim.attributes);
    attributes.set('engine:deformerBasePoints', {
      name: 'engine:deformerBasePoints', typeName: 'point3f[]', value: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    });
    attributes.set('engine:deformers', {
      name: 'engine:deformers', typeName: 'string',
      value: JSON.stringify([{ kind: 'Field', fieldGrid: { url: 'missing.nvdb', name: 'velocity', type: 'vec3f' } }]),
    });
    const prims = new Map(scene.prims);
    prims.set(prim.path, { ...prim, attributes });
    const diagnostics: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    try {
      const device = { limits: { maxStorageBufferBindingSize: 1_000_000, maxBufferSize: 1_000_000 } } as GPUDevice;
      const sources = await gpuDeformations({ ...scene, prims }, device, 'https://example.test/',
        diagnostic => diagnostics.push(`${diagnostic.message} ${diagnostic.detail ?? ''}`));
      expect(sources).toHaveLength(0);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatch(/using baked USD samples.*HTTP 404/);
      expect(fetchMock).toHaveBeenCalledWith('https://example.test/missing.nvdb', undefined);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('samples transforms, inherited visibility and deforming points', async () => {
    const { scene, resources } = await setup();
    const early = animateScene(scene, 2, resources);
    expect(early.transforms.get('/World/Quad')![12]).toBeCloseTo(2);
    expect(early.hidden.size).toBe(0);
    const late = animateScene(scene, 10, resources);
    expect(late.hidden.has('/World/Quad')).toBe(true);
    const deformed = late.deformed.get('/World/Quad')!;
    // The two upper points rose by 2: the quad tilts and its normal follows.
    expect(Math.max(...deformed.positions.filter((_, i) => i % 3 === 2))).toBe(2);
    const n = [...deformed.normals.subarray(0, 3)];
    expect(n[1]).toBeCloseTo(-2 / Math.sqrt(5));
    expect(n[2]).toBeCloseTo(1 / Math.sqrt(5));
  });

  it('skips baked mesh samples only when all geometry for the prim is overridden', async () => {
    const { scene, geometry, resources } = await setup();
    const override = { positions: new Float32Array(geometry.vertexCount * 3), normals: new Float32Array(geometry.vertexCount * 3) };
    const overrides = new Map([['/World/Quad', override]]);
    const result = animateScene(scene, 2, resources, { geometryOverrides: overrides });
    expect(result.deformed.size).toBe(0);
    expect(result.transforms.get('/World/Quad')![12]).toBeCloseTo(2);
    const shared = { ...resources, geometries: new Map([...resources.geometries, ['other', geometry]]) };
    expect(animateScene(scene, 2, shared, { geometryOverrides: overrides }).deformed.size).toBe(2);
  });

  it('keeps the prepared vertex order and refuses a different point count', async () => {
    const { geometry } = await setup();
    const same = deformGeometry(geometry, [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])!;
    expect(same.positions).toEqual(geometry.streams.find(s => s.name === 'position')!.data);
    expect(deformGeometry(geometry, [0, 0, 0])).toBeUndefined();
  });

  it('maps indexed animated vertex normals through the source points', async () => {
    const { geometry } = await setup();
    const points = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const normals = {
      name: 'normals', interpolation: 'vertex' as const, elementSize: 3,
      values: [0, 0, 1, 0, 1, 0], indices: [1, 0, 1, 0],
    };
    const result = deformGeometry(geometry, points, normals)!;
    for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
      const index = normals.indices[geometry.sourcePoints![vertex]!]!;
      expect([...result.normals.slice(vertex * 3, vertex * 3 + 3)]).toEqual(normals.values.slice(index * 3, index * 3 + 3));
    }
    expect(deformGeometry(geometry, points, { ...normals, indices: [9] })).toBeUndefined();
    expect(deformGeometry(geometry, points, { ...normals, interpolation: 'faceVarying' })).toBeUndefined();
  });

  it('updates normals even when only normals are time-sampled', async () => {
    const scene = await importUsdStage('normals.usda', { reader: { read: async () => `#usda 1.0
def Mesh "Quad" {
  uniform token subdivisionScheme = "none"
  int[] faceVertexCounts = [4]
  int[] faceVertexIndices = [0, 1, 2, 3]
  point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
  normal3f[] normals = [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)] (interpolation = "vertex")
  normal3f[] normals.timeSamples = {
    0: [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)],
    10: [(0, 1, 0), (0, 1, 0), (0, 1, 0), (0, 1, 0)],
  }
}` } });
    const meshFor = (at: typeof scene, path: string) => meshSourceFromScene(at).meshFor(path);
    const geometry = buildGeometry('/Quad', '/Quad', prepareMesh(meshFor(evaluateSceneAt(scene, 0), '/Quad')!));
    const resources = { geometries: new Map([['/Quad', geometry]]), instances: [] } as unknown as SceneResources;
    const result = animateScene(scene, 10, resources, { meshFor }).deformed.get('/Quad')!;
    expect([...result.normals.slice(0, 3)]).toEqual([0, 1, 0]);
    expect(result.positions).toEqual(geometry.streams.find(stream => stream.name === 'position')!.data);
  });

  it('reprepares sampled face-varying normals when they split vertices', async () => {
    const scene = await importUsdStage('seams.usda', { reader: { read: async () => `#usda 1.0
def Mesh "Quad" {
  uniform token subdivisionScheme = "none"
  int[] faceVertexCounts = [3, 3]
  int[] faceVertexIndices = [0, 1, 2, 0, 2, 3]
  point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
  normal3f[] normals = [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)] (interpolation = "faceVarying")
  normal3f[] normals.timeSamples = {
    0: [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)],
    10: [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 1, 0), (0, 1, 0), (0, 1, 0)],
  }
}` } });
    const meshFor = (at: typeof scene, path: string) => meshSourceFromScene(at).meshFor(path);
    const geometry = buildGeometry('/Quad', '/Quad', prepareMesh(meshFor(evaluateSceneAt(scene, 0), '/Quad')!));
    const resources = { geometries: new Map([['/Quad', geometry]]), instances: [] } as unknown as SceneResources;
    const result = animateScene(scene, 10, resources, { meshFor });
    expect(geometry.vertexCount).toBe(4);
    expect(result.retopologized.get('/Quad')!.positions.length / 3).toBe(6);
  });

  it('updates tangents for deformed meshes with and without sampled normals', async () => {
    for (const sampledNormals of [false, true]) {
      const source = `#usda 1.0
def Mesh "Quad" {
  uniform token subdivisionScheme = "none"
  int[] faceVertexCounts = [4]
  int[] faceVertexIndices = [0, 1, 2, 3]
  texCoord2f[] primvars:st = [(0, 0), (1, 0), (1, 1), (0, 1)] (interpolation = "vertex")
  point3f[] points.timeSamples = {
    0: [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)],
    10: [(0, 0, 0), (1, 0, 1), (1, 1, 1), (0, 1, 0)],
  }
  ${sampledNormals ? `normal3f[] normals = [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)] (interpolation = "vertex")
  normal3f[] normals.timeSamples = {
    0: [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)],
    10: [(-0.7071068, 0, 0.7071068), (-0.7071068, 0, 0.7071068), (-0.7071068, 0, 0.7071068), (-0.7071068, 0, 0.7071068)],
  }` : ''}
}`;
      const scene = await importUsdStage('tangent.usda', { reader: { read: async () => source } });
      const meshFor = (at: typeof scene, path: string) => meshSourceFromScene(at).meshFor(path);
      const geometry = buildGeometry('/Quad', '/Quad', prepareMesh(meshFor(evaluateSceneAt(scene, 0), '/Quad')!));
      const resources = { geometries: new Map([['/Quad', geometry]]), instances: [] } as unknown as SceneResources;
      const result = animateScene(scene, 10, resources, { meshFor }).deformed.get('/Quad')!;
      expect(result.tangents).toBeDefined();
      expect(result.tangents![0]).toBeCloseTo(Math.SQRT1_2);
      expect(result.tangents![2]).toBeCloseTo(Math.SQRT1_2);
    }
  });

  it('reads visibility from ancestors', async () => {
    const { scene } = await setup();
    expect(isInvisible(scene, '/World/Quad')).toBe(false);
  });

  it('prepares meshes with sampled topology again and reports a new triangulation', async () => {
    const scene = await importUsdStage('b.usda', { reader: { read: async () => `#usda 1.0
def Mesh "Morph"
{
    int[] faceVertexCounts.timeSamples = { 0: [4], 5: [3, 3], 8: [4] }
    int[] faceVertexIndices.timeSamples = { 0: [0, 1, 2, 3], 5: [0, 1, 3, 1, 2, 3], 8: [0, 1, 2, 3] }
    point3f[] points.timeSamples = { 0: [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], 8: [(0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0)] }
}
` } });
    const meshFor = (at: typeof scene, path: string) => meshSourceFromScene(at).meshFor(path);
    const geometry = buildGeometry('/Morph', '/Morph', prepareMesh(meshFor(evaluateSceneAt(scene, 0), '/Morph')!));
    const resources = {
      geometries: new Map([['/Morph', geometry]]),
      instances: [{ id: '/Morph', prototypeId: '/Morph', primPath: '/Morph', transform: [], hasGeometry: true }],
    } as unknown as SceneResources;
    // The other diagonal: a new triangulation.
    const split = animateScene(scene, 6, resources, { meshFor });
    expect(split.deformed.size).toBe(0);
    expect([...split.retopologized.get('/Morph')!.indices]).toEqual([0, 1, 2, 1, 3, 2]);
    expect(split.retopologized.get('/Morph')!.indices).not.toEqual(geometry.indices);
    // Same triangulation with moved points: a plain deformation.
    const grown = animateScene(scene, 8, resources, { meshFor });
    expect(grown.retopologized.size).toBe(0);
    expect(Math.max(...grown.deformed.get('/Morph')!.positions)).toBe(2);
    // Without a way to read the mesh, the change is reported and skipped.
    const warnings: string[] = [];
    const skipped = animateScene(scene, 6, resources, { sink: d => warnings.push(d.message) });
    expect(skipped.retopologized.size + skipped.deformed.size).toBe(0);
    expect(warnings).toEqual(['Time-sampled mesh ignored: /Morph (no inline geometry)']);
  });
});
