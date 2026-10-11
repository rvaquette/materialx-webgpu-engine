import { describe, it, expect, vi } from 'vitest';
import { StreamingScheduler, type StreamItem } from '../../src/assets/streaming.ts';
import { MetricsCollector } from '../../src/diagnostics/metrics.ts';

// Flush pending microtasks/timers so queued cache loads settle before pump().
const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function item(key: string, priority: number, byteSize: number): StreamItem<string> {
  return { key, priority, byteSize, load: async () => ({ value: key, size: byteSize }) };
}

describe('StreamingScheduler upload throttling (T036)', () => {
  it('uploads highest priority first, bounded by the per-tick byte budget', async () => {
    const uploaded: string[] = [];
    const sched = new StreamingScheduler<string>({
      upload: (_v, it) => uploaded.push(it.key),
      uploadBytesPerTick: 100,
    });
    const pLow = sched.request(item('A', 1, 60));
    const pHigh = sched.request(item('B', 5, 60));
    await flush();
    expect(sched.pendingUploads).toBe(2);

    const r1 = sched.pump();
    expect(r1).toEqual({ uploadedBytes: 60, uploadedCount: 1 });
    expect(uploaded).toEqual(['B']); // priority 5 before priority 1
    await expect(pHigh).resolves.toBe('B');

    const r2 = sched.pump();
    expect(r2).toEqual({ uploadedBytes: 60, uploadedCount: 1 });
    expect(uploaded).toEqual(['B', 'A']);
    await expect(pLow).resolves.toBe('A');
  });

  it('always admits one oversized item so streaming makes progress', async () => {
    const uploaded: string[] = [];
    const sched = new StreamingScheduler<string>({
      upload: (_v, it) => uploaded.push(it.key),
      uploadBytesPerTick: 10,
    });
    const p = sched.request(item('big', 1, 999));
    await flush();
    const r = sched.pump();
    expect(r.uploadedCount).toBe(1);
    expect(uploaded).toEqual(['big']);
    await expect(p).resolves.toBe('big');
  });

  it('caps the number of uploads per tick', async () => {
    const uploaded: string[] = [];
    const sched = new StreamingScheduler<string>({
      upload: (_v, it) => uploaded.push(it.key),
      uploadsPerTick: 2,
    });
    const ps = [item('A', 1, 1), item('B', 1, 1), item('C', 1, 1)].map((i) => sched.request(i));
    await flush();
    expect(sched.pump().uploadedCount).toBe(2);
    expect(sched.pump().uploadedCount).toBe(1);
    await expect(Promise.all(ps)).resolves.toEqual(['A', 'B', 'C']);
  });
});

describe('StreamingScheduler fetch backpressure (T036)', () => {
  it('limits concurrent loads and admits queued work as slots free', async () => {
    const d = [deferred<{ value: string; size: number }>(), deferred<{ value: string; size: number }>(), deferred<{ value: string; size: number }>()];
    const loaders = d.map((x) => vi.fn(() => x.promise));
    const sched = new StreamingScheduler<string>({ upload: () => {}, maxConcurrency: 2 });
    for (let i = 0; i < 3; i++) {
      sched.request({ key: `K${i}`, priority: 1, byteSize: 1, load: loaders[i]! });
    }
    await flush();
    expect(sched.inFlightFetches).toBe(2);
    expect(sched.pendingFetches).toBe(1);
    expect(loaders[2]).not.toHaveBeenCalled();

    d[0]!.resolve({ value: 'K0', size: 1 });
    await flush();
    expect(loaders[2]).toHaveBeenCalledTimes(1);
  });
});

describe('StreamingScheduler dedup and cancellation (T036)', () => {
  it('loads and uploads a shared key once for concurrent requests', async () => {
    const load = vi.fn(async () => ({ value: 'shared', size: 10 }));
    const upload = vi.fn();
    const sched = new StreamingScheduler<string>({ upload });
    const p1 = sched.request({ key: 'tex', priority: 1, byteSize: 10, load });
    const p2 = sched.request({ key: 'tex', priority: 1, byteSize: 10, load });
    await flush();
    expect(sched.pendingUploads).toBe(1); // one shared upload job
    sched.pump();
    await expect(Promise.all([p1, p2])).resolves.toEqual(['shared', 'shared']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('does not re-upload a key already resident', async () => {
    const upload = vi.fn();
    const sched = new StreamingScheduler<string>({ upload });
    const p1 = sched.request(item('tex', 1, 10));
    await flush();
    sched.pump();
    await p1;
    const p2 = sched.request(item('tex', 1, 10));
    await flush();
    expect(sched.pendingUploads).toBe(0);
    await expect(p2).resolves.toBe('tex');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('rejects a queued request when its signal aborts, without uploading it', async () => {
    const uploaded: string[] = [];
    const sched = new StreamingScheduler<string>({ upload: (_v, it) => uploaded.push(it.key) });
    const ctrl = new AbortController();
    const p = sched.request(item('X', 1, 10), { signal: ctrl.signal });
    await flush();
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    sched.pump();
    expect(uploaded).not.toContain('X');
  });
});

describe('StreamingScheduler metrics integration (T036)', () => {
  it('reports uploaded bytes to the metrics collector', async () => {
    const metrics = new MetricsCollector();
    const sched = new StreamingScheduler<string>({ upload: () => {}, metrics });
    metrics.beginFrame();
    const p = sched.request(item('A', 1, 256));
    await flush();
    sched.pump();
    metrics.endFrame();
    await p;
    expect(metrics.snapshot().lastFrame).toEqual({ uploadBytes: 256, uploadCount: 1, drawCalls: 0 });
  });
});
