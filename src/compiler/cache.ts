// Compiler-side caches, canonical pipeline keys and persistent artifact storage
// (plan section 7.5, T015). Separate caches exist for graphs, IR, WGSL modules,
// layouts and bind-group layouts; concurrent compilations are deduplicated; and
// IR/WGSL/metadata are persisted in IndexedDB (with an in-memory store for
// Node/SSR). The pipeline key captures everything that changes the shader or
// layout and deliberately excludes ordinary editable values and interchangeable
// texture identities, so editing a color or radius never invalidates it.

export class CacheError extends Error {
  override readonly name = 'CacheError';
}

// --- Canonical serialization -------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** FNV-1a 32-bit hash, hex-encoded; a compact id for a canonical string. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type ScalarValue = string | number | boolean;

export interface PipelineKeyParts {
  /** Canonical hash of the specialized IR/WGSL variant. */
  shaderHash: string;
  specializations?: Record<string, ScalarValue>;
  compilerVersion: string;
  libraryVersions?: Record<string, string>;
  backend: string;
  pass: string;
  layouts: readonly string[];
  vertexAttributes: readonly string[];
  colorFormats: readonly string[];
  depthFormat?: string;
  sampleCount: number;
  renderStates?: Record<string, ScalarValue>;
  gpuCapabilities?: Record<string, ScalarValue>;
}

/** Deterministic, collision-free canonical key string for a pipeline variant. */
export function computePipelineKey(parts: PipelineKeyParts): string {
  return stableStringify(parts);
}

// --- In-memory caches with concurrent-compile dedup --------------------------

export class KeyedCache<V> {
  private readonly values = new Map<string, V>();

  get(key: string): V | undefined {
    return this.values.get(key);
  }
  has(key: string): boolean {
    return this.values.has(key);
  }
  set(key: string, value: V): void {
    this.values.set(key, value);
  }
  getOrCreate(key: string, factory: () => V): V {
    const existing = this.values.get(key);
    if (existing !== undefined) return existing;
    const created = factory();
    this.values.set(key, created);
    return created;
  }
  delete(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
  get size(): number {
    return this.values.size;
  }
}

export class AsyncKeyedCache<V> {
  private readonly values = new Map<string, V>();
  private readonly inflight = new Map<string, Promise<V>>();

  get(key: string): V | undefined {
    return this.values.get(key);
  }
  has(key: string): boolean {
    return this.values.has(key);
  }
  set(key: string, value: V): void {
    this.values.set(key, value);
  }

  /** Returns the cached value, or runs factory once even under concurrent calls. */
  async getOrCreate(key: string, factory: () => Promise<V>): Promise<V> {
    const existing = this.values.get(key);
    if (existing !== undefined) return existing;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = (async () => {
      try {
        const value = await factory();
        this.values.set(key, value);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
    this.inflight.clear();
  }
  get size(): number {
    return this.values.size;
  }
}

/** The separate compiler caches of plan section 7.5, typed to the domain objects. */
export class CompilerCaches<Graph, Ir, Wgsl, Layout, BindGroupLayout> {
  readonly graphs = new AsyncKeyedCache<Graph>();
  readonly ir = new AsyncKeyedCache<Ir>();
  readonly wgsl = new AsyncKeyedCache<Wgsl>();
  readonly layouts = new KeyedCache<Layout>();
  readonly bindGroupLayouts = new KeyedCache<BindGroupLayout>();

  clear(): void {
    this.graphs.clear();
    this.ir.clear();
    this.wgsl.clear();
    this.layouts.clear();
    this.bindGroupLayouts.clear();
  }
}

// --- Persistent key-value store ----------------------------------------------

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

function clone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <U>(v: U) => U }).structuredClone;
  return sc ? sc(value) : (JSON.parse(JSON.stringify(value)) as T);
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.map.has(key) ? clone(this.map.get(key)) : undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, clone(value));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

// IndexedDB is typed structurally to avoid requiring the DOM lib in this project.
interface IdbRequestLike<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}
interface IdbOpenRequestLike extends IdbRequestLike<IdbDatabaseLike> {
  onupgradeneeded: (() => void) | null;
}
interface IdbObjectStoreLike {
  get(key: string): IdbRequestLike<unknown>;
  put(value: unknown, key: string): IdbRequestLike<unknown>;
  delete(key: string): IdbRequestLike<unknown>;
  clear(): IdbRequestLike<unknown>;
  getAllKeys(): IdbRequestLike<unknown[]>;
}
interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike;
}
interface IdbDatabaseLike {
  transaction(store: string, mode: string): IdbTransactionLike;
  createObjectStore(name: string): IdbObjectStoreLike;
  objectStoreNames: { contains(name: string): boolean };
}
interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenRequestLike;
}

function requestToPromise<T>(req: IdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new CacheError('IndexedDB request failed'));
  });
}

class IndexedDbStore implements KeyValueStore {
  constructor(
    private readonly db: IdbDatabaseLike,
    private readonly storeName: string,
  ) {}

  private store(mode: string): IdbObjectStoreLike {
    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }
  async get(key: string): Promise<unknown> {
    return requestToPromise(this.store('readonly').get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    await requestToPromise(this.store('readwrite').put(value, key));
  }
  async delete(key: string): Promise<void> {
    await requestToPromise(this.store('readwrite').delete(key));
  }
  async keys(): Promise<string[]> {
    const all = await requestToPromise(this.store('readonly').getAllKeys());
    return all.map((k) => String(k));
  }
  async clear(): Promise<void> {
    await requestToPromise(this.store('readwrite').clear());
  }
}

export async function openIndexedDbStore(dbName: string, storeName: string): Promise<KeyValueStore> {
  const idb = (globalThis as { indexedDB?: IdbFactoryLike }).indexedDB;
  if (!idb) throw new CacheError('IndexedDB is not available in this environment');
  const req = idb.open(dbName, 1);
  const db = await new Promise<IdbDatabaseLike>((resolve, reject) => {
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new CacheError('IndexedDB open failed'));
  });
  return new IndexedDbStore(db, storeName);
}

// --- Persisted shader artifacts (IR / WGSL / metadata) -----------------------

export interface PersistedShaderArtifact {
  shaderHash: string;
  compilerVersion: string;
  libraryVersions?: Record<string, string>;
  ir?: unknown;
  wgsl?: string;
  metadata?: unknown;
}

/** Persists compiled IR/WGSL/metadata keyed by shader hash. GPU pipelines are never stored here. */
export class PersistentArtifactStore {
  constructor(private readonly store: KeyValueStore) {}

  private key(shaderHash: string): string {
    return `shader:${shaderHash}`;
  }

  async load(shaderHash: string): Promise<PersistedShaderArtifact | undefined> {
    const value = await this.store.get(this.key(shaderHash));
    return value as PersistedShaderArtifact | undefined;
  }
  async save(artifact: PersistedShaderArtifact): Promise<void> {
    await this.store.set(this.key(artifact.shaderHash), artifact);
  }
  async has(shaderHash: string): Promise<boolean> {
    return (await this.store.get(this.key(shaderHash))) !== undefined;
  }
  async delete(shaderHash: string): Promise<void> {
    await this.store.delete(this.key(shaderHash));
  }
}
