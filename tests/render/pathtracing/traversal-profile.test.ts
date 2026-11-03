import { describe, expect, it } from 'vitest';
import {
  PT_PROFILE_SAMPLE_WORDS, PT_PROFILE_EVENTS, readTraversalProfile, traversalProfileBytes, traversalProfileWgsl,
} from '../../../src/render/pathtracing/traversal-profile.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';

describe('traversal profiling', () => {
  it('is absent from the production shader and rejects incompatible experiments', () => {
    const reference = pathTraceComputeWgsl();
    expect(reference).not.toContain('profileLog');
    expect(pathTraceComputeWgsl({ traversalProfileSamples: 2 })).toContain('profileBase = (pixel * PROFILE_SPP');
    expect(() => pathTraceComputeWgsl({ traversalProfileSamples: 2, bvhTraversal: 'triangleEdges' })).toThrow(/reference traversal/);
    expect(() => pathTraceComputeWgsl({ traversalProfileSamples: 0 })).toThrow(/positive/);
    expect(reference).not.toContain('profileMode');
  });
  it('caps capture allocations before GPU creation', () => {
    expect(traversalProfileBytes(64, 64, 2)).toBe(64 * 64 * 2 * PT_PROFILE_SAMPLE_WORDS * 4);
    expect(() => traversalProfileBytes(128, 128, 8)).toThrow(/128 MiB/);
    expect(() => traversalProfileBytes(NaN, 1, 1)).toThrow(/positive/);
  });
  it('records all query inputs, hit payload and actual traversal work without atomics', () => {
    const code = traversalProfileWgsl(2);
    expect(code).toContain('fn profile_trace(');
    expect(code).toContain('fn traverse(');
    expect(code).toContain('profileBoxes += 1u');
    expect(code).toContain('profileTriangles += 1u');
    expect(code).toContain('profileNodes += 1u');
    expect(code).toContain('bitcast<vec3u>(rd)');
    expect(code).toContain('if (U.profileMode == 3u)');
    expect(code).not.toContain('atomic');
  });
  function fixture() {
    const words = new Uint32Array(2 * PT_PROFILE_SAMPLE_WORDS);
    for (let sample = 0; sample < 2; sample++) {
      const base = sample * PT_PROFILE_SAMPLE_WORDS;
      words[base] = 1;
      words[base + 3] = 1;
      words[base + 4 + 7] = sample;
      words[base + 4 + 12] = 1;
      words[base + 4 + 13] = 12;
      words[base + 4 + 14] = 4;
      words[base + 4 + 15] = 8;
    }
    return words;
  }
  it('separates closest and shadow rays and sums real work', () => {
    expect(readTraversalProfile(fixture(), 2, true)).toEqual({
      samples: 2, rays: 2, closestRays: 1, anyHitRays: 1, hits: 2,
      aabbTests: 24, triangleTests: 8, nodeVisits: 16, maxEventsPerSample: 1,
      bytes: fixture().byteLength,
    });
  });
  it.each([0, 1, 2, 3])('rejects invalid header field %i', field => {
    const words = fixture();
    words[field] = field === 0 ? PT_PROFILE_EVENTS + 1 : field === 3 ? 0 : 1;
    expect(() => readTraversalProfile(words, 2, true)).toThrow(/overflow|mismatch/);
  });
  it('rejects incomplete captures and invalid flags', () => {
    expect(() => readTraversalProfile(new Uint32Array(1), 2)).toThrow(/shape/);
    const words = fixture();
    words[0] = 0;
    expect(() => readTraversalProfile(words, 2)).toThrow(/primary/);
    words[0] = 1;
    words[11] = 2;
    expect(() => readTraversalProfile(words, 2)).toThrow(/flags/);
  });
  it('rejects non-finite query/hit data even when final RGB might be finite', () => {
    const words = fixture();
    new Float32Array(words.buffer)[4] = NaN;
    expect(() => readTraversalProfile(words, 2)).toThrow(/Non-finite/);
  });
});
