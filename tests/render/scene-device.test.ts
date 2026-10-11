// T035d: compare the mobile GPU raster shading (collected by scene-device.harness
// into scene-device-report.json) against the CPU raster oracle (rasterShade,
// T035c3) over the shared visibility samples. Visibility is shared, so any
// difference is pure GPU fp32 vs CPU fp64 arithmetic in the Lambert + ambient
// model. If no device report is present (empty scenes, e.g. no authorized
// mobile), the suite skips with a documented reason instead of passing silently.
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/shader-ball.json' with { type: 'json' };
import scenes from '../fixtures/control-scenes.json' with { type: 'json' };
import materials from '../fixtures/scene-materials.json' with { type: 'json' };
import report from './scene-device-report.json' with { type: 'json' };
import { fitShaderBall, sampleSurface, type CameraParams } from './scene-samples.ts';
import { effectiveAlbedo, rasterShade, type CanonMaterial, type SceneLight } from './scene-shade.ts';
import type { SceneDeviceReport } from './scene-device.harness.ts';
import { compareSignals } from './compare.ts';

type V3 = [number, number, number];

// fp32 GPU vs fp64 CPU on a normalize + dot + a couple of mads.
const DEVICE_TOLERANCE = 2e-3;

const dev = report as unknown as SceneDeviceReport;
const hasDevice = Array.isArray(dev.scenes) && dev.scenes.length > 0 && dev.width > 0;

const light: SceneLight = {
  direction: [scenes.light.direction[0]!, scenes.light.direction[1]!, scenes.light.direction[2]!],
  color: [scenes.light.color[0]!, scenes.light.color[1]!, scenes.light.color[2]!],
  intensity: scenes.light.intensity,
};

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

describe('scene raster device GPU vs CPU oracle (T035d)', () => {
  if (!hasDevice) {
    it.skip('skipped: no device report (run scripts/run-scene-device.mjs on an authorized mobile)', () => {});
    return;
  }

  const cam: CameraParams = {
    eye: [scenes.camera.eye[0]!, scenes.camera.eye[1]!, scenes.camera.eye[2]!],
    target: [scenes.camera.target[0]!, scenes.camera.target[1]!, scenes.camera.target[2]!],
    up: [scenes.camera.up[0]!, scenes.camera.up[1]!, scenes.camera.up[2]!],
    fovYRadians: scenes.camera.fovYRadians,
    aspect: scenes.camera.aspect,
  };
  const surface = fitShaderBall(fixture);
  const grid = sampleSurface(surface, cam, dev.width, dev.height);
  const hitSamples = grid.samples.filter((s) => s.hit);
  const byId = new Map(dev.scenes.map((s) => [s.id, s]));

  it('reports an adapter and matches the oracle hit count', () => {
    expect(dev.adapter).toBeTruthy();
    expect(dev.hitCount).toBe(hitSamples.length);
  });

  it('covers every raster+pathtracing scene', () => {
    const expected = Object.keys(materials.scenes).sort();
    expect(dev.scenes.map((s) => s.id).sort()).toEqual(expected);
  });

  for (const id of Object.keys(materials.scenes) as (keyof typeof materials.scenes)[]) {
    it(`device raster matches the CPU oracle for ${id}`, () => {
      const deviceResult = byId.get(id);
      expect(deviceResult, `no device result for ${id}`).toBeDefined();
      const albedo: V3 = effectiveAlbedo(material(id));
      const oracle: number[] = [];
      for (const s of hitSamples) {
        const c = rasterShade(s, albedo, light);
        oracle.push(c[0], c[1], c[2]);
      }
      const device = deviceResult!.shaded;
      expect(device.length).toBe(oracle.length);
      const result = compareSignals(device, oracle, { maxAbs: DEVICE_TOLERANCE });
      expect(result.violations).toEqual([]);
    });
  }
});
