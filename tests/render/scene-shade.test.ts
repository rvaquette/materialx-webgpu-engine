// T035c3: lock the two-buffer shading. The raster and path-tracing closed forms
// are verified against hand-computed values, then the full buffer pass is checked
// for shape, hit masking, determinism, and that a base diffuse scene agrees
// between backends up to the known ambient-vs-environment gap.
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/shader-ball.json' with { type: 'json' };
import scenes from '../fixtures/control-scenes.json' with { type: 'json' };
import materials from '../fixtures/scene-materials.json' with { type: 'json' };
import { fitShaderBall, sampleSurface } from './scene-samples.ts';
import {
  effectiveAlbedo,
  rasterShade,
  pathTraceShade,
  shadeSceneBuffers,
  type CanonMaterial,
  type SceneLight,
} from './scene-shade.ts';
import { createPcg32 } from '../../src/render/pathtracing/integrator.ts';

type V3 = [number, number, number];

const light: SceneLight = {
  direction: [scenes.light.direction[0]!, scenes.light.direction[1]!, scenes.light.direction[2]!],
  color: [scenes.light.color[0]!, scenes.light.color[1]!, scenes.light.color[2]!],
  intensity: scenes.light.intensity,
};
const env: V3 = [
  scenes.environment.constantRadiance[0]!,
  scenes.environment.constantRadiance[1]!,
  scenes.environment.constantRadiance[2]!,
];

function material(id: keyof typeof materials.scenes): CanonMaterial {
  const m = materials.scenes[id];
  return {
    family: m.family,
    focus: m.focus,
    baseColor: [m.baseColor[0]!, m.baseColor[1]!, m.baseColor[2]!],
    metalness: m.metalness,
    roughness: m.roughness,
    transmission: m.transmission,
    subsurface: m.subsurface,
    ior: m.ior,
    specular: m.specular,
  };
}

describe('scene shading backends (T035c3)', () => {
  it('raster mirror matches albedo * (ambient + n.l) with the pi-normalised light', () => {
    const albedo: V3 = [0.8, 0.8, 0.8];
    // Normal pointing at the light so n.l = 1; intensity = pi makes lightColor 1.
    const toLight: V3 = [0.3, 0.5, 0.8];
    const len = Math.hypot(...toLight);
    const n: V3 = [-light.direction[0] / len, -light.direction[1] / len, -light.direction[2] / len];
    const sample = { hit: true, position: [0, 0, 0] as V3, normal: n, uv: [0, 0] as [number, number], viewDir: n, t: 1 };
    const rc = rasterShade(sample, albedo, light);
    for (let c = 0; c < 3; c++) expect(rc[c]).toBeCloseTo(0.8 * (0.03 + 1), 5);
  });

  it('path tracing reference yields albedo * n.l direct + albedo * environment', () => {
    const albedo: V3 = [0.8, 0.8, 0.8];
    const len = Math.hypot(light.direction[0], light.direction[1], light.direction[2]);
    const n: V3 = [-light.direction[0] / len, -light.direction[1] / len, -light.direction[2] / len];
    const sample = { hit: true, position: [0, 0, 0] as V3, normal: n, uv: [0, 0] as [number, number], viewDir: n, t: 1 };
    const pc = pathTraceShade(sample, albedo, light, env, createPcg32(1337));
    // direct = albedo * cos(=1); env = albedo * 0.05.
    for (let c = 0; c < 3; c++) expect(pc[c]).toBeCloseTo(0.8 * (1 + 0.05), 4);
  });

  it('effective albedo drops metal and transmission', () => {
    expect(effectiveAlbedo(material('gltf_pbr_default'))).toEqual([0, 0, 0]);
    expect(effectiveAlbedo(material('standard_surface_glass'))).toEqual([0, 0, 0]);
    const jade = effectiveAlbedo(material('standard_surface_jade'));
    expect(jade[1]).toBeGreaterThan(jade[0]);
  });

  it('fills deterministic, hit-masked HDR buffers for every raster+pathtracing scene', () => {
    const surface = fitShaderBall(fixture);
    const cam = {
      eye: [scenes.camera.eye[0]!, scenes.camera.eye[1]!, scenes.camera.eye[2]!] as V3,
      target: [scenes.camera.target[0]!, scenes.camera.target[1]!, scenes.camera.target[2]!] as V3,
      up: [scenes.camera.up[0]!, scenes.camera.up[1]!, scenes.camera.up[2]!] as V3,
      fovYRadians: scenes.camera.fovYRadians,
      aspect: scenes.camera.aspect,
    };
    const grid = sampleSurface(surface, cam, 16, 16);
    for (const id of Object.keys(materials.scenes) as (keyof typeof materials.scenes)[]) {
      const buffers = shadeSceneBuffers(grid, material(id), light, env, 1337);
      expect(buffers.raster.length).toBe(16 * 16 * 3);
      expect(buffers.pathtracing.length).toBe(16 * 16 * 3);
      let hits = 0;
      for (let i = 0; i < buffers.mask.length; i++) {
        const o = i * 3;
        if (buffers.mask[i] === 0) {
          expect(buffers.raster[o]).toBe(0);
          expect(buffers.pathtracing[o]).toBe(0);
          continue;
        }
        hits++;
        for (let c = 0; c < 3; c++) {
          expect(Number.isFinite(buffers.raster[o + c]!)).toBe(true);
          expect(buffers.pathtracing[o + c]!).toBeGreaterThanOrEqual(0);
        }
      }
      expect(hits).toBeGreaterThan(0);
      // Deterministic: a second pass is byte-for-byte identical.
      const again = shadeSceneBuffers(grid, material(id), light, env, 1337);
      expect(again.pathtracing).toEqual(buffers.pathtracing);
    }
  });

  it('base diffuse scene agrees across backends up to the ambient/env gap', () => {
    const surface = fitShaderBall(fixture);
    const cam = {
      eye: [0, 0, 3] as V3,
      target: [0, 0, 0] as V3,
      up: [0, 1, 0] as V3,
      fovYRadians: scenes.camera.fovYRadians,
      aspect: 1,
    };
    const grid = sampleSurface(surface, cam, 16, 16);
    const b = shadeSceneBuffers(grid, material('standard_surface_default'), light, env, 1337);
    // Raster ambient 0.03 vs path-traced env 0.05 over albedo 0.8 => <= ~0.016.
    for (let i = 0; i < b.mask.length; i++) {
      if (b.mask[i] === 0) continue;
      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(b.raster[o + c]! - b.pathtracing[o + c]!)).toBeLessThan(0.02);
      }
    }
  });
});
