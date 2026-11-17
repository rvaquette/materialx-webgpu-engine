/*
 * Analytic light sampling and intersections adapted from GLSL-PathTracer.
 * Copyright (c) 2019 Asif Ali
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Port of the source's rect, sphere and distant lights. Rect positions are
 * corners, not centers. Distant lights consume no random values; rect/sphere
 * consume two. Intersections use the source's INF and EPS thresholds.
 * Callers must propagate error: 1 = invalid input/light, 2 = undefined result.
 */
export const DISNEY_LIGHTS_WGSL = /* wgsl */ `
struct DisneyLight {
  position: vec3f,
  emission: vec3f,
  u: vec3f,
  v: vec3f,
  radius: f32,
  area: f32,
  kind: u32,
};

struct DisneyLightSelection { index: u32, error: u32 };
struct DisneyLightSample {
  normal: vec3f,
  emission: vec3f,
  direction: vec3f,
  distance: f32,
  pdf: f32,
  error: u32,
};
struct DisneyLightHit {
  distance: f32,
  emission: vec3f,
  pdf: f32,
  hit: bool,
  error: u32,
};

fn disneyLightFinite(x: f32) -> bool {
  return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u;
}
fn disneyLightFinite3(x: vec3f) -> bool {
  return all((bitcast<vec3u>(x) & vec3u(0x7f800000u)) != vec3u(0x7f800000u));
}
fn disneyLightValid(light: DisneyLight) -> bool {
  if (!disneyLightFinite3(light.position) || !disneyLightFinite3(light.emission) ||
      !disneyLightFinite3(light.u) || !disneyLightFinite3(light.v) ||
      !disneyLightFinite(light.radius) || !disneyLightFinite(light.area) || light.kind > 2u) { return false; }
  if (light.kind == 0u) {
    let n = cross(light.u, light.v);
    return light.area > 0.0 && disneyLightFinite3(n) && disneyLightFinite(dot(n, n)) && dot(n, n) > 0.0 &&
      disneyLightFinite(dot(light.u, light.u)) && disneyLightFinite(dot(light.v, light.v));
  }
  if (light.kind == 1u) { return light.radius > 0.0 && light.area > 0.0; }
  let length2 = dot(light.position, light.position);
  return disneyLightFinite(length2) && length2 > 0.0;
}

fn disneySelectLight(random: f32, count: u32) -> DisneyLightSelection {
  var result: DisneyLightSelection;
  if (count == 0u || !disneyLightFinite(random) || random < 0.0 || random > 1.0) {
    result.error = 1u; return result;
  }
  let scaled = random * f32(count);
  // PCG's float conversion can round the upper endpoint to 1.0.
  if (scaled >= f32(count)) { result.index = count - 1u; return result; }
  result.index = u32(scaled);
  return result;
}

fn disneySampleLight(light: DisneyLight, scatterPos: vec3f, random: vec2f, count: u32) -> DisneyLightSample {
  var result: DisneyLightSample;
  if (!disneyLightValid(light) || !disneyLightFinite3(scatterPos) || count == 0u) {
    result.error = 1u; return result;
  }
  result.emission = light.emission * f32(count);
  if (light.kind == 2u) {
    let toSurface = scatterPos - light.position;
    let l2 = dot(toSurface, toSurface);
    if (!disneyLightFinite(l2) || l2 <= 0.0) { result.error = 2u; return result; }
    result.direction = normalize(light.position);
    result.normal = normalize(toSurface);
    result.distance = 1000000.0;
    result.pdf = 1.0;
  } else {
    if (any((bitcast<vec2u>(random) & vec2u(0x7f800000u)) == vec2u(0x7f800000u)) ||
        any(random < vec2f(0.0)) || any(random > vec2f(1.0))) {
      result.error = 1u; return result;
    }
    var point: vec3f;
    if (light.kind == 0u) {
      point = light.position + light.u * random.x + light.v * random.y;
      result.normal = normalize(cross(light.u, light.v));
    } else {
      let centerToSurface = scatterPos - light.position;
      let l2 = dot(centerToSurface, centerToSurface);
      if (!disneyLightFinite(l2) || l2 <= 0.0) { result.error = 2u; return result; }
      let n = normalize(centerToSurface);
      var up = vec3f(1.0, 0.0, 0.0);
      if (abs(n.z) < 0.9999999) { up = vec3f(0.0, 0.0, 1.0); }
      let tangent = normalize(cross(up, n));
      let bitangent = cross(n, tangent);
      let r = sqrt(max(0.0, 1.0 - random.x * random.x));
      let phi = 6.28318530717958648 * random.y;
      let sampled = tangent * (r * cos(phi)) + bitangent * (r * sin(phi)) + n * random.x;
      point = light.position + sampled * light.radius;
      result.normal = normalize(point - light.position);
    }
    let offset = point - scatterPos;
    result.distance = length(offset);
    if (!disneyLightFinite(result.distance) || result.distance <= 0.0) { result.error = 2u; return result; }
    result.direction = offset / result.distance;
    var area = light.area;
    if (light.kind == 1u) { area *= 0.5; }
    let cosine = abs(dot(result.normal, result.direction));
    if (!disneyLightFinite(cosine)) { result.error = 2u; return result; }
    if (cosine > 0.0) {
      result.pdf = result.distance * result.distance / (area * cosine);
      if (!disneyLightFinite(result.pdf)) { result.pdf = 0.0; }
    }
  }
  if (!disneyLightFinite3(result.direction) || !disneyLightFinite3(result.normal) ||
      !disneyLightFinite3(result.emission) || !disneyLightFinite(result.pdf)) {
    result.error = 2u;
  }
  return result;
}

fn disneyIntersectLight(light: DisneyLight, origin: vec3f, direction: vec3f, maxT: f32, anyHit: bool) -> DisneyLightHit {
  var result: DisneyLightHit;
  result.distance = maxT;
  let dirLength2 = dot(direction, direction);
  if (!disneyLightValid(light) || !disneyLightFinite3(origin) || !disneyLightFinite3(direction) ||
      !disneyLightFinite(dirLength2) || abs(dirLength2 - 1.0) > 0.001 ||
      !disneyLightFinite(maxT) || maxT <= 0.0) {
    result.error = 1u; return result;
  }
  if (light.kind == 2u) { return result; }
  var distance = 1000000.0;
  var normal: vec3f;
  if (light.kind == 0u) {
    normal = normalize(cross(light.u, light.v));
    let dt = dot(direction, normal);
    if (dt == 0.0 || (!anyHit && dt > 0.0)) { return result; }
    let t = (dot(normal, light.position) - dot(normal, origin)) / dt;
    if (t > 0.0003) {
      let offset = origin + direction * t - light.position;
      let a = dot(light.u, offset) / dot(light.u, light.u);
      let b = dot(light.v, offset) / dot(light.v, light.v);
      if (a >= 0.0 && a <= 1.0 && b >= 0.0 && b <= 1.0) { distance = t; }
    }
  } else {
    let offset = light.position - origin;
    let b = dot(offset, direction);
    let discriminant = b * b - dot(offset, offset) + light.radius * light.radius;
    if (discriminant >= 0.0) {
      let root = sqrt(discriminant);
      let t1 = b - root;
      let t2 = b + root;
      if (t1 > 0.001) { distance = t1; }
      else if (t2 > 0.001) { distance = t2; }
    }
    if (distance < 1000000.0) {
      normal = normalize(origin + distance * direction - light.position);
    }
  }
  if (distance >= min(maxT, 1000000.0)) { return result; }
  if (anyHit) {
    result.distance = distance;
    result.hit = true;
    return result;
  }
  let cosine = dot(-direction, normal);
  var area = light.area;
  if (light.kind == 1u) { area *= 0.5; }
  result.distance = distance;
  result.emission = light.emission;
  result.pdf = distance * distance / (area * cosine);
  result.hit = true;
  if (!disneyLightFinite(result.pdf) || !disneyLightFinite3(normal)) { result.error = 2u; }
  return result;
}
`;
