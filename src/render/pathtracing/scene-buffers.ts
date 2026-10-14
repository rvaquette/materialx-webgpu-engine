// Path-tracing scene buffers (plan section 9, P9, T052). Packs the device-neutral
// SceneResources (T050) into the flat storage buffers the compute path tracer
// consumes: a world-space BVH over every instance triangle, the triangles (world
// positions + interpolated normals + a material index), and the OpenPBR surface
// constants per material. Camera, dominant directional light and the constant
// environment are derived through the SAME buildSceneFrame used by the raster
// backend (src/render/raster/scene-frame.ts), so both backends render identical
// assets without reimport -- only the integrator changes. The packing is pure and
// Node-testable; createSceneSampler exposes the exact packed data as the reference
// integrator's SceneSampler (src/render/pathtracing/integrator.ts), so the CPU
// oracle traverses byte-for-byte what the WGSL compute shader reads. The GPUBuffer
// writes live in the browser bootstrap and the backend (compute.ts).

import { buildBvh, type Aabb, type Bvh } from '../../geometry/bvh.ts';
import { inverse4, transformDirection, transformPoint, type Mat4, type Vec3 } from '../../scene/transforms.ts';
import type { SceneResources } from '../scene-resources.ts';
import {
  buildSceneFrame,
  NEUTRAL_SURFACE,
  type BuildSceneFrameOptions,
  type FrameEnvironment,
  type FrameLight,
  type RasterSurface,
} from '../raster/scene-frame.ts';
import { evalWorld, layeredSurfaceBsdf, sampleWorld } from './bsdf.ts';
import { canonicalSurfaceToLayered, type LayeredClosure } from '../../compiler/ir.ts';
import { packLayeredMaterial, unpackLayeredMaterial, PT_MATERIAL_RECORD_FLOATS } from './material-record.ts';
import type {
  BsdfSample,
  LightSample,
  Ray,
  Rng,
  SceneSampler,
  SurfaceHit,
} from './integrator.ts';

/** Floats per packed BVH node: min(3), left, max(3), right, start, count, pad, pad. */
export const PT_NODE_FLOATS = 12;
/** Floats per packed triangle: v0,v1,v2, n0,n1,n2 (18) + materialIndex + 5 pad. */
export const PT_TRIANGLE_FLOATS = 24;
/** Floats per packed material: the flat LayeredClosure record (T057b, megakernel-ready). */
export const PT_MATERIAL_FLOATS = PT_MATERIAL_RECORD_FLOATS;

export interface PathTraceCamera {
  viewProj: Mat4;
  /** Inverse view-projection for unprojecting pixel rays in the compute shader. */
  invViewProj: Mat4;
  eye: Vec3;
  exposure: number;
}

export interface PathTraceScene {
  /** Packed BVH nodes (PT_NODE_FLOATS each), world-space over all triangles. */
  nodes: Float32Array;
  nodeCount: number;
  /** Packed triangles in original soup order (PT_TRIANGLE_FLOATS each). */
  triangles: Float32Array;
  /** BVH leaf-order permutation of triangle ordinals (node start/count index this). */
  triangleOrder: Uint32Array;
  triangleCount: number;
  /** Packed LayeredClosure records (PT_MATERIAL_FLOATS each, T057b). */
  materials: Float32Array;
  materialCount: number;
  /** Per-triangle UVs (6 floats: u0,v0,u1,v1,u2,v2) in triangle-soup order; 0 when unauthored. */
  triangleUv: Float32Array;
  /** Dedup material keys in material-index order (lets callers map textures per material). */
  materialKeys: string[];
  camera: PathTraceCamera;
  light: FrameLight;
  environment: FrameEnvironment;
  bounds: Aabb;
}

// --- small vec helpers -------------------------------------------------------

type V3 = [number, number, number];
const sub3 = (a: Vec3, b: Vec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Vec3, b: Vec3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale3 = (a: Vec3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
function normalize3(v: Vec3): V3 {
  const len = Math.sqrt(dot3(v, v));
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [v[0], v[1], v[2]];
}

// --- packing -----------------------------------------------------------------

function materialKeyOf(materialKey: string | undefined): string {
  return materialKey ?? '__neutral__';
}

/**
 * Build the path-tracing storage buffers from a scene's GPU resources. Reuses
 * buildSceneFrame so the camera, light, environment and per-material surfaces are
 * exactly those the raster backend uses on the same assets.
 */
export function buildPathTraceScene(
  resources: SceneResources,
  options: BuildSceneFrameOptions = {},
): PathTraceScene {
  const frame = buildSceneFrame(resources, options);

  // Dedup material surfaces in first-seen draw order.
  const materialIndex = new Map<string, number>();
  const surfaces: RasterSurface[] = [];
  const materialKeys: string[] = [];
  const indexFor = (key: string, surface: RasterSurface): number => {
    const existing = materialIndex.get(key);
    if (existing !== undefined) return existing;
    const idx = surfaces.length;
    materialIndex.set(key, idx);
    surfaces.push(surface);
    materialKeys.push(key);
    return idx;
  };

  // World-space triangle soup: positions (9 floats/tri) and the packed triangle
  // records (positions + normals + material index) in matching original order.
  const soup: number[] = [];
  const triFloats: number[] = [];
  const uvFloats: number[] = [];
  let triCount = 0;

  for (const draw of frame.draws) {
    const geom = resources.geometries.get(draw.prototypeId);
    if (!geom) continue;
    const position = geom.streams.find((s) => s.name === 'position');
    if (!position) continue;
    const normal = geom.streams.find((s) => s.name === 'normal');
    const uv = geom.streams.find((s) => s.name === 'uv');
    const matIdx = indexFor(materialKeyOf(draw.materialKey), draw.surface);
    const model = draw.model;
    const idx = geom.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const ia = idx[t]!;
      const ib = idx[t + 1]!;
      const ic = idx[t + 2]!;
      const pa = transformPoint(model, readVec3(position.data, ia));
      const pb = transformPoint(model, readVec3(position.data, ib));
      const pc = transformPoint(model, readVec3(position.data, ic));
      let na: V3;
      let nb: V3;
      let nc: V3;
      if (normal) {
        na = normalize3(transformDirection(model, readVec3(normal.data, ia)));
        nb = normalize3(transformDirection(model, readVec3(normal.data, ib)));
        nc = normalize3(transformDirection(model, readVec3(normal.data, ic)));
      } else {
        const faceN = normalize3(cross3(sub3(pb, pa), sub3(pc, pa)));
        na = faceN;
        nb = faceN;
        nc = faceN;
      }
      soup.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pc[0], pc[1], pc[2]);
      const base = triCount * PT_TRIANGLE_FLOATS;
      triFloats[base + 0] = pa[0]; triFloats[base + 1] = pa[1]; triFloats[base + 2] = pa[2];
      triFloats[base + 3] = pb[0]; triFloats[base + 4] = pb[1]; triFloats[base + 5] = pb[2];
      triFloats[base + 6] = pc[0]; triFloats[base + 7] = pc[1]; triFloats[base + 8] = pc[2];
      triFloats[base + 9] = na[0]; triFloats[base + 10] = na[1]; triFloats[base + 11] = na[2];
      triFloats[base + 12] = nb[0]; triFloats[base + 13] = nb[1]; triFloats[base + 14] = nb[2];
      triFloats[base + 15] = nc[0]; triFloats[base + 16] = nc[1]; triFloats[base + 17] = nc[2];
      triFloats[base + 18] = matIdx;
      for (let p = 19; p < PT_TRIANGLE_FLOATS; p++) triFloats[base + p] = 0;
      const ub = triCount * 6;
      if (uv) {
        const ua = readVec2(uv.data, ia);
        const uvb = readVec2(uv.data, ib);
        const uc = readVec2(uv.data, ic);
        uvFloats[ub] = ua[0]; uvFloats[ub + 1] = ua[1];
        uvFloats[ub + 2] = uvb[0]; uvFloats[ub + 3] = uvb[1];
        uvFloats[ub + 4] = uc[0]; uvFloats[ub + 5] = uc[1];
      } else {
        for (let p = 0; p < 6; p++) uvFloats[ub + p] = 0;
      }
      triCount++;
    }
  }

  const positions = new Float32Array(soup);
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  const bvh: Bvh = buildBvh(positions, indices);

  const nodes = packNodes(bvh);
  const materials = packMaterials(surfaces);

  return {
    nodes,
    nodeCount: bvh.nodes.length,
    triangles: new Float32Array(triFloats),
    triangleOrder: bvh.triangleOrder,
    triangleCount: triCount,
    materials,
    materialCount: surfaces.length,
    triangleUv: new Float32Array(uvFloats),
    materialKeys,
    camera: {
      viewProj: frame.camera.viewProj,
      invViewProj: inverse4(frame.camera.viewProj),
      eye: frame.camera.eye,
      exposure: frame.camera.exposure,
    },
    light: frame.light,
    environment: frame.environment,
    bounds: bvh.bounds,
  };
}

function readVec3(data: Float32Array, vertex: number): V3 {
  const o = vertex * 3;
  return [data[o]!, data[o + 1]!, data[o + 2]!];
}

function readVec2(data: Float32Array, vertex: number): [number, number] {
  const o = vertex * 2;
  return [data[o]!, data[o + 1]!];
}

function packNodes(bvh: Bvh): Float32Array {
  const out = new Float32Array(bvh.nodes.length * PT_NODE_FLOATS);
  for (let i = 0; i < bvh.nodes.length; i++) {
    const n = bvh.nodes[i]!;
    const b = i * PT_NODE_FLOATS;
    out[b + 0] = n.min[0]; out[b + 1] = n.min[1]; out[b + 2] = n.min[2];
    out[b + 3] = n.left;
    out[b + 4] = n.max[0]; out[b + 5] = n.max[1]; out[b + 6] = n.max[2];
    out[b + 7] = n.right;
    out[b + 8] = n.start;
    out[b + 9] = n.count;
    out[b + 10] = 0;
    out[b + 11] = 0;
  }
  return out;
}

function packMaterials(surfaces: readonly RasterSurface[]): Float32Array {
  const out = new Float32Array(Math.max(surfaces.length, 1) * PT_MATERIAL_FLOATS);
  for (let i = 0; i < surfaces.length; i++) {
    // Lower the constant surface to a LayeredClosure and pack the flat record.
    // canonicalSurfaceToLayered is the T054 non-regression anchor, so the packed
    // record evaluates byte-for-byte like the former seven-parameter surface.
    out.set(packLayeredMaterial(canonicalSurfaceToLayered(surfaces[i]!)), i * PT_MATERIAL_FLOATS);
  }
  return out;
}

/** Read a packed material back into its LayeredClosure (round-trips the buffer, T057b). */
export function readLayeredClosure(scene: PathTraceScene, materialIndex: number): LayeredClosure {
  if (materialIndex < 0 || materialIndex >= scene.materialCount) {
    return canonicalSurfaceToLayered(NEUTRAL_SURFACE);
  }
  return unpackLayeredMaterial(scene.materials, materialIndex);
}

// --- reference sampler over the packed buffers --------------------------------

interface PtHit extends SurfaceHit {
  materialIndex: number;
}

interface TriHit {
  t: number;
  triangle: number;
  u: number;
  v: number;
}

const RAY_EPS = 1e-4;

function triIntersect(scene: PathTraceScene, tri: number, ray: Ray): { t: number; u: number; v: number } | null {
  const b = tri * PT_TRIANGLE_FLOATS;
  const d = scene.triangles;
  const v0: V3 = [d[b]!, d[b + 1]!, d[b + 2]!];
  const v1: V3 = [d[b + 3]!, d[b + 4]!, d[b + 5]!];
  const v2: V3 = [d[b + 6]!, d[b + 7]!, d[b + 8]!];
  const e1 = sub3(v1, v0);
  const e2 = sub3(v2, v0);
  const p = cross3(ray.direction, e2);
  const det = dot3(e1, p);
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  const tvec = sub3(ray.origin, v0);
  const u = dot3(tvec, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross3(tvec, e1);
  const v = dot3(ray.direction, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot3(e2, q) * inv;
  if (t <= RAY_EPS) return null;
  return { t, u, v };
}

function aabbHit(scene: PathTraceScene, node: number, ray: Ray, invDir: V3, tMax: number): boolean {
  const b = node * PT_NODE_FLOATS;
  const n = scene.nodes;
  let tmin = RAY_EPS;
  let tmax = tMax;
  for (let a = 0; a < 3; a++) {
    const lo = (n[b + a]! - ray.origin[a]!) * invDir[a]!;
    const hi = (n[b + 4 + a]! - ray.origin[a]!) * invDir[a]!;
    const near = Math.min(lo, hi);
    const far = Math.max(lo, hi);
    tmin = Math.max(tmin, near);
    tmax = Math.min(tmax, far);
    if (tmax < tmin) return false;
  }
  return true;
}

function traverse(scene: PathTraceScene, ray: Ray, tMax: number, anyHit: boolean): TriHit | null {
  if (scene.nodeCount === 0) return null;
  const invDir: V3 = [
    1 / (ray.direction[0] || 1e-20),
    1 / (ray.direction[1] || 1e-20),
    1 / (ray.direction[2] || 1e-20),
  ];
  const order = scene.triangleOrder;
  const stack: number[] = [0];
  let best: TriHit | null = null;
  let closest = tMax;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!aabbHit(scene, node, ray, invDir, closest)) continue;
    const b = node * PT_NODE_FLOATS;
    const left = scene.nodes[b + 3]!;
    const count = scene.nodes[b + 9]!;
    if (count > 0) {
      const start = scene.nodes[b + 8]!;
      for (let i = 0; i < count; i++) {
        const tri = order[start + i]!;
        const hit = triIntersect(scene, tri, ray);
        if (hit && hit.t < closest) {
          if (anyHit) return { t: hit.t, triangle: tri, u: hit.u, v: hit.v };
          closest = hit.t;
          best = { t: hit.t, triangle: tri, u: hit.u, v: hit.v };
        }
      }
    } else {
      stack.push(left);
      stack.push(scene.nodes[b + 7]!);
    }
  }
  return best;
}

function hitSurface(scene: PathTraceScene, hit: TriHit, ray: Ray): PtHit {
  const b = hit.triangle * PT_TRIANGLE_FLOATS;
  const d = scene.triangles;
  const w = 1 - hit.u - hit.v;
  const na: V3 = [d[b + 9]!, d[b + 10]!, d[b + 11]!];
  const nb: V3 = [d[b + 12]!, d[b + 13]!, d[b + 14]!];
  const nc: V3 = [d[b + 15]!, d[b + 16]!, d[b + 17]!];
  const normal = normalize3([
    na[0] * w + nb[0] * hit.u + nc[0] * hit.v,
    na[1] * w + nb[1] * hit.u + nc[1] * hit.v,
    na[2] * w + nb[2] * hit.u + nc[2] * hit.v,
  ]);
  const position: V3 = [
    ray.origin[0] + ray.direction[0] * hit.t,
    ray.origin[1] + ray.direction[1] * hit.t,
    ray.origin[2] + ray.direction[2] * hit.t,
  ];
  return { position, normal, materialIndex: d[b + 18]! };
}

/**
 * Expose the packed scene as the reference integrator's SceneSampler. BVH
 * traversal, ray/triangle math, surface closures (layeredSurfaceBsdf over the
 * unpacked LayeredClosure record) and the directional light all read the exact
 * buffers the WGSL compute shader consumes, so the CPU integrator is a faithful,
 * non-circular oracle for the GPU port.
 */
export function createSceneSampler(scene: PathTraceScene): SceneSampler {
  const lightDir = normalize3(scene.light.direction);
  // Scene-convention travel direction -> incident direction toward the light.
  const toLight = scale3(lightDir, -1);
  const radiance: V3 = [
    scene.light.color[0] * scene.light.intensity,
    scene.light.color[1] * scene.light.intensity,
    scene.light.color[2] * scene.light.intensity,
  ];
  const env = scene.environment.radiance;
  const hasEnv = env[0] > 0 || env[1] > 0 || env[2] > 0;

  function lobeFor(hit: SurfaceHit) {
    return layeredSurfaceBsdf(readLayeredClosure(scene, (hit as PtHit).materialIndex));
  }

  const sampler: SceneSampler = {
    intersect(ray: Ray): SurfaceHit | null {
      const hit = traverse(scene, ray, Infinity, false);
      return hit ? hitSurface(scene, hit, ray) : null;
    },
    sampleBsdf(hit: SurfaceHit, wo: Vec3, rng: Rng): BsdfSample | null {
      const s = sampleWorld(lobeFor(hit), hit.normal, wo, rng);
      if (!s) return null;
      return { direction: s.direction, value: s.value, pdf: s.pdf, specular: s.specular };
    },
    evalBsdf(hit: SurfaceHit, wo: Vec3, wi: Vec3) {
      return evalWorld(lobeFor(hit), hit.normal, wo, wi);
    },
    sampleLight(_hit: SurfaceHit): LightSample | null {
      // Single distant (delta) light: a fixed incident direction, unit pdf.
      return { direction: toLight, radiance, pdf: 1, distance: Infinity };
    },
    occluded(from: Vec3, direction: Vec3, distance: number): boolean {
      const origin: V3 = [
        from[0] + direction[0] * RAY_EPS,
        from[1] + direction[1] * RAY_EPS,
        from[2] + direction[2] * RAY_EPS,
      ];
      const tMax = Number.isFinite(distance) ? distance - RAY_EPS : Infinity;
      return traverse(scene, { origin, direction }, tMax, true) !== null;
    },
    // A directional delta light cannot be hit by BSDF sampling, so its MIS pdf is 0.
    lightPdf(): number {
      return 0;
    },
  };

  if (hasEnv) {
    sampler.environment = (): Vec3 => env;
  }
  return sampler;
}

/** Direct (next-event) lighting at a surface for the single distant light. */
export function directLighting(scene: PathTraceScene, hit: SurfaceHit, wo: Vec3): V3 {
  const sampler = createSceneSampler(scene);
  const ls = sampler.sampleLight(hit, () => 0.5);
  if (!ls || ls.pdf <= 0) return [0, 0, 0];
  if (sampler.occluded(hit.position, ls.direction, ls.distance)) return [0, 0, 0];
  const { value } = sampler.evalBsdf(hit, wo, ls.direction);
  const cos = Math.abs(dot3(hit.normal, ls.direction));
  return [
    (value[0] * ls.radiance[0] * cos) / ls.pdf,
    (value[1] * ls.radiance[1] * cos) / ls.pdf,
    (value[2] * ls.radiance[2] * cos) / ls.pdf,
  ];
}
