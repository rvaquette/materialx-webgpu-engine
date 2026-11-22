// Non-mesh USD gprims turned into renderable triangle meshes, so every backend
// (raster, path tracing, Disney) and the animation path treat them as meshes:
// - BasisCurves (hair, fur): each curve is evaluated (linear, or cubic Bezier,
//   B-spline or Catmull-Rom) and swept into a thin tube with smooth radial
//   normals. Texture coordinates run along the fiber (u) and around it (v), so
//   the generated tangent follows the fiber, as the Chiang hair BSDF expects.
// - Points (particles): one low-poly sphere per point, sized by `widths`.
import type { Primvar, RawMesh } from '../geometry/prepare.ts';
import type { ScenePrim } from './types.ts';

type V3 = [number, number, number];

function numbers(prim: ScenePrim, name: string): number[] {
  const value = prim.attributes.get(name)?.value;
  return Array.isArray(value) ? (value as readonly unknown[]).map(Number) : typeof value === 'number' ? [value] : [];
}

function token(prim: ScenePrim, name: string, fallback: string): string {
  const value = prim.attributes.get(name)?.value;
  return typeof value === 'string' ? value : fallback;
}

/** Per-vertex widths; constant or missing widths fill every vertex. */
function widthsFor(prim: ScenePrim, count: number, fallback: number): number[] {
  const widths = numbers(prim, 'widths');
  if (widths.length === count) return widths;
  return Array.from({ length: count }, () => widths[0] ?? fallback);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normalize(a: V3): V3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
}

/** Cubic basis weights at t for the four control points of one segment. */
function cubicWeights(basis: string, t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t, s = 1 - t;
  if (basis === 'bspline') return [s * s * s / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
  if (basis === 'catmullRom') return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
  return [s * s * s, 3 * s * s * t, 3 * s * t2, t3];
}

/** Evaluated polyline of one curve: positions and their parameter in [0, 1] along the control points. */
export function evaluateCurve(
  control: readonly V3[], type: string, basis: string, wrap: string, steps: number,
): Array<{ position: V3; along: number }> {
  if (type !== 'cubic' || control.length < 4) {
    const points = wrap === 'periodic' && control.length > 2 ? [...control, control[0]!] : control;
    return points.map((position, i) => ({ position, along: points.length > 1 ? i / (points.length - 1) : 0 }));
  }
  let points = [...control];
  if (wrap === 'periodic') points = basis === 'bezier' ? [...points, points[0]!] : [...points, points[0]!, points[1]!, points[2]!];
  else if (wrap === 'pinned' && basis !== 'bezier') points = [points[0]!, ...points, points.at(-1)!];
  const stride = basis === 'bezier' ? 3 : 1;
  const segments = Math.floor((points.length - 4) / stride) + 1;
  const result: Array<{ position: V3; along: number }> = [];
  for (let segment = 0; segment < segments; segment++) {
    const base = segment * stride;
    for (let step = segment === 0 ? 0 : 1; step <= steps; step++) {
      const w = cubicWeights(basis, step / steps);
      const position: V3 = [0, 0, 0];
      for (let k = 0; k < 4; k++) for (let a = 0; a < 3; a++) position[a] = position[a]! + w[k]! * points[base + k]![a]!;
      result.push({ position, along: (segment + step / steps) / segments });
    }
  }
  return result;
}

/** Sweeps every curve of a BasisCurves prim into a tube mesh. */
export function curvesToMesh(prim: ScenePrim): RawMesh | undefined {
  const flat = numbers(prim, 'points');
  const counts = numbers(prim, 'curveVertexCounts');
  if (flat.length < 6 || counts.length === 0) return undefined;
  const type = token(prim, 'type', 'cubic');
  const basis = token(prim, 'basis', 'bezier');
  const wrap = token(prim, 'wrap', 'nonperiodic');
  const widths = widthsFor(prim, flat.length / 3, 0.01);
  const total = counts.reduce((sum, count) => sum + count, 0);
  // Fewer sides for dense hair keeps the triangle count reasonable.
  const sides = total > 200_000 ? 3 : total > 20_000 ? 4 : 6;
  const steps = type === 'cubic' ? (total > 200_000 ? 2 : 4) : 1;
  const points: number[] = [], normals: number[] = [], st: number[] = [];
  const faceVertexCounts: number[] = [], faceVertexIndices: number[] = [];
  let first = 0;
  for (const count of counts) {
    const control: V3[] = [];
    for (let i = 0; i < count; i++) control.push([flat[(first + i) * 3]!, flat[(first + i) * 3 + 1]!, flat[(first + i) * 3 + 2]!]);
    const curveWidths = widths.slice(first, first + count);
    first += count;
    const samples = evaluateCurve(control, type, basis, wrap, steps);
    if (samples.length < 2) continue;
    const ringBase = points.length / 3;
    let normal: V3 | undefined;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i]!.position;
      const tangent = normalize(sub(samples[Math.min(i + 1, samples.length - 1)]!.position, samples[Math.max(i - 1, 0)]!.position));
      // Parallel transport keeps the ring from twisting along the curve.
      if (!normal || dot(normal, normal) === 0) {
        const helper: V3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        normal = normalize(cross(cross(tangent, helper), tangent));
      } else {
        normal = normalize(sub(normal, tangent.map(c => c * dot(normal!, tangent)) as V3));
      }
      const binormal = cross(tangent, normal);
      const along = samples[i]!.along * (curveWidths.length - 1);
      const lower = Math.floor(along), upper = Math.min(lower + 1, curveWidths.length - 1);
      const radius = 0.5 * ((curveWidths[lower] ?? 0.01) * (1 - (along - lower)) + (curveWidths[upper] ?? 0.01) * (along - lower));
      for (let k = 0; k < sides; k++) {
        const angle = 2 * Math.PI * k / sides;
        const radial: V3 = [0, 1, 2].map(a => Math.cos(angle) * normal![a]! + Math.sin(angle) * binormal[a]!) as V3;
        points.push(p[0] + radius * radial[0], p[1] + radius * radial[1], p[2] + radius * radial[2]);
        normals.push(...radial);
      }
    }
    for (let i = 0; i + 1 < samples.length; i++) {
      for (let k = 0; k < sides; k++) {
        const a = ringBase + i * sides + k, b = ringBase + i * sides + (k + 1) % sides;
        faceVertexCounts.push(4);
        faceVertexIndices.push(a, b, b + sides, a + sides);
        const u0 = samples[i]!.along, u1 = samples[i + 1]!.along;
        st.push(u0, k / sides, u0, (k + 1) / sides, u1, (k + 1) / sides, u1, k / sides);
      }
    }
  }
  if (faceVertexCounts.length === 0) return undefined;
  const normalPrimvar: Primvar = { name: 'normals', interpolation: 'vertex', values: normals, elementSize: 3 };
  const uvPrimvar: Primvar = { name: 'st', interpolation: 'faceVarying', values: st, elementSize: 2 };
  return { points, faceVertexCounts, faceVertexIndices, normals: normalPrimvar, primvars: [uvPrimvar] };
}

// Unit icosphere (one subdivision of an icosahedron: 42 vertices, 80 triangles).
let unitSphere: { vertices: V3[]; triangles: number[] } | undefined;
function sphere(): { vertices: V3[]; triangles: number[] } {
  if (unitSphere) return unitSphere;
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices: V3[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V3[]).map(normalize);
  let triangles = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let index = midpoints.get(key);
    if (index === undefined) {
      index = vertices.length;
      vertices.push(normalize([0, 1, 2].map(k => vertices[a]![k]! + vertices[b]![k]!) as V3));
      midpoints.set(key, index);
    }
    return index;
  };
  const refined: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!];
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    refined.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  triangles = refined;
  return unitSphere = { vertices, triangles };
}

/** One sphere per point of a Points prim (diameter from `widths`). */
export function pointsToMesh(prim: ScenePrim): RawMesh | undefined {
  const flat = numbers(prim, 'points');
  if (flat.length < 3) return undefined;
  const count = Math.floor(flat.length / 3);
  const widths = widthsFor(prim, count, 0.05);
  const { vertices, triangles } = sphere();
  const points: number[] = [], normals: number[] = [], faceVertexIndices: number[] = [];
  for (let p = 0; p < count; p++) {
    const base = p * vertices.length;
    const radius = 0.5 * widths[p]!;
    for (const v of vertices) {
      points.push(flat[p * 3]! + radius * v[0], flat[p * 3 + 1]! + radius * v[1], flat[p * 3 + 2]! + radius * v[2]);
      normals.push(...v);
    }
    for (const index of triangles) faceVertexIndices.push(base + index);
  }
  return {
    points, faceVertexIndices, faceVertexCounts: new Array<number>(faceVertexIndices.length / 3).fill(3),
    normals: { name: 'normals', interpolation: 'vertex', values: normals, elementSize: 3 },
  };
}

/** Renderable non-mesh gprim types turned into meshes by meshSourceFromScene. */
export const PROCEDURAL_GPRIMS = new Set(['BasisCurves', 'Points']);
