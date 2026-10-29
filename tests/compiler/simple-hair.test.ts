import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSurfaceInputsFromMtlx, parsedInputsToLayered, resolvedGraphFromParsedSurface, surfaceFromParsedInputs } from '../../src/materialx/surface-from-inputs.ts';
import { emitLayeredSurface, emitSurfaceVariant } from '../../src/compiler/surface-wgsl.ts';
import { assembleIrForwardShader } from '../../src/render/raster/ir-forward.ts';
import { packLayeredMaterial, unpackLayeredMaterial } from '../../src/render/pathtracing/material-record.ts';
import { evaluateLayeredSurface } from '../../src/render/bsdf/reference.ts';
import { deserializeLayeredClosure, serializeLayeredClosure } from '../../src/compiler/layered-serialize.ts';

const xml = readFileSync(join('scenes', 'mtlx-library', 'Examples', 'SimpleHair', 'simple_hair_default.mtlx'), 'utf8');

describe('SimpleHair native surface integration', () => {
  it('lowers the actual corpus material to Chiang instead of a neutral surface', () => {
    const parsed = parseSurfaceInputsFromMtlx(xml)!;
    expect(parsed.category).toBe('simple_hair');
    const closure = parsedInputsToLayered(parsed)!;
    expect(closure.opacity).toBe(1);
    expect(closure.lobes).toHaveLength(1);
    expect(closure.lobes[0]).toMatchObject({
      kind: 'chiang_hair', weight: 1, color: [1, 1, 1],
      color90: [1, 1, 1], hairTintTRT: [1, 1, 1],
      roughness: 0.1, anisotropy: 0.1, rotation: 0.5, ior: 1.55,
    });
    expect(closure.lobes[0]!.extinction!.every(value => value > 0)).toBe(true);
    const roundtrip = unpackLayeredMaterial(packLayeredMaterial(closure));
    expect(roundtrip.lobes[0]!.kind).toBe('chiang_hair');
    expect(roundtrip.lobes[0]!.hairTintTRT).toEqual([1, 1, 1]);
    for (let i = 0; i < 3; i++) {
      expect(roundtrip.lobes[0]!.extinction![i]).toBeCloseTo(closure.lobes[0]!.extinction![i]!);
    }
  });

  it('routes both GPU backends to hair eval/sample and preserves the fiber tangent', () => {
    const spec = parseSurfaceInputsFromMtlx(xml)!;
    const graph = resolvedGraphFromParsedSurface(spec);
    const surface = surfaceFromParsedInputs(spec)!;
    const module = emitLayeredSurface(graph, surface);
    const variant = emitSurfaceVariant(graph, surface, 0);
    expect(module.features?.lobeKinds).toEqual([9]);
    expect(variant.features?.lobeKinds).toEqual([9]);
    expect(module.code).toContain('return mx_hair_eval(lobe, wo, wi)');
    expect(module.code).toContain('return mx_hair_sample(lobe, wo, u)');
    expect(module.code).toContain('c.shadingTangent = vary.tangent');
    expect(module.code).toContain('mx_hair_absorption_melanin(');
    expect(variant.fnCode).toContain('MX_LOBE_CHIANG_HAIR');
    const raster = assembleIrForwardShader(module).code;
    expect(raster).toContain('|| kind == MX_LOBE_CHIANG_HAIR');
    expect(raster).toContain('mx_closure_frame(c, n, basis(n))');
  });

  it('keeps all three tint channels when packed into the constant-record fallback', () => {
    const closure = parsedInputsToLayered({
      category: 'simple_hair',
      inputs: { tint_R: [0.2, 0.4, 0.6], tint_TT: [0.3, 0.5, 0.7], tint_TRT: [0.1, 0.8, 0.9] },
    })!;
    const lobe = unpackLayeredMaterial(packLayeredMaterial(closure)).lobes[0]!;
    const restored = deserializeLayeredClosure(serializeLayeredClosure(closure));
    expect(restored.lobes[0]!.hairTintTRT).toEqual([0.1, 0.8, 0.9]);
    for (const field of ['color', 'color90', 'hairTintTRT'] as const) {
      lobe[field]!.forEach((value, i) => expect(value).toBeCloseTo(closure.lobes[0]![field]![i]!));
    }
  });

  it('changes the actual scattering response when melanin increases', () => {
    const response = (melaninConcentration: number) => {
      const closure = parsedInputsToLayered({ category: 'simple_hair', inputs: { melaninConcentration } })!;
      return evaluateLayeredSurface(closure, { normal: [0, 0, 1], view: [0, 0, 1] }, {
        environment: [1, 1, 1], lights: [],
      }).color;
    };
    const light = response(0);
    const dark = response(0.9);
    expect(light.every(Number.isFinite)).toBe(true);
    expect(dark.every(Number.isFinite)).toBe(true);
    expect(dark[0] + dark[1] + dark[2]).toBeLessThan(light[0] + light[1] + light[2]);
  });
});
