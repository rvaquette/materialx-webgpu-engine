import type { ResolvedGraph, ResolvedInput, ResolvedNode } from '../../materialx/graph.ts';
import type { NormalizedSurfaceSource, ResolvedSurface } from '../../materialx/surface-graph.ts';
import { AssetResolver } from '../../assets/resolver.ts';

type Connection = Extract<NormalizedSurfaceSource, { kind: 'connection' }>;

export interface DisneyAlbedoTexture {
  file: string;
  factor: readonly [number, number, number];
}

function failure(detail: string): never {
  throw new Error(`Unsupported Disney texture graph: ${detail}.`);
}

function node(graph: ResolvedGraph, connection: Connection, category: string, type: string, output?: string): ResolvedNode {
  const found = graph.nodes.get(connection.nodeId);
  if (!found || found.category !== category || found.type !== type || connection.output !== output) {
    return failure(`expected ${category} ${type} at ${connection.nodeId}`);
  }
  const allowed = category === 'image' ? ['file'] : category === 'separate3' ? ['in'] : ['in1', 'in2'];
  if (found.inputs.some(item => !allowed.includes(item.name)) ||
      new Set(found.inputs.map(item => item.name)).size !== found.inputs.length) {
    return failure(`unexpected inputs at ${found.id}`);
  }
  return found;
}

function input(node: ResolvedNode, name: string): ResolvedInput {
  const found = node.inputs.find(candidate => candidate.name === name);
  if (!found || found.parameter) return failure(`missing or editable input ${node.id}.${name}`);
  return found;
}

function connected(node: ResolvedNode, name: string): Connection {
  const source = input(node, name).source;
  if (source.kind !== 'connection') return failure(`expected connection at ${node.id}.${name}`);
  return source;
}

function literal(node: ResolvedNode, name: string, count: number): number[] {
  const source = input(node, name).source;
  if (source.kind !== 'value') return failure(`expected literal at ${node.id}.${name}`);
  const parts = source.value.split(',').map(part => part.trim());
  const values = parts.map(Number);
  if (parts.length !== count || parts.some(part => part === '') || values.some(value => !Number.isFinite(value))) {
    return failure(`invalid literal at ${node.id}.${name}`);
  }
  return values;
}

function imageFile(graph: ResolvedGraph, source: Connection): string {
  const image = node(graph, source, 'image', 'color3');
  if (image.inputs.some(item => item.name !== 'file')) return failure(`image ${image.id} has unsupported inputs`);
  const file = input(image, 'file');
  if (file.source.kind !== 'value' || file.type !== 'filename' || !file.source.value || file.colorSpace ||
      AssetResolver.hasUdim(file.source.value)) {
    return failure(`image ${image.id} has an unsupported file or color space`);
  }
  const defaults = image.nodeDef?.inputs;
  const declared = (name: string) => defaults?.find(item => item.name === name);
  if (declared('texcoord')?.geomprop !== 'UV0' ||
      declared('uaddressmode')?.value !== 'periodic' ||
      declared('vaddressmode')?.value !== 'periodic' ||
      declared('filtertype')?.value !== 'linear') {
    return failure(`image ${image.id} has unsupported sampling defaults`);
  }
  return file.source.value;
}

/** Match linearized albedo multiplied by a constant, as used by compiled pathtracer scenes. */
export function disneyAlbedoTexture(graph: ResolvedGraph, source: Connection): DisneyAlbedoTexture {
  const multiply = node(graph, source, 'multiply', 'color3');
  const factor = literal(multiply, 'in2', 3);
  const power = node(graph, connected(multiply, 'in1'), 'power', 'color3');
  if (literal(power, 'in2', 3).some(value => value !== 2.2)) return failure(`unexpected albedo exponent at ${power.id}`);
  return {
    file: imageFile(graph, connected(power, 'in1')),
    factor: [factor[0]!, factor[1]!, factor[2]!],
  };
}

/**
 * Match the shared B/G metallic/roughness texture, including the authored
 * perceptual-roughness floor and the separate squared diffuse-roughness input.
 * Its image must be sampled as nonnegative normalized data by the caller.
 */
export function disneyMetallicRoughnessTexture(graph: ResolvedGraph, surface: ResolvedSurface): string {
  const source = (name: string): Connection => {
    const item = surface.inputs.get(name);
    if (!item || item.parameter || item.source.kind !== 'connection') return failure(`expected non-editable connected ${name}`);
    return item.source;
  };
  const channels = source('metalness');
  const separate = node(graph, channels, 'separate3', 'multioutput', 'outz');
  const roughness = source('specular_roughness');
  const max = node(graph, roughness, 'max', 'float');
  const roughChannel = connected(max, 'in1');
  if (roughChannel.nodeId !== separate.id || roughChannel.output !== 'outy' ||
      Math.abs(literal(max, 'in2', 1)[0]! - Math.sqrt(0.001)) > 1e-10) {
    return failure('metallic and roughness channels or roughness floor differ');
  }
  const diffuse = node(graph, source('diffuse_roughness'), 'multiply', 'float');
  for (const name of ['in1', 'in2']) {
    const value = connected(diffuse, name);
    if (value.nodeId !== max.id || value.output !== undefined) return failure('diffuse roughness differs from squared specular roughness');
  }
  return imageFile(graph, connected(separate, 'in'));
}
