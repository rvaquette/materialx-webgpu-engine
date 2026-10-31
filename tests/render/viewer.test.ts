import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveViewer, type ViewerStatus } from '../../src/render/viewer.ts';
import { loadUsdScene, type LoadedUsdScene } from '../../src/render/usd-scene-assets.ts';
import { buildCachedPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';
import { generateEnvironmentMipmaps } from '../../src/render/env/mipmaps.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { NEUTRAL_SURFACE } from '../../src/render/raster/scene-frame.ts';
import { projectIrradianceSH } from '../../src/render/env/irradiance.ts';
import { buildEnvCdf } from '../../src/assets/environment-cdf.ts';
import { JsDenoiser } from '../../src/render/pathtracing/js-denoiser.ts';
import { editableSceneMaterials, materialUniformData } from '../../src/render/material-parameters.ts';
import { PT_UNIFORM_SIZE, pathTraceTile } from '../../src/render/pathtracing/compute.ts';

vi.mock('../../src/render/usd-scene-assets.ts', async (original) => ({
  ...await original<typeof import('../../src/render/usd-scene-assets.ts')>(),
  loadUsdScene: vi.fn(),
}));
vi.mock('../../src/render/pathtracing/scene-buffers.ts', async (original) => ({
  ...await original<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(),
  buildCachedPathTraceScene: vi.fn(),
}));

function fakeDevice() {
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), setIndexBuffer: vi.fn(),
    setScissorRect: vi.fn(), drawIndexed: vi.fn(), draw: vi.fn(), end: vi.fn(),
    dispatchWorkgroups: vi.fn(),
  };
  const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
    createBuffer: vi.fn((desc: GPUBufferDescriptor) => ({
      destroy: vi.fn(), mapAsync: vi.fn(async () => {}), getMappedRange: () => new ArrayBuffer(desc.size), unmap: vi.fn(),
    })),
    createTexture: vi.fn((desc: GPUTextureDescriptor) => {
      const texture = { mipLevelCount: desc.mipLevelCount ?? 1, createView: vi.fn(() => ({})), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createShaderModule: vi.fn(() => ({ getCompilationInfo: async () => ({ messages: [] }) })),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createComputePipelineAsync: vi.fn(async () => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn((_desc: GPUBindGroupDescriptor) => ({})),
    createSampler: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => pass), beginComputePass: vi.fn(() => pass),
      clearBuffer: vi.fn(), copyBufferToBuffer: vi.fn(), copyTextureToBuffer: vi.fn(), finish: vi.fn(() => ({})),
    })),
    queue: {
      writeBuffer: vi.fn(), writeTexture: vi.fn(), submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => {}),
    },
  };
  return { device, gpu: device as unknown as GPUDevice, pass, textures };
}

async function sceneFixture(editable = false): Promise<LoadedUsdScene> {
  const imported = await importUsdStage('scene.usda', {
    reader: { read: async () => `#usda 1.0
def Xform "World" {
  def Mesh "Ball" {
    rel material:binding = </World/Material>
  }
  def Material "Material" {
    token outputs:surface.connect = </World/Material/Surface.outputs:surface>
    def Shader "Surface" {
      uniform token info:id = "UsdPreviewSurface"
      color3f inputs:diffuseColor = (0.5, 0.5, 0.5)
      token outputs:surface
    }
  }
}` },
  });
  const { lowerPreviewSurfaceMaterials } = await import('../../src/usd/preview-surface.ts');
  const lowered = lowerPreviewSurfaceMaterials(imported);
  const scene = { ...imported, materials: [...imported.materials, ...lowered.map((material) => material.reference)] };
  // The lifecycle test only needs one valid layered shader; graph construction is tested separately.
  const { resolveSurface } = await import('../../src/materialx/surface-graph.ts');
  const { emitLayeredSurface } = await import('../../src/compiler/surface-wgsl.ts');
  const { IrModuleBuilder, FLOAT } = await import('../../src/compiler/ir.ts');
  const { emitWgsl } = await import('../../src/compiler/wgsl.ts');
  const graph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
    nodes: new Map([['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'value' as const, type: 'color3', value: '0.8, 0.8, 0.8' }, provenance: { namePath: '/s/base_color' } },
      { name: 'coat', type: 'float', source: { kind: 'value' as const, type: 'float', value: '0' }, provenance: { namePath: '/s/coat' } },
      { name: 'specular_roughness', type: 'float', source: { kind: 'value' as const, type: 'float', value: '0.2' }, provenance: { namePath: '/s/specular_roughness' } },
    ], provenance: { namePath: '/s' } }]]),
  };
  const builder = new IrModuleBuilder();
  builder.output({ name: 'color', type: FLOAT, ref: builder.constant(FLOAT, 1) });
  const ir = builder.build();
  const resources = await buildSceneResources(scene, {
    meshSource: { meshFor: () => ({
      points: [-1, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2],
    }) },
    materialCompiler: {
      compile: () => ({ ir, module: emitWgsl(ir), layered: emitLayeredSurface(graph, resolveSurface(graph, {})!),
        ...(editable ? { graph, surface: resolveSurface(graph, {})! } : {}) }),
    },
  });
  return {
    entry: 'scene.usda', scene,
    resources: editable ? editableSceneMaterials(resources) : resources,
    ...(editable ? { parameterResources: editableSceneMaterials(resources) } : {}), lights: [], cameras: [],
    mtlx: {
      documents: { documentFor: () => undefined, delete: vi.fn() },
      surfaceFor: () => NEUTRAL_SURFACE,
      imageProvider: { decode: async () => undefined },
    },
  };
}

describe('interactive viewer resource lifecycle', () => {
  let tick: FrameRequestCallback;
  let viewer: InteractiveViewer | undefined;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
    vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, INDEX: 2, COPY_DST: 4, UNIFORM: 8, STORAGE: 16, COPY_SRC: 32, MAP_READ: 64 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.mocked(buildCachedPathTraceScene).mockReset();
  });
  afterEach(() => { viewer?.dispose(); vi.unstubAllGlobals(); });

  async function setup(environment = false, editable = false) {
    const loaded = await sceneFixture(editable);
    if (environment) {
      const image = { width: 4, height: 2, data: new Float32Array(24).fill(1) };
      loaded.environment = {
        image, sh: projectIrradianceSH(image), averageRadiance: [1, 1, 1], tint: [1, 1, 1], intensity: 1,
      };
    }
    vi.mocked(loadUsdScene).mockResolvedValue(loaded);
    const mock = fakeDevice();
    const canvas = {
      width: 512, height: 512, style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const statuses: ViewerStatus[] = [];
    viewer = new InteractiveViewer({
      device: mock.gpu, context: { getCurrentTexture: () => ({ createView: () => ({}) }) } as unknown as GPUCanvasContext,
      outputFormat: 'bgra8unorm', canvas, onStatus: (status) => statuses.push(status),
    });
    await viewer.load('scene.usda');
    return { ...mock, loaded, canvas, statuses, viewer };
  }

  it('frames imported local scenes from their bounds instead of using the fixed USD preview distance', async () => {
    const { viewer, loaded, device } = await setup();
    device.queue.writeBuffer.mockClear();
    await viewer.load('scene.usda', new Map(), false, {
      imported: { scene: loaded.scene, meshSource: { meshFor: () => undefined }, materialTexts: new Map() },
    });
    const eye = [...device.queue.writeBuffer.mock.calls].reverse().find(call =>
      call[1] === 128 && call[2] instanceof Float32Array && call[2].length === 4)?.[2];
    expect(eye).toBeInstanceOf(Float32Array);
    if (!(eye instanceof Float32Array)) throw new Error('Missing camera eye uniform');
    const bounds = loaded.resources.tlas.bounds;
    const center = bounds.min.map((value, index) => (value + bounds.max[index]!) / 2);
    const radius = Math.hypot(...bounds.min.map((value, index) => bounds.max[index]! - value)) / 2;
    expect(Math.hypot(...Array.from(eye).slice(0, 3).map((value, index) => value - center[index]!)))
      .toBeCloseTo(2.4 * radius, 2);
  });

  it('updates live uniforms without reload, GPU recompilation or geometry upload', async () => {
    const { viewer, device, loaded } = await setup(false, true);
    const path = '/World/Ball';
    const original = viewer.objectParameters(path).find(parameter => parameter.id === 'surface:base_color')!.initial;
    const shaders = device.createShaderModule.mock.calls.length;
    const buffers = device.createBuffer.mock.calls.length;
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectParameters(path, new Map([['surface:base_color', [0.2, 0.4, 0.8]]]));
    expect(viewer.objectParameters(path).find(parameter => parameter.id === 'surface:base_color')!.value).toEqual([0.2, 0.4, 0.8]);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(device.createBuffer).toHaveBeenCalledTimes(buffers);
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
    expect(device.queue.writeBuffer).toHaveBeenCalled();
    const key = loaded.parameterResources!.instances[0]!.materialKey!;
    const data = materialUniformData(loaded.parameterResources!.materials.get(key)!);
    expect(device.queue.writeBuffer.mock.calls.some(call => call[2] instanceof ArrayBuffer
      && new Uint8Array(call[2]).every((value, i) => value === new Uint8Array(data)[i]))).toBe(true);
    await viewer.resetObjectParameters(path);
    expect(viewer.objectParameters(path).find(parameter => parameter.id === 'surface:base_color')!.value).toEqual(original);
  });

  it('keeps editable coat reachable without recompilation and retains parameter defaults', async () => {
    const { viewer, device } = await setup(false, true);
    const shaders = device.createShaderModule.mock.calls.length;
    const loads = vi.mocked(loadUsdScene).mock.calls.length;
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:coat', [1]]]));
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(loadUsdScene).toHaveBeenCalledTimes(loads);
    const coat = viewer.objectParameters('/World/Ball').find(parameter => parameter.id === 'surface:coat')!;
    expect(coat.value).toEqual([1]);
    expect(coat.initial).toEqual([0]);
    await expect(viewer.setObjectParameters('/World/Ball', new Map([['surface:base_color', [NaN, 0, 0]]]))).rejects.toThrow();
    expect(viewer.objectParameters('/World/Ball').find(parameter => parameter.id === 'surface:coat')!.value).toEqual([1]);
  });

  it('updates PT material uniforms and resets accumulation without rebuilding the compute pipeline', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup(false, true);
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(resolve => setTimeout(resolve, 30));
    tick(1);
    await Promise.resolve();
    const pipelines = device.createComputePipelineAsync.mock.calls.length;
    expect(statuses.at(-1)?.samples).toBeGreaterThan(0);
    device.queue.writeBuffer.mockClear();
    await viewer.setObjectParameters('/World/Ball', new Map([['surface:specular_roughness', [0.7]]]));
    expect(statuses.at(-1)?.samples).toBe(0);
    expect(device.queue.writeBuffer.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(pipelines);
    expect(buildCachedPathTraceScene).toHaveBeenCalledOnce();
  });

  it('does not build path-tracing CPU data/BVH in raster, including after resize', async () => {
    const { viewer, device, loaded } = await setup();
    expect(loaded.resources.materials.size).toBe(1);
    expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
    const pipelines = device.createRenderPipeline.mock.calls.length;
    const shaders = device.createShaderModule.mock.calls.length;
    const buffers = device.createBuffer.mock.calls.length;
    await viewer.resize(1024);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(device.createBuffer).toHaveBeenCalledTimes(buffers);
    expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
  });

  it('submits one interactive frame, keeps reference bands and reuses quality pipelines', async () => {
    const { viewer, device, pass, statuses } = await setup();
    device.queue.submit.mockClear();
    tick(0);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    expect(pass.drawIndexed).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await viewer.setRasterQuality('reference');
    device.queue.submit.mockClear();
    tick(1);
    expect(device.queue.submit).toHaveBeenCalledTimes(4);
    await Promise.resolve();
    const pipelines = device.createRenderPipeline.mock.calls.length;
    await viewer.setRasterQuality('interactive');
    await viewer.setRasterQuality('reference');
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(statuses.at(-1)?.rasterQuality).toBe('reference');
  });

  it('starts CPU preparation only on first path-tracing render and not after disposal', async () => {
    const { viewer } = await setup();
    vi.mocked(buildCachedPathTraceScene).mockImplementation(async () => { throw new Error('test preparation'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      viewer.setBackend('pathtracing');
      expect(buildCachedPathTraceScene).not.toHaveBeenCalled();
      tick(0);
      await new Promise(r => setTimeout(r, 10));
      expect(buildCachedPathTraceScene).toHaveBeenCalledTimes(1);
      viewer.setBackend('raster');
      viewer.setBackend('pathtracing');
      tick(1);
      expect(buildCachedPathTraceScene).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('Path tracer: test preparation');
    } finally { error.mockRestore(); }
  });

  it('keeps the preview while refining tiles, defaults to raw and resizes without recompilation', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, pass } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    await Promise.resolve();
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(1);
    device.createCommandEncoder.mockClear();
    tick(1);
    await Promise.resolve();
    const previewDispatch = pass.dispatchWorkgroups.mock.calls.at(-1);
    expect(previewDispatch).toEqual([16, 16, 1]); // 512 / 4 / workgroup 8
    await new Promise(r => setTimeout(r, 220));
    device.createCommandEncoder.mockClear();
    device.queue.submit.mockClear();
    device.queue.onSubmittedWorkDone.mockClear();
    pass.dispatchWorkgroups.mockClear();
    pass.draw.mockClear();
    tick(2);
    await Promise.resolve();
    const refinement = device.createCommandEncoder.mock.results[0]!.value;
    expect(refinement.copyBufferToBuffer).toHaveBeenCalledWith(expect.anything(), 0, expect.anything(), 0, 128 * 128 * 32);
    expect(pass.dispatchWorkgroups.mock.calls).toEqual(Array(4).fill([16, 16, 1]));
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(pass.draw).toHaveBeenCalledTimes(1);
    const shaders = device.createShaderModule.mock.calls.length;
    const dispatches = pass.dispatchWorkgroups.mock.calls.length;
    viewer.setPathTracingPaused(true);
    viewer.setPathTracingDenoise(false);
    tick(3);
    await Promise.resolve();
    expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(dispatches);
    expect(viewer.pathTracingDenoise).toBe(false);
    const writes = device.queue.writeBuffer.mock.calls;
    const displayInfo = [...writes].reverse().find((call) => call[2] instanceof ArrayBuffer)?.[2] as ArrayBuffer;
    expect(new Uint32Array(displayInfo)[3]).toBe(0);
    const copyCalls = device.createCommandEncoder.mock.results.reduce((sum, result) =>
      sum + result.value.copyBufferToBuffer.mock.calls.length, 0);
    await viewer.resize(256);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(1);
    viewer.setPathTracingPaused(false);
    tick(4);
    await Promise.resolve();
    expect(device.createCommandEncoder.mock.results.reduce((sum, result) =>
      sum + result.value.copyBufferToBuffer.mock.calls.length, 0)).toBe(copyCalls);
  });

  it('reaches 16 spp in 64 refreshes with unchanged tile/sample order and bounded work in flight', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, statuses } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    tick(1);
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 220));
    device.queue.writeBuffer.mockClear();
    device.queue.submit.mockClear();
    device.queue.onSubmittedWorkDone.mockClear();
    for (let refresh = 0; refresh < 64; refresh++) {
      tick(refresh + 2);
      const submits = device.queue.submit.mock.calls.length;
      tick(refresh + 2);
      expect(device.queue.submit).toHaveBeenCalledTimes(submits);
      await Promise.resolve();
    }
    expect(statuses.at(-1)?.samples).toBe(16);
    expect(device.queue.submit).toHaveBeenCalledTimes(64);
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(64);
    const uniforms = device.queue.writeBuffer.mock.calls.map(call => call[2])
      .filter((data): data is Float32Array => data instanceof Float32Array && data.byteLength === PT_UNIFORM_SIZE);
    expect(uniforms).toHaveLength(256);
    for (const [index, data] of uniforms.entries()) {
      expect(Array.from(data.slice(32, 36))).toEqual([Math.floor(index / 16), 1, 512, 512]);
      const tile = pathTraceTile(512, 512, index % 16);
      expect(Array.from(data.slice(76, 80))).toEqual([tile.x, tile.y, tile.width, tile.height]);
      const writeIndex = device.queue.writeBuffer.mock.calls.findIndex(call => call[2] === data);
      const writeOrder = device.queue.writeBuffer.mock.invocationCallOrder[writeIndex]!;
      const batch = Math.floor(index / 4);
      const submitOrder = device.queue.submit.mock.invocationCallOrder[batch]!;
      expect(writeOrder).toBeLessThan(submitOrder);
      if (batch > 0) expect(writeOrder).toBeGreaterThan(device.queue.submit.mock.invocationCallOrder[batch - 1]!);
      const buffer = device.queue.writeBuffer.mock.calls[writeIndex]![0];
      const batchBuffers = uniforms.slice(batch * 4, batch * 4 + 4).map(uniform =>
        device.queue.writeBuffer.mock.calls.find(call => call[2] === uniform)![0]);
      expect(new Set(batchBuffers).size).toBe(4);
      expect(device.createBindGroup.mock.calls.some(([desc]) => Array.from(desc.entries).some(entry =>
        'buffer' in entry.resource && entry.resource.buffer === buffer))).toBe(true);
    }
  });

  it('refills after GPU completion without another animation frame, but yields and honors pause/dispose', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, canvas } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    tick(1);
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 220));
    let complete!: () => void;
    device.queue.onSubmittedWorkDone.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    device.queue.submit.mockClear();
    tick(2);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    tick(3);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    complete();
    await Promise.resolve();
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
    complete();
    await Promise.resolve();
    viewer.setPathTracingPaused(true);
    await new Promise(r => setTimeout(r, 0));
    // Pause may redisplay once, never adding compute samples.
    const writes = device.queue.writeBuffer.mock.calls.filter(call =>
      call[2] instanceof Float32Array && call[2].byteLength === PT_UNIFORM_SIZE).length;
    complete();
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.writeBuffer.mock.calls.filter(call =>
      call[2] instanceof Float32Array && call[2].byteLength === PT_UNIFORM_SIZE)).toHaveLength(writes);
    viewer.setPathTracingPaused(false);
    tick(4);
    complete();
    await Promise.resolve();
    const ownerDocument = { visibilityState: 'hidden' };
    Object.defineProperty(canvas, 'ownerDocument', { value: ownerDocument });
    const hiddenSubmits = device.queue.submit.mock.calls.length;
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.submit).toHaveBeenCalledTimes(hiddenSubmits);
    ownerDocument.visibilityState = 'visible';
    tick(5);
    complete();
    await Promise.resolve();
    viewer.dispose();
    const submits = device.queue.submit.mock.calls.length;
    await new Promise(r => setTimeout(r, 0));
    expect(device.queue.submit).toHaveBeenCalledTimes(submits);
  });

  it('rebinds all tile uniforms to the replacement accumulation after resize', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device } = await setup();
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    viewer.setPathTracingPaused(true);
    device.createBindGroup.mockClear();
    await viewer.resize(256);
    const groups = device.createBindGroup.mock.calls.map(([desc]) => Array.from(desc.entries));
    const compute = groups.filter(entries => entries.length > 6);
    expect(compute).toHaveLength(4);
    const buffers = compute.map(entries => entries.filter(entry => 'buffer' in entry.resource).map(entry => entry.resource));
    expect(new Set(buffers.map(entries => (entries[0] as GPUBufferBinding).buffer)).size).toBe(4);
    // Only the per-tile camera uniform differs; every scene/storage binding is shared.
    for (let i = 1; i < buffers[0]!.length; i++) {
      expect(new Set(buffers.map(entries => (entries[i] as GPUBufferBinding).buffer)).size).toBe(1);
    }
  });

  it('redisplays a paused replacement scene when an older scene releases the denoiser', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const image = new ImageData(new Uint8ClampedArray(512 * 512 * 4), 512, 512);
    let busy = false;
    let finish!: (image: ImageData) => void;
    const busyGetter = vi.spyOn(JsDenoiser.prototype, 'busy', 'get').mockImplementation(() => busy);
    const run = vi.spyOn(JsDenoiser.prototype, 'run').mockImplementationOnce(() => {
      busy = true;
      return new Promise<ImageData>(resolve => { finish = resolve; }).finally(() => { busy = false; });
    }).mockResolvedValue(image);
    try {
      const { viewer, device, statuses } = await setup();
      viewer.setPathTracingDenoise(true);
      viewer.setBackend('pathtracing');
      const sweep = async () => {
        tick(0);
        await new Promise(r => setTimeout(r, 20));
        tick(1);
        await Promise.resolve();
        await new Promise(r => setTimeout(r, 220));
        for (let i = 0; i < 16; i++) { tick(i + 2); await Promise.resolve(); }
        await new Promise(r => setTimeout(r, 0));
      };
      await sweep();
      expect(run).toHaveBeenCalledTimes(1);
      await viewer.load('replacement.usda');
      await sweep();
      viewer.setPathTracingPaused(true);
      expect(statuses.at(-1)?.denoiser.state).toBe('waiting');
      const samples = statuses.at(-1)?.samples;
      finish(image);
      await new Promise(r => setTimeout(r, 0));
      tick(40);
      await new Promise(r => setTimeout(r, 0));
      expect(run).toHaveBeenCalledTimes(2);
      expect(statuses.at(-1)?.denoiser.state).toBe('ready');
      expect(statuses.at(-1)?.samples).toBe(samples);
      expect(device.queue.writeTexture).toHaveBeenCalledTimes(1);
    } finally { run.mockRestore(); busyGetter.mockRestore(); }
  });

  it('shares the real HDR CDF with the path tracer and keeps its sampling metadata', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const { viewer, device, loaded } = await setup(true);
    viewer.setBackend('pathtracing');
    tick(0);
    await new Promise(r => setTimeout(r, 20));
    const expected = buildEnvCdf(loaded.environment!.image);
    const upload = device.queue.writeBuffer.mock.calls.find(call =>
      call[2] instanceof Float32Array && call[2].length === 8 && call[2][7] === expected.cdf[7]);
    expect(upload).toBeDefined();
    const cdfBuffer = upload![0];
    expect(device.createBindGroup.mock.calls.some(([desc]) =>
      Array.from(desc.entries).some(entry => entry.binding === 2 && 'buffer' in entry.resource && entry.resource.buffer === cdfBuffer))).toBe(true);
    const scene = await vi.mocked(buildCachedPathTraceScene).mock.results[0]!.value;
    expect(scene.environment.envTotalSum).toBe(expected.totalSum);
    expect(scene.environment.envResX).toBe(4);
  });

  it('reports neural inference errors and ignores results invalidated by resize or disabling', async () => {
    const actual = await vi.importActual<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(
      '../../src/render/pathtracing/scene-buffers.ts');
    vi.mocked(buildCachedPathTraceScene).mockImplementation(actual.buildCachedPathTraceScene);
    const run = vi.spyOn(JsDenoiser.prototype, 'run').mockRejectedValue(new Error('model unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { viewer, device, statuses } = await setup();
      viewer.setPathTracingDenoise(true);
      viewer.setBackend('pathtracing');
      tick(0);
      await new Promise(r => setTimeout(r, 20));
      tick(1);
      await Promise.resolve();
      await new Promise(r => setTimeout(r, 220));
      for (let i = 0; i < 16; i++) { tick(i + 2); await Promise.resolve(); }
      await new Promise(r => setTimeout(r, 0));
      expect(run).toHaveBeenCalledTimes(1);
      expect(statuses.at(-1)?.denoiser).toEqual({ state: 'error', error: 'model unavailable' });
      expect(error).toHaveBeenCalledWith('JS denoiser failed:', expect.any(Error));
      viewer.setPathTracingPaused(true);
      let finish!: (image: ImageData) => void;
      run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      viewer.setPathTracingDenoise(false);
      viewer.setPathTracingDenoise(true);
      tick(18);
      await new Promise(r => setTimeout(r, 0));
      expect(statuses.at(-1)?.denoiser.state).toBe('running');
      const writes = device.queue.writeTexture.mock.calls.length;
      await viewer.resize(256);
      viewer.setPathTracingDenoise(false);
      finish(new ImageData(new Uint8ClampedArray(512 * 512 * 4), 512, 512));
      await new Promise(r => setTimeout(r, 0));
      expect(device.queue.writeTexture).toHaveBeenCalledTimes(writes);
      expect(statuses.at(-1)?.denoiser.state).toBe('off');
    } finally { run.mockRestore(); error.mockRestore(); }
  });

  it('retains old targets on allocation failure and destroys replaced targets', async () => {
    const { viewer, device, textures, canvas } = await setup();
    const previous = textures.slice(-2);
    device.createTexture.mockImplementationOnce(() => { throw new Error('out of memory'); });
    await expect(viewer.resize(1024)).rejects.toThrow('out of memory');
    expect(canvas.width).toBe(512);
    expect(previous.every(t => t.destroy.mock.calls.length === 0)).toBe(true);
    await viewer.resize(256);
    expect(previous.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(canvas.width).toBe(256);
  });

  it('does not queue more frames while the GPU is busy', async () => {
    const { viewer, device } = await setup();
    let done!: () => void;
    device.queue.onSubmittedWorkDone.mockImplementationOnce(() => new Promise<void>(r => { done = r; }));
    device.queue.submit.mockClear();
    tick(0);
    await viewer.resize(256);
    tick(1);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    done();
    await Promise.resolve();
    tick(2);
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
  });

  it('generates every HDR mip once and reuses the filtering pipeline per device', () => {
    const { device, gpu } = fakeDevice();
    const texture = device.createTexture({ size: [8, 4], format: 'rgba16float', usage: 1, mipLevelCount: 4 });
    generateEnvironmentMipmaps(gpu, texture as unknown as GPUTexture);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(device.createBindGroup).toHaveBeenCalledTimes(3);
    expect(texture.createView.mock.calls).toEqual([
      [{ baseMipLevel: 0, mipLevelCount: 1 }], [{ baseMipLevel: 1, mipLevelCount: 1 }],
      [{ baseMipLevel: 1, mipLevelCount: 1 }], [{ baseMipLevel: 2, mipLevelCount: 1 }],
      [{ baseMipLevel: 2, mipLevelCount: 1 }], [{ baseMipLevel: 3, mipLevelCount: 1 }],
    ]);
    generateEnvironmentMipmaps(gpu, texture as unknown as GPUTexture);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });
});
