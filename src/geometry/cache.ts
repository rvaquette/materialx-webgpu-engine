import { openIndexedDbStore, type KeyValueStore } from '../compiler/cache.ts';
import type { Bvh } from './bvh.ts';
import type { PreparedMesh } from './prepare.ts';

const CACHE_VERSION = 1;
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

function stableStringify(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '"__NaN__"';
    if (value === Infinity) return '"__Infinity__"';
    if (value === -Infinity) return '"__-Infinity__"';
    if (Object.is(value, -0)) return '"__-0__"';
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export async function preparedGeometryCacheKey(
  mesh: unknown,
  options: { computeTangents?: boolean; hasDisplacement?: boolean },
): Promise<string | undefined> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) return undefined;
  const payload = `{"cacheVersion":${CACHE_VERSION},"mesh":${stableStringify(mesh)},"options":${stableStringify(options)}}`;
  const digest = await cryptoApi.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pathTraceBvhCacheKey(positions: Float32Array): Promise<string | undefined> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) return undefined;
  const digest = await cryptoApi.digest('SHA-256', positions);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
