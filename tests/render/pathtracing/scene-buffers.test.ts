import { describe, expect, it } from 'vitest';
import {
  buildCachedPathTraceScene,
  buildPathTraceScene,
  createSceneSampler,
  directLighting,
  readLayeredClosure,
  PT_TRIANGLE_FLOATS,
  PT_MATERIAL_FLOATS,
  type PathTraceScene,
} from '../../../src/render/pathtracing/scene-buffers.ts';
import type { PathTraceBvhCache } from '../../../src/geometry/cache.ts';
import { validatePreparedGeometry } from '../../../src/render/pathtracing/scene-buffer-cache.ts';
import type { Bvh } from '../../../src/geometry/bvh.ts';
import type { GeometryResource, MaterialResource, SceneResources } from '../../../src/render/scene-resources.ts';
import type { RasterSurface } from '../../../src/render/raster/scene-frame.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
import { PT_LIGHT_FLOATS } from '../../../src/render/pathtracing/analytic-lights.ts';
import { createPcg32, integratePath, type Ray } from '../../../src/render/pathtracing/integrator.ts';
import { evalWorld, layeredSurfaceBsdf, surfaceBsdf } from '../../../src/render/pathtracing/bsdf.ts';
import {
  OBJECT_TO_WORLD_INPUT, WORLD_TO_OBJECT_INPUT, OBJECT_POSITION_INPUT, OBJECT_NORMAL_INPUT,
  OBJECT_TANGENT_INPUT, OBJECT_BITANGENT_INPUT, canonicalSurfaceToLayered, type LayeredClosure,
} from '../../../src/compiler/ir.ts';
import { packLayeredMaterial, unpackMaterialMedium, isVolumeBoundary } from '../../../src/render/pathtracing/material-record.ts';
import { evaluateSurfaceToLayered } from '../../../src/compiler/surface-eval.ts';
import { IDENTITY4, inverse4, multiply4, rotationAxis4, scaling4, transformPoint, translation4 } from '../../../src/scene/transforms.ts';
import { resolveSurface, type ResolvedSurface } from '../../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedNode } from '../../../src/materialx/graph.ts';

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

function sceneWith(materialExtra: Partial<MaterialResource> = {}): { resources: SceneResources; lights: SceneLight[] } {
  const geometries = new Map<string, GeometryResource>([['/proto', quadGeometry('/proto')]]);
  const resources = {
    geometries,
    materials: new Map<string, MaterialResource>([['mat', { unitKey: 'mat', features: { passes: [] }, ...materialExtra } as unknown as MaterialResource]]),
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
  it('keeps coated Burley entry angles and local reflection in separate compensated branches', () => {
    const closure: LayeredClosure = { opacity: 1, lobes: [{
      kind: 'subsurface', weight: 1, color: [0.6, 0.6, 0.6], subsurfaceRadius: [0.02, 0.02, 0.02], subsurfaceTransport: 2,
    }], coat: { weight: 0.6, color: [0.8, 0.9, 1], roughness: 0.2, ior: 1.5 } };
    const sampler = createSceneSampler({ ...build(), materials: packLayeredMaterial(closure) });
    const hit = sampler.intersect({ origin: [0, 0, 1], direction: [0, 0, -1] })!;
    const outgoing = [0.6, 0, 0.8] as const;
    const spatial = sampler.sampleSubsurface!(hit, () => 0.1, outgoing)!;
    expect(spatial.hit.position).not.toEqual(hit.position);
    const evaluated = sampler.evalBsdf(spatial.hit, spatial.outgoing!, [0, 0, 1]);
    const entryFresnel = 0.04 + 0.96 * 0.2 ** 5;
    const factor = (1 - 0.6 * entryFresnel) * (1 - 0.6 * 0.04);
    for (let channel = 0; channel < 3; channel++) {
      expect(evaluated.value[channel]).toBeCloseTo(factor * (0.4 + 0.6 * closure.coat!.color[channel]!) / Math.PI, 6);
    }
    const local = sampler.sampleSubsurface!(hit, () => 0.9, outgoing)!;
    expect(local.hit.position).toEqual(hit.position);
    expect(local.weight).toEqual([2, 2, 2]);
    expect(sampler.evalBsdf(local.hit, [0, 0, 1], [0, 0, 1]).value[0]).toBeGreaterThan(0);
  });
  it('applies reciprocal Fresnel transmission at Burley entry and exit for non-unit IOR', () => {
    const base = build();
    const closure: LayeredClosure = { opacity: 1, lobes: [{
      kind: 'subsurface', weight: 1, color: [0.6, 0.6, 0.6], subsurfaceRadius: [0.02, 0.02, 0.02],
      subsurfaceTransport: 2, ior: 1.5,
    }] };
    const sampler = createSceneSampler({ ...base, materials: packLayeredMaterial(closure) });
    const entry = sampler.intersect({ origin: [0, 0, 1], direction: [0, 0, -1] })!;
    const event = sampler.sampleSubsurface!(entry, () => 0.1, [0, 0, 1])!;
    expect(event.hit.position).not.toEqual(entry.position);
    const evaluated = sampler.evalBsdf(event.hit, event.outgoing!, [0, 0, 1]);
    const normalFresnel = 0.04;
    expect(evaluated.value[0]).toBeCloseTo((1 - normalFresnel) ** 2 / Math.PI, 7);
    expect(evaluated.value[0]).toBeLessThan(1 / Math.PI);
  });
  it('identifies exponential SSS interiors for independent random-walk termination', () => {
    const scene = { ...build(), materials: packLayeredMaterial({ opacity: 1, lobes: [{
      kind: 'subsurface', weight: 1, color: [0.6, 0.6, 0.6], subsurfaceRadius: [0.02, 0.02, 0.02], subsurfaceTransport: 1,
    }] }) };
    const hit = createSceneSampler(scene).intersect({ origin: [0, 0, 1], direction: [0, 0, -1] })!;
    expect(hit.interiorMedium).toBeDefined();
    expect(hit.subsurfaceInterior).toBe(true);
  });
  it('integrates Burley transport through real triangle projection without losing plane albedo', () => {
    const base = build();
    const closure: LayeredClosure = { opacity: 1, lobes: [{
      kind: 'subsurface', weight: 1, color: [0.6, 0.6, 0.6], subsurfaceRadius: [0.02, 0.02, 0.02], subsurfaceTransport: 2,
    }] };
    const scene = { ...base, materials: packLayeredMaterial(closure),
      light: { ...base.light, intensity: 0 }, environment: { ...base.environment, radiance: [1, 1, 1] as const } };
    const sampler = createSceneSampler(scene);
    const ray: Ray = { origin: [0, 0, 1], direction: [0, 0, -1] };
    const hit = sampler.intersect(ray)!;
    expect(hit.interiorMedium).toBeUndefined();
    const event = sampler.sampleSubsurface!(hit, () => 0.1)!;
    expect(event.hit.position).not.toEqual(hit.position);
    expect(event.weight[0]).toBeCloseTo(1.2, 6);
    let radiance = 0;
    const rng = createPcg32(87);
    for (let sample = 0; sample < 1000; sample++) radiance += integratePath(sampler, ray, rng)[0];
    expect(Math.abs(radiance / 1000 - 0.6)).toBeLessThan(0.05);
  });

  it('threads explicit volume coefficients from resources into GPU records and CPU hits', () => {
    const medium = { absorption: [0.1, 0.2, 0.3] as const, scattering: [0.4, 0.4, 0.4] as const, anisotropy: 0.5 };
    for (const volumeBoundary of [false, true]) {
      const { resources, lights } = sceneWith({ volumeMedium: medium, volumeBoundary });
      const scene = buildPathTraceScene(resources, { lights });
      expect(unpackMaterialMedium(scene.materials)?.anisotropy).toBeCloseTo(0.5);
      expect(isVolumeBoundary(scene.materials)).toBe(volumeBoundary);
      const hit = createSceneSampler(scene).intersect({ origin: [0, 0, 1], direction: [0, 0, -1] });
      expect(hit?.interiorMedium?.absorption[1]).toBeCloseTo(0.2);
      expect(hit?.volumeBoundary ?? false).toBe(volumeBoundary);
    }
  });
  it('packs adjacent triangles into exactly 19 scalar floats without losing positions or normals', () => {
    const scene = build();
    expect(PT_TRIANGLE_FLOATS).toBe(19);
    expect(scene.triangles.byteLength).toBe(scene.triangleCount * 76);
    expect([...scene.triangles]).toEqual([
      -1, -1, 0, 1, -1, 0, 1, 1, 0,
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      -1, -1, 0, 1, 1, 0, -1, 1, 0,
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    expect(1_413_713 * PT_TRIANGLE_FLOATS * 4).toBe(107_442_188);
    expect(1_413_713 * PT_TRIANGLE_FLOATS * 4).toBeLessThan(128 * 1024 * 1024);
  });

  it('packs ordinary USD area lights without enabling converted camera or transport settings', async () => {
    const { resources } = sceneWith();
    const sphere: SceneLight = {
      path: '/World/LEDmeetMat', type: 'sphere', usdType: 'SphereLight',
      transform: IDENTITY4, radius: 3, color: [1, 0.8, 0.1],
      intensity: 400, exposure: 2.6, normalize: true,
    };
    const rect: SceneLight = {
      ...sphere, path: '/World/Panel', type: 'rect', usdType: 'RectLight',
      width: 2, height: 2, intensity: 900, exposure: 5,
    };
    const settings = { converted: false, maxDepth: 64, rouletteDepth: 3 };
    const options = { lights: [sphere, rect, { ...sphere, type: 'dome' as const }], settings };
    const direct = buildPathTraceScene(resources, options);
    const cached = await buildCachedPathTraceScene(resources, options);
    for (const scene of [direct, cached]) {
      expect(scene.analyticLightCount).toBe(2);
      expect(scene.analyticLights).toHaveLength(2 * PT_LIGHT_FLOATS);
      expect(scene.analyticLights![4]).toBeCloseTo(400 * 2 ** 2.6 / (4 * Math.PI * 9), 4);
      expect(scene.analyticLights![PT_LIGHT_FLOATS + 4]).toBe(900 * 2 ** 5 / 4);
      expect(scene.settings).toEqual(settings);
      expect(scene.camera).toEqual(buildPathTraceScene(resources, { lights: [] }).camera);
      expect(scene.triangleCount).toBe(2);
    }
  });

  it('excludes only converted analytic emitter proxies in direct and cached builds', async () => {
    const { resources } = sceneWith();
    resources.instances[0]!.primPath = '/World/Panel_Geometry';
    const light: SceneLight = {
      path: '/World/Panel', type: 'rect', usdType: 'RectLight', transform: IDENTITY4,
      width: 2, height: 2, color: [1, 1, 1], intensity: 1, exposure: 0, normalize: false,
    };
    const options = { lights: [light], settings: { converted: true, maxDepth: 3, rouletteDepth: 2 } };
    const entries = new Map<string, Bvh>();
    const cache: PathTraceBvhCache = {
      get: async key => entries.get(key),
      set: async (key, bvh) => { entries.set(key, bvh); },
    };
    const direct = buildPathTraceScene(resources, options);
    const cached = await buildCachedPathTraceScene(resources, options, cache);
    for (const scene of [direct, cached]) {
      expect(scene.triangleCount).toBe(0);
      expect(scene.variantSources).toHaveLength(0);
      expect(scene.analyticLightCount).toBe(1);
      expect(scene.analyticLights).toHaveLength(PT_LIGHT_FLOATS);
      expect(scene.settings).toEqual(options.settings);
    }
    expect(buildPathTraceScene(resources, { lights: [light] }).triangleCount).toBe(2);
    resources.instances[0]!.primPath = '/World/Object';
    expect(buildPathTraceScene(resources, options).triangleCount).toBe(2);
  });
  it('reuses the world BVH for the same transformed geometry', async () => {
    const { resources, lights } = sceneWith();
    const entries = new Map<string, Bvh>();
    const cache: PathTraceBvhCache = {
      get: async (key) => entries.get(key),
      set: async (key, bvh) => { entries.set(key, bvh); },
    };

    const first = await buildCachedPathTraceScene(resources, { lights }, cache);
    const second = await buildCachedPathTraceScene(resources, { lights }, cache);

    expect(second.nodes).toEqual(first.nodes);
    expect(second.triangles).toEqual(first.triangles);
    expect(second.triangleOrder).toEqual(first.triangleOrder);
    expect(entries.size).toBe(1);
  });

  it('packs the quad into two world triangles with a BVH and one material', () => {
    const scene = build();
    expect(scene.triangleCount).toBe(2);
    expect(scene.triangles.length).toBe(2 * PT_TRIANGLE_FLOATS);
    expect(scene.triangleOrder.length).toBe(2);
    expect(scene.nodeCount).toBeGreaterThan(0);
    expect(scene.materialCount).toBe(1);
    expect(scene.materials.length).toBe(PT_MATERIAL_FLOATS);
  });

  it('round-trips a custom OpenPBR surface as a LayeredClosure record', () => {
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
    const closure = readLayeredClosure(scene, 0);
    const expected = canonicalSurfaceToLayered(surface);
    expect(closure.lobes.length).toBe(expected.lobes.length);
    expect(closure.lobes[0]!.kind).toBe('conductor'); // pure metal -> single conductor lobe
    expect(closure.lobes[0]!.weight).toBeCloseTo(1, 5);
    expect(closure.lobes[0]!.color[0]!).toBeCloseTo(0.2, 5);
    expect(closure.lobes[0]!.color[2]!).toBeCloseTo(0.6, 5);
    expect(closure.lobes[0]!.roughness!).toBeCloseTo(0.25, 5);
    expect(closure.opacity).toBeCloseTo(1, 5);
  });

  it('sampler BSDF matches the former 7-parameter surface (non-regression)', () => {
    const surface: RasterSurface = {
      baseColor: [0.3, 0.5, 0.7],
      metalness: 0,
      roughness: 0.3,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 0.5,
    };
    const scene = build(surface);
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] })!;
    expect(hit).not.toBeNull();
    const wo: [number, number, number] = [0, 0, 1];
    const n = Math.hypot(0.3, 0.1, 0.9);
    const wi: [number, number, number] = [0.3 / n, 0.1 / n, 0.9 / n];
    const ref = evalWorld(surfaceBsdf(surface), hit.normal, wo, wi);
    const got = sampler.evalBsdf(hit, wo, wi);
    for (let k = 0; k < 3; k++) expect(got.value[k]!).toBeCloseTo(ref.value[k]!, 6);
    expect(got.pdf).toBeCloseTo(ref.pdf, 6);
  });

  it('derives the inverse view-projection from the shared camera', () => {
    const scene = build();
    expect(scene.camera.invViewProj.length).toBe(16);
  });
});

// A quad carrying a per-vertex tangent stream (vec4: xyz + handedness).
function quadGeometryTangent(prototypeId: string, tangent: readonly number[]): GeometryResource {
  const base = quadGeometry(prototypeId) as unknown as { streams: { name: string; data: Float32Array; components: number }[] };
  const data = new Float32Array([...tangent, ...tangent, ...tangent, ...tangent]);
  base.streams.push({ name: 'tangent', data, components: 4 });
  return base as unknown as GeometryResource;
}

function sceneWithTangents(tangent: readonly number[]): { resources: SceneResources; lights: SceneLight[] } {
  const scene = sceneWith();
  (scene.resources.geometries as Map<string, GeometryResource>).set('/proto', quadGeometryTangent('/proto', tangent));
  return scene;
}

describe('buildPathTraceScene tangent packing (T057l)', () => {
  it('packs per-triangle world tangents and handedness (12 floats/tri)', () => {
    const { resources, lights } = sceneWithTangents([1, 0, 0, 1]);
    const scene = buildPathTraceScene(resources, { lights });
    expect(scene.triangleTangent.length).toBe(scene.triangleCount * 12);
    // Identity transform: the +X tangent round-trips to each of the 3 vertex slots.
    for (let tri = 0; tri < scene.triangleCount; tri++) {
      for (let slot = 0; slot < 3; slot++) {
        const b = tri * 12 + slot * 4;
        expect(scene.triangleTangent[b]!).toBeCloseTo(1, 6);
        expect(scene.triangleTangent[b + 1]!).toBeCloseTo(0, 6);
        expect(scene.triangleTangent[b + 2]!).toBeCloseTo(0, 6);
        expect(scene.triangleTangent[b + 3]!).toBe(1);
      }
    }
  });

  it('preserves the negative handedness of mirrored UV frames', () => {
    const { resources, lights } = sceneWithTangents([1, 0, 0, -1]);
    const scene = buildPathTraceScene(resources, { lights });
    for (let i = 3; i < scene.triangleTangent.length; i += 4) {
      expect(scene.triangleTangent[i]).toBe(-1);
    }
  });

  it('normalizes packed tangents to unit length', () => {
    const { resources, lights } = sceneWithTangents([0, 3, 0, 1]);
    const scene = buildPathTraceScene(resources, { lights });
    const b = 0;
    const len = Math.hypot(scene.triangleTangent[b]!, scene.triangleTangent[b + 1]!, scene.triangleTangent[b + 2]!);
    expect(len).toBeCloseTo(1, 6);
    expect(scene.triangleTangent[b + 1]!).toBeCloseTo(1, 6);
  });

  it('leaves the tangent buffer empty when no geometry authored tangents', () => {
    const scene = build();
    expect(scene.triangleTangent.length).toBe(0);
  });

  it.each([false, true])('zero-fills missing tangents in mixed geometry (tangents first: %s)', tangentFirst => {
    const { resources, lights } = sceneWith();
    const geometries = new Map(resources.geometries);
    geometries.set('/tangent', quadGeometryTangent('/tangent', [1, 0, 0, 1]));
    const tangentInstance = { ...resources.instances[0]!, id: '/tangent', primPath: '/tangent', prototypeId: '/tangent' };
    const instances = tangentFirst ? [tangentInstance, ...resources.instances] : [...resources.instances, tangentInstance];
    const scene = buildPathTraceScene({ ...resources, geometries, instances }, { lights });
    expect(scene.triangleTangent.length).toBe(scene.triangleCount * 12);
    expect([...scene.triangleTangent].every(Number.isFinite)).toBe(true);
    const missingOffset = tangentFirst ? 24 : 0;
    const authoredOffset = tangentFirst ? 0 : 24;
    expect([...scene.triangleTangent.slice(missingOffset, missingOffset + 24)]).toEqual(Array(24).fill(0));
    expect([...scene.triangleTangent.slice(authoredOffset, authoredOffset + 24)]).toEqual(Array(6).fill([1, 0, 0, 1]).flat());
    expect(() => validatePreparedGeometry(scene, scene.materialCount)).not.toThrow();
  });
});

/** A standard_surface whose base_color is driven by a connected constant node:
 *  a minimal graph-backed material (not a flat constant surface). */
function brickGraph(): { graph: ResolvedGraph; surface: ResolvedSurface } {
  const surfaceNode: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'brick' }, provenance: { namePath: '/mat/base_color' } },
    ],
    provenance: { namePath: '/mat/SR' },
  };
  const brick: ResolvedNode = {
    id: 'brick',
    category: 'constant',
    type: 'color3',
    inputs: [
      { name: 'value', type: 'color3', source: { kind: 'value', value: '0.661876, 0.19088, 0', type: 'color3' }, provenance: { namePath: '/mat/brick/value' } },
    ],
    provenance: { namePath: '/mat/brick' },
  };
  const graph: ResolvedGraph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode], ['brick', brick]]),
  };
  const surface = resolveSurface(graph, {});
  expect(surface).not.toBeNull();
  return { graph, surface: surface! };
}

describe('variantSources classification (T057i1)', () => {
  it('records a variant source for a material backed by a resolved surface graph', () => {
    const { graph, surface } = brickGraph();
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const scene = buildPathTraceScene(resources, { lights });
    expect(scene.variantSources.length).toBe(1);
    expect(scene.variantSources[0]!.materialIndex).toBe(0);
    expect(scene.variantSources[0]!.graph).toBe(graph);
    expect(scene.variantSources[0]!.surface).toBe(surface);
    // The constant record is still packed alongside (fallback for non-variant draws).
    expect(scene.materialCount).toBe(1);
    expect(scene.materials.length).toBe(PT_MATERIAL_FLOATS);
  });

  it('leaves variantSources empty for a constant-only material', () => {
    const scene = build();
    expect(scene.variantSources).toEqual([]);
  });
});

describe('createSceneSampler procedural oracle (T057i3)', () => {
  const normalLength = Math.hypot(0.475, 0.775);
  const interpolatedNormal = [0.475 / normalLength, 0, 0.775 / normalLength];

  it('uses object-space Worley 3D on transformed instances and cached geometry', () => {
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
      nodes: new Map<string, ResolvedNode>([
        ['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs: [
          { name: 'base', type: 'float', source: { kind: 'connection', nodeId: 'worley' }, provenance: { namePath: '/s/base' } },
          { name: 'specular', type: 'float', source: { kind: 'value', type: 'float', value: '0' }, provenance: { namePath: '/s/specular' } },
        ], provenance: { namePath: '/s' } }],
        ['worley', { id: 'worley', category: 'worleynoise3d', type: 'float', inputs: [
          { name: 'jitter', type: 'float', source: { kind: 'value', type: 'float', value: '0.65' }, provenance: { namePath: '/worley/jitter' } },
        ], provenance: { namePath: '/worley' } }],
      ]),
    };
    const surface = resolveSurface(graph)!;
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const models = [
      translation4(-4, 0, 0),
      multiply4(translation4(4, 0, 0), multiply4(rotationAxis4(2, 90), scaling4(2, 3, 4))),
    ];
    resources.instances = models.map((transform, index) => ({
      id: `/instance${index}`, primPath: `/instance${index}`, prototypeId: '/proto',
      materialKey: 'mat', hasGeometry: true, transform,
    }));
    const scene = buildPathTraceScene(resources, { lights });
    const cached = buildPathTraceScene(resources, { lights }, undefined, undefined, scene);
    expect(cached.objectGeometry?.get('/proto')?.positions).toBe(resources.geometries.get('/proto')!.streams[0]!.data);
    const sampler = createSceneSampler(cached);
    const localPosition = [0.13, 0.27, 0] as const;
    const direction = [0, 0, 1] as const;
    const evaluated: (readonly number[])[] = [];
    for (const model of models) {
      const worldPosition = transformPoint(model, localPosition);
      const hit = sampler.intersect({ origin: [worldPosition[0], worldPosition[1], 2], direction: [0, 0, -1] })!;
      expect(hit).not.toBeNull();
      const actual = sampler.evalBsdf(hit, direction, direction);
      const closure = evaluateSurfaceToLayered(graph, surface, {
        position: worldPosition, inputs: { [OBJECT_POSITION_INPUT]: localPosition },
      });
      const expected = evalWorld(layeredSurfaceBsdf(closure), hit.normal, direction, direction);
      actual.value.forEach((value, i) => expect(value).toBeCloseTo(expected.value[i]!, 6));
      evaluated.push(actual.value);
    }
    evaluated[0]!.forEach((value, i) => expect(value).toBeCloseTo(evaluated[1]![i]!, 6));

    const material = resources.materials.get('mat')!;
    const unbaked = { ...resources, materials: new Map([['mat', { ...material, displacement: { file: 'height.png', scale: 1 } }]]) };
    expect(() => buildPathTraceScene(unbaked, { lights })).toThrow('requires displacement to be baked');
    graph.nodes.get('worley')!.inputs.push({
      name: 'position', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0.13, 0.27, 0.19' },
      provenance: { namePath: '/worley/position' },
    });
    expect(buildPathTraceScene(resources, { lights }).objectGeometry?.size ?? 0).toBe(0);
    expect(() => buildPathTraceScene(unbaked, { lights })).not.toThrow();
  });

  it('preserves triplanar object-space attributes on transformed instances and cached geometry', () => {
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
      nodes: new Map<string, ResolvedNode>([
        ['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs: [
          { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'tri' }, provenance: { namePath: '/s/base_color' } },
          { name: 'specular', type: 'float', source: { kind: 'value', type: 'float', value: '0' }, provenance: { namePath: '/s/specular' } },
        ], provenance: { namePath: '/s' } }],
        ['tri', { id: 'tri', category: 'triplanarprojection', type: 'color3', inputs: [
          { name: 'filex', type: 'filename', source: { kind: 'value', type: 'filename', value: 'x.png' }, provenance: { namePath: '/tri/filex' } },
          { name: 'default', type: 'color3', source: { kind: 'value', type: 'color3', value: '0.3,0.6,0.9' }, provenance: { namePath: '/tri/default' } },
        ], provenance: { namePath: '/tri' } }],
      ]),
    };
    const surface = resolveSurface(graph)!;
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const normals = resources.geometries.get('/proto')!.streams.find(stream => stream.name === 'normal')!.data;
    normals.set([0.6, 0, 0.8, 0.6, 0, 0.8, 0.6, 0, 0.8, 0.6, 0, 0.8]);
    const models = [
      translation4(-4, 0, 0),
      multiply4(translation4(4, 0, 0), multiply4(rotationAxis4(2, 90), scaling4(2, 3, 4))),
    ];
    resources.instances = models.map((transform, index) => ({
      id: `/instance${index}`, primPath: `/instance${index}`, prototypeId: '/proto',
      materialKey: 'mat', hasGeometry: true, transform,
    }));
    const scene = buildPathTraceScene(resources, { lights });
    const cached = buildPathTraceScene(resources, { lights }, undefined, undefined, scene);
    expect(cached.objectGeometry?.size).toBe(1);
    expect(cached.objectGeometry?.get('/proto')?.normals).toBe(normals);
    const sampler = createSceneSampler(cached);
    const localPosition = [0.13, 0.27, 0] as const;
    const localNormal = [0.6, 0, 0.8] as const;
    const direction = [0, 0, 1] as const;
    for (const [index, model] of models.entries()) {
      const worldPosition = transformPoint(model, localPosition);
      const hit = sampler.intersect({ origin: [worldPosition[0], worldPosition[1], 2], direction: [0, 0, -1] })!;
      expect(hit).not.toBeNull();
      const actual = sampler.evalBsdf(hit, direction, direction);
      const closure = evaluateSurfaceToLayered(graph, surface, {
        position: worldPosition, inputs: { [OBJECT_POSITION_INPUT]: localPosition, [OBJECT_NORMAL_INPUT]: localNormal },
      });
      const expected = evalWorld(layeredSurfaceBsdf(closure), hit.normal, direction, direction);
      actual.value.forEach((value, i) => expect(value).toBeCloseTo(expected.value[i]!, 6));
      if (index === 1) {
        const wrong = evaluateSurfaceToLayered(graph, surface, {
          position: worldPosition, inputs: { [OBJECT_POSITION_INPUT]: localPosition, [OBJECT_NORMAL_INPUT]: hit.normal },
        });
        const worldWeighted = evalWorld(layeredSurfaceBsdf(wrong), hit.normal, direction, direction);
        expect(Math.abs(actual.value[0] - worldWeighted.value[0])).toBeGreaterThan(0.001);
      }
    }

    const material = resources.materials.get('mat')!;
    const unbaked = { ...resources, materials: new Map([['mat', { ...material, displacement: { file: 'height.png', scale: 1 } }]]) };
    expect(() => buildPathTraceScene(unbaked, { lights })).toThrow('requires displacement to be baked');
    graph.nodes.get('tri')!.inputs.push(
      { name: 'position', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0.1,0.2,0.3' }, provenance: { namePath: '/tri/position' } },
      { name: 'normal', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0,0,1' }, provenance: { namePath: '/tri/normal' } },
    );
    expect(buildPathTraceScene(resources, { lights }).objectGeometry?.size ?? 0).toBe(0);
    expect(() => buildPathTraceScene(unbaked, { lights })).not.toThrow();
  });

  it('uses the same object-space flake3d pattern on transformed instances and cached geometry', () => {
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
      nodes: new Map<string, ResolvedNode>([
        ['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs: [
          { name: 'base', type: 'float', source: { kind: 'connection', nodeId: 'flake', output: 'presence' }, provenance: { namePath: '/s/base' } },
          { name: 'specular', type: 'float', source: { kind: 'value', type: 'float', value: '0' }, provenance: { namePath: '/s/specular' } },
        ], provenance: { namePath: '/s' } }],
        ['flake', { id: 'flake', category: 'flake3d', type: 'multioutput', inputs: [
          { name: 'size', type: 'float', source: { kind: 'value', type: 'float', value: '0.1' }, provenance: { namePath: '/flake/size' } },
          { name: 'coverage', type: 'float', source: { kind: 'value', type: 'float', value: '1' }, provenance: { namePath: '/flake/coverage' } },
        ], provenance: { namePath: '/flake' } }],
      ]),
    };
    const surface = resolveSurface(graph)!;
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const models = [
      translation4(-4, 0, 0),
      multiply4(translation4(4, 0, 0), multiply4(rotationAxis4(2, 90), scaling4(2, 3, 4))),
    ];
    resources.instances = models.map((transform, index) => ({
      id: `/instance${index}`, primPath: `/instance${index}`, prototypeId: '/proto',
      materialKey: 'mat', hasGeometry: true, transform,
    }));
    const scene = buildPathTraceScene(resources, { lights });
    const cached = buildPathTraceScene(resources, { lights }, undefined, undefined, scene);
    expect(scene.objectGeometry?.size).toBe(1);
    expect(cached.objectGeometry?.size).toBe(1);
    expect(cached.objectGeometry?.get('/proto')?.positions).toBe(resources.geometries.get('/proto')!.streams[0]!.data);

    const sampler = createSceneSampler(cached);
    const localPosition = [0.13, 0.27, 0] as const;
    const direction = [0, 0, 1] as const;
    const evaluated: (readonly number[])[] = [];
    for (const model of models) {
      const worldPosition = transformPoint(model, localPosition);
      const hit = sampler.intersect({ origin: [worldPosition[0], worldPosition[1], 2], direction: [0, 0, -1] })!;
      expect(hit).not.toBeNull();
      const actual = sampler.evalBsdf(hit, direction, direction);
      const closure = evaluateSurfaceToLayered(graph, surface, {
        position: worldPosition, inputs: { [OBJECT_POSITION_INPUT]: localPosition },
      });
      const expected = evalWorld(layeredSurfaceBsdf(closure), hit.normal, direction, direction);
      actual.value.forEach((value, i) => expect(value).toBeCloseTo(expected.value[i]!, 6));
      evaluated.push(actual.value);
    }
    evaluated[0]!.forEach((value, i) => expect(value).toBeCloseTo(evaluated[1]![i]!, 6));

    const material = resources.materials.get('mat')!;
    const unbaked = { ...resources, materials: new Map([['mat', { ...material, displacement: { file: 'height.png', scale: 1 } }]]) };
    expect(() => buildPathTraceScene(unbaked, { lights })).toThrow('requires displacement to be baked');
    expect(() => buildPathTraceScene(unbaked, { lights, displacementScale: 0 })).not.toThrow();

    graph.nodes.get('flake')!.inputs.push({
      name: 'position', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0.13, 0.27, 0.19' },
      provenance: { namePath: '/flake/position' },
    });
    expect(buildPathTraceScene(resources, { lights }).objectGeometry?.size ?? 0).toBe(0);
    expect(() => buildPathTraceScene(unbaked, { lights })).not.toThrow();
  });

  it.each([
    { category: 'position', op: 'transformpoint', field: OBJECT_POSITION_INPUT, local: [0.25, 0, 0] },
    { category: 'normal', op: 'transformnormal', field: OBJECT_NORMAL_INPUT, local: interpolatedNormal },
    { category: 'tangent', op: 'transformvector', field: OBJECT_TANGENT_INPUT, local: [0, 1, 0] },
    { category: 'bitangent', op: 'transformvector', field: OBJECT_BITANGENT_INPUT,
      local: [interpolatedNormal[2]!, 0, -interpolatedNormal[0]!] },
  ])('interpolates object-space $category per instance with cached geometry', ({ category, op, field, local }) => {
    const connection = (name: string, nodeId: string) => ({
      name, type: 'vector3', source: { kind: 'connection' as const, nodeId }, provenance: { namePath: `/${name}` },
    });
    const value = (name: string, type: string, raw: string) => ({
      name, type, source: { kind: 'value' as const, type, value: raw }, provenance: { namePath: `/${name}` },
    });
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
      nodes: new Map<string, ResolvedNode>([
        ['s', { id: 's', category: 'standard_surface', type: 'surfaceshader',
          inputs: [{ ...connection('base_color', 'biased'), type: 'color3' }], provenance: { namePath: '/s' } }],
        ['biased', { id: 'biased', category: 'add', type: 'vector3',
          inputs: [connection('in1', 'scaled'), value('in2', 'vector3', '0.5,0.5,0.5')], provenance: { namePath: '/biased' } }],
        ['scaled', { id: 'scaled', category: 'multiply', type: 'vector3',
          inputs: [connection('in1', 'transformed'), value('in2', 'vector3', '0.1,0.1,0.1')], provenance: { namePath: '/scaled' } }],
        ['transformed', { id: 'transformed', category: op, type: 'vector3',
          inputs: [connection('in', 'geometry'), value('fromspace', 'string', 'object'), value('tospace', 'string', 'world')],
          provenance: { namePath: '/transformed' } }],
        ['geometry', { id: 'geometry', category, type: 'vector3', inputs: [], provenance: { namePath: '/geometry' } }],
      ]),
    };
    const surface = resolveSurface(graph)!;
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const geometry = resources.geometries.get('/proto')!;
    const normal = new Float32Array([0, 0, 1, 0.6, 0, 0.8, 0.8, 0, 0.6, 0, 0, 1]);
    const tangent = new Float32Array(Array.from({ length: 4 }, () => [0, 1, 0, -1]).flat());
    resources.geometries = new Map([['/proto', { ...geometry, streams: [
      geometry.streams[0]!, { name: 'normal', data: normal, components: 3 },
      { name: 'tangent', data: tangent, components: 4 },
    ] }]]);
    const models = [
      multiply4(translation4(-4, 0, 0), scaling4(1, 2, 1)),
      multiply4(translation4(4, 0, 0), multiply4(rotationAxis4(2, 90), scaling4(2, 3, 4))),
    ];
    resources.instances = models.map((transform, index) => ({
      id: `/instance${index}`, primPath: `/instance${index}`, prototypeId: '/proto',
      materialKey: 'mat', hasGeometry: true, transform,
    }));
    const scene = buildPathTraceScene(resources, { lights });
    const cached = buildPathTraceScene(resources, { lights }, undefined, undefined, scene);
    expect(cached.objectGeometry?.get('/proto')?.normals).toBe(normal);
    expect(cached.objectGeometry?.size).toBe(1);
    if (category === 'position') {
      const material = resources.materials.get('mat')!;
      const unbaked = { ...resources, materials: new Map([['mat', { ...material, displacement: { file: 'height.png', scale: 1 } }]]) };
      expect(() => buildPathTraceScene(unbaked, { lights })).toThrow('requires displacement to be baked');
      expect(() => buildPathTraceScene(unbaked, { lights, displacementScale: 0 })).not.toThrow();
    }
    const sampler = createSceneSampler(cached);
    for (const model of models) {
      const position = transformPoint(model, [0.25, 0, 0]);
      const hit = sampler.intersect({ origin: [position[0], position[1], 2], direction: [0, 0, -1] })!;
      expect(hit).not.toBeNull();
      const direction = [0, 0, 1] as const;
      const actual = sampler.evalBsdf(hit, direction, direction);
      const closure = evaluateSurfaceToLayered(graph, surface, {
        inputs: { [field]: local, [OBJECT_TO_WORLD_INPUT]: model, [WORLD_TO_OBJECT_INPUT]: inverse4(model, true) },
      });
      const expected = evalWorld(layeredSurfaceBsdf(closure), hit.normal, direction, direction);
      actual.value.forEach((value, i) => expect(value).toBeCloseTo(expected.value[i]!, 6));
    }
  });

  it.each([
    { category: 'normal', op: 'transformnormal', field: OBJECT_NORMAL_INPUT, local: [-Math.SQRT1_2, 0, Math.SQRT1_2] },
    { category: 'tangent', op: 'transformvector', field: OBJECT_TANGENT_INPUT, local: [Math.SQRT1_2, 0, Math.SQRT1_2] },
    { category: 'bitangent', op: 'transformvector', field: OBJECT_BITANGENT_INPUT, local: [0, 1, 0] },
  ])('uses the face-normal fallback without normals or tangents for transformed $category', ({ category, op, field, local }) => {
    const connection = (name: string, nodeId: string) => ({
      name, type: 'vector3', source: { kind: 'connection' as const, nodeId }, provenance: { namePath: `/${name}` },
    });
    const value = (name: string, type: string, raw: string) => ({
      name, type, source: { kind: 'value' as const, type, value: raw }, provenance: { namePath: `/${name}` },
    });
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
      nodes: new Map<string, ResolvedNode>([
        ['s', { id: 's', category: 'standard_surface', type: 'surfaceshader',
          inputs: [{ ...connection('base_color', 'biased'), type: 'color3' }], provenance: { namePath: '/s' } }],
        ['biased', { id: 'biased', category: 'add', type: 'vector3',
          inputs: [connection('in1', 'scaled'), value('in2', 'vector3', '0.5,0.5,0.5')], provenance: { namePath: '/biased' } }],
        ['scaled', { id: 'scaled', category: 'multiply', type: 'vector3',
          inputs: [connection('in1', 'transformed'), value('in2', 'vector3', '0.1,0.1,0.1')], provenance: { namePath: '/scaled' } }],
        ['transformed', { id: 'transformed', category: op, type: 'vector3',
          inputs: [connection('in', 'geometry'), value('fromspace', 'string', 'object'), value('tospace', 'string', 'world')],
          provenance: { namePath: '/transformed' } }],
        ['geometry', { id: 'geometry', category, type: 'vector3', inputs: [], provenance: { namePath: '/geometry' } }],
      ]),
    };
    const surface = resolveSurface(graph)!;
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const geometry = resources.geometries.get('/proto')!;
    const positions = new Float32Array([-1, -1, -1, 1, -1, 1, 1, 1, 1, -1, 1, -1]);
    resources.geometries = new Map([['/proto', {
      ...geometry, streams: [{ name: 'position', components: 3, data: positions }],
    }]]);
    const model = scaling4(1, 2, 3);
    resources.instances[0]!.transform = model;
    const sampler = createSceneSampler(buildPathTraceScene(resources, { lights }));
    const hit = sampler.intersect({ origin: [0, 0, 3], direction: [0, 0, -1] })!;
    expect(hit).not.toBeNull();
    const direction = [0, 0, 1] as const;
    const actual = sampler.evalBsdf(hit, direction, direction);
    const closure = evaluateSurfaceToLayered(graph, surface, {
      inputs: { [field]: local, [OBJECT_TO_WORLD_INPUT]: model, [WORLD_TO_OBJECT_INPUT]: inverse4(model, true) },
    });
    const expected = evalWorld(layeredSurfaceBsdf(closure), hit.normal, direction, direction);
    actual.value.forEach((value, i) => expect(value).toBeCloseTo(expected.value[i]!, 6));
  });

  it('uses the hit instance transform for two instances sharing one material, including cached geometry', () => {
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance: { namePath: '/s' } }],
      nodes: new Map([
        ['s', { id: 's', category: 'standard_surface', type: 'surfaceshader', inputs: [
          { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'v' }, provenance: { namePath: '/s/base_color' } },
        ], provenance: { namePath: '/s' } }],
        ['v', { id: 'v', category: 'transformvector', type: 'vector3', inputs: [
          { name: 'in', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0.2,0.2,0.2' }, provenance: { namePath: '/v/in' } },
          { name: 'fromspace', type: 'string', source: { kind: 'value', type: 'string', value: 'object' }, provenance: { namePath: '/v/fromspace' } },
          { name: 'tospace', type: 'string', source: { kind: 'value', type: 'string', value: 'world' }, provenance: { namePath: '/v/tospace' } },
        ], provenance: { namePath: '/v' } }],
      ]),
    };
    const surface = resolveSurface(graph)!;
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const second = multiply4(translation4(5, 0, 0), scaling4(2, 1, 1));
    resources.instances = [
      { id: '/a', primPath: '/a', prototypeId: '/proto', materialKey: 'mat', hasGeometry: true, transform: IDENTITY4 },
      { id: '/b', primPath: '/b', prototypeId: '/proto', materialKey: 'mat', hasGeometry: true, transform: second },
    ];
    const scene = buildPathTraceScene(resources, { lights });
    const cached = buildPathTraceScene(resources, { lights }, undefined, undefined, scene);
    expect(cached.transformRanges).toEqual(scene.transformRanges);
    expect(scene.transformRanges?.map(range => [range.firstTriangle, range.triangleCount])).toEqual([[0, 2], [2, 2]]);
    const sampler = createSceneSampler(cached);
    for (const [x, model] of [[0, IDENTITY4], [5, second]] as const) {
      const hit = sampler.intersect({ origin: [x, 0, 2], direction: [0, 0, -1] })!;
      const direction = [0, 0, 1] as const;
      const actual = sampler.evalBsdf(hit, direction, direction);
      const expected = evalWorld(layeredSurfaceBsdf(evaluateSurfaceToLayered(graph, surface, {
        inputs: { [OBJECT_TO_WORLD_INPUT]: model },
      })), hit.normal, direction, direction);
      actual.value.forEach((value, i) => expect(value).toBeCloseTo(expected.value[i]!, 6));
    }
  });

  it('shades a variant material with its evaluated graph, not the packed constant', () => {
    const { graph, surface } = brickGraph();
    const { resources, lights } = sceneWith({ surfaceGraph: graph, resolvedSurface: surface });
    const scene = buildPathTraceScene(resources, { lights });
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] })!;
    expect(hit).not.toBeNull();
    const wo: [number, number, number] = [0, 0, 1];
    const wi: [number, number, number] = [0, 0, 1];
    const got = sampler.evalBsdf(hit, wo, wi);
    // The sampler must use the evaluated graph closure (brick base_color)...
    const variant = evalWorld(layeredSurfaceBsdf(evaluateSurfaceToLayered(graph, surface)), hit.normal, wo, wi);
    for (let k = 0; k < 3; k++) expect(got.value[k]!).toBeCloseTo(variant.value[k]!, 6);
    // ...not the packed constant record it falls back to for non-variant draws.
    const constant = evalWorld(layeredSurfaceBsdf(readLayeredClosure(scene, 0)), hit.normal, wo, wi);
    expect(Math.abs(got.value[0]! - constant.value[0]!)).toBeGreaterThan(0.01);
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

describe('interior medium oracle wiring', () => {
  it('attaches an absorbing interior when the hit material transmits with attenuation', () => {
    const scene = build();
    const glass: LayeredClosure = {
      lobes: [
        {
          kind: 'dielectric_transmission',
          weight: 1,
          color: [1, 1, 1],
          roughness: 0.02,
          ior: 1.5,
          attenuationColor: [0.5, 0.5, 0.5],
          attenuationDistance: 2,
        },
      ],
      opacity: 1,
    };
    scene.materials.set(packLayeredMaterial(glass), 0);
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] })!;
    expect(hit.interiorMedium).toBeDefined();
    // attenuationColor 0.5 reached at distance 2 -> sigma_a = -ln(0.5)/2, no scattering.
    expect(hit.interiorMedium!.absorption[0]).toBeCloseTo(-Math.log(0.5) / 2, 6);
    expect(hit.interiorMedium!.scattering[0]).toBe(0);
  });

  it('derives a scattering interior from a subsurface lobe radius', () => {
    const scene = build();
    const skin: LayeredClosure = {
      lobes: [{ kind: 'subsurface', weight: 1, color: [0.9, 0.5, 0.4], subsurfaceRadius: [1.2, 0.4, 0.2] }],
      opacity: 1,
    };
    scene.materials.set(packLayeredMaterial(skin), 0);
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] })!;
    expect(hit.interiorMedium).toBeDefined();
    expect(hit.interiorMedium!.scattering[0]).toBeGreaterThan(0);
  });

  it('attaches no interior medium to an opaque material', () => {
    const scene = build({
      baseColor: [0.5, 0.5, 0.5],
      metalness: 0,
      roughness: 0.3,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 0.5,
    });
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] })!;
    expect(hit.interiorMedium).toBeUndefined();
  });

  it('does not flag a reflective metal sample as transmission', () => {
    const scene = build({
      baseColor: [0.9, 0.7, 0.4],
      metalness: 1,
      roughness: 0.2,
      transmission: 0,
      subsurface: 0,
      ior: 1.5,
      specular: 1,
    });
    const sampler = createSceneSampler(scene);
    const hit = sampler.intersect({ origin: [0, 0, 2], direction: [0, 0, -1] })!;
    const bs = sampler.sampleBsdf(hit, [0, 0, 1], createPcg32(7))!;
    expect(bs).not.toBeNull();
    expect(bs.transmission).toBe(false);
  });
});
