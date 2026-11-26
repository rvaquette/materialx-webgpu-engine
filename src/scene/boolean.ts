import type { RawMesh, Primvar } from '../geometry/prepare.ts';
import type { ManifoldToplevel } from 'manifold-3d';

let manifoldPromise: Promise<ManifoldToplevel> | undefined;

async function manifoldApi(): Promise<ManifoldToplevel> {
  manifoldPromise ??= import('manifold-3d').then(async ({ default: initialize }) => {
    const api = await initialize();
    api.setup();
    return api;
  });
  return manifoldPromise;
}

function vertexAttribute(attribute: Primvar, vertex: number): number[] {
  if (attribute.interpolation !== 'vertex' && attribute.interpolation !== 'varying') {
    throw new Error(`expected a vertex-interpolated "${attribute.name}" attribute`);
  }
  const index = attribute.indices?.[vertex] ?? vertex;
  if (!Number.isInteger(index) || index < 0) throw new Error(`"${attribute.name}" has an invalid vertex index.`);
  const start = index * attribute.elementSize;
  return Array.from({ length: attribute.elementSize }, (_, component) => {
    const value = attribute.values[start + component];
    if (value === undefined || !Number.isFinite(value)) throw new Error(`"${attribute.name}" has an invalid vertex value.`);
    return value;
  });
}

function toManifold(api: ManifoldToplevel, raw: RawMesh, operand: string) {
  const normals = raw.normals;
  const uv = raw.primvars?.find(attribute => attribute.name === 'st');
  if (!normals || normals.elementSize !== 3 || !uv || uv.elementSize !== 2) {
    throw new Error(`${operand} operand must have vertex normals and "st" texture coordinates.`);
  }

  if (raw.points.length % 3 !== 0) throw new Error(`${operand} operand has an invalid point array.`);
  const vertexCount = raw.points.length / 3;
  const properties = new Float32Array(vertexCount * 8);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * 8;
    for (let component = 0; component < 3; component++) {
      const value = raw.points[vertex * 3 + component];
      if (value === undefined || !Number.isFinite(value)) throw new Error(`${operand} operand has an invalid position.`);
      properties[offset + component] = value;
    }
    properties.set(vertexAttribute(normals, vertex), offset + 3);
    properties.set(vertexAttribute(uv, vertex), offset + 6);
  }

  const triangles: number[] = [];
  let faceOffset = 0;
  for (let face = 0; face < raw.faceVertexCounts.length; face++) {
    const count = raw.faceVertexCounts[face] ?? 0;
    if (!Number.isInteger(count) || count < 3 || faceOffset + count > raw.faceVertexIndices.length) {
      throw new Error(`${operand} operand has invalid face topology.`);
    }
    if (raw.holeIndices?.includes(face)) {
      faceOffset += count;
      continue;
    }
    for (let corner = 1; corner + 1 < count; corner++) {
      const a = raw.faceVertexIndices[faceOffset]!;
      const b = raw.faceVertexIndices[faceOffset + corner]!;
      const c = raw.faceVertexIndices[faceOffset + corner + 1]!;
      if ([a, b, c].some(index => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
        throw new Error(`${operand} operand has an out-of-range face vertex index.`);
      }
      if (raw.leftHanded) triangles.push(a, c, b);
      else triangles.push(a, b, c);
    }
    faceOffset += count;
  }
  if (faceOffset !== raw.faceVertexIndices.length || triangles.length === 0) {
    throw new Error(`${operand} operand has invalid or empty mesh topology.`);
  }

  const mesh = new api.Mesh({
    numProp: 8,
    vertProperties: properties,
    triVerts: new Uint32Array(triangles),
    runIndex: new Uint32Array([0, triangles.length]),
    runOriginalID: new Uint32Array([api.Manifold.reserveIDs(1)]),
  });
  mesh.runFlags = new Uint8Array([2]);
  let result: ReturnType<ManifoldToplevel['Manifold']['ofMesh']>;
  try {
    mesh.merge();
    result = api.Manifold.ofMesh(mesh);
  } catch (error) {
    throw new Error(`${operand} operand is not a closed, consistently oriented manifold: ${error instanceof Error ? error.message : String(error)}`);
  }
  const status = result.status();
  if (status !== 'NoError') {
    result.delete();
    throw new Error(`${operand} operand is not a closed, consistently oriented manifold (${status}).`);
  }
  return result;
}

function fromManifold(manifold: ReturnType<ManifoldToplevel['Manifold']['ofMesh']>): RawMesh {
  const mesh = manifold.getMesh(3);
  if (mesh.numProp < 8) throw new Error('Boolean result lost its normals or texture coordinates.');
  const points: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let vertex = 0; vertex < mesh.numVert; vertex++) {
    const offset = vertex * mesh.numProp;
    points.push(mesh.vertProperties[offset]!, mesh.vertProperties[offset + 1]!, mesh.vertProperties[offset + 2]!);
    normals.push(mesh.vertProperties[offset + 3]!, mesh.vertProperties[offset + 4]!, mesh.vertProperties[offset + 5]!);
    uvs.push(mesh.vertProperties[offset + 6]!, mesh.vertProperties[offset + 7]!);
  }
  return {
    points,
    faceVertexCounts: new Array<number>(mesh.numTri).fill(3),
    faceVertexIndices: Array.from(mesh.triVerts),
    normals: { name: 'normals', interpolation: 'vertex', values: normals, elementSize: 3 },
    primvars: [{ name: 'st', interpolation: 'vertex', values: uvs, elementSize: 2 }],
    subdivisionScheme: 'none',
  };
}

export async function booleanMesh(operation: 'union' | 'difference' | 'intersection', base: RawMesh, tool: RawMesh): Promise<RawMesh> {
  const api = await manifoldApi();
  const baseManifold = toManifold(api, base, 'base');
  let toolManifold: ReturnType<ManifoldToplevel['Manifold']['ofMesh']> | undefined;
  let result: ReturnType<ManifoldToplevel['Manifold']['ofMesh']> | undefined;
  try {
    toolManifold = toManifold(api, tool, 'tool');
    result = operation === 'union' ? baseManifold.add(toolManifold)
      : operation === 'difference' ? baseManifold.subtract(toolManifold)
        : baseManifold.intersect(toolManifold);
    const status = result.status();
    if (status !== 'NoError') throw new Error(`Boolean ${operation} failed (${status}).`);
    return fromManifold(result);
  } finally {
    result?.delete();
    toolManifold?.delete();
    baseManifold.delete();
  }
}

export function transformRawMesh(raw: RawMesh, matrix: readonly number[]): RawMesh {
  if (matrix.length !== 16) throw new Error('Expected a 4x4 transform matrix.');
  const a = matrix[0]!, b = matrix[4]!, c = matrix[8]!;
  const d = matrix[1]!, e = matrix[5]!, f = matrix[9]!;
  const g = matrix[2]!, h = matrix[6]!, i = matrix[10]!;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('Boolean operand transforms must have non-zero scale on every axis.');
  }
  const inverseDeterminant = 1 / determinant;
  const normalMatrix = [
    (e * i - f * h) * inverseDeterminant, (f * g - d * i) * inverseDeterminant, (d * h - e * g) * inverseDeterminant,
    (c * h - b * i) * inverseDeterminant, (a * i - c * g) * inverseDeterminant, (b * g - a * h) * inverseDeterminant,
    (b * f - c * e) * inverseDeterminant, (c * d - a * f) * inverseDeterminant, (a * e - b * d) * inverseDeterminant,
  ];
  const points: number[] = [];
  for (let vertex = 0; vertex < raw.points.length / 3; vertex++) {
    const x = raw.points[vertex * 3]!, y = raw.points[vertex * 3 + 1]!, z = raw.points[vertex * 3 + 2]!;
    const transformed = [
      a * x + b * y + c * z + matrix[12]!,
      d * x + e * y + f * z + matrix[13]!,
      g * x + h * y + i * z + matrix[14]!,
    ];
    if (!transformed.every(Number.isFinite)) throw new Error('Boolean operand transform produced a non-finite position.');
    points.push(...transformed);
  }
  let normals = raw.normals;
  if (normals) {
    if (normals.elementSize !== 3) throw new Error('Boolean operand normals must have three components.');
    const values: number[] = [];
    for (let index = 0; index < normals.values.length; index += 3) {
      const x = normals.values[index]!, y = normals.values[index + 1]!, z = normals.values[index + 2]!;
      if (![x, y, z].every(Number.isFinite)) throw new Error('Boolean operand normals must be finite.');
      const nx = normalMatrix[0]! * x + normalMatrix[1]! * y + normalMatrix[2]! * z;
      const ny = normalMatrix[3]! * x + normalMatrix[4]! * y + normalMatrix[5]! * z;
      const nz = normalMatrix[6]! * x + normalMatrix[7]! * y + normalMatrix[8]! * z;
      const length = Math.hypot(nx, ny, nz);
      if (!(length > 1e-12)) throw new Error('Boolean operand contains a zero-length normal.');
      values.push(nx / length, ny / length, nz / length);
    }
    normals = { ...normals, values };
  }
  return {
    ...raw,
    points,
    ...(normals ? { normals } : {}),
    leftHanded: Boolean(raw.leftHanded) !== (determinant < 0),
  };
}
