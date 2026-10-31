// T055d: emit a WGSL `LayeredClosure` struct and a generated
// `mx_surface_layered(vary) -> LayeredClosure` fill function for a resolved
// surface. The per-input IR expressions from T055c (lowerSurfaceInputsToIr) back
// the struct fields, so textured/procedural inputs flow into the shader as node
// sub-graphs (texture binding / node call) while literal inputs fold to IR
// constants. The family weight/colour assembly mirrors the CPU lowering
// surfaceGraphToLayered (T055b) but is re-expressed here as WGSL that references
// the lowered input refs, so weights stay dynamic (a textured metalness is not
// flattened). Unsupported upstream nodes are diagnosed by the T055c pass (REQ-013).
// The shared runtime closure library (T056) consumes the emitted LayeredClosure.

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';
import type { ResolvedGraph } from '../materialx/graph.ts';
import type {
  NormalizedSurfaceInput,
  ResolvedSurface,
  SurfaceFamily,
} from '../materialx/surface-graph.ts';
import { closureLibraryPrelude } from './closure-library.ts';
import { FLOAT, IrModuleBuilder, type IrRef, type IrType, type ShaderIr } from './ir.ts';
import { lowerSurfaceInputsToIr } from './surface-ir.ts';
import {
  emitVaryingsStruct,
  litFloat,
  lowerExprs,
  type WgslBinding,
  type WgslUniformField,
} from './wgsl.ts';

const SURFACE_ENTRY = 'mx_surface_layered';
const SURFACE_RETURN = 'LayeredClosure';
const SURFACE_OPACITY_ENTRY = 'mx_surface_opacity';

/** The eight BSDF lobe kinds of the layered model (ir.ts), as WGSL u32 constants. */
type LobeKind =
  | 'oren_nayar_diffuse'
  | 'burley_diffuse'
  | 'translucent'
  | 'dielectric_reflection'
  | 'dielectric_transmission'
  | 'conductor'
  | 'generalized_schlick'
  | 'sheen'
  | 'chiang_hair'
  | 'subsurface';

const LOBE_KIND_CONST: Readonly<Record<LobeKind, string>> = {
  chiang_hair: 'MX_LOBE_CHIANG_HAIR',
  oren_nayar_diffuse: 'MX_LOBE_OREN_NAYAR_DIFFUSE',
  burley_diffuse: 'MX_LOBE_BURLEY_DIFFUSE',
  translucent: 'MX_LOBE_TRANSLUCENT',
  dielectric_reflection: 'MX_LOBE_DIELECTRIC_REFLECTION',
  dielectric_transmission: 'MX_LOBE_DIELECTRIC_TRANSMISSION',
  conductor: 'MX_LOBE_CONDUCTOR',
  generalized_schlick: 'MX_LOBE_GENERALIZED_SCHLICK',
  sheen: 'MX_LOBE_SHEEN',
  subsurface: 'MX_LOBE_SUBSURFACE',
};

/** Numeric values of the MX_LOBE_* constants below. */
const LOBE_KIND_NUM: Readonly<Record<LobeKind, number>> = {
  chiang_hair: 9,
  oren_nayar_diffuse: 0,
  burley_diffuse: 1,
  translucent: 2,
  dielectric_reflection: 3,
  conductor: 4,
  generalized_schlick: 5,
  sheen: 6,
  subsurface: 7,
  dielectric_transmission: 8,
};

/** WGSL prelude: the layered-closure struct family consumed by the runtime eval
 *  library (T056). A fixed lobe array keeps the type host-shareable; `lobeCount`
 *  and the `has*` flags gate which members the evaluator reads. */
export const LAYERED_CLOSURE_PRELUDE = `const MX_MAX_LOBES: u32 = 8u;
const MX_LOBE_OREN_NAYAR_DIFFUSE: u32 = 0u;
const MX_LOBE_BURLEY_DIFFUSE: u32 = 1u;
const MX_LOBE_TRANSLUCENT: u32 = 2u;
const MX_LOBE_DIELECTRIC_REFLECTION: u32 = 3u;
const MX_LOBE_CONDUCTOR: u32 = 4u;
const MX_LOBE_GENERALIZED_SCHLICK: u32 = 5u;
const MX_LOBE_SHEEN: u32 = 6u;
const MX_LOBE_SUBSURFACE: u32 = 7u;
const MX_LOBE_DIELECTRIC_TRANSMISSION: u32 = 8u;
const MX_LOBE_CHIANG_HAIR: u32 = 9u;
struct MxBsdfLobe {
  kind: u32,
  weight: f32,
  color: vec3f,
  color90: vec3f,
  roughness: f32,
  anisotropy: f32,
  rotation: f32,
  ior: f32,
  extinction: vec3f,
  thin: f32,
  dispersion: f32,
  hairTintTRT: vec3f,
};
struct MxCoatLayer { weight: f32, color: vec3f, roughness: f32, ior: f32 };
struct MxSheenLayer { weight: f32, color: vec3f, roughness: f32 };
struct MxFuzzLayer { weight: f32, color: vec3f, roughness: f32 };
struct MxThinFilmLayer { weight: f32, thickness: f32, ior: f32 };
struct LayeredClosure {
  lobes: array<MxBsdfLobe, MX_MAX_LOBES>,
  lobeCount: u32,
  coat: MxCoatLayer,
  sheen: MxSheenLayer,
  fuzz: MxFuzzLayer,
  thinFilm: MxThinFilmLayer,
  emission: vec3f,
  opacity: f32,
  hasCoat: u32,
  hasSheen: u32,
  hasFuzz: u32,
  hasThinFilm: u32,
  hasEmission: u32,
  interiorSigmaA: vec3f,
  interiorSigmaS: vec3f,
  interiorG: f32,
  hasInterior: u32,
  shadingNormal: vec3f,
  hasShadingNormal: u32,
  shadingTangent: vec3f,
  hasShadingTangent: u32,
};`;

/** One BSDF lobe to assign into `c.lobes[i]`; fields are WGSL expression strings. */
interface LobeWgsl {
  kind: LobeKind;
  weight: string;
  color: string;
  color90?: string;
  hairTintTRT?: string;
  roughness?: string;
  anisotropy?: string;
  rotation?: string;
  ior?: string;
  dispersion?: string;
  extinction?: string;
  /** Thin-walled transmission flag (1.0 = straight-through, no refraction). */
  thin?: string;
  /** False when the weight is statically zero (default true). */
  active?: boolean;
}

interface FamilyWgsl {
  /** Extra `let mx_* = ...;` helper statements emitted before the assignments. */
  locals: string[];
  lobes: LobeWgsl[];
  coat?: { weight: string; color: string; roughness: string; ior: string };
  sheen?: { weight: string; color: string; roughness: string };
  fuzz?: { weight: string; color: string; roughness: string };
  thinFilm?: { weight: string; thickness: string; ior: string };
  emission?: string;
  opacity: string;
  /** Statically known to have a non-zero transmission weight (default: a transmission lobe exists). */
  transmission?: boolean;
  /** Statically known to have non-zero dispersion (default: a lobe declares dispersion). */
  dispersion?: boolean;
}

/** Closure features a surface can produce, known at compile time; lets hosts drop dead lighting paths. */
export interface SurfaceFeatures {
  /** Proven coverage opacity of one; absent means the host must retain alpha traversal. */
  opaque?: boolean;
  /** Absent metadata is conservative; false proves no fuzz layer is reachable. */
  fuzz?: boolean;
  coat: boolean;
  transmission: boolean;
  dispersion: boolean;
  thinFilm: boolean;
  /** MX_LOBE_* kinds of the lobes whose weight may be non-zero. */
  lobeKinds: readonly number[];
}

export interface LayeredSurfaceModule {
  code: string;
  entryPoint: string;
  returnType: string;
  family: SurfaceFamily;
  uniforms: WgslUniformField[];
  textures: WgslBinding[];
  samplers: WgslBinding[];
  /** MxVaryings primvar (`v_*`) fields the surface fn reads; a raster/forward
   *  host must feed these (e.g. map `st` to the texcoord stream like the path
   *  tracer megakernel does) or they default to zero. */
  primvarFields: Map<string, IrType>;
  /** MxVaryings extra input (`in_*`) fields the surface fn reads. */
  extraInputs: Map<string, IrType>;
  /** Present iff the module declares the lighting uniform. Closure construction
   *  never evaluates lighting, so this stays absent (evaluation lands in T056). */
  lighting?: { group: number; binding: number };
  /** Absent for hand-built modules: hosts must then assume every feature. */
  features?: SurfaceFeatures;
}

/** Build the WGSL expression helpers for one surface. `s`/`col` resolve an input
 *  to the T055c IR ref (recording it so lowerExprs emits it) or to a literal
 *  fallback; `lit`/`dyn` read the normalized source for topology decisions. */
function makeCtx(surface: ResolvedSurface, inputs: ReadonlyMap<string, IrRef>, used: Set<IrRef>) {
  const refOf = (name: string): IrRef | undefined => {
    const ref = inputs.get(name);
    if (ref !== undefined) used.add(ref);
    return ref;
  };
  const source = (name: string): NormalizedSurfaceInput['source'] | undefined => surface.inputs.get(name)?.source;
  return {
    s(name: string, fallback: number): string {
      const ref = refOf(name);
      return ref ?? litFloat(fallback);
    },
    col(name: string, fallback: readonly [number, number, number]): string {
      const ref = refOf(name);
      return ref ?? `vec3f(${fallback.map(litFloat).join(', ')})`;
    },
    lit(name: string, fallback: number): number {
      const src = source(name);
      if (src && (src.kind === 'value' || src.kind === 'default')) {
        const x = src.value[0];
        return x !== undefined && Number.isFinite(x) ? x : fallback;
      }
      return fallback;
    },
    litRgb(name: string, fallback: readonly [number, number, number]): [number, number, number] {
      const src = source(name);
      if (src && (src.kind === 'value' || src.kind === 'default') && src.value.length >= 3) {
        return [src.value[0] ?? 0, src.value[1] ?? 0, src.value[2] ?? 0];
      }
      return [fallback[0], fallback[1], fallback[2]];
    },
    dyn(name: string): boolean {
      return source(name)?.kind === 'connection' || surface.inputs.get(name)?.parameter !== undefined;
    },
    literal(name: string): boolean {
      const kind = source(name)?.kind;
      return surface.inputs.get(name)?.parameter === undefined && (kind === undefined || kind === 'value' || kind === 'default');
    },
  };
}

type Ctx = ReturnType<typeof makeCtx>;

/** Average a vec3 opacity input down to a scalar (matches surface-lower.ts). */
function avgOpacity(expr: string): string {
  return `((${expr}).x + (${expr}).y + (${expr}).z) / 3.0`;
}

function clampExpr(expr: string): string {
  return `clamp(${expr}, 0.0, 1.0)`;
}

function presentWeighted(c: Ctx, name: string, threshold = 0): boolean {
  return c.lit(name, 0) > threshold || c.dyn(name);
}

/** A weight input that may be non-zero, given its family default when unauthored. */
function mayWeigh(c: Ctx, name: string, fallback: number): boolean {
  return !c.literal(name) || c.lit(name, fallback) > 0;
}

function mayBeBelowOne(c: Ctx, name: string, fallback = 0): boolean {
  return !c.literal(name) || c.lit(name, fallback) < 1;
}

function opaqueSurface(family: SurfaceFamily, c: Ctx): boolean {
  if (family === 'disney_principled' || family === 'simple_hair') return true;
  if (family === 'gltf_pbr') {
    if (c.literal('alpha_mode') && c.lit('alpha_mode', 0) === 0) return true;
    return c.literal('alpha') && c.lit('alpha', 1) >= 1
      && c.literal('alpha_cutoff') && c.lit('alpha_cutoff', 0.5) <= 1;
  }
  if (family === 'UsdPreviewSurface') {
    return c.literal('opacityThreshold') && c.lit('opacityThreshold', 0) <= 0
      || c.literal('opacity') && c.lit('opacity', 1) >= 1
        && c.literal('opacityThreshold') && c.lit('opacityThreshold', 0) <= 1;
  }
  if (family === 'open_pbr_surface') return c.literal('geometry_opacity') && c.lit('geometry_opacity', 1) >= 1;
  return c.literal('opacity') && c.litRgb('opacity', [1, 1, 1]).every(x => x >= 1);
}

/** Coverage opacity of one family: optional `let mx_*` helpers plus the expression.
 *  Shared by the full closure fill and the opacity-only visibility evaluator so the
 *  alpha/cutoff/threshold rules live in exactly one place. */
interface OpacityWgsl {
  locals: string[];
  expr: string;
}

function familyOpacity(family: SurfaceFamily, c: Ctx): OpacityWgsl {
  switch (family) {
    case 'standard_surface':
      return { locals: [], expr: avgOpacity(c.col('opacity', [1, 1, 1])) };
    case 'open_pbr_surface':
      return { locals: [], expr: c.s('geometry_opacity', 1) };
    case 'gltf_pbr': {
      const alpha = clampExpr(c.s('alpha', 1));
      const mode = c.s('alpha_mode', 0);
      const cutoff = c.s('alpha_cutoff', 0.5);
      return { locals: [], expr: `select(select(${alpha}, select(0.0, 1.0, ${alpha} >= ${cutoff}), ${mode} == 1), 1.0, ${mode} == 0)` };
    }
    case 'UsdPreviewSurface':
      return {
        locals: [
          `  let mx_opacity = ${clampExpr(c.s('opacity', 1))};`,
          `  let mx_threshold = ${c.s('opacityThreshold', 0)};`,
        ],
        expr: 'select(1.0, 0.0, mx_threshold > 0.0 && mx_opacity < mx_threshold)',
      };
    case 'disney_principled':
    case 'simple_hair':
      return { locals: [], expr: '1.0' };
  }
}

// --- standard_surface --------------------------------------------------------

function standardSurface(c: Ctx): FamilyWgsl {
  const specRough = c.s('specular_roughness', 0.2);
  const diffRough = c.s('diffuse_roughness', 0);
  const aniso = c.s('specular_anisotropy', 0);
  const rot = c.s('specular_rotation', 0);
  const ior = c.s('specular_IOR', 1.5);
  const baseColor = `clamp(${c.col('base_color', [1, 1, 1])}, vec3f(0.0), vec3f(1.0))`;
  const specColor = c.col('specular_color', [1, 1, 1]);
  const transColor = c.col('transmission_color', [1, 1, 1]);
  const sssColor = c.col('subsurface_color', [1, 1, 1]);
  const locals = [
    `  let mx_base = ${c.s('base', 1)};`,
    `  let mx_metal = ${clampExpr(c.s('metalness', 0))};`,
    `  let mx_trans = ${clampExpr(c.s('transmission', 0))};`,
    `  let mx_spec = ${clampExpr(c.s('specular', 1))};`,
    `  let mx_sss = ${clampExpr(c.s('subsurface', 0))};`,
    `  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`,
  ];
  const lobes: LobeWgsl[] = [
    { kind: 'conductor', weight: 'mx_metal', color: baseColor, roughness: specRough, anisotropy: aniso, rotation: rot, active: mayWeigh(c, 'metalness', 0) },
    { kind: 'dielectric_transmission', weight: '((1.0 - mx_metal) * mx_trans)', color: transColor, roughness: specRough, ior,
      dispersion: `select(0.0, 20.0 / max(${c.s('transmission_dispersion', 0)}, 1e-6), ${c.s('transmission_dispersion', 0)} > 0.0)`,
      active: mayWeigh(c, 'transmission', 0) },
    { kind: 'dielectric_reflection', weight: '(mx_diel * mx_spec)', color: specColor, roughness: specRough, ior, anisotropy: aniso, rotation: rot, active: mayWeigh(c, 'specular', 1) },
    { kind: 'burley_diffuse', weight: '(mx_diel * mx_base)', color: baseColor, roughness: diffRough, active: mayWeigh(c, 'base', 1) },
    { kind: 'subsurface', weight: '(mx_diel * mx_sss)', color: sssColor, active: mayWeigh(c, 'subsurface', 0) },
  ];
  const out: FamilyWgsl = { locals, lobes, opacity: familyOpacity('standard_surface', c).expr,
    transmission: presentWeighted(c, 'transmission'), dispersion: presentWeighted(c, 'transmission_dispersion') };
  if (presentWeighted(c, 'coat')) out.coat = { weight: clampExpr(c.s('coat', 0)), color: c.col('coat_color', [1, 1, 1]), roughness: c.s('coat_roughness', 0.1), ior: c.s('coat_IOR', 1.5) };
  if (presentWeighted(c, 'sheen')) out.sheen = { weight: clampExpr(c.s('sheen', 0)), color: c.col('sheen_color', [1, 1, 1]), roughness: c.s('sheen_roughness', 0.3) };
  if (presentWeighted(c, 'thin_film_thickness')) out.thinFilm = { weight: '1.0', thickness: c.s('thin_film_thickness', 0), ior: c.s('thin_film_IOR', 1.5) };
  if (presentWeighted(c, 'emission')) out.emission = `(${c.col('emission_color', [1, 1, 1])} * ${c.s('emission', 0)})`;
  return out;
}

// --- open_pbr_surface --------------------------------------------------------

function openPbrSurface(c: Ctx): FamilyWgsl {
  const specRough = c.s('specular_roughness', 0.3);
  const diffRough = c.s('base_diffuse_roughness', 0);
  const aniso = c.s('specular_roughness_anisotropy', 0);
  const ior = c.s('specular_ior', 1.5);
  const baseColor = c.col('base_color', [0.8, 0.8, 0.8]);
  const specColor = c.col('specular_color', [1, 1, 1]);
  const transColor = c.col('transmission_color', [1, 1, 1]);
  const sssColor = c.col('subsurface_color', [0.8, 0.8, 0.8]);
  // Thin-walled: straight-through transmission (no refraction) + a front-surface
  // specular reflection that survives transmission=1 (carries thin-film iridescence).
  const thinWalled = c.lit('geometry_thin_walled', 0) > 0.5;
  const locals = [
    `  let mx_baseW = ${clampExpr(c.s('base_weight', 1))};`,
    `  let mx_metal = ${clampExpr(c.s('base_metalness', 0))};`,
    `  let mx_specW = ${clampExpr(c.s('specular_weight', 1))};`,
    `  let mx_trans = ${clampExpr(c.s('transmission_weight', 0))};`,
    `  let mx_sss = ${clampExpr(c.s('subsurface_weight', 0))};`,
    `  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`,
  ];
  const reflW = thinWalled ? '((1.0 - mx_metal) * mx_specW)' : '(mx_diel * mx_specW)';
  const transLobe: LobeWgsl = { kind: 'dielectric_transmission', weight: '((1.0 - mx_metal) * mx_trans)', color: transColor, roughness: specRough, ior,
    dispersion: `(max(${c.s('transmission_dispersion_scale', 0)}, 0.0) * 20.0 / max(${c.s('transmission_dispersion_abbe_number', 20)}, 1e-6))`,
    active: mayWeigh(c, 'transmission_weight', 0) };
  if (thinWalled) transLobe.thin = '1.0';
  const lobes: LobeWgsl[] = [
    { kind: 'conductor', weight: 'mx_metal', color: baseColor, roughness: specRough, anisotropy: aniso, active: mayWeigh(c, 'base_metalness', 0) },
    transLobe,
    { kind: 'dielectric_reflection', weight: reflW, color: specColor, roughness: specRough, ior, anisotropy: aniso, active: mayWeigh(c, 'specular_weight', 1) },
    { kind: 'burley_diffuse', weight: '(mx_diel * mx_baseW)', color: baseColor, roughness: diffRough, active: mayWeigh(c, 'base_weight', 1) },
    { kind: 'subsurface', weight: '(mx_diel * mx_sss)', color: sssColor, active: mayWeigh(c, 'subsurface_weight', 0) },
  ];
  const out: FamilyWgsl = { locals, lobes, opacity: familyOpacity('open_pbr_surface', c).expr,
    transmission: presentWeighted(c, 'transmission_weight'),
    dispersion: !thinWalled && presentWeighted(c, 'transmission_dispersion_scale') };
  if (presentWeighted(c, 'coat_weight')) out.coat = { weight: clampExpr(c.s('coat_weight', 0)), color: c.col('coat_color', [1, 1, 1]), roughness: c.s('coat_roughness', 0), ior: c.s('coat_ior', 1.6) };
  if (presentWeighted(c, 'fuzz_weight')) out.fuzz = { weight: clampExpr(c.s('fuzz_weight', 0)), color: c.col('fuzz_color', [1, 1, 1]), roughness: c.s('fuzz_roughness', 0.5) };
  if (presentWeighted(c, 'thin_film_weight')) out.thinFilm = { weight: clampExpr(c.s('thin_film_weight', 0)), thickness: `(${c.s('thin_film_thickness', 0.5)} * 1000.0)`, ior: c.s('thin_film_ior', 1.4) };
  if (presentWeighted(c, 'emission_luminance')) out.emission = `(${c.col('emission_color', [1, 1, 1])} * ${c.s('emission_luminance', 0)})`;
  return out;
}

// --- gltf_pbr ----------------------------------------------------------------

function gltfPbr(c: Ctx): FamilyWgsl {
  const rough = c.s('roughness', 1);
  const aniso = c.s('anisotropy_strength', 0);
  const rot = c.s('anisotropy_rotation', 0);
  const ior = c.s('ior', 1.5);
  const baseColor = c.col('base_color', [1, 1, 1]);
  const specColor = c.col('specular_color', [1, 1, 1]);
  const locals = [
    `  let mx_metal = ${clampExpr(c.s('metallic', 1))};`,
    `  let mx_trans = ${clampExpr(c.s('transmission', 0))};`,
    `  let mx_spec = ${clampExpr(c.s('specular', 1))};`,
    `  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`,
  ];
  const lobes: LobeWgsl[] = [
    { kind: 'conductor', weight: 'mx_metal', color: baseColor, roughness: rough, anisotropy: aniso, rotation: rot, active: mayWeigh(c, 'metallic', 1) },
    { kind: 'dielectric_transmission', weight: '((1.0 - mx_metal) * mx_trans)', color: baseColor, roughness: rough, ior, dispersion: `max(${c.s('dispersion', 0)}, 0.0)`, active: mayWeigh(c, 'transmission', 0) },
    { kind: 'dielectric_reflection', weight: '(mx_diel * mx_spec)', color: specColor, roughness: rough, ior, anisotropy: aniso, rotation: rot, active: mayWeigh(c, 'specular', 1) },
    { kind: 'burley_diffuse', weight: 'mx_diel', color: baseColor, roughness: rough },
  ];
  const out: FamilyWgsl = {
    locals, lobes,
    opacity: familyOpacity('gltf_pbr', c).expr,
    transmission: presentWeighted(c, 'transmission'),
    dispersion: presentWeighted(c, 'dispersion'),
  };
  if (presentWeighted(c, 'clearcoat')) out.coat = { weight: clampExpr(c.s('clearcoat', 0)), color: 'vec3f(1.0)', roughness: c.s('clearcoat_roughness', 0), ior: '1.5' };
  const sheenRgb = c.litRgb('sheen_color', [0, 0, 0]);
  if (Math.max(sheenRgb[0], sheenRgb[1], sheenRgb[2]) > 0 || c.dyn('sheen_color')) {
    const sc = c.col('sheen_color', [0, 0, 0]);
    out.sheen = { weight: `max(max((${sc}).x, (${sc}).y), (${sc}).z)`, color: sc, roughness: c.s('sheen_roughness', 0) };
  }
  if (presentWeighted(c, 'iridescence')) out.thinFilm = { weight: clampExpr(c.s('iridescence', 0)), thickness: c.s('iridescence_thickness', 100), ior: '1.3' };
  const emRgb = c.litRgb('emissive', [0, 0, 0]);
  if (emRgb[0] > 0 || emRgb[1] > 0 || emRgb[2] > 0 || c.dyn('emissive')) out.emission = c.col('emissive', [0, 0, 0]);
  return out;
}

// --- UsdPreviewSurface -------------------------------------------------------

function usdPreviewSurface(c: Ctx): FamilyWgsl {
  const rough = c.s('roughness', 0.5);
  const ior = c.s('ior', 1.5);
  const diffuse = c.col('diffuseColor', [0.18, 0.18, 0.18]);
  const useSpecular = c.lit('useSpecularWorkflow', 0) >= 0.5;
  const specColor = useSpecular ? c.col('specularColor', [0, 0, 0]) : 'vec3f(1.0)';
  const mayTransmit = (c.dyn('opacity') || c.lit('opacity', 1) < 1)
    && (c.dyn('opacityThreshold') || c.lit('opacityThreshold', 0) <= 0);
  const metal = `  let mx_metal = ${clampExpr(c.s('metallic', 0))};`;
  const opacity = familyOpacity('UsdPreviewSurface', c);
  const locals = [
    metal,
    `  let mx_diel = 1.0 - mx_metal;`,
    ...opacity.locals,
    `  let mx_diffuseShare = select(mx_opacity, 1.0, mx_threshold > 0.0);`,
  ];
  const lobes: LobeWgsl[] = [
    { kind: 'conductor', weight: 'mx_metal', color: diffuse, roughness: rough, active: mayWeigh(c, 'metallic', 0) },
    { kind: 'dielectric_reflection', weight: '(mx_diel * mx_diffuseShare)', color: specColor, roughness: rough, ior },
    { kind: 'dielectric_transmission', weight: '(mx_diel * (1.0 - mx_diffuseShare))', color: 'vec3f(1.0)', roughness: rough, ior, active: mayTransmit },
    { kind: 'burley_diffuse', weight: '(mx_diel * mx_diffuseShare)', color: diffuse, roughness: rough },
  ];
  const out: FamilyWgsl = { locals, lobes,
    opacity: opacity.expr,
    transmission: mayTransmit };
  if (presentWeighted(c, 'clearcoat')) out.coat = { weight: clampExpr(c.s('clearcoat', 0)), color: 'vec3f(1.0)', roughness: c.s('clearcoatRoughness', 0.01), ior: '1.5' };
  const emRgb = c.litRgb('emissiveColor', [0, 0, 0]);
  if (emRgb[0] > 0 || emRgb[1] > 0 || emRgb[2] > 0 || c.dyn('emissiveColor')) out.emission = c.col('emissiveColor', [0, 0, 0]);
  return out;
}

// --- disney_principled -------------------------------------------------------

function disneyPrincipled(c: Ctx): FamilyWgsl {
  const rough = c.s('roughness', 0.5);
  const aniso = c.s('anisotropic', 0);
  const ior = c.s('ior', 1.5);
  const baseColor = c.col('baseColor', [0.16, 0.16, 0.16]);
  const specColor = `mix(vec3f(1.0), ${baseColor}, ${clampExpr(c.s('specularTint', 0))})`;
  const locals = [
    `  let mx_metal = ${clampExpr(c.s('metallic', 0))};`,
    `  let mx_trans = ${clampExpr(c.s('specTrans', 0))};`,
    `  let mx_spec = ${clampExpr(c.s('specular', 0.5))};`,
    `  let mx_sss = ${clampExpr(c.s('subsurface', 0))};`,
    `  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`,
  ];
  const dielectric = mayBeBelowOne(c, 'metallic') && mayBeBelowOne(c, 'specTrans');
  const lobes: LobeWgsl[] = [
    { kind: 'conductor', weight: 'mx_metal', color: baseColor, roughness: rough, anisotropy: aniso, active: mayWeigh(c, 'metallic', 0) },
    { kind: 'dielectric_transmission', weight: '((1.0 - mx_metal) * mx_trans)', color: baseColor, roughness: rough, ior, active: mayBeBelowOne(c, 'metallic') && mayWeigh(c, 'specTrans', 0) },
    { kind: 'dielectric_reflection', weight: '(mx_diel * mx_spec)', color: specColor, roughness: rough, ior, anisotropy: aniso, active: dielectric && mayWeigh(c, 'specular', 0.5) },
    { kind: 'burley_diffuse', weight: 'mx_diel', color: baseColor, roughness: rough, active: dielectric },
    { kind: 'subsurface', weight: '(mx_diel * mx_sss)', color: baseColor, active: dielectric && mayWeigh(c, 'subsurface', 0) },
  ];
  const out: FamilyWgsl = { locals, lobes, opacity: familyOpacity('disney_principled', c).expr, transmission: presentWeighted(c, 'specTrans'), dispersion: false };
  if (presentWeighted(c, 'sheen')) out.sheen = { weight: clampExpr(c.s('sheen', 0)), color: `mix(vec3f(1.0), ${baseColor}, ${clampExpr(c.s('sheenTint', 0.5))})`, roughness: '0.3' };
  if (presentWeighted(c, 'clearcoat')) out.coat = { weight: clampExpr(c.s('clearcoat', 0)), color: 'vec3f(1.0)', roughness: `(1.0 - ${clampExpr(c.s('clearcoatGloss', 1))})`, ior: '1.5' };
  return out;
}

function lowerFamily(family: SurfaceFamily, c: Ctx): FamilyWgsl {
  switch (family) {
    case 'simple_hair':
      return {
        locals: [
          `  let mx_hair_sigma = mix(mx_hair_absorption_color(${c.col('baseColor', [1, 1, 1])}, ${c.s('azimuthalRoughness', 0.1)}), mx_hair_absorption_melanin(${c.s('melaninConcentration', 0.5)}, ${c.s('melaninRedness', 0.5)}), ${clampExpr(c.s('melaninMix', 1))});`,
        ],
        lobes: [{
          kind: 'chiang_hair', weight: '1.0',
          color: c.col('tint_R', [1, 1, 1]),
          color90: c.col('tint_TT', [1, 1, 1]),
          hairTintTRT: c.col('tint_TRT', [1, 1, 1]),
          extinction: 'mx_hair_sigma',
          roughness: c.s('longitudinalRoughness', 0.1),
          anisotropy: c.s('azimuthalRoughness', 0.1),
          rotation: c.s('cuticleAngle', 0.5),
          ior: c.s('ior', 1.55),
        }],
        opacity: familyOpacity('simple_hair', c).expr,
        transmission: false,
      };
    case 'standard_surface':
      return standardSurface(c);
    case 'open_pbr_surface':
      return openPbrSurface(c);
    case 'gltf_pbr':
      return gltfPbr(c);
    case 'UsdPreviewSurface':
      return usdPreviewSurface(c);
    case 'disney_principled':
      return disneyPrincipled(c);
  }
}

function lobeAssign(index: number, lobe: LobeWgsl): string {
  const fields = [
    LOBE_KIND_CONST[lobe.kind],
    lobe.weight,
    lobe.color,
    lobe.color90 ?? lobe.color,
    lobe.roughness ?? '0.0',
    lobe.anisotropy ?? '0.0',
    lobe.rotation ?? '0.0',
    lobe.ior ?? '1.5',
    lobe.extinction ?? 'vec3f(0.0)',
    lobe.thin ?? '0.0',
    lobe.dispersion ?? '0.0',
    lobe.hairTintTRT ?? 'vec3f(1.0)',
  ];
  return `  c.lobes[${index}] = MxBsdfLobe(${fields.join(', ')});`;
}

/** The composable parts of one lowered surface: the renamable fill function plus
 *  the bindings/varyings metadata, WITHOUT the shared preludes or binding
 *  declarations. emitLayeredSurface wraps these into the raster module; the path
 *  tracer megakernel composes many under one dispatcher (T057g). */
interface SurfaceFnParts {
  fnName: string;
  fnCode: string;
  family: SurfaceFamily;
  preludes: string[];
  uniforms: WgslUniformField[];
  textures: WgslBinding[];
  samplers: WgslBinding[];
  primvarFields: Map<string, IrType>;
  extraInputs: Map<string, IrType>;
  usesLighting: boolean;
  features: SurfaceFeatures;
  lobeCount: number;
  opacity?: SurfaceOpacityFn;
}

/** Opacity-only evaluator emitted beside a variant's closure fill function. */
export interface SurfaceOpacityFn {
  fnName: string;
  /** `fn <name>(vary: MxVaryings) -> f32` returning the clamped coverage opacity. */
  fnCode: string;
  /** False when the body never reads `vary` (constant, parameter-only or proven opaque). */
  readsVaryings: boolean;
}

/** Lower a resolved surface to a single `fn <entryName>(vary) -> LayeredClosure`
 *  plus its binding metadata, shared by emitLayeredSurface (raster module) and
 *  emitSurfaceVariant (path tracer megakernel). */
function buildSurfaceFn(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  entryName: string,
  sink: DiagnosticSink,
  handlePrefix = '',
  computeStage = false,
  pruneInactiveLobes = false,
  opacityEntryName?: string,
): SurfaceFnParts {
  const builder = new IrModuleBuilder();
  const lowered = lowerSurfaceInputsToIr(graph, surface, builder, sink);

  const used = new Set<IrRef>();
  const ctx = makeCtx(surface, lowered.inputs, used);
  const fam = lowerFamily(surface.family, ctx);
  // Zero-weight lobes are skipped by every closure fn, so dropping them is neutral.
  const lobes = pruneInactiveLobes ? fam.lobes.filter((lobe) => lobe.active !== false) : [...fam.lobes];
  if (fam.sheen) lobes.push({ kind: 'sheen', ...fam.sheen });
  const normalName = surface.family === 'open_pbr_surface' ? 'geometry_normal' : 'normal';
  const normalSource = surface.inputs.get(normalName)?.source;
  const shadingNormal = surface.family !== 'UsdPreviewSurface'
    && (normalSource?.kind === 'connection' || normalSource?.kind === 'value')
    ? lowered.inputs.get(normalName) : undefined;
  if (shadingNormal !== undefined) used.add(shadingNormal);

  // Declare every referenced input ref as an output so lowerExprs emits its
  // sub-graph (topo order). The output name/type are irrelevant here.
  for (const ref of used) builder.output({ name: ref, type: FLOAT, ref });

  const ir = builder.build();
  const exprs = lowerExprs(ir, handlePrefix, computeStage);

  const assigns: string[] = [`  c.lobeCount = ${lobes.length}u;`];
  if (surface.family === 'simple_hair') assigns.push('  c.hasShadingTangent = 1u;', '  c.shadingTangent = vary.tangent;');
  if (shadingNormal !== undefined) assigns.push('  c.hasShadingNormal = 1u;', `  c.shadingNormal = ${shadingNormal};`);
  lobes.forEach((lobe, i) => assigns.push(lobeAssign(i, lobe)));
  if (fam.coat) assigns.push(`  c.hasCoat = 1u;`, `  c.coat = MxCoatLayer(${fam.coat.weight}, ${fam.coat.color}, ${fam.coat.roughness}, ${fam.coat.ior});`);
  if (fam.sheen) assigns.push(`  c.hasSheen = 1u;`, `  c.sheen = MxSheenLayer(${fam.sheen.weight}, ${fam.sheen.color}, ${fam.sheen.roughness});`);
  if (fam.fuzz) assigns.push(`  c.hasFuzz = 1u;`, `  c.fuzz = MxFuzzLayer(${fam.fuzz.weight}, ${fam.fuzz.color}, ${fam.fuzz.roughness});`);
  if (fam.thinFilm) assigns.push(`  c.hasThinFilm = 1u;`, `  c.thinFilm = MxThinFilmLayer(${fam.thinFilm.weight}, ${fam.thinFilm.thickness}, ${fam.thinFilm.ior});`);
  if (fam.emission) assigns.push(`  c.hasEmission = 1u;`, `  c.emission = ${fam.emission};`);
  assigns.push(`  c.opacity = ${fam.opacity};`);

  const fnCode = `fn ${entryName}(vary: MxVaryings) -> ${SURFACE_RETURN} {\n${exprs.body.join('\n')}\n${fam.locals.join('\n')}\n  var c: ${SURFACE_RETURN};\n${assigns.join('\n')}\n  return c;\n}`;
  const transmission = fam.transmission ?? lobes.some((lobe) => lobe.kind === 'dielectric_transmission');
  const features: SurfaceFeatures = {
    opaque: opaqueSurface(surface.family, ctx),
    fuzz: fam.fuzz !== undefined,
    coat: fam.coat !== undefined,
    transmission,
    dispersion: transmission && (fam.dispersion ?? lobes.some((lobe) => lobe.dispersion !== undefined)),
    thinFilm: fam.thinFilm !== undefined,
    lobeKinds: [...new Set(lobes.filter((lobe) => lobe.active !== false).map((lobe) => LOBE_KIND_NUM[lobe.kind]))],
  };

  const opacity = opacityEntryName === undefined
    ? undefined
    : buildOpacityFn(ir, surface, lowered.inputs, opacityEntryName, handlePrefix, computeStage, features.opaque === true);

  return {
    ...(opacity !== undefined ? { opacity } : {}),
    fnName: entryName,
    fnCode,
    family: surface.family,
    preludes: [...exprs.preludes],
    uniforms: exprs.uniforms,
    textures: exprs.textures,
    samplers: exprs.samplers,
    primvarFields: exprs.primvarFields,
    extraInputs: exprs.extraInputs,
    usesLighting: exprs.usesLighting,
    features,
    lobeCount: lobes.length,
  };
}

/** Emit `fn <entryName>(vary) -> f32` evaluating only the coverage opacity. It reuses
 *  the surface's lowered IR (same refs, texture handles and params as the closure
 *  fill function) but lowers just the sub-graphs reachable from the family opacity
 *  rule, so shadow/visibility rays never rebuild lobes or sample unrelated inputs. */
function buildOpacityFn(
  ir: ShaderIr,
  surface: ResolvedSurface,
  inputs: ReadonlyMap<string, IrRef>,
  entryName: string,
  handlePrefix: string,
  computeStage: boolean,
  provenOpaque: boolean,
): SurfaceOpacityFn {
  const lines: string[] = [];
  let expr = '1.0';
  // A statically proven opaque surface clamps to 1 for every input value.
  if (!provenOpaque) {
    const used = new Set<IrRef>();
    const opacity = familyOpacity(surface.family, makeCtx(surface, inputs, used));
    const exprs = lowerExprs({ ...ir, outputs: [...used].map((ref) => ({ name: ref, type: FLOAT, ref })) }, handlePrefix, computeStage);
    lines.push(...exprs.body, ...opacity.locals);
    expr = opacity.expr;
  }
  lines.push(`  return clamp(${expr}, 0.0, 1.0);`);
  const fnCode = `fn ${entryName}(vary: MxVaryings) -> f32 {\n${lines.join('\n')}\n}`;
  return { fnName: entryName, fnCode, readsVaryings: /\bvary\./.test(fnCode) };
}

/**
 * Emit the WGSL layered-surface module for a resolved surface (T055a/T055b/T055c).
 * Returns the module source plus its uniform/texture/sampler bindings. The entry
 * function `mx_surface_layered(vary) -> LayeredClosure` assigns every struct field
 * from the lowered input expressions.
 */
export function emitLayeredSurface(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  sink: DiagnosticSink = defaultDiagnosticSink,
): LayeredSurfaceModule {
  const fn = buildSurfaceFn(graph, surface, SURFACE_ENTRY, sink, '', false, true);

  const parts: string[] = [];
  parts.push(fn.preludes.join('\n'));
  // Mobile drivers reserve per-thread stack for the by-value lobe array (~27 MB per lobe on Mali).
  parts.push(LAYERED_CLOSURE_PRELUDE.replace('const MX_MAX_LOBES: u32 = 8u;', `const MX_MAX_LOBES: u32 = ${Math.max(1, fn.lobeCount)}u;`));
  // T056h: emit the shared runtime closure library so the surface module is the
  // single source both backends call. It references LayeredClosure, so it must
  // follow LAYERED_CLOSURE_PRELUDE. Effective eval wiring lands in T057/T058.
  parts.push(closureLibraryPrelude({ kinds: new Set(fn.features.lobeKinds), thinFilm: fn.features.thinFilm }));
  if (fn.uniforms.length > 0) {
    parts.push(
      `struct MxUniforms {\n${fn.uniforms.map((u) => `  ${u.field}: ${u.wgslType},`).join('\n')}\n};\n@group(0) @binding(0) var<uniform> u: MxUniforms;`,
    );
  }
  for (const t of fn.textures) parts.push(`@group(${t.group}) @binding(${t.binding}) var ${t.handle}: texture_2d<f32>;`);
  for (const s of fn.samplers) parts.push(`@group(${s.group}) @binding(${s.binding}) var ${s.handle}: sampler;`);
  parts.push(emitVaryingsStruct(fn.primvarFields, fn.extraInputs));
  parts.push(fn.fnCode);

  return {
    code: parts.join('\n\n') + '\n',
    entryPoint: SURFACE_ENTRY,
    returnType: SURFACE_RETURN,
    family: fn.family,
    uniforms: fn.uniforms,
    textures: fn.textures,
    samplers: fn.samplers,
    primvarFields: fn.primvarFields,
    extraInputs: fn.extraInputs,
    ...(fn.usesLighting ? { lighting: { group: 0, binding: 1 } } : {}),
    features: fn.features,
  };
}

/** One surface compiled as a path tracer megakernel variant: the fill function is
 *  renamed `mx_surface_layered_<index>` so many materials coexist in a single
 *  kernel dispatching on material id (T057g). Preludes/bindings/varyings are
 *  merged by the dispatcher builder (pathtracing/material-variant.ts). */
export interface SurfaceVariantModule {
  index: number;
  family: SurfaceFamily;
  fnName: string;
  fnCode: string;
  preludes: string[];
  uniforms: WgslUniformField[];
  textures: WgslBinding[];
  samplers: WgslBinding[];
  primvarFields: Map<string, IrType>;
  extraInputs: Map<string, IrType>;
  /** Lobes assigned by fnCode (zero-weight lobes pruned). */
  lobeCount: number;
  features?: SurfaceFeatures;
  /** Opacity-only evaluator; absent for hand-built modules (dispatch then reads the full closure). */
  opacity?: SurfaceOpacityFn;
}

/** Lower a resolved surface to a megakernel variant keyed by its scene material
 *  index (T057g). Additive: no backend consumes it until T057i wires the
 *  dispatcher into compute.ts. */
export function emitSurfaceVariant(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  index: number,
  sink: DiagnosticSink = defaultDiagnosticSink,
): SurfaceVariantModule {
  const fn = buildSurfaceFn(graph, surface, `${SURFACE_ENTRY}_${index}`, sink, `m${index}_`, true, true, `${SURFACE_OPACITY_ENTRY}_${index}`);
  return {
    ...(fn.opacity !== undefined ? { opacity: fn.opacity } : {}),
    index,
    family: fn.family,
    fnName: fn.fnName,
    fnCode: fn.fnCode,
    preludes: fn.preludes,
    uniforms: fn.uniforms,
    textures: fn.textures,
    samplers: fn.samplers,
    primvarFields: fn.primvarFields,
    extraInputs: fn.extraInputs,
    lobeCount: fn.lobeCount,
    features: fn.features,
  };
}
