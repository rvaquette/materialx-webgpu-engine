// T035c4: compare the raster and path-traced HDR buffers (T035c3) per control
// scene. Only the pixels the primary ray hit are compared (the shared mask), so
// the empty background never dilutes the metrics. Each scene's verdict uses the
// per-focus tolerance from tests/fixtures/tolerances.ts via compare.ts; a
// divergence beyond tolerance fails and names the offending channel. Every scene
// declaring both raster and pathtracing must be covered.
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/shader-ball.json' with { type: 'json' };
import scenes from '../fixtures/control-scenes.json' with { type: 'json' };
import materials from '../fixtures/scene-materials.json' with { type: 'json' };
import { fitShaderBall, sampleSurface, type CameraParams } from './scene-samples.ts';
import { shadeSceneBuffers, type CanonMaterial, type SceneLight } from './scene-shade.ts';
import { compareImages } from './compare.ts';
import { sceneTolerance, SCENE_FOCUS_TOLERANCE } from '../fixtures/tolerances.ts';

type V3 = [number, number, number];

const cam: CameraParams = {
  eye: [scenes.camera.eye[0]!, scenes.camera.eye[1]!, scenes.camera.eye[2]!],
  target: [scenes.camera.target[0]!, scenes.camera.target[1]!, scenes.camera.target[2]!],
  up: [scenes.camera.up[0]!, scenes.camera.up[1]!, scenes.camera.up[2]!],
  fovYRadians: scenes.camera.fovYRadians,
  aspect: scenes.camera.aspect,
};
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

/** Pack the hit pixels of a buffer into a compact rgb array. */
function hitChannels(buf: Float32Array, mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const o = i * 3;
    out.push(buf[o]!, buf[o + 1]!, buf[o + 2]!);
  }
  return out;
}

const surface = fitShaderBall(fixture);
const grid = sampleSurface(surface, cam, 48, 48);
const ids = Object.keys(materials.scenes) as (keyof typeof materials.scenes)[];

describe('scene raster vs pathtracing comparison (T035c4)', () => {
  it('covers every raster+pathtracing control scene', () => {
    const expected = scenes.scenes
      .filter((s) => s.backends.includes('raster') && s.backends.includes('pathtracing'))
      .map((s) => s.id)
      .sort();
    expect([...ids].sort()).toEqual(expected);
  });

  it('every focus bound is documented', () => {
    for (const id of ids) {
      for (const f of materials.scenes[id].focus) {
        expect(SCENE_FOCUS_TOLERANCE[f]).toBeDefined();
      }
    }
  });

  for (const id of ids) {
    it(`${id} agrees within its ${materials.scenes[id].focus.join('/')} tolerance`, () => {
      const m = material(id);
      const buffers = shadeSceneBuffers(grid, m, light, env, 1337);
      const a = hitChannels(buffers.raster, buffers.mask);
      const b = hitChannels(buffers.pathtracing, buffers.mask);
      expect(a.length).toBeGreaterThan(0);
      const tol = sceneTolerance(m.focus);
      const result = compareImages(a, b, 3, { maxAbs: tol.maxAbs, rmse: tol.rmse });
      expect(result.violations).toEqual([]);
      expect(result.pass).toBe(true);
    });
  }
});
