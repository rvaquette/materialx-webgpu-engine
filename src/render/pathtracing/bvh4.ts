export const BVH4_FLOATS = 48;
export const BVH4_STACK = 96;

/** Collapse two binary levels, retaining sibling groups for exact near-first ties. */
export function packBvh4(nodes: Float32Array): Float32Array {
  if (nodes.length % 12) throw new Error('BVH4 requires complete binary node records.');
  if (!nodes.length) return new Float32Array(0);
  const records: number[][] = [];
  const visited = new Set<number>();
  const visit = (index: number, depth: number): number => {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length / 12 || depth >= 64 || visited.has(index)) {
      throw new Error('Invalid binary topology or depth for BVH4.');
    }
    visited.add(index);
    return index * 12;
  };
  const emit = (index: number, depth: number): number => {
    const base = visit(index, depth), wideIndex = records.length;
    const record = new Array<number>(BVH4_FLOATS).fill(0);
    for (let lane = 0; lane < 4; lane++) record[lane * 12 + 9] = -1;
    records.push(record);
    const slots: { index: number; depth: number; lane: number }[] = [];
    if (nodes[base + 9]! > 0) {
      slots.push({ index, depth, lane: 0 });
    } else {
      for (let group = 0; group < 2; group++) {
        const child = nodes[base + (group === 0 ? 3 : 7)]!, cb = visit(child, depth + 1);
        if (nodes[cb + 9]! > 0) {
          slots.push({ index: child, depth: depth + 1, lane: group * 2 });
        } else {
          slots.push({ index: nodes[cb + 3]!, depth: depth + 2, lane: group * 2 },
            { index: nodes[cb + 7]!, depth: depth + 2, lane: group * 2 + 1 });
        }
      }
    }
    for (const slot of slots) {
      const source = slot.index * 12, target = slot.lane * 12;
      if (nodes[source + 9]! > 0) {
        if (slot.depth === depth + 2) visit(slot.index, slot.depth);
        for (let i = 0; i < 12; i++) record[target + i] = nodes[source + i]!;
      } else {
        const childWide = emit(slot.index, slot.depth);
        for (let i = 0; i < 12; i++) record[target + i] = nodes[source + i]!;
        record[target + 3] = childWide;
        record[target + 7] = -1;
      }
    }
    // Reconstructed group bounds must equal the removed binary nodes exactly.
    const checkUnion = (lanes: number[], binary: number) => {
      for (let axis = 0; axis < 3; axis++) {
        const lo = Math.min(...lanes.map(lane => record[lane * 12 + axis]!));
        const hi = Math.max(...lanes.map(lane => record[lane * 12 + 4 + axis]!));
        if (lo !== nodes[binary * 12 + axis] || hi !== nodes[binary * 12 + 4 + axis]) {
          throw new Error('BVH4 cannot reconstruct the exact binary bounds.');
        }
      }
    };
    for (let group = 0; group < 2; group++) {
      const lanes = slots.filter(slot => Math.floor(slot.lane / 2) === group).map(slot => slot.lane);
      if (lanes.length) checkUnion(lanes, nodes[base + 9]! > 0 ? index : nodes[base + (group === 0 ? 3 : 7)]!);
    }
    checkUnion(slots.map(slot => slot.lane), index);
    return wideIndex;
  };
  emit(0, 0);
  if (visited.size !== nodes.length / 12) throw new Error('Unreachable binary nodes in BVH4.');
  const packed = new Float32Array(records.length * BVH4_FLOATS);
  for (const [index, record] of records.entries()) packed.set(record, index * BVH4_FLOATS);
  return packed;
}

export function bvh4TraversalWgsl(): string {
  return /* wgsl */ `
const WIDE_STRIDE = ${BVH4_FLOATS}u;
fn box_entry(lo : vec3f, hi : vec3f, ro : vec3f, invDir : vec3f, tMax : f32) -> f32 {
  var tmin = RAY_EPS;
  var tmax = tMax;
  for (var a = 0u; a < 3u; a++) {
    let l = (lo[a] - ro[a]) * invDir[a];
    let h = (hi[a] - ro[a]) * invDir[a];
    tmin = max(tmin, min(l, h));
    tmax = min(tmax, max(l, h));
    if (tmax < tmin) { return -1.0; }
  }
  return tmin;
}
fn slot_min(slot : u32) -> vec3f {
  let b = slot * NODE_STRIDE;
  return vec3f(nodes[b], nodes[b + 1u], nodes[b + 2u]);
}
fn slot_max(slot : u32) -> vec3f {
  let b = slot * NODE_STRIDE;
  return vec3f(nodes[b + 4u], nodes[b + 5u], nodes[b + 6u]);
}
fn slot_entry(slot : u32, ro : vec3f, invDir : vec3f, tMax : f32) -> f32 {
  return box_entry(slot_min(slot), slot_max(slot), ro, invDir, tMax);
}
fn group_entry(slot : u32, ro : vec3f, invDir : vec3f, tMax : f32) -> f32 {
  if (nodes[slot * NODE_STRIDE + 9u] < 0.0) { return -1.0; }
  var lo = slot_min(slot);
  var hi = slot_max(slot);
  if (nodes[(slot + 1u) * NODE_STRIDE + 9u] >= 0.0) {
    lo = min(lo, slot_min(slot + 1u));
    hi = max(hi, slot_max(slot + 1u));
  }
  return box_entry(lo, hi, ro, invDir, tMax);
}
fn traverse(ro : vec3f, rd : vec3f, tMax : f32, anyHit : bool) -> Hit {
  var result : Hit;
  result.t = tMax;
  result.hitAny = false;
  if (arrayLength(&nodes) < WIDE_STRIDE) { return result; }
  let invDir = vec3f(1.0 / select(rd.x, 1.0e-20, rd.x == 0.0),
                    1.0 / select(rd.y, 1.0e-20, rd.y == 0.0),
                    1.0 / select(rd.z, 1.0e-20, rd.z == 0.0));
  var rootLo = slot_min(0u);
  var rootHi = slot_max(0u);
  for (var lane = 1u; lane < 4u; lane++) {
    if (nodes[lane * NODE_STRIDE + 9u] >= 0.0) {
      rootLo = min(rootLo, slot_min(lane));
      rootHi = max(rootHi, slot_max(lane));
    }
  }
  if (box_entry(rootLo, rootHi, ro, invDir, tMax) < 0.0) { return result; }
  var stack : array<u32, ${BVH4_STACK}>;
  var sp = 0u;
  var wide = 0u;
  var closest = tMax;
  loop {
    let first = wide * 4u;
    // Four slab tests share vector arithmetic; sibling groups retain binary order.
    var near = vec4f(RAY_EPS);
    var far = vec4f(closest);
    for (var a = 0u; a < 3u; a++) {
      let lo = vec4f(nodes[first * 12u + a], nodes[(first + 1u) * 12u + a],
                     nodes[(first + 2u) * 12u + a], nodes[(first + 3u) * 12u + a]);
      let hi = vec4f(nodes[first * 12u + 4u + a], nodes[(first + 1u) * 12u + 4u + a],
                     nodes[(first + 2u) * 12u + 4u + a], nodes[(first + 3u) * 12u + 4u + a]);
      let l = (lo - vec4f(ro[a])) * invDir[a];
      let h = (hi - vec4f(ro[a])) * invDir[a];
      near = max(near, min(l, h));
      far = min(far, max(l, h));
    }
    let leftT = group_entry(first, ro, invDir, closest);
    let rightT = group_entry(first + 2u, ro, invDir, closest);
    let leftFirst = leftT <= rightT;
    for (var g = 0u; g < 2u; g++) {
      let group = select(g, 1u - g, leftFirst);
      if (select(leftT, rightT, group == 1u) < 0.0) { continue; }
      let lane = group * 2u;
      let laneFirst = near[lane] <= near[lane + 1u];
      for (var i = 0u; i < 2u; i++) {
        let current = lane + select(i, 1u - i, laneFirst);
        if (far[current] >= near[current] && nodes[(first + current) * 12u + 9u] >= 0.0) {
          stack[sp] = first + current;
          sp++;
        }
      }
    }
    var found = false;
    loop {
      if (sp == 0u) { break; }
      sp--;
      let slot = stack[sp];
      if (slot_entry(slot, ro, invDir, closest) < 0.0) { continue; }
      let b = slot * NODE_STRIDE;
      let count = u32(nodes[b + 9u]);
      if (count == 0u) {
        wide = u32(nodes[b + 3u]);
        found = true;
        break;
      }
      let start = u32(nodes[b + 8u]);
      for (var i = 0u; i < count; i++) {
        let tri = triOrder[start + i];
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
    }
    if (!found) { break; }
  }
  return result;
}
`;
}
