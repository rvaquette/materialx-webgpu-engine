// T035c2: validate deterministic shader-ball visibility. The BVH traversal must
// agree with a brute-force triangle sweep (the reference), the control camera
// must frame the ball (some hits, some misses), and every hit sample must carry
// a usable shading frame (unit normal, unit view direction, UV in range, a point
// that lies on its primary ray).
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/shader-ball.json' with { type: 'json' };
import scenes from '../fixtures/control-scenes.json' with { type: 'json' };
import {
  fitShaderBall,
  primaryRay,
  sampleSurface,
  intersectBvh,
  intersectBruteForce,
  type CameraParams,
} from './scene-samples.ts';

const cam: CameraParams = {
  eye: [scenes.camera.eye[0]!, scenes.camera.eye[1]!, scenes.camera.eye[2]!],
  target: [scenes.camera.target[0]!, scenes.camera.target[1]!, scenes.camera.target[2]!],
  up: [scenes.camera.up[0]!, scenes.camera.up[1]!, scenes.camera.up[2]!],
  fovYRadians: scenes.camera.fovYRadians,
  aspect: scenes.camera.aspect,
};

const surface = fitShaderBall(fixture);

describe('shader ball visibility (T035c2)', () => {
  it('frames the ball: some pixels hit and some miss', () => {
    const grid = sampleSurface(surface, cam, 32, 32);
    expect(grid.hitCount).toBeGreaterThan(0);
    expect(grid.hitCount).toBeLessThan(grid.width * grid.height);
    const centre = grid.samples[16 * 32 + 16]!;
    expect(centre.hit).toBe(true);
  });

  it('BVH traversal matches the brute-force triangle sweep', () => {
    const w = 32;
    const h = 32;
    let compared = 0;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const ray = primaryRay(cam, px, py, w, h);
        const a = intersectBvh(surface, ray);
        const b = intersectBruteForce(surface, ray);
        expect(Boolean(a), `hit/miss parity at ${px},${py}`).toBe(Boolean(b));
        if (a && b) {
          expect(Math.abs(a.t - b.t), `t at ${px},${py}`).toBeLessThan(1e-4);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('every hit carries a valid shading frame on its ray', () => {
    const w = 32;
    const h = 32;
    const grid = sampleSurface(surface, cam, w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const s = grid.samples[py * w + px]!;
        if (!s.hit) continue;
        expect(Math.hypot(...s.normal)).toBeCloseTo(1, 3);
        expect(Math.hypot(...s.viewDir)).toBeCloseTo(1, 3);
        expect(s.uv[0]).toBeGreaterThanOrEqual(0);
        expect(s.uv[0]).toBeLessThanOrEqual(1);
        expect(s.uv[1]).toBeGreaterThanOrEqual(0);
        expect(s.uv[1]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(s.t) && s.t > 0).toBe(true);
        // position must lie on the primary ray: position = eye + t*dir.
        const ray = primaryRay(cam, px, py, w, h);
        for (let k = 0; k < 3; k++) {
          const onRay = ray.origin[k]! + ray.direction[k]! * s.t;
          expect(Math.abs(s.position[k]! - onRay)).toBeLessThan(1e-4);
        }
      }
    }
  });
});
