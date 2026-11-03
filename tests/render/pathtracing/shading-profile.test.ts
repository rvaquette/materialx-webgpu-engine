import { describe, expect, it } from 'vitest';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';
import { instrumentShadingIntegrator, readShadingProfile, shadingProfileBytes, shadingProfileLayout,
  shadingProfileWgsl, SHADING_PROFILE_EVENTS } from '../../../src/render/pathtracing/shading-profile.ts';

describe('BSDF shading capture/replay', () => {
  it('isolates the unrolled BSDF candidate from production and replay diagnostics', () => {
    const code = pathTraceComputeWgsl({ bsdfEvaluation: 'unrolled', maxLobes: 3 });
    expect(code.match(/fn mx_closure_base_eval\([^]*?\n}/)![0]).toContain('c.lobes[2u]');
    expect(pathTraceComputeWgsl().match(/fn mx_closure_base_eval\([^]*?\n}/)![0]).toContain('c.lobes[i]');
    expect(code).not.toContain('profileLog');
    expect(() => pathTraceComputeWgsl({ bsdfEvaluation: 'unrolled', shadingProfileSamples: 1 })).toThrow(/reference BSDF/);
    expect(() => pathTraceComputeWgsl({ bsdfEvaluation: 'unrolled', traversalProfileSamples: 1 })).toThrow(/reference BSDF/);
  });
  it('is absent from production and incompatible with other diagnostic/layout modes', () => {
    expect(pathTraceComputeWgsl()).not.toContain('profile_mx_closure');
    const code = pathTraceComputeWgsl({ shadingProfileSamples: 1, maxLobes: 2 });
    expect(code).toContain('profile_mx_closure_eval(c, wo, wiLight)');
    expect(code).toContain('profile_mx_closure_sample(c, wo, u)');
    expect(pathTraceComputeWgsl({ shadingProfileSamples: 1, environment: true }))
      .toContain('profile_mx_closure_specular_eval(c, wo, bs.wi)');
    expect(code).toContain('let e = mx_closure_eval(c, wo, wi)');
    expect(() => pathTraceComputeWgsl({ shadingProfileSamples: 1, traversalProfileSamples: 1 })).toThrow(/one profiling/);
    expect(() => pathTraceComputeWgsl({ shadingProfileSamples: 1, bvhTraversal: 'bvh4' })).toThrow(/reference/);
    expect(() => pathTraceComputeWgsl({ shadingProfileSamples: 1, displayAovs: true })).toThrow(/AOVs/);
  });
  it('serializes every closure scalar without padding and validates source/schema drift', () => {
    const code = shadingProfileWgsl(1, 2);
    expect(code).toContain('bitcast<u32>(c.lobes[1].hairTintTRT.z)');
    expect(code).toContain('c.hasShadingTangent');
    expect(code).toContain('bitcast<u32>(arg.z)');
    expect(code).toContain('profileLog[profileBase + 2u] = 1u');
    expect(code).not.toContain('atomic');
    expect(code).not.toContain('c.lobes[2]');
    expect(() => instrumentShadingIntegrator('')).toThrow(/no longer matches/);
    expect(() => shadingProfileLayout(0)).toThrow(/capacity/);
  });
  it('bounds allocations including high-lobe captures', () => {
    expect(shadingProfileBytes(32, 32, 1, 8)).toBeLessThan(128 * 1024 * 1024);
    expect(shadingProfileLayout(8).closureWords - shadingProfileLayout(7).closureWords).toBe(20);
    expect(() => shadingProfileBytes(128, 128, 8, 8)).toThrow(/128 MiB/);
    expect(() => shadingProfileBytes(NaN, 1, 1, 1)).toThrow(/positive/);
  });
  function fixture() {
    const layout = shadingProfileLayout(1);
    const words = new Uint32Array(2 * layout.sampleWords);
    words[0] = 1;
    words[3] = 1;
    words[4] = 2;
    words[4 + layout.inputWords + 7] = 1;
    words[layout.sampleWords] = 0;
    return { words, layout };
  }
  it('accepts empty background samples and separates eval/sample calls', () => {
    const { words } = fixture();
    const result = readShadingProfile(words, 2, 1, true);
    expect(result.calls).toBe(1);
    expect(result.sampleCalls).toBe(1);
    expect(result.evalCalls).toBe(0);
    expect(result.maxEventsPerSample).toBe(1);
  });
  it('rejects overflow, input/count mismatch and malformed buffers', () => {
    const { words } = fixture();
    words[0] = SHADING_PROFILE_EVENTS + 1;
    expect(() => readShadingProfile(words, 2, 1)).toThrow(/overflow/);
    words[0] = 1;
    words[2] = 1;
    expect(() => readShadingProfile(words, 2, 1, true)).toThrow(/mismatch/);
    words[2] = 0;
    words[3] = 0;
    expect(() => readShadingProfile(words, 2, 1, true)).toThrow(/mismatch/);
    expect(() => readShadingProfile(words, 1, 1)).toThrow(/shape/);
  });
  it('rejects invalid kinds, non-finite fields, flags and pdf', () => {
    const { words, layout } = fixture();
    words[4] = 3;
    expect(() => readShadingProfile(words, 2, 1)).toThrow(/kind/);
    words[4] = 2;
    const floats = new Float32Array(words.buffer);
    floats[5] = NaN;
    expect(() => readShadingProfile(words, 2, 1)).toThrow(/Non-finite/);
    floats[5] = 0;
    words[4 + layout.inputWords + 7] = 2;
    expect(() => readShadingProfile(words, 2, 1)).toThrow(/flags/);
    words[4 + layout.inputWords + 7] = 1;
    floats[4 + layout.inputWords + 6] = -1;
    expect(() => readShadingProfile(words, 2, 1)).toThrow(/pdf/);
  });
});
