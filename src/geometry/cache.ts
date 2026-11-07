import { openIndexedDbStore, type KeyValueStore } from '../compiler/cache.ts';
import type { Bvh } from './bvh.ts';
import type { PreparedMesh } from './prepare.ts';

const CACHE_VERSION = 2;
const DATABASE_NAME = 'materialx-webgpu-engine';
const STORE_NAME = 'prepared-geometry';
const CACHE_PREFIX = 'geometry:v1:';
const BVH_CACHE_PREFIX = 'pathtrace-bvh:v2-sah:';

export interface PreparedGeometryCache {
  get(key: string): Promise<PreparedMesh | undefined>;
  set(key: string, mesh: PreparedMesh): Promise<void>;
}

export interface PathTraceBvhCache {
  get(key: string): Promise<Bvh | undefined>;
  set(key: string, bvh: Bvh): Promise<void>;
}

export class PersistentPreparedGeometryCache implements PreparedGeometryCache {
  constructor(private readonly store: KeyValueStore) {}

  async get(key: string): Promise<PreparedMesh | undefined> {
    const value = await this.store.get(`${CACHE_PREFIX}${key}`);
    return value as PreparedMesh | undefined;
  }

  async set(key: string, mesh: PreparedMesh): Promise<void> {
    await this.store.set(`${CACHE_PREFIX}${key}`, mesh);
  }
}

export class PersistentPathTraceBvhCache implements PathTraceBvhCache {
  constructor(private readonly store: KeyValueStore) {}

  async get(key: string): Promise<Bvh | undefined> {
    return await this.store.get(`${BVH_CACHE_PREFIX}${key}`) as Bvh | undefined;
  }

  async set(key: string, bvh: Bvh): Promise<void> {
    await this.store.set(`${BVH_CACHE_PREFIX}${key}`, bvh);
  }
}

let defaultCache: Promise<PreparedGeometryCache> | undefined;
let defaultBvhCache: Promise<PathTraceBvhCache> | undefined;

export function openPreparedGeometryCache(): Promise<PreparedGeometryCache> {
  defaultCache ??= openIndexedDbStore(DATABASE_NAME, STORE_NAME)
    .then((store) => new PersistentPreparedGeometryCache(store))
    .catch((error: unknown) => {
      defaultCache = undefined;
      throw error;
    });
  return defaultCache;
}

export function openPathTraceBvhCache(): Promise<PathTraceBvhCache> {
  defaultBvhCache ??= openIndexedDbStore(DATABASE_NAME, STORE_NAME)
    .then((store) => new PersistentPathTraceBvhCache(store))
    .catch((error: unknown) => {
      defaultBvhCache = undefined;
      throw error;
    });
  return defaultBvhCache;
}

function* stableParts(value: unknown): Generator<string> {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) yield '"__NaN__"';
    else if (value === Infinity) yield '"__Infinity__"';
    else if (value === -Infinity) yield '"__-Infinity__"';
    else if (Object.is(value, -0)) yield '"__-0__"';
    else yield JSON.stringify(value);
    return;
  }
  if (value === null || typeof value !== 'object') {
    yield JSON.stringify(value) ?? 'null';
    return;
  }
  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index++) {
      if (index) yield ',';
      yield* stableParts(value[index]);
    }
    yield ']';
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  yield '{';
  for (let index = 0; index < entries.length; index++) {
    const [key, entry] = entries[index]!;
    if (index) yield ',';
    yield `${JSON.stringify(key)}:`;
    yield* stableParts(entry);
  }
  yield '}';
}

export async function preparedGeometryCacheKey(
  mesh: unknown,
  options: { computeTangents?: boolean; hasDisplacement?: boolean },
): Promise<string | undefined> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) return undefined;
  const chunkSize = 64 * 1024;
  const encoder = new TextEncoder();
  let digest = new Uint8Array(32);
  let pending = '';
  const hashChunk = async (text: string): Promise<void> => {
    const bytes = encoder.encode(text);
    const chained = new Uint8Array(digest.length + bytes.length);
    chained.set(digest);
    chained.set(bytes, digest.length);
    digest = new Uint8Array(await cryptoApi.digest('SHA-256', chained));
  };
  for (const part of stableParts({ cacheVersion: CACHE_VERSION, mesh, options })) {
    pending += part;
    while (pending.length >= chunkSize) {
      let end = chunkSize;
      const last = pending.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      await hashChunk(pending.slice(0, end));
      pending = pending.slice(end);
    }
  }
  if (pending) await hashChunk(pending);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pathTraceBvhCacheKey(positions: Float32Array): Promise<string | undefined> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) return undefined;
  const digest = await cryptoApi.digest('SHA-256', positions);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
