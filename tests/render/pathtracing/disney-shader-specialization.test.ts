import { describe, expect, it } from 'vitest';
import { DISNEY_INTEGRATOR_WGSL } from '../../../src/render/pathtracing/disney-integrator-wgsl.ts';
import {
  assertDisneyShaderSpecialization, specializeDisneyShader, type DisneyShaderSpecialization,
} from '../../../src/render/pathtracing/disney-shader-specialization.ts';

const options: DisneyShaderSpecialization = {
  lightCount: 0, rrDepth: 2, russianRoulette: true, uniformLight: false, hideEmitters: false,
  transparentBackground: false, alphaTest: true, medium: false, volumeMis: false,
  flipNormalY: false, mollify: false, environmentLinear: true,
};

describe('Disney shader specialization', () => {
  it('folds fixed transport options while leaving depth and environment dynamic', () => {
    const shader = specializeDisneyShader(DISNEY_INTEGRATOR_WGSL, options);
    const traceStart = shader.indexOf('fn disneyPathTrace(');
    const traceEnd = shader.indexOf('\n}\n', traceStart);
    const directStart = shader.indexOf('fn disneyPathDirect(');
    const directEnd = shader.indexOf('fn disneyPathTrace(', directStart);
    const trace = shader.slice(traceStart, traceEnd);
    const direct = shader.slice(directStart, directEnd);

    expect(trace).toContain('options.maxDepth');
    expect(trace).toContain('options.environment');
    expect(trace).not.toContain('options.lightCount');
    expect(trace).not.toContain('options.rrDepth');
    expect(direct).toContain('options.environment');
    expect(direct).not.toContain('options.lightCount');
    expect(direct).toContain('if (false && false)');
  });

  it('rejects invalid compile-time counts', () => {
    expect(() => specializeDisneyShader(DISNEY_INTEGRATOR_WGSL, { ...options, lightCount: -1 }))
      .toThrow(/lightCount/);
    expect(() => specializeDisneyShader(DISNEY_INTEGRATOR_WGSL, { ...options, rrDepth: 1.5 }))
      .toThrow(/rrDepth/);
  });

  it('rejects render settings that no longer match the compiled options', () => {
    expect(() => assertDisneyShaderSpecialization({ ...options, medium: true }, options)).toThrow(/medium/);
  });

  it('fails explicitly when the expected WGSL function shape changes', () => {
    expect(() => specializeDisneyShader('fn unrelated() {}', options)).toThrow(/disneyPathTrace/);
  });
});
