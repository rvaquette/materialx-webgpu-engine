// T057m1: a MaterialCompiler that lowers a MaterialX material through the full
// resolved node network. Given a loaded MaterialX document per unit, it runs
// materialGraphRoots -> resolveGraph -> resolveSurface and returns the complete
// MaterialBuild (ir + module + layered + graph + surface), so buildSceneResources
// threads build.graph/build.surface into MaterialResource and the path tracer
// builds a megakernel variant source for procedural/textured materials. The
// stub/parsed-inputs compilers only ever produced constant records, leaving
// variantSources empty everywhere. A document provider is injected: the harness
// and live app load the WASM document, this stays a pure structural bridge,
// node-testable with fake Embind views.

import { emitWgsl } from '../compiler/wgsl.ts';
import { emitLayeredSurface } from '../compiler/surface-wgsl.ts';
import { FLOAT, IrModuleBuilder, shaderType, type ShaderIr } from '../compiler/ir.ts';
import { resolveGraph } from '../materialx/graph.ts';
import { resolveSurface, type ResolveSurfaceOptions } from '../materialx/surface-graph.ts';
import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import { materialGraphRoots, type MaterialCompileUnit, type MtlxDocumentView } from '../usd/materials.ts';
import type { MaterialBuild, MaterialCompiler } from './scene-resources.ts';

/** Supplies the loaded MaterialX document backing a material unit's asset. */
export interface MaterialDocumentSource {
  documentFor(unit: MaterialCompileUnit): MtlxDocumentView | undefined;
}

export interface GraphMaterialCompilerOptions {
  documents: MaterialDocumentSource;
  sink?: DiagnosticSink;
  /** Shader target for NodeDef/implementation selection (resolveGraph). */
  target?: string;
  surfaceOptions?: ResolveSurfaceOptions;
}

/** Minimal opaque surface IR so buildSceneResources can extract features and key
 *  the pipeline; the real shading rides on the layered module and resolved graph. */
function neutralSurfaceIr(): ShaderIr {
  const b = new IrModuleBuilder();
  const opacity = b.constant(FLOAT, 1);
  const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
  b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
  return b.build();
}

/** Build a MaterialCompiler that lowers each unit through the full node network. */
export function createGraphMaterialCompiler(options: GraphMaterialCompilerOptions): MaterialCompiler {
  const emit: (d: Diagnostic) => void = options.sink ?? (() => undefined);
  return {
    compile(unit: MaterialCompileUnit): MaterialBuild | undefined {
      const doc = options.documents.documentFor(unit);
      if (!doc) {
        emit({ level: 'warning', message: `No MaterialX document for material ${unit.materialName}`, detail: { material: unit.materialName } });
        return undefined;
      }
      const roots = materialGraphRoots(doc, unit.materialName, { sink: emit });
      if (roots.length === 0) return undefined;
      const graph = resolveGraph({
        roots,
        onDiagnostic: emit,
        ...(options.target !== undefined ? { target: options.target } : {}),
      });
      const surface = resolveSurface(graph, options.surfaceOptions ?? {});
      if (!surface) {
        emit({ level: 'warning', message: `Unresolved surface for material ${unit.materialName}`, detail: { material: unit.materialName } });
        return undefined;
      }
      const layered = emitLayeredSurface(graph, surface, emit);
      const ir = neutralSurfaceIr();
      return { ir, module: emitWgsl(ir), layered, graph, surface };
    },
  };
}
