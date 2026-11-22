// What a device can run, decided from its limits before any scene is loaded.
// Scene-dependent limits (buffer sizes, texture counts) are checked again when
// a backend is built; a GpuLimitError there falls back to raster (viewer.ts).

import { PT_WORKGROUP_SIZE } from '../render/pathtracing/compute.ts';

export interface BackendSupport {
  readonly supported: boolean;
  /** Why the backend cannot run on this device. */
  readonly reason?: string;
}

export interface GpuCapabilities {
  readonly adapter: { readonly vendor: string; readonly architecture: string; readonly device: string; readonly description: string };
  readonly features: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly backends: { readonly raster: BackendSupport; readonly pathtracing: BackendSupport; readonly disney: BackendSupport };
  /** GPU pass timings are available (timestamp-query). */
  readonly gpuTimings: boolean;
  /** Largest material texture side; bigger images are downscaled. */
  readonly maxTextureSize: number;
}

/** Storage buffers of the path-tracing megakernel before optional lights, volumes and environment. */
export const PATH_TRACING_BASE_STORAGE_BUFFERS = 7;
const REPORTED_LIMITS = [
  'maxTextureDimension2D', 'maxTextureArrayLayers', 'maxBindGroups', 'maxStorageBuffersPerShaderStage',
  'maxSampledTexturesPerShaderStage', 'maxSamplersPerShaderStage', 'maxStorageBufferBindingSize', 'maxBufferSize',
  'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupsPerDimension',
] as const;

type LimitName = typeof REPORTED_LIMITS[number];
type Requirement = readonly [LimitName, number, string];

function check(limits: GPUSupportedLimits, requirements: readonly Requirement[]): BackendSupport {
  const missing = requirements.filter(([name, minimum]) => (limits[name] ?? 0) < minimum)
    .map(([name, minimum, purpose]) => `${name} ${limits[name] ?? 0} < ${minimum} (${purpose})`);
  return missing.length ? { supported: false, reason: missing.join('; ') } : { supported: true };
}

export function describeGpuCapabilities(
  device: Pick<GPUDevice, 'limits' | 'features'>, info?: Partial<GPUAdapterInfo>,
): GpuCapabilities {
  const limits = device.limits ?? ({} as GPUSupportedLimits);
  const features = device.features ?? new Set<string>();
  const raster = check(limits, [
    ['maxBindGroups', 4, 'frame, material, texture and sampler groups'],
    ['maxTextureDimension2D', 2048, 'render targets and shadow maps'],
  ]);
  const compute: Requirement[] = [
    ['maxComputeInvocationsPerWorkgroup', PT_WORKGROUP_SIZE * PT_WORKGROUP_SIZE, 'path-tracing workgroup'],
    ['maxComputeWorkgroupSizeX', PT_WORKGROUP_SIZE, 'path-tracing workgroup'],
    ['maxComputeWorkgroupSizeY', PT_WORKGROUP_SIZE, 'path-tracing workgroup'],
  ];
  const pathtracing = check(limits, [
    ['maxBindGroups', 4, 'scene, texture, sampler and environment groups'],
    ['maxStorageBuffersPerShaderStage', PATH_TRACING_BASE_STORAGE_BUFFERS, 'BVH, triangles, materials and accumulation'],
    ...compute,
  ]);
  const disney = check(limits, [
    ['maxBindGroups', 2, 'scene and texture groups'],
    ['maxStorageBuffersPerShaderStage', 2, 'accumulation and lights'],
    ['maxTextureArrayLayers', 16, 'material texture arrays'],
    ...compute,
  ]);
  return {
    adapter: {
      vendor: info?.vendor ?? '', architecture: info?.architecture ?? '', device: info?.device ?? '', description: info?.description ?? '',
    },
    features: [...features].sort(),
    limits: Object.fromEntries(REPORTED_LIMITS.map(name => [name, limits[name] ?? 0])),
    backends: { raster, pathtracing, disney },
    gpuTimings: features.has('timestamp-query'),
    maxTextureSize: limits.maxTextureDimension2D ?? 0,
  };
}
