// Diagnosis only: compile time of the path-tracing megakernel for option combinations.
import { pathTraceComputeWgsl, type PathTraceComputeOptions } from '../src/render/pathtracing/compute.ts';
import { buildMaterialDispatch } from '../src/render/pathtracing/material-variant.ts';
import { PT_MAX_LOBES } from '../src/render/pathtracing/material-record.ts';

export async function compileKernel(options: Omit<PathTraceComputeOptions, 'dispatch'>): Promise<{ bytes: number; ms: number; errors: number }> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  const device = await adapter!.requestDevice({ requiredLimits: {
    maxStorageBuffersPerShaderStage: adapter!.limits.maxStorageBuffersPerShaderStage,
    maxSampledTexturesPerShaderStage: adapter!.limits.maxSampledTexturesPerShaderStage,
  } });
  const code = pathTraceComputeWgsl({ dispatch: buildMaterialDispatch([]), ...options });
  const module = device.createShaderModule({ code });
  const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.slice(0, 3).map(message => `${message.lineNum}: ${message.message}`).join('\n'));
  const start = performance.now();
  await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'mx_path_trace' } });
  const ms = performance.now() - start;
  device.destroy();
  return { bytes: code.length, ms, errors: errors.length };
}

export const MAX_LOBES = PT_MAX_LOBES;
