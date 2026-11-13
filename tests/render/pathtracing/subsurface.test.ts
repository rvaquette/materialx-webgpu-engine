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
  albedoPreservingSingleScatter,
  sampleDavisDensity,
  subsurfaceMedium,
} from '../../../src/render/pathtracing/subsurface.ts';
import { extinction } from '../../../src/render/pathtracing/media.ts';
import { packLayeredMaterial, unpackLayeredMaterial } from '../../../src/render/pathtracing/material-record.ts';
import { serializeLayeredClosure, deserializeLayeredClosure } from '../../../src/compiler/layered-serialize.ts';
import type { LayeredClosure } from '../../../src/compiler/ir.ts';
import { burleyInterfaceTransmission, spatialBaseAttenuation } from '../../../src/render/pathtracing/bsdf.ts';

describe('normalized Burley diffusion', () => {
  it('reduces spatial transport between opposed normals when followTopology is enabled', () => {
    const entry = { position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const project = (probe: Vec3, axis: Vec3) => Math.abs(axis[2]) > 0.5
      ? [{ position: [probe[0], probe[1], -0.1] as Vec3, normal: [0, 0, -1] as Vec3 }] : [];
    const baseline = sampleBurleySurface(entry, [0.6, 0.6, 0.6], [1, 1, 1], 2, 0, project, () => 0.1, 1, 0)!;
    const constrained = sampleBurleySurface(entry, [0.6, 0.6, 0.6], [1, 1, 1], 2, 0, project, () => 0.1, 1, 1)!;
    expect(baseline.weight[0]).toBeGreaterThan(0);
    expect(constrained.weight).toEqual([0, 0, 0]);
  });

  it.each([false, true])('selectively skips embedded geometry during continuation (enabled=%s)', (enabled) => {
    let crossings = 0;
    const vacuum = { absorption: [0, 0, 0] as Vec3, scattering: [0, 0, 0] as Vec3, anisotropy: 0 };
    const scene: SceneSampler = {
      intersect() {
        crossings++;
        if (crossings === 1) return { position: [0, 0, 0], normal: [0, 0, 1], interiorMedium: vacuum,
          subsurfaceInterior: true, subsurfaceDomain: 1, subsurfaceSelective: enabled };
        if (crossings === 2) return { position: [0, 0, -0.5], normal: [0, 0, 1], subsurfaceDomain: 2 };
        if (crossings === 3) return { position: [0, 0, -1], normal: [0, 0, -1], subsurfaceDomain: 1 };
        return null;
      },
      sampleBsdf: () => crossings === 2 ? null : { direction: [0, 0, -1], value: [1, 1, 1], pdf: 1, transmission: true },
      evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }), sampleLight: () => null,
      occluded: () => false, lightPdf: () => 0, environment: () => [1, 1, 1],
    };
    expect(integratePath(scene, { origin: [0, 0, 1], direction: [0, 0, -1] }, createPcg32(731),
      { maxBounces: 2 })).toEqual(enabled ? [1, 1, 1] : [0, 0, 0]);
  });
  it('preserves free-flight random draws and distance when ignoring foreign geometry', () => {
    const render = (embedded: boolean) => {
      let entered = false;
      let finished = false;
      let randomDraws = 0;
      const absorption = { absorption: [1, 1, 1] as Vec3, scattering: [0, 0, 0] as Vec3, anisotropy: 0 };
      const scene: SceneSampler = {
        intersect(ray) {
          if (finished) return null;
          if (!entered) return { position: [0, 0, 0], normal: [0, 0, 1], interiorMedium: absorption,
            subsurfaceInterior: true, subsurfaceDomain: 1, subsurfaceSelective: true };
          if (embedded && (ray.minDistance ?? 0) < 0.5) {
            return { position: [0, 0, -0.5], normal: [0, 0, 1], subsurfaceDomain: 2 };
          }
          expect(ray.origin).toEqual([0, 0, 0]);
          return { position: [0, 0, -1], normal: [0, 0, -1], subsurfaceDomain: 1 };
        },
        sampleBsdf() {
          if (entered) finished = true;
          entered = true;
          return { direction: [0, 0, -1], value: [1, 1, 1], pdf: 1, transmission: true };
        },
        evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }), sampleLight: () => null,
        occluded: () => false, lightPdf: () => 0, environment: () => [1, 1, 1],
      };
      const radiance = integratePath(scene, { origin: [0, 0, 1], direction: [0, 0, -1] },
        () => { randomDraws++; return 0.9; }, { maxBounces: 2 });
      return { radiance, randomDraws };
    };
    const baseline = render(false);
    expect(baseline.radiance).toEqual([1, 1, 1]);
    expect(render(true)).toEqual(baseline);
  });
  it('applies Davis density to an absorbing medium even without scattering', () => {
    const random = createPcg32(731);
    let total = 0;
    const samples = 10000;
    for (let sample = 0; sample < samples; sample++) {
      let crossings = 0;
      const scene: SceneSampler = {
        intersect() {
          crossings++;
          if (crossings === 1) return { position: [0, 0, 0], normal: [0, 0, 1], subsurfaceInterior: true,
            subsurfaceDavisBleed: 0.5, interiorMedium: { absorption: [1, 1, 1], scattering: [0, 0, 0], anisotropy: 0 } };
          if (crossings === 2) return { position: [0, 0, -1], normal: [0, 0, -1] };
          return null;
        },
        sampleBsdf: () => ({ direction: [0, 0, -1], value: [1, 1, 1], pdf: 1, transmission: true }),
        evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }), sampleLight: () => null,
        occluded: () => false, lightPdf: () => 0, environment: () => [1, 1, 1],
      };
      total += integratePath(scene, { origin: [0, 0, 1], direction: [0, 0, -1] }, random, { maxBounces: 2 })[0];
    }
    const shape = 2 - 0.75 * 0.5;
    expect(total / samples).toBeCloseTo((1 + 1 / shape) ** -shape, 1);
    expect(Math.abs(total / samples - Math.exp(-1))).toBeGreaterThan(0.05);
  });
  it.each([0, 1, 2] as const)('uses the documented exit-lighting selection for surface mode %s', (mode) => {
    let crossings = 0;
    let lightQueries = 0;
    const vacuum = { absorption: [0, 0, 0] as Vec3, scattering: [0, 0, 0] as Vec3, anisotropy: 0 };
    const scene: SceneSampler = {
      intersect() {
        crossings++;
        if (crossings === 1) return { position: [0, 0, 0], normal: [0, 0, 1], interiorMedium: vacuum,
          subsurfaceInterior: true, subsurfaceMode: mode };
        if (crossings === 2) return { position: [0, 0, -1], normal: [0, 0, -1] };
        return null;
      },
      sampleBsdf: () => ({ direction: [0, 0, -1], value: [1, 1, 1], pdf: 1, transmission: true }),
      evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }),
      sampleLight() { lightQueries++; return null; }, occluded: () => false, lightPdf: () => 0,
      environment: () => [1, 1, 1],
    };
    const radiance = integratePath(scene, { origin: [0, 0, 1], direction: [0, 0, -1] }, createPcg32(731));
    expect(radiance).toEqual(mode === 1 ? [0, 0, 0] : [1, 1, 1]);
    expect(lightQueries).toBe(mode === 2 ? 2 : 1);
  });
  it('attenuates the spatial base by the existing coat without counting the coat reflection twice', () => {
    const closure: LayeredClosure = { opacity: 1, lobes: [],
      coat: { weight: 0.6, color: [0.8, 0.9, 1], roughness: 0.2, ior: 1.5 } };
    const attenuation = spatialBaseAttenuation(closure, 1, 1);
    for (let channel = 0; channel < 3; channel++) {
      expect(attenuation[channel]).toBeCloseTo((1 - 0.6 * 0.04) ** 2 * (0.4 + 0.6 * closure.coat!.color[channel]!), 10);
    }
    expect(spatialBaseAttenuation({ opacity: 1, lobes: [] }, 1, 1)).toEqual([1, 1, 1]);
    expect(spatialBaseAttenuation({ ...closure, coat: { ...closure.coat!, weight: 0 } }, 1, 1)).toEqual([1, 1, 1]);
  });
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
    expect(shallow.value[0]).toBeCloseTo(3 * (1 / 0.95) ** 2, 10);
    expect(shallow.value[1]).toBe(0);
    expect(shallow.value[2]).toBe(0);
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
  it('preserves the equivalent inversion and Davis bleed through records and JSON', () => {
    const closure: LayeredClosure = { opacity: 1, lobes: [{
      kind: 'subsurface', weight: 1, color: [0.5, 0.5, 0.5], subsurfaceRadius: [1, 2, 3],
      subsurfaceTransport: 0, subsurfaceInversion: 0, subsurfaceBleed: 0.5, subsurfaceMode: 2,
      subsurfaceFollowTopology: 0.75, subsurfaceSubset: 12345, subsurfaceContinuation: true,
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
    expect(displacement / exits).toBeCloseTo(0.6201256573, 1);
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

  it('rejects exits that coincide with the entry instead of returning NaN weights', () => {
    const entry = { position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const degenerate = sampleBurleySurface(entry, [0.6, 0.6, 0.6], [1, 1, 1], 2, 0,
      () => [{ position: [0, 0, 0] as Vec3, normal: entry.normal }], () => 0.1);
    const nanNormal = sampleBurleySurface(entry, [0.6, 0.6, 0.6], [1, 1, 1], 2, 0,
      probe => [{ position: probe, normal: entry.normal, geometricNormal: [NaN, NaN, NaN] as Vec3 }], () => 0.1);
    expect(degenerate).toBeNull();
    expect(nanNormal).toBeNull();
  });

  it('ignores exits outside the truncation sphere around the entry', () => {
    const entry = { position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const far = sampleBurleySurface(entry, [0.6, 0.6, 0.6], [1, 1, 1], 2, 0,
      probe => [{ position: [probe[0], probe[1], -100] as Vec3, normal: entry.normal }], () => 0.1);
    expect(far).toBeNull();
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
  it('distinguishes diffuse mean free path from volumetric mean free path', () => {
    const radius: Vec3 = [1, 2, 3];
    const diffuse = burleyDiffusionLength([0.5, 0.5, 0.5], radius, 2);
    expect(diffuse[0]).toBeCloseTo(0.2790551527, 10);
    expect(diffuse[1]).toBeCloseTo(0.5581103055, 10);
    expect(diffuse[2]).toBeCloseTo(0.8371654582, 10);
    expect(burleyDiffusionLength([0.5, 0.5, 0.5], radius, 3)[0]).toBeGreaterThan(diffuse[0]);
    const medium = exponentialSubsurfaceMedium([0.5, 0.5, 0.5], radius);
    expect(extinction(medium)[0]).toBeCloseTo(1, 12);
    expect(extinction(medium)[1]).toBeCloseTo(0.5, 12);
  });
  it('applies reciprocal dielectric transmission to Burley entry and exit interfaces', () => {
    expect(burleyInterfaceTransmission(1, 0.2, 0.7)).toBe(1);
    expect(burleyInterfaceTransmission(1.5, 1, 1)).toBeCloseTo(0.96 ** 2, 12);
    expect(burleyInterfaceTransmission(1.5, 0.3, 0.3)).toBeLessThan(burleyInterfaceTransmission(1.5, 1, 1));
  });
  it('maps DMFP with the Christensen-Burley fit independently of path-traced controls', () => {
    const radius: Vec3 = [1, 2, 3];
    const diffuse = burleyDiffusionLength([0.33, 0.33, 0.33], radius, 2);
    expect(diffuse).toEqual([1 / 3.5, 2 / 3.5, 3 / 3.5]);
    expect(burleyDiffusionLength([0.33, 0.33, 0.33], radius, 2, 0.8, 0, 1.5)).toEqual(diffuse);
    expect(burleyDiffusionLength([0.8, 0.8, 0.8], radius, 2)[0]).toBeLessThan(diffuse[0]);
    expect(burleyDiffusionLength([0.5, 0.5, 0.5], radius, 3, 0.3, 0, 1.5)[0])
      .not.toBeCloseTo(burleyDiffusionLength([0.5, 0.5, 0.5], radius, 3, 0.3, 0, 1)[0], 5);
  });
  it('retains RGB albedo on a plane with RenderMan apple DMFP values', () => {
    const color: Vec3 = [0.846, 0.841, 0.528];
    const radius: Vec3 = [6.96e-3, 6.40e-3, 1.90e-3];
    const entry = { position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const rng = createPcg32(301);
    const sum = [0, 0, 0];
    const samples = 20000;
    for (let i = 0; i < samples; i++) {
      const event = sampleBurleySurface(entry, color, radius, 2, 0,
        (probe, axis) => Math.abs(axis[2]) > 0.5 ? [{ position: probe, normal: entry.normal }] : [], rng);
      event?.weight.forEach((weight, channel) => { sum[channel]! += weight / samples; });
    }
    color.forEach((albedo, channel) => expect(Math.abs(sum[channel]! - albedo)).toBeLessThan(0.02));
    const lengths = burleyDiffusionLength(color, radius, 2);
    expect(lengths[0]).toBeCloseTo(0.000657271850, 10);
    expect(lengths[1]).toBeCloseTo(0.000620250140, 10);
    expect(lengths[2]).toBeCloseTo(0.000520021461, 10);
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
  it('inverts the documented two-flux approximation with boundary escape and anisotropy', () => {
    const color = [0.2, 0.5, 0.8] as Vec3;
    const anisotropy = 0.3;
    const ior = 1.4;
    const alpha = albedoPreservingSingleScatter(color, anisotropy, ior);
    const escape = 1 / ior ** 2;
    for (let channel = 0; channel < 3; channel++) {
      const reduced = alpha[channel]! * (1 - anisotropy) / (1 - alpha[channel]! * anisotropy);
      const root = Math.sqrt(1 - reduced);
      const internal = (1 - root) / (1 + root);
      const reflected = internal * escape / (1 - internal * (1 - escape));
      expect(reflected).toBeCloseTo(color[channel]!, 10);
    }
  });

  it('samples a non-exponential Davis-equivalent attenuation with unit mean density', () => {
    for (const bleed of [0, 1]) {
      const random = createPcg32(731);
      const samples = 30000;
      let sum = 0;
      let attenuation = 0;
      for (let sample = 0; sample < samples; sample++) {
        const density = sampleDavisDensity(bleed, random);
        expect(density).toBeGreaterThan(0);
        sum += density;
        attenuation += Math.exp(-2 * density);
      }
      const shape = 2 - 0.75 * bleed;
      expect(sum / samples).toBeCloseTo(1, 1);
      expect(attenuation / samples).toBeCloseTo((1 + 2 / shape) ** -shape, 2);
      expect(attenuation / samples).toBeGreaterThan(Math.exp(-2));
    }
  });
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
