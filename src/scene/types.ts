// Renderer-neutral scene model (plan section 8, T017). The USDA import adapter
// (usd/importer.ts) composes the text layers into this structure; MaterialX
// reference resolution (T018) and geometry/subdivision preparation (T019) consume
// and extend it. It intentionally preserves provenance and composition facts
// (specifier, inherits, references, payloads, binding strength, xform order,
// subdivision tags, primvars) rather than collapsing them, and never silently
// repairs asset paths.

export type PrimSpecifier = 'def' | 'over' | 'class';

export type AttributeValue = number | boolean | string | readonly number[] | readonly string[];

export interface StageInfo {
  defaultPrim?: string;
  upAxis?: string;
  metersPerUnit?: number;
  /** Resolved subLayer URIs in strength order (strongest first). */
  subLayers: readonly string[];
}

export interface PrimReference {
  /** Asset path from `@...@`; undefined for an internal reference. */
  assetPath?: string;
  /** Target prim path from `</...>`; undefined references the layer default prim. */
  primPath?: string;
  isMaterialX: boolean;
}

export interface PrimAttribute {
  name: string;
  typeName: string;
  value?: AttributeValue;
  interpolation?: string;
}

export interface PrimRelationship {
  name: string;
  targets: readonly string[];
}

export interface XformOp {
  /** The op suffix, e.g. 'xformOp:translate' or 'xformOp:translate:pivot'. */
  op: string;
  typeName: string;
  value?: AttributeValue;
  /** True for `!invert!` entries in xformOpOrder. */
  invert: boolean;
}

export type BindingStrength = 'weakerThanDescendants' | 'strongerThanDescendants';

export interface MaterialBinding {
  target: string;
  strength?: BindingStrength;
  purpose?: string;
}

export interface MaterialXReference {
  /** Path of the prim that carries the reference. */
  primPath: string;
  assetPath: string;
  /** Target MaterialX prim path, e.g. /MaterialX/Materials/floor. */
  referencedPrimPath: string;
  /** Resolved surfacematerial name (last path segment). */
  materialName: string;
}

export interface PrimvarInfo {
  name: string;
  typeName: string;
  interpolation?: string;
}

export interface MeshInfo {
  subdivisionScheme?: string;
  refinementLevel?: number;
  refinementEnableOverride?: boolean;
  primvars: readonly PrimvarInfo[];
}

export interface ScenePrim {
  path: string;
  name: string;
  specifier: PrimSpecifier;
  typeName?: string;
  kind?: string;
  apiSchemas: readonly string[];
  inherits: readonly string[];
  references: readonly PrimReference[];
  payloads: readonly PrimReference[];
  attributes: ReadonlyMap<string, PrimAttribute>;
  relationships: ReadonlyMap<string, PrimRelationship>;
  xformOps: readonly XformOp[];
  children: readonly string[];
  materialBinding?: MaterialBinding;
  mesh?: MeshInfo;
}

export interface SceneAsset {
  entry: string;
  stage: StageInfo;
  /** All composed prims by path; includes the pseudo-root at '/'. */
  prims: ReadonlyMap<string, ScenePrim>;
  /** Root-level prim paths in document order. */
  roots: readonly string[];
  /** Every resolved MaterialX material reference across the stage. */
  materials: readonly MaterialXReference[];
}
