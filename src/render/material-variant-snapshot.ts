import type { ResolvedGraph, ResolvedNode } from '../materialx/graph.ts';
import type { ResolvedSurface, NormalizedSurfaceInput } from '../materialx/surface-graph.ts';
import type { MaterialParameter } from './material-parameters.ts';

export interface StoredMaterialVariant {
  version: 1;
  graph: Omit<ResolvedGraph, 'nodes'> & { nodes: ResolvedNode[] };
  surface: Omit<ResolvedSurface, 'inputs'> & { inputs: [string, NormalizedSurfaceInput][] };
  parameters: readonly MaterialParameter[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isStoredMaterialVariant(value: unknown): value is StoredMaterialVariant {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.graph) || !isRecord(value.surface)) return false;
  const graph = value.graph;
  const surface = value.surface;
  return Array.isArray(graph.terminals)
    && Array.isArray(graph.nodes)
    && graph.nodes.every(node => isRecord(node) && typeof node.id === 'string' && Array.isArray(node.inputs))
    && Array.isArray(surface.inputs)
    && surface.inputs.every(input => Array.isArray(input) && typeof input[0] === 'string' && isRecord(input[1]))
    && Array.isArray(value.parameters)
    && value.parameters.every(parameter => isRecord(parameter) && typeof parameter.id === 'string'
      && typeof parameter.input === 'string' && Array.isArray(parameter.value) && Array.isArray(parameter.initial));
}
