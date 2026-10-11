import { describe, expect, it } from 'vitest';
import {
  beerLambert,
  extinction,
  henyeyGreenstein,
  marchVolume,
  planVolume,
  scatteringAlbedo,
  type VolumeMaterial,
} from '../../../src/render/raster/volume.ts';

const absorbing: VolumeMaterial = {
  absorption: [1, 1, 1],
  scattering: [0, 0, 0],
  emission: [1, 1, 1],
  anisotropy: 0,
};

const scattering: VolumeMaterial = {
  absorption: [0, 0, 0],
  scattering: [1, 1, 1],
  anisotropy: 0,
};

describe('extinction and scatteringAlbedo', () => {
  it('sums absorption and scattering', () => {
    const e = extinction({ absorption: [0.2, 0.3, 0.4], scattering: [0.1, 0.1, 0.1], anisotropy: 0 });
    expect(e[0]).toBeCloseTo(0.3);
    expect(e[1]).toBeCloseTo(0.4);
    expect(e[2]).toBeCloseTo(0.5);
  });

  it('is 1 for pure scattering and 0 for pure absorption', () => {
    expect(scatteringAlbedo(scattering)).toEqual([1, 1, 1]);
    expect(scatteringAlbedo(absorbing)).toEqual([0, 0, 0]);
  });
});

describe('henyeyGreenstein', () => {
  it('is isotropic at g=0', () => {
    expect(henyeyGreenstein(0.5, 0)).toBeCloseTo(1 / (4 * Math.PI));
  });

  it('peaks forward for positive anisotropy', () => {
    expect(henyeyGreenstein(1, 0.6)).toBeGreaterThan(henyeyGreenstein(-1, 0.6));
  });
});

describe('beerLambert', () => {
  it('is identity at zero distance and attenuates with length', () => {
    expect(beerLambert([1, 1, 1], 0)).toEqual([1, 1, 1]);
    expect(beerLambert([1, 1, 1], 2)[0]).toBeCloseTo(Math.exp(-2));
  });
});

describe('marchVolume', () => {
  it('returns no radiance and full transmittance in empty space', () => {
    const r = marchVolume({ material: scattering, near: 0, far: 10, stepSize: 0.1, maxSteps: 100, density: () => 0 });
    expect(r.radiance).toEqual([0, 0, 0]);
    expect(r.transmittance[0]).toBeCloseTo(1);
  });

  it('accumulates emission toward emission/extinction over a deep segment', () => {
    const r = marchVolume({ material: absorbing, near: 0, far: 20, stepSize: 0.1, maxSteps: 1000, density: () => 1 });
    expect(r.radiance[0]).toBeCloseTo(1, 2); // emission 1 / extinction 1
    expect(r.transmittance[0]).toBeLessThan(1e-3);
    expect(r.steps).toBeLessThan(1000); // early termination on opacity
  });

  it('integrates constant in-scattering to albedo-weighted radiance', () => {
    const r = marchVolume({
      material: scattering,
      near: 0,
      far: 20,
      stepSize: 0.1,
      maxSteps: 1000,
      density: () => 1,
      inScatter: () => [0.5, 0.5, 0.5],
    });
    expect(r.radiance[0]).toBeCloseTo(0.5, 2);
  });
});

describe('planVolume', () => {
  it('scales the step budget with quality and declares approximations', () => {
    const low = planVolume(scattering, 'low', 1);
    const high = planVolume(scattering, 'high', 1);
    expect(low.maxSteps).toBeLessThan(high.maxSteps);
    expect(high.stepSize).toBeLessThan(low.stepSize);
    expect(high.approximations.some((a) => a.includes('single scattering'))).toBe(true);
  });
});
