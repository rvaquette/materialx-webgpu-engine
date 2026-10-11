// T037: device lifecycle under a controllable WebGPU mock -- cancellation during
// acquisition, intentional release (destroy suppresses recovery), and device
// loss with recreation (generation bump + stale-resource invalidation). Node has
// no real navigator.gpu, so a mock is stubbed in and driven deterministically.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGpuContext, type Diagnostic } from '../../src/gpu/device.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

function collector() {
  const diagnostics: Diagnostic[] = [];
  return { diagnostics, sink: (d: Diagnostic) => diagnostics.push(d) };
}

interface MockDevice {
  features: Set<GPUFeatureName>;
  limits: Record<string, number>;
  lost: Promise<{ reason: GPUDeviceLostReason; message: string }>;
  destroy: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, cb: (event: unknown) => void) => void;
  lose: (reason: GPUDeviceLostReason, message?: string) => void;
  emitError: (message: string) => void;
}

function makeDevice(): MockDevice {
  let resolveLost!: (info: { reason: GPUDeviceLostReason; message: string }) => void;
  const lost = new Promise<{ reason: GPUDeviceLostReason; message: string }>((res) => {
    resolveLost = res;
  });
  const listeners: Array<{ type: string; cb: (event: unknown) => void }> = [];
  const device: MockDevice = {
    features: new Set<GPUFeatureName>(),
    limits: { maxBufferSize: 1000 },
    lost,
    destroy: vi.fn(() => resolveLost({ reason: 'destroyed', message: '' })),
    addEventListener: (type, cb) => void listeners.push({ type, cb }),
    lose: (reason, message = '') => resolveLost({ reason, message }),
    emitError: (message) => {
      for (const l of listeners) if (l.type === 'uncapturederror') l.cb({ error: { message } });
    },
  };
  return device;
}

interface GpuHarness {
  gpu: { requestAdapter: ReturnType<typeof vi.fn> };
  devices: MockDevice[];
  requestAdapterCalls: () => number;
}

interface GpuHarnessOptions {
  /** Per-call adapter outcome; 'ok' yields an adapter, 'null' yields none. Defaults to always 'ok'. */
  adapterResults?: Array<'ok' | 'null'>;
  /** Optional gate the first requestAdapter awaits, to test cancellation mid-flight. */
  adapterGate?: Promise<void>;
}

function installGpu(options: GpuHarnessOptions = {}): GpuHarness {
  const devices: MockDevice[] = [];
  let adapterCalls = 0;
  const adapter = {
    features: new Set<GPUFeatureName>(),
    limits: { maxBufferSize: 1000 },
    requestDevice: vi.fn(async () => {
      const d = makeDevice();
      devices.push(d);
      return d as unknown as GPUDevice;
    }),
  };
  const gpu = {
    requestAdapter: vi.fn(async () => {
      const call = adapterCalls++;
      if (call === 0 && options.adapterGate) await options.adapterGate;
      const mode = options.adapterResults?.[call] ?? 'ok';
      return mode === 'null' ? null : (adapter as unknown as GPUAdapter);
    }),
  };
  vi.stubGlobal('navigator', { gpu });
  return { gpu, devices, requestAdapterCalls: () => adapterCalls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('device acquisition cancellation (T037)', () => {
  it('rejects before touching the GPU when the signal is already aborted', async () => {
    const harness = installGpu();
    const controller = new AbortController();
    controller.abort();
    await expect(createGpuContext({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.gpu.requestAdapter).not.toHaveBeenCalled();
  });

  it('rejects when aborted mid-acquisition and creates no device', async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    const harness = installGpu({ adapterGate: gate });
    const controller = new AbortController();
    const pending = createGpuContext({ signal: controller.signal });
    await flush();
    controller.abort();
    openGate();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.devices).toHaveLength(0);
  });

  it('throws a diagnostic error when no adapter is available', async () => {
    installGpu({ adapterResults: ['null'] });
    await expect(createGpuContext()).rejects.toThrow(/no webgpu adapter/i);
  });
});

describe('intentional device release (T037)', () => {
  it('destroys the device once and suppresses auto-recovery', async () => {
    const { diagnostics, sink } = collector();
    const harness = installGpu();
    const ctx = await createGpuContext({ onDiagnostic: sink });
    const lost = vi.fn();
    const restored = vi.fn();
    ctx.onLost(lost);
    ctx.onRestored(restored);

    ctx.destroy();
    ctx.destroy(); // idempotent
    await flush();

    expect(ctx.destroyed).toBe(true);
    expect(harness.devices[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(harness.devices).toHaveLength(1); // no recreation
    expect(ctx.generation).toBe(0);
    expect(lost).not.toHaveBeenCalled();
    expect(restored).not.toHaveBeenCalled();
    expect(diagnostics.some((d) => d.level === 'warning')).toBe(false);
  });

  it('reports uncaptured GPU errors through the diagnostic sink', async () => {
    const { diagnostics, sink } = collector();
    const harness = installGpu();
    await createGpuContext({ onDiagnostic: sink });
    harness.devices[0]!.emitError('bind group out of range');
    const err = diagnostics.find((d) => d.level === 'error');
    expect(err?.message).toContain('bind group out of range');
  });
});

describe('device loss and recreation (T037)', () => {
  it('recreates the device, bumps the generation, and notifies listeners', async () => {
    const { diagnostics, sink } = collector();
    const harness = installGpu();
    const ctx = await createGpuContext({ onDiagnostic: sink });
    const lost = vi.fn();
    const restored = vi.fn();
    ctx.onLost(lost);
    ctx.onRestored(restored);

    harness.devices[0]!.lose('unknown', 'TDR');
    await flush();

    expect(lost).toHaveBeenCalledWith({ reason: 'unknown', message: 'TDR' });
    expect(restored).toHaveBeenCalledTimes(1);
    expect(ctx.generation).toBe(1);
    expect(harness.devices).toHaveLength(2);
    expect(ctx.device).toBe(harness.devices[1] as unknown as GPUDevice);
    expect(diagnostics.some((d) => d.level === 'warning' && /device lost/i.test(d.message))).toBe(true);
  });

  it('invalidates resources tagged with a stale generation after recovery', async () => {
    const harness = installGpu();
    const ctx = await createGpuContext();
    // Downstream caches tag resources with the generation they were built on.
    const builtOn = new Map<string, number>();
    const build = (name: string): void => void builtOn.set(name, ctx.generation);
    const isValid = (name: string): boolean => builtOn.get(name) === ctx.generation;

    build('pipeline');
    expect(isValid('pipeline')).toBe(true);

    harness.devices[0]!.lose('unknown');
    await flush();

    expect(ctx.generation).toBe(1);
    expect(isValid('pipeline')).toBe(false); // stale resource must be discarded
  });

  it('does not recreate the device when autoRecover is disabled', async () => {
    const harness = installGpu();
    const ctx = await createGpuContext({ autoRecover: false });
    const restored = vi.fn();
    ctx.onRestored(restored);

    harness.devices[0]!.lose('unknown');
    await flush();

    expect(ctx.generation).toBe(0);
    expect(harness.devices).toHaveLength(1);
    expect(restored).not.toHaveBeenCalled();
  });

  it('reports a diagnostic error when recreation fails', async () => {
    const { diagnostics, sink } = collector();
    const harness = installGpu({ adapterResults: ['ok', 'null'] });
    const ctx = await createGpuContext({ onDiagnostic: sink });

    harness.devices[0]!.lose('unknown');
    await flush();

    expect(ctx.generation).toBe(0); // recovery failed; no new generation
    expect(diagnostics.some((d) => d.level === 'error' && /recreation failed/i.test(d.message))).toBe(true);
  });
});
