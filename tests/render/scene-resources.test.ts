import { describe, expect, it, vi } from 'vitest';
import * as acceleration from '../../src/geometry/bvh.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { IrModuleBuilder, FLOAT, shaderType } from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedInput, ResolvedNode, ResolvedValueSource } from '../../src/materialx/graph.ts';
import { IR_FORWARD_FRAME_GROUP } from '../../src/render/raster/ir-forward.ts';
import type { RawMesh } from '../../src/geometry/prepare.ts';
import { prepareMesh } from '../../src/geometry/prepare.ts';
import type { MaterialXReference, SceneAsset, ScenePrim, XformOp } from '../../src/scene/types.ts';
import type { MaterialCompileUnit } from '../../src/usd/materials.ts';
import {
  buildSceneResources,
  createSceneBindGroups,
  uploadGeometry,
  type MaterialBuild,
  type MaterialCompiler,
  type MeshSource,
} from '../../src/render/scene-resources.ts';

function prim(path: string, overrides: Partial<ScenePrim> = {}): ScenePrim {
  const name = path.split('/').filter(Boolean).pop() ?? '';
  return {
    path,
    name,
    specifier: 'def',
    apiSchemas: [],
    inherits: [],
    references: [],
    payloads: [],
    attributes: new Map(),
    relationships: new Map(),
    xformOps: [],
    children: [],
    ...overrides,
  };
}

const translate = (x: number, y: number, z: number): XformOp => ({
  op: 'xformOp:translate',
  typeName: 'double3',
  value: [x, y, z],
  invert: false,
});

const FLOOR_MTLX: MaterialXReference = {
  primPath: '/World/Looks/floor',
  assetPath: './floor.mtlx',
  referencedPrimPath: '/MaterialX/Materials/floor',
  materialName: 'floor',
};
const FLOOR_KEY = './floor.mtlx::/MaterialX/Materials/floor';

function demoScene(): SceneAsset {
  const world = prim('/World', { children: ['/World/floor', '/World/orphan', '/World/Looks'] });
  const floor = prim('/World/floor', {
    typeName: 'Mesh',
    mesh: { primvars: [] },
    xformOps: [translate(2, 0, 0)],
    materialBinding: { target: '/World/Looks/floor', strength: 'weakerThanDescendants' },
  });
  const orphan = prim('/World/orphan', { typeName: 'Mesh', mesh: { primvars: [] } });
  const looks = prim('/World/Looks', { children: ['/World/Looks/floor'] });
  const material = prim('/World/Looks/floor', { typeName: 'Material' });
  const prims = [world, floor, orphan, looks, material];
  return {
    entry: 'root.usda',
    stage: { subLayers: [] },
    prims: new Map(prims.map((p) => [p.path, p])),
    roots: ['/World'],
    materials: [FLOOR_MTLX],
  };
}

function quad(): RawMesh {
  return {
    points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    faceVertexCounts: [4],
    faceVertexIndices: [0, 1, 2, 3],
    primvars: [
      { name: 'st', interpolation: 'vertex', elementSize: 2, values: [0, 0, 1, 0, 1, 1, 0, 1] },
    ],
  };
}

function surfaceCompiler(): MaterialCompiler {
  return {
    compile(_unit: MaterialCompileUnit): MaterialBuild {
      const b = new IrModuleBuilder();
      const opacity = b.constant(FLOAT, 1);
      const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
      const ir = b.build();
      return { ir, module: emitWgsl(ir) };
    },
  };
}

function value(name: string, type: string, raw: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

function surfaceGraph(baseColor = '0.8, 0.1, 0.1'): ResolvedGraph {
  const surface: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [value('base_color', 'color3', baseColor)],
    provenance: { namePath: '/mat/SR' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surface]]),
  };
}

/** A compiler that also returns a compiled layered surface module, so the scene
 *  carries the IR scene-forward shader per material (T058d). */
function layeredCompiler(): MaterialCompiler {
  return {
    compile(_unit: MaterialCompileUnit): MaterialBuild {
      const b = new IrModuleBuilder();
      const opacity = b.constant(FLOAT, 1);
      const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
      const ir = b.build();
      const graph = surfaceGraph();
      const resolved = resolveSurface(graph, {})!;
      return { ir, module: emitWgsl(ir), layered: emitLayeredSurface(graph, resolved) };
    },
  };
}

function meshSource(map: Record<string, RawMesh>): MeshSource {
  return { meshFor: (path) => map[path] };
}

const BRICK_MTLX: MaterialXReference = {
  primPath: '/World/Looks/brick',
  assetPath: './brick.mtlx',
  referencedPrimPath: '/MaterialX/Materials/brick',
  materialName: 'brick',
};
const BRICK_KEY = './brick.mtlx::/MaterialX/Materials/brick';
const GROUND_MTLX: MaterialXReference = {
  primPath: '/World/Looks/ground',
  assetPath: './ground.mtlx',
  referencedPrimPath: '/MaterialX/Materials/ground',
  materialName: 'ground',
};
const GROUND_KEY = './ground.mtlx::/MaterialX/Materials/ground';

/** Two meshes bound to two distinct materials, mirroring the brick/ground scene. */
function twoMaterialScene(): SceneAsset {
  const world = prim('/World', { children: ['/World/cube', '/World/ground', '/World/Looks'] });
  const cube = prim('/World/cube', {
    typeName: 'Mesh',
    mesh: { primvars: [] },
    materialBinding: { target: '/World/Looks/brick', strength: 'weakerThanDescendants' },
  });
  const ground = prim('/World/ground', {
    typeName: 'Mesh',
    mesh: { primvars: [] },
    xformOps: [translate(0, -1, 0)],
    materialBinding: { target: '/World/Looks/ground', strength: 'weakerThanDescendants' },
  });
  const looks = prim('/World/Looks', { children: ['/World/Looks/brick', '/World/Looks/ground'] });
  const prims = [world, cube, ground, looks, prim('/World/Looks/brick', { typeName: 'Material' }), prim('/World/Looks/ground', { typeName: 'Material' })];
  return {
    entry: 'root.usda',
    stage: { subLayers: [] },
    prims: new Map(prims.map((p) => [p.path, p])),
    roots: ['/World'],
    materials: [BRICK_MTLX, GROUND_MTLX],
  };
}

/** A layered compiler whose neutral mx_shade IR is identical for every material
 *  (as createGraphMaterialCompiler does) but whose layered module differs by the
 *  unit's base_color, so the real shading is what must keep pipeline keys apart. */
function distinctLayeredCompiler(colors: Record<string, string>): MaterialCompiler {
  return {
    compile(unit: MaterialCompileUnit): MaterialBuild {
      const b = new IrModuleBuilder();
      const opacity = b.constant(FLOAT, 1);
      const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
      const ir = b.build();
      const graph = surfaceGraph(colors[unit.materialName] ?? '0.5, 0.5, 0.5');
      const resolved = resolveSurface(graph, {})!;
      return { ir, module: emitWgsl(ir), layered: emitLayeredSurface(graph, resolved) };
    },
  };
}

describe('buildSceneResources (T050)', () => {
  it('uses a matching prepared-geometry cache entry', async () => {
    const prepared = prepareMesh(quad());
    const geometryCache = {
      get: vi.fn(async () => prepared),
      set: vi.fn(async () => {}),
    };
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': quad() }),
      materialCompiler: surfaceCompiler(),
      geometryCache,
    });

    expect(geometryCache.get).toHaveBeenCalledTimes(1);
    expect(geometryCache.set).not.toHaveBeenCalled();
    expect(resources.geometries.get('/World/floor')?.triangleCount).toBe(2);
  });

  it('keeps finite bounds for geometry without triangles', async () => {
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': { points: [], faceVertexCounts: [], faceVertexIndices: [] } }),
      materialCompiler: surfaceCompiler(),
    });
    expect(resources.geometries.get('/World/floor')!.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
  it('computes bounds without a triangle BVH and memoizes BLAS on first access', async () => {
    const build = vi.spyOn(acceleration, 'buildBvh');
    try {
      const resources = await buildSceneResources(demoScene(), {
        meshSource: meshSource({ '/World/floor': quad() }), materialCompiler: surfaceCompiler(),
      });
      const geometry = resources.geometries.get('/World/floor')!;
      expect(build).not.toHaveBeenCalled();
      expect(geometry.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
      const first = geometry.blas;
      expect(first.bounds).toEqual(geometry.bounds);
      expect(geometry.blas).toBe(first);
      expect(build).toHaveBeenCalledTimes(1);
    } finally { build.mockRestore(); }
  });
  it('uploads geometry, builds instances/TLAS, compiles bound materials', async () => {
    const messages: Diagnostic[] = [];
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': quad() }),
      materialCompiler: surfaceCompiler(),
      sink: (d) => messages.push(d),
    });

    // Geometry: floor prepared and uploaded as streams + BLAS; orphan pending.
    const floor = resources.geometries.get('/World/floor');
    expect(floor).toBeDefined();
    expect(floor!.triangleCount).toBe(2);
    expect(floor!.indices.length).toBe(6);
    expect(floor!.streams.map((s) => s.name)).toContain('position');
    expect(floor!.streams.map((s) => s.name)).toContain('uv');
    expect(floor!.blas.nodes.length).toBeGreaterThan(0);
    expect(resources.pendingGeometry).toEqual(['/World/orphan']);

    // Material: one unique unit compiled through the chain into a pipeline variant.
    const mat = resources.materials.get(FLOOR_KEY);
    expect(mat).toBeDefined();
    expect(mat!.materialName).toBe('floor');
    expect(mat!.variant.pipelineKey.length).toBeGreaterThan(0);
    expect(mat!.boundPrims).toContain('/World/floor');
    expect(resources.pendingMaterials).toEqual([]);

    // Instances: floor bound+geometry, orphan pending+unbound.
    const byId = new Map(resources.instances.map((i) => [i.id, i]));
    expect(byId.get('/World/floor')!.hasGeometry).toBe(true);
    expect(byId.get('/World/floor')!.materialKey).toBe(FLOOR_KEY);
    expect(byId.get('/World/orphan')!.hasGeometry).toBe(false);
    expect(byId.get('/World/orphan')!.materialKey).toBeUndefined();
    expect(resources.unboundGprims).toContain('/World/orphan');

    // TLAS spans both instances; floor bounds reflect its +2 X translation.
    expect(resources.tlas.instanceOrder.length).toBe(2);
    expect(resources.tlas.bounds.max[0]).toBeGreaterThanOrEqual(3);
  });

  it('reports a pending material when the compiler yields no build', async () => {
    const messages: Diagnostic[] = [];
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': quad() }),
      materialCompiler: { compile: () => undefined },
      sink: (d) => messages.push(d),
    });
    expect(resources.materials.size).toBe(0);
    expect(resources.pendingMaterials).toEqual([FLOOR_KEY]);
    // Instance keeps its material binding path but no compiled key.
    const floor = resources.instances.find((i) => i.id === '/World/floor')!;
    expect(floor.materialKey).toBeUndefined();
    expect(floor.materialPath).toBe('/World/Looks/floor');
    expect(messages.some((m) => m.message.includes('Material pending'))).toBe(true);
  });

  it('uploadGeometry writes every stream and the index buffer to the device', async () => {
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': quad() }),
      materialCompiler: surfaceCompiler(),
    });
    const geometry = resources.geometries.get('/World/floor')!;

    const g = globalThis as unknown as { GPUBufferUsage?: Record<string, number> };
    const hadUsage = g.GPUBufferUsage;
    g.GPUBufferUsage = { VERTEX: 0x20, INDEX: 0x10, COPY_DST: 0x08 };
    try {
      const writes: { size: number; bytes: number }[] = [];
      const device = {
        createBuffer: (d: { size: number }) => ({ size: d.size }),
        queue: { writeBuffer: (buf: { size: number }, _off: number, data: ArrayBufferView) => writes.push({ size: buf.size, bytes: data.byteLength }) },
      } as unknown as GPUDevice;

      const buffers = uploadGeometry(device, geometry, 'floor');
      expect(buffers.vertexBuffers.size).toBe(geometry.streams.length);
      expect(buffers.indexCount).toBe(geometry.indices.length);
      // One write per stream plus one for indices, each matching the source byte length.
      expect(writes.length).toBe(geometry.streams.length + 1);
      expect(writes[writes.length - 1]!.bytes).toBe(geometry.indices.byteLength);
    } finally {
      if (hadUsage) g.GPUBufferUsage = hadUsage;
      else delete g.GPUBufferUsage;
    }
  });

  it('assembles the IR scene-forward shader per material when the build is layered (T058d)', async () => {
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': quad() }),
      materialCompiler: layeredCompiler(),
    });
    const mat = resources.materials.get(FLOOR_KEY)!;
    expect(mat.sceneShader).toBeDefined();
    expect(mat.sceneShader!.frameGroup).toBe(IR_FORWARD_FRAME_GROUP);
    expect(mat.sceneShader!.code).toContain('fn mx_surface_layered(vary: MxVaryings) -> LayeredClosure {');
    expect(mat.sceneShader!.code).toContain('let c = mx_surface_layered(vary);');
    expect(mat.surfaceModule).toBeDefined();
  });

  it('leaves sceneShader absent for a legacy mx_shade-only build', async () => {
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': quad() }),
      materialCompiler: surfaceCompiler(),
    });
    const mat = resources.materials.get(FLOOR_KEY)!;
    expect(mat.sceneShader).toBeUndefined();
    expect(mat.surfaceModule).toBeUndefined();
  });

  it.each([false, true])('builds material and frame bind groups with displacement=%s', async (withDisplacement) => {
    const resources = await buildSceneResources(demoScene(), {
      meshSource: meshSource({ '/World/floor': quad() }),
      materialCompiler: layeredCompiler(),
    });
    const mat = resources.materials.get(FLOOR_KEY)!;

    const groups: number[] = [];
    const descriptors: GPUBindGroupDescriptor[] = [];
    const device = {
      createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
        descriptors.push(descriptor);
        return { group: (descriptor.layout as unknown as { group: number }).group };
      },
    } as unknown as GPUDevice;
    const layout = (group: number) => ({ group } as unknown as GPUBindGroupLayout);
    const displacement = {
      group: IR_FORWARD_FRAME_GROUP,
      params: { id: 'disp-params' } as unknown as GPUBuffer,
      textureView: { id: 'height-map' } as unknown as GPUTextureView,
      sampler: { id: 'disp-sampler' } as unknown as GPUSampler,
    };
    const buffers = {
      frame: { id: 'f' } as unknown as GPUBuffer,
      material: { id: 'm' } as unknown as GPUBuffer,
      environment: {
        textureView: { id: 'env' } as unknown as GPUTextureView,
        sampler: { id: 'env-sampler' } as unknown as GPUSampler,
        cdf: { id: 'env-cdf' } as unknown as GPUBuffer,
      },
      ...(withDisplacement ? { displacement } : {}),
    };
    const bind = createSceneBindGroups(device, mat, buffers, (g) => {
      groups.push(g);
      return layout(g);
    });
    expect(groups).toContain(0);
    expect(groups).toContain(IR_FORWARD_FRAME_GROUP);
    expect((bind.materialBindGroup as unknown as { group: number }).group).toBe(0);
    expect((bind.frameBindGroup as unknown as { group: number }).group).toBe(IR_FORWARD_FRAME_GROUP);
    expect(bind.byGroup.get(0)).toBe(bind.materialBindGroup);
    const frameDescriptor = descriptors.find((descriptor) =>
      (descriptor.layout as unknown as { group: number }).group === IR_FORWARD_FRAME_GROUP)!;
    expect([...frameDescriptor.entries]).toEqual([
      { binding: 0, resource: { buffer: buffers.frame } },
      { binding: 4, resource: buffers.environment.textureView },
      { binding: 5, resource: buffers.environment.sampler },
      { binding: 6, resource: { buffer: buffers.environment.cdf } },
      ...(withDisplacement ? [
        { binding: 1, resource: displacement.textureView },
        { binding: 2, resource: displacement.sampler },
        { binding: 3, resource: { buffer: displacement.params } },
      ] : []),
    ]);
  });

  it('gives distinct graph materials distinct pipeline keys so the raster pipeline cache does not collide', async () => {
    const resources = await buildSceneResources(twoMaterialScene(), {
      meshSource: meshSource({ '/World/cube': quad(), '/World/ground': quad() }),
      materialCompiler: distinctLayeredCompiler({ brick: '0.8, 0.2, 0.1', ground: '0.5, 0.5, 0.5' }),
    });
    const brick = resources.materials.get(BRICK_KEY)!;
    const ground = resources.materials.get(GROUND_KEY)!;
    // Both lower to the same neutral mx_shade module; only the layered shading differs.
    expect(brick.sceneShader!.code).not.toBe(ground.sceneShader!.code);
    // The pipeline key (the raster pipeline cache key) must still differ.
    expect(brick.variant.pipelineKey).not.toBe(ground.variant.pipelineKey);
  });
});
