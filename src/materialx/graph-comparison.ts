import type { ResolvedGraph, ResolvedInput, ResolvedNode } from './graph.ts';

function describeInput(input: ResolvedInput | undefined): string | undefined {
  if (!input) return undefined;
  const { source } = input;
  const binding = source.kind === 'value' ? source.value
    : source.kind === 'connection' ? `← ${source.nodeId}${source.output ? `.${source.output}` : ''}`
    : source.kind === 'interface' ? `Interface : ${source.name}` : 'Valeur par défaut';
  return `${binding} (${input.type})`;
}

function describeNode(node: ResolvedNode | undefined): string | undefined {
  return node ? `${node.category} (${node.type})` : undefined;
}

function inputKey(input: ResolvedInput | undefined): string | undefined {
  if (!input) return undefined;
  const { source } = input;
  switch (source.kind) {
    case 'value': return JSON.stringify([input.type, source.kind, source.value]);
    case 'connection': return JSON.stringify([input.type, source.kind, source.nodeId, source.output]);
    case 'interface': return JSON.stringify([input.type, source.kind, source.name]);
    case 'default': return JSON.stringify([input.type, source.kind]);
  }
}

export function compareMaterialGraphs(a: ResolvedGraph, b: ResolvedGraph) {
  const differences: { node: string; input?: string; a?: string; b?: string }[] = [];
  function add(node: string, a: string | undefined, b: string | undefined, input?: string): void {
    differences.push({
      node, ...(input === undefined ? {} : { input }),
      ...(a === undefined ? {} : { a }), ...(b === undefined ? {} : { b }),
    });
  }
  for (const id of new Set([...a.nodes.keys(), ...b.nodes.keys()])) {
    const before = a.nodes.get(id);
    const after = b.nodes.get(id);
    const nodeA = describeNode(before), nodeB = describeNode(after);
    if (nodeA !== nodeB) add(id, nodeA, nodeB);
    if (!before || !after) continue;
    const inputsA = new Map(before.inputs.map(input => [input.name, input]));
    const inputsB = new Map(after.inputs.map(input => [input.name, input]));
    for (const name of new Set([...inputsA.keys(), ...inputsB.keys()])) {
      const inputA = inputsA.get(name), inputB = inputsB.get(name);
      if (inputKey(inputA) !== inputKey(inputB)) add(id, describeInput(inputA), describeInput(inputB), name);
    }
  }
  return differences;
}
