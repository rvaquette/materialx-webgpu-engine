// T035b: unit tests for the image/signal comparison utility. Known inputs pin the
// exact metric values so scene tolerances (T035c/d) rest on a verified ruler.
import { describe, it, expect } from 'vitest';
import { diffMetrics, compareSignals, compareImages } from './compare.ts';

describe('diffMetrics (T035b)', () => {
  it('reports zero for identical buffers', () => {
    const a = [0.1, 0.5, 0.9, 1.0];
    const m = diffMetrics(a, a);
    expect(m.maxAbsDiff).toBe(0);
    expect(m.meanAbsDiff).toBe(0);
    expect(m.rmse).toBe(0);
    expect(m.maxRelDiff).toBe(0);
    expect(m.count).toBe(4);
  });

  it('computes known max/mean/rmse/rel for a fixed diff', () => {
    const a = [0, 0, 0, 0];
    const b = [0.1, 0.2, 0, 0];
    const m = diffMetrics(a, b);
    expect(m.maxAbsDiff).toBeCloseTo(0.2, 12);
    expect(m.meanAbsDiff).toBeCloseTo(0.075, 12);
    expect(m.rmse).toBeCloseTo(Math.sqrt(0.05 / 4), 12);
    // denom = max(|a|,|b|,eps) = |b| for the two non-zero samples -> rel = 1.
    expect(m.maxRelDiff).toBeCloseTo(1, 9);
  });

  it('throws on length mismatch', () => {
    expect(() => diffMetrics([1, 2], [1])).toThrow(/length mismatch/);
  });

  it('throws on non-finite samples', () => {
    expect(() => diffMetrics([0], [Number.NaN])).toThrow(/non-finite/);
    expect(() => diffMetrics([Infinity], [0])).toThrow(/non-finite/);
  });
});

describe('compareSignals (T035b)', () => {
  it('passes within tolerance and fails outside it', () => {
    const a = [0.5, 0.5, 0.5];
    const b = [0.5005, 0.4995, 0.5];
    expect(compareSignals(a, b, { maxAbs: 1e-3 }).pass).toBe(true);
    const bad = compareSignals(a, b, { maxAbs: 1e-4 });
    expect(bad.pass).toBe(false);
    expect(bad.violations[0]).toMatch(/maxAbsDiff/);
  });

  it('checks rmse and maxRel independently', () => {
    const a = [1, 1, 1, 1];
    const b = [1.1, 0.9, 1.0, 1.0];
    const res = compareSignals(a, b, { rmse: 0.01, maxRel: 0.01 });
    expect(res.pass).toBe(false);
    expect(res.violations.some((v) => v.startsWith('rmse'))).toBe(true);
    expect(res.violations.some((v) => v.startsWith('maxRelDiff'))).toBe(true);
  });
});

describe('compareImages (T035b)', () => {
  it('isolates per-channel metrics', () => {
    // RG buffer (2 channels, 2 texels): channel 0 differs, channel 1 identical.
    const a = [0, 0, 0, 0];
    const b = [0.1, 0, 0.3, 0];
    const res = compareImages(a, b, 2, {});
    expect(res.perChannel).toHaveLength(2);
    expect(res.perChannel[0]!.maxAbsDiff).toBeCloseTo(0.3, 12);
    expect(res.perChannel[1]!.maxAbsDiff).toBe(0);
    expect(res.overall.maxAbsDiff).toBeCloseTo(0.3, 12);
  });

  it('names the offending channel in a violation', () => {
    const a = [0, 0, 0, 0];
    const b = [0.5, 0, 0, 0];
    const res = compareImages(a, b, 2, { maxAbs: 0.1 });
    expect(res.pass).toBe(false);
    expect(res.violations[0]).toMatch(/^channel 0 maxAbsDiff/);
  });

  it('rejects a length not divisible by the channel count', () => {
    expect(() => compareImages([1, 2, 3], [1, 2, 3], 2, {})).toThrow(/multiple of 2/);
  });
});
