// T055e1: the parsed-inputs bridge wraps literal surface inputs in a minimal
// ResolvedGraph so resolveSurface (T055a) + surfaceGraphToLayered (T055b) run
// without the WASM document pipeline -- the single lowering path the fixture
// builder and harnesses will share.

import { describe, it, expect, vi } from 'vitest';
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';
import {
  parsedInputsToLayered,
  parsedSurfaceToCanonical,
  surfaceFromParsedInputs,
} from '../../src/materialx/surface-from-inputs.ts';

describe('surface-from-inputs bridge (T055e1)', () => {
  it('classifies every known family from its category', () => {
    const families = ['standard_surface', 'open_pbr_surface', 'disney_principled', 'gltf_pbr', 'UsdPreviewSurface'];
    for (const category of families) {
      const surface = surfaceFromParsedInputs({ category, inputs: {} });
      expect(surface, category).not.toBeNull();
      expect(surface!.family).toBe(category);
      expect(surface!.inputs.size, category).toBeGreaterThan(0);
    }
  });

  it('authored literals override nodedef defaults', () => {
    const surface = surfaceFromParsedInputs({
      category: 'standard_surface',
      inputs: { metalness: 1, base_color: [0.2, 0.4, 0.6], specular_roughness: 0.15 },
    })!;
    expect(surface.inputs.get('metalness')!.source).toEqual({ kind: 'value', value: [1] });
    expect(surface.inputs.get('base_color')!.source).toEqual({ kind: 'value', value: [0.2, 0.4, 0.6] });
    expect(surface.inputs.get('specular_roughness')!.source).toEqual({ kind: 'value', value: [0.15] });
  });

  it('applies standard_surface version inheritance through the bridge', () => {
    const latest = surfaceFromParsedInputs({ category: 'standard_surface', inputs: {} })!;
    const legacy = surfaceFromParsedInputs({ category: 'standard_surface', inputs: {}, version: '1.0.0' })!;
    // 1.0.1 (default) overrides base=1.0 / base_color=0.8; 1.0.0 keeps base=0.8 / base_color=1.
    expect(latest.inputs.get('base')!.source).toEqual({ kind: 'default', value: [1] });
    expect(latest.inputs.get('base_color')!.source).toEqual({ kind: 'default', value: [0.8, 0.8, 0.8] });
    expect(legacy.inputs.get('base')!.source).toEqual({ kind: 'default', value: [0.8] });
    expect(legacy.inputs.get('base_color')!.source).toEqual({ kind: 'default', value: [1, 1, 1] });
  });

  it('lowers a pure metal standard_surface to a single conductor lobe', () => {
    const closure = parsedInputsToLayered({ category: 'standard_surface', inputs: { metalness: 1 } })!;
    expect(closure.lobes).toHaveLength(1);
    expect(closure.lobes[0]!.kind).toBe('conductor');
    expect(closure.lobes[0]!.weight).toBeCloseTo(1, 12);
    expect(closure.lobes[0]!.color).toEqual([0.8, 0.8, 0.8]);
  });

  it('parsedInputsToLayered equals the explicit two-step path', () => {
    const spec = { category: 'open_pbr_surface', inputs: { base_metalness: 0.5, specular_roughness: 0.25 } } as const;
    const twoStep = surfaceGraphToLayered(surfaceFromParsedInputs(spec)!);
    expect(parsedInputsToLayered(spec)).toEqual(twoStep);
  });

  it('reports an unsupported family and returns null', () => {
    const onDiagnostic = vi.fn();
    const surface = surfaceFromParsedInputs({ category: 'not_a_surface', inputs: {} }, { onDiagnostic });
    expect(surface).toBeNull();
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    expect(parsedInputsToLayered({ category: 'not_a_surface', inputs: {} }, { onDiagnostic: () => {} })).toBeNull();
  });
});

describe('parsedSurfaceToCanonical reduction (T055e4)', () => {
  it('maps standard_surface inputs and folds base into baseColor', () => {
    const canon = parsedSurfaceToCanonical({
      category: 'standard_surface',
      inputs: { base: 0.5, base_color: [0.4, 0.6, 0.8], metalness: 0.25, specular_roughness: 0.15, transmission: 0.3, subsurface: 0.1, specular_IOR: 1.7, specular: 0.9 },
    });
    expect(canon.baseColor).toEqual([0.2, 0.3, 0.4]);
    expect(canon.metalness).toBe(0.25);
    expect(canon.roughness).toBe(0.15);
    expect(canon.transmission).toBe(0.3);
    expect(canon.subsurface).toBe(0.1);
    expect(canon.ior).toBe(1.7);
    expect(canon.specular).toBe(0.9);
  });

  it('falls back to per-family defaults when inputs are missing', () => {
    expect(parsedSurfaceToCanonical({ category: 'standard_surface', inputs: {} })).toEqual({
      baseColor: [0.8, 0.8, 0.8],
      metalness: 0,
      roughness: 0.2,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 1,
    });
    expect(parsedSurfaceToCanonical({ category: 'open_pbr_surface', inputs: {} }).roughness).toBe(0.3);
    expect(parsedSurfaceToCanonical({ category: 'gltf_pbr', inputs: {} }).metalness).toBe(1);
    expect(parsedSurfaceToCanonical({ category: 'UsdPreviewSurface', inputs: {} }).baseColor).toEqual([0.18, 0.18, 0.18]);
  });

  it('keeps the disney specular=1 and usd specular=1 conventions', () => {
    expect(parsedSurfaceToCanonical({ category: 'disney_principled', inputs: { specular: 0.3 } }).specular).toBe(1);
    expect(parsedSurfaceToCanonical({ category: 'UsdPreviewSurface', inputs: {} }).specular).toBe(1);
  });

  it('preserves the gltf_pbr authored ior in the resolved and canonical surfaces', () => {
    const diagnostics: unknown[] = [];
    const surface = surfaceFromParsedInputs({ category: 'gltf_pbr', inputs: { ior: 1.52 } }, { onDiagnostic: (d) => diagnostics.push(d) })!;
    expect(surface.inputs.get('ior')?.source).toEqual({ kind: 'value', value: [1.52] });
    expect(diagnostics).toEqual([]);
    expect(parsedSurfaceToCanonical({ category: 'gltf_pbr', inputs: { ior: 1.52 } }).ior).toBe(1.52);
  });

  it('throws on an unmapped family', () => {
    expect(() => parsedSurfaceToCanonical({ category: 'not_a_surface', inputs: {} })).toThrow(/unmapped/);
  });
});
