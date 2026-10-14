// T056h: full-stack closure assembly on the CPU oracle. The layered sampler now
// folds the sheen and fuzz layers into the weighted lobe stack (they ride as
// extra sheen lobes). These tests pin the stack intrinsics -- energy stays below
// one (global furnace), the sampler stays coherent and unbiased, the sheen/fuzz
// layers actually add grazing energy, and a stack whose optional layers are all
// zero/absent is byte-for-byte the prior response (non-regression anchor for the
// weighted-lobe assembly). The WGSL mirror (mx_closure_eval/pdf/sample) is checked
// structurally in tests/compiler/closure-library.test.ts; device parity is T059.
import { describe, expect, it } from 'vitest';
import {
  layeredSurfaceBsdf,
  hemisphericalReflectance,
  type Lobe,
} from '../../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import type { LayeredBsdfLobe, LayeredClosure } from '../../../src/compiler/ir.ts';

type V = [number, number, number];

function normalize(a: V): V {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}

const WO: V = normalize([0.9, 0.1, 0.25]);

const diffuse: LayeredBsdfLobe = { kind: 'burley_diffuse', weight: 1, color: [0.2, 0.2, 0.2] };

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

const fullStack: LayeredClosure = {
  lobes: [diffuse],
  sheen: { weight: 0.6, color: [1, 1, 1], roughness: 0.3 },
  fuzz: { weight: 0.3, color: [0.8, 0.9, 1], roughness: 0.5 },
  opacity: 1,
};

describe('full-stack closure assembly (T056h)', () => {
  it('conserves energy: the full stack reflectance stays below one (furnace)', () => {
    const lobe = layeredSurfaceBsdf(fullStack);
    const rho = hemisphericalReflectance(lobe, WO, createPcg32(3), 65536);
    for (let c = 0; c < 3; c++) expect(rho[c]).toBeLessThanOrEqual(1.001);
  });

  it('sampler is coherent: pdf and value match eval at the sampled direction', () => {
    const lobe = layeredSurfaceBsdf(fullStack);
    const rng = createPcg32(5);
    for (let i = 0; i < 256; i++) {
      const s = lobe.sample(WO, rng);
      if (!s || s.pdf <= 0) continue;
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 10);
      for (let c = 0; c < 3; c++) expect(e.value[c]).toBeCloseTo(s.value[c]!, 10);
    }
  });

  it('is unbiased: importance-sampling reflectance agrees with a uniform estimator', () => {
    const lobe = layeredSurfaceBsdf(fullStack);
    const importance = hemisphericalReflectance(lobe, WO, createPcg32(11), 200000);
    const uniform = uniformReflectance(lobe, WO, createPcg32(99), 200000);
    for (let c = 0; c < 3; c++) expect(Math.abs(importance[c]! - uniform[c]!)).toBeLessThan(0.02);
  });

  it('activates sheen and fuzz: a layered stack adds grazing energy over the bare base', () => {
    const bare = layeredSurfaceBsdf({ lobes: [diffuse], opacity: 1 });
    const layered = layeredSurfaceBsdf(fullStack);
    const rhoBare = hemisphericalReflectance(bare, WO, createPcg32(7), 200000);
    const rhoLayered = hemisphericalReflectance(layered, WO, createPcg32(7), 200000);
    for (let c = 0; c < 3; c++) expect(rhoLayered[c]).toBeGreaterThan(rhoBare[c]!);
  });

  it('zero-weight sheen/fuzz layers are inert (non-regression)', () => {
    const plain = layeredSurfaceBsdf({ lobes: [diffuse], opacity: 1 });
    const zeroed = layeredSurfaceBsdf({
      lobes: [diffuse],
      sheen: { weight: 0, color: [1, 1, 1], roughness: 0.3 },
      fuzz: { weight: 0, color: [1, 1, 1], roughness: 0.5 },
      opacity: 1,
    });
    const rng = createPcg32(13);
    for (let i = 0; i < 64; i++) {
      const wi = normalize([rng() * 2 - 1, rng() * 2 - 1, rng()]);
      const a = plain.eval(WO, wi);
      const b = zeroed.eval(WO, wi);
      for (let c = 0; c < 3; c++) expect(b.value[c]).toBeCloseTo(a.value[c]!, 12);
      expect(b.pdf).toBeCloseTo(a.pdf, 12);
    }
  });
});
