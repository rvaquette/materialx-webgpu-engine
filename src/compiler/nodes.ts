// Per-node WGSL lowering registry (plan section 7, T014). Covers every source-code
// leaf of docs/materialx-node-coverage.md. Each entry turns a resolved IR node
// (a 'call' for math/procedural leaves, a 'closure' for BSDF/EDF/VDF leaves) into
// a WGSL expression string; the emitter in wgsl.ts walks the IR and wires these
// together. Texture leaves (image/tiledimage/hextiledimage), surfacematerial and
// layer are lowered directly to IR primitives by the emitter and are listed in
// PRIMITIVE_LOWERED rather than carrying a math emitter here.
//
// Closure helpers are simplified, documented energy combiners: they preserve
// weight/color provenance for compositing but are not a full OpenPBR evaluation.

import type { IrType } from './ir.ts';

export interface NodeEmitContext {
  readonly varyings: Readonly<{
    position: string;
    normal: string;
    tangent: string;
    bitangent: string;
    texcoord: string;
    viewDir: string;
  }>;
  wgslType(type: IrType): string;
}

export interface NodeInputs {
  /** Positional argument (call nodes); throws if absent and no fallback. */
  at(index: number, fallback?: string): string;
  /** Named input (closure nodes); throws if absent and no fallback. */
  named(name: string, fallback?: string): string;
  has(name: string): boolean;
}

export type NodeEmit = (inp: NodeInputs, type: IrType, ctx: NodeEmitContext) => string;

export interface NodeLowering {
  category: string;
  kind: 'expr' | 'closure';
  emit: NodeEmit;
  /** WGSL helper function(s) this node needs; emitted once, deduplicated. */
  prelude?: string;
}

// --- WGSL preludes -----------------------------------------------------------

export const CLOSURE_PRELUDE = `struct Closure {
  color: vec3f,
  weight: f32,
};
fn mx_closure_zero() -> Closure { return Closure(vec3f(0.0), 0.0); }
fn mx_closure_add(a: Closure, b: Closure) -> Closure { return Closure(a.color + b.color, min(a.weight + b.weight, 1.0)); }
fn mx_closure_mul(a: Closure, w: vec3f) -> Closure { return Closure(a.color * w, a.weight); }
fn mx_closure_mix(a: Closure, b: Closure, t: f32) -> Closure { return Closure(mix(a.color, b.color, t), mix(a.weight, b.weight, t)); }
fn mx_layer(top: Closure, base: Closure) -> Closure { return Closure(top.color + base.color * (1.0 - top.weight), max(top.weight, base.weight)); }
fn mx_oren_nayar_diffuse_bsdf(weight: f32, color: vec3f, roughness: f32, normal: vec3f) -> Closure { return Closure(color * weight, weight); }
fn mx_burley_diffuse_bsdf(weight: f32, color: vec3f, roughness: f32, normal: vec3f) -> Closure { return Closure(color * weight, weight); }
fn mx_translucent_bsdf(weight: f32, color: vec3f, normal: vec3f) -> Closure { return Closure(color * weight, weight); }
fn mx_dielectric_bsdf(weight: f32, tint: vec3f, ior: f32, roughness: f32, normal: vec3f) -> Closure {
  let r = (ior - 1.0) / (ior + 1.0);
  let f = clamp(r * r, 0.0, 1.0);
  return Closure(tint * (weight * f), weight * f);
}
fn mx_conductor_bsdf(weight: f32, ior: vec3f, extinction: vec3f, roughness: f32, normal: vec3f) -> Closure { return Closure(ior * weight, weight); }
fn mx_generalized_schlick_bsdf(weight: f32, color0: vec3f, color90: vec3f, roughness: f32, normal: vec3f) -> Closure { return Closure(mix(color0, color90, roughness) * weight, weight); }
fn mx_sheen_bsdf(weight: f32, color: vec3f, roughness: f32, normal: vec3f) -> Closure { return Closure(color * weight, weight); }
fn mx_subsurface_bsdf(weight: f32, color: vec3f, radius: vec3f, normal: vec3f) -> Closure { return Closure(color * weight, weight); }
fn mx_chiang_hair_bsdf(weight: f32, color: vec3f, roughness: vec2f) -> Closure { return Closure(color * weight, weight); }
fn mx_uniform_edf(color: vec3f) -> Closure { return Closure(color, 1.0); }
fn mx_generalized_schlick_edf(color: vec3f, tint: vec3f) -> Closure { return Closure(color * tint, 1.0); }
fn mx_anisotropic_vdf(absorption: vec3f, scattering: vec3f, anisotropy: f32) -> Closure { return Closure(scattering - absorption, 1.0); }
`;

// Surface shading prelude (T038): the BSDF closure result `{response, throughput}`,
// the lighting context (directional lights + constant environment + view) injected
// as a module-scope uniform, and the `surface` node that accumulates radiance by
// looping over the lights. The per-lobe response here is a documented Lambert
// foundation; T039 replaces it with the real microfacet _reflection/_transmission
// evaluation and T040 adds EDF/VDF energetic composition.
const SURFACE_PRELUDE = `const MX_MAX_LIGHTS: u32 = 4u;
struct BSDF {
  response: vec3f,
  throughput: vec3f,
};
struct MxLight {
  direction: vec4f,
  color: vec4f,
};
struct MxLighting {
  params: vec4f,
  lights: array<MxLight, MX_MAX_LIGHTS>,
};
@group(0) @binding(1) var<uniform> mxLighting: MxLighting;
fn mx_bsdf_response(albedo: vec3f, N: vec3f, L: vec3f) -> vec3f {
  return albedo * max(dot(N, L), 0.0);
}
fn mx_surface(bsdf: Closure, edf: Closure, opacity: f32, N: vec3f, V: vec3f) -> Closure {
  let albedo = bsdf.color * bsdf.weight;
  let count = u32(mxLighting.params.x);
  var acc = albedo * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let dir = mxLighting.lights[i].direction.xyz;
    let intensity = mxLighting.lights[i].direction.w;
    let radiance = mxLighting.lights[i].color.rgb * intensity;
    let L = normalize(-dir);
    acc = acc + mx_bsdf_response(albedo, N, L) * radiance;
  }
  var result: BSDF;
  result.response = acc + edf.color;
  result.throughput = max(vec3f(1.0) - vec3f(bsdf.weight), vec3f(0.0));
  return Closure(result.response, opacity);
}
`;

const LUMINANCE_PRELUDE = `fn mx_luminance(c: vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2722287, 0.6740818, 0.0536895));
  return vec3f(l);
}
`;

const HSV_PRELUDE = `fn mx_rgbtohsv(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let d = mx - mn;
  var h = 0.0;
  if (d > 0.0) {
    if (mx == c.r) { h = (c.g - c.b) / d; }
    else if (mx == c.g) { h = 2.0 + (c.b - c.r) / d; }
    else { h = 4.0 + (c.r - c.g) / d; }
    h = fract(h / 6.0);
  }
  let s = select(0.0, d / mx, mx > 0.0);
  return vec3f(h, s, mx);
}
fn mx_hsvtorgb(c: vec3f) -> vec3f {
  let h = c.x * 6.0;
  let s = c.y;
  let v = c.z;
  let i = floor(h);
  let f = h - i;
  let p = v * (1.0 - s);
  let q = v * (1.0 - s * f);
  let t = v * (1.0 - s * (1.0 - f));
  let m = i32(i) % 6;
  switch (m) {
    case 0 { return vec3f(v, t, p); }
    case 1 { return vec3f(q, v, p); }
    case 2 { return vec3f(p, v, t); }
    case 3 { return vec3f(p, q, v); }
    case 4 { return vec3f(t, p, v); }
    default { return vec3f(v, p, q); }
  }
}
`;

const ROTATE2D_PRELUDE = `fn mx_rotate2d(v: vec2f, deg: f32) -> vec2f {
  let a = radians(deg);
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}
`;

const ROTATE3D_PRELUDE = `fn mx_rotate3d(v: vec3f, deg: f32, axis: vec3f) -> vec3f {
  let a = radians(deg);
  let n = normalize(axis);
  let c = cos(a);
  let s = sin(a);
  return v * c + cross(n, v) * s + n * dot(n, v) * (1.0 - c);
}
`;

const NORMALMAP_PRELUDE = `fn mx_normalmap(sample: vec3f, scale: f32, N: vec3f, T: vec3f) -> vec3f {
  let t = normalize(T - N * dot(N, T));
  let b = cross(N, t);
  let m = sample * 2.0 - 1.0;
  let v = vec3f(m.xy * scale, m.z);
  return normalize(t * v.x + b * v.y + N * v.z);
}
`;

const FRACTAL3D_PRELUDE = `fn mx_hash3(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}
fn mx_fractal3d(p: vec3f, amplitude: f32, octaves: f32) -> f32 {
  var sum = 0.0;
  var amp = amplitude;
  var freq = 1.0;
  let n = i32(octaves);
  for (var i = 0; i < n; i = i + 1) {
    sum = sum + mx_hash3(p * freq) * amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  return sum;
}
`;

const ARTISTIC_IOR_PRELUDE = `fn mx_artistic_ior(reflectivity: vec3f, edge_color: vec3f) -> vec3f {
  let r = clamp(reflectivity, vec3f(0.0), vec3f(0.99));
  let s = sqrt(r);
  return (1.0 + s) / max(1.0 - s, vec3f(1e-4));
}
`;

const ROUGHNESS_ANISO_PRELUDE = `fn mx_roughness_anisotropy(roughness: f32, anisotropy: f32) -> vec2f {
  let r2 = roughness * roughness;
  let a = clamp(anisotropy, 0.0, 1.0);
  return vec2f(r2 / max(1.0 - a * 0.9, 1e-3), r2 * (1.0 - a * 0.9));
}
`;

const ROUGHNESS_DUAL_PRELUDE = `fn mx_roughness_dual(roughness: vec2f) -> vec2f { return roughness * roughness; }
`;

const HAIR_PRELUDE = `fn mx_chiang_hair_absorption_from_color(color: vec3f) -> vec3f {
  let c = clamp(color, vec3f(1e-4), vec3f(1.0));
  let l = log(c);
  return l * l;
}
fn mx_chiang_hair_roughness(longitudinal: f32, azimuthal: f32) -> vec2f {
  return vec2f(longitudinal * longitudinal, azimuthal * azimuthal);
}
fn mx_deon_hair_absorption_from_melanin(eumelanin: f32, pheomelanin: f32) -> vec3f {
  return eumelanin * vec3f(0.419, 0.697, 1.37) + pheomelanin * vec3f(0.187, 0.4, 1.05);
}
`;

// --- Registry ----------------------------------------------------------------

const op2 = (sym: string): NodeEmit => (inp) => `(${inp.at(0)} ${sym} ${inp.at(1)})`;
const fn1 = (name: string): NodeEmit => (inp) => `${name}(${inp.at(0)})`;
const fn2 = (name: string): NodeEmit => (inp) => `${name}(${inp.at(0)}, ${inp.at(1)})`;

function expr(category: string, emit: NodeEmit, prelude?: string): NodeLowering {
  return prelude !== undefined ? { category, kind: 'expr', emit, prelude } : { category, kind: 'expr', emit };
}
function closure(category: string, emit: NodeEmit, prelude?: string): NodeLowering {
  return prelude !== undefined ? { category, kind: 'closure', emit, prelude } : { category, kind: 'closure', emit };
}

const LOWERINGS: readonly NodeLowering[] = [
  // math
  expr('absval', fn1('abs')),
  expr('add', op2('+')),
  expr('subtract', op2('-')),
  expr('multiply', op2('*')),
  expr('divide', op2('/')),
  expr('power', fn2('pow')),
  expr('sin', fn1('sin')),
  expr('sqrt', fn1('sqrt')),
  expr('ln', fn1('log')),
  expr('sign', fn1('sign')),
  expr('normalize', fn1('normalize')),
  expr('min', fn2('min')),
  expr('max', fn2('max')),
  expr('clamp', (inp) => `clamp(${inp.at(0)}, ${inp.at(1, '0.0')}, ${inp.at(2, '1.0')})`),
  expr('dotproduct', fn2('dot')),
  expr('dot', (inp) => inp.at(0)),
  expr('invert', (inp) => `(${inp.at(1, '1.0')} - ${inp.at(0)})`),
  // compositing / channel
  expr('mix', (inp) => `mix(${inp.at(1)}, ${inp.at(0)}, ${inp.at(2)})`),
  expr('extract', (inp) => `${inp.at(0)}[${inp.at(1)}]`),
  expr('combine2', (inp) => `vec2f(${inp.at(0)}, ${inp.at(1)})`),
  expr('combine3', (inp) => `vec3f(${inp.at(0)}, ${inp.at(1)}, ${inp.at(2)})`),
  expr('constant', (inp) => inp.at(0)),
  // conditionals
  expr('ifequal', (inp) => `select(${inp.at(3)}, ${inp.at(2)}, ${inp.at(0)} == ${inp.at(1)})`),
  expr('ifgreater', (inp) => `select(${inp.at(3)}, ${inp.at(2)}, ${inp.at(0)} > ${inp.at(1)})`),
  expr('ifgreatereq', (inp) => `select(${inp.at(3)}, ${inp.at(2)}, ${inp.at(0)} >= ${inp.at(1)})`),
  // adjustment
  expr('luminance', (inp) => `mx_luminance(${inp.at(0)})`, LUMINANCE_PRELUDE),
  expr('rgbtohsv', fn1('mx_rgbtohsv'), HSV_PRELUDE),
  expr('hsvtorgb', fn1('mx_hsvtorgb'), HSV_PRELUDE),
  // geometric
  expr('position', (_inp, _type, ctx) => ctx.varyings.position),
  expr('texcoord', (_inp, _type, ctx) => ctx.varyings.texcoord),
  expr(
    'normalmap',
    (inp, _type, ctx) => `mx_normalmap(${inp.at(0)}, ${inp.at(1, '1.0')}, ${ctx.varyings.normal}, ${ctx.varyings.tangent})`,
    NORMALMAP_PRELUDE,
  ),
  // transforms
  expr('rotate2d', (inp) => `mx_rotate2d(${inp.at(0)}, ${inp.at(1, '0.0')})`, ROTATE2D_PRELUDE),
  expr('rotate3d', (inp) => `mx_rotate3d(${inp.at(0)}, ${inp.at(1, '0.0')}, ${inp.at(2, 'vec3f(0.0, 0.0, 1.0)')})`, ROTATE3D_PRELUDE),
  // procedural
  expr('fractal3d', (inp, _type, ctx) => `mx_fractal3d(${ctx.varyings.position}, ${inp.at(0, '1.0')}, ${inp.at(1, '3.0')})`, FRACTAL3D_PRELUDE),
  // pbr helpers
  expr('artistic_ior', (inp) => `mx_artistic_ior(${inp.at(0)}, ${inp.at(1, 'vec3f(0.0)')})`, ARTISTIC_IOR_PRELUDE),
  expr('roughness_anisotropy', (inp) => `mx_roughness_anisotropy(${inp.at(0, '0.0')}, ${inp.at(1, '0.0')})`, ROUGHNESS_ANISO_PRELUDE),
  expr('roughness_dual', (inp) => `mx_roughness_dual(${inp.at(0, 'vec2f(0.0)')})`, ROUGHNESS_DUAL_PRELUDE),
  expr('chiang_hair_absorption_from_color', (inp) => `mx_chiang_hair_absorption_from_color(${inp.at(0)})`, HAIR_PRELUDE),
  expr('chiang_hair_roughness', (inp) => `mx_chiang_hair_roughness(${inp.at(0, '0.0')}, ${inp.at(1, '0.0')})`, HAIR_PRELUDE),
  expr('deon_hair_absorption_from_melanin', (inp) => `mx_deon_hair_absorption_from_melanin(${inp.at(0, '0.0')}, ${inp.at(1, '0.0')})`, HAIR_PRELUDE),
  // closures (BSDF / EDF / VDF / surface)
  closure(
    'oren_nayar_diffuse_bsdf',
    (inp, _type, ctx) => `mx_oren_nayar_diffuse_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(0.18)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'burley_diffuse_bsdf',
    (inp, _type, ctx) => `mx_burley_diffuse_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(0.18)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'translucent_bsdf',
    (inp, _type, ctx) => `mx_translucent_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(1.0)')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'dielectric_bsdf',
    (inp, _type, ctx) => `mx_dielectric_bsdf(${inp.named('weight', '1.0')}, ${inp.named('tint', 'vec3f(1.0)')}, ${inp.named('ior', '1.5')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'conductor_bsdf',
    (inp, _type, ctx) => `mx_conductor_bsdf(${inp.named('weight', '1.0')}, ${inp.named('ior', 'vec3f(0.18)')}, ${inp.named('extinction', 'vec3f(3.0)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'generalized_schlick_bsdf',
    (inp, _type, ctx) => `mx_generalized_schlick_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color0', 'vec3f(1.0)')}, ${inp.named('color90', 'vec3f(1.0)')}, ${inp.named('roughness', '0.0')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'sheen_bsdf',
    (inp, _type, ctx) => `mx_sheen_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(1.0)')}, ${inp.named('roughness', '0.3')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'subsurface_bsdf',
    (inp, _type, ctx) => `mx_subsurface_bsdf(${inp.named('weight', '1.0')}, ${inp.named('color', 'vec3f(1.0)')}, ${inp.named('radius', 'vec3f(1.0)')}, ${inp.named('normal', ctx.varyings.normal)})`,
  ),
  closure(
    'chiang_hair_bsdf',
    (inp) => `mx_chiang_hair_bsdf(${inp.named('weight', '1.0')}, ${inp.named('tint', 'vec3f(1.0)')}, ${inp.named('roughness', 'vec2f(0.1)')})`,
  ),
  closure(
    'anisotropic_vdf',
    (inp) => `mx_anisotropic_vdf(${inp.named('absorption', 'vec3f(0.0)')}, ${inp.named('scattering', 'vec3f(0.0)')}, ${inp.named('anisotropy', '0.0')})`,
  ),
  closure('uniform_edf', (inp) => `mx_uniform_edf(${inp.named('color', 'vec3f(0.0)')})`),
  closure('generalized_schlick_edf', (inp) => `mx_generalized_schlick_edf(${inp.named('color', 'vec3f(0.0)')}, ${inp.named('tint', 'vec3f(1.0)')})`),
  closure('surface', (inp, _type, ctx) => `mx_surface(${inp.named('bsdf', 'mx_closure_zero()')}, ${inp.named('edf', 'mx_closure_zero()')}, ${inp.named('opacity', '1.0')}, ${ctx.varyings.normal}, ${ctx.varyings.viewDir})`, SURFACE_PRELUDE),
];

export const NODE_REGISTRY: ReadonlyMap<string, NodeLowering> = new Map(LOWERINGS.map((l) => [l.category, l]));

/** Categories lowered directly to IR primitives by the emitter (textures, layering, material root). */
export const PRIMITIVE_LOWERED: ReadonlySet<string> = new Set([
  'image',
  'tiledimage',
  'hextiledimage',
  'layer',
  'surfacematerial',
]);

export function getNodeLowering(category: string): NodeLowering | undefined {
  return NODE_REGISTRY.get(category);
}

export function isNodeCovered(category: string): boolean {
  return NODE_REGISTRY.has(category) || PRIMITIVE_LOWERED.has(category);
}

export function coveredCategories(): string[] {
  return [...NODE_REGISTRY.keys(), ...PRIMITIVE_LOWERED];
}
