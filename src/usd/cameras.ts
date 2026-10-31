// USD cameras (plan sections 8, 9, T021). UsdGeomCamera prims are read into a
// renderer-neutral camera: projection, focal length and aperture (mm), clipping,
// depth-of-field parameters and exposure. The view matrix is the inverse of the
// prim's world transform; the projection matrix is derived from aperture/focal
// length. The scene is static, so no time sampling is performed.

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { AttributeValue, SceneAsset, ScenePrim } from '../scene/types.ts';
import { computeWorldTransforms, inverse4, perspective4, orthographic4, IDENTITY4, type Mat4 } from '../scene/transforms.ts';

export type Projection = 'perspective' | 'orthographic';

export interface SceneCamera {
  path: string;
  projection: Projection;
  /** Focal length in tenths of a scene unit (mm by USD convention). */
  focalLength: number;
  horizontalAperture: number;
  verticalAperture: number;
  horizontalApertureOffset: number;
  verticalApertureOffset: number;
  /** Near/far clipping distances. */
  clippingRange: readonly [number, number];
  fStop?: number;
  focusDistance?: number;
  exposure?: number;
  /** World transform (column-major). */
  transform: Mat4;
  /** View matrix, inverse of the world transform. */
  view: Mat4;
  /** Vertical field of view in radians (0 for orthographic). */
  fovY: number;
  aspectRatio: number;
  /** Projection matrix (column-major, WebGPU clip space). */
  projectionMatrix: Mat4;
  /** Horizontal FOV carried by converted .scene cameras, in degrees. */
  pathtracerFov?: number;
}

export function cameraFovY(camera: SceneCamera, aspect: number): number {
  return camera.pathtracerFov === undefined ? camera.fovY
    : 2 * Math.atan(Math.tan(camera.pathtracerFov * Math.PI / 360) / aspect);
}

export interface ImportCamerasOptions {
  sink?: DiagnosticSink;
  /** Precomputed world transforms; recomputed from the scene when omitted. */
  transforms?: ReadonlyMap<string, Mat4>;
}

// UsdGeomCamera defaults (35mm Academy aperture).
const DEFAULTS = {
  focalLength: 50,
  horizontalAperture: 20.955,
  verticalAperture: 15.2908,
  near: 1,
  far: 1_000_000,
};

function readNumber(prim: ScenePrim, name: string): number | undefined {
  const value = prim.attributes.get(name)?.value;
  return typeof value === 'number' ? value : undefined;
}

function readFloat2(prim: ScenePrim, name: string): [number, number] | undefined {
  const value: AttributeValue | undefined = prim.attributes.get(name)?.value;
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0], value[1]];
  }
  return undefined;
}

function readToken(prim: ScenePrim, name: string): string | undefined {
  const value = prim.attributes.get(name)?.value;
  return typeof value === 'string' ? value : undefined;
}

export function importCameras(scene: SceneAsset, options: ImportCamerasOptions = {}): SceneCamera[] {
  const world = options.transforms ?? computeWorldTransforms(scene, options.sink);
  const cameras: SceneCamera[] = [];

  for (const [path, prim] of scene.prims) {
    if (prim.typeName !== 'Camera') continue;

    const projection: Projection = readToken(prim, 'projection') === 'orthographic' ? 'orthographic' : 'perspective';
    const focalLength = readNumber(prim, 'focalLength') ?? DEFAULTS.focalLength;
    const horizontalAperture = readNumber(prim, 'horizontalAperture') ?? DEFAULTS.horizontalAperture;
    const verticalAperture = readNumber(prim, 'verticalAperture') ?? DEFAULTS.verticalAperture;
    const horizontalApertureOffset = readNumber(prim, 'horizontalApertureOffset') ?? 0;
    const verticalApertureOffset = readNumber(prim, 'verticalApertureOffset') ?? 0;
    const clippingRange = readFloat2(prim, 'clippingRange') ?? [DEFAULTS.near, DEFAULTS.far];
    const fStop = readNumber(prim, 'fStop');
    const focusDistance = readNumber(prim, 'focusDistance');
    const exposure = readNumber(prim, 'exposure');
    const pathtracerFov = readNumber(prim, 'pathtracer:fov');
    if (pathtracerFov !== undefined && (!Number.isFinite(pathtracerFov) || pathtracerFov <= 0 || pathtracerFov >= 180)) {
      throw new Error(`Invalid pathtracer:fov at ${path}; expected degrees between 0 and 180.`);
    }

    const transform = world.get(path) ?? IDENTITY4;
    const view = inverse4(transform);
    const aspectRatio = verticalAperture !== 0 ? horizontalAperture / verticalAperture : 1;
    const [near, far] = clippingRange;

    let fovY = 0;
    let projectionMatrix: Mat4;
    if (projection === 'orthographic') {
      // USD orthographic aperture is in tenths of a scene unit.
      const halfW = (horizontalAperture / 10) / 2;
      const halfH = (verticalAperture / 10) / 2;
      projectionMatrix = orthographic4(-halfW, halfW, -halfH, halfH, near, far);
    } else {
      fovY = 2 * Math.atan(verticalAperture / (2 * focalLength));
      projectionMatrix = perspective4(fovY, aspectRatio, near, far);
    }

    cameras.push({
      path,
      projection,
      focalLength,
      horizontalAperture,
      verticalAperture,
      horizontalApertureOffset,
      verticalApertureOffset,
      clippingRange,
      ...(fStop !== undefined ? { fStop } : {}),
      ...(focusDistance !== undefined ? { focusDistance } : {}),
      ...(exposure !== undefined ? { exposure } : {}),
      transform,
      view,
      fovY,
      aspectRatio,
      projectionMatrix,
      ...(pathtracerFov !== undefined ? { pathtracerFov } : {}),
    });
  }

  return cameras;
}
