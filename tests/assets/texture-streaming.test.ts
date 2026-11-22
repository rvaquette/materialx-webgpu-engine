import { describe, expect, it } from 'vitest';
import { downscaleImage, limitImageProvider } from '../../src/assets/image-limits.ts';
import { StreamingImages, isPlaceholderImage, placeholderPixels } from '../../src/assets/streaming-images.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';

function rgba(width: number, height: number, value: (x: number, y: number) => number): DecodedPixelImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.fill(value(x, y), (y * width + x) * 4, (y * width + x) * 4 + 4);
  return { kind: 'pixels', data, componentType: 'uint8', channels: 4, width, height, colorSpace: 'srgb_texture' };
}

describe('texture size limits', () => {
  it('box-filters by halves until the image fits, UDIM tiles included', () => {
    const image = rgba(8, 4, x => (x % 2 ? 200 : 100));
    const small = downscaleImage(image, 2);
    expect([small.width, small.height]).toEqual([2, 1]);
    expect([...small.data.slice(0, 4)]).toEqual([150, 150, 150, 150]);
    const udim = downscaleImage({ ...image, udim: [{ tile: 1001, image }, { tile: 1002, image }] }, 4);
    expect(udim.udim!.map(layer => [layer.image.width, layer.image.height])).toEqual([[4, 2], [4, 2]]);
    expect(downscaleImage(image, 8)).toBe(image);
  });

  it('reports each reduction once per size and follows the current cap', async () => {
    const image = rgba(16, 16, () => 7);
    const reductions: string[] = [];
    let cap = 8;
    const provider = limitImageProvider({ decode: async () => image }, () => cap, r => reductions.push(`${r.from}->${r.to}`));
    expect((await provider.decode('a.png'))!.width).toBe(8);
    expect((await provider.decode('a.png'))!.width).toBe(8);
    cap = 4;
    expect((await provider.decode('a.png'))!.width).toBe(4);
    expect(reductions).toEqual(['16,16->8,8', '16,16->4,4']);
  });
});

describe('StreamingImages', () => {
  it('serves placeholders, then decoded files and UDIM tiles as they arrive', async () => {
    const tile = rgba(4, 4, () => 50);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const streaming = new StreamingImages({
      decode: async file => {
        if (file.includes('1002')) await gate;
        return file === 'missing.png' ? undefined : tile;
      },
      exportSource: file => (file.includes('<UDIM>') ? { urls: [file], tiles: [1001, 1002] } : { urls: [file] }),
    });
    const first = streaming.snapshot();
    expect(isPlaceholderImage(first.decode('a.png') as DecodedPixelImage)).toBe(true);
    streaming.prefetch(['a.png', 'skin.<UDIM>.png', 'missing.png']);
    await new Promise(resolve => setTimeout(resolve, 0));
    const partial = streaming.snapshot().decode('skin.<UDIM>.png') as DecodedPixelImage;
    expect(partial.udim!.map(layer => isPlaceholderImage(layer.image))).toEqual([false, true]);
    expect([partial.udim![1]!.image.width, partial.udim![1]!.image.height]).toEqual([4, 4]);
    expect(streaming.progress.pending).toBe(1);
    release();
    await streaming.settled();
    const done = streaming.snapshot();
    expect(done.decode('a.png')).toBe(tile);
    expect(done.decode('missing.png')).toBeUndefined();
    expect((done.decode('skin.<UDIM>.png') as DecodedPixelImage).udim!.every(layer => layer.image === tile)).toBe(true);
  });

  it('uploads placeholders as grey colour or a flat normal', () => {
    const image = streamingPlaceholder();
    expect([...placeholderPixels(image, 'rgba8unorm-srgb')]).toEqual([128, 128, 128, 255]);
    expect([...placeholderPixels(image, 'rgba8unorm')]).toEqual([128, 128, 255, 255]);
  });
});

function streamingPlaceholder(): DecodedPixelImage {
  return new StreamingImages({ decode: () => undefined }).snapshot().decode('x.png') as DecodedPixelImage;
}
