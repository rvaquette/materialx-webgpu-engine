import { describe, expect, it } from 'vitest';
import { prepareMesh, type RawMesh } from '../../src/geometry/prepare.ts';
import { curvesToMesh, evaluateCurve, pointsToMesh } from '../../src/scene/procedural-geometry.ts';
import { buildSceneInstances } from '../../src/scene/instances.ts';
import { importUsdStage } from '../../src/usd/importer.ts';
import { animateScene } from '../../src/render/scene-animation.ts';
import { evaluateSceneAt } from '../../src/scene/time.ts';
import type { SceneResources } from '../../src/render/scene-resources.ts';

const SCENE = `#usda 1.0
def Xform "World"
{
    def BasisCurves "Hair"
    {
        uniform token type = "cubic"
        uniform token basis = "bspline"
        int[] curveVertexCounts = [4, 2]
        point3f[] points = [(0, 0, 0), (0, 1, 0), (0, 2, 0), (0, 3, 0), (1, 0, 0), (1, 0, 1)]
        float[] widths = [0.2]
    }
    def Points "Dust"
    {
        point3f[] points = [(0, 0, 0), (5, 0, 0)]
        float[] widths = [1, 2]
    }
    def PointInstancer "Crowd"
    {
        rel prototypes = [</World/Crowd/Protos/Ball>]
        int[] protoIndices = [0, 0, 0]
        point3f[] positions.timeSamples = { 0: [(1, 0, 0), (2, 0, 0), (3, 0, 0)], 10: [(1, 5, 0), (2, 5, 0), (3, 5, 0)] }
        quath[] orientations = [(1, 0, 0, 0), (0.7071068, 0, 0, 0.7071068), (1, 0, 0, 0)]
        int64[] invisibleIds = [2]
        def Scope "Protos"
        {
            def Xform "Ball"
            {
                double3 xformOp:translate = (0, 1, 0)
                uniform token[] xformOpOrder = ["xformOp:translate"]
                def Mesh "Shape"
                {
                    int[] faceVertexCounts = [3]
                    int[] faceVertexIndices = [0, 1, 2]
                    point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
                }
            }
        }
    }
}
`;

/** Every triangle's geometric normal agrees with its vertex normals (outward faces). */
function expectOutward(mesh: RawMesh): void {
  const prepared = prepareMesh(mesh);
  const { positions: p, normals: n, indices } = prepared;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
    const e1 = [0, 1, 2].map(k => p[b + k]! - p[a + k]!), e2 = [0, 1, 2].map(k => p[c + k]! - p[a + k]!);
    const face = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const vertex = [0, 1, 2].map(k => n[a + k]! + n[b + k]! + n[c + k]!);
    expect(face[0]! * vertex[0]! + face[1]! * vertex[1]! + face[2]! * vertex[2]!).toBeGreaterThan(0);
  }
}

describe('procedural gprims', () => {
  it('evaluates linear, Bezier and B-spline curves through their end points', () => {
    const control: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
    expect(evaluateCurve(control, 'linear', 'bezier', 'nonperiodic', 4).map(s => s.position[0])).toEqual([0, 1, 2, 3]);
    const bezier = evaluateCurve(control, 'cubic', 'bezier', 'nonperiodic', 4);
    expect(bezier.map(s => s.position[0])).toEqual([0, 0.75, 1.5, 2.25, 3]);
    const pinned = evaluateCurve(control, 'cubic', 'bspline', 'pinned', 2);
    expect(pinned[0]!.position[0]).toBeCloseTo(1 / 6);
    expect(pinned.at(-1)!.along).toBe(1);
  });

  it('sweeps curves into outward tubes whose tangent follows the fiber', async () => {
    const scene = await importUsdStage('a.usda', { reader: { read: async () => SCENE } });
    const mesh = curvesToMesh(scene.prims.get('/World/Hair')!)!;
    expectOutward(mesh);
    // B-spline curve: one segment (4 points, 5 samples), linear-looking 2-point curve: 2 samples; 6 sides.
    expect(mesh.faceVertexCounts.length).toBe((4 + 1) * 6);
    const prepared = prepareMesh(mesh);
    for (let v = 0; v < 6; v++) {
      const radius = Math.hypot(prepared.positions[v * 3]!, prepared.positions[v * 3 + 2]!);
      expect(radius).toBeCloseTo(0.1, 5);
      // The vertical fiber: tangent along +Y.
      expect(Math.abs(prepared.tangents![v * 4 + 1]!)).toBeCloseTo(1, 3);
    }
  });

  it('places one sphere per point, sized by widths', async () => {
    const scene = await importUsdStage('a.usda', { reader: { read: async () => SCENE } });
    const mesh = pointsToMesh(scene.prims.get('/World/Dust')!)!;
    expectOutward(mesh);
    expect(mesh.faceVertexCounts.length).toBe(160);
    const x = mesh.points.filter((_, i) => i % 3 === 0);
    expect(Math.max(...x.slice(0, 42))).toBeCloseTo(0.5);
    expect(Math.max(...x.slice(42))).toBeCloseTo(6);
  });

  it('instances PointInstancer prototypes per visible point and animates their positions', async () => {
    const scene = await importUsdStage('a.usda', { reader: { read: async () => SCENE } });
    const { instances, prototypes } = buildSceneInstances(evaluateSceneAt(scene, 0));
    const crowd = instances.filter(instance => instance.primPath === '/World/Crowd');
    expect(crowd.map(instance => instance.id)).toEqual(['/World/Crowd[0]/World/Crowd/Protos/Ball/Shape', '/World/Crowd[1]/World/Crowd/Protos/Ball/Shape']);
    expect(instances.some(instance => instance.primPath === '/World/Crowd/Protos/Ball/Shape')).toBe(false);
    expect(prototypes.map(p => p.id)).toContain('/World/Crowd/Protos/Ball/Shape');
    // Point 1: rotated 90 degrees about Z, then the prototype's own (0, 1, 0) offset rotates to (-1, 0, 0).
    expect([...crowd[1]!.transform.slice(12, 15)].map(v => Number(v.toFixed(5)) + 0)).toEqual([1, 0, 0]);
    expect(crowd[0]!.transform[13]).toBeCloseTo(1);
    const resources = { instances: crowd.map(instance => ({ ...instance, hasGeometry: true })), geometries: new Map() } as unknown as SceneResources;
    const late = animateScene(scene, 10, resources);
    expect(late.transforms.get(crowd[0]!.id)![13]).toBeCloseTo(6);
  });
});
