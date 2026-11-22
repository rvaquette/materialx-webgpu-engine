// Dynamic path-tracing geometry: rewrites the world-space triangle records of
// moved, hidden or deformed instances exactly as buildPathTraceScene packs them,
// then refits the BVH bounds of the affected leaves and their ancestors. The
// topology (triangle order, leaves) is kept: large motions degrade traversal
// quality but never correctness. Refits track the inner-node area relative to
// the leaves' (area x triangle count): rigid or uniform scene motion keeps it,
// while subtrees drifting apart inflate it. Once it exceeds REBUILD_COST_RATIO
// times its value after the last build, the caller rebuilds the topology
// (rebuildPackedBvh) and hands it to adopt().
// Arrays shared with geometry caches are copied on the first update so cached
// scenes stay intact.
import type { Mat4 } from '../../scene/transforms.ts';
import { PT_NODE_FLOATS, PT_TRIANGLE_FLOATS, type PathTraceScene, type PathTraceTransformRange } from './scene-buffers.ts';

/** Object-space source of one instance's triangles (its prototype geometry). */
export interface DynamicInstanceSource {
  model: Mat4;
  indices: Uint32Array;
  positions: Float32Array;
  normals?: Float32Array;
  tangents?: { data: Float32Array; components: number };
  /** A hidden instance keeps its triangles, collapsed to points that rays never hit. */
  hidden?: boolean;
}

export interface DynamicUpload {
  /** Updated triangle record span [first, end). */
  triangles?: [number, number];
  /** Updated world tangent span [first, end) in triangles. */
  tangents?: [number, number];
  /** Contiguous dirty node runs [first, end). */
  nodes: Array<[number, number]>;
  /** The node array was replaced (adopt): its size and the triangle order may have changed. */
  topology?: boolean;
}

const TANGENT_STRIDE = 12;
const FULL_REFIT_FRACTION = 0.25;
/** Rebuild once the inner/leaf area ratio grows by this factor. */
export const REBUILD_COST_RATIO = 1.5;


export class PathTraceDynamics {
  #owned = false;
  #parents: Int32Array | undefined;
  #leafOfTriangle: Int32Array | undefined;
  readonly #inflation: number;
  /** Area sums: inner nodes, and leaves weighted by their triangle count. */
  #inner = 0;
  #leaves = 0;
  #builtCost = 1;

  constructor(readonly scene: PathTraceScene) {
    let inflation = 0;
    for (const scale of scene.displacement?.scale ?? []) inflation = Math.max(inflation, 0.5 * Math.abs(scale));
    this.#inflation = inflation;
    this.#totalCost();
    this.#builtCost = this.#normalizedCost();
  }

  get inflation(): number { return this.#inflation; }

  /** Current SAH cost relative to the last build (1 right after a build). */
  get costRatio(): number {
    return this.#builtCost > 0 ? this.#normalizedCost() / this.#builtCost : 1;
  }

  get needsRebuild(): boolean { return this.costRatio > REBUILD_COST_RATIO; }

  /**
   * Replace the BVH topology with a rebuilt one. It may have been built from
   * older triangle positions, so it is fully refitted to the current ones.
   */
  adopt(nodes: Float32Array, nodeCount: number, triangleOrder: Uint32Array): DynamicUpload {
    if (triangleOrder.length !== this.scene.triangleCount || nodes.length < nodeCount * PT_NODE_FLOATS) {
      throw new Error('The rebuilt BVH does not match the path tracing scene.');
    }
    this.#own();
    this.scene.nodes = nodes;
    this.scene.nodeCount = nodeCount;
    this.scene.triangleOrder = triangleOrder;
    this.#parents = undefined;
    this.#leafOfTriangle = undefined;
    // Reference cost: the tree as built (tight around its snapshot); the refit to
    // newer positions may already be degraded and then asks for another rebuild.
    this.#totalCost();
    this.#builtCost = this.#normalizedCost();
    for (let node = nodeCount - 1; node >= 0; node--) this.#refitNode(node);
    this.#totalCost();
    this.#updateBounds();
    return { nodes: [[0, nodeCount]], topology: true };
  }

  #area(node: number): number {
    const n = this.scene.nodes, b = node * PT_NODE_FLOATS;
    const x = n[b + 4]! - n[b]!, y = n[b + 5]! - n[b + 1]!, z = n[b + 6]! - n[b + 2]!;
    return x >= 0 && y >= 0 && z >= 0 ? 2 * (x * y + x * z + y * z) : 0;
  }

  /** Adds (sign 1) or removes (sign -1) a node's contribution to the area sums. */
  #account(node: number, sign: number): void {
    const count = this.scene.nodes[node * PT_NODE_FLOATS + 9]!;
    if (count > 0) this.#leaves += sign * this.#area(node) * count;
    else this.#inner += sign * this.#area(node);
  }

  #totalCost(): void {
    this.#inner = 0;
    this.#leaves = 0;
    for (let node = 0; node < this.scene.nodeCount; node++) this.#account(node, 1);
  }

  #normalizedCost(): number {
    return this.#leaves > 0 ? this.#inner / this.#leaves : 0;
  }

  #updateBounds(): void {
    const nodes = this.scene.nodes;
    this.scene.bounds = { min: [nodes[0]!, nodes[1]!, nodes[2]!], max: [nodes[4]!, nodes[5]!, nodes[6]!] };
  }

  /** Rewrite the triangles of the given ranges, then refit the BVH. */
  update(updates: ReadonlyArray<{ range: PathTraceTransformRange; source: DynamicInstanceSource }>): DynamicUpload {
    if (updates.length === 0) return { nodes: [] };
    this.#own();
    const scene = this.scene;
    let first = Infinity, end = -Infinity;
    const hasTangents = scene.triangleTangent.length > 0;
    for (const { range, source } of updates) {
      if (source.indices.length !== range.triangleCount * 3) {
        throw new Error(`Geometry topology changed for instance '${range.instanceId}'.`);
      }
      range.model = source.model;
      writeRange(scene, range, source, hasTangents);
      first = Math.min(first, range.firstTriangle);
      end = Math.max(end, range.firstTriangle + range.triangleCount);
    }
    const nodes = this.#refit(updates.map(({ range }) => range));
    this.#updateBounds();
    return { triangles: [first, end], ...(hasTangents ? { tangents: [first, end] as [number, number] } : {}), nodes };
  }

  #own(): void {
    if (this.#owned) return;
    this.scene.nodes = this.scene.nodes.slice();
    this.scene.triangles = this.scene.triangles.slice();
    this.scene.triangleTangent = this.scene.triangleTangent.slice();
    this.#owned = true;
  }

  #topology(): { parents: Int32Array; leafOfTriangle: Int32Array } {
    if (this.#parents && this.#leafOfTriangle) return { parents: this.#parents, leafOfTriangle: this.#leafOfTriangle };
    const { nodes, nodeCount, triangleOrder, triangleCount } = this.scene;
    const parents = new Int32Array(nodeCount).fill(-1);
    const leafOfTriangle = new Int32Array(triangleCount).fill(-1);
    for (let node = 0; node < nodeCount; node++) {
      const base = node * PT_NODE_FLOATS;
      const count = nodes[base + 9]!;
      if (count > 0) {
        const start = nodes[base + 8]!;
        for (let i = start; i < start + count; i++) leafOfTriangle[triangleOrder[i]!] = node;
      } else {
        parents[nodes[base + 3]!] = node;
        parents[nodes[base + 7]!] = node;
      }
    }
    this.#parents = parents;
    this.#leafOfTriangle = leafOfTriangle;
    return { parents, leafOfTriangle };
  }

  #refit(ranges: readonly PathTraceTransformRange[]): Array<[number, number]> {
    const { nodeCount } = this.scene;
    if (nodeCount === 0) return [];
    const { parents, leafOfTriangle } = this.#topology();
    const dirty = new Uint8Array(nodeCount);
    const list: number[] = [];
    const changed = ranges.reduce((sum, range) => sum + range.triangleCount, 0);
    if (changed > FULL_REFIT_FRACTION * this.scene.triangleCount) {
      for (let node = nodeCount - 1; node >= 0; node--) this.#refitNode(node);
      this.#totalCost();
      return [[0, nodeCount]];
    }
    for (const range of ranges) {
      for (let triangle = range.firstTriangle; triangle < range.firstTriangle + range.triangleCount; triangle++) {
        for (let node = leafOfTriangle[triangle]!; node >= 0 && !dirty[node]; node = parents[node]!) {
          dirty[node] = 1;
          list.push(node);
        }
      }
    }
    // Pre-order layout: children always follow their parent, so descending order refits bottom-up.
    list.sort((a, b) => b - a);
    for (const node of list) {
      this.#account(node, -1);
      this.#refitNode(node);
      this.#account(node, 1);
    }
    const runs: Array<[number, number]> = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const node = list[i]!;
      const last = runs[runs.length - 1];
      if (last && last[1] === node) last[1] = node + 1;
      else runs.push([node, node + 1]);
    }
    return runs;
  }

  #refitNode(node: number): void {
    const { nodes, triangles, triangleOrder } = this.scene;
    const base = node * PT_NODE_FLOATS;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const count = nodes[base + 9]!;
    if (count > 0) {
      const start = nodes[base + 8]!;
      for (let i = start; i < start + count; i++) {
        const t = triangleOrder[i]! * PT_TRIANGLE_FLOATS;
        for (let v = 0; v < 9; v += 3) {
          const x = triangles[t + v]!, y = triangles[t + v + 1]!, z = triangles[t + v + 2]!;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
      const pad = this.#inflation;
      minX -= pad; minY -= pad; minZ -= pad; maxX += pad; maxY += pad; maxZ += pad;
    } else {
      for (const child of [nodes[base + 3]!, nodes[base + 7]!]) {
        const c = child * PT_NODE_FLOATS;
        minX = Math.min(minX, nodes[c]!); minY = Math.min(minY, nodes[c + 1]!); minZ = Math.min(minZ, nodes[c + 2]!);
        maxX = Math.max(maxX, nodes[c + 4]!); maxY = Math.max(maxY, nodes[c + 5]!); maxZ = Math.max(maxZ, nodes[c + 6]!);
      }
    }
    nodes[base] = minX; nodes[base + 1] = minY; nodes[base + 2] = minZ;
    nodes[base + 4] = maxX; nodes[base + 5] = maxY; nodes[base + 6] = maxZ;
  }
}

/** Same per-triangle packing (and float operation order) as buildPathTraceScene, without allocations. */
function writeRange(scene: PathTraceScene, range: PathTraceTransformRange, source: DynamicInstanceSource, hasTangents: boolean): void {
  const { model: m, indices, positions, normals, tangents, hidden } = source;
  const modelSign = Math.sign(
    (m[1]! * m[6]! - m[2]! * m[5]!) * m[8]! +
    (m[2]! * m[4]! - m[0]! * m[6]!) * m[9]! +
    (m[0]! * m[5]! - m[1]! * m[4]!) * m[10]!) < 0 ? -1 : 1;
  const out = scene.triangles;
  const v = new Float64Array(9);
  const point = (vertex: number, slot: number): void => {
    const x = positions[vertex * 3]!, y = positions[vertex * 3 + 1]!, z = positions[vertex * 3 + 2]!;
    v[slot] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    v[slot + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    v[slot + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  };
  const direction = (data: Float32Array, vertex: number, stride: number, target: Float32Array, offset: number): void => {
    const x = data[vertex * stride]!, y = data[vertex * stride + 1]!, z = data[vertex * stride + 2]!;
    const dx = m[0]! * x + m[4]! * y + m[8]! * z;
    const dy = m[1]! * x + m[5]! * y + m[9]! * z;
    const dz = m[2]! * x + m[6]! * y + m[10]! * z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    target[offset] = length > 0 ? dx / length : dx;
    target[offset + 1] = length > 0 ? dy / length : dy;
    target[offset + 2] = length > 0 ? dz / length : dz;
  };
  for (let t = 0; t < range.triangleCount; t++) {
    const triangle = range.firstTriangle + t;
    const base = triangle * PT_TRIANGLE_FLOATS;
    const ia = indices[t * 3]!, ib = indices[t * 3 + 1]!, ic = indices[t * 3 + 2]!;
    point(ia, 0);
    if (hidden) { v[3] = v[6] = v[0]!; v[4] = v[7] = v[1]!; v[5] = v[8] = v[2]!; }
    else { point(ib, 3); point(ic, 6); }
    for (let k = 0; k < 9; k++) out[base + k] = v[k]!;
    if (normals) {
      direction(normals, ia, 3, out, base + 9);
      direction(normals, ib, 3, out, base + 12);
      direction(normals, ic, 3, out, base + 15);
    } else {
      const e1x = v[3]! - v[0]!, e1y = v[4]! - v[1]!, e1z = v[5]! - v[2]!;
      const e2x = v[6]! - v[0]!, e2y = v[7]! - v[1]!, e2z = v[8]! - v[2]!;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      for (let slot = 9; slot < 18; slot += 3) {
        out[base + slot] = length > 0 ? nx / length : nx;
        out[base + slot + 1] = length > 0 ? ny / length : ny;
        out[base + slot + 2] = length > 0 ? nz / length : nz;
      }
    }
    if (!hasTangents) continue;
    const tb = triangle * TANGENT_STRIDE;
    if (!tangents) {
      scene.triangleTangent.fill(0, tb, tb + TANGENT_STRIDE);
      continue;
    }
    const stride = tangents.components;
    for (const [slot, vertex] of [ia, ib, ic].entries()) {
      direction(tangents.data, vertex, stride, scene.triangleTangent, tb + slot * 4);
      scene.triangleTangent[tb + slot * 4 + 3] = modelSign * (stride >= 4 ? tangents.data[vertex * stride + 3]! : 1);
    }
  }
}
