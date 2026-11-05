import { BVH_TRI_STRIDE } from './bvh-wgsl.ts';

/** GPU displacement pre-pass. */
export function pathTraceDisplacementWgsl(): string {
  return /* wgsl */ `
struct DispInfo { triCount: u32, midpoint: f32, pad0: u32, pad1: u32 };

@group(0) @binding(0) var<storage, read_write> tris: array<f32>;
@group(0) @binding(1) var<storage, read> uvs: array<f32>;
@group(0) @binding(2) var<storage, read> scales: array<f32>;
@group(0) @binding(3) var<uniform> info: DispInfo;
@group(0) @binding(4) var dispTex: texture_2d<f32>;
@group(0) @binding(5) var dispSamp: sampler;

const STRIDE: u32 = ${BVH_TRI_STRIDE}u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= info.triCount) { return; }
  let base = t * STRIDE;
  let matIdx = u32(tris[base + 18u]);
  let scale = scales[matIdx];
  if (scale == 0.0) { return; }
  let ub = t * 6u;
  var p0 = vec3<f32>(tris[base + 0u], tris[base + 1u], tris[base + 2u]);
  var p1 = vec3<f32>(tris[base + 3u], tris[base + 4u], tris[base + 5u]);
  var p2 = vec3<f32>(tris[base + 6u], tris[base + 7u], tris[base + 8u]);
  let n0 = vec3<f32>(tris[base + 9u], tris[base + 10u], tris[base + 11u]);
  let n1 = vec3<f32>(tris[base + 12u], tris[base + 13u], tris[base + 14u]);
  let n2 = vec3<f32>(tris[base + 15u], tris[base + 16u], tris[base + 17u]);
  let uv0 = vec2<f32>(uvs[ub + 0u], uvs[ub + 1u]);
  let uv1 = vec2<f32>(uvs[ub + 2u], uvs[ub + 3u]);
  let uv2 = vec2<f32>(uvs[ub + 4u], uvs[ub + 5u]);
  let h0 = textureSampleLevel(dispTex, dispSamp, uv0, 0.0).r;
  let h1 = textureSampleLevel(dispTex, dispSamp, uv1, 0.0).r;
  let h2 = textureSampleLevel(dispTex, dispSamp, uv2, 0.0).r;
  p0 = p0 + n0 * ((h0 - info.midpoint) * scale);
  p1 = p1 + n1 * ((h1 - info.midpoint) * scale);
  p2 = p2 + n2 * ((h2 - info.midpoint) * scale);
  tris[base + 0u] = p0.x; tris[base + 1u] = p0.y; tris[base + 2u] = p0.z;
  tris[base + 3u] = p1.x; tris[base + 4u] = p1.y; tris[base + 5u] = p1.z;
  tris[base + 6u] = p2.x; tris[base + 7u] = p2.y; tris[base + 8u] = p2.z;
  // Recompute a flat geometric normal from the displaced positions, keeping the
  // winding-consistent orientation of the original interpolated normals.
  let faceN = normalize(cross(p1 - p0, p2 - p0));
  let orient = sign(dot(faceN, n0 + n1 + n2));
  let gn = faceN * orient;
  tris[base + 9u] = gn.x; tris[base + 10u] = gn.y; tris[base + 11u] = gn.z;
  tris[base + 12u] = gn.x; tris[base + 13u] = gn.y; tris[base + 14u] = gn.z;
  tris[base + 15u] = gn.x; tris[base + 16u] = gn.y; tris[base + 17u] = gn.z;
}
`;
}
