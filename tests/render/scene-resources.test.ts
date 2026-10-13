import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { IrModuleBuilder, FLOAT, shaderType } from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import type { RawMesh } from '../../src/geometry/prepare.ts';
import type { MaterialXReference, SceneAsset, ScenePrim, XformOp } from '../../src/scene/types.ts';
import type { MaterialCompileUnit } from '../../src/usd/materials.ts';
import {
  buildSceneResources,
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

function meshSource(map: Record<string, RawMesh>): MeshSource {
  return { meshFor: (path) => map[path] };
}

describe('buildSceneResources (T050)', () => {
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
});
