import { BVH_NODE_STRIDE, BVH_TRI_STRIDE } from '../../../src/render/pathtracing/bvh-wgsl.ts';
import { buildBvh } from '../../../src/geometry/bvh.ts';

export interface TraversalCase {
  name: string;
  origin: [number, number, number];
  direction: [number, number, number];
  tMax: number;
  anyHit: boolean;
  empty?: boolean;
  expected: { t: number; tri: number; u: number; v: number } | null;
}

// The right box enters first but contains a farther triangle followed by a tie
// at z=2. This deliberately distinguishes any-hit order from closest-hit order.
export function traversalFixture() {
  const nodes = new Float32Array(3 * BVH_NODE_STRIDE);
  nodes.set([-1, -1, 1, 1, 1, 1, 4, 2, 0, 0, 0, 0], 0);
  nodes.set([-1, -1, 2, 0, 1, 1, 2, 0, 0, 1, 0, 0], BVH_NODE_STRIDE);
  nodes.set([-1, -1, 1, 0, 1, 1, 4, 0, 1, 2, 0, 0], BVH_NODE_STRIDE * 2);
  const triangles = new Float32Array(3 * BVH_TRI_STRIDE);
  for (const [i, z] of [2, 3, 2].entries()) {
    triangles.set([-1, -1, z, 1, -1, z, -1, 1, z], i * BVH_TRI_STRIDE);
  }
  return { nodes, triangles, order: new Uint32Array([2, 1, 0]) };
}

export function traversalLeafOrderFixture() {
  const reference = traversalFixture();
  const triangles = new Float32Array(reference.triangles.length);
  for (let leaf = 0; leaf < reference.order.length; leaf++) {
    const source = reference.order[leaf]!;
    triangles.set(reference.triangles.subarray(source * BVH_TRI_STRIDE, (source + 1) * BVH_TRI_STRIDE),
      leaf * BVH_TRI_STRIDE);
  }
  return { nodes: reference.nodes, triangles, order: new Uint32Array(reference.order.length),
    originalTriangleIds: reference.order };
}

export function traversalWideFixture() {
  const reference = traversalFixture();
  const nodes = new Float32Array(7 * BVH_NODE_STRIDE);
  nodes.set(reference.nodes);
  nodes.set([-1, -1, 2, 3, 1, 1, 2, 4, 0, 0, 0, 0], 12);
  nodes.set([-1, -1, 1, 5, 1, 1, 4, 6, 0, 0, 0, 0], 24);
  nodes.set([-1, -1, 2, -1, 1, 1, 2, -1, 0, 1, 0, 0], 36);
  nodes.set([-1, -1, 2, -1, 1, 1, 2, -1, 1, 1, 0, 0], 48);
  nodes.set([-1, -1, 1, -1, 1, 1, 4, -1, 2, 1, 0, 0], 60);
  nodes.set([-1, -1, 2, -1, 1, 1, 2, -1, 3, 1, 0, 0], 72);
  const triangles = new Float32Array(4 * BVH_TRI_STRIDE);
  triangles.set(reference.triangles);
  triangles.set(reference.triangles.slice(48, 72), 72);
  return { nodes, triangles, order: new Uint32Array([2, 3, 1, 0]) };
}

export function traversalDeepFixture() {
  const positions = new Float32Array(128 * 9), triangles = new Float32Array(128 * BVH_TRI_STRIDE);
  for (let tri = 0; tri < 128; tri++) {
    const x = tri % 8, y = Math.floor(tri / 8) % 4, z = 1 + Math.floor(tri / 32);
    const points = [x, y, z, x + 0.75, y, z, x, y + 0.75, z];
    positions.set(points, tri * 9);
    triangles.set(points, tri * BVH_TRI_STRIDE);
  }
  const bvh = buildBvh(positions, Uint32Array.from({ length: 128 * 3 }, (_, i) => i),
    { splitStrategy: 'sah', maxLeafTriangles: 1 });
  const nodes = Float32Array.from(bvh.nodes.flatMap(n =>
    [...n.min, n.left, ...n.max, n.right, n.start, n.count, 0, 0]));
  const cases: TraversalCase[] = [];
  for (let i = 0; i < 32; i++) {
    for (const anyHit of [false, true]) {
      for (const z of [0, 1.0002, 2.0002, 5]) {
        cases.push({ name: `layered ${i}/${z}/${anyHit}`, origin: [i % 8 + 0.125, Math.floor(i / 8) + 0.125, z],
          direction: [0, 0, z === 5 ? -1 : 1], tMax: 10, anyHit, expected: null });
      }
    }
  }
  return { fixture: { nodes, triangles, order: bvh.triangleOrder }, cases };
}

const hit = (t: number, tri: number, u = 0.25, v = 0.25) => ({ t, tri, u, v });
export const traversalCases: TraversalCase[] = [
  { name: 'closest retains first triangle on exact tie', origin: [-0.5, -0.5, 0], direction: [0, 0, 1], tMax: 10, anyHit: false, expected: hit(2, 0) },
  { name: 'shadow returns first encountered, not closest', origin: [-0.5, -0.5, 0], direction: [0, 0, 1], tMax: 10, anyHit: true, expected: hit(3, 1) },
  { name: 'shadow strict endpoint', origin: [-0.5, -0.5, 0], direction: [0, 0, 1], tMax: 2, anyHit: true, expected: null },
  { name: 'closest strict endpoint', origin: [-0.5, -0.5, 0], direction: [0, 0, 1], tMax: 2, anyHit: false, expected: null },
  { name: 'bounded shadow skips farther triangle', origin: [-0.5, -0.5, 0], direction: [0, 0, 1], tMax: 2.5, anyHit: true, expected: hit(2, 0) },
  { name: 'single child box without triangle in range', origin: [-0.5, -0.5, 0], direction: [0, 0, 1], tMax: 1.5, anyHit: true, expected: null },
  { name: 'parallel to triangle planes', origin: [0, -0.5, 2], direction: [1, 0, 0], tMax: 10, anyHit: false, expected: null },
  { name: 'parallel outside slabs', origin: [2, 0, 0], direction: [0, 0, 1], tMax: 10, anyHit: false, expected: null },
  { name: 'signed zero parallel', origin: [-0.5, -0.5, 0], direction: [-0, 0, 1], tMax: 10, anyHit: false, expected: hit(2, 0) },
  { name: 'box and triangle vertex boundary', origin: [-1, -1, 0], direction: [0, 0, 1], tMax: 10, anyHit: false, expected: hit(2, 0, 0, 0) },
  { name: 'retains reference max-face parallel slab convention', origin: [1, -1, 0], direction: [0, 0, 1], tMax: 10, anyHit: false, expected: null },
  { name: 'triangle hypotenuse boundary', origin: [0, 0, 0], direction: [0, 0, 1], tMax: 10, anyHit: false, expected: hit(2, 0, 0.5, 0.5) },
  { name: 'inside box reverse ray', origin: [-0.5, -0.5, 4], direction: [0, 0, -1], tMax: 10, anyHit: false, expected: hit(1, 1) },
  { name: 'ray starts on triangle', origin: [-0.5, -0.5, 2], direction: [0, 0, 1], tMax: 10, anyHit: false, expected: hit(1, 1) },
  { name: 'all triangles behind', origin: [-0.5, -0.5, 5], direction: [0, 0, 1], tMax: 10, anyHit: true, expected: null },
  { name: 'empty closest', origin: [0, 0, 0], direction: [0, 0, 1], tMax: 10, anyHit: false, empty: true, expected: null },
  { name: 'empty shadow', origin: [0, 0, 0], direction: [0, 0, 1], tMax: 10, anyHit: true, empty: true, expected: null },
];
