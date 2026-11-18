import { describe, expect, it } from 'vitest';
import {
  pathTraceAdaptiveSamplingWgsl,
  pathTraceConvergenceWgsl,
  relativeNoiseEstimate,
  PT_CONVERGENCE_LUMINANCE_FLOOR,
  PT_CONVERGENCE_MAX_TARGET_RELATIVE_ERROR,
  PT_CONVERGENCE_MIN_TARGET_RELATIVE_ERROR,
  PT_CONVERGENCE_MIN_SAMPLES,
  PT_CONVERGENCE_TARGET_RELATIVE_ERROR,
} from '../../../src/render/pathtracing/convergence.ts';

describe('path-tracing convergence estimates', () => {
  it('requires enough samples and returns a relative 95% confidence interval', () => {
    expect(relativeNoiseEstimate(0.5, 1, PT_CONVERGENCE_MIN_SAMPLES - 1)).toBeUndefined();
    expect(relativeNoiseEstimate(0.5, 0, PT_CONVERGENCE_MIN_SAMPLES)).toBe(0);
    expect(relativeNoiseEstimate(0, 7, PT_CONVERGENCE_MIN_SAMPLES)).toBeCloseTo(
      1.96 * Math.sqrt((7 / (PT_CONVERGENCE_MIN_SAMPLES - 1)) / PT_CONVERGENCE_MIN_SAMPLES)
        / PT_CONVERGENCE_LUMINANCE_FLOOR,
    );
  });

  it('reduces per-pixel uncertainty into spatial zones without changing radiance', () => {
    const wgsl = pathTraceConvergenceWgsl();
    expect(wgsl).toContain('let m2 = max(accum[index + 1u].y, 0.0);');
    expect(wgsl).toContain('sqrt(variance / f32(sampleCount))');
    expect(wgsl).toContain('settings.targetRelativeError');
    expect(wgsl).toContain('squaredErrors[lane] += squaredErrors[lane + stride]');
    expect(PT_CONVERGENCE_TARGET_RELATIVE_ERROR).toBe(0.05);
    expect(PT_CONVERGENCE_MIN_TARGET_RELATIVE_ERROR).toBe(0.005);
    expect(PT_CONVERGENCE_MAX_TARGET_RELATIVE_ERROR).toBe(0.25);
    expect(pathTraceAdaptiveSamplingWgsl()).toContain('return uncertainty > U.sh[8].w');
  });
});
