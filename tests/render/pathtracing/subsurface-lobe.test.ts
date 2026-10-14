import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import type { LayeredBsdfLobe } from '../../../src/compiler/ir.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import {
  hemisphericalReflectance,
  lambertLobe,
  lobeFromLayered,
  subsurfaceLobe,
} from '../../../src/render/pathtracing/bsdf.ts';
import {
  estimateSlabResponse,
  extinctionFromMeanFreePath,
  singleScatterAlbedo,
} from '../../../src/render/pathtracing/subsurface.ts';

const wo: Vec3 = [0, 0, 1];

describe('subsurface BSDF lobe (T056g)', () => {
  it('is wired on lobeFromLayered instead of the former null fallback', () => {
    const lobe: LayeredBsdfLobe = { kind: 'subsurface', weight: 0.5, color: [0.8, 0.5, 0.3] };
    expect(lobeFromLayered(lobe)).not.toBeNull();
  });

  it('has hemispherical reflectance equal to its albedo (energy conserving)', () => {
    const albedo: Vec3 = [0.8, 0.5, 0.3];
    const rng = createPcg32(17);
    const r = hemisphericalReflectance(subsurfaceLobe(albedo), wo, rng, 4096);
    for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
      expect(r[c]!).toBeCloseTo(albedo[c]!, 12);
      expect(r[c]!).toBeLessThanOrEqual(1);
    }
  });

  it('keeps eval and sample consistent (unbiased)', () => {
    const lobe = subsurfaceLobe([0.7, 0.4, 0.2]);
    const rng = createPcg32(29);
    for (let i = 0; i < 64; i += 1) {
      const s = lobe.sample(wo, rng);
      expect(s).not.toBeNull();
      if (!s) continue;
      const e = lobe.eval(wo, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 12);
      for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
        expect(e.value[c]!).toBeCloseTo(s.value[c]!, 12);
      }
    }
  });

  it('reduces to the diffuse fallback (radius -> 0 limit)', () => {
    const albedo: Vec3 = [0.6, 0.5, 0.4];
    const sss = subsurfaceLobe(albedo);
    const diff = lambertLobe(albedo);
    // Shared PCG streams -> identical sampled directions, values and pdfs.
    const rngS = createPcg32(41);
    const rngD = createPcg32(41);
    for (let i = 0; i < 32; i += 1) {
      const s = sss.sample(wo, rngS);
      const d = diff.sample(wo, rngD);
      expect(s).not.toBeNull();
      expect(d).not.toBeNull();
      if (!s || !d) continue;
      for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
        expect(s.wi[c]!).toBeCloseTo(d.wi[c]!, 15);
        expect(s.value[c]!).toBeCloseTo(d.value[c]!, 15);
      }
      expect(s.pdf).toBeCloseTo(d.pdf, 15);
    }
  });

  it('matches the optically-thick BSSRDF reflectance of subsurface.ts (T029)', () => {
    // White medium: the optically-thick (small radius -> high extinction) slab
    // reflects most energy and transmits almost none, approaching the lobe albedo
    // of 1 from below (the brute-force walk loses a little to residual absorption).
    const albedo: Vec3 = [1, 1, 1];
    const alpha = singleScatterAlbedo(albedo);
    const entry: Vec3 = [0, 0, 1];
    const smallRadius = extinctionFromMeanFreePath([0.02, 0.02, 0.02], albedo);
    const rng = createPcg32(63);
    const thick = estimateSlabResponse(alpha, smallRadius, 0, 1, entry, rng, 4000, { mode: 'analog' });
    const lobeR = hemisphericalReflectance(subsurfaceLobe(albedo), wo, createPcg32(63), 2048);
    for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
      expect(thick.reflectance[c]!).toBeGreaterThan(0.85);
      expect(thick.transmittance[c]!).toBeLessThan(0.05);
      expect(lobeR[c]!).toBeGreaterThanOrEqual(thick.reflectance[c]!);
    }
  });

  it('increases slab reflectance as the radius shrinks toward the diffuse limit', () => {
    const albedo: Vec3 = [1, 1, 1];
    const alpha = singleScatterAlbedo(albedo);
    const entry: Vec3 = [0, 0, 1];
    const large = extinctionFromMeanFreePath([1, 1, 1], albedo);
    const small = extinctionFromMeanFreePath([0.05, 0.05, 0.05], albedo);
    const rLarge = estimateSlabResponse(alpha, large, 0, 1, entry, createPcg32(70), 4000, { mode: 'analog' });
    const rSmall = estimateSlabResponse(alpha, small, 0, 1, entry, createPcg32(70), 4000, { mode: 'analog' });
    expect(rSmall.reflectance[0]!).toBeGreaterThan(rLarge.reflectance[0]!);
  });
});
