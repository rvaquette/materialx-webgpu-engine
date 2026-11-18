import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaterialXEngine } from '../src/engine.ts';

const viewer = vi.hoisted(() => ({
  initialize: vi.fn(),
  load: vi.fn(async (_url: string) => {}),
  dispose: vi.fn(),
  setBackend: vi.fn(),
  setPathTracingPaused: vi.fn(),
  setPathTracingLimits: vi.fn(),
  pathTracingLimits: { targetRelativeError: 0.05, stopOnConvergence: false, timeBudgetSeconds: 0 },
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
  it('loads a scene and starts path tracing with the requested automatic noise target', async () => {
    const { canvas, context, device } = fixture();
    const onStatus = vi.fn();
    const engine = await MaterialXEngine.create(canvas, { device, onStatus });
    expect(viewer.initialize).toHaveBeenCalledWith(expect.objectContaining({ canvas, orbitControls: false, onStatus }));
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
});
