// T056b: intrinsic checks for the Charlie sheen lobe in the reference path tracer
// (same style as T044). No raster oracle has a pdf, so these verify the lobe is
// self-consistent: eval/sample agree, the pdf is the cosine pdf it samples from,
// energy stays bounded, a zero-weight sheen is a no-op in the stack, and the
// layered-closure mapping now yields a sampleable sheen lobe.
import { describe, expect, it } from 'vitest';
import {
  sheenLobe,
  lambertLobe,
  composeLobes,
  hemisphericalReflectance,
  lobeFromLayered,
} from '../../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import type { Vec3 } from '../../../src/scene/transforms.ts';

type V = [number, number, number];
const normalize = (a: V): V => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
};
const WO: V = normalize([0.3, 0.1, 0.9]);
const WHITE: Vec3 = [1, 1, 1];

describe('Charlie sheen lobe (T056b)', () => {
  it('eval and sample agree at the sampled direction', () => {
    const lobe = sheenLobe([0.9, 0.85, 0.8], 0.3);
    const rng = createPcg32(11);
    for (let i = 0; i < 128; i++) {
      const s = lobe.sample(WO, rng);
      if (!s) continue;
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 9);
      expect(e.value[0]).toBeCloseTo(s.value[0], 9);
      expect(e.value[1]).toBeCloseTo(s.value[1], 9);
      expect(e.value[2]).toBeCloseTo(s.value[2], 9);
    }
  });

  it('samples the cosine pdf and vanishes below the horizon', () => {
    const lobe = sheenLobe(WHITE, 0.3);
    const wi: V = normalize([0.1, -0.2, 0.8]);
    expect(lobe.eval(WO, wi).pdf).toBeCloseTo(wi[2] / Math.PI, 12);
    // Transmitted / grazing-away directions carry no sheen.
    expect(lobe.eval(WO, [0.1, -0.2, -0.8]).pdf).toBe(0);
    expect(lobe.eval(WO, [0.1, -0.2, -0.8]).value[0]).toBe(0);
    expect(lobe.eval([0.3, 0.1, -0.9], wi).pdf).toBe(0);
  });

  it('conserves energy (hemispherical reflectance bounded, positive)', () => {
    const lobe = sheenLobe(WHITE, 0.3);
    for (const wo of [WO, normalize([0.6, 0, 0.8]), [0, 0, 1] as V]) {
      const rho = hemisphericalReflectance(lobe, wo, createPcg32(5), 50000);
      for (let k = 0; k < 3; k++) {
        expect(rho[k]).toBeGreaterThan(0.01);
        expect(rho[k]).toBeLessThanOrEqual(1.05);
      }
    }
  });

  it('is a no-op in the stack when its weight is zero', () => {
    const base = lambertLobe([0.6, 0.5, 0.4]);
    const stack = composeLobes([
      { weight: 0, lobe: sheenLobe(WHITE, 0.3) },
      { weight: 1, lobe: base },
    ]);
    for (const wi of [normalize([0.2, 0.1, 0.9]), normalize([-0.4, 0.3, 0.7])] as V[]) {
      const a = stack.eval(WO, wi);
      const b = base.eval(WO, wi);
      expect(a.pdf).toBeCloseTo(b.pdf, 12);
      for (let k = 0; k < 3; k++) expect(a.value[k]).toBeCloseTo(b.value[k]!, 12);
    }
  });

  it('lobeFromLayered now maps a sheen lobe to a sampleable lobe', () => {
    const lobe = lobeFromLayered({ kind: 'sheen', weight: 0.5, color: [0.9, 0.9, 0.8], roughness: 0.3 });
    expect(lobe).not.toBeNull();
    const s = lobe!.sample(WO, createPcg32(3));
    expect(s).not.toBeNull();
    expect(s!.pdf).toBeGreaterThan(0);
  });
});
