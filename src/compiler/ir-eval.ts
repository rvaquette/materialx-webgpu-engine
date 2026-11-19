// T057i2: renderer-independent CPU interpreter for a ShaderIr. Walks the typed
// expression DAG (ir.ts) and evaluates an output ref to a numeric value at a given
// shading point. It is the oracle primitive the path tracer uses to classify and
// mirror procedural/textured surface graphs (T057i3) before the megakernel wires
// the same graph on device (T057i4). The numeric semantics mirror the WGSL
// lowerings in nodes.ts / wgsl.ts (and the CPU reference math in
// tests/fixtures/node-cases.ts) so CPU and device agree. Textures sample a
// caller-supplied bilinear image sampler (T057k, env.textures) or fall back to a
// neutral value. Closure/string expressions are not value-evaluable and throw.

import type {
  IrConstValue,
  IrExpr,
  IrRef,
  IrType,
  ShaderIr,
} from './ir.ts';
import { COLOR_TRANSFORMS, transformColor } from './color-transforms.ts';

/** A numeric IR value: length 1 = scalar, 2/3/4 = vector; booleans as 0/1. */
export type IrValue = readonly number[];

/** Shading-point inputs the interpreter reads for input/primvar/param leaves. */
export interface IrEvalVaryings {
  readonly position?: IrValue;
  readonly normal?: IrValue;
  readonly tangent?: IrValue;
  readonly bitangent?: IrValue;
  readonly texcoord?: IrValue;
  readonly viewDir?: IrValue;
  /** Geometric normal used to choose a LamaSurface side when provided. */
  readonly geometricNormal?: IrValue;
  /** Geometric inputs addressed by vary.in_<name> (input kind). */
  readonly inputs?: Readonly<Record<string, IrValue>>;
  /** Primvars addressed by vary.v_<name> (primvar kind). */
  readonly primvars?: Readonly<Record<string, IrValue>>;
  /** Editable params (uniform-backed); override a param's declared default. */
  readonly params?: Readonly<Record<string, IrValue>>;
  /** Bilinear RGBA samplers addressed by texture name; mirrors textureSample (T057k). */
  readonly textures?: Readonly<Record<string, (u: number, v: number) => IrValue>>;
  /** Value returned for texture leaves without a sampler; default zero. */
  readonly textureNeutral?: IrValue;
}

export class IrEvalError extends Error {
  override readonly name = 'IrEvalError';
}

const LUMA: IrValue = [0.2722287, 0.6740818, 0.0536895];

function typeSize(type: IrType): number {
  if (type.kind === 'scalar') return 1;
  if (type.kind === 'vector') return type.size;
  if (type.kind === 'matrix') return type.size * type.size;
  throw new IrEvalError(`type ${type.kind} is not value-evaluable`);
}

function zeros(n: number): number[] {
  return new Array(n).fill(0) as number[];
}

function constToValue(value: IrConstValue): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'boolean') return [value ? 1 : 0];
  if (typeof value === 'string') return [0];
  return [...value];
}

const fract = (x: number): number => x - Math.floor(x);
const clampNum = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

function matrixSize(values: IrValue, op: string): 3 | 4 {
  if (values.length === 9) return 3;
  if (values.length === 16) return 4;
  throw new IrEvalError(`${op} requires a matrix33 or matrix44 input`);
}

function matrixDeterminant(values: IrValue, size: number): number {
  if (size === 1) return values[0]!;
  let determinant = 0;
  for (let column = 0; column < size; column++) {
    const minor: number[] = [];
    for (let row = 1; row < size; row++) {
      for (let minorColumn = 0; minorColumn < size; minorColumn++) {
        if (minorColumn !== column) minor.push(values[minorColumn * size + row]!);
      }
    }
    determinant += (column % 2 === 0 ? 1 : -1)
      * values[column * size]!
      * matrixDeterminant(minor, size - 1);
  }
  return determinant;
}

function invertMatrix(values: IrValue, size: 3 | 4): number[] {
  const determinant = matrixDeterminant(values, size);
  const divisor = Math.abs(determinant) < 1e-8 ? 1e-8 : determinant;
  const inverse = new Array<number>(size * size);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const minor: number[] = [];
      for (let minorRow = 0; minorRow < size; minorRow++) {
        if (minorRow === column) continue;
        for (let minorColumn = 0; minorColumn < size; minorColumn++) {
          if (minorColumn !== row) minor.push(values[minorColumn * size + minorRow]!);
        }
      }
      const cofactor = ((row + column) % 2 === 0 ? 1 : -1) * matrixDeterminant(minor, size - 1);
      inverse[column * size + row] = cofactor / divisor;
    }
  }
  return inverse;
}

function transformMatrixVector(matrix: IrValue, vector: IrValue, outputSize: number): number[] {
  const size = matrixSize(matrix, 'transformmatrix');
  const expectedSize = outputSize === 2 ? 3 : outputSize;
  if (size !== expectedSize && !(outputSize === 3 && size === 4)) {
    throw new IrEvalError('transformmatrix input vector and matrix dimensions do not match');
  }
  const value = outputSize === 2 || (outputSize === 3 && size === 4) ? [...vector, 1] : [...vector];
  if (value.length !== size) throw new IrEvalError('transformmatrix input vector and matrix dimensions do not match');
  const result = Array.from({ length: size }, (_, row) => {
    let component = 0;
    for (let column = 0; column < size; column++) component += matrix[column * size + row]! * value[column]!;
    return component;
  });
  return result.slice(0, outputSize);
}

function materialXCloverleaf(x: number, y: number, radius: number): number {
  const px = 2 * x;
  const py = 2 * y;
  const r2 = radius * radius;
  return Math.min(
    (px + radius) ** 2 + py ** 2,
    (px - radius) ** 2 + py ** 2,
    px ** 2 + (py + radius) ** 2,
    px ** 2 + (py - radius) ** 2,
  ) <= r2 ? 1 : 0;
}

function materialXHexagon(texcoord: IrValue, center: IrValue, radius: number): number {
  const deltaX = texcoord[0]! - center[0]!;
  const deltaY = texcoord[1]! - center[1]!;
  const px = Math.abs(deltaY);
  const py = Math.abs(deltaX);
  const k1x = -0.866025;
  const k1y = 0.5;
  const k2x = 0.866025;
  const k2y = 0.5;
  const p1x = px - 2 * Math.min(k1x * px + k1y * py, 0) * k1x;
  const p1y = py - 2 * Math.min(k1x * px + k1y * py, 0) * k1y;
  const p2x = p1x - 2 * Math.min(k2x * p1x + k2y * p1y, 0) * k2x;
  const p2y = p1y - 2 * Math.min(k2x * p1x + k2y * p1y, 0) * k2y;
  const clampedX = clampNum(p2x, -0.57735 * radius, 0.57735 * radius);
  const distance = Math.sqrt(p2x - clampedX + p2y - radius);
  return distance > 0 ? 0 : 1;
}

function dot(a: IrValue, b: IrValue): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

function normalize(a: IrValue): number[] {
  const len = Math.sqrt(dot(a, a));
  return len > 0 ? a.map((x) => x / len) : [...a];
}

function cross(a: IrValue, b: IrValue): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

/** Component-wise binary with scalar broadcast (mirrors WGSL vec/scalar ops). */
function binary(a: IrValue, b: IrValue, f: (x: number, y: number) => number): number[] {
  const n = Math.max(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = a.length === 1 ? a[0]! : a[i] ?? 0;
    const y = b.length === 1 ? b[0]! : b[i] ?? 0;
    out.push(f(x, y));
  }
  return out;
}

const unary = (a: IrValue, f: (x: number) => number): number[] => a.map(f);

function rgbToHsv(c: IrValue): number[] {
  const r = c[0]!;
  const g = c[1]!;
  const b = c[2]!;
  const mx = Math.max(r, Math.max(g, b));
  const mn = Math.min(r, Math.min(g, b));
  const d = mx - mn;
  let h = 0;
  if (d > 0 && mx > 0) {
    if (mx === r) h = (g - b) / d;
    else if (mx === g) h = 2 + (b - r) / d;
    else h = 4 + (r - g) / d;
    h = fract(h / 6);
  }
  const s = mx > 0 ? d / mx : 0;
  return [h, s, mx];
}

function hsvToRgb(c: IrValue): number[] {
  const h = fract(c[0]!) * 6;
  const s = c[1]!;
  const v = c[2]!;
  if (s < 0.0001) return [v, v, v];
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const m = ((i % 6) + 6) % 6;
  switch (m) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function adjustHsv(color: IrValue, amount: IrValue): number[] {
  const hsv = rgbToHsv(color);
  return hsvToRgb([hsv[0]! + amount[0]!, hsv[1]! * amount[1]!, hsv[2]! * amount[2]!]);
}

function saturateRgb(color: IrValue, amount: number, coefficients: IrValue): number[] {
  const luminance = dot(color, coefficients);
  return color.slice(0, 3).map(x => luminance * (1 - amount) + x * amount);
}

const noiseRotateLeft = (value: number, count: number): number =>
  ((value << count) | (value >>> (32 - count))) >>> 0;

function noiseFinal(a: number, b: number, c: number): number {
  c = ((c ^ b) - noiseRotateLeft(b, 14)) >>> 0;
  a = ((a ^ c) - noiseRotateLeft(c, 11)) >>> 0;
  b = ((b ^ a) - noiseRotateLeft(a, 25)) >>> 0;
  c = ((c ^ b) - noiseRotateLeft(b, 16)) >>> 0;
  a = ((a ^ c) - noiseRotateLeft(c, 4)) >>> 0;
  b = ((b ^ a) - noiseRotateLeft(a, 14)) >>> 0;
  return ((c ^ b) - noiseRotateLeft(b, 24)) >>> 0;
}

function noiseUnit(c: number): number {
  return Math.fround(Math.fround(c) / Math.fround(0xffffffff));
}

function materialXCellNoise(x: number, y: number, z?: number): number {
  const seed = (0xdeadbeef + (z === undefined ? 2 : 3) * 4 + 13) >>> 0;
  return noiseUnit(noiseFinal((seed + (x >>> 0)) >>> 0, (seed + (y >>> 0)) >>> 0, (seed + ((z ?? 0) >>> 0)) >>> 0));
}

function noiseMixedCell(cell: IrValue, dimensions: number): [number, number, number] {
  const seed = (0xdeadbeef + dimensions * 4 + 13) >>> 0;
  let a = (seed + (cell[0]! >>> 0)) >>> 0;
  let b = (seed + (cell[1]! >>> 0)) >>> 0;
  let c = (seed + (cell[2]! >>> 0)) >>> 0;
  a = ((a - c) ^ noiseRotateLeft(c, 4)) >>> 0; c = (c + b) >>> 0;
  b = ((b - a) ^ noiseRotateLeft(a, 6)) >>> 0; a = (a + c) >>> 0;
  c = ((c - b) ^ noiseRotateLeft(b, 8)) >>> 0; b = (b + a) >>> 0;
  a = ((a - c) ^ noiseRotateLeft(c, 16)) >>> 0; c = (c + b) >>> 0;
  b = ((b - a) ^ noiseRotateLeft(a, 19)) >>> 0; a = (a + c) >>> 0;
  c = ((c - b) ^ noiseRotateLeft(b, 4)) >>> 0; b = (b + a) >>> 0;
  return [a, b, c];
}

function flakeNoise(cell: IrValue, tail?: number, vector = false): number[] {
  const [a0, b, c] = noiseMixedCell(cell, tail === undefined ? 4 : vector ? 5 : 4);
  const a = (a0 + (tail ?? 0)) >>> 0;
  return [0, 1, 2].map(offset => noiseUnit(noiseFinal(
    (a + (tail === undefined ? offset : 0)) >>> 0,
    (b + (tail === undefined ? 0 : offset)) >>> 0, c)));
}

interface FlakeResult {
  id: number;
  rand: number;
  presence: number;
  normal: number[];
}

function materialXFlake2d(
  size: number, roughness: number, coverage: number, uv: IrValue,
  normal: IrValue, tangent: IrValue, bitangent: IrValue,
): FlakeResult {
  if (!Number.isFinite(size) || size === 0) throw new IrEvalError('flake2d size must be finite and nonzero');
  const density = clampNum(coverage, 0, 1);
  const squared = density * density;
  const probability = (-26.19771808 * squared + 26.39663835 * density) /
    (85.53857017 * squared * density - 102.35069432 * squared - 101.42634862 * density + 118.45082288);
  const diameter = 1.5 / Math.sqrt(3);
  const position = [uv[0]! / size, uv[1]! / size, 0];
  const base = position.map(Math.floor);
  let priority = 0;
  let selected = [0, 0, 0];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const cell = [base[0]! + x, base[1]! + y, base[2]! + z];
    const delta = position.map((component, index) => component - cell[index]! - 0.5);
    if (dot(delta, delta) >= diameter * diameter * 3 ||
        materialXCellNoise(cell[0]!, cell[1]!, cell[2]!) > probability) continue;
    const candidate = flakeNoise(cell, 3)[0]!;
    if (candidate < priority) continue;
    const random = flakeNoise(cell);
    const theta = 2 * Math.PI * random[0]!;
    const phi = 2 * Math.PI * random[1]!;
    const rz = 2 * random[2]!;
    const vx = Math.sin(phi) * Math.sqrt(rz);
    const vy = Math.cos(phi) * Math.sqrt(rz);
    const vz = Math.sqrt(2 - rz);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const sx = vx * cos - vy * sin;
    const sy = vx * sin + vy * cos;
    const rotated = [
      (vx * sx - cos) * delta[0]! + (vy * sx + sin) * delta[1]! + vz * sx * delta[2]!,
      (vx * sy - sin) * delta[0]! + (vy * sy - cos) * delta[1]! + vz * sy * delta[2]!,
      vx * vz * delta[0]! + vy * vz * delta[1]! + (1 - rz) * delta[2]!,
    ];
    if (rotated.every(component => Math.abs(component) <= diameter)) {
      priority = candidate;
      selected = cell;
    }
  }
  if (priority <= 0) return { id: 0, rand: 0, presence: 0, normal: [...normal] };
  const random = flakeNoise(selected, 2, true);
  const phi = 2 * Math.PI * random[0]!;
  const tanTheta = roughness * roughness * Math.sqrt(random[1]!) / Math.sqrt(1 - random[1]!);
  const sinTheta = tanTheta / Math.sqrt(1 + tanTheta * tanTheta);
  const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);
  const result = normal.map((component, index) =>
    tangent[index]! * Math.cos(phi) * sinTheta + bitangent[index]! * Math.sin(phi) * sinTheta + component * cosTheta);
  const magnitude = Math.sqrt(dot(result, result));
  return {
    id: Math.trunc(Math.fround(random[2]! * 16777215)),
    rand: random[2]!,
    presence: priority,
    normal: result.map(component => component / magnitude),
  };
}

function hash3(p: IrValue): number {
  return fract(Math.sin(dot(p, [12.9898, 78.233, 37.719])) * 43758.5453);
}

function fractal3d(p: IrValue, amplitude: number, octaves: number): number {
  let sum = 0;
  let amp = amplitude;
  let freq = 1;
  const n = Math.trunc(octaves);
  for (let i = 0; i < n; i++) {
    sum += hash3(p.map((x) => x * freq)) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

function rotate2d(v: IrValue, deg: number): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0]! + s * v[1]!, -s * v[0]! + c * v[1]!];
}

function rotate3d(v: IrValue, deg: number, axis: IrValue): number[] {
  const a = (deg * Math.PI) / 180;
  const n = normalize(axis);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cr = cross(v, n);
  const nd = dot(n, v) * (1 - c);
  return [v[0]! * c + cr[0]! * s + n[0]! * nd, v[1]! * c + cr[1]! * s + n[1]! * nd, v[2]! * c + cr[2]! * s + n[2]! * nd];
}

function normalMap(sample: IrValue, scale: IrValue, N: IrValue, T: IrValue, B: IrValue): number[] {
  const m = dot(sample, sample) === 0 ? [0, 0, 1] : sample.map((x) => x * 2 - 1);
  const vv = [m[0]! * scale[0]!, m[1]! * (scale[1] ?? scale[0]!), m[2]!];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = T[i]! * vv[0]! + B[i]! * vv[1]! + N[i]! * vv[2]!;
  return normalize(out);
}

function artisticIor(reflectivity: IrValue, edge: IrValue): number[] {
  return reflectivity.map((x, index) => {
    const r = clampNum(x, 0, 0.99);
    const s = Math.sqrt(r);
    const nMin = (1 - r) / (1 + r);
    const nMax = (1 + s) / (1 - s);
    const tint = edge[index] ?? edge[0] ?? 0;
    return nMax * (1 - tint) + nMin * tint;
  });
}

/** Clamp to [low, high]; low/high may be scalar (broadcast). */
function clampValue(x: IrValue, low: IrValue, high: IrValue): number[] {
  return x.map((v, i) => {
    const lo = low.length === 1 ? low[0]! : low[i] ?? 0;
    const hi = high.length === 1 ? high[0]! : high[i] ?? 1;
    return clampNum(v, lo, hi);
  });
}

/** MaterialX mix lowers to WGSL mix(bg, fg, t) = bg*(1-t) + fg*t. */
function mix(fg: IrValue, bg: IrValue, t: number | IrValue): number[] {
  const n = Math.max(fg.length, bg.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = fg.length === 1 ? fg[0]! : fg[i] ?? 0;
    const g = bg.length === 1 ? bg[0]! : bg[i] ?? 0;
    const weight = typeof t === 'number' ? t : t.length === 1 ? t[0]! : t[i]!;
    out.push(g * (1 - weight) + f * weight);
  }
  return out;
}

const SWIZZLE_INDEX: Readonly<Record<string, number>> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };

function swizzle(src: IrValue, pattern: string): number[] {
  return [...pattern].map((ch) => {
    const idx = SWIZZLE_INDEX[ch];
    if (idx === undefined) throw new IrEvalError(`invalid swizzle component '${ch}'`);
    return src[idx] ?? 0;
  });
}

function convert(src: IrValue, from: IrType, to: IrType): number[] {
  if (to.kind === 'vector') {
    if (from.kind === 'scalar') return new Array(to.size).fill(src[0] ?? 0) as number[];
    if (from.kind === 'vector') {
      if (from.size === to.size) return [...src];
      if (from.size < to.size) {
        const out = [...src];
        while (out.length < to.size) out.push(out.length === 3 ? 1 : 0);
        return out;
      }
      return src.slice(0, to.size);
    }
  }
  if (to.kind === 'scalar') {
    if (from.kind === 'vector') return [src[0] ?? 0];
    return [src[0] ?? 0];
  }
  throw new IrEvalError(`cannot convert to type ${to.kind}`);
}

const KNOWN_VARYINGS = new Set(['position', 'normal', 'tangent', 'bitangent', 'texcoord']);

function readInput(env: IrEvalVaryings, name: string, size: number): IrValue {
  const lower = name.toLowerCase();
  if (lower === 'position') return env.position ?? zeros(size);
  if (lower === 'normal') return env.normal ?? zeros(size);
  if (lower === 'tangent') return env.tangent ?? zeros(size);
  if (lower === 'bitangent') return env.bitangent ?? zeros(size);
  if (lower === 'texcoord') return env.texcoord ?? zeros(size);
  if (lower === 'view' || lower === 'viewdir' || lower === 'viewdirection') return env.viewDir ?? zeros(size);
  if (KNOWN_VARYINGS.has(lower)) return zeros(size);
  return env.inputs?.[name] ?? zeros(size);
}

function evalCall(op: string, args: IrValue[], env: IrEvalVaryings, type: IrType, named?: Readonly<Record<string, IrValue>>, firstInputType?: IrType): number[] {
  const at = (i: number, fallback?: number[]): IrValue => args[i] ?? fallback ?? [0];
  const input = (name: string, legacyIndex: number, fallback?: number[]): IrValue => {
    if (named === undefined) return at(legacyIndex, fallback);
    const value = named[name] ?? fallback;
    if (value === undefined) throw new IrEvalError(`missing named input '${name}' for '${op}'`);
    return value;
  };
  const colorTransform = COLOR_TRANSFORMS.get(op);
  if (colorTransform) {
    if (type.kind !== 'vector' || type.scalar !== 'float' || (type.size !== 3 && type.size !== 4)) {
      throw new IrEvalError(`${op} requires a color3 or color4 input and output`);
    }
    const color = input('in', 0, type.size === 4 ? [0, 0, 0, 1] : [0, 0, 0]);
    if (color.length !== type.size) throw new IrEvalError(`${op} input must match its output`);
    return transformColor(color, colorTransform);
  }
  if (op === 'flake2d_id' || op === 'flake2d_rand' || op === 'flake2d_presence' || op === 'flake2d_flakenormal') {
    const result = materialXFlake2d(
      input('size', 0, [0.01])[0]!, input('roughness', 1, [0.1])[0]!, input('coverage', 2, [0.5])[0]!,
      input('texcoord', 3, [...(env.texcoord ?? [0, 0])]),
      input('normal', 4, [...(env.normal ?? [0, 0, 1])]),
      input('tangent', 5, [...(env.tangent ?? [1, 0, 0])]),
      input('bitangent', 6, [...(env.bitangent ?? [0, 1, 0])]),
    );
    if (op === 'flake2d_flakenormal') return result.normal;
    if (op === 'flake2d_id') return [result.id];
    if (op === 'flake2d_rand') return [result.rand];
    return [result.presence];
  }
  if (op === 'creatematrix') {
    if (type.kind !== 'matrix') throw new IrEvalError('creatematrix requires a matrix output');
    const size = type.size;
    const first = input('in1', 0, [1, 0, 0, ...(size === 4 ? [0] : [])]);
    const vectorSize = first.length;
    if (size === 3) {
      const columns = [
        first,
        input('in2', 1, [0, 1, 0]),
        input('in3', 2, [0, 0, 1]),
      ];
      if (columns.some(column => column.length !== 3)) throw new IrEvalError('creatematrix matrix33 inputs must be vector3');
      return columns.flat();
    }
    if (vectorSize === 3) {
      const columns = [
        first,
        input('in2', 1, [0, 1, 0]),
        input('in3', 2, [0, 0, 1]),
        input('in4', 3, [0, 0, 0]),
      ];
      if (columns.some(column => column.length !== 3)) throw new IrEvalError('creatematrix matrix44 inputs must all be vector3 or vector4');
      return columns.flatMap((column, index) => [...column, index === 3 ? 1 : 0]);
    }
    const columns = [
      first,
      input('in2', 1, [0, 1, 0, 0]),
      input('in3', 2, [0, 0, 1, 0]),
      input('in4', 3, [0, 0, 0, 1]),
    ];
    if (columns.some(column => column.length !== 4)) throw new IrEvalError('creatematrix matrix44 inputs must all be vector3 or vector4');
    return columns.flat();
  }
  if (op === 'determinant' || op === 'transpose' || op === 'invertmatrix') {
    const identitySize = type.kind === 'matrix' ? type.size : 3;
    const identity = Array.from({ length: identitySize * identitySize }, (_, index) =>
      index % (identitySize + 1) === 0 ? 1 : 0);
    const value = input('in', 0, identity);
    const size = matrixSize(value, op);
    if (op === 'determinant') {
      if (type.kind !== 'scalar' || type.scalar !== 'float') throw new IrEvalError('determinant requires a float output');
      return [matrixDeterminant(value, size)];
    }
    if (type.kind !== 'matrix' || type.size !== size) throw new IrEvalError(`${op} input and output matrix sizes do not match`);
    if (op === 'invertmatrix') return invertMatrix(value, size);
    return Array.from({ length: size * size }, (_, index) => {
      const row = index % size;
      const column = Math.floor(index / size);
      return value[row * size + column]!;
    });
  }
  if (op === 'transformmatrix') {
    const vectorValue = input('in', 0, type.kind === 'vector' ? zeros(type.size) : []);
    const matrixValue = input('mat', 1, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    if (type.kind !== 'vector' || type.scalar !== 'float') throw new IrEvalError('transformmatrix requires a float vector output');
    return transformMatrixVector(matrixValue, vectorValue, type.size);
  }
  switch (op) {
    case 'absval':
      return unary(input('in', 0), Math.abs);
    case 'fract':
      return unary(input('in', 0), fract);
    case 'add':
      return binary(input('in1', 0), input('in2', 1), (a, b) => a + b);
    case 'subtract':
      return binary(input('in1', 0), input('in2', 1), (a, b) => a - b);
    case 'multiply':
      return binary(input('in1', 0), input('in2', 1), (a, b) => a * b);
    case 'divide':
      return binary(input('in1', 0), input('in2', 1), (a, b) => a / b);
    case 'power':
      return binary(input('in1', 0), input('in2', 1), Math.pow);
    case 'sin':
      return unary(input('in', 0), Math.sin);
    case 'sqrt':
      return unary(input('in', 0), Math.sqrt);
    case 'ln':
      return unary(input('in', 0), (x) => x > 0 ? Math.log(x) : 0);
    case 'sign':
      return unary(input('in', 0), Math.sign);
    case 'normalize':
      return normalize(input('in', 0));
    case 'reflect': {
      const incident = input('in', 0, [1, 0, 0]);
      const normal = input('normal', 1, [...(env.normal ?? [0, 0, 1])]);
      const scale = 2 * dot(normal, incident);
      return incident.map((value, i) => value - scale * normal[i]!);
    }
    case 'refract': {
      const incident = input('in', 0, [1, 0, 0]);
      const normal = input('normal', 1, [...(env.normal ?? [0, 0, 1])]);
      const ratio = input('ior', 2, [1])[0]!;
      const cosine = dot(incident, normal);
      const k = 1 - ratio * ratio * (1 - cosine * cosine);
      if (k < 0) return zeros(incident.length);
      const scale = ratio * cosine + Math.sqrt(k);
      return incident.map((value, i) => ratio * value - scale * normal[i]!);
    }
    case 'min':
      return binary(input('in1', 0), input('in2', 1), Math.min);
    case 'max':
      return binary(input('in1', 0), input('in2', 1), Math.max);
    case 'mincomponent':
    case 'maxcomponent': {
      const value = input('in', 0);
      if (value.length < 2 || value.length > 4) throw new IrEvalError(`${op} requires a float vector input`);
      return [op === 'mincomponent' ? Math.min(...value) : Math.max(...value)];
    }
    case 'trianglewave': {
      const value = Math.abs(input('in', 0, [0])[0]!);
      return [0.5 - Math.abs(fract(value) - 0.5)];
    }
    case 'clamp':
      return clampValue(input('in', 0), input('low', 1, [0]), input('high', 2, [1]));
    case 'dotproduct':
      return [dot(input('in1', 0), input('in2', 1))];
    case 'dot':
      return [...input('in', 0)];
    case 'invert': {
      const amount = input('amount', 1, [1]);
      return input('in', 0).map((x, i) => (amount.length === 1 ? amount[0]! : amount[i] ?? 0) - x);
    }
    case 'mix':
      return mix(input('fg', 0), input('bg', 1), input('mix', 2, [0]));
    case 'premult':
    case 'unpremult': {
      const color = input('in', 0, [0, 0, 0, 1]);
      const alpha = color[3]!;
      const scale = op === 'premult' ? alpha : alpha === 0 ? 1 : 1 / alpha;
      return [...color.slice(0, 3).map(x => x * scale), alpha];
    }
    case 'plus':
    case 'minus':
    case 'difference':
    case 'screen':
    case 'overlay':
    case 'burn':
    case 'dodge': {
      const fallback = zeros(typeSize(type));
      const fg = input('fg', 0, fallback);
      const bg = input('bg', 1, fallback);
      const amount = input('mix', 2, [1])[0]!;
      return binary(fg, bg, (f, b) => {
        let result: number;
        switch (op) {
          case 'plus': result = b + f; break;
          case 'minus': result = b - f; break;
          case 'difference': result = Math.abs(b - f); break;
          case 'screen': result = 1 - (1 - f) * (1 - b); break;
          case 'overlay': result = b < 0.5 ? 2 * f * b : 1 - 2 * (1 - f) * (1 - b); break;
          case 'burn':
            if (Math.abs(f) < 1e-8) return 0;
            result = 1 - (1 - b) / f;
            break;
          default:
            if (Math.abs(1 - f) < 1e-8) return 0;
            result = b / (1 - f);
        }
        return b * (1 - amount) + result * amount;
      });
    }
    case 'inside':
    case 'outside': {
      const mask = input('mask', 1, [op === 'inside' ? 1 : 0])[0]!;
      return unary(input('in', 0), x => x * (op === 'inside' ? mask : 1 - mask));
    }
    case 'over':
    case 'in':
    case 'out':
    case 'mask':
    case 'matte':
    case 'disjointover': {
      const fg = input('fg', 0, [0, 0, 0, 0]);
      const bg = input('bg', 1, [0, 0, 0, 0]);
      const f = fg[3]!;
      const b = bg[3]!;
      let result: number[];
      if (op === 'disjointover') {
        const sum = f + b;
        const rgb = sum <= 1
          ? fg.slice(0, 3).map((x, i) => x + bg[i]!)
          : Math.abs(b) < 1e-8
            ? [0, 0, 0]
            : fg.slice(0, 3).map((x, i) => x + bg[i]! * (1 - f) / b);
        result = [...rgb, Math.min(sum, 1)];
      } else if (op === 'matte') {
        result = [...fg.slice(0, 3).map((x, i) => x * f + bg[i]! * (1 - f)), f + b * (1 - f)];
      } else if (op === 'over') {
        result = fg.map((x, i) => x + bg[i]! * (1 - f));
      } else {
        const factor = op === 'in' ? b : op === 'out' ? 1 - b : f;
        result = unary(op === 'mask' ? bg : fg, x => x * factor);
      }
      return mix(result, bg, input('mix', 2, [1])[0]!);
    }
    case 'splitlr':
    case 'splittb': {
      const uv = input('texcoord', 3, [...(env.texcoord ?? [0, 0])]);
      const fallback = zeros(typeSize(type));
      const low = op === 'splitlr' ? input('valuel', 0, fallback) : input('valueb', 1, fallback);
      const high = op === 'splitlr' ? input('valuer', 1, fallback) : input('valuet', 0, fallback);
      const center = input('center', 2, [0.5])[0]!;
      return mix(high, low, uv[op === 'splitlr' ? 0 : 1]! >= center ? 1 : 0);
    }
    case 'ramplr':
    case 'ramptb': {
      const uv = input('texcoord', 2, [...(env.texcoord ?? [0, 0])]);
      const fallback = zeros(typeSize(type));
      const start = op === 'ramplr' ? input('valuel', 0, fallback) : input('valueb', 1, fallback);
      const end = op === 'ramplr' ? input('valuer', 1, fallback) : input('valuet', 0, fallback);
      const t = clampNum(uv[op === 'ramplr' ? 0 : 1]!, 0, 1);
      return mix(end, start, t);
    }
    case 'ramp4': {
      const uv = input('texcoord', 4, [...(env.texcoord ?? [0, 0])]);
      const fallback = zeros(typeSize(type));
      const s = clampNum(uv[0]!, 0, 1);
      const t = clampNum(uv[1]!, 0, 1);
      const top = mix(input('valuetr', 1, fallback), input('valuetl', 0, fallback), s);
      const bottom = mix(input('valuebr', 3, fallback), input('valuebl', 2, fallback), s);
      return mix(top, bottom, t);
    }
    case 'checkerboard': {
      const uv = input('texcoord', 4, [...(env.texcoord ?? [0, 0])]);
      const tiling = input('uvtiling', 2, [8, 8]);
      const offset = input('uvoffset', 3, [0, 0]);
      const sum = Math.floor(uv[0]! * tiling[0]! - offset[0]!)
        + Math.floor(uv[1]! * tiling[1]! - offset[1]!);
      const parity = sum - 2 * Math.floor(sum / 2);
      return mix(input('color1', 0, [1, 1, 1]), input('color2', 1, [0, 0, 0]), parity);
    }
    case 'extract': {
      const source = input('in', 0);
      const index = Math.trunc(input('index', 1)[0]!);
      if (firstInputType?.kind === 'matrix') {
        if (index < 0 || index >= firstInputType.size) throw new IrEvalError(`extract matrix index ${index} is out of bounds`);
        return source.slice(index * firstInputType.size, (index + 1) * firstInputType.size);
      }
      return [source[index] ?? 0];
    }
    case 'combine2':
      return [...input('in1', 0), ...input('in2', 1)];
    case 'combine3':
      return [input('in1', 0)[0]!, input('in2', 1)[0]!, input('in3', 2)[0]!];
    case 'combine4':
      return [input('in1', 0, [0])[0]!, input('in2', 1, [0])[0]!, input('in3', 2, [0])[0]!, input('in4', 3, [0])[0]!];
    case 'constant':
      return [...input('value', 0)];
    case 'ifequal':
    case 'ifgreater':
    case 'ifgreatereq': {
      const a = input('value1', 0)[0]!;
      const b = input('value2', 1)[0]!;
      const test = op === 'ifequal' ? a === b : op === 'ifgreater' ? a > b : a >= b;
      if (type.kind === 'scalar' && type.scalar === 'bool' && (named === undefined ? args[2] === undefined : named['in1'] === undefined)) return [test ? 1 : 0];
      return test ? [...input('in1', 2)] : [...input('in2', 3)];
    }
    case 'luminance': {
      const color = input('in', 0, zeros(typeSize(type)));
      const l = dot(color, input('lumacoeffs', 1, [...LUMA]));
      return type.kind === 'scalar' ? [l] : type.kind === 'vector' && type.size === 4 ? [l, l, l, color[3]!] : [l, l, l];
    }
    case 'rgbtohsv':
    case 'hsvtorgb': {
      const color = input('in', 0, zeros(typeSize(type)));
      const result = op === 'rgbtohsv' ? rgbToHsv(color) : hsvToRgb(color);
      return type.kind === 'vector' && type.size === 4 ? [...result, color[3]!] : result;
    }
    case 'hsvadjust':
    case 'saturate': {
      const color = input('in', 0, zeros(typeSize(type)));
      const result = op === 'hsvadjust'
        ? adjustHsv(color, input('amount', 1, [0, 1, 1]))
        : saturateRgb(color, input('amount', 1, [1])[0]!, input('lumacoeffs', 2, [...LUMA]));
      return type.kind === 'vector' && type.size === 4 ? [...result, color[3]!] : result;
    }
    case 'colorcorrect': {
      const color = input('in', 0, type.kind === 'vector' && type.size === 4 ? [1, 1, 1, 0] : [1, 1, 1]);
      const hue = input('hue', 1, [0])[0]!;
      const saturation = input('saturation', 2, [1])[0]!;
      const gamma = input('gamma', 3, [1])[0]!;
      const lift = input('lift', 4, [0])[0]!;
      const gain = input('gain', 5, [1])[0]!;
      const contrast = input('contrast', 6, [1])[0]!;
      const pivot = input('contrastpivot', 7, [0.5])[0]!;
      const exposure = input('exposure', 8, [0])[0]!;
      const result = saturateRgb(adjustHsv(color, [hue, 1, 1]), saturation, LUMA).map(value => {
        const corrected = Math.sign(value) * Math.abs(value) ** (1 / gamma);
        const lifted = (corrected * (1 - lift) + lift) * gain;
        return ((lifted - pivot) * contrast + pivot) * 2 ** exposure;
      });
      return type.kind === 'vector' && type.size === 4 ? [...result, color[3]!] : result;
    }
    case 'cellnoise2d':
    case 'cellnoise3d': {
      const position = op === 'cellnoise2d'
        ? input('texcoord', 0, [...(env.texcoord ?? [0, 0])])
        : input('position', 0, [...(env.position ?? [0, 0, 0])]);
      const cell = position.map(v => Math.floor(Math.fround(v)));
      return [materialXCellNoise(cell[0]!, cell[1]!, op === 'cellnoise3d' ? cell[2]! : undefined)];
    }
    case 'randomfloat': {
      const value = Math.fround(input('in', 0, [0])[0]!);
      const x = Math.floor(firstInputType?.kind === 'scalar' && firstInputType.scalar === 'int' ? value : Math.fround(value * 4096));
      const seed = Math.floor(Math.fround(input('seed', 3, [0])[0]!));
      const low = input('min', 1, [0])[0]!;
      const high = input('max', 2, [1])[0]!;
      const mapped = low + materialXCellNoise(x, seed) * (high - low);
      return [clampNum(mapped, Math.min(low, high), Math.max(low, high))];
    }
    case 'randomcolor': {
      const inputValue = input('in', 0, [0])[0]!;
      const seed = input('seed', 7, [0])[0]!;
      const x = Math.floor(Math.fround(Math.fround(inputValue) * 4096));
      const channel = (
        lowName: string, highName: string, lowIndex: number, highIndex: number,
        lowDefault: number, highDefault: number, offset: number,
      ) => {
        const low = input(lowName, lowIndex, [lowDefault])[0]!;
        const high = input(highName, highIndex, [highDefault])[0]!;
        const seedOffset = Math.fround(Math.fround(seed) + Math.fround(offset));
        return low + materialXCellNoise(x, Math.ceil(seedOffset)) * (high - low);
      };
      return hsvToRgb([
        channel('huelow', 'huehigh', 1, 2, 0, 1, 413.3),
        channel('saturationlow', 'saturationhigh', 3, 4, 0.825, 1, 1522.4),
        channel('brightnesslow', 'brightnesshigh', 5, 6, 1, 1, 1813.8),
      ]);
    }
    case 'grid': {
      const uv = input('texcoord', 0, [0, 0]);
      const tiling = input('uvtiling', 1, [1, 1]);
      const offset = input('uvoffset', 2, [0, 0]);
      const x = uv[0]! * (tiling[0] ?? 1) - (offset[0] ?? 0);
      const y = uv[1]! * (tiling[1] ?? tiling[0] ?? 1) - (offset[1] ?? offset[0] ?? 0);
      const yModuloTwo = y - 2 * Math.floor(y / 2);
      const rowShift = yModuloTwo > 1 ? 0.5 : 0;
      const xStaggered = x + (input('staggered', 4, [0])[0] ? rowShift : 0);
      const xModulo = xStaggered - Math.floor(xStaggered);
      const yModulo = y - Math.floor(y);
      const threshold = 1 - input('thickness', 3, [0.05])[0]!;
      const inX = Math.abs(2 * xModulo - 1) <= threshold ? 1 : 0;
      const inY = Math.abs(2 * yModulo - 1) <= threshold ? 1 : 0;
      const color = 1 - Math.min(inX, inY);
      return [color, color, color];
    }
    case 'crosshatch': {
      const uv = input('texcoord', 0, [0, 0]);
      const tiling = input('uvtiling', 1, [1, 1]);
      const offset = input('uvoffset', 2, [0, 0]);
      const x = uv[0]! * (tiling[0] ?? 1) - (offset[0] ?? 0);
      const y = uv[1]! * (tiling[1] ?? tiling[0] ?? 1) - (offset[1] ?? offset[0] ?? 0);
      const yModuloTwo = y - 2 * Math.floor(y / 2);
      const rowShift = yModuloTwo > 1 ? 0.5 : 0;
      const xStaggered = x + (input('staggered', 4, [0])[0] ? rowShift : 0);
      const sampleX = 2 * (xStaggered - Math.floor(xStaggered)) - 1;
      const sampleY = 2 * (y - Math.floor(y)) - 1;
      const thickness = input('thickness', 3, [0.05])[0]!;
      const distance = Math.min(Math.abs(sampleX - sampleY), Math.abs(sampleX + sampleY)) / Math.SQRT2;
      const color = distance <= thickness ? 1 : 0;
      return [color, color, color];
    }
    case 'tiledcircles': {
      const uv = input('texcoord', 0, [0, 0]);
      const tiling = input('uvtiling', 1, [1, 1]);
      const offset = input('uvoffset', 2, [0, 0]);
      const x = uv[0]! * (tiling[0] ?? 1) - (offset[0] ?? 0);
      const y = uv[1]! * (tiling[1] ?? tiling[0] ?? 1) - (offset[1] ?? offset[0] ?? 0);
      const xModulo = x - Math.floor(x);
      const yModulo = y - Math.floor(y);
      const size = input('size', 3, [0.5])[0]!;
      const regularDistanceSquared = (2 * xModulo - 1) ** 2 + (2 * yModulo - 1) ** 2;
      const regular = regularDistanceSquared <= size * size ? 1 : 0;
      const yModuloTall = y - 1.73205 * Math.floor(y / 1.73205);
      const shiftX = x + (yModuloTall > 0.866025 ? 0.5 : 0);
      const staggeredX = shiftX - Math.floor(shiftX);
      const staggeredY = y - 0.866025 * Math.floor(y / 0.866025);
      const radius = size * 0.5;
      const insideCircle = (cx: number, cy: number): number =>
        cx * cx + cy * cy <= radius * radius ? 1 : 0;
      const staggered = Math.max(
        insideCircle(staggeredX, staggeredY),
        insideCircle(1 - staggeredX, staggeredY),
        insideCircle(staggeredX - 0.5, 0.866025 - staggeredY),
      );
      const color = input('staggered', 4, [0])[0] ? staggered : regular;
      return [color, color, color];
    }
    case 'tiledcloverleafs': {
      const uv = input('texcoord', 0, [0, 0]);
      const tiling = input('uvtiling', 1, [1, 1]);
      const offset = input('uvoffset', 2, [0, 0]);
      const x = uv[0]! * (tiling[0] ?? 1) - (offset[0] ?? 0);
      const y = uv[1]! * (tiling[1] ?? tiling[0] ?? 1) - (offset[1] ?? offset[0] ?? 0);
      const xModulo = x - Math.floor(x);
      const yModulo = y - Math.floor(y);
      const size = input('size', 3, [0.5])[0]!;
      const regular = materialXCloverleaf(2 * xModulo - 1, 2 * yModulo - 1, size);
      const yModuloOne = y - Math.floor(y);
      const shiftX = x + (yModuloOne > 0.5 ? 0.5 : 0);
      const staggeredX = shiftX - Math.floor(shiftX);
      const staggeredY = y - Math.floor(y / 0.5) * 0.5;
      const radius = size * 0.5;
      const staggered = Math.max(
        materialXCloverleaf(staggeredX, staggeredY, radius),
        materialXCloverleaf(1 - staggeredX, staggeredY, radius),
        materialXCloverleaf(staggeredX - 0.5, 0.5 - staggeredY, radius),
      );
      const color = input('staggered', 4, [0])[0] ? staggered : regular;
      return [color, color, color];
    }
    case 'circle':
    case 'cloverleaf':
    case 'line': {
      const uv = input('texcoord', 0, [...(env.texcoord ?? [0, 0])]);
      const center = input('center', 1, [0, 0]);
      const x = uv[0]! - center[0]!;
      const y = uv[1]! - center[1]!;
      const radius = input('radius', 2, [op === 'line' ? 0.1 : 0.5])[0]!;
      if (op === 'circle') return [x * x + y * y > radius * radius ? 0 : 1];
      if (op === 'cloverleaf') return [materialXCloverleaf(x, y, radius)];
      const a = input('point1', 3, [0.25, 0.25]);
      const b = input('point2', 4, [0.75, 0.75]);
      const px = x - a[0]!;
      const py = y - a[1]!;
      const bx = b[0]! - a[0]!;
      const by = b[1]! - a[1]!;
      const length2 = bx * bx + by * by;
      const t = length2 > 0 ? clampNum((px * bx + py * by) / length2, 0, 1) : 0;
      return [Math.hypot(px - t * bx, py - t * by) > radius ? 0 : 1];
    }
    case 'hexagon':
      return [materialXHexagon(input('texcoord', 0, [0, 0]), input('center', 1, [0, 0]), input('radius', 2, [0.5])[0]!)];
    case 'tiledhexagons': {
      const uv = input('texcoord', 0, [0, 0]);
      const tiling = input('uvtiling', 1, [1, 1]);
      const offset = input('uvoffset', 2, [0, 0]);
      const x = uv[0]! * (tiling[0] ?? 1) - (offset[0] ?? 0);
      const y = uv[1]! * (tiling[1] ?? tiling[0] ?? 1) - (offset[1] ?? offset[0] ?? 0);
      const xModulo = fract(x);
      const yModulo = fract(y);
      const size = input('size', 3, [0.5])[0]!;
      const regular = materialXHexagon([2 * xModulo - 1, 2 * yModulo - 1], [0, 0], size);
      const yModuloTall = y - 1.73205 * Math.floor(y / 1.73205);
      const shiftX = x + (yModuloTall > 0.866025 ? 0.5 : 0);
      const staggeredX = fract(shiftX);
      const staggeredY = y - 0.866025 * Math.floor(y / 0.866025);
      const radius = size * 0.5;
      const staggered = Math.max(
        materialXHexagon([staggeredX, staggeredY], [0, 0], radius),
        materialXHexagon([1 - staggeredX, staggeredY], [0, 0], radius),
        materialXHexagon([staggeredX - 0.5, 0.866025 - staggeredY], [0, 0], radius),
      );
      const color = input('staggered', 4, [0])[0] ? staggered : regular;
      return [color, color, color];
    }
    case 'position':
      return [...(env.position ?? zeros(3))];
    case 'texcoord':
      return [...(env.texcoord ?? zeros(2))];
    case 'normalmap':
      return normalMap(input('in', 0), input('scale', 1, [1]), named?.['normal'] ?? env.normal ?? [0, 0, 1], named?.['tangent'] ?? env.tangent ?? [1, 0, 0], named?.['bitangent'] ?? env.bitangent ?? cross(env.normal ?? [0, 0, 1], env.tangent ?? [1, 0, 0]));
    case 'place2d': {
      const tc = input('texcoord', 0, [0, 0]);
      const pivot = input('pivot', 1, [0, 0]);
      const scale = input('scale', 2, [1, 1]);
      const rotation = input('rotate', 3, [0])[0]!;
      const offset = input('offset', 4, [0, 0]);
      const order = Math.trunc(input('operationorder', 5, [0])[0]!);
      if (order > 1) return [0, 0];
      const centered = binary(tc, pivot, (a, b) => a - b);
      if (order <= 0) {
        const rotated = rotate2d(binary(centered, scale, (a, b) => a / b), rotation);
        return binary(binary(rotated, offset, (a, b) => a - b), pivot, (a, b) => a + b);
      }
      const rotated = rotate2d(binary(centered, offset, (a, b) => a - b), rotation);
      return binary(binary(rotated, scale, (a, b) => a / b), pivot, (a, b) => a + b);
    }
    case 'rotate2d':
      return rotate2d(input('in', 0, [0, 0]), input('amount', 1, [0])[0]!);
    case 'rotate3d':
      return rotate3d(input('in', 0, [0, 0, 0]), input('amount', 1, [0])[0]!, input('axis', 2, [0, 1, 0]));
    case 'fractal3d':
      return [fractal3d(env.position ?? zeros(3), input('amplitude', 0, [1])[0]!, input('octaves', 1, [3])[0]!)];
    case 'artistic_ior':
      return artisticIor(input('reflectivity', 0), input('edge_color', 1, [0, 0, 0]));
    case 'artistic_ior_extinction': {
      const reflectivity = input('reflectivity', 0);
      const ior = artisticIor(reflectivity, input('edge_color', 1, [0, 0, 0]));
      return reflectivity.map((value, index) => {
        const r = clampNum(value, 0, 0.99);
        const n = ior[index]!;
        return Math.sqrt(Math.max(((n + 1) ** 2 * r - (n - 1) ** 2) / (1 - r), 0));
      });
    }
    case 'range': {
      const component = (name: string, slot: number, index: number, fallback: number): number => {
        const value = input(name, slot, [fallback]);
        return value[index] ?? value[0]!;
      };
      return input('in', 0).map((value, index) => {
        const low = component('inlow', 1, index, 0);
        const high = component('inhigh', 2, index, 1);
        const gamma = component('gamma', 3, index, 1);
        const outLow = component('outlow', 4, index, 0);
        const outHigh = component('outhigh', 5, index, 1);
        const normalized = high === low ? 0 : (value - low) / (high - low);
        const corrected = Math.sign(normalized) * Math.abs(normalized) ** (1 / gamma);
        const mapped = outLow + (outHigh - outLow) * corrected;
        return input('doclamp', 6, [0])[0] ? clampNum(mapped, Math.min(outLow, outHigh), Math.max(outLow, outHigh)) : mapped;
      });
    }
    case 'roughness_anisotropy': {
      const r = input('roughness', 0, [0])[0]!;
      const a = clampNum(input('anisotropy', 1, [0])[0]!, 0, 1);
      const r2 = r * r;
      return [r2 / Math.max(1 - a * 0.9, 1e-3), r2 * (1 - a * 0.9)];
    }
    case 'roughness_dual': {
      const r = input('roughness', 0, [0, 0]);
      return [r[0]! * r[0]!, (r[1] ?? r[0]!) * (r[1] ?? r[0]!)];
    }
    case 'open_pbr_anisotropy': {
      const r = input('roughness', 0, [0])[0]!;
      const inv = 1 - input('anisotropy', 1, [0])[0]!;
      const ax = r * r * Math.sqrt(2 / (1 + inv * inv));
      return [ax, inv * ax];
    }
    case 'chiang_hair_absorption_from_color':
      return input('color', 0).map((x) => {
        const l = Math.log(clampNum(x, 1e-4, 1));
        return l * l;
      });
    case 'chiang_hair_roughness': {
      const lon = input('longitudinal', 0, [0])[0]!;
      const azi = input('azimuthal', 1, [0])[0]!;
      return [lon * lon, azi * azi];
    }
    case 'deon_hair_absorption_from_melanin': {
      const eu = input('melanin_concentration', 0, [0])[0]!;
      const pheo = input('melanin_redness', 1, [0])[0]!;
      return [eu * 0.419 + pheo * 0.187, eu * 0.697 + pheo * 0.4, eu * 1.37 + pheo * 1.05];
    }
    case 'cos':
      return unary(input('in', 0), Math.cos);
    case 'tan':
      return unary(input('in', 0), Math.tan);
    case 'asin':
      return unary(input('in', 0), Math.asin);
    case 'acos':
      return unary(input('in', 0), (x) => Math.abs(x) <= 1 ? Math.acos(x) : 0);
    case 'exp':
      return unary(input('in', 0), Math.exp);
    case 'floor':
      return unary(input('in', 0), Math.floor);
    case 'ceil':
      return unary(input('in', 0), Math.ceil);
    case 'round':
      return unary(input('in', 0), Math.round);
    case 'atan2':
      return binary(input('iny', 0), input('inx', 1, [1]), Math.atan2);
    case 'magnitude':
      return [Math.sqrt(dot(input('in', 0), input('in', 0)))];
    case 'distance': {
      const d = binary(input('in1', 0), input('in2', 1), (a, b) => a - b);
      return [Math.sqrt(dot(d, d))];
    }
    case 'crossproduct':
      return cross(input('in1', 0), input('in2', 1));
    case 'modulo':
      return binary(input('in1', 0), input('in2', 1, [1]), (a, b) => a - b * Math.floor(a / b));
    case 'safepower':
      return binary(input('in1', 0), input('in2', 1, [1]), (a, b) => Math.sign(a) * Math.abs(a) ** b);
    case 'smoothstep': {
      const low = input('low', 1, [0]);
      const high = input('high', 2, [1]);
      return input('in', 0).map((x, i) => {
        const lo = low[i] ?? low[0]!;
        const hi = high[i] ?? high[0]!;
        if (x >= hi) return 1;
        if (x <= lo) return 0;
        const t = clampNum((x - lo) / (hi - lo), 0, 1);
        return t * t * (3 - 2 * t);
      });
    }
    case 'remap': {
      const pick = (v: IrValue, i: number): number => v[i] ?? v[0]!;
      const inLow = input('inlow', 1, [0]);
      const inHigh = input('inhigh', 2, [1]);
      const outLow = input('outlow', 3, [0]);
      const outHigh = input('outhigh', 4, [1]);
      return input('in', 0).map((x, i) => {
        const low = pick(inLow, i);
        const high = pick(inHigh, i);
        const outputLow = pick(outLow, i);
        if (high === low) return outputLow;
        return outputLow + ((x - low) * (pick(outHigh, i) - outputLow)) / (high - low);
      });
    }
    case 'contrast': {
      const pivot = input('pivot', 2, [0.5]);
      const amount = input('amount', 1, [1]);
      return input('in', 0, zeros(typeSize(type))).map((x, i) => (x - (pivot[i] ?? pivot[0]!)) * (amount[i] ?? amount[0]!) + (pivot[i] ?? pivot[0]!));
    }
    case 'and':
      return [input('in1', 0, [0])[0]! && input('in2', 1, [0])[0]! ? 1 : 0];
    case 'or':
      return [input('in1', 0, [0])[0]! || input('in2', 1, [0])[0]! ? 1 : 0];
    case 'xor':
      return [(input('in1', 0, [0])[0]! !== 0) !== (input('in2', 1, [0])[0]! !== 0) ? 1 : 0];
    case 'not':
      return [input('in', 0, [0])[0]! ? 0 : 1];
    case 'normal':
      return [...(env.normal ?? [0, 0, 1])];
    case 'tangent':
      return [...(env.tangent ?? [1, 0, 0])];
    case 'bitangent':
      return [...(env.bitangent ?? [0, 1, 0])];
    case 'switch': {
      const which = input('which', 10, [0])[0]!;
      if (!(which < 10)) return zeros(typeSize(type));
      const k = Math.max(0, Math.floor(which)) + 1;
      return [...input(`in${k}`, k - 1, zeros(typeSize(type)))];
    }
    default:
      throw new IrEvalError(`no CPU evaluation for node '${op}' (type ${type.kind})`);
  }
}

/** Evaluate a single IR expression ref to a numeric value, memoizing in `cache`. */
export function evaluateIrRef(
  ir: ShaderIr,
  ref: IrRef,
  env: IrEvalVaryings = {},
  cache: Map<IrRef, IrValue> = new Map(),
): IrValue {
  const memo = cache.get(ref);
  if (memo !== undefined) return memo;
  const expr = ir.exprs.get(ref);
  if (!expr) throw new IrEvalError(`unknown IR ref '${ref}'`);
  const value = evalExpr(ir, expr, env, cache);
  cache.set(ref, value);
  return value;
}

function evalExpr(ir: ShaderIr, expr: IrExpr, env: IrEvalVaryings, cache: Map<IrRef, IrValue>): IrValue {
  switch (expr.kind) {
    case 'const':
      return constToValue(expr.value);
    case 'param':
      return env.params?.[expr.name] ?? paramDefault(ir, expr.name) ?? zeros(typeSize(expr.type));
    case 'input':
      return readInput(env, expr.name, typeSize(expr.type));
    case 'primvar':
      return env.primvars?.[expr.name] ?? (expr.name === 'st' ? env.texcoord : undefined) ?? zeros(typeSize(expr.type));
    case 'convert':
      return convert(evaluateIrRef(ir, expr.source, env, cache), expr.from, expr.type);
    case 'swizzle':
      return swizzle(evaluateIrRef(ir, expr.source, env, cache), expr.pattern);
    case 'texture':
      return sampleTexture(ir, expr, env, cache);
    case 'call': {
      const firstInput = expr.namedArgs === undefined ? expr.args[0] : expr.namedArgs['in'];
      return evalCall(expr.op, expr.args.map((a) => evaluateIrRef(ir, a, env, cache)), env, expr.type,
        expr.namedArgs === undefined ? undefined : Object.fromEntries(Object.entries(expr.namedArgs).map(([name, ref]) => [name, evaluateIrRef(ir, ref, env, cache)])),
        firstInput === undefined ? undefined : ir.exprs.get(firstInput)?.type);
    }
    case 'combine':
      return evalValueCombine(ir, expr, env, cache);
    case 'closure':
      throw new IrEvalError(`closure '${expr.op}' is not value-evaluable (composition lands in T057i3)`);
  }
}

function sampleTexture(
  ir: ShaderIr,
  expr: Extract<IrExpr, { kind: 'texture' }>,
  env: IrEvalVaryings,
  cache: Map<IrRef, IrValue>,
): IrValue {
  const n = typeSize(expr.type);
  const sampler = env.textures?.[expr.texture];
  if (!sampler) return expr.fallback ? evaluateIrRef(ir, expr.fallback, env, cache) : env.textureNeutral ?? zeros(n);
  const uv = evaluateIrRef(ir, expr.uv, env, cache);
  const rgba = sampler(uv[0] ?? 0, uv[1] ?? 0);
  const out = rgba.slice(0, n);
  while (out.length < n) out.push(0);
  return out;
}

function evalValueCombine(
  ir: ShaderIr,
  expr: Extract<IrExpr, { kind: 'combine' }>,
  env: IrEvalVaryings,
  cache: Map<IrRef, IrValue>,
): IrValue {
  if (expr.type.kind === 'closure' || expr.type.kind === 'shader') {
    throw new IrEvalError(`closure combine '${expr.op}' is not value-evaluable (T057i3)`);
  }
  const ops = expr.operands.map((o) => evaluateIrRef(ir, o, env, cache));
  switch (expr.op) {
    case 'add':
    case 'layer':
      return ops.reduce((a, b) => binary(a, b, (x, y) => x + y));
    case 'multiply':
      return ops.reduce((a, b) => binary(a, b, (x, y) => x * y));
    case 'mix': {
      const t = expr.weight !== undefined ? evaluateIrRef(ir, expr.weight, env, cache)[0]! : 0.5;
      return mix(ops[1] ?? [0], ops[0] ?? [0], t);
    }
  }
}

function paramDefault(ir: ShaderIr, name: string): number[] | undefined {
  const p = ir.params.find((r) => r.name === name);
  return p?.defaultValue !== undefined ? constToValue(p.defaultValue) : undefined;
}

/** Evaluate every output of a ShaderIr at a shading point, sharing one cache. */
export function evaluateShaderIr(ir: ShaderIr, env: IrEvalVaryings = {}): Map<string, IrValue> {
  const cache = new Map<IrRef, IrValue>();
  const out = new Map<string, IrValue>();
  for (const o of ir.outputs) out.set(o.name, evaluateIrRef(ir, o.ref, env, cache));
  return out;
}
