import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaterialXEngine } from '../src/engine.ts';

const viewer = vi.hoisted(() => ({
  initialize: vi.fn(),
  load: vi.fn(async (_url: string) => {}),
  dispose: vi.fn(),
  setBackend: vi.fn(),
  setPathTracingPaused: vi.fn(),
  setPathTracingLimits: vi.fn(),
  setObjectMaterial: vi.fn(async (_path: string, _asset?: string, _compiled?: string) => {}),
  renderRasterTo: vi.fn(),
  renderPathTraceTo: vi.fn(async (_view: unknown, _samples: number) => {}),
  objects: [{ path: '/World/Triangle', material: 'Matte' }],
  isCompiledScene: false,
  timeline: { animated: true, start: 0, end: 48, timeCodesPerSecond: 24 },
  setTime: vi.fn(async (_time: number) => {}),
  setVariant: vi.fn(async (_path: string, _set: string, _variant: string) => {}),
  setPathTracingTemporalHistory: vi.fn(),
  pathTracingLimits: { targetRelativeError: 0.05, stopOnConvergence: false, timeBudgetSeconds: 0 },
  snapshotState: vi.fn(() => ({ settings: { backend: 'raster' } })),
  restoreState: vi.fn(async (_snapshot: unknown) => {}),
  gpuMemory: { buffers: 10, textures: 20, total: 30, peak: 40, textureLimit: 8192 },
  backend: 'raster',
}));

vi.mock('../src/render/viewer.ts', () => ({
  InteractiveViewer: class {
    constructor(options: unknown) {
      viewer.initialize(options);
      Object.assign(this, viewer);
    }
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const context = { configure: vi.fn(), unconfigure: vi.fn() };
  const canvas = { width: 256, height: 128, getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
  const device = { destroy: vi.fn() } as unknown as GPUDevice;
  vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
  return { canvas, context, device };
}

describe('MaterialXEngine', () => {
  it('journals structured diagnostics and shader errors and exports them as JSON', async () => {
    const { canvas, device } = fixture();
    const onDiagnostic = vi.fn();
    const engine = await MaterialXEngine.create(canvas, { device, onDiagnostic });
    const options = viewer.initialize.mock.calls[0]![0] as {
      onDiagnostic(diagnostic: unknown): void; onShaderErrors(errors: unknown[]): void;
    };
    options.onDiagnostic({ level: 'warning', code: 'texture-downscaled', message: 'Texture reduced', detail: { error: new Error('x'), data: new Float32Array(4) } });
    const shaderError = { shader: 'Path tracing', message: 'unknown identifier', line: 12, column: 4, source: 'let a = b;' };
    options.onShaderErrors([shaderError]);
    options.onShaderErrors([shaderError]);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'texture-downscaled' }));
    expect(engine.diagnostics.map(record => record.code)).toEqual(['texture-downscaled', 'shader-compilation']);
    expect(engine.diagnostics[1]!.shader).toEqual({ name: 'Path tracing', line: 12, column: 4, source: 'let a = b;' });
    const exported = JSON.parse(engine.exportDiagnostics());
    expect(exported).toMatchObject({ format: 'materialx-webgpu-diagnostics', version: 1, backend: 'raster', gpuMemory: { total: 30 } });
    expect(exported.diagnostics[0].detail).toEqual({ error: { name: 'Error', message: 'x' }, data: { type: 'Float32Array', byteLength: 16 } });
    expect(engine.capabilities.backends.raster).toBeDefined();
    expect(engine.telemetry()).toBeUndefined();
    engine.dispose();
  });

  it('recreates an owned device after a loss and restores the scene', async () => {
    const { canvas, context } = fixture();
    let lose!: (info: GPUDeviceLostInfo) => void;
    const lost = new Promise<GPUDeviceLostInfo>(resolve => { lose = resolve; });
    const first = { destroy: vi.fn(), lost } as unknown as GPUDevice;
    const second = { destroy: vi.fn(), lost: new Promise(() => {}) } as unknown as GPUDevice;
    const requestDevice = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal('navigator', { gpu: {
      getPreferredCanvasFormat: () => 'bgra8unorm',
      requestAdapter: async () => ({ limits: {}, requestDevice }),
    } });
    const events: Array<{ reason: string; recovery: Promise<boolean> }> = [];
    const engine = await MaterialXEngine.create(canvas, { onDeviceLost: event => events.push(event) });
    await engine.loadUsd('scene.usda');
    let restored!: () => void;
    viewer.restoreState.mockImplementationOnce(() => new Promise<void>(resolve => { restored = resolve; }));
    lose({ reason: 'unknown', message: 'GPU process crashed' } as GPUDeviceLostInfo);
    await vi.waitFor(() => expect(viewer.restoreState).toHaveBeenCalled());
    await expect(engine.loadUsd('other.usda')).rejects.toThrow('restoring the scene');
    restored();
    expect(await events[0]!.recovery).toBe(true);
    expect(viewer.snapshotState).toHaveBeenCalledOnce();
    expect(viewer.restoreState).toHaveBeenCalledWith({ settings: { backend: 'raster' } });
    expect(context.configure).toHaveBeenLastCalledWith(expect.objectContaining({ device: second }));
    expect(engine.diagnostics.map(record => record.code)).toEqual(['device-lost', 'device-restored']);
    expect(engine.objects).toHaveLength(1);
    engine.dispose();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it('reports a lost borrowed device without replacing it', async () => {
    const { canvas, device } = fixture();
    let lose!: (info: GPUDeviceLostInfo) => void;
    Object.assign(device, { lost: new Promise<GPUDeviceLostInfo>(resolve => { lose = resolve; }) });
    const engine = await MaterialXEngine.create(canvas, { device });
    lose({ reason: 'unknown', message: 'reset' } as GPUDeviceLostInfo);
    await vi.waitFor(() => expect(engine.diagnostics.map(record => record.code)).toEqual(['device-lost', 'device-recovery-failed']));
    await expect(engine.loadUsd('scene.usda')).rejects.toThrow('could not recover');
    expect(viewer.restoreState).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('captures tightly packed top-down RGBA pixels without a canvas', async () => {
    const { device } = fixture();
    const data = new Uint8Array(512).fill(99);
    data.set([1, 2, 3, 255, 4, 5, 6, 255]);
    data.set([7, 8, 9, 255, 10, 11, 12, 255], 256);
    const buffer = { mapAsync: vi.fn(async () => {}), getMappedRange: () => data.buffer, unmap: vi.fn(), destroy: vi.fn() };
    const view = {};
    const texture = { createView: () => view, destroy: vi.fn() };
    const encoder = { copyTextureToBuffer: vi.fn(), finish: vi.fn() };
    Object.assign(device, {
      limits: { maxTextureDimension2D: 4096, maxBufferSize: 1024 },
      createTexture: vi.fn(() => texture), createBuffer: vi.fn(() => buffer),
      createCommandEncoder: () => encoder, queue: { submit: vi.fn() },
      pushErrorScope: vi.fn(), popErrorScope: async () => null,
    });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, COPY_SRC: 2 });
    vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_DST: 2 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const engine = await MaterialXEngine.createHeadless({ device, width: 2, height: 2 });
    await expect(engine.capture()).rejects.toThrow('Load a USD scene');
    await engine.loadUsd('scene.usda');
    await expect(engine.render({ backend: 'pathtracing' })).rejects.toThrow('Use capture()');
    const image = await engine.capture();
    expect(viewer.renderRasterTo).toHaveBeenCalledWith(view);
    expect(encoder.copyTextureToBuffer).toHaveBeenCalledWith(
      { texture }, { buffer, bytesPerRow: 256 }, [2, 2],
    );
    expect(image).toEqual({ width: 2, height: 2, rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]) });
    expect(buffer.unmap).toHaveBeenCalledOnce();
    expect(buffer.destroy).toHaveBeenCalledOnce();
    expect(texture.destroy).toHaveBeenCalledOnce();

    buffer.mapAsync.mockRejectedValueOnce(new Error('Readback failed'));
    await expect(engine.capture()).rejects.toThrow('Readback failed');
    expect(buffer.unmap).toHaveBeenCalledOnce();
    expect(buffer.destroy).toHaveBeenCalledTimes(2);
    expect(texture.destroy).toHaveBeenCalledTimes(2);
    await expect(engine.capture({ backend: 'pathtracing', samples: 1.5 })).rejects.toThrow('samples must be an integer');
    await engine.capture({ backend: 'pathtracing', samples: 7 });
    expect(viewer.renderPathTraceTo).toHaveBeenCalledExactlyOnceWith(view, 7);
    await engine.capture({ backend: 'pathtracing', samples: 4, shutter: { open: 0, close: 1 } });
    expect(viewer.renderPathTraceTo).toHaveBeenLastCalledWith(view, 4, { open: 0, close: 1 });
    expect(viewer.renderRasterTo).toHaveBeenCalledTimes(2);
    engine.dispose();
    expect(device.destroy).not.toHaveBeenCalled();
  });

  it('loads a scene and starts path tracing with the requested automatic noise target', async () => {
    const { canvas, context, device } = fixture();
    const onStatus = vi.fn();
    const engine = await MaterialXEngine.create(canvas, { device, onStatus });
    expect(viewer.initialize).toHaveBeenCalledWith(expect.objectContaining({ canvas, orbitControls: false, streaming: false }));
    const status = { backend: 'raster', samples: 0 };
    (viewer.initialize.mock.calls[0]![0] as { onStatus(status: unknown): void }).onStatus(status);
    expect(onStatus).toHaveBeenCalledWith(status);
    await engine.loadUsd(new URL('https://example.test/scene.usda'));
    expect(viewer.load).toHaveBeenCalledWith('https://example.test/scene.usda');
    await engine.render({ backend: 'pathtracing', targetNoise: 0.02 });
    expect(viewer.setPathTracingLimits).toHaveBeenCalledWith({
      stopOnConvergence: true, targetRelativeError: 0.02, timeBudgetSeconds: 0,
    });

    expect(viewer.setBackend).toHaveBeenCalledWith('pathtracing');
    expect(viewer.setPathTracingPaused).toHaveBeenCalledWith(false);

    engine.dispose();
    engine.dispose();
    expect(context.unconfigure).toHaveBeenCalledOnce();
    expect(viewer.dispose).toHaveBeenCalledOnce();
    expect(device.destroy).not.toHaveBeenCalled();
    await expect(engine.loadUsd('scene.usda')).rejects.toThrow('disposed');
  });

  it('resolves runtime directories at creation and keeps them separate for canvas and headless engines', async () => {
    const { canvas, device } = fixture();
    Object.assign(device, { limits: { maxTextureDimension2D: 4096, maxBufferSize: 1024 } });
    vi.stubGlobal('document', { baseURI: 'https://example.test/host/index.html' });
    const materialxCore = new URL('https://cdn.example.test/mx/core');
    const canvasEngine = await MaterialXEngine.create(canvas, {
      device, runtimeAssets: { materialxCore, materialxLibraries: './libraries' },
    });
    const headless = await MaterialXEngine.createHeadless({
      device, width: 2, height: 2, runtimeAssets: { materialxCore: './other-core', openUsd: '/usd/' },
    });
    materialxCore.pathname = '/changed';
    await canvasEngine.loadUsd('canvas.usda');
    await headless.loadUsd('headless.usda');
    expect(viewer.load.mock.calls).toEqual([
      ['canvas.usda', undefined, undefined, { runtimeAssets: {
        materialxCore: 'https://cdn.example.test/mx/core/', materialxLibraries: 'https://example.test/host/libraries/',
      } }],
      ['headless.usda', undefined, undefined, { runtimeAssets: {
        materialxCore: 'https://example.test/host/other-core/', openUsd: 'https://example.test/usd/',
      } }],
    ]);
    canvasEngine.dispose();
    headless.dispose();
  });

  it('rejects overlapping operations and allows a new load after a failure', async () => {
    const { canvas, device } = fixture();
    const engine = await MaterialXEngine.create(canvas, { device });
    let rejectLoad!: (error: Error) => void;
    viewer.load.mockImplementationOnce(() => new Promise((_, reject) => { rejectLoad = reject; }));
    const first = engine.loadUsd('first.usda');
    await expect(engine.loadUsd('second.usda')).rejects.toThrow('in progress');
    await expect(engine.render()).rejects.toThrow('in progress');
    rejectLoad(new Error('Invalid scene'));
    await expect(first).rejects.toThrow('Invalid scene');
    await engine.loadUsd('second.usda');
    expect(viewer.load.mock.calls).toEqual([['first.usda'], ['second.usda']]);
    engine.dispose();
  });

  it('releases an owned device if viewer creation fails', async () => {
    const { canvas, context, device } = fixture();
    const requestDevice = vi.fn(async () => device);
    vi.stubGlobal('navigator', { gpu: {
      getPreferredCanvasFormat: () => 'bgra8unorm',
      requestAdapter: async () => ({ limits: {}, requestDevice }),
    } });
    viewer.initialize.mockImplementationOnce(() => { throw new Error('Viewer setup failed'); });

    await expect(MaterialXEngine.create(canvas)).rejects.toThrow('Viewer setup failed');
    expect(context.unconfigure).toHaveBeenCalledOnce();
    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it('lists scene objects and applies or restores a material by prim path', async () => {
    const { canvas, device } = fixture();
    vi.stubGlobal('document', { baseURI: 'https://example.test/app/' });
    const engine = await MaterialXEngine.create(canvas, { device });
    const path = '/World/Triangle';
    const material = { url: './orange.mtlx', compiledUrl: new URL('https://example.test/orange/material.json') };
    await expect(engine.setMaterial(path, material)).rejects.toThrow('Load a USD scene');
    await engine.loadUsd('scene.usda');
    expect(engine.objects).toEqual([{ path, material: 'Matte' }]);
    expect(engine.objects[0]).not.toBe(viewer.objects[0]);
    await engine.setMaterial(path, material);
    await engine.setMaterial(path);
    expect(viewer.setObjectMaterial.mock.calls).toEqual([
      [path, 'https://example.test/app/orange.mtlx', 'https://example.test/orange/material.json'],
      [path, undefined, undefined],
    ]);
    engine.dispose();
    await expect(engine.setMaterial(path, material)).rejects.toThrow('disposed');
  });

  it('reports a replacement failure and unlocks scene operations for retry', async () => {
    const { canvas, device } = fixture();
    const engine = await MaterialXEngine.create(canvas, { device });
    await engine.loadUsd('scene.usda');
    let reject!: (error: Error) => void;
    viewer.setObjectMaterial.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const pending = engine.setMaterial('/World/Triangle', { url: 'https://example.test/bad.mtlx' });
    await expect(engine.loadUsd('another.usda')).rejects.toThrow('in progress');
    await expect(engine.setMaterial('/World/Triangle')).rejects.toThrow('in progress');
    reject(new Error('Invalid MaterialX XML.'));
    await expect(pending).rejects.toThrow('Invalid MaterialX XML.');
    await engine.setMaterial('/World/Triangle');
    engine.dispose();
  });

  it('animates a loaded scene and locks other operations during a variant reload', async () => {
    const { canvas, device } = fixture();
    const engine = await MaterialXEngine.create(canvas, { device });
    expect(engine.timeline).toBeUndefined();
    await expect(engine.setTime(12)).rejects.toThrow('Load a USD scene');
    await engine.loadUsd('scene.usda');
    expect(engine.timeline).toEqual({ start: 0, end: 48, timeCodesPerSecond: 24 });
    await engine.setTime(12);
    expect(viewer.setTime).toHaveBeenCalledWith(12);
    await engine.render({ backend: 'pathtracing', temporalHistory: 8 });
    expect(viewer.setPathTracingTemporalHistory).toHaveBeenCalledWith(8);
    let finish!: () => void;
    viewer.setVariant.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = engine.setVariant('/World/Rig', 'finish', 'metal');
    await expect(engine.setTime(0)).rejects.toThrow('in progress');
    finish();
    await pending;
    expect(viewer.setVariant).toHaveBeenCalledWith('/World/Rig', 'finish', 'metal');
    engine.dispose();
  });
});
