// T035c1: adapt the three.js-loaded shader ball fixture into a RawMesh for the
// geometry pipeline. The GLB is already triangulated and vertex-indexed, so each
// attribute maps to a vertex-interpolated primvar; prepareMesh then welds,
// orients and generates the tangent frame like any imported USD mesh.
import { prepareMesh, type PreparedMesh, type RawMesh } from './prepare.ts';

export interface ShaderBallFixture {
  readonly name: string;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly uvs: readonly number[];
  readonly indices: readonly number[];
}

export function shaderBallRawMesh(data: ShaderBallFixture): RawMesh {
  const triangleCount = data.indices.length / 3;
  return {
    points: data.positions,
    faceVertexCounts: Array.from({ length: triangleCount }, () => 3),
    faceVertexIndices: data.indices,
    normals: { name: 'normals', interpolation: 'vertex', values: data.normals, elementSize: 3 },
    primvars: [{ name: 'st', interpolation: 'vertex', values: data.uvs, elementSize: 2 }],
  };
}

export function prepareShaderBall(data: ShaderBallFixture): PreparedMesh {
  return prepareMesh(shaderBallRawMesh(data), { computeTangents: true });
}
