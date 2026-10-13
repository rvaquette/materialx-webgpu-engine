import { describe, expect, it } from 'vitest';
import {
  buildSceneFrame,
  buildSceneUniform,
  cameraFrom,
  directionalLightFrom,
  environmentFrom,
  NEUTRAL_SURFACE,
  SCENE_FORWARD_UNIFORM_FLOATS,
  type RasterSurface,
} from '../../../src/render/raster/scene-frame.ts';
import type { MaterialResource, SceneResources } from '../../../src/render/scene-resources.ts';
import type { SceneCamera } from '../../../src/usd/cameras.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';

function material(passKind: 'opaque' | 'transmission'): MaterialResource {
  return {
    unitKey: `mat-${passKind}`,
    materialName: passKind,
    features: { passes: [{ kind: passKind }] } as unknown as MaterialResource['features'],
    variant: { pipelineKey: 'k' } as unknown as MaterialResource['variant'],
    boundPrims: [],
  };
}

function resources(materials: Map<string, MaterialResource>, instances: SceneResources['instances']): SceneResources {
  return {
    geometries: new Map(),
    materials,
    instances,
    tlas: { nodes: [], instanceOrder: new Uint32Array(), bounds: { min: [0, 0, 0], max: [0, 0, 0] } } as unknown as SceneResources['tlas'],
    pendingGeometry: [],
    pendingMaterials: [],
    unboundGprims: [],
  };
}

describe('camera/light/environment derivation', () => {
  it('cameraFrom multiplies projection by view and reads the eye from the transform', () => {
    const camera = {
      projectionMatrix: IDENTITY4,
      view: IDENTITY4,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
      exposure: 2,
    } as unknown as SceneCamera;
    const frame = cameraFrom(camera);
    expect(frame.eye).toEqual([5, 6, 7]);
    expect(frame.exposure).toBe(2);
    expect(frame.viewProj).toEqual(IDENTITY4);
  });

  it('directionalLightFrom prefers a distant light and folds exposure into intensity', () => {
    const lights = [
      { type: 'sphere', transform: IDENTITY4, color: [1, 0, 0], intensity: 10, exposure: 0 },
      { type: 'distant', transform: IDENTITY4, color: [0.9, 0.9, 0.9], intensity: 2, exposure: 1 },
    ] as unknown as SceneLight[];
    const light = directionalLightFrom(lights);
    expect(light.color).toEqual([0.9, 0.9, 0.9]);
    expect(light.intensity).toBeCloseTo(4); // 2 * 2^1
    expect(light.direction[2]).toBeCloseTo(-1); // local -Z under identity
  });

  it('environmentFrom scales a dome light colour by intensity, else returns ambient', () => {
    const dome = environmentFrom([
      { type: 'dome', color: [0.5, 0.25, 0.1], intensity: 2, exposure: 0, transform: IDENTITY4 },
    ] as unknown as SceneLight[]);
    expect(dome.radiance).toEqual([1, 0.5, 0.2]);
    const none = environmentFrom([]);
    expect(none.radiance[0]).toBeGreaterThan(0);
  });
});

describe('buildSceneFrame', () => {
  const instances: SceneResources['instances'] = [
    { id: '/a', prototypeId: '/pa', primPath: '/a', transform: IDENTITY4, hasGeometry: true, materialKey: 'mat-opaque' },
    { id: '/b', prototypeId: '/pb', primPath: '/b', transform: IDENTITY4, hasGeometry: true, materialKey: 'mat-transmission' },
    { id: '/c', prototypeId: '/pc', primPath: '/c', transform: IDENTITY4, hasGeometry: false },
  ];
  const materials = new Map([
    ['mat-opaque', material('opaque')],
    ['mat-transmission', material('transmission')],
  ]);

  it('routes draws to active passes and reports geometry-less instances', () => {
    const frame = buildSceneFrame(resources(materials, instances), {});
    expect(frame.draws.map((d) => d.instanceId)).toEqual(['/a', '/b']);
    expect(frame.skipped).toEqual(['/c']);
    expect(frame.passes).toEqual(['opaque', 'transmission']);
    expect(frame.draws.find((d) => d.instanceId === '/a')!.pass).toBe('opaque');
    expect(frame.draws.find((d) => d.instanceId === '/b')!.pass).toBe('transmission');
  });

  it('routes to the transmission pass when the surface transmits even without a pass flag', () => {
    const opaqueOnly = new Map([['mat-opaque', material('opaque')]]);
    const inst: SceneResources['instances'] = [
      { id: '/a', prototypeId: '/pa', primPath: '/a', transform: IDENTITY4, hasGeometry: true, materialKey: 'mat-opaque' },
    ];
    const surfaceFor = (): RasterSurface => ({ ...NEUTRAL_SURFACE, transmission: 0.5 });
    const frame = buildSceneFrame(resources(opaqueOnly, inst), { surfaceFor });
    expect(frame.passes).toEqual(['transmission']);
    expect(frame.draws[0]!.surface.transmission).toBe(0.5);
  });

  it('falls back to a default camera/light when none are provided', () => {
    const frame = buildSceneFrame(resources(materials, instances), {});
    expect(frame.camera.eye).toEqual([0, 0, 2]);
    expect(frame.light.intensity).toBeGreaterThan(0);
  });
});

describe('buildSceneUniform', () => {
  it('packs model, camera, light, surface and environment at the WGSL offsets', () => {
    const frame = buildSceneFrame(
      resources(new Map(), [{ id: '/a', prototypeId: '/pa', primPath: '/a', transform: IDENTITY4, hasGeometry: true }]),
      { frameCamera: { viewProj: IDENTITY4, eye: [1, 2, 3], exposure: 0 }, environment: { radiance: [0.1, 0.2, 0.3] } },
    );
    const draw = frame.draws[0]!;
    const u = buildSceneUniform(frame, draw);
    expect(u.length).toBe(SCENE_FORWARD_UNIFORM_FLOATS);
    expect(u[0]).toBe(1); // model[0]
    expect(u[16]).toBe(1); // viewProj[0]
    expect([u[32], u[33], u[34]]).toEqual([1, 2, 3]); // eye
    expect(u[43]).toBe(frame.light.intensity); // lightColor.w
    expect(u[47]).toBe(1); // baseColor.a
    expect(u[44]).toBeCloseTo(NEUTRAL_SURFACE.baseColor[0]);
    expect(u[45]).toBeCloseTo(NEUTRAL_SURFACE.baseColor[1]);
    expect(u[46]).toBeCloseTo(NEUTRAL_SURFACE.baseColor[2]);
    expect(u[48]).toBe(NEUTRAL_SURFACE.metalness);
    expect(u[52]).toBe(NEUTRAL_SURFACE.ior);
    expect(u[56]).toBeCloseTo(0.1); // environment.r
    expect(u[57]).toBeCloseTo(0.2);
    expect(u[58]).toBeCloseTo(0.3);
  });
});
