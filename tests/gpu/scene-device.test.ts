import { expect, it } from 'vitest';
import { sceneDeviceDescriptor, assertSceneStorageSize, assertSceneTextureBindings } from '../../src/gpu/device.ts';

it('requests actual adapter storage and allocation limits for large scenes', () => {
  const adapter = { limits: {
    maxStorageBufferBindingSize: 2147483644, maxBufferSize: 2147483648, maxStorageBuffersPerShaderStage: 10,
    maxSampledTexturesPerShaderStage: 48, maxSamplersPerShaderStage: 16,
  } };
  expect(sceneDeviceDescriptor(adapter as GPUAdapter)).toEqual({ requiredLimits: adapter.limits });
  const device = { limits: adapter.limits } as GPUDevice;
  expect(() => assertSceneStorageSize(device, 143208384)).not.toThrow();
});

it('rejects texture binding counts above negotiated device capacity', () => {
  const device = { limits: { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16 } } as GPUDevice;
  expect(() => assertSceneTextureBindings(device, 16, 16)).not.toThrow();
  expect(() => assertSceneTextureBindings(device, 17, 1)).toThrow('17 sampled textures');
  expect(() => assertSceneTextureBindings(device, 1, 17)).toThrow('17 samplers');
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
