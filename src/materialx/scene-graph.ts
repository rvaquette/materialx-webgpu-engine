import type { GraphInput, GraphLink, GraphNode, GraphValue, GraphWidget } from '../ui/node-graph-view.ts';

export type SceneGraphKind = 'material' | 'sphere' | 'scene' | 'camera' | 'render' | 'save';

export interface SceneGraphNode {
  id: string;
  kind: SceneGraphKind;
  values: Readonly<Record<string, GraphValue>>;
}

export type SceneGraphLink = GraphLink;

export interface SceneGraph {
  nodes: readonly SceneGraphNode[];
  links: readonly SceneGraphLink[];
}

interface SceneGraphPort {
  name: string;
  type: string;
  widget?: GraphWidget;
  default?: GraphValue;
  required?: boolean;
}

interface SceneGraphNodeDef {
  title: string;
  subtitle: string;
  symbol?: string;
  inputs: readonly SceneGraphPort[];
  outputs: readonly { name: string; type: string }[];
}

const NODE_DEFS: Readonly<Record<SceneGraphKind, SceneGraphNodeDef>> = {
  material: {
    title: 'MaterialX',
    subtitle: 'Référence au graphe de shaders',
    inputs: [],
    outputs: [{ name: 'out', type: 'material' }],
  },
  sphere: {
    title: 'Sphere',
    subtitle: 'Objet de scène',
    inputs: [
      { name: 'material', type: 'material', required: true },
      { name: 'radius', type: 'float', default: 0.6, widget: { kind: 'number', min: 0.001, max: 100 } },
      { name: 'resolution', type: 'integer', default: 48, widget: { kind: 'number', integer: true, min: 3, max: 512 } },
      { name: 'translate', type: 'vector3', default: [0, 0, 0], widget: { kind: 'text' } },
    ],
    outputs: [{ name: 'object', type: 'object' }],
  },
  scene: {
    title: 'Scene',
    subtitle: 'Références d’objets',
    inputs: [
      { name: 'objectA', type: 'object', required: true },
      { name: 'objectB', type: 'object', required: true },
    ],
    outputs: [{ name: 'out', type: 'scene' }],
  },
  camera: {
    title: 'Camera',
    subtitle: 'Pose explicite',
    inputs: [
      { name: 'eye', type: 'vector3', default: [3.4, 2.4, 4.6], widget: { kind: 'text' } },
      { name: 'target', type: 'vector3', default: [0, 0, 0], widget: { kind: 'text' } },
      { name: 'fov', type: 'float', default: 42, widget: { kind: 'number', min: 1, max: 179 } },
    ],
    outputs: [{ name: 'out', type: 'camera' }],
  },
  render: {
    title: 'Render',
    subtitle: 'Backend · résolution · qualité',
    inputs: [
      { name: 'scene', type: 'scene', required: true },
      { name: 'camera', type: 'camera', required: true },
      { name: 'backend', type: 'string', default: 'pathtracing', widget: { kind: 'combo', values: ['raster', 'pathtracing', 'disney'] } },
      { name: 'resolution', type: 'integer', default: 256, widget: { kind: 'number', integer: true, min: 64, max: 2048 } },
      { name: 'depth', type: 'integer', default: 4, widget: { kind: 'number', integer: true, min: 1, max: 12 } },
      { name: 'samples', type: 'integer', default: 16, widget: { kind: 'number', integer: true, min: 1, max: 512 } },
    ],
    outputs: [{ name: 'out', type: 'render-result' }],
  },
  save: {
    title: 'Save',
    subtitle: 'Capture de l’image',
    inputs: [
      { name: 'image', type: 'render-result', required: true },
      { name: 'filename', type: 'string', default: 'p25-scene-graph.png', widget: { kind: 'text' } },
    ],
    outputs: [],
  },
};

const DEFAULT_NODES: readonly SceneGraphNode[] = [
  { id: 'material', kind: 'material', values: {} },
  { id: 'sphereA', kind: 'sphere', values: { radius: 0.6, resolution: 48, translate: [-0.7, 0, 0] } },
  { id: 'sphereB', kind: 'sphere', values: { radius: 0.6, resolution: 48, translate: [0.7, 0, 0] } },
  { id: 'scene', kind: 'scene', values: {} },
  { id: 'camera', kind: 'camera', values: { eye: [3.4, 2.4, 4.6], target: [0, 0, 0], fov: 42 } },
  { id: 'render', kind: 'render', values: { backend: 'pathtracing', resolution: 256, depth: 4, samples: 16 } },
  { id: 'save', kind: 'save', values: { filename: 'p25-scene-graph.png' } },
];

export const P25_SCENE_GRAPH: SceneGraph = {
  nodes: DEFAULT_NODES,
  links: [
    { from: 'material', output: 'out', to: 'sphereA', input: 'material' },
    { from: 'material', output: 'out', to: 'sphereB', input: 'material' },
    { from: 'sphereA', output: 'object', to: 'scene', input: 'objectA' },
    { from: 'sphereB', output: 'object', to: 'scene', input: 'objectB' },
    { from: 'scene', output: 'out', to: 'render', input: 'scene' },
    { from: 'camera', output: 'out', to: 'render', input: 'camera' },
    { from: 'render', output: 'out', to: 'save', input: 'image' },
  ],
};

export const P25_SCENE_GRAPH_LAYOUT: ReadonlyMap<string, readonly [number, number]> = new Map<string, readonly [number, number]>([
  ['material', [0, 80]],
  ['sphereA', [250, 0]],
  ['sphereB', [250, 180]],
  ['scene', [500, 80]],
  ['camera', [500, 340]],
  ['render', [750, 170]],
  ['save', [1000, 170]],
]);

export const P25_MATERIAL_GRAPH_SCRIPT = [
  '// Graphe MaterialX : surface et déplacement composés dans un matériau partagé.',
  'const surface = new StandardSurface();',
  'surface.base_color = [0.12, 0.42, 0.72];',
  'surface.specular_roughness = 0.26;',
  'const displacement = new Displacement("ND_displacement_float");',
  'displacement.displacement = 0.12;',
  'const material = new Surfacematerial();',
  'material.surfaceshader = surface;',
  'material.displacementshader = displacement;',
].join('\n') + '\n';

function nodeDef(node: SceneGraphNode): SceneGraphNodeDef {
  const definition = NODE_DEFS[node.kind];
  if (!definition) throw new Error(`Type de nœud de scène inconnu : ${String(node.kind)}.`);
  return definition;
}

export function sceneGraphViewNodes(graph: SceneGraph): GraphNode[] {
  return graph.nodes.map((node) => {
    const definition = nodeDef(node);
    const inputs: GraphInput[] = definition.inputs.map((port) => {
      const value = node.values[port.name] ?? port.default;
      return {
        name: port.name,
        type: port.type,
        ...(value !== undefined ? { value } : {}),
        ...(port.widget ? { widget: port.widget } : {}),
      };
    });
    return {
      id: node.id,
      title: `${node.id} : ${definition.title}`,
      subtitle: definition.subtitle,
      inputs,
      outputs: definition.outputs,
      editable: true,
    };
  });
}

export function setSceneGraphValue(graph: SceneGraph, id: string, input: string, value: GraphValue): SceneGraph {
  const node = graph.nodes.find(candidate => candidate.id === id);
  if (!node) throw new Error(`Le nœud « ${id} » n’existe pas.`);
  const port = nodeDef(node).inputs.find(candidate => candidate.name === input);
  if (!port?.widget) throw new Error(`${id}.${input} n’est pas une valeur modifiable.`);
  if (Array.isArray(value)) {
    if (!Array.isArray(port.default) || value.length !== port.default.length || !value.every(Number.isFinite)) {
      throw new Error(`${id}.${input} attend un vecteur de ${Array.isArray(port.default) ? port.default.length : 0} nombres finis.`);
    }
  } else if (typeof port.default === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) ||
        (port.widget.integer && !Number.isInteger(value)) ||
        (port.widget.min !== undefined && value < port.widget.min) ||
        (port.widget.max !== undefined && value > port.widget.max)) {
      throw new Error(`${id}.${input} n’est pas une valeur numérique valide.`);
    }
  } else if (typeof port.default === 'string') {
    if (typeof value !== 'string' || (port.widget.values && !port.widget.values.includes(value)) ||
        (node.kind === 'save' && input === 'filename' && !value.toLowerCase().endsWith('.png'))) {
      throw new Error(`${id}.${input} n’est pas une valeur autorisée.`);
    }
  } else {
    throw new Error(`${id}.${input} a un type de valeur non pris en charge.`);
  }
  return {
    ...graph,
    nodes: graph.nodes.map(candidate => candidate.id === id
      ? { ...candidate, values: { ...candidate.values, [input]: Array.isArray(value) ? [...value] : value } }
      : candidate),
  };
}

export function setSceneGraphLink(graph: SceneGraph, link: SceneGraphLink): SceneGraph {
  const source = graph.nodes.find(node => node.id === link.from);
  const target = graph.nodes.find(node => node.id === link.to);
  if (!source || !target) throw new Error('La connexion référence un nœud absent.');
  const output = nodeDef(source).outputs.find(port => port.name === link.output);
  const input = nodeDef(target).inputs.find(port => port.name === link.input);
  if (!output || !input || output.type !== input.type) {
    throw new Error(`Connexion incompatible : ${source.id}.${link.output} → ${target.id}.${link.input}.`);
  }
  const links = graph.links.filter(candidate => candidate.to !== link.to || candidate.input !== link.input);
  return { ...graph, links: [...links, link] };
}

export function removeSceneGraphLink(graph: SceneGraph, id: string, input: string): SceneGraph {
  return { ...graph, links: graph.links.filter(link => link.to !== id || link.input !== input) };
}

function validateSceneGraph(graph: SceneGraph): Map<string, SceneGraphLink> {
  const nodes = new Map<string, SceneGraphNode>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) throw new Error(`Identifiant de nœud dupliqué : ${node.id}.`);
    nodes.set(node.id, node);
    nodeDef(node);
  }
  const incoming = new Map<string, SceneGraphLink>();
  for (const link of graph.links) {
    const source = nodes.get(link.from);
    const target = nodes.get(link.to);
    const output = source && nodeDef(source).outputs.find(port => port.name === link.output);
    const input = target && nodeDef(target).inputs.find(port => port.name === link.input);
    if (!output || !input || output.type !== input.type) {
      throw new Error(`Connexion incompatible ou orpheline : ${link.from}.${link.output} → ${link.to}.${link.input}.`);
    }
    const key = `${link.to}\u0000${link.input}`;
    if (incoming.has(key)) throw new Error(`L’entrée ${link.to}.${link.input} possède plusieurs connexions.`);
    incoming.set(key, link);
  }
  for (const node of graph.nodes) {
    for (const input of nodeDef(node).inputs) {
      if (input.required && !incoming.has(`${node.id}\u0000${input.name}`)) {
        throw new Error(`L’entrée requise ${node.id}.${input.name} n’est pas connectée.`);
      }
    }
  }
  for (const node of graph.nodes.filter(candidate => candidate.kind === 'scene')) {
    const a = incoming.get(`${node.id}\u0000objectA`);
    const b = incoming.get(`${node.id}\u0000objectB`);
    const spheres = graph.nodes.filter(candidate => candidate.kind === 'sphere');
    if (!a || !b || a.from === b.from || spheres.length !== 2 ||
        !spheres.every(sphere => sphere.id === a.from || sphere.id === b.from)) {
      throw new Error(`${node.id} doit référencer les deux sphères distinctes du prototype.`);
    }
  }
  return incoming;
}

export function compileSceneGraph(graph: SceneGraph): string {
  const incoming = validateSceneGraph(graph);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const state = new Map<string, 'visiting' | 'done'>();
  const ordered: SceneGraphNode[] = [];
  const visit = (node: SceneGraphNode): void => {
    const status = state.get(node.id);
    if (status === 'visiting') throw new Error(`Le graphe de scène contient un cycle autour de « ${node.id} ».`);
    if (status === 'done') return;
    state.set(node.id, 'visiting');
    for (const link of graph.links.filter(candidate => candidate.to === node.id)) {
      const source = nodes.get(link.from);
      if (!source) throw new Error(`La connexion référence le nœud absent « ${link.from} ».`);
      visit(source);
    }
    state.set(node.id, 'done');
    ordered.push(node);
  };
  for (const node of graph.nodes) visit(node);

  const symbol = (link: SceneGraphLink): string => {
    const source = nodes.get(link.from)!;
    const name = source.kind === 'material' ? source.id : nodeDef(source).symbol;
    if (!name) throw new Error(`Le nœud ${source.id} ne produit pas de référence de script.`);
    return name;
  };
  const linkTo = (node: SceneGraphNode, input: string): SceneGraphLink => {
    const link = incoming.get(`${node.id}\u0000${input}`);
    if (!link) throw new Error(`L’entrée requise ${node.id}.${input} n’est pas connectée.`);
    return link;
  };
  const value = (node: SceneGraphNode, input: string): GraphValue => {
    const port = nodeDef(node).inputs.find(candidate => candidate.name === input)!;
    const current = node.values[input] ?? port.default;
    if (current === undefined) throw new Error(`La valeur ${node.id}.${input} est absente.`);
    return current;
  };
  const literal = (item: GraphValue): string => Array.isArray(item)
    ? `[${item.map(component => String(component)).join(', ')}]`
    : JSON.stringify(item);
  const lines: string[] = ['// Priorité 25 : graphe de scène et workflow de rendu.'];
  for (const node of ordered) {
    switch (node.kind) {
      case 'material':
        break;
      case 'sphere':
        lines.push(
          `const ${node.id} = new Sphere({ radius: ${literal(value(node, 'radius'))}, resolution: ${literal(value(node, 'resolution'))} });`,
          `${node.id}.material = ${symbol(linkTo(node, 'material'))};`,
          `${node.id}.translate = ${literal(value(node, 'translate'))};`,
        );
        break;
      case 'scene':
        linkTo(node, 'objectA');
        linkTo(node, 'objectB');
        break;
      case 'camera':
        lines.push(`setCamera({ eye: ${literal(value(node, 'eye'))}, target: ${literal(value(node, 'target'))}, fov: ${literal(value(node, 'fov'))} });`);
        break;
      case 'render':
        linkTo(node, 'scene');
        linkTo(node, 'camera');
        lines.push(
          `render.backend = ${literal(value(node, 'backend'))};`,
          `render.resolution = ${literal(value(node, 'resolution'))};`,
          `render.depth = ${literal(value(node, 'depth'))};`,
          `await render(${literal(value(node, 'samples'))});`,
        );
        break;
      case 'save':
        linkTo(node, 'image');
        lines.push(`await save(${literal(value(node, 'filename'))});`);
        break;
    }
  }
  return `${lines.join('\n')}\n`;
}

export function compileP25SceneGraphScript(graph: SceneGraph): string {
  return `${P25_MATERIAL_GRAPH_SCRIPT}\n${compileSceneGraph(graph)}`;
}
