import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '../../src/compiler/cache.ts';
import { PersistentPreparedGeometryCache, preparedGeometryCacheKey } from '../../src/geometry/cache.ts';
import { prepareMesh } from '../../src/geometry/prepare.ts';

const mesh = {
  points: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  faceVertexCounts: [3],
  faceVertexIndices: [0, 1, 2],
};

describe('prepared geometry cache', () => {
  it('creates stable content keys and invalidates on geometry or preparation changes', async () => {
    const base = await preparedGeometryCacheKey(mesh, {});
    expect(base).toBeDefined();
    expect(await preparedGeometryCacheKey({ ...mesh, points: [...mesh.points] }, {})).toBe(base);
    expect(await preparedGeometryCacheKey({ ...mesh, points: [2, ...mesh.points.slice(1)] }, {})).not.toBe(base);
    expect(await preparedGeometryCacheKey(mesh, { computeTangents: true })).not.toBe(base);
  });

  it('hashes large geometry in bounded blocks and includes values beyond the first block', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
    try {
      const points = Array.from({ length: 100000 }, (_, index) => index * 0.125);
      const key = await preparedGeometryCacheKey({ ...mesh, points }, {});
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(digest.mock.calls.length).toBeGreaterThan(1);
      expect(digest.mock.calls.every(([, data]) => data.byteLength <= 64 * 1024 + 32)).toBe(true);
      expect(await preparedGeometryCacheKey({ faceVertexIndices: [0, 1, 2], points: [...points], faceVertexCounts: [3] }, {})).toBe(key);
      points[points.length - 1] = -1;
      expect(await preparedGeometryCacheKey({ ...mesh, points }, {})).not.toBe(key);
    } finally {
      digest.mockRestore();
    }
  });

  it('round-trips prepared typed arrays through the persistent store', async () => {
    const cache = new PersistentPreparedGeometryCache(new MemoryKeyValueStore());
    const prepared = prepareMesh(mesh);

    expect(await cache.get('mesh-key')).toBeUndefined();
    await cache.set('mesh-key', prepared);
    const restored = await cache.get('mesh-key');

    expect(restored?.positions).toBeInstanceOf(Float32Array);
    expect(restored?.indices).toBeInstanceOf(Uint32Array);
    expect(restored?.positions).toEqual(prepared.positions);
    expect(restored?.indices).toEqual(prepared.indices);
  });
});
