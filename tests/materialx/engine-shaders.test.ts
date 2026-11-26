import { describe, expect, it } from 'vitest';
import { bakeEnvironmentShader, DEFAULT_ENVIRONMENT_SHADER } from '../../src/materialx/engine-shaders.ts';

describe('procedural environment shader', () => {
  it('bakes a linear, top-down lat-long image with the north pole in the first row', () => {
    const image = bakeEnvironmentShader({
      ...DEFAULT_ENVIRONMENT_SHADER,
      model: 'sky',
      zenithColor: [0.8, 0.6, 0.4],
      horizonColor: [0.2, 0.2, 0.2],
      groundColor: [0.01, 0.01, 0.01],
      sunIntensity: 0,
    }, 0, 32, 16);
    expect(image).toMatchObject({ width: 32, height: 16 });
    expect(image.data).toHaveLength(32 * 16 * 3);
    expect(image.data[0]).toBeGreaterThan(image.data[(15 * 32) * 3]!);
    expect([...image.data].every(Number.isFinite)).toBe(true);
  });

  it('changes the baked illumination when an environment rotation is animated', () => {
    const settings = { ...DEFAULT_ENVIRONMENT_SHADER, model: 'studio' as const, animationSpeed: 90 };
    const first = bakeEnvironmentShader(settings, 0, 32, 16);
    const later = bakeEnvironmentShader(settings, 1, 32, 16);
    expect(later.data).not.toEqual(first.data);
  });

  it('places a sun toward +X at the path tracer lat-long azimuth', () => {
    const image = bakeEnvironmentShader({
      ...DEFAULT_ENVIRONMENT_SHADER,
      zenithColor: [0, 0, 0],
      horizonColor: [0, 0, 0],
      groundColor: [0, 0, 0],
      sunDirection: [1, 0, 0],
      sunAngularDiameter: 20,
      sunIntensity: 2,
    }, 0, 64, 32);
    const towardPositiveX = (16 * 64 + 32) * 3;
    const towardNegativeX = (16 * 64) * 3;
    expect(image.data[towardPositiveX]).toBeGreaterThan(image.data[towardNegativeX]!);
  });

  it('rejects inputs outside the ranges declared by its NodeDef', () => {
    expect(() => bakeEnvironmentShader({ ...DEFAULT_ENVIRONMENT_SHADER, exposure: 11 })).toThrow(/NodeDef ranges/);
  });
});
