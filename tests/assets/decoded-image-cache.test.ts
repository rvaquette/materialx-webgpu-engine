import { describe, expect, it, vi } from 'vitest';
import { DecodedImageCache } from '../../src/assets/decoded-image-cache.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';

function pixels(size: number): DecodedPixelImage {
  return {
    kind: 'pixels',
    data: new Uint8Array(size),
    componentType: 'uint8',
    channels: 4,
    width: 1,
    height: 1,
    colorSpace: 'lin_rec709',
  };
}

describe('DecodedImageCache', () => {
  it('reuses decoded pixels by URL and deduplicates concurrent loads', async () => {
    const cache = new DecodedImageCache(1024);
    const load = vi.fn(async () => pixels(16));
    const [first, concurrent] = await Promise.all([
      cache.get('https://assets.test/texture.png#material-a', load),
      cache.get('https://assets.test/texture.png#material-b', load),
    ]);

    expect(first).toBe(concurrent);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get('https://assets.test/texture.png', load)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts old decoded images when the byte budget is exceeded', async () => {
    const cache = new DecodedImageCache(16);
    const load = vi.fn(async () => pixels(12));
    await cache.get('https://assets.test/a.png', load);
    await cache.get('https://assets.test/b.png', load);
    await cache.get('https://assets.test/a.png', load);

    expect(load).toHaveBeenCalledTimes(3);
  });
});
