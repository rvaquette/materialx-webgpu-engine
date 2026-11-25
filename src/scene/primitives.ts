// Parametric primitives tessellated into triangle meshes: the UsdGeom implicit gprims (Sphere,
// Cube, Cylinder, Cone, Capsule, Plane) and the scripted Torus and Disk. Meshes carry smooth
// vertex normals and `st` texture coordinates (prepareMesh derives the tangents from them), so
// every backend shades them like authored meshes. Round shapes are built around +Y and then
// turned to their `axis`; triangles are wound counterclockwise seen from outside.
import type { RawMesh } from '../geometry/prepare.ts';
import { IMPLICIT_GPRIMS, type MaterialXReference, type SceneAsset, type ScenePrim } from './types.ts';

export type PrimitiveAxis = 'X' | 'Y' | 'Z';

export type PrimitiveShape =
  | { kind: 'sphere'; radius: number; resolution: number }
  | { kind: 'cube'; size: number; resolution: number }
  | { kind: 'cylinder' | 'cone' | 'capsule'; radius: number; height: number; axis: PrimitiveAxis; resolution: number }
  | { kind: 'plane'; width: number; length: number; axis: PrimitiveAxis; resolution: number }
  | { kind: 'disk'; radius: number; axis: PrimitiveAxis; resolution: number }
  | { kind: 'torus'; radius: number; minorRadius: number; axis: PrimitiveAxis; resolution: number };

export type PrimitiveKind = PrimitiveShape['kind'];

/** Lowest resolution per kind: segments around round shapes, subdivisions per side otherwise. */
export const MIN_RESOLUTION: Readonly<Record<PrimitiveKind, number>> = {
  sphere: 3, cube: 1, cylinder: 3, cone: 3, capsule: 3, plane: 1, disk: 3, torus: 3,
};
export const MAX_RESOLUTION = 1024;

/** Default resolution when a USD gprim does not author `engine:resolution`. */
const DEFAULT_RESOLUTION: Readonly<Record<PrimitiveKind, number>> = {
  sphere: 48, cube: 1, cylinder: 48, cone: 48, capsule: 48, plane: 1, disk: 48, torus: 48,
};

type V3 = [number, number, number];
type Uv = [number, number];

class MeshBuilder {
  readonly points: number[] = [];
  readonly normals: number[] = [];
  readonly st: number[] = [];
  readonly indices: number[] = [];

  vertex(p: V3, n: V3, uv: Uv): number {
    this.points.push(...p);
    this.normals.push(...n);
    this.st.push(...uv);
    return this.points.length / 3 - 1;
  }

  #at(index: number, values: readonly number[]): V3 {
    return [values[index * 3]!, values[index * 3 + 1]!, values[index * 3 + 2]!];
  }

  /** Adds a triangle facing its vertex normals; degenerate ones (poles, apex) are dropped. */
  triangle(a: number, b: number, c: number): void {
    const [pa, pb, pc] = [a, b, c].map(i => this.#at(i, this.points)) as [V3, V3, V3];
    const e1: V3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2: V3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const face: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = face[0] ** 2 + face[1] ** 2 + face[2] ** 2;
    if (!(area > 1e-12 * (e1[0] ** 2 + e1[1] ** 2 + e1[2] ** 2) * (e2[0] ** 2 + e2[1] ** 2 + e2[2] ** 2))) return;
    const [na, nb, nc] = [a, b, c].map(i => this.#at(i, this.normals)) as [V3, V3, V3];
    const facing = face[0] * (na[0] + nb[0] + nc[0]) + face[1] * (na[1] + nb[1] + nc[1]) + face[2] * (na[2] + nb[2] + nc[2]);
    if (facing < 0) this.indices.push(a, c, b);
    else this.indices.push(a, b, c);
  }

  /** A (rows + 1) × (columns + 1) vertex grid and its quads. */
  grid(rows: number, columns: number, at: (row: number, column: number) => { p: V3; n: V3; uv: Uv }): void {
    const base = this.points.length / 3;
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= columns; j++) {
        const { p, n, uv } = at(i, j);
        this.vertex(p, n, uv);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < columns; j++) {
        const a = base + i * (columns + 1) + j, b = a + 1, c = a + columns + 2, d = a + columns + 1;
        this.triangle(a, b, c);
        this.triangle(a, c, d);
      }
    }
  }

  /**
   * Revolves a profile (radius, height, radial and vertical normal, v) around +Y. Without
   * `planarRadius` texture coordinates are (angle, v); with it they are a top-down projection.
   */
  lathe(profile: readonly { r: number; y: number; nr: number; ny: number; v: number }[], segments: number, planarRadius?: number): void {
    // The seam column repeats the first one exactly.
    const angle = (column: number): [number, number] => {
      const theta = 2 * Math.PI * (column % segments) / segments;
      return [Math.cos(theta), Math.sin(theta)];
    };
    this.grid(profile.length - 1, segments, (row, column) => {
      const { r, y, nr, ny, v } = profile[row]!;
      const [c, s] = angle(column);
      const p: V3 = [r * c, y, -r * s];
      const uv: Uv = planarRadius ? [0.5 + p[0] / (2 * planarRadius), 0.5 + p[2] / (2 * planarRadius)] : [column / segments, v];
      return { p, n: [nr * c, ny, -nr * s], uv };
    });
  }

  /** Flat disk of `rings` rings at height `y`, facing up (`ny` = 1) or down (-1). */
  disk(radius: number, y: number, ny: number, segments: number, rings: number): void {
    this.lathe(Array.from({ length: rings + 1 }, (_, k) => ({ r: radius * k / rings, y, nr: 0, ny, v: k / rings })), segments, radius);
  }

  mesh(axis: PrimitiveAxis): RawMesh {
    // Turn +Y to the axis: a rotation of +90° about X (Z), or of -90° about Z (X).
    const turn = (values: number[]): number[] => {
      if (axis === 'Y') return values;
      const out = new Array<number>(values.length);
      for (let i = 0; i < values.length; i += 3) {
        const [x, y, z] = [values[i]!, values[i + 1]!, values[i + 2]!];
        if (axis === 'Z') { out[i] = x; out[i + 1] = -z; out[i + 2] = y; }
        else { out[i] = y; out[i + 1] = -x; out[i + 2] = z; }
      }
      return out;
    };
    return {
      points: turn(this.points),
      faceVertexCounts: new Array<number>(this.indices.length / 3).fill(3),
      faceVertexIndices: this.indices,
      normals: { name: 'normals', interpolation: 'vertex', values: turn(this.normals), elementSize: 3 },
      primvars: [{ name: 'st', interpolation: 'vertex', values: this.st, elementSize: 2 }],
      subdivisionScheme: 'none',
    };
  }
}

/** Profile of a quarter or half circle of `radius` centered at height `center`, from `from` to `to` (radians). */
function arc(radius: number, center: number, from: number, to: number, steps: number): { r: number; y: number; nr: number; ny: number }[] {
  return Array.from({ length: steps + 1 }, (_, k) => {
    const phi = from + (to - from) * k / steps;
    // Exact poles keep their triangles degenerate (dropped) rather than nearly so.
    const pole = Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-12;
    const cos = pole ? 0 : Math.cos(phi), sin = pole ? Math.sign(phi) : Math.sin(phi);
    return { r: radius * cos, y: center + radius * sin, nr: cos, ny: sin };
  });
}

/** Texture v along a profile, proportional to its length. */
function withLength<T extends { r: number; y: number }>(profile: readonly T[]): (T & { v: number })[] {
  const lengths = [0];
  for (let i = 1; i < profile.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(profile[i]!.r - profile[i - 1]!.r, profile[i]!.y - profile[i - 1]!.y));
  }
  const total = lengths.at(-1)! || 1;
  return profile.map((point, i) => ({ ...point, v: lengths[i]! / total }));
}

/** Validates the parameters of a shape; the error names the offending one. */
export function checkPrimitiveShape(shape: PrimitiveShape): void {
  const lengths = Object.entries(shape).filter(([name]) => !['kind', 'axis', 'resolution'].includes(name));
  for (const [name, value] of lengths) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new RangeError(`${shape.kind} ${name} must be a positive number.`);
  }
  const min = MIN_RESOLUTION[shape.kind];
  if (!Number.isInteger(shape.resolution) || shape.resolution < min || shape.resolution > MAX_RESOLUTION) {
    throw new RangeError(`${shape.kind} resolution must be an integer from ${min} to ${MAX_RESOLUTION}.`);
  }
  if ('axis' in shape && !['X', 'Y', 'Z'].includes(shape.axis)) throw new RangeError(`${shape.kind} axis must be "X", "Y" or "Z".`);
}

/** Triangle mesh of a primitive, centered on the origin. */
export function primitiveMesh(shape: PrimitiveShape): RawMesh {
  checkPrimitiveShape(shape);
  const builder = new MeshBuilder();
  const segments = shape.resolution;
  switch (shape.kind) {
    case 'sphere': {
      const rows = Math.max(2, Math.floor(segments / 2));
      builder.lathe(arc(shape.radius, 0, -Math.PI / 2, Math.PI / 2, rows).map((point, k) => ({ ...point, v: k / rows })), segments);
      return builder.mesh('Y');
    }
    case 'cube': {
      const half = shape.size / 2, n = segments;
      // Each face: normal axis, sign, and the axes of u and v.
      const faces: [number, number, number, number][] = [[0, 1, 2, 1], [0, -1, 2, 1], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]];
      for (const [axis, sign, uAxis, vAxis] of faces) {
        builder.grid(n, n, (i, j) => {
          const p: V3 = [0, 0, 0], normal: V3 = [0, 0, 0];
          p[axis] = sign * half;
          normal[axis] = sign;
          // u runs so that the texture is not mirrored seen from outside.
          const u = j / n, v = i / n;
          p[uAxis] = (sign > 0 === (axis !== 1) ? u - 0.5 : 0.5 - u) * shape.size;
          p[vAxis] = (v - 0.5) * shape.size;
          return { p, n: normal, uv: [u, v] };
        });
      }
      return builder.mesh('Y');
    }
    case 'cylinder':
    case 'cone': {
      const { radius, height } = shape;
      const rows = Math.max(1, Math.round(segments / 4));
      const rings = Math.max(1, Math.round(segments / 8));
      const top = shape.kind === 'cylinder' ? radius : 0;
      const slant = Math.hypot(height, radius - top);
      builder.lathe(Array.from({ length: rows + 1 }, (_, k) => ({
        r: radius + (top - radius) * k / rows, y: -height / 2 + height * k / rows,
        nr: height / slant, ny: (radius - top) / slant, v: k / rows,
      })), segments);
      builder.disk(radius, -height / 2, -1, segments, rings);
      if (shape.kind === 'cylinder') builder.disk(radius, height / 2, 1, segments, rings);
      return builder.mesh(shape.axis);
    }
    case 'capsule': {
      const { radius, height } = shape;
      const capRows = Math.max(2, Math.round(segments / 4));
      const bodyRows = Math.max(1, Math.round(segments / 8));
      const bottom = arc(radius, -height / 2, -Math.PI / 2, 0, capRows);
      const body = Array.from({ length: bodyRows }, (_, k) => ({ r: radius, y: -height / 2 + height * (k + 1) / bodyRows, nr: 1, ny: 0 }));
      const topCap = arc(radius, height / 2, 0, Math.PI / 2, capRows).slice(1);
      builder.lathe(withLength([...bottom, ...body, ...topCap]), segments);
      return builder.mesh(shape.axis);
    }
    case 'plane': {
      const n = segments;
      builder.grid(n, n, (i, j) => ({ p: [(j / n - 0.5) * shape.width, 0, (0.5 - i / n) * shape.length], n: [0, 1, 0], uv: [j / n, i / n] }));
      return builder.mesh(shape.axis);
    }
    case 'disk':
      builder.disk(shape.radius, 0, 1, segments, Math.max(1, Math.round(segments / 4)));
      return builder.mesh(shape.axis);
    case 'torus': {
      const rows = Math.max(3, Math.floor(segments / 2));
      builder.lathe(Array.from({ length: rows + 1 }, (_, k) => {
        const phi = 2 * Math.PI * (k % rows) / rows;
        return { r: shape.radius + shape.minorRadius * Math.cos(phi), y: shape.minorRadius * Math.sin(phi), nr: Math.cos(phi), ny: Math.sin(phi), v: k / rows };
      }), segments);
      return builder.mesh(shape.axis);
    }
  }
}

/** Moves each vertex of a primitive: (position, uv, normal) → new position. */
export type VertexDeformer = (position: [number, number, number], uv: [number, number], normal: [number, number, number]) => readonly number[];

/**
 * `mesh` with every vertex moved by `deform`, and smooth normals recomputed from the moved
 * triangles (vertices sharing a position share their normal, so seams stay smooth).
 */
export function deformMesh(mesh: RawMesh, deform: VertexDeformer): RawMesh {
  const count = mesh.points.length / 3;
  const st = mesh.primvars?.find(primvar => primvar.name === 'st')?.values ?? [];
  const normals = mesh.normals?.values ?? [];
  const points = new Array<number>(mesh.points.length);
  for (let i = 0; i < count; i++) {
    const moved = deform(
      [mesh.points[i * 3]!, mesh.points[i * 3 + 1]!, mesh.points[i * 3 + 2]!],
      [st[i * 2] ?? 0, st[i * 2 + 1] ?? 0],
      [normals[i * 3] ?? 0, normals[i * 3 + 1] ?? 1, normals[i * 3 + 2] ?? 0],
    );
    if (!Array.isArray(moved) || moved.length !== 3 || !moved.every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new RangeError('deform(position, uv, normal) must return [x, y, z] finite numbers.');
    }
    points[i * 3] = moved[0]; points[i * 3 + 1] = moved[1]; points[i * 3 + 2] = moved[2];
  }
  const key = (i: number): string => `${points[i * 3]!.toFixed(6)},${points[i * 3 + 1]!.toFixed(6)},${points[i * 3 + 2]!.toFixed(6)}`;
  const welded = new Map<string, number>();
  const group = Array.from({ length: count }, (_, i) => {
    const k = key(i);
    if (!welded.has(k)) welded.set(k, welded.size);
    return welded.get(k)!;
  });
  const sums = new Float64Array(welded.size * 3);
  const indices = mesh.faceVertexIndices;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const e1 = [0, 1, 2].map(k => points[b * 3 + k]! - points[a * 3 + k]!);
    const e2 = [0, 1, 2].map(k => points[c * 3 + k]! - points[a * 3 + k]!);
    // Unnormalized: larger triangles weigh more.
    const face = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    for (const vertex of [a, b, c]) for (let k = 0; k < 3; k++) sums[group[vertex]! * 3 + k]! += face[k]!;
  }
  const smooth: number[] = [];
  for (let i = 0; i < count; i++) {
    const g = group[i]!;
    const length = Math.hypot(sums[g * 3]!, sums[g * 3 + 1]!, sums[g * 3 + 2]!);
    if (length > 0) smooth.push(sums[g * 3]! / length, sums[g * 3 + 1]! / length, sums[g * 3 + 2]! / length);
    else smooth.push(normals[i * 3] ?? 0, normals[i * 3 + 1] ?? 1, normals[i * 3 + 2] ?? 0);
  }
  return { ...mesh, points, normals: { name: 'normals', interpolation: 'vertex', values: smooth, elementSize: 3 } };
}

/** Shape of an implicit gprim, with the UsdGeom fallback values; `engine:resolution` sets the tessellation. */
export function primitiveShapeOf(prim: ScenePrim): PrimitiveShape | undefined {
  const number = (name: string, fallback: number): number => {
    const value = prim.attributes.get(name)?.value;
    return typeof value === 'number' ? value : fallback;
  };
  const axis = (): PrimitiveAxis => {
    const value = prim.attributes.get('axis')?.value;
    return value === 'X' || value === 'Y' ? value : 'Z';
  };
  const resolution = (kind: PrimitiveKind): number => Math.round(number('engine:resolution', DEFAULT_RESOLUTION[kind]));
  switch (prim.typeName) {
    case 'Sphere': return { kind: 'sphere', radius: number('radius', 1), resolution: resolution('sphere') };
    case 'Cube': return { kind: 'cube', size: number('size', 2), resolution: resolution('cube') };
    case 'Cylinder': return { kind: 'cylinder', radius: number('radius', 1), height: number('height', 2), axis: axis(), resolution: resolution('cylinder') };
    case 'Cone': return { kind: 'cone', radius: number('radius', 1), height: number('height', 2), axis: axis(), resolution: resolution('cone') };
    case 'Capsule': return { kind: 'capsule', radius: number('radius', 0.5), height: number('height', 1), axis: axis(), resolution: resolution('capsule') };
    case 'Plane': return { kind: 'plane', width: number('width', 2), length: number('length', 2), axis: axis(), resolution: resolution('plane') };
    default: return undefined;
  }
}

/** Triangle mesh of an implicit gprim; an invalid shape (e.g. a zero radius) throws. */
export function gprimToMesh(prim: ScenePrim): RawMesh | undefined {
  const shape = primitiveShapeOf(prim);
  if (!shape) return undefined;
  try {
    return primitiveMesh(shape);
  } catch (error) {
    throw new Error(`${prim.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function bound(scene: SceneAsset, prim: ScenePrim): boolean {
  for (let path = prim.path; path && path !== '/'; path = path.slice(0, path.lastIndexOf('/')) || '/') {
    if (scene.prims.get(path)?.materialBinding) return true;
  }
  return false;
}

/**
 * Implicit gprims, and meshes written for script primitives (`engine:primitive`), without a
 * material get a MaterialX standard_surface colored by their `primvars:displayColor` (else the
 * standard_surface default), so they render in every backend.
 */
export function applyDefaultGprimMaterials(scene: SceneAsset): { scene: SceneAsset; texts: Map<string, string> } {
  const texts = new Map<string, string>();
  const prims = new Map(scene.prims);
  const materials: MaterialXReference[] = [...scene.materials];
  const names = new Map<string, string>();
  for (const prim of scene.prims.values()) {
    const primitive = IMPLICIT_GPRIMS.has(prim.typeName ?? '') || (prim.typeName === 'Mesh' && prim.attributes.has('engine:primitive'));
    if (!primitive || bound(scene, prim)) continue;
    const value = prim.attributes.get('primvars:displayColor')?.value;
    const color = Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(c => typeof c === 'number' && Number.isFinite(c))
      ? (value as number[]).slice(0, 3) : undefined;
    const key = color?.join(', ') ?? '';
    let name = names.get(key);
    if (!name) {
      name = `gprim_default_${names.size}`;
      names.set(key, name);
      texts.set(`usdgprim:${name}`, `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="${name}_surface" type="surfaceshader">${color ? `\n    <input name="base_color" type="color3" value="${key}" />` : ''}
  </standard_surface>
  <surfacematerial name="${name}" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="${name}_surface" />
  </surfacematerial>
</materialx>
`);
    }
    const materialPath = `${prim.path}/__DefaultMaterial`;
    prims.set(prim.path, { ...prim, materialBinding: { target: materialPath } });
    materials.push({ primPath: materialPath, assetPath: `usdgprim:${name}`, referencedPrimPath: `/${name}`, materialName: name });
  }
  return { scene: texts.size ? { ...scene, prims, materials } : scene, texts };
}
