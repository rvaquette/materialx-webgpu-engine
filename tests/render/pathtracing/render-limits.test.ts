import { describe, expect, it } from 'vitest';
import { PathTraceStopping, pathTraceMetrics } from '../../../src/render/pathtracing/render-limits.ts';
import type { PathTraceConvergence } from '../../../src/render/pathtracing/convergence.ts';

function measurement(samples: number, converged = true): PathTraceConvergence {
  return {
    samples, columns: 1, rows: 1, targetRelativeError: 0.05,
    zones: [{ relativeError: 0.01, maximumRelativeError: converged ? 0.04 : 0.1,
      convergedFraction: converged ? 1 : 0.99, validFraction: 1 }],
  };
}

describe('progressive rendering limits', () => {
  it('leaves default rendering unlimited', () => {
    const stop = new PathTraceStopping({ stopOnConvergence: false, timeBudgetSeconds: 0, targetRelativeError: 0.05 });
    stop.recordBatch(1e8);
    for (const samples of [64, 72, 80]) stop.observe(measurement(samples));
    expect(stop.progress.stopReason).toBeUndefined();
  });

  describe('progressive rendering metrics', () => {
    const limits = { stopOnConvergence: false, timeBudgetSeconds: 100, targetRelativeError: 0.05 };
    const progress = { elapsedSeconds: 16, stopReason: undefined };

    it('estimates active time to the worst-pixel target independently of the remaining budget', () => {
      const convergence = measurement(64, false);
      convergence.zones = [
        { relativeError: 0.02, maximumRelativeError: 0.05, convergedFraction: 1, validFraction: 1 },
        { relativeError: 0.04, maximumRelativeError: 0.1, convergedFraction: 0.5, validFraction: 1 },
      ];
      convergence.columns = 2;
      const metrics = pathTraceMetrics(progress, limits, 64, false, convergence);
      expect(metrics.sweepsPerSecond).toBe(4);
      expect(metrics.budgetRemainingSeconds).toBe(84);
      expect(metrics.convergenceRemainingSeconds).toBe(48);
      expect(metrics.relativeNoise).toBeCloseTo(Math.sqrt(0.001));
      expect(metrics.maximumRelativeNoise).toBe(0.1);
      expect(metrics.relativeVariance).toBeCloseTo(0.001 * 64 / 1.96 ** 2);
      expect(pathTraceMetrics(progress, limits, 80, false, convergence).convergenceRemainingSeconds).toBeCloseTo(35.2);
    });

    it('reports zero at the noise target without implying that confirmation or automatic stopping is complete', () => {
      const metrics = pathTraceMetrics(progress, limits, 64, false, measurement(64));
      expect(metrics.convergenceRemainingSeconds).toBe(0);
      expect(progress.stopReason).toBeUndefined();
    });

    it('keeps adaptive noise and sweep throughput but does not extrapolate using nonuniform sample counts', () => {
      const metrics = pathTraceMetrics(progress, limits, 64, true, measurement(64));
      expect(metrics.sweepsPerSecond).toBe(4);
      expect(metrics.relativeNoise).toBe(0.01);
      expect(metrics.budgetRemainingSeconds).toBe(84);
      expect(metrics.relativeVariance).toBeUndefined();
      expect(metrics.convergenceRemainingSeconds).toBeUndefined();
    });

    it.each(['immature', 'incomplete', 'missing', 'readback-error', 'nonfinite', 'future'] as const)(
      'withholds predictions when convergence is unavailable or unreliable (%s)', failure => {
        const convergence = measurement(failure === 'immature' ? 8 : failure === 'future' ? 72 : 64);
        if (failure === 'incomplete') convergence.zones = [{ ...convergence.zones[0]!, validFraction: 0.99 }];
        if (failure === 'missing') convergence.columns = 2;
        if (failure === 'nonfinite') convergence.zones = [{ ...convergence.zones[0]!, maximumRelativeError: Infinity }];
        const metrics = pathTraceMetrics(progress, limits, 64, false,
          failure === 'readback-error' ? undefined : convergence);
        expect(metrics.convergenceRemainingSeconds).toBeUndefined();
        expect(metrics.budgetRemainingSeconds).toBe(84);
      },
    );

    it('clears rate and predictions on reset, leaves unlimited budgets absent and clamps exhausted budgets', () => {
      expect(pathTraceMetrics({ elapsedSeconds: 0, stopReason: undefined },
        { ...limits, timeBudgetSeconds: 0 }, 0, false, undefined)).toEqual({});
      expect(pathTraceMetrics({ ...progress, elapsedSeconds: 120, stopReason: 'time-budget' },
        limits, 64, false, measurement(64)).budgetRemainingSeconds).toBe(0);
      expect(pathTraceMetrics({ ...progress, elapsedSeconds: 0 }, limits, 64, false, measurement(64))
        .sweepsPerSecond).toBeUndefined();
    });
  });

  it('requires 64 sweeps and three distinct consecutive fully converged measurements', () => {
    const stop = new PathTraceStopping({ stopOnConvergence: true, timeBudgetSeconds: 0, targetRelativeError: 0.05 });
    for (const samples of [8, 16, 24]) stop.observe(measurement(samples));
    expect(stop.progress.stopReason).toBeUndefined();
    stop.observe(measurement(64));
    stop.observe(measurement(64));
    stop.observe(measurement(56));
    stop.observe(measurement(72));
    expect(stop.progress.stopReason).toBeUndefined();
    stop.observe(measurement(80));
    expect(stop.progress.stopReason).toBe('convergence');
  });

  it('only confirms convergence measurements made for the currently configured target', () => {
    const stop = new PathTraceStopping({ stopOnConvergence: true, timeBudgetSeconds: 0, targetRelativeError: 0.02 });
    stop.observe(measurement(64));
    const targetMeasurement = (samples: number): PathTraceConvergence => ({
      ...measurement(samples),
      targetRelativeError: 0.02,
      zones: [{ relativeError: 0.01, maximumRelativeError: 0.015, convergedFraction: 1, validFraction: 1 }],
    });
    expect(stop.progress.stopReason).toBeUndefined();
    stop.observe(targetMeasurement(72));
    stop.observe(targetMeasurement(80));
    stop.observe(targetMeasurement(88));
    expect(stop.progress.stopReason).toBe('convergence');
  });

  it.each(['noise', 'unmeasured', 'readback-error', 'nonfinite', 'missing-zone'] as const)(
    'does not stop across an interrupted convergence streak (%s)', failure => {
      const stop = new PathTraceStopping({ stopOnConvergence: true, timeBudgetSeconds: 0, targetRelativeError: 0.05 });
      stop.observe(measurement(64));
      const bad = measurement(72);
      if (failure === 'noise') bad.zones = measurement(72, false).zones;
      if (failure === 'unmeasured') bad.zones = [{ ...bad.zones[0]!, validFraction: 0.99 }];
      if (failure === 'nonfinite') bad.zones = [{ ...bad.zones[0]!, maximumRelativeError: NaN }];
      if (failure === 'missing-zone') bad.columns = 2;
      stop.observe(failure === 'readback-error' ? undefined : bad);
      stop.observe(measurement(80));
      stop.observe(measurement(88));
      expect(stop.progress.stopReason).toBeUndefined();
      stop.observe(measurement(96));
      expect(stop.progress.stopReason).toBe('convergence');
    },
  );

  it('stops at the active time boundary and reconfigures without losing samples or elapsed time', () => {
    const stop = new PathTraceStopping({ stopOnConvergence: false, timeBudgetSeconds: 2, targetRelativeError: 0.05 });
    stop.recordBatch(1999);
    expect(stop.progress.stopReason).toBeUndefined();
    stop.recordBatch(1);
    expect(stop.progress).toEqual({ elapsedSeconds: 2, stopReason: 'time-budget' });
    stop.configure({ stopOnConvergence: false, timeBudgetSeconds: 3, targetRelativeError: 0.05 });
    expect(stop.progress).toEqual({ elapsedSeconds: 2, stopReason: undefined });
    stop.recordBatch(1000);
    expect(stop.progress.stopReason).toBe('time-budget');
    stop.configure({ stopOnConvergence: false, timeBudgetSeconds: 0, targetRelativeError: 0.05 });
    expect(stop.progress.stopReason).toBeUndefined();
    stop.configure({ stopOnConvergence: false, timeBudgetSeconds: 1, targetRelativeError: 0.05 });
    expect(stop.progress.stopReason).toBe('time-budget');
    stop.reset();
    expect(stop.progress).toEqual({ elapsedSeconds: 0, stopReason: undefined });
  });
});
