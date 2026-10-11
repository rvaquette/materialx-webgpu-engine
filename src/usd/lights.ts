// USD lights (plan sections 8, 9.4, T021). UsdLux lights are read into a
// renderer-neutral description: type, colour, intensity/exposure, normalization,
// optional colour temperature, and shape parameters per light kind. Texture and
// IES profile paths are RECORDED, not loaded, and never silently reinterpreted
// (plan section 9.4). Unknown light types are reported rather than guessed. The
// scene is static, so no time sampling is performed.

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { SceneAsset, ScenePrim } from '../scene/types.ts';
import { computeWorldTransforms, IDENTITY4, type Mat4 } from '../scene/transforms.ts';

export type LightType = 'sphere' | 'distant' | 'rect' | 'disk' | 'cylinder' | 'dome' | 'unknown';

export interface SceneLight {
  path: string;
  type: LightType;
  /** Original USD type name. */
  usdType: string;
  color: readonly [number, number, number];
  intensity: number;
  exposure: number;
  normalize: boolean;
  /** Only set when enableColorTemperature is true. */
  colorTemperature?: number;
  radius?: number;
  width?: number;
  height?: number;
  length?: number;
  /** Distant light angular diameter in degrees. */
  angle?: number;
  treatAsPoint?: boolean;
  /** Recorded asset path; not loaded. */
  textureFile?: string;
  /** Recorded IES photometric profile path; not loaded. */
  iesFile?: string;
  coneAngle?: number;
  coneSoftness?: number;
  /** World transform (column-major). */
  transform: Mat4;
}

export interface ImportLightsOptions {
  sink?: DiagnosticSink;
  /** Precomputed world transforms; recomputed from the scene when omitted. */
  transforms?: ReadonlyMap<string, Mat4>;
}

const TYPE_MAP: Record<string, LightType> = {
  SphereLight: 'sphere',
  DistantLight: 'distant',
  RectLight: 'rect',
  DiskLight: 'disk',
  CylinderLight: 'cylinder',
  DomeLight: 'dome',
};

function readNumber(prim: ScenePrim, name: string): number | undefined {
  const value = prim.attributes.get(name)?.value;
  return typeof value === 'number' ? value : undefined;
}

function readBool(prim: ScenePrim, name: string): boolean | undefined {
  const value = prim.attributes.get(name)?.value;
  return typeof value === 'boolean' ? value : undefined;
}

function readString(prim: ScenePrim, name: string): string | undefined {
  const value = prim.attributes.get(name)?.value;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readColor(prim: ScenePrim, name: string): [number, number, number] | undefined {
  const value = prim.attributes.get(name)?.value;
  if (Array.isArray(value) && value.length >= 3 && typeof value[0] === 'number') {
    return [value[0], value[1] as number, value[2] as number];
  }
  return undefined;
}

export function importLights(scene: SceneAsset, options: ImportLightsOptions = {}): SceneLight[] {
  const world = options.transforms ?? computeWorldTransforms(scene, options.sink);
  const lights: SceneLight[] = [];

  for (const [path, prim] of scene.prims) {
    const usdType = prim.typeName;
    if (usdType === undefined) continue;
    const mapped = TYPE_MAP[usdType];
    const isLight = mapped !== undefined || usdType.endsWith('Light');
    if (!isLight) continue;
    const type: LightType = mapped ?? 'unknown';
    if (type === 'unknown') {
      options.sink?.({ level: 'warning', message: `Unsupported light type ${usdType}`, detail: path });
    }

    const colorTemperature = readBool(prim, 'inputs:enableColorTemperature') ? readNumber(prim, 'inputs:colorTemperature') : undefined;
    const radius = readNumber(prim, 'inputs:radius');
    const width = readNumber(prim, 'inputs:width');
    const height = readNumber(prim, 'inputs:height');
    const lengthValue = readNumber(prim, 'inputs:length');
    const angle = readNumber(prim, 'inputs:angle');
    const treatAsPoint = readBool(prim, 'treatAsPoint');
    const textureFile = readString(prim, 'inputs:texture:file');
    const iesFile = readString(prim, 'inputs:shaping:ies:file');
    const coneAngle = readNumber(prim, 'inputs:shaping:cone:angle');
    const coneSoftness = readNumber(prim, 'inputs:shaping:cone:softness');

    if (textureFile !== undefined) {
      options.sink?.({ level: 'info', message: `Light texture referenced (not loaded) at ${path}`, detail: textureFile });
    }
    if (iesFile !== undefined) {
      options.sink?.({ level: 'info', message: `IES profile referenced (not loaded) at ${path}`, detail: iesFile });
    }

    lights.push({
      path,
      type,
      usdType,
      color: readColor(prim, 'inputs:color') ?? [1, 1, 1],
      intensity: readNumber(prim, 'inputs:intensity') ?? 1,
      exposure: readNumber(prim, 'inputs:exposure') ?? 0,
      normalize: readBool(prim, 'inputs:normalize') ?? false,
      ...(colorTemperature !== undefined ? { colorTemperature } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(lengthValue !== undefined ? { length: lengthValue } : {}),
      ...(angle !== undefined ? { angle } : {}),
      ...(treatAsPoint !== undefined ? { treatAsPoint } : {}),
      ...(textureFile !== undefined ? { textureFile } : {}),
      ...(iesFile !== undefined ? { iesFile } : {}),
      ...(coneAngle !== undefined ? { coneAngle } : {}),
      ...(coneSoftness !== undefined ? { coneSoftness } : {}),
      transform: world.get(path) ?? IDENTITY4,
    });
  }

  return lights;
}
