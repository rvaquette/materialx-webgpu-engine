import { describe, expect, it } from 'vitest';

import { evalWorld, layeredSurfaceBsdf } from '../../../src/render/pathtracing/bsdf.ts';
import {
  defaultLighting,
  referenceClosureDirect,
  type ShadingGeometry,
} from '../../../src/render/bsdf/reference.ts';
import { BXDF_FAMILY_CASES } from '../../fixtures/bxdf-families.ts';
import {
  BXDF_FAMILY_TARGET_TOLERANCE,
  bxdfFamilyTargetTolerance,
} from '../../fixtures/tolerances.ts';

// Three shading frames reused from the surface parity corpus: head-on, an
// oblique view and a tilted normal, so view-dependent lobes (specular, coat,
// thin film, anisotropy) are actually exercised.
const GEOMS: readonly ShadingGeometry[] = [
  { normal: [0, 0, 1], view: [0, 0, 1] },
  { normal: [0, 0, 1], view: [0.6, 0, 0.8] },
  { normal: [0, 1, 0], view: [0, 0.5, 0.8660254] },
];

const LIGHTING = defaultLighting();

describe('bxdf family oracle corpus (T059a)', () => {
  it('covers all five nodedef families plus a lama assembly and a procedural nodegraph', () => {
    const families = new Set(BXDF_FAMILY_CASES.map((c) => c.family));
    expect(families).toEqual(
      new Set([
        'standard_surface',
        'open_pbr_surface',
        'disney_principled',
        'gltf_pbr',
        'UsdPreviewSurface',
        'lama_assembly',
        'procedural_nodegraph',
      ]),
    );
  });

  for (const testCase of BXDF_FAMILY_CASES) {
    describe(testCase.name, () => {
      it('produces finite, non-negative radiance across every shading frame', () => {
        for (const geom of GEOMS) {
          const result = referenceClosureDirect(testCase.closure, geom, LIGHTING);
          expect(result.weight).toBeGreaterThanOrEqual(0);
          expect(result.weight).toBeLessThanOrEqual(1);
          for (const channel of result.color) {
            expect(Number.isFinite(channel)).toBe(true);
            expect(channel).toBeGreaterThanOrEqual(0);
          }
        }
      });

      it('carries the closure slot for each advertised advanced feature', () => {
        const { closure, features } = testCase;
        for (const feature of features) {
          switch (feature) {
            case 'coat':
              expect(closure.coat).toBeDefined();
              expect(closure.coat?.weight ?? 0).toBeGreaterThan(0);
              break;
            case 'sheen':
              expect(closure.sheen).toBeDefined();
              expect(closure.sheen?.weight ?? 0).toBeGreaterThan(0);
              break;
            case 'fuzz':
              expect(closure.fuzz).toBeDefined();
              expect(closure.fuzz?.weight ?? 0).toBeGreaterThan(0);
              break;
            case 'thin_film':
              expect(closure.thinFilm).toBeDefined();
              expect(closure.thinFilm?.weight ?? 0).toBeGreaterThan(0);
              break;
            case 'emission':
              expect(closure.emission).toBeDefined();
              break;
            case 'anisotropy':
              expect(closure.lobes.some((lobe) => (lobe.anisotropy ?? 0) > 0)).toBe(true);
              break;
            case 'subsurface':
              expect(
                closure.lobes.some((lobe) => lobe.kind === 'subsurface' && lobe.weight > 0),
              ).toBe(true);
              break;
            default:
              break;
          }
        }
      });

      it('declares a per-family device tolerance with mobile no tighter than local', () => {
        const tol = BXDF_FAMILY_TARGET_TOLERANCE[testCase.family];
        expect(tol).toBeDefined();
        expect(tol.local).toBeGreaterThan(0);
        expect(tol.mobile).toBeGreaterThanOrEqual(tol.local);
      });
    });
  }

  it('matches the path-tracer closure evaluator it mirrors (single-light tie)', () => {
    // referenceClosureDirect must reproduce the exact direct term the shared IR
    // closure evaluator yields; recompute the single-light contribution by hand.
    const testCase = BXDF_FAMILY_CASES[0]!;
    const geom: ShadingGeometry = { normal: [0, 0, 1], view: [0.6, 0, 0.8] };
    const bsdf = layeredSurfaceBsdf(testCase.closure);
    const light = LIGHTING.lights[0]!;
    const len = Math.hypot(...light.direction);
    const toLight: readonly [number, number, number] = [
      -light.direction[0] / len,
      -light.direction[1] / len,
      -light.direction[2] / len,
    ];
    const n: readonly [number, number, number] = [0, 0, 1];
    const v = ((): readonly [number, number, number] => {
      const l = Math.hypot(geom.view[0], geom.view[1], geom.view[2]);
      return [geom.view[0] / l, geom.view[1] / l, geom.view[2] / l];
    })();
    const ev = evalWorld(bsdf, n, v, toLight);
    const cosL = Math.max(n[0] * toLight[0] + n[1] * toLight[1] + n[2] * toLight[2], 0);
    const directOnly = ev.value.map((c, i) => c * (light.color[i] ?? 0) * light.intensity * cosL);

    const envOnly = { environment: LIGHTING.environment, lights: [] as typeof LIGHTING.lights };
    const full = referenceClosureDirect(testCase.closure, geom, { ...LIGHTING, lights: [light] });
    const env = referenceClosureDirect(testCase.closure, geom, envOnly);
    for (let i = 0; i < 3; i++) {
      expect((full.color[i] ?? 0) - (env.color[i] ?? 0)).toBeCloseTo(directOnly[i] ?? 0, 6);
    }
  });

  it('exposes a target helper that resolves local vs mobile by adapter', () => {
    expect(bxdfFamilyTargetTolerance('standard_surface')).toBe(
      BXDF_FAMILY_TARGET_TOLERANCE.standard_surface.local,
    );
    expect(
      bxdfFamilyTargetTolerance('standard_surface', { vendor: 'Qualcomm', architecture: 'Adreno 7xx' }),
    ).toBe(BXDF_FAMILY_TARGET_TOLERANCE.standard_surface.mobile);
  });
});
