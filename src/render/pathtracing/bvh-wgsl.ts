// Shared world-space BVH traversal WGSL. Both the compute path tracer
// (compute.ts) and the hybrid traced-effects pass (src/render/hybrid/trace-pass.ts)
// emit this identical source so rays are intersected byte-for-byte the same way
// against the buffers packed by scene-buffers.ts (PT_NODE_FLOATS / PT_TRIANGLE_FLOATS).
//
// The caller must declare, before including this source:
//   @group(..) var<storage, read> nodes : array<f32>;    // packed BVH nodes
//   @group(..) var<storage, read> tris : array<f32>;      // packed triangles
//   @group(..) var<storage, read> triOrder : array<u32>;  // reference layout only
//   const NODE_STRIDE : u32 = 12u;  // PT_NODE_FLOATS
//   const TRI_STRIDE : u32 = 24u;   // PT_TRIANGLE_FLOATS
//   const RAY_EPS : f32 = 1.0e-4;
// Binding indices are the caller's choice; only the symbol names are fixed.
import { bvh4TraversalWgsl } from './bvh4.ts';

/** Node floats per BVH node (PT_NODE_FLOATS); callers declare `NODE_STRIDE` with this value. */
export const BVH_NODE_STRIDE = 12;
/** Floats per packed triangle (PT_TRIANGLE_FLOATS); callers declare `TRI_STRIDE` with this value. */
export const BVH_TRI_STRIDE = 24;

export type BvhTraversalVariant = 'reference' | 'cachedEntry' | 'leafOrder' | 'triangleEdges' | 'bvh4';

/** Traversal + Moller-Trumbore triangle test over the packed buffers. `anyHit`
 *  returns at the first intersection (shadow/occlusion rays); otherwise the
 *  closest hit is kept. `leafOrder` expects the packed streams to follow BVH
 *  leaf order. `triangleEdges` requires the caller to bind `triEdges` as a
 *  packed v0/e1/e2 stream. Cached-entry pruning is inclusive with the slab test;
 *  triangle hit bounds remain strict. */
export function bvhTraversalWgsl(variant: BvhTraversalVariant = 'reference'): string {
  if (variant === 'bvh4') {
    const reference = bvhTraversalWgsl();
    return reference.slice(0, reference.indexOf('fn aabb_hit(')) + bvh4TraversalWgsl();
  }
  if (variant !== 'reference' && variant !== 'cachedEntry' && variant !== 'leafOrder' && variant !== 'triangleEdges') {
    throw new Error(`Invalid BVH traversal: ${variant}`);
  }
  const cached = variant === 'cachedEntry';
  const leafOrder = variant === 'leafOrder';
  const triangleEdges = variant === 'triangleEdges';
  return /* wgsl */ `
struct Hit { t : f32, tri : u32, u : f32, v : f32, hitAny : bool };

fn tri_vertex(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * TRI_STRIDE + slot * 3u;
  return vec3<f32>(tris[b], tris[b + 1u], tris[b + 2u]);
}

${triangleEdges ? `fn tri_edge(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * 9u + slot * 3u;
  return vec3<f32>(triEdges[b], triEdges[b + 1u], triEdges[b + 2u]);
}
` : ''}
fn tri_normal(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * TRI_STRIDE + 9u + slot * 3u;
  return vec3<f32>(tris[b], tris[b + 1u], tris[b + 2u]);
}

fn tri_material(tri : u32) -> u32 {
  return u32(tris[tri * TRI_STRIDE + 18u]);
}

fn intersect_tri(tri : u32, ro : vec3<f32>, rd : vec3<f32>, tMax : f32) -> vec4<f32> {
${triangleEdges ? '  let v0 = tri_edge(tri, 0u);\n  let e1 = tri_edge(tri, 1u);\n  let e2 = tri_edge(tri, 2u);' : `  let v0 = tri_vertex(tri, 0u);
  let v1 = tri_vertex(tri, 1u);
  let v2 = tri_vertex(tri, 2u);
  let e1 = v1 - v0;
  let e2 = v2 - v0;`}
  let p = cross(rd, e2);
  let det = dot(e1, p);
  if (abs(det) < 1.0e-9) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let inv = 1.0 / det;
  let tvec = ro - v0;
  let u = dot(tvec, p) * inv;
  if (u < 0.0 || u > 1.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let q = cross(tvec, e1);
  let vv = dot(rd, q) * inv;
  if (vv < 0.0 || u + vv > 1.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let t = dot(e2, q) * inv;
  if (t <= RAY_EPS || t >= tMax) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  return vec4<f32>(t, u, vv, 1.0);
}

fn aabb_hit(node : u32, ro : vec3<f32>, invDir : vec3<f32>, tMax : f32) -> f32 {
  let b = node * NODE_STRIDE;
  var tmin = RAY_EPS;
  var tmax = tMax;
  for (var a = 0u; a < 3u; a = a + 1u) {
    let lo = (nodes[b + a] - ro[a]) * invDir[a];
    let hi = (nodes[b + 4u + a] - ro[a]) * invDir[a];
    tmin = max(tmin, min(lo, hi));
    tmax = min(tmax, max(lo, hi));
    if (tmax < tmin) { return -1.0; }
  }
  return tmin;
}

fn traverse(ro : vec3<f32>, rd : vec3<f32>, tMax : f32, anyHit : bool) -> Hit {
  var result : Hit;
  result.t = tMax;
  result.hitAny = false;
  let invDir = vec3<f32>(1.0 / select(rd.x, 1.0e-20, rd.x == 0.0),
                         1.0 / select(rd.y, 1.0e-20, rd.y == 0.0),
                         1.0 / select(rd.z, 1.0e-20, rd.z == 0.0));
  var stack : array<u32, 64>;
${cached ? '  var entryStack : array<f32, 64>;\n' : ''}\
  var sp = 0;
  var node = 0u;
  var closest = tMax;
  if (arrayLength(&nodes) < NODE_STRIDE || aabb_hit(node, ro, invDir, closest) < 0.0) { return result; }
  loop {
    let b = node * NODE_STRIDE;
    let count = u32(nodes[b + 9u]);
    if (count > 0u) {
      let start = u32(nodes[b + 8u]);
      for (var i = 0u; i < count; i = i + 1u) {
        let tri = ${leafOrder ? 'start + i' : 'triOrder[start + i]'};
        let h = intersect_tri(tri, ro, rd, closest);
        if (h.w > 0.5) {
          if (anyHit) {
            result.hitAny = true;
            result.t = h.x;
            result.tri = tri;
            return result;
          }
          closest = h.x;
          result.t = h.x;
          result.tri = tri;
          result.u = h.y;
          result.v = h.z;
          result.hitAny = true;
        }
      }
    } else {
      let left = u32(nodes[b + 3u]);
      let right = u32(nodes[b + 7u]);
      let leftT = aabb_hit(left, ro, invDir, closest);
      let rightT = aabb_hit(right, ro, invDir, closest);
      if (leftT >= 0.0 || rightT >= 0.0) {
        if (leftT >= 0.0 && rightT >= 0.0) {
          let leftFirst = leftT <= rightT;
          stack[sp] = select(left, right, leftFirst);
${cached ? '          entryStack[sp] = select(leftT, rightT, leftFirst);\n' : ''}\
          sp = sp + 1;
          node = select(right, left, leftFirst);
        } else {
          node = select(right, left, leftT >= 0.0);
        }
        continue;
      }
    }
    var found = false;
    loop {
      if (sp <= 0) { break; }
      sp = sp - 1;
      node = stack[sp];
      if (${cached ? 'entryStack[sp] <= closest' : 'aabb_hit(node, ro, invDir, closest) >= 0.0'}) { found = true; break; }
    }
    if (!found) { break; }
  }
  return result;
}
`;
}

// Hybrid and all callers without an explicit experiment keep the reference.
export const BVH_TRAVERSAL_WGSL = bvhTraversalWgsl();
