import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveViewer, type ViewerStatus } from '../../src/render/viewer.ts';
import { loadUsdScene, type LoadedUsdScene } from '../../src/render/usd-scene-assets.ts';
import { buildPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';
import { generateEnvironmentMipmaps } from '../../src/render/env/mipmaps.ts';
import { buildSceneResources } from '../../src/render/scene-resources.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { NEUTRAL_SURFACE } from '../../src/render/raster/scene-frame.ts';

vi.mock('../../src/render/usd-scene-assets.ts', async (original) => ({
  ...await original<typeof import('../../src/render/usd-scene-assets.ts')>(),
  loadUsdScene: vi.fn(),
}));
vi.mock('../../src/render/pathtracing/scene-buffers.ts', async (original) => ({
  ...await original<typeof import('../../src/render/pathtracing/scene-buffers.ts')>(),
  buildPathTraceScene: vi.fn(),
}));

function fakeDevice() {
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), setIndexBuffer: vi.fn(),
    setScissorRect: vi.fn(), drawIndexed: vi.fn(), draw: vi.fn(), end: vi.fn(),
  };
  const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn((desc: GPUTextureDescriptor) => {
      const texture = { mipLevelCount: desc.mipLevelCount ?? 1, createView: vi.fn(() => ({})), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createShaderModule: vi.fn(() => ({ getCompilationInfo: async () => ({ messages: [] }) })),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn(() => ({})),
    createSampler: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({ beginRenderPass: vi.fn(() => pass), finish: vi.fn(() => ({})) })),
    queue: {
      writeBuffer: vi.fn(), writeTexture: vi.fn(), submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => {}),
    },
  };
  return { device, gpu: device as unknown as GPUDevice, pass, textures };
}

async function sceneFixture(): Promise<LoadedUsdScene> {
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
    nodes: new Map([['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs: [], provenance: { namePath: '/s' } }]]),
  };
  const builder = new IrModuleBuilder();
  builder.output({ name: 'color', type: FLOAT, ref: builder.constant(FLOAT, 1) });
  const ir = builder.build();
  const resources = await buildSceneResources(scene, {
    meshSource: { meshFor: () => ({
      points: [-1, 0, 0, 1, 0, 0, 0, 1, 0], faceVertexCounts: [3], faceVertexIndices: [0, 1, 2],
    }) },
    materialCompiler: {
      compile: () => ({ ir, module: emitWgsl(ir), layered: emitLayeredSurface(graph, resolveSurface(graph, {})!) }),
    },
  });
  return {
    entry: 'scene.usda', scene, resources, lights: [], cameras: [],
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
    vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, INDEX: 2, COPY_DST: 4, UNIFORM: 8, STORAGE: 16 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
    vi.mocked(buildPathTraceScene).mockReset();
  });
  afterEach(() => { viewer?.dispose(); vi.unstubAllGlobals(); });

  async function setup() {
    const loaded = await sceneFixture();
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

  it('does not build path-tracing CPU data/BVH in raster, including after resize', async () => {
    const { viewer, device, loaded } = await setup();
    expect(loaded.resources.materials.size).toBe(1);
    expect(buildPathTraceScene).not.toHaveBeenCalled();
    const pipelines = device.createRenderPipeline.mock.calls.length;
    const shaders = device.createShaderModule.mock.calls.length;
    const buffers = device.createBuffer.mock.calls.length;
    await viewer.resize(1024);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(pipelines);
    expect(device.createShaderModule).toHaveBeenCalledTimes(shaders);
    expect(device.createBuffer).toHaveBeenCalledTimes(buffers);
    expect(buildPathTraceScene).not.toHaveBeenCalled();
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
    vi.mocked(buildPathTraceScene).mockImplementation(() => { throw new Error('test preparation'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      viewer.setBackend('pathtracing');
      expect(buildPathTraceScene).not.toHaveBeenCalled();
      tick(0);
      await new Promise(r => setTimeout(r, 10));
      expect(buildPathTraceScene).toHaveBeenCalledTimes(1);
      viewer.setBackend('raster');
      viewer.setBackend('pathtracing');
      tick(1);
      expect(buildPathTraceScene).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('Path tracer: test preparation');
    } finally { error.mockRestore(); }
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
