/*
 * Alpha-tested shadow traversal adapted from GLSL-PathTracer.
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

/** Requires camera, traversal, surface and material modules and their bindings. */
export const DISNEY_ALPHA_WGSL = /* wgsl */ `
struct DisneyAlphaHit { hit: bool, error: u32 };

fn disneyAlphaBoxDistance(node: u32, origin: vec3f, direction: vec3f) -> f32 {
  let lower = disneyNode(node, 0u).xyz;
  let upper = disneyNode(node, 1u).xyz;
  var near = -1e30;
  var far = 1e30;
  for (var axis = 0u; axis < 3u; axis++) {
    if (direction[axis] == 0.0) {
      if (origin[axis] < lower[axis] || origin[axis] > upper[axis]) { return -1.0; }
    } else {
      let a = (lower[axis] - origin[axis]) / direction[axis];
      let b = (upper[axis] - origin[axis]) / direction[axis];
      near = max(near, min(a, b));
      far = min(far, max(a, b));
      if (far < near) { return -1.0; }
    }
  }
  return select(far, near, near > 0.0);
}

fn disneyAlphaAccept(triangle: u32, material: u32, barycentric: vec2f,
                     seed: ptr<function, vec4u>) -> DisneyAlphaHit {
  var result: DisneyAlphaHit;
  if (material >= arrayLength(&disneyMaterials) / 8u) { result.error = 501u; return result; }
  let base = material * 8u;
  let ids = disneyMaterials[base + 6u];
  let alpha = disneyMaterials[base + 7u];
  var opacity = alpha.x;
  if (ids.x >= 0.0) {
    let tri = textureLoad(disneyTriangles, disneyCoord(triangle, textureDimensions(disneyTriangles).x), 0);
    if ((tri.w & 1) != 1) { result.error = 505u; return result; }
    let indices = vec3u(tri.xyz);
    let vertexWidth = textureDimensions(disneyVertices).x;
    let normalWidth = textureDimensions(disneyNormals).x;
    let p0 = textureLoad(disneyVertices, disneyCoord(indices.x, vertexWidth), 0);
    let p1 = textureLoad(disneyVertices, disneyCoord(indices.y, vertexWidth), 0);
    let p2 = textureLoad(disneyVertices, disneyCoord(indices.z, vertexWidth), 0);
    let n0 = textureLoad(disneyNormals, disneyCoord(indices.x, normalWidth), 0);
    let n1 = textureLoad(disneyNormals, disneyCoord(indices.y, normalWidth), 0);
    let n2 = textureLoad(disneyNormals, disneyCoord(indices.z, normalWidth), 0);
    let weights = vec3f(1.0 - barycentric.x - barycentric.y, barycentric);
    let uv = vec2f(p0.w, n0.w) * weights.x + vec2f(p1.w, n1.w) * weights.y +
      vec2f(p2.w, n2.w) * weights.z;
    let sample = disneySampleTexture(i32(ids.x), uv);
    if (!sample.valid) { result.error = 502u; return result; }
    opacity *= sample.color.a;
  }
  let mode = i32(alpha.y);
  if (mode == 2 && opacity < alpha.z) { return result; }
  if (mode == 1 && disneyRandom(seed) > opacity) { return result; }
  result.hit = true;
  return result;
}

fn disneyAlphaBlas(root: u32, origin: vec3f, direction: vec3f, maxT: f32, material: f32,
                   seed: ptr<function, vec4u>) -> DisneyAlphaHit {
  var result: DisneyAlphaHit;
  var stack: array<u32, 64>;
  var size = 1u;
  stack[0] = root;
  while (size > 0u) {
    size--;
    let node = disneyNode(stack[size], 2u);
    if (node.z > 0.0) {
      for (var i = 0u; i < u32(node.y); i++) {
        let triangle = u32(node.x) + i;
        let hit = disneyIntersectTriangle(triangle, origin, direction, 0.0, maxT);
        if (hit.w > 0.0) {
          result = disneyAlphaAccept(triangle, disneyTriangleMaterial(triangle, material), hit.yz, seed);
          if (result.hit || result.error != 0u) { return result; }
        }
      }
    } else {
      let left = u32(node.x); let right = u32(node.y);
      let a = disneyAlphaBoxDistance(left, origin, direction);
      let b = disneyAlphaBoxDistance(right, origin, direction);
      if (a > 0.0 && b > 0.0) {
        if (size + 2u > 64u) { result.error = 2u; return result; }
        stack[size] = select(right, left, a > b);
        stack[size + 1u] = select(left, right, a > b);
        size += 2u;
      } else if (a > 0.0 || b > 0.0) {
        if (size + 1u > 64u) { result.error = 2u; return result; }
        stack[size] = select(right, left, a > 0.0);
        size++;
      }
    }
  }
  return result;
}

fn disneyAlphaAnyHit(root: u32, origin: vec3f, direction: vec3f, maxT: f32,
                     seed: ptr<function, vec4u>) -> DisneyAlphaHit {
  var result: DisneyAlphaHit;
  var stack: array<u32, 64>;
  var size = 1u;
  stack[0] = root;
  while (size > 0u) {
    size--;
    let node = disneyNode(stack[size], 2u);
    if (node.z < 0.0) {
      let inverse = disneyInverse(u32(-node.z - 1.0));
      let localOrigin = (inverse * vec4f(origin, 1.0)).xyz;
      let localDirection = (inverse * vec4f(direction, 0.0)).xyz;
      result = disneyAlphaBlas(u32(node.x), localOrigin, localDirection, maxT, node.y, seed);
      if (result.hit || result.error != 0u) { return result; }
    } else {
      let left = u32(node.x); let right = u32(node.y);
      let a = disneyAlphaBoxDistance(left, origin, direction);
      let b = disneyAlphaBoxDistance(right, origin, direction);
      if (a > 0.0 && b > 0.0) {
        if (size + 2u > 64u) { result.error = 2u; return result; }
        stack[size] = select(right, left, a > b);
        stack[size + 1u] = select(left, right, a > b);
        size += 2u;
      } else if (a > 0.0 || b > 0.0) {
        if (size + 1u > 64u) { result.error = 2u; return result; }
        stack[size] = select(right, left, a > 0.0);
        size++;
      }
    }
  }
  return result;
}
`;
