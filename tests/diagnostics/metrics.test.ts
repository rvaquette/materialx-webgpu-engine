import { describe, it, expect, vi } from 'vitest';
import { MetricsCollector } from '../../src/diagnostics/metrics.ts';

// Injectable clock so frame/span timing is deterministic under Node.
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('MetricsCollector frame stats (T036)', () => {
  it('records frame durations and computes window statistics', () => {
    const clock = fakeClock();
    const m = new MetricsCollector({ now: clock.now });
    for (const d of [10, 20, 30, 40]) {
      m.beginFrame();
      clock.advance(d);
      m.endFrame();
    }
    const s = m.stats();
    expect(s.count).toBe(4);
    expect(s.minMs).toBe(10);
    expect(s.maxMs).toBe(40);
    expect(s.meanMs).toBe(25);
    expect(s.p95Ms).toBe(40);
    expect(s.fps).toBeCloseTo(40, 6);
  });

  it('returns zeroed stats before any frame', () => {
    const m = new MetricsCollector();
    expect(m.stats()).toEqual({ count: 0, minMs: 0, maxMs: 0, meanMs: 0, p95Ms: 0, fps: 0 });
  });

  it('bounds the rolling window to windowSize', () => {
    const clock = fakeClock();
    const m = new MetricsCollector({ now: clock.now, windowSize: 3 });
    for (const d of [5, 5, 5, 100]) {
      m.beginFrame();
      clock.advance(d);
      m.endFrame();
    }
    const s = m.stats();
    expect(s.count).toBe(3);
    expect(s.maxMs).toBe(100);
    expect(s.minMs).toBe(5);
  });
});

describe('MetricsCollector counters and spans (T036)', () => {
  it('accumulates per-frame counters and publishes them on endFrame', () => {
    const clock = fakeClock();
    const m = new MetricsCollector({ now: clock.now });
    m.beginFrame();
    m.recordUpload(1000, 2);
    m.recordUpload(500);
    m.recordDraws(7);
    m.endFrame();
    expect(m.snapshot().lastFrame).toEqual({ uploadBytes: 1500, uploadCount: 3, drawCalls: 7 });

    // Counters reset on the next frame.
    m.beginFrame();
    m.recordUpload(10);
    m.endFrame();
    expect(m.snapshot().lastFrame).toEqual({ uploadBytes: 10, uploadCount: 1, drawCalls: 0 });
  });

  it('times named spans and measure()', () => {
    const clock = fakeClock();
    const m = new MetricsCollector({ now: clock.now });
    m.beginFrame();
    m.begin('bvh');
    clock.advance(8);
    m.end('bvh');
    const r = m.measure('decode', () => {
      clock.advance(4);
      return 42;
    });
    m.endFrame();
    expect(r).toBe(42);
    const spans = m.snapshot().spans;
    expect(spans.bvh).toEqual({ totalMs: 8, count: 1, meanMs: 8 });
    expect(spans.decode).toEqual({ totalMs: 4, count: 1, meanMs: 4 });
  });
});

describe('MetricsCollector budgets (T036)', () => {
  it('flags an overrun once on the under->over transition', () => {
    const onDiagnostic = vi.fn();
    const m = new MetricsCollector({ onDiagnostic });
    m.setBudget('gpuBytes', 100);
    m.charge('gpuBytes', 60);
    expect(m.budget('gpuBytes')).toEqual({ used: 60, max: 100, over: false });
    expect(onDiagnostic).not.toHaveBeenCalled();

    m.charge('gpuBytes', 60); // 120 > 100
    expect(m.budget('gpuBytes')).toEqual({ used: 120, max: 100, over: true });
    expect(onDiagnostic).toHaveBeenCalledTimes(1);

    m.charge('gpuBytes', 10); // still over, no second warning
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
  });

  it('tracks absolute usage via setUsage', () => {
    const m = new MetricsCollector();
    m.setBudget('rays', 1000);
    m.setUsage('rays', 250);
    expect(m.budget('rays')).toEqual({ used: 250, max: 1000, over: false });
  });
});
