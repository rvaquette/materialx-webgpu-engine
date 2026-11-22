// Time evaluation of a composed SceneAsset (USD value resolution at a time code).
// Samples hold outside their range; numeric values interpolate linearly between the
// bracketing samples, quaternions spherically, and discrete types (int, bool,
// token, string, asset) hold the earlier sample, as UsdAttribute::Get does.
import type { AttributeValue, PrimAttribute, SceneAsset, ScenePrim, TimeSample, XformOp } from './types.ts';

export interface SceneTimeline {
  start: number;
  end: number;
  timeCodesPerSecond: number;
  /** True when at least one attribute or transform op is time-sampled. */
  animated: boolean;
}

const animatedPrims = new WeakMap<SceneAsset, readonly string[]>();

function isAnimated(prim: ScenePrim): boolean {
  for (const attr of prim.attributes.values()) if (attr.timeSamples?.length) return true;
  return prim.xformOps.some(op => op.timeSamples?.length);
}

export function animatedPrimPaths(scene: SceneAsset): readonly string[] {
  let paths = animatedPrims.get(scene);
  if (!paths) {
    paths = [...scene.prims.values()].filter(isAnimated).map(prim => prim.path);
    animatedPrims.set(scene, paths);
  }
  return paths;
}

export function sceneTimeline(scene: SceneAsset): SceneTimeline {
  let first = Infinity;
  let last = -Infinity;
  for (const path of animatedPrimPaths(scene)) {
    const prim = scene.prims.get(path)!;
    const samples = [...[...prim.attributes.values()].map(attr => attr.timeSamples), ...prim.xformOps.map(op => op.timeSamples)];
    for (const list of samples) {
      if (!list?.length) continue;
      first = Math.min(first, list[0]!.time);
      last = Math.max(last, list[list.length - 1]!.time);
    }
  }
  const animated = Number.isFinite(first);
  const start = scene.stage.startTimeCode ?? (animated ? first : 0);
  const end = scene.stage.endTimeCode ?? (animated ? last : start);
  return {
    start, end: Math.max(start, end),
    timeCodesPerSecond: scene.stage.timeCodesPerSecond ?? scene.stage.framesPerSecond ?? 24,
    animated,
  };
}

const DISCRETE = /^(bool|int|uint|int64|uint64|uchar|token|string|asset)(\[\])?$/;

function slerp(a: readonly number[], b: readonly number[], t: number): number[] {
  let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sign = dot < 0 ? -1 : 1;
  dot = Math.abs(dot);
  let wa = 1 - t, wb = t;
  if (dot < 0.9995) {
    const angle = Math.acos(Math.min(1, dot));
    wa = Math.sin((1 - t) * angle) / Math.sin(angle);
    wb = Math.sin(t * angle) / Math.sin(angle);
  }
  const q = [0, 1, 2, 3].map(i => wa * a[i]! + wb * sign * b[i]!);
  const length = Math.hypot(...q) || 1;
  return q.map(v => v / length);
}

/** Value of a sample list at `time`: undefined without samples, null when blocked. */
export function sampleAt(typeName: string, samples: readonly TimeSample[], time: number): AttributeValue | null | undefined {
  if (samples.length === 0) return undefined;
  if (time <= samples[0]!.time) return samples[0]!.value;
  const lastSample = samples[samples.length - 1]!;
  if (time >= lastSample.time) return lastSample.value;
  let upper = 1;
  while (samples[upper]!.time < time) upper++;
  const a = samples[upper - 1]!, b = samples[upper]!;
  if (b.time === time) return b.value;
  if (a.value === null || b.value === null || DISCRETE.test(typeName)) return a.value;
  const t = (time - a.time) / (b.time - a.time);
  if (typeof a.value === 'number' && typeof b.value === 'number') return a.value + (b.value - a.value) * t;
  if (Array.isArray(a.value) && Array.isArray(b.value) && a.value.length === b.value.length
    && a.value.every(v => typeof v === 'number') && b.value.every(v => typeof v === 'number')) {
    const from = a.value as readonly number[], to = b.value as readonly number[];
    if (/^quat[fdh]/.test(typeName) && from.length % 4 === 0) {
      const out: number[] = [];
      for (let i = 0; i < from.length; i += 4) out.push(...slerp(from.slice(i, i + 4), to.slice(i, i + 4), t));
      return out;
    }
    return from.map((v, i) => v + (to[i]! - v) * t);
  }
  return a.value;
}

function resolved<T extends PrimAttribute | XformOp>(entry: T, time: number): T {
  if (!entry.timeSamples?.length) return entry;
  const value = sampleAt(entry.typeName, entry.timeSamples, time);
  const { value: _previous, ...rest } = entry;
  return (value === null || value === undefined ? rest : { ...rest, value }) as T;
}

/** The scene with every time-sampled attribute and transform op resolved at `time`. */
export function evaluateSceneAt(scene: SceneAsset, time: number): SceneAsset {
  const paths = animatedPrimPaths(scene);
  if (paths.length === 0) return scene;
  const prims = new Map(scene.prims);
  for (const path of paths) {
    const prim = scene.prims.get(path)!;
    prims.set(path, {
      ...prim,
      attributes: new Map([...prim.attributes].map(([name, attr]) => [name, resolved(attr, time)])),
      xformOps: prim.xformOps.map(op => resolved(op, time)),
    });
  }
  const evaluated: SceneAsset = { ...scene, prims };
  animatedPrims.set(evaluated, paths);
  return evaluated;
}
