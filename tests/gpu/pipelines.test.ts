import { describe, it, expect, vi } from 'vitest';
import { PipelineCache, PipelineDeviceLostError } from '../../src/gpu/pipelines.ts';
import { type PipelineKeyParts } from '../../src/compiler/cache.ts';

const KEY_PARTS: PipelineKeyParts = {
  shaderHash: 'abc123',
  compilerVersion: '1.0.0',
  backend: 'webgpu',
  pass: 'opaque',
  layouts: ['L0'],
  vertexAttributes: ['position'],
  colorFormats: ['rgba16float'],
  sampleCount: 1,
};

describe('PipelineCache', () => {
  it('builds once per key and caches the result', async () => {
    const cache = new PipelineCache<{ id: number }>();
    const key = cache.keyFor(KEY_PARTS);
    const build = vi.fn(async () => ({ id: 1 }));
    const first = await cache.getOrCreate(key, build);
    const second = await cache.getOrCreate(key, build);
    expect(first).toBe(second);
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('deduplicates concurrent builds', async () => {
    const cache = new PipelineCache<number>();
    const build = vi.fn(async () => 7);
    const [a, b] = await Promise.all([
      cache.getOrCreate('k', build),
      cache.getOrCreate('k', build),
    ]);
    expect(a).toBe(7);
    expect(b).toBe(7);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('invalidates all pipelines and bumps the generation on device loss', async () => {
    const cache = new PipelineCache<number>();
    await cache.getOrCreate('k', async () => 1);
    expect(cache.size).toBe(1);
    const gen = cache.deviceGeneration;
    cache.invalidateDevice();
    expect(cache.deviceGeneration).toBe(gen + 1);
    expect(cache.size).toBe(0);
    expect(cache.has('k')).toBe(false);
  });

  it('discards a pipeline built after the device was lost', async () => {
    const cache = new PipelineCache<number>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const promise = cache.getOrCreate('k', async () => {
      await gate;
      return 5;
    });
    cache.invalidateDevice();
    release();
    await expect(promise).rejects.toBeInstanceOf(PipelineDeviceLostError);
    expect(cache.size).toBe(0);
  });
});
