// GPU pipeline cache (plan section 7.5, T015). GPUPipeline objects are device-
// specific and kept only in memory: they are keyed by the canonical pipeline key
// from cache.ts, deduplicated across concurrent builds, and discarded on device
// loss (a generation counter invalidates in-flight builds). Instances reference
// a shared pipeline by key; editing editable uniforms never changes the key, so
// no recompilation occurs.

import { computePipelineKey, type PipelineKeyParts } from '../compiler/cache.ts';

export class PipelineDeviceLostError extends Error {
  override readonly name = 'PipelineDeviceLostError';
}

export class PipelineCache<P> {
  private generation = 0;
  private readonly pipelines = new Map<string, P>();
  private readonly inflight = new Map<string, Promise<P>>();

  get deviceGeneration(): number {
    return this.generation;
  }
  get size(): number {
    return this.pipelines.size;
  }

  keyFor(parts: PipelineKeyParts): string {
    return computePipelineKey(parts);
  }

  get(key: string): P | undefined {
    return this.pipelines.get(key);
  }
  has(key: string): boolean {
    return this.pipelines.has(key);
  }

  /**
   * Returns the cached pipeline or builds it once, even under concurrent calls.
   * If the device is lost while building, the stale result is discarded and a
   * PipelineDeviceLostError is thrown.
   */
  async getOrCreate(key: string, build: () => Promise<P>): Promise<P> {
    const existing = this.pipelines.get(key);
    if (existing !== undefined) return existing;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const builtForGeneration = this.generation;
    const promise = (async () => {
      try {
        const pipeline = await build();
        if (this.generation !== builtForGeneration) {
          throw new PipelineDeviceLostError('device was lost during pipeline creation');
        }
        this.pipelines.set(key, pipeline);
        return pipeline;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  /** Call after a GPUDevice loss: drops all pipelines and invalidates in-flight builds. */
  invalidateDevice(): void {
    this.generation += 1;
    this.pipelines.clear();
    this.inflight.clear();
  }
}
