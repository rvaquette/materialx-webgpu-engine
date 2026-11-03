import { buildSceneFrame } from '../raster/scene-frame.ts';
import type { SceneResources } from '../scene-resources.ts';
import {
  buildPathTraceScene, isLightProxy, PT_NODE_FLOATS, PT_TRIANGLE_FLOATS,
  type BuildPathTraceSceneOptions, type PreparedPathTraceGeometry,
} from './scene-buffers.ts';

// Bump for changes to geometry packing, BVH construction or displacement bounds.
// File: 16-byte LE header, padded JSON descriptors, typed-array bytes, SHA-256 trailer.
export const SCENE_BUFFER_CACHE_VERSION = 3;
export const SCENE_BUFFER_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const MAGIC = 0x4d585054;
const fields = ['nodes', 'triangles', 'triangleOrder', 'triangleUv', 'triangleTangent'] as const;
const encoder = new TextEncoder();
const bytesOf = (array: ArrayBufferView) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
async function digest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = parts.reduce((n, part) => n + part.length, 0);
  if (size > SCENE_BUFFER_CACHE_MAX_BYTES) throw new Error('Scene cache exceeds size limit');
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Hash source bytes before world-space packing. Delimit every stream and draw. */
export async function sceneBufferCacheKey(resources: SceneResources, options: BuildPathTraceSceneOptions = {}): Promise<string> {
  const parts: Uint8Array[] = [];
  const text = (value: unknown) => {
    const bytes = encoder.encode(JSON.stringify(value));
    parts.push(bytesOf(new Uint32Array([bytes.length])), bytes);
  };
  const raw = (array: ArrayBufferView) => {
    text([array.constructor.name, array.byteLength]);
    parts.push(bytesOf(array));
  };
  // Preserve the key and metadata of existing canonical v3 cache files.
  text(['scene-buffer-cache', SCENE_BUFFER_CACHE_VERSION, 'sah', options.displacementScale ?? 1, 'reference']);
  const seen = new Set<string>();
  for (const draw of buildSceneFrame(resources, options).draws) {
    if (isLightProxy(resources, draw.instanceId, options)) continue;
    const geometry = resources.geometries.get(draw.prototypeId);
    if (!geometry?.streams.some(s => s.name === 'position')) continue;
    const materialKey = draw.materialKey ?? '__neutral__';
    text([draw.instanceId, draw.prototypeId, materialKey, Array.from(draw.model),
      resources.materials.get(materialKey)?.displacement?.scale ?? 0,
      resources.materials.get(materialKey)?.displacement?.file !== undefined]);
    if (seen.has(draw.prototypeId)) continue;
    seen.add(draw.prototypeId);
    text([geometry.vertexCount, geometry.triangleCount, geometry.streams.length]);
    raw(geometry.indices);
    for (const stream of geometry.streams) {
      text([stream.name, stream.components]);
      raw(stream.data);
    }
  }
  return hex(await digest(concat(parts)));
}

function integer(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Validate traversal topology and every referenced record before GPU upload. */
export function validatePreparedGeometry(g: PreparedPathTraceGeometry, materialCount: number): void {
  const fail = (): never => { throw new Error('Corrupt scene cache: invalid geometry, indices or bounds'); };
  if (!integer(g.triangleCount, 0, 2 ** 24 - 1) || !integer(g.nodeCount, 0, 2 ** 24 - 1) ||
      g.nodes.length !== g.nodeCount * PT_NODE_FLOATS ||
      g.triangles.length !== g.triangleCount * PT_TRIANGLE_FLOATS ||
      g.triangleOrder.length !== g.triangleCount || g.triangleUv.length !== g.triangleCount * 6 ||
      (g.triangleTangent.length !== 0 && g.triangleTangent.length !== g.triangleCount * 12)) fail();
  for (const field of fields) {
    const array = g[field];
    if (!array) fail();
    if (field === 'triangleOrder' ? !(array instanceof Uint32Array) : !(array instanceof Float32Array)) fail();
    for (const value of array!) if (!Number.isFinite(value)) fail();
  }
  if (!g.bounds || !Array.isArray(g.bounds.min) || !Array.isArray(g.bounds.max) ||
      g.bounds.min.length !== 3 || g.bounds.max.length !== 3) fail();
  // Empty BVHs retain the builder's zero AABB.
  if (g.triangleCount === 0) {
    if (g.nodeCount !== 0) fail();
    for (let axis = 0; axis < 3; axis++) {
      if (g.bounds.min[axis] !== 0 || g.bounds.max[axis] !== 0) fail();
    }
    return;
  }
  if (!g.nodeCount) fail();
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(g.bounds.min[axis]) || !Number.isFinite(g.bounds.max[axis]) ||
        g.bounds.min[axis]! > g.bounds.max[axis]!) fail();
  }
  const orderSeen = new Uint8Array(g.triangleCount);
  for (const index of g.triangleOrder) {
    if (index >= g.triangleCount || orderSeen[index]) fail();
    orderSeen[index] = 1;
  }
  for (let t = 0; t < g.triangleCount; t++) {
    if (!integer(g.triangles[t * PT_TRIANGLE_FLOATS + 18]!, 0, materialCount - 1)) fail();
    for (let p = 0; p < 9; p++) {
      const axis = p % 3, value = g.triangles[t * PT_TRIANGLE_FLOATS + p]!;
      // The builder's soup and bounds use the same Float32 positions.
      if (value < g.bounds.min[axis]! || value > g.bounds.max[axis]!) fail();
    }
  }
  const visited = new Uint8Array(g.nodeCount), covered = new Uint8Array(g.triangleCount);
  const stack = [{ index: 0, depth: 0 }];
  while (stack.length) {
    const { index, depth } = stack.pop()!;
    if (depth >= 64) fail();
    if (visited[index]) fail();
    visited[index] = 1;
    const base = index * PT_NODE_FLOATS;
    const left = g.nodes[base + 3]!, right = g.nodes[base + 7]!;
    const start = g.nodes[base + 8]!, count = g.nodes[base + 9]!;
    if (!integer(start, 0, g.triangleCount) || !integer(count, 0, g.triangleCount - start)) fail();
    for (let axis = 0; axis < 3; axis++) {
      if (g.nodes[base + axis]! > g.nodes[base + 4 + axis]!) fail();
    }
    if (count) {
      if (left !== -1 || right !== -1) fail();
      for (let i = start; i < start + count; i++) {
        if (covered[i]) fail();
        covered[i] = 1;
        const tri = g.triangleOrder[i]! * PT_TRIANGLE_FLOATS;
        for (let p = 0; p < 9; p++) {
          const axis = p % 3, value = g.triangles[tri + p]!;
          if (value < g.nodes[base + axis]! || value > g.nodes[base + 4 + axis]!) fail();
        }
      }
    } else {
      if (!integer(left, 0, g.nodeCount - 1) || !integer(right, 0, g.nodeCount - 1) || left === right) fail();
      for (const child of [left, right]) {
        for (let axis = 0; axis < 3; axis++) {
          if (g.nodes[child * PT_NODE_FLOATS + axis]! < g.nodes[base + axis]! ||
              g.nodes[child * PT_NODE_FLOATS + 4 + axis]! > g.nodes[base + 4 + axis]!) fail();
        }
        stack.push({ index: child, depth: depth + 1 });
      }
    }
  }
  if (visited.some(v => !v) || covered.some(v => !v)) fail();
}

export async function encodeSceneBufferCache(g: PreparedPathTraceGeometry, key: string, materialCount: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cache key');
  validatePreparedGeometry(g, materialCount);
  const metadata = encoder.encode(JSON.stringify({
    key, materialCount, nodeCount: g.nodeCount, triangleCount: g.triangleCount,
    triangleLayout: 'reference',
    bounds: g.bounds,
    arrays: fields.map(name => ({ name, type: name === 'triangleOrder' ? 'u32' : 'f32', length: g[name]!.length })),
  }));
  const headerLength = (16 + metadata.length + 3) & ~3;
  const header = new Uint8Array(headerLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, SCENE_BUFFER_CACHE_VERSION, true);
  view.setUint32(8, metadata.length, true);
  view.setUint32(12, headerLength, true);
  header.set(metadata, 16);
  const body = concat([header, ...fields.map(name => bytesOf(g[name]!))]);
  return concat([body, await digest(body)]);
}

export async function decodeSceneBufferCache(
  bytes: Uint8Array, expectedKey: string,
): Promise<PreparedPathTraceGeometry> {
  if (bytes.length < 48 || bytes.length > SCENE_BUFFER_CACHE_MAX_BYTES) throw new Error('Corrupt scene cache: size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Corrupt scene cache: magic');
  if (view.getUint32(4, true) !== SCENE_BUFFER_CACHE_VERSION) throw new Error('Obsolete scene cache: version');
  const length = view.getUint32(8, true), offset = view.getUint32(12, true);
  if (length > 65536 || offset !== ((16 + length + 3) & ~3) || offset > bytes.length - 32) throw new Error('Corrupt scene cache: header');
  if (hex(await digest(bytes.subarray(0, -32))) !== hex(bytes.subarray(-32))) throw new Error('Corrupt scene cache: checksum');
  let meta;
  try {
    meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + length)));
  } catch {
    throw new Error('Corrupt scene cache: metadata encoding/JSON');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Corrupt scene cache: metadata');
  if (meta.key !== expectedKey) throw new Error('Obsolete scene cache: content key');
  if (meta.triangleLayout !== 'reference') throw new Error('Obsolete scene cache: triangle representation');
  if ((meta.bvhLayout ?? 'reference') !== 'reference') throw new Error('Obsolete scene cache: BVH representation');
  if (!integer(meta.materialCount, 0, 2 ** 24 - 1) || !Array.isArray(meta.arrays) || meta.arrays.length !== fields.length) throw new Error('Corrupt scene cache: metadata');
  const g = {
    nodeCount: meta.nodeCount, triangleCount: meta.triangleCount,
    bounds: meta.bounds,
  } as PreparedPathTraceGeometry;
  let cursor = offset;
  for (const [i, name] of fields.entries()) {
    const desc = meta.arrays[i];
    if (desc?.name !== name || desc.type !== (name === 'triangleOrder' ? 'u32' : 'f32') ||
        !integer(desc.length, 0, SCENE_BUFFER_CACHE_MAX_BYTES / 4) || cursor + desc.length * 4 > bytes.length - 32) throw new Error('Corrupt scene cache: array type/size');
    const buffer = bytes.slice(cursor, cursor + desc.length * 4).buffer;
    if (name === 'triangleOrder') g[name] = new Uint32Array(buffer);
    else g[name] = new Float32Array(buffer);
    cursor += desc.length * 4;
  }
  if (cursor !== bytes.length - 32) throw new Error('Corrupt scene cache: trailing data');
  validatePreparedGeometry(g, meta.materialCount);
  return g;
}

export function equalPreparedGeometry(a: PreparedPathTraceGeometry, b: PreparedPathTraceGeometry): boolean {
  return a.nodeCount === b.nodeCount && a.triangleCount === b.triangleCount &&
    a.bounds.min.every((v, i) => v === b.bounds.min[i]) && a.bounds.max.every((v, i) => v === b.bounds.max[i]) &&
    fields.every(name => {
      const aa = bytesOf(a[name]!), bb = bytesOf(b[name]!);
      return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
    });
}

export type SceneBufferCacheMode = 'use' | 'bypass' | 'refresh' | 'verify';
export interface SceneBufferCacheStore {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, bytes: Uint8Array): Promise<void>;
}
export interface SceneBufferCacheReport {
  status: 'hit' | 'miss' | 'bypass' | 'refresh' | 'corrupt' | 'obsolete' | 'unavailable';
  key: string;
  bytes: number;
  diagnostics: string[];
  timings: Record<string, number>;
  geometryIdentical?: boolean;
}

export function httpSceneBufferCache(): SceneBufferCacheStore {
  const url = (key: string) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cache key');
    return `/__pathtracer_cache__/${key}.bin`;
  };
  return {
    async read(key) {
      const response = await fetch(url(key), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Cache read HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (declared > SCENE_BUFFER_CACHE_MAX_BYTES) throw new Error('Cache response exceeds size limit');
      const reader = response.body!.getReader(), parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > SCENE_BUFFER_CACHE_MAX_BYTES) throw new Error('Cache response exceeds size limit');
          parts.push(value);
        }
      } finally { await reader.cancel(); }
      return concat(parts);
    },
    async write(key, bytes) {
      const response = await fetch(url(key), {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes as Uint8Array<ArrayBuffer>, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Cache write HTTP ${response.status}`);
    },
  };
}

export async function buildFileCachedPathTraceScene(
  resources: SceneResources, options: BuildPathTraceSceneOptions = {},
  mode: SceneBufferCacheMode = 'use', store: SceneBufferCacheStore = httpSceneBufferCache(),
) {
  const report: SceneBufferCacheReport = { status: mode === 'bypass' ? 'bypass' : mode === 'refresh' ? 'refresh' : 'miss',
    key: '', bytes: 0, diagnostics: [], timings: { key: 0, read: 0, decode: 0, build: 0, frame: 0, encode: 0, write: 0, verify: 0, upload: 0 } };
  const timed = async <T>(name: string, action: () => T | Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await action(); } finally { report.timings[name] = performance.now() - start; }
  };
  report.key = await timed('key', () => sceneBufferCacheKey(resources, options));
  let geometry: PreparedPathTraceGeometry | undefined;
  if (mode !== 'bypass' && mode !== 'refresh') {
    try {
      const bytes = await timed('read', () => store.read(report.key));
      if (bytes) {
        report.bytes = bytes.length;
        geometry = await timed('decode', () => decodeSceneBufferCache(bytes, report.key));
        report.status = 'hit';
      } else report.diagnostics.push('Cache absent: rebuilding prepared geometry');
    } catch (error) {
      const message = String(error);
      report.status = /Obsolete/.test(message) ? 'obsolete' : /Corrupt|SyntaxError/.test(message) ? 'corrupt' : 'unavailable';
      report.diagnostics.push(`${message}; rebuilding prepared geometry`);
    }
  } else report.diagnostics.push(`Cache ${mode}: rebuilding prepared geometry`);
  const scene = await timed(geometry ? 'frame' : 'build', () => buildPathTraceScene(resources, options, undefined, undefined, geometry));
  if (geometry && mode === 'verify') {
    const reference = await timed('verify', () => buildPathTraceScene(resources, options));
    report.geometryIdentical = equalPreparedGeometry(reference, scene);
    if (!report.geometryIdentical) throw new Error('Cached geometry differs byte-for-byte from uncached build');
  }
  if (!geometry && mode !== 'bypass') {
    try {
      const bytes = await timed('encode', () => encodeSceneBufferCache(scene, report.key, scene.materialCount));
      report.bytes = bytes.length;
      await timed('write', () => store.write(report.key, bytes));
    } catch (error) {
      report.diagnostics.push(`Cache write failed: ${String(error)}`);
      report.status = 'unavailable';
    }
  }
  return { scene, cache: report };
}
