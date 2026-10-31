// GPU device lifecycle: adapter/device acquisition, limit/feature negotiation,
// device-loss detection and recreation, and deterministic teardown.
//
// Resources (pipelines, buffers, textures) are owned by a specific GPUDevice and
// must not outlive it. Every (re)creation bumps `generation`; downstream caches
// (T015) tag resources with the generation they were built on and discard any
// resource whose generation is stale after a device loss.

import {
  defaultDiagnosticSink,
  throwIfAborted,
  type DiagnosticSink,
} from '../core/diagnostics.ts';

export type { Diagnostic, DiagnosticLevel, DiagnosticSink } from '../core/diagnostics.ts';

export interface GpuContextOptions {
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: readonly GPUFeatureName[];
  requiredLimits?: Readonly<Record<string, number>>;
  label?: string;
  /** Recreate the device automatically after an unexpected loss. Default true. */
  autoRecover?: boolean;
  signal?: AbortSignal;
  onDiagnostic?: DiagnosticSink;
}

export interface DeviceLostDetail {
  reason: GPUDeviceLostReason;
  message: string;
}

export type Unsubscribe = () => void;

/** Large imported scenes need more than WebGPU's default 128 MiB storage binding limit. */
export function sceneDeviceDescriptor(adapter: GPUAdapter): GPUDeviceDescriptor {
  return {
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
    },
  };
}

export function assertSceneStorageSize(device: GPUDevice, bytes: number): void {
  const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
  if (bytes > limit) {
    throw new Error(`Scene storage buffer requires ${bytes} bytes, exceeding the GPU device limit of ${limit} bytes.`);
  }
}

/** Managed GPU device with loss/recovery and generation tracking. */
export interface GpuContext {
  readonly device: GPUDevice;
  readonly adapter: GPUAdapter;
  readonly features: ReadonlySet<GPUFeatureName>;
  readonly limits: GPUSupportedLimits;
  /** Increments on every device (re)creation. Resources from an older generation are invalid. */
  readonly generation: number;
  readonly destroyed: boolean;
  /** Called when the current device is lost. */
  onLost(callback: (detail: DeviceLostDetail) => void): Unsubscribe;
  /** Called after a lost device has been successfully recreated. */
  onRestored(callback: () => void): Unsubscribe;
  /** Intentionally destroy the device. Suppresses auto-recovery. */
  destroy(): void;
}

/**
 * Filter requested features to those the adapter supports, reporting any that
 * are dropped. Never silently discards a request (REQ-013).
 */
export function filterSupportedFeatures(
  adapter: GPUAdapter,
  requested: readonly GPUFeatureName[] | undefined,
  diag: DiagnosticSink,
): GPUFeatureName[] {
  const supported: GPUFeatureName[] = [];
  for (const feature of requested ?? []) {
    if (adapter.features.has(feature)) {
      supported.push(feature);
    } else {
      diag({ level: 'warning', message: `Requested GPU feature unavailable on this adapter: ${feature}` });
    }
  }
  return supported;
}

/**
 * Clamp requested limits to the adapter maximums, reporting unknown keys and any
 * request that exceeds device capability (REQ: respect device limits).
 */
export function resolveRequiredLimits(
  adapter: GPUAdapter,
  requested: Readonly<Record<string, number>> | undefined,
  diag: DiagnosticSink,
): Record<string, number> {
  const resolved: Record<string, number> = {};
  if (!requested) return resolved;
  const adapterLimits = adapter.limits as unknown as Record<string, number | undefined>;
  for (const [key, value] of Object.entries(requested)) {
    const max = adapterLimits[key];
    if (typeof max !== 'number') {
      diag({ level: 'warning', message: `Unknown GPU limit requested and ignored: ${key}` });
      continue;
    }
    if (value > max) {
      diag({
        level: 'warning',
        message: `Requested GPU limit ${key}=${value} exceeds adapter maximum ${max}; clamping.`,
      });
      resolved[key] = max;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

async function acquireDevice(
  options: GpuContextOptions,
  diag: DiagnosticSink,
): Promise<{ adapter: GPUAdapter; device: GPUDevice }> {
  throwIfAborted(options.signal);
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    throw new Error('WebGPU is not available in this environment (navigator.gpu missing).');
  }

  const adapterOptions: GPURequestAdapterOptions = {};
  if (options.powerPreference) adapterOptions.powerPreference = options.powerPreference;
  const adapter = await navigator.gpu.requestAdapter(adapterOptions);
  throwIfAborted(options.signal);
  if (!adapter) {
    throw new Error('No WebGPU adapter is available for the requested configuration.');
  }

  const descriptor: GPUDeviceDescriptor = {
    requiredFeatures: filterSupportedFeatures(adapter, options.requiredFeatures, diag),
    requiredLimits: resolveRequiredLimits(adapter, options.requiredLimits, diag),
  };
  if (options.label) descriptor.label = options.label;

  const device = await adapter.requestDevice(descriptor);
  throwIfAborted(options.signal);
  return { adapter, device };
}

class GpuContextImpl implements GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  generation = 0;
  destroyed = false;

  private readonly options: GpuContextOptions;
  private readonly diag: DiagnosticSink;
  private readonly lostListeners = new Set<(detail: DeviceLostDetail) => void>();
  private readonly restoredListeners = new Set<() => void>();
  private recovering = false;

  constructor(adapter: GPUAdapter, device: GPUDevice, options: GpuContextOptions, diag: DiagnosticSink) {
    this.adapter = adapter;
    this.device = device;
    this.options = options;
    this.diag = diag;
    this.attach();
  }

  get features(): ReadonlySet<GPUFeatureName> {
    return this.device.features as ReadonlySet<GPUFeatureName>;
  }

  get limits(): GPUSupportedLimits {
    return this.device.limits;
  }

  onLost(callback: (detail: DeviceLostDetail) => void): Unsubscribe {
    this.lostListeners.add(callback);
    return () => this.lostListeners.delete(callback);
  }

  onRestored(callback: () => void): Unsubscribe {
    this.restoredListeners.add(callback);
    return () => this.restoredListeners.delete(callback);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.device.destroy();
  }

  private attach(): void {
    this.device.addEventListener('uncapturederror', (event) => {
      const error = (event as GPUUncapturedErrorEvent).error;
      this.diag({ level: 'error', message: `Uncaptured GPU error: ${error.message}`, detail: error });
    });
    void this.device.lost.then((info) => this.handleLost(info));
  }

  private handleLost(info: GPUDeviceLostInfo): void {
    const detail: DeviceLostDetail = { reason: info.reason, message: info.message };
    // 'destroyed' is our own intentional teardown; do not treat as a failure.
    if (this.destroyed || info.reason === 'destroyed') {
      return;
    }
    this.diag({ level: 'warning', message: `GPU device lost: ${info.message || info.reason}`, detail });
    for (const cb of this.lostListeners) cb(detail);
    if (this.options.autoRecover !== false) {
      void this.recover();
    }
  }

  private async recover(): Promise<void> {
    if (this.recovering || this.destroyed) return;
    this.recovering = true;
    try {
      const { adapter, device } = await acquireDevice(this.options, this.diag);
      this.adapter = adapter;
      this.device = device;
      this.generation += 1;
      this.attach();
      for (const cb of this.restoredListeners) cb();
      this.diag({ level: 'info', message: `GPU device recreated (generation ${this.generation}).` });
    } catch (error) {
      this.diag({ level: 'error', message: 'GPU device recreation failed.', detail: error });
    } finally {
      this.recovering = false;
    }
  }
}

/** Acquire a managed GPU context. Throws a diagnostic Error if WebGPU is unavailable. */
export async function createGpuContext(options: GpuContextOptions = {}): Promise<GpuContext> {
  const diag: DiagnosticSink = options.onDiagnostic ?? defaultDiagnosticSink;
  const { adapter, device } = await acquireDevice(options, diag);
  return new GpuContextImpl(adapter, device, options, diag);
}
