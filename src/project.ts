import { OrbitCamera } from './scene/orbit-camera.ts';
import type { ViewerSnapshot } from './render/viewer.ts';
import { isStoredMaterialVariant, type StoredMaterialVariant } from './render/material-variant-snapshot.ts';
import type { EnvironmentShaderSettings, ImageShaderSettings } from './materialx/engine-shaders.ts';
import { PATH_TRACE_VIEWS } from './render/pathtracing/display.ts';

type SceneSnapshot = NonNullable<ViewerSnapshot['scene']>;
type Camera = {
  eye: number[]; target: number[]; distance: number; fovY: number; near: number; far: number;
  projection: 'perspective' | 'orthographic';
};

export interface Project {
  format: 'materialx-webgpu-project';
  version: 1;
  script: string;
  stage: { usda: string; materials: Array<[string, string]> };
  overrides: Array<[string, { xml: string; materialName: string }]>;
  materials: Array<[string, StoredMaterialVariant]>;
  scene: {
    time: number; camera: Camera;
    transforms: Array<[string, number[]]>;
    visibility: Array<[string, boolean]>;
    lights: Array<[string, SceneSnapshot['lights'] extends ReadonlyMap<string, infer T> ? T : never]>;
  };
  settings: ViewerSnapshot['settings'];
  shaders: { environment?: EnvironmentShaderSettings; image?: ImageShaderSettings };
  resolution: number | '1024x768';
  memoryBudget: number | null;
  objectPath: string;
}

function fail(message: string): never { throw new Error(`Projet : ${message}`); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function vector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(finite);
}
function pairs(value: unknown, check: (v: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(pair => Array.isArray(pair) && pair.length === 2
    && typeof pair[0] === 'string' && pair[0].length > 0 && check(pair[1]))
    && new Set(value.map(pair => pair[0])).size === value.length;
}
function oneOf(value: unknown, choices: readonly unknown[]): boolean { return choices.includes(value); }

/** The supported subset deliberately excludes assets which would need packaging. */
export function validateProject(project: unknown): asserts project is Project {
  if (!record(project) || project.format !== 'materialx-webgpu-project' || project.version !== 1) fail('format ou version non pris en charge.');
  if (typeof project.script !== 'string' || typeof project.objectPath !== 'string' || !record(project.stage)
    || typeof project.stage.usda !== 'string' || !pairs(project.stage.materials, v => typeof v === 'string')) fail('scène ou script invalide.');
  const stage = project.stage as Project['stage'];
  const materialPaths = new Set(stage.materials.map(([path]) => path));
  if (stage.usda.split(/\r?\n/).some(line => {
    if (!line.includes('@')) return false;
    const ref = /^\s*prepend references = @([^@]+)@<\/MaterialX\/Materials\/[^>]+>\s*$/.exec(line);
    return !ref || !materialPaths.has(ref[1]!);
  })
    || /(?:subLayers|payload)\s*=/.test(stage.usda)) fail('dépendance USD externe non prise en charge.');
  const checkXml = (xml: string): void => {
    if (/&(?:#\d+|#x[\da-f]+|[a-z][\w.-]*);|<!DOCTYPE|<!ENTITY|<\s*(?:\w+:)?include\b|\b(?:href|file)\s*=|\btype\s*=\s*['"]filename['"]/i.test(xml)) {
      fail('textures, inclusions et autres dépendances MaterialX externes non prises en charge.');
    }
  };
  stage.materials.forEach(([, xml]) => checkXml(xml));
  if (!pairs(project.overrides, v => record(v) && typeof v.xml === 'string' && typeof v.materialName === 'string' && !!v.materialName)) fail('matériaux assignés invalides.');
  for (const [, override] of project.overrides as Project['overrides']) checkXml(override.xml);
  if (!pairs(project.materials, isStoredMaterialVariant)) fail('graphes de matériaux invalides.');
  for (const [, material] of project.materials as Project['materials']) {
    if (material.graph.nodes.some(node => typeof node.category !== 'string'
      || node.inputs.some(input => !record(input) || typeof input.type !== 'string')
      || node.inputs.some(input => input.type === 'filename')
      || /^(?:image|tiledimage|environment)$/i.test(node.category))) fail('textures dans les graphes non prises en charge.');
  }
  if (!record(project.scene) || !finite(project.scene.time) || !record(project.scene.camera)) fail('état de scène invalide.');
  const scene = project.scene;
  const camera = scene.camera as Record<string, unknown>;
  if (!vector(camera.eye, 3) || !vector(camera.target, 3) || !finite(camera.distance) || camera.distance <= 0
    || !finite(camera.fovY) || camera.fovY <= 0 || camera.fovY >= Math.PI
    || !finite(camera.near) || camera.near <= 0 || !finite(camera.far) || camera.far <= camera.near
    || !oneOf(camera.projection, ['perspective', 'orthographic'])) fail('caméra invalide.');
  if (!pairs(scene.transforms, v => vector(v, 16)) || !pairs(scene.visibility, v => typeof v === 'boolean')
    || !pairs(scene.lights, v => record(v) && Object.keys(v).every(key => {
      const x = v[key];
      return key === 'color' ? vector(x, 3) : key === 'transform' ? vector(x, 16)
        : (key === 'intensity' || key === 'exposure') && finite(x);
    }))) fail('modifications de scène invalides.');
  if (!record(project.settings) || !record(project.settings.limits)) fail('réglages invalides.');
  const s = project.settings;
  const l = s.limits as Record<string, unknown>;
  if (!oneOf(s.backend, ['raster', 'pathtracing', 'disney']) || !oneOf(s.rasterQuality, ['interactive', 'reference'])
    || !oneOf(s.view, PATH_TRACE_VIEWS.map(view => view.value)) || !oneOf(s.tonemap, ['none', 'reinhard', 'acesFilmic'])
    || !['denoise', 'adaptive', 'environmentEnabled', 'paused'].every(key => typeof s[key] === 'boolean')
    || (s.depth !== undefined && (!finite(s.depth) || s.depth < 1 || s.depth > 64))
    || (s.exposure !== undefined && !finite(s.exposure)) || !finite(s.temporalHistory)
    || typeof l.stopOnConvergence !== 'boolean' || !finite(l.timeBudgetSeconds) || l.timeBudgetSeconds < 0
    || !finite(l.targetRelativeError) || l.targetRelativeError <= 0) fail('réglages de rendu invalides.');
  if (!oneOf(project.resolution, ['1024x768', 128, 256, 512, 1024])) fail('résolution invalide.');
  if (project.memoryBudget !== null && (!finite(project.memoryBudget) || project.memoryBudget <= 0)) fail('budget mémoire invalide.');
  if (!record(project.shaders)) fail('shaders invalides.');
  const env = project.shaders.environment;
  const image = project.shaders.image;
  if (env !== undefined && (!record(env) || !oneOf(env.model, ['gradient', 'sky', 'studio'])
    || !['zenithColor', 'horizonColor', 'groundColor', 'sunColor', 'sunDirection'].every(key => vector(env[key], 3))
    || !['sunIntensity', 'sunAngularDiameter', 'exposure', 'rotation', 'animationSpeed'].every(key => finite(env[key])))) fail('environnement invalide.');
  if (image !== undefined && (!record(image) || !['exposure', 'contrast', 'saturation', 'vignette'].every(key => finite(image[key])))) fail('post-traitement invalide.');
}

export function encodeProject(project: Project): string {
  // JSON.stringify silently loses Maps, typed arrays, non-finite numbers and runtime objects.
  const json = JSON.stringify(project, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('nombre non fini.');
    if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('objet runtime non sérialisable.');
    return value;
  });
  validateProject(JSON.parse(json));
  return json;
}

export function decodeProject(json: string): Project {
  let value: unknown;
  try { value = JSON.parse(json); } catch { return fail('JSON invalide.'); }
  validateProject(value);
  return value;
}

export function projectCamera(orbit: OrbitCamera): Camera {
  return { eye: orbit.eye, target: [...orbit.target], distance: orbit.distance, fovY: orbit.fovY,
    near: orbit.near, far: orbit.far, projection: orbit.projection };
}

export function restoreCamera(camera: Camera, aspect: number): OrbitCamera {
  const orbit = OrbitCamera.fromEyeTarget(camera.eye as [number, number, number], camera.target as [number, number, number],
    aspect, camera.fovY, camera.near, camera.far);
  orbit.distance = camera.distance;
  orbit.projection = camera.projection;
  return orbit;
}
