import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import {
  deltaTrack,
  extinction,
  phaseHG,
  ratioTrackingTransmittance,
  sampleHenyeyGreenstein,
  sampleHomogeneous,
  transmittanceHomogeneous,
  type HomogeneousMedium,
} from '../../../src/render/pathtracing/media.ts';

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

describe('extinction and transmittance', () => {
  it('sums absorption and scattering per channel', () => {
    const medium: HomogeneousMedium = { absorption: [0.1, 0.2, 0.3], scattering: [0.4, 0.3, 0.2], anisotropy: 0 };
    expect(extinction(medium)).toEqual([0.5, 0.5, 0.5]);
  });

  it('follows Beer-Lambert per channel', () => {
    const tr = transmittanceHomogeneous([1, 2, 3], 0.5);
    expect(tr[0]).toBeCloseTo(Math.exp(-0.5), 10);
    expect(tr[1]).toBeCloseTo(Math.exp(-1.0), 10);
    expect(tr[2]).toBeCloseTo(Math.exp(-1.5), 10);
  });

  it('is unit transmittance at zero distance', () => {
    expect(transmittanceHomogeneous([1, 2, 3], 0)).toEqual([1, 1, 1]);
  });
});

describe('Henyey-Greenstein phase', () => {
  it('is 1/(4pi) when isotropic', () => {
    expect(phaseHG(0.3, 0)).toBeCloseTo(1 / (4 * Math.PI), 10);
    expect(phaseHG(-0.7, 0)).toBeCloseTo(1 / (4 * Math.PI), 10);
  });

  it('peaks forward for g>0', () => {
    expect(phaseHG(1, 0.6)).toBeGreaterThan(phaseHG(-1, 0.6));
  });

  it('returns unit directions and pdf matching the phase value', () => {
    const wo: Vec3 = [0, 0, 1];
    const s = sampleHenyeyGreenstein(wo, 0.5, 0.37, 0.62);
    expect(length(s.wi)).toBeCloseTo(1, 10);
    expect(s.pdf).toBeCloseTo(phaseHG(dot(s.wi, wo), 0.5), 10);
  });

  it('has mean cosine of magnitude g (importance sampled)', () => {
    const rng = createPcg32(7);
    const wo: Vec3 = [0, 0, 1];
    const g = 0.7;
    const n = 50000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const s = sampleHenyeyGreenstein(wo, g, rng(), rng());
      sum += dot(s.wi, wo);
    }
    // Convention: cosine measured against wo; forward scattering gives mean -g.
    expect(sum / n).toBeCloseTo(-g, 1);
  });

  it('has mean cosine near zero when isotropic', () => {
    const rng = createPcg32(11);
    const wo: Vec3 = [0, 1, 0];
    const n = 40000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const s = sampleHenyeyGreenstein(wo, 0, rng(), rng());
      sum += dot(s.wi, wo);
    }
    expect(sum / n).toBeCloseTo(0, 1);
  });
});

describe('homogeneous medium sampling', () => {
  it('returns albedo weight at a scatter event with equal channels', () => {
    // Force a scatter: rng sequence -> channel 0, then small u so t is tiny.
    const seq = [0.0, 0.0001];
    let k = 0;
    const rng = () => seq[k++ % seq.length]!;
    const medium: HomogeneousMedium = { absorption: [1, 1, 1], scattering: [3, 3, 3], anisotropy: 0 };
    const r = sampleHomogeneous(medium, 10, rng);
    expect(r.scattered).toBe(true);
    const albedo = 3 / 4;
    expect(r.weight[0]).toBeCloseTo(albedo, 6);
    expect(r.weight[1]).toBeCloseTo(albedo, 6);
    expect(r.weight[2]).toBeCloseTo(albedo, 6);
  });

  it('returns unit weight when reaching the surface with equal channels', () => {
    // Force pass-through: channel 0, then u -> huge distance beyond tMax.
    const seq = [0.0, 0.999999999];
    let k = 0;
    const rng = () => seq[k++ % seq.length]!;
    const medium: HomogeneousMedium = { absorption: [0.5, 0.5, 0.5], scattering: [0.5, 0.5, 0.5], anisotropy: 0 };
    const r = sampleHomogeneous(medium, 1, rng);
    expect(r.scattered).toBe(false);
    expect(r.t).toBe(1);
    expect(r.weight[0]).toBeCloseTo(1, 6);
  });

  it('is an unbiased transmittance estimator through the surface case', () => {
    // E[weight * 1(surface)] should equal the true transmittance exp(-sigmaT*tMax).
    const rng = createPcg32(99);
    const medium: HomogeneousMedium = { absorption: [0.3, 0.3, 0.3], scattering: [0.7, 0.7, 0.7], anisotropy: 0 };
    const tMax = 1.5;
    const n = 200000;
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      const r = sampleHomogeneous(medium, tMax, rng);
      if (!r.scattered) acc += r.weight[0];
    }
    const expected = Math.exp(-1 * tMax);
    expect(acc / n).toBeCloseTo(expected, 2);
  });
});

describe('heterogeneous tracking', () => {
  it('delta tracking recovers the homogeneous free-flight mean', () => {
    const rng = createPcg32(5);
    const sigma = 1;
    const tMax = 1000;
    const n = 100000;
    let sum = 0;
    let scatteredCount = 0;
    for (let i = 0; i < n; i += 1) {
      const r = deltaTrack(sigma, () => sigma, tMax, rng);
      if (r.scattered) {
        scatteredCount += 1;
        sum += r.t;
      }
    }
    expect(scatteredCount / n).toBeGreaterThan(0.99);
    expect(sum / scatteredCount).toBeCloseTo(1 / sigma, 1);
  });

  it('delta tracking handles a majorant above the field', () => {
    const rng = createPcg32(23);
    const sigma = 1;
    const maj = 3;
    const tMax = 1000;
    const n = 100000;
    let sum = 0;
    let scatteredCount = 0;
    for (let i = 0; i < n; i += 1) {
      const r = deltaTrack(maj, () => sigma, tMax, rng);
      if (r.scattered) {
        scatteredCount += 1;
        sum += r.t;
      }
    }
    // Real-collision distance still has mean 1/sigma despite null collisions.
    expect(sum / scatteredCount).toBeCloseTo(1 / sigma, 1);
  });

  it('ratio tracking is an unbiased transmittance estimator', () => {
    const rng = createPcg32(42);
    const sigma = 1;
    const maj = 2;
    const tMax = 1;
    const n = 200000;
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      acc += ratioTrackingTransmittance(maj, () => sigma, tMax, rng);
    }
    expect(acc / n).toBeCloseTo(Math.exp(-sigma * tMax), 2);
  });

  it('ratio tracking integrates a varying field unbiasedly', () => {
    const rng = createPcg32(77);
    // Linear field sigma_t(t) = t over [0,1]; optical depth = integral = 0.5.
    const field = (t: number) => t;
    const maj = 1;
    const tMax = 1;
    const n = 200000;
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      acc += ratioTrackingTransmittance(maj, field, tMax, rng);
    }
    expect(acc / n).toBeCloseTo(Math.exp(-0.5), 2);
  });
});
