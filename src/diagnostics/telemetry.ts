// Optional local telemetry: loading phases (performance measures), GPU pass
// times, uploads, GPU memory and path-tracing convergence, kept in memory and
// exported on demand. Nothing is sent anywhere.

export interface TelemetryStat {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

export interface TelemetrySnapshot {
  version: 1;
  startedAt: string;
  durationMs: number;
  /** CPU phases from the engine's performance measures (usd:*, viewer:*, pathtracing:*, assets:*). */
  phases: Record<string, TelemetryStat>;
  /** Summed GPU pass time per submitted command buffer, by active backend; absent without timestamp-query. */
  gpu?: Record<string, TelemetryStat>;
  uploads: { buffers: { count: number; bytes: number }; textures: { count: number; bytes: number } };
  memory?: { current: number; peak: number; budget?: number };
  convergence?: { backend: string; samples: number; relativeNoise?: number; sweepsPerSecond?: number; elapsedSeconds?: number };
}

import { interceptMethod } from '../gpu/intercept.ts';

const MEASURE_PREFIXES = ['usd:', 'viewer:', 'pathtracing:', 'assets:', 'engine:'];

function add(stats: Record<string, TelemetryStat>, name: string, milliseconds: number): void {
  const stat = stats[name] ??= { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
  stat.count++;
  stat.totalMs += milliseconds;
  stat.maxMs = Math.max(stat.maxMs, milliseconds);
  stat.lastMs = milliseconds;
}

export class TelemetryRecorder {
  readonly #started = performance.now();
  readonly #startedAt = new Date().toISOString();
  readonly #phases: Record<string, TelemetryStat> = {};
  readonly #gpu: Record<string, TelemetryStat> = {};
  #gpuEnabled = false;
  readonly #uploads = { buffers: { count: 0, bytes: 0 }, textures: { count: 0, bytes: 0 } };
  #memory: TelemetrySnapshot['memory'];
  #convergence: TelemetrySnapshot['convergence'];
  readonly #observer: PerformanceObserver | undefined;
  readonly #restore: Array<() => void> = [];

  constructor() {
    if (typeof PerformanceObserver !== 'undefined') {
      this.#observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (MEASURE_PREFIXES.some(prefix => entry.name.startsWith(prefix))) add(this.#phases, entry.name, entry.duration);
        }
      });
      this.#observer.observe({ type: 'measure' });
    }
  }

  recordGpu(category: string, milliseconds: number): void {
    this.#gpuEnabled = true;
    add(this.#gpu, category, milliseconds);
  }

  recordPhase(name: string, milliseconds: number): void {
    add(this.#phases, name, milliseconds);
  }

  recordMemory(current: number, peak: number, budget?: number): void {
    this.#memory = { current, peak, ...(budget !== undefined ? { budget } : {}) };
  }

  recordConvergence(convergence: NonNullable<TelemetrySnapshot['convergence']>): void {
    this.#convergence = convergence;
  }

  /** Counts bytes written through queue.writeBuffer / writeTexture. */
  watchUploads(queue: GPUQueue): void {
    this.#restore.push(interceptMethod(queue, 'writeBuffer', (call, args) => {
      const [, , data, dataOffset, size] = args as [GPUBuffer, number, BufferSource, number | undefined, number | undefined];
      this.#uploads.buffers.count++;
      const bytes = 'byteLength' in data ? data.byteLength : 0;
      const element = ArrayBuffer.isView(data) && 'BYTES_PER_ELEMENT' in data ? (data as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT : 1;
      this.#uploads.buffers.bytes += size !== undefined ? size * element : bytes - (dataOffset ?? 0) * element;
      return call(...args);
    }));
    this.#restore.push(interceptMethod(queue, 'writeTexture', (call, args) => {
      const [, data, layout] = args as [GPUTexelCopyTextureInfo, BufferSource, GPUTexelCopyBufferLayout];
      this.#uploads.textures.count++;
      this.#uploads.textures.bytes += 'byteLength' in data ? data.byteLength - (layout.offset ?? 0) : 0;
      return call(...args);
    }));
  }

  snapshot(): TelemetrySnapshot {
    const copy = (stats: Record<string, TelemetryStat>) => Object.fromEntries(Object.entries(stats).map(([name, stat]) => [name, { ...stat }]));
    return {
      version: 1,
      startedAt: this.#startedAt,
      durationMs: performance.now() - this.#started,
      phases: copy(this.#phases),
      ...(this.#gpuEnabled ? { gpu: copy(this.#gpu) } : {}),
      uploads: { buffers: { ...this.#uploads.buffers }, textures: { ...this.#uploads.textures } },
      ...(this.#memory ? { memory: { ...this.#memory } } : {}),
      ...(this.#convergence ? { convergence: { ...this.#convergence } } : {}),
    };
  }

  dispose(): void {
    this.#observer?.disconnect();
    for (const restore of this.#restore) restore();
  }
}
