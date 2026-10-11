// Bounding volume hierarchies (plan sections 8, 10, T020). A BLAS is built per
// prepared geometry over its triangles; a TLAS is built over instance world-space
// bounds. Both share a median-split core and keep a primitive permutation so the
// caller can re-order per-triangle face indices and material assignments when the
// BVH reorders triangles (plan section 10). Refit updates node bounds in place
// without changing topology, for the transform-only / displacement cases.
// three-mesh-bvh's WebGPU path is unstable (plan section 4.2), so this is a small
// self-contained CPU builder; GPU layout is a separate concern.

export interface Aabb {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface BvhNode {
  min: [number, number, number];
  max: [number, number, number];
  /** Child node indices for internal nodes, -1 for leaves. */
  left: number;
  right: number;
  /** Leaf primitive range into the order array; count 0 for internal nodes. */
  start: number;
  count: number;
}

export interface Bvh {
  nodes: BvhNode[];
  /** Leaf-order permutation of original triangle ordinals. */
  triangleOrder: Uint32Array;
  bounds: Aabb;
}

export interface Tlas {
  nodes: BvhNode[];
  /** Leaf-order permutation of original instance indices. */
  instanceOrder: Uint32Array;
  bounds: Aabb;
}

export interface BuildBvhOptions {
  maxLeafTriangles?: number;
}

interface Primitive {
  index: number;
  min: [number, number, number];
  max: [number, number, number];
  centroid: [number, number, number];
}

function emptyBounds(): { min: [number, number, number]; max: [number, number, number] } {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

function expand(b: { min: number[]; max: number[] }, p: readonly number[]): void {
  for (let i = 0; i < 3; i++) {
    if (p[i]! < b.min[i]!) b.min[i] = p[i]!;
    if (p[i]! > b.max[i]!) b.max[i] = p[i]!;
  }
}

function unionInto(target: { min: number[]; max: number[] }, other: Aabb): void {
  for (let i = 0; i < 3; i++) {
    if (other.min[i]! < target.min[i]!) target.min[i] = other.min[i]!;
    if (other.max[i]! > target.max[i]!) target.max[i] = other.max[i]!;
  }
}

function buildCore(primitives: Primitive[], maxLeaf: number): { nodes: BvhNode[]; order: Uint32Array } {
  const nodes: BvhNode[] = [];
  const order: number[] = [];

  const recurse = (items: Primitive[]): number => {
    const bounds = emptyBounds();
    const centroidBounds = emptyBounds();
    for (const it of items) {
      expand(bounds, it.min);
      expand(bounds, it.max);
      expand(centroidBounds, it.centroid);
    }

    if (items.length <= maxLeaf) {
      const start = order.length;
      for (const it of items) order.push(it.index);
      const node: BvhNode = {
        min: bounds.min as [number, number, number],
        max: bounds.max as [number, number, number],
        left: -1,
        right: -1,
        start,
        count: items.length,
      };
      nodes.push(node);
      return nodes.length - 1;
    }

    // Split along the widest centroid axis at the median.
    let axis = 0;
    let widest = -Infinity;
    for (let a = 0; a < 3; a++) {
      const extent = centroidBounds.max[a]! - centroidBounds.min[a]!;
      if (extent > widest) {
        widest = extent;
        axis = a;
      }
    }
    items.sort((p, q) => p.centroid[axis]! - q.centroid[axis]!);
    const mid = items.length >> 1;
    const leftItems = items.slice(0, mid);
    const rightItems = items.slice(mid);

    const left = recurse(leftItems);
    const right = recurse(rightItems);
    const node: BvhNode = {
      min: bounds.min as [number, number, number],
      max: bounds.max as [number, number, number],
      left,
      right,
      start: 0,
      count: 0,
    };
    nodes.push(node);
    return nodes.length - 1;
  };

  if (primitives.length > 0) recurse(primitives);
  return { nodes, order: Uint32Array.from(order) };
}

function triangleBounds(
  positions: Float32Array,
  indices: Uint32Array,
  tri: number,
): { min: [number, number, number]; max: [number, number, number]; centroid: [number, number, number] } {
  const b = emptyBounds();
  for (let k = 0; k < 3; k++) {
    const v = indices[tri * 3 + k]!;
    expand(b, [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]);
  }
  return {
    min: b.min as [number, number, number],
    max: b.max as [number, number, number],
    centroid: [
      (b.min[0]! + b.max[0]!) * 0.5,
      (b.min[1]! + b.max[1]!) * 0.5,
      (b.min[2]! + b.max[2]!) * 0.5,
    ],
  };
}

export function buildBvh(positions: Float32Array, indices: Uint32Array, options: BuildBvhOptions = {}): Bvh {
  const maxLeaf = Math.max(1, options.maxLeafTriangles ?? 4);
  const triangleCount = Math.floor(indices.length / 3);
  const primitives: Primitive[] = [];
  for (let tri = 0; tri < triangleCount; tri++) {
    const tb = triangleBounds(positions, indices, tri);
    primitives.push({ index: tri, min: tb.min, max: tb.max, centroid: tb.centroid });
  }
  const { nodes, order } = buildCore(primitives, maxLeaf);
  const rootBounds: Aabb = nodes.length > 0 ? { min: nodes[nodes.length - 1]!.min, max: nodes[nodes.length - 1]!.max } : { min: [0, 0, 0], max: [0, 0, 0] };
  return { nodes, triangleOrder: order, bounds: rootBounds };
}

/** Recompute node bounds in place after vertices move; topology is unchanged. */
export function refitBvh(bvh: Bvh, positions: Float32Array, indices: Uint32Array): void {
  // Children were pushed before parents, so an ascending pass sees them first.
  for (const node of bvh.nodes) {
    const b = emptyBounds();
    if (node.left < 0) {
      for (let i = 0; i < node.count; i++) {
        const tri = bvh.triangleOrder[node.start + i]!;
        const tb = triangleBounds(positions, indices, tri);
        expand(b, tb.min);
        expand(b, tb.max);
      }
    } else {
      const l = bvh.nodes[node.left]!;
      const r = bvh.nodes[node.right]!;
      unionInto(b, { min: l.min, max: l.max });
      unionInto(b, { min: r.min, max: r.max });
    }
    node.min = b.min as [number, number, number];
    node.max = b.max as [number, number, number];
  }
  const root = bvh.nodes[bvh.nodes.length - 1];
  if (root) bvh.bounds = { min: root.min, max: root.max };
}

export function buildTlas(instanceBounds: readonly Aabb[], options: BuildBvhOptions = {}): Tlas {
  const maxLeaf = Math.max(1, options.maxLeafTriangles ?? 2);
  const primitives: Primitive[] = instanceBounds.map((bounds, index) => ({
    index,
    min: [bounds.min[0]!, bounds.min[1]!, bounds.min[2]!],
    max: [bounds.max[0]!, bounds.max[1]!, bounds.max[2]!],
    centroid: [
      (bounds.min[0]! + bounds.max[0]!) * 0.5,
      (bounds.min[1]! + bounds.max[1]!) * 0.5,
      (bounds.min[2]! + bounds.max[2]!) * 0.5,
    ],
  }));
  const { nodes, order } = buildCore(primitives, maxLeaf);
  const rootBounds: Aabb = nodes.length > 0 ? { min: nodes[nodes.length - 1]!.min, max: nodes[nodes.length - 1]!.max } : { min: [0, 0, 0], max: [0, 0, 0] };
  return { nodes, instanceOrder: order, bounds: rootBounds };
}

/** Refit a TLAS after instance transforms change; topology is unchanged. */
export function refitTlas(tlas: Tlas, instanceBounds: readonly Aabb[]): void {
  for (const node of tlas.nodes) {
    const b = emptyBounds();
    if (node.left < 0) {
      for (let i = 0; i < node.count; i++) {
        const inst = tlas.instanceOrder[node.start + i]!;
        unionInto(b, instanceBounds[inst]!);
      }
    } else {
      unionInto(b, { min: tlas.nodes[node.left]!.min, max: tlas.nodes[node.left]!.max });
      unionInto(b, { min: tlas.nodes[node.right]!.min, max: tlas.nodes[node.right]!.max });
    }
    node.min = b.min as [number, number, number];
    node.max = b.max as [number, number, number];
  }
  const root = tlas.nodes[tlas.nodes.length - 1];
  if (root) tlas.bounds = { min: root.min, max: root.max };
}

/** World-space AABB of a local AABB under a column-major 4x4 transform. */
export function transformAabb(aabb: Aabb, m: readonly number[]): Aabb {
  const b = emptyBounds();
  for (let i = 0; i < 8; i++) {
    const x = (i & 1) ? aabb.max[0]! : aabb.min[0]!;
    const y = (i & 2) ? aabb.max[1]! : aabb.min[1]!;
    const z = (i & 4) ? aabb.max[2]! : aabb.min[2]!;
    expand(b, [
      m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
      m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
      m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    ]);
  }
  return { min: b.min as [number, number, number], max: b.max as [number, number, number] };
}

/** Re-order per-triangle data to match a BLAS leaf order (preserves assignments). */
export function reorderTriangleData<T>(data: readonly T[], order: Uint32Array): T[] {
  const out: T[] = [];
  for (const i of order) out.push(data[i]!);
  return out;
}
