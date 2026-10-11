// T035a: single declarative source of truth for conformance tolerances. The
// per-node device vs CPU-oracle comparison (T034f) and the scene-level
// comparisons (T035c/d) read their thresholds here instead of hard-coding them,
// so tightening or loosening a bound happens in exactly one place.
import type { ExecClass, NodeCase } from './node-cases.ts';

// Absolute per-component tolerance by execution class. Textures pass through an
// 8-bit unorm texel, so worst-case quantization is 1/255; pure expression and
// closure leaves stay near fp32 ulp after a single compute dispatch. The
// non-runnable classes (graph/implicit/multi) share the expression bound for
// completeness; they are never compared against a GPU readback.
export const NODE_TOLERANCE: Readonly<Record<ExecClass, number>> = {
  expr: 2e-3,
  closure: 2e-3,
  texture: 1 / 255 + 1e-4,
  graph: 2e-3,
  implicit: 2e-3,
  multi: 2e-3,
};

// Fallback for an exec class not present in NODE_TOLERANCE (defensive only).
export const DEFAULT_NODE_TOLERANCE = 2e-3;

export function nodeTolerance(execOrCase: ExecClass | NodeCase): number {
  const exec = typeof execOrCase === 'string' ? execOrCase : execOrCase.exec;
  return NODE_TOLERANCE[exec] ?? DEFAULT_NODE_TOLERANCE;
}

// A node is validated by envelope (finite + within [lo,hi]) instead of exact
// match when its lowering is a chaotic fp hash (fract(sin(x)*k)): fp32 GPU and
// fp64 CPU cannot agree bit-for-bit. The envelope itself lives on the case.
export function isEnvelopeCase(c: NodeCase): boolean {
  return c.reproducible === false;
}
