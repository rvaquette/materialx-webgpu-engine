// T035c1: the standard shader ball geometry, loaded by three.js (prebuild) and
// welded/tangent-completed by prepareMesh, is the shared surface for the raster
// vs path-tracing scene comparison (T035c3/c4). These checks guard the asset the
// renders stand on: counts, in-bounds indices, unit normals, UVs in range and a
// finite orthonormal tangent frame.
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/shader-ball.json' with { type: 'json' };
import { prepareShaderBall } from '../../src/geometry/shaderball.ts';

describe('standard shader ball geometry (T035c1)', () => {
  it('fixture is internally consistent', () => {
    expect(fixture.name).toBe('Node');
    expect(fixture.vertexCount).toBe(5832);
    expect(fixture.indexCount).toBe(27264);
    expect(fixture.indexCount % 3).toBe(0);
    expect(fixture.positions.length).toBe(fixture.vertexCount * 3);
    expect(fixture.normals.length).toBe(fixture.vertexCount * 3);
    expect(fixture.uvs.length).toBe(fixture.vertexCount * 2);
    expect(fixture.indices.length).toBe(fixture.indexCount);
  });

  it('every index is within the vertex range', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const i of fixture.indices) {
      if (i < min) min = i;
      if (i > max) max = i;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(fixture.vertexCount);
  });

  it('prepares a welded, tangent-complete mesh', () => {
    const mesh = prepareShaderBall(fixture);
    expect(mesh.indices.length).toBe(27264);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.positions.length).toBe(5832 * 3);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.uvs).toBeDefined();
    expect(mesh.tangents).toBeDefined();
    // Tangents are vec4: xyz direction + handedness w.
    expect(mesh.tangents!.length).toBe(5832 * 4);
  });

  it('has unit normals and an orthonormal tangent frame', () => {
    const mesh = prepareShaderBall(fixture);
    const n = mesh.normals;
    const t = mesh.tangents!;
    for (let v = 0; v < 5832; v++) {
      const nl = Math.hypot(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!);
      expect(nl).toBeGreaterThan(0.99);
      expect(nl).toBeLessThan(1.01);
      const tx = t[v * 4]!;
      const ty = t[v * 4 + 1]!;
      const tz = t[v * 4 + 2]!;
      const w = t[v * 4 + 3]!;
      expect(Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz)).toBe(true);
      expect(Math.hypot(tx, ty, tz)).toBeCloseTo(1, 3);
      expect(Math.abs(w)).toBe(1);
    }
  });

  it('keeps UVs within [0,1]', () => {
    const mesh = prepareShaderBall(fixture);
    const uv = mesh.uvs!;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < uv.length; i++) {
      const x = uv[i]!;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });
});
