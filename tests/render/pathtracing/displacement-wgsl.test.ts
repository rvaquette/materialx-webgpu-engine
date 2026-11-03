import { describe, expect, it } from 'vitest';
import { pathTraceDisplacementWgsl } from '../../../src/render/pathtracing/displacement-wgsl.ts';

describe('pathTraceDisplacementWgsl', () => {
  it('leaves the reference displacement pass unchanged by default', () => {
    const source = pathTraceDisplacementWgsl();
    expect(source).not.toContain('triEdges');
    expect(source).toContain('p1 = p1 + n1 * ((h1 - info.midpoint) * scale);');
  });

  it('updates v0/e1/e2 from the displaced float32 vertices when requested', () => {
    const source = pathTraceDisplacementWgsl(true);
    expect(source).toContain('@group(0) @binding(6) var<storage, read_write> triEdges');
    expect(source).toContain('triEdges[edgeBase + 0u] = p0.x;');
    expect(source).toContain('p1.x - p0.x');
    expect(source).toContain('p2.z - p0.z');
  });
});
