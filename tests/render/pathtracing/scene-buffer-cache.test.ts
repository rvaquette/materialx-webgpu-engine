import { describe, expect, it, vi } from 'vitest';
import {
  buildFileCachedPathTraceScene, decodeSceneBufferCache, encodeSceneBufferCache,
  equalPreparedGeometry, sceneBufferCacheKey, validatePreparedGeometry,
  type SceneBufferCacheStore,
} from '../../../src/render/pathtracing/scene-buffer-cache.ts';
import { buildPathTraceScene } from '../../../src/render/pathtracing/scene-buffers.ts';
import type { GeometryResource, MaterialResource, SceneResources } from '../../../src/render/scene-resources.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';
import { NEUTRAL_SURFACE } from '../../../src/render/raster/scene-frame.ts';

function fixture() {
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const geometry = {
    streams: [
      { name: 'position', components: 3, data: position },
      { name: 'normal', components: 3, data: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
      { name: 'uv', components: 2, data: new Float32Array([0, 0, 1, 0, 0, 1]) },
      { name: 'tangent', components: 4, data: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]) },
    ],
    indices: new Uint32Array([0, 1, 2]), vertexCount: 3, triangleCount: 1,
  } as unknown as GeometryResource;
  const resources = {
    geometries: new Map([['g', geometry]]),
    materials: new Map([['m', { features: { passes: [] }, displacement: { file: 'height.png', scale: 0.25 } } as unknown as MaterialResource]]),
    instances: Array.from({ length: 6 }, (_, i) => ({
      id: String(i), prototypeId: 'g', primPath: `/World/${i}`, hasGeometry: true, materialKey: 'm',
      transform: [...IDENTITY4.slice(0, 12), i * 2, 0, 0, 1],
    })),
    tlas: { nodes: [], instanceOrder: new Uint32Array(), bounds: { min: [0, 0, 0], max: [12, 1, 0] } },
  } as unknown as SceneResources;
  return { resources, geometry };
}

function memoryStore() {
  const files = new Map<string, Uint8Array>();
  const store: SceneBufferCacheStore = {
    read: vi.fn(async key => files.get(key)),
    write: vi.fn(async (key, bytes) => { files.set(key, bytes); }),
  };
  return { store, files };
}

describe('prepared scene buffer file cache', () => {
  it('round trips all geometry bytes including UVs/tangents and inflated bounds', async () => {
    const { resources } = fixture();
    const scene = buildPathTraceScene(resources);
    const key = await sceneBufferCacheKey(resources);
    const bytes = await encodeSceneBufferCache(scene, key, scene.materialCount);
    const decoded = await decodeSceneBufferCache(bytes, key);
    expect(equalPreparedGeometry(scene, decoded)).toBe(true);
    expect(decoded.nodes[0]).toBe(-0.125);
  });

  it('round trips the empty scene', async () => {
    const { resources } = fixture();
    resources.instances = [];
    const scene = buildPathTraceScene(resources), key = await sceneBufferCacheKey(resources);
    expect(equalPreparedGeometry(scene, await decodeSceneBufferCache(await encodeSceneBufferCache(scene, key, 0), key))).toBe(true);
  });

  it('cold writes, warm skips BVH and packing, verification compares bytes, bypass does no IO', async () => {
    const { resources } = fixture(), { store } = memoryStore();
    const cold = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    expect(cold.cache.status).toBe('miss');
    expect(cold.cache.diagnostics.join()).toContain('absent');
    const measure = vi.spyOn(performance, 'measure');
    const warm = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    expect(warm.cache.status).toBe('hit');
    expect(warm.cache.timings.build).toBe(0);
    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
    expect(equalPreparedGeometry(cold.scene, warm.scene)).toBe(true);
    expect((await buildFileCachedPathTraceScene(resources, {}, 'verify', store)).cache.geometryIdentical).toBe(true);
    const reads = vi.mocked(store.read).mock.calls.length, writes = vi.mocked(store.write).mock.calls.length;
    expect((await buildFileCachedPathTraceScene(resources, {}, 'bypass', store)).cache.status).toBe('bypass');
    expect(vi.mocked(store.read).mock.calls.length).toBe(reads);
    expect(vi.mocked(store.write).mock.calls.length).toBe(writes);
  });

  it.each(['position', 'normal', 'uv', 'tangent'])('invalidates exact %s source bytes', async name => {
    const { resources, geometry } = fixture();
    const before = await sceneBufferCacheKey(resources);
    const data = geometry.streams.find(s => s.name === name)!.data;
    data[0] = data[0]! + 0.125;
    expect(await sceneBufferCacheKey(resources)).not.toBe(before);
  });

  it.each(['index', 'transform', 'assignment', 'order', 'displacement', 'stride'])('invalidates %s mutations and rebuilds', async mutation => {
    const { resources, geometry } = fixture(), { store } = memoryStore();
    const cold = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    if (mutation === 'index') geometry.indices.reverse();
    if (mutation === 'transform') resources.instances[0]!.transform = [...IDENTITY4.slice(0, 12), 1, 0, 0, 1];
    if (mutation === 'assignment') delete resources.instances[0]!.materialKey;
    if (mutation === 'order') resources.instances = [...resources.instances].reverse();
    if (mutation === 'displacement') resources.materials.get('m')!.displacement!.scale = 2;
    if (mutation === 'stride') geometry.streams.find(s => s.name === 'tangent')!.components = 3;
    const changed = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    expect(changed.cache.key).not.toBe(cold.cache.key);
    expect(changed.cache.status).toBe('miss');
  });

  it('invalidates displacement multiplier and emitter exclusion but not editable frame/material values', async () => {
    const { resources } = fixture(), { store } = memoryStore();
    const cold = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    expect(await sceneBufferCacheKey(resources, { displacementScale: 2 })).not.toBe(cold.cache.key);
    const warm = await buildFileCachedPathTraceScene(resources, {
      frameCamera: { viewProj: IDENTITY4, eye: [9, 8, 7], exposure: 3 },
      surfaceFor: () => ({ ...NEUTRAL_SURFACE, roughness: 0.9 }),
      settings: { maxDepth: 3, rouletteDepth: 2, converted: false },
      environment: { radiance: [1, 2, 3] },
    }, 'use', store);
    expect(warm.cache.status).toBe('hit');
    expect(warm.scene.camera.eye).toEqual([9, 8, 7]);
    expect(warm.scene.materials).not.toEqual(cold.scene.materials);
    expect(warm.scene.settings?.maxDepth).toBe(3);
    resources.instances[0]!.primPath = '/World/Light_Geometry';
    const lights = [{ path: '/World/Light', type: 'distant' as const, usdType: 'DistantLight',
      transform: IDENTITY4, color: [1, 1, 1] as const, intensity: 1, exposure: 0, normalize: false }];
    expect(await sceneBufferCacheKey(resources, { settings: { converted: true, maxDepth: 3, rouletteDepth: 2 }, lights })).not.toBe(cold.cache.key);
  });

  it.each(['checksum', 'version', 'key', 'truncate'])('diagnoses %s corruption/obsolescence and repairs it', async mutation => {
    const { resources } = fixture(), { store, files } = memoryStore();
    const cold = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    let bytes = files.get(cold.cache.key)!.slice();
    if (mutation === 'checksum') bytes[bytes.length - 40] = bytes[bytes.length - 40]! ^ 1;
    if (mutation === 'version') new DataView(bytes.buffer).setUint32(4, 99, true);
    if (mutation === 'key') bytes = await encodeSceneBufferCache(cold.scene, 'a'.repeat(64), cold.scene.materialCount);
    if (mutation === 'truncate') bytes = bytes.slice(0, 21);
    files.set(cold.cache.key, bytes);
    const rebuilt = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    expect(rebuilt.cache.status).toBe(['version', 'key'].includes(mutation) ? 'obsolete' : 'corrupt');
    expect(rebuilt.cache.diagnostics.join()).toContain('rebuilding');
    expect(equalPreparedGeometry(cold.scene, rebuilt.scene)).toBe(true);
    expect((await buildFileCachedPathTraceScene(resources, {}, 'use', store)).cache.status).toBe('hit');
  });

  it.each(['type', 'size', 'order', 'material', 'bounds', 'child', 'leaf', 'nonfinite'])('rejects invalid %s before upload', mutation => {
    const { resources } = fixture(), scene = buildPathTraceScene(resources);
    if (mutation === 'type') scene.triangleOrder = new Float32Array(scene.triangleOrder) as unknown as Uint32Array;
    if (mutation === 'size') scene.triangleUv = new Float32Array(1);
    if (mutation === 'order') scene.triangleOrder[0] = 999;
    if (mutation === 'material') scene.triangles[18] = scene.materialCount;
    if (mutation === 'bounds') scene.nodes[0] = 999;
    if (mutation === 'child') scene.nodes[3] = 0;
    if (mutation === 'leaf') scene.nodes[9] = scene.triangleCount + 1;
    if (mutation === 'nonfinite') scene.triangleTangent[0] = NaN;
    expect(() => validatePreparedGeometry(scene, scene.materialCount)).toThrow('Corrupt');
  });

  it('keeps rendering when the local server is unavailable with explicit diagnostics', async () => {
    const { resources } = fixture();
    const store = { read: async () => { throw new Error('offline'); }, write: async () => { throw new Error('read-only'); } };
    const result = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    expect(result.cache.status).toBe('unavailable');
    expect(result.cache.diagnostics.join()).toContain('offline');
    expect(result.cache.diagnostics.join()).toContain('read-only');
    expect(result.scene.triangleCount).toBe(6);
  });

  it('rebuilds current material variants instead of serializing their graphs', async () => {
    const { resources } = fixture(), { store } = memoryStore();
    const cold = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    const material = resources.materials.get('m')!;
    material.surfaceGraph = {} as NonNullable<MaterialResource['surfaceGraph']>;
    material.resolvedSurface = { family: 'standard_surface', nodeId: 'material', inputs: new Map() };
    const warm = await buildFileCachedPathTraceScene(resources, {}, 'use', store);
    expect(warm.cache.status).toBe('hit');
    expect(cold.scene.variantSources).toHaveLength(0);
    expect(warm.scene.variantSources[0]!.graph).toBe(material.surfaceGraph);
    expect(warm.scene.variantSources[0]!.surface).toBe(material.resolvedSurface);
  });

  it.each(['type', 'size', 'index', 'bounds', 'count', 'metadata', 'triangle representation', 'BVH representation'])('rejects well-checksummed malformed binary %s', async mutation => {
    const { resources } = fixture(), scene = buildPathTraceScene(resources);
    const key = await sceneBufferCacheKey(resources);
    const original = await encodeSceneBufferCache(scene, key, scene.materialCount);
    const originalView = new DataView(original.buffer);
    let meta = JSON.parse(new TextDecoder().decode(original.subarray(16, 16 + originalView.getUint32(8, true))));
    if (mutation === 'type') meta.arrays[2].type = 'f32';
    if (mutation === 'size') meta.arrays[3].length += 1;
    if (mutation === 'count') meta.nodeCount = '1';
    if (mutation === 'triangle representation') meta.triangleLayout = 'unsupported';
    if (mutation === 'BVH representation') meta.bvhLayout = 'unsupported';
    if (mutation === 'metadata') meta = null;
    const json = new TextEncoder().encode(JSON.stringify(meta));
    const offset = (16 + json.length + 3) & ~3;
    const payload = original.subarray(originalView.getUint32(12, true), -32);
    const body = new Uint8Array(offset + payload.length);
    const view = new DataView(body.buffer);
    body.set(original.subarray(0, 16));
    view.setUint32(8, json.length, true);
    view.setUint32(12, offset, true);
    body.set(json, 16);
    body.set(payload, offset);
    if (mutation === 'index') view.setFloat32(offset + 3 * 4, 999, true);
    if (mutation === 'bounds') view.setFloat32(offset, 999, true);
    const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
    const bytes = new Uint8Array(body.length + checksum.length);
    bytes.set(body); bytes.set(checksum, body.length);
    await expect(decodeSceneBufferCache(bytes, key)).rejects.toThrow(mutation.endsWith('representation') ? 'Obsolete' : 'Corrupt');
  });
});
