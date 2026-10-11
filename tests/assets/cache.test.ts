import { describe, it, expect, vi } from 'vitest';
import { AsyncResourceCache } from '../../src/assets/cache.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AsyncResourceCache', () => {
  it('deduplicates concurrent loads of the same key', async () => {
    const cache = new AsyncResourceCache<number>({ maxBytes: 1000 });
    const loader = vi.fn(async () => ({ value: 42, size: 10 }));
    const [a, b] = await Promise.all([
      cache.get('k', loader),
      cache.get('k', loader),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.count).toBe(1);
    expect(cache.byteSize).toBe(10);
  });

  it('serves cached values without reloading', async () => {
    const cache = new AsyncResourceCache<string>({ maxBytes: 1000 });
    const loader = vi.fn(async () => ({ value: 'v', size: 5 }));
    await cache.get('k', loader);
    const again = await cache.get('k', loader);
    expect(again).toBe('v');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('evicts least-recently-used entries over the byte budget', async () => {
    const dispose = vi.fn();
    const cache = new AsyncResourceCache<string>({ maxBytes: 100, dispose });
    await cache.get('A', async () => ({ value: 'A', size: 40 }));
    await cache.get('B', async () => ({ value: 'B', size: 40 }));
    // Touch A so B becomes the LRU victim.
    await cache.get('A', async () => ({ value: 'A', size: 40 }));
    await cache.get('C', async () => ({ value: 'C', size: 40 }));
    expect(cache.has('B')).toBe(false);
    expect(cache.has('A')).toBe(true);
    expect(cache.has('C')).toBe(true);
    expect(dispose).toHaveBeenCalledWith('B');
  });

  it('keeps the shared load alive while any caller is interested', async () => {
    const cache = new AsyncResourceCache<number>({ maxBytes: 1000 });
    const d = deferred<{ value: number; size: number }>();
    const loader = vi.fn(() => d.promise);

    const c1 = new AbortController();
    const p1 = cache.get('k', loader, { signal: c1.signal });
    const p2 = cache.get('k', loader);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });

    d.resolve({ value: 7, size: 1 });
    await expect(p2).resolves.toBe(7);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('cancels the underlying load when the last caller aborts', async () => {
    const cache = new AsyncResourceCache<number>({ maxBytes: 1000 });
    let loaderSignal: AbortSignal | undefined;
    const loader = vi.fn((signal: AbortSignal) => {
      loaderSignal = signal;
      return new Promise<{ value: number; size: number }>(() => {
        /* never settles on its own */
      });
    });

    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = cache.get('k', loader, { signal: c1.signal });
    const p2 = cache.get('k', loader, { signal: c2.signal });

    c1.abort();
    c2.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
    expect(loaderSignal?.aborted).toBe(true);
  });

  it('limits concurrency with backpressure', async () => {
    const cache = new AsyncResourceCache<number>({ maxBytes: 1000, maxConcurrency: 1 });
    const d1 = deferred<{ value: number; size: number }>();
    const d2 = deferred<{ value: number; size: number }>();
    const l1 = vi.fn(() => d1.promise);
    const l2 = vi.fn(() => d2.promise);

    const p1 = cache.get('a', l1);
    const p2 = cache.get('b', l2);

    await Promise.resolve();
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(0);

    d1.resolve({ value: 1, size: 1 });
    await p1;
    await Promise.resolve();
    expect(l2).toHaveBeenCalledTimes(1);

    d2.resolve({ value: 2, size: 1 });
    await expect(p2).resolves.toBe(2);
  });
});
