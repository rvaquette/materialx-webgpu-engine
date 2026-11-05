import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeCompiledScene, encodeCompiledScene, writeCompiledScene, type CompiledScenePackage, type SceneDirectory } from '../../src/scene/compiled-scene-codec.ts';
import { compiledRasterShaderKey, exportCompiledScene, loadCompiledScene } from '../../src/scene/compiled-scene.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { buildPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import { NEUTRAL_SURFACE } from '../../src/render/raster/scene-frame.ts';
import { IrModuleBuilder, FLOAT } from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import type { ResolvedGraph } from '../../src/materialx/graph.ts';
import type { LoadedUsdScene } from '../../src/render/usd-scene-assets.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';
import * as acceleration from '../../src/geometry/bvh.ts';
import * as materialCompiler from '../../src/compiler/surface-wgsl.ts';
import { IDENTITY4 } from '../../src/scene/transforms.ts';
import { projectIrradianceSH } from '../../src/render/env/irradiance.ts';
import { buildEnvCdf } from '../../src/assets/environment-cdf.ts';

afterEach(() => vi.restoreAllMocks());

const readPackage = (scene: CompiledScenePackage) => async (path: string): Promise<Uint8Array<ArrayBuffer>> => {
  const bytes = scene.files.get(path);
  if (!bytes) throw new Error(`Missing resource: ${path}`);
  return bytes;
};

function packageFetch(scene: CompiledScenePackage) {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/scene.json')) return new Response(JSON.stringify(scene.manifest));
    const bytes = scene.files.get(url.pathname.slice('/scenes/compiled/'.length));
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  });
}

async function fixture(): Promise<LoadedUsdScene> {
  const scene = await importUsdStage('https://example.test/original/scene.usda', {
    reader: { read: async () => `#usda 1.0
def Xform "World" {
  def Mesh "Triangle" {
    rel material:binding = </World/Looks/Mat>
  }
  def Material "Looks" {
    def Material "Mat" (
      references = @mat.mtlx@</MaterialX/Materials/Mat>
    ) {}
  }
}` },
  });
  const graph: ResolvedGraph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
    nodes: new Map([['s', {
      id: 's', category: 'standard_surface', type: 'surfaceshader',
      inputs: [{
        name: 'base_color', type: 'color3', source: { kind: 'value', type: 'color3', value: '0.2, 0.4, 0.8' },
        provenance: { namePath: '/s/base_color' },
      }],
      provenance: { namePath: '/s' },
    }]]),
  };
  const surface = resolveSurface(graph, {});
  if (!surface) throw new Error('Fixture material failed.');
  const builder = new IrModuleBuilder();
  builder.output({ name: 'color', type: FLOAT, ref: builder.constant(FLOAT, 1) });
  const ir = builder.build();
  const resources = await buildSceneResources(scene, {
    meshSource: { meshFor: () => ({
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2],
      primvars: [{ name: 'st', interpolation: 'vertex', elementSize: 2, values: [0, 0, 1, 0, 0, 1] }],
    }) },
    materialCompiler: { compile: () => ({ ir, module: emitWgsl(ir), layered: emitLayeredSurface(graph, surface), graph, surface }) },
  });
  if (!resources.materials.size) throw new Error('Fixture has no bound material.');
  return {
    entry: scene.entry, scene, resources, parameterResources: resources, lights: [], cameras: [],
    mtlx: {
      documents: { documentFor: () => undefined, delete: vi.fn() },
      surfaceFor: () => NEUTRAL_SURFACE,
      imageProvider: { decode: () => undefined },
    },
  };
}

describe('compiled scene binary codec', () => {
  it('losslessly round trips typed bytes, subviews, maps, sets and optional values', async () => {
    const original = {
      floats: new Float32Array([-0, 0.125, -4, 1e-20]), half: new Uint16Array([0x3c00, 0xbc00]),
      doubles: new Float64Array([Math.PI]), ints: new Int32Array([-1, 42]),
      view: new Uint8Array([9, 1, 2, 8]).subarray(1, 3),
      map: new Map([['item', { value: 7 }]]), set: new Set(['uv', 'normal']),
      absent: undefined, bounds: [Infinity, -Infinity],
      authoredPoints: Array.from({ length: 256 }, (_, i) => i * 0.125),
      blas: { nodes: [{ min: [0.123456789123, 0, 0], max: [1, 1, 1], left: -1, right: -1, start: 0, count: 1 }] },
      code: 'fn example() -> f32 { return 1.0; }',
    };
    const scene = await encodeCompiledScene(original, 'original.usda');
    expect(await decodeCompiledScene(scene.manifest, readPackage(scene))).toEqual(original);
    expect(scene.manifest.resources.some(resource => resource.path.startsWith('shaders/'))).toBe(true);
    expect(scene.manifest.version).toBe('1.0');
    expect(scene.manifest.compression).toBe('zstd');
  });

  it('deduplicates byte-identical payloads, including shared texture pixels', async () => {
    const bytes = new Uint8Array(4096).fill(17);
    const scene = await encodeCompiledScene({ images: { a: { data: bytes }, b: { data: bytes.slice() } } }, 'scene.usda');
    const textures = scene.manifest.resources.filter(resource => resource.path.startsWith('textures/'));
    expect(textures).toHaveLength(1);
    expect(textures[0]!.compressedByteLength).toBeLessThan(4096);
  });

  it.each(['version', 'abi', 'path', 'size', 'missing-state', 'duplicate'])('rejects invalid manifest %s before reading payloads', async mutation => {
    const scene = await encodeCompiledScene({ data: new Uint8Array([1, 2]) }, 'scene.usda');
    const manifest = structuredClone(scene.manifest);
    if (mutation === 'version') Object.assign(manifest, { version: '2.0' });
    if (mutation === 'abi') manifest.engineAbi++;
    if (mutation === 'path') manifest.resources[0]!.path = '../outside.bin.zst';
    if (mutation === 'size') manifest.resources[0]!.byteLength = 2 ** 40;
    if (mutation === 'missing-state') manifest.state = 'metadata/' + 'a'.repeat(64) + '.json.zst';
    if (mutation === 'duplicate') manifest.resources.push(manifest.resources[0]!);
    const read = vi.fn(readPackage(scene));
    await expect(decodeCompiledScene(manifest, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects damaged data, a false declared output size and truncated files', async () => {
    const scene = await encodeCompiledScene({ data: new Uint8Array(128).fill(3) }, 'scene.usda');
    const resource = scene.manifest.resources[0]!;
    const damaged = new Map(scene.files);
    const bytes = damaged.get(resource.path)!.slice();
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    damaged.set(resource.path, bytes);
    await expect(decodeCompiledScene(scene.manifest, readPackage({ ...scene, files: damaged }))).rejects.toThrow();
    const manifest = structuredClone(scene.manifest);
    manifest.resources[0]!.byteLength++;
    await expect(decodeCompiledScene(manifest, readPackage(scene))).rejects.toThrow('Zstandard frame size');
    damaged.set(resource.path, bytes.subarray(0, -1));
    await expect(decodeCompiledScene(scene.manifest, readPackage({ ...scene, files: damaged }))).rejects.toThrow('Truncated');
  });

  it('rejects class instances and cycles instead of silently losing runtime behavior', async () => {
    await expect(encodeCompiledScene({ date: new Date() }, 'scene.usda')).rejects.toThrow('plain data');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(encodeCompiledScene(cycle, 'scene.usda')).rejects.toThrow('Cyclic');
  });
});

describe('prepared scene export and direct loading', () => {
  it('restores raster/PT resources and generated WGSL without building any BVH or lowering shaders', async () => {
    const loaded = await fixture();
    const expected = buildPathTraceScene(loaded.resources, { surfaceFor: loaded.mtlx.surfaceFor });
    const expectedDispatch = buildMaterialDispatch(expected.variantSources);
    const scene = await exportCompiledScene(loaded);
    const bvh = vi.spyOn(acceleration, 'buildBvh');
    const tlas = vi.spyOn(acceleration, 'buildTlas');
    const lower = vi.spyOn(materialCompiler, 'emitSurfaceVariant');
    const fetchResource = packageFetch(scene);
    const restored = await loadCompiledScene('https://example.test/scenes/compiled/scene.json', vi.fn(), fetchResource);
    expect(bvh).not.toHaveBeenCalled();
    expect(tlas).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
    expect(restored.resources).toEqual(loaded.resources);
    expect(restored.parameterResources).toEqual(loaded.parameterResources);
    expect(restored.compiled?.pathTrace.nodes).toEqual(expected.nodes);
    expect(restored.compiled?.pathTrace.triangles).toEqual(expected.triangles);
    expect(restored.compiled?.pathTrace.materials).toEqual(expected.materials);
    expect(restored.compiled?.dispatch.dispatcherWgsl).toBe(expectedDispatch.dispatcherWgsl);
    expect(restored.compiled?.dispatch.primvarFields).toBeInstanceOf(Map);
    for (const [key, material] of restored.resources.materials) {
      expect(restored.mtlx.surfaceFor(material)).toEqual(NEUTRAL_SURFACE);
      for (const quality of ['interactive', 'reference'] as const) {
        expect(restored.compiled?.rasterShaders.get(compiledRasterShaderKey(key, quality))?.code).toContain('@fragment');
      }
    }
    expect(restored.mtlx.documents).toBeUndefined();
    expect(fetchResource.mock.calls.every(([url]) => String(url).startsWith('https://example.test/scenes/compiled/'))).toBe(true);
    expect(() => restored.mtlx.imageProvider.decode('missing.png')).toThrow('Texture absent');
  });

  it('bundles sparse UDIMs, float HDR data, precision, bindings and environment importance sampling', async () => {
    const loaded = await fixture();
    const material = [...loaded.resources.materials.values()][0]!;
    if (!material.surfaceModule) throw new Error('Missing fixture surface module.');
    material.surfaceModule.textures.push({
      name: 'tiles', handle: 'tiles', group: 1, binding: 0, fileRef: 'source/<UDIM>.png',
      textureKind: 'udim', colorSpace: 'srgb_texture',
    });
    material.surfaceModule.textures.push({
      name: 'height', handle: 'height', group: 1, binding: 1, fileRef: 'source/height.exr', colorSpace: 'lin_rec709',
    });
    const tile: DecodedPixelImage = {
      kind: 'pixels', width: 1, height: 1, channels: 4, componentType: 'uint8',
      colorSpace: 'srgb_texture', data: new Uint8Array([30, 70, 120, 255]),
    };
    const udim: DecodedPixelImage = { ...tile, udim: [{ tile: 1001, image: tile }, { tile: 1011, image: tile }] };
    const hdr: DecodedPixelImage = { ...tile, componentType: 'float32', colorSpace: 'lin_rec709', data: new Float32Array([0.12345, 70, -2, 1]) };
    loaded.mtlx.imageProvider.decode = file => file.endsWith('.exr') ? hdr : udim;
    const envImage = { width: 2, height: 1, data: new Float32Array([2, 5, 10, 4, 8, 16]) };
    loaded.environment = {
      image: envImage, sh: projectIrradianceSH(envImage), averageRadiance: [3, 6.5, 13], tint: [1, 1, 1], intensity: 1,
    };
    loaded.lights = [{
      path: '/World/Dome', type: 'dome', usdType: 'DomeLight', transform: IDENTITY4, color: [1, 1, 1],
      intensity: 1, exposure: 0, normalize: false,
    }];
    const scene = await exportCompiledScene(loaded);
    const restored = await loadCompiledScene('https://example.test/scenes/compiled/scene.json', vi.fn(), packageFetch(scene));
    expect(await restored.mtlx.imageProvider.decode('source/<UDIM>.png')).toEqual(udim);
    expect(await restored.mtlx.imageProvider.decode('source/height.exr')).toEqual(hdr);
    expect(restored.environment).toEqual(loaded.environment);
    expect(restored.compiled?.environmentCdf).toEqual(buildEnvCdf(envImage));
    expect(scene.manifest.resources.filter(resource => resource.path.startsWith('textures/'))).toHaveLength(3);
  });

  it('fails export when a referenced texture is missing', async () => {
    const loaded = await fixture();
    const material = [...loaded.resources.materials.values()][0]!;
    material.surfaceModule?.textures.push({ name: 'missing', handle: 'missing', group: 1, binding: 0, fileRef: 'missing.png' });
    await expect(exportCompiledScene(loaded)).rejects.toThrow('Cannot export missing texture');
  });

  it('reports load errors explicitly without fetching the original USDA', async () => {
    const sink = vi.fn();
    const fetchResource = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(loadCompiledScene('https://example.test/scenes/compiled/scene.json', sink, fetchResource)).rejects.toThrow('HTTP 404');
    expect(fetchResource).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('writes the manifest only after every compressed resource has been saved', async () => {
    const scene = await encodeCompiledScene({ data: new Float32Array([1, 2]) }, 'scene.usda');
    const written: string[] = [];
    const directory = (prefix: string): SceneDirectory => ({
      getDirectoryHandle: async name => directory(`${prefix}${name}/`),
      getFileHandle: async name => ({
        createWritable: async () => ({
          write: async () => { written.push(`${prefix}${name}`); },
          close: async () => {}, abort: async () => {},
        }),
      }),
    });
    await writeCompiledScene(directory(''), scene);
    expect(written.at(-1)).toBe('scene.json');
    expect(written.slice(0, -1)).toEqual([...scene.files.keys()]);
  });
});
