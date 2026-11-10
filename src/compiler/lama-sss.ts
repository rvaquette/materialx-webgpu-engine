import type { ResolvedGraph } from '../materialx/graph.ts';

export function lamaSssTransport(graph: ResolvedGraph, nodeId: string): 1 | 2 | 3 {
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
  if (![1, 2, 3].includes(transport)) {
    throw new Error(`LamaSSS '${nodeId}': sssMode=${values('sssMode', '0') ?? 'connected'} is unsupported. Davis (0) requires its own attenuation model; select exponential (1) or Burley (2/3).`);
  }
  const unsupported: ReadonlyArray<readonly [string, string]> = [
    ['sssBleed', '0'], ['sssFollowTopology', '0'], ['sssSubset', ''],
    ['sssContinuationRays', '0'], ['mode', '0'],
  ];
  for (const [name, fallback] of unsupported) {
    const value = values(name, fallback);
    if (value === undefined || (name === 'sssSubset' ? value !== '' : Number(value) !== 0)) {
      throw new Error(`LamaSSS '${nodeId}': ${name}=${value ?? 'connected'} is unsupported; it cannot be ignored.`);
    }
  }
  if (Number(values('albedoInversionMethod', '0')) !== 1) {
    throw new Error(`LamaSSS '${nodeId}': Pixar albedo inversion is unsupported; select albedoInversionMethod=1 (Chiang).`);
  }
  const ior = values('sssIOR', '1');
  if (ior !== undefined && (!Number.isFinite(Number(ior)) || Number(ior) < 1)) {
    throw new Error(`LamaSSS '${nodeId}': sssIOR must be finite and at least 1.`);
  }
  if (transport >= 2 && (ior === undefined || Number(ior) !== 1)) {
    throw new Error(`LamaSSS '${nodeId}': Burley currently requires sssIOR=1; total internal reflection is a random-walk boundary operation.`);
  }
  if (transport === 2 && Number(values('sssAnisotropy', '0')) !== 0) {
    throw new Error(`LamaSSS '${nodeId}': diffuse-distance Burley requires sssAnisotropy=0; use the volumetric-MFP model (3).`);
  }
  return transport as 1 | 2 | 3;
}