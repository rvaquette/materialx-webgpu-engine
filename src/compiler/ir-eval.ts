// T057i2: renderer-independent CPU interpreter for a ShaderIr. Walks the typed
// expression DAG (ir.ts) and evaluates an output ref to a numeric value at a given
// shading point. It is the oracle primitive the path tracer uses to classify and
// mirror procedural/textured surface graphs (T057i3) before the megakernel wires
// the same graph on device (T057i4). The numeric semantics mirror the WGSL
// lowerings in nodes.ts / wgsl.ts (and the CPU reference math in
// tests/fixtures/node-cases.ts) so CPU and device agree. Textures sample a
// caller-supplied bilinear image sampler (T057k, env.textures) or fall back to a
// neutral value. Closure/matrix/string expressions are not value-evaluable and throw.

import type {
  IrConstValue,
  IrExpr,
  IrRef,
  IrType,
  ShaderIr,
} from './ir.ts';

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
  if (d > 0) {
    if (mx === r) h = (g - b) / d;
    else if (mx === g) h = 2 + (b - r) / d;
    else h = 4 + (r - g) / d;
    h = fract(h / 6);
  }
  const s = mx > 0 ? d / mx : 0;
  return [h, s, mx];
}

function hsvToRgb(c: IrValue): number[] {
  const h = c[0]! * 6;
  const s = c[1]!;
  const v = c[2]!;
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
  return [c * v[0]! - s * v[1]!, s * v[0]! + c * v[1]!];
}

function rotate3d(v: IrValue, deg: number, axis: IrValue): number[] {
  const a = (deg * Math.PI) / 180;
  const n = normalize(axis);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cr = cross(n, v);
  const nd = dot(n, v) * (1 - c);
  return [v[0]! * c + cr[0]! * s + n[0]! * nd, v[1]! * c + cr[1]! * s + n[1]! * nd, v[2]! * c + cr[2]! * s + n[2]! * nd];
}

function normalMap(sample: IrValue, scale: number, N: IrValue, T: IrValue): number[] {
  const t = normalize([T[0]! - N[0]! * dot(N, T), T[1]! - N[1]! * dot(N, T), T[2]! - N[2]! * dot(N, T)]);
  const b = cross(N, t);
  const m = sample.map((x) => x * 2 - 1);
  const vv = [m[0]! * scale, m[1]! * scale, m[2]!];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = t[i]! * vv[0]! + b[i]! * vv[1]! + N[i]! * vv[2]!;
  return normalize(out);
}

function artisticIor(reflectivity: IrValue): number[] {
  return reflectivity.map((x) => {
    const r = clampNum(x, 0, 0.99);
    const s = Math.sqrt(r);
    return (1 + s) / Math.max(1 - s, 1e-4);
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
function mix(fg: IrValue, bg: IrValue, t: number): number[] {
  const n = Math.max(fg.length, bg.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = fg.length === 1 ? fg[0]! : fg[i] ?? 0;
    const g = bg.length === 1 ? bg[0]! : bg[i] ?? 0;
    out.push(g * (1 - t) + f * t);
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
        while (out.length < to.size) out.push(1);
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

function evalCall(op: string, args: IrValue[], env: IrEvalVaryings, type: IrType): number[] {
  const at = (i: number, fallback?: number[]): IrValue => args[i] ?? fallback ?? [0];
  switch (op) {
    case 'absval':
      return unary(at(0), Math.abs);
    case 'fract':
      return unary(at(0), fract);
    case 'add':
      return binary(at(0), at(1), (a, b) => a + b);
    case 'subtract':
      return binary(at(0), at(1), (a, b) => a - b);
    case 'multiply':
      return binary(at(0), at(1), (a, b) => a * b);
    case 'divide':
      return binary(at(0), at(1), (a, b) => a / b);
    case 'power':
      return binary(at(0), at(1), Math.pow);
    case 'sin':
      return unary(at(0), Math.sin);
    case 'sqrt':
      return unary(at(0), Math.sqrt);
    case 'ln':
      return unary(at(0), Math.log);
    case 'sign':
      return unary(at(0), Math.sign);
    case 'normalize':
      return normalize(at(0));
    case 'min':
      return binary(at(0), at(1), Math.min);
    case 'max':
      return binary(at(0), at(1), Math.max);
    case 'clamp':
      return clampValue(at(0), at(1, [0]), at(2, [1]));
    case 'dotproduct':
      return [dot(at(0), at(1))];
    case 'dot':
      return [...at(0)];
    case 'invert': {
      const amount = at(1, [1]);
      return at(0).map((x, i) => (amount.length === 1 ? amount[0]! : amount[i] ?? 0) - x);
    }
    case 'mix':
      return mix(at(0), at(1), at(2, [0])[0]!);
    case 'extract':
      return [at(0)[Math.trunc(at(1)[0]!)] ?? 0];
    case 'combine2':
      return [at(0)[0]!, at(1)[0]!];
    case 'combine3':
      return [at(0)[0]!, at(1)[0]!, at(2)[0]!];
    case 'combine4':
      return [at(0)[0]!, at(1)[0]!, at(2)[0]!, at(3)[0]!];
    case 'constant':
      return [...at(0)];
    case 'ifequal':
      return at(0)[0]! === at(1)[0]! ? [...at(2)] : [...at(3)];
    case 'ifgreater':
      return at(0)[0]! > at(1)[0]! ? [...at(2)] : [...at(3)];
    case 'ifgreatereq':
      return at(0)[0]! >= at(1)[0]! ? [...at(2)] : [...at(3)];
    case 'luminance': {
      const l = dot(at(0), LUMA);
      return [l, l, l];
    }
    case 'rgbtohsv':
      return rgbToHsv(at(0));
    case 'hsvtorgb':
      return hsvToRgb(at(0));
    case 'position':
      return [...(env.position ?? zeros(3))];
    case 'texcoord':
      return [...(env.texcoord ?? zeros(2))];
    case 'normalmap':
      return normalMap(at(0), at(1, [1])[0]!, env.normal ?? [0, 0, 1], env.tangent ?? [1, 0, 0]);
    case 'rotate2d':
      return rotate2d(at(0), at(1, [0])[0]!);
    case 'rotate3d':
      return rotate3d(at(0), at(1, [0])[0]!, at(2, [0, 0, 1]));
    case 'fractal3d':
      return [fractal3d(env.position ?? zeros(3), at(0, [1])[0]!, at(1, [3])[0]!)];
    case 'artistic_ior':
      return artisticIor(at(0));
    case 'roughness_anisotropy': {
      const r = at(0, [0])[0]!;
      const a = clampNum(at(1, [0])[0]!, 0, 1);
      const r2 = r * r;
      return [r2 / Math.max(1 - a * 0.9, 1e-3), r2 * (1 - a * 0.9)];
    }
    case 'roughness_dual': {
      const r = at(0, [0, 0]);
      return [r[0]! * r[0]!, (r[1] ?? r[0]!) * (r[1] ?? r[0]!)];
    }
    case 'chiang_hair_absorption_from_color':
      return at(0).map((x) => {
        const l = Math.log(clampNum(x, 1e-4, 1));
        return l * l;
      });
    case 'chiang_hair_roughness': {
      const lon = at(0, [0])[0]!;
      const azi = at(1, [0])[0]!;
      return [lon * lon, azi * azi];
    }
    case 'deon_hair_absorption_from_melanin': {
      const eu = at(0, [0])[0]!;
      const pheo = at(1, [0])[0]!;
      return [eu * 0.419 + pheo * 0.187, eu * 0.697 + pheo * 0.4, eu * 1.37 + pheo * 1.05];
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
    case 'call':
      return evalCall(expr.op, expr.args.map((a) => evaluateIrRef(ir, a, env, cache)), env, expr.type);
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
  if (!sampler) return env.textureNeutral ?? zeros(n);
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
