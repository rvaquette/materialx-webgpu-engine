import type { SceneLight } from '../../usd/lights.ts';
import { transformDirection, transformPoint, type Vec3 } from '../../scene/transforms.ts';

export const PT_LIGHT_FLOATS = 28;

export function packAnalyticLights(lights: readonly SceneLight[]): Float32Array {
  const selected = lights.filter(light => light.type !== 'dome');
  const data = new Float32Array(Math.max(1, selected.length) * PT_LIGHT_FLOATS);
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  selected.forEach((light, i) => {
    if (!['rect', 'sphere', 'distant', 'point', 'spot'].includes(light.type) || light.textureFile || light.iesFile || light.colorTemperature !== undefined) {
      throw new Error(`Unsupported converted path-tracer light at ${light.path}: ${light.type} or light shaping.`);
    }
    const base = i * PT_LIGHT_FLOATS;
    if (![...light.transform, ...light.color, light.intensity, light.exposure].every(Number.isFinite)
      || light.intensity < 0 || light.color.some(c => c < 0)) {
      throw new Error(`Invalid analytic light values at ${light.path}`);
    }
    
    let type: number;
    let position = transformPoint(light.transform, [0, 0, 0]);
    let u: Vec3 = [0, 0, 0], v: Vec3 = [0, 0, 0], normal: Vec3 = [0, 0, 0];
    let direction: Vec3 = [0, 0, 1];
    let radius = 0, area = 0;
    let decayRate = 2.0;
    let innerAngle = 0, outerAngle = 0;
    
    if (light.type === 'rect') {
      type = 0;
      if (!Number.isFinite(light.width ?? 1) || !Number.isFinite(light.height ?? 1)
        || (light.width ?? 1) <= 0 || (light.height ?? 1) <= 0) {
        throw new Error(`Degenerate rectangular light at ${light.path}`);
      }
      u = transformDirection(light.transform, [light.width ?? 1, 0, 0]);
      v = transformDirection(light.transform, [0, light.height ?? 1, 0]);
      const n = cross(u, v);
      area = Math.hypot(...n);
      if (!(area > 0)) throw new Error(`Degenerate rectangular light at ${light.path}`);
      normal = [-n[0] / area, -n[1] / area, -n[2] / area];
    } else if (light.type === 'sphere') {
      type = 1;
      const localAxes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const axes = localAxes.map(axis => transformDirection(light.transform, axis));
      const scales = axes.map(axis => Math.hypot(...axis));
      if (Math.max(...scales) - Math.min(...scales) > 1e-5) throw new Error(`Non-uniform sphere light scale at ${light.path}`);
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          const x = axes[a]!, y = axes[b]!;
          if (Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]) > 1e-5 * scales[a]! * scales[b]!) {
            throw new Error(`Sheared sphere light at ${light.path}`);
          }
        }
      }
      radius = (light.radius ?? 0.5) * scales[0]!;
      area = 4 * Math.PI * radius * radius;
      if (!(radius > 0) || !Number.isFinite(radius)) throw new Error(`Degenerate sphere light at ${light.path}`);
    } else if (light.type === 'distant') {
      type = 2;
      position = transformDirection(light.transform, [0, 0, -1]);
      if (!(Math.hypot(...position) > 0)) throw new Error(`Degenerate distant light at ${light.path}`);
    } else if (light.type === 'point') {
      type = 3;
      decayRate = light.decayRate ?? 2.0;
      if (!Number.isFinite(decayRate) || decayRate < 0) throw new Error(`Invalid decay rate for point light at ${light.path}`);
    } else if (light.type === 'spot') {
      type = 4;
      direction = transformDirection(light.transform, [0, 0, -1]);
      if (!(Math.hypot(...direction) > 0)) throw new Error(`Degenerate spot light direction at ${light.path}`);
      direction = [direction[0] / Math.hypot(...direction), direction[1] / Math.hypot(...direction), direction[2] / Math.hypot(...direction)];
      decayRate = light.decayRate ?? 2.0;
      innerAngle = light.innerAngle ?? 0;
      outerAngle = light.outerAngle ?? 45;
      if (!Number.isFinite(decayRate) || decayRate < 0) throw new Error(`Invalid decay rate for spot light at ${light.path}`);
      if (!Number.isFinite(innerAngle) || !Number.isFinite(outerAngle)) throw new Error(`Invalid cone angles for spot light at ${light.path}`);
    } else {
      throw new Error(`Unsupported light type ${light.type} at ${light.path}`);
    }
    
    const gain = light.intensity * 2 ** light.exposure / (light.normalize && area > 0 ? area : 1);
    data.set([...position, type], base);
    data.set([...light.color.map(c => c * gain), area], base + 4);
    data.set([...u, radius], base + 8);
    data.set([...v, decayRate], base + 12);
    data.set([...normal, 0], base + 16);
    data.set([...direction, 0], base + 20);
    data.set([Math.cos(innerAngle * Math.PI / 180), Math.cos(outerAngle * Math.PI / 180), 0, 0], base + 24);
    
    if (!data.subarray(base, base + PT_LIGHT_FLOATS).every(Number.isFinite)) {
      throw new Error(`Analytic light exceeds GPU numeric range at ${light.path}`);
    }
  });
  return data;
}

export function analyticLightsWgsl(group = 0, binding = 9, count = 'u32(U.transport.z)', pi = 'PI', epsilon = 'RAY_EPS'): string {
  return /* wgsl */ `
@group(${group}) @binding(${binding}) var<storage, read> analyticLights: array<vec4f>;
struct MxLightSample { direction: vec3f, distance: f32, radiance: vec3f, pdf: f32, delta: bool };
struct MxLightHit { distance: f32, radiance: vec3f, pdf: f32, hit: bool };
fn mx_light_count() -> u32 { return ${count}; }
fn mx_light_pdf(index: u32, origin: vec3f, point: vec3f, normal: vec3f) -> f32 {
  let b = index * 7u;
  let offset = point - origin;
  let distance2 = dot(offset, offset);
  let cosine = dot(normal, -normalize(offset));
  if (cosine <= 0.0 || distance2 <= 0.0) { return 0.0; }
  return distance2 / (analyticLights[b + 1u].w * cosine * f32(mx_light_count()));
}
fn mx_sample_light(origin: vec3f, u: vec3f) -> MxLightSample {
  var result: MxLightSample;
  let index = min(u32(u.z * f32(mx_light_count())), mx_light_count() - 1u);
  let b = index * 7u;
  let posType = analyticLights[b];
  result.radiance = analyticLights[b + 1u].xyz;
  let lightType = u32(posType.w);
  
  if (lightType == 2u) {
    result.direction = -normalize(posType.xyz);
    result.distance = 1e30;
    result.pdf = 1.0 / f32(mx_light_count());
    result.delta = true;
    return result;
  }
  
  var point: vec3f;
  var normal = analyticLights[b + 4u].xyz;
  var distance_to_light: f32 = 0.0;
  
  if (lightType == 0u) {
    point = posType.xyz + (u.x - 0.5) * analyticLights[b + 2u].xyz + (u.y - 0.5) * analyticLights[b + 3u].xyz;
  } else if (lightType == 1u) {
    let z = 1.0 - 2.0 * u.x;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let phi = 2.0 * ${pi} * u.y;
    normal = vec3f(r * cos(phi), r * sin(phi), z);
    point = posType.xyz + normal * analyticLights[b + 2u].w;
  } else if (lightType == 3u) {
    let theta = 2.0 * ${pi} * u.x;
    let phi = acos(1.0 - 2.0 * u.y);
    normal = vec3f(sin(phi) * cos(theta), sin(phi) * sin(theta), cos(phi));
    point = posType.xyz + normal * 0.01;
  } else if (lightType == 4u) {
    let direction = analyticLights[b + 5u].xyz;
    let cosInner = analyticLights[b + 6u].x;
    let cosOuter = analyticLights[b + 6u].y;
    let theta = 2.0 * ${pi} * u.x;
    let cosAngle = mix(cosOuter, cosInner, u.y);
    let sinAngle = sqrt(max(0.0, 1.0 - cosAngle * cosAngle));
    var localDir = vec3f(sinAngle * cos(theta), sinAngle * sin(theta), cosAngle);
    normal = localDir;
    point = posType.xyz + localDir * 0.01;
  }
  
  result.distance = length(point - origin);
  result.direction = normalize(point - origin);
  result.pdf = mx_light_pdf(index, origin, point, normal);
  return result;
}
fn mx_intersect_lights(origin: vec3f, direction: vec3f) -> MxLightHit {
  var result: MxLightHit;
  result.distance = 1e30;
  for (var index = 0u; index < mx_light_count(); index++) {
    let b = index * 7u;
    let posType = analyticLights[b];
    let lightType = u32(posType.w);
    
    if (lightType == 2u) { continue; }
    
    var normal = analyticLights[b + 4u].xyz;
    var distance = -1.0;
    
    if (lightType == 0u) {
      let cosine = dot(normal, direction);
      if (cosine >= -1e-8) { continue; }
      distance = dot(posType.xyz - origin, normal) / cosine;
      let offset = origin + direction * distance - posType.xyz;
      let u = analyticLights[b + 2u].xyz;
      let v = analyticLights[b + 3u].xyz;
      let uv = dot(u, v);
      let determinant = dot(u, u) * dot(v, v) - uv * uv;
      let a = (dot(offset, u) * dot(v, v) - dot(offset, v) * uv) / determinant;
      let c = (dot(offset, v) * dot(u, u) - dot(offset, u) * uv) / determinant;
      if (abs(a) > 0.5 || abs(c) > 0.5) { continue; }
    } else if (lightType == 1u) {
      let offset = origin - posType.xyz;
      let along = dot(offset, direction);
      let radius = analyticLights[b + 2u].w;
      let discriminant = along * along - dot(offset, offset) + radius * radius;
      if (discriminant < 0.0) { continue; }
      distance = -along - sqrt(discriminant);
      if (distance <= ${epsilon}) { continue; }
      normal = normalize(origin + direction * distance - posType.xyz);
    } else if (lightType == 3u || lightType == 4u) {
      continue;
    }
    
    if (distance <= ${epsilon} || distance >= result.distance) { continue; }
    result.distance = distance;
    result.radiance = analyticLights[b + 1u].xyz;
    result.pdf = mx_light_pdf(index, origin, origin + direction * distance, normal);
    result.hit = true;
  }
  return result;
}
`;
}

export const ANALYTIC_LIGHTS_WGSL = analyticLightsWgsl();
