// Async resource cache with a byte budget, LRU eviction, concurrent-load
// deduplication, backpressure (max in-flight loads), and ref-counted
// cancellation. A single logical asset is loaded once even if many callers
// request it concurrently; a caller's AbortSignal only cancels the underlying
// load when it is the last interested caller (plan section 10).

import { AbortError, defaultDiagnosticSink, throwIfAborted, type DiagnosticSink } from '../core/diagnostics.ts';

export interface LoadResult<V> {
  value: V;
  /** Byte size charged against the cache budget. */
  size: number;
}

export type Loader<V> = (signal: AbortSignal) => Promise<LoadResult<V>>;

export interface GetOptions {
  signal?: AbortSignal;
}

export interface AsyncResourceCacheOptions<V> {
  /** Maximum total bytes of completed entries before eviction. */
  maxBytes: number;
  /** Maximum concurrent in-flight loads (backpressure). Default 4. */
  maxConcurrency?: number;
  /** Called when an entry is evicted or deleted, to release the value. */
  dispose?: (value: V) => void;
  onDiagnostic?: DiagnosticSink;
}

interface Entry<V> {
  value: V;
  size: number;
}

interface Pending<V> {
  promise: Promise<V>;
  controller: AbortController;
  refs: number;
}

export class AsyncResourceCache<V> {
  private readonly maxBytes: number;
  private readonly maxConcurrency: number;
  private readonly dispose: ((value: V) => void) | undefined;
  private readonly diag: DiagnosticSink;

  // Insertion order is the LRU order (oldest first).
  private readonly entries = new Map<string, Entry<V>>();
  private readonly pending = new Map<string, Pending<V>>();
  private bytes = 0;

  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: AsyncResourceCacheOptions<V>) {
    this.maxBytes = options.maxBytes;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
    this.dispose = options.dispose;
    this.diag = options.onDiagnostic ?? defaultDiagnosticSink;
  }

  get byteSize(): number {
    return this.bytes;
  }

  get count(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Get a cached value or load it. Deduplicates concurrent loads of the same key. */
  async get(key: string, loader: Loader<V>, options: GetOptions = {}): Promise<V> {
    throwIfAborted(options.signal);

    const cached = this.entries.get(key);
    if (cached) {
      this.touch(key, cached);
      return cached.value;
    }

    let pending = this.pending.get(key);
    if (!pending) {
      const controller = new AbortController();
      const entry: Pending<V> = { promise: undefined as unknown as Promise<V>, controller, refs: 0 };
      entry.promise = this.runLoad(key, loader, controller);
      this.pending.set(key, entry);
      pending = entry;
    }
    pending.refs += 1;

    return this.attach(key, pending, options.signal);
  }

  /** Remove and dispose a single entry. */
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.size;
    this.dispose?.(entry.value);
  }

  /** Remove and dispose all completed entries. In-flight loads are left to settle. */
  clear(): void {
    for (const [, entry] of this.entries) this.dispose?.(entry.value);
    this.entries.clear();
    this.bytes = 0;
  }

  private attach(key: string, pending: Pending<V>, signal: AbortSignal | undefined): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const releaseRef = (): void => {
        pending.refs -= 1;
        // If no caller still wants this in-flight load, cancel the underlying work.
        if (pending.refs <= 0 && this.pending.get(key) === pending) {
          pending.controller.abort();
        }
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        releaseRef();
        reject(new AbortError('Asset load aborted.'));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pending.promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          pending.refs -= 1;
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          pending.refs -= 1;
          reject(error);
        },
      );
    });
  }

  private async runLoad(key: string, loader: Loader<V>, controller: AbortController): Promise<V> {
    await this.acquireSlot();
    try {
      const { value, size } = await loader(controller.signal);
      if (controller.signal.aborted) {
        this.dispose?.(value);
        throw new AbortError('Asset load aborted.');
      }
      this.pending.delete(key);
      this.insert(key, value, size);
      return value;
    } catch (error) {
      this.pending.delete(key);
      throw error;
    } finally {
      this.releaseSlot();
    }
  }

  private insert(key: string, value: V, size: number): void {
    this.entries.set(key, { value, size });
    this.bytes += size;
    this.evictToBudget(key);
  }

  private touch(key: string, entry: Entry<V>): void {
    // Re-insert to move to the most-recently-used position.
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evictToBudget(protectedKey: string): void {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      if (key === protectedKey) continue;
      this.entries.delete(key);
      this.bytes -= entry.size;
      this.dispose?.(entry.value);
    }
    if (this.bytes > this.maxBytes) {
      this.diag({
        level: 'warning',
        message: `Asset exceeds cache budget and is retained alone: ${protectedKey} (${this.bytes} > ${this.maxBytes} bytes).`,
      });
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
