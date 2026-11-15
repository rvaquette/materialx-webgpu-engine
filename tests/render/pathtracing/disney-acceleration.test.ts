import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDisneyAcceleration } from '../../../src/render/pathtracing/disney-acceleration.ts';
import { packDisneyGeometryTextures, uploadDisneyGeometryTextures } from '../../../src/render/pathtracing/disney-geometry-textures.ts';
import { buildGeometry, type InstanceResource, type SceneResources } from '../../../src/render/scene-resources.ts';
import { IDENTITY4, scaling4, translation4 } from '../../../src/scene/transforms.ts';
import { buildTlas } from '../../../src/geometry/bvh.ts';
import { prepareDisneyScene } from '../../../src/render/pathtracing/disney-scene.ts';
import type { MaterialResource } from '../../../src/render/scene-resources.ts';
import type { SceneAsset } from '../../../src/scene/types.ts';
import { resolvedGraphFromParsedSurface, surfaceFromParsedInputs } from '../../../src/materialx/surface-from-inputs.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';

function fixture(): SceneResources {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const geometry = buildGeometry('triangle', '/Triangle', {
    positions, normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]), attributes: new Map(), subsets: [],
    subdivision: { scheme: 'none', level: 0, applied: false }, displacement: { required: false },
  });
  const instances: InstanceResource[] = [
    { id: 'a', primPath: '/a', prototypeId: 'triangle', transform: IDENTITY4, hasGeometry: true, materialKey: 'one' },
    { id: 'b', primPath: '/b', prototypeId: 'triangle', transform: translation4(10, 0, 0), hasGeometry: true, materialKey: 'two' },
    { id: 'c', primPath: '/c', prototypeId: 'triangle', transform: scaling4(-2, 1, 1), hasGeometry: true },
  ];
  return {
    geometries: new Map([['triangle', geometry]]), materials: new Map(), instances,
    tlas: buildTlas([]), pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  };
}

describe('Disney acceleration reconstruction', () => {
  it('builds one local BLAS per prototype and a TLAS leaf per transformed instance', () => {
    const scene = fixture();
    const acceleration = buildDisneyAcceleration(scene);
    expect(acceleration.geometries.size).toBe(1);
    expect(acceleration.geometries.get('triangle')?.blas.triangleOrder).toEqual(new Uint32Array([0]));
    expect(acceleration.tlas.bounds).toEqual({ min: [-2, 0, 0], max: [11, 1, 0] });
    const leaves = acceleration.tlas.nodes.filter(node => node.count);
    expect(leaves).toHaveLength(3);
    expect(leaves.every(node => node.count === 1)).toBe(true);
    expect([...acceleration.tlas.instanceOrder].sort()).toEqual([0, 1, 2]);
    expect(acceleration.instances[acceleration.tlas.instanceOrder[0]!]!.id).toBe('c');
    expect(acceleration.instances[1]!.materialKey).toBe('two');
  });

  describe('Disney scene preparation', () => {
    function material(key: string, standard = false): MaterialResource {
      const graph = standard ? resolvedGraphFromParsedSurface({ category: 'standard_surface', inputs: {} }) : undefined;
      const surface = graph ? resolveSurface(graph) : surfaceFromParsedInputs({ category: 'disney_principled', inputs: {} });
      if (!surface) throw new Error('Missing fixture surface');
      return {
        unitKey: key, materialName: key, boundPrims: [],
        features: {} as MaterialResource['features'],
        variant: { pipelineKey: '', uniforms: { fields: [], byteLength: 0 }, textures: [], samplers: [] },
        resolvedSurface: surface, ...(graph ? { surfaceGraph: graph } : {}),
      };
    }

    function sceneFixture(): { scene: SceneAsset; resources: SceneResources } {
      const resources = fixture();
      const geometry = resources.geometries.get('triangle')!;
      const scene: SceneAsset = {
        entry: 'scene.usda', stage: { subLayers: [] }, roots: [], prims: new Map(),
        materials: [{ primPath: '/Looks/part', assetPath: 'asset.mtlx', referencedPrimPath: '/Mat/blue', materialName: 'blue' }],
      };
      return {
        scene,
        resources: {
          ...resources,
          geometries: new Map([['triangle', {
            ...geometry, subsets: [{ name: 'part', material: '/Looks/part', triangles: new Uint32Array([0]) }],
          }]]),
          instances: resources.instances.map((instance, i) => ({ ...instance, materialKey: i === 1 ? 'green' : 'red' })),
          materials: new Map([
            ['red', material('red')], ['green', material('green')], ['asset.mtlx::/Mat/blue', material('blue', true)],
          ]),
        },
      };
    }

    it('resolves and deduplicates instance and subset materials from scene resources', () => {
      const { scene, resources } = sceneFixture();
      const prepared = prepareDisneyScene(scene, resources);
      expect(prepared.materials).toHaveLength(3);
      expect([...prepared.geometry.subsetMaterials.filter((_, i) => i % 4 === 0)]).toEqual([0, 1, 2, 1, 0, 1]);
      expect(prepared.textures.references()).toEqual([]);
      expect(prepared.warnings.some(warning => warning.materialKey === 'asset.mtlx::/Mat/blue')).toBe(true);
    });

    it('reports unresolved bindings and unsupported materials instead of dropping them', () => {
      const { scene, resources } = sceneFixture();
      expect(() => prepareDisneyScene({ ...scene, materials: [] }, resources)).toThrow('Missing MaterialX reference');
      expect(() => prepareDisneyScene(scene, { ...resources, materials: new Map([['red', material('red')]]) }))
        .toThrow('Missing compiled Disney material');
      const { materialKey: _materialKey, ...unbound } = resources.instances[0]!;
      expect(() => prepareDisneyScene(scene, { ...resources, instances: [unbound] }))
        .toThrow('Missing Disney material binding');
      const red = resources.materials.get('red')!;
      expect(() => prepareDisneyScene(scene, {
        ...resources, materials: new Map([...resources.materials, ['red', { ...red, volumeBoundary: true }]]),
      })).toThrow('Unsupported volume');
    });
  });

  describe('Disney geometry texture packing', () => {
    it('encodes shared BLAS triangles and instance-specific TLAS leaves', () => {
      const scene = fixture();
      const packed = packDisneyGeometryTextures(buildDisneyAcceleration(scene), [4, 7, 9]);
      expect(packed.topLevelIndex).toBe(1);
      expect([...packed.triangleIndices]).toEqual([0, 1, 2, 0]);
      expect([...packed.vertices]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
      expect([...packed.normals]).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
      expect([...packed.nodes.slice(8, 11)]).toEqual([0, 1, 1]);
      const leaves = Array.from({ length: packed.nodes.length / 12 }, (_, i) => [...packed.nodes.slice(i * 12 + 8, i * 12 + 11)])
        .filter(node => node[2]! < 0).sort((a, b) => b[2]! - a[2]!);
      expect(leaves).toEqual([[0, 4, -1], [0, 7, -2], [0, 9, -3]]);
      expect([...packed.transforms.slice(16, 32)]).toEqual(translation4(10, 0, 0));
      expect([...packed.inverseTransforms.slice(16, 32)]).toEqual(translation4(-10, 0, 0));
    });

    describe('Disney geometry texture upload', () => {
      afterEach(() => vi.unstubAllGlobals());

      it('uploads typed texels with padded rows and destroys all textures', () => {
        vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
        const textures: { destroy: ReturnType<typeof vi.fn> }[] = [];
        const createTexture = vi.fn((..._args: unknown[]) => {
          const texture = { destroy: vi.fn() };
          textures.push(texture);
          return texture;
        });
        const writeTexture = vi.fn((..._args: unknown[]) => {});
        const device = { limits: { maxTextureDimension2D: 5 }, createTexture, queue: { writeTexture } } as unknown as GPUDevice;
        const acceleration = buildDisneyAcceleration(fixture());
        const packed = packDisneyGeometryTextures(acceleration, [0, 1, 2]);
        const uploaded = uploadDisneyGeometryTextures(device, packed);
        expect(createTexture).toHaveBeenCalledTimes(7);
        expect(createTexture.mock.calls[0]![0]).toMatchObject({ format: 'rgba32float', size: [5, 4] });
        expect(createTexture.mock.calls[1]![0]).toMatchObject({ format: 'rgba32sint', size: [1, 1] });
        expect(writeTexture.mock.calls[0]![1]).toHaveLength(80);
        expect(writeTexture.mock.calls[0]![2]).toEqual({ bytesPerRow: 80, rowsPerImage: 4 });
        expect(uploaded.topLevelIndex).toBe(packed.topLevelIndex);
        uploaded.destroy();
        expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
      });

      it('destroys previously created textures when a later upload fails', () => {
        vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
        const destroy = vi.fn();
        const device = {
          limits: { maxTextureDimension2D: 64 },
          createTexture: vi.fn().mockReturnValueOnce({ destroy }).mockImplementationOnce(() => { throw new Error('device lost'); }),
          queue: { writeTexture: vi.fn() },
        } as unknown as GPUDevice;
        const packed = packDisneyGeometryTextures(buildDisneyAcceleration(fixture()), [0, 1, 2]);
        expect(() => uploadDisneyGeometryTextures(device, packed)).toThrow('device lost');
        expect(destroy).toHaveBeenCalledOnce();
      });

      it('rejects texel arrays larger than the device texture limit', () => {
        vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
        const createTexture = vi.fn();
        const device = {
          limits: { maxTextureDimension2D: 2 }, createTexture, queue: { writeTexture: vi.fn() },
        } as unknown as GPUDevice;
        const packed = packDisneyGeometryTextures(buildDisneyAcceleration(fixture()), [0, 1, 2]);
        expect(() => uploadDisneyGeometryTextures(device, packed)).toThrow('exceeds the GPU 2D texture limit');
        expect(createTexture).not.toHaveBeenCalled();
      });
    });

    it('packs reordered triangle indices and UV coordinates without losing assignments', () => {
      const scene = fixture();
      const geometry = buildGeometry('two', '/two', {
        positions: new Float32Array([10, 0, 0, 11, 0, 0, 10, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array(Array.from({ length: 6 }, () => [0, 0, 1]).flat()),
        uvs: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0, 0]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]), attributes: new Map(), subsets: [],
        subdivision: { scheme: 'none', level: 0, applied: false }, displacement: { required: false },
      });
      const acceleration = buildDisneyAcceleration({ ...scene, geometries: new Map([['two', geometry]]),
        instances: [{ ...scene.instances[0]!, prototypeId: 'two' }] });
      const packed = packDisneyGeometryTextures(acceleration, [5]);
      const order = acceleration.geometries.get('two')!.blas.triangleOrder;
      expect([...packed.triangleIndices.slice(0, 3)]).toEqual([...geometry.indices.slice(order[0]! * 3, order[0]! * 3 + 3)]);
      expect([packed.triangleIndices[3], packed.triangleIndices[7]]).toEqual([1, 1]);
      expect(packed.vertices[3]).toBeCloseTo(0.1);
      expect(packed.normals[3]).toBeCloseTo(0.2);
    });

    it('rejects invalid material indices and singular instance transforms', () => {
      const scene = fixture();
      const acceleration = buildDisneyAcceleration(scene);
      expect(() => packDisneyGeometryTextures(acceleration, [1])).toThrow('one non-negative');
      expect(() => packDisneyGeometryTextures(acceleration, [1, -1, 2])).toThrow('one non-negative');
      const singular = buildDisneyAcceleration({ ...scene, instances: [{ ...scene.instances[0]!, transform: scaling4(0, 1, 1) }] });
      expect(() => packDisneyGeometryTextures(singular, [0])).toThrow('Non-invertible transform');
      const tooSmall = buildDisneyAcceleration({ ...scene, instances: [{ ...scene.instances[0]!, transform: scaling4(1e-40, 1, 1) }] });
      expect(() => packDisneyGeometryTextures(tooSmall, [0])).toThrow('Inverse transform exceeds float32 range');
    });

    it('offsets BLAS node and triangle ranges across multiple geometries', () => {
      const scene = fixture();
      const positions = new Float32Array(Array.from({ length: 5 }, (_, i) =>
        [i * 3, 0, 0, i * 3 + 1, 0, 0, i * 3, 1, 0]).flat());
      const geometry = buildGeometry('many', '/many', {
        positions, normals: new Float32Array(Array.from({ length: 15 }, () => [0, 0, 1]).flat()),
        indices: Uint32Array.from({ length: 15 }, (_, i) => i), attributes: new Map(), subsets: [],
        subdivision: { scheme: 'none', level: 0, applied: false }, displacement: { required: false },
      });
      const acceleration = buildDisneyAcceleration({ ...scene,
        geometries: new Map([...scene.geometries, ['many', geometry]]),
        instances: [scene.instances[0]!, { ...scene.instances[1]!, prototypeId: 'many' }] });
      const packed = packDisneyGeometryTextures(acceleration, [2, 3]);
      const secondRoot = 1;
      expect(acceleration.geometries.get('many')!.blas.nodes.length).toBeGreaterThan(1);
      const secondNode = [...packed.nodes.slice(secondRoot * 12 + 8, secondRoot * 12 + 11)];
      expect(secondNode[0]).toBeGreaterThan(secondRoot);
      expect(secondNode[1]).toBeGreaterThan(secondRoot);
      const secondLeaf = acceleration.geometries.get('many')!.blas.nodes.findIndex(node => node.count > 0);
      const localNode = acceleration.geometries.get('many')!.blas.nodes[secondLeaf]!;
      const packedNode = [...packed.nodes.slice((secondRoot + secondLeaf) * 12 + 8, (secondRoot + secondLeaf) * 12 + 11)];
      expect(packedNode).toEqual([1 + localNode.start, localNode.count, 1]);
      const order = acceleration.geometries.get('many')!.blas.triangleOrder[localNode.start]!;
      expect([...packed.triangleIndices.slice((1 + localNode.start) * 4, (1 + localNode.start) * 4 + 3)])
        .toEqual([...geometry.indices.slice(order * 3, order * 3 + 3)].map(index => index + 3));
    });

    it('packs per-instance subset assignments while sharing the BLAS', () => {
      const scene = fixture();
      const geometry = scene.geometries.get('triangle')!;
      const acceleration = buildDisneyAcceleration({ ...scene, geometries: new Map([['triangle', {
        ...geometry, subsets: [{ name: 'part', material: '/Looks/part', triangles: new Uint32Array([0]) }],
      }]]) });
      const maps = [4, 7, 9].map(index => new Map([['/Looks/part', index]]));
      const packed = packDisneyGeometryTextures(acceleration, [0, 1, 2], maps);
      expect(packed.triangleIndices[3]).toBe(2);
      expect([...packed.subsetMaterials.filter((_, i) => i % 4 === 0)]).toEqual([0, 4, 1, 7, 2, 9]);
      const leaves = Array.from({ length: packed.nodes.length / 12 }, (_, i) => [...packed.nodes.slice(i * 12 + 8, i * 12 + 11)])
        .filter(node => node[2]! < 0).sort((a, b) => b[2]! - a[2]!);
      expect(leaves).toEqual([[0, -1, -1], [0, -3, -2], [0, -5, -3]]);
      expect(() => packDisneyGeometryTextures(acceleration, [0, 1, 2])).toThrow('Missing or invalid Disney subset material');
      expect(() => packDisneyGeometryTextures(acceleration, [0, 1, 2], maps.slice(0, 2))).toThrow('one map per instance');
      expect(() => packDisneyGeometryTextures(acceleration, [0, 1, 2], [maps[0]!, new Map(), maps[2]!]))
        .toThrow('for instance b');
    });

    it('rejects invalid and overlapping subset triangle assignments', () => {
      const scene = fixture();
      const geometry = scene.geometries.get('triangle')!;
      const withSubsets = (subsets: typeof geometry.subsets) =>
        buildDisneyAcceleration({ ...scene, geometries: new Map([['triangle', { ...geometry, subsets }]]) });
      expect(() => packDisneyGeometryTextures(withSubsets([
        { name: 'bad', material: '/Bad', triangles: new Uint32Array([1]) },
      ]), [0, 1, 2])).toThrow('Invalid triangle');
      expect(() => packDisneyGeometryTextures(withSubsets([
        { name: 'a', material: '/A', triangles: new Uint32Array([0]) },
        { name: 'b', material: '/B', triangles: new Uint32Array([0]) },
      ]), [0, 1, 2])).toThrow('Overlapping Disney material subsets');
    });
  });

  it('fails explicitly when an instance has missing or invalid geometry', () => {
    const scene = fixture();
    expect(() => buildDisneyAcceleration({ ...scene, pendingGeometry: ['triangle'] })).toThrow('missing geometry');
    expect(() => buildDisneyAcceleration({ ...scene, geometries: new Map() })).toThrow('Missing geometry for instance a');
    const geometry = scene.geometries.get('triangle')!;
    expect(() => buildDisneyAcceleration({
      ...scene, geometries: new Map([['triangle', { ...geometry, indices: new Uint32Array([0, 1, 9]) }]]),
    })).toThrow('Invalid geometry for instance a');
  });

  it('rejects invalid instance transforms', () => {
    const scene = fixture();
    expect(() => buildDisneyAcceleration({
      ...scene, instances: [{ ...scene.instances[0]!, transform: [1, 0, 0] }],
    })).toThrow('Invalid affine transform for instance a');
  });
});
