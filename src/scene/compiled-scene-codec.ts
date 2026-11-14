import { init, compress, decompress } from '@bokuweb/zstd-wasm';
import type { BvhNode } from '../geometry/bvh.ts';

export const COMPILED_SCENE_VERSION = '2.0';
export const COMPILED_SCENE_ABI = 1;
const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const SHARED_RANGE_GAP = 256 * 1024;
const PACKED_FILES = { buffers: 'buffers.bin.zst', shaders: 'shaders.wgsl.zst', metadata: 'metadata.json.zst' } as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
let initialized: Promise<void> | undefined;

export interface CompiledResource {
  path: string;
  file: string;
  offset: number;
  byteLength: number;
  compressedByteLength: number;
  sha256: string;
}

export interface CompiledSceneManifest {
  format: 'materialx-compiled-scene';
  version: '2.0';
  engineAbi: number;
  compression: 'zstd';
  byteOrder: 'little-endian';
  generatedFrom: string;
  state: string;
  files: CompiledPackedFile[];
  resources: CompiledResource[];
}

/**
 * `location` marks an append-only pack shared by several scenes (relative to the manifest):
 * resources may then be any non-contiguous subset of it, and `byteLength` is its minimum size.
 */
export interface CompiledPackedFile {
  path: string;
  byteLength: number;
  location?: string;
}

export interface ByteRange {
  offset: number;
  length: number;
}

export interface CompiledScenePackage {
  manifest: CompiledSceneManifest;
  files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const arrayTypes = { Float32Array, Float64Array, Uint32Array, Int32Array, Uint16Array, Int16Array, Uint8Array, Int8Array };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertLittleEndian(): void {
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) {
    throw new Error('Compiled scenes require a little-endian host.');
  }
}

async function ready(): Promise<void> {
  initialized ??= init();
  await initialized;
}

async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

function validPath(path: unknown): path is string {
  return typeof path === 'string' && /^(buffers|shaders|metadata)\/[a-f0-9]{64}\.(bin|wgsl|json)\.zst$/.test(path);
}

/** Relative URL of a shared pack, which must keep the packed file's name. */
function validLocation(location: unknown, path: string): location is string {
  return typeof location === 'string' && location.length <= 1024 && !/^[a-z][a-z0-9+.-]*:|^\/|\\|\/\/|[?#]/i.test(location) &&
    location.split('/').at(-1) === path;
}

function size(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function bvhNodes(value: unknown[]): value is BvhNode[] {
  return value.length > 0 && value.every(node => isRecord(node) &&
    Array.isArray(node.min) && node.min.length === 3 && node.min.every(x => typeof x === 'number') &&
    Array.isArray(node.max) && node.max.length === 3 && node.max.every(x => typeof x === 'number') &&
    ['left', 'right', 'start', 'count'].every(field => typeof node[field] === 'number'));
}

/** Separate immutable, content-addressed payloads; the manifest is written last. */
export interface CompiledSceneEncodeOptions {
  compressionLevel?: number;
  onProgress?: (message: string) => void;
}

export async function encodeCompiledScene(
  value: unknown, generatedFrom: string, options: CompiledSceneEncodeOptions = {},
): Promise<CompiledScenePackage> {
  const level = options.compressionLevel ?? 22;
  if (!Number.isInteger(level) || level < 1 || level > 22) throw new Error('Compression level must be an integer between 1 and 22.');
  assertLittleEndian();
  await ready();
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const packed = new Map(Object.values(PACKED_FILES).map(path => [path as string, {
    chunks: [] as Uint8Array<ArrayBuffer>[], byteLength: 0,
  }]));
  const resources: CompiledResource[] = [];
  const byContent = new Map<string, string>();
  const ancestors = new WeakSet<object>();
  let total = 0;
  const store = async (bytes: Uint8Array<ArrayBuffer>, directory: string, extension: string): Promise<string> => {
    if (bytes.byteLength > MAX_RESOURCE_BYTES) throw new Error('Compiled scene resource exceeds 512 MiB.');
    const sha256 = await hash(bytes);
    const previous = byContent.get(sha256);
    if (previous !== undefined) return previous;
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new Error('Compiled scene exceeds 2 GiB uncompressed.');
    const path = `${directory}/${sha256}.${extension}.zst`;
    options.onProgress?.(`Compressing ${path}: ${(bytes.byteLength / 1048576).toFixed(1)} MiB (Zstandard ${level})...`);
    const started = performance.now();
    const compressed = compress(bytes, level);
    options.onProgress?.(`Compressed in ${((performance.now() - started) / 1000).toFixed(1)}s: ${(compressed.byteLength / 1048576).toFixed(1)} MiB.`);
    const file = PACKED_FILES[directory as keyof typeof PACKED_FILES];
    const bundle = packed.get(file)!;
    resources.push({ path, file, offset: bundle.byteLength, byteLength: bytes.byteLength, compressedByteLength: compressed.byteLength, sha256 });
    bundle.chunks.push(compressed);
    bundle.byteLength += compressed.byteLength;
    byContent.set(sha256, path);
    return path;
  };
  const encode = async (input: unknown, key = '', depth = 0, directory = 'buffers'): Promise<Json> => {
    if (depth > 128) throw new Error('Compiled scene metadata is too deeply nested.');
    if (input === undefined) return { $: 'undefined' };
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      return Number.isFinite(input) ? input : { $: 'number', value: String(input) };
    }
    if (typeof input === 'string') {
      if (/^(code|fnCode|dispatcherWgsl|opacityDispatcherWgsl|preludes)$/.test(key)) {
        return { $: 'text', resource: await store(textEncoder.encode(input), 'shaders', 'wgsl') };
      }
      return input;
    }
    if (typeof input !== 'object') throw new Error(`Unsupported compiled scene value: ${key}`);
    if (ArrayBuffer.isView(input)) {
      if (!Object.hasOwn(arrayTypes, input.constructor.name)) throw new Error(`Unsupported buffer: ${input.constructor.name}`);
      const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
      return { $: 'array', type: input.constructor.name, resource: await store(bytes, directory, 'bin') };
    }
    if (ancestors.has(input)) throw new Error('Cyclic compiled scene metadata.');
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        if (key === 'nodes' && bvhNodes(input)) {
          const packed = new Float64Array(input.length * 10);
          input.forEach((node, i) => packed.set([...node.min, ...node.max, node.left, node.right, node.start, node.count], i * 10));
          return { $: 'bvh-nodes', resource: await store(new Uint8Array(packed.buffer), 'buffers', 'bin') };
        }
        if (input.length >= 64 && input.every(item => typeof item === 'number')) {
          const packed = new Float64Array(input);
          return { $: 'numbers', resource: await store(new Uint8Array(packed.buffer), directory, 'bin') };
        }
        const out: Json[] = [];
        for (const item of input) out.push(await encode(item, key, depth + 1, directory));
        return out;
      }
      if (input instanceof Map) {
        const entries: Json[] = [];
        for (const [k, v] of input) entries.push([await encode(k, '', depth + 1), await encode(v, '', depth + 1, directory)]);
        return { $: 'map', entries };
      }
      if (input instanceof Set) {
        const entries: Json[] = [];
        for (const item of input) entries.push(await encode(item, '', depth + 1, directory));
        return { $: 'set', entries };
      }
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
        throw new Error(`Compiled scene metadata must be plain data: ${key}`);
      }
      const entries: Json[] = [];
      for (const [k, v] of Object.entries(input)) {
        entries.push([k, await encode(v, k, depth + 1, directory)]);
      }
      return { $: 'object', entries };
    } finally {
      ancestors.delete(input);
    }
  };
  const encoded = textEncoder.encode(JSON.stringify(await encode(value)));
  if (encoded.byteLength > MAX_STATE_BYTES) throw new Error('Compiled scene metadata exceeds 64 MiB.');
  const state = await store(encoded, 'metadata', 'json');
  for (const [path, bundle] of packed) {
    const bytes = new Uint8Array(bundle.byteLength);
    let offset = 0;
    for (const chunk of bundle.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    files.set(path, bytes);
    bundle.chunks.length = 0;
  }
  return {
    manifest: {
      format: 'materialx-compiled-scene', version: COMPILED_SCENE_VERSION, engineAbi: COMPILED_SCENE_ABI,
      compression: 'zstd', byteOrder: 'little-endian', generatedFrom, state, resources,
      files: [...files].map(([path, bytes]) => ({ path, byteLength: bytes.byteLength })),
    },
    files,
  };
}

export function validateCompiledManifest(value: unknown): asserts value is CompiledSceneManifest {
  if (!isRecord(value) || value.format !== 'materialx-compiled-scene' || value.version !== COMPILED_SCENE_VERSION ||
      value.engineAbi !== COMPILED_SCENE_ABI || value.compression !== 'zstd' || value.byteOrder !== 'little-endian' ||
      typeof value.generatedFrom !== 'string' || !validPath(value.state) || !Array.isArray(value.resources) ||
      value.resources.length > 100000 || !Array.isArray(value.files) || value.files.length !== 3) {
    throw new Error('Unsupported or invalid compiled scene manifest/version/ABI.');
  }
  const files = new Map<string, number>();
  const shared = new Set<string>();
  for (const file of value.files) {
    if (!isRecord(file) || !Object.values(PACKED_FILES).includes(file.path as typeof PACKED_FILES[keyof typeof PACKED_FILES]) ||
        typeof file.path !== 'string' || files.has(file.path) ||
        !size(file.byteLength, file.location === undefined ? MAX_TOTAL_BYTES + MAX_STATE_BYTES : Number.MAX_SAFE_INTEGER) ||
        (file.location !== undefined && !validLocation(file.location, file.path))) {
      throw new Error('Invalid compiled scene packed file.');
    }
    files.set(file.path, file.byteLength);
    if (file.location !== undefined) shared.add(file.path);
  }
  const offsets = new Map([...files.keys()].map(path => [path, 0]));
  let total = 0;
  const paths = new Set<string>();
  for (const resource of value.resources) {
    if (!isRecord(resource) || !validPath(resource.path) || paths.has(resource.path) ||
      typeof resource.file !== 'string' || !files.has(resource.file) ||
      resource.file !== PACKED_FILES[resource.path.split('/')[0] as keyof typeof PACKED_FILES] ||
      !size(resource.offset, files.get(resource.file)!) ||
        (!shared.has(resource.file) && resource.offset !== offsets.get(resource.file)) ||
        !size(resource.byteLength, MAX_RESOURCE_BYTES) || !size(resource.compressedByteLength, MAX_RESOURCE_BYTES + 1024 * 1024) ||
        typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256) ||
        !resource.path.includes(`/${resource.sha256}.`)) throw new Error('Invalid compiled scene resource descriptor.');
      const end = resource.offset + resource.compressedByteLength;
      if (end > files.get(resource.file)!) throw new Error('Compiled scene resource exceeds packed file bounds.');
      offsets.set(resource.file, end);
    paths.add(resource.path);
    total += resource.byteLength;
  }
  if ([...files].some(([path, length]) => !shared.has(path) && offsets.get(path) !== length) ||
      !value.state.startsWith('metadata/') || total > MAX_TOTAL_BYTES || !paths.has(value.state) ||
      value.resources.find(resource => resource.path === value.state).byteLength > MAX_STATE_BYTES) {
    throw new Error('Invalid compiled scene metadata or size limit.');
  }
}

// Check the Zstandard frame's declared output size before the WASM decoder allocates.
function validateFrame(bytes: Uint8Array<ArrayBuffer>, expected: number): void {
  const fail = (): never => { throw new Error('Invalid Zstandard frame size.'); };
  if (bytes.length < 6) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0xfd2fb528) fail();
  const descriptor = bytes[4]!;
  if (descriptor & 0x18) fail();
  const single = (descriptor & 0x20) !== 0;
  const flag = descriptor >>> 6;
  const length = flag === 0 ? (single ? 1 : 0) : 1 << flag;
  const dictFlag = descriptor & 3;
  const offset = 5 + (single ? 0 : 1) + (dictFlag === 0 ? 0 : 1 << (dictFlag - 1));
  if (!length || offset + length > bytes.length) fail();
  let contentSize = 0;
  for (let i = length - 1; i >= 0; i--) contentSize = contentSize * 256 + bytes[offset + i]!;
  if (length === 2) contentSize += 256;
  if (contentSize !== expected) fail();
}

export async function decodeCompiledScene(
  manifest: unknown,
  read: (path: string, range?: ByteRange) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<unknown> {
  assertLittleEndian();
  validateCompiledManifest(manifest);
  await ready();
  const descriptors = new Map(manifest.resources.map(resource => [resource.path, resource]));
  const packed = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  const loadFile = (path: string): Promise<Uint8Array<ArrayBuffer>> => {
    let pending = packed.get(path);
    if (!pending) {
      pending = (async () => {
        const bytes = await read(path);
        if (bytes.byteLength !== manifest.files.find(file => file.path === path)!.byteLength) {
          throw new Error(`Truncated compiled scene packed file: ${path}`);
        }
        return bytes;
      })();
      packed.set(path, pending);
    }
    return pending;
  };
  // Shared packs hold other scenes' payloads too: fetch only the (coalesced) byte ranges used here.
  const sharedRanges = new Map<string, { range: ByteRange; bytes?: Promise<Uint8Array<ArrayBuffer>> }[]>();
  for (const file of manifest.files.filter(file => file.location !== undefined)) {
    const ranges: { range: ByteRange }[] = [];
    const used = manifest.resources.filter(resource => resource.file === file.path).sort((a, b) => a.offset - b.offset);
    for (const resource of used) {
      const last = ranges.at(-1)?.range;
      const end = resource.offset + resource.compressedByteLength;
      if (last && resource.offset <= last.offset + last.length + SHARED_RANGE_GAP) {
        last.length = Math.max(last.length, end - last.offset);
      } else {
        ranges.push({ range: { offset: resource.offset, length: resource.compressedByteLength } });
      }
    }
    sharedRanges.set(file.path, ranges);
  }
  const loadSlice = async (descriptor: CompiledResource): Promise<Uint8Array<ArrayBuffer>> => {
    const ranges = sharedRanges.get(descriptor.file);
    if (!ranges) {
      const file = await loadFile(descriptor.file);
      return file.subarray(descriptor.offset, descriptor.offset + descriptor.compressedByteLength);
    }
    const chunk = ranges.find(({ range }) => descriptor.offset >= range.offset &&
      descriptor.offset + descriptor.compressedByteLength <= range.offset + range.length)!;
    chunk.bytes ??= read(descriptor.file, chunk.range).then(bytes => {
      if (bytes.byteLength !== chunk.range.length) throw new Error(`Truncated compiled scene packed file: ${descriptor.file}`);
      return bytes;
    });
    const start = descriptor.offset - chunk.range.offset;
    return (await chunk.bytes).subarray(start, start + descriptor.compressedByteLength);
  };
  const payloads = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  const load = (path: unknown): Promise<Uint8Array<ArrayBuffer>> => {
    if (typeof path !== 'string' || !descriptors.has(path)) throw new Error('Unknown compiled scene resource.');
    let pending = payloads.get(path);
    if (!pending) {
      pending = (async () => {
        const descriptor = descriptors.get(path)!;
        const compressed = await loadSlice(descriptor);
        if (compressed.byteLength !== descriptor.compressedByteLength) throw new Error(`Truncated compiled scene resource: ${path}`);
        validateFrame(compressed, descriptor.byteLength);
        const bytes = decompress(compressed);
        if (bytes.byteLength !== descriptor.byteLength || await hash(bytes) !== descriptor.sha256) {
          throw new Error(`Compiled scene checksum mismatch: ${path}`);
        }
        return bytes;
      })();
      payloads.set(path, pending);
    }
    return pending;
  };
  const decode = async (input: unknown, depth = 0): Promise<unknown> => {
    if (depth > 128) throw new Error('Compiled scene metadata is too deeply nested.');
    if (input === null || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number') return input;
    if (Array.isArray(input)) {
      const out: unknown[] = [];
      for (const item of input) out.push(await decode(item, depth + 1));
      return out;
    }
    if (!isRecord(input)) throw new Error('Invalid compiled scene value.');
    if (input.$ === 'undefined') return undefined;
    if (input.$ === 'number' && ['Infinity', '-Infinity', 'NaN'].includes(String(input.value))) return Number(input.value);
    if (input.$ === 'text') return textDecoder.decode(await load(input.resource));
    if (input.$ === 'numbers' || input.$ === 'bvh-nodes') {
      const bytes = await load(input.resource);
      const stride = input.$ === 'bvh-nodes' ? 80 : 8;
      if (bytes.byteLength % stride) throw new Error('Misaligned compiled numeric records.');
      const values = new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
      if (input.$ === 'numbers') return Array.from(values);
      const nodes: BvhNode[] = [];
      for (let i = 0; i < values.length; i += 10) nodes.push({
        min: [values[i]!, values[i + 1]!, values[i + 2]!],
        max: [values[i + 3]!, values[i + 4]!, values[i + 5]!],
        left: values[i + 6]!, right: values[i + 7]!, start: values[i + 8]!, count: values[i + 9]!,
      });
      return nodes;
    }
    if (input.$ === 'array') {
      if (typeof input.type !== 'string' || !Object.hasOwn(arrayTypes, input.type)) throw new Error('Invalid compiled array type.');
      const ctor = arrayTypes[input.type as keyof typeof arrayTypes];
      const bytes = await load(input.resource);
      if (bytes.byteLength % ctor.BYTES_PER_ELEMENT) throw new Error('Misaligned compiled array.');
      return new ctor(bytes.slice().buffer);
    }
    if (!Array.isArray(input.entries)) throw new Error('Invalid compiled scene entries.');
    if (input.$ === 'set') {
      const entries: unknown[] = [];
      for (const item of input.entries) entries.push(await decode(item, depth + 1));
      return new Set(entries);
    }
    if (input.$ !== 'map' && input.$ !== 'object') throw new Error('Invalid compiled scene tag.');
    const entries: [unknown, unknown][] = [];
    for (const pair of input.entries) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid compiled scene entry.');
      const key = await decode(pair[0], depth + 1);
      if (input.$ === 'object' && typeof key !== 'string') throw new Error('Invalid compiled scene property.');
      entries.push([key, await decode(pair[1], depth + 1)]);
    }
    return input.$ === 'map' ? new Map(entries) : Object.fromEntries(entries);
  };
  const state: unknown = JSON.parse(textDecoder.decode(await load(manifest.state)));
  const paths = manifest.resources.filter(resource => resource.path !== manifest.state).map(resource => resource.path);
  for (let offset = 0; offset < paths.length; offset += 4) {
    await Promise.all(paths.slice(offset, offset + 4).map(load));
  }
  return decode(state);
}

export interface SceneDirectory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<SceneDirectory>;
  getFileHandle(name: string, options: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  }>;
}

export async function writeCompiledScene(directory: SceneDirectory, scene: CompiledScenePackage): Promise<void> {
  const write = async (path: string, data: Uint8Array<ArrayBuffer>): Promise<void> => {
    const parts = path.split('/');
    let target = directory;
    for (const part of parts.slice(0, -1)) target = await target.getDirectoryHandle(part, { create: true });
    const file = await target.getFileHandle(parts.at(-1)!, { create: true });
    const stream = await file.createWritable();
    try { await stream.write(data); await stream.close(); }
    catch (error) { await stream.abort(); throw error; }
  };
  for (const [path, bytes] of scene.files) await write(path, bytes);
  await write('scene.json', textEncoder.encode(JSON.stringify(scene.manifest, null, 2)));
}
