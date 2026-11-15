/*
 * Camera ray generation and PCG4D adapted from GLSL-PathTracer.
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
 * Port of tile.glsl's camera and PCG4D. pixel is local to the source tile and
 * uses the WebGL lower-left origin; frame is the source tile frame counter.
 * The caller supplies the tile offset/size explicitly and must propagate errors.
 */
export const DISNEY_CAMERA_WGSL = /* wgsl */ `
struct DisneyCamera {
  position: vec3f,
  right: vec3f,
  up: vec3f,
  forward: vec3f,
  fov: f32,
  focalDistance: f32,
  aperture: f32,
  orthographic: bool,
};

struct DisneyCameraRay {
  origin: vec3f,
  direction: vec3f,
  error: u32,
};

fn disneyInitRng(pixel: vec2u, frame: u32) -> vec4u {
  return vec4u(pixel, frame, pixel.x + pixel.y);
}

fn disneyRandom(seed: ptr<function, vec4u>) -> f32 {
  var v = *seed * 1664525u + vec4u(1013904223u);
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> vec4u(16u);
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  *seed = v;
  return f32(v.x) / 4294967295.0;
}

fn disneyCameraFinite(v: f32) -> bool {
  return (bitcast<u32>(v) & 0x7f800000u) != 0x7f800000u;
}

fn disneyCameraFinite3(v: vec3f) -> bool {
  return all((bitcast<vec3u>(v) & vec3u(0x7f800000u)) != vec3u(0x7f800000u));
}

fn disneyCameraRay(
  camera: DisneyCamera, pixel: vec2u, tileSize: vec2u, resolution: vec2u,
  tileOffset: vec2f, invNumTiles: vec2f, seed: ptr<function, vec4u>,
) -> DisneyCameraRay {
  var result: DisneyCameraRay;
  if (any(tileSize == vec2u(0u)) || any(resolution == vec2u(0u)) || any(pixel >= tileSize) ||
      !disneyCameraFinite3(camera.position) || !disneyCameraFinite3(camera.right) ||
      !disneyCameraFinite3(camera.up) || !disneyCameraFinite3(camera.forward) ||
      !disneyCameraFinite(camera.fov) || camera.fov <= 0.0 || camera.fov >= 3.14159265358979323 ||
      !disneyCameraFinite(camera.focalDistance) || camera.focalDistance <= 0.0 ||
      !disneyCameraFinite(camera.aperture) || camera.aperture < 0.0 ||
      any((bitcast<vec2u>(tileOffset) & vec2u(0x7f800000u)) == vec2u(0x7f800000u)) ||
      any((bitcast<vec2u>(invNumTiles) & vec2u(0x7f800000u)) == vec2u(0x7f800000u))) {
    result.error = 1u; return result;
  }
  let texCoords = (vec2f(pixel) + vec2f(0.5)) / vec2f(tileSize);
  let coords = mix(tileOffset, tileOffset + invNumTiles, texCoords);
  let r1 = 2.0 * disneyRandom(seed);
  let r2 = 2.0 * disneyRandom(seed);
  var jitter: vec2f;
  if (r1 < 1.0) { jitter.x = sqrt(r1) - 1.0; }
  else { jitter.x = 1.0 - sqrt(2.0 - r1); }
  if (r2 < 1.0) { jitter.y = sqrt(r2) - 1.0; }
  else { jitter.y = 1.0 - sqrt(2.0 - r2); }
  jitter /= vec2f(resolution) * 0.5;
  var d = coords * 2.0 - 1.0 + jitter;
  let scale = tan(camera.fov * 0.5);
  d.y *= f32(resolution.y) / f32(resolution.x) * scale;
  d.x *= scale;
  let perspectiveDirection = d.x * camera.right + d.y * camera.up + camera.forward;
  let lengthSquared = dot(perspectiveDirection, perspectiveDirection);
  if (!disneyCameraFinite3(perspectiveDirection) || !disneyCameraFinite(lengthSquared) || lengthSquared <= 0.0) {
    result.error = 2u; return result;
  }
  var screenOffset = vec3f(0.0);
  var direction = normalize(perspectiveDirection);
  var focalPoint = camera.focalDistance * direction;
  if (camera.orthographic) {
    let forwardLengthSquared = dot(camera.forward, camera.forward);
    if (!disneyCameraFinite(forwardLengthSquared) || forwardLengthSquared <= 0.0) {
      result.error = 2u; return result;
    }
    direction = normalize(camera.forward);
    screenOffset = d.x * camera.focalDistance * camera.right + d.y * camera.focalDistance * camera.up;
    focalPoint = camera.focalDistance * direction;
  }
  let angle = disneyRandom(seed) * 6.28318530717958648;
  let radius = sqrt(disneyRandom(seed) * camera.aperture);
  let offset = (cos(angle) * camera.right + sin(angle) * camera.up) * radius;
  let finalDirection = focalPoint - offset;
  let finalLengthSquared = dot(finalDirection, finalDirection);
  if (!disneyCameraFinite3(finalDirection) || !disneyCameraFinite(finalLengthSquared) || finalLengthSquared <= 0.0 ||
      !disneyCameraFinite3(camera.position + screenOffset + offset)) {
    result.error = 2u; return result;
  }
  result.origin = camera.position + screenOffset + offset;
  result.direction = normalize(finalDirection);
  return result;
}
`;
