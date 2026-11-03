import { describe, expect, it } from 'vitest';
import { pathTraceDisplacementWgsl } from '../../../src/render/pathtracing/displacement-wgsl.ts';

describe('pathTraceDisplacementWgsl', () => {
  it('displaces vertices along their normals without changing the triangle record layout', () => {
    const source = pathTraceDisplacementWgsl();
    expect(source).toContain('const STRIDE: u32 = 24u;');
    expect(source).toContain('p1 = p1 + n1 * ((h1 - info.midpoint) * scale);');
  });

});
