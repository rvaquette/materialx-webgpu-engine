// Material instances (plan section 7.5, T016). An instance references a shared,
// compiled material variant (its pipeline key plus uniform/texture/sampler
// layout) and owns the editable parameter values and resource bindings. Editing
// a parameter (a color, a radius) or swapping an interchangeable texture only
// marks data dirty for re-upload; it never changes the pipeline key, so the
// shared shader is never recompiled.

import type { WgslModule } from '../compiler/wgsl.ts';

export class MaterialInstanceError extends Error {
  override readonly name = 'MaterialInstanceError';
}

export type ParamValue = number | boolean | readonly number[];

type BaseType = 'f32' | 'i32' | 'u32';
type FieldKind = 'scalar' | 'vec' | 'mat';

export interface UniformFieldLayout {
  name: string;
  wgslType: string;
  offset: number;
  size: number;
  align: number;
  base: BaseType;
  kind: FieldKind;
  /** Number of scalar components the value must supply (vec3 -> 3, mat3 -> 9). */
  components: number;
  cols?: number;
  rows?: number;
}

export interface UniformBufferLayout {
  fields: UniformFieldLayout[];
  byteLength: number;
}

const WGSL_SCALARS: Readonly<Record<string, BaseType>> = { f: 'f32', i: 'i32', u: 'u32' };

function parseField(name: string, wgslType: string): Omit<UniformFieldLayout, 'offset'> {
  if (wgslType === 'f32' || wgslType === 'i32' || wgslType === 'u32') {
    return { name, wgslType, size: 4, align: 4, base: wgslType, kind: 'scalar', components: 1 };
  }
  const vec = /^vec([234])([fiu])$/.exec(wgslType);
  if (vec) {
    const n = Number(vec[1]) as 2 | 3 | 4;
    const base = WGSL_SCALARS[vec[2]!]!;
    const size = n === 3 ? 12 : n * 4;
    const align = n === 2 ? 8 : 16;
    return { name, wgslType, size, align, base, kind: 'vec', components: n };
  }
  const mat = /^mat([34])x([34])f$/.exec(wgslType);
  if (mat) {
    const cols = Number(mat[1]);
    const rows = Number(mat[2]);
    return { name, wgslType, size: cols * 16, align: 16, base: 'f32', kind: 'mat', components: cols * rows, cols, rows };
  }
  throw new MaterialInstanceError(`unsupported uniform type '${wgslType}' for field '${name}'`);
}

function roundUp(value: number, align: number): number {
  return Math.ceil(value / align) * align;
}

/** Compute a WGSL-uniform-address-space layout (std140-like alignment). */
export function computeUniformLayout(fields: readonly { name: string; wgslType: string }[]): UniformBufferLayout {
  const out: UniformFieldLayout[] = [];
  let cursor = 0;
  for (const f of fields) {
    const parsed = parseField(f.name, f.wgslType);
    const offset = roundUp(cursor, parsed.align);
    out.push({ ...parsed, offset });
    cursor = offset + parsed.size;
  }
  return { fields: out, byteLength: fields.length > 0 ? roundUp(cursor, 16) : 0 };
}

export interface MaterialVariant {
  pipelineKey: string;
  uniforms: UniformBufferLayout;
  textures: readonly string[];
  samplers: readonly string[];
}

/** Build a material variant from a compiled WGSL module and its pipeline key. */
export function createMaterialVariant(module: WgslModule, pipelineKey: string): MaterialVariant {
  return {
    pipelineKey,
    uniforms: computeUniformLayout(module.uniforms.map((u) => ({ name: u.name, wgslType: u.wgslType }))),
    textures: module.textures.map((t) => t.name),
    samplers: module.samplers.map((s) => s.name),
  };
}

function toComponents(value: ParamValue): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'boolean') return [value ? 1 : 0];
  return [...value];
}

function writeScalar(view: DataView, base: BaseType, offset: number, n: number): void {
  if (base === 'f32') view.setFloat32(offset, n, true);
  else if (base === 'i32') view.setInt32(offset, Math.trunc(n), true);
  else view.setUint32(offset, Math.trunc(n) >>> 0, true);
}

function writeField(view: DataView, field: UniformFieldLayout, value: ParamValue): void {
  const comps = toComponents(value);
  if (comps.length !== field.components) {
    throw new MaterialInstanceError(`field '${field.name}' expects ${field.components} component(s), got ${comps.length}`);
  }
  if (field.kind === 'mat') {
    const cols = field.cols!;
    const rows = field.rows!;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) writeScalar(view, field.base, field.offset + c * 16 + r * 4, comps[c * rows + r]!);
    }
    return;
  }
  for (let i = 0; i < comps.length; i++) writeScalar(view, field.base, field.offset + i * 4, comps[i]!);
}

export interface MaterialInstanceOptions {
  defaults?: Record<string, ParamValue>;
}

export class MaterialInstance {
  readonly pipelineKey: string;
  private readonly variant: MaterialVariant;
  private readonly fieldByName: Map<string, UniformFieldLayout>;
  private readonly values = new Map<string, ParamValue>();
  private readonly textureBindings = new Map<string, string>();
  private readonly samplerBindings = new Map<string, string>();
  private uniformsDirtyFlag = true;
  private bindingsDirtyFlag = false;

  constructor(variant: MaterialVariant, options: MaterialInstanceOptions = {}) {
    this.variant = variant;
    this.pipelineKey = variant.pipelineKey;
    this.fieldByName = new Map(variant.uniforms.fields.map((f) => [f.name, f]));
    for (const [name, value] of Object.entries(options.defaults ?? {})) this.setParam(name, value);
  }

  get uniformsDirty(): boolean {
    return this.uniformsDirtyFlag;
  }
  get bindingsDirty(): boolean {
    return this.bindingsDirtyFlag;
  }

  /** Update an editable parameter. Marks uniforms dirty; never recompiles. */
  setParam(name: string, value: ParamValue): void {
    if (!this.fieldByName.has(name)) throw new MaterialInstanceError(`unknown parameter '${name}'`);
    this.values.set(name, value);
    this.uniformsDirtyFlag = true;
  }
  getParam(name: string): ParamValue | undefined {
    return this.values.get(name);
  }

  /** Bind (or rebind) a texture. Interchangeable identities do not recompile. */
  setTexture(name: string, textureId: string): void {
    if (!this.variant.textures.includes(name)) throw new MaterialInstanceError(`unknown texture '${name}'`);
    this.textureBindings.set(name, textureId);
    this.bindingsDirtyFlag = true;
  }
  setSampler(name: string, samplerId: string): void {
    if (!this.variant.samplers.includes(name)) throw new MaterialInstanceError(`unknown sampler '${name}'`);
    this.samplerBindings.set(name, samplerId);
    this.bindingsDirtyFlag = true;
  }

  /** Pack the current parameter values into a uniform buffer per the variant layout. */
  packUniforms(): ArrayBuffer {
    const buffer = new ArrayBuffer(this.variant.uniforms.byteLength);
    const view = new DataView(buffer);
    for (const field of this.variant.uniforms.fields) {
      const value = this.values.get(field.name);
      if (value !== undefined) writeField(view, field, value);
    }
    return buffer;
  }

  /** Returns packed uniforms only when dirty, then clears the flag (for re-upload). */
  takeDirtyUniforms(): ArrayBuffer | undefined {
    if (!this.uniformsDirtyFlag) return undefined;
    this.uniformsDirtyFlag = false;
    return this.packUniforms();
  }

  /** Returns the current bindings only when dirty, then clears the flag. */
  takeDirtyBindings(): { textures: Record<string, string>; samplers: Record<string, string> } | undefined {
    if (!this.bindingsDirtyFlag) return undefined;
    this.bindingsDirtyFlag = false;
    return {
      textures: Object.fromEntries(this.textureBindings),
      samplers: Object.fromEntries(this.samplerBindings),
    };
  }
}
