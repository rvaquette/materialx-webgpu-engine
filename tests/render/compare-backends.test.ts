import { describe, expect, it } from 'vitest';
import {
  compareSceneBackends,
  diffuseProbe,
} from '../../src/render/compare-backends.ts';
import type { GeometryResource, SceneResources } from '../../src/render/scene-resources.ts';
import type { FrameLight } from '../../src/render/raster/scene-frame.ts';
import type { SceneLight } from '../../src/usd/lights.ts';
import { IDENTITY4 } from '../../src/scene/transforms.ts';

function quadGeometry(prototypeId: string): GeometryResource {
  return {
    prototypeId,
    primPath: prototypeId,
    streams: [
      { name: 'position', data: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), components: 3 },
      { name: 'normal', data: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), components: 3 },
    ],
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    vertexCount: 4,
    triangleCount: 2,
  } as unknown as GeometryResource;
}

function resources(): SceneResources {
  return {
    geometries: new Map([['/proto', quadGeometry('/proto')]]),
    materials: new Map(),
    instances: [
      { id: '/quad', prototypeId: '/proto', primPath: '/quad', transform: IDENTITY4, hasGeometry: true, materialKey: 'mat' },
      { id: '/empty', prototypeId: '/none', primPath: '/empty', transform: IDENTITY4, hasGeometry: false },
    ],
    tlas: { nodes: [], instanceOrder: new Uint32Array(), bounds: { min: [0, 0, 0], max: [0, 0, 0] } },
    pendingGeometry: [],
    pendingMaterials: [],
    unboundGprims: [],
  } as unknown as SceneResources;
}

const lights = [
  { type: 'distant', transform: IDENTITY4, color: [1, 1, 1], intensity: 1, exposure: 0 },
] as unknown as SceneLight[];

describe('diffuseProbe', () => {
  it('matches the raster reference and the path tracer on a Lambert ground truth', () => {
    const light: FrameLight = { direction: [0, 0, -1], color: [1, 1, 1], intensity: Math.PI };
    const probe = diffuseProbe([0.8, 0.6, 0.4], light);
    // baseColor/pi * (color*intensity) with intensity = pi -> baseColor.
    expect(probe.raster[0]).toBeCloseTo(0.8, 4);
    expect(probe.pathtracing[0]).toBeCloseTo(0.8, 4);
    expect(probe.agree).toBe(true);
    expect(probe.maxAbsDiff).toBeLessThan(1e-5);
  });
});

describe('compareSceneBackends', () => {
  it('feeds both backends from the same assets and agrees on the diffuse probe', () => {
    const result = compareSceneBackends(resources(), { lights });
    // Only the instance with geometry becomes a raster draw / traced triangles.
    expect(result.rasterDraws).toBe(1);
    expect(result.pathTraceTriangles).toBe(2);
    expect(result.materialCount).toBe(1);
    expect(result.sharedCamera).toBe(true);
    expect(result.sharedLight).toBe(true);
    expect(result.diffuseProbe.agree).toBe(true);
  });
});
