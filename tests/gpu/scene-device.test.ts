import { expect, it } from 'vitest';
import { sceneDeviceDescriptor, assertSceneStorageSize } from '../../src/gpu/device.ts';

it('requests actual adapter storage and allocation limits for large scenes', () => {
  const adapter = { limits: { maxStorageBufferBindingSize: 2147483644, maxBufferSize: 2147483648, maxStorageBuffersPerShaderStage: 10 } };
  expect(sceneDeviceDescriptor(adapter as GPUAdapter)).toEqual({ requiredLimits: adapter.limits });
  const device = { limits: adapter.limits } as GPUDevice;
  expect(() => assertSceneStorageSize(device, 143208384)).not.toThrow();
});

it('rejects scenes beyond either device limit instead of producing black images', () => {
  for (const limits of [
    { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456 },
    { maxStorageBufferBindingSize: 268435456, maxBufferSize: 134217728 },
  ]) {
    const device = { limits } as GPUDevice;
    expect(() => assertSceneStorageSize(device, 134217728)).not.toThrow();
    expect(() => assertSceneStorageSize(device, 143208384)).toThrow(/143208384.*134217728/);
  }
});
