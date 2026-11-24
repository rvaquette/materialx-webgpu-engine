// Layered layout of a script's node graph for the editor's « Graphe » tab: sources on the
// left, materials on the right, nodes ordered as the script creates them.
import type { ScriptNode } from './script-api.ts';

export interface GraphBox {
  node: ScriptNode;
  level: number;
  x: number;
  y: number;
}

export interface GraphLink {
  from: GraphBox;
  to: GraphBox;
  output: string;
  input: string;
  /** Index of the input among the target's connected inputs, to spread arrival points. */
  slot: number;
  slots: number;
}

export interface GraphLayout {
  boxes: GraphBox[];
  links: GraphLink[];
  width: number;
  height: number;
}

export const GRAPH_BOX = { width: 210, height: 120, gapX: 70, gapY: 24 } as const;

export function layoutScriptGraph(nodes: readonly ScriptNode[]): GraphLayout {
  const members = new Set(nodes);
  const levels = new Map<ScriptNode, number>();
  const level = (node: ScriptNode, visiting = new Set<ScriptNode>()): number => {
    const known = levels.get(node);
    if (known !== undefined) return known;
    if (visiting.has(node)) return 0;
    visiting.add(node);
    let value = 0;
    for (const input of node.inputs.values()) {
      if ('node' in input && members.has(input.node)) value = Math.max(value, level(input.node, visiting) + 1);
    }
    visiting.delete(node);
    levels.set(node, value);
    return value;
  };
  const rows: number[] = [];
  const boxes = nodes.map((node): GraphBox => {
    const column = level(node);
    const row = rows[column] = (rows[column] ?? -1) + 1;
    return { node, level: column, x: column * (GRAPH_BOX.width + GRAPH_BOX.gapX), y: row * (GRAPH_BOX.height + GRAPH_BOX.gapY) };
  });
  const byNode = new Map(boxes.map(box => [box.node, box]));
  const links: GraphLink[] = [];
  for (const box of boxes) {
    const connected = [...box.node.inputs].filter(([, input]) => 'node' in input && byNode.has(input.node));
    connected.forEach(([name, input], slot) => {
      if (!('node' in input)) return;
      links.push({ from: byNode.get(input.node)!, to: box, output: input.output, input: name, slot, slots: connected.length });
    });
  }
  const columns = rows.length;
  const tallest = Math.max(0, ...rows.map(row => row + 1));
  return {
    boxes, links,
    width: Math.max(0, columns * (GRAPH_BOX.width + GRAPH_BOX.gapX) - GRAPH_BOX.gapX),
    height: Math.max(0, tallest * (GRAPH_BOX.height + GRAPH_BOX.gapY) - GRAPH_BOX.gapY),
  };
}
