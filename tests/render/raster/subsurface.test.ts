import { describe, expect, it } from 'vitest';
import {
  burleyProfile,
  burleyScalingFactor,
  diffusionMaxRadius,
  planSubsurface,
  scatterDistances,
  translucencyTransmittance,
  type SubsurfaceProfile,
} from '../../../src/render/raster/subsurface.ts';

const profile: SubsurfaceProfile = {
  albedo: [0.8, 0.8, 0.8],
  meanFreePath: [1.1, 2.2, 3.3],
  ior: 1.4,
};

describe('burleyScalingFactor', () => {
  it('is 1.1 at the reference albedo 0.8', () => {
    expect(burleyScalingFactor(0.8)).toBeCloseTo(1.1);
  });
});

describe('scatterDistances', () => {
  it('divides the mean free path by the albedo remap', () => {
    const d = scatterDistances(profile);
    expect(d[0]).toBeCloseTo(1);
    expect(d[1]).toBeCloseTo(2);
    expect(d[2]).toBeCloseTo(3);
  });
});

describe('burleyProfile', () => {
  it('is positive and decreases with radius', () => {
    const near = burleyProfile(0.1, 1);
    const far = burleyProfile(1, 1);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far);
  });
});

describe('diffusionMaxRadius', () => {
  it('captures the requested energy quantile and grows with scatter distance', () => {
    const r1 = diffusionMaxRadius(1, 0.997);
    const r2 = diffusionMaxRadius(2, 0.997);
    const cdf = (r: number, d: number): number => 1 - 0.25 * Math.exp(-r / d) - 0.75 * Math.exp(-r / (3 * d));
    expect(cdf(r1, 1)).toBeCloseTo(0.997, 3);
    expect(r2).toBeGreaterThan(r1);
  });
});

describe('translucencyTransmittance', () => {
  it('is opaque-free at zero thickness and attenuates with depth', () => {
    const d = scatterDistances(profile);
    expect(translucencyTransmittance(0, d)).toEqual([1, 1, 1]);
    const t = translucencyTransmittance(2, d);
    expect(t[0]).toBeLessThan(1);
    expect(t[0]).toBeCloseTo(Math.exp(-2 / d[0]));
  });
});

describe('planSubsurface', () => {
  it('reports a positive radius and declares its approximations', () => {
    const plan = planSubsurface(profile);
    expect(plan.maxRadius).toBeGreaterThan(0);
    expect(plan.approximations.length).toBe(3);
    expect(plan.approximations.some((a) => a.includes('thickness'))).toBe(true);
  });
});
