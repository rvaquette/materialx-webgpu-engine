import { parse, type Expression, type Node, type ObjectExpression } from 'acorn';
import { coerceValue, type ScriptLibrary, type ScriptNodeDef } from './script-api.ts';
import {
  compileSceneGraph, P25_SCENE_GRAPH, setSceneGraphValue, type SceneGraph,
} from './scene-graph.ts';

export interface ImportedSceneGraph {
  graph: SceneGraph;
  materialScript: string;
}

function fail(node: Node, message: string): never {
  throw new Error(`Ligne ${node.loc?.start.line ?? '?'} : ${message}`);
}

function literal(node: Expression): number | boolean | string | number[] {
  if (node.type === 'Literal' &&
      (typeof node.value === 'number' && Number.isFinite(node.value) ||
       typeof node.value === 'string' || typeof node.value === 'boolean')) return node.value as number | boolean | string;
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '+')) {
    const operand = literal(node.argument);
    if (typeof operand === 'number') return node.operator === '-' ? -operand : operand;
  }
  if (node.type === 'ArrayExpression') {
    const values = node.elements.map(element => {
      if (!element || element.type === 'SpreadElement') fail(node, 'un vecteur doit contenir uniquement des nombres littéraux.');
      const value = literal(element);
      if (typeof value !== 'number') fail(element, 'un vecteur doit contenir uniquement des nombres littéraux.');
      return value;
    });
    return values;
  }
  return fail(node, 'expression non convertible : utiliser une valeur littérale ou une référence de shader directe.');
}

function properties(node: ObjectExpression): Map<string, Expression> {
  const result = new Map<string, Expression>();
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.computed || property.kind !== 'init' || property.method ||
        property.key.type !== 'Identifier') {
      fail(property, 'propriété calculée, décomposition ou spread non convertible.');
    }
    if (result.has(property.key.name)) fail(property, `propriété ${property.key.name} répétée.`);
    result.set(property.key.name, property.value);
  }
  return result;
}

function member(node: Node): { object: string; property: string } | undefined {
  if (node.type !== 'MemberExpression') return undefined;
  const expression = node as import('acorn').MemberExpression;
  if (expression.computed || expression.optional || expression.object.type !== 'Identifier' ||
      expression.property.type !== 'Identifier') return undefined;
  return { object: expression.object.name, property: expression.property.name };
}

/** Converts a deliberately restricted declarative script without executing it. */
export function scriptToSceneGraph(code: string, library: ScriptLibrary): ImportedSceneGraph {
  const program = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true });
  const shaders = new Map<string, ScriptNodeDef>();
  const spheres: { name: string; radius: number; resolution: number; translate: number[]; material?: string; assigned: Set<string> }[] = [];
  let firstScene = -1;
  let camera: { eye: number[]; target: number[]; fov: number } | undefined;
  const settings = new Map<string, number | string>();
  let samples: number | undefined;
  let filename: string | undefined;
  const state: { phase: 'shaders' | 'objects' | 'settings' | 'rendered' | 'saved' } = { phase: 'shaders' };

  const beginScene = (node: Node): void => { if (firstScene < 0) firstScene = node.start; };
  const number = (expression: Expression): number => {
    const value = literal(expression);
    if (typeof value !== 'number') fail(expression, 'un nombre littéral est requis.');
    return value;
  };
  const vector = (expression: Expression): number[] => {
    const value = literal(expression);
    if (!Array.isArray(value) || value.length !== 3) fail(expression, 'un vecteur de trois nombres est requis.');
    return value;
  };
  const assignSphere = (sphere: typeof spheres[number], name: string, expression: Expression): void => {
    if (sphere.assigned.has(name)) fail(expression, `${sphere.name}.${name} est affecté plusieurs fois.`);
    sphere.assigned.add(name);
    if (name === 'radius') sphere.radius = number(expression);
    else if (name === 'resolution') sphere.resolution = number(expression);
    else if (name === 'translate') sphere.translate = vector(expression);
    else if (name === 'material' && expression.type === 'Identifier' && shaders.has(expression.name)) sphere.material = expression.name;
    else fail(expression, `${sphere.name}.${name} n’est pas pris en charge par le graphe de scène.`);
  };
  const create = (name: string, expression: Expression, statement: Node): void => {
    if (expression.type !== 'NewExpression' || expression.callee.type !== 'Identifier') {
      fail(expression, 'seules les créations directes de nœuds sont convertibles.');
    }
    if (shaders.has(name) || spheres.some(sphere => sphere.name === name) ||
        ['scene', 'camera', 'render', 'save'].includes(name)) fail(statement, `identifiant ${name} dupliqué ou réservé.`);
    if (expression.callee.name === 'Sphere') {
      if (state.phase !== 'shaders' && state.phase !== 'objects') fail(statement, 'les objets doivent être créés avant la caméra et le rendu.');
      beginScene(statement);
      state.phase = 'objects';
      if (spheres.length === 2) fail(statement, 'le prototype accepte exactement deux sphères.');
      const sphere: typeof spheres[number] = { name, radius: 0.5, resolution: 48, translate: [0, 0, 0], assigned: new Set() };
      if (expression.arguments.length > 1) fail(expression, 'Sphere accepte un seul objet de propriétés.');
      const arg = expression.arguments[0];
      if (arg) {
        if (arg.type !== 'ObjectExpression') fail(arg, 'Sphere attend un objet de propriétés littérales.');
        for (const [key, value] of properties(arg)) assignSphere(sphere, key, value);
      }
      spheres.push(sphere);
      return;
    }
    if (state.phase !== 'shaders') fail(statement, 'les nœuds MaterialX doivent précéder les objets de scène.');
    const category = library.categoryOf(expression.callee.name);
    if (!category || expression.arguments.length > 1) fail(expression, `constructeur ${expression.callee.name} non convertible.`);
    const arg = expression.arguments[0];
    if (arg && (arg.type !== 'Literal' || typeof arg.value !== 'string')) fail(arg, 'la variante MaterialX doit être une chaîne littérale.');
    shaders.set(name, library.resolve(category, arg && arg.type === 'Literal' && typeof arg.value === 'string' ? arg.value : undefined));
  };
  const shaderAssignment = (owner: string, input: string, expression: Expression): void => {
    const def = shaders.get(owner)!;
    const port = def.inputs.find(candidate => candidate.name === input);
    if (!port) fail(expression, `${owner}.${input} n’est pas une entrée du nœud MaterialX.`);
    if (expression.type === 'Identifier') {
      const source = shaders.get(expression.name);
      if (!source?.outputs.some(output => output.type === port.type)) fail(expression, `référence de shader ${expression.name} incompatible.`);
      return;
    }
    const source = member(expression);
    if (source) {
      if (!shaders.get(source.object)?.outputs.some(output => output.name === source.property && output.type === port.type)) {
        fail(expression, `sortie ${source.object}.${source.property} incompatible.`);
      }
      return;
    }
    coerceValue(literal(expression), port.type, `${owner}.${input}`);
  };

  for (const statement of program.body) {
    if (statement.type === 'VariableDeclaration') {
      if (statement.declarations.length !== 1) fail(statement, 'déclarer un seul nœud par instruction.');
      const declaration = statement.declarations[0]!;
      if (declaration.id.type !== 'Identifier' || !declaration.init) fail(statement, 'déclaration de nœud non convertible.');
      create(declaration.id.name, declaration.init, statement);
      continue;
    }
    if (statement.type !== 'ExpressionStatement') fail(statement, 'structure JavaScript non convertible en graphe de scène.');
    let expression = statement.expression;
    const awaited = expression.type === 'AwaitExpression';
    if (expression.type === 'AwaitExpression') expression = expression.argument;
    if (expression.type === 'AssignmentExpression' && expression.operator === '=' && !awaited) {
      if (expression.left.type === 'Identifier') {
        create(expression.left.name, expression.right, statement);
        continue;
      }
      const target = member(expression.left);
      if (!target) fail(expression, 'affectation dynamique non convertible.');
      if (shaders.has(target.object)) {
        if (state.phase !== 'shaders') fail(statement, 'les modifications MaterialX doivent précéder les objets de scène.');
        shaderAssignment(target.object, target.property, expression.right);
        continue;
      }
      const sphere = spheres.find(candidate => candidate.name === target.object);
      if (sphere) {
        if (state.phase !== 'objects') fail(statement, 'les modifications d’objets doivent précéder la caméra et le rendu.');
        assignSphere(sphere, target.property, expression.right);
        continue;
      }
      if (target.object === 'render' && state.phase === 'settings' && ['backend', 'resolution', 'depth'].includes(target.property)) {
        if (settings.has(target.property)) fail(statement, `render.${target.property} est affecté plusieurs fois.`);
        const value = literal(expression.right);
        if (typeof value !== 'number' && typeof value !== 'string') fail(expression.right, 'réglage de rendu invalide.');
        settings.set(target.property, value);
        continue;
      }
      fail(statement, `affectation ${target.object}.${target.property} non convertible.`);
    }
    if (expression.type !== 'CallExpression' || expression.callee.type !== 'Identifier' || expression.optional) {
      fail(statement, 'instruction ou appel non convertible.');
    }
    const name = expression.callee.name;
    const arg = expression.arguments[0];
    if (expression.arguments.length !== 1 || !arg || arg.type === 'SpreadElement') fail(statement, `${name} attend un argument explicite.`);
    if (name === 'setCamera' && !awaited && state.phase === 'objects') {
      if (arg.type !== 'ObjectExpression') fail(arg, 'setCamera attend un objet littéral.');
      const fields = properties(arg);
      if (fields.size !== 3 || !fields.has('eye') || !fields.has('target') || !fields.has('fov')) {
        fail(arg, 'setCamera doit définir exactement eye, target et fov.');
      }
      camera = { eye: vector(fields.get('eye')!), target: vector(fields.get('target')!), fov: number(fields.get('fov')!) };
      state.phase = 'settings';
    } else if (name === 'render' && awaited && state.phase === 'settings') {
      samples = number(arg);
      state.phase = 'rendered';
    } else if (name === 'save' && awaited && state.phase === 'rendered') {
      const value = literal(arg);
      if (typeof value !== 'string' || !value.toLowerCase().endsWith('.png')) fail(arg, 'la capture doit être un fichier PNG littéral.');
      filename = value;
      state.phase = 'saved';
    } else fail(statement, `appel ${name} non pris en charge ou hors ordre.`);
  }

  if (spheres.length !== 2 || !camera || samples === undefined || !filename || state.phase !== 'saved' ||
      !settings.has('backend') || !settings.has('resolution') || !settings.has('depth')) {
    fail(program, 'le prototype attend deux sphères, une caméra, backend/résolution/depth, render puis save PNG.');
  }
  const [a, b] = spheres;
  if (!a?.material || !b?.material || a.material !== b.material ||
      !shaders.get(a.material)?.outputs.some(output => output.type === 'material')) {
    fail(program, 'les deux sphères doivent partager un même matériau MaterialX explicite.');
  }
  const names: Readonly<Record<string, string>> = { material: a.material, sphereA: a.name, sphereB: b.name };
  let graph: SceneGraph = {
    nodes: P25_SCENE_GRAPH.nodes.map(node => ({ ...node, id: names[node.id] ?? node.id })),
    links: P25_SCENE_GRAPH.links.map(link => ({ ...link, from: names[link.from] ?? link.from, to: names[link.to] ?? link.to })),
  };
  for (const sphere of [a, b]) {
    graph = setSceneGraphValue(graph, sphere.name, 'radius', sphere.radius);
    graph = setSceneGraphValue(graph, sphere.name, 'resolution', sphere.resolution);
    graph = setSceneGraphValue(graph, sphere.name, 'translate', sphere.translate);
  }
  for (const [key, value] of Object.entries(camera)) graph = setSceneGraphValue(graph, 'camera', key, value);
  for (const [key, value] of settings) graph = setSceneGraphValue(graph, 'render', key, value);
  graph = setSceneGraphValue(graph, 'render', 'samples', samples);
  graph = setSceneGraphValue(graph, 'save', 'filename', filename);
  compileSceneGraph(graph);
  return { graph, materialScript: code.slice(0, firstScene).trimEnd() + '\n' };
}
