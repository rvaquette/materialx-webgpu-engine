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
import type { ResolvedGraph } from '../materialx/graph.ts';
import type { NormalizedSurfaceInput, ResolvedSurface } from '../materialx/surface-graph.ts';

/** A surface whose inputs have been lowered to IR once, ready for per-point eval. */
export interface PreparedSurface {
  readonly surface: ResolvedSurface;
  readonly ir: ShaderIr;
  /** Surface input name -> IrRef feeding it. */
  readonly inputs: ReadonlyMap<string, string>;
  /** Inputs whose source is an upstream connection (the overridable procedural set). */
  readonly connected: ReadonlySet<string>;
}

const silentSink: DiagnosticSink = () => {};

/** Lower a surface's inputs to IR once so it can be composed at many shading points. */
export function prepareSurface(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  sink: DiagnosticSink = silentSink,
): PreparedSurface {
  const builder = new IrModuleBuilder();
  const lowered = lowerSurfaceInputsToIr(graph, surface, builder, sink);
  const connected = new Set<string>();
  for (const [name, input] of surface.inputs) {
    if (input.source.kind === 'connection') connected.add(name);
  }
  return { surface, ir: builder.build(), inputs: lowered.inputs, connected };
}

/** Compose a prepared surface into a LayeredClosure at one shading point. */
export function composeSurfaceLayered(prepared: PreparedSurface, env: IrEvalVaryings = {}): LayeredClosure {
  // No procedural inputs: exact non-regression with the constant lowering.
  if (prepared.connected.size === 0) return surfaceGraphToLayered(prepared.surface);
  const cache = new Map<string, readonly number[]>();
  const overridden = new Map<string, NormalizedSurfaceInput>();
  for (const [name, input] of prepared.surface.inputs) {
    const ref = input.source.kind === 'connection' ? prepared.inputs.get(name) : undefined;
    if (ref !== undefined) {
      const value = evaluateIrRef(prepared.ir, ref, env, cache);
      overridden.set(name, { name: input.name, type: input.type, source: { kind: 'value', value: [...value] } });
    } else {
      overridden.set(name, input);
    }
  }
  return surfaceGraphToLayered({ ...prepared.surface, inputs: overridden });
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
