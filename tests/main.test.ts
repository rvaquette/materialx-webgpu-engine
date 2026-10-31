import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerStatus } from '../src/render/viewer.ts';

const state = vi.hoisted(() => ({
  onStatus: undefined as ((status: ViewerStatus) => void) | undefined,
  load: vi.fn(),
}));
vi.mock('../src/render/viewer.ts', () => ({
  InteractiveViewer: class {
    objects = [];
    constructor(options: { onStatus: (status: ViewerStatus) => void }) { state.onStatus = options.onStatus; }
    load = state.load;
    setBackend = vi.fn();
  },
}));

function element() {
  return { hidden: false, textContent: '', setAttribute: vi.fn() };
}

describe('viewer loading indicator', () => {
  const indicator = element();
  const status = element();
  const spp = element();
  const canvas = { ...element(), getContext: () => ({ configure: vi.fn() }) };
  let finishLoad: () => void;

  beforeEach(() => {
    vi.resetModules();
    state.onStatus = undefined;
    state.load.mockReset().mockImplementation(() => new Promise<void>(resolve => { finishLoad = resolve; }));
    indicator.hidden = false;
    status.hidden = true;
    status.textContent = '';
    canvas.setAttribute.mockClear();
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('document', {
      baseURI: 'http://localhost/',
      getElementById: (id: string) => ({ view: canvas, status, 'busy-indicator': indicator, 'pathtracing-spp': spp })[id],
      querySelectorAll: () => [],
    });
    const device = { addEventListener: vi.fn(), lost: new Promise(() => {}) };
    vi.stubGlobal('navigator', { gpu: {
      requestAdapter: async () => ({
        limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28, maxStorageBuffersPerShaderStage: 8 },
        requestDevice: async () => device,
      }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const emit = (pathTracer: ViewerStatus['pathTracer'], backend: ViewerStatus['backend'] = 'pathtracing', samples = 0, paused = true) => {
    state.onStatus!({
      backend, pathTracer, pathTracingPaused: paused, rasterQuality: 'interactive',
      pathTracingDenoise: false, denoiser: { state: 'off' }, drawCount: 2, passes: [],
      samples, warnings: 0,
    });
  };

  it('stays busy throughout loading and hides the normal descriptive status after success', async () => {
    await import('../src/main.ts');
    await settle();
    expect(state.load).toHaveBeenCalled();
    emit('idle', 'raster');
    expect(indicator.hidden).toBe(false);
    expect(status.hidden).toBe(true);
    finishLoad();
    await settle();
    expect(indicator.hidden).toBe(true);
    expect(status.textContent).toBe('');
    expect(canvas.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
  });

  it('tracks lazy path tracer compilation even while paused, without showing a Backend line', async () => {
    await import('../src/main.ts');
    await settle();
    finishLoad();
    await settle();
    emit('idle');
    expect(indicator.hidden).toBe(false);
    emit('compiling');
    expect(indicator.hidden).toBe(false);
    emit('ready');
    expect(indicator.hidden).toBe(true);
    expect(status.hidden).toBe(true);
    expect(status.textContent).not.toContain('Backend');
  });

  it('stops the indicator on compilation failure and keeps the error visible', async () => {
    await import('../src/main.ts');
    await settle();
    finishLoad();
    await settle();
    emit('compiling');
    emit('error');
    expect(indicator.hidden).toBe(true);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('Echec de compilation');
  });

  it('shows live spp only for a ready path tracer and preserves its count in pause', async () => {
    await import('../src/main.ts');
    await settle();
    emit('compiling');
    expect(spp.hidden).toBe(true);
    emit('ready', 'pathtracing', 8, false);
    expect(spp.hidden).toBe(false);
    expect(spp.textContent).toBe('8 spp');
    emit('ready', 'pathtracing', 8);
    expect(spp.textContent).toBe('8 spp (pause)');
    emit('ready', 'pathtracing', 9, false);
    expect(spp.textContent).toBe('9 spp');
    emit('ready', 'raster');
    expect(spp.hidden).toBe(true);
    expect(status.hidden).toBe(true);
    finishLoad();
    await settle();
  });

  it('stops the initial indicator when WebGPU is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await import('../src/main.ts');
    expect(indicator.hidden).toBe(true);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('WebGPU is not available');
  });
});
