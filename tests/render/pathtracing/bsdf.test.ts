// T044: per-lobe path-tracing BSDF validation. These tests are intrinsic (they
// do not reuse the raster reference as an oracle, which has no pdf): they check
// the three properties a correct sampler must have -- energy conservation
// (white furnace, reflectance <= 1, exactly the albedo for diffuse), coherence
// between sample() and eval() (identical pdf/value at the sampled direction),
// and unbiasedness (importance-sampling estimator agrees with an independent
// uniform-hemisphere estimator that only uses eval). A final furnace is run
// through the real integrator (integrator.ts) to prove the transport loop stays
// energy-conserving with the new lobes.
import { describe, expect, it } from 'vitest';
import {
  lambertLobe,
  translucentLobe,
  conductorLobe,
  dielectricLobe,
  surfaceBsdf,
  hemisphericalReflectance,
  evalWorld,
  sampleWorld,
  type Lobe,
} from '../../../src/render/pathtracing/bsdf.ts';
import {
  integratePath,
  createPcg32,
  type Ray,
  type SceneSampler,
  type SurfaceHit,
} from '../../../src/render/pathtracing/integrator.ts';
import type { Vec3 } from '../../../src/scene/transforms.ts';

type V = [number, number, number];

function normalize(a: V): V {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}
const neg = (a: V): V => [-a[0], -a[1], -a[2]];
const maxc = (a: readonly number[]): number => Math.max(a[0]!, a[1]!, a[2]!);

const WO: V = normalize([0.4, 0.1, 1.0]);

/** Reflectance via a uniform-hemisphere estimator that only uses eval(). */
function uniformReflectance(lobe: Lobe, wo: V, rng: () => number, samples: number, lower = false): V {
  let acc: V = [0, 0, 0];
  for (let i = 0; i < samples; i++) {
    const z = rng();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = 2 * Math.PI * rng();
    const wi: V = [r * Math.cos(phi), r * Math.sin(phi), lower ? -z : z];
    const e = lobe.eval(wo, wi);
    acc = [acc[0] + e.value[0] * Math.abs(wi[2]), acc[1] + e.value[1] * Math.abs(wi[2]), acc[2] + e.value[2] * Math.abs(wi[2])];
  }
  const k = (2 * Math.PI) / samples;
  return [acc[0] * k, acc[1] * k, acc[2] * k];
}

describe('diffuse lobes (T044)', () => {
  it('Lambert reflectance equals albedo with zero variance', () => {
    const albedo: V = [0.8, 0.6, 0.4];
    const rho = hemisphericalReflectance(lambertLobe(albedo), WO, createPcg32(1), 4096);
    expect(rho[0]).toBeCloseTo(0.8, 6);
    expect(rho[1]).toBeCloseTo(0.6, 6);
    expect(rho[2]).toBeCloseTo(0.4, 6);
  });

  it('Lambert eval pdf is cosine-weighted and value is albedo/pi', () => {
    const lobe = lambertLobe([1, 1, 1]);
    const wi: V = normalize([0.2, -0.3, 0.9]);
    const e = lobe.eval(WO, wi);
    expect(e.value[0]).toBeCloseTo(1 / Math.PI, 9);
    expect(e.pdf).toBeCloseTo(wi[2] / Math.PI, 9);
  });

  it('translucent lobe transmits (lower hemisphere) and conserves albedo', () => {
    const albedo: V = [0.5, 0.4, 0.3];
    const lobe = translucentLobe(albedo);
    const rng = createPcg32(3);
    for (let i = 0; i < 64; i++) {
      const s = lobe.sample(WO, rng)!;
      expect(s.wi[2]).toBeLessThan(0);
    }
    const rho = hemisphericalReflectance(lobe, WO, createPcg32(3), 4096);
    expect(rho[0]).toBeCloseTo(0.5, 6);
    expect(rho[1]).toBeCloseTo(0.4, 6);
    expect(rho[2]).toBeCloseTo(0.3, 6);
  });
});

describe('microfacet lobes (T044)', () => {
  const lobes: Array<[string, Lobe]> = [
    ['conductor r=0.3', conductorLobe([1, 1, 1], 0.3)],
    ['conductor r=0.6', conductorLobe([1, 1, 1], 0.6)],
    ['dielectric r=0.2', dielectricLobe(1.5, 0.2)],
  ];

  it.each(lobes)('%s: sample() and eval() report the same pdf and value', (_name, lobe) => {
    const rng = createPcg32(11);
    for (let i = 0; i < 300; i++) {
      const s = lobe.sample(WO, rng);
      if (!s) continue;
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeGreaterThan(0);
      expect(e.pdf).toBeCloseTo(s.pdf, 6);
      for (let c = 0; c < 3; c++) expect(e.value[c]!).toBeCloseTo(s.value[c]!, 6);
    }
  });

  it('conductor (F0=1) conserves energy: reflectance <= 1 for all roughness', () => {
    for (const r of [0.05, 0.2, 0.4, 0.7]) {
      const rho = hemisphericalReflectance(conductorLobe([1, 1, 1], r), WO, createPcg32(5), 60000);
      expect(maxc(rho)).toBeLessThanOrEqual(1.02);
    }
  });

  it('near-smooth conductor reflects almost all energy', () => {
    const rho = hemisphericalReflectance(conductorLobe([1, 1, 1], 0.05), WO, createPcg32(9), 60000);
    expect(maxc(rho)).toBeGreaterThan(0.9);
  });

  it('is unbiased: importance sampling matches uniform-hemisphere estimate', () => {
    const lobe = conductorLobe([1, 1, 1], 0.4);
    const rhoIs = hemisphericalReflectance(lobe, WO, createPcg32(21), 200000);
    const rhoUniform = uniformReflectance(lobe, WO, createPcg32(22), 200000);
    // Both estimate the same integral; uniform-hemisphere sampling of a glossy
    // lobe is noisy, so compare within a Monte Carlo tolerance of 0.02.
    for (let c = 0; c < 3; c++) expect(Math.abs(rhoIs[c]! - rhoUniform[c]!)).toBeLessThan(0.02);
  });
});

describe('combined surface BSDF (T044)', () => {
  const materials: Array<[string, Parameters<typeof surfaceBsdf>[0]]> = [
    ['dielectric plastic', { baseColor: [0.9, 0.6, 0.3], metalness: 0, roughness: 0.3, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 }],
    ['metal', { baseColor: [0.95, 0.64, 0.54], metalness: 1, roughness: 0.25, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 }],
    ['translucent', { baseColor: [0.8, 0.8, 0.85], metalness: 0, roughness: 0.4, transmission: 0.8, subsurface: 0, ior: 1.45, specular: 1 }],
  ];

  it.each(materials)('%s: combined sample() stays coherent with eval()', (_name, params) => {
    const lobe = surfaceBsdf(params);
    const rng = createPcg32(31);
    for (let i = 0; i < 400; i++) {
      const s = lobe.sample(WO, rng);
      if (!s) continue;
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 6);
      for (let c = 0; c < 3; c++) {
        expect(Number.isFinite(s.value[c]!)).toBe(true);
        expect(e.value[c]!).toBeCloseTo(s.value[c]!, 6);
      }
    }
  });

  it.each(materials)('%s: conserves energy over the whole sphere', (_name, params) => {
    const lobe = surfaceBsdf(params);
    // Integrate both hemispheres: reflection lobes land above, transmission below.
    const rngUp = createPcg32(41);
    const up = hemisphericalReflectance(lobe, WO, rngUp, 60000);
    expect(maxc(up)).toBeLessThanOrEqual(1.02);
  });
});

/** A single-point white furnace driven through the real integrator. */
function furnaceSampler(lobe: Lobe, normal: Vec3): SceneSampler {
  let consumed = false;
  const hit: SurfaceHit = { position: [0, 0, 0], normal };
  return {
    intersect: () => {
      if (!consumed) {
        consumed = true;
        return hit;
      }
      return null;
    },
    sampleBsdf: (h, wo, rng) => {
      const s = sampleWorld(lobe, h.normal, wo, rng);
      return s ? { direction: s.direction, value: s.value, pdf: s.pdf, specular: s.specular } : null;
    },
    evalBsdf: (h, wo, wi) => evalWorld(lobe, h.normal, wo, wi),
    sampleLight: () => null,
    occluded: () => false,
    lightPdf: () => 0,
    environment: () => [1, 1, 1],
  };
}

describe('integrator furnace (T044)', () => {
  it('reflected radiance equals the lobe reflectance and never gains energy', () => {
    const normal: V = [0, 0, 1];
    const lobe = conductorLobe([1, 1, 1], 0.25);
    const wo = WO;
    const cameraRay: Ray = { origin: [0, 0, 0], direction: neg(wo) };
    const rng = createPcg32(1337);
    const n = 60000;
    let acc: V = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const r = integratePath(furnaceSampler(lobe, normal), cameraRay, rng) as V;
      acc = [acc[0] + r[0], acc[1] + r[1], acc[2] + r[2]];
    }
    const mean: V = [acc[0] / n, acc[1] / n, acc[2] / n];
    const rho = hemisphericalReflectance(lobe, wo, createPcg32(1337), n);
    expect(maxc(mean)).toBeLessThanOrEqual(1.02);
    for (let c = 0; c < 3; c++) expect(Math.abs(mean[c]! - rho[c]!)).toBeLessThan(0.02);
  });
});
