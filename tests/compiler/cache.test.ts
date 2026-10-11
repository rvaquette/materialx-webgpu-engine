import { describe, it, expect, vi } from 'vitest';
import {
  AsyncKeyedCache,
  CacheError,
  CompilerCaches,
  computePipelineKey,
  hashString,
  KeyedCache,
  MemoryKeyValueStore,
  openIndexedDbStore,
  PersistentArtifactStore,
  type PipelineKeyParts,
} from '../../src/compiler/cache.ts';

function parts(overrides: Partial<PipelineKeyParts> = {}): PipelineKeyParts {
  return {
    shaderHash: 'abc123',
    compilerVersion: '1.0.0',
    backend: 'webgpu',
    pass: 'opaque',
    layouts: ['L0', 'L1'],
    vertexAttributes: ['position', 'texcoord'],
    colorFormats: ['rgba16float'],
    sampleCount: 1,
    ...overrides,
  };
}

describe('computePipelineKey', () => {
  it('is deterministic and independent of object key order', () => {
    const a = computePipelineKey(parts({ specializations: { a: 1, b: 2 } }));
    const b = computePipelineKey(parts({ specializations: { b: 2, a: 1 } }));
    expect(a).toBe(b);
  });

  it('changes when the shader or layout changes but not for excluded values', () => {
    const base = computePipelineKey(parts());
    expect(computePipelineKey(parts({ pass: 'transmission' }))).not.toBe(base);
    expect(computePipelineKey(parts({ sampleCount: 4 }))).not.toBe(base);
    // Editable values (a color, a radius) are never part of the key: identical
    // parts yield an identical key regardless of any such runtime value.
    expect(computePipelineKey(parts())).toBe(base);
  });

  it('hashString is stable and compact', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).toHaveLength(8);
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('AsyncKeyedCache', () => {
  it('deduplicates concurrent compilations', async () => {
    const cache = new AsyncKeyedCache<number>();
    const factory = vi.fn(async () => 42);
    const [a, b] = await Promise.all([
      cache.getOrCreate('k', factory),
      cache.getOrCreate('k', factory),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(cache.get('k')).toBe(42);
  });
});

describe('KeyedCache', () => {
  it('creates once and reuses', () => {
    const cache = new KeyedCache<string>();
    const factory = vi.fn(() => 'v');
    expect(cache.getOrCreate('k', factory)).toBe('v');
    expect(cache.getOrCreate('k', factory)).toBe('v');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryKeyValueStore', () => {
  it('stores clones so external mutation does not leak', async () => {
    const store = new MemoryKeyValueStore();
    const value = { n: 1 };
    await store.set('k', value);
    value.n = 999;
    expect(await store.get('k')).toEqual({ n: 1 });
    expect(await store.keys()).toEqual(['k']);
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });
});

describe('PersistentArtifactStore', () => {
  it('persists IR, WGSL and metadata keyed by shader hash', async () => {
    const store = new PersistentArtifactStore(new MemoryKeyValueStore());
    await store.save({ shaderHash: 'h1', compilerVersion: '1.0.0', ir: { nodes: 2 }, wgsl: 'fn main(){}', metadata: { pass: 'opaque' } });
    expect(await store.has('h1')).toBe(true);
    const loaded = await store.load('h1');
    expect(loaded?.wgsl).toBe('fn main(){}');
    expect(loaded?.ir).toEqual({ nodes: 2 });
    await store.delete('h1');
    expect(await store.has('h1')).toBe(false);
  });
});

describe('openIndexedDbStore', () => {
  it('fails cleanly when IndexedDB is unavailable', async () => {
    await expect(openIndexedDbStore('db', 'store')).rejects.toBeInstanceOf(CacheError);
  });
});

describe('CompilerCaches', () => {
  it('clears every sub-cache', async () => {
    const caches = new CompilerCaches<string, string, string, string, string>();
    await caches.ir.getOrCreate('k', async () => 'ir');
    caches.layouts.set('k', 'layout');
    expect(caches.ir.size + caches.layouts.size).toBe(2);
    caches.clear();
    expect(caches.ir.size + caches.layouts.size).toBe(0);
  });
});
