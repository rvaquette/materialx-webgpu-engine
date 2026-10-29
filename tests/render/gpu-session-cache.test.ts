import { expect, it, vi } from 'vitest';
import { cacheGpuPipelines } from './gpu-session-cache.ts';

it('reuses compatible modules, layouts and pipelines but separates changed shaders and states', async () => {
  const create = () => ({});
  const device = {
    createShaderModule: vi.fn(create),
    createBindGroupLayout: vi.fn(create),
    createPipelineLayout: vi.fn(create),
    createRenderPipeline: vi.fn(create),
    createComputePipeline: vi.fn(create),
    createRenderPipelineAsync: vi.fn(async () => ({})),
    createComputePipelineAsync: vi.fn(async () => ({})),
  };
  const nativeCompute = device.createComputePipelineAsync;
  const cache = cacheGpuPipelines(device as unknown as GPUDevice);
  const gpu = device as unknown as GPUDevice;
  const module = gpu.createShaderModule({ code: 'shader A' });
  expect(gpu.createShaderModule({ code: 'shader A' })).toBe(module);
  const layout = gpu.createBindGroupLayout({ entries: [] });
  expect(gpu.createBindGroupLayout({ entries: [] })).toBe(layout);
  const pipelineLayout = gpu.createPipelineLayout({ bindGroupLayouts: [layout] });
  expect(gpu.createPipelineLayout({ bindGroupLayouts: [layout] })).toBe(pipelineLayout);
  const descriptor: GPUComputePipelineDescriptor = { layout: pipelineLayout, compute: { module, entryPoint: 'main' } };
  const [first, second] = await Promise.all([
    gpu.createComputePipelineAsync(descriptor),
    gpu.createComputePipelineAsync({ compute: { entryPoint: 'main', module }, layout: pipelineLayout }),
  ]);
  expect(first).toBe(second);
  expect(nativeCompute).toHaveBeenCalledTimes(1);
  const different = await gpu.createComputePipelineAsync({
    ...descriptor, compute: { module: gpu.createShaderModule({ code: 'shader B' }), entryPoint: 'main' },
  });
  expect(different).not.toBe(first);
  const constants = await gpu.createComputePipelineAsync({
    ...descriptor, compute: { ...descriptor.compute, constants: { label: 1 } },
  });
  expect(constants).not.toBe(first);
  expect(cache().hits).toBe(4);
  class ForeignLayout {}
  const foreignA = new ForeignLayout() as GPUBindGroupLayout;
  const foreignB = new ForeignLayout() as GPUBindGroupLayout;
  expect(gpu.createPipelineLayout({ bindGroupLayouts: [foreignA] }))
    .not.toBe(gpu.createPipelineLayout({ bindGroupLayouts: [foreignB] }));
});

it('does not retain rejected asynchronous pipeline compilations', async () => {
  const device = {
    createShaderModule: () => ({}), createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}), createRenderPipeline: () => ({}),
    createComputePipeline: () => ({}), createRenderPipelineAsync: async () => ({}),
    createComputePipelineAsync: vi.fn().mockRejectedValueOnce(new Error('compile failed')).mockResolvedValue({}),
  };
  const native = device.createComputePipelineAsync;
  cacheGpuPipelines(device as unknown as GPUDevice);
  const gpu = device as unknown as GPUDevice;
  const descriptor: GPUComputePipelineDescriptor = { layout: 'auto', compute: { module: gpu.createShaderModule({ code: '' }) } };
  await expect(gpu.createComputePipelineAsync(descriptor)).rejects.toThrow('compile failed');
  await gpu.createComputePipelineAsync(descriptor);
  expect(native).toHaveBeenCalledTimes(2);
});
