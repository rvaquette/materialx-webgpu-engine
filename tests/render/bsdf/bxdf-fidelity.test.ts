// T059b: fidelity + source-parity proof for the full BxDF coverage, on the CPU
// oracle (Node). Two claims, both over the T059a corpus (bxdf-families.ts):
//
// 1. FIDELITY -- a material with visible coat / sheen / fuzz / thin film /
//    anisotropy / subsurface / emission differs NOTABLY from the pre-P10 seven-
//    parameter render. We compare the faithful closure oracle referenceClosureDirect
//    (reference.ts, the shared mx_closure_eval mirror) against evaluateSurface on
//    the canonical seven-parameter reduction (parsedSurfaceToCanonical) -- the
//    literal "prior render" -- and, to isolate the advanced lobes from the
//    mix/layer-vs-additive model change, against the SAME closure with its advanced
//    slots stripped. Both deltas are far above the per-family device tolerance.
//
// 2. SOURCE PARITY -- both backends shade the SAME lowered IR. The path tracer's
//    flat material record (material-record.ts) round-trips the full advanced
//    closure (coat/sheen/fuzz/thin film/anisotropy/emission and a transmission
//    lobe) with every slot preserved, so the megakernel carries exactly the rich
//    closure the raster forward fragment lowers -- unlike the legacy scene packing
//    canonicalSurfaceToLayered(parsedSurfaceToCanonical) which drops those slots.
//    Fed that one closure, the raster delta-light mirror and the path-tracer delta-
//    light mirror (both evalWorld . layeredSurfaceBsdf == the shared mx_closure_eval)
//    produce the same radiance. The device run that feeds the rich closure to both
//    backends end-to-end is T059c.

import { describe, it, expect } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import type { LayeredBsdfLobe, LayeredClosure } from '../../../src/compiler/ir.ts';
import { canonicalSurfaceToLayered } from '../../../src/compiler/ir.ts';
import {
  evaluateSurface,
  referenceClosureDirect,
  defaultLighting,
  type CanonicalSurfaceParams,
  type ShadingGeometry,
} from '../../../src/render/bsdf/reference.ts';
import { layeredSurfaceBsdf, evalWorld } from '../../../src/render/pathtracing/bsdf.ts';
import {
  packLayeredMaterial,
  unpackLayeredMaterial,
} from '../../../src/render/pathtracing/material-record.ts';
import {
  parsedInputsToLayered,
  parsedSurfaceToCanonical,
} from '../../../src/materialx/surface-from-inputs.ts';
import { BXDF_FAMILY_CASES } from '../../fixtures/bxdf-families.ts';
import { BXDF_FAMILY_TARGET_TOLERANCE, nodeTolerance } from '../../fixtures/tolerances.ts';

const LIGHTING = defaultLighting();
const GEOMS: readonly ShadingGeometry[] = [
  { normal: [0, 0, 1], view: [0, 0, 1] },
  { normal: [0, 0, 1], view: [0.6, 0, 0.8] },
  { normal: [0, 1, 0], view: [0, 0.5, 0.8660254] },
];

// Shared delta-light probe (same geometry the raster/PT parity test uses): a
// directional light above the surface so max-cos (raster) and abs-cos (PT) agree.
const N: Vec3 = [0, 0, 1];
const WO = normalize([0.3, 0.2, 1]);
const TO_LIGHT = normalize([-0.4, 0.1, 1]);
const RADIANCE: Vec3 = [3, 2.85, 2.7];
const CLOSURE_TOL = nodeTolerance('closure');

function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mulv = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/** Raster forward delta-light term (ir-forward.ts): max-clamped cosine. */
function rasterDelta(closure: LayeredClosure): Vec3 {
  const ev = evalWorld(layeredSurfaceBsdf(closure), N, WO, TO_LIGHT);
  return mulv(ev.value, scale(RADIANCE, Math.max(dot(N, TO_LIGHT), 0)));
}
/** Path-tracer megakernel delta-light term (compute.ts): abs cosine. */
function ptDelta(closure: LayeredClosure): Vec3 {
  const ev = evalWorld(layeredSurfaceBsdf(closure), N, WO, TO_LIGHT);
  return mulv(ev.value, scale(RADIANCE, Math.abs(dot(N, TO_LIGHT))));
}
function maxAbsDiff(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** The base-only closure: advanced layers removed, lobe anisotropy/rotation dropped. */
function stripAdvanced(c: LayeredClosure): LayeredClosure {
  const lobes = c.lobes.map((l): LayeredBsdfLobe => {
    const out: LayeredBsdfLobe = { kind: l.kind, weight: l.weight, color: l.color };
    if (l.color90 !== undefined) out.color90 = l.color90;
    if (l.roughness !== undefined) out.roughness = l.roughness;
    if (l.ior !== undefined) out.ior = l.ior;
    if (l.extinction !== undefined) out.extinction = l.extinction;
    if (l.thinWalled !== undefined) out.thinWalled = l.thinWalled;
    return out; // anisotropy + rotation intentionally dropped
  });
  return { lobes, opacity: c.opacity };
}

/** Which closure slots a case advertises, as present/absent booleans. */
function slotPresence(c: LayeredClosure): Record<string, boolean> {
  return {
    coat: c.coat !== undefined,
    sheen: c.sheen !== undefined,
    fuzz: c.fuzz !== undefined,
    thinFilm: c.thinFilm !== undefined,
    emission: c.emission !== undefined,
    anisotropy: c.lobes.some((l) => (l.anisotropy ?? 0) > 0),
  };
}

const ADVANCED_CASES = BXDF_FAMILY_CASES.filter((c) => c.features.length > 0);
const FAMILY_CASES = BXDF_FAMILY_CASES.filter((c) => c.spec !== undefined);

describe('bxdf fidelity vs the seven-parameter render (T059b)', () => {
  for (const testCase of ADVANCED_CASES) {
    const minDelta = Math.max(1e-2, 4 * BXDF_FAMILY_TARGET_TOLERANCE[testCase.family].local);

    it(`${testCase.name}: advanced lobes shift the render well beyond tolerance`, () => {
      // Full faithful closure vs the SAME closure with advanced slots stripped,
      // through the identical additive evaluator -- isolates the advanced lobes.
      let widest = 0;
      for (const geom of GEOMS) {
        const full = referenceClosureDirect(testCase.closure, geom, LIGHTING).color;
        const base = referenceClosureDirect(stripAdvanced(testCase.closure), geom, LIGHTING).color;
        widest = Math.max(widest, maxAbsDiff(full, base));
      }
      expect(widest).toBeGreaterThan(minDelta);
    });
  }

  for (const testCase of FAMILY_CASES) {
    const minDelta = Math.max(1e-2, 4 * BXDF_FAMILY_TARGET_TOLERANCE[testCase.family].local);

    it(`${testCase.name}: differs notably from its prior seven-parameter render`, () => {
      const canonical = parsedSurfaceToCanonical(testCase.spec!) as CanonicalSurfaceParams;
      let widest = 0;
      for (const geom of GEOMS) {
        const p10 = referenceClosureDirect(testCase.closure, geom, LIGHTING).color;
        const legacy = evaluateSurface(canonical, geom, LIGHTING).color;
        widest = Math.max(widest, maxAbsDiff(p10, legacy));
      }
      expect(widest).toBeGreaterThan(minDelta);
    });
  }
});

describe('bxdf source parity -- both backends shade the same IR (T059b)', () => {
  for (const testCase of BXDF_FAMILY_CASES) {
    it(`${testCase.name}: the path-tracer material record preserves every advanced slot`, () => {
      const rich = testCase.closure;
      const roundTripped = unpackLayeredMaterial(packLayeredMaterial(rich));
      // Every slot the raster closure carries survives the path-tracer record.
      expect(slotPresence(roundTripped)).toEqual(slotPresence(rich));
      expect(roundTripped.lobes.length).toBe(rich.lobes.length);
    });

    it(`${testCase.name}: raster and path-tracer delta terms agree on the shared closure`, () => {
      const rich = testCase.closure;
      const roundTripped = unpackLayeredMaterial(packLayeredMaterial(rich));
      // Same closure, same shared stack -> same radiance from both backends.
      expect(maxAbsDiff(rasterDelta(rich), ptDelta(rich))).toBeLessThanOrEqual(CLOSURE_TOL);
      // The f32 path-tracer record reproduces the raster term within device precision.
      expect(maxAbsDiff(rasterDelta(rich), rasterDelta(roundTripped))).toBeLessThanOrEqual(5e-3);
    });
  }

  for (const testCase of FAMILY_CASES) {
    it(`${testCase.name}: the legacy seven-parameter scene packing drops the advanced slots`, () => {
      const rich = parsedInputsToLayered(testCase.spec!);
      expect(rich).not.toBeNull();
      const legacy = canonicalSurfaceToLayered(parsedSurfaceToCanonical(testCase.spec!));
      const richSlots = slotPresence(rich!);
      const legacySlots = slotPresence(legacy);
      // At least one advanced slot the rich closure carries is absent from the
      // seven-parameter packing: the gap T059 closes by sharing the rich IR.
      const advertised = Object.keys(richSlots).filter((k) => richSlots[k]);
      expect(advertised.length).toBeGreaterThan(0);
      expect(advertised.some((k) => !legacySlots[k])).toBe(true);
    });
  }

  it('a transmission lobe round-trips through the shared material record', () => {
    // Transmission rides the same flat record (dielectric_transmission), so the
    // path tracer carries it identically to the raster lowering.
    const glass: LayeredClosure = {
      lobes: [
        { kind: 'dielectric_reflection', weight: 1, color: [1, 1, 1], roughness: 0.05, ior: 1.5 },
        { kind: 'dielectric_transmission', weight: 1, color: [0.8, 0.9, 1], roughness: 0.05, ior: 1.5 },
      ],
      opacity: 1,
    };
    const rt = unpackLayeredMaterial(packLayeredMaterial(glass));
    expect(rt.lobes.map((l) => l.kind)).toEqual(['dielectric_reflection', 'dielectric_transmission']);
    expect(rt.lobes[1]?.color?.[2]).toBeCloseTo(1, 5);
  });
});
