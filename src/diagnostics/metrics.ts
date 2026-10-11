// Frame-level profiling and budget accounting (plan section 10, REQ-012). The
// collector is engine-agnostic and clock-injectable so it is deterministic under
// Node tests and runs unchanged in the browser (performance.now) on the Android
// target, where its snapshot() is collected over the device harness. It reports
// budget overruns through the shared DiagnosticSink instead of dropping them.

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';

export interface FrameStats {
  /** Number of frames currently in the rolling window. */
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  /** 95th percentile frame time, the tail that governs perceived smoothness. */
  readonly p95Ms: number;
  /** Mean frames per second over the window (0 when empty). */
  readonly fps: number;
}

export interface SpanStats {
  readonly totalMs: number;
  readonly count: number;
  readonly meanMs: number;
}

export interface BudgetState {
  readonly used: number;
  readonly max: number;
  readonly over: boolean;
}

export interface FrameCounters {
  readonly uploadBytes: number;
  readonly uploadCount: number;
  readonly drawCalls: number;
}

export interface MetricsSnapshot {
  readonly frame: FrameStats;
  readonly lastFrame: FrameCounters;
  readonly spans: Record<string, SpanStats>;
  readonly budgets: Record<string, BudgetState>;
}

export interface MetricsCollectorOptions {
  /** Rolling window length for frame-time statistics. Default 120. */
  windowSize?: number;
  /** Monotonic millisecond clock. Defaults to performance.now, else Date.now. */
  now?: () => number;
  onDiagnostic?: DiagnosticSink;
}

function defaultClock(): () => number {
  const perf = typeof performance !== 'undefined' ? performance : undefined;
  return perf ? () => perf.now() : () => Date.now();
}

interface SpanAcc {
  totalMs: number;
  count: number;
}

interface Budget {
  used: number;
  max: number;
  over: boolean;
}

const EMPTY_FRAME_STATS: FrameStats = { count: 0, minMs: 0, maxMs: 0, meanMs: 0, p95Ms: 0, fps: 0 };

export class MetricsCollector {
  private readonly windowSize: number;
  private readonly now: () => number;
  private readonly diag: DiagnosticSink;

  private readonly frames: number[] = [];
  private frameStart = 0;
  private inFrame = false;

  // Counters accumulate during the current frame, then snapshot on endFrame.
  private cur: { uploadBytes: number; uploadCount: number; drawCalls: number } = {
    uploadBytes: 0,
    uploadCount: 0,
    drawCalls: 0,
  };
  private last: FrameCounters = { uploadBytes: 0, uploadCount: 0, drawCalls: 0 };

  private readonly activeSpans = new Map<string, number>();
  private curSpans = new Map<string, SpanAcc>();
  private lastSpans = new Map<string, SpanAcc>();

  private readonly budgets = new Map<string, Budget>();

  constructor(options: MetricsCollectorOptions = {}) {
    this.windowSize = Math.max(1, options.windowSize ?? 120);
    this.now = options.now ?? defaultClock();
    this.diag = options.onDiagnostic ?? defaultDiagnosticSink;
  }

  /** Start a frame: reset per-frame counters and timestamp the start. */
  beginFrame(): void {
    this.frameStart = this.now();
    this.inFrame = true;
    this.cur = { uploadBytes: 0, uploadCount: 0, drawCalls: 0 };
    this.curSpans = new Map();
    this.activeSpans.clear();
  }

  /** End a frame: record its duration and publish the per-frame counters. */
  endFrame(): number {
    const duration = this.inFrame ? Math.max(0, this.now() - this.frameStart) : 0;
    this.inFrame = false;
    this.frames.push(duration);
    if (this.frames.length > this.windowSize) this.frames.shift();
    this.last = { ...this.cur };
    this.lastSpans = this.curSpans;
    return duration;
  }

  /** Record `bytes` (and `count` items) uploaded to the GPU this frame. */
  recordUpload(bytes: number, count = 1): void {
    this.cur.uploadBytes += bytes;
    this.cur.uploadCount += count;
  }

  /** Record issued draw calls this frame. */
  recordDraws(count: number): void {
    this.cur.drawCalls += count;
  }

  /** Open a named CPU span. A second begin before end restarts the span. */
  begin(label: string): void {
    this.activeSpans.set(label, this.now());
  }

  /** Close a named CPU span and accumulate its duration; returns the duration. */
  end(label: string): number {
    const start = this.activeSpans.get(label);
    if (start === undefined) return 0;
    this.activeSpans.delete(label);
    const dt = Math.max(0, this.now() - start);
    const acc = this.curSpans.get(label) ?? { totalMs: 0, count: 0 };
    acc.totalMs += dt;
    acc.count += 1;
    this.curSpans.set(label, acc);
    return dt;
  }

  /** Time a synchronous section under `label`. */
  measure<T>(label: string, fn: () => T): T {
    this.begin(label);
    try {
      return fn();
    } finally {
      this.end(label);
    }
  }

  /** Declare a budget ceiling (bytes, rays, items...) tracked by name. */
  setBudget(name: string, max: number): void {
    const b = this.budgets.get(name);
    if (b) b.max = max;
    else this.budgets.set(name, { used: 0, max, over: false });
    this.evaluateBudget(name);
  }

  /** Set a budget's absolute usage (e.g. live GPU bytes). */
  setUsage(name: string, used: number): void {
    const b = this.budgets.get(name) ?? { used: 0, max: Infinity, over: false };
    b.used = used;
    this.budgets.set(name, b);
    this.evaluateBudget(name);
  }

  /** Add to a budget's usage (e.g. this frame's upload bytes). */
  charge(name: string, amount: number): void {
    const b = this.budgets.get(name) ?? { used: 0, max: Infinity, over: false };
    b.used += amount;
    this.budgets.set(name, b);
    this.evaluateBudget(name);
  }

  budget(name: string): BudgetState | undefined {
    const b = this.budgets.get(name);
    return b ? { used: b.used, max: b.max, over: b.over } : undefined;
  }

  /** Rolling frame-time statistics over the window. */
  stats(): FrameStats {
    const n = this.frames.length;
    if (n === 0) return EMPTY_FRAME_STATS;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const d of this.frames) {
      sum += d;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    const mean = sum / n;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * (n - 1))]!;
    return { count: n, minMs: min, maxMs: max, meanMs: mean, p95Ms: p95, fps: mean > 0 ? 1000 / mean : 0 };
  }

  /** Serializable report; collected from the device harness on the mobile target. */
  snapshot(): MetricsSnapshot {
    const spans: Record<string, SpanStats> = {};
    for (const [label, acc] of this.lastSpans) {
      spans[label] = { totalMs: acc.totalMs, count: acc.count, meanMs: acc.count > 0 ? acc.totalMs / acc.count : 0 };
    }
    const budgets: Record<string, BudgetState> = {};
    for (const [name, b] of this.budgets) budgets[name] = { used: b.used, max: b.max, over: b.over };
    return { frame: this.stats(), lastFrame: this.last, spans, budgets };
  }

  /** Clear the rolling window and per-frame state; budgets are retained. */
  reset(): void {
    this.frames.length = 0;
    this.cur = { uploadBytes: 0, uploadCount: 0, drawCalls: 0 };
    this.last = { uploadBytes: 0, uploadCount: 0, drawCalls: 0 };
    this.activeSpans.clear();
    this.curSpans = new Map();
    this.lastSpans = new Map();
    this.inFrame = false;
  }

  private evaluateBudget(name: string): void {
    const b = this.budgets.get(name);
    if (!b) return;
    const over = b.used > b.max;
    // Diagnose only on the under -> over transition to avoid per-frame spam.
    if (over && !b.over) {
      this.diag({
        level: 'warning',
        message: `Budget exceeded: ${name} (${b.used} > ${b.max}).`,
      });
    }
    b.over = over;
  }
}
