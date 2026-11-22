import { describe, expect, it } from 'vitest';
import { buildEnvCdf } from '../../src/assets/environment-cdf.ts';

function image(width: number, height: number, luminance: (x: number, y: number) => number) {
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.fill(luminance(x, y), (y * width + x) * 3, (y * width + x) * 3 + 3);
  }
  return { width, height, data };
}

/** Texel probabilities exactly as the WGSL sampler reads them (row step × column step). */
function probabilities(cdf: ReturnType<typeof buildEnvCdf>): number[][] {
  const { width, height } = cdf;
  const marginal = (y: number) => y < 0 ? 0 : cdf.cdf[width * height + y]!;
  const conditional = (x: number, y: number) => x < 0 ? 0 : cdf.cdf[y * width + x]!;
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    (marginal(y) - marginal(y - 1)) * (conditional(x, y) - conditional(x - 1, y))));
}

describe('environment sampling distribution', () => {
  it('normalizes per-texel probabilities and weights rows by their solid angle', () => {
    const cdf = buildEnvCdf(image(8, 4, x => x === 3 ? 10 : 1));
    const p = probabilities(cdf);
    expect(p.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Equator rows cover more solid angle than polar rows: sin θ weighting.
    expect(p[1]![3]! / p[0]![3]!).toBeCloseTo(Math.sin(1.5 * Math.PI / 4) / Math.sin(0.5 * Math.PI / 4), 4);
  });

  it('leaves texels below the solid-angle mean to BSDF sampling (MIS compensation)', () => {
    const p = probabilities(buildEnvCdf(image(8, 4, x => x === 3 ? 10 : 1)));
    expect(p.every(row => row.every((value, x) => x === 3 ? value > 0 : value === 0))).toBe(true);
  });

  it('falls back to luminance sampling when the map is uniform', () => {
    const cdf = buildEnvCdf(image(4, 2, () => 2));
    expect(cdf.totalSum).toBeGreaterThan(0);
    const p = probabilities(cdf);
    expect(p[0]![0]).toBeCloseTo(0.125, 6);
    expect(p.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('reports no distribution for a black map', () => {
    expect(buildEnvCdf(image(4, 2, () => 0)).totalSum).toBe(0);
  });
});
