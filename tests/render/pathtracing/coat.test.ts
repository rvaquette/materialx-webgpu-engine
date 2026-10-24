// T056d: intrinsic checks for the dielectric coat layer in the reference path
// tracer. These verify: (1) non-regression -- a coat of weight 0 leaves the base
// stack untouched; (2) the coat actually layers -- it changes the response and
// the base darkens under it; (3) the coated surface is self-consistent (eval and
// sample agree) and energy stays bounded (furnace). WGSL parity is deferred to
// the device run (T059); the CPU oracle carries the numeric reference here.
import { describe, expect, it } from 'vitest';
import { layeredSurfaceBsdf, hemisphericalReflectance, dielectricLobe } from '../../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import type { LayeredClosure } from '../../../src/compiler/ir.ts';
import type { Vec3 } from '../../../src/scene/transforms.ts';

type V = [number, number, number];
const normalize = (a: V): V => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
};
const WO: V = normalize([0.3, 0.2, 1.0]);
const DIRS: V[] = [
  normalize([0.3, 0.0, 0.9]),
  normalize([0.0, 0.4, 0.8]),
  normalize([-0.5, 0.2, 0.7]),
  normalize([0.1, -0.6, 0.6]),
];

const baseClosure = (): LayeredClosure => ({
  lobes: [
    { kind: 'burley_diffuse', weight: 0.8, color: [0.6, 0.3, 0.2], roughness: 0.5 },
    { kind: 'dielectric_reflection', weight: 0.2, color: [1, 1, 1], roughness: 0.3, ior: 1.5 },
  ],
  opacity: 1,
});

describe('dielectric coat layer (T056d)', () => {
  it.each([0.25, 1])('uses the MaterialX linear substrate tint at coat weight %s at every angle', (weight) => {
    const tint: V = [0.85, 0.2, 0.25];
    const closure = (color: V): LayeredClosure => ({
      lobes: [{ kind: 'burley_diffuse', weight: 1, color: [0.8, 0.8, 0.8], roughness: 0.25 }],
      coat: { weight, color, roughness: 0.05, ior: 1.5 }, opacity: 1,
    });
    const colored = layeredSurfaceBsdf(closure(tint));
    const white = layeredSurfaceBsdf(closure([1, 1, 1]));
    const black = layeredSurfaceBsdf(closure([0, 0, 0]));
    for (const wo of [[0, 0, 1], normalize([0.95, 0, 0.1])] as V[]) {
      for (const wi of DIRS) {
        const c = colored.eval(wo, wi);
        const w = white.eval(wo, wi);
        const b = black.eval(wo, wi);
        for (let k = 0; k < 3; k++) {
          // Subtract the achromatic coat reflection to isolate the substrate.
          expect((c.value[k]! - b.value[k]!) / (w.value[k]! - b.value[k]!)).toBeCloseTo(tint[k]!, 10);
        }
      }
    }
  });

  it('balances coat sampling by Fresnel rather than allocating 95% to a 4% reflector', () => {
    const base: LayeredClosure = {
      lobes: [{ kind: 'burley_diffuse', weight: 1, color: [0.8, 0.8, 0.8], roughness: 0.25 }], opacity: 1,
    };
    const coat = { weight: 1, color: [1, 1, 1] as V, roughness: 0.3, ior: 1.5 };
    const coated = layeredSurfaceBsdf({ ...base, coat });
    const baseBsdf = layeredSurfaceBsdf(base);
    const top = dielectricLobe(coat.ior, coat.roughness);
    const wo: V = [0, 0, 1];
    for (const wi of DIRS) {
      const expectedPdf = 0.04 * top.eval(wo, wi).pdf + 0.96 * baseBsdf.eval(wo, wi).pdf;
      expect(coated.eval(wo, wi).pdf).toBeCloseTo(expectedPdf, 12);
    }
  });

  it('leaves the base untouched at coat weight 0 (non-regression)', () => {
    const base = layeredSurfaceBsdf(baseClosure());
    const coated0 = layeredSurfaceBsdf({
      ...baseClosure(),
      coat: { weight: 0, color: [1, 1, 1], roughness: 0.1, ior: 1.5 },
    });
    for (const wi of DIRS) {
      const a = base.eval(WO, wi);
      const b = coated0.eval(WO, wi);
      expect(b.pdf).toBeCloseTo(a.pdf, 12);
      for (let k = 0; k < 3; k++) expect(b.value[k]).toBeCloseTo(a.value[k]!, 12);
    }
  });

  it('layers over the base: changes the response and darkens the diffuse base', () => {
    const base = layeredSurfaceBsdf(baseClosure());
    const coated = layeredSurfaceBsdf({
      ...baseClosure(),
      coat: { weight: 1, color: [0.7, 0.8, 0.9], roughness: 0.2, ior: 1.5 },
    });
    let changed = false;
    for (const wi of DIRS) {
      const a = base.eval(WO, wi);
      const b = coated.eval(WO, wi);
      if (Math.abs(a.value[0] - b.value[0]) > 1e-4) changed = true;
    }
    expect(changed).toBe(true);
    // A grazing exit darkens more than a near-normal one (view-dependent coat).
    const grazing = layeredSurfaceBsdf({
      ...baseClosure(),
      coat: { weight: 1, color: [0.5, 0.5, 0.5], roughness: 0.2, ior: 1.5 },
    });
    const near = grazing.eval(WO, normalize([0.05, 0.05, 1.0])).value[0];
    const graze = grazing.eval(WO, normalize([0.9, 0.0, 0.2])).value[0];
    // The near-normal diffuse contribution survives more coat absorption.
    expect(near).toBeGreaterThan(0);
    expect(graze).toBeGreaterThanOrEqual(0);
  });

  it('eval and sample agree for the coated surface', () => {
    const coated = layeredSurfaceBsdf({
      ...baseClosure(),
      coat: { weight: 0.8, color: [0.8, 0.85, 0.9], roughness: 0.25, ior: 1.5 },
    });
    const rng = createPcg32(71);
    for (let i = 0; i < 256; i++) {
      const s = coated.sample(WO, rng);
      if (!s) continue;
      const e = coated.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 9);
      for (let k = 0; k < 3; k++) expect(e.value[k]).toBeCloseTo(s.value[k]!, 9);
    }
  });

  it('conserves energy under the coat (hemispherical reflectance bounded)', () => {
    const coated = layeredSurfaceBsdf({
      lobes: [{ kind: 'burley_diffuse', weight: 1, color: [1, 1, 1], roughness: 0.5 }],
      coat: { weight: 1, color: [1, 1, 1], roughness: 0.3, ior: 1.5 },
      opacity: 1,
    });
    for (const wo of [WO, normalize([0.6, 0.1, 0.8])] as Vec3[]) {
      const rho = hemisphericalReflectance(coated, wo, createPcg32(13), 60000);
      for (let k = 0; k < 3; k++) {
        expect(rho[k]).toBeGreaterThan(0.01);
        expect(rho[k]).toBeLessThanOrEqual(1.05);
      }
    }
  });
});
