// T035c3: shade the shared visibility samples (T035c2) into two linear HDR
// buffers per control scene. (a) The raster buffer is a CPU mirror of
// src/render/raster/shaders.ts (Lambert + ambient over an effective diffuse
// albedo); the host is assumed to upload that albedo and a light colour already
// divided by pi, which the scene's intensity = pi makes unity. (b) The path
// tracing buffer runs the reference integrator (src/render/pathtracing/
// integrator.ts) over an analytic single-point SceneSampler: a cosine Lambert
// BSDF, a delta directional light via next-event estimation, and a constant
// environment, seeded for determinism. Both read identical geometry so T035c4
// can compare them fairly; shared material parameters come from the extracted
// scene-materials.json fixture.
import {
  integratePath,
  createPcg32,
  type Ray,
  type Rng,
  type SceneSampler,
  type SurfaceHit,
  type BsdfSample,
  type LightSample,
} from '../../src/render/pathtracing/integrator.ts';
import type { Vec3 } from '../../src/scene/transforms.ts';
import type { ShadingSample, SampleGrid } from './scene-samples.ts';

type V3 = [number, number, number];

const INV_PI = 1 / Math.PI;
const AMBIENT = 0.03;
// A directional light is a delta distribution; a large sampling pdf drives the
// integrator's MIS weight to 1 while the premultiplied radiance divides it back.
const LIGHT_PDF = 1e12;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normalize(a: V3): V3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
}

/** Branchless orthonormal basis (Duff et al. 2017) around a unit normal. */
function basis(n: V3): [V3, V3] {
  const s = n[2] >= 0 ? 1 : -1;
  const a = -1 / (s + n[2]);
  const b = n[0] * n[1] * a;
  return [
    [1 + s * n[0] * n[0] * a, s * b, -s * n[0]],
    [b, s + n[1] * n[1] * a, -n[1]],
  ];
}

export interface CanonMaterial {
  readonly family: string;
  readonly focus: readonly string[];
  readonly baseColor: V3;
  readonly metalness: number;
  readonly roughness: number;
  readonly transmission: number;
  readonly subsurface: number;
  readonly ior: number;
  readonly specular: number;
}

export interface SceneLight {
  /** Direction the light travels (scene convention). */
  readonly direction: Vec3;
  readonly color: Vec3;
  readonly intensity: number;
}

export interface SceneBuffers {
  readonly width: number;
  readonly height: number;
  /** Linear HDR rgb, row-major, 3 floats per pixel; misses are zero. */
  readonly raster: Float32Array;
  readonly pathtracing: Float32Array;
  /** 1 where the primary ray hit the shader ball, else 0. */
  readonly mask: Uint8Array;
}

/** Diffuse albedo shared by both backends: base colour minus metal/transmission. */
export function effectiveAlbedo(material: CanonMaterial): V3 {
  const k = (1 - material.metalness) * (1 - material.transmission);
  return [material.baseColor[0] * k, material.baseColor[1] * k, material.baseColor[2] * k];
}

/** CPU mirror of forwardOpaqueWgsl: albedo * (ambient + lightColor * n.l). */
export function rasterShade(sample: ShadingSample, albedo: V3, light: SceneLight): V3 {
  const toLight = normalize(neg([light.direction[0], light.direction[1], light.direction[2]]));
  const lc = scale([light.color[0], light.color[1], light.color[2]], light.intensity / Math.PI);
  const ndotl = Math.max(dot(sample.normal, toLight), 0);
  return [
    albedo[0] * (AMBIENT + lc[0] * ndotl),
    albedo[1] * (AMBIENT + lc[1] * ndotl),
    albedo[2] * (AMBIENT + lc[2] * ndotl),
  ];
}

/** Analytic single-point scene for the reference integrator. */
function pointSampler(hit: SurfaceHit, albedo: V3, light: SceneLight, environment: V3): SceneSampler {
  let primaryConsumed = false;
  const toLight = normalize(neg([light.direction[0], light.direction[1], light.direction[2]]));
  const radiance = scale([light.color[0], light.color[1], light.color[2]], light.intensity);
  const diffuse = scale(albedo, INV_PI);
  return {
    intersect(_ray: Ray): SurfaceHit | null {
      if (!primaryConsumed) {
        primaryConsumed = true;
        return hit;
      }
      return null;
    },
    sampleBsdf(h: SurfaceHit, _wo: Vec3, rng: Rng): BsdfSample | null {
      const u1 = rng();
      const phi = 2 * Math.PI * rng();
      const r = Math.sqrt(u1);
      const cosT = Math.sqrt(Math.max(0, 1 - u1));
      const n = h.normal as V3;
      const [t, b] = basis(n);
      const direction = normalize(
        add(add(scale(t, r * Math.cos(phi)), scale(b, r * Math.sin(phi))), scale(n, cosT)),
      );
      return { direction, value: diffuse, pdf: cosT * INV_PI };
    },
    evalBsdf(h: SurfaceHit, wo: Vec3, wi: Vec3): { value: Vec3; pdf: number } {
      const nl = dot(h.normal as V3, wi as V3);
      const nv = dot(h.normal as V3, wo as V3);
      if (nl > 0 && nv > 0) return { value: diffuse, pdf: nl * INV_PI };
      return { value: [0, 0, 0], pdf: 0 };
    },
    sampleLight(_h: SurfaceHit, _rng: Rng): LightSample | null {
      return { direction: toLight, radiance: scale(radiance, LIGHT_PDF), pdf: LIGHT_PDF, distance: Infinity };
    },
    occluded(): boolean {
      return false;
    },
    lightPdf(): number {
      return 0;
    },
    environment(_direction: Vec3): Vec3 {
      return environment;
    },
  };
}

/** Reference radiance for one sample via the path tracing integrator. */
export function pathTraceShade(
  sample: ShadingSample,
  albedo: V3,
  light: SceneLight,
  environment: V3,
  rng: Rng,
  spp = 1,
): V3 {
  const hit: SurfaceHit = { position: sample.position, normal: sample.normal };
  const cameraRay: Ray = { origin: sample.position, direction: neg(sample.viewDir) };
  const acc: V3 = [0, 0, 0];
  for (let k = 0; k < spp; k++) {
    const r = integratePath(pointSampler(hit, albedo, light, environment), cameraRay, rng);
    acc[0] += r[0];
    acc[1] += r[1];
    acc[2] += r[2];
  }
  return [acc[0] / spp, acc[1] / spp, acc[2] / spp];
}

/** Shade a whole sample grid into raster and path-tracing HDR buffers. */
export function shadeSceneBuffers(
  grid: SampleGrid,
  material: CanonMaterial,
  light: SceneLight,
  environment: V3,
  seed: number,
  spp = 1,
): SceneBuffers {
  const { width, height, samples } = grid;
  const raster = new Float32Array(width * height * 3);
  const pathtracing = new Float32Array(width * height * 3);
  const mask = new Uint8Array(width * height);
  const albedo = effectiveAlbedo(material);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (!s.hit) continue;
    mask[i] = 1;
    const rc = rasterShade(s, albedo, light);
    const rng = createPcg32(seed + i * 9781);
    const pc = pathTraceShade(s, albedo, light, environment, rng, spp);
    const o = i * 3;
    raster[o] = rc[0];
    raster[o + 1] = rc[1];
    raster[o + 2] = rc[2];
    pathtracing[o] = pc[0];
    pathtracing[o + 1] = pc[1];
    pathtracing[o + 2] = pc[2];
  }
  return { width, height, raster, pathtracing, mask };
}
