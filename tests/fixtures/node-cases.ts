// Deterministic per-node execution cases for the corpus (T034a). Each case pins
// fixed inputs and the CPU-reference output that the WGSL lowering in
// src/compiler/nodes.ts must reproduce. Shared by the JS compiler tests
// (T034b/c) and the mobile GPU harness (T034d-g). The reference math below
// mirrors the WGSL preludes exactly, so real GPU results can be checked against
// these numbers rather than against a second, divergent implementation.

export type Vec = readonly number[]; // length 1 = f32, 2 = vec2f, 3 = vec3f, 4 = vec4f.
export type OutType = 'f32' | 'vec2f' | 'vec3f' | 'vec4f';

// How a node reaches the GPU:
//  - 'expr'    : pure WGSL expression, run directly in a compute kernel.
//  - 'texture' : needs a bound texture + sampler (deterministic 1x1 texel here).
//  - 'closure' : BSDF/EDF/surface leaf, evaluated as a Closure {color, weight}.
//  - 'graph'   : surface/library nodedef that expands to a subgraph; checked by
//                resolution + IR + lowering, not a single-leaf scalar run.
//  - 'implicit': handled implicitly by the emitter (type conversion).
//  - 'multi'   : multi-output node, not a single scalar expression.
export type ExecClass = 'expr' | 'texture' | 'closure' | 'graph' | 'implicit' | 'multi';

export interface NodeCase {
  readonly category: string;
  readonly exec: ExecClass;
  readonly out: OutType | null; // null for graph/implicit/multi (no single scalar output).
  readonly inputs: readonly Vec[]; // positional WGSL arguments.
  readonly expected: Vec | null; // CPU reference; null when not a single-leaf scalar run.
  readonly usesVaryings?: boolean;
  readonly note?: string;
  // false when the lowering is a chaotic fp hash (fract(sin(x)*k)): fp32 GPU and
  // fp64 CPU cannot match bit-for-bit, so the GPU run is checked by envelope only.
  readonly reproducible?: boolean;
  // Inclusive [min, max] envelope for every component when reproducible === false.
  readonly envelope?: readonly [number, number];
}

// Fixed geometric frame used by geometry/procedural nodes (matches NodeEmitContext varyings).
export interface VaryingEnv {
  readonly position: Vec;
  readonly normal: Vec;
  readonly tangent: Vec;
  readonly bitangent: Vec;
  readonly texcoord: Vec;
  readonly viewDir: Vec;
}

export const VARYINGS: VaryingEnv = {
  position: [0.25, -0.5, 0.75],
  normal: [0, 0, 1],
  tangent: [1, 0, 0],
  bitangent: [0, 1, 0],
  texcoord: [0.3, 0.7],
  viewDir: [0, 0, 1],
};

// --- CPU reference math (mirrors src/compiler/nodes.ts preludes) --------------

const fract = (x: number): number => x - Math.floor(x);
const clampNum = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

const zip = (a: Vec, b: Vec, f: (x: number, y: number) => number): number[] =>
  a.map((x, i) => f(x, b[i]!));

function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
function cross(a: Vec, b: Vec): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
function scale(a: Vec, s: number): number[] {
  return a.map((x) => x * s);
}
function normalize(a: Vec): number[] {
  const len = Math.sqrt(dot(a, a));
  return len > 0 ? a.map((x) => x / len) : [...a];
}

// MaterialX mix lowers to WGSL mix(bg, fg, t) = bg*(1-t) + fg*t (argument swap).
function mixRef(fg: Vec, bg: Vec, t: number): number[] {
  return bg.map((b, i) => b * (1 - t) + fg[i]! * t);
}

function rgbToHsv(c: Vec): number[] {
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

function hsvToRgb(c: Vec): number[] {
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

function hash3(p: Vec): number {
  return fract(Math.sin(dot(p, [12.9898, 78.233, 37.719])) * 43758.5453);
}
function fractal3d(p: Vec, amplitude: number, octaves: number): number {
  let sum = 0;
  let amp = amplitude;
  let freq = 1;
  const n = Math.trunc(octaves);
  for (let i = 0; i < n; i++) {
    sum += hash3(scale(p, freq)) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

function normalMap(sample: Vec, s: number, N: Vec, T: Vec): number[] {
  const t = normalize(zip(T, scale(N, dot(N, T)), (a, b) => a - b));
  const b = cross(N, t);
  const m = sample.map((x) => x * 2 - 1);
  const v = [m[0]! * s, m[1]! * s, m[2]!];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = t[i]! * v[0]! + b[i]! * v[1]! + N[i]! * v[2]!;
  return normalize(out);
}

const hairAbsorptionFromColor = (c: Vec): number[] =>
  c.map((x) => {
    const l = Math.log(clampNum(x, 1e-4, 1));
    return l * l;
  });
const hairRoughness = (lon: number, azi: number): number[] => [lon * lon, azi * azi];
const deonAbsorption = (eu: number, pheo: number): number[] =>
  [eu * 0.419 + pheo * 0.187, eu * 0.697 + pheo * 0.4, eu * 1.37 + pheo * 1.05];

// --- Case table ---------------------------------------------------------------

function exprCase(category: string, out: OutType, inputs: Vec[], expected: Vec): NodeCase {
  return { category, exec: 'expr', out, inputs, expected };
}
function graphCase(category: string, note: string): NodeCase {
  return { category, exec: 'graph', out: null, inputs: [], expected: null, note };
}

const A3: Vec = [0.2, 0.5, 0.8];
const B3: Vec = [0.1, 0.4, 0.25];

export const NODE_CASES: readonly NodeCase[] = [
  // --- math leaves (pure expressions) ---
  exprCase('add', 'vec3f', [A3, B3], zip(A3, B3, (a, b) => a + b)),
  exprCase('subtract', 'vec3f', [A3, B3], zip(A3, B3, (a, b) => a - b)),
  exprCase('multiply', 'vec3f', [A3, B3], zip(A3, B3, (a, b) => a * b)),
  exprCase('divide', 'vec3f', [A3, B3], zip(A3, B3, (a, b) => a / b)),
  exprCase('power', 'vec3f', [A3, B3], zip(A3, B3, (a, b) => Math.pow(a, b))),
  exprCase('max', 'vec3f', [A3, B3], zip(A3, B3, (a, b) => Math.max(a, b))),
  exprCase('clamp', 'vec3f', [A3, [0.15, 0.15, 0.15], [0.6, 0.6, 0.6]], A3.map((x) => clampNum(x, 0.15, 0.6))),
  exprCase('sin', 'vec3f', [A3], A3.map((x) => Math.sin(x))),
  exprCase('dotproduct', 'f32', [A3, B3], [dot(A3, B3)]),
  exprCase('mix', 'vec3f', [A3, B3, [0.25]], mixRef(A3, B3, 0.25)),
  // --- channel leaves ---
  exprCase('extract', 'f32', [A3, [1]], [A3[1]!]),
  exprCase('combine3', 'vec3f', [[0.2], [0.5], [0.8]], [0.2, 0.5, 0.8]),
  // --- color leaves ---
  exprCase('constant', 'vec3f', [A3], [...A3]),
  exprCase('rgbtohsv', 'vec3f', [A3], rgbToHsv(A3)),
  exprCase('hsvtorgb', 'vec3f', [[0.1, 0.6, 0.8]], hsvToRgb([0.1, 0.6, 0.8])),
  // --- geometry leaves (read the fixed varyings) ---
  { ...exprCase('position', 'vec3f', [], [...VARYINGS.position]), usesVaryings: true },
  { ...exprCase('texcoord', 'vec2f', [], [...VARYINGS.texcoord]), usesVaryings: true },
  {
    ...exprCase('normalmap', 'vec3f', [[0.5, 0.5, 1.0], [1.0]], normalMap([0.5, 0.5, 1.0], 1.0, VARYINGS.normal, VARYINGS.tangent)),
    usesVaryings: true,
  },
  // --- procedural leaf (reads position varying) ---
  { ...exprCase('fractal3d', 'f32', [[1.0], [3]], [fractal3d(VARYINGS.position, 1.0, 3)]), usesVaryings: true, reproducible: false, envelope: [0, 1.75], note: 'fract(sin)-hash noise: fp32 GPU vs fp64 CPU not bit-reproducible; checked by [0, sum amplitudes] envelope' },
  // --- hair utility leaves ---
  exprCase('chiang_hair_absorption_from_color', 'vec3f', [A3], hairAbsorptionFromColor(A3)),
  exprCase('chiang_hair_roughness', 'vec2f', [[0.3], [0.5]], hairRoughness(0.3, 0.5)),
  exprCase('deon_hair_absorption_from_melanin', 'vec3f', [[0.4], [0.2]], deonAbsorption(0.4, 0.2)),

  // --- texture leaves (deterministic 1x1 texel, nearest sample) ---
  { category: 'image', exec: 'texture', out: 'vec3f', inputs: [A3], expected: [...A3], note: 'nearest sample of a constant 1x1 texel' },
  { category: 'tiledimage', exec: 'texture', out: 'vec3f', inputs: [A3], expected: [...A3], note: 'nearest sample of a constant 1x1 texel' },
  { category: 'hextiledimage', exec: 'texture', out: 'vec3f', inputs: [A3], expected: [...A3], note: 'nearest sample of a constant 1x1 texel' },

  // --- closure leaves (Closure packed as [r, g, b, weight]) ---
  {
    category: 'chiang_hair_bsdf',
    exec: 'closure',
    out: 'vec4f',
    inputs: [[0.8], [0.6, 0.3, 0.1], [0.1, 0.2]], // weight, tint, roughness
    expected: [0.6 * 0.8, 0.3 * 0.8, 0.1 * 0.8, 0.8],
    note: 'Closure(color * weight, weight)',
  },
  {
    category: 'surface',
    exec: 'closure',
    out: 'vec4f',
    inputs: [[1.0]], // opacity, with zero bsdf/edf
    expected: [0, 0, 0, 1],
    note: 'mx_surface(zero bsdf, zero edf, opacity)',
  },

  // --- surface / library graphs (resolution + IR + lowering, not scalar run) ---
  graphCase('standard_surface', 'StandardSurface nodedef expands to an implementation subgraph'),
  graphCase('open_pbr_surface', 'OpenPBR nodedef expands to an implementation subgraph'),
  graphCase('disney_principled', 'Disney Principled nodedef expands to an implementation subgraph'),
  graphCase('gltf_pbr', 'glTF PBR nodedef expands to an implementation subgraph'),
  graphCase('UsdPreviewSurface', 'UsdPreviewSurface nodedef expands to an implementation subgraph'),
  graphCase('simple_hair', 'SimpleHair nodedef expands to a chiang_hair_bsdf subgraph'),
  graphCase('gltf_image', 'glTF image library graph (texture + transform)'),
  graphCase('gltf_colorimage', 'glTF color image library graph (texture + colorspace)'),
  graphCase('gltf_normalmap', 'glTF normal map library graph'),
  graphCase('place2d', 'texcoord transform library graph'),

  // --- emitter-implicit and multi-output ---
  { category: 'convert', exec: 'implicit', out: null, inputs: [], expected: null, note: 'type conversion handled implicitly by the emitter' },
  { category: 'separate3', exec: 'multi', out: null, inputs: [], expected: null, note: 'multi-output channel split; validated per output channel' },
];

export const NODE_CASES_BY_CATEGORY: ReadonlyMap<string, NodeCase> = new Map(
  NODE_CASES.map((c) => [c.category, c]),
);

export function expectedLength(out: OutType): number {
  switch (out) {
    case 'f32':
      return 1;
    case 'vec2f':
      return 2;
    case 'vec3f':
      return 3;
    case 'vec4f':
      return 4;
  }
}
