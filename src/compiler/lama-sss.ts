import type { ResolvedGraph } from '../materialx/graph.ts';

const subsetLabels = new Map<number, string>();

export function lamaSssSubset(graph: ResolvedGraph, nodeId: string): number {
  const node = graph.nodes.get(nodeId)!;
  const input = node.inputs.find(item => item.name === 'sssSubset');
  if (input && input.source.kind !== 'value') throw new Error(`LamaSSS '${nodeId}': dynamic sssSubset is unsupported.`);
  const label = (input?.source.kind === 'value' ? input.source.value
    : node.nodeDef?.inputs?.find(item => item.name === 'sssSubset')?.value ?? '').trim();
  if (!label) return 0;
  if (!/^[a-zA-Z0-9_.:-]+$/.test(label)) throw new Error(`LamaSSS '${nodeId}': unsupported subset syntax; use a uniform group label.`);
  let hash = 2166136261;
  for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const key = hash % 0xffffff + 1;
  const previous = subsetLabels.get(key);
  if (previous !== undefined && previous !== label) throw new Error(`LamaSSS subset hash collision: ${previous} / ${label}.`);
  subsetLabels.set(key, label);
  return key;
}

export function lamaSssTransport(graph: ResolvedGraph, nodeId: string): 0 | 1 | 2 | 3 {
  const node = graph.nodes.get(nodeId)!;
  const values = (name: string, fallback: string): string | undefined => {
    const input = node.inputs.find(item => item.name === name);
    if (input) return input.source.kind === 'value' ? input.source.value : undefined;
    return node.nodeDef?.inputs?.find(item => item.name === name)?.value ?? fallback;
  };
  const radius = values('sssRadius', '0,0,0');
  const scale = values('sssScale', '1');
  if ((radius !== undefined && radius.split(',').every(value => Number(value.trim()) === 0))
    || (scale !== undefined && Number(scale) === 0)) return 1;

  const transport = Number(values('sssMode', '0'));
  if (![0, 1, 2, 3].includes(transport)) {
    throw new Error(`LamaSSS '${nodeId}': unsupported sssMode; expected a uniform integer from 0 to 3.`);
  }
  for (const name of ['sssFollowTopology', 'sssContinuationRays']) {
    const value = values(name, '0');
    if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) {
      throw new Error(`LamaSSS '${nodeId}': unsupported ${name}; expected [0,1].`);
    }
  }
  lamaSssSubset(graph, nodeId);
  const surfaceMode = Number(values('mode', '0'));
  if (![0, 1, 2].includes(surfaceMode) || (surfaceMode === 1 && transport >= 2)) {
    throw new Error(`LamaSSS '${nodeId}': mode=${values('mode', '0') ?? 'connected'} is unsupported for transport ${transport}.`);
  }
  if (![0, 1].includes(Number(values('albedoInversionMethod', '0')))) {
    throw new Error(`LamaSSS '${nodeId}': unsupported albedoInversionMethod; expected 0 or 1.`);
  }
  const bleed = values('sssBleed', '0');
  if (bleed !== undefined && (!Number.isFinite(Number(bleed)) || Number(bleed) < 0 || Number(bleed) > 1)) {
    throw new Error(`LamaSSS '${nodeId}': unsupported sssBleed; expected [0,1].`);
  }
  const ior = values('sssIOR', '1');
  if (ior !== undefined && (!Number.isFinite(Number(ior)) || Number(ior) < 1)) {
    throw new Error(`LamaSSS '${nodeId}': sssIOR must be finite and at least 1.`);
  }
  return transport as 0 | 1 | 2 | 3;
}