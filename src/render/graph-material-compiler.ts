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
import { lowerValueInputsToIr, SURFACE_IR_UPSTREAM } from '../compiler/surface-ir.ts';
import { resolveGraph } from '../materialx/graph.ts';
import { resolveSurface, type NormalizedSurfaceInput, type ResolveSurfaceOptions, type SurfaceInputType } from '../materialx/surface-graph.ts';
import { resolveVolume, hasVolumeTerminal } from '../materialx/volume-graph.ts';
import { appendVolumeIr } from '../compiler/volume-ir.ts';
import { evaluateIrRef } from '../compiler/ir-eval.ts';
import type { ResolvedVolume } from '../materialx/volume-graph.ts';
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
function neutralSurfaceIr(volume?: ResolvedVolume, graph?: ResolvedGraph): ShaderIr {
  const b = new IrModuleBuilder();
  const opacity = b.constant(FLOAT, 1);
  const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
  b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
  if (volume) appendVolumeIr(volume, b, graph);
  return b.build();
}

/** Preserve homogeneous VDF coefficients in the compiled IR. */
function volumeIr(volume: ResolvedVolume, graph: ResolvedGraph): ShaderIr {
  const b = new IrModuleBuilder();
  appendVolumeIr(volume, b, graph);
  return b.build();
}

function displacementInputs(
  node: NonNullable<ReturnType<ResolvedGraph['nodes']['get']>>,
): Map<string, NormalizedSurfaceInput> {
  const inputs = new Map<string, NormalizedSurfaceInput>();
  for (const [name, fallback] of [['displacement', 0], ['scale', 1]] as const) {
    const authored = node.inputs.find(input => input.name === name);
    const definition = node.nodeDef?.inputs?.find(input => input.name === name);
    const type = authored?.type ?? definition?.type ?? 'float';
    if (!['float', 'color3', 'vector3'].includes(type)) {
      throw new Error(`Unsupported displacement ${name} type '${type}'.`);
    }
    const source = authored?.source;
    if (source?.kind === 'interface') {
      throw new Error(`Unresolved displacement ${name} interface '${source.name}'.`);
    }
    const parsedDefault = definition?.value?.split(',').map(value => Number(value.trim()));
    const value = source?.kind === 'value'
      ? source.value.split(',').map(part => Number.parseFloat(part.trim()))
      : parsedDefault?.length ? parsedDefault : [fallback];
    if (source?.kind === 'connection') {
      inputs.set(name, {
        name, type: type as SurfaceInputType,
        source: { kind: 'connection', nodeId: source.nodeId, ...(source.output ? { output: source.output } : {}) },
        ...(authored?.parameter ? { parameter: authored.parameter } : {}),
      });
    } else {
      if (!value.every(Number.isFinite)) throw new Error(`Invalid displacement ${name}.`);
      inputs.set(name, {
        name, type: type as SurfaceInputType, source: { kind: 'value', value },
        ...(authored?.parameter ? { parameter: authored.parameter } : {}),
      });
    }
  }
  return inputs;
}

function compileDisplacementProgram(
  graph: ResolvedGraph,
  node: NonNullable<ReturnType<ResolvedGraph['nodes']['get']>>,
): MaterialBuild['displacement'] {
  const builder = new IrModuleBuilder();
  const inputs = lowerValueInputsToIr(graph, displacementInputs(node), builder);
  const displacementRef = inputs.get('displacement');
  const scaleRef = inputs.get('scale');
  if (!displacementRef || !scaleRef) throw new Error('Displacement graph has no numeric output.');
  const ir = builder.build();
  if (!ir.params.length && !ir.primvars.length && !ir.textures.length
      && ![...ir.exprs.values()].some(expression => expression.kind === 'input')) {
    const value = evaluateIrRef(ir, displacementRef);
    if (value.every(component => component === 0)) return undefined;
  }
  const displacementType = builder.get(displacementRef)?.type;
  const scaleType = builder.get(scaleRef)?.type;
  if (displacementType?.kind === 'scalar' && scaleType?.kind === 'scalar') {
    return { scale: 1, program: { ir, displacementRef, scaleRef, mode: 'scalar' } };
  }
  if (displacementType?.kind === 'vector' && displacementType.size === 3 && scaleType?.kind === 'scalar') {
    return { scale: 1, program: { ir, displacementRef, scaleRef, mode: 'vector' } };
  }
  throw new Error('Displacement graph must output a float or vector3 and use a scalar scale.');
}

/** Lower the displacementshader graph, retaining the legacy fast path for a direct height image. */
export function extractDisplacement(graph: ResolvedGraph): NonNullable<MaterialBuild['displacement']> | undefined {
  const terminal = graph.terminals.find((t) => t.name === 'displacementshader');
  if (!terminal?.nodeId) return undefined;
  const node = graph.nodes.get(terminal.nodeId);
  if (!node || node.category !== 'displacement') return undefined;
  const scaleInput = node.inputs.find((i) => i.name === 'scale');
  const height = node.inputs.find((i) => i.name === 'displacement');
  const image = height?.source.kind === 'connection' ? graph.nodes.get(height.source.nodeId) : undefined;
  const fileInput = image?.inputs.find(input => input.name === 'file');
  const mappingInputs = ['uvtiling', 'uvoffset', 'realworldimagesize', 'realworldtilesize'];
  const staticImageMapping = image?.category !== 'tiledimage' || mappingInputs.every(name => {
    const source = image.inputs.find(input => input.name === name)?.source;
    return source === undefined || source.kind === 'value' || source.kind === 'default';
  });
  const staticScale = scaleInput?.source.kind !== 'connection' && scaleInput?.source.kind !== 'interface';
  if (height?.type === 'float' && height.source.kind === 'connection' && image?.type === 'float'
      && image && ['image', 'tiledimage'].includes(image.category) && staticImageMapping
      && fileInput?.source.kind === 'value' && staticScale) {
    const file = String(fileInput.source.value);
    if (!file) return undefined;
    const scaleValue = scaleInput?.source.kind === 'value'
      ? Number(scaleInput.source.value) : Number(node.nodeDef?.inputs?.find(input => input.name === 'scale')?.value ?? 1);
    const scale = Number.isFinite(scaleValue) ? scaleValue : 1;
    if (image.category !== 'tiledimage') return { file, scale };
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
  return compileDisplacementProgram(graph, node);
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
          isCovered: (category) => category === 'volume' || category === 'LamaConductor' || category === 'LamaDielectric' || category === 'LamaGeneralizedSchlick' || isNodeCovered(category) || SURFACE_IR_UPSTREAM.has(category),
          ...(options.target !== undefined ? { target: options.target } : {}),
        });

        const volume = hasVolumeTerminal(graph) ? resolveVolume(graph, { onDiagnostic: emit }) : null;
        if (volume && !graph.terminals.some(t => t.type === 'surfaceshader' && t.nodeId)) {
          const ir = volumeIr(volume, graph);
          return { ir, module: emitWgsl(ir), volume, graph };
        }
        const surface = resolveSurface(graph, { onDiagnostic: emit, supportedUpstream: SURFACE_IR_UPSTREAM, ...options.surfaceOptions });
        if (!surface) {
          emit({ level: 'warning', message: `Unresolved surface for material ${unit.materialName}`, detail: { material: unit.materialName } });
          return undefined;
        }
        const layered = emitLayeredSurface(graph, surface, emit);
        const ir = neutralSurfaceIr(volume ?? undefined, graph);
        const displacement = extractDisplacement(graph);
        return { ir, module: emitWgsl(ir), layered, graph, surface, ...(volume ? { volume } : {}), ...(displacement ? { displacement } : {}) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? (error.stack ?? '') : '';
        emit({ level: 'error', message: `Material compile failed for ${unit.materialName}: ${message}`, detail: { material: unit.materialName, stack } });
        return undefined;
      }
    },
  };
}
