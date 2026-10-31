import { describe, expect, it } from 'vitest';
import { packAnalyticLights, PT_LIGHT_FLOATS } from '../../../src/render/pathtracing/analytic-lights.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
import { cameraFovY, importCameras } from '../../../src/usd/cameras.ts';
import { importUsdStage } from '../../../src/usd/importer.ts';

const rect: SceneLight = {
  path: '/World/Lights/Panel', type: 'rect', usdType: 'RectLight',
  color: [1, 0.5, 0.25], intensity: 5, exposure: 1, normalize: false,
  width: 4, height: 2, transform: IDENTITY4,
};
describe('analytic converted lights', () => {
  it('packs rectangle orientation, true area and exposed radiance', () => {
    const data = packAnalyticLights([rect]);
    expect(data.length).toBe(PT_LIGHT_FLOATS);
    expect([...data.slice(4, 8)]).toEqual([10, 5, 2.5, 8]);
    expect([...data.slice(16, 19)]).toEqual([-0, -0, -1]);
    expect(packAnalyticLights([{ ...rect, normalize: true }])[4]).toBeCloseTo(1.25);
  });
  it('packs sphere and distant shapes, rejecting unsupported interpretations', () => {
    expect(packAnalyticLights([{ ...rect, type: 'sphere', radius: 2 }])[7]).toBeCloseTo(16 * Math.PI);
    expect(packAnalyticLights([{ ...rect, type: 'distant' }])[3]).toBe(2);
    expect(() => packAnalyticLights([{ ...rect, type: 'disk' }])).toThrow('Unsupported converted');
  });
  it('rejects degenerate dimensions, non-finite radiance and sheared spheres', () => {
    expect(() => packAnalyticLights([{ ...rect, width: 0 }])).toThrow('Degenerate');
    expect(() => packAnalyticLights([{ ...rect, intensity: Infinity }])).toThrow('Invalid');
    const shear = [...IDENTITY4];
    shear[4] = 0.5;
    shear[5] = Math.sqrt(0.75);
    expect(() => packAnalyticLights([{ ...rect, type: 'sphere', radius: 2, transform: shear as typeof IDENTITY4 }])).toThrow('Sheared');
  });
  it('emits bounded shadow rays and consistent light-selection MIS', () => {
    const shader = pathTraceComputeWgsl({ analyticLights: true, opaque: true });
    expect(shader).toContain('@binding(9)');
    expect(shader).toContain('analyticLights[b + 1u].w * cosine * f32(mx_light_count())');
    expect(shader).toContain('traverse(ro, rd, emitter.distance, false)');
    expect(shader).toContain('light.distance - 2.0 * RAY_EPS');
    expect(shader).toContain('if (bounce >= i32(U.transport.x)) { break; }');
    expect(shader).not.toContain('mx_closure_eval(c, wo, wiLight)');
    expect(shader).toContain('if (mx_intersect_lights(origin, direction).distance < distance)');
    expect(shader).toContain('analyticNee = false; // No analytic-light NEE');
    expect(shader.indexOf('if (!hit.hitAny && emitter.hit)')).toBeGreaterThan(shader.indexOf('mx_sample_homogeneous(medium, tMax'));
    expect(pathTraceComputeWgsl({ analyticLights: true, displayAovs: true })).toContain('if (cameraSegment) { *coverage = 1.0; }');
  });
  it('uses the converted horizontal FOV at each render aspect', async () => {
    const text = `#usda 1.0
def Camera "Camera" {
 float focalLength = 50
 float horizontalAperture = 57.735027
 float verticalAperture = 32.475953
 custom float pathtracer:fov = 60
}`;
    const scene = await importUsdStage('camera.usda', { reader: { read: async () => text } });
    const camera = importCameras(scene)[0]!;
    expect(cameraFovY(camera, 1)).toBeCloseTo(Math.PI / 3);
    expect(cameraFovY(camera, 16 / 9)).toBeCloseTo(camera.fovY);
    const ordinary = { ...camera };
    delete ordinary.pathtracerFov;
    expect(cameraFovY(ordinary, 1)).toBe(camera.fovY);
  });
});
