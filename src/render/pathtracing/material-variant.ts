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

import type { ResolvedGraph } from '../../materialx/graph.ts';
import type { ResolvedSurface } from '../../materialx/surface-graph.ts';
import { emitSurfaceVariant, type SurfaceVariantModule } from '../../compiler/surface-wgsl.ts';
import type { IrType } from '../../compiler/ir.ts';
import type { WgslBinding, WgslUniformField } from '../../compiler/wgsl.ts';

/** Dispatcher entry assembled into the megakernel. */
export const PT_MATERIAL_DISPATCH_ENTRY = 'mx_eval_material';
/** Constant-record fallback the dispatcher calls for materials without a graph. */
const PT_MATERIAL_FALLBACK = 'mx_material_closure';

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
  /** Node helper preludes required by the variants (deduplicated). */
  preludes: string[];
  /** Texture bindings across all variants, renumbered to a global binding layout. */
  textures: WgslBinding[];
  /** Sampler bindings across all variants, renumbered to a global binding layout. */
  samplers: WgslBinding[];
  /** Uniform fields across all variants, deduplicated by field name. */
  uniforms: WgslUniformField[];
  /** MxVaryings primvar fields merged across variants. */
  primvarFields: Map<string, IrType>;
  /** MxVaryings extra input fields merged across variants. */
  extraInputs: Map<string, IrType>;
}

function dedupBindings(items: readonly WgslBinding[], group: number): WgslBinding[] {
  const seen = new Map<string, WgslBinding>();
  for (const b of items) if (!seen.has(b.handle)) seen.set(b.handle, b);
  return [...seen.values()].map((b, i) => ({ name: b.name, handle: b.handle, group, binding: i }));
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
  const textures = dedupBindings(variants.flatMap((v) => v.textures), 1);
  const samplers = dedupBindings(variants.flatMap((v) => v.samplers), 2);
  const uniforms = dedupUniforms(variants.flatMap((v) => v.uniforms));
  const primvarFields = mergeMaps(variants.map((v) => v.primvarFields));
  const extraInputs = mergeMaps(variants.map((v) => v.extraInputs));

  const switchBody = [
    ...variants.map((v) => `    case ${v.index}u: { return ${v.fnName}(vary); }`),
    `    default: { return ${PT_MATERIAL_FALLBACK}(matId); }`,
  ].join('\n');
  const fns = variants.map((v) => v.fnCode).join('\n\n');
  const dispatcherWgsl = `${fns ? fns + '\n\n' : ''}fn ${PT_MATERIAL_DISPATCH_ENTRY}(matId: u32, vary: MxVaryings) -> LayeredClosure {\n  switch matId {\n${switchBody}\n  }\n}`;

  return { variants, dispatcherWgsl, preludes, textures, samplers, uniforms, primvarFields, extraInputs };
}
