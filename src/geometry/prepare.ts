// Geometry preparation (plan section 8, T019). Turns a renderer-neutral polygon
// mesh (from the crate reader or the importer's mesh tags) into a triangulated,
// welded, attribute-complete mesh ready for rasterization and BVH construction:
// primvar interpolation/indexing, face orientation, holes, GeomSubsets, normals,
// tangents, subdivision and displacement. It never silently replaces a
// Catmull-Clark cage with a flat triangulation (plan section 8): subdivision runs
// only through an injected, OpenSubdiv-compatible refiner, otherwise it is
// reported as pending and the base cage is triangulated as-is. Scope is a static
// scene; no animation or motion blur.

import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';

export type PrimvarInterpolation = 'constant' | 'uniform' | 'varying' | 'vertex' | 'faceVarying';

export interface Primvar {
  name: string;
  interpolation: PrimvarInterpolation;
  /** Flat values, elementSize components per element. */
  values: readonly number[];
  elementSize: number;
  /** Optional index per addressing element (indexed primvar). */
  indices?: readonly number[];
}

export interface GeomSubset {
  name: string;
  /** Face indices covered by the subset. */
  faceIndices: readonly number[];
  material?: string;
}

export interface RawMesh {
  points: readonly number[];
  faceVertexCounts: readonly number[];
  faceVertexIndices: readonly number[];
  /** Face indices that are holes and must not be rendered. */
  holeIndices?: readonly number[];
  /** USD default is right-handed; true reverses winding. */
  leftHanded?: boolean;
  normals?: Primvar;
  primvars?: readonly Primvar[];
  subsets?: readonly GeomSubset[];
  subdivisionScheme?: string;
  refinementLevel?: number;
}

/** Injected, OpenSubdiv-compatible refiner (plan section 8: do not reimplement). */
export interface Subdivider {
  refine(mesh: RawMesh, scheme: string, level: number): RawMesh;
}

export interface PrepareMeshOptions {
  subdivider?: Subdivider;
  sink?: DiagnosticSink;
  /** Force tangent generation even when no material requests it. */
  computeTangents?: boolean;
  /** Material carries a displacementshader (feeds the displacement pass). */
  hasDisplacement?: boolean;
}

export interface PreparedAttribute {
  elementSize: number;
  values: Float32Array;
}

export interface PreparedSubset {
  name: string;
  material?: string;
  /** Ordinals into the triangle list (every 3 indices). */
  triangles: Uint32Array;
}

export interface SubdivisionPlan {
  scheme: string;
  level: number;
  /** True when an injected refiner actually subdivided the cage. */
  applied: boolean;
}

export interface DisplacementPlan {
  required: boolean;
}

export interface PreparedMesh {
  positions: Float32Array;
  normals: Float32Array;
  tangents?: Float32Array;
  uvs?: Float32Array;
  indices: Uint32Array;
  attributes: ReadonlyMap<string, PreparedAttribute>;
  subsets: readonly PreparedSubset[];
  subdivision: SubdivisionPlan;
  displacement: DisplacementPlan;
  /** Source point of each prepared vertex (lets time-sampled points deform the mesh). */
  sourcePoints?: Uint32Array;
}

const SMOOTH_SCHEMES = new Set(['catmullClark', 'loop', 'bilinear']);
const UV_NAMES = new Set(['st', 'uv', 'texcoord', 'map1']);
const WELD_SCALE = 1e5;

interface Corner {
  pointIndex: number;
  faceIndex: number;
  /** Global position of this corner in faceVertexIndices (faceVarying address). */
  cornerIndex: number;
}

export function prepareMesh(input: RawMesh, options: PrepareMeshOptions = {}): PreparedMesh {
  const emit: (d: Diagnostic) => void = options.sink ?? (() => undefined);

  const scheme = input.subdivisionScheme ?? 'none';
  const level = input.refinementLevel ?? 0;
  let mesh = input;
  let applied = false;
  if (SMOOTH_SCHEMES.has(scheme) && level > 0) {
    if (options.subdivider) {
      mesh = options.subdivider.refine(input, scheme, level);
      applied = true;
    } else {
      emit({
        level: 'warning',
        message: `Subdivision '${scheme}' level ${level} pending: no subdivider provided; rendering base cage.`,
      });
    }
  }

  const holes = new Set(mesh.holeIndices ?? []);
  const leftHanded = mesh.leftHanded ?? false;

  const uvPrimvar = (mesh.primvars ?? []).find((p) => UV_NAMES.has(p.name));
  const otherPrimvars = (mesh.primvars ?? []).filter((p) => p !== uvPrimvar);

  // Smooth normals per point index when no authored normals exist.
  const computedNormals = mesh.normals ? undefined : computeSmoothNormals(mesh, holes, leftHanded);

  const faceCornerTriangles = buildTriangles(mesh, holes, leftHanded);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const otherValues = otherPrimvars.map(() => [] as number[]);
  const indices: number[] = [];
  const triangleFace: number[] = [];
  // Weld corners sharing a point and equal quantized attributes. Candidates are
  // chained per point; quantized values compare like their decimal text would
  // (weldKey), so NaN welds with NaN and -0 with 0.
  const pointHeads = new Map<number, number>();
  const nextWelded: number[] = [];
  const sourcePoints: number[] = [];
  const stride = 3 + (uvPrimvar?.elementSize ?? 0) + otherPrimvars.reduce((sum, p) => sum + p.elementSize, 0);
  const quantized: number[] = [];
  const scratch = new Float64Array(stride);
  const quantize = (v: readonly number[], offset: number): number => {
    for (let i = 0; i < v.length; i++) scratch[offset + i] = Math.round(v[i]! * WELD_SCALE);
    return offset + v.length;
  };

  const addVertex = (corner: Corner): number => {
    const pos = sliceVec(mesh.points, corner.pointIndex, 3);
    const nrm = mesh.normals
      ? readPrimvar(mesh.normals, corner, 3)
      : (computedNormals!.get(corner.pointIndex) ?? [0, 0, 1]);
    const uv = uvPrimvar ? readPrimvar(uvPrimvar, corner, uvPrimvar.elementSize) : undefined;
    const extra = otherPrimvars.map((p) => readPrimvar(p, corner, p.elementSize));

    let filled = quantize(nrm, 0);
    if (uv) filled = quantize(uv, filled);
    for (const e of extra) filled = quantize(e, filled);
    for (let candidate = pointHeads.get(corner.pointIndex) ?? -1; candidate >= 0; candidate = nextWelded[candidate]!) {
      let equal = true;
      for (let i = 0, o = candidate * stride; i < stride && equal; i++, o++) {
        const a = quantized[o]!, b = scratch[i]!;
        equal = a === b || (a !== a && b !== b);
      }
      if (equal) return candidate;
    }

    const index = positions.length / 3;
    nextWelded.push(pointHeads.get(corner.pointIndex) ?? -1);
    sourcePoints.push(corner.pointIndex);
    pointHeads.set(corner.pointIndex, index);
    for (let i = 0; i < stride; i++) quantized.push(scratch[i]!);
    positions.push(pos[0]!, pos[1]!, pos[2]!);
    normals.push(nrm[0]!, nrm[1]!, nrm[2]!);
    if (uv) uvs.push(...uv);
    extra.forEach((vals, i) => otherValues[i]!.push(...vals));
    return index;
  };

  for (const tri of faceCornerTriangles) {
    indices.push(addVertex(tri.a), addVertex(tri.b), addVertex(tri.c));
    triangleFace.push(tri.faceIndex);
  }

  const vertexCount = positions.length / 3;
  const prepared: {
    positions: Float32Array;
    normals: Float32Array;
    uvs?: Float32Array;
    tangents?: Float32Array;
  } = {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    ...(uvPrimvar ? { uvs: Float32Array.from(uvs) } : {}),
  };

  if ((uvPrimvar && options.computeTangents !== false) || options.computeTangents) {
    if (prepared.uvs) {
      prepared.tangents = computeTangents(prepared.positions, prepared.normals, prepared.uvs, indices, vertexCount);
    } else if (options.computeTangents) {
      emit({ level: 'info', message: 'Tangent generation requested but no UV primvar is present.' });
    }
  }

  const attributes = new Map<string, PreparedAttribute>();
  otherPrimvars.forEach((p, i) => {
    attributes.set(p.name, { elementSize: p.elementSize, values: Float32Array.from(otherValues[i]!) });
  });

  const subsets = buildSubsets(mesh.subsets ?? [], triangleFace, emit);

  return {
    sourcePoints: Uint32Array.from(sourcePoints),
    positions: prepared.positions,
    normals: prepared.normals,
    ...(prepared.uvs ? { uvs: prepared.uvs } : {}),
    ...(prepared.tangents ? { tangents: prepared.tangents } : {}),
    indices: Uint32Array.from(indices),
    attributes,
    subsets,
    subdivision: { scheme, level, applied },
    displacement: { required: options.hasDisplacement ?? false },
  };
}

interface Triangle {
  a: Corner;
  b: Corner;
  c: Corner;
  faceIndex: number;
}

function buildTriangles(mesh: RawMesh, holes: Set<number>, leftHanded: boolean): Triangle[] {
  const triangles: Triangle[] = [];
  let offset = 0;
  for (let faceIndex = 0; faceIndex < mesh.faceVertexCounts.length; faceIndex++) {
    const count = mesh.faceVertexCounts[faceIndex]!;
    if (holes.has(faceIndex) || count < 3) {
      offset += count;
      continue;
    }
    const corners: Corner[] = [];
    for (let k = 0; k < count; k++) {
      const cornerIndex = offset + k;
      corners.push({
        pointIndex: mesh.faceVertexIndices[cornerIndex]!,
        faceIndex,
        cornerIndex,
      });
    }
    for (let k = 1; k < count - 1; k++) {
      const a = corners[0]!;
      const b = corners[k]!;
      const c = corners[k + 1]!;
      triangles.push(leftHanded ? { a, b: c, c: b, faceIndex } : { a, b, c, faceIndex });
    }
    offset += count;
  }
  return triangles;
}

function computeSmoothNormals(
  mesh: RawMesh,
  holes: Set<number>,
  leftHanded: boolean,
): Map<number, [number, number, number]> {
  const accum = new Map<number, [number, number, number]>();
  let offset = 0;
  for (let faceIndex = 0; faceIndex < mesh.faceVertexCounts.length; faceIndex++) {
    const count = mesh.faceVertexCounts[faceIndex]!;
    if (holes.has(faceIndex) || count < 3) {
      offset += count;
      continue;
    }
    const p0 = mesh.faceVertexIndices[offset]!;
    for (let k = 1; k < count - 1; k++) {
      const pa = p0;
      const pb = mesh.faceVertexIndices[offset + k]!;
      const pc = mesh.faceVertexIndices[offset + k + 1]!;
      const va = sliceVec(mesh.points, pa, 3);
      const vb = sliceVec(mesh.points, pb, 3);
      const vc = sliceVec(mesh.points, pc, 3);
      let n = cross(sub(vb, va), sub(vc, va));
      if (leftHanded) n = [-n[0], -n[1], -n[2]];
      for (const p of [pa, pb, pc]) {
        const cur = accum.get(p) ?? [0, 0, 0];
        accum.set(p, [cur[0] + n[0], cur[1] + n[1], cur[2] + n[2]]);
      }
    }
    offset += count;
  }
  for (const [p, n] of accum) accum.set(p, normalize(n));
  return accum;
}

export function computeTangents(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: ArrayLike<number>,
  vertexCount: number,
): Float32Array {
  const tan = new Float32Array(vertexCount * 3);
  const bitan = new Float32Array(vertexCount * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!;
    const i1 = indices[t + 1]!;
    const i2 = indices[t + 2]!;
    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
    const uv0 = i0 * 2, uv1 = i1 * 2, uv2 = i2 * 2;
    const e1x = positions[p1]! - positions[p0]!;
    const e1y = positions[p1 + 1]! - positions[p0 + 1]!;
    const e1z = positions[p1 + 2]! - positions[p0 + 2]!;
    const e2x = positions[p2]! - positions[p0]!;
    const e2y = positions[p2 + 1]! - positions[p0 + 1]!;
    const e2z = positions[p2 + 2]! - positions[p0 + 2]!;
    const du1 = uvs[uv1]! - uvs[uv0]!;
    const dv1 = uvs[uv1 + 1]! - uvs[uv0 + 1]!;
    const du2 = uvs[uv2]! - uvs[uv0]!;
    const dv2 = uvs[uv2 + 1]! - uvs[uv0 + 1]!;
    const denom = du1 * dv2 - du2 * dv1;
    const r = denom === 0 ? 0 : 1 / denom;
    const sx = (dv2 * e1x - dv1 * e2x) * r;
    const sy = (dv2 * e1y - dv1 * e2y) * r;
    const sz = (dv2 * e1z - dv1 * e2z) * r;
    const tx = (du1 * e2x - du2 * e1x) * r;
    const ty = (du1 * e2y - du2 * e1y) * r;
    const tz = (du1 * e2z - du2 * e1z) * r;
    for (let corner = 0; corner < 3; corner++) {
      const p = indices[t + corner]! * 3;
      tan[p]! += sx;
      tan[p + 1]! += sy;
      tan[p + 2]! += sz;
      bitan[p]! += tx;
      bitan[p + 1]! += ty;
      bitan[p + 2]! += tz;
    }
  }

  const out = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const p = i * 3;
    const nx = normals[p]!, ny = normals[p + 1]!, nz = normals[p + 2]!;
    const ndt = nx * tan[p]! + ny * tan[p + 1]! + nz * tan[p + 2]!;
    let x = tan[p]! - nx * ndt, y = tan[p + 1]! - ny * ndt, z = tan[p + 2]! - nz * ndt;
    const length = Math.hypot(x, y, z);
    if (length === 0) { x = 0; y = 0; z = 1; }
    else { x /= length; y /= length; z /= length; }
    const handed = (ny * z - nz * y) * bitan[p]! + (nz * x - nx * z) * bitan[p + 1]!
      + (nx * y - ny * x) * bitan[p + 2]! < 0 ? -1 : 1;
    out[i * 4] = x;
    out[i * 4 + 1] = y;
    out[i * 4 + 2] = z;
    out[i * 4 + 3] = handed;
  }
  return out;
}

function buildSubsets(
  subsets: readonly GeomSubset[],
  triangleFace: readonly number[],
  emit: (d: Diagnostic) => void,
): PreparedSubset[] {
  if (subsets.length === 0) return [];
  const facesToTriangles = new Map<number, number[]>();
  triangleFace.forEach((face, tri) => {
    const list = facesToTriangles.get(face) ?? [];
    list.push(tri);
    facesToTriangles.set(face, list);
  });
  return subsets.map((subset) => {
    const tris: number[] = [];
    for (const face of subset.faceIndices) {
      const mapped = facesToTriangles.get(face);
      if (mapped) tris.push(...mapped);
      else emit({ level: 'info', message: `GeomSubset '${subset.name}' references hole/unknown face ${face}.` });
    }
    return {
      name: subset.name,
      ...(subset.material !== undefined ? { material: subset.material } : {}),
      triangles: Uint32Array.from(tris),
    };
  });
}

// --- Primvar + vector helpers ------------------------------------------------

function readPrimvar(primvar: Primvar, corner: Corner, size: number): number[] {
  let element: number;
  switch (primvar.interpolation) {
    case 'constant':
      element = 0;
      break;
    case 'uniform':
      element = corner.faceIndex;
      break;
    case 'faceVarying':
      element = corner.cornerIndex;
      break;
    case 'varying':
    case 'vertex':
    default:
      element = corner.pointIndex;
      break;
  }
  if (primvar.indices) element = primvar.indices[element] ?? 0;
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(primvar.values[element * primvar.elementSize + i] ?? 0);
  return out;
}

function sliceVec(flat: readonly number[], index: number, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(flat[index * size + i] ?? 0);
  return out;
}

function sub(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

function normalize(v: readonly number[]): [number, number, number] {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!);
  if (len === 0) return [0, 0, 1];
  return [v[0]! / len, v[1]! / len, v[2]! / len];
}
