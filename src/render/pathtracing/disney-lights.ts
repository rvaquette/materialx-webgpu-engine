import type { SceneLight } from '../../usd/lights.ts';
import { transformDirection, transformPoint, type Vec3 } from '../../scene/transforms.ts';

export interface DisneyLightData {
  /** Exactly five vec4 records per light; one zero record is supplied when empty. */
  data: Float32Array;
  count: number;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

/** Convert supported USD rect, sphere and distant lights to the Disney shader's five-texel records. */
export function packDisneyLights(lights: readonly SceneLight[]): DisneyLightData {
  const selected = lights.filter(light => light.type !== 'dome');
  const data = new Float32Array(Math.max(1, selected.length) * 20);
  selected.forEach((light, index) => {
    if (!['rect', 'sphere', 'distant'].includes(light.type) || light.textureFile || light.iesFile ||
        light.colorTemperature !== undefined || light.treatAsPoint || light.coneAngle !== undefined ||
        light.coneSoftness !== undefined || light.innerAngle !== undefined || light.outerAngle !== undefined) {
      throw new Error(`Unsupported Disney light at ${light.path}: ${light.type} or light shaping.`);
    }
    if (![...light.transform, ...light.color, light.intensity, light.exposure].every(Number.isFinite) ||
        light.intensity < 0 || light.color.some(channel => channel < 0)) {
      throw new Error(`Invalid Disney light values at ${light.path}.`);
    }

    let position: Vec3;
    let u: Vec3 = [0, 0, 0];
    let v: Vec3 = [0, 0, 0];
    let radius = 0;
    let area = 0;
    let kind: 0 | 1 | 2;
    if (light.type === 'rect') {
      const width = light.width ?? 1;
      const height = light.height ?? 1;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`Degenerate Disney rectangular light at ${light.path}.`);
      }
      position = transformPoint(light.transform, [0, 0, 0]);
      u = transformDirection(light.transform, [width, 0, 0]);
      v = transformDirection(light.transform, [0, height, 0]);
      area = length(cross(u, v));
      if (!(area > 0) || !Number.isFinite(area)) throw new Error(`Degenerate Disney rectangular light at ${light.path}.`);
      kind = 0;
    } else if (light.type === 'sphere') {
      const axes = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const)
        .map(axis => transformDirection(light.transform, axis));
      const scales = axes.map(axis => length(axis));
      if (Math.max(...scales) - Math.min(...scales) > 1e-5 ||
          axes.some((axis, i) => axes.slice(i + 1).some(other =>
            Math.abs(axis[0] * other[0] + axis[1] * other[1] + axis[2] * other[2]) > 1e-5 * scales[i]! * length(other)))) {
        throw new Error(`Non-uniform or sheared Disney sphere light at ${light.path}.`);
      }
      radius = (light.radius ?? 0.5) * scales[0]!;
      area = 4 * Math.PI * radius * radius;
      if (!(radius > 0) || !Number.isFinite(area)) throw new Error(`Degenerate Disney sphere light at ${light.path}.`);
      position = transformPoint(light.transform, [0, 0, 0]);
      kind = 1;
    } else {
      position = transformDirection(light.transform, [0, 0, 1]);
      const directionLength = length(position);
      if (!(directionLength > 0) || !Number.isFinite(directionLength)) {
        throw new Error(`Degenerate Disney distant light at ${light.path}.`);
      }
      position = [position[0] / directionLength, position[1] / directionLength, position[2] / directionLength];
      kind = 2;
    }

    const scale = light.intensity * Math.pow(2, light.exposure) / (light.normalize && area > 0 ? area : 1);
    const emission: Vec3 = [light.color[0] * scale, light.color[1] * scale, light.color[2] * scale];
    const record = [...position, 0, ...emission, 0, ...u, radius, ...v, area, radius, area, kind, 0];
    if (record.some(value => !Number.isFinite(Math.fround(value)))) {
      throw new Error(`Disney light exceeds float32 range at ${light.path}.`);
    }
    data.set(record, index * 20);
  });
  return { data, count: selected.length };
}
