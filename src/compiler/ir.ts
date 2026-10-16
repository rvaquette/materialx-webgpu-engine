// Shader IR: a renderer-independent, typed intermediate representation built from
// the resolved MaterialX graph (graph.ts) and consumed by the optimizer (T012),
// feature extraction (T013) and the WGSL backend (T014). It models typed
// expressions, specialized constants, editable dynamic parameters, textures,
// samplers, primvars, and BSDF/EDF/VDF/BSSRDF closures with their compositions,
// and carries provenance, declared colorspaces and units (plan section 7.2).
//
// Expressions form a DAG keyed by id (IrRef) to allow common-subexpression
// sharing; nothing here generates code.

import type { Provenance, ResolvedNodeDefRef } from '../materialx/graph.ts';

export type Scalar = 'float' | 'int' | 'bool';
export type VectorSemantic = 'color' | 'vector' | 'point' | 'normal' | 'direction' | 'texcoord';
export type ClosureKind = 'bsdf' | 'edf' | 'vdf' | 'bssrdf';
export type ShaderKind = 'surface' | 'displacement' | 'volume' | 'light';

export type IrType =
  | { kind: 'scalar'; scalar: Scalar }
  | { kind: 'vector'; scalar: Scalar; size: 2 | 3 | 4; semantic?: VectorSemantic }
  | { kind: 'matrix'; size: 3 | 4 }
  | { kind: 'string' }
  | { kind: 'filename' }
  | { kind: 'closure'; closure: ClosureKind }
  | { kind: 'shader'; shader: ShaderKind };

export const FLOAT: IrType = { kind: 'scalar', scalar: 'float' };
export const INT: IrType = { kind: 'scalar', scalar: 'int' };
export const BOOL: IrType = { kind: 'scalar', scalar: 'bool' };

export function vector(size: 2 | 3 | 4, scalar: Scalar = 'float', semantic?: VectorSemantic): IrType {
  return semantic !== undefined ? { kind: 'vector', scalar, size, semantic } : { kind: 'vector', scalar, size };
}
export const COLOR3: IrType = vector(3, 'float', 'color');
export const COLOR4: IrType = vector(4, 'float', 'color');

export function matrix(size: 3 | 4): IrType {
  return { kind: 'matrix', size };
}
export function closureType(closure: ClosureKind): IrType {
  return { kind: 'closure', closure };
}
export function shaderType(shader: ShaderKind): IrType {
  return { kind: 'shader', shader };
}

export function isClosureType(type: IrType): boolean {
  return type.kind === 'closure' || type.kind === 'shader';
}

/** Canonical, stable string form used for equality and pipeline hashing. */
export function typeToString(type: IrType): string {
  switch (type.kind) {
    case 'scalar':
      return type.scalar;
    case 'vector':
      return `vec${type.size}<${type.scalar}${type.semantic ? `:${type.semantic}` : ''}>`;
    case 'matrix':
      return `mat${type.size}`;
    case 'string':
      return 'string';
    case 'filename':
      return 'filename';
    case 'closure':
      return `closure<${type.closure}>`;
    case 'shader':
      return `shader<${type.shader}>`;
  }
}

export function typesEqual(a: IrType, b: IrType): boolean {
  return typeToString(a) === typeToString(b);
}

const MATERIALX_TYPES: Readonly<Record<string, IrType>> = {
  float: FLOAT,
  integer: INT,
  boolean: BOOL,
  color3: COLOR3,
  color4: COLOR4,
  vector2: vector(2, 'float', 'vector'),
  vector3: vector(3, 'float', 'vector'),
  vector4: vector(4, 'float', 'vector'),
  matrix33: matrix(3),
  matrix44: matrix(4),
  string: { kind: 'string' },
  filename: { kind: 'filename' },
  BSDF: closureType('bsdf'),
  EDF: closureType('edf'),
  VDF: closureType('vdf'),
  surfaceshader: shaderType('surface'),
  displacementshader: shaderType('displacement'),
  volumeshader: shaderType('volume'),
  lightshader: shaderType('light'),
};

/** Map a MaterialX value-type name to an IR type, if known. */
export function irTypeFromMaterialX(name: string): IrType | undefined {
  return MATERIALX_TYPES[name];
}

export type IrRef = string;

export interface IrMeta {
  provenance?: Provenance;
  /** Declared colorspace, carried from MaterialX; never inferred. */
  colorSpace?: string;
  unit?: string;
  unitType?: string;
}

export type IrConstValue = number | boolean | readonly number[] | string;

export type IrExpr =
  | { kind: 'const'; type: IrType; value: IrConstValue; meta?: IrMeta }
  | { kind: 'param'; type: IrType; name: string; meta?: IrMeta }
  | { kind: 'input'; type: IrType; name: string; meta?: IrMeta }
  | { kind: 'primvar'; type: IrType; name: string; space?: string; meta?: IrMeta }
  | { kind: 'convert'; type: IrType; source: IrRef; from: IrType; meta?: IrMeta }
  | { kind: 'swizzle'; type: IrType; source: IrRef; pattern: string; meta?: IrMeta }
  | {
      kind: 'texture';
      type: IrType;
      texture: string;
      uv: IrRef;
      sampler: string;
      lod?: IrRef;
      bias?: IrRef;
      gradient?: { ddx: IrRef; ddy: IrRef };
      meta?: IrMeta;
    }
  | { kind: 'call'; type: IrType; op: string; args: IrRef[]; nodeDef?: ResolvedNodeDefRef; meta?: IrMeta }
  | { kind: 'closure'; type: IrType; closure: ClosureKind; op: string; params: Record<string, IrRef>; meta?: IrMeta }
  | {
      kind: 'combine';
      type: IrType;
      op: 'add' | 'mix' | 'multiply' | 'layer';
      operands: IrRef[];
      weight?: IrRef;
      meta?: IrMeta;
    };

export interface TextureResource {
  name: string;
  valueType: IrType;
  /** Declared colorspace; never inferred (REQ-011/013). */
  colorSpace?: string;
  fileRef?: string;
}

export interface SamplerResource {
  name: string;
  addressU?: string;
  addressV?: string;
  filter?: string;
}

export interface ParamResource {
  name: string;
  type: IrType;
  defaultValue?: IrConstValue;
  /** Editable parameters are uniform-backed and must not trigger recompilation. */
  editable: true;
}

export interface PrimvarResource {
  name: string;
  type: IrType;
  space?: string;
}

export interface EvaluationRequirements {
  /** Screen-space derivatives (ddx/ddy). */
  needsDerivatives: boolean;
  /** Texture footprint for filtered/LOD sampling. */
  needsTextureFootprint: boolean;
  /** PDF evaluation (path tracer). */
  needsPdf: boolean;
  /** Importance sampling of closures (path tracer). */
  needsSampling: boolean;
}

export interface IrOutput {
  name: string;
  type: IrType;
  ref: IrRef;
  provenance?: Provenance;
}

export interface ShaderIr {
  exprs: ReadonlyMap<IrRef, IrExpr>;
  outputs: readonly IrOutput[];
  textures: readonly TextureResource[];
  samplers: readonly SamplerResource[];
  params: readonly ParamResource[];
  primvars: readonly PrimvarResource[];
  requirements: EvaluationRequirements;
}

function constKey(type: IrType, value: IrConstValue): string {
  const v = Array.isArray(value) ? `[${value.join(',')}]` : String(value);
  return `${typeToString(type)}=${v}`;
}

/** Incrementally builds a ShaderIr, deduplicating constants and resources. */
export class IrModuleBuilder {
  private counter = 0;
  private readonly exprs = new Map<IrRef, IrExpr>();
  private readonly constRefs = new Map<string, IrRef>();
  private readonly textures = new Map<string, TextureResource>();
  private readonly samplers = new Map<string, SamplerResource>();
  private readonly params = new Map<string, ParamResource>();
  private readonly primvars = new Map<string, PrimvarResource>();
  private readonly outputs: IrOutput[] = [];
  private readonly requirements: EvaluationRequirements = {
    needsDerivatives: false,
    needsTextureFootprint: false,
    needsPdf: false,
    needsSampling: false,
  };

  add(expr: IrExpr): IrRef {
    const id = `e${this.counter++}`;
    this.exprs.set(id, expr);
    return id;
  }

  /** Add (or reuse) a specialized constant. */
  constant(type: IrType, value: IrConstValue, meta?: IrMeta): IrRef {
    const key = constKey(type, value);
    const existing = this.constRefs.get(key);
    if (existing) return existing;
    const id = this.add(meta ? { kind: 'const', type, value, meta } : { kind: 'const', type, value });
    this.constRefs.set(key, id);
    return id;
  }

  declareTexture(resource: TextureResource): void {
    this.textures.set(resource.name, resource);
  }
  declareSampler(resource: SamplerResource): void {
    this.samplers.set(resource.name, resource);
  }
  declareParam(resource: ParamResource): void {
    this.params.set(resource.name, resource);
  }
  declarePrimvar(resource: PrimvarResource): void {
    this.primvars.set(resource.name, resource);
  }

  require(partial: Partial<EvaluationRequirements>): void {
    if (partial.needsDerivatives) this.requirements.needsDerivatives = true;
    if (partial.needsTextureFootprint) this.requirements.needsTextureFootprint = true;
    if (partial.needsPdf) this.requirements.needsPdf = true;
    if (partial.needsSampling) this.requirements.needsSampling = true;
  }

  output(output: IrOutput): void {
    this.outputs.push(output);
  }

  get(ref: IrRef): IrExpr | undefined {
    return this.exprs.get(ref);
  }

  build(): ShaderIr {
    return {
      exprs: new Map(this.exprs),
      outputs: [...this.outputs],
      textures: [...this.textures.values()],
      samplers: [...this.samplers.values()],
      params: [...this.params.values()],
      primvars: [...this.primvars.values()],
      requirements: { ...this.requirements },
    };
  }
}

// ---------------------------------------------------------------------------
// Runtime layered-closure model (plan section 9.6, phase P10 / T054).
//
// LayeredClosure is the lowering TARGET of a surface nodegraph: the flattened,
// renderer-independent description a surface evaluates to after the IR has
// resolved its constant, textured AND procedural inputs. It is the single
// shading contract both backends consume -- the path tracer samples it
// (src/render/pathtracing/bsdf.ts) and the raster/CPU oracle evaluates it under
// direct lighting (src/render/bsdf/reference.ts) -- so the same material renders
// identically in both. The lowering that produces it from a nodegraph lands in
// T055; the shared WGSL library that evaluates it on device lands in T056. Here
// we only define the data contract and the canonical bridge used until the full
// lowering exists.
//
// A surface is a weighted STACK of BSDF lobes plus optional layer slots (coat,
// sheen, fuzz, thin film) and an emission term. Each lobe carries the numeric
// parameters its model needs; absent slots contribute nothing, so a closure with
// only base lobes reduces exactly to the current seven-parameter surface.

/** Linear RGB triple used by the layered-closure parameters. */
export type Rgb = readonly [number, number, number];

/** BSDF lobe families covered by the MaterialX surface nodedefs. */
export type BsdfLobeKind =
  | 'oren_nayar_diffuse'
  | 'burley_diffuse'
  | 'translucent'
  | 'dielectric_reflection'
  | 'dielectric_transmission'
  | 'conductor'
  | 'generalized_schlick'
  | 'sheen'
  | 'subsurface';

/** One weighted BSDF lobe in the surface stack. */
export interface LayeredBsdfLobe {
  kind: BsdfLobeKind;
  /** Selection / composition weight; the stack need not sum to one. */
  weight: number;
  /** Base reflectance / tint (F0 for conductor and generalized-schlick color0). */
  color: Rgb;
  /** Grazing reflectance (generalized-schlick color90); defaults to color. */
  color90?: Rgb;
  /** Perceptual roughness in [0,1]; microfacet alpha = roughness^2. */
  roughness?: number;
  /** Anisotropy in [0,1] (GGX alpha_u/alpha_v split); 0 = isotropic. */
  anisotropy?: number;
  /** Tangent-frame rotation in turns [0,1) for the anisotropic lobe. */
  rotation?: number;
  /** Index of refraction for the dielectric reflection/transmission lobe. */
  ior?: number;
  /** Conductor extinction coefficient k (per channel). */
  extinction?: Rgb;
  /** Thin-walled transmission: straight-through, no refraction bending. */
  thinWalled?: boolean;
}

/** Dielectric coat layered over the base stack (clearcoat). */
export interface CoatLayer {
  weight: number;
  color: Rgb;
  roughness: number;
  ior: number;
}

/** Charlie-sheen retro-reflective layer over the base stack. */
export interface SheenLayer {
  weight: number;
  color: Rgb;
  roughness: number;
}

/** Microfiber fuzz layer (open_pbr fuzz), modelled like sheen with its own tint. */
export interface FuzzLayer {
  weight: number;
  color: Rgb;
  roughness: number;
}

/** Thin-film interference layer modulating the specular Fresnel. */
export interface ThinFilmLayer {
  weight: number;
  /** Film thickness in nanometres. */
  thickness: number;
  /** Film index of refraction. */
  ior: number;
}

/** A surface lowered to its runtime closure stack. */
export interface LayeredClosure {
  lobes: readonly LayeredBsdfLobe[];
  coat?: CoatLayer;
  sheen?: SheenLayer;
  fuzz?: FuzzLayer;
  thinFilm?: ThinFilmLayer;
  /** Uniform emitted radiance (EDF); omitted when the surface does not emit. */
  emission?: Rgb;
  /** Surface opacity carried as the closure weight (mx_surface). */
  opacity: number;
}

/** An empty, fully transparent closure (no lobes, no layers). */
export function emptyLayeredClosure(): LayeredClosure {
  return { lobes: [], opacity: 1 };
}

/**
 * The canonical seven-parameter surface shared by every PBR family today
 * (baseColor, metalness, roughness, transmission, subsurface, ior, specular).
 * This is the bridge the renderers use until the full nodegraph lowering (T055)
 * produces LayeredClosure directly; it exists so T057/T058 can route both
 * backends through the layered model without yet depending on the lowering.
 */
export interface CanonicalSurfaceInputs {
  readonly baseColor: Rgb;
  readonly metalness: number;
  readonly roughness: number;
  readonly transmission: number;
  readonly subsurface: number;
  readonly ior: number;
  readonly specular: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Lower the canonical seven parameters to the equivalent LayeredClosure. The
 * weights reproduce exactly the current path-tracer stack (metal conductor +
 * dielectric transmission + dielectric specular over a diffuse base, with
 * subsurface folded into the diffuse base), so sampling or evaluating the
 * resulting closure matches the pre-P10 surface -- the non-regression anchor for
 * T054. Coat, sheen, fuzz and thin film stay absent here; families that use them
 * populate those slots once the lowering lands.
 */
export function canonicalSurfaceToLayered(p: CanonicalSurfaceInputs): LayeredClosure {
  const metal = clamp01(p.metalness);
  const trans = clamp01(p.transmission);
  const spec = clamp01(p.specular);
  const dielectricShare = (1 - metal) * (1 - trans);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: p.baseColor, roughness: p.roughness },
    { kind: 'dielectric_transmission', weight: (1 - metal) * trans, color: p.baseColor, roughness: p.roughness, ior: p.ior },
    { kind: 'dielectric_reflection', weight: dielectricShare * spec, color: [1, 1, 1], roughness: p.roughness, ior: p.ior },
    { kind: 'burley_diffuse', weight: dielectricShare, color: p.baseColor, roughness: p.roughness },
  ];
  return { lobes: lobes.filter((l) => l.weight > 0), opacity: 1 };
}
