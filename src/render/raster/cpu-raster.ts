// CPU software rasterizer (plan section 9, P9). Renders a SceneFramePlan (the
// same device-neutral raster plan the GPU backend consumes, src/render/raster/
// scene-frame.ts) to a linear HDR image WITHOUT WebGPU, so the raster backend can
// produce its own image under Node -- mirroring the CPU path tracer
// (src/render/pathtracing/integrator.ts). It transforms triangles exactly like the
// path-tracing scene buffers (transformPoint for positions, transformDirection +
// normalize for normals, src/render/pathtracing/scene-buffers.ts) and shades every
// covered pixel with the SAME canonical OpenPBR reference BSDF
// (src/render/bsdf/reference.ts evaluateSurface) under the frame's dominant
// directional light and constant environment. The pipeline is a classic
// edge-function rasterizer with a z-buffer and perspective-correct attribute
// interpolation; the camera clip transform uses the frame's column-major
// view-projection, matching the WGSL convention (WebGPU NDC, z in [0,1]). Pure and
// Node-testable; no GPU resources are touched here.

import { transformDirection, transformPoint, type Mat4, type Vec3 } from '../../scene/transforms.ts';
import { evaluateSurface, type CanonicalSurfaceParams, type ReferenceLighting } from '../bsdf/reference.ts';
import type { SceneResources } from '../scene-resources.ts';
import type { SceneFramePlan } from './scene-frame.ts';

export interface CpuRasterOptions {
  width: number;
  height: number;
}

export interface CpuRasterResult {
  /** Linear HDR radiance, RGB interleaved (width*height*3). Background is [0,0,0]. */
  hdr: Float32Array;
  /** 1 where a triangle covered the pixel, 0 for background (width*height). */
  coverage: Uint8Array;
  /** Number of covered pixels. */
  covered: number;
  width: number;
  height: number;
}

const EPS = 1e-9;

type V3 = [number, number, number];

function readVec3(data: Float32Array, vertex: number): V3 {
  const o = vertex * 3;
  return [data[o]!, data[o + 1]!, data[o + 2]!];
}

function normalize3(v: V3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub3(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Clip-space vertex: homogeneous coordinates after the column-major viewProj. */
interface Clip {
  x: number;
  y: number;
  z: number;
  w: number;
}

function toClip(m: Mat4, p: V3): Clip {
  return {
    x: m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    y: m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    z: m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
    w: m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!,
  };
}

/**
 * Rasterizes a SceneFramePlan to a linear HDR image on the CPU. Each triangle is
 * transformed to world space, projected through the frame camera, scan-converted
 * with edge functions against a per-pixel depth buffer, and shaded with the
 * reference OpenPBR BSDF under the frame's directional light and environment.
 */
export function rasterizeScene(
  resources: SceneResources,
  frame: SceneFramePlan,
  options: CpuRasterOptions,
): CpuRasterResult {
  const { width, height } = options;
  const hdr = new Float32Array(width * height * 3);
  const coverage = new Uint8Array(width * height);
  const depth = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);
  let covered = 0;

  const viewProj = frame.camera.viewProj;
  const eye = frame.camera.eye;
  const lighting: ReferenceLighting = {
    environment: frame.environment.radiance,
    lights: [
      {
        direction: frame.light.direction,
        color: frame.light.color,
        intensity: frame.light.intensity,
      },
    ],
  };

  for (const draw of frame.draws) {
    const geom = resources.geometries.get(draw.prototypeId);
    if (!geom) continue;
    const position = geom.streams.find((s) => s.name === 'position');
    if (!position) continue;
    const normal = geom.streams.find((s) => s.name === 'normal');
    const model = draw.model;
    // RasterSurface is structurally the canonical OpenPBR parameter set.
    const params: CanonicalSurfaceParams = draw.surface;
    const idx = geom.indices;

    for (let t = 0; t + 2 < idx.length; t += 3) {
      const ia = idx[t]!;
      const ib = idx[t + 1]!;
      const ic = idx[t + 2]!;

      const pa = transformPoint(model, readVec3(position.data, ia)) as V3;
      const pb = transformPoint(model, readVec3(position.data, ib)) as V3;
      const pc = transformPoint(model, readVec3(position.data, ic)) as V3;

      let na: V3;
      let nb: V3;
      let nc: V3;
      if (normal) {
        na = normalize3(transformDirection(model, readVec3(normal.data, ia)) as V3);
        nb = normalize3(transformDirection(model, readVec3(normal.data, ib)) as V3);
        nc = normalize3(transformDirection(model, readVec3(normal.data, ic)) as V3);
      } else {
        const faceN = normalize3(cross3(sub3(pb, pa), sub3(pc, pa)));
        na = faceN;
        nb = faceN;
        nc = faceN;
      }

      const ca = toClip(viewProj, pa);
      const cb = toClip(viewProj, pb);
      const cc = toClip(viewProj, pc);
      // Skip triangles touching or behind the camera plane (no near clipping).
      if (ca.w <= EPS || cb.w <= EPS || cc.w <= EPS) continue;

      covered += rasterTriangle(
        { clip: ca, normal: na, world: pa },
        { clip: cb, normal: nb, world: pb },
        { clip: cc, normal: nc, world: pc },
        params,
        eye,
        lighting,
        width,
        height,
        hdr,
        coverage,
        depth,
      );
    }
  }

  return { hdr, coverage, covered, width, height };
}

interface RasterVertex {
  clip: Clip;
  normal: V3;
  world: V3;
}

/** Scan-converts one triangle; returns the number of newly covered pixels. */
function rasterTriangle(
  v0: RasterVertex,
  v1: RasterVertex,
  v2: RasterVertex,
  params: CanonicalSurfaceParams,
  eye: Vec3,
  lighting: ReferenceLighting,
  width: number,
  height: number,
  hdr: Float32Array,
  coverage: Uint8Array,
  depth: Float32Array,
): number {
  // Perspective divide -> NDC, then viewport map to pixel centers (y flips).
  const iw0 = 1 / v0.clip.w;
  const iw1 = 1 / v1.clip.w;
  const iw2 = 1 / v2.clip.w;
  const x0 = (v0.clip.x * iw0 * 0.5 + 0.5) * width;
  const x1 = (v1.clip.x * iw1 * 0.5 + 0.5) * width;
  const x2 = (v2.clip.x * iw2 * 0.5 + 0.5) * width;
  const y0 = (1 - (v0.clip.y * iw0 * 0.5 + 0.5)) * height;
  const y1 = (1 - (v1.clip.y * iw1 * 0.5 + 0.5)) * height;
  const y2 = (1 - (v2.clip.y * iw2 * 0.5 + 0.5)) * height;
  const z0 = v0.clip.z * iw0;
  const z1 = v1.clip.z * iw1;
  const z2 = v2.clip.z * iw2;

  const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (Math.abs(area) < EPS) return 0;
  const invArea = 1 / area;

  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));

  let newlyCovered = 0;

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      // Edge functions (signed areas of the sub-triangles), normalized by the
      // signed triangle area so interior points are positive for either winding.
      const e0 = ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * invArea;
      const e1 = ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * invArea;
      const e2 = ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) * invArea;
      if (e0 < 0 || e1 < 0 || e2 < 0) continue;

      const d = e0 * z0 + e1 * z1 + e2 * z2;
      const pi = y * width + x;
      if (d >= depth[pi]!) continue;

      // Perspective-correct attribute interpolation.
      const persp = e0 * iw0 + e1 * iw1 + e2 * iw2;
      if (persp <= 0) continue;
      const inv = 1 / persp;
      const b0 = e0 * iw0 * inv;
      const b1 = e1 * iw1 * inv;
      const b2 = e2 * iw2 * inv;

      let nx = b0 * v0.normal[0] + b1 * v1.normal[0] + b2 * v2.normal[0];
      let ny = b0 * v0.normal[1] + b1 * v1.normal[1] + b2 * v2.normal[1];
      let nz = b0 * v0.normal[2] + b1 * v1.normal[2] + b2 * v2.normal[2];
      const nlen = Math.hypot(nx, ny, nz) || 1;
      nx /= nlen;
      ny /= nlen;
      nz /= nlen;

      const wx = b0 * v0.world[0] + b1 * v1.world[0] + b2 * v2.world[0];
      const wy = b0 * v0.world[1] + b1 * v1.world[1] + b2 * v2.world[1];
      const wz = b0 * v0.world[2] + b1 * v1.world[2] + b2 * v2.world[2];
      let vx = eye[0] - wx;
      let vy = eye[1] - wy;
      let vz = eye[2] - wz;
      const vlen = Math.hypot(vx, vy, vz) || 1;
      vx /= vlen;
      vy /= vlen;
      vz /= vlen;

      // Two-sided shading: face the normal toward the viewer.
      if (nx * vx + ny * vy + nz * vz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }

      const shaded = evaluateSurface(params, { normal: [nx, ny, nz], view: [vx, vy, vz] }, lighting).color;
      if (coverage[pi] === 0) newlyCovered += 1;
      depth[pi] = d;
      coverage[pi] = 1;
      const o = pi * 3;
      hdr[o] = shaded[0];
      hdr[o + 1] = shaded[1];
      hdr[o + 2] = shaded[2];
    }
  }

  return newlyCovered;
}
