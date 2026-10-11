// T035b: reusable image/signal comparison for backend conformance. Scene renders
// are flat linear buffers (width*height*channels) and per-node runs are short
// vectors; both reduce to the same per-component metrics here. The scene tests
// (T035c/d) feed buffers plus a tolerance and get a pass/fail verdict with the
// exact metric that broke, so a regression names the offending channel rather
// than just failing an opaque assertion.

export interface DiffMetrics {
  readonly count: number;
  readonly maxAbsDiff: number;
  readonly meanAbsDiff: number;
  readonly rmse: number;
  // Max over components of |a-b| / max(|a|,|b|,eps); eps avoids div-by-zero on black.
  readonly maxRelDiff: number;
}

export interface CompareTolerance {
  readonly maxAbs?: number;
  readonly rmse?: number;
  readonly maxRel?: number;
}

export interface CompareResult {
  readonly pass: boolean;
  readonly metrics: DiffMetrics;
  readonly violations: readonly string[];
}

export interface ImageCompareResult {
  readonly pass: boolean;
  readonly overall: DiffMetrics;
  readonly perChannel: readonly DiffMetrics[];
  readonly violations: readonly string[];
}

const REL_EPS = 1e-6;

export function diffMetrics(a: ArrayLike<number>, b: ArrayLike<number>): DiffMetrics {
  if (a.length !== b.length) {
    throw new Error(`length mismatch: ${a.length} vs ${b.length}`);
  }
  const n = a.length;
  let maxAbs = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let maxRel = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) {
      throw new Error(`non-finite sample at ${i}: a=${av} b=${bv}`);
    }
    const d = Math.abs(av - bv);
    maxAbs = Math.max(maxAbs, d);
    sumAbs += d;
    sumSq += d * d;
    const denom = Math.max(Math.abs(av), Math.abs(bv), REL_EPS);
    maxRel = Math.max(maxRel, d / denom);
  }
  return {
    count: n,
    maxAbsDiff: maxAbs,
    meanAbsDiff: n === 0 ? 0 : sumAbs / n,
    rmse: n === 0 ? 0 : Math.sqrt(sumSq / n),
    maxRelDiff: maxRel,
  };
}

function checkTolerance(metrics: DiffMetrics, tol: CompareTolerance, label: string): string[] {
  const out: string[] = [];
  if (tol.maxAbs !== undefined && metrics.maxAbsDiff > tol.maxAbs) {
    out.push(`${label}maxAbsDiff ${metrics.maxAbsDiff} > ${tol.maxAbs}`);
  }
  if (tol.rmse !== undefined && metrics.rmse > tol.rmse) {
    out.push(`${label}rmse ${metrics.rmse} > ${tol.rmse}`);
  }
  if (tol.maxRel !== undefined && metrics.maxRelDiff > tol.maxRel) {
    out.push(`${label}maxRelDiff ${metrics.maxRelDiff} > ${tol.maxRel}`);
  }
  return out;
}

export function compareSignals(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tol: CompareTolerance,
): CompareResult {
  const metrics = diffMetrics(a, b);
  const violations = checkTolerance(metrics, tol, '');
  return { pass: violations.length === 0, metrics, violations };
}

export function compareImages(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  channels: number,
  tol: CompareTolerance,
): ImageCompareResult {
  if (a.length !== b.length) {
    throw new Error(`length mismatch: ${a.length} vs ${b.length}`);
  }
  if (!Number.isInteger(channels) || channels <= 0 || a.length % channels !== 0) {
    throw new Error(`length ${a.length} is not a multiple of ${channels} channels`);
  }
  const overall = diffMetrics(a, b);
  const perChannel: DiffMetrics[] = [];
  const violations: string[] = [];
  for (let c = 0; c < channels; c++) {
    const ca: number[] = [];
    const cb: number[] = [];
    for (let i = c; i < a.length; i += channels) {
      ca.push(a[i]!);
      cb.push(b[i]!);
    }
    const m = diffMetrics(ca, cb);
    perChannel.push(m);
    violations.push(...checkTolerance(m, tol, `channel ${c} `));
  }
  return { pass: violations.length === 0, overall, perChannel, violations };
}
