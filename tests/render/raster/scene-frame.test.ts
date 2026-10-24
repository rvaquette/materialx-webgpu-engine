import { describe, expect, it } from 'vitest';
import {
  buildSceneFrame,
  buildSceneFrameUniform,
  buildSceneMaterialUniform,
  cameraFrom,
  directionalLightFrom,
  environmentFrom,
  NEUTRAL_SURFACE,
  SCENE_FRAME_UNIFORM_FLOATS,
  SCENE_MATERIAL_UNIFORM_FLOATS,
  type RasterSurface,
} from '../../../src/render/raster/scene-frame.ts';
import type { MaterialResource, SceneResources } from '../../../src/render/scene-resources.ts';
import type { SceneCamera } from '../../../src/usd/cameras.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';
import type { ResolvedSurface } from '../../../src/materialx/surface-graph.ts';

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

  it('does not add a default sun to a dome-only scene', () => {
    const lights = [
      { type: 'dome', transform: IDENTITY4, color: [1, 1, 1], intensity: 1, exposure: 0 },
    ] as unknown as SceneLight[];
    expect(directionalLightFrom(lights).intensity).toBe(0);
    expect(environmentFrom(lights).radiance).toEqual([1, 1, 1]);
    expect(directionalLightFrom([]).intensity).toBe(1);
  });
});

describe('buildSceneFrame', () => {
  it.each([
    [0, false, 'opaque'],
    [1, true, 'masked'],
    [1, false, 'masked'],
    [2, false, 'transmission'],
    [0, true, 'opaque'],
  ] as const)('routes alpha mode %s (connected alpha=%s) to %s', (mode, connected, pass) => {
    const resolvedSurface: ResolvedSurface = {
      family: 'gltf_pbr',
      nodeId: 'SR',
      inputs: new Map([
        ['alpha_mode', { name: 'alpha_mode', type: 'integer', source: { kind: 'value', value: [mode] } }],
        ['alpha', { name: 'alpha', type: 'float', source: connected
          ? { kind: 'connection', nodeId: 'alpha' } : { kind: 'value', value: [0.35] } }],
      ]),
    };
    const mat = { ...material('opaque'), resolvedSurface };
    const frame = buildSceneFrame(resources(new Map([['mat', mat]]), [
      { id: '/a', primPath: '/a', prototypeId: '/pa', materialKey: 'mat', hasGeometry: true, transform: IDENTITY4 },
    ]));
    expect(frame.draws[0]!.pass).toBe(pass);
  });

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

describe('buildSceneFrameUniform / buildSceneMaterialUniform', () => {
  it('packs the frame block (model, camera, light, environment) at the WGSL offsets', () => {
    const frame = buildSceneFrame(
      resources(new Map(), [{ id: '/a', prototypeId: '/pa', primPath: '/a', transform: IDENTITY4, hasGeometry: true }]),
      { frameCamera: { viewProj: IDENTITY4, eye: [1, 2, 3], exposure: 0 }, environment: { radiance: [0.1, 0.2, 0.3] } },
    );
    const draw = frame.draws[0]!;
    const u = buildSceneFrameUniform(frame, draw);
    expect(u.length).toBe(SCENE_FRAME_UNIFORM_FLOATS);
    expect(u[0]).toBe(1); // model[0]
    expect(u[16]).toBe(1); // viewProj[0]
    expect([u[32], u[33], u[34]]).toEqual([1, 2, 3]); // eye
    expect(u[43]).toBe(frame.light.intensity); // lightColor.w
    expect(u[44]).toBeCloseTo(0.1); // environment.r
    expect(u[45]).toBeCloseTo(0.2);
    expect(u[46]).toBeCloseTo(0.3);
    expect(u[87]).toBe(0);
  });

  it('packs HDR texture scale, tint and CDF separately from diffuse irradiance', () => {
    const frame = buildSceneFrame(
      resources(new Map(), [{ id: '/a', prototypeId: '/pa', primPath: '/a', transform: IDENTITY4, hasGeometry: true }]),
      { environment: { radiance: [0.1, 0.2, 0.3], tint: [1, 0.5, 0.25], intensity: 2, textureRadianceScale: 4,
        hasTexture: true, envResX: 16, envResY: 8, envTotalSum: 100 } },
    );
    const u = buildSceneFrameUniform(frame, frame.draws[0]!);
    expect(Array.from(u.slice(84))).toEqual([8, 4, 2, 1, 16, 8, 100, 4]);
  });

  it('packs the material block (baseColor, params, coat) at the WGSL offsets', () => {
    const frame = buildSceneFrame(
      resources(new Map(), [{ id: '/a', prototypeId: '/pa', primPath: '/a', transform: IDENTITY4, hasGeometry: true }]),
      {},
    );
    const draw = frame.draws[0]!;
    const u = buildSceneMaterialUniform(draw);
    expect(u.length).toBe(SCENE_MATERIAL_UNIFORM_FLOATS);
    expect(u[0]).toBeCloseTo(NEUTRAL_SURFACE.baseColor[0]);
    expect(u[1]).toBeCloseTo(NEUTRAL_SURFACE.baseColor[1]);
    expect(u[2]).toBeCloseTo(NEUTRAL_SURFACE.baseColor[2]);
    expect(u[3]).toBe(1); // baseColor.a
    expect(u[4]).toBe(NEUTRAL_SURFACE.metalness);
    expect(u[8]).toBe(NEUTRAL_SURFACE.ior);
    expect(u[9]).toBe(NEUTRAL_SURFACE.specular);
  });
});
