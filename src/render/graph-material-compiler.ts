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
import { isNodeCovered } from '../compiler/nodes.ts';
import { SURFACE_IR_UPSTREAM } from '../compiler/surface-ir.ts';
import { resolveGraph } from '../materialx/graph.ts';
import { resolveSurface, type ResolveSurfaceOptions } from '../materialx/surface-graph.ts';
import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import { materialGraphRoots, type MaterialCompileUnit, type MtlxDocumentView } from '../usd/materials.ts';
import type { ResolvedGraph } from '../materialx/graph.ts';
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

/** Extract a height-map displacement from the resolved graph's displacementshader
 *  terminal: the `displacement` node feeds a scalar height image whose `file` we
 *  sample on the GPU and a uniform `scale` applied along the shading normal. Only
 *  the texture-fed case is handled; a constant displacement has no map to sample. */
export function extractDisplacement(graph: ResolvedGraph): NonNullable<MaterialBuild['displacement']> | undefined {
  const terminal = graph.terminals.find((t) => t.name === 'displacementshader');
  if (!terminal?.nodeId) return undefined;
  const node = graph.nodes.get(terminal.nodeId);
  if (!node || node.category !== 'displacement') return undefined;
  let scale = 1;
  const scaleInput = node.inputs.find((i) => i.name === 'scale');
  if (scaleInput?.source.kind === 'value') {
    const v = Number(scaleInput.source.value);
    if (Number.isFinite(v)) scale = v;
  }
  const height = node.inputs.find((i) => i.name === 'displacement');
  if (height?.source.kind !== 'connection') return undefined;
  const image = graph.nodes.get(height.source.nodeId);
  const fileInput = image?.inputs.find((i) => i.name === 'file');
  if (fileInput?.source.kind !== 'value') return undefined;
  const file = String(fileInput.source.value);
  if (!file) return undefined;
  if (image?.category !== 'tiledimage') return { file, scale };
  const pair = (name: string, fallback: readonly [number, number]): [number, number] => {
    const source = image.inputs.find(input => input.name === name)?.source;
    const raw = source?.kind === 'value' ? source.value : image.nodeDef?.inputs?.find(input => input.name === name)?.value;
    if (raw === undefined) return [...fallback];
    const values = raw.split(',').map(Number);
    if (values.length !== 2 || !values.every(Number.isFinite)) throw new Error(`Invalid displacement ${name}`);
    return [values[0]!, values[1]!];
  };
  const tiling = pair('uvtiling', [1, 1]), offset = pair('uvoffset', [0, 0]);
  const imageSize = pair('realworldimagesize', [1, 1]), tileSize = pair('realworldtilesize', [1, 1]);
  if (imageSize.some(value => value === 0)) throw new Error('Displacement realworldimagesize must be nonzero.');
  return {
    file, scale,
    uvScale: [tiling[0] * tileSize[0] / imageSize[0], tiling[1] * tileSize[1] / imageSize[1]],
    uvOffset: [-offset[0] * tileSize[0] / imageSize[0], -offset[1] * tileSize[1] / imageSize[1]],
  };
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
      try {
        const roots = materialGraphRoots(doc, unit.materialName, { sink: emit });
        if (roots.length === 0) return undefined;
        const graph = resolveGraph({
          roots,
          onDiagnostic: emit,
          isCovered: (category) => isNodeCovered(category) || SURFACE_IR_UPSTREAM.has(category),
          ...(options.target !== undefined ? { target: options.target } : {}),
        });
        const surface = resolveSurface(graph, { onDiagnostic: emit, supportedUpstream: SURFACE_IR_UPSTREAM, ...options.surfaceOptions });
        if (!surface) {
          emit({ level: 'warning', message: `Unresolved surface for material ${unit.materialName}`, detail: { material: unit.materialName } });
          return undefined;
        }
        const layered = emitLayeredSurface(graph, surface, emit);
        const ir = neutralSurfaceIr();
        const displacement = extractDisplacement(graph);
        return { ir, module: emitWgsl(ir), layered, graph, surface, ...(displacement ? { displacement } : {}) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? (error.stack ?? '') : '';
        emit({ level: 'error', message: `Material compile failed for ${unit.materialName}: ${message}`, detail: { material: unit.materialName, stack } });
        return undefined;
      }
    },
  };
}
