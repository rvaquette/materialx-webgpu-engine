import { describe, expect, it, vi } from 'vitest';
import { displaceGeometry, applySceneDisplacement } from '../../src/render/displacement.ts';
import { buildGeometry, type SceneResources } from '../../src/render/scene-resources.ts';
import { prepareMesh } from '../../src/geometry/prepare.ts';
import { buildTlas } from '../../src/geometry/bvh.ts';
import { IDENTITY4 } from '../../src/scene/transforms.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';
import { buildPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';

const image: DecodedPixelImage = {
  kind: 'pixels', colorSpace: 'raw', width: 2, height: 1, channels: 4, componentType: 'uint8',
  data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
};

function geometry() {
  return buildGeometry('mesh', '/mesh', prepareMesh({
    points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    faceVertexCounts: [3, 3], faceVertexIndices: [0, 1, 2, 3, 4, 5],
    normals: { name: 'normals', interpolation: 'vertex', elementSize: 3, values: [0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0] },
    primvars: [{ name: 'st', interpolation: 'vertex', elementSize: 2, values: [0.25, 0, 0.25, 0, 0.25, 0, 0.75, 0, 0.75, 0, 0.75, 0] }],
  }));
}

describe('shared displacement geometry', () => {
  it('keeps UV/hard-normal seam duplicates coincident and leaves the source untouched', () => {
    const source = geometry();
    const result = displaceGeometry(source, image, 1, 'displaced');
    const position = result.streams.find(s => s.name === 'position')!.data;
    expect(Array.from(position.slice(0, 3))).toEqual(Array.from(position.slice(9, 12)));
    expect(Array.from(position.slice(6, 9))).toEqual(Array.from(position.slice(12, 15)));
    expect(Array.from(position.slice(0, 3))).toEqual([0.25, 0, -0.25]);
    expect(Array.from(source.streams[0]!.data.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(result.streams.find(s => s.name === 'uv')!.data))
      .toEqual(Array.from(source.streams.find(s => s.name === 'uv')!.data));
    for (const stream of result.streams) expect(Array.from(stream.data).every(Number.isFinite)).toBe(true);
    const normal = result.streams.find(s => s.name === 'normal')!.data;
    expect(Array.from(normal.slice(0, 3))).not.toEqual(Array.from(normal.slice(9, 12)));
    expect(result.blas.bounds).toEqual(result.bounds);
  });

  it('samples repeat-wrapped heights bilinearly, including negative UVs', () => {
    const source = geometry();
    source.streams.find(s => s.name === 'uv')!.data.fill(-0.25);
    const result = displaceGeometry(source, image, 2, 'displaced');
    expect(result.streams[0]!.data[5]).toBe(1);
    expect(result.streams[0]!.data[15]).toBe(1);
  });

  it('isolates shared instances by material, decodes once and builds the PT BVH over displaced positions', async () => {
    const source = geometry();
    const material = { file: 'height.png', scale: 1 };
    const resources: SceneResources = {
      geometries: new Map([['mesh', source]]),
      materials: new Map(),
      instances: ['a', 'b', 'c'].map((id, i) => ({
        id, primPath: `/${id}`, prototypeId: 'mesh', transform: IDENTITY4, hasGeometry: true,
        ...(i < 2 ? { materialKey: 'displaced' } : {}),
      })),
      tlas: buildTlas([source.bounds, source.bounds, source.bounds]),
      pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
    };
    // A real compiled material resource supplies the packed-record surface to both backends.
    const { importUsdStage } = await import('../../src/usd/importer.ts');
    const { buildSceneResources } = await import('../../src/render/scene-resources.ts');
    const { IrModuleBuilder, FLOAT } = await import('../../src/compiler/ir.ts');
    const { emitWgsl } = await import('../../src/compiler/wgsl.ts');
    const scene = await importUsdStage('test.usda', { reader: { read: async () => `#usda 1.0
def Material "Mat" (prepend references = @mat.mtlx@</Mat>) {}
def Mesh "Mesh" { rel material:binding = </Mat> }` } });
    const builder = new IrModuleBuilder();
    builder.output({ name: 'color', type: FLOAT, ref: builder.constant(FLOAT, 1) });
    const ir = builder.build();
    const built = await buildSceneResources(scene, {
      meshSource: { meshFor: () => undefined },
      materialCompiler: { compile: () => ({ ir, module: emitWgsl(ir), displacement: material }) },
    });
    const compiled = [...built.materials.values()][0]!;
    expect(compiled).toBeDefined();
    const input = { ...resources, materials: new Map([['displaced', compiled]]) };
    const decode = vi.fn(async () => image);
    const result = await applySceneDisplacement(input, { decode });
    expect(decode).toHaveBeenCalledOnce();
    expect(result.instances[0]!.prototypeId).toBe(result.instances[1]!.prototypeId);
    expect(result.instances[2]!.prototypeId).toBe('mesh');
    expect(result.materials.get('displaced')!.displacement).toBeUndefined();
    expect(input.materials.get('displaced')!.displacement).toEqual(material);
    expect(result.geometries.get('mesh')).toBe(source);
    const pt = buildPathTraceScene(result);
    const displaced = result.geometries.get(result.instances[0]!.prototypeId)!;
    expect(Array.from(pt.triangles.slice(0, 9))).toEqual(Array.from(displaced.streams[0]!.data.slice(0, 9)));
    expect(pt.displacement).toBeUndefined();
    expect(pt.bounds).toEqual(result.tlas.bounds);
    await expect(applySceneDisplacement(input, { decode: async () => undefined })).rejects.toThrow('Invalid displacement map');
  });

  it('rejects invalid images and missing UVs instead of silently ignoring displacement', () => {
    const source = geometry();
    expect(() => displaceGeometry(source, { ...image, width: 0 }, 1, 'bad')).toThrow('height map');
    expect(() => displaceGeometry({ ...source, streams: source.streams.filter(s => s.name !== 'uv') }, image, 1, 'bad'))
      .toThrow('requires positions, normals and UVs');
  });
});
