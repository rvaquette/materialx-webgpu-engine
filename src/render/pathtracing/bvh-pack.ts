// GPU node packing for path-tracing BVHs, kept free of scene dependencies so the
// dynamic-scene rebuild worker can import it.
import { buildBvh, type Bvh } from '../../geometry/bvh.ts';

/** Floats per packed node: [min xyz, left, max xyz, right, start, count, 0, 0]. */
export const PT_NODE_FLOATS = 12;
/** Floats per packed triangle record (positions 0-8, normals 9-17, material 18). */
export const PT_TRIANGLE_FLOATS = 19;

export function packBvhNodes(bvh: Bvh, inflate = 0): Float32Array {
  const out = new Float32Array(bvh.nodes.length * PT_NODE_FLOATS);
  for (let i = 0; i < bvh.nodes.length; i++) {
    const n = bvh.nodes[i]!;
    const b = i * PT_NODE_FLOATS;
    out[b + 0] = n.min[0] - inflate; out[b + 1] = n.min[1] - inflate; out[b + 2] = n.min[2] - inflate;
    out[b + 3] = n.left;
    out[b + 4] = n.max[0] + inflate; out[b + 5] = n.max[1] + inflate; out[b + 6] = n.max[2] + inflate;
    out[b + 7] = n.right;
    out[b + 8] = n.start;
    out[b + 9] = n.count;
  }
  return out;
}

export interface RebuiltBvh {
  nodes: Float32Array;
  nodeCount: number;
  triangleOrder: Uint32Array;
}

/** SAH rebuild over packed world-space triangle records (same builder as the initial scene). */
export function rebuildPackedBvh(triangles: Float32Array, triangleCount: number, inflate: number): RebuiltBvh {
  const positions = new Float32Array(triangleCount * 9);
  for (let t = 0; t < triangleCount; t++) positions.set(triangles.subarray(t * PT_TRIANGLE_FLOATS, t * PT_TRIANGLE_FLOATS + 9), t * 9);
  const indices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  const bvh = buildBvh(positions, indices, { splitStrategy: 'sah' });
  return { nodes: packBvhNodes(bvh, inflate), nodeCount: bvh.nodes.length, triangleOrder: bvh.triangleOrder };
}
