import { describe, expect, it } from 'vitest';
import {
  buildPathTraceScene,
  createSceneSampler,
  directLighting,
  readSurfaceParams,
  PT_TRIANGLE_FLOATS,
  PT_MATERIAL_FLOATS,
  type PathTraceScene,
} from '../../../src/render/pathtracing/scene-buffers.ts';
import type { GeometryResource, MaterialResource, SceneResources } from '../../../src/render/scene-resources.ts';
import type { RasterSurface } from '../../../src/render/raster/scene-frame.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
import { createPcg32, integratePath, type Ray } from '../../../src/render/pathtracing/integrator.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';

// A 2x2 quad in the z=0 plane facing +Z, split into two triangles.
function quadGeometry(prototypeId: string): GeometryResource {
  const position = new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    1, 1, 0,
    -1, 1, 0,
  ]);
  const normal = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return {
    prototypeId,
    primPath: prototypeId,
    streams: [
      { name: 'position', data: position, components: 3 },
      { name: 'normal', data: normal, components: 3 },
    ],
    indices,
    vertexCount: 4,
    triangleCount: 2,
  } as unknown as GeometryResource;
}

function sceneWith(): { resources: SceneResources; lights: SceneLight[] } {
  const geometries = new Map<string, GeometryResource>([['/proto', quadGeometry('/proto')]]);
  const resources = {
    geometries,
    materials: new Map<string, MaterialResource>([['mat', { unitKey: 'mat', features: { passes: [] } } as unknown as MaterialResource]]),
    instances: [
      { id: '/quad', prototypeId: '/proto', primPath: '/quad', transform: IDENTITY4, hasGeometry: true, materialKey: 'mat' },
    ],
    tlas: { nodes: [], instanceOrder: new Uint32Array(), bounds: { min: [0, 0, 0], max: [0, 0, 0] } },
    pendingGeometry: [],
    pendingMaterials: [],
    unboundGprims: [],
  } as unknown as SceneResources;
  // A distant light under identity emits along local -Z (travel [0,0,-1]).
  const lights = [
    { type: 'distant', transform: IDENTITY4, color: [1, 1, 1], intensity: 1, exposure: 0 },
  ] as unknown as SceneLight[];
  return { resources, lights };
}

function build(surface?: RasterSurface): PathTraceScene {
  const { resources, lights } = sceneWith();
  return buildPathTraceScene(resources, {
    lights,
    ...(surface ? { surfaceFor: () => surface } : {}),
  });
}

describe('buildPathTraceScene packing', () => {
  it('packs the quad into two world triangles with a BVH and one material', () => {
    const scene = build();
    expect(scene.triangleCount).toBe(2);
    expect(scene.triangles.length).toBe(2 * PT_TRIANGLE_FLOATS);
    expect(scene.triangleOrder.length).toBe(2);
    expect(scene.nodeCount).toBeGreaterThan(0);
    expect(scene.materialCount).toBe(1);
    expect(scene.materials.length).toBe(PT_MATERIAL_FLOATS);
  });

  it('round-trips a custom OpenPBR surface through the material buffer', () => {
    const surface: RasterSurface = {
      baseColor: [0.2, 0.4, 0.6],
      metalness: 1,
      roughness: 0.25,
      transmission: 0,
      subsurface: 0,
      ior: 1.4,
      specular: 0.5,
    };
    const scene = build(surface);
    const read = readSurfaceParams(scene, 0);
    expect(read.baseColor[0]).toBeCloseTo(0.2);
    expect(read.baseColor[2]).toBeCloseTo(0.6);
    expect(read.metalness).toBeCloseTo(1);
    expect(read.roughness).toBeCloseTo(0.25);
    expect(read.ior).toBeCloseTo(1.4);
    expect(read.specular).toBeCloseTo(0.5);
  });

  it('derives the inverse view-projection from the shared camera', () => {
    const scene = build();
    expect(scene.camera.invViewProj.length).toBe(16);
  });
});

describe('createSceneSampler traversal', () => {
  it('intersects the quad along a -Z camera ray', () => {
    const scene = build();
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] });
    expect(hit).not.toBeNull();
    expect(hit!.position[2]).toBeCloseTo(0);
    expect(Math.abs(hit!.normal[2])).toBeCloseTo(1);
  });

  it('misses when the ray points away from the quad', () => {
    const scene = build();
    const sampler = createSceneSampler(scene);
    expect(sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, 1] })).toBeNull();
  });

  it('reports occlusion for a shadow ray crossing the quad', () => {
    const scene = build();
    const sampler = createSceneSampler(scene);
    expect(sampler.occluded([0, 0, 2], [0, 0, -1], 5)).toBe(true);
    expect(sampler.occluded([0, 0, 2], [0, 0, 1], 5)).toBe(false);
  });
});

describe('direct lighting and the full integrator over packed buffers', () => {
  it('yields positive direct radiance on the lit face', () => {
    const scene = build();
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] })!;
    const radiance = directLighting(scene, hit, [0, 0, 1]);
    expect(radiance[0]).toBeGreaterThan(0);
  });

  it('integratePath returns finite, non-negative radiance for a camera ray', () => {
    const scene = build();
    const sampler = createSceneSampler(scene);
    const rng = createPcg32(1234);
    const ray: Ray = { origin: [0, 0, 2], direction: [0, 0, -1] };
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const r = integratePath(sampler, ray, rng, { maxBounces: 8 });
      expect(Number.isFinite(r[0])).toBe(true);
      expect(r[0]).toBeGreaterThanOrEqual(0);
      sum += r[0];
    }
    expect(sum).toBeGreaterThan(0);
  });
});
