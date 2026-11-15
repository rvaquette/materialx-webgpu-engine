/*
 * Surface reconstruction adapted from GLSL-PathTracer.
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
 * Requires DISNEY_TRAVERSAL_WGSL and texture_2d<f32> bindings named
 * disneyNormals and disneyTransforms. Callers must check normalValid, uvValid
 * when sampling textures, and tangentValid when a tangent frame is needed.
 */
export const DISNEY_SURFACE_WGSL = /* wgsl */ `
struct DisneySurface {
  position: vec3f,
  uv: vec2f,
  normal: vec3f,
  faceNormal: vec3f,
  tangent: vec3f,
  bitangent: vec3f,
  normalValid: bool,
  uvValid: bool,
  tangentValid: bool,
};

fn disneyFinite3(v: vec3f) -> bool {
  return all((bitcast<vec3u>(v) & vec3u(0x7f800000u)) != vec3u(0x7f800000u));
}

fn disneyUsableDirection(v: vec3f) -> bool {
  return disneyFinite3(v) && max(abs(v.x), max(abs(v.y), abs(v.z))) > 0.0;
}

fn disneyUnit(v: vec3f) -> vec3f {
  let scale = max(abs(v.x), max(abs(v.y), abs(v.z)));
  return normalize(v / scale);
}

fn disneyForward(instance: u32) -> mat4x4f {
  let width = textureDimensions(disneyTransforms).x;
  let base = instance * 4u;
  return mat4x4f(
    textureLoad(disneyTransforms, disneyCoord(base, width), 0),
    textureLoad(disneyTransforms, disneyCoord(base + 1u, width), 0),
    textureLoad(disneyTransforms, disneyCoord(base + 2u, width), 0),
    textureLoad(disneyTransforms, disneyCoord(base + 3u, width), 0));
}

fn disneySurface(hit: DisneyHit, origin: vec3f, direction: vec3f) -> DisneySurface {
  var result: DisneySurface;
  if (!hit.hit || hit.overflow) { return result; }
  result.position = origin + direction * hit.t;
  let ids = disneyTriangle(hit.triangle);
  let triangleWidth = textureDimensions(disneyTriangles).x;
  result.uvValid = (textureLoad(disneyTriangles, disneyCoord(hit.triangle, triangleWidth), 0).w & 1) == 1;
  let vertexWidth = textureDimensions(disneyVertices).x;
  let normalWidth = textureDimensions(disneyNormals).x;
  let p0 = textureLoad(disneyVertices, disneyCoord(ids.x, vertexWidth), 0);
  let p1 = textureLoad(disneyVertices, disneyCoord(ids.y, vertexWidth), 0);
  let p2 = textureLoad(disneyVertices, disneyCoord(ids.z, vertexWidth), 0);
  let n0 = textureLoad(disneyNormals, disneyCoord(ids.x, normalWidth), 0);
  let n1 = textureLoad(disneyNormals, disneyCoord(ids.y, normalWidth), 0);
  let n2 = textureLoad(disneyNormals, disneyCoord(ids.z, normalWidth), 0);
  let uv0 = vec2f(p0.w, n0.w);
  let uv1 = vec2f(p1.w, n1.w);
  let uv2 = vec2f(p2.w, n2.w);
  let bary = vec3f(1.0 - hit.barycentric.x - hit.barycentric.y, hit.barycentric);
  result.uv = uv0 * bary.x + uv1 * bary.y + uv2 * bary.z;
  let localNormal = n0.xyz * bary.x + n1.xyz * bary.y + n2.xyz * bary.z;
  let inverse = disneyInverse(hit.instance);
  let normalMatrix = transpose(mat3x3f(inverse[0].xyz, inverse[1].xyz, inverse[2].xyz));
  let worldNormal = normalMatrix * localNormal;
  if (disneyUsableDirection(worldNormal)) {
    result.normal = disneyUnit(worldNormal);
    result.faceNormal = select(-result.normal, result.normal, dot(result.normal, direction) <= 0.0);
    result.normalValid = true;
  }
  let uvA = uv1 - uv0;
  let uvB = uv2 - uv0;
  let determinant = uvA.x * uvB.y - uvA.y * uvB.x;
  if ((bitcast<u32>(determinant) & 0x7f800000u) != 0x7f800000u && determinant != 0.0) {
    let transform = disneyForward(hit.instance);
    let linear = mat3x3f(transform[0].xyz, transform[1].xyz, transform[2].xyz);
    let sign = select(-1.0, 1.0, determinant > 0.0);
    let tangent = linear * ((p1.xyz - p0.xyz) * uvB.y - (p2.xyz - p0.xyz) * uvA.y) * sign;
    let bitangent = linear * ((p2.xyz - p0.xyz) * uvA.x - (p1.xyz - p0.xyz) * uvB.x) * sign;
    if (disneyUsableDirection(tangent) && disneyUsableDirection(bitangent)) {
      result.tangent = disneyUnit(tangent);
      result.bitangent = disneyUnit(bitangent);
      result.tangentValid = true;
    }
  }
  return result;
}
`;
