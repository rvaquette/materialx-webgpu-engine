import { describe, expect, it } from 'vitest';
import { BVH_TRAVERSAL_WGSL, bvhTraversalWgsl } from '../../../src/render/pathtracing/bvh-wgsl.ts';
import { traversalCases, traversalFixture, type TraversalCase } from './bvh-traversal-cases.ts';

const EPS = 1e-4;
const fixture = traversalFixture();

function boxEntry(node: number, ray: TraversalCase, limit: number): number {
  let near = EPS, far = limit;
  for (let a = 0; a < 3; a++) {
    const inv = 1 / (ray.direction[a] === 0 ? 1e-20 : ray.direction[a]!);
    const lo = (fixture.nodes[node * 12 + a]! - ray.origin[a]!) * inv;
    const hi = (fixture.nodes[node * 12 + 4 + a]! - ray.origin[a]!) * inv;
    near = Math.max(near, Math.min(lo, hi));
    far = Math.min(far, Math.max(lo, hi));
    if (far < near) return -1;
  }
  return near;
}

// Independent analytic triangle oracle for the fixture's parallel z planes.
function triangleHit(tri: number, ray: TraversalCase, limit: number) {
  const b = tri * 24;
  const t = (fixture.triangles[b + 2]! - ray.origin[2]) / ray.direction[2];
  if (!Number.isFinite(t) || t <= EPS || t >= limit) return null;
  const x = ray.origin[0] + ray.direction[0] * t;
  const y = ray.origin[1] + ray.direction[1] * t;
  const u = (x + 1) / 2, v = (y + 1) / 2;
  return u < 0 || v < 0 || u + v > 1 ? null : { t, tri, u, v };
}

function trace(ray: TraversalCase) {
  let aabbTests = 0, closest = ray.tMax, node = 0;
  let hit: TraversalCase['expected'] = null;
  const visited: number[] = [];
  const stack: number[] = [];
  const test = (n: number) => { aabbTests++; return boxEntry(n, ray, closest); };
  if (ray.empty || test(0) < 0) return { hit, aabbTests, visited };
  while (true) {
    visited.push(node);
    const b = node * 12, count = fixture.nodes[b + 9]!;
    if (count) {
      for (let i = 0; i < count; i++) {
        const tri = fixture.order[fixture.nodes[b + 8]! + i]!;
        const h = triangleHit(tri, ray, closest);
        if (h) {
          hit = h;
          if (ray.anyHit) return { hit, aabbTests, visited };
          closest = h.t;
        }
      }
    } else {
      const left = fixture.nodes[b + 3]!, right = fixture.nodes[b + 7]!;
      const leftT = test(left), rightT = test(right);
      if (leftT >= 0 || rightT >= 0) {
        if (leftT >= 0 && rightT >= 0) {
          const leftFirst = leftT <= rightT;
          stack.push(leftFirst ? right : left);
          node = leftFirst ? left : right;
        } else node = leftT >= 0 ? left : right;
        continue;
      }
    }
    let found = false;
    while (stack.length) {
      node = stack.pop()!;
      if (test(node) >= 0) { found = true; break; }
    }
    if (!found) return { hit, aabbTests, visited };
  }
}

describe('shared BVH traversal', () => {
  it('shares canonical traversal and keeps inclusive AABB ties', () => {
    expect(bvhTraversalWgsl()).toBe(BVH_TRAVERSAL_WGSL);
    expect(BVH_TRAVERSAL_WGSL).not.toContain('entryStack');
    expect(BVH_TRAVERSAL_WGSL).toContain('aabb_hit(node, ro, invDir, closest) >= 0.0');
    expect(BVH_TRAVERSAL_WGSL).toContain('let tri = triOrder[start + i];');
  });

  it.each(traversalCases)('$name', ray => {
    expect(trace(ray).hit).toEqual(ray.expected);
  });

  it('visits the pending box even when its entry equals closest', () => {
    const reference = trace(traversalCases[0]!);
    expect(reference.visited).toEqual([0, 2, 1]);
    expect(reference.aabbTests).toBe(4);
  });
});
