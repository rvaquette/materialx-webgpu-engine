// T055a-volume: resolve and normalize the volume-shader interface of a ResolvedGraph.
// Parallel to surface-graph.ts but for volumeshader terminals. A volumeshader
// takes a VDF (Volume Distribution Function) closure as its primary input and
// manages participating media parameters (absorption, scattering, anisotropy).

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';
import type { ResolvedGraph, ResolvedInput } from './graph.ts';

/** Normalized source of a resolved volume input. */
export type NormalizedVolumeSource =
  | { kind: 'value'; value: readonly number[] }
  | { kind: 'connection'; nodeId: string; output?: string }
  | { kind: 'default'; value: readonly number[] };

export interface NormalizedVolumeInput {
  readonly name: string;
  readonly type: 'float' | 'color3' | 'vector3';
  readonly source: NormalizedVolumeSource;
  /** Optional live uniform name, assigned by the interactive material editor. */
  readonly parameter?: string;
}

/** Resolved volumeshader from the graph. A volumeshader is a simpler construct
 * than a surface: it takes a VDF closure (or builds one from inputs) and
 * optionally specifies quality parameters for ray marching. */
export interface ResolvedVolume {
  readonly nodeId: string;
  readonly nodeDefName?: string;
  /** The VDF closure node ID if connected, or undefined if building from inputs. */
  readonly vdfNodeId?: string;
  /** All inputs to the volumeshader, resolved to a normalized source. */
  readonly inputs: ReadonlyMap<string, NormalizedVolumeInput>;
}

export interface ResolveVolumeOptions {
  onDiagnostic?: DiagnosticSink;
  /** Upstream node categories the downstream lowering can emit; others warn. */
  supportedUpstream?: ReadonlySet<string>;
}

function parseVolumeValue(raw: string): number[] {
  const parts = raw.split(',').map((s) => Number.parseFloat(s.trim()));
  const finite = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) ? x : 0);
  return [finite(parts[0]), finite(parts[1]), finite(parts[2])];
}

function volumeSourceFromResolved(
  input: ResolvedInput,
): NormalizedVolumeSource {
  switch (input.source.kind) {
    case 'value':
      return { kind: 'value', value: parseVolumeValue(input.source.value) };
    case 'connection':
      return input.source.output
        ? { kind: 'connection', nodeId: input.source.nodeId, output: input.source.output }
        : { kind: 'connection', nodeId: input.source.nodeId };
    case 'interface':
    case 'default':
      // Default values for volume parameters
      return { kind: 'default', value: [0, 0, 0] };
  }
}

/** Resolve a volumeshader terminal from the ResolvedGraph. */
export function resolveVolume(
  graph: ResolvedGraph,
  options?: ResolveVolumeOptions,
): ResolvedVolume | null {
  const diag = options?.onDiagnostic ?? defaultDiagnosticSink;
  const volumeTerminal = graph.terminals.find((t) => t.type === 'volumeshader');

  if (!volumeTerminal || !volumeTerminal.nodeId) {
    return null;
  }

  const node = graph.nodes.get(volumeTerminal.nodeId);
  if (!node) {
    diag({
      level: 'warning',
      message: `Volumeshader node '${volumeTerminal.nodeId}' not found in graph.`,
      detail: { node: volumeTerminal.nodeId },
    });
    return null;
  }

  const inputs = new Map<string, NormalizedVolumeInput>();

  // Process all inputs from the volumeshader node
  for (const input of node.inputs) {
    const normalized: NormalizedVolumeInput = {
      name: input.name,
      type: (input.type as 'float' | 'color3' | 'vector3') ?? 'float',
      source: volumeSourceFromResolved(input),
    };
    inputs.set(input.name, normalized);
  }

  // Check if there's a VDF connection (typically named 'vdf' or 'distribution')
  const vdfInput = node.inputs.find((i) => i.name === 'vdf' || i.name === 'distribution');
  const vdfNodeId = vdfInput?.source.kind === 'connection' ? vdfInput.source.nodeId : undefined;

  return {
    nodeId: node.id,
    ...(node.nodeDef?.name !== undefined ? { nodeDefName: node.nodeDef.name } : {}),
    ...(vdfNodeId !== undefined ? { vdfNodeId } : {}),
    inputs,
  };
}

/** Detect if a ResolvedGraph contains a volumeshader terminal. */
export function hasVolumeTerminal(graph: ResolvedGraph): boolean {
  return graph.terminals.some((t) => t.type === 'volumeshader');
}
