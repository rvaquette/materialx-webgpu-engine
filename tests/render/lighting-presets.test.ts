import { describe, expect, it } from 'vitest';
import { bakeEnvironmentShader } from '../../src/materialx/engine-shaders.ts';
import { lightingPreset } from '../../src/render/lighting-presets.ts';

describe('lookdev lighting presets', () => {
  it('creates valid distinct procedural HDR environments', () => {
    const studio = bakeEnvironmentShader(lightingPreset('studio'), 0, 32, 16);
    const exterior = bakeEnvironmentShader(lightingPreset('exterior'), 0, 32, 16);
    const gradient = bakeEnvironmentShader(lightingPreset('gradient'), 0, 32, 16);
    expect(studio.data).not.toEqual(exterior.data);
    expect(gradient.data).not.toEqual(exterior.data);
    expect([...studio.data, ...exterior.data, ...gradient.data].every(Number.isFinite)).toBe(true);
  });

  it('returns independent settings and rejects unknown presets', () => {
    const first = lightingPreset('studio');
    (first.groundColor as [number, number, number])[0] = 100;
    expect(lightingPreset('studio').groundColor[0]).not.toBe(100);
    expect(() => lightingPreset('missing' as 'studio')).toThrow('Unknown lighting preset');
  });
});
