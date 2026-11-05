import { init, compress, decompress } from '@bokuweb/zstd-wasm';
import type { BvhNode } from '../geometry/bvh.ts';

export const COMPILED_SCENE_VERSION = '1.0';
export const COMPILED_SCENE_ABI = 1;
const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
let initialized: Promise<void> | undefined;

export interface CompiledResource {
  path: string;
  byteLength: number;
  compressedByteLength: number;
  sha256: string;
}

export interface CompiledSceneManifest {
  format: 'materialx-compiled-scene';
  version: '1.0';
  engineAbi: number;
  compression: 'zstd';
  byteOrder: 'little-endian';
  generatedFrom: string;
  state: string;
  resources: CompiledResource[];
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
  return typeof path === 'string' && /^(buffers|textures|shaders|metadata)\/[a-f0-9]{64}\.(bin|wgsl|json)\.zst$/.test(path);
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
export async function encodeCompiledScene(value: unknown, generatedFrom: string): Promise<CompiledScenePackage> {
  assertLittleEndian();
  await ready();
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
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
    const compressed = compress(bytes, 22);
    files.set(path, compressed);
    resources.push({ path, byteLength: bytes.byteLength, compressedByteLength: compressed.byteLength, sha256 });
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
        entries.push([k, await encode(v, k, depth + 1, k === 'images' || k === 'image' ? 'textures' : directory)]);
      }
      return { $: 'object', entries };
    } finally {
      ancestors.delete(input);
    }
  };
  const encoded = textEncoder.encode(JSON.stringify(await encode(value)));
  if (encoded.byteLength > MAX_STATE_BYTES) throw new Error('Compiled scene metadata exceeds 64 MiB.');
  const state = await store(encoded, 'metadata', 'json');
  return {
    manifest: {
      format: 'materialx-compiled-scene', version: COMPILED_SCENE_VERSION, engineAbi: COMPILED_SCENE_ABI,
      compression: 'zstd', byteOrder: 'little-endian', generatedFrom, state, resources,
    },
    files,
  };
}

export function validateCompiledManifest(value: unknown): asserts value is CompiledSceneManifest {
  if (!isRecord(value) || value.format !== 'materialx-compiled-scene' || value.version !== COMPILED_SCENE_VERSION ||
      value.engineAbi !== COMPILED_SCENE_ABI || value.compression !== 'zstd' || value.byteOrder !== 'little-endian' ||
      typeof value.generatedFrom !== 'string' || !validPath(value.state) || !Array.isArray(value.resources) ||
      value.resources.length > 100000) throw new Error('Unsupported or invalid compiled scene manifest/version/ABI.');
  let total = 0;
  const paths = new Set<string>();
  for (const resource of value.resources) {
    if (!isRecord(resource) || !validPath(resource.path) || paths.has(resource.path) ||
        !size(resource.byteLength, MAX_RESOURCE_BYTES) || !size(resource.compressedByteLength, MAX_RESOURCE_BYTES + 1024 * 1024) ||
        typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256) ||
        !resource.path.includes(`/${resource.sha256}.`)) throw new Error('Invalid compiled scene resource descriptor.');
    paths.add(resource.path);
    total += resource.byteLength;
  }
  if (total > MAX_TOTAL_BYTES || !paths.has(value.state) ||
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
  read: (path: string) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<unknown> {
  assertLittleEndian();
  validateCompiledManifest(manifest);
  await ready();
  const descriptors = new Map(manifest.resources.map(resource => [resource.path, resource]));
  const payloads = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  const load = (path: unknown): Promise<Uint8Array<ArrayBuffer>> => {
    if (typeof path !== 'string' || !descriptors.has(path)) throw new Error('Unknown compiled scene resource.');
    let pending = payloads.get(path);
    if (!pending) {
      pending = (async () => {
        const descriptor = descriptors.get(path)!;
        const compressed = await read(path);
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
