import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeCompiledScene, encodeCompiledScene, writeCompiledScene, type CompiledScenePackage, type SceneDirectory } from '../../src/scene/compiled-scene-codec.ts';
import { compiledRasterShaderKey, exportCompiledScene, loadCompiledScene } from '../../src/scene/compiled-scene.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { buildPathTraceScene, PT_MATERIAL_FLOATS } from '../../src/render/pathtracing/scene-buffers.ts';
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
import { bootstrapUsdImage, compiledPathTraceInput, loadRenderScene } from '../render/usd-scene.harness.ts';
import * as usdImporter from '../../src/usd/importer.ts';
import * as browserImage from '../../src/assets/browser-image.ts';
import * as sceneAssets from '../../src/render/usd-scene-assets.ts';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  it('loads a v1 package converted by the merge script without changing its data', async () => {
    const original = { data: new Float32Array([1, 2, 3]), other: new Uint32Array([4, 5]), code: 'fn preserved() {}' };
    const scene = await encodeCompiledScene(original, 'scene.usda', { compressionLevel: 3 });
    const directory = await mkdtemp(join(tmpdir(), 'merged-scene-codec-'));
    try {
      const resources = scene.manifest.resources.map(({ file, offset, ...resource }) => resource);
      for (const resource of scene.manifest.resources) {
        const target = join(directory, resource.path);
        await mkdir(join(directory, resource.path.split('/')[0]!), { recursive: true });
        await writeFile(target, scene.files.get(resource.file)!.subarray(resource.offset, resource.offset + resource.compressedByteLength));
      }
      const manifestPath = join(directory, 'scene.json');
      const { files, ...manifest } = scene.manifest;
      await writeFile(manifestPath, JSON.stringify({ ...manifest, version: '1.0', resources }));
      await promisify(execFile)(process.execPath, ['scripts/merge-compiled-scenes.mjs', '--entry', manifestPath]);
      const converted: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(await decodeCompiledScene(converted, async path => new Uint8Array(await readFile(join(directory, path))))).toEqual(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([1, 3, 22])('losslessly round trips with compression level %s', async compressionLevel => {
    const original = { data: new Float32Array(Array.from({ length: 1024 }, (_, index) => index * 0.125)) };
    const onProgress = vi.fn();
    const scene = await encodeCompiledScene(original, 'scene.usda', { compressionLevel, onProgress });
    expect(await decodeCompiledScene(scene.manifest, readPackage(scene))).toEqual(original);
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining(`Zstandard ${compressionLevel}`));
  });

  it.each([0, 23, 1.5, NaN])('rejects invalid compression level %s', async compressionLevel => {
    await expect(encodeCompiledScene({}, 'scene.usda', { compressionLevel })).rejects.toThrow('Compression level');
  });

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
    expect(scene.manifest.version).toBe('2.0');
    expect(scene.manifest.compression).toBe('zstd');
  });

  it('deduplicates byte-identical buffers inside the packed file', async () => {
    const bytes = new Uint8Array(4096).fill(17);
    const scene = await encodeCompiledScene({ a: bytes, b: bytes.slice() }, 'scene.usda');
    const buffers = scene.manifest.resources.filter(resource => resource.file === 'buffers.bin.zst');
    expect(buffers).toHaveLength(1);
    expect(buffers[0]!.compressedByteLength).toBeLessThan(4096);
    expect([...scene.files.keys()]).toEqual(['buffers.bin.zst', 'shaders.wgsl.zst', 'metadata.json.zst']);
  });

  it('reads each of the three files only once for multiple indexed resources', async () => {
    const original = {
      a: new Float32Array([1, 2]), b: new Uint32Array([3, 4, 5]),
      code: 'fn first() {}', fnCode: 'fn second() {}',
    };
    const scene = await encodeCompiledScene(original, 'scene.usda', { compressionLevel: 3 });
    const read = vi.fn(readPackage(scene));
    expect(await decodeCompiledScene(scene.manifest, read)).toEqual(original);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.map(([path]) => path).sort()).toEqual([...scene.files.keys()].sort());
    for (const file of scene.manifest.files) {
      const resources = scene.manifest.resources.filter(resource => resource.file === file.path);
      expect(resources.reduce((sum, resource) => sum + resource.compressedByteLength, 0)).toBe(file.byteLength);
    }
  });

  it.each(['offset', 'overlap', 'file-path', 'missing-file', 'trailing-bytes'])('rejects invalid packed index %s before reading files', async mutation => {
    const scene = await encodeCompiledScene({ a: new Uint8Array([1]), b: new Uint8Array([2]) }, 'scene.usda');
    const manifest = structuredClone(scene.manifest);
    if (mutation === 'offset') manifest.resources[0]!.offset = -1;
    if (mutation === 'overlap') manifest.resources[1]!.offset = 0;
    if (mutation === 'file-path') manifest.resources[0]!.file = '../buffers.bin.zst';
    if (mutation === 'missing-file') manifest.files.pop();
    if (mutation === 'trailing-bytes') manifest.files[0]!.byteLength++;
    const read = vi.fn(readPackage(scene));
    await expect(decodeCompiledScene(manifest, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['version', 'abi', 'path', 'size', 'missing-state', 'duplicate'])('rejects invalid manifest %s before reading payloads', async mutation => {
    const scene = await encodeCompiledScene({ data: new Uint8Array([1, 2]) }, 'scene.usda');
    const manifest = structuredClone(scene.manifest);
    if (mutation === 'version') Object.assign(manifest, { version: '99.0' });
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
    const bytes = damaged.get(resource.file)!.slice();
    const last = resource.offset + resource.compressedByteLength - 1;
    bytes[last] = bytes[last]! ^ 1;
    damaged.set(resource.file, bytes);
    await expect(decodeCompiledScene(scene.manifest, readPackage({ ...scene, files: damaged }))).rejects.toThrow();
    const manifest = structuredClone(scene.manifest);
    manifest.resources[0]!.byteLength++;
    await expect(decodeCompiledScene(manifest, readPackage(scene))).rejects.toThrow('Zstandard frame size');
    damaged.set(resource.file, bytes.subarray(0, -1));
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
  it.each([
    '#usda 1.0\ndef Xform "World" {}',
    `#usda 1.0
over "World" {
  over "Looks" {
    def Material "books" {}
  }
  over "books_grp" {
    rel material:binding = </World/Looks/books>
  }
}`,
  ])('round trips a stage without drawable geometry: %s', async source => {
    const loaded = await fixture();
    loaded.scene = await importUsdStage(loaded.entry, { reader: { read: async () => source } });
    loaded.resources = await buildSceneResources(loaded.scene, {
      meshSource: { meshFor: () => { throw new Error('Unexpected mesh request'); } },
      materialCompiler: { compile: () => { throw new Error('Unexpected material compilation'); } },
    });
    loaded.parameterResources = loaded.resources;
    const scene = await exportCompiledScene(loaded);
    const restored = await loadCompiledScene('https://example.test/scenes/compiled/scene.json', vi.fn(), packageFetch(scene));
    const pathTrace = restored.compiled!.pathTrace;
    expect(pathTrace.triangleCount).toBe(0);
    expect(pathTrace.nodeCount).toBe(0);
    expect(pathTrace.materialCount).toBe(0);
    expect(pathTrace.materialKeys).toEqual([]);
    expect(pathTrace.materials).toEqual(new Float32Array(PT_MATERIAL_FLOATS));
    expect(restored.resources).toEqual(loaded.resources);
  });

  it('rejects a material buffer with an incorrect record count', async () => {
    const loaded = await fixture();
    const pathTrace = buildPathTraceScene(loaded.resources, { surfaceFor: loaded.mtlx.surfaceFor });
    pathTrace.materials = new Float32Array(pathTrace.materials.length + PT_MATERIAL_FLOATS);
    loaded.compiled = { pathTrace, dispatch: buildMaterialDispatch(pathTrace.variantSources), rasterShaders: new Map() };
    await expect(exportCompiledScene(loaded)).rejects.toThrow('path tracing buffers');
  });

  it.each(['raster', 'pathtracing'] as const)('skips empty compiled scenes before requesting a GPU: %s', async backend => {
    const loaded = await fixture();
    loaded.scene = await importUsdStage(loaded.entry, { reader: { read: async () => '#usda 1.0\ndef Xform "World" {}' } });
    loaded.resources = await buildSceneResources(loaded.scene, {
      meshSource: { meshFor: () => { throw new Error('Unexpected mesh request'); } },
      materialCompiler: { compile: () => { throw new Error('Unexpected material compilation'); } },
    });
    loaded.parameterResources = loaded.resources;
    const scene = await exportCompiledScene(loaded);
    vi.stubGlobal('document', { baseURI: 'https://example.test/usd-image-harness.html', getElementById: () => undefined });
    vi.stubGlobal('fetch', packageFetch(scene));
    const requestAdapter = vi.fn(() => { throw new Error('GPU must not be requested'); });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    vi.stubGlobal('__MX_IMAGE__', { stale: true });
    vi.stubGlobal('__MX_SKIPPED__', { stale: true });
    await expect(bootstrapUsdImage('/scenes/compiled/scene.json', 256, 16, backend)).resolves.toBeNull();
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, '__MX_IMAGE__')).toBeUndefined();
    expect(Reflect.get(globalThis, '__MX_SKIPPED__')).toEqual({
      entry: '/scenes/compiled/scene.json', backend, materialOverride: undefined, reason: 'Scene has no drawable geometry',
    });
  });

  it('restores a render-harness snapshot without source imports and retains prepared PT arrays', async () => {
    const scene = await exportCompiledScene(await fixture());
    const fetchResource = packageFetch(scene);
    vi.stubGlobal('document',{ baseURI:'https://example.test/usd-image-harness.html' });
    vi.stubGlobal('fetch',fetchResource);
    const usd = vi.spyOn(usdImporter,'importUsdStage');
    const bvh = vi.spyOn(acceleration,'buildBvh');
    const lower = vi.spyOn(materialCompiler,'emitSurfaceVariant');
    const phase = vi.fn();
    const loaded = await loadRenderScene('/scenes/compiled/scene.json',vi.fn(),vi.fn(),phase);
    expect(usd).not.toHaveBeenCalled();
    expect(bvh).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
    expect(phase.mock.calls).toEqual([['compiledSceneLoad']]);
    expect(fetchResource.mock.calls.every(([url]) => String(url).startsWith('https://example.test/scenes/compiled/'))).toBe(true);
    if (!loaded.compiled) throw new Error('Missing compiled snapshot.');
    const prepared = loaded.compiled.pathTrace;
    const originalCamera = prepared.camera;
    const frameCamera = { ...originalCamera,eye:[5,6,7] as [number,number,number],exposure:2 };
    const environment = { ...prepared.environment,intensity:0.25 };
    const input = compiledPathTraceInput(loaded.compiled,{ frameCamera,environment });
    expect(input.cache.status).toBe('bypass');
    expect(input.scene.nodes).toBe(prepared.nodes);
    expect(input.scene.triangles).toBe(prepared.triangles);
    expect(input.scene.materials).toBe(prepared.materials);
    expect(input.scene.camera.eye).toEqual([5,6,7]);
    expect(input.scene.camera.exposure).toBe(2);
    expect(input.scene.environment).toBe(environment);
    expect(prepared.camera).toBe(originalCamera);
    expect(originalCamera.eye).not.toEqual([5,6,7]);
    fetchResource.mockClear();
    await expect(loadRenderScene('/scenes/compiled/scene.json',vi.fn(),vi.fn(),vi.fn(),'source.mtlx'))
      .rejects.toThrow('cannot use source material overrides');
    expect(fetchResource).not.toHaveBeenCalled();
  });
  it('persists a volume atlas and rejects missing grids or unsafe majorants', async () => {
    const loaded = await fixture();
    const pathTrace = buildPathTraceScene(loaded.resources,{ surfaceFor:loaded.mtlx.surfaceFor });
    const atlas = new Float32Array(80);
    for (let offset=0;offset<atlas.length;offset+=10) atlas.set([0.5,0.5,0.5,0,0,0,0,2,3,4],offset);
    pathTrace.volumeData = atlas;
    pathTrace.materials[29] = 1;
    pathTrace.materials[41] = 2;
    pathTrace.materials.set([1,1,1],46);
    pathTrace.materials[49] = 0.500001;
    loaded.compiled = { pathTrace,dispatch:buildMaterialDispatch(pathTrace.variantSources),rasterShaders:new Map() };
    const scene = await exportCompiledScene(loaded);
    const restored = await loadCompiledScene('https://example.test/scenes/compiled/scene.json',vi.fn(),packageFetch(scene));
    expect(restored.compiled?.pathTrace.volumeData).toEqual(atlas);
    expect(restored.compiled?.pathTrace.materials).toEqual(pathTrace.materials);
    pathTrace.materials[49] = 0.1;
    await expect(exportCompiledScene(loaded)).rejects.toThrow('majorant');
    delete pathTrace.volumeData;
    await expect(exportCompiledScene(loaded)).rejects.toThrow('volume grid layout');
  });
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

  it('references original textures and sparse UDIM tiles instead of bundling decoded pixels', async () => {
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
      intensity: 1, exposure: 0, normalize: false, textureFile: 'source/environment.hdr',
    }];
    const scene = await exportCompiledScene(loaded);
    const snapshot = await decodeCompiledScene(scene.manifest, readPackage(scene)) as {
      images: Map<string, unknown>; environment?: unknown; environmentCdf?: unknown; environmentSource: { url: string };
    };
    expect(snapshot.images.get('source/<UDIM>.png')).toEqual({
      kind: 'external', urls: ['/original/source/%3CUDIM%3E.png'], tiles: [1001, 1011],
    });
    const decodeImage = vi.spyOn(browserImage, 'decodeBrowserImage').mockImplementation(async (_blob, url) =>
      url.endsWith('.exr') ? hdr : tile);
    const loadEnvironment = vi.spyOn(sceneAssets, 'loadEnvironment').mockResolvedValue(loaded.environment);
    expect(snapshot.environment).toBeUndefined();
    expect(snapshot.environmentCdf).toBeUndefined();
    expect(snapshot.environmentSource.url).toBe('/original/source/environment.hdr');
    const fetchPackage = packageFetch(scene);
    const fetchResource = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://relocated.test/original/source/')) return new Response('original image');
      return fetchPackage(input);
    });
    const restored = await loadCompiledScene('https://relocated.test/scenes/compiled/scene.json', vi.fn(), fetchResource);
    expect(await restored.mtlx.imageProvider.decode('source/<UDIM>.png')).toEqual(udim);
    expect(await restored.mtlx.imageProvider.decode('source/height.exr')).toEqual(hdr);
    expect(await restored.mtlx.imageProvider.decode('source/height.exr')).toEqual(hdr);
    expect(decodeImage).toHaveBeenCalledTimes(3);
    expect(restored.environment).toEqual(loaded.environment);
    expect(restored.compiled?.environmentCdf).toEqual(buildEnvCdf(envImage));
    expect(loadEnvironment).toHaveBeenCalledWith([
      expect.objectContaining({ textureFile: 'https://relocated.test/original/source/environment.hdr' }),
    ], 'https://relocated.test/original/source/environment.hdr', expect.any(Function), fetchResource);
    expect(scene.manifest.resources.filter(resource => resource.path.startsWith('textures/'))).toHaveLength(0);
  });

  it('fails export when a referenced texture is missing', async () => {
    const loaded = await fixture();
    const material = [...loaded.resources.materials.values()][0]!;
    material.surfaceModule?.textures.push({ name: 'missing', handle: 'missing', group: 1, binding: 0, fileRef: 'missing.png' });
    await expect(exportCompiledScene(loaded)).rejects.toThrow('Cannot export missing texture');
  });

  it('reports missing original textures and allows retrying after they become available', async () => {
    const loaded = await fixture();
    const material = [...loaded.resources.materials.values()][0]!;
    material.surfaceModule?.textures.push({ name: 'image', handle: 'image', group: 1, binding: 0, fileRef: 'albedo.png' });
    const pixels: DecodedPixelImage = {
      kind: 'pixels', width: 1, height: 1, channels: 4, componentType: 'uint8',
      colorSpace: 'lin_rec709', data: new Uint8Array([10, 20, 30, 255]),
    };
    loaded.mtlx.imageProvider.decode = () => pixels;
    const scene = await exportCompiledScene(loaded);
    const fetchPackage = packageFetch(scene);
    let available = false;
    const fetchResource = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/original/albedo.png')
      ? new Response(available ? 'original image' : null, { status: available ? 200 : 404 }) : fetchPackage(input));
    vi.spyOn(browserImage, 'decodeBrowserImage').mockResolvedValue(pixels);
    const restored = await loadCompiledScene('https://example.test/scenes/compiled/scene.json', vi.fn(), fetchResource);
    await expect(restored.mtlx.imageProvider.decode('albedo.png')).rejects.toThrow('Missing external texture');
    available = true;
    await expect(restored.mtlx.imageProvider.decode('albedo.png')).resolves.toEqual(pixels);
    expect(scene.manifest.resources.some(resource => resource.path.startsWith('textures/'))).toBe(false);
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
