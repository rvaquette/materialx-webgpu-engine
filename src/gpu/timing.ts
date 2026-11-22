// GPU pass timings without touching render code: while enabled, every command
// encoder's passes get timestampWrites (timestamp-query), resolved when the
// encoder finishes and read back after submission. A sample is the summed GPU
// time of one command buffer, attributed to the category current at encoding.

import { interceptMethod } from './intercept.ts';

const MAX_PASSES = 32;

interface PendingTiming {
  resolve: GPUBuffer;
  readback: GPUBuffer;
  passes: number;
  category: string;
}

export class GpuTimingRecorder {
  readonly #device: GPUDevice;
  readonly #restore: Array<() => void> = [];
  readonly #pending = new WeakMap<GPUCommandBuffer, PendingTiming>();
  readonly #querySets: GPUQuerySet[] = [];
  readonly #readbacks: GPUBuffer[] = [];
  #disposed = false;

  constructor(device: GPUDevice, category: () => string, record: (category: string, milliseconds: number) => void) {
    this.#device = device;
    if (!device.features.has('timestamp-query')) throw new Error('timestamp-query is not enabled on this device.');
    this.#restore.push(interceptMethod(device, 'createCommandEncoder', (call, args) => {
      const encoder = call(...args) as GPUCommandEncoder;
      if (!this.#disposed) this.#instrument(encoder, category());
      return encoder;
    }));
    this.#restore.push(interceptMethod(device.queue, 'submit', (call, args) => {
      const list = [...args[0] as Iterable<GPUCommandBuffer>];
      call(list);
      for (const buffer of list) {
        const timing = this.#pending.get(buffer);
        if (!timing) continue;
        timing.resolve.destroy();
        void this.#read(timing, record);
      }
    }));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const restore of this.#restore) restore();
    for (const set of this.#querySets) set.destroy();
    for (const buffer of this.#readbacks) buffer.destroy();
  }

  #instrument(encoder: GPUCommandEncoder, category: string): void {
    const querySet = this.#querySets.pop() ?? this.#device.createQuerySet({ type: 'timestamp', count: MAX_PASSES * 2 });
    let passes = 0;
    const writes = (): { querySet: GPUQuerySet; beginningOfPassWriteIndex: number; endOfPassWriteIndex: number } | undefined => {
      if (passes >= MAX_PASSES) return undefined;
      const index = passes++;
      return { querySet, beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1 };
    };
    interceptMethod(encoder, 'beginRenderPass', (call, [descriptor]) => {
      const pass = descriptor as GPURenderPassDescriptor;
      const timestampWrites = pass.timestampWrites ? undefined : writes();
      return call(timestampWrites ? { ...pass, timestampWrites } : pass);
    });
    interceptMethod(encoder, 'beginComputePass', (call, [descriptor]) => {
      const pass = descriptor as GPUComputePassDescriptor | undefined;
      const timestampWrites = pass?.timestampWrites ? undefined : writes();
      return call(timestampWrites ? { ...pass, timestampWrites } : pass);
    });
    interceptMethod(encoder, 'finish', (finish, [descriptor]) => {
      if (passes === 0) {
        this.#querySets.push(querySet);
        return finish(descriptor);
      }
      const resolve = this.#device.createBuffer({ size: passes * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const readback = this.#readbacks.find(buffer => buffer.size >= passes * 16 && buffer.mapState === 'unmapped')
        ?? this.#device.createBuffer({ size: MAX_PASSES * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const pooled = this.#readbacks.indexOf(readback);
      if (pooled >= 0) this.#readbacks.splice(pooled, 1);
      encoder.resolveQuerySet(querySet, 0, passes * 2, resolve, 0);
      encoder.copyBufferToBuffer(resolve, 0, readback, 0, passes * 16);
      const buffer = finish(descriptor) as GPUCommandBuffer;
      this.#querySets.push(querySet);
      this.#pending.set(buffer, { resolve, readback, passes, category });
      return buffer;
    });
  }

  async #read(timing: PendingTiming, record: (category: string, milliseconds: number) => void): Promise<void> {
    try {
      await timing.readback.mapAsync(GPUMapMode.READ, 0, timing.passes * 16);
      const stamps = new BigUint64Array(timing.readback.getMappedRange(0, timing.passes * 16));
      let total = 0n;
      for (let i = 0; i < timing.passes; i++) if (stamps[i * 2 + 1]! > stamps[i * 2]!) total += stamps[i * 2 + 1]! - stamps[i * 2]!;
      timing.readback.unmap();
      if (this.#disposed) timing.readback.destroy();
      else this.#readbacks.push(timing.readback);
      record(timing.category, Number(total) / 1e6);
    } catch {
      timing.readback.destroy();
    }
  }
}
