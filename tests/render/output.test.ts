import { describe, expect, it } from 'vitest';
import {
  applyExposure,
  encodeOutput,
  planAntialias,
  resolvePixel,
  resolveSamples,
  tonemap,
} from '../../src/render/output.ts';

describe('applyExposure', () => {
  it('doubles radiance per positive EV stop', () => {
    expect(applyExposure([1, 2, 3], 1)).toEqual([2, 4, 6]);
    expect(applyExposure([1, 1, 1], 0)).toEqual([1, 1, 1]);
  });
});

describe('tonemap', () => {
  it('passes through with none', () => {
    expect(tonemap([4, 4, 4], 'none')).toEqual([4, 4, 4]);
  });

  it('saturates below 1 with reinhard', () => {
    const r = tonemap([3, 3, 3], 'reinhard');
    expect(r[0]).toBeCloseTo(0.75); // 3/(1+3)
  });

  it('maps black to black and bright to near white with aces', () => {
    expect(tonemap([0, 0, 0], 'acesFilmic')[0]).toBeCloseTo(0);
    expect(tonemap([16, 16, 16], 'acesFilmic')[0]).toBeGreaterThan(0.9);
  });
});

describe('encodeOutput', () => {
  it('applies the sRGB OETF for lin_rec709', () => {
    const out = encodeOutput([0.5, 0.5, 0.5], 'lin_rec709');
    expect(out.encoded).toBe(true);
    expect(out.color[0]).toBeCloseTo(1.055 * Math.pow(0.5, 1 / 2.4) - 0.055);
  });

  it('never reinterprets a Raw buffer as sRGB', () => {
    const out = encodeOutput([0.5, 0.25, 0.1], 'raw');
    expect(out.encoded).toBe(false);
    expect(out.color).toEqual([0.5, 0.25, 0.1]);
  });
});

describe('resolveSamples', () => {
  it('averages the samples', () => {
    expect(resolveSamples([[0, 0, 0], [2, 4, 6]])).toEqual([1, 2, 3]);
    expect(resolveSamples([])).toEqual([0, 0, 0]);
  });
});

describe('planAntialias', () => {
  it('coerces none to a single sample and defaults msaa to 4', () => {
    expect(planAntialias({ method: 'none' })).toEqual({ method: 'none', sampleCount: 1 });
    expect(planAntialias({ method: 'msaa' })).toEqual({ method: 'msaa', sampleCount: 4 });
    expect(planAntialias({ method: 'supersample', sampleCount: 3 })).toEqual({ method: 'supersample', sampleCount: 3 });
  });
});

describe('resolvePixel', () => {
  it('runs resolve, exposure, tonemap and encode in order', () => {
    const out = resolvePixel([[0, 0, 0], [1, 1, 1]], { exposureEv: 1, tonemap: 'reinhard', outputSpace: 'lin_rec709' });
    // resolve 0.5, exposure x2 -> 1, reinhard 0.5, sRGB encode
    expect(out.encoded).toBe(true);
    expect(out.color[0]).toBeCloseTo(1.055 * Math.pow(0.5, 1 / 2.4) - 0.055);
  });
});
