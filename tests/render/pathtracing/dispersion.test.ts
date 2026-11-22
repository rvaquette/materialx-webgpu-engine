import { describe, expect, it } from 'vitest';
import type { LayeredClosure } from '../../../src/compiler/ir.ts';
import { layeredSurfaceBsdf } from '../../../src/render/pathtracing/bsdf.ts';
import { dispersionIor, dispersionIorAt, dispersionWgsl, sampleDispersionWavelength } from '../../../src/render/pathtracing/spectrum.ts';

function glass(dispersion: number, thinWalled = false): LayeredClosure {
  return { opacity: 1, lobes: [
    { kind: 'dielectric_transmission', weight: 1, color: [1, 1, 1], roughness: 0.02, ior: 1.52, dispersion, thinWalled },
  ] };
}

describe('RGB glass dispersion', () => {
  it('matches the KHR half-spread and leaves green unchanged', () => {
    expect(dispersionIor(1.52, 0.35, 0)).toBeCloseTo(1.51545, 10);
    expect(dispersionIor(1.52, 0.35, 1)).toBe(1.52);
    expect(dispersionIor(1.52, 0.35, 2)).toBeCloseTo(1.52455, 10);
    expect(dispersionIor(1.52, 0, 0)).toBe(1.52);
    expect(dispersionIor(1.52, -1, 2)).toBe(1.52);
  });

  it.each([0, 1, 2] as const)('refracts channel %s according to Snell at both interfaces', (channel) => {
    const bsdf = layeredSurfaceBsdf(glass(0.35), channel);
    const ior = dispersionIor(1.52, 0.35, channel);
    for (const side of [1, -1]) {
      const sample = bsdf.sample([0.6, 0, 0.8 * side], () => 0);
      expect(sample).not.toBeNull();
      const x = -0.6 * (side > 0 ? 1 / ior : ior);
      expect(sample!.wi[0]).toBeCloseTo(x, 8);
      expect(sample!.wi[2]).toBeCloseTo(-side * Math.sqrt(1 - x * x), 8);
      expect(sample!.pdf).toBeGreaterThan(0);
    }
  });

  it('does not split zero-dispersion or thin-walled rays', () => {
    for (const closure of [glass(0), glass(1, true)]) {
      const samples = ([0, 1, 2] as const).map((channel) =>
        layeredSurfaceBsdf(closure, channel).sample([0.6, 0, 0.8], () => 0));
      expect(samples[0]).toEqual(samples[1]);
      expect(samples[1]).toEqual(samples[2]);
    }
  });

  it('preserves the authored IOR when evaluating multiple channels', () => {
    const closure = glass(1);
    layeredSurfaceBsdf(closure, 0);
    layeredSurfaceBsdf(closure, 2);
    expect(closure.lobes[0]!.ior).toBe(1.52);
  });
});

describe('spectral glass dispersion', () => {
  it('follows the Abbe number with the authored IOR at the d line', () => {
    const ior = 1.52, abbe = 40;
    expect(dispersionIorAt(ior, 20 / abbe, 587.6)).toBeCloseTo(ior, 6);
    expect(dispersionIorAt(ior, 20 / abbe, 486.1) - dispersionIorAt(ior, 20 / abbe, 656.3)).toBeCloseTo((ior - 1) / abbe, 6);
    expect(dispersionIorAt(ior, 0, 400)).toBe(ior);
    // Same red-to-blue spread as the raster RGB approximation.
    expect(dispersionIorAt(ior, 0.5, 486.1) - dispersionIorAt(ior, 0.5, 656.3)).toBeCloseTo(dispersionIor(ior, 0.5, 2) - dispersionIor(ior, 0.5, 0), 6);
  });

  it('draws wavelengths whose weights average to white', () => {
    const n = 20000;
    const mean: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const { wavelength, weight } = sampleDispersionWavelength((i + 0.5) / n);
      expect(wavelength).toBeGreaterThanOrEqual(380);
      expect(wavelength).toBeLessThanOrEqual(720);
      weight.forEach((w, c) => { mean[c] = (mean[c] ?? 0) + w / n; });
    }
    for (const value of mean) expect(value).toBeCloseTo(1, 2);
    // Bounded weights: importance sampling follows the response.
    expect(Math.max(...[0.01, 0.3, 0.6, 0.99].flatMap(u => sampleDispersionWavelength(u).weight.map(Math.abs)))).toBeLessThan(4);
  });

  it('bakes the same sampling table into WGSL', () => {
    const wgsl = dispersionWgsl();
    expect(wgsl).toContain('fn mx_sample_dispersion_wavelength(u: f32) -> vec4f');
    expect(wgsl.match(/MX_DISPERSION_CDF = array<f32, (\d+)>/)?.[1]).toBe('34');
  });
});
