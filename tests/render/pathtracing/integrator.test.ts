import { describe, expect, it } from 'vitest';
import {
  balanceHeuristic,
  createPcg32,
  integratePath,
  powerHeuristic,
  RadianceAccumulator,
  russianRoulette,
  type Ray,
  type SceneSampler,
  type SurfaceHit,
} from '../../../src/render/pathtracing/integrator.ts';

function makeScene(overrides: Partial<SceneSampler>): SceneSampler {
  return {
    intersect: () => null,
    sampleBsdf: () => null,
    evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }),
    sampleLight: () => null,
    occluded: () => false,
    lightPdf: () => 0,
    ...overrides,
  };
}

const cameraRay: Ray = { origin: [0, 0, 1], direction: [0, 0, -1] };

describe('coverage opacity', () => {
  it.each([
    [0, 1],
    [0.35, 0.65],
    [1, 0],
  ])('blocks diffuse dome light with occluder coverage %s (expected visibility %s)', (opacity, expected) => {
    const scene = makeScene({
      intersect: (ray) => ray.direction[2] < 0
        ? { position: [0, 0, 0], normal: [0, 0, 1] }
        : ray.origin[2] < 0.5
          ? { position: [0, 0, 0.5], normal: [0, 0, -1], opacity }
          : null,
      sampleBsdf: (hit) => hit.position[2] === 0
        ? { direction: [0, 0, 1], value: [1 / Math.PI, 1 / Math.PI, 1 / Math.PI], pdf: 1 / Math.PI }
        : null,
      environment: () => [1, 1, 1],
    });
    const sum = [0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      const rgb = integratePath(scene, cameraRay, () => (i + 0.5) / 1000);
      rgb.forEach((v, k) => { sum[k]! += v / 1000; });
    }
    sum.forEach((v) => expect(v).toBeCloseTo(expected, 10));
  });

  it('passes through zero coverage before emission or scattering without changing direction', () => {
    const scene = makeScene({
      intersect: (ray) => ray.origin[2] > 0
        ? { position: [0, 0, 0], normal: [0, 0, 1], opacity: 0, emission: [100, 0, 0] } : null,
      environment: (direction) => direction[2] === -1 ? [0.2, 0.4, 0.8] : [0, 0, 0],
      sampleBsdf: () => { throw new Error('A null surface must not scatter'); },
    });
    expect(integratePath(scene, cameraRay, () => { throw new Error('Zero opacity needs no RNG'); })).toEqual([0.2, 0.4, 0.8]);
  });

  it('matches alpha-over compositing for a 0.35 coverage layer', () => {
    const scene = makeScene({
      intersect: (ray) => ray.origin[2] > 0
        ? { position: [0, 0, 0], normal: [0, 0, 1], opacity: 0.35, emission: [1, 0, 0] } : null,
      environment: () => [0, 0, 1],
    });
    const sum = [0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      const rgb = integratePath(scene, cameraRay, () => (i + 0.5) / 1000);
      rgb.forEach((v, k) => { sum[k]! += v / 1000; });
    }
    expect(sum[0]).toBeCloseTo(0.35, 10);
    expect(sum[2]).toBeCloseTo(0.65, 10);
  });
});

describe('createPcg32', () => {
  it('is deterministic for a seed and stays in [0,1)', () => {
    const a = createPcg32(42);
    const b = createPcg32(42);
    for (let i = 0; i < 5; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('averages near 0.5 over many samples', () => {
    const rng = createPcg32(7);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += rng();
    expect(sum / n).toBeCloseTo(0.5, 1);
  });
});

describe('MIS heuristics', () => {
  it('balance and power agree on equal pdfs', () => {
    expect(balanceHeuristic(1, 2, 1, 2)).toBeCloseTo(0.5);
    expect(powerHeuristic(1, 2, 1, 2)).toBeCloseTo(0.5);
  });

  it('power heuristic favours the lower-variance strategy', () => {
    expect(powerHeuristic(1, 3, 1, 1)).toBeCloseTo(0.9);
    expect(powerHeuristic(1, 0, 1, 0)).toBe(0);
  });
});

describe('russianRoulette', () => {
  it('survives below the survival probability and compensates throughput', () => {
    expect(russianRoulette([0.5, 0.5, 0.5], 0.4)).toEqual({ survive: true, scale: 2 });
    expect(russianRoulette([0.5, 0.5, 0.5], 0.6)).toEqual({ survive: false, scale: 0 });
  });

  it('clamps survival to 0.95 and terminates zero throughput', () => {
    expect(russianRoulette([1, 1, 1], 0.9).scale).toBeCloseTo(1 / 0.95);
    expect(russianRoulette([0, 0, 0], 0.1)).toEqual({ survive: false, scale: 0 });
  });
});

describe('RadianceAccumulator', () => {
  it('averages samples and reports count', () => {
    const acc = new RadianceAccumulator();
    expect(acc.mean).toEqual([0, 0, 0]);
    acc.addSample([2, 4, 6]);
    acc.addSample([0, 0, 0]);
    expect(acc.samples).toBe(2);
    expect(acc.mean).toEqual([1, 2, 3]);
  });
});

describe('integratePath', () => {
  it('returns the emission when the camera ray hits a light directly', () => {
    const hit: SurfaceHit = { position: [0, 0, 0], normal: [0, 0, 1], emission: [3, 2, 1] };
    const scene = makeScene({ intersect: () => hit });
    const rng = createPcg32(1);
    expect(integratePath(scene, cameraRay, rng)).toEqual([3, 2, 1]);
  });

  it('returns environment radiance when the camera ray misses', () => {
    const scene = makeScene({ intersect: () => null, environment: () => [0.2, 0.4, 0.6] });
    expect(integratePath(scene, cameraRay, createPcg32(1))).toEqual([0.2, 0.4, 0.6]);
  });

  it('estimates MIS-weighted direct lighting on a diffuse surface', () => {
    const hit: SurfaceHit = { position: [0, 0, 0], normal: [0, 0, 1] };
    const albedo = 0.8;
    const f = albedo / Math.PI;
    const scatterPdf = 1 / Math.PI;
    const scene = makeScene({
      intersect: () => hit,
      sampleLight: () => ({ direction: [0, 0, 1], radiance: [1, 1, 1], pdf: 1, distance: 10 }),
      occluded: () => false,
      evalBsdf: () => ({ value: [f, f, f], pdf: scatterPdf }),
      sampleBsdf: () => null,
    });
    const w = powerHeuristic(1, 1, 1, scatterPdf);
    const expected = f * 1 * w * 1; // f * Li * misWeight * cos / lightPdf
    const result = integratePath(scene, cameraRay, createPcg32(1));
    expect(result[0]).toBeCloseTo(expected);
    expect(result[1]).toBeCloseTo(expected);
  });
});

describe('integratePath MIS on a surface light (T057e)', () => {
  // A diffuse surface lit by a spherical-cap area light centred on the normal.
  // Both next-event estimation (uniform cone sampling) and BSDF sampling (cosine
  // hemisphere) can reach the light, so MIS combines them with the power
  // heuristic. The three estimators share one analytic integral:
  //   Lo = f * Le * integral_cone(cos) dw = a * Le * sin^2(alpha).
  const albedo = 0.8;
  const Le = 8;
  const alpha = 0.25; // small, bright light: NEE converges fast, BSDF sampling does not.
  const cosHalf = Math.cos(alpha);
  const omega = 2 * Math.PI * (1 - cosHalf); // cone solid angle
  const f = albedo / Math.PI;
  const Lo = albedo * Le * Math.sin(alpha) ** 2;

  const scaleV = (a: readonly [number, number, number], s: number): [number, number, number] => [
    a[0] * s,
    a[1] * s,
    a[2] * s,
  ];
  const negV = (a: readonly [number, number, number]): [number, number, number] => [-a[0], -a[1], -a[2]];

  function sampleCone(rng: () => number): [number, number, number] {
    const z = 1 - rng() * (1 - cosHalf);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = 2 * Math.PI * rng();
    return [r * Math.cos(phi), r * Math.sin(phi), z];
  }

  function cosineHemisphere(rng: () => number): [number, number, number] {
    const u1 = rng();
    const r = Math.sqrt(u1);
    const phi = 2 * Math.PI * rng();
    return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u1))];
  }

  const inCone = (dir: readonly [number, number, number]): boolean => dir[2] >= cosHalf;

  const shadingPoint: SurfaceHit = { position: [0, 0, 0], normal: [0, 0, 1] };
  const misScene: SceneSampler = {
    intersect: (ray) => {
      // Camera ray enters from above and lands on the shading point.
      if (ray.origin[2] > 0.5 && ray.direction[2] < 0) return shadingPoint;
      // Continuation rays reach the light only inside the cone.
      if (ray.direction[2] >= cosHalf) {
        return { position: scaleV(ray.direction, 100), normal: negV(ray.direction), emission: [Le, Le, Le] };
      }
      return null;
    },
    sampleBsdf: (hit, _wo, rng) => {
      if (hit.emission) return null;
      const dir = cosineHemisphere(rng);
      return { direction: dir, value: [f, f, f], pdf: dir[2] / Math.PI };
    },
    evalBsdf: (hit, _wo, wi) => {
      if (hit.emission || wi[2] <= 0) return { value: [0, 0, 0], pdf: 0 };
      return { value: [f, f, f], pdf: wi[2] / Math.PI };
    },
    sampleLight: (hit, rng) => {
      if (hit.emission) return null;
      return { direction: sampleCone(rng), radiance: [Le, Le, Le], pdf: 1 / omega, distance: 100 };
    },
    occluded: () => false,
    lightPdf: (_from, wi) => (inCone(wi) ? 1 / omega : 0),
  };

  function stats(sample: (rng: () => number) => number, seed: number, n: number) {
    const rng = createPcg32(seed);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = sample(rng);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    return { mean, variance: Math.max(0, sumSq / n - mean * mean) };
  }

  const N = 50000;
  const mis = stats(
    (rng) => integratePath(misScene, cameraRay, rng, { minBounces: 1000 })[0],
    11,
    N,
  );
  // Light sampling only (unit MIS weight): f * Le * cos / lightPdf.
  const neeOnly = stats((rng) => {
    const dir = sampleCone(rng);
    return (f * Le * Math.max(dir[2], 0)) / (1 / omega);
  }, 22, N);
  // BSDF sampling only (unit MIS weight): f * Le * cos / bsdfPdf when it hits.
  const bsdfOnly = stats((rng) => {
    const dir = cosineHemisphere(rng);
    if (!inCone(dir)) return 0;
    return (f * Le * dir[2]) / (dir[2] / Math.PI);
  }, 33, N);

  it('is unbiased: the MIS estimator converges to NEE-only and BSDF-only', () => {
    expect(Math.abs(mis.mean - Lo)).toBeLessThan(Lo * 0.03);
    expect(Math.abs(neeOnly.mean - Lo)).toBeLessThan(Lo * 0.03);
    expect(Math.abs(bsdfOnly.mean - Lo)).toBeLessThan(Lo * 0.06);
    expect(mis.mean).toBeCloseTo(neeOnly.mean, 1);
    expect(mis.mean).toBeCloseTo(bsdfOnly.mean, 1);
  });

  it('reduces variance at equal budget versus the poorly matched strategy', () => {
    expect(mis.variance).toBeLessThan(bsdfOnly.variance);
    expect(mis.variance).toBeLessThan(bsdfOnly.variance * 0.1);
  });

  it('keeps the power-heuristic MIS weights within [0,1]', () => {
    const rng = createPcg32(99);
    for (let i = 0; i < 2000; i++) {
      const a = rng() * 10;
      const b = rng() * 10;
      const w = powerHeuristic(1, a, 1, b);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      // Both strategies weight to a partition of unity.
      const wOther = powerHeuristic(1, b, 1, a);
      if (a + b > 0) expect(w + wOther).toBeCloseTo(1, 6);
    }
  });
});

describe('integratePath participating media', () => {
  const Le = 4;
  const D = 2;
  const a = 0.5;
  // Camera-interior absorbing medium (no scattering): Beer-Lambert attenuation of
  // a far emissive surface. Expected radiance converges to exp(-a*D)*Le.
  const absorbing = { absorption: [a, a, a], scattering: [0, 0, 0], anisotropy: 0 } as const;
  const farLight: SurfaceHit = { position: [0, 0, 1 - D], normal: [0, 0, 1], emission: [Le, Le, Le] };
  const scene = makeScene({ intersect: () => farLight });

  it('attenuates a far light by Beer-Lambert through an absorbing medium', () => {
    const rng = createPcg32(5);
    let sum = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      sum += integratePath(scene, cameraRay, rng, { initialMedium: absorbing, maxBounces: 16 })[0];
    }
    const expected = Math.exp(-a * D) * Le;
    expect(sum / n).toBeCloseTo(expected, 1);
  });

  it('stays finite, non-negative and bounded by the source through a scattering medium', () => {
    const scattering = { absorption: [0, 0, 0], scattering: [0.6, 0.6, 0.6], anisotropy: 0 } as const;
    const rng = createPcg32(9);
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const v = integratePath(scene, cameraRay, rng, { initialMedium: scattering, maxBounces: 64 })[0];
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      sum += v;
    }
    expect(sum / n).toBeLessThanOrEqual(Le);
  });

  it('ignores media for scenes that provide none (backward compatible)', () => {
    const hit: SurfaceHit = { position: [0, 0, 0], normal: [0, 0, 1], emission: [3, 2, 1] };
    const plain = makeScene({ intersect: () => hit });
    expect(integratePath(plain, cameraRay, createPcg32(1))).toEqual([3, 2, 1]);
  });
});
