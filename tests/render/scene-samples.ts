// T035c2: deterministic camera visibility of the shader ball. Primary pinhole
// rays from a control-scene camera are intersected against the welded mesh via
// the project BVH (geometry/bvh.ts) + Moller-Trumbore, producing one shading
// sample per pixel (position / normal / uv / viewDir / hit mask). The mesh is
// recentred and uniformly scaled to fit the camera frame so the fixed control
// camera frames it regardless of the asset's authored scale. These samples are
// the shared surface both backends shade in T035c3, so raster and path tracing
// see identical geometry. The BVH traversal is checked against a brute-force
// triangle sweep (the reference) in the tests.
import { buildBvh, type Bvh } from '../../src/geometry/bvh.ts';
import { prepareShaderBall, type ShaderBallFixture } from '../../src/geometry/shaderball.ts';
import type { Ray } from '../../src/render/pathtracing/integrator.ts';
import type { Vec3 } from '../../src/scene/transforms.ts';

type V3 = [number, number, number];

const EPS = 1e-6;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulS = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize(a: V3): V3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}

export interface CameraParams {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovYRadians: number;
  readonly aspect: number;
}

export interface FittedSurface {
  /** Recentred + uniformly scaled positions that frame in the control camera. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly bvh: Bvh;
  readonly center: V3;
  readonly radius: number;
}

export interface ShadingSample {
  readonly hit: boolean;
  readonly position: V3;
  readonly normal: V3;
  readonly uv: [number, number];
  /** Unit direction from the surface toward the camera. */
  readonly viewDir: V3;
  readonly t: number;
}

export interface SampleGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major (py * width + px). */
  readonly samples: readonly ShadingSample[];
  readonly hitCount: number;
}

export interface TriHit {
  readonly t: number;
  readonly tri: number;
  readonly u: number;
  readonly v: number;
}

const MISS: ShadingSample = {
  hit: false,
  position: [0, 0, 0],
  normal: [0, 0, 1],
  uv: [0, 0],
  viewDir: [0, 0, 1],
  t: Infinity,
};

/** Recentre and uniformly scale the shader ball to a target bounding radius. */
export function fitShaderBall(data: ShaderBallFixture, targetRadius = 1): FittedSurface {
  const mesh = prepareShaderBall(data);
  const src = mesh.positions;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < src.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = src[i + k]!;
      if (x < min[k]!) min[k] = x;
      if (x > max[k]!) max[k] = x;
    }
  }
  const center: V3 = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5];
  // Half the AABB diagonal is the bounding-sphere radius that contains the box.
  const half: V3 = [(max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5];
  const srcRadius = Math.hypot(half[0], half[1], half[2]) || 1;
  const s = targetRadius / srcRadius;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    positions[i] = (src[i]! - center[0]) * s;
    positions[i + 1] = (src[i + 1]! - center[1]) * s;
    positions[i + 2] = (src[i + 2]! - center[2]) * s;
  }
  const bvh = buildBvh(positions, mesh.indices);
  return {
    positions,
    normals: mesh.normals,
    uvs: mesh.uvs ?? new Float32Array(0),
    indices: mesh.indices,
    bvh,
    center: [0, 0, 0],
    radius: targetRadius,
  };
}

interface CameraBasis {
  eye: V3;
  forward: V3;
  right: V3;
  up: V3;
  tanHalfFovY: number;
  aspect: number;
}

function cameraBasis(cam: CameraParams): CameraBasis {
  const eye: V3 = [cam.eye[0], cam.eye[1], cam.eye[2]];
  const forward = normalize(sub([cam.target[0], cam.target[1], cam.target[2]], eye));
  const right = normalize(cross(forward, [cam.up[0], cam.up[1], cam.up[2]]));
  const up = cross(right, forward);
  return { eye, forward, right, up, tanHalfFovY: Math.tan(cam.fovYRadians * 0.5), aspect: cam.aspect };
}

/** Pinhole primary ray through pixel centre (px,py) of a width x height image. */
export function primaryRay(cam: CameraParams, px: number, py: number, width: number, height: number): Ray {
  const b = cameraBasis(cam);
  const sx = (2 * (px + 0.5) / width - 1) * b.aspect * b.tanHalfFovY;
  const sy = (1 - 2 * (py + 0.5) / height) * b.tanHalfFovY;
  const dir = normalize(add(add(b.forward, mulS(b.right, sx)), mulS(b.up, sy)));
  return { origin: b.eye, direction: dir };
}

function tri(positions: Float32Array, indices: Uint32Array, t: number): [V3, V3, V3] {
  const a = indices[t * 3]!;
  const b = indices[t * 3 + 1]!;
  const c = indices[t * 3 + 2]!;
  return [
    [positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!],
    [positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!],
    [positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!],
  ];
}

function rayTri(o: V3, d: V3, p0: V3, p1: V3, p2: V3): { t: number; u: number; v: number } | null {
  const e1 = sub(p1, p0);
  const e2 = sub(p2, p0);
  const pv = cross(d, e2);
  const det = dot(e1, pv);
  if (Math.abs(det) < EPS) return null;
  const inv = 1 / det;
  const tv = sub(o, p0);
  const u = dot(tv, pv) * inv;
  if (u < 0 || u > 1) return null;
  const qv = cross(tv, e1);
  const v = dot(d, qv) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qv) * inv;
  if (t <= EPS) return null;
  return { t, u, v };
}

function rayAabb(o: V3, inv: V3, min: readonly number[], max: readonly number[], tMax: number): boolean {
  let t0 = EPS;
  let t1 = tMax;
  for (let i = 0; i < 3; i++) {
    const a = (min[i]! - o[i]!) * inv[i]!;
    const b = (max[i]! - o[i]!) * inv[i]!;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo > t0) t0 = lo;
    if (hi < t1) t1 = hi;
    if (t0 > t1) return false;
  }
  return true;
}

/** Nearest triangle hit via BVH traversal. */
export function intersectBvh(surface: FittedSurface, ray: Ray): TriHit | null {
  const { bvh, positions, indices } = surface;
  if (bvh.nodes.length === 0) return null;
  const o: V3 = [ray.origin[0], ray.origin[1], ray.origin[2]];
  const d: V3 = [ray.direction[0], ray.direction[1], ray.direction[2]];
  const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
  let best: TriHit | null = null;
  let bestT = Infinity;
  const stack = [0];
  while (stack.length > 0) {
    const ni = stack.pop()!;
    const node = bvh.nodes[ni]!;
    if (!rayAabb(o, inv, node.min, node.max, bestT)) continue;
    if (node.left < 0) {
      for (let i = 0; i < node.count; i++) {
        const t = bvh.triangleOrder[node.start + i]!;
        const [p0, p1, p2] = tri(positions, indices, t);
        const h = rayTri(o, d, p0, p1, p2);
        if (h && h.t < bestT) {
          bestT = h.t;
          best = { t: h.t, tri: t, u: h.u, v: h.v };
        }
      }
    } else {
      stack.push(node.left, node.right);
    }
  }
  return best;
}

/** Nearest triangle hit by scanning every triangle; the traversal reference. */
export function intersectBruteForce(surface: FittedSurface, ray: Ray): TriHit | null {
  const { positions, indices } = surface;
  const o: V3 = [ray.origin[0], ray.origin[1], ray.origin[2]];
  const d: V3 = [ray.direction[0], ray.direction[1], ray.direction[2]];
  const triangleCount = indices.length / 3;
  let best: TriHit | null = null;
  let bestT = Infinity;
  for (let t = 0; t < triangleCount; t++) {
    const [p0, p1, p2] = tri(positions, indices, t);
    const h = rayTri(o, d, p0, p1, p2);
    if (h && h.t < bestT) {
      bestT = h.t;
      best = { t: h.t, tri: t, u: h.u, v: h.v };
    }
  }
  return best;
}

function shadeHit(surface: FittedSurface, ray: Ray, hit: TriHit): ShadingSample {
  const { normals, uvs, indices } = surface;
  const o: V3 = [ray.origin[0], ray.origin[1], ray.origin[2]];
  const d: V3 = [ray.direction[0], ray.direction[1], ray.direction[2]];
  const a = indices[hit.tri * 3]!;
  const b = indices[hit.tri * 3 + 1]!;
  const c = indices[hit.tri * 3 + 2]!;
  const w0 = 1 - hit.u - hit.v;
  const w1 = hit.u;
  const w2 = hit.v;
  const na: V3 = [normals[a * 3]!, normals[a * 3 + 1]!, normals[a * 3 + 2]!];
  const nb: V3 = [normals[b * 3]!, normals[b * 3 + 1]!, normals[b * 3 + 2]!];
  const nc: V3 = [normals[c * 3]!, normals[c * 3 + 1]!, normals[c * 3 + 2]!];
  const normal = normalize([
    w0 * na[0] + w1 * nb[0] + w2 * nc[0],
    w0 * na[1] + w1 * nb[1] + w2 * nc[1],
    w0 * na[2] + w1 * nb[2] + w2 * nc[2],
  ]);
  const uv: [number, number] = uvs.length
    ? [
        w0 * uvs[a * 2]! + w1 * uvs[b * 2]! + w2 * uvs[c * 2]!,
        w0 * uvs[a * 2 + 1]! + w1 * uvs[b * 2 + 1]! + w2 * uvs[c * 2 + 1]!,
      ]
    : [0, 0];
  return {
    hit: true,
    position: add(o, mulS(d, hit.t)),
    normal,
    uv,
    viewDir: normalize([-d[0], -d[1], -d[2]]),
    t: hit.t,
  };
}

/** Cast one primary ray per pixel and collect shading samples. */
export function sampleSurface(
  surface: FittedSurface,
  cam: CameraParams,
  width: number,
  height: number,
): SampleGrid {
  const samples: ShadingSample[] = [];
  let hitCount = 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const ray = primaryRay(cam, px, py, width, height);
      const hit = intersectBvh(surface, ray);
      if (hit) {
        samples.push(shadeHit(surface, ray, hit));
        hitCount++;
      } else {
        samples.push(MISS);
      }
    }
  }
  return { width, height, samples, hitCount };
}
