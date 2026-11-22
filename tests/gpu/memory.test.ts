import { describe, expect, it } from 'vitest';
import { GpuMemoryTracker, textureBytes } from '../../src/gpu/memory.ts';

function fakeDevice() {
  const resource = () => ({ destroyed: false, destroy() { this.destroyed = true; } });
  return {
    createBuffer: (_: GPUBufferDescriptor) => resource(),
    createTexture: (_: GPUTextureDescriptor) => resource(),
  } as unknown as GPUDevice;
}

describe('GpuMemoryTracker', () => {
  it('counts mip chains, array layers, volumes and multisampling', () => {
    expect(textureBytes({ size: [256, 128], format: 'rgba8unorm', usage: 0 })).toBe(256 * 128 * 4);
    expect(textureBytes({ size: [4, 4], format: 'rgba16float', usage: 0, mipLevelCount: 3 })).toBe((16 + 4 + 1) * 8);
    expect(textureBytes({ size: { width: 8, height: 8, depthOrArrayLayers: 3 }, format: 'r32float', usage: 0, mipLevelCount: 2 }))
      .toBe((64 + 16) * 3 * 4);
    expect(textureBytes({ size: [8, 8, 8], dimension: '3d', format: 'r8unorm', usage: 0, mipLevelCount: 2 })).toBe(512 + 64);
    expect(textureBytes({ size: [10, 10], format: 'depth24plus', usage: 0, sampleCount: 4 })).toBe(1600);
  });

  it('tracks live resources until destroyed and restores the device', () => {
    const device = fakeDevice();
    const original = device.createBuffer;
    const tracker = new GpuMemoryTracker(device);
    const changes: number[] = [];
    tracker.onChange(usage => changes.push(usage.total));
    const buffer = device.createBuffer({ size: 1000, usage: 0 });
    const texture = device.createTexture({ size: [16, 16], format: 'rgba8unorm', usage: 0 });
    expect(tracker.usage).toEqual({ buffers: 1000, textures: 1024, total: 2024, peak: 2024 });
    buffer.destroy();
    buffer.destroy();
    expect(tracker.usage).toEqual({ buffers: 0, textures: 1024, total: 1024, peak: 2024 });
    expect((buffer as unknown as { destroyed: boolean }).destroyed).toBe(true);
    texture.destroy();
    expect(changes).toEqual([1000, 2024, 1024, 0]);
    tracker.dispose();
    expect(device.createBuffer).toBe(original);
    device.createBuffer({ size: 5, usage: 0 });
    expect(tracker.usage.total).toBe(0);
  });
});
