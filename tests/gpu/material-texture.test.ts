import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadMaterialImage } from '../../src/gpu/material-texture.ts';
import { decodeUdimImage } from '../../src/assets/udim.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('UDIM GPU uploads', () => {
  it('uploads sparse color layers and a separate integer index with correct formats', async () => {
    const image = await decodeUdimImage('color.<UDIM>.jpg', [1001, 1012], async () => ({
      kind: 'pixels', componentType: 'uint8', channels: 4, width: 1, height: 1,
      colorSpace: 'raw', data: new Uint8Array([255, 0, 0, 255]),
    }));
    const destroy = vi.fn<GPUTexture['destroy']>(() => undefined);
    const texture: GPUTexture = {
      __brand: 'GPUTexture', label: '', destroy,
      createView: () => ({ __brand: 'GPUTextureView', label: '' }),
      width: 1, height: 1, depthOrArrayLayers: 2, mipLevelCount: 1, sampleCount: 1,
      dimension: '2d', format: 'rgba8unorm-srgb', usage: 6,
    };
    const createTexture = vi.fn<GPUDevice['createTexture']>(() => texture);
    const writeTexture = vi.fn();
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
    const device = {
      limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
      createTexture, queue: { writeTexture },
    };
    uploadMaterialImage(device, image, 'rgba8unorm-srgb', 'udim');
    uploadMaterialImage(device, image, 'rgba8unorm-srgb', 'udim-index');
    expect(createTexture.mock.calls).toEqual([
      [{ size: [1, 1, 2], format: 'rgba8unorm-srgb', usage: 6 }],
      [{ size: [10, 100, 1], format: 'r32uint', usage: 6 }],
    ]);
    expect(writeTexture.mock.calls[1]![0].origin).toEqual([0, 0, 1]);
    expect(writeTexture.mock.calls[2]![1][11]).toBe(2);
    expect(destroy).not.toHaveBeenCalled();
    expect(() => uploadMaterialImage(device, undefined, 'rgba8unorm', 'udim')).toThrow('decoded tiles');
    device.limits.maxTextureArrayLayers = 1;
    expect(() => uploadMaterialImage(device, image, 'rgba8unorm', 'udim')).toThrow('device limits');
  });
});
