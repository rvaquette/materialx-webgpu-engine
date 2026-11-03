import { bvhTraversalWgsl } from './bvh-wgsl.ts';

export const PT_PROFILE_EVENTS = 128;
export const PT_PROFILE_EVENT_WORDS = 16;
export const PT_PROFILE_HEADER_WORDS = 4;
export const PT_PROFILE_SAMPLE_WORDS = PT_PROFILE_HEADER_WORDS + PT_PROFILE_EVENTS * PT_PROFILE_EVENT_WORDS;

export function traversalProfileBytes(width: number, height: number, samples: number): number {
  if (![width, height, samples].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Traversal profile dimensions and samples must be positive safe integers.');
  }
  const bytes = width * height * samples * PT_PROFILE_SAMPLE_WORDS * 4;
  if (!Number.isSafeInteger(bytes) || bytes > 128 * 1024 * 1024) {
    throw new Error('Traversal profile exceeds its 128 MiB memory budget; reduce resolution or spp.');
  }
  return bytes;
}

export interface TraversalWorkload {
  samples: number;
  rays: number;
  closestRays: number;
  anyHitRays: number;
  hits: number;
  aabbTests: number;
  triangleTests: number;
  nodeVisits: number;
  maxEventsPerSample: number;
  bytes: number;
}

export function readTraversalProfile(words: Uint32Array, samples: number, replayed = false): TraversalWorkload {
  if (!Number.isSafeInteger(samples) || samples < 1 || words.length !== samples * PT_PROFILE_SAMPLE_WORDS) {
    throw new Error('Traversal profile buffer shape differs from expected sample count.');
  }
  const result: TraversalWorkload = {
    samples, rays: 0, closestRays: 0, anyHitRays: 0, hits: 0,
    aabbTests: 0, triangleTests: 0, nodeVisits: 0, maxEventsPerSample: 0, bytes: words.byteLength,
  };
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  for (let sample = 0; sample < samples; sample++) {
    const base = sample * PT_PROFILE_SAMPLE_WORDS;
    const count = words[base]!;
    if (words[base + 1] !== 0 || count > PT_PROFILE_EVENTS) throw new Error(`Traversal log overflow at sample ${sample}.`);
    if (count < 1) throw new Error(`Traversal log has no primary ray at sample ${sample}.`);
    if (replayed && (words[base + 2] !== 0 || words[base + 3] !== count)) {
      throw new Error(`Traversal replay ray/count mismatch at sample ${sample}.`);
    }
    result.rays += count;
    result.maxEventsPerSample = Math.max(result.maxEventsPerSample, count);
    for (let ray = 0; ray < count; ray++) {
      const offset = base + PT_PROFILE_HEADER_WORDS + ray * PT_PROFILE_EVENT_WORDS;
      const anyHit = words[offset + 7]!;
      const hit = words[offset + 12]!;
      if (anyHit > 1 || hit > 1) throw new Error(`Invalid traversal flags at sample ${sample}, ray ${ray}.`);
      for (const component of [0, 1, 2, 3, 4, 5, 6, 8, 10, 11]) {
        if (!Number.isFinite(floats[offset + component])) {
          throw new Error(`Non-finite traversal payload at sample ${sample}, ray ${ray}.`);
        }
      }
      result.anyHitRays += anyHit;
      result.closestRays += 1 - anyHit;
      result.hits += hit;
      result.aabbTests += words[offset + 13]!;
      result.triangleTests += words[offset + 14]!;
      result.nodeVisits += words[offset + 15]!;
    }
  }
  return result;
}

/** Diagnostic only: replay retains the same megakernel and transport estimator. */
export function traversalProfileWgsl(samples: number): string {
  traversalProfileBytes(1, 1, samples);
  const reference = bvhTraversalWgsl();
  const traversal = reference
    .replace('fn traverse(', 'fn profile_trace(')
    .replace('fn aabb_hit(node : u32, ro : vec3<f32>, invDir : vec3<f32>, tMax : f32) -> f32 {',
      '$&\n  if (U.profileMode == 1u) { profileBoxes += 1u; }')
    .replace('fn intersect_tri(tri : u32, ro : vec3<f32>, rd : vec3<f32>, tMax : f32) -> vec4<f32> {',
      '$&\n  if (U.profileMode == 1u) { profileTriangles += 1u; }')
    .replace('    let b = node * NODE_STRIDE;', '    if (U.profileMode == 1u) { profileNodes += 1u; }\n    let b = node * NODE_STRIDE;');
  if (!['fn profile_trace(', 'profileBoxes += 1u', 'profileTriangles += 1u', 'profileNodes += 1u']
    .every(fragment => traversal.includes(fragment))) {
    throw new Error('Traversal profiling instrumentation no longer matches the reference source.');
  }
  return /* wgsl */ `
@group(0) @binding(11) var<storage, read_write> profileLog : array<u32>;
const PROFILE_SPP = ${samples}u;
const PROFILE_EVENTS = ${PT_PROFILE_EVENTS}u;
const PROFILE_WORDS = ${PT_PROFILE_SAMPLE_WORDS}u;
var<private> profileBase : u32;
var<private> profileCursor : u32;
var<private> profileBoxes : u32;
var<private> profileTriangles : u32;
var<private> profileNodes : u32;
${traversal}

fn traverse(ro : vec3f, rd : vec3f, tMax : f32, anyHit : bool) -> Hit {
  if (U.profileMode == 0u) { return profile_trace(ro, rd, tMax, anyHit); }
  let ray = profileCursor;
  profileCursor += 1u;
  if (ray >= PROFILE_EVENTS) {
    profileLog[profileBase + 1u] = 1u;
    var failed : Hit;
    failed.t = tMax;
    return failed;
  }
  let slot = profileBase + ${PT_PROFILE_HEADER_WORDS}u + ray * ${PT_PROFILE_EVENT_WORDS}u;
  if (U.profileMode == 1u) {
    profileBoxes = 0u;
    profileTriangles = 0u;
    profileNodes = 0u;
    let hit = profile_trace(ro, rd, tMax, anyHit);
    profileLog[slot] = bitcast<u32>(ro.x);
    profileLog[slot + 1u] = bitcast<u32>(ro.y);
    profileLog[slot + 2u] = bitcast<u32>(ro.z);
    profileLog[slot + 3u] = bitcast<u32>(tMax);
    profileLog[slot + 4u] = bitcast<u32>(rd.x);
    profileLog[slot + 5u] = bitcast<u32>(rd.y);
    profileLog[slot + 6u] = bitcast<u32>(rd.z);
    profileLog[slot + 7u] = u32(anyHit);
    profileLog[slot + 8u] = bitcast<u32>(hit.t);
    profileLog[slot + 9u] = hit.tri;
    profileLog[slot + 10u] = bitcast<u32>(hit.u);
    profileLog[slot + 11u] = bitcast<u32>(hit.v);
    profileLog[slot + 12u] = u32(hit.hitAny);
    profileLog[slot + 13u] = profileBoxes;
    profileLog[slot + 14u] = profileTriangles;
    profileLog[slot + 15u] = profileNodes;
    return hit;
  }
  if (U.profileMode == 3u) {
    let origin = vec4u(profileLog[slot], profileLog[slot + 1u], profileLog[slot + 2u], profileLog[slot + 3u]);
    let direction = vec4u(profileLog[slot + 4u], profileLog[slot + 5u], profileLog[slot + 6u], profileLog[slot + 7u]);
    if (any(origin != vec4u(bitcast<vec3u>(ro), bitcast<u32>(tMax))) ||
        any(direction != vec4u(bitcast<vec3u>(rd), u32(anyHit)))) {
      profileLog[profileBase + 2u] = 1u;
    }
  }
  var hit : Hit;
  hit.t = bitcast<f32>(profileLog[slot + 8u]);
  hit.tri = profileLog[slot + 9u];
  hit.u = bitcast<f32>(profileLog[slot + 10u]);
  hit.v = bitcast<f32>(profileLog[slot + 11u]);
  hit.hitAny = profileLog[slot + 12u] != 0u;
  return hit;
}
`;
}
