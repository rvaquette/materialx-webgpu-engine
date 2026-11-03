import { describe, expect, it } from 'vitest';
import { pathTraceDisplacementWgsl } from '../../../src/render/pathtracing/displacement-wgsl.ts';

describe('pathTraceDisplacementWgsl', () => {
  it('leaves the reference displacement pass unchanged by default', () => {
    const source = pathTraceDisplacementWgsl();
    expect(source).not.toContain('triEdges');
    expect(source).toContain('p1 = p1 + n1 * ((h1 - info.midpoint) * scale);');
  });

});
