// USD material linking (plan section 8, T018). Two responsibilities bridge the
// composed SceneAsset (T017) to the MaterialX graph resolver (T011):
//   1. Resolve effective material bindings across the prim tree, honouring
//      inheritance and `bindMaterialAs` strength (weaker/strongerThanDescendants).
//   2. Link each binding to its MaterialX reference (the `.mtlx` asset +
//      surfacematerial name) and dedup the unique materials to compile; then
//      turn a loaded MaterialX material into GraphRoots for resolveGraph.
// No asset path is repaired silently; unbound gprims are reported (REQ-013).

import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import type { GraphRoot, MxNode, MxVector } from '../materialx/graph.ts';
import type { MxElement } from '../materialx/wasm.ts';
import type {
  BindingStrength,
  MaterialBinding,
  MaterialXReference,
  SceneAsset,
  ScenePrim,
} from '../scene/types.ts';
import { isMeshPrim } from '../scene/types.ts';

export interface ResolvedBinding {
  /** Renderable prim (gprim) the material applies to. */
  primPath: string;
  /** Target material prim path, e.g. /World/Looks/floor. */
  materialPath: string;
  strength: BindingStrength;
  /** The MaterialX reference backing the material prim, when present. */
  materialX?: MaterialXReference;
}

export interface MaterialCompileUnit {
  assetPath: string;
  referencedPrimPath: string;
  materialName: string;
  /** Gprim paths that bind this material. */
  boundPrims: readonly string[];
}

export interface SceneMaterials {
  /** Effective binding by gprim path. */
  bindings: ReadonlyMap<string, ResolvedBinding>;
  /** Unique MaterialX materials to compile, deduped across the stage. */
  units: readonly MaterialCompileUnit[];
  /** Gprims with no effective material binding. */
  unbound: readonly string[];
}

export interface ResolveSceneMaterialsOptions {
  sink?: DiagnosticSink;
  /** Decides which prims require a material; defaults to meshes. */
  isRenderable?: (prim: ScenePrim) => boolean;
}

function defaultIsRenderable(prim: ScenePrim): boolean {
  return isMeshPrim(prim);
}

const DEFAULT_STRENGTH: BindingStrength = 'weakerThanDescendants';

export function resolveSceneMaterials(
  scene: SceneAsset,
  options: ResolveSceneMaterialsOptions = {},
): SceneMaterials {
  const emit: (d: Diagnostic) => void = options.sink ?? (() => undefined);
  const isRenderable = options.isRenderable ?? defaultIsRenderable;

  const materialByPath = new Map<string, MaterialXReference>();
  for (const m of scene.materials) materialByPath.set(m.primPath, m);

  const bindings = new Map<string, ResolvedBinding>();
  const unbound: string[] = [];
  const unitByKey = new Map<string, { unit: MaterialCompileUnit; prims: string[] }>();

  const addToUnit = (ref: MaterialXReference, primPath: string): void => {
    const key = `${ref.assetPath}::${ref.referencedPrimPath}`;
    let entry = unitByKey.get(key);
    if (!entry) {
      const prims: string[] = [];
      entry = {
        unit: {
          assetPath: ref.assetPath,
          referencedPrimPath: ref.referencedPrimPath,
          materialName: ref.materialName,
          boundPrims: prims,
        },
        prims,
      };
      unitByKey.set(key, entry);
    }
    if (!entry.prims.includes(primPath)) entry.prims.push(primPath);
  };

  const visit = (
    path: string,
    inheritedStrong: MaterialBinding | undefined,
    inheritedWeak: MaterialBinding | undefined,
  ): void => {
    const prim = scene.prims.get(path);
    if (!prim) return;

    const local = prim.materialBinding;
    const localStrong = local && local.strength === 'strongerThanDescendants' ? local : undefined;
    // Ancestor strongerThanDescendants dominates; otherwise the nearest binding.
    const effective = inheritedStrong ?? local ?? inheritedWeak;
    const childStrong = inheritedStrong ?? localStrong;
    const childWeak = local && local.strength !== 'strongerThanDescendants' ? local : inheritedWeak;

    if (isRenderable(prim)) {
      if (effective) {
        const strength: BindingStrength = effective.strength ?? DEFAULT_STRENGTH;
        const mtlx = materialByPath.get(effective.target);
        bindings.set(path, {
          primPath: path,
          materialPath: effective.target,
          strength,
          ...(mtlx !== undefined ? { materialX: mtlx } : {}),
        });
        if (mtlx) addToUnit(mtlx, path);
        else {
          emit({
            level: 'info',
            message: `Bound material has no MaterialX reference: ${effective.target}`,
            detail: { prim: path },
          });
        }
      } else {
        unbound.push(path);
        emit({ level: 'info', message: `Gprim has no material binding: ${path}` });
      }
    }

    for (const child of prim.children) visit(child, childStrong, childWeak);
  };

  for (const root of scene.roots) visit(root, undefined, undefined);

  const units = [...unitByKey.values()]
    .map((e) => e.unit)
    .sort((a, b) =>
      `${a.assetPath}::${a.referencedPrimPath}`.localeCompare(`${b.assetPath}::${b.referencedPrimPath}`),
    );

  return { bindings, units, unbound };
}

// --- MaterialX terminal bridge ----------------------------------------------

/** Structural view of a surfacematerial input, mockable without the WASM build. */
export interface MtlxMaterialInput {
  getName(): string;
  getType(): string;
  getConnectedNode?(): MxNode | null;
}

/** Structural view of a surfacematerial node. */
export interface MtlxMaterialNode extends MxElement {
  getInputs(): MxVector<MtlxMaterialInput> | MtlxMaterialInput[];
}

/** Lookup surface for a loaded MaterialX document. */
export interface MtlxDocumentView {
  getMaterialNode?(name: string): MtlxMaterialNode | null;
  getChild?(name: string): MtlxMaterialNode | null;
  /** Enumerates the document's surfacematerial nodes (robust-name fallback). */
  getMaterialNodes?(): MxVector<MtlxMaterialNode> | MtlxMaterialNode[];
}

export interface MaterialGraphRootsOptions {
  sink?: DiagnosticSink;
}

/** USD shader terminals, resolved in render order. */
const MATERIAL_TERMINALS = ['displacementshader', 'surfaceshader', 'volumeshader'] as const;

function toArray<T>(v: MxVector<T> | T[]): T[] {
  if (Array.isArray(v)) return v;
  const out: T[] = [];
  for (let i = 0; i < v.size(); i++) out.push(v.get(i));
  return out;
}

/**
 * Resolve a material node by name, tolerating USD/MaterialX naming drift: the USD
 * reference target (e.g. .../velvet) often differs in case from the authored
 * surfacematerial (Velvet) or carries a USD-side name (brick_procedural) unrelated
 * to the mtlx node (M_BrickPattern). Try the exact name, then a case-insensitive
 * enumeration match, then fall back to the document's sole material node.
 */
function findMaterialNode(
  doc: MtlxDocumentView,
  materialName: string,
  emit: (d: Diagnostic) => void,
): MtlxMaterialNode | null {
  const exact = doc.getMaterialNode?.(materialName) ?? doc.getChild?.(materialName) ?? null;
  if (exact) return exact;

  const materials = doc.getMaterialNodes ? toArray(doc.getMaterialNodes()) : [];
  if (materials.length === 0) return null;

  const wanted = materialName.toLowerCase();
  const ci = materials.find((m) => m.getName().toLowerCase() === wanted);
  if (ci) {
    emit({ level: 'info', message: `MaterialX material matched case-insensitively: ${materialName} -> ${ci.getName()}` });
    return ci;
  }
  if (materials.length === 1) {
    const sole = materials[0]!;
    emit({ level: 'info', message: `MaterialX material ${materialName} not found; using sole material ${sole.getName()}` });
    return sole;
  }
  return null;
}

/**
 * Build the GraphRoots (shader terminals) of a MaterialX material by name, ready
 * for resolveGraph. The caller injects the loaded document; this stays a pure
 * structural bridge so it is node-testable without the Core WASM module.
 */
export function materialGraphRoots(
  doc: MtlxDocumentView,
  materialName: string,
  options: MaterialGraphRootsOptions = {},
): GraphRoot[] {
  const emit: (d: Diagnostic) => void = options.sink ?? (() => undefined);
  const material = findMaterialNode(doc, materialName, emit);
  if (!material) {
    emit({ level: 'error', message: `MaterialX material not found: ${materialName}` });
    return [];
  }

  const inputs = toArray(material.getInputs());
  const roots: GraphRoot[] = [];
  for (const terminal of MATERIAL_TERMINALS) {
    const input = inputs.find((i) => i.getName() === terminal);
    if (!input) continue;
    const node = input.getConnectedNode?.() ?? null;
    if (!node) {
      emit({
        level: 'warning',
        message: `Material terminal unconnected: ${materialName}.${terminal}`,
      });
      continue;
    }
    roots.push({ name: terminal, type: input.getType(), node });
  }

  if (roots.length === 0) {
    emit({ level: 'warning', message: `Material has no connected shader terminals: ${materialName}` });
  }
  return roots;
}
