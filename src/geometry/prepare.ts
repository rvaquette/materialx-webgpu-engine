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
  const weldMap = new Map<string, number>();

  const addVertex = (corner: Corner): number => {
    const pos = sliceVec(mesh.points, corner.pointIndex, 3);
    const nrm = mesh.normals
      ? readPrimvar(mesh.normals, corner, 3)
      : (computedNormals!.get(corner.pointIndex) ?? [0, 0, 1]);
    const uv = uvPrimvar ? readPrimvar(uvPrimvar, corner, uvPrimvar.elementSize) : undefined;
    const extra = otherPrimvars.map((p) => readPrimvar(p, corner, p.elementSize));

    const key = weldKey(corner.pointIndex, nrm, uv, extra);
    const existing = weldMap.get(key);
    if (existing !== undefined) return existing;

    const index = positions.length / 3;
    positions.push(pos[0]!, pos[1]!, pos[2]!);
    normals.push(nrm[0]!, nrm[1]!, nrm[2]!);
    if (uv) uvs.push(...uv);
    extra.forEach((vals, i) => otherValues[i]!.push(...vals));
    weldMap.set(key, index);
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

function computeTangents(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: readonly number[],
  vertexCount: number,
): Float32Array {
  const tan = new Float32Array(vertexCount * 3);
  const bitan = new Float32Array(vertexCount * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!;
    const i1 = indices[t + 1]!;
    const i2 = indices[t + 2]!;
    const p0 = vec3(positions, i0);
    const p1 = vec3(positions, i1);
    const p2 = vec3(positions, i2);
    const uv0 = vec2(uvs, i0);
    const uv1 = vec2(uvs, i1);
    const uv2 = vec2(uvs, i2);
    const e1 = sub(p1, p0);
    const e2 = sub(p2, p0);
    const du1 = uv1[0] - uv0[0];
    const dv1 = uv1[1] - uv0[1];
    const du2 = uv2[0] - uv0[0];
    const dv2 = uv2[1] - uv0[1];
    const denom = du1 * dv2 - du2 * dv1;
    const r = denom === 0 ? 0 : 1 / denom;
    const sdir: [number, number, number] = [
      (dv2 * e1[0] - dv1 * e2[0]) * r,
      (dv2 * e1[1] - dv1 * e2[1]) * r,
      (dv2 * e1[2] - dv1 * e2[2]) * r,
    ];
    const tdir: [number, number, number] = [
      (du1 * e2[0] - du2 * e1[0]) * r,
      (du1 * e2[1] - du2 * e1[1]) * r,
      (du1 * e2[2] - du2 * e1[2]) * r,
    ];
    for (const i of [i0, i1, i2]) {
      tan[i * 3]! += sdir[0];
      tan[i * 3 + 1]! += sdir[1];
      tan[i * 3 + 2]! += sdir[2];
      bitan[i * 3]! += tdir[0];
      bitan[i * 3 + 1]! += tdir[1];
      bitan[i * 3 + 2]! += tdir[2];
    }
  }

  const out = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const n = vec3(normals, i);
    const t = vec3(tan, i);
    // Gram-Schmidt orthonormalize against the normal.
    const ndt = dot(n, t);
    let ortho: [number, number, number] = [t[0] - n[0] * ndt, t[1] - n[1] * ndt, t[2] - n[2] * ndt];
    ortho = normalize(ortho);
    const bt = vec3(bitan, i);
    const handed = dot(cross(n, ortho), bt) < 0 ? -1 : 1;
    out[i * 4] = ortho[0];
    out[i * 4 + 1] = ortho[1];
    out[i * 4 + 2] = ortho[2];
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

function weldKey(
  pointIndex: number,
  normal: readonly number[],
  uv: readonly number[] | undefined,
  extra: readonly number[][],
): string {
  const parts: string[] = [String(pointIndex)];
  parts.push(quantize(normal));
  if (uv) parts.push(quantize(uv));
  for (const e of extra) parts.push(quantize(e));
  return parts.join('|');
}

function quantize(v: readonly number[]): string {
  return v.map((x) => Math.round(x * WELD_SCALE)).join(',');
}

function sliceVec(flat: readonly number[], index: number, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(flat[index * size + i] ?? 0);
  return out;
}

function vec3(a: Float32Array, i: number): [number, number, number] {
  return [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];
}

function vec2(a: Float32Array, i: number): [number, number] {
  return [a[i * 2]!, a[i * 2 + 1]!];
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

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function normalize(v: readonly number[]): [number, number, number] {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!);
  if (len === 0) return [0, 0, 1];
  return [v[0]! / len, v[1]! / len, v[2]! / len];
}
