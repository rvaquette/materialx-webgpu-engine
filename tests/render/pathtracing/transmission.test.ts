// T056e: intrinsic checks for the dielectric transmission (BTDF) lobes in the
// reference path tracer. These verify: (1) a refractive glass lobe and a
// thin-walled lobe that are self-consistent (eval and sample agree) and
// importance-sample into the far hemisphere; (2) Snell refraction bends the
// transmitted ray toward the normal while the thin-walled variant mirrors it, so
// the two differ at oblique incidence and coincide at normal incidence;
// (3) energy stays bounded -- reflection + transmission <= 1 with the 1/eta^2
// radiance compression; (4) non-regression -- a transmission lobe of weight 0
// leaves the opaque base stack untouched. WGSL parity is deferred to the device
// run (T059); the CPU oracle carries the numeric reference here.
import { describe, expect, it } from 'vitest';
import {
  dielectricTransmissionLobe,
  thinWalledTransmissionLobe,
  dielectricLobe,
  dielectricF0,
  fresnelDielectric,
  layeredSurfaceBsdf,
  hemisphericalReflectance,
} from '../../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import type { LayeredClosure } from '../../../src/compiler/ir.ts';
import type { Vec3 } from '../../../src/scene/transforms.ts';

type V = [number, number, number];
const normalize = (a: V): V => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
};
const WO: V = normalize([0.3, 0.2, 1.0]);
const IOR = 1.5;

describe('dielectric transmission BTDF (T056e)', () => {
  it('dielectric Fresnel matches the achromatic F0 at normal incidence and hits TIR', () => {
    expect(fresnelDielectric(1, IOR)).toBeCloseTo(dielectricF0(IOR), 9);
    // Dense-to-light (eta < 1) beyond the critical angle is total internal reflection.
    const critical = Math.asin(1 / IOR);
    const cosBeyond = Math.cos(critical + 0.1);
    expect(fresnelDielectric(cosBeyond, 1 / IOR)).toBe(1);
  });

  it('refractive lobe samples into the far hemisphere and eval agrees with sample', () => {
    const lobe = dielectricTransmissionLobe([0.9, 0.95, 1.0], 0.2, IOR);
    const rng = createPcg32(17);
    let hits = 0;
    for (let i = 0; i < 512; i++) {
      const s = lobe.sample(WO, rng);
      if (!s) continue;
      hits++;
      expect(s.wi[2]).toBeLessThan(0); // transmitted: opposite hemisphere
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 9);
      for (let k = 0; k < 3; k++) expect(e.value[k]).toBeCloseTo(s.value[k]!, 9);
    }
    expect(hits).toBeGreaterThan(400);
  });

  it('thin-walled lobe samples into the far hemisphere and eval agrees with sample', () => {
    const lobe = thinWalledTransmissionLobe([1, 1, 1], 0.15, IOR);
    const rng = createPcg32(29);
    let hits = 0;
    for (let i = 0; i < 512; i++) {
      const s = lobe.sample(WO, rng);
      if (!s) continue;
      hits++;
      expect(s.wi[2]).toBeLessThan(0);
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 9);
      for (let k = 0; k < 3; k++) expect(e.value[k]).toBeCloseTo(s.value[k]!, 9);
    }
    expect(hits).toBeGreaterThan(400);
  });

  it('refraction bends toward the normal; thin-walled mirrors (differ at an angle)', () => {
    const oblique = normalize([0.6, 0.0, 0.8]); // cos = 0.8
    const refr = dielectricTransmissionLobe([1, 1, 1], 0.05, IOR);
    const thin = thinWalledTransmissionLobe([1, 1, 1], 0.05, IOR);
    const meanAbsZ = (lobe: ReturnType<typeof dielectricTransmissionLobe>, seed: number): number => {
      const rng = createPcg32(seed);
      let acc = 0;
      let n = 0;
      for (let i = 0; i < 4000; i++) {
        const s = lobe.sample(oblique, rng);
        if (!s) continue;
        acc += Math.abs(s.wi[2]);
        n++;
      }
      return n > 0 ? acc / n : 0;
    };
    // Snell into the denser medium compresses the angle, so |wi.z| grows past the
    // thin-walled mirror value (cos of the incidence angle, 0.8).
    const refrZ = meanAbsZ(refr, 101);
    const thinZ = meanAbsZ(thin, 202);
    expect(refrZ).toBeGreaterThan(thinZ + 0.03);
    expect(thinZ).toBeCloseTo(0.8, 1);
  });

  it('coincides at normal incidence (both go straight through)', () => {
    const wo: V = [0, 0, 1];
    const refr = dielectricTransmissionLobe([1, 1, 1], 0.02, IOR);
    const thin = thinWalledTransmissionLobe([1, 1, 1], 0.02, IOR);
    const r = refr.sample(wo, createPcg32(5));
    const t = thin.sample(wo, createPcg32(5));
    expect(r && t).toBeTruthy();
    if (r && t) {
      expect(r.wi[2]).toBeCloseTo(-1, 1);
      expect(t.wi[2]).toBeCloseTo(-1, 1);
    }
  });

  it('furnace: reflection + transmission stays bounded (R + T <= 1)', () => {
    const refl = dielectricLobe(IOR, 0.2);
    const trans = dielectricTransmissionLobe([1, 1, 1], 0.2, IOR);
    for (const wo of [WO, normalize([0.5, 0.1, 0.85])] as Vec3[]) {
      const R = hemisphericalReflectance(refl, wo, createPcg32(31), 40000);
      const T = hemisphericalReflectance(trans, wo, createPcg32(37), 40000);
      for (let k = 0; k < 3; k++) {
        expect(T[k]).toBeGreaterThan(0.01);
        expect(T[k]).toBeLessThanOrEqual(1.0);
        expect(R[k]! + T[k]!).toBeLessThanOrEqual(1.02);
      }
    }
  });

  it('leaves the opaque base untouched when the transmission weight is 0', () => {
    const base = (): LayeredClosure => ({
      lobes: [
        { kind: 'burley_diffuse', weight: 0.8, color: [0.6, 0.3, 0.2], roughness: 0.5 },
        { kind: 'dielectric_reflection', weight: 0.2, color: [1, 1, 1], roughness: 0.3, ior: IOR },
      ],
      opacity: 1,
    });
    const opaque = layeredSurfaceBsdf(base());
    const withTrans0 = layeredSurfaceBsdf({
      ...base(),
      lobes: [
        ...base().lobes,
        { kind: 'dielectric_transmission', weight: 0, color: [1, 1, 1], roughness: 0.2, ior: IOR },
      ],
    });
    const dirs: V[] = [normalize([0.3, 0, 0.9]), normalize([0, 0.4, 0.8]), normalize([-0.5, 0.2, 0.7])];
    for (const wi of dirs) {
      const a = opaque.eval(WO, wi);
      const b = withTrans0.eval(WO, wi);
      expect(b.pdf).toBeCloseTo(a.pdf, 12);
      for (let k = 0; k < 3; k++) expect(b.value[k]).toBeCloseTo(a.value[k]!, 12);
    }
  });
});
