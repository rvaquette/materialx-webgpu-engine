import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import { createPcg32, integratePath, type SceneSampler } from '../../../src/render/pathtracing/integrator.ts';
import {
  estimateSlabResponse,
  burleyProfile,
  burleyRadialPdf,
  sampleBurleyRadius,
  burleyDiffusionLength,
  exponentialSubsurfaceMedium,
  sampleBurleySurface,
  extinctionFromMeanFreePath,
  randomWalkSlabChannel,
  singleScatterAlbedo,
  subsurfaceMedium,
} from '../../../src/render/pathtracing/subsurface.ts';
import { extinction } from '../../../src/render/pathtracing/media.ts';
import { packLayeredMaterial, unpackLayeredMaterial } from '../../../src/render/pathtracing/material-record.ts';
import { serializeLayeredClosure, deserializeLayeredClosure } from '../../../src/compiler/layered-serialize.ts';
import type { LayeredClosure } from '../../../src/compiler/ir.ts';

describe('normalized Burley diffusion', () => {
  it('lets forty SSS collisions finish with a budget of two surface bounces', () => {
    const render = (maxBounces: number, random: () => number = () => 0.25) => {
      let intersections = 0;
      const medium = { absorption: [0, 0, 0] as Vec3, scattering: [1, 1, 1] as Vec3, anisotropy: 0 };
      const scene: SceneSampler = {
        intersect(ray) {
          intersections++;
          if (intersections === 1) return { position: [0, 0, 0], normal: [0, 0, 1],
            interiorMedium: medium, subsurfaceInterior: true };
          if (intersections > 42) return null;
          const distance = intersections < 42 ? 100 : 1e-9;
          return { position: ray.origin.map((value, index) => value + ray.direction[index]! * distance) as unknown as Vec3,
            normal: ray.direction };
        },
        sampleBsdf: hit => ({ direction: intersections === 1 ? [0, 0, -1] : hit.normal,
          value: [1, 1, 1], pdf: 1, transmission: true }),
        evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }), sampleLight: () => null,
        occluded: () => false, lightPdf: () => 0, environment: () => [1, 1, 1],
      };
      return { value: integratePath(scene, { origin: [0, 0, 1], direction: [0, 0, -1] }, random,
        { maxBounces, minBounces: 3 }), intersections };
    };
    const shallow = render(2);
    expect(shallow.intersections).toBe(43);
    expect(shallow.value[0]).toBeCloseTo((1 / 0.95) ** 37, 10);
    expect(shallow.value).toEqual(render(12).value);
    expect(shallow.value).toEqual(render(64).value);
    const random = createPcg32(731);
    let energy = 0;
    for (let sample = 0; sample < 4096; sample++) energy += render(2, random).value[0];
    expect(Math.abs(energy / 4096 - 1)).toBeLessThan(0.1);
  });

  it('reflects an internal path above the critical angle when sssIOR exceeds one', () => {
    const directions: Vec3[] = [];
    const vacuum = { absorption: [0, 0, 0] as Vec3, scattering: [0, 0, 0] as Vec3, anisotropy: 0 };
    const sampler: SceneSampler = {
      intersect(ray) {
        directions.push(ray.direction);
        if (directions.length === 1) return { position: [0, 0, 0], normal: [0, 0, 1], interiorMedium: vacuum, interiorIor: 1.5,
          subsurfaceInterior: true };
        if (directions.length === 2) return { position: [1, 0, -0.1], normal: [1, 0, 0] };
        if (directions.length === 3) return { position: [-1, 0, -2], normal: [-0.6, 0, -0.8] };
        return null;
      },
      sampleBsdf: () => directions.length === 1
        ? { direction: [0.6, 0, -0.8], value: [1.25, 1.25, 1.25], pdf: 1, transmission: true }
        : { direction: [-0.6, 0, -0.8], value: [1, 1, 1], pdf: 1, transmission: true },
      evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }), sampleLight: () => null,
      occluded: () => false, lightPdf: () => 0, environment: () => [1, 1, 1],
    };
    expect(integratePath(sampler, { origin: [0, 0, 1], direction: [0, 0, -1] }, createPcg32(21),
      { maxBounces: 2 })).toEqual([1, 1, 1]);
    expect(directions[2]?.[0]).toBeCloseTo(-0.6, 12);
  });
  it('preserves transport, radius and IOR across GPU records and JSON', () => {
    const closure: LayeredClosure = { opacity: 1, lobes: [{
      kind: 'subsurface', weight: 1, color: [0.5, 0.5, 0.5], subsurfaceTransport: 3,
      subsurfaceRadius: [1, 2, 3], ior: 1.5,
    }] };
    expect(unpackLayeredMaterial(packLayeredMaterial(closure))).toEqual(closure);
    expect(deserializeLayeredClosure(serializeLayeredClosure(closure))).toEqual(closure);
  });
  it('moves the exit point and preserves diffuse albedo on a plane', () => {
    const rng = createPcg32(19);
    const entry = { position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    let displacement = 0;
    let energy = 0;
    let exits = 0;
    const samples = 10000;
    for (let index = 0; index < samples; index++) {
      const event = sampleBurleySurface(entry, [0.6, 0.6, 0.6], [1, 1, 1], 2, 0,
        (probe, axis) => Math.abs(axis[2]) > 0.5 ? [{ position: probe, normal: entry.normal }] : [], rng);
      if (!event) continue;
      expect(event.weight[0]).toBeCloseTo(1.2, 10);
      energy += event.weight[0];
      exits++;
      displacement += Math.hypot(...event.hit.position);
    }
    expect(displacement / exits).toBeCloseTo(1, 1);
    expect(Math.abs(energy / samples - 0.6)).toBeLessThan(0.05);
    expect(sampleBurleySurface(entry, [1, 1, 1], [1, 1, 1], 2, 0, () => [], rng)).toBeNull();
  });

  it('uses the geometric Jacobian while retaining the smooth exit normal for lighting', () => {
    const entry = { position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const smoothNormal: Vec3 = [0, 0.6, 0.8];
    const event = sampleBurleySurface(entry, [0.6, 0.6, 0.6], [1, 1, 1], 2, 0,
      (probe, axis) => Math.abs(axis[2]) > 0.5
        ? [{ position: probe, normal: smoothNormal, geometricNormal: entry.normal }] : [], () => 0.1)!;
    expect(event.hit.normal).toEqual(smoothNormal);
    expect(event.hit.geometricNormal).toEqual(entry.normal);
    expect(event.weight[0]).toBeCloseTo(1.2, 10);
  });

  it('retains the local response of zero-radius colour channels', () => {
    const entry = { position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const event = sampleBurleySurface(entry, [0.2, 0.4, 0.6], [1, 0, 0], 2, 0,
      () => [], () => 0.5)!;
    expect(event.hit).toBe(entry);
    expect(event.weight[0]).toBe(0);
    expect(event.weight[1]).toBeCloseTo(0.6, 12);
    expect(event.weight[2]).toBeCloseTo(0.9, 12);
  });
  it('distinguishes diffuse radial distance from volumetric mean free path', () => {
    const radius: Vec3 = [1, 2, 3];
    const diffuse = burleyDiffusionLength([0.5, 0.5, 0.5], radius, 2);
    expect(diffuse).toEqual([0.4, 0.8, 1.2]);
    expect(burleyDiffusionLength([0.5, 0.5, 0.5], radius, 3)[0]).toBeGreaterThan(diffuse[0]);
    const medium = exponentialSubsurfaceMedium([0.5, 0.5, 0.5], radius);
    expect(extinction(medium)[0]).toBeCloseTo(1, 12);
    expect(extinction(medium)[1]).toBeCloseTo(0.5, 12);
  });
  it('integrates to unit energy over surface area', () => {
    const step = 0.001;
    let energy = 0;
    for (let index = 0; index < 60000; index++) {
      const radius = (index + 0.5) * step;
      energy += 2 * Math.PI * radius * burleyProfile(radius, 1) * step;
    }
    expect(energy).toBeCloseTo(1, 6);
  });

  it('samples the two-exponential radial mixture with the correct mean', () => {
    const rng = createPcg32(301);
    let sum = 0;
    const samples = 100000;
    for (let index = 0; index < samples; index++) sum += sampleBurleyRadius(0.4, rng(), rng());
    expect(sum / samples).toBeCloseTo(2.5 * 0.4, 2);
    expect(sampleBurleyRadius(0.8, 0.5, 0.3)).toBeCloseTo(2 * sampleBurleyRadius(0.4, 0.5, 0.3), 12);
  });

  it('handles the zero-radius Lambert limit and radial density at the origin', () => {
    expect(burleyProfile(0, 0)).toBe(0);
    expect(burleyRadialPdf(0, 1)).toBe(0.5);
    expect(sampleBurleyRadius(0, 0.5, 0.5)).toBe(0);
    expect(Number.isFinite(sampleBurleyRadius(1, 0.5, 1))).toBe(true);
  });
});

describe('single-scatter albedo inversion', () => {
  it('maps black to zero and white near one', () => {
    expect(singleScatterAlbedo([0, 0, 0])).toEqual([0, 0, 0]);
    const white = singleScatterAlbedo([1, 1, 1]);
    expect(white[0]).toBeGreaterThan(0.99);
    expect(white[0]).toBeLessThan(1);
  });

  it('is monotonically increasing', () => {
    const low = singleScatterAlbedo([0.2, 0.2, 0.2])[0];
    const mid = singleScatterAlbedo([0.5, 0.5, 0.5])[0];
    const high = singleScatterAlbedo([0.8, 0.8, 0.8])[0];
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});

describe('extinction from mean free path', () => {
  it('is inversely proportional to the mean free path', () => {
    const near = extinctionFromMeanFreePath([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])[0];
    const far = extinctionFromMeanFreePath([1, 1, 1], [0.5, 0.5, 0.5])[0];
    expect(near).toBeGreaterThan(far);
    expect(near).toBeCloseTo(2 * far, 10);
  });

  it('returns zero for a zero mean free path', () => {
    expect(extinctionFromMeanFreePath([0, 0, 0], [0.5, 0.5, 0.5])).toEqual([0, 0, 0]);
  });
});

describe('random walk slab', () => {
  const entry: Vec3 = [0, 0, 1];

  it('conserves energy with no absorption (analog)', () => {
    const rng = createPcg32(3);
    const res = estimateSlabResponse([1, 1, 1], [1, 1, 1], 0, 2, entry, rng, 5000, { mode: 'analog' });
    for (let c = 0; c < 3; c += 1) {
      expect(res.reflectance[c]! + res.transmittance[c]!).toBeCloseTo(1, 10);
      expect(res.absorbed[c]!).toBeCloseTo(0, 10);
    }
  });

  it('reflects more as the slab gets thicker (no absorption)', () => {
    const rngThin = createPcg32(10);
    const rngThick = createPcg32(10);
    const thin = estimateSlabResponse([1, 1, 1], [1, 1, 1], 0, 1, entry, rngThin, 4000, { mode: 'analog' });
    const thick = estimateSlabResponse([1, 1, 1], [1, 1, 1], 0, 6, entry, rngThick, 4000, { mode: 'analog' });
    expect(thick.reflectance[0]!).toBeGreaterThan(thin.reflectance[0]!);
    expect(thick.transmittance[0]!).toBeLessThan(thin.transmittance[0]!);
  });

  it('absorbs energy when albedo < 1', () => {
    const rng = createPcg32(21);
    const res = estimateSlabResponse([0.5, 0.5, 0.5], [1, 1, 1], 0, 4, entry, rng, 6000, { mode: 'analog' });
    expect(res.absorbed[0]!).toBeGreaterThan(0.1);
    expect(res.reflectance[0]! + res.transmittance[0]!).toBeLessThan(0.95);
  });

  it('analog and weighted modes agree in expectation', () => {
    const rngA = createPcg32(55);
    const rngW = createPcg32(88);
    const analog = estimateSlabResponse([0.7, 0.7, 0.7], [1, 1, 1], 0.2, 2, entry, rngA, 20000, { mode: 'analog' });
    const weighted = estimateSlabResponse([0.7, 0.7, 0.7], [1, 1, 1], 0.2, 2, entry, rngW, 20000, {
      mode: 'weighted',
      rrProbability: 0.9,
    });
    expect(weighted.reflectance[0]!).toBeCloseTo(analog.reflectance[0]!, 1);
    expect(weighted.transmittance[0]!).toBeCloseTo(analog.transmittance[0]!, 1);
  });

  it('passes straight through a non-extincting medium', () => {
    const rng = createPcg32(1);
    const r = randomWalkSlabChannel(0, 1, 0, 1, entry, rng);
    expect(r.exit).toBe('back');
    expect(r.weight).toBe(1);
  });
});

describe('subsurfaceMedium bridge to the volumetric integrator', () => {
  const albedo: Vec3 = [0.8, 0.5, 0.3];
  const mfp: Vec3 = [0.4, 0.4, 0.4];

  it('partitions extinction into scattering + absorption by the single-scatter albedo', () => {
    const m = subsurfaceMedium(albedo, mfp, 0.1);
    const sigmaT = extinction(m);
    const expectedSigmaT = extinctionFromMeanFreePath(mfp, albedo);
    const expectedAlpha = singleScatterAlbedo(albedo);
    for (let c = 0; c < 3; c += 1) {
      expect(sigmaT[c]!).toBeCloseTo(expectedSigmaT[c]!, 10);
      expect(m.scattering[c]! / sigmaT[c]!).toBeCloseTo(expectedAlpha[c]!, 10);
      expect(m.scattering[c]! + m.absorption[c]!).toBeCloseTo(sigmaT[c]!, 10);
    }
    expect(m.anisotropy).toBe(0.1);
  });

  it('scatters more (higher albedo) for a brighter diffuse albedo', () => {
    const dark = subsurfaceMedium([0.2, 0.2, 0.2], mfp);
    const bright = subsurfaceMedium([0.9, 0.9, 0.9], mfp);
    const alphaDark = dark.scattering[0]! / extinction(dark)[0]!;
    const alphaBright = bright.scattering[0]! / extinction(bright)[0]!;
    expect(alphaBright).toBeGreaterThan(alphaDark);
  });
});
