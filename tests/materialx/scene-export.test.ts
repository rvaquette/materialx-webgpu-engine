import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { IDENTITY4 } from '../../src/scene/transforms.ts';
import { buildTlas } from '../../src/geometry/bvh.ts';
import type { GeometryResource, SceneResources, VertexStream } from '../../src/render/scene-resources.ts';
import { NEUTRAL_SURFACE, type SceneFramePlan } from '../../src/render/raster/scene-frame.ts';
import { createMeshBakeSampler } from '../../src/materialx/bake.ts';
import { exportSceneUsdZip } from '../../src/materialx/scene-export.ts';
import type { SceneAsset, ScenePrim } from '../../src/scene/types.ts';
import { importUsdStage } from '../../src/usd/importer.ts';

describe('scene USD export', () => {
  it('samples interpolated mesh attributes in UV space and leaves uncovered texels empty', () => {
    const geometry = {
      primPath: '/mesh',
      streams: [
        { name: 'position', data: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), components: 3 },
        { name: 'normal', data: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), components: 3 },
        { name: 'uv', data: new Float32Array([0, 0, 1, 0, 0, 1]), components: 2 },
      ],
      indices: new Uint32Array([0, 1, 2]),
      vertexCount: 3,
    } as unknown as GeometryResource;
    const model = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 0, 1] as const;
    const center = createMeshBakeSampler(geometry, model, 1, 1)(0, 0)!;
    const outside = createMeshBakeSampler(geometry, model, 2, 2)(1, 0);

    expect(center.inputs?.mx_objectPosition).toEqual([1, 1, 0]);
    expect(center.position).toEqual([4, 5, 0]);
    expect(center.texcoord).toEqual([0.5, 0.5]);
    expect(outside).toBeUndefined();
  });

  it('preserves the scene hierarchy and bundles baked MaterialX maps', async () => {
    const stream = (name: string, data: number[], components: number): VertexStream => ({
      name, data: new Float32Array(data), components,
    });
    const geometry = {
      prototypeId: 'proto',
      primPath: '/mesh',
      streams: [
        stream('position', [0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
        stream('normal', [0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
        stream('uv', [0, 0, 1, 0, 0, 1], 2),
      ],
      indices: new Uint32Array([0, 1, 2]),
      vertexCount: 3,
      triangleCount: 1,
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      blas: { nodes: [], triangleOrder: new Uint32Array(), bounds: { min: [0, 0, 0], max: [1, 1, 0] } },
      subsets: [],
      subdivision: { scheme: 'none', level: 0, applied: false },
      displacement: { required: false },
    } as unknown as GeometryResource;
    const resources: SceneResources = {
      geometries: new Map([['proto', geometry]]),
      materials: new Map(),
      instances: [{
        id: '/mesh', prototypeId: 'proto', primPath: '/World/Mesh', transform: IDENTITY4, hasGeometry: true,
      }],
      tlas: buildTlas([]),
      pendingGeometry: [],
      pendingMaterials: [],
      unboundGprims: [],
    };
    const frame: SceneFramePlan = {
      camera: { viewProj: IDENTITY4, eye: [0, 0, 5], exposure: 0 },
      light: { direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 },
      environment: { radiance: [0.1, 0.1, 0.1] },
      draws: [{
        instanceId: '/mesh',
        prototypeId: 'proto',
        pass: 'opaque',
        model: IDENTITY4,
        surface: NEUTRAL_SURFACE,
        materialKey: 'mat',
      }],
      passes: ['opaque'],
      skipped: [],
    };

    const makePrim = (
      path: string, name: string, typeName: string | undefined, children: readonly string[] = [],
      attributes: readonly { name: string; typeName: string; value: number | string }[] = [],
    ): ScenePrim => ({
      path, name, specifier: 'def', ...(typeName ? { typeName } : {}), apiSchemas: [], inherits: [], references: [], payloads: [],
      attributes: new Map(attributes.map(attribute => [attribute.name, attribute])),
      relationships: new Map(), xformOps: [], children,
    });
    const scene: SceneAsset = {
      entry: 'scene.usda',
      stage: { defaultPrim: 'World', upAxis: 'Z', metersPerUnit: 0.01, subLayers: [] },
      prims: new Map([
        ['/', makePrim('/', '', undefined, ['/World'])],
        ['/World', makePrim('/World', 'World', 'Xform', ['/World/Camera', '/World/Key', '/World/Mesh'])],
        ['/World/Camera', makePrim('/World/Camera', 'Camera', 'Camera', [], [
          { name: 'focalLength', typeName: 'float', value: 50 },
        ])],
        ['/World/Key', makePrim('/World/Key', 'Key', 'DistantLight', [], [
          { name: 'intensity', typeName: 'float', value: 2 },
        ])],
        ['/World/Mesh', makePrim('/World/Mesh', 'Mesh', 'Mesh')],
      ]),
      roots: ['/World'],
      materials: [],
    };

    const blob = await exportSceneUsdZip(frame, resources, { decode: () => undefined }, resources, scene);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const usda = strFromU8(files['scene.usda']!);
    const roundTrip = await importUsdStage('mem:/scene.usda', {
      reader: { read: async uri => uri === 'mem:/scene.usda' ? usda : Promise.reject(new Error(`Unexpected layer: ${uri}`)) },
    });

    expect(usda).toContain('def Xform "World"');
    expect(usda).toContain('def Camera "Camera"');
    expect(usda).toContain('def DistantLight "Key"');
    expect(usda).toContain('def Mesh "Mesh"');
    expect(usda).toContain('faceVertexIndices = [0, 1, 2]');
    expect(usda).toContain('rel material:binding = </__BakedLooks/mesh>');
    expect(usda).toContain('@materials/mesh/mesh.mtlx@');
    expect(roundTrip.prims.has('/World/Camera')).toBe(true);
    expect(roundTrip.prims.has('/World/Key')).toBe(true);
    expect(roundTrip.materials.some(material => material.assetPath === 'materials/mesh/mesh.mtlx')).toBe(true);
    expect(files['materials/mesh/mesh.mtlx']).toBeDefined();
    expect(files['materials/mesh/textures/baseColor.png']).toBeDefined();
    expect(files['materials/mesh/textures/height.png']).toBeDefined();
  });
});
