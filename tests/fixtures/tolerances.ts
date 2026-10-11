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

// Per-device-target tolerance for the real per-lobe closure comparison (T042).
// The BSDF/EDF/VDF lobes run a GGX/Fresnel microfacet evaluation in fp32 on the
// device and are checked against the fp64 analytic reference
// (src/render/bsdf/reference.ts). The desktop validation GPU (Intel gen-12lp via
// Chrome WebGPU) stays near 2e-3 after a single compute dispatch; the mobile
// target (Qualcomm Adreno 7xx, SM-F731B) is given a slightly wider 4e-3 for the
// extra pow/division rounding on the specular lobes. Each run is validated with
// the bound of the target that actually produced the report (selected by adapter).
export type DeviceTarget = 'local' | 'mobile';

export const CLOSURE_TARGET_TOLERANCE: Readonly<Record<DeviceTarget, number>> = {
  local: 2e-3,
  mobile: 4e-3,
};

/** Classify a device report adapter as the mobile target (Adreno/Mali/ARM) or local. */
export function deviceTargetOf(adapter?: { vendor?: string; architecture?: string }): DeviceTarget {
  const tag = `${adapter?.vendor ?? ''} ${adapter?.architecture ?? ''}`.toLowerCase();
  const mobile = /qualcomm|adreno|mali|\barm\b|apple|powervr/.test(tag);
  return mobile ? 'mobile' : 'local';
}

/** Per-component closure tolerance for the target that produced a device report. */
export function closureTargetTolerance(adapter?: { vendor?: string; architecture?: string }): number {
  return CLOSURE_TARGET_TOLERANCE[deviceTargetOf(adapter)];
}

// Scene-level tolerances by material focus (T035c4). The raster mirror and the
// path-traced reference share one diffuse albedo, so their only systematic
// difference is the raster's flat ambient (0.03) versus the integrator's
// cosine-weighted constant environment (0.05): worst case albedo*0.05 ~= 0.04 on
// the shadow-side terminator for a 0.8 albedo. Base scenes are therefore held
// tight around that bound. Transmission and subsurface are widened on purpose:
// the diffuse reference omits refraction and multiple scattering, so a strict
// bound would only couple the test to that modelling gap rather than to a real
// agreement; the wider bound documents that these focuses are not yet fully
// reproduced.
export interface SceneCompareTolerance {
  readonly maxAbs: number;
  readonly rmse: number;
}

export const SCENE_FOCUS_TOLERANCE: Readonly<Record<string, SceneCompareTolerance>> = {
  base: { maxAbs: 0.05, rmse: 0.035 },
  transmission: { maxAbs: 0.08, rmse: 0.05 },
  subsurface: { maxAbs: 0.08, rmse: 0.05 },
};

export const DEFAULT_SCENE_TOLERANCE: SceneCompareTolerance = { maxAbs: 0.08, rmse: 0.05 };

// A scene may declare several focuses; take the most permissive bound per field
// so no single focus over-constrains the comparison.
export function sceneTolerance(focus: readonly string[]): SceneCompareTolerance {
  let maxAbs = 0;
  let rmse = 0;
  let matched = false;
  for (const f of focus) {
    const t = SCENE_FOCUS_TOLERANCE[f];
    if (!t) continue;
    matched = true;
    maxAbs = Math.max(maxAbs, t.maxAbs);
    rmse = Math.max(rmse, t.rmse);
  }
  return matched ? { maxAbs, rmse } : DEFAULT_SCENE_TOLERANCE;
}
