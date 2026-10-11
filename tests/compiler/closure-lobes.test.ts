// T042: numeric JS validation of the per-lobe closure corpus. Each real
// BSDF/EDF/VDF lobe is pinned in tests/fixtures/node-cases.ts with an oracle
// computed by the INDEPENDENT analytic reference (src/render/bsdf/reference.ts,
// T041). This suite checks, without a GPU, that (a) the recorded oracle is
// internally consistent (re-derived straight from the recorded params), (b) it
// obeys the physical weight invariants, (c) a few head-on values are exact, and
// (d) the leaf-closure IR lowers to WGSL that calls the matching lobe and binds
// the lighting context exactly for the lobes that integrate over the lights.
import { describe, it, expect } from 'vitest';
import {
  CLOSURE_LOBE_CASES,
  CLOSURE_LOBE_CASES_BY_CATEGORY,
  CLOSURE_LOBE_GEOM as GEOM,
  CLOSURE_LOBE_LIGHTING as LIGHTING,
  type ClosureLobeCase,
} from '../fixtures/node-cases.ts';
import { buildLobeIr } from '../fixtures/node-ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import * as ref from '../../src/render/bsdf/reference.ts';

// Re-derive the oracle straight from the recorded params (independent of how the
// case authored its `expected`), so a swapped or mislabelled param is caught.
function fromParams(c: ClosureLobeCase): ref.ReferenceClosure {
  const p = c.params;
  const f = (k: string): number => p[k]![0]!;
  const v3 = (k: string): ref.Vec3 => {
    const v = p[k]!;
    return [v[0]!, v[1]!, v[2]!];
  };
  switch (c.category) {
    case 'oren_nayar_diffuse_bsdf':
      return ref.orenNayarDiffuse(f('weight'), v3('color'), f('roughness'), GEOM, LIGHTING);
    case 'burley_diffuse_bsdf':
      return ref.burleyDiffuse(f('weight'), v3('color'), f('roughness'), GEOM, LIGHTING);
    case 'translucent_bsdf':
      return ref.translucent(f('weight'), v3('color'), GEOM, LIGHTING);
    case 'dielectric_bsdf':
      return ref.dielectric(f('weight'), v3('tint'), f('ior'), f('roughness'), GEOM, LIGHTING);
    case 'conductor_bsdf':
      return ref.conductor(f('weight'), v3('ior'), v3('extinction'), f('roughness'), GEOM, LIGHTING);
    case 'generalized_schlick_bsdf':
      return ref.generalizedSchlick(f('weight'), v3('color0'), v3('color90'), f('roughness'), GEOM, LIGHTING);
    case 'sheen_bsdf':
      return ref.sheen(f('weight'), v3('color'), f('roughness'), GEOM, LIGHTING);
    case 'subsurface_bsdf':
      return ref.subsurface(f('weight'), v3('color'), v3('radius'), GEOM, LIGHTING);
    case 'anisotropic_vdf':
      return ref.anisotropicVdf(v3('absorption'), v3('scattering'), f('anisotropy'), GEOM, LIGHTING);
    case 'uniform_edf':
      return ref.uniformEdf(v3('color'));
    case 'generalized_schlick_edf':
      return ref.generalizedSchlickEdf(v3('color'), v3('tint'), GEOM);
    default:
      throw new Error(`unmapped lobe ${c.category}`);
  }
}

describe('per-lobe closure corpus (T042)', () => {
  it('covers every real BSDF/EDF/VDF lobe exactly once', () => {
    const cats = CLOSURE_LOBE_CASES.map((c) => c.category);
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toEqual(
      expect.arrayContaining([
        'oren_nayar_diffuse_bsdf',
        'burley_diffuse_bsdf',
        'translucent_bsdf',
        'dielectric_bsdf',
        'conductor_bsdf',
        'generalized_schlick_bsdf',
        'sheen_bsdf',
        'subsurface_bsdf',
        'anisotropic_vdf',
        'uniform_edf',
        'generalized_schlick_edf',
      ]),
    );
  });

  for (const c of CLOSURE_LOBE_CASES) {
    describe(c.category, () => {
      it('has a finite 4-wide oracle', () => {
        expect(c.expected).toHaveLength(4);
        for (const v of c.expected) expect(Number.isFinite(v)).toBe(true);
      });

      it('matches an independent re-derivation from the recorded params', () => {
        const got = fromParams(c);
        const expected = [got.color[0], got.color[1], got.color[2], got.weight];
        c.expected.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 10));
      });

      it('obeys the weight invariant for its closure kind', () => {
        const weight = c.expected[3]!;
        if (c.kind === 'edf') {
          expect(weight).toBe(0);
        } else if (c.kind === 'vdf') {
          expect(weight).toBeGreaterThan(0);
          expect(weight).toBeLessThanOrEqual(1);
        } else {
          // Real BSDF lobes carry their reflectance as the input weight.
          expect(weight).toBeCloseTo(c.params.weight![0]!, 12);
        }
      });

      it('lowers to WGSL that calls the lobe and binds lighting iff it integrates lights', () => {
        const mod = emitWgsl(buildLobeIr(c));
        expect(mod.outputs[0]!.wgslType).toBe('Closure');
        expect(mod.code).toContain(`mx_${c.category}(`);
        expect(Boolean(mod.lighting)).toBe(c.usesLighting);
        if (c.usesLighting) {
          expect(mod.code).toContain('@group(0) @binding(1) var<uniform> mxLighting');
        }
      });
    });
  }

  it('pins exact head-on values for the emission and transmission lobes', () => {
    const near = (cat: string, exp: readonly number[]): void => {
      const c = CLOSURE_LOBE_CASES_BY_CATEGORY.get(cat)!;
      c.expected.forEach((v, i) => expect(v).toBeCloseTo(exp[i]!, 10));
    };
    // Uniform emission: radiance = color, no reflectance.
    near('uniform_edf', [0.5, 0.25, 0.1, 0]);
    // Directional Schlick emission, head-on (N.V = 1): f = 0 -> color0.
    near('generalized_schlick_edf', [0.8, 0.1, 0.1, 0]);
    // Diffuse transmission with a front light contributes the ambient term only:
    // color * environment(0.03) * weight(0.7).
    near('translucent_bsdf', [0.5 * 0.03 * 0.7, 0.7 * 0.03 * 0.7, 0.9 * 0.03 * 0.7, 0.7]);
  });

  it('produces a lit specular response above the pure-ambient floor (head-on)', () => {
    const forCat = (cat: string): ClosureLobeCase => CLOSURE_LOBE_CASES_BY_CATEGORY.get(cat)!;
    for (const cat of ['dielectric_bsdf', 'conductor_bsdf', 'generalized_schlick_bsdf', 'sheen_bsdf']) {
      const c = forCat(cat);
      const lum = c.expected[0]! + c.expected[1]! + c.expected[2]!;
      expect(lum, `${cat} should have a non-trivial lit response`).toBeGreaterThan(0.01);
    }
  });
});
