// T055b: surfaceGraphToLayered maps a resolved surface (src/materialx/
// surface-graph.ts) to a LayeredClosure (src/compiler/ir.ts). These tests build a
// ResolvedGraph as plain data, run it through resolveSurface, then lower it and
// assert the produced lobes/layers. The oracle is evaluateLayeredSurface
// (src/render/bsdf/reference.ts); the non-regression anchor is
// canonicalSurfaceToLayered.

import { describe, it, expect } from 'vitest';
import featureAlphaXml from '../../scenes/mtlx-library/surfaces/gltf_pbr/feature_alpha/feature_alpha.mtlx?raw';
import type {
  ResolvedGraph,
  ResolvedInput,
  ResolvedNode,
  ResolvedValueSource,
} from '../../src/materialx/graph.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';
import { canonicalSurfaceToLayered, type LayeredClosure } from '../../src/compiler/ir.ts';
import {
  evaluateLayeredSurface,
  defaultLighting,
  type ReferenceLighting,
  type ShadingGeometry,
} from '../../src/render/bsdf/reference.ts';

function val(type: string, value: string): ResolvedValueSource {
  return { kind: 'value', value, type };
}

function input(name: string, type: string, value: string): ResolvedInput {
  return { name, type, source: val(type, value), provenance: { namePath: `/mat/${name}` } };
}

function graphOf(category: string, inputs: ResolvedInput[], version?: string): ResolvedGraph {
  const id = 'SR';
  const node: ResolvedNode = {
    id,
    category,
    type: 'surfaceshader',
    nodeDef: {
      name: `ND_${category}`,
      nodeString: category,
      type: 'surfaceshader',
      ...(version !== undefined ? { version } : {}),
      implementation: { kind: 'nodegraph', name: `NG_${category}` },
    },
    inputs,
    provenance: { namePath: `/mat/${id}` },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: id, provenance: { namePath: `/mat/${id}` } }],
    nodes: new Map<string, ResolvedNode>([[id, node]]),
  };
}

function lower(category: string, inputs: ResolvedInput[], version?: string): LayeredClosure {
  const resolved = resolveSurface(graphOf(category, inputs, version));
  expect(resolved, category).not.toBeNull();
  return surfaceGraphToLayered(resolved!);
}

function lobe(closure: LayeredClosure, kind: string) {
  return closure.lobes.find((l) => l.kind === kind);
}

describe('transmission dispersion lowering', () => {
  it.each([
    ['gltf_pbr', 'metallic', 'transmission', [input('dispersion', 'float', '0.35')], 0.35],
    ['standard_surface', 'metalness', 'transmission', [input('transmission_dispersion', 'float', '40')], 0.5],
    ['open_pbr_surface', 'base_metalness', 'transmission_weight', [
      input('transmission_dispersion_scale', 'float', '0.5'),
      input('transmission_dispersion_abbe_number', 'float', '40'),
    ], 0.25],
  ] as const)('normalizes %s dispersion without changing the material', (family, metal, trans, inputs, expected) => {
    const closure = lower(family, [input(metal, 'float', '0'), input(trans, 'float', '1'), ...inputs]);
    expect(lobe(closure, 'dielectric_transmission')?.dispersion).toBeCloseTo(expected);
  });

  it('keeps metallic glTF feature materials non-transmissive even with dispersion', () => {
    const closure = lower('gltf_pbr', [input('transmission', 'float', '1'), input('dispersion', 'float', '1')]);
    expect(lobe(closure, 'dielectric_transmission')).toBeUndefined();
    expect(lobe(closure, 'conductor')?.weight).toBe(1);
  });
});

const GEOM: ShadingGeometry = { normal: [0, 0, 1], view: [0, 0, 1] };

function shade(closure: LayeredClosure, lighting: ReferenceLighting = defaultLighting()) {
  return evaluateLayeredSurface(closure, GEOM, lighting);
}

describe('surfaceGraphToLayered (T055b)', () => {
  it('keeps the feature_alpha showcase explicitly blended at half coverage', () => {
    const inputs = [...featureAlphaXml.matchAll(/<input name="([^"]+)" type="([^"]+)" value="([^"]+)"\s*\/>/g)]
      .map((match) => input(match[1]!, match[2]!, match[3]!));
    expect(inputs.find((entry) => entry.name === 'alpha_mode')?.source).toEqual(val('integer', '2'));
    expect(lower('gltf_pbr', inputs).opacity).toBe(0.5);
  });

  it.each([
    [0, 0.35, 0.5, 1],
    [1, 0.35, 0.5, 0],
    [1, 0.5, 0.5, 1],
    [1, 0.7, 0.8, 0],
    [2, 0.35, 0.5, 0.35],
    [2, -0.5, 0.5, 0],
    [2, 1.5, 0.5, 1],
  ])('applies glTF alpha mode %s to alpha %s with cutoff %s', (mode, alpha, cutoff, expected) => {
    const closure = lower('gltf_pbr', [
      input('alpha_mode', 'integer', String(mode)),
      input('alpha', 'float', String(alpha)),
      input('alpha_cutoff', 'float', String(cutoff)),
    ]);
    expect(closure.opacity).toBe(expected);
  });

  it.each([0, 1])('bounds standard_surface base reflectance and preserves HDR emission (metalness=%s)', (metalness) => {
    const closure = lower('standard_surface', [
      input('base_color', 'color3', '5, -1, 0.5'),
      input('metalness', 'float', String(metalness)),
      input('emission_color', 'color3', '10, 2, 0.5'),
      input('emission', 'float', '0.3'),
    ]);
    expect(lobe(closure, metalness ? 'conductor' : 'burley_diffuse')?.color).toEqual([1, 0, 0.5]);
    expect(closure.emission).toEqual([3, 0.6, 0.15]);
  });

  it('reduces a pure-diffuse standard_surface to a single burley lobe', () => {
    const closure = lower('standard_surface', [
      input('base', 'float', '1'),
      input('base_color', 'color3', '0.2, 0.4, 0.6'),
      input('specular', 'float', '0'),
      input('metalness', 'float', '0'),
    ]);
    expect(closure.lobes).toHaveLength(1);
    const diffuse = lobe(closure, 'burley_diffuse')!;
    expect(diffuse.weight).toBeCloseTo(1, 10);
    expect(diffuse.color).toEqual([0.2, 0.4, 0.6]);
    expect(closure.coat).toBeUndefined();
    expect(closure.opacity).toBeCloseTo(1, 10);
  });

  it('matches canonicalSurfaceToLayered on a seven-parameter standard_surface (non-regression)', () => {
    const p = { baseColor: [0.6, 0.3, 0.1] as const, metalness: 0.4, roughness: 0.35, transmission: 0.2, subsurface: 0, ior: 1.5, specular: 0.5 };
    const closure = lower('standard_surface', [
      input('base', 'float', '1'),
      input('base_color', 'color3', '0.6, 0.3, 0.1'),
      input('metalness', 'float', '0.4'),
      input('specular', 'float', '0.5'),
      input('specular_color', 'color3', '1, 1, 1'),
      input('specular_roughness', 'float', '0.35'),
      input('diffuse_roughness', 'float', '0.35'),
      input('specular_IOR', 'float', '1.5'),
      input('transmission', 'float', '0.2'),
      input('transmission_color', 'color3', '0.6, 0.3, 0.1'),
      input('subsurface', 'float', '0'),
    ]);
    const canonical = canonicalSurfaceToLayered(p);
    // Same lobe set (kind + weight) ...
    const byKind = (c: LayeredClosure) => c.lobes.map((l) => `${l.kind}:${l.weight.toFixed(6)}`).sort();
    expect(byKind(closure)).toEqual(byKind(canonical));
    // ... and the oracle renders them identically.
    const a = shade(closure);
    const b = shade(canonical);
    for (let k = 0; k < 3; k++) expect(a.color[k]!).toBeCloseTo(b.color[k]!, 10);
    expect(a.weight).toBeCloseTo(b.weight, 10);
  });

  it('captures the standard_surface coat / sheen / thin-film / emission the 7 params dropped', () => {
    const closure = lower('standard_surface', [
      input('coat', 'float', '0.5'),
      input('coat_color', 'color3', '0.9, 0.9, 1'),
      input('coat_roughness', 'float', '0.05'),
      input('coat_IOR', 'float', '1.6'),
      input('sheen', 'float', '0.3'),
      input('sheen_color', 'color3', '1, 0.8, 0.8'),
      input('thin_film_thickness', 'float', '280'),
      input('thin_film_IOR', 'float', '1.4'),
      input('emission', 'float', '2'),
      input('emission_color', 'color3', '1, 0.5, 0.25'),
    ]);
    expect(closure.coat).toEqual({ weight: 0.5, color: [0.9, 0.9, 1], roughness: 0.05, ior: 1.6 });
    expect(closure.sheen).toEqual({ weight: 0.3, color: [1, 0.8, 0.8], roughness: 0.3 });
    expect(closure.thinFilm).toEqual({ weight: 1, thickness: 280, ior: 1.4 });
    expect(closure.emission).toEqual([2, 1, 0.5]);
  });

  it('carries specular anisotropy / rotation / tint onto the specular lobes', () => {
    const closure = lower('standard_surface', [
      input('metalness', 'float', '1'),
      input('specular_anisotropy', 'float', '0.7'),
      input('specular_rotation', 'float', '0.25'),
    ]);
    const metal = lobe(closure, 'conductor')!;
    expect(metal.anisotropy).toBeCloseTo(0.7, 10);
    expect(metal.rotation).toBeCloseTo(0.25, 10);
  });

  it('fills the full open_pbr_surface stack (coat + fuzz + thin film + emission)', () => {
    const closure = lower('open_pbr_surface', [
      input('base_metalness', 'float', '0'),
      input('coat_weight', 'float', '0.6'),
      input('coat_color', 'color3', '1, 1, 1'),
      input('coat_roughness', 'float', '0.1'),
      input('coat_ior', 'float', '1.6'),
      input('fuzz_weight', 'float', '0.4'),
      input('fuzz_color', 'color3', '0.9, 0.9, 0.9'),
      input('fuzz_roughness', 'float', '0.5'),
      input('thin_film_weight', 'float', '1'),
      input('thin_film_thickness', 'float', '0.5'),
      input('thin_film_ior', 'float', '1.4'),
      input('emission_luminance', 'float', '3'),
      input('emission_color', 'color3', '1, 1, 1'),
    ]);
    expect(closure.coat).toEqual({ weight: 0.6, color: [1, 1, 1], roughness: 0.1, ior: 1.6 });
    expect(closure.fuzz).toEqual({ weight: 0.4, color: [0.9, 0.9, 0.9], roughness: 0.5 });
    expect(closure.thinFilm).toEqual({ weight: 1, thickness: 0.5, ior: 1.4 });
    expect(closure.emission).toEqual([3, 3, 3]);
    expect(lobe(closure, 'burley_diffuse')).toBeDefined();
  });

  it('lowers gltf_pbr clearcoat, sheen colour and emissive', () => {
    const closure = lower('gltf_pbr', [
      input('metallic', 'float', '0'),
      input('roughness', 'float', '0.5'),
      input('base_color', 'color3', '0.3, 0.5, 0.7'),
      input('clearcoat', 'float', '0.8'),
      input('clearcoat_roughness', 'float', '0.1'),
      input('sheen_color', 'color3', '0.4, 0.2, 0.1'),
      input('sheen_roughness', 'float', '0.3'),
      input('emissive', 'color3', '0.1, 0, 0'),
    ]);
    expect(closure.coat).toEqual({ weight: 0.8, color: [1, 1, 1], roughness: 0.1, ior: 1.5 });
    expect(closure.sheen).toEqual({ weight: 0.4, color: [0.4, 0.2, 0.1], roughness: 0.3 });
    expect(closure.emission).toEqual([0.1, 0, 0]);
  });

  it('lowers UsdPreviewSurface metallic workflow with emissive and clearcoat', () => {
    const closure = lower('UsdPreviewSurface', [
      input('diffuseColor', 'color3', '0.2, 0.3, 0.4'),
      input('metallic', 'float', '0'),
      input('roughness', 'float', '0.4'),
      input('clearcoat', 'float', '0.5'),
      input('clearcoatRoughness', 'float', '0.02'),
      input('emissiveColor', 'color3', '0, 0.2, 0'),
    ]);
    const diffuse = lobe(closure, 'burley_diffuse')!;
    expect(diffuse.color).toEqual([0.2, 0.3, 0.4]);
    expect(lobe(closure, 'conductor')).toBeUndefined();
    expect(closure.coat).toEqual({ weight: 0.5, color: [1, 1, 1], roughness: 0.02, ior: 1.5 });
    expect(closure.emission).toEqual([0, 0.2, 0]);
  });

  it('lowers disney_principled sheen tint, clearcoat gloss and subsurface', () => {
    const closure = lower('disney_principled', [
      input('baseColor', 'color3', '0.8, 0.1, 0.1'),
      input('metallic', 'float', '0'),
      input('roughness', 'float', '0.5'),
      input('sheen', 'float', '0.5'),
      input('sheenTint', 'float', '1'),
      input('clearcoat', 'float', '0.4'),
      input('clearcoatGloss', 'float', '0.75'),
      input('subsurface', 'float', '0.3'),
    ]);
    // sheenTint 1 -> fully tinted to base colour.
    expect(closure.sheen!.weight).toBeCloseTo(0.5, 10);
    for (let k = 0; k < 3; k++) expect(closure.sheen!.color[k]!).toBeCloseTo([0.8, 0.1, 0.1][k]!, 10);
    // clearcoatGloss 0.75 -> roughness 0.25.
    expect(closure.coat!.weight).toBeCloseTo(0.4, 10);
    expect(closure.coat!.roughness).toBeCloseTo(0.25, 10);
    expect(lobe(closure, 'subsurface')!.weight).toBeCloseTo(0.3, 10);
  });

  it('falls back to the nodedef value when an input is a texture connection (handled in T055c)', () => {
    const resolved = resolveSurface(
      graphOf('standard_surface', [
        input('specular', 'float', '0'),
        { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'tex', output: 'out' }, provenance: { namePath: '/mat/base_color' } },
      ]),
    )!;
    const closure = surfaceGraphToLayered(resolved);
    // Connection source has no CPU constant -> diffuse uses the white fallback.
    expect(lobe(closure, 'burley_diffuse')!.color).toEqual([1, 1, 1]);
  });
});

describe('canonicalSurfaceToLayered volumetric extension', () => {
  const base = { baseColor: [0.6, 0.3, 0.1] as const, metalness: 0, roughness: 0.3, ior: 1.5, specular: 1 };

  it('stays backward compatible when no medium params are authored', () => {
    const closure = canonicalSurfaceToLayered({ ...base, transmission: 0.5, subsurface: 0.4 });
    const trans = closure.lobes.find((l) => l.kind === 'dielectric_transmission')!;
    expect(trans.attenuationColor).toBeUndefined();
    expect(trans.attenuationDistance).toBeUndefined();
    // Subsurface without a radius stays folded into the diffuse base (T054 anchor).
    expect(closure.lobes.some((l) => l.kind === 'subsurface')).toBe(false);
  });

  it('attaches the interior attenuation onto the transmission lobe', () => {
    const closure = canonicalSurfaceToLayered({
      ...base,
      transmission: 1,
      subsurface: 0,
      attenuationColor: [0.5, 0.25, 0.1],
      attenuationDistance: 2,
    });
    const trans = closure.lobes.find((l) => l.kind === 'dielectric_transmission')!;
    expect(trans.attenuationColor).toEqual([0.5, 0.25, 0.1]);
    expect(trans.attenuationDistance).toBe(2);
  });

  it('emits a subsurface lobe carrying the radius when one is authored', () => {
    const closure = canonicalSurfaceToLayered({
      ...base,
      transmission: 0,
      subsurface: 0.6,
      subsurfaceColor: [0.9, 0.5, 0.4],
      subsurfaceRadius: [1.2, 0.4, 0.2],
    });
    const sss = closure.lobes.find((l) => l.kind === 'subsurface')!;
    expect(sss.color).toEqual([0.9, 0.5, 0.4]);
    expect(sss.subsurfaceRadius).toEqual([1.2, 0.4, 0.2]);
    expect(sss.weight).toBeCloseTo(0.6, 10);
    // The diffuse base is scaled down by the subsurface share.
    const diffuse = closure.lobes.find((l) => l.kind === 'burley_diffuse')!;
    expect(diffuse.weight).toBeCloseTo(0.4, 10);
  });
});
