import { expect, it } from 'vitest';
import { createPcg32, integratePath, type SceneSampler } from '../../../src/render/pathtracing/integrator.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';

it('crosses a closed pure-volume slab without a BSDF and attenuates the background', () => {
  const medium = { absorption: [0.5, 0.5, 0.5] as const, scattering: [0, 0, 0] as const, anisotropy: 0 };
  const scene: SceneSampler = {
    intersect: ray => {
      if (ray.direction[2] <= 0) return null;
      const z = ray.origin[2] < 0 ? 0 : ray.origin[2] < 1 ? 1 : undefined;
      return z === undefined ? null : {
        position: [0, 0, z], normal: [0, 0, z === 0 ? -1 : 1],
        interiorMedium: medium, volumeBoundary: true,
      };
    },
    sampleBsdf: () => { throw new Error('A pure-volume boundary must not sample a BSDF.'); },
    evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }),
    sampleLight: () => null,
    lightPdf: () => 0,
    occluded: () => false,
    environment: () => [1, 1, 1],
  };
  const rng = createPcg32(42);
  let sum = 0;
  const samples = 12000;
  for (let i = 0; i < samples; i++) {
    let draw = 0;
    const stratified = () => ++draw === 2 ? (i + 0.5) / samples : 0.5;
    sum += integratePath(scene, { origin: [0, 0, -1], direction: [0, 0, 1] }, stratified, { maxBounces: 2 })[0];
  }
  expect(sum / samples).toBeCloseTo(Math.exp(-0.5), 2);
  expect(integratePath({ ...scene, intersect: () => null }, {
    origin: [0, 0, -1], direction: [0, 0, 1],
  }, rng)).toEqual([1, 1, 1]);
});

it('uses explicit media in both graph and packed GPU material paths', () => {
  const source = pathTraceComputeWgsl();
  expect(source).toContain('mx_material_apply_volume');
  expect(source).toContain('if (mx_material_volume_boundary(tri_material(hit.tri)))');
  expect(source).toContain('inMedium = dot(rd, geometricNormal) < 0.0');
});
