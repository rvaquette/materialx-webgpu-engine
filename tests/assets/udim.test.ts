import { describe, expect, it, vi } from 'vitest';
import { decodeUdimImage, indexUdimFiles, udimLayerIndex, udimTileAt, withUdimImages } from '../../src/assets/udim.ts';
import { AssetResolver } from '../../src/assets/resolver.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';
import { createImageSampler } from '../../src/render/pathtracing/texture-sample.ts';

function pixels(color: readonly number[], width = 1, height = 1): DecodedPixelImage {
  return {
    kind: 'pixels', componentType: 'uint8', channels: 4, width, height, colorSpace: 'raw',
    data: new Uint8Array(Array.from({ length: width * height }, () => color).flat()),
  };
}

describe('UDIM assets', () => {
  it('resolves horizontal, vertical and sparse tiles without guessing URLs', () => {
    const base = 'http://localhost/dist/';
    const index = indexUdimFiles([
      './scenes/material/color.1002.jpg', './scenes/material/color.1012.jpg',
      './scenes/material/color.1001.jpg', './scenes/material/color.1001.jpg',
      './scenes/material/plain.jpg', './scenes/material/color.1000.jpg',
    ], base);
    const url = new URL('./scenes/material/color.<UDIM>.jpg', base).href;
    expect(index.get(url)).toEqual([1001, 1002, 1012]);
    expect(AssetResolver.hasUdim(url)).toBe(true);
    expect(AssetResolver.expandUdim(url, 1012)).toBe(`${base}scenes/material/color.1012.jpg`);
    expect(udimTileAt(0.25, 0.5)).toBe(1001);
    expect(udimTileAt(1.25, 0.5)).toBe(1002);
    expect(udimTileAt(1.25, 1.5)).toBe(1012);
    for (const [u, v] of [[-0.1, 0], [10, 0], [0, -1], [9, 99], [NaN, 0], [0, Infinity]]) {
      expect(udimTileAt(u!, v!)).toBeUndefined();
    }
  });

  it('decodes all inventoried tiles, assigns sparse layers and samples by UV', async () => {
    const files = new Map([
      ['color.1001.jpg', pixels([255, 0, 0, 255])],
      ['color.1002.jpg', pixels([0, 255, 0, 255])],
      ['color.1012.jpg', pixels([0, 0, 255, 255])],
    ]);
    const decode = vi.fn(async (file: string) => files.get(file));
    const image = await decodeUdimImage('color.<UDIM>.jpg', [1001, 1002, 1012], decode);
    expect(decode.mock.calls.map(call => call[0])).toEqual([...files.keys()]);
    const index = udimLayerIndex(image);
    expect([index[0], index[1], index[2], index[11]]).toEqual([1, 2, 0, 3]);
    const sample = createImageSampler(image, { filter: 'closest' }, [0.2, 0.3, 0.4, 1]);
    expect(sample(0.5, 0.5)).toEqual([1, 0, 0, 1]);
    expect(sample(1.5, 0.5)).toEqual([0, 1, 0, 1]);
    expect(sample(1.5, 1.5)).toEqual([0, 0, 1, 1]);
    expect(sample(2.5, 0.5)).toEqual([0.2, 0.3, 0.4, 1]);
    expect(sample(-0.5, 0.5)).toEqual([0.2, 0.3, 0.4, 1]);
  });

  it('flips V within the selected tile and never filters across array layers', async () => {
    const image = await decodeUdimImage('color.<UDIM>.jpg', [1011], async () => ({
      ...pixels([255, 0, 0, 255], 1, 2),
      data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]),
    }));
    const sample = createImageSampler(image);
    expect(sample(0.5, 1.25)).toEqual([0, 0, 1, 1]);
    expect(sample(0.5, 1.75)).toEqual([1, 0, 0, 1]);
    expect(sample(0.001, 1.001)).toEqual([0, 0, 1, 1]);
  });

  it('linearizes sRGB before interpolating texels', async () => {
    const image = await decodeUdimImage('c.<UDIM>.jpg', [1001], async () => ({
      ...pixels([0, 0, 0, 255], 2),
      colorSpace: 'srgb_texture',
      data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
    }));
    expect(createImageSampler(image)(0.5, 0.5)).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('reports absent, invalid, incompatible or missing tiles instead of using 1001', async () => {
    await expect(decodeUdimImage('c.<UDIM>.jpg', [], async () => undefined)).rejects.toThrow('No UDIM tiles');
    await expect(decodeUdimImage('c.<UDIM>.jpg', [1001], async () => undefined)).rejects.toThrow('Missing UDIM tile');
    await expect(decodeUdimImage('c.<UDIM>.jpg', [1000], async () => pixels([0, 0, 0, 255]))).rejects.toThrow('Invalid');
    await expect(decodeUdimImage('c.<UDIM>.jpg', [1001, 1001], async () => pixels([0, 0, 0, 255]))).rejects.toThrow('duplicate');
    await expect(decodeUdimImage('c.<UDIM>.jpg', [1001, 1002], async file =>
      pixels([0, 0, 0, 255], file.includes('1002') ? 2 : 1))).rejects.toThrow('matching dimensions');
  });

  it('shares in-flight tile loads and retries explicitly after a failure', async () => {
    const base = 'http://localhost/';
    const index = indexUdimFiles(['./c.1001.jpg'], base);
    const sink = vi.fn();
    const decode = vi.fn(async () => pixels([255, 0, 0, 255]));
    const load = withUdimImages(decode, () => index, base, sink);
    const [a, b] = await Promise.all([load('c.<UDIM>.jpg'), load('c.%3CUDIM%3E.jpg')]);
    expect(a).toBe(b);
    expect(await load('c.%3cudim%3e.jpg')).toBe(a);
    expect(decode).toHaveBeenCalledOnce();
    const unavailable = withUdimImages(decode, () => new Map(), base, sink);
    await expect(unavailable('c.<UDIM>.jpg')).rejects.toThrow('No UDIM tiles');
    await expect(unavailable('c.<UDIM>.jpg')).rejects.toThrow('No UDIM tiles');
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
