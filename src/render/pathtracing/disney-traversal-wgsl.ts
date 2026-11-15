/**
 * Requires texture_2d bindings named disneyNodes, disneyTriangles,
 * disneySubsetMaterials, disneyVertices and disneyInverseTransforms. The root index is supplied by
 * the caller; hit distances remain in the original ray's parameterization.
 * Callers must treat DisneyHit.overflow as an error, even if hit is true.
 */
export const DISNEY_TRAVERSAL_WGSL = /* wgsl */ `
struct DisneyHit {
  t: f32,
  triangle: u32,
  instance: u32,
  material: u32,
  barycentric: vec2f,
  hit: bool,
  overflow: bool,
};

fn disneyCoord(index: u32, width: u32) -> vec2i {
  return vec2i(i32(index % width), i32(index / width));
}

fn disneyNode(index: u32, part: u32) -> vec4f {
  return textureLoad(disneyNodes, disneyCoord(index * 3u + part, textureDimensions(disneyNodes).x), 0);
}

fn disneyTriangle(index: u32) -> vec3u {
  return vec3u(textureLoad(disneyTriangles, disneyCoord(index, textureDimensions(disneyTriangles).x), 0).xyz);
}

fn disneyTriangleMaterial(index: u32, material: f32) -> u32 {
  if (material >= 0.0) { return u32(material); }
  let tri = textureLoad(disneyTriangles, disneyCoord(index, textureDimensions(disneyTriangles).x), 0);
  let slot = u32(tri.w) >> 1u;
  let offset = u32(-material - 1.0) + slot;
  return u32(textureLoad(disneySubsetMaterials, disneyCoord(offset, textureDimensions(disneySubsetMaterials).x), 0).x);
}

fn disneyVertex(index: u32) -> vec3f {
  return textureLoad(disneyVertices, disneyCoord(index, textureDimensions(disneyVertices).x), 0).xyz;
}

fn disneyInverse(instance: u32) -> mat4x4f {
  let width = textureDimensions(disneyInverseTransforms).x;
  let base = instance * 4u;
  return mat4x4f(
    textureLoad(disneyInverseTransforms, disneyCoord(base, width), 0),
    textureLoad(disneyInverseTransforms, disneyCoord(base + 1u, width), 0),
    textureLoad(disneyInverseTransforms, disneyCoord(base + 2u, width), 0),
    textureLoad(disneyInverseTransforms, disneyCoord(base + 3u, width), 0));
}

fn disneyBoxHit(index: u32, origin: vec3f, direction: vec3f, minT: f32, maxT: f32) -> bool {
  let lower = disneyNode(index, 0u).xyz;
  let upper = disneyNode(index, 1u).xyz;
  var near = minT;
  var far = maxT;
  for (var axis = 0u; axis < 3u; axis++) {
    if (direction[axis] == 0.0) {
      if (origin[axis] < lower[axis] || origin[axis] > upper[axis]) { return false; }
    } else {
      let a = (lower[axis] - origin[axis]) / direction[axis];
      let b = (upper[axis] - origin[axis]) / direction[axis];
      near = max(near, min(a, b));
      far = min(far, max(a, b));
      if (far < near) { return false; }
    }
  }
  return true;
}

fn disneyIntersectTriangle(index: u32, origin: vec3f, direction: vec3f, minT: f32, maxT: f32) -> vec4f {
  let vertices = disneyTriangle(index);
  let a = disneyVertex(vertices.x);
  let e1 = disneyVertex(vertices.y) - a;
  let e2 = disneyVertex(vertices.z) - a;
  let p = cross(direction, e2);
  let det = dot(e1, p);
  if (det == 0.0) { return vec4f(0.0); }
  let offset = origin - a;
  let u = dot(offset, p) / det;
  let q = cross(offset, e1);
  let v = dot(direction, q) / det;
  let t = dot(e2, q) / det;
  if (u < 0.0 || v < 0.0 || u + v > 1.0 || t <= minT || t >= maxT) { return vec4f(0.0); }
  return vec4f(t, u, v, 1.0);
}

fn disneyTraceBlas(root: u32, origin: vec3f, direction: vec3f, minT: f32,
                   maxT: f32, instance: u32, material: f32, anyHit: bool) -> DisneyHit {
  var result = DisneyHit(maxT, 0xffffffffu, instance, 0xffffffffu, vec2f(0.0), false, false);
  var stack: array<u32, 64>;
  var size = 1u;
  stack[0] = root;
  while (size > 0u) {
    size--;
    let node = stack[size];
    if (!disneyBoxHit(node, origin, direction, minT, result.t)) { continue; }
    let nodeData = disneyNode(node, 2u);
    if (nodeData.z > 0.0) {
      for (var i = 0u; i < u32(nodeData.y); i++) {
        let tri = u32(nodeData.x) + i;
        let hit = disneyIntersectTriangle(tri, origin, direction, minT, result.t);
        if (hit.w > 0.0) {
          result.t = hit.x;
          result.triangle = tri;
          result.material = disneyTriangleMaterial(tri, material);
          result.barycentric = hit.yz;
          result.hit = true;
          if (anyHit) { return result; }
        }
      }
    } else {
      if (size + 2u > 64u) { result.overflow = true; return result; }
      stack[size] = u32(nodeData.x);
      stack[size + 1u] = u32(nodeData.y);
      size += 2u;
    }
  }
  return result;
}

fn disneyTrace(root: u32, origin: vec3f, direction: vec3f, minT: f32, maxT: f32, anyHit: bool) -> DisneyHit {
  var result = DisneyHit(maxT, 0xffffffffu, 0xffffffffu, 0xffffffffu, vec2f(0.0), false, false);
  var stack: array<u32, 64>;
  var size = 1u;
  stack[0] = root;
  while (size > 0u) {
    size--;
    let node = stack[size];
    if (!disneyBoxHit(node, origin, direction, minT, result.t)) { continue; }
    let nodeData = disneyNode(node, 2u);
    if (nodeData.z < 0.0) {
      let instance = u32(-nodeData.z - 1.0);
      let inverse = disneyInverse(instance);
      let localOrigin = (inverse * vec4f(origin, 1.0)).xyz;
      let localDirection = (inverse * vec4f(direction, 0.0)).xyz;
      let hit = disneyTraceBlas(u32(nodeData.x), localOrigin, localDirection, minT, result.t, instance, nodeData.y, anyHit);
      if (hit.overflow) { result.overflow = true; return result; }
      if (hit.hit) {
        result = hit;
        if (anyHit) { return result; }
      }
    } else {
      if (size + 2u > 64u) { result.overflow = true; return result; }
      stack[size] = u32(nodeData.x);
      stack[size + 1u] = u32(nodeData.y);
      size += 2u;
    }
  }
  return result;
}
`;
