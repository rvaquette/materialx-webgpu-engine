import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import {
  cauchyIor,
  cieY,
  LAMBDA_MAX,
  LAMBDA_MIN,
  sampleWavelength,
  sellmeierIor,
  spectrumToLinearSrgb,
  spectrumToXYZ,
  thinFilmColor,
  thinFilmReflectance,
  xyzToLinearSrgb,
} from '../../../src/render/pathtracing/spectrum.ts';

describe('CIE color matching', () => {
  it('has a luminance peak near 555 nm', () => {
    expect(cieY(555)).toBeGreaterThan(cieY(450));
    expect(cieY(555)).toBeGreaterThan(cieY(650));
  });

  it('maps an equal-energy spectrum to near-equal tristimulus', () => {
    const xyz = spectrumToXYZ(() => 1, 1);
    expect(xyz[0]).toBeCloseTo(xyz[1], 0);
    expect(xyz[2] / xyz[1]).toBeCloseTo(1, 1);
  });

  it('normalizes an equal-energy spectrum to unit luminance', () => {
    const rgb = spectrumToLinearSrgb(() => 1, 1);
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    expect(luminance).toBeCloseTo(1, 1);
  });

  it('converts the D65 white point to white', () => {
    const rgb = xyzToLinearSrgb([0.9505, 1.0, 1.089]);
    expect(rgb[0]).toBeCloseTo(1, 1);
    expect(rgb[1]).toBeCloseTo(1, 1);
    expect(rgb[2]).toBeCloseTo(1, 1);
  });
});

describe('hero wavelength sampling', () => {
  it('spans the visible range with a uniform pdf', () => {
    const a = sampleWavelength(0);
    const b = sampleWavelength(1);
    expect(a.wavelength).toBeCloseTo(LAMBDA_MIN, 10);
    expect(b.wavelength).toBeCloseTo(LAMBDA_MAX, 10);
    expect(a.pdf).toBeCloseTo(1 / (LAMBDA_MAX - LAMBDA_MIN), 10);
  });
});

describe('dispersion', () => {
  it('Cauchy IOR decreases with wavelength (normal dispersion)', () => {
    expect(cauchyIor(400, 1.5, 0.004)).toBeGreaterThan(cauchyIor(700, 1.5, 0.004));
  });

  it('Sellmeier reproduces BK7 at the d-line', () => {
    const b: Vec3 = [1.03961212, 0.231792344, 1.01046945];
    const c: Vec3 = [0.00600069867, 0.0200179144, 103.560653];
    expect(sellmeierIor(587.6, b, c)).toBeCloseTo(1.5168, 3);
  });
});

describe('thin film interference', () => {
  it('reduces to a bare interface at zero thickness', () => {
    const r = thinFilmReflectance(550, 0, 1, 1, 1.3, 1.5);
    const fresnel = ((1 - 1.5) / (1 + 1.5)) ** 2;
    expect(r.reflectance).toBeCloseTo(fresnel, 4);
  });

  it('conserves energy for a dielectric film', () => {
    const r = thinFilmReflectance(620, 300, 0.8, 1, 1.4, 1.6);
    expect(r.reflectance + r.transmittance).toBeCloseTo(1, 10);
  });

  it('acts as a quarter-wave anti-reflection coating', () => {
    const n1 = Math.sqrt(1.5);
    const d = 550 / (4 * n1);
    const r = thinFilmReflectance(550, d, 1, 1, n1, 1.5);
    expect(r.reflectance).toBeLessThan(0.005);
  });

  it('varies across wavelengths (iridescence)', () => {
    const samples = [450, 500, 550, 600, 650].map((l) => thinFilmReflectance(l, 400, 1, 1, 1.4, 1.6).reflectance);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length;
    expect(variance).toBeGreaterThan(1e-5);
  });

  it('produces a non-neutral tint for a thick film', () => {
    const rgb = thinFilmColor(500, 1, 1, 1.4, 1.6);
    const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
    const minC = Math.min(rgb[0], rgb[1], rgb[2]);
    expect(maxC - minC).toBeGreaterThan(0.01);
  });
});
