import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import {
  estimateSlabResponse,
  extinctionFromMeanFreePath,
  randomWalkSlabChannel,
  singleScatterAlbedo,
} from '../../../src/render/pathtracing/subsurface.ts';

describe('single-scatter albedo inversion', () => {
  it('maps black to zero and white near one', () => {
    expect(singleScatterAlbedo([0, 0, 0])).toEqual([0, 0, 0]);
    const white = singleScatterAlbedo([1, 1, 1]);
    expect(white[0]).toBeGreaterThan(0.99);
    expect(white[0]).toBeLessThan(1);
  });

  it('is monotonically increasing', () => {
    const low = singleScatterAlbedo([0.2, 0.2, 0.2])[0];
    const mid = singleScatterAlbedo([0.5, 0.5, 0.5])[0];
    const high = singleScatterAlbedo([0.8, 0.8, 0.8])[0];
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});

describe('extinction from mean free path', () => {
  it('is inversely proportional to the mean free path', () => {
    const near = extinctionFromMeanFreePath([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])[0];
    const far = extinctionFromMeanFreePath([1, 1, 1], [0.5, 0.5, 0.5])[0];
    expect(near).toBeGreaterThan(far);
    expect(near).toBeCloseTo(2 * far, 10);
  });

  it('returns zero for a zero mean free path', () => {
    expect(extinctionFromMeanFreePath([0, 0, 0], [0.5, 0.5, 0.5])).toEqual([0, 0, 0]);
  });
});

describe('random walk slab', () => {
  const entry: Vec3 = [0, 0, 1];

  it('conserves energy with no absorption (analog)', () => {
    const rng = createPcg32(3);
    const res = estimateSlabResponse([1, 1, 1], [1, 1, 1], 0, 2, entry, rng, 5000, { mode: 'analog' });
    for (let c = 0; c < 3; c += 1) {
      expect(res.reflectance[c]! + res.transmittance[c]!).toBeCloseTo(1, 10);
      expect(res.absorbed[c]!).toBeCloseTo(0, 10);
    }
  });

  it('reflects more as the slab gets thicker (no absorption)', () => {
    const rngThin = createPcg32(10);
    const rngThick = createPcg32(10);
    const thin = estimateSlabResponse([1, 1, 1], [1, 1, 1], 0, 1, entry, rngThin, 4000, { mode: 'analog' });
    const thick = estimateSlabResponse([1, 1, 1], [1, 1, 1], 0, 6, entry, rngThick, 4000, { mode: 'analog' });
    expect(thick.reflectance[0]!).toBeGreaterThan(thin.reflectance[0]!);
    expect(thick.transmittance[0]!).toBeLessThan(thin.transmittance[0]!);
  });

  it('absorbs energy when albedo < 1', () => {
    const rng = createPcg32(21);
    const res = estimateSlabResponse([0.5, 0.5, 0.5], [1, 1, 1], 0, 4, entry, rng, 6000, { mode: 'analog' });
    expect(res.absorbed[0]!).toBeGreaterThan(0.1);
    expect(res.reflectance[0]! + res.transmittance[0]!).toBeLessThan(0.95);
  });

  it('analog and weighted modes agree in expectation', () => {
    const rngA = createPcg32(55);
    const rngW = createPcg32(88);
    const analog = estimateSlabResponse([0.7, 0.7, 0.7], [1, 1, 1], 0.2, 2, entry, rngA, 20000, { mode: 'analog' });
    const weighted = estimateSlabResponse([0.7, 0.7, 0.7], [1, 1, 1], 0.2, 2, entry, rngW, 20000, {
      mode: 'weighted',
      rrProbability: 0.9,
    });
    expect(weighted.reflectance[0]!).toBeCloseTo(analog.reflectance[0]!, 1);
    expect(weighted.transmittance[0]!).toBeCloseTo(analog.transmittance[0]!, 1);
  });

  it('passes straight through a non-extincting medium', () => {
    const rng = createPcg32(1);
    const r = randomWalkSlabChannel(0, 1, 0, 1, entry, rng);
    expect(r.exit).toBe('back');
    expect(r.weight).toBe(1);
  });
});
