// T057g: build the path tracer megakernel's material dispatcher. Each scene
// material backed by a resolved surface graph is lowered to a renamed fill
// function `mx_surface_layered_<materialIndex>` (emitSurfaceVariant, surface-
// wgsl.ts); this module assembles them under a single
// `mx_eval_material(matId, vary) -> LayeredClosure` that switches on the material
// id and falls back to the packed constant record (mx_material_closure, T057b)
// for materials without a graph. Preludes, texture/sampler bindings and the
// MxVaryings fields are merged across variants so the megakernel can declare each
// once. Texture/sampler handles are namespaced per material (emitSurfaceVariant
// prefixes them `m<index>_`) so distinct materials never collide; sharing one GPU
// texture across materials that reference the same file is a later optimization
// (T057j). Additive and pure-string (Node-testable): compute.ts wires it in T057i.
// A parallel `mx_eval_material_opacity(matId, vary) -> f32` switch calls each
// variant's dependency-pruned opacity-only function (emitSurfaceVariant) and the
// packed record's opacity slot, so alpha visibility rays never rebuild lobes.

import type { ResolvedGraph } from '../../materialx/graph.ts';
import type { ResolvedSurface } from '../../materialx/surface-graph.ts';
import { emitSurfaceVariant, type SurfaceVariantModule } from '../../compiler/surface-wgsl.ts';
import type { IrType } from '../../compiler/ir.ts';
import type { WgslBinding, WgslUniformField } from '../../compiler/wgsl.ts';
import { buildTextureRegistry, type PtTextureRegistry } from './texture-registry.ts';

/** Dispatcher entry assembled into the megakernel. */
export const PT_MATERIAL_DISPATCH_ENTRY = 'mx_eval_material';
/** Constant-record fallback the dispatcher calls for materials without a graph. */
const PT_MATERIAL_FALLBACK = 'mx_material_closure';
/** Opacity-only dispatcher used by alpha visibility rays. */
export const PT_MATERIAL_OPACITY_ENTRY = 'mx_eval_material_opacity';
/** Present only when some variant's opacity reads MxVaryings; record/constant cases do not. */
export const PT_MATERIAL_OPACITY_VARYINGS = 'mx_material_opacity_reads_varyings';
/** Packed-record opacity reader (material-record.ts, slot 1). */
const PT_MATERIAL_OPACITY_FALLBACK = 'mx_material_opacity';

/** One scene material to lower as a megakernel variant, keyed by its index in the
 *  packed materials buffer (the same id the megakernel dispatches on). */
export interface PtVariantSource {
  materialIndex: number;
  graph: ResolvedGraph;
  surface: ResolvedSurface;
}

/** The assembled dispatcher plus the merged declarations the megakernel emits
 *  once around it. */
export interface PtMaterialDispatch {
  /** Lowered variants, sorted by material index. */
  variants: SurfaceVariantModule[];
  /** Per-variant fill functions followed by the mx_eval_material switch. */
  dispatcherWgsl: string;
  /** Per-variant opacity-only functions followed by the mx_eval_material_opacity
   *  switch (and PT_MATERIAL_OPACITY_VARYINGS when opacityReadsVaryings). */
  opacityDispatcherWgsl: string;
  /** True when at least one variant's opacity depends on hit varyings. */
  opacityReadsVaryings: boolean;
  /** Node helper preludes required by the variants (deduplicated). */
  preludes: string[];
  /** Texture bindings across all variants, renumbered to a global binding layout. */
  textures: WgslBinding[];
  /** Sampler bindings across all variants, renumbered to a global binding layout. */
  samplers: WgslBinding[];
  /** Deduplicated texture registry (shared images across materials, T057j). */
  textureRegistry: PtTextureRegistry;
  /** Uniform fields across all variants, deduplicated by field name. */
  uniforms: WgslUniformField[];
  /** MxVaryings primvar fields merged across variants. */
  primvarFields: Map<string, IrType>;
  /** MxVaryings extra input fields merged across variants. */
  extraInputs: Map<string, IrType>;
}

function dedupUniforms(items: readonly WgslUniformField[]): WgslUniformField[] {
  const seen = new Map<string, WgslUniformField>();
  for (const u of items) if (!seen.has(u.field)) seen.set(u.field, u);
  return [...seen.values()];
}

function mergeMaps(maps: readonly Map<string, IrType>[]): Map<string, IrType> {
  const out = new Map<string, IrType>();
  for (const m of maps) for (const [k, v] of m) if (!out.has(k)) out.set(k, v);
  return out;
}

/** Lower every graph-backed material to a variant and assemble the dispatcher. */
export function buildMaterialDispatch(sources: readonly PtVariantSource[]): PtMaterialDispatch {
  const variants = [...sources]
    .sort((a, b) => a.materialIndex - b.materialIndex)
    .map((s) => emitSurfaceVariant(s.graph, s.surface, s.materialIndex));

  const preludes = [...new Set(variants.flatMap((v) => v.preludes))];
  const textureRegistry = buildTextureRegistry(variants);
  const textures = textureRegistry.textures;
  const samplers = textureRegistry.samplers;
  const uniforms = dedupUniforms(variants.flatMap((v) => v.uniforms));
  const primvarFields = mergeMaps(variants.map((v) => v.primvarFields));
  const extraInputs = mergeMaps(variants.map((v) => v.extraInputs));

  const shared = new Map<string, SurfaceVariantModule>();
  const functionFor = new Map<number, string>();
  const unique = new Map<string, SurfaceVariantModule>();
  for (const variant of variants) {
    const constant = variant.uniforms.length === 0 && variant.textures.length === 0 && variant.samplers.length === 0;
    const key = variant.fnCode.replace(`fn ${variant.fnName}(`, 'fn surface(');
    const previous = constant ? shared.get(key) : undefined;
    functionFor.set(variant.index, previous?.fnName ?? variant.fnName);
    if (!previous) {
      unique.set(variant.fnName, variant);
      if (constant) shared.set(key, variant);
    }
  }
  const switchBody = [
    ...variants.map((v) => `    case ${v.index}u: { return ${functionFor.get(v.index)}(vary); }`),
    `    default: { return ${PT_MATERIAL_FALLBACK}(matId); }`,
  ].join('\n');
  const fns = [...unique.values()].map((v) => v.fnCode).join('\n\n');
  const dispatcherWgsl = `${fns ? fns + '\n\n' : ''}fn ${PT_MATERIAL_DISPATCH_ENTRY}(matId: u32, vary: MxVaryings) -> LayeredClosure {\n  switch matId {\n${switchBody}\n  }\n}`;
  const { opacityDispatcherWgsl, opacityReadsVaryings } = buildOpacityDispatch(variants, functionFor);

  return {
    variants, dispatcherWgsl, opacityDispatcherWgsl, opacityReadsVaryings,
    preludes, textures, samplers, textureRegistry, uniforms, primvarFields, extraInputs,
  };
}

/** Assemble the opacity-only dispatcher; `closureFor` names each variant's closure
 *  function (shared constant variants) for modules lacking an opacity evaluator. */
export function buildOpacityDispatch(
  variants: readonly SurfaceVariantModule[],
  closureFor: ReadonlyMap<number, string> = new Map(variants.map((v) => [v.index, v.fnName])),
): { opacityDispatcherWgsl: string; opacityReadsVaryings: boolean } {
  const shared = new Map<string, string>();
  const fns: string[] = [];
  const cases: string[] = [];
  const varying: number[] = [];
  for (const variant of variants) {
    const opacity = variant.opacity;
    if (opacity === undefined) {
      // Hand-built module without an opacity evaluator: read the full closure.
      cases.push(`    case ${variant.index}u: { return clamp(${closureFor.get(variant.index)}(vary).opacity, 0.0, 1.0); }`);
      varying.push(variant.index);
      continue;
    }
    const constant = variant.uniforms.length === 0 && variant.textures.length === 0 && variant.samplers.length === 0;
    const key = opacity.fnCode.replace(`fn ${opacity.fnName}(`, 'fn opacity(');
    let name = constant ? shared.get(key) : undefined;
    if (name === undefined) {
      name = opacity.fnName;
      fns.push(opacity.fnCode);
      if (constant) shared.set(key, name);
    }
    cases.push(`    case ${variant.index}u: { return ${name}(vary); }`);
    if (opacity.readsVaryings) varying.push(variant.index);
  }
  cases.push(`    default: { return clamp(${PT_MATERIAL_OPACITY_FALLBACK}(matId), 0.0, 1.0); }`);
  const parts = [...fns, `fn ${PT_MATERIAL_OPACITY_ENTRY}(matId: u32, vary: MxVaryings) -> f32 {\n  switch matId {\n${cases.join('\n')}\n  }\n}`];
  if (varying.length > 0) {
    parts.push(`fn ${PT_MATERIAL_OPACITY_VARYINGS}(matId: u32) -> bool {\n  switch matId {\n    case ${varying.map((i) => `${i}u`).join(', ')}: { return true; }\n    default: { return false; }\n  }\n}`);
  }
  return { opacityDispatcherWgsl: parts.join('\n\n'), opacityReadsVaryings: varying.length > 0 };
}
