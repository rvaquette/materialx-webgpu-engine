// T057i3: compose a resolved surface's procedural/textured inputs into a
// LayeredClosure on CPU. It bridges three existing pieces: lowerSurfaceInputsToIr
// (surface-ir.ts) builds the per-input IR, evaluateIrRef (ir-eval.ts) evaluates
// each connected input to a value at a shading point, and surfaceGraphToLayered
// (surface-lower.ts) assembles the family lobes. Connected inputs are overridden
// with their evaluated values; literal/default/geomprop inputs are left intact so
// a constant-only surface lowers byte-identically to the pre-i3 path (the brick
// base_color through brick_color/rgbtohsv/mix is finally evaluated instead of
// falling back to the nodedef default). This is the CPU oracle the path tracer
// mirrors before the megakernel wires the same graph on device (T057i4). Textures
// resolve to the interpreter's neutral until real sampling (T057k).

import { IrModuleBuilder, type LayeredClosure, type ShaderIr } from './ir.ts';
import { evaluateIrRef, type IrEvalVaryings } from './ir-eval.ts';
import { lowerSurfaceInputsToIr } from './surface-ir.ts';
import { surfaceGraphToLayered } from './surface-lower.ts';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { ResolvedGraph, ResolvedInput, ResolvedNode } from '../materialx/graph.ts';
import type { NormalizedSurfaceInput, ResolvedSurface, SurfaceInputType } from '../materialx/surface-graph.ts';

/** A surface whose inputs have been lowered to IR once, ready for per-point eval. */
export interface PreparedSurface {
  readonly graph: ResolvedGraph;
  readonly surface: ResolvedSurface;
  readonly ir: ShaderIr;
  /** Surface input name -> IrRef feeding it. */
  readonly inputs: ReadonlyMap<string, string>;
  /** Inputs whose source is an upstream connection (the overridable procedural set). */
  readonly connected: ReadonlySet<string>;
  /** Connected numeric inputs on Lama BSDF/EDF nodes, keyed by node and input. */
  readonly lamaInputs: readonly { nodeId: string; input: ResolvedInput; ref: string }[];
}

const silentSink: DiagnosticSink = () => {};

const LAMA_VALUE_TYPES = new Set(['float', 'color3', 'vector3', 'integer', 'boolean']);

function parseLamaValue(raw: string): number[] {
  if (raw.trim() === 'true') return [1];
  if (raw.trim() === 'false') return [0];
  return raw.split(',').map(part => {
    const number = Number.parseFloat(part.trim());
    return Number.isFinite(number) ? number : 0;
  });
}

function resolvedLamaNodeSurface(node: ResolvedNode): ResolvedSurface {
  const authored = new Map(node.inputs.map(input => [input.name, input] as const));
  const declared = node.nodeDef?.inputs ?? [];
  const defs: readonly { name: string; type: string; value?: string; geomprop?: string }[] = [
    ...declared,
    ...node.inputs.filter(input => !declared.some(def => def.name === input.name))
      .map(input => ({ name: input.name, type: input.type })),
  ];
  const inputs = new Map<string, NormalizedSurfaceInput>();
  for (const def of defs) {
    if (!LAMA_VALUE_TYPES.has(def.type)) continue;
    const input = authored.get(def.name);
    let source: NormalizedSurfaceInput['source'];
    if (input?.source.kind === 'value') source = { kind: 'value', value: parseLamaValue(input.source.value) };
    else if (input?.source.kind === 'connection') {
      source = { kind: 'connection', nodeId: input.source.nodeId, ...(input.source.output ? { output: input.source.output } : {}) };
    } else if (def.geomprop) source = { kind: 'geomprop', name: def.geomprop };
    else source = { kind: 'default', value: def.value !== undefined ? parseLamaValue(def.value) : [0] };
    inputs.set(def.name, { name: def.name, type: def.type as SurfaceInputType, source });
  }
  return { family: 'surface', nodeId: node.id, inputs };
}

/** Lower a surface's inputs to IR once so it can be composed at many shading points. */
export function prepareSurface(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  sink: DiagnosticSink = silentSink,
): PreparedSurface {
  const builder = new IrModuleBuilder();
  const valueInputs = new Map([...surface.inputs].filter(([, input]) => input.type !== 'BSDF' && input.type !== 'EDF'));
  const lowered = lowerSurfaceInputsToIr(graph, { ...surface, inputs: valueInputs }, builder, sink);
  const connected = new Set<string>();
  for (const [name, input] of surface.inputs) {
    if (input.source.kind === 'connection' && input.type !== 'BSDF' && input.type !== 'EDF') connected.add(name);
  }
  const lamaInputs: Array<{ nodeId: string; input: ResolvedInput; ref: string }> = [];
  for (const node of graph.nodes.values()) {
    if (node.id === surface.nodeId || !(node.nodeDef?.nodeString ?? node.category).startsWith('Lama')) continue;
    const nodeSurface = resolvedLamaNodeSurface(node);
    const nodeInputs = lowerSurfaceInputsToIr(graph, nodeSurface, builder, sink).inputs;
    for (const authored of node.inputs) {
      if (authored.source.kind !== 'connection') continue;
      const ref = nodeInputs.get(authored.name);
      if (ref !== undefined) lamaInputs.push({ nodeId: node.id, input: authored, ref });
    }
  }
  return { graph, surface, ir: builder.build(), inputs: lowered.inputs, connected, lamaInputs };
}

/** Compose a prepared surface into a LayeredClosure at one shading point. */
export function composeSurfaceLayered(prepared: PreparedSurface, env: IrEvalVaryings = {}): LayeredClosure {
  const frame = {
    ...(env.normal !== undefined ? { normal: env.normal } : {}),
    ...(env.tangent !== undefined ? { tangent: env.tangent } : {}),
  };
  // No procedural inputs: exact non-regression with the constant lowering.
  if (prepared.connected.size === 0 && prepared.lamaInputs.length === 0) {
    return surfaceGraphToLayered(selectLamaSide(prepared.surface, env), prepared.graph, frame);
  }
  const cache = new Map<string, readonly number[]>();
  const overridden = new Map<string, NormalizedSurfaceInput>();
  for (const [name, input] of prepared.surface.inputs) {
    const ref = input.source.kind === 'connection' ? prepared.inputs.get(name) : undefined;
    let value: readonly number[] | undefined;
    if (ref !== undefined) {
      try {
        value = evaluateIrRef(prepared.ir, ref, env, cache);
      } catch {
        // Nodes without a CPU mirror (noise, matrices...) keep the authored/default input.
        value = undefined;
      }
    }
    if (value !== undefined) {
      overridden.set(name, { name: input.name, type: input.type, source: { kind: 'value', value: [...value] } });
    } else {
      overridden.set(name, input);
    }
  }
  const nodes = new Map(prepared.graph.nodes);
  const nodeInputs = new Map<string, Map<string, ResolvedInput>>();
  for (const { nodeId, input, ref } of prepared.lamaInputs) {
    let values: readonly number[] | undefined;
    try { values = evaluateIrRef(prepared.ir, ref, env, cache); } catch { values = undefined; }
    if (values === undefined) continue;
    const inputs = nodeInputs.get(nodeId) ?? new Map(nodes.get(nodeId)?.inputs.map(item => [item.name, item] as const) ?? []);
    inputs.set(input.name, { ...input, source: { kind: 'value', value: values.join(', '), type: input.type } });
    nodeInputs.set(nodeId, inputs);
  }
  for (const [nodeId, inputs] of nodeInputs) {
    const node = nodes.get(nodeId);
    if (node) nodes.set(nodeId, { ...node, inputs: [...inputs.values()] });
  }
  const graph = nodes.size === prepared.graph.nodes.size
    ? { ...prepared.graph, nodes }
    : prepared.graph;
  return surfaceGraphToLayered(selectLamaSide({ ...prepared.surface, inputs: overridden }, env), graph, frame);
}

function selectLamaSide(surface: ResolvedSurface, env: IrEvalVaryings): ResolvedSurface {
  if (!surface.backNodeId || !env.normal || !env.viewDir) return surface;
  const facing = (env.normal[0] ?? 0) * (env.viewDir[0] ?? 0)
    + (env.normal[1] ?? 0) * (env.viewDir[1] ?? 0)
    + (env.normal[2] ?? 0) * (env.viewDir[2] ?? 0);
  return facing >= 0 ? surface : {
    family: surface.family,
    nodeId: surface.backNodeId,
    ...(surface.nodeDefName !== undefined ? { nodeDefName: surface.nodeDefName } : {}),
    ...(surface.version !== undefined ? { version: surface.version } : {}),
    inputs: surface.inputs,
  };
}

/** Convenience: lower and compose a surface in one call. */
export function evaluateSurfaceToLayered(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  env: IrEvalVaryings = {},
  sink: DiagnosticSink = silentSink,
): LayeredClosure {
  return composeSurfaceLayered(prepareSurface(graph, surface, sink), env);
}
