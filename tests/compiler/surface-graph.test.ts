// T043: numeric JS validation of the surface-graph corpus. The six MaterialX
// surface nodedefs (standard_surface, open_pbr_surface, disney_principled,
// gltf_pbr, UsdPreviewSurface, simple_hair) were previously checked only for
// resolution / IR / WGSL structure. This suite executes them numerically against
// the INDEPENDENT analytic reference (src/render/bsdf/reference.ts evaluateSurface,
// T043): it (a) re-derives each PBR oracle straight from the per-lobe reference
// functions + composition ops -- independent of evaluateSurface -- so a swapped
// lobe or composition order is caught, (b) checks the opacity/weight invariant,
// (c) pins a pure-diffuse surface to the Burley lobe, and (d) verifies the surface
// IR lowers to WGSL that composes the matching lobes, binds the lighting context,
// and emits the `surface` node.
import { describe, it, expect } from 'vitest';
import {
  SURFACE_GRAPH_CASES,
  SURFACE_GRAPH_CASES_BY_CATEGORY,
  SURFACE_GRAPH_GEOM as GEOM,
  SURFACE_GRAPH_LIGHTING as LIGHTING,
  NODE_CASES,
  type SurfaceGraphCase,
} from '../fixtures/node-cases.ts';
import { buildSurfaceIr } from '../fixtures/node-ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import * as ref from '../../src/render/bsdf/reference.ts';

const FAMILIES = [
  'standard_surface',
  'open_pbr_surface',
  'disney_principled',
  'gltf_pbr',
  'UsdPreviewSurface',
  'simple_hair',
];

// Re-derive the oracle independently of evaluateSurface, by composing the per-lobe
// reference functions directly. Any divergence catches a mislabelled param or a
// composition reorder in evaluateSurface or in the recorded `expected`.
function fromLobes(c: SurfaceGraphCase): ref.ReferenceClosure {
  if (c.model === 'hair') {
    const [r, g, b] = c.params.baseColor;
    return { color: [r * c.hairWeight, g * c.hairWeight, b * c.hairWeight], weight: 1 };
  }
  const p = c.params;
  const white: ref.Vec3 = [1, 1, 1];
  const diffuseWeight = (1 - p.metalness) * (1 - p.transmission);
  const diffuse = ref.burleyDiffuse(diffuseWeight, p.baseColor, p.roughness, GEOM, LIGHTING);
  const trans = ref.translucent(p.transmission, p.baseColor, GEOM, LIGHTING);
  const subs = ref.subsurface(p.subsurface, p.baseColor, white, GEOM, LIGHTING);
  const spec = ref.dielectric(p.specular, white, p.ior, p.roughness, GEOM, LIGHTING);
  const metal = ref.generalizedSchlick(p.metalness, p.baseColor, white, p.roughness, GEOM, LIGHTING);
  const base1 = ref.closureMix(diffuse, trans, p.transmission);
  const base2 = ref.closureMix(base1, subs, p.subsurface);
  const dielectricSurface = ref.layer(spec, base2);
  const bsdf = ref.closureMix(dielectricSurface, metal, p.metalness);
  return { color: bsdf.color, weight: 1 };
}

describe('surface-graph corpus (T043)', () => {
  it('covers every surface nodedef family exactly once', () => {
    const cats = SURFACE_GRAPH_CASES.map((c) => c.category);
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toEqual(expect.arrayContaining(FAMILIES));
  });

  it('matches the graphCase surface families declared in NODE_CASES', () => {
    const graphCats = new Set(NODE_CASES.filter((c) => c.exec === 'graph').map((c) => c.category));
    for (const family of FAMILIES) {
      expect(graphCats.has(family), `${family} is not a graphCase in NODE_CASES`).toBe(true);
    }
  });

  for (const c of SURFACE_GRAPH_CASES) {
    describe(c.category, () => {
      it('has a finite 4-wide oracle with opacity weight 1', () => {
        expect(c.expected).toHaveLength(4);
        for (const v of c.expected) expect(Number.isFinite(v)).toBe(true);
        expect(c.expected[3]).toBe(1);
      });

      it('matches an independent re-derivation from the per-lobe reference', () => {
        const got = fromLobes(c);
        const expected = [got.color[0], got.color[1], got.color[2], got.weight];
        c.expected.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 10));
      });

      it('lowers to a WGSL surface module that binds lighting and emits the surface node', () => {
        const mod = emitWgsl(buildSurfaceIr(c));
        // Balanced braces + the always-present structural anchors.
        const open = (mod.code.match(/\{/g) ?? []).length;
        const close = (mod.code.match(/\}/g) ?? []).length;
        expect(open).toBe(close);
        expect(mod.code).toContain('struct Closure');
        expect(mod.code).toContain('fn mx_surface(');
        expect(mod.code).toContain('mx_surface(');
        expect(mod.outputs[0]!.wgslType).toBe('Closure');

        if (c.model === 'hair') {
          expect(mod.code).toContain('mx_chiang_hair_bsdf(');
          // The stub lobe does not integrate over the lights.
          expect(mod.lighting).toBeUndefined();
        } else {
          for (const fn of ['mx_burley_diffuse_bsdf(', 'mx_translucent_bsdf(', 'mx_subsurface_bsdf(', 'mx_dielectric_bsdf(', 'mx_generalized_schlick_bsdf(']) {
            expect(mod.code, `missing ${fn}`).toContain(fn);
          }
          // Composition ops and the lighting binding the real lobes require.
          expect(mod.code).toContain('mx_closure_mix(');
          expect(mod.code).toContain('mx_layer(');
          expect(mod.code).toContain('@group(0) @binding(1) var<uniform> mxLighting');
          expect(mod.lighting).toEqual({ group: 0, binding: 1 });
        }
      });
    });
  }

  it('reduces a pure-diffuse surface to the Burley diffuse lobe', () => {
    // metalness/transmission/subsurface/specular all 0 -> only the diffuse lobe survives.
    const params: ref.CanonicalSurfaceParams = {
      baseColor: [0.6, 0.5, 0.4],
      metalness: 0,
      roughness: 0.4,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 0,
    };
    const surf = ref.evaluateSurface(params, GEOM, LIGHTING);
    const diffuse = ref.burleyDiffuse(1, params.baseColor, params.roughness, GEOM, LIGHTING);
    surf.color.forEach((v, i) => expect(v).toBeCloseTo(diffuse.color[i]!, 10));
    expect(surf.weight).toBe(1);
  });

  it('is dominated by the generalized-Schlick metal lobe at metalness 1', () => {
    const c = SURFACE_GRAPH_CASES_BY_CATEGORY.get('standard_surface')!;
    const metal = ref.generalizedSchlick(1, c.params.baseColor, [1, 1, 1], c.params.roughness, GEOM, LIGHTING);
    c.expected.slice(0, 3).forEach((v, i) => expect(v).toBeCloseTo(metal.color[i]!, 10));
  });
});
