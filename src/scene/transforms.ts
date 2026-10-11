// Static transforms (plan sections 8, 9.4, T021). Column-major 4x4 matrix math
// shared by instancing (prototypes), cameras and lights. USD xformOpOrder is
// composed here; the scene is static so there is no time sampling. This module is
// the single home for matrix helpers consumed by scene/instances.ts,
// usd/cameras.ts and usd/lights.ts.

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { AttributeValue, SceneAsset, XformOp } from './types.ts';

/** Column-major 4x4 matrix. */
export type Mat4 = readonly number[];

export type Vec3 = readonly [number, number, number];

export const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function transformPoint(m: Mat4, p: Vec3): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

export function transformDirection(m: Mat4, p: Vec3): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2],
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2],
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2],
  ];
}

function asVec(value: AttributeValue | undefined): number[] {
  if (Array.isArray(value)) return value.map((n) => Number(n));
  if (typeof value === 'number') return [value];
  return [];
}

export function translation4(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function scaling4(x: number, y: number, z: number): Mat4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

export function rotationAxis4(axis: number, degrees: number): Mat4 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  if (axis === 0) return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  if (axis === 1) return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function quaternion4(w: number, x: number, y: number, z: number): Mat4 {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  return [
    1 - 2 * (yy + zz), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (xx + zz), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ];
}

export function inverse4(m: Mat4): Mat4 {
  const inv = new Array<number>(16);
  inv[0] = m[5]! * m[10]! * m[15]! - m[5]! * m[11]! * m[14]! - m[9]! * m[6]! * m[15]! + m[9]! * m[7]! * m[14]! + m[13]! * m[6]! * m[11]! - m[13]! * m[7]! * m[10]!;
  inv[4] = -m[4]! * m[10]! * m[15]! + m[4]! * m[11]! * m[14]! + m[8]! * m[6]! * m[15]! - m[8]! * m[7]! * m[14]! - m[12]! * m[6]! * m[11]! + m[12]! * m[7]! * m[10]!;
  inv[8] = m[4]! * m[9]! * m[15]! - m[4]! * m[11]! * m[13]! - m[8]! * m[5]! * m[15]! + m[8]! * m[7]! * m[13]! + m[12]! * m[5]! * m[11]! - m[12]! * m[7]! * m[9]!;
  inv[12] = -m[4]! * m[9]! * m[14]! + m[4]! * m[10]! * m[13]! + m[8]! * m[5]! * m[14]! - m[8]! * m[6]! * m[13]! - m[12]! * m[5]! * m[10]! + m[12]! * m[6]! * m[9]!;
  inv[1] = -m[1]! * m[10]! * m[15]! + m[1]! * m[11]! * m[14]! + m[9]! * m[2]! * m[15]! - m[9]! * m[3]! * m[14]! - m[13]! * m[2]! * m[11]! + m[13]! * m[3]! * m[10]!;
  inv[5] = m[0]! * m[10]! * m[15]! - m[0]! * m[11]! * m[14]! - m[8]! * m[2]! * m[15]! + m[8]! * m[3]! * m[14]! + m[12]! * m[2]! * m[11]! - m[12]! * m[3]! * m[10]!;
  inv[9] = -m[0]! * m[9]! * m[15]! + m[0]! * m[11]! * m[13]! + m[8]! * m[1]! * m[15]! - m[8]! * m[3]! * m[13]! - m[12]! * m[1]! * m[11]! + m[12]! * m[3]! * m[9]!;
  inv[13] = m[0]! * m[9]! * m[14]! - m[0]! * m[10]! * m[13]! - m[8]! * m[1]! * m[14]! + m[8]! * m[2]! * m[13]! + m[12]! * m[1]! * m[10]! - m[12]! * m[2]! * m[9]!;
  inv[2] = m[1]! * m[6]! * m[15]! - m[1]! * m[7]! * m[14]! - m[5]! * m[2]! * m[15]! + m[5]! * m[3]! * m[14]! + m[13]! * m[2]! * m[7]! - m[13]! * m[3]! * m[6]!;
  inv[6] = -m[0]! * m[6]! * m[15]! + m[0]! * m[7]! * m[14]! + m[4]! * m[2]! * m[15]! - m[4]! * m[3]! * m[14]! - m[12]! * m[2]! * m[7]! + m[12]! * m[3]! * m[6]!;
  inv[10] = m[0]! * m[5]! * m[15]! - m[0]! * m[7]! * m[13]! - m[4]! * m[1]! * m[15]! + m[4]! * m[3]! * m[13]! + m[12]! * m[1]! * m[7]! - m[12]! * m[3]! * m[5]!;
  inv[14] = -m[0]! * m[5]! * m[14]! + m[0]! * m[6]! * m[13]! + m[4]! * m[1]! * m[14]! - m[4]! * m[2]! * m[13]! - m[12]! * m[1]! * m[6]! + m[12]! * m[2]! * m[5]!;
  inv[3] = -m[1]! * m[6]! * m[11]! + m[1]! * m[7]! * m[10]! + m[5]! * m[2]! * m[11]! - m[5]! * m[3]! * m[10]! - m[9]! * m[2]! * m[7]! + m[9]! * m[3]! * m[6]!;
  inv[7] = m[0]! * m[6]! * m[11]! - m[0]! * m[7]! * m[10]! - m[4]! * m[2]! * m[11]! + m[4]! * m[3]! * m[10]! + m[8]! * m[2]! * m[7]! - m[8]! * m[3]! * m[6]!;
  inv[11] = -m[0]! * m[5]! * m[11]! + m[0]! * m[7]! * m[9]! + m[4]! * m[1]! * m[11]! - m[4]! * m[3]! * m[9]! - m[8]! * m[1]! * m[7]! + m[8]! * m[3]! * m[5]!;
  inv[15] = m[0]! * m[5]! * m[10]! - m[0]! * m[6]! * m[9]! - m[4]! * m[1]! * m[10]! + m[4]! * m[2]! * m[9]! + m[8]! * m[1]! * m[6]! - m[8]! * m[2]! * m[5]!;
  let det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!;
  if (det === 0) return IDENTITY4;
  det = 1 / det;
  return inv.map((v) => v * det);
}

function opMatrix(op: XformOp, sink?: DiagnosticSink): Mat4 {
  const name = op.op;
  const v = asVec(op.value);
  let m: Mat4;
  if (name.includes('transform')) {
    m = v.length >= 16 ? v.slice(0, 16) : IDENTITY4;
  } else if (name.includes('translate')) {
    m = translation4(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  } else if (name.includes('scale')) {
    const s = v.length === 1 ? [v[0], v[0], v[0]] : v;
    m = scaling4(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1);
  } else if (name.includes('orient')) {
    m = quaternion4(v[0] ?? 1, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
  } else if (name.includes('rotateXYZ') || name.includes('rotateXZY') || name.includes('rotateZYX')) {
    m = multiply4(rotationAxis4(0, v[0] ?? 0), multiply4(rotationAxis4(1, v[1] ?? 0), rotationAxis4(2, v[2] ?? 0)));
  } else if (name.includes('rotateX')) {
    m = rotationAxis4(0, v[0] ?? 0);
  } else if (name.includes('rotateY')) {
    m = rotationAxis4(1, v[0] ?? 0);
  } else if (name.includes('rotateZ')) {
    m = rotationAxis4(2, v[0] ?? 0);
  } else {
    sink?.({ level: 'warning', message: `Unsupported xformOp ${name}`, detail: op.typeName });
    m = IDENTITY4;
  }
  return op.invert ? inverse4(m) : m;
}

/** Local transform composed from xformOpOrder (first op is outermost). */
export function composeXform(ops: readonly XformOp[], sink?: DiagnosticSink): Mat4 {
  let m = IDENTITY4;
  for (const op of ops) m = multiply4(m, opMatrix(op, sink));
  return m;
}

/** World transform per prim path, accumulated down the scene tree. */
export function computeWorldTransforms(scene: SceneAsset, sink?: DiagnosticSink): Map<string, Mat4> {
  const world = new Map<string, Mat4>();
  const walk = (path: string, parent: Mat4): void => {
    const prim = scene.prims.get(path);
    if (!prim) return;
    const here = multiply4(parent, composeXform(prim.xformOps, sink));
    world.set(path, here);
    for (const child of prim.children) walk(child, here);
  };
  for (const root of scene.roots) walk(root, IDENTITY4);
  return world;
}

/** Perspective projection, column-major, clip z in [0, 1] (WebGPU). */
export function perspective4(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ];
}

/** Orthographic projection, column-major, clip z in [0, 1] (WebGPU). */
export function orthographic4(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  return [
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, 1 / (near - far), 0,
    -(right + left) / (right - left), -(top + bottom) / (top - bottom), near / (near - far), 1,
  ];
}

/** Right-handed view matrix looking from eye to target. */
export function lookAt4(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const fx = target[0] - eye[0];
  const fy = target[1] - eye[1];
  const fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f: Vec3 = [fx / fl, fy / fl, fz / fl];
  let sx = f[1] * up[2] - f[2] * up[1];
  let sy = f[2] * up[0] - f[0] * up[2];
  let sz = f[0] * up[1] - f[1] * up[0];
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  const ux = sy * f[2] - sz * f[1];
  const uy = sz * f[0] - sx * f[2];
  const uz = sx * f[1] - sy * f[0];
  return [
    sx, ux, -f[0], 0,
    sy, uy, -f[1], 0,
    sz, uz, -f[2], 0,
    -(sx * eye[0] + sy * eye[1] + sz * eye[2]),
    -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
    f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
    1,
  ];
}
