import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadUsdScene } from '../../src/render/usd-scene-assets.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('interactive scene composition failures', () => {
  it('rejects a missing binary reference before loading materials or building incomplete geometry', async () => {
    const sink = vi.fn();
    const fetch = vi.fn(async (url: string) => new Response(url.endsWith('scene.usda')
      ? '#usda 1.0\ndef Xform "World" (prepend references = @geometry.usd@) {}'
      : 'PXR-USDC'));
    vi.stubGlobal('fetch', fetch);
    const loadCrateModule = vi.fn(async () => { throw new Error('Binary USD loading requires cross-origin isolation.'); });
    await expect(loadUsdScene('http://localhost/scene.usda', sink, undefined, undefined, { loadCrateModule }))
      .rejects.toThrow('cross-origin isolation');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loadCrateModule).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Arc layer unavailable') }));
  });
});
