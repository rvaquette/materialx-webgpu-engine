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
