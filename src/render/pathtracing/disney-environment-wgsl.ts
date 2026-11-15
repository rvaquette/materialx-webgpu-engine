/*
 * Environment sampling adapted from GLSL-PathTracer.
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
 * Requires disneyEnvTexture: texture_2d<f32> and disneyEnvCdf: array<f32>.
 * Use a CDF built from the same unscaled RGB32F pixels. linear selects the
 * original renderer's float-filtering capability; both axes repeat.
 * A nonzero error must be propagated: 1 = invalid input/resources, 2 = non-finite
 * output. The first CDF row samples its vertical center to avoid the pole.
 */
export const DISNEY_ENVIRONMENT_WGSL = /* wgsl */ `
struct DisneyEnvironmentSample {
  color: vec3f,
  direction: vec3f,
  pdf: f32,
  error: u32,
};

fn disneyEnvFinite(x: f32) -> bool {
  return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u;
}

fn disneyEnvValid(total: f32, rotation: f32) -> bool {
  let size = textureDimensions(disneyEnvTexture);
  return all(size > vec2u(0u)) && size.x <= 0x7fffffffu && size.y <= 0x7fffffffu &&
    size.x <= 0xffffffffu / size.y && arrayLength(&disneyEnvCdf) >= size.x * size.y &&
    disneyEnvFinite(total) && total > 0.0 && disneyEnvFinite(rotation);
}

fn disneyEnvTexel(p: vec2i, size: vec2i) -> vec3f {
  let wrapped = (p % size + size) % size;
  return textureLoad(disneyEnvTexture, wrapped, 0).rgb;
}

fn disneyEnvColor(uv: vec2f, linear: bool) -> vec3f {
  let size = vec2i(textureDimensions(disneyEnvTexture));
  let position = fract(uv) * vec2f(size);
  if (!linear) { return disneyEnvTexel(vec2i(floor(position)), size); }
  let p = position - vec2f(0.5);
  let base = vec2i(floor(p));
  let f = fract(p);
  let a = mix(disneyEnvTexel(base, size), disneyEnvTexel(base + vec2i(1, 0), size), f.x);
  let b = mix(disneyEnvTexel(base + vec2i(0, 1), size), disneyEnvTexel(base + vec2i(1, 1), size), f.x);
  return mix(a, b, f.y);
}

fn disneyEnvSearch(value: f32, size: vec2u) -> vec2u {
  var lo = 0u; var hi = size.y - 1u;
  while (lo < hi) {
    let mid = lo + (hi - lo) / 2u;
    if (value < disneyEnvCdf[mid * size.x + size.x - 1u]) { hi = mid; }
    else { lo = mid + 1u; }
  }
  let y = lo;
  lo = 0u; hi = size.x - 1u;
  while (lo < hi) {
    let mid = lo + (hi - lo) / 2u;
    if (value < disneyEnvCdf[y * size.x + mid]) { hi = mid; }
    else { lo = mid + 1u; }
  }
  return vec2u(lo, y);
}

fn disneyEnvPdf(color: vec3f, theta: f32, total: f32, size: vec2u) -> f32 {
  let luminance = 0.212671 * color.x + 0.715160 * color.y + 0.072169 * color.z;
  return ((luminance / total) * f32(size.x) * f32(size.y)) /
    (6.28318530717958648 * 3.14159265358979323 * sin(theta));
}

fn disneyEvalEnvironment(direction: vec3f, total: f32, rotation: f32, linear: bool) -> DisneyEnvironmentSample {
  var result: DisneyEnvironmentSample;
  let lengthSquared = dot(direction, direction);
  if (!disneyEnvValid(total, rotation) ||
      any((bitcast<vec3u>(direction) & vec3u(0x7f800000u)) == vec3u(0x7f800000u)) ||
      !disneyEnvFinite(lengthSquared) || lengthSquared <= 0.0) {
    result.error = 1u; return result;
  }
  let theta = acos(clamp(direction.y, -1.0, 1.0));
  var longitude = 0.0;
  if (direction.x != 0.0 || direction.z != 0.0) { longitude = atan2(direction.z, direction.x); }
  let uv = vec2f((3.14159265358979323 + longitude) * 0.15915494309189534 + rotation,
    theta * 0.31830988618379067);
  result.color = disneyEnvColor(uv, linear);
  result.direction = direction;
  if (abs(direction.y) < 1.0) {
    result.pdf = disneyEnvPdf(result.color, theta, total, textureDimensions(disneyEnvTexture));
  }
  if (!disneyEnvFinite(result.pdf) ||
      any((bitcast<vec3u>(result.color) & vec3u(0x7f800000u)) == vec3u(0x7f800000u))) {
    result.error = 2u;
  }
  return result;
}

fn disneySampleEnvironment(random: f32, total: f32, rotation: f32, linear: bool) -> DisneyEnvironmentSample {
  var result: DisneyEnvironmentSample;
  if (!disneyEnvValid(total, rotation) || !disneyEnvFinite(random) || random < 0.0 || random > 1.0) {
    result.error = 1u; return result;
  }
  let size = textureDimensions(disneyEnvTexture);
  var uv = vec2f(disneyEnvSearch(random * total, size)) / vec2f(size);
  if (uv.y == 0.0) { uv.y = 0.5 / f32(size.y); }
  result.color = disneyEnvColor(uv, linear);
  uv.x -= rotation;
  let phi = uv.x * 6.28318530717958648;
  let theta = uv.y * 3.14159265358979323;
  result.direction = vec3f(-sin(theta) * cos(phi), cos(theta), -sin(theta) * sin(phi));
  result.pdf = disneyEnvPdf(result.color, theta, total, size);
  if (sin(theta) == 0.0 || !disneyEnvFinite(result.pdf) ||
      any((bitcast<vec3u>(result.direction) & vec3u(0x7f800000u)) == vec3u(0x7f800000u)) ||
      any((bitcast<vec3u>(result.color) & vec3u(0x7f800000u)) == vec3u(0x7f800000u))) {
    result.error = 2u;
  }
  return result;
}
`;
