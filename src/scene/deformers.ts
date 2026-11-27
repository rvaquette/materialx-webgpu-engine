import type { PrimitiveAxis } from './primitives.ts';
import { materialXPerlin3 } from '../compiler/ir-eval.ts';

export const DEFORMER_DEFAULTS = {
  Bend: { axis: 'Y', min: -1, max: 1, falloff: 0, angle: 0 },
  Twist: { axis: 'Y', min: -1, max: 1, falloff: 0, angle: 0 },
  Taper: { axis: 'Y', min: -1, max: 1, falloff: 0, factor: 0 },
  Shear: { axis: 'Y', min: -1, max: 1, falloff: 0, factor: 0 },
  Wave: { axis: 'Y', min: -1, max: 1, falloff: 0, amplitude: 0, frequency: 1, phase: 0 },
  Wind: { axis: 'Y', min: -1, max: 1, falloff: 0, amplitude: 0, frequency: 1, phase: 0, seed: 0 },
  Spherize: { axis: 'Y', min: -1, max: 1, falloff: 0, radius: 1, strength: 0 },
  Field: { axis: 'Y', min: -1, max: 1, falloff: 0, strength: 1, steps: 1, start: 0, end: 24, samples: 25 },
  Lattice: {
    axis: 'Y', min: -1, max: 1, falloff: 0,
    boundsMin: [-1, -1, -1], boundsMax: [1, 1, 1], dimensions: [2, 2, 2], offsets: [],
  },
} as const;

export type DeformerKind = keyof typeof DEFORMER_DEFAULTS;

export interface DeformerKeyframe {
  time: number;
  values: Readonly<Record<string, number | readonly number[]>>;
}

export interface Deformer {
  kind: DeformerKind;
  axis: PrimitiveAxis;
  min: number;
  max: number;
  falloff: number;
  angle?: number;
  factor?: number;
  amplitude?: number;
  frequency?: number;
  phase?: number;
  seed?: number;
  radius?: number;
  strength?: number;
  steps?: number;
  start?: number;
  end?: number;
  samples?: number;
  boundsMin?: readonly number[];
  boundsMax?: readonly number[];
  dimensions?: readonly number[];
  offsets?: readonly number[];
  keyframes?: readonly DeformerKeyframe[];
}

/** Validates and copies the keyframe list accepted by the scripting API. */
export function deformerKeyframes(deformer: Deformer, input: unknown): DeformerKeyframe[] {
  if (!Array.isArray(input) || (input.length !== 0 && (input.length < 2 || input.length > 256))) {
    throw new RangeError(`${deformer.kind}.keyframes must be empty or contain 2 to 256 keyframes.`);
  }
  let names: string[] | undefined;
  let previous = -Infinity;
  return input.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new RangeError(`${deformer.kind}.keyframes entries must be objects.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.time !== 'number' || !Number.isFinite(record.time) || record.time <= previous) {
      throw new RangeError(`${deformer.kind}.keyframes times must be finite and strictly increasing.`);
    }
    previous = record.time;
    const keys = Object.keys(record).filter(name => name !== 'time').sort();
    if (!keys.length || (names && (keys.length !== names.length || keys.some((name, i) => name !== names![i])))) {
      throw new RangeError(`${deformer.kind}.keyframes must animate the same properties at every time.`);
    }
    names = keys;
    const values: Record<string, number | readonly number[]> = {};
    for (const name of keys) {
      if (!Object.hasOwn(DEFORMER_DEFAULTS[deformer.kind], name) || ['axis', 'dimensions', 'seed', 'steps', 'start', 'end', 'samples'].includes(name)) {
        throw new RangeError(`${deformer.kind}.${name} cannot be animated.`);
      }
      const current = deformer[name as keyof Deformer];
      const value = record[name];
      if (typeof current === 'number' && typeof value === 'number' && Number.isFinite(value)) values[name] = value;
      else if (Array.isArray(current) && Array.isArray(value) && value.length === current.length
        && value.every(component => typeof component === 'number' && Number.isFinite(component))) values[name] = [...value];
      else throw new RangeError(`${deformer.kind}.${name} has an invalid keyframe value.`);
    }
    validateDeformer({ ...deformer, ...values });
    return { time: record.time, values };
  });
}

/** Evaluates each parameter track, holding the first and last values outside their range. */
export function deformerAtTime(deformer: Deformer, time: number): Deformer {
  const frames = deformer.keyframes;
  if (!frames?.length) return deformer;
  let upper = frames.findIndex(frame => frame.time >= time);
  if (upper < 0) upper = frames.length - 1;
  const end = frames[upper]!;
  const start = frames[Math.max(0, upper - 1)]!;
  const ratio = start === end ? 0 : Math.max(0, Math.min(1, (time - start.time) / (end.time - start.time)));
  const values: Record<string, number | number[]> = {};
  for (const [name, a] of Object.entries(start.values)) {
    const b = end.values[name]!;
    if (typeof a === 'number' && typeof b === 'number') values[name] = a + (b - a) * ratio;
    else if (Array.isArray(a) && Array.isArray(b)) values[name] = a.map((value, i) => value + (b[i]! - value) * ratio);
    else throw new RangeError(`${deformer.kind}.${name} has incompatible keyframes.`);
  }
  const result = { ...deformer, ...values };
  validateDeformer(result);
  return result;
}

export function validateDeformer(deformer: Deformer): void {
  if (!Object.hasOwn(DEFORMER_DEFAULTS, deformer.kind)) throw new RangeError(`Unknown deformer: ${String(deformer.kind)}.`);
  if (!['X', 'Y', 'Z'].includes(deformer.axis)) throw new RangeError(`${deformer.kind}.axis must be X, Y or Z.`);
  for (const [name, expected] of Object.entries(DEFORMER_DEFAULTS[deformer.kind])) {
    if (name === 'axis') continue;
    const value = deformer[name as keyof Deformer];
    if (Array.isArray(expected)) {
      if (!Array.isArray(value) || !value.every(component => typeof component === 'number' && Number.isFinite(component))) {
        throw new RangeError(`${deformer.kind}.${name} must be an array of finite numbers.`);
      }
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`${deformer.kind}.${name} must be a finite number.`);
    }
  }
  if (!(deformer.max > deformer.min)) throw new RangeError(`${deformer.kind}.max must exceed min.`);
  if (deformer.falloff < 0 || deformer.falloff > (deformer.max - deformer.min) / 2) {
    throw new RangeError(`${deformer.kind}.falloff must be between zero and half the influence range.`);
  }
  if (deformer.kind === 'Spherize' && (!(deformer.radius! > 0) || deformer.strength! < 0 || deformer.strength! > 1)) {
    throw new RangeError('Spherize requires a positive radius and strength between 0 and 1.');
  }
  if (deformer.kind === 'Wind' && (!Number.isInteger(deformer.seed) || deformer.seed! < 0 || deformer.seed! > 0xffffffff)) {
    throw new RangeError('Wind.seed must be an unsigned 32-bit integer.');
  }
  if (deformer.kind === 'Field' && (!Number.isInteger(deformer.steps) || deformer.steps! < 1 || deformer.steps! > 64
      || !Number.isInteger(deformer.samples) || deformer.samples! < 2 || deformer.samples! > 256
      || !(deformer.end! > deformer.start!))) {
    throw new RangeError('Field requires 1 to 64 integration steps, 2 to 256 samples, and end greater than start.');
  }
  if (deformer.kind === 'Lattice') {
    const min = deformer.boundsMin!, max = deformer.boundsMax!, dims = deformer.dimensions!, offsets = deformer.offsets!;
    if (min.length !== 3 || max.length !== 3 || min.some((value, i) => value >= max[i]!)) {
      throw new RangeError('Lattice bounds must have three components with min < max.');
    }
    if (dims.length !== 3 || dims.some(value => !Number.isInteger(value) || value < 2 || value > 6)) {
      throw new RangeError('Lattice dimensions must contain three integers from 2 to 6.');
    }
    if (offsets.length !== 0 && offsets.length !== dims[0]! * dims[1]! * dims[2]! * 3) {
      throw new RangeError('Lattice offsets must be empty or contain three components per control point.');
    }
  }
}

function bernstein(count: number, t: number): number[] {
  const result = [1];
  for (let degree = 1; degree < count; degree++) {
    result.push(0);
    for (let i = degree; i >= 0; i--) {
      result[i] = (result[i] ?? 0) * (1 - t) + (i ? result[i - 1]! * t : 0);
    }
  }
  return result;
}

/** Evaluates an ordered stack in object space without modifying the input position. */
export function deformPosition(
  position: readonly number[],
  stack: readonly Deformer[],
  sampleField?: (deformer: Deformer, position: readonly number[]) => readonly number[],
): [number, number, number] {
  let point: [number, number, number] = [position[0]!, position[1]!, position[2]!];
  for (const deformer of stack) {
    const axis = deformer.axis === 'X' ? 0 : deformer.axis === 'Y' ? 1 : 2;
    const a = (axis + 1) % 3, b = (axis + 2) % 3;
    const along = point[axis]!;
    if (along < deformer.min || along > deformer.max) continue;
    const t = (along - deformer.min) / (deformer.max - deformer.min);
    const edge = Math.min(along - deformer.min, deformer.max - along);
    const q = deformer.falloff > 0 ? Math.min(1, edge / deformer.falloff) : 1;
    const weight = q * q * (3 - 2 * q);
    let next: [number, number, number] = [...point];
    if (deformer.kind === 'Twist') {
      const angle = deformer.angle! * Math.PI / 180 * t;
      next[a] = point[a]! * Math.cos(angle) - point[b]! * Math.sin(angle);
      next[b] = point[a]! * Math.sin(angle) + point[b]! * Math.cos(angle);
    } else if (deformer.kind === 'Bend') {
      const angle = deformer.angle! * Math.PI / 180;
      if (Math.abs(angle) > 1e-8) {
        const radius = (deformer.max - deformer.min) / angle;
        const theta = angle * t;
        next[axis] = deformer.min + (radius + point[a]!) * Math.sin(theta);
        next[a] = (radius + point[a]!) * Math.cos(theta) - radius;
      }
    } else if (deformer.kind === 'Taper') {
      const scale = 1 + deformer.factor! * t;
      next[a] = point[a]! * scale;
      next[b] = point[b]! * scale;
    } else if (deformer.kind === 'Shear') {
      next[a] = point[a]! + deformer.factor! * (along - deformer.min);
    } else if (deformer.kind === 'Wave') {
      next[a] = point[a]! + deformer.amplitude! * Math.sin(deformer.frequency! * along + deformer.phase!);
    } else if (deformer.kind === 'Wind') {
      const sample = point.map((value, i) => value * deformer.frequency! + deformer.phase! * [1, 0.73, 0.31][i]!);
      for (let component = 0; component < 3; component++) {
        next[component]! += t * deformer.amplitude! * materialXPerlin3(sample, (deformer.seed! + component) >>> 0);
      }
    } else if (deformer.kind === 'Spherize') {
      const length = Math.hypot(...point);
      if (length > 1e-12) {
        const scale = 1 + deformer.strength! * (deformer.radius! / length - 1);
        next = point.map(value => value * scale) as [number, number, number];
      }
    } else if (deformer.kind === 'Field') {
      if (!sampleField) throw new RangeError('Field requires a MaterialX vector3 graph.');
      for (let step = 0; step < deformer.steps!; step++) {
        const velocity = sampleField(deformer, next);
        if (velocity.length !== 3 || !velocity.every(Number.isFinite)) {
          throw new RangeError('Field must evaluate to a finite vector3.');
        }
        for (let component = 0; component < 3; component++) {
          next[component]! += velocity[component]! * deformer.strength! / deformer.steps!;
        }
      }
    } else {
      const min = deformer.boundsMin!, max = deformer.boundsMax!, dims = deformer.dimensions!, offsets = deformer.offsets!;
      const coordinates = point.map((value, i) => (value - min[i]!) / (max[i]! - min[i]!));
      if (coordinates.some(value => value < 0 || value > 1) || !offsets.length) continue;
      const [x, y, z] = coordinates.map((value, i) => bernstein(dims[i]!, value));
      for (let k = 0; k < dims[2]!; k++) for (let j = 0; j < dims[1]!; j++) for (let i = 0; i < dims[0]!; i++) {
        const weight = x![i]! * y![j]! * z![k]!;
        const offset = ((k * dims[1]! + j) * dims[0]! + i) * 3;
        for (let component = 0; component < 3; component++) next[component]! += weight * offsets[offset + component]!;
      }
    }
    point = point.map((value, i) => value + weight * (next[i]! - value)) as [number, number, number];
  }
  return point;
}
