// T059c: compare the GPU shading of every T059a bxdf-family case -- rendered on
// the device in BOTH backends through the shared compiler output (collected by
// bxdf-device.harness into bxdf-device-report.json) -- against the independent CPU
// oracle referenceClosureDirect (src/render/bsdf/reference.ts). The device geoms
// and lighting are shared with the harness (bxdf-families.ts), so any difference
// is pure GPU fp32 vs CPU fp64 arithmetic of the shared mx_closure_eval closure.
// The oracle never parses the WGSL, so this is a non-circular device check of the
// full BxDF coverage; the raster (max-cos) and path-tracer (abs-cos) direct terms
// are each checked against the oracle and against one another at per-family
// tolerances. If no device report is present (empty cases, e.g. no authorized GPU),
// the suite skips with a documented reason instead of passing silently. Run it with
// npm run test:local-bxdf (desktop GPU) or npm run test:bxdf-device (mobile, T059d).
import { describe, it, expect } from 'vitest';
import report from './bxdf-device-report.json' with { type: 'json' };
import type { BxdfDeviceReport } from './bxdf-device.harness.ts';
import {
  referenceClosureDirect,
  type ReferenceLighting,
  type ShadingGeometry,
} from '../../src/render/bsdf/reference.ts';
import {
  BXDF_FAMILY_CASES,
  BXDF_DEVICE_GEOMS,
  BXDF_DEVICE_LIGHT,
} from '../fixtures/bxdf-families.ts';
import { bxdfFamilyTargetTolerance, type BxdfFamilyKey } from '../fixtures/tolerances.ts';
import { compareSignals } from './compare.ts';

const dev = report as unknown as BxdfDeviceReport;
const hasDevice = Array.isArray(dev.cases) && dev.cases.length > 0 && dev.geomCount > 0;

const lighting: ReferenceLighting = {
  environment: [
    BXDF_DEVICE_LIGHT.environment[0],
    BXDF_DEVICE_LIGHT.environment[1],
    BXDF_DEVICE_LIGHT.environment[2],
  ],
  lights: [
    {
      direction: [
        BXDF_DEVICE_LIGHT.direction[0],
        BXDF_DEVICE_LIGHT.direction[1],
        BXDF_DEVICE_LIGHT.direction[2],
      ],
      color: [BXDF_DEVICE_LIGHT.color[0], BXDF_DEVICE_LIGHT.color[1], BXDF_DEVICE_LIGHT.color[2]],
      intensity: BXDF_DEVICE_LIGHT.intensity,
    },
  ],
};

/** CPU oracle radiance for one case, flat rgb over the shared device geoms. */
function oracleFor(closure: (typeof BXDF_FAMILY_CASES)[number]['closure']): number[] {
  const out: number[] = [];
  for (const g of BXDF_DEVICE_GEOMS) {
    const geom: ShadingGeometry = { normal: g.normal, view: g.view };
    const c = referenceClosureDirect(closure, geom, lighting).color;
    out.push(c[0], c[1], c[2]);
  }
  return out;
}

describe('bxdf family device GPU vs analytic oracle (T059c)', () => {
  if (!hasDevice) {
    it.skip('skipped: no device report (run npm run test:local-bxdf on an authorized GPU)', () => {});
    return;
  }

  const byName = new Map(dev.cases.map((c) => [c.name, c]));

  it('reports an adapter and the shared geom count', () => {
    expect(dev.adapter).toBeTruthy();
    expect(dev.geomCount).toBe(BXDF_DEVICE_GEOMS.length);
  });

  it('covers every bxdf-family case', () => {
    const expected = BXDF_FAMILY_CASES.map((c) => c.name).sort();
    expect(dev.cases.map((c) => c.name).sort()).toEqual(expected);
  });

  for (const testCase of BXDF_FAMILY_CASES) {
    const tol = bxdfFamilyTargetTolerance(testCase.family as BxdfFamilyKey, dev.adapter);

    it(`${testCase.name}: both backends match the oracle within the per-family tolerance`, () => {
      const result = byName.get(testCase.name);
      expect(result, `no device result for ${testCase.name}`).toBeDefined();
      const oracle = oracleFor(testCase.closure);
      expect(result!.raster.length).toBe(oracle.length);
      expect(result!.pathtracing.length).toBe(oracle.length);

      const raster = compareSignals(result!.raster, oracle, { maxAbs: tol });
      expect(raster.violations, `raster ${testCase.name}`).toEqual([]);
      const pt = compareSignals(result!.pathtracing, oracle, { maxAbs: tol });
      expect(pt.violations, `pathtracing ${testCase.name}`).toEqual([]);

      // The two backends shade the same closure above the surface -> they agree.
      const agree = compareSignals(result!.raster, result!.pathtracing, { maxAbs: tol });
      expect(agree.violations, `raster vs pathtracing ${testCase.name}`).toEqual([]);
    });
  }
});
