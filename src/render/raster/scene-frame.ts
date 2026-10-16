// Raster scene frame assembler (plan section 9, T051). Turns the device-neutral
// SceneResources (T050, src/render/scene-resources.ts) plus the imported USD
// cameras and lights into a flat, GPU-free render plan the executable raster
// backend consumes: a camera uniform (view-projection + eye), a dominant
// directional light, a constant environment radiance, and a per-instance draw
// list sorted into the effectively-active passes (opaque, transmission). Each
// draw carries the instance model matrix and the OpenPBR surface constants the
// material chain resolved; a material whose effective passes include transmission
// (or whose surface transmits) is routed to the transmission pass. Instances
// without uploaded geometry are reported as skipped rather than dropped. This
// module is pure and Node-testable; the actual GPUBuffer/bind-group wiring lives
// in the browser bootstrap (src/main.ts) and the backend (backend.ts).

import type { ScenePassKind } from './backend.ts';
import type { MaterialResource, SceneResources } from '../scene-resources.ts';
import type { SceneCamera } from '../../usd/cameras.ts';
import type { SceneLight } from '../../usd/lights.ts';
import { multiply4, transformDirection, type Mat4, type Vec3 } from '../../scene/transforms.ts';

/** OpenPBR surface constants consumed by the analytic raster fragment shader. */
export interface RasterSurface {
  baseColor: Vec3;
  metalness: number;
  roughness: number;
  transmission: number;
  subsurface: number;
  ior: number;
  specular: number;
}

/** Neutral dielectric used when a material exposes no resolved surface constants. */
export const NEUTRAL_SURFACE: RasterSurface = {
  baseColor: [0.8, 0.8, 0.8],
  metalness: 0,
  roughness: 0.5,
  transmission: 0,
  subsurface: 0,
  ior: 1.5,
  specular: 1,
};

export interface FrameCamera {
  viewProj: Mat4;
  eye: Vec3;
  exposure: number;
}

export interface FrameLight {
  /** Scene-convention travel direction; the shader lights with L = -direction. */
  direction: Vec3;
  color: Vec3;
  intensity: number;
}

export interface FrameEnvironment {
  /** Flat ambient radiance (DC term): the average env colour when textured, or a
   *  dim constant otherwise. The analytic raster forward shader reflects this. */
  radiance: Vec3;
  /** Dome tint applied to the sampled envmap (defaults to white). */
  tint?: Vec3;
  /** Dome intensity * 2^exposure; folded into env.w for the textured path. */
  intensity?: number;
  /** True when an equirectangular envmap texture backs this environment. */
  hasTexture?: boolean;
  /** Equirect envmap width/height and the total luminance sum of its flat CDF, used
   *  by the path tracer's environment importance sampling (absent = cosine fallback). */
  envResX?: number;
  envResY?: number;
  envTotalSum?: number;
}

export interface SceneDraw {
  instanceId: string;
  prototypeId: string;
  pass: ScenePassKind;
  model: Mat4;
  surface: RasterSurface;
  materialKey?: string;
}

export interface SceneFramePlan {
  camera: FrameCamera;
  light: FrameLight;
  environment: FrameEnvironment;
  draws: readonly SceneDraw[];
  /** Active pass kinds present in the draw list, opaque first. */
  passes: readonly ScenePassKind[];
  /** Instance ids with no uploaded geometry (reported, not rendered). */
  skipped: readonly string[];
}

export interface BuildSceneFrameOptions {
  camera?: SceneCamera;
  /** Precomputed camera uniform; takes precedence over `camera` (canvas aspect). */
  frameCamera?: FrameCamera;
  lights?: readonly SceneLight[];
  environment?: FrameEnvironment;
  /** Maps a compiled material to its raster surface constants (defaults neutral). */
  surfaceFor?: (material: MaterialResource) => RasterSurface;
}

const DEFAULT_CAMERA: FrameCamera = {
  // Identity view, a mild perspective is applied by the caller's default camera;
  // this fallback keeps the scene visible when no UsdGeomCamera is present.
  viewProj: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2, 1],
  eye: [0, 0, 2],
  exposure: 0,
};

const DEFAULT_LIGHT: FrameLight = {
  direction: [0.3, 0.5, 0.8],
  color: [1, 1, 1],
  intensity: 1,
};

const DEFAULT_ENVIRONMENT: FrameEnvironment = { radiance: [0.03, 0.03, 0.03] };

/** Camera uniform from a UsdGeomCamera: viewProj = projection * view, eye = origin. */
export function cameraFrom(camera: SceneCamera): FrameCamera {
  const viewProj = multiply4(camera.projectionMatrix, camera.view);
  const t = camera.transform;
  return {
    viewProj,
    eye: [t[12] ?? 0, t[13] ?? 0, t[14] ?? 0],
    exposure: camera.exposure ?? 0,
  };
}

/** Dominant directional light: prefers a DistantLight, else the first usable light. */
export function directionalLightFrom(lights: readonly SceneLight[]): FrameLight {
  const distant = lights.find((l) => l.type === 'distant');
  const chosen = distant ?? lights.find((l) => l.type !== 'dome');
  if (!chosen) return DEFAULT_LIGHT;
  // USD lights emit along local -Z; the travel direction is that axis in world.
  const dir = transformDirection(chosen.transform, [0, 0, -1]);
  return {
    direction: dir,
    color: chosen.color,
    intensity: chosen.intensity * Math.pow(2, chosen.exposure),
  };
}

/** Constant environment radiance from a DomeLight, else a dim ambient. */
export function environmentFrom(lights: readonly SceneLight[]): FrameEnvironment {
  const dome = lights.find((l) => l.type === 'dome');
  if (!dome) return DEFAULT_ENVIRONMENT;
  const scale = dome.intensity * Math.pow(2, dome.exposure);
  return { radiance: [dome.color[0] * scale, dome.color[1] * scale, dome.color[2] * scale] };
}

/** Routes a draw to the transmission pass when its material transmits. */
function passFor(material: MaterialResource | undefined, surface: RasterSurface): ScenePassKind {
  const transmits = material?.features.passes.some((p) => p.kind === 'transmission') ?? false;
  return transmits || surface.transmission > 0 ? 'transmission' : 'opaque';
}

/**
 * Assemble the raster render plan for a scene. Only instances with uploaded
 * geometry become draws; the rest are reported in `skipped`.
 */
export function buildSceneFrame(resources: SceneResources, options: BuildSceneFrameOptions = {}): SceneFramePlan {
  const camera = options.frameCamera ?? (options.camera ? cameraFrom(options.camera) : DEFAULT_CAMERA);
  const lights = options.lights ?? [];
  const light = directionalLightFrom(lights);
  const environment = options.environment ?? environmentFrom(lights);
  const surfaceFor = options.surfaceFor ?? (() => NEUTRAL_SURFACE);

  const draws: SceneDraw[] = [];
  const skipped: string[] = [];
  let hasOpaque = false;
  let hasTransmission = false;

  for (const inst of resources.instances) {
    if (!inst.hasGeometry) {
      skipped.push(inst.id);
      continue;
    }
    const material = inst.materialKey ? resources.materials.get(inst.materialKey) : undefined;
    const surface = material ? surfaceFor(material) : NEUTRAL_SURFACE;
    const pass = passFor(material, surface);
    if (pass === 'transmission') hasTransmission = true;
    else hasOpaque = true;
    draws.push({
      instanceId: inst.id,
      prototypeId: inst.prototypeId,
      pass,
      model: inst.transform,
      surface,
      ...(inst.materialKey !== undefined ? { materialKey: inst.materialKey } : {}),
    });
  }

  const passes: ScenePassKind[] = [];
  if (hasOpaque) passes.push('opaque');
  if (hasTransmission) passes.push('transmission');

  return { camera, light, environment, draws, passes, skipped };
}

/** Floats in a scene forward frame uniform (SCENE_FRAME_UNIFORM_SIZE / 4). */
export const SCENE_FRAME_UNIFORM_FLOATS = 48;
/** Floats in a scene forward material uniform (SCENE_MATERIAL_UNIFORM_SIZE / 4). */
export const SCENE_MATERIAL_UNIFORM_FLOATS = 12;

/**
 * Pack one instance's per-frame uniform (T058c): model, camera view-projection +
 * eye, the dominant light and the constant environment radiance. Layout matches
 * the IR forward shader's Frame struct (ir-forward.ts) and SCENE_FRAME_UNIFORM_SIZE.
 * The model matrix is per-draw; the remaining blocks are shared by every instance.
 */
export function buildSceneFrameUniform(frame: SceneFramePlan, draw: SceneDraw): Float32Array {
  const d = new Float32Array(SCENE_FRAME_UNIFORM_FLOATS);
  d.set(draw.model, 0);
  d.set(frame.camera.viewProj, 16);
  d.set([frame.camera.eye[0], frame.camera.eye[1], frame.camera.eye[2], 0], 32);
  d.set([frame.light.direction[0], frame.light.direction[1], frame.light.direction[2], 0], 36);
  d.set([frame.light.color[0], frame.light.color[1], frame.light.color[2], frame.light.intensity], 40);
  d.set([frame.environment.radiance[0], frame.environment.radiance[1], frame.environment.radiance[2], 0], 44);
  return d;
}

/**
 * Pack one draw's material uniform (T058c): the resolved OpenPBR surface at the
 * @group(0) @binding(0) slot a compiled variant's MxUniforms will later occupy.
 * Layout matches the IR forward shader's Material struct (ir-forward.ts) and
 * SCENE_MATERIAL_UNIFORM_SIZE.
 */
export function buildSceneMaterialUniform(draw: SceneDraw): Float32Array {
  const d = new Float32Array(SCENE_MATERIAL_UNIFORM_FLOATS);
  const s = draw.surface;
  d.set([s.baseColor[0], s.baseColor[1], s.baseColor[2], 1], 0);
  d.set([s.metalness, s.roughness, s.transmission, s.subsurface], 4);
  d.set([s.ior, s.specular, 0, 0], 8);
  return d;
}
