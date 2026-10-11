// Progressive asset streaming with priority admission, fetch backpressure, and
// per-frame upload throttling (plan section 10, REQ-012). The scheduler separates
// two scarce resources: concurrent CPU-side loads (fetch/decode) and per-frame
// GPU uploads. It composes with AsyncResourceCache for dedup + byte budget, and
// optionally reports to a MetricsCollector. Everything is driven by an explicit
// pump() so it is deterministic under Node tests and frame-paced in the browser.

import { AbortError, defaultDiagnosticSink, throwIfAborted, type DiagnosticSink } from '../core/diagnostics.ts';
import { AsyncResourceCache, type Loader } from './cache.ts';
import type { MetricsCollector } from '../diagnostics/metrics.ts';

export interface StreamItem<V> {
  /** Stable cache key (dedup + byte budget). */
  readonly key: string;
  /** Higher is streamed sooner, for both fetch admission and upload. */
  readonly priority: number;
  /** Bytes charged against the per-frame upload budget and reported to metrics. */
  readonly byteSize: number;
  /** Optional LOD/mip level, carried for diagnostics and progressive refinement. */
  readonly level?: number;
  /** CPU-side load (fetch + decode); its byte size is charged in the cache. */
  readonly load: Loader<V>;
}

export interface StreamOptions {
  signal?: AbortSignal;
}

export interface StreamingSchedulerOptions<V> {
  /** Throttled GPU upload step; invoked at most once per key under the pump budget. */
  upload: (value: V, item: StreamItem<V>) => void;
  /** Existing cache to compose with; otherwise one is built from maxBytes. */
  cache?: AsyncResourceCache<V>;
  /** Byte budget for the built-in cache when `cache` is not supplied. */
  maxBytes?: number;
  /** Max concurrent CPU-side loads. Default 4. */
  maxConcurrency?: number;
  /** Max bytes uploaded per pump(); one oversized item is always admitted. Default Infinity. */
  uploadBytesPerTick?: number;
  /** Max items uploaded per pump(). Default Infinity. */
  uploadsPerTick?: number;
  metrics?: MetricsCollector;
  onDiagnostic?: DiagnosticSink;
}

export interface PumpResult {
  readonly uploadedBytes: number;
  readonly uploadedCount: number;
}

interface Request<V> {
  item: StreamItem<V>;
  signal: AbortSignal | undefined;
  resolve: (value: V) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  onAbort: (() => void) | undefined;
}

// One upload per key, shared by every request that resolved to the same asset.
interface UploadJob<V> {
  item: StreamItem<V>;
  value: V;
  priority: number;
  waiters: Request<V>[];
}

export class StreamingScheduler<V> {
  private readonly cache: AsyncResourceCache<V>;
  private readonly upload: (value: V, item: StreamItem<V>) => void;
  private readonly maxConcurrency: number;
  private readonly uploadBytesPerTick: number;
  private readonly uploadsPerTick: number;
  private readonly metrics: MetricsCollector | undefined;
  private readonly diag: DiagnosticSink;

  private readonly admitQueue: Request<V>[] = [];
  private readonly uploadQueue: UploadJob<V>[] = [];
  private readonly queuedUploads = new Map<string, UploadJob<V>>();
  private readonly uploaded = new Set<string>();
  private fetchActive = 0;

  constructor(options: StreamingSchedulerOptions<V>) {
    this.cache =
      options.cache ?? new AsyncResourceCache<V>({ maxBytes: options.maxBytes ?? Infinity, maxConcurrency: 64 });
    this.upload = options.upload;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
    this.uploadBytesPerTick = options.uploadBytesPerTick ?? Infinity;
    this.uploadsPerTick = options.uploadsPerTick ?? Infinity;
    this.metrics = options.metrics;
    this.diag = options.onDiagnostic ?? defaultDiagnosticSink;
  }

  get pendingFetches(): number {
    return this.admitQueue.length;
  }

  get pendingUploads(): number {
    return this.uploadQueue.length;
  }

  get inFlightFetches(): number {
    return this.fetchActive;
  }

  /** Request a streamed asset. Resolves after its (throttled) upload completes. */
  request(item: StreamItem<V>, options: StreamOptions = {}): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      throwIfAborted(options.signal);
      const req: Request<V> = { item, signal: options.signal, resolve, reject, settled: false, onAbort: undefined };
      if (options.signal) {
        const onAbort = (): void => this.abortRequest(req);
        req.onAbort = onAbort;
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      this.insertRequestByPriority(req);
      this.drainAdmit();
    });
  }

  /** Upload up to the per-tick budget from the completed-fetch queue. Call once per frame. */
  pump(): PumpResult {
    let uploadedBytes = 0;
    let uploadedCount = 0;
    while (this.uploadQueue.length > 0) {
      if (uploadedCount >= this.uploadsPerTick) break;
      const job = this.uploadQueue[0]!;
      // Always admit at least one item so a single oversized asset still makes progress.
      if (uploadedCount > 0 && uploadedBytes + job.item.byteSize > this.uploadBytesPerTick) break;
      this.uploadQueue.shift();
      this.queuedUploads.delete(job.item.key);
      const live = job.waiters.filter((w) => !w.settled);
      if (live.length === 0) continue; // every requester aborted; skip the upload
      this.upload(job.value, job.item);
      this.uploaded.add(job.item.key);
      uploadedBytes += job.item.byteSize;
      uploadedCount += 1;
      this.metrics?.recordUpload(job.item.byteSize, 1);
      for (const w of live) this.settle(w, () => w.resolve(job.value));
    }
    return { uploadedBytes, uploadedCount };
  }

  private drainAdmit(): void {
    while (this.fetchActive < this.maxConcurrency && this.admitQueue.length > 0) {
      const req = this.admitQueue.shift()!;
      if (req.settled) continue;
      this.fetchActive += 1;
      this.cache.get(req.item.key, req.item.load, req.signal ? { signal: req.signal } : {}).then(
        (value) => {
          this.fetchActive -= 1;
          this.onFetched(req, value);
          this.drainAdmit();
        },
        (error) => {
          this.fetchActive -= 1;
          if (!req.settled) {
            if (!(error instanceof AbortError)) {
              this.diag({ level: 'error', message: `Stream load failed: ${req.item.key}`, detail: error });
            }
            this.settle(req, () => req.reject(error));
          }
          this.drainAdmit();
        },
      );
    }
  }

  private onFetched(req: Request<V>, value: V): void {
    if (req.settled) return;
    if (this.uploaded.has(req.item.key)) {
      // Already uploaded for an earlier request: resolve without re-uploading.
      this.settle(req, () => req.resolve(value));
      return;
    }
    const existing = this.queuedUploads.get(req.item.key);
    if (existing) {
      existing.waiters.push(req);
      existing.priority = Math.max(existing.priority, req.item.priority);
      return;
    }
    const job: UploadJob<V> = { item: req.item, value, priority: req.item.priority, waiters: [req] };
    this.queuedUploads.set(req.item.key, job);
    this.insertJobByPriority(job);
  }

  private abortRequest(req: Request<V>): void {
    if (req.settled) return;
    const a = this.admitQueue.indexOf(req);
    if (a >= 0) this.admitQueue.splice(a, 1);
    const job = this.queuedUploads.get(req.item.key);
    if (job) {
      const w = job.waiters.indexOf(req);
      if (w >= 0) job.waiters.splice(w, 1);
    }
    this.settle(req, () => req.reject(new AbortError('Stream request aborted.')));
  }

  // Highest priority first; stable for equal priorities (FIFO).
  private insertRequestByPriority(req: Request<V>): void {
    let i = this.admitQueue.length;
    while (i > 0 && this.admitQueue[i - 1]!.item.priority < req.item.priority) i -= 1;
    this.admitQueue.splice(i, 0, req);
  }

  private insertJobByPriority(job: UploadJob<V>): void {
    let i = this.uploadQueue.length;
    while (i > 0 && this.uploadQueue[i - 1]!.priority < job.priority) i -= 1;
    this.uploadQueue.splice(i, 0, job);
  }

  private settle(req: Request<V>, action: () => void): void {
    req.settled = true;
    if (req.signal && req.onAbort) req.signal.removeEventListener('abort', req.onAbort);
    action();
  }
}
