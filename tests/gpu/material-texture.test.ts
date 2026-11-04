import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadMaterialImage, uploadMaterialImageArray } from '../../src/gpu/material-texture.ts';
import { decodeUdimImage } from '../../src/assets/udim.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('UDIM GPU uploads', () => {
  it('uploads independent images and sparse UDIM lookup maps to distinct array layers', async () => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
    const image = await decodeUdimImage('a.<UDIM>.jpg', [1001, 1012], async () => ({
      kind: 'pixels', componentType: 'uint8', channels: 4, width: 1, height: 1,
      colorSpace: 'raw', data: new Uint8Array([255, 0, 0, 255]),
    }));
    const destroy = vi.fn();
    const texture: GPUTexture = {
      __brand: 'GPUTexture', label: '', destroy,
      createView: () => ({ __brand: 'GPUTextureView', label: '' }),
      width: 1, height: 1, depthOrArrayLayers: 2, mipLevelCount: 1, sampleCount: 1,
      dimension: '2d', format: 'rgba8unorm-srgb', usage: 6,
    };
    const device = {
      limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
      createTexture: vi.fn(() => texture), queue: { writeTexture: vi.fn() },
    };
    const second = { ...image, data: new Uint8Array([0, 255, 0, 255]) };
    uploadMaterialImageArray(device, [image, second], 'rgba8unorm-srgb');
    expect(device.createTexture).toHaveBeenLastCalledWith({ size: [1, 1, 2], format: 'rgba8unorm-srgb', usage: 6 });
    expect(device.queue.writeTexture.mock.calls[0]![1]).toBe(image.data);
    expect(device.queue.writeTexture.mock.calls[1]![1]).toBe(second.data);
    expect(device.queue.writeTexture.mock.calls[1]![0].origin).toEqual([0, 0, 1]);
    const indexSecond = { ...second, udim: [{ tile: 1003, image: second }] };
    uploadMaterialImageArray(device, [image, indexSecond], 'r32uint', true);
    expect(device.createTexture).toHaveBeenLastCalledWith({ size: [10, 100, 2], format: 'r32uint', usage: 6 });
    expect(device.queue.writeTexture.mock.calls[2]![1][11]).toBe(2);
    expect(device.queue.writeTexture.mock.calls[3]![1][2]).toBe(1);
    expect(device.queue.writeTexture.mock.calls[3]![1][11]).toBe(0);
    expect(() => uploadMaterialImageArray(device, [image, { ...second, width: 2 }], 'rgba8unorm')).toThrow('Incompatible');
    expect(() => uploadMaterialImageArray(device, [undefined], 'rgba8unorm')).toThrow('decoded');
    device.limits.maxTextureArrayLayers = 1;
    expect(() => uploadMaterialImageArray(device, [image, second], 'rgba8unorm')).toThrow('device limits');
    device.limits.maxTextureArrayLayers = 256;
    device.queue.writeTexture.mockImplementation(() => { throw new Error('upload failed'); });
    expect(() => uploadMaterialImageArray(device, [image, second], 'rgba8unorm')).toThrow('upload failed');
    expect(destroy).toHaveBeenCalledOnce();
  });

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
