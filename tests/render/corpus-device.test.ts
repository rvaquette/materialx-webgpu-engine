// T034f: compare the real device GPU outputs (collected by the harness/orchestrator
// into device-report.json) against the CPU oracle from T034a, with per-type
// tolerances. Fails if any node diverges. If no device report is present (empty
// results, e.g. no authorized mobile), the suite skips with a documented reason
// instead of silently passing.
import { describe, it, expect } from 'vitest';
import { NODE_CASES_BY_CATEGORY, CLOSURE_LOBE_CASES, SURFACE_GRAPH_CASES } from '../fixtures/node-cases.ts';
import { isRunnableOnGpu } from '../fixtures/node-ir.ts';
import { nodeTolerance, isEnvelopeCase, closureTargetTolerance, surfaceTargetTolerance, deviceTargetOf } from '../fixtures/tolerances.ts';
import report from './device-report.json' with { type: 'json' };

const runnable = [...NODE_CASES_BY_CATEGORY.values()].filter(isRunnableOnGpu);
const hasDevice = Array.isArray(report.results) && report.results.length > 0;

describe('corpus device GPU vs CPU oracle (T034f)', () => {
  if (!hasDevice) {
    it.skip('skipped: no device report (run scripts/run-device-corpus.mjs on an authorized mobile)', () => {});
    return;
  }

  const byCategory = new Map(report.results.map((r) => [r.category, r]));

  it('reports a Qualcomm/Adreno (or other) adapter and no execution errors', () => {
    expect(report.adapter).toBeTruthy();
    for (const r of report.results) {
      const err = (r as { error?: string }).error;
      expect(err, `${r.category} raised: ${err ?? ''}`).toBeFalsy();
      expect(r.output, `${r.category} produced no output`).toBeTruthy();
    }
  });

  it('covers every runnable corpus node', () => {
    for (const c of runnable) {
      expect(byCategory.has(c.category), `missing device result for ${c.category}`).toBe(true);
    }
  });

  for (const c of runnable) {
    it(`matches the oracle for ${c.category}`, () => {
      const result = byCategory.get(c.category);
      expect(result, `no device result for ${c.category}`).toBeDefined();
      const output = result!.output!;

      if (isEnvelopeCase(c)) {
        // Chaotic fp hash: only an envelope is meaningful across fp32/fp64.
        const [lo, hi] = c.envelope!;        for (let i = 0; i < output.length; i++) {
          expect(Number.isFinite(output[i]!), `${c.category}[${i}] finite`).toBe(true);
          expect(output[i]!, `${c.category}[${i}] >= ${lo}`).toBeGreaterThanOrEqual(lo);
          expect(output[i]!, `${c.category}[${i}] <= ${hi}`).toBeLessThanOrEqual(hi);
        }
        return;
      }

      const expected = c.expected!;
      expect(output.length, `${c.category} width`).toBe(expected.length);
      const tol = nodeTolerance(c);
      for (let i = 0; i < expected.length; i++) {
        expect(Math.abs(output[i]! - expected[i]!), `${c.category}[${i}] gpu=${output[i]} cpu=${expected[i]}`).toBeLessThanOrEqual(tol);
      }
    });
  }
});

// T042: per-lobe closure device execution vs the independent analytic reference.
interface LobeDeviceResult {
  category: string;
  kind: string;
  output: number[] | null;
  error?: string;
}
const lobeResults = Array.isArray((report as { lobes?: unknown }).lobes)
  ? ((report as unknown as { lobes: LobeDeviceResult[] }).lobes)
  : [];
const hasLobes = lobeResults.length > 0;

describe('per-lobe closure device GPU vs analytic reference (T042)', () => {
  if (!hasLobes) {
    it.skip('skipped: device report has no per-lobe section (regenerate with the GPU harness)', () => {});
    return;
  }

  const byCategory = new Map(lobeResults.map((r) => [r.category, r]));
  const target = deviceTargetOf(report.adapter);
  const tol = closureTargetTolerance(report.adapter);

  it(`validates the ${target} target with a ${tol} per-component tolerance and no errors`, () => {
    for (const r of lobeResults) {
      expect(r.error, `${r.category} raised: ${r.error ?? ''}`).toBeFalsy();
      expect(r.output, `${r.category} produced no output`).toBeTruthy();
    }
  });

  it('covers every per-lobe closure case', () => {
    for (const c of CLOSURE_LOBE_CASES) {
      expect(byCategory.has(c.category), `missing device result for ${c.category}`).toBe(true);
    }
  });

  for (const c of CLOSURE_LOBE_CASES) {
    it(`matches the reference oracle for ${c.category}`, () => {
      const result = byCategory.get(c.category);
      expect(result, `no device result for ${c.category}`).toBeDefined();
      const output = result!.output!;
      const expected = c.expected;
      expect(output.length, `${c.category} width`).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(
          Math.abs(output[i]! - expected[i]!),
          `${c.category}[${i}] gpu=${output[i]} ref=${expected[i]}`,
        ).toBeLessThanOrEqual(tol);
      }
    });
  }
});

// T043: surface-graph device execution vs the independent analytic reference. The
// full surface composition (per-lobe closures + composition ops + surface node)
// runs once per family on the device; the read-back is compared to the oracle the
// reference composition produced (tests/fixtures/node-cases.ts SURFACE_GRAPH_CASES).
interface SurfaceDeviceResult {
  category: string;
  family: string;
  output: number[] | null;
  error?: string;
}
const surfaceResults = Array.isArray((report as { surfaces?: unknown }).surfaces)
  ? ((report as unknown as { surfaces: SurfaceDeviceResult[] }).surfaces)
  : [];
const hasSurfaces = surfaceResults.length > 0;

describe('surface-graph device GPU vs analytic reference (T043)', () => {
  if (!hasSurfaces) {
    it.skip('skipped: device report has no surface section (regenerate with the GPU harness)', () => {});
    return;
  }

  const byCategory = new Map(surfaceResults.map((r) => [r.category, r]));
  const target = deviceTargetOf(report.adapter);
  const tol = surfaceTargetTolerance(report.adapter);

  it(`validates the ${target} target with a ${tol} per-component tolerance and no errors`, () => {
    for (const r of surfaceResults) {
      expect(r.error, `${r.category} raised: ${r.error ?? ''}`).toBeFalsy();
      expect(r.output, `${r.category} produced no output`).toBeTruthy();
    }
  });

  it('covers every surface-graph family', () => {
    for (const c of SURFACE_GRAPH_CASES) {
      expect(byCategory.has(c.category), `missing device result for ${c.category}`).toBe(true);
    }
  });

  for (const c of SURFACE_GRAPH_CASES) {
    it(`matches the reference oracle for ${c.category}`, () => {
      const result = byCategory.get(c.category);
      expect(result, `no device result for ${c.category}`).toBeDefined();
      const output = result!.output!;
      const expected = c.expected;
      expect(output.length, `${c.category} width`).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(
          Math.abs(output[i]! - expected[i]!),
          `${c.category}[${i}] gpu=${output[i]} ref=${expected[i]}`,
        ).toBeLessThanOrEqual(tol);
      }
    });
  }
});
