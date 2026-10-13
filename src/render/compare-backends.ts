// Raster vs path-tracing comparison (plan section 9, P9, T052). Both backends are
// fed from the SAME SceneResources (T050) and the SAME buildSceneFrame derivation
// (camera, dominant light, environment, per-material OpenPBR surfaces), so the
// only thing that changes between a raster and a path-traced render is the
// integrator -- no reimport. This module asserts that shared-asset identity and
// cross-checks the two shading paths on a diffuse ground truth, where the raster
// OpenPBR reference (src/render/bsdf/reference.ts) and the path tracer's surface
// closure (src/render/pathtracing/bsdf.ts) provably coincide: a pure Lambert
// surface at normal incidence reduces both to baseColor/pi * radiance. Glossy and
// metallic lobes use independent raster vs path-tracing models and are compared
// structurally, not numerically. Pure and Node-testable.

import type { Vec3 } from '../scene/transforms.ts';
import type { SceneResources } from './scene-resources.ts';
import { buildSceneFrame, type BuildSceneFrameOptions, type FrameLight } from './raster/scene-frame.ts';
import { buildPathTraceScene } from './pathtracing/scene-buffers.ts';
import {
  evaluateSurface,
  type CanonicalSurfaceParams,
  type ReferenceLighting,
  type ShadingGeometry,
} from './bsdf/reference.ts';
import { evalWorld, surfaceBsdf } from './pathtracing/bsdf.ts';

export interface DiffuseProbe {
  /** Raster OpenPBR reference radiance for the probe surface. */
  raster: Vec3;
  /** Path-tracing direct radiance for the same probe surface and light. */
  pathtracing: Vec3;
  maxAbsDiff: number;
  agree: boolean;
}

export interface BackendComparison {
  /** Instances the raster backend draws (geometry present). */
  rasterDraws: number;
  /** Triangles the path tracer traverses for the same scene. */
  pathTraceTriangles: number;
  /** Distinct OpenPBR surfaces shared by both backends. */
  materialCount: number;
  /** Raster and path-tracing cameras match (same view-projection + eye). */
  sharedCamera: boolean;
  /** Raster and path-tracing dominant lights match. */
  sharedLight: boolean;
  /** Diffuse ground-truth cross-check of the two shading paths. */
  diffuseProbe: DiffuseProbe;
}

export interface CompareBackendsOptions extends BuildSceneFrameOptions {
  /** Albedo of the diffuse comparison probe (defaults to a mid tan). */
  probeBaseColor?: Vec3;
  /** Agreement tolerance for the diffuse probe (defaults to 1e-5). */
  probeTolerance?: number;
}

const DEFAULT_PROBE: Vec3 = [0.8, 0.6, 0.4];

function vecClose(a: Vec3, b: Vec3, eps: number): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
}

function matClose(a: readonly number[], b: readonly number[], eps: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > eps) return false;
  }
  return true;
}

function lightsClose(a: FrameLight, b: FrameLight, eps: number): boolean {
  return (
    vecClose(a.direction, b.direction, eps) &&
    vecClose(a.color, b.color, eps) &&
    Math.abs(a.intensity - b.intensity) <= eps
  );
}

/**
 * Diffuse ground-truth probe: a pure Lambert surface at normal incidence under a
 * single distant light with no ambient. The raster reference and the path tracer
 * must both reduce to baseColor/pi * lightColor*intensity, so the two shading
 * paths can be compared numerically regardless of their independent glossy models.
 */
export function diffuseProbe(baseColor: Vec3, light: FrameLight, tolerance = 1e-5): DiffuseProbe {
  const probe: CanonicalSurfaceParams = {
    baseColor,
    metalness: 0,
    roughness: 0,
    transmission: 0,
    subsurface: 0,
    ior: 1.5,
    specular: 0,
  };
  const geom: ShadingGeometry = { normal: [0, 0, 1], view: [0, 0, 1] };
  const lighting: ReferenceLighting = {
    environment: [0, 0, 0],
    lights: [{ direction: [0, 0, -1], color: light.color, intensity: light.intensity }],
  };
  const raster = evaluateSurface(probe, geom, lighting).color;

  const lobe = surfaceBsdf(probe);
  const toLight: Vec3 = [0, 0, 1];
  const ev = evalWorld(lobe, [0, 0, 1], [0, 0, 1], toLight);
  const radiance: Vec3 = [
    light.color[0] * light.intensity,
    light.color[1] * light.intensity,
    light.color[2] * light.intensity,
  ];
  // Normal incidence: cos(N, L) = 1; delta light pdf = 1.
  const pathtracing: Vec3 = [
    ev.value[0] * radiance[0],
    ev.value[1] * radiance[1],
    ev.value[2] * radiance[2],
  ];
  const maxAbsDiff = Math.max(
    Math.abs(raster[0] - pathtracing[0]),
    Math.abs(raster[1] - pathtracing[1]),
    Math.abs(raster[2] - pathtracing[2]),
  );
  return { raster, pathtracing, maxAbsDiff, agree: maxAbsDiff <= tolerance };
}

/**
 * Build both backends from one SceneResources and report shared-asset identity
 * plus the diffuse ground-truth agreement. Proves a scene renders under either
 * backend on the same assets with no reimport.
 */
export function compareSceneBackends(
  resources: SceneResources,
  options: CompareBackendsOptions = {},
): BackendComparison {
  const frame = buildSceneFrame(resources, options);
  const ptScene = buildPathTraceScene(resources, options);

  const sharedCamera =
    matClose(frame.camera.viewProj, ptScene.camera.viewProj, 1e-9) &&
    vecClose(frame.camera.eye, ptScene.camera.eye, 1e-9);
  const sharedLight = lightsClose(frame.light, ptScene.light, 1e-9);

  const probe = diffuseProbe(
    options.probeBaseColor ?? DEFAULT_PROBE,
    frame.light,
    options.probeTolerance ?? 1e-5,
  );

  return {
    rasterDraws: frame.draws.length,
    pathTraceTriangles: ptScene.triangleCount,
    materialCount: ptScene.materialCount,
    sharedCamera,
    sharedLight,
    diffuseProbe: probe,
  };
}
