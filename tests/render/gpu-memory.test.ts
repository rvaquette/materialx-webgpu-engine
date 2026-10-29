import { describe, expect, it } from 'vitest';
import { textureByteSize, trackGpuMemory } from './gpu-memory.ts';

describe('GPU memory accounting', () => {
  const texture = {
    width: 8, height: 4, depthOrArrayLayers: 6, dimension: '2d' as const,
    mipLevelCount: 4, sampleCount: 1, format: 'rgba16float' as const,
  };
  it('counts mips, array layers, MSAA, 3D mip depth and unknown formats', () => {
    expect(textureByteSize(texture)).toBe((32 + 8 + 2 + 1) * 6 * 8);
    expect(textureByteSize({ ...texture, mipLevelCount: 1, sampleCount: 4 })).toBe(32 * 6 * 8 * 4);
    expect(textureByteSize({ ...texture, dimension: '3d', depthOrArrayLayers: 4 })).toBe((128 + 16 + 2 + 1) * 8);
    expect(textureByteSize({ ...texture, format: 'depth24plus', mipLevelCount: 1 })).toBe(32 * 6 * 4);
    expect(textureByteSize({ ...texture, format: 'bc1-rgba-unorm' })).toBeUndefined();
  });
  it('tracks actual allocation peaks and repeated explicit destruction', () => {
    const buffers: GPUBuffer[] = [];
    const textures: GPUTexture[] = [];
    const device = {
      createBuffer: (descriptor: GPUBufferDescriptor) => {
        const buffer = { size: descriptor.size, destroy() {} } as GPUBuffer;
        buffers.push(buffer);
        return buffer;
      },
      createTexture: () => {
        const resource = { ...texture, destroy() {} } as GPUTexture;
        textures.push(resource);
        return resource;
      },
    } as Pick<GPUDevice, 'createBuffer' | 'createTexture'>;
    const snapshot = trackGpuMemory(device as GPUDevice);
    device.createBuffer({ size: 100, usage: 1 });
    device.createTexture({ size: [8, 4, 6], format: 'rgba16float', usage: 1 });
    const textureBytes = textureByteSize(texture)!;
    expect(snapshot().peakBytes).toBe(100 + textureBytes);
    buffers[0]!.destroy();
    buffers[0]!.destroy();
    expect(snapshot().bufferBytes).toBe(0);
    textures[0]!.destroy();
    expect(snapshot().textureBytes).toBe(0);
    expect(snapshot().peakTextureBytes).toBe(textureBytes);
    expect(snapshot().peakBufferBytes).toBe(100);
    expect(snapshot().peakBytes).toBe(100 + textureBytes);
    device.createBuffer({ size: 50, usage: 1 });
    snapshot.reset();
    expect(snapshot().peakBytes).toBe(0);
    expect(snapshot().bufferBytes).toBe(0);
    device.createBuffer({ size: 50, usage: 1 });
    expect(snapshot().peakBytes).toBe(50);
  });
});
