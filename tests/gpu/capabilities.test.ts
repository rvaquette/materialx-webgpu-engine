import { describe, expect, it } from 'vitest';
import { describeGpuCapabilities } from '../../src/gpu/capabilities.ts';

const DEFAULT_LIMITS = {
  maxTextureDimension2D: 8192, maxTextureArrayLayers: 256, maxBindGroups: 4, maxStorageBuffersPerShaderStage: 8,
  maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456, maxComputeInvocationsPerWorkgroup: 256, maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupsPerDimension: 65535,
};

describe('describeGpuCapabilities', () => {
  it('accepts every backend on WebGPU default limits', () => {
    const caps = describeGpuCapabilities({ limits: DEFAULT_LIMITS as GPUSupportedLimits, features: new Set(['timestamp-query']) as unknown as GPUSupportedFeatures },
      { vendor: 'nvidia', architecture: 'turing' });
    expect(caps.backends.raster.supported && caps.backends.pathtracing.supported && caps.backends.disney.supported).toBe(true);
    expect(caps.gpuTimings).toBe(true);
    expect(caps.adapter.vendor).toBe('nvidia');
    expect(caps.limits.maxStorageBuffersPerShaderStage).toBe(8);
  });

  it('explains which limit rules out the path tracer', () => {
    const caps = describeGpuCapabilities({
      limits: { ...DEFAULT_LIMITS, maxStorageBuffersPerShaderStage: 4, maxComputeInvocationsPerWorkgroup: 32 } as GPUSupportedLimits,
      features: new Set() as unknown as GPUSupportedFeatures,
    });
    expect(caps.backends.raster.supported).toBe(true);
    expect(caps.backends.pathtracing.supported).toBe(false);
    expect(caps.backends.pathtracing.reason).toContain('maxStorageBuffersPerShaderStage 4 < 7');
    expect(caps.backends.pathtracing.reason).toContain('maxComputeInvocationsPerWorkgroup 32 < 64');
    expect(caps.gpuTimings).toBe(false);
  });
});
