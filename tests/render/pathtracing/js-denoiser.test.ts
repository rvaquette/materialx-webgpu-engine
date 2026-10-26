import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsDenoiser, type DenoiserModel } from '../../../src/render/pathtracing/js-denoiser.ts';

class TestImage {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}

function model(output: ImageData): DenoiserModel {
  return {
    width: 0, height: 0, quality: 'fast', hdr: false, srgb: true, useTiling: true,
    tileSize: 256, batchSize: 1, weightsUrl: '', outputMode: 'imgData', flipOutputY: false,
    onBackendReady: vi.fn(() => () => {}),
    execute: vi.fn(async () => output), abort: vi.fn(), dispose: vi.fn(),
  };
}

describe('supplied JS denoiser adapter', () => {
  beforeEach(() => vi.stubGlobal('ImageData', TestImage));
  afterEach(() => vi.unstubAllGlobals());

  it('loads lazily, reuses the model and forwards top-down sRGB ImageData at its true size', async () => {
    const image = new ImageData(new Uint8ClampedArray(16), 2, 2);
    const instance = model(image);
    const load = vi.fn(async () => instance);
    const denoiser = new JsDenoiser({} as GPUDevice, load);
    expect(load).not.toHaveBeenCalled();
    expect(await denoiser.run(image)).toBe(image);
    expect(instance.width).toBe(2);
    expect(instance.height).toBe(2);
    expect(instance.execute).toHaveBeenCalledWith(image);
    await denoiser.run(image);
    expect(load).toHaveBeenCalledTimes(1);
    denoiser.dispose();
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects concurrent work and defers disposal until inference has finished', async () => {
    const image = new ImageData(new Uint8ClampedArray(4), 1, 1);
    const instance = model(image);
    let finish!: (output: ImageData) => void;
    vi.mocked(instance.execute).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const denoiser = new JsDenoiser({} as GPUDevice, async () => instance);
    const running = denoiser.run(image);
    await Promise.resolve();
    expect(denoiser.busy).toBe(true);
    await expect(denoiser.run(image)).rejects.toThrow('already running');
    denoiser.dispose();
    expect(instance.abort).toHaveBeenCalledTimes(1);
    expect(instance.dispose).not.toHaveBeenCalled();
    finish(image);
    await expect(running).rejects.toThrow('disposed during inference');
    expect(instance.dispose).toHaveBeenCalledTimes(1);
    expect(denoiser.busy).toBe(false);
    await expect(denoiser.run(image)).rejects.toThrow('disposed');
  });

  it('surfaces load/inference errors and permits retry after a failed lazy load', async () => {
    const image = new ImageData(new Uint8ClampedArray(4), 1, 1);
    const instance = model(image);
    const load = vi.fn<() => Promise<DenoiserModel>>()
      .mockRejectedValueOnce(new Error('missing model')).mockResolvedValue(instance);
    const denoiser = new JsDenoiser({} as GPUDevice, load);
    await expect(denoiser.run(image)).rejects.toThrow('missing model');
    expect(denoiser.busy).toBe(false);
    await expect(denoiser.run(image)).resolves.toBe(image);
    vi.mocked(instance.execute).mockRejectedValueOnce(new Error('inference failed'));
    await expect(denoiser.run(image)).rejects.toThrow('inference failed');
    denoiser.dispose();
  });

  it('rejects invalid output instead of displaying a successful-looking fallback', async () => {
    const image = new ImageData(new Uint8ClampedArray(4), 1, 1);
    const instance = model(image);
    vi.mocked(instance.execute).mockResolvedValue(undefined);
    const denoiser = new JsDenoiser({} as GPUDevice, async () => instance);
    await expect(denoiser.run(image)).rejects.toThrow('invalid image');
    denoiser.dispose();
  });
});
