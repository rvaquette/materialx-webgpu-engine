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

function parseVolumeValue(raw: string, size: number): number[] {
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== size || parts.some(n => !Number.isFinite(n)) || !raw.trim()) {
    throw new Error(`Invalid volume value '${raw}': expected ${size} finite component(s).`);
  }
  return parts;
}

function volumeSourceFromResolved(
  input: ResolvedInput,
): NormalizedVolumeSource {
  switch (input.source.kind) {
    case 'value':
      return { kind: 'value', value: parseVolumeValue(input.source.value, input.type === 'float' ? 1 : 3) };
    case 'connection':
      return input.source.output
        ? { kind: 'connection', nodeId: input.source.nodeId, output: input.source.output }
        : { kind: 'connection', nodeId: input.source.nodeId };
    case 'interface':
      throw new Error(`Unresolved volume interface '${input.name}'.`);
    case 'default':
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

  if (node.inputs.some(i => i.name === 'edf' && i.source.kind === 'connection')) {
    throw new Error('Emissive volumeshaders are not supported yet.');
  }
  const vdfInput = node.inputs.find((i) => i.name === 'vdf' || i.name === 'distribution');
  const vdfNodeId = vdfInput?.source.kind === 'connection' ? vdfInput.source.nodeId : undefined;
  const vdf = vdfNodeId ? graph.nodes.get(vdfNodeId) : undefined;
  if (!vdf || vdf.category !== 'anisotropic_vdf') {
    throw new Error('Volumeshaders currently require an anisotropic_vdf connection.');
  }
  const inputs = new Map<string, NormalizedVolumeInput>();
  for (const name of ['absorption', 'scattering', 'anisotropy']) {
    const type = name === 'anisotropy' ? 'float' : 'vector3';
    const input = vdf.inputs.find(i => i.name === name);
    const declaredDefault = vdf.nodeDef?.inputs?.find(i => i.name === name)?.value;
    const source = input && input.source.kind !== 'default'
      ? volumeSourceFromResolved(input)
      : { kind: 'default' as const, value: declaredDefault
        ? parseVolumeValue(declaredDefault, type === 'float' ? 1 : 3)
        : type === 'float' ? [0] : [0, 0, 0] };
    inputs.set(name, { name, type, source });
  }

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
