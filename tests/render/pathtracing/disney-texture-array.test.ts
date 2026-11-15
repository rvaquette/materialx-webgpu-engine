import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecodedPixelImage } from '../../../src/assets/images.ts';
import { DisneyTextureRegistry, uploadDisneyTextureArray } from '../../../src/render/pathtracing/disney-texture-array.ts';

afterEach(() => vi.unstubAllGlobals());

function image(width: number, height: number, data: number[]): DecodedPixelImage {
  return { kind: 'pixels', componentType: 'uint8', channels: 4, width, height, colorSpace: 'lin_rec709', data: new Uint8Array(data) };
}

function fixture() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
  const destroy = vi.fn();
  const texture: GPUTexture = {
    __brand: 'GPUTexture', label: '', destroy, createView: () => ({ __brand: 'GPUTextureView', label: '' }),
    width: 1, height: 1, depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1,
    dimension: '2d', format: 'rgba8uint', usage: 6,
  };
  const device = {
    limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
    createTexture: vi.fn(() => texture),
    queue: { writeTexture: vi.fn() },
  };
  return { device, texture, destroy };
}

describe('Disney texture array', () => {
  it('deduplicates file references and uploads raw RGBA bytes in material-layer order', async () => {
    const { device, texture } = fixture();
    const registry = new DisneyTextureRegistry();
    expect(registry.add('first.png', 'albedo')).toBe(0);
    expect(registry.add('first.png', 'metallic-roughness')).toBe(0);
    expect(registry.add('second.png', 'metallic-roughness')).toBe(1);
    const a = image(1, 1, [1, 2, 3, 4]);
    const b = image(1, 1, [5, 6, 7, 8]);
    const decode = vi.fn((file: string) => file === 'first.png' ? a : b);
    expect(await uploadDisneyTextureArray(device, registry, { decode }, 1, 1)).toBe(texture);
    expect(decode.mock.calls).toEqual([['first.png'], ['second.png']]);
    expect(device.createTexture).toHaveBeenCalledWith({ size: [1, 1, 2], format: 'rgba8uint', usage: 6 });
    expect(device.queue.writeTexture.mock.calls[0]![1]).toBe(a.data);
    expect(device.queue.writeTexture.mock.calls[1]![1]).toBe(b.data);
    expect(device.queue.writeTexture.mock.calls[1]![0].origin).toEqual([0, 0, 1]);
  });

  it('resizes differing source dimensions to the specified array dimensions', async () => {
    const { device } = fixture();
    const registry = new DisneyTextureRegistry();
    registry.add('map', 'albedo');
    const original = image(1, 1, [10, 20, 30, 40]);
    const resized = image(2, 2, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]);
    const resize = vi.fn(() => resized);
    await uploadDisneyTextureArray(device, registry, { decode: () => original }, 2, 2, resize);
    expect(resize).toHaveBeenCalledWith(original, 2, 2);
    expect(device.queue.writeTexture.mock.calls[0]![1]).toBe(resized.data);
  });

  it('rejects missing, incompatible, and improperly resized pixels without creating a texture', async () => {
    const { device } = fixture();
    const registry = new DisneyTextureRegistry();
    registry.add('map', 'albedo');
    await expect(uploadDisneyTextureArray(device, registry, { decode: () => undefined }, 2, 2)).rejects.toThrow('Missing Disney texture');
    await expect(uploadDisneyTextureArray(device, registry, { decode: () => image(1, 1, [1, 2]) }, 2, 2)).rejects.toThrow('RGBA8');
    const highPrecision: DecodedPixelImage = {
      kind: 'pixels', componentType: 'float32', channels: 4, width: 1, height: 1,
      colorSpace: 'lin_rec709', data: new Float32Array([1, 1, 1, 1]),
    };
    await expect(uploadDisneyTextureArray(device, registry, { decode: () => highPrecision }, 2, 2)).rejects.toThrow('RGBA8');
    await expect(uploadDisneyTextureArray(device, registry, { decode: () => image(1, 1, [0, 0, 0, 0]) },
      2, 2, im => im)).rejects.toThrow('resized Disney texture dimensions');
    expect(device.createTexture).not.toHaveBeenCalled();
  });

  it('handles empty registries, device limits and failed GPU writes', async () => {
    const { device, destroy } = fixture();
    const registry = new DisneyTextureRegistry();
    const provider = { decode: () => image(1, 1, [1, 2, 3, 4]) };
    expect(await uploadDisneyTextureArray(device, registry, provider, 1, 1)).toBeUndefined();
    registry.add('map', 'albedo');
    await expect(uploadDisneyTextureArray(device, registry, provider, 0, 1)).rejects.toThrow('dimensions');
    await expect(uploadDisneyTextureArray(device, registry, provider, 2, 1)).rejects.toThrow('square');
    await expect(uploadDisneyTextureArray(device, registry, provider, 9000, 9000)).rejects.toThrow('device limits');
    expect(device.createTexture).not.toHaveBeenCalled();
    device.queue.writeTexture.mockImplementation(() => { throw new Error('upload failed'); });
    await expect(uploadDisneyTextureArray(device, registry, provider, 1, 1)).rejects.toThrow('upload failed');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
