import { describe, expect, it } from 'vitest';
import { prepareMesh, type RawMesh } from '../../src/geometry/prepare.ts';
import { primitiveMesh, type PrimitiveShape } from '../../src/scene/primitives.ts';
import { isMeshPrim } from '../../src/scene/types.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { meshSourceFromScene } from '../../src/render/usd-scene-assets.ts';

function bounds(mesh: RawMesh): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.points.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, mesh.points[i]!);
    max[i % 3] = Math.max(max[i % 3]!, mesh.points[i]!);
  }
  return { min, max };
}

/** Every triangle faces its vertex normals, which are unit length. */
function expectConsistent(mesh: RawMesh): void {
  const p = (i: number) => [0, 1, 2].map(k => mesh.points[i * 3 + k]!);
  const n = (i: number) => [0, 1, 2].map(k => mesh.normals!.values[i * 3 + k]!);
  for (let i = 0; i < mesh.points.length / 3; i++) expect(Math.hypot(...n(i))).toBeCloseTo(1, 6);
  const indices = mesh.faceVertexIndices;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!].map(p);
    const e1 = [0, 1, 2].map(k => b![k]! - a![k]!), e2 = [0, 1, 2].map(k => c![k]! - a![k]!);
    const face = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const normal = [indices[t]!, indices[t + 1]!, indices[t + 2]!].map(n).reduce((sum, v) => sum.map((s, k) => s + v[k]!));
    expect(face.reduce((sum, v, k) => sum + v * normal[k]!, 0)).toBeGreaterThan(0);
  }
  for (const value of mesh.primvars![0]!.values) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
}

describe('parametric primitives', () => {
  const shapes: [PrimitiveShape, number[]][] = [
    [{ kind: 'sphere', radius: 2, resolution: 16 }, [2, 2, 2]],
    [{ kind: 'cube', size: 3, resolution: 2 }, [1.5, 1.5, 1.5]],
    [{ kind: 'cylinder', radius: 1, height: 4, axis: 'Y', resolution: 12 }, [1, 2, 1]],
    [{ kind: 'cone', radius: 1, height: 4, axis: 'Z', resolution: 12 }, [1, 1, 2]],
    [{ kind: 'capsule', radius: 1, height: 2, axis: 'X', resolution: 12 }, [2, 1, 1]],
    [{ kind: 'torus', radius: 2, minorRadius: 0.5, axis: 'Y', resolution: 16 }, [2.5, 0.5, 2.5]],
    [{ kind: 'plane', width: 2, length: 6, axis: 'Y', resolution: 3 }, [1, 0, 3]],
    [{ kind: 'disk', radius: 1, axis: 'X', resolution: 12 }, [0, 1, 1]],
  ];
  it.each(shapes)('tessellates %o with outward triangles, unit normals and its extent', (shape, extent) => {
    const mesh = primitiveMesh(shape);
    expectConsistent(mesh);
    const { min, max } = bounds(mesh);
    for (let k = 0; k < 3; k++) {
      expect(max[k]).toBeCloseTo(extent[k]!, 6);
      expect(min[k]).toBeCloseTo(-extent[k]!, 6);
    }
    // prepareMesh accepts it and derives tangents from the UVs.
    const prepared = prepareMesh(mesh, { computeTangents: true });
    expect(prepared.indices.length).toBe(mesh.faceVertexIndices.length);
    expect(prepared.tangents?.length).toBe(prepared.positions.length / 3 * 4);
  });

  it('turns the cone apex toward +axis and rejects invalid parameters', () => {
    const cone = primitiveMesh({ kind: 'cone', radius: 1, height: 2, axis: 'Z', resolution: 8 });
    const apex = [...Array(cone.points.length / 3).keys()].filter(i => Math.hypot(cone.points[i * 3]!, cone.points[i * 3 + 1]!) < 1e-9);
    expect(apex.some(i => cone.points[i * 3 + 2] === 1)).toBe(true);
    expect(() => primitiveMesh({ kind: 'sphere', radius: 0, resolution: 8 })).toThrow(/radius must be a positive number/);
    expect(() => primitiveMesh({ kind: 'sphere', radius: 1, resolution: 2 })).toThrow(/resolution must be an integer from 3/);
    expect(() => primitiveMesh({ kind: 'plane', width: 1, length: 1, axis: 'W' as 'X', resolution: 1 })).toThrow(/axis/);
    // Grid density: (n + 1)² vertices.
    expect(primitiveMesh({ kind: 'plane', width: 1, length: 1, axis: 'Y', resolution: 32 }).points.length / 3).toBe(33 * 33);
  });
});

describe('implicit USD gprims', () => {
  it('render as meshes with the UsdGeom fallbacks, their axis and engine:resolution', async () => {
    const usda = `#usda 1.0
def Xform "World"
{
    def Sphere "Ball" { double radius = 0.5 }
    def Cube "Box" {}
    def Cylinder "Pipe" { double height = 6
        custom int engine:resolution = 8 }
    def Capsule "Pill" { uniform token axis = "Y" }
    def Plane "Ground" { double width = 10 }
    def Cone "Bad" { double radius = -1 }
}`;
    const scene = await importUsdStage('mem:/stage.usda', { reader: { read: async () => usda } });
    const source = meshSourceFromScene(scene);
    for (const path of ['/World/Ball', '/World/Box', '/World/Pipe', '/World/Pill', '/World/Ground']) {
      expect(isMeshPrim(scene.prims.get(path)!)).toBe(true);
    }
    const extent = (path: string) => bounds(source.meshFor(path) as RawMesh).max.map(v => Number(v.toFixed(6)));
    expect(extent('/World/Ball')).toEqual([0.5, 0.5, 0.5]);
    expect(extent('/World/Box')).toEqual([1, 1, 1]);
    // Cylinder fallbacks: radius 1, axis Z.
    expect(extent('/World/Pipe')).toEqual([1, 1, 3]);
    expect(extent('/World/Pill')).toEqual([0.5, 1, 0.5]);
    expect(extent('/World/Ground')).toEqual([5, 1, 0]);
    // 8 segments around: 9 columns per ring.
    const pipe = source.meshFor('/World/Pipe') as RawMesh;
    expect(pipe.points.length / 3 % 9).toBe(0);
    expect(() => source.meshFor('/World/Bad')).toThrow(/\/World\/Bad: cone radius must be a positive number/);
  });
});

describe('primitive deformation and default materials', () => {
  it('moves vertices and recomputes smooth normals', async () => {
    const { deformMesh } = await import('../../src/scene/primitives.ts');
    const plane = primitiveMesh({ kind: 'plane', width: 2, length: 2, axis: 'Y', resolution: 8 });
    // Bend the sheet into a half cylinder of radius 2/π around Z: normals point away from its axis.
    const radius = 2 / Math.PI;
    const bent = deformMesh(plane, p => [radius * Math.sin(p[0] / radius), radius * Math.cos(p[0] / radius), p[2]]);
    expectConsistent(bent);
    for (let i = 0; i < bent.points.length / 3; i++) {
      const [x, y] = [bent.points[i * 3]!, bent.points[i * 3 + 1]!];
      const [nx, ny] = [bent.normals!.values[i * 3]!, bent.normals!.values[i * 3 + 1]!];
      expect(nx * x + ny * y).toBeGreaterThan(0.95 * radius);
    }
    expect(() => deformMesh(plane, () => [0, Number.NaN, 0])).toThrow(/finite numbers/);
  });

  it('binds unbound implicit gprims to a standard_surface colored by displayColor', async () => {
    const { applyDefaultGprimMaterials } = await import('../../src/scene/primitives.ts');
    const usda = `#usda 1.0
def Xform "World"
{
    def Sphere "Red" { color3f[] primvars:displayColor = [(1, 0, 0)] }
    def Cube "Grey" {}
    def Cube "Bound" { rel material:binding = </World/Mat> }
    def Mesh "Tri" {}
    def Mesh "Ring" { custom token engine:primitive = "torus" }
}`;
    const scene = await importUsdStage('mem:/stage.usda', { reader: { read: async () => usda } });
    const { scene: bound, texts } = applyDefaultGprimMaterials(scene);
    expect(bound.prims.get('/World/Red')?.materialBinding?.target).toBe('/World/Red/__DefaultMaterial');
    expect(bound.prims.get('/World/Grey')?.materialBinding?.target).toBe('/World/Grey/__DefaultMaterial');
    expect(bound.prims.get('/World/Bound')?.materialBinding?.target).toBe('/World/Mat');
    expect(bound.prims.get('/World/Tri')?.materialBinding).toBeUndefined();
    expect(bound.prims.get('/World/Ring')?.materialBinding?.target).toBe('/World/Ring/__DefaultMaterial');
    expect([...texts.values()].map(text => /base_color[^/]*value="([^"]+)"/.exec(text)?.[1])).toEqual(['1, 0, 0', undefined]);
  });
});
