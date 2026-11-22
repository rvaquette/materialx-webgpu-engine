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
  splitStrategy?: 'median' | 'sah';
}

/** Primitive bounds and centroids in flat float64 arrays (3 per primitive). */
class Primitives {
  readonly min: Float64Array;
  readonly max: Float64Array;
  readonly centroid: Float64Array;

  constructor(readonly count: number) {
    this.min = new Float64Array(count * 3);
    this.max = new Float64Array(count * 3);
    this.centroid = new Float64Array(count * 3);
  }

  set(index: number, min: readonly number[], max: readonly number[]): void {
    for (let a = 0; a < 3; a++) {
      this.min[index * 3 + a] = min[a]!;
      this.max[index * 3 + a] = max[a]!;
      this.centroid[index * 3 + a] = (min[a]! + max[a]!) * 0.5;
    }
  }
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

const SAH_BINS = 16;

function boxArea(b: Float64Array, offset: number): number {
  const x = b[offset + 3]! - b[offset]!, y = b[offset + 4]! - b[offset + 1]!, z = b[offset + 5]! - b[offset + 2]!;
  return 2 * (x * y + x * z + y * z);
}

/**
 * Top-down build over flat arrays: binned SAH (16 bins per axis) with a stable
 * partition, falling back to a stable median split on the widest centroid axis.
 * Nodes are emitted in pre-order so the root is node 0.
 */
function buildCore(primitives: Primitives, maxLeaf: number, strategy: 'median' | 'sah' = 'median'): { nodes: BvhNode[]; order: Uint32Array } {
  const { min, max, centroid, count } = primitives;
  const nodes: BvhNode[] = [];
  const order = new Uint32Array(count);
  let orderLength = 0;
  const items = new Uint32Array(count);
  for (let i = 0; i < count; i++) items[i] = i;
  const scratch = new Uint32Array(count);
  // Per bin: min xyz, max xyz.
  const buckets = new Float64Array(SAH_BINS * 6);
  const bucketCounts = new Uint32Array(SAH_BINS);
  const rightCosts = new Float64Array(SAH_BINS);
  const rightCounts = new Uint32Array(SAH_BINS);
  const sweep = new Float64Array(6);
  const centroidMin = [0, 0, 0], centroidMax = [0, 0, 0];

  const resetBox = (box: Float64Array, offset: number): void => {
    box[offset] = box[offset + 1] = box[offset + 2] = Infinity;
    box[offset + 3] = box[offset + 4] = box[offset + 5] = -Infinity;
  };
  const unionBucket = (box: Float64Array, bin: number): void => {
    for (let a = 0; a < 3; a++) {
      if (buckets[bin * 6 + a]! < box[a]!) box[a] = buckets[bin * 6 + a]!;
      if (buckets[bin * 6 + 3 + a]! > box[3 + a]!) box[3 + a] = buckets[bin * 6 + 3 + a]!;
    }
  };
  const binOf = (item: number, axis: number, extent: number): number =>
    Math.min(SAH_BINS - 1, Math.floor((centroid[item * 3 + axis]! - centroidMin[axis]!) / extent * SAH_BINS));

  /** Returns the split point of a stable SAH partition of items[start, end), or -1. */
  const sahPartition = (start: number, end: number): number => {
    let bestCost = Infinity, bestAxis = -1, bestBin = -1;
    for (let axis = 0; axis < 3; axis++) {
      const extent = centroidMax[axis]! - centroidMin[axis]!;
      if (extent <= 0) continue;
      for (let bin = 0; bin < SAH_BINS; bin++) { resetBox(buckets, bin * 6); bucketCounts[bin] = 0; }
      for (let k = start; k < end; k++) {
        const item = items[k]!;
        const o = binOf(item, axis, extent) * 6;
        for (let a = 0; a < 3; a++) {
          const lo = min[item * 3 + a]!, hi = max[item * 3 + a]!;
          if (lo < buckets[o + a]!) buckets[o + a] = lo;
          if (hi > buckets[o + 3 + a]!) buckets[o + 3 + a] = hi;
        }
        bucketCounts[o / 6]!++;
      }
      resetBox(sweep, 0);
      let sum = 0;
      for (let i = SAH_BINS - 1; i >= 0; i--) {
        if (bucketCounts[i]) unionBucket(sweep, i);
        sum += bucketCounts[i]!;
        rightCounts[i] = sum;
        rightCosts[i] = sum ? boxArea(sweep, 0) * sum : 0;
      }
      resetBox(sweep, 0);
      sum = 0;
      for (let i = 0; i < SAH_BINS - 1; i++) {
        if (bucketCounts[i]) unionBucket(sweep, i);
        sum += bucketCounts[i]!;
        if (!sum || !rightCounts[i + 1]) continue;
        const cost = boxArea(sweep, 0) * sum + rightCosts[i + 1]!;
        if (cost < bestCost) { bestCost = cost; bestAxis = axis; bestBin = i; }
      }
    }
    if (bestAxis < 0) return -1;
    const extent = centroidMax[bestAxis]! - centroidMin[bestAxis]!;
    let left = start, right = 0;
    for (let k = start; k < end; k++) {
      const item = items[k]!;
      if (binOf(item, bestAxis, extent) <= bestBin) items[left++] = item;
      else scratch[right++] = item;
    }
    items.set(scratch.subarray(0, right), left);
    return left > start && right > 0 ? left : -1;
  };

  const recurse = (start: number, end: number, depth: number): number => {
    const bounds = emptyBounds();
    const centroidBounds = emptyBounds();
    for (let k = start; k < end; k++) {
      const o = items[k]! * 3;
      for (let a = 0; a < 3; a++) {
        if (min[o + a]! < bounds.min[a]!) bounds.min[a] = min[o + a]!;
        if (min[o + a]! > bounds.max[a]!) bounds.max[a] = min[o + a]!;
        if (max[o + a]! < bounds.min[a]!) bounds.min[a] = max[o + a]!;
        if (max[o + a]! > bounds.max[a]!) bounds.max[a] = max[o + a]!;
        if (centroid[o + a]! < centroidBounds.min[a]!) centroidBounds.min[a] = centroid[o + a]!;
        if (centroid[o + a]! > centroidBounds.max[a]!) centroidBounds.max[a] = centroid[o + a]!;
      }
    }

    // Reserve this node's slot before recursing so the root lands at index 0;
    // both path-tracer traversals (CPU and WGSL) start from node 0.
    const self = nodes.length;
    const node: BvhNode = { min: bounds.min, max: bounds.max, left: -1, right: -1, start: 0, count: 0 };
    nodes.push(node);

    if (end - start <= maxLeaf) {
      node.start = orderLength;
      node.count = end - start;
      for (let k = start; k < end; k++) order[orderLength++] = items[k]!;
      return self;
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
    for (let a = 0; a < 3; a++) { centroidMin[a] = centroidBounds.min[a]!; centroidMax[a] = centroidBounds.max[a]!; }
    // Switch to balanced splits before the shader's 64-entry traversal stack is exhausted.
    let mid = strategy === 'sah' && depth < 40 ? sahPartition(start, end) : -1;
    if (mid < 0) {
      const sorted = Array.from(items.subarray(start, end)).sort((p, q) => centroid[p * 3 + axis]! - centroid[q * 3 + axis]!);
      items.set(sorted, start);
      mid = start + ((end - start) >> 1);
    }
    node.left = recurse(start, mid, depth + 1);
    node.right = recurse(mid, end, depth + 1);
    return self;
  };

  if (count > 0) recurse(0, count, 0);
  return { nodes, order };
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
  const primitives = new Primitives(triangleCount);
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let tri = 0; tri < triangleCount; tri++) {
    for (let a = 0; a < 3; a++) { lo[a] = Infinity; hi[a] = -Infinity; }
    for (let k = 0; k < 3; k++) {
      const v = indices[tri * 3 + k]! * 3;
      for (let a = 0; a < 3; a++) {
        const p = positions[v + a]!;
        if (p < lo[a]!) lo[a] = p;
        if (p > hi[a]!) hi[a] = p;
      }
    }
    primitives.set(tri, lo, hi);
  }
  const { nodes, order } = buildCore(primitives, maxLeaf, options.splitStrategy);
  const rootBounds: Aabb = nodes.length > 0 ? { min: nodes[0]!.min, max: nodes[0]!.max } : { min: [0, 0, 0], max: [0, 0, 0] };
  return { nodes, triangleOrder: order, bounds: rootBounds };
}
/** Recompute node bounds in place after vertices move; topology is unchanged. */
export function refitBvh(bvh: Bvh, positions: Float32Array, indices: Uint32Array): void {
  // Parents precede their children, so a descending pass refits children first.
  for (let n = bvh.nodes.length - 1; n >= 0; n--) {
    const node = bvh.nodes[n]!;
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
  const root = bvh.nodes[0];
  if (root) bvh.bounds = { min: root.min, max: root.max };
}

export function buildTlas(instanceBounds: readonly Aabb[], options: BuildBvhOptions = {}): Tlas {
  const maxLeaf = Math.max(1, options.maxLeafTriangles ?? 2);
  const primitives = new Primitives(instanceBounds.length);
  instanceBounds.forEach((bounds, index) => primitives.set(index, bounds.min, bounds.max));
  const { nodes, order } = buildCore(primitives, maxLeaf, options.splitStrategy);
  const rootBounds: Aabb = nodes.length > 0 ? { min: nodes[0]!.min, max: nodes[0]!.max } : { min: [0, 0, 0], max: [0, 0, 0] };
  return { nodes, instanceOrder: order, bounds: rootBounds };
}

/** Refit a TLAS after instance transforms change; topology is unchanged. */
export function refitTlas(tlas: Tlas, instanceBounds: readonly Aabb[]): void {
  // Parents precede their children, so a descending pass refits children first.
  for (let n = tlas.nodes.length - 1; n >= 0; n--) {
    const node = tlas.nodes[n]!;
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
  const root = tlas.nodes[0];
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
