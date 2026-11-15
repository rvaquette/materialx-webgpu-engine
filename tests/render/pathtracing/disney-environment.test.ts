import { describe, expect, it } from 'vitest';
import { buildDisneyEnvironmentCdf } from '../../../src/render/pathtracing/disney-environment.ts';

describe('Disney environment CDF', () => {
  it('rounds each weight and cumulative sum like the source renderer', () => {
    const data = new Float32Array([1e7, 0, 0, 1, 1, 1, 1, 1, 1, 2, 4, 8]);
    const result = buildDisneyEnvironmentCdf({ width: 2, height: 2, data });
    const weights = new Float32Array(4);
    for (let i = 0; i < 4; i++) {
      weights[i] = 0.212671 * data[i * 3]! + 0.715160 * data[i * 3 + 1]! + 0.072169 * data[i * 3 + 2]!;
    }
    const source = new Float32Array(4);
    source[0] = weights[0]!;
    for (let i = 1; i < 4; i++) source[i] = source[i - 1]! + weights[i]!;
    expect(result.cdf).toEqual(source);
    expect(result.totalSum).toBe(source[3]);
  });

  it('rejects invalid dimensions, radiance, zero distributions and overflow', () => {
    expect(() => buildDisneyEnvironmentCdf({ width: 2, height: 1, data: new Float32Array(3) })).toThrow(/dimensions/);
    expect(() => buildDisneyEnvironmentCdf({ width: 1, height: 1, data: new Float32Array([0, 0, 0]) })).toThrow(/zero/);
    expect(() => buildDisneyEnvironmentCdf({ width: 1, height: 1, data: new Float32Array([-1, 0, 0]) })).toThrow(/radiance/);
    expect(() => buildDisneyEnvironmentCdf({ width: 1, height: 1, data: new Float32Array([Infinity, 0, 0]) })).toThrow(/radiance/);
    expect(() => buildDisneyEnvironmentCdf({ width: 2, height: 1, data: new Float32Array(6).fill(3.4e38) })).toThrow(/overflow/);
  });
});
