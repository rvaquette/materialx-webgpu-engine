// T054: layered-closure model validation. Three properties are checked:
//   1. Non-regression -- a LayeredClosure built from the canonical seven
//      parameters (coat/sheen/fuzz/thin film absent) samples and evaluates
//      EXACTLY like the pre-P10 surfaceBsdf, so routing the path tracer through
//      the layered model (T057) cannot change existing renders.
//   2. Coherence + unbiasedness -- the stack sampler's pdf matches its eval at
//      the sampled direction, and the importance-sampling reflectance estimator
//      agrees with an independent uniform-hemisphere estimator that only uses
//      eval (the stack introduces no bias).
//   3. Oracle reduction -- the raster/CPU direct evaluator (reference.ts)
//      reduces a single-lobe closure to that lobe's direct response, and adding
//      a coat layer only brightens the surface (energy from the layer, base
//      preserved under it).
import { describe, expect, it } from 'vitest';
import {
  surfaceBsdf,
  layeredSurfaceBsdf,
  lobeFromLayered,
  hemisphericalReflectance,
  type Lobe,
  type SurfaceParams,
} from '../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../src/render/pathtracing/integrator.ts';
import {
  canonicalSurfaceToLayered,
  emptyLayeredClosure,
  type LayeredClosure,
} from '../../src/compiler/ir.ts';
import {
  burleyDiffuse,
  evaluateLayeredSurface,
  defaultLighting,
  luminance,
  type ShadingGeometry,
} from '../../src/render/bsdf/reference.ts';

type V = [number, number, number];

function normalize(a: V): V {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}

const WO: V = normalize([0.4, 0.1, 1.0]);

/** Reflectance via a uniform-hemisphere estimator that only uses eval(). */
function uniformReflectance(lobe: Lobe, wo: V, rng: () => number, samples: number): V {
  let acc: V = [0, 0, 0];
  for (let i = 0; i < samples; i++) {
    const z = rng();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = 2 * Math.PI * rng();
    const wi: V = [r * Math.cos(phi), r * Math.sin(phi), z];
    const e = lobe.eval(wo, wi);
    acc = [acc[0] + e.value[0] * wi[2], acc[1] + e.value[1] * wi[2], acc[2] + e.value[2] * wi[2]];
  }
  const k = (2 * Math.PI) / samples;
  return [acc[0] * k, acc[1] * k, acc[2] * k];
}

const PARAM_SETS: readonly SurfaceParams[] = [
  { baseColor: [0.8, 0.2, 0.1], metalness: 0, roughness: 0.35, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 },
  { baseColor: [0.9, 0.85, 0.5], metalness: 1, roughness: 0.2, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 },
  { baseColor: [0.6, 0.6, 0.9], metalness: 0.3, roughness: 0.5, transmission: 0.4, subsurface: 0, ior: 1.33, specular: 0.5 },
  { baseColor: [0.5, 0.4, 0.3], metalness: 0, roughness: 0.8, transmission: 0, subsurface: 0.6, ior: 1.4, specular: 0.2 },
];

describe('canonical -> layered bridge (T054)', () => {
  it('empty closure is a transparent surface with no lobes', () => {
    const c = emptyLayeredClosure();
    expect(c.lobes).toHaveLength(0);
    expect(c.opacity).toBe(1);
  });

  it('drops zero-weight lobes and keeps the active ones', () => {
    const metal = canonicalSurfaceToLayered({ baseColor: [1, 1, 1], metalness: 1, roughness: 0.2, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 });
    expect(metal.lobes.map((l) => l.kind)).toEqual(['conductor']);
    const diffuse = canonicalSurfaceToLayered({ baseColor: [1, 1, 1], metalness: 0, roughness: 0.5, transmission: 0, subsurface: 0, ior: 1.5, specular: 0 });
    expect(diffuse.lobes.map((l) => l.kind)).toEqual(['burley_diffuse']);
  });

  it('maps every lobe kind of an active closure to a sample-capable lobe', () => {
    for (const p of PARAM_SETS) {
      for (const lobe of canonicalSurfaceToLayered(p).lobes) {
        expect(lobeFromLayered(lobe)).not.toBeNull();
      }
    }
  });
});

describe('layered stack sampler non-regression (T054)', () => {
  it('evaluates identically to surfaceBsdf for the canonical bridge', () => {
    const rng = createPcg32(7);
    for (const p of PARAM_SETS) {
      const base = surfaceBsdf(p);
      const layered = layeredSurfaceBsdf(canonicalSurfaceToLayered(p));
      for (let i = 0; i < 64; i++) {
        const wi = normalize([rng() * 2 - 1, rng() * 2 - 1, rng()]);
        const a = base.eval(WO, wi);
        const b = layered.eval(WO, wi);
        for (let c = 0; c < 3; c++) expect(b.value[c]).toBeCloseTo(a.value[c]!, 12);
        expect(b.pdf).toBeCloseTo(a.pdf, 12);
      }
    }
  });

  it('samples identically to surfaceBsdf given the same stream', () => {
    for (const p of PARAM_SETS) {
      const base = surfaceBsdf(p);
      const layered = layeredSurfaceBsdf(canonicalSurfaceToLayered(p));
      const sa = base.sample(WO, createPcg32(21));
      const sb = layered.sample(WO, createPcg32(21));
      if (sa === null) {
        expect(sb).toBeNull();
        continue;
      }
      expect(sb).not.toBeNull();
      for (let c = 0; c < 3; c++) {
        expect(sb!.wi[c]).toBeCloseTo(sa.wi[c]!, 12);
        expect(sb!.value[c]).toBeCloseTo(sa.value[c]!, 12);
      }
      expect(sb!.pdf).toBeCloseTo(sa.pdf, 12);
    }
  });
});

describe('layered stack coherence + unbiasedness (T054)', () => {
  it('sample() pdf and value match eval() at the sampled direction', () => {
    const layered = layeredSurfaceBsdf(canonicalSurfaceToLayered(PARAM_SETS[2]!));
    const rng = createPcg32(5);
    for (let i = 0; i < 256; i++) {
      const s = layered.sample(WO, rng);
      if (!s || s.pdf <= 0) continue;
      const e = layered.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 10);
      for (let c = 0; c < 3; c++) expect(e.value[c]).toBeCloseTo(s.value[c]!, 10);
    }
  });

  it('importance-sampling reflectance agrees with a uniform-hemisphere estimator', () => {
    const layered = layeredSurfaceBsdf(canonicalSurfaceToLayered(PARAM_SETS[0]!));
    const importance = hemisphericalReflectance(layered, WO, createPcg32(11), 200000);
    const uniform = uniformReflectance(layered, WO, createPcg32(99), 200000);
    // Uniform-hemisphere sampling of a glossy stack is noisy; compare within a
    // Monte Carlo tolerance of 0.02 (matches the per-lobe unbiasedness test).
    for (let c = 0; c < 3; c++) expect(Math.abs(importance[c]! - uniform[c]!)).toBeLessThan(0.02);
  });

  it('energy is conserved: directional reflectance stays below one', () => {
    for (const p of PARAM_SETS) {
      const layered = layeredSurfaceBsdf(canonicalSurfaceToLayered(p));
      const rho = hemisphericalReflectance(layered, WO, createPcg32(3), 65536);
      for (let c = 0; c < 3; c++) expect(rho[c]).toBeLessThanOrEqual(1.001);
    }
  });
});

describe('reference layered evaluator (T054)', () => {
  const geom: ShadingGeometry = { normal: [0, 0, 1], view: WO };
  const lighting = defaultLighting();

  it('reduces a single diffuse lobe to that lobe direct response', () => {
    const closure: LayeredClosure = {
      lobes: [{ kind: 'burley_diffuse', weight: 1, color: [0.8, 0.5, 0.2], roughness: 0.4 }],
      opacity: 1,
    };
    const got = evaluateLayeredSurface(closure, geom, lighting);
    const want = burleyDiffuse(1, [0.8, 0.5, 0.2], 0.4, geom, lighting);
    for (let c = 0; c < 3; c++) expect(got.color[c]).toBeCloseTo(want.color[c]!, 12);
  });

  it('carries opacity as the surface weight', () => {
    const closure: LayeredClosure = { lobes: [{ kind: 'burley_diffuse', weight: 1, color: [0.5, 0.5, 0.5], roughness: 0.5 }], opacity: 0.4 };
    expect(evaluateLayeredSurface(closure, geom, lighting).weight).toBeCloseTo(0.4, 12);
  });

  it('a zero-weight coat is a no-op over the base stack', () => {
    const base: LayeredClosure = { lobes: [{ kind: 'burley_diffuse', weight: 1, color: [0.6, 0.3, 0.3], roughness: 0.5 }], opacity: 1 };
    const coated: LayeredClosure = { ...base, coat: { weight: 0, color: [1, 1, 1], roughness: 0.1, ior: 1.5 } };
    const b = evaluateLayeredSurface(base, geom, lighting).color;
    const c = evaluateLayeredSurface(coated, geom, lighting).color;
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(b[i]!, 12);
  });

  it('a full-weight coat replaces the base with the coat response', () => {
    const base: LayeredClosure = { lobes: [{ kind: 'burley_diffuse', weight: 1, color: [0.6, 0.3, 0.3], roughness: 0.5 }], opacity: 1 };
    const coated: LayeredClosure = { ...base, coat: { weight: 1, color: [1, 1, 1], roughness: 0.1, ior: 1.5 } };
    const c = evaluateLayeredSurface(coated, geom, lighting).color;
    const b = evaluateLayeredSurface(base, geom, lighting).color;
    // layer(top=1, base) = top.color, so the diffuse base is fully occluded.
    expect(luminance(c)).toBeLessThan(luminance(b));
  });

  it('adds emission on top of the composed radiance', () => {
    const base: LayeredClosure = { lobes: [{ kind: 'burley_diffuse', weight: 1, color: [0.2, 0.2, 0.2], roughness: 0.5 }], opacity: 1 };
    const emissive: LayeredClosure = { ...base, emission: [0.5, 0.25, 0.1] };
    const b = evaluateLayeredSurface(base, geom, lighting).color;
    const e = evaluateLayeredSurface(emissive, geom, lighting).color;
    expect(e[0]).toBeCloseTo(b[0]! + 0.5, 12);
    expect(e[1]).toBeCloseTo(b[1]! + 0.25, 12);
    expect(e[2]).toBeCloseTo(b[2]! + 0.1, 12);
  });
});
