import { describe, expect, it } from 'vitest';
import {
  buildPathTraceScene,
  createSceneSampler,
  directLighting,
  readLayeredClosure,
  PT_TRIANGLE_FLOATS,
  PT_MATERIAL_FLOATS,
  type PathTraceScene,
} from '../../../src/render/pathtracing/scene-buffers.ts';
import type { GeometryResource, MaterialResource, SceneResources } from '../../../src/render/scene-resources.ts';
import type { RasterSurface } from '../../../src/render/raster/scene-frame.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
import { createPcg32, integratePath, type Ray } from '../../../src/render/pathtracing/integrator.ts';
import { evalWorld, surfaceBsdf } from '../../../src/render/pathtracing/bsdf.ts';
import { canonicalSurfaceToLayered } from '../../../src/compiler/ir.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';
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
