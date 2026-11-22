import { openIndexedDbStore, type KeyValueStore } from '../compiler/cache.ts';
import type { Bvh } from './bvh.ts';
import type { PreparedMesh } from './prepare.ts';

const CACHE_VERSION = 4;
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

/** Bytes hashed per SHA-256 call; each call chains the previous digest. */
export const GEOMETRY_KEY_BLOCK_BYTES = 1 << 20;

/**
 * Typed, length-prefixed binary encoding hashed in bounded blocks. Numbers are hashed
 * as their float64 bits (so -0 and NaN stay distinct from 0), which is orders of
 * magnitude faster than stringifying every coordinate of a large mesh.
 */
class ChainedDigest {
  readonly #block = new Uint8Array(GEOMETRY_KEY_BLOCK_BYTES + 32);
  readonly #view = new DataView(this.#block.buffer);
  readonly #encoder = new TextEncoder();
  #length = 32;

  constructor(private readonly subtle: SubtleCrypto) {}

  async #flush(): Promise<void> {
    const digest = new Uint8Array(await this.subtle.digest('SHA-256', this.#block.subarray(0, this.#length)));
    this.#block.set(digest);
    this.#length = 32;
  }

  async #reserve(bytes: number): Promise<void> {
    if (this.#length + bytes > this.#block.length) await this.#flush();
  }

  async tag(code: string, count = 0): Promise<void> {
    await this.#reserve(5);
    this.#view.setUint8(this.#length, code.charCodeAt(0));
    this.#view.setUint32(this.#length + 1, count, true);
    this.#length += 5;
  }

  async number(value: number): Promise<void> {
    await this.#reserve(8);
    this.#view.setFloat64(this.#length, value, true);
    this.#length += 8;
  }

  async bytes(bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.length;) {
      if (this.#length === this.#block.length) await this.#flush();
      const count = Math.min(bytes.length - offset, this.#block.length - this.#length);
      this.#block.set(bytes.subarray(offset, offset + count), this.#length);
      this.#length += count;
      offset += count;
    }
  }

  async text(value: string): Promise<void> {
    const bytes = this.#encoder.encode(value);
    await this.tag('s', bytes.length);
    await this.bytes(bytes);
  }

  async numbers(values: readonly number[]): Promise<void> {
    await this.tag('F', values.length);
    for (let index = 0; index < values.length;) {
      if (this.#block.length - this.#length < 8) await this.#flush();
      const end = Math.min(values.length, index + Math.floor((this.#block.length - this.#length) / 8));
      for (; index < end; index++, this.#length += 8) this.#view.setFloat64(this.#length, values[index]!, true);
    }
  }

  async value(value: unknown): Promise<void> {
    if (typeof value === 'number') {
      await this.tag('n');
      await this.number(value);
    } else if (typeof value === 'string') {
      await this.text(value);
    } else if (value === null || typeof value !== 'object') {
      await this.tag(value === null ? 'z' : value === true ? 't' : value === false ? 'f' : 'u');
    } else if (ArrayBuffer.isView(value)) {
      await this.text(value.constructor.name);
      await this.tag('b', value.byteLength);
      await this.bytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    } else if (Array.isArray(value)) {
      if (value.every(entry => typeof entry === 'number')) {
        await this.numbers(value as number[]);
      } else {
        await this.tag('[', value.length);
        for (const entry of value) await this.value(entry);
      }
    } else {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      await this.tag('{', entries.length);
      for (const [key, entry] of entries) {
        await this.text(key);
        await this.value(entry);
      }
    }
  }

  async hex(): Promise<string> {
    await this.#flush();
    return Array.from(this.#block.subarray(0, 32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

export async function preparedGeometryCacheKey(
  mesh: unknown,
  options: { computeTangents?: boolean; hasDisplacement?: boolean },
): Promise<string | undefined> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) return undefined;
  const digest = new ChainedDigest(cryptoApi);
  await digest.value({ cacheVersion: CACHE_VERSION, mesh, options });
  return digest.hex();
}

export async function pathTraceBvhCacheKey(positions: Float32Array): Promise<string | undefined> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) return undefined;
  const digest = await cryptoApi.digest('SHA-256', positions);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
